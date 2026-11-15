// Approved flail calibrations shared by gameplay, Attack Animation Editor and Tool Hub.
// Connector scaleX is width (generated rope radius); scaleY is length. Both follow the handle size.
const hachutuTorchFuel = Object.freeze({ material: 'marker', sourceHex: '#7F00FF', targetHex: '#E7DDC9' }); // Shared off-white fuel tint for the held torch and staff.
const hachutuTorchFire = Object.freeze({
  type: 'fire', sourceHex: hachutuTorchFuel.sourceHex,
  rate: 22, // Full-strength motes per second at each tip.
  colors: ['#FFE6A5', '#FFAA3E', '#FF5F20'],
  size: 0.02, life: 0.35, speed: 0.12, worldRise: true,
  visualScale: 4, masteryFocus: 0.55, blendMode: 'normal', opacity: 0.65,
}); // Shared per-tip profile from the Torch-Staff.

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
                size: 0.02, life: 0.35, speed: 0.12, worldRise: true, // Brazier fire rises in world +Y while the flail head swings.
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
    torch: {
      label: 'Torch', sprite: 'assets/toolsprites/torch.png',
      base: {
        ...hachutuTorchFuel, markerReferenceValue: 179, // The torch's painted purple midtone maps to the staff's off-white.
        vfx: { ...hachutuTorchFire, litOnly: true, masteryClusters: 1, fixedMasteryRank: 5, fallbackTip: 'bottom', frontOfSource: true, clothDarkenS: 0.18, clothLitBrightness: 0.52 }, // PNG -Y is the business end; use it if its source-color marker is absent.
      },
      layers: [],
    },
    hachutuTorchStaff: {
      label: 'Hachutu Torch-Staff',
      sprite: 'assets/toolsprites/hachutu_torch-staff.png',
      base: {
        ...hachutuTorchFuel,
        vfx: { ...hachutuTorchFire, masteryClusters: 2, rate: hachutuTorchFire.rate * 2 },
      }, // One rigid PNG with two independent fire regions.
      layers: [],
    },
    grappleFlail: {
      label: 'Grapple-Flail',
      sprite: 'assets/toolsprites/grapple-flail_handle.png',
      flail: {
        haftAnchor: { x: 210, y: 1051 },
        chain: {
          type: 'rope', sprite: 'assets/objectsprites/rope_long.png', // Reuse the original transparent rope art from ruin swings.
          lengthPx: 225, radiusPx: 6.25, color: '#6B4728', // User-exported 225px length and 6.25px radius; retain the old flail's warm-brown target hue.
          scaleX: 5.25, scaleY: 3.75, // New dimensions: 843.75px grip-to-head reach and 65.625px visible width.
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
