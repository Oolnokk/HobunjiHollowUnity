# Layered weapons and flail assemblies

Runtime: [weapon-sprite-assemblies.js](../js/weapon-sprite-assemblies.js). The existing
\`game.js/makeToolPlaneMesh\` remains authoritative for the **haft**: equipping,
hand placement, weapon pose, combat timing, damage and hit detection are unchanged.
The same factory builds held sprites for players and hostiles. The
[Attack Animation Editor](../tools/attack-animation-editor/index.html) previews
the new geometry using the same runtime module.

## Static PNG layers (any weapon)

Add \`spriteLayers\` to a \`TOOL_ITEM_DEFS\` record, or to a shape's definition
in \`HELD_SHAPE_DEFS\` for propagation to all generated metal variants:

\`\`\`js
spriteLayers: [
  { id: 'ornament', sprite: 'assets/toolsprites/example-ornament.png' },
  { id: 'glow', sprite: 'assets/toolsprites/example-glow.png', offsetPx: { x: 0, y: -4 } },
]
\`\`\`

The normal \`sprite\` stays the attachment/grip authority; these are overlays
on its plane, drawn in array order. \`offsetPx\` is measured in the **base
sprite's pixel units**, +X right and +Y down. Layers have independent image
dimensions but share the base's pixel-to-world scale.

## Flails

An optional \`weaponAssembly.flail\` attaches a chain and a layered head without
rewriting the weapon's animation. The Hachutu default is registered in
\`HobunjiWeaponSpriteAssemblies.definitions.hachutuTorchFlail\`.

\`\`\`js
weaponAssembly: {
  flail: {
    haftAnchor: { x: 224, y: 18 }, // PNG pixel on the rigid haft; or { opaque: 'top' }
    chain: {
      sprite: 'assets/toolsprites/example-chain.png',
      top: { opaque: 'top' },
      bottom: { opaque: 'bottom' },
    },
    head: {
      anchorLayer: 'handle',
      anchor: { x: 220, y: 450 }, // PNG pixel on the named head layer; or { opaque: 'bottom' }
      layers: [
        { id: 'back', sprite: 'assets/toolsprites/example-head-back.png' },
        { id: 'handle', sprite: 'assets/toolsprites/example-head-handle.png' },
        { id: 'front', sprite: 'assets/toolsprites/example-head-front.png' },
      ],
    },
  },
}
\`\`\`

The example coordinates are **illustrative only**, not measurements of the
Hachutu art. The shipped Hachutu setup uses the opaque-pixel defaults until
the artist calibrates its mount points. An edge anchor finds the highest
(\`top\`) or lowest (\`bottom\`) scan line containing nontransparent pixels
(alpha ≥16), then uses the horizontal mean of that row's opaque pixels.
Explicit \`{x,y}\` coordinates override the scan and are clamped to the image.

Head layers share a common center frame, and \`offsetPx\` on each head layer
can align images exported from different canvas origins. Use \`anchorLayer\`
to specify which image's pixel space supplies the physical chain connection.
All geometric offsets are scaled with the existing tool-grip scale.

At rest the chain hangs toward world −Y, trailing the velocity of its haft
when moving; the head remains world-upright. An active attack steers the
chain toward the authored haft's long axis with a bounded angular follow,
and makes the head align with the chain. Physics are **presentation-only**;
they don't change reach, attack hit checks, or weapon classifications.

## Inspection and testing

- \`node scripts/test-weapon-sprite-assemblies.js\` runs alpha-anchor and
  integration tests, alongside existing weapon/dual-wield regression tests.
- \`window.HobunjiWeaponSpriteAssemblies.debugSnapshot()\` returns the current
  weapon key, asset-loaded state, attachment/attack status, progress, and chain
  direction for every assembly.
- Load/scan failures feed the existing in-game \`__farmLog\` diagnostics,
  including on mobile.
- The Attack Animation Editor has a **Hachutu Torch-Flail** dropdown choice.
  Scrub Neutral→Windup→Strike to check the swing and use authored coordinate
  overrides if opaque-edge defaults attach at the wrong location.

The Hachutu weapon definition and inventory metadata are registered, but it is
**not automatically put in every character's starting inventory**. Its
acquisition path can be added separately without changing these visuals.
