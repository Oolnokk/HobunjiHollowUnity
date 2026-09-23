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
  let gameplayLock = null; // Shared movement/tool/action lock held for the complete placement-edit session.
  let transformSendTimer = null;
  let cameraMarkerRoot = null; // Holds dev-only cinematic camera markers while the Map Edit session is open.
  let cameraMarkerArea = ''; // Used to rebuild camera markers only when the active room/locale changes.
  let cameraMarkerSignature = ''; // Used to detect authored camera-list changes without rebuilding markers on every panel refresh.
  let cameraListSignature = ''; // Used to avoid regenerating the small camera button list when nothing visible changed.
  const cameraMarkerById = new Map(); // Maps authored camera ids to their live selectable marker groups.
  const raycaster = new THREE.Raycaster(); // Shared picker raycaster; created once instead of per pointer event.
  let orbitState = null; // {target, azimuth, elevation, distance, dragging, lastX, lastY} while a placement is selected — see startOrbit/stopOrbit.
  const ORBIT_DEG_PER_PX = 0.3;
  const ORBIT_MIN_ELEVATION_DEG = -85;
  const ORBIT_MAX_ELEVATION_DEG = 85;

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

  // includeSnapshot defaults to true for callers that actually send the
  // descriptor over the endpoint (init/game-state/navigation), which need
  // the full generated-map clone. refreshPanel/refreshVisibility only read
  // the cheap metadata fields below and pass includeSnapshot:false — without
  // that, every placement-transform-result during a gizmo drag (throttled
  // to just 45ms) was re-running the full mapSnapshot export via
  // refreshPanel()'s setStatus(), tanking FPS on any sizeable zone.
  function currentDescriptor({ includeSnapshot = true } = {}) {
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
      mapSnapshot: includeSnapshot && generated ? deps.exportGeneratedMap(mapId) : null,
    };
  }

  function cinematicCamerasForCurrentArea() {
    const areaId = String(deps?.getCurrentArea?.() || ''); // CameraRuntime registers rooms/locales under the same runtime area id Map Edit uses.
    return window.CinematicCameraRuntime?.camerasForArea?.(areaId) || [];
  }

  function resolvedCameraTarget(areaId, camera) {
    const resolved = window.CinematicCameraRuntime?.resolvedTargetForCamera?.(areaId, camera?.id); // Resolves NPC-face-relative camera targets through the same runtime used by dialogue.
    if (resolved && [resolved.x, resolved.y, resolved.z].every(Number.isFinite)) return new THREE.Vector3(resolved.x, resolved.y, resolved.z);
    return new THREE.Vector3(Number(camera?.position?.x) || 0, Number(camera?.position?.y) || 0, (Number(camera?.position?.z) || 0) - 1); // Visible fallback direction when an NPC target is temporarily unloaded.
  }

  function orientCameraMarker(node, areaId, camera) {
    if (!node || !camera) return;
    const target = resolvedCameraTarget(areaId, camera); // Used both for the marker heading and the rotation gizmo's preserved target distance.
    node.position.set(Number(camera.position?.x) || 0, Number(camera.position?.y) || 0, Number(camera.position?.z) || 0);
    if (target.distanceToSquared(node.position) > 1e-8) node.lookAt(target);
    node.userData.cameraTargetDistance = Math.max(0.25, node.position.distanceTo(target));
    if (camera.targetNpcId) {
      node.userData.cameraTargetBase = new THREE.Vector3(
        target.x - (Number(camera.target?.x) || 0),
        target.y - (Number(camera.target?.y) || 0),
        target.z - (Number(camera.target?.z) || 0),
      ); // World-space NPC face/base point used to convert a rotated marker back into the authored face-relative target offset.
    } else {
      node.userData.cameraTargetBase = null;
    }
  }

  function clearCameraMarkers() {
    if (!cameraMarkerRoot) {
      cameraMarkerArea = '';
      cameraMarkerSignature = '';
      cameraMarkerById.clear();
      return;
    }
    cameraMarkerRoot.parent?.remove(cameraMarkerRoot);
    const geometries = new Set(); // Dev-only marker geometry disposed when leaving Map Edit so repeated room visits do not accumulate GPU objects.
    const materials = new Set(); // Dev-only marker materials disposed alongside marker geometry.
    cameraMarkerRoot.traverse(object => {
      if (object?.geometry) geometries.add(object.geometry);
      const source = Array.isArray(object?.material) ? object.material : [object?.material];
      for (const material of source) if (material) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose?.());
    materials.forEach(material => material.dispose?.());
    cameraMarkerRoot = null;
    cameraMarkerArea = '';
    cameraMarkerSignature = '';
    cameraMarkerById.clear();
  }

  function createCameraMarker(areaId, camera) {
    const node = new THREE.Group(); // Selectable transform carrier; child meshes are presentation only and inherit this exact camera transform.
    node.name = `map_edit_cinematic_camera_${camera.id}`;
    node.userData.mapEditorRef = { kind: 'cinematicCamera', id: camera.id, mapId: areaId };
    node.userData.mapEditorCinematicCamera = true;
    const material = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthTest: true, depthWrite: false }); // High-contrast dev marker; never exists outside Map Edit.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.34), material);
    body.position.z = 0.05;
    body.userData.hobunjiNoOutline = true;
    const lens = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 4), material);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.31;
    lens.userData.hobunjiNoOutline = true;
    node.add(body, lens);
    orientCameraMarker(node, areaId, camera);
    cameraMarkerById.set(camera.id, node);
    return node;
  }

  function renderCameraList(cameras) {
    const section = document.getElementById('mapEditCameraSection');
    const list = document.getElementById('mapEditCameraList');
    if (section) section.style.display = cameras.length ? '' : 'none';
    if (!list) return;
    const selectedId = selectedPlacement?.ref?.kind === 'cinematicCamera' ? selectedPlacement.ref.id : '';
    const signature = cameras.map(camera => `${camera.id}:${camera.label}`).join('|') + `|selected=${selectedId}`; // Keeps ordinary panel status refreshes from churning camera-list DOM.
    if (signature === cameraListSignature) return;
    cameraListSignature = signature;
    list.replaceChildren();
    for (const camera of cameras) {
      const button = document.createElement('button'); // Direct mobile-friendly selection path in addition to clicking the world-space marker.
      button.type = 'button';
      button.className = 'fed-btn';
      button.textContent = camera.label || camera.id;
      button.classList.toggle('fed-active', camera.id === selectedId);
      button.addEventListener('click', () => selectCameraById(camera.id));
      list.appendChild(button);
    }
  }

  function syncCameraMarkers(force = false) {
    const cameras = cinematicCamerasForCurrentArea();
    renderCameraList(cameras);
    const shouldShow = !!(window.__mapEditorPanelOpen || armed || selectedPlacement?.ref?.kind === 'cinematicCamera');
    if (!shouldShow || !cameras.length) {
      if (!shouldShow || !cameras.length) clearCameraMarkers();
      return;
    }
    const areaId = String(deps?.getCurrentArea?.() || '');
    const scene = deps?.getActiveScene?.();
    if (!areaId || !scene) { clearCameraMarkers(); return; }
    const signature = `${areaId}|${cameras.map(camera => camera.id).join('|')}`; // Rebuild only for area/list changes; transform drags update marker nodes in place.
    if (force || !cameraMarkerRoot || cameraMarkerRoot.parent !== scene || cameraMarkerArea !== areaId || cameraMarkerSignature !== signature) {
      if (selectedPlacement?.ref?.kind === 'cinematicCamera') detachPlacement();
      clearCameraMarkers();
      cameraMarkerRoot = new THREE.Group();
      cameraMarkerRoot.name = 'map_edit_cinematic_cameras';
      cameraMarkerRoot.userData.hobunjiNoOutline = true;
      for (const camera of cameras) cameraMarkerRoot.add(createCameraMarker(areaId, camera));
      scene.add(cameraMarkerRoot);
      cameraMarkerArea = areaId;
      cameraMarkerSignature = signature;
      return;
    }
    for (const camera of cameras) {
      const node = cameraMarkerById.get(camera.id);
      if (!node || selectedPlacement?.node === node) continue;
      orientCameraMarker(node, areaId, camera);
    }
  }

  function selectCameraById(cameraId) {
    syncCameraMarkers();
    const node = cameraMarkerById.get(String(cameraId || '')); // Direct list selection resolves to the same world marker used by ray picking.
    if (!node) { setStatus(`Cinematic camera ${cameraId} is not available in this room/locale.`, false); return; }
    navigateToRef(node.userData.mapEditorRef, node);
  }

  function refreshVisibility() {
    const button = document.getElementById('mapEditBtn');
    if (!deps) { if (button) button.style.display = 'none'; return; }
    const descriptor = currentDescriptor({ includeSnapshot: false });
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
    // Read by game.js's mousemove handler: mouse-driven camera rotation is
    // suppressed for the whole Map Edit session, not just while a placement
    // is actively selected (__mapEditorGizmoActive) — otherwise stray mouse
    // movement spins the camera out from under the panel, or fights a
    // Click to Select attempt before anything is even selected yet.
    window.__mapEditorPanelOpen = open;
    if (open) {
      syncCameraMarkers(true);
      refreshPanel();
    } else {
      disarmPicker();
      if (selectedPlacement) detachPlacement();
      clearCameraMarkers();
    }
  }

  function closePanel() {
    const panel = document.getElementById('mapEditPanel');
    if (panel) panel.style.display = 'none';
    document.getElementById('mapEditBtn')?.classList.remove('fed-open');
    window.__mapEditorPanelOpen = false;
    disarmPicker();
    if (selectedPlacement) detachPlacement();
    clearCameraMarkers();
  }

  function ensureTransformControl() {
    if (transformControl || !THREE.TransformControls) return transformControl;
    transformControl = new THREE.TransformControls(deps.camera, deps.renderer.domElement);
    transformControl.setMode('translate');
    transformControl.addEventListener('dragging-changed', event => {
      window.__mapEditorGizmoDragging = !!event.value;
      if (!event.value) sendPlacementTransform(true);
      refreshPanel();
    });
    transformControl.addEventListener('objectChange', () => {
      sendPlacementTransform(false);
      refreshTransformReadout();
    });
    return transformControl;
  }

  function placementIdentity(ref) {
    return ref.id || `${ref.key || ''}@${ref.col},${ref.row}`;
  }

  function attachPlacement(ref, node) {
    const isCamera = ref?.kind === 'cinematicCamera'; // Cinematic cameras use the same TransformControls session but serialize position/target instead of furniture post offsets.
    if ((!['decor', 'furniture'].includes(ref?.kind) && !isCamera) || !node) { detachPlacement(); return; }
    const control = ensureTransformControl();
    if (!control) { setStatus('Transform gizmo unavailable: TransformControls did not load.', false); return; }
    control.parent?.remove(control);
    deps.getActiveScene()?.add(control);
    const basePosition = node.position.clone();
    if (!isCamera) {
      basePosition.x -= ref.postX || 0; basePosition.y -= ref.postY || 0; basePosition.z -= ref.postZ || 0;
    }
    selectedPlacement = { ref: { ...ref }, node, basePosition };
    if (isCamera) {
      const camera = window.CinematicCameraRuntime?.cameraForId?.(ref.mapId || deps.getCurrentArea(), ref.id); // Exact normalized authored record edited live by this marker.
      selectedPlacement.cameraRecord = camera || null;
      selectedPlacement.cameraTargetDistance = Number(node.userData.cameraTargetDistance) || 1;
      selectedPlacement.cameraTargetBase = node.userData.cameraTargetBase?.clone?.() || null;
    }
    window.__mapEditorGizmoActive = true;
    gameplayLock = gameplayLock || window.CharacterActionLocks?.acquire?.({ owner: 'map-editor-gizmo', reason: 'Adjusting a map placement', participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }] });
    control.attach(node);
    if (isCamera) setGizmoMode('translate');
    startOrbit(node);
    refreshPanel();
  }

  function detachPlacement() {
    clearTimeout(transformSendTimer);
    transformControl?.detach();
    gameplayLock?.release?.(); gameplayLock = null;
    window.__mapEditorGizmoDragging = false;
    window.__mapEditorGizmoActive = false;
    stopOrbit();
    selectedPlacement = null;
    const scaleButton = document.getElementById('mapEditGizmoScale'); // Re-enabled after leaving a camera, whose authored transform has no scale component.
    if (scaleButton) scaleButton.disabled = false;
    refreshPanel();
  }

  // While a placement is selected, the player's own follow camera
  // (game.js's updateCameraPosition, which skips its normal pose whenever
  // window.__mapEditorOrbitActive is set) is replaced by a free orbit
  // around the selected object, so it can be inspected/positioned from any
  // angle instead of whatever direction the player happens to be facing.
  // Starts from the camera's current view of the target (no snap-cut), and
  // only engages on a plain click-drag that misses every TransformControls
  // handle — dragging the move/rotate/scale gizmo itself must never also
  // spin the camera.
  function sphericalFromCameraToTarget(targetPos) {
    const offset = deps.camera.position.clone().sub(targetPos);
    const distance = Math.max(0.5, offset.length());
    const elevation = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(offset.y / distance, -1, 1))), ORBIT_MIN_ELEVATION_DEG, ORBIT_MAX_ELEVATION_DEG);
    const azimuth = THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z));
    return { azimuth, elevation, distance };
  }

  function applyOrbitCamera() {
    if (!orbitState) return;
    const { azimuth, elevation, distance, target } = orbitState;
    const azRad = THREE.MathUtils.degToRad(azimuth);
    const elRad = THREE.MathUtils.degToRad(elevation);
    const horizontal = Math.cos(elRad) * distance;
    const tx = target.position.x, ty = target.position.y, tz = target.position.z;
    deps.camera.position.set(tx + horizontal * Math.sin(azRad), ty + Math.sin(elRad) * distance, tz + horizontal * Math.cos(azRad));
    deps.camera.lookAt(tx, ty, tz);
  }

  function onOrbitPointerDown(event) {
    if (!orbitState || event.button !== 0) return;
    // transformControl's own pointerdown listener (registered once, when
    // ensureTransformControl() first constructed it — always before this
    // per-selection listener, which is added fresh in startOrbit on every
    // attach) has already run by the time this fires, synchronously setting
    // .axis/.dragging if the pointer hit a gizmo handle. Only orbit when it
    // didn't.
    if (transformControl?.dragging || transformControl?.axis) return;
    orbitState.dragging = true;
    orbitState.lastX = event.clientX;
    orbitState.lastY = event.clientY;
    window.addEventListener('pointermove', onOrbitPointerMove);
    window.addEventListener('pointerup', onOrbitPointerUp);
  }

  function onOrbitPointerMove(event) {
    if (!orbitState?.dragging) return;
    const dx = event.clientX - orbitState.lastX;
    const dy = event.clientY - orbitState.lastY;
    orbitState.lastX = event.clientX;
    orbitState.lastY = event.clientY;
    orbitState.azimuth -= dx * ORBIT_DEG_PER_PX;
    orbitState.elevation = THREE.MathUtils.clamp(orbitState.elevation + dy * ORBIT_DEG_PER_PX, ORBIT_MIN_ELEVATION_DEG, ORBIT_MAX_ELEVATION_DEG);
    applyOrbitCamera();
  }

  function onOrbitPointerUp() {
    if (orbitState) orbitState.dragging = false;
    window.removeEventListener('pointermove', onOrbitPointerMove);
    window.removeEventListener('pointerup', onOrbitPointerUp);
  }

  function startOrbit(node) {
    stopOrbit();
    const spherical = sphericalFromCameraToTarget(node.position);
    orbitState = { target: node, dragging: false, lastX: 0, lastY: 0, ...spherical };
    window.__mapEditorOrbitActive = true;
    deps.renderer.domElement.addEventListener('pointerdown', onOrbitPointerDown);
    applyOrbitCamera(); // reproduces the camera's current pose from the derived angles — no visible jump on selection
  }

  function stopOrbit() {
    if (!orbitState) return;
    deps.renderer.domElement.removeEventListener('pointerdown', onOrbitPointerDown);
    window.removeEventListener('pointermove', onOrbitPointerMove);
    window.removeEventListener('pointerup', onOrbitPointerUp);
    orbitState = null;
    window.__mapEditorOrbitActive = false;
  }

  function setGizmoMode(mode) {
    if (selectedPlacement?.ref?.kind === 'cinematicCamera' && mode === 'scale') return; // Cameras author position + aim; FOV is separate data, not transform scale.
    ensureTransformControl()?.setMode(mode);
    for (const [id, value] of [['mapEditGizmoTranslate','translate'],['mapEditGizmoRotate','rotate'],['mapEditGizmoScale','scale']]) {
      document.getElementById(id)?.classList.toggle('fed-active', value === mode);
    }
  }

  function roundedPoint(point) {
    return { x: +(Number(point?.x) || 0).toFixed(3), y: +(Number(point?.y) || 0).toFixed(3), z: +(Number(point?.z) || 0).toFixed(3) };
  }

  function cameraPlacementTransform() {
    if (selectedPlacement?.ref?.kind !== 'cinematicCamera') return null;
    const { ref, node } = selectedPlacement;
    const areaId = String(ref.mapId || deps.getCurrentArea() || ''); // Runtime camera registry key and persisted Map Editor map id for ordinary authored rooms.
    const runtime = window.CinematicCameraRuntime;
    const camera = runtime?.cameraForId?.(areaId, ref.id);
    if (!camera) return null;
    const position = roundedPoint(node.position); // Authored world-space camera position written directly, unlike decor post-offset transforms.
    const mode = transformControl?.mode || 'translate'; // Determines whether movement preserves the existing target or rotation authors a new aim point.
    if (mode === 'rotate') {
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(node.quaternion).normalize(); // Object3D.lookAt points +Z toward the camera target.
      const targetWorld = node.position.clone().addScaledVector(direction, selectedPlacement.cameraTargetDistance || 1);
      let target = targetWorld;
      if (camera.targetNpcId) {
        const base = selectedPlacement.cameraTargetBase;
        if (base) target = targetWorld.clone().sub(base);
        else target = null; // Do not corrupt a face-relative target if its NPC is currently unavailable for world-space resolution.
      }
      runtime.updateCameraTransform?.(areaId, ref.id, target ? { position, target: roundedPoint(target) } : { position });
    } else {
      runtime.updateCameraTransform?.(areaId, ref.id, { position });
      const worldTarget = runtime.resolvedTargetForCamera?.(areaId, ref.id); // Translation moves only the camera; its existing absolute/NPC-relative target stays fixed.
      if (worldTarget && [worldTarget.x, worldTarget.y, worldTarget.z].every(Number.isFinite)) {
        node.lookAt(worldTarget.x, worldTarget.y, worldTarget.z);
        selectedPlacement.cameraTargetDistance = Math.max(0.25, node.position.distanceTo(new THREE.Vector3(worldTarget.x, worldTarget.y, worldTarget.z)));
      }
    }
    const updated = runtime.cameraForId?.(areaId, ref.id) || camera;
    return { position: roundedPoint(updated.position), target: roundedPoint(updated.target) };
  }

  function placementTransform() {
    if (!selectedPlacement) return null;
    if (selectedPlacement.ref?.kind === 'cinematicCamera') return cameraPlacementTransform();
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

  function refreshTransformReadout() {
    const output = document.getElementById('mapEditGizmoTransform');
    if (!output || !selectedPlacement) { if (output) output.textContent = ''; return; }
    if (selectedPlacement.ref?.kind === 'cinematicCamera') {
      const areaId = selectedPlacement.ref.mapId || deps.getCurrentArea();
      const camera = window.CinematicCameraRuntime?.cameraForId?.(areaId, selectedPlacement.ref.id);
      if (!camera) { output.textContent = 'Camera transform unavailable.'; return; }
      const p = roundedPoint(camera.position), t = roundedPoint(camera.target);
      output.textContent = `Position ${p.x}, ${p.y}, ${p.z} • ${camera.targetNpcId ? 'Face offset' : 'Target'} ${t.x}, ${t.y}, ${t.z}`;
      return;
    }
    const { node, basePosition } = selectedPlacement;
    output.textContent = `Offset ${(node.position.x - basePosition.x).toFixed(2)}, ${(node.position.y - basePosition.y).toFixed(2)}, ${(node.position.z - basePosition.z).toFixed(2)} • Yaw ${(node.rotation.y * 180 / Math.PI).toFixed(1)}°`;
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
    const descriptor = deps ? currentDescriptor({ includeSnapshot: false }) : { editable: false };
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
    if (window.__mapEditorPanelOpen || armed || selectedPlacement?.ref?.kind === 'cinematicCamera') syncCameraMarkers();
    const gizmoSection = document.getElementById('mapEditGizmoSection');
    if (gizmoSection) gizmoSection.style.display = selectedPlacement ? '' : 'none';
    const gizmoLabel = document.getElementById('mapEditGizmoSelection');
    if (gizmoLabel && selectedPlacement) gizmoLabel.textContent = `${selectedPlacement.ref.kind} · ${placementIdentity(selectedPlacement.ref)} · controls paused`;
    const scaleButton = document.getElementById('mapEditGizmoScale');
    if (scaleButton) scaleButton.disabled = selectedPlacement?.ref?.kind === 'cinematicCamera';
    refreshTransformReadout();
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
    syncCameraMarkers(); // Camera markers must already exist before the panel hides and the world-space picker captures the next tap.
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
    let blockedHit = null;
    let terrainHit = null;
    for (const hit of hits) {
      const owner = logicalOwner(hit.object);
      if (owner?.type === 'selection') { navigateToRef(owner.ref, owner.node); return; }
      if (owner?.type === 'blocked' && !blockedHit) blockedHit = owner;
      if ((hit.object.userData?.mapEditorTerrain || hit.object.userData?.terrainEdgeId != null) && !terrainHit) terrainHit = hit;
    }
    // Prefer authored placements anywhere under the pointer over terrain or a
    // player/NPC plane in front of them; sprite planes otherwise made nearby
    // furniture feel impossible to select.
    if (terrainHit) {
      navigateToRef({ kind: 'tile', col: Math.floor(terrainHit.point.x), row: Math.floor(terrainHit.point.z) });
      return;
    }
    setStatus(blockedHit?.label || `Nothing editable was hit (${hits.length} ray hits). Click to Select is ready to try again.`, false);
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
    // Keep the pointer workflow in the game. An already-open Map Editor follows
    // this selection, while the pending navigation is retained for the explicit
    // Open Map Editor button instead of stealing focus during gizmo use.
    window.MapLivePreview.savePendingNavigation(request);
    endpoint.send(request);
    if (node && ['decor', 'furniture', 'cinematicCamera'].includes(selection.kind)) attachPlacement({ ...ref, layoutId: request.layoutId }, node);
    else detachPlacement();
    const syncNote = editorConnected ? 'Map Editor synchronized.' : 'Open Map Editor to persist this session edit.';
    setStatus(`Selected ${selection.kind}${selection.id ? ` ${selection.id}` : selection.col != null ? ` ${selection.col},${selection.row}` : ''}. ${syncNote}`);
  }

  let reflectQueue = Promise.resolve(); // Serializes reflect-requests so overlapping async applies can never interleave scene teardown/rebuild.

  function handleReflect(message) {
    const request = message;
    if (!request.mapId || !request.workspace) return;
    if (request.mapId === request.workspace?.gameLink?.exteriorId) {
      reply(request, { status: 'rejected', warnings: ['Farm editing uses the in-game Farm Editor.'], applyMode: 'none' });
      return;
    }
    // Chained rather than awaited directly: a second reflect-request arriving
    // while the first is still mid-await (e.g. inside _loadTownFromWorkspace)
    // must wait its turn instead of running deps.applyReflection concurrently.
    reflectQueue = reflectQueue.then(() => applyReflectNow(request));
  }

  async function applyReflectNow(request) {
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
    if (message.type === 'placement-transform-result') {
      if (message.status === 'applied') setStatus('Transform updated in Map Editor.');
      else if (message.status === 'runtime-only') setStatus('Camera updated live; this locale/source is not loaded as a Map Editor map, so the numeric transform remains available here for authoring.');
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
      `cinematicCameras=${cinematicCamerasForCurrentArea().length} markers=${cameraMarkerById.size} selected=${selectedPlacement?.ref?.kind || '-'}:${selectedPlacement?.ref?.id || '-'}`,
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
