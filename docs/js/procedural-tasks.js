(() => {
  'use strict';

  // Procedural tasks: named-NPC requests (replaces the old bulletin board)
  // + trusted-NPC favors.
  //
  // Every generated task rides the questProgress scaffold (no new save
  // fields): questProgress[taskId].progress holds the full task descriptor
  // { kind:'request'|'favor', npcId, npcName, domain, items:[{itemKey,qty}],
  // rewardGold, rewardFriendship, bonusMultiplier, tier, postedDay,
  // deadlineDay }. Every task — request or favor — always has a real
  // npcId; you turn it in to that NPC specifically, which is what pays out
  // both the gold and the friendship. .status is:
  //   'announced'  — a request rolled for one of the named quest-givers.
  //                  Not yet asked in dialogue: the NPC will call the
  //                  player over with a purple ambient greeting and shows
  //                  a purple '!' on the compass (request-only; never used
  //                  for favors, which are only ever asked once you're
  //                  already talking).
  //   'offered'    — asked in dialogue (request or favor), awaiting
  //                  accept/decline.
  //   'available'  — in the player's own quest log (accepted) and
  //                  turn-in-ready once the player has the items — no
  //                  completion deadline on payout eligibility, but a
  //                  request keeps its bonus-window deadline for the
  //                  double-pay condition.
  //   'declined'   — turned down (only blocks re-asking same day).
  //   'completed'  — turned in.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as the other recent extractions. questProgress and
  // the shop loot pool table are both reassigned wholesale elsewhere in
  // game.js (save-load, loot-pool JSON fetch), so they're threaded through
  // as getters rather than captured references. window.AlchemySystem,
  // window.DialogueContent and window.BountyBoard are left as direct
  // global references — same treatment as THREE — since all are
  // always-loaded singleton modules, not values game.js owns and mutates.
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
  // how much gold/friendship a favor pays out — climbs with friendship
  // tier, per the design brief.
  const FAVOR_CHANCE_BY_TIER       = [0, 0.12, 0.20, 0.30, 0.42, 0.55];
  const TASK_QTY_BY_TIER           = [1, 2, 2, 3, 4, 5];
  const FAVOR_REWARD_MULT          = 1.6;
  const TASK_FRIENDSHIP_REWARD     = { favor: [18, 25, 35, 48, 65, 85], request: 20 };

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
  // the real town buildings — can give tasks (request or favor), plus Pahu
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

  function itemLabel(itemKey) { return deps.ITEM_DEFS[itemKey]?.label || itemKey; }
  function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
  function dayPartNow() { return deps.getDayPart?.() || 'day'; }
  function playerNickname() { return deps.getPlayerNickname?.() || 'friend'; }

  // Picks `count` items (with qty in [qtyMin, qtyMax]) across the given
  // domain(s) — one randomly-chosen domain per item when more than one is
  // supplied, so e.g. Eldress Teacup's "herb, meat, fish or skin" ask can
  // land on any mix of alchemy/combat/fishing loot each time it's rolled.
  function pickTaskItems(domains, count, qtyMin, qtyMax, tier) {
    const items = [];
    const used = new Set();
    let attempts = 0;
    while (items.length < count && attempts < count * 8) {
      attempts++;
      const domain = domains[Math.floor(Math.random() * domains.length)];
      const itemKey = pickTaskItem(domain, tier);
      if (!itemKey || used.has(itemKey)) continue;
      used.add(itemKey);
      items.push({ itemKey, qty: randInt(qtyMin, qtyMax) });
    }
    return items;
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

  // Generates and persists one favor, always attributed to a real NPC
  // (`npcRec` — {id, name, role}). Domain skew is the design brief's core
  // rule: low friendship pulls toward the NPC's own skillset
  // (npcSkillDomain), high friendship pulls toward the player's own best
  // skill — blended by a tier-weighted coin flip rather than a hard
  // cutoff, so it shifts gradually.
  function generateFavor(npcRec, tier) {
    if (!npcRec?.id) return null;
    const npcDomain = npcSkillDomain(npcRec.role);
    const playerDomain = getPlayerHighestSkillDomain();
    const playerWeight = tier / (FRIENDSHIP_TIER_THRESHOLDS.length - 1); // 0 at tier 0 → 1 at max tier
    const domain = Math.random() < playerWeight ? playerDomain : npcDomain;
    const itemKey = pickTaskItem(domain, tier);
    if (!itemKey) return null;
    const def = deps.ITEM_DEFS[itemKey];
    const qty = TASK_QTY_BY_TIER[tier] + (Math.random() < 0.4 ? 1 : 0);
    const rewardGold = Math.max(1, Math.round(qty * (def?.sellPrice || 5) * FAVOR_REWARD_MULT));
    const rewardFriendship = TASK_FRIENDSHIP_REWARD.favor[tier];
    const id = _makeTaskId();
    const task = {
      kind: 'favor', npcId: npcRec.id, npcName: npcRec.name || 'A neighbor',
      domain, items: [{ itemKey, qty }], rewardGold, rewardFriendship, tier, postedDay: deps.calendar.day,
      deadlineDay: null, bonusMultiplier: 1,
    };
    deps.setQuestStatus(id, 'offered', task);
    return { id, ...task };
  }

  // Finds an existing task tied to one NPC, optionally restricted to
  // today's postings (used so a declined favor/request isn't re-asked the
  // same day, but can be asked again on a later visit).
  function findNpcTask(npcId, kind, statuses, todayOnly) {
    for (const [id, st] of Object.entries(deps.getQuestProgress())) {
      if (st.progress?.npcId !== npcId || st.progress?.kind !== kind) continue;
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
    const stillOffered = findNpcTask(npcId, 'favor', ['offered']);
    if (stillOffered) return stillOffered;
    if (findNpcTask(npcId, 'favor', ['available'])) return null; // already holding one from them
    if (findNpcTask(npcId, 'favor', ['declined'], true)) return null; // already said no today
    if (REQUEST_GIVERS[npcId]) return null; // named quest-givers only ever offer their own curated request, never a generic favor
    const tier = friendshipTier(npcId);
    if (Math.random() > FAVOR_CHANCE_BY_TIER[tier]) return null;
    return generateFavor(npcRec, tier);
  }

  function favorAskLine(task) {
    const item = task.items[0];
    return `Actually — since I trust you, could you bring me ${item.qty}× ${itemLabel(item.itemKey)}? I'd make it well worth your while.`;
  }

  // ── Named quest-givers ────────────────────────────────────────────────
  // Each entry replaces the old anonymous bulletin-board notice with a
  // specific NPC's own voice. `roll(tier)` builds the task's items/reward/
  // deadline; `callOver(nick)` is the purple ambient line that calls the
  // player over before they've spoken to the NPC at all; `ask(task, nick)`
  // is the single dialogue bubble proposing the job (merging any
  // yes/no-then-reveal flavor into one propose-and-choose beat, matching
  // how every other task offer in this game already reads).
  const REQUEST_BONUS_MULTIPLIER = 2;
  function baseReward(items, mult = 1) {
    return Math.max(1, Math.round(items.reduce((sum, it) => sum + it.qty * (deps.ITEM_DEFS[it.itemKey]?.sellPrice || 5), 0) * mult));
  }

  const REQUEST_GIVERS = {
    hreesh: {
      timerDays: 3,
      callOver: nick => `Hey, ${nick}. You need work?`,
      roll: () => {
        const items = [{ itemKey: pickTaskItem('farming', 2), qty: randInt(4, 8) }].filter(it => it.itemKey);
        return { items, timerDays: 3 };
      },
      ask: (task, nick) => {
        const it = task.items[0];
        return `Hey, ${nick}. You need work? Tavern's running low on ${itemLabel(it.itemKey)}, and I'd pay double if you could help me get restocked quickly. I'd need about ${it.qty} within the next ${task.timerDays} days.`;
      },
    },
    furunji_funji: {
      timerDays: 3,
      callOver: nick => `Thank the breath, there you are, ${nick}.`,
      roll: () => {
        const items = [{ itemKey: pickTaskItem('farming', 2), qty: randInt(3, 6) }].filter(it => it.itemKey);
        return { items, timerDays: 3 };
      },
      ask: (task, nick) => {
        const it = task.items[0];
        return `Thank the breath, there you are, ${nick}. I need a bit of extra help restocking, if you wouldn't mind. We're painfully low on ${itemLabel(it.itemKey)}, and if you can get me some soon I'll pay double. If not I can still take it off your hands for a reasonable price.`;
      },
    },
    father_hunundi_hodu: {
      timerDays: 4,
      callOver: nick => `Ah, yes, ${nick}.`,
      roll: () => ({ items: pickTaskItems(['alchemy'], 2, 3, 5, 2), timerDays: 4 }),
      ask: (task, nick) => {
        const [a, b] = task.items;
        return `Ah, yes, ${nick}. Would you be willing to help gather herbs for incense? I need about ${a.qty} ${itemLabel(a.itemKey)}, and ${b.qty} ${itemLabel(b.itemKey)}. The fresher the better.`;
      },
    },
    teacup_unumanuk: {
      timerDays: 4,
      callOver: nick => `Good ${dayPartNow()}, ${nick}.`,
      roll: () => ({ items: pickTaskItems(['alchemy', 'combat', 'fishing'], 3, 2, 4, 2), timerDays: 4 }),
      ask: (task, nick) => {
        const [a, b, c] = task.items;
        return `Good ${dayPartNow()}, ${nick}. Would you be a dear and help gather some reagents for this Uung's spirit calling? I'll need ${a.qty} ${itemLabel(a.itemKey)}, ${b.qty} ${itemLabel(b.itemKey)} and ${c.qty} ${itemLabel(c.itemKey)}. If you don't collect them in time, it's no worry, but if you do, I'll pay double the market price.`;
      },
    },
    kaboku_kunji: {
      timerDays: 3,
      callOver: nick => `Ah, hello there, ${nick}.`,
      roll: () => ({ items: pickTaskItems(['alchemy'], 3, 3, 5, 2), timerDays: 3 }),
      ask: (task, nick) => {
        const [a, b, c] = task.items;
        return `Ah, hello there, ${nick}. Would you be willing to help supply herbs for the shop? As you can probably tell, both me and Kinami are getting quite old, and it gets harder each day to get out to forage. We'll need about ${a.qty} ${itemLabel(a.itemKey)}, ${b.qty} ${itemLabel(b.itemKey)}, and ${c.qty} ${itemLabel(c.itemKey)}. Bring it back quickly and I'll pay double the average price.`;
      },
    },
    // Spearhead is a combat bounty, not a fetch quest — see maybeProposeRequest
    // and acceptRequest, which route it through window.BountyBoard instead of
    // an items/turn-in payout.
    spearhead_unumanuk: {
      timerDays: 6,
      combat: true,
      callOver: nick => `Ah, ${nick}.`,
      ask: (task, nick) => {
        const experienced = task.experienced;
        const pronoun = task.captainGender === 'female' ? 'her' : task.captainGender === 'male' ? 'him' : 'them';
        return `Ah, ${nick}. Would you be interested in taking in a bounty for me? As you might have noticed, this town has only two watchmen, me and Oddclaw, and Hobunji Hollow is the only civilized settlement within hundreds of miles. But if I let these bounties build up, the Empire might think they have to send in reinforcements, and to be honest I'd rather be understaffed than have them going around and locking up my neighbors for victimless crimes. Great. Since you're ${experienced ? 'not a stranger to the process' : 'new'}, I'll send you after one of the ${experienced ? 'more' : 'less'} dangerous gangs in the area. Head into the ${task.zoneLabel} and track down ${task.captainName}'s camp. Kill ${pronoun}, burn the tents and come back. Then we can strike that one off the list.`;
      },
    },
  };

  // One request-giver at a time gets a fresh 'announced' request — called
  // from the day-rollover hooks and once on world load, same cadence the
  // old board notice used. Each eligible giver independently rolls a
  // modest daily chance so they don't all light up at once, and a giver
  // already holding an unresolved request (announced/offered/available)
  // is skipped until it's turned in or declined.
  const REQUEST_DAILY_CHANCE = 0.35;
  function maybeRefreshRequestPostings() {
    const day = deps.calendar.day;
    for (const npcId of Object.keys(REQUEST_GIVERS)) {
      const npcRec = deps.npcWalkers.find(w => w.rec?.id === npcId)?.rec;
      if (!npcRec) continue; // not spawned yet — try again next call
      if (findNpcTask(npcId, 'request', ['announced', 'offered', 'available'])) continue;
      if (findNpcTask(npcId, 'request', ['declined', 'completed'], true)) continue; // already resolved one today
      if (Math.random() > REQUEST_DAILY_CHANCE) continue;
      const giver = REQUEST_GIVERS[npcId];
      if (giver.combat) {
        deps.setQuestStatus(_makeTaskId(), 'announced', {
          kind: 'request', npcId, npcName: npcRec.name || 'the Watch', domain: 'combat',
          items: [], tier: 0, postedDay: day, timerDays: giver.timerDays, deadlineDay: day + giver.timerDays, bonusMultiplier: 1,
        });
        continue;
      }
      const rolled = giver.roll();
      if (!rolled.items?.length) continue;
      const id = _makeTaskId();
      deps.setQuestStatus(id, 'announced', {
        kind: 'request', npcId, npcName: npcRec.name || 'A neighbor', domain: 'mixed',
        items: rolled.items, rewardGold: baseReward(rolled.items), rewardFriendship: TASK_FRIENDSHIP_REWARD.request,
        bonusMultiplier: REQUEST_BONUS_MULTIPLIER, tier: 2, postedDay: day,
        timerDays: rolled.timerDays, deadlineDay: day + rolled.timerDays,
      });
    }
  }

  // The purple ambient call-over line for an NPC currently sitting on an
  // 'announced' request — consumed by ambient-dialogue.js so it can
  // override that NPC's ordinary greeting the next time the player walks
  // up, in place of a random line from the normal greeting pool.
  function pendingRequestGreetingLine(npcId) {
    const pending = findNpcTask(npcId, 'request', ['announced']);
    if (!pending) return null;
    return REQUEST_GIVERS[npcId]?.callOver(playerNickname()) || null;
  }

  // Called from openNpcDialogue for every NPC with an id — returns
  // { task, askText } for the request to propose this conversation
  // (freshly promoted from 'announced', or one already asked-but-not-yet-
  // answered), or null if this NPC has none. Spearhead's target zone/
  // captain is resolved here, the first time it's actually proposed,
  // reserving that bounty immediately (see BountyBoard.reserveForRequest)
  // so the text shown never goes stale before the player answers.
  async function maybeProposeRequest(npcRec) {
    const npcId = npcRec?.id;
    const giver = npcId && REQUEST_GIVERS[npcId];
    if (!giver) return null;
    let pending = findNpcTask(npcId, 'request', ['offered']);
    if (!pending) {
      pending = findNpcTask(npcId, 'request', ['announced']);
      if (!pending) return null;
      let patch = {};
      if (giver.combat) {
        const experienced = Object.values(deps.getQuestProgress()).some(st => st.progress?.kind === 'bounty' && st.status === 'completed');
        const reservation = await window.BountyBoard?.reserveForRequest?.(experienced);
        if (!reservation) return null; // no huntable zone available right now — leave it announced for a later try
        patch = { ...reservation, experienced };
        pending = { ...pending, ...patch };
      }
      deps.setQuestStatus(pending.id, 'offered', patch);
    } else if (giver.combat && pending.bountyTaskId == null) {
      return null; // an 'offered' combat request without a reserved bounty is a stale save — let it quietly drop
    }
    return { task: pending, askText: giver.ask(pending, playerNickname()) };
  }

  function acceptRequest(taskId) {
    const st = deps.getQuestProgress()[taskId];
    const task = st?.progress;
    if (!task || st.status !== 'offered') return { ok: false, message: 'That request is no longer available.' };
    const giver = REQUEST_GIVERS[task.npcId];
    if (giver?.combat) {
      window.BountyBoard?.take(task.bountyTaskId);
      deps.setQuestStatus(taskId, 'completed', {});
      return { ok: true, message: 'Bounty accepted.' };
    }
    deps.setQuestStatus(taskId, 'available', {});
    deps.showToast(`📋 Took on ${task.npcName}'s request.`, true);
    return { ok: true, message: 'Request added to your log.' };
  }

  function declineRequest(taskId) {
    const st = deps.getQuestProgress()[taskId];
    const task = st?.progress;
    const giver = task && REQUEST_GIVERS[task.npcId];
    if (giver?.combat && task.bountyTaskId != null) window.BountyBoard?.cancelPosting?.(task.bountyTaskId);
    deps.setQuestStatus(taskId, 'declined', {});
  }

  // The first quest log entry (request or favor) attributed to this NPC
  // that the player currently has everything for — what powers the
  // in-dialogue turn-in offer (see openNpcDialogue).
  function getTurnInReadyTaskForNpc(npcId) {
    for (const [id, st] of Object.entries(deps.getQuestProgress())) {
      if (st.progress?.npcId !== npcId || st.status !== 'available' || !['request', 'favor'].includes(st.progress?.kind)) continue;
      if ((st.progress.items || []).some(it => (deps.inventory[it.itemKey] || 0) < it.qty)) continue;
      return { id, ...st.progress };
    }
    return null;
  }

  // Active requests/favors point back to their requesting NPC. Pending
  // (not-yet-answered) requests get their own purple '!' marker so the
  // compass can flag a quest-giver before the player has ever talked to
  // them. The compass consumes the walker's live scheduled area/position
  // so it never maintains a second, stale copy of NPC navigation state.
  function compassTargets() {
    const byNpc = new Map(); // Used to collapse multiple active requests/favors for the same NPC into one compass marker.
    for (const [id, state] of Object.entries(deps?.getQuestProgress?.() || {})) {
      const task = state?.progress;
      if (state?.status !== 'available' || !['request', 'favor'].includes(task?.kind) || !task.npcId) continue;
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

  // Purple '!' markers for named quest-givers currently sitting on an
  // 'announced' or 'offered' request the player hasn't resolved yet.
  function pendingRequestCompassTargets() {
    const targets = [];
    for (const [id, state] of Object.entries(deps?.getQuestProgress?.() || {})) {
      const task = state?.progress;
      if (!['announced', 'offered'].includes(state?.status) || task?.kind !== 'request' || !task.npcId) continue;
      const walker = deps.npcWalkers.find(candidate => candidate.rec?.id === task.npcId);
      if (!walker?.root?.position) continue;
      targets.push({
        id: `pending-request:${id}`,
        npcId: task.npcId,
        label: `${task.npcName || walker.rec?.name || task.npcId} has a request`,
        areaId: walker.area || walker.root?._pendingBuildingAdd || (walker.root?._pendingTownAdd ? 'town' : ''),
        col: walker.root.position.x,
        row: walker.root.position.z,
      });
    }
    return targets;
  }

  // Turning a task in only ever happens by talking to the specific NPC
  // who posted/asked it — see openNpcDialogue's turn-in offer and the
  // 'turnInTask' dialogue-choice action. A request delivered by its
  // deadline pays its bonus (double, per every named giver's own promise);
  // delivered late it still pays the plain base price, exactly as Furunji
  // and Eldress Teacup both say ("no worry" / "reasonable price").
  function turnInTask(taskId) {
    const st = deps.getQuestProgress()[taskId];
    const task = st?.progress;
    if (!task?.items?.length || st.status !== 'available') return { ok: false, message: 'That task is not ready to turn in.' };
    const missing = task.items.find(it => (deps.inventory[it.itemKey] || 0) < it.qty);
    if (missing) return { ok: false, message: `You need ${missing.qty}× ${itemLabel(missing.itemKey)}.` };
    task.items.forEach(it => {
      deps.inventory[it.itemKey] -= it.qty;
      deps.clampInventoryStack(it.itemKey);
    });
    const onTime = task.deadlineDay == null || deps.calendar.day <= task.deadlineDay;
    const paidGold = onTime ? Math.round(task.rewardGold * (task.bonusMultiplier || 1)) : task.rewardGold;
    deps.inventory.gold = (deps.inventory.gold || 0) + paidGold;
    window.DialogueContent?.adjustNpcFavor(task.npcId, task.rewardFriendship, 'task_' + task.kind);
    deps.setQuestStatus(taskId, 'completed', {});
    const bonusNote = onTime && task.bonusMultiplier > 1 ? ' (on-time bonus!)' : '';
    deps.showToast(`✅ Task complete! +${paidGold}g${bonusNote}, +${task.rewardFriendship} friendship with ${task.npcName}.`, true);
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
    maybeOfferFavor,
    favorAskLine,
    isRequestGiver: npcId => !!REQUEST_GIVERS[npcId],
    maybeRefreshRequestPostings,
    pendingRequestGreetingLine,
    maybeProposeRequest,
    acceptRequest,
    declineRequest,
    getTurnInReadyTaskForNpc,
    compassTargets,
    pendingRequestCompassTargets,
    turnInTask,
  };
})();
