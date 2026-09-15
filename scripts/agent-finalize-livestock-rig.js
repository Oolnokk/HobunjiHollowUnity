'use strict';

const fs = require('node:fs');

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block not found in ${path}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source block is not unique in ${path}`);
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length));
}

// The final values now live in attachment-rig-profiles.js itself, so the old
// post-master sidecar loader must disappear rather than issuing a 404 on every
// gameplay boot.
const loaderPath = 'docs/js/character-action-locks.js';
replaceOnce(
  loaderPath,
  "  const authoredLivestockRig = new URL('../config/attachment-rig-livestock-authored.js?v=20260915riglivestock1', base).href; // Promotes the latest Puktuk/Vorg-ass Rig Coordinates export before creature/game initialization.\n",
  '',
  'obsolete authored livestock sidecar loader',
);
replaceOnce(
  loaderPath,
  '  document.write(`<script src="${authoredLivestockRig}"><\\/script><script src="${chathead}"><\\/script>',
  '  document.write(`<script src="${chathead}"><\\/script>',
  'obsolete authored livestock sidecar script tag',
);

const canonicalTest = String.raw`'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const rigSource = read('docs/config/attachment-rig-profiles.js');
const geneticsSource = read('docs/js/creature-genetics.js');
const rendererSource = read('docs/js/creature-genetics-render.js');
const bridgeSource = read('docs/js/animal-chathead-frame.js');
const loaderSource = read('docs/js/character-action-locks.js');

const localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const windowStub = {
  localStorage,
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: { species: {} },
      assets: {
        pngPlaneAvatar: {
          behindView: { headUrls: {} },
          portraitScaleBySpecies: {},
          portraitVerticalPlacement: {},
          proceduralFeet: { footScale: { default: 1 } },
        },
      },
      creatureGenetics: {
        defaultPatternChance: 1 / 3,
        patternChances: {},
        palettes: { default: [
          { id: 'brown', name: 'Brown', hex: '#6a412e', weight: 4 },
          { id: 'cream', name: 'Cream', hex: '#c7aa77', weight: 4 },
        ] },
      },
      livestock: { animalWidths: { 'gar-wolf': 1.9, uumkaoii: 1.5 }, diet: {}, resources: {} },
    },
  },
  HobunjiCookingData: { items: {} },
};
windowStub.window = windowStub;
const rigContext = vm.createContext({ window: windowStub, localStorage, console });
vm.runInContext(rigSource, rigContext, { filename: 'attachment-rig-profiles.js' });

const profiles = windowStub.HOBUNJI_ATTACHMENT_RIG_PROFILES;
const master = windowStub.HOBUNJI_ATTACHMENT_RIG_MASTER;
assert.ok(profiles?.creatures?.puktuk && profiles?.creatures?.['voorg-ass'], 'runtime attachment library contains both authored livestock profiles');
assert.ok(master?.profiles?.creatures?.puktuk && master?.profiles?.creatures?.['voorg-ass'], 'immutable master contains both authored livestock profiles');

const expected = {
  puktuk: {
    saddle: { x: 0, y: 0.16937859550590686, z: -0.012420318741466083 },
    grip: { x: 0.01, y: -0.29715994741785007, z: -0.0010889163404909086 },
    scales: { large: { x: 1, y: 1 }, medium: { x: 0.6, y: 0.6 }, small: { x: 0.3, y: 0.3 } },
    ground: { large: 0.4, medium: 0.24, small: 0.12 },
    chathead: { x: 0.17142091899942474, y: 0.11029044613093768, width: 0.27636019798104444, height: 0.601013493102534, coordinateSpace: 'sprite-normalized-top-left', version: 1 },
  },
  'voorg-ass': {
    saddle: { x: -0.0016655977917167481, y: 0.12286908956931555, z: 0.043832914384796626 },
    grip: { x: 0.01, y: -0.33453636625016553, z: 0.0181046276028018 },
    scales: { large: { x: 0.97, y: 0.97 }, medium: { x: 0.75, y: 0.75 }, small: { x: 0.27, y: 0.27 } },
    ground: { large: 0.26, medium: 0.325, small: 0.11 },
    chathead: { x: 0.1235, y: 0.14, width: 0.3074, height: 0.3325, coordinateSpace: 'sprite-normalized-top-left', version: 1 },
  },
};

for (const [kind, values] of Object.entries(expected)) {
  for (const library of [master.profiles, profiles]) {
    const profile = library.creatures[kind];
    assert.deepEqual(plain(profile.anchors.saddle.position), values.saddle, `${kind} saddle matches September 15 authoring`);
    assert.deepEqual(plain(profile.anchors.shoulderGrip.position), values.grip, `${kind} shoulder grip matches September 15 authoring`);
    assert.deepEqual(plain(profile.sizeScales), values.scales, `${kind} size scales match September 15 authoring`);
    assert.deepEqual(plain(profile.groundOffsets), values.ground, `${kind} ground offsets match September 15 authoring`);
    assert.deepEqual(plain(profile.chatheadFrame), values.chathead, `${kind} chathead frame matches September 15 authoring`);
    assert.equal(profile.saddleRule.authoredFixed, true, `${kind} saddle is canonical`);
    assert.equal(profile.shoulderGripRule.authoredFixed, true, `${kind} shoulder grip is canonical`);
    assert.equal(profile.sizeScaleRule.authoredFixed, true, `${kind} size scale is canonical`);
    assert.equal(profile.saddleRule.source, 'animation-author-export-2026-09-15');
    assert.equal(profile.shoulderGripRule.source, 'animation-author-export-2026-09-15');
  }
  assert.deepEqual(plain(profiles.creatureShoulderGripDefaults[kind]), values.grip, `${kind} duplicate runtime grip defaults match canonical profile`);
}

const listeners = new Map();
windowStub.addEventListener = (type, callback) => listeners.set(type, callback);
windowStub.__farmLog = () => {};
windowStub.WildlifeSpawn = { init() { return true; } };
const geneticsContext = vm.createContext({ window: windowStub, console, Math, performance: { now: () => 0 }, Set, Map });
vm.runInContext(geneticsSource, geneticsContext, { filename: 'creature-genetics.js' });
const creatureDb = {
  puktuk: { label: 'Puktuk', defaultSizeClass: 'medium' },
  'voorg-ass': { label: 'Voorg-Ass', defaultSizeClass: 'large' },
  'gar-wolf': { label: 'Gar-wolf', defaultSizeClass: 'medium' },
  uumkaoii: { label: "Uumkao'ii", defaultSizeClass: 'large' },
};
windowStub.CreatureGenetics.init({ CREATURE_DB: creatureDb, creatureDb, clamp: (value, min, max) => Math.max(min, Math.min(max, value)) });

for (const [kind, values] of Object.entries(expected)) {
  for (const sizeClass of ['small', 'medium', 'large']) {
    const scale = plain(windowStub.CreatureGenetics.creatureSizeScale(kind, sizeClass));
    assert.deepEqual(scale, { sizeClass, ...values.scales[sizeClass] }, `${kind} runtime scale reads its own canonical ${sizeClass} row`);
    assert.equal(windowStub.CreatureGenetics.creatureGroundOffset(kind, sizeClass), values.ground[sizeClass], `${kind} runtime ground offset reads its own canonical ${sizeClass} row`);
  }
}

windowStub.CreatureGeneticsRender = { SPECIES: { grehlr: { patterns: [] } } };
const onReady = listeners.get('DOMContentLoaded');
assert.equal(typeof onReady, 'function', 'creature genetics registered its renderer-extension hook');
onReady();
const puktukSpec = windowStub.CreatureGeneticsRender.SPECIES.puktuk;
const voorgSpec = windowStub.CreatureGeneticsRender.SPECIES['voorg-ass'];
assert.deepEqual(plain(puktukSpec.eyes), {
  open: 'assets/creaturesprites/puktuk_eye.png',
  blink: 'assets/creaturesprites/puktuk_blink.png',
}, 'Puktuk uses the uploaded open-eye and blink overlays');
assert.equal(Object.prototype.hasOwnProperty.call(voorgSpec, 'eyes'), false, 'Vorg-ass intentionally has no eye overlay; the eyes remain hidden by its hair');
assert.ok(fs.existsSync(path.join(ROOT, 'docs/assets/creaturesprites/puktuk_eye.png')), 'Puktuk open-eye asset exists');
assert.ok(fs.existsSync(path.join(ROOT, 'docs/assets/creaturesprites/puktuk_blink.png')), 'Puktuk blink asset exists');
assert.match(rendererSource, /if \(spec\.eyes\)[\s\S]*blinkShut \? spec\.eyes\.blink : spec\.eyes\.open/, 'shared compositor swaps Puktuk open/blink art through the normal eye layer');
assert.match(rendererSource, /if \(spec\.eyes\) urls\.push\(spec\.eyes\.open, spec\.eyes\.blink\)/, 'renderer prewarm includes eye assets');
assert.match(bridgeSource, /HOBUNJI_ATTACHMENT_RIG_MASTER\?\.profiles\?\.creatures\?\.\[kind\]/, 'Animation Author missing-profile repair checks the immutable same-kind canonical profile first');
assert.match(bridgeSource, /canonical \? clone\(canonical\) : seededProfile/, 'analogue seeding is only a compatibility fallback after canonical lookup');
assert.doesNotMatch(loaderSource, /attachment-rig-livestock-authored/, 'gameplay no longer requests the deleted post-master livestock sidecar');
assert.equal(fs.existsSync(path.join(ROOT, 'docs/config/attachment-rig-livestock-authored.js')), false, 'obsolete livestock rig sidecar stays removed');

console.log('Puktuk/Vorg-ass canonical rig + Puktuk eye integration passed');
`;
fs.writeFileSync('scripts/test-puktuk-voorg-canonical-rig.js', canonicalTest);

