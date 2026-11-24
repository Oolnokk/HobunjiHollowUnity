# Visual authoring invariants — REQUIRED reading

> **Mandatory for every coding agent:** Read this document **before** creating, editing, importing, recoloring, rendering, or optimizing furniture, props, meshes, terrain, architecture, avatar/body parts, billboards, particle effects, fireplaces, sconces, or any other fire. It applies to **existing assets and code**, not just new additions. Do not infer an outline policy from one nearby renderer; classify the actual visible surface first.
>
> See [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md). These requirements are project-wide unless the user explicitly changes them.

## 2D beard / front-hood arbitration

Authored with `docs/tools/beard-hood-cutout/` (Tools hub → Assets → Beard + Hood Cutout); runtime owner is `docs/js/beard-hood-cutout.js` (`window.PortraitBeardHoodCutout`), consumed by the shared portrait compositor in `docs/js/portrait-utils.js`. Every page that loads `portrait-utils.js` must load `beard-hood-cutout.js` first so tool previews match gameplay.

The portrait remains authored 2D artwork. Do **not** introduce a 3D beard, head rig, new X-ray layer, or extra portrait silhouette planes for beard/hood interactions.

- Facial-hair cosmetics may author `hoodCutoutMask` (200×200 run-length encoded pixels) requesting removal of front-hood pixels. A hood cosmetic may independently author `beardCutoutAllowedMask` in the same logical portrait coordinates.
- A **missing** hood permission mask is backward-compatible: beard requests may remove any occupied front-hood pixel. An explicit **empty** mask protects all front-hood pixels. Painted partial masks permit only marked hood pixels to be removed.
- At each valid overlap, permission granted means erase the **front hood** there. Permission refused means erase the **beard pixel** instead. Transparent hood pixels are never considered conflicts, and hoods tagged `hides-facial-hair` retain complete beard hiding. Rear hood art is unaffected.
- Black 1-pixel 8-neighbor cut-edge outlines are drawn **inward** onto surviving non-black opaque beard pixels touching fresh rejected pixels; never repaint existing black outlines, uncut beard areas, or refused/transparent pixels. This avoids dark halos and keeps the line visible in front of intact cloth.
- Work on separately reused beard/front-hood 2D scratch canvases; only composite those results at their original rendering stages. Hood permissions follow the existing tuft-root warp. Never apply an eraser to the entire portrait (eyes, skin, masks, and headwear must remain intact).
- Per-species variant permission masks are legal, and the 2D editor exports **full, separate beard and hood cosmetic JSONs**. The editor is an approximate static preview of tinted/animated runtime art; inspect the gameplay portrait before merging.

## 1. The character's four visual components

A humanoid visual is **not one 3D character mesh**. Its basic visible pieces are:

| Component | How it is drawn | Outline authority |
| --- | --- | --- |
| **Portrait** | A PNG plane depicting the **head, torso, and shoulders together** | **Black outlines are already painted in the PNG**; never generate a second outline |
| **Pants / legs** | A separate authored PNG plane | **Black outlines are already painted in the PNG**; never generate a second outline |
| **Feet** | Real procedural / modeled **3D** geometry | **Generated 3D outlines required** around genuinely curved surfaces |
| **Hands** | Real procedural / modeled **3D** geometry | **Generated 3D outlines required** around genuinely curved surfaces |

Do not call the portrait a 3D head, independently outline its head/shoulders, or try to outline the pant silhouettes again. The hands/feet should keep their world-space poses and render/occlusion rules while their own generated outlines follow their geometry. **X-ray/depth occlusion of PNG planes is not permission to draw additional visible outlines.** An occlusion-only depth replay is distinct from a generated stroke.

The same principle applies to animals, shoulder pets, tools, and other composite sprites: classify each **visible component**, not just the parent group. A 3D body part is not a billboard merely because an associated sprite or texture exists.

## 2. One outlined PNG per detected hard-edged surface

The **farm cliff surface-texturing technique** is the standard for **all meshes/surfaces without curved edges**, not only farm cliffs:

