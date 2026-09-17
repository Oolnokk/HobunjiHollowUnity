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

  function syncOverlay(source, overlay) {
    if (!source || !overlay) return false;
    installRenderOrderFollower(source, overlay);
    if (!overlay.userData?.hobunjiShoulderRenderOrderFollower) {
      overlay.renderOrder = Number(source.renderOrder || 0) + INTRA_PET_RENDER_EPSILON;
    }
    overlay.visible = source.visible;
    overlay.frustumCulled = source.frustumCulled;
    if (source.layers && overlay.layers && Number.isFinite(source.layers.mask)) overlay.layers.mask = source.layers.mask;
    copyMaterialRenderState(source, overlay);
    overlay.userData = overlay.userData || {};
    overlay.userData.hobunjiShoulderSplitLayerParity = {
      sourceRenderOrder: source.renderOrder,
      overlayRenderOrder: overlay.renderOrder,
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

  window.HobunjiShoulderSplitLayerParity = { version: 2, syncAvatar, syncOverlay, install };
  install();
})();
