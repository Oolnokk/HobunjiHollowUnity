// Fixed Loadout-tab 3D weapon viewport. Borrows the equipped weapon's actual
// rendered plane/material (including the live metal/verdigris texture), rather
// than separately approximating plating or oxidation in a menu icon.
(() => {
  'use strict';
  if (window.CombatLoadoutWeaponPreview) return;

  const PREVIEW_MAX_PIXEL_RATIO = 1.5; // Limits the dedicated renderer's GPU cost on high-DPI phones.
  const MAX_DRAG_YAW = 0.85; // Keeps the game's intentionally flat PNG weapon visible while the player turns it.
  const MAX_DRAG_PITCH = 0.35; // Allows modest 3D inspection without losing the weapon edge-on.
  const SOURCE_RETRY_MS = 450; // Retries game-created equipment meshes after asynchronous startup or equip changes.
  const FRAME_INTERVAL_MS = 1000 / 30; // Limits the separate WebGL viewport to 30 fps; gameplay keeps its own unchanged render rate.
  const state = {
    key: null, sourcePlane: null, sourceGeometryVersion: -1, sourceMap: null, sourceMaterial: null,
    renderer: null, scene: null, camera: null, model: null, content: null, plane: null,
    sourceParts: [], sourceMeshes: [], previewTargets: [], // Preview copies and masks are read-only snapshots of cached equipment.
    vfx: null, frame: 0, lastTime: 0, lastRenderAt: -Infinity, lastSourceCheck: -Infinity, contextLost: false,
    yaw: 0, pitch: 0, dragPointer: null, dragX: 0, dragY: 0,
    status: 'idle', error: null, frames: 0,
  }; // Shared by the fixed viewport, visibility handlers and mobile diagnostics.

  let host = null; // Fixed right-hand panel; it never lives inside the scrollable attack list.
  let stage = null; // Canvas owner and pointer-drag hit target.
  let message = null; // Mobile-visible status while weapon assets or WebGL are unavailable.
  let caption = null; // Equipped-weapon name shown outside the canvas.
  let observer = null; // Watches only menu and loadout classes to suspend hidden rendering.
  let sizeObserver = null; // Resizes only the dedicated viewport when its split-column dimensions change.

  function findElements() {
    host = document.getElementById('combatLoadoutPreview');
    stage = document.getElementById('combatLoadoutPreviewStage');
    message = document.getElementById('combatLoadoutPreviewStatus');
    caption = document.getElementById('combatLoadoutPreviewName');
    return !!(host && stage && message && caption);
  }

  function setStatus(status, visible = true) {
    state.status = status;
    if (message) {
      message.textContent = status;
      message.hidden = !visible;
    }
  }

  function isVisible() {
    return !!(host?.isConnected && document.getElementById('mpLoadout')?.classList.contains('active')
      && document.getElementById('menuPanel')?.classList.contains('open'));
  }

  function equippedPlane() {
    const equipped = window.EquipmentPanel?.getEquippedWeaponPreviewPlane?.(state.key); // Canonical holstered/equipped mesh, including the current verdigris/plating texture.
    if (equipped) return equipped;
    const deps = window.ProceduralHandAttachments?.gameDeps; // Compatibility fallback for standalone integration harnesses.
    const mesh = deps?.toolMeshMap?.weapon || window.Combat?.deps?.toolMeshMap?.weapon;
    return mesh?.userData?.itemKey === state.key ? mesh.userData.toolPlane || null : null;
  }

  function disposeModel() {
    state.vfx?.dispose?.();
    state.vfx = null;
    if (state.model) state.scene?.remove(state.model);
    for (const entry of state.sourceMeshes) {
      entry.copy.geometry?.dispose?.(); // Each viewport mesh owns its geometry, never gameplay's geometry.
      const materials = Array.isArray(entry.copy.material) ? entry.copy.material : [entry.copy.material];
      for (const material of materials) material?.dispose?.(); // Maps/textures remain shared with the live verdigris renderer.
    }
    state.sourceMeshes = [];
    state.sourceParts = [];
    state.previewTargets = [];
    state.model = null;
    state.content = null;
    state.plane = null;
    state.sourcePlane = null;
    state.sourceMap = null;
    state.sourceMaterial = null;
    state.sourceGeometryVersion = -1;
  }

  function initializeRenderer() {
    if (state.renderer) return true;
    if (!stage || typeof THREE === 'undefined' || !THREE.WebGLRenderer) {
      setStatus('3D renderer unavailable');
      return false;
    }
    try {
      state.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' }); // Pixel-art planes need no expensive edge multisampling.
      state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PREVIEW_MAX_PIXEL_RATIO));
      state.renderer.setClearColor(0x000000, 0);
      state.renderer.domElement.setAttribute('aria-hidden', 'true');
      state.renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        state.contextLost = true; // Avoid restarting the animation loop while the preview's GPU context is unavailable.
        setStatus('3D preview context lost');
        stop();
      });
      state.renderer.domElement.addEventListener('webglcontextrestored', () => {
        state.contextLost = false;
        state.error = null;
        resume();
      });
      stage.appendChild(state.renderer.domElement);
      state.scene = new THREE.Scene();
      state.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
      state.camera.position.set(0, 0, 3);
      sizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
      sizeObserver?.observe(stage);
      window.addEventListener('resize', resize);
      resize();
      return true;
    } catch (error) {
      state.error = String(error?.message || error);
      setStatus('3D preview could not start');
      sizeObserver?.disconnect?.(); // A partial renderer initialization must not leave an orphan resize callback.
      sizeObserver = null;
      window.removeEventListener?.('resize', resize);
      state.renderer?.domElement?.remove?.();
      state.renderer?.dispose?.();
      state.renderer = null; // Later attempts must retry construction rather than drawing with a half-initialized context.
      state.scene = null;
      state.camera = null;
      window.__farmLog?.('[loadout-preview] ' + state.error, 'warn');
      return false;
    }
  }

  function resize() {
    if (!state.renderer || !stage || !state.camera) return;
    const width = Math.max(1, stage.clientWidth); // Dedicated canvas always fits its stationary right panel.
    const height = Math.max(1, stage.clientHeight);
    if (width < 2 || height < 2) return;
    state.renderer.setSize(width, height, false);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
    fitCamera();
  }

  function fitCamera() {
    if (!state.camera || !state.plane) return;
    let size, center; // The full visible flail (haft, rope and all head layers) must fit, not only the haft geometry.
    if (typeof THREE.Box3 === 'function') {
      state.content.position.set(0, 0, 0); // Reset previous centering before measuring a rebuilt assembly.
      state.model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(state.content);
      if (bounds.isEmpty()) return;
      size = bounds.getSize(new THREE.Vector3());
      center = bounds.getCenter(new THREE.Vector3());
      state.content.position.set(-center.x, -center.y, -center.z); // Rotate the complete assembly around its visual center.
    } else {
      // Keeps small renderer test harnesses without Box3 usable.
      const geometry = state.plane.geometry;
      geometry.computeBoundingBox();
      if (!geometry.boundingBox) return;
      size = new THREE.Vector3(); center = new THREE.Vector3();
      geometry.boundingBox.getSize(size);
      geometry.boundingBox.getCenter(center);
      state.plane.position.set(-center.x, -center.y, 0);
    }
    const verticalHalfAngle = state.camera.fov * Math.PI / 360;
    const requiredByHeight = Math.max(0.1, size.y) / (2 * Math.tan(verticalHalfAngle));
    const requiredByWidth = Math.max(0.1, size.x) / (2 * Math.tan(verticalHalfAngle) * Math.max(0.1, state.camera.aspect));
    state.camera.position.z = Math.max(0.8, requiredByHeight, requiredByWidth, size.z * 0.5 + 0.6) * 1.22;
    state.camera.lookAt(0, 0, 0);
    state.camera.updateMatrixWorld();
  }

  function geometryVersion(source) {
    return source?.geometry?.attributes?.position?.version ?? 0; // Detects ModularWeapons.fitPlaneGeometry editing a shared quad after sprite composition.
  }

  function rememberMesh(source, copy) {
    state.sourceMeshes.push({
      source, copy, geometry: source.geometry, material: source.material,
      map: source.material?.map, version: geometryVersion(source),
    }); // Only the viewport copies are disposed; material/map identity detects asynchronous head recolors and replacement.
  }

  function cloneArtwork(node, copies) {
    if (node.userData?.weaponInterleavedVfx || node.userData?.weaponEnchantmentVfx) return null;
    const children = (node.children || []).map(child => cloneArtwork(child, copies)).filter(Boolean); // Keep authored groups/transforms, not gameplay particles.
    if (!node.isMesh && !children.length) return null;
    if (node.isMesh && !node.userData?.hobunjiWeaponAssemblyPart) return null;
    const copy = node.clone(false); // Full head/rope geometry is reused as artwork, not re-authored or reparented.
    copy.layers.set(0);
    copy.visible = node.visible !== false; // Authored child visibility stays intact; only the hidden dual-wield source roots are explicitly restored.
    if (node.isMesh) {
      copy.geometry = node.geometry.clone();
      copy.material = Array.isArray(node.material) ? node.material.map(material => material.clone()) : node.material.clone();
      const materials = Array.isArray(copy.material) ? copy.material : [copy.material];
      for (const material of materials) {
        material.side = THREE.DoubleSide;
        material.visible = true; // Gameplay's dual-wield compositor may hide the original static layer's material; never inherit that concealment.
      }
      copy.onBeforeRender = () => {}; // Never invoke a copied gameplay callback that closes over a live rope/holder.
      copies.set(node, copy);
      rememberMesh(node, copy);
    }
    for (const child of children) copy.add(child);
    return copy;
  }

  function previewRopeBillboard(group) {
    if (!group?.userData?.hobunjiRuinRopeSprite) return;
    const mesh = group.children.find(child => child.userData?.hobunjiGeneratedRope);
    if (!mesh) return;
    const cameraPosition = new THREE.Vector3(); // Preview-only rope faces its own camera, not the gameplay camera.
    const normal = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const basis = new THREE.Matrix4();
    const inverse = new THREE.Matrix4();
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      if (!camera?.getWorldPosition) return;
      camera.getWorldPosition(cameraPosition);
      cameraPosition.applyMatrix4(inverse.copy(group.matrixWorld).invert());
      normal.set(cameraPosition.x, 0, cameraPosition.z);
      if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
      normal.normalize();
      right.crossVectors(up, normal).normalize();
      normal.crossVectors(right, up).normalize();
      mesh.quaternion.setFromRotationMatrix(basis.makeBasis(right, up, normal));
      mesh.updateMatrixWorld();
    };
  }

  function rebuildFromSource(source, assembly) {
    disposeModel();
    if (!source?.geometry || !source?.material) return;
    const model = new THREE.Group(); // Owns only this viewport's rotatable weapon copy.
    const content = new THREE.Group(); // Recenter the combined haft + flail without moving the separately animated head.
    const plane = new THREE.Mesh(source.geometry.clone(), source.material.clone());
    plane.rotation.set(0, 0, 0); // The original source plane is presented face-on regardless of held combat stance.
    plane.layers.set(0);
    plane.material.side = THREE.DoubleSide;
    plane.material.visible = true; // Dual-wield may hide the source haft material while drawing its two gameplay replicas.
    plane.renderOrder = 1;
    content.add(plane);
    model.add(content);
    const copies = new Map([[source, plane]]); // Maps live metal-layer meshes onto the corresponding preview-only copies.
    rememberMesh(source, plane);
    for (const child of source.children || []) {
      const copy = cloneArtwork(child, copies); // Preserve rigid overlay layers as well as the flail head.
      if (copy) plane.add(copy);
    }
    if (assembly?.ready) {
      state.sourceParts = [assembly.chain, assembly.headRoot]; // The next 450ms source check detects late asynchronous assembly and replacement.
      const neutral = assembly.neutralMatrices; // An unheld flail has no valid baked pendulum pose; use the same authored contact points at rest.
      const toPlane = neutral ? null : new THREE.Matrix4().copy(source.matrixWorld).invert();
      for (const part of state.sourceParts) {
        const copy = cloneArtwork(part, copies);
        if (!copy) continue;
        copy.visible = true; // Restore the hidden original chain/head when the source is currently dual-wielded.
        const authoredPose = neutral?.[part === assembly.chain ? 'chain' : 'headRoot'];
        if (authoredPose) copy.matrix.copy(authoredPose);
        else copy.matrix.copy(toPlane || new THREE.Matrix4().copy(source.matrixWorld).invert()).multiply(part.matrixWorld);
        copy.matrixAutoUpdate = false; // Preserve the hanging artwork under the independent preview scene.
        copy.matrixWorldNeedsUpdate = true;
        content.add(copy);
        previewRopeBillboard(copy);
      }
    }
    state.previewTargets = assembly?.ready
      ? assembly.metalTargets.map(target => ({ plane: copies.get(target.plane), mask: target.mask }))
        .filter(target => target.plane?.isObject3D && target.mask?.indices?.length)
      : []; // The same post-occlusion masks as the live head, never the shaft bitmap projected across an empty chain.
    state.scene.add(model);
    state.model = model;
    state.content = content;
    state.plane = plane;
    state.sourcePlane = source;
    state.sourceMap = source.material.map;
    state.sourceMaterial = source.material;
    state.sourceGeometryVersion = geometryVersion(source);
    fitCamera();
    state.vfx = window.WeaponEnchantmentVFX?.createPreviewEmitter?.(plane, state.key, assembly ? state.previewTargets : undefined) || null; // A flail waiting for head art emits nothing on the naked haft.
    setStatus('Weapon ready', false);
  }

  function checkSource() {
    if (!state.renderer || !state.key || state.key === 'none') {
      disposeModel();
      setStatus('No weapon equipped');
      return;
    }
    const source = equippedPlane(); // Access is read-only; the live held weapon is never reparented or mutated.
    if (!source?.geometry || !source?.material?.map) {
      if (state.model) disposeModel();
      setStatus('Preparing equipped weapon…');
      return;
    }
    const assembly = window.HobunjiWeaponSpriteAssemblies?.previewParts?.(source) || null;
    const roots = assembly?.ready ? [assembly.chain, assembly.headRoot] : []; // Late head/rope textures appear without any equipment-slot change.
    const changedParts = roots.length !== state.sourceParts.length || roots.some((part, index) => state.sourceParts[index] !== part);
    const changedMeshes = state.sourceMeshes.some(entry =>
      entry.source.geometry !== entry.geometry || entry.source.material !== entry.material
      || entry.source.material?.map !== entry.map || geometryVersion(entry.source) !== entry.version);
    const changedOverlays = (source.children || []).some(child =>
      child.isMesh && child.userData?.hobunjiWeaponAssemblyPart
      && !state.sourceMeshes.some(entry => entry.source === child)); // Static overlays may finish loading after the base weapon, even without a flail.
    const changedTargets = assembly?.ready && assembly.metalTargets.some(target =>
      target.mask?.indices?.length && !state.previewTargets.some(preview =>
        preview.mask === target.mask && state.sourceMeshes.some(entry => entry.source === target.plane && entry.copy === preview.plane)));
    if (source !== state.sourcePlane || changedParts || changedMeshes || changedOverlays || changedTargets) rebuildFromSource(source, assembly);
  }

  function tick(now) {
    state.frame = 0;
    if (!isVisible() || !state.renderer || state.contextLost) return; // No GPU work when the panel is hidden or its WebGL context is lost.
    if (now - state.lastRenderAt < FRAME_INTERVAL_MS) {
      state.frame = requestAnimationFrame(tick); // Skip every other display frame while retaining responsive pointer input.
      return;
    }
    state.lastRenderAt = now;
    const dt = Math.min(0.05, Math.max(0, (now - (state.lastTime || now)) / 1000));
    state.lastTime = now;
    if (now - state.lastSourceCheck >= SOURCE_RETRY_MS) { // Missing sprites retry on a short timer, not on every animation frame.
      state.lastSourceCheck = now;
      checkSource();
    }
    if (state.model) {
      state.model.rotation.y = state.yaw + Math.sin(now * 0.00043) * 0.075;
      state.model.rotation.x = state.pitch;
      state.model.updateMatrixWorld(true);
      state.camera.updateMatrixWorld();
      state.vfx?.update?.(dt, state.camera);
    }
    try {
      state.renderer.render(state.scene, state.camera);
      state.frames++;
    } catch (error) {
      state.error = String(error?.message || error);
      setStatus('3D preview rendering failed');
      stop();
      window.__farmLog?.('[loadout-preview] ' + state.error, 'warn');
      return;
    }
    state.frame = requestAnimationFrame(tick);
  }

  function stop() {
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.lastTime = 0;
    state.lastRenderAt = -Infinity;
  }

  function resume() {
    if (!isVisible()) { stop(); return; }
    if (!initializeRenderer() || state.contextLost) return;
    if (!state.frame) {
      state.lastSourceCheck = -Infinity; // First visible frame immediately resolves the equipped weapon.
      state.frame = requestAnimationFrame(tick);
    }
  }

  function pointerDown(event) {
    if (event.button !== 0 || !state.model) return;
    state.dragPointer = event.pointerId;
    state.dragX = event.clientX;
    state.dragY = event.clientY;
    stage.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function pointerMove(event) {
    if (event.pointerId !== state.dragPointer) return;
    state.yaw = Math.min(MAX_DRAG_YAW, Math.max(-MAX_DRAG_YAW, state.yaw + (event.clientX - state.dragX) * 0.009));
    state.pitch = Math.min(MAX_DRAG_PITCH, Math.max(-MAX_DRAG_PITCH, state.pitch + (event.clientY - state.dragY) * 0.006));
    state.dragX = event.clientX;
    state.dragY = event.clientY;
    event.preventDefault();
  }

  function pointerUp(event) {
    if (event.pointerId !== state.dragPointer) return;
    state.dragPointer = null;
    stage.releasePointerCapture?.(event.pointerId);
  }

  function initialize() {
    if (!findElements()) return false;
    if (host.dataset.previewInstalled === '1') return true;
    host.dataset.previewInstalled = '1';
    stage.addEventListener('pointerdown', pointerDown);
    stage.addEventListener('pointermove', pointerMove);
    stage.addEventListener('pointerup', pointerUp);
    stage.addEventListener('pointercancel', pointerUp);
    const menu = document.getElementById('menuPanel');
    const pane = document.getElementById('mpLoadout');
    observer = new MutationObserver(resume); // Narrow, event-driven activation; no hidden background draw loop.
    if (menu) observer.observe(menu, { attributes: true, attributeFilter: ['class'] });
    if (pane) observer.observe(pane, { attributes: true, attributeFilter: ['class'] });
    resume();
    return true;
  }

  function sync(key, label) {
    if (!host && !initialize()) return false;
    if (!caption) return false;
    caption.textContent = label || 'No weapon equipped';
    const nextKey = key && key !== 'none' ? key : null; // Weapon loadout identity follows the equipment slot, not the temporarily held tool.
    if (nextKey !== state.key) {
      state.key = nextKey;
      state.yaw = 0;
      state.pitch = 0;
      state.lastSourceCheck = -Infinity;
      disposeModel();
    }
    resume();
    return true;
  }

  function debugSnapshot() {
    const isHeadLayer = node => { // Counts nested head-art groups too, including transformed modular flails.
      for (let parent = node; parent; parent = parent.parent) if (parent === state.sourceParts[1]) return true;
      return false;
    };
    return {
      key: state.key, visible: isVisible(), status: state.status, error: state.error,
      modelLoaded: !!state.model, sourceMatched: !!equippedPlane(),
      verdigrisTextureShared: !!state.sourceMap && state.sourceMap === state.sourcePlane?.material?.map,
      flail: { parts: state.sourceParts.length, visibleHeadLayers: state.sourceMeshes.filter(entry => isHeadLayer(entry.source)).length, metalEmitters: state.previewTargets.length }, // Mobile preview diagnostics without devtools.
      enchantment: state.vfx?.debugSnapshot?.() || null,
      frames: state.frames, rendererActive: !!state.frame, contextLost: state.contextLost, targetFps: 30,
      latestChange: 'Loadout viewport now includes the cached flail connector and full multilayer head, sharing each actual verdigris map and metal enchantment mask.',
    };
  }

  window.CombatLoadoutWeaponPreview = Object.freeze({ sync, debugSnapshot });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();