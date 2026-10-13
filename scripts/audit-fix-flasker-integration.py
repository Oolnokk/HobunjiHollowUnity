#!/usr/bin/env python3
from pathlib import Path
import subprocess
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


def main_text(path):
    return subprocess.check_output(['git', 'show', f'origin/main:{path}'], cwd=ROOT, text=True)

# Restore compact main formatting, then add only the Flasker-specific semantic change.
attack_path = 'docs/config/combat/attack-values.json'
attack = main_text(attack_path)
attack = replace_once(
    attack,
    '      "chanceByRank": { "grunt": 0.34, "lieutenant": 0.52, "captain": 0.7 },',
    '      "chanceByRank": { "grunt": 0.34, "flasker": 0.44, "lieutenant": 0.52, "captain": 0.7 },',
    'attack-values Flasker dodge chance',
)
write(attack_path, attack)

loot_path = 'docs/config/loot/loot-pools.json'
loot = main_text(loot_path)
flasker_pool = '''    "bandit_flasker": {\n      "label": "Bandit (Flasker)",\n      "note": "Base corpse valuables. The exact two combat flask loadout types are granted separately by bandit-camps.js so death loot always matches what this Flasker was throwing.",\n      "entries": [\n        { "id": "gold", "itemKey": "gold", "min": 4, "max": 12, "chance": 1, "conditions": {} },\n        { "id": "scrapMetal", "itemKey": "banditScrapMetal", "min": 0, "max": 2, "chance": 1, "conditions": {} }\n      ]\n    },\n'''
loot = replace_once(loot, '    "treasureChest": {', flasker_pool + '    "treasureChest": {', 'loot-pools Flasker pool')
write(loot_path, loot)

# Make authored attack-values able to configure Flasker dodge chance instead of silently retaining only the JS default.
dodge_path = 'docs/js/combat/combat-enemy-dodge.js'
dodge = read(dodge_path)
dodge = replace_once(
    dodge,
    "    for (const rank of ['grunt', 'lieutenant', 'captain']) {",
    "    for (const rank of ['grunt', 'flasker', 'lieutenant', 'captain']) {",
    'enemy dodge rank config loop',
)
write(dodge_path, dodge)

bandit_path = 'docs/js/combat/combat-bandit.js'
bandit = read(bandit_path)

