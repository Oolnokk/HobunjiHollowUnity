#!/usr/bin/env node
'use strict';

// Life Temple wedding: the temple's third ("wedding") alternate layout, the
// authored ceremony scene, and seating every villager in its pews.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value)); // vm-realm objects fail deepStrictEqual.

// ── Map layout ──────────────────────────────────────────────────────────
const temple = JSON.parse(read('docs/config/maps/map_i_temple.json'));
assert.equal(temple.layouts.length, 2, 'base hall + two alternate layouts (spirit communion, wedding)');
const wedding = temple.layouts.find(layout => layout.id === 'wedding');
assert.ok(wedding, 'the temple has a wedding layout');
assert.deepEqual(wedding.conditions, [{ flag: 'templeWedding' }], 'the wedding layout is switched on by the templeWedding flag');
const station = id => wedding.npcStations.find(s => s.id === id);
const officiant = station('station_wedding_officiant'), playerSpot = station('station_wedding_player'), spouseSpot = station('station_wedding_spouse');
assert.equal(spouseSpot.row, playerSpot.row, 'player and spouse stand on the same row');
assert.equal(spouseSpot.col - playerSpot.col, 2, 'player and spouse are one tile apart');
assert.equal(officiant.col, (playerSpot.col + spouseSpot.col) / 2, 'Father Hunundi stands between them');
assert.equal(officiant.row, playerSpot.row - 1, '…one tile further north');
const pews = wedding.furniture.filter(f => f.itemKey === 'benchFurniture');
assert.ok(pews.length * 2 >= 26, 'enough pew seats (2 per bench) for every villager');
assert.ok(pews.every(p => p.gridRot === 180 && !p.rotY && p.gridW === 2 && p.roles?.includes('wedding_pew')), 'pews are unstretched 2-seat benches turned to face north (gridRot 180) and tagged wedding_pew');
const floor = new Set(temple.floor.map(([c, r]) => `${c},${r}`));
for (const pew of pews) for (let c = pew.col; c < pew.col + 2; c++) assert.ok(floor.has(`${c},${pew.row}`), `pew tile ${c},${pew.row} is on the temple floor`);
assert.ok(!pews.some(p => p.col <= 10 && p.col + 1 >= 9), 'the centre aisle (cols 9-10) stays clear');

// ── Layout resolution through MapLayoutSystem ──────────────────────────
const layoutContext = vm.createContext({ window: { CalendarSystem: null }, console });
vm.runInContext(read('docs/js/map-layout-system.js'), layoutContext);
const layouts = layoutContext.window.MapLayoutSystem;
const snapshot = { minutes: 600, weekday: 'Tanin', dateOrdinal: 10 };
assert.equal(layouts.resolveActiveLayout(temple, snapshot), null, 'the ordinary hall shows without the flag');
layouts.setFlag('templeWedding', true);
assert.equal(layouts.resolveActiveLayout(temple, snapshot)?.id, 'wedding', 'the flag switches the temple to its wedding layout');
assert.equal(layouts.getEffectiveMapData(temple, snapshot).furniture.filter(f => f.itemKey === 'benchFurniture').length, pews.length);
layouts.setFlag('templeWedding', false);

// ── Scene + seating ─────────────────────────────────────────────────────
const registeredOverrides = new Map();
const stationsByRole = pews.map(p => ({ id: `furniture_${p.col}_${p.row}`, stationId: `furniture_${p.col}_${p.row}`, c: p.col, r: p.row, rotY: 180, furnitureKey: 'bench', roles: ['sit', 'wedding_pew'] }));
const windowStub = {
  SCRATCHBONES_CONFIG: { game: {} },
  NpcScheduling: {
    registerTargetOverride: (id, fn) => registeredOverrides.set(id, fn),
    findStationsByRole: (role, { area }) => (role === 'wedding_pew' && area === 'map_i_temple' ? stationsByRole : []),
  },
  DialogueContent: { getNpcDlgState: id => ({ favor: id === 'kzubug' ? 300 : 0 }) },
  CalendarSystem: { timeDebugSnapshot: () => ({ rawDay: 5 }), getHour: () => 10 },
  MapLayoutSystem: layouts,
};
const context = vm.createContext({ window: windowStub, console, Map, Set, Math, JSON, Number, String, Array, Object, Promise });
vm.runInContext(read('docs/config/romance-config.js'), context);
vm.runInContext(read('docs/js/romance-wedding.js'), context);
const W = windowStub.RomanceWedding;

