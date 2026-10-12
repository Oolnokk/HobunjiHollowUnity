// Ruin pattern surface rules: which repeated ruin pieces get random engravings,
// at what tile scale, and how large their atlases may be.
//
// FurniturePatternSurfaces.decorateRuin() asks resolve(mesh, root) for every
// structural mesh it would engrave. A "type" is one repeated piece part
// (e.g. "pillar_square › Square Tapered Shaft"), never one instance, so a rule
// applies to every copy of that part in every ruin.
//
// Every mesh in the ruin gets a type. A type with no explicit rule is patterned
// only when its key matches defaultEnabledPattern (default "wall|shaft").
//
// Sources, later wins per key:
//   docs/config/patterns/ruin-surface-rules.json   repo defaults
//   localStorage hobunjiRuinPatternRules.v1         applied Dev Companion edits
// The Dev Companion "Ruin surface patterns" panel lists the live ruin's types.
// Its edits are staged in a draft until "Apply settings" (or, with "Live
// update" switched on, applied on every click); Export JSON writes the merged
// rules for committing back into the repo file.
//
// Per-piece scale authored in the Furniture Author (part.patternScale) is read
// from the piece JSON the V50 generator built the mesh from; a rule scale set
// here overrides it.
(() => {
  'use strict';
  const CONFIG_PATH = 'config/patterns/ruin-surface-rules.json';
  const LOCAL_KEY = 'hobunjiRuinPatternRules.v1';
  const LIVE_KEY = 'hobunjiRuinPatternRules.live.v1';
  const PIECE_DIRS = ['assets/models/furniture/data/', 'config/furniture-authored/']; // Same folders the V50 generator reads repo furniture from.
  const DEFAULTS = { minSurfaceTiles: .25, maxAtlasPx: 512, tilePx: 256, defaultScale: 4, defaultEnabledPattern: 'wall|shaft' };
  const SCALE_STEPS = [.5, .75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
  const ALL_SCALES = [1, 1.5, 2, 3, 4, 6];

  let repo = { rules: {} };
  let local = readLocal(); // Applied edits (what the ruin currently shows).
  let draft = clone(local); // Staged panel edits.
  let live = readLive();
  const pieceParts = new Map(); // piece id -> Map(part name -> part) | null (missing)
  const ready = fetch(CONFIG_PATH).then(response => response.ok ? response.json() : null).then(data => { if (data && typeof data === 'object') repo = { ...data, rules: { ...(data.rules || {}) } }; }).catch(() => {});

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function readLocal() {
    try { const data = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); return data && typeof data === 'object' ? { ...data, rules: { ...(data.rules || {}) } } : { rules: {} }; }
    catch (_) { return { rules: {} }; }
  }
  function readLive() { try { return localStorage.getItem(LIVE_KEY) === '1'; } catch (_) { return false; } }
  function writeLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); localStorage.setItem(LIVE_KEY, live ? '1' : '0'); } catch (_) {}
  }

  function setting(name, source = local) {
    const value = source[name] ?? repo[name];
    if (name === 'defaultEnabledPattern') return typeof value === 'string' ? value : DEFAULTS[name];
    return Number.isFinite(Number(value)) ? Number(value) : DEFAULTS[name];
  }
  function ruleFor(key, source = local) { return { ...(repo.rules[key] || {}), ...(source.rules[key] || {}) }; }
  function defaultEnabled(key, source = local) {
    const pattern = setting('defaultEnabledPattern', source);
    try { return pattern ? new RegExp(pattern, 'i').test(key) : true; } catch (_) { return true; }
  }
  function isEnabled(key, source = local) {
    const rule = ruleFor(key, source);
    return typeof rule.enabled === 'boolean' ? rule.enabled : defaultEnabled(key, source);
  }

  // Repeated-piece identity for a mesh: the V50 repo furniture piece (group
  // "repo_furniture_<id>") or authored furniture key, plus the part name.
  // Plain generated meshes (walls) drop their per-instance index suffixes;
  // unnamed meshes are named after their nearest named ancestor.
  function identify(mesh, root) {
    let piece = '', context = '', owner = '';
    for (let node = mesh; node && node !== root; node = node.parent) {
      const name = String(node.name || '');
      if (!piece && name.startsWith('repo_furniture_')) piece = name.slice('repo_furniture_'.length);
      if (!piece && node.userData?.authoredFurnitureKey) piece = String(node.userData.authoredFurnitureKey);
      if (!context && node.userData?.interiorRuinRole) context = String(node.userData.interiorRuinRole);
      if (!owner && node !== mesh && name) owner = name;
    }
    const authored = mesh.userData?.authoredPart;
    let part = authored?.name || authored?.id || String(mesh.name || '') || `${owner || context || 'unnamed'} (part)`;
    if (!piece) part = part.replace(/(_[a-z]{1,2})?(_\d+)+$/i, '').replace(/_\d+(?= \(part\))/, '') || part; // ruin_wall_wn_0 -> ruin_wall
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
      enabled: isEnabled(key),
      scale: Number(rule.scale) > 0 ? Number(rule.scale) : null,
      partScale,
      defaultScale: setting('defaultScale'),
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

  // Draft edits; apply() makes them the ruin's live rules.
  function editRule(key, patch) {
    const next = { ...(draft.rules[key] || {}), ...patch };
    for (const [name, value] of Object.entries(next)) if (value === undefined) delete next[name];
    if (Object.keys(next).length) draft.rules[key] = next; else delete draft.rules[key];
  }
  // Stores an explicit on/off only when it differs from what the repo file + default already give.
  function enabledPatch(key, enabled) {
    const base = typeof repo.rules[key]?.enabled === 'boolean' ? repo.rules[key].enabled : defaultEnabled(key, draft);
    return { enabled: enabled === base ? undefined : enabled };
  }
  function dirty() { return JSON.stringify(draft) !== JSON.stringify(local); }
  function apply() {
    local = clone(draft); writeLocal();
    return redecorate();
  }
  function edited() { return live ? apply() : { ok: true, staged: true }; }

  function mergedConfig() {
    const rules = {};
    for (const key of new Set([...Object.keys(repo.rules), ...Object.keys(local.rules)])) {
      const rule = ruleFor(key);
      if (typeof rule.enabled === 'boolean' && rule.enabled === defaultEnabled(key)) delete rule.enabled;
      if (Object.keys(rule).length) rules[key] = rule;
    }
    return { schema: 'hobunji_ruin_pattern_surface_rules.v1', defaultEnabledPattern: setting('defaultEnabledPattern'), defaultScale: setting('defaultScale'), minSurfaceTiles: setting('minSurfaceTiles'), maxAtlasPx: setting('maxAtlasPx'), tilePx: setting('tilePx'), rules: Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))) };
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

  function registerPanel() {
    const companion = window.DevCompanion;
    if (!companion?.registerPanel) return;
    companion.registerPanel({
      id: 'ruin-patterns',
      title: '🏛️ Ruin surface patterns',
      order: 40,
      when: () => !!currentRoot()?.userData?.ruinPatternTypes,
      render: () => {
        const root = currentRoot(), types = [...root.userData.ruinPatternTypes.values()];
        const on = type => isEnabled(type.key, draft);
        types.sort((a, b) => (on(b) - on(a)) || a.label.localeCompare(b.label)); // Patterned types first.
        const s = stats(root), get = name => setting(name, draft), pending = dirty();
        const actions = [
          { id: 'apply', label: pending ? '✔ Apply settings' : 'Applied', active: pending, group: 'Changes', title: 'Re-pattern this ruin with the staged settings.' },
          { id: 'discard', label: 'Discard', group: 'Changes', title: 'Drop staged settings that were not applied.' },
          { id: 'live', label: live ? '☑ Live update' : '☐ Live update', active: live, group: 'Changes', title: 'Apply every click immediately.' },
          { id: 'all', label: 'All on', args: { enabled: true }, group: 'All types' },
          { id: 'all', label: 'All off', args: { enabled: false }, group: 'All types' },
          { id: 'all', label: 'Only wall/shaft', args: { reset: true }, group: 'All types', title: 'Drop per-type on/off edits and go back to the default name filter.' },
          ...ALL_SCALES.map(scale => ({ id: 'scale-all', label: `${scale}`, args: { scale }, active: get('defaultScale') === scale, group: 'Tile for all', title: 'Sets every type to this tile size (clears per-type sizes).' })),
          ...[256, 512, 1024].map(px => ({ id: 'setting', label: `${px}px`, args: { name: 'maxAtlasPx', value: px }, active: get('maxAtlasPx') === px, group: 'Atlas max', title: 'Longest edge of one surface\'s pattern texture.' })),
          ...[96, 128, 192, 256].map(px => ({ id: 'setting', label: `${px}px`, args: { name: 'tilePx', value: px }, active: get('tilePx') === px, group: 'Pixels per tile', title: 'Texture resolution of one pattern tile; lower is softer but cheaper.' })),
          ...[0, .25, .5, 1].map(tiles => ({ id: 'setting', label: tiles ? `<${tiles} tile` : 'off', args: { name: 'minSurfaceTiles', value: tiles }, active: get('minSurfaceTiles') === tiles, group: 'Skip slivers', title: 'Skip surfaces thinner than this many pattern tiles.' })),
          { id: 'export', label: 'Export JSON', group: 'Rules', title: `Downloads ruin-surface-rules.json (applied settings) — commit it as docs/${CONFIG_PATH}.` },
          { id: 'clear', label: 'Clear local edits', group: 'Rules', confirm: 'Drop all Dev Companion pattern rule edits and go back to the repo file?' },
        ];
        for (const type of types) {
          const rule = ruleFor(type.key, draft), enabled = on(type);
          const scale = Number(rule.scale) > 0 ? Number(rule.scale) : null;
          const effective = scale ?? type.partScale ?? get('defaultScale');
          const group = `${type.label} · ${type.meshes}×${type.contexts.size ? ` (${[...type.contexts].join(', ')})` : ''} · ${type.overlays} drawn · tile ${effective}${scale ? '' : type.partScale ? ' (piece)' : ''}`;
          actions.push(
            { id: 'toggle', label: enabled ? 'Patterned' : 'Off', args: { key: type.key }, active: enabled, group },
            { id: 'scale', label: '− tile', args: { key: type.key, direction: -1, from: effective }, group },
            { id: 'scale', label: '+ tile', args: { key: type.key, direction: 1, from: effective }, group },
          );
          if (draft.rules[type.key]) actions.push({ id: 'reset', label: '↺', title: 'Drop this type\'s edits.', args: { key: type.key }, group });
        }
        return {
          summary: `${types.filter(type => isEnabled(type.key)).length}/${types.length} types patterned · ${s.overlays} overlays · ${s.textures} textures · ${s.megapixels.toFixed(1)} MP${s.loading ? ` · ${s.loading} loading` : ''}${pending ? ' · unapplied changes' : ''}`,
          note: `${live ? 'Live update is on: clicks apply immediately.' : 'Changes are staged until Apply settings.'} Types without a rule are patterned only if their name matches /${setting('defaultEnabledPattern', draft)}/. Applied settings persist in this browser; Export JSON and commit it as docs/${CONFIG_PATH} to keep them.`,
          actions,
        };
      },
      onAction: (action, args) => {
        if (action === 'export') return exportJson();
        if (action === 'apply') return apply();
        if (action === 'discard') { draft = clone(local); return { ok: true }; }
        if (action === 'live') { live = !live; writeLocal(); return live && dirty() ? apply() : { ok: true }; }
        if (action === 'clear') { draft = { rules: {} }; return edited(); }
        if (action === 'setting') { draft[args.name] = Number(args.value); return edited(); }
        if (action === 'scale-all') {
          draft.defaultScale = Number(args.scale) || DEFAULTS.defaultScale;
          for (const key of Object.keys(draft.rules)) editRule(key, { scale: undefined });
          return edited();
        }
        if (action === 'all') {
          for (const type of currentRoot()?.userData?.ruinPatternTypes?.values() || []) editRule(type.key, args.reset ? { enabled: undefined } : enabledPatch(type.key, !!args.enabled));
          return edited();
        }
        const key = String(args.key || '');
        if (!key) return { ok: false, error: 'No surface type.' };
        if (action === 'toggle') editRule(key, enabledPatch(key, !isEnabled(key, draft)));
        else if (action === 'scale') editRule(key, { scale: stepScale(Number(args.from) || setting('defaultScale', draft), Number(args.direction) || 1) });
        else if (action === 'reset') delete draft.rules[key];
        else return { ok: false, error: `Unknown action ${action}.` };
        return edited();
      },
    });
  }

  registerPanel();
  // Console/test equivalents of the panel buttons; these always apply immediately.
  function setRule(key, patch = {}) {
    editRule(String(key), { ...('enabled' in patch ? enabledPatch(String(key), patch.enabled !== false) : {}), ...('scale' in patch ? { scale: Number(patch.scale) > 0 ? Number(patch.scale) : undefined } : {}) });
    return apply();
  }
  function setSetting(name, value) {
    if (!(name in DEFAULTS)) return { ok: false, error: `Unknown setting ${name}.` };
    draft[name] = name === 'defaultEnabledPattern' ? String(value) : Number(value);
    return apply();
  }
  window.RuinPatternSurfaceRules = { ready, resolve, identify, isEnabled, preloadPieces, redecorate, setRule, setSetting, apply, mergedConfig, exportJson, stepScale };
})();
