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
  squeezer: { itemKey: 'squeezerFurniture', icon: 'S', name: 'Hand Squeezer' },
  handMill: { itemKey: 'handMillFurniture', icon: 'M', name: 'Hand Mill' },
  dryingRack: { itemKey: 'dryingRackFurniture', icon: 'D', name: 'Drying Rack' },
  smoker: { itemKey: 'smokerFurniture', icon: 'H', name: 'Smoking Hut' },
  agingBarrel: { itemKey: 'agingBarrelFurniture', icon: 'B', name: 'Aging Barrel' },
  agingVase: { itemKey: 'agingVaseFurniture', icon: 'V', name: 'Aging Vase' },
};
const decorativeDefs = {
  chair: { itemKey: 'chairFurniture', icon: 'C', name: 'Chair', area: 'any' },
};
const inventory = { chairFurniture: 1 };
Object.values(processingDefs).forEach(def => { inventory[def.itemKey] = 1; });
let currentArea = 'farm'; // Switched below to prove processors stay outdoor-only.

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
  getPlacedFurniture: () => [],
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

elements.furniturePlacerList.children = [];
currentArea = 'interior';
context.window.FurniturePlacer.render();
assert(renderedNames().some(html => html.includes('Chair')), 'area-compatible decorative furniture remains listed indoors');
for (const def of Object.values(processingDefs)) {
  assert(!renderedNames().some(html => html.includes(def.name)), `${def.name} remains farm-only`);
}

const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.match(gameSource,
  /processingKey\s*\? placeProcessingFurniture\(col, row, processingKey\)/,
  'placement clicks route processing items through the existing processor placement function');
assert.match(gameSource,
  /kind: 'processing'[\s\S]{0,700}canPlaceFurnitureAt\(col, row\)/,
  'processing furniture previews use the existing farm placement validation');

console.log('furniture placer processing catalog tests passed');
