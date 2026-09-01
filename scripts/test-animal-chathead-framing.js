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
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(api.frameForKind('grehlr').frame)),
  { x: 0.2, y: 0.1, width: 0.4, height: 0.5, coordinateSpace: 'sprite-normalized-top-left', version: 1 },
  'authored normalized frame must win over automatic head-rig fallback'
);
assert.strictEqual(api.creatureKindFor(null, { speakerId: 'banubu' }), 'grehlr');
assert.strictEqual(api.creatureKindFor(null, { seatId: 'ambient:hiki_hiki:123' }), 'drenkirra');
const clamped = api.normalizeFrame({ x: 0.98, y: -1, width: 0.9, height: 5 });
assert(clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.width <= 1.000001 && clamped.y + clamped.height <= 1.000001,
  'malformed authoring data must clamp inside source sprite bounds');

console.log('animal chathead framing tests passed');
