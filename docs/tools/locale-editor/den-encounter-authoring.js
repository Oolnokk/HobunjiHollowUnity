// Den-Mother encounter authoring extension for the Locale Editor.
// Keeps the large inline editor untouched while making the reusable den locale's
// nest, Den-Mother spawn and individual clutch points first-class editable data.
(() => {
  'use strict';

  if (window.__localeDenEncounterAuthoringInstalled) return;
  window.__localeDenEncounterAuthoringInstalled = true;

  const WORKSPACE_KEY = 'hobunji_locale_editor_workspace_v1';
  const STORE_KEY = 'hobunji_locale_editor_den_encounters_v1';
  const DEFAULT_TRANSFORM = Object.freeze({ x:0, y:0, z:0, rx:0, ry:0, rz:0, sx:1, sy:1, sz:1 });
  const TRANSFORM_FIELDS = ['x','y','z','rx','ry','rz','sx','sy','sz'];
  const POSITION_FIELDS = new Set(['x','y','z']);
  const ROTATION_FIELDS = new Set(['rx','ry','rz']);

  let store = loadStore();
  let rawGetWorkspace = null;
  let nativeStorageSetItem = null;
  let lastActiveId = '';
  let selectedTarget = 'mother';
  let dragging = null;
  let dragPointerId = null;

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function normalizedTransform(raw) {
    const t = raw || {};
    return {
      x: finite(t.x), y: finite(t.y), z: finite(t.z),
      rx: finite(t.rx), ry: finite(t.ry), rz: finite(t.rz),
      sx: finite(t.sx, 1) || 1, sy: finite(t.sy, 1) || 1, sz: finite(t.sz, 1) || 1,
    };
  }
  function sanitizeEncounter(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const nest = raw.nest || {};
    const mother = raw.motherSpawn || {};
    return {
      ...clone(raw),
      version: Math.max(1, Number(raw.version) || 1),
      speciesBinding: raw.speciesBinding || 'current-den-family',
      nest: {
        ...clone(nest),
        objectId: nest.objectId || 'den_nest',
        furnitureKey: nest.furnitureKey || 'nest',
        transform: normalizedTransform(nest.transform),
      },
      motherSpawn: {
        ...clone(mother),
        anchorId: mother.anchorId || 'den_mother',
        transform: normalizedTransform(mother.transform),
      },
      clutchSpawns: (Array.isArray(raw.clutchSpawns) ? raw.clutchSpawns : []).map((point, index) => ({
        ...clone(point),
        id: point?.id || `clutch_${index + 1}`,
        transform: normalizedTransform(point?.transform),
      })),
    };
  }
  function defaultEncounter(locale) {
    const nestObject = (locale?.objects || []).find(object => object?.key === 'nest' || object?.meta?.denRole === 'nest');
    const mother = (locale?.npcAnchors || []).find(anchor => anchor?.id === 'den_mother');
    return sanitizeEncounter({
      version: 1,
      speciesBinding: 'current-den-family',
      nest: { objectId: nestObject?.id || 'den_nest', furnitureKey: nestObject?.key || 'nest', transform: DEFAULT_TRANSFORM },
      motherSpawn: { anchorId: mother?.id || 'den_mother', transform: { ...DEFAULT_TRANSFORM, ry:180 } },
      clutchSpawns: [
        { id:'clutch_1', transform:{ ...DEFAULT_TRANSFORM, x:-0.22, z:0.09, ry:-9 } },
        { id:'clutch_2', transform:{ ...DEFAULT_TRANSFORM, x:0.20, z:0.12, ry:11 } },
        { id:'clutch_3', transform:{ ...DEFAULT_TRANSFORM, x:0, z:-0.20, ry:2 } },
      ],
    });
  }

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (parsed && typeof parsed === 'object' && parsed.byLocale) return parsed;
    } catch (_) {}
    return { schema:'hobunji_locale_den_encounters.v1', byLocale:{} };
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
    catch (error) { debug(`den store save failed: ${error.message}`); }
  }
  function bridge() { return window._localeEditorBridge || null; }
  function rawWorkspaceSnapshot() {
    try {
      if (rawGetWorkspace) return rawGetWorkspace();
      return bridge()?.getWorkspace?.() || null;
    } catch (_) { return null; }
  }
  function rawActiveLocale() {
    const workspace = rawWorkspaceSnapshot();
    return workspace?.locales?.find(locale => locale.id === workspace.activeId) || null;
  }
  function persistedEncounter(locale) {
    return sanitizeEncounter(locale?.meta?.denEncounter);
  }
  function shouldAuthor(locale) {
    return !!locale && (locale.category === 'den_encounter' || !!locale?.meta?.denEncounter || !!store.byLocale[locale.id]);
  }
  function ensureEncounter(locale, { create = false } = {}) {
    if (!locale?.id) return null;
    if (!store.byLocale[locale.id]) {
      const fromLocale = persistedEncounter(locale);
      if (fromLocale) store.byLocale[locale.id] = fromLocale;
      else if (create || locale.category === 'den_encounter') store.byLocale[locale.id] = defaultEncounter(locale);
    }
    return store.byLocale[locale.id] ? sanitizeEncounter(store.byLocale[locale.id]) : null;
  }
  function commitEncounter(localeId, encounter, message = '') {
    if (!localeId || !encounter) return;
    store.byLocale[localeId] = sanitizeEncounter(encounter);
    saveStore();
    syncWorkspaceStorage();
    if (message) debug(message);
  }
  function mergeLocale(locale) {
    const output = clone(locale);
    if (!output?.id) return output;
    const encounter = store.byLocale[output.id];
    if (!encounter) return output;
    output.meta = { ...(output.meta || {}), denEncounter: clone(sanitizeEncounter(encounter)) };
    return output;
  }
  function mergeWorkspace(workspace) {
    const output = clone(workspace || { locales:[] });
    output.locales = (output.locales || []).map(mergeLocale);
    return output;
  }

  function patchBridge() {
    const api = bridge();
    if (!api?.getWorkspace) return false;
    if (api.__denEncounterAuthoringBridge) {
      rawGetWorkspace = api.__denEncounterAuthoringBridge.rawGetWorkspace;
      return true;
    }
    rawGetWorkspace = api.getWorkspace.bind(api);
    api.getWorkspace = () => mergeWorkspace(rawGetWorkspace());
    api.__denEncounterAuthoringBridge = { rawGetWorkspace };
    return true;
  }
  function patchWorkspaceStorage() {
    if (window.__localeDenEncounterStoragePatched || typeof Storage === 'undefined') return;
    window.__localeDenEncounterStoragePatched = true;
    nativeStorageSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function denEncounterStorageSetItem(key, value) {
      if (this === localStorage && key === WORKSPACE_KEY) {
        try { value = JSON.stringify(mergeWorkspace(JSON.parse(value))); } catch (_) {}
      }
      return nativeStorageSetItem.call(this, key, value);
    };
  }
  function syncWorkspaceStorage() {
    const workspace = rawWorkspaceSnapshot();
    if (!workspace) return;
    try {
      const setter = nativeStorageSetItem || Storage.prototype.setItem;
      setter.call(localStorage, WORKSPACE_KEY, JSON.stringify(mergeWorkspace(workspace)));
    } catch (error) { debug(`workspace den merge failed: ${error.message}`); }
  }

  function reconcileFromRawLocale(locale) {
    if (!locale?.id) return null;
    const fromLocale = persistedEncounter(locale);
    if (fromLocale) {
      const previous = store.byLocale[locale.id];
      if (!previous || JSON.stringify(previous) !== JSON.stringify(fromLocale)) {
        store.byLocale[locale.id] = fromLocale;
        saveStore();
      }
      return store.byLocale[locale.id];
    }
    if (locale.category === 'den_encounter' && !store.byLocale[locale.id]) {
      store.byLocale[locale.id] = defaultEncounter(locale);
      saveStore();
    }
    return store.byLocale[locale.id] || null;
  }

  function targetDescriptor(encounter, value = selectedTarget) {
    if (!encounter) return null;
    if (value === 'nest') return { type:'nest', label:'Nest furniture', transform:encounter.nest.transform };
    if (value === 'mother') return { type:'mother', label:'Den-Mother', transform:encounter.motherSpawn.transform };
    const match = String(value).match(/^clutch:(\d+)$/);
    if (!match) return null;
    const index = Number(match[1]);
    const point = encounter.clutchSpawns[index];
    return point ? { type:'clutch', index, label:point.id, transform:point.transform } : null;
  }
  function mutateSelected(locale, mutator, message) {
    const encounter = ensureEncounter(locale, { create:true });
    const target = targetDescriptor(encounter);
    if (!target) return;
    mutator(target.transform, target, encounter);
    commitEncounter(locale.id, encounter, message);
    renderControls();
    drawPlan();
  }

  function inputHtml(field, label) {
    const isScale = field[0] === 's';
    const step = isScale ? '0.01' : ROTATION_FIELDS.has(field) ? '0.1' : '0.01';
    const min = isScale ? ' min="0.01"' : '';
    return `<div><label>${label}</label><input id="denTf_${field}" type="number" step="${step}"${min}></div>`;
  }
  function injectUi() {
    if (document.getElementById('localeDenEncounterSection')) return;
    const validation = document.getElementById('validateList')?.closest('.section');
    const host = validation?.parentElement || document.getElementById('sidebar-scroll');
    if (!host) return;
    const section = document.createElement('div');
    section.id = 'localeDenEncounterSection';
    section.className = 'section';
    section.style.setProperty('--sec', '#f5a742');
    section.style.setProperty('--secBg', 'rgba(245,167,66,.08)');
    section.innerHTML = `
      <div class="sect-head"><b>Den encounter transforms</b><span class="sect-tag" id="localeDenEncounterTag">inactive</span></div>
      <div id="localeDenInactive" class="helpbox" style="display:none">This locale is not currently a den encounter. Change its category to <code>den_encounter</code> or initialize encounter metadata here. <div class="row" style="margin-top:6px"><button class="sec" id="localeDenEnable" type="button">Initialize den encounter</button></div></div>
      <div id="localeDenControls">
        <div class="helpbox"><b>All transforms are in world units relative to the nest center.</b> X/Z are also draggable in the plan view. Y, rotation, and scale are edited numerically. These exact values drive the live nest, Den-Mother, and individual egg/baby roots.</div>
        <div class="g2" style="margin-top:6px"><div><label>Target</label><select id="localeDenTarget"></select></div><div><label>Plan drag snap</label><input id="localeDenSnap" type="number" min="0" step="0.01" value="0.01"></div></div>
        <div class="row" style="margin-top:6px"><button class="sec" id="localeDenAddClutch" type="button">＋ Clutch point</button><button class="sec" id="localeDenDuplicate" type="button">Duplicate</button><button class="bad" id="localeDenRemove" type="button">Remove clutch</button><button class="sec" id="localeDenReset" type="button">Reset transform</button></div>
        <div class="g3" style="margin-top:7px">${inputHtml('x','X')}${inputHtml('y','Y')}${inputHtml('z','Z')}</div>
        <div class="g3" style="margin-top:6px">${inputHtml('rx','Rot X°')}${inputHtml('ry','Rot Y°')}${inputHtml('rz','Rot Z°')}</div>
        <div class="g3" style="margin-top:6px">${inputHtml('sx','Scale X')}${inputHtml('sy','Scale Y')}${inputHtml('sz','Scale Z')}</div>
        <div style="margin-top:7px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#081018;overflow:hidden"><canvas id="localeDenPlan" width="292" height="220" style="display:block;width:100%;height:auto;touch-action:none"></canvas></div>
        <div class="muted" style="margin-top:5px">Orange diamond = Den-Mother · cyan circles = possible clutch slots · gold square = nest center. Drag a point to tune X/Z without disturbing its other transform values.</div>
        <div class="muted" id="localeDenDebug" style="margin-top:4px"></div>
      </div>`;
    if (validation) host.insertBefore(section, validation); else host.appendChild(section);

    document.getElementById('localeDenEnable').addEventListener('click', () => {
      const locale = rawActiveLocale();
      if (!locale) return;
      store.byLocale[locale.id] = defaultEncounter(locale);
      saveStore(); syncWorkspaceStorage(); selectedTarget = 'mother'; renderAll();
    });
    document.getElementById('localeDenTarget').addEventListener('change', event => { selectedTarget = event.target.value; renderControls(); drawPlan(); });
    document.getElementById('localeDenAddClutch').addEventListener('click', () => {
      const locale = rawActiveLocale(); if (!locale) return;
      const encounter = ensureEncounter(locale, { create:true });
      let serial = encounter.clutchSpawns.length + 1;
      while (encounter.clutchSpawns.some(point => point.id === `clutch_${serial}`)) serial++;
      const prior = targetDescriptor(encounter);
      const transform = prior?.type === 'clutch' ? clone(prior.transform) : { ...DEFAULT_TRANSFORM };
      transform.x += 0.12; transform.z += 0.12;
      encounter.clutchSpawns.push({ id:`clutch_${serial}`, transform:normalizedTransform(transform) });
      selectedTarget = `clutch:${encounter.clutchSpawns.length - 1}`;
      commitEncounter(locale.id, encounter, `added ${encounter.clutchSpawns.at(-1).id}`); renderAll();
    });
    document.getElementById('localeDenDuplicate').addEventListener('click', () => {
      const locale = rawActiveLocale(); if (!locale) return;
      const encounter = ensureEncounter(locale, { create:true });
      const target = targetDescriptor(encounter);
      if (!target) return;
      let serial = encounter.clutchSpawns.length + 1;
      while (encounter.clutchSpawns.some(point => point.id === `clutch_${serial}`)) serial++;
      const transform = normalizedTransform(target.transform); transform.x += 0.12; transform.z += 0.12;
      encounter.clutchSpawns.push({ id:`clutch_${serial}`, transform });
      selectedTarget = `clutch:${encounter.clutchSpawns.length - 1}`;
      commitEncounter(locale.id, encounter, `duplicated ${target.label} as clutch_${serial}`); renderAll();
    });
    document.getElementById('localeDenRemove').addEventListener('click', () => {
      const locale = rawActiveLocale(); if (!locale) return;
      const encounter = ensureEncounter(locale);
      const target = targetDescriptor(encounter);
      if (!target || target.type !== 'clutch') return;
      const removed = encounter.clutchSpawns.splice(target.index, 1)[0];
      selectedTarget = encounter.clutchSpawns.length ? `clutch:${Math.min(target.index, encounter.clutchSpawns.length - 1)}` : 'mother';
      commitEncounter(locale.id, encounter, `removed ${removed?.id || 'clutch point'}`); renderAll();
    });
    document.getElementById('localeDenReset').addEventListener('click', () => {
      const locale = rawActiveLocale(); if (!locale) return;
      mutateSelected(locale, (transform, target) => Object.assign(transform, DEFAULT_TRANSFORM, target.type === 'mother' ? { ry:180 } : {}), 'reset selected den transform');
    });
    for (const field of TRANSFORM_FIELDS) {
      document.getElementById(`denTf_${field}`).addEventListener('input', event => {
        const locale = rawActiveLocale(); if (!locale) return;
        const fallback = field[0] === 's' ? 1 : 0;
        mutateSelected(locale, transform => { transform[field] = finite(event.target.value, fallback); }, '');
      });
    }

    const canvas = document.getElementById('localeDenPlan');
    canvas.addEventListener('pointerdown', event => beginPlanDrag(event));
    canvas.addEventListener('pointermove', event => updatePlanDrag(event));
    const endDrag = event => {
      if (dragPointerId !== event.pointerId) return;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      dragging = null; dragPointerId = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  function renderTargetOptions(locale, encounter) {
    const select = document.getElementById('localeDenTarget');
    if (!select || !encounter) return;
    const options = [
      ['nest', 'Nest furniture'],
      ['mother', 'Den-Mother spawn'],
      ...encounter.clutchSpawns.map((point, index) => [`clutch:${index}`, `Clutch ${index + 1} · ${point.id}`]),
    ];
    if (!options.some(([value]) => value === selectedTarget)) selectedTarget = encounter.clutchSpawns.length ? 'clutch:0' : 'mother';
    select.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    select.value = selectedTarget;
    const remove = document.getElementById('localeDenRemove');
    if (remove) remove.disabled = targetDescriptor(encounter)?.type !== 'clutch';
  }
  function renderControls() {
    const locale = rawActiveLocale();
    const controls = document.getElementById('localeDenControls');
    const inactive = document.getElementById('localeDenInactive');
    const tag = document.getElementById('localeDenEncounterTag');
    if (!controls || !inactive || !tag) return;
    const active = shouldAuthor(locale);
    controls.style.display = active ? '' : 'none';
    inactive.style.display = active ? 'none' : '';
    if (!locale) { tag.textContent = 'no locale'; return; }
    if (!active) { tag.textContent = 'inactive'; return; }
    const encounter = ensureEncounter(locale, { create:locale.category === 'den_encounter' });
    if (!encounter) { tag.textContent = 'not initialized'; return; }
    store.byLocale[locale.id] = encounter;
    tag.textContent = `${encounter.clutchSpawns.length} clutch slots`;
    renderTargetOptions(locale, encounter);
    const target = targetDescriptor(encounter);
    if (!target) return;
    for (const field of TRANSFORM_FIELDS) {
      const input = document.getElementById(`denTf_${field}`);
      if (input && document.activeElement !== input) input.value = String(target.transform[field]);
    }
  }

  function planGeometry(canvas) {
    const width = canvas.width, height = canvas.height;
    const halfSpan = 1.35;
    const scale = Math.min(width, height) / (halfSpan * 2);
    return {
      width, height, scale, cx:width / 2, cz:height / 2,
      toCanvas: (x, z) => ({ x:width / 2 + x * scale, y:height / 2 + z * scale }),
      toWorld: (x, y) => ({ x:(x - width / 2) / scale, z:(y - height / 2) / scale }),
    };
  }
  function drawPlan() {
    const canvas = document.getElementById('localeDenPlan');
    const locale = rawActiveLocale();
    const encounter = locale ? ensureEncounter(locale) : null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const g = planGeometry(canvas);
    ctx.clearRect(0, 0, g.width, g.height);
    ctx.fillStyle = '#081018'; ctx.fillRect(0, 0, g.width, g.height);
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    for (let d = -1.25; d <= 1.251; d += .25) {
      const a = g.toCanvas(d, -1.35), b = g.toCanvas(d, 1.35); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const c = g.toCanvas(-1.35, d), e = g.toCanvas(1.35, d); ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    }
    if (!encounter) return;
    const center = g.toCanvas(0, 0);
    ctx.fillStyle = '#f4c542'; ctx.fillRect(center.x - 8, center.y - 8, 16, 16);
    ctx.strokeStyle = '#ffe38b'; ctx.strokeRect(center.x - 10, center.y - 10, 20, 20);

    const drawPoint = (targetValue, transform, type, label) => {
      const p = g.toCanvas(transform.x, transform.z);
      const selected = selectedTarget === targetValue;
      ctx.save();
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = selected ? '#ffffff' : type === 'mother' ? '#ffb35c' : '#67e8f9';
      ctx.fillStyle = type === 'mother' ? 'rgba(245,167,66,.75)' : 'rgba(103,232,249,.66)';
      ctx.beginPath();
      if (type === 'mother') {
        ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x + 9, p.y); ctx.lineTo(p.x, p.y + 9); ctx.lineTo(p.x - 9, p.y); ctx.closePath();
      } else ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.font = '10px system-ui'; ctx.fillStyle = '#dbeafe'; ctx.fillText(label, p.x + 11, p.y - 8);
      ctx.restore();
    };
    drawPoint('mother', encounter.motherSpawn.transform, 'mother', 'mother');
    encounter.clutchSpawns.forEach((point, index) => drawPoint(`clutch:${index}`, point.transform, 'clutch', String(index + 1)));
  }
  function hitPlanTarget(event) {
    const canvas = document.getElementById('localeDenPlan');
    const locale = rawActiveLocale();
    const encounter = locale ? ensureEncounter(locale) : null;
    if (!canvas || !encounter) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width);
    const sy = (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height);
    const g = planGeometry(canvas);
    const candidates = [
      { value:'mother', transform:encounter.motherSpawn.transform },
      ...encounter.clutchSpawns.map((point, index) => ({ value:`clutch:${index}`, transform:point.transform })),
    ];
    let best = null, bestD = 18;
    for (const candidate of candidates) {
      const p = g.toCanvas(candidate.transform.x, candidate.transform.z);
      const d = Math.hypot(sx - p.x, sy - p.y);
      if (d <= bestD) { best = candidate; bestD = d; }
    }
    return best ? { ...best, sx, sy, world:g.toWorld(sx, sy) } : null;
  }
  function beginPlanDrag(event) {
    if (event.button != null && event.button !== 0) return;
    const hit = hitPlanTarget(event);
    if (!hit) return;
    selectedTarget = hit.value;
    dragging = hit.value; dragPointerId = event.pointerId;
    const canvas = document.getElementById('localeDenPlan');
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    renderControls(); drawPlan();
    event.preventDefault();
  }
  function updatePlanDrag(event) {
    if (!dragging || dragPointerId !== event.pointerId) return;
    const canvas = document.getElementById('localeDenPlan');
    const rect = canvas.getBoundingClientRect();
    const sx = (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width);
    const sy = (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height);
    const world = planGeometry(canvas).toWorld(sx, sy);
    const snapInput = document.getElementById('localeDenSnap');
    const snap = Math.max(0, finite(snapInput?.value, .01));
    const snapValue = value => snap > 0 ? Math.round(value / snap) * snap : value;
    const locale = rawActiveLocale(); if (!locale) return;
    selectedTarget = dragging;
    mutateSelected(locale, transform => { transform.x = snapValue(world.x); transform.z = snapValue(world.z); }, '');
    event.preventDefault();
  }

  function debug(message) {
    const target = document.getElementById('localeDenDebug');
    if (target) target.textContent = message;
    console.log('[LocaleDenEncounterEditor]', message);
  }
  function renderAll() { renderControls(); drawPlan(); }
  function pollActiveLocale() {
    const locale = rawActiveLocale();
    const id = locale?.id || '';
    if (id !== lastActiveId) {
      lastActiveId = id;
      if (locale) reconcileFromRawLocale(locale);
      selectedTarget = 'mother';
      renderAll();
      debug(locale ? `editing ${locale.id}` : 'no active locale');
    }
  }
  function boot() {
    if (!bridge() || !document.getElementById('sidebar-scroll')) { setTimeout(boot, 40); return; }
    patchBridge();
    patchWorkspaceStorage();
    const workspace = rawWorkspaceSnapshot();
    for (const locale of workspace?.locales || []) reconcileFromRawLocale(locale);
    injectUi();
    syncWorkspaceStorage();
    pollActiveLocale();
    setInterval(pollActiveLocale, 300);
  }

  window.LocaleDenEncounterAuthoring = {
    version: 1,
    activeEncounter: () => clone(ensureEncounter(rawActiveLocale())),
    mergeLocale,
    debugSnapshot: () => {
      const locale = rawActiveLocale();
      const encounter = locale ? ensureEncounter(locale) : null;
      return {
        activeLocaleId: locale?.id || null,
        enabled: !!encounter,
        selectedTarget,
        clutchSpawnCount: encounter?.clutchSpawns?.length || 0,
        motherTransform: clone(encounter?.motherSpawn?.transform || null),
        nestTransform: clone(encounter?.nest?.transform || null),
      };
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
