'use strict';

// Dev Companion map furniture: the dev overlay merges into authored building
// and town furniture lists exactly (add / edit / remove / restore), placed
// pieces report their state, rotation respects collisions, the palette hides
// internal and alias defs, and export carries patch-ready merged lists.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/dev-map-furniture.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

(async () => {
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const window = { localStorage, console };
  window.window = window;
  const ctx = vm.createContext({ window, localStorage, console, performance: { now: () => 0 }, JSON, Math, Date, Object, Array, Set, Map, String, Number, Promise });
  vm.runInContext(source, ctx);
  const api = window.DevMapFurniture;

  let area = 'map_i_shop';
  let rebuilds = 0;
  let townRespawns = 0;
  const walkable = new Set(['2,2', '3,2', '4,2', '2,3', '3,3', '4,3', '5,5']);
  api.init({
    getCurrentArea: () => area,
    isBuildingArea: a => String(a).startsWith('map_i_'),
    isDevMode: () => true,
    getDecorativeFurnitureDefs: () => ({
      chair: { itemKey: 'chairItem', name: 'Chair', icon: '🪑', fw: 1, fd: 1 },
      table: { itemKey: 'tableItem', name: 'Table', icon: '🟫', fw: 2, fd: 1 },
      innSign: { itemKey: 'innSignFurniture', name: 'Inn Sign', icon: '🪧', fw: 1, fd: 1 },
      wallInnSign: { itemKey: 'innSignFurniture', name: 'Hanging Inn Sign', procKey: 'innSign', fw: 1, fd: 1 },
      __seat_surface_xform_x: { itemKey: '__x', name: 'internal' },
    }),
    getProcessingFurnitureDefs: () => ({ loom: { itemKey: 'loomItem', name: 'Loom', icon: '🧵' } }),
    decorativeFurnitureSize: (key, rot) => { const base = key === 'table' ? [2, 1] : [1, 1]; return (Math.round(rot / 90) % 2) ? { fw: base[1], fd: base[0] } : { fw: base[0], fd: base[1] }; },
    isTileWalkable: (a, c, r) => walkable.has(`${c},${r}`),
    furnitureBaseY: () => 0,
    rebuildBuildingInPlace: async () => { rebuilds++; },
    respawnTownFurniture: () => { townRespawns++; },
    showToast() {}, refreshActionBar() {},
  });

  // Palette: internal helper defs and inventory aliases of a listed piece are hidden.
  const keys = plain(api.catalog().map(item => item.key));
  assert.ok(keys.includes('innSign') && keys.includes('loom'));
  assert.ok(!keys.includes('wallInnSign') && !keys.some(k => k.startsWith('__')), `palette keys: ${keys}`);

  const authored = [
    { id: 'bench_1', itemKey: 'chairItem', col: 2, row: 2 },
    { itemKey: 'tableItem', col: 2, row: 3, rotY: 0 },
  ];
  // Untouched map: authored list passes through unchanged.
  assert.deepEqual(plain(api.mergeBuildingFurniture('map_i_shop', authored)), authored);

  // Overlay: one added piece, one authored removed (no id → signature), one authored edited.
  store.set('hobunji_dev_map_furniture_v1', JSON.stringify({ version: 1, maps: { map_i_shop: {
    added: [{ id: 'devf_a', key: 'chair', kind: 'decorative', itemKey: 'chairItem', col: 5, row: 5, rotY: 90, postX: 0.1, postY: 0.2, postZ: 0.3, wall: null }],
    removed: ['tableItem@2,3'],
    edits: { bench_1: { col: 4, row: 2, rotY: 45 } },
  } } }));
  const merged = plain(api.mergeBuildingFurniture('map_i_shop', authored));
  assert.equal(merged.length, 2);
  assert.deepEqual({ ...merged[0] }, { id: 'bench_1', itemKey: 'chairItem', col: 4, row: 2, rotY: 45 });
  assert.equal(merged[1].id, 'devf_a');
  assert.equal(merged[1].itemKey, 'chairItem');
  assert.equal(merged[1].postY, 0.2);

  // Placed-here view: authored rows flagged edited/removed, overlay rows "overlay".
  const placed = plain(api.placedHere());
  assert.deepEqual(placed.map(p => [p.ref, p.source, p.edited, p.removed]), [
    ['bench_1', 'authored', true, false],
    ['tableItem@2,3', 'authored', false, true],
    ['devf_a', 'overlay', false, false],
  ]);

  // Rotate respects walkability: turning the table back in at 2,3 would need tile 2,4.
  await api.restorePiece('tableItem@2,3');
  assert.equal(rebuilds, 1, 'restore rebuilds the room');
  const blocked = await api.rotatePiece('tableItem@2,3', 90);
  assert.equal(blocked.ok, false, 'rotation into a non-walkable tile is refused');
  const rotated = await api.rotatePiece('devf_a', 45);
  assert.equal(rotated.ok, true);
  assert.equal(JSON.parse(store.get('hobunji_dev_map_furniture_v1')).maps.map_i_shop.added[0].rotY, 135);

  // Remove: overlay pieces disappear, authored pieces become "removed".
  await api.removePiece('devf_a');
  await api.removePiece('bench_1');
  const afterRemove = plain(api.mergeBuildingFurniture('map_i_shop', authored));
  assert.deepEqual(afterRemove.map(f => f.itemKey), ['tableItem']);

  // Gizmo fine-tuning routes only overlay pieces into the overlay.
  store.set('hobunji_dev_map_furniture_v1', JSON.stringify({ version: 1, maps: { map_i_shop: { added: [{ id: 'devf_b', key: 'chair', kind: 'decorative', itemKey: 'chairItem', col: 2, row: 2, rotY: 0, postX: 0, postY: 0, postZ: 0 }], removed: [], edits: {} } } }));
  assert.equal(api.applyGizmoTransform('devf_b', { postX: 0.5, postY: 0, postZ: -0.25, rotY: 30 }), true);
  assert.equal(api.applyGizmoTransform('bench_1', { postX: 1 }), false);
  assert.equal(JSON.parse(store.get('hobunji_dev_map_furniture_v1')).maps.map_i_shop.added[0].postX, 0.5);

  // Town: decorative overlay pieces go to decor[], processing stations to furniture[].
  area = 'town';
  const raw = JSON.parse(store.get('hobunji_dev_map_furniture_v1'));
  raw.maps.map_hobunji_town = { added: [
    { id: 'devf_t1', key: 'chair', kind: 'decorative', col: 1, row: 1, rotY: 0, postX: 0, postY: 0, postZ: 0 },
    { id: 'devf_t2', key: 'loom', kind: 'processing', col: 3, row: 1, rotY: 0, postX: 0, postY: 0, postZ: 0 },
  ], removed: ['well@9,9'], edits: {} };
  store.set('hobunji_dev_map_furniture_v1', JSON.stringify(raw));
  const town = plain(api.mergeTownLists({ decor: [{ key: 'well', col: 9, row: 9 }, { key: 'bench', col: 1, row: 4 }], furniture: [] }));
  assert.deepEqual(town.decor.map(d => d.key), ['bench', 'chair']);
  assert.deepEqual(town.furniture.map(f => f.key), ['loom']);

  // Export: both maps, with merged lists ready to paste over the authored arrays.
  const exported = plain(api.exportChanges());
  const shop = exported.maps.find(m => m.mapId === 'map_i_shop');
  const townExport = exported.maps.find(m => m.mapId === 'map_hobunji_town');
  assert.ok(shop.mergedFurniture.some(f => f.id === 'devf_b') && !shop.mergedFurniture.some(f => 'devOverlay' in f), 'export strips runtime-only flags');
  assert.deepEqual(townExport.mergedDecor.map(d => d.key), ['bench', 'chair']);

  // Discard clears only the current map.
  await api.discardMap();
  assert.equal(townRespawns, 1, 'discarding on the town respawns its furniture');
  assert.ok(!JSON.parse(store.get('hobunji_dev_map_furniture_v1')).maps.map_hobunji_town);
  assert.ok(JSON.parse(store.get('hobunji_dev_map_furniture_v1')).maps.map_i_shop);

  console.log('test-dev-map-furniture: ok');
})().catch(error => { console.error(error); process.exit(1); });
