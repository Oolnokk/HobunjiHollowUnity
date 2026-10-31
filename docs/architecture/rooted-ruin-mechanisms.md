# Rooted ruin mechanisms

The live-growth preview and playable ruin share `LiveRootMechanisms`. The playable adapter opts in with `DevRandomRuin.generate(seed, { rootMechanisms: true })`, the `generation.rootMechanisms` config field, or **Rooted mechanisms** beside the Dev Settings Generate button. Ordinary ruins retain their existing presentation.

## Progress and ownership

`DevRandomRuin` owns puzzle signals, manual controls, external overrides, locks and progress timing. Its existing DynamicSurfaces frame client calls V50 `applyProgress`; a bound mechanism forwards that normalized progress to its rooted controller. Hidden native geometry still updates logical child anchors for glyphs/effects. It provides neither the rendered mechanism nor walkable support. Native dais rider carrying is disabled for bound mechanisms.

V50 captures the actual generated object, not a generic replacement preset. World-space poses are rebased around a stationary anchor; nonuniform transforms are baked into each guide. Native transforms and linked signal values are restored after capture. Each unique pose owns a root growth, invariant pieces share one growth, and repeated poses are holds. Material-only decals/effects retain their native presentation.

## Collision

Playable transitions use overlapping growth weights: incoming roots grow fully before outgoing roots finish retracting. The preview's ordinary linear cross-growth remains available. DynamicSurfaces uses fixed per-piece keyframe envelopes, enabled at 85% local part growth. Envelopes are captured once; no per-frame mesh traversal or bounds reconstruction is added. Dais payloads and shafts do not become walkable decks.

Lifts and stairs capture intermediate poses at at most 0.25 world units of vertical extent change. These fixed growth steps fit below the existing 0.42 step limit. No invisible moving deck carries riders. Mechanisms requiring more than 16 safe poses fail preparation explicitly.

Doors retain the single tile/footprint collision authority. Their binding reports whether the closed shape has significant local growth; hidden guide materials do not invalidate its semantic footprint. Closing pauses while the player's footprint overlaps the doorway. Camera occlusion uses actual grown meshes and their changing draw ranges instead of hidden guides.

## Lifecycle and checks

Preparation happens after the normal native solvability audit and before entering the map. Failed/cancelled builds dispose captured guides, generated roots and surface records. Reroll/exit abort preparation and release all published bindings. Native materials are restored exactly once; source meshes and their geometry remain owned by V50.

`test-live-root-mechanisms.js` covers growth weights, support overlap, fixed supports, occupied-door closing, disposal and cancellation. `test-root-mechanism-runtime-browser.js` runs actual Three.js, V50 capture, root geometry, DynamicSurfaces and semantic door footprints. It checks linked-signal restoration, lift support continuity, step clearance and payload exclusion.


## Full Stone Age mode

**Rooted Stone Age ruin** in the Dev Settings Generate row now selects both the existing rooted mechanism adapter and the whole Stone Age presentation. Use DevRandomRuin.generate(seed, { stoneAge: true, rootMechanisms: true }) to request it programmatically. Ordinary wilderness ruins and explicit stoneAge:false generations preserve the original Harlyao furniture and flooring. A rooted Stone Age generation uses the native V50 large single-chamber layout, the nine optional Stone Age architectural recipes and pillars-only floor props.

StoneAgeRuinScenery is shared with the standalone author preview. The game presents the same farm-cliff-textured rockified walls/pillars, uniform 25% 4×4 tiled wilderness boulder floor and permanent Temple root/vine layers before applying native rooted mechanism keyframes. Stone Age pieces retain V50 placement; rock conversion is visual-only and does not mutate the immutable V50 source or original furniture guides. The quarter-scale floor is a visual skin: V50 floor cells, plateau heights, entrances and DynamicSurfaces remain the sole navigation/step authority, avoiding incorrect collision with decorative boulder crests. The generator deliberately uses the existing vast **single-room** preset; multi-room quarter-tile floor clipping and mixed-level traversal are not silently approximated.

The scenery build is abortable. On exit, reroll or failure, generated roots and buffers are disposed and native object visibility is restored before V50 reclaims its preview root. Its boulder generation passes private elevation dependencies to ZoneTerrainFeatures.buildUndiggableBoulderShellData rather than invoking ZoneTerrainFeatures.init, which would corrupt the live wilderness scene. Diagnostics include the active mode, piece set, walls, pillars, tiled floor copies, floor-stone count and visible strands; the mobile Generate button reports vegetation preparation.
