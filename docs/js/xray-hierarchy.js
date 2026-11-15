(() => {
  'use strict';

  // Central pass-aware x-ray and compositing controls.
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

  // Rule display order; these controls govern different render passes, NOT a single GPU depth hierarchy.
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
    'weapon.followHandLayer': {
      order: 9, label: 'Weapons follow hands in the layer hierarchy', default: 'on', options: ['on', 'off'],
      help: 'on: weapons and tools inherit their owner-hand draw priority and front-art occlusion when manual ordering is active. off: weapons use the separately editable weapon layer.',
    },
  });


  // Manual color-sort priorities shared across all listed categories. Group labels are only descriptive;
  // opaque, transparent, portrait stencil and held-depth replay remain separate rendering passes.
  // The front-portrait crossing alone is translated to an owner-specific stencil decision.
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
  let selectedLayer = 'actor.hands'; // Currently edited drawing category in Dev Companion; tools share this when linked.
  const DRAW_ORDER_KEY = '__drawOrder'; // Reserved key within the existing versioned override record.

  function validDrawOrder(order) {
    return Array.isArray(order) && order.length === DEFAULT_DRAW_ORDER.length
      && new Set(order).size === DRAW_LAYER_IDS.size && order.every(id => DRAW_LAYER_IDS.has(id));
  }
  function effectiveLayerId(id) {
    // A linked tool is controlled by the hand entry, never by a hidden/inert weapon position.
    return id === 'item.weapons' && state['weapon.followHandLayer'] === 'on' ? 'actor.hands' : id;
  }
  function layerRank(id) {
    const index = drawOrder.indexOf(effectiveLayerId(id));
    return index < 0 ? drawOrder.length : index;
  }
  function editableLayers() {
    // Number only active controls: the independent weapon row is omitted until tools are unlinked.
    return describeLayers().filter(layer => effectiveLayerId(layer.id) === layer.id)
      .map((layer, index) => ({ ...layer, position: index + 1,
        label: layer.id === 'actor.hands' && state['weapon.followHandLayer'] === 'on'
          ? 'Hands + held tools (linked)' : layer.label }));
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
    const activeId = effectiveLayerId(id); // A request to move linked weapons actually moves the gripping hand.
    const activeDestination = beforeId === '__end' ? '__end' : effectiveLayerId(beforeId);
    if (activeId === activeDestination) return true;
    const next = drawOrder.filter(key => key !== activeId);
    const beforeIndex = activeDestination === '__end' ? next.length : next.indexOf(activeDestination);
    next.splice(beforeIndex, 0, activeId);
    return setDrawOrder(next);
  }
  function shiftLayer(id, delta) {
    if (delta !== 1 && delta !== -1) return false;
    const activeId = effectiveLayerId(id); // The linked weapon and hand share one position.
    const active = editableLayers().map(layer => layer.id); // Skip the inert weapon row while tools are linked.
    const index = active.indexOf(activeId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= active.length) return false;
    if (delta > 0) {
      const afterTarget = active[target + 1] || '__end';
      return moveLayer(activeId, afterTarget);
    }
    return moveLayer(activeId, active[target]);
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

  // Dev Companion groups actions by the REAL compositing decisions, not a fictional global hierarchy.
  function registerPanel() {
    const companion = window.DevCompanion;
    if (!companion?.registerPanel) return false;
    companion.registerPanel({
      id: 'xray-hierarchy',
      title: '🩻 X-ray and layer compositing',
      order: 30,
      when: () => window.__hobunjiGameStarted === true,
      render: () => {
        const changes = Object.keys(diff()).length;
        const live = window.HeldObjectRenderOrder?.snapshot?.() || {};
        const layers = editableLayers();
        if (!layers.some(layer => layer.id === selectedLayer)) selectedLayer = effectiveLayerId(selectedLayer);
        const activeLayer = layers.find(layer => layer.id === selectedLayer) || layers[0];
        const linked = state['weapon.followHandLayer'] === 'on';
        const stencil = Number(live.stencilBits || 0);
        const intended = Number(live.frontPortraitGearCandidates || 0);
        const masked = Number(live.frontPortraitMaskedGear || 0);
        const maskStatus = stencil < 8 ? 'Unavailable: ' + stencil + '-bit stencil target (needs 8)'
          : masked + ' / ' + intended + ' eligible gear parts masked';
        const frontPriority = state['layers.manualOrder'] === 'on'
          ? (layerRank('actor.hands') < layerRank('actor.front') ? 'behind front art' : 'in front of front art')
          : 'native ordering (front art masks eligible tools)';
        return {
          summary: changes ? changes + ' override' + (changes === 1 ? '' : 's') : 'repository defaults',
          rows: [
            ['Render model', 'World → held/foot depth replay → water tint; outlines separate'],
            ['Tool/hand priority', linked ? 'Linked: one effective rank' : 'Independent ranks'],
            ['Tool vs its own front art', frontPriority],
            ['Front mask stencil', maskStatus],
            ['Visible front portraits', String(live.frontPortraitMasks ?? '-')],
            ['Hands masked by front art', String(live.handsBehindFrontPlane ?? '-')],
            ['Airborne depth rebuilds / backdrop exclusions',
              String(live.airborneDepthRebuilds ?? '-') + ' / ' + String(live.backgroundDepthMeshesExcluded ?? '-')],
          ],
          note: 'Priority order sorts items only WITHIN the same opaque/transparent color pass. It cannot move scenery, tools or portraits between GPU passes or override physical depth. Moving the linked hands+tools entry across Front portrait planes also changes the owner-specific stencil mask when an 8-bit stencil target is available. Groups below are controls, not separate layer hierarchies.',
          actions: [
            { id: 'set', args: { key: 'weapon.frontPlaneMask' }, label: 'Held tools behind owner front art',
              value: state['weapon.frontPlaneMask'], options: RULES['weapon.frontPlaneMask'].options.map(value => ({ value, label: value })),
              group: 'Front portrait occlusion', title: RULES['weapon.frontPlaneMask'].help },
            { id: 'set', args: { key: 'hand.frontPlaneMask' }, label: 'Hands vs owner front art',
              value: state['hand.frontPlaneMask'], options: RULES['hand.frontPlaneMask'].options.map(value => ({ value, label: value })),
              group: 'Front portrait occlusion', title: RULES['hand.frontPlaneMask'].help },
            { id: 'set', args: { key: 'background.gearDepth' }, label: RULES['background.gearDepth'].label,
              value: state['background.gearDepth'], options: RULES['background.gearDepth'].options.map(value => ({ value, label: value })),
              group: 'World depth and airborne replay', title: RULES['background.gearDepth'].help },
            { id: 'set', args: { key: 'airborne.rebuildDepth' }, label: RULES['airborne.rebuildDepth'].label,
              value: state['airborne.rebuildDepth'], options: RULES['airborne.rebuildDepth'].options.map(value => ({ value, label: value })),
              group: 'World depth and airborne replay', title: RULES['airborne.rebuildDepth'].help },
            { id: 'set', args: { key: 'portrait.waterTint' }, label: RULES['portrait.waterTint'].label,
              value: state['portrait.waterTint'], options: RULES['portrait.waterTint'].options.map(value => ({ value, label: value })),
              group: 'Water compositing', title: RULES['portrait.waterTint'].help },
            { id: 'set', args: { key: 'actors.order' }, label: RULES['actors.order'].label,
              value: state['actors.order'], options: RULES['actors.order'].options.map(value => ({ value, label: value })),
              group: 'Actor stacking', title: RULES['actors.order'].help },
            { id: 'set', args: { key: 'pants.sortWithActor' }, label: RULES['pants.sortWithActor'].label,
              value: state['pants.sortWithActor'], options: RULES['pants.sortWithActor'].options.map(value => ({ value, label: value })),
              group: 'Actor stacking', title: RULES['pants.sortWithActor'].help },
            { id: 'set', args: { key: 'layers.manualOrder' }, label: 'Use custom same-pass color order',
              value: state['layers.manualOrder'], options: RULES['layers.manualOrder'].options.map(value => ({ value, label: value })),
              group: 'Same-pass draw priority', title: RULES['layers.manualOrder'].help },
            { id: 'set', args: { key: 'weapon.followHandLayer' }, label: 'Tools follow the hands',
              value: state['weapon.followHandLayer'], options: RULES['weapon.followHandLayer'].options.map(value => ({ value, label: value })),
              group: 'Same-pass draw priority', title: RULES['weapon.followHandLayer'].help },
            { id: 'focus-layer', label: 'Part to move (all active categories)', value: activeLayer.id,
              options: layers.map(layer => ({ value: layer.id, label: layer.position + '. ' + layer.label })),
              group: 'Same-pass draw priority' },
            { id: 'move-before', label: 'Place before…', value: activeLayer.id,
              options: [
                { value: activeLayer.id, label: 'Choose destination' },
                ...layers.filter(layer => layer.id !== activeLayer.id).map(layer => ({ value: layer.id, label: layer.position + '. ' + layer.label })),
                { value: '__end', label: 'Last (highest color priority)' },
              ],
              group: 'Same-pass draw priority', reset: true },
            { id: 'shift', label: 'Move toward back', args: { delta: -1 }, group: 'Same-pass draw priority' },
            { id: 'shift', label: 'Move toward front', args: { delta: 1 }, group: 'Same-pass draw priority' },
            { id: 'export', label: '📋 Export overrides and layer ranks', group: 'Transfer and restore' },
            { id: 'reset', label: 'Reset all to repo', group: 'Transfer and restore',
              confirm: 'Discard all browser X-ray overrides and restore EVERY rule and draw-order position to the defaults shipped with this repository version? This does not reset the game save.' },
          ],
        };
      },
      onAction: (action, args = {}) => {
        if (action === 'set') {
          const ok = set(String(args.key || ''), String(args.value ?? ''));
          if (ok && args.key === 'weapon.followHandLayer' && args.value === 'on') selectedLayer = effectiveLayerId(selectedLayer);
          return ok ? { ok: true } : { ok: false, error: 'Unknown rule or value.' };
        }
        if (action === 'focus-layer') {
          if (!editableLayers().some(layer => layer.id === args.value)) return { ok: false, error: 'Unknown or currently linked layer.' };
          selectedLayer = args.value;
          return { ok: true };
        }
        if (action === 'shift' || action === 'move-before') {
          const valid = action === 'shift'
            ? shiftLayer(selectedLayer, args.delta)
            : moveLayer(selectedLayer, args.value);
          if (!valid) return { ok: false, error: 'Invalid move.' };
          set('layers.manualOrder', 'on'); // Cross-front-portrait rank decisions need this switch, too.
          return { ok: true };
        }
        if (action === 'reset') {
          reset();
          selectedLayer = 'actor.hands'; // Make the newly restored, linked position visible.
          return { ok: true };
        }
        if (action === 'export') return { ok: true, title: 'X-ray compositing overrides', text: exportDiff() };
        return { ok: false, error: 'Unknown action.' };
      },
    });
    return true;
  }

  window.XrayHierarchy = {
    version: VERSION, RULES, keys: () => keys.slice(),
    get, set, reset, diff, exportDiff, importDiff, describe, registerPanel,
    DRAW_LAYERS, DEFAULT_DRAW_ORDER, describeLayers, editableLayers, effectiveLayerId, layerRank, setDrawOrder, moveLayer, shiftLayer, resetDrawOrder,
    onChange(listener) { if (typeof listener === 'function') listeners.add(listener); return () => listeners.delete(listener); },
  };
  registerPanel();
})();
