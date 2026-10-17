#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_json(rel):
    return json.loads((ROOT / rel).read_text())


def write_json(rel, data):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")

# --- Exterior building: exact user-authored Outpost room export, normalized as a shipping piece. ---
footprint_cells = [{"x": x, "y": y} for y in range(7, 11) for x in range(11, 17)]
porches = ([{"x": x, "y": y} for y in range(7, 11) for x in range(6, 11)] +
           [{"x": x, "y": y} for y in (11, 12) for x in range(6, 17)])
railings = [
    {"x":6,"y":7},{"x":7,"y":7},{"x":8,"y":7},{"x":9,"y":7},{"x":10,"y":7},{"x":11,"y":7},
    {"x":6,"y":8},{"x":6,"y":9},{"x":6,"y":10},{"x":16,"y":10},{"x":6,"y":11},{"x":16,"y":11},
    {"x":6,"y":12},{"x":10,"y":12},{"x":11,"y":12},{"x":12,"y":12},{"x":13,"y":12},{"x":14,"y":12},{"x":15,"y":12},{"x":16,"y":12}
]
piece = {
    "id": "3da34777-9c9d-4fd2-b9f9-234fe30392fb",
    "name": "IKMC Outpost",
    "type": "room",
    "preset": "outpost",
    "gridSize": 18,
    "tileSize": 1,
    "footprint": {
        "cells": footprint_cells,
        "door": {"x": 13, "y": 10},
        "connectors": [],
        "extensions": {
            "entryTunnels": [{"x": 13, "y": 10}],
            "tallEntryTunnels": [],
            "chimneys": [],
            "porches": porches,
            "porchStairs": [{"x":7,"y":13},{"x":8,"y":13},{"x":9,"y":13}],
            "railings": railings,
        },
    },
    "base": {
        "height": 1.4,
        "wallThickness": 0.15,
        "groundY": 0,
        "faces": [
            {"id":54,"v":[[-3,0,2],[-3,0,-2],[3,0,-2],[3,0,2]],"tag":"wall","color":None,"outpostFace":"bottom"},
            {"id":55,"v":[[-3,1.4,-2],[-3,1.4,2],[3,1.4,2],[3,1.4,-2]],"tag":"wall","color":None,"outpostFace":"top"},
            {"id":56,"v":[[-3,0,2],[3,0,2],[3,1.4,2],[-3,1.4,2]],"tag":"wall","color":None,"outpostFace":"south"},
            {"id":57,"v":[[3,0,-2],[-3,0,-2],[-3,1.4,-2],[3,1.4,-2]],"tag":"wall","color":None,"outpostFace":"north"},
            {"id":58,"v":[[-3,0,-2],[-3,0,2],[-3,1.4,2],[-3,1.4,-2]],"tag":"wall","color":None,"outpostFace":"west"},
            {"id":59,"v":[[3,0,2],[3,0,-2],[3,1.4,-2],[3,1.4,2]],"tag":"wall","color":None,"outpostFace":"east"},
        ],
    },
    "roof": {
        "tubeRadius":0.08,"tubeSpacing":0.5,"overhang":1.25,"wallOriginReach":True,"direction":"u","lift":0.04,
        "flipX":True,"flipY":False,"flipZ":False,"shingleScaleX":1.2,"shingleScaleY":1.2,"shingleScaleZ":2,
        "shingleRotX":-10,"shingleRotZ":0,"peakRotateAway":True,"secondLayer":True,"secondLayerAcross":0.25,
        "secondLayerLift":0,"secondLayerOverhang":1,"secondLayerWallOriginReach":False,"secondLayerShingleScaleX":1.5,
        "secondLayerShingleScaleY":1.2,"secondLayerShingleScaleZ":2,"secondLayerShingleRotX":0,"secondLayerPeakRotateAway":False,
        "secondLayerFlipX":True,"secondLayerFlipY":False,"secondLayerFlipZ":False,"peakRotate":True,"peakRotateStrength":0.05,
        "peakRotateFalloff":0,"highlandInterlockOffset":0.25,"shingleSource":"",
        "crossGableSections":[{"axis":"x","x0":6,"x1":12,"y0":7,"y1":11,"role":"single_rectangle","roofSpan":4,
            "roofHeight":1.19,"highlandBodyTopScale":0.85,"roofBaseAlignedToCeiling":True,"continuousFrustumSlope":True,
            "triangularPrismRidge":True,"clipToPrimaryRidge":False,"clipSide":""}],
    },
    "assets": [],
    "wallStyle": "logs",
    "logWall": {"seed":"cabin-log-1","logDiameter":0.34,"trunkWonk":0.18,"courseGap":-0.03},
    "extensionGeneration": {"entryTunnelGroups":0,"tallEntryTunnelGroups":0,"chimneyGroups":0,"porches":0,"porchStairs":0,"railings":0,
                            "generatedAt":"2026-10-15T02:53:53.621Z"},
}
write_json("docs/config/pieces/ikmc-outpost.json", piece)

