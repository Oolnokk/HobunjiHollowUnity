// InteriorCeilings — ceilings for brick/plank/canvas building interiors
// (authored map_i_* rooms, synthesized barns, the player's farmhouse).
//
// Ruins and carved caves already roof themselves; every other interior used
// to be open to the sky above its wall tops. This module covers each floor
// cell with a ceiling at the wall-top height. It's flat by default; authored
// interiors can mark individual wall stretches as gables:
//
//   "ceiling": { "gables": [ { "side": "north", "line": 0, "from": 0, "to": 12, "rise": 1.25 } ] }
//
//   side      which wall of the room the stretch is ('north' sits on the
//             low-Z edge of its floor cells, 'south' on the high-Z edge,
//             'west' low-X, 'east' high-X).
//   line      the wall's grid line (Z for north/south, X for east/west).
//   from/to   tile range the stretch covers along that line.
//   rise      how far the gable peak climbs above the wall top.
//   "ceiling": { "enabled": false } leaves a room open to the sky.
//
// Each gable stretch has a hidden division down its middle that rises into
// a triangular peak (rendered as a gable-end infill above the wall). The
// ceiling across the room is a ruled surface interpolating from that
// triangle to the profile of the wall stretch opposite it: another gable
// (a classic pitched roof) or a flat wall (its two halves stay at the wall
// top, so the ridge slopes down to the middle of the opposite wall).
//
// Ceiling faces wind downward and use FrontSide, the same trick as
// dev-random-ruin-interior-map.js's buildTexturedCeiling: visible from inside
// the room, back-face culled (and ignored by raycasts) from the overhead
// follow camera. Editors pass includeCeiling:false to show only the gable
// ends, or preview:true for a see-through double-sided ceiling. Brick rooms
// build their gable ends from the same WallBuilder bricks as the walls
// (WallBuilder's triangleClip panels) over a dark backing triangle.
(function (root) {
  'use strict';

  const DEFAULT_GABLE_RISE = 1.25; // World units above the wall top; about two-thirds of the stock 1.75 wall.
  const MIN_GABLE_RISE = 0.1;
  const MAX_GABLE_RISE = 8;
  const GABLE_SUBDIVISIONS = 4; // Per-tile quads when any gable exists; integer/half-tile ridges land exactly on vertices.
  const SIDES = ['north', 'south', 'west', 'east'];
  const OPPOSITE = { north: 'south', south: 'north', west: 'east', east: 'west' };

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function toFloorSet(floor) {
    if (floor instanceof Set) return floor;
    const set = new Set();
    for (const tile of (Array.isArray(floor) ? floor : [])) {
      const c = Number(tile?.[0]), r = Number(tile?.[1]);
      if (Number.isFinite(c) && Number.isFinite(r)) set.add(`${c},${r}`);
    }
    return set;
  }

  function normalizeGable(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const side = String(raw.side || '').toLowerCase();
    if (!SIDES.includes(side)) return null;
    const line = Number(raw.line), from = Number(raw.from), to = Number(raw.to);
    if (![line, from, to].every(Number.isFinite) || to - from < 1e-6) return null;
    return { side, line, from, to, rise: clamp(raw.rise, MIN_GABLE_RISE, MAX_GABLE_RISE, DEFAULT_GABLE_RISE) };
  }

  function normalizeCeiling(raw) {
    if (raw === false) return { enabled: false, gables: [] };
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: value.enabled !== false,
      gables: (Array.isArray(value.gables) ? value.gables : []).map(normalizeGable).filter(Boolean),
    };
  }

  // Inward axis/sign per side: along = coordinate running the length of the
  // wall, depth = coordinate running into the room.
  function sideAxes(side) {
    if (side === 'north') return { along: 'x', inward: 1 };
    if (side === 'south') return { along: 'x', inward: -1 };
    if (side === 'west') return { along: 'z', inward: 1 };
    return { along: 'z', inward: -1 };
  }

  // Wall edge test for a floor cell: does this cell have a wall on `side`?
  // Mirrors InteriorSceneBuilder.buildWallPanels's neighbour test, except
  // exit tiles still count — a gable runs straight over a doorway.
  function cellHasWall(floorSet, c, r, side) {
    if (!floorSet.has(`${c},${r}`)) return false;
    if (side === 'north') return !floorSet.has(`${c},${r - 1}`);
    if (side === 'south') return !floorSet.has(`${c},${r + 1}`);
    if (side === 'west') return !floorSet.has(`${c - 1},${r}`);
    return !floorSet.has(`${c + 1},${r}`);
  }

  // Every maximal straight run of wall edges, as { side, line, from, to }.
  function wallStretches(floorInput) {
    const floorSet = toFloorSet(floorInput);
    const runs = { north: new Map(), south: new Map(), west: new Map(), east: new Map() };
    for (const key of floorSet) {
      const [c, r] = key.split(',').map(Number);
      for (const side of SIDES) {
        if (!cellHasWall(floorSet, c, r, side)) continue;
        const line = side === 'north' ? r : side === 'south' ? r + 1 : side === 'west' ? c : c + 1;
        const pos = side === 'north' || side === 'south' ? c : r;
        if (!runs[side].has(line)) runs[side].set(line, []);
        runs[side].get(line).push(pos);
      }
    }
    const out = [];
    for (const side of SIDES) {
      for (const [line, positions] of runs[side]) {
        positions.sort((a, b) => a - b);
        let start = positions[0], prev = positions[0];
        for (let i = 1; i <= positions.length; i++) {
          const p = positions[i];
          if (p === prev + 1) { prev = p; continue; }
          out.push({ side, line, from: start, to: prev + 1 });
          start = prev = p;
        }
      }
    }
    return out;
  }

  function overlaps(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0) > 1e-6; }

  function sameStretch(gable, stretch) {
    return gable.side === stretch.side && Math.abs(gable.line - stretch.line) < 1e-6 && overlaps(gable.from, gable.to, stretch.from, stretch.to);
  }

  // Nearest wall stretch to a tile-space point (x = col units, z = row
  // units). The editor uses it to turn a click on any floor or wall tile
  // into "the wall stretch nearest the cursor".
  function findStretchNear(floorInput, x, z, maxDistance = 1.25) {
    let best = null, bestD = Infinity;
    for (const s of wallStretches(floorInput)) {
      const { along } = sideAxes(s.side);
      const a = along === 'x' ? x : z, d = along === 'x' ? z : x;
      const da = a < s.from ? s.from - a : a > s.to ? a - s.to : 0;
      const dist = Math.hypot(da, d - s.line);
      if (dist < bestD) { bestD = dist; best = s; }
    }
    return bestD <= maxDistance ? best : null;
  }

  // Adds a gable over the stretch nearest (x, z), or removes the gable
  // already there. Returns a new normalized ceiling plus what happened.
  function toggleGableAt(ceilingInput, floorInput, x, z, rise) {
    const ceiling = normalizeCeiling(ceilingInput);
    const stretch = findStretchNear(floorInput, x, z);
    if (!stretch) return { ceiling, action: 'none', stretch: null };
    const existing = ceiling.gables.findIndex(g => sameStretch(g, stretch));
    if (existing >= 0) {
      ceiling.gables.splice(existing, 1);
      return { ceiling, action: 'removed', stretch };
    }
    ceiling.gables.push({ ...stretch, rise: clamp(rise, MIN_GABLE_RISE, MAX_GABLE_RISE, DEFAULT_GABLE_RISE) });
    return { ceiling, action: 'added', stretch };
  }

  // Pairs each live gable with the wall stretch facing it across the room.
  // Gables whose wall no longer exists (floor edited since) are dropped.
  function resolveGables(floorSet, ceiling) {
    const stretches = wallStretches(floorSet);
    const resolved = [];
    for (const gable of ceiling.gables) {
      if (!stretches.some(s => sameStretch(gable, s))) continue;
      const { along, inward } = sideAxes(gable.side);
      const oppositeSide = OPPOSITE[gable.side];
      let opposite = null;
      for (const s of stretches) {
        if (s.side !== oppositeSide || (s.line - gable.line) * inward <= 1e-6) continue;
        if (!overlaps(gable.from, gable.to, s.from, s.to)) continue;
        if (!opposite || Math.abs(s.line - gable.line) < Math.abs(opposite.line - gable.line)) opposite = s;
      }
      // An opposite gable keeps its own extents/rise; a flat opposite wall
      // contributes its two flat halves (rise 0) split at its own middle.
      const oppositeGable = opposite ? ceiling.gables.find(g => sameStretch(g, opposite)) : null;
      resolved.push({
        ...gable,
        along,
        oppLine: opposite ? opposite.line : gable.line + inward * 1e6,
        oppFrom: oppositeGable ? oppositeGable.from : opposite ? opposite.from : gable.from,
        oppTo: oppositeGable ? oppositeGable.to : opposite ? opposite.to : gable.to,
        oppRise: oppositeGable ? oppositeGable.rise : 0,
      });
    }
    return resolved;
  }

  function gableLiftAt(g, x, z) {
    const a = g.along === 'x' ? x : z, d = g.along === 'x' ? z : x;
    const t = (d - g.line) / (g.oppLine - g.line);
    if (!(t >= -1e-9 && t <= 1 + 1e-9)) return 0;
    const from = g.from + (g.oppFrom - g.from) * t, to = g.to + (g.oppTo - g.to) * t;
    if (!(to - from > 1e-9) || a <= from || a >= to) return 0;
    const u = (a - from) / (to - from);
    return (g.rise + (g.oppRise - g.rise) * t) * (1 - Math.abs(2 * u - 1));
  }

  function heightAt(resolved, wallHeight, x, z) {
    let lift = 0;
    for (const g of resolved) { const h = gableLiftAt(g, x, z); if (h > lift) lift = h; }
    return wallHeight + lift;
  }

  // Pure geometry — plain arrays so tests and tools don't need THREE.
  // ceiling: downward-facing quads over every floor cell.
  // gables: one inward-facing triangle per live gable, sitting on its wall top.
  function buildCeilingGeometryData(floorInput, wallHeightInput, ceilingInput) {
    const floorSet = toFloorSet(floorInput);
    const wallHeight = clamp(wallHeightInput, 0.1, 64, 1.75);
    const ceiling = normalizeCeiling(ceilingInput);
    const resolved = ceiling.enabled ? resolveGables(floorSet, ceiling) : [];
    const ceilingData = { positions: [], uvs: [], indices: [] };
    let maxY = wallHeight;
    if (ceiling.enabled) {
      const n = resolved.length ? GABLE_SUBDIVISIONS : 1;
      let vertex = 0;
      for (const key of floorSet) {
        const [c, r] = key.split(',').map(Number);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const x0 = c + i / n, x1 = c + (i + 1) / n, z0 = r + j / n, z1 = r + (j + 1) / n;
          const y00 = heightAt(resolved, wallHeight, x0, z0), y10 = heightAt(resolved, wallHeight, x1, z0);
          const y11 = heightAt(resolved, wallHeight, x1, z1), y01 = heightAt(resolved, wallHeight, x0, z1);
          maxY = Math.max(maxY, y00, y10, y11, y01);
          ceilingData.positions.push(x0, y00, z0, x1, y10, z0, x1, y11, z1, x0, y01, z1);
          ceilingData.uvs.push(x0, z0, x1, z0, x1, z1, x0, z1);
          // (x0,z0)->(x1,z0)->(x1,z1) winds with a -Y normal: faces down into the room.
          ceilingData.indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
          vertex += 4;
        }
      }
    }
    const gables = resolved.map(g => {
      const mid = (g.from + g.to) / 2, top = wallHeight + g.rise;
      const point = (a, y) => (g.along === 'x' ? [a, y, g.line] : [g.line, y, a]);
      let tri = [point(g.from, wallHeight), point(g.to, wallHeight), point(mid, top)];
      // Wind so the face normal points into the room (same culling rule as the ceiling).
      const e1 = tri[1].map((v, k) => v - tri[0][k]), e2 = tri[2].map((v, k) => v - tri[0][k]);
      const normal = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const inward = sideAxes(g.side).inward;
      const facing = g.along === 'x' ? normal[2] * inward : normal[0] * inward;
      if (facing < 0) tri = [tri[1], tri[0], tri[2]];
      const positions = [].concat(...tri);
      const uvs = [];
      for (const p of tri) uvs.push(g.along === 'x' ? p[0] : p[2], p[1]);
      return { side: g.side, line: g.line, from: g.from, to: g.to, rise: g.rise, positions, uvs, indices: [0, 1, 2] };
    });
    return { enabled: ceiling.enabled, wallHeight, maxY, gableCount: resolved.length, ceiling: ceilingData, gables };
  }

  // ── THREE wrapper ────────────────────────────────────────────────────
  const _materials = new Map(); // style|basePath|role|preview -> shared material; one decoded texture across every interior.
  const GABLE_PANEL_ROTATION = { north: [0, 0, 0], south: [0, 180, 0], west: [0, 90, 0], east: [0, -90, 0] }; // Same yaw per side as InteriorSceneBuilder.buildWallPanels.

  function surfaceMaterial(THREE, wallStyle, texturesBasePath, role, preview) {
    const canvas = wallStyle === 'canvas';
    const base = texturesBasePath || 'assets/';
    const key = `${canvas ? 'canvas' : 'boards'}|${base}|${role}|${preview ? 'preview' : 'live'}`;
    if (_materials.has(key)) return _materials.get(key);
    // Ceilings face away from the directional key light, so they read a
    // shade darker than the floor — tinted rafters/planks, not a bright lid.
    // A brick gable's backing is a dark mortar fill behind the stepped
    // brick edge, so it carries no texture.
    const backing = role === 'gable-backing';
    const tint = backing ? 0x3e3128 : canvas ? 0xd8c7a0 : role === 'gable' ? 0xa08868 : 0x8a7458;
    // Editor preview: seen from the overhead orbit camera, so draw both
    // sides, see-through, without hiding the room under it.
    const material = new THREE.MeshLambertMaterial(preview
      ? { color: tint, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }
      : { color: tint, side: THREE.FrontSide });
    material.name = `interior-ceiling-${role}${preview ? '-preview' : ''}`;
    if (!backing) {
      try {
        new THREE.TextureLoader().load(base + (canvas ? 'textures/canvas.png' : 'textures/boards.png'), tex => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
          material.map = tex;
          material.needsUpdate = true;
        }, undefined, () => {});
      } catch (_) { /* untextured tint is an acceptable fallback */ }
    }
    _materials.set(key, material);
    return material;
  }

  function meshFrom(THREE, data, material, name) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setIndex(data.indices.length > 65535 ? new THREE.Uint32BufferAttribute(data.indices, 1) : data.indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  }

  // WallBuilder panels for brick gable ends: one rectangle per gable sitting
  // on the wall top, which WallBuilder clips to its triangle (triangleClip).
  function gableBrickPanels(gables, wallHeight) {
    return gables.map(g => {
      const mid = (g.from + g.to) / 2;
      const horizontal = g.side === 'north' || g.side === 'south';
      return {
        id: `gable_${g.side}_${g.line}_${g.from}`,
        width: g.to - g.from,
        height: g.rise,
        position: horizontal ? [mid, wallHeight, g.line] : [g.line, wallHeight, mid],
        rotationDeg: GABLE_PANEL_ROTATION[g.side],
        triangleClip: true,
      };
    });
  }

  // options: { floor (Set or [[c,r]]), wallHeight, ceiling, wallStyle,
  //            texturesBasePath, includeCeiling (default true),
  //            preview (editor: double-sided see-through ceiling),
  //            wallBuilder + wallBuildOptions (brick gable ends; omit for plain plank gables) }
  // Cavern/mine interiors return an empty group — their carved shell is the roof.
  function buildCeilingGroup(THREE, options = {}) {
    const group = new THREE.Group();
    group.name = 'InteriorCeiling';
    if (options.wallStyle === 'cavern' || options.wallStyle === 'mine') return group;
    const data = buildCeilingGeometryData(options.floor, options.wallHeight, options.ceiling);
    const preview = !!options.preview;
    // Brick (default-style) rooms get brick gable ends to match the walls
    // below; canvas tents keep a cloth triangle.
    const brickGables = !!options.wallBuilder && options.wallStyle !== 'canvas' && data.gables.length > 0;
    group.userData.interiorCeiling = { enabled: data.enabled, wallHeight: data.wallHeight, maxY: data.maxY, gableCount: data.gableCount, brickGables };
    if (options.includeCeiling !== false && data.ceiling.indices.length) {
      const mesh = meshFrom(THREE, data.ceiling, surfaceMaterial(THREE, options.wallStyle, options.texturesBasePath, 'ceiling', preview), 'InteriorCeilingSurface');
      mesh.userData.interiorCeilingSurface = true;
      if (preview) mesh.renderOrder = 2; // Transparent preview draws after the opaque room.
      group.add(mesh);
    }
    for (const gable of data.gables) {
      const role = brickGables ? 'gable-backing' : 'gable';
      const mesh = meshFrom(THREE, gable, surfaceMaterial(THREE, options.wallStyle, options.texturesBasePath, role, false), `InteriorGable_${gable.side}_${gable.line}`);
      mesh.userData.interiorGable = { side: gable.side, line: gable.line, from: gable.from, to: gable.to, rise: gable.rise };
      mesh.userData.cameraObstacle = true; // It's wall: pull the follow camera in front of it like the brick below.
      group.add(mesh);
    }
    if (brickGables) {
      const wallOptions = Object.assign({}, root.InteriorSceneBuilder?.DEFAULT_WB_OPTS || {}, options.wallBuildOptions || {});
      try {
        const bricks = options.wallBuilder.build(gableBrickPanels(data.gables, data.wallHeight), wallOptions);
        bricks.name = 'InteriorGableBricks';
        bricks.userData.interiorGableBricks = true;
        group.add(bricks);
      } catch (error) {
        console.warn('InteriorCeilings: brick gable build failed, keeping plain gable ends:', error);
      }
    }
    return group;
  }

  root.InteriorCeilings = Object.freeze({
    DEFAULT_GABLE_RISE,
    normalizeCeiling,
    wallStretches,
    findStretchNear,
    toggleGableAt,
    buildCeilingGeometryData,
    gableBrickPanels,
    buildCeilingGroup,
  });
})(typeof window !== 'undefined' ? window : globalThis);
