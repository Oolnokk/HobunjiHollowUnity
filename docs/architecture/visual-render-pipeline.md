# Visual render pipeline — read this before any visual change

This is the map of how a gameplay frame gets drawn, who owns each step, and
what you must not break. It exists so a change to one visual (an outline, a
billboard, a pose, a cull) does not silently change another. If you add or move
a visual owner, update this file in the same change.

It pairs with [`visual-authoring.md`](visual-authoring.md), the repository's
contract for what each visible component may look like: authored ink on PNG
portraits/pants/billboards (never a generated outline), one inked PNG stretched
over each detected hard-edged surface, generated outlines only on curved 3D
parts (hands, feet, trees), and the player campfire as the only flame source.
That document says *what* is drawn; this one says *how and when* it is drawn
and how to check it. Read both before a visual change.

## 1. One frame, end to end

```
gameLoop (game.js)
 ├─ simulation, camera (updateCameraPosition), vegetation cull tick
 │    (ZoneVegetationCull.tick, ~7 Hz), mesh/visual updates
 ├─ RuntimeFrameScheduler.checkpoint('pre-render')   ← pose/hand/stance writers
 ├─ WorldRenderPipeline.renderFrame(now)             ← js/world-render-pipeline.js
 │    1. render scopes suspend        (hide/merge objects for drawing only)
 │    2. RenderHooks.beginWorldFrame  ('frame' presentation hooks armed)
 │    3. ActorRenderOcclusion.beginFrame
 │    4. passes (below)
 │    5. finally: ActorRenderOcclusion.endFrame → RenderHooks.endWorldFrame
 │                → scopes restore in reverse order
 └─ 2D overlays, lighting overlay, HUD (canvas, not WebGL)
```

Everything between steps 1 and 5 is **render-only**: by the time `renderFrame`
returns, every visibility toggle, merged batch, composed pose and swapped
material is back to its gameplay state. Gameplay, raycasts, saves and the next
frame never see render-only state. Keep it that way.

### Passes (outlines on — the default)

| # | Pass (capture label) | Draws | Layers | Into | Owner |
|---|---|---|---|---|---|
| 1 | `main` | the whole active scene | all | `mainRT` (colour + depth/stencil) | world-render-pipeline.js |
| 1a | ↳ held-object replays | ground depth, held items, hands, feet, water | `GROUND_REPLAY`, `HELD_OVERLAY`, … | `mainRT` | held-object-render-order.js (wraps the main render call) |
| 2 | `pngDepth` | PNG avatars, depth only | `PNG_OCCLUDER` | `mainRT` | png-plane-outline-occluder.js |
| 3 | `actorProbes` | nothing (GPU queries on existing depth) | — | — | actor-render-occlusion.js |
| 4 | `shell` | black inverted-hull outlines | `SHELL_OUTLINE` (+ x-ray replays) | `mainRT` | world-render-pipeline.js; held-object-render-order.js adds x-ray shells |
| 5 | `target` | reticle target highlight (only with a target) | `TARGET_HIGHLIGHT` | `mainRT` | world-render-pipeline.js |
| 6 | `mist` | Cloud Forest / blizzard mist redraw (when active) | `MIST_REDRAW` | `mainRT` | cloud-forest-fog.js |
| 7 | `seamId` | material-ID buffer (off by default) | `MATERIAL_SEAM_ID` | `seamIdRT` | world-render-pipeline.js |
| 8 | `composite` | `mainRT` → canvas, then world text | `WORLD_TEXT_OVERLAY` | canvas | outline-composite-material.js, outline-render-performance.js |
| 9 | `perception` | Perception Mode silhouettes | `PERCEPTION_MODE` | canvas | perception-mode.js |

Outlines off: `main` straight to the canvas, `actorProbes`, `target`,
`perception`. A quiet Western Slope frame is **17 native renders, ~160 draws**
(80 of them the main pass); most of the extra draws are the held-object
replays (`WorldRenderPipeline.captureFrame()` shows the exact list).

## 2. The owners

