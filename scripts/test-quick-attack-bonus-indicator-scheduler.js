#!/usr/bin/env node
'use strict';

// Regression for the Stage 5 RAF-ownership migration: QuickAttackBonusIndicator
// was the scheduler's sole documented temporary-order-exception (its
// historical RAF had to run before gameLoop, via independent
// requestAnimationFrame registration order). Now that
// scripts/test-runtime-frame-scheduler-ordering.js proves the scheduler's
// pre-game/post-game phase contract, it registers as a 'pre-game' phase
// subscriber instead of owning a private RAF — this is the first real
// dependent of that contract, not just a relabeling.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/quick-attack-bonus-indicator.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'Quick Attack must no longer own a direct requestAnimationFrame( call site');
assert(source.includes("window.RuntimeFrameScheduler.register(SCHEDULER_ID, scheduledFrame"), 'Quick Attack must register its combined readiness/reticle update with the shared scheduler');
assert(source.includes("phase: 'pre-game'"), 'Quick Attack must be on the pre-game phase to keep running before gameLoop');

const offscreenX = new Set(); // Anchor x positions the stub frustum reports as outside the camera view.

function buildContext() {
  const registered = new Map();
  const clock = { now: 1000 }; // Controls hit and animation timestamps for impact lifecycle checks.
  const context = {
    console, Math, Number, String, Object, Array, Set, WeakMap, JSON, URLSearchParams,
    window: null,
    document: {
      createElement() {
        return {
          style: {},
          getContext: () => ({
            clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
          }),
        };
      },
      body: null,
    },
    performance: { now: () => clock.now },
    location: { search: '' },
    THREE: {
      Vector3: class Vector3 { set() { return this; } copy(v) { this.x = v?.x; return this; } applyQuaternion() { return this; } addScaledVector() { return this; } },
      Matrix4: class Matrix4 { multiplyMatrices() { return this; } },
      Frustum: class Frustum { setFromProjectionMatrix() { return this; } intersectsSphere(sphere) { return !offscreenX.has(sphere.center.x); } }, // Test camera: anchors at a listed x are outside the view.
      Sphere: class Sphere { constructor() { this.center = new context.THREE.Vector3(); this.radius = 0; } },
      Sprite: class Sprite {
        constructor(material) {
          this.material = material;
          this.scale = { set(x, y) { this.x = x; this.y = y; } };
          this.position = { copy() {}, lerp() {} };
          this.userData = {};
          this.parent = null;
        }
      },
      SpriteMaterial: class SpriteMaterial { constructor(opts) { Object.assign(this, opts); this.color = { setRGB(...rgb) { this.rgb = rgb; }, setHex(hex) { this.hex = hex; } }; } },
      CanvasTexture: class CanvasTexture {},
      TextureLoader: class TextureLoader { load() {} },
      LinearFilter: 1,
      NormalBlending: 1,
      AdditiveBlending: 2,
      SRGBColorSpace: 1,
    },
  };
  context.window = context;
  context.RuntimeFrameScheduler = {
    register(id, fn, options) { registered.set(id, { fn, options }); },
  };
  context.Combat = {
    loadout: { getSlot: () => 'tap2' },
    quickAttackData: { TECHNIQUES: { tap2: { condKey: 'behind', label: 'Test Quick Attack' } },
      getReachProfile: deps => ({ reachPx: deps.TILE * 6 }) }, // Pure combat-geometry seam: a six-tile forward semicircle.
    getQuickAttackConditions: (deps, target) => {
      context.Combat.quickAttackData.lastConditionCheck = { targetId: target.id }; // The gameplay evaluator's mobile diagnostic.
      return { behind: true };
    },
    deps: {
      currentWeaponKey: () => null,
      camera: null,
    },
  };
  context.WorldPopupText = { avatarCentroidWorld: () => ({ x: 0, y: 1, z: 0 }) };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('docs/js/combat/combat-attack-events.js', 'utf8'), context);
  vm.runInContext(source, context, { filename: 'quick-attack-bonus-indicator.js' });
  return { context, registered, clock };
}

