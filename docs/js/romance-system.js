// Open-ended dating, proposal, wedding and spouse routines.
//
//   Dates      Ask a romanceable NPC out (hold Action 1 on them → wheel, see
//              js/npc-command-wheel.js). While the date lasts (an in-game
//              hour limit from config/romance-config.js) they Follow or Wait
//              on command until Dismissed or the time runs out.
//   Romance    A date-only relationship pool like Rapport: high cap, a -100
//              floor, settles into Favor at midnight at 5x Rapport's weight
//              (NpcRapport.getRomance/adjustRomance own storage + settlement).
//              Each NPC likes a different set of activities (announced on
//              window.HobunjiActivityEvents) and only loses Romance from a
//              short, explicit list (config `losses`).
//   Marriage   Propose to a date with enough hearts/dates, meet at the Life
//              Temple, Father Hunundi marries you, and your spouse moves into
//              the farmhouse: sleeps in your bed, sits in your chairs, potters
//              around the farm, and spends some afternoons back in town.
//
// Children/pregnancy live in js/romance-family.js, which builds on the
// spouse state here. Everything is saved per character per world via
// game.js's saveMemberWorldData (member.romanceState).
(() => {
  'use strict';
  if (window.RomanceSystem) return;

  const cfg = () => window.SCRATCHBONES_CONFIG?.game?.romance || {};
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const TICK_MS = 250; // Genuinely low-frequency bookkeeping (follow catch-up, area hops, timers); see runtime-frame-scheduler.md.

  // Activity → like-id rules. `targeted` likes are aimed at the date
  // themselves (a drink, a dance together), so they skip the proximity check.
  const LIKE_RULES = {
    fish_caught: { match: e => e.type === 'fish_caught' },
    drink_offered: { match: (e, date) => e.type === 'drink_accepted' && e.npcId === date.npcId, targeted: true },
    dancing: { match: (e, date) => e.type === 'dance' || (e.type === 'dance_together' && e.npcId === date.npcId), targeted: e => e.type === 'dance_together' },
    kill_non_barbarian: { match: e => e.type === 'creature_killed' && !e.isBarbarian },
    bandit_or_predator_killed: { match: e => e.type === 'creature_killed' && (e.isBandit || e.isPredator) },
    bandit_killed: { match: e => e.type === 'creature_killed' && e.isBandit },
    crop_harvested: { match: e => e.type === 'crop_harvested' },
    farm_animal_petted: { match: e => e.type === 'animal_petted' && e.farm },
    animal_petted: { match: e => e.type === 'animal_petted' },
    farm_animal_harvested: { match: e => e.type === 'livestock_harvested' },
    herb_picked: { match: e => e.type === 'herb_picked' },
    meal_cooked: { match: e => e.type === 'meal_cooked' },
    tree_felled: { match: e => e.type === 'tree_felled' },
    rock_broken: { match: e => e.type === 'rock_broken' },
    chest_opened: { match: e => e.type === 'chest_opened' },
    buried_chest_opened: { match: e => e.type === 'chest_opened' && e.buried },
    ore_mined: { match: e => e.type === 'ore_mined' },
    potion_brewed: { match: e => e.type === 'potion_brewed' },
    kurraya_played: { match: e => e.type === 'kurraya_played' },
    nest_stolen: { match: e => e.type === 'nest_stolen' },
  };
  const LOSS_RULES = {
    barbarian_killed: e => e.type === 'creature_killed' && e.isBarbarian,
    nest_stolen: e => e.type === 'nest_stolen',
  };

  let deps = null;
  let state = defaultState();
  let tickTimer = 0;
  let activeScript = null; // Current synthetic conversation (see converse()).
  const debug = { lastLike: null, lastLoss: null, lastDateEnd: null, lastWedding: null };

  function defaultState() {
    return {
      version: 1,
      date: null, // { npcId, mode: 'follow'|'wait', startHour, endHour, waitSpot, likeCounts, likeLastHour, romanceGained, startedRawDay }
      dateCounts: {}, // npcId → completed dates
      lastDateRawDay: {}, // npcId → raw day of the most recent date
      engagement: null, // { npcId, proposedRawDay, weddingFromRawDay }
      spouse: null, // { npcId, marriedRawDay, marriedHourStamp }
      family: null, // owned by js/romance-family.js
    };
  }

  // ── Time ──────────────────────────────────────────────────────────────
  function rawDay() { return Math.max(0, Math.floor(num(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay, 0))); }
  function hourOfDay() { return num(window.CalendarSystem?.getHour?.(), 12); }
  function clockHour() { return ((hourOfDay() % 24) + 24) % 24; }
  // Continuous in-game hours since day 0, robust to the represented clock
  // not spanning a full 24h (a skipped night just reads as elapsed time).
  function hourStamp() { return rawDay() * 24 + hourOfDay(); }
  function inHourWindow(hour, start, end) { return start <= end ? hour >= start && hour < end : (hour >= start || hour < end); }

  // ── NPC lookups ───────────────────────────────────────────────────────
  function walkers() { return deps?.npcWalkers || []; }
  function findWalker(npcId) { return walkers().find(w => w?.rec?.id === npcId && !w._doorstepVisitor) || null; }
  function npcRecord(npcId) { return findWalker(npcId)?.rec || deps?.getNpcRecord?.(npcId) || null; }
  function npcName(npcId) {
    const name = String(npcRecord(npcId)?.name || npcId || 'They');
    return name.split(' ')[0] === 'Father' || name.split(' ')[0] === 'Eldress' ? name : name.split(' ')[0];
  }
  function appearanceOf(rec) {
    const raw = rec?.appearance?.speciesId ? rec.appearance : rec?.avatarEditor?.rawExport?.appearance || null;
    const speciesId = String(raw?.speciesId || rec?.species || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '') || null;
    const gender = raw?.gender === 'female' || raw?.gender === 'male' ? raw.gender : (rec?.gender === 'female' || rec?.gender === 'male' ? rec.gender : null);
    return { speciesId, gender, bodyColors: raw?.bodyColors || null };
  }
  function npcAppearance(npcId) { return appearanceOf(npcRecord(npcId)); }
  function playerAppearance() {
    const profile = window.__hobunjiPlayerProfile || {};
    const ap = profile.appearance || {};
    return { speciesId: ap.speciesId || null, gender: ap.gender || null, bodyColors: ap.bodyColors || null, name: profile.nickname || profile.name || 'you' };
  }
  function likesFor(npcId) { return Array.isArray(cfg().likes?.[npcId]) ? cfg().likes[npcId] : []; }
  function isRomanceable(npcId) {
    const rec = npcRecord(npcId);
    if (!rec || rec._doorstepVisitor || rec.isChild) return false;
    return rec.relationship?.canDate === true || likesFor(npcId).length > 0;
  }
  function heartsFor(npcId) {
    const hearts = window.NpcFavorBalance?.relationshipHeartsForNpc?.(npcId);
    if (Number.isFinite(Number(hearts))) return Number(hearts);
    return num(window.DialogueContent?.getNpcDlgState?.(npcId)?.favor, 0) / 40;
  }

  // ── Presentation helpers ──────────────────────────────────────────────
  function toast(message, good = true) { deps?.showToast?.(message, good); }
  function say(walker, text, accepted = true) {
    if (!walker || !text) return;
    if (window.AmbientDialogue?.showAlcoholOfferResponse) window.AmbientDialogue.showAlcoholOfferResponse(walker, { text, line: text, accepted, reason: 'romance' });
    else toast(`${walker.rec?.name || 'They'}: ${text}`, accepted);
  }
  function showRomancePopup(npcId, amount) {
    const walker = findWalker(npcId);
    if (walker?.root && amount) window.WorldPopupText?.showRelationshipChange?.(walker.root, 'romance', amount);
  }

  // Synthetic multi-step conversation through the ordinary NPC dialogue box.
  // steps: [{ text, choices?: [{ label, run?(), goto?: stepIndex|'end' }] }]
  // A step with no choices shows a single continue option (or closes on the
  // last step). run() may return a new steps array to branch into.
  function converse(walker, steps) {
    if (!walker || !Array.isArray(steps) || !steps.length || !deps?.openDialogueNode) return false;
    activeScript = { steps, walker };
    return deps.openDialogueNode(walker, nodeForStep(0));
  }
  function nodeForStep(index) {
    const script = activeScript;
    const step = script?.steps?.[index];
    if (!step) return null;
    const isLast = index >= script.steps.length - 1;
    if (!step.choices?.length && isLast) return { type: 'line', text: step.text, expression: step.expression || undefined };
    const choices = step.choices?.length ? step.choices : [{ label: '…', goto: index + 1 }];
    return {
      type: 'choice',
      text: step.text,
      expression: step.expression || undefined,
      choices: choices.map((choice, choiceIndex) => ({ label: choice.label, actions: [{ type: 'romance', op: 'choose', step: index, choice: choiceIndex }] })),
    };
  }
  function handleDialogueAction(action) {
    if (action?.op !== 'choose' || !activeScript) return null;
    const step = activeScript.steps[action.step];
    const choices = step?.choices?.length ? step.choices : [{ goto: action.step + 1 }];
    const choice = choices[action.choice];
    if (!choice) return null;
    let branch = null;
    try { branch = choice.run?.() || null; } catch (error) { console.warn('[RomanceSystem] dialogue choice failed', error); }
    if (Array.isArray(branch) && branch.length) {
      activeScript = { steps: branch, walker: activeScript.walker };
      return { node: nodeForStep(0) };
    }
    const next = choice.goto === 'end' ? null : (Number.isInteger(choice.goto) ? choice.goto : null);
    if (next == null) { activeScript = null; return null; } // No skipNav → the dialogue closes naturally.
    const node = nodeForStep(next);
    return node ? { node } : null;
  }

  // ── Dates ─────────────────────────────────────────────────────────────
  function activeDate() { return state.date; }
  function isOnDateWith(npcId) { return state.date?.npcId === npcId; }
  function dateHoursLeft() { return state.date ? Math.max(0, state.date.endHour - hourStamp()) : 0; }

  function askEligibility(npcId) {
    if (!isRomanceable(npcId)) return { ok: false, reason: 'not-romanceable', line: null };
    if (state.date) return { ok: false, reason: 'busy', line: state.date.npcId === npcId ? "We're already out together, silly." : "Aren't you already out with someone today?" };
    const partner = state.spouse?.npcId || state.engagement?.npcId;
    if (partner && partner !== npcId) return { ok: false, reason: 'committed', line: `You're spoken for — ${npcName(partner)} would have something to say about this.` };
    const hour = clockHour();
    if (hour >= 21 || hour < 6) return { ok: false, reason: 'late', line: "It's far too late for that. Ask me tomorrow?" };
    if (num(state.lastDateRawDay[npcId], -99) === rawDay()) return { ok: false, reason: 'already-today', line: "We already went out today. Let's do it again another time." };
    const need = num(cfg().minHeartsToAskOut, 2);
    if (heartsFor(npcId) < need) return { ok: false, reason: 'hearts', line: "Oh… I don't really know you well enough for that yet." };
    return { ok: true, reason: null, line: null };
  }

  function askOnDate(walker) {
    const npcId = walker?.rec?.id;
    if (!npcId) return false;
    const check = askEligibility(npcId);
    if (!check.ok) {
      if (check.line) converse(walker, [{ text: check.line }]);
      return false;
    }
    const hours = num(cfg().dateDurationHours, 4);
    converse(walker, [{
      text: `A date? With me? …I'd like that. I'm yours for the next ${hours} hours — lead the way!`,
      expression: 'smile',
      choices: [{ label: 'Follow me.', run: () => { startDate(npcId); return null; }, goto: 'end' }],
    }]);
    return true;
  }

  function startDate(npcId) {
    const start = hourStamp();
    state.date = {
      npcId,
      mode: 'follow',
      startHour: start,
      endHour: start + num(cfg().dateDurationHours, 4),
      waitSpot: null,
      likeCounts: {},
      likeLastHour: {},
      romanceGained: 0,
      startedRawDay: rawDay(),
    };
    state.lastDateRawDay[npcId] = rawDay();
    toast(`💕 You're on a date with ${npcName(npcId)} for ${num(cfg().dateDurationHours, 4)} hours.`, true);
    persist();
    return true;
  }

  function setDateMode(mode) {
    const date = state.date;
    if (!date || (mode !== 'follow' && mode !== 'wait')) return false;
    const walker = findWalker(date.npcId);
    date.mode = mode;
    if (mode === 'wait') {
      const pos = walker?.root?.position;
      date.waitSpot = walker && pos ? { area: walker.area, c: Math.floor(pos.x), r: Math.floor(pos.z) } : null;
      say(walker, 'I\'ll wait right here.');
    } else {
      date.waitSpot = null;
      say(walker, 'Right behind you!');
    }
    if (walker && mode === 'wait') walker.catchup = 1;
    persist();
    return true;
  }

  function dismissDate() {
    const date = state.date;
    if (!date) return false;
    const elapsed = hourStamp() - date.startHour;
    const early = elapsed < (date.endHour - date.startHour) / 2;
    if (early) applyLoss(date.npcId, 'date_dismissed_early');
    endDate(early ? 'dismissed-early' : 'dismissed');
    return true;
  }

  function endDate(reason) {
    const date = state.date;
    if (!date) return;
    const walker = findWalker(date.npcId);
    if (walker) walker.catchup = 1;
    if (reason === 'expired') {
      const nearby = walker && walker.area === currentNpcArea() && distanceToPlayerTiles(walker) <= num(cfg().likeAwareRadiusTiles, 14) * 1.5;
      if (date.mode === 'wait' && !nearby) applyLoss(date.npcId, 'date_abandoned');
      else if (nearby) awardRomance(date.npcId, num(cfg().dateCompletedRomance, 10), 'date_completed');
    }
    state.dateCounts[date.npcId] = num(state.dateCounts[date.npcId], 0) + 1;
    const total = Math.round(date.romanceGained);
    debug.lastDateEnd = { npcId: date.npcId, reason, romanceGained: total, at: Date.now() };
    state.date = null;
    const name = npcName(date.npcId);
    const farewell = reason === 'expired' ? 'I had a lovely time. I should head home now.' : reason === 'dismissed-early' ? 'Oh… already? Alright then.' : 'Thanks for today. See you around!';
    say(walker, farewell, reason !== 'dismissed-early');
    toast(`💕 Date with ${name} ended (${total >= 0 ? '+' : ''}${total} Romance today).`, total >= 0);
    persist();
  }

  // ── Romance scoring ───────────────────────────────────────────────────
  function awardRomance(npcId, amount, reason) {
    const applied = num(window.NpcRapport?.adjustRomance?.(npcId, amount, reason), 0);
    if (state.date?.npcId === npcId) state.date.romanceGained = num(state.date.romanceGained, 0) + applied;
    if (applied) showRomancePopup(npcId, applied);
    return applied;
  }
  function lossRule(id) { return (cfg().losses || []).find(loss => loss?.id === id) || null; }
  function lossAppliesTo(rule, npcId) { return rule && (rule.who === 'all' || (Array.isArray(rule.who) && rule.who.includes(npcId))); }
  function applyLoss(npcId, lossId) {
    const rule = lossRule(lossId);
    if (!lossAppliesTo(rule, npcId)) return 0;
    const applied = awardRomance(npcId, -Math.abs(num(rule.amount, 10)), lossId);
    debug.lastLoss = { npcId, lossId, applied, at: Date.now() };
    if (applied) toast(`💔 ${npcName(npcId)} didn't like that you ${rule.label || lossId}. (${applied} Romance)`, false);
    return applied;
  }

  function currentNpcArea() { return deps?.normalizeNpcArea?.(deps?.getCurrentArea?.()) || deps?.getCurrentArea?.() || null; }
  function playerTilePos() { return deps?.getPlayerTilePosition?.() || null; }
  function distanceToPlayerTiles(walker) {
    const player = playerTilePos();
    const pos = walker?.root?.position;
    if (!player || !pos) return Infinity;
    return Math.hypot(pos.x - player.x, pos.z - player.z);
  }
  function dateNoticesActivity(walker) {
    return !!walker && walker.area === currentNpcArea() && distanceToPlayerTiles(walker) <= num(cfg().likeAwareRadiusTiles, 14);
  }

  function onActivity(event) {
    const date = state.date;
    if (!date || !event?.type) return;
    const walker = findWalker(date.npcId);
    const aware = dateNoticesActivity(walker);
    for (const [lossId, matches] of Object.entries(LOSS_RULES)) {
      if (aware && matches(event) && lossAppliesTo(lossRule(lossId), date.npcId)) applyLoss(date.npcId, lossId);
    }
    for (const likeId of likesFor(date.npcId)) {
      const rule = LIKE_RULES[likeId];
      if (!rule?.match(event, date)) continue;
      const targeted = typeof rule.targeted === 'function' ? rule.targeted(event) : !!rule.targeted;
      if (!targeted && !aware) continue;
      scoreLike(date, likeId, walker);
      break; // One activity scores at most one like (e.g. a bandit kill isn't both "a kill" and "a bandit").
    }
  }

  function scoreLike(date, likeId, walker) {
    const now = hourStamp();
    const cooldownHours = num(cfg().likeCooldownGameMinutes, 6) / 60;
    if (now - num(date.likeLastHour[likeId], -Infinity) < cooldownHours) return 0;
    const count = num(date.likeCounts[likeId], 0);
    const amount = Math.max(num(cfg().minRepeatLikeRomance, 2), Math.round(num(cfg().baseLikeRomance, 14) * Math.pow(num(cfg().repeatLikeDecay, 0.6), count)));
    date.likeCounts[likeId] = count + 1;
    date.likeLastHour[likeId] = now;
    const applied = awardRomance(date.npcId, amount, `like:${likeId}`);
    const label = cfg().likeLabels?.[likeId] || likeId;
    debug.lastLike = { npcId: date.npcId, likeId, applied, at: Date.now() };
    if (applied > 0) {
      if (count === 0) say(walker, likeReaction(likeId));
      toast(`💗 ${npcName(date.npcId)} loves ${label}! (+${applied} Romance)`, true);
    }
    return applied;
  }
  function likeReaction(likeId) {
    const lines = {
      fish_caught: 'Nice catch!', drink_offered: "Don't mind if I do!", dancing: 'Look at us go!',
      kill_non_barbarian: 'Ha! Got it!', bandit_or_predator_killed: 'That one had it coming.', bandit_killed: 'One less bandit!',
      crop_harvested: 'Look how well that grew!', farm_animal_petted: "Aww, they love you.", animal_petted: 'Aww, look at them!',
      farm_animal_harvested: 'Well cared for animals give so much.', herb_picked: 'Ooh, a good herb.', meal_cooked: 'That smells wonderful.',
      tree_felled: 'Timber!', rock_broken: 'Strong arm!', chest_opened: "Treasure! What's inside?", buried_chest_opened: 'Buried treasure, ha!',
      ore_mined: 'Good ore, that.', potion_brewed: 'Clever brewing.', kurraya_played: 'Play me another!', nest_stolen: 'Sneaky… I like it.',
    };
    return lines[likeId] || 'I liked that!';
  }

  // ── Marriage ──────────────────────────────────────────────────────────
  function proposalEligibility(npcId) {
    const rec = npcRecord(npcId);
    if (!isRomanceable(npcId) || rec?.relationship?.canMarry === false) return { ok: false, line: null };
    if (state.spouse || state.engagement) return { ok: false, line: null };
    if (!isOnDateWith(npcId)) return { ok: false, line: null };
    if (heartsFor(npcId) < num(cfg().minHeartsToPropose, 10)) return { ok: false, line: "You're sweet… but I'm not ready for that. Not yet." };
    if (num(state.dateCounts[npcId], 0) < num(cfg().minDatesToPropose, 3)) return { ok: false, line: "We've barely courted! Take me out a few more times first." };
    return { ok: true, line: null };
  }
  function canPropose(npcId) { return proposalEligibility(npcId).ok; }

  function propose(walker) {
    const npcId = walker?.rec?.id;
    const check = proposalEligibility(npcId);
    if (!check.ok) {
      if (check.line) converse(walker, [{ text: check.line }]);
      return false;
    }
    converse(walker, [
      { text: 'You… you want to marry me?', expression: 'surprised', choices: [
        { label: 'Will you marry me?', goto: 1 },
        { label: 'Never mind.', goto: 'end' },
      ] },
      { text: "Yes! Yes, of course I will! Meet me at the Life Temple — Father Hunundi can marry us from tomorrow, any time during the day.", expression: 'smile',
        choices: [{ label: "I'll be there.", run: () => { engage(npcId); return null; }, goto: 'end' }] },
    ]);
    return true;
  }

  function engage(npcId) {
    state.engagement = { npcId, proposedRawDay: rawDay(), weddingFromRawDay: rawDay() + Math.max(0, num(cfg().weddingDelayDays, 1)) };
    if (state.date?.npcId === npcId) endDate('dismissed');
    toast(`💍 You're engaged to ${npcName(npcId)}! Meet at the Life Temple from tomorrow.`, true);
    persist();
  }

  function weddingWindowOpen() {
    const eng = state.engagement;
    if (!eng || rawDay() < num(eng.weddingFromRawDay, Infinity)) return false;
    const hours = cfg().weddingHours || { start: 8, end: 20 };
    return inHourWindow(clockHour(), num(hours.start, 8), num(hours.end, 20));
  }

  let weddingInProgress = false;
  let weddingSnoozed = false; // Set once a ceremony was offered and not completed; cleared when the player leaves the temple.
  // The ceremony itself is an authored cutscene on the temple's Wedding
  // layout (js/romance-wedding.js); this only decides when it starts. One
  // offer per temple visit: declining ("Not today") or leaving waits for the
  // next visit.
  async function maybeStartWedding() {
    const temple = cfg().templeAreaId || 'map_i_temple';
    const inTemple = deps?.getCurrentArea?.() === temple;
    if (!inTemple) { weddingSnoozed = false; return; }
    if (weddingInProgress || weddingSnoozed || !weddingWindowOpen()) return;
    if (deps?.isDialogueOpen?.() || window.AuthoredCutsceneRuntime?.isActive?.() || !window.RomanceWedding?.play) return;
    const eng = state.engagement;
    weddingInProgress = true;
    weddingSnoozed = true;
    try {
      const wed = await window.RomanceWedding.play({ spouseId: eng.npcId, officiantId: cfg().officiantNpcId || 'father_hunundi_hodu' });
      if (wed) completeWedding(eng.npcId);
    } catch (error) {
      console.warn('[RomanceSystem] wedding failed', error);
    } finally {
      weddingInProgress = false;
    }
  }

  function completeWedding(npcId) {
    weddingInProgress = false;
    state.engagement = null;
    state.spouse = { npcId, marriedRawDay: rawDay(), marriedHourStamp: hourStamp() };
    debug.lastWedding = { npcId, rawDay: rawDay(), at: Date.now() };
    window.DialogueContent?.recordNpcMemory?.(npcId, 'married');
    toast(`💒 You married ${npcName(npcId)}! They'll move into the farmhouse.`, true);
    window.HobunjiActivityEvents?.emit('married', { npcId });
    persist();
  }

  // ── Spouse routine ────────────────────────────────────────────────────
  function hashInt(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function nearestWalkable(area, c, r, radius = 4) {
    const walkable = window.NpcPathfinding?.isNpcTileWalkable;
    if (!walkable) return { c, r };
    for (let d = 0; d <= radius; d++) {
      for (let dr = -d; dr <= d; dr++) {
        for (let dc = -d; dc <= d; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
          if (walkable(area, c + dc, r + dr)) return { c: c + dc, r: r + dr };
        }
      }
    }
    return null;
  }
  function farmhouseDoorAnchor() {
    const groups = window.HousePieces?.debugPieceFeatures?.() || [];
    for (const group of groups) {
      for (const feature of (group.features || [])) {
        if (feature.type !== 'entrance' || feature.invalid || !feature.doorTile) continue;
        const [c, r] = String(feature.doorTile).split(',').map(Number);
        const [ac, ar] = String(feature.approachTile || '').split(',').map(Number);
        if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
        const dc = Number.isFinite(ac) ? Math.sign(ac - c) : 0;
        const dr = Number.isFinite(ar) ? Math.sign(ar - r) : 1;
        return nearestWalkable('farm', c + dc * 3, r + dr * 3, 5);
      }
    }
    return null;
  }
  function bedSpot() {
    const beds = (deps?.getInteriorFurniture?.() || []).filter(obj => obj?.area === 'interior' && /bed/i.test(String(obj.key || '')));
    const bed = beds.find(obj => obj.key === 'doubleBed') || beds[0];
    if (!bed) return null;
    const spot = nearestWalkable('interior', bed.col, bed.row, 2);
    return spot ? { area: 'interior', c: spot.c, r: spot.r, rotY: bed.rotYDeg || 0, bed } : null;
  }
  function seatStations() {
    const find = window.NpcScheduling?.findStationsByRole;
    if (!find) return [];
    return [...find('sit', { area: 'interior' }), ...find('sit', { area: 'farm' })];
  }

  // Spouse target: sleep in the farmhouse bed, sit in chairs, potter around
  // the farm, and spend some afternoons in town (their pre-marriage schedule).
  function spouseTarget(rec) {
    const spouse = state.spouse;
    if (!spouse || rec.id !== spouse.npcId || state.date?.npcId === rec.id) return null;
    const familyOverride = window.RomanceFamily?.spouseTargetOverride?.(rec, { bedSpot, farmhouseDoorAnchor });
    if (familyOverride) return familyOverride;
    const scfg = cfg().spouse || {};
    const hour = clockHour();
    const sleep = scfg.sleepHours || { start: 22, end: 7 };
    if (inHourWindow(hour, num(sleep.start, 22), num(sleep.end, 7))) {
      const bed = bedSpot();
      if (bed) return { area: bed.area, c: bed.c, r: bed.r, rotY: bed.rotY, activity: 'sleeping', stationId: 'spouse_bed' };
    }
    const town = scfg.townAfternoon || { start: 12, end: 17, daysOfWeekMod: 3 };
    const mod = Math.max(1, Math.floor(num(town.daysOfWeekMod, 3)));
    if (inHourWindow(hour, num(town.start, 12), num(town.end, 17)) && (rawDay() + hashInt(rec.id)) % mod === 0) return null; // Back in town on their old schedule.
    const blockMinutes = Math.max(15, num(scfg.seatBlockMinutes, 90));
    const block = Math.floor(hourStamp() * 60 / blockMinutes);
    const roll = hashInt(`${rec.id}:${block}`);
    const seats = seatStations();
    if (seats.length && roll % 3 !== 2) {
      const seat = seats[roll % seats.length];
      return { ...seat, activity: 'relaxing at home' };
    }
    const anchor = farmhouseDoorAnchor();
    if (anchor) return { area: 'farm', c: anchor.c, r: anchor.r, activity: 'pottering around the farm', stationId: 'spouse_farm_wander', wanderMode: 'radius', wanderRadiusTiles: num(scfg.farmWanderRadiusTiles, 6) };
    const bed = bedSpot();
    return bed ? { area: bed.area, c: bed.c, r: bed.r, activity: 'at home' } : null;
  }

  function engagedTarget(rec) {
    const eng = state.engagement;
    if (!eng || rec.id !== eng.npcId || state.date?.npcId === rec.id || !weddingWindowOpen()) return null;
    const temple = cfg().templeAreaId || 'map_i_temple';
    const officiant = findWalker(cfg().officiantNpcId || 'father_hunundi_hodu');
    if (officiant?.area === temple && officiant.root) {
      const spot = nearestWalkable(temple, Math.floor(officiant.root.position.x) + 1, Math.floor(officiant.root.position.z) + 1, 3);
      if (spot) return { area: temple, c: spot.c, r: spot.r, activity: 'waiting to be wed' };
    }
    return null;
  }

  // ── Date movement (follow / wait) ─────────────────────────────────────
  function dateTarget(rec) {
    const date = state.date;
    if (!date || rec.id !== date.npcId) return null;
    if (date.mode === 'wait' && date.waitSpot) return { ...date.waitSpot, activity: 'waiting for you' };
    const walker = findWalker(rec.id);
    const player = playerTilePos();
    const area = currentNpcArea();
    if (!player || !area || !deps?.canHostNpc?.(area)) return walker ? { area: walker.area, c: Math.floor(walker.root.position.x), r: Math.floor(walker.root.position.z), activity: 'waiting for you' } : null;
    const pc = Math.floor(player.x), pr = Math.floor(player.z);
    if (!walker || walker.area !== area) return { area, c: pc, r: pr, activity: 'following you' };
    const pos = walker.root.position;
    const dx = pos.x - player.x, dz = pos.z - player.z;
    const dist = Math.hypot(dx, dz);
    const follow = num(cfg().followDistanceTiles, 1.7);
    if (dist <= follow + 0.45) return { area, c: Math.floor(pos.x), r: Math.floor(pos.z), activity: 'following you' };
    const tx = player.x + dx / dist * follow, tz = player.z + dz / dist * follow;
    const tc = Math.floor(tx), tr = Math.floor(tz);
    const walkable = window.NpcPathfinding?.isNpcTileWalkable?.(area, tc, tr) !== false;
    return walkable ? { area, c: tc, r: tr, activity: 'following you' } : { area, c: pc, r: pr, activity: 'following you' };
  }

  function scheduleOverride(rec) {
    return dateTarget(rec) || engagedTarget(rec) || spouseTarget(rec);
  }

  function tick() {
    if (!deps) return;
    const date = state.date;
    if (date) {
      const walker = findWalker(date.npcId);
      if (hourStamp() >= num(date.endHour, Infinity)) { endDate('expired'); return; }
      if (walker && date.mode === 'follow') {
        const area = currentNpcArea();
        if (area && walker.area !== area && deps.canHostNpc?.(area)) {
          const player = playerTilePos();
          const spot = player && nearestWalkable(area, Math.floor(player.x), Math.floor(player.z), 3);
          if (spot) walker.transferToArea(area, spot); // Dates hop areas with you rather than walking the long way round.
        }
        const dist = distanceToPlayerTiles(walker);
        const catchUp = num(cfg().followCatchUpDistanceTiles, 4);
        walker.catchup = dist > catchUp ? clamp(1 + (dist - catchUp) * 0.35, 1, num(cfg().followMaxSpeedMultiplier, 3.2)) : 1.6;
      }
    }
    maybeStartWedding();
    window.RomanceWedding?.tick?.(deps.getCurrentArea?.());
    window.RomanceFamily?.tick?.();
  }

  // ── Command wheel options (consumed by js/npc-command-wheel.js) ───────
  function commandOptionsFor(walker) {
    const npcId = walker?.rec?.id;
    if (!npcId || walker._doorstepVisitor) return [];
    const options = [];
    if (isOnDateWith(npcId)) {
      const mode = state.date.mode;
      options.push({ id: 'follow', icon: '👣', label: mode === 'follow' ? 'Following' : 'Follow', active: mode === 'follow', run: () => setDateMode('follow') });
      options.push({ id: 'wait', icon: '✋', label: mode === 'wait' ? 'Waiting' : 'Wait', active: mode === 'wait', run: () => setDateMode('wait') });
      options.push({ id: 'dismiss', icon: '👋', label: 'Dismiss', run: () => dismissDate() });
      if (canPropose(npcId)) options.push({ id: 'propose', icon: '💍', label: 'Propose', run: () => propose(walker) });
      else if (!state.spouse && !state.engagement && isRomanceable(npcId) && npcRecord(npcId)?.relationship?.canMarry !== false) {
        options.push({ id: 'propose', icon: '💍', label: 'Propose', run: () => propose(walker), muted: true });
      }
    } else if (isRomanceable(npcId)) {
      const check = askEligibility(npcId);
      options.push({ id: 'date', icon: '💕', label: 'Ask on a Date', muted: !check.ok, run: () => askOnDate(walker) });
    }
    const familyOptions = window.RomanceFamily?.commandOptionsFor?.(walker) || [];
    options.push(...familyOptions);
    if (!options.length) return [];
    return [{ id: 'talk', icon: '💬', label: 'Talk', run: () => deps.openNpcDialogue?.(walker) }, ...options];
  }

  // ── Persistence ───────────────────────────────────────────────────────
  function persist() { try { deps?.saveMemberWorldData?.(); } catch (_) {} }
  function serialize() {
    return JSON.parse(JSON.stringify({ ...state, family: window.RomanceFamily?.serialize?.() ?? state.family ?? null }));
  }
  function restore(saved) {
    const base = defaultState();
    state = saved && typeof saved === 'object' ? { ...base, ...saved, dateCounts: { ...(saved.dateCounts || {}) }, lastDateRawDay: { ...(saved.lastDateRawDay || {}) } } : base;
    if (state.date && !Number.isFinite(Number(state.date.endHour))) state.date = null;
    if (state.date) {
      state.date.likeCounts = { ...(state.date.likeCounts || {}) };
      state.date.likeLastHour = { ...(state.date.likeLastHour || {}) };
    }
    window.RomanceFamily?.restore?.(state.family || null);
  }

  // ── Wiring ────────────────────────────────────────────────────────────
  function init(injected) {
    deps = injected || {};
    window.DialogueContent?.registerActionHandler?.('romance', handleDialogueAction);
    window.NpcScheduling?.registerTargetOverride?.('romance', scheduleOverride);
    window.HobunjiActivityEvents?.on?.(onActivity);
    window.RomanceFamily?.init?.(api);
    window.RomanceWedding?.init?.(deps);
    if (!tickTimer) tickTimer = setInterval(() => { try { tick(); } catch (error) { console.warn('[RomanceSystem] tick failed', error); } }, TICK_MS);
    return api;
  }

  function snapshot() {
    return {
      date: state.date ? { ...state.date, hoursLeft: Math.round(dateHoursLeft() * 100) / 100 } : null,
      dateCounts: { ...state.dateCounts },
      engagement: state.engagement ? { ...state.engagement } : null,
      spouse: state.spouse ? { ...state.spouse } : null,
      family: window.RomanceFamily?.snapshot?.() || null,
      debug: { ...debug },
    };
  }

  const api = {
    init,
    serialize,
    restore,
    snapshot,
    // Dates
    askEligibility,
    askOnDate,
    startDate,
    setDateMode,
    dismissDate,
    endDate,
    activeDate,
    isOnDateWith,
    dateHoursLeft,
    commandOptionsFor,
    onActivity,
    // Marriage
    canPropose,
    propose,
    engage,
    completeWedding,
    getSpouse: () => state.spouse ? { ...state.spouse } : null,
    getEngagement: () => state.engagement ? { ...state.engagement } : null,
    // Shared helpers for js/romance-family.js
    helpers: {
      cfg, rawDay, hourStamp, clockHour, findWalker, npcRecord, npcName, npcAppearance, playerAppearance,
      appearanceOf, say, toast, converse, persist, nearestWalkable, bedSpot, farmhouseDoorAnchor, hashInt,
      deps: () => deps,
    },
    _test: { LIKE_RULES, LOSS_RULES, scheduleOverride, tick, dateTarget, spouseTarget, getState: () => state },
  };
  window.RomanceSystem = api;
})();
