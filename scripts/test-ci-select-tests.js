#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { selectTests, selectFeatureChecks, sourceDependencies, onlyCacheBustChanged, withoutCacheBusts } = require('./ci-select-tests.js');

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

test('static graph follows transitive require and literal browser-source references', () => {
  const root = path.resolve(__dirname, '..'); // Base for disposable dependency fixtures.
  const fixtureA = 'scripts/ci-selector-fixture-entry.js'; // Test entry depends on the intermediate module.
  const fixtureB = 'scripts/ci-selector-fixture-leaf.js'; // Intermediate module names the actual browser source.
  const fixtureC = 'docs/js/ci-selector-fixture-source.js'; // Transitive target represents a served runtime module.
  try {
    fs.writeFileSync(path.join(root, fixtureA), "require('./ci-selector-fixture-leaf.js');\n");
    fs.writeFileSync(path.join(root, fixtureB), "const target = 'docs/js/ci-selector-fixture-source.js';\n");
    fs.writeFileSync(path.join(root, fixtureC), "module.exports = true;\n");
    const dependencies = sourceDependencies(fixtureA); // Verifies recursive traversal across both reference types.
    assert(dependencies.has(fixtureB));
    assert(dependencies.has(fixtureC));
  } finally {
    for (const file of [fixtureA, fixtureB, fixtureC])
      fs.rmSync(path.join(root, file), { force: true });
  }
});

test('cache-bust-only HTML changes do not force global runtime coverage', () => {
  const before = '<script src="js/ruin-layer-playable.js?' + 'v=old"></script>\n';
  const after = '<script src="js/ruin-layer-playable.js?' + 'v=new"></script>\n';
  assert.equal(onlyCacheBustChanged(before, after), true);
  assert.equal(onlyCacheBustChanged(before, after.replace('script', 'style')), false);
  assert.equal(onlyCacheBustChanged(before, before), false);
});

test('weaving changes only select weaving tests, not ruin/furniture/puzzle workflows', () => {
  const loaderFile = 'docs/js/combat/combat-config-loader.js'; // Changed only to point at the new weaving revision.
  const indexFile = 'docs/index.html'; // Cache-busted HTML is not a material game entry-point edit.
  const changed = ['docs/js/clothing-weaving-system.js', 'scripts/test-clothing-weaving-system.js', indexFile, loaderFile];
  const versions = {
    [indexFile]: ['<script src="js/combat/combat-config-loader.js?v=old"></script>', '<script src="js/combat/combat-config-loader.js?v=new"></script>'],
    [loaderFile]: ["const url = 'js/clothing-weaving-system.js?v=old';", "const url = 'js/clothing-weaving-system.js?v=new';"],
  }; // A real weaving PR touches both loader tiers without altering their behavior.
  const material = withoutCacheBusts(changed, file => {
    const [before, after] = versions[file]; // Supplied only for candidate HTML/JS files; the weaving test script remains unchanged in the list.
    return { before, after };
  });
  assert.deepEqual(material, changed.slice(0, 2));
  const selected = selectFeatureChecks(material);
  assert.equal(selected.full, false);
  assert.deepEqual(selected.output, { integrated: false, lighting: false, furniture: false, puzzle_cave: false });
});

test('feature selector retains each specialist when its real subsystem changes', () => {
  for (const [file, enabled] of [
    ['docs/js/ruin-shaft-connector.js', ['integrated', 'lighting']],
    ['docs/js/puzzle-cave-melody.js', ['integrated', 'puzzle_cave']],
    ['docs/js/climb-system.js', ['integrated', 'puzzle_cave']],
    ['docs/js/furniture-tile-span.js', ['furniture']],
    ['scripts/test-furniture-tile-span.js', ['furniture']],
    ['docs/tools/furniture-avatar-author/tile-span-author.js', ['furniture']],
    ['scripts/test-puzzle-cave-fire.js', ['integrated', 'puzzle_cave']],
    ['docs/js/ruin-rope-torches.js', ['integrated', 'lighting']],
    ['.github/workflows/smoke-puzzle-caves.yml', ['puzzle_cave']],
  ]) {
    const selected = selectFeatureChecks([file]); // Each fixture is a real workflow dependency, not a synthetic category.
    assert.deepEqual(Object.entries(selected.output).filter(([, run]) => run).map(([id]) => id), enabled, file);
  }
});

test('uncertain game-wide edits and manual dispatch fail open to every specialist', () => {
  for (const files of [['docs/game.js'], ['docs/index.html'], ['docs/js/new-unclassified-runtime.js'], ['scripts/ci-select-tests.js']]) {
    const selected = selectFeatureChecks(files);
    assert.equal(selected.full, true, files.join(', '));
    assert(Object.values(selected.output).every(Boolean));
  }
  assert(Object.values(selectFeatureChecks([], { full: true }).output).every(Boolean), 'manual dispatch runs all checks');
});

