#!/usr/bin/env node
'use strict';

// PR-only selector for expensive browser checks. Unknown/shared paths fail open.
// No generated test is deleted: main pushes and manual dispatch run every check.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..'); // Resolves tracked test dependencies inside this checkout.
const TESTS = Object.freeze({
  regression: {
    substance: { file: 'scripts/test-substance-cover-shell.js', tags: ['substance', 'ruin', 'foliage'] },
    fire: { file: 'scripts/verify-dungeon-fire-three.js', tags: ['fire', 'ruin'] },
    clothing: { file: 'scripts/test-clothing-fit-runtime-browser.js', tags: ['appearance'] },
    music: { file: 'scripts/music-lab-arpeggio-meter-browser.js', tags: ['music'] },
    camera: { file: 'scripts/test-camera-occlusion-bounded-rays.js', tags: ['camera'] },
    interior: { file: 'scripts/test-interior-editor-exit-browser.js', tags: ['interior'] },
    foliage: { file: 'scripts/test-surface-foliage-styles-browser.js', tags: ['foliage'] },
    root_mechanism: { file: 'scripts/test-root-mechanism-runtime-browser.js', tags: ['ruin', 'root'] },
    stone_age: { file: 'scripts/test-stone-age-multiroom-browser.js', tags: ['ruin'] },
    root_author: { file: 'scripts/test-root-snare-author-browser.js', tags: ['root'] },
    controller_modal: { file: 'scripts/test-controller-ui-modal-pin.js', tags: ['ui'] },
    farmwork: { file: 'scripts/test-farmwork-controller-browser.js', tags: ['farm', 'ui'] },
    mastery: { file: 'scripts/test-controller-mastery-inventory-browser.js', tags: ['ui', 'weapon'] },
    modular: { file: 'scripts/test-modular-editor-ui-browser.js', tags: ['weapon'] },
    multisprite: { file: 'scripts/test-multi-sprite-weapon-browser.js', tags: ['weapon', 'appearance'] },
    statue: { file: 'scripts/test-statue-pose-bake-browser.js', tags: ['weapon', 'appearance'] }, // The original Attack Editor and furniture pipeline are shared with this UI.
    omgurku_cal: { file: 'scripts/test-omgurku-calibration-browser.js', tags: ['omgurku'] },
    omgurku_game: { file: 'scripts/test-omgurku-gameplay-browser.js', tags: ['omgurku'] },
    omgurku_tribe: { file: 'scripts/test-omgurku-tribe-browser.js', tags: ['omgurku'] },
  },
  ruin: {
    root_tear: { file: 'scripts/test-hachutu-root-tear-browser.js', tags: ['root'] },
    hachutu: { file: 'scripts/test-hachutu-root-ruin-browser.js', tags: ['root', 'ruin'] },
    collision: { file: 'scripts/test-dev-random-ruin-collision-browser.js', tags: ['ruin'] },
    construction: { file: 'scripts/test-ruin-construction-browser.js', tags: ['ruin'] },
    lab: { file: 'scripts/smoke-dev-ruin-single-room-browser.js', tags: ['ruin'] },
    seed: { file: 'scripts/test-dev-random-ruin-browser.js', tags: ['ruin'] },
    audit: { file: 'scripts/test-dev-random-ruin-browser.js', tags: ['ruin'] },
  },
});
const CHROMIUM = new Set(Object.keys(TESTS.regression).filter(id => !['substance', 'fire', 'camera'].includes(id)));
// Existing specialist workflows share the PR diff selector instead of each
// maintaining an overbroad "docs/**" event filter.
const FEATURE_PATHS = Object.freeze({
  integrated: Object.freeze([
    /^docs\/js\/(?:climb-|cliff-|player-jump|dev-random-ruin-|dev-ruin-|ruin-|shaft-|dungeon-|puzzle-cave-|cloud-forest-fog)/,
    /^scripts\/test-(?:climb-|cliff-|fall-system|player-jump|dev-random-ruin-|ruin-|find-the-blocks|kanthic-|shaft-|overlay-only-lighting|puzzle-cave-)/,
    /^docs\/config\/(?:ruin|dungeon|puzzle-cave|cliff)/,
    /^\.github\/workflows\/check-integrated-ruin-puzzles\.yml$/,
  ]),
  lighting: Object.freeze([
    /^docs\/js\/(?:ruin-multifloor-v50-style|ruin-shaft-connector|ruin-layer-playable|ruin-v50-native-floors|cloud-forest-fog|ruin-rope-torches|dungeon-fire-[^/]+)\.js$/,
    /^scripts\/test-(?:shaft-hub|kanthic-shaft-firelight|overlay-only-lighting|ruin-rope-torches)\.js$/,
    /^\.github\/workflows\/check-kanthic-shaft-lighting\.yml$/,
  ]),
  furniture: Object.freeze([
    /^docs\/js\/(?:furniture-|authored-furniture-)/,
    /^docs\/tools\/furniture-avatar-author\//,
    /^docs\/config\/furniture-authored\//,
    /^scripts\/test-furniture-/,
    /^\.github\/workflows\/furniture-tile-span\.yml$/,
  ]),
  puzzle_cave: Object.freeze([
    /^docs\/js\/(?:puzzle-cave-|cave-site-system\.js$|ruin-layer-challenges\.js$|persistent-ground-fire\.js$|alchemy-flasks\.js$|shattercasks\.js$|cliff-route-network\.js$|climb-system\.js$|area-footprint-blockers\.js$|locale-cliff-wall-mounts\.js$)/,
    /^scripts\/(?:test-puzzle-cave-|smoke-puzzle-caves-browser\.js$|test-cliff-startup-parse\.js$|test-game-shop-stock-startup-order\.js$)/,
    /^docs\/config\/(?:puzzle-cave|cave-|ruin-.*puzzle)/,
    /^\.github\/workflows\/smoke-puzzle-caves\.yml$/,
  ]),
});

