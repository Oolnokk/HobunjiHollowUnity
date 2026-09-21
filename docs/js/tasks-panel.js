(() => {
  'use strict';

  // Tasks tab (board requests + accepted NPC favors + active bounty).
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems.
  let deps = null;

  // The bounty board owns captain/camp semantics, but this module loads after it
  // and before game.js initializes either system. Capture the same injected
  // bounty deps and extend the public board API with two persistent offer slots
  // without changing the captain-name forge or the camp-pinning contract.
  const BOUNTY_REWARD_GOLD_BY_TIER = [80, 160, 280, 450];
  const EASY_BOUNTY_TIERS = Object.freeze([0, 1]);
  const HARD_BOUNTY_TIERS = Object.freeze([2, 3]);
  let bountyDeps = null;
  let bountyGangConfigPromise = null;
  let bountyOfferRefreshPromise = null;
  let lastRenderDebug = null; // Used by getDebug() and the mobile-visible Quest Log diagnostic row.

  function _bountySlotForTier(tier) {
    const n = Math.max(0, Math.floor(Number(tier) || 0));
    return n <= 1 ? 'easy' : 'hard';
  }

  function _postedBounties() {
    if (!bountyDeps) return [];
    return Object.entries(bountyDeps.getQuestProgress())
      .filter(([, st]) => st.progress?.kind === 'bounty' && st.status === 'posted')
      .map(([id, st]) => ({ id, ...st.progress }));
  }

  function _zoneHasAnyBounty(zoneId) {
    if (!bountyDeps) return false;
    return Object.values(bountyDeps.getQuestProgress()).some(st =>
      st.progress?.kind === 'bounty'
      && st.progress.zoneId === zoneId
      && (st.status === 'posted' || st.status === 'available'));
  }

  function _weightedSpeciesPick(weights) {
    const entries = Object.entries(weights || {})
      .filter(([key, value]) => !key.startsWith('_') && Number(value) > 0);
    if (!entries.length) return null;
    const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
    let roll = Math.random() * total;
    for (const [speciesId, value] of entries) {
      roll -= Number(value);
      if (roll <= 0) return speciesId;
    }
    return entries[entries.length - 1][0];
  }

  function _loadBountyGangConfig() {
    if (!bountyGangConfigPromise) bountyGangConfigPromise = window.BanditCombat.loadGangConfig();
    return bountyGangConfigPromise;
  }

  function _randomFrom(values) {
    return values[Math.floor(Math.random() * values.length)];
  }

  function _makeBountyForSlot(slot, tiers, cfg) {
    if (!bountyDeps) return null;
    const alreadyPosted = _postedBounties().some(posting => _bountySlotForTier(posting.tier) === slot);
    if (alreadyPosted) return null;

    // Prefer a real, currently spawned captain whose actual camp tier belongs
    // to this offer slot. A hard live camp can never accidentally fill Easy,
    // or vice versa.
    const liveCandidates = [];
    for (const [zoneId, recs] of window.BanditCamps?.campInstances || []) {
      if (_zoneHasAnyBounty(zoneId)) continue;
      for (const rec of recs || []) {
        const tier = Math.max(0, Math.floor(Number(rec.tier) || 0));
        if (!tiers.includes(tier) || !rec.captainName || window.BanditCamps.isCampCleared(rec)) continue;
        liveCandidates.push({
          zoneId,
          tier,
          captainName: rec.captainName,
          captainSpeciesId: rec.captainSpeciesId || null,
          captainGender: rec.captainGender || null,
          captainNameSeed: rec.captainNameSeed || null,
        });
      }
    }

    let target = liveCandidates.length ? _randomFrom(liveCandidates) : null;
    if (!target) {
      const forge = window.BanditNameForge;
      if (!forge || !cfg) {
        bountyDeps.debugLog?.(`[bounties] Cannot fill ${slot} offer: captain name forge or gang config unavailable.`, 'warn');
        return null;
      }
      const zoneIds = Object.keys(bountyDeps.WMAP_ZONE_LABELS || {}).filter(zoneId => !_zoneHasAnyBounty(zoneId));
      if (!zoneIds.length) {
        bountyDeps.debugLog?.(`[bounties] Cannot fill ${slot} offer: every wilderness zone already has a posted/accepted bounty.`, 'warn');
        return null;
      }
      const speciesId = _weightedSpeciesPick(cfg.speciesWeights) || 'mao-ao';
      const seedRecord = forge.generateNicknameOnly();
      const identity = forge.generateCaptainIdentity({
        speciesId,
        seed: seedRecord.seed,
        nicknameOnlyChance: 0,
      });
      target = {
        zoneId: _randomFrom(zoneIds),
        tier: _randomFrom(tiers),
        captainName: identity.display,
        captainSpeciesId: identity.speciesId,
        captainGender: identity.gender,
        captainNameSeed: identity.seed,
      };
    }

    const id = bountyDeps.makeTaskId();
    const task = {
      kind: 'bounty',
      offerSlot: slot,
      captainName: target.captainName,
      captainSpeciesId: target.captainSpeciesId || null,
      captainGender: target.captainGender || null,
      captainNameSeed: target.captainNameSeed || null,
      zoneId: target.zoneId,
      tier: target.tier,
      rewardGold: BOUNTY_REWARD_GOLD_BY_TIER[target.tier],
      postedDay: bountyDeps.calendar.day,
    };
    bountyDeps.setQuestStatus(id, 'posted', task);
    bountyDeps.debugLog?.(`[bounties] Posted ${slot} offer: ${task.captainName}, tier ${task.tier + 1}, ${task.zoneId}.`, 'info');
    return { id, ...task };
  }

  async function _ensureBountyOfferSlots() {
    if (!bountyDeps) return;
    if (bountyOfferRefreshPromise) return bountyOfferRefreshPromise;
    bountyOfferRefreshPromise = (async () => {
      const cfg = await _loadBountyGangConfig();
      _makeBountyForSlot('easy', EASY_BOUNTY_TIERS, cfg);
      _makeBountyForSlot('hard', HARD_BOUNTY_TIERS, cfg);
    })().finally(() => { bountyOfferRefreshPromise = null; });
    return bountyOfferRefreshPromise;
  }

  function _installMultiBountyOffers() {
    const board = window.BountyBoard;
    if (!board?.init || board.__twoTierOfferSlotsInstalled) return;
    const originalInit = board.init;
    board.init = function(injectedDeps) {
      bountyDeps = injectedDeps;
      const result = originalInit.call(board, injectedDeps);
      void _ensureBountyOfferSlots();
      return result;
    };
    board.getCurrentPostings = function() {
      return _postedBounties().sort((a, b) => {
        const slotDiff = (_bountySlotForTier(a.tier) === 'easy' ? 0 : 1) - (_bountySlotForTier(b.tier) === 'easy' ? 0 : 1);
        if (slotDiff) return slotDiff;
        return (a.tier - b.tier) || ((b.postedDay || 0) - (a.postedDay || 0));
      });
    };
    // Preserve the old accessor for any code that only understands one posting.
    board.getCurrentPosting = function() { return board.getCurrentPostings()[0] || null; };
    board.maybeRefreshPosting = _ensureBountyOfferSlots;
    board.__twoTierOfferSlotsInstalled = true;
  }
  _installMultiBountyOffers();

  function init(injectedDeps) {
    deps = injectedDeps;
    _installBanditCampDangerSubtitle();
  }

  // Used by bounty rows below so newly persisted captain gender is reflected
  // in copy; old saves without that field deliberately fall back to neutral
  // pronouns rather than guessing.
  function bountyPronouns(task) {
    if (task?.captainGender === 'male') return { object: 'him', possessive: 'his' };
    if (task?.captainGender === 'female') return { object: 'her', possessive: 'her' };
    return { object: 'them', possessive: 'their' };
  }

  // Bandit difficulty tiers are stored zero-based (0..3 today), while the
  // player-facing danger marks are one-based: X, XX, XXX, XXXX. Keeping this
  // in one helper ensures wanted posters, accepted bounties and camp-entry
  // title cards all speak the exact same visual language.
  function banditDifficulty(tier) {
    const numericTier = Math.max(0, Math.floor(Number(tier) || 0));
    const label = window.BountyBoard?.RANK_LABELS?.[numericTier] || `Tier ${numericTier + 1}`;
    return { label, marks: 'X'.repeat(numericTier + 1) };
  }

  function dangerRatingMarkup(tier) {
    const danger = banditDifficulty(tier);
    return `<span>${deps.esc(danger.label)}</span> <span aria-label="${danger.marks.length} danger marks" style="font-family:'KhymeryyanRomanLetters+Numbers','Pixelify Sans',monospace;font-size:1.18em;letter-spacing:0.08em;font-weight:700;">${danger.marks}</span>`;
  }

  // The shared zone-banner API intentionally remains a simple one-line title.
  // Rather than broadening game.js just for bandit camps, wrap the public camp
  // banner update and append a second line only when that update has revealed a
  // live camp title. Calling showZoneBanner again replaces textContent, which
  // naturally removes an old subtitle before this wrapper adds the new one.
  function _installBanditCampDangerSubtitle() {
    const camps = window.BanditCamps;
    if (!camps?.updateCampBanners || camps.__dangerSubtitleInstalled) return;
    const originalUpdate = camps.updateCampBanners;

    camps.updateCampBanners = function(dt) {
      const result = originalUpdate.call(camps, dt);
      const banner = document.getElementById('zoneBanner');
      if (!banner?.classList.contains('show') || banner.querySelector('[data-bandit-danger-subtitle]')) return result;

      const shownTitle = banner.textContent.trim();
      let matchedCamp = null;
      for (const recs of camps.campInstances?.values?.() || []) {
        for (const rec of recs) {
          if (camps.isCampCleared?.(rec)) continue;
          const campTitle = rec.captainName ? `${rec.captainName}'s Bandit Camp` : 'Bandit Camp';
          if (campTitle === shownTitle) {
            matchedCamp = rec;
            break;
          }
        }
        if (matchedCamp) break;
      }
      if (!matchedCamp) return result;

      const danger = banditDifficulty(matchedCamp.tier);
      const subtitle = document.createElement('div');
      subtitle.dataset.banditDangerSubtitle = '1';
      subtitle.style.cssText = 'display:block;margin-top:3px;text-align:center;font-size:13px;line-height:1.15;letter-spacing:0.05em;font-weight:500;color:rgba(245,230,200,0.86);';
      subtitle.append(document.createTextNode(danger.label + '  '));

      const marks = document.createElement('span');
      marks.textContent = danger.marks;
      marks.setAttribute('aria-label', `${danger.marks.length} danger marks`);
      marks.style.cssText = "font-family:'KhymeryyanRomanLetters+Numbers','Pixelify Sans',monospace;font-size:1.2em;letter-spacing:0.08em;font-weight:700;";
      subtitle.appendChild(marks);
      banner.appendChild(subtitle);
      return result;
    };

    camps.__dangerSubtitleInstalled = true;
  }

  function _errorText(error) {
    return String(error?.message || error || 'Unknown error');
  }

  function _recordRenderError(scope, error) {
    const message = _errorText(error); // Used in the debug snapshot and inline mobile diagnostic.
    if (!lastRenderDebug) lastRenderDebug = { at: Date.now(), savedCount: 0, activeCount: 0, statusCounts: {}, kindCounts: {}, errors: [] };
    lastRenderDebug.errors.push({ scope, message });
    deps?.debugLog?.(`[tasks] ${scope}: ${message}`, 'warn');
  }

  function _questProgressSnapshot() {
    const progress = deps?.getQuestProgress?.(); // Used as the one live source for both Quest Log rows and diagnostics.
    return progress && typeof progress === 'object' ? progress : {};
  }

  function _questStateSummary(progress) {
    const statusCounts = {}; // Used by the mobile diagnostic when saved quests exist but none qualify as active.
    const kindCounts = {}; // Used by getDebug() to distinguish requests, favors, and bounties in the saved state.
    const entries = Object.entries(progress || {}); // Used to calculate saved/active counts without rescanning different state snapshots.
    for (const [, state] of entries) {
      const status = state?.status || 'missing-status'; // Used to expose malformed/stale quest records instead of silently hiding them.
      const kind = state?.progress?.kind || 'missing-kind'; // Used to expose task records that the log cannot classify.
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    }
    return { entries, statusCounts, kindCounts };
  }

  function _appendQuestDiagnostic(list) {
    if (!lastRenderDebug) return;
    const shouldShow = lastRenderDebug.errors.length || (lastRenderDebug.savedCount > 0 && lastRenderDebug.activeCount === 0); // Used to keep normal healthy logs uncluttered.
    if (!shouldShow) return;
    const row = document.createElement('div'); // Used as a mobile-visible fallback when console access is unavailable.
    row.className = 'delivery-row';
    if (lastRenderDebug.errors.length) {
      const latest = lastRenderDebug.errors[lastRenderDebug.errors.length - 1]; // Used to keep the diagnostic concise while getDebug() retains every error from this render.
      row.innerHTML = `<span class="dr-icon">⚠️</span><span class="dr-name">Quest UI diagnostic: ${deps.esc(latest.scope)} — ${deps.esc(latest.message)}</span><span class="dr-eta">${lastRenderDebug.activeCount}/${lastRenderDebug.savedCount}</span>`;
    } else {
      const statuses = Object.entries(lastRenderDebug.statusCounts).map(([status, count]) => `${status}:${count}`).join(', '); // Used to explain why saved records are not appearing as accepted quests.
      row.innerHTML = `<span class="dr-icon">🔎</span><span class="dr-name">Quest state: ${lastRenderDebug.savedCount} saved, none active (${deps.esc(statuses || 'no statuses')}).</span><span class="dr-eta">0/${lastRenderDebug.savedCount}</span>`;
    }
    list.appendChild(row);
  }

  function _renderQuestLog() {
    const list = document.getElementById('tasksList'); // Used as the accepted-quest container; this renders independently of board/bounty refreshes.
    if (!list) return;
    list.innerHTML = '';

    const progress = _questProgressSnapshot(); // Used to ensure this pass reads one consistent live quest-state object.
    const summary = _questStateSummary(progress); // Used by both filtering and mobile diagnostics.
    const active = summary.entries
      .filter(([, state]) => {
        const kind = state?.progress?.kind;
        if (state?.progress?.hidden) return false;
        if (kind === 'story') return state?.status === 'active'; // Authored multi-stage quests keep their own dialogue phase names while still living in the shared questProgress record.
        return state?.status === 'available' && ['request', 'favor', 'bounty'].includes(kind);
      })
      .map(([id, state]) => ({ id, ...state.progress }))
      .sort((a, b) => {
        const order = kind => kind === 'story' ? 0 : kind === 'request' ? 1 : kind === 'favor' ? 2 : 3;
        return order(a.kind) - order(b.kind);
      }); // Used as the exact set of accepted quests shown to the player.

    lastRenderDebug.savedCount = summary.entries.length;
    lastRenderDebug.activeCount = active.length;
    lastRenderDebug.statusCounts = summary.statusCounts;
    lastRenderDebug.kindCounts = summary.kindCounts;

    if (!active.length) {
      const empty = document.createElement('div'); // Used so a diagnostic row can coexist with the normal empty-state text.
      empty.className = 'delivery-row';
      empty.innerHTML = '<span class="dr-icon">📜</span><span class="dr-name">No quests in your log yet.</span><span class="dr-eta">—</span>';
      list.appendChild(empty);
      _appendQuestDiagnostic(list);
      return;
    }

    active.forEach(task => {
      try {
        const row = document.createElement('div'); // Used for this one accepted quest so malformed siblings cannot suppress it.
        row.className = 'shop-row';
        if (task.kind === 'bounty') {
          const zoneLabel = deps.WMAP_ZONE_LABELS[task.zoneId] || task.zoneId;
          const marked = !!window.BountyBoard?.markers?.has?.(task.id); // Used to avoid an unrelated missing marker cache breaking the whole Quest Log.
          const pronouns = bountyPronouns(task);
          row.innerHTML = `
            <div class="sh-icon">🎯</div>
            <div class="sh-info">
              <div class="sh-name">Bounty: ${deps.esc(task.captainName)}</div>
              <div class="sh-desc" style="margin-top:1px;color:var(--accent);">${dangerRatingMarkup(task.tier)}</div>
              <div class="sh-desc">${deps.esc(zoneLabel)}. ${marked ? 'Camp located — marked on the map.' : `Still tracking ${pronouns.object} down...`} Reward: ${task.rewardGold}g on ${pronouns.possessive} camp's destruction.</div>
            </div>
          `;
        } else if (task.kind === 'story') {
          const live = task.provider === 'banubu' ? window.BanubuQuestline?.menuStatus?.() : null; // Optional live readiness comes from the same matcher that routes Banubu to his ready-to-turn-in dialogue.
          const ready = live?.active ? !!live.ready : !!task.ready;
          const giver = task.npcName || 'Quest giver';
          row.innerHTML = `
            <div class="sh-icon">${deps.esc(task.icon || '📖')}</div>
            <div class="sh-info">
              <div class="sh-name">${deps.esc(task.title || 'Quest')}</div>
              <div class="sh-desc">${deps.esc(live?.objective || task.objective || 'Continue the quest.')}</div>
              ${task.detail ? `<div class="sh-desc" style="margin-top:2px;">${deps.esc(task.detail)}</div>` : ''}
              <div class="sh-desc" style="margin-top:2px;color:${ready ? 'var(--accent)' : 'inherit'};">${ready ? `Ready — return to ${deps.esc(giver)}.` : `In progress — return to ${deps.esc(giver)} when the objective is complete.`}</div>
            </div>
          `;
        } else {
          const itemList = (task.items || []).map(it => `${deps.esc(deps.ITEM_DEFS[it.itemKey]?.label || it.itemKey)} ×${it.qty} (have ${deps.inventory[it.itemKey] || 0})`).join(', ') || 'No delivery items recorded'; // Used to keep one malformed legacy task from aborting every quest row.
          const npcName = task.npcName || 'Unknown quest giver'; // Used by legacy/incomplete task rows that lack the newer npcName field.
          const source = task.kind === 'request' ? `${deps.esc(npcName)}'s request` : `${deps.esc(npcName)}'s favor`;
          const bonusNote = task.deadlineDay != null
            ? ((deps.calendar?.day || 0) <= task.deadlineDay
              ? ` Deliver by day ${task.deadlineDay} for ${task.rewardGold * (task.bonusMultiplier || 1)}g instead of ${task.rewardGold}g.`
              : ' The bonus window has passed — still worth the base price.')
            : '';
          row.innerHTML = `
            <div class="sh-icon">${task.kind === 'request' ? '❗' : '💌'}</div>
            <div class="sh-info">
              <div class="sh-name">${source} — ${itemList}</div>
              <div class="sh-desc">Reward: ${task.rewardGold}g + ${task.rewardFriendship} friendship. Turn in to ${deps.esc(npcName)}.${bonusNote}</div>
            </div>
          `;
        }
        list.appendChild(row);
      } catch (error) {
        _recordRenderError(`quest-row:${task.id}`, error);
      }
    });
    _appendQuestDiagnostic(list);
  }

  function _renderRequestPostings() {
    const postingEl = document.getElementById('tasksBoardPosting'); // Used for rumors about named NPCs with unaccepted requests.
    if (!postingEl) return;
    postingEl.innerHTML = '';
    let pending = []; // Used to render a safe empty state even if the compass-target query fails.
    try {
      pending = window.ProceduralTasks?.pendingRequestCompassTargets?.() || [];
    } catch (error) {
      _recordRenderError('request-postings', error);
    }
    if (pending.length) {
      pending.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'delivery-row';
        row.innerHTML = `<span class="dr-icon">❗</span><span class="dr-name">${deps.esc(entry.label)} — go say hello.</span><span class="dr-eta">—</span>`;
        postingEl.appendChild(row);
      });
    } else {
      postingEl.innerHTML = '<div class="delivery-row"><span class="dr-icon">📋</span><span class="dr-name">No word of any requests right now — check back tomorrow.</span><span class="dr-eta">—</span></div>';
    }
  }

  function _renderBountyPostings() {
    const bountyEl = document.getElementById('tasksBountyPosting'); // Used for the two standing wanted-poster offer slots.
    if (!bountyEl) return;
    bountyEl.innerHTML = '';
    let postings = []; // Used so a posting API failure cannot affect the accepted Quest Log.
    try {
      postings = window.BountyBoard?.getCurrentPostings?.()
        || [window.BountyBoard?.getCurrentPosting?.()].filter(Boolean);
    } catch (error) {
      _recordRenderError('bounty-postings', error);
    }
    if (postings.length) {
      postings.forEach(posting => {
        const zoneLabel = deps.WMAP_ZONE_LABELS[posting.zoneId] || posting.zoneId;
        const pronouns = bountyPronouns(posting);
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.innerHTML = `
          <div class="sh-icon">🎯</div>
          <div class="sh-info">
            <div class="sh-name">Wanted: ${deps.esc(posting.captainName)}</div>
            <div class="sh-desc" style="margin-top:1px;color:var(--accent);">${dangerRatingMarkup(posting.tier)}</div>
            <div class="sh-desc">Last seen in the ${deps.esc(zoneLabel)}. Destroy ${pronouns.possessive} camp for ${posting.rewardGold}g.</div>
          </div>
          <button class="shop-buy-btn" data-take-bounty="${posting.id}">Take Bounty</button>
        `;
        row.querySelector('[data-take-bounty]')?.addEventListener('click', () => {
          window.BountyBoard?.take?.(posting.id);
          void renderTasksPanel();
        });
        bountyEl.appendChild(row);
      });
    } else {
      bountyEl.innerHTML = '<div class="delivery-row"><span class="dr-icon">🎯</span><span class="dr-name">No bounties posted right now.</span><span class="dr-eta">—</span></div>';
    }
  }

  async function renderTasksPanel() {
    lastRenderDebug = { at: Date.now(), savedCount: 0, activeCount: 0, statusCounts: {}, kindCounts: {}, errors: [] }; // Used as this render's complete mobile/debug snapshot.

    // Accepted quests are the primary content of this panel. Render them first
    // so a board rumor, bounty config fetch, or posting failure can never make
    // already-accepted NPC work disappear from the player's Quest Log.
    _renderQuestLog();

    try {
      window.ProceduralTasks?.maybeRefreshRequestPostings?.();
    } catch (error) {
      _recordRenderError('request-refresh', error);
    }
    try {
      await window.BountyBoard?.maybeRefreshPosting?.();
    } catch (error) {
      _recordRenderError('bounty-refresh', error);
    }

    _renderRequestPostings();
    _renderBountyPostings();

    // Re-render once after optional refresh work so newly-mutated quest state
    // is reflected while retaining any refresh diagnostics in the log itself.
    _renderQuestLog();
  }

  function getDebug() {
    if (!lastRenderDebug) return null;
    return {
      ...lastRenderDebug,
      statusCounts: { ...lastRenderDebug.statusCounts },
      kindCounts: { ...lastRenderDebug.kindCounts },
      errors: lastRenderDebug.errors.map(error => ({ ...error })),
    };
  }

  window.TasksPanel = { init, render: renderTasksPanel, getDebug };
})();