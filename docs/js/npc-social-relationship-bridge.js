(() => {
  'use strict';

  const DEFAULT_CONFIG = Object.freeze({ // Used to seed modular social-relationship tuning without hardcoded gameplay values in the handlers below.
    representedMinutesPerDay: 24 * 60,
    drinkAcceptedCooldownMinutes: 30,
    rapportToFavorRate: 0.10,
    rapportMin: 0,
    rapportMax: 100,
    rolloverPollMs: 500,
    danceRapportPollMs: 500,
    rapportDeltas: Object.freeze({
      drinkAccepted: 4,
      danceWithPlayer: 3,
      playerMusicDance: 2,
      giftLoved: 10,
      giftLiked: 4,
      giftNeutral: 1,
      giftDisliked: -4,
      giftHated: -10,
    }),
  });

  const rootConfig = window.SCRATCHBONES_CONFIG = window.SCRATCHBONES_CONFIG || {}; // Used to expose these tunables through the game's existing global config tree.
  rootConfig.game = rootConfig.game || {};
  const authoredConfig = rootConfig.game.socialRelationships || {}; // Used to preserve any project-authored overrides while filling only missing defaults.
  const config = rootConfig.game.socialRelationships = { // Used by every rapport, gift, liquor, and rollover rule in this module.
    ...DEFAULT_CONFIG,
    ...authoredConfig,
    rapportDeltas: {
      ...DEFAULT_CONFIG.rapportDeltas,
      ...(authoredConfig.rapportDeltas || {}),
    },
  };

  const touchedNpcIds = new Set(); // Used to know which NPC relationship states need midnight conversion without scanning unrelated NPC databases.
  const awardedDanceEncounters = new Set(); // Used to prevent the frame-by-frame dance evaluator from awarding rapport more than once per encounter.
  const drinkState = new Map(); // Used to persist accepted-sip cooldowns and mobile-friendly debug details per NPC.
  let patchedDialogue = false; // Used to ensure the relationship save wrappers are installed once.
  let patchedGifting = false; // Used to ensure the one-gift-per-day wrappers are installed once.
  let patchedAlcohol = false; // Used to ensure liquor cooldown/inhibition wrappers are installed once.
  let lastDancePollMs = 0; // Used to throttle dance rapport sampling to the configured interval.
  let lastRolloverPollMs = 0; // Used to throttle midnight rollover checks to the configured interval.

  function finiteNumber(value, fallback = 0) {
    const number = Number(value); // Used to normalize authored/save values before arithmetic.
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rawGameDay() {
    const debug = window.CalendarSystem?.timeDebugSnapshot?.(); // Used as the simulation-day component of the monotonic absolute-minute clock.
    return Math.max(0, Math.floor(finiteNumber(debug?.rawDay, window.calendar?.day || 0)));
  }

  function currentTime01() {
    const debug = window.CalendarSystem?.timeDebugSnapshot?.(); // Used to derive in-game minutes for the liquor cooldown from the same clock that advances NPC schedules.
    return clamp(finiteNumber(debug?.time01, window.time01 || 0), 0, 0.999999);
  }

  function currentClockHour() {
    return finiteNumber(window.CalendarSystem?.getHour?.(), NaN); // Used to detect midnight independently from the world's authored 06:00 simulation-day rollover.
  }

  function currentGameDay() {
    const rawDay = rawGameDay(); // Used as the base day index before applying the social midnight boundary below.
    const hour = currentClockHour(); // Full-day CalendarSystem returns 24..30 between midnight and the 06:00 simulation rollover.
    if (window.CalendarSystem?.constants?.FULL_DAY_CYCLE && Number.isFinite(hour) && hour >= 24) return rawDay + 1;
    return rawDay;
  }

  function absoluteGameMinute() {
    const minutesPerDay = Math.max(1, finiteNumber(config.representedMinutesPerDay, DEFAULT_CONFIG.representedMinutesPerDay)); // Used to keep the cooldown independent of the game's real-time day length.
    return rawGameDay() * minutesPerDay + currentTime01() * minutesPerDay;
  }

  function relationshipState(npcId) {
    const id = String(npcId || ''); // Used as the stable key shared by DialogueContent, gifting, alcohol, and dance systems.
    if (!id) return null;
    const state = window.DialogueContent?.getNpcDlgState?.(id) || window.DialogueContent?.npcDlgState?.get?.(id); // Used as the existing authoritative relationship/save object instead of creating a parallel save store.
    if (!state) return null;
    touchedNpcIds.add(id);
    if (!Number.isFinite(Number(state.rapport))) state.rapport = 0;
    if (!Number.isFinite(Number(state.rapportDay))) state.rapportDay = currentGameDay();
    if (!Number.isFinite(Number(state.lastGiftDay))) state.lastGiftDay = -1;
    settleNpcRollover(id, state);
    return state;
  }

  function settleNpcRollover(npcId, stateArg = null) {
    const state = stateArg || window.DialogueContent?.getNpcDlgState?.(npcId) || window.DialogueContent?.npcDlgState?.get?.(npcId); // Used to convert a touched NPC's prior-day rapport in place.
    if (!state) return 0;
    const today = currentGameDay(); // Used to detect the first access/update after midnight rather than the world's 06:00 simulation rollover.
    const stateDay = Number.isFinite(Number(state.rapportDay)) ? Math.floor(Number(state.rapportDay)) : today; // Used to keep old saves backward compatible.
    if (stateDay >= today) {
      state.rapportDay = today;
      return 0;
    }
    const oldRapport = clamp(finiteNumber(state.rapport, 0), finiteNumber(config.rapportMin, 0), finiteNumber(config.rapportMax, 100)); // Used as the daily temporary affinity converted at rollover.
    const favorGain = Math.round(oldRapport * Math.max(0, finiteNumber(config.rapportToFavorRate, DEFAULT_CONFIG.rapportToFavorRate))); // Used as the configurable permanent favor exchange, rounded to the integer favor scale used by friendship tiers.
    state.rapport = 0;
    state.rapportDay = today;
    if (favorGain !== 0) {
      state.favor = finiteNumber(state.favor, 0) + favorGain;
      if (Array.isArray(state.memory)) {
        state.memory.push({ type: 'rapport_rollover', day: today, amount: favorGain, sourceRapport: oldRapport });
      }
      window.__farmLog?.(`Rapport with ${npcId} became ${favorGain} permanent favor at midnight.`);
    }
    return favorGain;
  }

  function get(npcId) {
    const state = relationshipState(npcId); // Used to expose the current 0–100 rapport value to UI/debug callers.
    return state ? clamp(finiteNumber(state.rapport, 0), finiteNumber(config.rapportMin, 0), finiteNumber(config.rapportMax, 100)) : 0;
  }

  function adjust(npcId, amount, reason = 'social') {
    const state = relationshipState(npcId); // Used to apply temporary social gains/losses to the existing per-NPC relationship record.
    if (!state) return 0;
    const before = get(npcId); // Used to return the actual clamped delta for callers and diagnostics.
    const after = clamp(before + finiteNumber(amount, 0), finiteNumber(config.rapportMin, 0), finiteNumber(config.rapportMax, 100)); // Used to enforce the requested daily 0–100 range.
    state.rapport = after;
    state.rapportDay = currentGameDay();
    if (after !== before && Array.isArray(state.memory)) {
      state.memory.push({ type: 'rapport', day: currentGameDay(), amount: after - before, reason: String(reason || 'social') });
    }
    return after - before;
  }

  function canGiftToday(npcId) {
    const state = relationshipState(npcId); // Used to gate both the visible gift action and the gift execution path.
    return !!state && Math.floor(finiteNumber(state.lastGiftDay, -1)) !== currentGameDay();
  }

  function markGiftedToday(npcId) {
    const state = relationshipState(npcId); // Used to persist the once-per-day gift consumption on the normal NPC relationship save object.
    if (!state) return false;
    state.lastGiftDay = currentGameDay();
    return true;
  }

  function patchDialoguePersistence() {
    const dialogue = window.DialogueContent; // Used as the existing relationship persistence owner we extend non-destructively.
    if (patchedDialogue || !dialogue?.npcRelationshipsSnapshot || !dialogue?.loadNpcRelationships) return;
    patchedDialogue = true;

    const originalSnapshot = dialogue.npcRelationshipsSnapshot.bind(dialogue); // Used to retain every pre-existing relationship field while adding rapport metadata.
    dialogue.npcRelationshipsSnapshot = function npcRelationshipsSnapshotWithRapport(...args) {
      flushRollover();
      const snapshot = originalSnapshot(...args) || {}; // Used as the authoritative base save payload.
      const ids = new Set([...Object.keys(snapshot), ...touchedNpcIds]); // Used to serialize social metadata even for NPCs whose original snapshot shape is sparse.
      for (const npcId of ids) {
        const state = relationshipState(npcId); // Used to read the current in-memory social fields for this saved NPC.
        if (!state) continue;
        snapshot[npcId] = snapshot[npcId] || {};
        snapshot[npcId].rapport = get(npcId);
        snapshot[npcId].rapportDay = Math.floor(finiteNumber(state.rapportDay, currentGameDay()));
        snapshot[npcId].lastGiftDay = Math.floor(finiteNumber(state.lastGiftDay, -1));
      }
      return snapshot;
    };

    const originalLoad = dialogue.loadNpcRelationships.bind(dialogue); // Used to let the original loader rebuild all legacy fields before applying the new optional ones.
    dialogue.loadNpcRelationships = function loadNpcRelationshipsWithRapport(playerData, ...args) {
      const result = originalLoad(playerData, ...args); // Used to preserve existing load behavior and return value.
      const saved = playerData?.npcRelationships || {}; // Used to restore only the additive social fields when they exist in newer saves.
      for (const [npcId, entry] of Object.entries(saved)) {
        const state = dialogue.getNpcDlgState?.(npcId) || dialogue.npcDlgState?.get?.(npcId); // Used to attach restored metadata to the normal relationship state.
        if (!state) continue;
        touchedNpcIds.add(npcId);
        state.rapport = clamp(finiteNumber(entry?.rapport, 0), finiteNumber(config.rapportMin, 0), finiteNumber(config.rapportMax, 100));
        state.rapportDay = Number.isFinite(Number(entry?.rapportDay)) ? Math.floor(Number(entry.rapportDay)) : currentGameDay();
        state.lastGiftDay = Number.isFinite(Number(entry?.lastGiftDay)) ? Math.floor(Number(entry.lastGiftDay)) : -1;
        settleNpcRollover(npcId, state);
      }
      return result;
    };
  }

  function giftDeltaForTier(tier) {
    const key = `gift${String(tier || 'neutral').replace(/^./, letter => letter.toUpperCase())}`; // Used to map the gifting module's reaction tier onto configurable rapport tuning keys.
    return finiteNumber(config.rapportDeltas?.[key], 0);
  }

  function patchGifting() {
    const gifting = window.NpcGifting; // Used to add the daily gate around the existing gift inventory/reaction implementation.
    const dialogue = window.DialogueContent; // Used only to redirect the gift module's synchronous favor award into rapport.
    if (patchedGifting || !gifting?.getNpcGiftOfferAction || !gifting?.offerGift || !dialogue?.adjustNpcFavor) return;
    patchedGifting = true;

    const originalGetAction = gifting.getNpcGiftOfferAction.bind(gifting); // Used to preserve all existing eligibility tests before applying the daily gate.
    gifting.getNpcGiftOfferAction = function getNpcGiftOfferActionDaily(walker, ...args) {
      const npcId = String(walker?.rec?.id || ''); // Used to identify the per-NPC daily gift record.
      if (npcId && !canGiftToday(npcId)) return null;
      return originalGetAction(walker, ...args);
    };

    const originalOfferGift = gifting.offerGift.bind(gifting); // Used to preserve inventory consumption, clothing returns, preference discovery, and dialogue reactions.
    gifting.offerGift = function offerGiftWithDailyRapport(walker, ...args) {
      const npcId = String(walker?.rec?.id || ''); // Used to gate and award the gift to the correct relationship state.
      if (!npcId || !canGiftToday(npcId)) {
        window.__farmLog?.(`${walker?.rec?.name || 'They'} already received a gift today.`);
        return false;
      }
      const originalAdjustFavor = dialogue.adjustNpcFavor; // Used to temporarily intercept only the synchronous favor call made by this gift attempt.
      let capturedTier = null; // Used to record the gift reaction tier without changing npc-gifting.js's public result contract.
      dialogue.adjustNpcFavor = function redirectGiftFavor(id, delta, reason, ...favorArgs) {
        if (String(id) === npcId && String(reason || '').startsWith('gift_')) {
          capturedTier = String(reason).slice(5) || 'neutral';
          adjust(npcId, giftDeltaForTier(capturedTier), reason);
          return get(npcId);
        }
        return originalAdjustFavor.call(dialogue, id, delta, reason, ...favorArgs);
      };
      try {
        const acceptedAttempt = originalOfferGift(walker, ...args); // Used as the authoritative indication that an actual gift interaction occurred.
        if (acceptedAttempt) markGiftedToday(npcId);
        return acceptedAttempt;
      } finally {
        dialogue.adjustNpcFavor = originalAdjustFavor;
        if (capturedTier) touchedNpcIds.add(npcId);
      }
    };
  }

  function distanceTilesToStimulus(walker, stimulus) {
    const root = walker?.root; // Used to calculate the same distance/proximity inputs expected by NpcSocialInhibition.evaluate().
    const x = finiteNumber(root?.position?.x, finiteNumber(walker?.x, 0)); // Used as the NPC's current world X coordinate for contextual stimulus selection.
    const z = finiteNumber(root?.position?.z, finiteNumber(walker?.z, 0)); // Used as the NPC's current world Z coordinate for contextual stimulus selection.
    const tileSize = Math.max(0.001, finiteNumber(window.TILE_SIZE, 1)); // Used to convert world distance into the evaluator's tile units.
    return Math.hypot(finiteNumber(stimulus?.x, x) - x, finiteNumber(stimulus?.z, z) - z) / tileSize;
  }

  function contextualStimulus(walker) {
    const active = window.NpcSocialStimuli?.getActive?.() || []; // Used to feed the liquor roll the same current music/dance context available to the dance check.
    const area = String(walker?.area || walker?.rec?.area || ''); // Used to avoid choosing an unrelated stimulus on another map/interior.
    const candidates = active
      .filter(stimulus => !area || !stimulus?.area || String(stimulus.area) === area)
      .map(stimulus => {
        const distanceTiles = distanceTilesToStimulus(walker, stimulus); // Used to reject stimuli outside their authored radius and rank nearby ones.
        const radiusTiles = Math.max(0.001, finiteNumber(stimulus?.radiusTiles, 1)); // Used to calculate the same 0–1 proximity convention as the dance planner.
        const proximity01 = clamp(1 - distanceTiles / radiusTiles, 0, 1); // Used as the contextual proximity passed directly into the shared inhibition evaluator.
        return { stimulus, distanceTiles, proximity01, score: finiteNumber(stimulus?.strength, 0) * (0.5 + 0.5 * proximity01) };
      })
      .filter(entry => entry.distanceTiles <= Math.max(0.001, finiteNumber(entry.stimulus?.radiusTiles, 1)))
      .sort((a, b) => b.score - a.score);
    if (candidates.length) return candidates[0];

    const root = walker?.root; // Used to place a neutral player social-offer stimulus at the NPC when no music/dance stimulus is active.
    const synthetic = { // Used only as an input carrier so the shared evaluator can apply work/time/personality/audience/dancing/venue factors without inventing liquor-specific copies.
      id: `rapport-liquor:neutral:${String(walker?.rec?.id || 'npc')}`,
      type: 'social_offer',
      sourceId: 'player',
      sourceIsPlayer: true,
      area,
      x: finiteNumber(root?.position?.x, finiteNumber(walker?.x, 0)),
      z: finiteNumber(root?.position?.z, finiteNumber(walker?.z, 0)),
      strength: 0,
      radiusTiles: 1,
    };
    return { stimulus: synthetic, distanceTiles: 0, proximity01: 1, score: 0 };
  }

  function sharedInhibitionRoll(walker) {
    const evaluator = window.NpcSocialInhibition; // Used as the single source of truth for dance inhibition contextual modifiers.
    const rec = walker?.rec; // Used as the NPC personality/relationship identity passed into the shared evaluator.
    if (!evaluator?.evaluate || !rec) return { accepted: true, draw: 100, effective: 1, modifiers: [], blockedReason: null };
    const context = contextualStimulus(walker); // Used to preserve any current music/dance context in the liquor decision.
    const attemptId = `rapport-liquor:${String(rec.id || 'npc')}:${Math.floor(absoluteGameMinute())}`; // Used to keep liquor debug evaluations identifiable and separate from dance rapport awards.
    const stimulus = { ...context.stimulus, id: attemptId }; // Used to keep the selected contextual stimulus data while preventing collision with its normal dance encounter identity.
    const result = evaluator.evaluate(rec, walker, { ...context, stimulus }, walker?.currentScheduleTarget || null); // Used to obtain the exact shared work/time/personality/drunk/social-context inhibition calculation.

    const probeStimulus = { ...stimulus, id: `${attemptId}:relationship-probe`, type: 'dance', sourceId: 'player', sourceIsPlayer: true, strength: 0, radiusTiles: Math.max(1, finiteNumber(config.playerOfferRelationshipProbeRadiusTiles, 2)) }; // Used to ask the same evaluator for its existing player-invitation relationship modifier instead of duplicating that formula.
    const probe = evaluator.evaluate(rec, walker, { stimulus: probeStimulus, distanceTiles: 0, proximity01: 1 }, walker?.currentScheduleTarget || null); // Used only to extract the evaluator-authored relationship-familiarity amount.
    const relationshipModifier = (probe?.modifiers || []).find(modifier => modifier?.label === 'player-dance-invitation'); // Used to reuse the exact relationship coefficient/heart logic from the dance check.
    const baseHasRelationship = (result?.modifiers || []).some(modifier => modifier?.label === 'player-dance-invitation'); // Used to avoid double-applying relationship when the selected contextual stimulus was already a player dance.
    const relationshipAmount = baseHasRelationship ? 0 : finiteNumber(relationshipModifier?.amount, 0); // Used to make the personal liquor offer include the same relationship context as a personal dance invitation.
    const effective = clamp(finiteNumber(result?.effective, 99) + relationshipAmount, 1, 99); // Used as the final shared inhibition target for the hidden d100.
    const random01 = typeof window.GameRandom?.random === 'function' ? window.GameRandom.random() : Math.random(); // Used to keep gameplay-affecting liquor acceptance deterministic under the game's seeded random source when available.
    const draw = Math.floor(random01 * 100) + 1; // Used as the requested hidden d100 roll; contextual difficulty comes entirely from the shared dance evaluator.
    const blockedReason = result?.blockedReason || probe?.blockedReason || null; // Used to preserve critical-work/blackout-style hard refusals from the shared evaluator.
    return {
      accepted: !blockedReason && draw >= effective,
      draw,
      effective,
      blockedReason,
      modifiers: [...(result?.modifiers || []), ...(relationshipAmount ? [{ label: 'player-dance-invitation', amount: relationshipAmount }] : [])],
      stimulusType: context.stimulus?.type || 'social_offer',
    };
  }

  function drinkRecord(npcId) {
    const id = String(npcId || ''); // Used as the key for accepted-sip cooldown persistence/debug data.
    if (!drinkState.has(id)) drinkState.set(id, { lastAcceptedSwigMinute: null, lastCheck: null });
    return drinkState.get(id);
  }

  function drinkCooldownRemaining(npcId) {
    const record = drinkRecord(npcId); // Used to calculate how many represented game minutes remain before another sip can be accepted.
    if (!Number.isFinite(Number(record.lastAcceptedSwigMinute))) return 0;
    const cooldown = Math.max(0, finiteNumber(config.drinkAcceptedCooldownMinutes, DEFAULT_CONFIG.drinkAcceptedCooldownMinutes)); // Used as the configurable accepted-sip spacing instead of a hardcoded 30 in handler logic.
    return Math.max(0, cooldown - (absoluteGameMinute() - Number(record.lastAcceptedSwigMinute)));
  }

  function bottleSnapshotSignature(bridge) {
    try {
      return JSON.stringify(bridge?.serializeBottleSwigs?.() || null);
    } catch (_) {
      return '';
    }
  }

  function showDrinkRefusal(walker, reason) {
    const line = reason === 'cooldown' ? 'They shake their head. They have had enough for now.' : 'They hesitate, then decline the drink.'; // Used to give player-visible feedback while keeping the actual inhibition roll hidden.
    const ambient = window.AmbientDialogue; // Used to reuse the alcohol-offer response surface when available.
    if (ambient?.showAlcoholOfferResponse) {
      try { ambient.showAlcoholOfferResponse(walker, { accepted: false, text: line, line }); return; } catch (_) {}
    }
    window.__farmLog?.(line);
  }

  function patchAlcohol() {
    const bridge = window.HobunjiDrunkGameplayBridge; // Used to gate the existing bottle/NPC alcohol implementation without replacing it.
    if (patchedAlcohol || !bridge?.getNpcSwigOfferAction || !bridge?.offerNpcSwig) return;
    patchedAlcohol = true;

    const originalGetAction = bridge.getNpcSwigOfferAction.bind(bridge); // Used to preserve held-bottle, target, blackout, and animation eligibility checks.
    bridge.getNpcSwigOfferAction = function getNpcSwigOfferActionWithCooldown(walker, ...args) {
      const npcId = String(walker?.rec?.id || ''); // Used to check the accepted-sip cooldown for this specific NPC.
      if (npcId && drinkCooldownRemaining(npcId) > 0) return null;
      return originalGetAction(walker, ...args);
    };

    const originalOffer = bridge.offerNpcSwig.bind(bridge); // Used to preserve narrative acceptance, bottle consumption, animation, drunkenness, and saves after the new gate passes.
    bridge.offerNpcSwig = function offerNpcSwigWithInhibition(walker, ...args) {
      const npcId = String(walker?.rec?.id || ''); // Used to record cooldown and rapport for the targeted NPC.
      if (!npcId) return false;
      if (drinkCooldownRemaining(npcId) > 0) {
        showDrinkRefusal(walker, 'cooldown');
        return false;
      }
      const roll = sharedInhibitionRoll(walker); // Used as the hidden d100 check against the shared dance-context inhibition result.
      drinkRecord(npcId).lastCheck = { ...roll, gameMinute: absoluteGameMinute() };
      if (!roll.accepted) {
        showDrinkRefusal(walker, 'inhibition');
        return false;
      }
      const before = bottleSnapshotSignature(bridge); // Used to tell whether the original alcohol flow actually consumed a sip after its own narrative checks.
      const result = originalOffer(walker, ...args); // Used to execute the established alcohol interaction unchanged after social acceptance.
      const after = bottleSnapshotSignature(bridge); // Used to avoid starting cooldown/rapport on an offer the original system rejected without consuming alcohol.
      if (before !== after) {
        const record = drinkRecord(npcId); // Used to persist the moment of the most recent accepted and consumed NPC sip.
        record.lastAcceptedSwigMinute = absoluteGameMinute();
        adjust(npcId, finiteNumber(config.rapportDeltas?.drinkAccepted, DEFAULT_CONFIG.rapportDeltas.drinkAccepted), 'drink_accepted');
      }
      return result;
    };

    if (bridge.serializeNpcAlcoholState && bridge.restoreNpcAlcoholState) {
      const originalSerialize = bridge.serializeNpcAlcoholState.bind(bridge); // Used to preserve all existing drunkenness state while adding social cooldown metadata.
      bridge.serializeNpcAlcoholState = function serializeNpcAlcoholStateWithCooldown(...args) {
        const snapshot = originalSerialize(...args) || {}; // Used as the authoritative base alcohol save payload.
        snapshot.__socialSipCooldowns = {};
        for (const [npcId, record] of drinkState.entries()) {
          snapshot.__socialSipCooldowns[npcId] = { lastAcceptedSwigMinute: Number.isFinite(Number(record.lastAcceptedSwigMinute)) ? Number(record.lastAcceptedSwigMinute) : null };
        }
        return snapshot;
      };
      const originalRestore = bridge.restoreNpcAlcoholState.bind(bridge); // Used to restore legacy alcohol state before reading the optional cooldown extension.
      bridge.restoreNpcAlcoholState = function restoreNpcAlcoholStateWithCooldown(snapshot, ...args) {
        const result = originalRestore(snapshot, ...args); // Used to preserve the original restore return value and side effects.
        drinkState.clear();
        for (const [npcId, saved] of Object.entries(snapshot?.__socialSipCooldowns || {})) {
          drinkState.set(npcId, { lastAcceptedSwigMinute: Number.isFinite(Number(saved?.lastAcceptedSwigMinute)) ? Number(saved.lastAcceptedSwigMinute) : null, lastCheck: null });
        }
        return result;
      };
    }
  }

  function awardDanceRapport() {
    const now = performance.now(); // Used to throttle debug-state polling instead of doing social bookkeeping every animation frame.
    if (now - lastDancePollMs < Math.max(50, finiteNumber(config.danceRapportPollMs, DEFAULT_CONFIG.danceRapportPollMs))) return;
    lastDancePollMs = now;
    const evaluations = window.NpcSocialInhibition?.getDebugState?.()?.activeEvaluations || []; // Used as the authoritative record of NPCs whose shared dance check actually succeeded.
    const stimuli = window.NpcSocialStimuli?.getActive?.() || []; // Used to distinguish player-played music from other dance causes.
    const stimulusById = new Map(stimuli.map(stimulus => [String(stimulus.id), stimulus])); // Used to look up sourceIsPlayer/type without recomputing the planner's context.
    for (const evaluation of evaluations) {
      if (!evaluation?.dance || String(evaluation?.stimulusId || '').startsWith('rapport-liquor:')) continue;
      const encounterKey = `${evaluation.npcId}|${evaluation.stimulusId}|${evaluation.encounterSerial}`; // Used to make each successful dance encounter award rapport exactly once.
      if (awardedDanceEncounters.has(encounterKey)) continue;
      awardedDanceEncounters.add(encounterKey);
      if (evaluation.closePlayerInvite) {
        adjust(evaluation.npcId, finiteNumber(config.rapportDeltas?.danceWithPlayer, DEFAULT_CONFIG.rapportDeltas.danceWithPlayer), 'dance_with_player');
        continue;
      }
      const stimulus = stimulusById.get(String(evaluation.stimulusId)); // Used to identify an NPC dancing specifically because of player-played music.
      if (stimulus?.type === 'music' && stimulus?.sourceIsPlayer) {
        adjust(evaluation.npcId, finiteNumber(config.rapportDeltas?.playerMusicDance, DEFAULT_CONFIG.rapportDeltas.playerMusicDance), 'player_music_dance');
      }
    }
    if (awardedDanceEncounters.size > 2000) awardedDanceEncounters.clear();
  }

  function flushRollover() {
    for (const npcId of touchedNpcIds) settleNpcRollover(npcId);
  }

  function tick() {
    patchDialoguePersistence();
    patchGifting();
    patchAlcohol();
    awardDanceRapport();
    const now = performance.now(); // Used to limit midnight scans independently from dance polling.
    if (now - lastRolloverPollMs >= Math.max(50, finiteNumber(config.rolloverPollMs, DEFAULT_CONFIG.rolloverPollMs))) {
      lastRolloverPollMs = now;
      flushRollover();
    }
    requestAnimationFrame(tick);
  }

  function getDebug() {
    return {
      config: JSON.parse(JSON.stringify(config)),
      rawGameDay: rawGameDay(),
      gameDay: currentGameDay(),
      clockHour: currentClockHour(),
      absoluteGameMinute: absoluteGameMinute(),
      rapport: Object.fromEntries([...touchedNpcIds].map(npcId => [npcId, get(npcId)])),
      giftDays: Object.fromEntries([...touchedNpcIds].map(npcId => [npcId, relationshipState(npcId)?.lastGiftDay ?? -1])),
      drink: Object.fromEntries([...drinkState.entries()].map(([npcId, record]) => [npcId, { ...record, cooldownRemaining: drinkCooldownRemaining(npcId) }])),
      awardedDanceEncounterCount: awardedDanceEncounters.size,
    };
  }

  window.NpcRapport = Object.freeze({
    installed: true,
    config,
    rawGameDay,
    currentGameDay,
    absoluteGameMinute,
    get,
    adjust,
    canGiftToday,
    markGiftedToday,
    drinkCooldownRemaining,
    flushRollover,
    getDebug,
  });
  window.__npcRapportDebug = getDebug;

  patchDialoguePersistence();
  patchGifting();
  patchAlcohol();
  requestAnimationFrame(tick);
})();
