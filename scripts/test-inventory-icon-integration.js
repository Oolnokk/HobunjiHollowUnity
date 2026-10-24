'use strict';
const assert = require('node:assert/strict'); // Checks actual panel entry points, including async sprite requests.
const fs = require('node:fs'); // Loads the production modules under review.
const vm = require('node:vm'); // Provides a small browser-shaped runtime without WebGL.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.textContent = '';
    this.classList = { add() {}, remove() {}, contains: () => false }; // Existing panel class updates do not affect these icon assertions.
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ''; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener() {}
  replaceWith(replacement) { this.parentElement.children[this.parentElement.children.indexOf(this)] = replacement; }
}
const elements = new Map([['invEquipSection', new Element()]]); // Tracks only the panel surfaces used by each test phase.
const requests = []; // Records image requests to verify CORS and cross-cell cache sharing.
let scans = 0; // Counts real framing requests, rather than merely asserting that a cache object exists.
const context = {
  console, Promise,
  document: {
    readyState: 'loading', addEventListener() {},
    getElementById: id => elements.get(id) || null,
    createTextNode: text => Object.assign(new Element('span'), { textContent: text }),
    createElement: tag => tag !== 'canvas' ? new Element(tag) : {
      getContext: () => ({ drawImage() {}, getImageData() { scans++; return { data: new Uint8ClampedArray(4 * 8 * 4).fill(255) }; } }),
      toDataURL: () => 'data:image/png;framed',
    },
  },
  Image: class {
    constructor() { this.width = 4; this.height = 8; }
    set src(value) { assert.equal(this.crossOrigin, 'anonymous', 'CORS must be set before the sprite URL'); this.url = value; requests.push(this); }
  },
  window: { InventoryUI: { init() {} }, WhistleEquip: { build() {} } },
}; // Runs the complete equipment module, with canvas alpha data and image completion under test control.
vm.runInNewContext(fs.readFileSync('docs/js/equipment-panel.js', 'utf8'), context);
const panel = context.window.EquipmentPanel; // Uses the same build function called by inventory and metal recolor completion.
const gear = { tools: { blade: true }, clothing: {}, clothingItems: [], starterPantsGranted: true }; // Avoids unrelated wardrobe migrations.
let source = 'blade-base.png'; // Changes to simulate a resolved plating/verdigris source.
panel.init({
  TOOL_ITEM_DEFS: { blade: { label: 'Blade', icon: '🗡️', slots: ['weapon'] } }, equipmentSlots: { weapon: 'blade' },
  getGearInventory: () => gear, getActiveTool: () => 'weapon', toolMasteryLevel: () => 1,
  metalToolImgSrc: () => source, saveGearInventory() {},
});
function images(root) { return root.children.flatMap(child => child.tagName === 'IMG' ? [child] : images(child)); }
async function checkPanels() {
  panel.buildEquipmentSlots();
  assert.equal(requests.length, 1, 'owned and equipped instances share one pending load');
  requests[0].onload();
  await Promise.resolve();
  assert.equal(scans, 1, 'alpha bounds are scanned once for all instances');
  assert(images(elements.get('invEquipSection')).every(image => image.src === 'data:image/png;framed'));
  panel.buildEquipmentSlots(); await Promise.resolve();
  assert.equal(requests.length, 1, 'rebuilding the panel reuses its finished thumbnail');
  source = 'blade-plated.png'; panel.buildEquipmentSlots();
  assert.equal(requests.length, 2, 'a changed finish gets a new thumbnail');
  requests[1].onerror(); await Promise.resolve();
  assert.equal(images(elements.get('invEquipSection')).length, 0, 'failed requests leave readable placeholders, not broken image icons');
  assert.equal(panel.getIconDebug().failed, 1);

  elements.clear();
  for (const id of ['mpShipping', 'shipLeftGrid', 'shipRightGrid', 'shipPreviewIcon', 'shipDetailIcon']) elements.set(id, new Element());
  context.window.addEventListener = () => {};
  for (const module of ['shipping-box-config', 'shipping-panel']) vm.runInNewContext(fs.readFileSync(`docs/js/${module}.js`, 'utf8'), context);
  const shipping = context.window.ShippingPanel; // Exercises the actual shipping grid, detail and store-row renderers.
  const definitions = { seeds: { label: 'Seeds', icon: '', cat: 'seed', sellPrice: 5, desc: '', tags: [] } }; // Existing item with intentionally incomplete metadata.
  shipping.init({ ITEM_DEFS: definitions, BASE_PRICES: {}, inventory: { seeds: 2 }, itemIconForKey: () => '🌱', getShippingBoxObject: () => null });
  shipping.build();
  assert(elements.get('shipLeftGrid').children[0].innerHTML.includes('🌱'), 'shipping grid uses the same icon fallback as Pack');
  shipping.selectItem('bag', 'seeds');
  assert.equal(elements.get('shipPreviewIcon').textContent, '🌱');
  assert.equal(elements.get('shipDetailIcon').textContent, '🌱');
  assert.equal(shipping.getSellableInventory()[0].icon, '🌱', 'merchant rows also receive the resolved placeholder');

  vm.runInNewContext(fs.readFileSync('docs/js/hud-update.js', 'utf8'), context);
  const hud = context.window.HudUpdate; // Exercises real current/previous/next wheel rendering without running the game frame loop.
  const hudDeps = {
    inventory: { seeds: 2 }, ITEM_DEFS: definitions, itemIconForKey: () => '🌱',
    itemPrev: new Element(), itemNext: new Element(), itemIcon: new Element(), itemName: new Element(), itemCount: new Element(),
    itemBtnEl: new Element(), isPrevIconEl: new Element(), isNextIconEl: new Element(),
    getActiveItemIndex: () => 0, getInventoryStackItems: () => [{ key: 'seeds', icon: '', label: 'Seeds' }],
    clearItemSpriteIcon() {}, applyItemSpriteIcon() {},
  }; // Shared resolver must override blank carousel-entry metadata at every visible position.
  hud.init(hudDeps); hud.refreshItemScroll();
  for (const key of ['itemIcon', 'itemBtnEl', 'isPrevIconEl', 'isNextIconEl']) assert.equal(hudDeps[key].textContent, '🌱', key);
  console.log('Inventory async thumbnails, shipping/store icons and HUD wheel integration checks passed');
}
checkPanels().catch(error => { console.error(error); process.exitCode = 1; });
