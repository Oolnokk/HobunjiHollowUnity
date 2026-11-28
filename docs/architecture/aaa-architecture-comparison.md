# How the frame compares with AAA engine architecture, and why it is CPU-bound

Analysis of 28 Nov 2026 at `5746a546`. No game code was changed. Everything here is either
(a) quoted from `performance-investigation-log.md` with its date, (b) counted from the source
at this commit, or (c) measured in this session's headless run (software GL, 640x360). Section 6
says which numbers transfer to a real GPU and which do not.

## 1. Verdict

The game is **submission-bound on one thread**, not GPU-bound and not fill-bound. Every real-device
reading in the log says so (section 2.1), and the latest corrected readings put render submission
alone at ~35 ms against a 16.7 ms budget for 60 fps.

The root cause is structural and multiplicative:

1. The art style (PNG paper-doll characters, ink outlines, hands and feet that must not sink into
   the ground) is implemented by **drawing the world several times per frame** (10-17 native
   `renderer.render` calls) through a general-purpose scene graph.
2. Each of those calls, on Three.js r128, **walks every node of the scene** to decide what to draw,
   even when a layer mask will reject nearly all of them. The Cloud Forest scene has 5,885 nodes,
   62% of them hidden.
3. Everything that follows (sim, traversal, submission, HUD DOM, canvas texture work, path search,
   saves) shares **one thread**, and WebGL draw submission is roughly an order of magnitude more
   expensive per call than the native APIs AAA engines target.

A single AAA frame answers the same questions once and shares the answers. This frame answers them
per pass, per system, per module. That is why the log's 94 sections of real fixes (typically 10-30%
of the draws in the scene each one targeted: 2,291 -> 2,050, 1,833 -> 1,614, 1,411 -> 1,022) still
leave the device at 6-16 FPS in a fight: the structure re-multiplies whatever is saved.

## 2. What the evidence says

### 2.1 Real-device readings (from the log)

| Date | Device and scene | Reading | Meaning |
| --- | --- | --- | --- |
| 14 Nov | desktop, Opera GX, outdoors | GPU 8-14% busy, frames 44-76 ms | CPU-bound; "the lever is draw calls per frame" |
| 20 Nov | GTX 1060, Cloud Forest, 1850x858 | 13.2 fps; ~2,470 draws; render CPU 56.9 ms vs GPU 46.2 ms; half resolution changed nothing | draw-call bound. ~23 us per draw, JS between draws included |
| 26 Nov | same card, fight, Painterly off | 75% resolution: 10.9 fps both before and after | CPU submission bound |
| 26 Nov (corrected) | same card, 6 bandits | painterly GPU cost ~4 ms (earlier "60 ms" was a different scene); 15.9 fps; render passes 34.7 ms; game logic "a few ms" | render submission is the budget |

Two consequences the log does not spell out:

- **The simulation runs in slow motion on this hardware.** `gameLoop` clamps `dt` to 40 ms
  (`game.js:26989`, `Math.min(0.04, ...)`). At 15.9 fps (63 ms frames) the world advances at ~63%
  of real time; at 6.5 fps (153 ms) at ~26%. There is no fixed-timestep accumulator.
- **Lag never lowers quality.** `mobile-render-budget.js` sets `const auto = false; // lag never
  lowers it`. That would not help anyway, because resolution is not the bottleneck, but it means
  nothing in the game reacts to the actual bottleneck.

### 2.2 Headless counts at this commit (this session)

Player alone, steady state, after `WorldRenderPipeline.captureFrame()` and `sceneMatrixCensus()`.

| | Town | Cloud Forest | Dev arena (empty) | Arena + 12 grunts |
| --- | --- | --- | --- | --- |
| Scene nodes | 3,249 | 5,885 | 179 | 1,325 |
| Hidden nodes at gameplay time | 470 (14%) | 3,670 (62%) | - | - |
| Hidden nodes at main-pass start | 1,881 (58%) | 4,150 (71%) | 57 | 386 |
| Nodes that recompute their local matrix every frame | 3,048 (94%) | 5,472 (93%) | - | - |
| `InstancedMesh` / `frustumCulled=false` / custom `onBeforeRender` | 197 / 459 / 164 | 1,000 / 1,188 / 331 | - | - |
| Unique geometries / materials | 1,916 / 541 | 2,167 / 1,298 | - | - |
| Triangles in every mesh (instances counted) | 2.3 M | **49.9 M** | - | - |
| Triangles in meshes flagged visible | 1.72 M | **18.4 M** | - | - |
| Triangles submitted by the main pass (all `main` renders, replays included) | 0.63 M | **0.67 M** | 0.09 M | 0.25 M |
| Native renders / draws / triangles per frame | 10 / 485 / 0.79 M | 13 / 182 / 0.68 M | 10 / 87 / 0.10 M | 12 / 341 / 0.34 M |

