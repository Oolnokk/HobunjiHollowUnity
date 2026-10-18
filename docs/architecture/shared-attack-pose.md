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
- `LEGACY_THRUST` / `LEGACY_SWEEP` / `LEGACY_CHOP_POSE` + `sampleLegacyThrust` — the old procedural arcs, written once; the stance baker (`legacyProceduralEndpoints`) reads the same numbers.
- `bakeAttackEndpoints`, `effectiveDirSign`, `neutralInputForSigns` — how an attack is baked against a replacement Light/Heavy Neutral (power, `MeleePoseSpacing`, handedness).

Authored pose *data* (`attack-pose-templates.js`, `combat-combo.js`, the weapon stance JSON) was already shared; this module shares the code that plays it.

## What stays per-actor on purpose

- **Placement** of the sampled channels: the player's hand anchor, reticle orbit and species scaling vs. an enemy's own avatar anchor.
- **The swing clock.** The player has a long eased return tail (`wf < sf < hf < 1`). An enemy's staged action has none, so it samples with `sf = wf, hf = 1` (rise to the windup, then hold the strike pose).

## Performance

Everything on the per-frame path (`fourPhaseLerp`, `samplePose`, `sampleLegacyThrust`) writes into a caller-owned sample object and module scratch — no per-frame objects or closures. `EnemyWeaponStances` bakes each enemy's stance pose once per attack (cached on the entity, revalidated against the live stance values, the attack's pose/power/sign and the action identity) instead of rebuilding about a dozen objects per enemy per frame.

## Not yet shared

- The attack-animation editor (`docs/tools/attack-animation-editor/index.html`) still has its own `poseAt()` / `lerpPose()` / `STYLE_NEUTRAL_POSE`. It could load this module; `scripts/test-shared-attack-pose.js` pins the semantics it must keep matching.
- Enemies do not get the player's dual-wield / secondary-grip *Neutral* decoration (`weapon-tool-stances.js`); they do honor authored hand-grip flags on Windup/Strike.

Tests: `node scripts/run-tests.js shared-attack-pose enemy-weapon-stances`.
