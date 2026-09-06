// Adds the authored door furniture to every HousePieceGen entry-tunnel tile.
// Kept separate from HousePieceGen so the architectural generator stays data-
// agnostic while the furniture asset can continue to come from the normal
// docs/config/furniture-authored/<key>.json runtime path.
(() => {
  'use strict';

  const FURNITURE_KEY = 'door'; // Used to load the uploaded door through AuthoredFurniture.
  const DOOR_OBJECT_NAME = 'entry_tunnel_door'; // Used by debugInfo() and duplicate-attachment checks.
  const SIDE_ROTATION_DEG = Object.freeze({ south: 0, west: 90, north: 180, east: 270 }); // Mirrors HousePieceGen's entry-tunnel orientation map.
  const PLACEMENT = Object.freeze({ x: 0.5, y: 0, z: 0.5 }); // Used to center the authored 1x1 door inside the entry-tunnel tile.

  function ensureUserData(object) {
    if (!object) return null;
    object.userData = object.userData || {};
    return object.userData;
  }

  function status(tunnel, value, details = null) {
    const data = ensureUserData(tunnel); // Used to expose attachment state to the in-game debug inspector.
    if (!data) return;
    data.entryTunnelDoorKey = FURNITURE_KEY;
    data.entryTunnelDoorStatus = value;
    if (details) Object.assign(data, details);
  }

  function sideRotationDeg(side) {
    return SIDE_ROTATION_DEG[String(side || 'south').toLowerCase()] ?? 0;
  }

  function findDoor(tunnel) {
    if (!tunnel) return null;
    if (typeof tunnel.getObjectByName === 'function') return tunnel.getObjectByName(DOOR_OBJECT_NAME) || null;
    return (tunnel.children || []).find(child => child?.name === DOOR_OBJECT_NAME) || null;
  }

  function attachResolved(tunnel, authoredData, col, row, side, opts = {}) {
    const existing = findDoor(tunnel); // Used to make async/cached attachment idempotent.
    if (existing) return existing;

    const runtime = window.AuthoredFurniture; // Used to build the authored door mesh group.
    if (!tunnel || !runtime?.buildGroup || !authoredData?.parts?.length) {
      status(tunnel, authoredData ? 'runtime-unavailable' : 'missing-data');
      return null;
    }

    const door = runtime.buildGroup(authoredData, 0x8b6540); // Used as the visible authored door inside this tunnel tile.
    if (!door) {
      status(tunnel, 'build-failed');
      return null;
    }

    const rotationDeg = sideRotationDeg(side); // Used to rotate the canonical south-facing door with its tunnel.
    const elevationY = Number.isFinite(Number(opts?.elevationY)) ? Number(opts.elevationY) : 0; // Used to match elevated entry-tunnel builds.
    door.name = DOOR_OBJECT_NAME;
    door.position.set(Number(col) + PLACEMENT.x, elevationY + PLACEMENT.y, Number(row) + PLACEMENT.z);
    door.rotation.y = -rotationDeg * Math.PI / 180;
    Object.assign(ensureUserData(door), {
      entryTunnelDoorFurniture: true,
      furnitureKey: FURNITURE_KEY,
      entryTunnelSide: String(side || 'south').toLowerCase(),
      entryTunnelTile: { col: Number(col), row: Number(row) },
    });
    tunnel.add(door);
    status(tunnel, 'attached', {
      entryTunnelDoorAttached: true,
      entryTunnelDoorSide: String(side || 'south').toLowerCase(),
      entryTunnelDoorTile: { col: Number(col), row: Number(row) },
      entryTunnelDoorRotationDeg: rotationDeg,
    });
    return door;
  }

  function attach(tunnel, col, row, side, opts = {}) {
    const existing = findDoor(tunnel); // Used to avoid duplicate doors when a cached load resolves after a rebuild.
    if (existing) return existing;

    const runtime = window.AuthoredFurniture; // Used for cached or asynchronous authored-furniture loading.
    if (!runtime) {
      status(tunnel, 'waiting-runtime');
      if (typeof document !== 'undefined' && document.readyState === 'loading') {
        const data = ensureUserData(tunnel); // Used to ensure only one deferred retry is registered per tunnel.
        if (!data.entryTunnelDoorDeferred) {
          data.entryTunnelDoorDeferred = true;
          document.addEventListener('DOMContentLoaded', () => {
            data.entryTunnelDoorDeferred = false;
            attach(tunnel, col, row, side, opts);
          }, { once: true });
        }
      } else {
        status(tunnel, 'runtime-unavailable');
      }
      return null;
    }

    const cached = runtime.peek?.(FURNITURE_KEY); // Used for zero-delay attachment when the door JSON is already cached.
    if (cached) return attachResolved(tunnel, cached, col, row, side, opts);
    if (typeof runtime.load !== 'function') {
      status(tunnel, 'loader-unavailable');
      return null;
    }

    status(tunnel, 'loading');
    return runtime.load(FURNITURE_KEY)
      .then(authoredData => attachResolved(tunnel, authoredData, col, row, side, opts))
      .catch(error => {
        status(tunnel, 'error', { entryTunnelDoorError: String(error?.message || error || 'unknown error') });
        console.warn('[EntryTunnelDoorFurniture] failed to load door furniture:', error);
        return null;
      });
  }

  function install() {
    const generator = window.HousePieceGen; // Used to wrap the single shared entry-tunnel creation path.
    const original = generator?.buildEntryTunnelGroup; // Used by the wrapper to preserve existing tunnel generation exactly.
    if (typeof original !== 'function') return false;
    if (original.__entryTunnelDoorFurnitureWrapped) return true;

    function buildEntryTunnelGroupWithDoor(THREE, col, row, side, opts) {
      const tunnel = original.apply(this, arguments); // Used as the untouched generated tunnel receiving the authored door.
      status(tunnel, 'pending', {
        entryTunnelDoorSide: String(side || 'south').toLowerCase(),
        entryTunnelDoorTile: { col: Number(col), row: Number(row) },
      });
      attach(tunnel, col, row, side, opts || {});
      return tunnel;
    }

    buildEntryTunnelGroupWithDoor.__entryTunnelDoorFurnitureWrapped = true;
    buildEntryTunnelGroupWithDoor.__entryTunnelDoorFurnitureOriginal = original;
    generator.buildEntryTunnelGroup = buildEntryTunnelGroupWithDoor;
    return true;
  }

  function debugInfo(tunnel) {
    const door = findDoor(tunnel); // Used to report the currently attached visual, if one exists.
    const data = tunnel?.userData || {}; // Used to expose loader/placement state without requiring a console.
    return {
      key: FURNITURE_KEY,
      status: data.entryTunnelDoorStatus || 'unknown',
      attached: !!door,
      side: data.entryTunnelDoorSide || door?.userData?.entryTunnelSide || null,
      tile: data.entryTunnelDoorTile || door?.userData?.entryTunnelTile || null,
      position: door ? { x: door.position.x, y: door.position.y, z: door.position.z } : null,
      rotationYDeg: door ? door.rotation.y * 180 / Math.PI : null,
    };
  }

  window.EntryTunnelDoorFurniture = Object.freeze({
    FURNITURE_KEY,
    DOOR_OBJECT_NAME,
    PLACEMENT,
    SIDE_ROTATION_DEG,
    attach,
    debugInfo,
    install,
  });

  install();
})();
