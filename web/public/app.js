(() => {
  const REVIEW_COUNT = 8;
  const PIN_KEY = 'winston_pin';

  const SCROLL_ICON = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 4h10.5a2.5 2.5 0 0 1 0 5H8"/>
    <path d="M18 20H7.5a2.5 2.5 0 0 1 0-5H16"/>
    <path d="M6 4a2.5 2.5 0 0 0 0 5"/>
    <path d="M18 20a2.5 2.5 0 0 0 0-5"/>
    <line x1="8" y1="9" x2="16.5" y2="9"/>
    <line x1="7.5" y1="15" x2="16" y2="15"/>
  </svg>`;
  const CHECK_ICON = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  const state = {
    pin: localStorage.getItem(PIN_KEY) || '',
    highlights: [],
    reviewMode: 'today',
    reviewSet: [],
  };

  const $ = (sel) => document.querySelector(sel);

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'X-Pin': state.pin,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // ---------- PIN gate ----------
  async function tryPin(pin) {
    const res = await fetch('/api/ping', { headers: { 'X-Pin': pin } });
    return res.ok;
  }

  async function initPinGate() {
    if (state.pin) {
      const ok = await tryPin(state.pin);
      if (ok) {
        $('#pin-screen').classList.add('hidden');
        return start();
      }
      localStorage.removeItem(PIN_KEY);
      state.pin = '';
    }
    $('#pin-screen').classList.remove('hidden');
    $('#pin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = $('#pin-input').value.trim();
      const ok = await tryPin(pin);
      if (!ok) {
        $('#pin-error').textContent = 'Wrong PIN';
        return;
      }
      state.pin = pin;
      localStorage.setItem(PIN_KEY, pin);
      $('#pin-screen').classList.add('hidden');
      start();
    });
  }

  // ---------- Boot ----------
  async function start() {
    $('#app').classList.remove('hidden');
    setupTabs();
    setupReviewControls();
    setupSync();

    try {
      state.highlights = await api('/api/highlights');
    } catch (err) {
      const msg =
        "Can't load your highlights right now — Baserow (the backend this app relies on) seems to be down. Try refreshing in a few minutes.";
      $('#all-list').innerHTML = `<div class="empty-state">${msg}</div>`;
      $('#review-list').innerHTML = `<div class="empty-state">${msg}</div>`;
      return;
    }

    populateBookFilter();
    $('#book-filter').addEventListener('change', renderAllTab);
    $('#status-filter').addEventListener('change', renderAllTab);
    $('#search-input').addEventListener('input', renderAllTab);

    renderAllTab();
    buildReviewSet();
    renderReviewTab();
  }

  // ---------- Sync ----------
  function relativeTime(isoString) {
    if (!isoString) return 'never';
    const diffMs = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  async function refreshSyncStatus() {
    const btn = $('#sync-btn');
    const label = $('#sync-status');

    let row;
    try {
      row = await api('/api/sync-status');
    } catch (err) {
      btn.disabled = true;
      label.classList.add('error');
      label.textContent = "Can't reach Baserow right now — sync status unavailable. Try again shortly.";
      return;
    }
    const statusValue = row && row.status ? row.status.value : 'idle';

    label.classList.toggle('error', statusValue === 'error');

    if (statusValue === 'requested') {
      btn.disabled = true;
      label.textContent = 'Sync requested — waiting for your Mac...';
    } else if (statusValue === 'running') {
      btn.disabled = true;
      label.textContent = 'Syncing...';
    } else if (statusValue === 'error') {
      btn.disabled = false;
      label.textContent = `Sync failed: ${row.last_error || 'unknown error'}`;
    } else {
      btn.disabled = false;
      label.textContent = `Last synced: ${relativeTime(row && row.last_synced_at)}`;
    }
  }

  function setupSync() {
    $('#sync-btn').addEventListener('click', async () => {
      $('#sync-btn').disabled = true;
      $('#sync-status').textContent = 'Sync requested — waiting for your Mac...';
      try {
        await api('/api/sync-status', { method: 'POST', body: '{}' });
      } catch (err) {
        // fall through to refresh, which will show current state
      }
      refreshSyncStatus();
    });

    refreshSyncStatus();
    setInterval(refreshSyncStatus, 15000);
  }

  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $(`#tab-${btn.dataset.tab}`).classList.add('active');
      });
    });
  }

  function populateBookFilter() {
    const seen = new Map();
    for (const h of state.highlights) {
      seen.set(h.book_title, (seen.get(h.book_title) || 0) + 1);
    }
    const sorted = [...seen].sort((a, b) => a[0].localeCompare(b[0]));
    const select = $('#book-filter');
    for (const [title, count] of sorted) {
      const opt = document.createElement('option');
      opt.value = title;
      opt.textContent = `${title} (${count})`;
      select.appendChild(opt);
    }
  }

  // ---------- All Highlights tab ----------
  function renderAllTab() {
    const bookFilter = $('#book-filter').value;
    const statusFilter = $('#status-filter').value;
    const query = $('#search-input').value.trim().toLowerCase();

    let filtered = state.highlights;
    if (bookFilter) filtered = filtered.filter((h) => h.book_title === bookFilter);
    if (statusFilter === 'uncommented') filtered = filtered.filter((h) => !h.comment);
    if (statusFilter === 'commented') filtered = filtered.filter((h) => !!h.comment);
    if (query) {
      filtered = filtered.filter((h) =>
        [h.highlight_text, h.book_title, h.author, h.comment]
          .some((field) => field && field.toLowerCase().includes(query))
      );
    }

    const container = $('#all-list');
    container.innerHTML = '';

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state">No highlights match this filter.</div>';
      return;
    }

    const groups = new Map();
    for (const h of filtered) {
      if (!groups.has(h.book_title)) groups.set(h.book_title, []);
      groups.get(h.book_title).push(h);
    }

    for (const [title, items] of groups) {
      const group = document.createElement('div');
      group.className = 'book-group';
      const heading = document.createElement('h2');
      heading.textContent = `${title} (${items.length})`;
      group.appendChild(heading);
      for (const h of items) group.appendChild(renderCard(h));
      container.appendChild(group);
    }
  }

  function renderCard(h, opts = {}) {
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'card-header';

    const textWrap = document.createElement('div');
    if (opts.showBook) {
      const bookLabel = document.createElement('div');
      bookLabel.className = 'card-book';
      bookLabel.textContent = h.book_title;
      textWrap.appendChild(bookLabel);
    }
    const text = document.createElement('div');
    text.className = 'card-text';
    text.textContent = h.highlight_text;
    textWrap.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const cleanLocation = (h.location || '').replace(/^\s*\w+\s+highlight\s*\|\s*/i, '').trim();
    meta.textContent = [h.author, cleanLocation].filter(Boolean).join(' · ');
    textWrap.appendChild(meta);

    const starBtn = document.createElement('button');
    starBtn.className = 'star-btn' + (h.starred ? ' starred' : '');
    starBtn.textContent = h.starred ? '★' : '☆';
    starBtn.title = h.starred ? 'Unstar' : 'Star for review';
    starBtn.addEventListener('click', () => toggleStar(h, starBtn));

    const pushBtn = document.createElement('button');
    pushBtn.className = 'push-btn' + (h.seneca_row_id ? ' pushed' : '');
    pushBtn.innerHTML = SCROLL_ICON;
    pushBtn.title = h.seneca_row_id ? 'Already in Seneca — click to update it' : 'Push to Seneca';
    pushBtn.addEventListener('click', () => pushToSeneca(h, pushBtn));

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.appendChild(starBtn);
    actions.appendChild(pushBtn);

    header.appendChild(textWrap);
    header.appendChild(actions);
    card.appendChild(header);

    const commentBox = document.createElement('textarea');
    commentBox.className = 'comment-box';
    commentBox.placeholder = 'Note to self...';
    commentBox.value = h.comment || '';
    let debounceTimer;
    commentBox.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => saveComment(h, commentBox.value), 800);
    });
    card.appendChild(commentBox);

    const savedLabel = document.createElement('div');
    savedLabel.className = 'comment-saved';
    savedLabel.dataset.role = 'saved-label';
    card.appendChild(savedLabel);

    card._savedLabel = savedLabel;
    return card;
  }

  async function toggleStar(h, btn) {
    const next = !h.starred;
    h.starred = next;
    btn.classList.toggle('starred', next);
    btn.textContent = next ? '★' : '☆';
    try {
      await api(`/api/highlights/${h.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ starred: next }),
      });
      buildReviewSet();
      if ($('#tab-review').classList.contains('active')) renderReviewTab();
    } catch (err) {
      h.starred = !next;
      btn.classList.toggle('starred', !next);
      btn.textContent = !next ? '★' : '☆';
      alert('Could not save star — check connection.');
    }
  }

  async function pushToSeneca(h, btn) {
    btn.disabled = true;
    try {
      const row = await api('/api/push-to-seneca', {
        method: 'POST',
        body: JSON.stringify({
          quote: h.highlight_text,
          author: h.author,
          comment: h.comment,
          senecaRowId: h.seneca_row_id || null,
        }),
      });

      if (String(row.id) !== String(h.seneca_row_id)) {
        h.seneca_row_id = String(row.id);
        api(`/api/highlights/${h.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ seneca_row_id: h.seneca_row_id }),
        }).catch(() => {});
      }

      btn.classList.add('pushed');
      btn.title = 'Already in Seneca — click to update it';
      btn.innerHTML = CHECK_ICON;
      setTimeout(() => {
        btn.innerHTML = SCROLL_ICON;
        btn.disabled = false;
      }, 1500);
    } catch (err) {
      btn.disabled = false;
      alert('Could not push to Seneca — check connection.');
    }
  }

  async function saveComment(h, value) {
    h.comment = value;
    try {
      await api(`/api/highlights/${h.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ comment: value }),
      });
    } catch (err) {
      alert('Could not save comment — check connection.');
    }
  }

  // ---------- Review tab ----------
  function setupReviewControls() {
    $('#review-today-btn').addEventListener('click', () => {
      state.reviewMode = 'today';
      $('#review-today-btn').classList.add('active');
      $('#review-all-btn').classList.remove('active');
      $('#review-shuffle-btn').classList.remove('hidden');
      renderReviewTab();
    });
    $('#review-all-btn').addEventListener('click', () => {
      state.reviewMode = 'all';
      $('#review-all-btn').classList.add('active');
      $('#review-today-btn').classList.remove('active');
      $('#review-shuffle-btn').classList.add('hidden');
      renderReviewTab();
    });
    $('#review-shuffle-btn').addEventListener('click', () => {
      buildReviewSet({ forceReshuffle: true });
      renderReviewTab();
    });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildReviewSet({ forceReshuffle = false } = {}) {
    const starred = state.highlights.filter((h) => h.starred);
    if (starred.length === 0) {
      state.reviewSet = [];
      return;
    }

    const today = todayStr();
    let pool = starred;
    if (!forceReshuffle) {
      const notShownToday = starred.filter((h) => h.last_shown_at !== today);
      pool = notShownToday.length > 0 ? notShownToday : starred;
    }

    pool = pool.slice().sort((a, b) => {
      const aDate = a.last_shown_at || '';
      const bDate = b.last_shown_at || '';
      return aDate.localeCompare(bDate);
    });

    const candidatePool = pool.slice(0, Math.max(REVIEW_COUNT * 3, REVIEW_COUNT));
    state.reviewSet = shuffle(candidatePool).slice(0, REVIEW_COUNT);

    for (const h of state.reviewSet) {
      if (h.last_shown_at !== today) {
        h.last_shown_at = today;
        api(`/api/highlights/${h.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ last_shown_at: today }),
        }).catch(() => {});
      }
    }
  }

  function renderReviewTab() {
    const container = $('#review-list');
    container.innerHTML = '';

    const items = state.reviewMode === 'today'
      ? state.reviewSet
      : state.highlights.filter((h) => h.starred);

    if (items.length === 0) {
      container.innerHTML = state.reviewMode === 'today'
        ? '<div class="empty-state">No starred highlights yet — star some in All Highlights to build your review queue.</div>'
        : '<div class="empty-state">No starred highlights yet.</div>';
      return;
    }

    for (const h of items) {
      container.appendChild(renderCard(h, { showBook: true }));
    }
  }

  initPinGate();
})();
