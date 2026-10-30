# Multi-sprite weapon authoring

The **Tool Hub → Combat → Multi-sprite Weapons** editor lives in
[tools/multi-sprite-weapon-editor/](../tools/multi-sprite-weapon-editor/index.html).
It has two tabs: **Flails** (haft, chain, attachment pixels, idle inertia and
attack following) and **Multi-layer Parts** (ordered sprite layers and
interleaved effects, usable on flails or ordinary weapons).

Edits stay in a device-local draft until exported and committed. Use **Export JS
config** to replace [config/weapon-sprite-assemblies.js](../config/weapon-sprite-assemblies.js)
or **Export JSON** for a portable draft. The runtime never loads the author's
localStorage draft. An authored key must resolve to an existing
`TOOL_ITEM_DEFS` item or `shapeKey`; the editor does not invent gameplay
weapon definitions or acquisitions.

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

Latest change: the connector keeps rotating through Hold while the haft stays
at its strike pose. Follow-through uses the dominant signed pitch or combined
tool-yaw/body-yaw travel, including power and backhand mirroring. Sweep attacks
with zero pitch therefore continue to move the chain/rope. Pitch axes come from
the holder rather than the PNG's fixed sweep basis. `debugSnapshot()` exposes
`yawTravelDeg` and `holdTurnDeg` for mobile inspection.

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
