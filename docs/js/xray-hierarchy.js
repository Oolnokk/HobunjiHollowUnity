(() => {
  'use strict';

  // Central x-ray / draw-order hierarchy config.
  //
  // Every layering rule that decides which actor part shows through or hides behind which other part lives HERE,
  // with its default and its allowed values. The renderer (held-object-render-order.js) reads these rules each
  // frame through XrayHierarchy.get(), so changing one takes effect on the next frame. The Dev Companion panel
  // below lists the hierarchy, lets a rule be switched from a dropdown while the game runs, and exports a diff
  // against the shipped defaults, i.e. exactly what to copy back into DEFAULT_RULES once a setting is proven.
  //
  // Adding a rule: add it to RULES (with default + options), read it with XrayHierarchy.get('<key>') where the
  // behaviour lives, and document it in docs/architecture/held-object-water-depth-compositing.md.
  if (window.XrayHierarchy?.version >= 1) return;

  const VERSION = 1;
  const STORAGE_KEY = 'hobunji.xrayHierarchy.v1'; // Per-browser dev overrides only; never part of a save.

  // Ordered top (drawn first / furthest back) to bottom. `order` is the position in the hierarchy.
  const RULES = Object.freeze({
    'actors.order': {
      order: 1, label: 'Actor draw order', default: 'all', options: ['all', 'near'],
      help: 'all: every visible player/NPC portrait is drawn far-to-near by actor depth. near: only actors within the crossing radius of the player (older behaviour).',
    },
    'pants.sortWithActor': {
      order: 2, label: 'Worn pants sort with their actor', default: 'on', options: ['on', 'off'],
      help: 'on: an actor\'s pants draw right after that actor\'s portrait. off: pants draw after every portrait and rely on depth alone.',
    },
    'weapon.frontPlaneMask': {
      order: 3, label: 'Held weapons hidden by owner front art', default: 'on', options: ['on', 'off'],
      help: 'on: a weapon pixel is hidden wherever its own holder\'s front portrait art is drawn (stencil mask).',
    },
    'hand.frontPlaneMask': {
      order: 4, label: 'Hands and their outlines vs the front plane', default: 'behind', options: ['behind', 'always', 'off'],
      help: 'behind: hands whose centre sits behind their holder\'s front plane (seen from the front) are hidden under the front art and lose their outline. always: every hand is masked like a weapon. off: hands are never masked.',
    },
    'portrait.waterTint': {
      order: 5, label: 'Water tint on portraits', default: 'wet-tile', options: ['wet-tile', 'bounds', 'off'],
      help: 'wet-tile: tint only when the actor stands on a wet tile. bounds: tint when any wet tile touches the portrait card. off: never tint portraits.',
    },
  });

  const keys = Object.keys(RULES).sort((a, b) => RULES[a].order - RULES[b].order);
  const state = {};
  const listeners = new Set();
  for (const key of keys) state[key] = RULES[key].default;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return;
      for (const key of keys) if (typeof raw[key] === 'string' && RULES[key].options.includes(raw[key])) state[key] = raw[key];
    } catch (_) { /* Private windows / blocked storage: defaults only. */ }
  }
  function save() {
    try {
      const changed = {};
      for (const key of keys) if (state[key] !== RULES[key].default) changed[key] = state[key];
      if (Object.keys(changed).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* Storage is a convenience; the live value still applies. */ }
  }

  // Hot path: read by the renderer every frame. A plain property read, no allocation.
  function get(key) { return state[key]; }

  function set(key, value) {
    if (!RULES[key] || !RULES[key].options.includes(value)) return false;
    if (state[key] === value) return true;
    const previous = state[key];
    state[key] = value;
    save();
    for (const listener of listeners) { try { listener(key, value, previous); } catch (_) { /* A bad listener must not block the rule change. */ } }
    return true;
  }

  function reset(key = null) {
    let changed = false;
    for (const k of key ? [key] : keys) if (RULES[k] && state[k] !== RULES[k].default) { set(k, RULES[k].default); changed = true; }
    return changed;
  }

  function diff() {
    const out = {};
    for (const key of keys) if (state[key] !== RULES[key].default) out[key] = { from: RULES[key].default, to: state[key] };
    return out;
  }

  // Text for the clipboard: the changes against shipped defaults plus the full effective hierarchy, so the
  // paste can be reviewed without knowing the defaults, and applied by editing RULES.<key>.default.
  function exportDiff() {
    const effective = {};
    for (const key of keys) effective[key] = state[key];
    return JSON.stringify({
      xrayHierarchy: { version: VERSION, changes: diff(), effective,
        howToApply: 'Set RULES[<key>].default to the "to" value in docs/js/xray-hierarchy.js, then run the x-ray regression tests.' },
    }, null, 2);
  }

  function importDiff(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { return { ok: false, error: 'Not valid JSON.' }; }
    const source = parsed?.xrayHierarchy?.effective || parsed?.xrayHierarchy?.changes || parsed;
    let applied = 0;
    for (const key of keys) {
      const value = typeof source?.[key] === 'string' ? source[key] : source?.[key]?.to;
      if (typeof value === 'string' && set(key, value)) applied++;
    }
    return { ok: true, applied };
  }

  function describe() {
    return keys.map(key => ({ key, ...RULES[key], value: state[key], changed: state[key] !== RULES[key].default }));
  }

  load();

  // ── Dev Companion panel: live hierarchy + dropdowns + diff export ────────────────────────────────
  function registerPanel() {
    const companion = window.DevCompanion;
    if (!companion?.registerPanel) return false;
    companion.registerPanel({
      id: 'xray-hierarchy',
      title: '🩻 X-ray hierarchy',
      order: 30,
      when: () => window.__hobunjiGameStarted === true,
      render: () => {
        const changes = Object.keys(diff()).length;
        const live = window.HeldObjectRenderOrder?.snapshot?.() || {};
        return {
          summary: changes ? `${changes} change${changes === 1 ? '' : 's'} from defaults` : 'defaults',
          rows: [
            ...describe().map(rule => [`${rule.order}. ${rule.label}`, `${rule.value}${rule.changed ? ` (default ${rule.default})` : ''}`]),
            ['Ranked actors / masked portraits', `${live.rankedPortraitActors ?? '-'} / ${live.frontPortraitMasks ?? '-'}`],
            ['Hands behind front plane', String(live.handsBehindFrontPlane ?? '-')],
          ],
          note: 'Changes apply on the next frame. Export diff copies the changes against the shipped defaults.',
          actions: [
            ...describe().map(rule => ({ id: 'set', label: rule.label, args: { key: rule.key }, value: rule.value,
              options: rule.options.map(option => ({ value: option, label: option })), group: 'Rules', title: rule.help })),
            { id: 'export', label: '📋 Export diff', group: 'Diff' },
            { id: 'reset', label: 'Reset all', group: 'Diff', confirm: 'Reset every x-ray rule to its default?' },
          ],
        };
      },
      onAction: (action, args) => {
        if (action === 'set') return set(String(args.key || ''), String(args.value ?? '')) ? { ok: true } : { ok: false, error: 'Unknown rule or value.' };
        if (action === 'reset') { reset(); return { ok: true }; }
        if (action === 'export') return { ok: true, title: 'X-ray hierarchy diff', text: exportDiff() };
        return { ok: false, error: 'Unknown action.' };
      },
    });
    return true;
  }

  window.XrayHierarchy = {
    version: VERSION, RULES, keys: () => keys.slice(),
    get, set, reset, diff, exportDiff, importDiff, describe, registerPanel,
    onChange(listener) { if (typeof listener === 'function') listeners.add(listener); return () => listeners.delete(listener); },
  };
  registerPanel();
})();
