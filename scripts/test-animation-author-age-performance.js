'use strict';
const assert = require('node:assert/strict'); // Enforces bounded preview work under drag, stage switching, and late limb arrivals.
const fs = require('node:fs'); // Tests the production editor script rather than a second resize implementation.
const vm = require('node:vm'); // Lets us drive the same private authoring handlers without launching WebGL.
const source = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // The real renderer and age-mode controller.
const nodes = new Map(); // Stable DOM fixtures for the age controls and editor status.
const getNode = id => {
  if (!nodes.has(id)) nodes.set(id, { id, value: '', min: '10', max: '200', hidden: false,
    textContent: '', setAttribute() {}, closest() { return { hidden: false }; }, style: {} });
  return nodes.get(id);
};
const scheduled = new Map(); // Fake browser rAF queue used to prove many input events collapse into one pass.
let nextFrame = 10; // Distinct frame IDs let us confirm only one request is pending.
const frame = fn => { const id = ++nextFrame; scheduled.set(id, fn); return id; };
function flush() {
  const jobs = [...scheduled.values()]; // Execute exactly the pending frame, not any work the callback schedules later.
  scheduled.clear();
  jobs.forEach(job => job());
}
let handSyncCalls = 0; // Detects unnecessary all-actor hand driver updates on hand-only and foot-only drags.
let rigPassCalls = 0; // Only body/head changes may traverse and recompose full rigs.
let lastAppliedHunch = -1; // Confirms growth stages do not accidentally inherit age hunch from their adult donor.
let lookups = 0; // Counts GLB discovery; already discovered limbs must not be rescanned.
const entry = key => {
  const limbs = new Map(); // Distinct visual nodes with trackable baseline scale.
  for (const side of ['left','right']) for (const kind of ['hand_visual','foot']) {
    limbs.set(side + '_' + kind, {
      scale: { x: 2, y: 3, z: 4, set(x,y,z) { this.x = x; this.y = y; this.z = z; } },
      updateMatrix() {},
    });
  }
  return { key, species: 'mao-ao', gender: 'female', npc: { id: key },
    profile: { anatomy: {} }, group: { isObject3D: true, getObjectByName(name) { lookups++; return limbs.get(name); } },
    limbs };
};
const entries = [entry('a'), entry('b'), entry('c')]; // Tests a full-set update rather than only the selected actor.
const storage = new Map(); // Checks stage inputs do not persist huge multi-actor project snapshots per pointer move.
const window = {
  PNGPlaneAvatar: {},
  ProceduralHandFrameDriver: { syncNow() { handSyncCalls++; } },
  HobunjiCharacterRigScale: {
    scaleFor: () => ({ x: 1.2, y: 1.5, head: 1.1, offsetY: 0 }),
    applyToParent(root, species, gender, scale, hunch) { rigPassCalls++; lastAppliedHunch = hunch; },
  },
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { childScaleMultiplier: .5, childHeadScaleMultiplier: .72 } } } },
  HobunjiRomanceConfig: { family: { phaseScales: { basket: { body:.32, head:.5, hand:1.2, foot:1.2 },
    toddler: { body:.4, head:.66, hand:1, foot:1 } }, childLimbModifiers: { hand: 1, foot: 1 } } },
  HobunjiAnimationAuthorScaleHost: { npcAgeFor: () => .65 }, // Adult donor has old-age hunch, unlike a baby/toddler/child.
};
const document = { getElementById: getNode, activeElement: null };
const injected = source.replace('  install();\n})();', `
  window.agePerfTest = {
    activate() { loadAgeModifiers(); active = true; entries = window.testEntries; },
    setAgeMode, applyAgeModifiers, syncAgeControls, scheduleSelectedLayout, disposePreview,
    snapshot() { return { perf: { ...agePerf }, mode: ageMode, runningTimer: !!ageLimbTimer }; },
  };
})();`);
assert.notEqual(injected, source, 'editor must expose a test-only seam without altering its shipped source');
window.testEntries = entries;
vm.runInNewContext(injected, {
  window, document, URL, console,
  location: { pathname: '/tools/animation-author/index.html', href: 'https://example.test/tools/animation-author/index.html' },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,val) => storage.set(key,val), removeItem: key => storage.delete(key) },
  requestAnimationFrame: frame,
  cancelAnimationFrame: id => scheduled.delete(id),
  setTimeout: () => 12, clearTimeout() {},
  setInterval: () => 13, clearInterval() {},
});
const api = window.agePerfTest;
api.activate();
api.setAgeMode('baby');
assert.equal(rigPassCalls, 3, 'stage change applies exactly one composed rig transform per character');
assert.equal(lastAppliedHunch, 0, 'baby lineup cannot inherit the adult representative NPC’s old-age hunch');
assert.equal(handSyncCalls, 1, 'stage switch drives the shared hand solver once, not once per character');
const initialLookups = lookups;
assert.equal(api.snapshot().runningTimer, false, 'fully loaded limbs must not start a repeated polling loop');

