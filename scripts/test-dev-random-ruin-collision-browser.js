#!/usr/bin/env node
'use strict';

// Focused regression for the Random Test Ruin's shared occupancy snapshot.
// Requires a local docs/ server plus Playwright/Chromium.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const TEST_URL = process.env.HOBUNJI_TEST_URL || 'http://127.0.0.1:8000/index.html';

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => localStorage.setItem('hobunjiDevMode', '1'));
  await page.goto(TEST_URL, { waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForFunction(() => !!window.DevRandomRuin && !!window.DevRandomRuinTileOccupancy && !!window.DevRandomRuinCollisionPrecision, null, { timeout:30000 });
  await page.evaluate(() => window.HobunjiTitleScreen?.start?.());
  await page.waitForFunction(() => !window.HobunjiTitleScreen?.isActive?.(), null, { timeout:5000 });
  assert.equal(await page.evaluate(() => window.DevRandomRuin.generate(0x5eed1234)), true, 'fixed ruin seed should generate');
  await page.waitForFunction(() => window.GridTileAccessors?.getCurrentArea?.() === 'map_i_dev_random_ruin', null, { timeout:30000 });
  await page.waitForFunction(() => {
    const render = window.DevRandomRuinWallRenderProxy?.snapshot?.();
    return render?.sourceDoorMeshes > 0 && render.doorProxyCount === render.sourceDoorMeshes
      && render.sourceActivatorMeshes > 0 && render.activatorProxyCount === render.sourceActivatorMeshes;
  }, null, { timeout:10000 });

  const result = await page.evaluate(() => {
    const first = window.DevRandomRuin.getOccupancySnapshot();
    const dynamic = window.DynamicSurfaces.debugSnapshot();
    const aggregate = dynamic.blockers.filter(record => record.id === 'devruin-tile-occupancy');
    const legacy = dynamic.blockers.filter(record => /^devruin-(?:wall|solid|door|push|transit-door)-/.test(record.id));
    const blockedKey = first.blocked[0];
    const [blockedCol, blockedRow] = blockedKey.split(',').map(Number);
    const blockedHit = window.DynamicSurfaces.blockerAt(blockedCol + .5, blockedRow + .5, { radius:.05, actorHeight:1.25 });
    const openKey = first.floor.find(tileKey => !first.blocked.includes(tileKey));
    const [openCol, openRow] = openKey.split(',').map(Number);
    const openHit = window.DynamicSurfaces.blockerAt(openCol + .5, openRow + .5, { radius:.05, actorHeight:1.25 });

    window.WildernessMap.renderMapPanel();
    const canvas = document.getElementById('wildernessMapCanvas');
    const legend = document.querySelector('#mpMap .wmap-legend')?.textContent || '';

    // Move one authored push block by a full runtime tile and refresh explicitly;
    // its red source must move without registering a new object blocker.
    const scene = window.GridTileAccessors.getActiveScene();
    let push = null;
    scene?.traverse?.(object => { if (!push && object.userData?.pushable && object.userData?.previewMotion?.type === 'pushPuzzleBlock') push = object; });
    let pushChange = null;
    if (push) {
      const sourceId = push.userData.__devRuinOccupancySource;
      const beforeTiles = Object.keys(first.sources).filter(tileKey => first.sources[tileKey].includes(sourceId));
      push.position.x += .5;
      push.updateMatrixWorld?.(true);
      window.DevRandomRuinTileOccupancy.refresh();
      const after = window.DevRandomRuin.getOccupancySnapshot();
      const afterTiles = Object.keys(after.sources).filter(tileKey => after.sources[tileKey].includes(sourceId));
      pushChange = { sourceId, beforeTiles, afterTiles, revisionBefore:first.revision, revisionAfter:after.revision };
    }

    const probe = window.DevRandomRuinCollisionPrecision.snapshot();
    const render = window.DevRandomRuinWallRenderProxy.snapshot();
    return {
      counts:{ blocked:first.blocked.length, causes:first.causes.length, effects:first.effects.length },
      aggregate:aggregate.length,
      legacy:legacy.length,
      blockedHit:blockedHit?.id || null,
      openHit:openHit?.id || null,
      mapRevision:Number(canvas.dataset.ruinOccupancyRevision),
      mapFog:canvas.dataset.ruinFog,
      legend,
      pushChange,
      probe,
      render,
    };
  });

  assert.ok(result.counts.blocked > 0, JSON.stringify(result));
  assert.equal(result.aggregate, 1, JSON.stringify(result));
  assert.equal(result.legacy, 0, JSON.stringify(result));
  assert.equal(result.blockedHit, 'devruin-tile-occupancy', JSON.stringify(result));
  assert.equal(result.openHit, null, JSON.stringify(result));
  assert.equal(result.mapRevision, result.pushChange?.revisionBefore ?? result.probe.revision, JSON.stringify(result));
  assert.equal(result.mapFog, 'disabled', JSON.stringify(result));
  assert.match(result.legend, /Blocked/);
  assert.match(result.legend, /Activator/);
  assert.match(result.legend, /Mechanism/);
  if (result.pushChange) {
    assert.ok(result.pushChange.sourceId, JSON.stringify(result.pushChange));
    assert.notDeepEqual(result.pushChange.afterTiles, result.pushChange.beforeTiles, JSON.stringify(result.pushChange));
    assert.ok(result.pushChange.revisionAfter > result.pushChange.revisionBefore, JSON.stringify(result.pushChange));
  }
  assert.equal(result.probe.aggregateBlockers, 1, JSON.stringify(result.probe));
  assert.ok(result.render.sourceDoorMeshes > 0, JSON.stringify(result.render));
  assert.equal(result.render.doorProxyCount, result.render.sourceDoorMeshes, JSON.stringify(result.render));
  assert.equal(result.render.visibleDoorProxies, result.render.sourceDoorMeshes, JSON.stringify(result.render));
  assert.ok(result.render.sourceDoorArchMeshes > 0, JSON.stringify(result.render));
  assert.equal(result.render.visibleDoorArchProxies, result.render.sourceDoorArchMeshes, JSON.stringify(result.render));
  assert.ok(result.render.normalizedDoorAssemblies > 0, JSON.stringify(result.render));
  assert.ok(result.render.sourceActivatorMeshes > 0, JSON.stringify(result.render));
  assert.equal(result.render.activatorProxyCount, result.render.sourceActivatorMeshes, JSON.stringify(result.render));
  assert.equal(result.render.visibleActivatorProxies, result.render.sourceActivatorMeshes, JSON.stringify(result.render));
  assert.equal(result.render.allTransformSyncedProxies, result.render.totalProxyCount, JSON.stringify(result.render));
  assert.equal(result.render.allInteractionRaycastDisabled, result.render.totalProxyCount, JSON.stringify(result.render));
  assert.equal(result.render.allMainRealmMaterials, result.render.totalProxyCount, JSON.stringify(result.render));

  const probeText = await page.evaluate(async () => {
    const resultEl = document.getElementById('debugProbeResult');
    if (!resultEl) return '';
    resultEl.textContent = 'Pixel Probe report\nshared occupancy smoke';
    await new Promise(resolve => setTimeout(resolve, 50));
    return resultEl.textContent;
  });
  assert.match(probeText, /Random Test Ruin tile occupancy diagnostics/, probeText);
  assert.match(probeText, /aggregateGameplayBlockers=1/, probeText);
  assert.match(probeText, /Puzzle render proxies: doors=/, probeText);

  if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
