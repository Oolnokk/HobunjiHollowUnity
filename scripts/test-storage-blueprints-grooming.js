'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Executes the real placement and grooming owners with deterministic world seams.
function functionSource(source, name, indent = '      ') {
  const start = source.indexOf(`function ${name}(`); // Function boundary taken from shipped code, including its real guards and mutations.
  assert(start >= 0, name);
  const end = source.indexOf(`\n${indent}function `, start + 1); // Stops before the next sibling declaration.
  assert(end > start, name);
  return source.slice(start, end);
}
const inventory = { groomingKitFurniture: 7, pestleFurniture: 4 }; // Bag stock must stay unchanged when farm-storage placement succeeds.
let storage = { groomingKitFurniture: 2, pestleFurniture: 1 }; // Fresh copies simulate the metadata store's snapshot reads.
let permitted = true; // Permission revocation must block placement even after selecting a stored item.
let clearTile = true; // Invalid placement must leave both stock sources untouched.
let meshAvailable = true; // A failed furniture build must also retain stock.
let storageWritable = true; // Failed metadata writes must abort placement, leaving the stored item available.
let discarded = 0; // Failed transactions must dispose the uncommitted mesh and VFX.
const noop = () => {};
const context = vm.createContext({
  console, inventory, currentArea: 'farm', scene: {}, interiorScene: {},
  worldObjects: new Map(), processingFurnitureObjects: new Set(), interiorFurnitureObjects: [],
  DECORATIVE_FURNITURE_DEFS: { groomingKit: { itemKey: 'groomingKitFurniture', name: 'Grooming Kit' } },
  PROCESSING_FURNITURE_DEFS: { pestle: { itemKey: 'pestleFurniture', name: 'Pestle' } },
  hasFarmPermission: () => permitted,
  _loadWorldStorage: () => ({ ...storage }), _saveWorldStorage: value => { if (!storageWritable) return false; storage = { ...value }; return true; },
  clampInventoryStack: noop, canPlaceDecorativeFurnitureAt: () => clearTile, canPlaceFurnitureAt: () => clearTile,
  makeDecorativeFurnitureMesh: () => meshAvailable ? { mesh: {} } : null,
  makeProcessingFurniture: () => meshAvailable ? { id: 'pestle', reset() { discarded++; } } : null,
  disposeDecorativeFurniture() { discarded++; },
  furnitureOwnerFields: () => ({}), normalizeNpcArea: value => value,
  registerChairNpcStation: noop, registerSitWorldObject: noop,
  window: { HudUpdate: { refreshItemScroll: noop }, FarmEditor: { saveFarmLayout: noop } },
});
// Include the farm-world interaction helper used by placement, not just the caller's source.
for (const name of ['furnitureStock', 'consumeFurnitureStock', 'registerFarmDecorativeInteractable', 'placeDecorativeFurniture', 'placeProcessingFurniture']) {
  vm.runInContext(functionSource(game, name), context);
}
assert.equal(context.placeDecorativeFurniture(2, 3, 'groomingKit', 'storage').ok, true);
assert.equal(storage.groomingKitFurniture, 1);
assert.equal(inventory.groomingKitFurniture, 7, 'storage placement does not borrow from bag');
assert.equal(context.placeProcessingFurniture(4, 5, 'pestle', 'storage').ok, true);
assert.equal(storage.pestleFurniture, undefined, 'last storage copy is removed');
assert.equal(inventory.pestleFurniture, 4);
assert.equal(context.placeProcessingFurniture(4, 5, 'pestle', 'storage').ok, false, 'exhausted storage does not fall back to bag');
for (const failure of ['tile', 'mesh', 'permission']) {
  clearTile = failure !== 'tile'; meshAvailable = failure !== 'mesh'; permitted = failure !== 'permission';
  assert.equal(context.placeDecorativeFurniture(3, 4, 'groomingKit', 'storage').ok, false, failure);
  assert.equal(storage.groomingKitFurniture, 1, failure + ' leaves storage untouched');
  assert.equal(inventory.groomingKitFurniture, 7);
}
clearTile = meshAvailable = permitted = true;
assert.equal(context.placeDecorativeFurniture(3, 4, 'groomingKit').ok, true);
assert.equal(inventory.groomingKitFurniture, 6, 'ordinary bag placement retains its source');
assert.equal(storage.groomingKitFurniture, 1);
storageWritable = false;
const placedBefore = context.interiorFurnitureObjects.length; // A rejected debit must not append a saved placed object.
assert.equal(context.placeDecorativeFurniture(5, 6, 'groomingKit', 'storage').ok, false, 'metadata write failure blocks floor placement');
assert.equal(context.interiorFurnitureObjects.length, placedBefore);
assert.equal(discarded, 1);
assert.equal(storage.groomingKitFurniture, 1);
storage.pestleFurniture = 1;
const processorsBefore = context.processingFurnitureObjects.size; // Processor registration must also wait for successful consumption.
assert.equal(context.placeProcessingFurniture(7, 8, 'pestle', 'storage').ok, false, 'metadata write failure blocks processor placement');
assert.equal(context.processingFurnitureObjects.size, processorsBefore);
assert.equal(discarded, 2);
assert.equal(storage.pestleFurniture, 1);
storageWritable = true;

