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
    return line(branch.id || [branch.col, branch.row].join(','), {
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
  function clearArea(area) { byArea.delete(area); }
  function attach(entity, perch, t = 0) {
    if (!entity || !perch || ![0, 1].includes(perch.dimension)) return false;
    const p = sample(perch, t);
    if (!p) return false;
    entity.onPerch = perch; entity.perchT = clamp(t); entity.perchWorldY = p.worldY;
    entity.x = p.x; entity.y = p.y;
    return true;
  }
  function constrain(entity) {
    if (!entity?.onPerch) return false;
    const p = sample(entity.onPerch, entity.perchT);
    if (!p) return false;
    entity.x = p.x; entity.y = p.y; entity.perchWorldY = p.worldY;
    return true;
  }
  function support(entity) {
    return entity?.onPerch || entity?.onBranch || null;
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
    entity.onPerch = null; entity.perchT = 0; entity.perchWorldY = 0;
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
    point, line, fromBranch, sample, register, clearArea, attach, constrain, support, release,
    debugSnapshot: () => ({ areas: [...byArea].map(([id, items]) => ({ id, supports: items.size })), lastDrop: lastDrop && { ...lastDrop } }),
  });
})();
