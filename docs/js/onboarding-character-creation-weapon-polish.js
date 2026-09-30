// Final creator-only held-tool idle sprite-basis corrections.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingCharacterCreationWeaponPolish'; // Prevents duplicate frame hooks after cached bootstrap replay.
  if (window[PATCH_ID]) return;

  const WEAPON_FIX_ID = 'hobunjiOnboardingCharacterCreationWeaponViewFix'; // Owns the randomized starter choice/holder installed immediately before this patch.
  const HOE_BASIS_SHAPES = new Set(['hatchet']); // Hatchet should sit on the same visible idle sprite basis as the already-correct Hoe.
  const PICKSHOVEL_BASIS_SHAPES = new Set(['fishingspear']); // Fishing Spear should sit on the same visible idle sprite basis as the already-correct Pick-Shovel.

  let lastPlane = null; // Tool plane already corrected for the current generated preview.

  function weaponFix() {
    return window[WEAPON_FIX_ID] || null;
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
    if (!choice) return;

    lastPlane = plane;
    const stanceBasisCorrected = cancelSweepNeutralTwist(plane, choice.shape);
    plane.updateMatrix?.();
    plane.updateMatrixWorld?.(true);

    updateStatus({
      previewWeaponScaleSource: 'calculated-character-height',
      previewWeaponIdleBasis: HOE_BASIS_SHAPES.has(choice.shape)
        ? 'hoe'
        : (PICKSHOVEL_BASIS_SHAPES.has(choice.shape) ? 'pickshovel' : choice.shape),
      previewWeaponSweepIdleTwistRemoved: stanceBasisCorrected,
    });
  }

  function frame() {
    if (!weaponFix()?.state?.toolPlane) lastPlane = null;
    polishCurrentPlane();
  }

  window[PATCH_ID] = Object.freeze({
    polishCurrentPlane,
  });
  window.RuntimeFrameScheduler.register('onboarding-character-creation-weapon-polish', frame, {
    owner: 'OnboardingCharacterCreationWeaponPolish',
    description: 'Re-applies held-tool idle-sprite-basis corrections whenever the character creator preview\'s tool plane changes; weapon size comes from calculated character height.',
  });
})();
