// Porakaneki materialization handoff invariants.
//
// Kept as executable-source-adjacent documentation so future LOD/AI refactors
// have one compact checklist without duplicating runtime behavior:
// 1. PorakanekiCamps chooses neutral activity + destination.
// 2. updateHostiles owns live movement/collision/facing/avatar animation.
// 3. Detailed simulation enters by distance and exits at a wider radius.
// 4. Territory warnings are only consumed after Ambient Dialogue succeeds.
// 5. WildernessAiSnapshot reports sim/render positions and registration state.
//
// This module intentionally exports no runtime global and is not loaded by the
// game; the assertions that enforce these invariants live in
// scripts/test-porakaneki-materialization-handoff.js.
