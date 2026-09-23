const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('docs/js/npc-held-equipment-v4.js', 'utf8'); // Player-parity civilian held-equipment runtime.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Confirms v4 is the parser-loaded implementation.
const intervals = [];
const rig = { speciesId: 'engh-sho', gender: 'male' };
const avatarNode = { userData: { proceduralHandRig: rig } };
const walker = {
  rec: { id: 'spearhead_unumanuk', name: 'Spearhead Unumanuk' },
  area: 'town', state: 'on-route', avatarGroup: { userData: {} }, avatarHeight: 0.9,
  root: {
    visible: true, parent: null,
    traverse(fn) { fn(this); fn(avatarNode); },
  },
  update() { return 'walker-update'; },
};
let banditInitDeps = null;
const window = {
  setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
  __farmDebugTools: {},
  __hobunjiFurnitureDebug: { getNpcWalkers: () => [walker] },
  BanditCombat: {
    init(deps) { banditInitDeps = deps; return 'bandit-init-result'; },
  },
};
window.window = window;
const context = vm.createContext({ window, console, Math, Object, Set, WeakSet, WeakMap, Number, String, Promise, performance: { now: () => 100 } });
vm.runInContext(source, context, { filename: 'npc-held-equipment-v4.js' });

assert.strictEqual(window.NpcHeldEquipment.version, 4);
assert.deepStrictEqual(Array.from(window.NpcHeldEquipment.liveWalkers()), [walker]);
assert.match(source, /oddclaw_unumanuk:[\s\S]*toolKey: 'hatchet'[\s\S]*mastery: 3[\s\S]*verdigris: \.5/);
assert.match(source, /spearhead_unumanuk:[\s\S]*toolKey: 'fishingspear'[\s\S]*mastery: 5[\s\S]*verdigris: 1/);
assert.match(source, /__hobunjiFurnitureDebug\?\.getNpcWalkers/, 'v4 must discover the actual live game walkers without relying on NpcScheduling init capture');
assert.match(source, /root\?\.traverse[\s\S]*proceduralHandRig/, 'rig lookup must search the walker hierarchy instead of assuming avatarGroup owns the hand rig');
assert.doesNotMatch(source, /Object\.defineProperty\(window, ['"]NpcScheduling['"]/, 'v4 must not compete with other NpcScheduling namespace watchers');

// The player's idle fishing spear reports secondary=no. Civilian idle watchmen must not turn the raw authored span into an always-on left-hand grip.
assert.doesNotMatch(source, /secondaryGripSpanForTool/, 'persistent civilian idle must not consume the raw secondary-grip span directly');
assert.match(source, /claims\.right = owner;[\s\S]*claims\.left = null/, 'watchman idle owns only the primary/right hand');

// Player WeaponToolStances applies pitch/yaw/roll to the holder while WeaponIdleBodyYawRuntime rotates the body separately.
assert.match(source, /function ensureBodyYawWrapper[\s\S]*held_stance_body_yaw/, 'civilian rigs need a dedicated body-yaw presentation wrapper');
assert.match(source, /applyBodyYaw\(state, pose\?\.bodyYaw\)/, 'authored bodyYaw must be applied to the NPC body presentation');
assert.match(source, /function poseQuaternion\(pose, foldBodyYaw = false\)/, 'held-item quaternion must support bodyYaw-separated parity');

// Watchmen should use the exact player/bandit plane factory, preserving material/texture conventions; recolor swaps pixels on a clone of that texture.
assert.match(source, /banditDeps\?\.makeToolPlaneMesh/, 'v4 must capture the shared player\/bandit tool-plane factory');
assert.match(source, /factory\(loadout\.toolKey\)/, 'watchman construction must request the shared shape from that factory');
assert.match(source, /const texture = source\?\.clone\?\.\(\)[\s\S]*texture\.image = canvas/, 'verdigris should replace only the cloned shared texture image');
assert.match(source, /alphaTest: \.08, side: three\.DoubleSide/, 'fallback construction must match the player/editor alpha-cutout convention');
assert.doesNotMatch(source, /applyPrimaryCorrection\(/, 'watchman build must not call the retired inverse-weapon grip correction');
assert.match(source, /applyGripScale\(visual, loadout\.toolKey\)/, 'watchman build must use the current hand-owned primary-grip presentation path');

assert.match(loader, /js\/npc-held-equipment-v4\.js\?v=20260923guardweapons1/);
assert.match(loader, /NpcHeldEquipment\?\.version\) >= 4/);
assert.doesNotMatch(loader, /npc-held-equipment-v3\.js/, 'v3 must no longer be loaded');

const sharedDeps = { makeToolPlaneMesh() {} };
assert.strictEqual(window.BanditCombat.init(sharedDeps), 'bandit-init-result', 'capturing BanditCombat deps must preserve the original init contract');
assert.strictEqual(banditInitDeps, sharedDeps);

const snap = window.NpcHeldEquipment.debugSnapshot('spearhead_unumanuk');
assert.ok(snap, 'initial direct scan must wrap an already-live walker immediately');
assert.strictEqual(snap.version, 4);
assert.strictEqual(snap.toolKey, 'fishingspear');
assert.strictEqual(snap.mastery, 5);
assert.strictEqual(snap.verdigris, 1);
assert.strictEqual(snap.rigReady, true, 'hierarchy traversal must resolve the existing procedural hand rig');
assert.strictEqual(snap.secondaryGripActive, false, 'idle watchman secondary grip must stay off like the player');
assert.strictEqual(snap.sharedPlaneFactoryReady, true, 'BanditCombat init capture must expose the shared tool-plane factory');
assert.strictEqual(typeof window.__farmDebugTools.npcHeldEquipmentSnapshot, 'function');
assert.strictEqual(typeof window.__farmDebugTools.rescanNpcHeldEquipment, 'function');
assert.strictEqual(intervals.length, 1);
assert.strictEqual(intervals[0].ms, 100);

class TestVector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
  clone() { return new TestVector3(this.x, this.y, this.z); }
  add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; }
  applyQuaternion() { return this; }
}
class TestQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  setFromEuler() { return this; }
  copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; this.w = other.w; return this; }
  clone() { return new TestQuaternion(this.x, this.y, this.z, this.w); }
  multiply() { return this; }
  invert() { return this; }
}
class TestEuler { constructor(x = 0, y = 0, z = 0, order = 'XYZ') { this.x = x; this.y = y; this.z = z; this.order = order; } }
class TestGroup {
  constructor() {
    this.children = [];
    this.parent = null;
    this.position = new TestVector3();
    this.quaternion = new TestQuaternion();
    this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = { value: 1, setScalar: value => { this.scale.value = value; } };
    this.userData = {};
    this.visible = true;
    this.name = '';
    this.isObject3D = true;
  }
  add(child) {
    if (!child) return;
    child.parent?.remove?.(child);
    if (!this.children.includes(child)) this.children.push(child);
    child.parent = this;
  }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child?.parent === this) child.parent = null;
  }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse ? child.traverse(fn) : fn(child); }
  updateWorldMatrix() {}
  localToWorld(vector) {
    let node = this;
    while (node) { vector.x += Number(node.position?.x) || 0; vector.y += Number(node.position?.y) || 0; vector.z += Number(node.position?.z) || 0; node = node.parent; }
    return vector;
  }
  worldToLocal(vector) {
    const chain = [];
    let node = this;
    while (node) { chain.push(node); node = node.parent; }
    for (const current of chain) { vector.x -= Number(current.position?.x) || 0; vector.y -= Number(current.position?.y) || 0; vector.z -= Number(current.position?.z) || 0; }
    return vector;
  }
  getWorldQuaternion(target) { return target; }
  getWorldPosition(target) { return this.localToWorld(target.set(0, 0, 0)); }
}

