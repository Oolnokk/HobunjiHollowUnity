# Complex tool visual authoring

The **Tool Hub → Combat → Complex Tool Visuals** editor lives in
[tools/multi-sprite-weapon-editor/](../tools/multi-sprite-weapon-editor/index.html).
It has three tabs: **Flails** (haft, connector, inertia and anchors),
**Multi-layer Parts** (ordered sprite stacks and interleaved effects), and
**Base sprite + VFX** (material/marker recolor and emission directly on an
existing tool PNG, without requiring overlays or a flail). These tools share
the same 3D gameplay assembly and mobile-friendly debug log.

Edits stay in a device-local draft until exported and committed. Use **Export JS
config** to replace [config/weapon-sprite-assemblies.js](../config/weapon-sprite-assemblies.js)
or **Export JSON** for a portable draft. The runtime never loads the author's
localStorage draft. An authored key must resolve to an existing
`TOOL_ITEM_DEFS` item or `shapeKey`; the editor does not invent gameplay
weapon definitions or acquisitions.

## Hachutu Torch-Staff: two flame regions and no verdigris

`hachutuTorchStaff` uses the new
`assets/toolsprites/hachutu_torch-staff.png` as its sole sprite, with the
same sweep/melee style and long-haft two-hand grip windows as B'shuakauitl.
It is a distinct melee-only weapon (not a blowgun, and not a metal-shape
variant). The game registers both its tool and inventory metadata, without
giving it to the player automatically.

The base PNG is authored with `base.material: 'marker'`,
`sourceHex: '#7F00FF'`, and `targetHex: '#E7DDC9'`, exactly like
the Torch-Flail brazier fuel. Recoloring and flame ignition sample the
**original** PNG, never the already tinted canvas. It has no `metalKey`:
there is no verdigris progress, plating recolor or visible-metal enchantment
mask on this rigid sprite. Ordinary tool/weapon mastery XP still increases.

The shared emitter's optional `vfx.masteryClusters: 2` splits the source
marker pixels along their longest axis (the two staff ends) into stable
groups. At mastery 0 each region emits small, separately scattered motes.
Mastery ranks 1–4 concentrate the origin points towards two centroids
while increasing the individual mote size. At mastery 5 both regions form
one cohesive plume apiece, **without collapsing every ignition position
onto an identical pixel** (`masteryFocus: 0.55`). 

The Torch-Flail is scaled via its **entire head-group transform** (`head.scale: 2.5`),
not by altering the fire particle size itself. The Torch-Staff now follows
that same mechanism: its local `size: 0.02` stays identical to the
Torch-Flail's, while `visualScale: 4` scales an independent fire child
group **around each staff tip**. This makes the full plume, spacing,
vertical travel and lateral movement 4× larger (an effective
rank-5 width of 0.08), while keeping the underlying PNG, source anchors,
mote brightness and number of motes unchanged. Larger individual radial
sprites alone had increased overdraw without preserving the flame shape.
The staff therefore opts into `blendMode: 'normal'` and
`opacity: 0.65` rather than accumulating opaque additive glow.
`life: 0.35`, `speed: 0.12`, and the palette are unchanged.
`rate: 44` gives **each end** the Torch-Flail's 22 motes/s budget at
rank 5. Existing Torch-Flail emitters retain their original additive
blending and 2.5× head scale.

Both Torch-Staff and Torch-Flail now explicitly set `worldRise: true`.
Each particle captures its world-space ignition point and inherited
world scale when emitted; after that, `+Y` rise and sideways flicker
are applied in world coordinates, then transformed back into the holder's
local particle group for the original depth/render ordering. A swung,
inverted, translated or moving head therefore **does not pull older
flames sideways**. New flames continue appearing at its new tip position.
The normal emitter remains unchanged for weapons without `worldRise`.

