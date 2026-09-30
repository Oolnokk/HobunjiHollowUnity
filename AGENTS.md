# Hobunji Hollow — Coding Agent Notes

This file records project-specific implementation rules that are easy to miss when working from an isolated bug report. Treat these as repository invariants unless a task explicitly calls for changing them.

## Running tests

- Run only the tests related to what you changed: `node scripts/run-tests.js <name-fragment> [...]` (e.g. `node scripts/run-tests.js livestock`). Run the whole fast suite (`node scripts/run-tests.js`, ~10s) once before finishing, not after every edit.
- Don't fix tests that were already failing before your change, and don't touch the `KNOWN_BROKEN` list in `scripts/run-tests.js` unless the task is about those tests.
- Don't add a new `.github/workflows/*.yml` for a new test. `scripts/test-*.js` files are picked up automatically by `.github/workflows/regression-suite.yml`.
- Prefer tests that execute the code over tests that assert exact source text with `includes(...)`/regex. Source-text assertions break on harmless refactors.

## Recurring mistakes — check these before finishing

Drawn from the commit history (~9k commits) and the periodic review-fix commits. Each has shipped more than once.

1. **Cache-bust tokens.** Every file under `docs/` is loaded as `file.js?v=<token>`; a changed file whose token did not move ships to players as the cached old copy. Many modules load through other modules (`combat/combat-config-loader.js`, the `*-bootstrap.js` files, `index.html`), so bumping one token changes a loader, whose own token then has to move too. Don't do this by hand: run `node scripts/check-cache-busts.js --fix` after editing — it bumps every stale reference up the chain — and commit the result. CI runs the same check on PRs. When resolving a merge conflict on a `?v=` token, take either side and re-run `--fix`; don't glue both tokens together.
2. **Tests that pin an exact `?v=` token or exact source text.** Any later PR that touches the file breaks them. To check a module is loaded, match any token (`/foo\.js\?v=[A-Za-z0-9_-]+/`); to check behavior, run the code. `scripts/test-no-cache-token-pins.js` rejects new token pins.
3. **Writing a file from a stale copy.** Re-read a file from the current branch head right before writing it, and change only the lines you mean to. Whole-file rewrites from an older snapshot silently undo other people's work (see the many `Reapply … after latest main` / `Restore …` commits).
4. **Bypassing an existing single authority.** Input goes through `ControllerInput` / `WorldActionInputClaims` (never `navigator.getGamepads()` directly), per-frame work through the owners in `docs/architecture/runtime-frame-scheduler.md`, creature/species data through its one registration helper. Search for the existing owner before adding a second path that does the same job.
5. **Stacking patch files instead of fixing the module.** `*-fix.js`, `*-fixes.js`, `*-v2/v3/v4/v5.js`, and wrappers that replace `window.Foo.method` add another layer and another loader entry every time. Edit the module that owns the behavior; add a wrapper only when that module is genuinely off-limits, and say why in its header.
6. **Per-frame waste.** In anything called every frame: no `new THREE.Vector3/Matrix4` (reuse scratch objects), no `scene.traverse` (cache or scan shallowly), no `JSON.stringify`/`localStorage` or other re-serializing, and no unconditional DOM writes — `textContent =`, `setAttribute`, `classList.add/remove` all queue MutationObserver records even when the value is unchanged, which has repeatedly created self-sustaining 60 fps refresh loops. Compare before writing.
7. **Mutating shared definitions.** Objects like `CREATURE_DB` entries are shared by every creature of a species. Put per-instance changes (slows, buffs, overrides) on the instance or a per-instance overlay, never on the def.
8. **Code that is never wired in.** A new module or builder function isn't done until something calls it. Trace the call from `index.html` / the loader / `game.js` to your code, and cover it with a test that executes it.
9. **Missing-key math.** Inventory/stat lookups that can be `undefined` become `NaN`, and every `NaN < cost` comparison is false — which makes things free. Default missing keys to `0`.
10. **New CI workflows.** Don't add them; `scripts/test-*.js` is picked up by `regression-suite.yml` automatically (per-feature workflows and ones scoped to scratch branches have gone stale before).

Before finishing: `node --check` the files you touched, `node scripts/check-cache-busts.js --fix`, then `node scripts/run-tests.js`.

## Runtime frame ownership