| Concern | Owner | Global |
|---|---|---|
| Pass order, outline materials, render targets, composite, target highlight, render scopes | `js/world-render-pipeline.js` | `WorldRenderPipeline` |
| Render-time presentation hooks (poses/transforms applied only while drawing) | `js/render-hooks.js` | `RenderHooks` |
| Names of every `THREE.Layers` bit | `js/render-layers.js` | `HobunjiRenderLayers` |
| Outline tuning (thickness, ally/hostile colours, seam thresholds) | `docs/config/outline-rendering.json` | applied by the pipeline |
| Composite shader | `js/outline-composite-material.js` | `OutlineCompositeMaterial` |
| Held items / hands / feet / pants over ground, x-ray, water tint | `js/held-object-render-order.js`, rules in `js/xray-hierarchy.js` | `HeldObjectRenderOrder`, `XrayHierarchy` |
| Matrix reuse between passes, world-text overlay | `js/outline-render-performance.js` | `OutlineRenderPerformance` |
| PNG sprite material/texture path | `js/portrait-utils.js` | `HobunjiSpritePngSurface` (see AGENTS.md) |
| Which characters exist (player, NPCs, enemies, creatures, companions, mounts, shoulder pets, corpses, farm animals) and which visual systems cover which kind | `js/character-visuals.js` | `CharacterVisuals` |
| Held tool/weapon planes for any holder (mastery/metal from the holder) | `js/character-held-tools.js` | `CharacterHeldTools` |
| Frozen Tzizkhanash-style Ghost Army sculpture on skeleton-defense Key Statues (stone portrait/weapon + fitted size; original Burden physics unchanged) | `js/key-statue-figures.js` via `js/festival-ancestor-figures.js`; attached/removed by `js/key-statues.js` | `KeyStatueFigures` |
| Shoulder-pet perch/grip solver (one instance per owner) | `js/shoulder-pet-attachment-runtime.js` | `ShoulderPetAttachmentRuntime` |
| Mist depth silhouettes for characters in Cloud Forest mist / blizzard | `js/cloud-forest-avatar-depth-occluder.js` | `CloudForestAvatarDepthOccluder` |
| Wilderness vegetation corridor cull + tree fade targets | `js/zone-vegetation-cull.js`, `js/zone-tree-fade.js` | `ZoneVegetationCull`, `ZoneTreeFade` |
| Procedural wilderness trees drawn instanced (render scope) | `js/wilderness-tree-instancer.js` | `WildernessTreeInstancer` |
| Sky dome, clouds, celestial sprites | `js/sky-dome.js` | `HobunjiSkyDome` |
| Rain / blizzard planes | `js/rain-planes.js` | `RainPlanes` |
| Cloud Forest mist, blizzard mist | `js/cloud-forest-fog.js` | `CloudForestFog` |
| Grass (farm/town) and crops | `js/vegetation-crop-rendering.js` | `VegetationCropRendering` |
| Wilderness grass billboards | `js/zone-grass-billboards.js` | |
| Terrain tile materials, terrain chunks | `js/terrain-tile-materials.js`, `js/terrain-render-chunks.js`, `js/terrain-geometry.js` | |
| Wilderness streaming chunks | `js/wilderness-chunks.js` | `WildernessChunks` |
| Interior/building lighting | `js/farmhouse-flat-lighting.js`, `js/furniture-light-registry.js` | |
| Pixel ratio / mobile budget | `js/mobile-render-budget.js` | `MobileRenderBudget` |
| Shadow map refresh cadence | `js/shadow-map-refresh-throttle.js` | |

`game.js` still owns: scene/renderer/camera creation, lighting (`updateThreeLighting`),
the per-frame visual updates that move things (player, tools, reticle, NPC
walkers, farm wind), and `findTargetMeshes` (which object the reticle is on).
It calls into the owners above; it does not draw passes itself.

## 3. Layers

`js/render-layers.js` is the registry. Use the names, never a bare number:

```js
const SHELL = globalThis.HobunjiRenderLayers?.SHELL_OUTLINE ?? 1; // fallback only for pages without the registry
```

| Bit | Name(s) | Meaning |
|---|---|---|
| 0 | `WORLD` | ordinary drawing |
| 1 | `SHELL_OUTLINE` | gets the black shell outline (`WorldRenderPipeline.markShellOutline`) |
| 2 | `TARGET_HIGHLIGHT` | reticle target (`setTargetHighlights`) |
| 3 | `MATERIAL_SEAM_ID` | material-seam ID buffer; also how batches recognise ground tiles |
| 4 | `PNG_OCCLUDER` | PNG avatars' depth-only replay |
| 5 | `MIST_REDRAW` | mist cylinders |
| 6 | `WORLD_TEXT_OVERLAY` | popups/chatheads after the composite |
| 24 | `FRONT_PORTRAIT_MASK` / `SCORE_ACTOR_DEPTH` | both transient (set and cleared inside one pass) |
| 25 | `PORTRAIT_WATER_MASK` (transient) / `PERCEPTION_MODE` | |
| 26–29 | `FOOT_WATER_MASK`, `WATER_REPLAY`, `GROUND_REPLAY`, `HELD_OVERLAY` | held-object replays |
| 30 | `TARGET_ALPHA_FILL` (transient) / `HIDDEN_HELPERS` | |
| 31 | `OVERLAY_ONLY_LIGHT` | lights kept out of WebGL's light list |

