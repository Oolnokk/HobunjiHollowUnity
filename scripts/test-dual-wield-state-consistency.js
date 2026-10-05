'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const gripSource = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const visualSource = fs.readFileSync('docs/js/dual-wield-weapon-visuals.js', 'utf8');
function fixture(editor) {
  const controls = Object.fromEntries(Object.entries({ scrub: 0, playbackSequence: 'attack', handGripContextSelect: 'melee', toolSpriteSelect: 'hatchet' }).map(([id, value]) => [id, { value }]));
  const tasks = new Map();
  let snapshot = { activeSlot: 'weapon', itemKey: 'hatchet', combatNeutralInjected: false };
  const window = {
    location: { pathname: editor ? '/tools/attack-animation-editor/index.html' : '/index.html' },
    RuntimeFrameScheduler: { register: (id, cb) => tasks.set(id, cb) },
    WeaponToolStances: { getRuntimeState: () => snapshot },
    Combat: { deps: { __weaponToolStanceVisualHooks: true, triggerWeaponSwingVisual() {}, triggerWeaponHoldVisual() {} } },
    HobunjiAttackEditorToolContext: { toolKey: 'hatchet' },
  };
  const scope = { window, location: window.location, document: { getElementById: id => controls[id] || null }, performance: { now: () => 0 } };
  vm.runInNewContext(gripSource, scope);
  vm.runInNewContext(visualSource, scope);
  tasks.get('hand-tool-grips-install')();
  return { window, grips: window.HobunjiHandToolGrips, controls, setSnapshot: value => { snapshot = value; } };
}
const ed = fixture(true);
ed.window.HobunjiDualWieldWeaponVisuals.setEditorIdlePreview(true);
assert.equal(ed.grips.currentSecondaryGripAnimationState().dualWieldInfluence, 1, 'pair preview must enable hand ownership as well as visible copies');
assert.equal(ed.grips.currentDualWieldAnimationState().idleBlend, 1);
assert(ed.grips.dualWieldStateForTool('hatchet'), 'offhand attaches during pair preview');
ed.controls.scrub.value = 0.55;
assert.equal(ed.grips.currentDualWieldAnimationState().idleBlend, 0, 'playing an attack cannot retain the pair-preview idle arrangement');
ed.controls.scrub.value = 0;
ed.window.HobunjiDualWieldWeaponVisuals.setEditorIdlePreview(false);
assert.equal(ed.grips.currentDualWieldAnimationState().influence, 0, 'stopping preview restores authored state');
const authoredDual = { neutral: { dualWield: true }, windup: { dualWield: true }, strike: { dualWield: true } };
ed.grips.restoreEditorSecondaryGripState(authoredDual);
const checkboxState = JSON.stringify(ed.grips.currentDualWieldAnimationState());
ed.window.HobunjiDualWieldWeaponVisuals.setEditorIdlePreview(true);
assert.equal(ed.grips.currentDualWieldAnimationState().influence, 1);
ed.window.HobunjiDualWieldWeaponVisuals.setEditorIdlePreview(false);
assert.equal(JSON.stringify(ed.grips.currentDualWieldAnimationState()), checkboxState, 'preview before/after authoring yields the same result');
ed.grips.loadEditorAnimationGrip({});
for (const key of ['kylie', 'dagger', 'daggerSword', 'dagger-sword-tinbronze']) {
  assert(ed.grips.isDualWieldWeapon(key), key);
  ed.window.HobunjiAttackEditorToolContext.toolKey = key;
  ed.grips.editorToolChanged();
  for (const progress of [0, 0.16, 0.55, 0.8, 1]) {
    ed.controls.scrub.value = progress;
    const hand = ed.grips.currentSecondaryGripAnimationState();
    assert.equal(hand.influence, 0, `${key} must suppress 2H`);
    assert.equal(hand.dualWieldInfluence, 1, `${key} must remain paired throughout the attack`);
    assert.equal(ed.grips.currentDualWieldAnimationState().influence, hand.dualWieldInfluence);
  }
  for (const sequence of ['load', 'fire']) {
    ed.controls.playbackSequence.value = sequence;
    assert.equal(ed.grips.currentDualWieldAnimationState().influence, 0, 'ranged animation remains single-hand');
  }
  ed.controls.playbackSequence.value = 'attack';
  ed.controls.handGripContextSelect.value = 'ranged';
  assert.equal(ed.grips.currentDualWieldAnimationState().influence, 0, 'ranged grip authoring must also hide the duplicate weapons');
  ed.controls.handGripContextSelect.value = 'melee';
}
ed.window.HobunjiAttackEditorToolContext.toolKey = 'hatchet';
ed.grips.editorToolChanged();
ed.controls.scrub.value = 0;
assert.equal(ed.grips.currentDualWieldAnimationState().influence, 0, 'swapping back cannot inherit a preview override');
ed.controls.scrub.value = 0.55;
assert.equal(ed.grips.currentSecondaryGripAnimationState().influence, 1, 'ordinary weapon restores its authored/default 2H attack');
// UI selection can change before its asynchronous sprite load finishes. Sample the installed weapon.
ed.controls.toolSpriteSelect.value = 'dagger';
assert.equal(ed.grips.currentDualWieldAnimationState().influence, 0);
const game = fixture(false);
for (const key of ['kylie', 'dagger-nativecopper', 'daggersword-tinbronze']) {
  game.setSnapshot({ activeSlot: 'weapon', itemKey: key, combatNeutralInjected: false });
  assert.equal(game.grips.currentDualWieldAnimationState().influence, 1, 'game equip starts paired before any attack');
  game.window.Combat.deps.triggerWeaponSwingVisual(1, { pose: { windup: { dualWield: false, secondaryGrip: { enabled: true } } } });
  game.setSnapshot({ activeSlot: 'weapon', itemKey: key, combatNeutralInjected: true, combatProgress: 0.4 });
  assert.equal(game.grips.currentSecondaryGripAnimationState().influence, 0);
  assert.equal(game.grips.currentDualWieldAnimationState().influence, 1, 'legacy 2H metadata cannot override an inherently paired weapon');
  game.setSnapshot({ activeSlot: 'ranged', itemKey: key, combatNeutralInjected: false });
  assert.equal(game.grips.currentDualWieldAnimationState().influence, 0);
}
game.setSnapshot({ activeSlot: 'weapon', itemKey: 'hatchet', combatNeutralInjected: false });
assert.equal(game.grips.currentDualWieldAnimationState().influence, 0);
// Execute the production async swap function with loads completing in reverse order.
(async () => {
  const html = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
  const start = html.indexOf('let toolSpriteRequestId = 0;');
  const end = html.indexOf("$('toolSpriteSelect').innerHTML", start);
  const pending = new Map(), installed = [], disposed = [];
  let toolChanges = 0;
  const scope = { window: { HobunjiDualWieldWeaponVisuals: { teardown() {} }, HobunjiHandToolGrips: { editorToolChanged() { toolChanges++; } } },
    toolPlaneMesh: null, currentToolKey: '', toolHolder: { add: mesh => installed.push(mesh), remove() {} },
    buildToolPlaneMesh: key => new Promise(resolve => pending.set(key, resolve)), disposeToolPlaneMesh: mesh => disposed.push(mesh), logDebug() {} };
  vm.createContext(scope);
  vm.runInContext(html.slice(start, end) + '\nthis.swap = setToolSprite;', scope);
  const first = scope.swap('dagger'), second = scope.swap('hatchet');
  const latest = { key: 'hatchet' }, stale = { key: 'dagger' };
  pending.get('hatchet')(latest); await second;
  pending.get('dagger')(stale); await first;
  assert.equal(scope.currentToolKey, 'hatchet');
  assert.equal(scope.toolPlaneMesh, latest);
  assert.deepEqual(installed, [latest]);
  assert.deepEqual(disposed, [stale]);
  assert.equal(toolChanges, 1, 'only the winning load recomputes hand mode');
  console.log('Dual Wield shared preview state, click order, inherent weapon modes, ranged exclusions, and async swap ordering PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
// Isolating an offhand idle pose must suppress both copies and hand ownership,
// even for a weapon that normally always uses Dual Wield.
ed.window.HobunjiAttackEditorToolContext.toolKey = 'dagger';
ed.controls.scrub.value = 0;
ed.grips.setEditorSingleHandPreview(true);
assert.equal(ed.grips.currentDualWieldAnimationState().influence, 0);
assert.equal(ed.grips.dualWieldStateForTool('dagger'), null);
ed.grips.setEditorSingleHandPreview(false);
assert.equal(ed.grips.currentDualWieldAnimationState().influence, 1);
// Execute the game stance selector: equipment mode and attack-neutral use the same main pose.
const stanceSource = fs.readFileSync('docs/js/weapon-tool-stances.js', 'utf8');
const stanceStart = stanceSource.indexOf('  function targetPoseFor(');
const stanceEnd = stanceSource.indexOf('  function currentCombatNeutral(', stanceStart);
const dualPose = {}, lightPose = {}, heavyPose = {};
const selectStance = vm.runInNewContext(`(${stanceSource.slice(stanceStart, stanceEnd).trim()})`, {
  window: game.window, shapeFor: (key, def) => def?.shapeKey || null, weaponIdleClass: () => 'light',
  idleStances: { dualWieldMain: dualPose, lightWeapon: lightPose, heavyWeapon: heavyPose },
});
for (const key of ['dagger', 'kylie', 'daggersword-nativecopper']) assert.equal(selectStance('weapon', key, {}), dualPose);
assert.equal(selectStance('weapon', 'hatchet', {}), lightPose);
// A stale holder/plane matrix used to make idle placement depend on the last render.
// Run the production sync ordering with a matrix owner that marks its bake.
const syncStart = visualSource.indexOf('  function syncNow(');
const syncEnd = visualSource.indexOf('  function transformSocketForHand(', syncStart);
for (const editor of [true, false]) {
  const operations = [];
  class Vector { clone() { return new Vector(); } multiplyScalar() { return this; } }
  class Quaternion { identity() { return this; } slerp() { return this; } }
  const plane = { position: new Vector(), quaternion: new Quaternion(), updateWorldMatrix() { operations.push('editor-bake'); } };
  const holder = { updateMatrixWorld() { operations.push('game-bake'); } };
  const root = () => ({ updateMatrixWorld() { operations.push('root-world'); } });
  const context = { visual: {}, plane, holder };
  const current = { ...context, mainRoot: root(), offRoot: root() };
  const sync = vm.runInNewContext(`(${visualSource.slice(syncStart, syncEnd).trim()})`, {
    state: current, currentContext: () => context, currentDualState: () => ({ influence: 1, idleBlend: 1 }), ACTIVE_EPSILON: 0.0001,
    inAttackEditor: () => editor, clamp01: value => value, hideOriginalMaterial() {},
    idleOffhandLocalTransform() {
      assert.equal(operations[0], editor ? 'editor-bake' : 'game-bake', 'source matrices must be baked before calculating the offhand idle pose');
      operations.push('idle-pose'); return { position: new Vector(), quaternion: new Quaternion() };
    },
    setRootToward() {}, applyMainLag() { operations.push('main-pose'); },
  });
  sync();
  assert.deepEqual(operations, [editor ? 'editor-bake' : 'game-bake', 'idle-pose', 'main-pose', 'root-world', 'root-world']);
}