// Exercise the actual metadata owner so a quota exception cannot look like a successful debit.
let storedMeta = JSON.stringify({ worlds: [{ id: 'farm', storage: { groomingKitFurniture: 1 } }] }); // Test persisted metadata independently of the placement seam.
let rejectWrite = false; // Simulates a full browser store or unavailable active world.
const metadata = vm.createContext({ window: {}, localStorage: { getItem: () => storedMeta, setItem(key, value) { if (rejectWrite) throw new Error('quota'); storedMeta = value; } } });
vm.runInContext(fs.readFileSync('docs/js/world-meta-store.js', 'utf8'), metadata);
assert.equal(metadata.window.WorldMetaStore.saveStorage('missing', {}), false);
assert.equal(metadata.window.WorldMetaStore.saveStorage('farm', { groomingKitFurniture: 2 }), true);
rejectWrite = true;
assert.equal(metadata.window.WorldMetaStore.saveStorage('farm', {}), false);
assert.equal(metadata.window.WorldMetaStore.loadStorage('farm').groomingKitFurniture, 2);

// Startup grants exactly one kit to each existing or new world, including worlds with prior starter grants.
const farm = vm.createContext({ window: {}, console }); // Farm hub's startup API owns the persistent grant sentinel.
vm.runInContext(fs.readFileSync('docs/js/farm-panel-core.js', 'utf8'), farm);
for (const initial of [{}, { __starterWindowsGrantedV1: 1, __windowPersistenceRepairGrantV1: 1 }]) {
  storage = { ...initial };
  farm.window.FarmPanel.init({ ITEM_DEFS: {}, _loadWorldStorage: () => ({ ...storage }), _saveWorldStorage: value => { storage = { ...value }; } });
  farm.window.FarmPanel.ensureStarterFurnitureStorage();
  assert.equal(storage.groomingKitFurniture, 1);
  delete storage.groomingKitFurniture; // Placing/taking the free kit must not cause another grant.
  farm.window.FarmPanel.ensureStarterFurnitureStorage();
  assert.equal(storage.groomingKitFurniture, undefined);
}

