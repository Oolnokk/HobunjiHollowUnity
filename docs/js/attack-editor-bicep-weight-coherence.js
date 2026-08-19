// Keeps experimental PNG bicep skin channels composed with the editor's existing
// neck-weight diagnostic, which rewrites torso/head weights on its own controls.
(function (global) {
  'use strict';

  const bicep = global.ProceduralAvatarBicepRig;
  if (!bicep || global.HobunjiAttackEditorBicepWeightCoherence) return;

  const refresh = () => {
    requestAnimationFrame(() => {
      bicep.refreshAllWeights?.();
      global.ProceduralHandFrameDriver?.syncNow?.();
    });
  };

  // Neck radius rewrites skinWeight.xy; restore the precomputed arm silhouette
  // influences into .zw immediately afterward while retaining the new x:y ratio.
  document.getElementById('neckRadius')?.addEventListener('input', refresh);
  document.getElementById('neckRadius')?.addEventListener('change', refresh);

  // Avatar rebuilds create a fresh skinned plane and arm masks.
  document.getElementById('avatarSpecies')?.addEventListener('change', () => setTimeout(refresh, 0));
  document.getElementById('avatarGender')?.addEventListener('change', () => setTimeout(refresh, 0));

  // The existing guide checkbox controls the GLB hand/forearm guides; extend the
  // same switch to the new PNG bicep bones so all invisible bones are inspectable.
  const guide = document.getElementById('handShowArmBones');
  const syncGuide = () => bicep.setShowGuides?.(!!guide?.checked);
  guide?.addEventListener('change', syncGuide);
  syncGuide();
  refresh();

  global.HobunjiAttackEditorBicepWeightCoherence = Object.freeze({ refresh, syncGuide });
})(window);
