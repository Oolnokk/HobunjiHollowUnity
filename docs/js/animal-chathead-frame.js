// Species-authored animal chathead framing shared by ambient and full dialogue.
// Also bridges animal-form NPC appearance records into the ordinary NPC avatar
// preview pipeline so the same creature/genotype, fey overrides, opacity, and hat render in-world and in chat.
(() => {
  'use strict';

  const FRAME_SPACE = 'sprite-normalized-top-left';
  const MIN_FRAME_SIZE = 0.04;
  const DEFAULT_FRAME_SIZE = 0.36;
  const AUTO_FRAME_PADDING = 0.035;
  const DIALOGUE_FACE_EXTRA_DEG = 8;
  const SPECIAL_NPC_KINDS = Object.freeze({
    banubu: 'grehlr',
    hiki_hiki: 'drenkirra',
    'hiki-hiki': 'drenkirra',
    hikihiki: 'drenkirra',
  });

  const debugState = {
    installed: false,
    installAttempts: 0,
    lastKind: null,
    lastSpeakerId: null,
    lastFrame: null,
    lastFrameSource: null,
    lastSurface: null,
    lastProfileSource: null,
    lastOpacity: 1,
    lastHatId: null,
    lastColorOverrides: null,
    lastError: null,
  }; // Shared mobile/debug snapshot for both chathead crops and full animal NPC renders.

  function clamp(value, min = 0, max = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
  }

  function normalizeOpacity(value) {
    return Number.isFinite(Number(value)) ? clamp(Number(value), 0, 1) : 1;
  }

  function normalizeCustomHex(value) {
    const match = String(value || '').trim().match(/^#?([0-9a-f]{6})$/i);
    return match ? `#${match[1].toUpperCase()}` : null;
  }

  function normalizeKind(kind) {
    return String(kind || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function normalizeNpcKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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
    return { x, y, width, height, coordinateSpace: FRAME_SPACE, version: 1 };
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
    const values = new Uint16Array(width * height);
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
        return normalizeFrame({
          x: minX / decoded.width - AUTO_FRAME_PADDING,
          y: minY / decoded.height - AUTO_FRAME_PADDING,
          width: (maxX - minX + 1) / decoded.width + AUTO_FRAME_PADDING * 2,
          height: (maxY - minY + 1) / decoded.height + AUTO_FRAME_PADDING * 2,
        });
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
    const normalized = normalizeFrame(frame);
    if (!normalized) return null;
    return { ...normalized, frame: normalized, source };
  }

  function frameForKind(kind) {
    const authored = normalizeFrame(profileForKind(kind)?.chatheadFrame);
    return authored
      ? resolvedFrameResult(authored, 'attachment-rig-profile')
      : resolvedFrameResult(automaticFrameForKind(kind), 'animal-head-rig-fallback');
  }

  function frameCenterForKind(kind) {
    const resolved = frameForKind(kind);
    if (!resolved) return null;
    const x = resolved.x + resolved.width * 0.5;
    const y = resolved.y + resolved.height * 0.5;
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
    return SPECIAL_NPC_KINDS[speakerId] || SPECIAL_NPC_KINDS[normalizeNpcKey(speakerId)] || null;
  }

  function legacyAnimalKindForNpc(npc) {
    const candidates = [npc?.id, npc?.npcId, npc?.name]; // Covers database exports and runtime callers that pass only the NPC's display name.
    for (const candidate of candidates) {
      const raw = String(candidate || '').trim().toLowerCase();
      const normalized = normalizeNpcKey(candidate);
      const compact = normalized.replace(/_/g, '');
      const kind = SPECIAL_NPC_KINDS[raw] || SPECIAL_NPC_KINDS[normalized] || SPECIAL_NPC_KINDS[compact];
      if (kind) return kind;
    }
    return null;
  }

  function resolveAnimalNpcExport(npc) {
    const appearance = npc?.appearance || {};
    if (appearance.avatarType === 'person') return null;
    const explicit = normalizeKind(appearance.creatureKind || appearance.animalKind || npc?.creatureKind || npc?.animalKind);
    if (explicit) return { kind: explicit, source: 'appearance' };
    const legacy = legacyAnimalKindForNpc(npc);
    return legacy ? { kind: normalizeKind(legacy), source: 'legacy-name' } : null;
  }

  function animalKindForNpcExport(npc) {
    return resolveAnimalNpcExport(npc)?.kind || null;
  }

  function defaultGenotypeForKind(kind) {
    const palettes = window.SCRATCHBONES_CONFIG?.game?.creatureGenetics?.palettes || {};
    const palette = palettes[kind] || palettes.default || [];
    const firstColor = palette[0]?.hex || '#8c7a66';
    const secondColor = palette[1]?.hex || firstColor;
    if (kind === 'uumkaoii') {
      return {
        fur: { color: firstColor, copies: 2, inheritance: 'dominant' },
        plates: { color: secondColor, copies: 2, inheritance: 'dominant' },
        sizeClass: 'medium',
      };
    }
    const genotype = { base: { color: firstColor, copies: 2, inheritance: 'dominant' }, sizeClass: 'medium' };
    const patternIds = window.CreatureGenetics?.PATTERN_DEFS?.[kind] || window.CreatureGeneticsRender?.SPECIES?.[kind]?.patterns || [];
    for (const patternId of patternIds) genotype[patternId] = { color: secondColor, copies: 0, inheritance: 'dominant', enabled: false };
    return genotype;
  }

  function buildAnimalProfileFromNpcExport(npc, resolution = resolveAnimalNpcExport(npc)) {
    if (!resolution?.kind) return null;
    const appearance = npc?.appearance || {};
    const authoredGenotype = appearance.creatureGenotype || appearance.genotype || npc?.creatureGenotype || npc?.genotype || null;
    const genotype = authoredGenotype || (resolution.source === 'appearance' ? defaultGenotypeForKind(resolution.kind) : null);
    const opacity = normalizeOpacity(appearance.animalOpacity ?? npc?.animalOpacity);
    const hatId = String(appearance.animalHatId || npc?.animalHatId || 'none');
    const animalAppearance = {
      ...appearance,
      avatarType: 'animal',
      creatureKind: resolution.kind,
      animalOpacity: opacity,
      animalHatId: hatId,
      ...(genotype ? { creatureGenotype: genotype } : {}),
    };
    debugState.lastKind = resolution.kind;
    debugState.lastProfileSource = resolution.source;
    return {
      name: npc?.name || npc?.id || resolution.kind,
      appearance: animalAppearance,
      isAnimalNpc: true,
      creatureKind: resolution.kind,
      animalKind: resolution.kind,
      animalOpacity: opacity,
      animalHatId: hatId,
      ...(genotype ? { creatureGenotype: genotype, genotype } : {}),
      animalNpcAppearanceSource: resolution.source,
    };
  }

  function isAnimalChatheadSurface(canvas, options = {}) {
    if (options.animalChathead === true) return true;
    if (canvas?.id === 'npcPortraitCanvas') return true;
    return String(options.seatId || '').startsWith('ambient:');
  }

  function opacityForProfile(profile, options = {}) {
    return normalizeOpacity(options.opacity ?? profile?.animalOpacity ?? profile?.appearance?.animalOpacity);
  }

  function genotypeForProfile(options = {}) {
    const source = options.genotype || options.profile?.creatureGenotype || options.profile?.genotype || null;
    const appearance = options.profile?.appearance || {};
    const overrides = appearance.creatureColorOverrides || options.profile?.creatureColorOverrides || {};
    if (!source || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return source;
    let genotype;
    try { genotype = JSON.parse(JSON.stringify(source)); } catch (_) { genotype = { ...source }; }
    const applied = {};
    for (const [layerId, rawColor] of Object.entries(overrides)) {
      const color = normalizeCustomHex(rawColor);
      if (!color) continue;
      genotype[layerId] = { ...(genotype[layerId] || {}), color };
      applied[layerId] = color;
    }
    debugState.lastColorOverrides = Object.keys(applied).length ? applied : null;
    return genotype;
  }

  function drawFrameToCanvas(source, target, frame, opacity = 1) {
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
    const scale = Math.min((targetWidth * 0.96) / sw, (targetHeight * 0.96) / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    context.save();
    context.globalAlpha = normalizeOpacity(opacity);
    context.drawImage(source, sx, sy, sw, sh, (targetWidth - dw) / 2, (targetHeight - dh) / 2, dw, dh);
    context.restore();
    return true;
  }

  async function sourceCanvasForKind(kind, options = {}) {
    const renderer = window.CreatureGeneticsRender;
    const genotype = genotypeForProfile(options); // NPC-only fey overrides intentionally bypass breeding palette normalization at the final render seam.
    let canvas = null;
    if (renderer?.composeFrame) {
      canvas = await renderer.composeFrame(normalizeKind(kind), options.frame || 'idle', genotype, options.blinkShut === true);
    }
    if (!canvas) {
      const idleUrl = renderer?.SPECIES?.[normalizeKind(kind)]?.base?.idle;
      if (!idleUrl || typeof Image === 'undefined') return null;
      canvas = await new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = idleUrl;
      });
    }
    const appearance = options.profile?.appearance || {};
    const hatId = appearance.animalHatId || options.profile?.animalHatId || 'none';
    if (canvas && hatId !== 'none' && window.AnimalNpcHeadwear?.composeWithHat) {
      canvas = await window.AnimalNpcHeadwear.composeWithHat(canvas, normalizeKind(kind), { ...appearance, animalHatId: hatId });
    }
    return canvas;
  }

  async function renderCreatureChathead(targetCanvas, kind, options = {}) {
    try {
      const source = await sourceCanvasForKind(kind, options);
      const resolved = frameForKind(kind);
      if (!source || !resolved) return false;
      const opacity = opacityForProfile(options.profile, options);
      const rendered = drawFrameToCanvas(source, targetCanvas, resolved.frame, opacity);
      if (rendered) {
        debugState.lastKind = normalizeKind(kind);
        debugState.lastSpeakerId = String(options.speakerId || speakerIdFromSeatId(options.seatId) || '');
        debugState.lastFrame = { ...resolved.frame };
        debugState.lastFrameSource = resolved.source;
        debugState.lastSurface = 'chathead';
        debugState.lastOpacity = opacity;
        debugState.lastHatId = options.profile?.appearance?.animalHatId || options.profile?.animalHatId || 'none';
        debugState.lastError = null;
      }
      return rendered;
    } catch (error) {
      debugState.lastError = String(error?.message || error);
      window.__farmLog?.(`[animal-chathead] ${debugState.lastError}`, 'warn');
      return false;
    }
  }

  async function renderCreatureFullFrame(targetCanvas, kind, options = {}) {
    try {
      const source = await sourceCanvasForKind(kind, options);
      if (!source) return false;
      const fullFrame = { x: 0, y: 0, width: 1, height: 1 };
      const opacity = opacityForProfile(options.profile, options);
      const rendered = drawFrameToCanvas(source, targetCanvas, fullFrame, opacity);
      if (rendered) {
        debugState.lastKind = normalizeKind(kind);
        debugState.lastSpeakerId = String(options.speakerId || speakerIdFromSeatId(options.seatId) || '');
        debugState.lastFrame = { ...fullFrame };
        debugState.lastFrameSource = 'full-creature-frame';
        debugState.lastSurface = 'full-body';
        debugState.lastOpacity = opacity;
        debugState.lastHatId = options.profile?.appearance?.animalHatId || options.profile?.animalHatId || 'none';
        debugState.lastError = null;
        targetCanvas.__hobunjiAnimalNpcAppearance = {
          kind: normalizeKind(kind),
          genotype: genotypeForProfile(options),
          opacity,
          hatId: debugState.lastHatId,
          colorOverrides: debugState.lastColorOverrides,
        };
      }
      return rendered;
    } catch (error) {
      debugState.lastError = String(error?.message || error);
      window.__farmLog?.(`[animal-npc] ${debugState.lastError}`, 'warn');
      return false;
    }
  }

  function installNpcPreviewBridge() {
    debugState.installAttempts++;
    const preview = window.NpcAvatarPreview;
    if (!preview) return false;

    if (preview.buildProfileFromNpcExport && !preview.__animalNpcProfileBuildWrapped) {
      const originalBuild = preview.buildProfileFromNpcExport;
      preview.buildProfileFromNpcExport = function animalNpcAwareProfileBuild(npc) {
        const resolution = resolveAnimalNpcExport(npc);
        if (resolution) {
          const animalProfile = buildAnimalProfileFromNpcExport(npc, resolution);
          if (animalProfile) return animalProfile;
        }
        return originalBuild.call(preview, npc);
      };
      preview.__animalNpcProfileBuildWrapped = true;
      preview.__animalNpcProfileBuildOriginal = originalBuild;
    }

    if (preview.renderProfileToCanvas && !preview.__animalChatheadFrameWrapped) {
      const originalRender = preview.renderProfileToCanvas;
      preview.renderProfileToCanvas = async function animalNpcAwareRender(targetCanvas, profile, options = {}) {
        const kind = creatureKindFor(profile, options);
        if (kind) {
          const rendered = isAnimalChatheadSurface(targetCanvas, options)
            ? await renderCreatureChathead(targetCanvas, kind, { ...options, profile })
            : await renderCreatureFullFrame(targetCanvas, kind, { ...options, profile });
          if (rendered) return targetCanvas;
        }
        return originalRender.call(preview, targetCanvas, profile, options);
      };
      preview.__animalChatheadFrameWrapped = true;
      preview.__animalChatheadFrameOriginal = originalRender;
    }

    debugState.installed = !!(preview.__animalNpcProfileBuildWrapped && preview.__animalChatheadFrameWrapped);
    return debugState.installed;
  }

  function installAuthorThreeCompatibility() {
    if (typeof location === 'undefined' || !/\/tools\/animation-author\//.test(location.pathname || '')) return;
    const assets = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar;
    if (!assets) return;
    assets.threeModuleUrl = 'https://esm.sh/three@0.128.0';
    assets.orbitControlsModuleUrl = 'https://esm.sh/three@0.128.0/examples/jsm/controls/OrbitControls.js?deps=three@0.128.0';
    assets.gltfExporterModuleUrl = 'https://esm.sh/three@0.128.0/examples/jsm/exporters/GLTFExporter.js?deps=three@0.128.0';
  }

  function scheduleNpcPreviewBridgeInstall() {
    if (installNpcPreviewBridge() || typeof setTimeout !== 'function') return;
    let retries = 0;
    const retry = () => {
      retries += 1;
      if (installNpcPreviewBridge() || retries >= 80) return;
      setTimeout(retry, 50);
    };
    setTimeout(retry, 0);
  }

  function debugSnapshot() { return { ...debugState }; }

  window.AnimalChatheadFrame = Object.freeze({
    FRAME_SPACE,
    MIN_FRAME_SIZE,
    DIALOGUE_FACE_EXTRA_DEG,
    SPECIAL_NPC_KINDS,
    normalizeFrame,
    normalizeOpacity,
    normalizeCustomHex,
    automaticFrameForKind,
    frameForKind,
    frameCenterForKind,
    creatureKindFor,
    animalKindForNpcExport,
    buildAnimalProfileFromNpcExport,
    genotypeForProfile,
    drawFrameToCanvas,
    sourceCanvasForKind,
    renderCreatureChathead,
    renderCreatureFullFrame,
    installNpcPreviewBridge,
    scheduleNpcPreviewBridgeInstall,
    debugSnapshot,
  });
  window.__animalChatheadFrameDebug = debugState;
  installAuthorThreeCompatibility();
  scheduleNpcPreviewBridgeInstall();
})();
