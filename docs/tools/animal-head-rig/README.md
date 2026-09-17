# Animal Head Rig Painter

This tool authors the weighted animal head rig used by the runtime PNG-plane creature renderer, plus the optional shoulder-pet body spline used by selected species.

## Head workflow

1. Load the repo bestiary, a compatible animal JSON record, or a custom sprite.
2. Paint **Influence** between Body and Head. Brush strength controls how strongly each pass moves the current weight toward the selected target.
3. Set/refine the head pivot and preview the authored pitch range in the always-visible lower canvas.
4. Use **Compressibility** or **Stretchability** only to reduce one deformation direction below Influence. Their restore tool moves that channel back **Toward Influence**.
5. Copy/download the animal record or save the rig into browser-local game preview storage.

Head Influence is the source of truth for the neck rig. Missing head compression/stretch overrides inherit it exactly. Head Stretchability also limits yaw turns in either direction.

## Compression vs stretch

For the current animal pitch convention, a downward head bend stretches the sprite side below the pivot and compresses the side above it; an upward bend reverses those sides. The editor and runtime share that classification.

## Shoulder spline: BEFORE → AFTER

The shoulder body rig has two explicit seven-point curves.

- **1 · BEFORE / Bind**: fit seven points to the animal exactly as it exists in the undeformed source PNG.
- **2 · AFTER / Pose**: move the corresponding seven points into the desired shoulder pose.
- Only the active curve's seven handles are draggable; both curves remain visible for comparison.
- **Reset AFTER to BEFORE** gives an identity pose without changing the bind line.
- Runtime vertices are measured against the curved BEFORE spline's local tangent/normal in actual image-plane proportions and reconstructed against AFTER.
- The complete rectangular strip participates, including transparent PNG space and pixels beyond the first/last spline tangent planes.
- **Broad AFTER pose** restores the old Whole rotation / Progressive bend / Root falloff controls as editor-only additive macros. They never replace the seven precise points; **Bake into AFTER** commits the visible macro result into those points.
- **Edit 2-point endpoints** is a simplified view of the same AFTER curve. It exposes only point 1 (beginning) and point 2 (ending); moving either edits only the corresponding first/last AFTER vertex and leaves the five middle vertices untouched.
- Two snap buttons place point 1 at the frame-shift center and point 2 at the center of the right-frame PNG's right edge.

The spline is currently enabled only for **Grehlr, Voorg-Ass, Uumkao’ii, Gar-wolf, and Dabinggi-hound**. Those species temporarily start from Grehlr's current shoulder pose until individually authored.

### Right-side shoulder paint

The shoulder spline has its **own** Influence / Compressibility / Stretchability maps. These are separate from the head maps.

- **Left source** edits the ordinary head-rig maps.
- **Right source** edits the shoulder-rig maps against whichever art the split right side actually uses.
- **Composite split** also edits the shoulder-rig maps while showing the final right-background + left-foreground artwork.

Shoulder Influence defaults to **100% on the separator-owned right side** and 0% on its left, so an untouched right half follows the BEFORE → AFTER pose completely. The separator may be rotated in Z; ownership stays a hard boundary even when old paint exists on pixels that later move to the left side. In Right/Composite mode the usual Head/Body influence targets become **Spline / Rigid**. Paint toward Rigid when a pelvis, back leg, or other area should follow the shoulder pose less strongly.

Shoulder Compressibility and Stretchability inherit Shoulder Influence and can only reduce it. The runtime determines local strain by comparing the BEFORE and AFTER curved strip at the actual pixel's offset from the spline:

- local shortening uses **Shoulder Compressibility**;
- local lengthening uses **Shoulder Stretchability**;
- neutral motion uses Shoulder Influence directly.

This means the back legs can have reduced Stretchability while the tail remains fully stretchable, without changing their head-rig Body/Head classification. Head Influence still competes with the final shoulder deformation at the neck transition, so a 100% Head pixel remains controlled by the head rig.

Bucket color sampling follows the selected paint source, so right-half/run1 pixels can be painted directly. Selecting **BEFORE / Bind** while split mode is active switches the paint view to Right source automatically because that is the art being bound for the deforming half.

### Older exports

Older shoulder exports are still accepted. Current-v6 `restGuide + splinePoints` imports become a straight seven-point BEFORE line plus the saved seven-point AFTER line. Still older A/B + `bend`, `fullRotationDeg`, `interVertexRotationDeg`, `weightFalloff`, or `curveFalloff` data is sampled into the same BEFORE/AFTER representation. Old files without shoulder paint maps simply receive the new implicit 100%-right-side Shoulder Influence default. New saves serialize `beforePoints` + `afterPoints` and only the shoulder paint maps that contain authored overrides.

## Split frame / overlap layers

The frame separator is independent of the spline. It can split idle/run1 art or use idle art on both sides, and it may be rotated in Z around the Frame shift X center. The separator can therefore serve purely as the foreground/background pixel-ownership rule.

The right/deformed half renders first and the left/foreground half renders over it when the shoulder pose curls pixels back across the seam. Both halves remain one shoulder pet for x-ray/depth purposes: the foreground overlay follows the paired base half's render order, Three.js layer mask, visibility, depth test/write/function, blending, opacity, alpha-test, polygon-offset, and related material state. Its only ordering difference is a tiny `+0.01` within-pet offset so left-half pixels beat right-half pixels without jumping above the player's normal x-ray/layer stack.

**Move both spline lines with Frame shift X** is checked by default. Moving the separator translates all fourteen BEFORE/AFTER control points by the same X delta, preserving authored seam-relative placement. Rotating the separator does not rotate either spline.

## Game preview

**Save rig for game preview** writes the complete current rig to the shared `hobunji_animal_head_rigs_v1` browser storage and immediately reads it back. The button reports success only when the saved rig round-trips exactly, including both seven-point stages and any authored shoulder material maps.

The shoulder spline/presentation activates in-game only while the animal is actually serving as the player's shoulder pet. Leaving the shoulder role restores ordinary presentation. Preview neck angle is deliberately the one authoring motion value that is not serialized.

## Preview layout

The upper canvas is undeformed and paintable. The lower canvas is read-only and shows the combined live head + shoulder deformation. On desktop the right workbench remains sticky while the left controls scroll; the canvases preserve sprite aspect ratio, and the preview/settings region below them is the portion that compresses and scrolls on short displays.
