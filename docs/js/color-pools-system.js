(() => {
  'use strict';

  if (Number(window.ColorPoolsSystem?.version) >= 1) return;

  const VERSION = 1;
  const ACCESS_KEY_ID = 'color_pools_key';
  const MAP_ID = 'map_i_color_pools';
  const PAINT_KEY = 'colorPoolPaint';

  let deps = {};
  let overlay = null;
  let selectedStableId = null;
  let draftLayers = {};
  let previewToken = 0;
  let stylesInjected = false;
  let lastError = null;

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const title = value => String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());

  function init(injected = {}) {
    deps = { ...deps, ...injected };
    return api;
  }

  function ownsAccessKey() {
    return !!window.KeyItemSystem?.has?.(ACCESS_KEY_ID);
  }

  function progression() {
    return window.StableAnimalProgression || null;
  }

  function stableMaxLevel() {
    const value = Number(progression()?.maxLevel);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
  }

  function stableEntries() {
    const list = progression()?.stableEntries?.();
    return Array.isArray(list) ? list : [];
  }

  function canonicalKind(entry) {
    const raw = String(entry?.kind || entry?.species || '').trim().toLowerCase().replace(/_/g, '-');
    return window.CreatureGenetics?.SPECIES_ALIAS?.[raw] || raw;
  }

  function regionsFor(entry) {
    const genotype = entry?.genotype;
    const kind = canonicalKind(entry);
    const spec = window.CreatureGeneticsRender?.SPECIES?.[kind];
    if (!genotype || !spec) return [];
    const regions = [];
    if (genotype.base?.color) regions.push({ id: 'base', label: 'Base coat', color: genotype.base.color });
    for (const patternId of spec.patterns || []) {
      const layer = genotype[patternId];
      if (!layer?.color || layer.enabled === false || !(Number(layer.copies) > 0)) continue;
      regions.push({ id: patternId, label: title(patternId), color: layer.color });
    }
    return regions;
  }

  function eligibleStableAnimals() {
    const cap = stableMaxLevel();
    return stableEntries().filter(entry => Number(entry?.level) >= cap && entry?.genotype && regionsFor(entry).length);
  }

  function ownedDyes() {
    const catalog = window.DyeSystem?.getCatalog?.() || [];
    return catalog.filter(dye => window.DyeSystem?.owns?.(dye.id));
  }

  function availablePatterns() {
    return window.PatternLibrary?.listAvailable?.() || [];
  }

  function selectedEntry() {
    return eligibleStableAnimals().find(entry => String(entry.id) === String(selectedStableId)) || null;
  }

  function paintDescriptor(regionId) {
    return draftLayers?.[regionId] || null;
  }

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .cp-overlay{position:fixed;inset:0;z-index:9450;background:rgba(4,7,10,.78);display:flex;align-items:center;justify-content:center;padding:12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#eef6f4}
      .cp-modal{width:min(980px,100%);max-height:100%;overflow:auto;border:1px solid rgba(140,205,190,.28);border-radius:16px;background:linear-gradient(180deg,#13201e,#0e1718);box-shadow:0 22px 70px rgba(0,0,0,.58)}
      .cp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border-bottom:1px solid rgba(255,255,255,.1)}
      .cp-head h2{font-size:17px;margin:0}.cp-close,.cp-btn{border:1px solid rgba(140,205,190,.32);background:rgba(140,205,190,.11);color:#eef6f4;border-radius:9px;padding:7px 10px;font-weight:750;cursor:pointer}
      .cp-close{width:32px;height:32px;padding:0}.cp-btn.secondary{background:rgba(255,255,255,.055);border-color:rgba(255,255,255,.14)}.cp-btn.good{background:rgba(95,190,130,.14);border-color:rgba(95,190,130,.38)}
      .cp-body{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:12px;padding:12px}.cp-body>div{min-width:0}.cp-card{border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.035);border-radius:12px;padding:10px;margin-bottom:9px}
      .cp-card h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.35px;color:#bcd5cf}.cp-help{font-size:11px;color:#9eb6b1;line-height:1.4}
      .cp-preview{display:grid;place-items:center;min-width:0;min-height:260px;overflow:hidden;background:#090d0f;border:1px solid rgba(255,255,255,.1);border-radius:12px;background-image:linear-gradient(45deg,rgba(255,255,255,.04) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.04) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.04) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.04) 75%);background-size:18px 18px;background-position:0 0,0 9px,9px -9px,-9px 0}
      .cp-preview canvas{position:static;inset:auto;width:min(360px,100%);height:auto;pointer-events:none;image-rendering:pixelated}.cp-region{border-top:1px solid rgba(255,255,255,.09);padding-top:9px;margin-top:9px}.cp-region:first-child{border-top:0;margin-top:0;padding-top:0}
      .cp-region-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;margin-bottom:7px}.cp-swatch{width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,.4)}
      .cp-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.cp-grid label{font-size:10px;color:#9eb6b1}.cp-grid select{width:100%;margin-top:3px;background:#111b1c;color:#eef6f4;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px}
      .cp-row{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px}.cp-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.1)}
      .cp-empty{padding:24px 10px;text-align:center;color:#a8bbb7}.cp-debug{white-space:pre-wrap;word-break:break-word;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8fa8a3}
      @media(max-width:700px){.cp-body{grid-template-columns:1fr}.cp-preview{min-height:190px}.cp-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    selectedStableId = null;
    draftLayers = {};
    deps.setInteractionBlocked?.(false);
  }

  function loadDraft(entry) {
    selectedStableId = entry?.id || null;
    draftLayers = clone(entry?.genotype?.[PAINT_KEY]?.layers || {});
  }

  function ensurePaint(regionId) {
    if (!draftLayers[regionId]) draftLayers[regionId] = {};
    return draftLayers[regionId];
  }

  function snapshotPattern(libraryId) {
    const pattern = libraryId ? window.PatternLibrary?.getById?.(libraryId) : null;
    return pattern ? clone(pattern) : null;
  }

  function setLibraryPattern(regionId, libraryId) {
    const paint = ensurePaint(regionId);
    if (!libraryId) {
      delete paint.patternLibraryId;
      delete paint.pattern;
      if (!paint.dyeId && !paint.dyeHex) delete draftLayers[regionId];
      return;
    }
    paint.patternLibraryId = libraryId;
    paint.pattern = snapshotPattern(libraryId); // Snapshot keeps an applied animal stable even if the player later removes the library entry.
  }

  function setDye(regionId, dyeId) {
    const paint = ensurePaint(regionId);
    const dye = window.DyeSystem?.getById?.(dyeId);
    if (!dye) {
      delete paint.dyeId;
      delete paint.dyeHex;
      return;
    }
    paint.dyeId = dye.id;
    paint.dyeHex = dye.hex;
  }

  function cleanDraft() {
    const out = {};
    for (const [regionId, paint] of Object.entries(draftLayers || {})) {
      const pattern = paint?.pattern || (paint?.patternLibraryId ? snapshotPattern(paint.patternLibraryId) : null);
      const dyeHex = paint?.dyeHex || window.DyeSystem?.getById?.(paint?.dyeId)?.hex;
      if (!pattern || !dyeHex) continue;
      out[regionId] = { ...clone(paint), dyeHex, pattern: clone(pattern) };
    }
    return out;
  }

  function invalidateLiveAnimal(entry) {
    const actors = [
      ...(window.Combat?.deps?.companionObjects || []),
      window.Mounts?.rideEntity,
    ].filter(Boolean);
    for (const actor of actors) {
      const sameGenotype = actor.genotype === entry.genotype;
      const sameStableId = String(actor.stableId || actor.stabledId || actor.stableEntryId || '') === String(entry.id || '');
      if (!sameGenotype && !sameStableId) continue;
      actor._genotypeReadyFrames = null;
      actor._genotypeLogged = false;
      actor.currentFrameUrl = null;
      actor._blinkAppliedShut = null;
    }
    window.dispatchEvent(new CustomEvent('hobunji:stable-animal-appearance-changed', { detail: { stableId: entry.id } }));
  }

  async function drawPreview() {
    const canvas = overlay?.querySelector('#colorPoolsPreviewCanvas');
    const status = overlay?.querySelector('#colorPoolsPreviewStatus');
    const entry = selectedEntry();
    if (!canvas || !entry) return;
    const token = ++previewToken;
    try {
      const genotype = clone(entry.genotype);
      genotype[PAINT_KEY] = { version: 1, layers: cleanDraft() };
      const kind = canonicalKind(entry);
      const source = await window.CreatureGeneticsRender?.composeFrame?.(kind, 'idle', genotype, false);
      if (token !== previewToken || !overlay?.isConnected || !source) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
      const scale = Math.min((canvas.width - 24) / sw, (canvas.height - 24) / sh);
      const dw = sw * scale, dh = sh * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      if (status) status.textContent = `${entry.name || entry.kind} · level ${entry.level}/${stableMaxLevel()} · ${regionsFor(entry).length} paintable genetic regions`;
      lastError = null;
      refreshDebug();
    } catch (error) {
      lastError = String(error?.message || error);
      if (status) status.textContent = 'Preview failed: ' + lastError;
      refreshDebug();
    }
  }

  function refreshDebug() {
    const el = overlay?.querySelector('#colorPoolsDebug');
    const entry = selectedEntry();
    const snapshot = {
      accessKey: ownsAccessKey(),
      stableCap: stableMaxLevel(),
      selectedStableId: entry?.id || null,
      kind: entry ? canonicalKind(entry) : null,
      eligibleCount: eligibleStableAnimals().length,
      regions: entry ? regionsFor(entry).map(region => region.id) : [],
      paintedRegions: Object.keys(cleanDraft()),
      lastError,
    };
    if (el) el.textContent = JSON.stringify(snapshot, null, 2);
    window.__colorPoolsDebug = snapshot;
  }

  function renderRegions() {
    const holder = overlay?.querySelector('#colorPoolsRegions');
    const entry = selectedEntry();
    if (!holder || !entry) return;
    const dyes = ownedDyes();
    const patterns = availablePatterns();
    const regions = regionsFor(entry);
    holder.innerHTML = regions.map(region => {
      const paint = paintDescriptor(region.id) || {};
      const patternId = paint.patternLibraryId || '';
      const patternKnown = patternId && patterns.some(pattern => pattern.id === patternId);
      return `
        <div class="cp-region" data-region="${esc(region.id)}">
          <div class="cp-region-title"><span class="cp-swatch" style="background:${esc(region.color)}"></span>${esc(region.label)} <span class="cp-help">genetic ${esc(region.color)}</span></div>
          <div class="cp-grid">
            <label>Paint dye<select data-field="dye">
              <option value="">No dye</option>
              ${dyes.map(dye => `<option value="${esc(dye.id)}" ${paint.dyeId === dye.id ? 'selected' : ''}>${esc(dye.label || dye.id)}</option>`).join('')}
            </select></label>
            <label>Pattern<select data-field="pattern">
              <option value="">No pattern</option>
              ${!patternKnown && patternId ? `<option value="${esc(patternId)}" selected>Saved snapshot (${esc(patternId)})</option>` : ''}
              ${patterns.map(pattern => `<option value="${esc(pattern.id)}" ${patternId === pattern.id ? 'selected' : ''}>${esc(pattern.label || pattern.id)}</option>`).join('')}
            </select></label>
          </div>
          <div class="cp-row">
            <button class="cp-btn secondary" type="button" data-act="edit">Author / edit pattern</button>
            <button class="cp-btn secondary" type="button" data-act="clear">Clear this region</button>
          </div>
        </div>`;
    }).join('');

    holder.querySelectorAll('.cp-region').forEach(row => {
      const regionId = row.dataset.region;
      row.querySelector('[data-field="dye"]')?.addEventListener('change', event => {
        setDye(regionId, event.target.value);
        drawPreview();
        refreshDebug();
      });
      row.querySelector('[data-field="pattern"]')?.addEventListener('change', event => {
        setLibraryPattern(regionId, event.target.value);
        drawPreview();
        refreshDebug();
      });
      row.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
        delete draftLayers[regionId];
        renderRegions();
        drawPreview();
        refreshDebug();
      });
      row.querySelector('[data-act="edit"]')?.addEventListener('click', async () => {
        const paint = ensurePaint(regionId);
        const initial = paint.pattern || (paint.patternLibraryId ? snapshotPattern(paint.patternLibraryId) : null);
        window.PatternAuthoring?.openEditor?.({
          title: `Paint ${regionsFor(entry).find(region => region.id === regionId)?.label || regionId} — ${entry.name || entry.kind}`,
          motifHint: 'This motif will be clipped to this one genetic body-color region.',
          initialPattern: clone(initial),
          initialPatternLibraryId: paint.patternLibraryId || null,
          library: window.PatternLibrary ? {
            list: () => window.PatternLibrary.listAvailable(),
            get: id => window.PatternLibrary.getById(id),
            save: (label, data) => window.PatternLibrary.saveToLibrary(label, data),
            remove: id => window.PatternLibrary.removeSaved(id),
          } : null,
          renderPreview: async patternData => {
            const temp = clone(entry.genotype);
            const layers = cleanDraft();
            const dye = paint.dyeHex || window.DyeSystem?.getById?.(paint.dyeId)?.hex || ownedDyes()[0]?.hex || '#ffffff';
            layers[regionId] = { ...clone(paint), dyeHex: dye, pattern: clone(patternData) };
            temp[PAINT_KEY] = { version: 1, layers };
            return window.CreatureGeneticsRender?.composeFrame?.(canonicalKind(entry), 'idle', temp, false);
          },
          onSave: async (patternData, libraryId) => {
            paint.patternLibraryId = libraryId || '';
            paint.pattern = clone(libraryId ? (window.PatternLibrary?.getById?.(libraryId) || patternData) : patternData);
            if (!paint.dyeHex && !paint.dyeId) {
              const firstDye = ownedDyes()[0];
              if (firstDye) { paint.dyeId = firstDye.id; paint.dyeHex = firstDye.hex; }
            }
            renderRegions();
            await drawPreview();
            return true;
          },
        });
      });
    });
  }

  function renderAnimalPicker() {
    const select = overlay?.querySelector('#colorPoolsAnimalSelect');
    if (!select) return;
    const animals = eligibleStableAnimals();
    select.innerHTML = animals.map(entry => `<option value="${esc(entry.id)}">${esc(entry.name || entry.kind)} · Lv ${esc(entry.level)}</option>`).join('');
    if (!animals.length) return;
    if (!animals.some(entry => String(entry.id) === String(selectedStableId))) loadDraft(animals[0]);
    select.value = String(selectedStableId);
    select.onchange = () => {
      const entry = animals.find(candidate => String(candidate.id) === String(select.value));
      if (!entry) return;
      loadDraft(entry);
      renderRegions();
      drawPreview();
      refreshDebug();
    };
  }

  function open() {
    injectStyles();
    if (overlay?.isConnected) return true;
    const animals = eligibleStableAnimals();
    deps.setInteractionBlocked?.(true);
    overlay = document.createElement('div');
    overlay.className = 'cp-overlay';
    overlay.innerHTML = `
      <div class="cp-modal" role="dialog" aria-modal="true">
        <div class="cp-head"><h2>Color Pools</h2><button type="button" class="cp-close" aria-label="Close">✕</button></div>
        <div class="cp-body">
          <div>
            <div class="cp-card">
              <h3>Stable animal</h3>
              ${animals.length ? '<select id="colorPoolsAnimalSelect" style="width:100%;background:#111b1c;color:#eef6f4;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:8px"></select>' : `<div class="cp-empty">Only max-level Stable animals can use the altar. Current cap: ${stableMaxLevel()}.</div>`}
              <p class="cp-help" style="margin-top:8px">Choose each inherited body-color region separately. Pattern ink is clipped to that region, so paint cannot spill into a different genetic coat or body-pattern layer.</p>
            </div>
            <div class="cp-card"><h3>Region paint</h3><div id="colorPoolsRegions"></div></div>
          </div>
          <div>
            <div class="cp-preview"><canvas id="colorPoolsPreviewCanvas" width="420" height="340"></canvas></div>
            <div class="cp-help" id="colorPoolsPreviewStatus" style="margin:7px 2px 10px">Select an animal.</div>
            <details class="cp-card"><summary>Debug</summary><pre id="colorPoolsDebug" class="cp-debug"></pre></details>
          </div>
        </div>
        <div class="cp-foot">
          <button type="button" class="cp-btn secondary" data-act="clear-all">Clear all paint</button>
          <button type="button" class="cp-btn good" data-act="apply" ${animals.length ? '' : 'disabled'}>Apply to animal</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.cp-close').onclick = close;
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const onKey = event => { if (event.key === 'Escape' && overlay?.isConnected) { document.removeEventListener('keydown', onKey); close(); } };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[data-act="clear-all"]')?.addEventListener('click', () => {
      draftLayers = {};
      renderRegions();
      drawPreview();
      refreshDebug();
    });
    overlay.querySelector('[data-act="apply"]')?.addEventListener('click', () => {
      const entry = selectedEntry();
      if (!entry?.genotype) return;
      entry.genotype[PAINT_KEY] = { version: 1, layers: cleanDraft() };
      progression()?.saveStable?.();
      invalidateLiveAnimal(entry);
      deps.showToast?.(`🎨 Painted ${entry.name || entry.kind} at the Color Pools.`, true);
      lastError = null;
      drawPreview();
      refreshDebug();
    });
    if (animals.length) {
      loadDraft(animals[0]);
      renderAnimalPicker();
      renderRegions();
      drawPreview();
    }
    refreshDebug();
    return true;
  }

  function makeAltarInteractable() {
    return {
      getButtons() {
        return [{ icon: '🎨', label: 'Use Color Pools', action: 'obj_color_pools', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_color_pools') return { ok: false, message: 'Unknown action.' };
        const animals = eligibleStableAnimals();
        if (!animals.length) return { ok: false, message: `Only a max-level Stable animal can be painted here (level ${stableMaxLevel()}).` };
        open();
        return { ok: true, message: 'Opened the Color Pools altar.' };
      },
    };
  }

  function decorateScene({ THREE, scene, mapData } = {}) {
    if (!THREE || !scene || String(mapData?.id || '') !== MAP_ID || scene.getObjectByName?.('color_pools_water_group')) return null;
    const pools = mapData?.cavernFeatures?.colorPools || [];
    if (!Array.isArray(pools) || !pools.length) return null;
    const group = new THREE.Group();
    group.name = 'color_pools_water_group';
    for (const pool of pools) {
      const tiles = Array.isArray(pool.tiles) ? pool.tiles : [];
      if (!tiles.length) continue;
      const cols = tiles.map(tile => Number(tile[0])), rows = tiles.map(tile => Number(tile[1]));
      const minC = Math.min(...cols), maxC = Math.max(...cols), minR = Math.min(...rows), maxR = Math.max(...rows);
      const width = maxC - minC + 1, depth = maxR - minR + 1;
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(pool.color || '#4f7ea5'),
        transparent: true,
        opacity: 0.74,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const water = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.94, depth * 0.94), material);
      water.rotation.x = -Math.PI / 2;
      water.position.set((minC + maxC + 1) / 2, 0.065, (minR + maxR + 1) / 2);
      water.name = 'color_pool_' + (pool.id || 'pool');
      group.add(water);
      const light = new THREE.PointLight(new THREE.Color(pool.color || '#4f7ea5'), 0.45, 3.5, 2);
      light.position.set(water.position.x, 0.35, water.position.z);
      group.add(light);
    }
    scene.add(group);
    return group;
  }

  function debugSnapshot() {
    return window.__colorPoolsDebug || {
      accessKey: ownsAccessKey(),
      stableCap: stableMaxLevel(),
      eligibleCount: eligibleStableAnimals().length,
      selectedStableId,
      lastError,
    };
  }

  const api = Object.freeze({
    version: VERSION,
    init,
    open,
    close,
    ownsAccessKey,
    stableMaxLevel,
    eligibleStableAnimals,
    regionsFor,
    makeAltarInteractable,
    decorateScene,
    debugSnapshot,
  });

  window.ColorPoolsSystem = api;
})();
