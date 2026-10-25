// Keyboard quality-of-life layer:
//  - Menu tab hotkeys: M Map (moved here from game.js), plus I Inventory,
//    K Crafting, J Tasks, N Calendar, P Progress, L Relations, O Loadout.
//    Pressing the hotkey of the tab that's already showing closes the menu.
//  - F1 or ? : Controls cheat sheet built from the live (rebindable) bindings.
//  - H : Message Log — the last toasts/location banners (js/toast-notifications.js).
//  - F2 : Save a screenshot of the 3D view as a PNG.
//
// game.js calls QolHotkeys.handleKey(event) from its own keydown handler, so
// everything that already gates gameplay keys (text-entry guard, fishing,
// map-editor gizmo) gates these too. A key the player has bound to a
// gameplay action in Settings → Input always wins over these defaults.
(() => {
  'use strict';

  const STORAGE_KEY = 'hobunji.qolHotkeys.v1';
  const MENU_HOTKEYS = [
    { code: 'KeyI', key: 'I', panel: 'inventory', label: 'Inventory' },
    { code: 'KeyK', key: 'K', panel: 'crafting', label: 'Crafting' },
    { code: 'KeyM', key: 'M', panel: 'map', label: 'Map' },
    { code: 'KeyN', key: 'N', panel: 'calendar', label: 'Calendar' },
    { code: 'KeyP', key: 'P', panel: 'progress', label: 'Progress' },
    { code: 'KeyJ', key: 'J', panel: 'tasks', label: 'Tasks' },
    { code: 'KeyL', key: 'L', panel: 'relationships', label: 'Relations' },
    { code: 'KeyO', key: 'O', panel: 'loadout', label: 'Loadout' },
  ];
  const LOG_CODE = 'KeyH';

  // Fixed (non-rebindable) desktop controls handled directly by game.js.
  const FIXED_CONTROLS = [
    ['W A S D / Arrows', 'Move'],
    ['Hold E', 'Tool wheel (tap E to interact)'],
    ['Hold Q', 'Item wheel'],
    ['X', 'Climb / cliff-dive the wall ahead, otherwise dodge'],
    ['Z', 'Put away held equipment'],
    ['Esc / Tab', 'Open or close the menu'],
    ['F1 / ?', 'This cheat sheet'],
    ['H', 'Message log'],
    ['F2', 'Save a screenshot (PNG)'],
  ];

  let deps = {};
  const prefs = { menuHotkeys: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object' && saved.menuHotkeys === false) prefs.menuHotkeys = false;
  } catch (_) {}

  function savePrefs() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (_) {}
  }

  function init(nextDeps) {
    deps = nextDeps || {};
    applyTabHints();
    bindSettingsUi();
    // Tab labels can be rewritten after startup (js/menu-tab-icon-only.js);
    // re-apply the hotkey hints whenever the menu opens.
    document.getElementById('menuBtn')?.addEventListener('click', applyTabHints);
  }

  function isMenuOpen() { return !!deps.isMenuOpen?.(); }
  function activePanel() {
    return document.querySelector('#menuPanel .mp-tab.active')?.dataset.mpanel || null;
  }
  function tabAvailable(panel) {
    const tab = document.querySelector(`#menuPanel .mp-tab[data-mpanel="${panel}"]`);
    return !!tab && tab.style.display !== 'none' && !tab.hidden;
  }
  function boundToGameplayAction(code) {
    try { return !!window.InputBindings?.resolveActionForButton?.('desktop', code); } catch (_) { return false; }
  }
  function rebindingInProgress() {
    return !!document.querySelector('#mpSettings .is-listening');
  }

  // ── Overlay (shared by the cheat sheet and the message log) ─────────────
  let overlay = null;
  let overlayKind = null;
  let unsubscribeLog = null;

  function ensureStyles() {
    if (document.getElementById('qolOverlayStyles')) return;
    const style = document.createElement('style');
    style.id = 'qolOverlayStyles';
    style.textContent = `
      #qolOverlay { position: fixed; inset: 0; z-index: 9500; display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,.45); padding: 16px; box-sizing: border-box; }
      #qolOverlay .qol-card { background: var(--glass, rgba(8,18,13,.92)); color: var(--text, #f0ffe6);
        border: 1px solid var(--border-bright, rgba(255,255,255,.22)); border-radius: var(--r, 14px);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        width: min(720px, 100%); max-height: min(80vh, 100%); display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
      #qolOverlay .qol-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border, rgba(255,255,255,.13)); }
      #qolOverlay .qol-head h2 { margin: 0; font-size: 15px; flex: 1; color: var(--accent, #f9e28a); }
      #qolOverlay .qol-head button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer;
        background: rgba(255,255,255,.08); color: var(--text, #f0ffe6); border: 1px solid var(--border-bright, rgba(255,255,255,.22)); }
      #qolOverlay .qol-body { overflow-y: auto; padding: 10px 16px 14px; font-size: 12px; }
      #qolOverlay .qol-section { margin: 10px 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted, #8aad8f); }
      #qolOverlay table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      #qolOverlay td:first-child, #qolOverlay th:first-child { width: 34%; }
      #qolOverlay table.qol-actions td:first-child, #qolOverlay table.qol-actions th:first-child { width: 40%; }
      #qolOverlay td, #qolOverlay th { padding: 3px 6px; text-align: left; vertical-align: top; }
      #qolOverlay th { color: var(--muted, #8aad8f); font-weight: 600; font-size: 11px; }
      #qolOverlay tr:nth-child(even) td { background: rgba(255,255,255,.03); }
      #qolOverlay kbd { display: inline-block; min-width: 1.4em; padding: 1px 6px; border-radius: 4px; font: 11px/1.5 ui-monospace, monospace;
        background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-bottom-width: 2px; white-space: nowrap; }
      #qolOverlay .qol-hint { color: var(--muted, #8aad8f); font-size: 11px; margin-top: 10px; }
      #qolOverlay .qol-log-row { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
      #qolOverlay .qol-log-time { color: var(--muted, #8aad8f); font: 11px ui-monospace, monospace; flex: none; padding-top: 1px; }
      #qolOverlay .qol-log-text { flex: 1; overflow-wrap: anywhere; }
      #qolOverlay .qol-log-row.fail .qol-log-text { color: var(--danger, #ff8060); }
      #qolOverlay .qol-log-row.zone .qol-log-text { color: var(--accent, #f9e28a); font-style: italic; }
      #qolOverlay .qol-log-count { color: var(--muted, #8aad8f); flex: none; }
      #qolOverlay .qol-empty { color: var(--muted, #8aad8f); padding: 18px 0; text-align: center; }
      #menuPanel .mp-tab[data-qol-hotkey] { position: relative; }
      #menuPanel .mp-tab[data-qol-hotkey]::after { content: attr(data-qol-hotkey); position: absolute; right: 2px; bottom: 1px;
        font: 600 8px/1 ui-monospace, monospace; opacity: .45; pointer-events: none; }
      body.qol-no-menu-hotkeys #menuPanel .mp-tab[data-qol-hotkey]::after { display: none; }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function kbd(text) {
    return String(text).split(' / ').map(part => `<kbd>${escapeHtml(part)}</kbd>`).join(' / ');
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    overlayKind = null;
    unsubscribeLog?.();
    unsubscribeLog = null;
  }

  function openOverlay(kind, title, bodyHtml, extraButtons = []) {
    ensureStyles();
    closeOverlay();
    overlay = document.createElement('div');
    overlay.id = 'qolOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', title);
    overlay.innerHTML = `<div class="qol-card"><div class="qol-head"><h2>${escapeHtml(title)}</h2>`
      + extraButtons.map(btn => `<button type="button" data-qol-btn="${escapeHtml(btn.id)}">${escapeHtml(btn.label)}</button>`).join('')
      + `<button type="button" data-qol-btn="close" aria-label="Close">✕</button></div><div class="qol-body">${bodyHtml}</div></div>`;
    overlay.addEventListener('click', event => {
      if (event.target === overlay) { closeOverlay(); return; }
      const id = event.target.closest?.('[data-qol-btn]')?.dataset.qolBtn;
      if (id === 'close') closeOverlay();
      else if (id) extraButtons.find(btn => btn.id === id)?.onClick?.();
    });
    document.body.appendChild(overlay);
    overlayKind = kind;
  }

  // ── Controls cheat sheet ────────────────────────────────────────────────
  function bindingRows() {
    const api = window.InputBindings;
    const bindings = api?.getCurrentBindings?.();
    if (!api || !bindings) return '';
    const rows = [];
    for (const action of api.getActionsForDevice?.('desktop') || []) {
      const desktop = bindings.desktop?.[action.id];
      const controller = bindings.controller?.[action.id];
      if (!desktop && !controller) continue;
      rows.push(`<tr><td>${escapeHtml(action.label || api.actionLabel?.(action.id) || action.id)}</td>`
        + `<td>${desktop ? `<kbd>${escapeHtml(api.buttonLabel(desktop))}</kbd>` : '—'}</td>`
        + `<td>${controller ? `<kbd>${escapeHtml(api.buttonLabel(controller))}</kbd>` : '—'}</td></tr>`);
    }
    return rows.join('');
  }

  function openCheatSheet() {
    const fixed = FIXED_CONTROLS.map(([keys, what]) => `<tr><td>${kbd(keys)}</td><td>${escapeHtml(what)}</td></tr>`).join('');
    const menu = MENU_HOTKEYS.filter(entry => tabAvailable(entry.panel))
      .map(entry => `<tr><td><kbd>${entry.key}</kbd></td><td>${escapeHtml(entry.label)}</td></tr>`).join('');
    const rebindable = bindingRows();
    const body = `
      <div class="qol-section">General</div><table>${fixed}</table>
      <div class="qol-section">Menu shortcuts${prefs.menuHotkeys ? '' : ' (turned off in Settings → Input)'}</div><table>${menu}</table>
      ${rebindable ? `<div class="qol-section">Actions (rebindable)</div><table class="qol-actions"><tr><th>Action</th><th>Keyboard / Mouse</th><th>Controller</th></tr>${rebindable}</table>` : ''}
      <div class="qol-hint">Rebind actions in Menu → Settings → Input. A shortcut letter you bind to an action there is given to that action.</div>`;
    openOverlay('help', 'Controls', body, [{ id: 'settings', label: 'Open Settings', onClick: () => { closeOverlay(); deps.openMenu?.('settings'); } }]);
  }

  // ── Message log ─────────────────────────────────────────────────────────
  function formatTime(ms) {
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  }
  function logBodyHtml() {
    const history = window.ToastNotifications?.getHistory?.() || [];
    if (!history.length) return '<div class="qol-empty">No messages yet.</div>';
    return history.slice().reverse().map(entry => `<div class="qol-log-row ${entry.kind === 'zone' ? 'zone' : entry.ok ? 'ok' : 'fail'}">`
      + `<span class="qol-log-time">${formatTime(entry.at)}</span><span class="qol-log-text">${escapeHtml(entry.text)}</span>`
      + `${entry.count > 1 ? `<span class="qol-log-count">×${entry.count}</span>` : ''}</div>`).join('');
  }
  function openMessageLog() {
    openOverlay('log', 'Message Log', logBodyHtml(), [{ id: 'clear', label: 'Clear', onClick: () => window.ToastNotifications?.clearHistory?.() }]);
    unsubscribeLog = window.ToastNotifications?.onHistoryChange?.(() => {
      const body = overlay?.querySelector('.qol-body');
      if (body) body.innerHTML = logBodyHtml();
    }) || null;
  }

  function toggle(kind) {
    if (overlayKind === kind) { closeOverlay(); return; }
    if (kind === 'help') openCheatSheet();
    else openMessageLog();
  }

  // ── Screenshot ──────────────────────────────────────────────────────────
  // The game renderer is created with preserveDrawingBuffer, so its canvas
  // can be read back at any time without hooking the render loop.
  function takeScreenshot() {
    const canvas = window.__hobunjiGameRenderer?.domElement;
    const toast = (msg, ok) => window.ToastNotifications?.showToast?.(msg, ok, true);
    if (!canvas?.toBlob) { toast('Screenshot unavailable', false); return false; }
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const name = `hobunji-hollow-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
    try {
      canvas.toBlob(blob => {
        if (!blob) { toast('Screenshot failed', false); return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast(`📸 Screenshot saved (${name})`, true);
      }, 'image/png');
    } catch (_) {
      toast('Screenshot failed', false);
      return false;
    }
    return true;
  }

  // ── Key handling ────────────────────────────────────────────────────────
  // Returns true when the event was consumed.
  function handleKey(event) {
    if (!event || event.ctrlKey || event.altKey || event.metaKey) return false;
    if (rebindingInProgress()) return false;
    if (event.code === 'F1' || (event.key === '?' && !boundToGameplayAction(event.code))) {
      event.preventDefault();
      if (!event.repeat) toggle('help');
      return true;
    }
    if (event.code === 'F2') {
      event.preventDefault();
      if (!event.repeat) takeScreenshot();
      return true;
    }
    if (deps.isBlocked?.()) return false;
    if (event.code === LOG_CODE && !event.shiftKey && !boundToGameplayAction(event.code)) {
      event.preventDefault();
      if (!event.repeat) toggle('log');
      return true;
    }
    if (event.shiftKey) return false;
    const entry = MENU_HOTKEYS.find(candidate => candidate.code === event.code);
    if (!entry || boundToGameplayAction(event.code)) return false;
    // M predates the other letters and stays on even with the toggle off.
    if (!prefs.menuHotkeys && entry.panel !== 'map') return false;
    if (!tabAvailable(entry.panel)) return false;
    event.preventDefault();
    if (event.repeat) return true;
    closeOverlay();
    if (isMenuOpen() && activePanel() === entry.panel) deps.closeMenu?.();
    else if (isMenuOpen()) deps.switchMenuPanel?.(entry.panel);
    else deps.openMenu?.(entry.panel);
    return true;
  }

  // Escape closes an open overlay before anything else (menu toggle, panel
  // unwinding) sees it.
  window.addEventListener('keydown', event => {
    if (!overlay || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeOverlay();
  }, true);

  // ── Hints & settings ────────────────────────────────────────────────────
  function applyTabHints() {
    ensureStyles();
    document.body.classList.toggle('qol-no-menu-hotkeys', !prefs.menuHotkeys);
    for (const entry of MENU_HOTKEYS) {
      const tab = document.querySelector(`#menuPanel .mp-tab[data-mpanel="${entry.panel}"]`);
      if (!tab) continue;
      if (tab.dataset.qolHotkey !== entry.key) tab.dataset.qolHotkey = entry.key;
      const suffix = ` (${entry.key})`;
      const base = (tab.title || tab.getAttribute('aria-label') || entry.label).replace(/ \([A-Z]\)$/, '');
      if (tab.title !== base + suffix) tab.title = base + suffix;
    }
  }

  function bindSettingsUi() {
    const toggleEl = document.getElementById('settingMenuHotkeys');
    if (toggleEl && !toggleEl.__qolBound) {
      toggleEl.__qolBound = true;
      toggleEl.checked = prefs.menuHotkeys;
      toggleEl.addEventListener('change', () => {
        prefs.menuHotkeys = toggleEl.checked;
        savePrefs();
        applyTabHints();
      });
    }
    const helpBtn = document.getElementById('settingOpenControlsHelp');
    if (helpBtn && !helpBtn.__qolBound) {
      helpBtn.__qolBound = true;
      helpBtn.addEventListener('click', () => openCheatSheet());
    }
    const logBtn = document.getElementById('settingOpenMessageLog');
    if (logBtn && !logBtn.__qolBound) {
      logBtn.__qolBound = true;
      logBtn.addEventListener('click', () => openMessageLog());
    }
  }

  window.QolHotkeys = {
    init, handleKey, applyTabHints,
    openCheatSheet, openMessageLog, closeOverlay, takeScreenshot,
    isOverlayOpen: () => !!overlay,
    MENU_HOTKEYS,
  };
})();
