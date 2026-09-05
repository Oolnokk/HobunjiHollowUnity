// Full Character Scale presentation adapter.
//
// Keeps the shared runtime schema unchanged while expressing Head as the final
// size relative to the raw portrait PNG. The comparison view uses an
// orthographic projection and owns two-finger pinch zoom on mobile so camera
// zoom cannot leak into Animation Author's empty/selection object.
(() => {
  'use strict';

  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const MODE = 'scale-compare'; // Used to scope every override below to Full Character Scale mode.
  const PANEL_ID = 'maaFullScalePanel'; // Existing right-side scale editor panel.
  const HEAD_RANGE_ID = 'maaFullScaleRangeHead'; // Raw-PNG-facing range input.
  const HEAD_NUMBER_ID = 'maaFullScaleNumHead'; // Raw-PNG-facing exact numeric input.
  const HEAD_BASIS_ID = 'maaFullScaleHeadBasis'; // Exposes the portrait/runtime conversion underneath Head.
  const RIG_SAVE_KEY = 'hobunjiAttachmentRigProfiles.v2'; // Same autosave key used by character-scale-comparison.js.
  const STYLE_ID = 'maaFullScalePresentationStyle'; // Prevents duplicate right-rail styles.
  const EPSILON = 1e-6; // Guards invalid portrait multipliers and pinch distances.
  const MIN_RUNTIME_HEAD = 0.1; // Matches HobunjiCharacterRigScale.MIN_SCALE.
  const MAX_RUNTIME_HEAD = 4; // Matches HobunjiCharacterRigScale.MAX_SCALE.
  const MIN_CAMERA_ZOOM = 0.35; // Keeps mobile pinch from losing the lineup completely.
  const MAX_CAMERA_ZOOM = 6; // Keeps orthographic zoom useful without numerical extremes.

  let installedPanel = null; // Tracks the panel whose capture listeners we own.
  let lastHeadSignature = ''; // Avoids overwriting an active mobile numeric edit every poll tick.
  let threePromise = null; // Shares the asynchronous Three.js module lookup.
  let cameraState = null; // Stores the original perspective-camera fields for exact restoration.
  let lastFrameSignature = ''; // Avoids reframing unchanged lineups every poll tick.
  let pinchSession = null; // Tracks Full Character Scale's two-finger camera zoom gesture.
  const activeTouchPointers = new Map(); // Current canvas touch pointers used by pinch zoom.

  const round1 = value => Math.round(Number(value) * 10) / 10;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
  const finitePositive = (value, fallback = 1) => {
    const number = Number(value); // Numeric value returned below when finite and positive.
    return Number.isFinite(number) && number > EPSILON ? number : fallback;
  };

  function rawHeadPercentFromRuntime(runtimeHeadScale, portraitScale) {
    return finitePositive(runtimeHeadScale, 1) * finitePositive(portraitScale, 1) * 100;
  }

  function runtimeHeadPercentFromRaw(rawPngPercent, portraitScale) {
    return (Number(rawPngPercent) || 0) / finitePositive(portraitScale, 1);
  }

  function pinchZoomFromDistances(startZoom, startDistance, currentDistance) {
    if (!(Number(startDistance) > EPSILON) || !(Number(currentDistance) > EPSILON)) return finitePositive(startZoom, 1);
    return clamp(finitePositive(startZoom, 1) * Number(currentDistance) / Number(startDistance), MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
  }

  function comparisonApi() {
    return window.HobunjiFullCharacterScaleComparison || null;
  }

  function selectedIdentity() {
    const key = String(comparisonApi()?.selectedKey || ''); // Species/gender key used to resolve profile and preview group.
    const [species, gender] = key.split('::');
    return species && gender ? { key, species, gender } : null;
  }

  function profileFor(identity) {
    return identity ? window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[identity.key] || null : null;
  }

  function portraitScaleFor(identity) {
    const profileScale = Number(profileFor(identity)?.anatomy?.portraitScale); // Preferred because the preview copies this exact authored multiplier into PNGPlaneAvatar.
    if (Number.isFinite(profileScale) && profileScale > EPSILON) return profileScale;
    try {
      return finitePositive(window.PNGPlaneAvatar?.avatarScaleMultiplierFor?.({
        appearance: { speciesId: identity?.species, gender: identity?.gender },
      }), 1);
    } catch (_) {
      return 1;
    }
  }

  function runtimeScaleFor(identity) {
    const profile = profileFor(identity); // Includes unsaved local authoring changes.
    return window.HobunjiCharacterRigScale?.scaleFor?.(identity?.species, identity?.gender, profile)
      || { x: 1, y: 1, head: 1, offsetY: 0 };
  }

  function rawHeadBounds(portraitScale) {
    const portrait = finitePositive(portraitScale, 1); // Converts the runtime clamp into the user-facing raw-PNG coordinate space.
    return { min: MIN_RUNTIME_HEAD * portrait * 100, max: MAX_RUNTIME_HEAD * portrait * 100 };
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Right-side rail plus mobile-friendly numeric input sizing.
    style.id = STYLE_ID;
    style.textContent = `
body[data-animation-author-mode="${MODE}"] #${PANEL_ID}{
  position:fixed!important;z-index:30!important;
  top:max(68px,env(safe-area-inset-top))!important;
  right:max(10px,env(safe-area-inset-right))!important;
  bottom:auto!important;left:auto!important;transform:none!important;
  width:min(330px,calc(100vw - 20px))!important;
  max-height:calc(100vh - max(82px,env(safe-area-inset-top)) - 12px)!important;
  overflow:auto!important;align-content:start;
}
body[data-animation-author-mode="${MODE}"] #${PANEL_ID} .scaleRow{
  grid-template-columns:88px minmax(110px,1fr) 68px!important;
}
body[data-animation-author-mode="${MODE}"] #${PANEL_ID} .scaleRow>label{align-self:center}
body[data-animation-author-mode="${MODE}"] #${HEAD_NUMBER_ID}{min-width:0;width:100%;font-variant-numeric:tabular-nums}
#${HEAD_BASIS_ID}{font-size:10px;color:var(--muted);line-height:1.25;margin-top:-4px}
@media(max-width:620px){
  body[data-animation-author-mode="${MODE}"] #${PANEL_ID}{width:min(300px,calc(100vw - 16px))!important;right:8px!important}
  body[data-animation-author-mode="${MODE}"] #${PANEL_ID} .scaleRow{grid-template-columns:76px minmax(82px,1fr) 64px!important}
}
`;
    document.head.appendChild(style);
  }

  function ensureHeadBasis() {
    const range = document.getElementById(HEAD_RANGE_ID); // Locates the existing Head row without rebuilding the editor UI.
    const row = range?.closest?.('.scaleRow');
    if (!row) return null;
    const label = row.querySelector('label');
    if (label) {
      label.textContent = 'Head (raw PNG)';
      label.title = 'Final head size as a percentage of the raw portrait PNG dimensions, including the portrait-plane scale.';
    }
    range.setAttribute('aria-label', 'Head scale relative to raw portrait PNG dimensions');
    document.getElementById(HEAD_NUMBER_ID)?.setAttribute('aria-label', 'Head scale relative to raw portrait PNG dimensions (exact value)');
    let basis = document.getElementById(HEAD_BASIS_ID); // Conversion explanation updated for each selected species/gender.
    if (!basis) {
      basis = document.createElement('div');
      basis.id = HEAD_BASIS_ID;
      row.insertAdjacentElement('afterend', basis);
    }
    return basis;
  }

  function setHeadBounds(portraitScale) {
    const bounds = rawHeadBounds(portraitScale); // Raw-PNG limits corresponding exactly to runtime's 0.1..4 headScale clamp.
    for (const id of [HEAD_RANGE_ID, HEAD_NUMBER_ID]) {
      const input = document.getElementById(id);
      if (!input) continue;
      input.min = String(round1(bounds.min));
      input.max = String(round1(bounds.max));
      input.step = '0.5';
    }
    return bounds;
  }

  function setHeadDisplayValue(rawPercent, options = {}) {
    const range = document.getElementById(HEAD_RANGE_ID); // Range stays canonical even while the number field contains an in-progress partial edit.
    const number = document.getElementById(HEAD_NUMBER_ID);
    if (range) range.value = String(rawPercent);
    if (number && (options.forceNumber || document.activeElement !== number)) number.value = String(round1(rawPercent));
  }

  function updateHeadBasis(identity, runtimeHead = null) {
    const basis = ensureHeadBasis();
    if (!basis || !identity) return;
    const portrait = portraitScaleFor(identity); // Previously hidden plane scale included in the user-facing value.
    const runtime = runtimeHead ?? runtimeScaleFor(identity).head;
    const raw = rawHeadPercentFromRuntime(runtime, portrait);
    basis.textContent = `Raw PNG head ${round1(raw)}% = portrait plane ${round1(portrait * 100)}% × runtime head factor ${round1(runtime * 100)}%.`;
  }

  function syncHeadUi(force = false) {
    const identity = selectedIdentity();
    if (!identity) return;
    const portrait = portraitScaleFor(identity); // Used for both displayed value and slider bounds.
    const runtime = runtimeScaleFor(identity).head;
    const raw = rawHeadPercentFromRuntime(runtime, portrait);
    const signature = `${identity.key}|${portrait.toFixed(8)}|${runtime.toFixed(8)}`; // Changes whenever selection or authored head factor changes.
    const number = document.getElementById(HEAD_NUMBER_ID);
    if (!force && document.activeElement === number) return; // Never stomp a mobile keyboard edit such as the first digit of "102".
    if (!force && signature === lastHeadSignature) return;
    lastHeadSignature = signature;
    setHeadBounds(portrait);
    setHeadDisplayValue(raw, { forceNumber: force });
    updateHeadBasis(identity, runtime);
  }

  function previewGroupFor(identity) {
    const scene = window.HobunjiGameplayBackdrop?.getScene?.(); // Full-scale preview groups live directly under the public backdrop scene.
    return scene?.getObjectByName?.(`FullScalePreview_${identity?.key}`) || null;
  }

  function headScaleJointFor(group) {
    let joint = null; // Filled by the first neck-rig-bearing avatar node found inside the selected preview group.
    group?.traverse?.(node => {
      if (joint) return;
      const rig = node?.userData?.neckRig;
      if (rig?.headScaleJoint?.scale) joint = rig.headScaleJoint;
    });
    if (joint) return joint;
    group?.traverse?.(node => {
      if (!joint && node?.isBone && /_head_scale_bone$/i.test(node.name || '') && node.scale) joint = node;
    });
    return joint;
  }

  function applyRawHeadPercent(rawPercent) {
    const identity = selectedIdentity();
    const profile = profileFor(identity);
    if (!identity || !profile) return null;
    const portrait = portraitScaleFor(identity); // Converts the raw-PNG percentage back to the unchanged runtime headScale schema.
    const bounds = rawHeadBounds(portrait);
    const clampedRaw = clamp(Number(rawPercent), bounds.min, bounds.max);
    const runtimeHead = clamp(runtimeHeadPercentFromRaw(clampedRaw, portrait) / 100, MIN_RUNTIME_HEAD, MAX_RUNTIME_HEAD);
    profile.anatomy ||= {};
    profile.anatomy.headScale = runtimeHead;

    const scale = runtimeScaleFor(identity); // Uses current authored body X/Y so the head remains aspect-correct under non-uniform body scale.
    const joint = headScaleJointFor(previewGroupFor(identity));
    if (joint?.scale?.set) {
      joint.scale.set(scale.head / scale.x, scale.head / scale.y, 1);
      joint.updateMatrix?.();
      joint.updateMatrixWorld?.(true);
    }
    lastHeadSignature = '';
    updateHeadBasis(identity, runtimeHead);
    return { rawPercent: clampedRaw, runtimeHead, portraitScale: portrait };
  }

  function persistProfiles() {
    try {
      const host = window.HobunjiAnimationAuthorScaleHost || window.HobunjiAnimationAuthorHost;
      const data = host?.serializeRig?.() || {
        schema: 'hobunji.attachment-rig-profiles.v10',
        exportedAt: new Date().toISOString(),
        profiles: JSON.parse(JSON.stringify(window.HOBUNJI_ATTACHMENT_RIG_PROFILES || {})),
      }; // Same persistence contract used by the comparison editor itself.
      localStorage.setItem(RIG_SAVE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('[full-character-scale] head autosave failed', error);
    }
  }

  function consumeHeadEvent(event) {
    if (document.body.dataset.animationAuthorMode !== MODE) return false;
    if (event.target?.id !== HEAD_RANGE_ID && event.target?.id !== HEAD_NUMBER_ID) return false;
    event.stopPropagation();
    event.stopImmediatePropagation(); // Prevents character-scale-comparison.js from reinterpreting the raw-PNG number as runtime percent.
    return true;
  }

  function onPanelInput(event) {
    const id = event.target?.id;
    if (id === HEAD_RANGE_ID || id === HEAD_NUMBER_ID) {
      if (!consumeHeadEvent(event)) return;
      const identity = selectedIdentity();
      if (!identity) return;
      const portrait = portraitScaleFor(identity);
      const bounds = setHeadBounds(portrait);
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return; // Empty/partial mobile numeric edits stay editable until a valid value exists.
      if (id === HEAD_NUMBER_ID && (value < bounds.min || value > bounds.max)) return; // Do not snap the first digit while the user is still typing a multi-digit value.
      const applied = applyRawHeadPercent(value);
      if (!applied) return;
      if (id === HEAD_RANGE_ID) {
        const number = document.getElementById(HEAD_NUMBER_ID);
        if (number) number.value = String(round1(applied.rawPercent));
      } else {
        const range = document.getElementById(HEAD_RANGE_ID);
        if (range) range.value = String(applied.rawPercent);
      }
      return;
    }

    // Width/Height/Head-Y use the original handler. That handler also reads Head,
    // so lend it the internal runtime percentage only for the duration of this
    // event, then restore the raw-PNG display in a microtask.
    if (!['maaFullScaleRangeX','maaFullScaleNumX','maaFullScaleRangeY','maaFullScaleNumY','maaFullScaleRangeOffsetY','maaFullScaleNumOffsetY'].includes(id)) return;
    const identity = selectedIdentity();
    if (!identity) return;
    const range = document.getElementById(HEAD_RANGE_ID);
    const number = document.getElementById(HEAD_NUMBER_ID);
    if (!range || !number) return;
    const runtimePercent = runtimeScaleFor(identity).head * 100;
    range.value = String(runtimePercent);
    number.value = String(runtimePercent);
    queueMicrotask(() => {
      lastHeadSignature = '';
      syncHeadUi(true);
    });
  }

  function commitHeadNumber(event) {
    if (event.target?.id !== HEAD_RANGE_ID && event.target?.id !== HEAD_NUMBER_ID) return;
    if (!consumeHeadEvent(event)) return;
    const identity = selectedIdentity();
    if (!identity) return;
    const portrait = portraitScaleFor(identity);
    const bounds = setHeadBounds(portrait);
    const fallbackRaw = rawHeadPercentFromRuntime(runtimeScaleFor(identity).head, portrait);
    const typed = Number(event.target.value);
    const raw = Number.isFinite(typed) ? clamp(typed, bounds.min, bounds.max) : fallbackRaw;
    const applied = applyRawHeadPercent(raw);
    if (applied) setHeadDisplayValue(applied.rawPercent, { forceNumber: true });
    persistProfiles();
  }

  function installUiEnhancements() {
    ensureStyle();
    const panel = document.getElementById(PANEL_ID); // Panel is created lazily by character-scale-comparison.js.
    if (!panel) return false;
    ensureHeadBasis();
    if (installedPanel !== panel) {
      installedPanel = panel;
      panel.addEventListener('input', onPanelInput, true);
      panel.addEventListener('change', commitHeadNumber, true);
      panel.addEventListener('focusout', event => {
        if (event.target?.id === HEAD_NUMBER_ID) commitHeadNumber(event);
      }, true);
      panel.addEventListener('keydown', event => {
        if (event.target?.id === HEAD_NUMBER_ID && event.key === 'Enter') event.target.blur?.();
      }, true);
      panel.querySelector('#maaFullScaleReset')?.addEventListener('click', () => setTimeout(() => syncHeadUi(true), 0), true);
      panel.querySelector('#maaFullScaleFrame')?.addEventListener('click', () => setTimeout(() => frameOrthographic(true, true), 0), true);
    }
    return true;
  }

  function threeModules() {
    if (!threePromise) {
      threePromise = Promise.resolve(window.PNGPlaneAvatar?.loadThreeModules?.()).then(modules => modules?.THREE || null).catch(() => null); // Reuses the exact Three.js copy backing the preview scene.
    }
    return threePromise;
  }

  function saveCamera(camera) {
    if (cameraState?.camera === camera) return cameraState;
    cameraState = {
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
    }; // Restored verbatim when leaving Full Character Scale.
    camera.isPerspectiveCamera = false;
    camera.isOrthographicCamera = true;
    camera.near = 0.01;
    camera.far = Math.max(1000, Number(camera.far) || 1000);
    camera.zoom = 1;
    const state = cameraState;
    camera.updateProjectionMatrix = function fullScaleOrthographicProjection() {
      if (!cameraState || cameraState.camera !== this || document.body.dataset.animationAuthorMode !== MODE || !cameraState.orthoBounds) {
        return state.originalUpdateProjectionMatrix.call(this);
      }
      applyOrthographicProjection(this, cameraState.orthoBounds);
    };
    return cameraState;
  }

  function applyOrthographicProjection(camera, bounds) {
    const zoom = clamp(finitePositive(camera.zoom, 1), MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM); // OrbitControls/wheel and our pinch gesture both feed this same true camera zoom.
    camera.zoom = zoom;
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const halfWidth = (bounds.right - bounds.left) / (2 * zoom);
    const halfHeight = (bounds.top - bounds.bottom) / (2 * zoom);
    camera.left = centerX - halfWidth;
    camera.right = centerX + halfWidth;
    camera.top = centerY + halfHeight;
    camera.bottom = centerY - halfHeight;
    camera.projectionMatrix.makeOrthographic(camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far);
    camera.projectionMatrixInverse?.copy?.(camera.projectionMatrix)?.invert?.();
  }

  function restoreCamera() {
    const state = cameraState; // Preserve a local reference while clearing global mode state.
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

  async function frameOrthographic(force = false, resetZoom = false) {
    if (document.body.dataset.animationAuthorMode !== MODE) return;
    const camera = window.HobunjiGameplayBackdrop?.getCamera?.(); // Same live camera rendered by Animation Author.
    const scene = window.HobunjiGameplayBackdrop?.getScene?.();
    const root = scene?.getObjectByName?.('FullCharacterScalePreviewRoot');
    const canvas = document.getElementById('view3d');
    if (!camera || !root || !canvas?.clientWidth || !canvas?.clientHeight) return;
    const THREE = await threeModules();
    if (!THREE || document.body.dataset.animationAuthorMode !== MODE) return;

    const panel = document.getElementById(PANEL_ID); // Reserved screen width keeps the lineup out from under the right rail.
    const panelWidth = Math.min(canvas.clientWidth * 0.55, panel?.getBoundingClientRect?.().width || 0);
    const reservePx = panelWidth ? panelWidth + 18 : 0;
    const usableWidth = Math.max(canvas.clientWidth * 0.35, canvas.clientWidth - reservePx);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const signature = `${canvas.clientWidth}x${canvas.clientHeight}|${reservePx.toFixed(1)}|${size.x.toFixed(4)},${size.y.toFixed(4)},${size.z.toFixed(4)}`;
    if (!force && signature === lastFrameSignature && cameraState?.camera === camera) return;
    lastFrameSignature = signature;

    const state = saveCamera(camera);
    if (resetZoom) camera.zoom = 1;
    const usableAspect = Math.max(0.1, usableWidth / Math.max(1, canvas.clientHeight));
    const paddedWidth = Math.max(0.8, size.x + 0.7);
    const paddedHeight = Math.max(0.8, size.y + 0.55);
    const viewHeight = Math.max(paddedHeight, paddedWidth / usableAspect);
    const viewWidth = viewHeight * (canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const railShiftWorld = reservePx > 0 ? (reservePx / canvas.clientWidth) * viewWidth * 0.5 : 0; // Shifts the orthographic frustum right so the lineup appears centered in the unobstructed left region.
    const cameraCenterX = center.x + railShiftWorld;
    const targetY = center.y;
    camera.position.set(cameraCenterX, targetY, center.z + Math.max(8, size.z + 6));
    camera.lookAt(cameraCenterX, targetY, center.z);
    state.orthoBounds = {
      left: -viewWidth / 2,
      right: viewWidth / 2,
      top: viewHeight / 2,
      bottom: -viewHeight / 2,
    };
    applyOrthographicProjection(camera, state.orthoBounds);
    camera.updateMatrixWorld?.(true);
  }

  function distanceBetweenTwoTouches() {
    const points = [...activeTouchPointers.values()]; // First two active canvas touches define the pinch distance.
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function canvasTouchEvent(event) {
    const canvas = document.getElementById('view3d'); // Only touches that started on the 3D canvas participate in comparison zoom.
    return document.body.dataset.animationAuthorMode === MODE && event.pointerType === 'touch' && (event.target === canvas || activeTouchPointers.has(event.pointerId));
  }

  function onPointerDown(event) {
    if (!canvasTouchEvent(event)) return;
    activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeTouchPointers.size === 1) {
      pinchSession = { passthroughPointerId: event.pointerId, active: false, startDistance: 0, startZoom: 1 }; // First finger remains available to normal single-touch orbit/select behavior.
      return;
    }
    if (activeTouchPointers.size === 2) {
      const camera = window.HobunjiGameplayBackdrop?.getCamera?.();
      pinchSession ||= { passthroughPointerId: null, active: false, startDistance: 0, startZoom: 1 };
      pinchSession.active = true;
      pinchSession.startDistance = distanceBetweenTwoTouches();
      pinchSession.startZoom = finitePositive(camera?.zoom, 1);
      event.preventDefault();
      event.stopImmediatePropagation(); // OrbitControls never receives the second finger, so it cannot transform the center placeholder.
    }
  }

  function onPointerMove(event) {
    if (!activeTouchPointers.has(event.pointerId)) return;
    activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinchSession?.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const camera = window.HobunjiGameplayBackdrop?.getCamera?.();
    if (!camera || !cameraState?.orthoBounds) return;
    camera.zoom = pinchZoomFromDistances(pinchSession.startZoom, pinchSession.startDistance, distanceBetweenTwoTouches());
    applyOrthographicProjection(camera, cameraState.orthoBounds);
  }

  function onPointerEnd(event) {
    if (!activeTouchPointers.has(event.pointerId)) return;
    const passthrough = pinchSession?.passthroughPointerId === event.pointerId; // The first finger was seen by OrbitControls and must be allowed to release cleanly.
    const wasPinching = !!pinchSession?.active;
    activeTouchPointers.delete(event.pointerId);
    if (wasPinching && !passthrough) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (activeTouchPointers.size < 2 && pinchSession) pinchSession.active = false;
    if (!activeTouchPointers.size) pinchSession = null;
  }

  function installPinchCapture() {
    if (window.__hobunjiFullScalePinchCaptureInstalled) return;
    window.__hobunjiFullScalePinchCaptureInstalled = true;
    window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onPointerEnd, { capture: true, passive: false });
    window.addEventListener('pointercancel', onPointerEnd, { capture: true, passive: false });
  }

  function resetPinchState() {
    activeTouchPointers.clear();
    pinchSession = null;
  }

  function tick() {
    installUiEnhancements();
    if (document.body.dataset.animationAuthorMode === MODE) {
      syncHeadUi(false);
      frameOrthographic(false, false);
    } else {
      restoreCamera();
      resetPinchState();
    }
  }

  installPinchCapture();
  window.addEventListener('resize', () => {
    lastFrameSignature = '';
    if (document.body.dataset.animationAuthorMode === MODE) frameOrthographic(true, false);
  });
  setInterval(tick, 50);
  tick();

  window.HobunjiFullScaleEditorPresentation = Object.freeze({
    rawHeadPercentFromRuntime,
    runtimeHeadPercentFromRaw,
    rawHeadBounds,
    pinchZoomFromDistances,
    applyRawHeadPercent,
    syncHeadUi,
    frameOrthographic,
    restoreCamera,
  }); // Small diagnostic/test API for regression coverage and mobile console checks.
})();
