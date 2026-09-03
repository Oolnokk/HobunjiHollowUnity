const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const runtimeSource = fs.readFileSync('docs/js/animal-chathead-frame.js', 'utf8'); // Guards the shared chathead crop/runtime bridge used by ambient and full dialogue.
const authorSource = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Guards Rig Coordinates authoring and attachment-profile serialization.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Guards runtime load order after creature compositing is available.

assert.match(indexSource, /creature-genetics-render\.js[^\n]*\n\s*<script src="js\/animal-chathead-frame\.js\?v=20260901a"><\/script>/,
  'game must load animal chathead framing immediately after the creature compositor');
assert.match(authorSource, /<script src="\.\.\/\.\.\/js\/animal-chathead-frame\.js\?v=20260901a"><\/script>/,
  'Animation Author must load the shared animal chathead framing helper');
assert.match(authorSource, /chatheadFrame: normalizedAnimalChatheadFrameV1543\(profile\.chatheadFrame\)/,
  'attachment-rig normalization must preserve creature chathead frames across import/export');
assert.match(authorSource, /id="maaAnimalChatheadFrameSection"/,
  'Rig Coordinates inspector must expose an animal chathead framing section');
assert.match(authorSource, /id="maaAnimalChatheadFrameCanvas"/,
  'animal framing must provide a direct touch\/pointer framing canvas');
assert.match(authorSource, /id="maaAnimalChatheadPreviewCanvas"/,
  'animal framing must show the resulting square dialogue chathead');
assert.match(authorSource, /window\.__maaAnimalChatheadFrameDebug/,
  'mobile authoring diagnostics must expose the active creature frame without DevTools');
assert.match(authorSource, /document\.title = 'Hobunji Animation Author V15\.45'/,
  'published author title must identify the animal-chathead framing build after V15.44');
assert.match(authorSource, /MultiAvatarAnimationAuthor\.version = '15\.45'/,
  'public Animation Author API version must match the V15.45 chathead build');

assert.match(runtimeSource, /banubu: 'grehlr'/, 'Banubu must reuse Grehlr chathead framing');
assert.match(runtimeSource, /hiki_hiki: 'drenkirra'/, 'Hiki-hiki must reuse Drenkirra chathead framing');
assert.match(runtimeSource, /canvas\?\.id === 'npcPortraitCanvas'/,
  'full dialogue interception must be limited to the actual portrait canvas');
assert.match(runtimeSource, /String\(options\.seatId \|\| ''\)\.startsWith\('ambient:'\)/,
  'ambient chatheads must resolve animal framing from their speaker seat');
assert.match(runtimeSource, /return original\.call\(preview, targetCanvas, profile, options\)/,
  'ordinary humanoid and in-world avatar renders must continue through the original portrait renderer');
assert.match(runtimeSource, /const DIALOGUE_FACE_EXTRA_DEG = 8/,
  'full livestock dialogue must add a small readability margin on top of the ordinary creature deadzone');
assert.match(runtimeSource, /baseDeadRad \+ DIALOGUE_FACE_EXTRA_RAD/,
  'dialogue facing must derive its readable angle from the existing creature deadzone rather than replacing it with unrelated rotation math');

const sandbox = {
  console,
  Uint16Array,
  Image: undefined,
  setInterval: () => 0,
  clearInterval: () => {},
  window: {
    addEventListener: () => {},
    HOBUNJI_ATTACHMENT_RIG_PROFILES: {
      creatures: {
        grehlr: { chatheadFrame: { x: 0.2, y: 0.1, width: 0.4, height: 0.5 } },
      },
    },
  },
}; // Executes the public frame helpers without DOM/WebGL so malformed normalization cannot hide behind static source checks.
vm.runInNewContext(runtimeSource, sandbox, { filename: 'animal-chathead-frame.js' });
const api = sandbox.window.AnimalChatheadFrame;
assert(api, 'runtime must expose window.AnimalChatheadFrame');

