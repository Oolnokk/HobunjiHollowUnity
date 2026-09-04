'use strict';

const fs = require('fs'); // Reads the runtime module exactly as the browser would execute it.
const path = require('path'); // Resolves the repository-relative runtime module path for this standalone Node test.
const assert = require('assert'); // Provides strict assertions for stance selection, pose preparation, and state restoration.
const vm = require('vm'); // Evaluates the browser IIFE against the small window/BanditCombat mocks below.

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'combat', 'enemy-weapon-stances.js'); // Runtime module under test.
const source = fs.readFileSync(modulePath, 'utf8'); // Exact committed runtime source executed in the mock browser context.
let nowMs = 1000; // Deterministic performance clock used to test settle-window behavior.
let refreshCount = 0; // Counts shared WeaponToolStances definition refreshes to prove classification is not duplicated here.
const renderCalls = []; // Captures the temporary pose state BanditCombat sees while the adapter delegates each visual update.

const heavyPose = { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: -15, roll: -82 }; // Representative committed Heavy weapon neutral.
const lightPose = { x: 0.04, y: 0, z: 0, pitch: 20, yaw: -70, bodyYaw: -40, roll: -65 }; // Representative committed Light weapon neutral.
const sweepNeutral = { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: 0, roll: 0 }; // Legacy source neutral used by BanditCombat sweep attacks.
const thrustNeutral = { x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 }; // Legacy source neutral used by BanditCombat thrust attacks.

const toolDefs = { // Shared game tool definitions whose weaponIdleClass values are owned by WeaponToolStances.
  heavy_weapon: { shapeKey: 'hatchet', animStyle: 'sweep', weaponIdleClass: 'heavy' },
  light_weapon: { shapeKey: 'fishingspear', animStyle: 'thrust', weaponIdleClass: 'light' },
  refresh_weapon: { shapeKey: 'hatchet', animStyle: 'sweep' },
};

const BanditCombat = { // Minimal public BanditCombat API wrapped by the runtime module under test.
  init(injectedDeps) {
    this.deps = injectedDeps;
  },
  updateToolMesh(entity) {
    renderCalls.push({
      anim: entity._banditSwingAnim,
      pose: entity._banditSwingPose ? JSON.parse(JSON.stringify(entity._banditSwingPose)) : null,
      dirSign: entity._banditSwingDirSign,
      power: entity._banditSwingPower,
    });
    const toolPlane = entity._banditToolHolder?.children?.[0]?.userData?.toolPlane;
    if (toolPlane) {
      toolPlane.rotation.z = entity._banditSwingAnim === 'sweep' ? -Math.PI / 2 : 0;
      toolPlane.scale.x = entity._banditSwingAnim === 'sweep' ? (entity._banditSwingDirSign || 1) : 1;
    }
    return 'rendered';
  },
};

global.performance = { now: () => nowMs }; // Browser-compatible deterministic clock consumed by the runtime adapter.
global.window = { // Browser globals required by the runtime adapter.
  BanditCombat,
  WeaponToolStances: {
    poses: { heavyWeapon: heavyPose, lightWeapon: lightPose },
    refreshDefinitions() {
      refreshCount += 1;
      for (const def of Object.values(toolDefs)) {
        if (!def.weaponIdleClass && def.shapeKey === 'hatchet') def.weaponIdleClass = 'heavy';
      }
    },
  },
  __farmLog() {},
};

vm.runInThisContext(source, { filename: modulePath });

const deps = { // BanditCombat dependencies captured by the adapter's wrapped init().
  TOOL_ITEM_DEFS: toolDefs,
  STYLE_NEUTRAL_POSE: {
    thrust: thrustNeutral,
    sweep: sweepNeutral,
    chop: { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82 },
  },
  hostileObjects: [],
};
window.BanditCombat.init(deps);

