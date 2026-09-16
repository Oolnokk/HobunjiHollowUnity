(() => {
  'use strict';

  if (Number(window.NpcFavorBalance?.version) >= 3) return;

  const FAVOR_POINTS_PER_HEART = 40; // Used everywhere Favor XP is converted into permanent relationship-heart progress.
  const MAX_GIFT_FAVOR_POINTS = 10; // Used to cap one physical gift at one loved-gift unit before quality scaling.
  const POINT_PRECISION = 10000; // Used to preserve fractional spillover/quality Favor without floating-point noise.
  const DIALOGUE_INSTALL_FLAG = '__npcFavorBalanceDialogueInstallArmed'; // Used to avoid stacking duplicate DialogueContent lazy-install setters.
  const TASKS_INSTALL_FLAG = '__npcFavorBalanceTasksInstallArmed'; // Used to avoid stacking duplicate ProceduralTasks lazy-patch setters.
  const FRIENDSHIP_TIER_HEARTS = Object.freeze([0, 2, 4, 6, 8, 10]); // Used to keep the existing two-heart Friendship Tier spacing while Favor itself stays point-based.

  let installReason = 'direct'; // Used by debugSnapshot to show whether DialogueContent existed immediately or arrived later.
  let dialogueDeps = null; // Used by relationship spillover to resolve the authoritative NPC records after DialogueContent.init.
  let giftingDeps = null; // Used by gift-quality bookkeeping to consume the exact quality bucket for the held gift.
  let activeGiftContext = null; // Used only while NpcGifting.offerGift runs so Favor can apply the selected item's star multiplier.
  let rawGetNpcState = null; // Used by point/heart helpers so UI reads the stored Favor-point value without semantic conversion.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const roundPoint = value => Math.round(finite(value, 0) * POINT_PRECISION) / POINT_PRECISION;
  const favorPointsToHearts = points => finite(points, 0) / FAVOR_POINTS_PER_HEART;
  const heartsToFavorPoints = hearts => finite(hearts, 0) * FAVOR_POINTS_PER_HEART;

  function favorPointsForNpc(npcId) {
    const id = String(npcId || ''); // Used to keep debug/missing-id calls from creating an accidental undefined relationship key.
    if (!id) return 0;
    const getter = rawGetNpcState || window.DialogueContent?.getNpcDlgState?.bind(window.DialogueContent); // Used before/after install without changing storage units.
    return finite(getter?.(id)?.favor, 0);
  }

  function relationshipHeartsForNpc(npcId) {
    return favorPointsToHearts(favorPointsForNpc(npcId));
  }

  function npcRecords() {
    const fromDeps = dialogueDeps?.getNpcRecords?.(); // Used first because it is the same record collection DialogueContent itself was initialized with.
    if (Array.isArray(fromDeps)) return fromDeps;
    const walkers = window.__hobunjiFurnitureDebug?.getNpcWalkers?.(); // Used as the existing runtime fallback when DialogueContent deps are not available.
    return Array.isArray(walkers) ? walkers.map(walker => walker?.rec).filter(Boolean) : [];
  }

  function relatedNpcBonds(npcId) {
    const records = npcRecords(); // Used to calculate the existing household/workplace Favor spillover without duplicating NPC data.
    const source = records.find(record => record?.id === npcId); // Used as the relationship source whose home/work links define spillover.
    if (!source) return [];
    const bonds = new Map(); // Used to dedupe NPCs who share both home and workplace while keeping the stronger fraction.
    for (const other of records) {
      if (!other?.id || other.id === npcId) continue;
      const sameHome = source.homeId && other.homeId === source.homeId; // Used to award the existing 25% household spillover.
      const sameWork = source.scheduleHooks?.workBuildingId && other.scheduleHooks?.workBuildingId === source.scheduleHooks.workBuildingId; // Used to award the existing 15% workplace spillover.
      if (!sameHome && !sameWork) continue;
      const fraction = sameHome ? 0.25 : 0.15; // Used by adjustNpcFavor when recursively applying quiet spillover.
      if (!bonds.has(other.id) || bonds.get(other.id) < fraction) bonds.set(other.id, fraction);
    }
    return [...bonds.entries()];
  }

  function activeGiftStars() {
    if (activeGiftContext?.kind !== 'item') return null;
    return activeGiftContext.stars;
  }

  function giftQualityMultiplier() {
    const stars = activeGiftStars(); // Used to map the held gift's 1–5 stars onto 20%–100% Favor value.
    return stars == null ? 1 : clamp(stars, 1, 5) / 5;
  }

  function balancedGiftPoints(points) {
    return clamp(finite(points, 0), -MAX_GIFT_FAVOR_POINTS, MAX_GIFT_FAVOR_POINTS) * giftQualityMultiplier();
  }

  function formatCompact(value) {
    const rounded = Math.round(finite(value, 0) * 100) / 100; // Used by reward/debug text so point values do not show floating-point tails.
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
  }

  function renderFavorPointHearts(rec, originalRenderHearts) {
    if (!rec?.relationship) return originalRenderHearts?.(rec) || '';
    const heartScore = relationshipHeartsForNpc(rec.id); // Used to convert stored Favor XP into the -5..+10 relationship-heart scale only for presentation/rules.
    const clamped = clamp(heartScore, -5, 10); // Used to preserve the existing 15-heart meter bounds.
    const progress = clamp(clamped + 5, 0, 15); // Used to map -5..+10 hearts onto the fifteen visual heart slots.
    const completed = Math.floor(progress); // Used to render fully completed slots before the current partial heart.
    const fraction = progress - completed; // Used to render Favor XP as a fractional fill toward the next heart.
    const hearts = []; // Used to accumulate the existing purple-negative/red-positive heart row.
    for (let index = 0; index < 15; index++) {
      const fill = index < 5 ? '💜' : '❤️'; // Used to preserve the existing negative/positive relationship colors.
      if (index < completed) {
        hearts.push(fill);
      } else if (index === completed && fraction > 0.0001) {
        const width = Math.round(fraction * 1000) / 10; // Used as the clipped percentage of the current partial heart.
        hearts.push(`<span class="favor-partial-heart" style="position:relative;display:inline-block;width:1.05em;overflow:hidden;vertical-align:-.08em"><span aria-hidden="true">🤍</span><span aria-hidden="true" style="position:absolute;left:0;top:0;width:${width}%;overflow:hidden;white-space:nowrap">${fill}</span></span>`);
      } else if (index === completed && completed < 15) {
        hearts.push('🩶');
      } else {
        hearts.push('🤍');
      }
    }
    return hearts.join('');
  }

  function patchProceduralTasks(api) {
    if (!api || api.__favorPointHeartScalePatched) return false;
    const thresholds = FRIENDSHIP_TIER_HEARTS.map(heartsToFavorPoints); // Used so Friendship Tier 1/2/... still means 2/4/... completed positive hearts.

    api.friendshipFavor = function favorPointFriendshipFavor(npcId) {
      return favorPointsForNpc(npcId);
    };
    api.friendshipTier = function favorPointFriendshipTier(npcId) {
      const favorPoints = favorPointsForNpc(npcId); // Used to compare raw Favor XP with point-space tier thresholds.
      let tier = 0; // Used as the highest unlocked Friendship Tier.
      for (let index = 0; index < thresholds.length; index++) if (favorPoints >= thresholds[index]) tier = index;
      return tier;
    };
    api.friendshipTierProgress = function favorPointFriendshipTierProgress(npcId) {
      const favor = favorPointsForNpc(npcId); // Used by RelationshipsPanel as the player-facing Favor XP value.
      const tier = api.friendshipTier(npcId); // Used by RelationshipsPanel for the existing Friendship Tier label.
      const next = thresholds[tier + 1]; // Used by RelationshipsPanel for "Favor to Tier N" without treating one point as one heart.
      return { tier, favor, next: next ?? null };
    };
    Object.defineProperty(api, '__favorPointHeartScalePatched', { configurable: true, value: true });
    return true;
  }

  function armAssignment(name, flagName, onAssign) {
    if (window[flagName]) return true;
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Used to preserve or chain any earlier lazy-global hook instead of trampling it.
    if (descriptor && !descriptor.configurable) return false;

    if (descriptor?.get || descriptor?.set) {
      const previousGet = descriptor.get ? descriptor.get.bind(window) : null; // Used to read through an earlier DialogueContent/ProceduralTasks lazy hook.
      const previousSet = descriptor.set ? descriptor.set.bind(window) : null; // Used to let the earlier hook patch/publish the assigned API before Favor balance sees it.
      let fallbackValue = previousGet?.(); // Used only when an earlier accessor has no setter/getter pair capable of retaining the assigned value.
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return previousGet ? previousGet() : fallbackValue; },
        set(value) {
          if (previousSet) previousSet(value);
          else fallbackValue = value;
          const currentDescriptor = Object.getOwnPropertyDescriptor(window, name); // Used because an earlier setter may replace this chained accessor with its final data property.
          const resolved = previousGet ? previousGet() : (currentDescriptor && 'value' in currentDescriptor ? currentDescriptor.value : fallbackValue); // Used to pass the already-patched published API to Favor balance.
          delete window[flagName];
          onAssign(resolved ?? value);
        },
      });
      window[flagName] = true;
      return true;
    }

    let currentValue = descriptor?.value; // Used to retain a value that existed before the lazy assignment hook was armed.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return currentValue; },
      set(value) {
        currentValue = value;
        Object.defineProperty(window, name, {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
        delete window[flagName];
        onAssign(value);
      },
    });
    window[flagName] = true;
    return true;
  }

  function armProceduralTasksPatch() {
    if (patchProceduralTasks(window.ProceduralTasks)) return true;
    return armAssignment('ProceduralTasks', TASKS_INSTALL_FLAG, patchProceduralTasks);
  }

  function captureHeldGift() {
    const held = giftingDeps?.getHeldGiftItem?.(); // Used to snapshot the exact held stack before NpcGifting consumes it.
    if (!held) return null;
    if (held.kind !== 'item') return { kind: held.kind || 'other', key: held.key || null, stars: null, held };
    const trackedStars = Number(window.CookingSystem?.peekLowestQuality?.(held.key)); // Used to match the quality bucket NpcGifting is about to consume.
    const fallbackStars = Number(held?.def?.qualityStars ?? held?.def?.cookingDefaultStars ?? 3); // Used for items without tracked cooking quality.
    const stars = clamp(Math.round(Number.isFinite(trackedStars) ? trackedStars : fallbackStars), 1, 5); // Used by giftQualityMultiplier during this offer.
    return { kind: 'item', key: held.key, stars, held };
  }

  function consumeGiftQualityUnit(context) {
    if (!context?.key || !Number.isFinite(context.stars) || !giftingDeps?.inventory || !window.CookingSystem?.consumeQuality) return;
    const afterGiftCount = Math.max(0, finite(giftingDeps.inventory[context.key], 0)); // Used to restore one temporary count before consuming the matching quality bucket.
    giftingDeps.inventory[context.key] = afterGiftCount + 1;
    const consumed = window.CookingSystem.consumeQuality(context.key, context.stars, 1); // Used to remove exactly the quality unit that was gifted.
    if (!consumed) giftingDeps.inventory[context.key] = afterGiftCount;
    giftingDeps.clampInventoryStack?.(context.key);
  }

  function install() {
    if (Number(window.NpcFavorBalance?.version) >= 3) return true;

    const dialogue = window.DialogueContent; // Used as the authoritative relationship state/mutation surface once dialogue-content.js exists.
    const gifting = window.NpcGifting; // Used to preserve gift quality scaling around the existing gifting flow.
    if (!dialogue?.getNpcDlgState || !dialogue?.adjustNpcFavor || !dialogue?.loadNpcRelationships) return false;

    rawGetNpcState = dialogue.getNpcDlgState.bind(dialogue);

    const originalDialogueInit = dialogue.init?.bind(dialogue); // Used to capture DialogueContent's dependency bag without changing its initialization.
    if (originalDialogueInit) {
      dialogue.init = function favorPointDialogueInit(injectedDeps, ...args) {
        dialogueDeps = injectedDeps;
        return originalDialogueInit(injectedDeps, ...args);
      };
    }

    // Favor stays stored/saved as Favor POINTS. Hearts are a derived view:
    // 40 Favor = 1 heart. This is the key invariant the relationship menu,
    // tier display, Rapport rollover and gifting must all agree on.
    dialogue.adjustNpcFavor = function favorPointAdjustment(npcId, amount, reason, isSpillover = false, skipPositiveMultiplier = false) {
      if (!npcId) return 0;
      let appliedPoints = finite(amount, 0); // Used as the raw Favor XP delta persisted in relationship state.
      if (!isSpillover && /^gift_/i.test(String(reason || ''))) appliedPoints = balancedGiftPoints(appliedPoints);
      if (appliedPoints > 0 && !skipPositiveMultiplier) appliedPoints *= finite(window.AlchemySystem?.getPositiveFavorMultiplier?.(), 1);
      appliedPoints = roundPoint(appliedPoints);
      if (!appliedPoints) {
        if (!isSpillover) dialogue.recordNpcMemory?.(npcId, reason || 'favor_no_change');
        return 0;
      }

      const state = rawGetNpcState(npcId); // Used to persist Favor XP directly instead of fractional-heart storage.
      state.favor = roundPoint(finite(state.favor, 0) + appliedPoints);
      if (isSpillover) return appliedPoints;

      window.WorldPopupText?.queueReward?.('favor', `${appliedPoints > 0 ? '+' : '−'}${formatCompact(Math.abs(appliedPoints))} Favor`);
      dialogue.recordNpcMemory?.(npcId, reason || (appliedPoints >= 0 ? 'favor_up' : 'favor_down'));

      for (const [relatedId, fraction] of relatedNpcBonds(npcId)) {
        dialogue.adjustNpcFavor(relatedId, appliedPoints * fraction, `spillover_${npcId}`, true, true);
      }
      return appliedPoints;
    };

    const originalRenderHearts = dialogue.renderRelationshipHearts?.bind(dialogue); // Used only for non-relationship records/fallback if the renderer contract changes.
    dialogue.renderRelationshipHearts = rec => renderFavorPointHearts(rec, originalRenderHearts);

    if (gifting) {
      const originalGiftInit = gifting.init?.bind(gifting); // Used to capture inventory/held-item deps for quality-aware gift consumption.
      if (originalGiftInit) {
        gifting.init = function favorPointGiftInit(injectedDeps, ...args) {
          giftingDeps = injectedDeps;
          return originalGiftInit(injectedDeps, ...args);
        };
      }
      const originalOfferGift = gifting.offerGift?.bind(gifting); // Used to keep all authored gift reaction/consumption behavior intact.
      if (originalOfferGift) {
        gifting.offerGift = function favorPointGiftOffer(walker, ...args) {
          const context = captureHeldGift(); // Used during adjustNpcFavor to scale this one gift by quality.
          activeGiftContext = context;
          let result = false; // Used to decide whether the quality bucket should actually be consumed.
          try { result = originalOfferGift(walker, ...args); }
          finally { activeGiftContext = null; }
          if (result && context?.kind === 'item') consumeGiftQualityUnit(context);
          return result;
        };
      }
    }

    function relationshipDebug(npcId) {
      const favorPoints = favorPointsForNpc(npcId); // Used as the player-facing stored relationship XP in the in-game debug log.
      const heartProgress = favorPointsToHearts(favorPoints); // Used to verify the exact heart fill derived from that XP.
      const snapshot = {
        npcId: String(npcId || ''),
        favorPoints,
        heartProgress,
        favorPointsPerHeart: FAVOR_POINTS_PER_HEART,
      };
      window.__farmLog?.(`[favor-balance] ${snapshot.npcId || '(missing npc)'}: ${formatCompact(favorPoints)} Favor = ${formatCompact(heartProgress)} hearts.`, 'info', 'social');
      return snapshot;
    }

    window.NpcFavorBalance = Object.freeze({
      version: 3,
      storageUnit: 'favor-points',
      favorPointsPerHeart: FAVOR_POINTS_PER_HEART,
      maxGiftFavorPoints: MAX_GIFT_FAVOR_POINTS,
      favorPointsToHearts,
      heartsToFavorPoints,
      favorPointsForNpc,
      relationshipHeartsForNpc,
      relationshipDebug,
      giftQualityMultiplierForStars: stars => clamp(finite(stars, 3), 1, 5) / 5,
      maxRapportOvernightHearts: (rapport = 100, rate = 0.10) => favorPointsToHearts(Math.round(Math.max(0, finite(rapport, 0)) * Math.max(0, finite(rate, 0)))),
      debugSnapshot: () => ({
        installedVia: installReason,
        storageUnit: 'favor-points',
        favorPointsPerHeart: FAVOR_POINTS_PER_HEART,
        maxGiftFavorPoints: MAX_GIFT_FAVOR_POINTS,
        activeGift: activeGiftContext ? { kind: activeGiftContext.kind, key: activeGiftContext.key, stars: activeGiftContext.stars } : null,
        proceduralTasksPatched: !!window.ProceduralTasks?.__favorPointHeartScalePatched,
        maxRapportHeartsAt100: favorPointsToHearts(10),
      }),
    });

    armProceduralTasksPatch();
    delete window[DIALOGUE_INSTALL_FLAG];
    window.__farmLog?.(`[favor-balance] installed (${installReason}); stored Favor remains points, ${FAVOR_POINTS_PER_HEART} points fill one heart.`, 'info', 'social');
    return true;
  }

  function armDialogueContentInstall() {
    if (window[DIALOGUE_INSTALL_FLAG]) return true;
    const armed = armAssignment('DialogueContent', DIALOGUE_INSTALL_FLAG, () => { // Used to install exactly when the parser later publishes DialogueContent.
      installReason = 'dialogue-assignment';
      if (!install()) window.__farmLog?.('[favor-balance] DialogueContent appeared but the Favor-point hooks could not install.', 'error', 'social');
    });
    if (armed) window.__farmLog?.('[favor-balance] waiting for DialogueContent before installing Favor-point/heart conversion.', 'info', 'social');
    return armed;
  }

  armProceduralTasksPatch();
  if (!install() && !armDialogueContentInstall()) {
    window.__farmLog?.('[favor-balance] could not arm the DialogueContent dependency hook; Favor-point/heart conversion is inactive.', 'error', 'social');
  }
})();