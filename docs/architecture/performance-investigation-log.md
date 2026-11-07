# Performance investigation log

Read this before you start chasing a "the game gets slow, especially in the wilderness after fights" report.
It records what was measured, what turned out to be the cause, and — just as important — what looked like a
cause and was **not**, so nobody spends another session re-ruling those out.

Everything below was measured in the headless harness (see
[`.claude/skills/headless-game-test/SKILL.md`](../../.claude/skills/headless-game-test/SKILL.md)) unless it says
"real hardware". The sandbox has no GPU: WebGL is software-rendered at roughly one frame per second. **Draw
call, triangle, scene-object and heap counts are exact. Millisecond figures are only good for comparing two
conditions on the same machine; they are not what a player sees.** Counts come from `renderer.info`; JS time
comes from CDP CPU profiles. One headless world per run, and bandit/tribe camps are random, so repeat anything
close before trusting it.

## What the symptom turned out to be

"Slow in the wilderness, gets worse after fights, never recovers" had **two** causes, both fixed:

| Cause | Why it was invisible | Fixed by |
| --- | --- | --- |
| A settled, un-looted bandit corpse keeps its whole humanoid rig forever (~90 scene objects, ~50 draw calls each, in every render pass). | Wildlife corpses stream to data (`isStreamableCorpse`), but it excludes `isBandit`, so fights piled up bodies that never went away. | `Oolnokk/HobunjiHollowUnity#1465` — `docs/js/bandit-corpse-retirement.js` |
| The inactive-zone cache could not evict any zone that had a bandit in it, so zones stayed built (~175 MB each). | `zoneEvictionBlocker` treats every bandit, alive or dead, as a resident rig; one or two idle bandits per zone pinned all four zones. | `Oolnokk/HobunjiHollowUnity#1469` — `docs/js/zone-bandit-release.js` |

Numbers (headless, per frame):

- 30 bandits killed through the real death path: draw calls 252 (empty arena) → ~1,700–1,900 alive → **1,864 five
  minutes after every one was dead** (no decay at all; the alive and after figures come from separate runs, which
  differed by about 10%). After #1465 and walking away: 734 draw calls and 778 scene objects instead of 1,864 and
  2,962.
- Four wilderness zones visited with a return to town between each: before #1469 all four stayed built and the JS
  heap (after a forced GC) went 319 → 1,026 MB; after, one zone stayed built and the heap ended at 796 MB.

### Barbarians (Porakaneki / Omgurku hunters) are covered by both fixes

They *look* like a separate system, and parts of their lifecycle are, but their corpses and zone residency go
through the bandit path:

- They are built by `BanditCombat.makeEntity`, which sets `isBandit: true` unconditionally; the tribe flags
  (`isTribeHunter`, `tribeId`, older `isPorakanekiHunter`) are merged in afterwards and do not clear it. Verified
  in-game on 11 materialized hunters: `isBandit: true`, `isTribeHunter: true`, no `keepCorpseAfterLoot`, no
  `lootHoldSeconds`.
- A hunter that dies while materialized (player in its chunk) becomes an ordinary corpse and the tribe update
  loop then skips it for good (`if (hunter.entity?.health <= 0 …) return`), so nothing ever tears it down. Only an
  off-screen death (`slayHunter`) leaves no body, and only those are ever replaced (`replaceSlainResidents`).
- **What *is* different:** a *living* hunter the player moves away from is hidden under
  `__porakaneki_dormant__:<zone>` and torn down 3 s later (`retireDormantEntity`). While dormant its `areaId` does
  not match the zone, so it is never a zone resident and never pins eviction.
- Camps are large: a small camp has 13–15 residents (15–17 hunter records) and a chief camp 6, against 2–4 bandits in
  a bandit camp, and all four wilderness zones had at least one Porakaneki camp. That, not a different mechanism, is why barbarian fights dwarf bandit
  ones.
- Measured: 11 tribe hunters killed, player walked away: the default corpse cap swapped 5 of 11 (the other 6 keep
  rigs by design); with the cap lifted 11 of 11. Leaving the zone then released all 11 and evicted it (642
  materials, 257 textures freed). No page errors, and re-entering was fine.
- Loose end, harmless so far: after the release the tribe's own camp record still says `materialized: 11`, i.e.
  `hunter.entity` still points at the despawned dead entities. The 11 stay dead (as before) and nothing throws, but
  the entity objects themselves are retained by the camp record.

## Looked like the cause, was not

