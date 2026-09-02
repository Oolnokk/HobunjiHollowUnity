// Procedural Animation Editor compatibility shim: preserve the editor-authored
// front-facing yaw while the Ground / Carry adapter owns torso pitch/roll.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbFacingPreserver) return;

  const baselines = new WeakMap(); // Stores each fresh pose root's editor-authored yaw before Ground / Carry can overwrite it.
  const wrappedRotations = new WeakMap(); // Remembers the original Euler.set method so each pose root is wrapped exactly once.
  let lastPoseRoot = null; // Used only to avoid repeating the visible mobile status message on avatar refreshes.

  function currentPoseRoot() { // Resolves the same model -> poseRoot hierarchy used by the Ground / Carry adapter.
    const backdrop = window.HobunjiGameplayBackdrop;
    if (!backdrop || backdrop.getPreviewMode?.() !== 'npc') return null;
    const model = backdrop.getAvatarModel?.();
    return model?.parent || null;
  }

  function protectPoseRoot(poseRoot) { // Prevents this adapter's rotation.set(..., 0, ...) calls from erasing the editor's established front-facing yaw.
    if (!poseRoot?.rotation || wrappedRotations.has(poseRoot.rotation)) return poseRoot;
    const yaw = Number(poseRoot.rotation.y); // Captured before procedural-limb-pose-author.js is allowed to start.
    const baselineYaw = Number.isFinite(yaw) ? yaw : 0;
    const rotation = poseRoot.rotation;
    const originalSet = rotation.set; // Three.js Euler.set remains the source of pitch/roll/order behavior.
    baselines.set(poseRoot, baselineYaw);
    wrappedRotations.set(rotation, originalSet);
    poseRoot.userData = poseRoot.userData || {};
    poseRoot.userData.hobunjiLimbPoseBaselineYaw = baselineYaw; // Inspectable in existing scene/model diagnostics.

    rotation.set = function protectedGroundCarryEulerSet(x, y, z, order) {
      const authorLoaded = Boolean(window.HobunjiProceduralLimbPoseAuthor); // Only suppresses the zero-yaw writes once Ground / Carry owns the pose root.
      const requestedYaw = Number(y);
      const preserveFacing = authorLoaded && Number.isFinite(requestedYaw) && Math.abs(requestedYaw) < 1e-8;
      return originalSet.call(this, x, preserveFacing ? baselineYaw : y, z, order);
    };

    if (lastPoseRoot !== poseRoot) {
      const status = document.getElementById('statusPill'); // Gives mobile testing a visible confirmation without requiring DevTools.
      if (status) {
        status.textContent = `Ground / Carry facing preserved · Y ${(baselineYaw * 180 / Math.PI).toFixed(1)}°`;
        status.className = 'pill good';
      }
      lastPoseRoot = poseRoot;
    }
    return poseRoot;
  }

  function captureBaseline() { // Runs before the pose author on initial load and before its later avatar-changed listener on rebuilds.
    const poseRoot = currentPoseRoot();
    if (!poseRoot) return null;
    return protectPoseRoot(poseRoot);
  }

  // This script is intentionally loaded before procedural-limb-pose-author.js.
  // Registration order means fresh avatar rebuilds are protected before the
  // Ground / Carry listener can apply a pose with a zero Y rotation.
  window.addEventListener('hobunji-backdrop-avatar-changed', captureBaseline);
  window.addEventListener('hobunji-backdrop-api-ready', captureBaseline, { once: true });
  captureBaseline();

  window.HobunjiProceduralLimbFacingPreserver = {
    version: 2,
    captureBaseline,
    getBaselineYaw: () => {
      const poseRoot = currentPoseRoot();
      return poseRoot ? baselines.get(poseRoot) ?? null : null;
    },
  };
})();
