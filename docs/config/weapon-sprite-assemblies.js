// Committed, artist-authored multi-sprite weapon recipes shared by gameplay and the Tool Hub.
// The Tool Hub exports this exact registry shape; drafts stay local until committed.
window.WEAPON_SPRITE_ASSEMBLY_CONFIG = Object.freeze({
  schema: 'hobunji_weapon_sprite_assemblies.v1',
  weapons: {
    hachutuTorchFlail: {
      label: 'Hachutu Torch-Flail',
      flail: {
        haftAnchor: { opaque: 'top' }, // Editor may replace with an exact PNG-pixel coordinate.
        chain: {
          sprite: 'assets/toolsprites/hachutu_torch-flail_chain.png',
          top: { opaque: 'top' },
          bottom: { opaque: 'bottom' },
          material: 'metal', // Recolor chain like other metal sprites, but NEVER attach enchantment emitters here.
        },
        head: {
          anchorLayer: 'handle',
          anchor: { opaque: 'bottom' },
          layers: [
            { id: 'back', sprite: 'assets/toolsprites/torch-flail_brazier-back.png', material: 'metal' },
            { id: 'handle', sprite: 'assets/toolsprites/torch-flail_brazier-handle.png', material: 'metal' },
            {
              id: 'fuel', sprite: 'assets/toolsprites/torch-flail_brazier-fuel.png',
              material: 'marker',
              sourceHex: '#7F00FF', // Same explicit eye-marker hue used by Hachutu Binding Mask (II).
              targetHex: '#E7DDC9', // Off-white rag/wick tint, preserving original artwork shading.
              vfx: {
                type: 'fire', sourceHex: '#7F00FF', rate: 22,
                colors: ['#FFE6A5', '#FFAA3E', '#FF5F20'],
                size: 0.035, life: 0.65, speed: 0.12,
                // This emitter draws between fuel and front. All later opaque
                // head layers naturally obscure flames behind their silhouettes.
              },
            },
            { id: 'front', sprite: 'assets/toolsprites/torch-flail_brazier-front.png', material: 'metal' },
          ],
        },
      },
    },
  },
});