1. Use the **actual mesh topology**, connected faces, angles, and recognized surface boundaries to detect meaningful individual surfaces; do not assume a mesh is one flat rectangle or use fixed-distance UV tiles as a substitute.
2. Give **each detected hard-edged/faceted surface** one complete authored PNG treatment. Project/unwrap that surface into its own UV domain, with a **stretch-to-fit** mapping that reaches its actual perimeter, including irregular edges.
3. Use a PNG authored with **black ink around the perimeter of the artwork**. The texture, not a generated inverted shell or post-process edge, supplies the visible silhouette/edge ink. Preserve edge band thickness where possible instead of infinitely stretching the ink on oversized faces.
4. Separate adjoining faces at real geometric surface boundaries so the PNG border can trace each face appropriately. Avoid broken UV triangles, repeat-tiled fragments, seams, double-ink, and z-fighting between overlaid skins and the original geometry.
5. **Disable generated 3D outlines** (including shell-layer membership) on these texture-outlined, hard-edged meshes. Never add a shell as a fallback for an unoutlined texture: fix the PNG/UV assignment instead.

This includes faceted rock/cliffs, walls, pillars, slabs, beams, furniture boxes and all other **non-curved-edge** parts. Treat material/geometry assemblies per surface, not per entire object. A piece can contain both faceted surfaces (texture edges) and smooth/curved components (generated outlines).

**Existing implementation:** `docs/js/surface-stretch-uv-furniture.js` provides `window.HobunjiSurfaceStretchUV` (surface recognition, edge-preserving stretch/unwrap). `docs/js/natural-surface-materials.js`, `docs/js/natural-surface-stretch-runtime.js`, `docs/js/farm-cliff-rock-outline.js`, `docs/js/faceted-natural-surface-shell-reduction.js`, and `docs/js/faceted-structure-shell-reduction.js` already implement parts of the texture and outline policy. For a loose hard-edged stone mesh, `FacetedRocks.surfaceStone(mesh, { tint })` (`docs/js/faceted-rocks.js`) applies the farm rocks' exact treatment in one call (ore rocks and statue ruin debris use it). How each pass draws these meshes, and the debug captures that show it, are in [visual-render-pipeline.md](visual-render-pipeline.md). Reuse these authorities rather than adding another surface mapper or indiscriminate outline pass. The farm's cliff skin also removes coplanar duplicate base triangles; preserve that protection.

## 3. Curved 3D geometry uses generated outlines

**Genuine curved edges/rounded silhouettes require generated 3D outlines.** Examples: a 3D tree trunk or curved branch, procedural 3D hands and feet, and other organically rounded modeled surfaces. Do not try to use a stretched square texture border as a substitute for outlining a curved 3D silhouette. Preserve contour continuity through animation and deformation.

A low-poly **faceted** rock/wall and a genuinely **rounded** stone are different cases. Check the geometry, not merely the asset name, material name, primitive constructor, or category. When an object mixes curved and flat parts, make the decision separately per component. Avoid depth-outline/post-process passes that re-introduce redundant visible ink over the texture-outlined part.

## 4. PNG billboards NEVER receive generated outlines

**Across the entire game, a PNG billboard/portrait/sprite/plane uses its authored alpha and black-ink pixels.** It must **not** participate in a generated visible outline shell, depth-edge stroke, or other extra outline pass. That includes character portrait/pants planes, foliage cards, prop sprites, placed decorative PNGs, held-item sprites, torch sprites, and any new billboard.

**Big hats.** A hat may extend past the 200×200 portrait square and past its own standard layer canvas. Never grow the portrait canvas for it: hitboxes, hand/foot anchors, grounding and head detection are all measured from the portrait. Instead (a) a hat PNG may be padded beyond its standard canvas, with `image.frame` / `behindImage.frame` `{x, y, width, height}` giving where the standard canvas sits inside it (the clothing fitter writes this when a fit spills over), and (b) `docs/js/hat-overflow-plane.js` puts the hat pixels that fall outside the square on a separate front/back plane pair on the head bone — no outline, empty bounds, no raycast. Portrait textures clamp (`ClampToEdgeWrapping`), so art touching one edge never bleeds onto the other.

