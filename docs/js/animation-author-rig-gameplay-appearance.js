// Animation Author Rig Coordinates: keep the selected NPC's procedural leg garment
// on the same appearance inputs and layering contract used by the live game.
(() => {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const PATCH_ID = 'animation-author-rig-gameplay-appearance-v1';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('../../', location.href);
  const npcDatabaseUrl = new URL('config/npcs/hobunji-starter-npc-database.json', docsBase).href; // Same authored NPC source the game consumes.
  const synced = new WeakMap(); // Pants handle -> exact descriptor/appearance signature already rendered into that handle.
  let npcDatabasePromise = null;
  let syncRunning = false;
  let lastResult = { ok: false, reason: 'not-synced-yet' };

  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const normalizeGender = value => {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'f' ? 'female' : gender === 'm' ? 'male' : gender;
  };
  const asEquipArray = value => {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === 'object') return Object.values(value).filter(item => typeof item === 'string' && item);
    return [];
  };

  // Mirrors the repository's gameplay-compatible NPC export normalization used by
  // Full Character Scale. Raw avatar-editor values remain authoritative, while the
  // top-level NPC record supplies newer explicit appearance overrides.
  function gameplayNpcDescriptor(npc) {
    npc ||= {};
    const raw = npc.avatarEditor?.rawExport || {};
    const profile = raw.profile || raw.avatarProfile || raw.npcProfile || raw;
    const appearance = {
      ...(profile.appearance || {}),
      ...(profile.visuals?.appearance || {}),
      ...(raw.appearance || {}),
      ...(npc.appearance || {}),
    };
    appearance.speciesId = normalizeSpecies(appearance.speciesId || appearance.species || npc.species);
    appearance.gender = normalizeGender(appearance.gender || npc.gender);
    appearance.cosmetics = {
      ...(profile.appearance?.cosmetics || {}),
      ...(profile.visuals?.appearance?.cosmetics || {}),
      ...(raw.appearance?.cosmetics || {}),
      ...(npc.appearance?.cosmetics || {}),
    };
    appearance.bodyColors = {
      ...(profile.appearance?.bodyColors || {}),
      ...(profile.visuals?.appearance?.bodyColors || {}),
      ...(raw.appearance?.bodyColors || {}),
      ...(npc.appearance?.bodyColors || {}),
    };
    return {
      id: npc.id || null,
      name: npc.name || npc.id || 'NPC',
      appearance,
      equippedCosmetics: asEquipArray(raw.equippedCosmetics || profile.equippedCosmetics || profile.cosmetics || profile.equipment || npc.equippedCosmetics),
      appliedDyes: raw.appliedDyes || profile.appliedDyes || profile.dyes || npc.appliedDyes || {},
      portrait: npc.portrait || {},
      rawExport: raw,
    };
  }

  async function npcDatabase() {
    if (!npcDatabasePromise) npcDatabasePromise = fetch(npcDatabaseUrl, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then(data => Array.isArray(data?.npcs) ? data.npcs : [])
      .catch(error => {
        npcDatabasePromise = null;
        throw error;
      });
    return npcDatabasePromise;
  }

  function npcForActor(actor, npcs) {
    const sourceId = String(actor?.source?.id || actor?.source?.npcId || '').trim();
    const sourceName = String(actor?.source?.name || actor?.label || '').trim();
    return npcs.find(npc => sourceId && String(npc.id || '').trim() === sourceId)
      || npcs.find(npc => sourceName && String(npc.name || '').trim() === sourceName)
      || null;
  }

  function pantsHandleFor(actor) {
    return actor?.rigFeetPreview?.pants || actor?.rigPantsPreview || null; // attachToLegs owns the gameplay tick/dispose lifecycle.
  }

  async function resolvedPortraitProfile(descriptor, actor) {
    const preview = window.NpcAvatarPreview;
    let profile = preview?.buildProfileFromNpcExport?.(descriptor) || null;
    if (profile && typeof profile.then === 'function') profile = await profile;
    return profile || actor?.model?.userData?.rigAvatarProfile || null;
  }

  function appearanceSignature(garmentId, appearance, descriptor) {
    return JSON.stringify({
      garmentId,
      primaryHex: appearance?.primaryHex || null,
      secondaryHex: appearance?.secondaryHex || null,
      patternHex: appearance?.patternHex || null,
      weaving: appearance?.weaving || null,
      appliedDyes: descriptor?.appliedDyes || {},
    });
  }

  async function syncActor(actor) {
    if (!actor || actor.source?.type !== 'npc') return { ok: false, reason: 'selected-actor-is-not-an-npc' };
    const Renderer = window.PantsGarmentRenderer;
    const pants = pantsHandleFor(actor);
    if (!Renderer || !pants || pants.disposed) return { ok: false, reason: 'gameplay-pants-handle-not-ready' };

    const npcs = await npcDatabase();
    const npc = npcForActor(actor, npcs);
    if (!npc) return { ok: false, reason: 'npc-record-not-found', actor: actor.source?.id || actor.id };
    const descriptor = gameplayNpcDescriptor(npc);
    const garmentId = Renderer.garmentForCosmetics?.(descriptor.equippedCosmetics || []) || null;
    if (!garmentId) return { ok: false, reason: 'npc-has-no-authored-leg-garment', npc: npc.id || npc.name };
    if (pants.garmentId !== garmentId) {
      // Starter NPC data keeps top-level and raw-export garment IDs in agreement.
      // Refuse to stack a second update wrapper if malformed authoring ever violates that invariant.
      return { ok: false, reason: 'garment-id-mismatch-requires-rig-rebuild', expected: garmentId, actual: pants.garmentId };
    }

    const portraitProfile = await resolvedPortraitProfile(descriptor, actor);
    const bodyColors = portraitProfile?.bodyColors || descriptor.appearance?.bodyColors || {};
    const appearance = Renderer.appearanceFromBodyColors?.(bodyColors) || {};
    const signature = appearanceSignature(garmentId, appearance, descriptor);
    const sourceFront = actor.model?.userData?.rigSourceFrontCanvas || null;
    const prior = synced.get(pants);
    if (prior?.signature === signature && prior?.sourceFront === sourceFront) {
      return { ok: true, unchanged: true, npc: npc.id || npc.name, garmentId };
    }

    await pants.setAppearance?.(appearance); // Same ClothingWeavingSystem path used by the live NPC garment.
    if (pants.disposed || pantsHandleFor(actor) !== pants) return { ok: false, reason: 'pants-handle-rebuilt-during-sync' };

    if (sourceFront && portraitProfile && Renderer.buildOverlayMask) {
      const mask = await Renderer.buildOverlayMask(sourceFront, portraitProfile, {
        seatId: npc.id || npc.name || actor.source?.id || actor.id,
      }); // Matches the normal front portrait render options instead of inventing an editor-only face state.
      if (!pants.disposed && pantsHandleFor(actor) === pants) pants.setOverlayMask?.(mask);
    }
    pants.update?.(); // Immediate parity refresh; later frames stay coupled to ProceduralLegAnimation via attachToLegs.
    synced.set(pants, { signature, sourceFront });
    return { ok: true, npc: npc.id || npc.name, garmentId, bodyColors: true };
  }

  async function syncSelectedNow() {
    if (syncRunning || document.body?.dataset?.animationAuthorMode !== 'rig') return lastResult;
    const actor = window.HobunjiAnimationAuthorHost?.selectedActor?.() || null;
    if (!actor?.source || actor.source.type !== 'npc') return lastResult;
    syncRunning = true;
    try {
      lastResult = await syncActor(actor);
      window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
      window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.rigGameplayAppearance = { patch: PATCH_ID, ...lastResult };
      return lastResult;
    } catch (error) {
      lastResult = { ok: false, reason: 'sync-error', error: error?.message || String(error) };
      window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
      window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.rigGameplayAppearance = { patch: PATCH_ID, ...lastResult };
      return lastResult;
    } finally {
      syncRunning = false;
    }
  }

  window.HobunjiAnimationAuthorRigGameplayAppearance = Object.freeze({
    gameplayNpcDescriptor,
    syncSelectedNow,
    diagnostics: () => ({ patch: PATCH_ID, ...lastResult }),
  });

  // Actor construction, NPC selection, and rig rebuilding are private to Animation
  // Author. A cheap selected-handle check bridges those lifecycle boundaries without
  // adding another render loop: unchanged handles return before any canvas rerender.
  const timer = window.setInterval(() => {
    if (document.body?.dataset?.animationAuthorMode === 'rig') syncSelectedNow();
  }, 400);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
  syncSelectedNow();
})();
