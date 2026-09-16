// Building Interior Editor wall-mounted furniture adapter.
//
// The main Map Editor only owns the outer map layer; building interiors are
// spatially authored in docs/tools/building-interior-author/. This sidecar
// therefore keeps wall signs/torches/windows in that editor's base/layout
// furniture arrays, samples its real rendered walls, and derives ordinary
// postX/postY/postZ/rotY values that gameplay already understands.
(() => {
  'use strict';

  if (window.BuildingInteriorWallOrnamentEditor) return;
  if (!/\/tools\/building-interior-author\/(?:index\.html)?$/.test(location.pathname || '')) return;

  const DEG = Math.PI / 180;
  const RUNTIME_FURNITURE_BRIDGE_URL = '../../js/building-interior-runtime-furniture.js?v=20260908b';
  const PRESETS = Object.freeze({
    innSign: Object.freeze({ key: 'innSign', itemKey: 'innSignFurniture', label: 'Inn Sign', color: 0x765536, fw: 1, fd: 1 }),
    generalStoreSign: Object.freeze({ key: 'generalStoreSign', itemKey: 'generalStoreSignFurniture', label: 'General Store Sign', color: 0x765536, fw: 1, fd: 1 }),
    wallTorch: Object.freeze({ key: 'wallTorch', itemKey: 'wallTorchFurniture', label: 'Wall Torch', color: 0x60452c, fw: 1, fd: 1 }),
    simpleWindow: Object.freeze({ key: 'simpleWindow', itemKey: 'simpleWindowFurniture', label: 'Simple Window', color: 0x7f6648, fw: 1, fd: 1 }),
    crossbarWindow: Object.freeze({ key: 'crossbarWindow', itemKey: 'crossbarWindowFurniture', label: 'Crossbar Window', color: 0x7f6648, fw: 1, fd: 1 }),
    wideWindow: Object.freeze({ key: 'wideWindow', itemKey: 'wideWindowFurniture', label: 'Wide Window', color: 0x7f6648, fw: 2, fd: 1 }),
  });
  const PRESET_BY_ITEM = new Map(Object.values(PRESETS).map(preset => [preset.itemKey, preset]));

  let renderer = null; // Captured from the Interior Editor's private render loop.
  let scene = null; // The editor's private Three scene, captured without restructuring its large inline closure.
  let camera = null; // The editor's private Three camera, used for wall and ornament raycasts.
  let overlayGroup = null; // Sidecar-owned rich wall-furniture visuals; never disposed by the editor's previewGroup rebuild.
  let selectedId = null; // Sidecar selection is independent of the editor's floor-furniture selection.
  let armPresetKey = null; // When set, the next wall click creates this preset.
  let repickSelected = false; // When true, the next wall click retargets selectedId instead of creating a new record.
  let lastLayoutId = null; // Used to detect base/layout switches and rebuild the sidecar visuals.
  let lastFurnitureSignature = ''; // Cheap JSON signature prevents unnecessary overlay rebuilds during the render loop.
  let rebuildGeneration = 0; // Invalidates async authored-furniture loads when the room/layout changes mid-build.
  let lastError = null; // Mobile-visible diagnostics instead of console-only failures.
  let statusEl = null;
  let ui = null;
  let bootAttempts = 0;

  const byId = id => document.getElementById(id);
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const round = (value, places = 3) => { const p = 10 ** places; return Math.round(finite(value) * p) / p; };
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function loadRuntimeFurnitureBridge() {
    if (window.BuildingInteriorRuntimeFurniture) return;
    const existing = [...document.scripts].find(script => script.src?.includes('building-interior-runtime-furniture.js'));
    if (existing) return;
    const script = document.createElement('script');
    script.src = RUNTIME_FURNITURE_BRIDGE_URL;
    script.async = false;
    script.dataset.biaWallRuntimeFurniture = '1';
    document.head.appendChild(script);
  }

  function installRendererCapture() {
    const THREE = window.THREE;
    if (!THREE?.WebGLRenderer?.prototype?.render) return false;
    const current = THREE.WebGLRenderer.prototype.render;
    if (current.__biaWallOrnamentCaptureWrapped) return true;
    function renderWithInteriorCapture(nextScene, nextCamera, ...rest) {
      if (this?.domElement?.id === 'threeCanvas') {
        renderer = this;
        scene = nextScene;
        camera = nextCamera;
        ensureOverlayGroup();
      }
      return current.call(this, nextScene, nextCamera, ...rest);
    }
    renderWithInteriorCapture.__biaWallOrnamentCaptureWrapped = true;
    renderWithInteriorCapture.__biaWallOrnamentCaptureOriginal = current;
    THREE.WebGLRenderer.prototype.render = renderWithInteriorCapture;
    return true;
  }

  function ensureOverlayGroup() {
    if (!scene || !window.THREE?.Group) return null;
    if (!overlayGroup) {
      overlayGroup = new window.THREE.Group();
      overlayGroup.name = 'BuildingInteriorWallOrnaments';
      overlayGroup.userData.biaWallOrnamentOverlay = true;
    }
    if (overlayGroup.parent !== scene) {
      overlayGroup.parent?.remove?.(overlayGroup);
      scene.add(overlayGroup);
    }
    return overlayGroup;
  }

  function readInterior() {
    byId('refreshExportBtn')?.click();
    const text = byId('exportText')?.value || '';
    if (!text.trim()) return null;
    try { return JSON.parse(text); }
    catch (error) { lastError = `read interior: ${error.message}`; return null; }
  }

  function currentLayoutId() {
    return String(byId('layoutEditSelect')?.value || '');
  }

  function activeFurniture(interior, layoutId = currentLayoutId()) {
    if (!interior) return [];
    if (!layoutId) return interior.furniture ||= [];
    const layout = (interior.layouts || []).find(entry => String(entry?.id) === String(layoutId));
    if (!layout) return interior.furniture ||= [];
    return layout.furniture ||= [];
  }

  function wallRecords(interior = readInterior(), layoutId = currentLayoutId()) {
    return activeFurniture(interior, layoutId).filter(record => PRESET_BY_ITEM.has(String(record?.itemKey || '')) && record?.wallAttachment);
  }

  function presetForRecord(record) {
    return PRESET_BY_ITEM.get(String(record?.itemKey || '')) || PRESETS[record?.wallOrnamentKey] || null;
  }

  function recordById(interior, id = selectedId, layoutId = currentLayoutId()) {
    return activeFurniture(interior, layoutId).find(record => String(record?.id) === String(id)) || null;
  }

  function saveInterior(interior, layoutId, source = '3D Interior wall ornament editor') {
    if (!interior || !window._biaBridge?.loadData) return false;
    const keepSelected = selectedId;
    window._biaBridge.loadData(interior, source);
    window.setTimeout(() => {
      const select = byId('layoutEditSelect');
      if (layoutId && select && [...select.options].some(option => option.value === layoutId)) {
        select.value = layoutId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      selectedId = keepSelected;
      lastFurnitureSignature = '';
      rebuildOverlays();
      refreshUi();
    }, 0);
    return true;
  }

  function basePosition(record, preset) {
    return {
      x: finite(record?.col) + finite(preset?.fw, 1) / 2,
      y: 0,
      z: finite(record?.row) + finite(preset?.fd, 1) / 2,
    };
  }

  async function attachmentFor(preset) {
    if (!preset || !window.WallOrnamentPlacement?.loadAttachment) return null;
    return window.WallOrnamentPlacement.loadAttachment(preset.key, {
      procKey: preset.key,
      wallOrnament: true,
      wallOrnamentSourceKey: preset.key,
    });
  }

  async function deriveRecordTransform(record, preset) {
    const attachment = await attachmentFor(preset);
    if (!attachment || !record?.wallAttachment || !window.WallOrnamentPlacement?.deriveTransform) return false;
    const derived = window.WallOrnamentPlacement.deriveTransform(attachment, record.wallAttachment, basePosition(record, preset));
    if (!derived) return false;
    record.postX = round(derived.postX);
    record.postY = round(derived.postY);
    record.postZ = round(derived.postZ);
    record.rotY = round(derived.rotY, 1);
    record.postSX = finite(record.postSX, 1) || 1;
    record.postSY = finite(record.postSY, 1) || 1;
    record.postSZ = finite(record.postSZ, 1) || 1;
    delete record.postScale;
    return true;
  }

  function rootHasFurnitureId(node) {
    let current = node;
    while (current) {
      if (current.userData?.furnId != null) return true;
      if (current.userData?.biaWallOrnamentOverlay) return true;
      current = current.parent;
    }
    return false;
  }

  function wallHitFromPointer(event) {
    const THREE = window.THREE;
    if (!THREE?.Raycaster || !scene || !camera || !renderer?.domElement) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const candidates = [];
    scene.traverse?.(node => {
      if (!node?.isMesh || node.visible === false) return;
      if (rootHasFurnitureId(node)) return;
      if (/TransformControls|Gizmo|Helper/i.test(String(node.name || ''))) return;
      candidates.push(node);
    });
    for (const hit of raycaster.intersectObjects(candidates, false)) {
      if (!hit?.face?.normal || !hit.point || hit.point.y < 0.30) continue; // Ignore floor tiles and low transparent zone/collider overlays.
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (Math.abs(normal.y) > 0.72) continue;
      normal.y = 0;
      if (normal.lengthSq() < 1e-6) continue;
      normal.normalize();
      if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
      return { point: hit.point.clone(), normal, object: hit.object, distance: hit.distance };
    }
    return null;
  }

  async function buildVisual(record, preset) {
    const THREE = window.THREE;
    if (!THREE?.Group || !preset) return null;
    let group = null;
    try {
      const authored = await window.AuthoredFurniture?.load?.(preset.key);
      if (authored && window.AuthoredFurniture?.buildGroup) group = window.AuthoredFurniture.buildGroup(authored, preset.color);
    } catch (error) {
      lastError = `authored ${preset.key}: ${error?.message || error}`;
    }
    if (!group) {
      try { group = window.ProceduralFurniture?.buildFurnitureGroup?.(preset.key, preset.color) || null; }
      catch (error) { lastError = `procedural ${preset.key}: ${error?.message || error}`; }
    }
    if (!group) return null;
    const base = basePosition(record, preset);
    group.position.set(base.x + finite(record.postX), finite(record.postY), base.z + finite(record.postZ));
    group.rotation.y = finite(record.rotY) * DEG;
    group.scale.set(finite(record.postSX, 1) || 1, finite(record.postSY, 1) || 1, finite(record.postSZ, 1) || 1);
    group.userData.biaWallOrnamentId = record.id;
    group.userData.biaWallOrnamentKey = preset.key;
    group.traverse?.(node => {
      if (!node.userData) node.userData = {};
      node.userData.biaWallOrnamentId = record.id;
      node.userData.biaWallOrnamentKey = preset.key;
    });
    return group;
  }

  function hideBaseFurnitureFor(ids) {
    if (!scene || !ids.size) return;
    scene.traverse?.(node => {
      if (node === overlayGroup || overlayGroup?.getObjectById?.(node.id)) return;
      const furnId = node?.userData?.furnId;
      if (furnId != null && ids.has(String(furnId))) node.visible = false;
    });
  }

  async function rebuildOverlays() {
    const group = ensureOverlayGroup();
    const interior = readInterior();
    if (!group || !interior) return;
    const layoutId = currentLayoutId();
    const records = wallRecords(interior, layoutId);
    const signature = JSON.stringify(records.map(record => [record.id, record.itemKey, record.col, record.row, record.rotY, record.postX, record.postY, record.postZ, record.postSX, record.postSY, record.postSZ, record.wallAttachment]));
    if (signature === lastFurnitureSignature && layoutId === lastLayoutId) {
      hideBaseFurnitureFor(new Set(records.map(record => String(record.id))));
      return;
    }
    lastFurnitureSignature = signature;
    lastLayoutId = layoutId;
    const generation = ++rebuildGeneration;
    while (group.children.length) group.remove(group.children[group.children.length - 1]);
    const ids = new Set(records.map(record => String(record.id)));
    hideBaseFurnitureFor(ids);
    for (const record of records) {
      const preset = presetForRecord(record);
      const visual = await buildVisual(record, preset);
      if (generation !== rebuildGeneration) return;
      if (visual) group.add(visual);
    }
    hideBaseFurnitureFor(ids);
  }

  function recordIdFromObject(node) {
    let current = node;
    while (current) {
      if (current.userData?.biaWallOrnamentId != null) return String(current.userData.biaWallOrnamentId);
      current = current.parent;
    }
    return null;
  }

  function ornamentHitFromPointer(event) {
    const THREE = window.THREE;
    if (!THREE?.Raycaster || !overlayGroup || !camera || !renderer?.domElement) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(overlayGroup.children, true).find(hit => recordIdFromObject(hit.object)) || null;
  }

  async function placeOrRepickFromHit(hit, presetKey = armPresetKey) {
    const interior = readInterior();
    const layoutId = currentLayoutId();
    if (!interior || !hit) return false;
    let record = repickSelected ? recordById(interior, selectedId, layoutId) : null;
    const preset = record ? presetForRecord(record) : PRESETS[presetKey];
    if (!preset) return false;
    const attachment = await attachmentFor(preset);
    if (!attachment) { setStatus('Wall attachment metadata could not be loaded.', 'error'); return false; }

    if (!record) {
      const maxCol = Math.max(0, finite(interior.cols, 1) - finite(preset.fw, 1));
      const maxRow = Math.max(0, finite(interior.rows, 1) - finite(preset.fd, 1));
      const col = Math.max(0, Math.min(maxCol, Math.floor(hit.point.x - finite(preset.fw, 1) / 2)));
      const row = Math.max(0, Math.min(maxRow, Math.floor(hit.point.z - finite(preset.fd, 1) / 2)));
      record = {
        id: `fwall_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        itemKey: preset.itemKey,
        wallOrnamentKey: preset.key,
        col,
        row,
        rotY: 0,
        postX: 0,
        postY: 0,
        postZ: 0,
        postSX: 1,
        postSY: 1,
        postSZ: 1,
      };
      activeFurniture(interior, layoutId).push(record);
      selectedId = record.id;
    }

    record.wallAttachment = {
      version: 1,
      wallPoint: [round(hit.point.x), round(hit.point.y), round(hit.point.z)],
      wallNormal: [round(hit.normal.x, 6), 0, round(hit.normal.z, 6)],
      offsetU: repickSelected ? finite(record.wallAttachment?.offsetU) : 0,
      offsetV: repickSelected ? finite(record.wallAttachment?.offsetV) : 0,
      normalOffset: round(finite(attachment.defaultNormalOffset, 0.01)),
      space: 'wall-surface-uvn',
    };
    await deriveRecordTransform(record, preset);
    armPresetKey = null;
    repickSelected = false;
    saveInterior(interior, layoutId, '3D Interior wall placement');
    setStatus(`${preset.label} attached. Wall X/Y move across the wall; distance moves normal to it.`, 'ok');
    return true;
  }

  async function handleCanvasPointer(event) {
    if (!renderer || event.target !== renderer.domElement) return;
    if (armPresetKey || repickSelected) {
      const hit = wallHitFromPointer(event);
      if (!hit) { setStatus('No wall-like surface found under that point.', 'error'); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      await placeOrRepickFromHit(hit);
      return;
    }
    const hit = ornamentHitFromPointer(event);
    const id = hit ? recordIdFromObject(hit.object) : null;
    if (!id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectedId = id;
    refreshUi();
  }

  async function applyOffsets() {
    const interior = readInterior();
    const layoutId = currentLayoutId();
    const record = recordById(interior, selectedId, layoutId);
    const preset = presetForRecord(record);
    if (!record?.wallAttachment || !preset) return false;
    record.wallAttachment.offsetU = finite(byId('biaWallOffsetU')?.value);
    record.wallAttachment.offsetV = finite(byId('biaWallOffsetV')?.value);
    record.wallAttachment.normalOffset = finite(byId('biaWallOffsetN')?.value);
    await deriveRecordTransform(record, preset);
    saveInterior(interior, layoutId, '3D Interior wall offset edit');
    setStatus(`${preset.label} offsets updated.`, 'ok');
    return true;
  }

  function deleteSelected() {
    const interior = readInterior();
    const layoutId = currentLayoutId();
    const record = recordById(interior, selectedId, layoutId);
    if (!record) return false;
    const preset = presetForRecord(record);
    const next = activeFurniture(interior, layoutId).filter(entry => String(entry?.id) !== String(selectedId));
    if (layoutId) {
      const layout = (interior.layouts || []).find(entry => String(entry?.id) === String(layoutId));
      if (layout) layout.furniture = next;
    } else interior.furniture = next;
    selectedId = null;
    saveInterior(interior, layoutId, '3D Interior wall ornament delete');
    setStatus(`${preset?.label || 'Wall ornament'} deleted.`, 'ok');
    return true;
  }

  function setStatus(message, tone = 'normal') {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = tone === 'error' ? '#ff9a9a' : tone === 'ok' ? '#85e09b' : '#9eacc3';
  }

  function installUi() {
    const panel = byId('biaRightPanel');
    if (!panel || byId('biaWallOrnamentSection')) return !!byId('biaWallOrnamentSection');
    const section = document.createElement('div');
    section.id = 'biaWallOrnamentSection';
    section.className = 'section';
    section.innerHTML = `
      <h2>Wall-mounted furniture</h2>
      <div class="field"><label>Preset</label><select id="biaWallPreset">
        ${Object.values(PRESETS).map(preset => `<option value="${preset.key}">${preset.label}</option>`).join('')}
      </select></div>
      <div class="row"><button id="biaWallPlace">Place on wall</button><button id="biaWallRepick" disabled>Re-pick wall</button></div>
      <div class="grid3" style="margin-top:8px">
        <div class="field"><label>Wall X</label><input id="biaWallOffsetU" type="number" step="0.01" value="0"></div>
        <div class="field"><label>Wall Y</label><input id="biaWallOffsetV" type="number" step="0.01" value="0"></div>
        <div class="field"><label>Distance</label><input id="biaWallOffsetN" type="number" step="0.005" value="0"></div>
      </div>
      <div class="row"><button id="biaWallApply" disabled>Apply offsets</button><button id="biaWallDelete" class="danger" disabled>Delete</button></div>
      <div id="biaWallStatus" class="hint">Choose a preset, click Place on wall, then click the rendered interior wall.</div>
      <div class="hint" style="margin-top:5px">These records live in the room/layout currently selected under Alternate layouts. Windows use the same furniture JSON as runtime.</div>`;
    panel.insertBefore(section, panel.firstChild);
    statusEl = byId('biaWallStatus');
    ui = section;
    byId('biaWallPlace')?.addEventListener('click', () => {
      armPresetKey = String(byId('biaWallPreset')?.value || 'simpleWindow');
      repickSelected = false;
      setStatus(`Click a rendered wall to place ${PRESETS[armPresetKey]?.label || armPresetKey}.`);
    });
    byId('biaWallRepick')?.addEventListener('click', () => {
      if (!selectedId) return;
      armPresetKey = null;
      repickSelected = true;
      setStatus('Click a rendered wall to move the selected piece onto that wall.');
    });
    byId('biaWallApply')?.addEventListener('click', applyOffsets);
    byId('biaWallDelete')?.addEventListener('click', deleteSelected);
    return true;
  }

  function refreshUi() {
    if (!ui) return;
    const interior = readInterior();
    const record = recordById(interior, selectedId);
    const preset = presetForRecord(record);
    const placement = record?.wallAttachment;
    for (const [id, value] of [['biaWallOffsetU', placement?.offsetU], ['biaWallOffsetV', placement?.offsetV], ['biaWallOffsetN', placement?.normalOffset]]) {
      const input = byId(id);
      if (input) input.value = placement ? round(value) : 0;
    }
    const hasSelection = !!record && !!preset;
    if (byId('biaWallRepick')) byId('biaWallRepick').disabled = !hasSelection;
    if (byId('biaWallApply')) byId('biaWallApply').disabled = !hasSelection;
    if (byId('biaWallDelete')) byId('biaWallDelete').disabled = !hasSelection;
    if (hasSelection && !armPresetKey && !repickSelected) {
      setStatus(`${preset.label} selected · ${currentLayoutId() ? `layout ${currentLayoutId()}` : 'base room'} · wall normal ${(placement.wallNormal || []).map(value => finite(value).toFixed(2)).join(', ')}`);
    } else if (!hasSelection && selectedId) selectedId = null;
  }

  function watchEditorState() {
    const layoutSelect = byId('layoutEditSelect');
    layoutSelect?.addEventListener('change', () => {
      selectedId = null;
      lastFurnitureSignature = '';
      window.setTimeout(() => { rebuildOverlays(); refreshUi(); }, 0);
    });
    renderer?.domElement?.addEventListener?.('pointerdown', handleCanvasPointer, true);
    window.setInterval(() => {
      if (renderer?.domElement && !renderer.domElement.__biaWallOrnamentPointerBound) {
        renderer.domElement.__biaWallOrnamentPointerBound = true;
        renderer.domElement.addEventListener('pointerdown', handleCanvasPointer, true);
      }
      rebuildOverlays();
      refreshUi();
    }, 300);
  }

  function debugSnapshot() {
    const interior = readInterior();
    return {
      installed: !!ui,
      sceneReady: !!scene,
      cameraReady: !!camera,
      rendererReady: !!renderer,
      layoutId: currentLayoutId() || null,
      selectedId,
      armedPreset: armPresetKey,
      repickSelected,
      wallRecords: wallRecords(interior).map(record => ({ id: record.id, itemKey: record.itemKey, wallOrnamentKey: record.wallOrnamentKey, wallAttachment: clone(record.wallAttachment) })),
      lastError,
    };
  }

  function boot() {
    bootAttempts += 1;
    loadRuntimeFurnitureBridge();
    installRendererCapture();
    const ready = installUi() && window.WallOrnamentPlacement && window.DaylightWindowRuntime && window._biaBridge;
    if (!ready) {
      if (bootAttempts < 200) window.setTimeout(boot, 50);
      return;
    }
    watchEditorState();
    window.setTimeout(() => { rebuildOverlays(); refreshUi(); }, 0);
  }

  window.BuildingInteriorWallOrnamentEditor = Object.freeze({
    presets: PRESETS,
    readInterior,
    wallRecords,
    rebuildOverlays,
    debugSnapshot,
  });
  window.__biaWallOrnamentDebug = debugSnapshot;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();