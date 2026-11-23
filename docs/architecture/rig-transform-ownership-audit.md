# Procedural rig transform ownership audit (14 November 2026)

## Scope and principle

A code search of the active Three.js game runtime, animation modules, and
authoring paths looked for cumulative position/rotation/scale mutations,
quaternion post-multiplication, direct render-time poses, blend spaces,
procedural hands/legs, paired dances, combat and Tzatzul carries. This document
is a reviewed inventory, **not a proof that every transform writer in the
repository has been exhaustively enumerated**. Large authored-config files,
non-rig world animation and standalone tool previews need additional coverage.

The rule for rig presentation is: **recompute from a current baseline (absolute
pose) or own a named, removable transform contribution. Never assume another
animation will reset an offset.** A layer should be cleaned before an owner
switch, including interrupted actions, seated/mounted states and scene rebuilds.

## Findings

| Path / subsystem | Risk | Evidence / disposition |
| --- | --- | --- |
| `docs/game.js` NPC walking bob (station wander and normal route) | **Confirmed: medium** | Previously did `root.position.y += bob` *after* smoothing toward the current ground height, so earlier bob contaminated future smoothing. Now clears the named bob before the movement tick and recomposes after ground follow. |
| `docs/js/drunk-locomotion.js` thigh sway | **Confirmed: high during mode transitions** | Feet and body quaternions were tracked, but thigh XYZ used raw `+=`. The procedural leg solver zeros thigh offsets on ordinary steps, but seated and external IK have distinct paths. Now explicitly clears named thigh offsets before calling the original solver, then reapplies them. |
| `docs/js/npc-yawn-rest.js` head/chest bend | **Conditional: medium** | Old last-applied-value matching fails cleanup whenever another owner changes a rotation between yawn frames. Now uses the same additive ledger for the live game, retaining legacy fallback in isolated contexts. |
| `docs/js/npc-dance-presentation-runtime.js` late hand poses | **Review: medium** | Saves ordinary hand baseline and detects repeated render passes by position; intentionally persists the dance pose across outline/depth passes. Now releases hand position/quaternion on cancellation, style switch or sentinel disposal only when the dance still owns that value; a replacement grip/forearm animation is preserved. Covered by repeat-pass, cancel and takeover tests. |
| `docs/js/festival-wheel-dance-runtime.js` paired wheel | **Review: low** | Actor positions and quaternions are assigned from dance frame each update; ground correction adds within the freshly constructed frame. Requires interrupt tests for partner removal and hand-provider cleanup. |
| `docs/js/procedural-dance-mode-core.js` editor preview | **Review: low** | Captures a preview body baseline and uses `copy(base)` for the blended dance; restored on release. Editor leg/arm ownership should be tested during model replacement. |
| `docs/js/procedural-leg-animation.js` locomotion/seat/hover/lunge/paired IK | **Review: medium** | Most transforms are solved or reassigned absolutely. Important branches return early for seated and external contacts; any **additional** layer must remove its previous contribution *before* entering these branches. |
| `docs/js/procedural-hand-frame-driver.js` and `procedural-hand-attachments.js` | **Review: low** | Main socket poses are copied from grip and idle targets. Verify priority at render-hook boundaries, especially when multi-pass rendering can skip a writer. |
| `docs/js/player-body-transform-composer.js` | **Existing authority** | Already layers local player body contributions and restores the render transform. Do not replace it with a competing player-body owner; the shared ledger is for residual procedural local-node contributions. |
| `docs/js/drunk-prone-composition-bridge.js` | **Existing mitigation** | Temporarily draws hostile low-Footing/run lean; uses an undo closure for render-only rotation. Verify exception paths and overlapping hostile visual owners. |
| `docs/js/combat/impact-ragdoll-playback.js` + `impact-blend-library.js` | **Review: low–medium** | Interpolated blend-space body and IK samples use absolute `copy`/assignment, not unbounded accumulation. Watch for pivot reparenting and cleanup on repeated prone/stand transitions. |
| `docs/js/player-crawl.js` | **Review: low** | Uses named player-composer channels for blending in/out. Exercise rapid crawl/stand, impact and capture interrupts. |
| `docs/js/tzatzul-flight-runtime.js` + `tzatzul-live-visuals.js` | **Draw-only placement** | The flight record owns the capture and physical movement. The talon transform lasts for one world frame. Native yaw, IK and fall state never sample it between frames. |
| `docs/js/animal-sleep-presentation.js` | **Existing mitigation** | Captures render-only Y/scale and restores after the frame; guarded for game-loop and external render contexts. Test early return and rebuild. |
| `docs/js/weapon-tool-stances.js` + `tool-world-upright.js` | **Existing mitigation** | Tool offset and world-up correction are temporary during the holder's matrix update; `finally` restores holder position/quaternion and child twist. Do not strip this without understanding its matrix-bake handoff. |
| `docs/js/furniture-piece-animation-runtime.js` | **Existing mitigation** | Hinge/spin/bob are appended after `basePivotFrame()` restores the authored pivot each update. |
| `docs/js/spouse-kiss-motion.js` + `bed-lie-pose.js` | **Review: medium** | Paired and lie poses use absolute body transforms and explicit teardown, but are sensitive to changes in parentage and interruption order. |
| `docs/js/game-feel.js` camera shake | **Not a rig leak** | Temporarily adds position/roll and provides a corresponding `restoreShake()` in the frame path. |

