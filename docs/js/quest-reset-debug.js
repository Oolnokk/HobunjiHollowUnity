(() => {
  'use strict';

  if (window.QuestResetDebug?.installed) return;

  let taskDeps = null; // Captured from TasksPanel.init; used for the canonical live questProgress object and toast/render helpers.
  let saveMemberWorldData = null; // Captured from BanubuQuestline.init; used to persist generic resets through the game's canonical world-member save path.

  function wrapInit(api, key, capture) {
    if (!api?.init || api[key]) return;
    const original = api.init;
    api.init = function questResetCaptureInit(injectedDeps, ...args) {
      capture(injectedDeps || null);
      return original.call(this, injectedDeps, ...args);
    };
    api[key] = true;
  }

  wrapInit(window.TasksPanel, '__questResetCaptureInstalled', deps => { taskDeps = deps; });
  wrapInit(window.BanubuQuestline, '__questResetCaptureInstalled', deps => {
    if (typeof deps?.saveMemberWorldData === 'function') saveMemberWorldData = deps.saveMemberWorldData;
  });

  function questStore() {
    return taskDeps?.getQuestProgress?.() || window.__hobunjiPlayerProfile?.questProgress || null;
  }

  function isActiveQuest(state) {
    const kind = state?.progress?.kind;
    if (kind === 'story') return ['active', 'offer', 'intro'].includes(state?.status);
    if (['request', 'favor', 'bounty'].includes(kind)) return state?.status === 'available';
    return false;
  }

  function questNpcId(state) {
    const progress = state?.progress || {};
    if (progress.npcId) return String(progress.npcId);
    if (progress.provider === 'banubu') return 'banubu';
    return '';
  }

  function questLabel(id, state) {
    const progress = state?.progress || {};
    if (progress.title) return String(progress.title);
    if (progress.kind === 'bounty' && progress.captainName) return `Bounty: ${progress.captainName}`;
    if (progress.npcName) return `${progress.npcName} — ${progress.kind || 'quest'}`;
    return id;
  }

  function activeQuests() {
    return Object.entries(questStore() || {})
      .filter(([, state]) => isActiveQuest(state))
      .map(([id, state]) => ({ id, state, label: questLabel(id, state), npcId: questNpcId(state) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function resetNpcDialogue(npcId) {
    if (!npcId || !window.DialogueContent?.getNpcDlgState) return false;
    const state = window.DialogueContent.getNpcDlgState(npcId);
    if (!state) return false;
    state.visitedSeqSlots = {};
    state.localNickname = null;
    state.memory = [];
    state.heardTrees = [];
    state.heardPoolEntries = [];
    return true;
  }

  function persist() {
    const profile = window.__hobunjiPlayerProfile;
    if (profile && window.DialogueContent?.npcRelationshipsSnapshot) {
      profile.npcRelationships = window.DialogueContent.npcRelationshipsSnapshot();
    }
    if (typeof saveMemberWorldData === 'function') {
      saveMemberWorldData();
      return true;
    }
    return false;
  }

  function resetQuest(questId) {
    const store = questStore();
    const state = store?.[questId];
    if (!store || !state || !isActiveQuest(state)) return { ok: false, message: 'That quest is not currently active.' };
    const npcId = questNpcId(state);

    if (state.progress?.provider === 'banubu' && window.BanubuQuestline?.resetForDebug) {
      window.BanubuQuestline.resetForDebug();
    } else {
      delete store[questId];
    }

    const dialogueReset = resetNpcDialogue(npcId);
    window.DialogueContent?.resetDialogueState?.();
    window.AmbientDialogue?.clear?.();
    persist();
    window.TasksPanel?.render?.();
    return {
      ok: true,
      questId,
      npcId: npcId || null,
      dialogueReset,
      message: dialogueReset
        ? `Reset ${questLabel(questId, state)} and all saved dialogue history for ${npcId}. Relationship favor was preserved.`
        : `Reset ${questLabel(questId, state)}. No quest-giver dialogue state was attached.`,
    };
  }

  function refreshUi() {
    const select = document.getElementById('questResetDebugSelect');
    const button = document.getElementById('questResetDebugBtn');
    const status = document.getElementById('questResetDebugStatus');
    if (!select || !button) return;
    const current = select.value;
    const quests = activeQuests();
    select.innerHTML = quests.length
      ? quests.map(entry => `<option value="${String(entry.id).replace(/"/g, '&quot;')}">${entry.label}</option>`).join('')
      : '<option value="">No active quests</option>';
    if (quests.some(entry => entry.id === current)) select.value = current;
    button.disabled = !quests.length;
    if (status && !quests.length) status.textContent = 'No active quests to reset.';
  }

  function installUi() {
    if (document.getElementById('questResetDebugPanel')) return true;
    const pane = document.getElementById('mpDebug');
    const column = pane?.firstElementChild;
    if (!column) return false;

    const panel = document.createElement('div');
    panel.id = 'questResetDebugPanel';
    panel.style.cssText = 'flex-shrink:0;margin:7px 10px;padding:8px;border:1px solid rgba(255,255,255,.16);border-radius:7px;background:rgba(0,0,0,.22);font:11px/1.35 ui-monospace,monospace;color:#d1d5db';
    panel.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">Quest Reset</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <select id="questResetDebugSelect" style="min-width:min(320px,100%);flex:1;padding:5px"></select>
        <button type="button" id="questResetDebugBtn" class="settings-small-btn danger">Reset Quest + Dialogue</button>
      </div>
      <div id="questResetDebugStatus" style="margin-top:5px;color:#aeb8c4">Resets the active quest and its quest-giver's saved dialogue history. Favor is preserved.</div>`;
    column.insertBefore(panel, column.firstChild);

    panel.querySelector('#questResetDebugBtn')?.addEventListener('click', () => {
      const select = panel.querySelector('#questResetDebugSelect');
      const id = select?.value;
      if (!id) return;
      if (!window.confirm?.('Reset this quest and replay its quest-giver dialogue from the beginning?')) return;
      const result = resetQuest(id);
      const status = panel.querySelector('#questResetDebugStatus');
      if (status) status.textContent = result.message || (result.ok ? 'Reset complete.' : 'Reset failed.');
      taskDeps?.showToast?.(result.message || 'Quest reset.', result.ok);
      refreshUi();
    });
    document.querySelector('[data-mpanel="debug"]')?.addEventListener('click', () => queueMicrotask(refreshUi));
    refreshUi();
    return true;
  }

  function install() {
    if (installUi()) return;
    window.addEventListener('DOMContentLoaded', installUi, { once: true });
  }

  window.QuestResetDebug = {
    installed: true,
    activeQuests,
    resetQuest,
    resetNpcDialogue,
    refreshUi,
  };
  install();
})();