const records = new Map([['aliri_ginju', { id: 'aliri_ginju', name: 'Aliri Ginju' }], ['father_hunundi_hodu', { id: 'father_hunundi_hodu', name: 'Father Hunundi Hodu' }]]);
const scene = W.buildWeddingScene(records, { nickname: 'Pell' }, { spouseId: 'aliri_ginju' });
assert.equal(scene.mapId, 'map_i_temple');
const actor = id => scene.actors.find(a => a.id === id);
assert.deepEqual(plain([actor('player').worldC, actor('player').worldR]), [playerSpot.col, playerSpot.row], 'cutscene player stands on the layout\'s player spot');
assert.deepEqual(plain([actor('spouse').worldC, actor('spouse').worldR]), [spouseSpot.col, spouseSpot.row]);
assert.deepEqual(plain([actor('hunundi').worldC, actor('hunundi').worldR]), [officiant.col, officiant.row]);
assert.equal(actor('spouse').npcRecord?.id, 'aliri_ginju', 'NPC actors carry their canonical database record like the opening scenes');
const stage = id => scene.stages.find(s => s.id === id);
const vow = stage('wedding_player_vow');
assert.equal(vow.type, 'choice');
assert.deepEqual(plain(vow.options.map(o => o.next)), ['wedding_ask_spouse', 'wedding_postpone'], 'the vow can be accepted or postponed');
assert.equal(stage('wedding_pronounce').type, 'talk', 'the pronouncement is the Continue that completes the marriage');
// The recessional ends with the couple in the clear centre aisle (cols 9-10),
// so gameplay resumes with the follow camera out of the crowded pews.
const moves = scene.stages.filter(s => s.type === 'move');
const lastMove = id => moves.filter(s => s.actorId === id).pop();
for (const id of ['player', 'spouse']) {
  const goal = lastMove(id)?.targetWorld;
  assert.ok(goal && goal.c >= 9 && goal.c <= 10 && floor.has(`${goal.c},${goal.r}`), `${id} ends the scene on the aisle floor`);
  assert.ok(!pews.some(p => goal.r === p.row && goal.c >= p.col && goal.c < p.col + 2), `${id} ends clear of the pews`);
}
assert.equal(moves[0].actorId, 'player');
assert.equal(moves[0].targetWorld.r, playerSpot.row, 'the player first steps sideways into the aisle rather than cutting diagonally through the front pew');
const ids = new Set(scene.stages.map(s => s.id));
for (const s of scene.stages) {
  if (s.next && !['__next__', '__end__'].includes(s.next)) assert.ok(ids.has(s.next), `${s.id} → ${s.next} exists`);
  for (const option of s.options || []) assert.ok(ids.has(option.next), `${s.id} option → ${option.next} exists`);
}

const walker = (id, extra = {}) => ({
  rec: { id, homeId: extra.homeId || 'town_home' }, area: extra.area || 'town', animalDef: extra.animalDef || null,
  root: { position: { x: 0, z: 0 } },
  transferToArea(area, spot) { this.area = area; this.root.position.x = spot.c + 0.5; this.root.position.z = spot.r + 0.5; },
});
const walkers = [
  walker('aliri_ginju', { homeId: 'ginju_farmstead' }), walker('father_hunundi_hodu'),
  walker('gorobi_ginju', { homeId: 'ginju_farmstead' }), walker('kzubug'), walker('jubmir'),
  walker('banubu'), walker('named_pet', { animalDef: {} }),
];
W.init({
  npcWalkers: walkers,
  seatTransformForTarget: target => ({ x: target.c + 1 + (target.seatIndex ? -0.37 : 0.37), z: target.r + 0.5 }),
});
const guests = W._test.pickGuests(walkers, 'aliri_ginju', 'father_hunundi_hodu').map(w => w.rec.id);
assert.deepEqual(plain(guests), ['gorobi_ginju', 'kzubug', 'jubmir'], "spouse's household first, then closest friends; no couple, officiant, fey or animals");
const targets = W._test.seatGuests('aliri_ginju', 'father_hunundi_hodu');
assert.equal(targets.size, 3, 'every guest gets a pew seat');
const gorobi = walkers.find(w => w.rec.id === 'gorobi_ginju');
assert.equal(gorobi.area, 'map_i_temple', 'guests are brought into the temple behind the fade');
assert.equal(targets.get('gorobi_ginju').r, 7, 'the front row goes to family');
assert.equal(targets.get('gorobi_ginju').pose, 'sit');
assert.ok(Math.abs(gorobi.root.position.x - 10) < 2, 'front-row family sit on the aisle-side seat (the aisle is 2 tiles wide)');
assert.equal(new Set([...targets.values()].map(t => t.stationId)).size, 3, 'no two guests share a seat');

