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
let externalSpritePng = null; // Real PNG bytes served from a different origin to reproduce tainted-canvas failures.
const corsSpriteServer = http.createServer((_req, res) => {
  if (!externalSpritePng) { res.writeHead(404); res.end('Sprite not ready'); return; }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' }); // Explicit CORS opt-in required for pixel reads.
  res.end(externalSpritePng);
});
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
  await new Promise(resolve => corsSpriteServer.listen(0, '127.0.0.1', resolve));
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
    // Exercise the actual mobile browser canvas, not a mocked renderer.
    await page.locator('#animalId').evaluate(input => {
      input.value = 'grehlr'; // Real authored head box, with the generated 64x64 test sprite.
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#imageFile').setInputFiles({
      name: 'grehlr-baby-fixture.png', mimeType: 'image/png', buffer: await spritePng(page, true),
    });
    await page.waitForFunction(() => window.__animalHeadRigBabyPreview?.debugSnapshot()?.frame?.width > 0);
    await page.locator('#babyHeadScale').evaluate(input => {
      input.value = '145'; // Highest setting makes invisible overrides easy to diagnose.
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.__animalHeadRigBabyPreview?.debugSnapshot()?.comparisonPixelChanges > 0);
    const headDebug = await page.evaluate(() => window.__animalHeadRigBabyPreview.debugSnapshot());
    assert.equal(headDebug.scale, 1.45);
    assert(headDebug.comparisonPixelChanges > 0, 'original and enlarged source pixels must actually differ');
    assert.match(await page.locator('#babyHeadPixelDelta').textContent(), /head-region pixels actually changed/);

    // Two real pointer drags select independent source-space growth regions without painting the rig.
    await page.locator('#babyHeadDrawCustom').click();
    await page.locator('#paintCanvas').scrollIntoViewIfNeeded();
    let artBox = await page.locator('#paintCanvas').boundingBox();
    assert(artBox?.width > 30 && artBox?.height > 30, 'the touch-draw editor canvas is visible');
    await page.mouse.move(artBox.x + artBox.width * .23, artBox.y + artBox.height * .23);
    await page.mouse.down();
    await page.mouse.move(artBox.x + artBox.width * .49, artBox.y + artBox.height * .47, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__animalRigGrowthRegions?.debugSnapshot()?.customEnabled === true
      && window.__animalRigGrowthRegions.debugSnapshot().customFrame?.width > .15
      && window.__animalHeadRigBabyPreview?.debugSnapshot()?.frameSource === 'custom drawn head box');
    assert.match((await page.evaluate(() => window.__animalHeadRigBabyPreview.debugSnapshot())).frameSource,
      /custom drawn head box/, 'a drawn head rectangle takes over the live source frame');

    await page.locator('#babyHeadDrawAbdomen').click();
    await page.locator('#paintCanvas').scrollIntoViewIfNeeded();
    artBox = await page.locator('#paintCanvas').boundingBox();
    await page.mouse.move(artBox.x + artBox.width * .48, artBox.y + artBox.height * .53);
    await page.mouse.down();
    await page.mouse.move(artBox.x + artBox.width * .78, artBox.y + artBox.height * .82, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__animalRigGrowthRegions?.debugSnapshot()?.abdomenEnabled === true
      && window.__animalRigGrowthRegions.debugSnapshot().abdomenFrame?.width > .15);
    await page.locator('#babyAbdomenScale').evaluate(input => {
      input.value = '150';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.__animalRigGrowthRegions.debugSnapshot().abdomenScale === 1.5);
    assert((await page.evaluate(() => previewImageForAnimal(state.image))) !== null,
      'both head and abdominal growth use the established finished-texture preview');
    await page.locator('#babyHeadClearAbdomen').click();
    await page.locator('#babyHeadClearCustom').click();
    await page.waitForFunction(() => !window.__animalRigGrowthRegions.debugSnapshot().customEnabled
      && !window.__animalRigGrowthRegions.debugSnapshot().abdomenEnabled);

    // A second localhost port is genuinely cross-origin. Image.onload alone cannot prove the pixels are readable.
    externalSpritePng = await spritePng(page, true);
    const externalSpriteUrl = 'http://127.0.0.1:' + corsSpriteServer.address().port + '/animal-fixture.png';
    await page.evaluate(src => loadImageUrl(src, 'cors-fixture.png'), externalSpriteUrl);
    await page.waitForFunction(src => state.image?.src === src, externalSpriteUrl);
    const externalRead = await page.evaluate(() => {
      const image = state.image, test = document.createElement('canvas');
      test.width = test.height = 8;
      test.getContext('2d').drawImage(image, 0, 0, 8, 8);
      const alpha = test.getContext('2d').getImageData(0, 0, 8, 8).data[3];
      return { corsMode: image.crossOrigin, alpha, source: image.src };
    });
    assert.equal(externalRead.corsMode, 'anonymous', 'rigger requests CORS access before loading sprite');
    await page.waitForFunction(() => window.__animalHeadRigBabyPreview?.debugSnapshot()?.comparisonPixelChanges > 0);
    assert.match(await page.locator('#babyHeadPixelDelta').textContent(), /head-region pixels actually changed/,
      'even a cross-origin loaded sprite must have readable image data for actual enlargement');
    assert.equal((await page.evaluate(() => window.__animalHeadRigBabyPreview.debugSnapshot())).lastError, null,
      'successful cross-origin pixel read must clear any earlier tainted-canvas error');
    const poseMaskCheck = await page.evaluate(() => {
      const warp = window.BabyAnimalHeadWarp, mask = warp.maskForKind('grehlr');
      if (!mask) return { error: warp.debugSnapshot().lastMaskError || 'missing idle head mask' };
      const originalMask = mask;
      const pose = document.createElement('canvas');
      pose.width = pose.height = 64;
      const ctx = pose.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(state.image, 0, 0, 64, 64); // IDLE establishes the mask; the following colors represent a different final pose.
      ctx.fillStyle = '#ff006b'; ctx.fillRect(Math.floor(mask.centerX) - 6, Math.floor(mask.centerY) - 2, 5, 5); // Eye overlay.
      ctx.fillStyle = '#03e1cc'; ctx.fillRect(Math.floor(mask.centerX) + 2, Math.floor(mask.centerY) - 2, 5, 5); // Coat pattern.
      const before = ctx.getImageData(0, 0, 64, 64).data;
      const enlarged = warp.applyToCanvas(pose, 'grehlr', 1.45);
      const after = enlarged.getContext('2d').getImageData(0, 0, 64, 64).data;
      const colors = (bytes, r, g, b) => {
        let count = 0;
        for (let i = 0; i < bytes.length; i += 4)
          if (bytes[i] === r && bytes[i+1] === g && bytes[i+2] === b && bytes[i+3] > 0) count++;
        return count;
      };
      let changed = 0;
      for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
      const frame = { x: .125, y: .125, width: .75, height: .75,
        coordinateSpace: 'sprite-normalized-top-left' };
      const sparse = new Uint8ClampedArray(12 * 12 * 4);
      for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) sparse[(y*12+x)*4+3] = 255;
      const isolatedMask = warp.buildIdleMask(sparse, 12, 12, frame);
      warp.primeIdleMask('test-mask-reload', { width: 12, height: 12, data: sparse }, frame);
      warp.primeIdleMask('test-mask-reload', { width: 12, height: 12,
        data: new Uint8ClampedArray(sparse.length) }, frame); // Empty replacement must invalidate an earlier opaque mask.
      return { opaquePixels: mask.opaquePixels, maskKept: warp.maskForKind('grehlr') === originalMask,
        changed, beforeEye: colors(before,255,0,107), afterEye: colors(after,255,0,107),
        beforePattern: colors(before,3,225,204), afterPattern: colors(after,3,225,204),
        sparsePixels: isolatedMask?.opaquePixels, clearInsideBox: isolatedMask?.coverage[3*12+3] < 1,
        staleCleared: warp.maskForKind('test-mask-reload', frame) === null };
    });
    assert(!poseMaskCheck.error, poseMaskCheck.error || 'idle mask unavailable');
    assert(poseMaskCheck.opaquePixels > 0 && poseMaskCheck.maskKept, 'every pose reuses the exact same opaque IDLE mask');
    assert(poseMaskCheck.changed > 0, 'other poses deform under the idle head mask');
    assert(poseMaskCheck.beforeEye > 0 && poseMaskCheck.afterEye > 0, 'painted eye overlay survives a post-composition warp');
    assert(poseMaskCheck.beforePattern > 0 && poseMaskCheck.afterPattern > 0, 'coat pattern overlay survives the same warp');
    assert.equal(poseMaskCheck.sparsePixels, 9, 'only the nine truly opaque pixels inside a frame define the head source');
    assert(poseMaskCheck.clearInsideBox && poseMaskCheck.staleCleared, 'transparent frame space stays soft, and invalid sprite reload clears stale masks');

    await page.locator('#shoulderRestSplitFrame').check();
    await page.waitForFunction(() => window.__animalHeadRigBabyPreview?.debugSnapshot()?.splitsAfterWarp > 0);
    await page.locator('#babyHeadCompare').click();
    assert.equal((await page.evaluate(() => window.__animalHeadRigBabyPreview.debugSnapshot())).comparingOriginal, true);
    await page.waitForFunction(() => /Showing original/.test(document.getElementById('babyHeadPreviewState')?.textContent || ''));
    await page.locator('#babyHeadCompare').click();
    assert.equal((await page.evaluate(() => window.__animalHeadRigBabyPreview.debugSnapshot())).comparingOriginal, false);
    await page.waitForFunction(() => /Showing 145% size, 20% shorter head/.test(document.getElementById('babyHeadPreviewState')?.textContent || ''));
    await page.locator('#babyHeadUsePainted').check(); // Exercise the older painted-Head selector in a real mobile Chromium render.
    await page.waitForFunction(() => { const debug = window.__animalHeadRigBabyPreview?.debugSnapshot?.();
      return debug?.maskMode === 'legacy-frame' && debug?.frameSource === 'earlier painted Head rectangle'; });
    assert.equal((await page.evaluate(() => window.__animalHeadRigBabyPreview.debugSnapshot())).frameSource,
      'earlier painted Head rectangle', 'checked selection uses the original painted Head region');
    await page.locator('#babyHeadUsePainted').uncheck();
    await page.waitForFunction(() => window.__animalHeadRigBabyPreview?.debugSnapshot()?.maskMode === 'idle-alpha');
    await page.locator('#babyHeadShortening').evaluate(input => {
      input.value = '35';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.__animalHeadRigBabyPreview?.debugSnapshot()?.shortening === 0.35
      && /35% shorter head/.test(document.getElementById('babyHeadPreviewState')?.textContent || ''));
    assert.match(await page.locator('#babyHeadPreviewState').textContent(), /35% shorter head/,
      'live preview communicates brachycephaly, not just the enlargement percentage');
    await page.locator('#babyHeadShortening').evaluate(input => {
      input.value = '20';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.__animalHeadRigBabyPreview?.debugSnapshot()?.shortening === 0.20);
    // Grehlr's REAL 3000×2250 sprite previously exceeded the 4MP idle-mask ceiling.
    // The failed warp then allocated a full canvas for every preview triangle until the mobile tab crashed.
    await page.locator('#loadBestiary').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#animalSelect option')].some(option => option.textContent.trim() === 'Grehlr'));
    const grehlrOption = await page.locator('#animalSelect').evaluate(select =>
      [...select.options].find(option => option.textContent.trim() === 'Grehlr')?.value);
    assert(grehlrOption, 'Grehlr must appear in the real bestiary');
    await page.locator('#animalSelect').selectOption(grehlrOption);
    await page.waitForFunction(() => state.baseRecord?.id === 'grehlr' && state.image?.naturalWidth === 3000
      && window.__animalHeadRigBabyPreview?.debugSnapshot()?.idleMaskPixels > 0,
    null, { timeout: 60000 });
    const shoulderBeforeCopy = await page.evaluate(() => currentShoulderRest());
    await page.locator('#shoulderCopySource').selectOption('moot');
    await page.locator('#shoulderCopyFromSpecies').click();
    const importedShoulder = await page.evaluate(() => ({
      source: window.HobunjiAuthoredAnimalHeadRigs.get('moot').shoulderRest,
      target: currentShoulderRest(),
    }));
    for (const field of ['useRun1', 'splitFrame', 'splitRightUsesIdle', 'followFrameShiftX', 'frameShiftX', 'separatorRotationDeg']) {
      assert.equal(importedShoulder.target[field], importedShoulder.source[field],
        'copying a shoulder pose imports the authored ' + field + ' setting');
    }
    assert.match(await page.locator('#shoulderCopyStatus').textContent(), /Copied complete shoulder pose/);
    await page.evaluate(rest => { applyShoulderRestConfig(rest); draw(); }, shoulderBeforeCopy);

    const largeSprite = await page.evaluate(() => {
      const headMask = window.BabyAnimalHeadWarp.maskForKind('grehlr');
      const texture = previewImageForAnimal(state.image);
      const layers = previewSplitLayerCanvases();
      return {
        original: [state.image.naturalWidth, state.image.naturalHeight],
        maskPixels: headMask.width * headMask.height,
        maskOpaque: headMask.opaquePixels,
        previewPixels: texture.width * texture.height,
        splitPixels: layers.left.width * layers.left.height,
        error: window.__animalHeadRigBabyPreview.debugSnapshot().lastError,
        shoulderEnabled: document.getElementById('shoulderRestUseSpline').checked,
        splitEnabled: document.getElementById('shoulderRestSplitFrame').checked,
      };
    });
    assert.deepEqual(largeSprite.original, [3000, 2250], 'the original large sprite remains unmodified');
    assert(largeSprite.maskOpaque > 0 && largeSprite.maskPixels <= 1024 * 1024,
      'Grehlr receives an actual opaque-idle head mask with bounded memory');
    assert(largeSprite.previewPixels <= 1_250_000 && largeSprite.splitPixels <= 1_250_000,
      'both baby preview and shoulder-split layers remain bounded despite full-resolution input');
    assert(largeSprite.shoulderEnabled && largeSprite.splitEnabled,
      'Grehlr retains its authored shoulder spline and split settings');
    assert.equal(largeSprite.error, null, 'head resizing succeeds with the authentic Grehlr sprite');

    const grehlrPivot = await page.evaluate(() => ({
      loaded: state.pivot?.x / state.image?.naturalWidth,
      committed: window.HobunjiGrehlrHeadRigCorrection?.authored?.pivot?.x,
    }));
    assert(Math.abs(grehlrPivot.loaded - grehlrPivot.committed) < 0.0001,
      'Grehlr must restore the corrected head rig even though the idle sprite loads after selection');

    // Reproduce a slow Grehlr request completing AFTER the player selects another animal.
    let releaseDelayedIdle; // Delays the obsolete request until the replacement species has loaded.
    const delayedIdleGate = new Promise(resolve => { releaseDelayedIdle = resolve; });
    let notifyRequested; // Allows the test to await actual interception rather than a guessed timeout.
    const requestedGate = new Promise(resolve => { notifyRequested = resolve; });
    const delayedUrl = '**/grehlr_idle.png?race-rigger-test=1';
    await page.route(delayedUrl, async route => {
      notifyRequested();
      await delayedIdleGate;
      await route.continue();
    });
    await page.evaluate(() => loadImageUrl(
      repoSpriteUrl('assets/creaturesprites/grehlr_idle.png') + '?race-rigger-test=1', 'superseded-grehlr-idle'));
    await requestedGate;
    const nextSpeciesIndex = await page.evaluate(() => state.selectRecords.findIndex(record => record?.id === 'gar-wolf'));
    assert(nextSpeciesIndex >= 0, 'the follow-up species is listed in the actual bestiary');
    await page.locator('#animalSelect').selectOption(String(nextSpeciesIndex));
    await page.waitForFunction(() => state.baseRecord?.id === 'gar-wolf'
      && state.image?.src?.includes('gar-wolf_idle.png')
      && window.__animalHeadRigSpriteLoad?.debugSnapshot()?.status === 'ready');
    releaseDelayedIdle();
    await page.waitForFunction(() => window.__animalHeadRigSpriteLoad?.debugSnapshot()?.staleCallbacks > 0);
    const switched = await page.evaluate(() => ({
      id: state.baseRecord.id, sprite: state.image.src, status: window.__animalHeadRigSpriteLoad.debugSnapshot(),
    }));
    assert.equal(switched.id, 'gar-wolf', 'stale loading does not overwrite the chosen species');
    assert.match(switched.sprite, /gar-wolf_idle\.png/, 'a late Grehlr onload never replaces the newer sprite');
    assert.equal(switched.status.lastError, null, 'late requests cannot replace current loading diagnostics');
    await page.unroute(delayedUrl);

    assert.deepEqual(errors, [], 'no uncaught JavaScript errors during mobile editing or full-size Grehlr load');
    console.log('PASS mobile hat editor: catalog, PNG import, hat-only preview, smudge, undo/redo, export, clear, neck tab');
  } catch (error) {
    console.error('Hat editor browser errors:', errors.join('\n'));
    throw error;
  } finally {
    await browser?.close();
    await Promise.all([
      new Promise(resolve => server.close(resolve)),
      new Promise(resolve => corsSpriteServer.close(resolve)),
    ]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
