// Species-authored animal chathead framing shared by ambient and full dialogue.
// The MultiAvatar Animation Author writes normalized crop rectangles into the
// attachment-rig creature profile; this runtime consumes them without changing
// the animal's in-world PNG plane.
(() => {
  'use strict';

  const FRAME_SPACE = 'sprite-normalized-top-left'; // Used to validate editor/runtime crop coordinates against source creature canvases.
  const MIN_FRAME_SIZE = 0.04; // Used to prevent malformed authoring data from creating an empty or effectively invisible crop.
  const DEFAULT_FRAME_SIZE = 0.36; // Used only when a species has neither an authored frame nor usable painted head weights.
  const AUTO_FRAME_PADDING = 0.035; // Used to keep ears/outlines just outside painted head influence from touching the chathead edge.
  const DIALOGUE_FACE_EXTRA_DEG = 8; // Used only during full livestock dialogue to keep the animal a little farther from the camera edge-on angle so one eye/side reads clearly.
  const DIALOGUE_FACE_EXTRA_RAD = DIALOGUE_FACE_EXTRA_DEG * Math.PI / 180; // Radian form used by the existing camera-relative creature perp clamp.
  const SPECIAL_NPC_KINDS = Object.freeze({
    banubu: 'grehlr',
    hiki_hiki: 'drenkirra',
    'hiki-hiki': 'drenkirra',
    hikihiki: 'drenkirra',
  }); // Used by dialogue portrait surfaces for Great Fey whose visible bodies are ordinary animal species.

  const debugState = {
    installed: false,
    installAttempts: 0,
    lastKind: null,
    lastSpeakerId: null,
    lastFrame: null,
    lastFrameSource: null,
    lastError: null,
    dialogueFacingBridgeInstalled: false,
    dialogueFacingAnimalsPatched: 0,
    lastDialogueFacing: null,
  }; // Mobile-visible diagnostics exposed below so framing/facing failures do not require DevTools.

  function clamp(value, min = 0, max = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
  }

  function normalizeFrame(frame) {
    if (!frame || typeof frame !== 'object') return null;
    let x = clamp(frame.x, 0, 1);
    let y = clamp(frame.y, 0, 1);
    let width = clamp(frame.width, MIN_FRAME_SIZE, 1);
    let height = clamp(frame.height, MIN_FRAME_SIZE, 1);
    if (x + width > 1) width = Math.max(MIN_FRAME_SIZE, 1 - x);
    if (y + height > 1) height = Math.max(MIN_FRAME_SIZE, 1 - y);
    if (width < MIN_FRAME_SIZE) { x = Math.max(0, 1 - MIN_FRAME_SIZE); width = MIN_FRAME_SIZE; }
    if (height < MIN_FRAME_SIZE) { y = Math.max(0, 1 - MIN_FRAME_SIZE); height = MIN_FRAME_SIZE; }
    if (x + width > 1) x = Math.max(0, 1 - width);
    if (y + height > 1) y = Math.max(0, 1 - height);
    return {
      x,
      y,
      width,
      height,
      coordinateSpace: FRAME_SPACE,
      version: 1,
    };
  }

  function normalizeKind(kind) {
    return String(kind || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function profileForKind(kind) {
    const profiles = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures || {};
    const normalized = normalizeKind(kind);
    return profiles[normalized] || profiles[String(kind || '')] || null;
  }

  function headRigForKind(kind) {
    const normalized = normalizeKind(kind);
    return window.HobunjiAnimalHeadRigSpecies?.ANIMAL_HEAD_RIGS?.[normalized]
      || window.CreatureGeneticsRender?.headRigForKind?.(normalized)
      || window.CreatureGeneticsRender?.ANIMAL_HEAD_RIGS?.[normalized]
      || null;
  }

  function decodeWeightMap(weightMap) {
    if (!weightMap?.width || !weightMap?.height || !Array.isArray(weightMap.data)) return null;
    const width = Math.max(1, Math.round(Number(weightMap.width) || 1));
    const height = Math.max(1, Math.round(Number(weightMap.height) || 1));
    const values = new Uint16Array(width * height); // Used below to find the painted head-influence bounds from compact RLE authoring data.
    values.fill(Number.isFinite(Number(weightMap.unsetValue)) ? Number(weightMap.unsetValue) : 256);
    if (weightMap.encoding === 'rle-u9') {
      let cursor = 0;
      for (let index = 0; index + 1 < weightMap.data.length && cursor < values.length; index += 2) {
        const run = Math.max(0, Math.round(Number(weightMap.data[index]) || 0));
        const value = Math.max(0, Math.min(256, Math.round(Number(weightMap.data[index + 1]) || 0)));
        const end = Math.min(values.length, cursor + run);
        values.fill(value, cursor, end);
        cursor = end;
      }
    } else {
      for (let index = 0; index < values.length && index < weightMap.data.length; index++) {
        values[index] = Math.max(0, Math.min(256, Math.round(Number(weightMap.data[index]) || 0)));
      }
    }
    return { width, height, values };
  }

  function automaticFrameForKind(kind) {
    const rig = headRigForKind(kind);
    const decoded = decodeWeightMap(rig?.weightMap);
    if (decoded) {
      let minX = decoded.width, minY = decoded.height, maxX = -1, maxY = -1;
      for (let y = 0; y < decoded.height; y++) {
        for (let x = 0; x < decoded.width; x++) {
          const value = decoded.values[y * decoded.width + x];
          if (value === 256 || value < 128) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      if (maxX >= minX && maxY >= minY) {
        const x = minX / decoded.width - AUTO_FRAME_PADDING;
        const y = minY / decoded.height - AUTO_FRAME_PADDING;
        const width = (maxX - minX + 1) / decoded.width + AUTO_FRAME_PADDING * 2;
        const height = (maxY - minY + 1) / decoded.height + AUTO_FRAME_PADDING * 2;
        return normalizeFrame({ x, y, width, height });
      }
    }

    const pivotX = Number(rig?.pivot?.x);
    const pivotY = Number(rig?.pivot?.y);
    const centerX = Number.isFinite(pivotX) ? pivotX : 0.5;
    const centerY = Number.isFinite(pivotY) ? pivotY : 0.35;
    return normalizeFrame({
      x: centerX - DEFAULT_FRAME_SIZE / 2,
      y: centerY - DEFAULT_FRAME_SIZE / 2,
      width: DEFAULT_FRAME_SIZE,
      height: DEFAULT_FRAME_SIZE,
    });
  }

  function resolvedFrameResult(frame, source) {
    const normalized = normalizeFrame(frame); // Used below to give crop renderers and 3D dialogue consumers one canonical, validated rectangle.
    if (!normalized) return null;
    return {
      ...normalized,
      frame: normalized,
      source,
    }; // Top-level coordinates preserve the livestock dialogue contract while `.frame` remains backward-compatible for crop/editor callers.
  }

  function frameForKind(kind) {
    const authored = normalizeFrame(profileForKind(kind)?.chatheadFrame);
    if (authored) return resolvedFrameResult(authored, 'attachment-rig-profile');
    return resolvedFrameResult(automaticFrameForKind(kind), 'animal-head-rig-fallback');
  }

  function frameCenterForKind(kind) {
    const resolved = frameForKind(kind); // Used below as the single normalized source for the sprite-space head center.
    if (!resolved) return null;
    const x = resolved.x + resolved.width * 0.5; // Used by 3D dialogue/camera consumers to map the authored crop center onto the animal plane.
    const y = resolved.y + resolved.height * 0.5; // Used by 3D dialogue/camera consumers to map the authored crop center onto the animal plane.
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      debugState.lastError = `Non-finite animal chathead center for ${normalizeKind(kind) || 'unknown creature'}`;
      return null;
    }
    return { x, y, source: resolved.source };
  }

  function speakerIdFromSeatId(seatId) {
    const raw = String(seatId || '').trim();
    if (!raw) return '';
    if (raw.startsWith('ambient:')) return raw.split(':')[1] || '';
    return raw;
  }

  function creatureKindFor(profile, options = {}) {
    const explicit = options.creatureKind
      || profile?.chatheadCreatureKind
      || profile?.creatureKind
      || profile?.animalKind
      || profile?.fighter?.creatureKind;
    if (explicit) return normalizeKind(explicit);
    const speakerId = String(options.speakerId || speakerIdFromSeatId(options.seatId) || '').trim().toLowerCase();
    return SPECIAL_NPC_KINDS[speakerId] || null;
  }

  function isAnimalChatheadSurface(canvas, options = {}) {
    if (options.animalChathead === true) return true;
    if (canvas?.id === 'npcPortraitCanvas') return true;
    return String(options.seatId || '').startsWith('ambient:');
  }

  function drawFrameToCanvas(source, target, frame) {
    const sourceWidth = Number(source?.width || source?.naturalWidth) || 0;
    const sourceHeight = Number(source?.height || source?.naturalHeight) || 0;
    if (!target || !sourceWidth || !sourceHeight) return false;
    const targetWidth = Math.max(1, Number(target.width) || 200);
    const targetHeight = Math.max(1, Number(target.height) || targetWidth);
    const safe = normalizeFrame(frame) || normalizeFrame({ x: 0, y: 0, width: 1, height: 1 });
    const sx = Math.max(0, Math.min(sourceWidth - 1, safe.x * sourceWidth));
    const sy = Math.max(0, Math.min(sourceHeight - 1, safe.y * sourceHeight));
    const sw = Math.max(1, Math.min(sourceWidth - sx, safe.width * sourceWidth));
    const sh = Math.max(1, Math.min(sourceHeight - sy, safe.height * sourceHeight));
    const context = target.getContext?.('2d');
    if (!context) return false;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.imageSmoothingEnabled = false;
    const drawableWidth = targetWidth * 0.96;
    const drawableHeight = targetHeight * 0.96;
    const scale = Math.min(drawableWidth / sw, drawableHeight / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    context.drawImage(source, sx, sy, sw, sh, (targetWidth - dw) / 2, (targetHeight - dh) / 2, dw, dh);
    return true;
  }

  async function sourceCanvasForKind(kind, options = {}) {
    const renderer = window.CreatureGeneticsRender;
    if (renderer?.composeFrame) {
      const genotype = options.genotype || options.profile?.creatureGenotype || options.profile?.genotype || null;
      const canvas = await renderer.composeFrame(normalizeKind(kind), options.frame || 'idle', genotype, options.blinkShut === true);
      if (canvas) return canvas;
    }
    const idleUrl = renderer?.SPECIES?.[normalizeKind(kind)]?.base?.idle;
    if (!idleUrl || typeof Image === 'undefined') return null;
    return await new Promise(resolve => {
      const image = new Image(); // Used only as a no-genetics fallback when the compositor is unavailable on a lightweight tool page.
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = idleUrl;
    });
  }

  async function renderCreatureChathead(targetCanvas, kind, options = {}) {
    try {
      const source = await sourceCanvasForKind(kind, options);
      if (!source) return false;
      const resolved = frameForKind(kind);
      if (!resolved) return false;
      const rendered = drawFrameToCanvas(source, targetCanvas, resolved.frame);
      if (rendered) {
        debugState.lastKind = normalizeKind(kind);
        debugState.lastSpeakerId = String(options.speakerId || speakerIdFromSeatId(options.seatId) || '');
        debugState.lastFrame = { ...resolved.frame };
        debugState.lastFrameSource = resolved.source;
        debugState.lastError = null;
      }
      return rendered;
    } catch (error) {
      debugState.lastError = String(error?.message || error);
      window.__farmLog?.(`[animal-chathead] ${debugState.lastError}`, 'warn');
      return false;
    }
  }

  function installNpcPreviewBridge() {
    debugState.installAttempts++;
    const preview = window.NpcAvatarPreview;
    if (!preview?.renderProfileToCanvas || preview.__animalChatheadFrameWrapped) return false;
    const original = preview.renderProfileToCanvas; // Used to preserve every ordinary humanoid/world-avatar render outside chathead surfaces.
    preview.renderProfileToCanvas = async function animalChatheadAwareRender(targetCanvas, profile, options = {}) {
      if (isAnimalChatheadSurface(targetCanvas, options)) {
        const kind = creatureKindFor(profile, options);
        if (kind) {
          const rendered = await renderCreatureChathead(targetCanvas, kind, { ...options, profile });
          if (rendered) return targetCanvas;
        }
      }
      return original.call(preview, targetCanvas, profile, options);
    };
    preview.__animalChatheadFrameWrapped = true;
    preview.__animalChatheadFrameOriginal = original;
    debugState.installed = true;
    return true;
  }

  function patchDialogueFacingAnimal(animal, farmDeps) {
    if (!animal || animal.__animalChatheadDialogueFacingPatched) return false;
    const descriptor = Object.getOwnPropertyDescriptor(animal, 'groupRot');
    if (descriptor && descriptor.configurable === false) return false;
    let currentRot = Number(animal.groupRot);
    if (!Number.isFinite(currentRot)) currentRot = 0; // Backing value used by the runtime accessor installed below.
    Object.defineProperty(animal, 'groupRot', {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return currentRot; },
      set(value) {
        const requested = Number(value);
        if (!Number.isFinite(requested)) return;
        if (!animal._dialogueFrozen) {
          currentRot = requested;
          delete animal._animalChatheadDialoguePerpState;
          return;
        }
        const perpClamp = farmDeps?.perpClamp || window.PerpRotation?.perpClamp;
        const perps = farmDeps?.cameraRelativeCreaturePerps?.();
        const baseDeadRad = Number(farmDeps?.CREATURE_PERP_DEAD_RAD ?? window.PerpRotation?.CREATURE_PERP_DEAD_RAD);
        if (typeof perpClamp !== 'function' || !Array.isArray(perps) || !perps.length || !Number.isFinite(baseDeadRad)) {
          currentRot = requested;
          return;
        }
        const dialogueDeadRad = Math.min(Math.PI / 2 - 0.01, baseDeadRad + DIALOGUE_FACE_EXTRA_RAD); // Keeps dialogue a little more broadside than ordinary creature motion without changing the global deadzone.
        const state = animal._animalChatheadDialoguePerpState ||= {}; // Separate state keeps dialogue hysteresis from contaminating ordinary farm-animal facing after the conversation ends.
        const resolved = perpClamp(state, requested, perps, dialogueDeadRad);
        const effective = Number(resolved?.effectiveTarget);
        currentRot = Number.isFinite(effective) ? effective : requested;
        debugState.lastDialogueFacing = {
          livestockId: animal.livestockId || null,
          requestedRot: requested,
          effectiveRot: currentRot,
          baseDeadzoneDeg: baseDeadRad * 180 / Math.PI,
          dialogueDeadzoneDeg: dialogueDeadRad * 180 / Math.PI,
        }; // Mobile-visible proof that dialogue used the camera-relative animal deadzone and the extra readability margin.
      },
    });
    animal.__animalChatheadDialogueFacingPatched = true;
    debugState.dialogueFacingAnimalsPatched++;
    return true;
  }

  function patchFarmAnimalSet(farmDeps) {
    const animals = farmDeps?.animalObjects;
    if (!animals || typeof animals.add !== 'function') return false;
    for (const animal of animals) patchDialogueFacingAnimal(animal, farmDeps);
    if (animals.__animalChatheadDialogueAddWrapped) return true;
    const originalAdd = animals.add; // Used to instrument every future livestock runtime object at creation time without changing farm-animals.js factories.
    animals.add = function animalChatheadDialogueAwareAdd(animal) {
      patchDialogueFacingAnimal(animal, farmDeps);
      return originalAdd.call(this, animal);
    };
    animals.__animalChatheadDialogueAddWrapped = true;
    return true;
  }

  function patchFarmAnimalsApi(api) {
    if (!api || api.__animalChatheadDialogueFacingWrapped) return api;
    const originalInit = api.init;
    if (typeof originalInit === 'function') {
      api.init = function animalChatheadAwareFarmInit(injectedDeps) {
        const result = originalInit.call(this, injectedDeps);
        patchFarmAnimalSet(injectedDeps);
        return result;
      };
    }
    api.__animalChatheadDialogueFacingWrapped = true;
    return api;
  }

  function installFarmDialogueFacingBridge() {
    if (debugState.dialogueFacingBridgeInstalled) return true;
    const existingDescriptor = Object.getOwnPropertyDescriptor(window, 'FarmAnimals');
    if (existingDescriptor && existingDescriptor.configurable === false) {
      patchFarmAnimalsApi(window.FarmAnimals);
      return false;
    }
    let farmAnimals = window.FarmAnimals; // Captures an already-loaded API on lightweight harnesses; the game normally assigns it later from farm-animals.js.
    Object.defineProperty(window, 'FarmAnimals', {
      configurable: true,
      enumerable: true,
      get() { return farmAnimals; },
      set(value) { farmAnimals = patchFarmAnimalsApi(value); },
    });
    debugState.dialogueFacingBridgeInstalled = true;
    if (farmAnimals) farmAnimals = patchFarmAnimalsApi(farmAnimals);
    return true;
  }

  const api = {
    FRAME_SPACE,
    MIN_FRAME_SIZE,
    DIALOGUE_FACE_EXTRA_DEG,
    SPECIAL_NPC_KINDS,
    normalizeFrame,
    automaticFrameForKind,
    frameForKind,
    frameCenterForKind,
    creatureKindFor,
    drawFrameToCanvas,
    sourceCanvasForKind,
    renderCreatureChathead,
    installNpcPreviewBridge,
    installFarmDialogueFacingBridge,
    debugSnapshot: () => JSON.parse(JSON.stringify(debugState)),
  }; // Public surface used by the Animation Author preview and mobile diagnostics.

  window.AnimalChatheadFrame = api;
  window.__animalChatheadFrameDebug = debugState;
  installFarmDialogueFacingBridge();
  installNpcPreviewBridge();
  window.addEventListener?.('load', installNpcPreviewBridge, { once: true });
  if (!debugState.installed && typeof setInterval === 'function') {
    let attempts = 0;
    const retry = setInterval(() => {
      attempts++;
      if (installNpcPreviewBridge() || attempts >= 40) clearInterval(retry);
    }, 250); // Gives repository authoring tools time to load NpcAvatarPreview dynamically without leaving a permanent polling loop.
  }
})();
