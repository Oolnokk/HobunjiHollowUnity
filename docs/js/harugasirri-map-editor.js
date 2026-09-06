(() => {
  'use strict';

  const currentScriptUrl = document.currentScript?.src || location.href;
  const scriptBase = new URL('.', currentScriptUrl);
  const scriptTag = url => `<script src="${url}"><\/script>`;

  if (!window.HarugasirriTransform && document.readyState === 'loading') {
    document.write(scriptTag(new URL('harugasirri-transform.js?v=20260906a', scriptBase).href));
  }
  if (!window.HarugasirriSuperBackdrop && document.readyState === 'loading') {
    document.write(scriptTag(new URL('harugasirri-superbackdrop-runtime.js?v=20260906a', scriptBase).href));
  }

  let previewScene = null;
  let previewCamera = null;
  let previewControls = null;
  let previewGroup = null;
  let asset = null;
  let backdropOnly = false;
  let sceneAddOriginal = null;
  const hiddenVisibility = new WeakMap();
  const BACKDROP_ONLY_KEY = 'hobunji.harugasirriEditorBackdropOnly.v1';

  function isBackdropObject(object) {
    return object?.name === 'HarugasirriSuperBackdrop' || object?.userData?.harugasirriSuperBackdrop === true;
  }

  function shouldKeepDuringSolo(object) {
    return isBackdropObject(object) || object?.isLight || object?.isCamera;
  }

  function applyBackdropOnly() {
    if (!previewScene) return;
    for (const child of previewScene.children || []) {
      if (shouldKeepDuringSolo(child)) continue;
      if (backdropOnly) {
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
      if (backdropOnly) {
        for (const object of objects) {
          if (shouldKeepDuringSolo(object)) continue;
          if (!hiddenVisibility.has(object)) hiddenVisibility.set(object, object.visible !== false);
          object.visible = false;
        }
      }
      return result;
    };
  }

  function setStatus(text) {
    const el = document.getElementById('harugasirriEditorStatus');
    if (el) el.textContent = text;
  }

  async function attachToPreview() {
    const runtime = window.HarugasirriSuperBackdrop;
    if (!previewScene || !runtime?.attach) return;
    try {
      previewGroup = await runtime.attach(previewScene, 'map_editor_preview');
      asset = asset || await runtime.loadAsset?.();
      if (previewCamera) {
        previewCamera.far = Math.max(previewCamera.far || 0, 5000);
        previewCamera.updateProjectionMatrix?.();
      }
      applyBackdropOnly();
      refreshControls();
      setStatus(previewGroup ? 'attached to 3D preview' : 'attach failed');
    } catch (error) {
      setStatus(`attach failed: ${error?.message || error}`);
    }
  }

  function capturePreview(scene, camera) {
    if (previewScene === scene && previewCamera === camera) return;
    previewScene = scene;
    previewCamera = camera;
    wrapSceneAdd();
    attachToPreview();
  }

  function patchRendererCapture() {
    const THREE = window.THREE;
    if (!THREE?.WebGLRenderer?.prototype?.render) return;
    const original = THREE.WebGLRenderer.prototype.render;
    let captured = false;
    THREE.WebGLRenderer.prototype.render = function (scene, camera, ...rest) {
      if (!captured && this?.domElement?.id === 'canvas3d') {
        captured = true;
        capturePreview(scene, camera);
        THREE.WebGLRenderer.prototype.render = original;
      }
      return original.call(this, scene, camera, ...rest);
    };
  }

  function patchOrbitControlsCapture() {
    const THREE = window.THREE;
    const Original = THREE?.OrbitControls;
    if (typeof Original !== 'function') return;
    function WrappedOrbitControls(...args) {
      const instance = new Original(...args);
      if (args[1]?.id === 'canvas3d') {
        previewControls = instance;
        THREE.OrbitControls = Original;
      }
      return instance;
    }
    WrappedOrbitControls.prototype = Original.prototype;
    Object.setPrototypeOf(WrappedOrbitControls, Original);
    THREE.OrbitControls = WrappedOrbitControls;
  }

  function numberInput(id, label, step = '0.1') {
    return `<div><label for="${id}">${label}</label><input id="${id}" type="number" step="${step}"></div>`;
  }

  function injectUi() {
    if (document.getElementById('harugasirriBackdropSection')) return;
    const scroll = document.getElementById('sidebar-scroll');
    if (!scroll) return;
    const section = document.createElement('div');
    section.className = 'section';
    section.id = 'harugasirriBackdropSection';
    section.style.cssText = '--sec:#f472b6;--secBg:rgba(244,114,182,.08)';
    section.innerHTML = `
      <div class="sect-head"><b>Highlands Background 1</b><span class="sect-tag" id="harugasirriEditorStatus">open 3D to attach</span></div>
      <p class="muted" style="margin-bottom:7px">World-space dimensions and transforms for the Harugasirri super-backdrop. These use the same transform state as the game runtime.</p>
      <div class="g3">
        ${numberInput('haruWidth','Width (X)')}
        ${numberInput('haruHeight','Height (Y)')}
        ${numberInput('haruDepth','Depth (Z)')}
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin:7px 0"><input id="haruLockRatio" type="checkbox" checked style="width:auto"> Lock proportions while resizing</label>
      <div class="g3">
        ${numberInput('haruX','X offset','0.25')}
        ${numberInput('haruY','Y offset','0.25')}
        ${numberInput('haruZ','Z offset','0.25')}
      </div>
      <div class="g2" style="margin-top:6px">
        ${numberInput('haruRotY','Yaw °','1')}
        <div><label>Preview framing</label><button class="sec" id="haruFitBtn" style="width:100%">Fit Highlands</button></div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin:8px 0 4px"><input id="haruVisibilityTest" type="checkbox" style="width:auto"> Visibility test — neon wireframe</label>
      <label style="display:flex;align-items:center;gap:6px;margin:4px 0 8px"><input id="haruBackdropOnly" type="checkbox" style="width:auto"> Backdrop only — hide map terrain in 3D</label>
      <div class="row"><button class="sec" id="haruResetBtn">Reset transform</button><button class="sec" id="haruCopyBtn">Copy JSON</button></div>
      <div class="muted" id="haruReadout" style="margin-top:7px;line-height:1.45">Loading terrain asset…</div>
    `;
    const mapsSection = document.getElementById('mapsSection');
    if (mapsSection?.parentNode === scroll) mapsSection.insertAdjacentElement('afterend', section);
    else scroll.prepend(section);

    try { backdropOnly = localStorage.getItem(BACKDROP_ONLY_KEY) === '1'; } catch (_) {}
    document.getElementById('haruBackdropOnly').checked = backdropOnly;

    const dimensionKeys = new Map([
      ['haruWidth', 'width'], ['haruHeight', 'height'], ['haruDepth', 'depth'],
      ['haruX', 'x'], ['haruY', 'y'], ['haruZ', 'z'], ['haruRotY', 'rotationY'],
    ]);
    for (const [id, key] of dimensionKeys) {
      const input = document.getElementById(id);
      input?.addEventListener('input', () => updateStateFromInput(key, input.value));
    }
    document.getElementById('haruVisibilityTest')?.addEventListener('change', event => updateStateFromInput('visibilityTest', event.target.checked));
    document.getElementById('haruBackdropOnly')?.addEventListener('change', event => {
      backdropOnly = !!event.target.checked;
      try { localStorage.setItem(BACKDROP_ONLY_KEY, backdropOnly ? '1' : '0'); } catch (_) {}
      applyBackdropOnly();
    });
    document.getElementById('haruResetBtn')?.addEventListener('click', () => {
      if (!asset || !window.HarugasirriTransform) return;
      window.HarugasirriTransform.reset(asset);
      refreshControls();
    });
    document.getElementById('haruCopyBtn')?.addEventListener('click', async () => {
      if (!asset || !window.HarugasirriTransform) return;
      const state = window.HarugasirriTransform.load(asset);
      try {
        await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
        setStatus('transform JSON copied');
      } catch (_) { setStatus('clipboard unavailable'); }
    });
    document.getElementById('haruFitBtn')?.addEventListener('click', fitBackdrop);
  }

  function updateStateFromInput(key, rawValue) {
    const transform = window.HarugasirriTransform;
    if (!asset || !transform) return;
    const previous = transform.load(asset);
    const next = { ...previous };
    if (key === 'visibilityTest') next.visibilityTest = !!rawValue;
    else {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) return;
      if (['width','height','depth'].includes(key)) {
        if (value <= 0) return;
        const lock = document.getElementById('haruLockRatio')?.checked;
        if (lock && previous[key] > 0) {
          const ratio = value / previous[key];
          next.width = previous.width * ratio;
          next.height = previous.height * ratio;
          next.depth = previous.depth * ratio;
        } else next[key] = value;
      } else next[key] = value;
    }
    transform.save(next, asset);
    refreshControls();
  }

  function refreshControls() {
    const transform = window.HarugasirriTransform;
    if (!asset || !transform) return;
    const state = transform.load(asset);
    const values = {
      haruWidth: state.width, haruHeight: state.height, haruDepth: state.depth,
      haruX: state.x, haruY: state.y, haruZ: state.z, haruRotY: state.rotationY,
    };
    for (const [id, value] of Object.entries(values)) {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = Number(value.toFixed(4));
    }
    const test = document.getElementById('haruVisibilityTest');
    if (test) test.checked = !!state.visibilityTest;
    const summary = transform.summary(asset, state);
    const readout = document.getElementById('haruReadout');
    if (readout) readout.textContent = `Final ${summary.final.width.toFixed(1)} × ${summary.final.height.toFixed(1)} × ${summary.final.depth.toFixed(1)} world units · scale ${summary.scale.x.toFixed(3)}, ${summary.scale.y.toFixed(3)}, ${summary.scale.z.toFixed(3)} · pos ${state.x.toFixed(1)}, ${state.y.toFixed(1)}, ${state.z.toFixed(1)} · yaw ${state.rotationY.toFixed(1)}°`;
  }

  function fitBackdrop() {
    const THREE = window.THREE;
    if (!THREE || !previewGroup || !previewCamera) {
      setStatus('open the 3D preview first');
      return;
    }
    const box = new THREE.Box3().setFromObject(previewGroup);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const oldTarget = previewControls?.target?.clone?.() || new THREE.Vector3(0, 0, 0);
    let dir = previewCamera.position.clone().sub(oldTarget);
    if (dir.lengthSq() < 0.0001) dir.set(1, 0.7, 1);
    dir.normalize();
    const fov = Math.max(1, previewCamera.fov || 50) * Math.PI / 180;
    const distance = Math.max(10, sphere.radius / Math.sin(fov / 2) * 1.2);
    previewCamera.position.copy(sphere.center).add(dir.multiplyScalar(distance));
    previewCamera.near = Math.max(0.05, distance / 10000);
    previewCamera.far = Math.max(5000, distance + sphere.radius * 10);
    previewCamera.updateProjectionMatrix?.();
    if (previewControls?.target) {
      previewControls.target.copy(sphere.center);
      previewControls.update?.();
    } else previewCamera.lookAt(sphere.center);
    setStatus('camera fitted to Highlands');
  }

  function loadAssetForUi() {
    const runtime = window.HarugasirriSuperBackdrop;
    if (!runtime?.loadAsset) {
      setStatus('runtime failed to load');
      return;
    }
    runtime.loadAsset().then(value => {
      asset = value;
      refreshControls();
      if (previewScene) attachToPreview();
    }).catch(error => setStatus(`asset failed: ${error?.message || error}`));
  }

  window.addEventListener('harugasirri-transform-changed', () => refreshControls());
  patchRendererCapture();
  patchOrbitControlsCapture();
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => { injectUi(); loadAssetForUi(); }, { once: true });
  } else {
    injectUi();
    loadAssetForUi();
  }
})();
