(() => {
  'use strict';

  if (Number(window.WorldPopupRelationshipEditor?.version) >= 3) return;
  if (!/\/tools\/world-popup-editor\//.test(location.pathname)) return;

  const MODULE_SRC = document.currentScript?.src || ''; // Used to resolve the shared relationship-position bridge from this editor helper's own URL.
  const POSITION_BRIDGE_URL = MODULE_SRC ? new URL('favor-popup-points-bridge.js?v=20260915position3', MODULE_SRC).href : '../../js/favor-popup-points-bridge.js?v=20260915position3'; // Used to run the exact same relationship renderer/anchor code in the editor and game.
  const debugState = { errors: [], bridgeLoad: 'waiting', retryingAvatar: false, lastSnapshot: null }; // Used by the always-visible mobile diagnostics panel.
  let bridgePromise = null; // Used to load the runtime relationship position bridge at most once.
  let diagnosticsTimer = 0; // Used to refresh asynchronous avatar/render state without requiring console access.

  function editorValue(name) {
    try {
      return (0, eval)(name); // Used to read the Popup Text Editor's global lexical bindings without changing that editor's existing implementation.
    } catch (_) {
      return undefined;
    }
  }

  function getPopupRuntime() { return editorValue('popupRuntime'); }
  function getThree() { return editorValue('THREE'); }
  function getCamera() { return editorValue('camera'); }
  function getScene() { return editorValue('scene'); }
  function getAvatarModel() { return editorValue('avatarModel'); }
  function getAvatarHolder() { return editorValue('avatarHolder'); }
  function getPreviewScene() { return editorValue('previewScene'); }
  function getNpcs() { return editorValue('npcs'); }
  function getRenderAvatar() { return editorValue('renderAvatar'); }
  function getStatusFunction() { return editorValue('status'); }

  function rememberError(message) {
    const text = String(message || 'Unknown error').trim(); // Used as a compact phone-readable error line.
    if (!text || debugState.errors[debugState.errors.length - 1] === text) return;
    debugState.errors.push(text);
    if (debugState.errors.length > 10) debugState.errors.shift();
    updateDiagnostics();
  }

  window.addEventListener('error', event => {
    if (event.target && event.target !== window) {
      const source = event.target.src || event.target.href || event.target.currentSrc || event.target.tagName; // Used to identify failed scripts/images/modules in the visible debug log.
      rememberError(`Resource error: ${source || 'unknown resource'}`);
      return;
    }
    rememberError(`JS error: ${event.message || event.error?.message || 'unknown'}${event.filename ? ` @ ${event.filename.split('/').pop()}:${event.lineno || '?'}` : ''}`);
  }, true);
  window.addEventListener('unhandledrejection', event => rememberError(`Promise rejection: ${event.reason?.stack || event.reason?.message || event.reason || 'unknown'}`));

  function ensurePositionBridge() {
    if (Number(window.FavorPopupPointsBridge?.version) >= 3) {
      debugState.bridgeLoad = 'ready';
      return Promise.resolve(window.FavorPopupPointsBridge);
    }
    if (bridgePromise) return bridgePromise;
    debugState.bridgeLoad = 'loading';
    bridgePromise = new Promise(resolve => {
      const script = document.createElement('script'); // Used to load the same v3 relationship renderer used by gameplay rather than an editor-only imitation.
      script.src = POSITION_BRIDGE_URL;
      script.async = false;
      script.onload = () => {
        const bridge = window.FavorPopupPointsBridge;
        debugState.bridgeLoad = Number(bridge?.version) >= 3 ? 'ready' : 'loaded-but-missing-v3';
        if (!bridge) rememberError('Relationship position bridge loaded but did not expose FavorPopupPointsBridge.');
        updateDiagnostics();
        resolve(bridge || null);
      };
      script.onerror = () => {
        debugState.bridgeLoad = 'load-failed';
        rememberError(`Relationship position bridge failed to load: ${POSITION_BRIDGE_URL}`);
        resolve(null);
      };
      document.head.appendChild(script);
    });
    return bridgePromise;
  }

  function bindBridgeDeps() {
    const bridge = window.FavorPopupPointsBridge; // Used as the shared runtime/editor relationship popup owner.
    const THREE = getThree(); // Used as the editor's exact Three.js instance.
    const camera = getCamera(); // Used as the editor's exact preview camera.
    const scene = getScene(); // Used as the current editor preview scene for WorldPopupText compatibility.
    const avatarHolder = getAvatarHolder(); // Used as the editor's relationship popup anchor root.
    if (Number(bridge?.version) < 3 || !THREE || !camera) return false;
    bridge.install?.();
    bridge.bindDeps?.({ THREE, camera, playerRoot: avatarHolder, getActiveScene: () => scene });
    return Number(getPopupRuntime()?.__favorPopupPointsBridgeVersion) >= 3;
  }

  function injectControls() {
    if (document.getElementById('relationshipPopupPreviewSection')) return;
    const jsonSection = document.getElementById('json')?.closest('.section'); // Used as a stable insertion point in the existing Popup Text Editor control column.
    if (!jsonSection) return;
    const section = document.createElement('section'); // Used as editor-only controls for firing the real shared relationship popup above the selected character.
    section.id = 'relationshipPopupPreviewSection';
    section.className = 'section';
    section.innerHTML = `
      <h2>Overhead Rapport / Favor</h2>
      <div class="help">Uses the same relationship renderer and avatar-local head anchor as gameplay. The anchor is recalculated through the character transform every frame instead of caching a world-Y head offset.</div>
      <div class="buttons" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <button type="button" data-relationship-kind="rapport" data-relationship-amount="10">Rapport +10</button>
        <button type="button" data-relationship-kind="rapport" data-relationship-amount="-10">Rapport -10</button>
        <button type="button" data-relationship-kind="favor" data-relationship-amount="10">Favor +10</button>
        <button type="button" data-relationship-kind="favor" data-relationship-amount="-10">Favor -10</button>
      </div>
      <div id="relationshipPopupPreviewDebug" class="status"></div>
    `;
    jsonSection.parentNode.insertBefore(section, jsonSection);
    section.querySelectorAll('[data-relationship-kind]').forEach(button => {
      button.addEventListener('click', () => play(button.dataset.relationshipKind, Number(button.dataset.relationshipAmount)));
    });
    updateRelationshipStatus();
  }

  function updateRelationshipStatus() {
    const node = document.getElementById('relationshipPopupPreviewDebug'); // Used to show whether the shared v3 renderer is actually installed before a preview click.
    if (!node) return;
    const bridge = window.FavorPopupPointsBridge;
    const popupRuntime = getPopupRuntime();
    node.textContent = `shared position renderer: ${Number(bridge?.version) >= 3 ? 'v3 ready' : debugState.bridgeLoad} · popup bridge ${Number(popupRuntime?.__favorPopupPointsBridgeVersion) || 0}`;
  }

  async function play(kind, amount) {
    await ensurePositionBridge();
    bindBridgeDeps();
    const avatarModel = getAvatarModel(); // Used to reject preview clicks when there is still no character model to anchor to.
    const avatarHolder = getAvatarHolder(); // Used as the actual Three.js relationship anchor root.
    const popupRuntime = getPopupRuntime(); // Used as the shared runtime relationship API after v3 installation.
    if (!avatarModel || !avatarHolder || typeof popupRuntime?.showRelationshipChange !== 'function') {
      rememberError('Cannot play relationship popup: avatar model, avatar holder, or v3 popup API is not ready.');
      return false;
    }
    popupRuntime.clear?.();
    const result = popupRuntime.showRelationshipChange(avatarHolder, kind, amount, { amountIsPoints: true }); // Used to render literal +10/-10 editor examples without gameplay Favor-heart conversion.
    if (result?.catch) result.catch(error => rememberError(`Relationship popup failed: ${error.stack || error.message}`));
    updateRelationshipStatus();
    return true;
  }

  function diagnosticsSnapshot() {
    const popupRuntime = getPopupRuntime(); // Used to report whether WorldPopupText initialization completed.
    const THREE = getThree(); // Used to report whether the configured Three.js module loaded.
    const camera = getCamera(); // Used to report whether the preview camera exists.
    const avatarModel = getAvatarModel(); // Used to report whether PNGPlaneAvatar produced an actual model.
    const avatarHolder = getAvatarHolder(); // Used to report whether that model is attached to its preview root.
    const previewScene = getPreviewScene(); // Used to report whether AvatarPreviewScene.create completed.
    const npcs = getNpcs(); // Used to report whether the NPC database loaded and normalized.
    const bridgeSnapshot = window.FavorPopupPointsBridge?.snapshot?.() || null; // Used to expose the real relationship anchor source and latest world coordinates.
    const statusText = document.getElementById('status')?.textContent?.trim() || ''; // Used to surface the editor's original one-line status.
    const threeConfig = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {}; // Used to reveal the configured CDN module when Three.js fails.
    const panel = document.getElementById('worldPopupEditorDiagnostics'); // Used to prove the debug HUD itself is viewport-fixed rather than world/preview positioned.
    let modelBounds = 'n/a'; // Used to reveal zero-sized or invalid avatar models.
    try {
      if (avatarModel && THREE?.Box3 && THREE?.Vector3) {
        const size = new THREE.Box3().setFromObject(avatarModel).getSize(new THREE.Vector3());
        modelBounds = `${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)}`;
      }
    } catch (error) {
      modelBounds = `error: ${error.message}`;
    }
    const panelRect = panel?.getBoundingClientRect?.(); // Used to catch any unexpected screen-position movement in copied diagnostics.
    return {
      helperVersion: 3,
      bridgeLoad: debugState.bridgeLoad,
      bridgeVersion: Number(window.FavorPopupPointsBridge?.version) || 0,
      popupBridgeVersion: Number(popupRuntime?.__favorPopupPointsBridgeVersion) || 0,
      coreScripts: {
        scratchbonesConfig: !!window.SCRATCHBONES_CONFIG,
        npcAvatarPreview: !!window.NpcAvatarPreview,
        pngPlaneAvatar: !!window.PNGPlaneAvatar,
        avatarPreviewScene: !!window.AvatarPreviewScene,
        worldPopupText: !!window.WorldPopupText,
      },
      three: {
        configured: !!threeConfig.threeModuleUrl,
        loaded: !!THREE,
        renderer: !!previewScene?.renderer,
        camera: !!camera,
        moduleUrl: threeConfig.threeModuleUrl || 'missing',
      },
      npc: {
        count: Array.isArray(npcs) ? npcs.length : 0,
        selected: document.getElementById('npcSelect')?.selectedOptions?.[0]?.textContent || 'none',
      },
      avatar: {
        holder: !!avatarHolder,
        holderChildren: Number(avatarHolder?.children?.length) || 0,
        model: !!avatarModel,
        modelBounds,
      },
      relationshipAnchor: bridgeSnapshot?.lastAnchor || null,
      activeRelationshipPopups: Number(bridgeSnapshot?.activeRelationshipPopups) || 0,
      panel: panelRect ? { position: getComputedStyle(panel).position, top: panelRect.top, bottom: panelRect.bottom, height: panelRect.height, transform: getComputedStyle(panel).transform, transition: getComputedStyle(panel).transitionProperty, animation: getComputedStyle(panel).animationName } : null,
      editorStatus: statusText || '(none)',
      errors: [...debugState.errors],
    };
  }

  function diagnosticsText(snapshot = diagnosticsSnapshot()) {
    const core = snapshot.coreScripts;
    const anchor = snapshot.relationshipAnchor;
    const panel = snapshot.panel;
    const lines = [
      'Popup Text Editor diagnostics',
      `helper=v${snapshot.helperVersion} bridgeLoad=${snapshot.bridgeLoad} sharedBridge=v${snapshot.bridgeVersion} popupBridge=v${snapshot.popupBridgeVersion}`,
      `core config=${core.scratchbonesConfig ? 'yes' : 'NO'} npcPreview=${core.npcAvatarPreview ? 'yes' : 'NO'} pngPlane=${core.pngPlaneAvatar ? 'yes' : 'NO'} sceneApi=${core.avatarPreviewScene ? 'yes' : 'NO'} worldPopup=${core.worldPopupText ? 'yes' : 'NO'}`,
      `three configured=${snapshot.three.configured ? 'yes' : 'NO'} loaded=${snapshot.three.loaded ? 'yes' : 'NO'} renderer=${snapshot.three.renderer ? 'yes' : 'NO'} camera=${snapshot.three.camera ? 'yes' : 'NO'}`,
      `npc count=${snapshot.npc.count} selected=${snapshot.npc.selected}`,
      `avatar holder=${snapshot.avatar.holder ? 'yes' : 'NO'} children=${snapshot.avatar.holderChildren} model=${snapshot.avatar.model ? 'yes' : 'NO'} bounds=${snapshot.avatar.modelBounds}`,
      `relationship active=${snapshot.activeRelationshipPopups} anchor=${anchor ? `${anchor.source} world=(${Number(anchor.world?.x).toFixed(3)},${Number(anchor.world?.y).toFixed(3)},${Number(anchor.world?.z).toFixed(3)})` : 'none yet'}`,
      `debug panel=${panel ? `${panel.position} top=${panel.top.toFixed(1)} bottom=${panel.bottom.toFixed(1)} h=${panel.height.toFixed(1)} transform=${panel.transform} transition=${panel.transition} animation=${panel.animation}` : 'not mounted'}`,
      `status: ${snapshot.editorStatus}`,
      `Three URL: ${snapshot.three.moduleUrl}`,
    ];
    if (snapshot.errors.length) lines.push('errors:', ...snapshot.errors.map(error => `• ${error}`));
    else lines.push('errors: none captured');
    return lines.join('\n');
  }

  function injectDiagnostics() {
    if (document.getElementById('worldPopupEditorDiagnostics')) return;
    const panel = document.createElement('div'); // Used as a viewport-fixed HUD so no avatar, camera, scene, or preview-container motion can move the debug log.
    panel.id = 'worldPopupEditorDiagnostics';
    panel.style.cssText = 'position:fixed!important;z-index:2147483646!important;right:8px!important;bottom:8px!important;left:auto!important;top:auto!important;width:min(520px,calc(100vw - 16px))!important;max-width:calc(100vw - 16px)!important;max-height:min(42vh,360px)!important;overflow:auto!important;background:rgba(3,8,14,.96)!important;border:1px solid rgba(255,255,255,.24)!important;border-radius:9px!important;padding:7px 8px!important;color:#dbeafe!important;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace!important;box-shadow:0 4px 18px rgba(0,0,0,.45)!important;transform:none!important;transition:none!important;animation:none!important;will-change:auto!important;contain:layout paint style!important;overscroll-behavior:contain!important;touch-action:pan-y!important;pointer-events:auto!important';
    panel.innerHTML = `<div style="display:flex;align-items:center;gap:6px;position:sticky;top:0;background:rgba(3,8,14,.98);padding-bottom:5px"><b style="font:700 11px system-ui,sans-serif">Preview debug</b><span style="flex:1"></span><button type="button" data-debug-retry style="padding:4px 7px;font-size:10px">Retry avatar</button><button type="button" data-debug-copy style="padding:4px 7px;font-size:10px">Copy</button><button type="button" data-debug-toggle style="padding:4px 7px;font-size:10px">Hide</button></div><pre data-debug-output style="margin:0;white-space:pre-wrap;word-break:break-word"></pre>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-debug-retry]').addEventListener('click', () => retryAvatar());
    panel.querySelector('[data-debug-copy]').addEventListener('click', async () => {
      const text = diagnosticsText();
      try {
        await navigator.clipboard.writeText(text);
        panel.querySelector('[data-debug-copy]').textContent = 'Copied';
        setTimeout(() => { const button = panel.querySelector('[data-debug-copy]'); if (button) button.textContent = 'Copy'; }, 900);
      } catch (error) {
        rememberError(`Copy failed: ${error.message}`);
      }
    });
    panel.querySelector('[data-debug-toggle]').addEventListener('click', event => {
      const output = panel.querySelector('[data-debug-output');
      const hidden = output?.style.display === 'none';
      if (output) output.style.display = hidden ? '' : 'none';
      event.currentTarget.textContent = hidden ? 'Hide' : 'Show';
      panel.style.setProperty('max-height', hidden ? 'min(42vh,360px)' : '34px', 'important');
    });
    updateDiagnostics();
  }

  function updateDiagnostics() {
    const panel = document.getElementById('worldPopupEditorDiagnostics'); // Used to refresh the fixed HUD as async boot and relationship position state change.
    const output = panel?.querySelector('[data-debug-output]');
    const snapshot = diagnosticsSnapshot();
    debugState.lastSnapshot = snapshot;
    if (output) output.textContent = diagnosticsText(snapshot);
    updateRelationshipStatus();
  }

  async function retryAvatar() {
    if (debugState.retryingAvatar) return false;
    const renderAvatar = getRenderAvatar(); // Used to retry the editor's own avatar pipeline rather than creating a fake diagnostic character.
    const npcs = getNpcs(); // Used to select the current repository NPC for the retry.
    const previewScene = getPreviewScene(); // Used to distinguish failed Three.js boot from failed portrait rendering.
    const popupRuntime = getPopupRuntime(); // Used to ensure the scene/popup foundation exists first.
    if (!previewScene || !popupRuntime) {
      rememberError('Retry avatar blocked: the Three.js preview scene or popup runtime never initialized.');
      return false;
    }
    if (typeof renderAvatar !== 'function' || !Array.isArray(npcs) || !npcs.length) {
      rememberError('Retry avatar blocked: renderAvatar() or the NPC database is unavailable.');
      return false;
    }
    debugState.retryingAvatar = true;
    updateDiagnostics();
    try {
      if (window.NpcAvatarPreview?.ensurePortraitCosmetics) await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: '../../assets/', configBase: '../../config/' });
      const index = Math.max(0, Number(document.getElementById('npcSelect')?.value) || 0); // Used to preserve the currently selected avatar.
      await renderAvatar(npcs[index] || npcs[0]);
      if (!getAvatarModel()) throw new Error('renderAvatar() completed without assigning avatarModel.');
      getStatusFunction()?.(`Avatar retry succeeded for ${npcs[index]?.name || npcs[index]?.id || 'selected NPC'}.`);
      bindBridgeDeps();
      return true;
    } catch (error) {
      rememberError(`Avatar retry failed: ${error.stack || error.message}`);
      getStatusFunction()?.(`Avatar retry failed: ${error.message}`, 'bad');
      return false;
    } finally {
      debugState.retryingAvatar = false;
      updateDiagnostics();
    }
  }

  async function installWhenReady() {
    injectControls();
    injectDiagnostics();
    await ensurePositionBridge();
    bindBridgeDeps();
    updateDiagnostics();
    if (!diagnosticsTimer) diagnosticsTimer = window.setInterval(() => {
      bindBridgeDeps();
      updateDiagnostics();
    }, 500);
  }

  window.WorldPopupRelationshipEditor = Object.freeze({
    version: 3,
    install: installWhenReady,
    play,
    retryAvatar,
    snapshot() {
      return {
        version: 3,
        diagnostics: diagnosticsSnapshot(),
      };
    },
  });
  window.__worldPopupRelationshipEditorDebug = () => window.WorldPopupRelationshipEditor.snapshot();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
  else installWhenReady();
})();
