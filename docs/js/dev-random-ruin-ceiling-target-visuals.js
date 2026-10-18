// Ceiling-sconce variant of V50's wall-mounted short obelisk projectile target.
// Shared by fixed ceiling glyphs and the moving rail targets: no loose disk,
// unattached rune sprite, or gap between the support and its stone block.
(() => {
  'use strict';
  if (!window.THREE) return;

  const RUNE_PATH = 'assets/textures/decals/ruin_glyph_rune.png'; // Same authored decal as ruinGlyphTarget; reused across all ceiling targets.
  const IDLE_COLOR = 0xff8a2a; // Orange target rune before a projectile hit.
  const ACTIVE_COLOR = 0x4dff6e; // Green target rune after a projectile hit.
  const MOUNT_TOP = 0.05; // Top of the ceiling/carriage plate, embedded into its support instead of floating below it.
  const BLOCK_CENTER_Y = -0.69; // Used by hit detection, hum positions and roof-to-target alignment diagnostics.
  const BLOCK_WIDTH = 0.32; // V50 short-obelisk proportions, enlarged slightly for a readable airborne target.
  const BLOCK_HEIGHT = 0.48;
  const BLOCK_DEPTH = 0.32;
  let runeTexture = null; // Cached for every generated target; never destroyed during a ruin reroll.

  function texture() {
    if (runeTexture) return runeTexture;
    runeTexture = new THREE.TextureLoader().load(RUNE_PATH);
    if (THREE.SRGBColorSpace) runeTexture.colorSpace = THREE.SRGBColorSpace;
    return runeTexture;
  }

  function create(kit, { parent, name = 'dev_ruin_ceiling_sconce_target', x = 0, y = 0, z = 0 } = {}) {
    if (!parent?.add || !kit?.sharedBoxGeometry || !kit?.makeBasic) return null;
    const object = new THREE.Group();
    object.name = name;
    object.position.set(x, y, z);
    object.userData.devRuinCeilingSconceTarget = true;
    object.userData.devRuinFootprintIgnore = true; // Ceiling furniture must not enter the ground-navigation footprint scan.

    function stone(nameSuffix, width, height, depth, px, py, pz) {
      const mesh = new THREE.Mesh(kit.sharedBoxGeometry(width, height, depth), kit.makeBasic(0x7a746b));
      mesh.name = name + '_' + nameSuffix;
      mesh.position.set(px, py, pz);
      kit.naturalizeStone?.(mesh); // Uses the same stretched carved_smooth.png finish as ordinary ruin stone.
      mesh.userData.devRuinFootprintIgnore = true;
      object.add(mesh);
      return mesh;
    }

    // Consecutive solids deliberately INTERSECT: the plate penetrates the
    // ceiling/rail, the stem overlaps both plate and cap, and the cap overlaps
    // the block. The contact chain has no floating parts, even at low LOD.
    stone('ceiling_plate', .36, .10, .36, 0, 0, 0);         // top +.05, bottom -.05
    stone('hanging_stem', .12, .40, .12, 0, -.245, 0);      // top -.045, bottom -.445
    stone('support_cap', .39, .08, .39, 0, -.445, 0);       // top -.405, bottom -.485
    const hitMesh = stone('decaled_block', BLOCK_WIDTH, BLOCK_HEIGHT, BLOCK_DEPTH, 0, BLOCK_CENTER_Y, 0); // top -.45
    stone('base_trim', .38, .06, .38, 0, -.91, 0);          // overlaps block bottom -.93

    const material = new THREE.MeshBasicMaterial({
      map:texture(), color:IDLE_COLOR, transparent:true,
      depthWrite:false, side:THREE.DoubleSide,
    }); // Each target owns its tint; all four faces share the same one texture/material.
    const faces = [
      { x:0, z:BLOCK_DEPTH*.5+.004, yaw:0 },
      { x:BLOCK_WIDTH*.5+.004, z:0, yaw:Math.PI*.5 },
      { x:0, z:-BLOCK_DEPTH*.5-.004, yaw:Math.PI },
      { x:-BLOCK_WIDTH*.5-.004, z:0, yaw:-Math.PI*.5 },
    ]; // Four vertical aiming faces match the wall-mounted V50 short-obelisk core.
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(.25, .27), material);
      plane.name = name + '_glyph_decal_' + i;
      plane.position.set(face.x, BLOCK_CENTER_Y, face.z);
      plane.rotation.y = face.yaw;
      plane.userData.devRuinFootprintIgnore = true;
      plane.raycast = () => {}; // The stone block is the authoritative projectile hit volume.
      object.add(plane);
    }
    parent.add(object);
    return {
      object, hitMesh, material, hitOffsetY:BLOCK_CENTER_Y,
      setActive(active) { material.color.setHex(active ? ACTIVE_COLOR : IDLE_COLOR); },
      attachmentGap(supportY) {
        // Positive = floating, zero/negative = touching or embedded.
        return Number(supportY) - (object.position.y + MOUNT_TOP);
      },
    };
  }

  window.DevRandomRuinCeilingTargetVisuals = Object.freeze({ create, BLOCK_CENTER_Y, MOUNT_TOP });
})();