// ── play(): lock, layout, seating, outcome-specific release ─────────────
(async () => {
  const locks = [];
  windowStub.CharacterActionLocks = { acquire: options => { const lock = { options, released: false, release() { this.released = true; } }; locks.push(lock); return lock; } };
  windowStub.LocalDBOverrides = { loadDatabase: async () => ({ npcs: [...records.values()] }) };
  let area = 'map_i_temple', rebuilds = 0, closedDialogue = 0, runImpl = null;
  windowStub.AuthoredCutsceneRuntime = { run: (scene, options) => runImpl(scene, options) };
  windowStub.CalendarSystem.runScreenTransition = async fn => fn();
  W.init({
    npcWalkers: walkers,
    seatTransformForTarget: target => ({ x: target.c + 1 + (target.seatIndex ? -0.37 : 0.37), z: target.r + 0.5 }),
    rebuildBuildingForActiveLayout: async () => { rebuilds++; },
    getCurrentArea: () => area,
    closeNpcDialogue: () => { closedDialogue++; },
    getPlayerTilePosition: () => ({ x: 9.5, z: 11.5 }),
  });
  const aliri = walkers.find(w => w.rec.id === 'aliri_ginju');

  runImpl = async (scene, options) => { assert.ok(!locks.at(-1).released, 'the player stays locked while the scene plays'); options.onDialogueContinue({ id: 'wedding_pronounce' }); };
  assert.equal(await W.play({ spouseId: 'aliri_ginju' }), true, 'continuing the pronouncement marries the couple');
  assert.ok(locks.at(-1).released, 'the lock is released afterwards');
  assert.deepEqual(plain(locks.at(-1).options.participants[0].channels), ['movement', 'tools', 'actions']);
  assert.equal(rebuilds, 1); assert.equal(closedDialogue, 1, 'an open conversation is closed before the hall is rearranged');
  assert.equal(layouts.getFlag('templeWedding'), true, 'the hall stays in its wedding layout for the reception');
  assert.ok(W.holds('gorobi_ginju') && W.holds('aliri_ginju'), 'guests and the new spouse are held for the reception');
  assert.deepEqual(plain([aliri.area, aliri.root.position.x, aliri.root.position.z]), ['map_i_temple', 10.5, 11.5], 'the live spouse stands beside the player at the end of the aisle');
  assert.equal(W.snapshot().phase, 'wed');
  W.tick('map_i_temple');
  assert.ok(W.holds('kzubug'), 'the reception lasts beyond the ceremony itself');
  windowStub.CalendarSystem.getHour = () => 12; // two in-game hours later
  W.tick('map_i_temple');
  assert.ok(!W.holds('kzubug') && !W.holds('aliri_ginju'), 'after the reception hour everyone returns to their routines');
  W.tick('town');
  assert.equal(layouts.getFlag('templeWedding'), false, 'leaving the temple reverts it to the ordinary hall');
  windowStub.CalendarSystem.getHour = () => 10;

  runImpl = async () => {};
  assert.equal(await W.play({ spouseId: 'aliri_ginju' }), false, '"Not today" leaves the couple engaged');
  assert.equal(W.snapshot().phase, 'postponed');
  assert.ok(!W.holds('gorobi_ginju'), 'a postponed ceremony releases the crowd at once');
  assert.ok(locks.at(-1).released);
  W.tick('town');

  runImpl = async () => { throw new Error('scene failed'); };
  await assert.rejects(W.play({ spouseId: 'aliri_ginju' }), /scene failed/);
  assert.equal(W.snapshot().phase, 'error');
  assert.ok(!W.holds('gorobi_ginju'), 'a failed scene never leaves villagers pinned to the pews');
  assert.ok(locks.at(-1).released, 'a failed scene still releases the player');
  W.tick('town');

  area = 'town';
  let ran = false; runImpl = async () => { ran = true; };
  const rebuildsBefore = rebuilds;
  assert.equal(await W.play({ spouseId: 'aliri_ginju' }), false, 'nothing happens if the player already left the temple');
  assert.ok(!ran && rebuilds === rebuildsBefore && !layouts.getFlag('templeWedding'));
  assert.ok(locks.at(-1).released);

  console.log('romance wedding tests passed');
})().catch(error => { console.error(error); process.exit(1); });
