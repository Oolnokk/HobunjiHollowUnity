#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const mapIndex = readJson('docs/config/maps/index.json');
const registry = readJson('docs/config/npcs/placeholder-wardrobes.json');
const gameSource = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
const maps = new Map();
for (const entry of mapIndex.maps || []) {
  if (entry.category !== 'building_interior') continue;
  maps.set(entry.id, readJson('docs/' + entry.file));
}

const FOOTPRINTS = {
  basicBedFurniture:[1,2], doubleBedFurniture:[2,2], bedrollFurniture:[1,1],
  wardrobeFurniture:[2,1], chestFurniture:[1,1], nightstandFurniture:[1,1],
  dresserFurniture:[2,1], bookshelfFurniture:[2,1], crateStackFurniture:[1,1],
};
const STORAGE_RE = /wardrobe|cabinet|chest|nightstand|dresser|bookshelf|shelf|crate/i;
const NEAR_RADIUS = 4;

function footprint(piece) {
  const base = FOOTPRINTS[piece.itemKey] || [1,1];
  const rot = ((Math.round((Number(piece.gridRot)||0)/90)%4)+4)%4*90;
  const quarter = rot === 90 || rot === 270;
  return [
    Math.max(1, Math.round(Number(piece.gridW) || (quarter ? base[1] : base[0]))),
    Math.max(1, Math.round(Number(piece.gridD) || (quarter ? base[0] : base[1]))),
  ];
}
function occupied(piece) {
  const [w,d] = footprint(piece);
  const out=[];
  for(let x=0;x<w;x++) for(let z=0;z<d;z++) out.push([Number(piece.col)+x,Number(piece.row)+z]);
  return out;
}
function distance(a,b) {
  let best=Infinity;
  for(const ta of occupied(a)) for(const tb of occupied(b)) best=Math.min(best,Math.abs(ta[0]-tb[0])+Math.abs(ta[1]-tb[1]));
  return best;
}
function reachable(from,to) {
  if(from===to) return true;
  const seen=new Set([from]), queue=[from];
  while(queue.length){
    const id=queue.shift(), map=maps.get(id);
    for(const exit of map?.exits || []){
      const next=String(exit.targetMap||'');
      if(!next || seen.has(next) || !maps.has(next)) continue;
      if(next===to) return true;
      seen.add(next); queue.push(next);
    }
  }
  return false;
}