function makeEntity({ weaponKey, speciesId = 'mao-ao', anim = 'thrust', pose = null, sign = 1, power = 1, action = null, settleUntil = 0, ranged = false } = {}) {
  const toolPlane = { rotation: { z: 0 }, scale: { x: 1 }, updateMatrix() {} }; // Per-entity sprite plane mutated by BanditCombat and corrected by the stance adapter.
  return {
    id: `test_${weaponKey}_${speciesId}`,
    name: 'Test Enemy',
    isBandit: true,
    health: 100,
    def: { weaponKey },
    avatarRef: { profile: { speciesId } },
    _banditToolHolder: { children: [{ userData: { toolPlane } }] },
    _banditSwingAnim: anim,
    _banditSwingPose: pose,
    _banditSwingDirSign: sign,
    _banditSwingPower: power,
    _banditAction: action,
    _banditToolSettleUntil: settleUntil,
    _rangedMode: ranged,
  };
}

function approx(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected}`);
}

// Heavy idle: the original renderer must receive a complete authored pose whose
// neutral is the same Heavy stance used by the player, while entity state is
// restored immediately afterward.
{
  renderCalls.length = 0;
  const entity = makeEntity({ weaponKey: 'heavy_weapon', anim: 'thrust' });
  const originalPose = entity._banditSwingPose;
  assert.strictEqual(window.BanditCombat.updateToolMesh(entity), 'rendered');
  assert.strictEqual(renderCalls.length, 1);
  assert.strictEqual(renderCalls[0].anim, 'sweep');
  assert.deepStrictEqual(renderCalls[0].pose.neutral, heavyPose);
  assert.strictEqual(renderCalls[0].power, 1);
  assert.strictEqual(entity._banditSwingAnim, 'thrust');
  assert.strictEqual(entity._banditSwingPose, originalPose);
  assert.strictEqual(entity._enemyWeaponStanceDebug.stanceClass, 'heavy');
  approx(entity._banditToolHolder.children[0].userData.toolPlane.rotation.z, 0);
}

// Ghoul parity: species does not branch the stance policy. A ghoul carrying a
// Light-class weapon receives the same Light neutral as any other BanditCombat
// humanoid carrying that weapon.
{
  renderCalls.length = 0;
  const ghoul = makeEntity({ weaponKey: 'light_weapon', speciesId: 'ghoul', anim: 'thrust' });
  window.BanditCombat.updateToolMesh(ghoul);
  assert.deepStrictEqual(renderCalls[0].pose.neutral, lightPose);
  assert.strictEqual(ghoul._enemyWeaponStanceDebug.stanceClass, 'light');
  assert.strictEqual(ghoul._enemyWeaponStanceDebug.speciesId, 'ghoul');
}

// Authored sweep/backhand: neutral is pre-unmirrored so BanditCombat's own
// mirror produces the exact same visible stance for either attack direction;
// windup/strike remain based on the ORIGINAL source neutral and original power.
{
  renderCalls.length = 0;
  const authored = {
    neutral: { ...sweepNeutral },
    windup: { x: 0.20, y: 0.10, z: 0.30, pitch: 10, yaw: 20, bodyYaw: -30, roll: 40 },
    strike: { x: -0.10, y: 0.20, z: 0.50, pitch: -15, yaw: -25, bodyYaw: 35, roll: -45 },
  };
  const entity = makeEntity({
    weaponKey: 'heavy_weapon', anim: 'sweep', pose: authored, sign: -1, power: 1.5,
    action: { windupS: 0.4, strikeS: 0.2, t: 0 },
  });
  window.BanditCombat.updateToolMesh(entity);
  const prepared = renderCalls[0];
  assert.strictEqual(prepared.dirSign, -1);
  assert.strictEqual(prepared.power, 1);
  assert.strictEqual(prepared.pose.neutral.x, -heavyPose.x);
  assert.strictEqual(prepared.pose.neutral.yaw, -heavyPose.yaw);
  assert.strictEqual(prepared.pose.neutral.bodyYaw, -heavyPose.bodyYaw);
  assert.strictEqual(prepared.pose.neutral.roll, -heavyPose.roll);
  assert.strictEqual(prepared.pose.neutral.y, heavyPose.y);
  assert.strictEqual(prepared.pose.neutral.pitch, heavyPose.pitch);
  approx(prepared.pose.windup.x, sweepNeutral.x + (authored.windup.x - sweepNeutral.x) * 1.5);
  approx(prepared.pose.windup.bodyYaw, sweepNeutral.bodyYaw + (authored.windup.bodyYaw - sweepNeutral.bodyYaw) * 1.5);
  approx(entity._banditToolHolder.children[0].userData.toolPlane.rotation.z, 0);
  assert.strictEqual(entity._banditToolHolder.children[0].userData.toolPlane.scale.x, -1);
}

// During a sweep windup, the neutral-only plane compensation fades linearly:
// half-way through windup it has restored half of the legacy -90° sweep twist.
{
  renderCalls.length = 0;
  const entity = makeEntity({
    weaponKey: 'heavy_weapon', anim: 'sweep', pose: { neutral: { ...sweepNeutral }, windup: { ...sweepNeutral }, strike: { ...sweepNeutral } },
    action: { windupS: 0.4, strikeS: 0.2, t: 0.2 },
  });
  window.BanditCombat.updateToolMesh(entity);
  approx(entity._banditToolHolder.children[0].userData.toolPlane.rotation.z, -Math.PI / 4);
  approx(entity._enemyWeaponStanceDebug.neutralWeight, 0.5);

  entity._banditAction.t = 0.4;
  window.BanditCombat.updateToolMesh(entity);
  approx(entity._banditToolHolder.children[0].userData.toolPlane.rotation.z, -Math.PI / 2);
  approx(entity._enemyWeaponStanceDebug.neutralWeight, 0);
}

// Legacy thrust ignores an accidental -1 direction sign, matching the player's
// WeaponToolStances.prepareCombatOptions effectiveSign policy.
{
  renderCalls.length = 0;
  const entity = makeEntity({ weaponKey: 'light_weapon', anim: 'thrust', sign: -1, power: 1.2, action: { windupS: 0.3, strikeS: 0.2, t: 0 } });
  window.BanditCombat.updateToolMesh(entity);
  assert.strictEqual(renderCalls[0].dirSign, 1);
  assert.deepStrictEqual(renderCalls[0].pose.neutral, lightPose);
  approx(renderCalls[0].pose.windup.z, -0.40 * 1.2);
  approx(renderCalls[0].pose.strike.x, -0.23 * 1.2);
}

// The existing post-strike settle and ranged paths stay completely untouched.
{
  renderCalls.length = 0;
  const settling = makeEntity({ weaponKey: 'heavy_weapon', anim: 'thrust', settleUntil: nowMs + 500 });
  window.BanditCombat.updateToolMesh(settling);
  assert.strictEqual(renderCalls[0].anim, 'thrust');
  assert.strictEqual(renderCalls[0].pose, null);

  const ranged = makeEntity({ weaponKey: 'heavy_weapon', anim: 'thrust', ranged: true });
  window.BanditCombat.updateToolMesh(ranged);
  assert.strictEqual(renderCalls[1].anim, 'thrust');
  assert.strictEqual(renderCalls[1].pose, null);
}

// Classification fallback remains single-sourced in WeaponToolStances.
{
  renderCalls.length = 0;
  refreshCount = 0;
  delete toolDefs.refresh_weapon.weaponIdleClass;
  const entity = makeEntity({ weaponKey: 'refresh_weapon', anim: 'sweep' });
  window.BanditCombat.updateToolMesh(entity);
  assert.ok(refreshCount >= 1, 'expected shared WeaponToolStances.refreshDefinitions() to be consulted');
  assert.strictEqual(entity._enemyWeaponStanceDebug.stanceClass, 'heavy');
}

// Public debug snapshot is intentionally mobile/headless-friendly and includes
// both ordinary bandits and ghouls because both are BanditCombat entities.
{
  const bandit = makeEntity({ weaponKey: 'heavy_weapon', speciesId: 'mao-ao' });
  const ghoul = makeEntity({ weaponKey: 'light_weapon', speciesId: 'ghoul' });
  deps.hostileObjects.push(bandit, ghoul);
  const snapshot = window.EnemyWeaponStances.debugSnapshot();
  assert.strictEqual(snapshot.length, 2);
  assert.deepStrictEqual(snapshot.map(row => row.stanceClass), ['heavy', 'light']);
  assert.deepStrictEqual(snapshot.map(row => row.speciesId), ['mao-ao', 'ghoul']);
}

console.log('test-enemy-weapon-stances: ok');
