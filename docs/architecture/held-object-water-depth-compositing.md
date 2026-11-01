# Held objects, ground x-ray, and translucent water: rendering contract

> **Regression warning (farm flood, October 19, 2026):** Do not move the
> **colorless opaque-grass/path depth restore** after the water/slush tint
> pass. Doing so reintroduces irregular teal floodwater patches over raised
> grass, even if both the grass and water materials use `depthTest: true`.
> This bug occurred when the later held-object/submersion compositor changed
> depth-pass ordering after an earlier rendering fix. The user reproduced the
> problem with Painterly **Off** and confirmed that moving the depth restore
> **before** translucent tint eliminated it.

## Source of truth

- **Compositor:** `docs/js/held-object-render-order.js` — wraps
  `THREE.WebGLRenderer.prototype.render`, classifies meshes, owns depth
  reconstruction, stencil, translucent tint, temporary camera layers, culling
  and scissor.
- **Gameplay orchestration:** `docs/game.js` — renders the base world to
  the game render target, then optionally applies the fullscreen
  outline/painterly composite. The selective compositor runs on the genuine
  world render, not arbitrary auxiliary/render-target passes.
- **Flood and local surface construction:** `docs/js/water-system.js` and
  `docs/js/merged-water-renderer.js`. The merged water shader has
  `transparent: true`, `depthTest: true`, `depthWrite: false`; flood
  planes have `waterSurfaceRole: 'flood'` and `renderOrder: -10`.
- **Ground identification:** `docs/js/terrain-tile-materials.js` tags
  base-grass materials with `hobunjiBaseGrassTerrainMaterial`. Authored
  paths use `hobunjiPathSurface`; terrain/cover meshes have separate tags.
- **Diagnostics:** `docs/js/pixel-probe.js` and
  `window.HeldObjectRenderOrder.snapshot()`.
- **Regression guard:** `scripts/test-town-render-hotpaths.js`.
  This checks compositor stage order, ground color suppression, material
  handling, classification, and the two actual flood-probe distances.
  It is not a GPU screenshot regression.

## Physical carryables must stay out of the weapon PNG replay

`isLegacyHeldPlane()` treats a rigid mesh with `renderOrder: 1.5` as a
weapon/tool PNG and permanently registers it for the later selective replay.
That value is a classification marker, not merely a convenient draw order.
Using it for a carried Shattercask hides the cask from the ordinary world
colour pass and redraws it over the carrier's already-rendered rear portrait.
Disabling the cask's depth writes or raising the rear portrait's draw order
cannot fix ordering across those separate passes.

Shattercask parts use `CARRIED_VESSEL_RENDER_ORDER` (1.4) instead. Their
normal colour draw leaves depth writes off only while held, allowing the
back-only portrait pass to draw over the vessel while still testing against
world geometry. Drop/launch restores the original material and draw order.
Do not opt these physical parts into `markHeldPlane()` or the reserved 1.5
marker. `scripts/test-shattercasks.js` executes the production classifier
against the held parts and tests the filled, terrain-projected blast preview.

## Head-relative tools

Head-relative (mouth-anchored) tools now draw alongside ordinary held equipment
in stage 2, without any owner-backplane stencil mask or extra weapon overlay.
They retain regular scene-depth occlusion and the same water/slush tint treatment
as other held gear. Attack Animation Editor previews likewise draw the tool once
with the normal renderer; head-based attachment and positioning are unchanged.

## Why the compositor exists

The game renders many avatars and items as PNG planes and combines them
with genuine 3D feet/hands, terrain, props and water. A held weapon or hand
should not disappear under the **base grass or an authored path** just because
the camera is low to the ground. It *must* still be hidden by actual geometry
such as walls, furniture, rocks, snow, and standing grass billboards.

Translucent **water and slush are a third case**: they should neither
fully hide held weapons/feet nor be ignored. When the water surface is
in front of the relevant object, blend its **original water shader/animated
texture or slush alpha** over the truly submerged part of the held object,
hand or procedural foot. When the surface is *behind* the object, do not
tint it. Opaque snow still occludes.

A normal transparent water material does **not** write scene depth.
Consequently, the game reconstructs depth for selected meshes before
redrawing their colors. This is deliberately different from changing a
material's `renderOrder`, disabling `depthTest`, or giving everything
a depth-writing water material: those shortcuts break at least one of
world occlusion, underwater tint, or avatar ordering.

## The non-negotiable pass order

`wrappedRender` in `held-object-render-order.js` first collects the
current scene's `held`, `feet`, `ground`, `topFaceGround`, and
`tintCovers`. It hides the selected held/foot meshes for the **ordinary
world color pass**, then invokes `replaySelectiveHeldOverlay`.

The replay order is:

