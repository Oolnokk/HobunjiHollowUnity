# Animal Head Rig Painter

Use `index.html` to paint body/head deformation weights directly onto an animal sprite while preserving the rest of the animal record.

## Workflow

1. Load the repo bestiary, another animal JSON file, or start a custom record.
2. Load the idle sprite.
3. Select **Head** or **Body** and paint influence with the large-radius brush, or use the color-tolerance fill bucket.
4. Use **Eraser** to return cells to the unassigned state. Unassigned cells default to Body/head weight 0 at runtime.
5. Use **Expand Influence** while Head or Body is selected to grow that side into the other and write a soft deformation-weight falloff across the boundary.
6. Set/refine the neck pivot, min/rest/max rotation, turn speed, and mesh detail.
7. Enable **Preview deformation** and move the angle slider to inspect the weighted bend.
8. Save for game preview or copy/download the edited record.

`headRig.weightMap` is a normalized sprite-space paint grid stored as `rle-u9`: values `0..255` are Body→Head influence and `256` is the author-only unassigned sentinel. The runtime treats unassigned cells as Body (`0`) and bilinearly samples the grid onto the skinned animal plane.

The brush and Expand radius sliders scale up to the larger source-image dimension, so very broad influence edits are possible. The fill bucket flood-fills connected opaque cells using source-color tolerance.

Legacy square rigs (`headRig.region`) still load as a compatibility fallback and are converted into painted Head cells when opened in the author.

## Species-wide inheritance

Committed rigs are authored once in normalized sprite/UV space for the base species. The same weights therefore remain attached when the material texture changes: idle, both run frames, and every base-color/pattern genotype composite all deform through the same skinned geometry rather than carrying separate copies of the rig.

Size-only variants inherit the base species rig through the same species-alias system used by creature genetics. This includes the Gar-wolf Alpha and current Den-Mother/Nestmother variants; scaling the animal changes the plane size but not its normalized weight coordinates or pivot proportions.

Browser game previews use the same-origin localStorage key `hobunji_animal_head_rigs_v1`. A saved browser preview overrides the committed species rig for that species until it is cleared, then reload or respawn the animal to rebuild its skinned plane.