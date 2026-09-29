// Tuning for the dev-only Random Test Ruin, read from
// docs/config/random-ruin/ruin-config.json (plus an optional localStorage
// override for quick console experiments). Ruin modules read values with
// DevRandomRuinConfig.get('sanctum.boss.tier', 2) at build time, so the
// built-in fallback keeps every module working if the file is missing or a
// key is left out. DevRandomRuin.generate() awaits `ready` before building.
(() => {
  'use strict';

  const CONFIG_URL = 'config/random-ruin/ruin-config.json';
  const OVERRIDE_KEY = 'hobunji.devRandomRuinConfigOverride.v1';

  let fileConfig = {};
  let status = 'loading';

  function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function readOverride() {
    try { const raw = localStorage.getItem(OVERRIDE_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }

  function lookup(root, path) {
    let node = root;
    for (const part of String(path).split('.')) {
      if (!isPlainObject(node) || !(part in node)) return undefined;
      node = node[part];
    }
    return node;
  }

  // Override first, then the file; a value of the wrong kind (e.g. a string
  // where the default is a number) is ignored in favour of the fallback.
  function get(path, fallback) {
    for (const source of [readOverride(), fileConfig]) {
      const value = source ? lookup(source, path) : undefined;
      if (value === undefined || value === null) continue;
      if (fallback !== undefined && fallback !== null) {
        if (typeof fallback === 'number' && !Number.isFinite(Number(value))) continue;
        if (Array.isArray(fallback) && !Array.isArray(value)) continue;
        if (typeof fallback === 'boolean' && typeof value !== 'boolean') continue;
        if (typeof fallback === 'number') return Number(value);
      }
      return value;
    }
    return fallback;
  }

  function load() {
    status = 'loading';
    const url = CONFIG_URL + '?t=' + Date.now(); // Always the current file: this is a tuning loop.
    return fetch(url, { cache:'no-store' })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error('HTTP ' + response.status))))
      .then(json => { fileConfig = isPlainObject(json) ? json : {}; status = 'loaded'; return true; })
      .catch(error => { fileConfig = {}; status = 'defaults (' + (error?.message || error) + ')'; console.warn('[Random Test Ruin config] using built-in defaults:', error); return false; });
  }

  let ready = load();

  window.DevRandomRuinConfig = Object.freeze({
    get,
    get ready() { return ready; },
    reload: () => (ready = load()), // generate() calls this so file edits apply to the next ruin without a page reload.
    setOverride: value => {
      try { if (value == null) localStorage.removeItem(OVERRIDE_KEY); else localStorage.setItem(OVERRIDE_KEY, JSON.stringify(value)); } catch (_) {}
      return readOverride();
    },
    snapshot: () => ({ status, file:JSON.parse(JSON.stringify(fileConfig)), override:readOverride() }),
  });
})();
