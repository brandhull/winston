'use strict';

const { runSync } = require('./sync-lib');

runSync({ interactive: true }).catch((err) => {
  console.error(err);
  process.exit(1);
});