Bits 7–23 are free. A new **permanent** use of a shared bit is a bug;
`scripts/test-world-render-pipeline.js` rejects a bit with two permanent users.
`HobunjiRenderLayers.describe(camera.layers.mask)` prints names.

## 4. Render-time presentation hooks (`RenderHooks`)

A hook changes objects only while they are drawn and puts them back after.
Registered hooks, in order (lower runs first, its restore runs last):

| Order | id | Scope | Owner | What it does |
|---|---|---|---|---|
| 50 | `animal-subtle-elevation` | frame | animal-subtle-elevation-bridge.js | animal terrain/support placement and ground-following shadows, plus the separate visual hop for companions (game renderer only) |
| 100 | `death-mark-billboards` | frame | combat/combat-death-mark.js | Death-mark billboards face the camera |
| 150 | `town-body-elevation` | frame | town-player-body-elevation-bridge.js | clears the retired composer lift channel; town support diagnostics (game renderer only) |
| 200 | `drunk-prone-composition` | frame | drunk-prone-composition-bridge.js | publishes the drunk channel to the composer; bandit sway |
| 300 | `held-seed-reticle` | frame | held-seed-action-bridge.js | plant reticle material |
| 400 | `crop-ready-presentation` | frame | crop-ready-presentation.js | ready crops' resting pose |
| 500 | `crop-billboard-presentation` | frame | crop-billboard-presentation.js | crops anchored to soil under water |
| 600 | `heftroot-billboard` | frame | heftroot-billboard-bridge.js | heftroot planes face the camera |
| 700 | `crop-sprite-art` | frame | crop-sprite-art.js | crop billboards face the camera |
| 800 | `player-body-composer` | frame | player-body-transform-composer.js | composed player body, deadzone, head aim, neck limit, pants re-skin |
| 900 | `npc-performance-reaction-lock` | frame | npc-performance-reaction-lock-runtime.js | hides social targets of instrument-locked NPCs |
| 950 | `family-baby-limbs` | frame | family-baby-limbs.js | carried baby's cloned 3D hands/feet wave and kick; rest pose restored |
| 1000 | `npc-social-inhibition` | frame | npc-social-inhibition-runtime.js | NPC social facing / dance sway |
| 5000 | `geometry-auto-lod` | render | geometry-auto-lod.js | Opt-in geometry substitutions, restored after every draw |
| 900000000 | `dense-wall-static-matrices` | render | dense-forest-wall-batches.js | opt-in r128 owner-specific static branch matrix reuse; installs/restores only the active scene instance method during native rendering |

**`frame` scope** = applied once, on the first render of the world scene in a
frame, undone once at `endWorldFrame`. Every pass (main, PNG depth, shell,
held-object replays) therefore draws the same composed state, and the work runs
once instead of ~17 times. Outside a world frame (editor previews, Pixel Probe
captures) a `frame` hook falls back to per-render behaviour.

Rules:
- **Never wrap `renderer.render` or `WebGLRenderer.prototype.render`.**
  Register a hook. A wrapper is invisible to `RenderHooks.getDebug()`, runs on
  every pass, and its nesting depends on script load order.
- `after()` restores exactly what `before()` changed. Return the restore data from `before()`.
- No per-call allocation in steady state.

Wrappers that still sit **above** the hook base (outer to inner, as measured):
`performance-debug.js` profiler (instance), `painterly-postprocess.js`
(instance, opt-in), `held-object-render-order.js` (replays),
`onboarding-character-creation-camera-composition.js`,
`natural-surface-stretch-post-jigsaw.js`, `outline-render-performance.js`.
Also instance-level: `dynamic-surfaces.js` (constructor; its before-render
clients drive ruin puzzle frames with their own `dt`, so it stays per top-level
call). `zone-grass-billboards.js`' old town
height wrapper never installs (the town bridge marks the renderer first). Note: `held-object-render-order.js`'s "raw"
replay render (`unwrapRendererRender`) stops at the onboarding wrapper (no
marker), so replays go through the full lower chain, hooks included. Migrate
these into `RenderHooks` when you next touch them for another reason.

