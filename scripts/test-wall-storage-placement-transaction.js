'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/wall-ornament-placement.js', 'utf8'); // Runs the shipped wall placement owner, including async cancellation and delayed stock consumption.
const noop = () => {};
function functionSource(name) {
  const marker = name === 'armNewPlayerFurniture' ? 'async function ' : 'function '; // Includes async ownership when extracting the actual request boundary.
  const start = source.indexOf(marker + name + '(');
  const end = source.indexOf('\n  function ', start + 1);
  assert(start >= 0 && end > start, name);
  return source.slice(start, end);
}
async function main() {
  let currentArea = 'farm'; // Changing scenes while authored metadata loads must invalidate the request.
  let paused = false; // Opening another menu during the load also cancels placement.
  let permitted = true; // Farmhand grants are rechecked after the awaited load.
  let stock = 1; // Storage availability can change while loading.
  let completeLoad = null; // Allows each test to steer the in-flight metadata request deterministically.
  let built = 0; // A rejected request must not create a mesh in any scene.
  const context = vm.createContext({
    console, playerArmGeneration: 0,
    farmDeps: { getCurrentArea: () => currentArea, getScene: () => ({ add: noop }), buildFurnitureVisual() { built++; return {}; } },
    placerDeps: { getDecorativeFurnitureDefs: () => ({ window: { itemKey: 'window', name: 'Window' } }), furnitureStock: () => stock, hasFarmPermission: () => permitted, isPaused: () => paused },
    isWallOrnamentKey: () => true, isHouseWindowKey: () => true,
    loadAttachment: () => new Promise(resolve => { completeLoad = resolve; }),
    cancelPlayerAdjustment() { context.playerArmGeneration++; },
    updatePlayerReticlePreview: noop, toast: noop, window: {},
  });
  vm.runInContext(functionSource('armNewPlayerFurniture'), context);
  for (const reason of ['scene', 'menu', 'permission', 'stock', 'cancel']) {
    currentArea = 'farm'; paused = false; permitted = true; stock = 1;
    const pending = context.armNewPlayerFurniture('window', 'storage'); // Captures farm ownership before the load completes.
    if (reason === 'scene') currentArea = 'town';
    if (reason === 'menu') paused = true;
    if (reason === 'permission') permitted = false;
    if (reason === 'stock') stock = 0;
    if (reason === 'cancel') context.cancelPlayerAdjustment();
    completeLoad({});
    assert.equal(await pending, false, reason + ' invalidates in-flight preview');
    assert.equal(built, 0, 'no stale preview is built after ' + reason);
  }
  currentArea = 'farm'; paused = false; permitted = true; stock = 1;
  const pending = context.armNewPlayerFurniture('window', 'storage'); // A still-current request must remain usable after adding cancellation guards.
  completeLoad({});
  assert.equal(await pending, true);
  assert.equal(built, 1);
  assert.equal(context.playerStockSource, 'storage');

  let writable = false; // Rejecting the metadata transaction must restore the preview and retain the stored window.
  let discarded = 0; // Counts temporary real meshes removed on failed consumption.
  let placed = 0; // Neither placed records nor persisted wall links may be published until the debit succeeds.
  let saves = 0; // Failed transactions must not save a ghost placement.
  const preview = { parent: { remove: noop } }; // The original aim ghost is retained for a retry.
  const scene = { add: node => assert.equal(node, preview) }; // Rollback must restore the same preview rather than constructing another piece.
  const confirmation = vm.createContext({
    console, playerObject: { key: 'window', area: 'farm', mesh: preview }, playerAttachment: {}, playerPreviewValid: true, playerPlacement: {}, playerMode: 'new', playerArmedItemKey: 'window', playerStockSource: 'storage',
    clone: value => ({ ...value }), updatePlayerReticlePreview: noop, playerAnchorCell: () => ({ col: 2, row: 3 }), toast: noop, isHouseWindowKey: () => true,
    placerDeps: { getDecorativeFurnitureDefs: () => ({ window: { itemKey: 'window' } }), furnitureStock: () => stock, hasFarmPermission: () => true,
      consumeFurnitureStock() { if (!writable) return false; stock--; return true; }, disposeDecorativeFurniture() { discarded++; } },
    farmDeps: { getCurrentArea: () => 'farm', getScene: () => scene, makeDecorativeFurnitureMesh: () => ({ mesh: {} }), interiorFurnitureObjects: { push() { placed++; } } },
    setMeshTransform: noop, persistPlayerPlacement() { saves++; }, clearPlayerAimState: noop,
    window: { FarmEditor: { saveFarmLayout() { saves++; } }, HudUpdate: { refreshItemScroll: noop } },
  });
  vm.runInContext(functionSource('confirmPlayerReticlePlacement'), confirmation);
  assert.equal(confirmation.confirmPlayerReticlePlacement(), false);
  assert.equal(discarded, 1);
  assert.equal(placed, 0);
  assert.equal(saves, 0);
  assert.equal(stock, 1);
  assert.equal(confirmation.playerObject.mesh, preview);
  writable = true;
  assert.equal(confirmation.confirmPlayerReticlePlacement(), true, 'preview can be retried when storage is writable');
  assert.equal(stock, 0);
  assert.equal(placed, 1);
  assert.equal(saves, 2);
  console.log('wall storage transactions and asynchronous cancellation: ok');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