# --- Interior: compact office/shop front with one real bedroom alcove. ---
main_floor = [[x, r] for r in range(6, 10) for x in range(1, 11)]
bedroom_floor = [[x, r] for r in range(1, 5) for x in range(7, 11)]
floor = main_floor + bedroom_floor + [[8,5],[5,10]]
interior = {
    "schema": "hobunji_building_interior.v1",
    "id": "map_i_ikmc_outpost",
    "name": "IKMC Outpost",
    "cols": 12,
    "rows": 12,
    "wallStyle": "logs",
    "logWall": {"seed":"cabin-log-1","logDiameter":0.34,"trunkWonk":0.18,"courseGap":-0.03},
    "floor": floor,
    "furniture": [
        {"id":"f_ikmc_counter","itemKey":"counterFurniture","col":3,"row":7,"rotY":0,"postX":0,"postY":0,"postZ":0,"postSX":1,"postSY":1,"postSZ":1},
        {"id":"f_ikmc_hark_chair","itemKey":"chairSimpleFurniture","col":4,"row":6,"rotY":180,"postX":0,"postY":0,"postZ":0,"postSX":1,"postSY":1,"postSZ":1},
        {"id":"f_ikmc_desk","itemKey":"deskFurniture","col":1,"row":6,"rotY":0,"postX":0,"postY":0,"postZ":0,"postSX":1,"postSY":1,"postSZ":1},
        {"id":"f_ikmc_bookshelf","itemKey":"bookshelfFurniture","col":1,"row":8,"rotY":90,"postX":0,"postY":0,"postZ":0,"postSX":1,"postSY":1,"postSZ":1},
        {"id":"f_ikmc_crates","itemKey":"crateStackFurniture","col":9,"row":8,"rotY":0,"postX":0,"postY":0,"postZ":0,"postSX":1,"postSY":1,"postSZ":1},
        {"id":"f_ikmc_hark_bed","itemKey":"basicBedFurniture","col":8,"row":2,"rotY":0,"postX":0,"postY":0,"postZ":0,"postSX":1,"postSY":1,"postSZ":1},
        {"id":"f_ikmc_hark_wardrobe","itemKey":"wardrobeFurniture","col":8,"row":1,"rotY":0,"postX":0,"postY":0,"postZ":0,"postSX":1,"postSY":1,"postSZ":1,"npcWardrobeFor":"khannibarri_agent"},
        {"id":"f_ikmc_nightstand","itemKey":"nightstandFurniture","col":9,"row":3,"rotY":0,"postX":0,"postY":0,"postZ":0,"postSX":1,"postSY":1,"postSZ":1},
    ],
    "exits": [{"id":"exit_ikmc_outpost_front","label":"Front Door","tiles":[[5,10]],"targetMap":"","spawnCol":0,"spawnRow":0}],
    "colliders": [],
    "vendorZones": [],
    "routes": [
        {"id":"route_ikmc_front_counter","label":"Front door to counter","nodes":[[5,10],[5,8],[4,6]]},
        {"id":"route_ikmc_counter_bed","label":"Counter to bedroom","nodes":[[4,6],[8,6],[8,5],[8,3],[8,2]]},
    ],
    "npcStations": [
        {"id":"station_ikmc_hark_counter","label":"Surveyor's Counter Chair","col":4,"row":6,"rotY":180,"pose":"sit","furnitureKey":"chairSimpleFurniture","seatIndex":0,"toolKey":"","toolIntervalSec":0,"toolAnimStyle":""},
        {"id":"station_ikmc_hark_bed","label":"Surveyor Harkhanash's Bed","col":8,"row":2,"rotY":0,"pose":"lie","toolKey":"","toolIntervalSec":0,"toolAnimStyle":""},
    ],
    "npcPaths": [],
}
write_json("docs/config/maps/map_i_ikmc_outpost.json", interior)