The static dense-wall matrix experiment is an explicit producer contract, not a
visibility rule. BorderTerrain enrolls only flat wall groups after attaching
them to the scene. Their placements live in instance buffers; before any new
leaf local-transform, manual-matrix or custom-update writer, call
`DenseForestWallBatches.invalidateStaticMatrixBranch(leafOrRoot)` to retire it permanently. The existing
attachment observer retires modified hierarchies. Explicit subtree matrix
updates outside native scene recursion retain normal behavior. Pixel Probe
audits cached branches on demand; no continuous child scan. Keep this off by
default until a device comparison shows a gain.

Every hook module keeps a small legacy prototype wrapper used **only** when
`js/render-hooks.js` is absent (isolated tool pages and unit-test VMs).

**Known quirk — late prototype wrappers never reach the game renderer.**
`performance-debug.js` and `painterly-postprocess.js` wrap the game renderer's
*instance* `render`, capturing whatever the prototype chain was at that moment.
A prototype wrapper installed later is skipped by the game renderer.
`social-action-wheel.js`'s `socialActionWheelRender` (dance hand snapshot/restore)
is one: it sits on top of the prototype chain but has zero samples in a gameplay
CPU profile. Migrating it to a `RenderHooks` hook would make it run for the first
time, so check dance hand poses visually when you do. Hooks registered with
`RenderHooks` don't have this problem; they run at the base regardless of load order.

## 5. Render scopes (`WorldRenderPipeline.registerRenderScope`)

Objects hidden or merged for drawing only. `suspend(ctx)` runs before the first
pass and returns a restore function; restores run in reverse order in `finally`.

| Order | id | Owner | Effect |
|---|---|---|---|
| 100 | `farm-tile-batches` | farm-tile-render-batches.js | farm ground tiles → 8×8 merged batches; outside wilderness zones also children tagged `hobunjiStaticBatchable` of scene-level groups tagged `hobunjiStaticBatchGroup` (town NPC farm plots, authored house faces) → merged per 8×8 cell + render state, as render proxies with no terrain tags |
| 200 | `zone-prop-batches` | zone-prop-render-batches.js | still wilderness props (tents, camp furniture, berries, herbs, totems, nests, ore-rock stones) → merged per 8×8 cell + material |
| 250 | `wilderness-tree-instancing` | wilderness-tree-instancer.js | **off by default** pending device A/B. Opted in: drawn, non-fading procedural trees/bushes → one InstancedMesh per shared variant part per 8×8 cell; tracked by camera and replay bounds |
| 270 | `dense-forest-wall-batches` | dense-forest-wall-batches.js | Cloud Forest dense wall: opaque, on-camera chunk parts → one InstancedMesh per part across chunks (background scenery, never in a replay); trees ≥ 12 tiles from the camera draw their roots, branches and vines with `FoliageGenerator.liteTreeGeometry` twins (same spines, fewer rings/sides; a fading part is never merged: swapped in place when all its trees are far) |
| 300 | `npc-view-cull` | npc-view-frustum-cull.js | off-camera NPC walkers hidden |
| 400 | `grass-chunks` | grass-billboard-render-chunks.js | farm/town grass → spatial chunks |
| 450 | `instanced-brick-lod` | instanced-brick-lod.js | WallBuilder default-brick (`Roughbrick1.glb`) meshes whose nearest brick is ≥ 14 tiles away swap to a 12-triangle octant hull of the brick (same bounds, flat-shaded, uv copied), restored after the frame |
| 500 | `instanced-view-cull` | instanced-mesh-view-cull.js | off-camera instanced walls/grass hidden |
| 600 | `wilderness-distance-cull` | wilderness-distance-cull.js | far static wilderness geometry hidden |

Add a new draw-only cull or batch by registering a scope from its own module,
not by editing `renderFrame`. Every render optimisation switch (these scopes'
`setEnabled`, the held/x-ray replay A/B setters, frame-scoped hooks, tree
instancing, faceted rocks, rain/cloud draw hiders) has a persisted toggle in
Settings → Render optimizations (perf testing), owned by
`js/render-optimization-settings.js` (dev-only; last script of the render
group). When you add a switch, add its row to that module's `TOGGLES` list. A scope that hides meshes another pass masks by
name should flag them `userData.hobunjiDrawProxyHidden` while hidden: Perception
Mode then still draws them into its glow mask (the tree instancer does). Prop batching groups by `material.id`: share one
material between identical props (as `wild-berries.js` now does per colour) or
they can never merge. A material array that repeats one material over groups
covering the whole geometry (the natural rocks' ridge-split top/side slots)
counts as that one material. Compile hooks block merging unless the material
is marked `userData.hobunjiWorldBakeSafe` or the hook itself sets
`__hobunjiWorldBakeSafe` (the held x-ray elevation hook does when what it wraps
is safe). Cells use each mesh's world-space geometry centre, since ore rocks
are built in world space under an identity transform. Batch meshes carry
`userData.hobunjiRenderProxy`, set before they are added: add-time surface
passes (natural-surface stretch runtime and runtime fixes) skip them, because
re-unwrapping a merged copy would replace its geometry. Ore-rock grass rims
are not merged: each has its own jigsaw material clone (a chunk texture lease)
and the furniture-ID `onBeforeRender` hook.

## 6. Character visuals (player, NPCs, enemies, pets — one system)

A character visual is written for **any** character. The player is one
character among NPC walkers, humanoid enemies (bandits, tribes, ghouls,
skeletons, liches), creatures, companions, mounts, shoulder pets, corpses and
farm animals. Enumerate them with `CharacterVisuals.forEachCharacter(area,
visit)` (game.js registers the provider) instead of reaching for `playerMesh`
or one collection, and never read the player's state (mastery, plating,
equipment) to decorate someone else.