Prefer `window.HobunjiSpritePngSurface` in `docs/js/portrait-utils.js` for PNG material/alpha behavior (see AGENTS.md). Transparent pixels are not 3D curved edges. Preserve legitimate depth-test/x-ray **occlusion** and camera-layer behavior, but never use an occlusion replay as an excuse to add a visible outline around already inked PNG art.

## 5. One source of truth for ALL fire VFX

**Every visible fire/flame effect must use the same authored particle-emitter VFX used by player-built campfires.** No independently invented flame meshes, cones, gradient sprites, custom candle-tip flame simulators, or incompatible hardcoded flame particle algorithms.

- **Source asset:** `docs/config/furniture-authored/campfire.json`, especially its `particleEmitters` with `type: "fire"`. The actual player-built campfire in `docs/js/wilderness-campfire.js` loads this asset and calls `AuthoredFurniture.createEmitterVisual`.
- **Renderer:** `window.AuthoredFurniture.createEmitterVisual` in `docs/js/authored-furniture-runtime.js`. Reuse the source definition and renderer for sconces, hearths, candles, wall torches, bonfires, dungeon/elemental fire, burning afflictions, flasks, and world/ruin flames, as applicable.
- **Permitted customization:** clone the source emitter per instance and **recolor `colorA` / `colorB`** for themes/elements. Scale/reposition flames to fit a small candle vs. a big bonfire, and batch many emit origins for performance, but retain the authored fire behavior, visual language, and core particle system. These are size/placement adaptations, **not** authorization for a different flame style.
- Preserve gameplay-specific hit volumes, ignition rules, and light sources independently from rendering. Smoke or sparks can still be distinct non-fire effects; they do not justify a second flame renderer.
- Shared source definitions are immutable: never mutate the cached campfire JSON in place. Handle delayed loading and removal/disposal, and update only live emitters (avoid unnecessary per-frame work).

Existing shared reference: `docs/js/persistent-ground-fire.js` already clones the authored campfire flame and exposes `PersistentGroundFire.attachCampfireFlame(anchor, {scale, rateScale, colorA, colorB})`. Prefer this for independently attached fire when its lifecycle fits. `docs/js/interior-fire-floor-runtime.js` hosts the scheduler-owned ambient furniture VFX and should remain the only ambient update owner.

## 6. REQUIRED preflight and regression audit

Before **any visual-authoring task**, read this document, then inspect relevant existing implementations and classify every changed component:

| Check | Requirement |
| --- | --- |
| PNG portrait/pants/billboard | Authored outline, **no generated outline** |
| Hard-edged 3D face | Detected per-surface, outlined PNG stretched to perimeter, **no generated outline** |
| Curved 3D mesh | Appropriate generated outline, without double strokes from the material |
| Flame/fire | Campfire-authored emitter and renderer; only color/scale/placement adapted |
| Mixed asset | Check each child separately; do not toggle the entire group indiscriminately |
| Existing violations | **Fix them in the owning code/assets** as part of the task; do not leave an old rendering path inconsistent merely because it predates the guide |

When an existing asset fails, update its source/owner instead of stacking a new runtime wrapper. Do not assume previous outline suppressors solved every asset. Recheck the live rendered result, including sprites that turn, deform, get occluded, or exist in other zones. Ensure the GPU/CPU cost stays acceptable (batch repeated visual effects, keep culling correct, and avoid unnecessary scene traversals). Include a mobile-visible debug snapshot or reuse Pixel Probe where diagnostic feedback is needed.

**Verification:** test both sides of mixed avatars (including animated hands/feet) and representative faceted vs. curved props, inspect hard-edge texture alignment at corners, ensure no outline returns through later render hooks, compare non-player fires side by side with a placed campfire, run relevant Node tests and the repository's cache-bust checker, and report any unverified existing classes explicitly. Documentation compliance is not runtime proof.
