// Perception Mode — an "eagle vision" sense the player toggles on and off at
// will (rebindable 'perceptionMode' input action, default B). While it is on:
//   • nearby things are tinted by category and visible through walls/terrain
//     (a depth-test-free silhouette mask, then a glow/fill composite):
//       red    — hostiles (aggressive wildlife, bandits, hostile Porakaneki)
//       yellow — prey and non-hostile barbarians (neutral Porakaneki hunters)
//       green  — interactible objects (world objects, lootable corpses,
//                harvest-ready crops)
//       white  — NPCs, the animal companion, livestock, and growing crops
//                that cannot be harvested yet
//   • crops and livestock close to the player get an info list beside them,
//     drawn by WorldPopupText.syncInfoLists in the loot-list style but on
//     the opposite side;
//   • the player (and their mount) moves at half speed (speedMultiplier()).
// Range is limited (RANGE_TILES); there is no cooldown.
//
// Wired from game.js with one init(deps) call; game.js calls renderOverlay()
// from renderWorldPasses and update() from gameLoop. Sources are read through
// deps getters so this module never owns or mutates gameplay registries.
(() => {
  'use strict';

  const LAYER = 25; // Unused elsewhere (see the layer list in outline-render-performance.js / held-object-render-order.js).
  const RANGE_TILES = 14; // Highlight radius around the player.
  const INFO_RANGE_TILES = 6; // Info lists only for close objects, so a full farm doesn't drown in text.
  const MAX_INFO_LISTS = 10;
  const REFRESH_MS = 150; // Target re-collection cadence; the render pass itself runs every frame.
  const INFO_REFRESH_MS = 400;
  const MAX_INTERACTABLE_SIZE_TILES = 3.5; // Whole buildings/walls stay unlit; their doors are separate small objects.
  const SPEED_MULTIPLIER = 0.5;
  const COLORS = Object.freeze({
    hostile: '#ff2f2a',
    neutral: '#ffd43a',
    interact: '#3dff6e',
    friendly: '#ffffff',
    farmSelected: '#35dcff', // Farmwork uses the same mask/glow with its own color language.
    farmAssignable: '#b58aff',
  });
  const INFO_COLORS = Object.freeze({
    title: '#FFB86C', // Matches WorldPopupText's interaction object color.
    good: '#71f59a',
    bad: '#dc143c', // Crimson.
    muted: '#B8C5C0',
    value: '#ffffff',
  });

  let deps = null;
  let active = false;
  let lastRefreshAt = -Infinity;
  let lastInfoAt = -Infinity;
  let targets = []; // [{ root, category, meshes }]
  const meshCache = new WeakMap(); // root -> { at, meshes }
  const sizeCache = new WeakMap(); // root -> largest horizontal extent (tiles)
  const maskMaterials = new WeakMap(); // source material -> Map(category -> MeshBasicMaterial)
  let maskRT = null;
  let postScene = null, postCamera = null, postMaterial = null;
  let overlayEl = null;
  let lastStats = { targets: 0, meshes: 0, infoLists: 0, rendered: 0 };
  let lastRenderer = null; // Kept only for debugMaskCoverage().

  // ── Helpers ──────────────────────────────────────────────────────────
  const THREE = () => deps?.THREE || window.THREE;

  function rootOf(obj) {
    if (!obj) return null;
    return obj.avatarRef?.group || obj.promptRoot || obj.root || obj.group || obj.mesh || null;
  }

  // Area filter: only roots that are actually in the scene being rendered.
  function sceneOf(object) {
    let node = object;
    while (node?.parent) {
      if (node.visible === false) return null;
      node = node.parent;
    }
    return node?.isScene ? node : null;
  }

  const _pos = { v: null };
  function worldPos(root) {
    if (!_pos.v) _pos.v = new (THREE().Vector3)();
    root.getWorldPosition(_pos.v);
    return _pos.v;
  }

  function horizontalSize(root) {
    let size = sizeCache.get(root);
    if (size !== undefined) return size;
    try {
      const box = new (THREE().Box3)().setFromObject(root);
      size = box.isEmpty() ? 0 : Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    } catch (_) { size = 0; }
    sizeCache.set(root, size);
    return size;
  }

  function isMaskableMesh(mesh) {
    if (!(mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh)) return false;
    if (mesh.renderOrder >= 1200) return false; // World popup/dialogue text.
    if (/shadow/i.test(mesh.name || '')) return false; // Ground-shadow blobs.
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.some(m => m && m.visible !== false && m.colorWrite !== false && !(m.transparent && m.opacity < 0.05));
  }

  function meshesOf(root, now) {
    const cached = meshCache.get(root);
    // Visual LOD / respawn can rebuild a root's children; drop the cache as soon as any cached mesh is detached.
    if (cached && now - cached.at < 1000 && cached.meshes.every(mesh => mesh.parent)) return cached.meshes;
    const meshes = [];
    root.traverse(child => { if (isMaskableMesh(child)) meshes.push(child); });
    meshCache.set(root, { at: now, meshes });
    return meshes;
  }

  function sourceMap(material) {
    return material?.map || material?.uniforms?.map?.value || material?.uniforms?.tMap?.value || material?.uniforms?.uMap?.value || null;
  }

  function maskMaterialFor(source, category, skinned) {
    let byCategory = maskMaterials.get(source);
    if (!byCategory) { byCategory = new Map(); maskMaterials.set(source, byCategory); }
    const key = category + (skinned ? ':s' : '');
    let mat = byCategory.get(key);
    const map = sourceMap(source);
    if (!mat) {
      mat = new (THREE().MeshBasicMaterial)({
        color: COLORS[category],
        map,
        alphaTest: map ? Math.max(0.35, Number(source?.alphaTest) || 0) : 0,
        transparent: false,
        depthTest: false, // Visible through obstacles.
        depthWrite: false,
        fog: false,
        side: THREE().DoubleSide,
        skinning: !!skinned, // r128 needs this flag for SkinnedMesh.
        toneMapped: false,
      });
      // Flat category colour: keep only the source texture's alpha (for the
      // sprite cutout) instead of multiplying its colours in.
      mat.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
          '#ifdef USE_MAP\n  diffuseColor.a *= texture2D( map, vUv ).a;\n#endif');
      };
      mat.customProgramCacheKey = () => 'perception-mask';
      byCategory.set(key, mat);
    } else if (mat.map !== map) {
      // Sprite animations can swap the source's texture; follow it.
      const toggled = !mat.map !== !map;
      mat.map = map;
      mat.alphaTest = map ? Math.max(0.35, Number(source?.alphaTest) || 0) : 0;
      if (toggled) mat.needsUpdate = true;
    }
    return mat;
  }

  // ── Classification ───────────────────────────────────────────────────
  function creatureCategory(c) {
    if (c.isCompanion) return 'friendly';
    if (c.isDenMother) return 'hostile'; // A guarding Den-Mother stays a threat even when its base species is prey.
    if (c.isTribeHunter || c.isPorakanekiHunter) return c._porakanekiPlannerControlled === true ? 'neutral' : 'hostile';
    if (c.isBandit || c.banditCompanion) return 'hostile';
    const territorial = c._territorialBehavior?.phase;
    if (territorial === 'warning' || territorial === 'fight') return 'hostile';
    if (c.def?.hostile === false) return 'neutral';
    return 'hostile';
  }

  function isAliveCreature(c) {
    return c && !(c.health <= 0) && c.state !== 'dying' && c.state !== 'corpse';
  }

  function collectTargets(now) {
    const scene = deps.getActiveScene?.();
    const player = deps.getPlayerTile?.();
    if (!scene || !player) return [];
    const out = [];
    if (window.FarmworkUI?.isOpen?.()) {
      for (const { root, category } of window.FarmworkUI.glowTargets()) {
        if (root && sceneOf(root) === scene) out.push({ root, category, meshes: meshesOf(root, now) });
      }
      return out;
    }
    const seenRoots = new Set();
    const rejected = { noRoot: 0, offScene: 0, outOfRange: 0 }; // Diagnostics only (debugSnapshot).
    const consider = (root, category, extra) => {
      if (!root) { rejected.noRoot++; return; }
      if (seenRoots.has(root)) return;
      if (sceneOf(root) !== scene) { rejected.offScene++; return; }
      const p = worldPos(root);
      const dist = Math.hypot(p.x - player.x, p.z - player.z);
      if (dist > RANGE_TILES) { rejected.outOfRange++; return; }
      seenRoots.add(root);
      out.push({ root, category, dist, ...extra });
    };

    const sources = deps.getSources();
    const count = list => (list ? (list.size ?? list.length ?? 0) : 0);
    lastStats.sources = Object.fromEntries(Object.entries(sources).map(([key, list]) => [key, count(list)]));
    lastStats.rejected = rejected;
    for (const c of sources.companions || []) if (isAliveCreature(c)) consider(rootOf(c), 'friendly');
    for (const c of sources.creatures || []) if (isAliveCreature(c)) consider(rootOf(c), creatureCategory(c));
    for (const walker of sources.npcs || []) consider(walker?.root || rootOf(walker), 'friendly');
    for (const animal of sources.livestock || []) consider(rootOf(animal), 'friendly', { livestockId: animal.livestockId || null });
    for (const c of sources.corpses || []) consider(rootOf(c), 'interact');
    for (const root of sources.oreRocks || []) consider(root, 'interact'); // Indexed wild, mine and cavern ore mounds near the player.
    for (const obj of sources.interactables || []) {
      if (!obj || obj.type === 'animal' || obj.livestockId) continue;
      const root = rootOf(obj);
      if (!root || horizontalSize(root) > MAX_INTERACTABLE_SIZE_TILES) continue;
      consider(root, 'interact');
    }
    // Independent scene owners expose small, live targets without forcing game.js
    // to copy their registries or traversing the whole cave every 150 ms.
    const specialSources = { // Provider counts are visible in debugSnapshot for mobile diagnosis.
      oreRocks: window.CavernOreRocks?.senseTargets?.(scene) || [],
      shattercasks: window.Shattercasks?.senseTargets?.(scene) || [],
      nests: window.DenNestSystem?.senseTargets?.(scene) || [],
      hives: window.HoneyfuzzleHives?.senseTargets?.(scene) || [],
      caveFeatures: window.CaveSiteSystem?.senseTargets?.(scene) || [],
    };
    lastStats.specialSources = Object.fromEntries(Object.entries(specialSources).map(([name, roots]) => [name, roots.length]));
    for (const roots of Object.values(specialSources)) for (const root of roots) consider(root, 'interact');
    for (const crop of sources.crops || []) {
      consider(crop.root, crop.tile?.cropReady ? 'interact' : 'friendly', { crop });
    }
    for (const target of out) target.meshes = meshesOf(target.root, now);
    return out;
  }

  // ── Info lists ───────────────────────────────────────────────────────
  const capitalize = text => String(text || '').replace(/\b\w/g, ch => ch.toUpperCase());
  const fmt1 = value => (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');

  function lerpHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = shift => Math.round(((pa >> shift) & 255) + ((((pb >> shift) & 255) - ((pa >> shift) & 255)) * t));
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }

  // Moisture shown in tenths of the tile's max water; the ideal (white
  // denominator) is the middle of the crop's ideal band. The numerator runs
  // white → crimson with distance from that ideal, reaching full crimson
  // where growth stops entirely (0.4 outside the band, per game.js's
  // cropGrowthMultiplier).
  function cropRows(crop) {
    const { tile, data, maxWater } = crop;
    if (!tile || !data) return null;
    const w = Math.max(0, (Number(tile.water) || 0) / maxWater);
    const ideal = (data.idealMin + data.idealMax) / 2;
    const reach = (data.idealMax - data.idealMin) / 2 + 0.4;
    const t = Math.min(1, Math.abs(w - ideal) / reach);
    const growth = Math.max(0, Math.min(1, (Number(tile.cropAge) || 0) / Math.max(0.001, data.growDays)));
    const rows = [
      [{ text: capitalize(data.label), color: INFO_COLORS.title }],
      tile.cropReady
        ? [{ text: 'Growth', small: true }, { text: '100%', color: INFO_COLORS.good }, { text: 'Ready', color: INFO_COLORS.good }]
        : [{ text: 'Growth', small: true }, { text: Math.floor(growth * 100) + '%', color: INFO_COLORS.value }],
      [{ text: 'Moisture', small: true }, { text: fmt1(w * 10), color: lerpHex('#ffffff', INFO_COLORS.bad, t) }, { text: '/' + fmt1(ideal * 10), color: INFO_COLORS.value, tight: true }],
    ];
    if (tile.stress) rows.push([{ text: capitalize(tile.stress), color: INFO_COLORS.bad }]);
    return rows;
  }

  const yesNo = (ok, yes, no) => ({ text: ok ? yes : no, color: ok ? INFO_COLORS.good : INFO_COLORS.bad });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function livestockRows(status) {
    if (!status) return null;
    const rows = [
      [{ text: status.name, color: INFO_COLORS.title }, { text: 'Hearts', small: true }, { text: `${fmt1(status.hearts)}/${status.heartMax}`, color: INFO_COLORS.value }],
      status.hasTrough
        ? [{ text: 'Fed', small: true }, yesNo(status.fed, 'Yes', 'No'), ...(status.fed ? [{ text: `(${plural(status.feedDays, 'day')} in trough)`, small: true }] : [{ text: '(trough empty)', small: true }])]
        : [{ text: 'Fed', small: true }, { text: status.housed ? 'No trough' : 'Unhoused', color: INFO_COLORS.muted }],
      [{ text: 'Petted', small: true }, yesNo(status.pettedToday, 'Yes', 'Not today')],
    ];
    if (status.resourceLabel) {
      rows.push(status.resourceReady
        ? [{ text: status.resourceLabel, color: INFO_COLORS.good }, { text: 'ready to collect', color: INFO_COLORS.good }]
        : [{ text: status.resourceLabel, small: true }, { text: status.housed && status.daysUntilResource != null ? `in ${plural(status.daysUntilResource, 'day')}` : 'paused', color: INFO_COLORS.value }]);
    }
    if (status.dewReady != null) {
      rows.push(status.dewReady
        ? [{ text: 'Dew', color: INFO_COLORS.good }, { text: 'ready', color: INFO_COLORS.good }]
        : [{ text: 'Dew', small: true }, { text: status.housed && status.dewDaysUntil != null ? `in ${plural(status.dewDaysUntil, 'day')}` : 'paused', color: INFO_COLORS.value }]);
    }
    return rows;
  }

  function refreshInfoLists() {
    const popup = window.WorldPopupText;
    if (!popup?.syncInfoLists) return;
    const near = targets
      .filter(t => t.dist <= INFO_RANGE_TILES && (t.crop || t.livestockId))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, MAX_INFO_LISTS);
    const ids = near.filter(t => t.livestockId).map(t => t.livestockId);
    const statuses = ids.length ? (window.FarmAnimals?.livestockStatus?.(ids) || new Map()) : new Map();
    const entries = [];
    for (const t of near) {
      if (t.crop) {
        const rows = cropRows(t.crop);
        if (rows) entries.push({ key: `crop:${t.crop.col},${t.crop.row}`, root: t.root, rows, objectAnchor: true, lift: 0.55 });
      } else {
        const rows = livestockRows(statuses.get(t.livestockId));
        if (rows) entries.push({ key: `livestock:${t.livestockId}`, root: t.root, rows });
      }
    }
    lastStats.infoLists = popup.syncInfoLists(entries, { scene: deps.getActiveScene?.() });
  }

  // ── Rendering ────────────────────────────────────────────────────────
  function ensurePost() {
    if (postScene) return;
    const T = THREE();
    maskRT = new T.WebGLRenderTarget(1, 1, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat, depthBuffer: false });
    postScene = new T.Scene();
    postCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postMaterial = new T.ShaderMaterial({
      uniforms: { tMask: { value: null }, uTexel: { value: new T.Vector2(1, 1) }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // Inside a silhouette: a soft pulsing tint. Just outside: a bright
      // glow edge that fades over a few mask texels.
      fragmentShader: `
        uniform sampler2D tMask; uniform vec2 uTexel; uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tMask, vUv);
          if (c.a > 0.5) { gl_FragColor = vec4(c.rgb, 0.34 + 0.08 * sin(uTime * 3.0)); return; }
          float best = 0.0; vec3 col = vec3(0.0);
          for (int i = 0; i < 8; i++) {
            float ang = float(i) * 0.7853982;
            vec2 dir = vec2(cos(ang), sin(ang)) * uTexel;
            for (int r = 1; r <= 3; r++) {
              vec4 s = texture2D(tMask, vUv + dir * float(r));
              float w = s.a * (r == 1 ? 1.0 : (r == 2 ? 0.85 : 0.45));
              if (w > best) { best = w; col = s.rgb; }
            }
          }
          if (best <= 0.01) discard;
          gl_FragColor = vec4(col, best);
        }
      `,
      transparent: true, depthTest: false, depthWrite: false,
    });
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), postMaterial);
    quad.frustumCulled = false;
    postScene.add(quad);
  }

  const _size = { v: null };
  const _clear = { color: null };
  // Called by game.js's renderWorldPasses once the frame is on the canvas
  // (after the outline/painterly composite, or after the direct render with
  // outlines off), so post-processing never smears the highlight.
  function renderOverlay(renderer, scene, camera) {
    lastStats.rendered = 0;
    if ((!active && !window.FarmworkUI?.isOpen?.()) || !targets.length || !renderer || !scene || !camera) return;
    lastRenderer = renderer;
    ensurePost();
    const T = THREE();
    if (!_size.v) _size.v = new T.Vector2();
    if (!_clear.color) _clear.color = new T.Color();
    renderer.getDrawingBufferSize(_size.v);
    const w = Math.max(1, Math.floor(_size.v.x / 2)), h = Math.max(1, Math.floor(_size.v.y / 2));
    if (maskRT.width !== w || maskRT.height !== h) maskRT.setSize(w, h);
    postMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
    postMaterial.uniforms.uTime.value = performance.now() / 1000;

    const swapped = [];
    for (const target of targets) {
      for (const mesh of target.meshes || []) {
        if (!mesh.parent) continue;
        const original = mesh.material;
        const skinned = !!mesh.isSkinnedMesh;
        mesh.material = Array.isArray(original)
          ? original.map(m => maskMaterialFor(m, target.category, skinned))
          : maskMaterialFor(original, target.category, skinned);
        const hadLayer = (mesh.layers.mask & (1 << LAYER)) !== 0; // r128 Layers has no isEnabled().
        mesh.layers.enable(LAYER);
        swapped.push({ mesh, original, hadLayer });
      }
    }
    if (!swapped.length) return;

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.getClearColor(_clear.color);
    const previousClearAlpha = renderer.getClearAlpha();
    const previousMask = camera.layers.mask;
    const previousBackground = scene.background;
    const previousOverride = scene.overrideMaterial;
    const shadowMap = renderer.shadowMap;
    const previousShadowAuto = !!shadowMap?.autoUpdate;
    let maskRendered = false; // The composite pass runs only after a complete mask.
    try {
      scene.background = null;
      scene.overrideMaterial = null;
      if (shadowMap?.enabled) shadowMap.autoUpdate = false;
      renderer.setRenderTarget(maskRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.autoClear = false;
      camera.layers.set(LAYER);
      renderer.render(scene, camera);
      maskRendered = true;
    } finally {
      // Scene/material state is restored before the composite; renderer state
      // (target, autoClear, shadows) is restored below even if the mask pass
      // threw, so a failure can never leave the main canvas drawing into maskRT.
      camera.layers.mask = previousMask;
      for (const entry of swapped) {
        entry.mesh.material = entry.original;
        if (!entry.hadLayer) entry.mesh.layers.disable(LAYER);
      }
      scene.background = previousBackground;
      scene.overrideMaterial = previousOverride;
      renderer.setClearColor(_clear.color, previousClearAlpha);
      try {
        renderer.setRenderTarget(previousTarget);
        if (maskRendered) {
          postMaterial.uniforms.tMask.value = maskRT.texture;
          renderer.render(postScene, postCamera);
          lastStats.rendered = swapped.length;
        }
      } finally {
        renderer.autoClear = previousAutoClear;
        if (shadowMap?.enabled) shadowMap.autoUpdate = previousShadowAuto;
        renderer.setRenderTarget(previousTarget);
      }
    }
  }

  // ── Screen tint / indicator (DOM touched only on toggle) ──────────────
  function ensureOverlayEl() {
    if (overlayEl || typeof document === 'undefined' || !document.body) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'perceptionModeOverlay';
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.innerHTML = '<div class="perception-mode-label">Perception</div>';
    (document.getElementById('canvasWrap') || document.body).appendChild(overlayEl);
    return overlayEl;
  }

  // ── Public API ───────────────────────────────────────────────────────
  let buttonEl = null; // #btnPerceptionMode (touch/mouse toggle on the outer action ring).
  function bindButton() {
    if (buttonEl || typeof document === 'undefined') return;
    buttonEl = document.getElementById('btnPerceptionMode');
    buttonEl?.addEventListener('pointerdown', event => {
      event.preventDefault();
      toggle();
    });
  }

  function setActive(next) {
    next = !!next;
    if (next && window.FarmworkUI?.isOpen?.()) window.FarmworkUI.close(); // The two world overlays are mutually exclusive.
    if (next === active) return active;
    active = next;
    ensureOverlayEl()?.classList.toggle('active', active);
    if (buttonEl) {
      buttonEl.classList.toggle('active', active);
      buttonEl.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    lastRefreshAt = -Infinity;
    lastInfoAt = -Infinity;
    if (!active) {
      targets = [];
      window.WorldPopupText?.clearInfoLists?.();
      lastStats = { targets: 0, meshes: 0, infoLists: 0, rendered: 0 };
    }
    deps?.onToggle?.(active);
    return active;
  }

  function toggle() { return setActive(!active); }

  function update(now = performance.now()) {
    const farmwork = window.FarmworkUI?.isOpen?.();
    if (farmwork) window.FarmworkUI.updateVisuals(now);
    if ((!active && !farmwork) || !deps) { if (targets.length) targets = []; return; }
    if (now - lastRefreshAt >= REFRESH_MS) {
      lastRefreshAt = now;
      targets = collectTargets(now);
      lastStats.targets = targets.length;
      lastStats.meshes = targets.reduce((n, t) => n + (t.meshes?.length || 0), 0);
    }
    if (!farmwork && now - lastInfoAt >= INFO_REFRESH_MS) {
      lastInfoAt = now;
      refreshInfoLists();
    }
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    bindButton();
    return api;
  }

  const api = {
    init,
    toggle,
    setActive,
    isActive: () => active,
    speedMultiplier: () => (active ? SPEED_MULTIPLIER : 1),
    update,
    renderOverlay,
    COLORS,
    RANGE_TILES,
    debugSnapshot: () => ({
      active,
      ...lastStats,
      byCategory: targets.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + 1; return acc; }, {}),
    }),
    // Dev/test only: reads back the last silhouette mask and counts covered texels by colour.
    debugMaskCoverage: () => {
      if (!lastRenderer || !maskRT) return null;
      const w = maskRT.width, h = maskRT.height;
      const px = new Uint8Array(w * h * 4);
      lastRenderer.readRenderTargetPixels(maskRT, 0, 0, w, h, px);
      const out = { width: w, height: h, covered: 0, byColor: {}, bbox: null };
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        out.covered++;
        const x = (i / 4) % w, y = h - 1 - Math.floor(i / 4 / w); // Top-left origin, mask texels (half the canvas resolution).
        const bb = out.bbox || (out.bbox = { x0: x, y0: y, x1: x, y1: y });
        bb.x0 = Math.min(bb.x0, x); bb.y0 = Math.min(bb.y0, y); bb.x1 = Math.max(bb.x1, x); bb.y1 = Math.max(bb.y1, y);
        const key = `${px[i]},${px[i + 1]},${px[i + 2]}`;
        out.byColor[key] = (out.byColor[key] || 0) + 1;
      }
      out.targets = targets.map(t => ({
        category: t.category, dist: Math.round(t.dist * 10) / 10,
        meshes: (t.meshes || []).slice(0, 6).map(m => {
          const mat = Array.isArray(m.material) ? m.material[0] : m.material;
          return { type: m.type, mat: mat?.type, map: !!sourceMap(mat), alphaTest: mat?.alphaTest, attached: !!m.parent, visible: m.visible };
        }),
      }));
      return out;
    },
    __test: Object.freeze({ creatureCategory, cropRows, livestockRows, lerpHex }),
  };
  window.PerceptionMode = api;
})();
