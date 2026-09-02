// Procedural Animation Editor compatibility shim: preserve the editor-authored
// front-facing yaw while the Ground / Carry adapter owns torso pitch/roll,
// keep the correct portrait side visible from any camera angle, make the
// torso-radius guide non-occluding, and repair mixed main/branch test runtimes.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbFacingPreserver) return;

  const DOUBLE_SIDE = 2; // Three.js DoubleSide is stable across the r128/r165 versions used by Hobunji tools.
  const SCRIPT_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null; // Keeps extension-owned dependencies on this exact GitHack branch/commit.
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL) : new URL('../../', location.href); // Resolves docs/ regardless of the giant editor's own repository picker.
  const baselines = new WeakMap(); // Stores each fresh pose root's editor-authored yaw before Ground / Carry can overwrite it.
  const wrappedRotations = new WeakMap(); // Remembers the original Euler.set method so each pose root is wrapped exactly once.
  const faceState = new WeakMap(); // Remembers the last camera-relative portrait face to add a tiny side-crossing hysteresis.
  let lastPoseRoot = null; // Used only to avoid repeating the visible mobile status message on avatar refreshes.
  let lastFaceModel = null; // Keeps face-switch status updates limited to actual front/back transitions.
  let lastFaceName = '';
  let lastFaceSignature = '';
  let solverReport = ''; // Prevents the same bootstrap source from being repeated in the editor's visible log.

  function editorLog(message, level = 'info', extra = null) { // Writes through the giant editor's own visible logger when available, with console as the standalone fallback.
    const text = `Ground / Carry: ${message}`;
    if (typeof window.log === 'function') {
      try {
        window.log(text, level, extra);
        return;
      } catch (_) {}
    }
    if (level === 'error') console.error(`[Ground / Carry] ${message}`, extra ?? '');
    else if (level === 'warn') console.warn(`[Ground / Carry] ${message}`, extra ?? '');
    else console.info(`[Ground / Carry] ${message}`, extra ?? '');
  }

  function reportSolver(message, level = 'info') { // Makes mixed main/commit runtime provenance explicit once per distinct solver state.
    if (solverReport === message) return;
    solverReport = message;
    editorLog(message, level);
  }

  function ensureBranchFixedLegSolver() { // The editor's own repo picker can still resolve main even when the HTML is commit-pinned; replace only this changed dependency from the pinned document path.
    if (typeof window.LegBones?.solveFixedTwoBoneChain === 'function') {
      reportSolver(`fixed-leg solver already available before pinned override · source ${SCRIPT_URL?.href || 'unknown'}`);
      return Promise.resolve(true);
    }
    const src = new URL('js/leg-bones.js?v=20260902-groundcarry', DOCS_BASE).href;
    reportSolver(`main/runtime LegBones lacks solveFixedTwoBoneChain; loading pinned solver from ${src}`, 'warn');
    const existing = [...document.scripts].find(script => script.src === src);
    if (existing) return new Promise(resolve => {
      if (typeof window.LegBones?.solveFixedTwoBoneChain === 'function') return resolve(true);
      existing.addEventListener('load', () => {
        const ready = typeof window.LegBones?.solveFixedTwoBoneChain === 'function';
        reportSolver(`${ready ? 'pinned fixed-leg solver ready' : 'pinned leg-bones loaded but fixed solver is still missing'} · ${src}`, ready ? 'info' : 'error');
        resolve(ready);
      }, { once: true });
      existing.addEventListener('error', () => {
        reportSolver(`failed to load pinned fixed-leg solver · ${src}`, 'error');
        resolve(false);
      }, { once: true });
    });
    return new Promise(resolve => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        const ready = typeof window.LegBones?.solveFixedTwoBoneChain === 'function';
        reportSolver(`${ready ? 'pinned fixed-leg solver ready' : 'pinned leg-bones loaded but fixed solver is still missing'} · ${src}`, ready ? 'info' : 'error');
        resolve(ready);
      };
      script.onerror = () => {
        reportSolver(`failed to load pinned fixed-leg solver · ${src}`, 'error');
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }

  function currentContext() { // Resolves the public preview objects without reaching into the giant editor's private state.
    const backdrop = window.HobunjiGameplayBackdrop;
    if (!backdrop || backdrop.getPreviewMode?.() !== 'npc') return null;
    const model = backdrop.getAvatarModel?.();
    if (!model) return null;
    return { backdrop, model, poseRoot: model.parent || null, camera: backdrop.getCamera?.() || null };
  }

  function currentPoseRoot() { // Retains the tiny public helper used by existing regression tests and diagnostics.
    return currentContext()?.poseRoot || null;
  }

  function protectPoseRoot(poseRoot) { // Prevents Ground / Carry rotation.set(..., 0, ...) calls from erasing the editor's established front-facing yaw.
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

  function portraitFaceForMaterial(material, model) { // Uses texture identity first, then stable portrait metadata and canonical material names.
    if (!material) return '';
    if (material.map && model?.userData?.frontTexture && material.map === model.userData.frontTexture) return 'front';
    if (material.map && model?.userData?.backTexture && material.map === model.userData.backTexture) return 'back';
    const tracked = material?.map?.userData?.hobunjiPortraitFlip?.face;
    if (tracked === 'front' || tracked === 'back') return tracked;
    const name = String(material?.name || '').toLowerCase();
    if (/npc_avatar_(?:skinned_)?front_material/.test(name)) return 'front';
    if (/npc_avatar_(?:skinned_)?back_material/.test(name)) return 'back';
    return '';
  }

  function collectPortraitFaces(model) { // Supports both rigid two-Mesh avatars and the neck-rigged one-Mesh/two-material avatar.
    const frontMaterials = new Set();
    const backMaterials = new Set();
    const frontMeshes = new Set();
    const backMeshes = new Set();
    model.traverse?.((node) => {
      if (!node?.isMesh && !node?.isSkinnedMesh) return;
      const nodeName = String(node.name || '').toLowerCase();
      const explicitFace = String(node.userData?.hobunjiPlaneFace || '').toLowerCase();
      if (explicitFace === 'front' || nodeName === 'npc_avatar_front_plane' || /_front_plane$/.test(nodeName)) frontMeshes.add(node);
      if (explicitFace === 'back' || nodeName === 'npc_avatar_back_plane' || /_back_plane$/.test(nodeName)) backMeshes.add(node);

      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const classified = materials.map(material => portraitFaceForMaterial(material, model));
      for (let i = 0; i < materials.length; i++) {
        if (classified[i] === 'front') frontMaterials.add(materials[i]);
        else if (classified[i] === 'back') backMaterials.add(materials[i]);
      }

      // PNGPlaneAvatar's skinned portrait is one SkinnedMesh with two geometry
      // groups. Its renderer contract is slot 0 = front triangles/material and
      // slot 1 = rear triangles/material. This remains true even when wrapper
      // scripts clone or rename the materials, so use it as the authoritative
      // fallback instead of depending on names.
      if (Array.isArray(node.material) && node.material.length >= 2 && (node.isSkinnedMesh || (node.geometry?.groups?.length || 0) >= 2)) {
        frontMaterials.add(node.material[0]);
        backMaterials.add(node.material[1]);
      }
    });
    return {
      frontMaterials: [...frontMaterials],
      backMaterials: [...backMaterials],
      frontMeshes: [...frontMeshes],
      backMeshes: [...backMeshes],
    };
  }

  function setFaceMaterial(material, visible) { // Makes the selected portrait side immune to winding/culling mistakes while keeping the opposite texture disabled.
    if (!material) return;
    if (material.side !== DOUBLE_SIDE) {
      material.side = DOUBLE_SIDE;
      material.needsUpdate = true;
    }
    material.visible = visible;
    material.transparent = true;
    if (visible && Number(material.opacity) <= 0) material.opacity = 1;
  }

  function cameraRelativePortraitFace(context) { // Chooses front/back from the camera's true position in the posed avatar's own local coordinates.
    const { model, camera } = context;
    if (!camera?.position?.clone || !model?.worldToLocal) return null;
    model.updateWorldMatrix?.(true, true);
    camera.updateWorldMatrix?.(true, false);
    const cameraWorld = camera.getWorldPosition ? camera.getWorldPosition(camera.position.clone()) : camera.position.clone();
    const cameraLocal = model.worldToLocal(cameraWorld); // Local +Z is the canonical portrait-front side used by PNGPlaneAvatar.
    const previous = faceState.get(model);
    const width = Number(model.userData?.portraitModelWidth) || Number(model.userData?.gameModelWidth) || 1;
    const hysteresis = Math.max(0.001, width * 0.008); // Avoids rapid front/back flicker while orbiting exactly edge-on.
    let face = previous?.face || (cameraLocal.z >= 0 ? 'front' : 'back');
    if (cameraLocal.z > hysteresis) face = 'front';
    else if (cameraLocal.z < -hysteresis) face = 'back';
    const next = { face, cameraLocalZ: cameraLocal.z };
    faceState.set(model, next);
    return next;
  }

  function enforceCameraRelativePortraitFace() { // Guarantees one correct portrait side is visible even if another wrapper changed culling or material visibility.
    const context = currentContext();
    if (!context?.camera) return null;
    const resolved = cameraRelativePortraitFace(context);
    if (!resolved) return null;
    const parts = collectPortraitFaces(context.model);
    const showFront = resolved.face === 'front';
    for (const material of parts.frontMaterials) setFaceMaterial(material, showFront);
    for (const material of parts.backMaterials) setFaceMaterial(material, !showFront);
    for (const mesh of parts.frontMeshes) mesh.visible = showFront;
    for (const mesh of parts.backMeshes) mesh.visible = !showFront;

    const hasFront = parts.frontMaterials.length > 0 || parts.frontMeshes.length > 0;
    const hasBack = parts.backMaterials.length > 0 || parts.backMeshes.length > 0;
    context.model.userData = context.model.userData || {};
    context.model.userData.hobunjiGroundCarryPortraitFace = {
      selected: resolved.face,
      cameraLocalZ: resolved.cameraLocalZ,
      frontMaterials: parts.frontMaterials.length,
      backMaterials: parts.backMaterials.length,
      frontMeshes: parts.frontMeshes.length,
      backMeshes: parts.backMeshes.length,
      hasFront,
      hasBack,
      fixedLegSolver: typeof window.LegBones?.solveFixedTwoBoneChain === 'function',
      rule: 'camera-local Z selects one portrait side; skinned slot 0=front and slot 1=back; selected material is DoubleSide',
    }; // Existing mobile model dumps can inspect exactly what the face controller found.

    const signature = `${resolved.face}:${parts.frontMaterials.length}:${parts.backMaterials.length}:${parts.frontMeshes.length}:${parts.backMeshes.length}`;
    if (lastFaceModel !== context.model || lastFaceName !== resolved.face || lastFaceSignature !== signature) {
      const faceMessage = `portrait ${resolved.face.toUpperCase()} · local Z ${resolved.cameraLocalZ.toFixed(3)} · F ${parts.frontMaterials.length}/${parts.frontMeshes.length} · B ${parts.backMaterials.length}/${parts.backMeshes.length} · fixed solver ${typeof window.LegBones?.solveFixedTwoBoneChain === 'function' ? 'yes' : 'no'}`;
      const status = document.getElementById('statusPill');
      if (status) {
        status.textContent = `Ground / Carry ${faceMessage}`;
        status.className = hasFront && hasBack ? 'pill good' : 'pill warn';
      }
      editorLog(faceMessage, hasFront && hasBack ? 'info' : 'warn');
      lastFaceModel = context.model;
      lastFaceName = resolved.face;
      lastFaceSignature = signature;
    }
    return context.model.userData.hobunjiGroundCarryPortraitFace;
  }

  function softenTorsoRadiusGuide() { // Keeps the anatomy radius useful without drawing an opaque blue shell over the avatar.
    const scene = window.HobunjiGameplayBackdrop?.getScene?.();
    if (!scene) return false;
    let changed = false;
    scene.traverse?.((node) => {
      const name = String(node?.name || '').toLowerCase();
      if (!node?.material || !(name === 'torso_radius_guide' || name.includes('torso') && name.includes('radius'))) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material) continue;
        material.transparent = true;
        material.opacity = Math.min(Number.isFinite(Number(material.opacity)) ? Number(material.opacity) : 0.16, 0.16);
        material.wireframe = true;
        material.depthTest = true;
        material.depthWrite = false;
        material.needsUpdate = true;
      }
      node.userData = node.userData || {};
      node.userData.hobunjiGroundCarryNonOccludingGuide = true;
      changed = true;
    });
    return changed;
  }

  function compatibilityFrame() { // Runs after rebuilds/camera movement without touching the procedural editor's private state.
    captureBaseline();
    enforceCameraRelativePortraitFace();
    softenTorsoRadiusGuide();
    requestAnimationFrame(compatibilityFrame);
  }

  // This script is intentionally loaded before procedural-limb-pose-author.js.
  // Registration order means fresh avatar rebuilds are protected before the
  // Ground / Carry listener can apply a pose with a zero Y rotation.
  editorLog(`compatibility layer v6 booting from ${SCRIPT_URL?.href || 'document-relative source'}`);
  const fixedLegSolverReady = ensureBranchFixedLegSolver(); // Exported below so other Ground / Carry code and diagnostics can await one canonical bootstrap.
  window.addEventListener('hobunji-backdrop-avatar-changed', () => {
    captureBaseline();
    lastFaceModel = null;
    lastFaceName = '';
    lastFaceSignature = '';
  });
  window.addEventListener('hobunji-backdrop-api-ready', captureBaseline, { once: true });
  captureBaseline();
  requestAnimationFrame(compatibilityFrame);

  window.HobunjiProceduralLimbFacingPreserver = {
    version: 6,
    ready: fixedLegSolverReady,
    captureBaseline,
    ensureBranchFixedLegSolver,
    enforceCameraRelativePortraitFace,
    softenTorsoRadiusGuide,
    getBaselineYaw: () => {
      const poseRoot = currentPoseRoot();
      return poseRoot ? baselines.get(poseRoot) ?? null : null;
    },
    getFaceDebug: () => currentContext()?.model?.userData?.hobunjiGroundCarryPortraitFace || null,
  };
})();
