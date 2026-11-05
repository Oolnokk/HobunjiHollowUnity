// Point/line perches shared by birds, ground animals, and Shadewood branch
// occupants. Unlike a walkable plateau, a perch has no 2D supporting area.
(() => {
  'use strict';
  const byArea = new Map(); // Registered supports by map, consumed by future bird/nest spawning.
  let lastDrop = null; // Mobile diagnostics; never records full entity references.
  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const clamp = n => Math.max(0, Math.min(1, finite(n)));
  function point(id, x, y, worldY) {
    return Object.freeze({ id: String(id), dimension: 0, x: finite(x), y: finite(y), worldY: finite(worldY) });
  }
  function line(id, start, end) {
    const a = { x: finite(start?.x), y: finite(start?.y), worldY: finite(start?.worldY) };
    const b = { x: finite(end?.x), y: finite(end?.y), worldY: finite(end?.worldY) };
    return Object.freeze({ id: String(id), dimension: 1, start: a, end: b });
  }
  function fromBranch(branch) {
    if (!branch) return null;
    return line('shadewood:' + (branch.id || [branch.col, branch.row].join(',')), {
      x: branch.baseX, y: branch.baseY, worldY: branch.baseWorldY,
    }, { x: branch.tipX, y: branch.tipY, worldY: branch.tipWorldY });
  }
  function sample(perch, t = 0) {
    if (!perch) return null;
    if (perch.dimension === 0) return { x: finite(perch.x), y: finite(perch.y), worldY: finite(perch.worldY) };
    const a = perch.start || {}, b = perch.end || {}, u = clamp(t);
    return {
      x: finite(a.x) + (finite(b.x) - finite(a.x)) * u,
      y: finite(a.y) + (finite(b.y) - finite(a.y)) * u,
      worldY: finite(a.worldY) + (finite(b.worldY) - finite(a.worldY)) * u,
    };
  }
  function register(area, perch) {
    if (!perch || ![0, 1].includes(perch.dimension) || !String(area || '')) return false;
    const entries = byArea.get(area) || new Map();
    entries.set(perch.id, perch);
    byArea.set(area, entries);
    return true;
  }
  function unregister(area, id) {
    const entries = byArea.get(area); // World streaming drops old branch supports without touching separately authored rock perches.
    if (!entries) return false;
    const removed = entries.delete(id);
    if (!entries.size) byArea.delete(area);
    return removed;
  }
  function clearArea(area) { byArea.delete(area); }
  function branchAdapter(perch) {
    const start = sample(perch, 0), end = sample(perch, 1); // Converts 0D/1D support to the existing renderer's exact branch-height representation.
    const length = Math.max(1e-6, Math.hypot(end.x - start.x, end.y - start.y)); // Point supports have a zero tangent; nonzero divisor keeps all native branch movement finite.
    return {
      id: perch.id, perchSupport: true,
      baseX: start.x, baseY: start.y, baseWorldY: start.worldY,
      tipX: end.x, tipY: end.y, tipWorldY: end.worldY, length,
    };
  }
  function attach(entity, perch, t = 0) {
    if (!entity || !perch || ![0, 1].includes(perch.dimension) || entity.prone || Number(entity.health) <= 0) return false;
    const u = perch.dimension === 0 ? 0 : clamp(t); // A point has no axis to walk along.
    const p = sample(perch, u);
    if (!p) return false;
    const branch = branchAdapter(perch); // Existing player/creature branch renderers consume onBranch and branchSurfaceY.
    entity.onPerch = perch; entity.perchT = u; entity.perchWorldY = p.worldY;
    entity.onBranch = branch; entity.branchT = u; entity.branchSurfaceY = p.worldY;
    entity.x = p.x; entity.y = p.y;
    return true;
  }
  function forget(entity) {
    if (!entity?.onPerch) return false;
    entity.onPerch = null; entity.perchT = 0; entity.perchWorldY = 0;
    return true; // Normal jumps/branch swaps relinquish support without taking a second fall hit.
  }
  function constrain(entity) {
    if (!entity?.onPerch) return false;
    if (!entity.onBranch?.perchSupport || entity.onBranch.id !== entity.onPerch.id) {
      forget(entity); // A regular branch, climb or ground step superseded the synthetic perch.
      return false;
    }
    const t = entity.branchT; // Native 1D branch walks advance branchT, not the editor-only perchT.
    const p = sample(entity.onPerch, t);
    if (!p) return false;
    entity.perchT = entity.onPerch.dimension === 0 ? 0 : clamp(t);
    entity.x = p.x; entity.y = p.y; entity.perchWorldY = p.worldY;
    if (entity.onBranch?.perchSupport) entity.branchSurfaceY = p.worldY;
    return true;
  }
  function support(entity) {
    const branch = entity?.onBranch;
    // A stale reference on an actor that already jumped down is not a perch;
    // never damage that actor again just because an old onPerch field survived.
    return entity?.onPerch && branch?.perchSupport && branch.id === entity.onPerch.id
      ? entity.onPerch : branch || null;
  }
  function release(entity, reason = 'fell from perch', options = {}) {
    const held = support(entity);
    if (!held) return null;
    const branch = entity.onBranch;
    const p = branch
      ? sample(fromBranch(branch), entity.branchT)
      : sample(entity.onPerch, entity.perchT);
    const ground = Number(window.ClimbSystem?.groundYAt?.(p?.x, p?.y)) || 0;
    const height = Math.max(0, finite(p?.worldY) - ground);
    forget(entity);
    entity.onBranch = null; entity.branchT = 0; entity.branchSurfaceY = 0;
    entity._branchDefense = null;
    if (p) { entity.x = p.x; entity.y = p.y; }
    const alive = Number(entity.health) > 0;
    // game.js's branch-knockback path already applies its original edge-fall
    // injury after resolveBranchKnockback returns {fell:true}.
    if (alive && !options.deferLegacyKnockback) {
      const health = Math.min(4, Math.max(0, Number(entity.health) - 1));
      if (health > 0) window.ResourceSystem?.applyDamage?.(entity, health, { tag: 'blunt', source: reason });
      window.ResourceSystem?.spendFooting?.(entity, 47.5, reason); // Same immediate footing loss as the existing branch/cliff drop.
    }
    lastDrop = { at: Date.now(), entity: entity.creatureKey || entity.name || (entity.isPlayer ? 'player' : 'actor'),
      support: held.id || 'shadewood-branch', dimension: held.dimension ?? 1, reason, height, deferred: !!options.deferLegacyKnockback };
    window.__farmLog?.('[perch] ' + lastDrop.entity + ' ' + reason + ' (' + height.toFixed(2) + ' height)', 'wildlife');
    return { fell: true, x: entity.x, y: entity.y, height, support: held };
  }
  window.PerchSupport = Object.freeze({
    point, line, fromBranch, sample, register, unregister, clearArea, attach, forget, constrain, support, release,
    debugSnapshot: () => ({ areas: [...byArea].map(([id, items]) => ({ id, supports: items.size })), lastDrop: lastDrop && { ...lastDrop } }),
  });
})();