// Run the full creator with a minimal DOM and confirm its real prefilled result/cancel callback.
function creatorHarness() {
  let overlay = null; // Tracks the one mounted creator root.
  const button = () => ({ listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, click() { this.listeners.click?.(); } });
  const document = {
    documentElement: { classList: { add: noop, remove: noop } },
    body: { appendChild(node) { overlay = node; } },
    getElementById: () => overlay, dispatchEvent: noop,
    createElement() {
      return { start: button(), cancel: button(), cosmetic: { ...button(), dataset: { obSlot: 'facialHair' }, value: '' }, classList: { add: noop },
        querySelectorAll(selector) { return selector === '[data-ob-slot]' ? [this.cosmetic] : []; }, querySelector(selector) { return selector === '#ob-start-btn' ? this.start : selector === '#ob-cancel-btn' ? this.cancel : null; },
        remove() { overlay = null; },
      };
    },
  }; // The creator still renders all ordinary markup and binds its real Apply/Cancel handlers.
  const ctx = vm.createContext({ console, window: { FarmWorldSettings: { normalize: () => ({}) } }, document, setTimeout: () => 1, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  vm.runInContext(fs.readFileSync('docs/onboarding-core.js', 'utf8'), ctx);
  return { api: ctx.window.HobunjiOnboarding, root: () => overlay };
}
const appearance = { speciesId: 'mao-ao', gender: 'male', cosmetics: { facialHair: 'appearance::Mao-ao_M::mao-ao_grandbeard' }, bodyColors: { A: { h: 7, s: -.2, v: -.4 }, B: { h: 10, s: 0, v: 0 } } }; // Existing customized character must survive opening/applying without edits.
const creator = creatorHarness();
let result = null; // Receives the actual completed creator output.
assert.equal(creator.api.openCreator({ appearance, speciesId: 'mao-ao', gender: 'male', cosmeticsOnly: true, mode: 'grooming', equippedCosmetics: ['hat'], appliedDyes: { HAT: 'blue' }, onComplete: value => { result = value; } }), true);
assert.equal(creator.api.creatorSessionInfo().cosmeticsOnly, true);
assert.match(creator.root().innerHTML, /Grand Beard/);
creator.root().start.click();
assert.deepEqual(JSON.parse(JSON.stringify(result.appearance)), appearance, 'Apply without edits preserves existing cosmetics and custom body colors');
assert.deepEqual(Array.from(result.equippedCosmetics), ['hat']);
assert.deepEqual(JSON.parse(JSON.stringify(result.appliedDyes)), { HAT: 'blue' });
const cancel = creatorHarness();
let canceled = 0; // Cancel must dismiss the modal without calling Apply.
cancel.api.openCreator({ cosmeticsOnly: true, onCancel: () => canceled++, onComplete: () => assert.fail('cancel applied edits') });
cancel.root().cancel.click();
assert.equal(canceled, 1);
assert.equal(cancel.api.creatorSessionInfo(), null);
assert.equal(cancel.root(), null);
const hairEditor = creatorHarness(); // Grooming prefills the same effective defaults that the live avatar currently displays.
let hairResult = null; // Receives appearance after selecting None for the current beard.
hairEditor.api.openCreator({ appearance, speciesId: 'mao-ao', gender: 'male', cosmeticsOnly: true,
  resolvedProfile: { hairFront: { id: 'appearance::Mao-ao_M::mao-ao_tuft' }, facialHair: { id: appearance.cosmetics.facialHair } },
  onComplete: value => { hairResult = value; } });
hairEditor.root().cosmetic.listeners.change();
hairEditor.root().start.click();
assert.equal(hairResult.appearance.cosmetics.facialHair, null, 'None explicitly clears beard instead of rerolling a random one');
assert.equal(hairResult.appearance.cosmetics.hairFront, 'appearance::Mao-ao_M::mao-ao_tuft', 'editing beard preserves the actual previously implicit hairstyle');
assert.equal(hairResult.appearance.cosmetics.hairBack, null, 'an empty rendered slot stays explicitly empty');
const legacyEditor = creatorHarness(); // Sparse old saves still need a complete editable appearance state.
let legacyResult = null; // Confirms optional maps are initialized without inventing a replacement identity.
legacyEditor.api.openCreator({ appearance: { speciesId: 'mao-ao', gender: 'male' }, cosmeticsOnly: true,
  resolvedProfile: { hairFront: { id: 'appearance::Mao-ao_M::mao-ao_tuft' }, bodyColors: appearance.bodyColors }, onComplete: value => { legacyResult = value; } });
legacyEditor.root().start.click();
assert.equal(legacyResult.appearance.cosmetics.hairFront, 'appearance::Mao-ao_M::mao-ao_tuft');
assert.equal(legacyResult.appearance.bodyColors.A.h, appearance.bodyColors.A.h);


// A station edit persists only cosmetics/body colors and refreshes the live player.
const liveProfile = { characterId: 'farmer', appearance: JSON.parse(JSON.stringify(appearance)), equippedCosmetics: ['actual-hat'], equipmentSlots: { weapon: 'sword' } }; // Character identity/equipment must survive grooming.
const savedCharacter = { appearance: liveProfile.appearance, equipmentSlots: { weapon: 'sword' } }; // Real metadata seam receives only the appearance mutation.
let sessionOptions = null; // Captures the existing creator's in-game session callbacks.
let avatarRefreshes = 0; // Successful Apply must rebuild the live avatar.
const station = vm.createContext({
  console, _playerData: liveProfile, menuOpen: false, paused: false, player: {}, input: {},
  isPlayerInCombat: () => false, closeMenu() { station.menuOpen = false; station.paused = false; },
  refreshPlayerAvatar() { avatarRefreshes++; }, saveMemberWorldData: noop, showToast: noop, releaseShoulderSurfPointerLock: noop,
  window: { __hobunjiPlayerProfile: liveProfile,
    CharacterMetaSave: { update(fn) { fn(savedCharacter); return true; } },
    NpcAvatarPreview: { buildProfileFromNpcExport: () => ({ facialHair: { id: appearance.cosmetics.facialHair } }) },
    HobunjiOnboarding: { openCreator(options) { sessionOptions = options; return true; } },
  },
});
vm.runInContext(functionSource(game, 'makeGroomingInteractable'), station);
assert.equal(station.makeGroomingInteractable().onAction('obj_interact').ok, true);
assert.equal(station.paused, true, 'grooming pauses world time');
assert.equal(station.menuOpen, true, 'grooming blocks world actions/movement');
sessionOptions.onComplete({ appearance: { ...appearance, speciesId: 'changed', gender: 'female', cosmetics: { hairFront: 'new-hair' }, bodyColors: { ...appearance.bodyColors, A: { h: 99, s: 0, v: 0 }, HAT: { h: 123 } } } });
assert.equal(savedCharacter.appearance.speciesId, 'mao-ao');
assert.equal(savedCharacter.appearance.gender, 'male');
assert.equal(liveProfile.appearance.cosmetics.hairFront, 'new-hair');
assert.equal(liveProfile.appearance.bodyColors.A.h, 99);
assert.equal(liveProfile.appearance.bodyColors.HAT, undefined, 'grooming cannot overwrite equipment tint channels');
assert.equal(savedCharacter.equipmentSlots.weapon, 'sword');
assert.equal(liveProfile.equippedCosmetics[0], 'actual-hat');
assert.equal(avatarRefreshes, 1);
assert.equal(station.paused, false);
assert.equal(station.menuOpen, false);
station.window.NpcAvatarPreview.buildProfileFromNpcExport = () => null;
assert.equal(station.makeGroomingInteractable().onAction('obj_interact').ok, false, 'unresolved live appearance cannot be replaced by random defaults');
assert.equal(station.paused, false);
assert.equal(station.menuOpen, false);

// Every registered Grand Beard uses its real asset and the same transform as its existing beard family.
const registry = JSON.parse(fs.readFileSync('docs/config/cosmetics/index.json', 'utf8')); // Cosmetic ids must be loadable, not just visible text in the creator.
const entries = Array.isArray(registry) ? registry : Object.values(registry).find(Array.isArray);
const beards = entries.filter(entry => entry.id.includes('grandbeard'));
assert.equal(beards.length, 4);
for (const entry of beards) {
  assert.match(entry.id, /_M::/, 'Grand Beards are registered for male families');
  const data = JSON.parse(fs.readFileSync('docs/config/cosmetics/' + entry.path.replace('./', ''), 'utf8')); // Validate config and referenced sprite, preserving the authored 234x173 canvas.
  assert(fs.existsSync('docs/' + data.parts.head.image.url.replace('./', '')));
  assert.equal(data.appearance.inheritSprite, 'head');
  assert.equal(data.parts.head.spriteStyle.xform.head.scaleX, 2.55);
}
console.log('storage placement, one-time grooming grants, prefilled cosmetics and beard assets: ok');
