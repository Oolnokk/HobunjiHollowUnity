#!/usr/bin/env node
'use strict';

// Room-network layouts (Unumanuk household, Watchhouse, Carpenter's shop), the
// auto-oriented interior door tile, and the bed/wardrobe/schedule wiring for
// everyone who sleeps in those buildings.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const map = id => readJson(`docs/config/maps/${id}.json`);

// ── Door orientation (pure function from the runtime module) ────────────────
const sandbox = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/interior-door-tiles.js'), 'utf8'), sandbox);
const Doors = sandbox.window.InteriorDoorTiles;
const floorOf = rows => { // '#' = painted; the tile under test is always (1,1).
  const set = new Set();
  rows.forEach((line, r) => [...line].forEach((ch, c) => { if (ch !== '.') set.add(`${c},${r}`); }));
  return set;
};
assert.equal(Doors.orientation(floorOf(['...', '.D.', '...']), 1, 1).facing, 'north', 'no painted neighbour: faces north');
assert.equal(Doors.orientation(floorOf(['...', '.D.', '.#.']), 1, 1).facing, 'south', 'lone painted neighbour (south): faces it');
assert.equal(Doors.orientation(floorOf(['.#.', '.D.', '...']), 1, 1).facing, 'north', 'lone painted neighbour (north): faces it');
assert.equal(Doors.orientation(floorOf(['...', '#D.', '...']), 1, 1).facing, 'west', 'lone painted neighbour (west): faces it');
assert.equal(Doors.orientation(floorOf(['...', '.D#', '...']), 1, 1).facing, 'east', 'lone painted neighbour (east): faces it');
assert.equal(Doors.orientation(floorOf(['.#.', '.D.', '.#.']), 1, 1).rotationDeg % 180, 0, 'N/S passage: panel spans the unpainted W/E tiles');
assert.equal(Doors.orientation(floorOf(['...', '#D#', '...']), 1, 1).rotationDeg % 180, 90, 'W/E passage: panel spans the unpainted N/S tiles');

