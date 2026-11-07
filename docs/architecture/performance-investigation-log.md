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

## Heap growth across zone visits (measured, retainer not found)

After #1469 only one zone stays built, but the JS heap still climbs with every zone visit. An earlier note here said
"~100 MB per zone" from a four-visit run; the longer run below corrects that to roughly **25 MB per visit**, and shows
it does not level off.

**How it was measured.** Eight zone visits (each of the four zones twice, 25 s in the zone, back to town, 16 s for the
trim), after an idle control. At each checkpoint: two forced GCs, then CDP `Performance.getMetrics` (`JSHeapUsedSize`,
`Nodes`, `JSEventListeners`, `Documents`), `renderer.info.memory`, and V8's sampling heap profiler
(`HeapProfiler.startSampling` at 65,536 bytes, then `getSamplingProfile`: `selfSize` summed per call site is the bytes
*still alive* that were allocated there). Do not mix `performance.memory.usedJSHeapSize` with the CDP counter: at the
same moment they differ by about 2x (320 vs 156 MB).

- **Idle control is flat:** 156 → 157 → 156 MB over two minutes in town, with unchanged geometry, texture and object
  counts. The growth is caused by zone visits, not by time.
- **Same zone, same state, one cycle later** (the zone that is kept built at a checkpoint, compared with the next time
  it is the kept zone): western slope 202 → 318 MB (+116), northern cliffs 225 → 326 (+101), southern cloud forest
  269 → 364 (+95), eastern mire 297 → 360 (+63). Scene object count stayed ~2.4-2.6 k and canvas/image counts stayed
  7 / 98, so it is not the live scene.
- **It is not a plateau.** Per visit the heap went +46, +23, +44, +28 (first visits), then +21, +8, +38, -4
  (revisits): smaller and noisier, about +16 MB per revisit on average, still climbing.
- **The DOM grows too:** about +1,700 nodes, +130 event listeners and +3 `Document` objects per visit (nodes 21.3 k →
  34.7 k, listeners 2.4 k → 3.4 k, `Documents` 2 → 25 over the run). I did not find the source. No game code creates
  `srcdoc` iframes (the only hits are comments), so the extra documents are something else.
- **Where the surviving bytes were allocated** (growth in live sampled MB from visit 4, when every zone had been built
  once, to visit 8): three.js internals +20.7 (mostly one minified function), `water-body-outline-overlay.js` +14.2
  (`makeFace`, `buildFoldedSurfaceTopology`, `collectFaceUvs`), `zone-plateau-mesa.js` +10.5 (`buildZoneMesaMeshes`),
  `game.js` +6.0 (an anonymous function around line 11368 inside `buildZoneScene`), `surface-stretch-uv-furniture.js`
  +5.5 (`preserveEdgeScale`), `terrain-geometry.js` +4.3 (`bindRenderedGroundGeometry`). **`bandit-camps.js` grew by only
  0.1 MB**, so the camp state is not the cause.

**Ruled out.** Growth with time alone (idle control). The live scene (object count flat). Bandit camp state. `game.js`'s
own per-zone bookkeeping: `_disposeZoneScene` clears all 21 per-zone collections declared there; the only one it does
not clear is `_zoneLayouts`, which is deliberately kept as the source data a zone is rebuilt from.

**Leads, not confirmed retainers.** `evictZoneScene` releases only `HeldObjectRenderOrder`, `CratePiles`,
`PorakanekiCampPlacementPolicy`, `Shattercasks` and `WorldPopupText` by name. `zone-plateau-mesa.js` keeps
`_mesaBatchesByMap` (batch meshes plus the hidden source meshes) per zone and disposes it only from
`scheduleMesaRenderBatching` and `rebuildZoneMesaMeshes`, i.e. on rebuild; I found no call from the eviction path, and
`disposeMesaBatches` does not dispose the hidden source meshes' geometry. That would hold one set per zone, which by
itself is bounded, so it cannot be the whole story. `water-body-outline-overlay.js` caches per-object results in a
`WeakMap` (`domainCache`), which stays alive as long as its key does.

**Next step.** Find who *retains* the objects, which allocation sites cannot tell you. Either take heap snapshots after
visit 4 and visit 8 and compare retainer paths (large: expect hundreds of MB each, so use a streaming parser, not
`JSON.parse`), or check each suspect module's own state for evicted zones (`ZonePlateauMesa.snapshot()` already lists
the zones it still holds) and release candidates one at a time, watching the post-GC heap.

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
6. **The heap keeps growing across zone visits, about 25 MB per visit, and it is unbounded.** Quantified, attributed to
   code, and *not yet traced to its retainer*; see "Heap growth across zone visits" below before touching it.
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
