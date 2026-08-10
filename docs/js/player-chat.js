// Local player chat/log shell designed to become a multiplayer transport
// boundary later. Enter opens it; plain messages appear above the player;
// slash commands are handled locally and are never offered to NPC dialogue.
(() => {
  'use strict';

  const MAX_MESSAGE_LENGTH = 240;
  const MAX_LOG_ENTRIES = 100;
  const POSE_COMMANDS = new Set(['sit', 'lie', 'kneel', 'stand']);
  const state = { deps: null, open: false, log: [], root: null, list: null, input: null, storageKey: null };

  function esc(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
  }

  function injectStyles() {
    if (document.getElementById('playerChatStyles')) return;
    const style = document.createElement('style');
    style.id = 'playerChatStyles';
    style.textContent = `
      #playerChatShell{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(720px,calc(100vw - 24px));z-index:2400;display:none;font-family:'KhymeryyanRomanLetters+Numbers','DM Mono',monospace;color:#fff}
      #playerChatShell.open{display:block}
      #playerChatLog{max-height:min(38vh,280px);overflow:auto;padding:10px 12px;background:rgba(17,12,10,.88);border:1px solid rgba(255,239,205,.35);border-radius:12px 12px 0 0;box-shadow:0 12px 36px rgba(0,0,0,.4)}
      .playerChatLine{margin:0 0 6px;line-height:1.35;text-shadow:0 2px 2px #000}.playerChatLine.system{color:#f6d98f}.playerChatName{color:#9de7ff;font-weight:900}
      #playerChatForm{display:flex;gap:7px;padding:8px;background:rgba(17,12,10,.96);border:1px solid rgba(255,239,205,.35);border-top:0;border-radius:0 0 12px 12px}
      #playerChatInput{flex:1;min-width:0;padding:10px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#090706;color:#fff;font:inherit;font-size:16px}
      #playerChatSend{padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:#72533b;color:#fff;font:inherit;font-weight:900}
      #playerChatHint{font-size:11px;color:#d6c8b7;padding:5px 9px;background:rgba(17,12,10,.82)}
    `;
    document.head.appendChild(style);
  }

  function ensureUi() {
    if (state.root?.isConnected) return;
    injectStyles();
    const root = document.createElement('section');
    root.id = 'playerChatShell';
    root.setAttribute('aria-label', 'Chat log');
    root.innerHTML = `<div id="playerChatLog" role="log" aria-live="polite"></div><div id="playerChatHint">Enter sends · Esc closes · /sit /lie /kneel hold a pose · /stand clears it</div><form id="playerChatForm"><input id="playerChatInput" maxlength="${MAX_MESSAGE_LENGTH}" autocomplete="off" placeholder="Message or /command…" aria-label="Chat message"><button id="playerChatSend" type="submit">Send</button></form>`;
    document.body.appendChild(root);
    state.root = root;
    state.list = root.querySelector('#playerChatLog');
    state.input = root.querySelector('#playerChatInput');
    root.querySelector('#playerChatForm').addEventListener('submit', event => {
      event.preventDefault();
      submit(state.input.value);
    });
    render();
  }

  function resolveStorageKey() {
    return `hobunjiPlayerChat.v1:${state.deps?.getWorldId?.() || 'local'}`;
  }

  function loadLog() {
    state.storageKey = resolveStorageKey();
    try {
      const saved = JSON.parse(localStorage.getItem(state.storageKey) || '[]');
      state.log = Array.isArray(saved) ? saved.slice(-MAX_LOG_ENTRIES) : [];
    } catch (_) { state.log = []; }
  }

  function saveLog() {
    try { localStorage.setItem(state.storageKey || resolveStorageKey(), JSON.stringify(state.log.slice(-MAX_LOG_ENTRIES))); } catch (_) {}
  }

  function render() {
    if (!state.list) return;
    state.list.innerHTML = state.log.map(entry => entry.system
      ? `<div class="playerChatLine system">${esc(entry.text)}</div>`
      : `<div class="playerChatLine"><span class="playerChatName">${esc(entry.name)}:</span> ${esc(entry.text)}</div>`).join('');
    state.list.scrollTop = state.list.scrollHeight;
  }

  function addLog(entry) {
    state.log.push({ ...entry, timestamp: Date.now() });
    if (state.log.length > MAX_LOG_ENTRIES) state.log.splice(0, state.log.length - MAX_LOG_ENTRIES);
    saveLog();
    render();
  }

  function open() {
    ensureUi();
    const nextKey = resolveStorageKey();
    if (state.storageKey !== nextKey) { loadLog(); render(); }
    state.open = true;
    state.deps?.clearMovementInput?.();
    state.root.classList.add('open');
    state.input.focus();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    state.root?.classList.remove('open');
    state.input?.blur();
  }

  function runCommand(raw) {
    const [name] = raw.slice(1).trim().toLowerCase().split(/\s+/);
    if (!POSE_COMMANDS.has(name)) {
      addLog({ system: true, text: `Unknown command: /${name || ''}` });
      return;
    }
    const result = state.deps?.setHeldPose?.(name);
    addLog({ system: true, text: result?.message || (result?.ok === false ? `Could not use /${name}.` : `/${name}`) });
  }

  function submit(raw) {
    const message = String(raw || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message) return;
    state.input.value = '';
    if (message.startsWith('/')) {
      runCommand(message);
      return;
    }
    const name = state.deps?.getPlayerName?.() || 'Player';
    addLog({ name, text: message, system: false });
    state.deps?.showPlayerMessage?.(message);
    window.dispatchEvent(new CustomEvent('hobunji-player-chat-send', { detail: { name, text: message } }));
  }

  function onKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!state.open) open();
      else if (document.activeElement !== state.input) state.input.focus();
      else submit(state.input.value);
      return;
    }
    if (!state.open) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }

  function init(deps) {
    state.deps = deps;
    ensureUi();
    loadLog();
    render();
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return api;
  }

  const api = { init, open, close, submit, addLog, get isOpen() { return state.open; }, get entries() { return state.log.slice(); } };
  window.PlayerChat = api;
})();