test('actual code changes and failed version reads are never mistaken for inert cache bumps', () => {
  const html = 'docs/index.html'; // An entry-point script change must run all specialists.
  const oldHtml = '<script src="js/ruin-layer-playable.js?v=old"></script>';
  const changedHtml = '<script src="js/clothing-weaving-system.js?v=new"></script>';
  assert.deepEqual(withoutCacheBusts([html], () => ({ before: oldHtml, after: changedHtml })), [html]);
  assert.deepEqual(withoutCacheBusts([html], () => { throw Error('missing base'); }), [html]);
  assert.deepEqual(withoutCacheBusts(['docs/js/combat/combat-config-loader.js'],
    () => ({ before: "start('cloth?v=old')", after: "start('other?v=new')" })), ['docs/js/combat/combat-config-loader.js']);
  assert.equal(onlyCacheBustChanged("const x = 'cloth?v=old';", "const x = 'cloth?v=new';"), true);
});

test('specialist workflows use conditional jobs, not pending-prone workflow path filters', () => {
  for (const [filename, job, key] of [
    ['check-integrated-ruin-puzzles.yml', 'integration', 'integrated'],
    ['check-kanthic-shaft-lighting.yml', 'lighting', 'lighting'],
    ['furniture-tile-span.yml', 'tile-span', 'furniture'],
    ['smoke-puzzle-caves.yml', 'puzzle-cave-browser', 'puzzle_cave'],
  ]) {
    const yaml = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/', filename), 'utf8'); // Inspects the actual published check wiring.
    assert.match(yaml, /\n  pull_request:\s*\n  workflow_dispatch:/, filename + ' always creates a PR check');
    assert.match(yaml, /run: node scripts\/ci-select-tests\.js --suite=feature/, filename + ' calls the shared selector');
    assert(yaml.includes('steps.select.outputs.' + key), filename + ' routes its correct feature flag');
    assert(yaml.includes('  ' + job + ':\n    needs: impact\n    if:'), filename + ' uses a job-level skip condition');
    assert(yaml.includes("needs.impact.result != 'success'"), filename + ' fails open after a selector failure');
  }
});

test('manual and main events always choose the full suite', () => {
  assert(Object.values(selectTests('ruin', ['docs/js/dev-random-ruin-hit-puzzles.js'], { full: true }).selected).every(Boolean));
});

test('setup flags distinguish Node/Three checks from Chromium browser checks', () => {
  const noBrowser = selectTests('regression', ['scripts/verify-dungeon-fire-three.js']);
  assert.equal(noBrowser.selected.fire, true);
  assert.equal(noBrowser.output.needs_deps, true);
  assert.equal(noBrowser.output.needs_browser, false);
  const nothing = selectTests('regression', ['scripts/test-unrelated-utility.js']);
  assert.equal(Object.values(nothing.selected).some(Boolean), false);
  assert.equal(nothing.output.needs_deps, false);
  assert.equal(nothing.output.needs_browser, false);
  assert.equal(selectTests('ruin', ['docs/js/root-snare-player-tear.js']).output.needs_browser, true);
});

test('the ruin workflow triggers for all shared ruin, shaft, snare and collision modules', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/smoke-dev-random-ruin-full.yml'), 'utf8');
  for (const scope of ['push:', 'pull_request:']) {
    const block = workflow.split('\n  ' + scope + '\n')[1]?.split(/\n  (?:push|pull_request|workflow_dispatch):/)[0] || '';
    assert(block.includes("paths:"), 'missing ' + scope + ' path filter');
    for (const pattern of [
      'docs/js/dev-random-ruin-*.js', 'docs/js/ruin-*.js', 'docs/js/shaft-*.js',
      'docs/js/root-snare-*.js', 'docs/js/puzzle-cave-*.js',
      'docs/js/dungeon-fire-*.js', 'docs/js/cell-grid-3d.js',
    ]) assert(block.includes("'" + pattern + "'"), scope + ' ignores ' + pattern);
  }
});

test('every conditional browser step is matched by a selector output', () => {
  const specs = [
    ['regression', '.github/workflows/regression-suite.yml'],
    ['ruin', '.github/workflows/smoke-dev-random-ruin-full.yml'],
  ];
  for (const [suite, filename] of specs) {
    const text = fs.readFileSync(path.resolve(__dirname, '..', filename), 'utf8');
    assert(text.includes('--suite=' + suite));
    const allowed = new Set([...Object.keys(selectTests(suite, [], { full: true }).output)]);
    const guardedSteps = [...text.matchAll(/if:\s+steps\.select\.outputs\.([a-z_]+)\s*==\s*'true'/g)];
    const guardedJobs = [...text.matchAll(/if:\s+needs\.smoke\.outputs\.([a-z_]+)\s*==\s*'true'/g)]; // Heavy ruin browser jobs consume the shared selector's explicit outputs.
    const guarded = guardedSteps.concat(guardedJobs);
    assert(guarded.length >= 8, suite + ' must guard expensive checks and separately scheduled browser jobs');
    for (const match of guarded) assert(allowed.has(match[1]), suite + ' has an unknown output: ' + match[1]);
  }
});
