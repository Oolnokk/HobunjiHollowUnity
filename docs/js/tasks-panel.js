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

  async function renderTasksPanel() {
    window.ProceduralTasks.maybeRefreshBoardTask();
    await window.BountyBoard.maybeRefreshPosting();

    // Today's board notice — not yet in the player's log.
    const postingEl = document.getElementById('tasksBoardPosting');
    if (postingEl) {
      postingEl.innerHTML = '';
      const posting = window.ProceduralTasks.getCurrentBoardPosting();
      if (posting) {
        const def = deps.ITEM_DEFS[posting.itemKey];
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.innerHTML = `
          <div class="sh-icon">📋</div>
          <div class="sh-info">
            <div class="sh-name">${deps.esc(posting.npcName)} wants ${deps.esc(def?.label || posting.itemKey)} ×${posting.qty}</div>
            <div class="sh-desc">Reward: ${posting.rewardGold}g + ${posting.rewardFriendship} friendship with ${deps.esc(posting.npcName)} — turn in to them once you have it.</div>
          </div>
          <button class="shop-buy-btn" data-take="${posting.id}">Take Quest</button>
        `;
        row.querySelector('[data-take]')?.addEventListener('click', () => {
          window.ProceduralTasks.takeBoardTask(posting.id);
          renderTasksPanel();
        });
        postingEl.appendChild(row);
      } else {
        postingEl.innerHTML = '<div class="delivery-row"><span class="dr-icon">📋</span><span class="dr-name">Nothing posted right now — check back tomorrow.</span><span class="dr-eta">—</span></div>';
      }
    }

    // Two standing wanted posters: one easy-range and one hard-range. Taking a
    // poster removes only that task; the next render refills that slot.
    const bountyEl = document.getElementById('tasksBountyPosting');
    if (bountyEl) {
      bountyEl.innerHTML = '';
      const postings = window.BountyBoard.getCurrentPostings?.()
        || [window.BountyBoard.getCurrentPosting?.()].filter(Boolean);
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
            window.BountyBoard.take(posting.id);
            renderTasksPanel();
          });
          bountyEl.appendChild(row);
        });
      } else {
        bountyEl.innerHTML = '<div class="delivery-row"><span class="dr-icon">🎯</span><span class="dr-name">No bounties posted right now.</span><span class="dr-eta">—</span></div>';
      }
    }

    // The player's actual quest log — everything accepted, board,
    // favor, or bounty, with no completion deadline.
    const list = document.getElementById('tasksList');
    if (!list) return;
    list.innerHTML = '';
    const active = Object.entries(deps.getQuestProgress())
      .filter(([, st]) => st.status === 'available' && ['board', 'favor', 'bounty'].includes(st.progress?.kind))
      .map(([id, st]) => ({ id, ...st.progress }))
      .sort((a, b) => (a.kind === 'board' ? 0 : a.kind === 'favor' ? 1 : 2) - (b.kind === 'board' ? 0 : b.kind === 'favor' ? 1 : 2));
    if (!active.length) {
      list.innerHTML = '<div class="delivery-row"><span class="dr-icon">📜</span><span class="dr-name">No quests in your log yet.</span><span class="dr-eta">—</span></div>';
      return;
    }
    active.forEach(task => {
      const row = document.createElement('div');
      row.className = 'shop-row';
      if (task.kind === 'bounty') {
        const zoneLabel = deps.WMAP_ZONE_LABELS[task.zoneId] || task.zoneId;
        const marked = window.BountyBoard.markers.has(task.id);
        const pronouns = bountyPronouns(task);
        row.innerHTML = `
          <div class="sh-icon">🎯</div>
          <div class="sh-info">
            <div class="sh-name">Bounty: ${deps.esc(task.captainName)}</div>
            <div class="sh-desc" style="margin-top:1px;color:var(--accent);">${dangerRatingMarkup(task.tier)}</div>
            <div class="sh-desc">${deps.esc(zoneLabel)}. ${marked ? 'Camp located — marked on the map.' : `Still tracking ${pronouns.object} down...`} Reward: ${task.rewardGold}g on ${pronouns.possessive} camp's destruction.</div>
          </div>
        `;
      } else {
        const def = deps.ITEM_DEFS[task.itemKey];
        const have = deps.inventory[task.itemKey] || 0;
        const source = task.kind === 'board' ? `${deps.esc(task.npcName)}'s board request` : `${deps.esc(task.npcName)}'s favor`;
        row.innerHTML = `
          <div class="sh-icon">${task.kind === 'board' ? '📋' : '💌'}</div>
          <div class="sh-info">
            <div class="sh-name">${source} — ${deps.esc(def?.label || task.itemKey)} ×${task.qty}</div>
            <div class="sh-desc">Have ${have}/${task.qty}. Reward: ${task.rewardGold}g + ${task.rewardFriendship} friendship. Turn in to ${deps.esc(task.npcName)}.</div>
          </div>
        `;
      }
      list.appendChild(row);
    });
  }

  window.TasksPanel = { init, render: renderTasksPanel };
})();