# --- Register the interior map. ---
index_path = "docs/config/maps/index.json"
index = read_json(index_path)
index.setdefault("maps", [])
index["maps"] = [entry for entry in index["maps"] if entry.get("id") != "map_i_ikmc_outpost"]
index["maps"].append({"id":"map_i_ikmc_outpost","file":"config/maps/map_i_ikmc_outpost.json","name":"IKMC Outpost","category":"building_interior"})
write_json(index_path, index)

# --- Move mine, add outpost, and add the exterior door transition. ---
town_path = "docs/config/maps/hobunji_hollow_town.map.json"
town = read_json(town_path)

mine = next((b for b in town.get("buildings", []) if b.get("id") == "bldg_town_mine_entry"), None)
if not mine:
    raise SystemExit("Town mine building not found")
mine["gridX"] = 9
mine["gridZ"] = 3

mine_transition = next((t for t in town.get("transitions", []) if t.get("id") == "spot_town_mine"), None)
if not mine_transition:
    raise SystemExit("Town mine transition not found")
mine_transition["col"] = 10
mine_transition["row"] = 5

outpost_building = {
    "id":"bldg_ikmc_outpost","label":"IKMC Outpost","pieceFile":"config/pieces/ikmc-outpost.json",
    "gridX":13,"gridZ":3,"footprintW":6,"footprintD":4,"wbOpts":None,"wbGableOpts":None,
    "rotationDeg":0,"rotation":0,
    "doorEntrance":{"bboxW":6,"bboxD":4,"cells":[{"x":2,"y":3}],"psCells":[]},
}
town.setdefault("buildings", [])
town["buildings"] = [b for b in town["buildings"] if b.get("id") != "bldg_ikmc_outpost"] + [outpost_building]

outpost_transition = {
    "id":"spot_ikmc_outpost","label":"Enter IKMC Outpost","col":15,"row":7,
    "targetMapId":"map_i_ikmc_outpost","targetSpotId":"","buildingId":"bldg_ikmc_outpost",
}
town.setdefault("transitions", [])
town["transitions"] = [t for t in town["transitions"] if t.get("id") != "spot_ikmc_outpost"] + [outpost_transition]
write_json(town_path, town)

# --- Runtime schedule replacement: Harkhanash works and sleeps only in the Outpost. ---
schedule_path = "docs/config/npcs/schedule-overrides.json"
schedule = read_json(schedule_path)
schedule.setdefault("scheduleReplacements", [])
schedule["scheduleReplacements"] = [r for r in schedule["scheduleReplacements"] if r.get("npcId") != "khannibarri_agent"]
schedule["scheduleReplacements"].append({
    "npcId":"khannibarri_agent",
    "note":"Surveyor Harkhanash now lives and works in the IKMC Outpost rather than using Funji & Son's General Store as a temporary office.",
    "scheduleHooks": {
        "defaultMapId":"map_i_ikmc_outpost",
        "defaultStationId":"station_ikmc_hark_counter",
        "workBuildingId":"bldg_ikmc_outpost",
        "rules":[
            {"id":"harkhanash_sleep_am","from":"00:00","to":"07:00","mapId":"map_i_ikmc_outpost","stationId":"station_ikmc_hark_bed","activity":"sleeping in the IKMC Outpost"},
            {"id":"harkhanash_work","from":"07:00","to":"22:00","mapId":"map_i_ikmc_outpost","stationId":"station_ikmc_hark_counter","activity":"working at the IKMC Outpost"},
            {"id":"harkhanash_sleep_pm","from":"22:00","to":"24:00","mapId":"map_i_ikmc_outpost","stationId":"station_ikmc_hark_bed","activity":"sleeping in the IKMC Outpost"},
        ],
    },
})
write_json(schedule_path, schedule)

