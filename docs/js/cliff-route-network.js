// Exterior cliff route network: discrete directional handhold hops plus stacked miniature ledges.
// Data/math is Node-testable; THREE is only used by render(). Ruin and tree climbers are untouched.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CliffRouteNetwork = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRS = Object.freeze([{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]);
  const cache = new WeakMap(); // Grid identity -> the immutable-in-practice climb/navigation network.
  const activeByArea = new Map(); // Area -> latest network, used for mobile debug and landing queries.
  const debug = { builds: 0, lastArea: null, lastError: null };
  const key = (c, r) => c + ',' + r;
  const hash = (c, r, salt = 0) => {
    let h = Math.imul((c | 0) + 4177, 73856093) ^ Math.imul((r | 0) + 331, 19349663) ^ Math.imul((salt | 0) + 19, 83492791);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    return (h ^ (h >>> 13)) >>> 0;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const surface = (t, opts) => Number(opts.tileY?.(t) ?? ((t.elevTier || 0) * (opts.plateauUnit || 2.5)));
  const defaultBlocked = t => !t || t.incline || t.borderEscarpment || t.distantBoundaryLandscape || t.type === 'rock' || t.type === 'wall';

  function build(grid, opts = {}) {
    if (!Array.isArray(grid)) throw new TypeError('CliffRouteNetwork.build requires a row-major grid');
    const rows = grid.length, cols = Math.max(0, ...grid.map(r => r?.length || 0));
    const get = (c, r) => (c >= 0 && c < cols && r >= 0 && r < rows ? grid[r]?.[c] : null);
    const blocked = opts.blocked || defaultBlocked;
    const walkable = (c, r) => {
      const t = get(c, r);
      return !!t && !blocked(t) && !opts.isBoundary?.(t);
    };
    const component = new Int32Array(cols * rows).fill(-1); // Walkable ground component for route-graph flood fill.
    const components = [];
    const tileId = (c, r) => r * cols + c;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!walkable(c, r) || component[tileId(c, r)] !== -1) continue;
      const id = components.length, cells = [], todo = [[c, r]];
      component[tileId(c, r)] = id;
      for (let i = 0; i < todo.length; i++) {
        const [x, z] = todo[i], t = get(x, z);
        cells.push([x, z]);
        for (const d of DIRS) {
          const nx = x + d.x, nz = z + d.z, nt = get(nx, nz);
          if (!walkable(nx, nz) || component[tileId(nx, nz)] !== -1) continue;
          // A height discontinuity is not a walking edge. Authored ramps are already real walkable tiles.
          if (Math.abs(surface(t, opts) - surface(nt, opts)) > 0.55 && !(t.type === 'ramp' || nt.type === 'ramp')) continue;
          component[tileId(nx, nz)] = id;
          todo.push([nx, nz]);
        }
      }
      components.push({ id, cells, tier: Number(get(c, r)?.elevTier) || 0 });
    }
    const candidates = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!walkable(c, r)) continue;
      const lower = get(c, r), fromComp = component[tileId(c, r)];
      for (const dir of DIRS) {
        let x = c, z = r, walls = 0;
        for (let i = 0; i < (opts.maxWallTiles || 4); i++) {
          x += dir.x; z += dir.z;
          const t = get(x, z);
          if (!t || opts.isBoundary?.(t)) break;
          if (t.incline) { walls++; continue; }
          if (walls && walkable(x, z) && surface(t, opts) > surface(lower, opts) + 0.5) {
            const toComp = component[tileId(x, z)];
            if (toComp !== fromComp) candidates.push({ a: { c, r }, b: { c: x, r: z }, aComp: fromComp, bComp: toComp, dir, walls, y0: surface(lower, opts), y1: surface(t, opts), weight: walls * 12 + hash(c, r, x * 71 + z) % 12 });
          }
          break;
        }
      }
    }
    candidates.sort((a, b) => a.weight - b.weight);
    const parent = components.map((_, i) => i); // Spanning forest: every component with a possible connection receives at least one route.
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const routes = [], selected = [], busy = [];
    for (const candidate of candidates) {
      const a = find(candidate.aComp), b = find(candidate.bComp);
      const required = a !== b;
      const midx = (candidate.a.c + candidate.b.c + 1) / 2, midz = (candidate.a.r + candidate.b.r + 1) / 2;
      const spaced = busy.every(p => Math.hypot(p.x - midx, p.z - midz) >= 7);
      const optional = spaced && hash(candidate.a.c, candidate.a.r, candidate.b.c + candidate.b.r) % 100 < 12;
      if (!required && !optional) continue;
      selected.push(candidate); busy.push({ x: midx, z: midz });
      if (required) parent[b] = a;
    }
    const balconies = [];
    for (const c of selected) {
      const id = routes.length, h = Math.abs(c.y1 - c.y0);
      const spans = clamp(Math.ceil(Math.max(h / 0.54, (c.walls + 1) / 0.56)), 3, 95);
      const tan = { x: -c.dir.z, z: c.dir.x }, normal = { x: -c.dir.x, z: -c.dir.z };
      const nodes = [];
      for (let i = 0; i <= spans; i++) {
        const t = i / spans;
        const wiggle = (i === 0 || i === spans) ? 0
          : (Math.sin(t * Math.PI * (2 + (hash(c.a.c, c.a.r, 5) % 3))) * 0.32);
        nodes.push({
          id: i, x: c.a.c + 0.5 + (c.b.c - c.a.c) * t + tan.x * wiggle,
          z: c.a.r + 0.5 + (c.b.r - c.a.r) * t + tan.z * wiggle,
          y: c.y0 + (c.y1 - c.y0) * t, links: [],
        });
        if (i) { nodes[i - 1].links.push(i); nodes[i].links.push(i - 1); }
      }
      // Branching sideways detours make these actual climbing paths, not a disguised timed auto-climb.
      for (let i = 3; i < spans - 2; i += 5) {
        const sign = hash(c.a.c, c.a.r, i) & 1 ? 1 : -1;
        const at = nodes[i];
        const branchId = nodes.length;
        nodes.push({
          id: branchId, x: at.x + tan.x * sign * 0.58, z: at.z + tan.z * sign * 0.58,
          y: at.y + 0.02, links: [i, i + 1],
        });
        nodes[i].links.push(branchId); nodes[i + 1].links.push(branchId);
      }
      const route = { id, a: c.a, b: c.b, aComp: c.aComp, bComp: c.bComp, dir: c.dir, tangent: tan, normal, nodes, upperNode: spans };
      if (h >= 1.5 && hash(c.a.c, c.a.r, 83) % 100 < 38) {
        const count = h >= 8 ? 2 : 1;
        for (let j = 0; j < count; j++) {
          const idx = clamp(Math.round(spans * (j + 1) / (count + 1)), 2, spans - 2), anchor = nodes[idx];
          const shelf = {
            id: 'cliff-balcony-' + id + '-' + j, routeId: id, nodeId: nodes.length,
            x: anchor.x + normal.x * 0.19, z: anchor.z + normal.z * 0.19,
            y: anchor.y, width: 1.25, depth: 0.95, tangent: tan, normal,
            footprint: [{ c: Math.floor(anchor.x), r: Math.floor(anchor.z), elevation: anchor.y }],
            reward: hash(c.a.c, c.a.r, 94 + j) % 2 ? 'buriedTreasure' : 'oreRock',
          };
          nodes.push({ id: shelf.nodeId, x: shelf.x, z: shelf.z, y: shelf.y, links: [idx], balconyId: shelf.id });
          nodes[idx].links.push(shelf.nodeId);
          balconies.push(shelf);
        }
      }
      routes.push(route);
    }
    const adjacency = components.map(() => []); // Component graph used by creatures to find a real path instead of popping up a wall.
    for (const route of routes) {
      adjacency[route.aComp].push({ next: route.bComp, route, entry: 0 });
      adjacency[route.bComp].push({ next: route.aComp, route, entry: route.upperNode });
    }
    const connectedRoots = new Set(components.map((_, i) => find(i)));
    const network = { area: opts.area || null, grid, cols, rows, components, component, routes, balconies, adjacency,
      unconnectedComponents: Math.max(0, connectedRoots.size - 1), candidateCount: candidates.length };
    debug.builds++; debug.lastArea = network.area;
    return network;
  }

  function forGrid(grid, opts = {}) {
    if (!grid) return null;
    let network = cache.get(grid);
    if (!network) {
      network = build(grid, opts);
      cache.set(grid, network);
    }
    if (opts.area) activeByArea.set(opts.area, network);
    return network;
  }
  function componentAt(network, c, r) {
    return network && c >= 0 && r >= 0 && c < network.cols && r < network.rows ? network.component[r * network.cols + c] : -1;
  }
  function crossing(network, fromCol, fromRow, toCol, toRow) {
    if (!network) return null;
    for (const route of network.routes) {
      if (route.a.c === fromCol && route.a.r === fromRow && route.b.c === toCol && route.b.r === toRow) return { route, entry: 0 };
      if (route.b.c === fromCol && route.b.r === fromRow && route.a.c === toCol && route.a.r === toRow) return { route, entry: route.upperNode };
    }
    return null;
  }
  function toward(network, fromCol, fromRow, toCol, toRow) {
    const a = componentAt(network, fromCol, fromRow), b = componentAt(network, toCol, toRow);
    if (a < 0 || b < 0 || a === b) return null;
    const queue = [a], seen = new Set([a]), first = new Map();
    for (let i = 0; i < queue.length; i++) {
      for (const edge of network.adjacency[queue[i]]) {
        if (seen.has(edge.next)) continue;
        seen.add(edge.next);
        first.set(edge.next, queue[i] === a ? edge : first.get(queue[i]));
        if (edge.next === b) return first.get(b);
        queue.push(edge.next);
      }
    }
    return null;
  }
  function nextHop(route, nodeId, input) {
    const node = route?.nodes[nodeId];
    if (!node) return null;
    const norm = Math.hypot(input.x || 0, input.z || 0);
    if (norm < 0.32) return null;
    let choice = null, best = 0.31;
    for (const id of node.links) {
      const to = route.nodes[id];
      const du = (to.x - node.x) * route.tangent.x + (to.z - node.z) * route.tangent.z;
      const dv = (to.y - node.y) / 1.15;
      const length = Math.hypot(du, dv);
      if (length < 0.02) continue;
      const wantU = ((input.x || 0) * route.tangent.x + (input.z || 0) * route.tangent.z) / norm;
      const wantV = -((input.x || 0) * route.normal.x + (input.z || 0) * route.normal.z) / norm;
      const dot = (du * wantU + dv * wantV) / length;
      if (dot > best) { best = dot; choice = to; }
    }
    return choice;
  }
  function shelfContains(shelf, x, z, pad = 0) {
    const dx = x - shelf.x, dz = z - shelf.z;
    return Math.abs(dx * shelf.tangent.x + dz * shelf.tangent.z) <= shelf.width / 2 + pad &&
      Math.abs(dx * shelf.normal.x + dz * shelf.normal.z) <= shelf.depth / 2 + pad;
  }
  function shelfAt(network, id) { return network?.balconies.find(s => s.id === id) || null; }
  function highestBelow(network, x, z, fromY, baseY = -Infinity) {
    let found = null;
    for (const s of (network?.balconies || [])) {
      if (s.y < fromY - 0.08 && s.y > baseY + 0.08 && shelfContains(s, x, z) && (!found || s.y > found.y)) found = s;
    }
    return found;
  }

  let _holdMaterial = null; // Shared by all zone decals to avoid duplicate texture downloads and shader programs.
  let _stoneMaterial = null; // Shared rock material for actual stacked mini-cliff geometry.
  function render(THREE, scene, network) {
    if (!THREE || !scene || !network) return [];
    if (!_holdMaterial) {
      const texture = new THREE.TextureLoader().load('assets/textures/carved_smooth.png');
      if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      _holdMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
      _stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x77766e, roughness: 1 });
    }
    const vertices = [], uvs = [];
    const uvSteps = [0, 0.32, 0.68, 1]; // Nine-slice margins preserve the carved border when each hold is stretched.
    for (const route of network.routes) for (const node of route.nodes) {
      if (node.id === 0 || node.id === route.upperNode || node.balconyId) continue;
      const h = hash(Math.floor(node.x * 13), Math.floor(node.y * 13), route.id);
      const width = 0.21 + (h % 100) / 900, height = 0.23 + ((h >>> 8) % 100) / 800;
      const skew = (((h >>> 16) % 100) / 100 - 0.5) * width * 0.4;
      const xs = [-width / 2, -width * 0.23, width * 0.23, width / 2];
      const ys = [-height / 2, -height * 0.21, height * 0.21, height / 2];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const corner = (ix, iy) => {
          const w = xs[ix] + skew * (iy / 3 - 0.5);
          const up = ys[iy] + (ix === 0 || ix === 3 ? Math.sin((h % 13) + iy * 2) * 0.025 : 0);
          return [node.x + route.tangent.x * w + route.normal.x * 0.04, node.y + up, node.z + route.tangent.z * w + route.normal.z * 0.04];
        };
        const p00 = corner(c, r), p10 = corner(c + 1, r), p01 = corner(c, r + 1), p11 = corner(c + 1, r + 1);
        vertices.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
        uvs.push(uvSteps[c], 1 - uvSteps[r], uvSteps[c + 1], 1 - uvSteps[r], uvSteps[c + 1], 1 - uvSteps[r + 1],
          uvSteps[c], 1 - uvSteps[r], uvSteps[c + 1], 1 - uvSteps[r + 1], uvSteps[c], 1 - uvSteps[r + 1]);
      }
    }
    const meshes = [];
    if (vertices.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      const decals = new THREE.Mesh(geometry, _holdMaterial);
      decals.name = network.area + '-cliff-handhold-decals';
      decals.userData.cliffRoutes = true;
      decals.userData.terrainJigsawIgnore = true;
      scene.add(decals); meshes.push(decals);
    }
    for (const s of network.balconies) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.width, 0.16, s.depth), _stoneMaterial);
      mesh.position.set(s.x, s.y - 0.08, s.z);
      mesh.rotation.y = Math.atan2(-s.tangent.z, s.tangent.x);
      mesh.userData.cliffBalconyId = s.id;
      mesh.userData.terrainJigsawIgnore = true;
      mesh.name = s.id;
      mesh.receiveShadow = true;
      scene.add(mesh); meshes.push(mesh);
    }
    return meshes;
  }
  return Object.freeze({
    build, forGrid, componentAt, crossing, toward, nextHop, shelfContains, shelfAt, highestBelow, render,
    forArea: area => activeByArea.get(area) || null,
    debugSnapshot: () => ({ ...debug, areas: [...activeByArea.entries()].map(([area,n]) => ({
      area, routes: n.routes.length, balconies: n.balconies.length,
      components: n.components.length, disconnectedSets: n.unconnectedComponents, candidates: n.candidateCount,
    })) }),
  });
});
