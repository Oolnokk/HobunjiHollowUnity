#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/ranged-camera-focus.js', 'utf8');
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');

assert.match(loader, /ranged-camera-focus\.js\?v=20260906f[\s\S]*HobunjiRangedCameraFocus\?\.version\) >= 6/, 'loader requires change-driven shared-target v6');
assert.doesNotMatch(loader, /attack-camera-player-root/, 'obsolete player-root camera hook stays removed');
assert.match(source, /change-driven-persistent-cache/, 'combat aim advertises persistent change-driven caching');
assert.match(source, /intersectObject\(root, true, localHits\)/, 'scene roots remain isolated so one bad root cannot abort the frame');
assert.match(source, /invalidateAimTarget/, 'aim cache has explicit event-driven invalidation');
assert.doesNotMatch(source, /SURFACE_RAY_CACHE_MS/, 'time-based per-frame surface-cache expiry is gone');
assert.match(source, /Deliberately do not resolve\/raycast the combat target here/, 'per-frame focus update explicitly does not resolve the 3D target');
assert.match(source, /interactionTargetMeleeHit/, 'actual player melee collision receives shared interaction-target direction');
assert.doesNotMatch(source, /PerspectiveCamera/, 'combat aim never hooks the camera class');
assert.doesNotMatch(source, /prototype\.lookAt/, 'combat aim never replaces camera lookAt');
assert.doesNotMatch(source, /this\.position\.set/, 'combat aim never writes camera position');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() {
    const length = Math.sqrt(this.lengthSq()) || 1;
    this.x /= length; this.y /= length; this.z /= length;
    return this;
  }
}

function isDescendant(object, root) {
  let node = object;
  while (node) {
    if (node === root) return true;
    node = node.parent || null;
  }
  return false;
}

let rootRaycasts = 0;
let sceneHits = [];
class Raycaster {
  constructor() { this.ray = { origin: new Vector3(), direction: new Vector3() }; this.near = 0; this.far = Infinity; }
  set(origin, direction) { this.ray.origin = origin.clone(); this.ray.direction = direction.clone(); return this; }
  intersectObject(root, recursive, target = []) {
    rootRaycasts++;
    if (root?.throwRaycast) throw new Error('synthetic malformed raycast root');
    for (const hit of sceneHits) {
      if ((hit.object === root || (recursive && isDescendant(hit.object, root))) && hit.distance >= this.near && hit.distance <= this.far) target.push(hit);
    }
    return target;
  }
}

let now = 1000;
let heldMode = 'tool';
let activeTool = 'ranged';
let equipped = 'crossbow';
let loaded = true;
let thrownCharge = null;
let sliderValue = 0.60;
let sliderDispatches = 0;
let injectedRangedDeps = null;
let lastRangedVisual = null;
let lastMeleeHitOptions = null;
let interactionOrigin = { x: 0, y: 1, z: 3 };
let interactionDirection = { x: 1, y: 0, z: 0 };
const player = { x: 128, y: 192, angle: 0 };
const targetActor = { x: 400, y: 192, id: 'dummy' };

const avatarRoot = { name: 'player-avatar', parent: null, visible: true, userData: { handAttachY: 0.45 } };
const playerMesh = { isMesh: true, name: 'player-body', parent: avatarRoot, visible: true, material: { visible: true, opacity: 1 } };
const debugMesh = { isMesh: true, name: 'debug-helper-plane', parent: null, visible: true, material: { visible: true, opacity: 1 } };
const badRoot = { name: 'broken-root', parent: null, visible: true, throwRaycast: true };
const wallMesh = { isMesh: true, name: 'farm-wall', parent: null, visible: true, material: { visible: true, opacity: 1 } };
const scene = { children: [debugMesh, avatarRoot, badRoot, wallMesh] };
sceneHits = [
  { object: debugMesh, distance: 4, point: new Vector3(4, 2.4, 3) },
  { object: playerMesh, distance: 5, point: new Vector3(5, 2.7, 3) },
  { object: wallMesh, distance: 6, point: new Vector3(6, 3, 3) },
];

const sliderListeners = new Map();
const slider = {
  get value() { return String(sliderValue); },
  set value(value) { sliderValue = Number(value); },
  addEventListener(type, fn) { sliderListeners.set(type, fn); },
  dispatchEvent(event) {
    sliderDispatches++;
    sliderListeners.get(event.type)?.(event);
    return true;
  },
};

