# Character spine and per-species neck bend

`docs/js/character-spine.js` (`window.HobunjiCharacterSpine`) provides the seven-node portrait spine for static hunch, sway and kyphosis. A hunch is authored per NPC or enemy; the bend position is **not** authored as a fixed proportion of character height.

## Pixel-anchored head/neck transition

The portrait builders render each species' **base head sprite alone** into a full-size transparent canvas. `PNGPlaneAvatar.detectHeadRigPixels` uses the last alpha-visible pixel of that canvas as the physical neck joint's **pivot**, irrespective of the species' head placement. The pivot is expressed in plane-local coordinates, with X taken from the head's alpha centroid. Only when head art is absent/unreadable does the existing full-portrait fallback apply.

The physical joint remains at the bottom of the base-head PNG, with the spine tip only 2.5 source pixels below it. The visual influence is independent: the restored pre-merge 30%-of-portrait-height smoothstep begins 16.5% below the pivot and reaches full rotation 13.5% above it. The independent horizontal head-scale gates again use the original wide/tight falloffs (20%/6%) and painted head masks. The remaining weight belongs to the two neighboring real spline nodes, not an oversized placement-only bone. The existing 10-bone hierarchy and head-height reach solver are unchanged.

The Head slider and authored head height, including Mashtzarr and Longoran offsets, are resolved **after head scaling and before hunch**. The 10-bone head-scale joint hangs off the neck joint, so it scales the head **about the chin**: head size never moves the chin and never stretches the spine. Only the authored head height (`offsetY`) is spread along the spine nodes by `HobunjiCharacterSpine.applyNeckReach`. (An earlier revision also added a centroid-based chin delta here; Full Character Scale screenshots showed it lifting 200%-height Longoran heads by ~8% of their height with a stretched, empty torso. The centroid formula `scaledNeckAdjustment` now only feeds the legacy three-bone author rig.) Applying hunch then bends the already extended/compressed spine. The tiny head-offset bone stays at its original source-pixel length while the rest of the portrait bridges the distance; impossible extreme negative offsets are clamped before the spine can invert. Reapplying sliders starts from each bone's original rest transform rather than accumulating drift.

The geometry does not gain more triangles: `neckBlendRows` redistributes existing vertical mesh rows so the broad transition has proportionate sampling and retains its midpoint. UVs follow the moved rows, preserving the authored PNG, with the editor and game sharing the identical calculation. The single `resolveSkinnedPixelWorldPosition` resolver samples the actual GPU-skinned triangle (three posed vertices, barycentric interpolation) for head/hand/shoulder-pet attachment landmarks. The spine projection also reads the same band height for shoulder/weapon pose calculations, including hostile front/back skins.

The **spine's top node** and the **head-turn pivot** remain distinct but **almost touch** in the rest pose. The spine runs from the posterior all the way to 2.5 source pixels under the base-head bottom. The last spine node no longer stops at the midpoint of the hand-shoulder anchors: that older endpoint created the giant false neck. Hand-shoulder and hip anchors are still authored independently and remain untouched as source data. In particular, `shoulderLocal` preserves the authored shoulder Y for held items and weapon-orbit projections while `neckBaseLocal` defines the separate, skull-high skin endpoint; an un-hunched spine stretched by head scaling still carries an active shoulder projection. Full Character Scale shows the actual selected-character spine and cyan head/neck endpoint, with a toggle; guides are created lazily and disposed when no longer selected.

## Hunch sources

| Who | Where hunch lives |
| --- | --- |
| NPCs | NPC database `appearance.aging.hunch`; explicit `appearance.spine` or `spine` wins |
| Enemies | `docs/config/combat/enemy-loadouts.json` `spine: { "hunch": 0..1 }` (Enemy Loadout Workshop) |

`HobunjiCharacterSpine.profileFor` returns the curve, shoulder drop, stance and stride multipliers. It reads the model's active geometry `blendHeight` when projecting anchors, so lowering NPC portrait mesh density cannot silently make the shoulders use an older neck band.

## Mobile diagnostics and regression

The Multi-Avatar Animation Author inspector displays each portrait's base-head bend top and bottom in source pixels. The Attack Animation Editor defaults to the restored 30% neck-radius preview; its radius slider is a **diagnostic override only**. Normal gameplay anchors the broad blend at the actual head sprite.

Use `node scripts/run-tests.js humanoid-neck-band humanoid-neck-offset-geometry animation-author-portrait-mesh-controls head-centroid-skinning skinned-pixel-output head-gate character-rig-scale character-spine hostile-presentation` for targeted checks. Tests cover distinct head positions, correct GPU/CPU landmark parity, adaptive neck rows, and independent head scaling.

## Full Character Scale lineup (Nov 22 visual pass)

Verified with headless screenshots against `main`: the lineup uses the **gameplay orientation** (portrait front, toes and Longoran hunch all face +Z toward its camera) and attaches the same **pants** gameplay NPCs wear (`PantsGarmentRenderer.attachToLegs`), so Leg length is judged with the hip-to-foot span covered. Species defaults may author `legLength` separately from portrait height (`docs/config/character-rig-scale-defaults.js`). The restored broader scale falloff reduces the hard collar step that occurred with the earlier 2–3px influence strip.

The Attack Animation Editor diagnostic radius uses the same pivot-centered curve at all slider positions. The Animation Author inspector reports the physical joint pixel independently of the blend boundaries. Geometry density rebuilds retain normalized row coordinates for exact attachment sampling; legacy rigs without this metadata retain the analytic fallback.

The multi-actor author's neck pivot now comes from the same alpha centroid and last opaque base-head row as gameplay, rather than its former independent bottom-row X estimate. Attachment vectors and frames can be constructed from the live mesh when Three is imported as an ES module.
