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

- **Shared surface policy:** `docs/js/surface-occlusion-composer.js` —
  owns the canonical surface categories and reusable per-effect decisions.
  Held-object and shell-outline replay are the first consumers; other character
  x-ray effects should migrate to this same API rather than add local rules.
- **Compositor:** `docs/js/held-object-render-order.js` — wraps
  `THREE.WebGLRenderer.prototype.render`, owns depth reconstruction, stencil,
  translucent tint, temporary camera layers, culling and scissor.
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

## Front portrait cover of held weapons

The selective held-object compositor deliberately moves held PNG weapon color
out of the base world pass. Reconstructing opaque world depth alone is not
enough: a front-facing painted player/NPC portrait may have ordinary depth
behind its weapon even when the artwork should cover the weapon pixels.

`held-object-render-order.js` registers rigid front portraits and the
front material of skinned front/back portraits on private camera layer **24**.
Before any ground-exemption depth clear, it stamps visible front-art alpha
cutouts into stencil **bits 2–7 (0xFC)** within the held overlay scissor rectangle.
Each character with visible held PNG gear receives a unique per-frame stencil
owner ID. A weapon skips only pixels marked by **its own character's** front
art, rather than vanishing behind unrelated NPCs who are physically behind
it. Procedural hands, feet, rear portraits and ordinary physical carryables
keep their existing behavior. This reflects painted front layering rather
than physical weapon depth, for both player and NPC rigs.

The mask writes no depth or color. It respects normal foreground world
depth and the shared solid-pixel PNG alpha cutoff, and restores camera and
material state even when a render fails. Stencil bit 0 remains reserved
for water/slush tint and bit 1 belongs to the temporary floor reset; tinted held weapons both test the portrait bit and
write the existing tint bit without changing water passes. With fewer than
eight stencil bits available the extra mask is skipped, preserving the
original overlay behavior rather than risking tint or ground corruption.
Up to 63 distinct gear owners fit in one scissored mask draw per world frame;
additional owners fall back to ordinary held depth rather than masking a
different actor's weapon.
The existing renderer debug snapshot and mobile log expose
`frontPortraitMasks` and `frontPortraitMaskPasses`.

Nearby player and NPC portrait planes can intersect at oblique camera angles.
The base transparent draw sorts those actors by their root positions in camera
space and keeps the existing front, back and shoulder draw order within an
actor. **Pants wearers** retain their portrait's normal depth writes so their
pants, rendered immediately afterward, cannot show through the owner's
solid portrait pixels. Farther **pants-free** actors still temporarily defer
portrait depth writes when their sprites cross a closer actor's view:
otherwise a physically forward-leaning distant plane can suppress a nearer
actor's portrait despite the root-based painter order. This is a deliberate
tradeoff; a pants wearer whose sprite intersects another actor's plane may
still need a dedicated per-actor depth composite. Opaque world geometry
continues to depth-test normally; weapon stencils share the actor order.

## Worn pants use the feet's ground-x-ray policy

As of the scaled-foot grounding change, `feet.groundXray` defaults to `off` in Xray Hierarchy. Dry feet and pants remain in ordinary world and shell depth passes. Submerged local lower-body meshes may enter the existing water-only color compositor, explicitly forced into the ordinary-depth group with no terrain exemption. The legacy shared ground replay below is available only as a developer A/B comparison. Solid-cover depth remains authoritative.

Each live pants garment now registers with the existing selective feet replay through
`HeldObjectRenderOrder.markWaterOccludedMesh()`. This reuses the same local
same-elevation grass/road/walkable-floor exemption, actor/camera-distance
eligibility, and solid-cover and water/slush depth and tint behavior. Unworn,
unloaded or off-distance NPC garments remain on the normal world depth path.

The X-ray hierarchy configuration is **unchanged**: no global color priority
is raised. Pants still use their existing owner-portrait depth/alpha rules.
A conservative replay scissor margin covers GPU-deformed pants whose CPU
rest mesh bounds do not change while their legs animate. Pants are authored
PNG-art garments, so they do not acquire procedurally generated shell outlines.
The Dev Companion snapshot reports pants registrations separately.

## Shoulder pets are part of the owner's portrait occlusion

The observation pose selects the side of the owner where the animal draws.
The shoulder attachment resolves the authored orientation against the owner's
midline before picking the appropriate half-turn. The pet's two sprite cards
share one draw stage, so exposing a different card during the turn cannot
change who covers whom.

| Shoulder pet orientation | Looking at owner's front | Looking at owner's back |
| --- | --- | --- |
| Facing the owner's midline | Pet draws in front | Pet peeks out from behind |
| Facing away from the owner's midline | Pet peeks out from behind | Pet draws in front |

The visible owner portrait and pet share a depth-tested, depth-write-free
stack. Split pet and hat meshes follow their source stages, and opaque world
geometry still occludes the stack by physical depth.

The optional owner-front weapon stencil also includes the pet silhouette
when the pet is in front of the owner in the current view. Both pet cards
are eligible and the renderer culls the reverse side.

When the front-art masking rule is enabled, a shoulder pet makes the
owner's portrait stack depth-write-free, and the framebuffer has no usable
8-bit stencil, the renderer uses a **colorless alpha-tested depth fallback**
for the owner front and whichever pet face is foreground. It runs after held
depth reconstruction and before the held weapon draw, preventing tools behind
the portrait from appearing through it. Opposite-facing pet art and unrelated
actors are excluded; the materials and pet-facing layers are restored
immediately afterward. Diagnostics expose the fallback count and
`depth-fallback-no-stencil` reason.

