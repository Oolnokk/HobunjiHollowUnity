// Releases an old zone's bandits so the zone cache can evict it.
//
// game.js's trimZoneCache keeps only the current zone and the most recent
// inactive one built (about 170 MB each) and evicts the rest. Ordinary
// creatures stop blocking that by dropping to plain data, but a bandit cannot:
// it has its own async rig builder, so zoneEvictionBlocker treats every bandit
// (alive or dead) as a resident rig and pins its whole zone forever. Measured
// in a headless run through four wilderness zones, one or two idle bandits per
// zone were enough to keep all four built and the JS heap went from 319 MB to
// 1,026 MB, about 175 MB per zone that is never freed.
//
// A zone this old is not being played in, and updateHostiles only ticks the
// current area, so its bandits are frozen anyway. This removes them through the
// same path a discarded mine floor or room uses (leave the hostile list, then
// despawnCreature), and then forgets the zone's camp state. That second step is
// required: a camp only counts as cleared when its tents AND bandits are gone,
// so deleting the bandits alone would bring the camp back empty. With the camp
// state forgotten, ensureCurrentZoneBanditCamps re-seeds it fresh on the next
// entry, the same reset a zone reshape already performs.
//
// The cost is gameplay-visible: returning to a zone left two zones ago shows
// fresh camps (wounded or killed bandits are restored, un-looted bodies are
// gone). Turn it off with SCRATCHBONES_CONFIG.game.zoneCache.releaseBandits = false.
(() => {
  'use strict';

  let deps = null;

  function init(injected) {
    deps = injected;
  }

  function enabled() {
    return window.SCRATCHBONES_CONFIG?.game?.zoneCache?.releaseBandits !== false;
  }

  function isBanditFamily(c) {
    return c?.isBandit === true || c?.banditCompanion === true;
  }

  // Mirrors zoneEvictionBlocker's test for a resident that pins its zone.
  function isPinning(c) {
    return !c._wildlifeVisualsReleased && !c.isCompanion;
  }

  // Returns how many bandits were released. Does nothing unless bandits are the
  // ONLY thing pinning the zone: releasing them while something else (a maskbound
  // troop, a dying body, a revivable skeleton) still pins it would reset the camps
  // for no benefit.
  function releaseZone(mapId) {
    if (!deps || !enabled() || mapId === deps.getCurrentArea()) return 0;
    const residents = deps.zoneResidents(mapId);
    const pinning = residents.filter(isPinning);
    if (!pinning.length || !pinning.every(isBanditFamily)) return 0;
    const bandits = residents.filter(isBanditFamily);
    for (const c of bandits) {
      deps.hostileObjects.delete(c);
      deps.corpseObjects.delete(c);
      deps.companionObjects?.delete(c);
      try {
        deps.despawnCreature(c); // Rig, shadow, weapon holders, rings and vocalization tracking.
      } catch (error) {
        window.__farmLog?.(`[zone-cache] could not fully despawn a bandit in ${mapId}: ${error?.message || error}`, 'perf');
      }
    }
    deps.forgetCampState(mapId); // Camps re-seed on the next entry.
    window.__farmLog?.(`[zone-cache] released ${bandits.length} bandit(s) from ${mapId}; its camps re-seed on the next visit`, 'perf');
    return bandits.length;
  }

  window.ZoneBanditRelease = { init, releaseZone, isBanditFamily };
})();