const { context, registered, clock } = buildContext();

const entry = registered.get('quick-attack-bonus-indicator');
assert(entry, 'registers with the scheduler under a stable id');
assert.equal(entry.options.phase, 'pre-game');
assert.equal(entry.options.owner, 'QuickAttackBonusIndicator');

// The scheduled callback still drives the full readiness/reticle pipeline.
const scheduledFrame = entry.fn;
const deps = context.Combat.deps; // Mutated dependency fixture.
const scene = { isScene: true, children: new Set(), add(sprite) { this.children.add(sprite); sprite.parent = this; }, remove(sprite) { this.children.delete(sprite); sprite.parent = null; } }; // Track attached layers through pooling and pop cleanup.
function hostile(id, x, extra = {}) {
  return {
    id, x, y: 0, health: 10, areaId: 'test',
    avatarRef: { group: { id, parent: scene, visible: true, updateWorldMatrix() {} } },
    ...extra,
  };
}
const near = hostile('near', 32);
const forward = hostile('forward', 32 * 3); // Additional candidate within the forward half-moon.
const far = hostile('far', 32 * 40); // Far outside any Quick Attack reach.
const behindPlayer = hostile('behind-player', -32 * 4); // Within radial range but behind the aim direction.
deps.player = { x: 0, y: 0, angle: 0 };
deps.TILE = 32;
deps.getCurrentArea = () => 'test';
deps.getHeldMode = () => 'tool';
deps.getActiveTool = () => 'weapon';
deps.camera = { projectionMatrix: {}, matrixWorldInverse: {}, quaternion: null };
deps.hostileObjects = [far, near, behindPlayer, forward];
let meleeHitCalls = 0;
let avatarProbes = 0; // Counts real world-centroid work to prove the lazy readiness filter skips it.
context.Combat.meleeHit = () => { meleeHitCalls++; return false; }; // Half-moon uses a cheap dot test, never the expensive melee collider.
context.WorldPopupText.avatarCentroidWorld = root => { avatarProbes++; return { x: root.id === 'offscreen' ? 999 : 0, y: 1, z: 0 }; };

assert.doesNotThrow(() => scheduledFrame({ timestamp: 1016 }), 'the scheduled callback runs the readiness/reticle logic');
let snap = context.QuickAttackBonusIndicator.snapshot();
assert.equal(snap.visible, true, 'a met condition shows the reticle when driven by the scheduler');
assert.equal(snap.visibleCount, 2, 'only nearby hostiles in the forward-facing half-moon get a reticle');
assert.deepEqual([...snap.visibleTargetIds], ['near', 'forward'], 'far and rear hostiles are excluded before expensive work');
assert.equal(snap.reachPx, 192, 'snapshot reports the maximum modified lunge + cone reach');
assert.equal(snap.checkedConditions, 2, 'only qualifying nearby targets have their conditions evaluated');
assert.equal(snap.visualProbes, 2, 'only bonus-ready nearby targets have their avatars transformed');
assert.equal(snap.halfMoonCandidates, 2, 'remote and rear targets are excluded in the cheap broadphase');
assert.equal(context.Combat.quickAttackData.lastConditionCheck.targetId, 'near', 'nearest hostile retains diagnostic focus despite nearest-first condition checks');
assert.equal(meleeHitCalls, 0, 'the opportunity cue uses simple spatial culling instead of melee collider tests');

