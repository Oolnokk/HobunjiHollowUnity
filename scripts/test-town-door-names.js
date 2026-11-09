'use strict';
const assert = require('node:assert/strict'); // Checks displayed names and editor synchronization.
const fs = require('node:fs'); // Loads the owning module and editor function.
const vm = require('node:vm'); // Exercises browser code without initializing the renderer.
const buildings = [{ id: 'shop', label: 'The Friendly Carpenter' }]; // Placed names deliberately differ from the template and saved spot label.
const context = { window: { StructurePreload: { ensureReady: async () => ({ ready: false }) } } }; // Preload remains inert for these prompt tests.
vm.runInNewContext(fs.readFileSync('docs/js/town-zone-buildings.js', 'utf8'), context);
const api = context.window.TownZoneBuildings; // Actual prompt authority used by game.js.
api.init({ getTownZone: () => ({ buildings }) });
assert.equal(api.entranceLabel({ target: 'building', buildingId: 'shop', label: 'HobunjiHouse1' }), 'Enter The Friendly Carpenter');
buildings[0].label = 'Renamed Carpenter';
assert.equal(api.entranceLabel({ target: 'building', buildingId: 'shop', label: 'HobunjiHouse1' }), 'Enter Renamed Carpenter', 'reads the latest editor name');
assert.equal(api.entranceLabel({ target: 'interior', id: 'bldg_entrance_shop' }), 'Enter Renamed Carpenter', 'automatic entrances use the placed name too');
assert.equal(api.entranceLabel({ target: 'farm', buildingId: 'shop', label: 'To Farm' }), 'To Farm', 'nonbuilding routes keep their own label');
assert.equal(api.entranceLabel({ target: 'building', label: 'Enter Town Mine' }), 'Enter Town Mine', 'unlinked routes retain their existing readable label');
assert.equal(api.entranceLabel({ target: 'building' }), 'Enter', 'missing data has a usable fallback');

const editor = fs.readFileSync('docs/tools/map-editor/index.html', 'utf8'); // Extracts the owner that runs when the building is renamed or moved.
const start = editor.indexOf('function syncBuildingSpot('); // Function boundaries exclude page setup and rendering.
const end = editor.indexOf('// One-time migration', start); // Stable section boundary follows the entire production function.
const renameContext = { doorWorldFromBuilding: () => ({ col: 4, row: 8 }), uid: () => 'new-spot' }; // Geometry is orthogonal to naming in this test.
vm.createContext(renameContext);
vm.runInContext(editor.slice(start, end), renameContext);
const map = { transitions: [{ id: 'old', buildingId: 'shop', label: 'Enter HobunjiHouse1', targetMapId: 'map_i_carpenters', targetSpotId: 'front' }] }; // Existing saves must keep their destination while acquiring the current name.
renameContext.syncBuildingSpot(buildings[0], map);
assert.equal(map.transitions[0].label, 'Enter Renamed Carpenter');
assert.equal(map.transitions[0].targetMapId, 'map_i_carpenters');
assert.equal(map.transitions[0].targetSpotId, 'front');
assert.equal(map.transitions.length, 1, 'rename never duplicates the door');
const fresh = { transitions: [] }; // New entrances use the same naming rule.
renameContext.syncBuildingSpot(buildings[0], fresh);
assert.equal(fresh.transitions[0].label, 'Enter Renamed Carpenter');
console.log('Town door prompts use placed building names and remain synchronized after editor renames.');
