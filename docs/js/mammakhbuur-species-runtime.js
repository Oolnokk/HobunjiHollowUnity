// Mammakhbuur reuse the authored Mashtzarr anatomy; only the canonical whole-rig height differs by 5%.
(() => {
  'use strict';
  const ID = 'mammakhbuur'; // Shared species identity for player/NPC appearance, scale and attachment registries.
  const DONOR = 'mashtzarr'; // Authored cosmetic, palette, hand/foot and anatomy authority.
  const clone = value => JSON.parse(JSON.stringify(value)); // Copies donor data so edits never mutate Mashtzarr definitions.
  const config = window.SCRATCHBONES_CONFIG?.game; // All installed aliases use the existing runtime registries.
  const appearance = config?.appearanceEditor; // Adds the species to the ordinary editor and creator palette registries.
  if (appearance?.species?.[DONOR]) appearance.species[ID] = { ...clone(appearance.species[DONOR]), label: 'Mammakhbuur', parentSpecies: DONOR, genders: ['male', 'female'] };
  if (appearance?.bodyPalettes?.[DONOR]) appearance.bodyPalettes[ID] = clone(appearance.bodyPalettes[DONOR]);
  const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Same profile library consumed by hands, feet, posterior and rig tools.
  for (const gender of ['male', 'female']) {
    const source = characters?.[`${DONOR}::${gender}`]; // Reads the fully corrected donor profile after the authored snapshot loads.
    if (!source) continue;
    const profile = clone(source); // Keeps local anatomy independent of the donor.
    profile.species = ID;
    profile.gender = gender;
    if (profile.shoulderPerchRule) profile.shoulderPerchRule.appearanceSpeciesId = ID;
    if (profile.posteriorRule) profile.posteriorRule.appearanceSpeciesId = ID;
    profile.anatomy ||= {};
    for (const key of ['rigScale', 'rigScaleX', 'rigScaleY', 'headScale']) delete profile.anatomy[key];
    characters[`${ID}::${gender}`] = profile;
  }
  const feet = config?.assets?.pngPlaneAvatar?.proceduralFeet; // Donates foot models and their authored per-gender calibration, without adding a second parent scale.
  for (const table of Object.values(feet || {})) if (table && typeof table === 'object' && table[DONOR]) table[ID] = clone(table[DONOR]);
  window.HobunjiHandModelProfiles?.mutate?.(data => {
    data.speciesModels ||= {};
    if (data.speciesModels[DONOR]) data.speciesModels[ID] = data.speciesModels[DONOR];
  });
  window.applyHobunjiAttachmentRigProfileCorrections?.();

  const inAnimationAuthor = typeof location !== 'undefined' && /\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname); // Gates the comparison-only identity adapter away from normal gameplay and other tools.
  let fullScaleAdapter = null; // Exposed through debugSnapshot so mobile testing can prove the comparison adapter installed.
  if (inAnimationAuthor) {
    const SCALE_COMPARE_MODE = 'scale-compare'; // Scopes every override below to the Full Character Scale workspace only.
    const NPC_DB_SUFFIX = '/config/npcs/hobunji-starter-npc-database.json'; // Limits the fetch adapter to the comparison's representative-NPC database.
    const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''); // Normalizes authored species ids before comparison.
    const normalizeGender = value => { // Normalizes representative genders before donor matching.
      const gender = String(value || '').trim().toLowerCase();
      return gender === 'f' ? 'female' : gender === 'm' ? 'male' : gender;
    };
    const inComparison = () => document?.body?.dataset?.animationAuthorMode === SCALE_COMPARE_MODE; // Prevents comparison-specific behavior leaking into Multi, Single, or Rig modes.

    const baseTransformSpeciesId = window.hobunjiTransformSpeciesId; // Preserves the repository's normal Mammakhbuur→Mashtzarr transform alias outside Full Character Scale.
    if (typeof baseTransformSpeciesId === 'function' && !baseTransformSpeciesId.__mammakhbuurScaleCompareWrapped) {
      const transformSpeciesId = value => { // Keeps an explicitly registered Mammakhbuur profile from deduplicating into Mashtzarr in the comparison lineup.
        const species = normalizeSpecies(value);
        if (inComparison() && species === ID) return ID;
        return baseTransformSpeciesId(value);
      };
      transformSpeciesId.__mammakhbuurScaleCompareWrapped = true;
      transformSpeciesId.__mammakhbuurScaleCompareBase = baseTransformSpeciesId;
      window.hobunjiTransformSpeciesId = transformSpeciesId;
    }

    const npcSpecies = npc => normalizeSpecies(npc?.appearance?.speciesId || npc?.species); // Finds exact Mammakhbuur and same-gender Mashtzarr representatives.
    const npcGender = npc => normalizeGender(npc?.appearance?.gender || npc?.gender); // Matches representatives to the requested comparison gender.
    const retargetAppearance = (target, gender) => { // Retargets nested exported appearances so preview rendering resolves Mammakhbuur head assets.
      if (!target || typeof target !== 'object') return;
      target.speciesId = ID;
      target.gender = gender;
    };
    const retargetRepresentative = (source, gender) => { // Creates a preview-only representative when no authored Mammakhbuur NPC exists for a gender.
      const npc = clone(source);
      npc.id = `full_scale_${ID}_${gender}_preview`;
      npc.name = `Mammakhbuur ${gender} comparison`;
      npc.species = 'Mammakhbuur';
      npc.gender = gender;
      npc.ageBand = 'adult';
      npc.appearance = { ...(npc.appearance || {}), speciesId: ID, gender };
      const raw = npc.avatarEditor?.rawExport; // Carries Character Studio appearance data used by NpcAvatarPreview.
      if (raw && typeof raw === 'object') {
        raw.appearance = { ...(raw.appearance || {}), speciesId: ID, gender };
        retargetAppearance(raw.profile?.appearance, gender);
        retargetAppearance(raw.profile?.visuals?.appearance, gender);
        retargetAppearance(raw.avatarProfile?.appearance, gender);
        retargetAppearance(raw.avatarProfile?.visuals?.appearance, gender);
        retargetAppearance(raw.npcProfile?.appearance, gender);
        retargetAppearance(raw.npcProfile?.visuals?.appearance, gender);
      }
      return npc;
    };
    const ensureRepresentatives = data => { // Guarantees both Mammakhbuur genders can be rendered without adding fake NPCs to the shipping database.
      const npcs = Array.isArray(data?.npcs) ? data.npcs : null; // Mutable clone of the fetched comparison database only.
      if (!npcs) return data;
      for (const gender of ['male', 'female']) {
        if (npcs.some(npc => npcSpecies(npc) === ID && npcGender(npc) === gender)) continue;
        const donor = npcs.find(npc => npcSpecies(npc) === DONOR && npcGender(npc) === gender && String(npc?.ageBand || '').toLowerCase() !== 'child')
          || npcs.find(npc => npcSpecies(npc) === DONOR && npcGender(npc) === gender); // Same-gender Mashtzarr supplies appearance only when an authored Mammakhbuur representative is absent.
        if (donor) npcs.push(retargetRepresentative(donor, gender));
      }
      return data;
    };

    const baseFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null; // Delegates every request unchanged except the comparison representative database.
    if (baseFetch && typeof Response === 'function' && typeof Headers === 'function' && !window.__hobunjiMammakhbuurScaleCompareFetchWrapped) {
      window.__hobunjiMammakhbuurScaleCompareFetchWrapped = true;
      window.fetch = async (...args) => {
        const response = await baseFetch(...args);
        const request = args[0]; // Resolves either a URL string or a Request-like object.
        const rawUrl = typeof request === 'string' ? request : request?.url; // Supplies the request URL to the path guard below.
        let url = null; // Safely holds the parsed URL without affecting malformed or opaque requests.
        try { url = new URL(rawUrl, location.href); } catch (_) {}
        if (!inComparison() || !url?.pathname?.endsWith(NPC_DB_SUFFIX) || !response?.ok) return response;
        let data = null; // Holds the cloned database while preview-only representatives are injected.
        try { data = await response.clone().json(); } catch (_) { return response; }
        ensureRepresentatives(data);
        const headers = new Headers(response.headers); // Preserves original response metadata while replacing only its JSON body.
        headers.set('content-type', 'application/json');
        return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
      };
    }

    fullScaleAdapter = Object.freeze({
      speciesId: ID,
      donorSpeciesId: DONOR,
      debugSnapshot: () => ({
        active: inComparison(),
        speciesId: ID,
        donorSpeciesId: DONOR,
        latestChange: 'Full Character Scale keeps Mammakhbuur distinct from Mashtzarr and creates a preview-only same-gender Mashtzarr representative when an authored Mammakhbuur NPC is missing.',
      }),
    });
    window.HobunjiMammakhbuurScaleCompareAdapter = fullScaleAdapter;
  }

  window.HobunjiMammakhbuurSpecies = Object.freeze({
    speciesId: ID, parentSpecies: DONOR,
    debugSnapshot: () => ({
      speciesId: ID,
      parentSpecies: DONOR,
      rigHeightMultiplier: 1.05,
      rigWidthMultiplier: 1,
      headScaleMultiplier: 1,
      verticalPlacementMultiplier: 1,
      fullCharacterScaleDistinctIdentity: !!fullScaleAdapter,
      fullCharacterScaleRepresentativeFallback: fullScaleAdapter ? 'mashtzarr-same-gender-preview-only' : null,
      latestChange: 'Mammakhbuur use Mashtzarr anatomy with only 5% extra whole-rig height; Animation Author Full Character Scale keeps Mammakhbuur separately visible beside Mashtzarr.',
    }),
  });
})();
