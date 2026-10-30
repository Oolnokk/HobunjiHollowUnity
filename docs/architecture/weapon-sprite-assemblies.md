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
