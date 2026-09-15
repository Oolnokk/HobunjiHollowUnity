(() => {
  'use strict';

  if (Number(window.FavorPopupPointsBridge?.version) >= 7) return;

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
  const HEART_WORLD_RATIO = 0.90;
  const VALUE_WORLD_RATIO = 0.78;
  const CHATHEAD_GAP_RATIO = 0.14;
  const HEART_MAX_OPACITY = 0.80;
  const HEART_GLOW_BLUR_PX = 20;

  // Must stay in lockstep with docs/config/ui/world-popup-settings.json.
  // This bridge uses Float+ presentation even though ordinary favor reward rows remain assigned to centeredFiveRow.
  const FLOAT_PLUS = Object.freeze({
    worldHeight: 0.19,
    xOffsetPercent: 43,
    yOffsetPercent: 17,
    lifetimeMs: 1150,
    riseWorld: 0.075,
    swayHeightRatio: 0.12,
    fadeStart: 0.72,
  });

  const relationshipPopups = [];
  const debugState = {
    hardenedPopups: 0,
    lastHardenedPopup: null,
    lastAnchor: null,
    lastDisposedReason: null,
    lastLayout: null,
    lastHeart: null,
    depsCaptured: false,
  };
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

  function relationshipHeartColor(kind) {
    return kind === 'favor' ? FAVOR_HEART_COLOR : RAPPORT_HEART_COLOR;
  }

  function relationshipNumberColor(amount) {
    return amount > 0 ? RELATIONSHIP_GAIN_COLOR : RELATIONSHIP_LOSS_COLOR;
  }

  function spritePngSurface() {
    return window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit || null;
  }

  function loadHeartImage() {
    if (heartImagePromise) return heartImagePromise;
    heartImagePromise = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        debugState.lastHeart = {
          ...(debugState.lastHeart || {}),
          imageLoaded: true,
          imageWidth: Number(image.naturalWidth || image.width) || 0,
          imageHeight: Number(image.naturalHeight || image.height) || 0,
          crossOrigin: image.crossOrigin || '',
          url: HEART_URL,
          at: Date.now(),
        };
        resolve(image);
      };
      image.onerror = () => {
        debugState.lastHeart = {
          ...(debugState.lastHeart || {}),
          imageLoaded: false,
          imageWidth: 0,
          imageHeight: 0,
          crossOrigin: image.crossOrigin || '',
          url: HEART_URL,
          at: Date.now(),
        };
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

  function floatPlusAnchorWorld(root) {
    const THREE = deps?.THREE || window.THREE;
    if (!THREE || !root) return null;

    const avatarRoot = avatarRootWithPortraitMetadata(root) || root;
    const hasPortrait = Number.isFinite(Number(avatarRoot.userData?.portraitModelHeight));
    const height = hasPortrait ? Number(avatarRoot.userData.portraitModelHeight) : 1;
    const width = hasPortrait ? (Number(avatarRoot.userData.portraitModelWidth) || height) : 1;
    const placementRatioRaw = hasPortrait ? Number(avatarRoot.userData.portraitVerticalPlacementRatio ?? 0.5) : 0.5;
    const placementRatio = Number.isFinite(placementRatioRaw) ? placementRatioRaw : 0.5;
    const verticalOffset = (placementRatio - 0.5) * height;
    const combinedHeight = height * 0.5 + verticalOffset;
    const local = new THREE.Vector3(
      width * FLOAT_PLUS.xOffsetPercent / 100,
      verticalOffset + combinedHeight * FLOAT_PLUS.yOffsetPercent / 100,
      0,
    );

    avatarRoot.updateWorldMatrix?.(true, false);
    if (avatarRoot.localToWorld) avatarRoot.localToWorld(local);
    else {
      const fallback = window.WorldPopupText?.avatarCentroidWorld?.(root);
      if (!fallback) return null;
      local.copy(fallback);
      local.x += width * FLOAT_PLUS.xOffsetPercent / 100;
      local.y += combinedHeight * FLOAT_PLUS.yOffsetPercent / 100;
    }

    debugState.lastAnchor = {
      source: 'float-plus',
      height,
      width,
      placementRatio,
      xOffsetPercent: FLOAT_PLUS.xOffsetPercent,
      yOffsetPercent: FLOAT_PLUS.yOffsetPercent,
      world: { x: local.x, y: local.y, z: local.z },
      at: Date.now(),
    };
    return local;
  }

  function floatPlusFrame(root, progress, eventHeight = FLOAT_PLUS.worldHeight) {
    const THREE = deps?.THREE || window.THREE;
    const camera = deps?.camera;
    if (!THREE || !camera) return null;
    const center = floatPlusAnchorWorld(root);
    if (!center) return null;

    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    center.addScaledVector(cameraRight, Math.sin(progress * Math.PI) * eventHeight * FLOAT_PLUS.swayHeightRatio);
    center.y += FLOAT_PLUS.riseWorld * (1 - Math.pow(1 - progress, 2));
    const opacity = progress < FLOAT_PLUS.fadeStart
      ? 1
      : Math.max(0, (1 - progress) / (1 - FLOAT_PLUS.fadeStart));
    return { position: center, quaternion: camera.quaternion, opacity };
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
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: RELATIONSHIP_ALPHA_TEST,
      depthTest: false,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    return finishPlanePart(canvas, texture, material, aspect, renderOrder);
  }

  function makeHeartMask(image, color) {
    const mask = document.createElement('canvas');
    mask.width = 200;
    mask.height = 200;
    const context = mask.getContext('2d');
    context.clearRect(0, 0, mask.width, mask.height);
    let usedFallbackGlyph = false;

    if (image) {
      const sourceW = Math.max(1, Number(image.naturalWidth || image.width) || 1);
      const sourceH = Math.max(1, Number(image.naturalHeight || image.height) || 1);
      const drawW = 154;
      const drawH = drawW * sourceH / sourceW;
      const x = (mask.width - drawW) * 0.5;
      const y = (mask.height - drawH) * 0.5;
      context.drawImage(image, x, y, drawW, drawH);
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = color;
      context.fillRect(0, 0, mask.width, mask.height);
      context.globalCompositeOperation = 'source-over';
    } else {
      usedFallbackGlyph = true;
      context.font = '700 142px serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = color;
      context.fillText('♥', mask.width / 2, mask.height / 2 + 4);
    }
    return { mask, usedFallbackGlyph };
  }

  function makeHeartPart(image, color) {
    const THREE = deps?.THREE || window.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    const { mask, usedFallbackGlyph } = makeHeartMask(image, color);

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.shadowColor = color;
    context.shadowBlur = HEART_GLOW_BLUR_PX;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.drawImage(mask, 0, 0);
    context.restore();
    context.drawImage(mask, 0, 0);

    let nonTransparentPixels = -1;
    let maxAlpha = -1;
    let canvasReadError = '';
    try {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      nonTransparentPixels = 0;
      maxAlpha = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        const alpha = pixels[index];
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
    const alphaTest = typeof pngSurface?.alphaTest === 'function'
      ? Number(pngSurface.alphaTest()) || RELATIONSHIP_ALPHA_TEST
      : RELATIONSHIP_ALPHA_TEST;
    const materialOverrides = {
      transparent: true,
      opacity: HEART_MAX_OPACITY,
      alphaTest,
      depthTest: false,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    };
    const material = pngSurface?.makeMaterial
      ? pngSurface.makeMaterial(THREE, texture, 'relationship_heart_material', materialOverrides)
      : new THREE.MeshBasicMaterial({ map: texture, ...materialOverrides });

    debugState.lastHeart = {
      ...(debugState.lastHeart || {}),
      imageLoaded: !!image,
      imageWidth: Number(image?.naturalWidth || image?.width) || 0,
      imageHeight: Number(image?.naturalHeight || image?.height) || 0,
      crossOrigin: image?.crossOrigin || '',
      usedFallbackGlyph,
      nonTransparentPixels,
      maxAlpha,
      canvasReadError,
      canonicalPngSurface: !!pngSurface,
      canonicalTextureFactory: !!pngSurface?.makeCanvasTexture,
      canonicalMaterialFactory: !!pngSurface?.makeMaterial,
      alphaTest,
      maxOpacity: HEART_MAX_OPACITY,
      glowBlurPx: HEART_GLOW_BLUR_PX,
      url: HEART_URL,
      at: Date.now(),
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
    debugState.lastLayout = {
      type: 'chathead-style-heart-plus-value',
      heartWorldSize,
      valueWorldHeight,
      valueWidth,
      gap,
      totalWidth,
      at: Date.now(),
    };
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
    debugState.lastHardenedPopup = {
      kind: event.kind,
      value: event.value,
      layout: 'chathead-style-heart-plus-value',
      animation: 'floatPlus',
      childPlanes: parts.length,
      heartUsesCanonicalPngSurface: !!debugState.lastHeart?.canonicalMaterialFactory,
      heartMaxOpacity: HEART_MAX_OPACITY,
      alphaTest: Number(event?.heartPart?.material?.alphaTest) || RELATIONSHIP_ALPHA_TEST,
      at: Date.now(),
    };
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

  function clearRelationshipPopups() {
    while (relationshipPopups.length) disposeRelationshipPopup(relationshipPopups.pop(), 'clear');
  }

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
    const heartPart = makeHeartPart(image, heartColor);
    const valuePart = makeValuePart(label, numberColor);
    const group = new THREE.Group();
    group.name = `relationship_popup_${kind}`;
    layoutLikeChathead(group, heartPart, valuePart, FLOAT_PLUS.worldHeight);

    const initialFrame = floatPlusFrame(root, 0, FLOAT_PLUS.worldHeight);
    if (!initialFrame) {
      disposePart(heartPart);
      disposePart(valuePart);
      return null;
    }
    group.position.copy(initialFrame.position);
    group.quaternion.copy(initialFrame.quaternion);
    group.scale.setScalar(1);
    heartPart.material.opacity = HEART_MAX_OPACITY;
    valuePart.material.opacity = 1;

    const event = {
      kind,
      root,
      group,
      heartPart,
      valuePart,
      startedAt: performance.now(),
      lifetimeMs: FLOAT_PLUS.lifetimeMs,
      worldHeight: FLOAT_PLUS.worldHeight,
      value,
      heartColor,
      numberColor,
    };
    scene.add(group);
    relationshipPopups.push(event);
    return hardenRelationshipPopupEvent(event);
  }

  function updateRelationshipPopups(now) {
    for (let index = relationshipPopups.length - 1; index >= 0; index--) {
      const event = relationshipPopups[index];
      const progress = Math.max(0, Math.min(1, (now - event.startedAt) / event.lifetimeMs));
      const frame = floatPlusFrame(event.root, progress, event.worldHeight);
      if (!frame || !event.root?.parent || progress >= 1) {
        disposeRelationshipPopup(event, !frame ? 'missing-float-plus-frame' : !event.root?.parent ? 'detached-root' : 'expired');
        relationshipPopups.splice(index, 1);
        continue;
      }
      event.group.position.copy(frame.position);
      event.group.quaternion.copy(frame.quaternion);
      event.group.scale.setScalar(1);
      event.heartPart.material.opacity = HEART_MAX_OPACITY * frame.opacity;
      event.valuePart.material.opacity = frame.opacity;
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
    if (Number(api.__favorPopupPointsBridgeVersion) >= 7) return true;

    const originalInit = typeof api.init === 'function' ? api.init.bind(api) : null;
    const originalUpdate = typeof api.update === 'function' ? api.update.bind(api) : null;
    const originalClear = typeof api.clear === 'function' ? api.clear.bind(api) : null;
    const originalDebugSnapshot = typeof api.debugSnapshot === 'function' ? api.debugSnapshot.bind(api) : null;

    if (originalInit) {
      api.init = function favorPopupV7Init(injectedDeps, ...args) {
        bindDeps(injectedDeps);
        return originalInit(injectedDeps, ...args);
      };
    }
    if (originalUpdate) {
      api.update = function favorPopupV7Update(now, ...args) {
        const result = originalUpdate(now, ...args);
        updateRelationshipPopups(now);
        return result;
      };
    }
    if (originalClear) {
      api.clear = function favorPopupV7Clear(...args) {
        clearRelationshipPopups();
        return originalClear(...args);
      };
    }

    api.showRelationshipChange = (root, kind, amount, options) => spawnRelationshipPopup(root, kind === 'favor' ? 'favor' : 'rapport', amount, options);
    api.showRapportGain = (root, amount, options) => spawnRelationshipPopup(root, 'rapport', amount, options);
    api.showRapportChange = api.showRapportGain;
    api.showFavorChange = (root, amount, options) => spawnRelationshipPopup(root, 'favor', amount, options);
    api.relationshipHeadAnchorWorld = root => floatPlusAnchorWorld(root);
    api.debugSnapshot = function favorPopupV7DebugSnapshot() {
      const base = originalDebugSnapshot ? originalDebugSnapshot() : {};
      return {
        ...base,
        relationshipPositionBridge: {
          version: 7,
          active: relationshipPopups.length,
          depsCaptured: debugState.depsCaptured,
          layout: 'chathead-style-heart-plus-value',
          animation: 'floatPlus',
          floatPlus: { ...FLOAT_PLUS },
          heart: { maxOpacity: HEART_MAX_OPACITY, glowBlurPx: HEART_GLOW_BLUR_PX },
          lastHeart: debugState.lastHeart,
          lastLayout: debugState.lastLayout,
          lastAnchor: debugState.lastAnchor,
          lastDisposedReason: debugState.lastDisposedReason,
        },
      };
    };
    api.__favorPopupPointsBridge = true;
    api.__favorPopupPointsBridgeVersion = 7;
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
    version: 7,
    install,
    bindDeps,
    relationshipHeadAnchorWorld: floatPlusAnchorWorld,
    snapshot() {
      return {
        version: 7,
        activeRelationshipPopups: relationshipPopups.length,
        hardenedPopups: debugState.hardenedPopups,
        lastHardenedPopup: debugState.lastHardenedPopup,
        lastHeart: debugState.lastHeart,
        lastLayout: debugState.lastLayout,
        lastAnchor: debugState.lastAnchor,
        lastDisposedReason: debugState.lastDisposedReason,
        depsCaptured: debugState.depsCaptured,
        layout: 'chathead-style-heart-plus-value',
        animation: 'floatPlus',
        floatPlus: { ...FLOAT_PLUS },
        heart: { maxOpacity: HEART_MAX_OPACITY, glowBlurPx: HEART_GLOW_BLUR_PX },
        popupBridgeVersion: Number(window.WorldPopupText?.__favorPopupPointsBridgeVersion) || 0,
      };
    },
  });
})();
