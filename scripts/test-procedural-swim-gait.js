const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/procedural-swim-gait.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const weaponIdle = fs.readFileSync('docs/js/weapon-idle-body-yaw-runtime.js', 'utf8');
const panelUi = fs.readFileSync('docs/js/panel-ui.js', 'utf8');
const combatLoader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
const editorHtml = fs.readFileSync('docs/tools/procedural-animation-editor/index.html', 'utf8');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); this.isVector3 = true; }
  set(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
  add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; }
  distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
  lerp(other, t) {
    this.x += (other.x - this.x) * t;
    this.y += (other.y - this.y) * t;
    this.z += (other.z - this.z) * t;
    return this;
  }
}
class CopyTarget { copy(value) { this.value = value; return this; } }

function foot(x) {
  return {
    position: new Vector3(x, 0, 0),
    quaternion: new CopyTarget(),
    getWorldPosition(out) { return out.copy(this.position); },
  };
}

function legRoot() {
  const parts = {
    left_hip: { position: new Vector3(-0.1, 0.3, 0) },
    left_thigh: { position: new Vector3(), quaternion: new CopyTarget(), children: [] },
    left_calf: { position: new Vector3(), quaternion: new CopyTarget(), children: [] },
    left_foot: foot(-0.1),
    right_hip: { position: new Vector3(0.1, 0.3, 0) },
    right_thigh: { position: new Vector3(), quaternion: new CopyTarget(), children: [] },
    right_calf: { position: new Vector3(), quaternion: new CopyTarget(), children: [] },
    right_foot: foot(0.1),
  };
  return {
    position: new Vector3(),
    rotation: { y: 0 },
    quaternion: {},
    updateMatrixWorld() {},
    worldToLocal(vector) { return vector; },
    getObjectByName(name) { return parts[name] || null; },
  };
}

let authoritativeSwimming = true;
let fallbackSwimming = false;
let lastSuppressed = null;
let solveCount = 0;
const player = { x: 100, y: 100, prone: false };

const ProceduralLegAnimation = {
  attach() {
    const group = legRoot();
    return {
      group,
      update(_dt, _speed, suppressed) {
        lastSuppressed = !!suppressed;
        group.rotation.y = 0.73; // Mirrors game.js's ordinary ground-facing counter-rotation before Swim gets a chance to own the whole rig.
      },
    };
  },
};

const THREE = { Vector3 };
const window = {
  THREE,
  ProceduralLegAnimation,
  Combat: {
    deps: {
      player,
      TILE: 48,
      isPlayerSwimming: () => authoritativeSwimming,
    },
  },
  HobunjiAnimalSubtleElevation: { isInSwimWater: () => fallbackSwimming },
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { referenceSpeedWorldUnitsPerSecond: 4.3 } } } } },
  LegBones: {
    solveTwoBoneLeg(_three, { hip, foot: target }) {
      solveCount += 1;
      const full = hip.distanceTo(target);
      return {
        thighQuaternion: {},
        thighLength: full * 0.5,
        calfLocalQuaternion: {},
        calfLength: full * 0.5,
      };
    },
  },
};

vm.runInNewContext(source, { window, console, Math, Number, Object, Array, Set }, { filename: 'procedural-swim-gait.js' });
const api = window.HobunjiProceduralSwimGait;
assert.ok(api, 'shared procedural swim API installs');
assert.equal(api.version, 1);