const windowListeners = new Map();
function addWindowListener(type, fn) {
  if (!windowListeners.has(type)) windowListeners.set(type, []);
  windowListeners.get(type).push(fn);
}
function dispatchWindow(type, detail = null) {
  for (const fn of windowListeners.get(type) || []) fn({ type, detail });
}

const storage = new Map();
const logs = [];
let combatDeps = null;
const Combat = {
  deps: null,
  loadout: { getSlot: () => 'swingCombo' },
  comboData: {
    swingCombo: [{ rangeMul: 1 }, { rangeMul: 1.05 }, { rangeMul: 1.15 }],
    RANGE_SCALE: 0.6,
  },
  init(deps) { this.deps = deps; combatDeps = deps; return true; },
  meleeHit(attacker, target, options) { lastMeleeHitOptions = options; return true; },
};

const windowStub = {
  THREE: { Vector3, Raycaster },
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  addEventListener: addWindowListener,
  SCRATCHBONES_CONFIG: { game: { camera: { modes: { shoulderSurf: { distanceTiles: 2.6 } } } } },
  GridTileAccessors: { getActiveScene: () => scene },
  Combat,
  CombatProgression: { getEffects: () => ({ stats: {} }) },
  RangedWeapons: {
    config: {
      crossbow: { rangedType: 'crossbow', rangeTiles: 9 },
      scatterbow: { rangedType: 'scatterbow', rangeTiles: 6.5 },
      blowgun: { rangedType: 'blowgun', rangeTiles: 8 },
      kylie: { rangedType: 'thrown', rangeTiles: 7 },
    },
    init(deps) { injectedRangedDeps = deps; },
    equippedRangedKey: () => equipped,
    isLoaded: () => loaded,
    playerIdlePose: () => ({ x: 0.23, y: 0.08, z: 0.14, pitch: 16, yaw: 65, bodyYaw: -52, roll: 11, scale: 1.77 }),
    actorHitbox: actor => ({ center: actor === player ? new Vector3(player.x / 64, 0.5, player.y / 64) : new Vector3(6, 0.5, 3) }),
    update() {},
  },
  HobunjiRangedWeaponArchetypes: {
    debugSnapshot: () => ({ thrownCharge }),
    activeThrownChargeItemKey: () => thrownCharge?.itemKey || null,
  },
  __farmLog: message => logs.push(message),
};

const context = {
  window: windowStub,
  document: {
    readyState: 'complete',
    getElementById: id => id === 'settingShoulderSurfOffsetH' ? slider : null,
    addEventListener() {},
    createElement: undefined,
  },
  Event: class Event { constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); } },
  Math,
  Date,
  performance: { now: () => now },
  console,
};
vm.runInNewContext(source, context, { filename: 'ranged-camera-focus.js' });

const deps = {
  TILE: 64,
  player,
  getHeldMode: () => heldMode,
  getActiveTool: () => activeTool,
  getActorWorldY: () => 0,
  worldSurfaceY: () => 0,
  getActiveScene: () => scene,
  getPlayerInteractionRay: () => ({ origin: interactionOrigin, direction: interactionDirection }),
  getPlayerAimRay: () => ({ origin: interactionOrigin, direction: interactionDirection }),
  getPlayerAimPitch: () => 0,
  getPlayerMeleeAimDirection: () => ({ x: 0, y: 0, z: 1 }),
  getPlayerMeleeAimPitch: () => 0,
  currentWeaponKey: () => 'hatchet',
  currentComboAbilityId: () => 'swingCombo',
  weaponAbility: () => ({ rangePx: 64 * 1.05 }),
  toolHolder: () => null,
  triggerWeaponSwingVisual() {},
  triggerWeaponHoldVisual() {},
  beginCombatLunge() {},
};

// Combat.init is the event boundary for the melee wrappers; no per-frame retry is needed.
windowStub.Combat.init(deps);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().combatInitBridgeInstalled, true, 'Combat.init bridge is installed before game setup');

windowStub.RangedWeapons.init({
  ...deps,
  getPlayerAvatarGroup: () => avatarRoot,
  getEquippedRangedKey: () => equipped,
  triggerRangedWeaponVisual: (durationS, options) => { lastRangedVisual = { durationS, options }; },
});
assert(injectedRangedDeps, 'wrapped ranged init still reaches the original initializer');

// First resolution performs one scene scan and still isolates malformed roots.
let rangedTarget = windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(rangedTarget.source, 'interaction-first-surface');
assert.equal(rangedTarget.surfaceName, 'farm-wall');
assert.equal(rangedTarget.point.x, 6);
assert(logs.some(line => line.includes('[combat-aim] surface-ray-root skipped broken-root')), 'bad root is reported without escaping into game loop');
let perf = windowStub.HobunjiRangedCameraFocus.aimPerformance();
assert.equal(perf.surfaceRaycasts, 1, 'first target performs one expensive scene scan');
assert.equal(perf.targetResolves, 1, 'first target is resolved once');
const rootCallsAfterFirstResolve = rootRaycasts;

