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
    portrait_spline: { file: 'scripts/test-portrait-spline-viewer-browser.js', tags: ['portrait_spline'] }, // Browser GPU readback catches the solid-black mobile portrait regression.
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
  if (/^docs\/tools\/portrait-spline-author\//.test(file)) return ['portrait_spline'];
  if (/^docs\/js\/portrait-spline-/.test(file)) return ['portrait_spline'];
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
  const strip = html => html.replace(/(?:src|href)\s*=\s*(['"])[^'"]+\1/g, attr =>
    attr.replace(/\?v=[^'"&#\s]+/g, '?v=CI_CACHE_TOKEN'));
  return before !== after && strip(before) === strip(after);
}

function changedOnPR() {
  const base = process.env.CI_BASE_SHA || '';
  if (!/^[0-9a-f]{40}$/i.test(base)) throw new Error('Missing or invalid PR base SHA');
  try { execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: ROOT, stdio: 'pipe' }); }
  catch { execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], { cwd: ROOT, stdio: 'pipe' }); }
  const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '--diff-filter=ACDMRTU', '-z', base, 'HEAD'],
    { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean);
  if (files.includes('docs/index.html')) {
    // Every JS cache-bust updates index.html; that should not force every
    // unrelated browser check. Any other HTML edit still runs the full suite.
    const before = execFileSync('git', ['show', `${base}:docs/index.html`], { cwd: ROOT }).toString('utf8');
    const after = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');
    if (onlyCacheBustChanged(before, after)) return files.filter(file => file !== 'docs/index.html');
  }
  return files;
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
  if (!TESTS[suite]) { console.error('Expected --suite=regression or --suite=ruin'); process.exitCode = 2; }
  else {
    const isPR = process.env.GITHUB_EVENT_NAME === 'pull_request';
    let changedFiles = [], full = !isPR;
    if (isPR) {
      try { changedFiles = changedOnPR(); }
      catch (error) { full = true; console.warn(`Cannot safely determine PR dependencies: ${error.message}. Running all.`); }
    }
    emit(selectTests(suite, changedFiles, { full }));
  }
}

module.exports = { TESTS, categories, sourceDependencies, selectTests, onlyCacheBustChanged };
