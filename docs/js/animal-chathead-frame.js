// Species-authored animal chathead framing shared by ambient and full dialogue.
// Runtime use is intentionally limited to sprite-space head metadata/cropping;
// full livestock staging/facing/camera behavior lives in livestock-dialogue.js.
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
  const paintedHeadCache = new Map(); // Reuses the finished 200px crop in ambient and full dialogue without recomposing large painted animal sprites each frame.
  const MAX_PAINTED_HEADS = 8; // Bounds the cache to a few small canvases on mobile.

  const debugState = {
    installed: false,
    installAttempts: 0,
    lastKind: null,
    lastSpeakerId: null,
    lastFrame: null,
    lastFrameSource: null,
    lastError: null,
    paintedCacheHits: 0,
    paintedCacheMisses: 0,
  };

  function clamp(value, min = 0, max = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
  }

  function normalizeKind(kind) {
    return String(kind || '').trim().toLowerCase().replace(/_/g, '-');
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
    const scale = Math.min((targetWidth * 0.96) / sw, (targetHeight * 0.96) / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    context.drawImage(source, sx, sy, sw, sh, (targetWidth - dw) / 2, (targetHeight - dh) / 2, dw, dh);
    return true;
  }

  async function sourceCanvasForKind(kind, options = {}) {
    const renderer = window.CreatureGeneticsRender;
    if (renderer?.composeFrame) {
      const genotype = options.genotype || options.profile?.animalGenotype || options.profile?.creatureGenotype || options.profile?.appearance?.animalGenotype || options.profile?.appearance?.creatureGenotype || options.profile?.genotype || null; // Matches the cache signature and the NPC's authored paint source.
      const canvas = await renderer.composeFrame(normalizeKind(kind), options.frame || 'idle', genotype, options.blinkShut === true);
      if (canvas) return canvas;
    }
    const idleUrl = renderer?.SPECIES?.[normalizeKind(kind)]?.base?.idle;
    if (!idleUrl || typeof Image === 'undefined') return null;
    return await new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = idleUrl;
    });
  }

  async function renderCreatureChathead(targetCanvas, kind, options = {}) {
    try {
      const resolved = frameForKind(kind);
      if (!resolved) return false;
      const genotype = options.genotype || options.profile?.animalGenotype || options.profile?.creatureGenotype || options.profile?.appearance?.animalGenotype || options.profile?.appearance?.creatureGenotype || options.profile?.genotype || null; // Pattern-bearing genotype selects the cached crop.
      const signature = genotype?.colorPoolPaint?.layers && window.CreatureGeneticsRender?.genotypeSignature?.(normalizeKind(kind), genotype); // Other creatures keep their existing live compositing path.
      const cacheKey = signature ? JSON.stringify([normalizeKind(kind), options.frame || 'idle', options.blinkShut === true, signature, resolved.frame]) : null; // Distinguishes paint, blink, and authored framing.
      let cached = cacheKey && paintedHeadCache.get(cacheKey); // Small precomposed image used by subsequent speech frames.
      let source = null; // Original sprite used when no painted crop is cached.
      if (cached) {
        debugState.paintedCacheHits++;
        paintedHeadCache.delete(cacheKey);
        paintedHeadCache.set(cacheKey, cached);
      } else {
        if (cacheKey) debugState.paintedCacheMisses++;
        source = await sourceCanvasForKind(kind, options);
        if (!source) return false;
        if (cacheKey) {
          cached = document.createElement('canvas');
          cached.width = cached.height = 200;
          if (!drawFrameToCanvas(source, cached, resolved.frame)) return false;
          paintedHeadCache.set(cacheKey, cached);
          if (paintedHeadCache.size > MAX_PAINTED_HEADS) paintedHeadCache.delete(paintedHeadCache.keys().next().value);
        }
      }
      const context = cached && targetCanvas?.getContext?.('2d'); // Cached crop is already framed and must not be padded twice.
      if (context) { context.clearRect(0, 0, targetCanvas.width, targetCanvas.height); context.drawImage(cached, 0, 0, targetCanvas.width, targetCanvas.height); }
      const rendered = context ? true : drawFrameToCanvas(source, targetCanvas, resolved.frame);
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
    const original = preview.renderProfileToCanvas;
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

  // main now pins the authoring tools to Three r128. V15.45 branched just
  // before that tiny compatibility change, so normalize the live author
  // config here instead of replacing the huge editor file just for fallback
  // literals. The ordinary game config is already r128 and is left alone.
  function installAuthorThreeCompatibility() {
    if (typeof location === 'undefined' || !/\/tools\/animation-author\//.test(location.pathname || '')) return;
    const assets = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar;
    if (!assets) return;
    assets.threeModuleUrl = 'https://esm.sh/three@0.128.0';
    assets.orbitControlsModuleUrl = 'https://esm.sh/three@0.128.0/examples/jsm/controls/OrbitControls.js?deps=three@0.128.0';
    assets.gltfExporterModuleUrl = 'https://esm.sh/three@0.128.0/examples/jsm/exporters/GLTFExporter.js?deps=three@0.128.0';
  }

  function debugSnapshot() { return { ...debugState }; }

  window.AnimalChatheadFrame = Object.freeze({
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
    debugSnapshot,
  });
  window.__animalChatheadFrameDebug = debugState;
  installAuthorThreeCompatibility();
  installNpcPreviewBridge();
})();

// The Animation Author loads creature-genetics-render.js directly, while the
// game later extends that renderer from creature-genetics.js. Keep the target
// picker on the same live registry as gameplay instead of maintaining another
// hard-coded animal list in the authoring tool.
(function installAnimationAuthorCreatureRegistrySync(global) {
  'use strict';
  if (typeof location === 'undefined' || !/\/tools\/animation-author\//.test(location.pathname || '')) return;

  const REQUIRED_KINDS = Object.freeze(['puktuk', 'voorg-ass']); // Used to verify the two runtime-extended livestock species reached both renderer and picker.
  const DISPLAY_LABELS = Object.freeze({ puktuk: 'Puktuk', 'voorg-ass': 'Vorg-Ass' }); // Used only when the picker needs an option appended before its ordinary population pass.
  const STATUS_KEY = 'animationAuthorCreatureRegistrySync'; // Used by the mobile-safe debug object exposed below.
  const statusRoot = global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {}; // Stores picker diagnostics beside the existing Rig Coordinates diagnostics.
  const status = statusRoot[STATUS_KEY] ||= { state: 'waiting-for-renderer', attempts: 0, loads: 0, pickerRefreshes: 0, rendererMissing: [...REQUIRED_KINDS], pickerMissing: [...REQUIRED_KINDS], lastError: null }; // Exposed so a mobile test can report exactly which layer is stale.
  let intervalId = null; // Polls until the dynamically loaded repository renderer and its extension module are both ready.
  let scriptRequested = false; // Prevents duplicate creature-genetics.js script requests during repository startup.

  function missingRendererKinds() {
    const species = global.CreatureGeneticsRender?.SPECIES || {}; // Read by the same picker population code inside the Animation Author.
    return REQUIRED_KINDS.filter(kind => !species[kind]);
  }

  function pickerValues(select) {
    const options = Array.from(select?.options || []); // Used to compare the rendered select against the live renderer registry.
    return options.map(option => String(option?.value || ''));
  }

  function missingPickerKinds() {
    const select = global.document?.getElementById('maaCreatureSpecies'); // The existing Add creature target species select.
    const values = pickerValues(select); // Used to report which required livestock kinds are still absent from the UI.
    return REQUIRED_KINDS.filter(kind => !values.includes(kind));
  }

  function displayLabel(kind) {
    const explicit = DISPLAY_LABELS[kind]; // Keeps the two known livestock names in their authored capitalization.
    if (explicit) return explicit;
    return String(kind || '').split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  function normalizeExtendedSpeciesAssetUrls() {
    const species = global.CreatureGeneticsRender?.SPECIES || {}; // Holds the post-renderer species records installed by creature-genetics.js.
    const docsBase = new URL('../../', global.location.href); // Resolves game-relative assets from the nested docs/tools/animation-author page back to docs/.
    const rewrite = value => { // Recursively fixes only repository asset strings while leaving flags, arrays, colors, and metadata intact.
      if (typeof value === 'string') return value.startsWith('assets/') ? new URL(value, docsBase).href : value;
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) value[index] = rewrite(value[index]);
        return value;
      }
      if (!value || typeof value !== 'object') return value;
      for (const key of Object.keys(value)) value[key] = rewrite(value[key]);
      return value;
    };
    for (const kind of REQUIRED_KINDS) if (species[kind]) rewrite(species[kind]);
  }

  function refreshPickerFromRenderer() {
    const select = global.document?.getElementById('maaCreatureSpecies'); // Updated in place so the author's normal change handler continues driving frame selection.
    const species = global.CreatureGeneticsRender?.SPECIES; // Canonical renderer registry after creature-genetics.js applies runtime extensions.
    if (!select || !species) return false;
    const existing = new Set(pickerValues(select)); // Used to append only registry species that the current picker population missed.
    const previousValue = String(select.value || ''); // Restored after appending so this background repair never changes the user's current target selection.
    let changed = false; // Tracks whether this pass actually repaired the visible species list.
    for (const kind of Object.keys(species)) {
      if (existing.has(kind)) continue;
      const option = global.document.createElement?.('option'); // Uses the native select option surface rather than replacing Animation Author UI code.
      if (!option) continue;
      option.value = kind;
      option.textContent = displayLabel(kind);
      if (typeof select.appendChild === 'function') select.appendChild(option);
      else select.append?.(option);
      existing.add(kind);
      changed = true;
    }
    if (previousValue && existing.has(previousValue)) select.value = previousValue;
    if (changed) status.pickerRefreshes += 1;
    status.pickerMissing = missingPickerKinds();
    return status.pickerMissing.length === 0;
  }

  function requestGameplayCreatureExtensions() {
    if (scriptRequested || !global.CreatureGeneticsRender?.SPECIES) return false;
    scriptRequested = true;
    const script = global.document?.createElement?.('script'); // Loads the same runtime species-extension module gameplay relies on.
    if (!script) {
      status.state = 'script-element-unavailable';
      return false;
    }
    const sourceUrl = new URL('../../js/creature-genetics.js?v=20260915-rig-picker-v1', global.location.href).href; // Commit-relative URL keeps RawGitHack test builds on one repository revision.
    script.src = sourceUrl;
    script.async = false;
    script.dataset ||= {};
    script.dataset.hobunjiAnimationAuthorCreatureRegistry = 'v1';
    script.onload = () => {
      status.loads += 1;
      status.lastError = null;
      syncNow('creature-genetics-loaded');
    };
    script.onerror = () => {
      status.state = 'creature-genetics-load-failed';
      status.lastError = sourceUrl;
    };
    const parent = global.document.head || global.document.documentElement; // Uses a normal document script parent in both desktop and mobile browsers.
    if (!parent?.appendChild) {
      status.state = 'script-parent-unavailable';
      return false;
    }
    parent.appendChild(script);
    return true;
  }

  function syncNow(reason = 'poll') {
    status.attempts += 1;
    status.lastReason = reason;
    status.rendererMissing = missingRendererKinds();
    if (status.rendererMissing.length) {
      status.state = global.CreatureGeneticsRender?.SPECIES ? 'loading-gameplay-creature-extensions' : 'waiting-for-renderer';
      requestGameplayCreatureExtensions();
      return false;
    }
    normalizeExtendedSpeciesAssetUrls();
    const pickerClean = refreshPickerFromRenderer(); // Adds any species installed after the author's original picker-population pass.
    status.rendererMissing = [];
    status.pickerMissing = missingPickerKinds();
    status.state = pickerClean ? 'clean' : 'waiting-for-picker';
    if (pickerClean && intervalId != null) {
      global.clearInterval?.(intervalId);
      intervalId = null;
    }
    return pickerClean;
  }

  if (typeof global.setInterval === 'function') intervalId = global.setInterval(() => syncNow('poll'), 50);
  syncNow('install');
  global.HobunjiAnimationAuthorCreatureRegistrySync = Object.freeze({
    syncNow: () => syncNow('manual-debug'),
    missingRendererKinds,
    missingPickerKinds,
    getStatus: () => ({ ...status, rendererMissing: [...(status.rendererMissing || [])], pickerMissing: [...(status.pickerMissing || [])] }),
  });
})(window);

// Rig Coordinates predates Puktuk and Vorg-ass. If an older embedded editor
// snapshot omits them, restore the repository's same-kind canonical profiles
// through the editor's own import path. Analogue seeding is retained only as
// a compatibility fallback for older repository revisions without final data.
(function installAnimationAuthorNewCreatureRigSync(global) {
  'use strict';
  if (typeof location === 'undefined' || !/\/tools\/animation-author\//.test(location.pathname || '')) return;

  const RIG_SCHEMA = 'hobunji.attachment-rig-profiles.v10'; // Used by the existing Rig import bridge when it receives the augmented profile library.
  const SEED_SOURCES = Object.freeze({ puktuk: 'gar-wolf', 'voorg-ass': 'uumkaoii' }); // Used only to give the two new species editable first-pass coordinates.
  const STATUS_KEY = 'animationAuthorNewCreatureRigSync'; // Used by the mobile-safe debug status exposed below.
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const statusRoot = global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
  const status = statusRoot[STATUS_KEY] ||= { state: 'waiting-for-rig', repairs: 0, lastReason: null, missing: Object.keys(SEED_SOURCES) };
  let queuedTimer = null; // Used to serialize this import after the older creature and shoulder repair bridges.

  function missingKinds(live) {
    return Object.keys(SEED_SOURCES).filter(kind => !live?.creatures?.[kind]);
  }

  function canonicalProfile(kind) {
    return global.HOBUNJI_ATTACHMENT_RIG_MASTER?.profiles?.creatures?.[kind]
      || global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[kind]
      || null;
  }

  function sourceProfile(live, sourceKind) {
    return live?.creatures?.[sourceKind]
      || global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[sourceKind]
      || global.HOBUNJI_ATTACHMENT_RIG_MASTER?.profiles?.creatures?.[sourceKind]
      || null;
  }

  function seededProfile(kind, sourceKind, live) {
    const source = sourceProfile(live, sourceKind);
    if (!source) return null;
    const profile = clone(source);
    profile.kind = kind;
    delete profile.chatheadFrame;
    profile.authoringSeed = { sourceKind, version: 1, status: 'needs-authoring' };
    profile.saddleRule = { ...(profile.saddleRule || {}), source: `rig-coordinates-seed:${sourceKind}`, authoredFixed: false, recalculateOnPreview: false };
    profile.shoulderGripRule = { ...(profile.shoulderGripRule || {}), source: `rig-coordinates-seed:${sourceKind}`, authoredFixed: false, recalculateOnPreview: false };
    profile.sizeScaleRule = { ...(profile.sizeScaleRule || {}), source: `rig-coordinates-seed:${sourceKind}`, authoredFixed: false };
    return profile;
  }

  function attachImportFile(input, file) {
    try {
      if (typeof global.DataTransfer === 'function') {
        const transfer = new global.DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        return true;
      }
    } catch (_) {}
    try {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      return true;
    } catch (_) { return false; }
  }

  function repairNow(reason = 'manual-debug') {
    queuedTimer = null;
    const api = global.MultiAvatarAnimationAuthor;
    const input = global.document?.getElementById('maaImportInput');
    if (!api?.getAttachmentRigProfiles || !input || typeof global.File !== 'function') {
      status.state = 'waiting-for-rig';
      status.lastReason = reason;
      return false;
    }

    const live = api.getAttachmentRigProfiles();
    const missing = missingKinds(live);
    status.missing = [...missing];
    status.lastReason = reason;
    if (!missing.length) {
      status.state = 'clean';
      return false;
    }

    const repaired = clone(live || {});
    repaired.characters ||= {};
    repaired.creatures ||= {};
    const unresolved = [];
    for (const kind of missing) {
      const canonical = canonicalProfile(kind); // September 15 authoring is authoritative once the repository master contains it.
      const replacement = canonical ? clone(canonical) : seededProfile(kind, SEED_SOURCES[kind], repaired);
      if (replacement) repaired.creatures[kind] = replacement;
      else unresolved.push(kind);
    }
    if (unresolved.length) {
      status.state = 'canonical-or-seed-source-missing';
      status.missing = unresolved;
      status.lastReason = `${reason}: ${unresolved.join(', ')}`;
      return false;
    }

    const guard = global.HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD;
    const payload = guard?.reconcileRigExport
      ? guard.reconcileRigExport({ schema: RIG_SCHEMA, profiles: repaired })
      : { schema: RIG_SCHEMA, profiles: repaired };
    const file = new global.File([JSON.stringify(payload)], 'hobunji_attachment_rig_new_creature_sync.json', { type: 'application/json' });
    if (!attachImportFile(input, file)) {
      status.state = 'file-bridge-unavailable';
      return false;
    }

    status.state = 'repair-dispatched';
    status.repairs += 1;
    status.missing = [];
    status.lastReason = `${reason}: ${missing.join(', ')}`;
    input.dispatchEvent(new Event('change', { bubbles: false }));
    return true;
  }

  function queueRepair(reason, delayMs = 900) {
    if (queuedTimer != null) global.clearTimeout(queuedTimer);
    queuedTimer = global.setTimeout(() => repairNow(reason), delayMs);
  }

  global.document?.addEventListener('click', event => {
    const target = event.target?.closest?.('#maaRigTab, #maaNewBtn');
    if (!target) return;
    if (target.id === 'maaRigTab' || (target.id === 'maaNewBtn' && global.document.body?.dataset?.animationAuthorMode === 'rig')) {
      queueRepair(target.id === 'maaRigTab' ? 'rig-tab-open' : 'rig-new-reset');
    }
  }, true);

  global.HobunjiAnimationAuthorNewCreatureRigSync = Object.freeze({
    repairNow: () => repairNow('manual-debug'),
    missingKinds: () => missingKinds(global.MultiAvatarAnimationAuthor?.getAttachmentRigProfiles?.() || {}),
    getStatus: () => ({ ...status, missing: [...(status.missing || [])] }),
  });
})(window);
