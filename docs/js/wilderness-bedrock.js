(() => {
  'use strict';

  // Persistent cliff-material "bedrock" shell under a wilderness zone.
  //
  // Wilderness ground is built from top-only heightfields (plateau mesas,
  // route apron, carved water beds) that are streamed in 16x16-tile chunks.
  // Anything the heightfields do not cover is a hole that shows the scene
  // background straight through it: hairline cracks between cliff-face quads,
  // the empty column under a carved river/waterfall bed where it drops to the
  // lower tier (behind the water sheet), and whole not-yet-streamed chunks
  // seen through water, which is a map-level mesh and stays resident.
  //
  // This builds one coarse, always-resident mesh per zone, one draw call: a
  // stepped heightfield with a cell per tile, kept well below every real
  // surface (so it can never poke through or z-fight), with vertical risers
  // wherever neighbouring cells differ and explicit backing walls behind every
  // water cell that sits above a lower neighbour. It uses the same cliff PNG
  // material as the plateau cliff slot, so anything seen through a gap reads
  // as more cliff rock instead of the void.
  const BEDROCK_DEPTH = 0.9; // World-Y gap kept between every real surface and the bedrock top.
  const BED_SEAT = 0.05; // How far above a water bed a backing wall reaches, overlapping the bed's own cut wall.
  const POLYGON_OFFSET_FACTOR = 2; // Pushes bedrock back in depth so any real surface that is coplanar with it always wins.
  const POLYGON_OFFSET_UNITS = 4;
  const SHADE = 0.78; // Slightly darker than visible cliff faces so a gap reads as shadowed inner rock.

  let deps = null;
  let sharedMaterial = null; // One cliff material reused by every zone's bedrock mesh.
  const stats = Object.create(null); // Per-zone build summary exposed through snapshot().

  function init(injectedDeps) { deps = injectedDeps; }

  function bedrockMaterial() {
    if (sharedMaterial) return sharedMaterial;
    const THREE = window.THREE;
    // Obtain the exact cliff-slot material (repeating world-UV carved PNG)
    // through a throwaway two-slot proxy, the same way a plateau mesa gets it.
    let source = null;
    const natural = window.NaturalSurfaceMaterials;
    if (typeof natural?.naturalizeMaterialSlot === 'function') {
      const lambert = new THREE.MeshLambertMaterial({ color: 0x808080 });
      const proxyGeometry = new THREE.PlaneGeometry(1, 1);
      const proxy = new THREE.Mesh(proxyGeometry, [lambert, lambert]);
      natural.naturalizeMaterialSlot(proxy, 1, 'cliffs');
      source = Array.isArray(proxy.material) ? proxy.material[1] : proxy.material;
      proxyGeometry.dispose();
      if (source === lambert) source = null;
    }
    sharedMaterial = source ? source.clone() : new THREE.MeshLambertMaterial({ color: 0x6f6a64 });
    sharedMaterial.color.multiplyScalar(SHADE);
    sharedMaterial.side = THREE.DoubleSide; // Risers are seen from either side depending on which neighbour is lower.
    sharedMaterial.polygonOffset = true;
    sharedMaterial.polygonOffsetFactor = POLYGON_OFFSET_FACTOR;
    sharedMaterial.polygonOffsetUnits = POLYGON_OFFSET_UNITS;
    sharedMaterial.name = 'wilderness_bedrock_cliff';
    return sharedMaterial;
  }

  // Un-displaced surface height of a tile's own ground: its tier (or ramp
  // elevation), sunk to the bed for river/stream/waterfall/trench cells.
  function cellBase(tile) {
    if (!tile) return null;
    const T = deps.TileType;
    const lift = tile.type === T.RAMP ? (tile.rampElevation || 0) : (tile.elevTier || 0);
    let y = deps.NORMAL_TOP + lift * deps.PLATEAU_UNIT;
    const bed = deps.DEPRESSION_TOP[tile.type];
    if (bed !== undefined && tile.type !== T.RAMP) y += bed - deps.NORMAL_TOP;
    return y;
  }

  function build(zScene, zGrid, cols, rows, mapId) {
    if (!deps || !zScene?.add || !zGrid || !cols || !rows) return null;
    const THREE = window.THREE;
    const idx = (c, r) => r * cols + c;

    // Every cell's top is the lowest ground height anywhere in its 3x3
    // neighbourhood, minus BEDROCK_DEPTH. Mesa cliff faces are heightfield
    // slopes spread across the cell beside a tier change, so a cell's own
    // tier alone can sit above the real slope; the neighbourhood minimum never does.
    const base = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) base[idx(c, r)] = cellBase(zGrid[r]?.[c]);
    const tops = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let low = Infinity;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc;
            if (cc < 0 || cc >= cols) continue;
            const b = base[idx(cc, rr)];
            if (b < low) low = b;
          }
        }
        tops[idx(c, r)] = low - BEDROCK_DEPTH;
      }
    }

    const pos = [], uv = [], indices = [];
    let vertexCount = 0;
    const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, ua, va, ub, vb, uc, vc, ud, vd) => {
      pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      uv.push(ua, va, ub, vb, uc, vc, ud, vd);
      indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
      vertexCount += 4;
    };
    const flat = (x0, z0, x1, z1, y) => quad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, x0, z0, x1, z0, x1, z1, x0, z1);
    // Wall on a constant-X plane spanning z0..z1 and y0..y1.
    const wallX = (x, z0, z1, y0, y1) => quad(x, y0, z0, x, y0, z1, x, y1, z1, x, y1, z0, z0, y0, z1, y0, z1, y1, z0, y1);
    // Wall on a constant-Z plane spanning x0..x1 and y0..y1.
    const wallZ = (z, x0, x1, y0, y1) => quad(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, x0, y0, x1, y0, x1, y1, x0, y1);

    // Horizontal tops, merged into runs of equal height along each row.
    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        const y = tops[idx(c, r)];
        let end = c;
        while (end + 1 < cols && tops[idx(end + 1, r)] === y) end++;
        flat(c, r, end + 1, r + 1, y);
        c = end + 1;
      }
    }

    // Risers where neighbouring tops differ, merged along the shared edge.
    for (let c = 1; c < cols; c++) {
      let r = 0;
      while (r < rows) {
        const a = tops[idx(c - 1, r)], b = tops[idx(c, r)];
        if (a === b) { r++; continue; }
        const lo = Math.min(a, b), hi = Math.max(a, b);
        let end = r;
        while (end + 1 < rows && tops[idx(c - 1, end + 1)] === a && tops[idx(c, end + 1)] === b) end++;
        wallX(c, r, end + 1, lo, hi);
        r = end + 1;
      }
    }
    for (let r = 1; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        const a = tops[idx(c, r - 1)], b = tops[idx(c, r)];
        if (a === b) { c++; continue; }
        const lo = Math.min(a, b), hi = Math.max(a, b);
        let end = c;
        while (end + 1 < cols && tops[idx(end + 1, r - 1)] === a && tops[idx(end + 1, r)] === b) end++;
        wallZ(r, c, end + 1, lo, hi);
        c = end + 1;
      }
    }

    // Backing walls: a river/stream/waterfall/trench cell that sits above a
    // lower neighbour only has its short bed cut-wall on that side, and the
    // neighbourhood-minimum tops above push the generic risers away from the
    // shared edge, so seal the edge itself from the lower cell's bedrock up
    // to just inside the bed. This is the solid face behind a waterfall sheet.
    let backingWalls = 0;
    const T = deps.TileType;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = zGrid[r]?.[c];
        if (!tile || tile.type === T.RAMP || deps.DEPRESSION_TOP[tile.type] === undefined) continue;
        const own = base[idx(c, r)];
        const seat = own + BED_SEAT;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const lowerBase = base[idx(nc, nr)];
          if (!(lowerBase < own - 0.01)) continue;
          const bottom = tops[idx(nc, nr)];
          if (!(bottom < seat)) continue;
          if (dc !== 0) wallX(dc > 0 ? c + 1 : c, r, r + 1, bottom, seat);
          else wallZ(dr > 0 ? r + 1 : r, c, c + 1, bottom, seat);
          backingWalls++;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1));
    deps.displaceZoneGeometry?.(geometry, mapId); // Follows the same subtle visual-height field as the surfaces above it, so the depth gap holds.
    geometry.computeVertexNormals(); // Only the Lambert fallback material reads them; the cliff PNG material is unlit.
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, bedrockMaterial());
    mesh.name = `${mapId}_wilderness_bedrock`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.wildernessBedrock = true;
    mesh.userData.wildernessPersistentZoneFeature = 'bedrock'; // Lives on the zone scene, not a streamed chunk group.
    mesh.userData.wildernessPersistentZoneFeatureMapId = mapId;
    mesh.userData.noOutline = true;
    zScene.add(mesh);
    deps.markTerrainEdgeId?.(mesh, deps.edgeCategory);

    stats[mapId] = { cols, rows, quads: vertexCount / 4, triangles: indices.length / 3, backingWalls, depth: BEDROCK_DEPTH };
    return mesh;
  }

  window.WildernessBedrock = {
    init,
    build,
    snapshot: () => JSON.parse(JSON.stringify(stats)),
  };
})();
