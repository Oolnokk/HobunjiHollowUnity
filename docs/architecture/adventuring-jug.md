# Adventuring jug — draft integration contract

**Draft runtime integration.** The jug is now selectable and uses the live action slots, save metadata, physical traces, consecration and fire APIs. Browser and full CI verification remain required.

- Water holds 12 units; Life Water holds 6. Fill only from a validated ordinary water source or the Life Totem basin's authored liquid surface. Empty before switching liquid types.
- Action 1 releases one unit; trace from the held jug mouth to the first physical tile or receptacle, including lower elevations. Action 2 releases one unit in a forward cone, with no receptacle transfer. Action 3 releases the remaining contents into a receptacle or a ring of validated surface cells. Receptacle capacity limits accepted units; overflow is lost. Resolve each action only once.
- At a successful moving dodge start, spend one unit of belt-stowed ordinary water. Pass the accepted swept movement cells to dodgeTiles, not requested or blocked movement. End the roll on every interrupt, death and transition. The final unit still protects the entire paid roll. Life Water never participates.
- Life Water extinguishes flames, clears plasm and registers elevation-specific consecration for 20 simulation seconds. Query isConsecrated before every new plasm deposit, including timed spells, skeleton drips and bombs. Apply healing or undead damage via existing actor/resource authorities, once per second, without faction checks. Undead retreat and surface visuals still need integration.
- Use the simulation clock in milliseconds and existing frame scheduler. Clear area effects on teardown. Persist only getState/restore values with the character, never actor references or in-flight tokens.
- PersistentGroundFire currently represents circles, not individual tiles. Migrate the owner to individually extinguishable surface cells with floor separation and authored campfire VFX. On an actual ground/support impact, a burning thrown torch must ignite an exact 3x3 footprint, not walls/actors.
- AdventuringTools registry and game.js own equipment and action routing; CharacterHeldTools owns shared PNG rendering. Existing jar_liquid.png is possible temporary art; dedicated jug and belt rig art preferable. Provide a third action without taking Interact. Pixel Probe should expose jug units, hit surface/vessel, roll protection and consecrated tile count.
- Temporary jar art, belt visual and consecration decals are integrated. Authored puzzle graph supports activator behavior liquidVessel with requiredLiquid, requiredLiquidUnits and liquidPartId (opening mesh ID). No generated puzzle template has been authored yet. Runtime input, physics, rendering, actor AI, and full CI remain unverified.

## Follow-up audit

Refill failure no longer expends a unit. Paid belt-water dodges clear current burning and kindling and reject duplicated roll-start notifications. Neutral noncombat NPCs have no Health resource yet; no artificial combat pools were added.

Arena spell plasm now uses separately removable cells sharing one geometry/material. Both ruin and arena deposits consult consecration before creating or refreshing covered surfaces. Tests exercise floor isolation, removal, contact and prevention.

Furniture Avatar Author exposes the required liquid, unit count, and intake part ID. The runtime bridge uses gameplay elapsed time rather than wall-clock time for consecration; paused updates no longer advance effects.