// Repeated requests and hundreds of ordinary update frames must not reraycast a stationary aim.
for (let i = 0; i < 20; i++) windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
for (let i = 0; i < 240; i++) {
  now += 1000 / 60;
  windowStub.RangedWeapons.update(1 / 60);
}
assert.equal(rootRaycasts, rootCallsAfterFirstResolve, 'stationary aim performs zero additional scene-root raycasts across 240 update frames');
perf = windowStub.HobunjiRangedCameraFocus.aimPerformance();
assert.equal(perf.surfaceRaycasts, 1, 'surface raycast count stays flat while inputs are unchanged');
assert(perf.targetCacheHits >= 20, 'repeated target consumers are served from persistent target cache');
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().aimUpdateMode, 'change-driven-persistent-cache');

// Tiny camera jitter under the authored quantum stays cached.
interactionDirection = { x: 1, y: 0.0003, z: 0 };
windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts, 1, 'sub-threshold camera jitter does not reraycast');

// Material camera movement invalidates the ray signature and performs exactly one fresh scan.
interactionDirection = { x: 0.98, y: 0.20, z: 0 };
windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts, 2, 'material camera aim change refreshes the scene ray once');
const scansAfterCameraMove = windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts;
windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts, scansAfterCameraMove, 'new camera aim remains cached after refresh');

// Player movement rebuilds convergence from the new muzzle without rescanning unchanged scene/ray geometry.
interactionDirection = { x: 1, y: 0, z: 0 };
windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
const scansBeforePlayerMove = windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts;
const resolvesBeforePlayerMove = windowStub.HobunjiRangedCameraFocus.aimPerformance().targetResolves;
player.x += 2; // 2 px = 0.03125 world tiles, above the 0.02 material-motion threshold.
windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
perf = windowStub.HobunjiRangedCameraFocus.aimPerformance();
assert.equal(perf.surfaceRaycasts, scansBeforePlayerMove, 'player movement reuses unchanged camera-ray surface hits');
assert.equal(perf.targetResolves, resolvesBeforePlayerMove + 1, 'player movement rebuilds only muzzle-to-target convergence');

// A scene-root change invalidates surface geometry naturally without a timer.
const extraRoot = { name: 'new-world-root', parent: null, visible: true };
scene.children.push(extraRoot);
windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts, scansBeforePlayerMove + 1, 'scene root-count change performs one new scene scan');

// Explicit world mutation invalidation is also event-driven and forces one surface refresh.
const scansBeforeWorldEvent = windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts;
dispatchWindow('hobunji-world-object-change');
windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts, scansBeforeWorldEvent + 1, 'world-object event forces one fresh surface scan');
assert.equal(windowStub.HobunjiRangedCameraFocus.aimPerformance().lastInvalidation, 'hobunji-world-object-change');

// The ranged ray still converges from the actual projectile origin onto the shared point.
const sharedRay = injectedRangedDeps.getPlayerAimRay();
assert(Math.abs(sharedRay.origin.x - player.x / 64) < 1e-9, 'ranged ray starts at the moved projectile/player origin');
assert(sharedRay.direction.x > 0.7, 'ranged shot still points toward the shared 3D surface point');

function settle(frames = 120) {
  for (let i = 0; i < frames; i++) {
    now += 1000 / 60;
    windowStub.RangedWeapons.update(1 / 60);
  }
}

// Ready zoom remains, but once settled it stops generating synthetic slider writes.
sliderValue = 0.60;
windowStub.RangedWeapons.update(1 / 60);
windowStub.RangedWeapons.update(1 / 60);
assert(windowStub.SCRATCHBONES_CONFIG.game.camera.modes.shoulderSurf.distanceTiles < 2.6, 'loaded crossbow still eases native camera distance inward');
assert(sliderValue < 0.60, 'loaded crossbow still eases toward its independent shoulder offset');
settle(120);
const dispatchesAtSettledFocus = sliderDispatches;
const scansAtSettledFocus = windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts;
settle(240);
assert.equal(sliderDispatches, dispatchesAtSettledFocus, 'settled focus emits zero continuing synthetic slider input events');
assert.equal(windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts, scansAtSettledFocus, 'settled focus emits zero continuing scene raycasts');

