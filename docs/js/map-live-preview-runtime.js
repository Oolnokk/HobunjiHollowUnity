(() => {
  'use strict';

  let deps = null; // Runtime closures injected by game.js; used for area/map resolution and scene-local application.
  let endpoint = null; // BroadcastChannel endpoint retained for the whole game session.
  let editorConnected = false; // Drives the mobile-visible connection badge.
  let armed = false; // One-shot click-to-select state, deliberately separate from Pixel Probe's state.
  let revision = 0; // Last applied live-preview revision.
  let lastResult = null; // Latest reflection/navigation diagnostic shown in the Map Edit panel.
  let editorWindow = null; // Named standalone editor window, reused rather than opening duplicate tabs.
  let transformControl = null; // Runtime placement gizmo, attached only to outdoor decor/processing furniture.
  let selectedPlacement = null; // {ref,node,basePosition}; mirrors edits back into the Map Editor workspace.
  let gameplayLock = null; // Shared movement/tool/action lock held only while a gizmo handle is dragged.
  let transformSendTimer = null;
  const raycaster = new THREE.Raycaster(); // Shared picker raycaster; created once instead of per pointer event.

  function init(injectedDeps) {
    deps = injectedDeps;
    endpoint = window.MapLivePreview.createEndpoint('game', handleMessage);
    bindUi();
    endpoint.send({ type: 'game-ready', map: currentDescriptor() });
    refreshVisibility();
    refreshPanel();
    const latest = endpoint.readLatest();
    if (latest?.type === 'reflect-request') queueMicrotask(() => handleReflect(latest));
  }

  function mapIdForArea(area = deps.getCurrentArea()) {
    if (area === 'town') return 'map_hobunji_town';
    if (deps.isBuildingArea(area) || deps.isZoneArea(area)) return area;
    return null;
  }

  function currentDescriptor() {
    const area = deps.getCurrentArea();
    const mapId = mapIdForArea(area);
    if (!mapId) return { area, mapId: null, editable: false, reason: area === 'farm' ? 'Farm editing uses the in-game Farm Editor.' : 'This area has no Map Editor source.' };
    const generated = deps.isProceduralZone(mapId);
    return {
      area,
      mapId,
      name: deps.mapName(mapId),
      layoutId: deps.activeLayoutId(mapId),
      editable: true,
      generated,
      mapSnapshot: generated ? deps.exportGeneratedMap(mapId) : null,
    };
  }

  function refreshVisibility() {
    const button = document.getElementById('mapEditBtn');
    if (!deps) { if (button) button.style.display = 'none'; return; }
    const descriptor = currentDescriptor();
    const show = !!deps?.isDevMode?.() && descriptor.editable && deps.getCurrentArea() !== 'farm';
    if (button) button.style.display = show ? '' : 'none';
    if (!show) closePanel();
    refreshPanel();
  }

  function togglePanel() {
    const panel = document.getElementById('mapEditPanel');
    const button = document.getElementById('mapEditBtn');
    if (!panel) return;
    const open = panel.style.display !== 'flex';
    panel.style.display = open ? 'flex' : 'none';
    button?.classList.toggle('fed-open', open);
    if (open) refreshPanel();
  }

  function closePanel() {
    const panel = document.getElementById('mapEditPanel');
    if (panel) panel.style.display = 'none';
    document.getElementById('mapEditBtn')?.classList.remove('fed-open');
    disarmPicker();
    if (selectedPlacement) detachPlacement();
  }

  function ensureTransformControl() {
    if (transformControl || !THREE.TransformControls) return transformControl;
    transformControl = new THREE.TransformControls(deps.camera, deps.renderer.domElement);
    transformControl.setMode('translate');
    transformControl.addEventListener('dragging-changed', event => {
      window.__mapEditorGizmoDragging = !!event.value;
      if (event.value && !gameplayLock) {
        gameplayLock = window.CharacterActionLocks?.acquire?.({ owner: 'map-editor-gizmo', reason: 'Adjusting a map placement', participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }] });
      } else if (!event.value) {
        gameplayLock?.release?.(); gameplayLock = null;
        sendPlacementTransform(true);
      }
      refreshPanel();
    });
    transformControl.addEventListener('objectChange', () => sendPlacementTransform(false));
    return transformControl;
  }

  function placementIdentity(ref) {
    return ref.id || `${ref.key || ''}@${ref.col},${ref.row}`;
  }

  function attachPlacement(ref, node) {
    if (!['decor', 'furniture'].includes(ref?.kind) || !node) { detachPlacement(); return; }
    const control = ensureTransformControl();
    if (!control) { setStatus('Transform gizmo unavailable: TransformControls did not load.', false); return; }
    control.parent?.remove(control);
    deps.getActiveScene()?.add(control);
    const basePosition = node.position.clone();
    basePosition.x -= ref.postX || 0; basePosition.y -= ref.postY || 0; basePosition.z -= ref.postZ || 0;
    selectedPlacement = { ref: { ...ref }, node, basePosition };
    window.__mapEditorGizmoActive = true;
    control.attach(node);
    refreshPanel();
  }

  function detachPlacement() {
    clearTimeout(transformSendTimer);
    transformControl?.detach();
    gameplayLock?.release?.(); gameplayLock = null;
    window.__mapEditorGizmoDragging = false;
    window.__mapEditorGizmoActive = false;
    selectedPlacement = null;
    refreshPanel();
  }

  function setGizmoMode(mode) {
    ensureTransformControl()?.setMode(mode);
    for (const [id, value] of [['mapEditGizmoTranslate','translate'],['mapEditGizmoRotate','rotate'],['mapEditGizmoScale','scale']]) {
      document.getElementById(id)?.classList.toggle('fed-active', value === mode);
    }
  }

  function placementTransform() {
    if (!selectedPlacement) return null;
    const { node, basePosition } = selectedPlacement;
    const aux = node.userData?.mapEditorAux;
    if (aux?.light && aux.lightOffset) aux.light.position.copy(node.position).add(aux.lightOffset);
    if (aux?.sfxSource) {
      aux.sfxSource.x = node.position.x + (aux.sfxOffsetX || 0);
      aux.sfxSource.z = node.position.z + (aux.sfxOffsetZ || 0);
    }
    return {
      postX: +(node.position.x - basePosition.x).toFixed(3), postY: +(node.position.y - basePosition.y).toFixed(3), postZ: +(node.position.z - basePosition.z).toFixed(3),
      rotY: +(node.rotation.y * 180 / Math.PI).toFixed(1),
      postSX: +Math.max(.05, node.scale.x).toFixed(3), postSY: +Math.max(.05, node.scale.y).toFixed(3), postSZ: +Math.max(.05, node.scale.z).toFixed(3),
    };
  }

  function sendPlacementTransform(immediate) {
    if (!selectedPlacement) return;
    const send = () => endpoint.send({
      type: 'placement-transform', requestId: window.MapLivePreview.requestId('gizmo'),
      mapId: selectedPlacement.ref.mapId || currentDescriptor().mapId,
      layoutId: selectedPlacement.ref.layoutId || currentDescriptor().layoutId || 'default',
      selection: { kind: selectedPlacement.ref.kind, id: selectedPlacement.ref.id, key: selectedPlacement.ref.key, col: selectedPlacement.ref.col, row: selectedPlacement.ref.row },
      transform: placementTransform(),
    });
    clearTimeout(transformSendTimer);
    if (immediate) send(); else transformSendTimer = setTimeout(send, 45);
  }

  function setStatus(text, ok = true) {
    lastResult = { text, ok, at: Date.now() };
    refreshPanel();
    window.__farmLog?.(`[map-live] ${text}`, ok ? 'info' : 'warn');
  }

  function refreshPanel() {
    const descriptor = deps ? currentDescriptor() : { editable: false };
    const name = document.getElementById('mapEditMapName');
    const layout = document.getElementById('mapEditLayout');
    const connection = document.getElementById('mapEditConnection');
    const result = document.getElementById('mapEditLastResult');
    const generated = document.getElementById('mapEditGeneratedWarning');
    if (name) name.textContent = descriptor.name || descriptor.mapId || descriptor.reason || 'No editable map';
    if (layout) layout.textContent = descriptor.layoutId && descriptor.layoutId !== 'default' ? descriptor.layoutId : 'Base';
    if (connection) {
      connection.textContent = editorConnected ? '● Map Editor connected' : '○ Map Editor not connected';
      connection.classList.toggle('connected', editorConnected);
    }
    if (result) result.textContent = lastResult?.text || 'No live reflection yet.';
    if (generated) generated.style.display = descriptor.generated ? '' : 'none';
    const gizmoSection = document.getElementById('mapEditGizmoSection');
    if (gizmoSection) gizmoSection.style.display = selectedPlacement ? '' : 'none';
    const gizmoLabel = document.getElementById('mapEditGizmoSelection');
    if (gizmoLabel && selectedPlacement) gizmoLabel.textContent = `${selectedPlacement.ref.kind} · ${placementIdentity(selectedPlacement.ref)}${window.__mapEditorGizmoDragging ? ' · controls paused' : ''}`;
    const arenaRow = document.getElementById('mapEditArenaTools');
    if (arenaRow) arenaRow.style.display = deps?.getCurrentArea?.() === deps?.DEV_ARENA_ZONE_ID ? '' : 'none';
  }

  function openEditor(navigation = null) {
    const descriptor = currentDescriptor();
    if (!descriptor.editable) { setStatus(descriptor.reason, false); return; }
    const request = navigation || { type: 'navigate', requestId: window.MapLivePreview.requestId('nav'), ...descriptor };
    window.MapLivePreview.savePendingNavigation(request);
    endpoint.send(request);
    editorWindow = window.open('tools/map-editor/index.html', 'hobunji-map-editor');
    setStatus(editorWindow ? `Opening ${descriptor.name || descriptor.mapId} in Map Editor…` : 'Popup blocked — allow the Map Editor window, then try again.', !!editorWindow);
  }

  function logicalOwner(object) {
    let blocker = object;
    while (blocker) {
      if (blocker === deps.playerMesh) return { type: 'blocked', label: 'The player is not a Map Editor object.' };
      const walker = deps.npcWalkers.find(entry => entry.root === blocker || entry.avatarGroup === blocker);
      if (walker) return { type: 'blocked', label: `${walker.rec?.name || 'This NPC'} is a runtime NPC, not a Map Editor object.` };
      blocker = blocker.parent;
    }
    let node = object;
    while (node) {
      if (node.userData?.mapEditorRef) return { type: 'selection', ref: node.userData.mapEditorRef, node };
      node = node.parent;
    }
    return null;
  }

  function armPicker() {
    if (!currentDescriptor().editable || armed) return;
    armed = true;
    closePanelWithoutDisarming();
    const hint = document.getElementById('mapEditPickHint');
    if (hint) hint.style.display = 'flex';
    deps.renderer.domElement.addEventListener('pointerdown', handlePick, { capture: true, once: true });
  }

  function closePanelWithoutDisarming() {
    const panel = document.getElementById('mapEditPanel');
    if (panel) panel.style.display = 'none';
    document.getElementById('mapEditBtn')?.classList.remove('fed-open');
  }

  function disarmPicker() {
    armed = false;
    const hint = document.getElementById('mapEditPickHint');
    if (hint) hint.style.display = 'none';
    deps?.renderer?.domElement?.removeEventListener('pointerdown', handlePick, { capture: true });
  }

  function handlePick(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    armed = false;
    document.getElementById('mapEditPickHint').style.display = 'none';
    const rect = deps.renderer.domElement.getBoundingClientRect();
    const ndc = { x: ((event.clientX - rect.left) / rect.width) * 2 - 1, y: -((event.clientY - rect.top) / rect.height) * 2 + 1 };
    raycaster.setFromCamera(ndc, deps.camera);
    const hits = raycaster.intersectObjects(deps.getActiveScene()?.children || [], true);
    for (const hit of hits) {
      const owner = logicalOwner(hit.object);
      if (owner?.type === 'blocked') { setStatus(owner.label, false); return; }
      if (owner?.type === 'selection') { navigateToRef(owner.ref, owner.node); return; }
      if (hit.object.userData?.mapEditorTerrain || hit.object.userData?.terrainEdgeId != null) {
        const point = hit.point;
        navigateToRef({ kind: 'tile', col: Math.floor(point.x), row: Math.floor(point.z) });
        return;
      }
    }
    setStatus('Nothing editable was hit. Click to Select is ready to try again.', false);
  }

  function navigateToRef(ref, node = null) {
    const descriptor = currentDescriptor();
    const selection = { ...ref };
    delete selection.mapId;
    delete selection.layoutId;
    const request = {
      type: 'navigate', requestId: window.MapLivePreview.requestId('nav'),
      ...descriptor,
      mapId: ref.mapId || descriptor.mapId,
      layoutId: ref.layoutId ?? descriptor.layoutId,
      selection,
    };
    openEditor(request);
    if (node && ['decor', 'furniture'].includes(selection.kind)) attachPlacement({ ...ref, layoutId: request.layoutId }, node);
    else detachPlacement();
    setStatus(`Selected ${selection.kind}${selection.id ? ` ${selection.id}` : selection.col != null ? ` ${selection.col},${selection.row}` : ''} in Map Editor.`);
  }

  async function handleReflect(message) {
    const request = message;
    if (!request.mapId || !request.workspace) return;
    if (request.mapId === request.workspace?.gameLink?.exteriorId) {
      reply(request, { status: 'rejected', warnings: ['Farm editing uses the in-game Farm Editor.'], applyMode: 'none' });
      return;
    }
    if (request.revision <= revision) {
      reply(request, { status: 'rejected', warnings: [`Revision ${request.revision} is not newer than applied revision ${revision}.`], applyMode: 'none' });
      return;
    }
    if (selectedPlacement) detachPlacement();
    try {
      const result = await deps.applyReflection(request);
      revision = request.revision;
      reply(request, { status: 'applied', ...result });
      setStatus(`✓ r${revision} reflected ${(request.changedSections || []).join(', ') || 'map'} • ${result.applyMode} • player preserved`);
    } catch (error) {
      reply(request, { status: 'rolled-back', warnings: [error?.message || String(error)], applyMode: 'none' });
      setStatus(`r${request.revision} failed: ${error?.message || error}`, false);
    }
  }

  function reply(request, result) {
    endpoint.send({ type: 'reflect-result', requestId: request.requestId, revision: request.revision, mapId: request.mapId, playerRelocated: false, warnings: [], ...result });
  }

  function handleMessage(message) {
    if (message.type === 'editor-ready' || message.type === 'editor-state') {
      editorConnected = true;
      refreshPanel();
      endpoint.send({ type: 'game-state', map: currentDescriptor(), revision });
      return;
    }
    if (message.type === 'reflect-request') handleReflect(message);
  }

  function copyDebug() {
    const descriptor = currentDescriptor();
    const report = [
      'Map Live Preview report',
      `area=${descriptor.area} map=${descriptor.mapId || '-'} layout=${descriptor.layoutId || 'default'} generated=${!!descriptor.generated}`,
      `devMode=${!!deps.isDevMode()} editorConnected=${editorConnected} pickerArmed=${armed} revision=${revision}`,
      `last=${lastResult?.text || 'none'}`,
    ].join('\n');
    navigator.clipboard?.writeText(report).then(() => deps.showToast('Map reflection debug copied.', true)).catch(() => deps.showToast(report, true));
  }

  function bindUi() {
    document.getElementById('mapEditBtn')?.addEventListener('click', togglePanel);
    document.getElementById('mapEditCloseBtn')?.addEventListener('click', closePanel);
    document.getElementById('mapEditOpenBtn')?.addEventListener('click', () => openEditor());
    document.getElementById('mapEditPickBtn')?.addEventListener('click', armPicker);
    document.getElementById('mapEditDebugBtn')?.addEventListener('click', copyDebug);
    document.getElementById('mapEditGizmoTranslate')?.addEventListener('click', () => setGizmoMode('translate'));
    document.getElementById('mapEditGizmoRotate')?.addEventListener('click', () => setGizmoMode('rotate'));
    document.getElementById('mapEditGizmoScale')?.addEventListener('click', () => setGizmoMode('scale'));
    document.getElementById('mapEditGizmoDone')?.addEventListener('click', detachPlacement);
    document.getElementById('mapEditArenaSpawnBtn')?.addEventListener('click', () => deps.openArenaSpawner());
    document.getElementById('mapEditPickCancelBtn')?.addEventListener('click', disarmPicker);
    window.addEventListener('keydown', event => { if (event.key === 'Escape') { if (armed) disarmPicker(); else if (selectedPlacement) detachPlacement(); } });
  }

  window.MapLivePreviewRuntime = {
    init,
    refreshVisibility,
    refreshPanel,
    togglePanel,
    closePanel,
    armPicker,
    disarmPicker,
    getDebugState: () => ({ editorConnected, armed, gizmoDragging: !!window.__mapEditorGizmoDragging, selectedPlacement: selectedPlacement?.ref || null, revision, lastResult, map: currentDescriptor() }),
  };
})();
