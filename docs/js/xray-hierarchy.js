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
  const DIAGNOSTIC_KEY = 'hobunji.xrayHierarchy.diagnostics.v1'; // Restorable original settings while testing presets, including after a reload.

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
      order: 3, label: 'Held weapons hidden by owner front art', default: 'off', options: ['on', 'off'],
      help: 'off (default): the owner front-portrait stencil does not hide weapon pixels. on: overlap with opaque owner front art hides weapon pixels, regardless of their depth relative to the portrait.',
    },
    'hand.frontPlaneMask': {
      order: 4, label: 'Hands and their outlines vs the front plane', default: 'off', options: ['behind', 'always', 'off'],
      help: 'behind: hands whose centre sits behind their holder\'s front plane (seen from the front) are hidden under the front art and lose their outline. always: every hand is masked like a weapon. off: hands are never masked.',
    },
    'portrait.waterTint': {
      order: 5, label: 'Water tint on portraits', default: 'wet-tile', options: ['wet-tile', 'bounds', 'off'],
      help: 'wet-tile: tint only when the actor stands on a wet tile. bounds: tint when any wet tile touches the portrait card. off: never tint portraits.',
    },
    'layers.manualOrder': {
      order: 6, label: 'Use manually reordered draw layers', default: 'off', options: ['on', 'off'],
      help: 'Order items only within the same render stage and opacity bucket. Front-art stencil, physical depth, water and outlines are separate.',
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
      help: 'on: tools share the hand priority in the held overlay. off: tools get an independent overlay rank. Owner front-art masking is configured separately.',
    },
    'ground.showZone': {
      order: 10, label: 'Show ground X-ray zone', default: 'off', options: ['on', 'off'],
      help: 'Dev-only translucent circle at the player standing elevation; not a rendering behavior override.',
    },

    'baby.carrierForeground': {
      order: 11, label: 'Held baby stays in front of carrier portrait/pants', default: 'on', options: ['on', 'off'],
      help: 'on: held babies draw over their own carrier portrait, write physical depth to protect against the later pants overlay, and keep normal world occlusion. Other carryables and back-stowed babies stay unchanged.',
    },  });


  // Manual color-sort priorities shared across all listed categories. Group labels are only descriptive;
  // opaque, transparent, portrait stencil and held-depth replay remain separate rendering passes.
  // Front-portrait cover is a separate owner-stencil switch, never an ordinary color rank.
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
  let selectedStage = 'held'; // Active render-stage picker; never changes the game's pass order.
  let selectedPresetId = 'baseline'; // Highlighted hypothesis in the Dev Companion preset picker.
  let activePresetId = null; // Most recently applied diagnostic experiment, or null when not testing.
  let originalBeforePresets = null; // Complete original configuration saved before the first experiment.
  let diagnosticStored = false; // UI warning: true only when browser storage actually preserved the backup.
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
  function drawStage(id) {
    // Held gear/hands/feet are redrawn in the dedicated overlay; other categories belong to the world draw.
    return ['actor.hands', 'item.weapons', 'actor.feet'].includes(id) ? 'held' : 'world';
  }
  function editableLayers(stage = null) {
    // Linked weapons have no independently effective priority; pass filtering prevents no-op cross-pass moves.
    return describeLayers().filter(layer => effectiveLayerId(layer.id) === layer.id
        && (!stage || drawStage(layer.id) === stage))
      .map((layer, index) => ({ ...layer, position: index + 1,
        label: layer.id === 'actor.hands' && state['weapon.followHandLayer'] === 'on'
          ? 'Hands + held tools (linked)' : layer.label }));
  }
  function moveLayerInStage(id, beforeId) {
    const activeId = effectiveLayerId(id); // Keep world and overlay drawing orders from crossing a GPU pass boundary.
    const stage = drawStage(activeId);
    if (!editableLayers(stage).some(layer => layer.id === activeId)) return false;
    if (beforeId !== '__end') {
      if (!editableLayers(stage).some(layer => layer.id === effectiveLayerId(beforeId))) return false;
      return moveLayer(activeId, beforeId);
    }
    const other = editableLayers(stage).filter(layer => layer.id !== activeId);
    if (!other.length) return true;
    const last = other[other.length - 1].id;
    const anchor = drawOrder.slice(drawOrder.indexOf(last) + 1).find(key => key !== activeId && effectiveLayerId(key) === key) || '__end'; // Skip the moved entry and inactive linked weapon.
    return moveLayer(activeId, anchor);
  }
  function shiftLayerInStage(id, delta) {
    if (delta !== 1 && delta !== -1) return false;
    const activeId = effectiveLayerId(id); // A linked tool and its hand share the same stage position.
    const layers = editableLayers(drawStage(activeId));
    const index = layers.findIndex(layer => layer.id === activeId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= layers.length) return false;
    return moveLayerInStage(activeId, delta < 0 ? layers[target].id
      : layers[target + 1]?.id || '__end');
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

  // Each diagnostic experiment starts from shipped defaults: never layer one experiment over another.
  // These are controlled A/B probes, not claimed fixes; the observation tells us which mechanism to investigate.
  const DIAGNOSTIC_PRESETS = Object.freeze([
    {
      id: 'baseline', label: '0 · Repository baseline', rules: {},
      hypothesis: 'An old browser override or changed color order may be responsible.',
      changed: 'If this clears the artifact, one of your previous overrides was involved.',
      unchanged: 'If it persists, the problem occurs with shipped X-ray defaults.',
    },
    {
      id: 'front-mask-off', label: '1 · Enable owner front masks', // Preserve the historical ID so saved diagnostic sessions can still be restored.
      rules: { 'weapon.frontPlaneMask': 'on', 'hand.frontPlaneMask': 'off' },
      hypothesis: 'The optional owner-front portrait stencil may hide legitimate foreground weapon pixels.',
      changed: 'If weapon pixels disappear after enabling the stencil, the owner front-art mask is responsible.',
      unchanged: 'If weapon pixels remain unchanged, inspect stencil bits and masked gear counts or look for another occlusion source.',
    },
    {
      id: 'hands-always-masked', label: '2 · Force hands behind front art',
      rules: { 'weapon.frontPlaneMask': 'on', 'hand.frontPlaneMask': 'always' },
      hypothesis: 'The hand-behind-plane geometry test may be allowing fingers or outlines through.',
      changed: 'If fingers/ink disappear but gear does not, compare the hand and weapon stencil ownership.',
      unchanged: 'No difference may mean those parts were already masked, or never entered the eligible overlay.',
    },
    {
      id: 'legacy-horizon-depth', label: '3 · Allow original sky/depth occlusion',
      rules: { 'background.gearDepth': 'original', 'airborne.rebuildDepth': 'off' },
      hypothesis: 'Visual-only sky masks or distant cliffs may be mistaken for solid cover.',
      changed: 'If gear acquires cut-out sky/cliff shapes, background depth is participating incorrectly.',
      unchanged: 'No difference suggests the bad pixels come from another pass or these backdrops were not submitted.',
    },
    {
      id: 'no-airborne-rebuild', label: '4 · Disable jump-only depth rebuild',
      rules: { 'background.gearDepth': 'ignore', 'airborne.rebuildDepth': 'off' },
      hypothesis: 'When jumping, the ordinary held group may reuse a contaminated world depth buffer.',
      changed: 'If jumping gets worse, the airborne depth rebuild is preventing the horizon occlusion.',
      unchanged: 'If nothing changes while airborne, check whether the airborne rebuild counter normally increases.',
    },
    {
      id: 'nearby-actor-sort', label: '5 · Use old near-only actor order',
      rules: { 'actors.order': 'near' },
      hypothesis: 'Player/NPC depth sorting may give other characters the wrong stacking priority.',
      changed: 'If the problem changes only when crossing NPCs, actor ordering is involved.',
      unchanged: 'With no overlapping actors, no change is expected; test beside an NPC.',
    },
    {
      id: 'pants-not-ranked', label: '6 · Draw pants outside actor ordering',
      rules: { 'pants.sortWithActor': 'off' },
      hypothesis: 'A separate worn-garment mesh may be painting over the wrong portrait.',
      changed: 'If trousers or garments change but weapons do not, focus on garment sorting.',
      unchanged: 'This does not affect the weapon stencil; unchanged tools are expected.',
    },
    {
      id: 'tool-before-hand', label: '7 · Tools before hands in held pass',
      rules: { 'weapon.followHandLayer': 'off', 'layers.manualOrder': 'on' },
      layerProfile: 'before-hand',
      hypothesis: 'The tool/hand overlap may be an intra-overlay transparency sorting issue.',
      changed: 'If the tool moves behind the hand but not behind the portrait, it is a same-pass sort issue.',
      unchanged: 'No difference suggests an opacity bucket, physical depth or the front-art stencil dominates.',
    },
    {
      id: 'tool-after-hand', label: '8 · Tools after hands in held pass',
      rules: { 'weapon.followHandLayer': 'off', 'layers.manualOrder': 'on' },
      layerProfile: 'after-hand',
      hypothesis: 'The late tool/hand color order may be responsible rather than front masking.',
      changed: 'If overlap with hands reverses versus preset 7, transparent draw order is implicated.',
      unchanged: 'If both priorities look identical, the parts may be in distinct opacity buckets or depth-tested.',
    },
    {
      id: 'portrait-water-off', label: '9 · Disable portrait water tint',
      rules: { 'portrait.waterTint': 'off' },
      hypothesis: 'Water showing on a character portrait may resemble an X-ray of the held item.',
      changed: 'If only the character tint changes, the cause is portrait-water blending, not tool stencil.',
      unchanged: 'This changes portrait tint only, not held-tool water compositing.',
    },
  ]);
  const DIAGNOSTIC_BY_ID = new Map(DIAGNOSTIC_PRESETS.map(preset => [preset.id, preset])); // Validates picker/actions without string eval.

  function captureConfiguration() {
    const rules = {}; // Snapshot of every shipped rule so restoring cannot inherit newer experiment values.
    for (const key of keys) rules[key] = state[key];
    return { rules, drawOrder: drawOrder.slice(), stage: selectedStage, layer: selectedLayer };
  }
  function validConfiguration(snapshot) {
    return !!snapshot && typeof snapshot === 'object' && !!snapshot.rules
      && typeof snapshot.rules === 'object' && validDrawOrder(snapshot.drawOrder)
      && keys.every(key => RULES[key].options.includes(snapshot.rules[key])
        || (key === 'ground.showZone' && snapshot.rules[key] === undefined)) // Legacy pre-preset backups omit this new rule.
      && ['held', 'world'].includes(snapshot.stage)
      && DRAW_LAYER_IDS.has(snapshot.layer);
  }
  function applyConfiguration(snapshot) {
    if (!validConfiguration(snapshot)) return false; // Fully validate before mutating any live rules.
    for (const key of keys) set(key, snapshot.rules[key] ?? RULES[key].default);
    setDrawOrder(snapshot.drawOrder);
    selectedStage = snapshot.stage;
    selectedLayer = snapshot.layer;
    if (state['weapon.followHandLayer'] === 'on') selectedLayer = effectiveLayerId(selectedLayer);
    return true;
  }
  function presetConfiguration(id) {
    const preset = DIAGNOSTIC_BY_ID.get(id); // A tested preset is always reproducible from repository defaults.
    if (!preset) return null;
    const rules = {};
    for (const key of keys) rules[key] = key === 'ground.showZone' ? state[key] : RULES[key].default; // Debug visualization persists while trying render presets; it is not a compositing experiment.
    for (const [key, value] of Object.entries(preset.rules)) {
      if (!RULES[key]?.options.includes(value)) return null;
      rules[key] = value;
    }
    const order = DEFAULT_DRAW_ORDER.slice();
    if (preset.layerProfile) {
      const toolIndex = order.indexOf('item.weapons');
      order.splice(toolIndex, 1);
      const handIndex = order.indexOf('actor.hands');
      order.splice(handIndex + (preset.layerProfile === 'after-hand' ? 1 : 0), 0, 'item.weapons');
    }
    return { rules, drawOrder: order, stage: preset.layerProfile ? 'held' : selectedStage,
      layer: preset.layerProfile ? 'item.weapons' : selectedLayer };
  }
  function matchesConfiguration(snapshot) {
    return validConfiguration(snapshot)
      && keys.every(key => state[key] === (snapshot.rules[key] ?? RULES[key].default))
      && drawOrder.every((id, index) => id === snapshot.drawOrder[index]);
  }
  function persistDiagnosticSession() {
    try {
      if (originalBeforePresets && activePresetId) {
        localStorage.setItem(DIAGNOSTIC_KEY, JSON.stringify({
          version: 1, original: originalBeforePresets, active: activePresetId,
        }));
        diagnosticStored = true;
      } else {
        localStorage.removeItem(DIAGNOSTIC_KEY);
        diagnosticStored = false;
      }
    } catch (_) { diagnosticStored = false; /* A blocked browser store allows restoration only until reload. */ }
  }
  function discardDiagnosticSession() {
    originalBeforePresets = null;
    activePresetId = null;
    persistDiagnosticSession();
  }
  function loadDiagnosticSession() {
    try {
      const record = JSON.parse(localStorage.getItem(DIAGNOSTIC_KEY) || 'null');
      if (record?.version !== 1 || !DIAGNOSTIC_BY_ID.has(record.active)
          || !validConfiguration(record.original)) return;
      originalBeforePresets = record.original;
      activePresetId = record.active;
      selectedPresetId = record.active;
      diagnosticStored = true;
    } catch (_) { /* Never trust stale or partial browser data. */ }
  }
  function applyDiagnosticPreset(id) {
    const next = presetConfiguration(id);
    if (!next || !validConfiguration(next)) return false;
    const backup = originalBeforePresets || captureConfiguration(); // Retain the FIRST pre-test configuration when switching hypotheses.
    if (!applyConfiguration(next)) return false;
    originalBeforePresets = backup;
    activePresetId = id;
    selectedPresetId = id;
    persistDiagnosticSession();
    return true;
  }
  function restoreBeforePresets() {
    if (!originalBeforePresets || !validConfiguration(originalBeforePresets)) return false;
    const saved = originalBeforePresets;
    if (!applyConfiguration(saved)) return false;
    discardDiagnosticSession();
    selectedPresetId = 'baseline'; // Returning to the original state clears the pending experiment selection.
    return true;
  }
  function diagnosticReport() {
    const preset = DIAGNOSTIC_BY_ID.get(activePresetId);
    const live = window.HeldObjectRenderOrder?.snapshot?.() || {};
    const diagnostics = {};
    for (const field of ['stencilBits', 'frontPortraitMasks', 'frontPortraitGearCandidates',
      'frontPortraitMaskedGear', 'handsBehindFrontPlane', 'baseReplayCandidates',
      'baseOffscreenFiltered', 'registeredBackgroundDepthMeshes', 'airborneDepthRebuilds',
      'backgroundDepthMeshesExcluded', 'rankedPortraitActors', 'waterReplays',
      'selectiveOverlays', 'lastHeldFullscreenReason', 'heldOrderNormalizations',
      'lastHeldOrderNormalization', 'frontPortraitMaskReason', 'shoulderPetCompositor',
      'floorPunch', 'forcedGroundDepthMaterials', 'elevationShaderFallbacks', 'xrayTileRegions', 'xrayOrdinaryMeshes', 'baseElevationGroups']) {
      if (Object.prototype.hasOwnProperty.call(live, field)) diagnostics[field] = live[field];
    }
    return JSON.stringify({ xrayDiagnosis: {
      selectedPreset: selectedPresetId, activePreset: activePresetId,
      status: preset ? (matchesConfiguration(presetConfiguration(preset.id)) ? 'applied' : 'modified after apply') : 'no active preset',
      hypothesis: preset?.hypothesis || null, ifChanged: preset?.changed || null,
      ifUnchanged: preset?.unchanged || null,
      stencilAndReplay: diagnostics, browserBackupAvailable: !!originalBeforePresets,
    }, xrayHierarchy: {
      version: VERSION, effective: captureConfiguration().rules,
      drawOrder: drawOrder.slice(), changes: diff(),
    } }, null, 2);
  }

  const keys = Object.keys(RULES).sort((a, b) => RULES[a].order - RULES[b].order);
  const state = {};
  const listeners = new Set();
  let groundZoneMarker = null; // Lazily created filled 3D debug circle; reused every frame.
  let groundZoneScene = null; // Scene which owns the temporary debug preview.

  function updateGroundZone(scene, scope, radius) {
    if (state['ground.showZone'] !== 'on' || !scene?.isScene
        || !scope || !Number.isFinite(scope.x) || !Number.isFinite(scope.z)
        || !Number.isFinite(scope.elevation) || !(radius > 0)) {
      if (groundZoneScene && groundZoneMarker) groundZoneScene.remove(groundZoneMarker);
      groundZoneScene = null;
      return false;
    }
    const THREE = window.THREE;
    if (!THREE?.CircleGeometry || !THREE?.RingGeometry || !THREE?.Group) return false;
    if (!groundZoneMarker || groundZoneMarker.userData.radius !== radius) {
      if (groundZoneScene && groundZoneMarker) groundZoneScene.remove(groundZoneMarker);
      if (groundZoneMarker) groundZoneMarker.traverse(node => {
        node.geometry?.dispose?.();
        node.material?.dispose?.();
      });
      groundZoneScene = null;
      groundZoneMarker = new THREE.Group();
      groundZoneMarker.name = 'debug_ground_xray_circle';
      groundZoneMarker.userData.radius = radius; // Match the renderer's exact radius.
      const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 64),
        new THREE.MeshBasicMaterial({ color: 0x31bdec, transparent: true, opacity: 0.15,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      const rim = new THREE.Mesh(new THREE.RingGeometry(radius - 0.028, radius + 0.028, 64),
        new THREE.MeshBasicMaterial({ color: 0x0ce6fa, transparent: true, opacity: 0.9,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      for (const [mesh, order] of [[fill, 960], [rim, 961]]) {
        mesh.rotation.x = -Math.PI / 2; // Flat on the actual world X/Z plane.
        mesh.renderOrder = order; // Visible debug overlay, deliberately not physical depth.
        mesh.userData.noOutline = true; // Debug art never acquires a generated outline; depthWrite:false already makes it replay-inert.
        mesh.frustumCulled = false;
        groundZoneMarker.add(mesh);
      }
    }
    if (groundZoneScene !== scene) {
      groundZoneScene?.remove(groundZoneMarker);
      scene.add(groundZoneMarker);
      groundZoneScene = scene;
    }
    groundZoneMarker.position.set(scope.x, scope.elevation + 0.025, scope.z);
    return true;
  }

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
    if (key === 'ground.showZone' && value === 'off') updateGroundZone(null, null, 0); // Remove the scene marker immediately, even if gameplay is paused.
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
    if (key === null) discardDiagnosticSession(); // A full reset ends any diagnostic experiment and its backup.
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
  loadDiagnosticSession(); // Restore the original-before-presets backup after mobile refreshes.

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
        const selectedPreset = DIAGNOSTIC_BY_ID.get(selectedPresetId);
        const activePreset = DIAGNOSTIC_BY_ID.get(activePresetId);
        const presetUnmodified = !!activePreset && matchesConfiguration(presetConfiguration(activePreset.id));
        const layers = editableLayers(selectedStage);
        if (!layers.some(layer => layer.id === selectedLayer)) selectedLayer = layers[0]?.id || 'actor.hands';
        const activeLayer = layers.find(layer => layer.id === selectedLayer) || layers[0];
        const linked = state['weapon.followHandLayer'] === 'on';
        const stencil = Number(live.stencilBits || 0);
        const intended = Number(live.frontPortraitGearCandidates || 0);
        const masked = Number(live.frontPortraitMaskedGear || 0);
        const maskStatus = stencil < 8 ? 'Unavailable: ' + stencil + '-bit stencil target (needs 8)'
          : masked + ' / ' + intended + ' gear parts assigned owner masks (not a pixel count)';
        const frontPriority = state['weapon.frontPlaneMask'] === 'on'
          ? 'Mask enabled: holder front art covers gear'
          : 'Mask disabled (default): owner front art does not stencil gear';
        return {
          summary: (activePreset ? 'experiment · ' : '') +
            (changes ? changes + ' override' + (changes === 1 ? '' : 's') : 'repository defaults'),
          rows: [
            ['Active experiment', activePreset
              ? activePreset.label + (presetUnmodified ? ' (applied)' : ' (modified manually)')
              : 'None — current settings are not a preset'],
            ['Selected next experiment', selectedPreset
              ? selectedPreset.label + (selectedPresetId === activePresetId ? ' (active)' : ' (not yet applied)')
              : 'None'],
            ['Original settings', !originalBeforePresets ? 'No active experiment'
              : diagnosticStored ? 'Saved in browser; survives reload' : 'In memory only; storage blocked, restore before reload'],
            ['Testing', activePreset?.hypothesis || 'Apply a preset to begin an A/B test.'],
            ['If appearance changes', activePreset?.changed || 'Apply a preset first.'],
            ['If nothing changes', activePreset?.unchanged || 'Apply a preset first.'],
            ...(selectedPresetId !== activePresetId && selectedPreset
              ? [['Next test hypothesis', selectedPreset.hypothesis]] : []),
            ['Render model', 'World → held/foot depth replay → water tint; outlines separate'],
            ['Ground X-ray zone', 'World-space filled circle, radius 1.5 tiles; ' + (state['ground.showZone'] === 'on' ? 'debug visible' : 'debug hidden')],
            ['Ground depth overrides (last replay)', String(live.forcedGroundDepthMaterials ?? '-')],
            ['Ordinary held parts', String(live.xrayOrdinaryMeshes ?? '-')],
            ['Ground shader fallbacks', String(live.elevationShaderFallbacks ?? '-')],
            ['Stencil floor punch', live.floorPunch?.enabled === false ? 'Disabled (full depth rebuild)' : 'Allowed if snapshot available'],
            ['Floor punch calls / fallbacks', String(live.floorPunch?.punches ?? '-') + ' / ' + String(live.floorPunch?.fallbacks ?? '-')],
            ['Tool/hand priority', linked ? 'Linked: one effective rank' : 'Independent ranks'],
            ['Held renderOrder overrides', String(live.heldOrderNormalizations ?? '-') + ' automatic normalizations'],
            ['Last held order override', live.lastHeldOrderNormalization
              ? live.lastHeldOrderNormalization.mesh + ': ' + live.lastHeldOrderNormalization.from + ' → ' + live.lastHeldOrderNormalization.to
              : 'None recorded'],
            ['Tool vs its own front art', frontPriority],
            ['Shoulder pet compositor', live.shoulderPetCompositor?.active
              ? (live.shoulderPetCompositor.mode === 'geometric-depth' ? 'Geometric depth · shoulder x-ray off' : live.shoulderPetCompositor.mode + ' · from front ' + (live.shoulderPetCompositor.frontForeground ? 'above' : 'behind') + ' · from rear ' + (live.shoulderPetCompositor.backForeground ? 'above' : 'behind'))
              : 'No active shoulder pet'],
            ['Front mask stencil', maskStatus],
            ['Front mask pass status', String(live.frontPortraitMaskReason ?? '-')],
            ['Visible front portraits', String(live.frontPortraitMasks ?? '-')],
            ['Hands masked by front art', String(live.handsBehindFrontPlane ?? '-')],
            ['Airborne depth rebuilds / backdrop exclusions',
              String(live.airborneDepthRebuilds ?? '-') + ' / ' + String(live.backgroundDepthMeshesExcluded ?? '-')],
          ],
          note: 'Test the SAME camera, pose and scene with Repository baseline, then one suspected cause. Presets replace all X-ray rules and ranks with a reproducible test setup; they do not stack. Restore pre-test settings when finished. The stencil, physical depth, water and outline passes remain independent of same-pass visual ordering. Reserved pose-synchronization and late-overlay render orders are protected from manual rank changes.',
          actions: [
            { id: 'focus-preset', label: 'Possible explanation to test', value: selectedPresetId,
              options: DIAGNOSTIC_PRESETS.map(preset => ({ value: preset.id, label: preset.label })),
              group: 'Diagnostic presets' },
            { id: 'apply-preset', label: 'Apply selected experiment', group: 'Diagnostic presets',
              title: 'Resets only X-ray controls to repository defaults plus the selected experiment. Your original settings are saved and can be restored.' },
            ...(originalBeforePresets ? [
              { id: 'restore-original', label: 'Restore my pre-test settings', group: 'Diagnostic presets',
                confirm: 'Restore the X-ray rules and layer order saved before the FIRST experiment, and end this diagnostic session?' },
            ] : []),
            { id: 'report', label: '📋 Copy mobile diagnostic report', group: 'Diagnostic presets',
              title: 'Copies the current experiment, hypothesis, applicable counters and all X-ray settings.' },
            { id: 'set', args: { key: 'weapon.frontPlaneMask' }, label: 'Held tools behind owner front art',
              value: state['weapon.frontPlaneMask'], options: RULES['weapon.frontPlaneMask'].options.map(value => ({ value, label: value })),
              group: 'Front portrait occlusion', title: RULES['weapon.frontPlaneMask'].help },
            { id: 'set', args: { key: 'hand.frontPlaneMask' }, label: 'Hands vs owner front art',
              value: state['hand.frontPlaneMask'], options: RULES['hand.frontPlaneMask'].options.map(value => ({ value, label: value })),
              group: 'Front portrait occlusion', title: RULES['hand.frontPlaneMask'].help },
            { id: 'toggle-ground-zone', label: 'Show ground X-ray circle in the world', checkbox: true,
               checked: state['ground.showZone'] === 'on', group: 'World depth and airborne replay', title: RULES['ground.showZone'].help },
            { id: 'toggle-floor-punch', label: 'Use stencil floor punch (A/B test)', checkbox: true,
               checked: live.floorPunch?.enabled !== false, group: 'World depth and airborne replay',
               title: 'On: local stencil floor reset; off: full depth rebuild. Test the same weapon and ground without changing other settings.' },
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
            { id: 'set', args: { key: 'baby.carrierForeground' }, label: RULES['baby.carrierForeground'].label,
              value: state['baby.carrierForeground'], options: RULES['baby.carrierForeground'].options.map(value => ({ value, label: value })),
              group: 'Actor stacking', title: RULES['baby.carrierForeground'].help },
            { id: 'set', args: { key: 'layers.manualOrder' }, label: 'Use custom same-pass color order',
              value: state['layers.manualOrder'], options: RULES['layers.manualOrder'].options.map(value => ({ value, label: value })),
              group: 'Same-pass draw priority', title: RULES['layers.manualOrder'].help },
            { id: 'set', args: { key: 'weapon.followHandLayer' }, label: 'Tools follow the hands',
              value: state['weapon.followHandLayer'], options: RULES['weapon.followHandLayer'].options.map(value => ({ value, label: value })),
              group: 'Same-pass draw priority', title: RULES['weapon.followHandLayer'].help },
            { id: 'focus-stage', label: 'Render stage', value: selectedStage,
              options: [
                { value: 'held', label: 'Held overlay — hands, tools and feet' },
                { value: 'world', label: 'World color — opaque / transparent' },
              ],
              group: 'Same-pass draw priority' },
            { id: 'focus-layer', label: 'Part to move in this stage', value: activeLayer.id,
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
              confirm: 'Reset ALL X-ray rules and ranks to repo defaults, and DELETE the saved pre-experiment backup? Use Restore my pre-test settings first if you want them back. This does not reset the game save.' },
          ],
        };
      },
      onAction: (action, args = {}) => {
        if (action === 'focus-preset') {
          if (!DIAGNOSTIC_BY_ID.has(args.value)) return { ok: false, error: 'Unknown experiment.' };
          selectedPresetId = args.value;
          return { ok: true };
        }
        if (action === 'apply-preset') return applyDiagnosticPreset(selectedPresetId)
          ? { ok: true } : { ok: false, error: 'Experiment could not be applied.' };
        if (action === 'restore-original') return restoreBeforePresets()
          ? { ok: true } : { ok: false, error: 'No valid pre-test configuration to restore.' };
        if (action === 'report') return { ok: true, title: 'X-ray diagnosis (mobile)', text: diagnosticReport() };
        if (action === 'toggle-ground-zone') return set('ground.showZone', args.checked === true ? 'on' : 'off')
          ? { ok: true } : { ok: false, error: 'Could not toggle zone preview.' };
        if (action === 'toggle-floor-punch') {
          const enabled = window.HeldObjectRenderOrder?.setFloorPunchEnabled?.(args.checked === true);
          return typeof enabled === 'boolean' ? { ok: true } : { ok: false, error: 'Floor punch controller unavailable.' };
        }
        if (action === 'set') {
          const ok = set(String(args.key || ''), String(args.value ?? ''));
          if (ok && args.key === 'weapon.followHandLayer' && args.value === 'on') selectedLayer = effectiveLayerId(selectedLayer);
          return ok ? { ok: true } : { ok: false, error: 'Unknown rule or value.' };
        }
        if (action === 'focus-stage') {
          if (!['held', 'world'].includes(args.value)) return { ok: false, error: 'Unknown render stage.' };
          selectedStage = args.value;
          selectedLayer = editableLayers(selectedStage)[0]?.id || 'actor.hands';
          return { ok: true };
        }
        if (action === 'focus-layer') {
          if (!editableLayers(selectedStage).some(layer => layer.id === args.value)) return { ok: false, error: 'Unknown or currently linked layer.' };
          selectedLayer = args.value;
          return { ok: true };
        }
        if (action === 'shift' || action === 'move-before') {
          const valid = action === 'shift'
            ? shiftLayerInStage(selectedLayer, args.delta)
            : moveLayerInStage(selectedLayer, args.value);
          if (!valid) return { ok: false, error: 'Invalid move or cross-pass destination.' };
          set('layers.manualOrder', 'on'); // Activate same-pass sorting when a position changes.
          return { ok: true };
        }
        if (action === 'reset') {
          window.HeldObjectRenderOrder?.setFloorPunchEnabled?.(true); // Restore the renderer's default experiment state too.
          reset();
          selectedStage = 'held'; // Reopen the common equipment stage after a full reset.
          selectedLayer = 'actor.hands'; // Make the newly restored, linked position visible.
          selectedPresetId = 'baseline'; // A reset cannot leave a stale experiment highlighted as if it had run.
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
    get, set, reset, diff, exportDiff, importDiff, describe, registerPanel, updateGroundZone,
    DIAGNOSTIC_PRESETS, applyDiagnosticPreset, restoreBeforePresets, diagnosticReport,
    DRAW_LAYERS, DEFAULT_DRAW_ORDER, describeLayers, drawStage, editableLayers, effectiveLayerId, layerRank, setDrawOrder, moveLayer, shiftLayer, moveLayerInStage, shiftLayerInStage, resetDrawOrder,
    onChange(listener) { if (typeof listener === 'function') listeners.add(listener); return () => listeners.delete(listener); },
  };
  registerPanel();
})();
