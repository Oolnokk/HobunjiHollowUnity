'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Real livestock and production APIs, with the canonical family scheduler and fake scene/storage.
const inventory = {}, stock = { plantFodder: 2, fruit: 2 }, quality = [], xp = [];
let cacheNow = 0;
class TestDate extends Date { static now() { return cacheNow; } }
let smallJob = null, allowLoad = true, failStorage = false, failLayout = false, failSmallStart = false;
const small = { id: 'processor_pestle_8_8', label: 'Pestle Station', col: 8, row: 8, familyEligible: true,
  familyRecipe: key => key === 'fruit' ? [{key:'juice'}] : null, familyCanLoad: () => allowLoad, getJob: () => smallJob,
  familyReady: () => !!smallJob?.ready && (inventory.juice || 0) < 99,
  startFamilyJob: (key, workerId) => { assert.equal(workerId,'worker'); if (failSmallStart) return {ok:false}; smallJob = { key, ready: false }; return {ok:true}; },
  collectFamilyJob: () => { inventory.juice++; smallJob = null; return {ok:true}; }
};
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
const ctx = vm.createContext({ window: win, console, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, Date: TestDate, performance: { now: () => 0 } });
for (const name of ['farm-production', 'farm-animals', 'npc-farm-plots']) vm.runInContext(fs.readFileSync('docs/js/' + name + '.js', 'utf8'), ctx, { filename: name });
const deps = { calendar, inventory, ITEM_DEFS: { fruit: {label:'Fruit'}, milk: {label:'Milk'}, plantFodder: {label:'Fodder'} },
  COLS: 40, ROWS: 40, worldObjects: new Map(), animalObjects: new Set([animal]), getCurrentArea: () => 'farm',
  hasFarmPermission: () => permission, loadStorage: () => stock, saveStorage(next) { if (failStorage) return false; Object.assign(stock,next); return true; }, processingFurnitureObjects: new Set([small]), saveFarmLayout() { return !failLayout; }, saveMemberWorldData() {}, debugLog() {},
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
function finish() { for (let i=0;i<6;i++) { cacheNow += 500; api.tick(); } }
assert.match(approach().activity, /collecting livestock/);
carried = true; finish();
assert.equal(inventory.milk, undefined, 'carrying interrupts an in-flight livestock claim');
assert.equal(xp.length, 0);
carried = false; assert.match(approach().activity, /collecting livestock/); finish();
assert.equal(inventory.milk, 1); assert.equal(herd[0].resourceReady, false);
assert.equal(quality[0][1], 2, 'livestock output uses worker usefulness instead of player skill');
assert.equal(playerXp, 0);
assert.equal(xp[0][1], 'livestockCollect');
assert.match(approach().activity, /troughs/); failStorage=true; finish();
assert.equal(stock.plantFodder,2);
assert.equal(barn.troughs[0].slots.filter(Boolean).length,0,'failed storage write cannot fill trough');
failStorage=false; assert.match(approach().activity, /troughs/); failLayout=true; finish();
assert.equal(stock.plantFodder,2,'failed trough layout write refunds feed');
assert.equal(barn.troughs[0].slots.filter(Boolean).length,0);
failLayout=false; assert.match(approach().activity, /troughs/); finish();
assert.equal(stock.plantFodder, 1); assert.equal(inventory.plantFodder, undefined);
assert.equal(barn.troughs[0].slots.filter(Boolean).length, 1);
assert.match(approach().activity, /troughs/); finish();
assert.equal(stock.plantFodder, 0);
assert.match(approach().activity, /petting/); finish();
assert.equal(herd[0].lastPettedDay, 1);
assert.equal(approach(), null, 'no repeated petting or phantom resource output');
config.livestock = ''; config.processing.press1 = { workerId:'worker', inputKey:'fruit' }; api.invalidateFamilyChores();
assert.match(approach().activity, /loading/); walker.currentScheduleTarget={id:'spouse_newborn_care'}; finish();
assert.equal(stock.fruit,2,'other schedule cannot complete a background chore');
delete walker.currentScheduleTarget;
walker.area='town'; finish(); assert.equal(stock.fruit,2,'off-map worker cannot create goods remotely');
walker.area='farm';
assert.match(approach().activity, /loading/); failStorage=true; finish();
assert.equal(stock.fruit,2,'failed large processor debit is rejected');
failStorage=false;
assert.match(approach().activity, /loading/); failLayout=true; finish();
assert.equal(stock.fruit,2,'failed queue layout write refunds input');
assert.equal(win.FarmProduction.entries()[0].queue.length,0);
failLayout=false; assert.match(approach().activity, /loading/); finish();
assert.equal(stock.fruit, 1); assert.equal(win.FarmProduction.entries()[0].queue[0].count, 1);
assert.equal(approach(), null, 'running processor does not consume another item');
calendar.time01 = .5; win.FarmProduction.tick();
assert.match(approach().activity, /collecting processed/);
hour = 19; finish(); assert.equal(inventory.juice, undefined, 'off-shift work cancels');
hour = 10; assert.match(approach().activity, /collecting processed/); finish();
assert.equal(inventory.juice, 2); assert.equal(xp.at(-1)[1], 'processingCollect');
assert.equal(quality.at(-1)[1],2,'large family processor output uses worker usefulness');
config.processing.press1.inputKey = ''; api.invalidateFamilyChores();
assert.equal(approach(), null, 'collect-only never consumes storage');
assert.equal(stock.fruit, 1);
config.processing.press1.inputKey = 'fruit'; api.invalidateFamilyChores();
assert.match(approach().activity, /loading/); permission = false; finish();
assert.equal(stock.fruit, 1, 'permission revoked mid-claim prevents mutation');
assert.equal(api.snapshot().familyChores.length, 0);
permission = true;
delete config.processing.press1;
config.processing[small.id] = {workerId:'worker',inputKey:'fruit'};
api.invalidateFamilyChores();
assert(win.FarmProduction.familyStations().some(s=>s.id===small.id && s.inputs.some(i=>i.key==='fruit')));
allowLoad=false; assert.equal(approach(),null,'small station can require a dedicated worker');
allowLoad=true; api.invalidateFamilyChoreJobs();
assert.match(approach().activity,/loading/); failStorage=true; finish();
assert.equal(smallJob,null,'failed storage debit cannot create a batch');
assert.equal(stock.fruit,1);
failStorage=false; assert.match(approach().activity,/loading/); failSmallStart=true; finish();
assert.equal(stock.fruit,1,'failed small processor start refunds original input even if storage mutates its object');
failSmallStart=false; assert.match(approach().activity,/loading/); finish();
assert.equal(stock.fruit,0); assert.equal(smallJob.key,'fruit');
assert.equal(approach(),null,'busy small station cannot consume another ingredient');
smallJob.ready=true; inventory.juice=99; cacheNow+=500;
assert.equal(approach(),null,'full bag keeps ready small processor job');
inventory.juice=2; cacheNow+=500;
assert.match(approach().activity,/collecting/); finish();
assert.equal(inventory.juice,3); assert.equal(smallJob,null);
assert.equal(xp.at(-1)[1],'processingCollect');
console.log('Family livestock, storage, large/small processor queues and scheduler interruptions: PASS');
