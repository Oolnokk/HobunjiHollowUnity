(() => {
  'use strict';

  // Procedural tasks: bulletin board notices + trusted-NPC favors.
  //
  // Every generated task rides the questProgress scaffold (no new save
  // fields): questProgress[taskId].progress holds the full task descriptor
  // { kind:'board'|'favor', npcId, npcName, domain, itemKey, qty,
  // rewardGold, rewardFriendship, tier, postedDay }. Every task — board or
  // favor — always has a real npcId; you turn it in to that NPC
  // specifically, which is what pays out both the gold and the friendship.
  // .status is:
  //   'posted'    — a board notice, freshly rolled, sitting on the
  //                 board, not yet taken into the player's own log
  //                 (board-only; never used for favors).
  //   'offered'   — a favor just asked in dialogue, awaiting accept/decline
  //                 (favor-only; never used for board tasks).
  //   'available' — in the player's own quest log (board: taken off the
  //                 board; favor: accepted) and turn-in-ready once the
  //                 player has the items — no completion deadline.
  //   'declined'  — a favor turned down (only blocks re-asking same day).
  //   'completed' — turned in.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as the other recent extractions. questProgress and
  // the shop loot pool table are both reassigned wholesale elsewhere in
  // game.js (save-load, loot-pool JSON fetch), so they're threaded through
  // as getters rather than captured references. window.AlchemySystem and
  // window.DialogueContent are left as direct global references — same
  // treatment as THREE — since both are always-loaded singleton modules,
  // not values game.js owns and mutates.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const TASK_DOMAINS = ['farming', 'fishing', 'combat', 'alchemy'];

  // Friendship tiers ride the existing (previously unused) per-NPC favor
  // counter — see DialogueContent's getNpcDlgState/adjustNpcFavor. No new
  // persisted counter needed; this just adds tier thresholds on top of it.
  const FRIENDSHIP_TIER_THRESHOLDS = [0, 40, 100, 200, 350, 550];
  function friendshipFavor(npcId) { return window.DialogueContent?.getNpcDlgState(npcId).favor || 0; }
  function friendshipTier(npcId) {
    const favor = friendshipFavor(npcId);
    let tier = 0;
    for (let i = 0; i < FRIENDSHIP_TIER_THRESHOLDS.length; i++) if (favor >= FRIENDSHIP_TIER_THRESHOLDS[i]) tier = i;
    return tier;
  }
  function friendshipTierProgress(npcId) {
    const favor = friendshipFavor(npcId);
    const tier = friendshipTier(npcId);
    const next = FRIENDSHIP_TIER_THRESHOLDS[tier + 1];
    return { tier, favor, next: next ?? null };
  }

  // Chance a trusted NPC asks a favor of you when you talk to them, and
  // how much gold/friendship a favor pays out vs. a board request posted
  // by some NPC — both climb with friendship tier, per the design brief.
  const FAVOR_CHANCE_BY_TIER       = [0, 0.12, 0.20, 0.30, 0.42, 0.55];
  const TASK_QTY_BY_TIER           = [1, 2, 2, 3, 4, 5];
  const TASK_REWARD_MULT           = { board: 1.3, favor: 1.6 };
  const TASK_FRIENDSHIP_REWARD     = { board: [8, 10, 12, 15, 18, 22], favor: [18, 25, 35, 48, 65, 85] };

  // role (free-text NPC job, e.g. "carpenter / roofing family
  // connection", "great fae / fishing solution") → which item pool their
  // own favors skew toward at low friendship. Matched by substring since
  // authored roles are prose, not an enum; anything unmatched falls back
  // to 'farming', the most generic domain.
  function npcSkillDomain(role) {
    const r = (role || '').toLowerCase();
    if (/fish/.test(r)) return 'fishing';
    if (/alchem|potion/.test(r)) return 'alchemy';
    if (/hunt|watch|war|smith|mining|bonehewer/.test(r)) return 'combat';
    return 'farming';
  }

  // Only villagers — anyone with a stationary home or business in one of
  // the real town buildings — can give tasks (board or favor), plus Pahu
  // and Leaf as a named exception (they live in the swamp house, outside
  // town, but are otherwise settled residents). `homeId`/`workBuildingId`
  // are authored-but-previously-unread NPC-database fields; everyone
  // else (wilderness dwellers, Great Fae, deceased/banished lore-only
  // entries, unbuilt placeholder roles) is excluded.
  const QUEST_ELIGIBLE_TOWN_HOME_IDS = new Set([
    'general_store', 'potion_shop', 'unumanuk_household', 'ginju_farmstead',
    'inn', 'smithy', 'temple', 'carpenters',
  ]);
  const QUEST_ELIGIBLE_EXTRA_NPC_IDS = new Set(['pahu', 'leaf']);
  function isQuestEligibleNpc(rec) {
    if (!rec?.id) return false;
    if (QUEST_ELIGIBLE_EXTRA_NPC_IDS.has(rec.id)) return true;
    return QUEST_ELIGIBLE_TOWN_HOME_IDS.has(rec.homeId) || QUEST_ELIGIBLE_TOWN_HOME_IDS.has(rec.workBuildingId);
  }

  // Deliverable item pools per domain — farming is a static list (raw
  // crops + Uumkao'ii dew); fishing/combat/alchemy are derived live from
  // their own existing catalogs (FISH_DEFS, CREATURE_DB loot,
  // ALCHEMY_REAGENT_DEFS) instead of being duplicated here.
  const TASK_FARMING_ITEM_POOL = [
    'needlegrain', 'heftroot', 'garlink', 'ongyums',
    'redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries',
    'blackMustard', 'greenMustard',
    'yellowDew', 'greenDew', 'blueDew', 'orangeDew', 'redDew', 'purpleDew', 'whiteDew',
  ];
  function taskItemPoolFor(domain) {
    if (domain === 'fishing') return Object.values(deps.FISH_DEFS).flat().map(f => f.key);
    if (domain === 'combat') return [...new Set(Object.values(deps.CREATURE_DB).flatMap(c => (deps.getLootPools()[c.lootPool]?.entries || []).map(e => e.itemKey).filter(Boolean)))];
    if (domain === 'alchemy') return Object.keys(window.AlchemySystem.REAGENT_DEFS);
    return TASK_FARMING_ITEM_POOL;
  }

  // Picks one item from a domain's pool, biased toward cheaper items at
  // low tiers and opening up to the whole pool (including the priciest)
  // by the top tier — sellPrice is the one value/rarity signal shared
  // across every domain's catalog.
  function pickTaskItem(domain, tier) {
    const pool = taskItemPoolFor(domain);
    if (!pool || !pool.length) return null;
    const priced = pool.map(key => ({ key, price: deps.ITEM_DEFS[key]?.sellPrice || 3 })).sort((a, b) => a.price - b.price);
    const reach = Math.min(1, (tier + 2) / (FRIENDSHIP_TIER_THRESHOLDS.length + 1));
    const maxIdx = Math.max(0, Math.min(priced.length - 1, Math.ceil(priced.length * reach) - 1));
    return priced[Math.floor(Math.random() * (maxIdx + 1))].key;
  }

  // Farming/fishing/combat retain their existing tool-mastery signals.
  // Alchemy now uses the real seventh SkillSystem progression track.
  function getPlayerSkillLevels() {
    return {
      farming: deps.toolMasteryLevel(deps.equipmentSlots.hoe),
      fishing: deps.toolMasteryLevel(deps.equipmentSlots.harpoon),
      combat:  deps.toolMasteryLevel(deps.equipmentSlots.weapon),
      alchemy: window.SkillSystem?.level?.('alchemy') || 0,
    };
  }
  function getPlayerHighestSkillDomain() {
    const levels = getPlayerSkillLevels();
    let best = 'farming', bestLevel = -1;
    for (const d of TASK_DOMAINS) { if (levels[d] > bestLevel) { bestLevel = levels[d]; best = d; } }
    return best;
  }

  function _makeTaskId() { return 'task_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // Generates and persists one task, always attributed to a real NPC
  // (`npcRec` — {id, name, role}; required for both kinds, since every
  // task, board or favor, has a specific quest giver you turn it in to).
  // Domain skew is the design brief's core rule: low friendship pulls
  // toward the NPC's own skillset (npcSkillDomain), high friendship pulls
  // toward the player's own best skill — blended by a tier-weighted coin
  // flip rather than a hard cutoff, so it shifts gradually.
  function generateTask(kind, npcRec, tier) {
    if (!npcRec?.id) return null;
    const npcDomain = npcSkillDomain(npcRec.role);
    const playerDomain = getPlayerHighestSkillDomain();
    const playerWeight = tier / (FRIENDSHIP_TIER_THRESHOLDS.length - 1); // 0 at tier 0 → 1 at max tier
    const domain = Math.random() < playerWeight ? playerDomain : npcDomain;
    const itemKey = pickTaskItem(domain, tier);
    if (!itemKey) return null;
    const def = deps.ITEM_DEFS[itemKey];
    const qty = TASK_QTY_BY_TIER[tier] + (Math.random() < 0.4 ? 1 : 0);
    const rewardGold = Math.max(1, Math.round(qty * (def?.sellPrice || 5) * TASK_REWARD_MULT[kind]));
    const rewardFriendship = TASK_FRIENDSHIP_REWARD[kind][tier];
    const id = _makeTaskId();
    const task = {
      kind, npcId: npcRec.id, npcName: npcRec.name || 'A neighbor',
      domain, itemKey, qty, rewardGold, rewardFriendship, tier, postedDay: deps.calendar.day,
    };
    deps.setQuestStatus(id, kind === 'favor' ? 'offered' : 'posted', task);
    return { id, ...task };
  }

  // Finds an existing task tied to one NPC, optionally restricted to
  // today's postings (used so a declined favor isn't re-asked the same
  // day, but can be asked again on a later visit).
  function findNpcTask(npcId, statuses, todayOnly) {
    for (const [id, st] of Object.entries(deps.getQuestProgress())) {
      if (st.progress?.npcId !== npcId || st.progress?.kind !== 'favor') continue;
      if (!statuses.includes(st.status)) continue;
      if (todayOnly && st.progress.postedDay !== deps.calendar.day) continue;
      return { id, ...st.progress, status: st.status };
    }
    return null;
  }

  // Called from openNpcDialogue for every NPC with an id — returns the
  // favor to offer this conversation (freshly rolled, or one already
  // asked-but-not-yet-answered), or null if none should be offered.
  function maybeOfferFavor(npcRec) {
    const npcId = npcRec?.id;
    if (!npcId || !isQuestEligibleNpc(npcRec)) return null;
    const stillOffered = findNpcTask(npcId, ['offered']);
    if (stillOffered) return stillOffered;
    if (findNpcTask(npcId, ['available'])) return null; // already holding one from them
    if (findNpcTask(npcId, ['declined'], true)) return null; // already said no today
    const tier = friendshipTier(npcId);
    if (Math.random() > FAVOR_CHANCE_BY_TIER[tier]) return null;
    return generateTask('favor', npcRec, tier);
  }

  function favorAskLine(task) {
    const itemLabel = deps.ITEM_DEFS[task.itemKey]?.label || task.itemKey;
    return `Actually — since I trust you, could you bring me ${task.qty}× ${itemLabel}? I'd make it well worth your while.`;
  }

  // The single currently-posted (not yet taken) board notice, or null.
  // Board tasks are deliberately not tied to any one player's
  // friendship — a flat mid-range tier keeps the board offering
  // reasonable variety for everyone regardless of who they've
  // befriended; only the *NPC picked to post it* is random.
  function getCurrentBoardPosting() {
    const entries = Object.entries(deps.getQuestProgress()).filter(([, st]) => st.progress?.kind === 'board' && st.status === 'posted');
    entries.sort((a, b) => (b[1].progress.postedDay || 0) - (a[1].progress.postedDay || 0));
    return entries[0] ? { id: entries[0][0], ...entries[0][1].progress } : null;
  }

  // Rolls a fresh board notice once per day (called from the day-rollover
  // hooks and once on world load) — whatever was posted yesterday and
  // never taken is simply superseded, not carried over; the board always
  // shows *today's* notice. A notice the player already took (status
  // flipped to 'available') is safe from this — it's in their own log
  // now and this function never touches it.
  function maybeRefreshBoardTask() {
    const current = getCurrentBoardPosting();
    if (current && current.postedDay === deps.calendar.day) return; // already refreshed today
    const candidates = deps.npcWalkers.map(w => w.rec).filter(r => r?.id && r?.name && isQuestEligibleNpc(r));
    if (!candidates.length) return; // no eligible NPCs spawned yet — try again on the next call
    const npcRec = candidates[Math.floor(Math.random() * candidates.length)];
    const tier = Math.min(FRIENDSHIP_TIER_THRESHOLDS.length - 1, 1 + Math.floor(Math.random() * 3));
    generateTask('board', npcRec, tier);
  }

  // Moves today's board notice into the player's own quest log —
  // "accepting" a board task, the board equivalent of a favor's accept
  // choice. Once taken it has no completion deadline and survives the
  // board's next daily refresh untouched.
  function takeBoardTask(taskId) {
    const st = deps.getQuestProgress()[taskId];
    if (!st || st.status !== 'posted') return { ok: false, message: 'That notice is no longer available.' };
    deps.setQuestStatus(taskId, 'available', {});
    deps.showToast(`📋 Took on ${st.progress.npcName}'s request.`, true);
    return { ok: true, message: 'Task added to your log.' };
  }

  // The first quest log entry (board or favor) attributed to this NPC
  // that the player currently has everything for — what powers the
  // in-dialogue turn-in offer (see openNpcDialogue).
  function getTurnInReadyTaskForNpc(npcId) {
    for (const [id, st] of Object.entries(deps.getQuestProgress())) {
      if (st.progress?.npcId !== npcId || st.status !== 'available') continue;
      if ((deps.inventory[st.progress.itemKey] || 0) < st.progress.qty) continue;
      return { id, ...st.progress };
    }
    return null;
  }

  // Active board/favor quests point back to their requesting NPC. The
  // compass consumes the walker's live scheduled area/position so it never
  // maintains a second, stale copy of NPC navigation state.
  function compassTargets() {
    const byNpc = new Map(); // Used to collapse multiple active requests for the same NPC into one compass marker.
    for (const [id, state] of Object.entries(deps?.getQuestProgress?.() || {})) {
      const task = state?.progress;
      if (state?.status !== 'available' || !['board', 'favor'].includes(task?.kind) || !task.npcId) continue;
      const walker = deps.npcWalkers.find(candidate => candidate.rec?.id === task.npcId);
      if (!walker?.root?.position) continue;
      const existing = byNpc.get(task.npcId);
      byNpc.set(task.npcId, {
        id: existing?.id || `quest:${id}`,
        taskIds: [...(existing?.taskIds || []), id],
        npcId: task.npcId,
        label: `Quest: ${task.npcName || walker.rec?.name || task.npcId}`,
        areaId: walker.area || walker.root?._pendingBuildingAdd || (walker.root?._pendingTownAdd ? 'town' : ''),
        col: walker.root.position.x,
        row: walker.root.position.z,
      });
    }
    return [...byNpc.values()];
  }

  // Turning a task in only ever happens by talking to the specific NPC
  // who posted/asked it — see openNpcDialogue's turn-in offer and the
  // 'turnInTask' dialogue-choice action.
  function turnInTask(taskId) {
    const st = deps.getQuestProgress()[taskId];
    const task = st?.progress;
    if (!task?.itemKey || st.status !== 'available') return { ok: false, message: 'That task is not ready to turn in.' };
    if ((deps.inventory[task.itemKey] || 0) < task.qty) {
      return { ok: false, message: `You need ${task.qty}× ${deps.ITEM_DEFS[task.itemKey]?.label || task.itemKey}.` };
    }
    deps.inventory[task.itemKey] -= task.qty;
    deps.clampInventoryStack(task.itemKey);
    deps.inventory.gold = (deps.inventory.gold || 0) + task.rewardGold;
    window.DialogueContent?.adjustNpcFavor(task.npcId, task.rewardFriendship, 'task_' + task.kind);
    deps.setQuestStatus(taskId, 'completed', {});
    deps.showToast(`✅ Task complete! +${task.rewardGold}g, +${task.rewardFriendship} friendship with ${task.npcName}.`, true);
    return { ok: true, message: 'Task turned in.' };
  }

  window.ProceduralTasks = {
    init,
    makeTaskId: _makeTaskId,
    friendshipFavor,
    friendshipTier,
    friendshipTierProgress,
    npcSkillDomain,
    isQuestEligibleNpc,
    taskItemPoolFor,
    pickTaskItem,
    getPlayerSkillLevels,
    getPlayerHighestSkillDomain,
    generateTask,
    findNpcTask,
    maybeOfferFavor,
    favorAskLine,
    getCurrentBoardPosting,
    maybeRefreshBoardTask,
    takeBoardTask,
    getTurnInReadyTaskForNpc,
    compassTargets,
    turnInTask,
  };
})();
