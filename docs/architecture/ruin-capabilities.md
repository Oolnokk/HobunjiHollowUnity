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
3. A general rope component: a `hangable` pendulum any burden can attach to, `struck` → impulse (from lunge distance spent), release into the existing throw arc.
4. Goals and encounters (`Defend`, spawners, objectives) plus a solver that chains capabilities from the player's verbs to a goal and validates the chain with the existing pendulum/flight simulations (a feasible-impulse window, so skill decides the exact throw).

This sits on the room-plan / 3D-grid work (see `vertical-grid.md`): a plan that knows a room's volumes, entrances and anchors is what lets a solver place these pieces coherently.

Known limit: `sweepMelee` still has its own cone test (kept to avoid changing burden melee behaviour here). Moving it onto the shared geometry is a later, separately tested step.

## Verification

Unit tests execute the registry, event stream, lunge targeting, and the real `shattercasks.js` (burden capabilities, blast event) in a sandbox. A headless run of the real game (see `headless-game-test`) placed a burden with a real hitbox along the player's actual aim and confirmed: no lunge stop by default; after opting in, a stop at 0.4, 1.0 and 1.8 tiles (range 2) but not too far, behind, to the side, far above, after opting out, or while carried; `blast` events arrive with the right payload; no page errors.

Step 2 verification: `scripts/test-puzzle-event-inputs.js` runs the real puzzle runtime, schema and event stream (conditions, once, delay, activators driving wires, lifecycle, isolation, the real keyframe motion). The Author editor was exercised in a real browser (typing is not clobbered, tabbing keeps the row, add/remove, save/load round trip, disabled for non-puzzle pieces). In the real game a real `applyBlast` moved a nearby registered mechanism to its on-keyframe, left a pillar 28 tiles away and a differently tagged one alone, and released its subscriptions; no page errors. (In the headless sandbox frames arrive ~10 s apart, so animations complete late but correctly.)
