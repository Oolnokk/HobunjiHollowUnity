(() => {
  'use strict';

  // Tasks tab (board requests + accepted NPC favors + active bounty).
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems.
  let deps = null;
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
    // Bounty generation can now await the bandit gang config before rolling
    // the captain's weighted species/gender. Waiting here prevents a one-frame
    // "No bounties" placeholder from flashing while that config loads.
    await window.BountyBoard.maybeRefreshPosting();

    // Today's board notice — not yet in the player's log. Taking it is
    // the only action this panel offers; turning a task in (board or
    // favor) always happens by talking to the NPC who posted/asked it.
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

    // Wanted poster for a bandit captain — separate from the board
    // notice above (its own slot, its own refresh rule: see
    // maybeRefreshBountyPosting). Accepting marks that captain's camp
    // on the map the moment it's known (see updateBountyTracking) and
    // pays out automatically once the camp is destroyed — no NPC
    // turn-in, unlike board/favor tasks.
    const bountyEl = document.getElementById('tasksBountyPosting');
    if (bountyEl) {
      bountyEl.innerHTML = '';
      const posting = window.BountyBoard.getCurrentPosting();
      if (posting) {
        const zoneLabel = deps.WMAP_ZONE_LABELS[posting.zoneId] || posting.zoneId;
        const pronouns = bountyPronouns(posting); // Used in the wanted-poster description immediately below.
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
      } else {
        bountyEl.innerHTML = '<div class="delivery-row"><span class="dr-icon">🎯</span><span class="dr-name">No bounties posted right now.</span><span class="dr-eta">—</span></div>';
      }
    }

    // The player's actual quest log — everything accepted, board,
    // favor, or an active bounty, with no completion deadline. Read-
    // only: no turn-in button here on purpose (see above) -- a bounty
    // resolves itself via updateBountyTracking, not this panel.
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
        const pronouns = bountyPronouns(task); // Used in the active-bounty tracking copy immediately below.
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
