#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isNavigationFreshClassicManifest } = require('./cache-bust-ownership-policy.js');

const fresh = [
  'docs/js/bootstrap/classic-groups/farm-buildings.js',
  'docs/js/bootstrap/classic-groups/combat-config.js',
  'docs/js/bootstrap/classic-groups/cooking-runtime.js',
  'docs/js/bootstrap/classic-groups/romance-runtime.js',
]; // These manifests are fetched under a fresh navigation token or an immutable commit-scoped token.
for (const file of fresh) assert.equal(isNavigationFreshClassicManifest(file), true, file + ' needs no own ?v= bump');

const versioned = [
  'docs/js/farm-buildings.js',
  'docs/js/combat/combat-config-loader.js',
  'docs/js/bootstrap/classic-script-group-loader.js',
  'docs/js/bootstrap/classic-groups/farm-buildings-extra.json',
  'docs/js/bootstrap/classic-groups-other/farm-buildings.js',
]; // The normal changed-module cache rule must still guard all real versioned code.
for (const file of versioned) assert.equal(isNavigationFreshClassicManifest(file), false, file + ' must not be exempted');

const checker = fs.readFileSync('scripts/check-cache-busts.js', 'utf8'); // Ensures the production checker actually uses this policy in the changed-file loop.
const loader = fs.readFileSync('docs/js/bootstrap/classic-script-group-loader.js', 'utf8'); // Consumes the preloader token at its original parser slot.
const preloader = fs.readFileSync('docs/js/bootstrap/classic-script-preload.js', 'utf8'); // Mutable URLs stay fresh; immutable commit URLs use stable cache keys.
assert.match(checker, /if \(isNavigationFreshClassicManifest\(changedFile\)\)/, 'checker uses the exemption before matching same-named child references');
assert.match(loader, /classic-groups\/.*\?load=.*manifestToken/, 'parser loader uses the same query as its preloads');
assert.match(loader, /manifestToken.*Date\.now\(\)/, 'standalone parser loader still uses a fresh fallback query');
assert.match(preloader, /pinned \? pinned\[1\]\.toLowerCase\(\) : String\(Date\.now\(\)\)/, 'mutable URLs fetch fresh while pinned commits retain stable queries');
assert.match(checker, /const patterns = refPatterns\(base\)/, 'normal changed runtime modules are still checked against their versioned references');

console.log('Cache-bust ownership policy: fresh manifests exempt; same-named runtime children still protected.');
