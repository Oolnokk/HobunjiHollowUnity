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

## Ropes (step 3): one rope behavior, furniture-based

**One behavior.** The original Random Test Ruin rope (a planar pendulum with pumping, a hold-to-brake that turns and lengthens it, a limit angle, collision bounce, and a release flight with a small upward kick) is the rope everywhere. Its arithmetic now lives once in `js/rope-core.js` (`RopeCore`): `bobAt`, `stepIdle`, `stepAttached`, `intent`, `releaseFlight`, `catchFromFlight`, `reachAmplitude`. The ruin runtime (`dev-random-ruin-simple-puzzles.js`) was moved onto it, so generated ropes, furniture ropes and ropes carrying burdens cannot drift apart. `scripts/test-rope-core.js` pins the core to the original code: the original functions are embedded verbatim as a reference and compared bit-for-bit over thousands of randomized states and long step sequences, with and without collisions. Hosts keep what is theirs (the player, input, meshes, collision); the core owns the numbers.

**Ropes as furniture.** A furniture piece with a `rope` block hangs a rope from itself (`js/rope-furniture.js`; authored in the Furniture Author's **Rope** section):

```json
"rope": { "version": 1, "enabled": true, "anchor": { "x": 0, "y": 2.965, "z": 0 }, "length": 2.1, "maxLength": 2.65, "yawDeg": 0, "restAngleDeg": 0 }
```

The piece is the ceiling mount; the swinging rope and its behavior are the shared rope. `config/furniture-authored/ruinRopeMount.json` is the first piece (its resting grip is at the generated ropes' reachable height, about 0.86 above the floor). Placement through `FurnitureTableSystem` registers and unregisters the rope automatically; composers call `RopeFurniture.register(area, id, object, data)`.
- **Inside the ruin** the ruin runtime builds the rope itself (`addFurnitureRope`, using the generator's own `createRopeObject` with the furniture as its mount), so a player rides it exactly like a generated rope: the same *Grab Rope* prompt, pumping, hold to stop/adjust, wall and prop collision, *Jump Off* with Dodge, and release flight.
- **Elsewhere** it is an owned `HangingRopes` rope (stepped by `RopeCore`, swept against nearby volumes): burdens swing from it with the same behavior; riding outside the ruin is not wired yet.

**Burdens on any rope.** `js/hanging-ropes.js` hangs a carriable burden on a rope, owned or adopted from the ruin runtime. Carrying a burden near a free hook and pressing the carry-release action (`interact`) hangs it instead of dropping it; picking it up takes it off. A hanging burden is a `lungeStop` target (step 1), so a lunge stops once it is inside the attack cone: a close attack spends little lunge, a distant one all of it. A melee strike (`sweepMelee` calls the burden's `strikeHandler`) sets the rope swinging at `strikeSpeed(lunge distance spent)` away from the attacker (`player.lungeOriginX/Y`, recorded immutably in `beginCombatLunge`; older than 1.5 s is not "this attack"). A rope at rest takes the strike direction as its swing plane; a swinging rope keeps its plane and gains the component along it. The same collision bounce as a rider's rope applies, so a swing into a wall is cut short.

Release rules while swinging after a strike: **drop** at the forward apex (just before the swing back), or **launch** if the rope swings past `detachAngleRad` while still moving outward, with `RopeCore.releaseFlight` (the rider's tangent velocity and kick). The burden then enters Shattercasks' shared fall/impact flight (`releaseBurdenWithVelocity`: horizontal velocity, ground re-resolved under the moving burden; the straight-down release is unchanged), so a bomb keeps its fuse and explodes where it lands. A rope carrying a burden is not offered as *Grab Rope*; an emptied rope is a rider's again. Events (map-scoped): `rope:attach`, `rope:swing`, `rope:release` (`mode: drop|launch`), `rope:detach`.

**Tuning** (`HangingRopes.configure({...})`; first-pass defaults): `referenceLungeWorld` 1.6, `minSpeed` 0.9, `maxSpeed` 9.5, `detachAngleRad` 0.85 (about 49 degrees; the rider limit is 1.28), `hangReach` 1.8. With a 2.4 rope, a 0.1 lunge drops the bomb about 0.7 tiles away; a full 1.6 lunge, struck toward open floor, launches it about 7.5 tiles. The throw arc uses the shared burden fall gravity (13).

The two example combinations decompose into pieces that exist: *dispenser → bomb → rope furniture → melee → release → blast → pillar input → bridge* is all real code.

Action 2 displays **Hang on Rope** while carrying a burden within reach of a free hook. Keyboard, controller and touch use the same carry-release action. Known limits: riding a furniture rope outside the ruin is not wired; the ruin runtime's ropes do not yet carry `RopeCore`'s rider logic into other hosts; a furniture rope's length is in world units (it does not scale with the piece).

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
3. *(done)* Ropes: one shared rope behavior (`RopeCore`, the original rope's arithmetic), ropes as authored furniture, burdens hanging from any rope, strike and release into the shared throw arc. See below. Still to do: riding furniture ropes outside the ruin.
4. *(done)* Goals, a solver, encounters and a whole-room composer. See "Composing rooms" below.

## Composing rooms (step 4)

The two example combinations are not authored anywhere. They fall out of five small, separately tested layers:

| Layer | File | What it does |
|---|---|---|
| Launch predictor | `js/rope-launch.js` | `RopeLaunch.predict/sweep/window`: given a rope, a strike direction and a lunge strength, where does the burden land? Same arithmetic as the game (RopeCore + the shared fall arc); `test-rope-launch.js` checks 216 real-vs-predicted cases to 0 error. `window()` is the *skill window*: the range of lunge strengths that work (and, with `accept`, that are also safe for the striker). |
| Goal solver | `js/ruin-solver.js` | Goals (`connect`, `blast`, `obtain`, `defend`) are decomposed by registered *rules* into placements + sub-goals + checks. `pillarBridge`, `ropeSwing`, `ropeBomb`, `thrownBomb`, `bombDispenser`, `plinthDefense`. Seeded; a plan is valid iff every check in its tree passes. New pieces take part by registering a rule. |
| Room plan | `js/room-plan.js` | The room as a whole: a ledger of *claims* (footprints, clear areas, zones), `solidFn()` so later decisions see earlier ones, `circulation()` (zones that could reach each other still can), `reaches()`, budgets. |
| Composer | `js/ruin-composer.js` | An *archetype* (`vaultHall`, `chasmHall`, `trialHall`) lists a room's goals and marks the focal one. Goals are solved focal-first against the plan's view of the room, every placement is claimed, and a clash, a cut-off zone or a blown budget retries another seed. Output is data: furniture records (`key`, position, `rotY`), an encounter description, wiring, a readable explanation. `apply()` hands records to a placer and creates the encounter. |
| Encounter runtime | `js/ruin-encounters.js` | `defend`: arms when a Key Statue is seated on the plinth; the plinth's press progress is the clock; spawner pillars release skeletons (go for the player) and demolitionists (steered at an invulnerable statue stand-in through the AI's `_chunkCombatTarget` seam; they plant a witch bomb by the statue with a fresh fuse); any blast that reaches the statue destroys it; success on press completion, failure when the statue is lost, then the key-statue dispenser returns another and it re-arms. |

Pieces: `ruinDefensePlinth` (a burden plinth that requires a **Key Statue**, `requiredBurdenKind: "keyStatue"`, with a 30 s press; the press length *is* the encounter length) is new; the rest are existing authored furniture (`keyStatueDispenser`, `witchBombCeilingTube`, `ruinRopeMount`, `ruinPillarBroken` as the spawner pillar). The composer resolves `crackedPillar` to the authored `ruinPillarBridge`. Its puzzle input triggers the topple animation once when a blast lands within 2.5 tiles of the placement origin.

What the whole-room layer buys, concretely (all in `test-ruin-composer.js`): the focal feature is solved first and the rest of the room is composed around it; spawners only appear on the statue's side of a chasm and never within reach of a gap edge; nothing overlaps (a pillar's fall path is claimed as clear floor); the tools for a crossing are on the near side; budgets cap pieces and simultaneous enemies; failures say why (a gap nothing can cross, a room too small for the encounter).

Verified in the real game (generated ruin, headless): an authored `ruinDefensePlinth` and `keyStatueDispenser` registered with the puzzle runtime; the statue taken with `KeyStatues.take` and seated through the plinth's own interaction; the encounter armed and followed the plinth's clock; a real `MinionCombat` demolitionist spawned, was released from its pillar after the emerge delay, was steered at the statue stand-in (`_chunkCombatTarget`), walked up and planted its witch bomb; the bomb went off, the `blast` event reached the statue, `encounter:statue-destroyed` then `encounter:failed` fired, the plinth reversed (payload gone, progress 0), the dispenser returned a fresh statue and the encounter re-armed. The only damage the player took in the run was the bomb's own blast (a hook on `damagePlayer` recorded exactly one event), so the invulnerable stand-in never routes harm to the player. In the headless sandbox the plinth press runs on wall time while enemies move in capped game time, so the test lengthened the press (`durationSeconds`) to keep the race fair; the encounter clock follows the plinth's progress for the same reason.

This sits on the room-plan / 3D-grid work (see `vertical-grid.md`): a plan that knows a room's volumes, entrances and anchors is what lets a solver place these pieces coherently.

Known limit: `sweepMelee` still has its own cone test (kept to avoid changing burden melee behaviour here). Moving it onto the shared geometry is a later, separately tested step.

## Verification

Unit tests execute the registry, event stream, lunge targeting, and the real `shattercasks.js` (burden capabilities, blast event) in a sandbox. A headless run of the real game (see `headless-game-test`) placed a burden with a real hitbox along the player's actual aim and confirmed: no lunge stop by default; after opting in, a stop at 0.4, 1.0 and 1.8 tiles (range 2) but not too far, behind, to the side, far above, after opting out, or while carried; `blast` events arrive with the right payload; no page errors.

Step 2 verification: `scripts/test-puzzle-event-inputs.js` runs the real puzzle runtime, schema and event stream (conditions, once, delay, activators driving wires, lifecycle, isolation, the real keyframe motion). The Author editor was exercised in a real browser (typing is not clobbered, tabbing keeps the row, add/remove, save/load round trip, disabled for non-puzzle pieces). In the real game a real `applyBlast` moved a nearby registered mechanism to its on-keyframe, left a pillar 28 tiles away and a differently tagged one alone, and released its subscriptions; no page errors. (In the headless sandbox frames arrive ~10 s apart, so animations complete late but correctly.)

Step 3 verification: `scripts/test-rope-core.js` (bit-for-bit parity with the original rope arithmetic, plus the behaviors: settling, pumping, brake, bounce), `scripts/test-hanging-ropes.js` (attach/detach/callback chaining, weak and strong strikes, direction, stale lunges, hanging a carried burden, adopted ropes, parity with a bare core rope step for step), `scripts/test-rope-furniture.js` (spec from a placed piece's transform, routing between the ruin runtime and an owned rope, lifecycle, the shipped piece's grip height), and `scripts/test-burden-ballistic.js` (the real `shattercasks.js`: unchanged downward release, launch arcs, ground re-resolution, strike handler, `interact`, tick). In a real generated ruin: the authored mount piece placed in the ruin produced a runtime rope with the right anchor; the real *Grab Rope* prompt grabbed it (contact alone did not), pumping changed the swing, Dodge released it, and the rope was free again; a real witch bomb hung on the same rope hid the grab prompt and stopped lunges, a strike toward open floor launched it 7.55 tiles (a strike into a wall bounced and dropped it, as the original rope would); the rope was a rider's again afterward; unregistering removed it and left the mount. The Author's Rope section was exercised in a real browser. No page errors. The existing `test-dev-random-ruin-browser.js` is built for CI speed and was too slow to complete in the headless sandbox, so the migrated generated-rope path is covered by the parity test and the shared functions above rather than by that run.
