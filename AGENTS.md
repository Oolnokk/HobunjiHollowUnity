# Hobunji Hollow — Coding Agent Notes

This file records project-specific implementation rules that are easy to miss when working from an isolated bug report. Treat these as repository invariants unless a task explicitly calls for changing them.

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