for (let i = 120; i <= 149; i++) api.applyAgeModifiers('hand', String(i)); // Simulate thirty fast touch events within one paint interval.
assert.equal(scheduled.size, 1, 'thirty rapid hand updates must schedule one frame');
assert.equal(rigPassCalls, 3, 'hand-only drags must not traverse/rebuild every character rig');
flush();
assert.equal(handSyncCalls, 1, 'hand-only drags must not invoke the expensive all-actors hand solver');
assert.equal(rigPassCalls, 3, 'hand-only drags must not recompute body/head transforms');
assert.equal(lookups, initialLookups, 'cached hand visual refs prevent repeated recursive scene graph searches');
assert.equal(entries[2].limbs.get('left_hand_visual').scale.x, 2 * 1.49, 'last slider input wins, without compounding');

for (let i = 50; i <= 80; i++) api.applyAgeModifiers('width', String(i));
for (let i = 40; i <= 65; i++) api.applyAgeModifiers('height', String(i));
for (let i = 100; i <= 130; i++) api.applyAgeModifiers('head', String(i));
assert.equal(scheduled.size, 1, 'mixed body/head drag events must share one frame');
flush();
assert.equal(rigPassCalls, 6, 'one body/head frame updates each actor only once');
assert.equal(handSyncCalls, 2, 'one body/head frame invokes one hand sync');
assert.equal(api.snapshot().perf.layoutPasses, 2, 'bounding-box relayout runs once per stage switch and once per body/head drag batch');
assert.equal(api.snapshot().runningTimer, false, 'sliders should not re-arm GLB polling when all hands/feet exist');

api.applyAgeModifiers('hand', '165');
api.applyAgeModifiers('foot', '135');
assert.equal(scheduled.size, 1, 'mixed hand/foot changes must be in one frame');
flush();
assert.equal(entries[0].limbs.get('left_hand_visual').scale.x, 2 * 1.65, 'hand update survives batching with foot change');
assert.equal(entries[0].limbs.get('left_foot').scale.x, 2 * 1.35, 'foot update survives batching with hand change');
assert.equal(rigPassCalls, 6, 'mixed limb-only changes cannot recompute whole-body transforms');

const layoutBefore = api.snapshot().perf.layoutPasses; // Species-specific width/head edits need just one further lineup placement pass.
for (let i = 0; i < 30; i++) api.scheduleSelectedLayout();
assert.equal(scheduled.size, 1, 'thirty selected-species changes must queue only one bounding-box layout');
flush();
assert.equal(api.snapshot().perf.layoutPasses, layoutBefore + 1, 'selected species width changes relayout the lineup exactly once');

const number = getNode('maaFullScaleAgeNumHead'); // Mobile keyboard inputs should not be rewritten mid-entry.
number.value = '1';
document.activeElement = number;
api.syncAgeControls();
assert.equal(number.value, '1', 'a partially typed number stays intact until the user commits');
document.activeElement = null;
api.setAgeMode('adult');
assert.equal(lastAppliedHunch, .65, 'the adult reference retains its authored NPC age hunch');
assert.equal(entries[2].limbs.get('left_hand_visual').scale.x, 2, 'adult reference restores each imported GLB baseline');
assert.equal(api.snapshot().runningTimer, false, 'switching to adult mode should not poll already-present limbs');

console.log('PASS age lineup performance: frame batching, no needless hand sync, cached GLBs, no empty polling, numeric editing and adult restoration');
