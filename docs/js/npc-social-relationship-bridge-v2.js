(() => {
  'use strict';
  if (window.NpcRapport?.eventDriven) return;

  const DEFAULTS = Object.freeze({ // Used as modular defaults for social rules; authored config can override every value.
    representedMinutesPerDay: 1440,
    drinkAcceptedCooldownMinutes: 30,
    rapportToFavorRate: 0.10,
    rapportMin: 0,
    rapportMax: 100,
    playerOfferRelationshipProbeRadiusTiles: 2,
    rapportDeltas: Object.freeze({ drinkAccepted: 4, danceWithPlayer: 3, playerMusicDance: 2, giftLoved: 10, giftLiked: 4, giftNeutral: 1, giftDisliked: -4, giftHated: -10 }),
  });
  const root = window.SCRATCHBONES_CONFIG = window.SCRATCHBONES_CONFIG || {}; // Existing config root used by the rest of the game.
  root.game = root.game || {};
  const authored = root.game.socialRelationships || {}; // User-authored overrides retained across this bridge.
  const config = root.game.socialRelationships = { ...DEFAULTS, ...authored, rapportDeltas: { ...DEFAULTS.rapportDeltas, ...(authored.rapportDeltas || {}) } };
  const touchedNpcIds = new Set(); // NPCs whose existing relationship records gained social metadata.
  const drinkState = new Map(); // Accepted-sip timestamps and last hidden roll, keyed by NPC id.
  const activeDanceByNpc = new Map(); // Current accepted dance stimulus per NPC so entry awards happen once.
  let dialoguePatched = false; // One-shot guard for relationship save/load wrappers.
  let giftingPatched = false; // One-shot guard for daily gift wrappers.
  let alcoholPatched = false; // One-shot guard for drink wrappers.
  let plannerPatched = false; // Debug/guard flag for the event-driven planner wrapper.

  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  function rawDay() {
    const debug = window.CalendarSystem?.timeDebugSnapshot?.();
    return Math.max(0, Math.floor(num(debug?.rawDay, window.calendar?.day || 0)));
  }
  function time01() {
    const debug = window.CalendarSystem?.timeDebugSnapshot?.();
    return clamp(num(debug?.time01, window.time01 || 0), 0, 0.999999);
  }
  function clockHour() { return num(window.CalendarSystem?.getHour?.(), NaN); }
  function socialDay() {
    const day = rawDay();
    const hour = clockHour();
    return window.CalendarSystem?.constants?.FULL_DAY_CYCLE && Number.isFinite(hour) && hour >= 24 ? day + 1 : day;
  }
  function absoluteGameMinute() {
    const minutes = Math.max(1, num(config.representedMinutesPerDay, DEFAULTS.representedMinutesPerDay));
    return rawDay() * minutes + time01() * minutes;
  }
  function rawRelationship(npcId) {
    const id = String(npcId || '');
    return id ? (window.DialogueContent?.getNpcDlgState?.(id) || window.DialogueContent?.npcDlgState?.get?.(id) || null) : null;
  }
  function settle(npcId, state = rawRelationship(npcId)) {
    if (!state) return 0;
    const today = socialDay();
    const stateDay = Number.isFinite(Number(state.rapportDay)) ? Math.floor(Number(state.rapportDay)) : today;
    if (stateDay >= today) { state.rapportDay = today; return 0; }
    const oldRapport = clamp(num(state.rapport, 0), num(config.rapportMin, 0), num(config.rapportMax, 100));
    const favorGain = Math.round(oldRapport * Math.max(0, num(config.rapportToFavorRate, DEFAULTS.rapportToFavorRate)));
    state.rapport = 0;
    state.rapportDay = today;
    if (favorGain) {
      state.favor = num(state.favor, 0) + favorGain;
      if (Array.isArray(state.memory)) state.memory.push({ type: 'rapport_rollover', day: today, amount: favorGain, sourceRapport: oldRapport });
      window.__farmLog?.(`Rapport with ${npcId} became ${favorGain} permanent favor at midnight.`);
    }
    return favorGain;
  }
  function relationship(npcId) {
    const id = String(npcId || '');
    const state = rawRelationship(id);
    if (!state) return null;
    touchedNpcIds.add(id);
    if (!Number.isFinite(Number(state.rapport))) state.rapport = 0;
    if (!Number.isFinite(Number(state.rapportDay))) state.rapportDay = socialDay();
    if (!Number.isFinite(Number(state.lastGiftDay))) state.lastGiftDay = -1;
    settle(id, state);
    return state;
  }
  function get(npcId) {
    const state = relationship(npcId);
    return state ? clamp(num(state.rapport, 0), num(config.rapportMin, 0), num(config.rapportMax, 100)) : 0;
  }
  function adjust(npcId, amount, reason = 'social') {
    const state = relationship(npcId);
    if (!state) return 0;
    const before = get(npcId);
    const after = clamp(before + num(amount, 0), num(config.rapportMin, 0), num(config.rapportMax, 100));
    state.rapport = after;
    state.rapportDay = socialDay();
    if (after !== before && Array.isArray(state.memory)) state.memory.push({ type: 'rapport', day: socialDay(), amount: after - before, reason: String(reason || 'social') });
    return after - before;
  }
  function canGiftToday(npcId) {
    const state = relationship(npcId);
    return !!state && Math.floor(num(state.lastGiftDay, -1)) !== socialDay();
  }
  function markGiftedToday(npcId) {
    const state = relationship(npcId);
    if (!state) return false;
    state.lastGiftDay = socialDay();
    return true;
  }
  function flushRollover() { for (const id of touchedNpcIds) settle(id); }

  function patchDialogue() {
    const dialogue = window.DialogueContent;
    if (dialoguePatched || !dialogue?.npcRelationshipsSnapshot || !dialogue?.loadNpcRelationships) return false;
    dialoguePatched = true;
    const originalGetState = typeof dialogue.getNpcDlgState === 'function' ? dialogue.getNpcDlgState.bind(dialogue) : null; // Existing relationship getter becomes the event boundary for midnight settlement.
    if (originalGetState) {
      dialogue.getNpcDlgState = function getNpcDlgStateWithRapportRollover(npcId, ...args) {
        const state = originalGetState(npcId, ...args);
        const id = String(npcId || '');
        if (id && state) {
          touchedNpcIds.add(id);
          if (!Number.isFinite(Number(state.rapport))) state.rapport = 0;
          if (!Number.isFinite(Number(state.rapportDay))) state.rapportDay = socialDay();
          if (!Number.isFinite(Number(state.lastGiftDay))) state.lastGiftDay = -1;
          settle(id, state);
        }
        return state;
      };
    }
    const originalSnapshot = dialogue.npcRelationshipsSnapshot.bind(dialogue); // Legacy relationship serializer remains authoritative.
    dialogue.npcRelationshipsSnapshot = function (...args) {
      flushRollover();
      const snapshot = originalSnapshot(...args) || {};
      for (const id of new Set([...Object.keys(snapshot), ...touchedNpcIds])) {
        const state = relationship(id);
        if (!state) continue;
        snapshot[id] = snapshot[id] || {};
        snapshot[id].rapport = get(id);
        snapshot[id].rapportDay = Math.floor(num(state.rapportDay, socialDay()));
        snapshot[id].lastGiftDay = Math.floor(num(state.lastGiftDay, -1));
      }
      return snapshot;
    };
    const originalLoad = dialogue.loadNpcRelationships.bind(dialogue); // Legacy loader runs first so all existing fields stay intact.
    dialogue.loadNpcRelationships = function (playerData, ...args) {
      const result = originalLoad(playerData, ...args);
      for (const [id, saved] of Object.entries(playerData?.npcRelationships || {})) {
        const state = rawRelationship(id);
        if (!state) continue;
        touchedNpcIds.add(id);
        state.rapport = clamp(num(saved?.rapport, 0), num(config.rapportMin, 0), num(config.rapportMax, 100));
        state.rapportDay = Number.isFinite(Number(saved?.rapportDay)) ? Math.floor(Number(saved.rapportDay)) : socialDay();
        state.lastGiftDay = Number.isFinite(Number(saved?.lastGiftDay)) ? Math.floor(Number(saved.lastGiftDay)) : -1;
        settle(id, state);
      }
      return result;
    };
    return true;
  }

  function giftDelta(tier) {
    const key = `gift${String(tier || 'neutral').replace(/^./, c => c.toUpperCase())}`;
    return num(config.rapportDeltas?.[key], 0);
  }
  function patchGifting() {
    const gifting = window.NpcGifting;
    const dialogue = window.DialogueContent;
    if (giftingPatched || !gifting?.getNpcGiftOfferAction || !gifting?.offerGift || !dialogue?.adjustNpcFavor) return false;
    giftingPatched = true;
    const getAction = gifting.getNpcGiftOfferAction.bind(gifting); // Existing gift eligibility remains authoritative before the daily gate.
    gifting.getNpcGiftOfferAction = (walker, ...args) => {
      const id = String(walker?.rec?.id || '');
      return id && !canGiftToday(id) ? null : getAction(walker, ...args);
    };
    const offerGift = gifting.offerGift.bind(gifting); // Existing inventory/reaction flow still performs the actual gift.
    gifting.offerGift = function (walker, ...args) {
      const id = String(walker?.rec?.id || '');
      if (!id || !canGiftToday(id)) { window.__farmLog?.(`${walker?.rec?.name || 'They'} already received a gift today.`); return false; }
      const originalAdjust = dialogue.adjustNpcFavor;
      let giftReaction = false; // Marks that the existing gift flow actually produced a gift_* relationship result.
      dialogue.adjustNpcFavor = function (targetId, delta, reason, ...favorArgs) {
        if (String(targetId) === id && String(reason || '').startsWith('gift_')) {
          giftReaction = true;
          adjust(id, giftDelta(String(reason).slice(5)), reason);
          return get(id);
        }
        return originalAdjust.call(dialogue, targetId, delta, reason, ...favorArgs);
      };
      try {
        const result = offerGift(walker, ...args);
        if (result) markGiftedToday(id);
        return result;
      } finally {
        dialogue.adjustNpcFavor = originalAdjust;
        if (giftReaction) touchedNpcIds.add(id);
      }
    };
    return true;
  }

  function contextualStimulus(walker) {
    const x = num(walker?.root?.position?.x, num(walker?.x, 0));
    const z = num(walker?.root?.position?.z, num(walker?.z, 0));
    const candidates = [];
    for (const stimulus of window.NpcSocialStimuli?.getActive?.(walker?.area) || []) {
      if (!['music', 'dance'].includes(stimulus?.type) || (stimulus.sourceNpcId && stimulus.sourceNpcId === walker?.rec?.id)) continue;
      const radius = Math.max(0.01, num(stimulus.radius, 8));
      const distance = Math.hypot(x - num(stimulus.x, x), z - num(stimulus.z, z));
      if (distance > radius) continue;
      const proximity = clamp(1 - distance / radius, 0, 1);
      candidates.push({ stimulus, distance, proximity, score: num(stimulus.strength, 0.6) * proximity });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length) return candidates[0];
    return { stimulus: { id: `rapport-liquor-context:${walker?.rec?.id || 'npc'}`, type: 'neutral', sourceIsPlayer: false, strength: 0, radius: 1, x, z }, distance: 0, proximity: 1, score: 0 };
  }
  function gameplayRandom() {
    const value = Number(window.GameRandom?.random?.());
    return Number.isFinite(value) ? clamp(value, 0, 0.999999999) : Math.random();
  }
  function sharedInhibitionRoll(walker) {
    const evaluator = window.NpcSocialInhibition;
    const rec = walker?.rec;
    if (!evaluator?.evaluate || !rec) return { accepted: true, draw: 100, effective: 1, modifiers: [], blockedReason: null };
    const context = contextualStimulus(walker);
    const attemptId = `rapport-liquor:${rec.id || 'npc'}:${Math.floor(absoluteGameMinute())}`;
    const result = evaluator.evaluate(rec, walker, { ...context, stimulus: { ...context.stimulus, id: attemptId } }, walker?.currentScheduleTarget || null);
    const probeStimulus = { ...context.stimulus, id: `${attemptId}:relationship`, type: 'dance', sourceIsPlayer: true, strength: 0, radius: Math.max(1, num(config.playerOfferRelationshipProbeRadiusTiles, DEFAULTS.playerOfferRelationshipProbeRadiusTiles)) };
    const probe = evaluator.evaluate(rec, walker, { stimulus: probeStimulus, distance: 0, proximity: 1 }, walker?.currentScheduleTarget || null);
    const relationshipModifier = (probe?.modifiers || []).find(mod => mod?.key === 'player-dance-invitation');
    const baseHasRelationship = (result?.modifiers || []).some(mod => mod?.key === 'player-dance-invitation');
    const effective = clamp(num(result?.effectiveInhibition, 99) + (baseHasRelationship ? 0 : num(relationshipModifier?.amount, 0)), 1, 99);
    const draw = Math.floor(gameplayRandom() * 100) + 1;
    return { accepted: !result?.blocked && draw >= effective, draw, effective, modifiers: result?.modifiers || [], blockedReason: result?.blocked ? 'blocked' : null };
  }
  function drinkRecord(id) {
    if (!drinkState.has(id)) drinkState.set(id, { lastAcceptedSwigMinute: null, lastCheck: null });
    return drinkState.get(id);
  }
  function drinkCooldownRemaining(npcId) {
    const record = drinkState.get(String(npcId || '')); // Used to distinguish a never-accepted/refused offer from a real accepted-sip timestamp.
    if (!record || record.lastAcceptedSwigMinute == null) return 0;
    const last = Number(record.lastAcceptedSwigMinute);
    if (!Number.isFinite(last)) return 0;
    return Math.max(0, Math.max(0, num(config.drinkAcceptedCooldownMinutes, DEFAULTS.drinkAcceptedCooldownMinutes)) - Math.max(0, absoluteGameMinute() - last));
  }
  function bottleSignature(bridge) {
    try { return JSON.stringify(bridge?.serializeBottleSwigs?.() || null); } catch (_) { return ''; }
  }
  function refuseDrink(walker, reason) {
    const text = reason === 'cooldown' ? `${walker?.rec?.name || 'They'} has had enough for the moment.` : `${walker?.rec?.name || 'They'} declines the drink.`;
    if (window.AmbientDialogue?.showAlcoholOfferResponse) window.AmbientDialogue.showAlcoholOfferResponse(walker, { text, line: text, accepted: false, reason });
    else window.__farmLog?.(text);
  }
  function patchAlcohol() {
    const bridge = window.HobunjiDrunkGameplayBridge;
    if (alcoholPatched || !bridge?.getNpcSwigOfferAction || !bridge?.offerNpcSwig) return false;
    alcoholPatched = true;
    // Keep the legacy offer action visible. The 30-minute rule governs whether
    // an NPC can accept another sip, not whether the player is allowed to offer.
    const offer = bridge.offerNpcSwig.bind(bridge); // Existing alcohol flow still consumes the sip and applies drunkenness.
    bridge.offerNpcSwig = function (walker, ...args) {
      const id = String(walker?.rec?.id || '');
      if (!id) return false;
      if (drinkCooldownRemaining(id) > 0) { refuseDrink(walker, 'cooldown'); return false; }
      const roll = sharedInhibitionRoll(walker);
      drinkRecord(id).lastCheck = { ...roll, gameMinute: absoluteGameMinute() };
      if (!roll.accepted) { refuseDrink(walker, 'inhibition'); return false; }
      const before = bottleSignature(bridge);
      const result = offer(walker, ...args);
      if (before !== bottleSignature(bridge)) {
        drinkRecord(id).lastAcceptedSwigMinute = absoluteGameMinute();
        adjust(id, num(config.rapportDeltas?.drinkAccepted, DEFAULTS.rapportDeltas.drinkAccepted), 'drink_accepted');
      }
      return result;
    };
    if (bridge.serializeNpcAlcoholState && bridge.restoreNpcAlcoholState) {
      const serialize = bridge.serializeNpcAlcoholState.bind(bridge);
      bridge.serializeNpcAlcoholState = function (...args) {
        const snapshot = serialize(...args) || {};
        snapshot.__socialSipCooldowns = Object.fromEntries([...drinkState].map(([id, record]) => [id, { lastAcceptedSwigMinute: Number.isFinite(Number(record.lastAcceptedSwigMinute)) ? Number(record.lastAcceptedSwigMinute) : null }]));
        return snapshot;
      };
      const restore = bridge.restoreNpcAlcoholState.bind(bridge);
      bridge.restoreNpcAlcoholState = function (snapshot, ...args) {
        const cooldowns = snapshot?.__socialSipCooldowns || {};
        const base = snapshot && typeof snapshot === 'object' ? { ...snapshot } : snapshot; // Extension is stripped so the legacy restorer never mistakes it for an NPC id.
        if (base && typeof base === 'object') delete base.__socialSipCooldowns;
        const result = restore(base, ...args);
        drinkState.clear();
        for (const [id, saved] of Object.entries(cooldowns)) drinkState.set(id, { lastAcceptedSwigMinute: Number.isFinite(Number(saved?.lastAcceptedSwigMinute)) ? Number(saved.lastAcceptedSwigMinute) : null, lastCheck: null });
        return result;
      };
    }
    return true;
  }

  function activeStimulus(stimulusId) {
    return (window.NpcSocialStimuli?.getActive?.() || []).find(stimulus => String(stimulus?.id || '') === String(stimulusId || '')) || null;
  }
  function handleDanceTarget(rec, target) {
    const id = String(rec?.id || '');
    if (!id) return;
    const dance = target?.socialDance;
    if (!dance) { activeDanceByNpc.delete(id); return; }
    const stimulusId = String(dance.stimulusId || '');
    if (!stimulusId || activeDanceByNpc.get(id) === stimulusId) return;
    activeDanceByNpc.set(id, stimulusId);
    if (!dance.sourceIsPlayer) return;
    const stimulus = activeStimulus(stimulusId);
    if (stimulus?.type === 'dance') adjust(id, num(config.rapportDeltas?.danceWithPlayer, DEFAULTS.rapportDeltas.danceWithPlayer), 'dance_with_player');
    else if (stimulus?.type === 'music') adjust(id, num(config.rapportDeltas?.playerMusicDance, DEFAULTS.rapportDeltas.playerMusicDance), 'player_music_dance');
  }
  function patchPlanner(api) {
    if (!api?.resolveNpcTarget || api.__npcRapportEventDrivenWrapped) return false;
    const resolve = api.resolveNpcTarget.bind(api); // Captures the inhibition-aware resolver; Rapport observes its accepted target instead of re-evaluating willingness.
    api.resolveNpcTarget = function (rec, extra = {}) {
      const target = resolve(rec, extra);
      handleDanceTarget(rec, target);
      return target;
    };
    api.__npcRapportEventDrivenWrapped = true;
    plannerPatched = true;
    return true;
  }
  function chainPlanner() {
    if (patchPlanner(window.NpcActivityPlanner)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'NpcActivityPlanner'); // Chained after the inhibition runtime's lazy setter without any polling.
    if (descriptor && !descriptor.configurable) return;
    if (descriptor?.set || descriptor?.get) {
      Object.defineProperty(window, 'NpcActivityPlanner', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get ? descriptor.get.call(window) : undefined; },
        set(value) {
          descriptor.set?.call(window, value);
          patchPlanner(descriptor.get ? descriptor.get.call(window) : value);
        },
      });
      return;
    }
    let value = descriptor?.value;
    Object.defineProperty(window, 'NpcActivityPlanner', { configurable: true, enumerable: descriptor?.enumerable !== false, get() { return value; }, set(next) { value = next; patchPlanner(next); } });
  }

  function getDebug() {
    flushRollover();
    return {
      installed: true, eventDriven: true, polling: false, plannerHookInstalled: plannerPatched,
      config: JSON.parse(JSON.stringify(config)), rawGameDay: rawDay(), gameDay: socialDay(), clockHour: clockHour(), absoluteGameMinute: absoluteGameMinute(),
      rapport: Object.fromEntries([...touchedNpcIds].map(id => [id, get(id)])),
      giftDays: Object.fromEntries([...touchedNpcIds].map(id => [id, relationship(id)?.lastGiftDay ?? -1])),
      drink: Object.fromEntries([...drinkState].map(([id, record]) => [id, { ...record, cooldownRemaining: drinkCooldownRemaining(id) }])),
      activeDanceStimulusByNpc: Object.fromEntries(activeDanceByNpc),
    };
  }

  window.NpcRapport = Object.freeze({ installed: true, eventDriven: true, config, rawGameDay: rawDay, currentGameDay: socialDay, absoluteGameMinute, get, adjust, canGiftToday, markGiftedToday, drinkCooldownRemaining, flushRollover, getDebug });
  window.__npcRapportDebug = getDebug;
  patchDialogue();
  patchGifting();
  patchAlcohol();
  chainPlanner();
})();