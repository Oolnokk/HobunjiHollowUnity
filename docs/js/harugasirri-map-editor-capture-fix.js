(() => {
  'use strict';

  if (!/\/tools\/map-editor(?:\/|\/index\.html)?$/.test(location.pathname)) return;
  const THREE = window.THREE;
  if (!THREE?.Scene || !THREE?.PerspectiveCamera || window.HarugasirriMapEditorDirectCapture) return;

  let previewScene = null;
  let previewCamera = null;
  let backdropGroup = null;
  let attachPromise = null;
  let sceneAddOriginal = null;
  const hiddenVisibility = new WeakMap();

  function setStatus(text) {
    const el = document.getElementById('harugasirriEditorStatus');
    if (el) el.textContent = text;
  }

  function isBackdrop(object) {
    return object?.name === 'HarugasirriSuperBackdrop' || object?.userData?.harugasirriSuperBackdrop === true;
  }

  function keepDuringSolo(object) {
    return isBackdrop(object) || object?.isLight || object?.isCamera;
  }

  function backdropOnlyEnabled() {
    return !!document.getElementById('haruBackdropOnly')?.checked;
  }

  function applyBackdropOnly() {
    if (!previewScene) return;
    const enabled = backdropOnlyEnabled();
    for (const child of previewScene.children || []) {
      if (keepDuringSolo(child)) continue;
      if (enabled) {
        if (!hiddenVisibility.has(child)) hiddenVisibility.set(child, child.visible !== false);
        child.visible = false;
      } else if (hiddenVisibility.has(child)) {
        child.visible = hiddenVisibility.get(child);
        hiddenVisibility.delete(child);
      }
    }
  }

  function wrapSceneAdd() {
    if (!previewScene || sceneAddOriginal) return;
    sceneAddOriginal = previewScene.add;
    previewScene.add = function (...objects) {
      const result = sceneAddOriginal.apply(this, objects);
      if (backdropOnlyEnabled()) {
        for (const object of objects) {
          if (keepDuringSolo(object)) continue;
          if (!hiddenVisibility.has(object)) hiddenVisibility.set(object, object.visible !== false);
          object.visible = false;
        }
      }
      return result;
    };
  }

  async function attachBackdrop() {
    if (!previewScene || backdropGroup) return backdropGroup;
    if (attachPromise) return attachPromise;
    const runtime = window.HarugasirriSuperBackdrop;
    if (!runtime?.attach) {
      setStatus('preview scene captured; backdrop runtime unavailable');
      return null;
    }
    attachPromise = Promise.resolve(runtime.attach(previewScene, 'map_editor_preview_direct'))
      .then(group => {
        attachPromise = null;
        backdropGroup = group || null;
        if (previewCamera) {
          previewCamera.far = Math.max(previewCamera.far || 0, 5000);
          previewCamera.updateProjectionMatrix?.();
        }
        applyBackdropOnly();
        setStatus(backdropGroup ? 'attached to 3D preview (direct)' : 'direct preview attach failed');
        return backdropGroup;
      })
      .catch(error => {
        attachPromise = null;
        setStatus(`direct preview attach failed: ${error?.message || error}`);
        return null;
      });
    return attachPromise;
  }

  function captureScene(scene) {
    if (previewScene) return;
    previewScene = scene;
    wrapSceneAdd();
    attachBackdrop();
  }

  function captureCamera(camera) {
    if (previewCamera) return;
    previewCamera = camera;
    previewCamera.far = Math.max(previewCamera.far || 0, 5000);
    previewCamera.updateProjectionMatrix?.();
    attachBackdrop();
  }

  // terrain-preview.js runs before the Map Editor's inline init3D() body, so
  // constructor capture gives us the exact scene/camera at creation time rather
  // than hoping to intercept a later renderer call. Each constructor restores
  // itself immediately after the first capture.
  const OriginalScene = THREE.Scene;
  function CapturingScene(...args) {
    const scene = Reflect.construct(OriginalScene, args, OriginalScene);
    THREE.Scene = OriginalScene;
    captureScene(scene);
    return scene;
  }
  CapturingScene.prototype = OriginalScene.prototype;
  Object.setPrototypeOf(CapturingScene, OriginalScene);
  THREE.Scene = CapturingScene;

  const OriginalPerspectiveCamera = THREE.PerspectiveCamera;
  function CapturingPerspectiveCamera(...args) {
    const camera = Reflect.construct(OriginalPerspectiveCamera, args, OriginalPerspectiveCamera);
    THREE.PerspectiveCamera = OriginalPerspectiveCamera;
    captureCamera(camera);
    return camera;
  }
  CapturingPerspectiveCamera.prototype = OriginalPerspectiveCamera.prototype;
  Object.setPrototypeOf(CapturingPerspectiveCamera, OriginalPerspectiveCamera);
  THREE.PerspectiveCamera = CapturingPerspectiveCamera;

  async function ensureVisibilityState() {
    const checkbox = document.getElementById('haruVisibilityTest');
    const runtime = window.HarugasirriSuperBackdrop;
    const transform = window.HarugasirriTransform;
    if (!checkbox || !runtime?.loadAsset || !transform?.load || !transform?.save) return;
    try {
      const asset = await runtime.loadAsset();
      const state = transform.load(asset);
      const nextValue = !!checkbox.checked;
      if (!!state.visibilityTest !== nextValue) transform.save({ ...state, visibilityTest: nextValue }, asset);
    } catch (_) {}
  }

  function fitBackdrop() {
    if (!previewScene || !previewCamera || !backdropGroup || !window.THREE?.Box3) return;
    const box = new THREE.Box3().setFromObject(backdropGroup);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    let dir = previewCamera.position.clone().sub(sphere.center);
    if (dir.lengthSq() < 0.0001) dir.set(1, 0.7, 1);
    dir.normalize();
    const fov = Math.max(1, previewCamera.fov || 55) * Math.PI / 180;
    const distance = Math.max(10, sphere.radius / Math.sin(fov / 2) * 1.2);
    previewCamera.position.copy(sphere.center).add(dir.multiplyScalar(distance));
    previewCamera.near = Math.max(0.05, distance / 10000);
    previewCamera.far = Math.max(5000, distance + sphere.radius * 10);
    previewCamera.updateProjectionMatrix?.();
    previewCamera.lookAt(sphere.center);
    setStatus('camera fitted to Highlands (direct)');
  }

  function wireUi() {
    const solo = document.getElementById('haruBackdropOnly');
    const visibility = document.getElementById('haruVisibilityTest');
    const fit = document.getElementById('haruFitBtn');
    solo?.addEventListener('change', applyBackdropOnly);
    visibility?.addEventListener('change', ensureVisibilityState);
    fit?.addEventListener('click', fitBackdrop);
    applyBackdropOnly();
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', wireUi, { once: true });
  else wireUi();

  window.HarugasirriMapEditorDirectCapture = Object.freeze({
    getDebugState() {
      return {
        sceneCaptured: !!previewScene,
        cameraCaptured: !!previewCamera,
        backdropAttached: !!backdropGroup,
        backdropOnly: backdropOnlyEnabled(),
      };
    },
  });
})();