Before adding, removing, or migrating permanent `requestAnimationFrame` work, read [`docs/architecture/runtime-frame-scheduler.md`](docs/architecture/runtime-frame-scheduler.md). It defines which work belongs to `gameLoop`, `RuntimeFrameScheduler`, Three.js render hooks, timers/events, or an isolated animation context. Feature modules register their own scheduler callbacks; do not add feature-specific behavior to the scheduler itself.

## Canonical PNG-plane rendering path

For authored PNGs that become Three.js planes or other sprite-like 3D surfaces, **reuse the shared PNG-plane pipeline instead of recreating texture/material settings locally**.

Canonical API:

- Defined in `docs/js/portrait-utils.js`.
- Exposed as `window.HobunjiSpritePngSurface` (legacy fallback: `window.HobunjiPngPlaneUnlit`).
- Prefer `HobunjiSpritePngSurface.makeCanvasTexture(THREE, canvas, debugName)` for canvas-backed PNG textures.
- Prefer `HobunjiSpritePngSurface.makeMaterial(THREE, texture, debugName, overrides)` for the matching unlit material.
- Use `HobunjiSpritePngSurface.alphaTest()` rather than inventing a new cutout threshold.

The avatar plane, body sprites, hands/feet, held tools/weapons, and same-style authored PNG surfaces are expected to share this appearance path. If a new PNG plane behaves differently from existing sprites, first compare it against this API rather than adding special-case material flags.

## Canvas/WebGL image loading: CORS is required

If an `Image` will ever be drawn to a canvas that is later read with `getImageData()` or uploaded to WebGL as a `CanvasTexture`, set CORS **before** assigning `src`:

```js
const image = new Image();
image.crossOrigin = 'anonymous';
image.src = url;
```

This is already how the normal portrait image loader in `docs/js/portrait-utils.js` works.

Do not omit `crossOrigin` just because an image visibly loads. With raw.githack/CDN/redirected asset URLs, an image can load and even draw correctly in ordinary 2D canvas while still **tainting the canvas**. A tainted canvas cannot be read with `getImageData()` and may be rejected/blank when WebGL tries to upload it.

Typical symptoms of a tainted image/canvas:

- `image.onload` succeeds and reports sensible dimensions.
- 2D preview can look correct.
- `context.getImageData(...)` throws a `SecurityError`.
- diagnostics that initialize alpha counts to `-1` stay at `-1` because the read failed.
- a canvas-backed Three.js plane may disappear or fail to show the PNG while independently drawn text still renders.

When debugging this class of issue, distinguish **asset load success** from **canvas origin cleanliness**.

## Avoid hand-rolled sprite materials

Do not copy a nearby `new THREE.CanvasTexture(...)` + `new THREE.MeshBasicMaterial(...)` block and assume it is equivalent to the sprite pipeline. Small differences in color management, alpha testing, or loading provenance can make a plane behave differently even when the visible material flags look similar.

Only hand-roll the material when the surface is intentionally not a normal authored PNG/sprite, and document why.

## World-space transient icon + text effects

For effects conceptually similar to ambient chatheads, prefer a grouped layout of independent billboard children instead of baking unrelated pieces into one large rectangular texture:

- square icon/portrait child plane
- independent text child plane
- one parent `THREE.Group` for positioning and billboarding

When the effect is supposed to behave like an existing popup animation, reuse that presentation's **actual placement/motion/fade rules** instead of inventing a second near-duplicate animation. Rapport/Favor popups currently use a chathead-style heart + signed-value group, but their parent follows the same Float+ offset, sway, rise, lifetime, and late-fade behavior as ordinary Float+ popups. Keep those settings synchronized with `docs/config/ui/world-popup-settings.json`.

## Debugging rule

When a PNG-backed child fails but a canvas-text child works in the same group, inspect in this order:

1. image load URL and dimensions
2. `crossOrigin` set before `src`
3. whether `getImageData()` can read the composed canvas
4. nonzero alpha pixel count / max alpha
5. use of `HobunjiSpritePngSurface.makeCanvasTexture`
6. use of `HobunjiSpritePngSurface.makeMaterial`
7. only then investigate scene ordering, camera, or animation

This ordering avoids re-debugging transforms/materials when the real problem is a tainted or blank source canvas.
