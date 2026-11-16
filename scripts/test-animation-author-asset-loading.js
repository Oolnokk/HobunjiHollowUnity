#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Guards the commit-pinned editor's runtime boot sequence.
const portrait = fs.readFileSync('docs/js/portrait-utils.js', 'utf8'); // Exercises the shipped image loader, not a separate URL implementation.
const breathing = fs.readFileSync('docs/js/portrait-breathing.js', 'utf8'); // The selected revision's auto-initialized breathing composer.
const loggedAssets = [
  'docs/config/animations/breathing-default.json',
  'docs/assets/portraitsprites/expressions/mouth/neutral_kenkari.png',
  'docs/assets/cosmetics/appearance/mao-ao/headhair/tuft-front_mint.png',
  'docs/assets/cosmetics/appearance/mao-ao/headhair/braidcluster-R.png',
  'docs/assets/portraitsprites/arm-L_mashtz_m.png',
  'docs/assets/cosmetics/clothes/overwear/portrait/tankanbodywrap_mashtz_m.png',
  'docs/assets/cosmetics/clothes/torso/portrait/bandolier1_kenk_m.png',
]; // The exact files reported as 404 by the commit-pinned editor.
for (const path of loggedAssets) assert(fs.existsSync(path), 'Asset missing from repository: ' + path);

assert.match(html, /const assetBase = rawUrl\(settings\.docsRoot \+ 'assets\/'\)/,
  'portraits must use immutable GitHub raw as primary instead of a possibly stale CDN');
assert.match(html, /const configBase = rawUrl\(settings\.docsRoot \+ 'config\/'\)/,
  'cosmetic configs must come from the same commit as portrait assets');
assert.match(html, /const docsBase = rawUrl\(settings\.docsRoot\)/,
  'creature compositor paths must also use the selected raw revision');
assert.match(html, /path => rawUrl\(settings\.docsRoot \+ path\)/,
  'rig-preview creature registry must use the same pinned repository paths');

