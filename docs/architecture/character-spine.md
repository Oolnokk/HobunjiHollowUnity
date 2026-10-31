# Character spine (static hunchback)

`docs/js/character-spine.js` (`window.HobunjiCharacterSpine`) gives a portrait avatar a fixed hunchback. There is no live animation: one `hunch` value (0 = upright, 1 = fully stooped) is read when the character is built and every rig layer derives its own offset from it.

## Data sources

| Who | Where the hunch lives |
| --- | --- |
| NPCs | The NPC database's `appearance.aging.hunch` (the same field that already lowered the head). An explicit `appearance.spine` / `spine` on the profile or record wins. |
| Enemies | `docs/config/combat/enemy-loadouts.json` rule `spine: { "hunch": 0..1 }`, authored in the Enemy Loadout Workshop ("Spine hunch (%)"). Shipped: both skeletons and the three Maskbound troops. |

`EnemyLoadoutRules.spineFor(kind)` reads the rule; `makeBanditEntity` puts it on the roster (`roster.spine`) so every path that rebuilds from the roster (rehydration, loot) keeps it.

## What it moves

The portrait is a skinned plane (`png-plane-avatar.js`): torso → **spine** → neck → head-scale bones. Every skinned portrait carries the spine bone at identity; a hunch translates it down. Vertices are weighted to it by `HobunjiCharacterSpine.weightAt` — 0 below the waist, ramping to 1 just under the shoulders — so the PNG itself stoops: the torso compresses and the shoulders, neck and head ride down together. The head bone adds the remainder of the age-hunch head drop (spine + head = `HobunjiCharacterRigScale.ageHunchFraction`, so an NPC's authored head position is unchanged).

`HobunjiCharacterSpine.profileFor(hunch)` returns the numbers; drops are fractions of the avatar's own unscaled model height (the unit of `headOffsetY`), so they ride the whole-rig scale.

| Layer | Field | Consumer |
| --- | --- | --- |
| Portrait torso / shoulders / neck | `shoulderDrop` (70% of the total head drop) | spine bone in both skeleton builders (`buildSkinnedSinglePlaneAssembly`, `upgradePlaneToAutoNeckSkin`), weights in `buildSkinnedPlaneGeometry`; the pixel resolvers (`resolveSkinnedPixelWorldPosition`, `portrait-plane-outline-parity.js`) use the same weights |
| Head | `neckDrop` (the other 30%) | NPCs: `character-rig-scale.js` `applyHeadCompensation`; enemies: `applyAuthoredHostileRigScale` offsetY in `combat-bandit.js` |
| Shoulder anchors | `deformDrop` | `procedural-hand-shoulder-aim.js`: anchors keep their 2D portrait coordinates and are carried through the same deformation at their own height |
| Attack orbit centre | `orbitDrop` = `shoulderDrop` | `HobunjiSpeciesPoseScale.transformPosePoint` option `orbitDropY`: it moves precisely with the shoulders (enemy melee swing, enemy ranged hold, watchman held weapons) |
| Feet | `stanceScale` (up to ×1.5 foot X) | `ProceduralLegAnimation.attach` option `spine`; hips, rest stance and pants follow the idle X |
| Stride | `strideScale` (up to ×1.3) | same option; scales `fullStride` in the gait |

`character-spine.js` must load before `png-plane-avatar.js` (the skin weights are baked at build time); pages that don't load it get a normal upright portrait. The Enemy Loadout Workshop lists it in `preview.js`.

Tune the ratios and the waist/shoulder band at the top of `character-spine.js`; tests: `node scripts/run-tests.js character-spine`.