| Suspect | Verdict | Evidence |
| --- | --- | --- |
| **The player's character data** (a save with ~400 KB of woven clothing, 15 embedded PNGs, 8 stable creatures, a companion and a mount). | Not the cause. | The same world with that character and with a default one: draw calls 1,338 vs 1,870, triangles 4.0 M vs 4.4 M, heap 298 vs 441 MB. The custom character was not heavier. |
| **The wilderness terrain / zone scene itself.** | Not the cause. | Standing idle in a built zone: 571 draw calls and 0.87 M triangles per frame, lighter than the town (1.3–1.9 k, ~4 M). The cost is entities (bandits, tribes, corpses), not ground, foliage or cliffs. |
| **"The town gets 2.7× heavier after visiting the wilderness."** | Artifact. | In the headless run the opening-story sequence finishes late and spawns a companion and an armed Spearhead in town at about the same moment. Visiting a zone does not do it. |
| **The dev arena's "Kill All" button as a way to kill bandits.** | Does not kill. | It makes one `damageCreature(c, c.health)` call per bandit, which dodge frames, damage blocking and multipliers reject: 29 of 30 were still alive and fully active 5 minutes later. "Cost after Kill All" measurements are measurements of living bandits. Use `damageCreature(c, big, x, y, 0, { environmentalImpact: true })` to kill through the real death path. |
| **Outline passes as the cause of the *persistent* slowdown.** | Not that cause, but see "Real but not fixed". | Toggling outlines showed no clear effect in a town test (the scene was still loading between the two phases, so the comparison was noisy); the cost shows when many outlined characters are present. |
| **Wildlife not being evicted.** | Works. | Wildlife drops to data at trim time (`releaseResidentRigs`); in the zones that stayed built the only pins were bandits. |

### Measurement traps (these produced wrong conclusions at least once)

- **`renderer.info` is reset on every `render()` call**, so reading it after a frame shows only the last pass
  (typically `calls: 1, triangles: 2`, the fullscreen composite). Set `renderer.info.autoReset = false` and reset it
  yourself once per frame. Note `info.reset()` also increments `info.render.frame`, so that counter is *not* a render
  count.
- **The `[outline-perf]` log lines are totals over a logging window, not per frame.** `base 6x` is six passes in
  the window.
- **`PerfProfiler` subsystem averages are not windowed per phase**; two phases printed identical numbers. Use a CDP
  CPU profile per phase instead.
- **Do not wrap `THREE.WebGLRenderer` from an init script** (it breaks `dynamic-surfaces.js`, already in AGENTS.md).
  Hook `window.__hobunjiGameRenderer.render` after it exists.
- **Wait out the opening story.** With `?skipIntro=1&skipRescue=1&skipMeeting=1` it still completes in the background
  (log line `opening sequence complete`), and then teleports the player to town about a minute later, which looks
  exactly like "the player got bounced out of the zone". Wait for that line plus ~100 s before entering anything.
- **The wilderness is locked until the farm tour is done.** `enterZone` returns silently (with a toast) otherwise.
  In a throwaway test profile, `OpeningStoryCutscene.updateStory(profile, { farmTourComplete: true })` unlocks it;
  setting the legacy localStorage key does not, because the world's saved story record wins.
- **A zone's entry tile is its exit tile** (e.g. `map_western_slope` is 48,20), so `enterZoneDebug(zone)` with no
  coordinates drops the player on the exit gate. Pass an interior tile.
- **Screenshots time out in the wilderness** (a software-GL frame can take more than 30 s). Make them optional.
- **Bandit counts in a zone drain on their own** (several down to 0 within about a minute with the player idle,
  without leaving corpses). That is existing behaviour and its cause was not investigated; it is why the number of
  bandits pinning a zone varied between runs. Camps themselves (the `BanditCamps` records) stay.
- Piping a log watcher through `cut` buffers it and delivers nothing for minutes; use `grep --line-buffered` only.

## Heap growth across zone visits (retainers found and mostly fixed)

After #1469 only one zone stays built, but the JS heap still climbed with every visit. This was run to ground with heap
snapshots. Read the method first; two earlier readings of this problem were wrong.

**Method that worked.** Eight visits (each of the four zones twice: 25 s in the zone, back to town, 16 s for the trim)
after the opening story. Three full heap snapshots (`HeapProfiler.takeHeapSnapshot`, after two forced GCs): baseline,
after visit 4, after visit 8. V8 object ids are stable inside one process and a new object always gets an id above the
previous snapshot's maximum, so "created during visits 1-4 and still alive after visit 8" is `id in (max0, max1]` in the
last snapshot. Group those by their shortest retaining path from the GC roots (BFS over strong edges; skip weak and
shortcut edges) and look at which named properties and closure variables sit on the path. Snapshots are 450-950 MB
files, so parse them with a streaming reader, not `JSON.parse`. Allocation-site profiles (`HeapProfiler.startSampling`)
say *who allocated* the surviving bytes, not *who holds them*; they sent this investigation to the wrong modules for a
while (water outline, terrain geometry) because those allocate a lot of data that is then correctly freed.

