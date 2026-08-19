// Dedicated editor-only close-up for calibrating the hand against the held tool.
// Uses its own Three.js scene/camera so entering this view cannot alter attack playback,
// the normal avatar viewport, or any gameplay-owned playerMesh/hand lifecycle state.
(function (global) {
  'use strict';

  if (!/\/tools\/attack-animation-editor\//.test(location.pathname)) return;
  if (global.HobunjiAttackEditorHandToolCloseup) return;

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralHandAttachments;
  const gripModes = global.HobunjiHandGripModes;
  const toolGrips = global.HobunjiHandToolGrips;
  const semanticBasis = global.HobunjiHandToolSemanticBasis;
  if (!profiles || !hands?.attach || !gripModes || !toolGrips || !semanticBasis) return;

  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('../../', location.href);
  const TOOL_MODEL_WIDTH = 0.5; // Same canonical width used by the normal Attack Animation Editor tool plane.
  const TOOL_DEFS = Object.freeze({
    hatchet: { sprite: 'assets/toolsprites/axe_hatchet.png' },
    pickshovel: { sprite: 'assets/toolsprites/shovel_pickshovel.png' },
    bronzehoe: { sprite: 'assets/toolsprites/hoe_bronzehoe.png' },
    fishingspear: { sprite: 'assets/toolsprites/harpoon_fishingspear.png' },
    fishingmace: { sprite: 'assets/toolsprites/harpoon_fishingmace.png' },
    bottle: { sprite: 'assets/objectsprites/bottle_wine.png', scale: 0.5, flip: true },
    crossbow: { sprite: 'assets/toolsprites/ranged_crossbow.png' },
    crossbowLoaded: { sprite: 'assets/toolsprites/ranged_crossbow_loaded.png' },
    scatterbow: { sprite: 'assets/toolsprites/ranged_scatterbow.png' },
    scatterbowLoaded: { sprite: 'assets/toolsprites/ranged_scatterbow_loaded.png' },
  });

  const $ = id => document.getElementById(id);
  let enabled = false; // True while the close-up overlay replaces the normal viewport visually.
  let initialized = false; // Prevents duplicate renderer/DOM construction while async module imports settle.
  let THREE = null;
  let OrbitControls = null;
  let overlay = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let contentRoot = null;
  let primaryAxes = null;
  let secondaryAxes = null;
  let handRig = null;
  let handRigSpecies = '';
  let handRigGender = '';
  let toolRoot = null;
  let toolBasisRoot = null; // Semantic/raw-PNG orientation layer between the tool pose and the sprite plane.
  let toolPlane = null;
  let toolTexture = null;
  let loadedToolKey = '';
  let toolRequestSerial = 0; // Rejects stale texture callbacks after rapid tool switching.
  let refitRequested = true; // Only initial entry/manual Refit may set this; authoring edits preserve the camera.
  let hasInitialFit = false; // Keeps orbit/zoom persistent after the first successful content fit.
  let lastSecondGripActive = false;
  let lastToolScale = NaN;
  let lastStyle = '';
  let lastToolBasisSource = 'none';
  let lastToolBasisApplied = false;

  function currentSpecies() { return String($('avatarSpecies')?.value || '').trim(); }
  function currentGender() { return String($('avatarGender')?.value || 'male').trim(); }
  function currentToolKey() { return String($('toolSpriteSelect')?.value || '').trim(); }
  function currentStyle() { return String($('animStyle')?.value || '').trim().toLowerCase(); }
  function currentToolScale() {
    const value = Number($('neutral_scale')?.value);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function toolDef(key) { return TOOL_DEFS[key] || null; }
  function toolGripKey() { return toolGrips.toolKeyFor?.(currentToolKey()) || currentToolKey(); }

  function injectUi() {
    const viewport = $('viewport');
    if (!viewport || $('handToolCloseupToggle')) return false;

    const toggle = document.createElement('button');
    toggle.id = 'handToolCloseupToggle';
    toggle.className = 'secondary';
    toggle.textContent = '✋ Hand + Tool';
    toggle.style.cssText = 'position:absolute;left:10px;top:10px;z-index:8;font-size:12px;padding:6px 9px';
    viewport.appendChild(toggle);

    overlay = document.createElement('div');
    overlay.id = 'handToolCloseupViewport';
    // Must sit above the enter button. setEnabled also hides the opener so the
    // Full Avatar button can never be blocked by the control that entered this view.
    overlay.style.cssText = 'position:absolute;inset:0;z-index:9;display:none;background:#0b0f14;overflow:hidden';
    overlay.innerHTML = `
      <div style="position:absolute;left:10px;top:10px;z-index:4;display:flex;gap:7px;align-items:center;flex-wrap:wrap">
        <button id="handToolCloseupBack" class="secondary" style="font-size:12px;padding:6px 9px">← Full Avatar</button>
        <button id="handToolCloseupRefit" class="secondary" style="font-size:12px;padding:6px 9px">◎ Refit</button>
        <label style="display:flex;align-items:center;gap:5px;margin:0;padding:5px 8px;border:1px solid rgba(255,255,255,.14);border-radius:9px;background:rgba(0,0,0,.42);color:#c7d4e7;font-size:11px">
          <input id="handToolCloseupSecond" type="checkbox" checked style="width:auto;margin:0"> Show second hand if enabled
        </label>
      </div>
      <div id="handToolCloseupStatus" style="position:absolute;left:10px;bottom:10px;z-index:4;max-width:min(680px,92%);padding:7px 9px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(0,0,0,.58);font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e8eef7;pointer-events:none"></div>
    `;
    viewport.appendChild(overlay);

    toggle.addEventListener('click', () => setEnabled(true));
    $('handToolCloseupBack')?.addEventListener('click', () => setEnabled(false));
    $('handToolCloseupRefit')?.addEventListener('click', requestRefit);
    // Toggling any authored/display value updates geometry immediately but does
    // not touch OrbitControls. Refit is deliberately explicit so a carefully
    // chosen macro camera angle survives slider/number/mirror/grip/basis changes.
    return true;
  }

  function requestRefit() { refitRequested = true; }

  function setEnabled(value) {
    enabled = !!value;
    if (overlay) overlay.style.display = enabled ? 'block' : 'none';
    const toggle = $('handToolCloseupToggle');
    if (toggle) {
      toggle.style.visibility = enabled ? 'hidden' : '';
      toggle.style.pointerEvents = enabled ? 'none' : '';
    }
    if (enabled) {
      resize();
      if (!hasInitialFit) requestRefit();
      syncAll();
    }
    return enabled;
  }

  function disposeTool() {
    if (toolRoot?.parent) toolRoot.parent.remove(toolRoot);
    toolRoot?.traverse?.(node => {
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
      for (const material of materials) material?.dispose?.();
    });
    toolTexture?.dispose?.();
    toolRoot = null;
    toolBasisRoot = null;
    toolPlane = null;
    toolTexture = null;
  }

  function applyToolPresentationBasis() {
    if (!toolBasisRoot || !toolPlane) return false;
    const key = toolGripKey();
    const basis = semanticBasis.toolBasisFor?.(key) || null;
    const correction = basis?.complete ? semanticBasis.toolEngineQuaternionFor?.(key) : null;
    const def = toolDef(currentToolKey());
    const style = currentStyle();

    toolBasisRoot.quaternion.identity();
    toolPlane.rotation.set(0, 0, 0);
    if (correction) {
      // Authored semantics own the raw sprite orientation. +Y means haft butt→head,
      // +X means working side, and the shared engine mapping lays that canonical
      // frame into the same holder space used by gameplay. No style-specific raw
      // PNG twist is allowed to reinterpret the authored axes.
      toolBasisRoot.quaternion.set(correction.x, correction.y, correction.z, correction.w).normalize();
      lastToolBasisSource = basis.source || 'semantic';
      lastToolBasisApplied = true;
    } else {
      // Exact legacy fallback for every unauthored tool.
      toolPlane.rotation.x = def?.flip ? Math.PI / 2 : -Math.PI / 2;
      toolPlane.rotation.z = style === 'sweep' ? -Math.PI / 2 : 0;
      lastToolBasisSource = 'legacy-raw-png';
      lastToolBasisApplied = false;
    }
    toolBasisRoot.updateMatrix?.();
    toolPlane.updateMatrix?.();
    return lastToolBasisApplied;
  }

  async function rebuildTool(key) {
    if (!THREE || !contentRoot) return;
    const request = ++toolRequestSerial;
    loadedToolKey = key;
    disposeTool();
    const def = toolDef(key);
    if (!def) return;

    const texture = await new Promise(resolve => {
      const loader = new THREE.TextureLoader();
      loader.load(new URL(def.sprite, docsBase).href, resolve, undefined, () => resolve(null));
    });
    if (request !== toolRequestSerial) {
      texture?.dispose?.();
      return;
    }
    if (!texture) return;

    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    const imageWidth = Number(texture.image?.width) || 1;
    const imageHeight = Number(texture.image?.height) || 1;
    const planeWidth = TOOL_MODEL_WIDTH * (Number(def.scale) || 1);
    const planeHeight = planeWidth * imageHeight / imageWidth;
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(geometry, material);
    plane.name = 'hand_tool_closeup_plane';

    const basisRoot = new THREE.Group();
    basisRoot.name = 'hand_tool_closeup_semantic_basis';
    basisRoot.add(plane);
    const root = new THREE.Group();
    root.name = 'hand_tool_closeup_tool';
    root.add(basisRoot);
    contentRoot.add(root);
    toolTexture = texture;
    toolRoot = root;
    toolBasisRoot = basisRoot;
    toolPlane = plane;
    lastToolScale = NaN;
    lastStyle = '';
    applyToolPresentationBasis();
  }

  function disposeHandRig() {
    handRig?.dispose?.();
    handRig = null;
    handRigSpecies = '';
    handRigGender = '';
  }

  function ensureHandRig() {
    const species = currentSpecies();
    const gender = currentGender();
    if (!species || !profiles.modelKeyForSpecies?.(species)) return null;
    if (handRig && handRigSpecies === species && handRigGender === gender) return handRig;

    disposeHandRig();
    const modelHeight = Number(global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth) || 0.9;
    handRig = hands.attach(THREE, contentRoot, {
      speciesId: species,
      gender,
      modelHeight,
      handAttachX: -modelHeight * 0.28,
      handAttachY: modelHeight * 0.45,
      name: 'attack_editor_hand_tool_closeup',
    });
    handRigSpecies = species;
    handRigGender = gender;
    return handRig;
  }

  function quaternionFromDeg(rotation = {}) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(rotation.pitch) || 0),
      THREE.MathUtils.degToRad(Number(rotation.yaw) || 0),
      THREE.MathUtils.degToRad(Number(rotation.roll) || 0),
      'YXZ',
    ));
  }

  function effectiveHandTransform(species) {
    return gripModes.effectiveFrameForSpecies?.(species)
      || profiles.handTransformForSpecies?.(species)
      || {};
  }

  function handFrameFromSocket(socketPosition, socketQuaternion, species, gender) {
    const raw = effectiveHandTransform(species);
    const p = raw.position || {};
    const q = raw.rotationQuaternion;
    const handRotation = q && [q.x, q.y, q.z, q.w].every(value => Number.isFinite(Number(value)))
      ? new THREE.Quaternion(Number(q.x), Number(q.y), Number(q.z), Number(q.w)).normalize()
      : quaternionFromDeg(raw.rotationDeg || {});
    const modelHeight = Number(global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth) || 0.9;
    const effectiveScale = Number(profiles.effectiveScaleFor?.(species, gender)) || 1;
    const unit = modelHeight * (Number(profiles.data?.handHeightFraction) || 0.12) * effectiveScale;
    const offset = new THREE.Vector3(
      (Number(p.x) || 0) * unit,
      (Number(p.y) || 0) * unit,
      (Number(p.z) || 0) * unit,
    ).applyQuaternion(socketQuaternion);
    return {
      position: socketPosition.clone().add(offset),
      quaternion: socketQuaternion.clone().multiply(handRotation),
    };
  }

  function syncHandPlacement() {
    const rig = ensureHandRig();
    if (!rig) return;
    const species = currentSpecies();
    const gender = currentGender();
    const primary = handFrameFromSocket(new THREE.Vector3(), new THREE.Quaternion(), species, gender);
    rig.placeHandWorld?.('right', primary.position, primary.quaternion);
    rig.setSideVisible?.('right', true);

    const secondary = toolGrips.secondaryGripForTool?.(toolGripKey()) || null;
    const showSecond = $('handToolCloseupSecond')?.checked !== false;
    if (secondary && showSecond) {
      const socketPosition = new THREE.Vector3(
        Number(secondary.position?.x) || 0,
        Number(secondary.position?.y) || 0,
        Number(secondary.position?.z) || 0,
      );
      const socketQuaternion = quaternionFromDeg(secondary.rotationDeg || {});
      const left = handFrameFromSocket(socketPosition, socketQuaternion, species, gender);
      rig.placeHandWorld?.('left', left.position, left.quaternion);
      rig.setSideVisible?.('left', true);
      secondaryAxes.position.copy(socketPosition);
      secondaryAxes.quaternion.copy(socketQuaternion);
      secondaryAxes.visible = true;
    } else {
      rig.setSideVisible?.('left', false);
      secondaryAxes.visible = false;
    }

    lastSecondGripActive = !!(secondary && showSecond);
  }

  function syncToolVisual() {
    const key = currentToolKey();
    if (key !== loadedToolKey) rebuildTool(key);
    if (!toolRoot || !toolPlane) return;

    const scale = currentToolScale();
    if (!Number.isFinite(lastToolScale) || Math.abs(scale - lastToolScale) > 0.00001) {
      toolRoot.scale.setScalar(scale);
      lastToolScale = scale;
    }

    // Re-evaluate every frame so Basis authoring updates the actual Hand + Tool
    // presentation immediately without rebuilding or disturbing OrbitControls.
    applyToolPresentationBasis();
    lastStyle = currentStyle();
  }

  function contentBounds() {
    contentRoot.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const addVisible = object => {
      if (!object?.visible) return;
      const objectBox = new THREE.Box3().setFromObject(object);
      if (!objectBox.isEmpty()) box.union(objectBox);
    };
    addVisible(toolRoot);
    addVisible(handRig?.group?.getObjectByName?.('right_hand_visual'));
    addVisible(handRig?.group?.getObjectByName?.('left_hand_visual'));
    return box;
  }

  function fitContent() {
    if (!camera || !controls || !contentRoot) return false;
    const box = contentBounds();
    if (box.isEmpty()) return false;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.06, size.length() * 0.5);
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 0.000001) direction.set(1, 0.55, 1);
    direction.normalize();
    const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const distance = Math.max(0.18, radius / Math.max(0.15, Math.sin(halfFov)) * 1.15);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    // Grip calibration needs true macro inspection. The previous radius*0.25
    // floor stopped well before the hand filled the viewport; allow roughly
    // an order of magnitude more dolly-in while keeping a tiny nonzero floor.
    controls.minDistance = Math.max(0.004, radius * 0.025);
    controls.maxDistance = Math.max(2, radius * 12);
    camera.near = Math.max(0.00025, distance / 1000);
    camera.far = Math.max(20, distance * 30);
    camera.updateProjectionMatrix();
    controls.update();
    hasInitialFit = true;
    return true;
  }

  function resize() {
    if (!renderer || !camera || !overlay || !enabled) return;
    const rect = overlay.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
  }

  function mirrorLabelForSpecies(species) {
    const model = profiles.modelForSpecies?.(species) || null;
    const axes = global.ProceduralHandPairMirror?.axesForModel?.(model) || null;
    if (!axes) return model?.horizontalMirrorX === true ? 'mirror X' : 'mirror none';
    const enabledAxes = ['x', 'y', 'z'].filter(axis => axes[axis]).map(axis => axis.toUpperCase());
    return `mirror ${enabledAxes.length ? enabledAxes.join('+') : 'none'}`;
  }

  function updateStatus() {
    const status = $('handToolCloseupStatus');
    if (!status) return;
    const species = currentSpecies() || '-';
    const gender = currentGender() || '-';
    const model = profiles.modelKeyForSpecies?.(species) || '-';
    const grip = gripModes.currentModeKey?.() || '-';
    const secondary = toolGrips.secondaryGripForTool?.(toolGripKey()) || null;
    const handBasis = semanticBasis.handBasisForSpecies?.(species) || null;
    const toolBasisText = lastToolBasisApplied ? `toolBasis=${lastToolBasisSource}` : 'toolBasis=legacy';
    const handBasisText = handBasis?.valid ? `handBasis=${handBasis.source || 'semantic'}` : 'handBasis=legacy';
    status.textContent = `HAND + TOOL CLOSE-UP · ${species}/${gender} → ${model} · ${currentToolKey() || '-'} · grip ${grip} · ${mirrorLabelForSpecies(species)} · ${toolBasisText} · ${handBasisText} · right=primary${secondary ? ' · left=secondary enabled' : ' · left=hidden (secondary off)'} · drag=orbit · wheel/pinch=zoom · camera preserved until Refit`;
  }

  function syncAll() {
    if (!initialized) return;
    syncToolVisual();
    syncHandPlacement();
    updateStatus();
  }

  function animate() {
    global.requestAnimationFrame(animate);
    if (!initialized || !enabled) return;
    syncAll();
    if (refitRequested) {
      refitRequested = false;
      fitContent();
    }
    controls.update();
    renderer.render(scene, camera);
  }

  async function boot() {
    if (initialized) return;
    if (!injectUi()) {
      global.requestAnimationFrame(boot);
      return;
    }
    try {
      [THREE, { OrbitControls }] = await Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js'),
      ]);
    } catch (error) {
      console.warn('[HandToolCloseup] Three.js module import failed:', error);
      $('handToolCloseupToggle')?.remove();
      overlay?.remove();
      return;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f14);
    camera = new THREE.PerspectiveCamera(42, 1, 0.00025, 30);
    camera.position.set(0.65, 0.45, 0.85);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    overlay.prepend(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.target.set(0, 0, 0);
    controls.update();

    scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2.15));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(2, 3, 2);
    scene.add(keyLight);
    contentRoot = new THREE.Group();
    contentRoot.name = 'hand_tool_closeup_content';
    scene.add(contentRoot);
    primaryAxes = new THREE.AxesHelper(0.09);
    primaryAxes.name = 'primary_tool_grip_axes';
    contentRoot.add(primaryAxes);
    secondaryAxes = new THREE.AxesHelper(0.075);
    secondaryAxes.name = 'secondary_tool_grip_axes';
    secondaryAxes.visible = false;
    contentRoot.add(secondaryAxes);

    initialized = true;
    resize();
    syncAll();
    global.addEventListener('resize', resize);
    animate();
  }

  global.HobunjiAttackEditorHandToolCloseup = Object.freeze({
    setEnabled,
    requestRefit,
    get enabled() { return enabled; },
    get initialized() { return initialized; },
    getDebug() {
      const species = currentSpecies();
      const toolBasis = semanticBasis.toolBasisFor?.(toolGripKey()) || null;
      const handBasis = semanticBasis.handBasisForSpecies?.(species) || null;
      return {
        enabled,
        initialized,
        species,
        gender: currentGender(),
        model: profiles.modelKeyForSpecies?.(species) || null,
        tool: currentToolKey(),
        gripMode: gripModes.currentModeKey?.() || null,
        secondaryActive: lastSecondGripActive,
        cameraAutoRefit: false,
        hasInitialFit,
        cameraPosition: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null,
        target: controls ? { x: controls.target.x, y: controls.target.y, z: controls.target.z } : null,
        semanticToolBasis: toolBasis ? { source: toolBasis.source, complete: toolBasis.complete, axes: toolBasis.axes } : null,
        semanticToolBasisApplied: lastToolBasisApplied,
        semanticHandBasis: handBasis ? { source: handBasis.source, valid: handBasis.valid, axes: handBasis.axes } : null,
      };
    },
  });

  boot();
})(window);
