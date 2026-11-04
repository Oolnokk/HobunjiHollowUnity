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
  const rewardStateByArea = new Map(); // Save-restorable per-balcony dig, mining and chest-claim progress.
  const rewardMeshesByArea = new Map(); // Scene-only reward meshes toggled as stages change, never serialized.
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
            x: anchor.x + tan.x * (j % 2 ? -0.4 : 0.4) + normal.x * 0.19,
            z: anchor.z + tan.z * (j % 2 ? -0.4 : 0.4) + normal.z * 0.19,
            y: anchor.y,
            width: 1.7 + (hash(c.a.c, c.a.r, 64 + j) % 7) * 0.16, // Two-to-three tile micro-plateau width.
            depth: 1.0 + (hash(c.a.c, c.a.r, 67 + j) % 5) * 0.13, // Narrow overhanging shelf depth.
            tangent: tan, normal, footprint: [], // Tile/elevation cells never overwrite the ordinary ground grid.
            reward: hash(c.a.c, c.a.r, 94 + j) % 2 ? 'buriedTreasure' : 'oreRock',
          };
          const extent = Math.ceil(Math.max(shelf.width, shelf.depth)) + 1;
          for (let dr = -extent; dr <= extent; dr++) for (let dc = -extent; dc <= extent; dc++) {
            const cc = Math.floor(shelf.x) + dc, rr = Math.floor(shelf.z) + dr;
            if (cc >= 0 && rr >= 0 && cc < cols && rr < rows &&
                shelfContains(shelf, cc + 0.5, rr + 0.5, 0.18))
              shelf.footprint.push({ c: cc, r: rr, elevation: shelf.y });
          }
          if (!shelf.footprint.length) shelf.footprint.push({ c: Math.floor(shelf.x), r: Math.floor(shelf.z), elevation: shelf.y });
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
    if (opts.rebuild) cache.delete(grid); // Terrain edits rebuild the authoritative climb topology.
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
  function getRewardState(area, id) {
    let areaStates = rewardStateByArea.get(area);
    if (!areaStates) { areaStates = new Map(); rewardStateByArea.set(area, areaStates); }
    if (!areaStates.has(id)) areaStates.set(id, { revealed: false, claimed: false });
    return areaStates.get(id);
  }
  function setRewardStage(area, id, stage) {
    const state = getRewardState(area, id);
    if (stage === 'revealed') state.revealed = true;
    else if (stage === 'claimed') { state.revealed = true; state.claimed = true; }
    else return false;
    const handles = rewardMeshesByArea.get(area)?.get(id) || [];
    for (const handle of handles) {
      const visible = !state.claimed && (handle.kind === 'oreRock' || state.revealed);
      handle.mesh.setMatrixAt(handle.index, visible ? handle.matrix : handle.hidden);
      handle.mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  }
  function serializeRewards() {
    const saved = {};
    for (const [area, entries] of rewardStateByArea) {
      saved[area] = {};
      for (const [id, state] of entries) saved[area][id] = { revealed: !!state.revealed, claimed: !!state.claimed };
    }
    return saved;
  }
  function restoreRewards(saved) {
    rewardStateByArea.clear();
    for (const [area, entries] of Object.entries(saved || {})) {
      const states = new Map();
      for (const [id, value] of Object.entries(entries || {})) states.set(id, { revealed: !!value.revealed, claimed: !!value.claimed });
      rewardStateByArea.set(area, states);
    }
  }
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
    const rewardMeshes = new Map(); // Area-local visibility registry for ore and diggable treasure.
    rewardMeshesByArea.set(network.area, rewardMeshes);
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
    // A single instanced cap/ore/chest draw per zone replaces hundreds of
    // separate mesh draw calls on cliff-heavy maps (particularly mobile).
    const shelves = network.balconies;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0); // Invisible claimed/unrevealed reward matrix, with no instance list reallocation.
    const makeInstanced = (geometry, material, count, name) => {
      if (!count) return null;
      const inst = new THREE.InstancedMesh(geometry, material, count);
      inst.name = network.area + '-' + name;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.userData.terrainJigsawIgnore = true;
      inst.receiveShadow = true;
      scene.add(inst); meshes.push(inst);
      return inst;
    };
    const cap = makeInstanced(new THREE.BoxGeometry(1, 1, 1), _stoneMaterial, shelves.length, 'cliff-balconies');
    if (cap) {
      cap.userData.hobunjiGroundSurface = true;
      cap.userData.cameraObstacle = true;
    }
    const ores = shelves.filter(s => s.reward === 'oreRock');
    const chests = shelves.filter(s => s.reward !== 'oreRock');
    const oreMesh = makeInstanced(new THREE.DodecahedronGeometry(1, 0), _stoneMaterial, ores.length, 'cliff-balcony-ores');
    const chestWood = makeInstanced(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x6a4625, roughness: 0.82 }), chests.length, 'cliff-balcony-chest-bodies');
    const chestLid = makeInstanced(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xbe993b, roughness: 0.62 }), chests.length, 'cliff-balcony-chest-lids');
    const transform = (mesh, index, x, y, z, sx, sy, sz, yaw, visible, kind, shelfId) => {
      if (!mesh) return;
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      o.scale.set(sx, sy, sz);
      o.rotation.y = yaw;
      o.updateMatrix();
      const matrix = o.matrix.clone(); // Original transform is retained for stage-based reappearance.
      mesh.setMatrixAt(index, visible ? matrix : hidden);
      const handles = rewardMeshes.get(shelfId) || [];
      if (kind) { handles.push({ mesh, index, matrix, hidden, kind }); rewardMeshes.set(shelfId, handles); }
    };
    let oi = 0, ci = 0;
    for (let i = 0; i < shelves.length; i++) {
      const s = shelves[i], yaw = Math.atan2(-s.tangent.z, s.tangent.x);
      transform(cap, i, s.x, s.y - 0.08, s.z, s.width, 0.16, s.depth, yaw, true);
      const state = getRewardState(network.area, s.id);
      const visible = !state.claimed && (s.reward === 'oreRock' || state.revealed);
      if (s.reward === 'oreRock') {
        transform(oreMesh, oi++, s.x, s.y + 0.18, s.z, 0.32, 0.23, 0.29, yaw, visible, s.reward, s.id);
      } else {
        transform(chestWood, ci, s.x, s.y + 0.16, s.z, 0.42, 0.27, 0.3, yaw, visible, s.reward, s.id);
        transform(chestLid, ci, s.x, s.y + 0.33, s.z, 0.44, 0.075, 0.32, yaw, visible, s.reward, s.id);
        ci++;
      }
    }
    for (const mesh of [cap, oreMesh, chestWood, chestLid]) if (mesh) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere?.(); // Correct frustum culling across discontiguous balcony instances.
    }
    return meshes;
  }
  return Object.freeze({
    build, forGrid, componentAt, crossing, toward, nextHop, shelfContains, shelfAt, highestBelow, render,
    getRewardState, setRewardStage, serializeRewards, restoreRewards,
    forArea: area => activeByArea.get(area) || null,
    debugSnapshot: () => ({ ...debug, areas: [...activeByArea.entries()].map(([area,n]) => ({
      area, routes: n.routes.length, balconies: n.balconies.length,
      components: n.components.length, disconnectedSets: n.unconnectedComponents, candidates: n.candidateCount,
    })) }),
  });
});
