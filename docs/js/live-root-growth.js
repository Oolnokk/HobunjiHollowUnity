// LiveRootGrowth — purpose-agnostic growth/retraction on invisible furniture geometry.
// Shares the temple's FoliageGenerator surface-wrap implementation, not a second
// foliage renderer. No frame loop or collision/puzzle rules live in this module.
(function (root) {
  'use strict';

  const TEMPLE_ROOT_FINISH = Object.freeze({
    color: '#0e0d06', texture: 'assets/textures/wibbly_surface.png'
  }); // Fallback matches the Temple's authored roots in config/pieces/temple.json.

  const DEFAULTS = Object.freeze({
    seed: 'ruin-root-growth-1', floorWidth: 8, floorDepth: 8, floorY: 0,
    branchCount: 9, duration: 3.5, branchRadius: 0.065, bend: 0.42,
    floorDensity: 1, targetDensity: 1, strandLimit: 80,
    targetLength: 12, floorLength: 12,
    radius: 0.045, curl: 0.6, showGuide: false
  }); // Every instance gets its own normalized, serializable configuration.

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value)); // Used by bounded imported recipes, animation and mesh budgets.
  const number = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? clamp(n, min, max) : fallback;
  }; // Rejects NaN/infinite values before allocating growth geometry.
  function normalizeRecipe(value = {}) {
    const data = value && typeof value === 'object' ? value : {};
    const result = { seed: String(data.seed ?? DEFAULTS.seed).slice(0, 128) }; // Stable serialized seed for both the floor and guide.
    for (const key of ['floorWidth', 'floorDepth']) result[key] = number(data[key], DEFAULTS[key], 1, 32);
    result.floorY = number(data.floorY, DEFAULTS.floorY, -10, 10);
    result.branchCount = Math.round(number(data.branchCount, DEFAULTS.branchCount, 1, 32));
    result.duration = number(data.duration, DEFAULTS.duration, 0.15, 60);
    result.branchRadius = number(data.branchRadius, DEFAULTS.branchRadius, 0.008, 0.3);
    result.bend = number(data.bend, DEFAULTS.bend, 0, 3);
    for (const key of ['floorDensity', 'targetDensity']) result[key] = number(data[key], DEFAULTS[key], 0.05, 1);
    result.strandLimit = Math.round(number(data.strandLimit, DEFAULTS.strandLimit, 1, 80));
    for (const key of ['floorLength', 'targetLength']) result[key] = number(data[key], DEFAULTS[key], 0.5, 30);
    result.radius = number(data.radius, DEFAULTS.radius, 0.005, 0.3);
    result.curl = number(data.curl, DEFAULTS.curl, 0, 2);
    result.showGuide = data.showGuide === true;
    return result;
  }

  function hashSeed(str) {
    let h = 2166136261 >>> 0; // FNV-1a seed; shared recipe strings always regenerate the same branch origins.
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function randomFromSeed(str) {
    let value = hashSeed(str); // Instance-local PRNG; never consumes the global random stream.
    return () => {
      let x = (value += 0x6D2B79F5);
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  const smooth = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); }; // Ease used by both extend and retract.

  function findGrowthMesh(group) {
    return group?.children?.find(child => child.isMesh && child.geometry?.getAttribute('position')) || null;
  }

  // Choose branch origins FROM the generated floor strands, not arbitrary tiles.
  // Each hidden node lies inside the existing dense root blanket.
  function floorNodes(THREE, floorGrowth, endpoints, recipe, random) {
    const mesh = findGrowthMesh(floorGrowth), pos = mesh?.geometry?.getAttribute('position');
    const candidates = []; // Bounded reservoir of centerline-adjacent vertices for floor-root node selection.
    if (pos) {
      const jump = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += jump) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (Number.isFinite(x + y + z) && Math.abs(y - recipe.floorY) <= recipe.radius * 5 + 0.15) {
          candidates.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    const chosen = []; // Separated source nodes prevent a single conspicuous center tuft.
    for (let i = 0; i < recipe.branchCount; i++) {
      const end = endpoints[i % endpoints.length], goalX = clamp(end.x, -recipe.floorWidth * .45, recipe.floorWidth * .45);
      const goalZ = clamp(end.z, -recipe.floorDepth * .45, recipe.floorDepth * .45);
      let best = null, score = Infinity;
      for (let k = 0; k < Math.min(60, candidates.length); k++) {
        const point = candidates[Math.floor(random() * candidates.length)];
        const spread = chosen.reduce((penalty, node) => penalty + Math.max(0, .48 - node.distanceTo(point)) * 8, 0);
        const cost = (point.x - goalX) ** 2 + (point.z - goalZ) ** 2 + spread + random() * 2.5;
        if (cost < score) { best = point; score = cost; }
      }
      // An empty wrap cannot yield genuine root nodes; keep the controller usable,
      // but expose this fallback explicitly in diagnostics instead of hiding it.
      chosen.push(best ? best.clone() : new THREE.Vector3(
        (random() - .5) * recipe.floorWidth * .85, recipe.floorY + recipe.radius, (random() - .5) * recipe.floorDepth * .85));
    }
    return { nodes: chosen, derivedFromWrap: !!candidates.length, candidateCount: candidates.length };
  }

  function sampledTargetPoints(THREE, target, growth, count, random, parent) {
    const endpoints = Array.isArray(growth.userData?.surfaceGrowthEndpoints) ? growth.userData.surfaceGrowthEndpoints : [];
    const points = []; // The established Wrap solver's edge endpoints are the preferred termination points.
    target.updateWorldMatrix(true, true);
    parent.updateWorldMatrix(true, true);
    const toParent = world => parent.worldToLocal(world);
    for (const entry of endpoints) for (const key of ['start', 'end']) {
      const coords = entry?.[key];
      if (!Array.isArray(coords) || coords.length < 3 || !coords.slice(0, 3).every(Number.isFinite)) continue;
      points.push(toParent(target.localToWorld(new THREE.Vector3(...coords))));
    }
    const candidates = []; // Fallback mesh vertices support imported GLBs without recognized perimeter loops.
    if (!points.length) target.traverse(mesh => {
      if (!mesh.isMesh || mesh.userData?.surfaceFoliage || mesh.userData?.surfaceFoliageGuide) return;
      const attr = mesh.geometry?.getAttribute?.('position');
      if (!attr) return;
      const stride = Math.max(1, Math.ceil(attr.count / 180));
      for (let i = 0; i < attr.count; i += stride) {
        const v = new THREE.Vector3().fromBufferAttribute(attr, i);
        if (Number.isFinite(v.x + v.y + v.z)) candidates.push(toParent(mesh.localToWorld(v)));
      }
    });
    const source = points.length ? points : candidates;
    if (!source.length) throw new Error('Imported furniture has no usable triangles or surface endpoints.');
    const chosen = []; // Round-robin with seeded jitter spreads branches across the hidden target.
    for (let i = 0; i < count; i++) chosen.push(source[Math.floor((i + random() * source.length) % source.length)].clone());
    return { points: chosen, wrapEndpointCount: endpoints.length, usedFallback: !points.length };
  }

  function makeBranch(THREE, a, b, index, recipe, random, material) {
    const dist = a.distanceTo(b), lift = Math.max(.25, dist * .24); // Raised middle control points make growth branch organically away from the floor.
    const side = new THREE.Vector3(random() - .5, 0, random() - .5).multiplyScalar(recipe.bend);
    const p1 = a.clone().lerp(b, .28).add(new THREE.Vector3(side.x, lift, side.z));
    const p2 = a.clone().lerp(b, .7).add(new THREE.Vector3(-side.z * .5, lift * .75, side.x * .5));
    const curve = new THREE.CatmullRomCurve3([a, p1, p2, b], false, 'centripetal');
    const segments = Math.min(80, Math.max(16, Math.ceil(dist * 12))); // Static, bounded tube resolution; only draw ranges change per frame.
    const geometry = new THREE.TubeGeometry(curve, segments, recipe.branchRadius, 6, false);
    const position = geometry.getAttribute('position');
    for (let ring = 0; ring <= segments; ring++) {
      const center = curve.getPointAt(ring / segments), taper = 1 - .63 * smooth(ring / segments);
      for (let spoke = 0; spoke <= 6; spoke++) {
        const i = ring * 7 + spoke;
        const x = center.x + (position.getX(i) - center.x) * taper;
        const y = center.y + (position.getY(i) - center.y) * taper;
        const z = center.z + (position.getZ(i) - center.z) * taper;
        position.setXYZ(i, x, y, z);
      }
    }
    position.needsUpdate = true; geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Growth branch ' + (index + 1);
    mesh.userData.rootGrowthBranch = true;
    mesh.userData.noOutline = false; // Same outline eligibility as FoliageGenerator surface roots.
    mesh.layers?.enable?.(1); // Runtime shell pass already selects layer 1; editor preview uses the same layer.
    mesh.userData.fullDrawCount = geometry.index ? geometry.index.count : position.count;
    mesh.geometry.setDrawRange(0, 0);
    return mesh;
  }

  function create(options = {}) {
    const THREE = options.THREE || root.THREE; // Native Three instance, passed explicitly in previews if required.
    const foliage = options.foliage || root.FoliageGenerator?.forThree?.(THREE) || root.FoliageGenerator;
    if (!THREE || !foliage?.buildSurfaceGrowth || !foliage?.normalizeSurfaceGrowth) throw new Error('LiveRootGrowth requires THREE and FoliageGenerator.');
    if (!options.target?.isObject3D) throw new TypeError('Pass a Three.js furniture group as options.target.');
    const recipe = normalizeRecipe(options.recipe), random = randomFromSeed(recipe.seed);
    const proposedFinish = options.rootFinish || TEMPLE_ROOT_FINISH; // Editor may provide the current Temple configuration at build time.
    const rootFinish = {
      color: /^#[0-9a-f]{6}$/i.test(proposedFinish?.color || '') ? proposedFinish.color : TEMPLE_ROOT_FINISH.color,
      texture: typeof proposedFinish?.texture === 'string' &&
        /^(?:assets\/[^?#]*\.png(?:[?#].*)?|data:image\/png;base64,[a-z0-9+/=]+)$/i.test(proposedFinish.texture)
        ? proposedFinish.texture : TEMPLE_ROOT_FINISH.texture
    }; // Keep serialized material inputs safe for all callers.
    const group = new THREE.Group(); // Public scene-owned root, containing floor, hidden shape and generated foliage.
    group.name = 'Live root growth';
    const target = options.target.clone(true); // Imported furniture and its materials remain owned by the caller.
    target.name = 'Invisible growth shape';
    // Imported furniture GLBs use a tiny Mesh as an async driver. Replace the
    // loaded driver with a transform-identical Group so wrapping sees only the
    // real rendered geometry, not its 1-mm placeholder box.
    const glbDrivers = []; // Collected before editing the hierarchy to avoid traverse mutations.
    target.traverse(node => { if (node.isMesh && node.userData?.furnitureGlbPart) glbDrivers.push(node); });
    for (const driver of glbDrivers) {
      if (!driver.userData.glbReady) throw new Error('Furniture GLB has not finished loading: ' + driver.name);
      const holder = new THREE.Group(); // Preserves authored transforms and the real GLB child hierarchy.
      holder.name = driver.name; holder.position.copy(driver.position);
      holder.quaternion.copy(driver.quaternion); holder.scale.copy(driver.scale);
      for (const child of [...driver.children]) holder.add(child);
      driver.parent.add(holder); driver.parent.remove(driver);
    }
    const floorHost = new THREE.Group(), floor = new THREE.Mesh(
      new THREE.PlaneGeometry(recipe.floorWidth, recipe.floorDepth),
      new THREE.MeshBasicMaterial({visible:false}));
    floor.rotation.x = -Math.PI / 2; floor.position.y = recipe.floorY;
    floor.userData.surfaceFoliageRole = 'floors';
    floor.name = 'Invisible root-floor navigation surface';
    floorHost.add(floor);
    group.add(floorHost, target);
    target.traverse(mesh => {
      if (!mesh.isMesh) return;
      const wasVisible = mesh.visible !== false; // Hidden GLB bones and existing guide meshes must remain excluded.
      let ancestor = mesh, isOriginalGrowth = false; // Existing authored foliage must never become a new target.
      while (ancestor && ancestor !== target) {
        if (ancestor.userData?.surfaceFoliage || ancestor.userData?.surfaceFoliageGuide) isOriginalGrowth = true;
        ancestor = ancestor.parent;
      }
      mesh.visible = wasVisible && recipe.showGuide && !isOriginalGrowth;
      mesh.layers?.disable?.(1); // A visible debug furniture guide is never part of the root-only shell outline pass.
      if (!wasVisible || isOriginalGrowth) mesh.userData.surfaceFoliageExclude = true;
    }); // The furniture is never rendered in normal mode, but its triangles remain eligible for sampling.
    const growthOptions = {kind:'roots', style:'wrap', count:recipe.strandLimit,
      strandLimit:recipe.strandLimit, radius:recipe.radius, curl:recipe.curl,
      offset:0.012, density:recipe.floorDensity, color:rootFinish.color, texture:rootFinish.texture};
    const floorGrowth = foliage.buildSurfaceGrowth(floorHost, {
      ...growthOptions, seed:recipe.seed+':floor', target:'floors', length:recipe.floorLength
    }); // Dense permanent cover uses precisely the temple Wrap solver.
    floorHost.add(floorGrowth);
    const targetGrowth = foliage.buildSurfaceGrowth(target, {
      ...growthOptions, seed:recipe.seed+':shape', target:'all',
      length:recipe.targetLength, density:recipe.targetDensity
    }); // The final keyframe follows the imported furniture's actual surface triangles.
    target.add(targetGrowth);
    const shapeMesh = findGrowthMesh(targetGrowth), floorMesh = findGrowthMesh(floorGrowth);
    const targets = sampledTargetPoints(THREE, target, targetGrowth, recipe.branchCount, random, group);
    const source = floorNodes(THREE, floorGrowth, targets.points, recipe, random);
    const branchSourceMaterial = shapeMesh?.material || floorMesh?.material; // Existing Temple-textured Wrap material is authoritative for branch finish.
    const branchMaterial = branchSourceMaterial?.clone?.() ||
      new THREE.MeshBasicMaterial({color:parseInt(rootFinish.color.slice(1),16)}); // No-shape fallback still uses Temple bark color.
    const branchGroup = new THREE.Group(); // Animation-only intermediate roots, independent of shape and collision.
    branchGroup.name = 'Extending branch roots';
    const branches = targets.points.map((point, i) => {
      const branch = makeBranch(THREE, source.nodes[i], point, i, recipe, random, branchMaterial);
      branchGroup.add(branch); return branch;
    });
    group.add(branchGroup);
    if (shapeMesh) {
      shapeMesh.userData.fullDrawCount = shapeMesh.geometry.index ? shapeMesh.geometry.index.count : shapeMesh.geometry.attributes.position.count;
    }
    let progress = 0, direction = 0, disposed = false; // Per-instance animation state, independent of purpose/trigger.
    const apply = () => {
      const extent = smooth(progress / .68), wrap = smooth((progress - .45) / .55);
      for (let i = 0; i < branches.length; i++) {
        // Small per-branch offsets keep the growth organic without changing the authored final pose.
        const phase = clamp((extent - (i % 4) * .065) / (1 - (i % 4) * .065), 0, 1);
        const count = Math.floor(branches[i].userData.fullDrawCount * phase / 3) * 3;
        branches[i].geometry.setDrawRange(0, count);
        branches[i].visible = count > 0;
      }
      if (shapeMesh) {
        const count = Math.floor(shapeMesh.userData.fullDrawCount * wrap / 3) * 3;
        shapeMesh.geometry.setDrawRange(0, count);
      }
    };
    const api = {
      group, target, floorGrowth, targetGrowth, branches, recipe, rootFinish,
      setProgress(value) { if (!disposed) { progress = number(value, progress, 0, 1); apply(); } return progress; },
      getProgress() { return progress; },
      extend() { if (!disposed) direction = 1; },
      retract() { if (!disposed) direction = -1; },
      pause() { direction = 0; },
      update(deltaSeconds) {
        if (disposed || direction === 0) return progress;
        const delta = number(deltaSeconds, 0, 0, .25); // Clamp background-tab spikes; no sudden door/platform jumps.
        progress = clamp(progress + direction * delta / recipe.duration, 0, 1);
        if ((progress === 1 && direction > 0) || (progress === 0 && direction < 0)) direction = 0;
        apply(); return progress;
      },
      getDiagnostics() {
        return {progress, direction, branchCount:branches.length, rootFinish, outlinedBranches:branches.length,
          floorStrands:floorGrowth.userData?.generatedStrands || 0,
          shapeStrands:targetGrowth.userData?.generatedStrands || 0,
          floorNodesFromWrap:source.derivedFromWrap, sampledFloorNodes:source.candidateCount,
          shapeWrapEndpointPairs:targets.wrapEndpointCount, shapeEndpointFallback:targets.usedFallback,
          floor:floorGrowth.userData?.diagnostics, shape:targetGrowth.userData?.diagnostics};
      },
      dispose() {
        if (disposed) return; disposed = true; direction = 0;
        group.parent?.remove(group);
        // Only dispose generated assets; source clone materials/geometries can be shared with the importer.
        for (const mesh of branches) mesh.geometry.dispose();
        branchMaterial.dispose();
        for (const growth of [floorGrowth, targetGrowth]) growth.traverse(node => {
          node.geometry?.dispose?.(); if (Array.isArray(node.material)) node.material.forEach(mat => mat.dispose());
          else node.material?.dispose?.();
        });
        floor.geometry.dispose(); floor.material.dispose();
      }
    };
    api.setProgress(options.progress ?? 0);
    return api;
  }

  root.LiveRootGrowth = {version:2, DEFAULTS, TEMPLE_ROOT_FINISH, normalizeRecipe, create};
})(typeof window !== 'undefined' ? window : globalThis);
