// Ruin pattern surface rules: which repeated ruin pieces get random engravings,
// at what tile scale, and how large their atlases may be.
//
// FurniturePatternSurfaces.decorateRuin() asks resolve(mesh, root) for every
// structural mesh it would engrave. A "type" is one repeated piece part
// (e.g. "pillar_square › Square Tapered Shaft"), never one instance, so a rule
// applies to every copy of that part in every ruin.
//
// Sources, later wins per key:
//   docs/config/patterns/ruin-surface-rules.json   repo defaults
//   localStorage hobunjiRuinPatternRules.v1         Dev Companion edits
// The Dev Companion "Ruin surface patterns" panel lists the live ruin's types,
// toggles/scales them, re-decorates the ruin immediately, and exports the
// merged JSON for committing back into the repo file.
//
// Per-piece scale authored in the Furniture Author (part.patternScale) is read
// from the piece JSON the V50 generator built the mesh from; a rule scale set
// here overrides it.
(() => {
  'use strict';
  const CONFIG_PATH = 'config/patterns/ruin-surface-rules.json';
  const LOCAL_KEY = 'hobunjiRuinPatternRules.v1';
  const PIECE_DIRS = ['assets/models/furniture/data/', 'config/furniture-authored/']; // Same folders the V50 generator reads repo furniture from.
  const DEFAULTS = { minSurfaceTiles: .25, maxAtlasPx: 512, tilePx: 256, defaultScale: 1.5 };
  const SCALE_STEPS = [.5, .75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6];

  let repo = { rules: {} };
  let local = readLocal();
  const pieceParts = new Map(); // piece id -> Map(part name -> part) | null (missing)
  const ready = fetch(CONFIG_PATH).then(response => response.ok ? response.json() : null).then(data => { if (data && typeof data === 'object') repo = { ...data, rules: { ...(data.rules || {}) } }; }).catch(() => {});

  function readLocal() {
    try { const data = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); return data && typeof data === 'object' ? { ...data, rules: { ...(data.rules || {}) } } : { rules: {} }; }
    catch (_) { return { rules: {} }; }
  }
  function writeLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (_) {}
  }

  function setting(name) {
    const value = local[name] ?? repo[name];
    return Number.isFinite(Number(value)) ? Number(value) : DEFAULTS[name];
  }
  function ruleFor(key) { return { ...(repo.rules[key] || {}), ...(local.rules[key] || {}) }; }

  // Repeated-piece identity for a mesh: the V50 repo furniture piece (group
  // "repo_furniture_<id>") or authored furniture key, plus the part name.
  // Plain generated meshes (walls) drop their per-instance index suffixes.
  function identify(mesh, root) {
    let piece = '', context = '';
    for (let node = mesh; node && node !== root; node = node.parent) {
      const name = String(node.name || '');
      if (!piece && name.startsWith('repo_furniture_')) piece = name.slice('repo_furniture_'.length);
      if (!piece && node.userData?.authoredFurnitureKey) piece = String(node.userData.authoredFurnitureKey);
      if (!context && node.userData?.interiorRuinRole) context = String(node.userData.interiorRuinRole);
    }
    const authored = mesh.userData?.authoredPart;
    let part = authored?.name || authored?.id || String(mesh.name || 'mesh');
    if (!piece) part = part.replace(/(_[a-z]{1,2})?(_\d+)+$/i, '') || part; // ruin_wall_wn_0 -> ruin_wall
    const key = piece ? `${piece} › ${part}` : part;
    return { key, piece, part, context };
  }

  function resolve(mesh, root) {
    const { key, piece, part, context } = identify(mesh, root);
    const rule = ruleFor(key);
    const partData = piece ? pieceParts.get(piece)?.get(part) : null;
    const partScale = Number(partData?.patternScale) > 0 ? Number(partData.patternScale) : null;
    return {
      key, label: key, context,
      enabled: rule.enabled !== false,
      scale: Number(rule.scale) > 0 ? Number(rule.scale) : null,
      partScale,
      maxAtlasPx: setting('maxAtlasPx'),
      minSurfaceTiles: setting('minSurfaceTiles'),
      tilePx: setting('tilePx'),
    };
  }

  // Loads the piece JSON for every repo piece in a ruin so per-part Furniture
  // Author settings (patternScale) are known before the synchronous decorate.
  async function preloadPieces(root) {
    const ids = new Set();
    root?.traverse?.(node => { const name = String(node.name || ''); if (name.startsWith('repo_furniture_')) ids.add(name.slice('repo_furniture_'.length)); });
    await Promise.all([...ids].filter(id => !pieceParts.has(id)).map(async id => {
      pieceParts.set(id, null);
      for (const dir of PIECE_DIRS) {
        try {
          const response = await fetch(`${dir}${encodeURIComponent(id)}.json`);
          if (!response.ok) continue;
          const data = await response.json();
          const parts = Array.isArray(data) ? data : data?.parts;
          if (!Array.isArray(parts)) continue;
          pieceParts.set(id, new Map(parts.map(entry => [String(entry?.name || entry?.id || ''), entry])));
          return;
        } catch (_) {}
      }
    }));
  }

  function currentRoot() {
    return window.DevRandomRuin?.getRuntimeContext?.()?.root || null;
  }

  function redecorate() {
    const root = currentRoot();
    if (!root || root.userData?.ruinPatternSeed == null) return { ok: false, error: 'No decorated ruin is loaded.' };
    window.FurniturePatternSurfaces?.decorateRuin?.(root, root.userData.ruinPatternSeed);
    statsCache = null;
    return { ok: true };
  }

  function editRule(key, patch) {
    const next = { ...(local.rules[key] || {}), ...patch };
    for (const [name, value] of Object.entries(next)) if (value === undefined) delete next[name];
    if (Object.keys(next).length) local.rules[key] = next; else delete local.rules[key];
    writeLocal();
  }

  function mergedConfig() {
    const rules = {};
    for (const key of new Set([...Object.keys(repo.rules), ...Object.keys(local.rules)])) {
      const rule = ruleFor(key);
      if (rule.enabled !== false) delete rule.enabled;
      if (Object.keys(rule).length) rules[key] = rule;
    }
    return { schema: 'hobunji_ruin_pattern_surface_rules.v1', minSurfaceTiles: setting('minSurfaceTiles'), maxAtlasPx: setting('maxAtlasPx'), tilePx: setting('tilePx'), rules: Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))) };
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(mergedConfig(), null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'ruin-surface-rules.json';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  }

  let statsCache = null, statsAt = 0; // Panel render runs at the companion poll rate; overlay stats refresh at most once a second.
  function stats(root) {
    const now = performance.now();
    if (statsCache && statsCache.root === root && now - statsAt < 1000) return statsCache;
    const overlays = (root.userData.ruinPatternOverlays || []).filter(overlay => overlay.parent);
    const textures = new Set(); let pixels = 0, loading = 0;
    for (const overlay of overlays) {
      const map = overlay.material?.map;
      if (!map) { loading++; continue; }
      if (textures.has(map)) continue;
      textures.add(map); pixels += (map.image?.width || 0) * (map.image?.height || 0);
    }
    statsCache = { root, overlays: overlays.length, textures: textures.size, megapixels: pixels / 1e6, loading };
    statsAt = now;
    return statsCache;
  }

  function stepScale(current, direction) {
    if (direction > 0) return SCALE_STEPS.find(step => step > current + 1e-6) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
    return [...SCALE_STEPS].reverse().find(step => step < current - 1e-6) ?? SCALE_STEPS[0];
  }
  // Local value that turns a type on/off even when the repo file disagrees.
  function enabledPatch(key, enabled) {
    return { enabled: enabled ? (repo.rules[key]?.enabled === false ? true : undefined) : false };
  }

  function registerPanel() {
    const companion = window.DevCompanion;
    if (!companion?.registerPanel) return;
    companion.registerPanel({
      id: 'ruin-patterns',
      title: '🏛️ Ruin surface patterns',
      order: 40,
      when: () => !!currentRoot()?.userData?.ruinPatternTypes,
      render: () => {
        const root = currentRoot(), types = [...root.userData.ruinPatternTypes.values()].sort((a, b) => a.label.localeCompare(b.label));
        const s = stats(root), maxAtlasPx = setting('maxAtlasPx'), minSurfaceTiles = setting('minSurfaceTiles'), tilePx = setting('tilePx');
        const actions = [
          { id: 'all', label: 'All on', args: { enabled: true }, group: 'All types' },
          { id: 'all', label: 'All off', args: { enabled: false }, group: 'All types' },
          ...[256, 512, 1024].map(px => ({ id: 'setting', label: `${px}px`, args: { name: 'maxAtlasPx', value: px }, active: maxAtlasPx === px, group: 'Atlas max', title: 'Longest edge of one surface\'s pattern texture.' })),
          ...[96, 128, 192, 256].map(px => ({ id: 'setting', label: `${px}px`, args: { name: 'tilePx', value: px }, active: tilePx === px, group: 'Pixels per tile', title: 'Texture resolution of one pattern tile; lower is softer but cheaper.' })),
          ...[0, .25, .5, 1].map(tiles => ({ id: 'setting', label: tiles ? `<${tiles} tile` : 'off', args: { name: 'minSurfaceTiles', value: tiles }, active: minSurfaceTiles === tiles, group: 'Skip slivers', title: 'Skip surfaces thinner than this many pattern tiles.' })),
          { id: 'export', label: 'Export JSON', group: 'Rules', title: `Downloads ruin-surface-rules.json — commit it as docs/${CONFIG_PATH}.` },
          { id: 'clear', label: 'Clear local edits', group: 'Rules', confirm: 'Drop all Dev Companion pattern rule edits and go back to the repo file?' },
        ];
        for (const type of types) {
          const rule = ruleFor(type.key), edited = !!local.rules[type.key];
          const scale = Number(rule.scale) > 0 ? Number(rule.scale) : null;
          const effective = scale ?? type.partScale ?? setting('defaultScale');
          const group = `${type.label} · ${type.meshes}×${type.contexts.size ? ` (${[...type.contexts].join(', ')})` : ''} · ${type.overlays} drawn · tile ${effective}${scale ? '' : type.partScale ? ' (piece)' : ' (default)'}`;
          actions.push(
            { id: 'toggle', label: rule.enabled === false ? 'Off' : 'Patterned', args: { key: type.key }, active: rule.enabled !== false, group },
            { id: 'scale', label: '− tile', args: { key: type.key, direction: -1, from: effective }, group },
            { id: 'scale', label: '+ tile', args: { key: type.key, direction: 1, from: effective }, group },
          );
          if (edited) actions.push({ id: 'reset', label: '↺', title: 'Drop this type\'s local edits.', args: { key: type.key }, group });
        }
        return {
          summary: `${types.filter(type => ruleFor(type.key).enabled !== false).length}/${types.length} types · ${s.overlays} overlays · ${s.textures} textures · ${s.megapixels.toFixed(1)} MP${s.loading ? ` · ${s.loading} loading` : ''}`,
          note: `Edits apply to this ruin immediately and to every later ruin. Local edits: ${Object.keys(local.rules).length}. Export JSON and commit it as docs/${CONFIG_PATH} to keep them.`,
          actions,
        };
      },
      onAction: (action, args) => {
        if (action === 'export') return exportJson();
        if (action === 'clear') { local = { rules: {} }; writeLocal(); return redecorate(); }
        if (action === 'setting') return setSetting(args.name, args.value);
        if (action === 'all') {
          for (const type of currentRoot()?.userData?.ruinPatternTypes?.values() || []) editRule(type.key, enabledPatch(type.key, !!args.enabled));
          return redecorate();
        }
        const key = String(args.key || '');
        if (!key) return { ok: false, error: 'No surface type.' };
        if (action === 'toggle') editRule(key, enabledPatch(key, ruleFor(key).enabled === false));
        else if (action === 'scale') editRule(key, { scale: stepScale(Number(args.from) || setting('defaultScale'), Number(args.direction) || 1) });
        else if (action === 'reset') { delete local.rules[key]; writeLocal(); }
        else return { ok: false, error: `Unknown action ${action}.` };
        return redecorate();
      },
    });
  }

  registerPanel();
  // setRule(key, { enabled?, scale? }) is the console/test equivalent of the panel buttons.
  function setRule(key, patch = {}) {
    editRule(String(key), { ...('enabled' in patch ? enabledPatch(String(key), patch.enabled !== false) : {}), ...('scale' in patch ? { scale: Number(patch.scale) > 0 ? Number(patch.scale) : undefined } : {}) });
    return redecorate();
  }
  function setSetting(name, value) {
    if (!(name in DEFAULTS) || name === 'defaultScale') return { ok: false, error: `Unknown setting ${name}.` };
    local[name] = Number(value); writeLocal();
    return redecorate();
  }
  window.RuinPatternSurfaceRules = { ready, resolve, identify, preloadPieces, redecorate, setRule, setSetting, mergedConfig, exportJson, stepScale };
})();
