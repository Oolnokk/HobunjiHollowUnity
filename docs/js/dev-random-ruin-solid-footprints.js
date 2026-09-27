// Exact oriented-box collision footprints for the Random Test Ruin's solid
// props (pillars, pedestals, obelisks, buttresses, baseboards, sarcophagi,
// canopy posts, ossuary shells...). Every visible mesh that physically
// occupies the player's body height becomes its own footprint, so what you
// see is what you collide with: no whole-tile halos around thin props, and no
// ghost props that were missing from a hand-kept role whitelist.
//
// Walls, doors and push blocks stay on the tile grid (they are authored on
// tile boundaries); surfaces you stand on (floor, daises, bridges, stairs,
// rope platforms, elevators) and non-solid dressing are excluded here.
(() => {
  'use strict';
  if (!window.THREE) return;

  const BODY_MIN = 0.36; // Anything whose top stays below this (relative to local floor) is a step, plate or rug.
  const BODY_MAX = 1.45; // Anything whose bottom starts above this is overhead (capitals, canopies, lintels).
  const MIN_HALF = 0.035; // Hairline decals/rods never block.
  const MAX_HALF = 4.5; // Larger single meshes are floor/ceiling slabs, not props.
  const CELL = 1; // Spatial hash cell size, in world units.

  // Surfaces, moving mechanisms and dressing that must never become a
  // horizontal blocker. Doors/push blocks are excluded because the tile grid
  // already owns them (with open/closed and moved state).
  const EXCLUDED_MOTIONS = new Set(['bridge', 'bridgeSequence', 'movingDais', 'collapsingStairs', 'stoneDoor', 'pushPuzzleBlock', 'elevatorPushBlock', 'pressurePlate']);
  const EXCLUDED_ROLE = /access|moulding/i; // V50 'dais access' / 'sunken access' steps are walkable plateau risers.
  const EXCLUDED_KEY = /socket|elevator|well|stair|ramp|step|rug|carpet/i; // Elevator-well rims/shafts and walkable treads.
  const EXCLUDED_NAME = /rope|lava|pressure_plate|chord_plate|projectile|ceiling|PathBrick|floor|balcony|platform|elevator|dais|bridge|stair|ladder|glyph_marker|circuit_lamp/i;

  function hiddenOrGhost(object, stopAt) {
    for (let node = object; node && node !== stopAt; node = node.parent) if (node.visible === false) return true;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    return !material || material.visible === false || material.colorWrite === false || (material.transparent && Number(material.opacity) < 0.2);
  }

  function excluded(object, stopAt) {
    for (let node = object; node && node !== stopAt; node = node.parent) {
      if (node.visible === false) return true;
      const d = node.userData || {};
      if (d.devRuinFootprintManaged || d.devRuinFootprintIgnore) return true;
      if (d.ruinInteriorWall || d.transitDoor || d.pushable) return true;
      if (d.generatedAccessType === 'stoneLadder') return true;
      if (d.devRandomRuinRopePlatform || d.devRandomRuinPressurePlate || d.devRandomRuinStoneCanopy) return true;
      if (d.wallBuilderRecipe) return true; // V50 floor/plateau mesh.
      if (d.previewMotion?.type && EXCLUDED_MOTIONS.has(d.previewMotion.type)) return true;
      if (EXCLUDED_NAME.test(node.name || '')) return true;
      if (EXCLUDED_ROLE.test(String(d.interiorRuinRole || ''))) return true;
      if (EXCLUDED_KEY.test([d.key, d.label, d.kind, d.objectType, d.furnitureKey].filter(Boolean).join(' '))) return true;
    }
    return hiddenOrGhost(object, stopAt);
  }

  const corner = new THREE.Vector3();
  function orientedFootprint(mesh) {
    const geometry = mesh.geometry;
    if (!geometry) return null;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const lb = geometry.boundingBox;
    if (!lb || lb.isEmpty()) return null;
    mesh.updateWorldMatrix(true, false);
    const e = mesh.matrixWorld.elements;
    // Yaw from whichever local horizontal axis still lies mostly in XZ.
    let ux = e[0], uz = e[2];
    if (Math.hypot(ux, uz) < 1e-4) { ux = e[8]; uz = e[10]; }
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul; uz /= ul;
    const vx = -uz, vz = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? lb.max.x : lb.min.x, i & 2 ? lb.max.y : lb.min.y, i & 4 ? lb.max.z : lb.min.z).applyMatrix4(mesh.matrixWorld);
      const u = corner.x * ux + corner.z * uz, v = corner.x * vx + corner.z * vz;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
      if (corner.y < minY) minY = corner.y; if (corner.y > maxY) maxY = corner.y;
    }
    const cu = (minU + maxU) * .5, cv = (minV + maxV) * .5;
    return {
      cx:cu * ux + cv * vx, cz:cu * uz + cv * vz,
      ux, uz, vx, vz,
      halfU:(maxU - minU) * .5, halfV:(maxV - minV) * .5,
      minY, maxY,
    };
  }

  function boxOverlaps(fp, x, z, half) {
    // Separating-axis test between the footprint and an axis-aligned square.
    const dx = x - fp.cx, dz = z - fp.cz;
    const du = Math.abs(dx * fp.ux + dz * fp.uz), dv = Math.abs(dx * fp.vx + dz * fp.vz);
    const squareOnU = half * (Math.abs(fp.ux) + Math.abs(fp.uz));
    const squareOnV = half * (Math.abs(fp.vx) + Math.abs(fp.vz));
    if (du > fp.halfU + squareOnU || dv > fp.halfV + squareOnV) return false;
    const extentX = fp.halfU * Math.abs(fp.ux) + fp.halfV * Math.abs(fp.vx);
    const extentZ = fp.halfU * Math.abs(fp.uz) + fp.halfV * Math.abs(fp.vz);
    return Math.abs(dx) <= extentX + half && Math.abs(dz) <= extentZ + half;
  }

  function extentOf(fp) {
    return {
      x:fp.halfU * Math.abs(fp.ux) + fp.halfV * Math.abs(fp.vx),
      z:fp.halfU * Math.abs(fp.uz) + fp.halfV * Math.abs(fp.vz),
    };
  }

  function sourceLabel(mesh, stopAt) {
    const parts = [];
    let purpose = null; // Semantic purpose (e.g. puzzle_tower_*, puzzle_target_pillar) from any ancestor, for Pixel Probe/tests.
    for (let node = mesh; node && node !== stopAt; node = node.parent) {
      const d = node.userData || {};
      if (!purpose && d.blockerPurpose) purpose = d.blockerPurpose;
      const label = d.interiorRuinRole || node.name;
      if (parts.length < 2 && label && !parts.includes(label)) parts.push(label);
    }
    if (purpose && !parts.includes(purpose)) parts.push(purpose);
    return parts.join(' < ') || `mesh-${mesh.id}`;
  }

  // A mutable set of footprints with a spatial hash. Static footprints come
  // from scanning roots; dynamic ones carry their own enabled() predicate.
  function createSet(options = {}) {
    const floorY = typeof options.floorY === 'function' ? options.floorY : () => 0;
    const footprints = [];
    let cells = new Map();

    function index(fp) {
      const ext = extentOf(fp);
      fp.minX = fp.cx - ext.x; fp.maxX = fp.cx + ext.x; fp.minZ = fp.cz - ext.z; fp.maxZ = fp.cz + ext.z;
      for (let cx = Math.floor(fp.minX / CELL); cx <= Math.floor(fp.maxX / CELL); cx++) {
        for (let cz = Math.floor(fp.minZ / CELL); cz <= Math.floor(fp.maxZ / CELL); cz++) {
          const key = cx + ',' + cz;
          let bucket = cells.get(key);
          if (!bucket) cells.set(key, bucket = []);
          bucket.push(fp);
        }
      }
    }

    function add(fp) {
      footprints.push(fp);
      index(fp);
      return fp;
    }

    // options.force scans a root the exclusion rules would skip (door panels),
    // options.enabled makes every footprint from this scan conditional.
    function scan(root, tag = 'static', options = {}) {
      if (!root?.traverse) return 0;
      root.updateMatrixWorld?.(true);
      let added = 0;
      root.traverse(mesh => {
        if (!mesh.isMesh || mesh.isInstancedMesh) return;
        if (options.force ? hiddenOrGhost(mesh, root.parent) : excluded(mesh, root.parent)) return;
        const fp = orientedFootprint(mesh);
        if (!fp || Math.max(fp.halfU, fp.halfV) < MIN_HALF || Math.max(fp.halfU, fp.halfV) > MAX_HALF) return;
        const ground = Number(floorY(fp.cx, fp.cz)) || 0;
        if (fp.maxY < ground + BODY_MIN || fp.minY > ground + BODY_MAX) return;
        fp.tag = tag;
        fp.source = sourceLabel(mesh, root.parent);
        fp.meshId = mesh.id;
        if (options.enabled) fp.enabled = options.enabled;
        add(fp);
        added++;
      });
      return added;
    }

    function addBox(id, box, enabled = null, tag = 'dynamic') {
      // box: { cx, cz, halfX, halfZ, yaw? } in world units.
      const yaw = Number(box.yaw) || 0;
      const fp = {
        cx:Number(box.cx), cz:Number(box.cz),
        ux:Math.cos(yaw), uz:-Math.sin(yaw), vx:Math.sin(yaw), vz:Math.cos(yaw),
        halfU:Math.max(MIN_HALF, Number(box.halfX) || 0), halfV:Math.max(MIN_HALF, Number(box.halfZ) || 0),
        minY:-Infinity, maxY:Infinity, tag, source:String(id), enabled,
      };
      return add(fp);
    }

    function removeTag(tag) {
      const kept = footprints.filter(fp => fp.tag !== tag);
      footprints.length = 0;
      cells = new Map();
      for (const fp of kept) add(fp);
    }

    function blocksBox(x, z, half = 0, worldY = null) {
      const minCX = Math.floor((x - half) / CELL), maxCX = Math.floor((x + half) / CELL);
      const minCZ = Math.floor((z - half) / CELL), maxCZ = Math.floor((z + half) / CELL);
      for (let cx = minCX; cx <= maxCX; cx++) for (let cz = minCZ; cz <= maxCZ; cz++) {
        const bucket = cells.get(cx + ',' + cz);
        if (!bucket) continue;
        for (const fp of bucket) {
          if (fp.enabled && !fp.enabled()) continue;
          if (worldY != null && (worldY > fp.maxY + half || worldY < fp.minY - half)) continue; // Projectile passing over/under this prop.
          if (x + half < fp.minX || x - half > fp.maxX || z + half < fp.minZ || z - half > fp.maxZ) continue;
          if (boxOverlaps(fp, x, z, half)) return fp;
        }
      }
      return null;
    }

    // Tiles whose centre sits inside a footprint: coarse view for the Map tab
    // and the generation-time reachability audit (never stamped into the grid).
    function centerCoveredTiles(floorSet) {
      const result = new Map();
      for (const fp of footprints) {
        if (fp.enabled && !fp.enabled()) continue;
        for (let col = Math.floor(fp.minX); col <= Math.floor(fp.maxX); col++) {
          for (let row = Math.floor(fp.minZ); row <= Math.floor(fp.maxZ); row++) {
            const key = col + ',' + row;
            if (floorSet && !floorSet.has(key)) continue;
            if (!boxOverlaps(fp, col + .5, row + .5, 0)) continue;
            let set = result.get(key);
            if (!set) result.set(key, set = new Set());
            set.add('footprint:' + fp.source);
          }
        }
      }
      return result;
    }

    return {
      scan, addBox, removeTag, blocksBox, centerCoveredTiles,
      list:() => footprints.filter(fp => !fp.enabled || fp.enabled()),
      count:() => footprints.length,
    };
  }

  window.DevRandomRuinSolidFootprints = Object.freeze({ createSet, BODY_MIN, BODY_MAX });
})();
