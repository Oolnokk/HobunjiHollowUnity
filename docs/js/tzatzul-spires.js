// Deterministic, flight-only wilderness spires. The existing CellGrid3D and
// DynamicSurfaces bridge owns their ledges; ground tiles are never rewritten.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TzatzulSpires = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const byArea = new Map(); // Retains the current scene's perch/entrance positions for wildlife and mobile diagnostics.
  const TAU = Math.PI * 2;
  const NUM_SIDES = 8; // Low-poly cliff cylinders use an irregular eight-corner footprint.
  const MIN_SPACING = 15; // Tile-distance separation prevents impenetrable fields of adjacent spires.

  function hash(value) {
    let n = 2166136261 >>> 0;
    for (const ch of String(value)) { n ^= ch.charCodeAt(0); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }
  function rngFor(seed) {
    let n = hash(seed) || 1;
    return () => {
      n = (n + 0x6d2b79f5) >>> 0;
      let t = Math.imul(n ^ n >>> 15, n | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function footprint(grid, x, z, width, depth, y) {
    const result = []; // Separate float-Y supports; no mutation of base tile elevations.
    const rows = grid.length, cols = grid[0]?.length || 0;
    for (let r = Math.max(0, Math.floor(z - depth / 2)); r <= Math.min(rows - 1, Math.floor(z + depth / 2)); r++)
      for (let c = Math.max(0, Math.floor(x - width / 2)); c <= Math.min(cols - 1, Math.floor(x + width / 2)); c++)
        if (Math.abs(c + 0.5 - x) <= width / 2 + 0.2 && Math.abs(r + 0.5 - z) <= depth / 2 + 0.2)
          result.push({ c, r, elevation: y });
    return result;
  }
  function candidateClear(grid, c, r, opts, selected, network) {
    const rows = grid.length, cols = grid[0]?.length || 0;
    if (c < 6 || r < 6 || c + 6 >= cols || r + 6 >= rows) return false;
    const x = c + 0.5, z = r + 0.5;
    if (selected.some(s => Math.hypot(s.x - x, s.z - z) < MIN_SPACING)) return false;
    if ((network?.routes || []).some(route => route.nodes?.some(node => Math.hypot(node.x - x, node.z - z) < 6))) return false;
    if ((network?.balconies || []).some(s => Math.hypot(s.x - x, s.z - z) < 6)) return false;
    if ((opts.obstacles || []).some(box => box.x < x + 4 && box.x + box.w > x - 4 &&
      box.y < z + 4 && box.y + box.h > z - 4)) return false;
    const central = grid[r]?.[c];
    if (!central || opts.blocked?.(central) || opts.isBoundary?.(central)) return false;
    const baseY = Number(opts.tileY?.(central));
    if (!Number.isFinite(baseY)) return false;
    for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
      const tile = grid[r + dr]?.[c + dc];
      if (!tile || opts.blocked?.(tile) || opts.isBoundary?.(tile)) return false;
      if (Math.abs((Number(opts.tileY?.(tile)) || 0) - baseY) > 0.45) return false;
    }
    return true;
  }
  function plan(area, grid, opts = {}, network = null) {
    if (!grid?.length || !grid[0]?.length) return [];
    const rows = grid.length, cols = grid[0].length;
    if (cols < 20 || rows < 20) return [];
    const rng = rngFor('tzatzul-spires:' + area + ':' + cols + 'x' + rows);
    const count = Math.min(4, Math.max(2, Math.round(cols * rows / 5200)));
    const picked = [];
    for (let attempt = 0; attempt < 650 && picked.length < count; attempt++) {
      const c = 6 + Math.floor(rng() * (cols - 12)), r = 6 + Math.floor(rng() * (rows - 12));
      if (!candidateClear(grid, c, r, opts, picked, network)) continue;
      const x = c + .5, z = r + .5, baseY = Number(opts.tileY(grid[r][c])) || 0;
      const height = 9 + rng() * 5.2; // Tall irregular incline, taller than the standard mini-cliffs.
      const topWidths = [4.1 + rng() * .8, 3.05 + rng() * .5, 2.15 + rng() * .4];
      const levels = topWidths.map((width, i) => ({
        y: baseY + height * [0.27, 0.64, 1][i],
        width, depth: width * (.84 + rng() * .13),
        offsetX: (rng() - .5) * .55, offsetZ: (rng() - .5) * .55,
      })); // Each upper plateau retreats inward, rather than being a single tapered cone.
      const side = rng() < .5 ? 1 : -1;
      const nestY = levels[1].y + (levels[2].y - levels[1].y) * (.46 + rng() * .12);
      const nest = {
        id: 'tzatzul-nest-' + c + '-' + r,
        x: x + levels[2].offsetX,
        z: z + side * (levels[2].depth * .5 + .37),
        y: nestY, width: 1.8, depth: 1.35, side,
        caveMapId: 'map_i_tzatzul_' + area + '_' + c + '_' + r,
      }; // High cave mouth has no handholds: only the aerial escort reaches its lip.
      picked.push({ id: 'tzatzul-spire-' + c + '-' + r, area, x, z, baseY, height, levels, nest, seed: hash(area + ':' + c + ':' + r) });
    }
    return picked;
  }
  function shelfAt(spire, level, index, grid) {
    const x = spire.x + level.offsetX, z = spire.z + level.offsetZ;
    return {
      id: spire.id + '-level-' + index, x, z, y: level.y,
      width: level.width, depth: level.depth,
      tangent: { x: 1, z: 0 }, normal: { x: 0, z: 1 },
      aerialOnly: true, spireId: spire.id, reward: null,
      footprint: footprint(grid, x, z, level.width, level.depth, level.y),
    };
  }
  function install(network, grid, opts = {}) {
    if (!network || !Array.isArray(network.balconies)) return [];
    const area = String(network.area || opts.area || '');
    const spires = plan(area, grid, opts, network);
    const added = [];
    for (const spire of spires) {
      spire.shelves = spire.levels.map((level, index) => shelfAt(spire, level, index, grid));
      const nest = spire.nest;
      spire.nestShelf = {
        id: nest.id, x: nest.x, z: nest.z, y: nest.y,
        width: nest.width, depth: nest.depth,
        tangent: { x: 1, z: 0 }, normal: { x: 0, z: 1 },
        aerialOnly: true, spireNest: true, spireId: spire.id,
        reward: null, footprint: footprint(grid, nest.x, nest.z, nest.width, nest.depth, nest.y),
      };
      added.push(...spire.shelves, spire.nestShelf);
    }
    network.balconies.push(...added);
    network.tzatzulSpires = spires;
    byArea.set(area, { network, spires });
    return spires;
  }
  function ring(x, y, z, radiusX, radiusZ, seed, stage) {
    const points = [];
    for (let i = 0; i < NUM_SIDES; i++) {
      const angle = TAU * i / NUM_SIDES;
      const irregularity = .86 + (hash(seed + ':' + i) % 30) / 100;
      points.push([x + Math.cos(angle) * radiusX * irregularity,
        y + (stage ? ((hash(seed + ':y:' + i) % 5) - 2) * .025 : 0),
        z + Math.sin(angle) * radiusZ * irregularity]);
    }
    return points;
  }
  function render(THREE, scene, network, stoneMaterial, topMaterial) {
    if (!THREE || !scene || !network?.tzatzulSpires?.length) return [];
    const stone = [], tops = []; // Fused per-zone stone/top buffers avoid a mesh per rock layer.
    const addTri = (list, a, b, c) => list.push(...a, ...b, ...c);
    for (const spire of network.tzatzulSpires) {
      let previousY = spire.baseY;
      for (let i = 0; i < spire.levels.length; i++) {
        const level = spire.levels[i], x = spire.x + level.offsetX, z = spire.z + level.offsetZ;
        const top = ring(x, level.y, z, level.width / 2, level.depth / 2, spire.seed + i, true);
        const bottom = ring(x, previousY, z, level.width * .40, level.depth * .40, spire.seed + i, false);
        const center = [x, level.y, z];
        for (let j = 0; j < NUM_SIDES; j++) {
          const k = (j + 1) % NUM_SIDES;
          addTri(tops, center, top[j], top[k]);
          addTri(stone, top[k], top[j], bottom[j]);
          addTri(stone, top[k], bottom[j], bottom[k]);
        }
        previousY = level.y;
      }
      // A flat, rock-backed pocket cuts into the midpoint of the tallest incline.
      const nest = spire.nest, side = nest.side;
      const left = nest.x - nest.width * .5, right = nest.x + nest.width * .5;
      const near = nest.z - side * .25, far = nest.z + side * nest.depth;
      const cap = [[left, nest.y, near], [right, nest.y, near], [right, nest.y, far], [left, nest.y, far]];
      addTri(tops, cap[0], cap[1], cap[2]);
      addTri(tops, cap[0], cap[2], cap[3]);
      const floor = [left + nest.width * .25, nest.y - .9, near - side * .4];
      addTri(stone, cap[0], cap[1], floor);
      // Opening lies on the exposed cliff face, behind the true elevated shelf.
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.55, 18),
        new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.DoubleSide, depthWrite: true }));
      mouth.position.set(nest.x, nest.y + .62, near - side * .17);
      mouth.scale.set(1, 1.25, 1);
      mouth.rotation.y = side > 0 ? Math.PI : 0;
      mouth.name = nest.id + '-cave-mouth';
      mouth.userData.tzatzulNestEntrance = { ...nest, area: network.area };
      mouth.userData.terrainJigsawIgnore = true;
      scene.add(mouth);
      spire.mouthMesh = mouth;
    }
    const positions = [...tops, ...stone], geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.addGroup(0, tops.length / 3, 0);
    geometry.addGroup(tops.length / 3, stone.length / 3, 1);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, [topMaterial || stoneMaterial, stoneMaterial]);
    mesh.name = network.area + '-tzatzul-layered-spires';
    mesh.userData.hobunjiGroundSurface = true;
    mesh.userData.cameraObstacle = true;
    mesh.userData.terrainJigsawIgnore = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return [mesh, ...network.tzatzulSpires.map(spire => spire.mouthMesh)];
  }
  function forArea(area) { return byArea.get(String(area))?.spires || []; }
  function clear(area) { byArea.delete(String(area)); }
  function debugSnapshot() { return [...byArea.entries()].map(([area, record]) => ({
    area, spires: record.spires.length,
    nests: record.spires.map(s => ({ id: s.nest.id, x: s.nest.x, z: s.nest.z, y: s.nest.y, entrance: s.nest.caveMapId })),
  })); }
  return Object.freeze({ plan, install, render, forArea, clear, debugSnapshot, footprint });
});
