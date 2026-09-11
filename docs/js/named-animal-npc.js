// Named animal NPC bridge — lets ordinary NPC database records use a creature
// species (Grehlr, Drenkirra, etc.) as their authoritative species instead of
// pretending to be a humanoid portrait species. Reuses the game's animal
// renderer for runtime world models and exposes the existing genotype/pattern
// workflow inside Character Studio for named animal NPCs.
(() => {
  'use strict';

  const INSTALL_INTERVAL_MS = 250;
  const STUDIO_PATH_RE = /\/tools\/character-studio\//;
  const CREATURE_RENDER_SCRIPT = 'js/creature-genetics-render.js';
  const CREATURE_MASKS_PATH = 'config/creature-base-masks.json';
  const debugState = {
    profileBridge: false,
    portraitBridge: false,
    planeBridge: false,
    studioPicker: false,
    studioAppearance: false,
    lastCreatureKind: null,
    lastStudioNpcId: null,
    lastStudioSpecies: null,
    lastError: null,
  };
  let installTimer = null;
  let studioSyncing = false;
  let studioAppearanceGeneration = 0;
  let creatureRendererPromise = null;
  let creatureMasksPromise = null;
  const imagePromiseByUrl = new Map();
  const watchedGlobalAssignments = new Set();

  function registry() {
    return window.HobunjiNpcSpeciesRegistry || null;
  }

  function normalizeSpeciesId(value) {
    return registry()?.normalizeSpeciesId?.(value)
      || String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function creatureKindFrom(value) {
    const normalized = normalizeSpeciesId(value);
    if (!normalized) return null;
    return registry()?.isCreatureSpecies?.(normalized) ? normalized : null;
  }

  function explicitCreatureKind(source) {
    const explicit = source?.creatureKind
      || source?.chatheadCreatureKind
      || source?.animalKind
      || (source?.avatarType === 'animal' ? source?.speciesId : null);
    return explicit ? normalizeSpeciesId(explicit) : null;
  }

  function creatureKindForNpcLike(npcLike) {
    const appearance = npcLike?.appearance || {};
    return explicitCreatureKind(npcLike)
      || explicitCreatureKind(appearance)
      || creatureKindFrom(npcLike?.species)
      || creatureKindFrom(appearance?.speciesId)
      || null;
  }

  function creatureKindForProfile(profile, options = {}) {
    const npcRecord = options?.npcRecord || profile?.npcRecord || null;
    return explicitCreatureKind(profile)
      || creatureKindForNpcLike(npcRecord)
      || creatureKindForNpcLike(profile?.appearance ? profile : null)
      || creatureKindFrom(options?.speciesId)
      || null;
  }

  function creatureGenotypeFor(profile, options = {}) {
    return options?.creatureGenotype
      || options?.npcRecord?.creatureGenotype
      || options?.npcRecord?.appearance?.creatureGenotype
      || profile?.creatureGenotype
      || profile?.appearance?.creatureGenotype
      || null;
  }

  function makeCreatureProfile(npcExport, kind) {
    const appearance = { ...(npcExport?.appearance || {}) };
    appearance.speciesId = kind;
    appearance.creatureKind = kind;
    appearance.avatarType = 'animal';
    const gender = String(npcExport?.gender || appearance.gender || 'unknown');
    const genotype = npcExport?.creatureGenotype || appearance.creatureGenotype || null;
    return {
      name: npcExport?.name || npcExport?.id || kind,
      species: kind,
      creatureKind: kind,
      chatheadCreatureKind: kind,
      creatureGenotype: genotype,
      npcRecord: npcExport || null,
      appearance,
      fighter: { id: `creature:${kind}`, speciesId: kind, gender, creatureKind: kind },
    };
  }

  function installProfileBridge() {
    const preview = window.NpcAvatarPreview;
    const current = preview?.buildProfileFromNpcExport;
    if (typeof current !== 'function') return false;
    if (current.__hobunjiNamedAnimalNpcProfileBridge) {
      debugState.profileBridge = true;
      return true;
    }
    const wrapped = function buildProfileWithNamedAnimalNpc(npcExport) {
      const kind = creatureKindForNpcLike(npcExport);
      if (kind) {
        debugState.lastCreatureKind = kind;
        return makeCreatureProfile(npcExport, kind);
      }
      return current.call(this, npcExport);
    };
    wrapped.__hobunjiNamedAnimalNpcProfileBridge = true;
    wrapped.__hobunjiNamedAnimalNpcOriginal = current;
    preview.buildProfileFromNpcExport = wrapped;
    debugState.profileBridge = true;
    return true;
  }

  function loadImage(url) {
    if (!url || typeof Image === 'undefined') return Promise.resolve(null);
    if (imagePromiseByUrl.has(url)) return imagePromiseByUrl.get(url);
    const promise = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    imagePromiseByUrl.set(url, promise);
    return promise;
  }

  function fitImageToCanvas(canvas, source) {
    const width = Number(canvas?.width) || 200;
    const height = Number(canvas?.height) || width;
    const sourceWidth = Number(source?.width || source?.naturalWidth) || 0;
    const sourceHeight = Number(source?.height || source?.naturalHeight) || 0;
    const context = canvas?.getContext?.('2d');
    if (!context || !sourceWidth || !sourceHeight) return false;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, (width - drawWidth) / 2, height - drawHeight, drawWidth, drawHeight);
    return true;
  }

  function isCharacterStudio() {
    return typeof location !== 'undefined' && STUDIO_PATH_RE.test(location.pathname || '');
  }

  async function sourceForCreature(kind, profile, options = {}) {
    const genotype = creatureGenotypeFor(profile, options);
    const renderer = window.CreatureGeneticsRender;
    if (renderer?.composeFrame && !isCharacterStudio()) {
      try {
        const composed = await renderer.composeFrame(kind, options.frame || 'idle', genotype, options.blinkShut === true);
        if (composed) return composed;
      } catch (error) {
        debugState.lastError = `composeFrame(${kind}) failed: ${error?.message || error}`;
      }
    }
    const creature = registry()?.creatureFor?.(kind);
    const spritePath = creature?.sprites?.idle;
    const spriteUrl = registry()?.assetUrl?.(spritePath) || spritePath;
    return loadImage(spriteUrl);
  }

  async function renderCreatureProfile(canvas, profile, options = {}) {
    const kind = creatureKindForProfile(profile, options);
    if (!kind) return false;
    debugState.lastCreatureKind = kind;
    if (window.AnimalChatheadFrame?.renderCreatureChathead
      && (canvas?.id === 'npcPortraitCanvas' || String(options?.seatId || '').startsWith('ambient:'))) {
      const renderedHead = await window.AnimalChatheadFrame.renderCreatureChathead(canvas, kind, {
        ...options,
        profile,
        genotype: creatureGenotypeFor(profile, options),
      });
      if (renderedHead) return true;
    }
    const source = isCharacterStudio()
      ? await composeCreatureStudioFrame(kind, creatureGenotypeFor(profile, options))
      : await sourceForCreature(kind, profile, options);
    return fitImageToCanvas(canvas, source);
  }

  function installPortraitBridge() {
    let installed = false;
    const preview = window.NpcAvatarPreview;
    const previewRender = preview?.renderProfileToCanvas;
    if (typeof previewRender === 'function' && !previewRender.__hobunjiNamedAnimalNpcPortraitBridge) {
      const wrappedPreviewRender = async function renderProfileToCanvasWithNamedAnimal(targetCanvas, profile, options = {}) {
        if (await renderCreatureProfile(targetCanvas, profile, options)) return targetCanvas;
        return previewRender.call(this, targetCanvas, profile, options);
      };
      wrappedPreviewRender.__hobunjiNamedAnimalNpcPortraitBridge = true;
      wrappedPreviewRender.__hobunjiNamedAnimalNpcOriginal = previewRender;
      preview.renderProfileToCanvas = wrappedPreviewRender;
      installed = true;
    }

    const directRender = window.renderProfile;
    if (typeof directRender === 'function' && !directRender.__hobunjiNamedAnimalNpcPortraitBridge) {
      const wrappedDirectRender = async function renderProfileWithNamedAnimal(targetCanvas, profile, options = {}) {
        if (await renderCreatureProfile(targetCanvas, profile, options)) return targetCanvas;
        return directRender.call(this, targetCanvas, profile, options);
      };
      wrappedDirectRender.__hobunjiNamedAnimalNpcPortraitBridge = true;
      wrappedDirectRender.__hobunjiNamedAnimalNpcOriginal = directRender;
      window.renderProfile = wrappedDirectRender;
      if (window.renderPortraitProfile === directRender) window.renderPortraitProfile = wrappedDirectRender;
      installed = true;
    }
    if (installed || previewRender?.__hobunjiNamedAnimalNpcPortraitBridge || directRender?.__hobunjiNamedAnimalNpcPortraitBridge) {
      debugState.portraitBridge = true;
      return true;
    }
    return false;
  }

  function installPlaneBridge() {
    const api = window.PNGPlaneAvatar;
    const currentBuild = api?.buildSinglePlaneAvatarModel;
    if (typeof currentBuild !== 'function' || typeof api?.buildAnimalPlaneAvatarModel !== 'function') return false;
    if (!currentBuild.__hobunjiNamedAnimalNpcPlaneBridge) {
      const wrappedBuild = function buildNamedAnimalNpcPlane(THREE, sourceCanvas, options = {}) {
        const kind = creatureKindForProfile(options?.profile, options);
        if (!kind) return currentBuild.call(this, THREE, sourceCanvas, options);
        const creature = registry()?.creatureFor?.(kind);
        const spritePath = creature?.sprites?.idle;
        const spriteUrl = registry()?.assetUrl?.(spritePath) || spritePath;
        if (!spriteUrl) return currentBuild.call(this, THREE, sourceCanvas, options);
        const modelWidth = Number(creature?.modelWidth) > 0 ? Number(creature.modelWidth) : Number(options.modelWidth) || 1;
        const spriteAspect = Number(creature?.spriteAspect) > 0 ? Number(creature.spriteAspect) : 1;
        const modelHeight = modelWidth * spriteAspect;
        const genotype = creatureGenotypeFor(options?.profile, options);
        const avatarRef = api.buildAnimalPlaneAvatarModel(THREE, spriteUrl, {
          modelWidth,
          modelHeight,
          name: options.name || `named_animal_npc_${kind}`,
          creatureId: kind,
          genotype,
          alphaTest: options.alphaTest,
        });
        const root = avatarRef?.group;
        if (!root) return currentBuild.call(this, THREE, sourceCanvas, options);
        root.userData = {
          ...(root.userData || {}),
          ...(options.userData || {}),
          namedAnimalNpc: true,
          creatureKind: kind,
          animalAvatarRef: avatarRef,
          portraitModelWidth: modelWidth,
          portraitModelHeight: modelHeight,
          portraitVerticalPlacementRatio: 0.5,
          portraitScaleMultiplier: 1,
          neckRig: { available: false },
        };
        debugState.lastCreatureKind = kind;
        return root;
      };
      wrappedBuild.__hobunjiNamedAnimalNpcPlaneBridge = true;
      wrappedBuild.__hobunjiNamedAnimalNpcOriginal = currentBuild;
      api.buildSinglePlaneAvatarModel = wrappedBuild;
    }

    const currentDispose = api.disposeAvatarModel;
    if (typeof currentDispose === 'function' && !currentDispose.__hobunjiNamedAnimalNpcPlaneBridge) {
      const wrappedDispose = function disposeNamedAnimalNpc(root) {
        const avatarRef = root?.userData?.namedAnimalNpc ? root.userData.animalAvatarRef : null;
        if (avatarRef?.dispose) {
          root.parent?.remove?.(root);
          avatarRef.dispose();
          return;
        }
        return currentDispose.call(this, root);
      };
      wrappedDispose.__hobunjiNamedAnimalNpcPlaneBridge = true;
      wrappedDispose.__hobunjiNamedAnimalNpcOriginal = currentDispose;
      api.disposeAvatarModel = wrappedDispose;
    }
    debugState.planeBridge = true;
    return true;
  }

  function safeJson(text, fallback = {}) {
    try { return JSON.parse(String(text || '')) || fallback; } catch { return fallback; }
  }

  function setStudioAnimalAppearance(kind) {
    const field = document.getElementById('appearanceJson');
    if (!field) return;
    const appearance = { ...safeJson(field.value, {}) };
    appearance.speciesId = kind;
    appearance.creatureKind = kind;
    appearance.avatarType = 'animal';
    const next = JSON.stringify(appearance, null, 2);
    if (field.value !== next) {
      field.value = next;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function setStudioHumanoidAppearance(speciesId) {
    const field = document.getElementById('appearanceJson');
    if (!field || !speciesId) return;
    const appearance = { ...safeJson(field.value, {}) };
    if (appearance.speciesId === speciesId && !appearance.creatureKind && appearance.avatarType !== 'animal') return;
    appearance.speciesId = speciesId;
    delete appearance.creatureKind;
    delete appearance.creatureGenotype;
    if (appearance.avatarType === 'animal') delete appearance.avatarType;
    field.value = JSON.stringify(appearance, null, 2);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function normalizeHexColor(value, fallback = '#ffffff') {
    const raw = String(value || '').trim();
    const short = /^#?([0-9a-f]{3})$/i.exec(raw);
    if (short) return '#' + short[1].split('').map(ch => ch + ch).join('').toLowerCase();
    const full = /^#?([0-9a-f]{6})$/i.exec(raw);
    if (full) return '#' + full[1].toLowerCase();
    return fallback;
  }

  function titleCasePattern(id) {
    return String(id || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function creatureSpeciesConfig(kind) {
    return window.CreatureGeneticsRender?.SPECIES?.[kind] || null;
  }

  function defaultCreatureGenotype(kind) {
    const spec = creatureSpeciesConfig(kind);
    const genotype = {};
    if (kind !== 'uumkaoii') genotype.base = { color: '#ffffff' };
    for (const patternId of spec?.patterns || []) {
      if (kind === 'uumkaoii') genotype[patternId] = { color: '#ffffff', copies: 2 };
      else genotype[patternId] = { color: '#ffffff', enabled: false, copies: 1 };
    }
    return genotype;
  }

  function normalizeCreatureGenotype(kind, source) {
    const fallback = defaultCreatureGenotype(kind);
    const spec = creatureSpeciesConfig(kind);
    const result = {};
    if (fallback.base) result.base = { color: normalizeHexColor(source?.base?.color, fallback.base.color) };
    for (const patternId of spec?.patterns || []) {
      const fallbackLayer = fallback[patternId] || { color: '#ffffff', enabled: false, copies: 1 };
      const sourceLayer = source?.[patternId] || {};
      result[patternId] = {
        color: normalizeHexColor(sourceLayer.color, fallbackLayer.color),
        copies: Number.isFinite(Number(sourceLayer.copies)) ? Math.max(0, Number(sourceLayer.copies)) : fallbackLayer.copies,
      };
      if (Object.prototype.hasOwnProperty.call(fallbackLayer, 'enabled')) {
        result[patternId].enabled = sourceLayer.enabled === undefined ? fallbackLayer.enabled : sourceLayer.enabled !== false;
      }
    }
    return result;
  }

  function currentStudioCreatureGenotype(kind) {
    const appearance = safeJson(document.getElementById('appearanceJson')?.value, {});
    return normalizeCreatureGenotype(kind, appearance.creatureGenotype);
  }

  function saveStudioCreatureGenotype(kind, genotype) {
    const field = document.getElementById('appearanceJson');
    if (!field) return;
    const appearance = { ...safeJson(field.value, {}) };
    appearance.speciesId = kind;
    appearance.creatureKind = kind;
    appearance.avatarType = 'animal';
    appearance.creatureGenotype = normalizeCreatureGenotype(kind, genotype);
    field.value = JSON.stringify(appearance, null, 2);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function ensureCreatureRendererMetadata() {
    if (window.CreatureGeneticsRender?.SPECIES) return Promise.resolve(window.CreatureGeneticsRender);
    if (creatureRendererPromise) return creatureRendererPromise;
    creatureRendererPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-hobunji-creature-genetics-render="1"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.CreatureGeneticsRender || null), { once: true });
        existing.addEventListener('error', () => reject(new Error('Creature genetics renderer failed to load.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = registry()?.assetUrl?.(CREATURE_RENDER_SCRIPT) || '../../js/creature-genetics-render.js';
      script.async = false;
      script.dataset.hobunjiCreatureGeneticsRender = '1';
      script.onload = () => resolve(window.CreatureGeneticsRender || null);
      script.onerror = () => reject(new Error('Creature genetics renderer failed to load.'));
      (document.head || document.documentElement).appendChild(script);
    }).catch(error => {
      creatureRendererPromise = null;
      debugState.lastError = error.message;
      throw error;
    });
    return creatureRendererPromise;
  }

  function decodeMaskRle(encoded) {
    if (!encoded || encoded.encoding !== 'selected-pixel-index-runs-v1'
      || !Number.isInteger(encoded.width) || !Number.isInteger(encoded.height) || !Array.isArray(encoded.runs)) return null;
    const data = new Uint8Array(encoded.width * encoded.height);
    for (let i = 0; i + 1 < encoded.runs.length; i += 2) {
      const start = Number(encoded.runs[i]);
      const length = Number(encoded.runs[i + 1]);
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > data.length) continue;
      data.fill(1, start, start + length);
    }
    return { width: encoded.width, height: encoded.height, data };
  }

  async function loadCreatureMasks() {
    if (creatureMasksPromise) return creatureMasksPromise;
    const url = registry()?.assetUrl?.(CREATURE_MASKS_PATH) || '../../config/creature-base-masks.json';
    creatureMasksPromise = fetch(url).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }).then(raw => {
      const out = {};
      for (const [kind, frames] of Object.entries(raw || {})) {
        out[kind] = {};
        for (const [frame, encoded] of Object.entries(frames || {})) out[kind][frame] = decodeMaskRle(encoded);
      }
      return out;
    }).catch(error => {
      debugState.lastError = `creature masks failed: ${error.message}`;
      return {};
    });
    return creatureMasksPromise;
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  async function recolorImageAbsolute(url, color, mask = null) {
    const renderer = await ensureCreatureRendererMetadata();
    const image = await loadImage(url);
    if (!renderer || !image) return image;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = makeCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    const predicate = mask && mask.width === width && mask.height === height
      ? index => !!mask.data[index / 4]
      : null;
    renderer.recolorPixels(imageData.data, renderer.hexToRgb(color), predicate);
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  function creaturePatternPath(kind, patternId, frame = 'idle') {
    const spec = creatureSpeciesConfig(kind);
    if (!spec) return '';
    if (spec.singleFrame) return `assets/creaturesprites/patterns/${spec.prefix}_${patternId}.png`;
    return `assets/creaturesprites/patterns/${spec.prefix}_${patternId}_${frame}.png`;
  }

  async function composeCreatureStudioFrame(kind, genotypeSource) {
    if (!isCharacterStudio()) return null;
    await ensureCreatureRendererMetadata();
    const spec = creatureSpeciesConfig(kind);
    if (!spec) return null;
    const genotype = normalizeCreatureGenotype(kind, genotypeSource);
    const frame = 'idle';
    const masks = await loadCreatureMasks();
    const storedBaseColor = genotype?.base?.color;
    const bodyStripes = genotype?.bodystripes;
    const bodyStripesSwap = kind === 'drenkirra' && storedBaseColor && bodyStripes?.enabled !== false && bodyStripes?.copies > 0 && bodyStripes?.color;
    const baseColor = bodyStripesSwap ? bodyStripes.color : storedBaseColor;
    const basePath = spec.base?.[frame] || spec.base?.idle;
    const baseUrl = registry()?.assetUrl?.(basePath) || basePath;
    const mask = masks?.[kind]?.[frame] || null;
    const baseSource = baseColor ? await recolorImageAbsolute(baseUrl, baseColor, mask) : await loadImage(baseUrl);
    if (!baseSource) return null;
    const width = baseSource.naturalWidth || baseSource.width;
    const height = baseSource.naturalHeight || baseSource.height;
    const canvas = makeCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(baseSource, 0, 0, width, height);
    for (const patternId of spec.patterns || []) {
      const layer = genotype?.[patternId];
      if (layer?.enabled === false || !(layer?.copies > 0) || !layer?.color) continue;
      const renderColor = bodyStripesSwap && patternId === 'bodystripes' ? storedBaseColor : layer.color;
      const patternPath = creaturePatternPath(kind, patternId, frame);
      const patternUrl = registry()?.assetUrl?.(patternPath) || patternPath;
      try {
        const recolored = await recolorImageAbsolute(patternUrl, renderColor);
        if (recolored) context.drawImage(recolored, 0, 0, width, height);
      } catch (error) {
        debugState.lastError = `pattern ${patternId} failed: ${error.message}`;
      }
    }
    if (spec.eyes?.open) {
      const eyeUrl = registry()?.assetUrl?.(spec.eyes.open) || spec.eyes.open;
      const eye = await loadImage(eyeUrl);
      if (eye) context.drawImage(eye, 0, 0, width, height);
    }
    return canvas;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function creatureLayerRow(layerId, label, color, enabled, optional) {
    return `<div data-creature-row="${escapeHtml(layerId)}" style="display:grid;grid-template-columns:${optional ? 'auto ' : ''}minmax(110px,1fr) 48px 108px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)">
      ${optional ? `<input type="checkbox" data-creature-enabled="${escapeHtml(layerId)}" ${enabled ? 'checked' : ''} aria-label="Enable ${escapeHtml(label)}">` : ''}
      <div><b>${escapeHtml(label)}</b>${optional ? '<div class="help">Species pattern layer</div>' : '<div class="help">Masked base recolor</div>'}</div>
      <input type="color" value="${escapeHtml(color)}" data-creature-color-picker="${escapeHtml(layerId)}" aria-label="${escapeHtml(label)} color" style="width:44px;height:34px;padding:2px">
      <input type="text" value="${escapeHtml(color)}" maxlength="7" spellcheck="false" autocapitalize="off" data-creature-color-text="${escapeHtml(layerId)}" aria-label="${escapeHtml(label)} hex color" style="font-family:monospace">
    </div>`;
  }

  function ensureStudioAppearancePanel() {
    const pane = document.getElementById('appearancePane');
    if (!pane) return null;
    let panel = document.getElementById('namedAnimalAppearancePanel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'namedAnimalAppearancePanel';
    panel.style.cssText = 'display:none;max-width:920px;margin:0 auto;padding:18px;box-sizing:border-box;overflow:auto;height:100%';
    panel.innerHTML = `
      <div class="card section" style="--sec:#f59e0b;--secBg:rgba(245,158,11,.10)">
        <div class="sectionTitle"><b>Animal Appearance</b><span class="sectionTag">creature genotype</span></div>
        <div class="help" style="margin-bottom:12px">Uses the same base-color and species-pattern genotype renderer as livestock and wild creatures. Colors accept the picker or direct #RRGGBB hex input.</div>
        <div style="display:grid;grid-template-columns:minmax(180px,320px) minmax(260px,1fr);gap:18px;align-items:start">
          <div>
            <canvas id="namedAnimalAppearanceCanvas" width="360" height="360" style="width:100%;aspect-ratio:1;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.12);border-radius:10px;image-rendering:pixelated"></canvas>
            <div class="help" id="namedAnimalAppearanceStatus" style="margin-top:8px">Loading creature appearance…</div>
          </div>
          <div>
            <div style="font-size:18px;font-weight:700" id="namedAnimalAppearanceSpecies">Animal</div>
            <div id="creatureBaseControl" style="margin-top:8px"></div>
            <div id="creaturePatternControls"></div>
          </div>
        </div>
      </div>`;
    pane.appendChild(panel);
    panel.addEventListener('input', event => {
      const kind = normalizeSpeciesId(document.getElementById('npcSpecies')?.value);
      if (!kind || !registry()?.isCreatureSpecies?.(kind)) return;
      const target = event.target;
      const genotype = currentStudioCreatureGenotype(kind);
      const enabledId = target?.dataset?.creatureEnabled;
      const pickerId = target?.dataset?.creatureColorPicker;
      const textId = target?.dataset?.creatureColorText;
      if (enabledId && genotype[enabledId]) {
        genotype[enabledId].enabled = !!target.checked;
        saveStudioCreatureGenotype(kind, genotype);
        renderStudioCreatureAppearance(kind);
        return;
      }
      const layerId = pickerId || textId;
      if (!layerId) return;
      const oldColor = layerId === 'base' ? genotype.base?.color : genotype[layerId]?.color;
      const normalized = normalizeHexColor(target.value, oldColor || '#ffffff');
      if (textId && !/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(target.value).trim())) return;
      if (layerId === 'base' && genotype.base) genotype.base.color = normalized;
      else if (genotype[layerId]) genotype[layerId].color = normalized;
      else return;
      const picker = panel.querySelector(`[data-creature-color-picker="${CSS.escape(layerId)}"]`);
      const text = panel.querySelector(`[data-creature-color-text="${CSS.escape(layerId)}"]`);
      if (picker) picker.value = normalized;
      if (text) text.value = normalized;
      saveStudioCreatureGenotype(kind, genotype);
      renderStudioCreatureAppearance(kind);
    });
    debugState.studioAppearance = true;
    return panel;
  }

  function setStudioAppearanceMode(isAnimal) {
    const pane = document.getElementById('appearancePane');
    const panel = ensureStudioAppearancePanel();
    const appearanceTab = document.getElementById('mainTabAppearance');
    const editAvatarButton = document.getElementById('editAvatarBtn');
    if (appearanceTab) {
      appearanceTab.disabled = false;
      appearanceTab.title = isAnimal ? 'Edit this animal NPC\'s base color and species patterns.' : '';
    }
    if (editAvatarButton) {
      editAvatarButton.disabled = false;
      editAvatarButton.title = isAnimal ? 'Edit this animal NPC\'s base color and species patterns.' : '';
    }
    if (!pane || !panel) return;
    for (const child of [...pane.children]) {
      if (child === panel) continue;
      if (isAnimal) {
        if (!Object.prototype.hasOwnProperty.call(child.dataset, 'namedAnimalPrevDisplay')) child.dataset.namedAnimalPrevDisplay = child.style.display || '';
        child.style.display = 'none';
      } else if (Object.prototype.hasOwnProperty.call(child.dataset, 'namedAnimalPrevDisplay')) {
        child.style.display = child.dataset.namedAnimalPrevDisplay;
        delete child.dataset.namedAnimalPrevDisplay;
      }
    }
    panel.style.display = isAnimal ? 'block' : 'none';
  }

  async function renderStudioCreatureAppearance(kind) {
    if (!isCharacterStudio()) return;
    const generation = ++studioAppearanceGeneration;
    const panel = ensureStudioAppearancePanel();
    const status = document.getElementById('namedAnimalAppearanceStatus');
    const speciesLabel = document.getElementById('namedAnimalAppearanceSpecies');
    const baseControl = document.getElementById('creatureBaseControl');
    const patternControls = document.getElementById('creaturePatternControls');
    const canvas = document.getElementById('namedAnimalAppearanceCanvas');
    if (!panel || !canvas || !baseControl || !patternControls) return;
    try {
      if (status) status.textContent = 'Loading creature appearance…';
      await ensureCreatureRendererMetadata();
      if (generation !== studioAppearanceGeneration) return;
      const spec = creatureSpeciesConfig(kind);
      const genotype = currentStudioCreatureGenotype(kind);
      const creature = registry()?.creatureFor?.(kind);
      if (speciesLabel) speciesLabel.textContent = creature?.label || titleCasePattern(kind);
      baseControl.innerHTML = genotype.base
        ? creatureLayerRow('base', 'Base color', genotype.base.color, true, false)
        : '<div class="help" style="padding:8px 0">This species uses permanent region layers instead of a single base-color mask.</div>';
      patternControls.innerHTML = (spec?.patterns || []).map(patternId => {
        const layer = genotype[patternId];
        const optional = Object.prototype.hasOwnProperty.call(layer || {}, 'enabled');
        return creatureLayerRow(patternId, titleCasePattern(patternId), layer?.color || '#ffffff', layer?.enabled !== false, optional);
      }).join('');
      saveStudioCreatureGenotype(kind, genotype);
      const source = await composeCreatureStudioFrame(kind, genotype);
      if (generation !== studioAppearanceGeneration) return;
      fitImageToCanvas(canvas, source);
      if (status) status.textContent = `${creature?.label || kind} · ${(spec?.patterns || []).length} species pattern${(spec?.patterns || []).length === 1 ? '' : 's'} · saved live to this NPC`;
    } catch (error) {
      debugState.lastError = `animal appearance failed: ${error?.message || error}`;
      if (status) status.textContent = `Animal appearance failed: ${error?.message || error}`;
    }
  }

  function refreshStudioDatabaseView() {
    const redrawField = document.getElementById('npcName');
    if (!redrawField || typeof Event === 'undefined') return;
    redrawField.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function refreshStudioSpeciesOptions() {
    const input = document.getElementById('npcSpecies');
    const list = document.getElementById('npcSpeciesChoices');
    if (!input || !list) return false;
    const creatureOptions = (registry()?.listCreatures?.() || []).map(creature => ({
      id: normalizeSpeciesId(creature.id),
      label: `Animal · ${creature.label || creature.id}`,
    }));
    const humanoidMap = new Map();
    for (const fighter of window.getPortraitFighters?.() || []) {
      const id = normalizeSpeciesId(fighter?.speciesId);
      if (id && !humanoidMap.has(id)) humanoidMap.set(id, fighter?.speciesLabel || fighter?.label || id);
    }
    const humanoidOptions = [...humanoidMap.entries()].map(([id, label]) => ({ id, label: `Person · ${label}` }));
    list.innerHTML = [...humanoidOptions, ...creatureOptions]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(option => `<option value="${option.id}" label="${String(option.label).replace(/"/g, '&quot;')}"></option>`)
      .join('');
    return true;
  }

  function syncStudioSpecies(options = {}) {
    if (studioSyncing) return;
    const input = document.getElementById('npcSpecies');
    const npcIdField = document.getElementById('npcId');
    if (!input || !npcIdField) return;
    studioSyncing = true;
    try {
      const npcId = String(npcIdField.value || '').trim();
      const reviewed = registry()?.overrideForNpc?.(npcId);
      if (reviewed?.species && normalizeSpeciesId(input.value) !== normalizeSpeciesId(reviewed.species)) {
        input.value = normalizeSpeciesId(reviewed.species);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const speciesId = normalizeSpeciesId(input.value);
      const isAnimal = !!(registry()?.isCreatureSpecies?.(speciesId) || reviewed?.kind === 'animal');
      if (isAnimal && speciesId) setStudioAnimalAppearance(speciesId);
      else if (speciesId && options.fromInput === true) setStudioHumanoidAppearance(speciesId);
      setStudioAppearanceMode(isAnimal);
      if (isAnimal && speciesId) renderStudioCreatureAppearance(speciesId);
      debugState.lastStudioNpcId = npcId;
      debugState.lastStudioSpecies = speciesId;
    } catch (error) {
      debugState.lastError = `studio sync failed: ${error?.message || error}`;
    } finally {
      studioSyncing = false;
    }
  }

  function installStudioPicker() {
    if (!isCharacterStudio()) return false;
    const input = document.getElementById('npcSpecies');
    if (!input) return false;
    ensureStudioAppearancePanel();
    if (!document.getElementById('npcSpeciesChoices')) {
      const list = document.createElement('datalist');
      list.id = 'npcSpeciesChoices';
      input.setAttribute('list', list.id);
      input.parentElement?.appendChild(list);
      const help = document.createElement('div');
      help.className = 'help';
      help.id = 'npcSpeciesHelp';
      help.textContent = 'Species can be a person or any creature from the creature bestiary. Animal NPCs use the Appearance tab for base color, species patterns, and direct hex color input.';
      input.parentElement?.appendChild(help);
      input.addEventListener('input', () => queueMicrotask(() => syncStudioSpecies({ fromInput: true })));
      const previewMeta = document.getElementById('previewMeta');
      if (previewMeta && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => queueMicrotask(() => syncStudioSpecies()));
        observer.observe(previewMeta, { childList: true, characterData: true, subtree: true });
      }
      const appearanceTab = document.getElementById('mainTabAppearance');
      appearanceTab?.addEventListener('click', () => queueMicrotask(() => syncStudioSpecies()));
    }
    registry()?.ready?.then(() => {
      refreshStudioSpeciesOptions();
      syncStudioSpecies();
      queueMicrotask(refreshStudioDatabaseView);
    }).catch(error => { debugState.lastError = `species registry failed: ${error?.message || error}`; });
    setTimeout(() => { refreshStudioSpeciesOptions(); syncStudioSpecies(); }, 0);
    setTimeout(refreshStudioSpeciesOptions, 1000);
    debugState.studioPicker = true;
    return true;
  }

  function watchGlobalAssignment(name) {
    if (watchedGlobalAssignments.has(name)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && descriptor.configurable === false) return;
    let value = window[name];
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return value; },
      set(next) {
        value = next;
        installAll();
      },
    });
    watchedGlobalAssignments.add(name);
  }

  function installAll() {
    try {
      installProfileBridge();
      installPortraitBridge();
      installPlaneBridge();
      installStudioPicker();
      if (debugState.profileBridge && debugState.portraitBridge && debugState.planeBridge
        && (!isCharacterStudio() || debugState.studioPicker)) {
        if (installTimer) clearInterval(installTimer);
        installTimer = null;
      }
    } catch (error) {
      debugState.lastError = String(error?.stack || error?.message || error);
      window.__farmLog?.(`[named-animal-npc] ${debugState.lastError}`, 'warn');
    }
  }

  window.NamedAnimalNpc = {
    creatureKindForNpcLike,
    creatureKindForProfile,
    makeCreatureProfile,
    renderCreatureProfile,
    normalizeCreatureGenotype,
    composeCreatureStudioFrame,
    installAll,
    debugSnapshot: () => ({ ...debugState }),
  };
  window.__namedAnimalNpcDebug = debugState;
  watchGlobalAssignment('NpcAvatarPreview');
  watchGlobalAssignment('PNGPlaneAvatar');
  watchGlobalAssignment('renderProfile');
  installAll();
  installTimer = setInterval(installAll, INSTALL_INTERVAL_MS);
})();