const residents = [
  ['kaboku_kunji','map_i_kunjis_potions_F2','fmqf8od68rfzk','fmqf8wtww2gzg','map_i_kunjis_potions_F1'],
  ['kinami_kunji','map_i_kunjis_potions_F2','fmqf8omst6pir','fmqf8vr1xttz3','map_i_kunjis_potions_F1'],
  ['foroji_funji','map_i_general_store_F2_R1','fmqfm59jy9117','fmqfm5w5wz7sx','map_i_general_store'],
  ['furunji_funji','map_i_general_store_F2_R2','fmqfmk85y9zol','fmqfmld6gecfi','map_i_general_store'],
  ['father_hunundi_hodu','map_i_temple_basement_hunundi','f_tbhunundi_bed','f_tbhunundi_wardrobe','map_i_temple'],
  ['namui_u_hakaru','map_i_temple_basement_twins','f_tbtwins_bed_namui','f_tbtwins_wardrobe_namui','map_i_temple'],
  ['takua_ao_hakaru','map_i_temple_basement_twins','f_tbtwins_bed_takua','f_tbtwins_wardrobe','map_i_temple'],
  ['gorobi_ginju','map_i_ginju_farmstead_F2_R1','f_ginjuroom_bed','f_ginjuroom_wardrobe','map_i_ginju_farmstead'],
  ['gikali_ginju','map_i_ginju_farmstead_F2_R1','f_ginjuroom_bed','f_ginjuroom_wardrobe_gikali','map_i_ginju_farmstead'],
  ['aliri_ginju','map_i_ginju_farmstead_F2_R2','f_ginjuroom_bed_aliri','f_ginjuroom_wardrobe_aliri','map_i_ginju_farmstead'],
  ['gantami_ginju','map_i_ginju_farmstead_F2_R2','f_ginjuroom_bed_gantami','f_ginjuroom_wardrobe','map_i_ginju_farmstead'],
  ['teacup_unumanuk','map_i_unumanuk_household_bedroom','f_unmhbed_teacup','f_unmhbed_chest_teacup','map_i_unumanuk_household'],
  ['spearhead_unumanuk','map_i_unumanuk_household_bedroom','f_unmhbed_roll_spearhead','f_unmhbed_chest_spearhead','map_i_unumanuk_household'],
  ['oddclaw_unumanuk','map_i_unumanuk_household_bedroom','f_unmhbed_roll_oddclaw','f_unmhbed_chest_oddclaw','map_i_unumanuk_household'],
  ['binding_hatayap','map_i_unumanuk_household_bedroom','f_unmhbed_roll_binding','f_unmhbed_chest_binding','map_i_unumanuk_household'],
  ['tooth_hatayap','map_i_unumanuk_household_bedroom','f_unmhbed_roll_tooth','f_unmhbed_chest_tooth','map_i_unumanuk_household'],
  ['garanki_gabu','map_i_researchers_tent','f_tent_cot','f_tent_chest_garanki','map_i_researchers_tent'],
  ['hreesh','map_i_inn_F2_hreesh','f_map_i_inn_F2_hreesh_bed','f_map_i_inn_F2_hreesh_wardrobe','map_i_inn'],
  ['jubmir','map_i_inn_F2_jubmir','f_map_i_inn_F2_jubmir_bed','f_map_i_inn_F2_jubmir_wardrobe','map_i_inn'],
  ['dzibim_khibu','map_i_carpenters_F2_dzibim','f_map_i_carpenters_F2_dzibim_bed','f_map_i_carpenters_F2_dzibim_wardrobe','map_i_carpenters'],
  ['dzahiri_khibu','map_i_carpenters_F2_dzahiri','f_map_i_carpenters_F2_dzahiri_bed','f_map_i_carpenters_F2_dzahiri_wardrobe','map_i_carpenters'],
  ['nashka_khibu','map_i_carpenters_F2_nashka','f_map_i_carpenters_F2_nashka_bed','f_map_i_carpenters_F2_nashka_wardrobe','map_i_carpenters'],
  ['kzubug','map_i_smithy_F2_kzubug','f_map_i_smithy_F2_kzubug_bed','f_map_i_smithy_F2_kzubug_wardrobe','map_i_smithy'],
  ['sloomi','map_i_smithy_F2_sloomi','f_map_i_smithy_F2_sloomi_bed','f_map_i_smithy_F2_sloomi_wardrobe','map_i_smithy'],
  ['leaf','map_i_swamp_house_leaf','f_map_i_swamp_house_leaf_bed','f_map_i_swamp_house_leaf_wardrobe','map_i_swamp_house'],
  ['pahu','map_i_swamp_house_pahu','f_map_i_swamp_house_pahu_bed','f_map_i_swamp_house_pahu_wardrobe','map_i_swamp_house'],
];

