#!/usr/bin/env node
'use strict';
// Real browser and real ControllerUI/SelectSteppers: scripted A/B/D-pad actions, not markup regexes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium; // Chromium runs the actual controller navigation, focus and panel mutation observers.
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed (browser-only test)');
  process.exit(0);
}
const root = path.resolve(__dirname, '..'); // Files from the checked-out PR instead of deployed main.
const source = name => fs.readFileSync(path.join(root, 'docs/js', name), 'utf8'); // Loaded through script tags without starting the full WebGL game.

(async () => {
  const pinned = '/opt/pw-browsers/chromium'; // CI uses Playwright's bundled Chromium when no sandbox binary exists.
  const executablePath = process.env.FARMWORK_CHROMIUM_PATH || (fs.existsSync(pinned) ? pinned : undefined);
  const browser = await chromium.launch({ executablePath, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 940, height: 800 } });
    const errors = []; // Page exceptions surfaced for mobile-only contributors who cannot inspect a browser console.
    page.on('pageerror', error => errors.push(error.stack || error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setContent(`<style>
      #farmworkPanel { display:none;position:absolute;left:100px;top:30px;width:420px;height:730px;overflow:auto;background:#222;color:white; }
      .fw-grid { display:grid;grid-template-columns:repeat(7,1fr); }
      button,select,input { min-height:26px; }
      .fw-settings { display:grid;gap:8px }
      .fw-actions, .fw-plots, .fw-nav { display:flex;gap:6px }
    </style>
    <div id="farmworkToolHud" style="display:none"></div><div id="farmworkPanel" data-ctrl-panel style="display:none">
      <button data-ctrl-cancel onclick="window.FarmworkUI.close()">Close</button>
      <div id="farmworkContents" data-ctrl-transparent></div>
    </div><div id="farmPlotsPane" style="display:none"></div>`);
    await page.evaluate(() => {
      window.__savedFarmwork = 0; // Count saves to prove the actual data owner's callbacks are used.
      window.RomanceSystem = { getSpouse: () => ({ npcId: 'aliri_ginju' }), helpers: { npcName: () => 'Aliri' } };
      window.RomanceFamily = { snapshot: () => ({ children: [] }) };
      window.NpcFarmPlots = { registerFarmPlots: () => {} };
      window.FarmEditor = { farmworkTileAccess: () => ({
        editable: true, cols: 16, rows: 16,
        centerTile: () => ({ col: 5, row: 5 }),
        canDesignate: (c, r) => c >= 0 && c < 16 && r >= 0 && r < 16,
        screenTile: () => ({ col: 5, row: 5 }),
        aimTile: () => ({ col: 5, row: 5 }),
        showToast: () => {},
      }) };
    });
    await page.addScriptTag({ content: source('controller-ui-nav.js') });
    await page.addScriptTag({ content: source('controller-select-steppers.js') });
    await page.addScriptTag({ content: source('world-action-input-claims.js') });
    await page.addScriptTag({ content: source('farm-plot-editor.js') });
    await page.addScriptTag({ content: source('farmwork-ui.js') });
    const opened = await page.evaluate(() => {
      window.FarmPlotEditor.init({ save: () => { window.__savedFarmwork++; }, cropLabel: id => id });
      const ok = window.FarmworkUI.open();
      window.ControllerUI.focusPanel(document.getElementById('farmworkPanel'));
      return { ok, panel: window.ControllerUI.activePanel()?.id, focus: window.ControllerUI.focusedElement()?.dataset?.fwnew };
    });
    assert.deepEqual(opened, { ok: true, panel: 'farmworkPanel', focus: 'till' }, 'Controller starts on New Field rather than the close button');
    const created = await page.evaluate(() => {
      window.ControllerUI.press('confirm');
      const p = window.FarmPlotEditor.plots()[0];
      return { kind: p?.kind, spouse: p?.workers?.[0], saved: window.__savedFarmwork };
    });
    assert.equal(created.kind, 'till', 'controller A creates a real family field');
    assert.equal(created.spouse, 'aliri_ginju', 'new field is automatically assigned to spouse');
    assert(created.saved > 0, 'new field persists');
    await page.waitForTimeout(120); // Mutation observers wrap dynamically generated crop/worker selects with controller steppers.
    const stepped = await page.evaluate(() => {
      const input = document.querySelector('[data-fwfield="crop"]');
      const arrow = input?.closest('.select-stepper')?.querySelector('.select-stepper-next');
      if (!arrow) return { missing: true };
      arrow.focus();
      window.ControllerUI.press('confirm');
      return {
        crop: window.FarmPlotEditor.plots()[0].crop,
        focusAlive: !!window.ControllerUI.focusedElement()?.isConnected,
        name: document.querySelector('[data-fwfield="crop"]')?.name,
      };
    });
    assert.equal(stepped.missing, undefined, 'crop select must have controller Confirm stepper arrows');
    assert.equal(stepped.crop, 'needlegrain', 'controller A on crop stepper changes field crop');
    assert.equal(stepped.focusAlive, true, 'focus moves to a surviving control after the panel rerenders');
    assert.equal(stepped.name, 'fw-crop', 'dropdown retains stable key across redraw');
    const planned = await page.evaluate(() => {
      document.querySelector('[data-fwplan]').focus();
      window.ControllerUI.press('confirm');
      const equipped = window.FarmworkUI.isPlanning();
      const hidden = document.getElementById('farmworkPanel').style.display === 'none';
      const press = action => { window.WorldActionInputClaims.dispatch(action, 'press'); window.WorldActionInputClaims.dispatch(action, 'release'); };
      press('action1');
      press('action1');
      const assigned = window.FarmPlotEditor.plots()[0].tiles.length === 1;
      press('action2');
      const cleared = !window.FarmPlotEditor.plots()[0].tiles.length;
      press('action3');
      return { equipped, hidden, assigned, cleared, restored: document.getElementById('farmworkPanel').style.display === 'flex' };
    });
    assert.deepEqual(planned, { equipped: true, hidden: true, assigned: true, cleared: true, restored: true }, 'controller equips the tool; explicit physical actions add/remove; Done returns to settings');
    await page.waitForTimeout(120);
    const silhouette = await page.evaluate(() => {
      const id = window.FarmPlotEditor.activeFamilyPlot().id;
      [[4,4],[4,5],[5,5]].forEach(([c,r]) => window.FarmPlotEditor.setFamilyTile(id,c,r,true));
      window.FarmworkUI.render();
      return {
        tiles: document.querySelectorAll('[data-fwtile]').length,
        excluded: !!document.querySelector('[data-fwtile="5,4"]'),
        last: document.querySelector('[data-fwtile="5,5"]').style.gridColumn,
        pages: document.querySelectorAll('[data-fwpage]').length,
      };
    });
    assert.deepEqual(silhouette, { tiles: 3, excluded: false, last: '2', pages: 0 }, 'single-plot preview preserves an L silhouette without extra containers or pages');
    const removed = await page.evaluate(() => {
      document.querySelector('[data-fwdelete]').focus();
      window.ControllerUI.press('confirm');
      const guarded = window.FarmPlotEditor.plots().length === 1 && document.querySelector('[data-fwdelete]').textContent.includes('Confirm');
      window.ControllerUI.press('confirm');
      return { guarded, removed: window.FarmPlotEditor.plots().length === 0 };
    });
    assert.deepEqual(removed, { guarded: true, removed: true }, 'double-confirm removal is fully accessible through controller A');
    const closed = await page.evaluate(() => {
      window.ControllerUI.press('cancel');
      return document.getElementById('farmworkPanel').style.display === 'none';
    });
    assert.equal(closed, true, 'controller B closes the Farmwork panel');
    // Real r128 geometry and the production shared glow renderer, including cleanup on mode changes.
    if (process.env.FARMWORK_THREE_PATH) await page.addScriptTag({ content: fs.readFileSync(process.env.FARMWORK_THREE_PATH, 'utf8') });
    else await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js' });
    await page.addScriptTag({ content: source('perception-mode.js') });
    const visuals = await page.evaluate(() => {
      const T = window.THREE, scene = new T.Scene();
      const renderer = new T.WebGLRenderer({ antialias: true });
      renderer.setSize(420, 320);
      document.body.appendChild(renderer.domElement);
      const camera = new T.PerspectiveCamera(50, 420 / 320, .1, 100);
      camera.position.set(7, 12, 15); camera.lookAt(5, 0, 5);
      const ground = new T.Mesh(new T.PlaneGeometry(16,16), new T.MeshBasicMaterial({ color: 0x25452a }));
      ground.rotation.x = -Math.PI / 2; ground.position.set(8,0,8); scene.add(ground);
      let height = 0;
      window.FarmSurfaceSample = { farmSurfaceYAtWorld: () => height };
      const access = window.FarmEditor.farmworkTileAccess();
      window.FarmEditor.farmworkTileAccess = () => ({ ...access, scene });
      window.RomanceFamily.snapshot = () => ({ children: [{ id: 'child_1', phase: 'child' }] });
      const vat = new T.Mesh(new T.BoxGeometry(1,1,1), new T.MeshBasicMaterial({ color: 0x777777 }));
      vat.position.set(6,.5,5); scene.add(vat);
      window.DewVats = { listSqueezingVats: () => [{ id: 'vat_1', mesh: vat }], assignedWorkerForVat: () => null };
      window.PerceptionMode.init({ THREE: T, getActiveScene: () => scene, getPlayerTile: () => ({ x:5,z:5 }), getSources: () => ({}) });
      window.PerceptionMode.setActive(true);
      window.FarmworkUI.open();
      const perceptionOff = !window.PerceptionMode.isActive();
      const id = window.FarmPlotEditor.createFamilyPlot('till');
      [[4,4],[4,5],[5,5]].forEach(([c,r]) => window.FarmPlotEditor.setFamilyTile(id,c,r,true));
      window.FarmworkUI.changePlot(id);
      window.PerceptionMode.update(1000);
      const grid = scene.getObjectByName('farmwork-white-grid');
      const originalGeometry = grid.geometry;
      const hasGrid = !!grid && grid.material.fragmentShader.includes('halo');
      renderer.render(scene,camera);
      window.PerceptionMode.renderOverlay(renderer,scene,camera);
      const mask = window.PerceptionMode.debugMaskCoverage();
      height = .2;
      window.PerceptionMode.update(1500);
      const reused = scene.getObjectByName('farmwork-white-grid').geometry === originalGeometry;
      const grounded = Math.abs(originalGeometry.attributes.position.getY(0) - .235) < .001;
      const categories = window.PerceptionMode.debugSnapshot().byCategory;
      window.PerceptionMode.setActive(true);
      const cleaned = !scene.getObjectByName('farmwork-ground-planning') && !window.FarmworkUI.isOpen();
      renderer.dispose();
      return { perceptionOff, hasGrid, reused, grounded, categories, covered: mask.covered, colors: Object.keys(mask.byColor).length, cleaned };
    });
    assert.equal(visuals.perceptionOff, true, 'entering Farmwork disables Perception');
    assert.equal(visuals.hasGrid, true, 'world grid uses a white core and soft halo');
    assert.equal(visuals.reused, true, 'ground height refresh reuses GPU geometry');
    assert.equal(visuals.grounded, true, 'grid follows changing farm surface heights');
    assert.deepEqual(visuals.categories, { farmSelected: 1, farmAssignable: 1 }, 'selected footprint and family-assignable vat use farmwork categories');
    assert(visuals.covered > 0 && visuals.colors >= 2, 'actual shared glow mask covers both colored targets');
    assert.equal(visuals.cleaned, true, 'Perception transition removes Farmwork meshes');
    assert.deepEqual(errors, [], 'real browser must report no uncaught errors');
    console.log('Farmwork controller browser regression passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
