# Visual render pipeline — read this before any visual change

This is the map of how a gameplay frame gets drawn, who owns each step, and
what you must not break. It exists so a change to one visual (an outline, a
billboard, a pose, a cull) does not silently change another. If you add or move
a visual owner, update this file in the same change.

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
| Held items / hands / feet over ground, x-ray, water tint | `js/held-object-render-order.js`, rules in `js/xray-hierarchy.js` | `HeldObjectRenderOrder`, `XrayHierarchy` |
| Matrix reuse between passes, world-text overlay | `js/outline-render-performance.js` | `OutlineRenderPerformance` |
| PNG sprite material/texture path | `js/portrait-utils.js` | `HobunjiSpritePngSurface` (see AGENTS.md) |
| Wilderness vegetation corridor cull + tree fade targets | `js/zone-vegetation-cull.js`, `js/zone-tree-fade.js` | `ZoneVegetationCull`, `ZoneTreeFade` |
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
| 100 | `death-mark-billboards` | frame | combat/combat-death-mark.js | Death-mark billboards face the camera |
| 200 | `drunk-prone-composition` | frame | drunk-prone-composition-bridge.js | publishes the drunk channel to the composer; bandit sway |
| 300 | `held-seed-reticle` | frame | held-seed-action-bridge.js | plant reticle material |
| 400 | `crop-ready-presentation` | frame | crop-ready-presentation.js | ready crops' resting pose |
| 500 | `crop-billboard-presentation` | frame | crop-billboard-presentation.js | crops anchored to soil under water |
| 600 | `heftroot-billboard` | frame | heftroot-billboard-bridge.js | heftroot planes face the camera |
| 700 | `crop-sprite-art` | frame | crop-sprite-art.js | crop billboards face the camera |
| 800 | `player-body-composer` | frame | player-body-transform-composer.js | composed player body, deadzone, head aim, neck limit, pants re-skin |
| 900 | `npc-performance-reaction-lock` | frame | npc-performance-reaction-lock-runtime.js | hides social targets of instrument-locked NPCs |
| 1000 | `npc-social-inhibition` | frame | npc-social-inhibition-runtime.js | NPC social facing / dance sway |

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
Also instance-level: `dynamic-surfaces.js` (constructor), the town/animal
elevation bridges and `zone-grass-billboards.js` (attached via Pixel Probe init),
`geometry-auto-lod.js` (opt-in). Note: `held-object-render-order.js`'s "raw"
replay render (`unwrapRendererRender`) stops at the onboarding wrapper (no
marker), so replays go through the full lower chain, hooks included. Migrate
these into `RenderHooks` when you next touch them for another reason.

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
| 100 | `farm-tile-batches` | farm-tile-render-batches.js | farm ground tiles → 8×8 merged batches |
| 200 | `zone-prop-batches` | zone-prop-render-batches.js | still wilderness props → merged per 8×8 cell + material |
| 300 | `npc-view-cull` | npc-view-frustum-cull.js | off-camera NPC walkers hidden |
| 400 | `grass-chunks` | grass-billboard-render-chunks.js | farm/town grass → spatial chunks |
| 500 | `instanced-view-cull` | instanced-mesh-view-cull.js | off-camera instanced walls/grass hidden |
| 600 | `wilderness-distance-cull` | wilderness-distance-cull.js | far static wilderness geometry hidden |

Add a new draw-only cull or batch by registering a scope from its own module,
not by editing `renderFrame`. Prop batching groups by `material.id`: share one
material between identical props (as `wild-berries.js` now does per colour) or
they can never merge.

## 6. Cookbook

| I want to… | Do this |
|---|---|
| Change outline thickness / colours | `docs/config/outline-rendering.json` |
| Give a mesh a shell outline | `WorldRenderPipeline.markShellOutline(obj)` (game.js: `_markOutline`). Never on PNG planes or alpha-cutout cards (`userData.noOutline`). |
| Seam lines between furniture parts | `WorldRenderPipeline.markMaterialSeamId(obj)` (off unless the seam setting is on) |
| Make a new authored PNG plane | `HobunjiSpritePngSurface.makeCanvasTexture` + `makeMaterial` (AGENTS.md) |
| Pose/offset something only while drawing | `RenderHooks.register({ scope: 'frame', … })` |
| Hide or merge things only while drawing | `WorldRenderPipeline.registerRenderScope(...)` |
| Add a pass | Add it in `renderOutlinedPasses`/`renderDirectPasses` with a `pass('name')` label and a PerfProfiler bucket; add a layer to the registry; update §1 |
| Change wilderness tree culling/fade | `js/zone-vegetation-cull.js` (corridor), `js/zone-tree-fade.js` (animation) |
| Draw held items in front of grass/water | `js/held-object-render-order.js` + `js/xray-hierarchy.js` rules |

## 7. Debugging

```js
WorldRenderPipeline.captureFrame();          // next frame: every native render
WorldRenderPipeline.lastCapture().passes     // [{ pass, layers:[names], override, target, draws, triangles, ms }]
WorldRenderPipeline.snapshot()               // last frame: native renders, scopes, errors
WorldRenderPipeline.setScopeEnabled('zone-prop-batches', false) // A/B one scope
RenderHooks.getDebug()                       // hooks in order: calls/applies/skips/errors
RenderHooks.setTiming(true)                  // per-hook ms
RenderHooks.setEnabled('crop-sprite-art', false) // A/B one hook
HobunjiRenderLayers.describe(mask)           // bits → names
PerfProfiler.setEnabled(true)                // 'render: main scene', 'render: shell outline', …
```

If a visual is wrong only in one pass (e.g. its outline is offset from the
sprite), capture a frame and compare which passes draw it and with which layers
before touching materials.

## 8. Performance notes

See `docs/architecture/performance-investigation-log.md` for measurements. In
the wilderness the frame is small in geometry; cost is draw submission plus the
JS around each render call. Per-pass JS is multiplied by ~17, which is why
presentation work belongs in `frame` hooks and why new wrappers are banned.