Replacing or detaching a shoulder pet restores the previous pet's ordinary
depth and draw order, cleans up its private stencil participation, and restores
the owner's ordinary portrait orders and normal depth writes.
The compositor reasserts this once more before each base world draw after other
depth writers have run. Its transparent-sort transaction gives the owner's
front/back cards, pet front/back cards, hat overlays and split helpers
**one consistent set of three portrait-stage priorities**. The observation animation
alone chooses which pet face is foreground. Individual pairwise overrides are
not sufficient: with a nearby NPC, portrait-depth ranking can otherwise
produce non-transitive ordering cycles involving a third transparent item.
When that actor-depth rank is active, the owner's pet and hat layers inherit
the player's rank. With manual category ordering enabled, one stable
per-item key preserves far-to-near actor ordering before the owner's local
front/back/pet stages. Unrelated world surfaces still use their own normal
depth testing, and a shoulder pet's hat overlays temporarily defer depth
writes until detachment.

The mobile X-ray panel and Pixel Probe show which pet face is in front,
the individual stage orders and the owner stencil coverage/candidate counts.
Regression guards: `scripts/test-shoulder-pet-layering.js`,
`scripts/test-held-front-portrait-mask.js`,
`scripts/test-xray-hierarchy.js`, and `scripts/test-hat-xray-facing.js`.

## Elevation-aware ground x-ray

Ground is no longer removed wholesale from the held/foot depth rebuild.
Each replay scopes visible tools, hands, feet and shell sources to the
standing elevation and tile of their owning actor:

- The player uses the movement root plus the active
  `townSubtleElevation` composer channel, which is the same lift used for
  town terrain and walkable furniture.
- NPC equipment resolves to its `npc_walker_*` root (also explicitly tagged
  by the NPC held-equipment runtime). NPC procedural body parts can resolve
  through the existing `hobunjiCharacterRigScaleRoot` marker. Named-animal
  body groups use their existing `namedAnimalNpc` marker.
- The holder’s tile and its eight neighbors are eligible for the ground exemption. The holder’s world X/Z selects that area even when a weapon or rig part swings across a boundary.
- Ground materials with standard Three.js world-position shaders discard only
  front-facing, upward-facing fragments within 0.18 world units of the actor's standing
  elevation. Lit materials use their transformed normal; unlit MeshBasic grass
  uses its geometry normal. Any ground geometry without a normal attribute keeps
  full-depth occlusion rather than guessing its surface orientation. World-space Y naturally includes map
  tiers, trench bottoms, raised earth and continuous terrain surfaces.
- Vertical cliff/wall faces and back-facing floors/ceilings remain depth occluders. Water, slush, snow,
  billboard grass, props and other solid geometry retain their existing
  material/depth behavior.
- Unknown actor ownership, missing geometry normals, and custom ground shaders
  without the required standard chunks fail closed: their ground remains fully opaque to the
  held/foot overlay rather than guessing an elevation.

Actors at effectively the same elevation can share a replay when their gear bounds cannot overlap each other’s projected floor neighborhoods. Unknown/custom draw hooks still use conservative separate replays. Procedural hands and feet may join batching only when their registered parity hook owns the mesh's onBeforeRender without an earlier custom hook: the projection encloses both the current transform and a fresh prior visible transform, plus up to 2× shell-thickness expansion. If another hook replaces that callback, batching automatically falls back to conservative bounds. The leg rig's existing foot-depth-push callback is now explicitly certified as *screen-projection invariant* only when it has no preceding custom hook: a uniform scale about a perspective camera moves the foot in depth without changing its projected outline, while an orthographic view skips this adjustment. The feet parity adapter may trust that certified callback, expanding the existing batching opportunity to hands and feet across players, civilians and enemies. Any other draw-hook chain remains conservative. The synthetic 24-to-3 grouping test is a capacity check, **not** a measured NPC or enemy frame improvement. The renderer prepares the ground material list once per pass and narrows each depth draw to its own screen bounds when it can prove them. Parts that cannot be covered by their neighborhood use ordinary ground depth. The shell-outline pass uses the same tile and elevation filter. The final colorless ground
restore remains before translucent water/slush tinting.

## Ordinary-depth replay supplement

When every source in a group is proven not to need the holder-local floor
exception, the first replay group retains the complete base depth instead of
clearing it. It adds only the PNG cutout/protected-cover depth missing from the
normal draw. Ordinary opaque leaf meshes are hidden during that supplement;
mesh ancestors and custom render hooks stay conservative. The source color and
stencil draw then uses the supplemented depth.

With no floor-exception groups, ground depth was never removed, so its final
restore is redundant. Water/slush tint still runs against complete ground depth,
then restores translucent-cover depth as before. Mixed groups and renderers
without color-mask locking retain the ground restore and original ordering.
`test-held-ordinary-depth-budget.js` executes these pass budgets and restoration
on both success and a thrown render.

## Actor-centered ground X-ray zone

