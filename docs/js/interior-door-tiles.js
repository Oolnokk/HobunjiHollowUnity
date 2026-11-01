// Interior "door" tiles — a map-JSON tile type (`doorTiles: [[col,row],...]`)
// that places the authored Wooden Door furniture on a floor tile. Map exits
// opt in with generateDoor:true and direction:north|south|east|west (inward).
// Exit doors open on approach and preserve the existing map-travel interaction.
//
//  * Orientation is automatic (orientation()): the door panel bridges the two
//    unpainted tiles beside it. A dead-end door (exactly one painted
//    neighbour) faces that neighbour; a door with no painted neighbour faces
//    north.
//  * NPCs never collide with it. The door opens while any NPC stands on, or
//    horizontally/vertically next to, its tile and closes once none do.
//  * While closed it blocks the player (via window.AreaFootprintBlockers-style
//    blocksBox(), consulted by game.js's canPlayerOccupy only); the player
//    opens it by hand with the door's interaction. A hand-opened door stays
//    open while the player is near it and closes shortly after they leave.
//  * The open/closed motion is the OFF/ON transition authored on
//    config/furniture-authored/woodenDoor.json, driven by FurniturePuzzleRuntime.
(() => {
  'use strict';

  const FURNITURE_KEY = 'woodenDoor';
  const ROTATION_DEG = Object.freeze({ south: 0, west: 90, north: 180, east: 270 }); // Same facing convention as entry-tunnel-door-furniture.js.
  const SIDES = Object.freeze({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] });
  const CLOSE_DELAY_S = 0.45; // Keeps a door from flapping when an NPC steps off and straight back on.
  const PLAYER_NEAR_TILES = 1.25; // Centre distance inside which an open door never closes on the player.

  const maps = new Map(); // mapId -> { mapId, puzzleMapId, doors: [door] }
  let deps = null;
  let threeRef = null; // Captures the scene's Three.js constructors for lightweight light-blocker snapshots.

  function init(injected) { deps = injected || null; }

  function keyOf(c, r) { return `${c},${r}`; }

  // floorSet: Set of "c,r" painted tiles. Returns { facing, rotationDeg, paintedSides }.
  function orientation(floorSet, c, r) {
    const painted = Object.keys(SIDES).filter(side => floorSet.has(keyOf(c + SIDES[side][0], r + SIDES[side][1])));
    let facing = 'north';
    if (painted.length === 1) facing = painted[0];
    else if (painted.length > 1) {
      const open = side => !painted.includes(side);
      let pair = null; // Facing candidates perpendicular to the axis whose two ends are both unpainted.
      if (open('west') && open('east')) pair = ['north', 'south'];
      else if (open('north') && open('south')) pair = ['west', 'east'];
      facing = (pair && pair.find(side => painted.includes(side))) || painted[0];
    }
    return { facing, rotationDeg: ROTATION_DEG[facing], paintedSides: painted };
  }

  function doorTilesOf(mapData) {
    const out = [];
    const seen = new Set();
    for (const tile of (Array.isArray(mapData?.doorTiles) ? mapData.doorTiles : [])) {
      const c = Math.round(Number(tile?.[0])), r = Math.round(Number(tile?.[1]));
      if (!Number.isFinite(c) || !Number.isFinite(r) || seen.has(keyOf(c, r))) continue;
      seen.add(keyOf(c, r));
      out.push([c, r]);
    }
    return out;
  }

  // An exit's authored doorwayTiles sit OUTSIDE the painted floor. The exit's
  // ordinary tiles remain the actual walkable transition triggers. A matched
  // exterior tile moves only the visible frame onto the wall boundary.
  const OFFSET_INWARD = Object.freeze({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] });
  // Floorless exit coordinates remain authored exactly where placed. The adjoining
  // painted floor is only used to orient the wooden door on the wall boundary.
  function insideFloorForExit(floorSet, col, row, direction) {
    const requested = SIDES[direction];
    const candidates = Object.entries(SIDES)
      .filter(([, [dx, dr]]) => floorSet.has(keyOf(col + dx, row + dr)))
      .map(([side, [dx, dr]]) => ({ col: col + dx, row: row + dr, direction: side }));
    if (requested) return candidates.find(cell => cell.col === col + requested[0] && cell.row === row + requested[1]) || null;
    return candidates.length === 1 ? candidates[0] : null; // At an ambiguous corner, an authored inward direction is required.
  }
  function outsideTileForExit(exit, col, row) {
    const authored = Array.isArray(exit?.doorwayTiles) ? exit.doorwayTiles : [];
    const found = authored.filter(tile => {
      const dc = Number(col) - Number(tile?.[0]), dr = Number(row) - Number(tile?.[1]);
      if (Math.abs(dc) + Math.abs(dr) !== 1) return false;
      const inward = OFFSET_INWARD[exit?.direction];
      return !inward || (dc === inward[0] && dr === inward[1]);
    });
    return found.length === 1 ? [Number(found[0][0]), Number(found[0][1])] : null; // Ambiguous exterior markers never shift a physical frame.
  }

  function doorPosition(record) {
    const inside = Array.isArray(record?.tiles) && record.tiles.length ? record.tiles : [record]; // Also supports single-door candidates.
    const pairs = inside.filter(tile => Array.isArray(tile.outsideTile)).map(tile => tile.outsideTile);
    if (pairs.length !== inside.length) {
      const floorless = inside.filter(tile => tile.insideTile);
      if (floorless.length === inside.length) {
        const cx = inside.reduce((sum, tile) => sum + tile.col + 0.5, 0) / inside.length;
        const cz = inside.reduce((sum, tile) => sum + tile.row + 0.5, 0) / inside.length;
        const ix = floorless.reduce((sum, tile) => sum + tile.insideTile.col + 0.5, 0) / inside.length;
        const iz = floorless.reduce((sum, tile) => sum + tile.insideTile.row + 0.5, 0) / inside.length;
        return { x: (cx + ix) / 2, z: (cz + iz) / 2 }; // Floorless exit marker stays outside, while its frame follows the actual boundary.
      }
      return { x: Number(record.col) + 0.5, z: Number(record.row) + 0.5 }; // Legacy ordinary door or in-floor exit.
    }
    const cx = inside.reduce((sum, tile) => sum + Number(tile.col) + 0.5, 0) / inside.length;
    const cz = inside.reduce((sum, tile) => sum + Number(tile.row) + 0.5, 0) / inside.length;
    const ex = pairs.reduce((sum, tile) => sum + tile[0] + 0.5, 0) / pairs.length;
    const ez = pairs.reduce((sum, tile) => sum + tile[1] + 0.5, 0) / pairs.length;
    return { x: (cx + ex) * 0.5, z: (cz + ez) * 0.5 }; // Physical door sits exactly on the floor boundary, not at either tile center.
  }

  // Exit directions point inward on this map, shared by door alignment and arrivals.
  function doorRecordsOf(mapData, floorSet = new Set((mapData?.floor || []).map(([c, r]) => keyOf(c, r)))) {
    const records = new Map(); // Coordinate-keyed records prevent a painted door duplicating an exit door.
    for (const [col, row] of doorTilesOf(mapData)) records.set(keyOf(col, row), { col, row });
    for (const exit of mapData?.exits || []) {
      if (exit.generateDoor !== true) continue;
      for (const tile of exit.tiles || []) {
        const col = Number(tile?.[0]), row = Number(tile?.[1]); // Validated tile coordinates used by both previews and scene construction.
        if (!Number.isInteger(col) || !Number.isInteger(row)) continue;
        const floorless = !floorSet.has(keyOf(col, row));
        const insideTile = floorless ? insideFloorForExit(floorSet, col, row, exit.direction) : null;
        records.set(keyOf(col, row), { col, row, exitId: exit.id || 'exit', direction: exit.direction,
          insideTile, outsideTile: floorless ? null : outsideTileForExit(exit, col, row) });
      }
    }
    return [...records.values()];
  }

  function roomFloorOf(mapData, floorSet) {
    const roomFloor = new Set(floorSet); // Doorway siblings must not be mistaken for the room's inward floor.
    for (const record of doorRecordsOf(mapData, floorSet)) roomFloor.delete(keyOf(record.col, record.row));
    return roomFloor;
  }

  function exitSettings(mapData, transition, floorSet) {
    const authored = (mapData?.exits || []).find(exit => exit.id === transition.exitId)
      || (mapData?.exits || []).find(exit => (exit.tiles || []).some(([c, r]) => c === transition.col && r === transition.row)); // Old workspace transitions can lack both new fields and an exitId.
    const direction = typeof transition.direction === 'string' ? transition.direction : (authored?.direction || ''); // An explicit empty string selects automatic orientation rather than inheriting an old direction.
    const floor = floorSet || new Set((mapData?.floor || []).map(([c, r]) => keyOf(c, r))); // Scene builds pass their cached floor set; tests and standalone callers can derive it.
    return {
      direction: Object.hasOwn(SIDES, direction) ? direction : orientation(roomFloorOf(mapData, floor), transition.col, transition.row).facing,
      generateDoor: typeof transition.generateDoor === 'boolean' ? transition.generateDoor : authored?.generateDoor === true,
    };
  }

  function recordOrientation(floorSet, record) {
    return Object.hasOwn(SIDES, record.direction)
      ? { facing: record.direction, rotationDeg: ROTATION_DEG[record.direction] }
      : orientation(floorSet, record.col, record.row);
  }

  // Only a complete two-tile opening becomes a double door; longer runs stay separate.
  function doorGroupsOf(mapData, floorSet) {
    const roomFloor = roomFloorOf(mapData, floorSet); // Infer both leaves from actual room space instead of each other.
    const records = doorRecordsOf(mapData, floorSet)
      .filter(record => floorSet.has(keyOf(record.col, record.row)) || !!record.insideTile)
      .map(record => ({ ...record, direction: recordOrientation(roomFloor, record).facing })); // Resolve singles too, so runtime and previews share the corrected orientation.
    const pending = new Map(records.map(record => [keyOf(record.col, record.row), record])); // Unclaimed tiles in each transverse run.
    const groups = []; // One placement per single or paired doorway.
    for (const record of records) {
      if (!pending.has(keyOf(record.col, record.row))) continue;
      const facing = recordOrientation(floorSet, record); // Adjacent leaves must share orientation and travel destination.
      const dc = SIDES[facing.facing][1], dr = -SIDES[facing.facing][0]; // Local width axis, perpendicular to travel.
      const run = [record]; // Entire contiguous run, so three tiles cannot accidentally yield a pair.
      pending.delete(keyOf(record.col, record.row));
      for (const sign of [-1, 1]) {
        for (let step = 1; ; step++) {
          const next = pending.get(keyOf(record.col + dc * step * sign, record.row + dr * step * sign)); // Candidate on either side of the seed tile.
          if (!next || next.exitId !== record.exitId || recordOrientation(floorSet, next).facing !== facing.facing) break;
          pending.delete(keyOf(next.col, next.row));
          run.push(next);
        }
      }
      if (run.length === 2) groups.push({ ...record, col: (run[0].col + run[1].col) / 2, row: (run[0].row + run[1].row) / 2, direction: facing.facing, tiles: run });
      else for (const tile of run) groups.push({ ...tile, tiles: [tile] });
    }
    return groups;
  }

  // Derive a paired mechanism without changing the shared Wooden Door definition.
  function doubleDoorData(data) {
    if (!Array.isArray(data?.parts)) return data; // Incomplete or unavailable authored data keeps the existing fallback.
    const result = JSON.parse(JSON.stringify(data)); // Each pair owns its parts and their animation endpoints.
    const slab = result.parts.find(part => part.name === 'Wooden Door Slab'); // Existing panel dimensions determine the half-opening width.
    const rightPost = result.parts.find(part => part.name === 'Right Door Post'); // Outer post bounds locate the two leaf hinges.
    if (!slab || !rightPost || !result.puzzle?.motion?.parts) return result;
    const width = rightPost.transform.x + 0.5 - rightPost.transform.sx / 2; // One leaf extends from the centre seam to the outer frame.
    const scale = width / slab.transform.sx; // Widen leaves into the space previously occupied by the centre posts.
    const offset = width / 2 - slab.transform.x * scale; // Closed right leaf starts at the centre seam.
    const motion = {}; // Rebuilt part transitions consumed by FurniturePuzzleRuntime.
    const parts = []; // Two moving leaves/latches, two outer posts, one continuous header.
    for (const part of result.parts) {
      const poses = result.puzzle.motion.parts[part.id]; // Authored OFF/ON motion stays the authority for swinging.
      if (part.name === 'Wooden Door Slab' || part.name === 'Wooden Door Latch') {
        for (const sign of [-1, 1]) {
          const copy = JSON.parse(JSON.stringify(part)); // Independent mirrored leaf; no negative mesh scale or inverted normals.
          copy.id = `${part.id}_${sign < 0 ? 'left' : 'right'}`;
          copy.name = `${sign < 0 ? 'Left' : 'Right'} ${part.name}`;
          const transform = pose => ({ ...pose, x: sign * (pose.x * scale + offset), z: slab.transform.z + (pose.z - slab.transform.z) * scale, ry: sign * pose.ry, rz: sign * pose.rz, sx: pose.sx * scale }); // Reflection across local X mirrors the hinge motion.
          copy.transform = transform(part.transform);
          motion[copy.id] = { off: transform(poses.off), on: transform(poses.on) };
          parts.push(copy);
        }
      } else {
        if (part.name === 'Right Door Post') part.transform.x += 0.5;
        if (part.name === 'Left Door Post') part.transform.x -= 0.5;
        if (part.name === 'Doorway Header') part.transform.sy += 1;
        motion[part.id] = { off: { ...part.transform }, on: { ...part.transform } };
        parts.push(part);
      }
    }
    result.parts = parts;
    result.footprint.w = 2;
    result.puzzle.motion.parts = motion;
    return result;
  }

  async function loadDoorData() {
    const runtime = window.AuthoredFurniture;
    if (!runtime) return null;
    return runtime.peek?.(FURNITURE_KEY) || (runtime.load ? await runtime.load(FURNITURE_KEY).catch(() => null) : null);
  }

  function setOpen(entry, open) {
    if (entry.active === open) return;
    entry.active = open;
    window.FurniturePuzzleRuntime?.setMechanism?.(entry.puzzleMapId, entry.id, open);
  }

  function interactableFor(entry) {
    return {
      getButtons() {
        if (!entry.active) return [{ icon: '🚪', label: 'Open Door', action: 'obj_door_toggle', style: 'primary', allowed: true }];
        if (entry.handOpened) return [{ icon: '🚪', label: 'Close Door', action: 'obj_door_toggle', style: 'primary', allowed: true }];
        return [];
      },
      onAction(action) {
        if (action !== 'obj_door_toggle') return { ok: false, message: 'Unknown action.' };
        if (entry.active) {
          if (!entry.handOpened) return { ok: false, message: 'Someone is holding the door open.' };
          entry.handOpened = false;
          entry.idleFor = CLOSE_DELAY_S;
          setOpen(entry, false);
          return { ok: true, message: 'Closed the door.' };
        }
        entry.handOpened = true;
        entry.idleFor = 0;
        setOpen(entry, true);
        return { ok: true, message: 'Opened the door.' };
      },
    };
  }

  // Builds every door of a loaded interior. registerInteractable(col,row,obj)
  // lets game.js file the door's interaction; decorate(group) applies its
  // outline/edge marks.
  async function build({ THREE, scene, mapId, mapData, floorSet, surfaceYAt, registerInteractable, decorate }) {
    threeRef = THREE || threeRef;
    discard(mapId);
    const tiles = doorGroupsOf(mapData, floorSet); // Includes map-switch doors without changing their travel action.
    const state = { mapId, puzzleMapId: `interiorDoors:${mapId}`, doors: [] };
    maps.set(mapId, state);
    if (!tiles.length) return state;
    const data = await loadDoorData();
    // A farmhouse rebuild can supersede this scene while the authored door
    // loads. Never let an old async completion register stale door mechanisms.
    if (maps.get(mapId) !== state || !data || !window.AuthoredFurniture?.buildGroup) return state;
    const pairedData = doubleDoorData(data); // Reused immutable paired geometry for this scene build.
    const records = [];
    const objectById = new Map();
    for (const record of tiles) {
      const { col: c, row: r } = record; // Coordinates used to place and register this door.
      const group = window.AuthoredFurniture.buildGroup(record.tiles.length === 2 ? pairedData : data, 0x8b6540);
      if (!group) continue;
      const facing = recordOrientation(floorSet, record); // Explicit inward direction wins over inferred floor adjacency.
      const id = `door_${c}_${r}`;
      group.name = `interior_door_${c}_${r}`;
      const placement = doorPosition(record); // Outside-of-floor authoring moves the door to the real wall edge without changing its walkable trigger.
      group.position.set(placement.x, Number(surfaceYAt?.(record.tiles[0].col, record.tiles[0].row)) || 0, placement.z);
      group.rotation.y = -facing.rotationDeg * Math.PI / 180;
      group.userData = Object.assign(group.userData || {}, { interiorDoorTile: { col: c, row: r }, interiorDoorFacing: facing.facing, interiorDoorWidth: record.tiles.length });
      scene.add(group);
      decorate?.(group);
      const entry = { id, puzzleMapId: state.puzzleMapId, col: c, row: r, tiles: record.tiles, group, facing: facing.facing, active: false, handOpened: false, idleFor: 0, exitId: record.exitId || null }; // setOpen() addresses the mechanism through the entry's own puzzle map id.
      state.doors.push(entry);
      records.push({ id, itemKey: 'woodenDoorFurniture' });
      objectById.set(id, group);
      if (!entry.exitId) for (const tile of entry.tiles) registerInteractable?.(tile.col, tile.row, interactableFor(entry)); // Map-switch doors keep the existing Enter/Leave action.
    }
    window.FurniturePuzzleRuntime?.registerMap?.(state.puzzleMapId, records, objectById, []);
    return state;
  }

  function discard(mapId) {
    maps.delete(mapId);
  }

  function isBlocked(entry) {
    return entry.group.userData.blocksMovement !== false; // Closed (or never registered) doors block; the runtime clears this once the leaf has swung open.
  }

  // tileActors: [[x,z], ...] NPC positions in tile units; player: [x,z] | null.
  function tick(mapId, dt, tileActors, player) {
    const state = maps.get(mapId);
    if (!state) return;
    for (const entry of state.doors) {
      let npcNear = false;
      for (const actor of tileActors) {
        if (entry.tiles.some(tile => Math.abs(Math.floor(actor[0]) - tile.col) + Math.abs(Math.floor(actor[1]) - tile.row) <= 1)) { npcNear = true; break; }
      }
      const playerNear = !!player && entry.tiles.some(tile => Math.hypot(player[0] - (tile.col + 0.5), player[1] - (tile.row + 0.5)) < PLAYER_NEAR_TILES);
      if (npcNear || (entry.exitId && playerNear)) { entry.idleFor = 0; setOpen(entry, true); continue; }
      if (!entry.active) { entry.handOpened = false; continue; }
      if (playerNear) { entry.idleFor = 0; continue; } // Never close on the player.
      entry.idleFor += dt;
      if (entry.idleFor >= CLOSE_DELAY_S) { entry.handOpened = false; setOpen(entry, false); }
    }
  }

  function update(dt) {
    if (!deps || !maps.size) return;
    const area = deps.getCurrentArea?.();
    if (!maps.has(area)) return;
    tick(area, dt, deps.getNpcTiles?.(area) || [], deps.getPlayerTile?.() || null);
  }

  // x/z/half in tile units, same convention as AreaFootprintBlockers.
  function blocksBox(area, x, z, half = 0) {
    const state = maps.get(area);
    if (!state) return false;
    for (const entry of state.doors) {
      if (entry.exitId || !isBlocked(entry)) continue; // A map-switch doorway must remain reachable even while its mesh is closed.
      if (entry.tiles.some(tile => x + half > tile.col && x - half < tile.col + 1 && z + half > tile.row && z - half < tile.row + 1)) return true;
    }
    return false;
  }

  function debug() {
    return [...maps.values()].map(state => ({
      mapId: state.mapId,
      doors: state.doors.map(entry => ({ col: entry.col, row: entry.row, width: entry.tiles.length, tiles: entry.tiles.map(tile => [tile.col, tile.row]), facing: entry.facing, exitId: entry.exitId, open: entry.active, handOpened: entry.handOpened, blocked: !entry.exitId && isBlocked(entry), progress: Number(entry.group.userData.puzzleProgress) || 0 })),
    }));
  }

  function getLightBlockers(mapId) {
    const state = maps.get(String(mapId));
    if (!state) return [];
    return state.doors.map(entry => {
      const THREE = threeRef || deps?.THREE || window.THREE;
      const position = THREE?.Vector3 ? new THREE.Vector3() : (entry.group.position || { x: 0, z: 0 });
      if (THREE?.Vector3) entry.group.getWorldPosition?.(position);
      const angle = -(ROTATION_DEG[entry.facing] ?? ROTATION_DEG.north) * Math.PI / 180;
      const progress = Number(entry.group.userData?.puzzleProgress);
      return {
        x: position.x, z: position.z,
        normalX: Math.sin(angle), normalZ: Math.cos(angle),
        halfWidth: Math.max(0.5, entry.tiles.length * 0.5),
        openProgress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : (entry.active ? 1 : 0),
      };
    });
  }

  window.InteriorDoorTiles = Object.freeze({ init, orientation, doorTilesOf, doorRecordsOf, doorGroupsOf, doorPosition, insideFloorForExit, outsideTileForExit, getLightBlockers, doubleDoorData, exitSettings, recordOrientation, build, discard, tick, update, blocksBox, debug });
})();