// ── Door state machine: NPC adjacency opens, no NPC closes, player blocked while closed ─
{
  const setMechanism = [];
  const door = { userData: { blocksMovement: true }, position: { set() {} }, rotation: {} };
  sandbox.window.FurniturePuzzleRuntime = { setMechanism: (mapId, id, open) => { setMechanism.push([id, open]); door.userData.blocksMovement = !open; return true; }, registerMap: () => 1 };
  sandbox.window.AuthoredFurniture = { peek: () => ({ parts: [{}] }), buildGroup: () => door };
  const Fresh = sandbox.window.InteriorDoorTiles;
  const scene = { add() {} };
  (async () => {
    await Fresh.build({
      THREE: {}, scene, mapId: 'map_t', mapData: { doorTiles: [[1, 1]] },
      floorSet: new Set(['1,0', '1,1', '1,2']), surfaceYAt: () => 0, registerInteractable: (c, r, obj) => { door.interactable = obj; },
    });
    assert.ok(Fresh.blocksBox('map_t', 1.5, 1.5, 0.2), 'closed door blocks the player');
    assert.ok(!Fresh.blocksBox('map_t', 3.5, 1.5, 0.2), 'only the door tile blocks');
    Fresh.tick('map_t', 0.1, [[1.5, 0.5]], null); // NPC on the tile north of the door
    assert.deepEqual(setMechanism.at(-1), ['door_1_1', true], 'NPC horizontally/vertically adjacent opens the door');
    assert.ok(!Fresh.blocksBox('map_t', 1.5, 1.5, 0.2), 'open door lets the player through');
    Fresh.tick('map_t', 0.1, [[3.5, 3.5]], null);
    Fresh.tick('map_t', 1, [[3.5, 3.5]], null);
    assert.deepEqual(setMechanism.at(-1), ['door_1_1', false], 'door closes once no NPC is adjacent');
    Fresh.tick('map_t', 0.1, [[2.5, 2.5]], null); // diagonal is not adjacent
    assert.deepEqual(setMechanism.at(-1), ['door_1_1', false], 'diagonal NPC does not open the door');
    assert.equal(door.interactable.getButtons()[0].label, 'Open Door');
    assert.ok(door.interactable.onAction('obj_door_toggle').ok);
    assert.ok(!Fresh.blocksBox('map_t', 1.5, 1.5, 0.2), 'player-opened door is passable');
    Fresh.tick('map_t', 5, [], [1.5, 1.5]); // player standing in the doorway keeps it open
    assert.ok(!Fresh.blocksBox('map_t', 1.5, 1.5, 0.2), 'door never closes on the player');
    Fresh.tick('map_t', 5, [], [6.5, 6.5]);
    assert.ok(Fresh.blocksBox('map_t', 1.5, 1.5, 0.2), 'hand-opened door closes after the player leaves');
    console.log('Interior door tiles: orientation, NPC proximity, player blocking and manual opening passed.');
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

// ── Layout checks ───────────────────────────────────────────────────────────
const FOOT = {
  doubleBedFurniture: [2, 2], basicBedFurniture: [1, 2], bedrollFurniture: [1, 1], wardrobeFurniture: [2, 1], chestFurniture: [1, 1], nightstandFurniture: [1, 1],
  hearthFurniture: [2, 1], benchFurniture: [2, 1], bookshelfFurniture: [2, 1], deskFurniture: [2, 1], dresserFurniture: [2, 1],
  tableLongFurniture: [4, 1], counterFurniture: [3, 1], dryingRackFurniture: [2, 1], rugFurniture: [2, 2],
};
function occupied(piece) {
  const base = FOOT[piece.itemKey] || [1, 1];
  const quarter = ((Math.round((Number(piece.gridRot) || 0) / 90) % 4) + 4) % 4 % 2 === 1;
  const w = Math.round(Number(piece.gridW) || (quarter ? base[1] : base[0]));
  const d = Math.round(Number(piece.gridD) || (quarter ? base[0] : base[1]));
  const out = [];
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) out.push(`${piece.col + x},${piece.row + z}`);
  return out;
}
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function analyse(id) {
  const m = map(id);
  const floor = new Set(m.floor.map(t => t.join(',')));
  const walkable = new Set(floor); // Gameplay grants a logical, floorless transition cell to an exit directly outside the room.
  const vectors = { north:[0,-1],south:[0,1],east:[1,0],west:[-1,0] };
  for (const exit of m.exits || []) for(const [c,r] of exit.tiles || []) {
    const k = `${c},${r}`, delta = vectors[exit.direction];
    if (!floor.has(k) && delta && floor.has(`${c+delta[0]},${r+delta[1]}`)) walkable.add(k);
  }
  const solid = new Set((m.colliders || []).map(t => t.join(',')));
  const furnitureTiles = new Map(); // tile -> piece
  for (const piece of m.furniture) {
    if (piece.nonColliding || piece.itemKey === 'woodenDoorFurniture') continue;
    for (const key of occupied(piece)) { solid.add(key); furnitureTiles.set(key, piece); }
  }
  const free = key => walkable.has(key) && !solid.has(key);
  const flood = start => {
    const seen = new Set();
    const queue = [start];
    while (queue.length) {
      const key = queue.pop();
      if (seen.has(key) || !free(key)) continue;
      seen.add(key);
      const [c, r] = key.split(',').map(Number);
      for (const [dc, dr] of DIRS) queue.push(`${c + dc},${r + dr}`);
    }
    return seen;
  };
  // A passage tile has unpainted tiles on both sides of one axis (doorway / hallway).
  const unpainted = (c, r) => !floor.has(`${c},${r}`);
  const passage = key => {
    const [c, r] = key.split(',').map(Number);
    return (unpainted(c - 1, r) && unpainted(c + 1, r)) || (unpainted(c, r - 1) && unpainted(c, r + 1));
  };
  const roomOf = new Map();
  let rooms = 0;
  for (const key of floor) {
    if (roomOf.has(key) || passage(key)) continue;
    const stack = [key];
    roomOf.set(key, rooms);
    while (stack.length) {
      const [c, r] = stack.pop().split(',').map(Number);
      for (const [dc, dr] of DIRS) {
        const next = `${c + dc},${r + dr}`;
        if (floor.has(next) && !roomOf.has(next) && !passage(next)) { roomOf.set(next, rooms); stack.push(next); }
      }
    }
    rooms++;
  }
  return { m, floor, solid, furnitureTiles, free, flood, roomOf, rooms, passage };
}

const exitTiles = m => m.exits.flatMap(e => e.tiles.map(t => t.join(',')));

for (const id of [
  'map_i_unumanuk_household', 'map_i_unumanuk_household_bedroom', 'map_i_watchhouse', 'map_i_carpenters', 'map_i_carpenters_F2',
  'map_i_carpenters_F2_dzibim', 'map_i_unumanuk_household_teacup', 'map_i_carpenters_F2_nashka',
  'map_i_swamp_house', 'map_i_swamp_house_leaf', 'map_i_ginju_farmstead_F2_R1',
]) {
  const a = analyse(id);
  const { m } = a;
  const exits = exitTiles(m);
  assert.ok(exits.length, `${id} has an exit`);
  const reach = a.flood(exits[0]);
  for (const exit of exits) assert.ok(reach.has(exit) || a.floor.has(exit) && [...reach].some(key => {
    const [c, r] = key.split(',').map(Number); const [ec, er] = exit.split(',').map(Number); return Math.abs(c - ec) + Math.abs(r - er) === 1;
  }), `${id}: exit ${exit} reachable from the first exit`);
  // Everything painted should be reachable (no stranded pockets), except tiles covered by furniture.
  for (const key of a.floor) if (a.free(key)) assert.ok(reach.has(key) || exits.includes(key), `${id}: floor tile ${key} is reachable`);
  for (const key of exits) assert.ok(!a.furnitureTiles.has(key), `${id}: furniture on exit tile ${key}`);
  // Door tiles: floor, nothing on them, a passage with an unpainted pair, never on an exit.
  for (const [c, r] of m.doorTiles || []) {
    const key = `${c},${r}`;
    assert.ok(a.floor.has(key), `${id}: door ${key} is floor`);
    assert.ok(!a.furnitureTiles.has(key), `${id}: furniture on door ${key}`);
    assert.ok(a.passage(key), `${id}: door ${key} bridges two unpainted tiles`);
    assert.ok(!exits.includes(key), `${id}: door ${key} is not an exit`);
    const o = Doors.orientation(a.floor, c, r);
    assert.ok(o.paintedSides.length >= 1, `${id}: door ${key} leads somewhere`);
  }
  // Stations: standing ones are free tiles; seats/beds have a free neighbour that is connected.
  for (const st of m.npcStations || []) {
    const key = `${st.col},${st.row}`;
    assert.ok(a.floor.has(key), `${id}: station ${st.id} on floor`);
    if (st.pose === 'lie' || st.pose === 'sit') {
      assert.ok(a.furnitureTiles.has(key), `${id}: ${st.id} (${st.pose}) sits on furniture`);
      const neighbours = DIRS.map(([dc, dr]) => `${st.col + dc},${st.row + dr}`);
      assert.ok(neighbours.some(n => reach.has(n)), `${id}: ${st.id} has a walkable approach tile`);
    } else {
      assert.ok(reach.has(key), `${id}: standing station ${st.id} is reachable`);
    }
  }
}

// Public areas are now a few legible rooms, with no intervening maze.
for (const id of ['map_i_unumanuk_household', 'map_i_watchhouse', 'map_i_carpenters']) {
  const a = analyse(id);
  assert.ok(a.rooms <= 3, `${id} has at most three public rooms (found ${a.rooms})`);
  assert.ok(a.m.doorTiles.length <= 2, `${id} has only the doors separating its public spaces`);
}
assert.equal(analyse('map_i_carpenters_F2').rooms, 1, 'family hall is one simple room');

// Combat tutorial entry points stay valid in the rebuilt watchhouse.
{
  const a = analyse('map_i_watchhouse');
  assert.ok(a.floor.has('8,12') && a.floor.has('10,13'), 'watchhouse keeps the combat tutorial entry tiles');
  const arena = map('map_i_watchhouse_arena');
  const back = arena.exits[0];
  assert.ok(a.floor.has(`${back.spawnCol},${back.spawnRow}`), 'arena stairs return to a watchhouse floor tile');
}

// ── Beds, bedrolls, wardrobes and schedules ─────────────────────────────────
const db = readJson('docs/config/npcs/hobunji-starter-npc-database.json');
const registry = readJson('docs/config/npcs/placeholder-wardrobes.json');
const sleepers = [
  ['teacup_unumanuk', 'map_i_unumanuk_household_teacup', 'station_unmh_teacup_bed', 'f_unmhbed_chest_teacup'],
  ['spearhead_unumanuk', 'map_i_unumanuk_household_bedroom', 'station_unmh_spearhead_bed', 'f_unmhbed_chest_spearhead'],
  ['oddclaw_unumanuk', 'map_i_unumanuk_household_bedroom', 'station_unmh_oddclaw_bed', 'f_unmhbed_chest_oddclaw'],
  ['binding_hatayap', 'map_i_unumanuk_household_bedroom', 'station_unmh_binding_bed', 'f_unmhbed_chest_binding'],
  ['tooth_hatayap', 'map_i_unumanuk_household_bedroom', 'station_unmh_tooth_bed', 'f_unmhbed_chest_tooth'],
  ['dzibim_khibu', 'map_i_carpenters_F2_dzibim', 'station_car_home_dzibim_bed', 'f_map_i_carpenters_F2_dzibim_wardrobe'],
  ['dzahiri_khibu', 'map_i_carpenters_F2_dzibim', 'station_car_home_dzahiri_bed', 'f_map_i_carpenters_F2_dzahiri_wardrobe'],
  ['nashka_khibu', 'map_i_carpenters_F2_nashka', 'station_car_home_nashka_bed', 'f_map_i_carpenters_F2_nashka_wardrobe'],
];
for (const [npcId, area, stationId, storageId] of sleepers) {
  const a = analyse(area);
  const station = a.m.npcStations.find(s => s.id === stationId);
  assert.ok(station && station.pose === 'lie', `${npcId} has a lie-down bed station`);
  const bed = a.furnitureTiles.get(`${station.col},${station.row}`);
  assert.ok(bed && /bed/i.test(bed.itemKey), `${npcId}'s station is on a bed or bedroll`);
  const storage = a.m.furniture.find(p => p.id === storageId);
  assert.ok(storage && /wardrobe|chest/i.test(storage.itemKey), `${npcId} has a wardrobe or chest`);
  assert.equal(storage.npcWardrobeFor, npcId, `${npcId}'s storage is bound to them`);
  assert.equal(a.roomOf.get(`${station.col},${station.row}`), a.roomOf.get(`${storage.col},${storage.row}`), `${npcId}'s bed and wardrobe share a room`);
  assert.deepEqual({ area: registry.assignments[npcId]?.area, furnitureId: registry.assignments[npcId]?.furnitureId }, { area, furnitureId: storageId }, `${npcId} registry matches`);
  const rec = db.npcs.find(n => n.id === npcId);
  const slept = (rec.agenda || []).some(b => b.activity === 'sleep' && b.destinationStationId === stationId && b.destinationArea === area);
  assert.ok(slept, `${npcId}'s agenda sends them to ${stationId} to sleep`);
}
// One storage piece per sleeper.
assert.equal(new Set(sleepers.map(s => `${s[1]}|${s[3]}`)).size, sleepers.length, 'no shared wardrobes');
console.log('Room-network layouts: connectivity, doors, beds, wardrobes and sleep schedules passed.');

const shared = map('map_i_carpenters_F2_dzibim');
assert.equal(shared.furniture.filter(f => /bedFurniture$/i.test(f.itemKey)).length, 1, 'parents share one bed');
assert.equal(shared.furniture.find(f => /bedFurniture$/i.test(f.itemKey)).itemKey, 'doubleBedFurniture');
assert.equal(shared.npcStations.filter(st => st.pose === 'lie').length, 2, 'both parents have their own sleeping position');
assert.ok(!map('map_i_carpenters_F2').exits.some(e => e.targetMap === 'map_i_carpenters_F2_dzahiri'), 'hall has one shared parents bedroom entrance');