**Numbers.** Surviving objects created in visits 1-4 and alive after visit 8: 130 MB before the fixes below, 67 MB after
(about 60% of what is left is `ArrayBuffer` data of geometries and textures). Forced-GC `performance.memory` after
eight visits: +334 MB before, +199 MB after. Second-pass growth after the fixes is about 4 MB per visit (see below).

**Holders found (all kept an evicted zone's data reachable):**

| Holder | What it held | Fix |
| --- | --- | --- |
| `foliage-furniture-renderer.js` bridge + `foliage-furniture-runtime.js` `spawnForMap` | A failed V27 generator load abandoned its hidden iframe (a whole page, plus its three.js) and the next furniture record started another; the spawn loop waiting on the generator kept the zone scene reachable. About 87% of the survivors in the first snapshot set. | Remove the iframe on failure and back off 60 s; `disposeMap` cancels the loop and it re-checks the live scene after every await. `scripts/test-foliage-bridge-and-spawn-lifecycle.js` (uses a real GC). |
| Bandits put to sleep by `wilderness-simulation-lod.js` | They get `areaId = "__wilderness_lod_sleep__:<zone>"`, so `zoneResidents(mapId)` never matched them: they did not pin the zone and `ZoneBanditRelease` did not despawn them. Each kept `.scene` and was still in `hostileObjects`, which kept the evicted scene (and, through three.js's per-scene render lists, its geometry) alive. | `zoneResidents` matches `_wildernessLodAreaId` for sleepers. |
| `seasonal-vegetation-tint.js` `trackedMaterials` (and the seven per-kind sets) | Every material ever built, until `dispose()`. Eviction only disposes materials it can prove no live scene uses. | Weak sets (`WeakRef`). `scripts/test-seasonal-tint-weak-materials.js`. |
| `zone-plateau-mesa.js` `_mesaBatchesByMap` | Render batches and hidden source meshes of evicted zones; only released on a rebuild. | `ZonePlateauMesa.releaseZone(mapId)` from `_disposeZoneScene`. |

**The `Documents` / iframe growth was mostly a sandbox artifact.** `docs/references/(HA)FoliageGeneratorV27.html` imports
three.js from `unpkg.com`. The headless sandbox blocks that host, so every furniture record failed after a 15-25 s wait
and leaked an iframe (`Documents` 2 -> 25). With `unpkg.com` allowed the bridge starts once and `Documents`, iframes and
DOM nodes stay flat across eight visits (3 / 2 / ~24.7 k). The structural defects are still real for a player who is
offline, behind a blocking proxy or on a slow network, which is why they were fixed anyway. If you measure DOM growth
here again, allow `unpkg.com` first.

**Re-checked after main's Tzatzul nest/cliff-spire work (#1453) was merged in.** `TzatzulCliffSites` (bird-only spires in
`map_northern_cliffs` and `map_western_slope`) keeps the zone's scene in its `areas` map and only released it on the next
area change, so `evictZoneScene` now calls `TzatzulCliffSites.releaseArea(mapId)` itself. Its perches (`PerchSupport`),
`TzatzulLiveVisuals` and the flight runtime already drop their zone state on area change. Nest caves are building scenes,
not zone scenes: `TzatzulNestEncounter` keeps small per-cave records and carried victims for the session on purpose, bounded
by the four nests. The same eight-visit snapshot run on the merged build showed no Tzatzul objects among the survivors
(49 MB survived, forced-GC heap +161 MB over eight visits), but a bird may not have spawned during those visits, so this
is a code review plus a clean run, not proof that a spawned bird leaks nothing.

**What is left is small and bounded (second pass over the same zones).** The "survivors" lists above are dominated by
things that are created on a zone's *first* visit and then stay, so they overstate creep: per-zone caches such as
`_banditZoneViews`, `PorakanekiCampPlacementPolicy` grid refs, the water `domainCache`, tree variant templates and
the zone currently kept built. The test for real creep is the second pass. Snapshots after visit 4 and after visit 8 are
both in the same zone (eastern mire), so everything that differs is growth: self size 499.1 -> 515.7 MB (+16.6 MB over
four visits, about 4 MB per visit, +3%), 7.26 M -> 7.37 M heap nodes, and 11,182 -> 11,357 live `BufferGeometry` objects.
Before the fixes the first four visits alone left about 350 MB behind (self size 686 MB vs 499 MB after).

An orphan-geometry census confirms it. Scratch instrumentation wrapped `BufferGeometry.prototype.setAttribute` and
`dispose` to record each geometry's creation stack in a `WeakRef` list, then after two forced GCs listed geometries that
are alive, never disposed and not reachable from any live scene (`traverse` over town, building and zone scenes). Between
visit 4 and visit 8 the list is identical except for counts of a few tree-variant templates: the only large entries are
the current zone's two path-network geometries (held on the zone record, not in the scene) and the camera-occlusion
chunk geometries, which share the source mesh's position buffer, live on the source geometry (`geometry[INFO]`) and are
dropped with it. So the ~10 MB of `WebGLBindingStates` entries (`__hobunjiGameRenderer > clearDepth > ... setup > o`)
seen in the snapshots belong to geometries of the live zone, not to a growing pile of abandoned ones.

**Not fixed, not growing (a few MB each):** `HobunjiDualWieldWeaponVisuals` `carriedPoses` (7 -> 1 MB after the other
fixes), `_nestContentStates` (den nests hold `scene` and `grid`; gone from the survivors after the sleeping-bandit
fix, but it keys state by scene, so check it if zones start surviving again), `bandit-camps.js` `_banditZoneViews`
(one tile grid per zone ever visited, removed only by `forgetZoneBanditState`, so it is bounded by the number of
zones), `MergedWaterRenderer` `domainCache`, `enemySightOccluderMeshes`. If the heap climbs again, re-run the
second-pass comparison first: if self size between two snapshots of the same zone grows by more than a few percent,
something new is leaking; take the `survive` listing and look at the holder paths that do not belong to a per-zone cache.

Scratch-only debug hooks were used for the measurement and are not in the repo; the analyser logic is described above
(BFS retainer paths over snapshots, id-range to date objects). Hooks that are in the game and useful here:
`__zoneCacheDebug` (`built()`, `blocker(mapId)`, `history()`), `HobunjiCacheAudit`, `renderer.info.memory`.

## Real but not fixed (start here if you are asked to go further)

Ranked roughly by how much the numbers say they matter. None of these were the "never recovers" cause.

1. **Shell outline pass cost in fights.** With 30 bandits the shell outline pass drew more calls (984) than the main
   scene (758). Turning outlines off cut draw calls and triangles by 59% and render CPU by ~40%; a trace from a
   player's real machine during a ~28-bandit fight showed world render passes 104 → 60 ms with outlines off. It scales with the number of
   outlined characters. Untested idea: outline only the nearest few.
2. **`updateHostiles`**: ~10–12 ms per frame with 30 bandits (JS, not GL), independent of outlines. Matches the
   real-hardware trace (10–12 ms).
3. **`updateShoulderSurfReticleAim`**: 0.2 ms empty → 2–7.5 ms with 30 bandits (it varied between runs).
4. **Held-object overlay replay** (`held-object-render-order.js`): 19–29 ms in the real-hardware trace and it stays
   with outlines off. The pass-start stack traces point at `replaySelectiveHeldOverlay` and `replayShellOutlineXray`.
5. **Scheduler `checkpoint` ~5.5 ms**: this is only the dispatcher for every `pre-render` subscriber, so it is the sum
   of many modules. The scheduler's `getDebug()` has per-subscriber timings; the real-hardware trace named
   "procedural hand pose sync" (~8.5 ms) as the biggest scheduler entry.
6. **The heap grows slowly across zone visits** (about 4 MB per visit on the second pass after the fixes; was ~25-40).
   The remaining holders are small and bounded; see "Heap growth across zone visits" before touching it.
7. **The corpse swap keeps the newest 6 per area and any within 5 tiles of the player** (`keepFull`, `nearTiles`,
   `minSettledS` in `SCRATCHBONES_CONFIG.game.banditCorpseRetire`). Defaults were picked from arena tests; a tribe camp
   of 15 leaves up to 6 full rigs behind. Tune with measurements.
8. **UI-side suspects from a user-run browser trace**, not reproduced or measured here: the potion-select icon being
   toggled by two scripts, and `inventory-gear-compact-effects.js` `refreshPresentation` (1.56 s of style recalculation
   in one trace; it reads `getBoundingClientRect` from a `requestAnimationFrame` callback, which I did confirm).
   Their per-call cost (5–12 ms, intermittent) was small next to the render passes.

## Gameplay tradeoffs the fixes introduced

- Returning to a zone left two zones ago shows **fresh bandit camps** if bandits were present when it was evicted
  (the camp state is forgotten so it re-seeds). Un-looted bandit/tribe corpses in an evicted zone are gone, and their
  loot with them. `SCRATCHBONES_CONFIG.game.zoneCache.releaseBandits = false` restores the old behaviour.
- A swapped corpse is a flat dark marker, not a body. It is still lootable (looting reads the entity, never the rig),
  and revivable bodies (`keepCorpseAfterLoot`, e.g. a lich's skeletons) and timed-search bodies keep their rigs.
- Bandits asleep under the wilderness LOD now count as residents of their zone, so a zone whose only bandits are asleep is released (and its camps re-seed) like any other bandit zone.
