#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { selectTests, sourceDependencies, onlyCacheBustChanged } = require('./ci-select-tests.js');

// The selector must neither silently omit unknown changes nor overrun every
// browser smoke for an unrelated narrowly scoped ruin file.
test('ruin glyph runtime affects ruin checks but not unrelated browser checks', () => {
  const regression = selectTests('regression', ['docs/js/dev-random-ruin-hit-puzzles.js']);
  assert.equal(regression.selected.root_mechanism, true);
  assert.equal(regression.selected.stone_age, true);
  assert.equal(regression.selected.clothing, false);
  assert.equal(regression.selected.music, false);
  assert.equal(regression.selected.omgurku_game, false);
  const ruin = selectTests('ruin', ['docs/js/dev-random-ruin-hit-puzzles.js']);
  assert.equal(ruin.selected.construction, true);
  assert.equal(ruin.selected.root_tear, false);
  assert.equal(ruin.selected.audit, true);
});

test('root-only changes spare independent V50 seed loops', () => {
  const result = selectTests('ruin', ['docs/js/root-snare-player-tear.js']);
  assert.equal(result.selected.root_tear, true);
  assert.equal(result.selected.hachutu, true);
  assert.equal(result.selected.seed, false);
  assert.equal(result.selected.collision, false);
});

test('a browser test change runs that test and its static consumers', () => {
  const result = selectTests('ruin', ['scripts/test-ruin-construction-browser.js']);
  assert.equal(result.selected.construction, true);
  assert.equal(result.selected.hachutu, false);
  assert.equal(result.selected.seed, false);
});

test('unknown and shared runtime dependencies fail open', () => {
  for (const changed of [['docs/js/unknown-runtime.js'], ['docs/game.js'], ['docs/index.html'], []]) {
    const result = selectTests('regression', changed);
    assert(result.full);
    assert(Object.values(result.selected).every(Boolean));
  }
  assert(Object.values(selectTests('ruin', ['scripts/ci-select-tests.js']).selected).every(Boolean));
});

test('direct dependency graph includes transitive require and source references', () => {
  const root = path.resolve(__dirname, '..');
  const fixtureA = 'scripts/ci-selector-fixture-entry.js';
  const fixtureB = 'scripts/ci-selector-fixture-leaf.js';
  fs.writeFileSync(path.join(root, fixtureA), "require('./ci-selector-fixture-leaf.js');\n");
  fs.writeFileSync(path.join(root, fixtureB), "module.exports = true;\n");
  try {
    assert(sourceDependencies(fixtureA).has(fixtureB));
  } finally {
    fs.unlinkSync(path.join(root, fixtureA));
    fs.unlinkSync(path.join(root, fixtureB));
  }
});

test('cache-bust-only HTML changes do not force global runtime coverage', () => {
  const before = '<script src="js/ruin-layer-playable.js?v=old"></script>\n';
  const after = '<script src="js/ruin-layer-playable.js?v=new"></script>\n';
  assert.equal(onlyCacheBustChanged(before, after), true);
  assert.equal(onlyCacheBustChanged(before, after.replace('script', 'style')), false);
  assert.equal(onlyCacheBustChanged(before, before), false);
});

test('manual and main events always choose the full suite', () => {
  assert(Object.values(selectTests('ruin', ['docs/js/dev-random-ruin-hit-puzzles.js'], { full: true }).selected).every(Boolean));
});
