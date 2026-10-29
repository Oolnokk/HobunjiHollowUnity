#!/usr/bin/env node
'use strict';

// Normal-play Farmwork must reuse one persisted family plot store without enabling dev tools.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..'); // Resolves shipped source files under docs/.
const read = p => fs.readFileSync(path.join(root, p), 'utf8'); // Reads the same module files loaded by index.html.

let spouseId = null, area = 'farm', owner = true; // Runtime gates for visible utility entry and panel actions.
let saved = 0, synced = []; // Observability: real serialization and NPC worker re-registration.
let pointerTile = { col: 4, row: 5 }; // Controlled world projection for drag painting.
const panel = { style: { display: 'none' }, querySelector: selector => selector === '#farmworkContents' ? view : null, querySelectorAll: () => [] }; // Controller panel root.
const view = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null }; // Lightweight DOM surface for content assertions.
const document = { activeElement: null, getElementById: id => id === 'farmworkPanel' ? panel : id === 'farmPlotsPane' ? null : null }; // No dev panel is present.
const win = {
  RomanceSystem: { getSpouse: () => spouseId ? { npcId: spouseId } : null, helpers: { npcName: id => id } },
  RomanceFamily: { snapshot: () => ({ children: [] }) },
  NpcFarmPlots: { registerFarmPlots: plots => synced.push(JSON.parse(JSON.stringify(plots))) },
  confirm: () => true,
  FarmEditor: { farmworkTileAccess: () => ({
    editable: owner && area === 'farm',
    cols: 12, rows: 12,
    canDesignate: (c, r, kind) => owner && area === 'farm' && Number.isInteger(c) && Number.isInteger(r) && c >= 0 && c < 12 && r >= 0 && r < 12 && c !== 11 && (kind === 'till' || kind === 'dig'),
    centerTile: () => ({ col: 4, row: 5 }),
    screenTile: () => pointerTile,
    aimTile: () => pointerTile,
    showToast() {},
  }) },
};
const env = vm.createContext({ window: win, document, console, Math, JSON, Map, Set, Array, String, Number }); // Isolated gameplay modules with no actual farm grid.
vm.runInContext(read('docs/js/world-action-input-claims.js'), env);
vm.runInContext(read('docs/js/farm-plot-editor.js'), env, { filename: 'farm-plot-editor.js' });
vm.runInContext(read('docs/js/farmwork-ui.js'), env, { filename: 'farmwork-ui.js' });
const plots = win.FarmPlotEditor; // Save-owning family plot manager.
const ui = win.FarmworkUI; // New ordinary-play view over those plot records.
plots.init({ save: () => { saved++; }, cropLabel: c => c.toUpperCase() });
const supportedCrops = plots.cropOptions().map(option => option.value); // Assert every known berry seed is available to priority blocks.
for (const crop of ['redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries']) {
  assert.ok(supportedCrops.includes(crop), crop + ' must be selectable in Farmwork seed blocks');
}

