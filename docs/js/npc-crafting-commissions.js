(() => {
  'use strict';

  if (Number(window.NpcCraftingCommissions?.version) >= 2) return;

  const VERSION = 2; // Loader/debug version for adapters around the existing task/dialogue/crafting systems.
  const COMMISSION_CHANCE_BY_TIER = Object.freeze([0.30, 0.34, 0.37, 0.40, 0.43, 0.46]); // Even new acquaintances may request craftsmanship; a commission remains possible before the first two hearts.

  let taskDeps = null; // ProceduralTasks dependency bag used by readiness, completion, and Tasks-tab decoration.
  let craftingDeps = null; // CraftingPanel dependency bag forwarded to the generator for the live furniture catalog.
  let giftingDeps = null; // NpcGifting dependency bag forwarded for NPC records and pack clothing.
  let lastError = null; // Latest integration error for mobile-friendly diagnostics.
  let lastAttempt = null; // Latest eligible dialogue roll and reason for fallback, visible in mobile diagnostics.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  function generator() { return window.NpcCraftingCommissionGenerator; }
  function delivery() { return window.NpcCraftingCommissionDelivery; }

  function syncSubsystemDeps() {
    const shared = { taskDeps, craftingDeps, giftingDeps }; // Live dependency bundle forwarded to generation and delivery modules.
    generator()?.setDeps?.(shared);
    delivery()?.setDeps?.(shared);
  }

  function activeFavorForNpc(npcId, statuses = ['offered', 'available']) {
    return Object.values(taskDeps?.getQuestProgress?.() || {}).some(state => state?.progress?.npcId === npcId && state?.progress?.kind === 'favor' && statuses.includes(state.status));
  }

  function declinedFavorToday(npcId) {
    return Object.values(taskDeps?.getQuestProgress?.() || {}).some(state => state?.progress?.npcId === npcId
      && state?.progress?.kind === 'favor' && state?.status === 'declined' && state?.progress?.postedDay === taskDeps?.calendar?.day);
  }

  function wrapQuestStatus(injectedDeps) {
    const original = injectedDeps?.setQuestStatus; // Shared mutation path used by dialogue acceptance/decline and task completion.
    if (typeof original !== 'function' || original.__npcCraftingCommissionWrapped) return;
    const wrapped = function npcCraftingCommissionQuestStatus(taskId, status, progressPatch, ...rest) {
      const before = injectedDeps.getQuestProgress?.()?.[taskId]; // Pre-mutation task needed to detect offered→available acceptance.
      const isAcceptance = status === 'available' && before?.status === 'offered' && !!before?.progress?.commission;
      const patch = isAcceptance
        ? { ...(progressPatch || {}), ...(delivery()?.acceptedPatch?.(before.progress) || {}) }
        : (progressPatch || {}); // Acceptance timestamp/inventory baseline persists atomically with status.
      const result = original.call(this, taskId, status, patch, ...rest);
      if (isAcceptance) delivery()?.onAccepted?.(taskId);
      return result;
    };
    wrapped.__npcCraftingCommissionWrapped = true;
    injectedDeps.setQuestStatus = wrapped;
  }

  function patchProceduralTasks(api) {
    if (!api?.init || api.__npcCraftingCommissionsPatched) return false;
    const originalInit = api.init.bind(api); // Existing task setup retained while capturing/wrapping its dependency bag.
    const originalMaybeOfferFavor = api.maybeOfferFavor.bind(api); // Generic fetch-favor generator retained as fallback.
    const originalFavorAskLine = api.favorAskLine.bind(api); // Existing favor dialogue retained for non-commission favors.
    const originalTurnInTask = api.turnInTask.bind(api); // Existing fetch-item turn-in retained for non-commission tasks.

    api.init = function npcCraftingCommissionTaskInit(injectedDeps, ...rest) {
      taskDeps = injectedDeps;
      wrapQuestStatus(injectedDeps);
      const result = originalInit(injectedDeps, ...rest);
      syncSubsystemDeps();
      return result;
    };

    api.maybeOfferFavor = function npcCraftingCommissionMaybeOffer(npcRec) {
      if (!taskDeps || !npcRec?.id || !api.isQuestEligibleNpc?.(npcRec) || api.isRequestGiver?.(npcRec.id)) return originalMaybeOfferFavor(npcRec);
      if (activeFavorForNpc(npcRec.id) || declinedFavorToday(npcRec.id)) return originalMaybeOfferFavor(npcRec);
      const tier = Math.max(0, Math.min(5, Math.floor(finite(api.friendshipTier?.(npcRec.id), 0)))); // Live friendship tier, including FavorBalance's point-scale patch.
      const chance = COMMISSION_CHANCE_BY_TIER[tier]; // One crafting roll per eligible conversation, separate from the ordinary-favor roll.
      const roll = Math.random(); // Stored only for on-demand mobile diagnostics, never polled each frame.
      lastAttempt = { npcId: npcRec.id, day: taskDeps.calendar?.day, tier, chance, roll, generated: false, reason: 'chance missed' };
      if (roll < chance) {
        try {
          const task = generator()?.generateTask?.(npcRec, tier);
          if (task) {
            lastAttempt.generated = true;
            lastAttempt.reason = 'commission offered';
            return task;
          }
          lastAttempt.reason = 'no eligible learned clothing or job-related furniture recipe';
        } catch (error) {
          lastError = String(error?.stack || error);
          lastAttempt.reason = 'generation error';
        }
      }
      return originalMaybeOfferFavor(npcRec);
    };

    api.favorAskLine = function npcCraftingCommissionFavorAskLine(task) {
      return task?.commission ? (generator()?.askLine?.(task) || originalFavorAskLine(task)) : originalFavorAskLine(task);
    };

    api.getTurnInReadyTaskForNpc = function npcCraftingCommissionTurnInReady(npcId) {
      for (const [id, state] of Object.entries(taskDeps?.getQuestProgress?.() || {})) {
        const task = state?.progress;
        if (task?.npcId !== npcId || state.status !== 'available' || !['request', 'favor'].includes(task?.kind)) continue;
        if (task.commission) {
          if (delivery()?.isReady?.(task)) return { id, ...task };
          continue;
        }
        if ((task.items || []).some(item => finite(taskDeps?.inventory?.[item.itemKey], 0) < item.qty)) continue;
        return { id, ...task };
      }
      return null;
    };

    api.turnInTask = function npcCraftingCommissionTurnIn(taskId) {
      const task = taskDeps?.getQuestProgress?.()?.[taskId]?.progress; // Live task used to dispatch commission vs ordinary fetch turn-in.
      return task?.commission ? (delivery()?.complete?.(taskId) || { ok: false, message: 'Crafting commission system unavailable.' }) : originalTurnInTask(taskId);
    };

    Object.defineProperty(api, '__npcCraftingCommissionsPatched', { configurable: true, value: true });
    return true;
  }

  function patchCraftingPanel(api) {
    if (!api?.init || api.__npcCraftingCommissionCatalogPatched) return false;
    const originalInit = api.init.bind(api); // Captures the live furniture catalog without changing CraftingPanel behavior.
    api.init = function npcCraftingCommissionCraftingInit(injectedDeps, ...rest) {
      craftingDeps = injectedDeps;
      const result = originalInit(injectedDeps, ...rest);
      syncSubsystemDeps();
      return result;
    };
    Object.defineProperty(api, '__npcCraftingCommissionCatalogPatched', { configurable: true, value: true });
    return true;
  }

  function patchNpcGifting(api) {
    if (!api?.init || api.__npcCraftingCommissionGiftPatched) return false;
    const originalInit = api.init.bind(api); // Captures NPC-record and pack-clothing helpers without altering ordinary gift reactions.
    api.init = function npcCraftingCommissionGiftInit(injectedDeps, ...rest) {
      giftingDeps = injectedDeps;
      const result = originalInit(injectedDeps, ...rest);
      syncSubsystemDeps();
      return result;
    };
    Object.defineProperty(api, '__npcCraftingCommissionGiftPatched', { configurable: true, value: true });
    return true;
  }

  function futureGlobal(name, patch) {
    if (patch(window[name])) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Chains existing lazy-global setters rather than trampling them.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    let value = descriptor?.value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return previousGet ? previousGet.call(window) : value; },
      set(next) {
        if (previousSet) previousSet.call(window, next); else value = next;
        const resolved = previousGet ? previousGet.call(window) : (previousSet ? next : value);
        patch(resolved);
      },
    });
  }

  function debugSnapshot() {
    return {
      version: VERSION,
      taskDepsReady: !!taskDeps,
      craftingDepsReady: !!craftingDeps,
      giftingDepsReady: !!giftingDeps,
      chanceByTier: [...COMMISSION_CHANCE_BY_TIER],
      lastAttempt: lastAttempt ? { ...lastAttempt } : null,
      generator: generator()?.debugSnapshot?.() || null,
      delivery: delivery()?.debugSnapshot?.() || null,
      mastery: window.CraftingMasterySystem?.debugSnapshot?.() || null,
      lastError,
    };
  }

  window.NpcCraftingCommissions = Object.freeze({ version: VERSION, debugSnapshot });
  window.__craftCommissionDebug = debugSnapshot;

  futureGlobal('ProceduralTasks', patchProceduralTasks);
  futureGlobal('CraftingPanel', patchCraftingPanel);
  futureGlobal('NpcGifting', patchNpcGifting);
})();
