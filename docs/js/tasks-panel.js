(() => {
  'use strict';

  // Tasks tab (board requests + accepted NPC favors + active bounty).
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function renderTasksPanel() {
    window.ProceduralTasks.maybeRefreshBoardTask();
    window.BountyBoard.maybeRefreshPosting();

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
        const rank = window.BountyBoard.RANK_LABELS[posting.tier] || `Tier ${posting.tier}`;
        const zoneLabel = deps.WMAP_ZONE_LABELS[posting.zoneId] || posting.zoneId;
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.innerHTML = `
          <div class="sh-icon">🎯</div>
          <div class="sh-info">
            <div class="sh-name">Wanted: ${deps.esc(posting.captainName)} — ${deps.esc(rank)}</div>
            <div class="sh-desc">Last seen in the ${deps.esc(zoneLabel)}. Destroy his camp for ${posting.rewardGold}g.</div>
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
        const rank = window.BountyBoard.RANK_LABELS[task.tier] || `Tier ${task.tier}`;
        const zoneLabel = deps.WMAP_ZONE_LABELS[task.zoneId] || task.zoneId;
        const marked = window.BountyBoard.markers.has(task.id);
        row.innerHTML = `
          <div class="sh-icon">🎯</div>
          <div class="sh-info">
            <div class="sh-name">Bounty: ${deps.esc(task.captainName)} — ${deps.esc(rank)}</div>
            <div class="sh-desc">${deps.esc(zoneLabel)}. ${marked ? 'Camp located — marked on the map.' : 'Still tracking him down...'} Reward: ${task.rewardGold}g on his camp\'s destruction.</div>
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
