'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/config/attachment-rig-livestock-authored.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/character-action-locks.js', 'utf8');

const listeners = new Map();
const intervalCallbacks = [];
const window = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: {
    characters: {},
    creatures: {
      'gar-wolf': { sentinel: 'keep-gar-wolf' },
      uumkaoii: { sentinel: 'keep-uumkaoii' },
    },
    creatureShoulderGripDefaults: {},
  },
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  addEventListener(type, callback) { listeners.set(type, callback); },
  setInterval(callback) { intervalCallbacks.push(callback); return intervalCallbacks.length; },
  clearInterval() {},
};
window.window = window;
const context = vm.createContext({ window, console, Object, JSON, Number, Set });
vm.runInContext(source, context, { filename: 'attachment-rig-livestock-authored.js' });

const profiles = window.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures;
const puktuk = profiles.puktuk;
const voorgAss = profiles['voorg-ass'];
assert.ok(puktuk && voorgAss, 'both authored livestock profiles must be installed into the runtime attachment library');
assert.equal(profiles['gar-wolf'].sentinel, 'keep-gar-wolf', 'Puktuk authoring must not overwrite Gar-wolf');
assert.equal(profiles.uumkaoii.sentinel, 'keep-uumkaoii', 'Vorg-ass authoring must not overwrite Uumkao\'ii');

assert.deepEqual(JSON.parse(JSON.stringify(puktuk.anchors.saddle.position)), {
  x: 0, y: 0.16937859550590686, z: -0.012420318741466083,
});
assert.deepEqual(JSON.parse(JSON.stringify(puktuk.anchors.shoulderGrip.position)), {
  x: 0.01, y: -0.29715994741785007, z: -0.0010889163404909086,
});
assert.deepEqual(JSON.parse(JSON.stringify(puktuk.sizeScales)), {
  large: { x: 1, y: 1 }, medium: { x: 0.6, y: 0.6 }, small: { x: 0.3, y: 0.3 },
});
assert.deepEqual(JSON.parse(JSON.stringify(puktuk.groundOffsets)), { large: 0.4, medium: 0.24, small: 0.12 });
assert.deepEqual(JSON.parse(JSON.stringify(puktuk.chatheadFrame)), {
  x: 0.17142091899942474,
  y: 0.11029044613093768,
  width: 0.27636019798104444,
  height: 0.601013493102534,
  coordinateSpace: 'sprite-normalized-top-left',
  version: 1,
});

assert.deepEqual(JSON.parse(JSON.stringify(voorgAss.anchors.saddle.position)), {
  x: -0.0016655977917167481, y: 0.12286908956931555, z: 0.043832914384796626,
});
assert.deepEqual(JSON.parse(JSON.stringify(voorgAss.anchors.shoulderGrip.position)), {
  x: 0.01, y: -0.33453636625016553, z: 0.0181046276028018,
});
assert.deepEqual(JSON.parse(JSON.stringify(voorgAss.sizeScales)), {
  large: { x: 0.97, y: 0.97 }, medium: { x: 0.75, y: 0.75 }, small: { x: 0.27, y: 0.27 },
});
assert.deepEqual(JSON.parse(JSON.stringify(voorgAss.groundOffsets)), { large: 0.26, medium: 0.325, small: 0.11 });
assert.deepEqual(JSON.parse(JSON.stringify(voorgAss.chatheadFrame)), {
  x: 0.1235,
  y: 0.14,
  width: 0.3074,
  height: 0.3325,
  coordinateSpace: 'sprite-normalized-top-left',
  version: 1,
});

for (const profile of [puktuk, voorgAss]) {
  assert.equal(profile.saddleRule.authoredFixed, true, `${profile.kind} saddle is now canonical authored data`);
  assert.equal(profile.shoulderGripRule.authoredFixed, true, `${profile.kind} shoulder grip is now canonical authored data`);
  assert.equal(profile.sizeScaleRule.authoredFixed, true, `${profile.kind} size scales are now canonical authored data`);
  assert.equal(profile.saddleRule.source, 'animation-author-export-2026-09-15');
  assert.equal(profile.shoulderGripRule.source, 'animation-author-export-2026-09-15');
}
assert.deepEqual(JSON.parse(JSON.stringify(window.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatureShoulderGripDefaults.puktuk)), puktuk.anchors.shoulderGrip.position);
assert.deepEqual(JSON.parse(JSON.stringify(window.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatureShoulderGripDefaults['voorg-ass'])), voorgAss.anchors.shoulderGrip.position);

