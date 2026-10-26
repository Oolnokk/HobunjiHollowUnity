'use strict';
const assert = require('node:assert/strict'); // Protects shared beds and the intentional Kunji exception.
const fs = require('node:fs'); // Loads the authored maps and NPC schedules.
const read = path => JSON.parse(fs.readFileSync(path, 'utf8')); // All assertions inspect the shipped data.
const db = read('docs/config/npcs/hobunji-starter-npc-database.json'); // Nighttime agendas must address each partner independently.
const cases = [ // Couples sharing one physical bed, with one lie-down station per side.
  ['map_i_carpenters_F2_dzibim', 'dzibim_khibu', 'dzahiri_khibu'],
  ['map_i_ginju_farmstead_F2_R1', 'gorobi_ginju', 'gikali_ginju'],
  ['map_i_swamp_house_leaf', 'leaf', 'pahu'],
];
for (const [id, ...partners] of cases) {
  const map = read(`docs/config/maps/${id}.json`); // Bedroom instance under inspection.
  const beds = map.furniture.filter(f => /bedFurniture$/i.test(f.itemKey)); // Bedrolls do not substitute for the couples' double beds.
  assert.equal(beds.length, 1, `${id}: one shared bed`);
  assert.equal(beds[0].itemKey, 'doubleBedFurniture');
  const spots = new Set(); // Prevents either partner from claiming the other's sleeping tile.
  for (const npcId of partners) {
    const npc = db.npcs.find(n => n.id === npcId); // Each spouse must have an explicit sleeping agenda.
    const sleep = npc.agenda.find(a => a.activity === 'sleep'); // Retain existing authored nighttime windows.
    assert.ok(sleep, `${npcId}: nighttime sleep agenda exists`);
    assert.equal(sleep.destinationArea, id);
    const station = map.npcStations.find(st => st.id === sleep.destinationStationId); // Resolve the agenda into the actual destination instance.
    assert.equal(station?.pose, 'lie', `${npcId}: uses a lie-down station`);
    assert.ok(station.col >= beds[0].col && station.col < beds[0].col + 2 && station.row >= beds[0].row && station.row < beds[0].row + 2, `${npcId}: station lies on the double bed`);
    spots.add(`${station.col},${station.row}`);
  }
  assert.equal(spots.size, 2, `${id}: partners have separate sleeping positions`);
}
const kunji = read('docs/config/maps/map_i_kunjis_potions_F2.json'); // Separate beds are intentional environmental storytelling.
const separate = kunji.furniture.filter(f => /bedFurniture$/i.test(f.itemKey)); // Preserve both single beds in their authored positions.
assert.equal(separate.length, 2);
assert.ok(separate.every(f => f.itemKey === 'basicBedFurniture'));
assert.deepEqual(separate.map(f => [f.col, f.row]), [[7, 2], [8, 2]]);
const workspace = read('docs/config/town-workspace-v1.json'); // Runtime workspace overrides must not hide the shared bedroom entrance.
const swamp = workspace.maps.find(m => m.id === 'map_i_swamp_house'); // Public room is the authoritative transition source in the shipped workspace.
assert.ok(swamp.transitions.some(t => t.targetMapId === 'map_i_swamp_house_leaf'));
assert.ok(!swamp.transitions.some(t => t.targetMapId === 'map_i_swamp_house_pahu'));
const index = read('docs/config/maps/index.json'); // Old save-compatible files are not separate active bedrooms.
assert.ok(!index.maps.some(m => m.id === 'map_i_swamp_house_pahu'));
console.log('Couples share double beds with separate sleep positions; Kaboku and Kinami retain their single beds.');
