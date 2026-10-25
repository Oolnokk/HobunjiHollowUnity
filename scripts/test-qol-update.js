// Executes the QoL modules (audio mix, toast history, menu hotkeys, pack
// search) against small DOM stand-ins.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function makeElement(attrs = {}) {
  const listeners = {};
  const classes = new Set();
  return {
    ...attrs,
    dataset: attrs.dataset || {},
    style: {},
    title: attrs.title || '',
    listeners,
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : !!on; if (want) classes.add(c); else classes.delete(c); return want; },
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] ?? null; },
    remove() { this.removed = true; },
    appendChild(child) { this.child = child; return child; },
    querySelector() { return null; },
  };
}

function makeEnv({ elements = {}, selectors = {} } = {}) {
  const storage = new Map();
  const windowListeners = {};
  const document = {
    readyState: 'complete',
    hidden: false,
    head: makeElement(),
    body: makeElement(),
    hasFocus: () => true,
    getElementById: id => elements[id] || null,
    querySelector: sel => (typeof selectors[sel] === 'function' ? selectors[sel]() : selectors[sel]) || null,
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    addEventListener() {},
  };
  const window = {
    document,
    localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
    windowListeners,
    storage,
  };
  window.window = window;
  return window;
}

function load(file, window, extra = {}) {
  const context = vm.createContext({ window, document: window.document, localStorage: window.localStorage, console, Date, Math, JSON, Number, String, Object, Array, Set, Map, WeakMap, WeakSet, WeakRef, Reflect, setTimeout: () => 0, clearTimeout() {}, ...extra });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context;
}

// ── Toast history ──────────────────────────────────────────────────────────
{
  const toast = makeElement();
  const window = makeEnv({ elements: { toast, zoneBanner: makeElement() } });
  load('docs/js/toast-notifications.js', window);
  const api = window.ToastNotifications;
  api.init({ toastEl: toast });
  let changes = 0;
  api.onHistoryChange(() => changes++);
  api.showToast('Planted turnip');
  api.showToast('Planted turnip');
  api.showToast('Too tired', false, true);
  api.showZoneBanner('Hobunji Town');
  const history = api.getHistory();
  assert.strictEqual(history.length, 3, 'identical consecutive toasts collapse into one entry');
  assert.strictEqual(history[0].count, 2, 'collapsed entry counts its repeats');
  assert.strictEqual(history[1].ok, false);
  assert.strictEqual(history[2].kind, 'zone');
  assert.strictEqual(toast.textContent, 'Too tired', 'the toast element still shows the latest toast');
  assert.ok(toast.className.includes('fail'));
  assert.strictEqual(changes, 4);
  for (let i = 0; i < 200; i++) api.showToast('msg ' + i);
  assert.ok(api.getHistory().length <= 80, 'history is capped');
  api.clearHistory();
  assert.strictEqual(api.getHistory().length, 0);
}

// ── Pack search ────────────────────────────────────────────────────────────
{
  const input = makeElement({ value: '' });
  const window = makeEnv({ elements: { invSearch: input } });
  load('docs/js/inventory-search.js', window);
  let rebuilds = 0;
  const defs = { wood: { label: 'Wood' }, turnip_seed: { label: 'Turnip Seeds' }, stone: { label: 'Stone' } };
  window.InventorySearch.init({ rebuild: () => rebuilds++, getItemDefs: () => defs });
  const keys = Object.keys(defs);
  assert.deepStrictEqual(window.InventorySearch.filterKeys(keys), keys, 'no query keeps every item');
  input.value = 'SEED';
  input.listeners.input[0]();
  assert.deepStrictEqual(window.InventorySearch.filterKeys(keys), ['turnip_seed'], 'matches case-insensitively on the item label');
  assert.strictEqual(rebuilds, 1, 'typing rebuilds the grid');
  window.InventorySearch.setQuery('turnip seed');
  assert.deepStrictEqual(window.InventorySearch.filterKeys(keys), ['turnip_seed'], 'matches the item key with underscores as spaces');
  let prevented = false;
  input.value = 'x';
  input.listeners.keydown[0]({ key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation() {} });
  assert.ok(prevented && input.value === '' && window.InventorySearch.query === '', 'Escape clears a non-empty search');
}

// ── Menu hotkeys ───────────────────────────────────────────────────────────
{
  const tabs = {};
  for (const panel of ['inventory', 'crafting', 'map', 'calendar', 'progress', 'tasks', 'relationships', 'loadout']) tabs[panel] = makeElement({ dataset: { mpanel: panel }, title: panel });
  let active = 'inventory';
  const selectors = { '#mpSettings .is-listening': null, '#menuPanel .mp-tab.active': () => tabs[active] };
  for (const [panel, tab] of Object.entries(tabs)) selectors[`#menuPanel .mp-tab[data-mpanel="${panel}"]`] = tab;
  const window = makeEnv({ selectors });
  let bound = null;
  window.InputBindings = { resolveActionForButton: (device, code) => (code === bound ? 'someAction' : null) };
  load('docs/js/qol-hotkeys.js', window);
  let open = false;
  const calls = [];
  window.QolHotkeys.init({
    openMenu: p => { open = true; active = p; calls.push('open:' + p); },
    closeMenu: () => { open = false; calls.push('close'); },
    switchMenuPanel: p => { active = p; calls.push('switch:' + p); },
    isMenuOpen: () => open,
    isBlocked: () => false,
  });
  const press = (code, extra = {}) => window.QolHotkeys.handleKey({ code, key: extra.key || code.replace('Key', '').toLowerCase(), preventDefault() {}, ...extra });
  assert.strictEqual(tabs.crafting.title, 'crafting (K)', 'tab tooltips advertise their hotkey');
  assert.strictEqual(tabs.crafting.dataset.qolHotkey, 'K');
  assert.ok(press('KeyK'));
  assert.ok(press('KeyJ'));
  assert.ok(press('KeyJ'));
  assert.deepStrictEqual(calls, ['open:crafting', 'switch:tasks', 'close'], 'opens, switches tabs, and closes on a repeat press');
  assert.strictEqual(press('KeyK', { ctrlKey: true }), false, 'modified keys are left alone');
  bound = 'KeyI';
  assert.strictEqual(press('KeyI'), false, 'a key bound to a gameplay action keeps that action');
  bound = null;
  assert.strictEqual(press('KeyW'), false, 'unrelated keys pass through');
}

