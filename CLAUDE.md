# HobunjiHollowUnity — notes for AI agents

The game is `docs/index.html` + `docs/game.js` (a single ~28k-line IIFE) plus
feature modules under `docs/js/*.js` that are loaded before it. See
`README.md` for the feature-level history/architecture notes.

## `game.js` is being decoupled incrementally — keep pushing that forward

`game.js` started as one monolithic closure and is being carved down over
time. Grep it for `now lives in js/` / `now live in js/` (currently 50+ hits)
to see the pattern already in place: a self-contained piece of behavior gets
pulled out into its own `docs/js/<name>.js` file, exposed as
`window.<Namespace>`, and wired back into `game.js` via one `init(deps)` call
that hands it exactly the state/functions it needs (see
`docs/js/wilderness-chunks.js`, `docs/js/zone-terrain-features.js`,
`docs/js/dev-spawner.js`, `docs/js/natural-surface-materials.js` for
reference shapes — some export plain functions, some wrap an existing
`window.Foo.someMethod` in place to add behavior). A one-line comment is left
behind at the old location pointing to the new file.

**Whenever you're touching `game.js` for any other reason and you notice a
function, or a cluster of closely-related functions, that could be safely
extracted the same way — do it as part of that work, not just when
explicitly asked.** "Safely" means: its dependencies on `game.js`'s closure
state are small enough to thread through an `init(deps)` call cleanly, it
doesn't require also moving a large web of tightly-coupled callers in the
same change, and you can verify it still works after moving it (headless
test via the `headless-game-test` skill, or at minimum a syntax check plus
tracing every call site). Don't force an extraction that would require a
large, risky rewrite just to hit this goal — opportunistic means low-risk
and incremental, the same size/shape as the 50+ extractions already done,
not a big-bang refactor. Leave the same kind of breadcrumb comment at the
old call site that the existing extractions do.

This is a standing instruction, not a one-off: it applies to every session
that edits `game.js`, not just the one it was added in.

## Headless testing

Use the `headless-game-test` skill before claiming a rendering/behavior
change works — it documents the three.js CDN workaround and the debug hooks
(`window.__hobunjiFurnitureDebug`, `window.DevSpawner`, `window.PerfProfiler`,
`window.WildernessChunks`, `window.HobunjiCacheAudit`, etc.) needed to drive
and inspect the game from Playwright without a real browser session.
