# Shared attack-pose math

`docs/js/combat/shared-attack-pose.js` (`window.SharedAttackPose`) is the single owner of
the code that turns an attack pose into this frame's tool and body channels. It is used by:

| Actor | Where it samples |
| --- | --- |
| Player | `game.js` `updateToolMesh` (authored pose, legacy thrust / chop / sweep), `weapon-tool-stances.js` `prepareCombatOptions` |
| Every `BanditCombat` humanoid — bandits, ghouls, skeletons, minions, liches, Porakaneki | `combat/combat-bandit.js` `updateBanditToolMesh`, `combat/enemy-weapon-stances.js` |

## What lives in it (edit here and the player and all enemies change together)

- `fourPhaseLerp` / `sequencedPoseLerp` — the neutral → windup → strike → hold → neutral timeline (and the `load` / `fire` ranged sequences). Mirrors the attack-animation editor's `poseAt()`.
- `STYLE_NEUTRAL_POSE` — each style's rest pose and the fallback for any channel a pose omits.
- `samplePose` — merge over the style neutral, power scaling, Backhand mirroring (`x`, `yaw`, `roll`, `bodyYaw`), midline-flip blend.
- `LEGACY_THRUST` / `LEGACY_SWEEP` / `LEGACY_CHOP_POSE` + `sampleLegacyThrust` / `sampleLegacySweep` — the old procedural arcs, written once; the stance baker (`legacyProceduralEndpoints`) reads the same numbers.
- `sampleSwing` — the player's style selection in one call: an authored pose for any style, else the legacy chop / sweep / thrust arc. The enemy renderer samples every swing through it and places the result exactly like the player's pose-driven branch.
- `bakeAttackEndpoints`, `effectiveDirSign`, `neutralInputForSigns` — how an attack is baked against a replacement Light/Heavy Neutral (power, `MeleePoseSpacing`, handedness).
- `swingTimeline` / `holdFrac` — the player's swing clock (post-strike hold, proportional return tail, wf/sf/hf).

Authored pose *data* (`attack-pose-templates.js`, `combat-combo.js`, the weapon stance JSON) was already shared; this module shares the code that plays it.

Which pose an attack plays has one source per ability, used by the player and every enemy alike: `Combat.comboStepPose(comboId, step)` for combo steps (bandits and lich casts too) and `Combat.quickAttackData.quickAttackPose()` for quick attacks. Both apply the editor's power rule, so callers pass power 1.

## The player's animations are authoritative

The player's attack animations as they were before this module existed (`game.js` `updateToolMesh`, `weapon-tool-stances.js`, commit `9855210`) are the intended look for the player **and** for enemies. `scripts/test-player-pose-golden.js` embeds that original math verbatim and fuzzes `SharedAttackPose` against it (poses, legacy thrust/chop, stance baking, the swing clock). If it fails, fix the module, not the reference.

Enemies therefore play the player's swing **clock** too: `swingTimeline` turns the staged action's windup/strike plus the ability's own `holdS` / `returnS` (the data `combat-combo.js` etc. hand the player's swing visual) into windup → strike travel → hold → eased return. The staged action ends at its strike, so `finishBanditAction` hands the rest of the timeline to `c._banditToolTail`, which `updateBanditToolMesh` keeps playing before resetting to the weapon's rest stance. A cancelled action (staggered mid-windup) and a Flasker throw reset immediately.

## What stays per-actor on purpose

- **Placement** of the sampled channels: the player's hand anchor, reticle orbit and species scaling vs. an enemy's own avatar anchor.
- **Where the elapsed time comes from**: the player's `toolSwingT` vs. an enemy's staged action + tail.

## Heavy weapons and dual-wield work for every actor

- **Heavy-weapon alternating Neutral.** `SharedAttackPose.bakeStanceSequence` holds the rule: a Heavy swing finishes ready on the opposite side, so a Backhand starts mirrored and returns to the regular idle, a Forehand does the inverse, and Light weapons never alternate. The player's `prepareCombatOptions` and every enemy's `EnemyWeaponStances` bake with it; the renderers sample the resulting `returnNeutral` / mirror signs, blend the hand anchor across the midline and flip the weapon sprite when the blend crosses it.
- **Dual-wield stance.** A weapon that `HobunjiHandToolGrips.isDualWieldWeapon` accepts rests in the authored `dualWieldMain` stance for the player and for enemies alike.
- **Dual-wield hands and weapons.** An enemy's `updateBanditToolMesh` evaluates `animationGripAt` with its own weapon key, so the hand mode (one-hand / two-hand / dual) comes from the weapon, and a dual-wield weapon rests with the grip state's `dualWieldIdleBlend` of 1. `dual-wield-weapon-visuals.js` keeps one state per actor (the player under a fixed key, every other actor keyed by its avatar root): each gets its own hidden-original plane, two duplicates with the plane-normal gap, the authored offhand idle stance mirrored across *that actor's* body, and the small main-hand lag. The hand driver already resolved sockets through the actor's own record; the pre-render sync now covers every actor with duplicates and tears one down when its holder leaves the scene.

## Performance

Everything on the per-frame path (`fourPhaseLerp`, `samplePose`, `sampleLegacyThrust`) writes into a caller-owned sample object and module scratch — no per-frame objects or closures. `EnemyWeaponStances` bakes each enemy's stance pose once per attack (cached on the entity, revalidated against the live stance values, the attack's pose/power/sign and the action identity) instead of rebuilding about a dozen objects per enemy per frame.

## The attack-animation editor is connected too

`docs/tools/attack-animation-editor/index.html` loads this module and uses it for its rest poses (`STYLE_NEUTRAL_POSE`, plus the editor-only `drink`), its playback timeline (`poseAt` → `sequencedPoseLerp`) and its Backhand mirroring (`flipPose` → `MIRRORED_POSE_KEYS`). What the editor previews is computed by the same code the game runs. The editor's previous behavior is kept everywhere (including showing the windup pose at t = 0 for a 0% windup).

## Hand grips

`animationGripAt` (`hand-tool-grips.js`) defaults an attack's windup/strike to two-handed and its Neutral to one-handed, which is exactly what the player's `prepareCombatOptions` spells out as explicit `secondaryGrip` / `dualWield` flags, so enemies get the same behavior from the same flags (authored flags on Windup/Strike ride through the baker). See above for the weapon-driven hand mode.

## Held windups and hands

An enemy's Charged Breaker covers the first part of the player's decelerating held-windup curve (`Combat.windupCurve`, the bare curve) over its own windup, so its pose, hands and blade twist reach the charge at the same rate the player's do. `Combat.windupPoseProgress` additionally applies the player's own held-ability transforms (Furious Charged Breaker); enemies never use it, and their hand-grip calls pass `heldTransforms: false` and the charge fraction as `poseScale`.

Tests: `node scripts/run-tests.js shared-attack-pose player-pose-golden attack-editor-shared enemy-weapon-stances dual-wield enemy-player-attack-parity`. `test-enemy-player-attack-parity.js` runs the player's real combo/quick-attack code and the enemy's real fire functions and renderer, and checks they sample the same swing.
