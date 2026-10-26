// Shared sacred-ground registry. Consumers register zones once; healing is just one use.
(() => {
  'use strict';
  const PROVIDER_ERROR_LIMIT = 3; // Limits noisy diagnostics from broken optional extensions.
  const DEFAULT_TOTEM_RADIUS_TILES = 2.5; // Includes the walkable anchor and the farm checkpoint's surrounding clearing.
  const providers = new Map(); // Named reusable sacred-area predicates for future rituals, buffs and afflictions.
  const errors = new Map(); // Counts provider failures without logging on every afflicted actor tick.
  let context = null; // Game-world getters injected by game.js rather than duplicating terrain/zone state here.
  let latest = null; // Mobile-readable last area inspection without devtools.

  function init(world) { context = world && typeof world === 'object' ? world : null; }

  function registerProvider(id, contains) {
    if (typeof id !== 'string' || !id.trim() || typeof contains !== 'function') return () => {};
    providers.set(id, contains);
    return () => { if (providers.get(id) === contains) providers.delete(id); };
  }

  function nearTotem(actor, areaId) {
    const tile = Math.max(1, Number(context?.tileSize) || 64); // Translates the shared world-space combat actor coordinates into map tiles.
    const checkpoints = areaId === 'farm' ? [context?.getFarmRootTotem?.()].filter(Boolean) : (context?.getRootTotems?.(areaId) || []); // Farm checkpoint plus procedural zone totems share one radius rule.
    if (!Array.isArray(checkpoints)) return false;
    for (const totem of checkpoints) {
      const anchor = totem?.pathAnchor || totem;
      if (!Number.isFinite(Number(anchor?.x)) || !Number.isFinite(Number(anchor?.y))) continue;
      const radius = Math.max(0, Number(totem?.sacredRadiusTiles) || DEFAULT_TOTEM_RADIUS_TILES);
      if (Math.hypot(actor.x / tile - (Number(anchor.x) + 0.5), actor.y / tile - (Number(anchor.y) + 0.5)) <= radius) return true;
    }
    return false;
  }

  function sacredSources(actor, areaOverride) {
    if (!actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return [];
    const area = areaOverride || (actor === context?.getPlayer?.() ? context?.getCurrentArea?.() : actor.areaId || context?.getCurrentArea?.()); // The player uses the live map, while enemies use their own zone identity.
    const found = [];
    if (area === 'map_i_temple') found.push('life-temple-main'); // The temple's main interior, deliberately not its basement.
    if (nearTotem(actor, area)) found.push('root-totem');
    for (const [id, predicate] of providers) {
      try { if (predicate(actor, area, context)) found.push(id); }
      catch (error) {
        const count = errors.get(id) || 0;
        errors.set(id, count + 1);
        if (count < PROVIDER_ERROR_LIMIT) console.warn('[sacred-ground] provider', id, error);
      }
    }
    latest = { area, sources: found, x: actor.x, y: actor.y };
    return found;
  }

  function contains(actor, areaOverride) { return sacredSources(actor, areaOverride).length > 0; }
  function cleanseRentHealth(actor) {
    const rs = window.ResourceSystem;
    const amount = rs?.getAffliction?.(actor, 'rentHealth') || 0;
    if (amount <= 0 || !contains(actor)) return 0;
    const removed = rs.removeAffliction(actor, 'rentHealth', amount);
    rs.enforceCaps?.(actor);
    return removed;
  }
  function debugSnapshot(actor) {
    return { latest, providers: [...providers.keys()], current: actor ? sacredSources(actor) : null, rentHealth: actor ? (window.ResourceSystem?.getAffliction?.(actor, 'rentHealth') || 0) : null };
  }
  window.HobunjiSacredGround = { init, registerProvider, contains, sacredSources, cleanseRentHealth, debugSnapshot };
})();
