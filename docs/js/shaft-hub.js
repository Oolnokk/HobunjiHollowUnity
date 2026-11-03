// ShaftHub — a vertical hub room, composed on a CellGrid3D after the fact (see docs/architecture/vertical-grid.md).
//
//        ┌───────────── ceiling ─────────────┐
//        │   door ◄── balcony 3 (top of a    │      A hollow shaft in thick walls. Balconies are cantilevered
//        │            buttress, 12 up)       │      from the walls: each is the flat top of a solid buttress
//        │                    balcony 2 ──► door    whose shaft-facing side is a climbable surface. You attach to
//        │ door ◄─ balcony 1 (4 up)          │      the buttress, move along it in normal space, and push up at
//        │                                   │      the top to mantle onto the balcony. A door tunnels through the
//        └─── entrance (ground) ─────────────┘      wall from each balcony to the outside.
//
// Why buttresses: ClimbSurfaces' mantle lands on top of the wall you climbed, so the thing you climb must be a solid
// mass whose top is the walkable floor. That is also the Zelda shape (a ledge you haul yourself onto).
//
// compose() builds the grid, then *proves* the room works: every balcony and door is reachable from the entrance by a
// graph of walking and climbing (the same CellGrid3D walking rules, and a climb edge per merged wall rectangle), every
// standable cell has headroom, door tunnels are clear. A hub that fails a check reports why instead of being returned.
//
// Pure logic over CellGrid3D (and ClimbSurfaces for mount()); runs under node and in the browser.
(function (root, factory) {
  const isCjs = typeof module === 'object' && module.exports;
  const api = factory(isCjs ? require('./cell-grid-3d.js') : root.CellGrid3D);
  if (isCjs) module.exports = api;
  else root.ShaftHub = api;
})(typeof self !== 'undefined' ? self : globalThis, function (G) {
  'use strict';
  const { KIND, DIR } = G;

  const SIDES = ['N', 'E', 'S', 'W'];
  const OPPOSITE_DIR = { N: DIR.S, S: DIR.N, E: DIR.W, W: DIR.E }; // a balcony on the N wall faces its climbable side S, into the shaft
  const OUTWARD = { N: { c: 0, r: -1 }, S: { c: 0, r: 1 }, E: { c: 1, r: 0 }, W: { c: -1, r: 0 } };
  const rng = seed => { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  const DEFAULTS = Object.freeze({
    shaft: 7,        // interior width/depth in cells (odd, so a door sits on the centre line)
    wall: 3,         // thickness of the shell
    balconies: 3,    // 1..3, one per side; the fourth side is the entrance
    spacing: 4,      // levels between balcony floors (>= 3 so each has 2 cells of headroom above it)
    depth: 2,        // how far a balcony reaches into the shaft
    length: 3,       // how wide a balcony is (odd)
    climbStyle: 'holds',
    landings: false, // Reserve an enclosed chamber at the end of each balcony corridor.
    chambers: false, // Extend landings into seeded side rooms for the V50 wing.
    seed: 1,
    originX: 0, originZ: 0, baseY: 0,
  });

  // Cells of a side's buttress, its door tunnel and the front row (the climbable one), in grid coordinates.
  function sideGeometry(side, o, cols, rows) {
    const mid = o.wall + (o.shaft - 1) / 2, half = Math.floor(o.length / 2);
    const span = [];
    for (let k = -half; k <= half; k++) span.push(mid + k);
    const lo = o.wall, hi = o.wall + o.shaft - 1; // interior extent on both axes
    const g = { side, buttress: [], front: [], tunnel: [], top: [], mid };
    for (const a of span) {
      for (let d = 0; d < o.depth; d++) {
        let c, r;
        if (side === 'N') { c = a; r = lo + d; } else if (side === 'S') { c = a; r = hi - d; } else if (side === 'W') { c = lo + d; r = a; } else { c = hi - d; r = a; }
        g.buttress.push({ c, r, wallRow: d === 0 });
        if (d === o.depth - 1) g.front.push({ c, r });
      }
    }
    // tunnel: the centre line from the wall-adjacent buttress row out to the grid edge
    const out = OUTWARD[side];
    const first = side === 'N' ? { c: mid, r: lo } : side === 'S' ? { c: mid, r: hi } : side === 'W' ? { c: lo, r: mid } : { c: hi, r: mid };
    for (let c = first.c, r = first.r; c >= 0 && r >= 0 && c < cols && r < rows; c += out.c, r += out.r) g.tunnel.push({ c, r });
    g.top = g.buttress.slice();
    g.edge = g.tunnel[g.tunnel.length - 1];
    return g;
  }

  function compose(options = {}) {
    const o = { ...DEFAULTS, ...options };
    if (o.chambers) o.landings = true;
    o.wall = Math.max(o.chambers ? 8 : o.landings ? 5 : 1, o.wall | 0);
    o.shaft = Math.max(5, o.shaft | 0 | 1);             // odd, at least 5
    o.length = Math.min(o.shaft - 2, Math.max(1, o.length | 0 | 1)); // odd and leaving open corners
    o.balconies = Math.max(1, Math.min(3, o.balconies | 0));
    o.spacing = Math.max(3, o.spacing | 0);
    o.depth = Math.max(1, Math.min(o.depth | 0, (o.shaft - 1) / 2 - Math.floor(o.length / 2))); // buttresses on neighbouring sides must not run into each other
    const cols = o.shaft + 2 * o.wall, rows = cols, topStand = o.spacing * o.balconies, levels = topStand + 3;
    const grid = G.create({ cols, rows, levels, originX: o.originX, originZ: o.originZ, baseY: o.baseY });
    const random = rng(o.seed), turn = Math.floor(random() * 4);
    const sides = [0, 1, 2, 3].map(i => SIDES[(i + turn) % 4]);
    const balconySides = sides.slice(0, o.balconies), entranceSide = sides[3];

    grid.fillBox(0, 0, 0, cols - 1, rows - 1, levels - 1, KIND.SOLID);                       // the whole mass...
    grid.fillBox(o.wall, o.wall, 0, o.wall + o.shaft - 1, o.wall + o.shaft - 1, levels - 2, KIND.AIR); // ...hollowed to a shaft under a ceiling
    const balconies = [], doors = [];
    balconySides.forEach((side, k) => {
      const level = o.spacing * (k + 1), geo = sideGeometry(side, o, cols, rows);
      for (const cell of geo.buttress) grid.fillBox(cell.c, cell.r, 0, cell.c, cell.r, level - 1, KIND.SOLID);
      for (const cell of geo.front) grid.paintClimbFaces(cell.c, cell.r, 0, cell.c, cell.r, level - 1, OPPOSITE_DIR[side], o.climbStyle);
      const tunnel = o.landings ? geo.tunnel.slice(0,-1) : geo.tunnel; // Keep the outermost wall intact behind a landing.
      for (const cell of tunnel) { // door: 1 wide, 2 high, from the wall-adjacent row out
        if (geo.buttress.some(b => b.c === cell.c && b.r === cell.r && !b.wallRow)) continue;
        grid.fillBox(cell.c, cell.r, level, cell.c, cell.r, level + 1, KIND.AIR);
      }
      const destination = tunnel[tunnel.length-1]; // Last walkable cell of the corridor.
      const chamber = []; // Keep the floor and ceiling solid around the generated room volume.
      if (o.landings) {
        const out = OUTWARD[side];
        const depth = o.chambers ? 2 + Math.floor(random() * 3) : 1;
        const halfWidth = o.chambers && random() < .5 ? 2 : 1;
        for (let d=0;d<depth;d++) for (let offset=-halfWidth;offset<=halfWidth;offset++) {
          const c=destination.c-d*out.c+offset*out.r,r=destination.r-d*out.r+offset*out.c;
          grid.fillBox(c,r,level,c,r,level+1,KIND.AIR);
          chamber.push({col:c,row:r});
        }
      }
      balconies.push({ index: k, side, level, y: grid.levelToY(level), cells: geo.top.map(t => ({ col: t.c, row: t.r })), front: geo.front, climbDir: OPPOSITE_DIR[side] });
      doors.push({ balcony: k, side, level, col: destination.c, row: destination.r, tunnel: tunnel.map(t => ({ col: t.c, row: t.r })), outward: OUTWARD[side], chamber });
    });
    // ground entrance: same tunnel, level 0
    const eg = sideGeometry(entranceSide, { ...o, depth: 1 }, cols, rows);
    for (const cell of eg.tunnel) grid.fillBox(cell.c, cell.r, 0, cell.c, cell.r, 1, KIND.AIR);
    const entrance = { side: entranceSide, level: 0, col: eg.edge.c, row: eg.edge.r, inside: eg.tunnel[0], outward: OUTWARD[entranceSide] };

    const surfaces = grid.collectClimbSurfaces();
    const result = { ok: false, options: o, grid, cols, rows, levels, balconies, doors, entrance, surfaces, checks: [] };
    result.checks = verify(result);
    result.ok = result.checks.every(c => c.ok);
    return result;
  }

  // ---------------------------------------------------------------- proof
  function reachable(result) {
    const { grid, entrance, surfaces } = result, key = (c, r, l) => `${c},${r},${l}`, seen = new Map(), queue = [];
    const startCell = { c: entrance.inside.c - 0, r: entrance.inside.r - 0 };
    const startLevel = grid.floorLevelAt(startCell.c, startCell.r, 0);
    const push = (c, r, l, via) => { const k = key(c, r, l); if (seen.has(k)) return; seen.set(k, via); queue.push([c, r, l]); };
    if (startLevel >= 0) push(startCell.c, startCell.r, startLevel, 'start');
    // climb edges: a merged wall rectangle links the floor in front of its bottom with the floor on top of it (both directions)
    const climbEdges = [];
    for (const s of surfaces) {
      const uMid = (s.u0 + s.u1) / 2, n = s.normal;
      const wx = s.axis === 'x' ? uMid : s.plane, wz = s.axis === 'x' ? s.plane : uMid;
      const front = { c: grid.xToCol(wx + n.x * 0.5), r: grid.zToRow(wz + n.z * 0.5) }, onTop = { c: grid.xToCol(wx - n.x * 0.5), r: grid.zToRow(wz - n.z * 0.5) };
      const bottomLevel = grid.yToLevel(s.y0), topLevel = grid.yToLevel(s.y1);
      if (grid.canStand(front.c, front.r, bottomLevel) && grid.canStand(onTop.c, onTop.r, topLevel)) {
        // every column of the wall rectangle works the same way: it spans u0..u1
        for (let u = s.u0 + grid.cellSize / 2; u < s.u1; u += grid.cellSize) {
          const wx2 = s.axis === 'x' ? u : s.plane, wz2 = s.axis === 'x' ? s.plane : u;
          const f2 = { c: grid.xToCol(wx2 + n.x * 0.5), r: grid.zToRow(wz2 + n.z * 0.5) }, t2 = { c: grid.xToCol(wx2 - n.x * 0.5), r: grid.zToRow(wz2 - n.z * 0.5) };
          if (grid.canStand(f2.c, f2.r, bottomLevel) && grid.canStand(t2.c, t2.r, topLevel)) climbEdges.push({ from: [f2.c, f2.r, bottomLevel], to: [t2.c, t2.r, topLevel] });
        }
      }
    }
    while (queue.length) {
      const [c, r, l] = queue.shift();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const d = grid.walkDestinationLevel(c + dc, r + dr, l, { maxDrop: 1 });
        if (d >= 0 && grid.canStand(c + dc, r + dr, d)) push(c + dc, r + dr, d, 'walk');
      }
      for (const e of climbEdges) {
        if (e.from[0] === c && e.from[1] === r && e.from[2] === l) push(e.to[0], e.to[1], e.to[2], 'climb up');
        if (e.to[0] === c && e.to[1] === r && e.to[2] === l) push(e.from[0], e.from[1], e.from[2], 'climb down');
      }
    }
    return { seen, climbEdges, has: (c, r, l) => seen.has(key(c, r, l)) };
  }

  function verify(result) {
    const { grid, balconies, doors, entrance, options: o } = result, checks = [], add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail ?? null });
    const reach = reachable(result);
    add('entranceOpen', grid.floorLevelAt(entrance.inside.c, entrance.inside.r, 0) === 0, 'the ground entrance leads onto the shaft floor');
    add('spacing', o.spacing >= 3, `balcony floors are ${o.spacing} apart (2 cells of headroom needed above each)`);
    for (const b of balconies) {
      const stands = b.cells.filter(c => grid.canStand(c.col, c.row, b.level));
      add(`balcony${b.index}Standable`, stands.length === b.cells.length, `${stands.length}/${b.cells.length} balcony cells have a floor and 2 cells of headroom`);
      add(`balcony${b.index}Climbable`, result.surfaces.some(s => s.y0 <= grid.levelToY(0) + 1e-6 && Math.abs(s.y1 - grid.levelToY(b.level)) < 1e-6), 'a wall rectangle runs from the ground to the balcony floor');
      add(`balcony${b.index}Reachable`, b.cells.some(c => reach.has(c.col, c.row, b.level)), 'reachable from the entrance by walking and climbing');
    }
    for (const d of doors) {
      add(`door${d.balcony}Reachable`, reach.has(d.col, d.row, d.level), 'the door’s outer end is reachable from the entrance');
      if (d.chamber.length) add(`door${d.balcony}ChamberReachable`, d.chamber.every(cell => reach.has(cell.col,cell.row,d.level)), 'all chamber cells are reachable at balcony height');
      add(`door${d.balcony}Clear`, d.tunnel.every(t => !grid.isSolid(t.col, t.row, d.level) && !grid.isSolid(t.col, t.row, d.level + 1)), 'the tunnel is open 2 cells high from the balcony to the outside');
    }
    if (o.landings) add('landingsEnclosed', doors.every(d => grid.isSolid(d.col+d.outward.c,d.row+d.outward.r,d.level)), 'each corridor terminates inside the shaft shell');
    else add('doorsOutside', doors.every(d => d.col === 0 || d.row === 0 || d.col === result.cols - 1 || d.row === result.rows - 1), 'every door ends at the edge of the hub, where a corridor can attach');
    return checks;
  }

  // ---------------------------------------------------------------- game glue
  const mounts = new Map(); // Owns mounted geometry, support and climb registrations by scope.

  function buildVisual(result, THREE, climb) {
    const { grid } = result;
    const shell = new THREE.Group(); // Owns the shaft shell, bedrock floor and climb markings.
    shell.name = 'shaft-hub';
    const exposed = []; // Only surface cells contribute meshes, including the inside of the tunnels.
    const faces = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (let l = 0; l < grid.levels; l++) for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
      if (grid.isSolid(c,r,l) && faces.some(([dc,dr,dl]) =>
        !grid.inBounds(c+dc,r+dr,l+dl) || !grid.isSolid(c+dc,r+dr,l+dl))) exposed.push([c,r,l]);
    }
    const material = new THREE.MeshBasicMaterial({ color: 0x57534d });
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(grid.cellSize,grid.cellHeight,grid.cellSize),material,exposed.length);
    const matrix = new THREE.Matrix4(); // Reused across all exposed solid cells.
    exposed.forEach(([c,r,l],i) => blocks.setMatrixAt(i,matrix.makeTranslation(
      grid.colToX(c+.5),grid.levelToY(l+.5),grid.rowToZ(r+.5))));
    shell.add(blocks);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(grid.cols*grid.cellSize,.1,grid.rows*grid.cellSize),material);
    floor.position.set(grid.colToX(grid.cols/2),grid.baseY-.05,grid.rowToZ(grid.rows/2));
    shell.add(floor);
    if (climb?.buildVisual) for (const surface of result.surfaces) shell.add(climb.buildVisual(THREE,surface));
    return shell;
  }

  function mount(result, deps = {}) {
    const scope = deps.scope || 'shaft-hub', out = { surfaces: 0, floors: 0 };
    if (!result?.ok) return out;
    unmount(deps);
    const runtime = deps.DevRandomRuin?.getRuntimeContext?.(); // Use the current ruin scene when no explicit parent is supplied.
    const parent = deps.parent || runtime?.scene;
    const THREE = deps.THREE || globalThis.THREE;
    const visual = parent && THREE ? buildVisual(result,THREE,deps.ClimbSurfaces) : null;
    if (visual) parent.add(visual);
    if (deps.ClimbSurfaces) out.surfaces = deps.ClimbSurfaces.registerGrid(result.grid, { scope, idPrefix: scope });
    if (deps.DynamicSurfaces) out.floors = result.grid.registerWith(deps.DynamicSurfaces, { scope, idPrefix: scope, clearance: 2 });
    mounts.set(scope,{ deps, visual });
    deps.DevRandomRuin?.registerShaftGrid?.(scope,result.grid,() => unmount(deps));
    return out;
  }
  function unmount(deps = {}) {
    const scope = deps.scope || 'shaft-hub', mounted = mounts.get(scope);
    if (!mounted) return;
    mounts.delete(scope);
    mounted.deps.DevRandomRuin?.unregisterShaftGrid?.(scope);
    mounted.deps.ClimbSurfaces?.clearScope?.(scope);
    mounted.deps.DynamicSurfaces?.clearScope?.(scope);
    mounted.visual?.parent?.remove(mounted.visual);
    const materials = new Set(); // Shared by the wall/floor and individual climb markings.
    mounted.visual?.traverse(node => {
      node.geometry?.dispose();
      if (node.material) materials.add(node.material);
    });
    for (const material of materials) material.dispose();
  }

  // The abstract room (RuinComposer's input) for one standing level of the hub: the walkable footprint at that level.
  function levelRoom(result, level) {
    const { grid } = result; // open = something to stand on at this level, with headroom; the shaft's empty air at a balcony level is not floor
    const solid = (x, z) => !grid.canStand(grid.xToCol(x), grid.zToRow(z), level);
    return { id: `shaft-level-${level}`, bounds: { minX: grid.colToX(0), maxX: grid.colToX(result.cols), minZ: grid.rowToZ(0), maxZ: grid.rowToZ(result.rows) }, floorY: grid.levelToY(level), ceilingY: grid.levelToY(result.levels - 1), zones: {}, gaps: [], solid };
  }

  return Object.freeze({ DEFAULTS, compose, verify, reachable, mount, unmount, levelRoom });
});