Gameplay passes the live `ToolMastery.toolMasteryLevel(itemKey)` callback
when constructing a weapon. The Tool Hub adds a **Preview mastery 0–5**
slider which uses the same callback path in both 3D views. Its Base sprite
tab allows other tools to opt into either standard fire or two-ended
mastery fire, edit the marker colors and adjust rate/size/life/speed/palette.
It also exposes independent whole-plume geometry scale, rank-5 clustering
focus, blend mode and opacity; changes use the same runtime and preview
emitter path. Diagnostics include scale, effective mote width and both
tip pivot locations.
The existing recipe schema remains `hobunji_weapon_sprite_assemblies.v1`;
existing drafts still load, and effects on a base sprite are opt-in.

## Full modular Torch-Staff shaft and reusable duplication

The Foundry registers `hachutuTorchStaff` as an actual **shaft** in
`config/modular-weapons.js`: it copies all four B'shuakauitl directed
eye/tang mounting lines, all per-head corrections and the same seven
permitted heads, while keeping the own `hachutuTorchStaff` gameplay
identity (melee only). The **whole staff** remains the shaft, including
its independent two-tip flame emitter and off-white material.
`fireAssembly: 'hachutuTorchStaff'` tells the shared weapon assembly
to mount the live particles to the modular shaft's source sprite, not
to bake particles into a metal-textured composite or replace its heads.

For other weapons, use the **Duplicate selected shaft + mounts + fitting rules**
button in the Modular Weapon Editor, provide a stable key/label and sprite,
then adjust the duplicate's **Rig X scale, Rig Y scale, Rig X translation,
and Rig Y translation**. The existing `duplicateTransform` config field now
applies **only to the attachment primitive / tang-and-sleeve rig and the
fitted head geometry**, relative to the canonical 450×1204 frame center.
Neither the original shaft sprite nor its pose, crop, nonmetal material,
flame ignition origins, flame group scale, or other live effects inherit
this transform. Source markers are still recolored in their original
positions. The compositor now constructs one real `attachmentRig` transform
node with mounting-line **children**, each containing one fitted head
**primitive child**. All head primitives first resolve their fit in their
unscaled local mount coordinates, then inherit the single parent rig
transform. For arbitrary X/Y scales, the final matrix is `parent × child`
(instead of re-fitting the head to an already stretched mounting arrow).
The canvas renderer uses nested transforms, and composition bounds use
the same parent–child matrices, so the display, export and runtime agree.
The unchanged shaft bitmap and its independent live-fire group are
siblings, never descendants of the attachment rig.

The Foundry editor now draws the **effective transformed mounting arrows and drag gizmos**
over the unchanged shaft sprite, rather than drawing raw local coordinates on the
canvas. Pointer gestures are inverse-transformed back to local mount data; this
ensures editing a moved or stretched rig does not accidentally add the parent
transform twice. The rig's numeric X/Y scale and translation controls update the
assembled preview **on input** (while typing), before persisting on change.
The mobile hierarchy diagnostic shows the same source/parent/child relationship
used by the compositor. The assembled head primitives change, but the original
shaft bitmap and flames do not.

**Rig transforms now work on original shafts as well as duplicates.** The canonical
`attachmentRigTransform` field is validated for every shaft in the Foundry,
including B'shuakauitl itself; old saved `duplicateTransform` fields migrate
as compatible aliases. The mounting-line editor shows the transformed
socket positions and supports inverse-transformed touch input. Composite
head pixels are checked at representative source-art locations relative to
the stationary shaft—not merely by counting Canvas transform calls.

The game intentionally caches each modular weapon as a **single composited
sprite plane** (including layer ordering, bridge strokes, metallic recoloring,
and nonmetal source masks). The attachment hierarchy here is a **composition
tree**: parent Canvas transform → mount children → head primitive draws,
not a persistent separate `THREE.Group` of independently movable head meshes.
Changing authored rig settings recomposes the weapon; it does not animate
separate head meshes in an existing held weapon. `ToolMetalRecolor` now includes
the Foundry revision in its composite canvas cache key, preventing stale head
pixels after editing rig settings and recomposition.

