# Character spine (static hunchback)

`docs/js/character-spine.js` (`window.HobunjiCharacterSpine`) gives a portrait avatar a fixed hunchback. There is no live animation: one `hunch` value (0 = upright, 1 = fully stooped) is read when the character is built and every rig layer derives its own offset from it.

## Data sources

| Who | Where the hunch lives |
| --- | --- |
| NPCs | The NPC database's `appearance.aging.hunch` (the same field that already lowered the head). An explicit `appearance.spine` / `spine` on the profile or record wins. |
| Enemies | `docs/config/combat/enemy-loadouts.json` rule `spine: { "hunch": 0..1 }`, authored in the Enemy Loadout Workshop ("Spine hunch (%)"). Shipped: both skeletons and the three Maskbound troops. |

`EnemyLoadoutRules.spineFor(kind)` reads the rule; `makeBanditEntity` puts it on the roster (`roster.spine`) so every path that rebuilds from the roster (rehydration, loot) keeps it.

## What it moves

`HobunjiCharacterSpine.profileFor(hunch)` returns the numbers; drops are fractions of the avatar's own unscaled model height (the unit of `headOffsetY`), so they ride the whole-rig scale.

| Layer | Field | Consumer |
| --- | --- | --- |
| Neck / head | `neckDrop` (= `HobunjiCharacterRigScale.ageHunchFraction`) | NPCs: `character-rig-scale.js` via `ageFor`; enemies: `applyAuthoredHostileRigScale` offsetY in `combat-bandit.js` |
| Shoulders | `shoulderDrop` (60% of the neck drop) | `procedural-hand-shoulder-aim.js` `shoulderInParent`, reads `avatarRoot.userData.hobunjiSpine` live |
| Attack orbit centre | `orbitDrop` (60% of the neck drop) | `HobunjiSpeciesPoseScale.transformPosePoint` option `orbitDropY` (world units, from `orbitDropWorld`), passed by the enemy melee swing, enemy ranged hold and watchman NPC held weapons |
| Feet | `stanceScale` (up to ×1.5 foot X) | `ProceduralLegAnimation.attach` option `spine`; hips, rest stance and pants follow the idle X |
| Stride | `strideScale` (up to ×1.3) | same option; scales `fullStride` in the gait |

Not moved: the portrait's own shoulder/collar pixels. The portrait is a flat PNG, so the stoop is carried by the head bone, the arm anchors, the weapon orbit and the legs, not by deforming the torso.

Tune the five ratios at the top of `character-spine.js`; tests: `node scripts/run-tests.js character-spine`.
