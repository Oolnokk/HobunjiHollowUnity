(() => {
  'use strict';

  // Wilderness simulation LOD.
  //
  // Bandits intentionally reuse game.js's generic hostileObjects loop. That
  // is convenient for combat/death/loot, but it also means every idle gang
  // member in the current wilderness zone pays the full per-frame hostile
  // update cost (resource tick, distance checks, wander AI, avatar rotation,
  // weapon pose and animation) even when the player is nowhere near its camp.
  //
  // Keep that shared combat pipeline untouched. BanditCamps already receives
  // the shared hostileObjects/player/current-area dependencies through init(),
  // so this small adapter temporarily moves only FAR + COMPLETELY IDLE bandits
  // onto a non-current area id. updateHostiles' existing area guard then skips
  // them for free. They wake well before their normal 6-8 tile aggro radius.
  // Anything state-sensitive (combat, returning home, hit reactions, prone,
  // active attacks) is never put to sleep.

  const BANDIT_WAKE_RADIUS_TILES = 14; // Used to wake sleeping bandits before the player can reach normal aggro range.
  const BANDIT_SLEEP_RADIUS_TILES = 18; // Used as a hysteresis gap so bandits do not flap awake/asleep near one threshold.
  const BANDIT_LOD_CHECK_INTERVAL_S = 0.25; // Used to keep the distance-management pass cheap while still waking four times per second.
  const SLEEP_AREA_PREFIX = '__wilderness_lod_sleep__:'; // Used to make game.js's existing current-area hostile guard skip sleeping entities.

  let deps = null; // Captures BanditCamps' already-existing shared game dependencies without adding another game.js injection point.
  let lodAccum = BANDIT_LOD_CHECK_INTERVAL_S; // Forces one sleep/wake pass immediately after BanditCamps begins updating.
  let sleepTransitions = 0; // Used by the mobile-accessible snapshot diagnostics to verify that LOD is actually engaging.
  let wakeTransitions = 0; // Used by the mobile-accessible snapshot diagnostics to verify that sleepers wake again.

  const banditCamps = window.BanditCamps; // Public camp namespace patched narrowly at its existing init/update seam.
  if (!banditCamps || typeof banditCamps.init !== 'function' || typeof banditCamps.updateCampBanners !== 'function') {
    console.warn('[wilderness-lod] BanditCamps unavailable; distant-bandit sleeping disabled.');
    return;
  }

  const originalInit = banditCamps.init.bind(banditCamps); // Preserves BanditCamps' original dependency initialization behavior.
  const originalUpdateCampBanners = banditCamps.updateCampBanners.bind(banditCamps); // Preserves the existing camp-banner update after the LOD pre-pass.

  function actualAreaId(c) {
    return c?._wildernessLodAreaId || c?.areaId || null;
  }

  function distanceTilesToPlayer(c) {
    if (!deps?.player || !deps?.TILE) return Infinity;
    const dx = c.x - deps.player.x;
    const dy = c.y - deps.player.y;
    return Math.hypot(dx, dy) / deps.TILE;
  }

  function isSleeping(c) {
    return !!c?._wildernessLodSleeping;
  }

  function canSleepBandit(c) {
    if (!c?.isBandit || c.health <= 0) return false;
    // Restrict sleeping to the genuinely quiescent state. A bandit that is
    // chasing, retreating, returning home, staggered, knocked down, guarding,
    // lunging, swinging, or still settling its weapon pose keeps the normal
    // full-rate hostile update until that state has resolved naturally.
    if (c.state !== 'idle') return false;
    if (c.prone || (c.knockbackT || 0) > 0 || (c.retreatT || 0) > 0) return false;
    if (c._banditAction || c._banditLunging || c.telegraphState) return false;
    if (performance.now() < (c._banditToolSettleUntil || 0)) return false;
    return true;
  }

  function setBanditVisuals(c, visible) {
    if (c.avatarRef?.group) c.avatarRef.group.visible = visible;
    if (c.groundShadow) c.groundShadow.visible = visible;
    if (c._banditToolHolder) c._banditToolHolder.visible = visible;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = visible && !!c._rangedMode;
    // A sleeper is only eligible from true idle, so an active trail should
    // never normally exist here. Hiding a stale one defensively avoids a
    // detached effect hanging at a camp while its owner is asleep.
    if (!visible && c._banditTrailMesh) c._banditTrailMesh.visible = false;
  }

  function releaseBanditReservations(c) {
    // Attack-slot / queue-ring arrays are module-owned, but their public
    // getters intentionally expose the live arrays for the combat diagnostics.
    // An idle sleeper must not keep reserving a melee slot while absent from
    // simulation, so remove any stale reservation before it goes dormant.
    for (const list of [window.BanditCombat?.attackSlots, window.BanditCombat?.queueRings]) {
      if (!Array.isArray(list)) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]?.bandit === c) list.splice(i, 1);
      }
    }
  }

  function sleepBandit(c) {
    if (isSleeping(c)) return;
    c._wildernessLodAreaId = c.areaId;
    c._wildernessLodSleeping = true;
    c.areaId = SLEEP_AREA_PREFIX + c._wildernessLodAreaId;
    c.vx = 0;
    c.vy = 0;
    releaseBanditReservations(c);
    setBanditVisuals(c, false);
    sleepTransitions++;
  }

  function wakeBandit(c) {
    if (!isSleeping(c)) return;
    c.areaId = c._wildernessLodAreaId;
    c._wildernessLodSleeping = false;
    setBanditVisuals(c, true);
    wakeTransitions++;
  }

  function updateBanditLod(dt) {
    if (!deps?.hostileObjects || !deps?.getCurrentArea) return;
    lodAccum += Math.max(0, Number(dt) || 0);
    if (lodAccum < BANDIT_LOD_CHECK_INTERVAL_S) return;
    lodAccum = 0;

    const currentArea = deps.getCurrentArea();
    for (const c of deps.hostileObjects) {
      if (!c?.isBandit || c.health <= 0) continue;
      const areaId = actualAreaId(c);

      // A bandit from some other cached zone is already excluded by
      // updateHostiles' normal area check. Do not rewrite its visibility;
      // its whole scene is inactive anyway, and this avoids fighting zone
      // teardown/re-entry ownership.
      if (areaId !== currentArea) continue;

      const distTiles = distanceTilesToPlayer(c);
      if (isSleeping(c)) {
        if (distTiles <= BANDIT_WAKE_RADIUS_TILES || !canSleepBandit(c)) wakeBandit(c);
        continue;
      }
      if (distTiles >= BANDIT_SLEEP_RADIUS_TILES && canSleepBandit(c)) sleepBandit(c);
    }
  }

  banditCamps.init = function wildernessLodBanditCampsInit(injectedDeps) {
    deps = injectedDeps;
    const result = originalInit(injectedDeps);
    window.__farmLog?.(`[wilderness-lod] distant idle bandits sleep beyond ${BANDIT_SLEEP_RADIUS_TILES} tiles and wake within ${BANDIT_WAKE_RADIUS_TILES} tiles.`, 'info');
    return result;
  };

  banditCamps.updateCampBanners = function wildernessLodBanditCampUpdate(dt) {
    // game.js calls updateCampBanners immediately before updateHostiles, so
    // this is a clean pre-pass: sleepers have their non-current area id in
    // place before the expensive shared hostile loop reaches them.
    updateBanditLod(dt);
    return originalUpdateCampBanners(dt);
  };

  function snapshot() {
    let total = 0;
    let sleeping = 0;
    let totalWildlife = 0; // Reports non-bandit wildlife retained in the logical simulation.
    let visuallySleepingWildlife = 0; // Reports wildlife currently omitted from rendering/visual-rig work by game.js.
    if (deps?.hostileObjects) {
      for (const c of deps.hostileObjects) {
        if (!c || c.health <= 0) continue;
        if (c.isBandit) {
          total++;
          if (isSleeping(c)) sleeping++;
        } else {
          totalWildlife++;
          if (c._wildlifeVisualLodHidden) visuallySleepingWildlife++;
        }
      }
    }
    return {
      totalBandits: total,
      sleepingBandits: sleeping,
      activeBandits: total - sleeping,
      totalWildlife,
      visuallySleepingWildlife,
      visuallyActiveWildlife: totalWildlife - visuallySleepingWildlife,
      sleepTransitions,
      wakeTransitions,
      wakeRadiusTiles: BANDIT_WAKE_RADIUS_TILES,
      sleepRadiusTiles: BANDIT_SLEEP_RADIUS_TILES,
      checkIntervalSeconds: BANDIT_LOD_CHECK_INTERVAL_S,
    };
  }

  window.WildernessSimulationLOD = { snapshot };
  window.__wildernessLodDebug = snapshot;
})();