`CharacterVisuals.audit(area)` returns live counts by kind and this coverage
table (`CAPABILITIES` in `js/character-visuals.js`, keep it accurate):

| System | Covers | Gap |
|---|---|---|
| held tool/weapon planes (`character-held-tools.js`) | player, NPC, enemy | holder's own mastery/metal; metal variants per appearance |
| hat overflow plane (`hat-overflow-plane.js`) | player, NPC, enemy (split planes: `attachToPlanes`) | — |
| held bag-item plane (game.js) | player | NPCs never hold bag items |
| held-item x-ray through grass/ground (`held-object-render-order.js`) | player, short species (porakaneki) | other NPCs/enemies: hands ordinary depth, feet within 6 tiles only, weapons/tools in the base pass by default (user decision, ~11 ms on a GTX 1060; Settings → Render optimizations restores weapon x-ray) |
| procedural hands, pants, ground shadow, outline occlusion, rig layers | all humanoids (shadow/occlusion/rig: every kind) | — |
| portrait life (blink/breath) | player, NPC | enemies keep static portraits |
| render-time body composition (`player-body-transform-composer.js`) | player (+ its pet) | NPC/enemy poses go straight through rig layers |
| terrain height | every kind (movement-owned for humanoids; render lift for animals) | — |
| water/slush tint | player, NPC, enemy, pet | — |
| mist depth silhouettes | every kind | — |
| carried family baby (`family-baby-burdens.js`, `family-baby-limbs.js`, `Shattercasks.solveCarryMount`) | player, NPC (spouse) carriers — same pose, grips, elbows, back stow | — |
| shoulder-pet perch | player | runtime is owner-generic; only the player owns a pet in gameplay |
| weather on bodies (wetness, snow, wind) | none | absent for everyone |

Rules:
- New per-character visual → take the character (or its holder/owner) as a
  parameter. If it can only serve the player for now, add a `CAPABILITIES`
  entry with a `gap`, so the audit shows it.
- Held items: build through `CharacterHeldTools.makeToolPlaneMesh(key, { holder })`.
  Omitting `holder` means the player. A holder may define
  `weaponMasteryLevel` and `weaponMetalOptions(itemKey)`; otherwise it shows
  no mastery effects and fresh base metal. Bandit definitions are passed as
  the holder, so loadout data can author both.
- Terrain/weather response that moves or re-materials a character while
  drawing belongs in a `frame` `RenderHooks` hook (see the elevation hooks),
  so every pass sees the same pose.

## 7. Cookbook

