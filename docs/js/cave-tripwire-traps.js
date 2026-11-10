// Physical cave-cache tripwires: wall-to-wall strings arm ceiling-hung Shattercasks.
// HangingRopes owns the pendulum and Shattercasks owns its launched impact/damage.
// No second projectile, rope physics, explosion, or player-damage implementation.
(() => {
  'use strict';
  if (window.CaveTripwireTraps) return;

  const MAX_WALL_STEPS = 18; // Stops searches in broad rooms without producing unbounded wall probes.
  const WIRE_HEIGHT = 0.33; // Player-visible trip string, above the cavern floor.
  const TRIGGER_DISTANCE = 0.16; // Segment proximity also catches slow steps onto a visible wire.
  const FALLBACK_CEILING_HEIGHT = 2.75; // Roof-sampling fallback above the actual cave floor, never a world-space floor assumption.
  const PENDULUM_BOB_HEIGHT = 0.65; // Physical Shattercask centre stays above the sampled cave floor at rest.
  const REFERENCE_ROPE_LENGTH = 2.1; // Baseline for length-adjusted swing energy, preserving shared HangingRopes timing.
  const SWING_SPEED = 5.7; // Initial pendulum speed at reference length, used by the shared HangingRopes integrator.
  const records = new Map(); // Map id -> currently rendered cave trap wires and their hanging burdens.
  let wireGeometry = null; // Shared among all tripwire meshes, never disposed per cave.
  let wireMaterial = null; // Shared neutral rope color; avoids per-trap material allocation.
  let lastTickMapId = null; // A transition between two cave maps cannot be mistaken for movement across a wire.

  const key = (col, row) => col + ',' + row;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // The ends lie at the rock/floor boundary, not a guessed wall position.
  // floorKeys includes ALL walkable cave tiles, even if the cache's optional
  // extension is behind mineable rock.
  function spanFor(tile, floorKeys, breakableWalls = null) {
    if (!tile || !floorKeys?.has?.(key(tile.col, tile.row))) return null;
    let chosen = null;
    for (const axis of ['x', 'z']) {
      const dx = axis === 'x' ? 1 : 0, dz = axis === 'z' ? 1 : 0;
      let minus = 1, plus = 1;
      while (minus <= MAX_WALL_STEPS && floorKeys.has(key(tile.col - minus * dx, tile.row - minus * dz))) minus++;
      while (plus <= MAX_WALL_STEPS && floorKeys.has(key(tile.col + plus * dx, tile.row + plus * dz))) plus++;
      if (minus > MAX_WALL_STEPS || plus > MAX_WALL_STEPS || minus + plus < 2) continue;
      if (breakableWalls?.has?.(key(tile.col - minus * dx, tile.row - minus * dz))
        || breakableWalls?.has?.(key(tile.col + plus * dx, tile.row + plus * dz))) continue; // A mined-out barrier cannot hold a rope end.
      const halfMinus = minus - .5, halfPlus = plus - .5;
      const span = {
        axis,
        x1: tile.col + .5 - halfMinus * dx, z1: tile.row + .5 - halfMinus * dz,
        x2: tile.col + .5 + halfPlus * dx, z2: tile.row + .5 + halfPlus * dz,
        length: halfMinus + halfPlus,
      };
      if (!chosen || span.length < chosen.length) chosen = span;
    }
    return chosen;
  }

  // Check the entire movement segment, not only the player's sampled
  // position: fast movement must not tunnel through the string on a 120ms tick.
  function crossed(span, previous, current) {
    if (!span || !current) return false;
    const normal = span.axis === 'x' ? 'z' : 'x';
    const along = span.axis === 'x' ? 'x' : 'z';
    const plane = span.axis === 'x' ? span.z1 : span.x1;
    const min = Math.min(span[along + '1'], span[along + '2']) - TRIGGER_DISTANCE;
    const max = Math.max(span[along + '1'], span[along + '2']) + TRIGGER_DISTANCE;
    if (!previous) return Math.abs(current[normal] - plane) <= TRIGGER_DISTANCE
      && current[along] >= min && current[along] <= max;
    const before = previous[normal] - plane, after = current[normal] - plane;
    if (before * after > 0 && Math.min(Math.abs(before), Math.abs(after)) > TRIGGER_DISTANCE) return false;
    const ratio = clamp(Math.abs(before - after) > 1e-6 ? -before / (after - before) : 1, 0, 1);
    const atWire = previous[along] + (current[along] - previous[along]) * ratio;
    return atWire >= min && atWire <= max;
  }

  // Probe only the one/two occupied trap columns against the already carved
  // rock mesh. A downward ray must intersect the actual ceiling, not a
  // configured average height that can float under a vaulted cave roof.
  // Per-cave generation only: no per-frame raycasts and no extra physics.
  function ceilingAt(mesh, x, z, floorY) {
    const positions = mesh?.positions, indices = mesh?.indices;
    if (!positions?.length || !indices?.length) return null;
    let lowest = Infinity; // First overhead collision surface for the suspended anchor.
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
      const ax = positions[ia], az = positions[ia + 2];
      const bx = positions[ib], bz = positions[ib + 2];
      const cx = positions[ic], cz = positions[ic + 2];
      if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx)
        || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue;
      const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(denominator) < 1e-10) continue;
      const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
      const b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
      const c = 1 - a - b;
      if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue;
      const y = a * positions[ia + 1] + b * positions[ib + 1] + c * positions[ic + 1];
      if (y > floorY + 1.5 && y < lowest) lowest = y;
    }
    return Number.isFinite(lowest) ? lowest : null;
  }

  function trapHeights(mapData, trap) {
    const position = key(trap.col, trap.row); // Sampled cave-floor coordinates already provided by CavernGenerator.
    const sampled = Number(mapData?.floorSurfaceByTile?.[position]);
    const fallbackFloor = Number(mapData?.floorSurfaceY);
    const groundY = Number.isFinite(sampled) ? sampled : (Number.isFinite(fallbackFloor) ? fallbackFloor : 0);
    const meshCeiling = ceilingAt(mapData?.mesh, trap.col + .5, trap.row + .5, groundY);
    const vaultStart = Number(mapData?.mesh?.vaultCeiling?.startY);
    const fallbackHeight = Number.isFinite(vaultStart) && vaultStart > 1.5
      ? vaultStart : FALLBACK_CEILING_HEIGHT;
    const anchorY = meshCeiling ?? groundY + fallbackHeight;
    return { groundY, anchorY: Math.max(anchorY, groundY + 1.55) };
  }

  function makeWire(scene, trap, floorY) {
    const THREE = window.THREE;
    if (!THREE?.Mesh || !scene || !trap.span) return null;
    wireGeometry ||= new THREE.CylinderGeometry(.012, .012, 1, 5, 1);
    wireMaterial ||= new THREE.MeshLambertMaterial({ color: 0xb3a187 });
    const a = new THREE.Vector3(trap.span.x1, floorY + WIRE_HEIGHT, trap.span.z1);
    const b = new THREE.Vector3(trap.span.x2, floorY + WIRE_HEIGHT, trap.span.z2);
    const difference = b.clone().sub(a);
    const wire = new THREE.Mesh(wireGeometry, wireMaterial);
    wire.name = 'cave_tripwire_' + trap.id;
    wire.position.copy(a).add(b).multiplyScalar(.5);
    wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), difference.clone().normalize());
    wire.scale.set(1, difference.length(), 1);
    wire.userData.caveTripwireId = trap.id; // Identifies the visible trigger in mobile scene diagnostics.
    scene.add(wire);
    return wire;
  }

  function dispose(mapId) {
    const record = records.get(String(mapId));
    if (!record) return;
    records.delete(String(mapId));
    for (const entry of record.entries) {
      entry.wire?.parent?.remove(entry.wire);
      if (entry.rope) window.HangingRopes?.removeRope?.(entry.rope);
      if (entry.burden && !entry.burden.exploded) window.Shattercasks?.discardBurden?.(entry.burden);
    }
  }

  function build(mapId, mapData, scene, state) {
    const id = String(mapId);
    dispose(id); // Rebuilding an interior retires the previous scene's physics and visual registrations.
    if (!scene || !mapData?.caveTraps?.length) return 0;
    const consumed = new Set(state?.triggeredTraps || []); // Already triggered traps must never reappear after reload.
    const entries = mapData.caveTraps.filter(trap => trap?.span && !consumed.has(trap.id))
      .map(trap => {
        const heights = trapHeights(mapData, trap); // Sample once per scene build, never in combat ticks.
        return { trap, ...heights, wire: makeWire(scene, trap, heights.groundY),
          rope: null, burden: null, pending: false, retrySeconds: 0, queuedDirection: 0 };
      });
    records.set(id, { mapId: id, scene, entries, previous: null });
    return entries.length;
  }

  function spawn(entry, record) {
    const Shattercasks = window.Shattercasks, ropes = window.HangingRopes;
    if (entry.pending || !Shattercasks?.createHangingShattercask || !ropes?.registerRope || !ropes?.attach) return;
    entry.pending = true;
    const { trap } = entry;
    const x = trap.col + .5, z = trap.row + .5;
    const length = entry.anchorY - (entry.groundY + PENDULUM_BOB_HEIGHT); // Roof-to-cask length, both in real scene coordinates.
    const promise = Shattercasks.createHangingShattercask({
      id: trap.id + '_pendulum', mapId: record.mapId, scene: record.scene,
      x, y: entry.groundY + PENDULUM_BOB_HEIGHT, z,
      mechanismId: trap.id, displayName: 'Swinging Shattercask',
    });
    Promise.resolve(promise).then(burden => {
      if (!burden) return;
      if (records.get(record.mapId) !== record || !entry.wire?.parent) {
        Shattercasks.discardBurden?.(burden);
        return;
      }
      const rope = ropes.registerRope({
        id: trap.id + '_rope', mapId: record.mapId, scene: record.scene,
        x, y: entry.anchorY, z, length,
        yaw: trap.span.axis === 'x' ? Math.PI / 2 : 0,
      });
      if (!ropes.attach(rope, burden)) {
        ropes.removeRope(rope);
        Shattercasks.discardBurden?.(burden);
        return;
      }
      entry.burden = burden;
      entry.rope = rope;
    }).catch(error => window.__farmLog?.('[cave-traps] hanging burden: ' + error.message, 'warn'))
      .finally(() => { entry.pending = false; entry.retrySeconds = 3; });
  }

  function suspend() {
    lastTickMapId = null; // Returning to the same cave is a new entry, never a movement segment from the prior visit.
    for (const record of records.values()) record.previous = null;
  }

  function tick(mapId, state, player, tileSize, dt, onTriggered) {
    const id = String(mapId);
    const record = records.get(id);
    if (!record || !state || !player || !(tileSize > 0)) return;
    if (lastTickMapId !== id) record.previous = null; // No cross-cave phantom trips.
    lastTickMapId = id;
    const point = { x: player.x / tileSize, z: player.y / tileSize };
    const previous = record.previous;
    record.previous = point; // Retains crossing segment only for the currently visited cavern.
    const consumed = new Set(state.triggeredTraps || []);
    const aboveWire = Number(player.heightAboveGround) > WIRE_HEIGHT + .15; // A genuine jump clears the string instead of activating a 2D proximity hit.
    for (const entry of record.entries) {
      if (consumed.has(entry.trap.id)) continue;
      const normal = entry.trap.span.axis === 'x' ? 'z' : 'x';
      const crossing = !aboveWire && crossed(entry.trap.span, previous, point);
      const direction = previous && point[normal] < previous[normal] ? -1 : 1;
      if (entry.burden && (entry.burden.exploded || entry.burden.carried
        || entry.rope?.burden !== entry.burden || entry.rope?.armed)) {
        consumed.add(entry.trap.id); // Shooting, picking up, or striking the real cask disarms the trip string.
      } else if (entry.rope?.burden === entry.burden && entry.burden) {
        if (!crossing && !entry.queuedDirection) continue;
        const dir = entry.queuedDirection || direction;
        const speed = SWING_SPEED * Math.sqrt(Math.max(.1, entry.rope.length) / REFERENCE_ROPE_LENGTH);
        window.HangingRopes?.applyStrike?.(entry.rope,
          normal === 'x' ? dir : 0, normal === 'z' ? dir : 0, speed);
        entry.queuedDirection = 0;
        consumed.add(entry.trap.id); // The actual blast follows the physical pendulum flight, not a damagePlayer call.
        window.__farmLog?.('[cave-traps] tripped visible rope ' + entry.trap.id, 'world');
      } else {
        if (crossing) entry.queuedDirection = direction; // Preserve crossings while authored Shattercask furniture loads asynchronously.
        entry.retrySeconds -= Math.max(0, Number(dt) || 0);
        if (entry.retrySeconds <= 0) spawn(entry, record);
        continue;
      }
      entry.wire?.parent?.remove(entry.wire);
      state.triggeredTraps = [...consumed];
      onTriggered?.(); // CaveSiteSystem persists the same existing trap state as before.
    }
  }

  function debugSnapshot(mapId) {
    const record = records.get(String(mapId));
    return record ? { mapId: record.mapId, wires: record.entries.map(entry => ({
      id: entry.trap.id, drawn: !!entry.wire?.parent, pending: entry.pending,
      queued: !!entry.queuedDirection, cask: !!entry.burden && !entry.burden.exploded,
      swinging: !!entry.rope?.armed, anchorY: entry.anchorY, floorY: entry.groundY,
      span: entry.trap.span,
    })) } : { mapId: String(mapId), wires: [] };
  }

  window.CaveTripwireTraps = Object.freeze({
    spanFor, crossed, ceilingAt, trapHeights, build, tick, suspend, dispose, debugSnapshot,
  });
})();
