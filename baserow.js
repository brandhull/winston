'use strict';

const BASE_URL = process.env.BASEROW_API_URL || 'https://api.baserow.io';
const TABLE_ID = process.env.BASEROW_TABLE_ID;
const SYNC_TABLE_ID = process.env.BASEROW_SYNC_TABLE_ID;
const TOKEN = process.env.BASEROW_API_TOKEN;

function assertConfigured() {
  if (!TOKEN) throw new Error('BASEROW_API_TOKEN is not set (check your .env file)');
  if (!TABLE_ID) throw new Error('BASEROW_TABLE_ID is not set (check your .env file)');
}

function headers() {
  return {
    Authorization: `Token ${TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/** Fetch every existing highlight_uid already in the table, for dedup. */
async function fetchExistingUids() {
  assertConfigured();
  const uids = new Set();
  let url = `${BASE_URL}/api/database/rows/table/${TABLE_ID}/?user_field_names=true&size=200`;

  while (url) {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      throw new Error(`Baserow list rows failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    for (const row of data.results) {
      if (row.highlight_uid) uids.add(row.highlight_uid);
    }
    // Baserow returns `next` as http:// even when queried over https; that
    // scheme downgrade makes fetch() drop the Authorization header on redirect.
    url = data.next ? data.next.replace(/^http:/, 'https:') : null;
  }

  return uids;
}

/** Batch-insert rows. `rows` is an array of objects keyed by field name. */
async function insertRows(rows) {
  assertConfigured();
  if (rows.length === 0) return;

  const CHUNK_SIZE = 100;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const res = await fetch(
      `${BASE_URL}/api/database/rows/table/${TABLE_ID}/batch/?user_field_names=true`,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ items: chunk }),
      }
    );
    if (!res.ok) {
      throw new Error(`Baserow batch insert failed: ${res.status} ${await res.text()}`);
    }
  }
}

/** Fetch the single Sync Status row. */
async function getSyncStatus() {
  assertConfigured();
  if (!SYNC_TABLE_ID) throw new Error('BASEROW_SYNC_TABLE_ID is not set (check your .env file)');

  const res = await fetch(
    `${BASE_URL}/api/database/rows/table/${SYNC_TABLE_ID}/?user_field_names=true&size=1`,
    { headers: headers() }
  );
  if (!res.ok) {
    throw new Error(`Baserow sync-status fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.results[0];
}

/** Patch the single Sync Status row. `fields` is keyed by field name. */
async function setSyncStatus(rowId, fields) {
  assertConfigured();
  if (!SYNC_TABLE_ID) throw new Error('BASEROW_SYNC_TABLE_ID is not set (check your .env file)');

  const res = await fetch(
    `${BASE_URL}/api/database/rows/table/${SYNC_TABLE_ID}/${rowId}/?user_field_names=true`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(fields),
    }
  );
  if (!res.ok) {
    throw new Error(`Baserow sync-status update failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

module.exports = { fetchExistingUids, insertRows, getSyncStatus, setSyncStatus };
