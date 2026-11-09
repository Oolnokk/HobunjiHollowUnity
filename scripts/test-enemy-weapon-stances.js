'use strict';

const fs = require('fs'); // Reads the runtime module exactly as the browser would execute it.
const path = require('path'); // Resolves the repository-relative runtime module path for this standalone Node test.
const assert = require('assert'); // Provides strict assertions for stance selection, pose preparation, and state restoration.
const vm = require('vm'); // Evaluates the browser IIFE against the small window/BanditCombat mocks below.

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'combat', 'enemy-weapon-stances.js'); // Runtime module under test.
const spacingPath = path.join(__dirname, '..', 'docs', 'js', 'combat', 'melee-pose-spacing.js'); // Shared player/enemy endpoint spacing owner.
const source = fs.readFileSync(modulePath, 'utf8'); // Exact committed runtime source executed in the mock browser context.
const spacingSource = fs.readFileSync(spacingPath, 'utf8');
let nowMs = 1000; // Deterministic performance clock used to test settle-window behavior.
let refreshCount = 0; // Counts shared WeaponToolStances definition refreshes to prove classification is not duplicated here.
const renderCalls = []; // Captures the temporary pose state BanditCombat sees while the adapter delegates each visual update.

const heavyPose = { x: -0.03, y: 0.27, z: 0.02, pitch: -23, yaw: 104, bodyYaw: -15, roll: 89 }; // Representative committed Heavy weapon neutral.
const lightPose = { x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }; // Representative committed Light weapon neutral.
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
    if (entity._mockRendererFinishesTail) { // The real renderer restores the rest stance at the end of the draw that finishes the tail.
      entity._banditSwingAnim = 'thrust'; entity._banditSwingPose = null; entity._banditSwingDirSign = 1; entity._banditSwingPower = 1;
      entity._banditSwingResetDone = true;
    }
    const toolMesh = entity._banditToolHolder?.children?.[0];
    const toolPlane = toolMesh?.userData?.toolPlane;
    if (toolPlane) {
      toolPlane.rotation.z = entity._banditSwingAnim === 'sweep' ? -Math.PI / 2 : 0;
      toolPlane.scale.x = entity._banditSwingAnim === 'sweep' ? (entity._banditSwingDirSign || 1) : 1; // Legacy renderer's plane flip; the stance adapter must replace it with a mesh-level midline mirror.
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

vm.runInThisContext(fs.readFileSync('docs/js/combat/shared-attack-pose.js', 'utf8'), { filename: 'shared-attack-pose.js' }); // Shared pose math the stance runtime delegates to.
vm.runInThisContext(spacingSource, { filename: spacingPath });
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
    _banditToolHolder: { children: [{ scale: { x: 1 }, updateMatrix() {}, userData: { toolPlane } }] },
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
  assert.deepStrictEqual(renderCalls[0].pose.neutral, { ...heavyPose, bodySink: 6 }); // The stance's idle body sink rides the baked Neutral.
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
  assert.deepStrictEqual(renderCalls[0].pose.neutral, { ...lightPose, bodySink: 6 }); // The stance's idle body sink rides the baked Neutral.
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
  // Heavy weapons alternate sides like the player's: a Backhand starts mirrored (BanditCombat's own mirror step
  // flips this pre-unmirrored input back to the mirrored stance) and returns to the regular Heavy idle.
  assert.strictEqual(prepared.pose.neutral.x, heavyPose.x);
  assert.strictEqual(prepared.pose.neutral.yaw, heavyPose.yaw);
  assert.strictEqual(prepared.pose.neutral.bodyYaw, heavyPose.bodyYaw);
  assert.strictEqual(prepared.pose.neutral.roll, heavyPose.roll);
  assert.strictEqual(prepared.pose.neutralMirrorSign, -1);
  assert.strictEqual(prepared.pose.returnNeutralMirrorSign, 1);
  assert.strictEqual(prepared.pose.returnNeutral.x, -heavyPose.x);
  assert.strictEqual(prepared.pose.returnNeutral.yaw, -heavyPose.yaw);
  assert.strictEqual(prepared.pose.neutral.y, heavyPose.y);
  assert.strictEqual(prepared.pose.neutral.pitch, heavyPose.pitch);
  const bakedWindup = {
    ...authored.windup,
    x: sweepNeutral.x + (authored.windup.x - sweepNeutral.x) * 1.5,
    y: sweepNeutral.y + (authored.windup.y - sweepNeutral.y) * 1.5,
    z: sweepNeutral.z + (authored.windup.z - sweepNeutral.z) * 1.5,
    pitch: sweepNeutral.pitch + (authored.windup.pitch - sweepNeutral.pitch) * 1.5,
    yaw: sweepNeutral.yaw + (authored.windup.yaw - sweepNeutral.yaw) * 1.5,
    bodyYaw: sweepNeutral.bodyYaw + (authored.windup.bodyYaw - sweepNeutral.bodyYaw) * 1.5,
    roll: sweepNeutral.roll + (authored.windup.roll - sweepNeutral.roll) * 1.5,
  };
  const spacedWindup = window.MeleePoseSpacing.adjustEndpoint(bakedWindup, 'windup');
  approx(prepared.pose.windup.x, spacedWindup.x);
  approx(prepared.pose.windup.y, spacedWindup.y);
  approx(prepared.pose.windup.z, spacedWindup.z);
  approx(prepared.pose.windup.bodyYaw, bakedWindup.bodyYaw);
  approx(entity._banditToolHolder.children[0].userData.toolPlane.rotation.z, 0);
  assert.strictEqual(entity._banditToolHolder.children[0].userData.toolPlane.scale.x, 1, 'Backhand never flips the sprite plane itself');
  assert.strictEqual(entity._banditToolHolder.children[0].scale.x, -1, 'Backhand mirrors the whole tool across the midline, like the player and the editor');
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
  assert.deepStrictEqual(renderCalls[0].pose.neutral, { ...lightPose, bodySink: 6 }); // The stance's idle body sink rides the baked Neutral.
  const rawWindup = { x: 0, y: 0, z: -0.40 * 1.2, pitch: 10.31, yaw: 0, bodyYaw: -45 * 1.2, roll: 0 };
  const rawStrike = { x: -0.23 * 1.2, y: 0, z: 0.32 * 1.2, pitch: 1, yaw: -45 * 1.2, bodyYaw: 46 * 1.2, roll: 0 };
  const spacedWindup = window.MeleePoseSpacing.adjustEndpoint(rawWindup, 'windup');
  const spacedStrike = window.MeleePoseSpacing.adjustEndpoint(rawStrike, 'strike');
  approx(renderCalls[0].pose.windup.x, spacedWindup.x);
  approx(renderCalls[0].pose.windup.y, spacedWindup.y);
  approx(renderCalls[0].pose.windup.z, spacedWindup.z);
  approx(renderCalls[0].pose.strike.x, spacedStrike.x);
  approx(renderCalls[0].pose.strike.y, spacedStrike.y);
  approx(renderCalls[0].pose.strike.z, spacedStrike.z);
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

// The baked pose only depends on values that are constant for a whole attack, so
// it is built once per attack and reused every frame (no per-enemy per-frame
// garbage), but still rebuilt whenever anything it derives from changes.
{
  renderCalls.length = 0;
  const authored = {
    neutral: { ...sweepNeutral },
    windup: { x: 0.20, y: 0.10, z: 0.30, pitch: 10, yaw: 20, bodyYaw: -30, roll: 40 },
    strike: { x: -0.10, y: 0.20, z: 0.50, pitch: -15, yaw: -25, bodyYaw: 35, roll: -45 },
  };
  const entity = makeEntity({ weaponKey: 'heavy_weapon', anim: 'sweep', pose: authored, sign: 1, power: 1, action: { windupS: 0.4, strikeS: 0.2, t: 0 } });
  const first = window.EnemyWeaponStances.preparedEnemyPose(entity);
  for (let frame = 1; frame <= 5; frame += 1) {
    entity._banditAction.t = frame * 0.05; // The action advances every frame; the bake must not.
    assert.strictEqual(window.EnemyWeaponStances.preparedEnemyPose(entity), first, 'same attack reuses its baked pose');
  }
  window.BanditCombat.updateToolMesh(entity);
  assert.strictEqual(entity._enemyPreparedPose.prepared, first, 'the renderer path shares that cache');

  const savedX = heavyPose.x;
  heavyPose.x = savedX + 0.05; // WeaponToolStances edits its shared stance objects in place.
  const afterStanceEdit = window.EnemyWeaponStances.preparedEnemyPose(entity);
  assert.notStrictEqual(afterStanceEdit, first, 'an in-place stance edit rebakes');
  approx(afterStanceEdit.pose.neutral.x, savedX + 0.05);
  heavyPose.x = savedX;

  const afterRestore = window.EnemyWeaponStances.preparedEnemyPose(entity);
  entity._banditSwingPower = 1.2;
  assert.notStrictEqual(window.EnemyWeaponStances.preparedEnemyPose(entity), afterRestore, 'a different attack power rebakes');
  entity._banditSwingPower = 1;
  const settledPower = window.EnemyWeaponStances.preparedEnemyPose(entity);
  entity._banditAction = { windupS: 0.4, strikeS: 0.2, t: 0 };
  assert.notStrictEqual(window.EnemyWeaponStances.preparedEnemyPose(entity), settledPower, 'a new staged action is a new attack and rebakes');
  entity._banditSwingDirSign = -1;
  assert.strictEqual(window.EnemyWeaponStances.preparedEnemyPose(entity).effectiveSign, -1, 'a different direction rebakes');

  // Authored hand-grip flags on the attack's endpoints reach the enemy's hand driver like the player's.
  const withFlags = { ...authored, windup: { ...authored.windup, secondaryGrip: { enabled: false, percent: 50, primaryPercent: 50 } } };
  const flagged = makeEntity({ weaponKey: 'heavy_weapon', anim: 'sweep', pose: withFlags, action: { windupS: 0.4, strikeS: 0.2, t: 0 } });
  assert.deepStrictEqual(window.EnemyWeaponStances.preparedEnemyPose(flagged).pose.windup.secondaryGrip, { enabled: false, percent: 50, primaryPercent: 50 });
}

// The strike/hold/return tail is still the swing: the adapter keeps the stance neutral through it, and when the
// renderer finishes the tail (restoring the rest stance) the adapter must not restore the finished swing over it.
{
  renderCalls.length = 0;
  const entity = makeEntity({ weaponKey: 'heavy_weapon', anim: 'sweep', pose: { neutral: { ...sweepNeutral }, windup: { ...sweepNeutral }, strike: { ...sweepNeutral } }, power: 1.5 });
  entity._banditToolTail = { startMs: 0, baseElapsedS: 0.6, durationS: 0.6, windupFrac: 0.7, strikeFrac: 1, holdS: 0.4 };
  window.BanditCombat.updateToolMesh(entity);
  assert.strictEqual(renderCalls[0].anim, 'sweep', 'stance pose is applied through the tail');
  assert.deepStrictEqual(renderCalls[0].pose.neutral, { ...heavyPose, bodySink: 6 }); // The stance's idle body sink rides the baked Neutral.
  assert.strictEqual(entity._enemyWeaponStanceDebug.applied, true);

  // The draw that finishes the tail restores the rest stance; the adapter keeps it instead of restoring the old swing.
  entity._mockRendererFinishesTail = true;
  window.BanditCombat.updateToolMesh(entity);
  assert.strictEqual(entity._banditSwingAnim, 'thrust', 'rest stance survives the adapter');
  assert.strictEqual(entity._banditSwingPower, 1);
  assert.strictEqual(entity._banditSwingPose, null);
  assert.strictEqual(entity._banditSwingResetDone, false, 'the handoff flag is consumed');
  // Without a reset, the swing's own fields are restored exactly as before.
  const normal = makeEntity({ weaponKey: 'heavy_weapon', anim: 'sweep', power: 1.5 });
  normal._banditToolTail = { startMs: 0, baseElapsedS: 0.6, durationS: 0.6, windupFrac: 0.7, strikeFrac: 1, holdS: 0.4 };
  window.BanditCombat.updateToolMesh(normal);
  assert.strictEqual(normal._banditSwingAnim, 'sweep'); assert.strictEqual(normal._banditSwingPower, 1.5);
}
// Heavy forehand starts regular and returns mirrored (ready for the backhand); Light weapons never alternate.
{
  const fore = makeEntity({ weaponKey: 'heavy_weapon', anim: 'sweep', pose: { neutral: { ...sweepNeutral }, windup: { ...sweepNeutral }, strike: { ...sweepNeutral } }, sign: 1 });
  const foreSeq = window.EnemyWeaponStances.preparedEnemyPose(fore).pose;
  assert.strictEqual(foreSeq.neutralMirrorSign, 1); assert.strictEqual(foreSeq.returnNeutralMirrorSign, -1);
  assert.strictEqual(foreSeq.neutral.x, -(-heavyPose.x)); assert.strictEqual(foreSeq.returnNeutral.x, -heavyPose.x);
  const lightBack = makeEntity({ weaponKey: 'light_weapon', anim: 'sweep', pose: { neutral: { ...sweepNeutral }, windup: { ...sweepNeutral }, strike: { ...sweepNeutral } }, sign: -1 });
  const lightSeq = window.EnemyWeaponStances.preparedEnemyPose(lightBack).pose;
  assert.strictEqual(lightSeq.neutralMirrorSign, 1); assert.strictEqual(lightSeq.returnNeutralMirrorSign, 1);
  assert.strictEqual(lightSeq.returnNeutral.x, -lightPose.x, 'light return Neutral equals its (pre-unmirrored) start Neutral');
  assert.strictEqual(lightSeq.neutral.x, -lightPose.x);
}

// A dual-wield weapon rests in the authored dual-wield main stance (the player's WeaponToolStances.targetPoseFor).
{
  const dualMainPose = { x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 };
  const dualMain = { ...dualMainPose, x: -0.05, pitch: 30 }; // Distinct from Light so the selection is observable.
  window.WeaponToolStances.poses.dualWieldMain = dualMain;
  window.HobunjiHandToolGrips = { isDualWieldWeapon: key => key === 'dagger_weapon' };
  toolDefs.dagger_weapon = { shapeKey: 'dagger', animStyle: 'thrust', weaponIdleClass: 'light' };
  const dual = makeEntity({ weaponKey: 'dagger_weapon', anim: 'thrust' });
  const prepared = window.EnemyWeaponStances.preparedEnemyPose(dual);
  assert.strictEqual(prepared.pose.neutral.x, dualMain.x); assert.strictEqual(prepared.pose.neutral.pitch, dualMain.pitch);
  assert.strictEqual(dual._enemyDualWeapon.value, true);
  // Same class, not a dual weapon: ordinary Light stance.
  const plain = makeEntity({ weaponKey: 'light_weapon', anim: 'thrust' });
  assert.strictEqual(window.EnemyWeaponStances.preparedEnemyPose(plain).pose.neutral.x, lightPose.x);
  delete window.WeaponToolStances.poses.dualWieldMain; delete window.HobunjiHandToolGrips; delete toolDefs.dagger_weapon;
}

console.log('test-enemy-weapon-stances: ok');
