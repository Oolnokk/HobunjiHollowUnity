// Keeps split shoulder-pet halves inside the exact same x-ray/depth stack.
(() => {
  'use strict';

  const INTRA_PET_RENDER_EPSILON = 0.01; // Foreground half wins only against its paired half, never against the player layer above it.
  const MATERIAL_FIELDS = Object.freeze([
    'depthWrite','depthTest','depthFunc','colorWrite','opacity','transparent','alphaTest','blending',
    'blendSrc','blendDst','blendEquation','blendSrcAlpha','blendDstAlpha','blendEquationAlpha',
    'side','premultipliedAlpha','polygonOffset','polygonOffsetFactor','polygonOffsetUnits',
  ]);

  function materialsFor(mesh) {
    if (!mesh?.material) return [];
    return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  }

  function copyMaterialRenderState(source, overlay) {
    const sourceMaterials = materialsFor(source);
    const overlayMaterials = materialsFor(overlay);
    for (let i = 0; i < overlayMaterials.length; i++) {
      const src = sourceMaterials[Math.min(i, Math.max(0, sourceMaterials.length - 1))];
      const dst = overlayMaterials[i];
      if (!src || !dst) continue;
      let changed = false;
      for (const field of MATERIAL_FIELDS) {
        if (!(field in src) || dst[field] === src[field]) continue;
        dst[field] = src[field];
        changed = true;
      }
      if (changed) dst.needsUpdate = true;
    }
  }

  function pairedSource(group, overlay) {
    const face = overlay?.userData?.hobunjiPlaneFace;
    return (group?.children || []).find(child =>
      child !== overlay
      && !child?.userData?.hobunjiShoulderSplitOverlay
      && (!face || child?.userData?.hobunjiPlaneFace === face)
      && child?.isSkinnedMesh
    ) || null;
  }

  // Three.js sorts the render list before onBeforeRender fires. A periodic copy
  // can therefore put the foreground half in the old layer for one frame when
  // shoulder x-ray state changes. Make renderOrder itself follow the paired base
  // half so the sorter always sees petBase + epsilon immediately.
  function installRenderOrderFollower(source, overlay) {
    if (!source || !overlay || overlay.userData?.hobunjiShoulderRenderOrderFollower) return;
    overlay.userData = overlay.userData || {};
    let fallback = Number(overlay.renderOrder || 0);
    try {
      Object.defineProperty(overlay, 'renderOrder', {
        configurable: true,
        enumerable: true,
        get() {
          const sourceOrder = Number(source?.renderOrder);
          return (Number.isFinite(sourceOrder) ? sourceOrder : fallback) + INTRA_PET_RENDER_EPSILON;
        },
        set(value) {
          const parsed = Number(value); // Preserve a sane fallback if generic traversal code assigns the overlay directly.
          if (Number.isFinite(parsed)) fallback = parsed;
        },
      });
      overlay.userData.hobunjiShoulderRenderOrderFollower = true;
    } catch (_) {
      // Extremely old/hostile Object3D wrappers can reject property redefinition;
      // syncOverlay below still provides best-effort parity in that case.
    }
  }

  function syncOverlayTransform(source, overlay) {
    let changed = false; // Ensures the split copy's matrices update only when its source face actually moves or turns.
    for (const part of ['position', 'quaternion', 'scale']) {
      const sourcePart = source?.[part]; // Live source-plane transform, including the shoulder-only reversed facing.
      const overlayPart = overlay?.[part]; // Matching cloned transform; split geometry remains independently authored.
      if (!sourcePart || typeof overlayPart?.copy !== 'function'
          || (typeof overlayPart.equals === 'function' && overlayPart.equals(sourcePart))) continue;
      overlayPart.copy(sourcePart);
      changed = true;
    }
    if (changed) {
      overlay.matrixAutoUpdate = true;
      overlay.updateMatrix?.();
      overlay.matrixWorldNeedsUpdate = true;
      overlay.updateMatrixWorld?.(true); // onBeforeRender can run after scene traversal; avoid a stale orientation for one frame.
    }
  }

  function syncOverlay(source, overlay) {
    if (!source || !overlay) return false;
    syncOverlayTransform(source, overlay); // The split art must turn with the face plane, not keep its construction-time normal.
    installRenderOrderFollower(source, overlay);
    if (!overlay.userData?.hobunjiShoulderRenderOrderFollower) {
      overlay.renderOrder = Number(source.renderOrder || 0) + INTRA_PET_RENDER_EPSILON;
    }
    const requestedVisible = overlay.parent?.userData?.hobunjiShoulderRest?.splitOverlayVisible === true; // Shoulder presentation owns whether this helper layer exists at all; parity may only gate that request by the paired source face's visibility.
    overlay.visible = requestedVisible && source.visible !== false;
    overlay.frustumCulled = source.frustumCulled;
    if (source.layers && overlay.layers && Number.isFinite(source.layers.mask)) {
      const ownerStencilMask = 1 << 24; // The main held compositor owns private front-portrait stencil participation.
      overlay.layers.mask = (source.layers.mask & ~ownerStencilMask)
        | (overlay.userData?.hobunjiShoulderPetStencilForeground === true
          ? source.layers.mask & ownerStencilMask : 0); // Do not copy the source's front-stencil layer to a background split half.
    }
    copyMaterialRenderState(source, overlay);
    overlay.userData = overlay.userData || {};
    overlay.userData.hobunjiShoulderSplitLayerParity = {
      sourceRenderOrder: source.renderOrder,
      overlayRenderOrder: overlay.renderOrder,
      requestedVisible,
      sourceVisible: source.visible !== false,
      depthWrite: materialsFor(overlay)[0]?.depthWrite,
      depthTest: materialsFor(overlay)[0]?.depthTest,
      depthFunc: materialsFor(overlay)[0]?.depthFunc,
    };
    return true;
  }

  function syncAvatar(avatarRef) {
    const group = avatarRef?.group;
    if (!group) return 0;
    let count = 0;
    for (const overlay of group.children || []) {
      if (!overlay?.userData?.hobunjiShoulderSplitOverlay) continue;
      const source = pairedSource(group, overlay);
      if (!source) continue;
      const previous = overlay.onBeforeRender;
      if (!overlay.userData.hobunjiShoulderSplitLayerParityWrapped) {
        overlay.onBeforeRender = function shoulderSplitParityBeforeRender(...args) {
          syncOverlay(source, this); // Material/depth flags can still change dynamically; refresh them immediately before draw.
          return previous?.apply?.(this, args);
        };
        overlay.userData.hobunjiShoulderSplitLayerParityWrapped = true;
      }
      if (syncOverlay(source, overlay)) count++;
    }
    return count;
  }

  function install() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildAnimalPlaneAvatarModel || api.__shoulderSplitLayerParityInstalled) return false;
    const priorBuild = api.buildAnimalPlaneAvatarModel.bind(api);
    api.buildAnimalPlaneAvatarModel = function splitLayerParityAwareBuild(THREE, spriteUrl, options = {}) {
      const avatarRef = priorBuild(THREE, spriteUrl, options);
      syncAvatar(avatarRef);
      return avatarRef;
    };
    api.__shoulderSplitLayerParityInstalled = true;
    return true;
  }

  window.HobunjiShoulderSplitLayerParity = { version: 4, syncAvatar, syncOverlay, install };
  install();
})();
