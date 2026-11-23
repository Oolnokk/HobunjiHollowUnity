# Character spine and per-species neck bend

`docs/js/character-spine.js` (`window.HobunjiCharacterSpine`) provides the seven-node portrait spine for static hunch, sway and kyphosis. A hunch is authored per NPC or enemy; the bend position is **not** authored as a fixed proportion of character height.

## Pixel-anchored head/neck transition

The portrait builders render each species' **base head sprite alone** into a full-size transparent canvas. `PNGPlaneAvatar.detectHeadRigPixels` uses the last alpha-visible pixel of that canvas as the neck bend's **upper edge**, irrespective of the species' head placement. The pivot is expressed in plane-local coordinates, with X taken from the head's alpha centroid. Only when head art is absent/unreadable does the existing full-portrait fallback apply.

`PNGPlaneAvatar.neckBlendBand` positions the **lower edge** only **two or three source portrait pixels** below the top, capped even for high-resolution sprites. Head-turn weight is fully 1 above the top, smoothsteps from 1 to 0 within that short strip, and is 0 below it. The independently scaled head bone uses that same vertical strip; `tight`, `legacy` and `mask` head gates continue to determine **horizontal** head-size influence.

**Head placement is intentionally separate from rotation, but the intervening portrait is skinned to the spine.** The normal game and hostile 10-bone skin now weights the entire body below the short neck band to the seven spline nodes (0–6). The nonrotating `headOffsetJoint` (7) connects the spine's top node to the head-turn joint (8) and head-scale joint (9), **only 2.5 original source pixels above the final spine node at rest**. It must never own a huge region of the torso. The former `headOffsetWeightAt` fade over ~24% of portrait height is deliberately *not* used by this ten-bone skin anymore; the legacy Animation Author three-bone portrait still has that fallback, without the shared seven-node spline.

The Head slider and authored head height, including Mashtzarr and Longoran offsets, are resolved **after head scaling and before hunch**. The 10-bone head-scale joint hangs off the neck joint, so it scales the head **about the chin**: head size never moves the chin and never stretches the spine. Only the authored head height (`offsetY`) is spread along the spine nodes by `HobunjiCharacterSpine.applyNeckReach`. (An earlier revision also added a centroid-based chin delta here; Full Character Scale screenshots showed it lifting 200%-height Longoran heads by ~8% of their height with a stretched, empty torso. The centroid formula `scaledNeckAdjustment` now only feeds the legacy three-bone author rig.) Applying hunch then bends the already extended/compressed spine. The tiny head-offset bone stays at its original source-pixel length while the rest of the portrait bridges the distance; impossible extreme negative offsets are clamped before the spine can invert. Reapplying sliders starts from each bone's original rest transform rather than accumulating drift.

The geometry does not gain more triangles: `neckBlendRows` redistributes existing vertical mesh rows so the short transition still has top, middle and bottom vertices. UVs follow the moved rows, preserving the authored PNG, with the editor and game sharing the identical calculation. Both `resolveSkinnedPixelWorldPosition` and its `portrait-plane-outline-parity.js` wrapper use the same weights as the GPU for head/hand/shoulder-pet attachment landmarks. The spine projection also reads the same band height for shoulder/weapon pose calculations, including hostile front/back skins.

The **spine's top node** and the **head-turn pivot** remain distinct but **almost touch** in the rest pose. The spine runs from the posterior all the way to 2.5 source pixels under the base-head bottom. The last spine node no longer stops at the midpoint of the hand-shoulder anchors: that older endpoint created the giant false neck. Hand-shoulder and hip anchors are still authored independently and remain untouched as source data. In particular, `shoulderLocal` preserves the authored shoulder Y for held items and weapon-orbit projections while `neckBaseLocal` defines the separate, skull-high skin endpoint; an un-hunched spine stretched by head scaling still carries an active shoulder projection. Full Character Scale shows the actual selected-character spine and cyan head/neck endpoint, with a toggle; guides are created lazily and disposed when no longer selected.

## Hunch sources

| Who | Where hunch lives |
| --- | --- |
| NPCs | NPC database `appearance.aging.hunch`; explicit `appearance.spine` or `spine` wins |
| Enemies | `docs/config/combat/enemy-loadouts.json` `spine: { "hunch": 0..1 }` (Enemy Loadout Workshop) |

`HobunjiCharacterSpine.profileFor` returns the curve, shoulder drop, stance and stride multipliers. It reads the model's active geometry `blendHeight` when projecting anchors, so lowering NPC portrait mesh density cannot silently make the shoulders use an older neck band.

## Mobile diagnostics and regression

The Multi-Avatar Animation Author inspector displays each portrait's base-head bend top and bottom in source pixels. The Attack Animation Editor defaults to a narrow 1.2% neck-radius preview; its radius slider is a **diagnostic override only**. Normal gameplay always derives the bend from the actual head sprite.

Use `node scripts/run-tests.js humanoid-neck-band humanoid-neck-offset-geometry animation-author-portrait-mesh-controls head-centroid-skinning skinned-pixel-output head-gate character-rig-scale character-spine hostile-presentation` for targeted checks. Tests cover distinct head positions, correct GPU/CPU landmark parity, adaptive neck rows, and short head scaling.

## Full Character Scale lineup (Nov 22 visual pass)

Verified with headless screenshots against `main`: the lineup uses the **gameplay orientation** (portrait front, toes and Longoran hunch all face +Z toward its camera) and attaches the same **pants** gameplay NPCs wear (`PantsGarmentRenderer.attachToLegs`), so Leg length is judged with the hip-to-foot span covered. Species defaults may author `legLength` separately from portrait height (`docs/config/character-rig-scale-defaults.js`). Keep `head / x` at about 0.94 or more: the 2–3px neck band shows a hard collar step when the head-scale gate narrows hood/collar art much more than the body below it.
