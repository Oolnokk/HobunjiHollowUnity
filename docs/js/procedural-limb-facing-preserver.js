// Procedural Animation Editor compatibility shim: preserve the editor-authored
// front-facing yaw while the Ground / Carry adapter owns torso pitch/roll.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbFacingPreserver) return;

  const baselines = new WeakMap(); // Stores each fresh pose root's editor-authored yaw before Ground / Carry can overwrite it.
  let lastPoseRoot = null; // Used only to avoid repeating the visible mobile status message every frame.

  function currentPoseRoot() { // Resolves the same model -> poseRoot hierarchy used by the Ground / Carry adapter.
    const backdrop = window.HobunjiGameplayBackdrop;
    if (!backdrop || backdrop.getPreviewMode?.() !== 'npc') return null;
    const model = backdrop.getAvatarModel?.();
    return model?.parent || null;
  }

  function captureBaseline() { // Must run before the Ground / Carry author starts, and before its avatar-changed listener on rebuilds.
    const poseRoot = currentPoseRoot();
    if (!poseRoot || baselines.has(poseRoot)) return poseRoot;
    const yaw = Number(poseRoot.rotation?.y); // Existing editor yaw is the source of truth for which portrait side faces the normal preview camera.
    baselines.set(poseRoot, Number.isFinite(yaw) ? yaw : 0);
    poseRoot.userData = poseRoot.userData || {};
    poseRoot.userData.hobunjiLimbPoseBaselineYaw = Number.isFinite(yaw) ? yaw : 0; // Leaves the captured value inspectable in scene diagnostics.
    return poseRoot;
  }

  function restoreFacing() { // Runs after the Ground / Carry frame callback and restores only yaw; its pitch/roll/position remain untouched.
    const poseRoot = currentPoseRoot();
    if (!poseRoot) {
      requestAnimationFrame(restoreFacing);
      return;
    }
    if (!baselines.has(poseRoot)) captureBaseline();
    const yaw = baselines.get(poseRoot);
    if (Number.isFinite(yaw) && window.HobunjiProceduralLimbPoseAuthor) {
      poseRoot.rotation.y = yaw;
      poseRoot.matrixWorldNeedsUpdate = true;
      poseRoot.userData.hobunjiLimbPoseFacingRestoredYaw = yaw; // Mobile-visible debugging can inspect this through the existing scene/model dump tools.
      if (lastPoseRoot !== poseRoot) {
        const status = document.getElementById('statusPill');
        if (status) {
          status.textContent = `Ground / Carry facing preserved · Y ${(yaw * 180 / Math.PI).toFixed(1)}°`;
          status.className = 'pill good';
        }
        lastPoseRoot = poseRoot;
      }
    }
    requestAnimationFrame(restoreFacing);
  }

  // This script is intentionally loaded before procedural-limb-pose-author.js.
  // Its listener therefore captures a newly rebuilt avatar's untouched yaw
  // before the author adapter's later listener can begin applying poses.
  window.addEventListener('hobunji-backdrop-avatar-changed', captureBaseline);
  window.addEventListener('hobunji-backdrop-api-ready', () => captureBaseline(), { once: true });
  captureBaseline();
  requestAnimationFrame(restoreFacing);

  window.HobunjiProceduralLimbFacingPreserver = {
    version: 1,
    captureBaseline,
    getBaselineYaw: () => {
      const poseRoot = currentPoseRoot();
      return poseRoot ? baselines.get(poseRoot) ?? null : null;
    },
  };
})();
