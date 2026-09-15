(() => {
  'use strict';

  if (window.WorldPopupRelationshipEditor?.version >= 2) return;
  if (!/\/tools\/world-popup-editor\//.test(location.pathname)) return;

  const MODULE_SRC = document.currentScript?.src || ''; // Used to resolve the runtime heart asset from this module instead of from the editor page URL.
  const HEART_URL = MODULE_SRC ? new URL('../assets/hud/generic_icons/icon_heart.png', MODULE_SRC).href : '../../assets/hud/generic_icons/icon_heart.png';
  const RAPPORT_HEART_COLOR = '#ffd84d'; // Used by temporary Rapport changes, matching generic-hud-icons.js.
  const FAVOR_HEART_COLOR = '#ff8fbd'; // Used by permanent Favor changes, matching generic-hud-icons.js.
  const RELATIONSHIP_GAIN_COLOR = '#66d96f'; // Used by positive relationship deltas.
  const RELATIONSHIP_LOSS_COLOR = '#ff5b5b'; // Used by negative relationship deltas.
  const RELATIONSHIP_RENDER_ORDER = 1200; // Used to keep the billboard in the same overlay band as runtime world text.
  const POPUP_WIDTH = 360; // Used by the reference canvas to match the runtime relationship texture width.
  const POPUP_HEIGHT = 112; // Used by the reference canvas to match the runtime relationship texture height.
  const ICON_SIZE = 76; // Used by the reference heart to match runtime size.
  const DEFAULT_LIFETIME_MS = 1150; // Used when the popup runtime does not expose a Float+ lifetime.
  const active = []; // Used by the popup editor's frame hook to animate live relationship billboards above the preview character.
  const debugState = { installed: false, heartLoaded: false, lastPopup: null, activeCount: 0, errors: [], retryingAvatar: false, lastSnapshot: null }; // Used by the visible/mobile-accessible diagnostic surface.
  let heartImagePromise = null; // Used to load and reuse the real HUD heart asset once.
  let installTimer = 0; // Used to retry installation until the popup editor finishes its async Three.js boot.
  let diagnosticsTimer = 0; // Used to keep the visible diagnostics synchronized with the editor's async boot stages.

  function editorValue(name) {
    try {
      return (0, eval)(name); // Used to read the Popup Text Editor's top-level lexical bindings without requiring them to be window properties.
    } catch (_) {
      return undefined;
    }
  }

  function getPopupRuntime() { return editorValue('popupRuntime'); }
  function getThree() { return editorValue('THREE'); }
  function getCamera() { return editorValue('camera'); }
  function getAvatarModel() { return editorValue('avatarModel'); }
  function getAvatarHolder() { return editorValue('avatarHolder'); }
  function getPreviewScene() { return editorValue('previewScene'); }
  function getNpcs() { return editorValue('npcs'); }
  function getRenderAvatar() { return editorValue('renderAvatar'); }
  function getStatusFunction() { return editorValue('status'); }

  function rememberError(message) {
    const text = String(message || 'Unknown error').trim(); // Used as a compact diagnostic entry that is readable on a phone.
    if (!text) return;
    if (debugState.errors[debugState.errors.length - 1] === text) return;
    debugState.errors.push(text);
    if (debugState.errors.length > 8) debugState.errors.shift();
    updateDiagnostics();
  }

  window.addEventListener('error', event => {
    if (event.target && event.target !== window) {
      const source = event.target.src || event.target.href || event.target.currentSrc || event.target.tagName; // Used to identify failed script/image/resource requests in the on-screen log.
      rememberError(`Resource error: ${source || 'unknown resource'}`);
      return;
    }
    rememberError(`JS error: ${event.message || event.error?.message || 'unknown'}${event.filename ? ` @ ${event.filename.split('/').pop()}:${event.lineno || '?'}` : ''}`);
  }, true);
  window.addEventListener('unhandledrejection', event => rememberError(`Promise rejection: ${event.reason?.stack || event.reason?.message || event.reason || 'unknown'}`));

  function signedRelationshipAmount(amount) {
    const value = Math.round((Number(amount) || 0) * 10) / 10; // Used to mirror runtime rounding while preserving losses.
    return Object.is(value, -0) ? 0 : value;
  }

  function relationshipHeartColor(kind) {
    return kind === 'favor' ? FAVOR_HEART_COLOR : RAPPORT_HEART_COLOR;
  }

  function relationshipNumberColor(amount) {
    return amount > 0 ? RELATIONSHIP_GAIN_COLOR : RELATIONSHIP_LOSS_COLOR;
  }

  function loadHeartImage() {
    if (heartImagePromise) return heartImagePromise;
    heartImagePromise = new Promise(resolve => {
      const image = new Image(); // Used as the exact icon_heart.png source painted into the relationship popup canvas.
      image.onload = () => { debugState.heartLoaded = true; updateDebugText(); updateDiagnostics(); resolve(image); };
      image.onerror = () => { debugState.heartLoaded = false; rememberError(`Heart asset failed: ${HEART_URL}`); updateDebugText(); resolve(null); };
      image.src = HEART_URL;
    });
    return heartImagePromise;
  }

  function tintHeartCanvas(image, color) {
    const canvas = document.createElement('canvas'); // Used as an alpha-preserving recolor buffer like the runtime renderer.
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const context = canvas.getContext('2d'); // Used to tint every nontransparent heart pixel to the relationship color.
    context.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    context.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
    context.globalCompositeOperation = 'source-over';
    return canvas;
  }

  function rootScene(root) {
    let node = root; // Used to resolve the real Three.js scene owning the selected NPC preview root.
    while (node && !node.isScene) node = node.parent;
    return node || null;
  }

  function popupHeadOffset(root, center) {
    const THREE = getThree(); // Used to measure the selected avatar without assuming the editor reached Three.js initialization.
    if (!THREE?.Box3 || !root || !center) return 0.45;
    const bounds = new THREE.Box3().setFromObject(root); // Used to place the relationship popup just above the rendered character rather than at its centroid.
    if (!Number.isFinite(bounds.max?.y)) return 0.45;
    return Math.max(0.2, bounds.max.y - center.y + 0.08);
  }

  function disposePopup(event) {
    event?.plane?.parent?.remove(event.plane);
    event?.geometry?.dispose?.();
    event?.material?.dispose?.();
    event?.texture?.dispose?.();
  }

  function clearRelationshipPopups() {
    while (active.length) disposePopup(active.pop());
    debugState.activeCount = 0;
    updateDebugText();
    updateDiagnostics();
  }

  async function spawnRelationshipPopup(root, kind, amount) {
    const popupRuntime = getPopupRuntime(); // Used as the live Popup Text Editor WorldPopupText API after async boot.
    const THREE = getThree(); // Used as the exact Three.js instance owned by the editor preview scene.
    const camera = getCamera(); // Used to face the relationship billboard toward the editor preview camera.
    const value = signedRelationshipAmount(amount); // Used as the exact signed Rapport/Favor delta drawn above the preview avatar.
    if (!popupRuntime?.avatarCentroidWorld || !THREE || !camera || !root || !value) {
      rememberError('Relationship popup blocked: popup runtime, Three.js, camera, avatar root, or nonzero amount is missing.');
      return null;
    }
    if (!rootScene(root)) {
      rememberError('Relationship popup blocked: avatar holder is not attached to a Three.js scene.');
      return null;
    }
    const image = await loadHeartImage(); // Used before plane creation so the first visible frame already contains the heart art.
    const activeScene = rootScene(root); // Re-resolved after image loading in case the avatar was replaced meanwhile.
    if (!root.parent || !activeScene) return null;

    const canvas = document.createElement('canvas'); // Used as the combined heart + outlined signed-number texture.
    canvas.width = POPUP_WIDTH;
    canvas.height = POPUP_HEIGHT;
    const context = canvas.getContext('2d'); // Used to paint the same relationship visual contract as the gameplay renderer.
    const iconY = (POPUP_HEIGHT - ICON_SIZE) * 0.5; // Used to vertically center the heart beside the signed number.
    const heartColor = relationshipHeartColor(kind); // Used so Rapport is yellow while Favor is pink.
    const numberColor = relationshipNumberColor(value); // Used so gains are green while losses are red.
    if (image) context.drawImage(tintHeartCanvas(image, heartColor), 16, iconY, ICON_SIZE, ICON_SIZE);

    const label = `${value > 0 ? '+' : '-'}${Math.abs(value)}`; // Used as the exact signed delta visible in gameplay.
    context.font = "900 68px 'KhymeryyanRomanLetters+Numbers', 'DM Mono', monospace";
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 9;
    context.strokeStyle = 'rgba(15,10,8,.92)';
    context.strokeText(label, 108, POPUP_HEIGHT / 2);
    context.fillStyle = numberColor;
    context.fillText(label, 108, POPUP_HEIGHT / 2);

    const texture = new THREE.CanvasTexture(canvas); // Used by the camera-facing relationship plane in the actual Three.js preview scene.
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const aspect = POPUP_WIDTH / POPUP_HEIGHT; // Used to preserve canvas proportions on the world-space plane.
    const geometry = new THREE.PlaneGeometry(aspect, 1); // Used as the actual relationship billboard geometry.
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide }); // Used to keep the popup readable and shell-outline safe.
    const plane = new THREE.Mesh(geometry, material); // Used as the relationship billboard rendered above the selected preview character.
    const worldHeight = Math.max(0.18, Number(popupRuntime.defaults?.floatPlus?.worldHeight) || 0.36); // Used to match the runtime relationship popup's Float+ physical size.
    plane.scale.setScalar(worldHeight);
    plane.renderOrder = RELATIONSHIP_RENDER_ORDER;
    plane.frustumCulled = false;
    plane.userData.isBillboard = true;
    plane.userData.noOutline = true;
    plane.userData.hobunjiWorldTextOverlay = true;
    plane.layers?.disable?.(1);
    plane.castShadow = false;
    plane.receiveShadow = false;

    const center = popupRuntime.avatarCentroidWorld(root); // Used to calculate a stable above-head offset at spawn.
    const event = { // Used by updateRelationshipPopups() for the runtime-style rise, settle, fade, and disposal.
      kind,
      root,
      plane,
      geometry,
      material,
      texture,
      startedAt: performance.now(),
      lifetimeMs: Math.max(250, Number(popupRuntime.defaults?.floatPlus?.lifetimeMs) || DEFAULT_LIFETIME_MS),
      headOffsetY: popupHeadOffset(root, center),
      worldHeight,
      value,
      heartColor,
      numberColor,
    };
    activeScene.add(plane);
    active.push(event);
    debugState.activeCount = active.length;
    debugState.lastPopup = { kind, value, heartColor, numberColor, at: Date.now() };
    updateDebugText();
    updateDiagnostics();
    return event;
  }

  function updateRelationshipPopups(now) {
    const popupRuntime = getPopupRuntime(); // Used to query the avatar centroid only after the editor runtime exists.
    const camera = getCamera(); // Used to keep every active relationship plane camera-facing.
    if (!popupRuntime?.avatarCentroidWorld || !camera) return;
    for (let index = active.length - 1; index >= 0; index--) {
      const event = active[index]; // Used as the active relationship popup advanced by the popup editor's normal render loop.
      const progress = Math.max(0, Math.min(1, (now - event.startedAt) / event.lifetimeMs)); // Used for the same normalized lifetime timing as gameplay.
      const center = popupRuntime.avatarCentroidWorld(event.root); // Used so the popup follows the preview character if its root moves.
      if (!center || !event.root?.parent || progress >= 1) {
        disposePopup(event);
        active.splice(index, 1);
        continue;
      }
      center.y += event.headOffsetY + 0.14 * (1 - Math.pow(1 - progress, 2));
      event.plane.position.copy(center);
      event.plane.quaternion.copy(camera.quaternion);
      event.material.opacity = progress < 0.72 ? 1 : (1 - progress) / 0.28;
      const pop = 1.08 - 0.08 * Math.min(1, progress / 0.24); // Used to give the popup the gameplay Float+ settle motion.
      event.plane.scale.setScalar(event.worldHeight * pop);
    }
    debugState.activeCount = active.length;
  }

  function updateDebugText() {
    const node = document.getElementById('relationshipPopupPreviewDebug'); // Used to expose renderer state without requiring browser devtools on mobile.
    if (!node) return;
    const last = debugState.lastPopup;
    node.textContent = `3D relationship reference · heart ${debugState.heartLoaded ? 'loaded' : 'loading/fallback'} · active ${debugState.activeCount}${last ? ` · last ${last.kind} ${last.value > 0 ? '+' : ''}${last.value}` : ''}`;
  }

  function play(kind, amount) {
    const avatarModel = getAvatarModel(); // Used to ensure a visible avatar model exists before trying to demonstrate an overhead popup.
    const avatarHolder = getAvatarHolder(); // Used as the relationship popup's world-space anchor root.
    const popupRuntime = getPopupRuntime(); // Used as the WorldPopupText-shaped relationship API installed below.
    if (!avatarModel || !avatarHolder || !popupRuntime) {
      rememberError('Cannot play relationship popup: avatar model, avatar holder, or popup runtime is not ready.');
      updateDiagnostics();
      return false;
    }
    popupRuntime.clear();
    const result = popupRuntime.showRelationshipChange(avatarHolder, kind, amount); // Used to exercise the installed relationship-popup API against the real preview character root.
    if (result?.catch) result.catch(error => rememberError(`Relationship popup failed: ${error.stack || error.message}`));
    return true;
  }

  function injectControls() {
    if (document.getElementById('relationshipPopupPreviewSection')) return;
    const jsonSection = document.getElementById('json')?.closest('.section'); // Used as a stable insertion point inside the existing Popup Text Editor control column.
    if (!jsonSection) return;
    const section = document.createElement('section'); // Used as the editor-only controls for spawning relationship events above the live NPC preview.
    section.id = 'relationshipPopupPreviewSection';
    section.className = 'section';
    section.innerHTML = `
      <h2>Overhead Rapport / Favor</h2>
      <div class="help">Renders the relationship popup as a real Three.js billboard above the selected character, using the runtime heart asset, size, outline, colors, rise, settle, and fade timing.</div>
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
    updateDebugText();
  }

  function diagnosticsSnapshot() {
    const popupRuntime = getPopupRuntime(); // Used to report whether the WorldPopupText init stage completed.
    const THREE = getThree(); // Used to report whether the configured Three.js module loaded.
    const camera = getCamera(); // Used to report whether the preview camera exists.
    const avatarModel = getAvatarModel(); // Used to report whether PNGPlaneAvatar actually produced a model.
    const avatarHolder = getAvatarHolder(); // Used to report whether the model is attached to its world-space root.
    const previewScene = getPreviewScene(); // Used to report whether AvatarPreviewScene.create completed.
    const npcs = getNpcs(); // Used to report whether the NPC database loaded and normalized.
    const statusText = document.getElementById('status')?.textContent?.trim() || ''; // Used to surface the editor's existing one-line status inside the visible debug panel.
    const threeConfig = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {}; // Used to expose CDN module configuration when Three.js fails to load.
    let modelBounds = 'n/a'; // Used to reveal invisible/zero-sized models even when setAvatar technically returned an object.
    try {
      if (avatarModel && THREE?.Box3 && THREE?.Vector3) {
        const size = new THREE.Box3().setFromObject(avatarModel).getSize(new THREE.Vector3());
        modelBounds = `${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)}`;
      }
    } catch (error) {
      modelBounds = `error: ${error.message}`;
    }
    return {
      helper: debugState.installed ? 'ready' : 'waiting',
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
      popupRuntime: !!popupRuntime,
      heartLoaded: debugState.heartLoaded,
      editorStatus: statusText || '(none)',
      errors: [...debugState.errors],
    };
  }

  function diagnosticsText(snapshot = diagnosticsSnapshot()) {
    const core = snapshot.coreScripts;
    const lines = [
      `Popup Text Editor diagnostics`,
      `helper=${snapshot.helper} popupRuntime=${snapshot.popupRuntime ? 'yes' : 'NO'} heart=${snapshot.heartLoaded ? 'yes' : 'no'}`,
      `core config=${core.scratchbonesConfig ? 'yes' : 'NO'} npcPreview=${core.npcAvatarPreview ? 'yes' : 'NO'} pngPlane=${core.pngPlaneAvatar ? 'yes' : 'NO'} sceneApi=${core.avatarPreviewScene ? 'yes' : 'NO'} worldPopup=${core.worldPopupText ? 'yes' : 'NO'}`,
      `three configured=${snapshot.three.configured ? 'yes' : 'NO'} loaded=${snapshot.three.loaded ? 'yes' : 'NO'} renderer=${snapshot.three.renderer ? 'yes' : 'NO'} camera=${snapshot.three.camera ? 'yes' : 'NO'}`,
      `npc count=${snapshot.npc.count} selected=${snapshot.npc.selected}`,
      `avatar holder=${snapshot.avatar.holder ? 'yes' : 'NO'} children=${snapshot.avatar.holderChildren} model=${snapshot.avatar.model ? 'yes' : 'NO'} bounds=${snapshot.avatar.modelBounds}`,
      `status: ${snapshot.editorStatus}`,
      `Three URL: ${snapshot.three.moduleUrl}`,
    ];
    if (snapshot.errors.length) lines.push('errors:', ...snapshot.errors.map(error => `• ${error}`));
    else lines.push('errors: none captured');
    return lines.join('\n');
  }

  function injectDiagnostics() {
    if (document.getElementById('worldPopupEditorDiagnostics')) return;
    const preview = document.getElementById('preview'); // Used as the always-visible anchor so diagnostics remain reachable even when the controls column has scrolled away.
    if (!preview) return;
    const panel = document.createElement('div'); // Used as the mobile-visible debug console for avatar and popup boot failures.
    panel.id = 'worldPopupEditorDiagnostics';
    panel.style.cssText = 'position:absolute;z-index:8;left:8px;right:8px;bottom:38px;max-height:42%;overflow:auto;background:rgba(3,8,14,.94);border:1px solid rgba(255,255,255,.22);border-radius:9px;padding:7px 8px;color:#dbeafe;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 4px 18px rgba(0,0,0,.45)';
    panel.innerHTML = `<div style="display:flex;align-items:center;gap:6px;position:sticky;top:0;background:rgba(3,8,14,.97);padding-bottom:5px"><b style="font:700 11px system-ui,sans-serif">Preview debug</b><span style="flex:1"></span><button type="button" data-debug-retry style="padding:4px 7px;font-size:10px">Retry avatar</button><button type="button" data-debug-copy style="padding:4px 7px;font-size:10px">Copy</button><button type="button" data-debug-toggle style="padding:4px 7px;font-size:10px">Hide</button></div><pre data-debug-output style="margin:0;white-space:pre-wrap;word-break:break-word"></pre>`;
    preview.appendChild(panel);
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
      panel.style.maxHeight = hidden ? '42%' : '34px';
    });
    updateDiagnostics();
  }

  function updateDiagnostics() {
    const panel = document.getElementById('worldPopupEditorDiagnostics'); // Used to refresh the right-side console as async boot state changes.
    const output = panel?.querySelector('[data-debug-output]');
    const snapshot = diagnosticsSnapshot();
    debugState.lastSnapshot = snapshot;
    if (output) output.textContent = diagnosticsText(snapshot);
  }

  async function retryAvatar() {
    if (debugState.retryingAvatar) return false;
    const renderAvatar = getRenderAvatar(); // Used to retry the editor's own character pipeline instead of inventing a second renderer.
    const npcs = getNpcs(); // Used to select the current repository NPC for the retry.
    const previewScene = getPreviewScene(); // Used to distinguish "Three.js never booted" from "portrait render failed".
    const popupRuntime = getPopupRuntime(); // Used to ensure the avatar retry runs only after popup/editor scene initialization.
    if (!previewScene || !popupRuntime) {
      rememberError('Retry avatar blocked: the Three.js preview scene or popup runtime never initialized. Check the Three URL/core-script lines above.');
      return false;
    }
    if (typeof renderAvatar !== 'function' || !Array.isArray(npcs) || !npcs.length) {
      rememberError('Retry avatar blocked: renderAvatar() or the NPC database is unavailable.');
      return false;
    }
    debugState.retryingAvatar = true;
    updateDiagnostics();
    try {
      if (window.NpcAvatarPreview?.ensurePortraitCosmetics) {
        await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: '../../assets/', configBase: '../../config/' });
      }
      const index = Math.max(0, Number(document.getElementById('npcSelect')?.value) || 0); // Used to preserve the avatar currently selected in the editor toolbar.
      await renderAvatar(npcs[index] || npcs[0]);
      const avatarModel = getAvatarModel();
      if (!avatarModel) throw new Error('renderAvatar() completed without assigning avatarModel.');
      getStatusFunction()?.(`Avatar retry succeeded for ${npcs[index]?.name || npcs[index]?.id || 'selected NPC'}.`);
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

  function installRuntimeHooks() {
    const popupRuntime = getPopupRuntime(); // Used as the live editor WorldPopupText API once initThreePreview has completed.
    const THREE = getThree(); // Used to prove the Three.js scene is ready before adding relationship billboard behavior.
    const camera = getCamera(); // Used to prove a preview camera exists before enabling billboard updates.
    if (!popupRuntime || !THREE || !camera) return false;
    if (popupRuntime.__worldPopupRelationshipEditorVersion >= 2) return true;
    const originalUpdate = popupRuntime.update.bind(popupRuntime); // Used to preserve every existing popup/editor update before advancing relationship events.
    const originalClear = popupRuntime.clear.bind(popupRuntime); // Used to preserve normal popup cleanup while also clearing relationship preview planes.
    popupRuntime.update = function relationshipEditorUpdate(now, ...args) {
      const result = originalUpdate(now, ...args);
      updateRelationshipPopups(now);
      return result;
    };
    popupRuntime.clear = function relationshipEditorClear(...args) {
      clearRelationshipPopups();
      return originalClear(...args);
    };
    popupRuntime.showRelationshipChange = (root, kind, amount) => spawnRelationshipPopup(root, kind === 'favor' ? 'favor' : 'rapport', amount);
    popupRuntime.showRapportGain = (root, amount) => spawnRelationshipPopup(root, 'rapport', amount);
    popupRuntime.showRapportChange = popupRuntime.showRapportGain;
    popupRuntime.showFavorChange = (root, amount) => spawnRelationshipPopup(root, 'favor', amount);
    popupRuntime.__worldPopupRelationshipEditorVersion = 2;
    debugState.installed = true;
    updateDiagnostics();
    return true;
  }

  function installWhenReady() {
    injectControls();
    injectDiagnostics();
    if (installRuntimeHooks()) {
      clearInterval(installTimer);
      installTimer = 0;
      loadHeartImage();
      updateDebugText();
      updateDiagnostics();
      if (!diagnosticsTimer) diagnosticsTimer = window.setInterval(updateDiagnostics, 500);
      return;
    }
    updateDiagnostics();
    if (!installTimer) installTimer = window.setInterval(installWhenReady, 100);
    if (!diagnosticsTimer) diagnosticsTimer = window.setInterval(updateDiagnostics, 500);
  }

  window.WorldPopupRelationshipEditor = Object.freeze({
    version: 2,
    install: installWhenReady,
    play,
    retryAvatar,
    snapshot() {
      return {
        version: 2,
        installed: debugState.installed,
        heartLoaded: debugState.heartLoaded,
        activeCount: active.length,
        lastPopup: debugState.lastPopup,
        diagnostics: diagnosticsSnapshot(),
      };
    },
  });
  window.__worldPopupRelationshipEditorDebug = () => window.WorldPopupRelationshipEditor.snapshot();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
  else installWhenReady();
})();