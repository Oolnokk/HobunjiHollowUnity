#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.style = { display: id === 'furniturePlacerPanel' ? 'none' : '' };
    this.children = []; // Captures rendered furniture rows for catalog assertions.
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.innerHTML = '';
  }

  appendChild(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  addEventListener() {}
}

const elements = {
  furniturePlacerPanel: new FakeElement('furniturePlacerPanel'),
  furniturePlacerBtn: new FakeElement('furniturePlacerBtn'),
  furniturePlacerHint: new FakeElement('furniturePlacerHint'),
  furniturePlacerList: new FakeElement('furniturePlacerList'),
};
const document = {
  getElementById: id => elements[id] || null,
  createElement: () => new FakeElement(),
};
const context = { console, document, window: {} };
vm.runInNewContext(fs.readFileSync('docs/js/furniture-placer.js', 'utf8'), context);

const processingDefs = {
  pestle: { itemKey: 'pestleFurniture', icon: 'P', name: 'Pestle Station' },
  squeezer: { itemKey: 'squeezerFurniture', icon: 'S', name: 'Squeezing Vat' },
  handMill: { itemKey: 'handMillFurniture', icon: 'M', name: 'Hand Mill' },
  dryingRack: { itemKey: 'dryingRackFurniture', icon: 'D', name: 'Drying Rack' },
  smoker: { itemKey: 'smokerFurniture', icon: 'H', name: 'Smoking Hut' },
  agingBarrel: { itemKey: 'agingBarrelFurniture', icon: 'B', name: 'Aging Barrel' },
  agingVase: { itemKey: 'agingVaseFurniture', icon: 'V', name: 'Aging Vase' },
};
const decorativeDefs = {
  chair: { itemKey: 'chairFurniture', icon: 'C', name: 'Chair', area: 'any' },
  houseStool: { itemKey: 'houseStoolFurniture', icon: 'T', name: 'House Stool', area: 'interior' },
};
const inventory = {
  chairFurniture: 1,
  houseStoolFurniture: 1,
  simpleWindowFurniture: 1,
  wideWindowFurniture: 1,
  crossbarWindowFurniture: 1,
};
let windowCatalogRepairCalls = 0;
context.window.DaylightWindowRuntime = {
  registerDecorDefs(defs) {
    windowCatalogRepairCalls += 1;
    defs.simpleWindow ||= { itemKey: 'simpleWindowFurniture', icon: 'W', name: 'Simple Window', area: 'any', wallOrnament: true };
    defs.wideWindow ||= { itemKey: 'wideWindowFurniture', icon: 'W', name: 'Wide Window', area: 'any', wallOrnament: true };
    defs.crossbarWindow ||= { itemKey: 'crossbarWindowFurniture', icon: 'W', name: 'Crossbar Window', area: 'any', wallOrnament: true, playerFurnitureDisabled: true };
  },
};
Object.values(processingDefs).forEach(def => { inventory[def.itemKey] = 1; });
let currentArea = 'farm'; // Switched below to prove processors stay outdoor-only.
let placedFurniture = [{ id: 'processor_agingBarrel_3_4', key: 'agingBarrel', placementKind: 'processing', col: 3, row: 4 }]; // Exercises processor management rows.

context.window.FurniturePlacer.init({
  getCurrentArea: () => currentArea,
  getDecorativeFurnitureDefs: () => decorativeDefs,
  getProcessingFurnitureDefs: () => processingDefs,
  inventory,
  hasFarmPermission: () => true,
  armFurniturePlacement() {},
  getArmedFurniturePlacementKey: () => null,
  armFurnitureMove() {},
  getArmedFurnitureMoveId: () => null,
  getPlacedFurniture: () => placedFurniture,
  removeFurniture() {},
  rotateFurniture() {},
  showToast() {},
  esc: value => String(value),
  isPaused: () => false,
  isDevMode: () => false,
});
context.window.FurniturePlacer.toggle();