| I want to… | Do this |
|---|---|
| Change outline thickness / colours | `docs/config/outline-rendering.json` |
| Give a mesh a shell outline | `WorldRenderPipeline.markShellOutline(obj)` (game.js: `_markOutline`). Never on PNG planes or alpha-cutout cards (`userData.noOutline`). |
| Seam lines between furniture parts | `WorldRenderPipeline.markMaterialSeamId(obj)` (off unless the seam setting is on) |
| Make a new authored PNG plane | `HobunjiSpritePngSurface.makeCanvasTexture` + `makeMaterial` (AGENTS.md) |
| Pose/offset something only while drawing | `RenderHooks.register({ scope: 'frame', … })` |
| Hide or merge things only while drawing | `WorldRenderPipeline.registerRenderScope(...)` |
| Add a pass | Add it in `renderOutlinedPasses`/`renderDirectPasses` with a `pass('name')` label and a PerfProfiler bucket; add a layer to the registry; update §1 |
| Change wilderness tree culling/fade | `js/zone-vegetation-cull.js` (corridor), `js/zone-tree-fade.js` (animation). A tree whose corridor-edge fade has settled at opacity 0 (`ZoneTreeFade.isFadedOut`) is left undrawn until its target rises (A/B `ZoneVegetationCull.setHideFadedOut(false)`); the corridor hysteresis still counts it as in view. `js/wilderness-tree-instancer.js` can draw opaque trees as instanced batches per shared variant part, within spatial 8×8 cells, but it remains off by default pending verification against the old corridor-wide net loss: `WildernessTreeInstancer.setEnabled(true)`, benchmark variant `treeInstancingOn` |
| Draw held items in front of grass/water | `js/held-object-render-order.js` + `js/xray-hierarchy.js` rules |
| Give NPCs/enemies a visual the player has | §6: enumerate with `CharacterVisuals`, take the character as a parameter, update `CAPABILITIES` |
| Change how a weapon looks in an enemy's hand | its holder: `weaponMasteryLevel` / `weaponMetalOptions` on the bandit definition |
| Change loose rocks (look) | Farm rocks: `TerrainGeometry.buildRockTileGeo` mound + `NaturalSurfaceMaterials.naturalizeMesh(mesh, 'rocks')` (cliff-stretch islands, no shell). Ore rocks reuse it via `js/faceted-rocks.js` `buildOreRock` (tinted with `OreRockTextures.rockTintFor`) and are kept out of the chunk jigsaw bake (`userData.facetedRock`). Any other hard-edged stone mesh: `FacetedRocks.surfaceStone(mesh, { tint })` (visual-authoring.md §2) |
| Change what fills wilderness statue footprints | `js/statue-ruin-debris.js`: Debris-ifier V50 outdoor `tiny` ruins (topple/burial/density max) + per-piece damage pass (`SUPER_RUINED`), merged per variant and surfaced once with `FacetedRocks.surfaceStone` (inked rock PNG per detected face, no shell), placed by `game.js`'s zone floor builder on `rockKind: 'statue'` tiles |

## 8. Debugging

```js
WorldRenderPipeline.captureFrame();          // next frame: every native render
WorldRenderPipeline.lastCapture().passes     // [{ pass, worldScene, sceneAutoUpdate, layers:[names], override, target, draws, triangles, ms }]
WorldRenderPipeline.lastCapture().mainMatrixCensus // Draw-state graph after scopes/hooks, including hidden descendants.
WorldRenderPipeline.lastCapture().scopeTimings // One-shot scope preparation elapsed ms.
WorldRenderPipeline.snapshot()               // last frame: native renders, scopes, errors
WorldRenderPipeline.setScopeEnabled('zone-prop-batches', false) // A/B one scope
RenderHooks.getDebug()                       // hooks in order: calls/applies/skips/errors
CharacterVisuals.audit('map_western_slope')  // characters by kind + which visual systems cover them
await CharacterVisuals.captureVisibilityReport() // "X is invisible": per character part — hidden ancestor, position, layers,
                                             // frustum, material flags, drawn in the last main pass? + hook/scope errors
                                             // (also Settings → Dev Tools → "Character visibility report", copies the text)
CharacterHeldTools.snapshot()                // player vs holder meshes, per-appearance metal variants
CloudForestAvatarDepthOccluder.snapshot()    // mist depth helpers per character part
RenderABBenchmark.run()                      // ON-DEVICE (~45 s; also Settings → Dev Tools → "Render A/B benchmark", copies the report):
                                             //   variants default / outlinesOff / painterlyOff / halfResolution / nearForest / fadedTreesDrawn / treeInstancingOn / propBatchesOff / gearParticlesEveryPass / npcWeaponsXray / skinnedScissorOff / mistOff / rainOff / cloudsOff
                                             //   (+ frameScopeOff via { variants: [...] }): fps, p90, render CPU, triangles, GPU where timer queries exist;
                                             //   per-pass CPU+draws for default, plus a readPixels-synced per-pass CPU+GPU window where
                                             //   timer queries are missing. halfResolution much faster ⇒ GPU fill-bound, not JS.
                                             //   also: held/x-ray replays per frame (scissored vs fullscreen + reason) and the
                                             //   top draws per pass for one sampled frame (what actually fills each pass)
?renderContext=lean                          // reload flag: no canvas MSAA, no preserveDrawingBuffer (report shows the context attributes)
HeldObjectRenderOrder.snapshot()             // replay scissor/fullscreen counts + reasons, culled/kept, colorOnlyDepthSkips
HeldObjectRenderOrder.setColorOnlyDepthSkipEnabled(false) // A/B: draw no-op VFX (enchantment motes) in colourless replays again
HeldObjectRenderOrder.setGearParticlesOnceEnabled(false) // A/B: particles on held gear (enchantment motes, weapon-layer fire) drawn in the base
                                             //   pass and every replay group again; on (default) they draw once, in the overlay of the
                                             //   group holding their gear; that group's scissor and far depth include them (enchantment
                                             //   motes through their plane's aura padding). VFX parented outside its gear joins with
                                             //   linkGearParticle(particle, gearMesh) (the held dungeon-fire plume). Particles of gear that
                                             //   does not x-ray (other characters' weapons) stay out of every overlay render
HeldObjectRenderOrder.setHeldOwnerLinkEnabled(false)   // On by default: scene-sibling weapons (BanditCombat/walker tool holders) resolve to their
                                             //   bearer via userData.hobunjiHeldPortraitOwner. Off: the unowned fail-safe path, which costs
                                             //   every armed hostile on screen one extra "ordinary" held-replay group
HeldObjectRenderOrder.setOtherWeaponXrayLimit(n)       // only the n armed non-player actors nearest the camera keep weapon x-ray. Default 0: other
                                             //   characters' weapons and tools draw in the base pass with their bearer (fogged by mist like
                                             //   them, plain depth against grass). Player and short-species gear keep x-ray. Settings →
                                             //   Render optimizations → "NPC and enemy weapons in the base pass" off = link off + Infinity
HeldObjectRenderOrder.setSkinnedScissorEnabled(false)  // A/B: skinned bodies force full-screen held/x-ray replays again (reason skinned-mesh).
                                             //   On (default) they are bounded per bone; a hook that can re-pose a mesh at draw time
                                             //   still falls back ('skinned-draw-hook') unless it publishes __hobunjiXrayBoundParity
                                             //   (hand/foot/portrait outline-parity adapters do: both poses are bounded).
RenderHooks.setTiming(true)                  // per-hook ms
RenderHooks.setEnabled('crop-sprite-art', false) // A/B one hook
HobunjiRenderLayers.describe(mask)           // bits → names
PerfProfiler.setEnabled(true)                // 'render: main scene', 'render: shell outline', …
```