The optional floor exception now uses a **filled circle in world X/Z**, rather
than a square of nearby tiles. The shipped authored radius of one tile on each
side corresponds to a 1.5-world-unit circle, preserving the previous three-tile
diameter without snapping its center to a grid corner. The shader checks the
squared distance of each eligible ground fragment to the actor's world X/Z,
after applying the existing standing-elevation and upward-floor-face tests.
Actual 3D geometry, walls, raised floors, water, snow and grass billboards
continue to follow their own physical depth rules.
**Ground depth outside the circle:** Some wilderness ground materials
intentionally use `depthWrite: false` in the regular world color pass.
Previously, the held-gear depth replay preserved that setting, allowing
weapons to show through the ground *outside* the local exception even when
the floor should obscure them. The depth-only held replay now temporarily
enables depth writing for registered ground materials, including when
their elevation shader is not yet compiled or is unsupported. When supported,
mode 1 still discards standing-level ground *inside* the circle; other
fragments write actual ground depth. Unsupported shader variants fail closed,
so the floor remains a physical occluder even inside the circle instead of
accidentally allowing x-ray outside it. The material's original `depthWrite`
value is restored through the existing transaction after that replay.
Normal world drawing, walls, raised surfaces and water rules do not change.

**Ordinary held parts:** Equipment fully above the standing floor skips the
local circle filter and normally uses a cheap depth supplement. This path
previously skipped all terrain, including ground whose visible world material
had never written depth. The supplement now keeps only registered ground
leaves missing depth, temporarily enables their depth writes, and restores
their materials before the held color draw. It still skips unrelated world
geometry and does not clear the base depth.

The mobile X-ray panel displays **Ground depth writers repaired (last replay)**,
**Ground shader fallbacks**, and a **Use stencil floor punch (A/B test)**
checkbox. It additionally reports ordinary held parts and actual floor-punch
call/fallback counts, to distinguish permission to punch from an actual
stencil reset. The checkbox switches between the fast stencil floor reset
and full-depth rebuild when a depth snapshot is supported, helping isolate
remaining *inside-circle* obstruction. The copied diagnostic report includes
these counters. This does not alter the authored 1.5-world-unit radius.

The existing per-tile lookup remains only a CPU batching index: characters
standing at different coordinates inside one tile have separate circle centers.
Both the standard clear-and-rebuild pass and stencil floor-punch use the same
circle centers. The patch-refill cull uses a conservative bounding square plus
the existing margin; it is an optimization, not the visible boundary.

Dev Companion → X-ray and layer compositing → **Show ground X-ray circle in the
world** toggles a translucent filled disc and rim at the player's standing
elevation. That geometry is created lazily, follows the player, and is removed
when disabled or when switching scenes. It does not write depth and cannot
change the X-ray mask. This switch is a developer-only browser override, not
part of save data.

## Shared surface occlusion composer

`surface-occlusion-composer.js` is the policy layer shared by world/character
occlusion consumers. It classifies base ground, paths, walkable interior floors,
water, slush, snow, standing grass billboards and ordinary solid geometry, then
returns the same decisions for each effect:

- Base grass, authored paths and tagged walkable floors may use the
  same-elevation/upward-face x-ray rule. An unknown actor elevation fails closed.
- Water and slush are translucent covers: they may tint a visible held/hand/foot
  pixel, and their colorless depth is restored after tint. Snow and standing
  grass remain solid covers.
- A shell outline inherits the source mesh's ground policy; it must not invent
  a second set of visibility exceptions.

The first registered consumers are `held-overlay` and `shell-outline`.
Feet participate through the held overlay. Hats, portrait planes, chatheads and
other character/world x-ray effects are **not all migrated yet**; they should
call `classifySurface()` and `resolvePolicy()` as they are brought onto the
shared contract. The composer deliberately does not own WebGL render order, so
consumers can adopt it incrementally without moving their render passes.

`classifySurface(object, hints)` owns the material/tag categories. The optional
hints carry geometry facts that cannot be inferred safely from a material
alone: `topFaceGround`, `baseGround`, and `walkableFloor`. The held renderer
computes those facts with the existing terrain/floor tests and reuses one hint
object during its synchronous scene scan. `pathSurface` is a boolean
tri-state contract: when supplied, either `true` or `false` is authoritative;
when omitted, the composer checks the `hobunjiPathSurface` ancestor tag itself.
Future consumers should use this same hint contract (or a shared hint resolver)
instead of recreating terrain and hierarchy rules inside each effect. For
elevation-dependent ground decisions, pass `actorElevation` to
`resolvePolicy()`; an unknown elevation is explicitly fail-closed.

For merged water, the ordinary animated color shader is unchanged and retains
`depthWrite: false`. The compositor temporarily toggles
`uHobunjiSurfaceOcclusionDepthOnly` only for its colorless depth passes. In
that mode, the shader discards fragments whose authored alpha is below the
shared `WATER_DEPTH_ALPHA_THRESHOLD` (currently 0.12). The threshold affects
depth coverage only; normal visible water alpha and tint are untouched. The
uniform is restored with the material state after every replay.

## Distant-water character tint guard

Water surface meshes are often merged over many tiles or an entire river,
so a mesh bounding sphere can overlap the character on screen even when the
actual wet cells are nowhere near that character. `MergedWaterRenderer.createMesh`
records a **wet-tile footprint** (sparse cells or one rectangular map-wide
flood footprint). The held/foot compositor checks this footprint against the
owning actor's tile neighborhood before considering the water for tint. Untagged
scenery water/slush uses conservative world bounds, and unknown transforms
remain eligible rather than incorrectly stripping valid submersion.