// The half-moon rotates with the player's current facing and never locks onto
// a rear enemy just because its bonus condition is satisfied.
deps.hostileObjects = [near, behindPlayer];
deps.player.angle = Math.PI;
scheduledFrame({ timestamp: 1017 });
assert.deepEqual([...context.QuickAttackBonusIndicator.snapshot().visibleTargetIds], ['behind-player'], 'turning around rotates the half-moon');
deps.player.angle = 0;
deps.getPlayerMeleeAimDirection = () => ({ x: -1, y: 0, z: 0 }); // Camera aim wins over the actor's lagging facing.
scheduledFrame({ timestamp: 1017.5 });
assert.deepEqual([...context.QuickAttackBonusIndicator.snapshot().visibleTargetIds], ['behind-player'], 'camera-authored melee aim determines the half-moon');
deps.getPlayerMeleeAimDirection = () => ({ x: 0, y: 1, z: 0 }); // Vertical aim falls back to the player's horizontal angle.
scheduledFrame({ timestamp: 1017.7 });
assert.deepEqual([...context.QuickAttackBonusIndicator.snapshot().visibleTargetIds], ['near'], 'vertical camera aim uses the player-facing fallback');
delete deps.getPlayerMeleeAimDirection;
deps.hostileObjects = [far, near, behindPlayer, forward];
assert.equal(context.QuickAttackBonusIndicator.getReadyState().target, near, 'diagnostics focus the nearest cued hostile');

// A second script load must not replace the owner of already-attached cues.
const originalIndicator = context.QuickAttackBonusIndicator; // Retain the owner whose sights are currently in the scene.
vm.runInContext(source, context, { filename: 'quick-attack-bonus-indicator-reload.js' });
assert.equal(context.QuickAttackBonusIndicator, originalIndicator, 'repeated loads retain the existing cue owner');
assert.equal(registered.get('quick-attack-bonus-indicator').fn, scheduledFrame, 'repeated loads retain the existing cleanup callback');
near.health = 0;
scheduledFrame({ timestamp: 1018 });
assert.deepEqual([...context.QuickAttackBonusIndicator.snapshot().visibleTargetIds], ['forward'], 'one death removes only that NPC cue and preserves surviving nearby targets');
assert.equal(scene.children.size, 5, 'one death detaches all five of its layers');
for (const target of [near, far, behindPlayer, forward]) target.health = 0;
registered.get('quick-attack-bonus-indicator').fn({ timestamp: 1020 });
assert.equal(context.QuickAttackBonusIndicator.snapshot().visibleCount, 0, 'ordinary deaths clear every readiness cue');
assert.equal(scene.children.size, 0, 'ordinary deaths detach the main sprite and every glow, including after a repeated load');
for (const target of [near, far, behindPlayer, forward]) target.health = 10;
scheduledFrame({ timestamp: 1024 });
assert.equal(scene.children.size, 10, 'pooled nearby cues return with five layers each');
deps.hostileObjects = [far, behindPlayer, forward];
scheduledFrame({ timestamp: 1026 });
assert.equal(scene.children.size, 5, 'removing a living nearby target detaches only its own cue layers');
assert.equal(context.QuickAttackBonusIndicator.snapshot().visibleTargetIds.includes('near'), false, 'removed targets are no longer retained by the indicator');
deps.hostileObjects = [near, far, behindPlayer, forward];
scheduledFrame({ timestamp: 1028 });
assert.equal(scene.children.size, 10, 'returning targets reuse pooled layers without leaving duplicates');
assert.doesNotMatch(fs.readFileSync('docs/js/input-settings-panel.js', 'utf8'), /['"]js\/combat\/quick-attack-bonus-indicator\.js(?:\?[^'"]*)?['"]/, 'Settings must not reload the parser-owned indicator');

// Per-target conditions: only hostiles whose own condition is met are cued.
context.Combat.getQuickAttackConditions = (_, target) => ({ behind: target !== near });
scheduledFrame({ timestamp: 1032 });
snap = context.QuickAttackBonusIndicator.snapshot();
assert.deepEqual([...snap.visibleTargetIds], ['forward'], 'a nearby hostile whose condition ends loses only its own reticle');
context.Combat.getQuickAttackConditions = () => ({ behind: true });