# --- Personal storage now belongs to the bedroom, replacing the general-store placeholder. ---
wardrobe_path = "docs/config/npcs/placeholder-wardrobes.json"
wardrobes = read_json(wardrobe_path)
wardrobes.setdefault("assignments", {})
wardrobes["assignments"]["khannibarri_agent"] = {
    "area":"map_i_ikmc_outpost","furnitureId":"f_ikmc_hark_wardrobe","itemKey":"wardrobeFurniture","reason":"authored:npcWardrobeFor"
}
write_json(wardrobe_path, wardrobes)

# Extend the existing bedroom/storage audit so future layout work cannot accidentally orphan Harkhanash again.
bedroom_test_path = ROOT / "scripts/test-npc-bedroom-storage.js"
bedroom_test = bedroom_test_path.read_text()
needle = "  ['jubmir','map_i_inn_F2_jubmir','f_map_i_inn_F2_jubmir_bed','f_map_i_inn_F2_jubmir_wardrobe','map_i_inn'],\n"
addition = needle + "  ['khannibarri_agent','map_i_ikmc_outpost','f_ikmc_hark_bed','f_ikmc_hark_wardrobe','map_i_ikmc_outpost'],\n"
if "['khannibarri_agent','map_i_ikmc_outpost'" not in bedroom_test:
    if needle not in bedroom_test:
        raise SystemExit("NPC bedroom test insertion anchor not found")
    bedroom_test = bedroom_test.replace(needle, addition, 1)
    bedroom_test_path.write_text(bedroom_test)

