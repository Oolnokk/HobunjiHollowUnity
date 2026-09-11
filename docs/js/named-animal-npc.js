// Named animal NPC bridge — lets ordinary NPC database records use a creature
// species (Grehlr, Drenkirra, etc.) as their authoritative species instead of
// pretending to be a humanoid portrait species. Reuses CreatureGeneticsRender
// and PNGPlaneAvatar.buildAnimalPlaneAvatarModel; no second animal renderer.
(() => {
  'use strict';

  const INSTALL_INTERVAL_MS = 250; // Used by the late-load bridge installer while game/editor scripts finish loading.
  const STUDIO_PATH_RE = /\/tools\/character-studio\//; // Used to keep Character Studio-only UI wiring out of the game page.
  const debugState = { // Exposed below for mobile-friendly diagnostics when a named animal renders incorrectly.
    profileBridge: false,
    portraitBridge: false,
    planeBridge: false,
    studioPicker: false,
    lastCreatureKind: null,
    lastStudioNpcId: null,
    lastStudioSpecies: null,
    lastError: null,
  };
  let installTimer = null; // Used to stop polling once every available bridge has been installed.
  let studioSyncing = false; // Prevents Character Studio field synchronization from recursively dispatching itself.
  const imagePromiseByUrl = new Map(); // Reuses decoded creature images for editor/database portrait previews.
  const watchedGlobalAssignments = new Set(); // Tracks compatibility globals already intercepted so bootstrap hooks are installed only once.

  function registry() {
    return window.HobunjiNpcSpeciesRegistry || null;
  }

  function normalizeSpeciesId(value) {
    return registry()?.normalizeSpeciesId?.(value)
      || String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function creatureKindFrom(value) {
    const normalized = normalizeSpeciesId(value); // Used as the canonical creature key returned to every bridge below.
    if (!normalized) return null;
    if (registry()?.isCreatureSpecies?.(normalized)) return normalized;
    return null;
  }

  function explicitCreatureKind(source) {
    const explicit = source?.creatureKind // Used first so animal records still work before the bestiary fetch has completed.
      || source?.chatheadCreatureKind
      || source?.animalKind
      || (source?.avatarType === 'animal' ? source?.speciesId : null);
    return explicit ? normalizeSpeciesId(explicit) : null;
  }

  function creatureKindForNpcLike(npcLike) {
    const appearance = npcLike?.appearance || {}; // Used to carry the animal identity through code that only forwards appearance data.
    return explicitCreatureKind(npcLike)
      || explicitCreatureKind(appearance)
      || creatureKindFrom(npcLike?.species)
      || creatureKindFrom(appearance?.speciesId)
      || null;
  }

  function creatureKindForProfile(profile, options = {}) {
    const npcRecord = options?.npcRecord || profile?.npcRecord || null; // Used when buildSinglePlaneAvatarModel receives the original NPC record.
    return explicitCreatureKind(profile)
      || creatureKindForNpcLike(npcRecord)
      || creatureKindForNpcLike(profile?.appearance ? profile : null)
      || creatureKindFrom(options?.speciesId)
      || null;
  }

  function creatureGenotypeFor(profile, options = {}) {
    return options?.creatureGenotype // Used by world/editor creature rendering to preserve authored genetics when present.
      || options?.npcRecord?.creatureGenotype
      || options?.npcRecord?.appearance?.creatureGenotype
      || profile?.creatureGenotype
      || profile?.appearance?.creatureGenotype
      || null;
  }

  function makeCreatureProfile(npcExport, kind) {
    const appearance = { ...(npcExport?.appearance || {}) }; // Used as the compatibility shape expected by existing NPC/profile consumers.
    appearance.speciesId = kind;
    appearance.creatureKind = kind;
    appearance.avatarType = 'animal';
    const gender = String(npcExport?.gender || appearance.gender || 'unknown'); // Retained as identity metadata; animal rendering does not use humanoid gender sprites.
    const genotype = npcExport?.creatureGenotype || appearance.creatureGenotype || null; // Passed through to CreatureGeneticsRender when available.
    const profile = {
      name: npcExport?.name || npcExport?.id || kind,
      species: kind,
      creatureKind: kind,
      chatheadCreatureKind: kind,
      creatureGenotype: genotype,
      npcRecord: npcExport || null,
      appearance,
      fighter: { id: `creature:${kind}`, speciesId: kind, gender, creatureKind: kind },
    }; // Synthetic profile prevents the humanoid portrait adapter from silently falling back to its first fighter.
    return profile;
  }

  function installProfileBridge() {
    const preview = window.NpcAvatarPreview; // Shared NPC profile adapter used by game runtime and Character Studio.
    const current = preview?.buildProfileFromNpcExport; // Wrapped function may change later as other compatibility modules initialize.
    if (typeof current !== 'function') return false;
    if (current.__hobunjiNamedAnimalNpcProfileBridge) { debugState.profileBridge = true; return true; }
    const wrapped = function buildProfileWithNamedAnimalNpc(npcExport) {
      const kind = creatureKindForNpcLike(npcExport); // Routes only records whose authoritative species is a known/explicit creature.
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
      const image = new Image(); // Decoded creature sprite reused by database/portrait canvases.
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    imagePromiseByUrl.set(url, promise);
    return promise;
  }

  function fitImageToCanvas(canvas, source) {
    const width = Number(canvas?.width) || 200; // Target width used to letterbox the full animal sprite without distortion.
    const height = Number(canvas?.height) || width; // Target height used with width for scale-to-fit rendering.
    const sourceWidth = Number(source?.width || source?.naturalWidth) || 0; // Source width used to preserve creature aspect ratio.
    const sourceHeight = Number(source?.height || source?.naturalHeight) || 0; // Source height used to preserve creature aspect ratio.
    const context = canvas?.getContext?.('2d'); // Target 2D context receives the composed creature sprite.
    if (!context || !sourceWidth || !sourceHeight) return false;
    const scale = Math.min(width / sourceWidth, height / sourceHeight); // Uniform fit keeps the creature's authored proportions.
    const drawWidth = sourceWidth * scale; // Used to center the fitted sprite horizontally.
    const drawHeight = sourceHeight * scale; // Used to bottom-center the fitted sprite vertically.
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, (width - drawWidth) / 2, height - drawHeight, drawWidth, drawHeight);
    return true;
  }

  async function sourceForCreature(kind, profile, options = {}) {
    const genotype = creatureGenotypeFor(profile, options); // Used by the shared genetics compositor before falling back to the base idle PNG.
    const renderer = window.CreatureGeneticsRender; // Existing authoritative creature sprite/genetics renderer.
    if (renderer?.composeFrame) {
      try {
        const composed = await renderer.composeFrame(kind, options.frame || 'idle', genotype, options.blinkShut === true); // Produces the same genetics composite used by livestock/wild creatures.
        if (composed) return composed;
      } catch (error) {
        debugState.lastError = `composeFrame(${kind}) failed: ${error?.message || error}`;
      }
    }
    const creature = registry()?.creatureFor?.(kind); // Backs the no-genetics fallback with the mirrored creature bestiary.
    const spritePath = creature?.sprites?.idle; // Base idle art used when CreatureGeneticsRender is unavailable in a tool.
    const spriteUrl = registry()?.assetUrl?.(spritePath) || spritePath; // Resolves from docs/ even when the caller is nested under docs/tools/.
    return loadImage(spriteUrl);
  }

  async function renderCreatureProfile(canvas, profile, options = {}) {
    const kind = creatureKindForProfile(profile, options); // Determines whether this render belongs to the creature path.
    if (!kind) return false;
    debugState.lastCreatureKind = kind;
    if (window.AnimalChatheadFrame?.renderCreatureChathead
      && (canvas?.id === 'npcPortraitCanvas' || String(options?.seatId || '').startsWith('ambient:'))) {
      const renderedHead = await window.AnimalChatheadFrame.renderCreatureChathead(canvas, kind, {
        ...options,
        profile,
        genotype: creatureGenotypeFor(profile, options),
      }); // Reuses authored animal head framing for actual dialogue surfaces.
      if (renderedHead) return true;
    }
    const source = await sourceForCreature(kind, profile, options); // Full idle/genotype sprite for world-preview and Character Studio cards.
    return fitImageToCanvas(canvas, source);
  }

  function installPortraitBridge() {
    let installed = false; // Tracks whether either portrait surface was wrapped during this pass.
    const preview = window.NpcAvatarPreview; // Shared async portrait facade used by game runtime.
    const previewRender = preview?.renderProfileToCanvas; // Current facade function may already include chathead compatibility wrappers.
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

    const directRender = window.renderProfile; // Character Studio database cards call renderProfile directly instead of the facade.
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
    const api = window.PNGPlaneAvatar; // Existing character + animal plane assembly API.
    const currentBuild = api?.buildSinglePlaneAvatarModel; // Normal humanoid builder intercepted only for creature profiles.
    if (typeof currentBuild !== 'function' || typeof api?.buildAnimalPlaneAvatarModel !== 'function') return false;
    if (!currentBuild.__hobunjiNamedAnimalNpcPlaneBridge) {
      const wrappedBuild = function buildNamedAnimalNpcPlane(THREE, sourceCanvas, options = {}) {
        const kind = creatureKindForProfile(options?.profile, options); // Uses profile/npcRecord identity instead of NPC ids or hardcoded names.
        if (!kind) return currentBuild.call(this, THREE, sourceCanvas, options);
        const creature = registry()?.creatureFor?.(kind); // Supplies real creature model dimensions and idle sprite metadata.
        const spritePath = creature?.sprites?.idle; // Existing idle sprite used by buildAnimalPlaneAvatarModel.
        const spriteUrl = registry()?.assetUrl?.(spritePath) || spritePath; // Works from both game and nested authoring tools.
        if (!spriteUrl) return currentBuild.call(this, THREE, sourceCanvas, options);
        const modelWidth = Number(creature?.modelWidth) > 0 ? Number(creature.modelWidth) : Number(options.modelWidth) || 1; // Creature-authored width replaces humanoid portrait width.
        const spriteAspect = Number(creature?.spriteAspect) > 0 ? Number(creature.spriteAspect) : 1; // Creature bestiary aspect determines actual world height.
        const modelHeight = modelWidth * spriteAspect; // Same sizing rule used by the Cutscene Director's creature previews.
        const genotype = creatureGenotypeFor(options?.profile, options); // Passed into the species head/genetics bridges attached to the animal builder.
        const avatarRef = api.buildAnimalPlaneAvatarModel(THREE, spriteUrl, {
          modelWidth,
          modelHeight,
          name: options.name || `named_animal_npc_${kind}`,
          creatureId: kind,
          genotype,
          alphaTest: options.alphaTest,
        }); // Reuses the exact runtime animal model/head-rig path used by livestock and wild creatures.
        const root = avatarRef?.group; // NPC walker still expects buildSinglePlaneAvatarModel to return a Three.Group.
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
        }; // Compatibility metadata keeps generic NPC staging/debug code from assuming a humanoid portrait rig.
        debugState.lastCreatureKind = kind;
        return root;
      };
      wrappedBuild.__hobunjiNamedAnimalNpcPlaneBridge = true;
      wrappedBuild.__hobunjiNamedAnimalNpcOriginal = currentBuild;
      api.buildSinglePlaneAvatarModel = wrappedBuild;
    }

    const currentDispose = api.disposeAvatarModel; // Generic character disposer needs a small animal-ref branch to avoid leaking textures.
    if (typeof currentDispose === 'function' && !currentDispose.__hobunjiNamedAnimalNpcPlaneBridge) {
      const wrappedDispose = function disposeNamedAnimalNpc(root) {
        const avatarRef = root?.userData?.namedAnimalNpc ? root.userData.animalAvatarRef : null; // Animal builder's own disposer owns its textures/materials.
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
    const field = document.getElementById('appearanceJson'); // Existing raw appearance bridge is read by Character Studio's own read() function.
    if (!field) return;
    const appearance = { ...safeJson(field.value, {}) }; // Preserves unrelated identity/genetics metadata while replacing the humanoid species slot.
    appearance.speciesId = kind;
    appearance.creatureKind = kind;
    appearance.avatarType = 'animal';
    const next = JSON.stringify(appearance, null, 2); // Used to avoid dispatching a no-op recursive editor update.
    if (field.value !== next) {
      field.value = next;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function setStudioHumanoidAppearance(speciesId) {
    const field = document.getElementById('appearanceJson'); // Same authoritative appearance JSON bridge used for normal humanoids.
    if (!field || !speciesId) return;
    const appearance = { ...safeJson(field.value, {}) }; // Keeps colors/cosmetics while synchronizing an explicit user species edit.
    if (appearance.speciesId === speciesId && !appearance.creatureKind && appearance.avatarType !== 'animal') return;
    appearance.speciesId = speciesId;
    delete appearance.creatureKind;
    if (appearance.avatarType === 'animal') delete appearance.avatarType;
    field.value = JSON.stringify(appearance, null, 2);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setStudioAppearanceAvailability(isAnimal) {
    const appearanceTab = document.getElementById('mainTabAppearance'); // Main Character Studio Appearance tab is humanoid-only for animal records.
    const editAvatarButton = document.getElementById('editAvatarBtn'); // Database-side shortcut must not send animal NPCs into humanoid cosmetics.
    if (appearanceTab) {
      appearanceTab.disabled = !!isAnimal;
      appearanceTab.title = isAnimal ? 'Animal NPCs use the creature sprite/genetics system instead of humanoid Appearance.' : '';
    }
    if (editAvatarButton) {
      editAvatarButton.disabled = !!isAnimal;
      editAvatarButton.title = isAnimal ? 'Animal NPCs are edited by choosing their creature species.' : '';
    }
  }

  function refreshStudioDatabaseView() {
    const redrawField = document.getElementById('npcName'); // Existing Character Studio input already drives read()+renderDb(), so a no-op input event safely redraws all cards after async local-override migration.
    if (!redrawField || typeof Event === 'undefined') return;
    redrawField.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function refreshStudioSpeciesOptions() {
    const input = document.getElementById('npcSpecies'); // Existing species field remains an input so Character Studio's read/fill code stays untouched.
    const list = document.getElementById('npcSpeciesChoices'); // Datalist supplies tap-friendly selectable person/animal species without rejecting future ids.
    if (!input || !list) return false;
    const creatureOptions = (registry()?.listCreatures?.() || []).map(creature => ({
      id: normalizeSpeciesId(creature.id),
      label: `Animal · ${creature.label || creature.id}`,
    })); // All mirrored creature-bestiary entries become legal NPC species choices.
    const humanoidMap = new Map(); // Dedupes portrait fighters that differ only by gender.
    for (const fighter of window.getPortraitFighters?.() || []) {
      const id = normalizeSpeciesId(fighter?.speciesId); // Canonical person species id shown in the same picker.
      if (id && !humanoidMap.has(id)) humanoidMap.set(id, fighter?.speciesLabel || fighter?.label || id);
    }
    const humanoidOptions = [...humanoidMap.entries()].map(([id, label]) => ({ id, label: `Person · ${label}` })); // Normal portrait species remain selectable alongside animals.
    list.innerHTML = [...humanoidOptions, ...creatureOptions]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(option => `<option value="${option.id}" label="${String(option.label).replace(/"/g, '&quot;')}"></option>`)
      .join('');
    return true;
  }

  function syncStudioSpecies(options = {}) {
    if (studioSyncing) return;
    const input = document.getElementById('npcSpecies'); // Current authoritative species value for the selected NPC.
    const npcIdField = document.getElementById('npcId'); // Selected NPC id used only to apply reviewed legacy record corrections.
    if (!input || !npcIdField) return;
    studioSyncing = true;
    try {
      const npcId = String(npcIdField.value || '').trim(); // Used by species-overrides.json instead of hardcoded Banubu/Hiki checks in the editor.
      const reviewed = registry()?.overrideForNpc?.(npcId); // Canonical repo-authored correction, if this legacy record has one.
      if (reviewed?.species && normalizeSpeciesId(input.value) !== normalizeSpeciesId(reviewed.species)) {
        input.value = normalizeSpeciesId(reviewed.species);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const speciesId = normalizeSpeciesId(input.value); // Final species after any reviewed correction.
      const isAnimal = registry()?.isCreatureSpecies?.(speciesId) || reviewed?.kind === 'animal'; // Drives appearance UI and record synchronization.
      if (isAnimal && speciesId) setStudioAnimalAppearance(speciesId);
      else if (speciesId && options.fromInput === true) setStudioHumanoidAppearance(speciesId);
      setStudioAppearanceAvailability(!!isAnimal);
      debugState.lastStudioNpcId = npcId;
      debugState.lastStudioSpecies = speciesId;
    } catch (error) {
      debugState.lastError = `studio sync failed: ${error?.message || error}`;
    } finally {
      studioSyncing = false;
    }
  }

  function installStudioPicker() {
    if (typeof location === 'undefined' || !STUDIO_PATH_RE.test(location.pathname || '')) return false;
    const input = document.getElementById('npcSpecies'); // Existing field receives a datalist rather than being replaced, preserving the editor's attached listeners.
    if (!input) return false;
    if (!document.getElementById('npcSpeciesChoices')) {
      const list = document.createElement('datalist'); // Creature/person options shown by the browser's native mobile-friendly input picker.
      list.id = 'npcSpeciesChoices';
      input.setAttribute('list', list.id);
      input.parentElement?.appendChild(list);
      const help = document.createElement('div'); // Explains why animal NPCs do not expose humanoid cosmetics.
      help.className = 'help';
      help.id = 'npcSpeciesHelp';
      help.textContent = 'Species can be a person or any creature from the creature bestiary. Animal NPCs use creature sprites/genetics; the humanoid Appearance tab is disabled.';
      input.parentElement?.appendChild(help);
      input.addEventListener('input', () => queueMicrotask(() => syncStudioSpecies({ fromInput: true })));
      const previewMeta = document.getElementById('previewMeta'); // Changes every time Character Studio selects/fills a different NPC.
      if (previewMeta && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => queueMicrotask(() => syncStudioSpecies())); // Re-applies reviewed animal species without rewriting ordinary humanoid appearance variants on selection.
        observer.observe(previewMeta, { childList: true, characterData: true, subtree: true });
      }
    }
    registry()?.ready?.then(() => {
      refreshStudioSpeciesOptions();
      syncStudioSpecies();
      queueMicrotask(refreshStudioDatabaseView); // Redraws the complete NPC list after any stale local override objects have been migrated in place.
    }).catch(error => { debugState.lastError = `species registry failed: ${error?.message || error}`; });
    setTimeout(() => { refreshStudioSpeciesOptions(); syncStudioSpecies(); }, 0);
    setTimeout(refreshStudioSpeciesOptions, 1000);
    debugState.studioPicker = true;
    return true;
  }

  function watchGlobalAssignment(name) {
    if (watchedGlobalAssignments.has(name)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Existing descriptor is preserved when it cannot safely be intercepted.
    if (descriptor && descriptor.configurable === false) return;
    let value = window[name]; // Backing value returned by the temporary accessor until the real module assigns its API.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return value; },
      set(next) {
        value = next;
        installAll(); // Installs the relevant wrapper synchronously inside the module's own global assignment, before later game code can consume it.
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
        && (typeof location === 'undefined' || !STUDIO_PATH_RE.test(location.pathname || '') || debugState.studioPicker)) {
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