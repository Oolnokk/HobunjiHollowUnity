// Burning actors and still-flaming corpses become temporary mobile fire hazards.
// Forced-movement contact is resolved here; ordinary walking collision is unchanged.
(() => {
  'use strict';
  if (window.BurningEntityHazards?.installed) return;

  const CORPSE_FIRE_SECONDS = 8; // Used to keep fire-death bodies hazardous briefly after their lethal resource tick.
  const CORPSE_FIRE_MAX_SECONDS = 12; // Caps corpse lifetime even when the victim had a large remaining Burning buildup.
  const CORPSE_RADIUS_TILES = 0.22; // Used by knockback sweeps for a lying body, independent of visual particles.
  const ACTOR_RADIUS_TILES = 0.28; // Used by knockback sweeps for standing characters without authored physical radii.
  const HEIGHT_TOLERANCE = 0.65; // Keeps a shove on one ruin floor from touching flames on another floor.
  const corpseFlames = new WeakMap(); // Per-corpse temporary fire state, not persisted with creature saves.
  const activeCorpses = new Set(); // The only corpses ticked; old lootable bodies never incur a per-frame scan.
  let lastContact = null; // Exposed through debugSnapshot for mobile knockback and torch-ignition diagnosis.

  function afflictionAmount(entity) {
    const resource = window.ResourceSystem;
    if (!entity || !resource?.getAffliction) return 0;
    return Math.max(0, Number(resource.getAffliction(entity, 'burningHealth')) || 0)
      + Math.max(0, Number(resource.getAffliction(entity, 'kindlingHealth')) || 0);
  }

  function isCorpse(entity) {
    return entity?.state === 'dying' || entity?.state === 'corpse';
  }

  function corpseFlameAmount(entity) {
    return isCorpse(entity) ? Math.max(0, corpseFlames.get(entity)?.remaining || 0) : 0;
  }

  function isBurning(entity) {
    return isCorpse(entity) ? corpseFlameAmount(entity) > 0 : afflictionAmount(entity) > 0;
  }

  function beginCorpse(entity) {
    if (!entity) return false;
    if (corpseFlames.has(entity)) return corpseFlameAmount(entity) > 0;
    const buildup = afflictionAmount(entity); // Reads the final real fire affliction before dead actors stop ticking resources.
    if (!(buildup > 0) && entity.deathCause !== 'fire') return false;
    const remaining = Math.min(CORPSE_FIRE_MAX_SECONDS, Math.max(CORPSE_FIRE_SECONDS, buildup / 18)); // A burning death always leaves a short fire; intense fires can last a little longer.
    corpseFlames.set(entity, { remaining });
    activeCorpses.add(entity);
    lastContact = { kind: 'corpse-lit', label: labelFor(entity), remaining };
    return true;
  }

  function tickCorpses(dt, corpseRegistry, isInWater = null) {
    const step = Math.max(0, Number(dt) || 0); // Uses game simulation time, not wall clock or cosmetic particle time.
    if (!(step > 0) && activeCorpses.size === 0) return;
    for (const entity of activeCorpses) {
      const flame = corpseFlames.get(entity);
      if (!flame || (corpseRegistry && !corpseRegistry.has(entity))) {
        activeCorpses.delete(entity);
        corpseFlames.delete(entity);
        window.BurningAfflictionVfx?.disposeEntity?.(entity);
        continue;
      }
      // Corpse fire obeys the same water extinguishing rule as living Burning Health.
      const submerged = typeof isInWater === 'function' && isInWater(entity) === true;
      flame.remaining = submerged ? 0 : Math.max(0, flame.remaining - step);
      if (flame.remaining > 0) continue;
      activeCorpses.delete(entity);
      corpseFlames.delete(entity);
      window.BurningAfflictionVfx?.disposeEntity?.(entity);
      lastContact = { kind: submerged ? 'corpse-water-extinguished' : 'corpse-extinguished', label: labelFor(entity) };
    }
  }

  function labelFor(entity) {
    return entity?.name || entity?.def?.label || entity?.creatureKey || entity?.id || 'character';
  }

  function heightFor(entity) {
    if (Number.isFinite(entity?.physicalFeetY)) return entity.physicalFeetY;
    if (Number.isFinite(entity?.surfaceY)) return entity.surfaceY;
    const rootY = entity?.avatarRef?.group?.position?.y; // Gameplay compares floor level rather than the portrait's raised center.
    if (!Number.isFinite(rootY)) return null;
    const lift = isCorpse(entity)
      ? (Number(entity.halfHeight) || 0) * (entity.deathRecorded ? 0.82 : 0.12)
      : Number(entity.groundLift ?? entity.halfHeight) || 0; // Living avatar roots include the creature's body height.
    return rootY - lift;
  }

  function sameHeight(a, b) {
    const first = heightFor(a), second = heightFor(b);
    return first == null || second == null || Math.abs(first - second) <= HEIGHT_TOLERANCE;
  }

  function visitSources(world, excluded, callback) {
    const visited = new Set(); // Some bandit pets occur in both hostile and companion registries.
    const consider = entity => {
      if (!entity || entity === excluded || visited.has(entity)) return false;
      visited.add(entity);
      if (entity.areaId != null && entity.areaId !== world.area) return false;
      if (entity._denHidden || entity._wildlifeVisualsReleased || !isBurning(entity)) return false;
      return callback(entity) === true;
    };
    if (consider(world.player)) return true;
    // Only bodies registered as actively flaming are candidates; the settled corpse archive can be enormous.
    for (const registry of [world.hostileObjects, world.companionObjects, world.animalObjects, activeCorpses]) {
      if (!registry) continue;
      for (const entity of registry) if (consider(entity)) return true;
    }
    return false;
  }

  function findTorchSource(contact, world) {
    let found = null; // The already-existing contact probe handles physical melee reach, height and line-of-sight cover.
    visitSources(world, world.player, entity => {
      const root = entity.avatarRef?.group;
      const hitbox = window.RangedWeapons?.actorHitbox?.(entity)?.box || null; // Reuse the combat portrait box, excluding fire-particle cloud extents.
      if (!root || root.visible === false || !contact(root, hitbox)) return false;
      found = entity;
      lastContact = { kind: 'torch-lit', label: labelFor(entity), corpse: isCorpse(entity) };
      return true;
    });
    return found;
  }

  function radiusFor(entity, tile) {
    const radius = Number(entity?.collisionRadiusPx ?? entity?.hitRadiusPx ?? entity?.def?.collisionRadiusPx);
    if (Number.isFinite(radius) && radius > 0) return Math.min(radius, tile * 0.6);
    return tile * (isCorpse(entity) ? CORPSE_RADIUS_TILES : ACTOR_RADIUS_TILES);
  }

  function resolveSweptImpact(mover, desiredX, desiredY, radiusPx, tile, world, swept) {
    if (!mover || !swept || !(tile > 0)) return swept;
    const dx = desiredX - mover.x, dy = desiredY - mover.y; // The attempted impulse path before the existing world sweep updates the mover.
    const distSq = dx * dx + dy * dy;
    if (!(distSq > 1e-6)) return swept;
    const maxT = (swept.blockedX || swept.blockedY)
      ? Math.min(1, Math.hypot(swept.x - mover.x, swept.y - mover.y) / Math.sqrt(distSq) + 0.0001)
      : 1; // Only a burning body encountered BEFORE an existing wall/ledge blocker may override it.
    let nearest = null; // Closest swept circle contact, so a long per-frame impulse cannot tunnel past fire.

    visitSources(world, mover, entity => {
      if (!sameHeight(mover, entity) || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return false;
      const combined = Math.max(0, radiusPx) + radiusFor(entity, tile);
      const offsetX = mover.x - entity.x, offsetY = mover.y - entity.y;
      const startSq = offsetX * offsetX + offsetY * offsetY;
      if (startSq < combined * combined - 1e-4) return false; // Overlapping before the knockback must not trap either actor.
      const projection = offsetX * dx + offsetY * dy;
      const discriminant = projection * projection - distSq * (startSq - combined * combined);
      if (discriminant < 0) return false;
      const t = (-projection - Math.sqrt(discriminant)) / distSq;
      if (!Number.isFinite(t) || t < 0 || t > maxT || (nearest && t >= nearest.t)) return false;
      nearest = { t, entity };
      return false;
    });

    if (!nearest) return swept;
    const contactT = Math.max(0, nearest.t - 0.0001); // Leave a small separation so the shoved actor does not penetrate its victim.
    lastContact = { kind: 'knockback-fire-impact', label: labelFor(nearest.entity), corpse: isCorpse(nearest.entity), t: nearest.t };
    return {
      ...swept,
      x: mover.x + dx * contactT,
      y: mover.y + dy * contactT,
      blockedX: true,
      blockedY: true,
      blockedAt: { x: mover.x + dx * nearest.t, y: mover.y + dy * nearest.t },
      knockbackDescriptorOverride: { kind: 'fire', fireHazard: true, label: 'Burning ' + labelFor(nearest.entity) },
    };
  }

  function debugSnapshot() {
    return { installed: true, activeBurningCorpses: activeCorpses.size, lastContact: lastContact && { ...lastContact } };
  }

  window.BurningEntityHazards = Object.freeze({
    installed: true, isBurning, corpseFlameAmount, beginCorpse, tickCorpses,
    findTorchSource, resolveSweptImpact, debugSnapshot,
  });
})();