This is **per owner**, not a scene-wide switch: when one NPC stands in a river,
the dry player's held equipment and procedural feet clear the water-tint
stencil instead of inheriting the NPC's tint. A depth batch mixing wet and dry
owners is split into separate material transactions so shared sprite materials
cannot carry another owner's stencil reference. The existing depth, ground
restore, tint, then colorless water-depth order still applies. Each held mesh
continues to receive a single color draw, and normal water shader/color passes
are unchanged. A three-tile neighborhood conservatively includes long gear
near a bank without allowing arbitrarily distant streams to trigger tint.

Rigid gear and portrait art also check their world bounds against the cover
height and wet tiles. The relief matters when an offhand flail head swings
below a bank while its haft stays dry. The color pass submits each part on its
own camera layer without hiding renderable parents from the scene graph.
After ground depth is restored, eligible portrait silhouettes join the
existing tint stencil with a colorless depth-tested draw. A foreground
riverbank cannot tint a portrait just because their screen pixels overlap.

The previous proximity guard excluded remote water only from the last tint
pass. Earlier depth reconstruction still forced remote translucent water to
write an irregular alpha mask, causing patchy visual gaps. Distant water
meshes are now excluded before *every* held/foot depth reconstruction. A
merged river with near and remote tiles is also clipped per fragment against
owner world tiles inside the selective replay, rather than trusting a whole
river's giant bounding volume. The normal animated water color shader is
unmodified outside the replay, and clip/visibility state is restored after
every render. The twelve-owner clip budget conservatively falls back in
crowds and is visible in Pixel Probe as `clipOverflow`.

Pixel Probe reports `nearWater` and `farWaterSkipped` under `Held x-ray`;
these counters count eligible/excluded cover **meshes**, not individual water
fragments. Verify both a dry actor with a distant river and an underwater actor
while another dry NPC is on screen. Source-level regressions cover sparse merged
water, broad floods, scenery bounds, and mixed wet/dry shared-material groups;
a real GPU screenshot is still required to validate final pixels.

## Central x-ray hierarchy config and the dev-companion tool

Every layering rule in this document that is a *choice* (not a physical fact) is a named rule in
`docs/js/xray-hierarchy.js` (`window.XrayHierarchy`): `actors.order`, `pants.sortWithActor`,
`weapon.frontPlaneMask`, `hand.frontPlaneMask` and `portrait.waterTint`. Each has a shipped default and a fixed
set of options, and the renderer reads it through `XrayHierarchy.get()` every frame, so a change applies on the
next frame. Add new rules there (default + options + the read where the behaviour lives) instead of hard-coding
another switch in the compositor.

Dev Companion's **X-ray and layer compositing** card shows pass-specific controls, live stencil coverage,
one dropdown per rule, *Export overrides and layer ranks* and a confirmed **Reset all to repo** button.
Reset restores every rule and draw-order entry to the defaults in this repository version, removes the
browser-local override record, and does not alter a world save. To make a tested setting the shipped
default, edit `RULES[<key>].default` and run `scripts/test-xray-hierarchy.js`.

`hand.frontPlaneMask` (default `behind`): a procedural hand whose centre sits behind its holder's front portrait
plane, with the camera on the front side, joins the front-art stencil mask and loses its shell outline layer
for that frame (`updateFrontPlaneHands`); a parrot hand's separate wing-continuation sub-mesh (the portrait-occluded wing layer, whose outline is the loops around a gripping kenkari hand) is hidden with it. "Behind" means any part of the hand's geometry box reaches more than 3 cm behind the plane (a gripping hand straddles the card, so its centre alone is not enough). Hands in front of the plane are untouched. `always` masks every hand
like a weapon; `off` restores the old behaviour. `HeldObjectRenderOrder.snapshot().handsBehindFrontPlane` reports
the live count.

### Manual layer ranks are not physical renderer stages

The Dev Companion's editable draw-order ranks affect color sorts only within a compatible renderer pass. In `held-object-render-order.js`, render-time pose sentinels (`renderOrder <= -10000`) remain before ordinary color geometry, while high-priority late art and depth masks (`renderOrder >= 900`) remain after it. Within either protected phase, Three.js's legacy group/render-order sort wins; manual ranks cannot move an animation sentinel behind its hand or move a late cloud depth mask ahead of foreground geometry. Group order is protected in all phases.

`enforceHeldMesh()` intentionally normalizes ordinary held sprites' authored `renderOrder` to zero (multi-sprite assembly parts retain their authored local ordering) and ensures they participate in the dedicated held-overlay camera layer. That normalization is not a persistent user-editable global layer: the Dev Companion now reports the count of normalizations and the most recent affected mesh under **Held renderOrder overrides**, also included in the copyable diagnostic report. A nonzero count alone is not a bug; it identifies why editing a raw mesh's order is ineffective. The actual front-art occlusion remains a separate per-owner stencil rule requiring an 8-bit stencil target and a resolved portrait owner. See `scripts/test-xray-hierarchy.js` for guarded comparator ordering; real GPU pixels still need scene-specific verification.

## Actor draw order: portraits and worn pants sort together

