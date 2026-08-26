// Cleanup/presentation adapter for amphibious-fish corpses and land Gurumahi.
// Loaded after amphibious-fishing.js so exact-fish retrieval can use BanditCamps'
// private cleanup deps and land fish can reuse FishCatalog's authored item render.
(() => {
  'use strict';

  const GURUMAHI_LAND_MODEL_WIDTH = 0.22; // Used to keep the Gurumahi land/combat form at one tenth of its original 2.2-unit width.
  const GURUMAHI_LAND_SPRITE_ASPECT = 1.6; // Used to match the amphibious creature definition's authored plane height/width ratio.
  const GURUMAHI_LAND_MODEL_HEIGHT = GURUMAHI_LAND_MODEL_WIDTH * GURUMAHI_LAND_SPRITE_ASPECT; // Used by the existing opaque-pixel ground-offset math.
  const GURUMAHI_SPRITE_PATH = 'assets/objectsprites/fish_gurumahi.png'; // Used as the same source sprite the inventory fish renderer recolors/shades.
  let corpseDeps = null; // Used to grant/save the fish and fully despawn retrieved corpses through the existing corpse-loot pipeline.
  let spawnDeps = null; // Used to update live land Gurumahi frames through the ordinary creature renderer.
  let presentationLoopStarted = false; // Used to install only one live-creature shading/prewarm pass.
  let activePrewarm = null; // Used to hold exactly one hidden prepared land plane for the amphibious fish currently visible in the minigame.
  const renderedLandByKey = new Map(); // Used to cache the expensive FishCatalog shade/recolor result per Gurumahi variant; hidden plane instances are still disposable per encounter.

  function wrap(api) {
    if (!api?.init || !api?.makeCorpseWorldObject || api.__amphibiousFishCorpseCleanupWrapped) return api;
    const originalInit = api.init;
    const originalMake = api.makeCorpseWorldObject;
    api.init = injectedDeps => {
      corpseDeps = injectedDeps;
      return originalInit.call(api, injectedDeps);
    };
    api.makeCorpseWorldObject = c => {
      if (!c?.isAmphibiousFishCorpse) return originalMake.call(api, c);
      const key = c._amphibiousFishItemKey;
      const label = c._amphibiousFishLabel || window.FishCatalog?.get?.(key)?.label || 'amphibious fish';
      const stars = Math.max(1, Math.min(5, Math.round(Number(c._amphibiousFishStars) || 3)));
      return {
        id: 'corpse_' + c.id,
        type: 'amphibious_fish_corpse',
        promptRoot: c.avatarRef?.group || null,
        getButtons() {
          return [{ icon: '🐟', label: 'Retrieve ' + label, action: 'obj_loot_corpse', style: 'primary', allowed: true }];
        },
        onAction(action) {
          if (action !== 'obj_loot_corpse') return { ok: false, message: 'Unknown action.' };
          if (!key || !corpseDeps?.inventory) return { ok: false, message: 'The fish could not be retrieved.' };
          corpseDeps.inventory[key] = Math.min(99, (corpseDeps.inventory[key] || 0) + 1);
          corpseDeps.clampInventoryStack?.(key);
          window.CookingSystem?.recordItemQuality?.(key, stars, 1);
          corpseDeps.corpseObjects?.delete?.(c);
          corpseDeps.despawnCreature?.(c);
          corpseDeps.refreshItemScroll?.();
          corpseDeps.buildInventoryGrid?.();
          corpseDeps.refreshActionBar?.();
          corpseDeps.saveMemberWorldData?.();
          window.__farmLog?.(`[amphibious-fishing] retrieved ${stars}★ ${label} from corpse #${c.id}`, 'fish');
          return { ok: true, message: `Retrieved ${stars}★ ${label}.` };
        },
      };
    };
    Object.defineProperty(api, '__amphibiousFishCorpseCleanupWrapped', { value: true, configurable: true });
    return api;
  }

  function creaturePlaneGroundOffset(modelHeight, bottomRatio) {
    if (typeof spawnDeps?.creaturePlaneGroundOffset === 'function') {
      return spawnDeps.creaturePlaneGroundOffset(modelHeight, bottomRatio); // Reuses the exact creature/farm-animal grounding helper when the wildlife deps expose it.
    }
    return -modelHeight * Math.max(0, 1 - bottomRatio); // Same geometry: move the plane down by its transparent bottom margin while leaving the creature prism/root untouched.
  }

  function groundAvatarPlanes(avatarRef, bottomRatio) {
    if (!avatarRef?.group || !Number.isFinite(bottomRatio)) return;
    const offsetY = creaturePlaneGroundOffset(GURUMAHI_LAND_MODEL_HEIGHT, bottomRatio); // Used to put the lowest opaque fish pixel exactly on the creature's ground plane.
    avatarRef.frontPlane = avatarRef.frontPlane || avatarRef.group.children?.find?.(child => child?.name?.endsWith('_front_plane')) || avatarRef.group.children?.[0] || null;
    avatarRef.backPlane = avatarRef.backPlane || avatarRef.group.children?.find?.(child => child?.name?.endsWith('_back_plane')) || avatarRef.group.children?.[1] || null;
    if (avatarRef.frontPlane) avatarRef.frontPlane.position.y = offsetY;
    if (avatarRef.backPlane) avatarRef.backPlane.position.y = offsetY;
  }

  function renderLandVariant(key) {
    if (!key || !window.FishCatalog?.getRecoloredCanvas) return Promise.resolve(null);
    if (!renderedLandByKey.has(key)) {
      const promise = window.FishCatalog.getRecoloredCanvas(GURUMAHI_SPRITE_PATH, key)
        .then(async canvas => {
          if (!canvas) return null;
          // This is the same opaque-pixel scan exported for animal/creature
          // planes by png-plane-avatar.js. Scan the FINAL shaded canvas so
          // grounding is based on what the player actually sees, not PNG padding.
          const bounds = window.PNGPlaneAvatar?.scanOpaqueVerticalBoundsOfImage?.(canvas);
          const bottomRatio = bounds && canvas.height ? (bounds.bottom + 1) / canvas.height : 1;
          const frameUrl = canvas.toDataURL?.('image/png') || null;
          if (!frameUrl) return null;

          // Decode once while the fish is still in the minigame. TextureLoader
          // can then consume a hot browser image instead of visibly showing the
          // raw sprite while FishCatalog shading catches up after reel-in.
          try {
            const decoded = new Image();
            decoded.src = frameUrl;
            if (typeof decoded.decode === 'function') await decoded.decode();
          } catch (_) {}
          return { key, canvas, frameUrl, bottomRatio };
        })
        .catch(error => {
          renderedLandByKey.delete(key);
          window.__farmLog?.(`[amphibious-fishing] Gurumahi land shading failed for ${key}: ${error?.message || error}`, 'fish');
          return null;
        });
      renderedLandByKey.set(key, promise);
    }
    return renderedLandByKey.get(key);
  }

  function buildHiddenPreparedAvatar(rendered) {
    if (!rendered?.frameUrl || !window.THREE || !window.PNGPlaneAvatar?.buildAnimalPlaneAvatarModel) return null;
    const avatarRef = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(window.THREE, rendered.frameUrl, {
      modelWidth: GURUMAHI_LAND_MODEL_WIDTH,
      modelHeight: GURUMAHI_LAND_MODEL_HEIGHT,
      name: `gurumahi_prewarm_${rendered.key}`,
    });
    avatarRef.frontPlane = avatarRef.group.children?.[0] || null;
    avatarRef.backPlane = avatarRef.group.children?.[1] || null;
    groundAvatarPlanes(avatarRef, rendered.bottomRatio);
    avatarRef.group.visible = false; // Prepared in memory only; it is never shown unless this exact fish is successfully reeled in.
    return avatarRef;
  }

  function disposePreparedAvatar(prepared) {
    const avatarRef = prepared?.avatarRef;
    if (!avatarRef) return;
    avatarRef.group?.parent?.remove?.(avatarRef.group);
    avatarRef.dispose?.();
    prepared.avatarRef = null;
  }

  function discardActivePrewarm(reason) {
    const reservation = activePrewarm;
    if (!reservation) return;
    activePrewarm = null;
    reservation.discarded = true;
    if (reservation.ready) disposePreparedAvatar(reservation.ready);
    window.__farmLog?.(`[amphibious-fishing] discarded hidden Gurumahi prewarm ${reservation.key}${reason ? ` (${reason})` : ''}`, 'fish');
  }

  function startPrewarmForState(state) {
    const key = state?.fishDef?.amphibious ? state.fishDef.key : null;
    if (!key) return;
    if (activePrewarm?.state === state && activePrewarm.key === key) return;
    if (activePrewarm) discardActivePrewarm('fish changed');

    const reservation = { state, key, ready: null, consumed: false, discarded: false, promise: null }; // Used to tie one hidden plane to one visible minigame fish, not merely to its species key.
    activePrewarm = reservation;
    reservation.promise = renderLandVariant(key).then(rendered => {
      if (!rendered || reservation.discarded || activePrewarm !== reservation) return null;
      const avatarRef = buildHiddenPreparedAvatar(rendered);
      reservation.ready = { ...rendered, avatarRef };
      window.__farmLog?.(`[amphibious-fishing] prewarmed hidden land plane for ${key} bottom=${rendered.bottomRatio.toFixed(3)}`, 'fish');
      return reservation.ready;
    });
  }

  function updateFishingPrewarm() {
    const state = window.Fishing?.state || null;
    if (state?.phase === 'active' && state.fishDef?.amphibious) {
      startPrewarmForState(state);
      return;
    }
    // Keep a caught reservation alive just long enough for amphibious-fishing's
    // caught-transition handler to call makeCreatureEntity and consume it.
    if (activePrewarm && state === activePrewarm.state && state?.phase === 'caught') return;
    if (activePrewarm && !activePrewarm.consumed) discardActivePrewarm(state ? `phase=${state.phase || 'unknown'}` : 'minigame closed without reel-in');
  }

  function consumePreparedAvatarForSpawn() {
    const reservation = activePrewarm;
    if (!reservation || reservation.consumed || !reservation.ready) return null;
    reservation.consumed = true;
    activePrewarm = null;
    return reservation.ready;
  }

  function clonePreparedCreatureDef(creature, frameUrl) {
    creature.def = {
      ...(creature.def || {}),
      modelWidth: GURUMAHI_LAND_MODEL_WIDTH,
      spriteAspect: GURUMAHI_LAND_SPRITE_ASPECT,
      sprites: { idle: frameUrl, run: [frameUrl, frameUrl] },
    };
    creature.visualModelWidth = GURUMAHI_LAND_MODEL_WIDTH;
    creature.currentFrameUrl = frameUrl;
  }

  function installPreparedAvatar(creature, prepared) {
    if (!creature || !prepared?.frameUrl) return false;
    clonePreparedCreatureDef(creature, prepared.frameUrl);

    const replacement = prepared.avatarRef;
    const existing = creature.avatarRef;
    const parent = existing?.group?.parent || null;
    if (replacement?.group && parent) {
      replacement.group.position.copy(existing.group.position);
      replacement.group.quaternion.copy(existing.group.quaternion);
      replacement.group.scale.copy(existing.group.scale);
      replacement.group.userData = { ...(existing.group.userData || {}), ...(replacement.group.userData || {}) };
      groundAvatarPlanes(replacement, prepared.bottomRatio);
      existing.group.removeFromParent?.();
      existing.dispose?.();
      parent.add(replacement.group);
      replacement.group.visible = true;
      creature.avatarRef = replacement;
      prepared.avatarRef = null; // Ownership transferred to the creature; failed-catch cleanup must never dispose it now.
      spawnDeps?._markPngPlane?.(replacement.group);
    } else {
      const genotypeKind = spawnDeps?.genotypeKindFor?.(creature) || null;
      spawnDeps?.setCreatureFrame?.(existing, prepared.frameUrl, genotypeKind, 'idle', creature.genotype);
      groundAvatarPlanes(existing, prepared.bottomRatio);
      disposePreparedAvatar(prepared);
    }

    creature._amphibiousLandPresentationApplied = true;
    creature._amphibiousLandBottomRatio = prepared.bottomRatio;
    window.__farmLog?.(`[amphibious-fishing] spawned prewarmed ${prepared.key} land plane grounded at opaque bottom=${prepared.bottomRatio.toFixed(3)}`, 'fish');
    return true;
  }

  function applyLandPresentation(creature) {
    const key = creature?._amphibiousFishItemKey;
    if (!key || creature._amphibiousLandPresentationPending || creature._amphibiousLandPresentationApplied) return;
    creature._amphibiousLandPresentationPending = true;
    renderLandVariant(key).then(rendered => {
      creature._amphibiousLandPresentationPending = false;
      if (!rendered || creature.state === 'corpse') return;
      clonePreparedCreatureDef(creature, rendered.frameUrl);
      const genotypeKind = spawnDeps?.genotypeKindFor?.(creature) || null;
      spawnDeps?.setCreatureFrame?.(creature.avatarRef, rendered.frameUrl, genotypeKind, 'idle', creature.genotype);
      groundAvatarPlanes(creature.avatarRef, rendered.bottomRatio);
      creature._amphibiousLandBottomRatio = rendered.bottomRatio;
      creature._amphibiousLandPresentationApplied = true;
      window.__farmLog?.(`[amphibious-fishing] fallback-shaded/grounded land ${key} width=${GURUMAHI_LAND_MODEL_WIDTH} bottom=${rendered.bottomRatio.toFixed(3)}`, 'fish');
    });
  }

  function presentationLoop() {
    updateFishingPrewarm();
    for (const creature of spawnDeps?.hostileObjects || []) {
      if (creature?._amphibiousFishItemKey) applyLandPresentation(creature);
    }
    requestAnimationFrame(presentationLoop);
  }

  function wrapMakeCreatureEntity(injectedDeps) {
    if (!injectedDeps?.makeCreatureEntity || injectedDeps.makeCreatureEntity.__gurumahiPrewarmWrapped) return;
    const originalMakeCreatureEntity = injectedDeps.makeCreatureEntity;
    const wrapped = function prewarmedCreatureFactory(kind, x, y, opts) {
      if (kind !== 'gurumahi') return originalMakeCreatureEntity.call(this, kind, x, y, opts);

      const prepared = consumePreparedAvatarForSpawn(); // Synchronous by design: if prewarm did not finish in time, ordinary async fallback presentation still handles it.
      const sharedDef = injectedDeps.CREATURE_DB?.gurumahi;
      const oldModelWidth = sharedDef?.modelWidth;
      const oldSpriteAspect = sharedDef?.spriteAspect;
      const oldSprites = sharedDef?.sprites;
      if (sharedDef) {
        sharedDef.modelWidth = GURUMAHI_LAND_MODEL_WIDTH;
        sharedDef.spriteAspect = GURUMAHI_LAND_SPRITE_ASPECT;
        if (prepared?.frameUrl) sharedDef.sprites = { idle: prepared.frameUrl, run: [prepared.frameUrl, prepared.frameUrl] };
      }

      let creature;
      try {
        creature = originalMakeCreatureEntity.call(this, kind, x, y, opts);
      } finally {
        if (sharedDef) {
          sharedDef.modelWidth = oldModelWidth;
          sharedDef.spriteAspect = oldSpriteAspect;
          sharedDef.sprites = oldSprites;
        }
      }
      if (creature && prepared) installPreparedAvatar(creature, prepared);
      else if (prepared) disposePreparedAvatar(prepared);
      return creature;
    };
    Object.defineProperty(wrapped, '__gurumahiPrewarmWrapped', { value: true });
    injectedDeps.makeCreatureEntity = wrapped;
  }

  function wrapWildlifeSpawn(api) {
    if (!api?.init || api.__gurumahiLandScaleWrapped) return api;
    const originalInit = api.init;
    api.init = injectedDeps => {
      spawnDeps = injectedDeps;
      wrapMakeCreatureEntity(injectedDeps);
      const def = injectedDeps?.CREATURE_DB?.gurumahi;
      if (def?.amphibiousFish) {
        def.modelWidth = GURUMAHI_LAND_MODEL_WIDTH;
        def.spriteAspect = GURUMAHI_LAND_SPRITE_ASPECT;
      }
      const result = originalInit.call(api, injectedDeps);
      window.__farmLog?.(`[amphibious-fishing] Gurumahi land width=${GURUMAHI_LAND_MODEL_WIDTH}; opaque-ground/prewarm active`, 'fish');
      if (!presentationLoopStarted) {
        presentationLoopStarted = true;
        requestAnimationFrame(presentationLoop);
      }
      return result;
    };
    Object.defineProperty(api, '__gurumahiLandScaleWrapped', { value: true, configurable: true });
    return api;
  }

  function hookWindowApi(name, wrapper) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: () => descriptor.get.call(window),
        set: value => {
          descriptor.set.call(window, value);
          wrapper(descriptor.get.call(window));
        },
      });
      wrapper(descriptor.get.call(window));
      return;
    }
    wrapper(window[name]);
  }

  hookWindowApi('BanditCamps', wrap);
  hookWindowApi('WildlifeSpawn', wrapWildlifeSpawn);
})();
