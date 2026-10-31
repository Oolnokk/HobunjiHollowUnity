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
