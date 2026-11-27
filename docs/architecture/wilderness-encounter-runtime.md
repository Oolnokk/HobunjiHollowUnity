# Shared wilderness encounter runtime

`docs/js/wilderness-encounter-runtime.js` is an opt-in set of primitives, loaded before the encounter definitions in `docs/index.html`. It has no frame loop, no persistent singleton encounter, and no independent renderer, combat AI, or save owner.

## Consumers

- Rootledoots: scene ownership, throttled activation, deterministic chunk sites, humanoid exclusion, connected spawn pools, asynchronous wave adoption, reward journal, defeat accounting and nonlethal recovery, cropped sprite source.
- Boney Shinjimi: async build ownership, humanoid query, timed approach rolls, bounded route searches, and consume-before-save conditional reward handling.

## Integration contract

- `sceneMatches(record, zone, scene)`: pair with the consumer's active-record identity. Recheck after every awaited construction and before adopting a result. A scene replacement with the same zone ID is still a replacement.
- `createBuildSlot()`: reserve a token with `begin()`; cancel on teardown, call `finish(token)` in finally. Old tokens cannot release newer work.
- `createInterval(seconds)`: call only within the consumer's existing update loop. Reset during ineligibility/teardown. No global scheduler or frame polling is installed.
- `peopleInArea(options)`: lazy live query over walkers and actor collections with normalized tile-space coordinates. Exclude the consumer's own actors. The caller chooses the query cadence and distance/chunk test. Do not cache results across asynchronous construction.
- `flatFootprint`, `siteInChunk`, `connectedSpawnTiles`, `takeSpawn`: supply real grid, eligibility, elevation and bounded containment predicates. A spawn pool is built once per wave and consumed without replacement. A different encounter can choose its own footprint radius, exclusion distance or preferred radius.
- `runWave(record, options)`: record owns `wave` and `building`; caller supplies preparation, current-scene checks, actor creation, validation, adoption, disposal, and failure handling. Adopt into the consumer's owned actor collection synchronously; put optional visual effects in `onAdopted`. First-wave suppression must leave the locale retryable. Failure handling must clean adopted actors; the helper disposes actors that never became owned.
- `createJournal(options)`: separate world stamp, daily ledger, pending rewards, transient retry cooldown, and capture/rollback for each consumer. Reward payloads must be plain serializable data, not rigs. Serialize the journal as part of the existing member save. Rootledoots retain their original save keys and schema.
- `withConditionalReward(options)`: supports reward owners that save synchronously during delivery. Consume the effect before grant, restore on rejection or exception. It does not replace an inventory/gear transaction.
- `createDefeatTracker(isOwned)` / `recoverNonlethal(options)`: track only the encounter's own downing attacks, normalize excess damage, and delegate the actual blackout/travel to the existing owner.
- `createRouteBudget(maxSearches)`: reject duplicate candidate cells, try cheap direct traversal, and cap path searches per relocation attempt.
- `createSpriteSource(url)` / `paintPortrait(canvas, crop, options)`: lazy shared alpha-crop source and aspect-preserving portrait paint. Consumer owns renderer texture lifetime.

Keep authored rules (regions, encounter probability, NPC identities, ranks, dialogue, loot and defeat consequences) in the encounter definition. Use existing bandit AI, NPC scheduling, GearMemberTransaction, cooking and blackout APIs instead of implementing competitors. Additional consumers should be migrated individually with their existing regression coverage, not by adding a second global dispatcher.

## Tests

Run from repository root:

```sh
node scripts/test-wilderness-encounter-runtime.js
node scripts/test-rootledoot-encounters.js
node scripts/test-boney-shinjimi.js
```

The unit suite exercises independent build slots/journals, stale construction, wave suppression, terrain connectivity, population normalization, route budgets, reward rollback, nonlethal recovery and sprite cache/crop behavior. Integration tests use real feature modules with mocked rendering/persistence adapters. Browser appearance and live-map performance require playtesting.