// ── Audio mix ──────────────────────────────────────────────────────────────
{
  class FakeMedia {
    constructor() { this._v = 1; }
    play() { return Promise.resolve(); }
  }
  Object.defineProperty(FakeMedia.prototype, 'volume', {
    configurable: true, enumerable: true,
    get() { return this._v; },
    set(v) { if (!(v >= 0 && v <= 1)) throw new RangeError('volume out of range'); this._v = v; },
  });
  class FakeParam { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } }
  class FakeGain { constructor() { this.gain = new FakeParam(1); this.out = []; } connect(n) { this.out.push(n); return n; } }
  const realDest = { real: true };
  class FakeCtx {
    constructor() { this.currentTime = 0; }
    get destination() { return realDest; }
    createGain() { return new FakeGain(); }
    createMediaElementSource(el) { return { el }; }
  }
  const window = makeEnv();
  window.HTMLMediaElement = FakeMedia;
  window.AudioContext = FakeCtx;
  window.BaseAudioContext = FakeCtx;
  load('docs/js/audio-mix.js', window, { HTMLMediaElement: FakeMedia });
  const mix = window.HobunjiAudioMix;

  const sfx = new FakeMedia();
  sfx.volume = 0.8;
  mix.setLevel('effects', 0.5);
  assert.strictEqual(sfx.volume, 0.8, 'getter returns the requested volume');
  assert.ok(Math.abs(sfx._v - 0.4) < 1e-9, 'audible volume = requested x effects level');
  const song = new FakeMedia();
  mix.markMusic(song);
  song.volume = 1;
  mix.setLevel('music', 0.25);
  assert.ok(Math.abs(song._v - 0.25) < 1e-9, 'music elements follow the music level');
  mix.setLevel('master', 0.5);
  assert.ok(Math.abs(song._v - 0.125) < 1e-9 && Math.abs(sfx._v - 0.2) < 1e-9, 'master scales every category');
  assert.throws(() => { sfx.volume = 2; }, RangeError, 'invalid volumes still throw like the native setter');

  const ctx = new window.AudioContext();
  assert.ok(ctx instanceof FakeCtx, 'wrapped AudioContext is still an AudioContext');
  assert.notStrictEqual(ctx.destination, realDest, 'ctx.destination is the effects bus');
  assert.strictEqual(ctx.__hobunjiMix.master.out[0], realDest, 'the master bus feeds the real destination');
  assert.strictEqual(mix.musicDestination(ctx), ctx.__hobunjiMix.music);
  assert.strictEqual(ctx.__hobunjiMix.master.gain.value, 0.5);
  const routed = new FakeMedia();
  routed.volume = 0.6;
  ctx.createMediaElementSource(routed);
  assert.ok(Math.abs(routed._v - 0.6) < 1e-9, 'elements routed into Web Audio are not scaled twice');

  mix.setMuteUnfocused(true);
  window.document.hidden = true;
  for (const fn of window.windowListeners.blur || []) fn();
  assert.strictEqual(sfx._v, 0, 'mute in background silences elements');
  assert.strictEqual(ctx.__hobunjiMix.master.gain.value, 0, 'mute in background silences Web Audio');
  window.document.hidden = false;
  for (const fn of window.windowListeners.focus || []) fn();
  assert.ok(Math.abs(sfx._v - 0.2) < 1e-9, 'focus restores the mix');
  assert.ok(JSON.parse(window.storage.get('hobunji.audioMix.v1')).muteUnfocused, 'settings persist');
}

// ── Wiring ─────────────────────────────────────────────────────────────────
{
  const html = fs.readFileSync('docs/index.html', 'utf8');
  const game = fs.readFileSync('docs/game.js', 'utf8');
  for (const mod of ['audio-mix', 'toast-notifications', 'qol-hotkeys', 'inventory-search']) {
    assert.match(html, new RegExp(`js/${mod}\\.js\\?v=[A-Za-z0-9_-]+`), `${mod}.js is loaded`);
  }
  const firstAudio = Math.min(...['js/audio-system.js', 'js/music-system.js'].map(s => html.indexOf(s)));
  assert.ok(html.indexOf('js/audio-mix.js') < firstAudio, 'audio-mix loads before the audio modules');
  assert.ok(html.indexOf('js/qol-hotkeys.js') < html.indexOf('src="game.js?v='), 'qol-hotkeys loads before game.js');
  assert.match(game, /window\.QolHotkeys\.init\(/);
  assert.match(game, /window\.InventorySearch\.init\(/);
  assert.match(game, /window\.ToastNotifications\.init\(/);
}

console.log('qol update tests passed');
