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
ed.window.HobunjiAttackEditorToolContext.toolKey = 'dagger';
ed.window.HobunjiDualWieldWeaponVisuals.setEditorIdlePreview(true);
assert.equal(ed.grips.currentSecondaryGripAnimationState().dualWieldInfluence, 1, 'pair preview must enable hand ownership as well as visible copies');
assert.equal(ed.grips.currentDualWieldAnimationState().idleBlend, 1);
assert(ed.grips.dualWieldStateForTool('dagger'), 'offhand attaches during pair preview');
ed.controls.scrub.value = 0.55;
assert.equal(ed.grips.currentDualWieldAnimationState().idleBlend, 0, 'playing an attack cannot retain the pair-preview idle arrangement');
ed.controls.scrub.value = 0;
ed.window.HobunjiDualWieldWeaponVisuals.setEditorIdlePreview(false);
assert.equal(ed.grips.currentDualWieldAnimationState().influence, 1, 'stopping preview restores the authored paired Neutral state');
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
  game.window.Combat.deps.triggerWeaponSwingVisual(1, { pose: { windup: { dualWield: true, secondaryGrip: { enabled: true } } } });
  game.setSnapshot({ activeSlot: 'weapon', itemKey: key, combatNeutralInjected: true, combatProgress: 0.4 });
  assert.equal(game.grips.currentSecondaryGripAnimationState().influence, 0);
  assert.equal(game.grips.currentDualWieldAnimationState().influence, 1, 'a paired weapon reads Dual Wield even when 2H is also authored');
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
// Independent flags select behavior by weapon without rewriting the authored animation.
const bothFlags = {
  neutral: { secondaryGrip: { enabled: false }, dualWield: { enabled: true } },
  windup: { secondaryGrip: { enabled: true }, dualWield: { enabled: true } },
  strike: { secondaryGrip: { enabled: true }, dualWield: { enabled: true } },
};
for (const key of ['dagger', 'daggersword', 'kylie', 'hatchet', 'fishingspear', 'pickshovel', 'fishingmace']) {
  for (const progress of [0, 0.16, 0.55, 1]) {
    const sample = ed.grips.animationGripAt(progress, {}, bothFlags, 'attack', key);
    const mode = ed.grips.weaponHandModeForTool(key);
    assert.equal(sample.dualWieldInfluence, mode === 'dual' ? 1 : 0, `${key} uses only its own flag`);
    assert.equal(sample.influence, mode === 'two-hand' && progress !== 0 && progress !== 1 ? 1 : 0);
  }
}
for (const key of ['hatchet', 'dagger', 'fishingmace']) {
  ed.window.HobunjiAttackEditorToolContext.toolKey = key;
  ed.controls.jsonView = { value: JSON.stringify({ poses: {} }) };
  const animation = JSON.parse(JSON.stringify(bothFlags));
  ed.grips.loadEditorAnimationGrip({ poses: animation });
  const loaded = ed.grips.editorSecondaryGripStateSnapshot();
  const exported = JSON.parse(ed.controls.jsonView.value).poses;
  for (const phase of ['neutral', 'windup', 'strike']) {
    assert.equal(loaded[phase].dualWield, true);
    assert.equal(loaded[phase].enabled, phase !== 'neutral');
    assert.equal(exported[phase].dualWield.enabled, true, 'preview weapon cannot change the exported Dual Wield flag');
    assert.equal(exported[phase].secondaryGrip.enabled, phase !== 'neutral');
  }
}
// Explicit unchecked flags stay unchecked, and the unused checkbox cannot take over.
const only2H = JSON.parse(JSON.stringify(bothFlags));
for (const phase of ['neutral', 'windup', 'strike']) only2H[phase].dualWield.enabled = false;
assert.equal(ed.grips.animationGripAt(0.55, {}, only2H, 'attack', 'dagger').dualWieldInfluence, 0);
assert.equal(ed.grips.animationGripAt(0.55, {}, only2H, 'attack', 'dagger').influence, 0);
const onlyDual = JSON.parse(JSON.stringify(bothFlags));
for (const phase of ['neutral', 'windup', 'strike']) onlyDual[phase].secondaryGrip.enabled = false;
assert.equal(ed.grips.animationGripAt(0.55, {}, onlyDual, 'attack', 'hatchet').influence, 0);
assert.equal(ed.grips.animationGripAt(0.55, {}, onlyDual, 'attack', 'hatchet').dualWieldInfluence, 0);
ed.grips.loadEditorAnimationGrip({ poses: { neutral: { dualWield: false }, windup: { dualWield: true, secondaryGrip: { enabled: true } } } });
assert.equal(ed.grips.editorSecondaryGripStateSnapshot().neutral.dualWield, false, 'loading Windup does not rewrite Neutral');
ed.grips.restoreEditorSecondaryGripState({ windup: { enabled: true, dualWield: true } });
assert.equal(ed.grips.editorSecondaryGripStateSnapshot().windup.enabled, true, 'undo restores both flags');
assert.equal(ed.grips.editorSecondaryGripStateSnapshot().windup.dualWield, true);
// Execute the real checkbox callbacks in either click order.
for (const order of ['dual-first', '2h-first']) {
  const modes = { neutral: {}, windup: { enabled: false, dualWield: false } };
  const enabled = { checked: true, addEventListener: (_, cb) => { enabled.change = cb; } };
  const dual = { checked: true, addEventListener: (_, cb) => { dual.change = cb; } };
  const start = gripSource.indexOf("      enabled.addEventListener('change', () => { setEditorIdlePreview(false);");
  const end = gripSource.indexOf('      const primaryPercent', start);
  assert(start >= 0 && end > start);
  vm.runInNewContext(gripSource.slice(start, end), {
    enabled, dual, phase: 'windup', editorSecondaryPoses: modes, setEditorIdlePreview() {}, patchEditorJsonView() {}, syncEditorSpanUi() {},
    global: {}, isDualWieldWeapon: () => false, editorCurrentToolKey: () => 'hatchet',
  });
  if (order === 'dual-first') { dual.change(); enabled.change(); } else { enabled.change(); dual.change(); }
  assert.equal(modes.windup.enabled, true);
  assert.equal(modes.windup.dualWield, true);
  assert.equal(modes.neutral.dualWield, undefined, 'one pose never changes a different pose');
}
// Fishing mace remains single-handed in the game even with every authored flag on.
game.window.Combat.deps.triggerWeaponSwingVisual(1, { pose: bothFlags });
game.setSnapshot({ activeSlot: 'weapon', itemKey: 'fishingmace', combatNeutralInjected: true, combatProgress: 0.55 });
assert.equal(game.grips.currentDualWieldAnimationState().influence, 0);
assert.equal(game.grips.currentSecondaryGripAnimationState().influence, 0);
assert.equal(game.grips.dualWieldStateForTool('fishingmace'), null);
assert.equal(game.grips.secondaryGripForTool('fishingmace'), null);
game.setSnapshot({ activeSlot: 'ranged', itemKey: 'dagger', combatNeutralInjected: true, combatProgress: 0.55 });
assert.equal(game.grips.currentDualWieldAnimationState().influence, 0);
// Verify the actual authored definitions rather than relying on runtime defaults.
function assertAuthoredFlags(poses, name) {
  for (const phase of ['neutral', 'windup', 'strike']) {
    assert.equal(poses[phase].dualWield.enabled, true, `${name}/${phase} explicitly authors Dual Wield`);
    assert.equal(poses[phase].secondaryGrip.enabled, phase !== 'neutral', `${name}/${phase} explicitly authors 2H only on Windup/Strike`);
  }
}
for (const [path, constant] of [['docs/js/combat/combat-combo.js', 'SWEEP_POSE'], ['docs/js/combat/combat-counter-shield.js', 'BLOCK_POSE']]) {
  const source = fs.readFileSync(path, 'utf8');
  const start = source.indexOf(`  const ${constant} = `), end = source.indexOf('\n  };', start) + '\n  };'.length;
  const poses = vm.runInNewContext(source.slice(start, end) + `\n${constant}`);
  assertAuthoredFlags(poses, constant);
}
const heldSource = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');
const heldEnd = heldSource.indexOf('  window.HeldActionAnimations = Object.freeze(');
const heldWindow = {};
vm.runInNewContext(heldSource.slice(0, heldEnd) + '\nwindow.animations = { weaponThrowSpin, weaponThrowSpearSpin, throwFlask, counterShield, drink };\n})();', { window: heldWindow });
for (const name of ['weaponThrowSpin', 'weaponThrowSpearSpin', 'throwFlask', 'counterShield']) assertAuthoredFlags(heldWindow.animations[name].poses, name);
assert.equal(heldWindow.animations.drink.poses.windup.dualWield, undefined, 'drink action is unchanged');
const html = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
const presetStart = html.indexOf('const TOOL_PRESETS = ['), presetEnd = html.indexOf('\n];', presetStart) + '\n];'.length;
const presets = vm.runInNewContext(html.slice(presetStart, presetEnd) + '\nTOOL_PRESETS;', {
  window: {}, defaultPose: () => ({}), neutralPoseFor: () => ({}),
});
const meleePresets = presets.filter(preset => preset.id.endsWith('_swing'));
assert.equal(meleePresets.length, 5);
for (const preset of meleePresets) assertAuthoredFlags(preset, preset.id);
for (const preset of presets.filter(preset => preset.style === 'ranged')) assert.equal(preset.windup.dualWield, undefined, 'ranged preset flags are unchanged');
console.log('Independent hand flags, round-trip data, weapon selection, fishing-mace exclusion, and explicitly authored attack poses PASS');