The original donor is unaffected and old saved `duplicateTransform`
values are retained but interpreted as rig-only adjustments. The editor
draws transformed arrow overlays above the **unmoved shaft bitmap**;
touch gestures invert the parent transform before altering local mount
records. The **combined preview** shows a stationary shaft with the
transformed head, junctions, bridges, smudge strokes and recipe results.
The 2D modular preview does not bake live flames into a PNG.

**Bridge and recipe children:** the compositor first expands saved
`{ recipe, box }` operations using the existing recipe mapping, then
applies the same parent attachment transform to every resulting spatial
step. Direct bridge strokes, smudge/plow/puff/clean strokes and their
X/Y coordinates follow the parent. Painted fill strokes use separate
elliptical X/Y radii so nonuniform rig scales do not leave their masks
behind; algorithms with a single radial parameter use the geometric-mean
scale. Junction images remain in rig-local coordinates and render under
the full Canvas parent matrix, so their position, rotation and nonuniform
X/Y geometry transform with the rest of the rig. Cleanup and separate-
shading operations remain ordered after their associated brush work and
operate on the resulting changed region. Composite bounds now include
the transformed bridge masks and junction sprite envelopes, preventing
clipping when a rig moves away from the source shaft. Recipes themselves
are never rewritten when the parent moves.

The editor stores bridge strokes, junction placement and recipe boxes
in the same local coordinate frame as the head primitives, converts
pointer interactions back from screen coordinates, and projects recipe
boxes and junction ghosts through the rig parent. The mobile diagnostic
tree now shows saved versus expanded bridge/recipe operations, junction
count and brush count alongside the mount/head children.

### Optional shaft artwork and local attachment-region transforms

The overall `attachmentRigTransform` remains the parent of all fitted
mounting primitives and bridge/recipe/junction operations. A separate
`shaftArtTransform` has `enabled` defaulting to false. When enabled,
its independent X/Y scale and translation are applied only to the shaft's
source bitmap and its protected nonmetal mask. The live Torch-Staff
fuel-marker source carrier inherits that same translation and scale,
while world-up flame movement and the attachment rig remain independent.
The composite frame includes the optional source-art envelope.

Each shaft may also own up to 12 `rigRegions`, each with a stable ID,
label, untransformed source-coordinate selection rectangle and independent
X/Y scale/offset. Region transforms pivot at the center of their selection
rectangle and are applied *between* the overall rig parent and their
selected child geometry. A mount and its fitted head are selected together
by the midpoint of the authored tang/sleeve; direct spatial operations
are selected by their authored center; a placed recipe is selected as one
group by its saved box center, so every expanded step retains the same
area. Overlapping regions use last-in-order priority. Unselected heads and
operations receive the identity local transform. Source mounts, bridge
steps, recipes and art are not destructively rewritten.

The mobile editor offers a rectangle picker on the assembled preview,
per-region transform fields and a remove button; it shows selected head
and expanded operation counts without developer tools. Local editing
maps transformed pointer positions back to authored coordinates.
The selections are whole child operations, **not arbitrary cutouts of
head pixels or fractional brush strokes**; the selection has no effect
on the unselected shaft bitmap. Older configurations with no regions
or no enabled art transform keep their original output.

The modular compositor recolors the original `#7F00FF` fuel markers
off-white and records which source-shaft pixels are visible. The metal
recolor pipeline restores **those pixels** after tinting/oxidizing the
forged head, including head-over-haft layer ordering. Thus the Torch-Staff
itself cannot gain verdigris even when its attached head does.

## Runtime architecture

- [weapon-sprite-assemblies.js](../js/weapon-sprite-assemblies.js) uses the
  existing game-held weapon plane as the rigid haft/pose authority. Player and
  hostile attacks, grip, damage, and hit detection remain unchanged.
