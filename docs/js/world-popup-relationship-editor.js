(() => {
  'use strict';

  if (window.WorldPopupRelationshipEditor?.version >= 1) return;
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
  const debugState = { installed: false, heartLoaded: false, lastPopup: null, activeCount: 0 }; // Used by the visible/mobile-accessible diagnostic surface.
  let heartImagePromise = null; // Used to load and reuse the real HUD heart asset once.
  let installTimer = 0; // Used to retry installation until the popup editor finishes its async Three.js boot.

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
      image.onload = () => { debugState.heartLoaded = true; updateDebugText(); resolve(image); };
      image.onerror = () => { debugState.heartLoaded = false; updateDebugText(); resolve(null); };
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
  }

  async function spawnRelationshipPopup(root, kind, amount) {
    const value = signedRelationshipAmount(amount); // Used as the exact signed Rapport/Favor delta drawn above the preview avatar.
    if (!popupRuntime?.avatarCentroidWorld || !THREE || !root || !value) return null;
    if (!rootScene(root)) return null;
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
    return event;
  }

  function updateRelationshipPopups(now) {
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
    if (!avatarModel || !avatarHolder || !popupRuntime) return false;
    popupRuntime.clear();
    const result = popupRuntime.showRelationshipChange(avatarHolder, kind, amount); // Used to exercise the installed relationship-popup API against the real preview character root.
    if (result?.catch) result.catch(error => status?.(`Relationship popup failed: ${error.message}`, 'bad'));
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

  function installRuntimeHooks() {
    if (!popupRuntime || !THREE || !camera) return false;
    if (popupRuntime.__worldPopupRelationshipEditorVersion >= 1) return true;
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
    popupRuntime.__worldPopupRelationshipEditorVersion = 1;
    debugState.installed = true;
    return true;
  }

  function installWhenReady() {
    injectControls();
    if (installRuntimeHooks()) {
      clearInterval(installTimer);
      installTimer = 0;
      loadHeartImage();
      updateDebugText();
      return;
    }
    if (!installTimer) installTimer = window.setInterval(installWhenReady, 100);
  }

  window.WorldPopupRelationshipEditor = Object.freeze({
    version: 1,
    install: installWhenReady,
    play,
    snapshot() {
      return {
        version: 1,
        installed: debugState.installed,
        heartLoaded: debugState.heartLoaded,
        activeCount: active.length,
        lastPopup: debugState.lastPopup,
      };
    },
  });
  window.__worldPopupRelationshipEditorDebug = () => window.WorldPopupRelationshipEditor.snapshot();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
  else installWhenReady();
})();
