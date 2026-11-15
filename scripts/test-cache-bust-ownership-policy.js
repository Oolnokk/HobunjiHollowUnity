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
]; // These manifests are fetched under ?load=Date.now() by the shipped parser loader.
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
const loader = fs.readFileSync('docs/js/bootstrap/classic-script-group-loader.js', 'utf8'); // Per-navigation cache refresh is the justification for this exception.
assert.match(checker, /if \(isNavigationFreshClassicManifest\(changedFile\)\)/, 'checker uses the exemption before matching same-named child references');
assert.match(loader, /classic-groups\/.*\?load=.*Date\.now\(\)/, 'parser loader fetches manifests fresh on every navigation');
assert.match(checker, /const patterns = refPatterns\(base\)/, 'normal changed runtime modules are still checked against their versioned references');

console.log('Cache-bust ownership policy: fresh manifests exempt; same-named runtime children still protected.');
