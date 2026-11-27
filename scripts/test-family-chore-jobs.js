'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Real livestock and production APIs, with the canonical family scheduler and fake scene/storage.
const inventory = {}, stock = { plantFodder: 2, fruit: 2 }, quality = [], xp = [];
const calendar = { day: 1, time01: 0 }, config = { livestock: 'worker', processing: {} };
const barn = { id: 'barn', kind: 'barn', stage: 'built', tier: 'small', col: 4, row: 4, w: 2, h: 2 };
const animal = { livestockId: 'cow', col: 6, row: 6 };
const herd = [{ id: 'cow', kind: 'cow', lifeStage: 'adult', barnId: 'barn', troughIndex: 0, heartLevel: 2.5, resourceReady: true }];
const walker = { area: 'farm', root: { position: { x: 6.5, z: 6.5 } } };
let hour = 10, carried = false, permission = true, playerXp = 0;
const win = {
  FARM_SPECIALIZATIONS_CONFIG: { buildings: { press: { label: 'Press', planItem: 'pressPlan', method: 'pressing', family: 'press', w: 2, h: 2, price: 10, yield: 2, daysPerInput: .25 } } },
  CreatureTextureCache: { create: () => ({}), genotypeFrameSetKey() {} },
  FarmWorldSettings: { read: () => ({ world: {} }) },
  AuthoredFurniture: { load: async () => null },
  InventoryStacks: { MAX_TOTAL: 99 },
  ItemProcessing: { getProcessingOutputs: (_method, key) => key === 'fruit' ? [{ key: 'juice', label: 'Juice' }] : null, ensureProcessedItemDef() {} },
  CookingSystem: { recordItemQuality: (...args) => quality.push(args) },
  CalendarSystem: { getHour: () => hour },
  NpcPathfinding: { isNpcTileWalkable: () => true },
  RomanceFamily: { familyChores: () => config, usefulnessInfo: id => id === 'worker' ? { level: 2 } : null, rollWorkQuality: () => 2, awardWork: (id, job) => xp.push([id,job]), isFamilyWorkUnavailable: () => carried },
};
const ctx = vm.createContext({ window: win, console, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, Date, performance: { now: () => 0 } });
for (const name of ['farm-production', 'farm-animals', 'npc-farm-plots']) vm.runInContext(fs.readFileSync('docs/js/' + name + '.js', 'utf8'), ctx, { filename: name });
const deps = { calendar, inventory, ITEM_DEFS: { fruit: {label:'Fruit'}, milk: {label:'Milk'}, plantFodder: {label:'Fodder'} },
  COLS: 40, ROWS: 40, worldObjects: new Map(), animalObjects: new Set([animal]), getCurrentArea: () => 'farm',
  hasFarmPermission: () => permission, loadStorage: () => stock, saveStorage() {}, saveFarmLayout() {}, saveMemberWorldData() {}, debugLog() {},
  getFarmBuildings: () => [barn], loadWorldLivestock: () => herd, saveWorldLivestock() {}, getBarnTiers: () => ({ small: { slots: 1 } }),
  LIVESTOCK_RESOURCE_DEFS: { cow: { itemKey: 'milk', cooldownDays: 2 } }, LIVESTOCK_DIET: { cow: 'prey' },
  recordItemQuality: (...args) => quality.push(args), rollItemStars: () => 5, awardFarmingXp: () => playerXp++,
  findWalker: id => id === 'worker' ? walker : null, getAreaScene: () => null, normalizeNpcArea: x => x,
};
win.FarmProduction.init(deps);
win.FarmProduction.load([{ id: 'press1', key: 'press', col: 12, row: 12 }]);
win.FarmAnimals.init(deps);
win.NpcFarmPlots.init(deps);
const api = win.NpcFarmPlots;
function approach() {
  const target = api.targetFor({ id: 'worker' }, { familyOnly: true });
  if (target) { walker.root.position.x = target.c + .5; walker.root.position.z = target.r + .5; }
  return target;
}
function finish() { for (let i=0;i<6;i++) api.tick(); }
assert.match(approach().activity, /collecting livestock/);
carried = true; finish();
assert.equal(inventory.milk, undefined, 'carrying interrupts an in-flight livestock claim');
assert.equal(xp.length, 0);
carried = false; assert.match(approach().activity, /collecting livestock/); finish();
assert.equal(inventory.milk, 1); assert.equal(herd[0].resourceReady, false);
assert.equal(quality[0][1], 2, 'livestock output uses worker usefulness instead of player skill');
assert.equal(playerXp, 0);
assert.equal(xp[0][1], 'livestockCollect');
assert.match(approach().activity, /troughs/); finish();
assert.equal(stock.plantFodder, 1); assert.equal(inventory.plantFodder, undefined);
assert.equal(barn.troughs[0].slots.filter(Boolean).length, 1);
assert.match(approach().activity, /troughs/); finish();
assert.equal(stock.plantFodder, 0);
assert.match(approach().activity, /petting/); finish();
assert.equal(herd[0].lastPettedDay, 1);
assert.equal(approach(), null, 'no repeated petting or phantom resource output');
config.livestock = ''; config.processing.press1 = { workerId:'worker', inputKey:'fruit' }; api.invalidateFamilyChores();
assert.match(approach().activity, /loading/); finish();
assert.equal(stock.fruit, 1); assert.equal(win.FarmProduction.entries()[0].queue[0].count, 1);
assert.equal(approach(), null, 'running processor does not consume another item');
calendar.time01 = .5; win.FarmProduction.tick();
assert.match(approach().activity, /collecting processed/);
hour = 19; finish(); assert.equal(inventory.juice, undefined, 'off-shift work cancels');
hour = 10; assert.match(approach().activity, /collecting processed/); finish();
assert.equal(inventory.juice, 2); assert.equal(xp.at(-1)[1], 'processingCollect');
config.processing.press1.inputKey = ''; api.invalidateFamilyChores();
assert.equal(approach(), null, 'collect-only never consumes storage');
assert.equal(stock.fruit, 1);
config.processing.press1.inputKey = 'fruit'; api.invalidateFamilyChores();
assert.match(approach().activity, /loading/); permission = false; finish();
assert.equal(stock.fruit, 1, 'permission revoked mid-claim prevents mutation');
assert.equal(api.snapshot().familyChores.length, 0);
console.log('Family livestock, storage, processor queue and scheduler interruptions: PASS');
