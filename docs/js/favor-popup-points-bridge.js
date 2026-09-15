(() => {
  'use strict';

  if (Number(window.FavorPopupPointsBridge?.version) >= 6) return;

  const MODULE_SRC = document.currentScript?.src || '';
  const HEART_URL = MODULE_SRC ? new URL('../assets/hud/generic_icons/icon_heart.png', MODULE_SRC).href : 'assets/hud/generic_icons/icon_heart.png';
  const POPUP_FONT_FAMILY = "'KhymeryyanRomanLetters+Numbers', 'DM Mono', monospace";
  const RAPPORT_HEART_COLOR = '#ffd84d';
  const FAVOR_HEART_COLOR = '#ff8fbd';
  const RELATIONSHIP_GAIN_COLOR = '#66d96f';
  const RELATIONSHIP_LOSS_COLOR = '#ff5b5b';
  const HEART_RENDER_ORDER = 1211;
  const VALUE_RENDER_ORDER = 1210;
  const RELATIONSHIP_ALPHA_TEST = 0.001;
  const DEFAULT_WORLD_HEIGHT = 0.36;
  const DEFAULT_LIFETIME_MS = 1150;
  const HEART_WORLD_RATIO = 0.90;
  const VALUE_WORLD_RATIO = 0.78;
  const CHATHEAD_GAP_RATIO = 0.14;
  const POP_RIGHT_RATIO = 1.15;
  const POP_UP_RATIO = 0.95;
  const START_GROUP_SCALE = 0.58;
  const END_GROUP_SCALE = 1.32;
  const relationshipPopups = [];
  const debugState = { hardenedPopups: 0, lastHardenedPopup: null, lastAnchor: null, lastDisposedReason: null, lastLayout: null, lastHeart: null, depsCaptured: false };
  let deps = null;
  let heartImagePromise = null;

  function convertFavorHeartDelta(kind, amount) {
    if (kind !== 'favor') return amount;
    const points = window.NpcFavorBalance?.heartsToFavorPoints?.(amount);
    return Number.isFinite(Number(points)) ? Number(points) : amount;
  }

  function signedRelationshipAmount(amount) {
    const value = Math.round((Number(amount) || 0) * 10) / 10;
    return Object.is(value, -0) ? 0 : value;
  }

  function relationshipHeartColor(kind) { return kind === 'favor' ? FAVOR_HEART_COLOR : RAPPORT_HEART_COLOR; }
  function relationshipNumberColor(amount) { return amount > 0 ? RELATIONSHIP_GAIN_COLOR : RELATIONSHIP_LOSS_COLOR; }
  function spritePngSurface() { return window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit || null; }

  function loadHeartImage() {
    if (heartImagePromise) return heartImagePromise;
    heartImagePromise = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous'; // Must be set before src so raw.githack/CDN responses cannot taint the tint canvas or block WebGL texture upload.
      image.onload = () => {
        debugState.lastHeart = { ...(debugState.lastHeart || {}), imageLoaded: true, imageWidth: Number(image.naturalWidth || image.width) || 0, imageHeight: Number(image.naturalHeight || image.height) || 0, crossOrigin: image.crossOrigin || '', url: HEART_URL, at: Date.now() };
        resolve(image);
      };
      image.onerror = () => {
        debugState.lastHeart = { ...(debugState.lastHeart || {}), imageLoaded: false, imageWidth: 0, imageHeight: 0, crossOrigin: image.crossOrigin || '', url: HEART_URL, at: Date.now() };
        resolve(null);
      };
      image.src = HEART_URL;
    });
    return heartImagePromise;
  }

  function rootScene(root) {
    let node = root;
    while (node && !node.isScene) node = node.parent;
    return node || null;
  }

  function avatarRootWithPortraitMetadata(root) {
    let avatarRoot = null;
    root?.traverse?.(child => {
      if (!avatarRoot && Number.isFinite(Number(child.userData?.portraitModelHeight))) avatarRoot = child;
    });
    return avatarRoot;
  }

  function relationshipOriginWorld(root) {
    const THREE = deps?.THREE || window.THREE;
    if (!THREE || !root) return null;
    const avatarRoot = avatarRootWithPortraitMetadata(root);
    if (avatarRoot?.localToWorld) {
      const height = Number(avatarRoot.userData.portraitModelHeight);
      const placementRatioRaw = Number(avatarRoot.userData.portraitVerticalPlacementRatio ?? 0.5);
      const placementRatio = Number.isFinite(placementRatioRaw) ? placementRatioRaw : 0.5;
      const localCenterY = (placementRatio - 0.5) * height;
      const localOriginY = localCenterY + height * 0.18;
      const point = new THREE.Vector3(0, localOriginY, 0);
      avatarRoot.updateWorldMatrix?.(true, false);
      avatarRoot.localToWorld(point);
      debugState.lastAnchor = { source: 'portrait-local-upper-body', height, placementRatio, localOriginY, world: { x: point.x, y: point.y, z: point.z }, at: Date.now() };
      return point;
    }
    const fallback = window.WorldPopupText?.avatarCentroidWorld?.(root);
    if (!fallback) return null;
    debugState.lastAnchor = { source: 'centroid-fallback', world: { x: fallback.x, y: fallback.y, z: fallback.z }, at: Date.now() };
    return fallback;
  }

  function canvasTexture(canvas, debugName = '') {
    const THREE = deps?.THREE || window.THREE;
    const texture = new THREE.CanvasTexture(canvas);
    if (debugName) texture.name = debugName;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if ('encoding' in texture && THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  function finishPlanePart(canvas, texture, material, aspect, renderOrder) {
    const THREE = deps?.THREE || window.THREE;
    const geometry = new THREE.PlaneGeometry(aspect, 1);
    const plane = new THREE.Mesh(geometry, material);
    plane.renderOrder = renderOrder;
    plane.frustumCulled = false;
    plane.userData.isBillboard = true;
    plane.userData.noOutline = true;
    plane.userData.hobunjiWorldTextOverlay = true;
    plane.layers?.disable?.(1);
    plane.castShadow = false;
    plane.receiveShadow = false;
    return { canvas, texture, geometry, material, plane };
  }

  function makeTransparentPart(canvas, aspect, renderOrder) {
    const THREE = deps?.THREE || window.THREE;
    const texture = canvasTexture(canvas, 'relationship_value_texture');
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: RELATIONSHIP_ALPHA_TEST, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    return finishPlanePart(canvas, texture, material, aspect, renderOrder);
  }

  function makeHeartPart(image, color) {
    const THREE = deps?.THREE || window.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    let usedFallbackGlyph = false;
    if (image) {
      const sourceW = Math.max(1, Number(image.naturalWidth || image.width) || 1);
      const sourceH = Math.max(1, Number(image.naturalHeight || image.height) || 1);
      const drawW = 164;
      const drawH = drawW * sourceH / sourceW;
      const x = (canvas.width - drawW) * 0.5;
      const y = (canvas.height - drawH) * 0.5;
      context.drawImage(image, x, y, drawW, drawH);
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'source-over';
    } else {
      usedFallbackGlyph = true;
      context.font = '700 150px serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = color;
      context.fillText('♥', canvas.width / 2, canvas.height / 2 + 4);
    }

    let nonTransparentPixels = -1;
    let maxAlpha = -1;
    let canvasReadError = '';
    try {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      nonTransparentPixels = 0;
      maxAlpha = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        const alpha = pixels[i];
        if (alpha > 0) nonTransparentPixels += 1;
        if (alpha > maxAlpha) maxAlpha = alpha;
      }
    } catch (error) {
      canvasReadError = `${error?.name || 'Error'}: ${error?.message || error}`;
    }

    const pngSurface = spritePngSurface();
    const texture = pngSurface?.makeCanvasTexture
      ? pngSurface.makeCanvasTexture(THREE, canvas, 'relationship_heart_texture')
      : canvasTexture(canvas, 'relationship_heart_texture_fallback');
    const alphaTest = typeof pngSurface?.alphaTest === 'function' ? Number(pngSurface.alphaTest()) || RELATIONSHIP_ALPHA_TEST : RELATIONSHIP_ALPHA_TEST;
    const materialOverrides = { transparent: true, alphaTest, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide };
    const material = pngSurface?.makeMaterial
      ? pngSurface.makeMaterial(THREE, texture, 'relationship_heart_material', materialOverrides)
      : new THREE.MeshBasicMaterial({ map: texture, ...materialOverrides });

    debugState.lastHeart = {
      ...(debugState.lastHeart || {}), imageLoaded: !!image,
      imageWidth: Number(image?.naturalWidth || image?.width) || 0,
      imageHeight: Number(image?.naturalHeight || image?.height) || 0,
      crossOrigin: image?.crossOrigin || '',
      usedFallbackGlyph, nonTransparentPixels, maxAlpha, canvasReadError,
      canonicalPngSurface: !!pngSurface,
      canonicalTextureFactory: !!pngSurface?.makeCanvasTexture,
      canonicalMaterialFactory: !!pngSurface?.makeMaterial,
      alphaTest, url: HEART_URL, at: Date.now(),
    };
    return finishPlanePart(canvas, texture, material, 1, HEART_RENDER_ORDER);
  }

  function makeValuePart(label, color) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const fontPx = 68;
    context.font = `900 ${fontPx}px ${POPUP_FONT_FAMILY}`;
    canvas.width = Math.max(96, Math.ceil(context.measureText(label).width + 30));
    canvas.height = 92;
    context.font = `900 ${fontPx}px ${POPUP_FONT_FAMILY}`;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 9;
    context.strokeStyle = 'rgba(15,10,8,.92)';
    context.strokeText(label, 15, canvas.height / 2);
    context.fillStyle = color;
    context.fillText(label, 15, canvas.height / 2);
    return makeTransparentPart(canvas, canvas.width / canvas.height, VALUE_RENDER_ORDER);
  }

  function layoutLikeChathead(group, heartPart, valuePart, worldHeight) {
    const heartWorldSize = worldHeight * HEART_WORLD_RATIO;
    const valueWorldHeight = worldHeight * VALUE_WORLD_RATIO;
    heartPart.plane.scale.setScalar(heartWorldSize);
    valuePart.plane.scale.setScalar(valueWorldHeight);
    const valueWidth = (valuePart.canvas.width / valuePart.canvas.height) * valueWorldHeight;
    const gap = heartWorldSize * CHATHEAD_GAP_RATIO;
    const totalWidth = heartWorldSize + gap + valueWidth;
    heartPart.plane.position.x = -totalWidth / 2 + heartWorldSize / 2;
    valuePart.plane.position.x = -totalWidth / 2 + heartWorldSize + gap + valueWidth / 2;
    group.add(heartPart.plane, valuePart.plane);
    debugState.lastLayout = { type: 'chathead-style-heart-plus-value', heartWorldSize, valueWorldHeight, valueWidth, gap, totalWidth, at: Date.now() };
  }

  function hardenRelationshipPopupEvent(event) {
    const parts = [event?.heartPart, event?.valuePart].filter(Boolean);
    for (const part of parts) {
      const { plane, material, texture } = part;
      plane.userData ||= {};
      plane.userData.noOutline = true;
      plane.userData.hobunjiWorldTextOverlay = true;
      plane.layers?.disable?.(1);
      plane.castShadow = false;
      plane.receiveShadow = false;
      material.transparent = true;
      material.alphaTest = Number(material.alphaTest) || RELATIONSHIP_ALPHA_TEST;
      material.depthTest = false;
      material.depthWrite = false;
      material.fog = false;
      material.needsUpdate = true;
      texture.needsUpdate = true;
    }
    debugState.hardenedPopups += 1;
    debugState.lastHardenedPopup = { kind: event.kind, value: event.value, layout: 'chathead-style-heart-plus-value', childPlanes: parts.length, heartUsesCanonicalPngSurface: !!debugState.lastHeart?.canonicalMaterialFactory, alphaTest: Number(event?.heartPart?.material?.alphaTest) || RELATIONSHIP_ALPHA_TEST, at: Date.now() };
    return event;
  }

  function disposePart(part) {
    part?.plane?.parent?.remove(part.plane);
    part?.geometry?.dispose?.();
    part?.material?.dispose?.();
    part?.texture?.dispose?.();
  }

  function disposeRelationshipPopup(event, reason = 'expired') {
    event?.group?.parent?.remove(event.group);
    disposePart(event?.heartPart);
    disposePart(event?.valuePart);
    debugState.lastDisposedReason = reason;
  }

  function clearRelationshipPopups() { while (relationshipPopups.length) disposeRelationshipPopup(relationshipPopups.pop(), 'clear'); }

  async function spawnRelationshipPopup(root, kind, amount, options = {}) {
    const api = window.WorldPopupText;
    const THREE = deps?.THREE || window.THREE;
    const rawAmount = kind === 'favor' && !options.amountIsPoints ? convertFavorHeartDelta(kind, amount) : amount;
    const value = signedRelationshipAmount(rawAmount);
    if (!api || !THREE || !root || !value) return null;
    const scene = rootScene(root);
    if (!scene) return null;
    const image = await loadHeartImage();
    if (!root.parent || rootScene(root) !== scene) return null;

    const heartColor = relationshipHeartColor(kind);
    const numberColor = relationshipNumberColor(value);
    const label = `${value > 0 ? '+' : '-'}${Math.abs(value)}`;
    const worldHeight = Math.max(0.18, Number(api.defaults?.floatPlus?.worldHeight) || DEFAULT_WORLD_HEIGHT);
    const heartPart = makeHeartPart(image, heartColor);
    const valuePart = makeValuePart(label, numberColor);
    const group = new THREE.Group();
    group.name = `relationship_popup_${kind}`;
    layoutLikeChathead(group, heartPart, valuePart, worldHeight);
    group.scale.setScalar(START_GROUP_SCALE);

    const origin = relationshipOriginWorld(root);
    if (!origin) {
      disposePart(heartPart);
      disposePart(valuePart);
      return null;
    }
    group.position.copy(origin);
    const camera = deps?.camera;
    if (camera) group.quaternion.copy(camera.quaternion);

    const event = { kind, root, group, heartPart, valuePart, startedAt: performance.now(), lifetimeMs: Math.max(350, Number(api.defaults?.floatPlus?.lifetimeMs) || DEFAULT_LIFETIME_MS), worldHeight, value, heartColor, numberColor };
    scene.add(group);
    relationshipPopups.push(event);
    return hardenRelationshipPopupEvent(event);
  }

  function easeOutCubic(t) { const inv = 1 - t; return 1 - inv * inv * inv; }

  function updateRelationshipPopups(now) {
    const THREE = deps?.THREE || window.THREE;
    const camera = deps?.camera;
    if (!THREE || !camera) return;
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    for (let index = relationshipPopups.length - 1; index >= 0; index--) {
      const event = relationshipPopups[index];
      const progress = Math.max(0, Math.min(1, (now - event.startedAt) / event.lifetimeMs));
      const origin = relationshipOriginWorld(event.root);
      if (!origin || !event.root?.parent || progress >= 1) {
        disposeRelationshipPopup(event, !origin ? 'missing-anchor' : !event.root?.parent ? 'detached-root' : 'expired');
        relationshipPopups.splice(index, 1);
        continue;
      }
      const travel = easeOutCubic(progress);
      const position = origin.clone()
        .addScaledVector(cameraRight, event.worldHeight * POP_RIGHT_RATIO * travel)
        .addScaledVector(cameraUp, event.worldHeight * POP_UP_RATIO * travel);
      event.group.position.copy(position);
      event.group.quaternion.copy(camera.quaternion);
      const scale = START_GROUP_SCALE + (END_GROUP_SCALE - START_GROUP_SCALE) * travel;
      event.group.scale.setScalar(scale);
      const opacity = Math.max(0, Math.pow(1 - progress, 1.12));
      event.heartPart.material.opacity = opacity;
      event.valuePart.material.opacity = opacity;
    }
  }

  function bindDeps(nextDeps) {
    if (!nextDeps) return false;
    deps = nextDeps;
    debugState.depsCaptured = !!(deps?.THREE && deps?.camera);
    return debugState.depsCaptured;
  }

  function install() {
    const api = window.WorldPopupText;
    if (!api) return false;
    if (Number(api.__favorPopupPointsBridgeVersion) >= 6) return true;
    const originalInit = typeof api.init === 'function' ? api.init.bind(api) : null;
    const originalUpdate = typeof api.update === 'function' ? api.update.bind(api) : null;
    const originalClear = typeof api.clear === 'function' ? api.clear.bind(api) : null;
    const originalDebugSnapshot = typeof api.debugSnapshot === 'function' ? api.debugSnapshot.bind(api) : null;
    if (originalInit) api.init = function favorPopupV6Init(injectedDeps, ...args) { bindDeps(injectedDeps); return originalInit(injectedDeps, ...args); };
    if (originalUpdate) api.update = function favorPopupV6Update(now, ...args) { const result = originalUpdate(now, ...args); updateRelationshipPopups(now); return result; };
    if (originalClear) api.clear = function favorPopupV6Clear(...args) { clearRelationshipPopups(); return originalClear(...args); };
    api.showRelationshipChange = (root, kind, amount, options) => spawnRelationshipPopup(root, kind === 'favor' ? 'favor' : 'rapport', amount, options);
    api.showRapportGain = (root, amount, options) => spawnRelationshipPopup(root, 'rapport', amount, options);
    api.showRapportChange = api.showRapportGain;
    api.showFavorChange = (root, amount, options) => spawnRelationshipPopup(root, 'favor', amount, options);
    api.relationshipHeadAnchorWorld = root => relationshipOriginWorld(root);
    api.debugSnapshot = function favorPopupV6DebugSnapshot() {
      const base = originalDebugSnapshot ? originalDebugSnapshot() : {};
      return { ...base, relationshipPositionBridge: { version: 6, active: relationshipPopups.length, depsCaptured: debugState.depsCaptured, layout: 'chathead-style-heart-plus-value', motion: { rightRatio: POP_RIGHT_RATIO, upRatio: POP_UP_RATIO, startScale: START_GROUP_SCALE, endScale: END_GROUP_SCALE }, lastHeart: debugState.lastHeart, lastLayout: debugState.lastLayout, lastAnchor: debugState.lastAnchor, lastDisposedReason: debugState.lastDisposedReason } };
    };
    api.__favorPopupPointsBridge = true;
    api.__favorPopupPointsBridgeVersion = 6;
    return true;
  }

  if (!install() && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => { if (!install()) return; observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.FavorPopupPointsBridge = Object.freeze({
    version: 6,
    install,
    bindDeps,
    relationshipHeadAnchorWorld: relationshipOriginWorld,
    snapshot() {
      return { version: 6, activeRelationshipPopups: relationshipPopups.length, hardenedPopups: debugState.hardenedPopups, lastHardenedPopup: debugState.lastHardenedPopup, lastHeart: debugState.lastHeart, lastLayout: debugState.lastLayout, lastAnchor: debugState.lastAnchor, lastDisposedReason: debugState.lastDisposedReason, depsCaptured: debugState.depsCaptured, layout: 'chathead-style-heart-plus-value', popupBridgeVersion: Number(window.WorldPopupText?.__favorPopupPointsBridgeVersion) || 0 };
    },
  });
})();