const FEATURE_WORKFLOWS = Object.freeze({
  integrated: '.github/workflows/check-integrated-ruin-puzzles.yml',
  lighting: '.github/workflows/check-kanthic-shaft-lighting.yml',
  furniture: '.github/workflows/furniture-tile-span.yml',
  puzzle_cave: '.github/workflows/smoke-puzzle-caves.yml',
}); // The workflow's actual invoked tests are the source of truth for its static dependencies.

function featureWorkflowDependencies(id) {
  const workflow = FEATURE_WORKFLOWS[id]; // Owned workflow from which we discover direct regression-test files.
  const source = fs.readFileSync(path.join(ROOT, workflow), 'utf8');
  const testFiles = [...source.matchAll(/\bnode\s+(scripts\/[\w/-]+\.js)\b/g)].map(match => match[1]); // Scans only executable test commands, not arbitrary YAML comments.
  if (!testFiles.length) throw new Error('Cannot discover tests for ' + workflow);
  const dependencies = new Set([workflow]); // Editing the workflow itself always selects its check.
  for (const file of testFiles) {
    for (const dependency of sourceDependencies(file)) dependencies.add(dependency); // Reuses existing transitive source scanner, including literal read('docs/js/...') references.
  }
  return dependencies;
}

function independentFeatureFile(file) {
  if (/^scripts\/(?:test-|smoke-|verify-)/.test(file)) return true; // Specific workflow tests are already included in its dependency set.
  if (/^docs\/js\/(?:clothing-|cosmetic-|appearance-|species-rig-|rig-editor-)/.test(file)) return true; // Cosmetic/weaving implementations cannot affect physical ruin/furniture/puzzle generation.
  if (/^docs\/(?:config|assets)\/(?:cosmetics|clothing|patterns)\//.test(file)) return true; // Authored clothing art does not trigger the four environmental checks.
  if (file.startsWith('.github/workflows/')) return true; // Workflow-local changes match FEATURE_PATHS; other workflows do not affect these jobs.
  return false;
}

function selectFeatureChecks(changedFiles, options = {}) {
  const files = [...new Set(changedFiles.map(normalize))].sort(); // Deterministic PR reasons for specialist jobs.
  const affected = Object.fromEntries(Object.keys(FEATURE_PATHS).map(id => [id, []])); // Only relevant tests earn a runner.
  const dependencies = {}; // Contains the workflow's actual test-source edges so cross-system lighting, caves and furniture are not silently missed.
  let dependencyScanFailed = false; // A missing/invalid workflow or test scan must run every specialist rather than skip an unexamined dependency.
  for (const id of Object.keys(FEATURE_PATHS)) {
    try { dependencies[id] = featureWorkflowDependencies(id); }
    catch (error) { dependencyScanFailed = true; dependencies[id] = new Set(); }
  }
  const knownFeatureFile = file => Object.keys(FEATURE_PATHS).some(id =>
    FEATURE_PATHS[id].some(pattern => pattern.test(file)) || dependencies[id].has(file)); // Includes both broad runtime categories and exact test imports.
  const shared = files.filter(file =>
    file === 'docs/index.html' || file === 'docs/game.js'
    || file === 'scripts/ci-select-tests.js' || file === 'scripts/test-ci-select-tests.js'
    || (file.startsWith('docs/') && !knownFeatureFile(file) && !independentFeatureFile(file))); // Unknown gameplay configs, art and runtime modules fail open, but known clothing edits stay isolated.
  const full = !!options.full || shared.length > 0 || dependencyScanFailed; // Manual or unreadable graphs run all; cache-only files were excluded earlier.
  for (const file of files) {
    for (const [id, patterns] of Object.entries(FEATURE_PATHS)) {
      if (patterns.some(pattern => pattern.test(file)) || dependencies[id].has(file)) affected[id].push(file);
    }
  }
  const selected = Object.fromEntries(Object.keys(FEATURE_PATHS).map(id => [id, full || affected[id].length > 0])); // Used by GitHub job-level conditions.
  const reasons = Object.fromEntries(Object.keys(FEATURE_PATHS).map(id => [id, full ? ['manual run or shared game dependency'] : affected[id]]));
  return { suite: 'feature', files, full, tags: [], selected, output: { ...selected }, reasons };
}


function normalize(file) {
  return path.posix.normalize(String(file).replace(/\\/g, '/').replace(/^\.\//, ''));
}

// Dynamic browser globals cannot be inferred safely from require(): this
// conservative classification supplements, rather than replaces, static edges.
function categories(file) {
  if (/^scripts\/ci-select-tests\.js$|^scripts\/test-ci-select-tests\.js$/.test(file)) return ['all'];
  if (/^\.github\/workflows\/(regression-suite|smoke-dev-random-ruin-full)\.yml$/.test(file)) return ['all'];
  if (file === 'docs/index.html' || file === 'docs/game.js') return ['all'];
  if (/^scripts\/(?:test-|smoke-|verify-|run-tests\.js|check-cache-busts\.js)/.test(file)) return ['test-only'];
  if (/^docs\/tools\/debris-ifier\//.test(file)) return ['ruin'];
  if (/^docs\/config\/furniture-authored\/ruinPillarBridge\.json$/.test(file)) return ['ruin'];
  if (!file.startsWith('docs/js/')) return ['all'];
  const name = path.posix.basename(file);
  if (/^(?:dev-hachutu-|hachutu-|root-snare-|root-growth-)/.test(name)) return ['root'];
  if (/^root-mechanism-/.test(name)) return ['root', 'ruin'];
  if (/^(?:dungeon-fire-|persistent-ground-fire)/.test(name)) return ['ruin', 'fire'];
  if (/^(?:dev-random-ruin-|ruin-|shaft-|cell-grid-3d|dungeon-|cave-|puzzle-cave-)/.test(name)) return ['ruin'];
  if (/^(?:kurraya-|flute-|music-|arpeggio-|metronome-)/.test(name)) return ['music', 'ruin'];
  if (/^(?:substance-|surface-foliage-|surface-growth-|foliage-)/.test(name)) return ['substance', 'foliage', 'ruin'];
  if (/^(?:clothing-|cosmetic-|appearance-|species-rig-|rig-editor-)/.test(name)) return ['appearance'];
  if (/^(?:camera-)/.test(name)) return ['camera', 'ruin'];
  if (/^(?:interior-editor-|interior-furniture-)/.test(name)) return ['interior'];
  if (/^(?:farmwork-|farm-editor-|crop-|harvest-)/.test(name)) return ['farm'];
  if (/^(?:omgurku-|barbarian-|porakaneki-)/.test(name)) return ['omgurku'];
  if (/^(?:modular-|multi-sprite-|weapon-author-)/.test(name)) return ['weapon'];
  if (/^(?:controller-|action-bar-|input-)/.test(name)) return ['ui', 'farm', 'weapon', 'ruin', 'omgurku'];
  // An unclassified runtime module could be read through window globals.
  return ['all'];
}

// Static require/import/read-file edges are traversed transitively. Runtime
// window globals remain covered by the explicit conservative tags above.
function sourceDependencies(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const absolute = path.resolve(ROOT, file);
  if (!absolute.startsWith(ROOT + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return seen;
  if (!/\.(?:js|cjs|mjs)$/.test(file)) return seen;
  const src = fs.readFileSync(absolute, 'utf8');
  const references = [];
  for (const match of src.matchAll(/(?:require\s*\(|from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)) references.push(match[1]);
  for (const match of src.matchAll(/['"](docs\/(?:js|config|tools)\/[^'"?#]+\.(?:js|json|html))['"]/g)) references.push(match[1]);
  for (const ref of references) {
    if (!ref.startsWith('.') && !ref.startsWith('docs/')) continue;
    const candidate = normalize(ref.startsWith('.') ? path.posix.join(path.posix.dirname(file), ref) : ref);
    for (const resolved of [candidate, candidate + '.js', path.posix.join(candidate, 'index.js')]) {
      if (fs.existsSync(path.resolve(ROOT, resolved))) { sourceDependencies(resolved, seen); break; }
    }
  }
  return seen;
}

function selectTests(suite, changedFiles, options = {}) {
  const tests = TESTS[suite];
  if (!tests) throw new Error(`Unknown CI test suite: ${suite}`);
  const files = [...new Set(changedFiles.map(normalize))].sort(); // Stable reasons for PR annotations and unit tests.
  const full = !!options.full || files.length === 0 || files.some(file => categories(file).includes('all'));
  const tags = new Set(files.flatMap(categories));
  const reasons = {};
  const selected = {};
  for (const [id, test] of Object.entries(tests)) {
    const deps = sourceDependencies(test.file);
    const relevant = files.filter(file => deps.has(file) || test.tags.some(tag => categories(file).includes(tag)));
    selected[id] = full || relevant.length > 0;
    reasons[id] = full ? ['full coverage (manual/main/unknown dependency)'] : relevant;
  }
  const active = Object.entries(selected).filter(([, enabled]) => enabled).map(([id]) => id);
  const output = { ...selected };
  if (suite === 'regression') {
    output.needs_browser = active.some(id => CHROMIUM.has(id));
    output.needs_deps = active.length > 0;
  } else {
    output.needs_browser = active.length > 0;
  }
  return { suite, files, full, tags: [...tags].sort(), selected, output, reasons };
}

function onlyCacheBustChanged(before, after) {
  const strip = source => source.replace(/\?v=[A-Za-z0-9._-]+/g, '?v=CI_CACHE_TOKEN'); // Covers HTML attributes and JS loader URLs.
  return before !== after && strip(before) === strip(after);
}

function withoutCacheBusts(files, readVersions) {
  return files.filter(file => {
    if (file !== 'docs/index.html' && !/^docs\/(?:js\/.*\.js|game\.js)$/.test(file)) return true;
    try {
      const versions = readVersions(file); // Compare actual prior and updated source, not just the filename.
      return !onlyCacheBustChanged(versions.before, versions.after);
    } catch (_) { return true; } // Missing ref or unreadable file conservatively runs its tests.
  });
}

function changedOnPR() {
  const base = process.env.CI_BASE_SHA || '';
  if (!/^[0-9a-f]{40}$/i.test(base)) throw new Error('Missing or invalid PR base SHA');
  try { execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: ROOT, stdio: 'pipe' }); }
  catch { execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], { cwd: ROOT, stdio: 'pipe' }); }
  const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '--diff-filter=ACDMRTU', '-z', base, 'HEAD'],
    { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean);
  return withoutCacheBusts(files, file => ({
    before: execFileSync('git', ['show', base + ':' + file], { cwd: ROOT }).toString('utf8'),
    after: fs.readFileSync(path.join(ROOT, file), 'utf8'),
  })); // Ignore inert index and loader query-token bumps while honoring substantive changes.
}

function emit(result) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      Object.entries(result.output).map(([id, value]) => `${id}=${value ? 'true' : 'false'}\n`).join(''));
  }
  const lines = [`### ${result.suite} test selection`, '',
    `Mode: **${result.full ? 'full coverage' : 'dependency-aware'}**`,
    `Changed files: ${result.files.length ? result.files.map(file => String.fromCharCode(96) + file + String.fromCharCode(96)).join(', ') : 'unknown'}`, '',
    '| Check | Run? | Why |', '| --- | --- | --- |'];
  for (const [id, enabled] of Object.entries(result.selected)) {
    const why = enabled ? (result.reasons[id].slice(0, 3).map(p => String.fromCharCode(96) + p + String.fromCharCode(96)).join(', ') || 'shared dependency') : 'unrelated';
    lines.push(`| ${id} | ${enabled ? 'yes' : 'skip'} | ${why} |`);
  }
  lines.push('');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  console.log(lines.join('\n'));
}

if (require.main === module) {
  const suite = process.argv.find(arg => arg.startsWith('--suite='))?.slice('--suite='.length);
  if (!TESTS[suite] && suite !== 'feature') { console.error('Expected --suite=regression, --suite=ruin or --suite=feature'); process.exitCode = 2; }
  else {
    const isPR = process.env.GITHUB_EVENT_NAME === 'pull_request';
    let changedFiles = [], full = !isPR;
    if (isPR) {
      try { changedFiles = changedOnPR(); }
      catch (error) { full = true; console.warn(`Cannot safely determine PR dependencies: ${error.message}. Running all.`); }
    }
    emit(suite === 'feature' ? selectFeatureChecks(changedFiles, { full }) : selectTests(suite, changedFiles, { full }));
  }
}

module.exports = { TESTS, FEATURE_PATHS, FEATURE_WORKFLOWS, categories, sourceDependencies, featureWorkflowDependencies, selectTests, selectFeatureChecks, onlyCacheBustChanged, withoutCacheBusts };
