# Ruin capabilities, targetables and world events

Goal: build ruins (and anything else) from small modules that *combine*, instead of scripting each scenario. Two example combinations drive the design and are acceptance tests, not shipped content:

1. **Defend the key statue.** Put the key statue on the plinth; skeletons and demolitionists climb out of hidden pillar openings; demolitionists try to blow up the statue before the plinth finishes pressing, skeletons try to distract the player.
2. **Rope-launched bomb opens a bridge.** Hang a witch-bomb on a rope, melee it so the lunge distance becomes swing force, it drops right before the swing back and lands by a cracked pillar, the blast topples the pillar and the bridge tiles become walkable.

Neither is authored anywhere. The system's job is to make them *possible* as combinations of independent pieces.

## Why they were not possible

Each interaction between two systems was bespoke code: the lunge-stop test looped over hostiles only; melee only knew burdens (and only detonated them); blasts reached props through a private hook; mechanism inputs were a fixed list; the rope pendulum lived inside the ruin generator; nothing expressed "defend X until Y".

## The substrate

- **Capabilities, not types** (`js/targetables.js`). Things that can be hit register what they can *do*: `hostile`, `burden`, `explosive`, `hangable`, `breakable`, `lungeStop`. Askers query by capability. Systems that already own a collection (burdens, enemies) expose it through `addSource`, so nothing is tracked twice. Capabilities can be live (a burden is `hangable` only while hanging).
- **One melee geometry.** An entry's `toActor()` is a stand-in target for `Combat.meleeHit`; `RangedWeapons.actorHitbox` honours its `__targetableHitbox`. There is exactly one cone-vs-box test.
- **One event stream** (`js/world-events.js`). Typed, scoped, synchronous. `struck` (a melee strike hit something) and `blast` (every explosion; emitted from `Shattercasks.applyBlast`, the single choke point). Subscribers carry a scope and an optional filter, and cannot break emitters.
- **Lunge targeting** (`js/lunge-targeting.js`, extracted from `game.js`). A lunge halts when a live hostile *or any `lungeStop` targetable* is inside the attack cone. Nothing is `lungeStop` by default, so gameplay is unchanged until a system opts a thing in.

**Aim note.** For the player, `Combat.meleeHit` is wrapped (`ranged-camera-focus.js`) so the strike cone follows the camera reticle, overriding the yaw/pitch a caller passes. Targetables go through the same wrapper, so a `lungeStop` target is found where the player is *aiming*, exactly like an enemy. Probes that need a specific direction must pass an explicit `direction`.

## Event inputs (step 2)

A mechanism or activator can react to a world event directly, with no activator wire. It is an optional list on the existing `puzzle` block (schema stays v3, additive):

```json
"puzzle": { "role": "mechanism", "behavior": "toggle", "channel": "bridge1", "motion": { ... },
  "inputs": [ { "event": "blast", "withinTiles": null, "tag": "", "targetId": "", "action": "on", "once": true, "delaySeconds": 0 } ] }
```

- `event`: any lower-case event name (`blast`, `struck`, ...). `withinTiles`: distance from the node's origin to the event point; empty uses the event's own `radius` (a blast must reach the node). A distance condition is never met by an event with no position. `tag`: must equal the event's tag (e.g. `fire`). `targetId`: `self` or an id, matched against the event's `targetId` (for `struck`). `action`: `on`, `off` or `toggle`. `once`: unsubscribe after it fires. `delaySeconds`: act after a delay.
- Mechanisms run `setMechanism`; activators run `activate`, so their wired mechanisms follow. Up to 8 inputs per node.
- Subscriptions are scoped to the node's map and released when the node is unregistered, re-registered or replaced by a map re-registration, so they cannot leak or stack.
- Authored in the Furniture Author's Puzzle Furniture section ("Reacts to events"). Placement tools inherit the authored `inputs` (the runtime merges `{...inherited, ...instance}`); per-instance overrides are not in the map/locale editors yet.

