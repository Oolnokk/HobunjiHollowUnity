(() => {
  'use strict';

  if (Number(window.WorldPopupRelationshipEditor?.version) >= 4) return;
  if (!/\/tools\/world-popup-editor\//.test(location.pathname)) return;

  const MODULE_SRC = document.currentScript?.src || ''; // Used to resolve the shared runtime relationship bridge from this editor helper.
  const POSITION_BRIDGE_URL = MODULE_SRC ? new URL('favor-popup-points-bridge.js?v=20260915position3', MODULE_SRC).href : '../../js/favor-popup-points-bridge.js?v=20260915position3'; // Used to run the exact gameplay relationship renderer in the editor.
  const state = { errors: [], bridgeLoad: 'waiting', retryingAvatar: false, snapshot: null }; // Used by the fixed on-screen diagnostics surface.
  let bridgePromise = null; // Used to load the shared renderer at most once.
  let diagnosticsTimer = 0; // Used to refresh asynchronous boot/position information on mobile.

  function editorValue(name) {
    try { return (0, eval)(name); } catch (_) { return undefined; }
  }
  const popupRuntime = () => editorValue('popupRuntime'); // Used to access the editor's live WorldPopupText instance.
  const three = () => editorValue('THREE'); // Used to access the editor's exact Three.js module instance.
  const camera = () => editorValue('camera'); // Used to access the editor's preview camera.
  const scene = () => editorValue('scene'); // Used to access the editor's preview scene.
  const avatarModel = () => editorValue('avatarModel'); // Used to verify that a visible PNG-plane model was built.
  const avatarHolder = () => editorValue('avatarHolder'); // Used as the relationship popup's character root.
  const previewScene = () => editorValue('previewScene'); // Used to report renderer initialization state.
  const npcs = () => editorValue('npcs'); // Used to report NPC database state and retry the current character.
  const renderAvatar = () => editorValue('renderAvatar'); // Used to retry the editor's own avatar pipeline.
  const statusFunction = () => editorValue('status'); // Used to preserve the editor's normal status messaging.

  function rememberError(message) {
    const text = String(message || 'Unknown error').trim(); // Used as a compact phone-readable error entry.
    if (!text || state.errors[state.errors.length - 1] === text) return;
    state.errors.push(text);
    if (state.errors.length > 10) state.errors.shift();
    refreshDiagnostics();
  }

  window.addEventListener('error', event => {
    if (event.target && event.target !== window) {
      const source = event.target.src || event.target.href || event.target.currentSrc || event.target.tagName; // Used to expose failed scripts/images/modules without browser devtools.
      rememberError(`Resource error: ${source || 'unknown resource'}`);
    } else {
      rememberError(`JS error: ${event.message || event.error?.message || 'unknown'}${event.filename ? ` @ ${event.filename.split('/').pop()}:${event.lineno || '?'}` : ''}`);
    }
  }, true);
  window.addEventListener('unhandledrejection', event => rememberError(`Promise rejection: ${event.reason?.stack || event.reason?.message || event.reason || 'unknown'}`));

  function ensurePositionBridge() {
    if (Number(window.FavorPopupPointsBridge?.version) >= 3) {
      state.bridgeLoad = 'ready';
      return Promise.resolve(window.FavorPopupPointsBridge);
    }
    if (bridgePromise) return bridgePromise;
    state.bridgeLoad = 'loading';
    bridgePromise = new Promise(resolve => {
      const script = document.createElement('script'); // Used to load the same stable-head-anchor renderer that gameplay uses on this branch.
      script.src = POSITION_BRIDGE_URL;
      script.async = false;
      script.onload = () => {
        const bridge = window.FavorPopupPointsBridge;
        state.bridgeLoad = Number(bridge?.version) >= 3 ? 'ready' : 'loaded-without-v3';
        if (!bridge) rememberError('Relationship position bridge loaded without exposing FavorPopupPointsBridge.');
        refreshDiagnostics();
        resolve(bridge || null);
      };
      script.onerror = () => {
        state.bridgeLoad = 'load-failed';
        rememberError(`Relationship position bridge failed: ${POSITION_BRIDGE_URL}`);
        resolve(null);
      };
      document.head.appendChild(script);
    });
    return bridgePromise;
  }

  function bindBridge() {
    const bridge = window.FavorPopupPointsBridge; // Used as the single shared relationship-popup implementation.
    const THREE = three(); // Used to bind the editor's Three.js instance after asynchronous scene creation.
    const activeCamera = camera(); // Used to bind the editor's real preview camera.
    if (Number(bridge?.version) < 3 || !THREE || !activeCamera) return false;
    bridge.install?.();
    bridge.bindDeps?.({ THREE, camera: activeCamera, playerRoot: avatarHolder(), getActiveScene: () => scene() });
    return Number(popupRuntime()?.__favorPopupPointsBridgeVersion) >= 3;
  }

  function injectControls() {
    if (document.getElementById('relationshipPopupPreviewSection')) return;
    const jsonSection = document.getElementById('json')?.closest('.section'); // Used as a stable insertion point inside the existing controls column.
    if (!jsonSection) return;
    const section = document.createElement('section'); // Used as the Popup Text Editor's relationship preview controls.
    section.id = 'relationshipPopupPreviewSection';
    section.className = 'section';
    section.innerHTML = `
      <h2>Overhead Rapport / Favor</h2>
      <div class="help">Uses gameplay's shared renderer and a head point recalculated from avatar-local portrait height/placement every frame. No cached world-Y head offset.</div>
      <div class="buttons" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <button type="button" data-rel-kind="rapport" data-rel-amount="10">Rapport +10</button>
        <button type="button" data-rel-kind="rapport" data-rel-amount="-10">Rapport -10</button>
        <button type="button" data-rel-kind="favor" data-rel-amount="10">Favor +10</button>
        <button type="button" data-rel-kind="favor" data-rel-amount="-10">Favor -10</button>
      </div>
      <div id="relationshipPopupPreviewDebug" class="status"></div>
    `;
    jsonSection.parentNode.insertBefore(section, jsonSection);
    section.querySelectorAll('[data-rel-kind]').forEach(button => button.addEventListener('click', () => play(button.dataset.relKind, Number(button.dataset.relAmount))));
  }

  function updateRelationshipStatus() {
    const node = document.getElementById('relationshipPopupPreviewDebug'); // Used to show whether the editor is truly using the shared v3 renderer.
    if (!node) return;
    node.textContent = `shared position renderer: ${Number(window.FavorPopupPointsBridge?.version) >= 3 ? 'v3 ready' : state.bridgeLoad} · popup bridge ${Number(popupRuntime()?.__favorPopupPointsBridgeVersion) || 0}`;
  }

  async function play(kind, amount) {
    await ensurePositionBridge();
    bindBridge();
    const runtime = popupRuntime(); // Used as the shared WorldPopupText API after the v3 position bridge installs.
    const root = avatarHolder(); // Used as the selected character's actual Three.js anchor root.
    if (!avatarModel() || !root || typeof runtime?.showRelationshipChange !== 'function') {
      rememberError('Cannot play relationship popup: avatar model, avatar holder, or shared popup API is not ready.');
      return false;
    }
    runtime.clear?.();
    const result = runtime.showRelationshipChange(root, kind, amount, { amountIsPoints: true }); // Used to preview literal ±10 point labels without gameplay Favor conversion.
    if (result?.catch) result.catch(error => rememberError(`Relationship popup failed: ${error.stack || error.message}`));
    updateRelationshipStatus();
    return true;
  }

  function snapshot() {
    const THREE = three(); // Used to measure the current avatar model and reveal invisible/zero-sized output.
    const model = avatarModel();
    const holder = avatarHolder();
    const editorPreview = previewScene();
    const npcList = npcs();
    const bridge = window.FavorPopupPointsBridge?.snapshot?.() || null; // Used to expose the renderer's current avatar-local head anchor and world coordinate.
    const cfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {}; // Used to expose configured Three.js URLs when module boot fails.
    const panel = document.getElementById('worldPopupEditorDiagnostics'); // Used to verify that diagnostics themselves stay fixed to the viewport.
    let modelBounds = 'n/a';
    try {
      if (model && THREE?.Box3 && THREE?.Vector3) {
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        modelBounds = `${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)}`;
      }
    } catch (error) { modelBounds = `error: ${error.message}`; }
    const rect = panel?.getBoundingClientRect?.();
    return {
      helper: 4,
      bridgeLoad: state.bridgeLoad,
      bridgeVersion: Number(window.FavorPopupPointsBridge?.version) || 0,
      popupBridgeVersion: Number(popupRuntime()?.__favorPopupPointsBridgeVersion) || 0,
      core: {
        config: !!window.SCRATCHBONES_CONFIG,
        npcPreview: !!window.NpcAvatarPreview,
        pngPlane: !!window.PNGPlaneAvatar,
        sceneApi: !!window.AvatarPreviewScene,
        worldPopup: !!window.WorldPopupText,
      },
      three: { configured: !!cfg.threeModuleUrl, loaded: !!THREE, renderer: !!editorPreview?.renderer, camera: !!camera(), url: cfg.threeModuleUrl || 'missing' },
      npc: { count: Array.isArray(npcList) ? npcList.length : 0, selected: document.getElementById('npcSelect')?.selectedOptions?.[0]?.textContent || 'none' },
      avatar: { holder: !!holder, children: Number(holder?.children?.length) || 0, model: !!model, bounds: modelBounds },
      relationship: { active: Number(bridge?.activeRelationshipPopups) || 0, anchor: bridge?.lastAnchor || null, disposed: bridge?.lastDisposedReason || null },
      panel: rect ? { position: getComputedStyle(panel).position, top: rect.top, bottom: rect.bottom, height: rect.height, transform: getComputedStyle(panel).transform, transition: getComputedStyle(panel).transitionProperty, animation: getComputedStyle(panel).animationName } : null,
      status: document.getElementById('status')?.textContent?.trim() || '(none)',
      errors: [...state.errors],
    };
  }

  function snapshotText(data = snapshot()) {
    const anchor = data.relationship.anchor;
    const panel = data.panel;
    const lines = [
      'Popup Text Editor diagnostics',
      `helper=v${data.helper} bridgeLoad=${data.bridgeLoad} sharedBridge=v${data.bridgeVersion} popupBridge=v${data.popupBridgeVersion}`,
      `core config=${data.core.config ? 'yes' : 'NO'} npcPreview=${data.core.npcPreview ? 'yes' : 'NO'} pngPlane=${data.core.pngPlane ? 'yes' : 'NO'} sceneApi=${data.core.sceneApi ? 'yes' : 'NO'} worldPopup=${data.core.worldPopup ? 'yes' : 'NO'}`,
      `three configured=${data.three.configured ? 'yes' : 'NO'} loaded=${data.three.loaded ? 'yes' : 'NO'} renderer=${data.three.renderer ? 'yes' : 'NO'} camera=${data.three.camera ? 'yes' : 'NO'}`,
      `npc count=${data.npc.count} selected=${data.npc.selected}`,
      `avatar holder=${data.avatar.holder ? 'yes' : 'NO'} children=${data.avatar.children} model=${data.avatar.model ? 'yes' : 'NO'} bounds=${data.avatar.bounds}`,
      `relationship active=${data.relationship.active} anchor=${anchor ? `${anchor.source} world=(${Number(anchor.world?.x).toFixed(3)},${Number(anchor.world?.y).toFixed(3)},${Number(anchor.world?.z).toFixed(3)})` : 'none yet'} disposed=${data.relationship.disposed || 'none'}`,
      `debug panel=${panel ? `${panel.position} top=${panel.top.toFixed(1)} bottom=${panel.bottom.toFixed(1)} h=${panel.height.toFixed(1)} transform=${panel.transform} transition=${panel.transition} animation=${panel.animation}` : 'not mounted'}`,
      `status: ${data.status}`,
      `Three URL: ${data.three.url}`,
    ];
    if (data.errors.length) lines.push('errors:', ...data.errors.map(error => `• ${error}`));
    else lines.push('errors: none captured');
    return lines.join('\n');
  }

  function injectDiagnostics() {
    if (document.getElementById('worldPopupEditorDiagnostics')) return;
    const panel = document.createElement('div'); // Used as a pure screen-space HUD; it is deliberately not parented under #preview or any moving world/scene surface.
    panel.id = 'worldPopupEditorDiagnostics';
    panel.style.cssText = 'position:fixed!important;z-index:2147483646!important;right:8px!important;bottom:8px!important;left:auto!important;top:auto!important;width:min(520px,calc(100vw - 16px))!important;max-width:calc(100vw - 16px)!important;max-height:min(42vh,360px)!important;overflow:auto!important;background:rgba(3,8,14,.96)!important;border:1px solid rgba(255,255,255,.24)!important;border-radius:9px!important;padding:7px 8px!important;color:#dbeafe!important;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace!important;box-shadow:0 4px 18px rgba(0,0,0,.45)!important;transform:none!important;transition:none!important;animation:none!important;will-change:auto!important;contain:layout paint style!important;overscroll-behavior:contain!important;touch-action:pan-y!important;pointer-events:auto!important';
    panel.innerHTML = `<div style="display:flex;align-items:center;gap:6px;position:sticky;top:0;background:rgba(3,8,14,.98);padding-bottom:5px"><b style="font:700 11px system-ui,sans-serif">Preview debug</b><span style="flex:1"></span><button type="button" data-retry style="padding:4px 7px;font-size:10px">Retry avatar</button><button type="button" data-copy style="padding:4px 7px;font-size:10px">Copy</button><button type="button" data-toggle style="padding:4px 7px;font-size:10px">Hide</button></div><pre data-output style="margin:0;white-space:pre-wrap;word-break:break-word"></pre>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-retry]').addEventListener('click', retryAvatar);
    panel.querySelector('[data-copy]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(snapshotText());
        panel.querySelector('[data-copy]').textContent = 'Copied';
        setTimeout(() => { const button = panel.querySelector('[data-copy]'); if (button) button.textContent = 'Copy'; }, 900);
      } catch (error) { rememberError(`Copy failed: ${error.message}`); }
    });
    panel.querySelector('[data-toggle]').addEventListener('click', event => {
      const output = panel.querySelector('[data-output]');
      const hidden = output?.style.display === 'none';
      if (output) output.style.display = hidden ? '' : 'none';
      event.currentTarget.textContent = hidden ? 'Hide' : 'Show';
      panel.style.setProperty('max-height', hidden ? 'min(42vh,360px)' : '34px', 'important');
    });
  }

  function refreshDiagnostics() {
    const panel = document.getElementById('worldPopupEditorDiagnostics'); // Used to refresh the fixed HUD without changing its position or transform.
    const output = panel?.querySelector('[data-output]');
    const data = snapshot();
    state.snapshot = data;
    if (output) output.textContent = snapshotText(data);
    updateRelationshipStatus();
  }

  async function retryAvatar() {
    if (state.retryingAvatar) return false;
    const render = renderAvatar(); // Used to retry the editor's existing portrait/avatar path rather than inventing a fallback renderer.
    const npcList = npcs();
    if (!previewScene() || !popupRuntime()) {
      rememberError('Retry avatar blocked: Three.js preview scene or popup runtime never initialized.');
      return false;
    }
    if (typeof render !== 'function' || !Array.isArray(npcList) || !npcList.length) {
      rememberError('Retry avatar blocked: renderAvatar() or NPC database is unavailable.');
      return false;
    }
    state.retryingAvatar = true;
    try {
      await window.NpcAvatarPreview?.ensurePortraitCosmetics?.({ assetBase: '../../assets/', configBase: '../../config/' });
      const index = Math.max(0, Number(document.getElementById('npcSelect')?.value) || 0); // Used to preserve the currently selected NPC.
      await render(npcList[index] || npcList[0]);
      if (!avatarModel()) throw new Error('renderAvatar() completed without assigning avatarModel.');
      bindBridge();
      statusFunction()?.(`Avatar retry succeeded for ${npcList[index]?.name || npcList[index]?.id || 'selected NPC'}.`);
      return true;
    } catch (error) {
      rememberError(`Avatar retry failed: ${error.stack || error.message}`);
      statusFunction()?.(`Avatar retry failed: ${error.message}`, 'bad');
      return false;
    } finally {
      state.retryingAvatar = false;
      refreshDiagnostics();
    }
  }

  async function install() {
    injectControls();
    injectDiagnostics();
    await ensurePositionBridge();
    bindBridge();
    refreshDiagnostics();
    if (!diagnosticsTimer) diagnosticsTimer = setInterval(() => { bindBridge(); refreshDiagnostics(); }, 500);
  }

  window.WorldPopupRelationshipEditor = Object.freeze({ version: 4, install, play, retryAvatar, snapshot });
  window.__worldPopupRelationshipEditorDebug = () => snapshot();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
