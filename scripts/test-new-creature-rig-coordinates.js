'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(root, 'docs/js/animal-chathead-frame.js'), 'utf8');
const authorSource = fs.readFileSync(path.join(root, 'docs/tools/animation-author/index.html'), 'utf8');
const geneticsSource = fs.readFileSync(path.join(root, 'docs/js/creature-genetics.js'), 'utf8');

assert.match(geneticsSource, /const PUKTUK_KIND = 'puktuk'/, 'Puktuk must remain a registered creature kind');
assert.match(geneticsSource, /const VOORG_ASS_KIND = 'voorg-ass'/, 'Vorg-ass must remain a registered creature kind');
assert.match(authorSource, /Object\.keys\(window\.CreatureGeneticsRender\?\.SPECIES \|\| \{\}\)/,
  'Animation Author creature selectors must continue deriving their species list from the live creature renderer');
assert.match(authorSource, /animationAuthor\.attachmentRigProfiles\.creatures\[kind\] = profile/,
  'Rig Coordinates must keep creating per-creature profiles for repository creature actors');
assert.match(bridgeSource, /\.\.\/\.\.\/js\/creature-genetics\.js/,
  'Animation Author must load the same gameplay genetics extension that registers post-renderer creature species');
assert.match(bridgeSource, /getElementById\('maaCreatureSpecies'\)/,
  'registry sync must repair the actual Add creature target species picker');

class FakeFile {
  constructor(parts, name, options = {}) {
    this.parts = parts;
    this.name = name;
    this.type = options.type || '';
  }
  async text() { return this.parts.join(''); }
}

const importInput = {
  files: [],
  dispatchCount: 0,
  dispatchEvent() { this.dispatchCount += 1; return true; },
};
const creatureSelect = { // Simulates the broken Add creature target dropdown before runtime-only livestock extensions load.
  value: 'gar-wolf',
  options: [
    { value: 'gar-wolf', textContent: 'Gar Wolf' },
    { value: 'uumkaoii', textContent: "Uumkao'ii" },
  ],
  appendChild(option) { this.options.push(option); return option; },
};
const listeners = new Map();
let requestedRegistryScript = null; // Captures the gameplay genetics module requested by the Animation Author bridge.
const location = { pathname: '/Oolnokk/HobunjiHollowUnity/0123456789012345678901234567890123456789/docs/tools/animation-author/index.html', href: 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/0123456789012345678901234567890123456789/docs/tools/animation-author/index.html' };

const sourceProfiles = {
  'gar-wolf': {
    kind: 'gar-wolf',
    chatheadFrame: { x: 0, y: 0, width: 0.25, height: 0.35 },
    anchors: {
      saddle: { position: { x: 0, y: 0.14, z: 0.27 } },
      shoulderGrip: { position: { x: 0.01, y: -0.26, z: 0.07 } },
    },
    saddleRule: { source: 'approved', authoredFixed: true },
    shoulderGripRule: { source: 'approved', authoredFixed: true },
    sizeScaleRule: { authoredFixed: true },
    sizeScales: { large: { x: 1.5, y: 1.5 }, medium: { x: 1, y: 1 }, small: { x: 0.35, y: 0.35 } },
  },
  uumkaoii: {
    kind: 'uumkaoii',
    chatheadFrame: { x: 0.01, y: 0.29, width: 0.46, height: 0.47 },
    anchors: {
      saddle: { position: { x: 0, y: 0.26, z: 0.02 } },
      shoulderGrip: { position: { x: 0.01, y: -0.36, z: -0.18 } },
    },
    saddleRule: { source: 'approved', authoredFixed: true },
    shoulderGripRule: { source: 'approved', authoredFixed: true },
    sizeScaleRule: { authoredFixed: true },
    sizeScales: { large: { x: 1.5, y: 1.5 }, medium: { x: 1, y: 1 }, small: { x: 0.2, y: 0.2 } },
  },
};
const liveProfiles = { characters: {}, creatures: JSON.parse(JSON.stringify(sourceProfiles)) };

const window = {
  location,
  document: null,
  File: FakeFile,
  Event: class Event { constructor(type, options = {}) { this.type = type; this.bubbles = options.bubbles; } },
  CreatureGeneticsRender: {
    SPECIES: {
      'gar-wolf': { base: { idle: 'gar-wolf-idle.png' } },
      uumkaoii: { base: { idle: 'uumkaoii-idle.png' } },
    },
  },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: sourceProfiles },
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD: {
    reconcileRigExport(payload) { return payload; },
  },
  MultiAvatarAnimationAuthor: {
    getAttachmentRigProfiles() { return JSON.parse(JSON.stringify(liveProfiles)); },
  },
  setTimeout(callback) { callback(); return 1; },
  clearTimeout() {},
  setInterval() { return 41; },
  clearInterval() {},
};
const document = {
  body: { dataset: { animationAuthorMode: 'rig' } },
  getElementById(id) {
    if (id === 'maaImportInput') return importInput;
    if (id === 'maaCreatureSpecies') return creatureSelect;
    return null;
  },
  addEventListener(type, listener) { listeners.set(type, listener); },
  createElement(tag) {
    if (tag === 'option') return { value: '', textContent: '' };
    if (tag === 'script') return { dataset: {}, src: '', async: true, onload: null, onerror: null };
    return {};
  },
  head: {
    appendChild(script) {
      requestedRegistryScript = script.src;
      window.CreatureGeneticsRender.SPECIES.puktuk = { base: { idle: 'puktuk-idle.png' } };
      window.CreatureGeneticsRender.SPECIES['voorg-ass'] = { base: { idle: 'voorg-ass-idle.png' } };
      script.onload?.();
      return script;
    },
  },
};
window.document = document;
window.window = window;

