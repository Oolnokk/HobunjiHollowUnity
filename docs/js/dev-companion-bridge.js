// Dev Companion bridge — the game-side half of the Dev Companion window
// (docs/tools/dev-companion/). The companion is a second browser window that
// runs alongside ONE play session: it is opened from that session (Settings →
// Dev Companion Window, or window.DevCompanion.open()) and talks to it over a
// BroadcastChannel whose name carries this tab's session id. The id lives in
// sessionStorage, so it survives the game tab reloading (quick load, recovery
// restores) and the companion reconnects to the same session afterward, while
// a second game tab gets its own id and never crosses wires with it.
//
// This file owns only transport + registries; features plug in themselves:
//   DevCompanion.registerCommand(name, fn)        companion → game actions
//   DevCompanion.registerStateProvider(key, fn)   polled (2 Hz, only while a
//                                                 companion is connected)
//   DevCompanion.trace(channel, payload)          event-style diagnostics,
//                                                 e.g. the dialogue node on
//                                                 screen and why it was chosen
// It also keeps the "configuration / JSON accessed" log by wrapping fetch()
// (loaded before every other module so their config fetches pass through it)
// and watching resource timing for config/*.js scripts.
(() => {
  'use strict';

  if (window.DevCompanion) return;

  const SESSION_KEY = 'hobunjiDevCompanionSession.v1';
  const CHANNEL_PREFIX = 'hobunji-dev-companion-v1:';
  const COMPANION_PATH = 'tools/dev-companion/index.html';
  const HEARTBEAT_TIMEOUT_MS = 4000; // Companion heartbeats every 1s; missing four in a row counts as closed.
  const STATE_INTERVAL_MS = 500;
  const TRACE_HISTORY = 120;
  const CONFIG_LOG_LIMIT = 600;

  function makeId() {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  const sessionId = (() => {
    try {
      const existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      const id = makeId();
      sessionStorage.setItem(SESSION_KEY, id);
      return id;
    } catch { return makeId(); }
  })();
  const pageLoadId = makeId(); // Distinguishes "the game reloaded" from "the same page said hello again".
  const bootedAt = Date.now();

  const commands = new Map(); // name → fn(args) (sync or async)
  const stateProviders = new Map(); // key → fn() returning a structured-cloneable object
  const traceLatest = new Map(); // channel → {channel, at, payload}
  const traceHistory = []; // newest last
  const configLog = new Map(); // path → entry
  const configListeners = new Set();
  let configSeq = 0;
  let lastHeartbeatAt = 0;
  let stateTimer = null;
  let channel = null;

  function clone(value) {
    if (value === undefined) return null;
    try { return JSON.parse(JSON.stringify(value)); } catch { return { unserializable: String(value) }; }
  }

  function send(message) {
    if (!channel) return;
    try { channel.postMessage({ protocol: 1, session: sessionId, pageLoadId, sentAt: Date.now(), ...message }); } catch (error) {
      try { channel.postMessage({ protocol: 1, session: sessionId, pageLoadId, sentAt: Date.now(), ...clone(message) }); } catch (_) {}
    }
  }

  function isConnected() {
    return lastHeartbeatAt > 0 && Date.now() - lastHeartbeatAt < HEARTBEAT_TIMEOUT_MS;
  }

  // ── Config / JSON access log ────────────────────────────────────────
  function docsRelativePath(rawUrl) {
    let url;
    try { url = new URL(String(rawUrl), location.href); } catch { return String(rawUrl || ''); }
    if (url.origin !== location.origin) return url.href.split('?')[0];
    const docsBase = new URL('./', location.href).pathname; // Game page lives in docs/, tools resolve '../../' back to it.
    let path = url.pathname;
    if (path.startsWith(docsBase)) path = path.slice(docsBase.length);
    try { path = decodeURIComponent(path); } catch (_) {}
    return path.replace(/^\/+/, '');
  }

  function isConfigPath(path) {
    return /\.json$/i.test(path) || /(^|\/)config\//.test(path);
  }

  function noteConfigAccess(rawUrl, info = {}) {
    const path = docsRelativePath(rawUrl);
    if (!path || !isConfigPath(path)) return null;
    const now = Date.now();
    let entry = configLog.get(path);
    if (!entry) {
      if (configLog.size >= CONFIG_LOG_LIMIT) {
        const oldest = [...configLog.values()].sort((a, b) => a.lastAt - b.lastAt)[0];
        if (oldest) configLog.delete(oldest.path);
      }
      entry = { path, kind: info.kind || 'fetch', count: 0, firstAt: now, lastAt: now, status: null, bytes: null, durationMs: null, source: 'repo', note: '' };
      configLog.set(path, entry);
    }
    entry.count++;
    entry.lastAt = now;
    entry.seq = ++configSeq;
    for (const key of ['kind', 'status', 'bytes', 'durationMs', 'source', 'note']) {
      if (info[key] != null) entry[key] = info[key];
    }
    for (const listener of configListeners) { try { listener(entry); } catch (_) {} }
    if (isConnected()) send({ type: 'config-access', entries: [clone(entry)] });
    return entry;
  }

  if (typeof window.fetch === 'function' && !window.fetch.__hobunjiDevCompanion) {
    const nativeFetch = window.fetch.bind(window);
    const trackedFetch = function devCompanionTrackedFetch(input, init) {
      const url = typeof input === 'string' ? input : (input?.url || String(input));
      const started = performance.now();
      const promise = nativeFetch(input, init);
      const path = docsRelativePath(url);
      if (!isConfigPath(path)) return promise;
      return promise.then(response => {
        const length = Number(response.headers?.get?.('content-length'));
        noteConfigAccess(url, { kind: 'fetch', status: response.status, bytes: Number.isFinite(length) && length > 0 ? length : null, durationMs: Math.round(performance.now() - started) });
        return response;
      }, error => {
        noteConfigAccess(url, { kind: 'fetch', status: 'error', note: String(error?.message || error), durationMs: Math.round(performance.now() - started) });
        throw error;
      });
    };
    trackedFetch.__hobunjiDevCompanion = true;
    window.fetch = trackedFetch;
  }

  // config/*.js files are ordinary <script> tags; resource timing reports them
  // (and anything else not routed through fetch, like <link> JSON preloads).
  function noteResourceEntry(entry) {
    if (!entry || entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') return;
    noteConfigAccess(entry.name, {
      kind: entry.initiatorType === 'script' ? 'script' : (entry.initiatorType || 'resource'),
      status: entry.responseStatus || null,
      bytes: entry.encodedBodySize || entry.transferSize || null,
      durationMs: Math.round(entry.duration || 0),
    });
  }
  try {
    for (const entry of performance.getEntriesByType?.('resource') || []) noteResourceEntry(entry);
    if (typeof PerformanceObserver === 'function') {
      new PerformanceObserver(list => { for (const entry of list.getEntries()) noteResourceEntry(entry); })
        .observe({ type: 'resource', buffered: false });
    }
  } catch (_) {}

  // ── Traces ──────────────────────────────────────────────────────────
  function trace(channelName, payload) {
    const record = { channel: String(channelName || 'misc'), at: Date.now(), payload: clone(payload) };
    traceLatest.set(record.channel, record);
    traceHistory.push(record);
    if (traceHistory.length > TRACE_HISTORY) traceHistory.splice(0, traceHistory.length - TRACE_HISTORY);
    if (isConnected()) send({ type: 'trace', record });
    return record;
  }

  // ── Commands / state ────────────────────────────────────────────────
  function registerCommand(name, fn) {
    if (!name || typeof fn !== 'function') return false;
    commands.set(String(name), fn);
    return true;
  }

  function registerStateProvider(key, fn) {
    if (!key || typeof fn !== 'function') return false;
    stateProviders.set(String(key), fn);
    return true;
  }

  function collectState() {
    const state = {};
    for (const [key, fn] of stateProviders) {
      try { state[key] = clone(fn()); } catch (error) { state[key] = { error: String(error?.message || error) }; }
    }
    return state;
  }

  async function runCommand(name, args) {
    const fn = commands.get(String(name));
    if (!fn) throw new Error(`Unknown companion command "${name}".`);
    return fn(args || {});
  }

  // Sends only the providers whose output changed since the last push (the
  // companion merges partial updates); `force` resends everything, e.g. when a
  // companion (re)connects.
  const lastProviderSignatures = new Map();
  function pushState(force = false) {
    if (!isConnected() && !force) return;
    const state = collectState();
    const changedState = {};
    let changedCount = 0;
    for (const [key, value] of Object.entries(state)) {
      let signature = '';
      try { signature = JSON.stringify(value); } catch (_) {}
      if (!force && signature && lastProviderSignatures.get(key) === signature) continue;
      lastProviderSignatures.set(key, signature);
      changedState[key] = value;
      changedCount++;
    }
    if (!changedCount) return;
    send({ type: 'state', state: changedState, partial: !force });
  }

  function ensureStateTimer() {
    if (stateTimer) return;
    stateTimer = setInterval(() => {
      if (!isConnected()) { clearInterval(stateTimer); stateTimer = null; return; }
      if (document.visibilityState === 'hidden' && Date.now() % 2000 > STATE_INTERVAL_MS) return; // Background tabs are throttled anyway; keep ~0.5 Hz.
      pushState(false);
    }, STATE_INTERVAL_MS);
  }

  function helloPayload() {
    return {
      type: 'hello',
      bootedAt,
      title: document.title,
      href: location.href,
      commands: [...commands.keys()],
    };
  }

  async function handleMessage(message) {
    if (!message || message.protocol !== 1 || message.session !== sessionId || message.from !== 'companion') return;
    const wasConnected = isConnected();
    lastHeartbeatAt = Date.now();
    if (message.type === 'companion-hello' || !wasConnected) {
      send(helloPayload());
      pushState(true);
      send({ type: 'config-access', entries: [...configLog.values()].map(clone), full: true });
      send({ type: 'trace-snapshot', latest: [...traceLatest.values()], history: traceHistory.slice(-60) });
      ensureStateTimer();
      notifyConnection();
    }
    if (message.type === 'companion-bye') { lastHeartbeatAt = 0; notifyConnection(); return; }
    if (message.type === 'companion-heartbeat') send({ type: 'alive' });
    if (message.type === 'command') {
      let reply;
      try {
        const result = await runCommand(message.name, message.args);
        reply = { type: 'reply', requestId: message.requestId, ok: result?.ok !== false, result: clone(result) };
      } catch (error) {
        reply = { type: 'reply', requestId: message.requestId, ok: false, error: String(error?.message || error) };
      }
      send(reply);
      pushState(false);
    }
  }

  const connectionListeners = new Set();
  let lastConnectionState = false;
  function notifyConnection() {
    const connected = isConnected();
    if (connected === lastConnectionState) return;
    lastConnectionState = connected;
    for (const listener of connectionListeners) { try { listener(connected); } catch (_) {} }
  }
  setInterval(notifyConnection, 1000);

  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel(CHANNEL_PREFIX + sessionId);
    channel.onmessage = event => { handleMessage(event.data); };
    send(helloPayload()); // An already-open companion (game tab reloaded) reconnects immediately.
  }
  window.addEventListener('pagehide', () => send({ type: 'bye', reason: 'pagehide' }));

  // ── Launcher ────────────────────────────────────────────────────────
  function companionUrl(tab = '') {
    const url = new URL(COMPANION_PATH, new URL('./', location.href));
    url.searchParams.set('session', sessionId);
    if (tab) url.hash = tab;
    return url.href;
  }

  function windowName() {
    return `hobunji-dev-companion-${sessionId}`;
  }

  function open(tab = '') {
    const features = 'popup=yes,width=560,height=900';
    let win = null;
    try {
      win = window.open('', windowName(), features); // Re-uses an existing companion without reloading it.
      if (win) {
        let blank = true;
        try { blank = !win.location.href || win.location.href === 'about:blank'; } catch (_) { blank = true; }
        if (blank) win.location.href = companionUrl(tab);
        else if (tab) send({ type: 'focus-tab', tab });
        win.focus?.();
      }
    } catch (_) {
      win = window.open(companionUrl(tab), windowName(), features);
    }
    if (!win) window.__farmLog?.('Dev Companion popup was blocked — allow popups for this page.', 'warn');
    return !!win;
  }

  function focusTab(tab) {
    send({ type: 'focus-tab', tab: String(tab || '') });
  }

  function bindSettingsButton() {
    const button = document.getElementById('devCompanionOpenBtn');
    if (button && !button.__devCompanionBound) {
      button.__devCompanionBound = true;
      button.addEventListener('click', () => open());
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindSettingsButton, { once: true });
  else bindSettingsButton();

  // Which repo databases are currently being replaced by local editor
  // overrides (js/local-db-overrides.js). Re-read at most every 5s: an
  // override envelope can be megabytes, so this never runs at poll rate.
  let overridesCache = null;
  let overridesCachedAt = 0;
  function overridesState() {
    if (overridesCache && Date.now() - overridesCachedAt < 5000) return overridesCache;
    const api = window.LocalDBOverrides;
    if (!api?.listStatuses) return null;
    const mode = api.getSourceMode?.() || 'repo';
    overridesCache = {
      mode,
      databases: (api.DATABASES || []).map(db => {
        let savedAt = null;
        let has = false;
        try {
          const raw = localStorage.getItem('hobunji_local_db_override_v1_' + db.id);
          has = raw != null;
          const match = has ? /"savedAt"\s*:\s*(\d+)/.exec(raw.slice(0, 64)) : null; // setOverride writes savedAt first, so no full parse is needed.
          savedAt = match ? Number(match[1]) : null;
        } catch (_) {}
        return { id: db.id, label: db.label, repoPath: db.repoPath, hasOverride: has, savedAt, active: has && mode === 'local' };
      }),
    };
    overridesCachedAt = Date.now();
    return overridesCache;
  }
  registerStateProvider('overrides', overridesState);
  registerCommand('db-source', args => {
    const api = window.LocalDBOverrides;
    if (!api?.setSourceMode) return { ok: false, error: 'Local database overrides are unavailable.' };
    api.setSourceMode(args.mode === 'local' ? 'local' : 'repo');
    overridesCache = null;
    return { ok: true, mode: api.getSourceMode(), note: 'Takes effect on the next load — quick save + quick load to keep your spot.' };
  });

  // ── Context panels ──────────────────────────────────────────────────
  // A module adds a small, context-aware tool to the companion's "Now" tab
  // without the companion knowing anything about it:
  //   registerPanel({
  //     id, title, order?,               // order: lower renders first
  //     when: () => bool,                // shown only while this is true
  //     render: () => ({ summary?, rows?: [[label, value]], note?,
  //                      actions?: [{ id, label, title?, confirm?, active?, group? }] }),
  //     onAction: (actionId, args) => result,
  //   })
  // render() runs at the state poll rate while a companion is connected, so
  // it must be cheap (read state, don't compute).
  const panels = new Map();
  function registerPanel(spec) {
    if (!spec?.id || typeof spec.render !== 'function') return false;
    panels.set(String(spec.id), spec);
    return true;
  }
  registerStateProvider('panels', () => {
    const out = [];
    for (const spec of panels.values()) {
      try {
        if (spec.when && !spec.when()) continue;
        const body = spec.render() || {};
        out.push({ id: spec.id, title: spec.title || spec.id, order: Number(spec.order) || 0, ...body });
      } catch (error) {
        out.push({ id: spec.id, title: spec.title || spec.id, order: Number(spec.order) || 0, note: `Panel failed: ${String(error?.message || error)}` });
      }
    }
    return out.sort((a, b) => a.order - b.order);
  });
  registerCommand('panel-action', async args => {
    const spec = panels.get(String(args.panel || ''));
    if (!spec?.onAction) throw new Error(`Panel "${args.panel}" has no actions.`);
    const result = await spec.onAction(String(args.action || ''), args.args || {});
    return result ?? { ok: true };
  });

  // Dev Mode is the game's own Settings checkbox; flipping it through its
  // change event keeps game.js the single owner of s_devMode.
  registerCommand('dev-mode', args => {
    const box = document.getElementById('settingDevMode');
    if (!box) return { ok: false, error: 'Dev Mode setting not found.' };
    const next = args.enabled == null ? !box.checked : !!args.enabled;
    if (box.checked !== next) {
      box.checked = next;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, enabled: box.checked };
  });

  registerCommand('ping', () => ({ ok: true, at: Date.now() }));
  registerStateProvider('bridge', () => ({ sessionId, pageLoadId, bootedAt, configCount: configLog.size }));

  window.DevCompanion = {
    sessionId,
    open,
    focusTab,
    companionUrl,
    isConnected,
    onConnectionChange(listener) { if (typeof listener === 'function') connectionListeners.add(listener); return () => connectionListeners.delete(listener); },
    registerCommand,
    registerStateProvider,
    registerPanel,
    runCommand,
    collectState,
    pushState: () => pushState(true),
    trace,
    latestTrace: channelName => clone(traceLatest.get(String(channelName))),
    traceHistory: () => clone(traceHistory),
    noteConfigAccess,
    onConfigAccess(listener) { if (typeof listener === 'function') configListeners.add(listener); return () => configListeners.delete(listener); },
    configLog: () => [...configLog.values()].map(clone),
  };
})();