Pixel Probe arms the existing one-shot world frame capture and copies it alongside
the logical outside-scope census. The capture marks failed world frames incomplete
and rejects old captures from before arming or another area. Each native pass records
the r128 scene.autoUpdate flag before native rendering, not a measured matrix time.
The draw-state census runs once before the first main-camera submission, excluded
from the pass timer; its counts describe candidates, not actual visited nodes under
custom matrix updaters. Scope timing covers preparation only. Ordinary frames never
run these diagnostic walks or timing calls.

If a visual is wrong only in one pass (e.g. its outline is offset from the
sprite), capture a frame and compare which passes draw it and with which layers
before touching materials.

## 9. Performance notes

See `docs/architecture/performance-investigation-log.md` for measurements. In
the wilderness the frame is small in geometry; cost is draw submission plus the
JS around each render call. Per-pass JS is multiplied by ~17, which is why
presentation work belongs in `frame` hooks and why new wrappers are banned.

On real devices the GPU side matters as much: with outlines on (the default)
every pixel goes through the main pass into `_mainRT`, then the composite, and
`js/painterly-postprocess.js` (default `medium`) adds three full-resolution
filter passes (a 7×7 oil kernel spread ±10 px, two wash passes) plus a 9-tap
finish inside the composite. `outlinesOff` therefore removes painterly too and
moves the world onto the MSAA canvas, so it is not a clean "outline cost" —
use `painterlyOff` and `halfResolution` to separate fill cost from JS.

On a desktop GPU (GTX 1060 report, 20 Nov) the frame was draw-call bound: the
held-object and x-ray replays submitted more draws than the main pass. Anything
you parent to held gear (VFX sprites, glows) is drawn in the base pass and in
the held colour overlay. If its material writes no depth and no stencil it is
skipped in the colourless depth submissions (`hideColorOnlyHeldVfx`). Keep VFX
that way (`depthWrite: false`, no stencil) unless it must occlude. Every
separate sprite is a draw call in each colour pass that includes it.

### Kanthic engraving presentation

Kanthic only: after the main scene and (when enabled) mist/shell depth restores, `CloudForestFog` applies the existing lighting canvas as a fullscreen texture without clearing depth, then renders the occupied room/shaft's original additive glyph geometry against the same depth buffer. The DOM lighting canvas is hidden only when already applied on the GPU and restored outside the effect. Other traditions retain their existing Canvas2D radial illumination. The original scene's glow visibility is restored in the world frame's finally block. No scene-wide depth raycasts, CPU atlas triangle projection or platform silhouette clipping are used for Kanthic.