`nearbyPortraitOrder()` orders every visible player/NPC portrait by its actor's camera depth (far to near) and
`withPortraitDrawOrder()` installs that as the renderer's transparent sort. Worn pants are separate meshes at
`renderOrder` 28, so they are ranked with the actor that wears them (`extras`) and draw right after that actor's
portrait. Leaving them out meant they drew after *every* portrait and relied on depth alone, which fails for any
portrait that does not write depth - far NPCs' pants then show through the player.
The base pass suppresses depth writes only for close, non-nearest actors **without visible pants**;
a pants wearer's alpha-tested portrait keeps depth. The nearest portrait and actors
outside `PORTRAIT_SORT_DISTANCE` keep normal depth. The `pants.sortWithActor`
rule must remain on for the intended default wearer-wise layering.
Shoulder-pet portrait stacks still have a separate intentional depth-write-free mode. Other worn parts
that draw after portraits (hats, overlays) need the same treatment if they show the same symptom.

## Portrait water tint: the actor's own tile must be wet

Front/rear portrait cards are wider than the actor, so their bounds overlap wet tiles whenever a character
merely stands beside a pond, river or flood edge. `submergedPortraits()` therefore also requires
`actorStandsInWater()`: the tile under the portrait's world origin must be in the water footprint (or inside a
map-wide flood rectangle). Standing on the bank must leave the portrait untinted; standing on a wet tile tints it.
Scenery water/slush without a tile footprint keeps the bounds test alone. `scripts/test-portrait-water-bank.js`
executes the production predicate. The Testing Arena's "Stand on the bank" button reproduces the bank case.

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
world color pass**, then invokes `replaySelectiveHeldOverlay`. The selective
overlay runs one depth/overlay pair per compatible batch of holders. The depth replay filters same-elevation top faces inside the batch’s tile neighborhoods.

The replay order is:

| Order | Operation | Color | Depth / stencil |
| --- | --- | --- | --- |
| 1 | For each actor-elevation group, clear depth; replay solid occluders with ground present, discarding only same-elevation upward-facing ground fragments; hide held/foot meshes and (when tinting) water/slush covers | **Unchanged** | Rebuild solid depth. Force suitable alpha-cutout occluders to write depth while preserving their silhouettes |
| 2 | Draw that elevation group's registered held objects, hands and procedural feet | **Draw once per group** | In tint mode, temporarily require `depthTest: true` and `depthWrite: true`, and accumulate **stencil bit 0** on visible fragments |
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
occluders. Carved cave shells retain their full original geometry during depth
reconstruction. The elevation shader discards only same-height, front-facing
upward floor fragments in an eligible holder neighborhood; different-height top faces, vertical walls and ceilings
continue to write depth.
The screen-space scissor, per-scene registries, and conservative cover/
overlay overlap check limit the cost. Near-plane/uncertain geometry can
fall back to the full tint path. Framebuffers with no usable stencil
keep conservative cover occlusion rather than painting unsupported
partial tint.

## Shell outlines inherit the source object's ground-x-ray visibility

Flat character portrait PNGs, modular weapon sprite layers, flail-rope PNGs, merged leaf cards, and grass/weed billboards carry their **own authored outlines** and must not join layer 1. The only character parts requiring an inverted-hull outline are the volumetric hands and feet; independent volumetric terrain/furniture still uses its ordinary shell policy. Render classification removes accidental layer-1 membership from authored planes when they join the scene, including art outside the held-object registry. Their other render layers are retained. Held-object enforcement and shell replay also check authored art.

The occluder depth material transaction is prepared **once per shell replay**, not once per elevation group: each group updates only ground tile/elevation uniforms. The final full-depth restore uses that same material transaction, and the outer `finally` restores material/camera/renderer flags even if a draw throws.

The inverted-hull shell pass is a separate render from the visible object draw.
Without an explicit parity step, the base mesh can correctly x-ray through
classified ground while its shell is still rejected by the ordinary ground
depth left in the framebuffer.

HeldObjectRenderOrder applies the same rule to both representations:

1. The normal layer-1 shell pass omits **only** registered held/foot meshes
   whose owning tile/elevation actually requires the special floor exception.
   Ordinary-depth player, civilian, enemy and companion shells stay in the
   ordinary pass and draw once. If none needs a floor exception, there is no
   shell-depth reconstruction at all.
2. A scissored replay clears depth only around those meshes and reconstructs
   solid depth while excluding the exact groundKind() set used by the
   visible held/foot x-ray. The source meshes remain in the depth replay (with
   depth writes temporarily enabled) so their front faces still mask the
   expanded shell. Snow, water, slush, furniture, rocks, walls and other
   non-ground occluders remain in this depth reconstruction. Carved
   cavern shells retain their complete geometry; only same-height top faces are
   discarded by the elevation filter, while different-height floors, walls and
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
- After the depth replay, confirm water's
  `uHobunjiSurfaceOcclusionDepthOnly` uniform returns to 0. The alpha
  threshold is used only in colorless depth passes, never normal water color.
- Run `node scripts/test-town-render-hotpaths.js`,
  `node scripts/test-xray-shell-rig-bounds.js`,
  `node scripts/test-outdoor-xray-pass-budget.js` and the repository's
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

## Pass-aware X-ray controls and airborne horizon mask

