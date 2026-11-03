// Ground-grown ice coverage for authored furniture. Shares the surfaceGrowth
// recipe lifecycle with roots/vines, but creates faceted stalagmites instead of tubes.
(function () {
  'use strict';

  const MAX_SOURCE_MESHES = 128; // Bounds geometry discovery on unusually complex authored furniture.
  const MAX_CLUSTERS = 80; // Bounds the number of seeded cluster origins per furniture instance.
  const MAX_SPIKES = 320; // Caps all crystal geometry in one coverage layer.
  const EPSILON = 0.0001; // Rejects empty GLB placeholders and degenerate bounds.

  function hashSeed(text) {
    let hash = 2166136261 >>> 0; // Shared deterministic seed for editor and runtime.
    for (const character of String(text)) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    }
    return hash >>> 0;
  }

  function randomGenerator(seed) {
    let value = hashSeed(seed); // Local RNG keeps authored results independent of gameplay random state.
    return function random() {
      value += 0x6D2B79F5;
      let t = Math.imul(value ^ (value >>> 15), value | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }

  function findPartId(object, parent) {
    let candidate = object; // Walks imported GLB descendants back to their authored parent part.
    while (candidate && candidate !== parent) {
      const data = candidate.userData || {};
      if (data.authoredPartId) return String(data.authoredPartId);
      if (data.surfaceFoliageId) return String(data.surfaceFoliageId);
      if (data.type === 'part' && data.id) return String(data.id);
      candidate = candidate.parent;
    }
    return null;
  }

  function collectSources(T, parent, settings) {
    const sources = []; // Mesh-local bounding boxes transformed into furniture-local coordinates.
    const selected = new Set(settings.targetIds || []); // Restricts the generator to authored selected pieces.
    const inverse = new T.Matrix4(); // Converts each child mesh into the parent furniture's coordinate frame.
    parent.updateMatrixWorld(true);
    inverse.copy(parent.matrixWorld).invert();
    parent.traverse(function (object) {
      if (sources.length >= MAX_SOURCE_MESHES || !object.isMesh || !object.geometry || !object.visible) return;
      if (object.userData?.surfaceFoliage || object.userData?.surfaceFoliageGuide || object.userData?.furnitureGlbPart) return; // GLB wrappers are invisible 0.001-unit drivers; sample their loaded child meshes instead.
      const partId = findPartId(object, parent); // Generated overlays and attached item previews have no authored part id.
      if (!partId || (settings.target === 'selected' && !selected.has(partId))) return;
      if (settings.targetMeshId && settings.targetMeshId !== partId) return;
      const geometry = object.geometry; // Reuses the actual authored part/GLB bounds, not guessed tile dimensions.
      if (!geometry.getAttribute?.('position')) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
      const relative = new T.Matrix4().multiplyMatrices(inverse, object.matrixWorld); // Handles nested transforms and rotated pieces.
      const bounds = geometry.boundingBox.clone().applyMatrix4(relative); // Conservative AABB contains the actual lower furniture geometry.
      if (![bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)) return;
      if (bounds.max.y < -EPSILON || bounds.min.y > Math.max(.45, settings.iceHeightMax * .85)) return;
      const width = bounds.max.x - bounds.min.x; // Horizontal footprint contributes to placement weighting.
      const depth = bounds.max.z - bounds.min.z; // Thin rails can still seed crystals with minimum weighting.
      if (width < EPSILON && depth < EPSILON) return;
      sources.push({ bounds, partId, weight: Math.max(.12, 2 * (width + depth)) });
    });
    return sources;
  }

  function sourceFor(random, sources) {
    const sum = sources.reduce((value, source) => value + source.weight, 0); // Gives larger lower pieces proportionately more clusters.
    let pick = random() * sum; // Deterministic weighted source selection across runtime and preview.
    for (const source of sources) { pick -= source.weight; if (pick <= 0) return source; }
    return sources[sources.length - 1];
  }

  function sampleOrigin(random, source, settings) {
    const box = source.bounds; // Eligible geometry defines which lower surfaces can be engulfed.
    const inner = random() < settings.iceEngulf; // Inner origins emerge through lower furniture; outer ones grip its perimeter.
    const padding = inner ? -settings.iceFootprintPadding * .35 : settings.iceFootprintPadding;
    const halfWidth = Math.max(.005, (box.max.x - box.min.x) * .5 + padding);
    const halfDepth = Math.max(.005, (box.max.z - box.min.z) * .5 + padding);
    const cx = (box.min.x + box.max.x) * .5; // Furniture-local horizontal center for the selected part.
    const cz = (box.min.z + box.max.z) * .5; // Furniture-local depth center for the selected part.
    const along = random() * 2 - 1; // Spreads candidate locations along real projected lower edges.
    const side = Math.floor(random() * 4); // Repeated perimeter sampling avoids floating ice on upper surfaces.
    if (side === 0) return { x: cx - halfWidth, z: cz + along * halfDepth };
    if (side === 1) return { x: cx + halfWidth, z: cz + along * halfDepth };
    if (side === 2) return { x: cx + along * halfWidth, z: cz - halfDepth };
    return { x: cx + along * halfWidth, z: cz + halfDepth };
  }

  function appendTriangle(T, position, color, anchors, a, b, c, tint, shade, origin) {
    const faceColor = new T.Color(tint).multiplyScalar(shade); // Facet variation provides crystalline planes without texture loading.
    for (const point of [a, b, c]) {
      position.push(point.x, point.y, point.z);
      anchors.push(origin.x, -.015, origin.z); // A separate ground anchor per vertex reverses each spike's own growth without pulling clusters toward the furniture center.
      const brightness = point.tip ? 1.22 : point.middle ? 1.06 : .77; // Frost-dark bases fade to pale sharp tips.
      color.push(clamp(faceColor.r * brightness, 0, 1), clamp(faceColor.g * brightness, 0, 1), clamp(faceColor.b * brightness, 0, 1));
    }
  }

  function appendSpike(T, positions, colors, anchors, random, x, z, height, radius, settings) {
    const sides = Math.max(3, Math.min(9, Math.round(settings.iceFacets))); // Low-sided geometry reads as fractured ice rather than a smooth cone.
    const angle = random() * Math.PI * 2; // Each crystal has an independent phase around the vertical axis.
    const middleY = height * (.22 + .30 * (1 - settings.iceTipSharpness)); // Tip sharpness controls how early the crystal tapers.
    const middleRadius = radius * (.45 + .30 * (1 - settings.iceTipSharpness)); // A short shoulder keeps sharp, irregular points.
    const driftX = (random() - .5) * settings.iceLean * height; // Small lean changes tips, never the ground-supported base.
    const driftZ = (random() - .5) * settings.iceLean * height; // Independent lateral lean retains a mostly upward silhouette.
    const base = [], middle = []; // Shared rings emit flat-shaded faces, not separate overlapping transparent cones.
    for (let i = 0; i < sides; i++) {
      const theta = angle + i * Math.PI * 2 / sides; // Uneven planar facets make every spike individually recognizable.
      const radial = .78 + random() * .42; // Irregular base radii make crystal silhouettes less synthetic.
      base.push({ x: x + Math.cos(theta) * radius * radial, y: -.015, z: z + Math.sin(theta) * radius * radial });
      middle.push({
        x: x + driftX * .26 + Math.cos(theta) * middleRadius * radial,
        y: middleY * (.85 + random() * .23),
        z: z + driftZ * .26 + Math.sin(theta) * middleRadius * radial,
        middle: true
      });
    }
    const tip = { x: x + driftX, y: height, z: z + driftZ, tip: true }; // Ground-up stalagmite: no negative-height tips.
    const shadeOffset = .74 + random() * .26; // Per-spike ice brightness accompanies the per-facet shading.
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides; // Adjacent facets join without seam overlap.
      const shade = shadeOffset * (.88 + random() * .21); // Facets differ subtly without changing the user's selected color.
      appendTriangle(T, positions, colors, anchors, base[i], base[j], middle[j], settings.color, shade, {x,z});
      appendTriangle(T, positions, colors, anchors, base[i], middle[j], middle[i], settings.color, shade, {x,z});
      appendTriangle(T, positions, colors, anchors, middle[i], middle[j], tip, settings.color, shade * 1.03, {x,z});
    }
  }

  function build(T, parent, settings) {
    const group = new T.Group(); // Sibling-owned generated group is safely cleaned up by applySurfaceGrowth.
    group.name = 'Surface ice stalagmites';
    group.userData.surfaceFoliage = true;
    group.userData.iceStalagmites = true;
    if (!T || !parent) { group.userData.diagnostics = 'Ice coverage needs a Three.js furniture root.'; return group; }
    const sources = collectSources(T, parent, settings); // No floor meshes, decals, selected-surface guides, or particles become ice origins.
    const clusters = Math.min(MAX_CLUSTERS, Math.max(1, Math.round(settings.count * settings.density))); // Density scales saved cluster count.
    if (!sources.length) {
      group.userData.diagnostics = 'Ice stalagmites: no eligible lower furniture parts (check selected pieces).';
      group.userData.surfaceGrowthStats = { parts: 0, clusters: 0, spikes: 0, triangles: 0 };
      return group;
    }
    const random = randomGenerator(settings.seed); // Exported seed guarantees identical regenerated shapes.
    const positions = [], colors = [], anchors = []; // The matching per-vertex anchors support a reversible growth lerp without extra draw calls.
    let spikes = 0; // Actual spike budget reported to the editor's mobile-visible status line.
    for (let i = 0; i < clusters && spikes < MAX_SPIKES; i++) {
      const source = sourceFor(random, sources); // Picks a lower geometry section by perimeter.
      const origin = sampleOrigin(random, source, settings); // Anchors each cluster at floor height zero.
      const satellites = Math.max(1, Math.min(settings.iceCluster, 1 + Math.floor(random() * settings.iceCluster))); // Natural mixed cluster sizes.
      for (let j = 0; j < satellites && spikes < MAX_SPIKES; j++) {
        const angle = random() * Math.PI * 2; // Smaller crystals cluster radially around the primary spike.
        const spread = j === 0 ? 0 : Math.sqrt(random()) * settings.radius * (1.0 + settings.iceCluster * .26);
        const height = (settings.iceHeightMin + random() * (settings.iceHeightMax - settings.iceHeightMin)) * (j ? .35 + random() * .48 : 1); // Satellites are shorter than the leader.
        const radius = settings.radius * (j ? .32 + random() * .48 : .67 + random() * .53); // Common base region ties clusters together.
        appendSpike(T, positions, colors, anchors, random, origin.x + Math.cos(angle) * spread, origin.z + Math.sin(angle) * spread, height, radius, settings);
        spikes++;
      }
    }
    if (spikes) {
      const geometry = new T.BufferGeometry(); // One draw call per layer, independent of the number of icicles.
      geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      geometry.userData.iceFullPositions = new Float32Array(positions); // Original authored crystal positions are the immutable lerp destinations.
      geometry.userData.iceGrowthAnchors = new Float32Array(anchors); // Each vertex retracts toward its own crystal's ground source.
      geometry.computeVertexNormals();
      const material = new T.MeshStandardMaterial({ // Translucent, cold highlights with no external texture dependency.
        vertexColors: true, color: 0xffffff, roughness: settings.iceRoughness, metalness: .02,
        transparent: settings.iceOpacity < 1, opacity: settings.iceOpacity, depthWrite: true,
        flatShading: true, side: T.DoubleSide
      });
      const mesh = new T.Mesh(geometry, material); // Rendering-only child never registers as a collision or surface target.
      mesh.name = 'Faceted ground ice';
      mesh.userData.surfaceFoliage = true;
      mesh.userData.iceCoverage = true;
      group.add(mesh);
    }
    group.userData.surfaceGrowthStats = { parts: sources.length, clusters, spikes, triangles: positions.length / 9 }; // Counts power in-editor diagnostics.
    group.userData.diagnostics = 'Ice stalagmites: ' + clusters + ' clusters, ' + spikes + ' spikes on ' + sources.length + ' lower furniture mesh(es); ' + (positions.length / 9) + ' triangles.';
    return group;
  }

  function setGrowth(group, value) {
    if (!group?.userData?.iceStalagmites) return false;
    const progress = clamp(Number.isFinite(Number(value)) ? Number(value) : 1, 0, 1); // Shared 0..1 visible growth fraction for dungeon ice and future authored animations.
    if (group.userData.iceGrowthProgress === progress) return true; // One immutable buffer copy per changed frame, never repeated work.
    let updated = false; // Tracks whether this generated layer actually owns ice meshes.
    group.traverse(node => {
      if (!node.userData?.iceCoverage || !node.geometry) return;
      const position = node.geometry.getAttribute('position'); // In-place buffer updates preserve the original draw call and materials.
      const full = node.geometry.userData?.iceFullPositions; // Geometry is immutable at full growth even after multiple melt/recover cycles.
      const anchors = node.geometry.userData?.iceGrowthAnchors; // Per-spike ground points prevent the entire ice sheet collapsing to one location.
      if (!position || !full || !anchors || full.length !== position.array.length || anchors.length !== full.length) return;
      if (progress === 1) position.array.set(full);
      else for (let i = 0; i < full.length; i++) position.array[i] = anchors[i] + (full[i] - anchors[i]) * progress;
      position.needsUpdate = true;
      node.visible = progress > .001; // At zero growth, hide the degenerate facets and disable their picking.
      updated = true;
    });
    group.userData.iceGrowthProgress = progress; // Mobile diagnostics can inspect the exact applied growth fraction.
    return updated;
  }

  function selfTest(T) {
    if (!T) return { ok: false, message: 'Three.js is not available.' };
    const furniture = new T.Group(); // Isolated test scene checks generated geometry without altering the editor.
    const box = new T.Mesh(new T.BoxGeometry(1, 1.5, 1), new T.MeshBasicMaterial());
    box.position.y = .75;
    box.userData.authoredPartId = 'ice_test_part';
    furniture.add(box);
    const config = {
      kind: 'iceStalagmites', seed: 'ice-self-check', color: '#bcecff', target: 'selected',
      targetIds: ['ice_test_part'], count: 8, density: 1, radius: .11, iceHeightMin: .2, iceHeightMax: .9,
      iceCluster: 3, iceEngulf: .4, iceFootprintPadding: .06, iceFacets: 5,
      iceTipSharpness: .8, iceLean: .13, iceRoughness: .2, iceOpacity: .95
    }; // Mirrors normalized author defaults but exercises selected-part targeting.
    const first = build(T, furniture, config);
    const second = build(T, furniture, config);
    const a = first.children[0]?.geometry.getAttribute('position');
    const b = second.children[0]?.geometry.getAttribute('position');
    let deterministic = !!a && !!b && a.count === b.count; // Identical seeds must generate identical geometry.
    let floorAnchored = !!a; // No facet may extend below the intentional 0.015 ground overlap.
    if (a) for (let i = 0; i < a.count; i++) {
      deterministic = deterministic && a.getX(i) === b.getX(i) && a.getY(i) === b.getY(i) && a.getZ(i) === b.getZ(i);
      floorAnchored = floorAnchored && a.getY(i) >= -.016;
    }
    const originalFirst = new Float32Array(a?.array || []); // Checks that retraction modifies coordinates rather than just hiding or fading the mesh.
    const halfway = setGrowth(first, .5); // Reversing growth must leave each tip at half height along its original path.
    const halfPositions = first.children[0]?.geometry.getAttribute('position')?.array;
    let midway = halfway && !!halfPositions;
    if (halfPositions) for (let i = 0; i < halfPositions.length; i++) {
      const anchor = first.children[0].geometry.userData.iceGrowthAnchors[i]; // Midpoint of the immutable full vertex and its own ground anchor.
      if (Math.abs(halfPositions[i] - (originalFirst[i] + anchor) * .5) > .00001) { midway = false; break; }
    }
    setGrowth(first, 0); // Complete retraction should make the crystal layer invisible without deleting its saved recipe.
    const fullyRetracted = first.children[0]?.visible === false && first.userData.iceGrowthProgress === 0;
    setGrowth(first, 1); // Restoring growth must reproduce the exact previous faceted geometry.
    const restored = first.children[0]?.geometry.getAttribute('position').array.every((value, i) => value === originalFirst[i]);
    const noSelected = build(T, furniture, { ...config, targetIds: ['missing'] }); // A selected subset with no matches must not cover unrelated furniture.
    const ok = deterministic && floorAnchored && midway && fullyRetracted && restored && !noSelected.children.length && first.userData.surfaceGrowthStats.spikes > 0;
    for (const layer of [first, second, noSelected]) layer.traverse(node => { node.geometry?.dispose?.(); node.material?.dispose?.(); });
    box.geometry.dispose();
    box.material.dispose();
    return { ok, message: ok ? 'PASS: deterministic geometry, ground anchoring, selected parts, reversible crystal growth.' : 'FAIL: seeded geometry, ground anchoring, selected parts, or reversible crystal growth.' };
  }

  window.IceStalagmiteCoverage = { build, setGrowth, selfTest, MAX_SPIKES }; // Shared by gameplay, furniture author, and mobile diagnostics.
})();
