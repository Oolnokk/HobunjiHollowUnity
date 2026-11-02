// Companion locomotion follows the current movement pace of its owner.
// Player speed is composed from the same live movement systems used by the game;
// NPC-owned companions use the owner's live speed when exposed, or measured
// movement from the owner's position when its adapter is position-only.
(() => {
  'use strict';

  const DEFAULT_OWNER_SPEED_RATIO = 1; // Used when a companion has no explicit owner-speed percentage: 100% of its owner's pace.
  const DEFAULT_PLAYER_MOVE_SPEED = 238; // Matches game.js's ordinary MOVE_SPEED fallback used by the alcohol locomotion bridge.
  const FOOTING_SPEED_MIN = 0.55; // Matches the player's low-Footing movement floor in alcohol-gameplay-bridge.js.

  let deps = null; // Combat.init supplies the live player, map, and companion collection.
  let frameHandle = null; // Owns the one requestAnimationFrame scan that discovers newly spawned companions.
  let lastError = null; // Exposed through debugSnapshot so mobile testing does not require devtools.
  const entityBindings = new WeakMap(); // Tracks each companion's installed per-entity def proxy without mutating shared species definitions.
  const ownerMotion = new WeakMap(); // Remembers the latest measured NPC/remote-owner speed for position-only master adapters.
  const trackedCompanions = new Set(); // Supplies compact mobile diagnostics for currently active companion entities.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));

  function safeNumber(read, fallback = 1) {
    try {
      const value = typeof read === 'function' ? read() : read;
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    } catch (error) {
      lastError = String(error?.message || error);
      return fallback;
    }
  }

  function multiplier(read, fallback = 1) {
    return Math.max(0, safeNumber(read, fallback));
  }

  function playerTerrainMultiplier(player) {
    const tileSize = Math.max(1, Number(deps?.TILE) || 55);
    const grid = deps?.getActiveGrid?.();
    const col = Math.floor((Number(player?.x) || 0) / tileSize);
    const row = Math.floor((Number(player?.y) || 0) / tileSize);
    const tile = grid?.[row]?.[col];
    if (!tile || tile.incline) return 1;
    return tile.type === 'river' || tile.type === 'stream' ? 0.5 : 1;
  }

  function playerFootingMultiplier(player) {
    const drunkenFooting = Math.max(0, Number(player?.afflictions?.drunkenFooting) || 0);
    if (!(drunkenFooting > 0)) return 1; // The game's Footing pace penalty is part of drunken locomotion, not a general low-Footing penalty.
    const baseMax = Math.max(0, Number(player?.maxFooting) || 0);
    if (!(baseMax > 0)) return 1;
    const effectiveMax = Math.max(0, Number(window.ResourceSystem?.getEffectiveMax?.(player, 'footing')) || baseMax);
    const footing = Math.max(0, Number(player?.footing) || 0);
    const fraction = effectiveMax > 0 ? clamp(footing / effectiveMax, 0, 1) : 1;
    return FOOTING_SPEED_MIN + (1 - FOOTING_SPEED_MIN) * fraction;
  }

  function alchemyMovementMultiplier() {
    const direct = deps?.getAlchemySpeedMul;
    return multiplier(
      typeof direct === 'function'
        ? () => direct()
        : () => window.AlchemySystem?.getMovementSpeedMultiplier?.() ?? window.AlchemySystem?.getSpeedMul?.(),
      1
    );
  }

  function generalMovementMultiplier() {
    // These public multipliers cover food, potion, combat, equipment, and timed movement effects.
    return multiplier(() => window.CookingSystem?.getSpeedMultiplier?.(), 1)
      * multiplier(() => window.Combat?.getMovementSpeedMul?.(), 1)
      * multiplier(() => window.AlchemySystem?.getMovementSpeedMultiplier?.() ?? window.AlchemySystem?.getSpeedMul?.(), 1);
  }

  function playerMovementSpeed(player) {
    if (!player) return 0;
    const mounts = window.Mounts;
    const rideState = String(mounts?.rideState || '');
    const mountActive = ['mounted', 'mountingUp', 'climbLeap'].includes(rideState) && !!mounts?.rideEntity;
    const alchemy = alchemyMovementMultiplier();
    const devGlobal = multiplier(deps?.getDevGlobalSpeedMul, 1);
    const general = generalMovementMultiplier();

    if (mountActive) {
      const mount = mounts.rideEntity;
      const actualVelocity = Math.hypot(Number(mount?.vx) || 0, Number(mount?.vy) || 0);
      if (actualVelocity > 0.5) return actualVelocity; // Mounted velocity already contains acceleration, collision, and every modifier applied by Mounts.
      const base = Math.max(0, Number(mount?.def?.mountSpeed) || Number(deps?.MOVE_SPEED) || DEFAULT_PLAYER_MOVE_SPEED);
      const perception = multiplier(() => window.PerceptionMode?.speedMultiplier?.(), 1);
      return base * alchemy * devGlobal * perception; // Match updateMountedMovement's actual top-speed composition while stationary. 
    }

    const base = Math.max(0, Number(deps?.MOVE_SPEED) || DEFAULT_PLAYER_MOVE_SPEED);
    return base
      * playerTerrainMultiplier(player)
      * general
      * devGlobal
      * playerFootingMultiplier(player);
  }

  function ownerPosition(owner, walker) {
    const x = Number.isFinite(Number(owner?.x)) ? Number(owner.x) : Number(walker?.root?.position?.x);
    const y = Number.isFinite(Number(owner?.y)) ? Number(owner.y) : Number(walker?.root?.position?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const tileCoordinates = !Number.isFinite(Number(owner?.x)) && !!walker?.root?.position;
    return { x, y, scale: tileCoordinates ? Math.max(1, Number(deps?.TILE) || 32) : 1 };
  }

  function sampleOwnerMotion(owner, walker = null) {
    const position = ownerPosition(owner, walker);
    if (!position) return 0;
    const now = safeNumber(() => performance.now(), Date.now());
    const previous = ownerMotion.get(owner);
    let measuredSpeed = 0;

    if (previous) {
      const elapsedS = Math.max(0, (now - previous.at) / 1000);
      const sameScale = previous.scale === position.scale;
      if (elapsedS > 0.005 && sameScale) {
        const distance = Math.hypot(position.x - previous.x, position.y - previous.y) * position.scale;
        if (distance > 0.02) measuredSpeed = distance / elapsedS;
      }
    }

    const record = previous || { x: position.x, y: position.y, scale: position.scale, at: now, speed: 0, baseSpeed: 0 };
    record.x = position.x;
    record.y = position.y;
    record.scale = position.scale;
    record.at = now;
    const ownerMul = Math.max(0.001, npcMovementMultiplier(owner));
    if (measuredSpeed > 0.5) record.baseSpeed = measuredSpeed / ownerMul;
    record.speed = Math.max(0, record.baseSpeed * npcMovementMultiplier(owner)); // Reapply the live NPC movement modifier even while the owner is standing still.
    ownerMotion.set(owner, record);
    return record.speed;
  }

  function findNpcWalker(owner) {
    const id = String(owner?.npcId || owner?.rec?.id || '');
    if (!id) return null;
    const walkers = window._npcWalkers;
    if (walkers instanceof Map) return walkers.get(id) || null;
    if (Array.isArray(walkers)) {
      return walkers.find(walker => String(walker?.rec?.id || '') === id) || null;
    }
    return null;
  }

  function npcMovementMultiplier(owner) {
    const explicit = Number(owner?.movementSpeedMultiplier);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    const id = owner?.npcId || owner?.rec?.id;
    if (!id) return 1;
    return multiplier(() => window.NpcCharacterState?.movementSpeedMultiplier?.(id)
      ?? window.HobunjiDrunkGameplayBridge?.npcSpeedMultiplier?.(id), 1);
  }

  function directActorSpeed(owner, speedKind) {
    if (!owner) return 0;
    const current = [
      owner.currentMovementSpeedPxS,
      owner.movementSpeedPxS,
      owner.moveSpeedPxS,
      owner.currentSpeedPxS,
    ].map(Number).find(value => Number.isFinite(value) && value > 0);
    if (current) return current;

    const explicit = Number(owner[speedKind]);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const def = owner.def;
    if (!def) return 0;
    const state = String(owner.state || owner.activity || '').toLowerCase();
    const chasing = /chase|combat|pursuit|running/.test(state);
    const candidates = speedKind === 'chaseSpeed' || chasing
      ? [def.chaseSpeed, def.moveSpeed]
      : [def.moveSpeed, def.chaseSpeed];
    const base = candidates.map(Number).find(value => Number.isFinite(value) && value > 0);
    return base ? base * npcMovementMultiplier(owner) : 0;
  }

  function walkerMovementSpeed(walker, master) {
    if (!walker) return 0;
    const tileSize = Math.max(1, Number(deps?.TILE) || 32);
    const currentTilesPerSecond = Number(walker._moveSpeedTiles);
    if (Number.isFinite(currentTilesPerSecond) && currentTilesPerSecond > 0) {
      sampleOwnerMotion(master || walker, walker); // Keep a normalized catch-up pace ready for frames when the NPC is stationary or action-locked.
      return currentTilesPerSecond * tileSize;
    }

    const explicitPx = [
      walker.currentMovementSpeedPxS,
      walker.movementSpeedPxS,
      walker.moveSpeedPxS,
      walker.rec?.walkSpeedPxS,
      walker.rec?.moveSpeedPxS,
    ].map(Number).find(value => Number.isFinite(value) && value > 0);
    if (explicitPx) return explicitPx;

    const explicitTiles = [
      walker.moveSpeedTilesPerSecond,
      walker.walkSpeedTilesPerSecond,
      walker.rec?.moveSpeedTilesPerSecond,
      walker.rec?.walkSpeedTilesPerSecond,
    ].map(Number).find(value => Number.isFinite(value) && value > 0);
    if (explicitTiles) return explicitTiles * tileSize * Math.max(0, Number(walker.catchup) || 1);

    return sampleOwnerMotion(master || walker, walker);
  }

  function ownerMovementSpeed(companion, speedKind) {
    const owner = companion?.master || deps?.player;
    if (!owner) return 0;
    if (owner === deps?.player) return playerMovementSpeed(owner);

    const directSpeed = directActorSpeed(owner, speedKind);
    if (directSpeed > 0) return directSpeed;

    const walker = findNpcWalker(owner);
    const liveWalkerSpeed = walkerMovementSpeed(walker, owner);
    if (liveWalkerSpeed > 0) return liveWalkerSpeed;

    const measuredSpeed = sampleOwnerMotion(owner);
    if (measuredSpeed > 0) return measuredSpeed;
    return 0;
  }

  function ownerSpeedRatio(companion) {
    const configured = Number(companion?.ownerMovementSpeedPercent);
    const ratio = Number.isFinite(configured) ? configured / 100 : DEFAULT_OWNER_SPEED_RATIO;
    return Math.max(0, ratio);
  }

  function applyCompanionProxy(companion) {
    if (!companion?.isCompanion || companion.stableRole === 'mount' || !companion.def || typeof companion.def !== 'object') return false;
    const existing = entityBindings.get(companion);
    if (existing?.source === companion.def) return true;

    const source = companion.def;
    const proxy = new Proxy(source, {
      get(target, property, receiver) {
        const originalValue = Reflect.get(target, property, receiver);
        if (property !== 'moveSpeed' && property !== 'chaseSpeed') return originalValue;
        const baseline = Number(originalValue);
        if (!Number.isFinite(baseline) || baseline <= 0) return originalValue;
        const speed = ownerMovementSpeed(companion, String(property));
        if (!(speed > 0)) return originalValue;
        const ratio = ownerSpeedRatio(companion);
        const resolved = speed * ratio;
        companion._companionMovementSpeedDebug = {
          ownerId: companion.master?.npcId || companion.master?.id || 'player',
          ownerSpeedPxS: speed,
          ownerSpeedPercent: ratio * 100,
          property: String(property),
          baseSpeciesSpeedPxS: baseline,
          resolvedSpeedPxS: resolved,
        };
        return resolved;
      },
    });

    companion.def = proxy;
    entityBindings.set(companion, { source, proxy });
    trackedCompanions.add(companion);
    return true;
  }

  function update() {
    if (!deps?.companionObjects || typeof deps.companionObjects[Symbol.iterator] !== 'function') return 0;
    const active = deps.companionObjects;
    let count = 0;
    for (const companion of active) {
      if (!companion?.isCompanion || companion.stableRole === 'mount') continue;
      if (applyCompanionProxy(companion)) count++;
    }
    for (const companion of [...trackedCompanions]) {
      if (!active.has?.(companion)) trackedCompanions.delete(companion);
    }
    return count;
  }

  function scheduleFrame() {
    if (frameHandle != null || typeof window.requestAnimationFrame !== 'function') return;
    frameHandle = window.requestAnimationFrame(() => {
      frameHandle = null;
      try {
        update();
      } catch (error) {
        lastError = String(error?.message || error);
      }
      scheduleFrame();
    });
  }

  function init(injectedDeps) {
    if (injectedDeps && typeof injectedDeps === 'object') deps = injectedDeps;
    update();
    scheduleFrame();
  }

  function debugSnapshot() {
    return {
      initialized: !!deps,
      companionCount: trackedCompanions.size,
      companions: [...trackedCompanions].slice(0, 12).map(companion => ({
        id: companion.id || companion.name || companion.creatureKey || 'companion',
        stableRole: companion.stableRole || null,
        master: companion.master?.npcId || companion.master?.id || (companion.master === deps?.player ? 'player' : 'unresolved'),
        speed: companion._companionMovementSpeedDebug || null,
      })),
      lastError,
    };
  }

  function install() {
    const combat = window.Combat;
    if (!combat || typeof combat.init !== 'function') return false;
    if (combat.init.__companionMovementSpeedWrapped) return true;
    const originalInit = combat.init.bind(combat);
    const wrappedInit = function companionMovementSpeedCombatInit(injectedDeps, ...rest) {
      const result = originalInit(injectedDeps, ...rest);
      init(injectedDeps);
      return result;
    };
    wrappedInit.__companionMovementSpeedWrapped = true;
    wrappedInit.__companionMovementSpeedOriginal = originalInit;
    combat.init = wrappedInit;
    if (combat.deps) init(combat.deps);
    return true;
  }

  const api = Object.freeze({
    init,
    install,
    update,
    debugSnapshot,
    __test: Object.freeze({
      playerMovementSpeed,
      ownerMovementSpeed,
      sampleOwnerMotion,
      applyCompanionProxy,
      playerTerrainMultiplier,
      playerFootingMultiplier,
      ownerSpeedRatio,
    }),
  });

  window.CompanionMovementSpeed = api;
  install();
})();
