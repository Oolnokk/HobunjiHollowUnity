// Cleanup/presentation adapter for amphibious-fish corpses and land Gurumahi.
// Loaded after amphibious-fishing.js so exact-fish retrieval can use BanditCamps'
// private cleanup deps and land fish can reuse FishCatalog's authored item render.
(() => {
  'use strict';

  const GURUMAHI_LAND_MODEL_WIDTH = 0.33; // 150% of the previous 0.22 land/combat width.
  const GURUMAHI_LAND_SPRITE_ASPECT = 1.6; // Matches the amphibious creature definition's authored plane height/width ratio.
  const GURUMAHI_LAND_MODEL_HEIGHT = GURUMAHI_LAND_MODEL_WIDTH * GURUMAHI_LAND_SPRITE_ASPECT;
  const GURUMAHI_SPRITE_PATH = 'assets/objectsprites/fish_gurumahi.png';

  let corpseDeps = null; // Grants/saves the recovered fish and fully despawns its corpse.
  let spawnDeps = null; // Creature renderer/spawn deps used for grounding and frame updates.
  let presentationLoopStarted = false;
  let activePrewarm = null; // One texture reservation for the Gurumahi currently visible in the fishing minigame.
  const renderedLandByKey = new Map(); // Caches the expensive authored shade/recolor result, never a live world plane.

  function wrapCorpseApi(api) {
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
      return spawnDeps.creaturePlaneGroundOffset(modelHeight, bottomRatio);
    }
    return -modelHeight * Math.max(0, 1 - bottomRatio);
  }

  function groundAvatarPlanes(avatarRef, bottomRatio) {
    if (!avatarRef?.group || !Number.isFinite(bottomRatio)) return;
    const offsetY = creaturePlaneGroundOffset(GURUMAHI_LAND_MODEL_HEIGHT, bottomRatio);
    avatarRef.frontPlane = avatarRef.frontPlane
      || avatarRef.group.children?.find?.(child => child?.name?.endsWith('_front_plane'))
      || avatarRef.group.children?.[0]
      || null;
    avatarRef.backPlane = avatarRef.backPlane
      || avatarRef.group.children?.find?.(child => child?.name?.endsWith('_back_plane'))
      || avatarRef.group.children?.[1]
      || null;
    if (avatarRef.frontPlane) avatarRef.frontPlane.position.y = offsetY;
    if (avatarRef.backPlane) avatarRef.backPlane.position.y = offsetY;
  }

  function renderLandVariant(key) {
    if (!key || !window.FishCatalog?.getRecoloredCanvas) return Promise.resolve(null);
    if (!renderedLandByKey.has(key)) {
      const promise = window.FishCatalog.getRecoloredCanvas(GURUMAHI_SPRITE_PATH, key)
        .then(async canvas => {
          if (!canvas) return null;
          const bounds = window.PNGPlaneAvatar?.scanOpaqueVerticalBoundsOfImage?.(canvas);
          const bottomRatio = bounds && canvas.height ? (bounds.bottom + 1) / canvas.height : 1;
          const frameUrl = canvas.toDataURL?.('image/png') || null;
          if (!frameUrl) return null;

          // Decode while the Gurumahi is still in the minigame. At reel-in the
          // normal creature factory can therefore build its one and only plane
          // directly from the already-hot shaded image.
          try {
            const decoded = new Image();
            decoded.src = frameUrl;
            if (typeof decoded.decode === 'function') await decoded.decode();
          } catch (_) {}
          return { key, frameUrl, bottomRatio };
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

  function discardActivePrewarm(reason) {
    const reservation = activePrewarm;
    if (!reservation) return;
    activePrewarm = null;
    reservation.discarded = true;
    // Nothing exists in the Three scene yet: failed/escaped fish only discard
    // this reservation. The shaded image cache is inert and reusable.
    window.__farmLog?.(`[amphibious-fishing] discarded Gurumahi texture prewarm ${reservation.key}${reason ? ` (${reason})` : ''}`, 'fish');
  }

  function startPrewarmForState(state) {
    const key = state?.fishDef?.amphibious ? state.fishDef.key : null;
    if (!key) return;
    if (activePrewarm?.state === state && activePrewarm.key === key) return;
    if (activePrewarm) discardActivePrewarm('fish changed');

    const reservation = { state, key, ready: null, consumed: false, discarded: false, promise: null };
    activePrewarm = reservation;
    reservation.promise = renderLandVariant(key).then(rendered => {
      if (!rendered || reservation.discarded || activePrewarm !== reservation) return null;
      reservation.ready = rendered;
      window.__farmLog?.(`[amphibious-fishing] prewarmed shaded Gurumahi texture for ${key} bottom=${rendered.bottomRatio.toFixed(3)}`, 'fish');
      return rendered;
    });
  }

  function updateFishingPrewarm() {
    const state = window.Fishing?.state || null;
    if (state?.phase === 'active' && state.fishDef?.amphibious) {
      startPrewarmForState(state);
      return;
    }
    // Preserve the reservation through the single caught frame so the
    // amphibious-fishing transition can consume it while spawning combat form.
    if (activePrewarm && state === activePrewarm.state && state?.phase === 'caught') return;
    if (activePrewarm && !activePrewarm.consumed) {
      discardActivePrewarm(state ? `phase=${state.phase || 'unknown'}` : 'minigame closed without reel-in');
    }
  }

  function consumePreparedRenderForSpawn() {
    const reservation = activePrewarm;
    if (!reservation || reservation.consumed || !reservation.ready) return null;
    reservation.consumed = true;
    activePrewarm = null;
    return reservation.ready;
  }

  function cloneCreaturePresentationDef(creature, frameUrl) {
    if (!creature) return;
    creature.def = {
      ...(creature.def || {}),
      modelWidth: GURUMAHI_LAND_MODEL_WIDTH,
      spriteAspect: GURUMAHI_LAND_SPRITE_ASPECT,
      ...(frameUrl ? { sprites: { idle: frameUrl, run: [frameUrl, frameUrl] } } : {}),
    };
    creature.visualModelWidth = GURUMAHI_LAND_MODEL_WIDTH;
    if (frameUrl) creature.currentFrameUrl = frameUrl;
  }

  function applyPreparedPresentation(creature, prepared) {
    if (!creature || !prepared?.frameUrl) return false;
    cloneCreaturePresentationDef(creature, prepared.frameUrl);
    groundAvatarPlanes(creature.avatarRef, prepared.bottomRatio);
    creature._amphibiousLandBottomRatio = prepared.bottomRatio;
    creature._amphibiousLandPresentationApplied = true;
    window.__farmLog?.(`[amphibious-fishing] spawned single prewarmed ${prepared.key} avatar width=${GURUMAHI_LAND_MODEL_WIDTH} bottom=${prepared.bottomRatio.toFixed(3)}`, 'fish');
    return true;
  }

  function applyFallbackPresentation(creature) {
    const key = creature?._amphibiousFishItemKey;
    if (!key || creature._amphibiousLandPresentationPending || creature._amphibiousLandPresentationApplied) return;
    creature._amphibiousLandPresentationPending = true;
    renderLandVariant(key).then(rendered => {
      creature._amphibiousLandPresentationPending = false;
      if (!rendered || creature.state === 'corpse') return;
      cloneCreaturePresentationDef(creature, rendered.frameUrl);
      const genotypeKind = spawnDeps?.genotypeKindFor?.(creature) || null;
      spawnDeps?.setCreatureFrame?.(creature.avatarRef, rendered.frameUrl, genotypeKind, 'idle', creature.genotype);
      groundAvatarPlanes(creature.avatarRef, rendered.bottomRatio);
      creature._amphibiousLandBottomRatio = rendered.bottomRatio;
      creature._amphibiousLandPresentationApplied = true;
      window.__farmLog?.(`[amphibious-fishing] fallback-shaded/grounded land ${key} width=${GURUMAHI_LAND_MODEL_WIDTH}`, 'fish');
    });
  }

  function presentationLoop() {
    updateFishingPrewarm();
    for (const creature of spawnDeps?.hostileObjects || []) {
      if (creature?._amphibiousFishItemKey) applyFallbackPresentation(creature);
    }
    requestAnimationFrame(presentationLoop);
  }

  function wrapMakeCreatureEntity(injectedDeps) {
    if (!injectedDeps?.makeCreatureEntity || injectedDeps.makeCreatureEntity.__gurumahiTexturePrewarmWrapped) return;
    const originalMakeCreatureEntity = injectedDeps.makeCreatureEntity;

    const wrapped = function prewarmedCreatureFactory(kind, x, y, opts) {
      if (kind !== 'gurumahi') return originalMakeCreatureEntity.call(this, kind, x, y, opts);

      const prepared = consumePreparedRenderForSpawn();
      const sharedDef = injectedDeps.CREATURE_DB?.gurumahi;
      const oldSprites = sharedDef?.sprites;
      if (sharedDef) {
        // Keep the scale permanently corrected, but only borrow this exact
        // fish's shaded sprite during construction so variants cannot overwrite
        // one another in the shared species definition.
        sharedDef.modelWidth = GURUMAHI_LAND_MODEL_WIDTH;
        sharedDef.spriteAspect = GURUMAHI_LAND_SPRITE_ASPECT;
        if (prepared?.frameUrl) sharedDef.sprites = { idle: prepared.frameUrl, run: [prepared.frameUrl, prepared.frameUrl] };
      }

      let creature;
      try {
        creature = originalMakeCreatureEntity.call(this, kind, x, y, opts);
      } finally {
        if (sharedDef) sharedDef.sprites = oldSprites;
      }

      cloneCreaturePresentationDef(creature, prepared?.frameUrl || null);
      if (creature && prepared) applyPreparedPresentation(creature, prepared);
      return creature;
    };

    Object.defineProperty(wrapped, '__gurumahiTexturePrewarmWrapped', { value: true });
    injectedDeps.makeCreatureEntity = wrapped;
  }

  function wrapWildlifeSpawn(api) {
    if (!api?.init || api.__gurumahiLandPresentationWrapped) return api;
    const originalInit = api.init;

    api.init = injectedDeps => {
      // Let amphibious-fishing's earlier wrapper register CREATURE_DB.gurumahi
      // first, then apply the land-specific rendering layer to those same deps.
      const result = originalInit.call(api, injectedDeps);
      spawnDeps = injectedDeps;
      const def = injectedDeps?.CREATURE_DB?.gurumahi;
      if (def?.amphibiousFish) {
        def.modelWidth = GURUMAHI_LAND_MODEL_WIDTH;
        def.spriteAspect = GURUMAHI_LAND_SPRITE_ASPECT;
      }
      wrapMakeCreatureEntity(injectedDeps);
      if (!presentationLoopStarted) {
        presentationLoopStarted = true;
        requestAnimationFrame(presentationLoop);
      }
      window.__farmLog?.(`[amphibious-fishing] Gurumahi single-avatar prewarm active; land width=${GURUMAHI_LAND_MODEL_WIDTH}`, 'fish');
      return result;
    };

    Object.defineProperty(api, '__gurumahiLandPresentationWrapped', { value: true, configurable: true });
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

  hookWindowApi('BanditCamps', wrapCorpseApi);
  hookWindowApi('WildlifeSpawn', wrapWildlifeSpawn);
})();