// Field of view: an anchor outside the camera frustum is not cued.
const offscreen = hostile('offscreen', 64);
offscreen.avatarRef.group.id = 'offscreen';
offscreenX.add(999);
deps.hostileObjects = [near, offscreen];
scheduledFrame({ timestamp: 1048 });
assert.deepEqual([...context.QuickAttackBonusIndicator.snapshot().visibleTargetIds], ['near'], 'hostiles outside the camera view get no reticle');

// Elevation: only hostiles at the player's terrain level are cued; a ledge above or a shelf below is not.
const ledge = hostile('ledge', 96);
ledge.avatarRef.group.id = 'ledge';
const rampFoot = hostile('ramp-foot', 128);
rampFoot.avatarRef.group.id = 'ramp-foot';
let playerSurfaceChecks = 0; // Detects repeated player-height sampling per candidate.
deps.worldSurfaceY = (x) => { if (x === 0) playerSurfaceChecks++; return x === 96 ? 2.5 : (x === 128 ? 0.6 : 0); }; // One plateau tier up for the ledge; a gentle ramp rise for the other.
deps.hostileObjects = [near, ledge, rampFoot];
scheduledFrame({ timestamp: 1052 });
assert.deepEqual([...context.QuickAttackBonusIndicator.snapshot().visibleTargetIds], ['near', 'ramp-foot'], 'a hostile a full tier above gets no reticle, but one on the same slope still does');
assert.equal(playerSurfaceChecks, 1, 'the player elevation is sampled only once for all ready candidates');
delete deps.worldSurfaceY;
deps.hostileObjects = [near];

// Hidden avatars (or hidden ancestors) are not in view.
near.avatarRef.group.visible = false;
scheduledFrame({ timestamp: 1064 });
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, false, 'a hidden avatar shows no reticle');
near.avatarRef.group.visible = true;
deps.hostileObjects = [near];

for (const flag of ['_denHidden', '_grehlrBurrowProtected', 'isCompanion']) {
  near[flag] = true;
  assert.equal(context.QuickAttackBonusIndicator.getReadyState().ready, false, flag + ' targets are ineligible');
  delete near[flag];
}
near.areaId = 'elsewhere';
assert.equal(context.QuickAttackBonusIndicator.getReadyState().ready, false, 'unloaded-area targets cannot show an opening');
near.areaId = 'test';
near.health = 0;
assert.equal(context.QuickAttackBonusIndicator.getReadyState().ready, false, 'dead targets cannot show an opening');
near.health = 10;

// Many cued hostiles: enlarged modified reach still caps active sprites and
// condition tests at twelve, even with twenty hostiles in the forward semicircle.
context.Combat.quickAttackData.getReachProfile = deps => ({ reachPx: deps.TILE * 30 });
deps.hostileObjects = Array.from({ length: 20 }, (_, i) => hostile('crowd' + i, 32 * (i + 1)));
scheduledFrame({ timestamp: 1080 });
snap = context.QuickAttackBonusIndicator.snapshot();
assert.equal(snap.visibleCount, 12, 'reticles are capped');
assert.equal(snap.checkedConditions, 12, 'the ready-target cap also bounds expensive condition evaluations');
assert.equal(snap.visualProbes, 12, 'crowds stop world-matrix work after finding twelve eligible cues');
assert.equal(snap.halfMoonCandidates, 20, 'all nearby candidates remain eligible for nearest-first selection');
assert.ok(snap.visibleTargetIds.includes('crowd0') && !snap.visibleTargetIds.includes('crowd19'), 'the cap keeps the nearest hostiles');
// Even when twelve sights are active, affliction effects must resolve once,
// not once per sight. The production reach profile already returns these effects,
// so its normal path needs no extra progression query at all.
let extraProgressionLookups = 0; // Detects redundant per-sight CombatProgression scans.
context.CombatProgression = { getEffects: () => { extraProgressionLookups++; return { quickBonusAfflictions: { bleeding: 1 } }; } };
deps.currentWeaponKey = () => 'instrumented-weapon';
scheduledFrame({ timestamp: 1081 });
assert.equal(extraProgressionLookups, 1, 'affliction glow shares one effect lookup across twelve reticles');
context.Combat.quickAttackData.getReachProfile = deps => ({ reachPx: deps.TILE * 6, effects: { quickBonusAfflictions: { bleeding: 1 } } });
scheduledFrame({ timestamp: 1135 }); // Beyond the 50ms cache expiry, to simulate the production reach profile.
assert.equal(extraProgressionLookups, 1, 'the live reach profile shares its mastery snapshot with the glow renderer');
context.Combat.quickAttackData.getReachProfile = deps => ({ reachPx: deps.TILE * 6 }); // Restore a fresh progression lookup for the later multi-affliction impact test.
delete context.CombatProgression;
deps.currentWeaponKey = () => null;
deps.hostileObjects = [near];