| Order | Operation | Color | Depth / stencil |
| --- | --- | --- | --- |
| 1 | Clear depth; replay real solid occluders while hiding selected **base grass/paths**, held/foot meshes, and (when tinting) water/slush covers | **Unchanged** | Rebuild solid depth. Force suitable alpha-cutout occluders to write depth while preserving their silhouettes |
| 2 | Draw registered held objects, hands and procedural feet | **Draw once** | In tint mode, temporarily require `depthTest: true` and `depthWrite: true`, and stamp **stencil bit 0** on visible fragments |
| **3 — critical** | **Restore base grass/path depth via `GROUND_REPLAY_LAYER`** | **None** (`colorWrite: false`) | Reintroduce the real foreground grass depth **BEFORE** sampling/translucently drawing water |
| 4 | Replay water/slush via `WATER_REPLAY_LAYER` using their original translucent materials | **Blend tint once** | `depthTest: true`, `depthWrite: false`, stencil must equal bit 0. Both depth **and** stencil must pass |
| 5 | Replay the water/slush surface **depth only** | **None** | `depthWrite: true`, `colorWrite: false`; do not apply the water color a second time |
| 6 | Restore renderer state | **Unchanged** | Restore material flags, visibility, camera mask, scissor, stencil, clears, shadow/scene settings |

**Rule:** `groundDepthRestoreAt < tintAt < coverDepthAt`, and
`heldDrawAt < groundDepthRestoreAt`. The overlay colors are already
drawn when the grass depth returns, so a colorless restore does not erase
them. It *does* make water behind elevated grass fail its subsequent
depth test. Conversely, if water genuinely lies **in front** of the grass
and held geometry, it remains eligible to tint the stencil-marked pixels.

The stencil mask is a *which pixels belong to the held/foot overlay?*
test, **not** a substitute for the depth buffer's *which surface is
actually in front?* test. Do not run a translucent cover pass while the
depth of foreground opaque ground is still missing.

The overlay's normal x-ray exemption is intentionally narrow:
`groundKind` exempts authored paths and **tagged base-grass terrain**;
it also classifies explicitly tagged interior floors (farmhouse, authored, cavern walkable,
V50 ruin plateau, and rooted Stone Age) while preserving ordinary raised
geometry, cave walls, snow/slush caps, water, and grass billboards as
occluders. Carved cave shells are never removed wholesale: only upward-facing
floor triangles are omitted from their depth-reconstruction geometry;
their vertical walls and ceiling still write depth.
The screen-space scissor, per-scene registries, and conservative cover/
overlay overlap check limit the cost. Near-plane/uncertain geometry can
fall back to the full tint path. Framebuffers with no usable stencil
keep conservative cover occlusion rather than painting unsupported
partial tint.

## Shell outlines inherit the source object's ground-x-ray visibility

The inverted-hull shell pass is a separate render from the visible object draw.
Without an explicit parity step, the base mesh can correctly x-ray through
classified ground while its shell is still rejected by the ordinary ground
depth left in the framebuffer.

HeldObjectRenderOrder applies the same rule to both representations:

1. The normal layer-1 shell pass temporarily omits registered held/foot x-ray
   meshes, preventing a duplicate shell draw under ordinary ground depth.
2. A scissored replay clears depth only around those meshes and reconstructs
   solid depth while excluding the exact groundKind() set used by the
   visible held/foot x-ray. The source meshes remain in the depth replay (with
   depth writes temporarily enabled) so their front faces still mask the
   expanded shell. Snow, water, slush, furniture, rocks, walls and other
   non-ground occluders remain in this depth reconstruction. Carved
   cavern shells use their non-floor occluder geometry, so their walls and
   ceilings continue to block outlines.
3. Only the registered x-ray meshes' layer-1 shells are drawn against that
   reconstructed depth. Their shell therefore follows the same ground
   visibility exception as the underlying mesh without becoming visible
   through unrelated solid objects.
4. The ordinary scene depth is rebuilt colorlessly before later target and
   outline consumers run. The replay restores the camera mask, override
   material, visibility, geometry, scissor, shadow and renderer state.

This is deliberately tied to the shared x-ray participant registries and
ground classifier, rather than adding separate per-material or per-species
shell exceptions. When another object type joins the selective ground-x-ray
system, its registered shell automatically receives the same visibility
policy. The shell replay is limited to the projected bounds of the affected
objects when safe; skinned, instanced, morphed or near-plane-uncertain bounds
fall back to a full-frame replay.

## The confirmed regression: teal patches in raised flooded grass

Two Pixel Probes were captured on the **farm**, with Painterly **Off**.
The left point visibly leaked teal water; the right point was correctly
green. Both raycasts hit one and the same **`farm_flood_mesh`**, with
one and the same **`merged_textured_water_material`**.