These are quiet frames, so draws are low; the device reports above are 2,000+ draws once
enemies, replays and the walk-around corridor are in. What matters is the shape:

- **The scene is authored as "everything exists, cull at render time".** The Cloud Forest holds
  49.9 M triangles of which 0.67 M are submitted: a ~75x reduction (27x from the 18.4 M flagged
  visible) done by hand-written cull systems every frame, not by a data structure that never
  lists the rest.
- **Render scopes hide and restore ~1,400 nodes every frame in town** (470 hidden at gameplay
  time, 1,881 at the main pass). The scene graph is both the gameplay representation and the
  render representation, and the pipeline converts one into the other on every frame.
- **The 1,887-node "static batch group" in town has `matrixAutoUpdate = true`** on every node
  (`autoLocalMatrices` equals `nodes` in that branch), so static geometry pays `updateMatrix`
  and `updateMatrixWorld` like a moving character.
- **An armed humanoid costs ~21 draws, ~20k triangles and ~96 scene nodes per frame** (12 grunts
  against the empty arena; +177 draws and +158k triangles in the main pass, +44 and +28k in PNG
  depth, +33 and +57k in the outline mask). The rig is 5.3k triangles
  (log, 11 Nov), so every character is submitted about four times. Two extra native renders
  appear once several armed grunts exist (10 renders at 0 and 1 grunt, 12 at 6 and 12): the
  held-object replays. This is much
  better than 20 Nov (+96 draws per bandit, +370 for an armed one), so the work has paid; the
  multiplier is still there.
  (The 10 -> 12 render step is between 1 and 6 grunts; it was not bisected further.)

CPU profile over 26 s of steady frames (software GL, so the native `(program)` bucket is
SwiftShader and says nothing about a GPU; JS-side numbers are indicative):

| | Town (64 frames) | Cloud Forest (210 frames) |
| --- | --- | --- |
| JS per frame | ~43 ms | ~21 ms |
| Three.js internals | 31% of JS | 29% of JS |
| Matrix math (`updateMatrix`, `updateMatrixWorld`, `multiplyMatrices`) | 2.9 ms/frame | 2.4 ms/frame |
| `held-object-render-order.js` | 3.4 ms/frame | 1.9 ms/frame |
| `zone-prop-render-batches.js` `collect` | - | 1.0 ms/frame |
| Garbage collection | 0.7% | 0.1% |

So the top consumers are **the work of deciding what to draw** (traversal, matrices, frustum tests,
replay classification, batch collection), not the draws themselves, and **GC is not the problem**
in these windows.

## 3. Side by side with AAA engines