const claimed = new Set();
for (const [npcId,area,bedId,storageId,rootArea] of residents) {
  const map=maps.get(area);
  assert(map, `${npcId} bedroom ${area} must be indexed and loadable`);
  assert(reachable(rootArea,area), `${npcId} bedroom ${area} must be reachable from ${rootArea}`);
  const bed=(map.furniture||[]).find(piece=>piece.id===bedId);
  const storage=(map.furniture||[]).find(piece=>piece.id===storageId);
  assert(bed, `${npcId} bed ${bedId} must exist`);
  assert(storage, `${npcId} storage ${storageId} must exist`);
  assert(STORAGE_RE.test(String(storage.itemKey||'')), `${npcId} wardrobe target must be storage furniture, not ${storage.itemKey}`);
  assert.equal(String(storage.npcWardrobeFor||''),npcId,`${npcId} storage must carry its authored npcWardrobeFor binding`);
  const storageKey=`${area}|${storage.id}`;
  assert(!claimed.has(storageKey), `${npcId} cannot share physical wardrobe storage ${storageKey}`);
  claimed.add(storageKey);

  const assignedDistance=distance(bed,storage);
  assert(assignedDistance<=NEAR_RADIUS,`${npcId} storage must be near their bed (distance ${assignedDistance})`);
  const available=(map.furniture||[]).filter(piece =>
    STORAGE_RE.test(String(piece.itemKey||'')) &&
    (!piece.npcWardrobeFor || String(piece.npcWardrobeFor)===npcId)
  );
  const nearbyWardrobes=available.filter(piece=>piece.itemKey==='wardrobeFurniture'&&distance(bed,piece)<=NEAR_RADIUS);
  if(nearbyWardrobes.length){
    const closest=Math.min(...nearbyWardrobes.map(piece=>distance(bed,piece)));
    assert.equal(storage.itemKey,'wardrobeFurniture',`${npcId} must use a nearby wardrobe before other storage`);
    assert.equal(assignedDistance,closest,`${npcId} must use their closest available nearby wardrobe`);
  } else {
    const nearbyStorage=available.filter(piece=>distance(bed,piece)<=NEAR_RADIUS);
    assert(nearbyStorage.length,`${npcId} needs a chest/storage item added near the bed`);
    const closest=Math.min(...nearbyStorage.map(piece=>distance(bed,piece)));
    assert.equal(assignedDistance,closest,`${npcId} must use the closest available storage when no wardrobe is nearby`);
  }

  const assignment=registry.assignments?.[npcId];
  assert.deepEqual(
    {area:assignment?.area,furnitureId:assignment?.furnitureId,reason:assignment?.reason},
    {area,furnitureId:storageId,reason:'authored:npcWardrobeFor'},
    `${npcId} registry must mirror the authored bedroom storage`
  );
}

// The fixed Eastern Mire doorway already existed; the missing target map is now real.
assert.match(gameSource,/map_eastern_mire:\s*\[\{[^}]*Little Swamp House[^}]*targetMapId:\s*'map_i_swamp_house'/,
  'Leaf and Pahu\'s fixed Eastern Mire house transition must enter the authored swamp-house interior');

const scheduleOverrides=readJson('docs/config/npcs/schedule-overrides.json');
const stationRedirects=new Map((scheduleOverrides.stationRedirects||[]).map(entry=>[entry.npcId,entry]));
for(const [npcId,mapId,stationId] of [
  ['hreesh','map_i_inn_F2_hreesh','station_inn_hreesh_bed'],
  ['dzibim_khibu','map_i_carpenters_F2_dzibim','station_car_home_dzibim_bed'],
  ['dzahiri_khibu','map_i_carpenters_F2_dzahiri','station_car_home_dzahiri_bed'],
  ['nashka_khibu','map_i_carpenters_F2_nashka','station_car_home_nashka_bed'],
]){
  const redirect=stationRedirects.get(npcId);
  assert.equal(redirect?.mapId,mapId,`${npcId} home schedule must target their connected bedroom`);
  assert.equal(redirect?.toStationId,stationId,`${npcId} home schedule must target their bed station`);
}
const ruleRedirects=new Map((scheduleOverrides.ruleRedirects||[]).map(entry=>[entry.npcId,entry]));
for(const [npcId,mapId,stationId] of [
  ['kzubug','map_i_smithy_F2_kzubug','station_smi_kzubug_bed'],
  ['sloomi','map_i_smithy_F2_sloomi','station_smi_sloomi_bed'],
  ['leaf','map_i_swamp_house_leaf','station_swamp_leaf_bed'],
  ['pahu','map_i_swamp_house_pahu','station_swamp_pahu_bed'],
]){
  const redirect=ruleRedirects.get(npcId);
  assert.equal(redirect?.toMapId,mapId,`${npcId} selective home redirect must target their bedroom`);
  assert.equal(redirect?.toStationId,stationId,`${npcId} selective home redirect must target their bed station`);
}
const jubmir=scheduleOverrides.visitorSchedules?.find(entry=>entry.npcId==='jubmir');
const jubmirSleep=(jubmir?.rules||[]).filter(rule=>/sleep/i.test(rule.activity||''));
assert(jubmirSleep.length>0,'Jubmir visitor schedule must retain overnight rules');
assert(jubmirSleep.every(rule=>rule.mapId==='map_i_inn_F2_jubmir'&&rule.stationId==='station_inn_jubmir_bed'),
  'Jubmir overnight visitor rules must use his dedicated room');

console.log(`NPC bedroom/storage audit passed: ${residents.length} settled residents have reachable beds and priority-correct personal storage.`);
