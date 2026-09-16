(() => {
  'use strict';

  if (Number(window.NpcFavorBalance?.version) >= 2) return;

  const FAVOR_POINTS_PER_HEART = 40; // Public progression tuning: forty Favor points fill one permanent relationship heart.
  const MAX_GIFT_FAVOR_POINTS = 10; // A single gift can never exceed one loved-gift unit before quality scaling.
  const MIGRATION_EVENT = 'favor_points_40_per_heart_v1'; // Persisted in relationship memory so old positive heart-scale saves are converted exactly once.
  const HEART_PRECISION = 10000; // Keeps quarter-hearts and small spillover fractions exact without float noise.
  const INSTALL_ARMED_FLAG = '__npcFavorBalanceInstallArmed'; // Prevents duplicate lazy-install hooks while DialogueContent is still loading.
  let installReason = 'direct'; // Exposed by debugSnapshot so the in-game log can confirm whether the late dependency hook was needed.

  function install() {
    if (Number(window.NpcFavorBalance?.version) >= 2) return true;

    const dialogue = window.DialogueContent;
    const gifting = window.NpcGifting;
    if (!dialogue?.getNpcDlgState || !dialogue?.adjustNpcFavor || !dialogue?.loadNpcRelationships) return false;

    let dialogueDeps = null; // Captured from DialogueContent.init so spillover can reuse the authoritative NPC record collection.
    let giftingDeps = null; // Captured from NpcGifting.init so gift quality follows the exact held stack being consumed.
    let activeGiftContext = null; // Set only during NpcGifting.offerGift so gift Favor can see the selected item's star tier.
    const stateProxyCache = new WeakMap(); // Keeps one stable Rapport-rollover-aware proxy per relationship state object.
    const pendingRapportRollover = new WeakMap(); // Raw state -> expected Favor-point gain after NpcRapport clears Rapport at civil midnight.

    const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const roundHeart = value => Math.round(finite(value, 0) * HEART_PRECISION) / HEART_PRECISION;
    const favorPointsToHearts = points => finite(points, 0) / FAVOR_POINTS_PER_HEART;
    const heartsToFavorPoints = hearts => finite(hearts, 0) * FAVOR_POINTS_PER_HEART;

    function rapportToFavorRate() {
      const authored = window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.rapportToFavorRate;
      return Math.max(0, finite(authored, 0.10));
    }

    function hasScaleMarker(memory) {
      return Array.isArray(memory) && memory.some(entry => entry?.event === MIGRATION_EVENT || entry?.type === MIGRATION_EVENT);
    }

    function addScaleMarker(stateOrRelationship) {
      if (!stateOrRelationship) return;
      if (!Array.isArray(stateOrRelationship.memory)) stateOrRelationship.memory = [];
      if (hasScaleMarker(stateOrRelationship.memory)) return;
      stateOrRelationship.memory.push({ event: MIGRATION_EVENT, day: dialogueDeps?.calendar?.day ?? 0, ts: Date.now() });
      if (stateOrRelationship.memory.length > 50) stateOrRelationship.memory.shift();
    }

    function migrateLegacyPositiveFavor(playerData) {
      const relationships = playerData?.npcRelationships;
      if (!relationships || typeof relationships !== 'object') return 0;
      let migrated = 0;
      for (const relationship of Object.values(relationships)) {
        if (!relationship || hasScaleMarker(relationship.memory)) continue;
        // Positive Favor accumulated while 1 Favor incorrectly equaled one heart
        // is reinterpreted as Favor points. Existing negative dispositions are
        // deliberately preserved so authored hostility (e.g. a frosty start)
        // does not disappear during this balance correction.
        const oldFavor = finite(relationship.favor, 0);
        if (oldFavor > 0) relationship.favor = roundHeart(favorPointsToHearts(oldFavor));
        addScaleMarker(relationship);
        migrated++;
      }
      return migrated;
    }

    const originalDialogueInit = dialogue.init?.bind(dialogue);
    if (originalDialogueInit) {
      dialogue.init = function favorBalancedDialogueInit(injectedDeps, ...args) {
        dialogueDeps = injectedDeps;
        return originalDialogueInit(injectedDeps, ...args);
      };
    }

    const originalLoadRelationships = dialogue.loadNpcRelationships.bind(dialogue);
    dialogue.loadNpcRelationships = function favorBalancedRelationshipLoad(playerData, ...args) {
      const migrated = migrateLegacyPositiveFavor(playerData);
      const result = originalLoadRelationships(playerData, ...args);
      if (migrated) window.__farmLog?.(`[favor-balance] migrated ${migrated} relationship record(s) from 1-Favor-per-heart progression.`, 'info', 'social');
      return result;
    };

    const rawGetNpcState = dialogue.getNpcDlgState.bind(dialogue);

    function proxiedRelationshipState(rawState) {
      if (!rawState || typeof rawState !== 'object') return rawState;
      addScaleMarker(rawState);
      if (stateProxyCache.has(rawState)) return stateProxyCache.get(rawState);
      const proxy = new Proxy(rawState, {
        set(target, property, value, receiver) {
          if (property === 'rapport') {
            const before = Math.max(0, finite(target.rapport, 0));
            const next = Math.max(0, finite(value, before));
            if (before > 0 && next === 0) {
              const favorPoints = Math.round(before * rapportToFavorRate());
              if (favorPoints > 0) pendingRapportRollover.set(target, favorPoints);
              else pendingRapportRollover.delete(target);
            } else if (next > 0) {
              pendingRapportRollover.delete(target);
            }
            return Reflect.set(target, property, value, receiver);
          }
          if (property !== 'favor') return Reflect.set(target, property, value, receiver);

          const requestedAbsolute = Number(value);
          if (!Number.isFinite(requestedAbsolute)) return Reflect.set(target, property, value, receiver);
          const currentHearts = finite(target.favor, 0);
          const requestedDelta = requestedAbsolute - currentHearts;
          const expectedRolloverPoints = pendingRapportRollover.get(target);
          pendingRapportRollover.delete(target);

          // NpcRapport is the one runtime that still mutates state.favor
          // directly: it first clears positive Rapport to zero, then assigns
          // current Favor + Math.round(oldRapport * rate). Recognizing that
          // exact sequence lets ordinary absolute `state.favor = X` assignments
          // (faction initialization, tests, authored state) remain heart-space.
          if (Number.isFinite(expectedRolloverPoints) && Math.abs(requestedDelta - expectedRolloverPoints) < 0.000001) {
            target.favor = roundHeart(currentHearts + favorPointsToHearts(expectedRolloverPoints));
            addScaleMarker(target);
            return true;
          }
          return Reflect.set(target, property, value, receiver);
        },
      });
      stateProxyCache.set(rawState, proxy);
      return proxy;
    }

    dialogue.getNpcDlgState = function favorBalancedGetNpcState(npcId, ...args) {
      return proxiedRelationshipState(rawGetNpcState(npcId, ...args));
    };

    function npcRecords() {
      const fromDeps = dialogueDeps?.getNpcRecords?.();
      if (Array.isArray(fromDeps)) return fromDeps;
      const walkers = window.__hobunjiFurnitureDebug?.getNpcWalkers?.();
      return Array.isArray(walkers) ? walkers.map(walker => walker?.rec).filter(Boolean) : [];
    }

    function relatedNpcBonds(npcId) {
      const records = npcRecords();
      const source = records.find(record => record?.id === npcId);
      if (!source) return [];
      const bonds = new Map();
      for (const other of records) {
        if (!other?.id || other.id === npcId) continue;
        const sameHome = source.homeId && other.homeId === source.homeId;
        const sameWork = source.scheduleHooks?.workBuildingId && other.scheduleHooks?.workBuildingId === source.scheduleHooks.workBuildingId;
        if (!sameHome && !sameWork) continue;
        const fraction = sameHome ? 0.25 : 0.15;
        if (!bonds.has(other.id) || bonds.get(other.id) < fraction) bonds.set(other.id, fraction);
      }
      return [...bonds.entries()];
    }

    function activeGiftStars() {
      if (activeGiftContext?.kind !== 'item') return null;
      return activeGiftContext.stars;
    }

    function giftQualityMultiplier() {
      const stars = activeGiftStars();
      return stars == null ? 1 : clamp(stars, 1, 5) / 5;
    }

    function balancedGiftPoints(points) {
      return clamp(finite(points, 0), -MAX_GIFT_FAVOR_POINTS, MAX_GIFT_FAVOR_POINTS) * giftQualityMultiplier();
    }

    function formatCompact(value) {
      const rounded = Math.round(finite(value, 0) * 100) / 100;
      return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
    }

    // Replaces the old one-decimal Favor mutation path. Callers continue to
    // author familiar values such as +10 loved / +4 liked / +1 neutral, but
    // those values are now Favor POINTS, not whole hearts.
    dialogue.adjustNpcFavor = function favorPointAdjustment(npcId, amount, reason, isSpillover = false, skipPositiveMultiplier = false) {
      if (!npcId) return 0;
      let favorPoints = finite(amount, 0);
      if (!isSpillover && /^gift_/i.test(String(reason || ''))) favorPoints = balancedGiftPoints(favorPoints);

      let heartDelta = favorPointsToHearts(favorPoints);
      if (heartDelta > 0 && !skipPositiveMultiplier) heartDelta *= finite(window.AlchemySystem?.getPositiveFavorMultiplier?.(), 1);
      heartDelta = roundHeart(heartDelta);
      if (!heartDelta) {
        if (!isSpillover) dialogue.recordNpcMemory?.(npcId, reason || 'favor_no_change');
        return 0;
      }

      const state = rawGetNpcState(npcId);
      addScaleMarker(state);
      state.favor = roundHeart(finite(state.favor, 0) + heartDelta);
      if (isSpillover) return heartDelta;

      const appliedPoints = heartsToFavorPoints(heartDelta);
      window.WorldPopupText?.queueReward?.('favor', `${appliedPoints > 0 ? '+' : '−'}${formatCompact(Math.abs(appliedPoints))} Favor`);
      dialogue.recordNpcMemory?.(npcId, reason || (heartDelta >= 0 ? 'favor_up' : 'favor_down'));

      for (const [relatedId, fraction] of relatedNpcBonds(npcId)) {
        dialogue.adjustNpcFavor(relatedId, appliedPoints * fraction, `spillover_${npcId}`, true, true);
      }
      return heartDelta;
    };

    // Render fractional progress so Favor remains visible as XP toward the
    // next heart instead of looking like one whole heart per Favor point.
    const originalRenderHearts = dialogue.renderRelationshipHearts?.bind(dialogue);
    dialogue.renderRelationshipHearts = function favorPointRelationshipHearts(rec) {
      if (!rec?.relationship) return originalRenderHearts?.(rec) || '';
      const heartScore = finite(rawGetNpcState(rec.id)?.favor, 0);
      const clamped = clamp(heartScore, -5, 10);
      const progress = clamp(clamped + 5, 0, 15);
      const completed = Math.floor(progress);
      const fraction = progress - completed;
      const hearts = [];
      for (let index = 0; index < 15; index++) {
        const fill = index < 5 ? '💜' : '❤️';
        if (index < completed) {
          hearts.push(fill);
        } else if (index === completed && fraction > 0.0001) {
          const width = Math.round(fraction * 1000) / 10;
          hearts.push(`<span class="favor-partial-heart" style="position:relative;display:inline-block;width:1.05em;overflow:hidden;vertical-align:-.08em"><span aria-hidden="true">🤍</span><span aria-hidden="true" style="position:absolute;left:0;top:0;width:${width}%;overflow:hidden;white-space:nowrap">${fill}</span></span>`);
        } else if (index === completed && completed < 15) {
          hearts.push('🩶');
        } else {
          hearts.push('🤍');
        }
      }
      return hearts.join('');
    };

    function captureHeldGift() {
      const held = giftingDeps?.getHeldGiftItem?.();
      if (!held) return null;
      if (held.kind !== 'item') return { kind: held.kind || 'other', key: held.key || null, stars: null, held };
      const trackedStars = Number(window.CookingSystem?.peekLowestQuality?.(held.key));
      const fallbackStars = Number(held?.def?.qualityStars ?? held?.def?.cookingDefaultStars ?? 3);
      const stars = clamp(Math.round(Number.isFinite(trackedStars) ? trackedStars : fallbackStars), 1, 5);
      return { kind: 'item', key: held.key, stars, held };
    }

    function consumeGiftQualityUnit(context) {
      if (!context?.key || !Number.isFinite(context.stars) || !giftingDeps?.inventory || !window.CookingSystem?.consumeQuality) return;
      const afterGiftCount = Math.max(0, finite(giftingDeps.inventory[context.key], 0));
      // NpcGifting already removed one inventory unit. Restore that one count
      // momentarily so CookingSystem can remove the exact star bucket without
      // double-consuming the actual item stack.
      giftingDeps.inventory[context.key] = afterGiftCount + 1;
      const consumed = window.CookingSystem.consumeQuality(context.key, context.stars, 1);
      if (!consumed) giftingDeps.inventory[context.key] = afterGiftCount;
      giftingDeps.clampInventoryStack?.(context.key);
    }

    if (gifting) {
      const originalGiftInit = gifting.init?.bind(gifting);
      if (originalGiftInit) {
        gifting.init = function favorBalancedGiftInit(injectedDeps, ...args) {
          giftingDeps = injectedDeps;
          return originalGiftInit(injectedDeps, ...args);
        };
      }
      const originalOfferGift = gifting.offerGift?.bind(gifting);
      if (originalOfferGift) {
        gifting.offerGift = function favorBalancedOfferGift(walker, ...args) {
          const context = captureHeldGift();
          activeGiftContext = context;
          let result = false;
          try { result = originalOfferGift(walker, ...args); }
          finally { activeGiftContext = null; }
          if (result && context?.kind === 'item') consumeGiftQualityUnit(context);
          return result;
        };
      }
    }

    function relationshipDebug(npcId) {
      const storedHearts = finite(rawGetNpcState(String(npcId || ''))?.favor, 0);
      const snapshot = {
        npcId: String(npcId || ''),
        storedHearts,
        favorPoints: heartsToFavorPoints(storedHearts),
        favorPointsPerHeart: FAVOR_POINTS_PER_HEART,
      };
      window.__farmLog?.(`[favor-balance] ${snapshot.npcId || '(missing npc)'}: ${formatCompact(snapshot.favorPoints)} Favor = ${formatCompact(snapshot.storedHearts)} hearts.`, 'info', 'social');
      return snapshot;
    }

    window.NpcFavorBalance = Object.freeze({
      version: 2,
      favorPointsPerHeart: FAVOR_POINTS_PER_HEART,
      maxGiftFavorPoints: MAX_GIFT_FAVOR_POINTS,
      favorPointsToHearts,
      heartsToFavorPoints,
      relationshipDebug,
      giftQualityMultiplierForStars: stars => clamp(finite(stars, 3), 1, 5) / 5,
      maxRapportOvernightHearts: (rapport = 100, rate = 0.10) => favorPointsToHearts(Math.round(Math.max(0, finite(rapport, 0)) * Math.max(0, finite(rate, 0)))),
      debugSnapshot: () => ({
        installedVia: installReason,
        favorPointsPerHeart: FAVOR_POINTS_PER_HEART,
        maxGiftFavorPoints: MAX_GIFT_FAVOR_POINTS,
        activeGift: activeGiftContext ? { kind: activeGiftContext.kind, key: activeGiftContext.key, stars: activeGiftContext.stars } : null,
        maxRapportHeartsAt100: favorPointsToHearts(10),
      }),
    });
    delete window[INSTALL_ARMED_FLAG];
    window.__farmLog?.(`[favor-balance] installed (${installReason}); ${FAVOR_POINTS_PER_HEART} Favor per heart.`, 'info', 'social');
    return true;
  }

  function armDialogueContentInstall() {
    if (window[INSTALL_ARMED_FLAG]) return true;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'DialogueContent'); // Used to install exactly when the parser later publishes DialogueContent.
    if (descriptor && !descriptor.configurable) return false;
    if (descriptor?.get || descriptor?.set) return false;

    let dialogueValue = descriptor?.value;
    Object.defineProperty(window, 'DialogueContent', {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return dialogueValue; },
      set(value) {
        dialogueValue = value;
        Object.defineProperty(window, 'DialogueContent', {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
        installReason = 'dialogue-assignment';
        if (!install()) window.__farmLog?.('[favor-balance] DialogueContent appeared but the Favor balance hooks could not install.', 'error', 'social');
      },
    });
    window[INSTALL_ARMED_FLAG] = true;
    window.__farmLog?.('[favor-balance] waiting for DialogueContent before installing Favor/heart conversion.', 'info', 'social');
    return true;
  }

  if (!install() && !armDialogueContentInstall()) {
    window.__farmLog?.('[favor-balance] could not arm the DialogueContent dependency hook; Favor/heart conversion is inactive.', 'error', 'social');
  }
})();