| Concern | AAA engines (Unreal, Unity SRP, Frostbite, id Tech) | This game | Effect here |
| --- | --- | --- | --- |
| Visibility | Persistent spatial structure (BVH, cells, octree) updated incrementally; one visibility result shared by every pass; HZB or software occlusion | Cell chunking exists for terrain, grass and wilderness, but no scene-level spatial index and no shared visibility result. 24 separate cull/LOD modules (`zone-vegetation-cull`, `npc-view-frustum-cull`, `wilderness-distance-cull`, `actor-render-occlusion`, ...) each scanning the graph. `entity-distance-lod.js` exists because "three independent systems each reimplemented the same math" | Visibility is recomputed per pass and per system. 18.4 M -> 0.67 M triangles by scanning |
| Frame structure | Render graph. Opaque geometry once, depth reused, outlines and edge detection read depth, normal and object-ID from the G-buffer | 10-17 `renderer.render` calls: main, held replays per elevation group, PNG depth, shell outline, target, mist, seam ID, composite x5, text | Cost scales with passes x nodes. "Anything that adds a render adds a full traversal" (log, 20 Nov) |
| Render representation | Gameplay world and render proxies are separate; static geometry baked offline; only dirty transforms flow to the renderer | One scene graph is both. Render scopes mutate visibility and swap in merged batches each frame, then restore | ~1,400 visibility toggles per frame in town; 58-71% of traversed nodes are hidden |
| Static vs dynamic transforms | Static objects never recompute | 93-94% of nodes recompute every frame, static batches included | 2.4-2.9 ms/frame of pure matrix math headless; the device log's "matrix walk" is 4-18 ms |
| Characters | One skinned mesh and 1-2 draws per LOD; crowd LOD and impostors; ~1-5k triangles at distance | Portrait skinned plane (front and back), pants garment, ~13 hand/foot meshes, weapon planes, outline shell | ~21 draws, ~20k triangles, ~96 nodes per grunt per frame |
| Ground clipping of limbs | Foot and hand IK against a terrain height query; depth bias on the limb layer | Re-submit scenery inside a scissor with a depth snapshot and restore ("x-ray replay"), per elevation group. `held-object-render-order.js` is 4,133 lines | Replays were 60-75% of all draws on 14 Nov, and the held-overlay replay costs 11-29 ms CPU across device reports |
| Draw API | D3D12, Vulkan, Metal: low overhead, multi-threaded recording, indirect and GPU-driven draws | WebGL through the browser's validation layer and ANGLE | ~23 us per draw on the GTX 1060 including JS. ~600 draws = ~14 ms |
| Threads | Game thread, render thread and job system, pipelined | One main thread does sim, traversal, submission, DOM HUD, canvas compositing and saves. Three workers exist (cavern SDF, animal voice, pixel jobs) | Sim and submission serialize: 34.7 ms render + other JS in one frame |
| Sim timing | Fixed timestep, render interpolation, bounded catch-up | Variable `dt`, clamped at 40 ms | Slow motion below 25 fps; frame cost and sim speed are coupled |
| Content pipeline | Offline cook: baked meshes, atlases, compressed textures, precompiled shaders | Zone meshes, mesa UV unwrap, trees and path networks generated at runtime on the main thread (first zone build 2.5-4 s); sprite recolor and clothing weave via Canvas2D readbacks (`getImageData` at 144 sites); no KTX2, Draco or Meshopt decoder wired | The class of hitch the log keeps finding: 8.0 s fish-catalog listener (moved to a worker 25 Nov), 33 ms failed A* (backoff added 14 Nov), 64-80 ms XP save (coalesced 26 Nov). Each was fixed; the pattern recurs |
| Adaptive quality | Dynamic resolution and quality scalers keyed to measured frame time | None. Settings are static (`setReplayParticipants`, `setFeetXrayDistance`, outline range) | The knobs that would help exist and are not driven by anything |
| Perf governance | Per-system budgets, automated capture on every build, regression gates | Strong tooling (`PerfProfiler`, Pixel Probe, scheduler timing, GPU timer queries, `captureFrame`, 94-section log, golden-hash equivalence tests) but no gate. Any module can add a pass or a draw | Wins decay as features land |
| Engine | Owned, current | Three.js r128 (2021). Later releases add `BatchedMesh` and async shader compilation. Code patches r128 internals (`rendererProto.render`, prototype hooks), 20 custom `ShaderMaterial`s | Upgrade is real work; see section 5 |
| Code and load | Packaged, stripped, streamed | 1,051 JS files (29 MB source, no minification), 469 parser-blocking `<script>` tags with `?v=` tokens, ~790 `window.*` globals, `game.js` at 35.6k lines | Startup and coupling cost, and why fixes land as wrappers rather than in an owner |

## 4. Causes, ranked by how much the evidence supports them

1. **Per-pass full-scene traversal on Three.js r128** (high confidence). `renderer.render` runs
   `projectObject` over every node each call; layers reject draws, not visits. 10-17 calls x
   3-6k nodes. Auxiliary passes (PNG depth, outline mask, replays) touch a few dozen objects but
   pay for thousands.
2. **Multi-pass character compositing** (high). ~4 submissions per character, ~6 draws each per
   pass; held replays rebuild depth for scenery. From the log: replays were 60-75% of draws
   (14 Nov); on 20 Nov, held replays (972) plus shell replays (509) were 1,481 of 2,470 draws.
3. **Visibility and batching done by mutation every frame** (high). Render scopes, 24 cull
   modules, 58-71% hidden nodes, 93% auto-matrix nodes.
4. **Single-threaded everything** (high on the principle, medium on the share). The log's time
   outside game JS (24 ms on 14 Nov; 11-92 ms across the 26 Nov probes, scene-dependent) is
   browser and driver work the game cannot overlap with its own simulation.
5. **Runtime generation and pixel work on the main thread** (high for hitches, low for
   average FPS). Matches the log's stalls; does not explain a steady 15 fps.
6. **Slow motion from the `dt` clamp** (certain, but a symptom). It makes low FPS feel worse than
   the number says.
7. **Skeleton updates per render call** (source-verified, not measured). In r128 `info.render.frame`
   increments on every `render()` when `info.autoReset` is true (it is never changed here), and
   `skeleton.update()` is gated on that counter. Each skinned mesh therefore rebuilds its bones
   and re-uploads its bone texture once per native render it appears in, not once per frame.
   With ~10 bones and 28 skinned meshes it is probably small. Count it before acting.
