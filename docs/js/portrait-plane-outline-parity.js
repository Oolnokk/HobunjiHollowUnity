// Keeps the flat portrait plane's occlusion-depth draws on the exact transform used
// by its ordinary visible draw.
//
// game.js's outline/held-item pipeline redraws PNG-plane avatars (depth-only,
// colorWrite=false) twice more per frame so their silhouette can occlude 3D held
// items and tools appropriately (_renderPngPlaneOutlineOccluderDepth, and
// held-object-render-order.js's own non-ground depth rebuild). Both of those
// depth-only passes are classified as "secondary" by outline-render-performance.js
// and run with scene.autoUpdate=false as a performance optimization. Confirmed live
// that this leaves the portrait's own matrixWorld stuck at a stale, differently-
// rotated pose during those passes specifically (e.g. yaw 19deg on the visible base
// draw vs 59deg on the depth-only redraws immediately after, same mesh, same frame) —
// so the reconstructed occlusion silhouette lands in the wrong place whenever the
// body is turned by composer channels (weapon-idle-stance body yaw, drunk sway, ...),
// incorrectly masking outline geometry (hands, feet) that should be fully visible.
// Mirrors procedural-hand-outline-parity.js / procedural-feet-outline-parity.js for
// the same class of bug, keyed on colorWrite instead of an override-material shader
// signature since these depth-only passes don't use one.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const avatarApi = global.PNGPlaneAvatar;
  if (!THREE || !avatarApi?.buildSinglePlaneAvatarModel || avatarApi.buildSinglePlaneAvatarModel.__hobunjiPortraitOutlineParityWrapped) return;

  const SHOULDER_PERCH_MIRROR_STORAGE_KEY = 'hobunjiMirrorShoulderPerchWithPortrait'; // Persists whether authored shoulder pixels follow the presentation-only horizontal portrait flip.
  let mirrorShoulderPerchWithPortrait = true; // Current behavior stays the default; disabling restores the pre-fix unmirrored authored pixel X.
  try {
    const saved = global.localStorage?.getItem?.(SHOULDER_PERCH_MIRROR_STORAGE_KEY);
    if (saved !== null && saved !== undefined) mirrorShoulderPerchWithPortrait = saved !== '0';
  } catch (_) {}

  function setMirrorShoulderPerchWithPortrait(enabled, options = {}) {
    mirrorShoulderPerchWithPortrait = !!enabled;
    if (options.persist !== false) {
      try { global.localStorage?.setItem?.(SHOULDER_PERCH_MIRROR_STORAGE_KEY, mirrorShoulderPerchWithPortrait ? '1' : '0'); } catch (_) {}
    }
    const checkbox = global.document?.getElementById?.('settingMirrorShoulderPerchWithPortrait');
    if (checkbox && checkbox.checked !== mirrorShoulderPerchWithPortrait) checkbox.checked = mirrorShoulderPerchWithPortrait;
    return mirrorShoulderPerchWithPortrait;
  }

  function installShoulderPerchMirrorSetting() {
    const doc = global.document;
    if (!doc || doc.getElementById('settingMirrorShoulderPerchWithPortrait')) return;
    const rotationSelect = doc.getElementById('settingShoulderPetRotationSource');
    const rotationRow = rotationSelect?.closest?.('.settings-row');
    if (!rotationRow?.parentNode) return;

    const row = doc.createElement('label');
    row.className = 'settings-row';
    row.innerHTML = `
      <div class="settings-label">
        <div class="settings-name">Mirror Shoulder-Pet Perch with Portrait</div>
        <div class="settings-desc">When PNG portraits are horizontally flipped, mirror the authored shoulder-perch pixel to the matching visible shoulder. Turn this off to keep the original authored pixel X.</div>
      </div>
      <span class="settings-toggle"><input type="checkbox" id="settingMirrorShoulderPerchWithPortrait"><span class="toggle-slider"></span></span>`;
    rotationRow.parentNode.insertBefore(row, rotationRow);
    const checkbox = row.querySelector('#settingMirrorShoulderPerchWithPortrait');
    checkbox.checked = mirrorShoulderPerchWithPortrait;
    checkbox.addEventListener('change', event => setMirrorShoulderPerchWithPortrait(event.target.checked));
  }

  function applyDefaultShoulderPetFrontXray() {
    const checkbox = global.document?.getElementById?.('settingDisableShoulderFrontXray');
    if (!checkbox || checkbox.dataset.hobunjiDefaultApplied === '1') return;
    checkbox.dataset.hobunjiDefaultApplied = '1';
    checkbox.checked = true; // Default presentation: the front character sprite occludes the shoulder pet instead of allowing the pet to X-ray through it.
    checkbox.dispatchEvent(new global.Event('change', { bubbles: true })); // game.js owns the actual shoulder-pet layering state; drive its existing listener rather than duplicating that state here.
  }

  function installShoulderPetPresentationDefaults() {
    installShoulderPerchMirrorSetting();
    applyDefaultShoulderPetFrontXray();
  }

  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', installShoulderPetPresentationDefaults, { once: true });
    else installShoulderPetPresentationDefaults();
  }

  // The shared source-pixel resolver in png-plane-avatar.js is also a render-parity
  // path: it must reproduce the SkinnedMesh shader's deformation on the CPU before
  // converting the result to world space. The old implementation multiplied a
  // local portrait point by bone.matrixWorld * boneInverse and then called
  // localToWorld() on that already-world-transformed result, effectively applying
  // the player's world transform twice. That is why a shoulder perch near the
  // player could resolve tens of world units away. Reproduce Three.js r128's
  // actual skinning sequence instead: bindMatrix -> weighted bone matrices ->
  // bindMatrixInverse -> mesh localToWorld.
  function installSkinnedPixelCpuParity() {
    if (avatarApi.__hobunjiSkinnedPixelCpuParityInstalled) return;

    function resolvePosition(avatarRoot, sourcePixel) {
      const portraitRoot = avatarApi.resolveSkinnedPortraitRoot?.(avatarRoot) || avatarRoot;
      const rig = portraitRoot?.userData?.neckRig;
      const skinnedPlane = rig?.skinnedPlane;
      const skeleton = skinnedPlane?.skeleton;
      if (!rig?.available || !skinnedPlane?.isSkinnedMesh || !skeleton?.bones?.length) return null;

      const sourceCanvas = portraitRoot.userData?.sourceCanvas;
      const pixelWidth = Number(sourceCanvas?.naturalWidth || sourceCanvas?.width);
      const pixelHeight = Number(sourceCanvas?.naturalHeight || sourceCanvas?.height);
      const modelWidth = Number(portraitRoot.userData?.portraitModelWidth);
      const modelHeight = Number(portraitRoot.userData?.portraitModelHeight);
      const pixelX = Number(sourcePixel?.x);
      const pixelY = Number(sourcePixel?.y);
      if (![pixelWidth, pixelHeight, modelWidth, modelHeight, pixelX, pixelY].every(Number.isFinite)
        || pixelWidth <= 0 || pixelHeight <= 0 || modelWidth <= 0 || modelHeight <= 0) return null;

      const renderedPixelX = mirrorShoulderPerchWithPortrait && avatarApi.getPortraitsFlipped?.()
        ? pixelWidth - pixelX
        : pixelX; // Toggle off preserves the authored source X exactly as it behaved before portrait-aware perch mirroring.
      const localPoint = new THREE.Vector3(
        -modelWidth / 2 + (renderedPixelX / pixelWidth) * modelWidth,
        modelHeight / 2 - (pixelY / pixelHeight) * modelHeight,
        0,
      );
      const blendHeight = Math.max(
        modelHeight * .012,
        Number(skinnedPlane.geometry?.userData?.blendHeight) || modelHeight * .30,
      );
      const neckY = Number(rig.neckLocal?.y) || 0;
      const t = Math.max(0, Math.min(1, (localPoint.y - (neckY - blendHeight * .55)) / blendHeight));
      const headWeight = t * t * (3 - 2 * t);

      // updateMatrixWorld (not only updateWorldMatrix) is intentional here:
      // SkinnedMesh's override refreshes bindMatrixInverse in attached bind mode,
      // exactly as the renderer does before evaluating the skinning shader.
      portraitRoot.updateMatrixWorld?.(true);
      skinnedPlane.updateMatrixWorld?.(true);
      skeleton.update?.();

      const bindPoint = localPoint.clone().applyMatrix4(skinnedPlane.bindMatrix);
      const deformed = new THREE.Vector3();
      const bonePoint = new THREE.Vector3();
      const boneMatrix = new THREE.Matrix4();
      const weights = [1 - headWeight, headWeight];
      for (let i = 0; i < Math.min(2, skeleton.bones.length); i++) {
        const weight = weights[i] || 0;
        if (!weight) continue;
        if (skeleton.boneMatrices?.length >= (i + 1) * 16) {
          boneMatrix.fromArray(skeleton.boneMatrices, i * 16);
        } else {
          const bone = skeleton.bones[i];
          const boneInverse = skeleton.boneInverses?.[i];
          if (!bone || !boneInverse) continue;
          bone.updateWorldMatrix?.(true, false);
          boneMatrix.multiplyMatrices(bone.matrixWorld, boneInverse);
        }
        bonePoint.copy(bindPoint).applyMatrix4(boneMatrix);
        deformed.addScaledVector(bonePoint, weight);
      }
      deformed.applyMatrix4(skinnedPlane.bindMatrixInverse);
      return skinnedPlane.localToWorld(deformed);
    }

    function resolveFrame(avatarRoot, sourcePixel) {
      const center = resolvePosition(avatarRoot, sourcePixel);
      if (!center) return null;
      const pixelX = Number(sourcePixel?.x);
      const pixelY = Number(sourcePixel?.y);
      if (![pixelX, pixelY].every(Number.isFinite)) return null;
      const left = resolvePosition(avatarRoot, { x: pixelX - 1, y: pixelY });
      const right = resolvePosition(avatarRoot, { x: pixelX + 1, y: pixelY });
      const down = resolvePosition(avatarRoot, { x: pixelX, y: pixelY + 1 });
      const up = resolvePosition(avatarRoot, { x: pixelX, y: pixelY - 1 });
      if (!left || !right || !down || !up) return null;

      const tangent = right.clone().sub(left);
      const vertical = up.clone().sub(down);
      if (tangent.lengthSq() < 1e-10 || vertical.lengthSq() < 1e-10) return null;
      tangent.normalize();
      vertical.addScaledVector(tangent, -vertical.dot(tangent));
      if (vertical.lengthSq() < 1e-10) return null;
      vertical.normalize();
      const normal = tangent.clone().cross(vertical).normalize();
      const basis = new THREE.Matrix4().makeBasis(tangent, vertical, normal);
      return {
        position: center,
        quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
        tangent,
        vertical,
        normal,
      };
    }

    avatarApi.resolveSkinnedPixelWorldPosition = resolvePosition;
    avatarApi.resolveSkinnedPixelWorldFrame = resolveFrame;
    avatarApi.__hobunjiSkinnedPixelCpuParityInstalled = true;
  }
  installSkinnedPixelCpuParity();

  const PNG_PLANE_OUTLINE_OCCLUDER_LAYER = 4; // Mirrors game.js's own _markPngPlane/_renderPngPlaneOutlineOccluderDepth constant.
  const MAX_SNAPSHOT_AGE_MS = 160; // Allows the adjacent base->depth-replay sequence without accepting old frames.
  const RESCAN_INTERVAL_MS = 100; // game.js's own _markPngPlane call (which enables the layer bit below) runs synchronously right after build, but poll briefly in case that ordering ever changes.
  const RESCAN_ATTEMPTS = 20; // ~2s.

  const activeRoots = new Set();
  let baseMatrixCaptures = 0;
  let lockedDepthDraws = 0;
  let missedDepthSnapshots = 0;

  function isVisibleDraw(scene, material) {
    return !scene?.overrideMaterial && material?.colorWrite !== false;
  }

  function isOcclusionDepthPass(scene, material) {
    return !scene?.overrideMaterial && material?.colorWrite === false;
  }

  function installMeshHook(mesh) {
    if (!mesh?.isMesh || mesh.userData?.__hobunjiPortraitOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Last matrix used by an ordinary visible draw.
      visibleCapturedAt: -Infinity, // Timestamp paired with visibleMatrixWorld for adjacency validation.
      restoreStack: [], // Supports grouped/multiple draw callbacks without leaking a temporary occlusion-pass matrix.
    };

    mesh.onBeforeRender = function portraitOutlineParityBefore(...args) {
      previousBefore?.apply(this, args);
      const scene = args[1];
      const material = args[4];
      const now = performance.now();

      if (isVisibleDraw(scene, material)) {
        state.visibleMatrixWorld.copy(this.matrixWorld);
        state.visibleCapturedAt = now;
        state.restoreStack.push(null);
        baseMatrixCaptures++;
        return;
      }

      if (!isOcclusionDepthPass(scene, material)) {
        state.restoreStack.push(null);
        return;
      }

      const ageMs = now - state.visibleCapturedAt;
      if (!(ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS)) {
        state.restoreStack.push(null);
        missedDepthSnapshots++;
        return;
      }

      // Object3D.onBeforeRender runs before WebGLRenderer derives modelViewMatrix
      // and normalMatrix. Replacing matrixWorld here therefore freezes this
      // depth-only redraw to the exact transform that produced the visible portrait.
      state.restoreStack.push(this.matrixWorld.clone());
      this.matrixWorld.copy(state.visibleMatrixWorld);
      lockedDepthDraws++;
    };

    mesh.onAfterRender = function portraitOutlineParityAfter(...args) {
      previousAfter?.apply(this, args);
      const restoreMatrix = state.restoreStack.pop();
      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);
    };

    mesh.userData.__hobunjiPortraitOutlineParity = true;
    return true;
  }

  const PNG_PLANE_OUTLINE_OCCLUDER_MASK = (1 << PNG_PLANE_OUTLINE_OCCLUDER_LAYER) >>> 0;
  function hasOccluderLayer(mesh) {
    // THREE.Layers (r128) has no isEnabled(); membership is a raw mask bit test.
    return !!(Number(mesh?.layers?.mask ?? 0) & PNG_PLANE_OUTLINE_OCCLUDER_MASK);
  }

  function scanRoot(root) {
    root?.traverse?.(child => {
      if (child.isMesh && hasOccluderLayer(child)) installMeshHook(child);
    });
  }

  function rescanUntilStable(root, attempt = 0) {
    if (!activeRoots.has(root)) return;
    scanRoot(root);
    if (attempt >= RESCAN_ATTEMPTS) return;
    global.setTimeout?.(() => rescanUntilStable(root, attempt + 1), RESCAN_INTERVAL_MS);
  }

  const originalBuild = avatarApi.buildSinglePlaneAvatarModel;
  const wrappedBuild = function portraitOutlineParityBuild(...args) {
    const avatarRoot = originalBuild.apply(this, args);
    if (!avatarRoot) return avatarRoot;
    activeRoots.add(avatarRoot);
    rescanUntilStable(avatarRoot);
    return avatarRoot;
  };
  wrappedBuild.__hobunjiPortraitOutlineParityWrapped = true;
  avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;

  if (avatarApi.disposeAvatarModel && !avatarApi.disposeAvatarModel.__hobunjiPortraitOutlineParityWrapped) {
    const originalDispose = avatarApi.disposeAvatarModel.bind(avatarApi);
    avatarApi.disposeAvatarModel = function portraitOutlineParityDispose(avatarRoot) {
      activeRoots.delete(avatarRoot);
      return originalDispose(avatarRoot);
    };
    avatarApi.disposeAvatarModel.__hobunjiPortraitOutlineParityWrapped = true;
  }

  global.HobunjiPortraitOutlineParity = Object.freeze({
    SHOULDER_PERCH_MIRROR_STORAGE_KEY,
    getMirrorShoulderPerchWithPortrait: () => mirrorShoulderPerchWithPortrait,
    setMirrorShoulderPerchWithPortrait,
    getDebug() {
      return {
        activeRoots: activeRoots.size,
        baseMatrixCaptures,
        lockedDepthDraws,
        missedDepthSnapshots,
        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,
        skinnedPixelCpuParity: !!avatarApi.__hobunjiSkinnedPixelCpuParityInstalled,
        mirrorShoulderPerchWithPortrait,
        frontShoulderPetXrayDisabledByDefault: true,
      };
    },
  });
})(window);
