'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/animal-head-rig-authored.js', 'utf8');
const localStorage = { getItem() { return null; } };
const dabinggiBase = {
  enabled: true,
  pivot: { x: 0.2578125, y: 0.4107142857142857 },
  weightMap: { width: 1, height: 1, encoding: 'rle-u9', unsetValue: 256, data: [1, 255] },
  ownHeadMarker: 'dabinggi-head-stays-dabinggi',
};
const baseMap = {
  grehlr: { legacy: true },
  puktuk: { legacy: true },
  'gar-wolf': { legacy: true },
  'dabinggi-hound': dabinggiBase,
  nazgraku: { enabled:true,pivot:{x:.421875,y:.42592592592592593},weightMap:{marker:'nazgraku-head'} }, // Original head data must be retained.
};
const renderer = {
  ANIMAL_HEAD_RIGS: baseMap,
  HEAD_RIG_VARIANT_ALIASES: {},
};
const speciesApi = {
  ANIMAL_HEAD_RIGS: baseMap,
  baseSpeciesFor(kind) { return kind; },
  resolveForOptions() { return null; },
};
const avatarApi = {
  buildAnimalPlaneAvatarModel(_THREE, _spriteUrl, options) { return { options }; },
};
const windowStub = {
  CreatureGeneticsRender: renderer,
  HobunjiAnimalHeadRigSpecies: speciesApi,
  PNGPlaneAvatar: avatarApi,
  CreatureGenetics: { SPECIES_ALIAS: {} },
  AnimalHeadRigRuntime: { STORAGE_KEY: 'hobunji_animal_head_rigs_v1' },
  __farmLog() {},
  localStorage,
};
windowStub.window = windowStub;
const context = vm.createContext({ window: windowStub, localStorage, console, JSON, Object, String, Array, Number });
vm.runInContext(source, context, { filename: 'animal-head-rig-authored.js' });

const api = windowStub.HobunjiAuthoredAnimalHeadRigs;
assert(api, 'uploaded rig layer exposes a debug-visible API');
assert.equal(api.version, '2026-11-17-gar-wolf-grehlr-rigs1', 'authored rig layer reports the uploaded Gar-wolf and Grehlr release');