const nearly = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} vs ${expected}`);

nearly(api.facingYawFromMovement(1, 0), Math.PI / 2, 'east movement matches game player-facing yaw');
nearly(api.facingYawFromMovement(0, 1), 0, 'map +Y movement matches game player-facing yaw');
nearly(api.facingYawFromMovement(-1, 0), -Math.PI / 2, 'west movement matches game player-facing yaw');
assert.equal(api.facingYawFromMovement(0, 0), null, 'zero movement preserves the prior swim heading');

const leftKick = api.sampleKick(0.25, 1);
const rightKick = api.sampleKick(0.75, 1);
assert.ok(leftKick.travelRatio > 0 && rightKick.travelRatio < 0, 'legs alternate their kick travel by half a cycle');
nearly(Math.abs(leftKick.travelRatio), Math.abs(rightKick.travelRatio), 'alternating kick reach is symmetric');

const playerLegs = window.ProceduralLegAnimation.attach(THREE, {}, { name: 'player' });
player.x += 8;
playerLegs.update(0.016, 2.5, false, undefined);
let debug = api.getDebug();
assert.equal(lastSuppressed, true, 'active swimming suppresses the ordinary ground-contact gait');
assert.equal(debug.runtime.swimming, true, 'authoritative gameplay swim state activates the swim gait');
assert.equal(debug.runtime.moving, true, 'resolved player movement records a swim direction');
assert.equal(debug.runtime.hasDirection, true, 'moving swimmer has a current direction');
nearly(debug.runtime.desiredYaw, Math.PI / 2, 'runtime direction uses the same shared facing helper as game.js');
assert.ok(debug.runtime.strength > 0, 'moving swimmer drives kick strength');
assert.equal(playerLegs.group.rotation.y, 0, 'swim cancels the normal leg-root counter-rotation so torso and legs share one facing');
assert.equal(solveCount, 2, 'one moving swim update solves both kicking legs');

authoritativeSwimming = false;
const solvesBeforeExit = solveCount;
playerLegs.update(0.016, 2.5, false, undefined);
debug = api.getDebug();
assert.equal(lastSuppressed, false, 'ordinary ground gait resumes immediately after leaving water');
assert.equal(debug.runtime.swimming, false);
assert.equal(debug.runtime.strength, 0);
assert.equal(debug.runtime.blend, 0, 'swim ownership ends immediately instead of blending over the restored ground pose');
assert.equal(solveCount, solvesBeforeExit, 'water exit does not re-solve the restored ground gait with swim bend');
nearly(playerLegs.group.rotation.y, 0.73, 'ground locomotion regains its own leg-root counter-rotation unchanged');

authoritativeSwimming = true;
player.x += 8;
const solvesBeforeSuppressed = solveCount;
playerLegs.update(0.016, 2.5, true, undefined);
debug = api.getDebug();
assert.equal(debug.runtime.swimming, false, 'mount/whole-body locomotion suppression wins over swim');
assert.equal(debug.runtime.strength, 0);
assert.equal(solveCount, solvesBeforeSuppressed, 'suppressed whole-body animation is not overwritten by swim IK');

fallbackSwimming = false;
assert.equal(api.isInSwimWater(player), true, 'runtime water query prefers Combat.deps.isPlayerSwimming over the fallback tile bridge');

player.x = 500;
player.y = 700;
const rebuiltLegs = window.ProceduralLegAnimation.attach(THREE, {}, { name: 'player' });
rebuiltLegs.update(0.016, 2.5, false, undefined);
debug = api.getDebug();
assert.equal(debug.runtime.moveDx, 0, 'player-rig rebuild resets cached movement X at the current player position');
assert.equal(debug.runtime.moveDy, 0, 'player-rig rebuild resets cached movement Y at the current player position');
assert.equal(debug.runtime.hasDirection, false, 'player-rig rebuild cannot inherit a stale swim heading');

assert.doesNotMatch(source, /PlayerBodyTransformComposer/, 'swim module no longer owns body facing through a late composer channel');
assert.doesNotMatch(source, /WebGLRenderer/, 'swim module no longer adds a renderer hook');
assert.match(source, /if \(swimming && handle\.group\?\.rotation\) handle\.group\.rotation\.y = 0/, 'swim explicitly aligns the leg root to the body');
assert.match(source, /if \(!\(strength > 0\)\) \{[\s\S]*state\.blend = 0/, 'swim leg ownership exits immediately at zero strength');
assert.match(source, /Combat\?\.deps\?\.isPlayerSwimming/, 'shared module uses the authoritative game swim predicate');
assert.match(editorHtml, /id="animationHud"/, 'target Procedural Animation Editor exposes its native procedural-movement HUD');
assert.match(editorHtml, /class="animationHudActions"/, 'target editor exposes the HUD action-row extension point used by Swim');
assert.doesNotMatch(editorHtml, /maaModeTabs/, 'target Procedural Animation Editor does not use the unrelated Multi-Avatar Author mode tabs');
assert.match(source, /#animationHud \.animationHudActions/, 'Swim installs into the actual procedural-movement HUD');
assert.doesNotMatch(source, /maaModeTabs|maaSwimTab|maaRigTab/, 'Swim does not target the unrelated animation-author tab system');
assert.doesNotMatch(source, /swimEditorDirection/, 'editor Swim direction is derived from actual preview travel rather than a fake direction slider');
assert.match(source, /currentX - lastEditorX/, 'editor Swim measures actual native preview X travel');
assert.match(source, /currentZ - lastEditorZ/, 'editor Swim measures actual native preview Z travel');
assert.match(source, /proceduralSwimEditorRender/, 'editor Swim applies at the renderer boundary after native gait writers');
assert.match(source, /restoreEditorRenderState\(snapshot\)/, 'editor Swim restores native body\/leg transforms after each draw');
assert.doesNotMatch(source, /requestAnimationFrame\(tick\)/, 'editor Swim does not compete with the native gait in a parallel RAF loop');

const swimFacingBranch = game.match(/else if \(!player\.prone[\s\S]*?isPlayerSwimming\(\)\) \{[\s\S]*?\n        \} else \{/)?.[0] || '';
assert.ok(swimFacingBranch, 'game.js has an explicit native swim-facing branch before the normal billboard dead-zone branch');
assert.match(game, /playerResolvedMoveDx = player\.x - moveStartX;[\s\S]*playerResolvedMoveDy = player\.y - moveStartY;/, 'game captures actual resolved movement after tile-edge sidestep resolution');
assert.match(swimFacingBranch, /facingYawFromMovement\?\.\(playerResolvedMoveDx, playerResolvedMoveDy\)/, 'game swim facing uses actual resolved frame displacement');
assert.match(swimFacingBranch, /playerMesh\.rotation\.y = playerFacing/, 'game swim branch owns the real player body yaw');
assert.match(swimFacingBranch, /playerLegs\?\.group\) playerLegs\.group\.rotation\.y = 0/, 'game swim branch keeps the procedural leg root aligned with the body');
assert.doesNotMatch(swimFacingBranch, /perpClamp/, 'swimming bypasses the ordinary billboard dead-zone clamp');

assert.match(weaponIdle, /Combat\?\.deps\?\.isPlayerSwimming\?\.\(\)/, 'weapon idle body-yaw runtime checks authoritative swimming');
assert.match(weaponIdle, /lastReason = 'swimming'/, 'weapon idle body-yaw channel reports why it yielded to swimming');
assert.match(panelUi, /proceduralSwimGaitEditorScript/, 'procedural animation editor loads the shared Swim mode');
assert.match(panelUi, /procedural-swim-gait\.js\?v=20260917c/, 'editor loads the reviewed swim module revision');
assert.match(combatLoader, /procedural-swim-gait\.js\?v=20260917c/, 'runtime loads the reviewed swim module revision');

console.log('procedural swim gait second-pass regression passed');
