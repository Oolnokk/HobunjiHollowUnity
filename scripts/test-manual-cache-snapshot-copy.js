'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../docs/js/manual-cache-snapshot-copy.js'), 'utf8');
const loader = fs.readFileSync(path.resolve(__dirname, '../docs/js/local-save-folder.js'), 'utf8');

assert(loader.includes('js/manual-cache-snapshot-copy.js?v=20260907a'),
  'game bootstrap should load the manual cache snapshot copy helper');
assert(source.includes("HobunjiCacheAudit?.print?.()"),
  'manual Snapshot now replacement must capture a fresh snapshot on click');
assert(source.includes('JSON.stringify(snap, null, 2)'),
  'the exact fresh snapshot should be serialized as readable JSON');
assert(source.includes('navigator.clipboard?.writeText'),
  'manual snapshot should copy automatically through the Clipboard API when available');
assert(source.includes("document.execCommand?.('copy')"),
  'manual snapshot should retain a fallback copy path for browsers without Clipboard API support');
assert(source.includes('cloneNode(true)'),
  'the original console-only anonymous click handler should be replaced rather than double-firing snapshots');
assert(source.includes('new MutationObserver'),
  'helper should wait event-driven for the asynchronously-created performance settings UI');
assert(source.includes('observer?.disconnect?.()'),
  'the UI observer cleanup path must disconnect the observer');
assert(source.includes('window.setTimeout(stopObserver, 15000)'),
  'observer lifetime should be bounded if the performance UI never appears');
assert.equal(source.includes('requestAnimationFrame('), false,
  'manual snapshot copy helper must not add frame-loop work');
assert.equal(source.includes('setInterval('), false,
  'manual snapshot copy helper must not poll');

console.log('PASS manual cache snapshot copy: Snapshot now captures fresh JSON, copies automatically, and installs without polling/frame work.');
