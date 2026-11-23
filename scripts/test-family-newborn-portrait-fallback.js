'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/js/romance-family.js', 'utf8'); // Real family module containing the naming portrait adapter.
const start = source.indexOf('  async function renderPreview(canvas, choice) {'); // Isolates the genuine adapter for deterministic DOM-canvas behavior tests.
const end = source.indexOf('  // The dream is the real character creator', start); // The following function boundary, not a test-side copy of its logic.
assert(start >= 0 && end > start, 'production family naming portrait adapter is present');
const actualFunction = source.slice(start, end); // Production code under test, including async safety checks.
let opacity = 255; // Simulated alpha in the shared renderer's final portrait.
let succeeds = true; // Shared renderer may return false separately from the pixels it paints.
let renderCalls = 0; // Confirms expired naming dialogs do not do unnecessary rendering.
let assetCalls = 0; // Confirms lazy portrait assets are requested before building a profile.
let profile = null; // Last real child appearance sent to the shared renderer.
const browser = {
  NpcAvatarPreview: {
    async ensurePortraitCosmetics() { assetCalls++; },
    buildProfileFromNpcExport(data) { return data; },
  },
  AmbientDialogue: {
    async renderChatheadImage(canvas, data) {
      renderCalls++;
      profile = data;
      canvas.alpha = opacity;
      return succeeds;
    },
  },
};
const renderPreview = new Function('window', actualFunction + '\nreturn renderPreview;')(browser);
const child = { speciesId: 'mao-ao', gender: 'female', bodyColors: { A: { h: 41 } }, cosmetics: {} }; // Newborn appearance fixture.
function makeCanvas() {
  let connected = true; // Simulates a modal being replaced while an async asset request is unfinished.
  const fallback = { hidden: false }; // The emoji must remain until a nonempty head has been painted.
  const canvas = {
    alpha: 0, hidden: true, width: 200, height: 200,
    get isConnected() { return connected; },
    closest: selector => connected && selector === '#romanceFamilyOverlay' ? {} : null,
    parentElement: { querySelector: selector => selector === '.rf-name-fallback' ? fallback : null },
    getContext() { return { getImageData: () => ({ data: Uint8ClampedArray.from([0, 0, 0, canvas.alpha]) }) }; },
  };
  return { canvas, fallback, disconnect() { connected = false; } };
}

async function test() {
  const good = makeCanvas();
  await renderPreview(good.canvas, child);
  assert(!good.canvas.hidden && good.fallback.hidden, 'opaque chathead replaces the emoji');
  assert.equal(profile.appearance.bodyColors.A.h, 41, 'child colors reach the shared chathead renderer');
  assert.equal(assetCalls, 1, 'portrait resources initialize before profile conversion');

  opacity = 0;
  const blank = makeCanvas();
  await renderPreview(blank.canvas, child);
  assert(blank.canvas.hidden && !blank.fallback.hidden, 'blank successful renderer retains the emoji');

  opacity = 255; succeeds = false;
  const failed = makeCanvas();
  await renderPreview(failed.canvas, child);
  assert(failed.canvas.hidden && !failed.fallback.hidden, 'renderer failure retains the emoji');

  succeeds = true;
  let releaseAssets; // Delayed asset dependency simulates a prompt dismissed during loading.
  browser.NpcAvatarPreview.ensurePortraitCosmetics = () => new Promise(resolve => { releaseAssets = resolve; });
  const obsolete = makeCanvas();
  const waiting = renderPreview(obsolete.canvas, child);
  obsolete.disconnect();
  releaseAssets();
  await waiting;
  assert(obsolete.canvas.hidden && !obsolete.fallback.hidden, 'stale dialog cannot reveal the portrait');
  assert.equal(renderCalls, 3, 'closed dialog does not launch another portrait render');
  console.log('Family newborn chathead success, blank crop, failure, and stale-load behavior passed.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
