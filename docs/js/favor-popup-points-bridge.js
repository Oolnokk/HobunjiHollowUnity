(() => {
  'use strict';

  if (Number(window.FavorPopupPointsBridge?.version) >= 4) return;

  const MODULE_SRC = document.currentScript?.src || ''; // Used to resolve the shared HUD heart asset from this runtime module in both game and editor paths.
  const HEART_URL = MODULE_SRC ? new URL('../assets/hud/generic_icons/icon_heart.png', MODULE_SRC).href : 'assets/hud/generic_icons/icon_heart.png'; // Used as the one relationship popup heart image source.
  const RAPPORT_HEART_COLOR = '#ffd84d'; // Used for temporary Rapport changes.
  const FAVOR_HEART_COLOR = '#ff8fbd'; // Used for permanent Favor changes.
  const RELATIONSHIP_GAIN_COLOR = '#66d96f'; // Used by positive relationship deltas.
  const RELATIONSHIP_LOSS_COLOR = '#ff5b5b'; // Used by negative relationship deltas.
  const RELATIONSHIP_RENDER_ORDER = 1200; // Used to keep relationship text in the same overlay band as WorldPopupText.
  const RELATIONSHIP_ALPHA_TEST = 0.001; // Matches the working PNG-plane material path and force-discards fully transparent texels before blending.
  const POPUP_WIDTH = 360; // Used by the relationship texture canvas.
  const POPUP_HEIGHT = 112; // Used by the relationship texture canvas.
  const ICON_SIZE = 76; // Used by the relationship heart inside the canvas.
  const DEFAULT_WORLD_HEIGHT = 0.36; // Used when Float+ size metadata is unavailable.
  const DEFAULT_LIFETIME_MS = 1150; // Used when Float+ timing metadata is unavailable.
  const relationshipPopups = []; // Used as the v4-owned active relationship popup list.
  const debugState = { hardenedPopups: 0, lastHardenedPopup: null, lastAnchor: null, lastDisposedReason: null, depsCaptured: false }; // Used by mobile/editor diagnostics.
  let deps = null; // Used as the current WorldPopupText Three.js/camera dependency bag.
  let heartImagePromise = null; // Used to load and reuse icon_heart.png once.

  function convertFavorHeartDelta(kind, amount) {
    if (kind !== 'favor') return amount;
    const points = window.NpcFavorBalance?.heartsToFavorPoints?.(amount); // Used to preserve the bridge's Favor point display contract.
    return Number.isFinite(Number(points)) ? Number(points) : amount;
  }

  function signedRelationshipAmount(amount) {
    const value = Math.round((Number(amount) || 0) * 10) / 10; // Used to retain the sign while keeping popup values compact.
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
      const image = new Image(); // Used to paint the exact repository heart PNG into relationship popup textures.
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = HEART_URL;
    });
    return heartImagePromise;
  }

  function tintHeartCanvas(image, color) {
    const canvas = document.createElement('canvas'); // Used as an alpha-preserving recolor buffer for the heart icon.
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const context = canvas.getContext('2d'); // Used to recolor every opaque heart pixel while retaining transparency.
    context.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    context.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
    context.globalCompositeOperation = 'source-over';
    return canvas;
  }

  function rootScene(root) {
    let node = root; // Used to find the live Three.js scene that currently owns this NPC/avatar root.
    while (node && !node.isScene) node = node.parent;
    return node || null;
  }

  function avatarRootWithPortraitMetadata(root) {
    let avatarRoot = null; // Used as the transform that owns portrait height/placement metadata.
    root?.traverse?.(child => {
      if (!avatarRoot && Number.isFinite(Number(child.userData?.portraitModelHeight))) avatarRoot = child;
    });
    return avatarRoot;
  }

  function relationshipHeadAnchorWorld(root) {
    const THREE = deps?.THREE || window.THREE; // Used to build the local head point before transforming it into world space.
    if (!THREE || !root) return null;
    const avatarRoot = avatarRootWithPortraitMetadata(root); // Used to avoid a one-time Box3 world-Y estimate that can drift as the character root transforms.
    if (avatarRoot?.localToWorld) {
      const height = Number(avatarRoot.userData.portraitModelHeight); // Used as the exact authored PNG-plane world height.
      const placementRatioRaw = Number(avatarRoot.userData.portraitVerticalPlacementRatio ?? 0.5); // Used to reproduce WorldPopupText's portrait vertical placement math.
      const placementRatio = Number.isFinite(placementRatioRaw) ? placementRatioRaw : 0.5;
      const localTopY = (placementRatio - 0.5) * height + height * 0.5; // Used as the avatar-local top edge: the same center offset plus half-height used by the core popup system.
      const localGap = Math.max(0.04, height * 0.07); // Used as a scale-aware gap above the visible portrait instead of a cached world-space offset.
      const point = new THREE.Vector3(0, localTopY + localGap, 0); // Used as the stable above-head point that follows every parent transform.
      avatarRoot.updateWorldMatrix?.(true, false);
      avatarRoot.localToWorld(point);
      debugState.lastAnchor = {
        source: 'portrait-local-top',
        height,
        placementRatio,
        localTopY,
        localGap,
        world: { x: point.x, y: point.y, z: point.z },
        at: Date.now(),
      };
      return point;
    }
    const fallback = window.WorldPopupText?.avatarCentroidWorld?.(root); // Used only for roots that do not expose normal portrait metadata.
    if (!fallback) return null;
    fallback.y += 0.45;
    debugState.lastAnchor = {
      source: 'centroid-fallback',
      world: { x: fallback.x, y: fallback.y, z: fallback.z },
      at: Date.now(),
    };
    return fallback;
  }

  function hardenRelationshipPopupEvent(event) {
    const plane = event?.plane; // Used to keep relationship canvases out of the inverted-shell outline pass.
    if (!plane) return event;
    plane.userData ||= {};
    plane.userData.noOutline = true;
    plane.userData.hobunjiWorldTextOverlay = true;
    plane.layers?.disable?.(1);
    plane.castShadow = false;
    plane.receiveShadow = false;
    const material = event.material || plane.material; // Used to preserve transparent world-text rendering through other runtime passes.
    if (material) {
      material.transparent = true;
      material.alphaTest = RELATIONSHIP_ALPHA_TEST;
      material.depthTest = false;
      material.depthWrite = false;
      material.fog = false;
      material.needsUpdate = true;
    }
    const texture = event.texture || material?.map; // Used to force the just-painted canvas upload before the final overlay pass.
    if (texture) texture.needsUpdate = true;
    debugState.hardenedPopups += 1;
    debugState.lastHardenedPopup = {
      kind: event.kind,
      value: event.value,
      renderOrder: Number(plane.renderOrder) || 0,
      layerMask: Number(plane.layers?.mask) || 0,
      alphaTest: Number(material?.alphaTest) || 0,
      at: Date.now(),
    };
    return event;
  }

  function disposeRelationshipPopup(event, reason = 'expired') {
    event?.plane?.parent?.remove(event.plane);
    event?.geometry?.dispose?.();
    event?.material?.dispose?.();
    event?.texture?.dispose?.();
    debugState.lastDisposedReason = reason;
  }

  function clearRelationshipPopups() {
    while (relationshipPopups.length) disposeRelationshipPopup(relationshipPopups.pop(), 'clear');
  }

  async function spawnRelationshipPopup(root, kind, amount, options = {}) {
    const api = window.WorldPopupText; // Used as the shared popup owner for settings and avatar fallback anchoring.
    const THREE = deps?.THREE || window.THREE; // Used to build the relationship billboard in the same Three.js instance as the game/editor scene.
    const rawAmount = kind === 'favor' && !options.amountIsPoints ? convertFavorHeartDelta(kind, amount) : amount; // Used to preserve game Favor-point conversion while letting the editor preview literal point values.
    const value = signedRelationshipAmount(rawAmount); // Used as the signed number drawn in the popup.
    if (!api || !THREE || !root || !value) return null;
    const scene = rootScene(root); // Used to reject detached NPC roots instead of drawing at the origin.
    if (!scene) return null;
    const image = await loadHeartImage();
    if (!root.parent || rootScene(root) !== scene) return null;

    const canvas = document.createElement('canvas'); // Used as the combined heart + outlined signed-number texture.
    canvas.width = POPUP_WIDTH;
    canvas.height = POPUP_HEIGHT;
    const context = canvas.getContext('2d'); // Used to paint relationship iconography and number text.
    const iconY = (POPUP_HEIGHT - ICON_SIZE) * 0.5; // Used to vertically center the heart beside the number.
    const heartColor = relationshipHeartColor(kind); // Used so Rapport is yellow while Favor is pink.
    const numberColor = relationshipNumberColor(value); // Used so gains are green while losses are red.
    if (image) context.drawImage(tintHeartCanvas(image, heartColor), 16, iconY, ICON_SIZE, ICON_SIZE);
    const label = `${value > 0 ? '+' : '-'}${Math.abs(value)}`; // Used as the compact signed relationship delta.
    context.font = "900 68px 'KhymeryyanRomanLetters+Numbers', 'DM Mono', monospace";
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 9;
    context.strokeStyle = 'rgba(15,10,8,.92)';
    context.strokeText(label, 108, POPUP_HEIGHT / 2);
    context.fillStyle = numberColor;
    context.fillText(label, 108, POPUP_HEIGHT / 2);

    const texture = new THREE.CanvasTexture(canvas); // Used by the actual world-space relationship plane.
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const aspect = POPUP_WIDTH / POPUP_HEIGHT; // Used to preserve the texture's authored proportions.
    const geometry = new THREE.PlaneGeometry(aspect, 1); // Used as the camera-facing relationship billboard geometry.
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: RELATIONSHIP_ALPHA_TEST, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide }); // Uses the same cutout threshold as working PNG planes so alpha-zero canvas texels cannot become a black quad.
    const plane = new THREE.Mesh(geometry, material); // Used as the live world-space relationship visual.
    const worldHeight = Math.max(0.18, Number(api.defaults?.floatPlus?.worldHeight) || DEFAULT_WORLD_HEIGHT); // Used to reuse the Float+ physical scale.
    plane.scale.setScalar(worldHeight);
    plane.renderOrder = RELATIONSHIP_RENDER_ORDER;
    plane.frustumCulled = false;
    plane.userData.isBillboard = true;
    const anchor = relationshipHeadAnchorWorld(root); // Used to position the popup correctly before its first rendered frame.
    if (!anchor) {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      return null;
    }
    plane.position.copy(anchor);
    const camera = deps?.camera; // Used to make the first visible frame face the active camera instead of flashing from a default quaternion.
    if (camera) plane.quaternion.copy(camera.quaternion);
    const event = {
      kind,
      root,
      plane,
      geometry,
      material,
      texture,
      startedAt: performance.now(),
      lifetimeMs: Math.max(250, Number(api.defaults?.floatPlus?.lifetimeMs) || DEFAULT_LIFETIME_MS),
      worldHeight,
      value,
      heartColor,
      numberColor,
    }; // Used by updateRelationshipPopups() to animate, fade, and dispose this relationship change.
    scene.add(plane);
    relationshipPopups.push(event);
    return hardenRelationshipPopupEvent(event);
  }

  function updateRelationshipPopups(now) {
    const camera = deps?.camera; // Used to billboard every relationship plane toward the same camera as core WorldPopupText.
    if (!camera) return;
    for (let index = relationshipPopups.length - 1; index >= 0; index--) {
      const event = relationshipPopups[index]; // Used as the active relationship popup advanced this frame.
      const progress = Math.max(0, Math.min(1, (now - event.startedAt) / event.lifetimeMs)); // Used for Float+-style lifetime timing.
      const anchor = relationshipHeadAnchorWorld(event.root); // Recomputed in avatar-local space every frame so movement/rotation/scaling cannot desynchronize the head position.
      if (!anchor || !event.root?.parent || progress >= 1) {
        disposeRelationshipPopup(event, !anchor ? 'missing-anchor' : !event.root?.parent ? 'detached-root' : 'expired');
        relationshipPopups.splice(index, 1);
        continue;
      }
      anchor.y += 0.075 * (1 - Math.pow(1 - progress, 2)); // Used to match core Float+ rise distance instead of the older oversized relationship-only 0.14 rise.
      event.plane.position.copy(anchor);
      event.plane.quaternion.copy(camera.quaternion);
      event.material.opacity = progress < 0.72 ? 1 : (1 - progress) / 0.28;
      const pop = 1.08 - 0.08 * Math.min(1, progress / 0.24); // Used to retain the quick relationship settle while position follows the stable head anchor.
      event.plane.scale.setScalar(event.worldHeight * pop);
    }
  }

  function bindDeps(nextDeps) {
    if (!nextDeps) return false;
    deps = nextDeps; // Used by editor hot-loads and the wrapped game init path to share the authoritative Three.js/camera objects.
    debugState.depsCaptured = !!(deps?.THREE && deps?.camera);
    return debugState.depsCaptured;
  }

  function install() {
    const api = window.WorldPopupText;
    if (!api) return false;
    if (Number(api.__favorPopupPointsBridgeVersion) >= 4) return true;

    const originalInit = typeof api.init === 'function' ? api.init.bind(api) : null; // Used to preserve the complete existing WorldPopupText initialization chain while capturing its dependency bag.
    const originalUpdate = typeof api.update === 'function' ? api.update.bind(api) : null; // Used to preserve core/generic popup updates before relationship popup updates.
    const originalClear = typeof api.clear === 'function' ? api.clear.bind(api) : null; // Used to preserve every preexisting popup cleanup path.
    const originalDebugSnapshot = typeof api.debugSnapshot === 'function' ? api.debugSnapshot.bind(api) : null; // Used to append v4 anchor diagnostics without replacing existing debug fields.

    if (originalInit) {
      api.init = function favorPopupV4Init(injectedDeps, ...args) {
        bindDeps(injectedDeps);
        return originalInit(injectedDeps, ...args);
      };
    }
    if (originalUpdate) {
      api.update = function favorPopupV4Update(now, ...args) {
        const result = originalUpdate(now, ...args);
        updateRelationshipPopups(now);
        return result;
      };
    }
    if (originalClear) {
      api.clear = function favorPopupV4Clear(...args) {
        clearRelationshipPopups();
        return originalClear(...args);
      };
    }

    api.showRelationshipChange = (root, kind, amount, options) => spawnRelationshipPopup(root, kind === 'favor' ? 'favor' : 'rapport', amount, options);
    api.showRapportGain = (root, amount, options) => spawnRelationshipPopup(root, 'rapport', amount, options);
    api.showRapportChange = api.showRapportGain;
    api.showFavorChange = (root, amount, options) => spawnRelationshipPopup(root, 'favor', amount, options);
    api.relationshipHeadAnchorWorld = root => relationshipHeadAnchorWorld(root);
    api.debugSnapshot = function favorPopupV4DebugSnapshot() {
      const base = originalDebugSnapshot ? originalDebugSnapshot() : {};
      return {
        ...base,
        relationshipPositionBridge: {
          version: 4,
          active: relationshipPopups.length,
          depsCaptured: debugState.depsCaptured,
          alphaTest: RELATIONSHIP_ALPHA_TEST,
          lastAnchor: debugState.lastAnchor,
          lastDisposedReason: debugState.lastDisposedReason,
        },
      };
    };
    api.__favorPopupPointsBridge = true;
    api.__favorPopupPointsBridgeVersion = 4;
    return true;
  }

  if (!install() && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      if (!install()) return;
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.FavorPopupPointsBridge = Object.freeze({
    version: 4,
    install,
    bindDeps,
    relationshipHeadAnchorWorld,
    snapshot() {
      return {
        version: 4,
        activeRelationshipPopups: relationshipPopups.length,
        hardenedPopups: debugState.hardenedPopups,
        lastHardenedPopup: debugState.lastHardenedPopup,
        lastAnchor: debugState.lastAnchor,
        lastDisposedReason: debugState.lastDisposedReason,
        depsCaptured: debugState.depsCaptured,
        alphaTest: RELATIONSHIP_ALPHA_TEST,
        popupBridgeVersion: Number(window.WorldPopupText?.__favorPopupPointsBridgeVersion) || 0,
      };
    },
  });
})();
