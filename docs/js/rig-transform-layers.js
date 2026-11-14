// Named additive local-transform layers for procedural rigs.
// Each axis is recomposed from an unmodified base plus the currently owned
// offsets. A later absolute writer invalidates the older contributions rather
// than having their inverse applied to an unrelated pose.
(function (global) {
  'use strict';
  if (global.RigTransformLayers) return;

  const records = new WeakMap(); // Per Object3D axis records; the registry cannot retain disposed rigs.
  const stats = { writes: 0, clears: 0, externalTakeovers: 0, invalidInputs: 0, activeLayers: 0, slotsCreated: 0 }; // Mobile diagnostics expose ownership changes without console access.
  const EPSILON = 1e-7; // Float tolerance for detecting another animation writer's absolute overwrite.

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
      slot = { key, property, axis, base: node[property][axis], applied: node[property][axis], owners: new Map() };
      slots.set(key, slot);
      stats.slotsCreated++; // Cumulative allocations: frame-by-frame reapplication should reuse these slot records.
    }
    return slot;
  }

  function reconcile(node, slot) {
    const current = node[slot.property][slot.axis];
    if (Math.abs(current - slot.applied) <= EPSILON) return;
    // A new pose writer already replaced this axis. Do not subtract our old
    // offset from its replacement and do not revive other stale owners.
    stats.externalTakeovers++;
    stats.activeLayers -= slot.owners.size;
    slot.owners.clear();
    slot.base = current;
    slot.applied = current;
  }

  function write(node, slot) {
    let composed = slot.base;
    for (const offset of slot.owners.values()) composed += offset;
    node[slot.property][slot.axis] = composed;
    slot.applied = composed;
    stats.writes++;
  }

  function setAxis(node, owner, property, axis, offset) {
    if (!valid(node, property, axis) || typeof owner !== 'string' || !owner || !Number.isFinite(offset)) {
      stats.invalidInputs++;
      return false;
    }
    let slot = slotFor(node, property, axis, false);
    if (!slot && offset === 0) return true;
    if (!slot) slot = slotFor(node, property, axis, true);
    reconcile(node, slot);
    if (!slot.owners.has(owner)) stats.activeLayers++;
    if (offset === 0) {
      if (slot.owners.delete(owner)) stats.activeLayers--;
    } else slot.owners.set(owner, offset);
    write(node, slot);
    // Keep an empty slot so the same rig axis reuses its Map next frame.
    // WeakMap ownership does not keep an otherwise disposed Object3D alive.
    return true;
  }

  function setPosition(node, owner, offset) {
    const x = Number(offset?.x ?? 0); // Local X contribution, committed only after checking all three writable axes.
    const y = Number(offset?.y ?? 0); // Local Y contribution, validated together with X/Z to avoid partial poses.
    const z = Number(offset?.z ?? 0); // Local Z contribution, validated together with X/Y to avoid partial poses.
    if (!offset || typeof owner !== 'string' || !owner
        || !valid(node, 'position', 'x') || !valid(node, 'position', 'y') || !valid(node, 'position', 'z')
        || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      stats.invalidInputs++;
      return false;
    }
    setAxis(node, owner, 'position', 'x', x);
    setAxis(node, owner, 'position', 'y', y);
    setAxis(node, owner, 'position', 'z', z);
    return true;
  }

  function clear(node, owner) {
    if (!node || typeof owner !== 'string' || !owner) return false;
    const slots = slotsFor(node, false);
    if (!slots) return false;
    let cleared = false;
    for (const [key, slot] of slots) {
      if (!slot.owners.has(owner)) continue;
      reconcile(node, slot);
      if (slot.owners.delete(owner)) {
        stats.activeLayers--;
        stats.clears++;
        write(node, slot);
        cleared = true;
      }
      // Empty records remain cached on this node for repeated gait/pose releases.
    }
    return cleared;
  }

  function clearAll(node) {
    const slots = node && slotsFor(node, false);
    if (!slots) return false;
    let changed = false;
    for (const slot of slots.values()) {
      reconcile(node, slot);
      if (!slot.owners.size) continue;
      stats.clears += slot.owners.size;
      stats.activeLayers -= slot.owners.size;
      slot.owners.clear();
      write(node, slot);
      changed = true;
    }
    slots.clear();
    return changed;
  }

  global.RigTransformLayers = Object.freeze({
    setAxis, setPosition, clear, clearAll,
    getDebug() { return { ...stats }; },
  });
})(window);