const prepareStart = html.indexOf('function prepareRepositoryScript(');
const prepareEnd = html.indexOf('async function executeClassicScript(', prepareStart);
assert(prepareStart > 0 && prepareEnd > prepareStart, 'runtime loader source extraction');
const prepare = new Function('rawUrl', 'cdnUrl', 'CREATURE_RENDER_SCRIPT', 'location',
  html.slice(prepareStart, prepareEnd) + '; return prepareRepositoryScript;')(
  path => 'https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/TEST_COMMIT/' + path,
  path => 'https://cdn.jsdelivr.net/gh/Oolnokk/HobunjiHollowUnity@TEST_COMMIT/' + path,
  'js/creature-genetics-render.js', { href: 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/TEST_COMMIT/docs/tools/animation-author/index.html' }
);
const prepared = prepare(breathing, 'js/portrait-breathing.js', { docsRoot: 'docs/' });
assert.match(prepared, /const candidates = \["https:\/\/raw\.githubusercontent\.com\/Oolnokk\/HobunjiHollowUnity\/TEST_COMMIT\/docs\/config\/"\]/,
  'breathing auto-init must resolve from root, not tools/animation-author/docs/config');
assert.doesNotMatch(prepared, /if \(cfgBase\) candidates\.unshift\(cfgBase\)/,
  'stale gameplay-local config path must not override the editor pin');
assert.equal(new URL('animations/breathing-default.json',
  'https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/TEST_COMMIT/docs/config/').pathname,
  '/Oolnokk/HobunjiHollowUnity/TEST_COMMIT/docs/config/animations/breathing-default.json');

const readyStart = html.indexOf('async function onAnimationRepositoryReady()');
const readyEnd = html.indexOf('async function initAnimationWorkspaceScene()', readyStart);
const ready = html.slice(readyStart, readyEnd);
assert.match(ready, /await importAnimationProjectData\(pending, \{ fromAutosave: true \}\)/,
  'autosave restore path still exists');
assert.match(ready, /\}\s*else \{\s*setStatus\(.+Animation library ready[\s\S]*?\}\s*hideOverlay\(\);/,
  'loading overlay must close after restored autosaves as well as empty startup');
assert.match(html, /boundedEditorLoad\(loadRepositoryRuntime\(settings\)/,
  'runtime initialization must have a finite deadline');
assert.match(html, /boundedEditorLoad\(window\.MultiAvatarAnimationAuthor\.repositoryReady\(\)/,
  'workspace initialization must have a finite deadline');

const debug = { requests: 0, timeouts: 0, slowLoads: 0, longestLoadMs: 0, slowestAsset: null, failures: 0, cacheHits: 0, pendingHits: 0, retries: 0, recoveries: 0 };
const seen = []; // Captures the two mirrors actually requested by the production image loader.
class FakeImage {
  set src(url) {
    this.url = url;
    seen.push(url);
    if (url.startsWith('https://raw.githubusercontent.com/')) queueMicrotask(() => this.onload?.());
  }
}
const patchedPortrait = prepare(portrait, 'js/portrait-utils.js', { docsRoot: 'docs/' }); // The editor's dynamically loaded runtime is intentionally bounded without changing game.js.
assert.notEqual(patchedPortrait, portrait, 'editor should install a bounded image loader');
assert.match(patchedPortrait, /Portrait image timeout \(15s\)/, 'portrait editor shim must report the failing URL');
const repositoryStart = patchedPortrait.indexOf('function portraitRepositoryUrlCandidates(');
const repositoryEnd = patchedPortrait.indexOf('// ── CSS filter helpers', repositoryStart);
assert(repositoryStart > 0 && repositoryEnd > repositoryStart);
const runSource = patchedPortrait.slice(repositoryStart, repositoryEnd) + '; return { loadImg };';
const cdnRoot = 'https://cdn.jsdelivr.net/gh/Oolnokk/HobunjiHollowUnity@TEST_COMMIT/docs/assets/';
const timeouts = new Set(); // Advances stalled image timers quickly without waiting 15 seconds in CI.
const setTimeoutFast = fn => { const timer = setTimeout(fn, 2); timeouts.add(timer); return timer; };
const clearTimeoutFast = timer => { clearTimeout(timer); timeouts.delete(timer); };
const { loadImg } = new Function('Image','URL','document','_puAssetBase','IMG_CACHE','portraitImageLoadDebug',
  'PORTRAIT_IMAGE_RETRY_BASE_MS','PORTRAIT_IMAGE_RETRY_MAX_MS','PORTRAIT_IMAGE_REQUEST_TIMEOUT_MS',
  'setTimeout','clearTimeout',runSource)(
  FakeImage, URL, { baseURI: 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/TEST_COMMIT/docs/tools/animation-author/index.html' },
  cdnRoot, new Map(), debug, 1000, 30000, 15000, setTimeoutFast, clearTimeoutFast
);

(async () => {
  const image = await loadImg('portraitsprites/expressions/mouth/neutral_kenkari.png');
  assert(image instanceof FakeImage, 'a hung CDN image must recover through the matching GitHub raw URL');
  assert(seen[0].startsWith(cdnRoot), 'first attempted URL is the configured CDN');
  assert(seen.some(url => url.startsWith('https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/TEST_COMMIT/docs/assets/')),
    'fallback must retain the same commit instead of borrowing main');
  assert.equal(debug.timeouts, 1, 'a silent image stall must register in the existing portrait diagnostics');
  assert.equal(timeouts.size, 0, 'image request timers must be released on load/fail');

  const mainStart = html.indexOf('<script>\n(() => {'), mainEnd = html.indexOf('\n})();\n</script>', mainStart);
  assert(mainStart > 0 && mainEnd > mainStart);
  new Function(html.slice(mainStart + '<script>\n'.length, mainEnd) + '\n})();');
  console.log('Animation Author asset base, breathing JSON, timed image fallback and overlay restore regression passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