## New local transform ledger

`window.RigTransformLayers` is loaded before NPC/character runtimes.
It is a lightweight, allocation-conservative, per-node `WeakMap` of named
axis offsets. It composes concurrent named owners from an unchanged axis
baseline; `setAxis` and `setPosition` are idempotent. Three-axis writes
validate every coordinate before mutating the target, avoiding partial poses.
`clear(node, owner)` and `clearAll(node)` release contributions on cancel
and dispose. If another system assigns a different absolute value, the ledger
drops prior owner claims **without subtracting a stale inverse**.

Mobile debugging: `RigTransformLayers.getDebug()` returns writes, clears,
externalTakeovers, invalidInputs, activeLayers and slotsCreated. Empty per-axis
records are retained under the node's WeakMap so continuous clear/reapply
cycles do not allocate a new owner Map each animation frame.

Important limitation: an uncoordinated third-party additive writer that changes
an axis after the ledger's last write looks like an absolute takeover. That
writer must either register its own layer or restore its transform before the
next ledger update. Quaternion and full-parent-space transforms continue to be
owned by existing composer/pose systems; they are *not* represented as Euler
angle offsets indiscriminately.

## Independent editor loader review

The Enemy Loadout Editor has its own ordered classic-script loader.
It previously used an old drunk-locomotion.js cache token and omitted the
new ledger. The preview now loads rig-transform-layers.js first, then the
current drunken locomotion module; the editor module-import cache-bust chain
was updated too. This prevents editor-only untracked thigh offsets.

## Follow-up: pose handoff coverage

- NPC dance hand cleanup now occurs during the existing periodic walker poll
  as well as before rendering. A canceled, replaced or departed social action
  releases owned socket poses even when that NPC has no further render passes;
  multi-pass dances continue to preserve hand poses while active.
- Executable regression coverage includes release before visual alignment,
  resumed combat on the first post-capture frame, stale talon reapplication,
  fall takeover before release, offscreen dance cancel and walking away.

These handoffs are specifically addressed, **not proof that all animation
paths use the ledger**. The player render composer, quaternion-based impact
animation, and authored IK retain their existing independent owners.

## Recommended next migration/testing pass

Continue auditing remaining overlap beyond the corrected dance-hand and
Tzatzul talon handoffs: repeated prone/standing interrupted by capture,
parent-pivot changes during impact/ragdoll playback, and authored procedural
IK after rapid action cancellation.
Then run deliberate alternating sequences: walking → sitting → drunk →
yawning → dance → bird capture → knockdown → crawling → re-spawn, checking
position/quaternion/scale at identical baseline points in the existing
`RigTransformDump`/Pixel Probe capture. Ensure no unowned transform survives
after each transition. Do not move the player render-composer or impact-pose
sampling into the ledger: those already have stronger ownership contracts.

## Implemented ownership hardening (17 November 2026)

This is a **first implementation tranche**, not certification that every runtime rig writer uses one compositor. The preceding inventory remains a list of migrations and verification work.

- `js/rig-transform-layers.js` now exposes both `ActorRigCompositor` and the backwards-compatible `RigTransformLayers` name. Euler rotation owners on Three.js rigs and named quaternion owners share one per-node rotation store; translations keep their existing named-axis API.
- An out-of-band write *while an effect owns the node* is reported and **rejected as canonical baseline**. The last clean pre-effect transform is restored and competing claims removed. Known absolute animators can instead explicitly hand off with `setAbsoluteBase`. When no effect is active, new absolute solver output remains eligible to establish the next clean base.
- `setQuaternion(node, owner, delta, {leaseMs})` provides removable, time-bounded local body/foot sway. The player compositor drives `expireStale` at its render boundary and shares the same channel registry through `channelStore('player-body')`.
- NPC/bandit `ActorBodySink` uses a named additive Y layer in normal gameplay, preserving the original fallback for isolated previews. NPC drunk body tilt and both foot twists use expiring named quaternion layers instead of manual inverses.
- Pixel Probe and Full Rig Dump now expose counters for out-of-band writes, the last conflicting node/owners, expired leases and remaining active layers on mobile. The enemy workshop loads the owner registry before either body or gait composer.

### Remaining work before the original goal can be called complete

