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
| `docs/js/tzatzul-flight-runtime.js` + `tzatzul-live-visuals.js` | **Review: medium** | Captive pose is snapshotted and restored, including quaternion/scale; a post-release two-frame reset may conflict with the immediately resumed locomotion/impact writer. Needs ownership-aware release handoff, not blind extra reset. |
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

- Tzatzul release now records the exact talon-authored quaternion and restores the
  captured baseline only while that rotation is still present. A fall/impact or
  locomotion writer that took over before release retains its own rotation.
  The two-frame safety check corrects only a verified replay of the *old talon*
  quaternion, never the ordinary new native pose; a new scene clears the check.
  Its last-aligned quaternion is reused per animation frame without allocations.
- NPC dance hand cleanup now occurs during the existing periodic walker poll
  as well as before rendering. A canceled, replaced or departed social action
  releases owned socket poses even when that NPC has no further render passes;
  multi-pass dances continue to preserve hand poses while active.
- Executable regression coverage includes release before visual alignment,
  resumed combat on the first post-capture frame, stale talon reapplication,
  fall takeover before release, offscreen dance cancel and walking away.

These two handoffs are specifically addressed, **not proof that all animation
paths use the ledger**. The player render composer, quaternion-based impact
animation, and authored IK retain their existing independent owners.

## Cross-action interruption suite and quaternion ownership

`scripts/test-pose-cross-action-interruptions.js` executes the production
`RigTransformLayers`, drunken-gait wrapper, `PlayerCrawl`,
`ImpactRagdollPlayback`, NPC dance presentation and Tzatzul visual
release in the same controlled VM. It transitions through walking, seated
movement, drunken thigh/foot/body offsets, named yawn head/chest offsets,
dance hand cancellation without a render, crawl and a held knockdown, visual
capture release, and repeated rig reconstruction. The existing full yawn,
Tzatzul flight and visual-release regression suites remain separate tests
run by `scripts/run-tests.js`; the cross-action suite does not duplicate
their deep browser/AI setup.

**Additional confirmed handoff:** the drunken foot and NPC torso cleanup
previously multiplied inverse quaternions unconditionally. If combat,
seating, a grab or IK had already assigned a new absolute orientation,
that cleanup could rotate the new pose incorrectly. Each drunken handle
now records its actual last-applied foot/body quaternions, and only undoes
its twist while the orientation still matches. Otherwise the old delta is
discarded, the new pose is preserved, and mobile
`HobunjiDrunkWalk.getDebug().poseHandoffs` exposes foot/body takeover counts.
Still-owned offsets continue to restore on cancellation/disposal.

This is a reproducible *unit integration* harness with targeted Three.js
doubles, not proof that every scene-render/reparenting interaction works
in a browser. A separate live browser cross-action smoke remains desirable
for ragdoll pivot parentage and attachment draw passes.

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
