// Named additive local-transform layers for procedural rigs.
// Each axis is recomposed from an unmodified base plus the currently owned
// offsets. A later absolute writer invalidates the older contributions rather
// than having their inverse applied to an unrelated pose.
(function (global) {
  'use strict';
  if (global.RigTransformLayers) return;

  const records = new WeakMap(); // Per Object3D axis records; the registry cannot retain disposed rigs.
  const stats = { writes: 0, clears: 0, externalTakeovers: 0, invalidInputs: 0, activeLayers: 0 }; // Mobile diagnostics expose ownership changes without console access.
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
    if (slot.owners.size === 0) slotsFor(node, false)?.delete(slot.key);
    return true;
  }

  function setPosition(node, owner, offset) {
    if (!offset || !['x', 'y', 'z'].every(axis => Number.isFinite(Number(offset[axis] ?? 0)))) {
      stats.invalidInputs++;
      return false;
    }
    for (const axis of ['x', 'y', 'z']) {
      if (!setAxis(node, owner, 'position', axis, Number(offset[axis] ?? 0))) return false;
    }
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
      if (!slot.owners.size) slots.delete(key);
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
