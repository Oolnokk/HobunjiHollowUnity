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
  const DEFAULT_SEGMENTS = 64; // Vertices per side of the garment grid: fine enough that weight transitions deform smoothly instead of faceting.
  const PANTS_REST_PLANE_Z = 0; // Garment rest art shares the portrait plane, rather than protruding through its front pixels.
  const NPC_SEGMENTS = 32; // Fallback for meshBudget:'npc' when PNGPlaneAvatar.meshBudget is absent; its table is the one place to tune this.
  const segmentsForBudget = mode => (mode === 'npc' ? (global.PNGPlaneAvatar?.meshBudget?.table?.npc?.pantsSegments || NPC_SEGMENTS) : DEFAULT_SEGMENTS);
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

  // The pants render parent can be a wrapper: find its child portrait's actual front canvas once at attachment.
  function portraitSourceCanvas(model, plane, supplied = null) {
    if (typeof supplied?.getContext === 'function') return supplied;
    const materials = Array.isArray(plane?.material) ? plane.material : [plane?.material]; // Read the same art for rigid or skinned portraits.
    const candidates = [model?.userData?.sourceCanvas, plane?.userData?.sourceCanvas,
      ...materials.map(material => material?.map?.image),
      plane?.parent?.userData?.sourceCanvas, plane?.parent?.parent?.userData?.sourceCanvas];
    const direct = candidates.find(canvas => typeof canvas?.getContext === 'function');
    if (direct) return direct;
    let nested = null; // One fallback traversal at garment creation, never per rendered frame.
    model?.traverse?.(node => { if (!nested && typeof node?.userData?.sourceCanvas?.getContext === 'function') nested = node.userData.sourceCanvas; });
    return nested;
  }

  const BELT_ALPHA_THRESHOLD = 128; // Ignore antialiased background when reading the actual visible torso width.

  // The authored five points specify where the waist belongs vertically, but may predate changes to the
  // species portrait. Compare against the *actual* connected opaque torso silhouette once at attach time.
  // Full Character Scale is applied on the common parent later, so it must not be applied to these points twice.
  function fitBeltToVisibleTorso(character, canvas) {
    const authored = character?.portraitBeltSpline; // Local portrait-normalized belt authoring, never mutated.
    if (!Array.isArray(authored) || authored.length !== 5 || !canvas?.getContext) return null;
    const width = Math.floor(Number(canvas.width)), height = Math.floor(Number(canvas.height)); // True source pixel grid, before whole-character scale.
    if (width < 8 || height < 8 || authored.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) return null;
    const leftX = Math.min(...authored.map(p => p.x)), rightX = Math.max(...authored.map(p => p.x)); // Reference belt span, not the garment art's fixed width.
    const authoredSpan = rightX - leftX; // Used to reject unrelated blobs and preserve intentional belt fit when no torso is measurable.
    if (!(authoredSpan > 0.05)) return null;
    const authoredCenter = (leftX + rightX) / 2; // Follows an asymmetrical torso instead of assuming portrait x=.5.
    const centerPixel = Math.max(0, Math.min(width - 1, Math.floor(authoredCenter * width))); // Seed for the connected alpha run.
    const authoredY = authored.reduce((sum, p) => sum + p.y, 0) / authored.length; // Waist's original vertical position remains authoritative.
    let ctx; // Portrait data source may be an image-backed or otherwise unreadable canvas; keep the authored fit in that case.
    try { ctx = canvas.getContext('2d', { willReadFrequently: true }); } catch (_) { return null; } // Read only small rows, not a whole 200x200 portrait.
    if (!ctx?.getImageData) return null;
    for (const offset of [0, 0.012, 0.025, 0.04, 0.06, 0.08]) { // A waist at the bottom image edge may require moving up to find connected torso pixels.
      const y = Math.max(0, Math.min(height - 1, Math.floor((authoredY - offset) * height))); // Search just above the authored belt, not near the head or arms.
      let pixels; // Current horizontal image row, read once for the candidate waist level.
      try { pixels = ctx.getImageData(0, y, width, 1).data; } catch (_) { return null; } // Tainted or unavailable 2D sources retain the authored fit.
      const solid = x => pixels[x * 4 + 3] >= BELT_ALPHA_THRESHOLD; // Find the torso's connected body, not isolated decorations.
      if (!solid(centerPixel)) continue;
      let left = centerPixel, right = centerPixel; // Grow a single connected silhouette outward from the belt centre.
      while (left > 0 && solid(left - 1)) left--;
      while (right < width - 1 && solid(right + 1)) right++;
      const span = (right + 1 - left) / width; // Width of real opaque pixels, normalized in the same space as authoring points.
      if (span < authoredSpan * 0.5 || span > authoredSpan * 1.8 || span >= 0.95) continue; // Skip centreline fragments, whole-row backdrops and arms.
      const center = (left + right + 1) / (2 * width); // Edge-to-edge centre, including the last opaque pixel's full width.
      const factor = span / authoredSpan; // Uniform x fit for all five points; retains the authored relative positions and y curvature.
      const fitted = authored.map(point => ({ x: center + (point.x - authoredCenter) * factor, y: point.y })); // Local width only; parent Full Character Scale remains separate.
      return { character: { ...character, portraitBeltSpline: fitted }, source: 'connected-torso-alpha', row: y, width: span, authoredWidth: authoredSpan, center, authoredCenter, factor }; // Preserve the original character; render-time taper consumes only these local X values.
    }
    return null; // Invisible/cropped/fragmented torso: prefer authored coordinates to guessing.
  }

  // Only the waist follows alpha width. Stop BEFORE the uppermost cuff spline (which may sit above the knee)
  // and its bilinear sample neighbours, or the foot-fit correction will inherit a wider cuff.
  function taperTorsoBeltPoint(portrait, garmentPoint, garment, torsoFit, prepared = null) {
    if (!torsoFit) return portrait;
    const belt = garment?.pantsBeltSpline; // Garment source-space waist curve used for the top of the tapered width field.
    if (!Array.isArray(belt) || belt.length < 2) return portrait;
    const points = prepared?.beltPoints || [...belt].sort((a, b) => a.x - b.x); // Render builds reuse a single sorted curve across the entire mesh.
    const x = garmentPoint.x; // Source image X, not deformed portrait X.
    let beltY = points[0].y; // Clamp outside the authored spline instead of extrapolating past its endpoints.
    for (let i = 1; i < points.length; i++) {
      if (x <= points[i].x) {
        const t = Math.max(0, Math.min(1, (x - points[i - 1].x) / Math.max(1e-9, points[i].x - points[i - 1].x)));
        beltY = points[i - 1].y + (points[i].y - points[i - 1].y) * t;
        break;
      }
      beltY = points[i].y;
    }
    const knees = prepared ? null : [garment?.legBones?.left?.knee?.y, garment?.legBones?.right?.knee?.y].filter(Number.isFinite); // Only resolve bones for stand-alone diagnostics calls.
    const kneeY = prepared ? prepared.kneeY : knees.length ? knees.reduce((sum, y) => sum + y, 0) / knees.length : beltY + 0.2; // No per-vertex bones allocation in the 65x65 garment mesh.
    const openings = prepared ? null : [...(garment?.legOpenings?.left || []), ...(garment?.legOpenings?.right || [])].map(p => p.y).filter(Number.isFinite); // An angled opening may reach ABOVE its knee.
    const openingMinY = prepared ? prepared.openingMinY : openings.length ? Math.min(...openings) : Infinity; // Earliest opening location in garment source space.
    const taperEndY = Math.min(kneeY, openingMinY - (prepared?.sampleMargin ?? 0.04)); // Stop BEFORE opening sample neighbours so cuff widths remain identical.
    const t = Math.max(0, Math.min(1, (garmentPoint.y - beltY) / Math.max(1e-6, taperEndY - beltY))); // 0 at waist, 1 before either calf ring begins.
    const influence = 1 - t * t * (3 - 2 * t); // Smooth taper joins the untouched leg fit without a hard seam.
    const desired = torsoFit.center + (portrait.x - torsoFit.authoredCenter) * torsoFit.factor; // Aligned to connected visible torso edges.
    return { x: portrait.x + (desired - portrait.x) * influence, y: portrait.y }; // Never modify the Y scale or depth used by the leg rig.
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
  function buildGarmentData(THREE, Core, model, plane, garment, character, SEGMENTS = DEFAULT_SEGMENTS, torsoFit = null) {
    const transform = Core.solveAffine(garment.pantsBeltSpline, character.portraitBeltSpline); // The art's beltline laid onto the portrait's.
    if (!transform) return null;
    const dimensions = portraitDimensions(model, plane);
    const waistPrepared = torsoFit ? (() => { // One small author-data preparation per garment, never per vertex or frame.
      const kneeYs = [garment?.legBones?.left?.knee?.y, garment?.legBones?.right?.knee?.y].filter(Number.isFinite); // Existing rig knees determine the taper endpoint.
      const openingYs = [...(garment?.legOpenings?.left || []), ...(garment?.legOpenings?.right || [])].map(p => p.y).filter(Number.isFinite); // The uppermost cuff node may be above knee Y.
      return { beltPoints: [...garment.pantsBeltSpline].sort((a, b) => a.x - b.x), kneeY: kneeYs.length ? kneeYs.reduce((sum, y) => sum + y, 0) / kneeYs.length : 0.5, openingMinY: openingYs.length ? Math.min(...openingYs) : Infinity, sampleMargin: 1 / SEGMENTS + 0.005 }; // Reserve one mesh row for bilinear sampling around the first cuff node.
    })() : null;
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
      const portrait = taperTorsoBeltPoint(Core.applyAffine(transform, fitted), { x: u, y: v }, garment, torsoFit, waistPrepared); // Adjust belt width but not knees/ankles.
      point.set((flipped ? 0.5 - portrait.x : portrait.x - 0.5) * dimensions.width, (0.5 - portrait.y) * dimensions.height, PANTS_REST_PLANE_Z);
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
    return { geometry, basePositions, weights, bones2D, beltCenter, beltEnds, maskMapping, rings, splines, beltFit: transform, planeNormal: { x: normal.x, y: normal.y, z: normal.z } };
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
    return Number.isFinite(front) ? Math.max(0, Math.min(0.3, front - PANTS_REST_PLANE_Z + 0.01)) : 0;
  }

  // ── GPU skinning ──────────────────────────────────────────────────────────────────────────────────────────────────────
  // The garment's per-frame deformation (linear-blend skin over the five weight channels, the two ankle-ring corrections and
  // the spine shift) runs in the vertex shader: the CPU only computes the four bone transforms and two ring shifts. The
  // position buffer holds the rest grid and is uploaded once per realignment instead of every frame the legs move. The
  // CPU path (Core.skinWeightedPositions) stays for debug splines, the rig author's preview (reads skinned positions), lit
  // garments (need fresh normals) and any material swapped in by another system (ghostify, mine-lit), whose shaders do not
  // carry the skinning code.
  const GPU_SKIN_VERTEX_DECLARATIONS = [
    'attribute vec3 pantsSpineShift;',
    'attribute vec4 pantsSkinW0;', // Weight channels belt, leftThigh, leftCalf, rightThigh (Core.WEIGHT_CHANNELS order).
    'attribute float pantsSkinW1;', // rightCalf.
    'attribute vec2 pantsRingInfluence;', // Left/right ankle-ring follow strength.
    'uniform float uPantsGpuSkin;',
    'uniform mat3 uPantsBoneM[4];',
    'uniform vec3 uPantsBoneT[4];',
    'uniform vec3 uPantsRingShift[2];',
  ].join('\n');
  const GPU_SKIN_VERTEX_BODY = [
    'if (uPantsGpuSkin > 0.5) {',
    '  vec3 pantsSkinned = pantsSkinW0.x * transformed',
    '    + pantsSkinW0.y * (uPantsBoneM[0] * transformed + uPantsBoneT[0])',
    '    + pantsSkinW0.z * (uPantsBoneM[1] * transformed + uPantsBoneT[1])',
    '    + pantsSkinW0.w * (uPantsBoneM[2] * transformed + uPantsBoneT[2])',
    '    + pantsSkinW1 * (uPantsBoneM[3] * transformed + uPantsBoneT[3]);',
    '  pantsSkinned += uPantsRingShift[0] * pantsRingInfluence.x + uPantsRingShift[1] * pantsRingInfluence.y;',
    '  vPantsLocal = pantsSkinned.xy;', // The mask lives in portrait space: skinned, before the spine carries it.
    '  transformed = pantsSkinned + pantsSpineShift;',
    '} else {',
    '  vPantsLocal = position.xy - pantsSpineShift.xy;', // CPU path: the buffer already includes the spine shift.
    '}',
  ].join('\n');
  let gpuSkinGlobal = true; // A/B switch for diagnostics (PantsGarmentRenderer.setGpuSkinning).

  function installGpuSkin(THREE, handle, enabled) {
    const count = handle.basePositions.length / 3, weights = handle.weights;
    const w0 = new Float32Array(count * 4), w1 = new Float32Array(count), ring = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      w0[i * 4] = weights[i * 5]; w0[i * 4 + 1] = weights[i * 5 + 1]; w0[i * 4 + 2] = weights[i * 5 + 2]; w0[i * 4 + 3] = weights[i * 5 + 3];
      w1[i] = weights[i * 5 + 4];
      ring[i * 2] = handle.rings?.left?.influence?.[i] || 0;
      ring[i * 2 + 1] = handle.rings?.right?.influence?.[i] || 0;
    }
    handle.geometry.setAttribute('pantsSkinW0', new THREE.BufferAttribute(w0, 4));
    handle.geometry.setAttribute('pantsSkinW1', new THREE.BufferAttribute(w1, 1));
    handle.geometry.setAttribute('pantsRingInfluence', new THREE.BufferAttribute(ring, 2));
    Object.assign(handle.maskUniforms, {
      uPantsGpuSkin: { value: 0 },
      uPantsBoneM: { value: [0, 1, 2, 3].map(() => new THREE.Matrix3()) },
      uPantsBoneT: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
      uPantsRingShift: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    });
    handle.gpuSkinOption = enabled !== false;
    handle.gpuSkinActive = false;
    handle.baseVersion = 0;
    handle.uploadedBaseVersion = -1;
    handle.gpuScratch = { point: new Float32Array(3), corner: new Float32Array(3), shift: { x: 0, y: 0, z: 0 } };
  }

  function gpuSkinUsable(handle) {
    const mesh = handle.mesh;
    return gpuSkinGlobal && handle.gpuSkinOption && !handle.showSplines && !!mesh && mesh.material === handle.material && mesh.userData?.hobunjiPantsLitNormals !== true;
  }

  function writeBoneUniform(matrix, translation, transform) {
    if (transform && transform.m) {
      const m = transform.m;
      matrix.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]); // Row-major, like Core.skinWeightedPositions.
      translation.set(transform.tx, transform.ty, transform.tz);
    } else if (transform) { // Planar affine: depth carried through.
      matrix.set(transform.a, transform.c, 0, transform.b, transform.d, 0, 0, 0, 1);
      translation.set(transform.tx, transform.ty, 0);
    } else {
      matrix.identity();
      translation.set(0, 0, 0);
    }
  }

  // One vertex of the CPU skin (identical maths to Core.skinWeightedPositions) plus the ring shifts applied so far.
  function skinVertexInto(handle, transforms, vertex, out, ringShifts, ringSidesDone) {
    const base = handle.basePositions, weights = handle.weights;
    const x = base[vertex * 3], y = base[vertex * 3 + 1], z = base[vertex * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let channel = 0; channel < 5; channel++) {
      const weight = weights[vertex * 5 + channel];
      if (!(weight > 0)) continue;
      const t = transforms[channel];
      if (t && t.m) { const m = t.m; ox += weight * (m[0] * x + m[1] * y + m[2] * z + t.tx); oy += weight * (m[3] * x + m[4] * y + m[5] * z + t.ty); oz += weight * (m[6] * x + m[7] * y + m[8] * z + t.tz); }
      else if (t) { ox += weight * (t.a * x + t.c * y + t.tx); oy += weight * (t.b * x + t.d * y + t.ty); oz += weight * z; }
      else { ox += weight * x; oy += weight * y; oz += weight * z; }
    }
    for (let s = 0; s < ringSidesDone; s++) {
      const k = handle.rings?.[LEG_SIDES[s]]?.influence?.[vertex] || 0;
      if (!k) continue;
      const shift = ringShifts[s];
      ox += shift.x * k; oy += shift.y * k; oz += shift.z * k;
    }
    out[0] = ox; out[1] = oy; out[2] = oz;
  }

  function writeGpuSkinUniforms(handle, transforms, aim) {
    const Core = core(), u = handle.maskUniforms;
    for (let channel = 1; channel < 5; channel++) writeBoneUniform(u.uPantsBoneM.value[channel - 1], u.uPantsBoneT.value[channel - 1], transforms[channel]);
    // The ankle rings are corrected in order (left, then right on top of it), exactly as the CPU path does: each needs the skinned
    // garment at its anchor, which is four vertices, so only those are skinned here.
    const stride = handle.segments + 1, scratch = handle.gpuScratch, p = scratch.point, c = scratch.corner, ringShifts = u.uPantsRingShift.value;
    for (let s = 0; s < 2; s++) {
      const side = LEG_SIDES[s], ring = handle.rings?.[side], shift = ringShifts[s];
      shift.set(0, 0, 0);
      if (!ring) continue;
      const sm = ring.anchor;
      p[0] = p[1] = p[2] = 0;
      for (let k = 0; k < 4; k++) { // Bilinear corners a, b (row below: c, d), as the CPU path samples them.
        const right = k & 1, below = k >> 1, weight = (right ? sm.fx : 1 - sm.fx) * (below ? sm.fy : 1 - sm.fy);
        skinVertexInto(handle, transforms, sm.i + right + below * stride, c, ringShifts, s);
        p[0] += c[0] * weight; p[1] += c[1] * weight; p[2] += c[2] * weight;
      }
      if (Core.offsetOntoAxis(p[0], p[1], p[2], aim[side].knee, aim[side].ankle, scratch.shift)) shift.set(scratch.shift.x, scratch.shift.y, scratch.shift.z);
    }
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
  function attach(THREE, { avatarGroup, legHandle, speciesId, gender, garmentId = DEFAULT_GARMENT_ID, appearance = {}, name = 'pants', overlayMask = null, garmentRecord = null, characterRecord = null, imageUrl = null, sourceCanvas = null, footObjects = null, debugSplines = false, spine = null, meshBudget = null, gpuSkin = true } = {}) {
    if (!characterRecord && isPantlessSpecies(speciesId)) return null; // The author's live preview (explicit records) can still show them.
    const Core = core();
    const garment = garmentRecord || rigConfig().garments?.[garmentId]; // The editor passes its live, unsaved authoring records here.
    let character = characterRecord || resolveCharacter(speciesId, gender);
    const plane = findPortraitPlane(avatarGroup);
    const nodes = findLegNodes(legHandle);
    if (!THREE || !Core || !garment || !character || !plane || !nodes) return null;
    const openingWidthRatioForFeet = () => { // Mirrors November 14's uniform body-X/Y average for procedural hands and feet.
      const factors = global.HobunjiCharacterRigScale?.bodyScaleFactorsFor?.(legHandle.group?.parent || avatarGroup);
      const x = Number(factors?.x), y = Number(factors?.y); // Body width/height scales from the existing character-rig owner.
      return x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y) ? (x + y) / (2 * x) : 1;
    };
    if (!characterRecord && !hasAuthoredCharacter(speciesId, gender)) { // No authored beltline for this species: default to its posterior height (or the image edge if that is below the image).
      character = { ...character, portraitBeltSpline: Core.defaultBeltAtPosterior(posteriorPortraitY(THREE, avatarGroup, plane, nodes)) };
    }
    const torsoSource = characterRecord ? null : portraitSourceCanvas(avatarGroup, plane, sourceCanvas); // Child and adult waist alpha use the actual portrait source.
    const torsoFit = characterRecord ? null : fitBeltToVisibleTorso(character, torsoSource); // Normalized waist x is scaled once by the child's model width.
    // Keep the authored character fit as the baseline; apply a separate width field to the torso, not the entire trousers.
    const feet = (footObjects || ['left_foot', 'right_foot'].map(foot => legHandle.group?.getObjectByName?.(foot))).filter(Boolean); // The procedural foot models.
    const footLift = footFrontLift(THREE, avatarGroup, feet);
    const data = buildGarmentData(THREE, Core, avatarGroup, plane, garment, character, segmentsForBudget(meshBudget), torsoFit);
    if (!data) return null;
    const handle = {
      name, garmentId, legHandle, model: avatarGroup, nodes, mesh: null, disposed: false, texture: null, material: null,
      segments: segmentsForBudget(meshBudget), geometry: data.geometry, basePositions: data.basePositions, weights: data.weights, bones2D: data.bones2D,
      beltCenter: data.beltCenter, beltEnds: data.beltEnds, beltFit: data.beltFit, torsoAlphaFit: torsoFit ? { source: torsoFit.source, row: torsoFit.row, width: torsoFit.width, authoredWidth: torsoFit.authoredWidth } : null, planeNormal: data.planeNormal, rings: data.rings, splineSpec: data.splines, debugLines: null, showSplines: !!debugSplines,
      legRollGain: Math.min(4, Math.max(1, Number(character.legRollGain) || 2)),
      openingWidthScale: 1, // Last applied calf-opening span relative to body X; rebuilt only when character proportions change.
      maskMapping: data.maskMapping, footLift, rest: null, restRaw: null, rotationScale: { left: 1, right: 1 }, restFrames: { left: {}, right: {} },
      maskUniforms: { uPantsDepthBias: { value: 0 }, uPantsMask: { value: null }, uPantsMaskOn: { value: 0 }, uPantsMaskO: { value: new THREE.Vector2(data.maskMapping.ox, data.maskMapping.oy) }, uPantsMaskInv: { value: new THREE.Vector4(...data.maskMapping.inv) } },
      scratch: makeScratch(THREE), appearance: { ...appearance, speciesId, gender, imageUrl }, renderToken: 0, ready: false, garment,
      spineSource: spine, spineCurve: null, spineShift: null, // The portrait's spine curve (js/character-spine.js): the pants ride it like an extension of the portrait.
    };
    // Per-vertex shift the spine curve gives the garment (see rebuildSpineShift): zeros for an upright character. The GPU path adds
    // all three components to the skinned vertex; the mask lookup subtracts .xy in either path.
    handle.geometry.setAttribute('pantsSpineShift', new THREE.BufferAttribute(new Float32Array(handle.basePositions.length), 3));
    installGpuSkin(THREE, handle, gpuSkin);

    const depthBiasLimits=new Map(); // Paired close-contact animations may limit the feet-behind-pants cosmetic push.
    let appliedFootDepthBias=0; // Report the current drawing-only foot offset in mobile diagnostics.
    const applyFootDepthBias=()=>{
      let bias=handle.depthBiasBase||0; // Restores normal pants coverage automatically when animation scopes release.
      for(const value of depthBiasLimits.values())bias=Math.min(bias,value);
      appliedFootDepthBias=bias;
      handle.maskUniforms.uPantsDepthBias.value=bias;
      legHandle.setFootDepthPush?.(bias); // Do not move the garment or the physical foot placement.
    };
    handle.setDepthBiasLimit=(owner,limit=null)=>{
      if(!owner)return false;
      if(limit==null)depthBiasLimits.delete(owner);
      else if(Number.isFinite(limit)&&limit>=0)depthBiasLimits.set(owner,limit);
      else return false;
      applyFootDepthBias();
      return true;
    };
    handle.getFootDepthBiasDebug=()=>({base:handle.depthBiasBase||0,applied:appliedFootDepthBias,anatomyRevision:legHandle.anatomyRevision?.() ?? null,openingWidthScale:handle.openingWidthScale,beltFitKind:handle.beltFit?.kind,beltWidthScale:handle.beltFit?.a,beltHorizontalShear:handle.beltFit?.c,torsoAlphaFit:handle.torsoAlphaFit,scopes:[...depthBiasLimits.keys()]}); // Diagnostic snapshot on mobile.
    const createMesh = canvas => {
      const surface = global.HobunjiSpritePngSurface;
      const texture = surface?.makeCanvasTexture ? surface.makeCanvasTexture(THREE, canvas, `${name}-pants`) : new THREE.CanvasTexture(canvas);
      // Pants and the portrait share the exact rest plane. Favor the portrait on coplanar pixels
      // from EITHER camera direction; a negative polygon offset (and the old +0.012 local depth)
      // previously forced the garment in front of opaque portrait art. Animated legs still use
      // genuine 3D depth, while the separate foot camera-depth push keeps feet behind pants.
      const overrides = { side: DOUBLE_SIDE, depthTest: true, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 };
      const material = surface?.makeMaterial ? surface.makeMaterial(THREE, texture, `${name}-pants`, overrides) : new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.01, ...overrides });
      // Pixels covered by arm/overwear/pauldron/hood art stay in front of the pants: the portrait underneath shows through there.
      const previousCompile = material.onBeforeCompile; // Retain the shared PNG ink hook; garment coverage still runs before the alpha test.
      const previousCacheKey = material.customProgramCacheKey;
      material.onBeforeCompile = function pantsMaskCompile(shader, renderer) {
        previousCompile?.call(this, shader, renderer);
        Object.assign(shader.uniforms, handle.maskUniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\nvarying vec2 vPantsLocal;\n${GPU_SKIN_VERTEX_DECLARATIONS}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GPU_SKIN_VERTEX_BODY}`); // No depth pull here: pants are pure 3D proximity against the avatar's own planes; the feet are pushed away instead.
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vPantsLocal;\nuniform sampler2D uPantsMask;\nuniform float uPantsMaskOn;\nuniform vec2 uPantsMaskO;\nuniform vec4 uPantsMaskInv;')
          .replace('#include <alphatest_fragment>', 'if (uPantsMaskOn > 0.5) { vec2 pd = vPantsLocal - uPantsMaskO; vec2 pc = vec2(uPantsMaskInv.x * pd.x + uPantsMaskInv.y * pd.y, uPantsMaskInv.z * pd.x + uPantsMaskInv.w * pd.y); float pantsInside = step(0.0, pc.x) * step(pc.x, 1.0) * step(0.0, pc.y) * step(pc.y, 1.0); diffuseColor.a *= 1.0 - pantsInside * texture2D(uPantsMask, vec2(pc.x, 1.0 - pc.y)).a; }\n#include <alphatest_fragment>');
      };
      material.customProgramCacheKey = function pantsMaskCacheKey() {
        return 'pantsOverlayMaskSpineGpuSkin|' + (previousCacheKey?.call(this) || '');
      };
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
        mesh.userData.hobunjiXrayDeformPadding = 0.8; // Conservative GPU-leg-posed scissor margin consumed by held-object-render-order.js, in local garment units.
        avatarGroup.add(mesh);
        // One registration per live mesh shares the feet's road/ground exemption, solid-cover depth, and water tint.
        // If the compositor has not loaded, its scene scan can adopt this mesh from the semantic tag later.
        if (!global.HeldObjectRenderOrder?.markWaterOccludedMesh?.(mesh)) mesh.userData.hobunjiWaterOccludedBySurface = true;
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
    // Comparing each joint and orientation component avoids cancellations between opposing legs.
    // A tiny tolerance ignores matrix round-off from a render-only turn of the entire avatar.
    const POSE_EPSILON = 1e-6; // Used by poseChanged to ignore numerical noise, not visible motion.
    const LEG_AXES = ['x', 'y', 'z']; // Reused for six joint reads per frame instead of allocating six axis lists.
    const POSE_COMPONENT_COUNT = LEG_SIDES.length * (LEG_JOINTS.length * LEG_AXES.length + BONE_NAMES.length * 9); // Both legs' joint positions and bone orientation matrices.
    const poseComponents = new Float64Array(POSE_COMPONENT_COUNT); // Scratch for the garment's live joint and orientation components.
    const lastPoseComponents = new Float64Array(POSE_COMPONENT_COUNT); // Last skin-uploaded pose, compared against poseComponents.
    let hasLastPose = false; // First frame must skin even if every live bone is in its rest orientation.
    const poseChanged = aim => {
      let index = 0; // Same component order in both buffers, across left/right limbs.
      let moved = !hasLastPose; // Forces first upload and otherwise accumulates individual component changes.
      for (const side of LEG_SIDES) {
        const leg = aim[side], frames = handle.scratch.frames[side];
        for (const joint of LEG_JOINTS) {
          for (const axis of LEG_AXES) {
            const value = leg[joint][axis]; // Joint coordinate used by bone transforms and the pose-change test.
            poseComponents[index] = value;
            if (!Number.isFinite(value) || Math.abs(value - lastPoseComponents[index]) > POSE_EPSILON) moved = true;
            index++;
          }
        }
        for (const name of BONE_NAMES) for (let k = 0; k < 9; k++) {
          const value = frames[name][k]; // Calf/thigh orientation component also affects garment twist.
          poseComponents[index] = value;
          if (!Number.isFinite(value) || Math.abs(value - lastPoseComponents[index]) > POSE_EPSILON) moved = true;
          index++;
        }
      }
      return moved;
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
      const SEGMENTS = handle.segments;
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

    // The pants as an extension of the portrait: when the avatar has a spine (a hunch), every garment vertex is carried by the same curve the
    // portrait skin follows, looked up by the vertex's REST height in the portrait plane's frame. The waistband therefore moves exactly with the
    // portrait's lower edge (no seam, no separate plane), and everything at or below the posterior, where the curve is pinned to the root, is
    // unchanged. The overlay mask that keeps arm/overwear art in front of the pants lives in portrait space, so the shader samples it at the
    // vertex's un-displaced position (pantsSpineShift) to stay lined up with the portrait art, which has moved the same way.
    const spineProfile = () => (typeof handle.spineSource === 'function' ? handle.spineSource() : handle.spineSource) || handle.model.userData?.hobunjiSpine || global.HobunjiCharacterSpine?.fromRoot?.(handle.model) || null;
    const rebuildSpineShift = profile => {
      handle.spineCurve = profile?.curve || null;
      const count = handle.basePositions.length / 3;
      const maskAttribute = handle.geometry.getAttribute('pantsSpineShift');
      maskAttribute.array.fill(0);
      maskAttribute.needsUpdate = true;
      if (!handle.spineCurve || !global.HobunjiCharacterSpine?.deformAt) { handle.spineShift = null; return; }
      const plane = findPortraitPlane(handle.model);
      if (!plane) { handle.spineShift = null; return; }
      handle.model.updateMatrixWorld?.(true);
      plane.updateMatrixWorld?.(true);
      const toPlane = new THREE.Matrix4().copy(plane.matrixWorld).invert().multiply(handle.model.matrixWorld); // Avatar-local -> portrait-plane-local.
      const rotation = new THREE.Matrix3().setFromMatrix4(toPlane), back = rotation.clone().invert();
      const point = new THREE.Vector3(), shift = new THREE.Vector3(), displacement = { x: 0, y: 0, z: 0 };
      const shifts = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        point.set(handle.basePositions[i * 3], handle.basePositions[i * 3 + 1], handle.basePositions[i * 3 + 2]).applyMatrix4(toPlane);
        global.HobunjiCharacterSpine.deformAt(profile, point.y, displacement);
        shift.set(displacement.x, displacement.y, displacement.z).applyMatrix3(back); // The curve is in plane axes; the garment's positions are avatar-local.
        shifts[i * 3] = shift.x; shifts[i * 3 + 1] = shift.y; shifts[i * 3 + 2] = shift.z;
        maskAttribute.array[i * 3] = shift.x; maskAttribute.array[i * 3 + 1] = shift.y; maskAttribute.array[i * 3 + 2] = shift.z;
      }
      handle.spineShift = shifts;
    };
    handle.update = (renderOnly = false) => { // Render-time joint offsets must skin the final visible pose without rebinding the neutral stance.
      const SEGMENTS = handle.segments;
      if (handle.disposed || !handle.mesh || !handle.model.parent) return;
      const visible = handle.model.visible !== false && legHandle.group?.visible !== false;
      if (handle.mesh.visible !== visible) handle.mesh.visible = visible;
      if (!visible) return;
      if (!handle.restCaptured) handle.captureRest();
      if (Math.abs(openingWidthRatioForFeet() - handle.openingWidthScale) > 1e-6) {
        handle.alignToRest(); // A late NPC rig scale or live editor change must resize the hems without stacking stretches.
        rebuildSpineShift(spineProfile()); // The prior hunch offsets were sampled from the OLD rest vertices.
        handle.dirty = true;
      }
      let aim = aimAtLiveLegs();
      // Standing still (most NPCs, most of the time) nothing about the legs changes: skip the skin + upload when this frame's
      // bones and orientation frames are identical to the last frame's.
      let moved = poseChanged(aim); // Detect each limb's translation and twist without canceling opposing steps.
      // The leg group may be repositioned/rescaled after attach (placement, seats): rebind to the stance as it is now. Moving
      // the group also moves the live bones (so the signature changes); a still NPC only re-checks every REST_RECHECK_FRAMES.
      if (!renderOnly && legHandle.getRestStance && handle.lastStance && (moved || handle.dirty || --handle.restRecheckIn <= 0)) {
        handle.restRecheckIn = REST_RECHECK_FRAMES;
        const stance = restStanceBones(handle);
        let stanceDelta = 0, k = 0; // Max change in the standing bind joints, separate from the moving-pose flag.
        for (const side of ['left', 'right']) for (const joint of ['hip', 'ankle']) { const p = stance.bones[side][joint]; stanceDelta = Math.max(stanceDelta, Math.abs(p.x - handle.lastStance[k]), Math.abs(p.y - handle.lastStance[k + 1]), Math.abs(p.z - handle.lastStance[k + 2])); k += 3; }
        if (stanceDelta > 2e-4) { handle.captureRest(); handle.alignToRest(); rebuildSpineShift(spineProfile()); handle.dirty = true; aim = aimAtLiveLegs(); moved = poseChanged(aim); } // aim offsets depend on the rest pose just captured.
      }
      const spine = spineProfile();
      if ((spine?.curve || null) !== handle.spineCurve) { rebuildSpineShift(spine); handle.dirty = true; } // A hunch applied (or changed) after attach reshapes the garment too.
      const gpu = gpuSkinUsable(handle);
      // Only the authored GPU material can use the padded-rest-bounds replay optimization.
      // Foreign/CPU materials deform the position buffer itself, so they use exact live bounds.
      if (handle.mesh.userData.hobunjiPantsGpuBoundsSafe !== gpu) handle.mesh.userData.hobunjiPantsGpuBoundsSafe = gpu;
      if (gpu !== handle.gpuSkinActive) { // Switching paths: the position buffer holds rest vertices (GPU) or skinned ones (CPU), so redo this frame.
        handle.gpuSkinActive = gpu;
        handle.maskUniforms.uPantsGpuSkin.value = gpu ? 1 : 0;
        handle.uploadedBaseVersion = -1;
        handle.dirty = true;
      }
      if (!moved && !handle.dirty) return;
      lastPoseComponents.set(poseComponents); // Record precisely the pose used for this GPU/CPU skin update.
      hasLastPose = true;
      handle.dirty = false;
      const transforms = handle.scratch.transforms; // Channel order is Core.WEIGHT_CHANNELS: belt, leftThigh, leftCalf, rightThigh, rightCalf.
      transforms[0] = null; // The waistband is rigid, exactly as authored.
      transforms[1] = boneTransform('left', 'hip', 'knee', aim);
      transforms[2] = boneTransform('left', 'knee', 'ankle', aim);
      transforms[3] = boneTransform('right', 'hip', 'knee', aim);
      transforms[4] = boneTransform('right', 'knee', 'ankle', aim);
      const position = handle.geometry.getAttribute('position');
      if (gpu) { // The vertex shader skins: only the bone and ring uniforms change per pose, the vertex buffer holds the rest grid.
        if (handle.uploadedBaseVersion !== handle.baseVersion) {
          position.array.set(handle.basePositions);
          position.needsUpdate = true;
          // Returning from CPU mode replaces skinned vertices with rest vertices; neither
          // the old CPU box nor the previous rest box may be reused by the x-ray scissor.
          handle.geometry.boundingBox = null;
          handle.geometry.boundingSphere = null;
          handle.uploadedBaseVersion = handle.baseVersion;
        }
        writeGpuSkinUniforms(handle, transforms, aim);
        return;
      }
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
      if (handle.spineShift) for (let i = 0; i < out.length; i++) out[i] += handle.spineShift[i]; // Carried by the portrait's spine curve (see rebuildSpineShift).
      if (handle.showSplines) updateDebugSplines();
      position.needsUpdate = true; // frustumCulled is off, so no per-frame bounding-sphere work.
      // CPU fallback moves vertex positions. Invalidate on a real pose change only;
      // the x-ray scissor recomputes exact live bounds lazily if this garment is visible.
      handle.geometry.boundingBox = null;
      handle.geometry.boundingSphere = null;
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
    handle.depthBiasBase = footLift * Math.hypot(worldElements[0], worldElements[1], worldElements[2]); // How far the feet protrude toward the camera, in world units.
    handle.maskUniforms.uPantsDepthBias.value = handle.depthBiasBase; // Stored feet-covering distance (scoped limits can lower it); drives the feet's depth push, not the garment.
    applyFootDepthBias();
    handle.captureRest(); // The legs' stance at attach is the rest pose the initial 2D warp targets.
    handle.baseOriginal = new Float32Array(handle.basePositions); // The art as the portrait places it, before the alignment below (which is redone whenever the rest stance changes).
    handle.alignToRest = () => {
      const SEGMENTS = handle.segments;
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
      // November 14 changed feet from body-X scaling to the average of body X/Y. Stretch the fitted hem
      // along each existing ankle spline's 3D span, centred on its bone, without altering the beltline or authored rig.
      handle.openingWidthScale = openingWidthRatioForFeet();
      Core.stretchLegOpeningSpans(handle.basePositions, SEGMENTS, handle.rings, handle.splineSpec, handle.openingWidthScale);
      const restPosition = handle.geometry.getAttribute('position'); // CPU/debug preview also sees the latest rest hem immediately.
      restPosition.array.set(handle.basePositions);
      restPosition.needsUpdate = true;
      // The x-ray scissor uses these cached geometric bounds. Refit only on a real rig-rest
      // realignment, not every animated frame, so replay bounds never use obsolete cuffs.
      handle.geometry.boundingBox = null;
      handle.geometry.boundingSphere = null;
      handle.baseVersion = (handle.baseVersion || 0) + 1; // The GPU path re-uploads the rest grid once per realignment, not per frame.

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
    setGpuSkinning: enabled => { gpuSkinGlobal = enabled !== false; return gpuSkinGlobal; }, // Diagnostics/A-B: false forces every garment back onto the CPU skin.
    gpuSkinningEnabled: () => gpuSkinGlobal,
    liveHandles: () => [...handles], // Diagnostics: every garment currently attached (headless game checks read alignmentReport() from these).
    resolveCharacter,
    fitBeltToVisibleTorso, // Pure portrait-alpha fitting entry for the in-file mobile diagnostics and regression harness.
    portraitSourceCanvas, // Mobile and headless diagnostics for nested NPC canvas lookup.
    taperTorsoBeltPoint, // Geometry regression hook to prove the same alpha width adjustment does not change knees/ankles.
    posteriorPortraitYForAvatar: (THREE, avatarGroup, legGroup) => { const plane = findPortraitPlane(avatarGroup), nodes = findLegNodes({ group: legGroup }); return plane && nodes ? posteriorPortraitY(THREE, avatarGroup, plane, nodes) : null; },
    hasRigFor: (speciesId, gender, garmentId = DEFAULT_GARMENT_ID) => !!(rigConfig().garments?.[garmentId] && resolveCharacter(speciesId, gender)),
    debugSnapshot: () => ({ live: handles.size, garments: Object.keys(rigConfig().garments || {}), characters: Object.keys(rigConfig().characters || {}), footDepthBias: [...handles].filter(h => !h.disposed).slice(0, 12).map(h => ({ name: h.name, ...h.getFootDepthBiasDebug?.() })), lastChange: 'Pants waist reads the actual nested child/NPC torso canvas; child scale stays single-pass and cuffs retain their independent fit.' }),
  });
})(window);
