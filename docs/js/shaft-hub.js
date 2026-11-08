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
  const api = factory(isCjs ? require('./cell-grid-3d.js') : root.CellGrid3D, isCjs ? require('./ruin-wall-faces.js') : root.RuinWallFaces,
    isCjs ? require('./ruin-reaching-obelisks.js') : root.RuinReachingObelisks, isCjs ? require('./ruin-jump-shaft.js') : root.RuinJumpShaft);
  if (isCjs) module.exports = api;
  else root.ShaftHub = api;
})(typeof self !== 'undefined' ? self : globalThis, function (G, Faces, Obelisks, JumpShaft) {
  'use strict';
  const { KIND, DIR } = G;
  const PATCH = 6; // Largest stretch-to-fit patch of shaft stone, in world units (the V50 stone mapping uses the same 6).
  const FEATURE = { w:3, h:2, max:24 }; // A wall rectangle at least this big (cells) is a feature wall: its own mesh, so it can carry its own engraving. Only the `max` largest are engraved: each costs an engraving atlas, and GPU memory on phones is the limit.

  const SIDES = ['N', 'E', 'S', 'W'];
  const OPPOSITE_DIR = { N: DIR.S, S: DIR.N, E: DIR.W, W: DIR.E }; // a balcony on the N wall faces its climbable side S, into the shaft
  const OUTWARD = { N: { c: 0, r: -1 }, S: { c: 0, r: 1 }, E: { c: 1, r: 0 }, W: { c: -1, r: 0 } };
  const rng = seed => { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  const DEFAULTS = Object.freeze({
    shaft: 33,       // Comparable to V50's largest chambers (very-large = up to 26 x 36 cells).
    wall: 3,         // thickness of the shell
    balconies: 3,    // Four floors by default: entrance floor plus three upper landings.
    spacing: 4,      // levels between balcony floors (>= 3 so each has 2 cells of headroom above it)
    depth: 2,        // how far a balcony reaches into the shaft
    length: 3,       // how wide a balcony is (odd)
    floors: 4,       // 3–5 physical stories; higher floors remain part of one continuous shaft.
    octagon: true,   // Both the visible exterior and inner void have chamfered corners.
    entranceSide: 'N', // The integrated ruin joins via a corridor at ground level.
    climbStyle: 'holds',
    traversal: 'buttress', // Legacy authored shaft; generated ruins choose a complete method.
    landings: false, // Reserve an enclosed chamber at the end of each balcony corridor.
    chambers: false, // Extend landings into seeded side rooms for the V50 wing.
    seed: 1,
    theme: null, // Ruin tradition; jump-platform shafts vary their hazards by it.
    portals: null, // Optional floor-local wing door requests: {floor,side}, kept separate from climb buttress doors.
    originX: 0, originZ: 0, baseY: 0,
  });

  // A clipped square, using four straight sides and four 45-degree corners.
  const inOctagon = (c,r,lo,hi,cut) => c>=lo&&r>=lo&&c<=hi&&r<=hi&&c+r>=2*lo+cut&&c+r<=2*hi-cut&&c-r<=hi-lo-cut&&r-c<=hi-lo-cut;

  // Cells of a side's buttress, its door tunnel and the front row (the climbable one), in grid coordinates.
  function sideGeometry(side, o, cols, rows, offset = 0) {
    const mid = o.wall + (o.shaft - 1) / 2 + offset, half = Math.floor(o.length / 2);
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
    o.shaft = Math.max(o.octagon ? 17 : 5, o.shaft | 0 | 1); // Octagons need room for large platforms.
    o.length = Math.min(o.shaft - 2, Math.max(1, o.length | 0 | 1)); // odd and leaving open corners
    o.floors = Math.max(2, Math.min(5, o.floors | 0)); // Cave ruins have two stories.
    const floorOnlyTraversal = o.traversal === 'reachingObelisks' || o.traversal === 'jumpPlatforms'; // No full-height climbing buttresses: balcony floors and galleries only.
    o.balconies = o.octagon ? o.floors - 1 : Math.max(1, Math.min(3, o.balconies | 0));
    o.spacing = Math.max(3, o.spacing | 0);
    o.depth = Math.max(1, Math.min(o.depth | 0, (o.shaft - 1) / 2 - Math.floor(o.length / 2))); // buttresses on neighbouring sides must not run into each other
    const cols = o.shaft + 2 * o.wall, rows = cols, topStand = o.spacing * o.balconies;
    const headroom = o.traversal === 'jumpPlatforms' ? o.spacing : 0; // One extra story of open height above the top gallery, with no balcony: where the bomber Skeeri nest.
    const levels = topStand + 3 + headroom;
    const grid = G.create({ cols, rows, levels, originX: o.originX, originZ: o.originZ, baseY: o.baseY });
    const random = rng(o.seed), turn = Math.floor(random() * 4);
    const sides = [0, 1, 2, 3].map(i => SIDES[(i + turn) % 4]);
    const balconySides = sides.slice(0, o.balconies), entranceSide = o.octagon ? o.entranceSide : sides[3];

    grid.fillBox(0, 0, 0, cols - 1, rows - 1, levels - 1, KIND.SOLID);                       // the whole mass...
    grid.fillBox(o.wall, o.wall, 0, o.wall + o.shaft - 1, o.wall + o.shaft - 1, levels - 2, KIND.AIR); // ...hollowed under a ceiling.
    if (o.octagon) {
      const innerCut = Math.floor(o.shaft * .19), outerCut = innerCut + o.wall;
      for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
        if (!inOctagon(c,r,0,cols-1,outerCut)) grid.fillBox(c,r,0,c,r,levels-1,KIND.AIR); // Clip exterior corners.
        else if (c>=o.wall && r>=o.wall && c<o.wall+o.shaft && r<o.wall+o.shaft &&
                 !inOctagon(c,r,o.wall,o.wall+o.shaft-1,innerCut)) grid.fillBox(c,r,0,c,r,levels-2,KIND.SOLID); // Eight-sided internal walls.
      }
    }
    // Upper floors share a continuous octagonal walkway. Keep the approach cells
    // inside climbing faces open all the way up, otherwise a gallery would cut off
    // the surface one cell below its mantle point.
    const ringCellsByLevel = [];
    if (o.octagon) {
      const lo=o.wall,hi=lo+o.shaft-1,cut=Math.floor(o.shaft*.19),width=5; // Five-cell galleries remain walkable around higher buttresses.
      const approaches=new Set(); // All climb lanes, across every story.
      for(const side of (floorOnlyTraversal?[]:balconySides)){
        const g=sideGeometry(side,o,cols,rows),out=OUTWARD[side];
        for(const f of g.front)approaches.add((f.c-out.c)+','+(f.r-out.r));
      }
      for(let floor=1;floor<=o.balconies;floor++){
        const level=o.spacing*floor, gallery=[];
        for(let r=lo;r<=hi;r++)for(let c=lo;c<=hi;c++){
          const perimeter=inOctagon(c,r,lo,hi,cut)&&!inOctagon(c,r,lo+width,hi-width,Math.max(0,cut-width*2));
          if(!perimeter||approaches.has(c+','+r))continue;
          grid.set(c,r,level-1,KIND.SOLID);
          gallery.push({col:c,row:r});
        }
        ringCellsByLevel.push({floor,level,cells:gallery});
      }
    }
    const balconies = [], doors = [];
    balconySides.forEach((side, k) => {
      const level = o.spacing * (k + 1), geo = sideGeometry(side, o, cols, rows);
      if(floorOnlyTraversal){
        // Keep only the balcony floor, not its full-height continuous climbing buttress.
        for(const cell of geo.buttress)grid.set(cell.c,cell.r,level-1,KIND.SOLID);
      }else{
        for (const cell of geo.buttress) grid.fillBox(cell.c, cell.r, 0, cell.c, cell.r, level - 1, KIND.SOLID);
        for (const cell of geo.front) grid.paintClimbFaces(cell.c, cell.r, 0, cell.c, cell.r, level - 1, OPPOSITE_DIR[side], o.climbStyle);
      }
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
    // A fifth floor can put an upper buttress on the entrance side. Re-open its central ground passage.
    const entryButtress = sideGeometry(entranceSide,o,cols,rows);
    for (const cell of entryButtress.buttress) if ((entranceSide==='N'||entranceSide==='S'?cell.c:cell.r)===entryButtress.mid)
      grid.fillBox(cell.c,cell.r,0,cell.c,cell.r,1,KIND.AIR);
    const entrance = { side: entranceSide, level: 0, col: eg.edge.c, row: eg.edge.r, inside: eg.tunnel[0], outward: OUTWARD[entranceSide] };

    // Every requested wing gets its own open, two-cell-high tunnel on its floor.
    // Keep wing doors offset from central climbing buttresses and from the
    // original western entrance. This leaves the climb route intact across
    // all 3–5 stories, including the corner shared by the last balcony.
    const wingPortals = []; // Physical level-specific passage endpoints consumed by the 2D wing builder.
    const portalKeys = new Set(); // Reject duplicate floor/side openings at the same wall.
    const portalOffset = Math.max(1, Math.min(8, Math.floor((o.shaft-1)/2)-Math.floor(o.shaft*.19)-2));
    for (const request of Array.isArray(o.portals) ? o.portals : []) {
      const floor = Number(request?.floor), side = String(request?.side || '').toUpperCase();
      if (!Number.isInteger(floor) || floor < 0 || floor >= o.floors || !SIDES.includes(side))
        throw new Error('Shaft wing portal has invalid floor or side.');
      const id = floor + ':' + side;
      if (portalKeys.has(id)) throw new Error('Duplicate shaft wing portal ' + id);
      portalKeys.add(id);
      const level = floor * o.spacing;
      const geometry = sideGeometry(side, { ...o, depth: 1, length: 1 }, cols, rows, portalOffset);
      for (const t of geometry.tunnel)
        grid.fillBox(t.c, t.r, level, t.c, t.r, level + 1, KIND.AIR);
      wingPortals.push({
        id, floor, side, offset: portalOffset, level,
        col: geometry.edge.c, row: geometry.edge.r,
        inside: geometry.tunnel[0], tunnel: geometry.tunnel.map(t => ({col:t.c,row:t.r})),
        outward: OUTWARD[side],
        world: {x:grid.colToX(geometry.edge.c + .5), z:grid.rowToZ(geometry.edge.r + .5), y:grid.levelToY(level)}
      });
    }
    const obelisks=o.traversal==='reachingObelisks'?Obelisks?.compose?.({
      seed:o.seed,shaft:o.shaft,wall:o.wall,spacing:o.spacing,floors:o.floors,
      originX:o.originX,originZ:o.originZ,baseY:o.baseY,balconySides}):null;
    if(o.traversal==='reachingObelisks'&&!obelisks?.ok)
      throw new Error('The selected reaching-obelisk traversal is missing or unsolvable.');
    const jumpShaft=o.traversal==='jumpPlatforms'?JumpShaft?.compose?.({
      shaft:o.shaft,wall:o.wall,spacing:o.spacing,floors:o.floors,seed:o.seed,
      originX:o.originX,originZ:o.originZ,baseY:o.baseY,theme:o.theme,entranceSide}):null;
    if(o.traversal==='jumpPlatforms'&&!jumpShaft?.ok)
      throw new Error('The jump-platform shaft is missing or unsolvable'+(jumpShaft?': '+jumpShaft.checks.filter(c=>!c.ok).map(c=>c.name).join(','):'.'));
    const surfaces = grid.collectClimbSurfaces();
    const result = { ok: false, headroom, options: o, grid, cols, rows, levels, balconies, doors, entrance, wingPortals, surfaces, obelisks, jumpShaft, checks: [],
      stories: Array.from({length:o.balconies+1},(_,floor)=>({floor,level:floor*o.spacing,balconies:balconies.filter(b=>b.level===floor*o.spacing),gallery:(ringCellsByLevel.find(r=>r.floor===floor)?.cells||[]).filter(c=>grid.canStand(c.col,c.row,floor*o.spacing))})) }; // Level map for a subsequent wing composer.
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
    const traversal = result.obelisks || result.jumpShaft; // A verified state/flight graph replaces continuous climb edges.
    const reach = traversal?.ok
      ?{has:(c,r,l)=>grid.canStand(c,r,l)&&l>=0&&l<=o.spacing*(o.floors-1)}
      :reachable(result);
    if(result.obelisks)add('obeliskTraversalVerified',result.obelisks.ok&&result.obelisks.routes.length===o.floors-1);
    if(result.jumpShaft)add('jumpTraversalVerified',result.jumpShaft.ok&&result.jumpShaft.routes.length===o.floors-1);
    add('entranceOpen', grid.floorLevelAt(entrance.inside.c, entrance.inside.r, 0) === 0, 'the ground entrance leads onto the shaft floor');
    add('spacing', o.spacing >= 3, `balcony floors are ${o.spacing} apart (2 cells of headroom needed above each)`);
    for (const b of balconies) {
      const stands = b.cells.filter(c => grid.canStand(c.col, c.row, b.level));
      add(`balcony${b.index}Standable`, stands.length === b.cells.length, `${stands.length}/${b.cells.length} balcony cells have a floor and 2 cells of headroom`);
      if(result.obelisks)add(`balcony${b.index}ObeliskRoute`,result.obelisks.routes.some(route=>route.story===b.index&&route.exitY===b.y),
        'an audited state-machine and ballistic route replaces the climb wall');
      else if(result.jumpShaft)add(`balcony${b.index}JumpRoute`,result.jumpShaft.routes.some(route=>route.story===b.index&&route.exitY===b.y),
        'an audited free-jump platform route replaces the climb wall');
      else add(`balcony${b.index}Climbable`, result.surfaces.some(s => s.y0 <= grid.levelToY(0) + 1e-6 && Math.abs(s.y1 - grid.levelToY(b.level)) < 1e-6), 'a wall rectangle runs from the ground to the balcony floor');
      add(`balcony${b.index}Reachable`, b.cells.some(c => reach.has(c.col, c.row, b.level)), 'reachable from the entrance by walking and climbing');
    }
    for (const d of doors) {
      add(`door${d.balcony}Reachable`, reach.has(d.col, d.row, d.level), 'the door’s outer end is reachable from the entrance');
      if (d.chamber.length) add(`door${d.balcony}ChamberReachable`, d.chamber.every(cell => reach.has(cell.col,cell.row,d.level)), 'all chamber cells are reachable at balcony height');
      add(`door${d.balcony}Clear`, d.tunnel.every(t => !grid.isSolid(t.col, t.row, d.level) && !grid.isSolid(t.col, t.row, d.level + 1)), 'the tunnel is open 2 cells high from the balcony to the outside');
    }
    for (const p of result.wingPortals || []) {
      add('wingPortal-' + p.id + '-clear',
        p.tunnel.every(t => grid.canStand(t.col,t.row,p.level)),
        'a full-height physical tunnel has a continuous level-specific floor');
      add('wingPortal-' + p.id + '-reachable', reach.has(p.col,p.row,p.level),
        'the wing doorway connects by walking and climbing to the main entrance');
      add('wingPortal-' + p.id + '-outside',
        p.col === 0 || p.row === 0 || p.col === result.cols-1 || p.row === result.rows-1,
        'the wing passage reaches the octagon exterior');
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
    const material = globalThis.ProceduralFurniture?.makePartMaterial?.({materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#7a746b'}) || new THREE.MeshBasicMaterial({color:0x7a746b}); // Exactly the same unlit ruin stone as V50 walls.
    // The stone is real faces, not a field of one-unit boxes: neighbouring faces merge into large flat rectangles
    // (js/ruin-wall-faces.js) cut into patches of at most PATCH units, each stretching the texture to fit, so the
    // walls read like the older V50 rooms and can be engraved by FurniturePatternSurfaces.decorateRuin. The
    // masonry group is kept apart from the climb markings so only stone is ever patterned. Roof faces point
    // inward only, so the overhead game camera sees the interior; collision stays on the voxel grid.
    const masonry = new THREE.Group();
    masonry.name = 'shaft-hub-masonry';
    shell.add(masonry);
    const frame = { origin:{ x:grid.colToX(0), y:grid.levelToY(0), z:grid.rowToZ(0) }, size:{ x:grid.cellSize, y:grid.cellHeight, z:grid.cellSize }, patch:{ h:PATCH, v:PATCH } };
    const part = (name, rects, parent = masonry) => {
      if (!rects.length) return null;
      const mesh = new THREE.Mesh(Faces.toGeometry(THREE, Faces.buildQuads(rects, frame)), material);
      mesh.name = name;
      parent.add(mesh);
      return mesh;
    };
    const faces = Faces.voxelFaces({ cols:grid.cols, rows:grid.rows, levels:grid.levels, isSolid:(c, r, l) => grid.isSolid(c, r, l) });
    const sides = faces.filter(rect => rect.axis !== 'y');
    const area = rect => (rect.a1 - rect.a0) * (rect.b1 - rect.b0);
    const chosen = new Set(sides.filter(rect => rect.a1 - rect.a0 >= FEATURE.w && rect.b1 - rect.b0 >= FEATURE.h).sort((a, b) => area(b) - area(a)).slice(0, FEATURE.max));
    const isFeature = rect => chosen.has(rect);
    // FurniturePatternSurfaces builds one engraving atlas per mesh, sized to the unwrapped extent of every face it
    // selects. That suits a connected wall, as in the older V50 rooms (one mesh per wall); hundreds of disjoint faces
    // in one mesh shrink the atlas to nothing. So each broad wall is its own mesh in a group the decorator is pointed
    // at, and the many narrow strips (the octagon's stepped diagonals, ledge fronts) stay plain stretched stone.
    const features = new THREE.Group();
    features.name = 'shaft-hub-feature-walls';
    features.userData.ruinFeatureWalls = true; // The style pass engraves every group carrying this flag (js/ruin-multifloor-v50-style.js).
    masonry.add(features);
    for (const rect of sides.filter(isFeature)) part('shaft-hub-feature-wall', [rect], features); // One shared name: one pattern "type".
    part('shaft-hub-walls', sides.filter(rect => !isFeature(rect)));
    part('shaft-hub-ledges', faces.filter(rect => rect.axis === 'y')); // Balcony tops, undersides and the roof: stretched like the walls.
    const floorMask = new Uint8Array(grid.cols * grid.rows); // No rectangular floor visible under the clipped octagon.
    const lo=result.options.wall,hi=lo+result.options.shaft-1,cut=Math.floor(result.options.shaft*.19);
    for(let r=0;r<grid.rows;r++) for(let c=0;c<grid.cols;c++)
      if(grid.canStand(c,r,0)&&!((result.obelisks||result.jumpShaft)&&Math.abs(c-(lo+hi)/2)<(result.options.shaft-10)/2&&Math.abs(r-(lo+hi)/2)<(result.options.shaft-10)/2)&&(!result.options.octagon||inOctagon(c,r,lo,hi,cut)||result.entrance.side==='N'&&c===result.entrance.col&&r<lo||result.entrance.side==='S'&&c===result.entrance.col&&r>hi||result.entrance.side==='W'&&r===result.entrance.row&&c<lo||result.entrance.side==='E'&&r===result.entrance.row&&c>hi)) floorMask[r*grid.cols+c]=1;
    part('shaft-hub-octagonal-floor', Faces.mergeMask(floorMask, grid.cols, grid.rows).map(rect => ({ axis:'y', side:1, plane:0, a0:rect.i0, a1:rect.i1, b0:rect.j0, b1:rect.j1 })));
    if (climb?.buildVisual) for (const surface of result.surfaces) shell.add(climb.buildVisual(THREE,{...surface,ruin:true})); // Real V50 ladder art replaces the old colored climb tile overlays.
    return shell;
  }

  // Merge each level's walkable stone cells into broad support rectangles.
  // DynamicSurfaces.samplesupport scans registered records; thousands of tiny
  // per-cell supports in one tall room caused unnecessary per-frame work.
  function registerGroupedSupport(result, DS, scope) {
    const {grid,options:o}=result;
    const exteriorCut=o.octagon?Math.floor(o.shaft*.19)+o.wall:0;
    const levelRows=new Map(); // Level -> row -> sorted columns, shared by the rectangle sweep.
    for(const cell of grid.standingSurfaces({clearance:2})){
      if(cell.level>=grid.levels-1)continue; // No invisible standing surface on the roof.
      if(o.octagon&&!inOctagon(cell.col,cell.row,0,grid.cols-1,exteriorCut))continue;
      if((result.obelisks||result.jumpShaft)&&cell.level===0&&Math.abs(cell.col-(o.wall+(o.shaft-1)/2))<(o.shaft-10)/2
        &&Math.abs(cell.row-(o.wall+(o.shaft-1)/2))<(o.shaft-10)/2)continue; // No implicit support inside the fatal basin.
      let rows=levelRows.get(cell.level);
      if(!rows){rows=new Map();levelRows.set(cell.level,rows);}
      let columns=rows.get(cell.row);
      if(!columns){columns=[];rows.set(cell.row,columns);}
      columns.push(cell.col);
    }
    let count=0;
    for(const [level,rows] of levelRows){
      let active=new Map(); // Identical horizontal spans on consecutive rows fuse into one support rectangle.
      const flush=rect=>{
        DS.registerSurface({id:scope+'-support-'+(count++),scope,
          bounds:{minX:grid.colToX(rect.c0),maxX:grid.colToX(rect.c1+1),
            minZ:grid.rowToZ(rect.r0),maxZ:grid.rowToZ(rect.r1+1)},
          topY:grid.levelToY(level),priority:1});
      };
      for(let row=0;row<grid.rows;row++){
        const cols=(rows.get(row)||[]).sort((a,b)=>a-b),spans=[];
        for(const c of cols){
          const tail=spans[spans.length-1];
          if(tail&&tail.c1+1===c)tail.c1=c;
          else spans.push({c0:c,c1:c,r0:row,r1:row});
        }
        const next=new Map();
        for(const span of spans){
          const key=span.c0+','+span.c1,prior=active.get(key);
          if(prior&&prior.r1===row-1){prior.r1=row;next.set(key,prior);}
          else next.set(key,span);
        }
        for(const [key,rect] of active)if(!next.has(key))flush(rect);
        active=next;
      }
      for(const rect of active.values())flush(rect);
    }
    return count;
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
    if (deps.ClimbSurfaces) out.surfaces = deps.ClimbSurfaces.registerGrid(result.grid, { scope, idPrefix: scope, autoCatch: true }); // This hub's authored V50 ladders catch descending contact automatically.
    if (deps.DynamicSurfaces) out.floors = registerGroupedSupport(result, deps.DynamicSurfaces, scope);
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

  function senseTargets(scene) {
    const targets=[]; // Mounted V50 buttress ladders use the same through-stone silhouette as the moving obelisks.
    for(const {visual} of mounts.values()){
      if(!visual)continue;
      let parent=visual;while(parent?.parent)parent=parent.parent;
      if(parent!==scene)continue;
      visual.traverse(node=>{if(node.userData?.ruinLadderSenseTarget&&node.visible!==false)targets.push(node);});
    }
    return targets;
  }

  // The abstract room (RuinComposer's input) for one standing level of the hub: the walkable footprint at that level.
  function levelRoom(result, level) {
    const { grid } = result; // open = something to stand on at this level, with headroom; the shaft's empty air at a balcony level is not floor
    const solid = (x, z) => !grid.canStand(grid.xToCol(x), grid.zToRow(z), level);
    return { id: `shaft-level-${level}`, bounds: { minX: grid.colToX(0), maxX: grid.colToX(result.cols), minZ: grid.rowToZ(0), maxZ: grid.rowToZ(result.rows) }, floorY: grid.levelToY(level), ceilingY: grid.levelToY(result.levels - 1), zones: {}, gaps: [], solid };
  }

  return Object.freeze({ DEFAULTS, compose, verify, reachable, mount, unmount, levelRoom, senseTargets });
});
