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

  // Exit directions point inward on this map, shared by door alignment and arrivals.
  function doorRecordsOf(mapData) {
    const records = new Map(); // Coordinate-keyed records prevent a painted door duplicating an exit door.
    for (const [col, row] of doorTilesOf(mapData)) records.set(keyOf(col, row), { col, row });
    for (const exit of mapData?.exits || []) {
      if (exit.generateDoor !== true) continue;
      for (const tile of exit.tiles || []) {
        const col = Number(tile?.[0]), row = Number(tile?.[1]); // Validated tile coordinates used by both previews and scene construction.
        if (!Number.isInteger(col) || !Number.isInteger(row)) continue;
        records.set(keyOf(col, row), { col, row, exitId: exit.id || 'exit', direction: exit.direction });
      }
    }
    return [...records.values()];
  }

  function exitSettings(mapData, transition, floorSet) {
    const authored = (mapData?.exits || []).find(exit => exit.id === transition.exitId)
      || (mapData?.exits || []).find(exit => (exit.tiles || []).some(([c, r]) => c === transition.col && r === transition.row)); // Old workspace transitions can lack both new fields and an exitId.
    const direction = typeof transition.direction === 'string' ? transition.direction : (authored?.direction || ''); // An explicit empty string selects automatic orientation rather than inheriting an old direction.
    const floor = floorSet || new Set((mapData?.floor || []).map(([c, r]) => keyOf(c, r))); // Scene builds pass their cached floor set; tests and standalone callers can derive it.
    return {
      direction: Object.hasOwn(SIDES, direction) ? direction : orientation(floor, transition.col, transition.row).facing,
      generateDoor: typeof transition.generateDoor === 'boolean' ? transition.generateDoor : authored?.generateDoor === true,
    };
  }

  function recordOrientation(floorSet, record) {
    return Object.hasOwn(SIDES, record.direction)
      ? { facing: record.direction, rotationDeg: ROTATION_DEG[record.direction] }
      : orientation(floorSet, record.col, record.row);
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
    discard(mapId);
    const tiles = doorRecordsOf(mapData).filter(record => floorSet.has(keyOf(record.col, record.row))); // Includes map-switch doors without changing their travel action.
    const state = { mapId, puzzleMapId: `interiorDoors:${mapId}`, doors: [] };
    maps.set(mapId, state);
    if (!tiles.length) return state;
    const data = await loadDoorData();
    if (!data || !window.AuthoredFurniture?.buildGroup) return state;
    const records = [];
    const objectById = new Map();
    for (const record of tiles) {
      const { col: c, row: r } = record; // Coordinates used to place and register this door.
      const group = window.AuthoredFurniture.buildGroup(data, 0x8b6540);
      if (!group) continue;
      const facing = recordOrientation(floorSet, record); // Explicit inward direction wins over inferred floor adjacency.
      const id = `door_${c}_${r}`;
      group.name = `interior_door_${c}_${r}`;
      group.position.set(c + 0.5, Number(surfaceYAt?.(c, r)) || 0, r + 0.5);
      group.rotation.y = -facing.rotationDeg * Math.PI / 180;
      group.userData = Object.assign(group.userData || {}, { interiorDoorTile: { col: c, row: r }, interiorDoorFacing: facing.facing });
      scene.add(group);
      decorate?.(group);
      const entry = { id, puzzleMapId: state.puzzleMapId, col: c, row: r, group, facing: facing.facing, active: false, handOpened: false, idleFor: 0, exitId: record.exitId || null }; // setOpen() addresses the mechanism through the entry's own puzzle map id.
      state.doors.push(entry);
      records.push({ id, itemKey: 'woodenDoorFurniture' });
      objectById.set(id, group);
      if (!entry.exitId) registerInteractable?.(c, r, interactableFor(entry)); // Map-switch doors keep the existing Enter/Leave action.
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
        const dc = Math.abs(Math.floor(actor[0]) - entry.col), dr = Math.abs(Math.floor(actor[1]) - entry.row);
        if (dc + dr <= 1) { npcNear = true; break; }
      }
      const playerNear = !!player && Math.hypot(player[0] - (entry.col + 0.5), player[1] - (entry.row + 0.5)) < PLAYER_NEAR_TILES;
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
      if (x + half > entry.col && x - half < entry.col + 1 && z + half > entry.row && z - half < entry.row + 1) return true;
    }
    return false;
  }

  function debug() {
    return [...maps.values()].map(state => ({
      mapId: state.mapId,
      doors: state.doors.map(entry => ({ col: entry.col, row: entry.row, facing: entry.facing, exitId: entry.exitId, open: entry.active, handOpened: entry.handOpened, blocked: !entry.exitId && isBlocked(entry), progress: Number(entry.group.userData.puzzleProgress) || 0 })),
    }));
  }

  window.InteriorDoorTiles = Object.freeze({ init, orientation, doorTilesOf, doorRecordsOf, exitSettings, recordOrientation, build, discard, tick, update, blocksBox, debug });
})();