assert.equal(ui.canOpen(), false, 'utility entry stays absent before marriage');
spouseId = 'aliri_ginju';
assert.equal(ui.canOpen(), true, 'marriage unlocks farmwork on farm');
area = 'town';
assert.equal(ui.canOpen(), false, 'not available in town');
area = 'farm'; owner = false;
assert.equal(ui.canOpen(), false, 'farmwork cannot edit a non-owned farm');
owner = true;
assert.equal(ui.open(), true);
assert.equal(panel.style.display, 'flex');
assert.match(view.innerHTML, /New Field/);
assert.match(view.innerHTML, /New Trench/);
assert.match(view.innerHTML, /data-ctrl-default/, 'controller starts on a create action without any plots');
const id = plots.createFamilyPlot('till'); // Same API used by the new panel, with spouse assigned automatically.
let p = plots.plots().find(x => x.id === id);
assert.equal(p.workers[0], spouseId);
assert.equal(plots.setFamilyTile(id, 3, 4, true), true);
assert.equal(plots.setFamilyTile(id, 3, 4, true), false, 'repeating the same gesture does not toggle');
assert.equal(plots.updateFamilyPlot(id, { crop: 'needlegrain', hours: [8, 16] }), true);
assert.equal(plots.updateFamilyPlot(id, { crop: 'inventedCrop' }), false, 'unknown crops rejected');
assert.equal(plots.updateFamilyPlot(id, { workers: ['stranger'] }), true);
assert.equal(p.workers.length, 0, 'nonfamily workers excluded');
assert.equal(plots.updateFamilyPlot(id, { workers: [spouseId, spouseId] }), true);
assert.equal(p.workers.length, 1, 'duplicate worker slots removed');
ui.render();
assert.match(view.innerHTML, /data-fwtile="3,4"/);
assert.match(view.innerHTML, /Primary worker/);
assert.match(view.innerHTML, /Default seed for unassigned field tiles/);
assert.match(view.innerHTML, /Add seed block/, 'planting fields expose per-tile seed priority blocks');
assert.doesNotMatch(view.innerHTML, /data-fwpage/, 'plot preview has no arbitrary farm pages');
assert.match(view.innerHTML, /data-fwplan/, 'planning tool is next to plot name');
assert.equal((view.innerHTML.match(/data-fwtile=/g) || []).length, 1, 'preview renders included tiles only');
assert.equal(ui.toggleTile(11, 4), false, 'blocked farm tile cannot be assigned');
assert.equal(ui.toggleTile(12, 4), false, 'out-of-bounds tile rejected');
assert.equal(ui.toggleTile(3, 4), true, 'A button removes an assigned tile');
assert.equal(p.tiles.length, 0, 'removal is assignment-only and leaves world terrain untouched');

ui.setPlanning(true);
assert.equal(panel.style.display, 'none', 'tool tucks settings away so gameplay controls can aim');
assert.equal(win.WorldActionInputClaims.hasClaim('action1'), true);
const savedBeforeDrag = saved;
pointerTile = { col: 1, row: 1 };
assert.equal(ui.startWorldPointer(7, 20, 30), true);
pointerTile = { col: 2, row: 1 };
assert.equal(ui.dragTile(7, 20, 30), true);
ui.endWorldPointer(7);
assert.equal(saved, savedBeforeDrag + 1, 'touch paint batches multiple tiles into one persisted save');
assert.equal(p.tiles.length, 2);
ui.setPlanning(false);

// Seed blocks belong to included field tiles, preserve priority order, and support controller tile selection.
const blockId = plots.createSeedBlock(id);
assert.ok(blockId, 'a seed block can be created within a planting field');
assert.equal(plots.setSeedBlockTile(id, blockId, 1, 1, true), true);
assert.equal(plots.setSeedBlockTile(id, blockId, 5, 5, true), false, 'cannot assign seed block outside its parent field');
assert.equal(plots.updateSeedBlock(id, blockId, { seeds: ['heftroot', 'needlegrain'] }), true);
assert.equal(plots.updateSeedBlock(id, blockId, { seeds: ['needlegrain', 'needlegrain'] }), false, 'duplicate seed priorities rejected');
assert.equal(plots.updateSeedBlock(id, blockId, { seeds: ['fictionalCrop'] }), false, 'unknown seed priorities rejected');
const block2 = plots.createSeedBlock(id);
assert.equal(plots.setSeedBlockTile(id, block2, 1, 1, true), true);
assert.equal(p.seedBlocks[0].tiles.length, 0, 'transferring a tile between seed blocks does not double-assign it');
assert.equal(plots.setSeedBlockTile(id, blockId, 2, 1, true), true);
ui.chooseBlock(blockId);
assert.match(view.innerHTML, /Priority 1/, 'seed blocks show ordering in the normal controller panel');
assert.match(view.innerHTML, /Choose tiles for this seed block/);
ui.setPlanning(true, 'block');
assert.equal(ui.isPlanning(), true);
pointerTile = { col: 1, row: 1 };
win.WorldActionInputClaims.dispatch('action1', 'press');
win.WorldActionInputClaims.dispatch('action1', 'release');
assert.equal(p.seedBlocks[0].tiles.length, 2, 'controller Action 1 adds an existing plot tile to selected seed block');
assert.equal(p.seedBlocks[1].tiles.length, 0, 'seed block transfer removes it from the previous block');
pointerTile = { col: 4, row: 4 };
win.WorldActionInputClaims.dispatch('action1', 'press');
win.WorldActionInputClaims.dispatch('action1', 'release');
assert.equal(p.seedBlocks[0].tiles.length, 2, 'controller cannot expand a seed block outside its field');
ui.setPlanning(false);
const snap = JSON.parse(JSON.stringify(plots.serialize()));
plots.restore(snap);
assert.deepEqual(Array.from(plots.plots().find(q => q.id === id).seedBlocks[0].seeds), ['heftroot', 'needlegrain'], 'priority list survives save and restore');
assert.equal(plots.plots().find(q => q.id === id).seedBlocks[0].tiles.length, 2, 'seed block membership survives save and restore');
assert.equal(plots.setFamilyTile(id, 2, 1, false), true);
assert.equal(plots.plots().find(q => q.id === id).seedBlocks[0].tiles.some(([c, r]) => c === 2 && r === 1), false, 'removing a plot tile removes its seed-block membership');
assert.equal(plots.deleteSeedBlock(id, blockId), true);
assert.equal(plots.plots().find(q => q.id === id).tiles.length, 1, 'deleting a seed block keeps parent field tiles');
ui.changePlot(id);
ui.setPlanning(false);
p = plots.plots().find(q => q.id === id); // Restore replaces the plot object; subsequent transfer assertions use the live one.