The two auxiliary draws use the named `KANTHIC_GLYPH_DEPTH` camera layer, so neither is classified as a main world draw by the held-object X-ray replay. The camera layer mask and renderer clear flag are restored even when a depth draw throws.

The Kanthic redraw selects meshes by cached world-space bounds, then clips their fragments against the occupied region's world-space planes. A wide wall may span multiple rooms; a tall shaft panel is not rejected on its center height. Source material clipping state and renderer flags are restored transactionally. Lighting uploads are bounded to 524,288 pixels with a reusable downsample canvas and tracked by paint revision rather than timestamp. The GPU darkness pass sits below the DOM gameplay overlay; during unowned corridors or transition fades the existing DOM darkness path is retained.

Before world rendering, the Kanthic owner prepares the ordinary lighting canvas; its resize-recovery path is not allowed to execute while mainRT's depth is bound. The glyph pass disables all autoClear flags (Color backgrounds otherwise force a clear) and restores them after direct PNG depth replay and glyph drawing. Camera-frustum rejection prevents empty glyph frames from invoking the GPU darkness pass.


### Generated outline modes

Settings → Render optimizations → Generated outlines selects
`screen` (default), `shell` or `none`. The ordinary Outlines
setting remains the master offscreen/composite switch. The A/B benchmark
compares `shellOutlines`, `screenDepthOutlines` and
`generatedOutlinesOff` while preserving painterly and the master setting.

Screen mode replaces the expanded-shell pass and its selective shell X-ray
replay with one unexpanded front-facing depth draw on the existing
SHELL_OUTLINE layer. The mask target is allocated only when used, resized
with the main target, and disposed when leaving screen mode. Existing
outline pass classification allows base-matrix reuse. The composite accepts
only pixels whose mask depth matches the world depth, then samples four
neighbors twelve render-target pixels away to detect an inward silhouette or
substantial depth discontinuity. Authored PNGs and
hard-faced textured meshes are excluded by the existing shell-layer policy;
an unrestricted world-depth Sobel filter would violate that policy. Standard
scene fog fades the generated ink. With painterly active, the existing composite
first writes the outlined world into the reusable tone target, then the original
oil/wash/tone/finish stack processes both authored and generated ink together.
Oil consumes that source before tone overwrites it; no additional render target
or world draw is needed. Shell/none and painterly-off frames skip the extra
composite. The final canvas draw disables already-applied outlines temporarily,
so world text and Perception Mode still appear after the filter. Render A/B's
`paintBeforeDepthOutlines` variant compares the previous order; the painterly
snapshot reports `outlineFirst` and `outlinedFrames`. Reticle highlights, actor probes, PNG occlusion depth, water/color
X-ray and perception overlays remain independent.

This is deliberately a selective-mask experiment, NOT a zero-geometry-pass
implementation: sampling the current depth alone cannot identify authorized
outline surfaces, and the r128 world materials have no common eligibility
channel. Depthless transparent foreground effects, restored ground depth
over X-rayed limbs, and custom mist can differ from the original shell
appearance.
Recording-renderer fixtures exercise all three modes, resize, disposal,
error restoration and persistence; real WebGL visual parity and FPS are not
yet established.


## Pixel Probe bounded gameplay timing

Arm Pixel Probe, allow 10–20 seconds of normal gameplay, then tap and copy
its report. The bounded session ends automatically at 20 seconds or 1,200
sampled frames; the tap ends it before diagnostic rerenders. A temporary
late RenderHooks hook times outer native submissions and, where enabled,
the actual scene-instance matrix walk (preserving the static-wall hook
and original property descriptor in reverse-order cleanup). It records
pass/layer/stage and matrix-walk versus matrix-reuse separately. The
one-shot main-frame static-wall audit now runs after native rendering
inside the live scopes, not after Pixel Probe rerenders. Render timings
are inclusive CPU wall time, not GPU timing, and nested native submissions
are not separately attributed. Explicit between-frame timing brackets
are reported separately. No continuous scene census is introduced.


### Gameplay window v2: stalls

Pixel Probe also records bounded worst scheduler frames and RAF
intervals, their preceding callback duration and actual gap between
callbacks, and the terminal interval if expiration occurs at the next
scheduler boundary. Browser long-task and long-animation-frame entries
are observed only during the window where supported. The worst entries
include bounded script attribution and forced layout time; page focus
and visibility transitions help distinguish background throttling.
Observer reports cover completed entries wholly inside the capture,
not necessarily every browser task. They are overlapping evidence,
not an exclusive CPU breakdown or GPU timer.