- Migrate paired wheel dance and spouse kiss away from whole-pose historical-snapshot teardown; use action-scoped absolute claims that cannot overwrite a newer action.
- Move late player-yawn and NPC-dance hand presentation from private baseline/equality checks into a compositor-owned hand phase shared by all render passes.
- Make impact/ragdoll reparenting generation-safe (or use permanently installed neutral pivots); migrate Tzatzul capture/release to explicit ownership handoff.
- Register authoritative absolute neck look, player facing, leg IK, hand grips and root travel with safe precedence relative to additive effects; keep physics locomotion as the source of world position.
- Extend actor-generation binding, disposable multi-node action owners and absolute/scale/quaternion claims to all NPCs, enemies and creatures. Persistent stance sinks still require their existing explicit release; do not assign a short lease without proving their refresh cadence.
- Run the repository-wide transform-writer AST census and headless scene interruption matrix (including rebuild, seat, dance, grapple, knockdown and secondary render passes). No complete runtime coverage or successful gameplay soak has yet been demonstrated.

Tests: `scripts/test-rig-transform-layers.js` executes independent node-layer composition, unknown-write rejection, explicit baseline handoff, quaternion/Euler overlap, lease expiry and body-sink cleanup. `scripts/test-drunk-locomotion-footing-source.js` now executes the real named NPC body quaternion path and verifies disposal. Run them and the fast suite in a full checkout before merging.

## Scoped authored-pose ownership (17 November 2026, follow-up)

The shared `ActorRigCompositor.createAbsoluteSession(owner)` now covers **authored
absolute joint/actor poses**, not just additive local offsets. A session
captures the pre-action pose of each named root/joint once, then stamps the
values its own solver authored. On cancellation it restores only properties
that are still stamped with that exact action's last output **and** still
belong to the same rig generation/parent. New root movement invalidates
descendant restoration, even if a neck's unchanged local quaternion looks
identical. Sessions also refuse simultaneous claims by competing actions.
A diagnostic snapshot reports live claims, conflicts, takeovers and skipped
restores; action diagnostics report the last release's restored/skipped counts.

Migrated:
- `festival-wheel-dance-runtime.js`: both actors' root positions/quaternions,
  leg-group orientations and neck quaternions use one scoped session. A new
  owner triggers exit before another dance frame writes. Secondary idle legs/
  hands are not reset on a displaced actor. Partial reach failures and solver
  exceptions release claimed transforms before locks and camera hand back.
- `spouse-kiss-motion.js`: player and spouse roots, player torso, external
  hand roots, NPC bow pivot and both neck positions/quaternions are captured
  through the same compositor. A late root/neck writer is preserved on exit;
  interrupted solver frames are stamped before rollback. NPC sink now has a
  dedicated `spouse-kiss-npc-sink` layer so its cleanup cannot remove another
  actor's root-Y sink. The authored leg/contact solver remains authoritative
  and its knee/foot-target teardown is guarded when another rig takes over.
- `actor-body-sink.js`: an optional per-actor `ownerId` controls the named
  Y-layer; old callers retain the default `actor-body-sink` owner.

Coverage: the executable layer test now includes ancestor takeovers, competing
absolute sessions and overlapping body-sink owners. The existing paired-dance
test runs with the real compositor and includes root/neck interruption cases.
The live Three.js spouse-kiss test now exercises a new root and head owner.
Browser-level render-boundary and full-suite CI are still required before
claiming production stability.

## Additional compositor integration: procedural IK and ragdoll (17 November 2026)

**NPC dance hand presentation:** `npc-dance-presentation-runtime.js` now uses
`applyPoseOverlay`/`releasePoseOverlay` with one named owner per hand socket.
The shared registry retains the last ordinary grip baseline and last rendered
dance pose, so repeat draws are idempotent, changing dance styles/rig generations
releases old claims, and an exclusive paired-animation pose lock wins.
`procedural-hand-forearm-alignment-runtime.js` stamps its final quaternion
via `stampPoseOverlay`, so a later forearm correction is part of the same
owned visible pose, including outline/depth passes; the dance sentinel does
not repaint pre-aligned hands on same-frame override-material draws.

**Recorded impact, prone and ragdoll pivots:** `impact-ragdoll-playback.js`
acquires explicit `createAbsoluteSession` claims on humanoid prone and
creature impact/death pivots. Each authored frame stamps position/quaternion,
an externally displaced pose is preserved during interruption cleanup,
and a rebuilt creature/avatar generation does not reuse the old pivot.
Living hit reactions cannot displace a corpse's persistent recorded pose.
Existing isolated editor previews retain their no-compositor compatibility.

