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
  const browser = await chromium.launch(fs.existsSync(pinned) ? { executablePath: pinned } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 940, height: 800 } });
    const errors = []; // Page exceptions surfaced for mobile-only contributors who cannot inspect a browser console.
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.setContent(`<style>
      #farmworkPanel { display:none;position:absolute;left:100px;top:30px;width:420px;height:730px;overflow:auto;background:#222;color:white; }
      .fw-grid { display:grid;grid-template-columns:repeat(7,1fr); }
      button,select,input { min-height:26px; }
      .fw-settings { display:grid;gap:8px }
      .fw-actions, .fw-plots, .fw-nav { display:flex;gap:6px }
    </style>
    <div id="farmworkPanel" data-ctrl-panel style="display:none">
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
        showToast: () => {},
      }) };
    });
    await page.addScriptTag({ content: source('controller-ui-nav.js') });
    await page.addScriptTag({ content: source('controller-select-steppers.js') });
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
    const toggled = await page.evaluate(() => {
      const tile = document.querySelector('[data-fwtile="5,5"]');
      tile.focus();
      window.ControllerUI.press('confirm');
      const assigned = window.FarmPlotEditor.plots()[0].tiles.some(([c,r]) => c === 5 && r === 5);
      window.ControllerUI.press('confirm');
      const cleared = !window.FarmPlotEditor.plots()[0].tiles.length;
      return { assigned, cleared };
    });
    assert.deepEqual(toggled, { assigned: true, cleared: true }, 'controller A can add then remove the same tile without losing focus');
    const paged = await page.evaluate(() => {
      const before = window.FarmworkUI._test.getOrigin()[0];
      document.querySelector('[data-fwpage="right"]').focus();
      window.ControllerUI.press('confirm');
      return window.FarmworkUI._test.getOrigin()[0] > before;
    });
    assert.equal(paged, true, 'controller can page the tile grid without pointer input');
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
    assert.deepEqual(errors, [], 'real browser must report no uncaught errors');
    console.log('Farmwork controller browser regression passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