const neighbour = hostile('neighbour', 64);
deps.hostileObjects = [near, neighbour];
context.Combat.quickAttackData.bonusEffectCooldownRemaining = target => (target === near ? 2 : 0);
scheduledFrame({ timestamp: 1090 });
assert.deepEqual([...context.QuickAttackBonusIndicator.snapshot().visibleTargetIds], ['neighbour'], 'an enemy cooling down hides only its own reticle');
deps.hostileObjects = [near];
context.Combat.quickAttackData.bonusEffectCooldownRemaining = () => 2;
assert.equal(context.QuickAttackBonusIndicator.getReadyState().conditionReady, true, 'condition remains visible in diagnostics during cooldown');
scheduledFrame({ timestamp: 1096 });
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, false, 'cooldown suppresses the visible bonus notification');
assert.equal(context.QuickAttackBonusIndicator.snapshot().visualProbes, 0, 'cooling targets never trigger costly avatar-centroid probes');
context.Combat.quickAttackData.bonusEffectCooldownRemaining = () => 0;
scheduledFrame({ timestamp: 1112 });
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, true, 'cue returns when cooldown expires');
context.Combat.getQuickAttackConditions = () => ({ behind: false });
const probesBeforeMiss = avatarProbes; // Used to verify an in-range target without a bonus does not update its matrix.
scheduledFrame({ timestamp: 1128 });
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, false, 'condition ending immediately hides every reticle layer');
assert.equal(context.QuickAttackBonusIndicator.snapshot().visualProbes, 0, 'non-qualifying targets skip world-matrix/frustum work');
assert.equal(avatarProbes, probesBeforeMiss, 'non-qualifying targets never call avatarCentroidWorld');
context.Combat.getQuickAttackConditions = () => ({ behind: true });
for (const tool of ['ranged', 'pick']) {
  deps.getActiveTool = () => tool;
  assert.equal(context.QuickAttackBonusIndicator.getReadyState().ready, false, 'cue is hidden with ' + tool + ' drawn');
}
deps.getActiveTool = () => 'weapon';
deps.isDialogueOpen = () => true;
assert.equal(context.QuickAttackBonusIndicator.getReadyState().ready, false, 'dialogue suppresses combat opportunities');
deps.isDialogueOpen = () => false;
scheduledFrame({ timestamp: 1144 });
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, true, 'cue recovers after suppression ends');

