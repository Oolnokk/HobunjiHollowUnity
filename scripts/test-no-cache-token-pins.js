#!/usr/bin/env node
'use strict';

// Tests must not pin an exact ?v=<token> cache-bust string.
//
// Every edit to a docs/ module bumps its token (see scripts/check-cache-busts.js),
// so a test that asserts one exact `foo.js?v=<token>` string breaks the moment any
// later PR touches foo.js, even though nothing it tests changed. That produced
// hundreds of "Refresh … cache regression" / "Stop pinning … cache token" commits.
//
// To assert that a module is loaded, match any token instead:
//   assert.match(index, /music-system\.js\?v=[A-Za-z0-9_-]+/);
//
// The files below predate this check and are grandfathered at their current
// count. The count may only go down: unpin one and lower (or delete) its entry.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GRANDFATHERED = {
  'test-clothing-weaving-system.js': 1,
  'test-controller-input-authority.js': 1,
  'test-force-tothal-shift-regeneration.js': 1,
  'test-music-track-gain-settings.js': 1,
  'test-natural-surface-loader-cache.js': 1,
  'test-stable-animal-training-refinements.js': 1,
  'test-wilderness-map-load-recovery.js': 1,
};

// Built from pieces so this file doesn't match itself.
const PIN = new RegExp('\\?v' + '=[A-Za-z0-9]', 'g');

const failures = [];
for (const name of fs.readdirSync(__dirname).filter(n => /^test-.*\.js$/.test(n)).sort()) {
  const count = (fs.readFileSync(path.join(__dirname, name), 'utf8').match(PIN) || []).length;
  const allowed = GRANDFATHERED[name] || 0;
  if (count > allowed) {
    failures.push(`${name}: ${count} exact ?v= token pin(s)${allowed ? ` (grandfathered at ${allowed})` : ''}`);
  }
}

assert.deepEqual(failures, [], 'Match any cache token (e.g. /foo\\.js\\?v=[A-Za-z0-9_-]+/) instead of pinning one:\n  ' + failures.join('\n  '));
console.log('ok: no new exact cache-token pins in scripts/test-*.js');
