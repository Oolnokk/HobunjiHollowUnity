// Ruin pattern surface rules: which ruin surfaces get random engravings, at
// what tile scale, and how large their atlases may be.
//
// FurniturePatternSurfaces.decorateRuin() asks resolve(mesh, root) for every
// mesh in a ruin. A "type" is one repeated piece part (e.g.
// "pillar_square › Square Tapered Shaft"), never one instance.
//
// Default selection is geometric, measured in world space: each flat face
// region of a mesh is classed as
//   broad   vertical, at least minRegionHeight tall and minRegionWidth wide
//           (walls, upright pillar shafts, plateau/platform sides) — patterned
//   narrow  vertical but smaller (trims, plinths, sideways baseboard pillars)
//   top / bottom   horizontal faces
//   inner   faces of a false pillar's housing that point into the pillar
// Only broad faces are patterned unless a rule says otherwise. A rule can turn
// a whole type off/on, switch individual face classes, or set its tile size.
//
// Sources, later wins per key:
//   docs/config/patterns/ruin-surface-rules.json   repo defaults
//   localStorage hobunjiRuinPatternRules.v1         applied Dev Companion edits
// The Dev Companion "Ruin surface patterns" panel stages edits until "Apply
// settings" (or applies each click with "Live update"), has a "Pick surface"
// button that identifies the next surface clicked in the game, and exports
// the merged rules as JSON for committing back into the repo file.
//
// Per-piece scale authored in the Furniture Author (part.patternScale) is read
// from the piece JSON the V50 generator built the mesh from; a rule scale set
// here overrides it.
(() => {
  'use strict';
  const CONFIG_PATH = 'config/patterns/ruin-surface-rules.json';
  const LOCAL_KEY = 'hobunjiRuinPatternRules.v1';
  const LIVE_KEY = 'hobunjiRuinPatternRules.live.v1';
  const LOCAL_SCHEMA = 2; // v2: face-class rules; earlier tile-size edits are dropped so everything starts at the default tile 4.
  const PIECE_DIRS = ['assets/models/furniture/data/', 'config/furniture-authored/']; // Same folders the V50 generator reads repo furniture from.
  const DEFAULTS = { minSurfaceTiles: .25, maxAtlasPx: 512, tilePx: 256, defaultScale: 4, minRegionHeight: 1, minRegionWidth: .3 };
  const SCALE_STEPS = [.5, .75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
  const ALL_SCALES = [1, 1.5, 2, 3, 4, 6];
  const CLASSES = ['broad', 'narrow', 'top', 'inner'];
  const CLASS_LABELS = { broad: 'tall broad sides', narrow: 'small sides/trims', top: 'tops', bottom: 'undersides', inner: 'inner (hidden) faces' };
  const NAME_EXCLUDED = /seal|glyph|decal|fire|ceiling|floor|rune/i; // Never patterned by default, whatever their size.

  let repo = { rules: {} };
  let local = readLocal(); // Applied edits (what the ruin currently shows).
  let draft = clone(local); // Staged panel edits.
  let live = readLive();
  let showAll = false; // Panel: list every type, not just patterned/edited ones.
  let selection = null; // Last surface picked in the game.
  const pieceParts = new Map(); // piece id -> Map(part name -> part) | null (missing)
  const ready = fetch(CONFIG_PATH).then(response => response.ok ? response.json() : null).then(data => { if (data && typeof data === 'object') repo = { ...data, rules: { ...(data.rules || {}) } }; }).catch(() => {});

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function readLocal() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch (_) {}
    if (!data || typeof data !== 'object') return { schema: LOCAL_SCHEMA, rules: {} };
    const result = { ...data, rules: { ...(data.rules || {}) } };
    if (result.schema !== LOCAL_SCHEMA) { // One-time migration: tile 4 all around.
      delete result.defaultScale; delete result.defaultEnabledPattern;
      for (const [key, rule] of Object.entries(result.rules)) { const next = { ...rule }; delete next.scale; if (Object.keys(next).length) result.rules[key] = next; else delete result.rules[key]; }
      result.schema = LOCAL_SCHEMA;
    }
    return result;
  }
  function readLive() { try { return localStorage.getItem(LIVE_KEY) === '1'; } catch (_) { return false; } }
  function writeLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); localStorage.setItem(LIVE_KEY, live ? '1' : '0'); } catch (_) {}
  }

  function setting(name, source = local) {
    const value = source[name] ?? repo[name];
    return Number.isFinite(Number(value)) ? Number(value) : DEFAULTS[name];
  }
  function ruleFor(key, source = local) {
    const a = repo.rules[key] || {}, b = source.rules[key] || {};
    return { ...a, ...b, classes: { ...(a.classes || {}), ...(b.classes || {}) } };
  }
  // Which face classes a type patterns, after defaults and rules.
  function classesFor(key, nameExcluded, source = local) {
    const rule = ruleFor(key, source);
    if (rule.enabled === false) return { broad: false, narrow: false, top: false, inner: false };
    return { broad: !nameExcluded || rule.enabled === true, narrow: false, top: false, inner: false, ...rule.classes };
  }

  // Repeated-piece identity for a mesh: the V50 repo furniture piece (group
  // "repo_furniture_<id>") or authored furniture key, plus the part name.
  // Plain generated meshes (walls) drop their per-instance index suffixes;
  // unnamed meshes are named after their nearest named ancestor.
  function identify(mesh, root) {
    let piece = '', context = '', owner = '', housing = null, path = '';
    for (let node = mesh; node && node !== root; node = node.parent) {
      const name = String(node.name || '');
      path += ' ' + name;
      if (!piece && name.startsWith('repo_furniture_')) piece = name.slice('repo_furniture_'.length);
      if (!piece && node.userData?.authoredFurnitureKey) piece = String(node.userData.authoredFurnitureKey);
      if (!context && node.userData?.interiorRuinRole) context = String(node.userData.interiorRuinRole);
      if (!owner && node !== mesh && name) owner = name;
      if (!housing && node.userData?.squarePillarHousing) housing = node;
    }
    const authored = mesh.userData?.authoredPart;
    let part = authored?.name || authored?.id || String(mesh.name || '') || `${owner || context || 'unnamed'} (part)`;
    if (!piece) part = part.replace(/(_[a-z]{1,2})?(_\d+)+$/i, '').replace(/_\d+(?= \(part\))/, '') || part; // ruin_wall_wn_0 -> ruin_wall
    if (housing && !piece) part = 'false pillar (part)'; // Hidden-target pillar housings read as their own type, not the generic ruin bucket.
    const key = piece ? `${piece} › ${part}` : part;
    return { key, piece, part, context, housing, nameExcluded: NAME_EXCLUDED.test(key) || NAME_EXCLUDED.test(path) };
  }

  // Groups a mesh's triangles into flat regions (same key surfaceGeometry
  // uses) and classes each one from its world-space size and orientation.
  const scratch = {};
  function analyze(mesh, root, info = identify(mesh, root)) {
    const THREE = window.THREE, keyOf = window.FurniturePatternSurfaces?.regionKey;
    const position = mesh.geometry?.getAttribute?.('position');
    if (!THREE || !keyOf || !position) return [];
    if (!scratch.a) Object.assign(scratch, { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), e: new THREE.Vector3(), n: new THREE.Vector3(), w: new THREE.Vector3(), wn: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), t: new THREE.Vector3(), m3: new THREE.Matrix3(), axis: new THREE.Vector3() });
    const { a, b, c, e, n, w, wn, up, t, m3, axis } = scratch;
    const index = mesh.geometry.index, count = index ? index.count : position.count;
    m3.getNormalMatrix(mesh.matrixWorld);
    if (info.housing) info.housing.getWorldPosition(axis);
    const regions = new Map();
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2);
      e.subVectors(b, a); n.subVectors(c, a).cross(e).negate().normalize();
      const key = keyOf(n.x, n.y, n.z, n.dot(a));
      let region = regions.get(key);
      if (!region) {
        wn.copy(n).applyMatrix3(m3).normalize();
        t.crossVectors(up, wn); if (t.lengthSq() < 1e-8) t.set(1, 0, 0); t.normalize();
        region = { key, ny: wn.y, nx: wn.x, nz: wn.z, tx: t.x, tz: t.z, minY: Infinity, maxY: -Infinity, minT: Infinity, maxT: -Infinity, cx: 0, cz: 0, points: 0 };
        regions.set(key, region);
      }
      for (const p of [a, b, c]) {
        w.copy(p).applyMatrix4(mesh.matrixWorld);
        const along = w.x * region.tx + w.z * region.tz;
        if (w.y < region.minY) region.minY = w.y;
        if (w.y > region.maxY) region.maxY = w.y;
        if (along < region.minT) region.minT = along;
        if (along > region.maxT) region.maxT = along;
        region.cx += w.x; region.cz += w.z; region.points++;
      }
    }
    const minH = setting('minRegionHeight') * (info.housing ? .5 : 1), minW = setting('minRegionWidth'); // A false pillar's niche side is split into ~1/3-height wall segments; they must match the real shaft's patterned face.
    const out = [];
    for (const region of regions.values()) {
      const height = region.maxY - region.minY, width = region.maxT - region.minT;
      let cls;
      if (region.ny > .7) cls = 'top';
      else if (region.ny < -.7) cls = 'bottom';
      else if (info.housing && (region.nx * (region.cx / region.points - axis.x) + region.nz * (region.cz / region.points - axis.z)) < 0) cls = 'inner';
      else cls = height >= minH && width >= minW ? 'broad' : 'narrow';
      out.push({ key: region.key, cls, width: +width.toFixed(2), height: +height.toFixed(2) });
    }
    return out;
  }

  function resolve(mesh, root) {
    const info = identify(mesh, root);
    const { key, piece, part, context, housing, nameExcluded } = info;
    const rule = ruleFor(key);
    const partData = piece ? pieceParts.get(piece)?.get(part) : null;
    const partScale = Number(partData?.patternScale) > 0 ? Number(partData.patternScale) : null;
    const regions = analyze(mesh, root, info);
    const on = classesFor(key, nameExcluded);
    const sideRegions = regions.filter(region => (region.cls === 'broad' && on.broad) || (region.cls === 'narrow' && on.narrow) || (region.cls === 'inner' && on.inner)).map(region => region.key);
    const topRegions = on.top ? regions.filter(region => region.cls === 'top').map(region => region.key) : [];
    return {
      key, label: key, context, nameExcluded,
      classes: [...new Set(regions.map(region => region.cls))],
      enabled: sideRegions.length + topRegions.length > 0,
      sideRegions, topRegions,
      patternGroup: housing ? housing.uuid : null, // A false pillar's walls share one motif, like a real pillar's single shaft.
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
    if (selection?.mesh) refreshSelection();
    return { ok: true };
  }

  // Draft edits; apply() makes them the ruin's live rules.
  function editRule(key, patch) {
    const next = { ...(draft.rules[key] || {}), ...patch };
    if (patch.classes) next.classes = { ...(draft.rules[key]?.classes || {}), ...patch.classes };
    for (const name of Object.keys(next.classes || {})) if (next.classes[name] === undefined) delete next.classes[name];
    if (next.classes && !Object.keys(next.classes).length) delete next.classes;
    for (const [name, value] of Object.entries(next)) if (value === undefined) delete next[name];
    if (Object.keys(next).length) draft.rules[key] = next; else delete draft.rules[key];
  }
  function typeInfo(key) { return currentRoot()?.userData?.ruinPatternTypes?.get(key) || null; }
  function typeOn(key, source = draft) {
    const type = typeInfo(key), on = classesFor(key, !!type?.nameExcluded, source);
    return [...(type?.classes || CLASSES)].some(cls => on[cls]);
  }
  function setTypeOn(key, enable) {
    if (!enable) { editRule(key, { enabled: false }); return; }
    editRule(key, { enabled: true });
    const type = typeInfo(key);
    if (type && !typeOn(key)) { // A type with no broad faces (a ladder, a trim) turns on its other side faces instead.
      const cls = ['narrow', 'top'].find(name => type.classes.has(name));
      if (cls) editRule(key, { classes: { [cls]: true } });
    }
  }
  function toggleClass(key, cls) {
    const type = typeInfo(key), next = !classesFor(key, !!type?.nameExcluded, draft)[cls];
    const base = classesFor(key, !!type?.nameExcluded, { rules: {} }); // Repo rule + defaults, without this browser's edits.
    if (next && ruleFor(key, draft).enabled === false) editRule(key, { enabled: undefined });
    editRule(key, { classes: { [cls]: next === base[cls] ? undefined : next } });
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
      if (!Object.keys(rule.classes).length) delete rule.classes;
      if (Object.keys(rule).length) rules[key] = rule;
    }
    const out = { schema: 'hobunji_ruin_pattern_surface_rules.v2' };
    for (const name of Object.keys(DEFAULTS)) out[name] = setting(name);
    out.rules = Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)));
    return out;
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(mergedConfig(), null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'ruin-surface-rules.json';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  }

  // ── Click-to-select ──────────────────────────────────────────────────
  // "Pick surface" arms one capture-phase pointerdown on the game canvas; the
  // clicked surface (pattern overlays don't raycast) is identified and its
  // type, face class and size show at the top of the panel.
  let pickArmed = false, pickHint = null, highlight = null, highlightTimer = 0;
  function visibleChain(node) { for (let x = node; x; x = x.parent) if (x.visible === false) return false; return true; }
  function armPick() {
    const canvas = window.__hobunjiGameRenderer?.domElement, camera = window.DevRandomRuinInteractions?.activeCamera?.();
    if (!canvas || !camera || !currentRoot()) return { ok: false, error: 'Enter a decorated ruin first.' };
    if (pickArmed) return { ok: true };
    pickArmed = true;
    pickHint = document.createElement('div');
    pickHint.textContent = '🎯 Click a ruin surface to identify it (Esc cancels)';
    pickHint.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9500;padding:6px 12px;border-radius:8px;background:rgba(10,14,18,.88);color:#fff;font:13px sans-serif;pointer-events:none';
    document.body.appendChild(pickHint);
    const done = () => { pickArmed = false; pickHint?.remove(); pickHint = null; canvas.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('keydown', onKey, true); };
    const onKey = event => { if (event.key === 'Escape') done(); };
    const onPointer = event => {
      event.preventDefault(); event.stopImmediatePropagation?.(); event.stopPropagation();
      done();
      const rect = canvas.getBoundingClientRect();
      pickAt(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1, window.DevRandomRuinInteractions?.activeCamera?.() || camera);
    };
    canvas.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return { ok: true };
  }
  function pickAt(ndcX, ndcY, camera) {
    const THREE = window.THREE, root = currentRoot();
    if (!root || !camera) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const hit = raycaster.intersectObject(root, true).find(entry => entry.object.isMesh && !entry.object.userData?.furniturePattern && visibleChain(entry.object) && (Array.isArray(entry.object.material) || entry.object.material?.visible !== false));
    if (!hit) { selection = { none: true }; return selection; }
    selection = { mesh: hit.object, faceIndex: hit.faceIndex };
    refreshSelection();
    showHighlight(hit.object);
    return selection;
  }
  function refreshSelection() {
    const root = currentRoot(), mesh = selection?.mesh;
    if (!root || !mesh) return;
    const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index, first = selection.faceIndex * 3;
    const THREE = window.THREE, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    a.fromBufferAttribute(position, index ? index.getX(first) : first);
    b.fromBufferAttribute(position, index ? index.getX(first + 1) : first + 1);
    c.fromBufferAttribute(position, index ? index.getX(first + 2) : first + 2);
    n.subVectors(c, a).cross(new THREE.Vector3().subVectors(b, a)).negate().normalize();
    const regionKey = window.FurniturePatternSurfaces.regionKey(n.x, n.y, n.z, n.dot(a));
    const info = identify(mesh, root), region = analyze(mesh, root, info).find(entry => entry.key === regionKey) || null;
    const patterned = mesh.children.some(child => child.userData?.furniturePattern);
    Object.assign(selection, { key: info.key, context: info.context, cls: region?.cls || '?', width: region?.width, height: region?.height, patterned });
  }
  function showHighlight(mesh) {
    const THREE = window.THREE, scene = window.DevRandomRuin?.getRuntimeContext?.()?.scene;
    clearTimeout(highlightTimer);
    if (highlight) { highlight.parent?.remove(highlight); highlight.geometry?.dispose(); highlight.material?.dispose(); highlight = null; }
    if (!scene || !THREE.BoxHelper) return;
    highlight = new THREE.BoxHelper(mesh, 0xffd84a);
    highlight.raycast = () => {};
    scene.add(highlight);
    highlightTimer = setTimeout(() => { if (highlight) { highlight.parent?.remove(highlight); highlight.geometry?.dispose(); highlight.material?.dispose(); highlight = null; } }, 5000);
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

  // Buttons for one type: on/off, tile size, and one switch per face class it has.
  function typeActions(type, group) {
    const rule = ruleFor(type.key, draft), enabled = typeOn(type.key);
    const scale = Number(rule.scale) > 0 ? Number(rule.scale) : null;
    const effective = scale ?? type.partScale ?? setting('defaultScale', draft);
    const on = classesFor(type.key, type.nameExcluded, draft);
    const actions = [
      { id: 'toggle', label: enabled ? 'Patterned' : 'Off', args: { key: type.key }, active: enabled, group },
      { id: 'scale', label: '− tile', args: { key: type.key, direction: -1, from: effective }, group },
      { id: 'scale', label: '+ tile', args: { key: type.key, direction: 1, from: effective }, group },
    ];
    for (const cls of CLASSES) if (type.classes.has(cls)) actions.push({ id: 'class', label: `${on[cls] ? '☑' : '☐'} ${CLASS_LABELS[cls]}`, args: { key: type.key, cls }, active: on[cls], group });
    if (draft.rules[type.key]) actions.push({ id: 'reset', label: '↺', title: 'Drop this type\'s edits.', args: { key: type.key }, group });
    return { actions, effective, scale };
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
        const root = currentRoot(), allTypes = [...root.userData.ruinPatternTypes.values()];
        const s = stats(root), get = name => setting(name, draft), pending = dirty();
        const actions = [
          { id: 'apply', label: pending ? '✔ Apply settings' : 'Applied', active: pending, group: 'Changes', title: 'Re-pattern this ruin with the staged settings.' },
          { id: 'discard', label: 'Discard', group: 'Changes', title: 'Drop staged settings that were not applied.' },
          { id: 'live', label: live ? '☑ Live update' : '☐ Live update', active: live, group: 'Changes', title: 'Apply every click immediately.' },
          { id: 'pick', label: pickArmed ? '🎯 Click the game…' : '🎯 Pick surface', active: pickArmed, group: 'Select', title: 'Then click any ruin surface in the game window to see what it is.' },
          { id: 'show-all', label: showAll ? `Showing all ${allTypes.length} types` : `Show all ${allTypes.length} types`, active: showAll, group: 'Select', title: 'Otherwise only patterned and edited types are listed.' },
        ];
        if (selection?.none) actions.push({ id: 'pick', label: 'Nothing hit — pick again', group: 'Picked' });
        else if (selection?.key) {
          const type = root.userData.ruinPatternTypes.get(selection.key);
          const head = `Picked: ${selection.key}${selection.context ? ` (${selection.context})` : ''} · this face: ${CLASS_LABELS[selection.cls] || selection.cls}${selection.height != null ? ` ${selection.width}w × ${selection.height}h` : ''} · ${selection.patterned ? 'patterned' : 'plain'}`;
          if (type) actions.push(...typeActions(type, head).actions);
        }
        actions.push(
          { id: 'all', label: 'All on', args: { enabled: true }, group: 'All types' },
          { id: 'all', label: 'All off', args: { enabled: false }, group: 'All types' },
          { id: 'all', label: 'Defaults', args: { reset: true }, group: 'All types', title: 'Drop per-type on/off and face edits: tall broad sides only.' },
          ...ALL_SCALES.map(scale => ({ id: 'scale-all', label: `${scale}`, args: { scale }, active: get('defaultScale') === scale, group: 'Tile for all', title: 'Sets every type to this tile size (clears per-type sizes).' })),
          ...[.6, 1, 1.5, 2].map(h => ({ id: 'setting', label: `≥${h}`, args: { name: 'minRegionHeight', value: h }, active: get('minRegionHeight') === h, group: 'Broad = taller than', title: 'World height a side face needs to count as tall and broad.' })),
          ...[256, 512, 1024].map(px => ({ id: 'setting', label: `${px}px`, args: { name: 'maxAtlasPx', value: px }, active: get('maxAtlasPx') === px, group: 'Atlas max', title: 'Longest edge of one surface\'s pattern texture.' })),
          ...[96, 128, 192, 256].map(px => ({ id: 'setting', label: `${px}px`, args: { name: 'tilePx', value: px }, active: get('tilePx') === px, group: 'Pixels per tile', title: 'Texture resolution of one pattern tile; lower is softer but cheaper.' })),
          ...[0, .25, .5, 1].map(tiles => ({ id: 'setting', label: tiles ? `<${tiles} tile` : 'off', args: { name: 'minSurfaceTiles', value: tiles }, active: get('minSurfaceTiles') === tiles, group: 'Skip slivers', title: 'Skip surfaces thinner than this many pattern tiles.' })),
          { id: 'export', label: 'Export JSON', group: 'Rules', title: `Downloads ruin-surface-rules.json (applied settings) — commit it as docs/${CONFIG_PATH}.` },
          { id: 'clear', label: 'Clear local edits', group: 'Rules', confirm: 'Drop all Dev Companion pattern rule edits and go back to the repo file?' },
        );
        const listed = allTypes.filter(type => showAll || type.overlays > 0 || typeOn(type.key) || draft.rules[type.key]);
        listed.sort((a, b) => (typeOn(b.key) - typeOn(a.key)) || a.label.localeCompare(b.label));
        for (const type of listed) {
          const { effective, scale } = typeActions(type, '');
          const group = `${type.label} · ${type.meshes}×${type.contexts.size ? ` (${[...type.contexts].join(', ')})` : ''} · ${type.overlays} drawn · tile ${effective}${scale ? '' : type.partScale ? ' (piece)' : ''}`;
          actions.push(...typeActions(type, group).actions);
        }
        return {
          summary: `${allTypes.filter(type => type.overlays > 0).length}/${allTypes.length} types patterned · ${s.overlays} overlays · ${s.textures} textures · ${s.megapixels.toFixed(1)} MP${s.loading ? ` · ${s.loading} loading` : ''}${pending ? ' · unapplied changes' : ''}`,
          note: `${live ? 'Live update is on: clicks apply immediately.' : 'Changes are staged until Apply settings.'} By default only tall broad side faces (≥${get('minRegionHeight')} tall, ≥${get('minRegionWidth')} wide in the world) are patterned. Applied settings persist in this browser; Export JSON and commit it as docs/${CONFIG_PATH} to keep them.`,
          actions,
        };
      },
      onAction: (action, args) => {
        if (action === 'export') return exportJson();
        if (action === 'apply') return apply();
        if (action === 'discard') { draft = clone(local); return { ok: true }; }
        if (action === 'live') { live = !live; writeLocal(); return live && dirty() ? apply() : { ok: true }; }
        if (action === 'pick') return armPick();
        if (action === 'show-all') { showAll = !showAll; return { ok: true }; }
        if (action === 'clear') { draft = { schema: LOCAL_SCHEMA, rules: {} }; return edited(); }
        if (action === 'setting') { draft[args.name] = Number(args.value); return edited(); }
        if (action === 'scale-all') {
          draft.defaultScale = Number(args.scale) || DEFAULTS.defaultScale;
          for (const key of Object.keys(draft.rules)) editRule(key, { scale: undefined });
          return edited();
        }
        if (action === 'all') {
          for (const type of currentRoot()?.userData?.ruinPatternTypes?.values() || []) {
            if (args.reset) editRule(type.key, { enabled: undefined, classes: Object.fromEntries(CLASSES.map(cls => [cls, undefined])) });
            else setTypeOn(type.key, !!args.enabled);
          }
          return edited();
        }
        const key = String(args.key || '');
        if (!key) return { ok: false, error: 'No surface type.' };
        if (action === 'toggle') setTypeOn(key, !typeOn(key));
        else if (action === 'class') toggleClass(key, String(args.cls));
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
    key = String(key);
    if ('enabled' in patch) setTypeOn(key, patch.enabled !== false);
    if ('scale' in patch) editRule(key, { scale: Number(patch.scale) > 0 ? Number(patch.scale) : undefined });
    if (patch.classes) for (const [cls, value] of Object.entries(patch.classes)) editRule(key, { classes: { [cls]: value } });
    return apply();
  }
  function setSetting(name, value) {
    if (!(name in DEFAULTS)) return { ok: false, error: `Unknown setting ${name}.` };
    draft[name] = Number(value);
    return apply();
  }
  window.RuinPatternSurfaceRules = { ready, resolve, identify, analyze, classesFor, preloadPieces, redecorate, setRule, setSetting, apply, armPick, pickAt, getSelection: () => selection, mergedConfig, exportJson, stepScale };
})();
