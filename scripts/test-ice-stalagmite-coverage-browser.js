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
      '<script src="/docs/js/ice-stalagmite-coverage.js"></script><script src="/docs/js/foliage-generator.js"></script>' +
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
      window.state = { surfaceGrowth: [foliage.normalizeSurfaceGrowth({ kind: 'roots', count: 1, length: .4, texture: '' })], parts: [{ id: 'left' }, { id: 'right' }], selectedType: 'part', selectedId: 'left' };
      window.root = furniture; // Simulates the canonical Furniture V58 state/root globals used by the sidecar.
      left.userData.surfaceFoliageId = 'left'; right.userData.surfaceFoliageId = 'right';
      window.activePartIds = () => [window.state.selectedId];
      window.rebuildSurfaceFoliage = () => foliage.applySurfaceGrowth(window.root, window.state.surfaceGrowth);
      window.queueUndoHistory = () => { window.undoCalls = (window.undoCalls || 0) + 1; };
      window.log = () => {};
      return {normalized: recipe, initialStats, minY, maxY, minX, maxX, stable, persisted, missingTargetEmpty, capped, cleaned, selfTest};
    });
    assert.equal(geometryResult.normalized.kind, 'iceStalagmites', 'Normalization must retain the ice kind');
    assert.equal(geometryResult.normalized.iceFacets, 6, 'Ice-only settings must survive the common JSON schema');
    assert(geometryResult.initialStats.spikes > 0 && geometryResult.initialStats.triangles > 0, 'Expected real faceted Three geometry');
    assert(geometryResult.minY >= -.016 && geometryResult.maxY <= 1.301, 'Spikes should start at floor level and point upward');
    assert(geometryResult.minX > -3 && geometryResult.maxX < -1, 'Selected furniture target must exclude distant pieces');
    assert(geometryResult.stable && geometryResult.persisted, 'Saved seed must regenerate identical geometry across JSON round-trip');
    assert(geometryResult.missingTargetEmpty && geometryResult.capped && geometryResult.cleaned, 'Empty targets, safety limits, and cleanup must work');
    assert.equal(geometryResult.selfTest.ok, true, 'In-editor mobile geometry self-check must succeed');

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
