(() => {
  'use strict';

  // RemoteAreaTick - stage 1 of ticking more than one area (MULTIPLAYER.md, "Ticking more than one area").
  //
  // Today the host simulates only creatures whose areaId is the LOCAL player's current area. A zone
  // that only a guest is standing in is kept alive (trimZoneCache) but frozen. With this on, every
  // OTHER occupied, already-built wilderness zone gets a coarse creature tick (5 Hz, accumulated dt)
  // inside AreaScope.with(area, ...): game.js swaps `currentArea` for the duration of the call, so the
  // existing area-keyed code (active grid/scene, area filters, area-aware targeting) runs unchanged
  // for that zone, while audio keeps hearing from the player's real area and no visuals are built.
  //
  // Safety rails:
  //  * OFF by default (opt in with ?remoteAreaTick=1, localStorage.hobunjiRemoteAreaTick='1', or
  //    RemoteAreaTick.setEnabled(true)), and does nothing unless 2+ players are registered, so
  //    single-player cannot be affected either way.
  //  * Only zones whose scene is already built: AreaScope.with refuses to build one as a side effect.
  //  * A throwing tick is caught and counted; `currentArea` is restored by AreaScope in a finally.
  //
  // Stage 2: also the bandit sleep/wake pass for that zone (WildernessSimulationLOD.tick), so a camp next
  // to a guest wakes. NPC walkers need nothing: the main loop already updates every walker whatever its area
  // (OffAreaNpcTick only coarsens, and only when no player is in the walker's area).
  //
  // Not yet scoped: the camp banner UI and Harlyao/Porakaneki camp planners (local-player/local-scene concerns,
  // wrapped onto BanditCamps.updateCampBanners, which must NOT be called here), den spawning, random encounters,
  // projectiles in flight. Stage 3: a zone nobody has built is built by the host (one per round, calm moments only),
  // then populated (dens, herds, nest trees, flocks) on entry and every 5 s; camps are not stamped remotely yet.

  const INTERVAL_S = 0.2;   // Same 5 Hz the far-wildlife coarse tick already uses.
  const MAX_DT_S = 0.6;     // No single coarse step is larger than this.
  let deps = null;
  let enabled = false;
  let accum = 0;
  const POPULATE_INTERVAL_S = 5;  // Den/herd top-up for a remote zone, like the local den check cadence.
  const stats = { ticks: 0, skippedUnbuilt: 0, built: 0, populated: 0, errors: 0, lastAreas: [] };
  const MAX_CALM_WAIT_S = 20; // After this long without a calm moment the zone is built anyway.
  const waitingSince = new Map(); // area -> seconds the build has been deferred waiting for a calm host.
  let building = false;
  let populateAccum = 0;
  const populated = new Set();

  try {
    enabled = new URLSearchParams(window.location?.search || '').get('remoteAreaTick') === '1'
      || window.localStorage?.getItem('hobunjiRemoteAreaTick') === '1';
  } catch (_) { enabled = false; }

  function init(nextDeps) { deps = nextDeps || null; }

  // Areas that should be ticked this round: occupied by a player, not the one this client is in.
  function targetAreas() {
    const reg = window.ActorRegistry;
    if (!reg) return [];
    const here = deps?.getCurrentArea?.();
    const out = [];
    for (const area of reg.occupiedAreas()) if (area !== here) out.push(area);
    return out;
  }

  // Frames the host must render before the (blocking) build starts so the notice is actually on screen.
  function afterPaint(callback) {
    const raf = window.requestAnimationFrame;
    if (typeof raf !== 'function') { callback(); return; }
    raf.call(window, () => raf.call(window, callback));
  }

  function startBuild(scope, area) {
    building = true;
    waitingSince.delete(area);
    try { deps.announce?.(area); } catch (error) { console.warn('[RemoteAreaTick] announce failed', error); }
    afterPaint(() => {
      try { if (scope.ensureScene(area)) stats.built++; }
      catch (error) { stats.errors++; console.warn('[RemoteAreaTick] build failed for', area, error); }
      finally { building = false; }
    });
  }

  function update(dt) {
    if (!enabled || !deps || !window.TimeConsensus?.shouldGate?.()) return;
    accum += Math.max(0, Number(dt) || 0);
    if (accum < INTERVAL_S) return;
    const step = Math.min(MAX_DT_S, accum);
    accum = 0;
    const scope = window.AreaScope;
    if (!scope) return;
    stats.lastAreas = [];
    populateAccum += step;
    const populateNow = populateAccum >= POPULATE_INTERVAL_S;
    if (populateNow) populateAccum = 0;
    for (const area of targetAreas()) {
      if (!scope.hasScene(area)) {
        // Stage 3: nobody has built this guest's zone on the host. The build is one synchronous multi-second call, so it never
        // runs inside this update: startBuild() tells the host why the game is about to stall, lets that paint, then builds.
        // One zone at a time, at a calm moment (bounded wait: a host stuck in combat must not leave the guest in a void).
        if (!building && scope.ensureScene) {
          const waitedS = (waitingSince.get(area) ?? (waitingSince.set(area, 0), 0)) + step;
          waitingSince.set(area, waitedS);
          if (deps.isCalm?.() !== false || waitedS >= MAX_CALM_WAIT_S) startBuild(scope, area);
        }
        stats.skippedUnbuilt++; continue;
      }
      try {
        scope.with(area, () => {
          if (populateNow || !populated.has(area)) { if (deps.populate?.()) { populated.add(area); stats.populated++; } }
          deps.tickPre?.(step); deps.tickHostiles(step); // Bandit sleep/wake first, like the local order (camps pre-pass, then hostiles).
        });
        stats.ticks++;
        stats.lastAreas.push(area);
      } catch (error) {
        stats.errors++;
        console.warn('[RemoteAreaTick] tick failed for', area, error);
      }
    }
  }

  window.RemoteAreaTick = {
    init, update, targetAreas,
    setEnabled(on) { enabled = !!on; accum = 0; return enabled; },
    isEnabled: () => enabled,
    isBuilding: () => building,
    getDebug: () => ({ enabled, ...stats, lastAreas: stats.lastAreas.slice() }),
    INTERVAL_S,
  };
})();
