# Reusable Statue Author

Tool: `docs/tools/statue-author/index.html`

The Statue Author is scene-agnostic. It renders a selected NPC with the existing
`NpcAvatarPreview` portrait compositor, imports a `hobunji_attack_animation`
or `hobunji_held_action_animation` export, and freezes one authored
Neutral/Windup/Strike pose into an ordinary furniture project. The project
can be sent to the Tools Hub's Furniture Author or downloaded and imported with
its existing JSON input.

The resulting `parts[]` are normal individually editable furniture pieces:

- `statueSprite` for separately masked body/head portrait layers and each weapon PNG layer
- `glb` for native species hand and foot assets
- optional `parentPartId` links for head→body, hand→body, weapon→hand, and limb→body

Parent-relative transforms are used by the editor **and** `AuthoredFurniture.buildGroup`.
A parent selector and detach control preserve the selected child's world position
when changing the parent. A cycle guard prevents invalid furniture graphs.
Ordinary existing furniture with no parent links remains flat.

The author-selected `materialTexture` filename is identical on
every exported piece. The texture is not necessarily stone. For portrait silhouettes,
`ProceduralFurniture.buildPartMesh` composes that repository texture
with the stored front/back alpha masks. For hand/foot GLBs, the normal authored
furniture material mapper applies the same texture. Source NPC coloring is not
baked into the output, so changing the statue finish can recolor the entire statue
without editing its NPC source. Imported furniture can still override individual pieces.

Portrait alpha is checked before export: a missing sprite, blank portrait or an
opaque full-canvas rectangle fails with a visible message rather than exporting
a black placeholder. **The portrait is not painted with one uniform brown
plane or a fixed 12-by-12 grid:** `ProceduralFurniture.paintStatueSurfaceCells`
uses four-neighbour region detection on the original non-black opaque pixels.
Black ink strokes and transparent pixels are never overwritten. Each contiguous
cell receives one complete copy of the selected furniture PNG (including its
dark border), fitted by independent row and column spans so that the shaded
perimeter follows the irregular enclosed outline. This is the *raster equivalent*
of `SurfaceStretchUV`'s per-irregular-surface full-square mapping used by
the farm cliffs; it does **not** remesh the portrait into 3D cliff geometry.
A fully black sprite without detectable interior cells falls back to one
textured silhouette, not a black blob. Each sprite reports region counts,
untouched ink pixels, and material shade variation in mobile diagnostics.

For hand/foot GLBs the same selected material PNG is mapped as one cached
texture. The **UV treatment**, rather than the farm cliffs' unlit shader, is
the shared behavior: statue portrait and hand/foot materials retain
`MeshLambertMaterial`, because the actual browser screenshot demonstrated
that applying unlit material directly made the source PNG too dark for the
statue preview. The mobile preview stays visible while scrolling and exposes
original front/back/head canvases plus copyable material, detected cell,
outline and GLB readiness diagnostics.

The additional `scripts/smoke-statue-author-browser.js` regression runs the
actual authored NPC and Three.js r128 stack in headless Chromium at a 390px
mobile viewport, asserting non-rectangular, non-black portrait and GLB finishes,
actual Pahu on-screen color, multiple enclosed cells, original black ink and
distinct dark-edge/light-interior material shades. The pure typed-array mapper
is also exercised by `scripts/test-statue-surface-cells.js`, including
irregular disconnected regions, all-black weapon silhouettes, alpha invariance
and malformed source rejection.

To install a reusable authored statue in game content, save the exported JSON
as `docs/config/furniture-authored/<key>.json` and register its key
in `docs/config/furniture-authored/index.json`. Place that key
through the existing Map Editor, ruin furnishing, or wilderness locale authoring
paths. The statue does not create a living NPC or run an attack update loop.

## Current implementation scope

The NPC appearance is authentic, and the limb models reuse the game's asset
paths. A frozen attack pose currently maps body yaw/sink, weapon XYZ/angles and
the free-hand channel to editable piece transforms. Arm and leg positions are an
initial static furniture approximation, **not an exact bake of the complete runtime
IK/leg solver**. Similarly, separately imported modular weapon PNG layers have
independent editability but do not automatically reproduce pair-specific
weapon-assembly offsets. The Furniture Editor is the intended finishing step.

The standalone preview and editor include mobile-visible load diagnostics.
This integration requires a live browser visual pass on several species, as
well as a separately authored modular weapon, before treating poses as exact
one-click replicas of the Attack Animation Editor's scene.
