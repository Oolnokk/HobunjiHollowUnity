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

## Shoulder-pet seven-point spline

The shoulder body pose now follows the same basic authoring model as the head rig: edit the deformation directly instead of tuning indirect curl parameters.

- **Enable 7-point body spline** turns on the optional shoulder-only deformation.
- Seven visible spline vertices are dragged directly on the upper paint canvas.
- Points 1 and 7 are the beginning/end of the source strip; moving them also moves source-guide A/B.
- The faint dashed A→B line is the undeformed source axis. The purple curve is the authored shoulder pose.
- Every vertex in the complete rectangular PNG strip participates, including transparent pixels.
- There is no separate body weight paint. Effective body deformation remains exactly `1 - Head Influence`.
- The old Full Rotation, Inter-vertex Rotation, curve falloff, and weight falloff controls are intentionally gone.

The spline is currently enabled only for **Grehlr, Voorg-Ass, Uumkao’ii, Gar-wolf, and Dabinggi-hound**. Those species temporarily start from Grehlr's current shoulder pose until they receive individual authored profiles. Grehlr's committed profile uses the split seam at 52%, idle art on both sides, and follows seam X by default.

### Older exports

Older shoulder exports are still accepted. A/B + `bend`, `fullRotationDeg`, `interVertexRotationDeg`, `weightFalloff`, or `curveFalloff` data is sampled once into seven spline points when imported/resolved. New saves and exports use only `restGuide` + `splinePoints`; the retired curl/falloff fields are not written back out.

## Split frame / overlap layers

The frame seam is independent of the spline. It can split idle/run1 art or use idle art on both sides. This is useful when the seam is only defining which pixels belong to the deforming background half versus the gripping foreground half.

The right/deformed half renders first and the left/foreground half renders over it when the spline curls pixels back across the seam. Both halves remain one shoulder pet for x-ray/depth purposes: the foreground overlay follows the paired base half's render order, Three.js layer mask, visibility, depth test/write/function, blending, opacity, alpha-test, polygon-offset, and related material state. Its only ordering difference is a tiny `+0.01` within-pet offset so left-half pixels beat right-half pixels without jumping above the player's normal x-ray/layer stack.

**Move spline with Frame shift X** is checked by default. Moving the seam translates all seven spline vertices and source-guide endpoints by the same X delta, preserving the authored seam-relative placement.

## Game preview

**Save rig for game preview** writes the complete current rig to the shared `hobunji_animal_head_rigs_v1` browser storage and immediately reads it back. The button reports success only when the saved rig round-trips exactly. Existing preview-aware rig resolution makes that saved rig win over committed species defaults when the animal avatar is rebuilt.

The shoulder spline/presentation activates in-game only while the animal is actually serving as the player's shoulder pet. Leaving the shoulder role restores ordinary presentation. Preview neck angle is deliberately the one authoring motion value that is not serialized.

## Preview layout

The upper canvas is undeformed and paintable. The lower canvas is read-only and shows the combined live head + shoulder deformation. On desktop the right workbench remains sticky while the left controls scroll; the canvases preserve the sprite aspect ratio, and the preview/settings region below them is the portion that compresses and scrolls on short displays.
