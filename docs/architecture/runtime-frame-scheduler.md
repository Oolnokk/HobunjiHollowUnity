# Runtime frame ownership

Use one obvious cadence owner for each kind of work:

| Work | Owner |
| --- | --- |
| Gameplay simulation, movement, resources, and hostile AI | `gameLoop`, invoked as `RuntimeFrameScheduler`'s one frame driver |
| Permanent once-per-browser-frame visual/runtime work | `RuntimeFrameScheduler` subscribers |
| Final transforms that depend on Three.js render order | `onBeforeRender` |
| Genuinely low-frequency work | Timers or events |
| One-shot layout or focus deferral | A documented one-shot `requestAnimationFrame` |
| Isolated editor/preview animation | Its isolated animation context |
| Animation whose established ordering relative to `gameLoop` is not yet representable | Its documented existing RAF until it is migrated to a scheduler phase |

## The browser owns exactly one `requestAnimationFrame`

`RuntimeFrameScheduler` is that one `requestAnimationFrame`. Everything else — subscribers and `gameLoop` alike — is invoked *by* the scheduler, once per browser frame, in this fixed order:

```
requestAnimationFrame
  -> input        subscribers (earliest browser-frame work)
  -> pre-game     subscribers (after input, before gameplay simulation)
  -> frame driver (gameLoop: simulation, AI, movement, resources, ...)
       -> pre-render checkpoint (the driver calls
          RuntimeFrameScheduler.checkpoint('pre-render') itself, at the
          exact point simulation/state mutation has finished and
          gameplay rendering is about to begin)
       -> renderer.render(...)
  -> post-game    subscribers (after the frame driver/render has completed)
```

Within one phase, subscribers run in stable registration order.

`gameLoop` is registered once, near the bottom of `docs/game.js`, via:

```js
window.RuntimeFrameScheduler.setFrameDriver(frameContext => gameLoop(frameContext.timestamp));
```

`setFrameDriver` accepts exactly one driver; calling it again with a *different* function throws, since having two gameplay RAF cadence owners is exactly the bug this contract exists to prevent. Calling it again with the same function (e.g. a dev reload of the same script) is a no-op.

## Adding a browser-frame subscriber

Keep the implementation in the feature module. The scheduler coordinates callbacks; it must never acquire feature-specific gameplay knowledge.

```js
const SCHEDULER_ID = 'example-runtime'; // Used for scheduler ownership, disposal, tests, and on-demand diagnostics.

function updateFrame({ timestamp, deltaMs, frameId }) {
  // Feature-owned visual work.
}

RuntimeFrameScheduler.register(SCHEDULER_ID, updateFrame, {
  phase: 'post-game', // One of: input, pre-game, pre-render, post-game.
  owner: 'ExampleRuntime',
  description: 'Short statement of the visible responsibility.',
});
```

`phase` must be one of `input`, `pre-game`, `pre-render`, or `post-game` — `register()` throws on anything else. Omitting `phase` defaults to `post-game`, since most subscribers so far are HUD/presentation work with no ordering dependency on gameplay simulation. Use `pre-render` only for work that needs this frame's already-mutated gameplay state but must run before Three.js traverses the scene; that phase is dispatched exclusively via the frame driver's own `checkpoint('pre-render')` call, never automatically.

Use `setEnabled(id, false)` when a registered feature is temporarily inactive. Use `unregister(id)` when its module is disposed. Registration IDs must be stable and unique.

Do not add frame throttling while migrating an existing runtime. First move ownership with identical cadence and behavior; optimize the subscriber in a later, independently testable change.

The frame-context object is reused to avoid a permanent allocation. Read its values synchronously inside the callback; do not retain the object for later use.

## Ordering and error behavior

Subscribers run in stable registration order within their phase. One subscriber must not rely on another subscriber's incidental order; a real dependency belongs in a shared owner API.

A subscriber registered while a frame is already dispatching first runs on the following browser frame. This keeps one frame's participant set stable and prevents recursive registration from extending the active dispatch indefinitely.

The scheduler isolates subscriber errors and schedules the next browser frame before dispatch. A broken feature therefore cannot stop unrelated visual runtimes, the frame driver, or later phases in the same frame. The frame driver itself is isolated the same way: if `gameLoop` throws, the scheduler still dispatches `post-game` subscribers that frame and still schedules the next frame. Errors and subscriber state — including a failing frame driver's own error count/message — are available through `RuntimeFrameScheduler.getDebug()`.

`checkpoint('pre-render')` may only be called from inside the frame driver's own execution, and at most once per frame; both misuses throw immediately, as does an unrecognized checkpoint name. These are contract violations in the calling integration code, not an isolated subscriber failure, so — unlike a subscriber callback — they are not caught and silenced.

Render-order sentinels such as procedural hands at `-100000` and social dancing at `-99990` stay in their Three.js render hooks. They are not scheduler candidates.

`QuickAttackBonusIndicator` is a deliberate temporary exception: its historical RAF runs before `gameLoop`, while the melee and ranged HUD reticles historically run after it. Now that the `pre-game`/`post-game` phase contract above exists and is proven (see `scripts/test-runtime-frame-scheduler-ordering.js`), migrating it to `phase: 'pre-game'` is the next step — but that migration, and removing this exception from the manifest, is deliberately a separate, later change so this phase contract can land and prove itself on lower-stakes subscribers first. Until then it keeps its isolated RAF.

## Ownership audit

Every direct `requestAnimationFrame(` call site reachable from `docs/index.html` (the shipped runtime dependency graph — game.js plus every `docs/js/*.js` module it loads, statically or dynamically, transitively) must have an explicit ownership entry in `scripts/runtime-frame-ownership-exceptions.json`. `scripts/test-runtime-frame-ownership.js` crawls that graph the same way a browser would, finds every direct call site, and fails if one has no manifest entry, if a manifest entry is stale (its file no longer exists, is no longer reachable, or no longer contains the call it describes), or if a classification isn't one of the documented values (`scheduler`, `game-loop`, `render-hook`, `timer-event`, `one-shot`, `bounded-animation`, `isolated-context`, `temporary-order-exception`).

This does not ban `requestAnimationFrame` — it bans an *unclassified* one. A future change touching one file should never require reconstructing this whole document's history to know whether its RAF is intentional; the manifest entry says so directly. Editors and previews under `docs/tools/` load their own `panel-ui.js`/scene setup and are never reachable from `docs/index.html`, so they are outside the audit entirely and need no manifest entries.

## Diagnostics

`getDebug()` allocates its report only when requested. Per-subscriber duration measurement is disabled by default because detailed timing itself costs frame time. It can be enabled temporarily with `setProfilingEnabled(true)`.

When modifying a subscriber, read:

1. The feature module containing its registration.
2. `scripts/test-runtime-frame-scheduler.js` (bootstrap/HUD migration contracts) and `scripts/test-runtime-frame-scheduler-ordering.js` (the phase/frame-driver/checkpoint ordering contract — the source of truth for frame order; re-run it alone after any change to `runtime-frame-scheduler.js` itself).
3. The feature's focused regression test.

No search through `game.js` should be required merely to discover who drives its browser-frame update.
