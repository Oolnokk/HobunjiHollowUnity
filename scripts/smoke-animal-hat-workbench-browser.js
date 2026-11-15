#!/usr/bin/env node
'use strict';
// Mobile browser integration test for the shipped animal hat editor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'); // Serve actual committed modules/assets from one origin.
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const route = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = path.resolve(root, route);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end(error.message); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});
async function spritePng(page, animal) {
  const data = await page.evaluate(isAnimal => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#16181d'; ctx.fillRect(5, 10, 53, 45);
    ctx.fillStyle = isAnimal ? '#698ca2' : '#b77b56'; ctx.fillRect(8, 13, 45, 39);
    ctx.fillStyle = isAnimal ? '#c6b8af' : '#d7c17b'; ctx.fillRect(14, 18, 20, 32);
    return canvas.toDataURL('image/png').split(',')[1];
  }, animal);
  return Buffer.from(data, 'base64');
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = []; // Real page exceptions are printed without needing the phone's browser console.
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    const context = await browser.newContext({ viewport: { width: 412, height: 850 },
      isMobile: true, hasTouch: true, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const url = 'http://127.0.0.1:' + server.address().port + '/docs/tools/animal-head-rig/index.html';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!window.HobunjiAnimalHatWorkbench, null, { timeout: 30000 });
    await page.locator('#riggerHatsTab').click();
    assert.equal(await page.locator('#hatWorkspace').isVisible(), true);
    assert.equal(await page.locator('#paintCanvas').isVisible(), false);

    // Real catalog JSON and hat PNG must load through the new source picker.
    await page.locator('#hatLoadCatalog').click();
    await page.waitForFunction(() => document.querySelector('#hatCosmetic')?.options.length > 1);
    const selection = await page.locator('#hatCosmetic').evaluate(select =>
      [...select.options].find(option => /basic.headband/i.test(option.textContent))?.value);
    assert(selection, 'existing repo headbands must be listed in the hat catalog');
    await page.locator('#hatCosmetic').selectOption(selection);
    await page.waitForFunction(() => /Loaded [1-9]|Hat load failed/.test(document.getElementById('hatStatus')?.textContent || ''),
      null, { timeout: 15000 });
    assert.match(await page.locator('#hatStatus').innerText(), /Loaded [1-9]/);

    // Local PNG importing must preserve blob URLs, then be editable without a painted neck rig.
    await page.locator('#animalId').evaluate(input => {
      input.value = 'hat-browser-smoke';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#imageFile').setInputFiles({ name: 'animal.png', mimeType: 'image/png',
      buffer: await spritePng(page, true) });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.image?.naturalWidth === 64);
    await page.locator('#hatPngFile').setInputFiles({ name: 'hat.png', mimeType: 'image/png',
      buffer: await spritePng(page, false) });
    await page.waitForFunction(() => document.getElementById('hatPath')?.value === 'hat.png');
    assert.equal((await page.locator('#hatArtBadge').textContent()).trim(), '64×64');

    await page.locator('#hatHeightScale').fill('1.5');
    await page.locator('#hatSkew').fill('18');
    await page.locator('#hatPreviewSave').click();
    const previews = await page.evaluate(() => ({
      hats: JSON.parse(localStorage.getItem('hobunji_animal_hat_fits_v1') || '{}')['hat-browser-smoke'],
      head: JSON.parse(localStorage.getItem('hobunji_animal_head_rigs_v1') || '{}')['hat-browser-smoke'],
      runtime: window.AnimalNpcHeadwear.previewHatForKind('hat-browser-smoke')
    }));
    assert.equal(previews.hats?.heightScale, 1.5);
    assert.equal(previews.runtime?.skewXDeg, 18);
    assert.equal(previews.head, undefined, 'hat-only fit must not enter the head-rig storage');

    // Real pointer gesture, Undo/Redo, and PNG download.
    await page.locator('#hatArtCanvas').scrollIntoViewIfNeeded(); // A mobile single-column stage sits below the controls.
    const art = await page.locator('#hatArtCanvas').boundingBox();
    assert(art && art.width > 100 && art.width <= 412, 'canvas must fit a mobile viewport');
    assert(art.y >= 0 && art.y + art.height <= 850, 'drag coordinates must be inside the mobile viewport');
    await page.evaluate(() => {
      window.__hatPointerTrace = []; // Capture real event routing for CI/mobile diagnostics.
      const canvas = document.getElementById('hatArtCanvas');
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        canvas.addEventListener(type, event => {
          window.__hatPointerTrace.push({ type, pointerId: event.pointerId, buttons: event.buttons,
            target: event.target?.id, x: Math.round(event.clientX), y: Math.round(event.clientY) });
        }, { capture: true });
      }
    });
    await page.mouse.move(art.x + art.width * .36, art.y + art.height * .5);
    await page.mouse.down();
    await page.mouse.move(art.x + art.width * .74, art.y + art.height * .5, { steps: 10 });
    await page.mouse.up();
    const debug = () => page.evaluate(() => window.HobunjiAnimalHatWorkbench.getDebug());
    const changed = await debug();
    if (!changed.layers[0].changedPixels) console.error('Hat gesture diagnostic:', JSON.stringify(await page.evaluate(() => ({
      events: window.__hatPointerTrace, status: document.getElementById('hatStatus')?.textContent,
      atStart: document.elementFromPoint(170, 500)?.id,
      canvas: (() => { const r = document.getElementById('hatArtCanvas')?.getBoundingClientRect();
        return r && { x:r.x,y:r.y,width:r.width,height:r.height }; })()
    }))));
    assert.equal(changed.layers[0].dirty, true, 'smudge must mark a hat as edited');
    assert((await debug()).layers[0].changedPixels > 0, 'smudge must actually move colored/outlined PNG pixels');
    await page.locator('#hatUndo').click();
    assert.equal((await debug()).layers[0].dirty, false, 'Undo restores source image');
    await page.locator('#hatRedo').click();
    assert.equal((await debug()).layers[0].dirty, true, 'Redo restores smudged pixels');
    const download = page.waitForEvent('download');
    await page.locator('#hatExportPng').click();
    assert.equal((await download).suggestedFilename(), 'hat.png');

    await page.locator('#hatPreviewClear').click();
    const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem('hobunji_animal_hat_fits_v1') || '{}'));
    assert.equal(Object.hasOwn(cleared, 'hat-browser-smoke'), false);
    await page.locator('#riggerNeckTab').click();
    assert.equal(await page.locator('#paintCanvas').isVisible(), true);
    assert.deepEqual(errors, [], 'no uncaught JavaScript errors during mobile hat editing');
    console.log('PASS mobile hat editor: catalog, PNG import, hat-only preview, smudge, undo/redo, export, clear, neck tab');
  } catch (error) {
    console.error('Hat editor browser errors:', errors.join('\n'));
    throw error;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