# Dedicated regression: verifies authored piece, interior, schedule, and requested northern-town placement together.
regression = r'''#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const piece = read('docs/config/pieces/ikmc-outpost.json');
assert.equal(piece.name, 'IKMC Outpost');
assert.equal(piece.preset, 'outpost');
assert.equal(piece.wallStyle, 'logs', 'IKMC Outpost exterior must use stacked generated logs');
assert.equal(piece.base.faces.length, 6, 'Outpost shipping piece must retain the exact six-face prism');
assert(piece.base.faces.every(face => face.tag === 'wall'), 'all six Outpost prism faces must remain tagged wall');
assert.deepEqual(new Set(piece.base.faces.map(face => face.outpostFace)), new Set(['bottom','top','south','north','west','east']));

const interior = read('docs/config/maps/map_i_ikmc_outpost.json');
assert.equal(interior.wallStyle, 'logs', 'IKMC Outpost interior walls must use the shared stacked-log renderer');
assert.equal(interior.furniture.filter(f => f.itemKey === 'basicBedFurniture').length, 1, 'Outpost must have exactly one bedroom bed');
assert(interior.furniture.some(f => f.id === 'f_ikmc_counter' && f.itemKey === 'counterFurniture'), 'Outpost needs its office counter');
assert(interior.furniture.some(f => f.id === 'f_ikmc_hark_chair' && f.itemKey === 'chairSimpleFurniture'), 'Harkhanash needs a chair behind the counter');
assert(interior.furniture.some(f => f.id === 'f_ikmc_hark_wardrobe' && f.npcWardrobeFor === 'khannibarri_agent'), 'bedroom storage must belong to Harkhanash');
assert(interior.npcStations.some(s => s.id === 'station_ikmc_hark_counter' && s.pose === 'sit'), 'day station must seat Harkhanash behind the counter');
assert(interior.npcStations.some(s => s.id === 'station_ikmc_hark_bed' && s.pose === 'lie'), 'overnight station must put Harkhanash in his bed');

const index = read('docs/config/maps/index.json');
assert(index.maps.some(m => m.id === 'map_i_ikmc_outpost' && m.file === 'config/maps/map_i_ikmc_outpost.json'), 'Outpost interior must be indexed');

const schedule = read('docs/config/npcs/schedule-overrides.json');
const hark = (schedule.scheduleReplacements || []).find(r => r.npcId === 'khannibarri_agent');
assert(hark, 'Harkhanash needs a runtime schedule replacement');
assert.equal(hark.scheduleHooks.defaultMapId, 'map_i_ikmc_outpost');
assert.equal(hark.scheduleHooks.defaultStationId, 'station_ikmc_hark_counter');
assert(hark.scheduleHooks.rules.some(r => r.stationId === 'station_ikmc_hark_bed' && /sleep/i.test(r.activity)), 'Harkhanash must sleep in the Outpost bed');
assert(hark.scheduleHooks.rules.every(r => r.mapId === 'map_i_ikmc_outpost'), 'Harkhanash replacement schedule must never send him back to the general store');
assert(!JSON.stringify(hark).includes('map_i_general_store'), 'Harkhanash replacement schedule must contain no general-store destination');

const wardrobes = read('docs/config/npcs/placeholder-wardrobes.json');
assert.deepEqual(
  { area: wardrobes.assignments.khannibarri_agent.area, furnitureId: wardrobes.assignments.khannibarri_agent.furnitureId, reason: wardrobes.assignments.khannibarri_agent.reason },
  { area: 'map_i_ikmc_outpost', furnitureId: 'f_ikmc_hark_wardrobe', reason: 'authored:npcWardrobeFor' }
);

const town = read('docs/config/maps/hobunji_hollow_town.map.json');
const mine = town.buildings.find(b => b.id === 'bldg_town_mine_entry');
const mineDoor = town.transitions.find(t => t.id === 'spot_town_mine');
const outpost = town.buildings.find(b => b.id === 'bldg_ikmc_outpost');
const outpostDoor = town.transitions.find(t => t.id === 'spot_ikmc_outpost');
const carpenter = town.buildings.find(b => b.id === 'bldg_pb9bn');
assert.deepEqual([mine.gridX, mine.gridZ], [9,3], 'mine building must move toward the river on the northern boundary');
assert.deepEqual([mineDoor.col, mineDoor.row], [10,5], 'mine door transition must move with the building');
assert(outpost && outpost.pieceFile === 'config/pieces/ikmc-outpost.json', 'town must place the authored IKMC Outpost piece');
assert.equal(outpost.gridZ, mine.gridZ, 'mine and Outpost must share the same northern placement line');
assert.deepEqual([outpostDoor.col, outpostDoor.row, outpostDoor.targetMapId], [15,7,'map_i_ikmc_outpost']);

const stream = Object.entries(town.tiles || {}).filter(([,tile]) => tile?.type === 'stream').map(([key]) => key.split(',').map(Number));
const riverDistance = Math.min(...stream.map(([c,r]) => Math.abs(c - mineDoor.col) + Math.abs(r - mineDoor.row)));
assert(riverDistance <= 2, `mine entrance must be within two tiles of river; got ${riverDistance}`);
const mineCenter = mine.gridX + mine.footprintW / 2;
const outpostCenter = outpost.gridX + outpost.footprintW / 2;
const carpenterCenter = carpenter.gridX + carpenter.footprintW / 2;
assert(Math.abs(Math.abs(outpostCenter - mineCenter) - Math.abs(carpenterCenter - outpostCenter)) <= 1.5,
  'Outpost should sit roughly equidistant between mine and carpenter along the northern boundary');

console.log('IKMC Outpost regression passed: authored log building/interior, Harkhanash bed+counter schedule, and northern-town placement are wired.');
'''
(ROOT / "scripts/test-ikmc-outpost.js").write_text(regression)

print("Applied IKMC Outpost exterior/interior, Harkhanash schedule, mine relocation, map registration, and regression coverage.")
