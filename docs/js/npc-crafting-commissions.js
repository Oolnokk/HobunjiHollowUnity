(() => {
  'use strict';

  if (Number(window.NpcCraftingCommissions?.version) >= 2) return;

  const VERSION = 2; // Loader/debug version for adapters around the existing task/dialogue/crafting systems.
  const COMMISSION_CHANCE_BY_TIER = Object.freeze([0, 0.12, 0.18, 0.25, 0.32, 0.40]); // Chance an otherwise-generic NPC favor becomes a crafting commission.

  let taskDeps = null; // ProceduralTasks dependency bag used by readiness, completion, and Tasks-tab decoration.
  let craftingDeps = null; // CraftingPanel dependency bag forwarded to the generator for the live furniture catalog.
  let giftingDeps = null; // NpcGifting dependency bag forwarded for NPC records and pack clothing.
  let lastError = null; // Latest integration error for mobile-friendly diagnostics.

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
      const tier = api.friendshipTier?.(npcRec.id) ?? 0; // Live friendship tier, including FavorBalance's point-scale patch.
      if (Math.random() < (COMMISSION_CHANCE_BY_TIER[tier] || 0)) {
        const task = generator()?.generateTask?.(npcRec, tier);
        if (task) return task;
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

  function escapeHtml(value) {
    const esc = taskDeps?.esc; // Existing task-panel escape helper when available.
    if (typeof esc === 'function') return esc(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function decorateQuestRows() {
    const list = document.getElementById('tasksList'); // Accepted Quest Log container rendered by TasksPanel first.
    if (!list || !taskDeps) return;
    const active = Object.entries(taskDeps.getQuestProgress?.() || {})
      .filter(([, state]) => state?.status === 'available' && !!state?.progress?.commission)
      .map(([id, state]) => ({ id, ...state.progress }));
    const rows = [...list.querySelectorAll('.shop-row')]; // Generic favor rows still say “No delivery items recorded” before this specialization pass.
    for (const task of active) {
      const row = rows.find(candidate => candidate.textContent?.includes(`${task.npcName}'s favor`) && candidate.textContent?.includes('No delivery items recorded'));
      if (!row) continue;
      const ready = !!delivery()?.isReady?.(task); // Live literal crafted-output readiness for mobile-visible feedback.
      row.innerHTML = `
        <div class="sh-icon">🛠️</div>
        <div class="sh-info">
          <div class="sh-name">${escapeHtml(task.npcName)}'s crafting commission</div>
          <div class="sh-desc">${escapeHtml(delivery()?.requirementText?.(task) || 'Craft the requested piece.')}</div>
          <div class="sh-desc" style="margin-top:2px;color:${ready ? 'var(--accent)' : 'inherit'};">Reward: ${Math.round(finite(task.rewardGold, 0))}g + ${finite(task.rewardFriendship, 0)} friendship + ${Math.floor(finite(task.rewardMotes, 0))} Motes of Craft. ${ready ? `Ready — return to ${escapeHtml(task.npcName)}.` : 'Craft the requested piece, then return it.'}</div>
        </div>`;
    }
  }

  function patchTasksPanel(api) {
    if (!api?.render || api.__npcCraftingCommissionRowsPatched) return false;
    const originalRender = api.render.bind(api); // Existing Quest Log renderer stays authoritative; commissions are a post-render specialization.
    api.render = async function npcCraftingCommissionTasksRender(...args) {
      const result = await originalRender(...args);
      decorateQuestRows();
      return result;
    };
    Object.defineProperty(api, '__npcCraftingCommissionRowsPatched', { configurable: true, value: true });
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
      generator: generator()?.debugSnapshot?.() || null,
      delivery: delivery()?.debugSnapshot?.() || null,
      mastery: window.CraftingMasterySystem?.debugSnapshot?.() || null,
      lastError,
    };
  }

  window.NpcCraftingCommissions = Object.freeze({ version: VERSION, decorateQuestRows, debugSnapshot });
  window.__craftCommissionDebug = debugSnapshot;

  futureGlobal('ProceduralTasks', patchProceduralTasks);
  futureGlobal('CraftingPanel', patchCraftingPanel);
  futureGlobal('NpcGifting', patchNpcGifting);
  futureGlobal('TasksPanel', patchTasksPanel);
})();
