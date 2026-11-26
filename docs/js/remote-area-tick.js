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
  // projectiles in flight, and zones nobody has built on the host.

  const INTERVAL_S = 0.2;   // Same 5 Hz the far-wildlife coarse tick already uses.
  const MAX_DT_S = 0.6;     // No single coarse step is larger than this.
  let deps = null;
  let enabled = false;
  let accum = 0;
  const stats = { ticks: 0, skippedUnbuilt: 0, errors: 0, lastAreas: [] };

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

  function update(dt) {
    if (!enabled || !deps || !window.TimeConsensus?.shouldGate?.()) return;
    accum += Math.max(0, Number(dt) || 0);
    if (accum < INTERVAL_S) return;
    const step = Math.min(MAX_DT_S, accum);
    accum = 0;
    const scope = window.AreaScope;
    if (!scope) return;
    stats.lastAreas = [];
    for (const area of targetAreas()) {
      if (!scope.hasScene(area)) { stats.skippedUnbuilt++; continue; }
      try {
        scope.with(area, () => { deps.tickPre?.(step); deps.tickHostiles(step); }); // Bandit sleep/wake first, like the local order (camps pre-pass, then hostiles).
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
    getDebug: () => ({ enabled, ...stats, lastAreas: stats.lastAreas.slice() }),
    INTERVAL_S,
  };
})();