**The pillar bridge**: open the piece, set its role to Mechanism, add an input `blast` (once). A witch bomb that goes off near it topples it with no further code. Its motion, `collisionOpenProgress` and blocked tiles are unchanged.

Gotchas: (1) `channel` defaults to `A` and is shared by every mechanism in a map, so give event-driven nodes their own channel or an unrelated channel-A toggle will override them. (2) Distance is measured to the node's origin, not its footprint edge, so a long piece like the 1×5 pillar should use an explicit `withinTiles` that covers the part meant to be hit. (3) `struck` events are only emitted for burdens today; furniture reacting to being struck needs furniture to become a strike target first.

## Hanging ropes (step 3)

`js/rope-pendulum.js` (pure physics) and `js/hanging-ropes.js`. A rope has an anchor, a length and a free hook; `HangingRopes.registerRope({ id, mapId, scene, x, y, z, length })` makes one (with a thin cylinder visual). Any carriable burden can hang from it, not just bombs.

- **Hang.** Carrying a burden near a free hook and pressing the carry-release action (`interact`) hangs it instead of dropping it (`Shattercasks.interact` asks `HangingRopes.tryHang` first). Picking it up again takes it off. `HangingRopes.attach(rope, burden)` does it from code.
- **A hanging burden is a `lungeStop` target** (step 1). A lunge stops the moment it is inside the attack cone, so a close attack spends little lunge and a distant one spends all of it.
- **Strike.** `sweepMelee` calls the burden's `strikeHandler` instead of detonating it. The swing speed is `RopePendulum.strikeSpeed(lungeTraveledWorld)`: the distance actually travelled this attack (`player.lungeOriginX/Y`, recorded immutably in `beginCombatLunge`; a lunge origin older than 1.5 s is not "this attack") over `referenceLungeWorld`, mapped from `minSpeed` to `maxSpeed`. The direction is away from the attacker. The bob is a spherical pendulum, so any direction and repeated strikes work.
- **Release rules**, evaluated while it swings: **drop** at the forward apex (just before the swing back), or **launch** if the rope swings past `detachAngleRad` while still moving outward, with the bob's velocity. Released burdens enter the shared fall flight (`Shattercasks.releaseBurdenWithVelocity`), which now supports horizontal velocity and re-resolves the ground under a moving burden each step; the old straight-down release is unchanged. A bomb keeps its fuse and impact handler, so it explodes where it lands.
- **Events** (scoped to the map): `rope:attach`, `rope:swing`, `rope:release` (`mode: drop|launch`), `rope:detach`, so mechanisms and encounters can subscribe to them.
- **Tuning** (`HangingRopes.configure({...})`; defaults are a first pass to feel out): `referenceLungeWorld` 1.6, `minSpeed` 0.9, `maxSpeed` 9.5, `detachAngleRad` 0.85 (about 49 degrees), `hangReach` 1.8, rope `gravity` 8.2 (matches the ruin rope traversal) and `damping` 0.25. With a 2.4 rope, a lunge of 0.1 drops the bomb about 0.7 tiles away; a full 1.6 lunge launches it about 8 tiles. The throw arc uses the shared burden fall gravity (13), not the rope's.

The two example combinations now decompose into pieces that exist: *dispenser → bomb → rope → melee → release → blast → pillar input → bridge* is all real code (the pillar needs only a `blast` input, step 2).

Known limits: ropes are placed by code (a composer calls `registerRope`); there is no authored rope furniture or Author UI for it yet. There is no on-screen "Hang" prompt (the carry-release action simply hangs when a rope is in reach). A swinging burden does not collide with walls (a released one does, via the normal flight collisions). The rope is a rigid length, so a very hard strike can swing past horizontal.

## What step 1 changed (behaviour-preserving)

