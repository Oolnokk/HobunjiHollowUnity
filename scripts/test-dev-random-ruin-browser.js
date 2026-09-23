#!/usr/bin/env node
'use strict';

// End-to-end Random Test Ruin smoke. Requires Playwright + Chromium and a local
// server rooted at docs/. Example:
//   python3 -m http.server 8000 --directory docs
//   node scripts/test-dev-random-ruin-browser.js
// Optional diagnostics:
//   HOBUNJI_RUIN_FIXED_SEEDS=0x2468ace0 HOBUNJI_RUIN_AUDIT_SEEDS=0 node ...

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const TEST_URL = process.env.HOBUNJI_TEST_URL || 'http://127.0.0.1:8000/index.html';
const DEFAULT_FIXED_SEEDS = [0x5eed1234, 0x13579bdf, 0x2468ace0, 0x0badc0de];
function parseFixedSeeds(value) {
  if (!value) return DEFAULT_FIXED_SEEDS;
  const parsed = value.split(',').map(token => Number(token.trim())).filter(Number.isFinite).map(value => value >>> 0);
  if (!parsed.length) throw new Error('HOBUNJI_RUIN_FIXED_SEEDS contained no valid numeric seeds.');
  return parsed;
}
const FIXED_SEEDS = parseFixedSeeds(process.env.HOBUNJI_RUIN_FIXED_SEEDS);
const auditRaw = process.env.HOBUNJI_RUIN_AUDIT_SEEDS;
const AUDIT_SEEDS = auditRaw == null ? 8 : Math.max(0, Number(auditRaw) || 0);

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleMessages = [];
  const forbiddenEmbeddedRequests = [];

  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`);
    if (consoleMessages.length > 240) consoleMessages.shift();
  });
  page.on('request', request => {
    const url = request.url();
    let frameUrl = '';
    try { frameUrl = request.frame()?.url?.() || ''; } catch (_) {}
    if (frameUrl.includes('/tools/debris-ifier/') && /(?:api\.github\.com|raw\.githubusercontent\.com)/i.test(url)) {
      forbiddenEmbeddedRequests.push({ url, frameUrl });
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem('hobunjiDevMode', '1');
    localStorage.removeItem('hobunjiDevRandomRuinWallPlanes');
  });
  await page.goto(TEST_URL, { waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForFunction(() =>
    !!window.DevRandomRuin &&
    !!window.DevRandomRuinPrototypeHooks &&
    !!window.DevRandomRuinHitPuzzles &&
    !!window.DevRandomRuinTileOccupancy &&
    !!window.DevRandomRuinWallPlanes &&
    !!window.DevRandomRuinMotionRuntime &&
    !!window.DevRandomRuinRuntimeCoverage,
  null, { timeout:30000 });
  await page.evaluate(() => window.HobunjiTitleScreen?.start?.());
  await page.waitForFunction(() => !window.HobunjiTitleScreen?.isActive?.(), null, { timeout:5000 });

  async function failureDiagnostics(seed) {
    return page.evaluate(value => {
      const frame = document.getElementById('devRandomRuinGeneratorFrame');
      const generator = frame?.contentWindow?.DebrisifierV50;
      const state = generator?.getState?.();
      return {
        seed:value,
        area:window.GridTileAccessors?.getCurrentArea?.() || null,
        gameState:window.DevRandomRuin?.getState?.() || null,
        wallPlanes:window.DevRandomRuinWallPlanes?.snapshot?.() || null,
        badge:document.getElementById('devRandomRuinBadge')?.textContent || null,
        generatorPresent:!!generator,
        transport:frame?.contentWindow?.__debrisifierEmbeddedTransport || null,
        localeStatus:frame?.contentDocument?.getElementById('localeStatus')?.textContent || null,
        furnitureStatus:frame?.contentDocument?.getElementById('furnitureRepoStatus')?.textContent || null,
        generatorDebug:frame?.contentDocument?.getElementById('debug')?.textContent || null,
        generatedSeed:state?.locale?.seed || null,
        generatedEnvironment:state?.locale?.meta?.environment || null,
        runtimeWallPlanes:state?.runtimeWallPlanes || null,
        runtimeHallways:state?.runtimeHallways || null,
      };
    }, seed);
  }

  const activeRuns = [];
  for (const seed of FIXED_SEEDS) {
    const ok = await page.evaluate(async value => window.DevRandomRuin.generate(value), seed);
    if (!ok) {
      const diagnostics = await failureDiagnostics(seed);
      throw new Error(
        `generate(${seed}) failed\nDIAGNOSTICS\n${JSON.stringify(diagnostics, null, 2)}` +
        `\nPAGE ERRORS\n${pageErrors.join('\n') || '(none)'}` +
        `\nRECENT CONSOLE\n${consoleMessages.slice(-80).join('\n') || '(none)'}` +
        `\nFORBIDDEN REQUESTS\n${JSON.stringify(forbiddenEmbeddedRequests, null, 2)}`,
      );
    }
    await page.waitForFunction(
      () => window.GridTileAccessors.getCurrentArea() === 'map_i_dev_random_ruin',
      null,
      { timeout:30000 },
    );
    await page.waitForFunction(() =>
      window.DevRandomRuinPrototypeHooks.snapshot().active &&
      window.DevRandomRuinHitPuzzles.snapshot().active &&
      window.DevRandomRuinMotionRuntime.snapshot().active &&
      window.DevRandomRuinRuntimeCoverage.snapshot().active,
    null, { timeout:10000 });

    const active = await page.evaluate(() => {
      const scene = window.GridTileAccessors.getActiveScene();
      const root = scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
      const hooks = window.DevRandomRuinPrototypeHooks.snapshot();
      const hit = window.DevRandomRuinHitPuzzles.snapshot();
      const motion = window.DevRandomRuinMotionRuntime.snapshot();
      const coverage = window.DevRandomRuinRuntimeCoverage.snapshot();
      const wallPlaneControl = window.DevRandomRuinWallPlanes.snapshot();
      const wallRender = window.DevRandomRuinWallRenderProxy.snapshot();
      const occupancy = window.DevRandomRuin.getOccupancySnapshot();
      const dynamic = window.DynamicSurfaces.debugSnapshot();
      const frame = document.getElementById('devRandomRuinGeneratorFrame');
      const generator = frame?.contentWindow?.DebrisifierV50;
      const generatorState = generator?.getState?.();
      const shell = generatorState?.locale?.meta?.interiorShell || null;
      const transport = frame?.contentWindow?.__debrisifierEmbeddedTransport || null;
      const furnitureStatus = frame?.contentDocument?.getElementById('furnitureRepoStatus')?.textContent || '';
      const levels = Object.values(shell?.plateauModel?.levelByCell || {}).map(Number);
      let ladders = 0;
      scene?.traverse?.(object => {
        if (object.userData?.generatedAccessType === 'stoneLadder') ladders++;
      });

      // Sample the actual game collision registry along the center of every
      // hallway body, excluding the first/last cell where closed doors belong.
      const hallwayCollision = [];
      if (root && shell) {
        const cell = Number(shell.cellSize) || .5;
        for (const hall of shell.hallways || []) {
          const alongCells = hall.axis === 'x' ? Number(hall.w) : Number(hall.h);
          const blocked = [];
          let samples = 0;
          for (let i = 1; i <= alongCells - 2; i++) {
            const c = hall.axis === 'x' ? Number(hall.col) + i + .5 : Number(hall.col) + Number(hall.w) / 2;
            const r = hall.axis === 'z' ? Number(hall.row) + i + .5 : Number(hall.row) + Number(hall.h) / 2;
            const local = new THREE.Vector3(c * cell - Number(shell.worldWidth) / 2, 0, r * cell - Number(shell.worldDepth) / 2);
            const world = root.localToWorld(local);
            samples++;
            const hitRecord = window.DynamicSurfaces?.blockerAt?.(world.x, world.z, { radius:.28, actorHeight:1.25 }) || null;
            if (hitRecord) blocked.push({ i, id:hitRecord.id, x:+world.x.toFixed(3), z:+world.z.toFixed(3) });
          }
          hallwayCollision.push({ id:hall.id, axis:hall.axis, crossCells:hall.axis === 'x' ? hall.h : hall.w, samples, blocked });
        }
      }

      return {
        area:window.GridTileAccessors.getCurrentArea(),
        building:window.GridTileAccessors.isBuildingArea(),
        sceneName:scene?.name || null,
        hasRoot:!!root,
        hooks,
        hit,
        motion,
        coverage,
        wallPlaneControl,
        wallRender,
        occupancy,
        occupancyBlockers:dynamic.blockers.filter(record => record.id === 'devruin-tile-occupancy').length,
        legacyRuinBlockers:dynamic.blockers.filter(record => /^devruin-(wall|solid|door|push)-/.test(record.id)).length,
        transport,
        furnitureStatus,
        ladders,
        negativeLevels:levels.filter(level => level < 0).length,
        runtimeWallPlanes:generatorState?.runtimeWallPlanes || null,
        runtimeHallways:generatorState?.runtimeHallways || null,
        hallwayCollision,
      };
    });

    assert.equal(active.area, 'map_i_dev_random_ruin', JSON.stringify(active));
    assert.equal(active.building, true, JSON.stringify(active));
    assert.equal(active.sceneName, 'map_i_dev_random_ruin', JSON.stringify(active));
    assert.equal(active.hasRoot, true, JSON.stringify(active));
    assert.equal(active.hit.active, true, JSON.stringify(active.hit));
    assert.equal(active.motion.active, true, JSON.stringify(active.motion));
    assert.equal(active.coverage.effectiveUnhandled.length, 0, JSON.stringify(active.coverage));
    assert.ok(active.coverage.torchSourceCoverage.complete, JSON.stringify(active.coverage.torchSourceCoverage));
    assert.equal(active.transport?.active, true, JSON.stringify(active.transport));
    assert.equal(active.transport?.sameOrigin, true, JSON.stringify(active.transport));
    assert.equal(active.transport?.expectedFurniturePaths, 11, JSON.stringify(active.transport));
    assert.equal(active.transport?.patchedBindings, 8, JSON.stringify(active.transport));
    assert.deepEqual(active.transport?.runtimeHallwayWidthCells, [5,6], JSON.stringify(active.transport));
    assert.equal(active.transport?.runtimeDoorwayUsesAuthoredWidth, true, JSON.stringify(active.transport));
    assert.match(
      active.furnitureStatus,
      /11 JSONs.*1 Runtime Authored.*10 Furniture Model Data/,
      active.furnitureStatus,
    );
    assert.ok(active.runtimeWallPlanes?.count > 0, JSON.stringify(active.runtimeWallPlanes));
    assert.equal(active.runtimeWallPlanes.visible, active.runtimeWallPlanes.count, JSON.stringify(active.runtimeWallPlanes));
    assert.equal(active.runtimeWallPlanes.doubleSided, active.runtimeWallPlanes.count, JSON.stringify(active.runtimeWallPlanes));
    assert.equal(active.wallPlaneControl.enabled, true, JSON.stringify(active.wallPlaneControl));
    assert.equal(active.wallPlaneControl.count, active.runtimeWallPlanes.count, JSON.stringify(active.wallPlaneControl));
    assert.equal(active.wallPlaneControl.meshVisible, active.wallPlaneControl.count, JSON.stringify(active.wallPlaneControl));
    assert.equal(active.wallPlaneControl.blockerCount, 0, JSON.stringify(active.wallPlaneControl));
    assert.ok(active.occupancy?.blocked?.length > 0, JSON.stringify(active.occupancy));
    assert.equal(active.occupancyBlockers, 1, JSON.stringify(active));
    assert.equal(active.legacyRuinBlockers, 0, JSON.stringify(active));
    assert.ok(active.wallRender.sourceDoorMeshes > 0, JSON.stringify(active.wallRender));
    assert.equal(active.wallRender.doorProxyCount, active.wallRender.sourceDoorMeshes, JSON.stringify(active.wallRender));
    assert.equal(active.wallRender.visibleDoorProxies, active.wallRender.sourceDoorMeshes, JSON.stringify(active.wallRender));
    assert.ok(active.wallRender.sourceDoorArchMeshes > 0, JSON.stringify(active.wallRender));
    assert.equal(active.wallRender.visibleDoorArchProxies, active.wallRender.sourceDoorArchMeshes, JSON.stringify(active.wallRender));
    assert.ok(active.wallRender.normalizedDoorAssemblies > 0, JSON.stringify(active.wallRender));
    assert.ok(active.wallRender.sourceActivatorMeshes > 0, JSON.stringify(active.wallRender));
    assert.equal(active.wallRender.activatorProxyCount, active.wallRender.sourceActivatorMeshes, JSON.stringify(active.wallRender));
    assert.equal(active.wallRender.visibleActivatorProxies, active.wallRender.sourceActivatorMeshes, JSON.stringify(active.wallRender));
    assert.equal(active.wallRender.allTransformSyncedProxies, active.wallRender.totalProxyCount, JSON.stringify(active.wallRender));
    assert.equal(active.wallRender.allInteractionRaycastDisabled, active.wallRender.totalProxyCount, JSON.stringify(active.wallRender));
    assert.equal(active.wallRender.allMainRealmMaterials, active.wallRender.totalProxyCount, JSON.stringify(active.wallRender));
    assert.ok(active.runtimeHallways?.count > 0, JSON.stringify(active.runtimeHallways));
    assert.ok(active.runtimeHallways.minCrossCells >= 5, JSON.stringify(active.runtimeHallways));
    for (const hall of active.hallwayCollision) {
      assert.ok(hall.samples > 0, `hallway ${hall.id} produced no center-lane samples`);
      assert.equal(hall.blocked.length, 0, `hallway ${hall.id} center lane is blocked: ${JSON.stringify(hall)}`);
    }

    // Wall planes are structural and their old visual toggle is now a no-op.
    // Applying it must not recreate any object-wide wall blockers.
    if (seed === FIXED_SEEDS[0]) {
      const toggle = await page.evaluate(() => {
        window.DevRandomRuinWallPlanes.setVisible(false);
        const off = window.DevRandomRuinWallPlanes.snapshot();
        window.DevRandomRuinWallPlanes.setVisible(true);
        const on = window.DevRandomRuinWallPlanes.snapshot();
        return { off, on, checkbox:document.getElementById('settingDevRandomRuinWallPlanes')?.checked ?? null };
      });
      assert.equal(toggle.off.meshVisible, toggle.off.count, JSON.stringify(toggle));
      assert.equal(toggle.off.blockerCount, active.wallPlaneControl.blockerCount, JSON.stringify(toggle));
      assert.equal(toggle.off.enabled, true, JSON.stringify(toggle));
      assert.equal(toggle.on.meshVisible, toggle.on.count, JSON.stringify(toggle));
      assert.equal(toggle.on.blockerCount, active.wallPlaneControl.blockerCount, JSON.stringify(toggle));
      assert.equal(toggle.checkbox, null, JSON.stringify(toggle));
    }

    if (active.negativeLevels > 0) {
      assert.ok(active.ladders > 0, `negative floor tiers require ladder access: ${JSON.stringify(active)}`);
    }
    activeRuns.push({
      seed,
      ladders:active.ladders,
      negativeLevels:active.negativeLevels,
      walls:active.runtimeWallPlanes.count,
      minHallwayCells:active.runtimeHallways.minCrossCells,
      hallways:active.hallwayCollision.length,
      furnitureStatus:active.furnitureStatus,
    });
  }

  let aggregate = null;
  if (AUDIT_SEEDS > 0) {
    const audit = await page.evaluate(async count => window.DevRandomRuinRuntimeCoverage.auditSeeds(count), AUDIT_SEEDS);
    assert.equal(audit.count, AUDIT_SEEDS, JSON.stringify(audit));
    assert.equal(audit.aggregate.unknown.length, 0, JSON.stringify(audit.aggregate.unknown));
    assert.ok(audit.aggregate.motions.length > 0, JSON.stringify(audit.aggregate));
    assert.ok(audit.aggregate.activators.length > 0, JSON.stringify(audit.aggregate));
    assert.ok(audit.aggregate.access.includes('stoneLadder'), JSON.stringify(audit.aggregate));
    for (const row of audit.results || []) {
      assert.ok(row.runtimeWallPlanes?.count > 0, JSON.stringify(row));
      assert.equal(row.runtimeWallPlanes.visible, row.runtimeWallPlanes.count, JSON.stringify(row));
      assert.equal(row.runtimeWallPlanes.doubleSided, row.runtimeWallPlanes.count, JSON.stringify(row));
      assert.ok(row.runtimeHallways?.minCrossCells >= 5, JSON.stringify(row));
    }
    aggregate = audit.aggregate;
  }
  assert.deepEqual(
    forbiddenEmbeddedRequests,
    [],
    `embedded V50 made forbidden live-repo requests: ${JSON.stringify(forbiddenEmbeddedRequests)}`,
  );
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);

  console.log(JSON.stringify({ activeRuns, transport:'same-origin', aggregate }, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
