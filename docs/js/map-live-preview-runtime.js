(() => {
  'use strict';

  let deps = null; // Runtime closures injected by game.js; used for area/map resolution and scene-local application.
  let endpoint = null; // BroadcastChannel endpoint retained for the whole game session.
  let editorConnected = false; // Drives the mobile-visible connection badge.
  let armed = false; // One-shot click-to-select state, deliberately separate from Pixel Probe's state.
  let revision = 0; // Last applied live-preview revision.
  let lastResult = null; // Latest reflection/navigation diagnostic shown in the Map Edit panel.
  let editorWindow = null; // Named standalone editor window, reused rather than opening duplicate tabs.
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
      if (owner?.type === 'selection') { navigateToRef(owner.ref); return; }
      if (hit.object.userData?.mapEditorTerrain || hit.object.userData?.terrainEdgeId != null) {
        const point = hit.point;
        navigateToRef({ kind: 'tile', col: Math.floor(point.x), row: Math.floor(point.z) });
        return;
      }
    }
    setStatus('Nothing editable was hit. Click to Select is ready to try again.', false);
  }

  function navigateToRef(ref) {
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
    document.getElementById('mapEditArenaSpawnBtn')?.addEventListener('click', () => deps.openArenaSpawner());
    document.getElementById('mapEditPickCancelBtn')?.addEventListener('click', disarmPicker);
    window.addEventListener('keydown', event => { if (event.key === 'Escape' && armed) disarmPicker(); });
  }

  window.MapLivePreviewRuntime = {
    init,
    refreshVisibility,
    refreshPanel,
    togglePanel,
    closePanel,
    armPicker,
    disarmPicker,
    getDebugState: () => ({ editorConnected, armed, revision, lastResult, map: currentDescriptor() }),
  };
})();
