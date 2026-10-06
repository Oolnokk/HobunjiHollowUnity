'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const WEST_OF_ENTRANCE_COL = 16; // The north farm entrance road begins at column 16; starter specialty footprints must end before it.

function runPreset(specialization) {
  const values = new Map(); // LocalStorage stand-in used by the starter-grant persistence path.
  const objects = new Map(); // Shared occupancy map used by barns and production buildings.
  const barns = []; // Captures the Ranch starter barn so its final position can be asserted.
  let incubator = null; // Captures the attached Ranch incubator for the same west-of-entrance assertion.
  const context = {
    console,
    setInterval: () => 1,
    clearInterval() {},
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('docs/config/farm-specializations.js', 'utf8'), context, { filename: 'farm-specializations.js' });

  const config = context.FARM_SPECIALIZATIONS_CONFIG; // Real preset definitions under test.
  const world = { id: specialization, farmStarterBuildings: [...config.specializations[specialization].buildings] }; // Fresh-world pending grant list.
  const occupy = entry => {
    for (let row = entry.row; row < entry.row + entry.h; row++) for (let col = entry.col; col < entry.col + entry.w; col++) objects.set(`${col},${row}`, entry);
  };
  const vacate = entry => {
    for (let row = entry.row; row < entry.row + entry.h; row++) for (let col = entry.col; col < entry.col + entry.w; col++) if (objects.get(`${col},${row}`)?.id === entry.id) objects.delete(`${col},${row}`);
  };
  const canPlaceAt = (col, row, w, h, excludeId = null) => {
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col + w > 60 || row + h > 50) return false;
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) {
      const object = objects.get(`${c},${r}`);
      if (object && object.id !== excludeId) return false;
    }
    return true;
  };

  context.FarmBuildings = {
    canPlaceAt,
    clearFootprint() {},
    ensureStarterBarn(tier, id) {
      const existing = barns.find(entry => entry.id === id);
      if (existing) return { ok: true, entry: existing };
      const entry = { id, kind: 'barn', tier, col: 20, row: 7, w: 4, h: 5, stage: 'built' }; // Reproduces the old east-biased starter authority.
      barns.push(entry); occupy(entry);
      return { ok: true, entry };
    },
    move(id, col, row) {
      const entry = barns.find(candidate => candidate.id === id);
      if (!entry || !canPlaceAt(col, row, entry.w, entry.h, entry.id)) return { ok: false, message: 'blocked' };
      vacate(entry); entry.col = col; entry.row = row; occupy(entry);
      return { ok: true, message: 'moved' };
    },
  };
  context.BarnIncubator = {
    ensureStarterIncubator(barnId, tier) {
      const barn = barns.find(entry => entry.id === barnId);
      if (!barn) return { ok: false, message: 'missing barn' };
      incubator = { id: `${barnId}_starter_incubator`, tier, col: barn.col, row: barn.row - 2, w: 2, h: 2 }; // Representative north-wall attachment used after barn relocation.
      occupy(incubator);
      return { ok: true, addition: incubator };
    },
  };
  context.FarmWorldSettings = {
    read: () => ({ meta: { worlds: [world] }, world }),
    current: () => ({ stone: '#4d4d4d', wood: '#7d7355' }),
  };
  context.ItemProcessing = { ensureProcessedItemDef() {} };
  context.AuthoredFurniture = { load: async () => null, buildGroup() { throw new Error('Rendering should not be reached in this placement test.'); } };
  vm.runInContext(fs.readFileSync('docs/js/farm-production.js', 'utf8'), context, { filename: 'farm-production.js' });

  context.FarmProduction.init({
    calendar: { day: 1, time01: 0 }, inventory: {}, ITEM_DEFS: {}, cropData: {}, COLS: 60, ROWS: 50,
    TileType: { TRENCH: 'trench' }, MAX_WATER: 3, scene: { add() {}, remove() {} }, worldObjects: objects,
    hasFarmPermission: () => true, getGrid: () => [], surfaceY: () => 0, loadStorage: () => ({}), saveStorage() {}, consumeInput: () => 3,
    saveFarmLayout: () => true, saveMemberWorldData() {}, showToast() {}, debugLog() {},
  });
  context.FarmProduction.load([]);

  for (const entry of context.FarmProduction.entries()) {
    const definition = config.buildings[entry.key];
    assert(entry.col + definition.w <= WEST_OF_ENTRANCE_COL, `${specialization}: ${entry.key} crossed the entrance-side boundary`);
  }
  for (const barn of barns) assert(barn.col + barn.w <= WEST_OF_ENTRANCE_COL, `${specialization}: starter barn remained east of the entrance`);
  if (incubator) assert(incubator.col + incubator.w <= WEST_OF_ENTRANCE_COL, `${specialization}: starter incubator crossed the entrance-side boundary`);
  assert.equal(world.farmStarterBuildings.length, 0, `${specialization}: a starter grant remained pending on clear ground`);
}

for (const specialization of ['grower', 'rancher', 'preserver']) runPreset(specialization);
console.log('All starting farm specialization facilities stay west of the north entrance.');
