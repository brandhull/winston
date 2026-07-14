'use strict';

const crypto = require('crypto');

/** Stable fingerprint of a highlight, used to prevent duplicate inserts on repeat scrapes. */
function highlightUid(bookTitle, location, text) {
  return crypto
    .createHash('sha256')
    .update(`${bookTitle}|${location}|${text}`)
    .digest('hex');
}

module.exports = { highlightUid };
