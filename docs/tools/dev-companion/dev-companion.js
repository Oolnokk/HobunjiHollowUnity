// Dev Companion window — the second-window half of js/dev-companion-bridge.js.
// Tied to exactly one play session: the ?session= id picks the
// BroadcastChannel, so it only ever hears (and drives) the game tab that
// opened it, including across that tab's reloads (quick load, backup swaps).
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session') || '';
  const CHANNEL_PREFIX = 'hobunji-dev-companion-v1:';
  const PREFS_KEY = 'hobunjiDevCompanionPrefs.v1';
  const COMMAND_TIMEOUT_MS = 20000;
  const ALIVE_TIMEOUT_MS = 3500;

  const $ = id => document.getElementById(id);
  const state = {
    connected: false,
    lastAliveAt: 0,
    pageLoadId: '',
    game: {}, // latest state-provider snapshot
    configs: new Map(), // path → entry
    dialogue: null, // latest dialogue trace record
    history: [],
    quickSlots: [],
    recovery: null,
    pendingQuickLoad: false,
  };
  const pending = new Map(); // requestId → {resolve, reject, timer}
  const renderedSignatures = {};
  let requestSeq = 0;

  const prefs = (() => {
    try { return { pauseOnLoad: true, skipRestoreConfirm: false, tab: 'live', ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { pauseOnLoad: true, skipRestoreConfirm: false, tab: 'live' }; }
  })();
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) {} }

  // ── Transport ───────────────────────────────────────────────────────
  const channel = sessionId && typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_PREFIX + sessionId) : null;

  function post(message) {
    channel?.postMessage({ protocol: 1, session: sessionId, from: 'companion', sentAt: Date.now(), ...message });
  }

  function command(name, args = {}) {
    if (!channel) return Promise.reject(new Error('No game session.'));
    const requestId = `c${Date.now().toString(36)}${(++requestSeq).toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('The game did not answer (is it paused in a background tab or reloading?).'));
      }, COMMAND_TIMEOUT_MS);
      pending.set(requestId, { resolve, reject, timer });
      post({ type: 'command', requestId, name, args });
    });
  }

  async function run(name, args, { okText = '', quiet = false } = {}) {
    try {
      const result = await command(name, args);
      if (result?.ok === false || result?.error) throw new Error(result?.error || 'Failed.');
      if (okText) toast(okText);
      return result;
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
        state.game = message.state || {};
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
        for (const record of message.latest || []) if (record.channel === 'dialogue') state.dialogue = record;
        renderDialogue(); renderHistory();
        break;
      case 'focus-tab':
        if (message.tab) selectTab(message.tab);
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
    const changed = connected !== state.connected;
    state.connected = connected;
    const dot = $('connDot');
    dot.className = 'dot' + (connected ? ' on' : '');
    $('connText').textContent = connected ? 'Connected to play session' : (text || (sessionId ? 'Game session not responding' : 'No session id'));
    if (!changed && dot.dataset.init) return;
    dot.dataset.init = '1';
    for (const button of document.querySelectorAll('#header button, #panes button')) {
      if (button.id === 'historyClearBtn') continue;
      button.disabled = !connected;
    }
    $('autosaveToggle').disabled = !connected;
    if (connected) render(true);
  }

  setInterval(() => {
    if (!channel) return;
    post({ type: 'companion-heartbeat' });
    // A busy game (zone generation, software WebGL) can miss heartbeats for a
    // while; commands still queue on the channel, so only mark it as busy.
    const stale = state.connected && Date.now() - state.lastAliveAt > ALIVE_TIMEOUT_MS;
    const dot = $('connDot');
    if (stale && !dot.classList.contains('stale')) {
      dot.classList.add('stale');
      $('connText').textContent = 'Game busy / not responding…';
    } else if (!stale && state.connected && dot.classList.contains('stale')) {
      dot.classList.remove('stale');
      $('connText').textContent = 'Connected to play session';
    }
  }, 1000);
  window.addEventListener('pagehide', () => post({ type: 'companion-bye' }));

  // ── UI helpers ──────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(text, error = false) {
    const el = $('toast');
    el.textContent = text;
    el.className = 'toast' + (error ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, error ? 6000 : 2600);
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

  function selectTab(tab) {
    const exists = document.querySelector(`#tabs [data-tab="${CSS.escape(tab)}"]`);
    if (!exists) return;
    prefs.tab = tab; savePrefs();
    for (const button of document.querySelectorAll('#tabs [data-tab]')) button.classList.toggle('active', button.dataset.tab === tab);
    for (const pane of document.querySelectorAll('.pane')) pane.classList.toggle('active', pane.dataset.pane === tab);
    if (tab === 'saves') { refreshQuickList(); refreshRecovery(); }
  }

  // ── Rendering ───────────────────────────────────────────────────────
  function render(force = false) {
    if (force) for (const key of Object.keys(renderedSignatures)) delete renderedSignatures[key];
    renderHeader();
    renderSaveStatus();
    renderMap();
    renderMapInUse();
    renderOverrides();
  }

  function renderHeader() {
    const session = state.game.session;
    const saves = state.game.saves;
    $('sessionId').textContent = sessionId ? `session ${sessionId}` : '';
    if (changed('header', { session, autosave: saves?.autosave?.paused })) {
      if (!session?.started) {
        $('sessionLine').textContent = session ? 'Game is at the save-select / loading screen.' : ($('sessionLine').textContent);
      } else {
        const exact = session.exact || {};
        const ctx = session.context || {};
        $('sessionLine').textContent = `${session.characterName || 'Farmer'} · ${session.worldLabel || 'World'} — ${exact.areaLabel || exact.area || '?'} (tile ${exact.col},${exact.row}) · ${exact.calendar?.label || ''}${ctx.weekday ? ` ${ctx.weekday}` : ''}${ctx.season ? `, ${ctx.season}` : ''}${ctx.dialogueOpen ? ` · talking to ${ctx.dialogueNpc}` : ''}`;
      }
      const paused = !!saves?.autosave?.paused;
      $('autosaveToggle').checked = paused;
      document.title = `${paused ? '⏸ ' : ''}Dev Companion${session?.characterName ? ` — ${session.characterName}` : ''}`;
      $('quickSaveBtn').disabled = !state.connected || !session?.started;
    }
  }

  function renderSaveStatus() {
    const saves = state.game.saves;
    if (!changed('saveStatus', saves)) return;
    if (!saves) { $('saveStatus').textContent = '—'; return; }
    const a = saves.autosave || {};
    const lines = [
      `Autosave: ${a.paused ? `PAUSED since ${when(a.since)} (${a.reason})` : 'running'} · automatic writes skipped this page load: ${a.blockedCount || 0}${a.lastBlocked ? ` (last: ${a.lastBlocked.source})` : ''}`,
      saves.folder ? `Primary folder: ${saves.folder.folderName || '—'} · ${saves.folder.state}${saves.folder.autoSyncArmed ? ' · autosync armed' : ' · autosync not armed'} · last: ${saves.folder.lastAction || '—'} ${saves.folder.lastSyncedAt ? `@ ${when(saves.folder.lastSyncedAt)}` : ''}${saves.folder.lastError ? `\n  ⚠ ${saves.folder.lastError}` : ''}` : 'Primary folder: not connected (browser save only)',
      saves.checkpoint ? `Recovery checkpoints: ${saves.checkpoint.lastAction}${saves.checkpoint.lastError ? ` ⚠ ${saves.checkpoint.lastError}` : ''}` : '',
      saves.quick ? `Quick save: ${saves.quick.lastAction}${saves.quick.lastError ? ` ⚠ ${saves.quick.lastError}` : ''}${saves.quick.lastResume ? ` · last resume: ${saves.quick.lastResume.ok ? 'ok' : 'FAILED'} ${saves.quick.lastResume.area || ''} ${saves.quick.lastResume.error || ''}` : ''}` : '',
    ].filter(Boolean);
    $('saveStatus').textContent = lines.join('\n');
    $('saveStatus').style.whiteSpace = 'pre-wrap';
  }

  function renderQuickList() {
    const list = $('quickList');
    list.replaceChildren();
    if (!state.quickSlots.length) { list.append(el('div', { class: 'muted small-text', text: 'No quick saves yet.' })); return; }
    const session = state.game.session;
    for (const slot of state.quickSlots) {
      const otherSave = session?.characterId && (slot.characterId !== session.characterId || slot.worldId !== session.worldId);
      const load = el('button', { type: 'button', class: 'small', text: 'Load', disabled: !state.connected, onclick: () => quickLoad(slot.id) });
      const renameBtn = el('button', { type: 'button', class: 'small', text: 'Rename', disabled: !state.connected, onclick: async () => {
        const label = prompt('Quick save name:', slot.label);
        if (label == null) return;
        if (await run('quick-rename', { id: slot.id, label })) refreshQuickList();
      } });
      const del = el('button', { type: 'button', class: 'small danger', text: '✕', title: 'Delete', disabled: !state.connected, onclick: async () => {
        if (!confirm(`Delete quick save “${slot.label}”?`)) return;
        if (await run('quick-delete', { id: slot.id })) refreshQuickList();
      } });
      list.append(el('div', { class: 'row' },
        el('div', { class: 'row-head' }, el('span', { class: 'row-title', text: slot.label }), el('span', { class: 'spacer' }), load, renameBtn, del),
        el('div', { class: 'row-sub', text: `${when(slot.savedAt)} · ${slot.exact?.areaLabel || '?'} (${Math.round(slot.exact?.x ?? 0)}, ${Math.round(slot.exact?.y ?? 0)})${slot.context?.dialogueOpen ? ` · mid-dialogue with ${slot.context.dialogueNpc}` : ''} · ${slot.characterName || slot.characterId} / ${slot.worldLabel || slot.worldId}${slot.bytes ? ` · ${(slot.bytes / 1024).toFixed(0)} KB` : ''}` }),
        otherSave ? el('div', { class: 'row-sub warn', text: 'Different farmer/world than the one currently loaded — loading switches to it.' }) : null,
      ));
    }
  }

  async function refreshQuickList() {
    const result = await run('quick-list', {}, { quiet: true });
    if (result) { state.quickSlots = result.slots || []; renderQuickList(); }
  }

  async function quickLoad(id = 'latest') {
    if (state.pendingQuickLoad) return;
    state.pendingQuickLoad = true;
    try {
      const result = await run('quick-load', { id, pauseAutosave: prefs.pauseOnLoad });
      if (result) toast(`Loading “${result.slot?.label || 'quick save'}”…`);
    } finally {
      setTimeout(() => { state.pendingQuickLoad = false; }, 1500);
    }
  }

  async function refreshRecovery() {
    $('recoveryWarnings').textContent = 'Reading recovery history…';
    const result = await run('recovery-list', {}, { quiet: true });
    state.recovery = result;
    renderRecovery();
  }

  function renderRecovery() {
    const list = $('recoveryList');
    list.replaceChildren();
    const recovery = state.recovery;
    $('recoveryWarnings').textContent = recovery ? (recovery.warnings || []).join(' | ') : 'Could not read recovery history.';
    if (!recovery) return;
    for (const choice of recovery.choices || []) {
      if (choice.current && !choice.available) continue;
      const button = el('button', {
        type: 'button', class: 'small', text: choice.current ? 'Current' : 'Restore',
        disabled: !state.connected || choice.current || !choice.available,
        onclick: async () => {
          if (!prefs.skipRestoreConfirm && !confirm(`Swap to “${choice.title}” (${when(choice.savedAt)})? The current save is kept as “Before Last Restore”, and the game reloads straight back into this farmer/world.`)) return;
          button.disabled = true; button.textContent = 'Restoring…';
          const result = await run('recovery-restore', { slot: choice.slot, autoPlay: true });
          if (result) toast(`Restored ${choice.title} — reloading…`);
          else { button.disabled = false; button.textContent = 'Restore'; }
        },
      });
      list.append(el('div', { class: 'row' },
        el('div', { class: 'row-head' }, el('span', { class: 'row-title', text: choice.title }), el('span', { class: 'spacer' }), button),
        el('div', { class: 'row-sub', text: choice.detail }),
        el('div', { class: 'row-sub', text: choice.note }),
      ));
    }
  }

  // Map Edit
  function renderMap() {
    const map = state.game.map;
    if (!changed('map', map)) return;
    const summary = $('mapSummary');
    const warn = $('mapWarn');
    if (!map?.available) {
      summary.textContent = 'Map Edit is not initialized yet (the game is still loading).';
      $('mapSelectionCard').hidden = true; $('mapCamerasCard').hidden = true; $('mapArenaCard').hidden = true;
      return;
    }
    summary.replaceChildren(
      el('dl', { class: 'kv' },
        el('dt', { text: 'Runtime map' }), el('dd', { text: map.editable ? `${map.name} (${map.mapId})` : (map.reason || 'No editable map') }),
        el('dt', { text: 'Layout' }), el('dd', { text: map.layoutId || 'Base' }),
        el('dt', { text: 'Map Editor' }), el('dd', { class: map.editorConnected ? 'ok' : 'muted', text: map.editorConnected ? '● connected' : '○ not connected' }),
        el('dt', { text: 'Session' }), el('dd', { text: map.sessionOpen ? (map.armed ? 'open · picker armed — click in the game window' : 'open') : 'closed' }),
        el('dt', { text: 'Runtime-only edits' }), el('dd', { text: String(map.runtimeOnlyTransforms || 0) }),
      ));
    warn.textContent = [!map.devMode ? 'Dev Mode is off in the game — Map Edit normally needs it.' : '', map.generated ? 'LIVE GENERATED INSTANCE — changes are session previews and may be replaced by a Tothal Shift.' : ''].filter(Boolean).join(' ');
    $('mapSessionBtn').textContent = map.sessionOpen ? 'End session' : 'Start session';
    $('mapPickBtn').textContent = map.armed ? 'Cancel pick' : '🎯 Click to Select';
    $('mapPickBtn').dataset.map = map.armed ? 'cancel-pick' : 'pick';
    $('mapPickBtn').disabled = !state.connected || !map.editable;
    $('mapLastResult').textContent = map.lastResult ? `${map.lastResult.ok ? '' : '⚠ '}${map.lastResult.text} (${ago(map.lastResult.at)})` : 'No live reflection yet.';
    $('mapLastResult').className = 'small-text ' + (map.lastResult && !map.lastResult.ok ? 'warn' : 'muted');

    const sel = map.selected;
    $('mapSelectionCard').hidden = !sel;
    if (sel) {
      $('mapSelLabel').textContent = `${sel.kind} · ${sel.label}`;
      for (const button of document.querySelectorAll('[data-gizmo]')) button.classList.toggle('active', button.dataset.gizmo === sel.mode);
      $('mapScaleBtn').disabled = !state.connected || sel.isCamera;
      $('nudgeRotScale').hidden = sel.isCamera;
      $('setRow').hidden = sel.isCamera;
      $('mapCameraStageBtn').hidden = !sel.isCamera;
      if (sel.isCamera) {
        $('mapSelReadout').textContent = `Position ${fmt3(sel.position)} • ${sel.targetNpcId ? `Target (relative to ${sel.targetNpcId})` : 'Target'} ${fmt3(sel.target)}`;
        $('mapCameraStageBtn').textContent = `Player repositioning: ${sel.stagePlayer ? 'On' : 'Off'}`;
        $('mapCameraStageBtn').classList.toggle('active', sel.stagePlayer);
      } else {
        $('mapSelReadout').textContent = `Offset ${fmt3(sel.offset)} • Yaw ${sel.yawDeg}° • Scale ${fmt3(sel.scale)}${sel.dragging ? ' • dragging…' : ''}`;
        if (!document.activeElement?.closest?.('#setRow')) {
          $('setX').value = sel.offset.x; $('setY').value = sel.offset.y; $('setZ').value = sel.offset.z;
          $('setYaw').value = sel.yawDeg; $('setScale').value = sel.scale.x;
        }
      }
    }
    const cameras = map.cameras || [];
    $('mapCamerasCard').hidden = !cameras.length;
    $('mapCameraList').replaceChildren(...cameras.map(camera => el('button', {
      type: 'button', class: 'small' + (camera.selected ? ' active' : ''), text: camera.label, disabled: !state.connected,
      onclick: () => run('map', { action: 'select-camera', id: camera.id }),
    })));
    $('mapArenaCard').hidden = !map.arena;
  }

  function fmt3(p) {
    if (!p) return '—';
    return [p.x, p.y, p.z].map(v => Number(v ?? 0).toFixed(2)).join(', ');
  }

  // Live config
  function renderMapInUse() {
    const map = state.game.map;
    const session = state.game.session;
    const key = { mapId: map?.mapId, name: map?.name, layout: map?.layoutId, generated: map?.generated, area: session?.exact?.area, n: state.configs.size };
    if (!changed('mapInUse', key)) return;
    const box = $('mapInUse');
    if (!map?.available && !session?.exact) { box.textContent = '—'; return; }
    const mapId = map?.mapId || session?.exact?.area;
    const guessPaths = !mapId || map?.generated ? [] : [`config/maps/${mapId}.json`, ...(mapId === 'map_hobunji_town' || !state.configs.has(`config/maps/${mapId}.json`) ? ['config/town-workspace-v1.json'] : [])];
    const loaded = guessPaths.filter(path => state.configs.has(path));
    box.replaceChildren(el('dl', { class: 'kv' },
      el('dt', { text: 'Area' }), el('dd', { text: `${session?.exact?.areaLabel || session?.exact?.area || '?'}${map?.mapId ? ` (${map.mapId})` : ''}` }),
      el('dt', { text: 'Layout' }), el('dd', { text: map?.layoutId || 'Base' }),
      el('dt', { text: 'Kind' }), el('dd', { text: map?.generated ? 'Procedurally generated (Tothal Shift) — no single JSON source' : (map?.editable ? 'Authored map' : (map?.reason || '—')) }),
      el('dt', { text: 'Source file(s)' }), el('dd', { class: 'mono', text: loaded.length ? loaded.join(', ') : (map?.generated ? '—' : 'not fetched this session (built in or from the town workspace)') }),
    ));
  }

  function renderOverrides() {
    const overrides = state.game.overrides;
    if (!changed('overrides', overrides)) return;
    const box = $('overridesBody');
    if (!overrides) { box.textContent = 'Local database overrides are unavailable.'; return; }
    $('dbSourceSelect').value = overrides.mode;
    box.replaceChildren(...overrides.databases.map(db => el('div', { class: 'row-sub' },
      el('span', { class: 'pill ' + (db.active ? 'fail' : 'na'), text: db.active ? 'LOCAL' : (db.hasOverride ? 'saved, unused' : 'repo') }),
      ` ${db.label} — `, el('span', { class: 'mono', text: db.repoPath }),
      db.savedAt ? ` (override saved ${when(db.savedAt)})` : '',
    )));
  }

  function renderConfigs() {
    const tbody = document.querySelector('#configTable tbody');
    const filter = ($('configFilter').value || '').toLowerCase();
    const entries = [...state.configs.values()].sort((a, b) => b.lastAt - a.lastAt);
    $('configCount').textContent = `${entries.length} file(s)`;
    const now = Date.now();
    tbody.replaceChildren(...entries.filter(entry => !filter || entry.path.toLowerCase().includes(filter)).map(entry => el('tr', {
      class: [now - entry.lastAt < 4000 ? 'fresh' : '', entry.source === 'local-override' ? 'override' : ''].filter(Boolean).join(' ') || null,
      title: entry.note || null,
    },
      el('td', { text: entry.path }),
      el('td', { text: entry.source === 'local-override' ? 'override' : entry.kind }),
      el('td', { text: String(entry.count) }),
      el('td', { text: ago(entry.lastAt) }),
      el('td', { class: entry.status === 'error' || Number(entry.status) >= 400 ? 'bad' : '', text: `${entry.status ?? ''}${entry.bytes ? ` · ${(entry.bytes / 1024).toFixed(0)}KB` : ''}` }),
    )));
  }
  setInterval(() => { if (document.querySelector('[data-pane="live"].active')) renderConfigs(); }, 2000); // Keeps "ago"/fresh highlighting current.

  function acceptTrace(record) {
    if (!record) return;
    state.history.push(record);
    if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
    if (record.channel === 'dialogue') { state.dialogue = record; renderDialogue(); }
    renderHistory();
  }

  function checkPill(check) {
    const values = Array.isArray(check.values) ? check.values.join(' | ') : `${check.values?.min ?? '−∞'}..${check.values?.max ?? '∞'}`;
    const current = check.current == null || check.current === '' ? '—' : (typeof check.current === 'number' ? Number(check.current).toFixed(2) : check.current);
    const cls = !check.applicable ? 'na' : (check.pass ? 'pass' : 'fail');
    const verb = check.kind === 'exclude' ? 'not' : 'is';
    return el('span', { class: 'pill ' + cls, title: check.applicable ? '' : 'Not applicable to this caller — never disqualifies' }, `${check.pass ? '✓' : '✗'} ${check.axis} ${verb} ${values} (now: ${current})`);
  }

  function candidateBlock(candidate) {
    return el('div', { class: 'candidate' + (candidate.picked ? ' picked' : '') + (candidate.eligible ? '' : ' ineligible') },
      el('div', {}, candidate.picked ? '▶ ' : '', el('strong', { text: candidate.id }), candidate.name ? ` — ${candidate.name}` : '',
        el('span', { class: 'muted', text: ` · ${candidate.eligible ? 'eligible' : 'blocked'} · specificity ${candidate.specificity} · priority ${candidate.priority}${candidate.heard ? ' · heard before' : ''}` })),
      candidate.checks?.length ? el('div', {}, ...candidate.checks.map(checkPill)) : el('div', { class: 'muted', text: 'No conditions (always eligible).' }),
    );
  }

  function worldBlock(world) {
    if (!world) return null;
    return el('div', { class: 'row-sub' }, 'World state checked: ', ...Object.entries(world).map(([key, value]) => el('span', { class: 'pill na', text: `${key}: ${value === '' || value == null ? '—' : (typeof value === 'number' ? Number(value).toFixed(2) : value)}` })));
  }

  function renderDialogue() {
    const record = state.dialogue;
    const body = $('dialogueBody');
    $('dialogueAge').textContent = record ? ago(record.at) : '';
    if (!record?.payload) return;
    const d = record.payload;
    if (d.event === 'closed') {
      body.replaceChildren(el('div', { class: 'muted', text: `Conversation with ${d.npc?.name || 'NPC'} ended${d.tree ? ` (tree ${d.tree.id})` : ''}.` }));
      return;
    }
    const sel = d.selection;
    const node = d.node;
    const children = [
      el('dl', { class: 'kv' },
        el('dt', { text: 'NPC' }), el('dd', { text: d.npc ? `${d.npc.name} (${d.npc.id})` : '—' }),
        el('dt', { text: 'Config' }), el('dd', { class: 'mono', text: d.source || '—' }),
        el('dt', { text: 'Tree' }), el('dd', { text: d.tree ? `${d.tree.id}${d.tree.name ? ` — ${d.tree.name}` : ''} · entry ${d.tree.entryNode} · ${d.tree.nodeCount} nodes · trigger ${d.tree.trigger} · visibility ${d.tree.visibility}` : (sel?.mode === 'synthetic' ? 'synthetic (runtime-built)' : 'none') }),
        el('dt', { text: 'Node' }), el('dd', { text: node ? `${node.id || '(inline)'} · ${node.type}${node.next ? ` → ${node.next}` : ''}${node.cameraId ? ` · camera ${node.cameraId}` : ''}` : '—' }),
        d.sequenceStack?.length ? el('dt', { text: 'Sequence' }) : null,
        d.sequenceStack?.length ? el('dd', { text: d.sequenceStack.map(frame => `${frame.seqNodeId} (${frame.depthRemaining} left)`).join(' › ') }) : null,
      ),
    ];
    if (node?.resolvedText || node?.text) children.push(el('div', { class: 'quote', text: node.resolvedText || node.text }));
    if (node?.resolvedText && node.text && node.resolvedText !== node.text) children.push(el('div', { class: 'row-sub mono', text: `Authored: ${node.text}` }));
    if (d.fallbackLines) children.push(el('div', { class: 'row-sub', text: d.note }), el('div', { class: 'quote', text: d.fallbackLines.join('\n') }));
    if (node?.choices?.length) {
      children.push(el('div', { class: 'row-sub' }, 'Choices: ', ...node.choices.map(choice => el('span', { class: 'pill na', text: `${choice.label}${choice.next ? ` → ${choice.next}` : ''}${choice.actions.length ? ` [${choice.actions.join(', ')}]` : ''}${choice.disabled ? ' (disabled)' : ''}` }))));
    }
    if (sel) {
      children.push(el('div', { class: 'card-title', style: 'margin-top:10px', text: 'Why this tree' }));
      children.push(el('div', { class: 'row-sub', text: `${sel.mode === 'conditions' ? 'Condition match' : sel.mode === 'provider' ? 'Feature tree provider' : 'Synthetic'}: ${sel.reason}` }));
      children.push(worldBlock(sel.world));
      const picked = (sel.candidates || []).filter(c => c.picked);
      const others = (sel.candidates || []).filter(c => !c.picked);
      children.push(...picked.map(candidateBlock));
      if (others.length) children.push(el('details', {}, el('summary', { text: `${others.length} other tree(s) — ${others.filter(c => c.eligible).length} eligible` }), ...others.map(candidateBlock)));
    }
    for (const pool of d.pools || []) {
      children.push(el('details', {}, el('summary', { text: `Phrase pool “${pool.poolName}” → ${pool.pickedId || 'nothing'}` }),
        el('div', { class: 'row-sub', text: pool.reason }), worldBlock(pool.world), ...(pool.candidates || []).map(candidateBlock)));
    }
    if (node?.raw) children.push(el('details', {}, el('summary', { text: 'Raw node JSON' }), el('pre', { class: 'raw', text: JSON.stringify(node.raw, null, 2) })));
    body.replaceChildren(...children);
    body.classList.remove('muted');
  }
  setInterval(() => { if (state.dialogue) $('dialogueAge').textContent = ago(state.dialogue.at); }, 5000);

  function renderHistory() {
    const list = $('historyList');
    if (!document.querySelector('[data-pane="history"].active')) return;
    list.replaceChildren(...state.history.slice().reverse().slice(0, 150).map(record => {
      const d = record.payload || {};
      const summary = record.channel === 'dialogue'
        ? `${d.event}${d.npc ? ` · ${d.npc.name}` : ''}${d.tree ? ` · ${d.tree.id}` : ''}${d.node ? ` · ${d.node.id || d.node.type}` : ''}`
        : JSON.stringify(d).slice(0, 120);
      return el('div', { class: 'row' },
        el('div', { class: 'row-head' }, el('span', { class: 'pill na', text: record.channel }), el('span', { class: 'row-title', text: summary }), el('span', { class: 'spacer' }), el('span', { class: 'muted small-text', text: new Date(record.at).toLocaleTimeString() })),
        el('details', {}, el('summary', { text: 'Payload' }), el('pre', { class: 'raw', text: JSON.stringify(d, null, 2) })),
      );
    }));
  }

  // ── Wiring ──────────────────────────────────────────────────────────
  for (const button of document.querySelectorAll('#tabs [data-tab]')) button.addEventListener('click', () => { selectTab(button.dataset.tab); renderHistory(); });
  $('quickSaveBtn').addEventListener('click', async () => {
    const result = await run('quick-save', {}, { okText: 'Quick saved.' });
    if (result) refreshQuickList();
  });
  $('quickLoadBtn').addEventListener('click', () => quickLoad('latest'));
  $('autosaveToggle').addEventListener('change', event => { run('autosave-set', { paused: event.target.checked }, { okText: event.target.checked ? 'Autosave paused for this game tab.' : 'Autosave resumed.' }); });
  $('quickRefreshBtn').addEventListener('click', refreshQuickList);
  $('recoveryRefreshBtn').addEventListener('click', refreshRecovery);
  $('manualSaveBtn').addEventListener('click', async () => { if (await run('manual-save', {}, { okText: 'Manual save written.' })) refreshRecovery(); });
  $('pauseOnLoad').checked = prefs.pauseOnLoad !== false;
  $('pauseOnLoad').addEventListener('change', event => { prefs.pauseOnLoad = event.target.checked; savePrefs(); });
  $('skipRestoreConfirm').checked = !!prefs.skipRestoreConfirm;
  $('skipRestoreConfirm').addEventListener('change', event => { prefs.skipRestoreConfirm = event.target.checked; savePrefs(); });
  $('configFilter').addEventListener('input', renderConfigs);
  $('dbSourceSelect').addEventListener('change', event => run('db-source', { mode: event.target.value }, { okText: 'Database source set — applies on next load (quick save + quick load keeps your spot).' }));
  $('historyClearBtn').addEventListener('click', () => { state.history = []; renderHistory(); });
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
      const amount = key === 'dx' || key === 'dy' || key === 'dz' ? Number(raw) * step : Number(raw);
      run('map', { action: 'nudge', [key]: amount });
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
    else if (key === 'l') { event.preventDefault(); quickLoad('latest'); }
  });

  // Boot
  setConnected(false, sessionId ? 'Connecting…' : 'Open this window from the game (Settings → Dev Companion Window).');
  selectTab(location.hash.slice(1) || prefs.tab || 'live');
  if (channel) post({ type: 'companion-hello' });
  window.__devCompanionDebug = { state, command, sessionId };
})();
