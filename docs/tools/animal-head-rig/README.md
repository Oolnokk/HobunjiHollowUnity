# Animal Head Rig Painter

This tool authors the weighted animal head rig used by the runtime PNG-plane creature renderer, plus the optional shoulder-pet body spline used by selected species.

## Head workflow

1. Load the repo bestiary, a compatible animal JSON record, or a custom sprite.
2. Paint **Influence** between Body and Head. Brush strength controls how strongly each pass moves the current weight toward the selected target.
3. Set/refine the head pivot and preview the authored pitch range in the always-visible lower canvas.
4. Use **Compressibility** or **Stretchability** only to reduce one deformation direction below Influence. Their restore tool moves that channel back **Toward Influence**.
5. Copy/download the animal record or save the rig into browser-local game preview storage.

Influence is the source of truth. Missing compression/stretch overrides inherit it exactly, so older head rigs remain visually unchanged. Stretchability also limits yaw turns in either direction.

## Compression vs stretch

For the current animal pitch convention, a downward head bend stretches the sprite side below the pivot and compresses the side above it; an upward bend reverses those sides. The editor and runtime share that same classification.

## Shoulder spline: BEFORE → AFTER

The shoulder body rig has two explicit seven-point curves.

- **1 · BEFORE / Bind**: fit seven points to the animal exactly as it exists in the undeformed source PNG.
- **2 · AFTER / Pose**: move the corresponding seven points into the desired shoulder pose.
- Only the active curve's seven handles are draggable; both curves remain visible for comparison.
- **Copy BEFORE → AFTER** gives an identity pose before shaping the shoulder pose.
- Runtime vertices are measured against the curved BEFORE spline's local tangent/normal and reconstructed at the same spline parameter against AFTER.
- The complete rectangular strip participates, including transparent PNG space.
- Effective body deformation remains exactly `1 - Head Influence`.
- The retired Full Rotation, Inter-vertex Rotation, curve-falloff, and weight-falloff controls are gone.

The spline is currently enabled only for **Grehlr, Voorg-Ass, Uumkao’ii, Gar-wolf, and Dabinggi-hound**. Those species temporarily start from Grehlr's current shoulder pose until individually authored.

### Paint source for fused halves

The head/material paint maps remain one canonical shared grid, but the upper authoring canvas can display different source art underneath that grid:

- **Left source**: ordinary idle/left art.
- **Right source**: whichever image the split right half actually uses (idle or run1).
- **Composite split**: right/background pixels first, then left/foreground pixels over them.

Bucket color sampling follows the selected paint source too, so right-half/run1 pixels can be painted directly without creating a second set of weight maps. Selecting **BEFORE / Bind** while split mode is active switches the paint view to Right source automatically because that is the art being bound for the deforming half.

### Older exports

Older shoulder exports are still accepted. Current-v6 `restGuide + splinePoints` imports become a straight seven-point BEFORE line plus the saved seven-point AFTER line. Still older A/B + `bend`, `fullRotationDeg`, `interVertexRotationDeg`, `weightFalloff`, or `curveFalloff` data is sampled into the same BEFORE/AFTER representation. New saves serialize only `beforePoints` + `afterPoints`; retired curl/falloff fields are not written back out.

## Split frame / overlap layers

The frame seam is independent of the spline. It can split idle/run1 art or use idle art on both sides. The seam can therefore serve purely as the foreground/background pixel-ownership rule.

The right/deformed half renders first and the left/foreground half renders over it when the shoulder pose curls pixels back across the seam. Both halves remain one shoulder pet for x-ray/depth purposes: the foreground overlay follows the paired base half's render order, Three.js layer mask, visibility, depth test/write/function, blending, opacity, alpha-test, polygon-offset, and related material state. Its only ordering difference is a tiny `+0.01` within-pet offset so left-half pixels beat right-half pixels without jumping above the player's normal x-ray/layer stack.

**Move both spline lines with Frame shift X** is checked by default. Moving the seam translates all fourteen BEFORE/AFTER control points by the same X delta, preserving authored seam-relative placement.

## Game preview

**Save rig for game preview** writes the complete current rig to the shared `hobunji_animal_head_rigs_v1` browser storage and immediately reads it back. The button reports success only when the saved rig round-trips exactly, and verifies that both seven-point spline stages survived serialization.

The shoulder spline/presentation activates in-game only while the animal is actually serving as the player's shoulder pet. Leaving the shoulder role restores ordinary presentation. Preview neck angle is deliberately the one authoring motion value that is not serialized.

## Preview layout

The upper canvas is undeformed and paintable. The lower canvas is read-only and shows the combined live head + shoulder deformation. On desktop the right workbench remains sticky while the left controls scroll; the canvases preserve sprite aspect ratio, and the preview/settings region below them is the portion that compresses and scrolls on short displays.