- [weapon-layer-effects.js](../js/weapon-layer-effects.js) owns cached
  source-alpha scans, material recoloring, the original marker recolor, and
  ordered particle groups. Its updates run inside the existing assembly
  pre-render subscriber, not a new gameplay animation loop.
- [weapon-enchantment-vfx.js](../js/combat/weapon-enchantment-vfx.js) consumes
  assembled **visible metal masks**. Every metal pixel hidden behind a later
  opaque layer is excluded from the emitter. Flails source enchantments only
  from their assembled **head** — never from the chain or haft.
- [held-object-render-order.js](../js/held-object-render-order.js) preserves
  the intentional render order of tagged assembly child meshes while retaining
  ordinary held-weapon scissoring/occlusion.

## Reusable authoring schema

The committed `window.WEAPON_SPRITE_ASSEMBLY_CONFIG` has a
`weapons: { [itemOrShapeKey]: recipe }` map. Each recipe can contain
`layers: []` for ordinary weapon overlays, a `flail` declaration, or both.
Base sprite and all authored layers follow the same pixels-to-world scale.
Offsets are in PNG-pixel units, with positive X right and positive Y down.

```js
{
  label: 'Example Flail',
  flail: {
    haftAnchor: { opaque: 'top' }, // or { x: 100, y: 26 }
    chain: {
      sprite: 'assets/toolsprites/example-chain.png',
      top: { opaque: 'top' }, bottom: { opaque: 'bottom' },
      material: 'metal',
    },
    motion: { lag: 0.065, idleFollow: 7, attackFollow: 15 },
    head: {
      anchorLayer: 'handle', anchor: { opaque: 'bottom' },
      layers: [
        { id: 'back', sprite: 'assets/toolsprites/example-back.png', material: 'metal' },
        { id: 'handle', sprite: 'assets/toolsprites/example-handle.png', material: 'metal' },
        {
          id: 'fuel', sprite: 'assets/toolsprites/example-fuel.png',
          material: 'marker', sourceHex: '#7F00FF', targetHex: '#E7DDC9',
          vfx: {
            type: 'fire', sourceHex: '#7F00FF', rate: 22, life: 0.65,
            size: 0.035, speed: 0.12,
            colors: ['#FFE6A5', '#FFAA3E', '#FF5F20'],
          },
        },
        { id: 'front', sprite: 'assets/toolsprites/example-front.png', material: 'metal' },
      ],
    },
  },
}
```

**Hachutu Torch-Flail:** Its committed order is precisely
**brazier-back → brazier-handle → brazier-fuel → brazier-front**.
The chain and all three metal brazier layers use the same
`#5A8480` source-metal recognition, including the existing
`ToolMetalRecolor.getRecoloredCanvas` plating/mastery/verdigris policy.
The fuel's `#7F00FF` Hachutu Binding Mask eye-marker color family is tinted
to off-white rag `#E7DDC9`; its *original* PNG pixels are still used as
emission sources.

Fire is spawned in the fuel layer's local image space and drawn
**between fuel and front**. Later layers with opaque pixels visually cover it
rather than having the emitter painted over them. This is reusable for an
ordinary multi-layer weapon, too. The fire stays active independently of the
weapon's planar enchantment emissions. Enchantment particles radiate from
post-assembly visible metal masks and are free to drift beyond the origin.

The Hachutu recipe uses automatic first/last opaque pixel anchors (alpha
at least 128) until calibrated in the editor. An authored `{x,y}` always
takes precedence. Head layers may individually author `offsetPx`.
The chain hangs world-down at rest, trails movement, follows the haft's
authored swing as a fixed-length lever, and rotates the head only during
attacks. This is presentation-only: no additional hit detection or gameplay
physics have been added.

