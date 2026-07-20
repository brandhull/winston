'use strict';

const { runSync } = require('./sync-lib');
const { getSyncStatus, setSyncStatus } = require('./baserow');

async function updateSharedStatus(fields) {
  try {
    const row = await getSyncStatus();
    if (row) await setSyncStatus(row.id, fields);
  } catch (err) {
    // Sync Status table is a nice-to-have for the web app; don't let a
    // problem with it mask the real sync result in this CLI's exit code.
    console.error('(could not update shared sync status)', err.message || err);
  }
}

async function main() {
  try {
    await runSync({ interactive: true });
    await updateSharedStatus({
      status: 'idle',
      last_synced_at: new Date().toISOString(),
      last_error: '',
    });
  } catch (err) {
    await updateSharedStatus({ status: 'error', last_error: err.message || String(err) });
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
