// In-game pants garment: a 2D garment PNG skinned onto the avatar's legs.
//
// The Pants Rig Author (docs/tools/pants-rig-author) produces, per garment, a beltline, leg bones and a five-channel
// weight map, and per species/gender a portrait beltline + leg thickness (window.HOBUNJI_PANTS_RIGS, see
// docs/config/pants-rigs.js). This module turns that data into a deformable mesh parented to the avatar and, every
// frame, aligns the garment's 2D thigh/calf bones onto the live procedural 3D leg bones (js/pants-rig-core.js does the
// maths) and skins the mesh with the painted weights. The belt-weighted part stays rigid with the body.
//
// Owners (game.js: NPC walkers, the player avatar) call attach() once the avatar and its procedural legs exist,
// update() each frame right after the legs tick, setAppearance() when the worn item is re-dyed or re-woven, and
// dispose() with the avatar. The garment's art is rendered through ClothingWeavingSystem.renderClothingLayers so dye
// and weaving behave exactly like every other cloth garment.
(function (global) {
  'use strict';

  if (global.PantsGarmentRenderer) return;

  const HOOP_CORE = 0.03, HOOP_FADE = 0.07; // Distance (garment units) around an ankle spline that is fully rigid, and where that fades out.
  const SEGMENTS = 64; // Vertices per side of the garment grid: fine enough that weight transitions deform smoothly instead of faceting.
  const NPC_DEFAULT_PANTS_DYE = 'dye:CLOTH:brown'; // Same dye-reference format as the NPC overwear dye (appliedDyes.CLOTH).
  const PANTLESS_SPECIES = new Set(['omgurku']); // The hybrid lower body has no humanoid leg/pants rig.
  const DEFAULT_GARMENT_ID = 'pants_basic';
  const FALLBACK_CHARACTER_KEY = '__default'; // Species/gender without their own authored record share this fit.
  const DOUBLE_SIDE = 2;
  const MESH_NAME = 'PantsGarmentMesh';
  const handles = new Set(); // Live garments, for diagnostics.
  const REST_RECHECK_FRAMES = 30; // A still garment re-checks its legs' rest stance this often (any leg motion checks at once).
  const LEG_SIDES = Object.freeze(['left', 'right']), LEG_JOINTS = Object.freeze(['hip', 'knee', 'ankle']), BONE_NAMES = Object.freeze(['thigh', 'calf']); // Shared per-frame loop lists (no per-frame array literals).

  const core = () => global.HobunjiPantsRig || null;
  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const isPantlessSpecies = speciesId => PANTLESS_SPECIES.has(normalizeSpecies(speciesId));
  const normalizeGender = value => String(value || '').trim().toLowerCase();
  
  const characterKey = (speciesId, gender) => `${normalizeSpecies(speciesId)}::${normalizeGender(gender)}`;

  function rigConfig() {
    const source = global.HOBUNJI_PANTS_RIGS;
    return source && typeof source === 'object' ? source : { garments: {}, characters: {} };
  }

  function resolveCharacter(speciesId, gender) {
    const characters = rigConfig().characters || {};
    return characters[characterKey(speciesId, gender)] || characters[FALLBACK_CHARACTER_KEY] || null;
  }

  // The species' hip pivot and leg length in portrait-canvas terms, from the live legs through the portrait plane.
  function posteriorGeometry(THREE, model, plane, nodes) {
    const mapping = portraitMappingFor(THREE, model, plane);
    const hip = new THREE.Vector3(), ankle = new THREE.Vector3(), down = new THREE.Vector3();
    nodes.leftThigh.updateWorldMatrix?.(true, false);
    nodes.leftCalf.updateWorldMatrix?.(true, false);
    hip.setFromMatrixPosition(nodes.leftThigh.matrixWorld);
    const calfLength = Number(nodes.leftCalf.userData?.hobunjiCalfLength) > 0 ? Number(nodes.leftCalf.userData.hobunjiCalfLength) : Math.abs(nodes.leftCalf.position.y);
    down.set(0, -calfLength, 0).applyMatrix4(nodes.leftCalf.matrixWorld);
    ankle.copy(down);
    model.worldToLocal(hip);
    model.worldToLocal(ankle);
    const hipP = core().portraitPointForLocal(mapping, hip.x, hip.y), ankleP = core().portraitPointForLocal(mapping, ankle.x, ankle.y);
    return { posterior: hipP, ankleY: ankleP.y, legLength: Math.hypot(ankleP.x - hipP.x, ankleP.y - hipP.y) };
  }

  const hasAuthoredCharacter = (speciesId, gender) => !!(rigConfig().characters || {})[characterKey(speciesId, gender)];

  // The species' posterior (hip pivot) height as a portrait-canvas y: the live thigh origin through the portrait plane.
  function posteriorPortraitY(THREE, model, plane, nodes) {
    const mapping = portraitMappingFor(THREE, model, plane);
    nodes.leftThigh.updateWorldMatrix?.(true, false);
    const hip = new THREE.Vector3().setFromMatrixPosition(nodes.leftThigh.matrixWorld);
    model.worldToLocal(hip);
    return core().portraitPointForLocal(mapping, hip.x, hip.y).y;
  }

  function findPortraitPlane(model) {
    let preferred = null, fallback = null;
    model?.traverse?.(node => {
      if (!node?.isMesh || node.userData?.hobunjiPantsGarment || node.userData?.hobunjiPantsPreview || node.userData?.hobunjiAppliedPantsPreview) return;
      if (!fallback && node.geometry) fallback = node;
      const face = String(node.userData?.hobunjiPlaneFace || '').toLowerCase();
      const name = String(node.name || '').toLowerCase();
      if (!preferred && (face === 'front' || /front.*plane|plane.*front/.test(name) || node.isSkinnedMesh)) preferred = node;
    });
    return preferred || fallback;
  }

  function portraitDimensions(model, plane) {
    const parameters = plane?.geometry?.parameters || {};
    const width = Number(model?.userData?.portraitModelWidth) || Number(parameters.width) || 0.9;
    const height = Number(model?.userData?.portraitModelHeight) || Number(parameters.height) || width;
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function portraitsFlipped() {
    return global.PNGPlaneAvatar?.getPortraitsFlipped?.() === true; // The game mirrors every portrait texture by default; the garment geometry mirrors with it.
  }

  function findLegNodes(legHandle) {
    const group = legHandle?.group;
    if (!group?.getObjectByName) return null;
    const flipped = portraitsFlipped(); // Mirrored art puts the garment's image-left leg on the screen-right side, where the right_* nodes live.
    const nodes = {
      leftThigh: group.getObjectByName(flipped ? 'right_thigh' : 'left_thigh'),
      leftCalf: group.getObjectByName(flipped ? 'right_calf' : 'left_calf'),
      rightThigh: group.getObjectByName(flipped ? 'left_thigh' : 'right_thigh'),
      rightCalf: group.getObjectByName(flipped ? 'left_calf' : 'right_calf'),
    };
    return Object.values(nodes).every(Boolean) ? nodes : null;
  }

  // Where the portrait canvas sits in avatar-local space (Core.portraitMapping of its corners), through the real plane.
  function portraitMappingFor(THREE, model, plane) {
    const dimensions = portraitDimensions(model, plane);
    const flipped = portraitsFlipped();
    model.updateMatrixWorld?.(true);
    plane.updateMatrixWorld?.(true);
    const corner = (px, py) => {
      const point = new THREE.Vector3((flipped ? 0.5 - px : px - 0.5) * dimensions.width, (0.5 - py) * dimensions.height, 0.012);
      plane.localToWorld(point);
      model.worldToLocal(point);
      return { x: point.x, y: point.y };
    };
    return core().portraitMapping(corner(0, 0), corner(1, 0), corner(0, 1));
  }

  // Static part of the garment for one avatar: rest vertices, weights, 2D bones in avatar-local space.
  function buildGarmentData(THREE, Core, model, plane, garment, character) {
    const transform = Core.solveAffine(garment.pantsBeltSpline, character.portraitBeltSpline); // The art's beltline laid onto the portrait's.
    if (!transform) return null;
    const dimensions = portraitDimensions(model, plane);
    const weightGrid = garment.weightMap?.encoding === 'rle8' ? Core.decodeWeightGridRle(garment.weightMap) : garment.weightMap;
    const controls = Core.buildLegOpeningFitControls(garment, Number(character.legThickness) || 1);
    const flipped = portraitsFlipped();
    const vertexCount = (SEGMENTS + 1) * (SEGMENTS + 1);
    const positions = new Float32Array(vertexCount * 3);
    const basePositions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const weights = new Float32Array(vertexCount * 5);
    const indices = [];
    model.updateMatrixWorld?.(true);
    plane.updateMatrixWorld?.(true);
    const point = new THREE.Vector3();
    const placed = new THREE.Vector3();
    const placeOnPlane = (u, v) => { // PNG point -> leg-thickness fit -> belt affine -> portrait plane -> avatar-local.
      const displacement = Core.inverseDistanceDisplacement({ x: u, y: v }, controls.source, controls.target, 2);
      const fitted = { x: Core.clamp(u + displacement.x), y: Core.clamp(v + displacement.y) };
      const portrait = Core.applyAffine(transform, fitted);
      point.set((flipped ? 0.5 - portrait.x : portrait.x - 0.5) * dimensions.width, (0.5 - portrait.y) * dimensions.height, 0.012);
      placed.copy(point);
      plane.localToWorld(placed);
      model.worldToLocal(placed);
      return placed;
    };
    let vertex = 0;
    for (let row = 0; row <= SEGMENTS; row++) {
      const v = row / SEGMENTS;
      for (let col = 0; col <= SEGMENTS; col++, vertex++) {
        const u = col / SEGMENTS;
        placeOnPlane(u, v);
        basePositions[vertex * 3] = positions[vertex * 3] = placed.x;
        basePositions[vertex * 3 + 1] = positions[vertex * 3 + 1] = placed.y;
        basePositions[vertex * 3 + 2] = positions[vertex * 3 + 2] = placed.z;
        uvs[vertex * 2] = u;
        uvs[vertex * 2 + 1] = 1 - v;
        const sampled = Core.sampleWeights(weightGrid, u, v);
        let sum = 0;
        Core.WEIGHT_CHANNELS.forEach((channel, channelIndex) => {
          const value = Math.max(0, Number(sampled[channel]) || 0);
          weights[vertex * 5 + channelIndex] = value;
          sum += value;
        });
        if (!(sum > 0)) { weights[vertex * 5] = 1; sum = 1; }
        if (Math.abs(sum - 1) > 0.0001) for (let channelIndex = 0; channelIndex < 5; channelIndex++) weights[vertex * 5 + channelIndex] /= sum;
      }
    }
    // Draw order is index order within the mesh: the left half first, then the right half, so wherever the legs cross or run
    // parallel the right leg is drawn over the left.
    for (const [from, to] of [[0, SEGMENTS >> 1], [SEGMENTS >> 1, SEGMENTS]]) {
      for (let row = 0; row < SEGMENTS; row++) {
        for (let col = from; col < to; col++) {
          const a = row * (SEGMENTS + 1) + col, b = a + 1, c = a + SEGMENTS + 1, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.getAttribute('position').setUsage?.(THREE.DynamicDrawUsage);
    geometry.computeBoundingSphere();
    Core.sharpenWeights(weights, Math.min(8, Math.max(1, Number(character.skinSharpness) || 1.5))); // Strong initial 2D->3D alignment (see Core.sharpenWeights).
    // Everything at or above the beltline spline belongs to the belt (rigid, flat in the portrait plane, however the weights
    // were painted): the beltline never tilts or leaves the portrait's depth, even where no belt weight touches it.
    const beltPoints = [...garment.pantsBeltSpline].sort((p, q) => p.x - q.x);
    const beltYAt = u => {
      if (u <= beltPoints[0].x) return beltPoints[0].y;
      for (let i = 1; i < beltPoints.length; i++) {
        if (u <= beltPoints[i].x) { const t = (u - beltPoints[i - 1].x) / Math.max(1e-9, beltPoints[i].x - beltPoints[i - 1].x); return beltPoints[i - 1].y + (beltPoints[i].y - beltPoints[i - 1].y) * t; }
      }
      return beltPoints[beltPoints.length - 1].y;
    };
    for (let row = 0, v = 0; row <= SEGMENTS; row++) {
      for (let col = 0; col <= SEGMENTS; col++, v++) {
        if (row / SEGMENTS <= beltYAt(col / SEGMENTS) + 1e-6) { weights[v * 5] = 1; for (let c = 1; c < 5; c++) weights[v * 5 + c] = 0; }
      }
    }
    const legBones = Core.normalizeLegBones(garment.legBones);
    const bones2D = {};
    for (const side of ['left', 'right']) {
      bones2D[side] = {};
      for (const joint of ['hip', 'knee', 'ankle']) {
        const p = placeOnPlane(legBones[side][joint].x, legBones[side][joint].y);
        bones2D[side][joint] = { x: p.x, y: p.y, z: p.z };
      }
    }
    const beltCenter = { x: 0, y: 0 };
    for (const beltPoint of garment.pantsBeltSpline) {
      const p = placeOnPlane(beltPoint.x, beltPoint.y);
      beltCenter.x += p.x / garment.pantsBeltSpline.length;
      beltCenter.y += p.y / garment.pantsBeltSpline.length;
    }
    const beltSorted = [...garment.pantsBeltSpline].sort((p, q) => p.x - q.x);
    const beltEnds = { left: placeOnPlane(beltSorted[0].x, beltSorted[0].y).clone(), right: placeOnPlane(beltSorted[beltSorted.length - 1].x, beltSorted[beltSorted.length - 1].y).clone() };
    const origin = placeOnPlane(0, 0).clone();
    const across = placeOnPlane(1, 0).clone().sub(origin);
    const down = placeOnPlane(0, 1).clone().sub(origin);
    const normal = across.cross(down).normalize();
    const maskMapping = portraitMappingFor(THREE, model, plane); // portrait px/py (0..1) = inv * (local - origin)
    // Ankle rings: each leg opening (ankle spline) is a ring around its 3D bone like a ring around a tent pole. The ring's centre
    // vertex is kept ON the bone axis (see handle.update); this prepares which vertex that is and how strongly each other vertex
    // follows the correction (the leg's own half of the garment, easing in from the hip down to the knee, full from the knee down).
    const sampleAt = point => {
      const gx = Math.max(0, Math.min(1, point.x)) * SEGMENTS, gy = Math.max(0, Math.min(1, point.y)) * SEGMENTS;
      const x0 = Math.min(SEGMENTS - 1, Math.floor(gx)), y0 = Math.min(SEGMENTS - 1, Math.floor(gy));
      return { i: y0 * (SEGMENTS + 1) + x0, fx: gx - x0, fy: gy - y0 };
    };
    const rings = {};
    const smooth01 = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    for (const side of ['left', 'right']) {
      const opening = garment.legOpenings?.[side];
      if (!Array.isArray(opening) || opening.length < 2) continue;
      const influence = new Float32Array(vertexCount);
      const hipV = legBones[side].hip.y, kneeV = legBones[side].knee.y;
      for (let row = 0, i = 0; row <= SEGMENTS; row++) {
        const t = smooth01(hipV, kneeV, row / SEGMENTS);
        for (let col = 0; col <= SEGMENTS; col++, i++) {
          const half = side === 'left' ? 1 - smooth01(0.42, 0.58, col / SEGMENTS) : smooth01(0.42, 0.58, col / SEGMENTS);
          influence[i] = t * half;
        }
      }
      // The ankle spline is a rigid hoop: every vertex on or near it belongs entirely to its leg's calf, so the five spline points
      // (and the art around them) all take the identical transform and keep their relationship to each other exactly.
      const polyline = opening.map(p => ({ x: p.x, y: p.y }));
      const calfChannel = side === 'left' ? 2 : 4;
      const hoop = new Float32Array(vertexCount);
      for (let row = 0, i = 0; row <= SEGMENTS; row++) {
        for (let col = 0; col <= SEGMENTS; col++, i++) {
          const u = col / SEGMENTS, v = row / SEGMENTS;
          let best = Infinity;
          for (let k = 0; k + 1 < polyline.length; k++) {
            const a = polyline[k], b = polyline[k + 1], abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby;
            const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((u - a.x) * abx + (v - a.y) * aby) / len2)) : 0;
            best = Math.min(best, Math.hypot(u - (a.x + abx * t), v - (a.y + aby * t)));
          }
          const mask = 1 - smooth01(HOOP_CORE, HOOP_FADE, best);
          if (mask <= 0) continue;
          hoop[i] = mask;
          for (let c = 0; c < 5; c++) weights[i * 5 + c] = weights[i * 5 + c] * (1 - mask) + (c === calfChannel ? mask : 0);
          influence[i] = Math.max(influence[i], mask);
        }
      }
      // The ring is looped around the pole where the 2D calf bone crosses the spline (not at a spline vertex).
      const crossing = Core.boneSplineCrossing(legBones[side].knee, legBones[side].ankle, polyline);
      rings[side] = { crossing, anchor: sampleAt(crossing), influence };
    }
    // Debug splines: the belt spline and the two ankle (leg opening) splines, as bilinear samples of the skinned grid so they
    // show exactly where those authored curves currently sit on the deformed garment.
    const splines = {
      belt: { color: 0x9cff00, samples: (garment.pantsBeltSpline || []).map(sampleAt) },
      leftAnkle: { color: 0xffad12, samples: (garment.legOpenings?.left || []).map(sampleAt) },
      rightAnkle: { color: 0xffad12, samples: (garment.legOpenings?.right || []).map(sampleAt) },
    };
    for (const side of ['left', 'right']) if (rings[side]) splines[`${side}Pole`] = { color: 0xffffff, samples: [rings[side].anchor, rings[side].anchor] }; // The point each ring is looped around the 3D bone at.
    return { geometry, basePositions, weights, bones2D, beltCenter, beltEnds, maskMapping, rings, splines, planeNormal: { x: normal.x, y: normal.y, z: normal.z } };
  }

  // How far in front of the portrait plane the procedural feet reach (avatar-local +z). The garment is lifted past that so
  // it draws over the foot models (x-ray through the feet) instead of being hidden behind them.
  function footFrontLift(THREE, model, feet) {
    model.updateMatrixWorld?.(true);
    const corner = new THREE.Vector3();
    let front = -Infinity;
    for (const foot of feet) {
      foot.updateWorldMatrix?.(true, true);
      const box = new THREE.Box3().setFromObject(foot);
      if (box.isEmpty()) continue;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        corner.set(x, y, z);
        model.worldToLocal(corner);
        front = Math.max(front, corner.z);
      }
    }
    return Number.isFinite(front) ? Math.max(0, Math.min(0.3, front - 0.012 + 0.01)) : 0;
  }

  function makeScratch(THREE) {
    const joint = () => ({ x: 0, y: 0, z: 0 });
    const leg = () => ({ hip: joint(), knee: joint(), ankle: joint() });
    return { inverseModel: new THREE.Matrix4(), point: new THREE.Vector3(), bones3D: { left: leg(), right: leg() }, aim: { left: leg(), right: leg() }, ringShift: { x: 0, y: 0, z: 0 }, m4: new THREE.Matrix4(), frames: { left: { thigh: new Array(9).fill(0), calf: new Array(9).fill(0) }, right: { thigh: new Array(9).fill(0), calf: new Array(9).fill(0) } }, transforms: [null, null, null, null, null] };
  }

  // Live 3D leg bones in avatar-local space. Hip = thigh origin, knee = calf origin, ankle = calf origin + calf-down * calfLength.
  function readLiveBones(handle) {
    const { model, nodes, scratch } = handle;
    model.updateWorldMatrix?.(true, false);
    const inverseModel = scratch.inverseModel.copy(model.matrixWorld).invert();
    for (const [side, thigh, calf] of [['left', nodes.leftThigh, nodes.leftCalf], ['right', nodes.rightThigh, nodes.rightCalf]]) {
      thigh.updateWorldMatrix?.(true, false);
      calf.updateWorldMatrix?.(true, false);
      const bones = scratch.bones3D[side];
      scratch.point.setFromMatrixPosition(thigh.matrixWorld).applyMatrix4(inverseModel);
      bones.hip.x = scratch.point.x; bones.hip.y = scratch.point.y; bones.hip.z = scratch.point.z;
      scratch.point.setFromMatrixPosition(calf.matrixWorld).applyMatrix4(inverseModel);
      bones.knee.x = scratch.point.x; bones.knee.y = scratch.point.y; bones.knee.z = scratch.point.z;
      const calfLength = Number(calf.userData?.hobunjiCalfLength) > 0 ? Number(calf.userData.hobunjiCalfLength) : Math.abs(calf.position.y);
      scratch.point.set(0, -calfLength, 0).applyMatrix4(calf.matrixWorld).applyMatrix4(inverseModel);
      bones.ankle.x = scratch.point.x; bones.ankle.y = scratch.point.y; bones.ankle.z = scratch.point.z;
      for (const [name, node] of [['thigh', thigh], ['calf', calf]]) { // The bone's orientation frame in avatar-local space (row-major 3x3), for twist.
        const e = scratch.m4.multiplyMatrices(inverseModel, node.matrixWorld).elements, f = scratch.frames[side][name];
        for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) f[row * 3 + col] = e[col * 4 + row];
      }
    }
    return scratch.bones3D;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous'; // Required so the canvas stays readable for the recolor and the WebGL upload.
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load pants texture ${url}`));
      image.src = url;
    });
  }

  function garmentImageUrl(garment) {
    const path = String(garment?.image || 'assets/cosmetics/clothes/legs/pants_basic.png');
    return /^(https?:|data:|\.\/|\/)/i.test(path) ? path : `./${path}`;
  }

  // The garment art for the current dye/weave: the same renderer every cloth garment uses, falling back to the raw PNG.
  async function renderGarmentCanvas(garmentId, garment, appearance) {
    const weaving = global.ClothingWeavingSystem;
    if (weaving?.renderClothingLayers) {
      try {
        const rendered = await weaving.renderClothingLayers(garmentId, {
          primaryHex: appearance.primaryHex || null,
          secondaryHex: appearance.secondaryHex || null,
          patternHex: appearance.patternHex || '#ffffff',
          weaving: appearance.weaving || null,
          view: 'front',
          speciesId: appearance.speciesId,
          gender: appearance.gender,
        });
        if (rendered?.canvas) return rendered.canvas;
      } catch (_) { /* falls through to the plain PNG */ }
    }
    const layers = appearance.imageUrl ? [{ url: appearance.imageUrl }] : (garment.imageLayers || [{ url: garmentImageUrl(garment) }]); // Plain-art fallback keeps both sprites and their alignment if weaving is unavailable.
    const images = await Promise.all(layers.map(layer => loadImage(layer.url))); // Loads once for this appearance, outside the animation tick.
    const canvas = document.createElement('canvas');
    canvas.width = garment.sourceSize?.width || images[0].naturalWidth || images[0].width || 1;
    canvas.height = garment.sourceSize?.height || images[0].naturalHeight || images[0].height || 1;
    const context = canvas.getContext('2d'); // Composites original art only when the normal dye/weave path failed.
    images.forEach((image, index) => {
      const layout = layers[index].layout; // Same authored placement used by the loom and inventory compositor.
      if (layout) context.drawImage(image, layout.x || 0, layout.y || 0, layout.drawWidth, layout.drawHeight);
      else context.drawImage(image, 0, 0);
    });
    return canvas;
  }

  /**
   * Attach a pants garment to an avatar.
   * @param THREE            three.js namespace
   * @param opts.avatarGroup the avatar model (portrait plane lives under it); the garment mesh is parented to it
   * @param opts.legHandle   the ProceduralLegAnimation handle ({group, ...}) for this avatar
   * @param opts.speciesId, opts.gender
   * @param opts.appearance  {primaryHex, secondaryHex, patternHex, weaving}
   * @returns handle {update, setAppearance, dispose, mesh} or null when pants cannot be drawn for this avatar
   */
  function attach(THREE, { avatarGroup, legHandle, speciesId, gender, garmentId = DEFAULT_GARMENT_ID, appearance = {}, name = 'pants', overlayMask = null, garmentRecord = null, characterRecord = null, imageUrl = null, footObjects = null, debugSplines = false } = {}) {
    if (!characterRecord && isPantlessSpecies(speciesId)) return null; // The author's live preview (explicit records) can still show them.
    const Core = core();
    const garment = garmentRecord || rigConfig().garments?.[garmentId]; // The editor passes its live, unsaved authoring records here.
    let character = characterRecord || resolveCharacter(speciesId, gender);
    const plane = findPortraitPlane(avatarGroup);
    const nodes = findLegNodes(legHandle);
    if (!THREE || !Core || !garment || !character || !plane || !nodes) return null;
    if (!characterRecord && !hasAuthoredCharacter(speciesId, gender)) { // No authored beltline for this species: default to its posterior height (or the image edge if that is below the image).
      character = { ...character, portraitBeltSpline: Core.defaultBeltAtPosterior(posteriorPortraitY(THREE, avatarGroup, plane, nodes)) };
    }
    const feet = (footObjects || ['left_foot', 'right_foot'].map(foot => legHandle.group?.getObjectByName?.(foot))).filter(Boolean); // The procedural foot models.
    const footLift = footFrontLift(THREE, avatarGroup, feet);
    const data = buildGarmentData(THREE, Core, avatarGroup, plane, garment, character);
    if (!data) return null;
    const handle = {
      name, garmentId, model: avatarGroup, nodes, mesh: null, disposed: false, texture: null, material: null,
      geometry: data.geometry, basePositions: data.basePositions, weights: data.weights, bones2D: data.bones2D,
      beltCenter: data.beltCenter, beltEnds: data.beltEnds, planeNormal: data.planeNormal, rings: data.rings, splineSpec: data.splines, debugLines: null, showSplines: !!debugSplines,
      legRollGain: Math.min(4, Math.max(1, Number(character.legRollGain) || 2)),
      maskMapping: data.maskMapping, footLift, rest: null, restRaw: null, rotationScale: { left: 1, right: 1 }, restFrames: { left: {}, right: {} },
      maskUniforms: { uPantsDepthBias: { value: 0 }, uPantsMask: { value: null }, uPantsMaskOn: { value: 0 }, uPantsMaskO: { value: new THREE.Vector2(data.maskMapping.ox, data.maskMapping.oy) }, uPantsMaskInv: { value: new THREE.Vector4(...data.maskMapping.inv) } },
      scratch: makeScratch(THREE), appearance: { ...appearance, speciesId, gender, imageUrl }, renderToken: 0, ready: false, garment,
    };

    const depthBiasLimits=new Map(); // Scoped close-contact actions can suppress the cosmetic feet-covering pull without moving the garment or disabling depth tests.
    handle.setDepthBiasLimit=(owner,limit=null)=>{
      if(!owner)return false;
      if(limit==null)depthBiasLimits.delete(owner);
      else if(Number.isFinite(limit)&&limit>=0)depthBiasLimits.set(owner,limit);
      else return false;
      let bias=handle.depthBiasBase||0; // Restore the ordinary foot overlay automatically after the last scope releases it.
      for(const value of depthBiasLimits.values())bias=Math.min(bias,value);
      handle.maskUniforms.uPantsDepthBias.value=bias;
      return true;
    };
    const createMesh = canvas => {
      const surface = global.HobunjiSpritePngSurface;
      const texture = surface?.makeCanvasTexture ? surface.makeCanvasTexture(THREE, canvas, `${name}-pants`) : new THREE.CanvasTexture(canvas);
      // The garment is a real 3D plane like the portrait's own front/back planes: depth-tested AND depth-writing, so whatever is nearer the camera covers
      // whatever is behind it, with no other rule (a leg turned behind the portrait is hidden by it; a turned leg's own faces occlude each other).
      // The small polygon offset is only a tie-breaker for the coplanar rest pose.
      const overrides = { side: DOUBLE_SIDE, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
      const material = surface?.makeMaterial ? surface.makeMaterial(THREE, texture, `${name}-pants`, overrides) : new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.01, ...overrides });
      // Pixels covered by arm/overwear/pauldron/hood art stay in front of the pants: the portrait underneath shows through there.
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, handle.maskUniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vPantsLocal;\nuniform float uPantsDepthBias;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPantsLocal = position.xy;')
          // Depth-only pull toward the camera: the garment stays exactly in the portrait plane on screen and in space, but
          // wins the depth test against the procedural feet, so it reads over (x-rays through) them.
          .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 pantsBiased = projectionMatrix * (mvPosition + vec4(0.0, 0.0, uPantsDepthBias, 0.0)); gl_Position.z = pantsBiased.z / pantsBiased.w * gl_Position.w; }');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vPantsLocal;\nuniform sampler2D uPantsMask;\nuniform float uPantsMaskOn;\nuniform vec2 uPantsMaskO;\nuniform vec4 uPantsMaskInv;')
          .replace('#include <alphatest_fragment>', 'if (uPantsMaskOn > 0.5) { vec2 pd = vPantsLocal - uPantsMaskO; vec2 pc = vec2(uPantsMaskInv.x * pd.x + uPantsMaskInv.y * pd.y, uPantsMaskInv.z * pd.x + uPantsMaskInv.w * pd.y); float pantsInside = step(0.0, pc.x) * step(pc.x, 1.0) * step(0.0, pc.y) * step(pc.y, 1.0); diffuseColor.a *= 1.0 - pantsInside * texture2D(uPantsMask, vec2(pc.x, 1.0 - pc.y)).a; }\n#include <alphatest_fragment>');
      };
      material.customProgramCacheKey = () => 'pantsOverlayMask';
      return { texture, material };
    };

    handle.setAppearance = async next => {
      handle.appearance = { ...handle.appearance, ...next };
      const token = ++handle.renderToken;
      let canvas;
      try { canvas = await renderGarmentCanvas(garmentId, garment, handle.appearance); } catch (error) { console.warn('[PantsGarmentRenderer] could not render garment art', error); return false; }
      if (handle.disposed || token !== handle.renderToken) return false;
      const { texture, material } = createMesh(canvas);
      if (!handle.mesh) {
        const mesh = new THREE.Mesh(handle.geometry, material);
        mesh.name = MESH_NAME;
        mesh.renderOrder = 28;
        mesh.frustumCulled = false;
        mesh.userData.hobunjiPantsGarment = true;
        mesh.userData.hobunjiPantsPreview = true; // Also keeps the editor's Apply-to-NPC mesh builder from mistaking this for the portrait plane.
        avatarGroup.add(mesh);
        handle.mesh = mesh;
      } else {
        handle.material?.dispose?.();
        handle.texture?.dispose?.();
        handle.mesh.material = material;
      }
      handle.texture = texture;
      handle.material = material;
      handle.ready = true;
      return true;
    };

    handle.setOverlayMask = canvas => {
      handle.maskTexture?.dispose?.();
      handle.maskTexture = null;
      handle.maskUniforms.uPantsMaskOn.value = 0;
      if (!canvas) return;
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      handle.maskTexture = texture;
      handle.maskUniforms.uPantsMask.value = texture;
      handle.maskUniforms.uPantsMaskOn.value = 1;
    };

    // Rest pose: the legs' initial stance. The garment's initial warp maps its 2D bones onto this pose with a purely planar
    // deformation (flat, at the portrait plane's depth); only the legs' motion AWAY from it, including pitch, becomes 3D.
    // `rest` holds the amplified bones flattened to the garment's depth; `restRaw` keeps their true depth for the per-joint
    // depth correction applied to the live bones.
    const makeJoints = () => ({ left: { hip: { x: 0, y: 0, z: 0 }, knee: { x: 0, y: 0, z: 0 }, ankle: { x: 0, y: 0, z: 0 } }, right: { hip: { x: 0, y: 0, z: 0 }, knee: { x: 0, y: 0, z: 0 }, ankle: { x: 0, y: 0, z: 0 } } });
    // Analytic standing stance in avatar-local space (straight legs from each hip down to its idle foot), plus the orientation frame
    // of a leg pointing straight down (the leg group's own axes).
    const restScratch = { bones: { left: makeJoints().left, right: makeJoints().right }, frame: new Array(9).fill(0), signature: '' };
    const restStanceBones = h => {
      const raw = legHandle.getRestStance?.();
      if (!raw || !legHandle.group) return null;
      const legs = portraitsFlipped() ? { left: raw.right, right: raw.left } : raw; // Same left/right swap as findLegNodes: mirrored art puts the garment's left leg on the right_* leg.
      h.model.updateWorldMatrix?.(true, false);
      legHandle.group.updateWorldMatrix?.(true, false);
      const inverseModel = h.scratch.inverseModel.copy(h.model.matrixWorld).invert();
      const toModel = (p, out) => { h.scratch.point.set(p.x, p.y, p.z).applyMatrix4(legHandle.group.matrixWorld).applyMatrix4(inverseModel); out.x = h.scratch.point.x; out.y = h.scratch.point.y; out.z = h.scratch.point.z; };
      for (const side of ['left', 'right']) {
        const bones = restScratch.bones[side];
        toModel(legs[side].hip, bones.hip);
        toModel(legs[side].ankle, bones.ankle);
        bones.knee.x = (bones.hip.x + bones.ankle.x) / 2; bones.knee.y = (bones.hip.y + bones.ankle.y) / 2; bones.knee.z = (bones.hip.z + bones.ankle.z) / 2;
      }
      const e = h.scratch.m4.multiplyMatrices(inverseModel, legHandle.group.matrixWorld).elements;
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) restScratch.frame[row * 3 + col] = e[col * 4 + row];
      return restScratch;
    };
    handle.rest = makeJoints();
    handle.restRaw = makeJoints();
    handle.captureRest = () => {
      // The rest stance is the legs' pose at this moment (a fresh avatar stands idle). The garment is bound to it: at rest every
      // vertex sits exactly where the art puts it, and only the motion away from this pose moves the garment.
      const stance = restStanceBones(handle); // The legs' standing stance when the leg system can say what it is, else their pose right now.
      const measured = stance ? stance.bones : readLiveBones(handle);
      if (stance) { handle.lastStance = []; for (const side of ['left', 'right']) for (const joint of ['hip', 'ankle']) handle.lastStance.push(stance.bones[side][joint].x, stance.bones[side][joint].y, stance.bones[side][joint].z); } // Raw stance the rebind check compares against.
      for (const side of ['left', 'right']) {
        for (const name of ['thigh', 'calf']) handle.restFrames[side][name] = (stance ? stance.frame : handle.scratch.frames[side][name]).slice();
        Core.amplifyLegRoll(measured[side], handle.legRollGain, handle.restRaw[side]);
        for (const joint of ['hip', 'knee', 'ankle']) {
          const raw = handle.restRaw[side][joint], flat = handle.rest[side][joint];
          flat.x = raw.x; flat.y = raw.y; flat.z = handle.bones2D[side][joint].z; // Flat, at the portrait plane's depth.
        }
      }
      // The whole garment, the ankle rings included, takes the bone's full rotation (no damping).
      handle.restCaptured = true;
    };

    // Live bones for this frame: roll-amplified like the rest pose, with depth made relative to rest so that at rest they
    // coincide exactly with the flattened rest bones.
    const legSignature = aim => {
      let signature = 0;
      for (const side of LEG_SIDES) {
        const leg = aim[side], frames = handle.scratch.frames[side];
        for (const joint of LEG_JOINTS) signature = signature * 1.0000001 + leg[joint].x * 3.1 + leg[joint].y * 5.3 + leg[joint].z * 7.7;
        for (const name of BONE_NAMES) for (let k = 0; k < 9; k++) signature = signature * 1.0000001 + frames[name][k] * (k + 1.7);
      }
      return signature;
    };
    handle.restRecheckIn = REST_RECHECK_FRAMES;
    // The roll amplification exaggerates a leg's sideways splay so face-on pants visibly follow it, but a sunk weapon stance splits the feet
    // fore/aft under a body twist, which leans that split into the sideways axis and doubles it: the pant legs drift off the bones. Fade the
    // exaggeration out as the stance sinks so the garment sits exactly on the real bones (legHandle.getStanceDrop, js/procedural-leg-animation.js).
    const effectiveRollGain = () => {
      const drop = Number(legHandle.getStanceDrop?.()) || 0;
      if (drop <= 0) return handle.legRollGain;
      const blend = Math.min(1, drop / Math.max(1e-6, (Number(legHandle.modelHeight) || 1) * 0.01));
      return handle.legRollGain + (1 - handle.legRollGain) * blend;
    };
    const aimAtLiveLegs = () => {
      const measured = readLiveBones(handle);
      const aim = handle.scratch.aim;
      for (const side of ['left', 'right']) {
        Core.amplifyLegRoll(measured[side], effectiveRollGain(), aim[side]);
        for (const joint of ['hip', 'knee', 'ankle']) aim[side][joint].z += handle.bones2D[side][joint].z - handle.restRaw[side][joint].z;
      }
      return aim;
    };
    // One fit: the art sits on the portrait exactly as authored (belt affine) and is bound to the 3D legs at their rest stance, so
    // at rest the pants are the art as placed and only the legs' motion since rest rotates them (about the art's own joints).
    const boneTransform = (side, from, to, aim) => Core.alignBoneBind(handle.bones2D[side][from], handle.rest[side][from], handle.rest[side][to], aim[side][from], aim[side][to], { rotationScale: handle.rotationScale[side], twist: Core.boneTwistAngle(handle.restFrames[side][from === 'hip' ? 'thigh' : 'calf'], handle.scratch.frames[side][from === 'hip' ? 'thigh' : 'calf']) }); // Rolling the bone about its own axis rolls what is bound to it (the ankle ring keeps its orientation relative to the calf).

    // Debug rendering of the belt and ankle splines on the deformed garment (lines + a dot per control point; the ankle ring
    // centres, the vertices locked to the 3D bones, are drawn larger).
    const ensureDebugLines = () => {
      if (handle.debugLines) return;
      handle.debugLines = {};
      for (const [name, spec] of Object.entries(handle.splineSpec)) {
        if (!spec.samples.length) continue;
        const count = spec.samples.length;
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: spec.color, depthTest: false, transparent: true }));
        const pointGeometry = new THREE.BufferGeometry();
        pointGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        const points = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: spec.color, size: 7, sizeAttenuation: false, depthTest: false, transparent: true }));
        for (const object of [line, points]) { object.renderOrder = 1000; object.frustumCulled = false; object.userData.hobunjiPantsDebug = true; handle.model.add(object); }
        handle.debugLines[name] = { line, points, lineGeometry, pointGeometry };
      }
    };
    const updateDebugSplines = () => {
      ensureDebugLines();
      const pos = handle.geometry.getAttribute('position').array;
      const stride = SEGMENTS + 1;
      for (const [name, spec] of Object.entries(handle.splineSpec)) {
        const entry = handle.debugLines[name];
        if (!entry) continue;
        const lineArray = entry.lineGeometry.getAttribute('position').array, pointArray = entry.pointGeometry.getAttribute('position').array;
        spec.samples.forEach((sample, index) => {
          const a = sample.i * 3, b = (sample.i + 1) * 3, c = (sample.i + stride) * 3, d = (sample.i + stride + 1) * 3;
          for (let k = 0; k < 3; k++) {
            const top = pos[a + k] + (pos[b + k] - pos[a + k]) * sample.fx, bottom = pos[c + k] + (pos[d + k] - pos[c + k]) * sample.fx;
            lineArray[index * 3 + k] = pointArray[index * 3 + k] = top + (bottom - top) * sample.fy;
          }
        });
        entry.lineGeometry.getAttribute('position').needsUpdate = true;
        entry.pointGeometry.getAttribute('position').needsUpdate = true;
        entry.line.visible = entry.points.visible = true;
      }
    };
    handle.setDebugSplines = on => {
      handle.showSplines = !!on;
      handle.dirty = true;
      if (!handle.showSplines && handle.debugLines) for (const entry of Object.values(handle.debugLines)) entry.line.visible = entry.points.visible = false;
    };

    handle.update = () => {
      if (handle.disposed || !handle.mesh || !handle.model.parent) return;
      const visible = handle.model.visible !== false && legHandle.group?.visible !== false;
      if (handle.mesh.visible !== visible) handle.mesh.visible = visible;
      if (!visible) return;
      if (!handle.restCaptured) handle.captureRest();
      let aim = aimAtLiveLegs();
      // Standing still (most NPCs, most of the time) nothing about the legs changes: skip the skin + upload when this frame's
      // bones and orientation frames are identical to the last frame's.
      let signature = legSignature(aim);
      // The leg group may be repositioned/rescaled after attach (placement, seats): rebind to the stance as it is now. Moving
      // the group also moves the live bones (so the signature changes); a still NPC only re-checks every REST_RECHECK_FRAMES.
      if (legHandle.getRestStance && handle.lastStance && (signature !== handle.lastSignature || handle.dirty || --handle.restRecheckIn <= 0)) {
        handle.restRecheckIn = REST_RECHECK_FRAMES;
        const stance = restStanceBones(handle);
        let moved = 0, k = 0;
        for (const side of ['left', 'right']) for (const joint of ['hip', 'ankle']) { const p = stance.bones[side][joint]; moved = Math.max(moved, Math.abs(p.x - handle.lastStance[k]), Math.abs(p.y - handle.lastStance[k + 1]), Math.abs(p.z - handle.lastStance[k + 2])); k += 3; }
        if (moved > 2e-4) { handle.captureRest(); handle.alignToRest(); handle.dirty = true; aim = aimAtLiveLegs(); signature = legSignature(aim); } // aim offsets depend on the rest pose just captured.
      }
      if (signature === handle.lastSignature && !handle.dirty) return;
      handle.lastSignature = signature;
      handle.dirty = false;
      const transforms = handle.scratch.transforms; // Channel order is Core.WEIGHT_CHANNELS: belt, leftThigh, leftCalf, rightThigh, rightCalf.
      transforms[0] = null; // The waistband is rigid, exactly as authored.
      transforms[1] = boneTransform('left', 'hip', 'knee', aim);
      transforms[2] = boneTransform('left', 'knee', 'ankle', aim);
      transforms[3] = boneTransform('right', 'hip', 'knee', aim);
      transforms[4] = boneTransform('right', 'knee', 'ankle', aim);
      const position = handle.geometry.getAttribute('position');
      Core.skinWeightedPositions(handle.basePositions, handle.weights, transforms, position.array);
      // The ring around the pole: slide each ankle ring's centre onto its 3D bone axis (closest point on the knee->ankle line) and
      // carry the rest of the ring, and the garment around it, along rigidly so the ring keeps its shape.
      const out = position.array;
      for (const side of ['left', 'right']) {
        const ring = handle.rings?.[side];
        if (!ring) continue;
        const shift = handle.scratch.ringShift, sm = ring.anchor, stride = SEGMENTS + 1;
        const a = sm.i * 3, b = (sm.i + 1) * 3, c = (sm.i + stride) * 3, d = (sm.i + stride + 1) * 3;
        const px = out[a] + (out[b] - out[a]) * sm.fx, qx = out[c] + (out[d] - out[c]) * sm.fx;
        const py = out[a + 1] + (out[b + 1] - out[a + 1]) * sm.fx, qy = out[c + 1] + (out[d + 1] - out[c + 1]) * sm.fx;
        const pz = out[a + 2] + (out[b + 2] - out[a + 2]) * sm.fx, qz = out[c + 2] + (out[d + 2] - out[c + 2]) * sm.fx;
        const ax = px + (qx - px) * sm.fy, ay = py + (qy - py) * sm.fy, az = pz + (qz - pz) * sm.fy; // Where the bone crosses the spline, on the skinned garment.
        if (!Core.offsetOntoAxis(ax, ay, az, aim[side].knee, aim[side].ankle, shift)) continue;
        const dx = shift.x, dy = shift.y, dz = shift.z;
        const influence = ring.influence;
        for (let i = 0; i < influence.length; i++) {
          const k = influence[i];
          if (k === 0) continue;
          out[i * 3] += dx * k; out[i * 3 + 1] += dy * k; out[i * 3 + 2] += dz * k;
        }
      }
      if (handle.showSplines) updateDebugSplines();
      position.needsUpdate = true; // frustumCulled is off, so no per-frame bounding-sphere work.
      if (handle.mesh.userData?.hobunjiPantsLitNormals) handle.geometry.computeVertexNormals(); // Lit ghoul trousers need current surface normals after each actual pose change, never per idle frame.
    };

    // Diagnostics: how exactly the garment's bones land on the live 3D bones this frame (depth-corrected, roll-amplified).
    handle.alignmentReport = () => {
      if (!handle.restCaptured) handle.captureRest();
      const aim = aimAtLiveLegs();
      const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, (p.z || 0) - (q.z || 0));
      const through = (t, p) => ({ x: t.m[0] * p.x + t.m[1] * p.y + t.m[2] * p.z + t.tx, y: t.m[3] * p.x + t.m[4] * p.y + t.m[5] * p.z + t.ty, z: t.m[6] * p.x + t.m[7] * p.y + t.m[8] * p.z + t.tz });
      const report = {};
      for (const side of ['left', 'right']) {
        const l = aim[side], f = handle.bones2D[side];
        const thigh = boneTransform(side, 'hip', 'knee', aim);
        const calf = boneTransform(side, 'knee', 'ankle', aim);
        report[side] = {
          length2D: { thigh: distance(f.hip, f.knee), calf: distance(f.knee, f.ankle) },
          length3D: { thigh: distance(l.hip, l.knee), calf: distance(l.knee, l.ankle) },
          stretch: { thigh: thigh.stretch, calf: calf.stretch },
          kneeMidpointError3D: distance(l.knee, Core.kneeAtMidpoint(l.hip, l.ankle)),
          hipError: distance(through(thigh, f.hip), l.hip),
          kneeErrorThigh: distance(through(thigh, f.knee), l.knee),
          kneeErrorCalf: distance(through(calf, f.knee), l.knee),
          ankleError: distance(through(calf, f.ankle), l.ankle),
          live3D: { hip: { ...l.hip }, knee: { ...l.knee }, ankle: { ...l.ankle } },
          rest2D: { hip: { ...f.hip }, knee: { ...f.knee }, ankle: { ...f.ankle } },
        };
      }
      return report;
    };

    handle.dispose = () => {
      if (handle.disposed) return;
      handle.disposed = true;
      handles.delete(handle);
      handle.mesh?.parent?.remove?.(handle.mesh);
      handle.geometry?.dispose?.();
      handle.material?.dispose?.();
      handle.texture?.dispose?.();
      handle.maskTexture?.dispose?.();
      if (handle.debugLines) for (const entry of Object.values(handle.debugLines)) {
        entry.line.parent?.remove?.(entry.line); entry.points.parent?.remove?.(entry.points);
        entry.lineGeometry.dispose?.(); entry.pointGeometry.dispose?.(); entry.line.material.dispose?.(); entry.points.material.dispose?.();
      }
      handle.debugLines = null;
      handle.mesh = null;
    };

    handle.model.updateMatrixWorld?.(true);
    const worldElements = handle.model.matrixWorld.elements;
    handle.depthBiasBase = 0; // No garment-wide pull toward the camera (it let the pants x-ray through the avatar's own planes); depth is pure proximity. Scoped limits (setDepthBiasLimit) still work.
    handle.maskUniforms.uPantsDepthBias.value = handle.depthBiasBase;
    handle.captureRest(); // The legs' stance at attach is the rest pose the initial 2D warp targets.
    handle.baseOriginal = new Float32Array(handle.basePositions); // The art as the portrait places it, before the alignment below (which is redone whenever the rest stance changes).
    handle.alignToRest = () => {
      handle.basePositions.set(handle.baseOriginal);
      // Initial alignment (purely 2D): each leg is a quad whose top is the beltline and whose bottom is its leg opening. The belt
      // stays exactly where the portrait puts it and the opening (ankle spline, shape and width intact) is moved onto the 3D ankle
      // at rest; everything in between is carried proportionally down the quad, so the pants stretch or compress to fit the leg.
      {
        const stride = SEGMENTS + 1, base = handle.basePositions;
        const sortedByX = points => [...points].sort((p, q) => p.x - q.x);
        const yAt = (points, u) => { // Piecewise-linear y of an x-sorted polyline, clamped at its ends.
          if (u <= points[0].x) return points[0].y;
          for (let i = 1; i < points.length; i++) if (u <= points[i].x) { const t = (u - points[i - 1].x) / Math.max(1e-9, points[i].x - points[i - 1].x); return points[i - 1].y + (points[i].y - points[i - 1].y) * t; }
          return points[points.length - 1].y;
        };
        const belt = sortedByX(garment.pantsBeltSpline);
        const sides = ['left', 'right'].map(side => {
          const ring = handle.rings?.[side], anchor = ring?.anchor;
          if (!anchor) return null;
          // Where the opening sits ALONG the bone: the art's bone may run past its opening (shin below the hem), and the 3D leg is
          // treated the same way, so the opening lands at the same fraction of the 3D bone rather than on its end.
          const bone = Core.normalizeLegBones(garment.legBones)[side], bx = bone.ankle.x - bone.knee.x, by = bone.ankle.y - bone.knee.y;
          const along = Math.max(0, Math.min(1, ((ring.crossing.x - bone.knee.x) * bx + (ring.crossing.y - bone.knee.y) * by) / Math.max(1e-9, bx * bx + by * by)));
          const knee3 = handle.rest[side].knee, ankle3 = handle.rest[side].ankle;
          const rest = { x: knee3.x + (ankle3.x - knee3.x) * along, y: knee3.y + (ankle3.y - knee3.y) * along };
          const at = k => { const i = anchor.i * 3 + k, j = (anchor.i + 1) * 3 + k, m = (anchor.i + stride) * 3 + k, n = (anchor.i + stride + 1) * 3 + k; const top = base[i] + (base[j] - base[i]) * anchor.fx, bottom = base[m] + (base[n] - base[m]) * anchor.fx; return top + (bottom - top) * anchor.fy; };
          return { opening: sortedByX(garment.legOpenings[side]), dx: rest.x - at(0), dy: rest.y - at(1) };
        });
        if (sides[0] && sides[1]) {
          const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
          // The seam between the legs lies strictly between the two openings, so each opening moves with its own leg alone and
          // keeps its shape (blending the legs across an opening would shear it).
          const leftInner = Math.max(...sides[0].opening.map(p => p.x)), rightInner = Math.min(...sides[1].opening.map(p => p.x));
          const seam0 = rightInner > leftInner + 1e-3 ? leftInner : (leftInner + rightInner) / 2 - 0.01, seam1 = rightInner > leftInner + 1e-3 ? rightInner : (leftInner + rightInner) / 2 + 0.01;
          const displace = (u, v) => {
            const leftShare = 1 - smooth(seam0, seam1, u);
            let dx = 0, dy = 0;
            sides.forEach((side, index) => {
              const top = yAt(belt, u), t = Math.max(0, Math.min(1, (v - top) / Math.max(1e-3, yAt(side.opening, u) - top)));
              const share = index === 0 ? leftShare : 1 - leftShare;
              dx += side.dx * t * share; dy += side.dy * t * share;
            });
            return [dx, dy];
          };
          const position = handle.geometry.getAttribute('position').array;
          for (let row = 0, i = 0; row <= SEGMENTS; row++) {
            for (let col = 0; col <= SEGMENTS; col++, i++) {
              const [dx, dy] = displace(col / SEGMENTS, row / SEGMENTS);
              base[i * 3] += dx; base[i * 3 + 1] += dy;
              position[i * 3] = base[i * 3]; position[i * 3 + 1] = base[i * 3 + 1];
            }
          }
        }
        for (const side of ['left', 'right']) for (const joint of ['hip', 'knee', 'ankle']) { const r = handle.rest[side][joint]; handle.bones2D[side][joint] = { x: r.x, y: r.y, z: r.z }; } // The 2D bones now lie on the 3D rest bones.
      }

    };
    handle.alignToRest();
    handles.add(handle);
    handle.readyPromise = handle.setAppearance({}); // Hostile builders wait for the garment before applying ghost or mine-light materials.
    if (overlayMask) Promise.resolve(overlayMask).then(canvas => { if (!handle.disposed) handle.setOverlayMask(canvas); }).catch(() => {});
    return handle;
  }

  // Coverage mask of the layers that must stay in front of the pants (arm clothing / overwear, pauldrons, hoods): the portrait
  // is rendered again without them and the pixels that differ are the mask. `fullCanvas` is the portrait as already
  // rendered for this avatar; `renderOptions` must match the options it was rendered with. Resolves null when the profile
  // wears none of those layers.
  async function buildOverlayMask(fullCanvas, profile, renderOptions = {}) {
    const preview = global.NpcAvatarPreview;
    const worn = group => !!group && (group.layers?.length || (group.id && group.id !== 'none'));
    if (!fullCanvas || !profile || !preview?.renderProfileToCanvas || !(worn(profile.armCosmetic) || worn(profile.torsoCosmetic) || worn(profile.pauldron) || worn(profile.hood))) return null;
    const width = fullCanvas.width, height = fullCanvas.height;
    const stripped = document.createElement('canvas');
    stripped.width = width;
    stripped.height = height;
    await preview.renderProfileToCanvas(stripped, { ...profile, armCosmetic: null, torsoCosmetic: null, pauldron: null, hood: null }, renderOptions);
    const full = fullCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const base = stripped.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const mask = document.createElement('canvas');
    mask.width = width;
    mask.height = height;
    const context = mask.getContext('2d');
    const out = context.createImageData(width, height);
    const firstRow = Math.floor(height * 0.35); // Pants never reach the head; ignore expression/hair differences up there.
    let covered = 0;
    for (let y = firstRow; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const delta = Math.abs(full[i] - base[i]) + Math.abs(full[i + 1] - base[i + 1]) + Math.abs(full[i + 2] - base[i + 2]) + Math.abs(full[i + 3] - base[i + 3]);
        if (delta > 24) { out.data[i + 3] = 255; covered++; }
      }
    }
    if (!covered) return null;
    context.putImageData(out, 0, 0);
    return mask;
  }

  // Attach pants to an avatar AND hook them into its procedural legs handle, so every existing place that ticks or
  // disposes the legs (NPC walkers, player, ragdoll playback, scene teardown) drives the garment without any other change:
  // legs.update() also updates the pants, legs.dispose() also disposes them.
  function attachToLegs(THREE, legs, options = {}) {
    if (!legs || legs.pants) return legs?.pants || null;
    const pants = attach(THREE, { ...options, legHandle: legs });
    if (!pants) return null;
    const originalUpdate = legs.update, originalDispose = legs.dispose;
    legs.pants = pants;
    legs.update = function updateWithPants(...args) {
      const result = typeof originalUpdate === 'function' ? originalUpdate.apply(this, args) : undefined;
      pants.update();
      return result;
    };
    legs.dispose = function disposeWithPants(...args) {
      pants.dispose();
      return typeof originalDispose === 'function' ? originalDispose.apply(this, args) : undefined;
    };
    return pants;
  }

  // Dye/weave inputs for one worn garment. Player: the equipped gear item. NPC: the PANTS body color its record's appliedDyes produce.
  function appearanceFromItem(item) {
    if (!item) return {};
    return { primaryHex: item.colorA?.hex || null, secondaryHex: item.colorB?.hex || item.colorA?.hex || null, patternHex: item.colorC?.hex || '#ffffff', weaving: item.weaving || null };
  }
  function appearanceFromBodyColors(bodyColors) {
    const primary = bodyColors?.PANTS?.hex || null;
    const secondary = bodyColors?.PANTS_B?.hex || primary;
    return { primaryHex: primary, secondaryHex: secondary, patternHex: bodyColors?.PANTS_C?.hex || '#ffffff', weaving: null };
  }

  // Pants and their dye are AUTHORED per NPC (equippedCosmetics 'pants_basic' + appliedDyes.PANTS in the NPC database, via the
  // authoring tools), so a record from the database is never touched here. This is only the fallback for runtime-generated
  // humanoids that have no authored record (no avatarEditor): they get the free pants, dyed like their overwear (brown without).
  function garmentForCosmetics(cosmetics) {
    return (cosmetics || []).find(id => !!rigConfig().garments?.[id]) || null;
  }

  function ensureNpcPants(rec, { garmentId = DEFAULT_GARMENT_ID, isAnimal = false, preferSpeciesGarment = true } = {}) {
    if (!rec || isAnimal || rec.noPants === true || rec.kind === 'animal' || rec.avatarEditor || isPantlessSpecies(rec.appearance?.speciesId || rec.speciesId || rec.species)) return false;
    if (!Array.isArray(rec.equippedCosmetics)) rec.equippedCosmetics = [];
    if (garmentForCosmetics(rec.equippedCosmetics)) return false;
    if (preferSpeciesGarment && garmentId === DEFAULT_GARMENT_ID && String(rec.appearance?.speciesId || rec.speciesId || rec.species).toLowerCase().replace(/_/g, '-') === 'mao-ao'
        && String(rec.appearance?.gender || rec.gender).toLowerCase() === 'female') garmentId = 'layered_skirt';
    rec.equippedCosmetics = [...rec.equippedCosmetics, garmentId];
    if (!rec.appliedDyes || typeof rec.appliedDyes !== 'object') rec.appliedDyes = {};
    if (!rec.appliedDyes.PANTS) rec.appliedDyes.PANTS = rec.appliedDyes.CLOTH || NPC_DEFAULT_PANTS_DYE;
    return true;
  }

  global.PantsGarmentRenderer = Object.freeze({
    attach,
    attachToLegs,
    buildOverlayMask,
    appearanceFromItem,
    appearanceFromBodyColors,
    ensureNpcPants,
    garmentForCosmetics,
    liveHandles: () => [...handles], // Diagnostics: every garment currently attached (headless game checks read alignmentReport() from these).
    resolveCharacter,
    posteriorPortraitYForAvatar: (THREE, avatarGroup, legGroup) => { const plane = findPortraitPlane(avatarGroup), nodes = findLegNodes({ group: legGroup }); return plane && nodes ? posteriorPortraitY(THREE, avatarGroup, plane, nodes) : null; },
    hasRigFor: (speciesId, gender, garmentId = DEFAULT_GARMENT_ID) => !!(rigConfig().garments?.[garmentId] && resolveCharacter(speciesId, gender)),
    debugSnapshot: () => ({ live: handles.size, garments: Object.keys(rigConfig().garments || {}), characters: Object.keys(rigConfig().characters || {}), lastChange: 'Scoped depth-bias limits keep close-contact garments behind other characters; ordinary feet-covering depth is restored when the action releases.' }),
  });
})(window);