const targets = ['puktuk', 'dabinggi-hound', 'nelk', 'drenkirra', 'nazgraku']; // Five species retain the original Puktuk pose; Gar-wolf is now independent.
const puktuk = renderer.ANIMAL_HEAD_RIGS.puktuk;
assert.equal(puktuk.pivot.x, .484375, 'Puktuk retains its original head pivot');
assert.equal(puktuk.pivot.y, .5);
assert.equal(puktuk.shoulderRest.useSpline, true);
assert.equal(puktuk.shoulderRest.useRun1, true);
assert.equal(puktuk.shoulderRest.splitFrame, false);
assert.equal(puktuk.shoulderRest.frameShiftX, .51);
assert.equal(puktuk.shoulderRest.separatorRotationDeg, -13);
assert.equal(puktuk.shoulderRest.afterPoints.length, 7);
for(const kind of targets) {
  const rig = renderer.ANIMAL_HEAD_RIGS[kind];
  assert(rig?.shoulderRest, kind + ' has an installed authored shoulder rig');
  assert.deepEqual(JSON.parse(JSON.stringify(rig.shoulderRest)), JSON.parse(JSON.stringify(puktuk.shoulderRest)), kind + ' begins with the exact Puktuk shoulder pose');
  if(kind !== 'puktuk') {
    assert.notStrictEqual(rig.shoulderRest, puktuk.shoulderRest, kind + ' shoulder settings are not linked');
    assert.notStrictEqual(rig.shoulderRest.beforePoints[0], puktuk.shoulderRest.beforePoints[0], kind + ' points are not linked');
  }
}
const uumkaoii = renderer.ANIMAL_HEAD_RIGS.uumkaoii; // Newly uploaded species-specific shoulder pose.
const voorg = renderer.ANIMAL_HEAD_RIGS['voorg-ass']; // Newly uploaded Voorg-Ass pose, different from Puktuk.
assert.equal(uumkaoii.shoulderRest.useRun1, false, 'Uumkao’ii follows the updated file, not Puktuk');
assert.equal(uumkaoii.shoulderRest.separatorRotationDeg, -1);
assert.equal(uumkaoii.shoulderRest.afterPoints[6].y, .9348808700890657);
assert.equal(voorg.shoulderRest.frameShiftX, .46);
assert.equal(voorg.shoulderRest.splitRightUsesIdle, false);
assert.equal(voorg.shoulderRest.afterPoints[6].y, 1.2729887486531961);
assert.notStrictEqual(voorg.shoulderRest, uumkaoii.shoulderRest, 'uploaded shoulder profiles remain independent');
const moot = renderer.ANIMAL_HEAD_RIGS.moot; // Independent copies of the Voorg-Ass painted neck and shoulder.
assert.notDeepEqual(JSON.parse(JSON.stringify(moot.shoulderRest)), JSON.parse(JSON.stringify(voorg.shoulderRest)), 'Moot preserves the newly uploaded independent shoulder pose');
assert.equal(moot.shoulderRest.separatorAspect, 1.617, 'Moot keeps its uploaded shoulder separator aspect');
assert.notStrictEqual(moot.shoulderRest, voorg.shoulderRest, 'Moot shoulder is an independent record');
assert.notStrictEqual(moot.shoulderRest.beforePoints, voorg.shoulderRest.beforePoints, 'Moot before points are independently editable');
assert.notStrictEqual(moot.shoulderRest.afterPoints[6], voorg.shoulderRest.afterPoints[6], 'Moot after points are independently editable');
assert.equal(moot.weightMap.width, 128, 'Moot has Voorg-Ass painted neck geometry');
assert.equal(moot.weightMap.height, 75, 'Moot has the full painted neck grid');
const mootNeck = JSON.parse(JSON.stringify(moot)); // Full head/neck settings without shoulder data.
const voorgNeck = JSON.parse(JSON.stringify(voorg)); // Source head/neck settings without shoulder data.
delete mootNeck.shoulderRest;
delete voorgNeck.shoulderRest;
assert.notDeepEqual(mootNeck, voorgNeck, 'Moot has its own independently authored head paint and pivot');
assert.equal(moot.pivot.x, .37400034701593793, 'Moot retains the uploaded head pivot');
assert.equal(moot.babyHeadScale, undefined, 'Moot inherits the universal 123% default');
assert.equal(moot.babyHeadFrame.width, .46468750000000003, 'Moot preserves its uploaded head-frame fallback');
assert.notStrictEqual(moot.weightMap.data, voorg.weightMap.data, 'Moot neck paint is independently editable');
assert.notStrictEqual(moot.compressibilityMap.data, voorg.compressibilityMap.data, 'Moot neck compression is independently editable');
assert.notStrictEqual(uumkaoii.shoulderRest, puktuk.shoulderRest, 'Uumkao’ii stays independent of Puktuk');
const gar = renderer.ANIMAL_HEAD_RIGS['gar-wolf'];
assert.equal(gar.pivot.x, .328125, 'Gar-wolf keeps its original head pivot');
assert.equal(gar.shoulderRest.frameShiftX, .43, 'Gar-wolf adopts its new independent shoulder pose');
assert.equal(gar.shoulderRest.separatorRotationDeg, -28);
assert.equal(gar.babyHeadShortening, .24);
assert.equal(gar.babyHeadUsePaintedFrame, false);
const dabinggi = renderer.ANIMAL_HEAD_RIGS['dabinggi-hound'];
assert.equal(dabinggi.ownHeadMarker, 'dabinggi-head-stays-dabinggi', 'Dabinggi keeps its own head rig');
assert.equal(renderer.ANIMAL_HEAD_RIGS.nazgraku.weightMap.marker, 'nazgraku-head', 'Nazgraku keeps its own painted neck');
assert.equal(renderer.ANIMAL_HEAD_RIGS.uumkaoii.weightMap.width, 128, 'Uumkao\'ii retains its own original detailed head paint');
const grehlr = renderer.ANIMAL_HEAD_RIGS.grehlr;
assert.equal(grehlr.pivot.x, .3615050095996143);

assert.equal(grehlr.shoulderRest.frameShiftX, .55, 'Grehlr uses its uploaded shoulder pose');
assert.equal(grehlr.shoulderRest.useRun1, false);
assert.equal(grehlr.shoulderRest.separatorRotationDeg, 0);
assert.equal(grehlr.weightMap.width, 128);
assert.equal(grehlr.compressibilityMap.height, 96);
assert.equal(grehlr.stretchabilityMap.height, 96);
assert.equal(grehlr.babyHeadScale, 1.15);
assert.equal(grehlr.babyHeadShortening, .06);
assert.equal(grehlr.babyAbdomenEnabled, false);
const storedBestiary = JSON.parse(fs.readFileSync('docs/config/creatures/hobunji-creature-bestiary.json', 'utf8')); // Assert the editor's full species records agree with runtime head rigs.
for (const kind of ['gar-wolf', 'grehlr']) {
  const bestiaryRig = storedBestiary.creatures.find(creature => creature.id === kind)?.headRig;
  assert.deepEqual(JSON.parse(JSON.stringify(api.get(kind))), bestiaryRig, kind + ' runtime and bestiary head rigs must agree');
}
const garAvatar = avatarApi.buildAnimalPlaneAvatarModel(null, 'gar-wolf_idle.png', {creatureId:'gar-wolf'}); // Verify the live avatar builder receives the revised shoulder pose.
assert.equal(garAvatar.options.headRig.shoulderRest.frameShiftX, .43);
const avatar = avatarApi.buildAnimalPlaneAvatarModel(null, 'moot_idle.png', {creatureId:'moot'});
assert(avatar.options.headRig?.shoulderRest, 'Moot avatar receives its published shoulder rig through the avatar bridge');


