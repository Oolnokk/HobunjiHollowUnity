// Approved flail calibrations shared by gameplay, Attack Animation Editor and Tool Hub.
// Connector scaleX is width (generated rope radius); scaleY is length. Both follow the handle size.
window.WEAPON_SPRITE_ASSEMBLY_CONFIG = Object.freeze({
  schema: 'hobunji_weapon_sprite_assemblies.v1',
  weapons: {
    hachutuTorchFlail: {
      label: 'Hachutu Torch-Flail',
      flail: {
        haftAnchor: { x: 237, y: 1027 },
        chain: {
          sprite: 'assets/toolsprites/hachutu_torch-flail_chain.png',
          top: { opaque: 'top' },
          bottom: { opaque: 'bottom' },
          material: 'metal',
          scaleX: 0.35,
          scaleY: 0.25,
        },
        head: {
          anchorLayer: 'handle',
          anchor: { x: 61, y: 40 },
          layers: [
            { id: 'back', sprite: 'assets/toolsprites/torch-flail_brazier-back.png', material: 'metal' },
            { id: 'handle', sprite: 'assets/toolsprites/torch-flail_brazier-handle.png', material: 'metal' },
            {
              id: 'fuel', sprite: 'assets/toolsprites/torch-flail_brazier-fuel.png',
              material: 'marker', sourceHex: '#7F00FF', targetHex: '#E7DDC9',
              vfx: {
                type: 'fire', sourceHex: '#7F00FF', rate: 22,
                colors: ['#FFE6A5', '#FFAA3E', '#FF5F20'],
                size: 0.02, life: 0.35, speed: 0.12,
              },
              offsetPx: { x: 0, y: 0 },
            },
            { id: 'front', sprite: 'assets/toolsprites/torch-flail_brazier-front.png', material: 'metal' },
          ],
          scale: 2.5,
        },
        motion: { lag: 0.065, idleFollow: 7, attackFollow: 15 },
      },
    },
    hachutuTorchStaff: {
      label: 'Hachutu Torch-Staff',
      sprite: 'assets/toolsprites/hachutu_torch-staff.png',
      base: {
        material: 'marker', sourceHex: '#7F00FF', targetHex: '#E7DDC9',
        vfx: {
          type: 'fire', sourceHex: '#7F00FF', masteryClusters: 2,
          rate: 44, // Each of the two tips gets the Torch-Flail's full-strength 22 motes/s at mastery 5.
          colors: ['#FFE6A5', '#FFAA3E', '#FF5F20'],
          size: 0.02, life: 0.35, speed: 0.12,
        },
      }, // One rigid PNG, two original-marker fire regions; deliberately no metal/verdigris surface.
      layers: [],
    },
    grappleFlail: {
      label: 'Grapple-Flail',
      sprite: 'assets/toolsprites/grapple-flail_handle.png',
      flail: {
        haftAnchor: { x: 210, y: 1051 },
        chain: {
          type: 'rope', lengthPx: 160, radiusPx: 2.5,
          color: '#6B4728', texture: 'assets/textures/wavy_surface.png',
          scaleX: 5.25, scaleY: 3.75, // Length inherits the torch chain ratio: 5.25 × (0.25 / 0.35).
        },
        head: {
          scale: 1,
          anchorSpace: 'composite',
          anchorLayer: 'composite',
          anchor: { x: 8, y: 190 },
          layers: [
            { id: 'back', sprite: 'assets/toolsprites/grapple-flail_grapple-back.png', material: 'metal' },
            { id: 'front', sprite: 'assets/toolsprites/grapple-flail_grapple-front.png', material: 'metal' },
          ],
        },
        motion: { lag: 0.065, idleFollow: 7, attackFollow: 15, angularDamping: 8 },
      },
    },
  },
});