`isHostileInLungeCone` moved to `LungeTargeting` and gained the targetable path; burdens are exposed as a `shattercasks` source (`burden`; `explosive` for shattercask/witch-bomb; `hangable` while hanging; `lungeStop` only if `burden.lungeStop === true`); `sweepMelee` emits `struck` before detonating; `applyBlast` emits `blast`; the witch bomb passes its `y` and id into the blast. No listener exists yet, so nothing observable changes.

## How the example combinations decompose

| Combination | Pieces |
|---|---|
| Rope bomb opens bridge | dispenser (spawner) → bomb (`explosive`, carriable) → rope hook (`hangable`; sets `lungeStop`) → melee `struck` → impulse → release → `blast` → cracked pillar subscribed to `blast` → bridge toggle |
| Defend the statue | plinth (progress output) + statue (`breakable`, targeted) + pillar openings (spawners) + demolitionists (target explosive burdens) + skeletons (target the player), under a `Defend(statue, until plinth progress = 1)` goal |

## Roadmap

1. *(this step)* Targetables, WorldEvents, lunge targeting.
2. *(done)* Mechanism inputs that subscribe to events: `puzzle.inputs`, see below. Still to do: a capabilities block in the Furniture Author (e.g. marking furniture `breakable`/`targetable`) once furniture emits and receives strikes.
3. *(done)* A general rope component: a pendulum any burden can hang from; a strike sets it swinging with a speed from the lunge distance spent; release into the shared throw arc. See below. Still to do: ropes as authored furniture / generator-placed, and a "Hang" prompt.
4. Goals and encounters (`Defend`, spawners, objectives) plus a solver that chains capabilities from the player's verbs to a goal and validates the chain with the existing pendulum/flight simulations (a feasible-impulse window, so skill decides the exact throw).

This sits on the room-plan / 3D-grid work (see `vertical-grid.md`): a plan that knows a room's volumes, entrances and anchors is what lets a solver place these pieces coherently.

Known limit: `sweepMelee` still has its own cone test (kept to avoid changing burden melee behaviour here). Moving it onto the shared geometry is a later, separately tested step.

## Verification

Unit tests execute the registry, event stream, lunge targeting, and the real `shattercasks.js` (burden capabilities, blast event) in a sandbox. A headless run of the real game (see `headless-game-test`) placed a burden with a real hitbox along the player's actual aim and confirmed: no lunge stop by default; after opting in, a stop at 0.4, 1.0 and 1.8 tiles (range 2) but not too far, behind, to the side, far above, after opting out, or while carried; `blast` events arrive with the right payload; no page errors.

Step 2 verification: `scripts/test-puzzle-event-inputs.js` runs the real puzzle runtime, schema and event stream (conditions, once, delay, activators driving wires, lifecycle, isolation, the real keyframe motion). The Author editor was exercised in a real browser (typing is not clobbered, tabbing keeps the row, add/remove, save/load round trip, disabled for non-puzzle pieces). In the real game a real `applyBlast` moved a nearby registered mechanism to its on-keyframe, left a pillar 28 tiles away and a differently tagged one alone, and released its subscriptions; no page errors. (In the headless sandbox frames arrive ~10 s apart, so animations complete late but correctly.)

Step 3 verification: `scripts/test-rope-pendulum.js` (physics against analytic results: apex angle from launch speed, energy conservation, small-swing period, drag), `scripts/test-hanging-ropes.js` (attach/detach/callback chaining, weak vs strong strikes, direction, stale-lunge handling, carried hang, lifecycle, landing distances), and `scripts/test-burden-ballistic.js` (the real `shattercasks.js`: the unchanged downward release, launch arcs, ground re-resolution, the strike-handler branch, `interact` hanging, the tick hook). In the real game, a real witch bomb on a real rope struck through the real `sweepMelee` dropped 0.69 tiles away for a 0.1 lunge and launched 7.8 tiles for a full lunge; with a 4 s fuse its real blast emitted a `blast` event that moved a pillar registered with a `blast` input to its on-keyframe; no page errors.
