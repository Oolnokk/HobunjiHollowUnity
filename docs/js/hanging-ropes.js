// HangingRopes — a rope any carriable burden can hang from.
//
// A rope has an anchor, a length and a free hook. While a burden hangs from it the rope is a
// pendulum (js/rope-pendulum.js). The burden becomes a lunge-stop target (Targetables 'lungeStop'),
// so a player lunging at it stops the moment it is inside the attack cone: attack from close and
// little lunge is spent, attack from far and all of it is. A melee strike then sets the rope
// swinging with a speed that grows with the lunge distance actually spent (RopePendulum.strikeSpeed).
//
// Release rules, evaluated while it swings after a strike:
//   drop   — at the forward apex (just before the swing back) the burden is let go, falling roughly
//            where it stopped: a small hit moves it a few feet.
//   launch — if the rope swings past detachAngleRad while still moving outward, the burden detaches
//            at that steep angle with its velocity and flies across the room.
// Released burdens enter Shattercasks' shared fall/impact flight (releaseBurdenWithVelocity), so a
// bomb keeps its fuse and explodes where it lands; nothing here knows about bombs.
//
// Events (WorldEvents): 'rope:attach', 'rope:swing', 'rope:release' (mode 'drop'|'launch'),
// 'rope:detach' — all scoped to the rope's map, so mechanisms and encounters can react to them.
//
// Wiring: Shattercasks.tick calls tick(dt); Shattercasks.interact calls tryHang(held) before it
// drops a carried burden; Shattercasks.sweepMelee calls a hanging burden's strikeHandler instead of
// detonating it. See docs/architecture/ruin-capabilities.md.
(() => {
  'use strict';
  if (window.HangingRopes?.installed || !window.RopePendulum) return;
  const RP = window.RopePendulum;

  const CONFIG = {
    ...RP.STRIKE_DEFAULTS,   // referenceLungeWorld, minSpeed, maxSpeed
    gravity: RP.DEFAULTS.gravity, damping: RP.DEFAULTS.damping,
    detachAngleRad: 0.85,    // ~49 degrees: past this while moving outward, the burden is flung rather than dropped
    hangReach: 1.8,          // how close the player must be to hang a carried burden on a free hook
    lungeFreshMs: 1500,      // a lunge origin older than this is not "this attack"
    ropeRadius: 0.035, ropeColor: 0x8a6a42,
  };
  const ropes = new Map(); // id -> rope
  let serial = 0, ropeGeometry = null, ropeMaterial = null;
  let scratchDir = null, scratchUp = null;

  const area = () => String(window.GridTileAccessors?.getCurrentArea?.() || window.Combat?.deps?.getCurrentArea?.() || '');
  const currentScene = () => window.GridTileAccessors?.getActiveScene?.() || window.Combat?.deps?.getActiveScene?.() || null;
  const tile = () => Number(window.Combat?.deps?.TILE) || 64;
  const emit = (type, payload) => window.WorldEvents?.emit?.(type, payload);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // ---------------------------------------------------------------- visuals
  function buildVisual(rope) {
    const THREE = window.THREE;
    if (!THREE?.Mesh || !rope.scene) return null;
    ropeGeometry ||= new THREE.CylinderGeometry(CONFIG.ropeRadius, CONFIG.ropeRadius, 1, 6, 1);
    ropeMaterial ||= new THREE.MeshBasicMaterial({ color: CONFIG.ropeColor });
    scratchDir ||= new THREE.Vector3(); scratchUp ||= new THREE.Vector3(0, 1, 0);
    const mesh = new THREE.Mesh(ropeGeometry, ropeMaterial);
    mesh.name = 'hanging_rope_' + rope.id;
    mesh.userData.hangingRopeId = rope.id;
    rope.scene.add(mesh);
    return mesh;
  }
  function updateVisual(rope) {
    const mesh = rope.mesh, s = rope.state;
    if (!mesh || !scratchDir) return;
    scratchDir.set(s.px - s.ax, s.py - s.ay, s.pz - s.az);
    const length = Math.max(0.001, scratchDir.length());
    scratchDir.multiplyScalar(1 / length);
    mesh.position.set((s.ax + s.px) * 0.5, (s.ay + s.py) * 0.5, (s.az + s.pz) * 0.5);
    mesh.quaternion.setFromUnitVectors(scratchUp, scratchDir);
    mesh.scale.set(1, length, 1);
  }

  // ---------------------------------------------------------------- registry
  // options: { id?, mapId?, scene?, x, y, z (anchor, world units), length, gravity?, damping?, detachAngleRad? }
  function registerRope(options = {}) {
    const id = String(options.id || ('rope_' + (++serial)));
    if (ropes.has(id)) removeRope(id);
    const rope = {
      id, mapId: String(options.mapId || area()), scene: options.scene || currentScene(),
      state: RP.create({ anchor: { x: options.x, y: options.y, z: options.z }, length: options.length, gravity: options.gravity ?? CONFIG.gravity, damping: options.damping ?? CONFIG.damping }),
      detachAngleRad: num(options.detachAngleRad, CONFIG.detachAngleRad),
      burden: null, armed: false, outX: 1, outZ: 0, prevOut: 0, restore: null, disposed: false, mesh: null,
    };
    rope.mesh = buildVisual(rope);
    updateVisual(rope);
    ropes.set(id, rope);
    return rope;
  }
  function removeRope(id) {
    const rope = typeof id === 'string' ? ropes.get(id) : id;
    if (!rope) return false;
    detachInternal(rope, 'removed');
    rope.disposed = true;
    rope.mesh?.parent?.remove(rope.mesh);
    ropes.delete(rope.id);
    return true;
  }
  const clearScope = mapId => { let n = 0; for (const rope of [...ropes.values()]) if (rope.mapId === String(mapId) && removeRope(rope)) n++; return n; };

  // ---------------------------------------------------------------- attach / detach
  function canAttach(rope, burden, { fromHand = false } = {}) {
    return !!rope && !rope.disposed && !rope.burden && !!burden && !burden.exploded && !burden.flying && !burden.rope
      && (fromHand || !burden.carried) && String(burden.mapId) === rope.mapId && !!rope.scene && !!burden.group;
  }
  function attach(rope, burden, options = {}) {
    if (!canAttach(rope, burden, options)) return false;
    const s = RP.reset(rope.state);
    rope.scene.add(burden.group); // Reparent into world space: the swing moves it in world coordinates.
    burden.group.quaternion?.identity?.();
    burden.group.scale?.setScalar?.(1);
    burden.group.position.set(s.px, s.py, s.pz);
    burden.carried = false; burden.flying = false; burden.hanging = false;
    burden.rope = rope; burden.lungeStop = true; burden.strikeHandler = onStruck;
    const restore = { onPickup: burden.onPickup, onLost: burden.onLost };
    const onPickup = record => { try { restore.onPickup?.(record); } finally { detachInternal(rope, 'pickup'); } };
    const onLost = (record, cause) => { try { restore.onLost?.(record, cause); } finally { detachInternal(rope, 'lost'); } };
    burden.onPickup = onPickup; burden.onLost = onLost;
    rope.restore = { onPickup: restore.onPickup, onLost: restore.onLost, wrappers: { onPickup, onLost } };
    rope.burden = burden; rope.armed = false;
    burden.col = Math.floor(s.px); burden.row = Math.floor(s.pz);
    window.Shattercasks?.refreshBurdenBounds?.(burden);
    updateVisual(rope);
    emit('rope:attach', { scope: rope.mapId, ropeId: rope.id, burdenId: burden.id });
    return true;
  }
  // Clears every link between the rope and its burden without releasing the burden anywhere.
  function detachInternal(rope, reason) {
    const burden = rope.burden;
    if (!burden) return false;
    burden.rope = null; burden.lungeStop = false;
    if (burden.strikeHandler === onStruck) burden.strikeHandler = null;
    const w = rope.restore?.wrappers;
    if (w && burden.onPickup === w.onPickup) burden.onPickup = rope.restore.onPickup; // Only unwrap what is still ours.
    if (w && burden.onLost === w.onLost) burden.onLost = rope.restore.onLost;
    rope.burden = null; rope.restore = null; rope.armed = false;
    RP.reset(rope.state);
    updateVisual(rope);
    emit('rope:detach', { scope: rope.mapId, ropeId: rope.id, burdenId: burden.id, reason });
    return true;
  }
  const detach = (rope, reason = 'detached') => detachInternal(rope, reason);

  // The player is carrying a burden and pressed the carry-release action: hang it on a free hook in reach.
  function tryHang(held) {
    const player = window.Combat?.deps?.player;
    if (!player || !held) return false;
    const t = tile(), px = player.x / t, pz = player.y / t, mapId = area();
    let best = null, bestDist = CONFIG.hangReach;
    for (const rope of ropes.values()) {
      if (rope.mapId !== mapId || !canAttach(rope, held, { fromHand: true })) continue;
      const d = Math.hypot(px - rope.state.px, pz - rope.state.pz); // to the hook's rest position
      if (d <= bestDist) { best = rope; bestDist = d; }
    }
    if (!best) return false;
    const burden = window.Shattercasks?.detachHeldBurden?.();
    if (!burden) return false;
    if (!attach(best, burden, { fromHand: true })) return false;
    window.Combat?.deps?.showToast?.('Hung ' + (burden.displayName || 'the burden') + ' on the rope. Strike it to swing it.', false);
    return true;
  }

  // ---------------------------------------------------------------- strike
  // burden.strikeHandler, called by Shattercasks.sweepMelee for a melee hit. Returns true when handled.
  function onStruck(burden, info = {}) {
    const rope = burden?.rope;
    if (!rope || rope.disposed) return false;
    const s = rope.state, attacker = info.attacker, t = tile();
    let traveled = 0;
    if (attacker && Number.isFinite(attacker.lungeOriginX) && performance.now() - num(attacker.lungeOriginMs, 0) <= CONFIG.lungeFreshMs)
      traveled = Math.hypot(attacker.x - attacker.lungeOriginX, attacker.y - attacker.lungeOriginY) / t;
    const speed = RP.strikeSpeed(traveled, CONFIG);
    let dx = attacker ? s.px - attacker.x / t : 1, dz = attacker ? s.pz - attacker.y / t : 0; // away from the attacker
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) { dx = 1; dz = 0; } else { dx /= len; dz /= len; }
    RP.applyVelocity(s, { x: dx * speed, y: 0, z: dz * speed });
    const h = RP.horizontalSpeed(s) || 1; // Out direction = where it is actually going now (a second strike may redirect it).
    rope.outX = s.vx / h; rope.outZ = s.vz / h;
    rope.prevOut = RP.along(s, rope.outX, rope.outZ).velocity;
    rope.armed = true;
    emit('rope:swing', { scope: rope.mapId, ropeId: rope.id, burdenId: burden.id, speed, lungeTraveled: traveled });
    return true;
  }

  // ---------------------------------------------------------------- per frame
  function release(rope, mode) {
    const burden = rope.burden, s = rope.state;
    if (!burden) return false;
    const velocity = { x: s.vx, y: s.vy, z: s.vz }, at = { x: s.px, y: s.py, z: s.pz }, speed = RP.speed(s);
    detachInternal(rope, 'release-' + mode);
    const ok = window.Shattercasks?.releaseBurdenWithVelocity?.(burden, velocity, 'rope-' + mode) === true;
    if (!ok) console.warn('[HangingRopes] could not release', burden.id);
    emit('rope:release', { scope: rope.mapId, ropeId: rope.id, burdenId: burden.id, mode, speed, x: at.x, y: at.y, z: at.z });
    return ok;
  }
  function advance(rope, dt) {
    const burden = rope.burden, s = rope.state;
    if (!burden.group?.parent || burden.exploded) { detachInternal(rope, 'lost'); return; }
    RP.step(s, dt);
    burden.group.position.set(s.px, s.py, s.pz);
    burden.col = Math.floor(s.px); burden.row = Math.floor(s.pz);
    window.Shattercasks?.refreshBurdenBounds?.(burden);
    updateVisual(rope);
    if (!rope.armed) return;
    const out = RP.along(s, rope.outX, rope.outZ).velocity;
    if (out > 0 && RP.angle(s) >= rope.detachAngleRad) release(rope, 'launch');
    else if (rope.prevOut > 0 && out <= 0) release(rope, 'drop'); // forward apex: let go just before it swings back
    else rope.prevOut = out;
  }
  function tick(dt = 0) {
    if (!ropes.size) return;
    const step = Math.min(0.1, Math.max(0, num(dt, 0))), mapId = area();
    for (const rope of ropes.values()) if (rope.burden && rope.mapId === mapId && !rope.disposed) advance(rope, step);
  }

  const configure = overrides => { Object.assign(CONFIG, overrides || {}); return { ...CONFIG }; };
  const debugSnapshot = () => ({
    config: { ...CONFIG },
    ropes: [...ropes.values()].map(r => ({ id: r.id, mapId: r.mapId, burden: r.burden?.id || null, armed: r.armed, angle: +RP.angle(r.state).toFixed(3), speed: +RP.speed(r.state).toFixed(3) })),
  });

  window.HangingRopes = Object.freeze({ installed: true, CONFIG, registerRope, removeRope, clearScope, attach, detach, canAttach, tryHang, onStruck, tick, configure, debugSnapshot, get ropes() { return [...ropes.values()]; } });
})();
