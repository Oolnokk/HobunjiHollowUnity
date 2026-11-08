// RuinJumpShaft — the shaft traversal for generated ruins: a staircase of
// free-jump platforms spiralling up the empty central chamber, from the ground
// (or the gallery of one story) to the gallery of the next. Replaces the
// reaching-obelisk timing puzzle with plain Zelda-style jumping.
//
//   compose()  pure layout + proof. Every hop is checked against the real
//              PlayerJump constants (launch speed, gravity, air speed).
//   mount()    stone slabs + DynamicSurfaces supports, plus the theme's hazards:
//                tothal   every platform is ice (slippery, drift-prone)
//                hronal   some platforms are exactly the pillar blast radius
//                         wide and carry an exploding pillar
//                kanthic  wide platforms almost fully covered in plasm, with
//                         clear entry/exit columns and single clear stepping
//                         tiles in between (a jump puzzle inside the jump puzzle)
//
// The runtime object deliberately exposes the same read surface the old
// obelisk runtime did (columns, isVoidAt, pitY, plan.physics, tradition,
// getState, tick, dispose) so the ruin's existing airborne/fall reconciler
// drives it unchanged. Falling is soft: you land on the platform or floor
// below and take fall damage; there is no death pit.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RuinJumpShaft = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const root = typeof self !== 'undefined' ? self : globalThis;
  const TRAVERSAL = 'jumpPlatforms';
  // PlayerJump.CONFIG (docs/js/player-jump.js). Duplicated on purpose: the
  // layout proof must run under node without the browser module.
  const LAUNCH_VY = 6.25 / Math.SQRT2, GRAVITY = 11.8, AIR_SPEED = 3.15;
  const RISE = 0.55; // Per-hop rise; PlayerJump's comfortable ledge rise is ~0.71.
  const THICKNESS = 0.45;
  const GALLERY = 5; // Same gallery width as ShaftHub (balcony thickness never changes).
  const EDGE = 0.45; // Clear strip between a platform edge and the gallery drop.
  const GAP = 1.0; // Preferred edge-to-edge gap (jump reach is ~1.9).
  const MIN_SIZE = 1.1, MAX_SIZE = 3.8;
  const PILLAR_RADIUS = 3.1; // js/dev-random-ruin-lich-themes.js PILLAR_RADIUS.
  const PILLAR_HEIGHT = 2.4;
  const SAFE_GAP_FRACTION = 0.85;
  const FALL_SAFE_DROP = 3, FALL_DAMAGE_PER_UNIT = 3.2;

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const reach = rise => { // Horizontal travel of a jump that lands `rise` above take-off.
    const disc = LAUNCH_VY * LAUNCH_VY - 2 * GRAVITY * rise;
    return disc <= 0 ? 0 : AIR_SPEED * (LAUNCH_VY + Math.sqrt(disc)) / GRAVITY;
  };
  const SIDE_INDEX = { N: 0, E: 1, S: 2, W: 3 };

  // Point on the reference square's perimeter. Sides run N(west->east), E(north->south),
  // S(east->west), W(south->north), i.e. clockwise seen from above (+z is south).
  function perimeterPoint(u, half) {
    const side = half * 2, t = ((u % (side * 4)) + side * 4) % (side * 4), k = Math.floor(t / side), a = t - k * side;
    if (k === 0) return { x: -half + a, z: -half, side: 'N', axis: 'x' };
    if (k === 1) return { x: half, z: -half + a, side: 'E', axis: 'z' };
    if (k === 2) return { x: half - a, z: half, side: 'S', axis: 'x' };
    return { x: -half, z: half - a, side: 'W', axis: 'z' };
  }

  const edgeGap = (a, b) => {
    const gx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2), gz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
    return Math.hypot(gx, gz);
  };

  function compose(options = {}) {
    const o = { shaft: 19, wall: 8, spacing: 8, floors: 2, seed: 1, originX: 0, originZ: 0, baseY: 0, theme: null, entranceSide: 'S', ...options };
    if (!Number.isInteger(o.spacing) || o.spacing < 4 || o.shaft < 17 || o.floors < 2 || o.floors > 5)
      throw new Error('Jump shaft needs a 17+ cell shaft and 2-5 floors.');
    const centre = { x: o.originX + o.wall + o.shaft / 2, z: o.originZ + o.wall + o.shaft / 2 };
    const C = o.shaft - 2 * GALLERY; // Empty central chamber.
        const rises = Math.ceil(o.spacing / RISE), n = rises - 1, dy = o.spacing / rises;
    const theme = String(o.theme || '').toLowerCase();
    const entry = SIDE_INDEX[String(o.entranceSide || 'S').toUpperCase()] ?? 2;
    const platforms = [], routes = [];
    for (let story = 0; story < o.floors - 1; story++) {
      const y0 = o.baseY + story * o.spacing;
      // Item kinds along the loop. Hazard platforms avoid the first and last hop
      // (the player needs a plain, safe take-off and landing next to the gallery).
      const kinds = Array.from({ length: n }, () => 'plain');
      if (theme === 'tothal') kinds.fill('ice');
      else if (theme === 'hronal') {
        const count = clamp(Math.round(n / 5), 1, 3);
        for (let k = 0; k < count; k++) kinds[clamp(Math.round((k + 1) * (n + 1) / (count + 1)) - 1, 1, n - 2)] = 'pillar';
      } else if (theme === 'kanthic') {
        const count = clamp(Math.round(n / 6), 1, 3);
        for (let k = 0; k < count; k++) kinds[clamp(Math.round((k + 1) * (n + 1) / (count + 1)) - 1, 1, n - 2)] = 'plasm';
      }
      const wideLength = C >= 17 ? 7 : 5, wideCross = 3;
      const fixedSize = kind => kind === 'pillar' ? PILLAR_RADIUS : kind === 'plasm' ? wideLength : 0;
      // Plain platforms follow a square path whose half-side shrinks with their size
      // (their outer edge always sits EDGE from the gallery drop), so solve both together:
      //   8*(lim - p/2) = fixed + flex*p + (n+1)*gap
      const lim = C / 2 - EDGE;
      const fixedTotal = kinds.reduce((sum, k) => sum + fixedSize(k), 0), flexCount = kinds.filter(k => !fixedSize(k)).length;
      let gap = GAP, plain = (8 * lim - fixedTotal - (n + 1) * gap) / (flexCount + 4);
      if (plain < MIN_SIZE) { plain = MIN_SIZE; gap = Math.max(.55, (8 * lim - 4 * plain - fixedTotal - flexCount * plain) / (n + 1)); }
      if (plain > MAX_SIZE) { plain = MAX_SIZE; gap = (8 * lim - 4 * plain - fixedTotal - flexCount * plain) / (n + 1); }
      const pathHalf = lim - plain / 2, startSide = story === 0 ? entry : (entry + story) % 4;
      let u = startSide * pathHalf * 2 + pathHalf; // First platform: midpoint of the start side.
      const ids = [];
      // Place a platform of `kind` at path position u: slabs hug the gallery drop
      // (their outer edge sits EDGE inside it), wide plasm slabs align to whole tiles.
      const place = (kind, u, i) => {
        const ref = perimeterPoint(u, pathHalf), s = fixedSize(kind) || plain;
        let w = s, d = s;
        if (kind === 'plasm') { if (ref.axis === 'x') { w = wideLength; d = wideCross; } else { w = wideCross; d = wideLength; } }
        let px = clamp(ref.x, -(lim - w / 2), lim - w / 2), pz = clamp(ref.z, -(lim - d / 2), lim - d / 2);
        if (ref.side === 'N') pz = -(lim - d / 2); else if (ref.side === 'S') pz = lim - d / 2;
        else if (ref.side === 'E') px = lim - w / 2; else px = -(lim - w / 2);
        let x = centre.x + px, z = centre.z + pz;
        if (kind === 'plasm') { x = Math.round(x - w / 2) + w / 2; z = Math.round(z - d / 2) + d / 2; } // Plasm tiles are whole world tiles.
        return { id: `jf${story}-p${i}`, floor: story, index: i, kind, x, z, w, d, y: y0 + (i + 1) * dy, side: ref.side, axis: ref.axis };
      };
      // Lay the whole story out for a given kind list. Returns the records and whether every
      // wide plasm slab landed on a straight stretch (its long axis cannot turn a corner).
      const layout = (list) => {
        let cursor = u, previous = null, valid = true;
        const records = [];
        for (let i = 0; i < n; i++) {
          const kind = list[i];
          let record = place(kind, cursor, i);
          const target = gap + (kind === 'pillar' || previous?.kind === 'pillar' ? .35 : 0) // A pillar blast must not reach the previous slab.
            - (kind === 'plasm' || previous?.kind === 'plasm' ? .45 : 0); // Plasm slabs snap to whole tiles, which can add up to a tile of gap.
          if (previous) for (let guard = 0; guard < 4000 && edgeGap(previous, record) < target; guard++) record = place(kind, cursor += .05, i);
          if (kind === 'plasm') {
            const rel = record.axis === 'x' ? record.x - centre.x : record.z - centre.z, len = record.axis === 'x' ? record.w : record.d;
            if (Math.abs(rel) > lim - len / 2 - .6) valid = false;
          }
          records.push(record);
          previous = record;
        }
        return { records, valid };
      };
      let chosen = layout(kinds);
      if (theme === 'kanthic') {
        const wanted = kinds.map((k, i) => k === 'plasm' ? i : -1).filter(i => i >= 0);
        const plainKinds = kinds.map(() => 'plain');
        const slots = [];
        for (const base of wanted) {
          let picked = null;
          for (const shift of [0, 1, -1, 2, -2, 3, -3]) {
            const at = base + shift;
            if (at < 1 || at > n - 2 || slots.some(sl => Math.abs(sl - at) < 3)) continue;
            const trial = plainKinds.slice(); for (const sl of slots) trial[sl] = 'plasm'; trial[at] = 'plasm';
            if (layout(trial).valid) { picked = at; break; }
          }
          if (picked !== null) slots.push(picked);
        }
        const finalKinds = plainKinds.slice(); for (const sl of slots) finalKinds[sl] = 'plasm';
        chosen = layout(finalKinds);
      }
      for (const record of chosen.records) {
        if (record.kind === 'plasm') record.tiles = plasmTiles(record, record.axis, record.side === 'N' || record.side === 'E'); // N and E sides run toward +x/+z.
        platforms.push(record);
        ids.push(record.id);
      }
      routes.push({ story, entryY: y0, exitY: y0 + o.spacing, platformIds: ids, rise: dy, startSide: ['N', 'E', 'S', 'W'][startSide] });
    }
    const plan = { method: TRAVERSAL, options: o, platforms, routes, centre, central: C,
      physics: { gravity: GRAVITY, reach: reach(dy), rise: dy }, pit: { bottomY: o.baseY - 2, style: 'floor', depth: 2 } };
    plan.checks = verify(plan);
    plan.ok = plan.checks.every(c => c.ok);
    return plan;
  }

  // Wide plasm slab, mostly plasm. Logical column a runs along the path
  // (a=0 is the entry end). Entry and exit each keep a couple of clear tiles;
  // single clear stepping tiles in between sit on alternating columns so every
  // hop is a short jump over plasm rather than a walk.
  function plasmTiles(p, axis, forward = true) {
    const along = axis === 'x' ? p.w : p.d, cross = axis === 'x' ? p.d : p.w;
    const x0 = Math.round(p.x - p.w / 2), z0 = Math.round(p.z - p.d / 2), tiles = [], clear = [];
    for (let a = 0; a < along; a++) for (let c = 0; c < cross; c++) {
      const col = forward ? a : along - 1 - a;
      const tx = axis === 'x' ? x0 + col : x0 + c, tz = axis === 'x' ? z0 + c : z0 + col;
      const isEntry = a === 0 && c <= 1, isExit = a === along - 1 && c >= cross - 2;
      const step = a > 0 && a < along - 1 && a % 2 === 0 && ((a / 2 - 1) % 2 === 0 ? c === Math.floor(cross / 2) : (c === 0 || c === cross - 1));
      if (isEntry || isExit || step) clear.push(tx + ',' + tz); else tiles.push({ x: tx, z: tz });
    }
    p.clearTiles = clear;
    return tiles;
  }


  function verify(plan) {
    const checks = [], add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });
    const limit = plan.physics.reach * SAFE_GAP_FRACTION;
    for (const route of plan.routes) {
      const list = route.platformIds.map(id => plan.platforms.find(p => p.id === id));
      add(`story${route.story}-hasPlatforms`, list.length >= 3);
      add(`story${route.story}-rise`, route.rise <= RISE + 1e-6 && route.rise > .2, `rise ${route.rise.toFixed(3)}`);
      let worst = 0;
      for (let i = 1; i < list.length; i++) worst = Math.max(worst, edgeGap(list[i - 1], list[i]));
      add(`story${route.story}-hopGaps`, worst <= limit, `worst gap ${worst.toFixed(2)} of ${limit.toFixed(2)}`);
      const lim = plan.central / 2;
      add(`story${route.story}-inside`, list.every(p => Math.abs(p.x - plan.centre.x) + p.w / 2 <= lim + 1e-6 && Math.abs(p.z - plan.centre.z) + p.d / 2 <= lim + 1e-6));
      add(`story${route.story}-ends`, Math.abs(list[0].y - route.entryY - route.rise) < 1e-6 && Math.abs(route.exitY - list[list.length - 1].y - route.rise) < 1e-6);
      const pillars = list.filter(p => p.kind === 'pillar');
      add(`story${route.story}-pillarSpacing`, pillars.every(p => {
        const i = list.indexOf(p), prev = list[i - 1];
        return !prev || Math.hypot(prev.x - p.x, prev.z - p.z) >= PILLAR_RADIUS + .25; // The previous platform's centre is outside the blast.
      }));
      for (const p of list.filter(q => q.kind === 'plasm')) {
        const clearKeys = new Set(p.clearTiles), neighbour = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const ok = p.tiles.length >= p.clearTiles.length * 1.8 && p.clearTiles.length >= 5; // Mostly plasm: entry/exit tiles plus stepping tiles.
        add(`story${route.story}-${p.id}-plasmMostly`, ok, `${p.tiles.length} plasm / ${p.clearTiles.length} clear`);
        const hasIsland = p.clearTiles.some(k => { const [x, z] = k.split(',').map(Number); return !neighbour.some(([dx, dz]) => clearKeys.has((x + dx) + ',' + (z + dz))); });
        add(`story${route.story}-${p.id}-steppingTiles`, hasIsland);
      }
    }
    add('uniqueIds', new Set(plan.platforms.map(p => p.id)).size === plan.platforms.length);
    return checks;
  }

  // ---------------------------------------------------------------- runtime
  function mount(plan, deps = {}) {
    if (!plan?.ok) throw new Error('Cannot mount an unverified jump shaft.');
    const { THREE, DynamicSurfaces: DS, parent } = deps;
    if (!THREE?.Group || !parent?.add || !DS?.registerSurface) throw new Error('Jump shaft runtime dependencies are missing.');
    const scope = deps.scope || 'shaft-obelisks'; // Same support id prefix the ruin's airborne reconciler already resolves.
    const group = new THREE.Group(); group.name = 'jump-shaft'; parent.add(group);
    const tradition = String(deps.tradition || plan.options.theme || 'hronal').toLowerCase();
    const owned = [], materials = [], columns = new Map();
    const stone = root.ProceduralFurniture?.makePartMaterial?.({ materialTexture: 'carved_smooth.png', materialLighting: 'unlit', materialFillMode: 'never', color: '#726d63' })
      || new THREE.MeshBasicMaterial({ color: 0x726d63 });
    materials.push(stone);
    const basic = (color, extra = {}) => { const m = new THREE.MeshBasicMaterial({ color, ...extra }); materials.push(m); return m; };
    const iceMaterial = basic(0x8bcdf5, { transparent: true, opacity: .42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const tradeTrim = { tothal: 0xb7ecfa, hronal: 0xff7a30, kanthic: 0xa072d8 }[tradition] || 0xb7ecfa;
    const trimMaterial = basic(tradeTrim, { transparent: true, opacity: .55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); // Offset keeps the sheet from flickering against the slab top.
    const cx = plan.centre.x, cz = plan.centre.z, half = plan.central / 2;
    for (const p of plan.platforms) {
      const holder = new THREE.Group(); holder.name = p.id; holder.position.set(p.x, p.y, p.z); group.add(holder);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(p.w, THICKNESS, p.d), stone);
      slab.position.y = -THICKNESS / 2; slab.name = p.id + '-stone'; holder.add(slab); owned.push(slab);
      // A thin coloured lip tells the player which tradition's trick a platform plays.
      // Top-facing plane only: a box would show its translucent underside as a floating coloured
      // sheet to anyone standing on a lower platform.
      const lip = new THREE.Mesh(new THREE.PlaneGeometry(p.w + .04, p.d + .04), p.kind === 'ice' ? iceMaterial : trimMaterial);
      lip.rotation.x = -Math.PI / 2; lip.position.y = .014; lip.renderOrder = 2; lip.name = p.id + '-trim'; holder.add(lip); owned.push(lip);
      const record = { ...p, width: Math.max(p.w, p.d), holder, baseY: p.y - THICKNESS, moving: false };
      columns.set(p.id, record);
      DS.registerSurface({ id: scope + '-' + p.id, scope, topY: p.y, priority: 4,
        bounds: { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2 } });
    }
    let disposed = false, hazardsAttached = false, plasmHandles = [], fallEvents = 0;
    const pillarRecords = [];
    // The theme composer (lich-themes) owns pillar/plasm behaviour; it may not
    // have built its world yet when the shaft mounts, so attach on first ticks.
    const attachHazards = () => {
      const themes = root.DevRandomRuinLichThemes;
      if (!themes || themes.activeTheme?.() !== tradition) return false;
      if (tradition === 'hronal') {
        for (const p of plan.platforms) if (p.kind === 'pillar') {
          const record = themes.addPlatformPillar?.({ x: p.x, z: p.z, y: p.y, height: PILLAR_HEIGHT, id: 'jump-' + p.id });
          if (!record) return false;
          pillarRecords.push(record);
        }
      } else if (tradition === 'kanthic') {
        for (const p of plan.platforms) if (p.kind === 'plasm') {
          const handle = themes.createPlasmPatch?.(p.tiles.map(t => ({ x: t.x, z: t.z, y: p.y })), { permanent: true, ignoreClear: true });
          if (!handle) return false;
          plasmHandles.push(handle);
        }
      }
      return true;
    };
    const playerOn = (p, x, z, y) => Math.abs(x - p.x) <= p.w / 2 + .05 && Math.abs(z - p.z) <= p.d / 2 + .05 && Math.abs(y - p.y) <= .35;
    const isIceAt = (x, z, y) => {
      for (const p of plan.platforms) if (p.kind === 'ice' && playerOn(p, x, z, Number.isFinite(y) ? y : p.y)) return true;
      return false;
    };
    const tick = () => {
      if (disposed || hazardsAttached) return;
      if (tradition === 'tothal' || attachHazards()) hazardsAttached = true; // Ice needs no external world.
    };
    const supportAt = (x, z, fromY = Infinity) => {
      let best = null;
      for (const p of columns.values()) if (Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.z) < p.d / 2 && p.y <= fromY + .5 && (!best || p.y > best.y)) best = { id: scope + '-' + p.id, y: p.y, pillar: p };
      return best;
    };
    const isVoidAt = (x, z) => Math.abs(x - cx) < half && Math.abs(z - cz) < half;
    const dispose = () => {
      if (disposed) return; disposed = true;
      DS.clearScope(scope);
      for (const handle of plasmHandles) handle?.dispose?.();
      plasmHandles = [];
      group.parent?.remove(group);
      for (const node of owned) node.geometry?.dispose?.();
      for (const m of materials) m.dispose?.();
      columns.clear();
    };
    const state = () => ({ method: TRAVERSAL, active: false, beat: 0, measure: 0, moving: 0, // `active` stays false: the ambient-music silencer keys on the obelisk beat clock. platforms: plan.platforms.length, hazards: tradition, hazardsAttached, falls: fallEvents,
      route0: plan.platforms.filter(p => p.floor === 0).map(p => [p.kind, +p.x.toFixed(2), +p.z.toFixed(2), +p.y.toFixed(2), +p.w.toFixed(2), +p.d.toFixed(2)]), // Compact layout for on-device checks and headless drivers.
      pillars: pillarRecords.length, plasmSlabs: plasmHandles.length, iceTiles: plan.platforms.filter(p => p.kind === 'ice').length, pit: 'soft-floor' });
    return {
      plan, method: TRAVERSAL, tick, dispose, columns, supportAt, isVoidAt, isIceAt, tradition, pitY: plan.pit.bottomY, softLanding: true,
      noteFall: () => { fallEvents++; }, getState: state,
      fallDamageFor: drop => drop <= FALL_SAFE_DROP ? 0 : (drop - FALL_SAFE_DROP) * FALL_DAMAGE_PER_UNIT,
    };
  }

  // Ice queries come from the theme's native movement (game.js asks lich-themes,
  // which asks here); only the currently mounted runtime answers.
  let active = null;
  const mountTracked = (plan, deps) => { active?.dispose?.(); const runtime = mount(plan, deps); const dispose = runtime.dispose; active = runtime; runtime.dispose = () => { if (active === runtime) active = null; dispose(); }; return runtime; };
  return Object.freeze({
    TRAVERSAL, RISE, GALLERY, PILLAR_RADIUS, reach, compose, verify, mount: mountTracked, plasmTiles,
    isIceAt: (x, z, y) => !!active?.isIceAt?.(x, z, y),
    senseTargets: () => [],
  });
});
