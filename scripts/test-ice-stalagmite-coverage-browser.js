'use strict';
// Browser regression for the shared ice layer, actual Three r128 geometry,
// and the dedicated Furniture Editor tab. CI installs Playwright and Three.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
let chromium; // Actual browser catches Three and DOM failures missed by syntax checks.
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed (browser-only ice smoke test)');
  process.exit(0);
}
const root = path.resolve(__dirname, '..'); // Local source tree, not a deployed or stale branch.
const localThree = path.join(root, 'node_modules/three/build/three.min.js'); // The pinned production-compatible library.
const server = http.createServer((request, response) => {
  const route = decodeURIComponent((request.url || '/').split('?')[0]); // Query strings never become filesystem paths.
  if (route === '/ice-test') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html><head><script src="/vendor-three.js"></script>' +
      '<script src="/docs/js/ice-stalagmite-coverage.js"></script><script src="/docs/js/foliage-generator.js"></script><script src="/docs/js/dungeon-door-ice-coverage.js"></script><script src="/docs/js/authored-furniture-runtime.js"></script>' +
      '</head><body><div id="tab-ice"></div><pre id="debugLog"></pre></body></html>');
    return;
  }
  if (route === '/vendor-three.js') {
    fs.readFile(localThree, (error, bytes) => {
      if (error) { response.writeHead(404); response.end(error.message); return; }
      response.setHeader('Content-Type', 'application/javascript'); response.end(bytes);
    });
    return;
  }
  const file = path.resolve(root, route.replace(/^\/+/, '')); // Explicit root confinement protects the local HTTP smoke server.
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { response.writeHead(404); response.end(error.message); return; }
    response.setHeader('Content-Type', 'application/javascript'); response.end(bytes);
  });
});