The Dev Companion now groups controls by their **actual render decisions**:
front portrait stencil occlusion, world/airborne depth, water compositing,
actor stacking and same-pass visual priority. These are independent render
operations, **not** 18 competing depth hierarchies. The GPU draws an ordinary
world scene, then a dedicated held-hand/weapon/foot overlay (with selective
depth rebuild), then water and outline passes. Opaque and transparent materials
also have distinct draw lists **inside** a render stage. A material's physical
depth test remains authoritative over each color-list rank.

The **Render stage** picker offers only components that participate in that
stage: *Held overlay* (hands/tools and feet) or *World color*. Cross-stage
moves are rejected instead of misleadingly appearing to work. The visual
categories are kept in the existing `__drawOrder` export and storage format
for backward compatibility; a linked `item.weapons` entry has no independent
effective priority and is hidden in the editor. Selecting that identifier in
the public movement API moves the actual `actor.hands` entry. Unlinking the
tool exposes its separate slot. All of these priority edits still sort
only within an appropriate opaque or transparent draw list.

**Crucially, the weapon's front-art mask is not a sort position.**
The direct `weapon.frontPlaneMask` switch decides whether the owner's opaque
front-portrait pixels stencil out held gear in the later overlay pass. This
switch now defaults to **off** because the stencil can obscure weapon pixels
that should remain visible. Developers can opt back in via the Dev Companion
for comparison; an explicitly stored browser override continues to apply.
The independent `hand.frontPlaneMask` rule handles hands that straddle the
front plane. The old assumption that moving a tool's color-list rank relative
to `actor.front` could control the stencil was removed. Front masking requires
8 stencil bits in the active framebuffer. For mobile investigations the card
now displays stencil-bit availability and **actually assigned masked gear**
versus eligible gear; zero assignments despite eligible parts means the
owner/front portrait mapping or stencil framebuffer must be investigated.

The *Reset all to repo* action discards all rule and ordering overrides stored
in the browser and restores the currently shipped defaults. Changing priorities
does not override the scene's physical depth, water tint, front mask or shell
outline. Moving a layer activates `layers.manualOrder`.

### Diagnostic hypothesis presets

The X-ray Dev Companion also exposes a single **Possible explanation to test** selector
and **Apply selected experiment**. Experiments are **temporary A/B tests**, not proposed
production fixes. Each experiment discards the previous experiment's edits and derives a
complete, validated setting set **from this repo's defaults**; no settings leak between
experiments. The selectable scenarios are: repository baseline; owner-front stencil off;
force all hands under their front art; legacy sky/background occlusion; jump-depth rebuild
off; older near-only actor sorting; pants outside actor sorting; tool before hands in the
held overlay; tool after hands; and portrait-water tint off. The latter affects portrait
tint, **not** the weapon water compositor. Tool ordering cannot override the owner stencil.
The panel spells out the hypothesis, what a visible change would suggest, and what lack
of change would suggest; neither result proves a cause without comparing the **same
scene and pose** against the baseline.

On the **first** application, a complete copy of the user's prior rules, draw order, and
editor selection is stored in `hobunji.xrayHierarchy.diagnostics.v1` in the browser.
Subsequent experiments reuse that **original** backup, including across page reloads.
**Restore my pre-test settings** applies that backup and deletes it. **Reset all to repo**
also deletes the backup, deliberately discarding the old custom configuration. A user
who edits settings while a preset is active sees **modified manually**, rather than a
false claim that the selected experiment is still exact. **Copy mobile diagnostic report**
contains the active hypothesis and comparison guidance, all rule values and drawing
ranks, and the actual available stencil/airborne/overlay counters. This is useful on
mobile without the browser console. These presets do not alter player/world saves.

**Jumping regression:** a player airborne in `PlayerJump.debug` has
physically raised gear. The compositor's ordinary-depth shortcut previously
reused scene depth, including artificial far-plane sky/cloud-mask depth and
visual-only distant plateau/ridge geometry. Those background masks can have
irregular silhouettes and must not be treated as physical occluders of a
nearby weapon. While physically airborne, the ordinary held group now
rebuilds its depth (rather than supplementing cached base depth) and omits
only registered visual background meshes during that depth submission.
Actual terrain, nearby floors, walls, snow, foliage, water and NPC bodies
remain occluders. Elevation-replay groups and hand/foot shell depth draws
also exclude these visual-only backdrop meshes. Their ordinary color draw,
final depth restoration and postprocess paths still see the original sky and
distant scenery. On GPUs without scissor-depth snapshots, this requires
a complete colorless world-depth rebuild followed by a held-object depth redraw,
rather than leaving a cleared sky buffer for later water/postprocess passes.
The default `background.gearDepth=ignore` and
`airborne.rebuildDepth=on` options can be toggled independently in
**World depth and airborne replay** to A/B-test the issue.

`HeldObjectRenderOrder.snapshot()` reports
`airborneDepthRebuilds`, `backgroundDepthMeshesExcluded` and
`registeredBackgroundDepthMeshes` for mobile diagnostics.



## Local participant distance policy

Gameplay selects X-ray participants by their owner's tile relative to the
player. `XRAY_TILE_RADIUS` is the single tile-reach constant for this
square ring and for the existing holder-centered floor circle
(`XRAY_CIRCLE_RADIUS = XRAY_TILE_RADIUS + 0.5`). These are distinct
operations: participant eligibility is player-relative; the depth shader
still exempts only same-height ground around the eligible holder.
Feet and pants no longer also apply the six-unit 3D camera sphere when the
local filter is active. That camera check remains available for legacy
range A/B and scenes without a valid player. Existing category and species
gates and ordinary weapon budget are unchanged. Frustum rejection and
screen-space replay scissoring remain independent conservative bounds.