# Replace timer-only Flasker logic with the same staged-action authority ordinary bandit attacks already use.
start = bandit.index('  function updateBanditFlaskAI(c, dt, targetPlayer, distToPlayer) {')
end = bandit.index('\n  function makeBanditDef(', start)
new_flask_ai = r'''  function updateBanditFlaskAI(c, dt, targetPlayer, distToPlayer) {
    if (c?.banditRank !== 'flasker') return null;
    const loadout = c.def?.banditFlaskLoadout || []; // Two recipe ids rolled once for this Flasker and never consumed by AI use.
    if (!loadout.length || !window.AlchemyFlasks?.throwFromEntity) return null;
    const tuning = c.def?.banditFlaskerTuning || banditFlaskerTuning(null); // Spawn-authored tuning survives config reloads consistently with other bandit defs.
    const towardAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x); // Used to keep the hostile facing its current flask target during the shared staged throw.
    const minRangePx = tuning.minThrowRangeTiles * deps.TILE; // Inside this range Flaskers fall back to their normal melee weapon.
    const maxRangePx = tuning.maxThrowRangeTiles * deps.TILE; // Outside this range ordinary bandit approach logic closes distance first.
    c._banditFlaskCooldownT = Math.max(0, (c._banditFlaskCooldownT || 0) - dt);

    if (c._banditFlaskActionActive) {
      c.facing = towardAngle;
      return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
    }

    if (distToPlayer < minRangePx || distToPlayer > maxRangePx) return null;
    if (c._banditFlaskCooldownT > 0) {
      c.facing = towardAngle;
      return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
    }

    const recipeId = loadout[c._banditFlaskIndex % loadout.length]; // Alternates the two persistent loadout types instead of randomly starving one.
    c._banditFlaskIndex = (c._banditFlaskIndex + 1) % Math.max(1, loadout.length);
    const throwAnimation = window.HeldActionAnimations?.throwFlask || window.HeldActionAnimations?.weaponThrowSpin; // Exact player/Attack-Editor hatchet throw is both pose and timing authority.
    if (!throwAnimation?.poses || !window.Combat?.beginStagedAction) return null;
    const durationS = Math.max(0.2, Number(throwAnimation.durationS) || 1.04); // Used for the same total throw cadence authored in the Attack Editor.
    const windupS = Math.max(0.12, durationS * Math.max(0.05, Math.min(0.95, Number(throwAnimation.windupFrac) || 0.49))); // Projectile release begins where the shared hatchet animation enters its strike.
    const strikeS = Math.max(0.05, durationS - windupS); // Keeps the authored strike/follow-through visible after release.
    c._banditFlaskPendingRecipeId = recipeId;
    c._banditFlaskAnimationKey = 'throwFlask'; // Mobile/debug proof of the shared animation identity.
    c._banditFlaskActionActive = true; // Used by the tool renderer to swap the melee weapon for the held flask during this staged action.
    c._banditSwingAnim = throwAnimation.style || 'chop'; // updateBanditToolMesh consumes the exact shared animation style instead of a Flasker-only pose approximation.
    c._banditSwingPose = throwAnimation.poses; // Exact authored neutral/windup/strike poses from HeldActionAnimations.throwFlask.
    c._banditSwingDirSign = 1;
    c._banditSwingPower = 1;
    c._banditSwingPoseScale = 1;
    c.telegraphState = 'windup';
    c.facing = towardAngle;
    c._banditAction = window.Combat.beginStagedAction({
      windupS, strikeS, recoverS: 0,
      data: { isBandit: true, attacker: c, flasker: true, recipeId, animationKey: 'throwFlask' },
      onStrike: () => {
        const pendingRecipeId = c._banditFlaskPendingRecipeId || recipeId; // Captured at windup start so alternating order cannot change mid-throw.
        c._banditFlaskPendingRecipeId = null;
        const launched = window.AlchemyFlasks.throwFromEntity(c, pendingRecipeId, c.def?.banditFlaskPotencyTier || 0, targetPlayer.x, targetPlayer.y);
        c.telegraphState = launched ? 'strike' : null;
      },
      onComplete: () => {
        c._banditFlaskActionActive = false;
        c._banditFlaskCooldownT = tuning.throwCooldownSeconds;
        finishBanditAction(c);
      },
      onCancel: () => {
        c._banditFlaskActionActive = false;
        c._banditFlaskPendingRecipeId = null;
        c._banditFlaskCooldownT = Math.min(0.5, tuning.throwCooldownSeconds);
        finishBanditAction(c);
      },
    });
    return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
  }
'''
bandit = bandit[:start] + new_flask_ai + bandit[end:]

# A tiny direct sprite holder is needed because flasks are inventory items, not TOOL_ITEM_DEFS weapons.
anchor = '''  function makeBanditToolHolder(scene, weaponKey) {\n    const mesh = deps.makeToolPlaneMesh(weaponKey);\n    if (!mesh) return null;\n    const holder = new THREE.Group();\n    holder.name = 'banditToolHolder';\n    holder.add(mesh);\n    scene.add(holder);\n    return holder;\n  }\n'''
insert = anchor + r'''

  const BANDIT_FLASK_TOOL_KEY = 'throwingflask'; // Used by the shared hand-grip registry while the Flasker visually holds an inventory flask.
  const BANDIT_FLASK_SPRITE = 'assets/objectsprites/throwing_flask.png'; // Used by the runtime Flasker holder; Attack Editor uses the same source PNG.
  function makeBanditFlaskToolHolder(scene) {
    if (!scene || !THREE?.Group) return null;
    const holder = new THREE.Group();
    holder.name = 'banditFlaskToolHolder';
    holder.visible = false;
    const visual = new THREE.Group(); // Grip-scaled child matching makeBanditToolHolder's visual-child convention.
    visual.name = 'banditFlaskGripVisual';
    visual.userData = { toolPlane: null };
    holder.userData = { toolPlane: null, banditFlaskHolder: true };
    holder.add(visual);
    scene.add(holder);
    new THREE.TextureLoader().load(BANDIT_FLASK_SPRITE, texture => {
      if (!holder.parent) { texture.dispose?.(); return; }
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      else if ('encoding' in texture && THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
      texture.needsUpdate = true;
      const widthPx = texture.image?.naturalWidth || texture.image?.width || 1;
      const heightPx = texture.image?.naturalHeight || texture.image?.height || 1;
      const width = 0.5;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(width, width * heightPx / Math.max(1, widthPx)),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide }),
      );
      plane.rotation.x = -Math.PI / 2;
      visual.add(plane);
      visual.userData.toolPlane = plane;
      holder.userData.toolPlane = plane;
    }, undefined, error => window.__farmLog?.(`[bandits] throwing flask sprite failed to load: ${error?.message || error}`, 'warn', 'combat'));
    return holder;
  }
'''
bandit = replace_once(bandit, anchor, insert, 'Flasker holder helper')