Latest change: Hold and Recovery now integrate a taut spherical pendulum rather
than a capped, authored overshoot. The driven strike measures actual world-space
connector angular velocity (including combined pitch/yaw/roll); the moving haft
supplies pivot acceleration. On release, gravity and pivot acceleration produce
angular acceleration `direction × (gravity - pivotAcceleration) / length`.
Mass cancels for the point-mass head approximation. The lever length is the
rendered, scaled connector length. Kick/rotate/kick substeps at 240 Hz preserve
rotation without prescribing a maximum angle. `flail.motion.angularDamping`
sets drag in 1/s (0–30, default 8); zero retains free rotation and larger values
settle sooner. The assembler exposes this control and exports it with the recipe.

Early strike alignment and gravity-only windup retain their existing authored
behavior. This is a taut, massless-connector approximation: no slack, individual
chain-link collisions, or independent head inertia. Hit detection stays unchanged.
Paused editor scrubbing replays the preceding swing at 120 Hz; zero-time draws
freeze the result. `debugSnapshot().physics` reports the model, lever length,
angular velocity in rad/s, damping, and gravity (9.81 world units/s²).

The assembler now renders both previews through one real gameplay assembly,
two perspective cameras and touch/mouse OrbitControls. Its head view and combined
view share the exact same particle sprites and use the canonical PNG materials.
The 0.5-world-unit handle width, inherited head scale, additive blending, emitter
source pixels, layer occlusion, particle size, rise speed and lifetime are the
gameplay implementation. Fire stays live when motion is paused. The camera fit
includes expected particle reach; Reset 3D views restores framing after zooming.
The fire size/speed controls are in world units; the old 2D emitter simulation
has been removed. Copied diagnostics include live emitter settings/counts.

## Verification

Run:

```sh
node scripts/test-weapon-sprite-assemblies.js
node scripts/test-weapon-layer-effects.js
node scripts/run-tests.js weapon
node scripts/check-cache-busts.js
```

The first two tests exercise registry integration, alpha anchors, ordered
head layers, marker recoloring, source/upper-layer occlusion, head metal
regions, fire draw order and chain enchantment exclusion. The game and Attack
Animation Editor share the same assembled renderer. The existing mobile log
reports load/alpha/material errors; the game exposes
`window.HobunjiWeaponSpriteAssemblies.debugSnapshot()`.

The unique weapon has an inventory definition but is not added to every
player's starting gear. Acquisition is separate from sprite authoring.

## Head-only and combined previews (October 30 fix)

The Multi-sprite Weapon editor now offers two independent **live canvas previews**:
1. **Head / layered part close-up** — renders the brazier's four PNGs with
   their authored offsets, metal colors and interleaved fire. The **Solo
   selected layer** checkbox temporarily isolates a layer (particularly
   useful for the fuel beneath the front brazier). This never changes the
   actual assembly or what the combined canvas displays.
2. **Combined weapon preview** — draws the original rigid weapon PNG, chain,
   and layered head at their authored contact points; blue and amber markers
   identify the two chain joints.

Both previews use [preview-renderer.js](../tools/multi-sprite-weapon-editor/preview-renderer.js)
to derive a **visible-alpha-pixel bounding rectangle** for every sprite and
then fit the complete transformed stack to the available canvas. The previous
shaft-only zoom could place the chain-end head outside the preview with **no
error in the mobile log**, even after every PNG loaded successfully.

One animation progress control and one requestAnimationFrame drive both panes,
but each holds separate fire particles and fit transforms. The preview debug
copy now includes each pane's measured bounds, zoom, number of loaded head
parts, chain readiness, and head joint coordinates.

Run `node scripts/test-multi-sprite-weapon-preview.js` to guard against the
old crop. Its synthetic images include a 1,050px chain, differently sized
transparent head PNGs, six swing phases, both mobile and desktop aspect
ratios, exact source draw order and the solo-fuel mode.

## Preview painter regression and fix

When the initial head/combined preview renderer was extracted from the Tool
Hub editor, its caller still referenced `paintedImage`, but the helper was
accidentally removed with the retired single-canvas renderer. The browser
repeatedly logged `Preview: paintedImage is not defined`, leaving both
preview drawings blank despite successful PNG loads.