### Optional selective traversal / registry sharing pilots

`mixedWaterPrune` (default off) extends existing water-only branch pruning
to mixed held-gear/water frames, strictly after ground/gear depth
restoration and portrait stamping, for the two WATER_REPLAY submissions.
It conservatively keeps the ancestor paths of relevant renderables,
lights and cameras, and falls back on unknown nodes, LOD, unsafe hooks,
pending shadow refresh or active scene matrix updates. Visibility is
restored in finally. It replaces repeated native walks with one JS scan
plus selective native walks; actual net cost must be measured.

`replayRegistryMemo` (default off) shares ancestor root/visibility reads
between adjacent pure registry collections, and shares the just-collected
front list with the immediate stencil stamp. No cross-frame or cross-draw
visibility cache. These switches are independent; the existing
water-only pruner, ground restoration order, stencil rules and scissor
policy are unchanged.


### Classification repair cadence experiment

The existing add-hook queue remains the immediate registration path.
Writers introducing a late semantic tag, layer or material may call
`HeldObjectRenderOrder.invalidateClassification(root)` to queue that
subtree for the same deduplicated flush before the next render; this is
additive classification, not an unregister API. Forced scene scans
remain available. The optional `slowClassificationFallback` switch
(default off) extends periodic full repairs from 750 ms to 3 seconds,
with reseeding when toggled. No claim is made that all legacy semantic
writers publish invalidation yet. Unannounced changes can be delayed,
so test visually before promoting this experiment. Probe records full
scans, forced scans, explicit invalidations and active/auxiliary costs.


## Experimental ground pose (player only)

X-ray Hierarchy → World depth and airborne replay → Held weapon ground clearance switches rotation / ordinary depth with no fit. The branch defaults to rotation. A rigid single-plane melee weapon is solved inside WeaponToolStances' temporary matrix bake, keeping the primary grip fixed. Explicit measured A/B item-space Z endpoints and heightFraction describe reference geometry without overriding base scale; optional disjoint segments contract by equal fractional strain down to minSegmentScale before grip-pivot rotation. Twisted planes may rotate but do not contract; independent multi-sprite, flail, dual-wield and NPC weapons retain legacy behavior. A failed clearance solve keeps normal terrain occlusion. Ground support is sampled by PlayerJump, not by visual body Y; ordinary free hands can lift within authored arm reach. The regular held-depth, owner mask, water tint, pants, feet, and combat collision remain independent. Mobile X-ray Hierarchy reports floor, original/final clearance, rotation, shortening and fallback reason. Authored profiles are opt-in; no existing weapon lengths were guessed or migrated.

The Attack Animation Editor includes an explicit **Measure visible sprite A/B** action which scans the current PNG's alpha once to derive its source Z bounds (not transparent padding). Authoring still permits overriding those bounds and defining multiple disjoint shortening segments. Measured target scale uses the existing supported 0.1–3 scale range; the inspector reports the actual ratio if a requested extreme is capped. Profiles use the existing grip-shape metadata key, so exact modular-combination-specific measurements and multi-sprite deformation need separate follow-up.

The Attack Animation Editor's Weapon geometry drawing panel replaces raw JSON entry. Drag A/B for longitudinal length, drag disjoint full-width shortening bands, and tap or trace the closed contact perimeter in source X/Z coordinates. Auto-trace computes a conservative convex hull of opaque pixel corners once, explicitly. Manual traces are the author's contact envelope: include both ends and all protrusions. The floor solver uses authored X/Z vertices plus polygon-edge intersections at every shortening boundary, rather than transparent quad corners. Invalid/out-of-bounds outlines retain rectangular fallback; no existing profiles are guessed. Layered/flipped previews are marked as runtime fallback. The renderer has no dependency on the editor canvas or alpha scanning.

Flail pilot: the rigid single-plane haft can compress and rotate about its grip without hand translation. The compressed haft anchor follows the same strip deformation. For an authored flail profile, the rope has its own minimum scale (0/off in UI); draw the suspended head's contact edge separately on its anchor-layer image. Idle suspension uses the existing pendulum and reduces connector length before redirecting the minimum-length connector behind motion when the head would penetrate the local floor. It is a straight trailing connector approximation, not full slack-rope ground collision. Attacks, layered hafts, NPC and dual-wield assemblies remain legacy. Missing head edge uses conservative head bounds. Neither weapon collision nor attack timings are changed.

### Permanent fitted length (experimental)
Shortening is now a physical fit, not per-frame pose animation. The first eligible grounded Neutral computes and caches a single compression amount (including zero) for each player rig/item/profile; the same source-space anchor is used for subsequent grip remaps, swings, re-equipping and jumps. A failed clearance rotation keeps the fitted geometry and normal terrain occlusion. The rope independently fits once from a vertical hanging reference, then its contact response changes only suspension direction. Existing authored flail length animation can shorten the connector further, but cannot exceed the fitted length. The experimental fit cache is session/rig-scoped, not a serialized inventory mutation; a new rig or reload recomputes the fit at the next eligible grounded Neutral. The ground toggle still restores original geometry while disabled.

