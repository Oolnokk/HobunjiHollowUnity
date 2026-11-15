'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = p => fs.readFileSync(p, 'utf8');
const index = read('docs/index.html');
const entry = read('docs/tools/preview-map/index.html');
const source = read('docs/js/precreator-arena.js');
const arena = read('docs/js/dev-arena-pond-dummy.js');
assert(index.indexOf('js/storage-quota-guard.js?') > 0
  && index.indexOf('js/storage-quota-guard.js?') < index.indexOf('js/precreator-arena.js?')
  && index.indexOf('js/precreator-arena.js?') < index.indexOf('js/substance-cover-shell.js?'));
assert(entry.includes('index.html?previewArena=1'));
assert(entry.includes('tap-reliability.js'));
assert(read('docs/onboarding-core.js').includes('window.__hobunjiPrecreatorArena'));
assert(read('docs/js/opening-story-cutscene.js').includes('window.__hobunjiPrecreatorArena'));
assert(source.includes('DevSpawner.teleportToDevArena()'));
assert(source.includes('EquipmentPanel.refreshPlayerAvatar()'));
assert(source.includes('PlayerBodyTransformComposer?.setChannel?.('));
assert(source.includes('CinematicCameraRuntime.activate(ARENA'));
assert(source.includes('PantsGarmentRenderer'));
assert(arena.includes('previewApplyAppearance, previewEquipTool'));
assert(!source.includes('new THREE.WebGLRenderer'));
new Function(source);
new Function(arena);
function session(blocked = false, preview = true) {
  const saved = new Map([['hobunjiSaveMeta', 'real-save']]);
  const realLocal = { length: 1, getItem: k => saved.get(k) ?? null,
    setItem: (k,v) => saved.set(k,v) };
  const realSession = { length: 0, getItem: () => null, setItem() {} };
  const databases = [];
  const factory = { open: k => { databases.push(k); return {}; },
    deleteDatabase: k => { databases.push('deleted:' + k); return {}; }, cmp: () => 0 };
  const listeners = new Map();
  const document = { readyState: 'loading', addEventListener: (type,cb) => listeners.set(type,cb) };
  const window = { localStorage: realLocal, sessionStorage: realSession,
    indexedDB: factory, addEventListener() {} };
  if(blocked) Object.defineProperty(window,'localStorage',{value:realLocal,configurable:false});
  vm.runInNewContext(source, { window, document, navigator: { getGamepads: () => [] },
    location: {search:preview?'?previewArena=1':''},
    URLSearchParams, Map, Set, Symbol, Object, Reflect, Math, Date });
  return { window, saved, databases, listeners };
}
const normal = session(false,false);
assert.equal(normal.window.HobunjiPrecreatorArena,undefined);
const blocked = session(true,true);
assert.equal(blocked.window.__hobunjiPlayerProfile,undefined);
assert.equal(blocked.saved.get('hobunjiSaveMeta'),'real-save');
const preview = session();
assert(preview.window.__hobunjiPrecreatorArena?.temporary);
assert.equal(preview.window.__hobunjiPlayerProfile.worldId,preview.window.HobunjiPrecreatorArena.guestId);
assert.equal(preview.window.localStorage.getItem('hobunjiSaveMeta'),null);
preview.window.localStorage.setItem('hobunjiSaveMeta','guest-save');
assert.equal(preview.window.localStorage.getItem('hobunjiSaveMeta'),'guest-save');
assert.equal(preview.saved.get('hobunjiSaveMeta'),'real-save');
preview.window.indexedDB.open('hobunjiData');
assert(preview.databases[0].startsWith('hobunji-precreator-'));
assert(preview.listeners.has('DOMContentLoaded'));
console.log('precreator arena live integration and save quarantine: ok');
