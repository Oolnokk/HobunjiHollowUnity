// Shared attachment coordinates and profile normalization for stowed equipment.
// Artwork, preview flames, and runtime particles are separate; keep this author/game schema pure.
(function (global) {
  'use strict';
  if (global.HobunjiBeltStowRig) return;

  const torchDisplay = global.HobunjiBeltStowTorchDisplay; // Independent art source; both editor and runtime load it before this coordinate/schema module.
  const TORCH_WIDTH = torchDisplay?.TORCH_WIDTH || .5; // Stable public constant retained for existing callers.
  const TORCH_HEIGHT = torchDisplay?.TORCH_HEIGHT || TORCH_WIDTH * (1204 / 450); // Fallback makes isolated profile editing safe.
  const TORCH_SPRITE = torchDisplay?.TORCH_SPRITE || 'assets/toolsprites/torch.png'; // Author and gameplay reference the same canonical asset.
  const RAD = Math.PI / 180; // Converts exported rig rotation degrees to Three.js radians.
  const AXES = ['x', 'y', 'z']; // The JSON coordinate format shared with other attachment anchors.

  function defaultSnapshot(modelHeight = .9) {
    const height = Number.isFinite(Number(modelHeight)) && Number(modelHeight) > 0
      ? Number(modelHeight) : .9; // Fallback only; saved profiles use literal local-world coordinates.
    return {
      position: { x: 0, y: .5 * height, z: -.04 * height },
      rotationDeg: { x: 0, y: 0, z: -45 },
      scale: { x: 1, y: 1, z: 1 },
    };
  }

  function normalizedSnapshot(input, modelHeight = .9) {
    const initial = defaultSnapshot(modelHeight); // Missing/legacy profile fields get the same neutral belt pose.
    if (!input || typeof input !== 'object' || Array.isArray(input)) return initial;
    const snapshot = { position:{}, rotationDeg:{}, scale:{} };
    for (const group of ['position', 'rotationDeg', 'scale']) {
      for (const axis of AXES) {
        const raw = input[group]?.[axis];
        const value = raw == null || raw === '' ? NaN : Number(raw);
        const permitted = Number.isFinite(value) && (group !== 'scale' || (value >= .1 && value <= 4));
        snapshot[group][axis] = permitted ? value : initial[group][axis]; // Invalid imports cannot explode world geometry.
      }
    }
    return snapshot;
  }

  function characterProfile(library, species, gender) {
    const characters = library?.characters || {};
    const speciesId = String(species || '').trim().toLowerCase().replace(/_/g, '-');
    const sex = String(gender || '').trim().toLowerCase();
    const canonical = global.hobunjiTransformSpeciesId?.(speciesId) || speciesId;
    return characters[`${speciesId}::${sex}`] || characters[`${canonical}::${sex}`] || null;
  }

  function configuredSnapshot(library, species, gender) {
    const snapshot = characterProfile(library, species, gender)?.anchors?.beltStow;
    return snapshot && typeof snapshot === 'object' ? normalizedSnapshot(snapshot) : null;
  }

  function placeRoot(root, snapshot) {
    if (!root || !snapshot) return false;
    const pose = normalizedSnapshot(snapshot);
    root.position?.set?.(pose.position.x, pose.position.y, pose.position.z);
    root.rotation?.set?.(pose.rotationDeg.x * RAD, pose.rotationDeg.y * RAD, pose.rotationDeg.z * RAD);
    root.scale?.set?.(pose.scale.x, pose.scale.y, pose.scale.z);
    return true;
  }

  function createTorchDisplay(THREE, options) {
    return global.HobunjiBeltStowTorchDisplay?.createTorchDisplay?.(THREE, options) || null; // Preserve the author/game public API while the torch artwork has its own module.
  }

  global.HobunjiBeltStowRig = Object.freeze({
    TORCH_WIDTH, TORCH_HEIGHT, TORCH_SPRITE, defaultSnapshot, normalizedSnapshot,
    characterProfile, configuredSnapshot, placeRoot, createTorchDisplay,
  });
})(window);