8. **JS heap size** (observation only). 432 MB in town and 583 MB in the Cloud Forest at steady
   state, ~1 GB briefly after boot. Not shown to cause stalls (GC was 0.1-0.7%). A heap snapshot
   would say what holds it.

## 5. What to do, in order

**Tier 1: days, low risk, measurable with the capture tools that exist**

1. **Freeze static transforms.** After building a static batch group, wilderness chunk, dense
   wall or path-brick chunk, set `matrixAutoUpdate = false` and call `updateMatrix()` once. Target
   the census: `autoLocalMatrices` should fall from 93-94% to the moving set (characters, props
   that animate). Bound: 2.4-2.9 ms/frame of matrix math headless.
2. **Add a pass-budget test.** `WorldRenderPipeline.captureFrame()` and `lastCapture()` already
   return per-pass renders, draws, triangles and node counts, and those counts transfer from
   software GL. Pin ceilings per scenario (quiet town, quiet Cloud Forest, arena + 12 grunts).
   This turns the log into a guardrail so a new pass cannot slip in unnoticed.
3. **Drive the existing quality knobs from measured frame time.** A governor that tiers down in
   a fixed order when render CPU exceeds budget for N frames, and recovers with hysteresis:
   outlines beyond the nearest ~8 actors, then replay participants to player-only, then a cheap
   NPC tier. Resolution is the wrong lever (log, 26 Nov); passes are the right one.
4. **Make `dt` honest.** Fixed-step sim (30 or 60 Hz, capped catch-up steps) with interpolation
   for presentation. It does not cut cost; it keeps the game at full speed and is required for
   deterministic co-op (`MULTIPLAYER.md`).

**Tier 2: weeks, structural**

5. **Stop walking the whole world for auxiliary passes.** Give PNG depth, outline mask and the
   replays a small actor-only scene (or reparent actor roots into one for the pass) so they visit
   dozens of nodes instead of thousands. Spike first: world matrices must match, and the replays
   need scenery depth from the main pass, not scenery nodes.
6. **Replace the x-ray replay for hands and feet with analytic placement.** The game has a
   tile-height lookup. Clamp feet and hands against it (the IK step AAA games use) and, if
   anything remains, a depth-bias layer in the main pass. Prototype on one character and diff
   pixels against the replay output; this is a hypothesis, not a measured result.
7. **Static batching at build time.** Merge once, keep the source meshes out of the render graph,
   and rebuild only on the existing invalidation events. This removes the ~1,400 toggles per
   frame in town and cuts traversed nodes by the hidden share.
8. **A one-draw character tier for distance.** Merge portrait, pants, hands and feet into one
   skinned draw over an atlas for NPCs beyond N tiles; no outline, no replay.

**Tier 3: months, strategic**

9. **Cook at build time.** Zone meshes, mesa UVs, trees and path networks into binary chunks loaded
   through a worker. This removes 2.5-4 s of first-visit main-thread work and a large amount of
   generator code from the hot path.
10. **Move pure computation off-thread.** Path search (33 ms failed A*), zone generation, save
    serialization. `PixelWorkYield` and `cavern-generator-worker.js` are the working models.
11. **Engine.** Upgrade Three.js (or evaluate a WebGPU path) only after tiers 1-2: the 20 custom
    shaders, `skinning: true` materials, colour-management changes and the prototype patches in
    `held-object-render-order.js` make it a migration, and it does not remove the multi-pass design.

## 6. What not to spend time on

The log already ruled these out; this analysis agrees:

- Painterly post-process: ~4 ms GPU measured (26 Nov correction).
- Lowering resolution: no change when submission-bound (20 Nov, 26 Nov).
- Instancing procedural trees: net loss on device (20 Nov).
- Another cull or LOD module: there are 24; the missing piece is one owner, not a 25th.
- GC tuning: 0.1-0.7% of the profiled windows.

## 7. Method and limits

- Headless Chromium, SwiftShader, 640x360, game booted through the normal creator flow, 2 min
  settle. **Counts transfer** (nodes, draws, renders, triangles, matrix census). **Times do not**
  (software GL inflates the native bucket; JS ms are indicative only).
- Frames measured are quiet ones (player alone, bandits asleep or absent), except the arena
  runs. Device draw counts in section 2.1 come from the log, not from here.
- Not measured: a real GPU, the skeleton-update cost, the heap's contents, and the effect of any
  recommendation. Section 5 gives where to measure each.
- Recipe to repeat the census from the console on any build:
  `WorldRenderPipeline.sceneMatrixCensus()`, then `WorldRenderPipeline.captureFrame()`, wait two
  frames, then `WorldRenderPipeline.lastCapture().passes`.
