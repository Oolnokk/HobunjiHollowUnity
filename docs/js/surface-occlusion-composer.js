(() => {
  'use strict';

  // Shared surface semantics and per-effect occlusion decisions.
  // Rendering systems own their passes; this module owns the rules those
  // systems must agree on. New x-ray consumers (hats, portraits, chatheads,
  // outlines, hands, feet and equipment) should resolve through this API.
  const VERSION = 1;
  const WATER_DEPTH_ALPHA_THRESHOLD = 0.12;
  const SURFACE = Object.freeze({
    BASE_GROUND: 'base-ground',
    PATH: 'path',
    WALKABLE_FLOOR: 'walkable-floor',
    TOP_FACE_GROUND: 'top-face-ground',
    WATER: 'water',
    SLUSH: 'slush',
    SNOW: 'snow',
    BILLBOARD_GRASS: 'billboard-grass',
    SOLID: 'solid',
  });

  const GROUND_XRAY_KIND = Object.freeze({
    [SURFACE.BASE_GROUND]: 'terrain',
    [SURFACE.PATH]: 'road',
    [SURFACE.WALKABLE_FLOOR]: 'interior-floor',
  });
  const PROTECTED_COVERS = new Set([
    SURFACE.WATER,
    SURFACE.SLUSH,
    SURFACE.SNOW,
    SURFACE.BILLBOARD_GRASS,
  ]);
  const TINTABLE_COVERS = new Set([SURFACE.WATER, SURFACE.SLUSH]);
  const consumers = new Set();

  function someMaterial(material, predicate) {
    if (Array.isArray(material)) {
      for (let i = 0; i < material.length; i++) {
        const entry = material[i];
        if (entry && predicate(entry)) return true;
      }
      return false;
    }
    return !!material && predicate(material);
  }

  function hasAncestorFlag(object, key) {
    for (let node = object; node; node = node.parent) {
      if (node.userData?.[key] === true) return true;
    }
    return false;
  }

  function classifySurface(object, hints = {}) {
    if (!object?.isMesh || object.isSkinnedMesh) return SURFACE.SOLID;

    const data = object.userData || {};
    // Explicit translucent/solid cover tags take priority over path/ground
    // hints so a cover can never inherit an x-ray exemption from its parent.
    if (data.mergedWaterStatKey || data.waterSurfaceRole
        || data.waterfallSurfaceHeightMode || data.waterfallTexture) {
      return SURFACE.WATER;
    }

    if (data.environmentSurfaceMicroPlateau === true) {
      return someMaterial(object.material, material =>
        material?.userData?.environmentSurfaceMicroPlateauMaterial === 'slush')
        ? SURFACE.SLUSH
        : SURFACE.SNOW;
    }

    const grassBillboard = data.isWildernessGrassChunk === true
      || data.isRichFoliageBillboard === true
      || (object.isInstancedMesh && data.isBillboard === true)
      || someMaterial(object.material, material => !!(
        material?.isShaderMaterial
        && material.uniforms?.uGrassTex
        && material.uniforms?.uDensity
        && material.uniforms?.uStrength
      ));
    if (grassBillboard) return SURFACE.BILLBOARD_GRASS;

    if (hints.topFaceGround === true || data.hobunjiGroundTopFacesOnly === true) {
      return SURFACE.TOP_FACE_GROUND;
    }

    const pathSurface = typeof hints.pathSurface === 'boolean'
      ? hints.pathSurface
      : hasAncestorFlag(object, 'hobunjiPathSurface');
    if (pathSurface) return SURFACE.PATH;

    if (data.hachutuGroundRoot === true || hints.baseGround === true) {
      return SURFACE.BASE_GROUND;
    }

    const interiorFloorMaterial = someMaterial(object.material, material =>
      material?.userData?.hobunjiInteriorFloorMaterial === true);
    const authoredWalkableFloor = data.cavernWalkableFloor === true
      || (data.wallBuilderRecipe === 'wallrecipe2.json' && !!data.plateauModel?.levelByCell)
      || (data.liveRootFloor === true && data.ruinPreviewRole === 'floor');
    if (hints.walkableFloor === true || interiorFloorMaterial || authoredWalkableFloor) {
      return SURFACE.WALKABLE_FLOOR;
    }

    return SURFACE.SOLID;
  }

  function getGroundXrayKind(surface) {
    return GROUND_XRAY_KIND[surface] || null;
  }

  function isProtectedCover(surface) {
    return PROTECTED_COVERS.has(surface);
  }

  function isTintableCover(surface) {
    return TINTABLE_COVERS.has(surface);
  }

  function resolvePolicy(consumer, surface, context = {}) {
    const kind = typeof surface === 'string' ? surface : SURFACE.SOLID;
    const groundXrayKind = getGroundXrayKind(kind);
    const translucent = isTintableCover(kind);
    const depthAlphaThreshold = kind === SURFACE.WATER
      ? WATER_DEPTH_ALPHA_THRESHOLD
      : 0;

    return {
      consumer: String(consumer || 'unspecified'),
      surface: kind,
      groundXrayKind,
      groundXrayMode: groundXrayKind
        ? Number.isFinite(context.actorElevation)
          ? 'same-elevation-upward-faces'
          : 'fail-closed-solid'
        : 'solid',
      protectedCover: isProtectedCover(kind),
      tintableCover: translucent,
      skipPreOverlayDepthWhenTinting: translucent && context.translucentTintActive === true,
      restoreDepthAfterTint: translucent,
      coverageAwareDepth: kind === SURFACE.WATER,
      depthAlphaThreshold,
      shellUsesSameGroundPolicy: !!groundXrayKind,
    };
  }

  function registerConsumer(name) {
    const key = String(name || '').trim();
    if (!key) return false;
    consumers.add(key);
    return true;
  }

  function getDepthOnly(material) {
    const uniform = material?.uniforms?.uHobunjiSurfaceOcclusionDepthOnly;
    return uniform && 'value' in uniform ? uniform.value : undefined;
  }

  function setDepthOnly(material, enabled) {
    const uniform = material?.uniforms?.uHobunjiSurfaceOcclusionDepthOnly;
    if (!uniform || !('value' in uniform)) return undefined;
    const previous = uniform.value;
    uniform.value = enabled ? 1 : 0;
    return previous;
  }

  const api = {
    installed: true,
    VERSION,
    SURFACE,
    WATER_DEPTH_ALPHA_THRESHOLD,
    classifySurface,
    resolvePolicy,
    getGroundXrayKind,
    isProtectedCover,
    isTintableCover,
    registerConsumer,
    getDepthOnly,
    setDepthOnly,
    snapshot() {
      return {
        version: VERSION,
        waterDepthAlphaThreshold: WATER_DEPTH_ALPHA_THRESHOLD,
        consumers: [...consumers].sort(),
        surfaces: Object.values(SURFACE),
      };
    },
  };

  if (typeof window !== 'undefined') window.SurfaceOcclusionComposer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