A missing floor sample (e.g. above a pit) disables only the clearance rotation; the previously fitted strip is still applied. Fitting waits for a loaded sprite whose measured A/B endpoints fit its geometry. Rope fitting waits until the haft fit is established and respects the connector's minimum lateral span.


### Light-stance fitting and haft-local bands (experimental)

Physical shortening is sampled once from the shared authored Light weapon neutral, even if the live weapon uses Heavy neutral. The final loaded texture supplies its alpha contact envelope (threshold 21/255, cached by bitmap and geometry); no hand-painted outline is needed for every modular recipe. An unreadable bitmap cannot establish a permanent fit. A manual outline is only a rotation fallback. The separate suspended flail head is likewise traced, and the Light stance's authored rope-length channel participates in its physical fit.

The Attack Animation Editor accepts rectangular shortening bands in canonical X/Z. In the Modular Weapon Editor, the new **Haft shortening bands (all heads)** source panel saves rectangles in the original 450×1204 haft coordinate system, plus a minimum remaining length percentage. The compositor's shaft-art transform maps these into the shared item frame. Modular recipes inherit only those haft bands; contact is traced from their final assembled texture, not their donor weapon's head. No head/metal-specific band setup is necessary.

The experimental flat-sprite deformation preserves the grip and contracts each selected strip uniformly; off-width protrusions translate rigidly with its headward end. Choose a rectangle spanning the entire wooden shaft, not intersecting a rigid head's opaque connecting pixels. A flattened image cannot recover occluded material, so an ill-placed band can create seams or shift unrelated off-axis artwork. True per-layer overlap reconstruction is not implemented. Existing unsupported dual-wield, flipped and complex assemblies retain their legacy clearance. Compression remains visual only, cached during the actor/item lifetime and not serialized across reloads.

### Standalone Attack Animation Editor parity

The editor now loads the same clearance solver, supplies its ESM Three namespace and the displayed Y=0 floor, and computes a separate Light-neutral reference matrix without changing authored pose values. Applying geometry focuses Neutral; the editor's live status reports fitted band strain, rotation and lowest visible contact before/after correction. Raw preview can be toggled; active gizmos deliberately suspend correction to avoid recording fitted rotation into the source animation. The drawing panel always reads original uncompressed geometry, even while the visible sprite uses a private fitted mesh.

The suspended assembly is identified by its actual decorated root. Its loaded opaque head and connector must be available before freezing Light-neutral haft shortening. The fit considers the hanging head as well as the rigid haft, then establishes the independent connector limit. A disabled rope shortening band preserves rope length but still permits ground-trailing correction. Raw editor mode disables both rigid and flexible clearance; diagnostic status distinguishes exact unsupported topology and reports the suspended head's clearance.

The invisible offhand hand-placement subsystem intentionally creates child roots on ordinary weapon planes. The clearance topology check now exempts only the exact owned non-drawing copies; visible dual weapons and arbitrary layers still fall back. Duplicate meshes use the canonical source buffer so disposing a fitted strip cannot invalidate their geometry.

### Authored weapon sizing and donor haft bands
Rotation remains the default. The authored base tool scale determines unshortened size; the per-weapon species scale multiplier migrates to zero, with optional later authoring. Recorded A/B length percentages are reference metadata, not scale overrides. Ground fitting still shortens authored intervals and rotates about each grip. The fitted path intentionally has no legacy render-only 1.15 enlargement. Fifteen matching 450 × 1204 donor/shaft PNG pairs inherit their shipped shortening intervals and minimum strain, converted into original shaft pixel coordinates. Old empty Foundry drafts upgrade once; subsequently authored bands, including explicitly cleared bands, are retained.

The rigid Torch-Staff has no solid overlay: its child group owns fire particles. Only exact assembly-owned emitter groups are ignored, allowing rigid clearance in runtime and preview. Solid overlays still require a separate layer-aware fit. The latest export updates all explicit length profiles and changed base sizes, retaining earlier workhammer geometry absent from the newer export. Light reference diagnostics belong to the current fit, never another weapon.

### Dual-wield grip-pivot correction
The canonical hidden weapon establishes the immutable Light fit even in dual poses. Both visible copies borrow its private fitted buffer (released before disposal), and the dual visual owner solves each separately after its idle/lag pose is baked. Corrections use the actual respective hand socket as world pivot, preserving its position with a compensating translation; orientation follows the corrected weapon. The original authored holder pose remains untouched during dual correction. Exact owned dual roots are the only additional visible children allowed by the canonical fit. The existing unsupported fallback remains for solid overlays and dual suspended assemblies. Clearance is evaluated per copy.

### Weapon and hand ground X-ray retired
Hands, weapons and held tools (including flail heads/ropes and both dual copies) always use ordinary solid-world depth in both color and shell grouping. Rotation mode remains the default geometric clearance; ordinary mode disables only the fit for comparison. Unsupported or failed solves can visually intersect and be occluded by the floor, never reveal art through it. Existing saved `xray` values migrate to rotation. The ordinary 3D hand outline, water tint, optional owner portrait mask and free-hand clearance remain; neither hand color nor its shell gets a floor exemption. The feet/pants opt-in comparison and wet lower-body ordinary-depth compositing from main remain intact.
