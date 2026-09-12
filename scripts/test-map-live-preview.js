'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const protocolSource = fs.readFileSync('docs/js/map-live-preview.js', 'utf8');
const runtimeSource = fs.readFileSync('docs/js/map-live-preview-runtime.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const editorHtml = fs.readFileSync('docs/tools/map-editor/index.html', 'utf8');
const interiorEditorHtml = fs.readFileSync('docs/tools/building-interior-author/index.html', 'utf8');
const indexHtml = fs.readFileSync('docs/index.html', 'utf8');
const townZoneSource = fs.readFileSync('docs/js/town-zone-buildings.js', 'utf8');

assert.doesNotThrow(() => new Function(protocolSource), 'shared live-preview protocol parses');
assert.doesNotThrow(() => new Function(runtimeSource), 'runtime live-preview controller parses');

const inlineScripts = [...editorHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).filter(source => source.trim());
inlineScripts.forEach((source, index) => assert.doesNotThrow(() => new Function(source), `Map Editor inline script ${index + 1} parses`));
const interiorInlineScripts = [...interiorEditorHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).filter(source => source.trim());
interiorInlineScripts.forEach((source, index) => assert.doesNotThrow(() => new Function(source), `Interior Editor inline script ${index + 1} parses`));

const listeners = {};
const storage = new Map();
const context = {
  window: {
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener() {},
  },
  localStorage: {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  },
  BroadcastChannel: undefined,
  Date,
  Math,
  JSON,
  Set,
  Map,
};
vm.createContext(context);
vm.runInContext(protocolSource, context);
const api = context.window.MapLivePreview;

const workspace = { maps: [
  { id: 'root', tiles: {}, layouts: [] },
  { id: 'tier', parentMapId: 'root', tiles: {}, layouts: [] },
] };
assert.equal(api.rootMapId(workspace, 'tier'), 'root', 'plateau sub-map reflections target their runtime root map');
assert.deepEqual(Array.from(api.classifyMapChanges({ tiles: {}, layouts: [] }, { tiles: { '1,2': { type: 'rock' } }, layouts: [] })), ['terrain']);

api.savePendingNavigation({ type: 'navigate', mapId: 'root' });
assert.equal(api.consumePendingNavigation().mapId, 'root', 'cold-start editor navigation survives a new window');
assert.equal(api.consumePendingNavigation(), null, 'cold-start navigation is one-shot');

assert.match(indexHtml, /id="mapEditBtn"[\s\S]*style="display:none;"/, 'off-farm Map Edit control starts hidden');
assert.match(runtimeSource, /area === 'farm'.*Farm editing uses the in-game Farm Editor/, 'runtime explicitly leaves farm authoring to Farm Editor');
assert.match(runtimeSource, /mapSnapshot: generated \? deps\.exportGeneratedMap/, 'procedural zones export a session snapshot to the editor');
assert.match(editorHtml, /id="reflectBtn">↻ Reflect in Game/, 'Map Editor exposes Reflect in Game');
assert.match(editorHtml, /id="openInterior3dBtn"/, 'Map Editor exposes a direct 3D Interior Editor handoff');
assert.match(editorHtml, /type: 'open-interior-author'/, 'Map Editor mirrors unsaved interior data into a standalone 3D editor');
assert.match(editorHtml, /new THREE\.TransformControls/, 'Map Editor 3D view exposes placement transform controls');
assert.match(editorHtml, /spawnPreviewPlacements\(group, merged\)/, 'Map Editor 3D view renders decor and processing furniture');
assert.match(editorHtml, /html = Object\.keys\(DECOR\)\.map\(k =>/, 'Map Editor exposes the complete decor catalog on exterior maps');
for (const key of ['statue', 'nestBranch', 'nest', 'alchemyTable', 'bulletinBoard', 'mineLadder', 'campfire', 'feedGrinder', 'trough']) {
  assert.match(editorHtml, new RegExp(`${key}:\\{`), `Map Editor catalog includes ${key}`);
}
assert.match(interiorEditorHtml, /id="updateMapEditorBtn"/, '3D Interior Editor can update the 2D Map Editor workspace');
assert.match(interiorEditorHtml, /loadData: function\(data, source\)/, '3D Interior Editor accepts live data from the tools hub');
assert.match(runtimeSource, /CharacterActionLocks\?\.acquire/, 'runtime gizmo uses the shared gameplay action lock');
assert.match(runtimeSource, /controls paused/, 'runtime gizmo reports that controls remain paused for the edit session');
assert.match(runtimeSource, /endpoint\.send\(request\);[\s\S]*attachPlacement/, 'in-game selection syncs without forcing focus into the Map Editor window');
assert.match(gameSource, /if \(window\.__mapEditorGizmoActive\)/, 'game input is suppressed for the complete gizmo session');
assert.match(runtimeSource, /type: 'placement-transform'/, 'runtime gizmo mirrors transforms into the Map Editor workspace');
assert.match(townZoneSource, /postSX.*postScale/, 'outdoor runtime decor consumes per-axis placement scale');
assert.match(editorHtml, /isFarmEditorMap\(rootId\)/, 'Map Editor rejects reflection for the linked farm root');
assert.match(gameSource, /player\.x = playerBefore\.x; player\.y = playerBefore\.y/, 'scene rebuild restores exact player position');
assert.match(gameSource, /_detachLivePreviewResidents/, 'scene rebuild detaches and preserves runtime residents');
assert.match(gameSource, /_captureLivePreviewZonePersistence/, 'zone rebuild preserves gathered-resource and regrowth state');
assert.match(gameSource, /rollback also failed/, 'failed reflection has an explicit rollback path');
assert.match(gameSource, /Live generated instance remains session-only/, 'generated wilderness reflection reports its ephemeral scope');

console.log('map live-preview workflow regression checks passed');