// Upload-integrity fingerprints: FNV-1a across the original 16-bit RLE values, including the 256 unset marker.
function paintedMapFingerprint(map) {
  let hash = 0x811c9dc5;
  for (const value of map.data) {
    hash = Math.imul(hash ^ (value & 255), 0x01000193);
    hash = Math.imul(hash ^ (value >>> 8), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
const uploadedMapFingerprints = {
  'gar-wolf': { weightMap: '1b3d0a54' },
  grehlr: { weightMap: '72fe5e4c', compressibilityMap: 'd59e15f9', stretchabilityMap: 'ef76e3e2' },
}; // Known fingerprints of the two uploaded source JSON head maps.
for (const [kind, maps] of Object.entries(uploadedMapFingerprints)) {
  const rig = api.get(kind);
  for (const [name, digest] of Object.entries(maps)) {
    assert.equal(paintedMapFingerprint(rig[name]), digest, kind + '/' + name + ' matches the uploaded paint values');
    assert.equal(rig[name].data.reduce((sum, value, i) => sum + (i % 2 ? 0 : value), 0),
      rig[name].width * rig[name].height, kind + '/' + name + ' RLE fills exactly its map dimensions');
  }
}
assert.equal(grehlr.babyHeadUsePaintedFrame, false, 'Grehlr explicitly uses alpha rather than the universal painted fallback');
assert.equal(grehlr.babyHeadUseCustomFrame, false, 'Grehlr keeps its stored custom rectangle disabled');
assert.equal(grehlr.babyHeadCustomFrame.width, 0.43339554704016914, 'Grehlr custom rectangle remains available if later re-enabled');
assert.equal(gar.babyAbdomenEnabled, true, 'Gar-wolf abdomen growth remains enabled');
assert.equal(gar.babyAbdomenScale, 1.2);
assert.equal(gar.babyHeadUseCustomFrame, false);

// Load the real production baby warp in the same browser VM as the uploaded authored rigs.
const babyWarpSource = fs.readFileSync('docs/js/baby-animal-head-warp.js', 'utf8');
const outputCanvases = [];
context.document = { createElement(tag) {
  assert.equal(tag, 'canvas');
  const output = { width: 0, height: 0, data: null };
  output.getContext = () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: image => { output.data = image.data; },
  });
  outputCanvases.push(output);
  return output;
} };
vm.runInContext(babyWarpSource, context, { filename: 'baby-animal-head-warp.js' });
const warp = windowStub.BabyAnimalHeadWarp;
for (const [kind, w, h, expectedScale, expectedShortening, hasAbdomen] of [
  ['gar-wolf', 128, 56, 1.23, 0.24, true],
  ['grehlr', 128, 96, 1.15, 0.06, false],
]) {
  assert.equal(warp.scaleForKind(kind), expectedScale, kind + ' uses uploaded or inherited size');
  assert.equal(warp.shorteningForKind(kind), expectedShortening, kind + ' uses uploaded shortening');
  assert.equal(warp.maskModeForKind(kind), 'idle-alpha', kind + ' uses uploaded alpha choice');
  assert.equal(warp.abdomenForKind(kind).enabled, hasAbdomen, kind + ' abdomen switch survives game integration');
  assert.deepEqual(JSON.parse(JSON.stringify(warp.frameForKind(kind))), JSON.parse(JSON.stringify(api.get(kind).babyHeadFrame)),
    kind + ' uses its enabled source frame, not the stored disabled custom head rectangle');
  const rgba = new Uint8ClampedArray(w * h * 4); // Synthetic opaque idle PNG with deterministic body and head pixels.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = x * 2; rgba[i + 1] = y * 3; rgba[i + 2] = x + y; rgba[i + 3] = 255;
  }
  const input = { width: w, height: h, data: rgba,
    getContext: () => ({ getImageData: () => ({ data: rgba }) }) };
  const mask = warp.primeIdleMask(kind, input);
  assert(mask?.opaquePixels > 0, kind + ' can prime an alpha mask using its actual authored frame');
  const enlarged = warp.applyToCanvas(input, kind);
  assert(enlarged !== input && enlarged.data?.some((v, i) => v !== rgba[i]),
    kind + ' grows baby head pixels after mask preparation without rewriting original artwork');
  assert.equal(input.data, rgba, kind + ' keeps its shared adult pixels untouched');
}

console.log('uploaded animal head rigs: Moot retains its independently uploaded head/shoulder painting');
