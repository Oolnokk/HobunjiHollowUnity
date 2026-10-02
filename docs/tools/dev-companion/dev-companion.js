// Dev Companion window — the second-window half of js/dev-companion-bridge.js.
// Tied to exactly one play session: the ?session= id picks the
// BroadcastChannel, so it only ever hears (and drives) the game tab that
// opened it, including across that tab's reloads (quick load, backup swaps).
//
// Layout follows context: the header always says where you are and what's
// active (chips), "Now" shows whatever the game is doing plus the tools that
// apply to it (game modules contribute those via DevCompanion.registerPanel),
// and "Follow game" jumps to the tab that matches what just started.
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session') || '';
  const CHANNEL_PREFIX = 'hobunji-dev-companion-v1:';
  const PREFS_KEY = 'hobunjiDevCompanionPrefs.v1';
  const COMMAND_TIMEOUT_MS = 20000;
  const LONG_COMMAND_TIMEOUT_MS = 180000; // Time skips across many in-game days.
  const ALIVE_TIMEOUT_MS = 3500;
  const DIALOGUE_RECENT_MS = 2 * 60 * 1000;
  const AMBIENT_RECENT_MS = 45 * 1000;

  const $ = id => document.getElementById(id);
  const state = {
    connected: false,
    everConnected: false,
    lastAliveAt: 0,
    pageLoadId: '',
    game: {}, // merged state-provider snapshot
    configs: new Map(), // path → entry
    dialogue: null, // latest 'dialogue' trace record
    ambient: null, // latest 'ambient' trace record
    history: [],
    quickSlots: [],
    recovery: null,
    activeTab: 'now',
  };
  const pending = new Map(); // requestId → {resolve, reject, timer}
  const renderedSignatures = {};
  let requestSeq = 0;
  let lastConversationKey = '';
  let lastMapSessionOpen = false;

  const prefs = (() => {
    const defaults = { pauseOnLoad: true, skipRestoreConfirm: false, followContext: true, tab: 'now' };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return defaults; }
  })();
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) {} }

  // ── Transport ───────────────────────────────────────────────────────
  const channel = sessionId && typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_PREFIX + sessionId) : null;

  function post(message) {
    channel?.postMessage({ protocol: 1, session: sessionId, from: 'companion', sentAt: Date.now(), ...message });
  }

  function command(name, args = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    if (!channel) return Promise.reject(new Error('No game session.'));
    const requestId = `c${Date.now().toString(36)}${(++requestSeq).toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('The game did not answer (busy, in a background tab, or reloading).'));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      post({ type: 'command', requestId, name, args });
    });
  }

  async function run(name, args, { okText = '', quiet = false, timeoutMs } = {}) {
    try {
      const result = await command(name, args, timeoutMs);
      if (result?.ok === false || result?.error) throw new Error(result?.error || 'Failed.');
      if (okText) toast(okText);
      return result || { ok: true };
    } catch (error) {
      if (!quiet) toast(String(error?.message || error), true);
      return null;
    }
  }

  function onMessage(message) {
    if (!message || message.protocol !== 1 || message.session !== sessionId || message.from === 'companion') return;
    state.lastAliveAt = Date.now();
    if (message.pageLoadId && message.pageLoadId !== state.pageLoadId) {
      const reloaded = !!state.pageLoadId;
      state.pageLoadId = message.pageLoadId;
      if (reloaded) {
        state.configs.clear();
        state.game = {};
        toast('Game reloaded — reconnected to the same session.');
        post({ type: 'companion-hello' });
      }
    }
    switch (message.type) {
      case 'hello':
        setConnected(true);
        refreshQuickList();
        break;
      case 'alive':
        setConnected(true);
        break;
      case 'bye':
        setConnected(false, 'Game tab is reloading or closed…');
        for (const [id, entry] of pending) { clearTimeout(entry.timer); entry.reject(new Error('The game reloaded before answering.')); pending.delete(id); }
        break;
      case 'state':
        state.game = message.partial ? { ...state.game, ...message.state } : (message.state || {});
        render();
        break;
      case 'config-access':
        if (message.full) state.configs.clear();
        for (const entry of message.entries || []) state.configs.set(entry.path, entry);
        renderConfigs();
        break;
      case 'trace':
        acceptTrace(message.record);
        break;
      case 'trace-snapshot':
        state.history = (message.history || []).slice();
        for (const record of message.latest || []) acceptLatest(record);
        renderNow(); renderHistory();
        break;
      case 'focus-tab':
        if (message.tab) selectTab(message.tab === 'live' ? 'now' : message.tab);
        window.focus?.();
        break;
      case 'reply': {
        const entry = pending.get(message.requestId);
        if (!entry) break;
        clearTimeout(entry.timer);
        pending.delete(message.requestId);
        if (message.ok === false && message.error) entry.reject(new Error(message.error));
        else entry.resolve(message.result);
        break;
      }
    }
  }

  if (channel) channel.onmessage = event => onMessage(event.data);

  function setConnected(connected, text = '') {
    const changed = connected !== state.connected || !state.everConnected;
    state.connected = connected;
    if (connected) state.everConnected = true;
    if (!changed) return;
    const dot = $('connDot');
    dot.className = 'dot' + (connected ? ' on' : '');
    $('connText').textContent = connected ? 'Connected' : (text || (sessionId ? 'Game session not responding' : 'No game session'));
    document.body.classList.toggle('offline', !connected);
    for (const control of document.querySelectorAll('#header button, #autosaveToggle, #panes button, #panes select')) control.disabled = !connected;
    if (connected) render(true);
  }

  setInterval(() => {
    if (!channel) return;
    post({ type: 'companion-heartbeat' });
    // A busy game (zone generation, software WebGL) can miss heartbeats for a
    // while; commands still queue on the channel, so only mark it as busy.
    const stale = state.connected && Date.now() - state.lastAliveAt > ALIVE_TIMEOUT_MS;
    const dot = $('connDot');
    if (stale !== dot.classList.contains('stale') && state.connected) {
      dot.classList.toggle('stale', stale);
      $('connText').textContent = stale ? 'Game busy…' : 'Connected';
    }
  }, 1000);
  window.addEventListener('pagehide', () => post({ type: 'companion-bye' }));

  // ── Helpers ─────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(text, error = false) {
    const box = $('toast');
    box.textContent = text;
    box.className = 'toast' + (error ? ' error' : '');
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, error ? 6000 : 2600);
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function button(label, onclick, { cls = 'small', title = null, active = false, disabled = false } = {}) {
    return el('button', { type: 'button', class: cls + (active ? ' active' : ''), title, disabled: disabled || !state.connected, onclick }, label);
  }

  function ago(at) {
    if (!at) return '';
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return new Date(at).toLocaleTimeString();
  }

  function when(at) {
    if (!at) return '—';
    try { return new Date(at).toLocaleString(); } catch { return String(at); }
  }

  function changed(key, value) {
    let signature = '';
    try { signature = JSON.stringify(value); } catch (_) {}
    if (renderedSignatures[key] === signature) return false;
    renderedSignatures[key] = signature;
    return true;
  }

  async function copyOrShow(title, text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${title} copied.`);
    } catch {
      $('textDialogTitle').textContent = `${title} (clipboard blocked — copy manually)`;
      $('textDialogBody').value = text;
      $('textDialog').showModal();
      $('textDialogBody').select();
    }
  }

  function selectTab(tab, { fromContext = false } = {}) {
    if (!document.querySelector(`#tabs [data-tab="${CSS.escape(tab)}"]`)) return;
    if (fromContext && !prefs.followContext) return;
    state.activeTab = tab;
    if (!fromContext) { prefs.tab = tab; savePrefs(); }
    for (const tabButton of document.querySelectorAll('#tabs [data-tab]')) tabButton.classList.toggle('active', tabButton.dataset.tab === tab);
    for (const pane of document.querySelectorAll('.pane')) pane.classList.toggle('active', pane.dataset.pane === tab);
    if (tab === 'saves') { refreshQuickList(); refreshRecovery(); }
    if (tab === 'files') renderConfigs();
  }

  function currentSave() {
    const session = state.game.session;
    return session?.characterId ? { characterId: session.characterId, worldId: session.worldId } : null;
  }

  function slotsForCurrentSave() {
    const save = currentSave();
    if (!save) return state.quickSlots;
    return state.quickSlots.filter(slot => slot.characterId === save.characterId && slot.worldId === save.worldId);
  }

  function dialogueIsLive() {
    const d = state.dialogue?.payload;
    return !!d && d.event !== 'closed' && !!state.game.session?.context?.dialogueOpen;
  }

  // ── Header: context chips + primary actions ─────────────────────────
  function render(force = false) {
    if (force) for (const key of Object.keys(renderedSignatures)) delete renderedSignatures[key];
    renderHeader();
    renderBadges();
    renderNow();
    renderSaveStatus();
    renderMap();
    renderOverrides();
    followContext();
  }

  function renderHeader() {
    const session = state.game.session;
    const paused = !!state.game.saves?.autosave?.paused;
    const map = state.game.map;
    const talking = dialogueIsLive() ? (state.dialogue.payload.npc?.name || session?.context?.dialogueNpc) : null;
    const latest = slotsForCurrentSave()[0] || null;
    const key = { session, paused, mapOpen: map?.sessionOpen, armed: map?.armed, talking, latest: latest?.id, connected: state.connected };
    if (!changed('header', key)) return;

    const chips = $('contextChips');
    if (!session) {
      chips.replaceChildren(el('span', { class: 'muted small-text', text: state.everConnected ? 'Waiting for the game state…' : 'Open this window from the game: Settings → Dev Companion Window.' }));
    } else if (!session.started) {
      chips.replaceChildren(el('span', { class: 'chip', text: 'At the save-select / loading screen' }));
    } else {
      const exact = session.exact || {};
      const ctx = session.context || {};
      chips.replaceChildren(...[
        el('span', { class: 'chip', title: `${session.characterName || ''} · ${session.worldLabel || ''}`, text: `👤 ${session.characterName || 'Farmer'}` }),
        el('button', { type: 'button', class: 'chip', title: 'Open the Map tab', onclick: () => selectTab('map'), text: `📍 ${exact.areaLabel || exact.area || '?'} · ${exact.col},${exact.row}` }),
        el('span', { class: 'chip', text: `🕰️ ${exact.calendar?.label || ''}${ctx.weekday ? ` · ${ctx.weekday}` : ''}${ctx.season ? ` · ${ctx.season}` : ''}${exact.calendar?.weather ? ` · ${exact.calendar.weather}` : ''}` }),
        talking ? el('button', { type: 'button', class: 'chip talk', onclick: () => selectTab('now'), text: `💬 ${talking}` }) : null,
        map?.sessionOpen ? el('button', { type: 'button', class: 'chip map', onclick: () => selectTab('map'), text: map.armed ? '🎯 Click something in the game' : '🗺️ Map Edit' }) : null,
        paused ? el('button', { type: 'button', class: 'chip paused', onclick: () => selectTab('saves'), title: 'Automatic saving is paused for this game tab', text: '⏸ Autosave paused' }) : null,
      ].filter(Boolean));
    }
    $('autosaveToggle').checked = paused;
    $('quickSaveBtn').disabled = !state.connected || !session?.started;
    const load = $('quickLoadBtn');
    load.disabled = !state.connected || !latest;
    load.textContent = latest ? `↺ Load: ${latest.label}` : '↺ Quick Load';
    load.title = latest ? `Quick load “${latest.label}” (${when(latest.savedAt)}) — Alt+L` : 'No quick save for this farmer/world yet';
    document.title = `${paused ? '⏸ ' : ''}${talking ? '💬 ' : ''}Dev Companion${session?.characterName ? ` — ${session.characterName}` : ''}`;
  }

  function renderBadges() {
    const set = (tab, text) => {
      const badge = document.querySelector(`[data-badge="${tab}"]`);
      if (badge && badge.textContent !== text) badge.textContent = text;
    };
    set('now', dialogueIsLive() ? '●' : '');
    set('map', state.game.map?.sessionOpen ? '●' : '');
    set('saves', state.game.saves?.autosave?.paused ? '⏸' : '');
    const overrides = (state.game.overrides?.databases || []).filter(db => db.active).length;
    set('files', overrides ? String(overrides) : '');
  }

  // Jump to whatever just started in the game (opt-out via "Follow game").
  function followContext() {
    const d = state.dialogue?.payload;
    const conversationKey = dialogueIsLive() ? `${d.npc?.id || ''}|${d.tree?.id || d.selection?.mode || ''}` : '';
    if (conversationKey && conversationKey !== lastConversationKey) selectTab('now', { fromContext: true });
    lastConversationKey = conversationKey;
    const mapOpen = !!state.game.map?.sessionOpen;
    if (mapOpen && !lastMapSessionOpen) selectTab('map', { fromContext: true });
    lastMapSessionOpen = mapOpen;
  }

  // ── Now ─────────────────────────────────────────────────────────────
  function acceptLatest(record) {
    // A 'closed' event carries no node; keep showing the last line it ended on.
    if (record?.channel === 'dialogue') {
      const previous = state.dialogue?.payload;
      state.dialogue = record.payload?.event === 'closed' && previous && previous.npc?.id === record.payload.npc?.id
        ? { ...record, payload: { ...previous, event: 'closed' } }
        : record;
    }
    if (record?.channel === 'ambient') state.ambient = record;
  }

  function acceptTrace(record) {
    if (!record) return;
    state.history.push(record);
    if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
    acceptLatest(record);
    if (record.channel === 'dialogue' || record.channel === 'ambient') { renderNow(); renderBadges(); renderHeader(); followContext(); }
    renderHistory();
  }

  function renderNow() {
    const dialogueShown = renderDialogue();
    const ambientShown = renderAmbient();
    const panelsShown = renderPanels();
    $('nowEmpty').hidden = dialogueShown || ambientShown || panelsShown;
  }

  function checkPill(check) {
    const values = Array.isArray(check.values) ? check.values.join(' | ') : `${check.values?.min ?? '−∞'}..${check.values?.max ?? '∞'}`;
    const current = check.current == null || check.current === '' ? '—' : (typeof check.current === 'number' ? Number(check.current).toFixed(2) : check.current);
    const cls = !check.applicable ? 'na' : (check.pass ? 'pass' : 'fail');
    const verb = check.kind === 'exclude' ? 'not' : 'is';
    return el('span', { class: 'pill ' + cls, title: check.applicable ? null : 'Not applicable here — never disqualifies' }, `${check.pass ? '✓' : '✗'} ${check.axis} ${verb} ${values} (now ${current})`);
  }

  function candidateBlock(candidate) {
    return el('div', { class: 'candidate' + (candidate.picked ? ' picked' : '') + (candidate.eligible ? '' : ' ineligible') },
      el('div', {}, candidate.picked ? '▶ ' : '', el('strong', { text: candidate.id }), candidate.name ? ` — ${candidate.name}` : '',
        el('span', { class: 'muted', text: ` · ${candidate.eligible ? 'eligible' : 'blocked'} · specificity ${candidate.specificity}${candidate.priority ? ` · priority ${candidate.priority}` : ''}${candidate.heard ? ' · heard' : ''}` })),
      candidate.checks?.length ? el('div', {}, ...candidate.checks.map(checkPill)) : el('div', { class: 'muted', text: 'No conditions — always eligible.' }),
    );
  }

  function worldBlock(world) {
    if (!world) return null;
    return el('details', {}, el('summary', { text: 'World state that was checked' }),
      el('div', {}, ...Object.entries(world).filter(([key]) => key !== 'relationshipUnit').map(([key, value]) => el('span', { class: 'pill na', text: `${key}: ${value === '' || value == null ? '—' : (typeof value === 'number' ? Number(value).toFixed(2) : value)}` }))));
  }

  function renderDialogue() {
    const card = $('dialogueCard');
    const record = state.dialogue;
    const d = record?.payload;
    const recent = d && (dialogueIsLive() || Date.now() - record.at < DIALOGUE_RECENT_MS);
    if (!recent) { card.hidden = true; return false; }
    card.hidden = false;
    if (!changed('dialogue', { at: record.at, live: dialogueIsLive() })) return true;
    const live = dialogueIsLive();
    const sel = d.selection;
    const node = d.node;
    const title = el('div', { class: 'card-title' },
      `💬 ${d.npc?.name || 'NPC'}`,
      el('span', { class: live ? 'live-tag' : 'ended-tag', text: live ? 'LIVE' : `ended ${ago(record.at)}` }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted mono small-text', text: d.tree ? `${d.tree.id}${node?.id ? ` › ${node.id}` : ''}` : (sel?.mode === 'synthetic' ? 'synthetic screen' : '') }));
    const parts = [title];
    if (node?.resolvedText || node?.text) parts.push(el('div', { class: 'quote', text: node.resolvedText || node.text }));
    if (d.fallbackLines) parts.push(el('div', { class: 'row-sub', text: d.note }), el('div', { class: 'quote', text: d.fallbackLines.join('\n') }));
    if (node?.choices?.length) {
      parts.push(el('div', { class: 'row-sub' }, ...node.choices.map(choice => el('span', { class: 'pill na', text: `${choice.label}${choice.next ? ` → ${choice.next}` : ''}${choice.actions.length ? ` [${choice.actions.join(', ')}]` : ''}${choice.disabled ? ' (disabled)' : ''}` }))));
    }
    parts.push(el('dl', { class: 'kv small-text' },
      el('dt', { text: 'Config' }), el('dd', { class: 'mono', text: d.source || '—' }),
      node ? el('dt', { text: 'Node' }) : null,
      node ? el('dd', { text: `${node.id || '(inline)'} · ${node.type}${node.next ? ` → ${node.next}` : ''}${node.cameraId ? ` · camera ${node.cameraId}` : ''}${d.sequenceStack?.length ? ` · in sequence ${d.sequenceStack.map(f => f.seqNodeId).join(' › ')}` : ''}` }) : null,
      node?.resolvedText && node.text && node.resolvedText !== node.text ? el('dt', { text: 'Authored' }) : null,
      node?.resolvedText && node.text && node.resolvedText !== node.text ? el('dd', { class: 'mono', text: node.text }) : null,
    ));
    if (sel) {
      parts.push(el('div', { class: 'row-sub', text: `Why: ${sel.mode === 'conditions' ? '' : sel.mode === 'provider' ? 'feature tree provider — ' : 'synthetic — '}${sel.reason}` }));
      const picked = (sel.candidates || []).filter(c => c.picked);
      const others = (sel.candidates || []).filter(c => !c.picked);
      parts.push(...picked.map(candidateBlock));
      if (others.length) parts.push(el('details', {}, el('summary', { text: `${others.length} other tree(s), ${others.filter(c => c.eligible).length} eligible` }), ...others.map(candidateBlock)));
      parts.push(worldBlock(sel.world));
    }
    for (const pool of d.pools || []) {
      parts.push(el('details', {}, el('summary', { text: `Pool “${pool.poolName}” → ${pool.pickedId || 'nothing'}` }),
        el('div', { class: 'row-sub', text: pool.reason }), ...(pool.candidates || []).map(candidateBlock)));
    }
    if (node?.raw) parts.push(el('details', {}, el('summary', { text: 'Raw node JSON' }), el('pre', { class: 'raw', text: JSON.stringify(node.raw, null, 2) })));
    card.replaceChildren(...parts.filter(Boolean));
    return true;
  }

  function renderAmbient() {
    const card = $('ambientCard');
    const record = state.ambient;
    const a = record?.payload;
    if (!a || Date.now() - record.at > AMBIENT_RECENT_MS) { card.hidden = true; return false; }
    card.hidden = false;
    if (!changed('ambient', record.at)) return true;
    card.replaceChildren(
      el('div', { class: 'label-row' }, el('strong', { text: `🗨️ ${a.speakerId || 'Someone'}` }), el('span', { class: 'muted small-text', text: `${a.greeting ? 'greeting' : a.mode}${a.directedAtPlayer ? ' to you' : ''} · ${ago(record.at)}` })),
      el('div', { class: 'quote', text: a.text }),
      el('div', { class: 'row-sub mono', text: a.source }),
    );
    return true;
  }

  // Generic renderer for DevCompanion.registerPanel() panels.
  function renderPanels() {
    const host = $('panelHost');
    const panels = state.game.panels || [];
    if (!changed('panels', { panels, connected: state.connected })) return panels.length > 0;
    host.replaceChildren(...panels.map(panel => {
      const groups = new Map();
      for (const action of panel.actions || []) {
        const group = action.group || '';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(action);
      }
      return el('div', { class: 'card' },
        el('div', { class: 'card-title' }, panel.title, el('span', { class: 'spacer' }), panel.summary ? el('span', { class: 'muted small-text', text: panel.summary }) : null),
        panel.rows?.length ? el('dl', { class: 'kv small-text' }, ...panel.rows.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })])) : null,
        ...[...groups.entries()].map(([group, actions]) => el('div', { class: 'group' },
          group ? el('span', { class: 'group-label', text: group }) : null,
          ...actions.map(action => button(action.label, async () => {
            if (action.confirm && !confirm(action.confirm)) return;
            await run('panel-action', { panel: panel.id, action: action.id, args: action.args || {} }, { timeoutMs: LONG_COMMAND_TIMEOUT_MS });
          }, { title: action.title || null, active: !!action.active })))),
        panel.note ? el('div', { class: 'muted small-text', text: panel.note }) : null,
      );
    }));
    return panels.length > 0;
  }

  function renderHistory() {
    $('historyCount').textContent = state.history.length ? `(${state.history.length})` : '';
    if (!$('historyCard').open) return;
    $('historyList').replaceChildren(...state.history.slice().reverse().slice(0, 120).map(record => {
      const d = record.payload || {};
      const summary = record.channel === 'dialogue'
        ? `${d.event}${d.npc ? ` · ${d.npc.name}` : ''}${d.tree ? ` · ${d.tree.id}` : ''}${d.node ? ` · ${d.node.id || d.node.type}` : ''}`
        : record.channel === 'ambient' ? `${d.speakerId || '?'}: ${d.text}` : JSON.stringify(d).slice(0, 120);
      return el('details', { class: 'row' },
        el('summary', {}, el('span', { class: 'pill na', text: record.channel }), ` ${summary} `, el('span', { class: 'muted small-text', text: new Date(record.at).toLocaleTimeString() })),
        el('pre', { class: 'raw', text: JSON.stringify(d, null, 2) }));
    }));
  }

  // ── Saves ───────────────────────────────────────────────────────────
  function slotRow(slot) {
    return el('div', { class: 'row' },
      el('div', { class: 'row-head' },
        el('span', { class: 'row-title', text: slot.label }), el('span', { class: 'spacer' }),
        button('Load', () => quickLoad(slot.id)),
        button('Rename', async () => {
          const label = prompt('Quick save name:', slot.label);
          if (label != null && await run('quick-rename', { id: slot.id, label })) refreshQuickList();
        }),
        button('✕', async () => {
          if (confirm(`Delete quick save “${slot.label}”?`) && await run('quick-delete', { id: slot.id })) refreshQuickList();
        }, { cls: 'small danger', title: 'Delete' })),
      el('div', { class: 'row-sub', text: `${ago(slot.savedAt)} · ${slot.exact?.areaLabel || '?'}${slot.context?.dialogueOpen ? ` · mid-dialogue with ${slot.context.dialogueNpc}` : ''}` }));
  }

  function renderQuickList() {
    const save = currentSave();
    const mine = slotsForCurrentSave();
    const others = save ? state.quickSlots.filter(slot => !mine.includes(slot)) : [];
    $('quickScope').textContent = save ? `for ${state.game.session?.characterName || 'this farmer'} · ${state.game.session?.worldLabel || 'this world'}` : '';
    $('quickList').replaceChildren(...(mine.length ? mine.map(slotRow) : [el('div', { class: 'muted small-text', text: 'None yet — ⚡ Quick Save in the header saves your exact spot.' })]));
    $('quickOtherWrap').hidden = !others.length;
    $('quickOtherSummary').textContent = `Other farmers/worlds (${others.length}) — loading switches save`;
    $('quickOtherList').replaceChildren(...others.map(slot => {
      const row = slotRow(slot);
      row.append(el('div', { class: 'row-sub', text: `${slot.characterName || slot.characterId} / ${slot.worldLabel || slot.worldId}` }));
      return row;
    }));
    renderHeader();
  }

  async function refreshQuickList() {
    const result = await run('quick-list', {}, { quiet: true });
    if (result) { state.quickSlots = result.slots || []; renderedSignatures.header = ''; renderQuickList(); }
  }

  let quickLoadBusy = false;
  async function quickLoad(id = 'latest') {
    if (quickLoadBusy) return;
    quickLoadBusy = true;
    try {
      const result = await run('quick-load', { id, pauseAutosave: prefs.pauseOnLoad });
      if (result) toast(`Loading “${result.slot?.label || 'quick save'}”…`);
    } finally {
      setTimeout(() => { quickLoadBusy = false; }, 1500);
    }
  }

  async function refreshRecovery() {
    $('recoveryWarnings').textContent = 'Reading recovery history…';
    state.recovery = await run('recovery-list', {}, { quiet: true });
    renderRecovery();
  }

  function renderRecovery() {
    const recovery = state.recovery;
    $('recoveryWarnings').textContent = recovery ? (recovery.warnings || []).join(' | ') : 'Could not read recovery history.';
    const choices = (recovery?.choices || []).filter(choice => choice.available || !choice.current);
    const available = choices.filter(choice => choice.available);
    const empty = choices.filter(choice => !choice.available);
    $('recoveryList').replaceChildren(
      ...available.map(choice => el('div', { class: 'row' },
        el('div', { class: 'row-head' }, el('span', { class: 'row-title', text: choice.title }), el('span', { class: 'spacer' }),
          choice.current ? el('span', { class: 'muted small-text', text: 'live save' }) : button('Restore', async event => {
            if (!prefs.skipRestoreConfirm && !confirm(`Swap to “${choice.title}” (${when(choice.savedAt)})? The current save is kept as “Before Last Restore”, then the game reloads straight back in.`)) return;
            event.target.disabled = true; event.target.textContent = 'Restoring…';
            if (await run('recovery-restore', { slot: choice.slot, autoPlay: true })) toast(`Restored ${choice.title} — reloading…`);
            else { event.target.disabled = false; event.target.textContent = 'Restore'; }
          })),
        el('div', { class: 'row-sub', text: choice.detail }))),
      ...(empty.length ? [el('div', { class: 'muted small-text', text: `No checkpoint yet: ${empty.map(choice => choice.title).join(', ')}.` })] : []),
    );
  }

  function renderSaveStatus() {
    const saves = state.game.saves;
    if (!changed('saveStatus', saves)) return;
    if (!saves) { $('saveStatus').textContent = '—'; return; }
    const a = saves.autosave || {};
    $('saveStatus').textContent = [
      `Autosave: ${a.paused ? `paused since ${when(a.since)} (${a.reason})` : 'running'} · automatic writes skipped this page load: ${a.blockedCount || 0}${a.lastBlocked ? ` (last: ${a.lastBlocked.source})` : ''}`,
      saves.folder ? `Save folder: ${saves.folder.folderName || '—'} · ${saves.folder.state} · ${saves.folder.autoSyncArmed ? 'autosync armed' : 'autosync not armed'} · last ${saves.folder.lastAction || '—'}${saves.folder.lastSyncedAt ? ` @ ${when(saves.folder.lastSyncedAt)}` : ''}${saves.folder.lastError ? `\n  ⚠ ${saves.folder.lastError}` : ''}` : 'Save folder: none (browser save only)',
      saves.checkpoint ? `Recovery checkpoints: ${saves.checkpoint.lastAction}${saves.checkpoint.lastError ? ` ⚠ ${saves.checkpoint.lastError}` : ''}` : '',
      saves.quick ? `Quick save: ${saves.quick.lastAction}${saves.quick.lastError ? ` ⚠ ${saves.quick.lastError}` : ''}${saves.quick.lastResume ? ` · last placement: ${saves.quick.lastResume.ok ? 'ok' : 'FAILED'} ${saves.quick.lastResume.area || ''} ${saves.quick.lastResume.error || ''}` : ''}` : '',
    ].filter(Boolean).join('\n');
  }

  // ── Map ─────────────────────────────────────────────────────────────
  function fmt3(p) {
    if (!p) return '—';
    return [p.x, p.y, p.z].map(v => Number(v ?? 0).toFixed(2)).join(', ');
  }

  function mapSourceFile(map) {
    if (!map?.mapId || map.generated) return map?.generated ? 'generated by the Tothal Shift (no single file)' : '';
    const own = `config/maps/${map.mapId}.json`;
    if (state.configs.has(own)) return own;
    return state.configs.has('config/town-workspace-v1.json') ? 'config/town-workspace-v1.json' : '';
  }

  function renderMap() {
    const map = state.game.map;
    if (!changed('map', { map, files: state.configs.size, connected: state.connected })) return;
    const gate = $('mapGate');
    const main = $('mapMain');
    const showGate = (...content) => { gate.hidden = false; main.hidden = true; gate.replaceChildren(...content); };
    if (!map?.available) return showGate('Map Edit becomes available once the game has loaded a save.');
    if (!map.devMode) return showGate(el('div', { text: 'Map Edit needs Dev Mode.' }), button('Turn on Dev Mode', () => run('dev-mode', { enabled: true }, { okText: 'Dev Mode on.' }), { cls: '' }));
    if (!map.editable) return showGate(el('div', { text: `${map.name ? `${map.name}: ` : ''}${map.reason || 'This area has no Map Editor source.'}` }), el('div', { class: 'small-text', text: 'Walk into the town, a building or a wilderness zone to edit it.' }));
    gate.hidden = true; main.hidden = false;

    $('mapTitle').textContent = `🗺️ ${map.name}`;
    const source = mapSourceFile(map);
    $('mapSummary').textContent = [
      `Layout ${map.layoutId || 'Base'}`,
      map.editorConnected ? 'Map Editor ● connected' : 'Map Editor not open',
      map.runtimeOnlyTransforms ? `${map.runtimeOnlyTransforms} unsaved runtime edit(s)` : '',
      source ? `source ${source}` : '',
    ].filter(Boolean).join(' · ');
    $('mapWarn').textContent = map.generated ? 'Live generated instance — edits are session previews and may be replaced by a Tothal Shift.' : '';
    $('mapSessionBtn').textContent = map.sessionOpen ? 'End session' : 'Start session';
    const pick = $('mapPickBtn');
    pick.textContent = map.armed ? 'Cancel pick' : '🎯 Click to Select';
    pick.dataset.map = map.armed ? 'cancel-pick' : 'pick';
    $('mapLastResult').textContent = map.lastResult ? `${map.lastResult.ok ? '' : '⚠ '}${map.lastResult.text} · ${ago(map.lastResult.at)}` : '';

    const sel = map.selected;
    $('mapSelectionCard').hidden = !sel;
    if (sel) {
      $('mapSelLabel').textContent = `${sel.kind} · ${sel.label}`;
      for (const gizmo of document.querySelectorAll('[data-gizmo]')) gizmo.classList.toggle('active', gizmo.dataset.gizmo === sel.mode);
      $('mapScaleBtn').disabled = !state.connected || sel.isCamera;
      $('nudgeRotScale').hidden = sel.isCamera;
      $('setRow').hidden = sel.isCamera;
      $('mapCameraStageBtn').hidden = !sel.isCamera;
      if (sel.isCamera) {
        $('mapSelReadout').textContent = `Position ${fmt3(sel.position)} · ${sel.targetNpcId ? `target relative to ${sel.targetNpcId}` : 'target'} ${fmt3(sel.target)}`;
        $('mapCameraStageBtn').textContent = `Player repositioning: ${sel.stagePlayer ? 'On' : 'Off'}`;
        $('mapCameraStageBtn').classList.toggle('active', sel.stagePlayer);
      } else {
        $('mapSelReadout').textContent = `Offset ${fmt3(sel.offset)} · yaw ${sel.yawDeg}° · scale ${fmt3(sel.scale)}${sel.dragging ? ' · dragging…' : ''}`;
        if (!document.activeElement?.closest?.('#setRow')) {
          $('setX').value = sel.offset.x; $('setY').value = sel.offset.y; $('setZ').value = sel.offset.z;
          $('setYaw').value = sel.yawDeg; $('setScale').value = sel.scale.x;
        }
      }
    }
    const cameras = map.cameras || [];
    $('mapCamerasCard').hidden = !cameras.length;
    $('mapCameraList').replaceChildren(...cameras.map(camera => button(camera.label, () => run('map', { action: 'select-camera', id: camera.id }), { active: camera.selected })));
    $('mapArenaCard').hidden = !map.arena;
  }

  // ── Files ───────────────────────────────────────────────────────────
  function renderOverrides() {
    const overrides = state.game.overrides;
    if (!changed('overrides', overrides)) return;
    if (!overrides) { $('overridesSummary').textContent = 'Local database overrides are unavailable.'; return; }
    $('dbSourceSelect').value = overrides.mode;
    const saved = overrides.databases.filter(db => db.hasOverride);
    const active = saved.filter(db => db.active);
    $('overridesSummary').textContent = overrides.mode === 'local'
      ? (active.length ? `Using local overrides for: ${active.map(db => db.label).join(', ')}. Everything else comes from the repo.` : 'Local mode, but no database has a saved override yet — everything comes from the repo.')
      : (saved.length ? `${saved.length} saved override(s) not in use: ${saved.map(db => db.label).join(', ')}.` : '');
    $('overridesSummary').hidden = !$('overridesSummary').textContent;
    $('overridesBody').replaceChildren(...overrides.databases.map(db => el('div', { class: 'row-sub' },
      el('span', { class: 'pill ' + (db.active ? 'fail' : 'na'), text: db.active ? 'LOCAL' : (db.hasOverride ? 'saved' : 'repo') }),
      ` ${db.label} · `, el('span', { class: 'mono', text: db.repoPath }), db.savedAt ? ` · saved ${when(db.savedAt)}` : '')));
  }

  function renderConfigs() {
    if (state.activeTab !== 'files') return;
    const filter = ($('configFilter').value || '').toLowerCase();
    const recentOnly = $('configRecent').checked;
    const now = Date.now();
    const entries = [...state.configs.values()]
      .filter(entry => (!filter || entry.path.toLowerCase().includes(filter)) && (!recentOnly || now - entry.lastAt < 60000))
      .sort((a, b) => b.lastAt - a.lastAt);
    $('configCount').textContent = `${entries.length}${entries.length !== state.configs.size ? ` of ${state.configs.size}` : ''}`;
    document.querySelector('#configTable tbody').replaceChildren(...entries.map(entry => el('tr', {
      class: [now - entry.lastAt < 4000 ? 'fresh' : '', entry.source === 'local-override' ? 'override' : ''].filter(Boolean).join(' ') || null,
      title: entry.note || `${entry.kind}${entry.durationMs != null ? ` · ${entry.durationMs}ms` : ''}`,
    },
      el('td', { text: `${entry.path.replace(/^config\//, '')}${entry.source === 'local-override' ? ' (local override)' : ''}` }),
      el('td', { text: String(entry.count) }),
      el('td', { text: ago(entry.lastAt) }),
      el('td', { class: entry.status === 'error' || Number(entry.status) >= 400 ? 'bad' : '', text: `${entry.status ?? ''}${entry.bytes ? ` · ${(entry.bytes / 1024).toFixed(0)}KB` : ''}` }))));
  }

  // Ages ("12s ago"), fresh highlighting and recent-only cards.
  setInterval(() => {
    renderConfigs();
    if (state.dialogue || state.ambient) { renderedSignatures.dialogue = ''; renderedSignatures.ambient = ''; renderNow(); }
  }, 5000);

  // ── Wiring ──────────────────────────────────────────────────────────
  for (const tabButton of document.querySelectorAll('#tabs [data-tab]')) tabButton.addEventListener('click', () => selectTab(tabButton.dataset.tab));
  $('quickSaveBtn').addEventListener('click', async () => {
    if (await run('quick-save', {}, { okText: 'Quick saved.' })) refreshQuickList();
  });
  $('quickLoadBtn').addEventListener('click', () => quickLoad(slotsForCurrentSave()[0]?.id || 'latest'));
  $('autosaveToggle').addEventListener('change', event => { run('autosave-set', { paused: event.target.checked }, { okText: event.target.checked ? 'Autosave paused for this game tab.' : 'Autosave resumed.' }); });
  $('manualSaveBtn').addEventListener('click', async () => { if (await run('manual-save', {}, { okText: 'Manual save written.' })) refreshRecovery(); });
  $('followContext').checked = prefs.followContext !== false;
  $('followContext').addEventListener('change', event => { prefs.followContext = event.target.checked; savePrefs(); });
  $('pauseOnLoad').checked = prefs.pauseOnLoad !== false;
  $('pauseOnLoad').addEventListener('change', event => { prefs.pauseOnLoad = event.target.checked; savePrefs(); });
  $('skipRestoreConfirm').checked = !!prefs.skipRestoreConfirm;
  $('skipRestoreConfirm').addEventListener('change', event => { prefs.skipRestoreConfirm = event.target.checked; savePrefs(); });
  $('configFilter').addEventListener('input', renderConfigs);
  $('configRecent').addEventListener('change', renderConfigs);
  $('historyCard').addEventListener('toggle', renderHistory);
  $('dbSourceSelect').addEventListener('change', event => run('db-source', { mode: event.target.value }, { okText: 'Applies on the next load — Quick Save then Quick Load keeps your spot.' }));
  $('mapSessionBtn').addEventListener('click', () => run('map', { action: 'session', open: !state.game.map?.sessionOpen }));

  document.addEventListener('click', async event => {
    const mapButton = event.target.closest('[data-map]');
    if (mapButton && !mapButton.disabled) {
      const action = mapButton.dataset.map;
      const result = await run('map', { action });
      if (result?.text) copyOrShow(action === 'diff' ? 'Map Edit diff' : 'Reflection debug', result.text);
      else if (result?.note) toast(result.note);
      return;
    }
    const gizmo = event.target.closest('[data-gizmo]');
    if (gizmo && !gizmo.disabled) { run('map', { action: 'gizmo-mode', mode: gizmo.dataset.gizmo }); return; }
    const nudge = event.target.closest('[data-nudge]');
    if (nudge && !nudge.disabled) {
      const [key, raw] = nudge.dataset.nudge.split(':');
      const step = Number($('nudgeStep').value) || 0.1;
      run('map', { action: 'nudge', [key]: ['dx', 'dy', 'dz'].includes(key) ? Number(raw) * step : Number(raw) });
    }
  });
  $('setApplyBtn').addEventListener('click', () => run('map', {
    action: 'nudge',
    set: { offset: { x: Number($('setX').value) || 0, y: Number($('setY').value) || 0, z: Number($('setZ').value) || 0 }, yawDeg: Number($('setYaw').value) || 0, scale: Number($('setScale').value) || 1 },
  }));

  document.addEventListener('keydown', event => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); $('quickSaveBtn').click(); }
    else if (key === 'l') { event.preventDefault(); if (!$('quickLoadBtn').disabled) $('quickLoadBtn').click(); }
  });

  // Boot
  setConnected(false, sessionId ? 'Connecting…' : 'No game session');
  const hashTab = location.hash.slice(1);
  selectTab(hashTab === 'live' ? 'now' : (hashTab || prefs.tab || 'now'));
  if (channel) post({ type: 'companion-hello' });
  window.__devCompanionDebug = { state, command, sessionId, prefs };
})();