const renderedNames = () => elements.furniturePlacerList.children.map(row => row.innerHTML);
for (const def of Object.values(processingDefs)) {
  assert(renderedNames().some(html => html.includes(def.name)), `${def.name} is listed by the farm placement tool`);
}
assert(renderedNames().some(html => html.includes('House Stool')), 'ordinary interior furniture is also offered for outdoor farm placement');
assert(windowCatalogRepairCalls > 0, 'Furniture Placer asks the daylight-window extension to repair its catalog at render time');
assert(renderedNames().some(html => html.includes('Simple Window')), 'owned Simple Window appears in Available Furniture even when its definition was absent before render');
assert(renderedNames().some(html => html.includes('Wide Window')), 'owned Wide Window appears in Available Furniture even when its definition was absent before render');
assert(!renderedNames().some(html => html.includes('Crossbar Window')), 'disabled legacy Crossbar Window remains hidden even when present in inventory');
const placedBarrelRow = elements.furniturePlacerList.children.find(row => row.innerHTML.includes('Aging Barrel') && row.innerHTML.includes('3, 4'));
assert(placedBarrelRow, 'placed processors appear in the management list');
assert.equal(placedBarrelRow.children.length, 3, 'placed processors receive move, rotate, and remove controls');

elements.furniturePlacerList.children = [];
currentArea = 'interior';
placedFurniture = [];
context.window.FurniturePlacer.render();
assert(renderedNames().some(html => html.includes('Chair')), 'area-compatible decorative furniture remains listed indoors');
assert(renderedNames().some(html => html.includes('House Stool')), 'interior furniture remains listed indoors after becoming farm-placeable too');
for (const def of Object.values(processingDefs)) {
  assert(!renderedNames().some(html => html.includes(def.name)), `${def.name} remains farm-only`);
}

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const actionArcSource = fs.readFileSync('docs/js/action-arc-ui.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
assert.match(gameSource,
  /processingKey\s*\? placeProcessingFurniture\(col, row, processingKey\)/,
  'placement clicks route processing items through the existing processor placement function');
assert.match(gameSource,
  /function farmSurfaceYAtWorld\(worldX, worldZ\)[\s\S]{0,2200}tileSurface \+ exactLift - centerLift/,
  'farm surface resolver replaces the baked tile-center house sample with the exact rendered X/Z sample');
assert.match(gameSource,
  /function showFurniturePlacementGhost\(col, row\)[\s\S]{0,2600}farmSurfaceYAtWorld\(previewX, previewZ\)/,
  'placement ghost previews the same farm surface used by committed furniture');
assert.match(gameSource,
  /function makeProcessingFurniture\(col, row, furnitureKey[\s\S]{0,500}farmSurfaceYAtWorld\(col \+ 0\.5, row \+ 0\.5\)/,
  'processing furniture uses the shared farm surface at creation');
assert.match(gameSource,
  /function moveProcessingFurniture\(id, col, row\)[\s\S]{0,900}farmSurfaceYAtWorld\(col \+ 0\.5, row \+ 0\.5\)/,
  'processing furniture re-samples farm elevation when moved');
assert.match(gameSource,
  /function makeDecorativeFurnitureMesh\(col, row, furnitureKey[\s\S]{0,900}furnitureSurfaceYAtWorld\(area, centerX, centerZ\)/,
  'decorative furniture, including benches, samples its rendered footprint center');
assert.match(gameSource,
  /function moveDecorativeFurniture\(id, col, row\)[\s\S]{0,1300}furnitureSurfaceYAtWorld\(obj\.area, centerX, centerZ\)/,
  'moving decorative furniture recomputes its surface Y');
assert.match(gameSource,
  /function rotateDecorativeFurniture\(id, degrees = 45\)[\s\S]{0,1500}furnitureSurfaceYAtWorld\(obj\.area, centerX, centerZ\)/,
  'rotating non-square decorative furniture recomputes its shifted center surface Y');
assert.match(gameSource,
  /HobunjiFurnitureSurfaceElevation = Object\.freeze\([\s\S]{0,220}refresh: refreshFarmFurnitureSurfaceElevation/,
  'farm furniture exposes one shared re-grounding hook for building-footprint elevation changes');
assert.match(gameSource,
  /function activeSurfaceYAtWorld\(worldX, worldZ\)[\s\S]{0,220}currentArea === 'farm'\) return farmSurfaceYAtWorld/,
  'seated camera and other active-surface consumers use the exact farm hill');
assert.match(gameSource,
  /function npcSurfaceY\(area, c, r\)[\s\S]{0,650}area === 'farm'[\s\S]{0,120}farmSurfaceYAtWorld/,
  'farm NPC surface queries share the corrected farmhouse/barn height');

assert.match(gameSource,
  /kind: 'processing'[\s\S]{0,1400}canPlaceFurnitureAt\(col, row, spec\.ignoreObject\)/,
  'processing furniture previews use the existing farm placement validation');
assert.match(gameSource,
  /function commitFurniturePlacementAt\(col, row\)[\s\S]{0,2600}placeDecorativeFurniture\(col, row, decorKey\)/,
  'armed placement commits through one shared tile-targeted placement function');
assert.match(gameSource,
  /if \(furniturePlacementModeArmed\(\)\) \{[\s\S]{0,420}getReticleTile\(\)[\s\S]{0,260}commitFurniturePlacementAt/,
  'gameplay furniture placement commits at the ordinary reticle tile');
assert.match(gameSource,
  /furniturePlacementModeArmed\(\)[\s\S]{0,1100}action: 'furniture_place_confirm'[\s\S]{0,420}action: 'furniture_place_cancel'/,
  'armed furniture placement explicitly populates mobile Place and Cancel actions');
assert.match(gameSource,
  /furniturePlacementModeArmed\(\) && \(actionId === 'action1' \|\| actionId === 'interact' \|\| actionId === 'action2'\)/,
  'controller/keyboard primary, interact, and cancel inputs are all claimed by armed furniture placement');
assert.match(gameSource,
  /actionId === 'action2'\)[\s\S]{0,180}cancelFurniturePlacementMode\(true\)/,
  'physical Action 2 cancels furniture placement instead of leaking into the equipped tool');
assert.match(gameSource,
  /function cancelFurniturePlacementMode\(showMessage = false\)[\s\S]{0,700}refreshActionBar\(\)/,
  'canceling placement clears the session and restores the ordinary action arch immediately');
assert.match(gameSource,
  /mouseAction === 'action1' && furniturePlacementModeArmed\(\)/,
  'mouse primary action confirms placement without switching to a screen-position placement tool');
assert.doesNotMatch(gameSource, /furniturePlacementPointerId/, 'placement no longer captures a viewport pointer or replaces mouse aim');
assert.match(gameSource,
  /def\.area === 'interior' && !isInInterior && !isOnFarm/,
  'interior-authored regular furniture is permitted on the outdoor farm');
assert.match(actionArcSource,
  /id: 'character-view'[\s\S]{0,220}initial: true/,
  'Character View is the default utility-wheel selection even while it is off');
assert.match(actionArcSource,
  /id: 'furniture-placement'[\s\S]{0,320}FurniturePlacer\?\.open/,
  'utility wheel opens the normal furniture selector');
assert.match(gameSource,
  /if \(window\.WallOrnamentPlacement\?\.isPlayerReticlePlacementActive\?\.\(\)\)[\s\S]{0,800}wall_place_confirm[\s\S]{0,360}wall_place_cancel/,
  'wall-reticle placement owns visible mobile Place and Cancel buttons before interior early returns');
assert.match(gameSource,
  /updatePlayerReticlePreview\?\.\(\); \/\/ Touch camera\/movement retargets wall preview/,
  'active wall placement refreshes its reticle preview for touch even without a controller');
assert.match(gameSource,
  /refreshActionBar, \/\/ Selector-to-placement transitions must populate\/clear the mobile action arch immediately\./,
  'FurniturePlacer receives the shared action-bar refresh hook');
assert.match(indexSource,
  /id="furniturePlacerPanel"[^>]*data-ctrl-panel/,
  'furniture selector participates in universal controller navigation');

console.log('furniture placer processing catalog tests passed');
