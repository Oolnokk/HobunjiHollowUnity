#!/usr/bin/env node
'use strict';
// Real Chromium/WebGL smoke for the published multi-sprite weapon editor.
// Verifies gameplay geometry, particles, mobile layout, scrubbing, and editable effect sizes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let chromium; // The CI-installed Playwright browser; absent locally means a browser-only skip.
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed (browser-only test)');
  process.exit(0);
}
const root = path.resolve(__dirname, '..'); // Serve the checked-out PR, never the published main branch.
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(absolute, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Missing ' + relative); }
    res.setHeader('Content-Type', mime[path.extname(absolute)] || 'application/octet-stream');
    res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 412, height: 850 }, deviceScaleFactor: 1 });
    const errors = []; // Browser exceptions are reported by this test even when no developer console is available.
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.goto('http://127.0.0.1:' + server.address().port +
      '/docs/tools/multi-sprite-weapon-editor/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const debug = () => page.evaluate(() => window.HobunjiMultiSpritePreviewRenderer?.debugSnapshot());
    await page.waitForFunction(() => {
      const state = window.HobunjiMultiSpritePreviewRenderer?.debugSnapshot();
      return state?.combined?.ready && state?.head?.ready &&
        state.physics?.some(weapon => weapon.itemKey === 'hachutuTorchFlail' &&
          weapon.loaded && weapon.fire?.some(emitter => emitter.particles > 0));
    }, null, { timeout: 60000 });
    const initial = await debug();
    assert.equal(initial.renderer, 'shared-gameplay-3d', 'preview invokes the real gameplay assembly');
    assert.equal(initial.head.partsReady, 4, 'four Hachutu head PNG planes are present');
    assert.equal(initial.combined.chainReady, true, 'visible chain and head built in 3D');
    assert(initial.head.cameraDistance > 0 && initial.combined.cameraDistance > 0, 'both orbit cameras are fitted');
    const flame = initial.physics.find(weapon => weapon.itemKey === 'hachutuTorchFlail').fire[0];
    assert.equal(flame.size, 0.02, 'committed Torch-Flail fire size is visible in the live shared emitter');
    const contexts = await page.evaluate(() => ['headPreview', 'preview'].map(id => {
      const canvas = document.getElementById(id);
      return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    }));
    assert.deepEqual(contexts, [true, true], 'both canvases have working WebGL contexts');
    const frame = await page.locator('#preview').screenshot(); // Actual 3D renderer must produce pixels, not only valid JS geometry.
    assert(frame.length > 1000, 'combined view renders nonempty screenshot');
    await page.locator('#play').click();
    await page.locator('#scrub').evaluate(input => {
      input.value = '0.65';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const state = window.HobunjiMultiSpritePreviewRenderer?.debugSnapshot();
      const weapon = state?.physics?.find(x => x.itemKey === 'hachutuTorchFlail');
      return Math.abs((weapon?.progress || 0) - 0.65) < 0.002 &&
        weapon?.physics?.angularVelocity.every(Number.isFinite);
    });
    await page.locator('[data-tab="layers"]').click();
    await page.locator('#layerList .layer > button').nth(2).click(); // Third head layer is the authored fuel.
    await page.locator('#fireSize').fill('0.04');
    await page.locator('#fireSize').dispatchEvent('change');
    await page.waitForFunction(() => window.HobunjiMultiSpritePreviewRenderer?.debugSnapshot()
      ?.physics?.some(weapon => weapon.itemKey === 'hachutuTorchFlail' &&
        weapon.fire?.some(fire => Math.abs(fire.size - 0.04) < 1e-8)), null, { timeout: 30000 });
    await page.locator('#soloLayer').check();
    await page.locator('#resetView').click();
    await page.locator('#weapon').selectOption('grappleFlail');
    await page.waitForFunction(() => window.HobunjiMultiSpritePreviewRenderer?.debugSnapshot()
      ?.physics?.some(weapon => weapon.itemKey === 'grappleFlail' &&
        weapon.loaded && weapon.connector === 'rope'), null, { timeout: 30000 });
    const rope = await debug();
    assert.equal(rope.combined.chainReady, true, 'generated rope builds after switching weapon');
    assert(rope.physics.find(weapon => weapon.itemKey === 'grappleFlail').physics.length > 0,
      'the rope supplies a positive measured physical lever');
    assert.deepEqual(errors, [], '3D author does not throw in real Chromium');
    assert(!/Preview: |\[weapon assembly\].*(?:failed|Error)/i.test(await page.locator('#log').innerText()),
      'visible mobile diagnostics remain free of preview failures');
    console.log('multi-sprite weapon browser: PASS (WebGL, gameplay fire size, edit, pause, mobile layout, rope)');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
