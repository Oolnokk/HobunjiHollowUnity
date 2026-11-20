# Character spine and per-species neck bend

`docs/js/character-spine.js` (`window.HobunjiCharacterSpine`) provides the seven-node portrait spine for static hunch, sway and kyphosis. A hunch is authored per NPC or enemy; the bend position is **not** authored as a fixed proportion of character height.

## Pixel-anchored head/neck transition

The portrait builders render each species' **base head sprite alone** into a full-size transparent canvas. `PNGPlaneAvatar.detectHeadRigPixels` uses the last alpha-visible pixel of that canvas as the neck bend's **upper edge**, irrespective of the species' head placement. The pivot is expressed in plane-local coordinates, with X taken from the head's alpha centroid. Only when head art is absent/unreadable does the existing full-portrait fallback apply.

`PNGPlaneAvatar.neckBlendBand` positions the **lower edge** only **two or three source portrait pixels** below the top, capped even for high-resolution sprites. Head-turn weight is fully 1 above the top, smoothsteps from 1 to 0 within that short strip, and is 0 below it. The independently scaled head bone uses that same vertical strip; `tight`, `legacy` and `mask` head gates continue to determine **horizontal** head-size influence.

**Head placement is intentionally separate from rotation.** A nonrotating `headOffsetJoint` sits between the spine's top node and `neckJoint` (which still owns pitch/yaw and the child `headScaleJoint`). Existing species offsets, e.g. Mashtzarr −9.5% or Longoran −5.5%, move `headOffsetJoint`, not `headScaleJoint`; `headOffsetWeightAt` fades that placement over ~24% of portrait height below the neck, avoiding the inverted skin triangles that would arise from squeezing large offsets into two pixels. The wide **offset-only** transition cannot rotate the torso or widen the neck bend. Hostiles use the same structure for both portrait faces, and the Animation Author uses a corresponding three-bone version. Headtaker pulling/recovery offsets also use the placement bone.

The geometry does not gain more triangles: `neckBlendRows` redistributes existing vertical mesh rows so the short transition still has top, middle and bottom vertices. UVs follow the moved rows, preserving the authored PNG, with the editor and game sharing the identical calculation. Both `resolveSkinnedPixelWorldPosition` and its `portrait-plane-outline-parity.js` wrapper use the same weights as the GPU for head/hand/shoulder-pet attachment landmarks. The spine projection also reads the same band height for shoulder/weapon pose calculations, including hostile front/back skins.

The **spine's top node** and the **head-turn pivot** are distinct. The spine runs from the posterior to the authored shoulder-neck base; the head-turn bone hangs from that final node at an offset that places it at the last base-head pixel. Moving the bend does not change the authored hip, shoulder, or hand anchors.

## Hunch sources

| Who | Where hunch lives |
| --- | --- |
| NPCs | NPC database `appearance.aging.hunch`; explicit `appearance.spine` or `spine` wins |
| Enemies | `docs/config/combat/enemy-loadouts.json` `spine: { "hunch": 0..1 }` (Enemy Loadout Workshop) |

`HobunjiCharacterSpine.profileFor` returns the curve, shoulder drop, stance and stride multipliers. It reads the model's active geometry `blendHeight` when projecting anchors, so lowering NPC portrait mesh density cannot silently make the shoulders use an older neck band.

## Mobile diagnostics and regression

The Multi-Avatar Animation Author inspector displays each portrait's base-head bend top and bottom in source pixels. The Attack Animation Editor defaults to a narrow 1.2% neck-radius preview; its radius slider is a **diagnostic override only**. Normal gameplay always derives the bend from the actual head sprite.

Use `node scripts/run-tests.js humanoid-neck-band humanoid-neck-offset-geometry animation-author-portrait-mesh-controls head-centroid-skinning skinned-pixel-output head-gate character-rig-scale character-spine hostile-presentation` for targeted checks. Tests cover distinct head positions, correct GPU/CPU landmark parity, adaptive neck rows, and short head scaling.