old_update_head = '''  function updateBanditToolMesh(c) {\n    const handDriverRoot = c?.avatarRef?.handRigAvatarRoot; // Final pre-render hand driver reads this live holder/key selection after ordinary bandit pose logic decides melee vs ranged.\n    if (handDriverRoot?.userData) {\n      const useRanged = !!c._rangedMode && !!c._banditRangedToolHolder;\n      handDriverRoot.userData.proceduralHandToolHolder = useRanged ? c._banditRangedToolHolder : c._banditToolHolder;\n      handDriverRoot.userData.proceduralHandToolKey = useRanged ? c.def?.rangedWeaponKey : c.def?.weaponKey;\n      handDriverRoot.userData.proceduralHandGripContext = useRanged ? 'ranged' : 'melee';\n      if (useRanged) handDriverRoot.userData.proceduralHandAnimationGrip = null; // Ranged poses never opt into the melee 2H ranges.\n    }\n    syncBanditWeaponScale(c, c._banditToolHolder, c.def?.weaponKey);\n    syncBanditWeaponScale(c, c._banditRangedToolHolder, c.def?.rangedWeaponKey, 'ranged');\n    const holder = c._banditToolHolder;\n    if (!holder) return;\n    if (c._rangedMode) {\n      holder.visible = false;\n      window.RangedWeapons?.updateBanditVisual?.(c);\n      return;\n    }\n    holder.visible = true;\n    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;\n'''
new_update_head = '''  function updateBanditToolMesh(c) {\n    const handDriverRoot = c?.avatarRef?.handRigAvatarRoot; // Final pre-render hand driver reads the live melee/ranged/flask holder selected below.\n    const flaskActive = !!c._banditFlaskActionActive && !!c._banditFlaskToolHolder; // During a staged Flasker throw the held flask replaces the backup melee weapon.\n    const useRanged = !flaskActive && !!c._rangedMode && !!c._banditRangedToolHolder;\n    if (handDriverRoot?.userData) {\n      handDriverRoot.userData.proceduralHandToolHolder = flaskActive ? c._banditFlaskToolHolder : (useRanged ? c._banditRangedToolHolder : c._banditToolHolder);\n      handDriverRoot.userData.proceduralHandToolKey = flaskActive ? BANDIT_FLASK_TOOL_KEY : (useRanged ? c.def?.rangedWeaponKey : c.def?.weaponKey);\n      handDriverRoot.userData.proceduralHandGripContext = (flaskActive || useRanged) ? 'ranged' : 'melee';\n      if (useRanged) handDriverRoot.userData.proceduralHandAnimationGrip = null; // Ordinary ranged poses never opt into the melee 2H ranges; Flaskers intentionally keep throw animation grip metadata.\n    }\n    syncBanditWeaponScale(c, c._banditToolHolder, c.def?.weaponKey);\n    syncBanditWeaponScale(c, c._banditRangedToolHolder, c.def?.rangedWeaponKey, 'ranged');\n    syncBanditWeaponScale(c, c._banditFlaskToolHolder, BANDIT_FLASK_TOOL_KEY, 'ranged');\n    const holder = flaskActive ? c._banditFlaskToolHolder : c._banditToolHolder;\n    if (!holder) return;\n    if (flaskActive) {\n      if (c._banditToolHolder) c._banditToolHolder.visible = false;\n      if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;\n      c._banditFlaskToolHolder.visible = true;\n    } else if (c._rangedMode) {\n      holder.visible = false;\n      if (c._banditFlaskToolHolder) c._banditFlaskToolHolder.visible = false;\n      window.RangedWeapons?.updateBanditVisual?.(c);\n      return;\n    } else {\n      holder.visible = true;\n      if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;\n      if (c._banditFlaskToolHolder) c._banditFlaskToolHolder.visible = false;\n    }\n'''
bandit = replace_once(bandit, old_update_head, new_update_head, 'bandit tool holder routing')
bandit = replace_once(bandit, "    if (anim === 'sweep' && pose) {\n      const styleNeutral = deps.STYLE_NEUTRAL_POSE.sweep;", "    if ((anim === 'sweep' || anim === 'chop') && pose) {\n      const styleNeutral = deps.STYLE_NEUTRAL_POSE?.[anim] || deps.STYLE_NEUTRAL_POSE.sweep;", 'bandit chop pose support')

