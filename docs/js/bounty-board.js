(() => {
  'use strict';

  // Bounty board — hunt a named bandit captain, destroy his camp. A bounty
  // rides the same questProgress/setQuestStatus scaffold as a board/favor
  // task (kind: 'bounty' instead of 'board'/'favor'), so it needs no new
  // save fields either — questProgress is already part of
  // saveMemberWorldData()'s persisted blob, which is what makes a bounty
  // survive a reload despite bandit camps themselves being deliberately
  // session-only (see js/bandit-camps.js's own comment above
  // _banditCampInstances). Shape: { kind:'bounty', captainName, zoneId,
  // tier, rewardGold, postedDay }. Status: 'posted' (on the board) ->
  // 'available' (accepted, tracked on the map) -> 'completed' (that
  // captain's camp confirmed destroyed — paid out automatically, no
  // turn-in NPC needed, unlike board/favor tasks).
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/mount-system.js and
  // js/bandit-camps.js — reads window.BanditCamps/window.BanditCombat
  // directly (both already global) rather than through deps, matching how
  // js/bandit-camps.js itself reads window.BanditCombat.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const BOUNTY_RANK_LABELS = ['Petty', 'Notorious', 'Ruthless', 'Infamous'];
  const BOUNTY_REWARD_GOLD_BY_TIER = [80, 160, 280, 450];

  function _zoneHasAnyBounty(zoneId) {
    return Object.values(deps.getQuestProgress()).some(st =>
      st.progress?.kind === 'bounty' && st.progress.zoneId === zoneId
      && (st.status === 'posted' || st.status === 'available'));
  }
  // The live, accepted bounty (if any) targeting this zone -- used by
  // spawnBanditCamp to decide whether a freshly-generated camp there
  // needs its tier/captain forced to match a promise already posted.
  function _activeBountyForZone(zoneId) {
    for (const [id, st] of Object.entries(deps.getQuestProgress())) {
      if (st.progress?.kind === 'bounty' && st.progress.zoneId === zoneId && st.status === 'available') {
        return { id, ...st.progress };
      }
    }
    return null;
  }
  function hasActiveBounty() {
    return Object.values(deps.getQuestProgress()).some(st => st.progress?.kind === 'bounty' && (st.status === 'posted' || st.status === 'available'));
  }
  function getCurrentBountyPosting() {
    const entries = Object.entries(deps.getQuestProgress()).filter(([, st]) => st.progress?.kind === 'bounty' && st.status === 'posted');
    entries.sort((a, b) => (b[1].progress.postedDay || 0) - (a[1].progress.postedDay || 0));
    return entries[0] ? { id: entries[0][0], ...entries[0][1].progress } : null;
  }
  // Rolls a new wanted poster only when there's genuinely none up right
  // now (posted-but-unclaimed or accepted-but-unresolved both count) --
  // unlike the daily board notice, a bounty isn't superseded just
  // because a day passed; a captain stays wanted until someone claims
  // the poster or brings the camp down.
  function maybeRefreshBountyPosting() {
    if (hasActiveBounty()) return;
    generateBountyTask();
  }
  // Prefers naming a captain who already has a real, live camp
  // somewhere the player's already generated (adopting a real identity
  // outright, no future generation needs steering at all). Only when
  // NO zone currently has a live captain-led camp does it fall back to
  // rolling a fresh identity and pinning it for whichever zone gets
  // that camp generated next (see spawnBanditCamp's bountyPin check).
  function generateBountyTask() {
    const liveCandidates = [];
    for (const [zoneId, recs] of window.BanditCamps.campInstances) {
      if (_zoneHasAnyBounty(zoneId)) continue;
      for (const rec of recs) {
        if (rec.captainName && !window.BanditCamps.isCampCleared(rec)) liveCandidates.push({ zoneId, tier: rec.tier, captainName: rec.captainName });
      }
    }
    let target;
    if (liveCandidates.length) {
      target = liveCandidates[Math.floor(Math.random() * liveCandidates.length)];
    } else {
      const zoneIds = Object.keys(deps.WMAP_ZONE_LABELS).filter(z => !_zoneHasAnyBounty(z));
      if (!zoneIds.length) return null;
      const zoneId = zoneIds[Math.floor(Math.random() * zoneIds.length)];
      target = { zoneId, tier: Math.floor(Math.random() * BOUNTY_RANK_LABELS.length), captainName: window.BanditCombat.randomName('captain') };
    }
    const id = deps.makeTaskId();
    const task = {
      kind: 'bounty', captainName: target.captainName, zoneId: target.zoneId, tier: target.tier,
      rewardGold: BOUNTY_REWARD_GOLD_BY_TIER[target.tier], postedDay: deps.calendar.day,
    };
    deps.setQuestStatus(id, 'posted', task);
    return { id, ...task };
  }
  function takeBountyTask(taskId) {
    const st = deps.getQuestProgress()[taskId];
    if (!st || st.status !== 'posted' || st.progress?.kind !== 'bounty') return { ok: false, message: 'That bounty is no longer available.' };
    deps.setQuestStatus(taskId, 'available', {});
    deps.showToast(`🎯 Bounty accepted — hunt down ${st.progress.captainName} and destroy their camp.`, true);
    updateBountyTracking(); // populate the map marker right away if that camp's already known
    return { ok: true, message: 'Bounty added to your log.' };
  }
  // key: bounty taskId -> { zoneId, col, row, label } for the map/
  // minimap marker (see _drawWildernessMapOnCanvas's matching loop).
  const _bountyMarkers = new Map();
  // Zone-independent on purpose (unlike updateBanditCampBanners, which
  // only runs in the player's CURRENT zone) -- the bountied camp can be
  // anywhere, and isBanditCampCleared/rec lookups are already safely
  // zone-scoped internally (a zone with no cached view just reads as
  // "not cleared yet," never a false completion), so this can run
  // regardless of where the player currently is.
  const BOUNTY_TRACKING_CHECK_INTERVAL_S = 1;
  let _bountyTrackingAccum = 0;
  function updateBountyTracking(dt) {
    if (dt != null) {
      _bountyTrackingAccum += dt;
      if (_bountyTrackingAccum < BOUNTY_TRACKING_CHECK_INTERVAL_S) return;
      _bountyTrackingAccum = 0;
    }
    for (const [id, st] of Object.entries(deps.getQuestProgress())) {
      if (st.progress?.kind !== 'bounty') continue;
      if (st.status !== 'available') { _bountyMarkers.delete(id); continue; }
      const bounty = st.progress;
      const rec = (window.BanditCamps.campInstances.get(bounty.zoneId) || []).find(r => r.captainName === bounty.captainName);
      if (!rec) continue; // camp not generated/found yet -- no marker until then
      if (window.BanditCamps.isCampCleared(rec)) {
        deps.setQuestStatus(id, 'completed', {});
        deps.inventory.gold = (deps.inventory.gold || 0) + bounty.rewardGold;
        deps.showToast(`🎯 Bounty complete! ${bounty.captainName}'s camp is destroyed. +${bounty.rewardGold}g`, true);
        _bountyMarkers.delete(id);
        continue;
      }
      _bountyMarkers.set(id, {
        zoneId: bounty.zoneId,
        col: rec.instance.site.x + rec.instance.site.w / 2,
        row: rec.instance.site.y + rec.instance.site.h / 2,
        label: bounty.captainName,
      });
    }
  }

  window.BountyBoard = {
    init,
    RANK_LABELS: BOUNTY_RANK_LABELS,
    getCurrentPosting: getCurrentBountyPosting,
    maybeRefreshPosting: maybeRefreshBountyPosting,
    take: takeBountyTask,
    updateTracking: updateBountyTracking,
    activeBountyForZone: _activeBountyForZone,
    get markers() { return _bountyMarkers; },
  };
})();
