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
    renderer: null, scene: null, camera: null, model: null, plane: null,
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
    state.plane?.geometry?.dispose?.(); // Clone-owned geometry; never dispose gameplay's geometry.
    state.plane?.material?.dispose?.(); // Clone-owned material; texture/map belongs to the shared game cache.
    state.model = null;
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
    const geometry = state.plane.geometry; // Recenter even modular composites with off-axis haft/head extents.
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bounds.getSize(size);
    bounds.getCenter(center);
    state.plane.position.set(-center.x, -center.y, 0);
    const verticalHalfAngle = state.camera.fov * Math.PI / 360;
    const requiredByHeight = Math.max(0.1, size.y) / (2 * Math.tan(verticalHalfAngle));
    const requiredByWidth = Math.max(0.1, size.x) / (2 * Math.tan(verticalHalfAngle) * Math.max(0.1, state.camera.aspect));
    state.camera.position.z = Math.max(0.8, requiredByHeight, requiredByWidth) * 1.22;
    state.camera.lookAt(0, 0, 0);
    state.camera.updateMatrixWorld();
  }

  function geometryVersion(source) {
    return source?.geometry?.attributes?.position?.version ?? 0; // Detects ModularWeapons.fitPlaneGeometry editing a shared quad after sprite composition.
  }

  function rebuildFromSource(source) {
    disposeModel();
    if (!source?.geometry || !source?.material) return;
    const model = new THREE.Group(); // Owns only this viewport's rotatable copy of the weapon.
    const plane = new THREE.Mesh(source.geometry.clone(), source.material.clone()); // Retains all game-authored texture/shader appearance.
    plane.rotation.set(0, 0, 0); // Present the existing planar weapon face-on inside the 3D viewport.
    plane.layers.set(0); // Do not inherit gameplay's held-weapon overlay-only render layer.
    plane.material.side = THREE.DoubleSide;
    plane.renderOrder = 1;
    model.add(plane);
    state.scene.add(model);
    state.model = model;
    state.plane = plane;
    state.sourcePlane = source;
    state.sourceMap = source.material.map;
    state.sourceMaterial = source.material; // Detect an equipment material replacement even when it reuses the old texture.
    state.sourceGeometryVersion = geometryVersion(source);
    fitCamera();
    state.vfx = window.WeaponEnchantmentVFX?.createPreviewEmitter?.(plane, state.key) || null;
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
    if (source !== state.sourcePlane || source.material !== state.sourceMaterial || geometryVersion(source) !== state.sourceGeometryVersion) {
      rebuildFromSource(source);
    } else if (state.sourceMap !== source.material.map) {
      // A ranged loaded/unloaded state or live equip rebuild can swap maps without replacing the mesh.
      state.plane.material.map = source.material.map;
      state.plane.material.needsUpdate = true;
      state.sourceMap = source.material.map;
    }
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
    return {
      key: state.key, visible: isVisible(), status: state.status, error: state.error,
      modelLoaded: !!state.model, sourceMatched: !!equippedPlane(),
      verdigrisTextureShared: !!state.sourceMap && state.sourceMap === state.sourcePlane?.material?.map,
      enchantment: state.vfx?.debugSnapshot?.() || null,
      frames: state.frames, rendererActive: !!state.frame, contextLost: state.contextLost, targetFps: 30,
      latestChange: 'A fixed, independent 3D loadout viewport reuses the equipped weapon texture and the enchantment particle integrator.',
    };
  }

  window.CombatLoadoutWeaponPreview = Object.freeze({ sync, debugSnapshot });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();