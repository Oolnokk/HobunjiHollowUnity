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
a black placeholder. The selected furniture PNG is sampled into small repeated
regions from its interior (important for `carved_smooth.png`, whose edges are
very dark), while the original NPC silhouette, transparency and dark ink
outlines remain intact. The same filename is mapped onto independent GLB
limb pieces; the shared GLB map is cached rather than repeatedly uploaded per
character. The mobile preview remains visible while scrolling the authoring
controls and exposes original front/back/head canvases plus copyable material
and GLB readiness diagnostics.

The additional `scripts/smoke-statue-author-browser.js` regression runs the
actual authored NPC and Three.js r128 stack in headless Chromium at a 390px
mobile viewport, asserting non-rectangular, non-black portrait and GLB finishes.

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