The editor now restores `paintedImage(part)` as the single color/material
adapter shared by **both** preview canvases. Metal layers invoke the existing
`ToolMetalRecolor.getRecoloredCanvas` with the editor's selected metal,
verdigris and oxidation, one cached request per sprite/palette. Until the
promise resolves, the original source PNG is drawn. Marker layers use
`HobunjiLayeredWeaponEffects.recolorMarker`, preserving the fuel sprite's
off-white rag palette; other layers are unchanged. Failed recolors use the
source sprite without trying again every animation frame.

The frame exception logger now compares the full `Preview: …` message to its
previous error, so a persistent rendering failure is logged **once**, not
dozens of times per second. The dedicated
`node scripts/test-multi-sprite-editor-frame.js` test executes the actual
Tool Hub app startup and queued animation frames with six PNGs, verifying both
preview canvases, pending and completed recoloring, rag tint, cache reuse,
error de-duplication and recovery. This test complements the independent
renderer geometry/fit regression.

## Pick on sprite / handle-relative assembly scales

The Flails tab now has a **Pick on sprite** button for the haft, chain-top,
chain-bottom and head. This opens the actual source PNG in a touch-accessible
canvas, fitted independently from the two normal previews. A tap writes the
source **top-left pixel** `{x,y}` into the selected anchor and switches it
to explicit coordinates. Existing automatic top/bottom alpha-anchor options
remain supported. For generated ropes, the physical endpoints are fixed by
the rope cylinder geometry and the chain-top/bottom PNG pick buttons are
disabled; you still pick the haft and head attachment points.

`flail.chain.scale` and `flail.head.scale` (default **1**) are **independent
multipliers relative to the final scaled rigid handle**. Every existing
weapon/character/hand-grip scale affects the entire weapon first, then these
ratios alter only chain/rope length/diameter or the complete head assembly.
The runtime reads `plane.getWorldScale()` and compares it to the parent
holder scale, so an independently resized handle is the authority. Chain top
stays attached to the handle; chain bottom moves with adjusted chain length;
and the head's chosen attachment coordinate stays on that endpoint while
its layers grow or shrink together.

## Grapple-Flail generated rope and composite head

The second registered recipe, `grappleFlail`, uses the three sprite assets
`grapple-flail_handle.png`, `grapple-flail_grapple-back.png` and
`grapple-flail_grapple-front.png`. The three source PNG blobs were copied
from the repository's new main-branch art into the feature branch without
merging unrelated main changes.

Unlike Hachutu, this flail's connector uses
`flail.chain.type: 'rope'` rather than a chain PNG, with editable
`lengthPx` and `radiusPx` in original **handle pixels**, `color`,
`scale`, and the existing root totem's
`assets/textures/wavy_surface.png`. Gameplay builds a tapered textured
`THREE.CylinderGeometry` with `THREE.MeshLambertMaterial`, matching the
root-totem hanging-potion rope's construction. Both use the same flail
lever/follow animation, rendered scale, and attachment math. The Tool Hub
combined preview draws the corresponding fitted brown rope.

The Grapple head has only two ordered PNG layers, **back → front**.
Its attachment uses `flail.head.anchorSpace: 'composite'`, with
`{x,y}` in the **shared image-centered pixel frame** (positive Y down).
The *Between layers (shared center)* pick mode overlays both PNGs and allows
selecting even fully transparent spaces **between** the rendered objects.
This avoids snapping the rope to either sprite's opaque edge. Ordinary
heads can still anchor to a named single source PNG instead. The default
composite anchor is `{x:0,y:0}` and can be artist-calibrated in the editor.

Regression coverage: `node scripts/test-flail-rope-picker-scale.js`
checks rope preview placement, independent scaling, fitted mobile bounds,
two-layer assembly, source-image pixel selection and composite-gap taps.
`scripts/test-multi-sprite-editor-frame.js` also exercises the actual
Grapple-Flail UI events and resulting saved JSON.