(async () => {
  assert(fs.existsSync(localThree), 'Install three@0.128.0 alongside Playwright before the ice browser smoke.');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser; // Release Chromium even when a regression fails an assertion.
  try {
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
    const page = await browser.newPage();
    const errors = []; // Captures UI and procedural geometry exceptions, including those not displayed in the document.
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/ice-test', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!(window.THREE && window.FoliageGenerator?.applySurfaceGrowth && window.IceStalagmiteCoverage?.build));
    const geometryResult = await page.evaluate(() => {
      const T = THREE, foliage = window.FoliageGenerator; // Test browser-local Three and real shipped geometry.
      const furniture = new T.Group(); // Independent sample furniture with an explicit floor at local Y=0.
      const left = new T.Mesh(new T.BoxGeometry(1, 1.6, 1), new T.MeshBasicMaterial());
      left.name = 'Left lower pillar'; left.position.set(-2, .8, 0); left.userData.authoredPartId = 'left'; furniture.add(left);
      const right = new T.Mesh(new T.BoxGeometry(1, 1.6, 1), new T.MeshBasicMaterial());
      right.name = 'Right lower pillar'; right.position.set(2, .8, 0); right.userData.authoredPartId = 'right'; furniture.add(right);
      const high = new T.Mesh(new T.BoxGeometry(1, .4, 1), new T.MeshBasicMaterial());
      high.name = 'Elevated roof'; high.position.set(0, 4, 0); high.userData.authoredPartId = 'high'; furniture.add(high);
      const recipe = foliage.normalizeSurfaceGrowth({ // Saved shape travels through the real normalizer.
        kind: 'iceStalagmites', seed: 'browser-ice', target: 'selected', targetIds: ['left'],
        count: 26, density: 1, radius: .11, iceHeightMin: .2, iceHeightMax: 1.3,
        iceCluster: 5, iceEngulf: .7, iceFootprintPadding: .04,
        iceFacets: 6, iceLean: .13, iceTipSharpness: .9,
        iceRoughness: .18, iceOpacity: .91, color: '#a9deff'
      });
      const getLayer = () => furniture.children.find(child => child.userData.iceStalagmites);
      const signature = layer => Array.from(layer.children[0]?.geometry.attributes.position.array || []).join(',');
      foliage.applySurfaceGrowth(furniture, [recipe]); // Existing editor/game runtime lifecycle owns this layer.
      const first = getLayer();
      const initialStats = { ...first.userData.surfaceGrowthStats };
      const firstPositions = first.children[0].geometry.attributes.position;
      let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < firstPositions.count; i++) {
        minY = Math.min(minY, firstPositions.getY(i));
        maxY = Math.max(maxY, firstPositions.getY(i));
        minX = Math.min(minX, firstPositions.getX(i));
        maxX = Math.max(maxX, firstPositions.getX(i));
      }
      const initialSignature = signature(first);
      foliage.applySurfaceGrowth(furniture, [recipe]); // Rebuild must dispose only its generated geometry, not source furniture.
      const stable = signature(getLayer()) === initialSignature;
      const saved = JSON.parse(JSON.stringify(recipe)); // Simulates export/import without adding editor-only keys.
      foliage.applySurfaceGrowth(furniture, [foliage.normalizeSurfaceGrowth(saved)]);
      const persisted = signature(getLayer()) === initialSignature;
      foliage.applySurfaceGrowth(furniture, [{ ...recipe, targetIds: ['missing'] }]);
      const missingTargetEmpty = getLayer().children.length === 0;
      foliage.applySurfaceGrowth(furniture, [{ ...recipe, count: 80, iceCluster: 8, target: 'all' }]);
      const capped = getLayer().userData.surfaceGrowthStats.spikes <= window.IceStalagmiteCoverage.MAX_SPIKES;
      foliage.applySurfaceGrowth(furniture, []);
      const cleaned = !getLayer() && furniture.children.length === 3 && furniture.children.every(child => child.isMesh);
      const selfTest = window.IceStalagmiteCoverage.selfTest(T); // Public mobile self-check uses the same implementation.
      const door = new T.Group(); // Arbitrary authored stone door; the coverage builder must not require a particular furniture ID.
      const leaf = new T.Mesh(new T.BoxGeometry(3.16, 3.1, .26), new T.MeshStandardMaterial()); // Same leaf size as the uploaded boss-door scale reference.
      leaf.name = 'Door Leaf'; leaf.position.set(4, 1.55, 1); leaf.userData.authoredPartId = 'leaf'; door.add(leaf);
      const iceParent = new T.Group(); // Door ice stays in world space while the original door can animate independently.
      const placement = window.DungeonDoorIceCoverage.create({ door, parent: iceParent, groundY: 0, seed: 'tothal-door:test' });
      const sourceDimensions = placement && placement.recipe; // Author-derived scaled recipe is saved through the shared normalizer.
      const iceGeometry = placement?.iceLayer?.children?.[0]?.geometry; // Checks actual mesh vertices, not shader/material opacity.
      const full = new Float32Array(iceGeometry?.getAttribute('position').array || []);
      const anchors = iceGeometry?.userData?.iceGrowthAnchors;
      const generatedDoorIce = full.length > 0 && iceParent.children.length === 1; // Old transparent door sheet must not be present.
      window.DungeonDoorIceCoverage.setGrowth(placement, .5); // Midpoint should be a geometric lerp to individual ground origins.
      const midpoint = iceGeometry.getAttribute('position').array;
      const midpointCorrect = midpoint.every((value, i) => Math.abs(value - .5 * (full[i] + anchors[i])) < .000002);
      window.DungeonDoorIceCoverage.setGrowth(placement, 0); // At zero the ice must be invisible and non-raycastable.
      const fullyMelted = iceGeometry.getAttribute('position').array.every((value, i) => Math.abs(value - anchors[i]) < .000002) &&
        placement.iceLayer.children[0].visible === false;
      window.DungeonDoorIceCoverage.setGrowth(placement, 1); // Reverse lerp must restore the exact authored facets.
      const restoredDoorIce = iceGeometry.getAttribute('position').array.every((value, i) => value === full[i]);
      const shorterDoor = new T.Group(); // A different door size gets appropriately scaled ice, not a boss-only recipe.
      const smallerLeaf = new T.Mesh(new T.BoxGeometry(1.8, 1.9, .2), new T.MeshStandardMaterial());
      smallerLeaf.userData.authoredPartId = 'leaf'; smallerLeaf.position.y = .95; shorterDoor.add(smallerLeaf);
      const smallIce = window.DungeonDoorIceCoverage.create({ door: shorterDoor, parent: new T.Group(), groundY: 0, seed: 'short-door' });
      const scaledSmallDoor = smallIce?.recipe?.iceHeightMax < placement?.recipe?.iceHeightMax &&
        smallIce?.recipe?.radius < placement?.recipe?.radius; // The same builder supports full and ordinary-sized door leaves.
      const coveringDoorFace = anchors && anchors.some((value, i) => i % 3 === 0 && Math.abs(value) < 1); // Geometry anchors are door-local; engulf must cover the leaf face, not only its outer corners.

      let readyCallbacks = 0; // Ensures a preexisting source-ready handler isn't lost to the ice lifecycle.
      window.ProceduralFurniture = { buildPartMesh() {
        const driver = new T.Mesh(new T.BoxGeometry(.001, .001, .001), new T.MeshBasicMaterial());
        driver.userData.furnitureGlbPart = true;
        driver.userData.onRockSourceReady = () => { readyCallbacks++; };
        return driver;
      } };
      const glbData = { key: 'ice_glb_test', parts: [{kind: 'glb', id: 'loaded_fixture'}],
        recognizedSurfaces: [], itemPlacements: [],
        surfaceGrowth: [{...recipe, targetIds: ['loaded_fixture']}] };
      const glbGroup = window.AuthoredFurniture.buildGroup(glbData, 0xffffff);
      const glbDriver = glbGroup.userData.meshById.get('loaded_fixture');
      const initialGlbEmpty = !glbGroup.children.some(child => child.userData.iceStalagmites && child.children.length);
      const realChild = new T.Mesh(new T.BoxGeometry(1.5, 1, 1.5), new T.MeshBasicMaterial());
      realChild.position.y = .5; glbDriver.add(realChild); // Mimics the real asynchronous GLTFLoader child insertion.
      glbDriver.userData.onRockSourceReady(); // Runtime must rerun ice after GLB has real render geometry.
      const glbAfterReady = glbGroup.children.some(child => child.userData.iceStalagmites &&
        child.userData.surfaceGrowthStats?.spikes > 0);
      const glbReadyPreservesCallback = readyCallbacks === 1;
      window.state = { surfaceGrowth: [foliage.normalizeSurfaceGrowth({ kind: 'roots', count: 1, length: .4, texture: '' })], parts: [{ id: 'left' }, { id: 'right' }], selectedType: 'part', selectedId: 'left' };
      window.root = furniture; // Simulates the canonical Furniture V58 state/root globals used by the sidecar.
      left.userData.surfaceFoliageId = 'left'; right.userData.surfaceFoliageId = 'right';
      window.activePartIds = () => [window.state.selectedId];
      window.rebuildSurfaceFoliage = () => foliage.applySurfaceGrowth(window.root, window.state.surfaceGrowth);
      window.queueUndoHistory = () => { window.undoCalls = (window.undoCalls || 0) + 1; };
      window.log = () => {};
      return {normalized: recipe, initialStats, minY, maxY, minX, maxX, stable, persisted, missingTargetEmpty, capped, cleaned, selfTest, initialGlbEmpty, glbAfterReady, glbReadyPreservesCallback, sourceDimensions, generatedDoorIce, midpointCorrect, fullyMelted, restoredDoorIce, scaledSmallDoor, coveringDoorFace};
    });
    assert.equal(geometryResult.normalized.kind, 'iceStalagmites', 'Normalization must retain the ice kind');
    assert.equal(geometryResult.normalized.iceFacets, 6, 'Ice-only settings must survive the common JSON schema');
    assert(geometryResult.initialStats.spikes > 0 && geometryResult.initialStats.triangles > 0, 'Expected real faceted Three geometry');
    assert(geometryResult.minY >= -.016 && geometryResult.maxY <= 1.301, 'Spikes should start at floor level and point upward');
    assert(geometryResult.minX > -3 && geometryResult.maxX < -1, 'Selected furniture target must exclude distant pieces');
    assert(geometryResult.stable && geometryResult.persisted, 'Saved seed must regenerate identical geometry across JSON round-trip');
    assert(geometryResult.missingTargetEmpty && geometryResult.capped && geometryResult.cleaned, 'Empty targets, safety limits, and cleanup must work');
    assert.equal(geometryResult.selfTest.ok, true, 'In-editor mobile geometry self-check must succeed');
    assert(geometryResult.generatedDoorIce && geometryResult.midpointCorrect && geometryResult.fullyMelted && geometryResult.restoredDoorIce,
      'Visible door ice must grow and melt by reversing original crystal geometry, not by fading a sheet');
    assert.equal(geometryResult.sourceDimensions.iceHeightMin, 2, 'Boss-door reference must retain its 2-unit minimum spike height');
    assert.equal(geometryResult.sourceDimensions.iceHeightMax, 3, 'Boss-door reference must retain its 3-unit maximum spike height');
    assert.equal(geometryResult.sourceDimensions.radius, .5, 'Boss-door reference must retain its .5-unit base radius');
    assert(geometryResult.scaledSmallDoor && geometryResult.coveringDoorFace,
      'Any eligible door size must inherit scaled ice and engulf its actual leaf surface');
    assert(geometryResult.initialGlbEmpty && geometryResult.glbAfterReady && geometryResult.glbReadyPreservesCallback, 'Imported GLB should gain ice after load and retain source-ready callbacks');

    await page.evaluate(() => {
      window.__iceFireTargets = new Map(); // The real composer registers its fire targets through this minimal existing contract.
      window.__iceSolids = new Map(); // Collision callback truthiness is checked both frozen and melting.
      window.DungeonFire = {
        registerTarget: record => { window.__iceFireTargets.set(record.id, record); return record.id; },
        unregisterTarget: id => { window.__iceFireTargets.delete(id); },
        debugSnapshot: () => ({ armed: false }), clear: () => window.__iceFireTargets.clear()
      };
      window.DevRandomRuinTileOccupancy = {
        blocksAt: () => false, addSolidBox: (id, box, enabled) => window.__iceSolids.set(id, {box, enabled}),
        clearSolids: () => window.__iceSolids.clear(), refresh: () => {}
      };
      window.NearbyVolumeCollision = { invalidate: () => {} };
      window.DevRandomRuinSimplePuzzles = {
        registerComposer: composer => { window.__iceComposer = composer; return true; }
      }; // Registers production buildRooms/update/clear without any dummy scene implementation.
    });
    await page.addScriptTag({ url: '/docs/js/dev-random-ruin-dungeon-fire.js' });
    const dungeonResult = await page.evaluate(() => {
      const T = THREE, composer = window.__iceComposer; // Actual Three materials, collider and fire-trigger lifecycle.
      const scene = new T.Group(), contextRoot = new T.Group(), owner = new T.Group();
      const stoneDoor = new T.Group(); // Existing generator stone-door mechanism rather than a dummy sheet.
      stoneDoor.userData.previewMotion = {type:'stoneDoor'};
      const stoneLeaf = new T.Mesh(new T.BoxGeometry(3.16, 3.1, .26), new T.MeshStandardMaterial());
      stoneLeaf.name = 'Door Leaf'; stoneLeaf.position.set(2, 1.55, 2); stoneDoor.add(stoneLeaf);
      contextRoot.add(stoneDoor);
      const transit = new T.Group(); // A second eligible door type demonstrates generic coverage discovery.
      transit.userData.transitDoor = true;
      const transitLeaf = new T.Mesh(new T.BoxGeometry(1.8, 1.9, .2), new T.MeshStandardMaterial());
      transitLeaf.position.set(6, .95, 2); transit.add(transitLeaf); contextRoot.add(transit);
      const modularDoor = new T.Mesh(new T.BoxGeometry(2, 1.9, .18), new T.MeshStandardMaterial());
      modularDoor.userData.devRandomRuinModularDoor = true; modularDoor.position.set(4, .95, 2);
      owner.add(modularDoor); // Modular doors are built by a different composer after dungeon fire buildRooms.
      scene.add(contextRoot);scene.add(owner);
      const rooms=[{id:'a',col:0,row:0,w:4,h:4},{id:'b',col:4,row:0,w:4,h:4}]; // Enough ground for source braziers and hanging Burdens.
      const floorSet=new Set();for(let x=0;x<8;x++)for(let z=0;z<4;z++)floorSet.add(x+','+z);
      const context={scene,root:contextRoot,theme:'tothal',seed:123,meta:{rooms,floorSurfaceY:0,wallHeight:3.3},floorSet,ceilingY:3.4};
      const kit={state:{group:owner,lockDoors:[{panel:modularDoor,progress:0}]},group:()=>owner,
        sampleSupport:()=>({y:0}),roomBounds:(_meta,room)=>({minX:room.col,maxX:room.col+room.w,minZ:room.row,maxZ:room.row+room.h})};
      composer.buildRooms(kit,context);
      composer.update(kit,0,.016); // Discover real doors once subsequent composers have finished.
      const frozen = window.DevRandomRuinDungeonFire.snapshot().iceWalls;
      const coverage = []; owner.traverse(child=>{if(child.userData?.dungeonDoorIce)coverage.push(child);});
      const noVisibleSheet = owner.children.some(child=>child.name==='dev_random_ruin_dungeon_fire') &&
        coverage.length===2 && !owner.children.some(child=>child.name.startsWith('tothal_dungeon_fire_ice_wall_'));
      const targets = [...window.__iceFireTargets.values()].filter(value => value.id.startsWith('dungeon-fire-ice-wall-'));
      const fire = targets[0]?.onBurn?.();
      const freed = frozen.length === 2 && fire===true && window.__iceSolids.get('dungeon-fire-ice-wall-footprint-0')?.enabled() === false;
      composer.update(kit,0,.8); // Halfway through the actual 1.6-second melt lerp.
      const halfway = window.DevRandomRuinDungeonFire.snapshot().iceWalls[0];
      const halfGrowth = halfway?.phase==='melting' && Math.abs(halfway.growth-.5)<.00001;
      composer.update(kit,0,.8);
      const melted = window.DevRandomRuinDungeonFire.snapshot().iceWalls[0];
      const finished = melted?.phase==='melted' && melted?.growth===0 && !window.__iceFireTargets.has('dungeon-fire-ice-wall-0');
      composer.clear();
      const cleanup = window.DevRandomRuinDungeonFire.snapshot().active===false && window.__iceSolids.size===0;
      return {frozen, noVisibleSheet, freed, halfGrowth, finished, cleanup};
    });
    assert.equal(dungeonResult.frozen.length, 2, 'Tothal should frost two real door objects, not arbitrary empty passageways');
    assert(dungeonResult.frozen.some(wall=>wall.doorType==='stoneDoor') &&
      dungeonResult.frozen.some(wall=>wall.doorType==='modularDoor'),
      'Real generated and late-built modular door types must be eligible in the same room');
    assert(dungeonResult.noVisibleSheet && dungeonResult.freed,
      'Invisible projectile and tile blockers must coexist with visible procedural ice, then unlock on fire');
    assert(dungeonResult.halfGrowth && dungeonResult.finished && dungeonResult.cleanup,
      'Dungeon Fire must reverse ice growth continuously, unregister hits, and clear its owned meshes');

    await page.addScriptTag({ url: '/docs/tools/furniture-avatar-author/ice-stalagmites.js' });
    const uiResult = await page.evaluate(() => {
      const target = document.getElementById('ice-target'); // Controls are the real separate tab, not test-only copies.
      const generate = document.getElementById('ice-generate');
      target.value = 'selected';
      target.dispatchEvent(new Event('change'));
      generate.click();
      const saved = state.surfaceGrowth; // Root recipe remains alongside the newly authored ice recipe.
      const savedIce = saved.find(layer => layer.kind === 'iceStalagmites');
      const generated = root.children.some(child => child.userData.iceStalagmites && child.children.length > 0);
      document.getElementById('ice-test').click(); // The diagnostic must report within the viewport, not devtools.
      const testStatus = document.getElementById('ice-status').textContent;
      document.getElementById('ice-remove').click();
      return {
        tabPresent: !!document.getElementById('tab-ice'),
        generated, savedIce, testStatus,
        preservedRoot: state.surfaceGrowth.length === 1 && state.surfaceGrowth[0].kind === 'roots',
        undoCalls: window.undoCalls || 0
      };
    });
    assert(uiResult.tabPresent && uiResult.generated, 'Tab must create an actual visible ice preview');
    assert.deepEqual(uiResult.savedIce.targetIds, ['left'], 'Selected part IDs must be captured in exported layer recipe');
    assert.equal(uiResult.savedIce.kind, 'iceStalagmites');
    assert.match(uiResult.testStatus, /PASS:/, 'Mobile debug self-check status must be readable');
    assert(uiResult.preservedRoot && uiResult.undoCalls >= 2, 'Editing ice must not replace roots and must participate in undo');
    assert.deepEqual(errors, [], 'Browser geometry and dedicated furniture UI should not emit page errors');
    console.log('Ice Stalagmites browser smoke passed: Three geometry, saved layers, targeting, deterministic regeneration, cleanup, UI controls and mobile diagnostics.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