const baseCreatureDeadRad = 27.5 * Math.PI / 180;
let observedDialogueDeadRad = null;
const animalObjects = new Set();
sandbox.window.FarmAnimals = {
  init() {},
}; // Assignment exercises the early FarmAnimals bridge exactly like farm-animals.js loading after this module in index.html.
sandbox.window.FarmAnimals.init({
  animalObjects,
  CREATURE_PERP_DEAD_RAD: baseCreatureDeadRad,
  cameraRelativeCreaturePerps: () => [0, Math.PI],
  perpClamp(_state, requested, _perps, deadRad) {
    observedDialogueDeadRad = deadRad;
    return { effectiveTarget: deadRad, snapTo: null, requested };
  },
});
const dialogueAnimal = {
  livestockId: 'test-livestock',
  groupRot: 0,
  perpState: {},
  avatarRef: { group: { rotation: { y: 0 } } },
};
animalObjects.add(dialogueAnimal);
dialogueAnimal.groupRot = 0.12;
assert.strictEqual(dialogueAnimal.groupRot, 0.12, 'ordinary livestock rotation must remain untouched outside dialogue');
dialogueAnimal._dialogueFrozen = true;
dialogueAnimal.groupRot = 0;
const expectedDialogueDeadRad = (27.5 + api.DIALOGUE_FACE_EXTRA_DEG) * Math.PI / 180;
assert(Math.abs(observedDialogueDeadRad - expectedDialogueDeadRad) < 1e-12,
  'dialogue livestock must reuse the ordinary creature deadzone plus the authored readability margin');
assert(Math.abs(dialogueAnimal.groupRot - expectedDialogueDeadRad) < 1e-12,
  'dialogue group rotation must take the deadzone-safe readable result rather than the direct edge-on request');
dialogueAnimal._dialogueFrozen = false;
dialogueAnimal.groupRot = 0.25;
assert.strictEqual(dialogueAnimal.groupRot, 0.25, 'closing dialogue must immediately restore ordinary groupRot writes');

const resolvedGrehlr = api.frameForKind('grehlr'); // Used below to verify crop callers and 3D-dialogue callers see the exact same rectangle.
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(resolvedGrehlr.frame)),
  { x: 0.2, y: 0.1, width: 0.4, height: 0.5, coordinateSpace: 'sprite-normalized-top-left', version: 1 },
  'authored normalized frame must win over automatic head-rig fallback'
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify({
    x: resolvedGrehlr.x,
    y: resolvedGrehlr.y,
    width: resolvedGrehlr.width,
    height: resolvedGrehlr.height,
    coordinateSpace: resolvedGrehlr.coordinateSpace,
    version: resolvedGrehlr.version,
  })),
  JSON.parse(JSON.stringify(resolvedGrehlr.frame)),
  'resolved frame must expose the same normalized rectangle at top level for full-dialogue world-space consumers'
);
const livestockCenterX = resolvedGrehlr.x + resolvedGrehlr.width * 0.5; // Mirrors the live livestock dialogue camera/head-target calculation in game.js.
const livestockCenterY = resolvedGrehlr.y + resolvedGrehlr.height * 0.5; // Mirrors the live livestock dialogue camera/head-target calculation in game.js.
assert(Number.isFinite(livestockCenterX) && Number.isFinite(livestockCenterY),
  'livestock dialogue must never receive NaN from the resolved frame contract');
assert.strictEqual(livestockCenterX, 0.4);
assert.strictEqual(livestockCenterY, 0.35);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(api.frameCenterForKind('grehlr'))),
  { x: 0.4, y: 0.35, source: 'attachment-rig-profile' },
  'shared head-center helper must agree with the live full-dialogue center math'
);
assert.strictEqual(api.creatureKindFor(null, { speakerId: 'banubu' }), 'grehlr');
assert.strictEqual(api.creatureKindFor(null, { seatId: 'ambient:hiki_hiki:123' }), 'drenkirra');
const clamped = api.normalizeFrame({ x: 0.98, y: -1, width: 0.9, height: 5 });
assert(clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.width <= 1.000001 && clamped.y + clamped.height <= 1.000001,
  'malformed authoring data must clamp inside source sprite bounds');

console.log('animal chathead framing tests passed');