function makeRuntimeWalker(id, name) {
  const runtimeRig = { speciesId: 'engh-sho', gender: 'male' }; // Consumed by npc-held-equipment rig discovery for both watch guards.
  const avatarGroup = new TestGroup(); // Holds the procedural-hand rig exactly where the live walker exposes it.
  avatarGroup.userData.proceduralHandRig = runtimeRig;
  avatarGroup.userData.portraitModelHeight = 0.9;
  avatarGroup.userData.portraitModelWidth = 0.9;
  avatarGroup.userData.handAttachX = -0.45;
  avatarGroup.userData.handAttachY = 0.45;
  const root = new TestGroup(); // Parent scene transform used by the real watchman holder builder.
  root.add(avatarGroup);
  return {
    rec: { id, name, appearance: { speciesId: 'engh-sho', gender: 'male' } },
    area: 'town',
    state: 'on-route',
    avatarGroup,
    avatarHeight: 0.9,
    root,
    update() { return 'runtime-walker-update'; },
  };
}

(async () => {
  const runtimeIntervals = [];
  const runtimeScene = new TestGroup(); // Owns live walker roots and the sibling held-weapon holders built by the runtime.
  const spearhead = makeRuntimeWalker('spearhead_unumanuk', 'Spearhead Unumanuk');
  const oddclaw = makeRuntimeWalker('oddclaw_unumanuk', 'Oddclaw Unumanuk');
  runtimeScene.add(spearhead.root);
  runtimeScene.add(oddclaw.root);
  const runtimeWalkers = [spearhead, oddclaw];

  function makeToolPlaneMesh(toolKey) {
    const plane = new TestGroup(); // Shared player/bandit factory result used to prove the actual watchman build path completes.
    plane.isMesh = true;
    plane.material = { map: { clone() { return { needsUpdate: false, dispose() {} }; } }, dispose() {} };
    const root = new TestGroup();
    root.userData.toolPlane = plane;
    root.userData.itemKey = toolKey;
    root.add(plane);
    return root;
  }

  const runtimeWindow = {
    THREE: { Group: TestGroup, Vector3: TestVector3, Quaternion: TestQuaternion, Euler: TestEuler },
    Combat: { deps: { makeToolPlaneMesh } },
    WeaponToolStances: {
      poses: {
        heavyWeapon: { x: -0.03, y: 0.27, z: 0.02, pitch: -23, yaw: 104, bodyYaw: -15, roll: 89 },
        lightWeapon: { x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 },
      },
    },
    HobunjiHandToolGrips: {
      toolKeyFor: value => String(value || '').toLowerCase(),
      toolScaleForTool: () => 1,
      authoredPrimaryGripForTool: () => ({ position: { x: 0, y: 0, z: 0 }, rotationDeg: { pitch: 0, yaw: 0, roll: 0 } }),
    },
    setInterval(fn, ms) { runtimeIntervals.push({ fn, ms }); return runtimeIntervals.length; },
    __farmDebugTools: {},
    __hobunjiFurnitureDebug: { getNpcWalkers: () => runtimeWalkers },
    BanditCombat: { init(deps) { this.deps = deps; return true; } },
  };
  runtimeWindow.window = runtimeWindow;
  const runtimeContext = vm.createContext({
    window: runtimeWindow,
    console,
    Math,
    Object,
    Set,
    WeakSet,
    WeakMap,
    Number,
    String,
    Promise,
    performance: { now: () => 250 },
  });
  vm.runInContext(source, runtimeContext, { filename: 'npc-held-equipment-v4-runtime.js' });
  await Promise.resolve();
  await Promise.resolve();
  spearhead.update(1 / 60);
  oddclaw.update(1 / 60);
  await Promise.resolve();

  for (const [npcId, toolKey] of [['spearhead_unumanuk', 'fishingspear'], ['oddclaw_unumanuk', 'hatchet']]) {
    const snapshot = runtimeWindow.NpcHeldEquipment.debugSnapshot(npcId);
    assert.equal(snapshot?.mode, 'watchman', `${npcId} must finish the real watchman update path`);
    assert.equal(snapshot?.holderReady, true, `${npcId} must construct a live held-weapon holder`);
    assert.equal(snapshot?.holderVisible, true, `${npcId} held weapon must be visible while the walker root is visible`);
    assert.equal(snapshot?.toolKey, toolKey, `${npcId} must keep the authored guard weapon`);
    assert.equal(snapshot?.visualSource, 'shared-makeToolPlaneMesh', `${npcId} must use the same held-tool mesh factory as player/bandits`);
  }
  const watchmanHolders = runtimeScene.children.filter(child => child.userData?.npcWatchmanWeapon);
  assert.equal(watchmanHolders.length, 2, 'both watch guards must add their weapon holders to the live scene');
  assert.deepEqual(watchmanHolders.map(holder => holder.userData.toolKey).sort(), ['fishingspear', 'hatchet']);

  console.log('npc-held-equipment v4 player-parity + live watchman holder regression: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