const context = vm.createContext({
  window,
  document,
  location,
  File: FakeFile,
  Event: window.Event,
  URL,
  console,
  setTimeout: window.setTimeout,
  clearTimeout: window.clearTimeout,
  setInterval: window.setInterval,
  clearInterval: window.clearInterval,
  Image: undefined,
});
vm.runInContext(bridgeSource, context, { filename: 'animal-chathead-frame.js' });

const registrySync = window.HobunjiAnimationAuthorCreatureRegistrySync;
assert.ok(registrySync, 'creature target registry sync debug API must be exposed');
assert.match(requestedRegistryScript, /\/docs\/js\/creature-genetics\.js\?v=/, 'Animation Author should request creature-genetics.js from its own commit-relative docs tree');
assert.deepStrictEqual(Array.from(registrySync.missingRendererKinds()), [], 'runtime-extended Puktuk and Vorg-ass renderer definitions must be present after sync');
assert.deepStrictEqual(Array.from(registrySync.missingPickerKinds()), [], 'Add creature target picker must contain Puktuk and Vorg-ass after sync');
assert.deepStrictEqual(creatureSelect.options.map(option => option.value), ['gar-wolf', 'uumkaoii', 'puktuk', 'voorg-ass']);
assert.strictEqual(creatureSelect.options.find(option => option.value === 'puktuk').textContent, 'Puktuk');
assert.strictEqual(creatureSelect.options.find(option => option.value === 'voorg-ass').textContent, 'Vorg-Ass');
assert.strictEqual(creatureSelect.value, 'gar-wolf', 'background picker repair must preserve the current creature selection');
assert.strictEqual(registrySync.getStatus().state, 'clean', 'registry diagnostics should report a fully synchronized picker');

const sync = window.HobunjiAnimationAuthorNewCreatureRigSync;
assert.ok(sync, 'new-creature Rig Coordinates sync debug API must be exposed');
assert.deepStrictEqual(Array.from(sync.missingKinds()).sort(), ['puktuk', 'voorg-ass'], 'both new livestock species must initially be detected as missing');
assert.strictEqual(sync.repairNow(), true, 'missing new creature profiles should dispatch one Rig import');
assert.strictEqual(importInput.dispatchCount, 1, 'repair should use the editor import surface exactly once');
assert.strictEqual(importInput.files.length, 1, 'repair should attach one synthetic Rig JSON file');

const payload = JSON.parse(importInput.files[0].parts.join(''));
const puktuk = payload.profiles.creatures.puktuk;
const voorgAss = payload.profiles.creatures['voorg-ass'];
assert.ok(puktuk && voorgAss, 'synthetic Rig import must contain both Puktuk and Vorg-ass');
assert.strictEqual(puktuk.kind, 'puktuk');
assert.strictEqual(voorgAss.kind, 'voorg-ass');
assert.strictEqual(puktuk.authoringSeed.sourceKind, 'gar-wolf', 'Puktuk starts from the approved size/shape analogue');
assert.strictEqual(voorgAss.authoringSeed.sourceKind, 'uumkaoii', 'Vorg-ass starts from the approved size/shape analogue');
assert.strictEqual(puktuk.authoringSeed.status, 'needs-authoring');
assert.strictEqual(voorgAss.authoringSeed.status, 'needs-authoring');
assert.strictEqual(puktuk.saddleRule.authoredFixed, false, 'seeded Puktuk saddle must remain editable rather than masquerading as approved');
assert.strictEqual(voorgAss.shoulderGripRule.authoredFixed, false, 'seeded Vorg-ass grip must remain editable rather than masquerading as approved');
assert.ok(!Object.hasOwn(puktuk, 'chatheadFrame'), 'Puktuk must not inherit Gar-wolf dialogue framing');
assert.ok(!Object.hasOwn(voorgAss, 'chatheadFrame'), 'Vorg-ass must not inherit Uumkaoii dialogue framing');
assert.deepStrictEqual(puktuk.anchors.saddle.position, sourceProfiles['gar-wolf'].anchors.saddle.position, 'Puktuk should receive a usable first-pass saddle position');
assert.deepStrictEqual(voorgAss.anchors.saddle.position, sourceProfiles.uumkaoii.anchors.saddle.position, 'Vorg-ass should receive a usable first-pass saddle position');
assert.strictEqual(sourceProfiles['gar-wolf'].saddleRule.authoredFixed, true, 'seeding must not mutate the source profile');
assert.strictEqual(sourceProfiles.uumkaoii.shoulderGripRule.authoredFixed, true, 'seeding must not mutate the source profile');

liveProfiles.creatures.puktuk = { ...puktuk, anchors: { ...puktuk.anchors, saddle: { position: { x: 9, y: 8, z: 7 } } } };
liveProfiles.creatures['voorg-ass'] = voorgAss;
assert.deepStrictEqual(Array.from(sync.missingKinds()), [], 'existing authored profiles must no longer be considered repair targets');
assert.strictEqual(sync.repairNow(), false, 'once both species exist, sync must leave edited coordinates untouched');
assert.strictEqual(importInput.dispatchCount, 1, 'clean re-check must not dispatch another import');

const debug = sync.getStatus();
assert.strictEqual(debug.state, 'clean', 'mobile-safe debug status should report a clean Rig library after seeding');
assert.deepStrictEqual(Array.from(debug.missing), []);

console.log('Puktuk/Vorg-ass Rig Coordinates picker and profile integration guards passed');