const workflow = `name: Voorg-Ass regression

on:
  push:
    paths:
      - 'docs/config/attachment-rig-profiles.js'
      - 'docs/js/creature-genetics.js'
      - 'docs/js/creature-genetics-render.js'
      - 'docs/js/animal-chathead-frame.js'
      - 'docs/js/character-action-locks.js'
      - 'docs/assets/creaturesprites/puktuk_eye.png'
      - 'docs/assets/creaturesprites/puktuk_blink.png'
      - 'docs/tools/animation-author/index.html'
      - 'docs/config/loot/loot-pools.json'
      - 'scripts/test-attachment-rig-master.js'
      - 'scripts/test-puktuk-species.js'
      - 'scripts/test-voorg-ass-species.js'
      - 'scripts/test-new-creature-rig-coordinates.js'
      - 'scripts/test-puktuk-voorg-canonical-rig.js'
      - '.github/workflows/voorg-ass-regression.yml'
  pull_request:
    paths:
      - 'docs/config/attachment-rig-profiles.js'
      - 'docs/js/creature-genetics.js'
      - 'docs/js/creature-genetics-render.js'
      - 'docs/js/animal-chathead-frame.js'
      - 'docs/js/character-action-locks.js'
      - 'docs/assets/creaturesprites/puktuk_eye.png'
      - 'docs/assets/creaturesprites/puktuk_blink.png'
      - 'docs/tools/animation-author/index.html'
      - 'docs/config/loot/loot-pools.json'
      - 'scripts/test-attachment-rig-master.js'
      - 'scripts/test-puktuk-species.js'
      - 'scripts/test-voorg-ass-species.js'
      - 'scripts/test-new-creature-rig-coordinates.js'
      - 'scripts/test-puktuk-voorg-canonical-rig.js'
      - '.github/workflows/voorg-ass-regression.yml'

permissions:
  contents: read

jobs:
  regression:
    runs-on: ubuntu-latest
    steps:
      - name: Check out branch
        uses: actions/checkout@v4
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Syntax check creature genetics
        run: node --check docs/js/creature-genetics.js
      - name: Syntax check Rig Coordinates helper
        run: node --check docs/js/animal-chathead-frame.js
      - name: Syntax check canonical attachment rig
        run: node --check docs/config/attachment-rig-profiles.js
      - name: Validate loot JSON
        run: node -e "JSON.parse(require('node:fs').readFileSync('docs/config/loot/loot-pools.json', 'utf8'))"
      - name: Test attachment rig master
        run: node scripts/test-attachment-rig-master.js
      - name: Test Puktuk integration
        run: node scripts/test-puktuk-species.js
      - name: Test Voorg-Ass integration
        run: node scripts/test-voorg-ass-species.js
      - name: Test new livestock Rig Coordinates integration
        run: node scripts/test-new-creature-rig-coordinates.js
      - name: Test canonical livestock rig and Puktuk eyes
        run: node scripts/test-puktuk-voorg-canonical-rig.js
`;
fs.writeFileSync('.github/workflows/voorg-ass-regression.yml', workflow);

// Remove the one-shot migration machinery from the final PR. A running shell
// can unlink these files safely; the workflow definition is already loaded by
// GitHub for this run.
fs.unlinkSync('.github/workflows/agent-finalize-livestock-rig.yml');
fs.unlinkSync('scripts/agent-finalize-livestock-rig.js');

console.log('Cleaned stale sidecar loader, added canonical runtime/eye regression, and removed one-shot migration files.');
