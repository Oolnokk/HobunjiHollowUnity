// Final creator-only held-tool parity corrections: Kenkari prop size and idle sprite bases.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingCharacterCreationWeaponPolish'; // Prevents duplicate frame hooks after cached bootstrap replay.
  if (window[PATCH_ID]) return;

  const WEAPON_FIX_ID = 'hobunjiOnboardingCharacterCreationWeaponViewFix'; // Owns the randomized starter choice/holder installed immediately before this patch.
  const LIFE_PATCH_ID = 'hobunjiOnboardingCharacterCreationLifePreview'; // Supplies the current species/gender/model identity.
  const KENKARI_TOOL_SCALE = 0.75; // Parrot-family creator prop correction; matches the authored 75% Kenkari raw-PNG character basis instead of dwarfing the hands with a full-size 0.5-world-unit prop.
  const HOE_BASIS_SHAPES = new Set(['hatchet']); // Hatchet should sit on the same visible idle sprite basis as the already-correct Hoe.
  const PICKSHOVEL_BASIS_SHAPES = new Set(['fishingspear']); // Fishing Spear should sit on the same visible idle sprite basis as the already-correct Pick-Shovel.

  let lastPlane = null; // Tool plane already corrected for the current generated preview.

  function weaponFix() {
    return window[WEAPON_FIX_ID] || null;
  }

  function life() {
    return window[LIFE_PATCH_ID]?.life || null;
  }

  function cancelSweepNeutralTwist(plane, shape) {
    if (!plane?.quaternion || (!HOE_BASIS_SHAPES.has(shape) && !PICKSHOVEL_BASIS_SHAPES.has(shape))) return false;
    const THREE = window.THREE;
    if (!THREE?.Quaternion || !THREE?.Vector3) return false;
    // weapon-view-fix added +90° local-Z solely because these two sprites are
    // sweep attacks. That changed their IDLE appearance even though their holder
    // already uses the correct Heavy/Light weapon stance. Remove only that local
    // sprite compensation: Hatchet now visually shares Hoe's basis, and Fishing
    // Spear shares Pick-Shovel's basis, while their actual attack animStyle stays
    // sweep for gameplay after character creation.
    const undo = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
    plane.quaternion.multiply(undo).normalize();
    return true;
  }

  function applyKenkariPropScale(plane, speciesId) {
    const species = String(speciesId || '').trim().toLowerCase().replace(/_/g, '-');
    if (species !== 'kenkari' || !plane?.scale || !plane?.position) return 1;
    // Primary-grip correction includes both a visual scale and a translated
    // offset from the holder origin. Scale BOTH so the authored grip point stays
    // at the procedural hand instead of shrinking the sprite away from its hand.
    plane.scale.multiplyScalar(KENKARI_TOOL_SCALE);
    plane.position.multiplyScalar(KENKARI_TOOL_SCALE);
    return KENKARI_TOOL_SCALE;
  }

  function updateStatus(extra = {}) {
    const status = window.HOBUNJI_ONBOARDING_REDESIGN_STATUS;
    if (!status || typeof status !== 'object') return;
    Object.assign(status, extra);
  }

  function polishCurrentPlane() {
    const fix = weaponFix();
    const plane = fix?.state?.toolPlane || null;
    if (!plane || plane === lastPlane) return;
    const choice = fix?.state?.choice || null;
    const currentLife = life();
    if (!choice || !currentLife?.model) return;

    lastPlane = plane;
    const stanceBasisCorrected = cancelSweepNeutralTwist(plane, choice.shape);
    const speciesScale = applyKenkariPropScale(plane, currentLife.speciesId);
    plane.updateMatrix?.();
    plane.updateMatrixWorld?.(true);

    updateStatus({
      previewWeaponSpeciesScale: speciesScale,
      previewWeaponIdleBasis: HOE_BASIS_SHAPES.has(choice.shape)
        ? 'hoe'
        : (PICKSHOVEL_BASIS_SHAPES.has(choice.shape) ? 'pickshovel' : choice.shape),
      previewWeaponSweepIdleTwistRemoved: stanceBasisCorrected,
    });
  }

  function frame() {
    if (!weaponFix()?.state?.toolPlane) lastPlane = null;
    polishCurrentPlane();
    requestAnimationFrame(frame);
  }

  window[PATCH_ID] = Object.freeze({
    kenkariToolScale: KENKARI_TOOL_SCALE,
    polishCurrentPlane,
  });
  requestAnimationFrame(frame);
})();
