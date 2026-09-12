// Generalized named-animal NPC bridge.
// NPC identity uses npc.species; Character Studio authoring is supplied by the
// native character-studio-animal-appearance extension loaded by repo-picker.js.
(() => {
  'use strict';

  const INSTALL_INTERVAL_MS = 250;
  const STUDIO_PATH_RE = /\/tools\/character-studio\//;
  const MODULE_SCRIPT_URL = typeof document !== 'undefined' ? (document.currentScript?.src || '') : '';
  const debugState = {
    profileBridge: false,
    portraitBridge: false,
    planeBridge: false,
    studioPicker: false,
    nativeStudioAppearance: false,
    lastCreatureKind: null,
    lastStudioNpcId: null,
    lastStudioSpecies: null,
    lastError: null,
  };
  const watchedGlobalAssignments = new Set();
  const imagePromiseByUrl = new Map();
  let installTimer = null;
  let studioSyncing = false;

  function registry() { return window.HobunjiNpcSpeciesRegistry || null; }
  function normalizeSpeciesId(value) {
    return registry()?.normalizeSpeciesId?.(value)
      || String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }
  function isCharacterStudio() {
    return typeof location !== 'undefined' && STUDIO_PATH_RE.test(location.pathname || '');
  }
  function normalizeOpacity(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 1;
  }
  function normalizeHex(value) {
    const match = String(value || '').trim().match(/^#?([0-9a-f]{6})$/i);
    return match ? `#${match[1].toUpperCase()}` : null;
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
    return explicitCreatureKind(profile)
      || creatureKindForNpcLike(options?.npcRecord || profile?.npcRecord)
      || creatureKindForNpcLike(profile?.appearance ? profile : null)
      || creatureKindFrom(options?.speciesId)
      || null;
  }
  function creatureGenotypeFor(profile, options = {}) {
    return options?.animalGenotype
      || options?.creatureGenotype
      || options?.npcRecord?.animalGenotype
      || options?.npcRecord?.appearance?.animalGenotype
      || options?.npcRecord?.creatureGenotype
      || options?.npcRecord?.appearance?.creatureGenotype
      || profile?.animalGenotype
      || profile?.appearance?.animalGenotype
      || profile?.creatureGenotype
      || profile?.appearance?.creatureGenotype
      || null;
  }
  function appearanceFor(profile, options = {}) {
    return options?.npcRecord?.appearance || profile?.appearance || profile?.npcRecord?.appearance || {};
  }
  function effectiveGenotype(profile, options = {}) {
    const source = creatureGenotypeFor(profile, options);
    const genotype = source && typeof source === 'object' ? JSON.parse(JSON.stringify(source)) : null;
    if (!genotype) return null;
    const overrides = appearanceFor(profile, options)?.creatureColorOverrides || {};
    for (const [layerId, rawColor] of Object.entries(overrides)) {
      const color = normalizeHex(rawColor);
      if (!color || !genotype[layerId] || typeof genotype[layerId] !== 'object') continue;
      genotype[layerId].color = color;
    }
    return genotype;
  }

  function makeCreatureProfile(npcExport, kind) {
    const appearance = { ...(npcExport?.appearance || {}) };
    appearance.speciesId = kind;
    appearance.creatureKind = kind;
    appearance.avatarType = 'animal';
    const genotype = npcExport?.animalGenotype
      || npcExport?.creatureGenotype
      || appearance.animalGenotype
      || appearance.creatureGenotype
      || null;
    const gender = String(npcExport?.gender || appearance.gender || 'unknown');
    return {
      name: npcExport?.name || npcExport?.id || kind,
      species: kind,
      creatureKind: kind,
      animalKind: kind,
      chatheadCreatureKind: kind,
      creatureGenotype: genotype,
      animalGenotype: genotype,
      animalOpacity: normalizeOpacity(appearance.animalOpacity ?? npcExport?.animalOpacity),
      animalHatId: appearance.animalHatId || npcExport?.animalHatId || 'none',
      appearance,
      npcRecord: npcExport || null,
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

  function ensureHeadwearModule() {
    if (typeof document === 'undefined' || window.AnimalNpcHeadwear || !MODULE_SCRIPT_URL) return;
    if (document.querySelector('script[src*="animal-npc-headwear.js"]')) return;
    const script = document.createElement('script');
    script.src = new URL('animal-npc-headwear.js', MODULE_SCRIPT_URL).href;
    script.async = false;
    script.dataset.hobunjiAnimalNpcHeadwear = '1';
    script.onerror = () => { debugState.lastError = 'animal-npc-headwear.js failed to load'; };
    (document.head || document.documentElement)?.appendChild(script);
  }

  async function sourceForCreature(kind, profile, options = {}) {
    const renderer = window.CreatureGeneticsRender;
    let source = null;
    if (renderer?.composeFrame) {
      try {
        source = await renderer.composeFrame(kind, options.frame || 'idle', effectiveGenotype(profile, options), options.blinkShut === true);
      } catch (error) {
        debugState.lastError = `composeFrame(${kind}) failed: ${error?.message || error}`;
      }
    }
    if (!source) {
      const creature = registry()?.creatureFor?.(kind);
      const spritePath = creature?.sprites?.idle;
      source = await loadImage(registry()?.assetUrl?.(spritePath) || spritePath);
    }
    const appearance = appearanceFor(profile, options);
    if (source && appearance?.animalHatId && appearance.animalHatId !== 'none' && window.AnimalNpcHeadwear?.composeWithHat) {
      try { source = await window.AnimalNpcHeadwear.composeWithHat(source, kind, appearance); }
      catch (error) { debugState.lastError = `hat(${kind}) failed: ${error?.message || error}`; }
    }
    return source;
  }

  function drawFullFrame(source, canvas, opacity = 1) {
    const sourceWidth = Number(source?.width || source?.naturalWidth) || 0;
    const sourceHeight = Number(source?.height || source?.naturalHeight) || 0;
    const targetWidth = Number(canvas?.width) || 200;
    const targetHeight = Number(canvas?.height) || targetWidth;
    const context = canvas?.getContext?.('2d');
    if (!context || !sourceWidth || !sourceHeight) return false;
    const padding = Math.max(2, Math.round(Math.min(targetWidth, targetHeight) * 0.04));
    const scale = Math.min((targetWidth - padding * 2) / sourceWidth, (targetHeight - padding * 2) / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.save();
    context.globalAlpha = normalizeOpacity(opacity);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, (targetWidth - drawWidth) / 2, (targetHeight - drawHeight) / 2, drawWidth, drawHeight);
    context.restore();
    return true;
  }

  function drawChathead(source, canvas, kind, opacity = 1) {
    const resolved = window.AnimalChatheadFrame?.frameForKind?.(kind);
    const frame = resolved?.frame || resolved;
    if (!frame) return drawFullFrame(source, canvas, opacity);
    const sourceWidth = Number(source?.width || source?.naturalWidth) || 0;
    const sourceHeight = Number(source?.height || source?.naturalHeight) || 0;
    const targetWidth = Number(canvas?.width) || 200;
    const targetHeight = Number(canvas?.height) || targetWidth;
    const context = canvas?.getContext?.('2d');
    if (!context || !sourceWidth || !sourceHeight) return false;
    const sx = Math.max(0, frame.x * sourceWidth);
    const sy = Math.max(0, frame.y * sourceHeight);
    const sw = Math.max(1, Math.min(sourceWidth - sx, frame.width * sourceWidth));
    const sh = Math.max(1, Math.min(sourceHeight - sy, frame.height * sourceHeight));
    const scale = Math.min((targetWidth * 0.96) / sw, (targetHeight * 0.96) / sh);
    const drawWidth = sw * scale;
    const drawHeight = sh * scale;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.save();
    context.globalAlpha = normalizeOpacity(opacity);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, sx, sy, sw, sh, (targetWidth - drawWidth) / 2, (targetHeight - drawHeight) / 2, drawWidth, drawHeight);
    context.restore();
    return true;
  }

  async function renderCreatureProfile(canvas, profile, options = {}) {
    const kind = creatureKindForProfile(profile, options);
    if (!kind) return false;
    const source = await sourceForCreature(kind, profile, options);
    if (!source) return false;
    const appearance = appearanceFor(profile, options);
    const opacity = appearance.animalOpacity ?? profile?.animalOpacity ?? 1;
    const chathead = options.animalChathead === true
      || canvas?.id === 'npcPortraitCanvas'
      || String(options?.seatId || '').startsWith('ambient:');
    const rendered = chathead
      ? drawChathead(source, canvas, kind, opacity)
      : drawFullFrame(source, canvas, opacity);
    if (rendered) {
      debugState.lastCreatureKind = kind;
      canvas.__hobunjiAnimalNpcAppearance = {
        kind,
        opacity: normalizeOpacity(opacity),
        hatId: appearance.animalHatId || profile?.animalHatId || 'none',
      };
    }
    return rendered;
  }

  function installPortraitBridge() {
    let installed = false;
    const preview = window.NpcAvatarPreview;
    const previewRender = preview?.renderProfileToCanvas;
    if (typeof previewRender === 'function' && !previewRender.__hobunjiNamedAnimalNpcPortraitBridge) {
      const wrappedPreviewRender = async function renderProfileToCanvasWithNamedAnimal(canvas, profile, options = {}) {
        if (await renderCreatureProfile(canvas, profile, options)) return canvas;
        return previewRender.call(this, canvas, profile, options);
      };
      wrappedPreviewRender.__hobunjiNamedAnimalNpcPortraitBridge = true;
      wrappedPreviewRender.__hobunjiNamedAnimalNpcOriginal = previewRender;
      preview.renderProfileToCanvas = wrappedPreviewRender;
      installed = true;
    }
    const directRender = window.renderProfile;
    if (typeof directRender === 'function' && !directRender.__hobunjiNamedAnimalNpcPortraitBridge) {
      const wrappedDirectRender = async function renderProfileWithNamedAnimal(canvas, profile, options = {}) {
        if (await renderCreatureProfile(canvas, profile, options)) return canvas;
        return directRender.call(this, canvas, profile, options);
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

  function canvasDataUrl(canvas) {
    if (!canvas?.toDataURL) return '';
    try { return canvas.toDataURL('image/png'); } catch { return ''; }
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
        const fallbackPath = creature?.sprites?.idle;
        const spriteUrl = canvasDataUrl(sourceCanvas) || registry()?.assetUrl?.(fallbackPath) || fallbackPath;
        if (!spriteUrl) return currentBuild.call(this, THREE, sourceCanvas, options);
        const modelWidth = Number(creature?.modelWidth) > 0 ? Number(creature.modelWidth) : Number(options.modelWidth) || 1;
        const spriteAspect = Number(creature?.spriteAspect) > 0 ? Number(creature.spriteAspect) : 1;
        const modelHeight = modelWidth * spriteAspect;
        const avatarRef = api.buildAnimalPlaneAvatarModel(THREE, spriteUrl, {
          modelWidth,
          modelHeight,
          name: options.name || `named_animal_npc_${kind}`,
          creatureId: kind,
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
  function setAppearanceJson(nextAppearance) {
    const field = document.getElementById('appearanceJson');
    if (!field) return false;
    const next = JSON.stringify(nextAppearance, null, 2);
    if (field.value === next) return false;
    field.value = next;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function syncAppearanceFromSpecies(speciesId) {
    const field = document.getElementById('appearanceJson');
    if (!field || !speciesId) return;
    const appearance = { ...safeJson(field.value, {}) };
    const isAnimal = !!registry()?.isCreatureSpecies?.(speciesId);
    if (isAnimal) {
      if (appearance.avatarType === 'animal' && normalizeSpeciesId(appearance.creatureKind) === speciesId && normalizeSpeciesId(appearance.speciesId) === speciesId) return;
      appearance.avatarType = 'animal';
      appearance.creatureKind = speciesId;
      appearance.animalKind = speciesId;
      appearance.chatheadCreatureKind = speciesId;
      appearance.speciesId = speciesId;
    } else {
      if (appearance.avatarType === 'animal') delete appearance.avatarType;
      delete appearance.creatureKind;
      delete appearance.animalKind;
      delete appearance.chatheadCreatureKind;
      appearance.speciesId = speciesId;
    }
    setAppearanceJson(appearance);
  }
  function syncSpeciesFromAppearance() {
    if (studioSyncing) return;
    const speciesField = document.getElementById('npcSpecies');
    const appearanceField = document.getElementById('appearanceJson');
    if (!speciesField || !appearanceField) return;
    const appearance = safeJson(appearanceField.value, {});
    if (appearance.avatarType !== 'animal') return;
    const kind = normalizeSpeciesId(appearance.creatureKind || appearance.animalKind || appearance.speciesId);
    if (!kind || !registry()?.isCreatureSpecies?.(kind) || normalizeSpeciesId(speciesField.value) === kind) return;
    studioSyncing = true;
    speciesField.value = kind;
    speciesField.dispatchEvent(new Event('input', { bubbles: true }));
    studioSyncing = false;
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
    const creatures = (registry()?.listCreatures?.() || []).map(creature => ({
      id: normalizeSpeciesId(creature.id),
      label: `Animal · ${creature.label || creature.id}`,
    }));
    const humanoidMap = new Map();
    for (const fighter of window.getPortraitFighters?.() || []) {
      const id = normalizeSpeciesId(fighter?.speciesId);
      if (id && !humanoidMap.has(id)) humanoidMap.set(id, fighter?.speciesLabel || fighter?.label || id);
    }
    const people = [...humanoidMap.entries()].map(([id, label]) => ({ id, label: `Person · ${label}` }));
    list.innerHTML = [...people, ...creatures]
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
      if (speciesId && (options.fromInput === true || registry()?.isCreatureSpecies?.(speciesId))) syncAppearanceFromSpecies(speciesId);
      debugState.lastStudioNpcId = npcId;
      debugState.lastStudioSpecies = speciesId;
      debugState.nativeStudioAppearance = !!window.CharacterStudioAnimalAppearance;
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
    if (!document.getElementById('npcSpeciesChoices')) {
      const list = document.createElement('datalist');
      list.id = 'npcSpeciesChoices';
      input.setAttribute('list', list.id);
      input.parentElement?.appendChild(list);
      const help = document.createElement('div');
      help.className = 'help';
      help.id = 'npcSpeciesHelp';
      help.textContent = 'Species can be a person or a creature from the bestiary. Animal appearance is edited through the native Character form controls in the Appearance tab.';
      input.parentElement?.appendChild(help);
      input.addEventListener('input', () => queueMicrotask(() => syncStudioSpecies({ fromInput: true })));
      document.getElementById('appearanceJson')?.addEventListener('input', () => queueMicrotask(syncSpeciesFromAppearance));
      const previewMeta = document.getElementById('previewMeta');
      if (previewMeta && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => queueMicrotask(() => syncStudioSpecies())).observe(previewMeta, { childList: true, characterData: true, subtree: true });
      }
    }
    registry()?.ready?.then(() => {
      refreshStudioSpeciesOptions();
      syncStudioSpecies();
      queueMicrotask(refreshStudioDatabaseView);
    }).catch(error => { debugState.lastError = `species registry failed: ${error?.message || error}`; });
    setTimeout(() => { refreshStudioSpeciesOptions(); syncStudioSpecies(); }, 0);
    setTimeout(() => { refreshStudioSpeciesOptions(); debugState.nativeStudioAppearance = !!window.CharacterStudioAnimalAppearance; }, 1000);
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
      set(next) { value = next; installAll(); },
    });
    watchedGlobalAssignments.add(name);
  }

  function installAll() {
    try {
      ensureHeadwearModule();
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
    effectiveGenotype,
    renderCreatureProfile,
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
