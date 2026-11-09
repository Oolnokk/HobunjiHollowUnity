# Game feel: impacts, solve feedback, lock-on and the ruin HUD

One owner per effect, so new content gets the same feel by calling one function
instead of re-implementing shake/sound/camera tricks locally.

## `js/game-feel.js` (`window.GameFeel`)

| Effect | How it works | Who triggers it |
| --- | --- | --- |
| Camera shake | Trauma model (shake = trauma²), smooth multi-sine noise, camera-space offset + tiny roll. Applied at the `RuntimeFrameScheduler` **pre-render** checkpoint and removed in **post-game**, so `updateCameraPosition()`'s smoothing/collision never integrates it. | `addTrauma(a)` — melee hits (`CombatAttackEvents 'hit'`), `WorldEvents 'blast'`, `playerHurt`, moving stone, solves, chests, sinking gates |
| Controller rumble | Same events (≥ 0.12 trauma), throttled, through `ControllerInput.frame().pad` | `addTrauma` |
| Hit-stop | `gameLoop` asks `GameFeel.frameDt(dt)`; for 55–100 ms the simulation runs at 7 % speed | melee hits, player damage |
| Hurt flash | Fixed red vignette div, DOM written only on the event | `game.js damagePlayer` → `playerHurt(amount)` |
| Solve motif | Original synthesized bell figure (no asset) | `RuinInteractionAudio.puzzleComplete()` → `puzzleSolved()` |
| Progress notes | One rising pentatonic bell per partial success | `RuinInteractionAudio.progress(step, total)` |
| Reveal shot | If a mechanism starts moving ≤ 1.9 s after a solve, `CinematicCameraRuntime.activate()` pans to it for 2.3 s with letterbox bars and a `CharacterActionLocks` movement lock. Skipped in combat, mid-traversal (jump/ladder/rope/dodge), when already on screen, or on another floor/too far. | `RuinInteractionAudio.mechanism(object)` → `mechanismMoved()`; `beginReveal(object)` directly (Great Door waking) |
| Sinking stone | Presentation-only slide-down + hide + restore of a gate whose collision the caller already opened | `sinkAway(object)` / `cancelSink(object)` (shaft wing + native chamber gates) |
| Treasure motif | Upward run → chord, richer for tier 3+/boss | `DevRandomRuinDungeonChests.open` |

Settings → Camera → **Screen Shake** turns off shake, rumble and hit-stop
(`localStorage hobunjiScreenShake = '0'`).

To make a new puzzle feel right: call `RuinInteractionAudio.progress(n, total)`
for partial steps, `RuinInteractionAudio.puzzleComplete()` once on the solve,
and let the door/bridge report its motion through `RuinInteractionAudio.mechanism`
or `watchMovement`. Duplicate solve reports within 500 ms play once.

## Lock-On (`game.js`, beside the mobile auto-target)

`lockOn` input (desktop middle click, controller Y/Button3) toggles
`desktopLockOnActive`. It reuses the mobile auto-target end to end — the same
`manualAutoTarget`, red lock ring, `updateMobileAutoTargetCamera` tracking and
`swapAutoTarget` — via `autoTargetPlatformAllowed()`. Acquisition: hostiles
within 10 tiles and 80° of the camera bearing, visible. It releases when the
target is lost or the weapon is put away. Do not add a second targeting path.

## Ruin HUD

* `js/ruin-objective-tracker.js` — top-left checklist + one-line next step,
  built from `DevRandomRuin.getShaftNetworkState()` and
  `DevRandomRuinSanctum.getState()`; 4 Hz, DOM writes only on change.
  Settings → Camera → **Ruin Objective Tracker**.
* Every ruin announces a seeded title card (`DevRandomRuin.getTitle()`).
* With Dev Mode off the ruin Map tab is a parchment dungeon map with the same
  checklist; Dev Mode keeps the collision/occupancy diagnostics.
* Ruin camera obstacles include raised daises, push blocks and upper-story
  walls (`registerUpperStoryCameraObstacles`); gates are excluded because r128
  raycasts ignore `visible`.

Tests: `scripts/test-game-feel-and-ruin-tracker.js`, desktop lock-on section of
`scripts/test-mobile-autotarget.js`.
