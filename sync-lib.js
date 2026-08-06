'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { highlightUid } = require('./highlight-uid');
const { fetchExistingUids, insertRows } = require('./baserow');

const NOTEBOOK_URL = 'https://read.amazon.com/notebook';
const STORAGE_STATE_PATH = path.join(__dirname, 'auth-state.json');

// Amazon's notebook DOM isn't documented and can drift — these are the
// current selectors as of this writing. If scraping comes back empty,
// inspect the live page and update the values below.
const SEL = {
  libraryContainer: '#kp-notebook-library',
  bookRow: '#kp-notebook-library .kp-notebook-library-each-book',
  bookTitle: 'h2.kp-notebook-searchable',
  bookAuthor: 'p.kp-notebook-searchable',
  annotationsPanel: '#kp-notebook-annotations',
  highlightRow: '#kp-notebook-annotations > div[id]',
  highlightText: '#highlight',
  highlightHeader: '#annotationHighlightHeader',
  loadMoreTrigger: '#kp-notebook-annotations-next-page-start',
};

const CAP_MESSAGE_PATTERN = /maximum number|reached the limit|highlight limit/i;

class SessionExpiredError extends Error {}

async function getContext(browser, { interactive }) {
  const hasStoredSession = fs.existsSync(STORAGE_STATE_PATH);
  const context = await browser.newContext(
    hasStoredSession ? { storageState: STORAGE_STATE_PATH } : {}
  );
  const page = await context.newPage();
  try {
    await page.goto(NOTEBOOK_URL, { waitUntil: 'commit' });
  } catch (err) {
    // Amazon's page sometimes redirects/reloads client-side before the
    // navigation settles, which Playwright surfaces as ERR_ABORTED. The
    // loggedIn check below is authoritative regardless of how goto() ended.
  }

  const loggedIn = await page
    .waitForSelector(SEL.bookRow, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (!loggedIn) {
    if (!interactive) {
      await context.close();
      throw new SessionExpiredError(
        'Amazon session expired or not logged in — run `cd ~/Projects/winston && npm run sync` manually to re-authenticate.'
      );
    }
    console.log('\nNot logged in (or session expired). Log in in the browser window —');
    console.log('the script will continue automatically once your highlights load.\n');
    await page.waitForSelector(SEL.bookRow, { timeout: 0 });
  }

  await context.storageState({ path: STORAGE_STATE_PATH });
  return { context, page };
}

async function loadAllBooks(page, log) {
  let previousCount = -1;
  for (let i = 0; i < 300; i++) {
    const count = await page.locator(SEL.bookRow).count();
    if (count === previousCount) break;
    previousCount = count;

    await page
      .locator(SEL.libraryContainer)
      .evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      })
      .catch(() => {});
    await page.waitForTimeout(400);
  }
  log(`Loaded ${previousCount} book(s) after scrolling the library list.`);
}

async function loadAllHighlights(page) {
  let previousCount = -1;
  for (let i = 0; i < 50; i++) {
    const rows = await page.locator(SEL.highlightRow);
    const count = await rows.count();
    if (count === previousCount) break;
    previousCount = count;

    const trigger = page.locator(SEL.loadMoreTrigger);
    if ((await trigger.count()) > 0) {
      await trigger.scrollIntoViewIfNeeded().catch(() => {});
    }
    await page.waitForTimeout(600);
  }
}

async function scrapeBook(page, bookRow) {
  const title = (await bookRow.locator(SEL.bookTitle).first().innerText()).trim();
  const authorRaw = await bookRow
    .locator(SEL.bookAuthor)
    .first()
    .innerText()
    .catch(() => '');
  const author = authorRaw.replace(/^By:\s*/i, '').trim();

  await bookRow.click();
  await page.waitForSelector(SEL.annotationsPanel, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await loadAllHighlights(page);

  const panelText = await page.locator(SEL.annotationsPanel).innerText().catch(() => '');
  const capped = CAP_MESSAGE_PATTERN.test(panelText);

  const rows = page.locator(SEL.highlightRow);
  const count = await rows.count();
  const highlights = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = await row
      .locator(SEL.highlightText)
      .first()
      .innerText()
      .catch(() => '');
    if (!text.trim()) continue;

    const header = await row
      .locator(SEL.highlightHeader)
      .first()
      .innerText()
      .catch(() => '');
    const locationMatch = header.match(/Location:?\s*([\d,]+)/i);
    const location = locationMatch ? locationMatch[1] : header.trim();

    highlights.push({ text: text.trim(), location });
  }

  return { title, author, highlights, capped };
}

/**
 * Runs a full sync. `interactive: true` (manual CLI) opens a visible browser
 * and waits indefinitely for login if the session has expired. `interactive:
 * false` (unattended polling) runs headless and fails fast via
 * SessionExpiredError if login would be required, since no one is there to
 * complete it.
 */
async function runSync({ interactive = true, log = console.log, maxBooks = null } = {}) {
  const browser = await chromium.launch({ headless: !interactive });
  let context;
  try {
    const ctx = await getContext(browser, { interactive });
    context = ctx.context;
    const page = ctx.page;

    log('Fetching existing highlight IDs from Baserow for dedup...');
    const existingUids = await fetchExistingUids();
    log(`Found ${existingUids.size} existing highlights.`);

    await loadAllBooks(page, log);
    let bookCount = await page.locator(SEL.bookRow).count();
    log(`Found ${bookCount} books in your Kindle library.`);

    // Amazon's library list is sorted with the most recently highlighted/added
    // books first, so capping here covers "what did I just highlight" without
    // a full sweep of the whole library.
    if (maxBooks && bookCount > maxBooks) {
      log(`Limiting to the ${maxBooks} most recently active books for a faster sync.`);
      bookCount = maxBooks;
    }

    const cappedBooks = [];
    const syncedAt = new Date().toISOString().slice(0, 10);
    let totalInserted = 0;

    for (let i = 0; i < bookCount; i++) {
      const bookRow = page.locator(SEL.bookRow).nth(i);
      let scraped;
      try {
        scraped = await scrapeBook(page, bookRow);
      } catch (err) {
        log(`  Skipping a book — couldn't scrape it: ${err.message || err}`);
        continue;
      }
      const { title, author, highlights, capped } = scraped;

      if (capped) cappedBooks.push(title);

      const bookRows = [];
      for (const h of highlights) {
        const uid = highlightUid(title, h.location, h.text);
        if (existingUids.has(uid)) continue;

        bookRows.push({
          book_title: title,
          author,
          highlight_text: h.text,
          location: h.location,
          source_added_at: syncedAt,
          synced_at: syncedAt,
          highlight_uid: uid,
        });
        existingUids.add(uid);
      }

      if (bookRows.length > 0) {
        await insertRows(bookRows);
        totalInserted += bookRows.length;
      }

      log(
        `  ${title} — ${highlights.length} highlight(s), ${bookRows.length} new${capped ? ' [CAP REACHED]' : ''}`
      );
    }

    log(`${totalInserted} new highlight(s) inserted.`);
    if (cappedBooks.length > 0) {
      log("WARNING: these books may have hit Amazon's per-book highlight export cap:");
      for (const title of cappedBooks) log(`  - ${title}`);
    }

    return { totalInserted, cappedBooks, bookCount };
  } finally {
    if (context) await context.close();
    await browser.close();
  }
}

module.exports = { runSync, SessionExpiredError };