const trench = ui.create('dig'); // UI creates and selects a second managed kind, preserving the first group.
assert.ok(plots.plots().some(item => item.kind === 'dig'));
const trenchId = plots.activeFamilyPlot().id;
assert.notEqual(trenchId, id);
assert.equal(plots.setFamilyTile(trenchId, 1, 1, true), true);
assert.equal(p.tiles.some(t => t[0] === 1 && t[1] === 1), false, 'overlapping tiles transfer rather than double-book NPCs');
assert.ok(synced.length && synced.at(-1).length, 'edits reach live NPC worker registration');
assert.equal(ui.close(), true);
assert.equal(panel.style.display, 'none');
assert.equal(plots.deleteFamilyPlot(trenchId), true);

// Regression: transferring a plot's final tile must not destroy its configured workers, crop or hours.
const sourceId = plots.createFamilyPlot('till'); // Source plot whose last tile will be transferred.
assert.equal(plots.updateFamilyPlot(sourceId, { crop: 'redberries', hours: [8.5, 16.5] }), true);
assert.equal(plots.setFamilyTile(sourceId, 4, 4, true), true);
const targetId = plots.createFamilyPlot('dig'); // Previously empty target should survive its first incoming tile.
assert.equal(plots.setFamilyTile(targetId, 4, 4, true), true);
const surviving = plots.plots().find(item => item.id === sourceId);
assert.ok(surviving, 'transfer leaves the now-empty source plot available for reuse');
assert.equal(surviving.tiles.length, 0);
assert.equal(surviving.crop, 'redberries');
assert.deepEqual(Array.from(surviving.hours), [8.5, 16.5]);
assert.equal(surviving.workers[0], spouseId);
const savesBeforeInvalid = saved;
assert.equal(plots.updateFamilyPlot(sourceId, { label: 'Should not stick', crop: 'inventedCrop' }), false);
assert.equal(surviving.label.startsWith('Family field'), true, 'rejected composite patch leaves earlier fields untouched');
assert.equal(plots.updateFamilyPlot(sourceId, { label: 'Should not stick', hours: [23, 5] }), false);
assert.equal(surviving.label.startsWith('Family field'), true, 'invalid hours do not partially rename a plot');
assert.equal(saved, savesBeforeInvalid, 'invalid composite patch never persists');
assert.equal(plots.setFamilyTile(sourceId, 11, 4, true), true, 'old saves may contain now-obstructed plot tiles');
assert.equal(ui.open(), true);
assert.equal(ui.toggleTile(11, 4), false, 'an unselected invalid tile is still blocked');
plots.selectFamilyPlot(sourceId);
assert.equal(ui.toggleTile(11, 4), true, 'old blocked designations remain removable from the player UI');
assert.equal(ui.open(), true, 'reopen the player panel to inspect preserved half-hour values');
ui.render();
assert.match(view.innerHTML, /08:30/, 'legacy half-hour shift is preserved in the player editor');
assert.match(view.innerHTML, /16:30/);

