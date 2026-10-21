# Wildlife food web (October 2026)

The wildlife food web extends the existing `updateHostiles` and `WildlifeSpawn` simulation, rather than adding a second combat or animation loop.

## Rules instead of three food factions

`docs/js/wildlife-food-web.js` exports `window.WildlifeFoodWeb.PROFILES`. A species may independently declare `hunts`, `forage`, `particles`, `fightBackAgainst`, and `guardFood`:

- **Nelk:** hunts Puktuk only. It acquires the nearest eligible live Puktuk within 13 tiles at a throttled interval, regardless of foliage-patch assignment. Being a carnivore does not mean it automatically targets every creature or player.
- **Puktuk:** non-hostile, grouped Western Slope foragers. Their food is *small burrowing animals in snow*, represented by a repeatedly generated nearby dig site, without spawning or allocating an actual prey actor. Puktuk retaliates against Nelk when struck, but retreats after its Health falls to the existing skirmish threshold.
- **Nazgraku:** non-hunting Northern Cliffs gatherers, in one extra three-to-five-animal forager group, independent of both Voorg-Ass herds. They seek existing wild berry bushes first (using `WildBerries.nearestAvailableBerry`, reservations, and `removeBerryBush`); otherwise, they assign a hidden tuber tile. They fight animals, bandits, and players that approach their food site and stop pursuing after the intruder leaves.

The old `diet` and `wildlifeRole` values remain compatibility hints for barn fodder, earlier species, and Porakaneki faction logic. They do **not** define the new selective hunting relationships.

## Forage cycle and visual parity

On a per-animal random stagger:

1. Choose a nearby collision-safe destination and bolt toward it using `moveCreatureToward`.
2. Play the **first Grehlr burrow dive** (0.5s), sharing its authored tilt/easing/squash through `HobunjiGrehlrBurrow.applyForagingDivePose`.
3. Reverse that dive (0.43s). Never transition to Grehlr's hidden underground attack, telegraph, or emergence.
4. Chew with two downward head bobs and staggered gaps (1.7–3.2s).
5. Repeat with a small independent pause.

The snow and dirt use the same `canvas.png`/shade-fill basis as Western Slope snow and Grehlr's dirt clods, but with separate white and dark tinted shared materials. Snow clods originate above the raised 0.22-unit snow micro-plateau. Per-burst clod count is capped at 14, with 200 particles maximum across all animals; all particles are updated through the existing per-frame wildlife tick even when their origin actor is visually streamed out.

During combat, fleeing, overnight den retreat, or herd sleep, normal creature state behavior wins; the dig pose is canceled rather than surviving across a fight. Inactive/distant actors advance the state machine without allocating clod geometry or GPU textures.

## NPC limitation

Actual combat-equipped NPCs (bandits/Porakaneki) use the existing actor-vs-actor damage route. Ordinary scheduled `npcWalkers` currently have **no creature Health/resource system**, so a defending Nazgraku **pursues and bites them nonlethally**, causing the existing collision-aware walker movement to flee the attacker until the threat expires. Their authored schedule then resumes. A full injury/death system for scheduled NPCs still needs a separate NPC-combat model.

## Integration and diagnostics

- `game.js`: food-web targeting before ordinary aggro, optional foraging branch after overnight den behavior, sprite pose before mesh sync, global particle tick, and cleanup on death.
- `wildlife-spawn.js`: independent forager group slots, Puktuk defensive skirmish callback, and Western Slope Puktuk/Nelk den registration.
- `creature-genetics.js`: Puktuk no longer occupies the generic predator/farm-meat-diet category.
- `scripts/test-wildlife-food-web.js`: no-WebGL behavioral checks.
- `window.WildlifeFoodWeb.getDebug()` and `window.__farmLog` report hunting, defense, diving, chewing, and particle count for mobile-safe inspection.

**Future extension:** Convert additional species' inherited foliage-patch predator logic to explicit `hunts` / food-resource declarations when their biological food relationships are authored. Do not replace them with invented diets.
