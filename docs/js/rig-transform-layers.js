// Shared per-node transform ownership for actor rigs.
// Absolute animators (IK, facing, authored stances) supply the base pose; named
// effects contribute removable local position/Euler or quaternion deltas.
// The player's body composer shares this authority's channel registry, while
// retaining its render-only transaction and special world-space body solver.
(function (global) {
  'use strict';
  if (global.RigTransformLayers) return;

  const records = new WeakMap(); // Per-node records never keep a disposed rig alive.
  const axisDeltaScratch = new WeakMap(); // Reused local axis-angle quaternions avoid per-frame allocations.
  const leased = new Set(); // Only active leased slots are held for interruption recovery.
  const channelStores = new Map(); // Shared named stores used by body-root compositor adapters.
  const stats = {
    writes: 0, clears: 0, externalTakeovers: 0, outOfBandWrites: 0,
    invalidInputs: 0, activeLayers: 0, slotsCreated: 0, leasesExpired: 0,
    quaternionWrites: 0, lastOutOfBand: null,
  }; // In-game diagnostics distinguish stale-pose protection from ordinary releases.
  const EPSILON = 1e-7;
  const MAX_LEASE_MS = 5000;

  function nowMs() {
    return global.performance?.now?.() ?? Date.now();
  }

  function valid(node, property, axis) {
    return !!node && (property === 'position' || property === 'rotation' || property === 'scale')
      && (axis === 'x' || axis === 'y' || axis === 'z')
      && Number.isFinite(node[property]?.[axis]);
  }

  function slotsFor(node, create) {
    let slots = records.get(node);
    if (!slots && create) { slots = new Map(); records.set(node, slots); }
    return slots;
  }

  function slotFor(node, property, axis, create) {
    const slots = slotsFor(node, create);
    if (!slots) return null;
    const key = property + '.' + axis;
    let slot = slots.get(key);
    if (!slot && create) {
      slot = { node, key, property, axis, base: node[property][axis],
        applied: node[property][axis], owners: new Map(), quaternion: false };
      slots.set(key, slot);
      stats.slotsCreated++;
    }
    return slot;
  }

  function quaternionValid(q) {
    return !!q && Number.isFinite(q.x) && Number.isFinite(q.y)
      && Number.isFinite(q.z) && Number.isFinite(q.w);
  }

  function quaternionSlot(node, create) {
    if (!quaternionValid(node?.quaternion) || typeof node.quaternion.clone !== 'function'
      || typeof node.quaternion.copy !== 'function' || typeof node.quaternion.multiply !== 'function') return null;
    const slots = slotsFor(node, create);
    if (!slots) return null;
    let slot = slots.get('quaternion');
    if (!slot && create) {
      slot = { node, key: 'quaternion', property: 'quaternion', axis: null,
        base: node.quaternion.clone(), applied: node.quaternion.clone(),
        owners: new Map(), quaternion: true };
      slots.set('quaternion', slot);
      stats.slotsCreated++;
    }
    return slot;
  }

  // q and -q describe the same physical rotation. Angular distance is not
  // inferred from Euler values, which can wrap or change representation.
  function rotationMatches(a, b) {
    const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
    return Math.abs(1 - dot) <= EPSILON;
  }

  function matches(node, slot) {
    return slot.quaternion
      ? rotationMatches(node.quaternion, slot.applied)
      : Math.abs(node[slot.property][slot.axis] - slot.applied) <= EPSILON;
  }

  function captureValue(node, slot) {
    return slot.quaternion ? node.quaternion.clone() : node[slot.property][slot.axis];
  }

  function restoreValue(node, slot, value) {
    if (slot.quaternion) node.quaternion.copy(value);
    else node[slot.property][slot.axis] = value;
  }

  function noteOutsideWrite(slot) {
    stats.externalTakeovers++;
    stats.outOfBandWrites++;
    stats.lastOutOfBand = {
      node: String(slot.node.name || slot.node.type || 'unnamed rig node'),
      property: slot.key,
      owners: Array.from(slot.owners.keys()),
    }; // Shown through RigTransformLayers.getDebug() on mobile.
  }

  function reconcile(node, slot) {
    if (!slot.owners.size) {
      const current = captureValue(node, slot); // Refresh the clean base only when an absolute solver has no competing layer.
      // Without an active effect, the ordinary absolute solver may advance its
      // pose. That clean solved pose is the base for subsequent contributions.
      slot.base = current;
      slot.applied = slot.quaternion ? current.clone() : current;
      return;
    }
    if (matches(node, slot)) return;
    // An unregistered writer changed a node WHILE a layer owned it. Its output
    // may contain an abandoned additive deformation. Never promote that value
    // into the clean baseline. Revert to the last known clean pose, drop all
    // stale claims and report the conflict for migration to an explicit owner.
    noteOutsideWrite(slot);
    stats.activeLayers -= slot.owners.size;
    slot.owners.clear();
    leased.delete(slot);
    restoreValue(node, slot, slot.base);
    slot.applied = slot.quaternion ? slot.base.clone() : slot.base;
  }

  function write(node, slot) {
    if (slot.quaternion) {
      node.quaternion.copy(slot.base);
      for (const layer of slot.owners.values()) node.quaternion.multiply(layer.value);
      slot.applied.copy(node.quaternion);
      stats.quaternionWrites++;
    } else {
      let result = slot.base;
      for (const layer of slot.owners.values()) result += layer.value;
      node[slot.property][slot.axis] = result;
      slot.applied = result;
    }
    stats.writes++;
  }

  function leaseDeadline(options) {
    const ms = Number(options?.leaseMs);
    return Number.isFinite(ms) && ms > 0 ? nowMs() + Math.min(ms, MAX_LEASE_MS) : null;
  }

  function trackLease(slot) {
    for (const layer of slot.owners.values()) {
      if (layer.expiresAtMs !== null) { leased.add(slot); return; }
    }
    leased.delete(slot);
  }

  function commitLayer(node, slot, owner, value, options) {
    reconcile(node, slot);
    const hadOwner = slot.owners.has(owner);
    const isIdentity = slot.quaternion
      ? rotationMatches(value, { x: 0, y: 0, z: 0, w: 1 })
      : value === 0;
    if (isIdentity) {
      if (slot.owners.delete(owner)) stats.activeLayers--;
    } else {
      if (hadOwner && slot.quaternion) {
        const existing = slot.owners.get(owner);
        existing.value.copy(value); // A frequently refreshed joint sway does not allocate a quaternion every frame.
        existing.expiresAtMs = leaseDeadline(options);
      } else {
        slot.owners.set(owner, { value: slot.quaternion ? value.clone() : value, expiresAtMs: leaseDeadline(options) });
      }
      if (!hadOwner) stats.activeLayers++;
    }
    trackLease(slot);
    write(node, slot);
    return true;
  }

  function setAxis(node, owner, property, axis, offset, options) {
    if (!valid(node, property, axis) || typeof owner !== 'string' || !owner || !Number.isFinite(offset)) {
      stats.invalidInputs++;
      return false;
    }
    // On a real Three.js rig, Euler and quaternion write to the SAME rotation.
    // Route both through one quaternion store to prevent yawn X rotations and
    // drunken quaternion sway from independently capturing each other as base.
    if (property === 'rotation' && node.quaternion?.isQuaternion
      && typeof node.quaternion.clone === 'function' && typeof node.quaternion.set === 'function') {
      const h = offset / 2; // Local axis-angle half-angle for a quaternion contribution.
      const s = Math.sin(h); // Rotation component about the chosen local axis.
      let delta = axisDeltaScratch.get(node); // Same scratch reused across successive authored axis contributions.
      if (!delta) { delta = node.quaternion.clone(); axisDeltaScratch.set(node, delta); }
      delta.set(axis === 'x' ? s : 0, axis === 'y' ? s : 0, axis === 'z' ? s : 0, Math.cos(h));
      return setQuaternion(node, owner, delta, options);
    }
    let slot = slotFor(node, property, axis, false);
    if (!slot && offset === 0) return true;
    if (!slot) slot = slotFor(node, property, axis, true);
    return commitLayer(node, slot, owner, offset, options);
  }

  function setPosition(node, owner, offset, options) {
    const x = Number(offset?.x ?? 0); // X component of this owner's local translation.
    const y = Number(offset?.y ?? 0); // Y component of this owner's local translation.
    const z = Number(offset?.z ?? 0); // Z component of this owner's local translation.
    if (!offset || typeof owner !== 'string' || !owner || !valid(node, 'position', 'x')
      || !valid(node, 'position', 'y') || !valid(node, 'position', 'z')
      || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      stats.invalidInputs++;
      return false;
    }
    setAxis(node, owner, 'position', 'x', x, options);
    setAxis(node, owner, 'position', 'y', y, options);
    setAxis(node, owner, 'position', 'z', z, options);
    return true;
  }

  function setQuaternion(node, owner, delta, options) {
    if (typeof owner !== 'string' || !owner || !quaternionValid(delta)) {
      stats.invalidInputs++;
      return false;
    }
    const slot = quaternionSlot(node, true);
    if (!slot || typeof delta.clone !== 'function') {
      stats.invalidInputs++;
      return false;
    }
    return commitLayer(node, slot, owner, delta, options);
  }

  // An absolute solver that intentionally takes over a managed axis must use
  // this explicit handoff; no unknown mutation can change a claimed baseline.
  function setAbsoluteBase(node, property, axis, value) {
    if (property !== 'quaternion' && !valid(node, property, axis)) {
      stats.invalidInputs++;
      return false;
    }
    const slot = property === 'quaternion' ? quaternionSlot(node, true)
      : slotFor(node, property, axis, true);
    if (!slot || !(slot.quaternion ? quaternionValid(value) : Number.isFinite(value))) {
      stats.invalidInputs++;
      return false;
    }
    stats.activeLayers -= slot.owners.size;
    stats.clears += slot.owners.size;
    slot.owners.clear();
    leased.delete(slot);
    slot.base = slot.quaternion ? value.clone() : value;
    write(node, slot);
    return true;
  }

  function clear(node, owner) {
    if (!node || typeof owner !== 'string' || !owner) return false;
    const slots = slotsFor(node, false);
    if (!slots) return false;
    let changed = false;
    for (const slot of slots.values()) {
      if (!slot.owners.has(owner)) continue;
      reconcile(node, slot);
      if (slot.owners.delete(owner)) {
        stats.activeLayers--;
        stats.clears++;
        trackLease(slot);
        write(node, slot);
        changed = true;
      }
    }
    return changed;
  }

  function clearAll(node) {
    const slots = node && slotsFor(node, false);
    if (!slots) return false;
    let changed = false;
    for (const slot of slots.values()) {
      reconcile(node, slot);
      if (slot.owners.size) {
        stats.clears += slot.owners.size;
        stats.activeLayers -= slot.owners.size;
        slot.owners.clear();
        leased.delete(slot);
        write(node, slot);
        changed = true;
      }
    }
    slots.clear();
    return changed;
  }

  function expireStale(timeMs = nowMs()) {
    let removed = 0;
    for (const slot of leased) {
      let slotRemoved = 0; // Only recomposes this node if one of its own owners expired.
      reconcile(slot.node, slot);
      for (const [owner, layer] of slot.owners) {
        if (layer.expiresAtMs == null || layer.expiresAtMs > timeMs) continue;
        slot.owners.delete(owner);
        stats.activeLayers--;
        stats.clears++;
        stats.leasesExpired++;
        removed++;
        slotRemoved++;
      }
      trackLease(slot);
      if (slotRemoved) write(slot.node, slot);
    }
    return removed;
  }

  function channelStore(name) {
    const key = String(name || '');
    if (!key) return null;
    if (!channelStores.has(key)) channelStores.set(key, new Map());
    return channelStores.get(key);
  }

  const compositor = Object.freeze({
    setAxis, setPosition, setQuaternion, setAbsoluteBase,
    clear, clearAll, expireStale, channelStore,
    getDebug() { return { ...stats, leasedSlots: leased.size }; },
  });
  // Both names are compatibility APIs over ONE ownership authority.
  global.ActorRigCompositor = compositor;
  global.RigTransformLayers = compositor;
})(window);
