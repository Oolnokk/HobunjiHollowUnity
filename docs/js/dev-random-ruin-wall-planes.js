// Debris-ifier V50 interior walls are structural geometry, not an optional
// preview layer. Embedded generation uses parent.THREE, so the generated wall
// meshes themselves are now the visible game-realm drawables as well as the
// authoritative collision/source transforms.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const GridTileAccessors = window.GridTileAccessors;
  const DS = window.DynamicSurfaces;
  if (!GridTileAccessors || !DS) return;

  let appliedRoot = null;

  function activeRuinRoot() {
    if (GridTileAccessors.getCurrentArea?.() !== MAP_ID) return null;
    const scene = GridTileAccessors.getActiveScene?.();
    return scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
  }

  function applyToRoot(root) {
    if (!root?.traverse) return { count:0, meshVisible:0 };
    let count = 0;
    let meshVisible = 0;
    root.traverse(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      count++;
      object.visible = true;
      object.userData.runtimeWallPlaneVisualEnabled = true;
      object.userData.runtimeWallPlaneStructural = true;
      if (object.visible !== false) meshVisible++;
    });
    appliedRoot = root;
    return { count, meshVisible };
  }

  function apply() {
    const root = activeRuinRoot();
    if (!root) {
      appliedRoot = null;
      return { count:0, meshVisible:0 };
    }
    if (root !== appliedRoot) return applyToRoot(root);
    return { count:null, meshVisible:null, unchanged:true }; // Same root already applied; skip the per-frame full traverse (snapshot() stays available for diagnostics).
  }

  function snapshot(root = activeRuinRoot()) {
    if (!root?.traverse) return { enabled:true, count:0, meshVisible:0, blockerCount:0 };
    let count = 0;
    let meshVisible = 0;
    root.traverse(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      count++;
      if (object.visible !== false) meshVisible++;
    });
    const blockerCount = DS.debugSnapshot?.().blockers?.filter(record => String(record.id || '').startsWith('devruin-wall-')).length || 0;
    return { enabled:true, count, meshVisible, blockerCount };
  }

  // V50 was authored as a roofless ruin: it randomly omits 5.5–13% of wall panels, "ruins" the rest to 72–100% of
  // the room height (with their foot sunk below the floor), and leaves the space above each doorway arch open. The
  // dungeon puts a flat ceiling on it at the wall-top datum (buildTexturedCeiling in js/dev-random-ruin-interior-map.js),
  // so each of those became a hole into the black void: a missing wall, a band above every wall, a window above every
  // arch. V50's source is pinned by tests, so closeUnderCeiling fixes all three after generation: omitted panels are
  // rebuilt full height, surviving panels are stretched (foot fixed) into the ceiling, and each arch gets a carved
  // stone header from its lintel to the ceiling. Returns { walls, headers, restored } for diagnostics.
  const CEILING_TUCK = .03; // Overlap into the ceiling so no hairline shows at the seam.
  const V50_WALL_FOOT_Y = .06 - .24, V50_CORNER_OVERLAP = .16; // V50's INTERIOR_FLOOR_SURFACE_Y - INTERIOR_WALL_FLOOR_OVERLAP, INTERIOR_WALL_CORNER_OVERLAP.

  // The wall panels V50 derives for a room network, in V50's own order, ids and local frame. A port of its
  // deriveInteriorWallPanels/interiorEdgeIsDungeonEntrance/mergeInteriorSegments (docs/tools/debris-ifier/
  // debrisifier-v50-source.js) over the metadata V50 returns, used to find the panels its 5.5–13% random omission
  // dropped: with a ceiling on, each one was a hole into the void.
  function expectedWallPanels(meta) {
    const cells = Array.isArray(meta?.floorCells) ? meta.floorCells : [], cs = Number(meta?.cellSize);
    if (!cells.length || !(cs > 0)) return [];
    const floor = new Set(cells.map(([c, r]) => c + ',' + r)), e = meta.entrance, room = e && (meta.rooms || []).find(entry => entry.id === e.roomId);
    const entranceEdge = (side, c, r) => {
      if (!room || e.side !== side) return false;
      const half = e.widthCells * .5;
      if (side === 'north') return r === room.row && c + .5 >= e.center - half && c + .5 < e.center + half;
      if (side === 'south') return r === room.row + room.h - 1 && c + .5 >= e.center - half && c + .5 < e.center + half;
      if (side === 'west') return c === room.col && r + .5 >= e.center - half && r + .5 < e.center + half;
      return c === room.col + room.w - 1 && r + .5 >= e.center - half && r + .5 < e.center + half;
    };
    const maps = { north:{}, south:{}, east:{}, west:{} }, push = (map, k, a0, a1) => (map[k] || (map[k] = [])).push([a0, a1]);
    for (const key of floor) {
      const [c, r] = key.split(',').map(Number);
      if (!floor.has(c + ',' + (r - 1)) && !entranceEdge('north', c, r)) push(maps.north, r, c, c + 1);
      if (!floor.has(c + ',' + (r + 1)) && !entranceEdge('south', c, r)) push(maps.south, r + 1, c, c + 1);
      if (!floor.has((c + 1) + ',' + r) && !entranceEdge('east', c, r)) push(maps.east, c + 1, r, r + 1);
      if (!floor.has((c - 1) + ',' + r) && !entranceEdge('west', c, r)) push(maps.west, c, r, r + 1);
    }
    const merge = segs => { segs.sort((a, b) => a[0] - b[0]); const out = []; for (const s of segs) { const last = out[out.length - 1]; if (last && last[1] >= s[0] - 1e-9) last[1] = Math.max(last[1], s[1]); else out.push(s.slice()); } return out; };
    const ox = -Number(meta.worldWidth) / 2, oz = -Number(meta.worldDepth) / 2, panels = [];
    let pid = 0;
    const SIDES = [['north', 'wn', 0], ['south', 'ws', Math.PI], ['east', 'we', -Math.PI / 2], ['west', 'ww', Math.PI / 2]];
    for (const [side, prefix, rotY] of SIDES) for (const [k, segs] of Object.entries(maps[side])) for (const [a0, a1] of merge(segs)) {
      const line = Number(k) * cs, mid = (a0 + a1) * .5 * cs, width = (a1 - a0) * cs;
      const horizontal = side === 'north' || side === 'south';
      panels.push({ id:prefix + '_' + (pid++), side, width, rotY, x:horizontal ? mid + ox : line + ox, z:horizontal ? line + oz : mid + oz });
    }
    return panels;
  }

  // Rebuilds the panels V50 omitted as full-height walls in the surviving panels' own frame and material.
  // Refuses (returns 0) unless every surviving panel sits exactly where the port predicts.
  function restoreOmittedPanels(walls, meta, footY, topY) {
    const THREE = window.THREE, expected = expectedWallPanels(meta), byName = new Map(walls.map(w => [w.name, w]));
    if (!expected.length || !walls.length) return 0;
    for (const panel of expected) {
      const wall = byName.get('ruin_wall_' + panel.id);
      if (wall && (Math.abs(wall.position.x - panel.x) > 1e-3 || Math.abs(wall.position.z - panel.z) > 1e-3)) return 0;
    }
    const sample = walls[0], parent = sample.parent;
    if (!parent) return 0;
    let restored = 0;
    for (const panel of expected) {
      if (byName.has('ruin_wall_' + panel.id)) continue;
      const height = topY - footY;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(panel.width + V50_CORNER_OVERLAP * 2, height, 1, 1), sample.material);
      wall.name = 'ruin_wall_' + panel.id; // Same naming as V50, so pattern surfaces, x-ray proxies and footprints treat it alike.
      wall.position.set(panel.x, footY + height / 2, panel.z);
      wall.rotation.y = panel.rotY;
      wall.userData.ruinInteriorWall = true;
      wall.userData.ruinWallRestored = true;
      wall.userData.ruinWallReachesCeiling = true;
      parent.add(wall);
      walls.push(wall);
      restored++;
    }
    return restored;
  }

  function closeUnderCeiling(root, ceilingY, meta = null) {
    const THREE = window.THREE, out = { walls:0, headers:0, restored:0 };
    if (!root?.traverse || !Number.isFinite(Number(ceilingY)) || !THREE?.Box3) return out;
    const target = Number(ceilingY) + CEILING_TUCK, box = new THREE.Box3(), walls = [], arches = [];
    root.updateMatrixWorld?.(true);
    root.traverse(object => {
      if (object.userData?.ruinInteriorWall && object.isMesh && object.geometry) walls.push(object);
      else if (object.userData?.archFootprint) arches.push(object);
    });
    if (meta && walls[0]?.parent) { // Local frame of the walls: V50's world, with the root's 2x horizontal scale above it.
      const toLocalY = y => walls[0].parent.worldToLocal(new THREE.Vector3(0, y, 0)).y;
      out.restored = restoreOmittedPanels(walls, meta, V50_WALL_FOOT_Y, toLocalY(target));
      if (out.restored) root.updateMatrixWorld?.(true);
    }
    let stone = null;
    const corner = new THREE.Vector3();
    for (const wall of walls) {
      stone = stone || wall.material;
      if (!wall.geometry.boundingBox) wall.geometry.computeBoundingBox();
      const local = wall.geometry.boundingBox;
      box.copy(local).applyMatrix4(wall.matrixWorld);
      // V50 tilts each panel a hair (rotation.z), so one top corner of a wide panel sits lower than the other:
      // stretch until the LOWEST top vertex reaches the ceiling.
      let lowTop = Infinity;
      const position = wall.geometry.attributes?.position;
      for (let i = 0; position && i < position.count; i++) {
        if (position.getY(i) < local.max.y - 1e-4) continue;
        lowTop = Math.min(lowTop, corner.fromBufferAttribute(position, i).applyMatrix4(wall.matrixWorld).y);
      }
      if (!Number.isFinite(lowTop)) lowTop = box.max.y;
      const height = lowTop - box.min.y;
      if (height < .1 || lowTop >= target - 1e-3 || wall.userData.ruinWallRestored) continue;
      const scaleY = wall.scale.y * (target - box.min.y) / height;
      wall.position.y += local.min.y * (wall.scale.y - scaleY); // Keep the panel's foot where it was.
      wall.scale.y = scaleY;
      wall.userData.ruinWallReachesCeiling = true;
      out.walls++;
    }
    for (const arch of arches) {
      box.setFromObject(arch);
      if (box.isEmpty() || box.max.y >= target - .05) continue;
      const sizeX = box.max.x - box.min.x, sizeZ = box.max.z - box.min.z, rise = target - box.max.y + .04;
      const material = window.ProceduralFurniture?.makePartMaterial?.({ materialTexture:'carved_smooth.png', materialLighting:'unlit', materialFillMode:'never', color:'#7a746b' }) || stone;
      if (!material) continue;
      const header = new THREE.Mesh(new THREE.BoxGeometry(sizeX, rise, sizeZ), material); // World-sized: the arch's parent is scaled 2x horizontally.
      header.name = 'ruin_doorway_header';
      header.userData.ruinDoorwayHeader = true; // Not a ruinInteriorWall: the Great Door must never pick a lintel.
      window.HobunjiSurfaceStretchUV?.mapMesh?.(header); // One stretched, inked PNG per face (visual-authoring rule 2).
      header.layers?.disable?.(1); // ...so no generated shell outline.
      const parent = arch.parent || root, centre = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - .04 + rise / 2, (box.min.z + box.max.z) / 2);
      parent.add(header);
      parent.updateMatrixWorld?.(true);
      header.position.copy(parent.worldToLocal(centre));
      const s = parent.getWorldScale?.(new THREE.Vector3()) || { x:1, y:1, z:1 };
      header.scale.set(1 / (s.x || 1), 1 / (s.y || 1), 1 / (s.z || 1));
      out.headers++;
    }
    return out;
  }

  function removeObsoleteToggle() {
    document.getElementById('devRandomRuinWallPlanesRow')?.remove?.();
    try { localStorage.removeItem('hobunjiDevRandomRuinWallPlanes'); } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', removeObsoleteToggle, { once:true });
  else removeObsoleteToggle();

  DS.addBeforeRenderClient(() => apply()); // removeObsoleteToggle runs once at load; calling it per render hit localStorage every frame for every player.

  window.DevRandomRuinWallPlanes = Object.freeze({
    setVisible:() => apply(),
    isVisible:() => true,
    apply,
    closeUnderCeiling,
    expectedWallPanels,
    snapshot:() => snapshot(),
  });
})();
