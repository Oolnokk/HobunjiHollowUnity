// Physical cave-cache tripwires: wall-to-wall strings arm ceiling-hung Shattercasks.
// HangingRopes owns the pendulum and Shattercasks owns its launched impact/damage.
// No second projectile, rope physics, explosion, or player-damage implementation.
(() => {
  'use strict';
  if (window.CaveTripwireTraps) return;

  const MAX_WALL_STEPS = 18; // Stops searches in broad rooms without producing unbounded wall probes.
  const WIRE_HEIGHT = 0.33; // Player-visible trip string, above the cavern floor.
  const TRIGGER_DISTANCE = 0.16; // Segment proximity also catches slow steps onto a visible wire.
  const PENDULUM_HEIGHT = 2.75; // Ceiling attachment height, in scene units.
  const PENDULUM_LENGTH = 2.1; // Puts the real Shattercask at roughly waist height before swinging.
  const SWING_SPEED = 5.7; // Initial pendulum speed, used by the shared HangingRopes integrator.
  const records = new Map(); // Map id -> currently rendered cave trap wires and their hanging burdens.
  let wireGeometry = null; // Shared among all tripwire meshes, never disposed per cave.
  let wireMaterial = null; // Shared neutral rope color; avoids per-trap material allocation.

  const key = (col, row) => col + ',' + row;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // The ends lie at the rock/floor boundary, not a guessed wall position.
  // floorKeys includes ALL walkable cave tiles, even if the cache's optional
  // extension is behind mineable rock.
  function spanFor(tile, floorKeys) {
    if (!tile || !floorKeys?.has?.(key(tile.col, tile.row))) return null;
    let chosen = null;
    for (const axis of ['x', 'z']) {
      const dx = axis === 'x' ? 1 : 0, dz = axis === 'z' ? 1 : 0;
      let minus = 1, plus = 1;
      while (minus <= MAX_WALL_STEPS && floorKeys.has(key(tile.col - minus * dx, tile.row - minus * dz))) minus++;
      while (plus <= MAX_WALL_STEPS && floorKeys.has(key(tile.col + plus * dx, tile.row + plus * dz))) plus++;
      if (minus > MAX_WALL_STEPS || plus > MAX_WALL_STEPS || minus + plus < 4) continue;
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

  function makeWire(scene, trap) {
    const THREE = window.THREE;
    if (!THREE?.Mesh || !scene || !trap.span) return null;
    wireGeometry ||= new THREE.CylinderGeometry(.012, .012, 1, 5, 1);
    wireMaterial ||= new THREE.MeshLambertMaterial({ color: 0xb3a187 });
    const a = new THREE.Vector3(trap.span.x1, WIRE_HEIGHT, trap.span.z1);
    const b = new THREE.Vector3(trap.span.x2, WIRE_HEIGHT, trap.span.z2);
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
      .map(trap => ({
        trap, wire: makeWire(scene, trap), rope: null, burden: null, pending: false, retrySeconds: 0,
      }));
    records.set(id, { mapId: id, scene, entries, previous: null });
    return entries.length;
  }

  function spawn(entry, record) {
    const Shattercasks = window.Shattercasks, ropes = window.HangingRopes;
    if (entry.pending || !Shattercasks?.createHangingShattercask || !ropes?.registerRope || !ropes?.attach) return;
    entry.pending = true;
    const { trap } = entry;
    const x = trap.col + .5, z = trap.row + .5;
    const promise = Shattercasks.createHangingShattercask({
      id: trap.id + '_pendulum', mapId: record.mapId, scene: record.scene,
      x, y: PENDULUM_HEIGHT - PENDULUM_LENGTH, z,
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
        x, y: PENDULUM_HEIGHT, z, length: PENDULUM_LENGTH,
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

  function tick(mapId, state, player, tileSize, dt, onTriggered) {
    const record = records.get(String(mapId));
    if (!record || !state || !player || !(tileSize > 0)) return;
    const point = { x: player.x / tileSize, z: player.y / tileSize };
    const previous = record.previous;
    record.previous = point; // Retains crossing segment only for the currently visited cavern.
    const consumed = new Set(state.triggeredTraps || []);
    for (const entry of record.entries) {
      if (consumed.has(entry.trap.id)) continue;
      if (entry.burden?.exploded) {
        consumed.add(entry.trap.id); // Shooting the real cask before crossing harmlessly disarms its tripwire.
      } else if (entry.rope && entry.burden) {
        if (!crossed(entry.trap.span, previous, point)) continue;
        const normal = entry.trap.span.axis === 'x' ? 'z' : 'x';
        const dir = previous && point[normal] < previous[normal] ? -1 : 1;
        window.HangingRopes?.applyStrike?.(entry.rope,
          normal === 'x' ? dir : 0, normal === 'z' ? dir : 0, SWING_SPEED);
        consumed.add(entry.trap.id); // The actual blast follows the physical pendulum flight, not a damagePlayer call.
        window.__farmLog?.('[cave-traps] tripped visible rope ' + entry.trap.id, 'world');
      } else {
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
      cask: !!entry.burden && !entry.burden.exploded, swinging: !!entry.rope?.armed,
      span: entry.trap.span,
    })) } : { mapId: String(mapId), wires: [] };
  }

  window.CaveTripwireTraps = Object.freeze({
    spanFor, crossed, build, tick, dispose, debugSnapshot,
  });
})();