// Tool actions are explicit, idempotent and constrained by footprint dimensions rather than tile count.
const footprintId = plots.createFamilyPlot('till');
assert.equal(plots.activeFamilyPlot().tiles.length, 0, 'every new plot is empty');
ui.changePlot(footprintId);
ui.setPlanning(true);
const claims = win.WorldActionInputClaims;
const press = action => { claims.dispatch(action, 'press'); claims.dispatch(action, 'release'); };
pointerTile = { col: 1, row: 1 }; press('action1'); press('action1');
assert.equal(plots.activeFamilyPlot().tiles.length, 1, 'Action 1 never toggles an existing tile off');
pointerTile = { col: 7, row: 7 }; press('action1');
assert.equal(plots.activeFamilyPlot().tiles.length, 2, 'opposite corners of a 7x7 footprint are legal');
const beforeRejected = saved;
pointerTile = { col: 8, row: 7 }; press('action1');
assert.equal(plots.activeFamilyPlot().tiles.length, 2, 'eighth column rejected even with only two tiles');
assert.equal(saved, beforeRejected);
assert.equal(plots.setFamilyTile(footprintId, 7, 8, true), false, 'persisted owner also rejects an eighth row');
assert.equal(plots.setFamilyTile(footprintId, 0, 0, true), false, 'expanding left/up cannot bypass the limit');
press('action2');
assert.equal(plots.activeFamilyPlot().tiles.length, 2, 'Action 2 on an absent tile never adds it');
pointerTile = { col: 1, row: 1 }; press('action2');
assert.equal(plots.activeFamilyPlot().tiles.length, 1);
press('action3');
assert.equal(ui.isPlanning(), false);
assert.equal(panel.style.display, 'flex');
assert.equal(claims.hasClaim('action1'), false, 'finishing releases planning claims');
// A release can be swallowed by the newly opened settings panel; the next tool session must still work.
ui.setPlanning(true);
pointerTile = { col: 2, row: 2 };
claims.dispatch('action1', 'press');
claims.dispatch('action3', 'press'); // Opens settings while the original physical buttons are still held.
assert.equal(ui.isPanelOpen(), true);
ui.setPlanning(true); // Simulate selecting Add/remove tiles again after menu-owned releases.
assert.equal(ui.isPanelOpen(), false);
pointerTile = { col: 3, row: 3 };
press('action1');
assert(plots.activeFamilyPlot().tiles.some(([c,r]) => c === 3 && r === 3), 'first Action 1 after re-equipping is not swallowed by a stale press');
press('action3');
assert.equal(ui.isPlanning(), false, 'Done also works after a menu swallowed its previous release');
const preview = ui._test.footprintHTML({ label: 'L', tiles: [[1,1],[1,2],[2,2]] });
assert.equal((preview.match(/data-fwtile=/g) || []).length, 3, 'L shape has no excluded tile container');
assert.match(preview, /grid-column:2;grid-row:2/, 'included tiles retain spatial positions');
ui.setPlanning(true);
owner = false;
assert.equal(ui.applyAimedTile(true), false);
assert.equal(ui.isOpen(), false, 'lost farm permission closes the equipped tool');
assert.equal(claims.hasClaim('action1'), false);
owner = true;

const arc = read('docs/js/action-arc-ui.js'); // Verify normal gameplay entry is routed through the shared controller utility selector.
const editor = read('docs/js/farm-editor.js'); // Verify world pointer uses real existing screen-to-farm projection.
const index = read('docs/index.html'); // Verify controller panel markup and script load order.
assert.match(arc, /id: 'farmwork'[\s\S]{0,250}FarmworkUI\?\.open/, 'utility wheel includes the gated Farmwork action');
assert.match(editor, /farmworkTileAccess[\s\S]{0,1600}_screenToFarmTile/, 'world painting reuses FarmEditor projection');
assert.match(editor, /startWorldPointer\(e\.pointerId/, 'touch/mouse pointer capture is connected');
assert.match(index, /id="farmworkPanel"[^>]*data-ctrl-panel/, 'gamepad panel is registered for the ordinary menu navigator');
assert.match(index, /id="farmworkContents"/);
assert.match(index, /js\/farmwork-ui\.js\?v=/, 'new module is loaded before the game boots');
console.log('Gameplay Farmwork/controller regression checks passed');
