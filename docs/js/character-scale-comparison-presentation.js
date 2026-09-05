// Full Character Scale presentation adapter.
//
// The underlying shared rig schema continues to store `headScale` in the same
// runtime coordinate space consumed by HobunjiCharacterRigScale. This adapter
// changes only how the Animation Author expresses that value: the Head control
// is shown as the final head scale relative to the raw portrait PNG, including
// the species/gender portrait-plane multiplier. It also uses an orthographic
// camera while the comparison workspace is open so viewport position cannot
// change apparent character size through perspective/FOV.
(() => {
  'use strict';

  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const MODE = 'scale-compare'; // Used below to scope all UI/camera changes to Full Character Scale mode.
  const PANEL_ID = 'maaFullScalePanel'; // Used below to find the existing comparison controls without replacing their authoring logic.
  const HEAD_RANGE_ID = 'maaFullScaleRangeHead'; // Used below as the raw-PNG-facing Head slider.
  const HEAD_NUMBER_ID = 'maaFullScaleNumHead'; // Used below as the raw-PNG-facing exact Head percentage field.
  const BODY_HEAD_INPUT_IDS = new Set([
    'maaFullScaleRangeX', 'maaFullScaleNumX',
    'maaFullScaleRangeY', 'maaFullScaleNumY',
    HEAD_RANGE_ID, HEAD_NUMBER_ID,
    'maaFullScaleRangeOffsetY', 'maaFullScaleNumOffsetY',
  ]); // Used by the capture listener to translate the displayed Head value before the original closure reads it.
  const STYLE_ID = 'maaFullScalePresentationStyle'; // Used below to install right-rail styling only once.
  const HEAD_BASIS_ID = 'maaFullScaleHeadBasis'; // Used below to show the portrait multiplier behind the raw-PNG percentage.
  const EPSILON = 1e-6; // Used below to reject invalid/near-zero portrait multipliers.

  let installedPanel = null; // Used below to avoid stacking capture listeners if the workspace UI is rebuilt.
  let lastSelectedKey = ''; // Used below to refresh Head display when selection changes.
  let lastHeadSignature = ''; // Used below to refresh Head display when reset/import changes the same selected profile.
  let threePromise = null; // Used below to share the async Three.js module lookup across orthographic reframes.
  let cameraState = null; // Used below to restore the original perspective camera exactly when leaving this mode.
  let lastFrameSignature = ''; // Used below to avoid recomputing orthographic framing when neither viewport nor lineup changed.

  const round1 = value => Math.round(Number(value) * 10) / 10;
  const finitePositive = (value, fallback = 1) => {
    const number = Number(value); // Used below as a safe numeric portrait/head scale.
    return Number.isFinite(number) && number > EPSILON ? number : fallback;
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

  function rawHeadPercentFromRuntime(runtimeHeadScale, portraitScale) {
    return finitePositive(runtimeHeadScale, 1) * finitePositive(portraitScale, 1) * 100;
  }

  function runtimeHeadPercentFromRaw(rawPngPercent, portraitScale) {
    return (Number(rawPngPercent) || 0) / finitePositive(portraitScale, 1);
  }

  function comparisonApi() {
    return window.HobunjiFullCharacterScaleComparison || null;
  }

  function selectedIdentity() {
    const key = String(comparisonApi()?.selectedKey || ''); // Used below to resolve the shared species/gender profile currently being edited.
    const [species, gender] = key.split('::');
    return species && gender ? { key, species, gender } : null;
  }

  function profileFor(identity) {
    return identity ? window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[identity.key] || null : null;
  }

  function portraitScaleFor(identity) {
    const profileScale = Number(profileFor(identity)?.anatomy?.portraitScale); // Used first because the Full Character Scale preview copies this exact profile value into PNGPlaneAvatar config.
    if (Number.isFinite(profileScale) && profileScale > EPSILON) return profileScale;
    try {
      const resolved = window.PNGPlaneAvatar?.avatarScaleMultiplierFor?.({
        appearance: { speciesId: identity?.species, gender: identity?.gender },
      }); // Used as a fallback so inherited/config-only portrait multipliers still appear correctly.
      return finitePositive(resolved, 1);
    } catch (_) {
      return 1;
    }
  }

  function runtimeScaleFor(identity) {
    const profile = profileFor(identity); // Used below so local unsaved authoring overrides are reflected immediately.
    return window.HobunjiCharacterRigScale?.scaleFor?.(identity?.species, identity?.gender, profile)
      || { x: 1, y: 1, head: 1, offsetY: 0 };
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Used below to turn the former bottom-center panel into a fixed right-side editor rail.
    style.id = STYLE_ID;
    style.textContent = `
body[data-animation-author-mode="${MODE}"] #${PANEL_ID}{
  position:fixed!important;
  z-index:30!important;
  top:max(68px,env(safe-area-inset-top))!important;
  right:max(10px,env(safe-area-inset-right))!important;
  bottom:auto!important;
  left:auto!important;
  transform:none!important;
  width:min(330px,calc(100vw - 20px))!important;
  max-height:calc(100vh - max(82px,env(safe-area-inset-top)) - 12px)!important;
  overflow:auto!important;
  align-content:start;
}
body[data-animation-author-mode="${MODE}"] #${PANEL_ID} .scaleRow{
  grid-template-columns:88px minmax(110px,1fr) 64px!important;
}
body[data-animation-author-mode="${MODE}"] #${PANEL_ID} .scaleRow>label{align-self:center}
#${HEAD_BASIS_ID}{font-size:10px;color:var(--muted);line-height:1.25;margin-top:-4px}
@media(max-width:620px){
  body[data-animation-author-mode="${MODE}"] #${PANEL_ID}{width:min(300px,calc(100vw - 16px))!important;right:8px!important}
  body[data-animation-author-mode="${MODE}"] #${PANEL_ID} .scaleRow{grid-template-columns:76px minmax(86px,1fr) 60px!important}
}
`;
    document.head.appendChild(style);
  }

  function ensureHeadBasis(panel) {
    const headRange = document.getElementById(HEAD_RANGE_ID); // Used below to locate the existing Head row created by character-scale-comparison.js.
    const row = headRange?.closest?.('.scaleRow');
    if (!row) return null;
    const label = row.querySelector('label'); // Used below to make the displayed percentage semantics explicit.
    if (label) {
      label.textContent = 'Head (raw PNG)';
      label.title = 'Final head size as a percentage of the raw portrait PNG dimensions, after the portrait-plane scale is included.';
    }
    headRange.setAttribute('aria-label', 'Head scale relative to raw portrait PNG dimensions');
    document.getElementById(HEAD_NUMBER_ID)?.setAttribute('aria-label', 'Head scale relative to raw portrait PNG dimensions (exact value)');
    let basis = document.getElementById(HEAD_BASIS_ID); // Used below to display the conversion factors for the currently selected character.
    if (!basis) {
      basis = document.createElement('div');
      basis.id = HEAD_BASIS_ID;
      row.insertAdjacentElement('afterend', basis);
    }
    return basis;
  }

  function setHeadControlBounds(portraitScale) {
    const minRaw = Math.max(1, 10 * portraitScale); // Used below to map the existing 10% minimum runtime head factor into raw-PNG percentage space.
    const maxRaw = 400 * portraitScale; // Used below to map the existing 400% maximum runtime head factor into raw-PNG percentage space.
    for (const id of [HEAD_RANGE_ID, HEAD_NUMBER_ID]) {
      const input = document.getElementById(id);
      if (!input) continue;
      input.min = String(round1(minRaw));
      input.max = String(round1(maxRaw));
      input.step = '0.5';
    }
  }

  function setHeadDisplayValue(rawPercent) {
    const range = document.getElementById(HEAD_RANGE_ID); // Used below to keep range and exact number in the same raw-PNG display space.
    const number = document.getElementById(HEAD_NUMBER_ID);
    if (range) range.value = String(rawPercent);
    if (number) number.value = String(round1(rawPercent));
  }

  function syncHeadUi(force = false) {
    const identity = selectedIdentity();
    if (!identity) return;
    const portraitScale = portraitScaleFor(identity); // Used below as the previously hidden PNG-plane multiplier the user wants the Head percentage to include.
    const scale = runtimeScaleFor(identity);
    const rawPercent = rawHeadPercentFromRuntime(scale.head, portraitScale); // Used below as the user-facing percentage relative to the raw PNG dimensions.
    const signature = `${identity.key}|${portraitScale.toFixed(8)}|${Number(scale.head).toFixed(8)}`; // Used below to avoid fighting pointer drags with redundant writes.
    if (!force && signature === lastHeadSignature) return;
    lastHeadSignature = signature;
    lastSelectedKey = identity.key;
    setHeadControlBounds(portraitScale);
    setHeadDisplayValue(rawPercent);
    const basis = ensureHeadBasis(document.getElementById(PANEL_ID));
    if (basis) {
      basis.textContent = `Raw PNG head ${round1(rawPercent)}% = portrait plane ${round1(portraitScale * 100)}% × runtime head factor ${round1(Number(scale.head || 1) * 100)}%.`;
    }
  }

  function translateDisplayedHeadForOriginalHandler(event) {
    if (!BODY_HEAD_INPUT_IDS.has(event.target?.id)) return;
    const identity = selectedIdentity();
    if (!identity) return;
    const portraitScale = portraitScaleFor(identity); // Used below to convert the raw-PNG display value back into the unchanged runtime authoring field.
    const headRange = document.getElementById(HEAD_RANGE_ID);
    const headNumber = document.getElementById(HEAD_NUMBER_ID);
    if (!headRange || !headNumber) return;
    const displayedRaw = event.target?.id === HEAD_RANGE_ID || event.target?.id === HEAD_NUMBER_ID
      ? Number(event.target.value)
      : Number(headRange.value); // Used below so editing Width/Height/Offset never accidentally reinterprets the raw-PNG Head percentage as a runtime percentage.
    const internalPercent = clamp(runtimeHeadPercentFromRaw(displayedRaw, portraitScale), 10, 400); // Used by the original applyBodyHeadSliders closure during this same input event.
    headRange.value = String(internalPercent);
    headNumber.value = String(internalPercent);
    queueMicrotask(() => {
      lastHeadSignature = '';
      syncHeadUi(true);
    });
  }

  function installUiEnhancements() {
    ensureStyle();
    const panel = document.getElementById(PANEL_ID); // Used below as the capture boundary for the original Full Character Scale controls.
    if (!panel) return false;
    ensureHeadBasis(panel);
    if (installedPanel !== panel) {
      installedPanel = panel;
      panel.addEventListener('input', translateDisplayedHeadForOriginalHandler, true);
      panel.querySelector('#maaFullScaleReset')?.addEventListener('click', () => setTimeout(() => {
        lastHeadSignature = '';
        syncHeadUi(true);
      }, 0), true);
      panel.querySelector('#maaFullScaleFrame')?.addEventListener('click', () => setTimeout(() => frameOrthographic(true), 0), true);
    }
    return true;
  }

  function threeModules() {
    if (!threePromise) {
      threePromise = Promise.resolve(window.PNGPlaneAvatar?.loadThreeModules?.()).then(modules => modules?.THREE || null).catch(() => null); // Used below for Box3 framing without importing a second Three.js copy.
    }
    return threePromise;
  }

  function saveCamera(camera) {
    if (cameraState?.camera === camera) return cameraState;
    const state = {
      camera,
      originalUpdateProjectionMatrix: camera.updateProjectionMatrix,
      isPerspectiveCamera: camera.isPerspectiveCamera,
      isOrthographicCamera: camera.isOrthographicCamera,
      near: camera.near,
      far: camera.far,
      zoom: camera.zoom,
      position: camera.position?.clone?.(),
      quaternion: camera.quaternion?.clone?.(),
      left: camera.left,
      right: camera.right,
      top: camera.top,
      bottom: camera.bottom,
      orthoBounds: null,
    }; // Used below to restore the exact backdrop camera contract on exit.
    cameraState = state;
    camera.isPerspectiveCamera = false;
    camera.isOrthographicCamera = true;
    camera.near = 0.01;
    camera.far = Math.max(1000, Number(camera.far) || 1000);
    camera.updateProjectionMatrix = function fullScaleOrthographicProjection() {
      if (!cameraState || cameraState.camera !== this || document.body.dataset.animationAuthorMode !== MODE || !cameraState.orthoBounds) {
        return state.originalUpdateProjectionMatrix.call(this);
      }
      applyOrthographicProjection(this, cameraState.orthoBounds);
    };
    return state;
  }

  function applyOrthographicProjection(camera, bounds) {
    camera.left = bounds.left;
    camera.right = bounds.right;
    camera.top = bounds.top;
    camera.bottom = bounds.bottom;
    camera.projectionMatrix.makeOrthographic(bounds.left, bounds.right, bounds.top, bounds.bottom, camera.near, camera.far);
    camera.projectionMatrixInverse?.copy?.(camera.projectionMatrix)?.invert?.();
  }

  function restoreCamera() {
    const state = cameraState; // Used below so clearing module state cannot lose the original camera fields mid-restore.
    if (!state) return;
    const camera = state.camera;
    cameraState = null;
    camera.updateProjectionMatrix = state.originalUpdateProjectionMatrix;
    camera.isPerspectiveCamera = state.isPerspectiveCamera;
    camera.isOrthographicCamera = state.isOrthographicCamera;
    camera.near = state.near;
    camera.far = state.far;
    camera.zoom = state.zoom;
    if (state.left === undefined) delete camera.left; else camera.left = state.left;
    if (state.right === undefined) delete camera.right; else camera.right = state.right;
    if (state.top === undefined) delete camera.top; else camera.top = state.top;
    if (state.bottom === undefined) delete camera.bottom; else camera.bottom = state.bottom;
    if (state.position && camera.position?.copy) camera.position.copy(state.position);
    if (state.quaternion && camera.quaternion?.copy) camera.quaternion.copy(state.quaternion);
    camera.updateProjectionMatrix?.();
    camera.updateMatrixWorld?.(true);
    lastFrameSignature = '';
  }

  async function frameOrthographic(force = false) {
    if (document.body.dataset.animationAuthorMode !== MODE) return;
    const camera = window.HobunjiGameplayBackdrop?.getCamera?.(); // Used below as the same public renderer camera already used by the comparison tool.
    const scene = window.HobunjiGameplayBackdrop?.getScene?.();
    const root = scene?.getObjectByName?.('FullCharacterScalePreviewRoot');
    const canvas = document.getElementById('view3d');
    if (!camera || !root || !canvas?.clientWidth || !canvas?.clientHeight) return;
    const THREE = await threeModules(); // Used below to derive unbiased lineup world bounds from the live preview root.
    if (!THREE || document.body.dataset.animationAuthorMode !== MODE) return;

    const panel = document.getElementById(PANEL_ID); // Used below to reserve the right-side rail instead of framing characters underneath it.
    const panelWidth = Math.min(canvas.clientWidth * 0.55, panel?.getBoundingClientRect?.().width || 0);
    const reservePx = panelWidth ? panelWidth + 18 : 0; // Used below as the screen-space width removed from the comparison area by the right rail.
    const usableWidth = Math.max(canvas.clientWidth * 0.35, canvas.clientWidth - reservePx);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()); // Used below as the world-space lineup center for the front orthographic view.
    const size = box.getSize(new THREE.Vector3());
    const signature = `${canvas.clientWidth}x${canvas.clientHeight}|${reservePx.toFixed(1)}|${size.x.toFixed(4)},${size.y.toFixed(4)},${size.z.toFixed(4)}|${root.children.length}`; // Used below to skip redundant projection writes between lineup changes.
    if (!force && signature === lastFrameSignature) return;
    lastFrameSignature = signature;

    const fullAspect = canvas.clientWidth / Math.max(1, canvas.clientHeight); // Used below to preserve square world units in screen pixels.
    const widthWithPadding = Math.max(0.8, size.x + 0.7);
    const heightWithPadding = Math.max(0.8, size.y + 0.55);
    const halfWidthNeededForRail = (widthWithPadding / 2) * (canvas.clientWidth / usableWidth); // Used below so the entire lineup fits in the unobscured left portion of the viewport.
    const halfHeight = Math.max(heightWithPadding / 2, halfWidthNeededForRail / Math.max(0.1, fullAspect));
    const halfWidth = halfHeight * fullAspect;
    const centerShiftX = halfWidth * (reservePx / Math.max(1, canvas.clientWidth)); // Used below to shift the lineup visually left while the camera still renders the full canvas.
    const targetY = center.y;
    const cameraDistance = Math.max(4, size.z + 4); // Used below only for clipping/order; orthographic size is independent of this distance.

    saveCamera(camera);
    camera.position.set(center.x + centerShiftX, targetY, center.z + cameraDistance);
    camera.lookAt(center.x + centerShiftX, targetY, center.z);
    cameraState.orthoBounds = { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight };
    applyOrthographicProjection(camera, cameraState.orthoBounds);
    camera.updateMatrixWorld?.(true);
  }

  function tick() {
    installUiEnhancements();
    const modeActive = document.body.dataset.animationAuthorMode === MODE; // Used below as the single source of truth for orthographic camera ownership.
    if (!modeActive) {
      if (cameraState) restoreCamera();
      return;
    }
    const identity = selectedIdentity();
    if (identity?.key !== lastSelectedKey) {
      lastHeadSignature = '';
      syncHeadUi(true);
    } else {
      syncHeadUi(false);
    }
    frameOrthographic(false);
  }

  window.HobunjiFullScaleEditorPresentation = Object.freeze({
    rawHeadPercentFromRuntime,
    runtimeHeadPercentFromRaw,
    portraitScaleFor,
    syncHeadUi,
    frameOrthographic,
    get cameraMode() { return cameraState ? 'orthographic' : 'perspective'; },
  }); // Public diagnostic/test surface used to verify raw-PNG percentage conversion and FOV-free comparison mode.

  window.addEventListener?.('resize', () => {
    lastFrameSignature = '';
    if (document.body.dataset.animationAuthorMode === MODE) frameOrthographic(true);
  });
  setInterval(tick, 100);
  tick();
})();