**Authoritative procedural IK:** `procedural-leg-animation.js` publishes
the actual, already-solved hip/thigh/calf/foot baselines after ordinary gait,
idle, seated, hover/airborne, lunge, suppression, external foot contact and
recorded impact clips. It calls `restoreSolvedBase` *before* incremental
IK sampling so an old additive sway does not become the next frame's input.
`procedural-hand-frame-driver.js` similarly publishes actual ordinary
grip/idle socket baselines. Shoulder and late forearm alignment publish their
final neutral quaternion when an exclusive pose owner does not control that
joint. All of these use the same compositor registry as named additive
channels, without replacing the existing anatomical solvers.

**Regression coverage:** `test-rig-transform-layers.js` covers named
overlays, baseline updates, double recovery, exclusive IK claims and
interrupted cleanup. `test-npc-dance-rig-ownership.js` runs the real
render sentinel and verifies cancellation, lock takeover, baseline refresh,
late forearm quaternion and same-frame outline behavior.
`test-impact-ragdoll-rig-ownership.js` runs the real impact playback under
rebuild, interrupted prone, live hit and corpse death cases.
These focused tests are not a substitute for a live multi-actor WebGL soak
or the full project CI suite.

**Still beyond full unification:** bespoke render-transaction hand poses
(e.g. cliff crawling and some animation-author tool previews), creature
species-specific pose rigs, player-facing/neck providers and other specialist
absolute writers require separate ownership and interruption audits. Avoid
blind periodic whole-skeleton resets: they would override valid intentional
poses. The old audit's earlier migration checklist is retained as historical
context, not as the current list of unimplemented features.

## Follow-up interruption audit and fixes (17 November 2026)

A separate audit reproduced a real missing cross-owner handoff: a named additive
joint effect was expiring while a scoped absolute action owned the same
position/quaternion. The expiration called the old ledger's out-of-band
reconciliation and reset the authored pose. In a deterministic production-code
fixture a held joint at Y=3 snapped to Y=1 without the absolute action ending.

The shared compositor now **defers additive writes, removals and lease expiry
under active absolute property claims**, including NPC dance overlays; it does
not silently renew expired effects. An absolute action captures the **clean**
IK baseline beneath any active named contributions. On a valid release it
restores that clean baseline and recomposes only contributions that still
exist; on a successor pose takeover it discards obsolete suspended
contributions without writing over the new owner. A concurrent
`setAbsoluteBase` call is also rejected while another scoped action owns
that property. Hand overlays retain a separate clean underlying baseline so
their exit does not double-add existing wrist effects or lose deferred ones.

The NPC dance socket search now filters by the **current procedural-hand rig
generation**, even if old and replacement rigs coexist under one NPC root.
Creature impact pivots are validated against the current avatar root, and
stale pivots are detached rather than remaining as ghost render meshes.
An attempted living-creature reaction does not touch persistent corpse
geometry.

Regressions added to `test-rig-transform-layers.js` exercise lease expiry
during a held action, additive refresh while suspended, restoration after
handoff, newer native takeover, concurrent explicit baselines, and effects
added or removed below a hand overlay. The real NPC-dance and creature-impact
fixture tests also exercise overlapping old/new rig generations. These checks
complement, but do not replace, real game/browser interruption soak testing.

## Draw-only actor placement and Tzatzul carry

Talon alignment previously wrote a full position and quaternion into the live
actor root during simulation. The next player frame rewrote yaw only, leaving
talon pitch and roll in the root. The release session saw a different quaternion
and treated the whole transform as a native takeover. A subsequent grab could
then use the contaminated pose as its baseline.

The flight runtime owns the capture record, logical position and fall handoff.
The visual runtime resolves the authored talon socket against the current actor
root and decomposes it into scratch space. The player body composer applies the
placement before drawing the player's rig and its scene-sibling attachments.
Captured wildlife uses the same placement primitive in a world-frame hook.
Acceptance of a draw pose leaves existing simulation claims intact. Placement
preserves scale and skips roots with existing absolute position or rotation
claims.

For other whole-actor presentation effects, use
`ActorRigCompositor.applyRenderPose(root, owner, position, quaternion, undo)`
inside an existing render-frame transaction. Put the rollback in the frame's
finally path and keep joint solvers that publish persistent baselines outside
the placed pose. Draw-time descendants can query `renderPoseOwner(node)`;
the hand and forearm solvers use it to keep their pre-render IK during the
carry. The actor's original root transform and world matrices are restored at
frame end, including after a draw error. Retain the native quaternion as well
as the authored Euler angles, since a near-singular Euler conversion can lose
rotation on rollback. Release removes the capture record
and needs no pose cleanup or delayed correction.

The Wildlife panel reports applied carry poses, unavailable rigs and root
conflicts. The full rig dump includes the count of active draw placements.
`scripts/test-tzatzul-captive-pose-ownership.js` covers repeated yaw-only
solver updates during capture, base pose retention on release, competing
absolute owners, rig promotion, depth replay, and rollback after a failed draw.