// Use the real event bus: only an authoritative bonus proc can pop a cue.
context.ResourceRings = { AFFLICTION_COLORS: { bleeding: 0xe02030, venom: 0x40cc20 } }; // Matches the runtime's packed-hex palette.
context.CombatProgression = { getEffects: () => ({ quickBonusAfflictions: { bleeding: 1, venom: 1 } }) };
deps.currentWeaponKey = () => 'test-weapon';
clock.now = 2000;
scheduledFrame({ timestamp: clock.now });
const glowLayers = [...scene.children].filter(sprite => sprite.name.includes('_glow_')); // Inspect actual material colors and animation rather than source text.
assert.equal(glowLayers[0].material.color.hex, 0xe02030, 'first readiness glow uses the canonical affliction color');
assert.equal(glowLayers[1].material.color.hex, 0x40cc20, 'second readiness glow uses the next applied affliction color');
assert.ok(glowLayers[0].material.opacity > 0.5, 'readiness glow is visibly brighter');
const event = { attackCategory: 'quickAttack', target: near, quickConditionalBonus: true, quickBonusEffectProc: false, afflictionBonuses: { venom: 1 } }; // A condition alone is insufficient during cooldown.
context.CombatAttackEvents.hit(event);
assert.equal(context.QuickAttackBonusIndicator.snapshot().poppingTargetIds.length, 0, 'condition without a proc never bursts');
context.CombatAttackEvents.hit({ ...event, attackCategory: 'combo', quickBonusEffectProc: true });
assert.equal(context.QuickAttackBonusIndicator.snapshot().poppingTargetIds.length, 0, 'other attack categories never burst');
context.CombatAttackEvents.hit({ ...event, quickBonusEffectProc: true });
assert.deepEqual([...context.QuickAttackBonusIndicator.snapshot().poppingTargetIds], ['near'], 'confirmed quick bonus starts its impact');
assert.equal(glowLayers[0].material.color.hex, 0x40cc20, 'impact layers use the actual hit afflictions');
assert.equal(glowLayers[0].material.opacity, 1, 'impact flashes brightly on the hit frame');
const initialPopSize = glowLayers[0].scale.x; // Later frames must expand beyond the initial inward snap.
near.health = 0;
context.Combat.quickAttackData.bonusEffectCooldownRemaining = () => 2;
clock.now += 120;
scheduledFrame({ timestamp: clock.now });
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, true, 'killing blow and cooldown preserve the burst');
assert.ok(glowLayers[0].scale.x > initialPopSize * 2, 'impact expands dramatically');
assert.ok(glowLayers[0].material.opacity < 1, 'impact fades as it expands');
vm.runInContext(source, context, { filename: 'quick-attack-bonus-indicator-impact-reload.js' });
assert.equal(context.QuickAttackBonusIndicator, originalIndicator, 'reloading during a killing-blow burst retains its cleanup owner');
assert.equal(registered.get('quick-attack-bonus-indicator').fn, scheduledFrame, 'reloading during a burst cannot replace its animation callback');
assert.equal(scene.children.size, 5, 'a killing-blow burst retains only its original five layers');
clock.now += 400;
scheduledFrame({ timestamp: clock.now });
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, false, 'expired burst releases all layers');
assert.equal(scene.children.size, 0, 'expired layers detach from the scene');
near.health = 10;
context.Combat.quickAttackData.bonusEffectCooldownRemaining = () => 0;
scheduledFrame({ timestamp: ++clock.now });
assert.equal(context.QuickAttackBonusIndicator.snapshot().poppingTargetIds.length, 0, 'pooled sights reset impact state');
context.CombatAttackEvents.hit({ ...event, quickBonusEffectProc: true });
deps.isDialogueOpen = () => true;
scheduledFrame({ timestamp: ++clock.now });
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, false, 'dialogue immediately suppresses an active impact');
deps.isDialogueOpen = () => false;

// A throwing readiness/render pass must still detach the reticle and record
// its own error snapshot, exactly like the old try/catch inside frame().
context.Combat.getQuickAttackConditions = () => { throw new Error('boom'); };
scheduledFrame({ timestamp: 1032 });
assert.equal(context.QuickAttackBonusIndicator.snapshot().lastFrameError, 'boom', 'a thrown readiness error is captured for the mobile debug snapshot');
assert.equal(context.QuickAttackBonusIndicator.snapshot().visible, false, 'the reticle is detached rather than left frozen after an error');

console.log('quick attack bonus indicator pre-game scheduler migration passed');
