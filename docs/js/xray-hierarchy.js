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
    'layers.manualOrder': {
      order: 6, label: 'Use manually reordered draw layers', default: 'off', options: ['on', 'off'],
      help: 'Override normal ordering INSIDE opaque/transparent color passes. Depth testing and the protected stencil/water replay sequence remain intact.',
    },
    'background.gearDepth': {
      order: 7, label: 'Sky and distant backdrops block gear', default: 'ignore', options: ['ignore', 'original'],
      help: 'ignore: sky/cloud depth masks and visual-only horizon backdrops cannot cut out the holder\'s gear during its depth replay. original: include their historical depth.',
    },
    'airborne.rebuildDepth': {
      order: 8, label: 'Rebuild gear depth while airborne', default: 'on', options: ['on', 'off'],
      help: 'on: while a jump is active, rebuild even the ordinary gear group without horizon depth. This avoids irregular sky/distant-tile masks on raised weapons.',
    },
  });


  // Manual display priorities (not WebGL camera.layers or depth/stencil pass numbers).
  // The sorter uses these only when layers.manualOrder=on; depth, transparent/opaque
  // pass separation and all game-critical replay passes remain authoritative.
  const DRAW_LAYERS = Object.freeze([
    { id: 'sky', group: 'World', label: 'Sky and clouds' },
    { id: 'distant', group: 'World', label: 'Distant landscape' },
    { id: 'terrain', group: 'World', label: 'Terrain materials' },
    { id: 'paths', group: 'World', label: 'Paths and roads' },
    { id: 'floors', group: 'World', label: 'Walkable floors' },
    { id: 'material.opaque', group: 'Materials', label: 'Other opaque materials' },
    { id: 'actor.rear', group: 'Characters', label: 'Rear portrait planes' },
    { id: 'actor.body', group: 'Characters', label: 'Body / rigs' },
    { id: 'actor.feet', group: 'Characters', label: 'Feet' },
    { id: 'actor.hands', group: 'Characters', label: 'Hands and wing extensions' },
    { id: 'item.weapons', group: 'Equipment', label: 'Weapons and held tools' },
    { id: 'actor.front', group: 'Characters', label: 'Front portrait planes' },
    { id: 'garment.pants', group: 'Equipment', label: 'Pants / lower garments' },
    { id: 'garment.headwear', group: 'Equipment', label: 'Hats / headwear' },
    { id: 'material.cutout', group: 'Materials', label: 'Alpha-cutout materials' },
    { id: 'water', group: 'World', label: 'Water and slush' },
    { id: 'foliage', group: 'World', label: 'Grass / foliage' },
    { id: 'material.transparent', group: 'Materials', label: 'Other transparent materials / effects' },
  ]);
  const DEFAULT_DRAW_ORDER = Object.freeze(DRAW_LAYERS.map(layer => layer.id)); // Original order for reset and export.
  const DRAW_LAYER_IDS = new Set(DEFAULT_DRAW_ORDER); // Validates reorder/import operations before persistence.
  let drawOrder = DEFAULT_DRAW_ORDER.slice(); // Mutable live order read by the render-list sort when enabled.
  let selectedGroup = 'Characters'; // Dev Companion's compact picker; does not alter rendering.
  let selectedLayer = 'actor.hands'; // Which layer receives the move-before selector.
  const DRAW_ORDER_KEY = '__drawOrder'; // Reserved key within the existing versioned override record.

  function validDrawOrder(order) {
    return Array.isArray(order) && order.length === DEFAULT_DRAW_ORDER.length
      && new Set(order).size === DRAW_LAYER_IDS.size && order.every(id => DRAW_LAYER_IDS.has(id));
  }
  function layerRank(id) {
    const index = drawOrder.indexOf(id);
    return index < 0 ? drawOrder.length : index;
  }
  function describeLayers(group = null) {
    return drawOrder.map((id, index) => {
      const layer = DRAW_LAYERS.find(item => item.id === id);
      return { ...layer, position: index + 1 };
    }).filter(layer => !group || layer.group === group);
  }
  function setDrawOrder(order) {
    if (!validDrawOrder(order)) return false; // Never permit duplicate, missing or unknown render layers.
    if (drawOrder.every((id, index) => id === order[index])) return true;
    const previous = drawOrder;
    drawOrder = order.slice();
    save();
    for (const listener of listeners) {
      try { listener(DRAW_ORDER_KEY, drawOrder.slice(), previous.slice()); } catch (_) {}
    }
    return true;
  }
  function moveLayer(id, beforeId) {
    if (!DRAW_LAYER_IDS.has(id) || (beforeId !== '__end' && !DRAW_LAYER_IDS.has(beforeId))) return false;
    if (id === beforeId) return true;
    const next = drawOrder.filter(key => key !== id);
    const beforeIndex = beforeId === '__end' ? next.length : next.indexOf(beforeId);
    next.splice(beforeIndex, 0, id);
    return setDrawOrder(next);
  }
  function shiftLayer(id, delta) {
    const index = drawOrder.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= drawOrder.length) return false;
    const next = drawOrder.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return setDrawOrder(next);
  }
  function resetDrawOrder() { return setDrawOrder(DEFAULT_DRAW_ORDER); }

  const keys = Object.keys(RULES).sort((a, b) => RULES[a].order - RULES[b].order);
  const state = {};
  const listeners = new Set();
  for (const key of keys) state[key] = RULES[key].default;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return;
      for (const key of keys) if (typeof raw[key] === 'string' && RULES[key].options.includes(raw[key])) state[key] = raw[key];
      if (validDrawOrder(raw[DRAW_ORDER_KEY])) drawOrder = raw[DRAW_ORDER_KEY].slice();
    } catch (_) { /* Private windows / blocked storage: defaults only. */ }
  }
  function save() {
    try {
      const changed = {};
      for (const key of keys) if (state[key] !== RULES[key].default) changed[key] = state[key];
      if (!drawOrder.every((id, index) => id === DEFAULT_DRAW_ORDER[index])) changed[DRAW_ORDER_KEY] = drawOrder.slice();
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
    if (key === null && !drawOrder.every((id, index) => id === DEFAULT_DRAW_ORDER[index])) {
      resetDrawOrder();
      changed = true;
    }
    return changed;
  }

  function diff() {
    const out = {};
    for (const key of keys) if (state[key] !== RULES[key].default) out[key] = { from: RULES[key].default, to: state[key] };
    if (!drawOrder.every((id, index) => id === DEFAULT_DRAW_ORDER[index])) {
      out.drawOrder = { from: DEFAULT_DRAW_ORDER.slice(), to: drawOrder.slice() };
    }
    return out;
  }

  // Text for the clipboard: the changes against shipped defaults plus the full effective hierarchy, so the
  // paste can be reviewed without knowing the defaults, and applied by editing RULES.<key>.default.
  function exportDiff() {
    const effective = {};
    for (const key of keys) effective[key] = state[key];
    return JSON.stringify({
      xrayHierarchy: { version: VERSION, changes: diff(), effective, drawOrder: drawOrder.slice(),
        howToApply: 'Set RULES[<key>].default to the "to" value in docs/js/xray-hierarchy.js, then run the x-ray regression tests.' },
    }, null, 2);
  }

  function importDiff(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { return { ok: false, error: 'Not valid JSON.' }; }
    const source = parsed?.xrayHierarchy?.effective || parsed?.xrayHierarchy?.changes || parsed;
    let applied = 0;
    // Validate before mutating: a damaged export must never partly scramble the hierarchy.
    const requestedOrder = parsed?.xrayHierarchy?.drawOrder || parsed?.xrayHierarchy?.changes?.drawOrder?.to
      || parsed?.[DRAW_ORDER_KEY] || source?.drawOrder?.to;
    if (requestedOrder !== undefined && !validDrawOrder(requestedOrder)) return { ok: false, error: 'Invalid draw-order layer list.' };
    for (const key of keys) {
      const value = typeof source?.[key] === 'string' ? source[key] : source?.[key]?.to;
      if (typeof value === 'string' && set(key, value)) applied++;
    }
    if (requestedOrder && setDrawOrder(requestedOrder)) applied++;
    return { ok: true, applied };
  }

  function describe() {
    return keys.map(key => ({ key, ...RULES[key], value: state[key], changed: state[key] !== RULES[key].default }));
  }

  load();

  // ── Dev Companion: one compact picker, then reorder controls and nested exceptions ──
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
        const selected = describeLayers(selectedGroup);
        return {
          summary: changes ? `${changes} change${changes === 1 ? '' : 's'} from defaults` : 'defaults',
          rows: [
            ['Manual color sort', state['layers.manualOrder'] === 'on' ? 'active' : 'native render order'],
            ['Editing layers', `${selectedGroup}: ${selected.map(layer => `${layer.position}. ${layer.label}`).join(' → ')}`],
            ['Ranked actors / masked portraits', `${live.rankedPortraitActors ?? '-'} / ${live.frontPortraitMasks ?? '-'}`],
            ['Hands behind front plane', String(live.handsBehindFrontPlane ?? '-')],
            ['Jump replay / backgrounds excluded', `${live.airborneDepthRebuilds ?? '-'} / ${live.backgroundDepthMeshesExcluded ?? '-'}`],
          ],
          note: 'Move before or nudge a layer in the full hierarchy. These controls sort within color passes; depth, opaque vs transparent pass boundaries, water/stencil masks, and camera layer numbers are separate. Export diff preserves every rank.',
          actions: [
            { id: 'set', args: { key: 'layers.manualOrder' }, label: 'Manual draw order', value: state['layers.manualOrder'],
              options: ['off', 'on'].map(value => ({ value, label: value })), group: 'Draw order', path: ['Draw order'], title: RULES['layers.manualOrder'].help },
            { id: 'focus-group', label: 'Category to edit', value: selectedGroup,
              options: [...new Set(DRAW_LAYERS.map(layer => layer.group))].map(value => ({ value, label: value })),
              group: 'Draw order', path: ['Draw order'] },
            { id: 'focus-layer', label: 'Layer to move', value: selectedLayer,
              options: selected.map(layer => ({ value: layer.id, label: `${layer.position}. ${layer.label}` })),
              group: 'Layer position', path: ['Draw order', selectedGroup] },
            { id: 'move-before', label: 'Move selected layer before…', value: selectedLayer,
              options: [
                { value: selectedLayer, label: 'Choose destination' },
                ...describeLayers().filter(layer => layer.id !== selectedLayer).map(layer => ({ value: layer.id, label: `${layer.position}. ${layer.label}` })),
                { value: '__end', label: 'End (frontmost)' },
              ],
              group: 'Layer position', path: ['Draw order', selectedGroup], reset: true },
            { id: 'shift', label: 'Move selected layer toward back', args: { delta: -1 },
              group: 'Layer position', path: ['Draw order', selectedGroup] },
            { id: 'shift', label: 'Move selected layer toward front', args: { delta: 1 },
              group: 'Layer position', path: ['Draw order', selectedGroup] },
            ...describe().filter(rule => !['layers.manualOrder', 'background.gearDepth', 'airborne.rebuildDepth'].includes(rule.key))
              .map(rule => ({ id: 'set', label: rule.label, args: { key: rule.key }, value: rule.value,
                options: rule.options.map(value => ({ value, label: value })), group: 'Masks and behavior',
                path: ['Exceptions', rule.key.split('.')[0]], title: rule.help })),
            ...describe().filter(rule => ['background.gearDepth', 'airborne.rebuildDepth'].includes(rule.key))
              .map(rule => ({ id: 'set', label: rule.label, args: { key: rule.key }, value: rule.value,
                options: rule.options.map(value => ({ value, label: value })), group: 'Airborne / distant scenery',
                path: ['Exceptions', 'Airborne'], title: rule.help })),
            { id: 'export', label: '📋 Export all changes', group: 'Export / reset', path: ['Transfer'] },
            { id: 'reset', label: 'Reset all', group: 'Export / reset', path: ['Transfer'],
              confirm: 'Reset every X-ray rule and visual layer order to the shipped defaults?' },
          ],
        };
      },
      onAction: (action, args = {}) => {
        if (action === 'set') return set(String(args.key || ''), String(args.value ?? ''))
          ? { ok: true } : { ok: false, error: 'Unknown rule or value.' };
        if (action === 'focus-group') {
          if (!DRAW_LAYERS.some(layer => layer.group === args.value)) return { ok: false, error: 'Unknown category.' };
          selectedGroup = args.value;
          selectedLayer = describeLayers(selectedGroup)[0]?.id || selectedLayer;
          return { ok: true };
        }
        if (action === 'focus-layer') {
          if (!describeLayers(selectedGroup).some(layer => layer.id === args.value)) return { ok: false, error: 'Unknown layer.' };
          selectedLayer = args.value;
          return { ok: true };
        }
        if (action === 'shift' || action === 'move-before') {
          const valid = action === 'shift'
            ? (args.delta === -1 || args.delta === 1) && shiftLayer(selectedLayer, args.delta)
            : moveLayer(selectedLayer, args.value);
          if (!valid) return { ok: false, error: 'Invalid move.' };
          set('layers.manualOrder', 'on'); // A manual edit always activates the live sort.
          return { ok: true };
        }
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
    DRAW_LAYERS, DEFAULT_DRAW_ORDER, describeLayers, layerRank, setDrawOrder, moveLayer, shiftLayer, resetDrawOrder,
    onChange(listener) { if (typeof listener === 'function') listeners.add(listener); return () => listeners.delete(listener); },
  };
  registerPanel();
})();
