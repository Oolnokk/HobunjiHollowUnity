// Pants rig runtime data/driver adapter.
// The authoring tool produces the normalized belt, leg-opening, bone, and
// weight data this module consumes. Rendering can bind to these live drivers
// without re-deriving character anatomy or duplicating procedural-leg math.
(function (global) {
  'use strict';

  const activeBindings = new Set(); // Live pants-driver bindings reported by mobile diagnostics.
  let lastSnapshot = null; // Most recent binding/update summary shown without DevTools.

  function core() {
    return global.HobunjiPantsRig || null;
  }

  function config() {
    const source = global.HOBUNJI_PANTS_RIGS; // Repository-authored pants rig database.
    return source && typeof source === 'object' ? source : { garments: {}, characters: {} };
  }

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function normalizeGender(value) {
    return String(value || '').trim().toLowerCase();
  }

  function characterKey(speciesId, gender) {
    return `${normalizeSpecies(speciesId)}::${normalizeGender(gender)}`;
  }

  function garmentRecord(garmentId) {
    return config().garments?.[String(garmentId || '')] || null;
  }

  function characterRecord(speciesId, gender) {
    return config().characters?.[characterKey(speciesId, gender)] || null;
  }

  function resolveStaticFit(garmentId, speciesId, gender) {
    const Core = core(); // Shared fit math authored by the Pants Rig Author.
    const garment = garmentRecord(garmentId); // Garment-specific PNG-space controls.
    const character = characterRecord(speciesId, gender); // Species/gender thickness + portrait anchors.
    if (!Core || !garment || !character) return null;
    return {
      garment,
      character,
      controls: Core.buildLegOpeningFitControls(garment, Number(character.legThickness) || 1),
    };
  }

  function sourcePixel(point, portraitSize) {
    const size = Math.max(2, Number(portraitSize) || 200); // Canonical portrait pixel coordinate size.
    return {
      x: (Number(point?.x) || 0) * (size - 1),
      y: (Number(point?.y) || 0) * (size - 1),
    };
  }

  function resolveLiveBeltWorldPoints(avatarRoot, character, portraitSize = 200) {
    const resolver = global.PNGPlaneAvatar?.resolveSkinnedPixelWorldPosition; // Existing portrait CPU-skinning resolver; keeps the pants waist on the same deformed body pixels.
    if (typeof resolver !== 'function' || !avatarRoot || !character?.portraitBeltSpline) return null;
    const points = []; // Five live belt anchors in world space.
    for (const point of character.portraitBeltSpline) {
      const world = resolver(avatarRoot, sourcePixel(point, portraitSize)); // Current animated position of this authored portrait pixel.
      if (!world) return null;
      points.push(world.clone ? world.clone() : { x: world.x, y: world.y, z: world.z });
    }
    return points;
  }

  function findLegNodes(legHandle) {
    const group = legHandle?.group; // Existing ProceduralLegAnimation root returned by attach().
    if (!group?.getObjectByName) return null;
    const leftHip = group.getObjectByName('left_hip'); // Canonical procedural left hip node.
    const leftThigh = group.getObjectByName('left_thigh'); // Canonical procedural left thigh transform.
    const leftCalf = group.getObjectByName('left_calf'); // Canonical procedural left calf transform.
    const leftFoot = group.getObjectByName('left_foot'); // Canonical procedural left foot endpoint.
    const rightHip = group.getObjectByName('right_hip'); // Canonical procedural right hip node.
    const rightThigh = group.getObjectByName('right_thigh'); // Canonical procedural right thigh transform.
    const rightCalf = group.getObjectByName('right_calf'); // Canonical procedural right calf transform.
    const rightFoot = group.getObjectByName('right_foot'); // Canonical procedural right foot endpoint.
    if (![leftHip, leftThigh, leftCalf, leftFoot, rightHip, rightThigh, rightCalf, rightFoot].every(Boolean)) return null;
    return { leftHip, leftThigh, leftCalf, leftFoot, rightHip, rightThigh, rightCalf, rightFoot };
  }

  function matrixRelativeTo(THREE, node, parent) {
    if (!THREE?.Matrix4 || !node?.matrixWorld || !parent?.matrixWorld) return null;
    node.updateMatrixWorld?.(true);
    parent.updateMatrixWorld?.(true);
    const inverseParent = new THREE.Matrix4().copy(parent.matrixWorld).invert(); // Converts existing procedural-bone matrices into the avatar floor-root frame.
    return new THREE.Matrix4().multiplyMatrices(inverseParent, node.matrixWorld);
  }

  function captureLegMatrices(THREE, nodes, parent) {
    if (!nodes) return null;
    return {
      leftThigh: matrixRelativeTo(THREE, nodes.leftThigh, parent),
      leftCalf: matrixRelativeTo(THREE, nodes.leftCalf, parent),
      rightThigh: matrixRelativeTo(THREE, nodes.rightThigh, parent),
      rightCalf: matrixRelativeTo(THREE, nodes.rightCalf, parent),
    };
  }

  function makeDeltaMatrices(THREE, rest, current) {
    if (!rest || !current || !THREE?.Matrix4) return null;
    const deltas = {}; // Rest->current transform per authored pants weight channel.
    for (const channel of ['leftThigh', 'leftCalf', 'rightThigh', 'rightCalf']) {
      if (!rest[channel] || !current[channel]) return null;
      const inverseRest = new THREE.Matrix4().copy(rest[channel]).invert(); // Removes the captured neutral leg pose.
      deltas[channel] = new THREE.Matrix4().multiplyMatrices(current[channel], inverseRest);
    }
    return deltas;
  }

  function worldPointToParentLocal(THREE, parent, worldPoint) {
    if (!THREE?.Vector3 || !parent || !worldPoint) return null;
    parent.updateMatrixWorld?.(true);
    const local = new THREE.Vector3(worldPoint.x, worldPoint.y, worldPoint.z); // Mutable point converted into avatar-root local space.
    return parent.worldToLocal ? parent.worldToLocal(local) : local;
  }

  function createDriverBinding(THREE, {
    parent,
    avatarRoot = parent,
    legHandle,
    garmentId,
    speciesId,
    gender,
    portraitSize = 200,
  } = {}) {
    const Core = core(); // Shared authored-rig math.
    const garment = garmentRecord(garmentId); // Garment rig selected for this binding.
    const character = characterRecord(speciesId, gender); // Character beltline/thickness selected for this binding.
    const nodes = findLegNodes(legHandle); // Reuses the game's actual procedural leg transforms rather than inventing a second skeleton.
    if (!THREE || !parent || !Core || !garment || !character || !nodes) return null;
    const pantsToPortrait = Core.solveAffine(garment.pantsBeltSpline, character.portraitBeltSpline); // Neutral pants-PNG -> portrait mapping, with similarity fallback for nearly straight beltlines.
    if (!pantsToPortrait) return null;
    parent.updateMatrixWorld?.(true);
    const restLegMatrices = captureLegMatrices(THREE, nodes, parent); // Neutral leg pose used to calculate later bone deltas.
    const restBeltWorld = resolveLiveBeltWorldPoints(avatarRoot, character, portraitSize); // Neutral skinned portrait waist positions.
    if (!restLegMatrices || !restBeltWorld) return null;
    const restBeltLocal = restBeltWorld.map(point => worldPointToParentLocal(THREE, parent, point)); // Neutral waist anchors in pants render space.
    const binding = {
      garmentId: String(garmentId),
      speciesId: normalizeSpecies(speciesId),
      gender: normalizeGender(gender),
      parent,
      avatarRoot,
      legHandle,
      nodes,
      garment,
      character,
      portraitSize,
      pantsToPortrait,
      restLegMatrices,
      restBeltLocal,
      disposed: false,
      latest: null,
      update() {
        if (binding.disposed) return null;
        const liveBeltWorld = resolveLiveBeltWorldPoints(avatarRoot, character, portraitSize); // Five current body-deformed belt anchors.
        const currentLegMatrices = captureLegMatrices(THREE, nodes, parent); // Existing live procedural thigh/calf transforms.
        if (!liveBeltWorld || !currentLegMatrices) return null;
        const liveBeltLocal = liveBeltWorld.map(point => worldPointToParentLocal(THREE, parent, point)); // Current waist anchors in pants render space.
        const legDeltas = makeDeltaMatrices(THREE, restLegMatrices, currentLegMatrices); // Current rest-relative leg transforms.
        if (!legDeltas) return null;
        binding.latest = {
          liveBeltLocal,
          restBeltLocal,
          legDeltas,
          pantsToPortrait,
        };
        lastSnapshot = {
          garmentId: binding.garmentId,
          character: characterKey(binding.speciesId, binding.gender),
          beltAnchors: liveBeltLocal.length,
          legChannels: Object.keys(legDeltas),
          portraitSize,
        };
        return binding.latest;
      },
      dispose() {
        if (binding.disposed) return;
        binding.disposed = true;
        activeBindings.delete(binding);
      },
    };
    activeBindings.add(binding);
    binding.update();
    return binding;
  }

  function staticFitImageData(sourceImageData, garmentId, speciesId, gender) {
    const Core = core(); // Shared PNG warp implementation so author/runtime produce the same fit.
    const fit = resolveStaticFit(garmentId, speciesId, gender); // Species/gender opening targets.
    if (!Core || !fit || !sourceImageData?.data || !sourceImageData.width || !sourceImageData.height) return null;
    const pixels = Core.warpRgbaNearest(
      sourceImageData.data,
      sourceImageData.width,
      sourceImageData.height,
      fit.controls.source,
      fit.controls.target
    ); // One-time PNG-space deformation; callers cache the returned result per garment/species/gender.
    return {
      width: sourceImageData.width,
      height: sourceImageData.height,
      data: pixels,
      legThickness: fit.character.legThickness,
    };
  }

  function debugSnapshot() {
    return {
      schema: config().schema || null,
      garments: Object.keys(config().garments || {}),
      characters: Object.keys(config().characters || {}),
      activeBindings: activeBindings.size,
      lastBinding: lastSnapshot,
      portraitResolver: typeof global.PNGPlaneAvatar?.resolveSkinnedPixelWorldPosition === 'function',
      proceduralLegRuntime: !!global.ProceduralLegAnimation,
    };
  }

  global.PantsRigRuntime = Object.freeze({
    characterKey,
    garmentRecord,
    characterRecord,
    resolveStaticFit,
    resolveLiveBeltWorldPoints,
    findLegNodes,
    createDriverBinding,
    staticFitImageData,
    debugSnapshot,
  });

  global.__pantsRigRuntimeDebug = debugSnapshot; // Mobile-readable runtime status without opening DevTools.
})(typeof window !== 'undefined' ? window : globalThis);
