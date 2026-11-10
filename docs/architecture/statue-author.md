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

Portrait alpha is checked before export: blank or opaque rectangular masks
fail with a mobile-visible error instead of producing black panels. **Statue
materials use two independent passes:**

1. **Animal-style color fill per black-outlined cell.** `ProceduralFurniture.paintStatueSurfaceCells`
   identifies four-connected non-black regions. Each region gets the sculptor's
   selected base color through the existing `ColorFill.createShadeReference`
   and `ColorFill.shadeFillPixels`. The brightest eligible source pixel of
   *that cell* becomes the tint reference; all darker source pixels keep their
   proportional darkness. ColorFill v8 introduces an opt-in
   `includeNearWhite: true` for sculpted art, leaving the behavior of living
   animal recolors unchanged. Black outlines and transparent pixels survive.
2. **One grayscale material overlay over the complete statue image.** The
   selected PNG becomes grayscale; its brightest pixel is normalized to white
   and therefore fully transparent. Gray pixels become partially transparent,
   dark pixels more opaque. This overlay is composited over the shaded cell
   fills *without restarting the texture for each region*. Head and body
   pieces share the original 256px portrait atlas and its origin, so their
   material grain lines up when imported as separate furniture parts. Weapons
   inherit an approximate projected atlas offset from their attachment pose;
   separate 3D hands/feet use the same processed overlay material on their mesh UVs.

Unlike the earlier experiment, the texture's dark border is **not fitted to
each region**. The black ink creates the cell boundaries; the material simply
passes over them. The selected base color is independent of stone, wood or any
other texture, and the entire hierarchy remains editable. The chosen finish is
used on GLB limbs as a cached, opaque base-color-plus-grayscale map.

**Brightness consistency fix:** Some material PNGs, especially
`carved_smooth.png`, have a nearly black *outer perimeter* intended for
individual tiles. When the whole source PNG was stretched across a statue, its
perimeter darkened the hood and head more than the body, and GLBs could sample
the dark corner repeatedly. The source is now center-cropped **once** by 16%
on every side into a cached 256×256 atlas used by the head, body and all limbs;
the entire atlas remains continuous across the statue, never restarted at
each outlined cell. Non-ink/alpha pixels still retain the canonical color-fill
shading. Where a hand/foot GLB lacks usable UV coordinates, the Statue Author
generates UVs from its two broadest geometric axes without modifying the
original asset or other furniture. All statue parts use
`MeshBasicMaterial` because their authored source shading is already
in the pixel colors; preview lights/normals must not darken the limbs
relative to the portrait. The mobile diagnostics expose actual material
brightness and generated/authored UV status.

The mobile preview stays visible while scrolling and exposes original
front/back/head canvases plus copyable shading-region and material diagnostics.

The additional `scripts/smoke-statue-author-browser.js` regression runs the
actual authored NPC and Three.js r128 stack in headless Chromium at a 390px
mobile viewport, asserting non-rectangular, non-black portrait and GLB finishes,
actual Pahu on-screen color, multiple independently shaded outlined cells,
original black ink and a shared brightness-transparent overlay. The mapper is
also exercised by `scripts/test-statue-surface-cells.js`, including
independent brightness references, white-inclusive fills, grayscale alpha,
unmodified outlines and transparency, all-black weapon silhouettes, and
malformed source rejection. The test also checks that missing/flat GLB UVs
receive valid projected coordinates, existing authored UVs survive, and the
PNG is center-cropped once and reused as a shared atlas.

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


## Repository-backed authoring and Random Hero

The Statue Author's normal controls use repository dropdowns, not manual uploads:

- **Character**: the existing \`config/npcs/hobunji-starter-npc-database.json\` NPC list, plus a separate species dropdown from \`config/species/index.json\`
- **Frozen pose**: an indexed snapshot of the canonical \`HeldActionAnimations\` presets (no fabricated Attack Animation Editor exports)
- **Texture**: actual PNG filenames in \`assets/textures/\`
- **Weapons**: actual PNGs in \`assets/toolsprites/\`; Add/Clear controls support multi-layer weapons, while the original textarea remains an Advanced fallback

\`config/statue-author-asset-index.json\` contains the material, weapon-sprite, and shared-animation index. It is generated/checked by
\`node scripts/generate-statue-author-index.js --write\` / \`node scripts/generate-statue-author-index.js\`.
A new PNG or authored held-action pose becomes selectable after updating this checked-in manifest. Species and NPCs stay sourced directly from their own authoritative indexes. A separate custom NPC/animation import is still available under Advanced for files not yet authored in the repository.

**Generate Random Hero** keeps the selected species instead of rolling the gang's species weights. It uses \`HobunjiBanditEquipmentPools.rollCaptainHero\`—the same \`clothingCandidates\` function now called by \`BanditCombat\` and the same \`allowedMeleeShapes\` restriction now called by \`WeaponTrustBanditLoadouts\`. The actual bandit config supplies clothing, ranked metal tier, and the ranged-weapon pool; the actual species definition supplies cosmetic whitelists/weights, and cultural melee weapons require the species of the trust-gift NPC. No second whitelist or random weapon catalog exists inside Statue Author.

Captain gear comes from \`BanditRankWardrobe.style\` and \`MetalArmorSystem.makeCraftedItem\` so the hero gets real rounded pauldrons and a metal circlet when supported, not fabricated armor textures. \`MetalArmorSystem.decorateAvatarDataWithMetalArmor\` adds real metal portrait data before rendering. The hero holds a real indexed melee weapon in the right hand and a captain-pool ranged weapon in the left, both as editable furniture child pieces. \`__hobunjiStatueDebug()\` includes the exact rolled species, cosmetic IDs, armor IDs/alloy and weapon shape/ranged selection for mobile inspection.

A successful dropdown/pool unit test is not a substitute for live visual review. \`scripts/smoke-statue-author-browser.js\` exercises the actual mobile controls, assembles a Mao-ao hero with both weapons, verifies captain armor and image readiness, and saves screenshots. Full procedural attack-animation IK baking remains outside this feature.
