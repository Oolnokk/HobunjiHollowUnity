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
    localStorage.removeItem('hobunji.devRandomRuinDarkness.v1');
    localStorage.removeItem('hobunji.devRandomRuinPuzzleOptions.v2');
  });
  await page.goto(TEST_URL, { waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForFunction(() =>
    !!window.DevRandomRuin &&
    !!window.DevRandomRuinPrototypeHooks &&
    !!window.DevRandomRuinHitPuzzles &&
    !!window.DevRandomRuinTileOccupancy &&
    !!window.DevRandomRuinWallPlanes &&
    !!window.DevRandomRuinMotionRuntime &&
    !!window.DevRandomRuinSimplePuzzles &&
    !!window.DevRandomRuinRuntimeCoverage,
  null, { timeout:30000 });
  await page.evaluate(() => window.HobunjiTitleScreen?.start?.());
  await page.waitForFunction(() => !window.HobunjiTitleScreen?.isActive?.(), null, { timeout:5000 });

  const puzzlePanel = await page.evaluate(() => {
    const details = document.getElementById('devRandomRuinPuzzleOptions');
    return {
      present:!!details,
      open:!!details?.open,
      checkboxCount:details?.querySelectorAll?.('[data-ruin-puzzle-option]')?.length || 0,
      maxPresent:!!details?.querySelector?.('#devRandomRuinMaxPuzzlesPerRoom'),
      darknessEnabled:document.getElementById('devRandomRuinDarknessEnabled')?.checked ?? null,
      darknessSeverity:Number(document.getElementById('devRandomRuinDarknessSeverity')?.value),
    };
  });
  assert.equal(puzzlePanel.present, true, JSON.stringify(puzzlePanel));
  assert.equal(puzzlePanel.open, false, JSON.stringify(puzzlePanel));
  assert.equal(puzzlePanel.checkboxCount, 4, JSON.stringify(puzzlePanel));
  assert.equal(puzzlePanel.maxPresent, true, JSON.stringify(puzzlePanel));
  assert.equal(puzzlePanel.darknessEnabled, false, JSON.stringify(puzzlePanel));
  assert.equal(puzzlePanel.darknessSeverity, 100, JSON.stringify(puzzlePanel));

  // Exercise the stripped-down generator before the normal smoke seeds:
  // only the proven projectile glyph family, with every parent-runtime simple
  // family disabled. Old V50 mechanism families must remain hard-off.
  const projectileOnlySettings = await page.evaluate(() => {
    const details = document.getElementById('devRandomRuinPuzzleOptions');
    for (const checkbox of details.querySelectorAll('[data-ruin-puzzle-option]')) {
      checkbox.checked = checkbox.dataset.ruinPuzzleOption === 'glyphObelisk';
      checkbox.dispatchEvent(new Event('change', { bubbles:true }));
    }
    const maxInput = details.querySelector('#devRandomRuinMaxPuzzlesPerRoom');
    maxInput.value = '1';
    maxInput.dispatchEvent(new Event('input', { bubbles:true }));
    return window.DevRandomRuin.getPuzzleGenerationOptions();
  });
  assert.deepEqual(projectileOnlySettings, {
    pressurePlate:false,brazier:false,glyphObelisk:true,stackedObelisk:false,linkedCubePillars:false,nestedRoom:false,
    safePath:false,ropeSwing:false,hallwayTraps:false,maxPerRoom:1,
  }, JSON.stringify(projectileOnlySettings));
  const constrainedSeed = 0x51a7cafe;
  assert.equal(await page.evaluate(async seed => window.DevRandomRuin.generate(seed), constrainedSeed), true);
  await page.waitForFunction(() => window.GridTileAccessors.getCurrentArea() === 'map_i_dev_random_ruin', null, { timeout:30000 });
  const constrained = await page.evaluate(() => {
    const state = window.DevRandomRuin.getState();
    const scene = window.GridTileAccessors.getActiveScene();
    const activatorTypes = new Set();
    let bypassed = 0;
    scene?.traverse?.(object => {
      if (object.userData?.activatorType) activatorTypes.add(object.userData.activatorType);
      if (object.userData?.runtimePuzzleBypass) bypassed++;
    });
    return {
      puzzleOptions:state?.puzzleOptions || null,
      counts:Object.values(state?.puzzleGeneration?.countsByRoom || {}).map(Number),
      activatorTypes:[...activatorTypes].sort(),
      bypassed,
      solvability:state?.solvability || null,
      generationAttempt:state?.generationAttempt || 0,
      badge:document.getElementById('devRandomRuinBadge')?.textContent || '',
      darkness:window.DevRandomRuin.getDarknessSettings?.() || null,
      darknessDebug:window.CloudForestFog?.getDebugState?.() || null,
    };
  });
  assert.equal(constrained.puzzleOptions?.glyphObelisk, true, JSON.stringify(constrained));
  for (const key of ['pressurePlate','brazier','stackedObelisk','linkedCubePillars','nestedRoom','safePath','ropeSwing','hallwayTraps']) {
    assert.equal(constrained.puzzleOptions?.[key], false, JSON.stringify(constrained));
  }
  assert.equal(constrained.puzzleOptions?.maxPerRoom, 1, JSON.stringify(constrained));
  assert.ok(constrained.counts.every(count => count <= 1), JSON.stringify(constrained));
  assert.ok(constrained.activatorTypes.every(type => type === 'glyphObelisk' || type === 'alwaysLitTorch'), JSON.stringify(constrained));

  const glyphVisuals = await page.evaluate(async () => {
    const scene=window.GridTileAccessors.getActiveScene();
    const roots=[];
    scene?.traverse?.(object=>{
      if(object.userData?.activatorType!=='glyphObelisk')return;
      let nested=false;
      object.traverse?.(child=>{ if(child!==object && child.userData?.activatorType==='glyphObelisk') nested=true; });
      if(!nested)roots.push(object);
    });
    const summarize=root=>{
      let decalMeshes=0;
      root.traverse?.(child=>{ if(child.userData?.furnitureDecal)decalMeshes++; });
      return {
        id:root.id,
        profile:root.userData?.obeliskProfile||root.userData?.targetProfile||null,
        concealed:root.userData?.concealedStoneFinish===true,
        decalAssets:[...(root.userData?.decalAssets||[])],
        decalMeshes,
        decalMaterials:(root.userData?.decalMaterials||[]).map(material=>({
          color:material.color?.getHexString?.()||null,
          opacity:Number(material.opacity),
          blending:Number(material.blending),
          glow:material.userData?.devRuinGlyphGlow===true,
          image:material.userData?.decalImagePath||null,
        })),
      };
    };
    const before=roots.map(summarize);
    const proxyBefore=window.DevRandomRuinWallRenderProxy?.snapshot?.()||null;
    const target=roots[0]||null;
    const activated=!!target && window.DevRandomRuinHitPuzzles?.debugActivateGlyph?.(target)===true; // Used to exercise the same persistent glyph state mutation reached by a real ranged projectile.
    window.DevRandomRuinWallRenderProxy?.prepare?.();
    await new Promise(resolve=>setTimeout(resolve,90));
    window.DevRandomRuinWallRenderProxy?.prepare?.();
    const after=target?summarize(target):null;
    const proxyAfter=window.DevRandomRuinWallRenderProxy?.snapshot?.()||null;
    return {before,after,proxyBefore,proxyAfter,activated,additive:Number(THREE.AdditiveBlending)};
  });
  assert.ok(glyphVisuals.before.length>0,'projectile-only test must generate at least one glyph target: '+JSON.stringify(glyphVisuals));
  assert.equal(glyphVisuals.activated,true,'projectile glyph diagnostic must enter the same authoritative active state as a real projectile hit: '+JSON.stringify(glyphVisuals));
  assert.ok(glyphVisuals.before.every(glyph=>glyph.concealed===false&&glyph.decalAssets.length>0&&glyph.decalMeshes>0&&glyph.decalMaterials.length>0),'every projectile glyph target must visibly carry authored face decals: '+JSON.stringify(glyphVisuals));
  assert.ok((glyphVisuals.proxyBefore?.glyphDecalProxyCount||0)>0,'game-realm render proxy must include glyph decal planes: '+JSON.stringify(glyphVisuals.proxyBefore));
  assert.ok(glyphVisuals.after?.decalMaterials?.some(material=>material.glow&&material.blending===glyphVisuals.additive&&material.color==='66aaff'),'activated glyph must visibly glow blue through its unlit decal material: '+JSON.stringify(glyphVisuals.after));
  assert.ok((glyphVisuals.proxyAfter?.glowingGlyphDecalProxyCount||0)>0,'activated glyph glow must survive into the visible game-realm proxy: '+JSON.stringify(glyphVisuals.proxyAfter));

  assert.equal(constrained.solvability?.ok, true, JSON.stringify(constrained));
  assert.equal(constrained.solvability?.unsolvedMechanisms?.length, 0, JSON.stringify(constrained.solvability));
  assert.ok(constrained.solvability?.rooms?.every(room => room.reachable), JSON.stringify(constrained.solvability));
  assert.match(constrained.badge, /solvable ✓/, constrained.badge);
  assert.match(constrained.badge, /puzzles \d+\/1 max-room/, constrained.badge);
  assert.deepEqual(constrained.darkness, { enabled:false, severity:1 }, JSON.stringify(constrained));
  assert.equal(constrained.darknessDebug?.undergroundDarknessOverlayAlpha, 0, JSON.stringify(constrained.darknessDebug));
  assert.match(constrained.badge, /dark off/, constrained.badge);

  const darknessCycle = await page.evaluate(async () => {
    const enabled=document.getElementById('devRandomRuinDarknessEnabled');
    const severity=document.getElementById('devRandomRuinDarknessSeverity');
    severity.value='50';
    severity.dispatchEvent(new Event('input',{bubbles:true}));
    enabled.checked=true;
    enabled.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,30));
    const on={settings:window.DevRandomRuin.getDarknessSettings(),debug:window.CloudForestFog.getDebugState(),label:document.getElementById('devRandomRuinDarknessSeverityValue')?.textContent||''};
    enabled.checked=false;
    enabled.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,30));
    const off={settings:window.DevRandomRuin.getDarknessSettings(),debug:window.CloudForestFog.getDebugState()};
    return {on,off};
  });
  assert.equal(darknessCycle.on.settings.enabled,true,JSON.stringify(darknessCycle));
  assert.equal(darknessCycle.on.settings.severity,0.5,JSON.stringify(darknessCycle));
  assert.equal(darknessCycle.on.label,'50%',JSON.stringify(darknessCycle));
  assert.ok(darknessCycle.on.debug.undergroundDarknessOverlayAlpha > 0.4 && darknessCycle.on.debug.undergroundDarknessOverlayAlpha < 0.5,JSON.stringify(darknessCycle));
  assert.equal(darknessCycle.off.settings.enabled,false,JSON.stringify(darknessCycle));
  assert.equal(darknessCycle.off.debug.undergroundDarknessOverlayAlpha,0,JSON.stringify(darknessCycle));
  await page.evaluate(async () => window.DevRandomRuin.leave());
  await page.waitForFunction(() => window.GridTileAccessors.getCurrentArea() !== 'map_i_dev_random_ruin', null, { timeout:10000 });

  // Restore the simple-mode defaults before running broad fixed-seed coverage.
  const restoredSimpleSettings = await page.evaluate(() => {
    const details = document.getElementById('devRandomRuinPuzzleOptions');
    for (const checkbox of details.querySelectorAll('[data-ruin-puzzle-option]')) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles:true }));
    }
    const maxInput = details.querySelector('#devRandomRuinMaxPuzzlesPerRoom');
    maxInput.value = '0';
    maxInput.dispatchEvent(new Event('input', { bubbles:true }));
    return window.DevRandomRuin.getPuzzleGenerationOptions();
  });
  assert.equal(restoredSimpleSettings.safePath,true,JSON.stringify(restoredSimpleSettings));
  assert.equal(restoredSimpleSettings.ropeSwing,true,JSON.stringify(restoredSimpleSettings));
  assert.equal(restoredSimpleSettings.hallwayTraps,true,JSON.stringify(restoredSimpleSettings));
  for(const key of ['pressurePlate','brazier','stackedObelisk','linkedCubePillars','nestedRoom']) assert.equal(restoredSimpleSettings[key],false,JSON.stringify(restoredSimpleSettings));

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
        solvability:window.DevRandomRuin?.getLastSolvabilityAudit?.() || null,
        puzzleOptions:state?.puzzleOptions || null,
        puzzleGeneration:state?.puzzleGeneration || null,
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
      window.DevRandomRuinSimplePuzzles.snapshot().active &&
      window.DevRandomRuinRuntimeCoverage.snapshot().active,
    null, { timeout:10000 });

    const active = await page.evaluate(() => {
      const scene = window.GridTileAccessors.getActiveScene();
      const root = scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
      const hooks = window.DevRandomRuinPrototypeHooks.snapshot();
      const hit = window.DevRandomRuinHitPuzzles.snapshot();
      const motion = window.DevRandomRuinMotionRuntime.snapshot();
      const simple = window.DevRandomRuinSimplePuzzles.snapshot();
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
      const puzzleTowers = [];
      scene?.traverse?.(object => {
        if (object.userData?.generatedAccessType === 'stoneLadder') ladders++;
        if (object.userData?.activatorType === 'stackedObelisk' || object.userData?.activatorType === 'linkedCubePillars') {
          const position = new THREE.Vector3();
          object.updateWorldMatrix?.(true, false);
          object.getWorldPosition?.(position);
          puzzleTowers.push({ id:object.id, type:object.userData.activatorType, x:position.x, z:position.z, blockerPurpose:object.userData.blockerPurpose||null, interactive3D:object.userData.interactive3D===true });
        }
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
        simple,
        coverage,
        wallPlaneControl,
        wallRender,
        materialStats:window.DevRandomRuin.getState()?.materialStats || null,
        occupancy,
        occupancyBlockers:dynamic.blockers.filter(record => record.id === 'devruin-tile-occupancy').length,
        legacyRuinBlockers:dynamic.blockers.filter(record => /^devruin-(wall|solid|door|push)-/.test(record.id)).length,
        transport,
        furnitureStatus,
        ladders,
        puzzleTowers,
        negativeLevels:levels.filter(level => level < 0).length,
        runtimeWallPlanes:generatorState?.runtimeWallPlanes || null,
        runtimeHallways:generatorState?.runtimeHallways || null,
        solvability:window.DevRandomRuin.getState()?.solvability || null,
        generationAttempt:window.DevRandomRuin.getState()?.generationAttempt || 0,
        acceptedSeed:window.DevRandomRuin.getState()?.seed ?? null,
        wallStyle:window.DevRandomRuin.getState()?.wallStyle || null,
        hallwayCollision,
      };
    });

    assert.equal(active.area, 'map_i_dev_random_ruin', JSON.stringify(active));
    assert.equal(active.building, true, JSON.stringify(active));
    assert.equal(active.sceneName, 'map_i_dev_random_ruin', JSON.stringify(active));
    assert.equal(active.hasRoot, true, JSON.stringify(active));
    assert.equal(active.wallStyle, 'cavern', 'Random Test Ruin must use the game\'s combat-interior classification');
    assert.equal(active.solvability?.ok, true, JSON.stringify(active.solvability));
    assert.equal(active.solvability?.unsolvedMechanisms?.length, 0, JSON.stringify(active.solvability));
    assert.ok(active.solvability?.rooms?.length > 0, JSON.stringify(active.solvability));
    assert.ok(active.solvability.rooms.every(room => room.reachable), JSON.stringify(active.solvability));
    assert.ok(active.generationAttempt >= 1 && active.generationAttempt <= 6, JSON.stringify(active));
    assert.equal(active.hit.active, true, JSON.stringify(active.hit));
    assert.equal(active.motion.active, true, JSON.stringify(active.motion));
    assert.equal(active.simple.active, true, JSON.stringify(active.simple));
    assert.equal(active.simple.safeGrids.length, 1, 'simple mode should place one safe-path pressure grid: '+JSON.stringify(active.simple));
    assert.ok(active.simple.safeGrids[0]?.hallId && active.simple.safeGrids[0]?.mandatoryTraversal, 'safe-path pressure grid must occupy a mandatory hallway traversal: '+JSON.stringify(active.simple.safeGrids[0]));
    assert.equal(active.simple.ropes.length, 1, 'simple mode should place one rope traversal: '+JSON.stringify(active.simple));
    const swappableHallwayModules=active.simple.modules.filter(module=>module.slotKind==='hallway'&&['projectileHallwayTrap','chordPressurePlates','hallwayGlyphGate'].includes(module.type));
    assert.ok(swappableHallwayModules.length >= 1, 'simple mode should fill at least one generic hallway module slot: '+JSON.stringify(active.simple));
    assert.ok(active.simple.checkpoints.doorwayCount > 0, 'generated ruin should expose doorway checkpoints: '+JSON.stringify(active.simple.checkpoints));
    assert.equal(active.simple.checkpoints.triggered.includes('ruin-entry'), true, 'entering the ruin must immediately establish the first checkpoint');
    assert.equal(active.coverage.effectiveUnhandled.length, 0, JSON.stringify(active.coverage));
    assert.ok(active.coverage.torchSourceCoverage.complete, JSON.stringify(active.coverage.torchSourceCoverage));
    assert.equal(active.transport?.active, true, JSON.stringify(active.transport));
    assert.equal(active.transport?.sameOrigin, true, JSON.stringify(active.transport));
    assert.equal(active.transport?.expectedFurniturePaths, 11, JSON.stringify(active.transport));
    assert.equal(active.transport?.patchedBindings, 28, JSON.stringify(active.transport));
    assert.equal(active.transport?.runtimePuzzleGenerationOptions, true, JSON.stringify(active.transport));
    assert.equal(active.transport?.headlessEmbeddedPreview, true, JSON.stringify(active.transport));
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
    assert.equal(active.materialStats?.remainingLit, 0, 'generated ruin root must contain zero lit materials: '+JSON.stringify(active.materialStats));
    assert.equal(active.materialStats?.legacyStone, 0, 'generated ruin root must contain zero old dark V50 stone materials: '+JSON.stringify(active.materialStats));
    assert.ok((active.materialStats?.cliffMeshes||0) > 0, 'generated ruin must rebuild V50 stone through the real cliff material path: '+JSON.stringify(active.materialStats));
    assert.ok((active.materialStats?.ceilingCells||0) > 0, 'generated ruin must build a real ceiling over the authored floor footprint: '+JSON.stringify(active.materialStats));
    assert.equal(active.materialStats?.ceilingTextured, true, 'generated ceiling must carry the canonical stone texture map: '+JSON.stringify(active.materialStats));
    assert.equal(active.materialStats?.ceilingNaturalSurface, 'cliffs', 'generated ceiling must use the same carved-smooth cliff material pipeline as ruin stone: '+JSON.stringify(active.materialStats));
    assert.ok(Math.abs((active.simple.ropes[0]?.ceilingY||0)-(active.materialStats?.ceilingY||0))<.06, 'rope anchor must terminate at the real textured ceiling datum: '+JSON.stringify({rope:active.simple.ropes[0],materialStats:active.materialStats}));
    assert.equal(active.wallRender.litProxyMaterials, 0, 'visible game-realm ruin proxies must contain zero lit materials: '+JSON.stringify(active.wallRender));
    assert.ok(active.runtimeHallways?.count > 0, JSON.stringify(active.runtimeHallways));
    assert.ok(active.runtimeHallways.minCrossCells >= 5, JSON.stringify(active.runtimeHallways));
    for (const hall of active.hallwayCollision) {
      assert.ok(hall.samples > 0, `hallway ${hall.id} produced no center-lane samples`);
      assert.equal(hall.blocked.length, 0, `hallway ${hall.id} center lane is blocked: ${JSON.stringify(hall)}`);
    }
    for (const tower of active.puzzleTowers) {
      assert.equal(tower.interactive3D, true, 'puzzle tower must be tagged as a world interactable: '+JSON.stringify(tower));
      assert.match(tower.blockerPurpose||'', /^puzzle_tower_(?:stackedObelisk|linkedCubePillars)$/, 'puzzle tower must feed the authoritative occupancy blocker set: '+JSON.stringify(tower));
    }

    // Wall planes are structural and their old visual toggle is now a no-op.
    // Applying it must not recreate any object-wide wall blockers.
    if (seed === FIXED_SEEDS[0]) {
      const simpleRuntime = await page.evaluate(async () => {
        const deps=window.Combat?.deps;
        const rs=window.ResourceSystem;
        const sleep=frames=>new Promise(resolve=>{
          let left=frames;
          const step=()=>{ if(--left<=0)resolve(); else requestAnimationFrame(step); };
          requestAnimationFrame(step);
        });
        const place=(point)=>{
          if(window.DevRandomRuin?.setPlayerWorldPoint?.(point,{snapCamera:false,grounded:true}))return; // Browser smoke teleports must update the ruin's accepted-position/support authority just like a legitimate grounded arrival.
          deps.player.x=point.x*deps.TILE;
          deps.player.y=point.z*deps.TILE;
          deps.player.vx=0;deps.player.vy=0;
          if(deps.playerMesh?.position){
            deps.playerMesh.position.x=point.x;
            deps.playerMesh.position.z=point.z;
            if(Number.isFinite(Number(point.y)))deps.playerMesh.position.y=Number(point.y);
          }
        };

        const initial=window.DevRandomRuinSimplePuzzles.snapshot();
        const grid=initial.safeGrids[0];
        const unsafe=grid?.unsafe?.[0]||null;
        let burningAfter=null,revealRow=null,revealMs=0;
        if(unsafe){
          const prior=Number(rs.getAffliction?.(deps.player,'burningHealth'))||0;
          if(prior>0)rs.removeAffliction?.(deps.player,'burningHealth',prior+1);
          place({x:unsafe.x,z:unsafe.z,y:deps.playerMesh?.position?.y||0});
          await sleep(3);
          burningAfter=Number(rs.getAffliction?.(deps.player,'burningHealth'))||0;

          const scene=window.GridTileAccessors.getActiveScene();
          const button=scene?.getObjectByName?.('dev_ruin_safe_path_button_'+grid.hallId);
          if(button){
            button.updateWorldMatrix?.(true,true);
            const box=new THREE.Box3().setFromObject(button);
            const center=box.getCenter(new THREE.Vector3());
            place({x:box.max.x+.45,z:center.z,y:center.y});
            window.DevRandomRuinInteractions.refresh();
            await sleep(3);
            const interaction=window.DevRandomRuinInteractions.snapshot();
            const index=interaction.rows.findIndex(row=>row.kind==='safepathreveal');
            revealRow=index>=0?interaction.rows[index]:null;
            if(index>=0)window.DevRandomRuinInteractions.invoke(index);
            await sleep(2);
            revealMs=window.DevRandomRuinSimplePuzzles.snapshot().safeGrids[0]?.revealMs||0;
          }
        }

        let checkpointAfterCross=null,respawn=null;
        const checkpointBefore=window.DevRandomRuinSimplePuzzles.snapshot().checkpoints;
        const door=checkpointBefore.doorways?.[0]||null;
        if(door){
          if(door.axis==='x'){
            place({x:door.x-.9,z:door.z,y:0});await sleep(2);
            place({x:door.x+.9,z:door.z,y:0});await sleep(3);
          }else{
            place({x:door.x,z:door.z-.9,y:0});await sleep(2);
            place({x:door.x,z:door.z+.9,y:0});await sleep(3);
          }
          checkpointAfterCross=window.DevRandomRuinSimplePuzzles.snapshot().checkpoints;
          const respawnsBefore=checkpointAfterCross.respawnCount;
          place({x:checkpointAfterCross.activePoint.x+2,z:checkpointAfterCross.activePoint.z+2,y:checkpointAfterCross.activePoint.y});
          const existingBurn=Number(rs.getAffliction?.(deps.player,'burningHealth'))||0;
          if(existingBurn>0)rs.removeAffliction?.(deps.player,'burningHealth',existingBurn+1);
          deps.player.health=1;
          rs.addAffliction?.(deps.player,'burningHealth',Number(deps.player.maxHealth)||100);
          window.PlayerVitals.updatePlayerVitals(1);
          await sleep(3);
          const cp=window.DevRandomRuinSimplePuzzles.snapshot().checkpoints;
          respawn={
            handled:cp.respawnCount>respawnsBefore,
            reason:cp.lastReason,
            area:window.GridTileAccessors.getCurrentArea(),
            x:deps.player.x/deps.TILE,z:deps.player.y/deps.TILE,
            health:deps.player.health,maxHealth:deps.player.maxHealth,
            activePoint:cp.activePoint,
            respawnCount:cp.respawnCount,
          };
          const directBefore=cp.respawnCount;
          const invulnWaitMs=Math.max(0,(Number(deps.player.invulnUntil)||0)-performance.now()+60); // Used so the second death test does not mistake the checkpoint's intentional 1.2s post-respawn invulnerability for a broken direct-hit death path.
          if(invulnWaitMs>0)await new Promise(resolve=>setTimeout(resolve,invulnWaitMs));
          place({x:cp.activePoint.x+1.6,z:cp.activePoint.z+1.6,y:cp.activePoint.y});
          deps.player.health=1;
          window.Combat.deps.damagePlayer?.((Number(deps.player.maxHealth)||100)*2);
          await sleep(3);
          const directCp=window.DevRandomRuinSimplePuzzles.snapshot().checkpoints;
          respawn.directHit={
            handled:directCp.respawnCount>directBefore,
            reason:directCp.lastReason,
            area:window.GridTileAccessors.getCurrentArea(),
            x:deps.player.x/deps.TILE,z:deps.player.y/deps.TILE,
            activePoint:directCp.activePoint,
          };
        }

        let ropeAttach=null;
        const rope=window.DevRandomRuinSimplePuzzles.snapshot().ropes?.[0]||null;
        if(rope){
          const weaponSwitch=document.getElementById('btnWeaponSwitch'); // Put a real weapon/tool in hand so rope auto-holster/restoration is exercised, not merely statically asserted.
          weaponSwitch?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:811,pointerType:'touch',clientX:8,clientY:8}));
          await sleep(2);
          const beforeAttachEquipment=window.DevRandomRuinSimplePuzzles.snapshot().ropeEquipment;
          place(rope.grabPoint);
          await sleep(3);
          window.DevRandomRuinInteractions.refresh();
          await sleep(2);
          const grabInteraction=window.DevRandomRuinInteractions.snapshot();
          const grabIndex=grabInteraction.rows.findIndex(row=>row.kind==='ropegrab');
          const grabRow=grabIndex>=0?grabInteraction.rows[grabIndex]:null;
          if(grabIndex>=0)window.DevRandomRuinInteractions.invoke(grabIndex); // Rope acquisition must go through the same visible interaction row used by ordinary world objects instead of invisible auto-catch proximity.
          await sleep(3);
          const beforePump=window.DevRandomRuinSimplePuzzles.snapshot();
          const liveRope=beforePump.ropes[0];
          const dx=Math.abs(liveRope.grabPoint.x-liveRope.anchor.x);
          const dz=Math.abs(liveRope.grabPoint.z-liveRope.anchor.z);
          deps.player.inputX=dx>=dz?1:0;
          deps.player.inputY=dz>dx?1:0;
          deps.player.inputStrength=1;
          await sleep(12);
          const afterPump=window.DevRandomRuinSimplePuzzles.snapshot();
          deps.player.inputX=0;deps.player.inputY=0;deps.player.inputStrength=0;
          const interaction=window.DevRandomRuinInteractions.snapshot();
          const releaseIndex=interaction.rows.findIndex(row=>row.kind==='roperelease');
          const brakeIndex=interaction.rows.findIndex(row=>row.kind==='ropebrake');
          document.getElementById('dodgeBtn')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:812,pointerType:'touch',clientX:8,clientY:8})); // Exercises the permanent native Dodge control, not DevRandomRuinInteractions.invoke().
          await sleep(2);
          const afterRelease=window.DevRandomRuinSimplePuzzles.snapshot();
          ropeAttach={
            grabRow,
            grabPopupVisible:grabInteraction.worldPopupVisible,
            attached:beforePump.ropes[0]?.attached===true,
            ceilingMounted:beforePump.ropes[0]?.ceilingMounted===true,
            ceilingY:beforePump.ropes[0]?.ceilingY??null,
            anchorY:beforePump.ropes[0]?.anchor?.y??null,
            bobY:beforePump.ropes[0]?.bob?.y??null,
            grabY:beforePump.ropes[0]?.grabPoint?.y??null,
            startTopY:beforePump.ropes[0]?.startTopY??null,
            endTopY:beforePump.ropes[0]?.endTopY??null,
            weaponStowed:beforePump.ropeEquipment?.currentlyStowed===true && beforePump.ropeEquipment?.holstered>(beforeAttachEquipment?.holstered||0),
            pumpChangedOmega:Math.abs((afterPump.ropes[0]?.omega||0)-(beforePump.ropes[0]?.omega||0))>.02,
            releaseRow:releaseIndex>=0?interaction.rows[releaseIndex]:null,
            brakeRow:brakeIndex>=0?interaction.rows[brakeIndex]:null,
            worldPopupVisible:interaction.worldPopupVisible,
            released:afterRelease.ropes[0]?.attached===false,
            weaponRestored:afterRelease.ropeEquipment?.currentlyStowed===false && afterRelease.ropeEquipment?.restored>(beforeAttachEquipment?.restored||0),
          };
        }

        await new Promise(resolve=>setTimeout(resolve,1100));
        await sleep(2);
        const final=window.DevRandomRuinSimplePuzzles.snapshot();
        return {initial,burningAfter,revealRow,revealMs,checkpointBefore,checkpointAfterCross,respawn,ropeAttach,final};
      });
      assert.ok(simpleRuntime.burningAfter>=20,'unsafe pressure plate must apply Burning Health: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.revealRow?.label,'Reveal Safe Path','safe-path button must enter the ordinary world input list: '+JSON.stringify(simpleRuntime));
      assert.ok(simpleRuntime.revealMs>0,'safe-path button must temporarily reveal the safe plates: '+JSON.stringify(simpleRuntime));
      {
        const grid=simpleRuntime.final.safeGrids?.[0],entry=grid&&simpleRuntime.final.checkpoints?.doorways?.find(door=>door.id===grid.entryDoorId);
        assert.ok(grid?.entryDoorId&&entry,'safe-path diagnostics must identify the actual room-to-hall entrance doorway: '+JSON.stringify(simpleRuntime.final));
        const axis=grid.axis,buttonAlong=axis==='x'?grid.buttonPoint.x:grid.buttonPoint.z,entryAlong=axis==='x'?entry.x:entry.z;
        const plateAlong=grid.safe.concat(grid.unsafe).map(cell=>axis==='x'?cell.x:cell.z);
        const near=Math.min(...plateAlong),far=Math.max(...plateAlong),approachNear=Math.abs(entryAlong-near)<=Math.abs(entryAlong-far);
        assert.equal(grid.approachSide,approachNear?'min':'max','safe-path reveal control must be assigned to the hallway end the player actually approaches from: '+JSON.stringify({grid,entry}));
        assert.ok(approachNear?buttonAlong<near:buttonAlong>far,'safe-path reveal pedestal must sit before the pressure-plate field rather than beyond it: '+JSON.stringify({grid,entry,near,far}));
      }
      assert.match(simpleRuntime.checkpointAfterCross?.activeId||'',/^doorway-/,'crossing a doorway must advance the checkpoint: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.respawn?.handled,true,'ruin checkpoint recovery must handle death locally: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.respawn?.reason,'resource-tick','Burning Health death must route through the real PlayerVitals checkpoint seam: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.respawn?.area,'map_i_dev_random_ruin','checkpoint death recovery must stay inside the generated ruin: '+JSON.stringify(simpleRuntime));
      assert.ok(Math.abs(simpleRuntime.respawn.x-simpleRuntime.respawn.activePoint.x)<.02&&Math.abs(simpleRuntime.respawn.z-simpleRuntime.respawn.activePoint.z)<.02,'checkpoint respawn must land at the last crossed doorway: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.respawn.health,Math.max(1,Math.round(simpleRuntime.respawn.maxHealth*.5)),'checkpoint respawn should match the game half-Health recovery convention: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.respawn?.directHit?.handled,true,'direct-hit death must pass through canonical respawnPlayer and stay at the ruin checkpoint: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.respawn?.directHit?.reason,'death','canonical direct-hit checkpoint recovery must identify the normal death path: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.respawn?.directHit?.area,'map_i_dev_random_ruin','direct-hit checkpoint recovery must not send the player to a Root Totem/farm: '+JSON.stringify(simpleRuntime));
      assert.ok(Math.abs(simpleRuntime.respawn.directHit.x-simpleRuntime.respawn.directHit.activePoint.x)<.02&&Math.abs(simpleRuntime.respawn.directHit.z-simpleRuntime.respawn.directHit.activePoint.z)<.02,'direct-hit respawn must land on the active doorway checkpoint: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.grabRow?.label,'Grab Rope','approaching the traversal rope must expose the ordinary floating input prompt before attachment: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.grabPopupVisible,true,'idle rope grab must render through WorldPopupText: '+JSON.stringify(simpleRuntime));
      assert.ok(['item_action_1','item_action_2'].includes(simpleRuntime.ropeAttach?.grabRow?.inputAction),'ranged/tool combat must keep Action 1–3 while rope grab uses an item-action slot: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.attached,true,'invoking the visible Grab Rope interaction must attach the traversal rope: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.pumpChangedOmega,true,'published movement input must pump the live rope pendulum: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.releaseRow?.label,'Jump Off Rope','attached rope must expose its jump-off input: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.releaseRow?.inputAction,'dodge','rope jump-off prompt must advertise the native Dodge input: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.releaseRow?.nativeInput,true,'rope jump-off must remain owned by canonical Dodge handling: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.brakeRow?.label,'Hold to Stop / Adjust Rope','attached rope must expose its held brake/adjust input: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.worldPopupVisible,true,'rope controls must render through WorldPopupText: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.ceilingMounted,true,'rope must visibly attach to the authored room ceiling: '+JSON.stringify(simpleRuntime));
      assert.ok(Math.abs((simpleRuntime.ropeAttach?.ceilingY||0)-(simpleRuntime.ropeAttach?.anchorY||0))<.001,'rope line origin must equal the ceiling mount datum: '+JSON.stringify(simpleRuntime));
      assert.ok((simpleRuntime.ropeAttach?.endTopY||0)-(simpleRuntime.ropeAttach?.startTopY||0)>.42,'rope destination must be visibly above the ordinary ruin step limit: '+JSON.stringify(simpleRuntime));
      assert.ok(Math.abs((simpleRuntime.ropeAttach?.grabY||0)-((simpleRuntime.ropeAttach?.startTopY||0)+.86))<.08,'idle rope grip must stay at reachable launch-side height instead of inheriting the raised destination: '+JSON.stringify(simpleRuntime));
      assert.ok((simpleRuntime.ropeAttach?.ceilingY||0)>(simpleRuntime.ropeAttach?.bobY||0),'rope must hang downward from the ceiling: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.weaponStowed,true,'grabbing the rope must put the drawn weapon/tool away: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.released,true,'Dodge must transfer the player into rope ballistic flight: '+JSON.stringify(simpleRuntime));
      assert.equal(simpleRuntime.ropeAttach?.weaponRestored,true,'jumping off the rope must restore the exact previously drawn tool/weapon snapshot: '+JSON.stringify(simpleRuntime));
      if(simpleRuntime.final.trapHallways.length>0) assert.ok(simpleRuntime.final.liveProjectiles>0,'a selected projectile-hallway module must actively emit projectiles: '+JSON.stringify(simpleRuntime.final));
      else assert.ok(simpleRuntime.final.chordPlateSets.some(set=>set.slotKind==='hallway'),'a non-trap hallway slot must contain its selected reusable module: '+JSON.stringify(simpleRuntime.final));

      const transitDoorRuntime = await page.evaluate(async () => {
        const sleep=frames=>new Promise(resolve=>{let left=frames;const step=()=>{if(--left<=0)resolve();else requestAnimationFrame(step);};requestAnimationFrame(step);});
        const door=window.DevRandomRuin.getState()?.transitDoors?.[0]||null;
        if(!door?.center)return null;
        const x=door.center.x+(door.axis==='x'?1.05:0),z=door.center.z+(door.axis==='z'?1.05:0);
        window.DevRandomRuin.setPlayerWorldPoint?.({x,z},{snapCamera:false,grounded:true});
        await sleep(4);
        window.DevRandomRuinInteractions.refresh();
        await sleep(2);
        const interaction=window.DevRandomRuinInteractions.snapshot();
        const rowIndex=interaction.rows.findIndex(row=>row.kind==='transitdoor');
        const row=rowIndex>=0?interaction.rows[rowIndex]:null;
        const beforeOcc=window.DevRandomRuin.getOccupancySnapshot?.();
        const sourceId='transit-door:'+door.id;
        const hasSource=snapshot=>Object.values(snapshot?.sources||{}).some(list=>Array.isArray(list)&&list.includes(sourceId));
        const beforeBlocked=hasSource(beforeOcc);
        if(rowIndex>=0)window.DevRandomRuinInteractions.invoke(rowIndex);
        await sleep(28);
        const afterDoor=window.DevRandomRuin.getState()?.transitDoors?.find(entry=>entry.id===door.id)||null;
        const afterBlocked=hasSource(window.DevRandomRuin.getOccupancySnapshot?.());
        return {door,row,worldPopupVisible:interaction.worldPopupVisible,beforeBlocked,afterDoor,afterBlocked};
      });
      assert.ok(transitDoorRuntime,'generated hallway must expose at least one plain transit-exit door: '+JSON.stringify(active));
      assert.equal(transitDoorRuntime.row?.label,'Open Hallway Door','closed hallway transit door must expose the standard floating open-door prompt: '+JSON.stringify(transitDoorRuntime));
      assert.equal(transitDoorRuntime.worldPopupVisible,true,'hallway door prompt must be rendered by WorldPopupText: '+JSON.stringify(transitDoorRuntime));
      assert.equal(transitDoorRuntime.beforeBlocked,true,'visibly closed hallway door must contribute authoritative collision: '+JSON.stringify(transitDoorRuntime));
      assert.ok((transitDoorRuntime.afterDoor?.open||0)>.78,'using the hallway door prompt must visibly retract the door: '+JSON.stringify(transitDoorRuntime));
      assert.equal(transitDoorRuntime.afterBlocked,false,'opened hallway door must release its occupancy blocker: '+JSON.stringify(transitDoorRuntime));

      const towerInteraction = await page.evaluate(async () => {
        const scene=window.GridTileAccessors.getActiveScene();
        let tower=null;
        scene?.traverse?.(object=>{ if(!tower && (object.userData?.activatorType==='stackedObelisk'||object.userData?.activatorType==='linkedCubePillars')) tower=object; });
        if(!tower)return {present:false};
        tower.updateWorldMatrix?.(true,true);
        const box=new THREE.Box3().setFromObject(tower);
        const center=box.getCenter(new THREE.Vector3());
        const probeX=box.max.x+.34, probeZ=center.z;
        const deps=window.Combat?.deps;
        if(deps?.player && deps?.TILE){
          deps.player.x=probeX*deps.TILE; deps.player.y=probeZ*deps.TILE;
          if(deps.playerMesh?.position){deps.playerMesh.position.x=probeX;deps.playerMesh.position.z=probeZ;}
        }
        window.DevRandomRuinInteractions?.refresh?.();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const interactions=window.DevRandomRuinInteractions?.snapshot?.()||null;
        const occupancy=window.DevRandomRuin.getOccupancySnapshot();
        const towerSources=Object.entries(occupancy?.sources||{}).filter(([,sources])=>sources.some(id=>String(id).includes('puzzle_tower_')));
        const buttons=[...document.querySelectorAll('#btnAction1,#btnAction2,#btnAction3,#btnItemAction1,#btnItemAction2')].map(button=>({action:button.dataset.action||null,hidden:button.classList.contains('abt-hidden'),label:button.getAttribute('aria-label')||button.textContent||''}));
        return {present:true,type:tower.userData.activatorType,interactions,towerSources,buttons};
      });
      if(towerInteraction.present){
        assert.ok(towerInteraction.towerSources.length>0,'puzzle tower must own blocked occupancy tiles: '+JSON.stringify(towerInteraction));
        assert.ok(towerInteraction.interactions?.rows?.some(row=>row.kind==='stackedobelisk'||row.kind==='linkedcube'),'puzzle tower must expose a nearby semantic input row: '+JSON.stringify(towerInteraction));
        assert.equal(towerInteraction.interactions?.worldPopupVisible,true,'puzzle tower interaction must use WorldPopupText: '+JSON.stringify(towerInteraction));
        assert.ok(towerInteraction.buttons.some(button=>/^dev_ruin_world_/.test(button.action||'')&&!button.hidden),'puzzle tower must expose a visible mobile action button: '+JSON.stringify(towerInteraction));
      }

      const rangedMobile = await page.evaluate(async () => {
        const switchButton=document.getElementById('btnWeaponSwitch'); // Uses the same mobile combat-toggle control a touch player uses.
        for(let i=0;i<3 && window.Combat?.deps?.getActiveTool?.()!=='ranged';i++){
          switchButton?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:700+i,pointerType:'touch',clientX:8,clientY:8}));
          await new Promise(resolve=>requestAnimationFrame(resolve));
        }
        window.Combat?.deps?.refreshActionBar?.();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const buttons=[...document.querySelectorAll('#btnAction1,#btnAction2,#btnAction3')].map(button=>({
          id:button.id,
          action:button.dataset.action||null,
          hidden:button.classList.contains('abt-hidden'),
          label:button.querySelector('.abt-label')?.textContent||button.getAttribute('aria-label')||'',
        }));
        return {activeTool:window.Combat?.deps?.getActiveTool?.()||null,buttons};
      });
      assert.equal(rangedMobile.activeTool,'ranged',JSON.stringify(rangedMobile));
      assert.ok(rangedMobile.buttons.some(button=>button.action==='shoot'&&!button.hidden),'mobile ranged stance must expose a visible Shoot action: '+JSON.stringify(rangedMobile));
      assert.ok(rangedMobile.buttons.some(button=>button.action==='ammo_select'&&!button.hidden),'mobile ranged stance must expose a visible Ammo action: '+JSON.stringify(rangedMobile));

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
      const ladderStart = await page.evaluate(() => { // Used to prove one authored ladder starts the shared ClimbSystem path from the live generated ruin.
        const scene = window.GridTileAccessors.getActiveScene(); // Used to locate a live V50 stone-ladder root without relying on devtools.
        let ladder = null; // Used to retain the first authored ladder discovered in the active ruin hierarchy.
        scene?.traverse?.(object => { if (!ladder && object.userData?.generatedAccessType === 'stoneLadder') ladder = object; });
        const before = window.DevRandomRuin.getState()?.presentation || null; // Used to detect any post-climb snapback to the original floor.
        const started = !!ladder && window.DevRandomRuinInteractions.climbStoneLadder(ladder); // Used to require the same action path exposed to normal player input.
        return { started, climbing:window.ClimbSystem?.debug?.playerClimbing === true, before };
      });
      assert.equal(ladderStart.started, true, 'authored ruin ladder must resolve endpoints and start traversal: '+JSON.stringify(ladderStart));
      assert.equal(ladderStart.climbing, true, 'authored ruin ladder must use the shared animated ClimbSystem path: '+JSON.stringify(ladderStart));
      await page.waitForFunction(() => window.ClimbSystem?.debug?.playerClimbing === false, null, { timeout:30000 }); // A tallest 12-hop ladder is ~7 s at full cadence; heavy generated-ruin rendering can make headless CI advance its clamped gameplay dt much more slowly, so allow scheduling headroom without changing gameplay cadence.
      await page.waitForTimeout(650);
      const ladderAfter = await page.evaluate(() => window.DevRandomRuin.getState()?.presentation || null); // Used after reconciliation has resumed to prove the landing elevation remains authoritative.
      assert.ok(Number.isFinite(ladderAfter?.elevation) && Number.isFinite(ladderStart.before?.elevation), JSON.stringify({ ladderStart, ladderAfter }));
      assert.ok(Math.abs(ladderAfter.elevation - ladderStart.before.elevation) > .12, 'completed ladder traversal must remain on the opposite elevation instead of snapping back: '+JSON.stringify({ ladderStart, ladderAfter }));
      assert.ok(Math.abs(ladderAfter.bodyY - ladderAfter.elevation) < .20, 'canonical player body must settle onto the ruin support elevation: '+JSON.stringify(ladderAfter));
      if (Number.isFinite(ladderAfter.resourceRingY) && Number.isFinite(ladderAfter.shadowY)) {
        assert.ok(Math.abs(ladderAfter.resourceRingY - ladderAfter.shadowY) < .04, 'resource ring and ground-relative presentation must share one ruin elevation authority: '+JSON.stringify(ladderAfter));
      }
    }
    activeRuns.push({
      seed,
      acceptedSeed:active.acceptedSeed,
      generationAttempt:active.generationAttempt,
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
