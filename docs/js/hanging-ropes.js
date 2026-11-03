// HangingRopes — a rope any carriable burden can hang from.
//
// Ropes use the original rope behavior (js/rope-core.js): a planar pendulum with the same gravity,
// damping, swing limit and collision bounce the Random Test Ruin rope has always had, so a burden
// swings exactly as a rider does. A rope is the shared object shape { anchor, yaw, length, angle,
// omega, bob ... }; this module either owns and steps it (registerRope) or adopts one whose owner
// steps it (adoptRope: the ruin runtime's ropes, which a player can also ride).
//
// A burden hung on a rope becomes a lunge-stop target (Targetables 'lungeStop'), so a player lunging
// at it stops the moment it is inside the attack cone: attack from close and little lunge is spent,
// attack from far and all of it is. A melee strike then sets the rope swinging, with a speed that
// grows with the lunge distance actually spent (strikeSpeed), in the direction away from the attacker.
//
// Release rules, evaluated while it swings after a strike:
//   drop   — at the forward apex (just before the swing back) the burden is let go, falling roughly
//            where it stopped: a small hit moves it a few feet.
//   launch — if the rope swings past detachAngleRad while still moving outward, the burden detaches
//            at that steep angle with the rope's release velocity (RopeCore.releaseFlight, the same
//            tangent speed and upward kick a rider gets) and flies across the room.
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
  if (window.HangingRopes?.installed || !window.RopeCore) return;
  const RC = window.RopeCore;

  const CONFIG = {
    referenceLungeWorld: 1.6, // a lunge this long (world units) is a "full" lunge
    minSpeed: 0.9,            // strike speed (units/s) for no lunge at all
    maxSpeed: 9.5,            // strike speed for a full lunge
    detachAngleRad: 0.85,     // ~49 degrees: past this while moving outward, the burden is flung rather than dropped (the rider swing limit is 1.28)
    releaseKick: RC.RELEASE_KICK, // the same upward kick a rider gets on letting go
    hangReach: 1.8,           // how close the player must be to hang a carried burden on a free hook
    lungeFreshMs: 1500,       // a lunge origin older than this is not "this attack"
    ropeRadius: RC.BODY_RADIUS, ropeColor: 0x8a6a42,
    maxStep: 0.05,            // the original rope is stepped at frame rates up to 20 Hz; longer frames are split
  };
  const ropes = new Map(); // id -> rope
  let serial = 0, ropeGeometry = null, ropeMaterial = null;
  let scratchDir = null, scratchUp = null, scratchA = null, scratchB = null;

  const area = () => String(window.GridTileAccessors?.getCurrentArea?.() || window.Combat?.deps?.getCurrentArea?.() || '');
  const currentScene = () => window.GridTileAccessors?.getActiveScene?.() || window.Combat?.deps?.getActiveScene?.() || null;
  const tile = () => Number(window.Combat?.deps?.TILE) || 64;
  const emit = (type, payload) => window.WorldEvents?.emit?.(type, payload);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // How fast a strike sets the bob moving, from how far the attacker lunged. A close hit stops the lunge
  // early (the target is already inside the attack cone), so little distance is spent and the swing is
  // small; a full lunge spends all of it and swings hard.
  function strikeSpeed(lungeTraveledWorld, options = CONFIG) {
    const fraction = Math.max(0, Math.min(1, num(lungeTraveledWorld, 0) / Math.max(0.01, options.referenceLungeWorld)));
    return options.minSpeed + (options.maxSpeed - options.minSpeed) * fraction;
  }

  // ---------------------------------------------------------------- visuals (owned ropes only)
  function buildVisual(rope) {
    const THREE = window.THREE;
    if (!THREE?.Mesh || !rope.scene || rope.mountOnly) return null;
    scratchDir ||= new THREE.Vector3(); scratchUp ||= new THREE.Vector3(0, 1, 0);
    const mesh = window.DungeonRopeArt?.createRopePlane?.('hanging_rope_' + rope.id) || (() => {
      ropeGeometry ||= new THREE.CylinderGeometry(CONFIG.ropeRadius, CONFIG.ropeRadius, 1, 8, 1);
      ropeMaterial ||= new THREE.MeshBasicMaterial({ color: CONFIG.ropeColor });
      return new THREE.Mesh(ropeGeometry, ropeMaterial);
    })();
    mesh.name = 'hanging_rope_' + rope.id;
    mesh.userData.hangingRopeId = rope.id;
    rope.scene.add(mesh);
    return mesh;
  }
  function updateVisual(rope) {
    const mesh = rope.mesh, bob = rope.bob;
    if (!mesh || !bob || !scratchDir) return;
    scratchDir.set(bob.x - rope.anchor.x, bob.y - rope.anchor.y, bob.z - rope.anchor.z);
    const length = Math.max(0.001, scratchDir.length());
    scratchDir.multiplyScalar(1 / length);
    mesh.position.set((rope.anchor.x + bob.x) * 0.5, (rope.anchor.y + bob.y) * 0.5, (rope.anchor.z + bob.z) * 0.5);
    if (mesh.userData?.dungeonRopeSprite) {
      const cam = window.Combat?.deps?.getActiveCamera?.() || window.Shattercasks?.deps?.getActiveCamera?.();
      window.DungeonRopeArt.updateRopePlane(mesh, rope.anchor, bob, cam);
    } else { mesh.quaternion.setFromUnitVectors(scratchUp, scratchDir);mesh.scale.set(1, length, 1); }
  }

  // Swept collision for a swinging burden against the nearby static volumes (walls, furniture), like the rider's sweep.
  function sweepBlocked(rope) {
    const hit = window.NearbyVolumeCollision?.segmentHit, THREE = window.THREE;
    if (!hit || !THREE?.Vector3) return null;
    scratchA ||= new THREE.Vector3(); scratchB ||= new THREE.Vector3();
    return (from, to) => { scratchA.set(from.x, from.y, from.z); scratchB.set(to.x, to.y, to.z); return !!hit.call(window.NearbyVolumeCollision, scratchA, scratchB, num(rope.burden?.impactRadius, 0.22)); };
  }

  // ---------------------------------------------------------------- registry
  // Owned rope. options: { id?, mapId?, scene?, x, y, z (anchor), length, maxLength?, yaw?, angle?, detachAngleRad?, mount? }
  // `mount`: the furniture object the rope hangs from (kept for disposal bookkeeping; never removed by this module).
  function registerRope(options = {}) {
    const id = String(options.id || ('rope_' + (++serial)));
    if (ropes.has(id)) removeRope(id);
    const rope = Object.assign(RC.create({ anchor: { x: options.x, y: options.y, z: options.z }, yaw: options.yaw, length: options.length, maxLength: options.maxLength, angle: options.angle }), {
      id, mapId: String(options.mapId || area()), scene: options.scene || currentScene(), mount: options.mount || null,
      detachAngleRad: num(options.detachAngleRad, CONFIG.detachAngleRad), external: false,
      burden: null, armed: false, outSign: 1, prevOut: 0, restore: null, disposed: false, mesh: null,
    });
    rope.bob = RC.bobAt(rope); rope.lastSafeBob = RC.clonePoint(rope.bob);
    rope.mesh = buildVisual(rope);
    updateVisual(rope);
    ropes.set(id, rope);
    return rope;
  }
  // Adopts a rope whose owner steps and draws it (the ruin runtime's ropes: ridden by the player too).
  // Only burden bookkeeping happens here. options: { id?, mapId, scene }
  function adoptRope(rope, options = {}) {
    if (!rope?.anchor || !Number.isFinite(rope.length)) return null;
    const id = String(rope.id || options.id || ('rope_' + (++serial))); // keep the owner's id: its flight/catch logic compares ropes by it
    if (ropes.has(id)) removeRope(id);
    Object.assign(rope, { id, mapId: String(options.mapId || area()), scene: options.scene || currentScene(), external: true,
      detachAngleRad: num(options.detachAngleRad, CONFIG.detachAngleRad), burden: null, armed: false, outSign: 1, prevOut: 0, restore: null, disposed: false });
    ropes.set(id, rope);
    return rope;
  }
  function removeRope(id) {
    const rope = typeof id === 'string' ? ropes.get(id) : id;
    if (!rope) return false;
    detachInternal(rope, 'removed');
    rope.disposed = true;
    if (!rope.external) {
      rope.mesh?.parent?.remove(rope.mesh);
      if (rope.mesh?.userData?.dungeonRopeSprite) { // Sprite geometry/material are private per rope; their loaded PNG is shared.
        rope.mesh.geometry?.dispose?.();
        rope.mesh.material?.dispose?.();
      }
    }
    ropes.delete(rope.id);
    return true;
  }
  const clearScope = mapId => { let n = 0; for (const rope of [...ropes.values()]) if (rope.mapId === String(mapId) && removeRope(rope)) n++; return n; };

  // ---------------------------------------------------------------- attach / detach
  function canAttach(rope, burden, { fromHand = false } = {}) {
    return !!rope && !rope.disposed && !rope.burden && !rope.attached && !!burden && !burden.exploded && !burden.flying && !burden.rope
      && (fromHand || !burden.carried) && String(burden.mapId) === rope.mapId && !!rope.scene && !!burden.group;
  }
  function attach(rope, burden, options = {}) {
    if (!canAttach(rope, burden, options)) return false;
    const bob = rope.bob || RC.bobAt(rope);
    rope.scene.add(burden.group); // Reparent into world space: the swing moves it in world coordinates.
    burden.group.quaternion?.identity?.();
    burden.group.scale?.setScalar?.(1);
    burden.group.position.set(bob.x, bob.y, bob.z);
    burden.carried = false; burden.flying = false; burden.hanging = false;
    burden.rope = rope; burden.lungeStop = true; burden.strikeHandler = onStruck;
    const restore = { onPickup: burden.onPickup, onLost: burden.onLost };
    const onPickup = record => { try { restore.onPickup?.(record); } finally { detachInternal(rope, 'pickup'); } };
    const onLost = (record, cause) => { try { restore.onLost?.(record, cause); } finally { detachInternal(rope, 'lost'); } };
    burden.onPickup = onPickup; burden.onLost = onLost;
    rope.restore = { onPickup: restore.onPickup, onLost: restore.onLost, wrappers: { onPickup, onLost } };
    rope.burden = burden; rope.armed = false;
    burden.col = Math.floor(bob.x); burden.row = Math.floor(bob.z);
    window.Shattercasks?.refreshBurdenBounds?.(burden);
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
    rope.omega = 0; rope.angle = 0; // An emptied rope starts again from rest.
    rope.bob = RC.bobAt(rope); rope.lastSafeBob = RC.clonePoint(rope.bob);
    updateVisual(rope);
    emit('rope:detach', { scope: rope.mapId, ropeId: rope.id, burdenId: burden.id, reason });
    return true;
  }
  const detach = (rope, reason = 'detached') => detachInternal(rope, reason);

  // The player is carrying a burden and pressed the carry-release action: hang it on a free hook in reach.
  function findHook(held) {
    const player = window.Combat?.deps?.player;
    if (!player || !held) return null;
    const t = tile(), px = player.x / t, pz = player.y / t, mapId = area();
    let best = null, bestDist = CONFIG.hangReach;
    for (const rope of ropes.values()) {
      if (rope.mapId !== mapId || !canAttach(rope, held, { fromHand: true })) continue;
      const bob = rope.bob || RC.bobAt(rope), d = Math.hypot(px - bob.x, pz - bob.z); // to the hook
      if (d <= bestDist) { best = rope; bestDist = d; }
    }
    return best;
  }

  function tryHang(held) {
    const best = findHook(held); // Use the same eligibility as the action label.
    if (!best) return false;
    const burden = window.Shattercasks?.detachHeldBurden?.();
    if (!burden) return false;
    if (!attach(best, burden, { fromHand: true })) return false;
    window.Combat?.deps?.showToast?.('Hung ' + (burden.displayName || 'the burden') + ' on the rope. Strike it to swing it.', false);
    return true;
  }

  // ---------------------------------------------------------------- strike
  // Adds a strike (direction away from the attacker, speed in units/s) to the rope's planar swing. A rope at
  // rest takes the strike direction as its swing plane; a rope already swinging keeps its plane and gains the
  // component of the strike along it (the same single-plane model a rider's rope has).
  function applyStrike(rope, dirX, dirZ, speed) {
    const cosA = Math.max(0.2, Math.cos(rope.angle)), ux = Math.cos(rope.yaw), uz = Math.sin(rope.yaw);
    const atRest = Math.abs(rope.angle) < 0.05 && Math.abs(rope.omega) < 0.2;
    if (atRest) { rope.yaw = Math.atan2(dirZ, dirX); rope.angle = 0; rope.omega = speed / rope.length; }
    else rope.omega += ((dirX * ux + dirZ * uz) * speed) / (rope.length * cosA);
    rope.outSign = Math.sign(rope.omega) || 1;
    rope.prevOut = rope.outSign * rope.omega;
    rope.armed = true;
  }
  // burden.strikeHandler, called by Shattercasks.sweepMelee for a melee hit. Returns true when handled.
  function onStruck(burden, info = {}) {
    const rope = burden?.rope;
    if (!rope || rope.disposed) return false;
    const attacker = info.attacker, t = tile(), bob = rope.bob || RC.bobAt(rope);
    let traveled = 0;
    if (attacker && Number.isFinite(attacker.lungeOriginX) && performance.now() - num(attacker.lungeOriginMs, 0) <= CONFIG.lungeFreshMs)
      traveled = Math.hypot(attacker.x - attacker.lungeOriginX, attacker.y - attacker.lungeOriginY) / t;
    const speed = strikeSpeed(traveled);
    let dx = attacker ? bob.x - attacker.x / t : 1, dz = attacker ? bob.z - attacker.y / t : 0; // away from the attacker
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) { dx = 1; dz = 0; } else { dx /= len; dz /= len; }
    applyStrike(rope, dx, dz, speed);
    emit('rope:swing', { scope: rope.mapId, ropeId: rope.id, burdenId: burden.id, speed, lungeTraveled: traveled });
    return true;
  }

  // ---------------------------------------------------------------- per frame
  function release(rope, mode) {
    const burden = rope.burden;
    if (!burden) return false;
    const bob = rope.bob || RC.bobAt(rope), f = RC.releaseFlight(rope, bob, CONFIG.releaseKick);
    const velocity = { x: f.vx, y: f.vy, z: f.vz }, speed = Math.hypot(f.vx, f.vy, f.vz);
    detachInternal(rope, 'release-' + mode);
    const ok = window.Shattercasks?.releaseBurdenWithVelocity?.(burden, velocity, 'rope-' + mode) === true;
    if (!ok) console.warn('[HangingRopes] could not release', burden.id);
    emit('rope:release', { scope: rope.mapId, ropeId: rope.id, burdenId: burden.id, mode, speed, x: bob.x, y: bob.y, z: bob.z });
    return ok;
  }
  function advance(rope, dt) {
    const burden = rope.burden;
    if (!burden.group?.parent || burden.exploded) { detachInternal(rope, 'lost'); return; }
    if (!rope.external) { // Owned ropes are stepped here at the original rope's frame granularity; adopted ones by their owner.
      const blocked = sweepBlocked(rope);
      for (let left = dt; left > 1e-6;) { const h = Math.min(left, CONFIG.maxStep); RC.stepIdle(rope, h, blocked); rope.lastSafeBob = RC.clonePoint(rope.bob); left -= h; }
      updateVisual(rope);
    }
    const bob = rope.bob || RC.bobAt(rope);
    burden.group.position.set(bob.x, bob.y, bob.z);
    burden.col = Math.floor(bob.x); burden.row = Math.floor(bob.z);
    window.Shattercasks?.refreshBurdenBounds?.(burden);
    if (!rope.armed) return;
    const out = rope.outSign * rope.omega; // positive while swinging outward (away from the attacker)
    if (out > 0 && Math.abs(rope.angle) >= rope.detachAngleRad) release(rope, 'launch');
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
    ropes: [...ropes.values()].map(r => ({ id: r.id, mapId: r.mapId, external: !!r.external, burden: r.burden?.id || null, armed: r.armed, angle: +r.angle.toFixed(3), omega: +r.omega.toFixed(3) })),
  });

  window.HangingRopes = Object.freeze({ installed: true, CONFIG, strikeSpeed, registerRope, adoptRope, removeRope, clearScope, attach, detach, canAttach, findHook, tryHang, onStruck, applyStrike, tick, configure, debugSnapshot, get ropes() { return [...ropes.values()]; } });
})();