windowStub.HobunjiRangedCameraFocus.setFocusHorizontalOffset(-0.35);
assert.equal(storage.get('hobunjiRangedFocusShoulderOffsetH'), '-0.35', 'separate focus shoulder offset still persists independently');

// Loaded crossbow/scatterbow portrait orbit still consumes the shared cached target.
const scansBeforePose = windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts;
const pitchedPose = windowStub.RangedWeapons.playerIdlePose('crossbow');
assert.notEqual(pitchedPose.pitch, 16, 'crossbow stance still responds to shared 3D vertical aim');
assert.equal(windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts, scansBeforePose, 'crossbow pose reuses current shared target when aim inputs are unchanged');
injectedRangedDeps.triggerRangedWeaponVisual(1, {
  pose: {
    neutral: { y: 0.08, z: 0.14, pitch: 16 },
    windup: { y: 0.14, z: 0.11, pitch: -9 },
    strike: { y: 0.11, z: 0.12, pitch: -9 },
  },
});
assert(lastRangedVisual?.options?.pose, 'loaded crossbow firing pose still receives the aim-aware transform');

// Melee range changes invalidate only target convergence; unchanged camera ray keeps the surface scan cached.
activeTool = 'weapon';
interactionDirection = { x: 1, y: 0, z: 0 };
windowStub.HobunjiRangedCameraFocus.invalidateAimTarget('test-melee-reset', true);
let meleeTarget = windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(meleeTarget.mode, 'melee');
assert.equal(meleeTarget.source, 'interaction-range-fallback', 'idle short combo cannot select wall outside reach');
const scansBeforeWindup = windowStub.HobunjiRangedCameraFocus.aimPerformance().surfaceRaycasts;
const resolvesBeforeWindup = windowStub.HobunjiRangedCameraFocus.aimPerformance().targetResolves;
combatDeps.triggerWeaponSwingVisual(0.5, { coneRangePx: 64 * 4.5, coneAngle: player.angle });
meleeTarget = windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
perf = windowStub.HobunjiRangedCameraFocus.aimPerformance();
assert.equal(meleeTarget.source, 'interaction-first-surface', 'windup immediately switches to its real attack reach');
assert.equal(perf.surfaceRaycasts, scansBeforeWindup, 'attack-range change does not rescan unchanged scene/ray');
assert.equal(perf.targetResolves, resolvesBeforeWindup + 1, 'attack-range change rebuilds target convergence once');
windowStub.Combat.meleeHit(player, targetActor, { rangePx: 64 * 4.5, halfConeRad: 0.4, yaw: Math.PI / 2, pitch: 0 });
assert(lastMeleeHitOptions.direction.x > 0.7, 'actual melee collision still receives shared 3D target direction');

// Other ranged archetypes retain readiness behavior.
activeTool = 'ranged';
for (const itemKey of ['scatterbow', 'blowgun']) {
  equipped = itemKey;
  loaded = true;
  windowStub.RangedWeapons.update(1 / 60);
  const state = windowStub.HobunjiRangedCameraFocus.snapshot();
  assert.equal(state.active, true, `${itemKey} focuses while loaded`);
  assert.equal(state.reason, 'loaded', `${itemKey} reports loaded focus reason`);
}

equipped = 'crossbow';
loaded = false;
settle();
assert(Math.abs(windowStub.SCRATCHBONES_CONFIG.game.camera.modes.shoulderSurf.distanceTiles - 2.6) < 0.01, 'camera distance restores after shot');
assert(Math.abs(sliderValue - 0.60) < 0.01, 'ordinary Combat horizontal offset restores after shot');

equipped = 'kylie';
thrownCharge = { itemKey: 'kylie', startedAt: 10 };
windowStub.RangedWeapons.update(1 / 60);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().reason, 'thrown-windup');
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, true);
thrownCharge = null;
windowStub.RangedWeapons.update(1 / 60);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, false, 'releasing thrown weapon ends tight focus');

activeTool = 'weapon';
equipped = 'crossbow';
loaded = true;
windowStub.RangedWeapons.update(1 / 60);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, false, 'loaded ranged slot does not focus while melee is out');

assert(logs.some(line => line.includes('focus ON')), 'focus transitions remain visible in in-game log');
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.tightDistanceTiles, 1.55);
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.defaultFocusHorizontalOffsetTiles, 0.18);
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.crossbowVerticalPitchLimitDeg, 70);
console.log('Change-driven shared interaction-target combat checks passed.');
