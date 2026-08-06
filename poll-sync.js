'use strict';

const fs = require('fs');
const path = require('path');

process.loadEnvFile(path.join(__dirname, '.env'));

const { runSync, SessionExpiredError } = require('./sync-lib');
const { getSyncStatus, setSyncStatus } = require('./baserow');

const LOCK_PATH = path.join(__dirname, '.sync.lock');
const LOCK_STALE_MS = 30 * 60 * 1000; // a sync should never take this long

// Remote/unattended syncs (triggered from the web app) prioritize speed —
// only check the most recently active books rather than sweeping the whole
// library. Run `npm run sync` manually for a full scan.
const MAX_BOOKS = 25;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
}

const BASEROW_DOWN_PATTERN = /\b(500|502|503|504)\b|upstream connect error|ECONNREFUSED|ETIMEDOUT/i;

/** Baserow itself being flaky produces noisy HTML/proxy error bodies — collapse those to one clear line. */
function describeError(err) {
  const raw = err.message || String(err);
  if (BASEROW_DOWN_PATTERN.test(raw)) {
    return "Baserow (the backend) appears to be down or unreachable right now — this isn't a Winston bug, it should resolve on its own. Will retry automatically.";
  }
  return raw;
}

function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (age < LOCK_STALE_MS) return false;
    log('Stale lock file found, removing.');
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
  return true;
}

function releaseLock() {
  fs.rmSync(LOCK_PATH, { force: true });
}

async function main() {
  const status = await getSyncStatus();
  if (!status) {
    log('No Sync Status row found in Baserow — nothing to do.');
    return;
  }

  const currentStatus = status.status ? status.status.value : null;
  if (currentStatus !== 'requested') {
    return; // nothing to do this tick
  }

  if (!acquireLock()) {
    log('Sync already in progress (lock held) — skipping this tick.');
    return;
  }

  try {
    log('Sync requested — starting unattended run.');
    await setSyncStatus(status.id, { status: 'running' });

    const result = await runSync({ interactive: false, log, maxBooks: MAX_BOOKS });

    await setSyncStatus(status.id, {
      status: 'idle',
      last_synced_at: new Date().toISOString(),
      last_error: '',
    });
    log(`Sync complete — ${result.totalInserted} new highlight(s).`);
  } catch (err) {
    const message =
      err instanceof SessionExpiredError ? err.message : `Sync failed: ${describeError(err)}`;
    log(message);
    await setSyncStatus(status.id, { status: 'error', last_error: message }).catch(() => {});
  } finally {
    releaseLock();
  }
}

main().catch((err) => {
  log(describeError(err));
  releaseLock();
  process.exit(1);
});