bandit = replace_once(
    bandit,
    "    for (const root of [entity.groundShadow, entity._banditToolHolder, entity._banditRangedToolHolder, entity._banditTrailMesh]) {",
    "    for (const root of [entity.groundShadow, entity._banditToolHolder, entity._banditRangedToolHolder, entity._banditFlaskToolHolder, entity._banditTrailMesh]) {",
    'Flasker holder disposal',
)

holder_create = '''    const banditRangedToolHolder = def.rangedWeaponKey ? makeBanditToolHolder(targetScene, def.rangedWeaponKey) : null;\n    if (banditRangedToolHolder) banditRangedToolHolder.visible = false;\n'''
bandit = replace_once(
    bandit,
    holder_create,
    holder_create + "    const banditFlaskToolHolder = rank === 'flasker' ? makeBanditFlaskToolHolder(targetScene) : null; // Separate inventory-flask visual uses the same authored grip as the Attack Editor.\n",
    'Flasker holder creation',
)
bandit = replace_once(
    bandit,
    '      _banditRangedToolHolder: banditRangedToolHolder,\n      _rangedLoaded: true,',
    '      _banditRangedToolHolder: banditRangedToolHolder,\n      _banditFlaskToolHolder: banditFlaskToolHolder,\n      _rangedLoaded: true,',
    'Flasker holder entity state',
)
bandit = replace_once(
    bandit,
    '      _banditFlaskIndex: 0, _banditFlaskCooldownT: 0, _banditFlaskWindupT: 0, _banditFlaskPendingRecipeId: null, _banditFlaskAnimationKey: null, // Flasker infinite-loadout AI state; inert on every other rank.',
    '      _banditFlaskIndex: 0, _banditFlaskCooldownT: 0, _banditFlaskActionActive: false, _banditFlaskPendingRecipeId: null, _banditFlaskAnimationKey: null, // Flasker staged throw + infinite-loadout state; inert on every other rank.',
    'Flasker staged-action state',
)
write(bandit_path, bandit)

# Strengthen the regression so the previous false-positive (animation key stored but never rendered) cannot recur.
test_path = 'scripts/test-bandit-flasker.js'
test = read(test_path)
test = replace_once(test, "const loot = JSON.parse(read('docs/config/loot/loot-pools.json'));", "const loot = JSON.parse(read('docs/config/loot/loot-pools.json'));\nconst attackValues = JSON.parse(read('docs/config/combat/attack-values.json'));\nconst enemyDodge = read('docs/js/combat/combat-enemy-dodge.js');", 'Flasker test inputs')
test = replace_once(test, "assert.equal(cfg.flasker.lootMinPerType, 2);", "assert.equal(cfg.flasker.lootMinPerType, 2);\nassert.equal(attackValues.bandit.enemyDodge.chanceByRank.flasker, 0.44, 'Flasker dodge chance lives in the existing singular bandit config');\nassert.equal(attackValues.bandits, undefined, 'no dead plural bandits config block is introduced');\nassert.match(enemyDodge, /\['grunt', 'flasker', 'lieutenant', 'captain'\]/, 'authored Flasker dodge chance is actually consumed');", 'Flasker test config assertions')
test = replace_once(test, "assert.match(bandits, /throwFromEntity\\(c, recipeId/, 'Flasker AI launches through the shared alchemy flask projectile system');", "assert.match(bandits, /throwFromEntity\\(c, pendingRecipeId/, 'Flasker AI launches through the shared alchemy flask projectile system');\nassert.match(bandits, /c\\._banditSwingPose = throwAnimation\\.poses/, 'Flasker render pose consumes the shared hatchet throw animation poses');\nassert.match(bandits, /makeBanditFlaskToolHolder[\\s\\S]*?throwing_flask\\.png/, 'Flaskers render the actual throwing-flask sprite while attacking');\nassert.match(bandits, /flaskActive[\\s\\S]*?_banditFlaskToolHolder[\\s\\S]*?BANDIT_FLASK_TOOL_KEY/, 'procedural hands and held-item rendering switch to the authored flask grip during throws');\nassert.match(bandits, /beginStagedAction\\(\\{[\\s\\S]*?flasker: true/, 'Flasker throws use the same staged-action timer authority as other bandit attacks');", 'Flasker test visual assertions')
write(test_path, test)

print('Applied audit fixes: compact configs, consumed Flasker dodge config, staged hatchet-pose flask throws, real flask holder, stronger regression.')
