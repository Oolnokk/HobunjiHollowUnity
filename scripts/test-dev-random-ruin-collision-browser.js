#!/usr/bin/env node
'use strict';

// Focused regression for Random Test Ruin collision precision. Requires a local
// docs/ server plus Playwright/Chromium (same environment as the full ruin smoke).
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
  await page.waitForFunction(() =>
    !!window.DevRandomRuin &&
    !!window.DevRandomRuinCollisionPrecision &&
    !!window.DynamicSurfaces?.addBlockerFilter,
  null, { timeout:30000 });
  await page.evaluate(() => window.HobunjiTitleScreen?.start?.());
  await page.waitForFunction(() => !window.HobunjiTitleScreen?.isActive?.(), null, { timeout:5000 });
  assert.equal(await page.evaluate(() => window.DevRandomRuin.generate(0x5eed1234)), true, 'fixed ruin seed should generate');
  await page.waitForFunction(() => window.GridTileAccessors?.getCurrentArea?.() === 'map_i_dev_random_ruin', null, { timeout:30000 });

  const result = await page.evaluate(() => {
    const scene = window.GridTileAccessors.getActiveScene();
    const DS = window.DynamicSurfaces;
    const precision = window.DevRandomRuinCollisionPrecision;
    const material = new THREE.MeshBasicMaterial();
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), material);
    wall.position.set(3, 1, 3);
    wall.rotation.y = Math.PI / 4;
    wall.updateMatrixWorld(true);
    scene.add(wall);
    wall.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(wall);
    const record = { id:`devruin-wall-${wall.id}`, scope:'dev-random-ruin-interior' };
    const context = {
      radius:.1,
      actorHeight:1.25,
      bounds:{ minX:box.min.x, maxX:box.max.x, minZ:box.min.z, maxZ:box.max.z },
      options:{ radius:.1, actorHeight:1.25 },
    };

    // At a rotated line's AABB corner, the broad phase says "inside" but the
    // oriented wall footprint must reject it. The center must remain blocking.
    const cornerX = box.min.x + .03;
    const cornerZ = box.min.z + .03;
    const cornerAccepted = precision.refineBlocker(record, cornerX, cornerZ, context);
    const centerAccepted = precision.refineBlocker(record, wall.position.x, wall.position.z, context);

    scene.remove(wall);
    wall.geometry.dispose();
    material.dispose();

    const snap = precision.snapshot();
    const dynamic = DS.debugSnapshot();
    return {
      cornerAccepted,
      centerAccepted,
      filterCount:dynamic.blockerFilters,
      precision:snap.precision,
      active:snap.active,
    };
  });

  assert.equal(result.active, true, JSON.stringify(result));
  assert.ok(result.filterCount >= 1, JSON.stringify(result));
  assert.equal(result.cornerAccepted, false, `rotated wall AABB corner must be rejected: ${JSON.stringify(result)}`);
  assert.equal(result.centerAccepted, true, `real wall center must remain blocking: ${JSON.stringify(result)}`);
  assert.ok(result.precision.rejected >= 1, JSON.stringify(result.precision));
  assert.ok(result.precision.accepted >= 1, JSON.stringify(result.precision));

  const probe = await page.evaluate(async () => {
    const resultEl = document.getElementById('debugProbeResult');
    if (!resultEl) return '';
    resultEl.textContent = 'Pixel Probe report\ncollision precision smoke';
    await new Promise(resolve => setTimeout(resolve, 50));
    return resultEl.textContent;
  });
  assert.match(probe, /Random Test Ruin collision diagnostics/, probe);
  assert.match(probe, /rejectedAabbFalsePositives=/, probe);

  if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
