# Runtime frame ownership

Use one obvious cadence owner for each kind of work:

| Work | Owner |
| --- | --- |
| Gameplay simulation, movement, resources, and hostile AI | `gameLoop` |
| Permanent once-per-browser-frame visual/runtime work | `RuntimeFrameScheduler` |
| Final transforms that depend on Three.js render order | `onBeforeRender` |
| Genuinely low-frequency work | Timers or events |
| One-shot layout or focus deferral | A documented one-shot `requestAnimationFrame` |
| Isolated editor/preview animation | Its isolated animation context |
| Animation whose established ordering relative to `gameLoop` is not yet representable | Its documented existing RAF until scheduler phases are proven |

## Adding a browser-frame subscriber

Keep the implementation in the feature module. The scheduler coordinates callbacks; it must never acquire feature-specific gameplay knowledge.

```js
const SCHEDULER_ID = 'example-runtime'; // Used for scheduler ownership, disposal, tests, and on-demand diagnostics.

function updateFrame({ timestamp, deltaMs, frameId }) {
  // Feature-owned visual work.
}

RuntimeFrameScheduler.register(SCHEDULER_ID, updateFrame, {
  phase: 'visual',
  owner: 'ExampleRuntime',
  description: 'Short statement of the visible responsibility.',
});
```

Use `setEnabled(id, false)` when a registered feature is temporarily inactive. Use `unregister(id)` when its module is disposed. Registration IDs must be stable and unique.

Do not add frame throttling while migrating an existing runtime. First move ownership with identical cadence and behavior; optimize the subscriber in a later, independently testable change.

The frame-context object is reused to avoid a permanent allocation. Read its values synchronously inside the callback; do not retain the object for later use.

## Ordering and error behavior

Subscribers run in stable registration order. One subscriber must not rely on another subscriber's incidental order; a real dependency belongs in a shared owner API.

A subscriber registered while a frame is already dispatching first runs on the following browser frame. This keeps one frame's participant set stable and prevents recursive registration from extending the active dispatch indefinitely.

The scheduler isolates subscriber errors and schedules the next browser frame before dispatch. A broken feature therefore cannot stop unrelated visual runtimes. Errors and subscriber state are available through `RuntimeFrameScheduler.getDebug()`.

Render-order sentinels such as procedural hands at `-100000` and social dancing at `-99990` stay in their Three.js render hooks. They are not scheduler candidates.

`QuickAttackBonusIndicator` is also a deliberate temporary exception. Its historical RAF runs before `gameLoop`, while the melee and ranged HUD reticles historically run after it. It keeps that isolated RAF until an explicit scheduler phase contract can preserve both sides of that ordering.

## Ownership audit

Every direct `requestAnimationFrame(` call site reachable from `docs/index.html` (the shipped runtime dependency graph — game.js plus every `docs/js/*.js` module it loads, statically or dynamically, transitively) must have an explicit ownership entry in `scripts/runtime-frame-ownership-exceptions.json`. `scripts/test-runtime-frame-ownership.js` crawls that graph the same way a browser would, finds every direct call site, and fails if one has no manifest entry, if a manifest entry is stale (its file no longer exists, is no longer reachable, or no longer contains the call it describes), or if a classification isn't one of the documented values (`scheduler`, `game-loop`, `render-hook`, `timer-event`, `one-shot`, `bounded-animation`, `isolated-context`, `temporary-order-exception`).

This does not ban `requestAnimationFrame` — it bans an *unclassified* one. A future change touching one file should never require reconstructing this whole document's history to know whether its RAF is intentional; the manifest entry says so directly. Editors and previews under `docs/tools/` load their own `panel-ui.js`/scene setup and are never reachable from `docs/index.html`, so they are outside the audit entirely and need no manifest entries.

## Diagnostics

`getDebug()` allocates its report only when requested. Per-subscriber duration measurement is disabled by default because detailed timing itself costs frame time. It can be enabled temporarily with `setProfilingEnabled(true)`.

When modifying a subscriber, read:

1. The feature module containing its registration.
2. `scripts/test-runtime-frame-scheduler.js`.
3. The feature's focused regression test.

No search through `game.js` should be required merely to discover who drives its browser-frame update.