| Probe | Final screen pixel | Opaque grass hit | Flood hit |
| --- | --- | --- | --- |
| Leaking patch | `rgb(41,115,113)` | Distance `1.498`, Y `0.351` | Distance `1.908`, Y `0.084` |
| Correct grass | `rgb(39,96,25)` | Distance `1.673`, Y `0.340` | Distance `1.911`, Y `0.118` |

Both grass meshes reported an opaque `MeshBasicMaterial` with
`depthTest: true` and `depthWrite: true`. The flood's shader had
`depthTest: true` and `depthWrite: false`. The grass was **closer
along the ray** and **higher in world Y** in *both* cases. The player's
foot soles were above the flood, so this was not legitimate submersion.

This **did not support the hypothesis of two different water
materials**, nor the earlier hypothesis of painterly color bleeding.
A Pixel Probe reports mesh intersection/material state, not the identity
of the pass that ultimately wrote the final pixel. The important clue
was that *a later render pass can clear and reconstruct depth*, so
ordinary materials can be individually correct while the final picture
is still wrong.

The held/feet tint implementation had moved the grass-depth restore
after the water/slush replay. In the tint window, stencil-marked
pixels could pass a water depth test that lacked the nearer ground
surface. This matched the irregular leaked color. Moving the ground
restore before tint fixed the bug **in the user's live game**.

## How to avoid resurrecting it

Before changing water, terrain, outline postprocessing, held tools,
procedural hands/feet, depth textures or render-target setup:

1. **Read this contract and `replaySelectiveHeldOverlay`.** A new
   render pass must preserve the pass-order inequality above.
2. **Do not equate correct material flags with a correct depth buffer.**
   Track `clearDepth()`, temporary mesh hiding, current camera layers,
   stencil clearing, and the order of all later depth restorations.
3. **Do not treat base grass like permanent occlusion during the held
   draw**, but **do restore its depth before water tint**. Restoring its
   *color* at that point would bury the held sprites again.
4. **Do not disable water `depthTest` or force water's permanent
   `depthWrite: true` to fix transparency.** The original shader,
   geometry, water line, alpha, and pass-specific stencil/depth must
   determine the underwater appearance.
5. **Do not reintroduce a second held-gear draw after tint.** It would
   overwrite the underwater coloration. Feet, hands and weapons are
   tinted as one selected overlay.
6. **Do not suppress water globally under all grass.** Genuine flood
   water above the grass must remain visible, and genuinely submerged
   items must remain tinted.
7. **Update regression checks** when changing the compositor. The test
   in `scripts/test-town-render-hotpaths.js` must require the actual
   source order `held draw -> ground depth restore -> water tint ->
   water depth restore`; it must not simply check that the functions
   exist or have desirable names.

## Reproduction and validation checklist

- In the **farm** with a visible flood sheet and elevated/raised grass,
  look for ragged teal patches on grass that is physically above water.
  Compare a leaking patch with adjacent correctly green grass.
- Repeat with **Painterly Off**. A bug remaining with Painterly Off is
  not caused by the optional painterly shader.
- Pixel Probe both points: compare exact final RGBA, **ray distance**
  (not just Y), `waterSurfaceRole`, mesh name, `renderOrder`,
  `depthTest`, `depthWrite`, and whether `Water depth at probed
  pixel: BEHIND OPAQUE SURFACE` is reported.
- Inspect `Held x-ray` in the Pixel Probe or
  `HeldObjectRenderOrder.snapshot()`: current stencil bits, overlay
  passes and ground-depth restores. Compare screen-scissor settings
  and camera angle if patches are localized.
- Also verify the **opposite** scenario: actual water/slush *in
  front of* animated feet, procedural hands, and an equipped weapon
  tints only submerged portions; snow and solid props still occlude.
- Run `node scripts/test-town-render-hotpaths.js` and the repository's
  full Regression suite. These guard against ordering/source regressions
  but do **not** prove the actual GPU pixels; the above live flood/
  submersion cases remain required visual checks.

## Related risks

- Render-to-texture auxiliary scenes and material-ID/outline passes
  are not gameplay's normal base world pass; do not trigger the entire
  selected overlay recursively for them.
- `prepareCutoutDepthMaterials` may temporarily force `depthWrite`
  so alphatested PNG occluders correctly block weapons. Restore original
  material state after each pass; a permanent mutation breaks other
  avatar/depth behavior.
- Depth-only operations must not accidentally recolor the framebuffer
  or redraw a transparent cover twice. Carefully preserve the original
  water/slush material and shader.
- A new translucent ground cover should be explicitly classified and
  included in the overlap/stencil/tint ordering; a new opaque ground
  cover must remain an occluder unless it is specifically intended to be
  the game's x-rayed **base** grass/path.