// Simulate the old creature-genetics public API: Puktuk borrowed Gar-wolf * 0.75,
// while Vorg-ass borrowed Uumkao'ii. The authored bridge must replace those
// values only for the two new species while leaving every other creature alone.
window.CreatureGenetics = {
  creatureSizeScale(kind, input) {
    if (kind === 'puktuk') return { sizeClass: typeof input === 'string' ? input : 'medium', x: 0.75, y: 0.75 };
    if (kind === 'voorg-ass') return { sizeClass: typeof input === 'string' ? input : 'large', x: 1.2, y: 1.2 };
    return { sizeClass: 'medium', x: 9, y: 9 };
  },
  creatureGroundOffset(kind) {
    if (kind === 'puktuk') return 0.2475;
    if (kind === 'voorg-ass') return 0.46;
    return 9;
  },
  creatureSizeTrait(kind, input) {
    const old = this.creatureSizeScale(kind, input);
    return { ...old, label: 'Size', role: 'companion', roleLabel: 'Companion', isNonDefault: false, defaultSizeClass: old.sizeClass };
  },
  genotypeTraits(kind, input) {
    return { size: this.creatureSizeTrait(kind, input), colors: [], patterns: [] };
  },
};
assert.equal(window.HobunjiAuthoredLivestockRig.patchCreatureGeneticsApi(), true, 'authored runtime patch installs once CreatureGenetics exists');

assert.deepEqual(window.CreatureGenetics.creatureSizeScale('puktuk', 'small'), { sizeClass: 'small', x: 0.3, y: 0.3 });
assert.deepEqual(window.CreatureGenetics.creatureSizeScale('puktuk', 'medium'), { sizeClass: 'medium', x: 0.6, y: 0.6 });
assert.deepEqual(window.CreatureGenetics.creatureSizeScale('puktuk', 'large'), { sizeClass: 'large', x: 1, y: 1 });
assert.equal(window.CreatureGenetics.creatureGroundOffset('puktuk', 'small'), 0.12);
assert.equal(window.CreatureGenetics.creatureGroundOffset('puktuk', 'medium'), 0.24);
assert.equal(window.CreatureGenetics.creatureGroundOffset('puktuk', 'large'), 0.4);

assert.deepEqual(window.CreatureGenetics.creatureSizeScale('voorg-ass', 'small'), { sizeClass: 'small', x: 0.27, y: 0.27 });
assert.deepEqual(window.CreatureGenetics.creatureSizeScale('voorg-ass', 'medium'), { sizeClass: 'medium', x: 0.75, y: 0.75 });
assert.deepEqual(window.CreatureGenetics.creatureSizeScale('voorg-ass', 'large'), { sizeClass: 'large', x: 0.97, y: 0.97 });
assert.equal(window.CreatureGenetics.creatureGroundOffset('voorg-ass', 'small'), 0.11);
assert.equal(window.CreatureGenetics.creatureGroundOffset('voorg-ass', 'medium'), 0.325);
assert.equal(window.CreatureGenetics.creatureGroundOffset('voorg-ass', 'large'), 0.26);

assert.deepEqual(window.CreatureGenetics.creatureSizeScale('gar-wolf', 'medium'), { sizeClass: 'medium', x: 9, y: 9 }, 'unrelated species retain the original size implementation');
assert.equal(window.CreatureGenetics.creatureGroundOffset('gar-wolf', 'medium'), 9, 'unrelated species retain the original ground implementation');
assert.deepEqual(
  { x: window.CreatureGenetics.creatureSizeTrait('puktuk', { sizeClass: 'medium' }).x, y: window.CreatureGenetics.genotypeTraits('voorg-ass', { sizeClass: 'large' }).size.y },
  { x: 0.6, y: 0.97 },
  'public trait/UI paths expose the same authored scales used by runtime rendering',
);

const status = window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.authoredLivestockRig;
assert.equal(status.runtimeLibraryApplied, true);
assert.equal(status.creatureGeneticsApiPatched, true);
assert.deepEqual(status.legacyBorrowingBypassed, ['puktuk->gar-wolf', 'voorg-ass->uumkaoii']);

const rigLoaderIndex = loaderSource.indexOf('attachment-rig-livestock-authored.js');
const chatheadLoaderIndex = loaderSource.indexOf('animal-chathead-frame.js');
assert(rigLoaderIndex >= 0, 'runtime bootstrap must load the authored livestock rig config');
assert(chatheadLoaderIndex >= 0 && rigLoaderIndex < chatheadLoaderIndex, 'authored livestock rig config must load before chathead/dialogue runtime consumers');
assert.match(loaderSource, /\$\{authoredLivestockRig\}[\s\S]*\$\{chathead\}/, 'document.write order must execute authored rig settings before other livestock modules');

console.log('Puktuk/Vorg-ass authored rig settings reach runtime unchanged');
