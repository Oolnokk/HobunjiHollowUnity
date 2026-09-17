# Animal Head Rig Painter

This tool authors the weighted animal head rig used by the runtime PNG-plane creature renderer.

## Core workflow

1. Load the repo bestiary, a compatible animal JSON record, or a custom sprite.
2. Paint **Influence** between Body and Head. Brush strength controls how strongly each pass moves the current weight toward the selected target.
3. Set/refine the head pivot and preview the authored pitch range in the always-visible lower canvas.
4. Use **Compressibility** or **Stretchability** only to reduce one deformation direction below Influence. Their restore tool moves that channel back **Toward Influence**.
5. Copy/download the animal record or save the rig into browser-local game preview storage.

Influence is the source of truth. Missing compression/stretch overrides inherit it exactly, so older rigs remain visually unchanged.

## Compression vs stretch

For the current animal pitch convention, a downward head bend stretches the sprite side below the pivot and compresses the side above it; an upward bend reverses those sides. The editor and runtime share that same classification.

## Shoulder-pet rest body spline

**Shoulder-pet rest body bend** is an optional second deformation method intended only for perched shoulder pets. It deliberately stays much simpler than the reference spline PNG rigger:

- one checkbox enables it;
- one quadratic longitudinal body path is shown on the paint canvas;
- drag the midpoint diamond (or use the midpoint slider) to shape the resting bend;
- enabling it previews the animal's `run1` frame when one exists;
- no extra body paint map is authored.

The existing Head Influence map controls the rest weighting automatically. Rest/body influence is exactly `1 - headInfluence`: full Body receives the whole rest bend, a 50/50 Head/Body seam receives half, and full Head receives none. This makes Head Influence fight the shoulder-rest deformation by exactly the same amount it already fights the body bone.

At runtime the body-rest geometry is activated only while that animal is actually serving as the player's shoulder pet. Leaving the shoulder-pet role restores the original undeformed geometry. Authored rest rigs use `run1` while perched when available; shoulder pets without this optional rig retain the existing idle-frame presentation.

## Preview layout

The upper canvas is always undeformed and paintable. The lower canvas is always read-only and deformed. Paint/fill/undo/expand/layer changes update the lower preview live without resetting its current head angle. The shoulder-rest spline follows the same rule.
