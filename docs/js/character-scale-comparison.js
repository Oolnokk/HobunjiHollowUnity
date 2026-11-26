// Animation Author full-character species/gender scale comparison tab.
//
// The lineup is deliberately NOT built from Animation Author actors. Each entry is
// a preview-only avatar group attached directly to the public backdrop scene, using
// the same free-hand parent and ProceduralLegAnimation setup as the Rig Coordinates
// reference-NPC preview. This keeps comparison previews out of Multi/Rig actor state
// and makes selection independent from the editor's selected actor.
(() => {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const MODE = 'scale-compare';
  const TAB_ID = 'maaFullScaleTab';
  const PANEL_ID = 'maaFullScalePanel';
  const RIG_SAVE_KEY = 'hobunjiAttachmentRigProfiles.v2';
  const UPLOADED_SCALE_MIGRATION_KEY = 'hobunjiFullCharacterApprovedScales.upload3.v1'; // Import uploaded 26-profile scale baseline on devices that retain an older local save.
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('../../', location.href);
  const npcDbUrl = new URL('config/npcs/hobunji-starter-npc-database.json', docsBase).href;
  const chairUrl = new URL('config/furniture-authored/chairSimple.json', docsBase).href;

  let active = false;
  let building = false;
  let generation = 0;
  let originMode = 'multi';
  let pendingExitMode = null; // Last requested native mode during an async workspace restoration.
  let exitingPromise = null; // Serializes scene/project import so rapid mobile taps cannot duplicate the restore.
  let nativeWorkspaceVisibility = null; // Native scene root and its prior visibility, restored when the isolated scale preview closes.
  const isolationDebug = { entries: 0, exits: 0, nativeProjectImports: 0 }; // Mobile diagnostics: project imports must remain zero while comparing scales.
  let entries = [];
  let selected = null;
  let previewRoot = null; // Holds comparison-only avatar groups and is never registered in Animation Author mode state.
  let chair = null;
  let sixFootGuide = null; // One camera-facing 6 ft reference behind the lineup, independent of camera-fit bounds.
  let sixFootHeight = null; // World-space reference computed once from the authored chair back height.
  let sixFootGuideDepth = 2; // Fallback background depth if no completed lineup bounds exist.
  let sixFootLineupBounds = null; // Four X/Z extents cached at layout time; camera orbit tests only four scalars per frame.
  let unsubscribePixelHeights = null; // One listener per open lineup; later bare-PNG measurements trigger ONE calibrated rerender, never per-frame rescans.
  let THREE = null;
  let persistTimer = 0;
  let handScaleTimer = 0; // Debounces hand-GLB rebuilds during touch drags; numeric profile changes still save immediately.
  const originalPartRuntime = new Map(); // Captures each species' runtime hand/foot defaults before Full Character Scale mutates their shared lookup tables.
  let longoranFeetTimer = 0; // Rebuilds the author-only leg preview after a posture/gait slider settles.
  let longoranWalkTimer = 0; // Runs an isolated, user-requested walk preview; never a gameplay frame loop.
  let focusedEntryKey = null; // Only the explicit Focus selected action changes camera focus; selection and slider edits never reframe it.
  let manualViewInteraction = false; // During progressive loading, prevents a final automatic lineup frame after any actual user input or camera gesture.
  let showSpineGuides = true; // Full Character Scale displays the real seven-node spline and cyan head attachment until the user hides it.
  let portraitRenderChain = Promise.resolve(); // Serializes portrait rendering because NpcAvatarPreview temporarily installs the active NPC account shim.
  const AGE_SAVE_KEY = 'hobunjiFullCharacterScale.ageModes.v1'; // Keeps global phase proportions separate from per-species rig-profile autosaves.
  const AGE_MODES = ['adult', 'baby', 'toddler', 'child']; // Full lineup modes, with adult as the unmodified reference.
  const AGE_AXES = ['width', 'height', 'head', 'hand', 'foot', 'widthConvergence', 'heightConvergence']; // Separate width/height for every global baby/toddler/child stage, plus head/limbs.
  let ageMode = 'adult'; // Current preview stage; never stored on individual NPCs or their authored rig profiles.
  let ageProfiles = {}; // Per-stage per-species/gender baked values; adult rig fields remain in the host's normal authoring store.
  let ageOverall = {adult:1,baby:1,toddler:1,child:1}; // Temporary uniform preview, reset after baking.
  let stageBasisCache = null; // Current-stage convergence reference, invalidated by individual edits or adult reference changes.
  let ageConvergenceBasis = null; // Cached relative adult dimensions across all loaded lineup identities; invalidated when adult art/scales change.
  let ageModifiers = {}; // Editable age-wide values, initialized from gameplay configuration and then local editor overrides.
  let ageLimbTimer = 0; // Bounded retry window for hands/feet whose GLB visuals arrive after the portrait.
  const ageLimbBases = new WeakMap(); // Original per-visual limb scales, so switching modes never compounds multipliers.
  let selectedLayoutFrame = 0; // Batches per-species (non-age) width/head edits so neighboring lineup actors never overlap.
  let ageRenderFrame = 0; // Coalesces rapid touch slider updates into one lineup/layout pass per display frame.
  let ageDirtyBody = false; // Set when body/head changes require whole-rig transforms and bounding-box layout.
  let ageDirtyLimb = null; // 'hand' or 'foot' limits visual-only updates to the changed GLB type.
  const agePerf = { rigPasses: 0, layoutPasses: 0, limbLookups: 0, lateRetries: 0, handSyncs: 0 }; // Mobile-accessible counters for debugging slider performance.

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const normalizeGender = value => {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'f' ? 'female' : gender === 'm' ? 'male' : gender;
  };
  const canonicalSpecies = value => {
    const species = normalizeSpecies(value);
    if (typeof window.hobunjiTransformSpeciesId === 'function') return normalizeSpecies(window.hobunjiTransformSpeciesId(species));
    return species === 'rakakoan' ? 'kenkari' : species === 'ghoul' ? 'mao-ao' : species;
  };
  const prettySpecies = value => String(value || '').split('-').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join('-');
  const clampPercent = value => Math.max(10, Math.min(400, Number(value) || 100)); // Matches HobunjiCharacterRigScale's own [0.1, 4] clamp.
  const clampOffsetPercent = value => Math.max(-50, Math.min(50, Number(value) || 0)); // Matches HobunjiCharacterRigScale.maxOffsetFraction.
  const clampAgePercent = value => Math.max(0, Math.min(100, Number(value) || 0));
  const LONGORAN_TUNING = Object.freeze({
    Hunch: { field: 'hunch', min: 0, max: 100 },
    Kyphosis: { field: 'kyphosis', min: 0, max: 100 },
  }); // Match Enemy Loadout Editor: only the static spine shape is authored here, in percent. Gait keeps its shared Maskbound defaults.

  function repositoryAgeModifiers() {
    const shared = window.HobunjiCharacterAgeRigConfig?.repositoryDefaults?.(); // Same stages and axes as gameplay.
    if (shared) return { adult: { width: 1, height: 1, head: 1, hand: 1, foot: 1, widthConvergence: 0, heightConvergence: 0 }, ...shared };
    const phases = window.HobunjiRomanceConfig?.family?.phaseScales || {};
    const png = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
    const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
    const mode = (phase, fallback) => ({
      width: positive(phase?.width, positive(phase?.body, fallback.width)),
      height: positive(phase?.height, positive(phase?.body, fallback.height)),
      head: positive(phase?.head, fallback.head),
      hand: positive(phase?.hand, fallback.hand),
      foot: positive(phase?.foot, fallback.foot),
      widthConvergence: Math.max(0, Math.min(1, Number(phase?.widthConvergence) || 0)),
      heightConvergence: Math.max(0, Math.min(1, Number(phase?.heightConvergence) || 0)),
    }); // Existing body-only stages initialize BOTH dimensions.
    return {
      adult: { width: 1, height: 1, head: 1, hand: 1, foot: 1, widthConvergence: 0, heightConvergence: 0 },
      baby: mode(phases.basket, { width: .32, height: .32, head: .50, hand: 1.2, foot: 1.2 }),
      toddler: mode(phases.toddler, { width: .4, height: .4, head: .66, hand: 1, foot: 1 }),
      child: mode(phases.child, {
        width: positive(png.childWidthScaleMultiplier, positive(png.childScaleMultiplier, .5)),
        height: positive(png.childScaleMultiplier, .5),
        widthConvergence: Number(png.childWidthConvergence) || 0,
        heightConvergence: Number(png.childHeightConvergence) || 0,
        head: positive(png.childHeadScaleMultiplier, .72),
        hand: positive(window.HobunjiRomanceConfig?.family?.childLimbModifiers?.hand, 1),
        foot: positive(window.HobunjiRomanceConfig?.family?.childLimbModifiers?.foot, 1),
      }),
    };
  }

  function clampAgeModifier(value, axis, fallback) {
    const n = Number(value); // Only finite percentages from UI/storage are allowed to reach preview transforms.
    if (axis.endsWith('Convergence')) return value != null && value !== '' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
    return Number.isFinite(n) && n > 0 ? Math.max(axis === 'hand' || axis === 'foot' ? .5 : .1, Math.min(2, n)) : fallback;
  }

  function loadAgeModifiers() {
    const defaults = repositoryAgeModifiers(); // Gameplay defaults are the baseline when no user-authored phase override exists.
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(AGE_SAVE_KEY) || 'null'); }
    catch (error) { console.warn('[full-character-scale] invalid age-mode autosave', error); }
    ageModifiers = defaults;
    ageProfiles = window.HobunjiCharacterAgeRigConfig?.repositoryProfiles?.() || {}; // New authoritative uploaded baby values replace old global-only baby drafts once.
    ageOverall = {adult:1,baby:1,toddler:1,child:1}; stageBasisCache = null;
    const ageApi = window.HobunjiCharacterAgeRigConfig;
    if (saved?.schema === 'hobunji.character-age-rig-modifiers.v1' && ageApi?.upgradePresetProfiles) ageProfiles = ageApi.upgradePresetProfiles(saved.profiles,saved.presetVersion);
    else if (saved?.profiles) ageProfiles = ageApi?.sanitizeProfiles?.(saved.profiles) || saved.profiles;
    if (saved?.schema !== 'hobunji.character-age-rig-modifiers.v1') return;
    for (const mode of AGE_MODES.filter(value => value !== 'adult')) for (const axis of AGE_AXES) {
      if ((mode === 'baby' || mode === 'toddler') && ageApi?.presetVersion && !(Number(saved.presetVersion) >= ageApi.presetVersion)) continue; // Import the supplied baby preset once, not the obsolete global-only draft.
      if (saved.profiles && axis.endsWith('Convergence')) continue; // Preview strength is not durable.
      ageModifiers[mode][axis] = clampAgeModifier(saved.modifiers?.[mode]?.[axis] ?? ((axis === 'width' || axis === 'height') ? saved.modifiers?.[mode]?.body : null), axis, defaults[mode][axis]); // Legacy body autosaves map to both axes.
    }
    if (ageApi?.presetVersion && !(Number(saved.presetVersion) >= ageApi.presetVersion)) persistAgeModifiers(); // Replace old baby/toddler values once on this browser; retain subsequent authoring.
  }

  function persistAgeModifiers() {
    try { localStorage.setItem(AGE_SAVE_KEY, JSON.stringify({ schema: 'hobunji.character-age-rig-modifiers.v1', presetVersion: window.HobunjiCharacterAgeRigConfig?.presetVersion, modifiers: Object.fromEntries(Object.entries(ageModifiers).map(([mode,row])=>[mode,{...row,widthConvergence:0,heightConvergence:0}])), profiles: ageProfiles })); }
    catch (error) { console.warn('[full-character-scale] age-mode autosave failed', error); }
  }

  function ageValues() {
    return ageModifiers[ageMode] || ageModifiers.adult || { width: 1, height: 1, head: 1, hand: 1, foot: 1, widthConvergence: 0, heightConvergence: 0 }; // Safe even when the shared bridge provides only baby/toddler/child or an old draft is malformed.
  }

  function allAgeIdentities() {
    const keys = Object.keys(window.HobunjiCharacterRigScaleDefaults?.uploadedScaleRestoreValues || {});
    const map = new Map(keys.map(key=>{const [species,gender]=key.split('::');return [key,{key,species,gender}];}));
    for (const mode of ['baby','toddler','child']) for(const key of Object.keys(ageProfiles[mode]||{})) {
      if(!map.has(key)){const [species,gender]=key.split('::');map.set(key,{key,species,gender});}
    }
    for (const entry of entries) map.set(entry.key, entry);
    return [...map.values()];
  }
  function individualAgeValues(entry, mode = ageMode) {
    const base = ageModifiers[mode] || ageValues();
    if (!entry || mode === 'adult') return base;
    const individual = ageProfiles[mode]?.[entry.key] || window.HobunjiCharacterAgeRigConfig?.profileFor?.(mode,entry.species,entry.gender,ageProfiles);
    return {width:base.width,height:base.height,head:base.head,hand:base.hand,foot:base.foot,...individual,widthConvergence:0,heightConvergence:0};
  }
  function stageRows(mode = ageMode) {
    return Object.fromEntries(allAgeIdentities().map(entry=>[entry.key,individualAgeValues(entry,mode)]));
  }
  function adultScaleForEntry(entry) {
    return window.HobunjiCharacterRigScale?.scaleFor?.(entry.species,entry.gender,entry.profile) || window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(entry.species,entry.gender);
  }
  function currentStageReference(mode=ageMode) {
    const api=window.HobunjiCharacterAgeRigConfig;
    const rows=Object.fromEntries(allAgeIdentities().map(entry=>[entry.key,api.relativeProfile(individualAgeValues(entry,mode),adultScaleForEntry(entry))]));
    return api.stageConvergenceBasis(rows,lineupConvergenceBasis()); // Measure the currently effective shape, including any frozen adult reference.
  }
  function previewAgeValues(entry, authored=adultScaleForEntry(entry)) {
    const api = window.HobunjiCharacterAgeRigConfig;
    const row = individualAgeValues(entry);
    if (ageMode === 'adult' || !api?.convergeProfile) return ageValues(); // Legacy test/host fallback retains global behavior.
    const strength = ageValues();
    if (!(strength.widthConvergence || strength.heightConvergence)) return api.scaledProfile(api.relativeProfile(row,authored),ageOverall[ageMode]);
    if (!stageBasisCache) stageBasisCache = currentStageReference();
    return api.scaledProfile(api.relativeProfile(api.convergeProfile(row,stageBasisCache[entry.key],strength),authored),ageOverall[ageMode]);
  }
  function editIndividualAge(axis, raw) {
    if (!selected || ageMode === 'adult') return;
    if (axis.endsWith('Convergence')) { applyAgeModifiers(axis,raw); return; }
    const n = Number(raw)/100; // Individual values may be smaller/larger than the old global bounds after a bake.
    if (!Number.isFinite(n) || n <= 0) return;
    ageProfiles[ageMode] ||= {};
    ageProfiles[ageMode][selected.key] = {...individualAgeValues(selected),[axis]:Math.max(.01,Math.min(20,n))};
    stageBasisCache=null; persistAgeModifiers(); syncAgeControls(); queueAgeRender(axis);
  }
  function bakeConvergence() {
    if (ageMode === 'adult') return;
    const api = window.HobunjiCharacterAgeRigConfig;
    const rows = stageRows();
    if (!api?.stageConvergenceBasis) return;
    const basis = currentStageReference();
    const next = Object.fromEntries(Object.entries(rows).map(([key,row])=>[key,api.convergeProfile(row,basis[key],ageValues())]));
    if(Object.values(next).some(row=>[row.width,row.height].some(v=>!Number.isFinite(v)||v<.01||v>20))) {status('Cannot bake convergence: a resulting value exceeds the 1–2000% individual bounds. Reduce convergence strength.');return;}
    ageProfiles[ageMode] = next;
    ageValues().widthConvergence=0; ageValues().heightConvergence=0; stageBasisCache=null;
    persistAgeModifiers(); syncAgeControls(); queueAgeRender('width'); status('Convergence baked into individual values; sliders reset to zero.');
  }
  function previewOverall(raw) {
    const factor=Number(raw)/100;
    if (!Number.isFinite(factor)||factor<.1||factor>4) return;
    ageOverall[ageMode]=factor; syncAgeControls(); queueAgeRender('width');
  }
  function bakeOverall() {
    const factor=ageOverall[ageMode];
    if (factor===1) return;
    const api=window.HobunjiCharacterAgeRigConfig;
    if (!api?.scaledProfile) return;
    if (ageMode==='adult') {
      const bridge=host(), rig=window.HobunjiCharacterRigScale;
      if (!bridge?.setRigScale || !rig?.scaleFor) return;
      const identities=allAgeIdentities(); const canonical=new Map();
      for (const entry of identities) {
        const species=window.hobunjiTransformSpeciesId?.(entry.species)||entry.species;
        const key=species+'::'+entry.gender;
        if (!canonical.has(key)) {
          const scale=rig.scaleFor(entry.species,entry.gender,entry.profile);
          const anatomy=entry.profile?.anatomy || rig.profileFor?.(species,entry.gender)?.anatomy || {};
          canonical.set(key,{species,gender:entry.gender,scale:{...scale,handScale:anatomy.handScale,footScale:anatomy.footScale}});
        }
      }
      const updates=[...canonical.values()].map(({species,gender,scale})=>({species,gender,next:{...scale,x:scale.x*factor,y:scale.y*factor,legLength:(scale.legLength||scale.y)*factor,head:scale.head*factor}}));
      if(updates.some(({next})=>[next.x,next.y,next.legLength,next.head].some(v=>!Number.isFinite(v)||v<.1||v>4))) { status('Cannot bake adult overall scale: one or more adult rig values would exceed the existing 10–400% bounds. Choose a smaller adjustment.'); return; }
      // Adult overall resize must not change the already-authored size of any younger stage.
      const compensated=Object.fromEntries(['baby','toddler','child'].map(mode=>[mode,Object.fromEntries(identities.map(entry=>{
        const adult=adultScaleForEntry(entry); const row=api.relativeProfile(individualAgeValues(entry,mode),adult);
        return [entry.key,{...api.scaledProfile(row,1/factor),adultReference:api.rigReference({x:adult.x*factor,y:adult.y*factor,head:adult.head*factor})}];
      }))])); // Store the new adult reference so same-site gameplay preserves young dimensions even before deploying the adult rig export.
      if(Object.values(compensated).some(rows=>Object.values(rows).some(row=>[row.width,row.height,row.head].some(v=>v<.01||v>20)))) { status('Cannot bake adult scale without exceeding younger-stage authoring bounds.'); return; }
      updates.forEach(({species,gender,next},i)=>bridge.setRigScale(species,gender,next,{persist:i===updates.length-1}));
      Object.assign(ageProfiles,compensated); persistProfiles(); ageConvergenceBasis=null;
    } else {
      const rows=stageRows();
      const next=Object.fromEntries(Object.entries(rows).map(([key,row])=>[key,api.scaledProfile(row,factor)]));
      if(Object.values(next).some(row=>[row.width,row.height,row.head].some(v=>v<.01||v>20))) {status('Cannot bake: an individual value would exceed the 1–2000% bounds.');return;}
      ageProfiles[ageMode]=next;
    }
    ageOverall[ageMode]=1; stageBasisCache=null; persistAgeModifiers(); if(selected) select(selected);
    syncAgeControls(); queueAgeRender('width'); status('Overall scale baked into individual values; slider reset to 100%.');
  }

  function host() {
    return window.HobunjiAnimationAuthorScaleHost || window.HobunjiAnimationAuthorHost || null;
  }

  const LINEUP_SPECIES_ORDER = Object.freeze([ // Family order matches onboarding lore; male/female remain adjacent for every entry.
    'kenkari',
    'tletingan', 'nuhongan', 'longoran', // Slagothim subspecies, together after Kenkari.
    'engh-sho', 'mao-ao', // These two species compare directly next to each other.
    'mashtzarr', 'mammakhbuur', // Oliphanti subspecies, after Engh-sho and Mao'ao.
  ]);
  const LINEUP_SPECIES_RANK = new Map(LINEUP_SPECIES_ORDER.map((species, index) => [species, index])); // Reused for preview, dropdown and stable future-species sorting.
  function lineupFamily(species) {
    const id = normalizeSpecies(species); // Normalize data from the species registry, not NPC display names.
    if (id === 'kenkari') return 0;
    if (['tletingan', 'nuhongan', 'longoran'].includes(id)) return 1;
    if (id === 'engh-sho' || id === 'mao-ao') return 2;
    if (id === 'mashtzarr' || id === 'mammakhbuur') return 3;
    return 4; // All other species follow alphabetically, including future registrations.
  }
  function compareLineupEntries(left, right) {
    const familyDiff = lineupFamily(left.species) - lineupFamily(right.species);
    if (familyDiff) return familyDiff;
    const firstRank = LINEUP_SPECIES_RANK.get(left.species) ?? LINEUP_SPECIES_ORDER.length;
    const secondRank = LINEUP_SPECIES_RANK.get(right.species) ?? LINEUP_SPECIES_ORDER.length;
    if (firstRank !== secondRank) return firstRank - secondRank;
    const speciesDiff = String(left.species).localeCompare(String(right.species));
    if (speciesDiff) return speciesDiff;
    const genderRank = gender => gender === 'male' ? 0 : gender === 'female' ? 1 : 2; // Same-species males appear directly before females.
    return genderRank(left.gender) - genderRank(right.gender);
  }
  function lineupSpacing(previous, next) {
    if (!previous || !next) return 0;
    if (previous.species === next.species) return 0.14; // Tight male/female pair without overlapping feet or portraits.
    return lineupFamily(previous.species) === lineupFamily(next.species) ? 0.42 : 0.72; // Clear family transitions without inserting extra meshes.
  }

  function profileDescriptors() {
    const profiles = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    const seen = new Set();
    const out = [];
    for (const [key, profile] of Object.entries(profiles)) {
      const [rawSpecies, rawGender] = key.split('::');
      const keySpecies = normalizeSpecies(rawSpecies);
      const profileSpecies = normalizeSpecies(profile?.species || keySpecies);
      const gender = normalizeGender(rawGender || profile?.gender);
      if (!keySpecies || keySpecies !== profileSpecies || !['male', 'female'].includes(gender)) continue;
      const species = canonicalSpecies(keySpecies);
      const canonicalKey = `${species}::${gender}`;
      if (seen.has(canonicalKey)) continue;
      seen.add(canonicalKey);
      out.push({ key: canonicalKey, species, gender });
    }
    return out.sort(compareLineupEntries); // One canonical order for loading, the visual lineup and the species chooser.
  }

  function portraitExportFor(npc) {
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
    const asEquipArray = value => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value && typeof value === 'object') return Object.values(value).filter(item => typeof item === 'string' && item);
      return [];
    };
    return {
      name: npc.name || npc.id || 'NPC',
      appearance,
      equippedCosmetics: asEquipArray(raw.equippedCosmetics || profile.equippedCosmetics || profile.cosmetics || profile.equipment || npc.equippedCosmetics),
      appliedDyes: raw.appliedDyes || profile.appliedDyes || profile.dyes || npc.appliedDyes || {},
      portrait: npc.portrait || {},
      rawExport: raw,
    };
  }

  function npcAppearance(npc) {
    return portraitExportFor(npc).appearance;
  }

  function isChild(npc) {
    try { return !!window.PNGPlaneAvatar?.isChildAvatar?.({ npcRecord: npc }); }
    catch (_) {}
    const markers = [npc?.ageBand, npc?.role, ...(npc?.tags || []), ...(npc?.roles || [])].map(value => String(value || '').toLowerCase());
    return markers.includes('child');
  }

  async function json(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function representatives() {
    const db = await json(npcDbUrl);
    const npcs = Array.isArray(db?.npcs) ? db.npcs : [];
    return profileDescriptors().map(target => {
      const candidates = npcs.map(npc => ({ npc, appearance: npcAppearance(npc) }))
        .filter(item => item.appearance.gender === target.gender);
      const exact = candidates.filter(item => normalizeSpecies(item.appearance.speciesId) === target.species);
      const compatible = candidates.filter(item => canonicalSpecies(item.appearance.speciesId) === target.species);
      const pool = exact.length ? exact : compatible;
      const picked = pool.find(item => !isChild(item.npc)) || pool[0] || null;
      if (picked) return { ...target, npc: picked.npc };
      // Nuhongan share Tletingan appearance, but must keep their own editable scale.
      const donor = (target.species === 'nuhongan' || target.species === 'longoran')
        ? candidates.find(item => normalizeSpecies(item.appearance.speciesId) === 'tletingan' && !isChild(item.npc))
        : null; // Supplies an adult, same-gender preview without creating a world NPC.
      if (!donor) return { ...target, npc: null };
      const npc = clone(donor.npc); // Isolates preview identity and appearance from the authored NPC database.
      npc.id = `full_scale_${target.species}_${target.gender}_preview`;
      npc.name = `${prettySpecies(target.species)} ${target.gender} comparison`;
      npc.species = target.species;
      npc.gender = target.gender;
      npc.appearance = { ...npcAppearance(donor.npc), speciesId: target.species, gender: target.gender };
      npc.avatarEditor ||= {};
      npc.avatarEditor.rawExport ||= {};
      npc.avatarEditor.rawExport.appearance = clone(npc.appearance);
      for (const profileKey of ['profile', 'avatarProfile', 'npcProfile']) {
        const profile = npc.avatarEditor.rawExport[profileKey]; // Retargets nested Character Studio exports while retaining donor cosmetics and equipment.
        if (profile?.appearance) Object.assign(profile.appearance, { speciesId: target.species, gender: target.gender });
        if (profile?.visuals?.appearance) Object.assign(profile.visuals.appearance, { speciesId: target.species, gender: target.gender });
      }
      return { ...target, npc };
    });
  }

  function ensureStyle() {
    if (document.getElementById('maaFullScaleStyle')) return;
    const style = document.createElement('style');
    style.id = 'maaFullScaleStyle';
    style.textContent = `
body[data-animation-author-mode="${MODE}"] #maaLeftPanel,
body[data-animation-author-mode="${MODE}"] #maaRightPanel,
body[data-animation-author-mode="${MODE}"] #maaTimeline,
body[data-animation-author-mode="${MODE}"] #maaPlayBtn,
body[data-animation-author-mode="${MODE}"] #maaStopBtn,
body[data-animation-author-mode="${MODE}"] #maaNewBtn,
body[data-animation-author-mode="${MODE}"] #maaUndoBtn{display:none!important}
body[data-animation-author-mode="${MODE}"] #maaViewportBadge{left:12px;right:12px;max-width:none;text-align:center}
#${PANEL_ID}{display:none;position:absolute;z-index:18;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(680px,calc(100% - 20px));max-height:min(68dvh,calc(100dvh - 150px));overflow-y:auto;overscroll-behavior:contain;align-content:start;padding:10px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(7,16,26,.94);backdrop-filter:blur(10px);gap:8px}
body[data-animation-author-mode="${MODE}"] #${PANEL_ID}{display:grid!important;visibility:visible!important}
body[data-animation-author-mode="${MODE}"] #maaTopbar{z-index:25} /* Tabs remain accessible on small touch displays. */
#${PANEL_ID} .scaleHead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#${PANEL_ID} #maaFullScaleChoose{flex:1 1 145px;min-width:0;max-width:100%;padding:6px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:#17222f;color:inherit}
#${PANEL_ID} .scaleSelected{font-weight:850;color:var(--accent)}
#${PANEL_ID} .scaleRow{display:grid;grid-template-columns:minmax(0,1fr) 68px;gap:8px;align-items:center}
#${PANEL_ID} input[type=range]{width:100%;min-height:44px;padding:0;accent-color:var(--accent)}
#${PANEL_ID} output{text-align:right;color:var(--accent);font-weight:850;font-variant-numeric:tabular-nums}
#${PANEL_ID} .scaleActions{display:flex;gap:7px;flex-wrap:wrap}
#${PANEL_ID} .scaleStatus{font-size:10px;color:var(--muted)}
 #${PANEL_ID} #maaFullScaleAdultFields[hidden],#${PANEL_ID} #maaFullScaleLongoranControls[hidden],#${PANEL_ID} #maaFullScaleAgeControls[hidden],#${PANEL_ID} .scaleRow[hidden]{display:none!important}
#${PANEL_ID} #maaFullScaleAgeMode{flex:1 1 170px;min-width:0;background:#17222f;color:inherit;padding:6px;border:1px solid rgba(255,255,255,.25);border-radius:6px}
#${PANEL_ID} #maaFullScaleAgeControls{display:grid;gap:4px;padding:8px;border:1px solid rgba(167,139,250,.4);border-radius:9px}
#${PANEL_ID} #maaFullScaleAgeControls .scaleRow{grid-template-columns:80px minmax(0,1fr) 64px}
#${PANEL_ID} #maaFullScaleAgeControls input[type=number]{min-width:0;width:100%}
#${PANEL_ID} #maaFullScaleLongoranControls{min-width:0;max-height:none;overflow:visible;border:1px solid rgba(255,255,255,.24);padding:8px;border-radius:9px} /* The outer editor rail owns the only scroll surface; 32vh nested clipping previously hid Hunch/Kyphosis. */
#${PANEL_ID} #maaFullScaleLongoranControls .longoranIntro{display:block;margin:4px 0;font-size:11px;line-height:1.35;color:var(--muted)}
#${PANEL_ID} #maaFullScaleLongoranControls .armLengthHint{margin:3px 0 0;font-size:10px;color:var(--muted)}
#${PANEL_ID} .longoranRows{display:grid;grid-template-columns:minmax(0,1fr);gap:5px}
#${PANEL_ID} .longoranTuningRow{display:grid;grid-template-columns:minmax(0,100px) minmax(0,1fr) 67px;gap:7px;align-items:center}
#${PANEL_ID} .longoranTuningRow input[type=number]{width:100%;min-width:0}
#${PANEL_ID} .longoranTuningRow input[type=range]{min-width:0}
#${PANEL_ID} .longoranTuningActions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:6px}
`;
    document.head.appendChild(style);
  }

  function ensureUi() {
    ensureStyle();
    const tabs = document.getElementById('maaModeTabs');
    const workspace = document.getElementById('maaWorkspace');
    if (!tabs || !workspace) return false;

    if (!document.getElementById(TAB_ID)) {
      const tab = document.createElement('button');
      tab.id = TAB_ID;
      tab.type = 'button';
      tab.className = 'secondary';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.textContent = 'Full character scale';
      tabs.appendChild(tab);
      tab.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        enter();
      }, true);
    }

    if (!document.getElementById(PANEL_ID)) {
      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.className = 'maaInteractive';
      const scaleRow = (axis, label, min, max, step, value, ariaLabel) => `
        <div class="scaleRow">
          <label for="maaFullScaleRange${axis}">${label}</label>
          <input id="maaFullScaleRange${axis}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${ariaLabel}">
          <input id="maaFullScaleNum${axis}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${ariaLabel} (exact value)">%
        </div>`;
      const longoranRow = (key, label, min, max, step, value, unit = '') => `
        <label class="longoranTuningRow" for="maaLongoranRange${key}"><span>${label}</span>
          <input id="maaLongoranRange${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="Longoran ${label}">
          <span><input id="maaLongoranNum${key}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="Longoran ${label} exact value">${unit}</span>
        </label>`;
      panel.innerHTML = `
        <div class="scaleHead"><b>Full character scale</b><span id="maaFullScaleSelected" class="scaleSelected">Choose a character</span><span id="maaFullScaleNpc" class="pill">—</span><label for="maaFullScaleChoose" class="small">Character</label><select id="maaFullScaleChoose" aria-label="Choose character to edit"></select></div>
        <div class="scaleHead"><label for="maaFullScaleAgeMode">Lineup age</label><select id="maaFullScaleAgeMode" aria-label="Show full lineup at age"><option value="adult">Adult (reference)</option><option value="baby">Baby</option><option value="toddler">Toddler</option><option value="child">Child</option></select></div>
        <section aria-label="Overall stage scale">
          ${scaleRow('Overall','Overall scale',10,400,1,100,'Temporary uniform size of this age lineup')}
          <button id="maaFullScaleBakeOverall" type="button" class="good">Bake overall scale</button>
        </section>
        <section id="maaFullScaleAgeControls" aria-label="Individual age proportions" hidden>
          <b>Selected species/gender — <span id="maaFullScaleAgeTitle">age</span> proportions</b>
          ${[['Width','width',1,2000],['Height','height',1,2000],['Head','head',1,2000],['Hands','hand',1,2000],['Feet','foot',1,2000],['WidthConvergence','widthConvergence',0,100],['HeightConvergence','heightConvergence',0,100]].map(([name,axis,min,max]) => `
          <div class="scaleRow"><label for="maaFullScaleAgeRange${name}">${name.replace("Convergence", " convergence")}</label>
            <input id="maaFullScaleAgeRange${name}" type="range" min="${min}" max="${axis.endsWith('Convergence') ? 100 : 200}" step="0.1" value="100" aria-label="${name.toLowerCase()} for selected age mode">
            <input id="maaFullScaleAgeNum${name}" type="number" min="${min}" max="${max}" step="0.1" value="100" aria-label="${name.toLowerCase()} percent (exact)">%
          </div>`).join('')}
          <p class="maaSmall maaMuted">Convergence is a temporary whole-lineup adjustment of the CURRENT proportions. Bake to save it into each species/gender and reset the sliders to zero. Overall scale changes size without changing proportions.</p>
          <button id="maaFullScaleBakeConvergence" type="button" class="good">Bake convergence</button>
          <div class="scaleActions"><button id="maaFullScaleAgeExport" type="button" class="secondary">Export age defaults JSON</button><button id="maaFullScaleAgeApply" type="button" class="good">Apply to game (same site)</button><button id="maaFullScaleAgeUnapply" type="button" class="secondary">Restore game's defaults</button></div>
          <div id="maaFullScaleRuntimeStatus" class="scaleStatus" aria-live="polite">Draft only until applied.</div>
        </section>
        <section id="maaFullScaleLongoranControls" aria-label="Longoran hunch and kyphosis posture" hidden>
          <b>Longoran spine — hunch &amp; kyphosis</b>
          <span class="longoranIntro">Hunch lowers the shoulders; kyphosis curls the neck forward. Both are independently authored for males and females.</span>
          <div class="longoranRows">
            ${longoranRow('Hunch', 'Spine hunch (%)', 0, 100, 1, 15)}
            ${longoranRow('Kyphosis', 'Kyphosis (%)', 0, 100, 1, 100)}
          </div>
          <div class="longoranTuningActions">
            <button id="maaLongoranWalkPreview" type="button" class="secondary" aria-pressed="false">Preview walk</button>
            <button id="maaLongoranExport" type="button" class="secondary">Export Longoran tuning JSON</button>
          </div>
          <p class="armLengthHint">Arm length offset (%) is in Rig Coordinates → Species proportions. It adjusts the free-hanging hands, not the whole-body scale.</p>
        </section>
        <div id="maaFullScaleAdultFields">
        ${scaleRow('X', 'Width', 10, 400, 0.5, 100, 'Body width scale')}
        ${scaleRow('Height', 'Height', 10, 400, 0.5, 100, 'Total stature relative to the unscaled avatar; beltline changes do not change overall height')}
        ${scaleRow('Beltline', 'Beltline height', 0.1, 99.9, 0.1, 50, 'Beltline height as a percent of floor-to-head stature; higher values give longer legs and a shorter torso')}
        ${scaleRow('Hand', 'Hand scale', 10, 400, 0.5, 100, 'Independent size of both procedural hands')}
        ${scaleRow('Foot', 'Foot scale', 10, 400, 0.5, 100, 'Independent size of both procedural feet')}
        ${scaleRow('Head', 'Head', 10, 400, 0.5, 100, 'Head scale')}
        ${scaleRow('OffsetY', 'Head Y offset', -50, 50, 0.5, 0, 'Head Y offset, percent of model height')}
        ${scaleRow('Age', 'Age (hunch)', 0, 100, 1, 0, 'Per-NPC age hunch, lowers the head further')}
        </div>
        <label class="maaToggleLine" style="margin:8px 0"><input id="maaFullScaleShowSpine" type="checkbox" checked> Show live spine and neck attachment</label>
        <div class="maaSmall maaMuted" style="margin-bottom:8px">Spine: green pelvis → orange vertebrae → violet shoulder/neck base; cyan marks the scaled head attachment. The selected avatar is highlighted, and hunch edits update the bones without changing the portrait art.</div>
        <div class="scaleActions"><button id="maaFullScaleExport" type="button" class="good">Export scale JSON</button><button id="maaFullScaleFrame" type="button" class="secondary">Frame lineup</button><button id="maaFullScaleFocus" type="button" class="secondary" disabled>Focus selected</button><button id="maaFullScaleMatchMainAdults" type="button" class="secondary" title="Apply all 26 uploaded adult Width, Height/Beltline, Head, offsets and hand/foot values without altering age stages or NPC posture">Apply uploaded character scales</button><button id="maaFullScaleReset" type="button" class="secondary">Reset all to repo defaults</button></div>
        <div id="maaFullScaleStatus" class="scaleStatus">Height controls total floor-to-head stature. Beltline height (%) is the hip/posterior junction measured upward from the feet, as a percent of that total. The legs and portrait are derived together, preserving planted feet and existing saved proportions.</div>`;
      workspace.appendChild(panel);
      panel.querySelector('#maaFullScaleMatchMainAdults').addEventListener('click', applyUploadedAdultScales); // Re-import the user-approved 26-profile baseline without erasing NPC age or Longoran spine posture.
      panel.querySelector('#maaFullScaleReset').addEventListener('click', resetAllToRepoDefaults);
      panel.querySelector('#maaFullScaleShowSpine').addEventListener('change', event => {
        showSpineGuides = event.target.checked; // Preview-only setting; not exported with species scales or Rig Coordinates data.
        syncSpineGuides(); // Immediately hide/show the existing meshes; never rebuild the portrait to toggle debug bones.
      });
      panel.querySelector('#maaFullScaleAgeMode').addEventListener('change', event => setAgeMode(event.target.value));
      const overallRange=panel.querySelector('#maaFullScaleRangeOverall'), overallNumber=panel.querySelector('#maaFullScaleNumOverall');
      overallRange.addEventListener('input',()=>{overallNumber.value=overallRange.value;previewOverall(overallRange.value);});
      overallNumber.addEventListener('input',()=>{if(overallNumber.value!==''&&Number(overallNumber.value)>=10&&Number(overallNumber.value)<=400)previewOverall(overallNumber.value);});
      overallNumber.addEventListener('change',()=>{previewOverall(Math.max(10,Math.min(400,Number(overallNumber.value)||100)));syncAgeControls();});
      panel.querySelector('#maaFullScaleBakeOverall').addEventListener('click',bakeOverall);
      panel.querySelector('#maaFullScaleBakeConvergence').addEventListener('click',bakeConvergence);
      for (const [name, axis] of [['Width','width'],['Height','height'],['Head','head'],['Hands','hand'],['Feet','foot'],['WidthConvergence','widthConvergence'],['HeightConvergence','heightConvergence']]) {
        const range = panel.querySelector(`#maaFullScaleAgeRange${name}`);
        const number = panel.querySelector(`#maaFullScaleAgeNum${name}`);
        range.addEventListener('input', () => { number.value = range.value; editIndividualAge(axis, range.value); });
        number.addEventListener('input', () => {
          const typed = Number(number.value); // Partial mobile entries below a slider's minimum are not forcibly snapped back.
          if (number.value !== '' && Number.isFinite(typed) && typed >= Number(number.min) && typed <= Number(number.max)) {
            range.value = number.value;
            editIndividualAge(axis, number.value);
          }
        });
        number.addEventListener('change', () => {
          const value = Number(number.value);
          const percent = Number.isFinite(value) && number.value !== ''
            ? Math.min(Number(number.max), Math.max(Number(number.min), value))
            : Math.round((axis.endsWith('Convergence')?ageValues():individualAgeValues(selected))[axis]*100);
          number.value = String(percent);
          range.value = String(percent);
          editIndividualAge(axis, percent);
        });
      }
      panel.querySelector('#maaFullScaleAgeExport').addEventListener('click', exportAgeModifiers);
      panel.querySelector('#maaFullScaleAgeApply').addEventListener('click', applyAgeToGame);
      panel.querySelector('#maaFullScaleAgeUnapply').addEventListener('click', restoreGameAges);
      panel.querySelector('#maaFullScaleChoose').addEventListener('change', event => {
        manualViewInteraction = true; // An intentional selection must not be followed by a surprise automatic lineup frame.
        const entry = entries.find(item => item.key === event.target.value);
        if (entry) select(entry);
      });
      panel.addEventListener('input', () => { if (active) manualViewInteraction = true; }, true); // Includes head, body and Longoran adjustments, even when another capture listener consumes the event.
      panel.addEventListener('pointerdown', () => { if (active) manualViewInteraction = true; }, true); // Covers Reset all, buttons and mobile taps during background preview loading.
      panel.addEventListener('keydown', () => { if (active) manualViewInteraction = true; }, true); // Covers keyboard-only editing and focus requests without pointer events.
      // The capture-phase BodyInputGuard owns these seven paired sliders.
      // Do not add a second input listener: it would rewrite Head's raw-PNG scale
      // or reset independently authored dimensions when another slider moves.
      const ageRange = panel.querySelector('#maaFullScaleRangeAge');
      const ageNumber = panel.querySelector('#maaFullScaleNumAge');
      ageRange.addEventListener('input', () => { ageNumber.value = ageRange.value; applyAgeSlider(); });
      ageRange.addEventListener('change', persistProfiles);
      ageNumber.addEventListener('input', () => { ageRange.value = ageNumber.value; applyAgeSlider(); });
      ageNumber.addEventListener('change', persistProfiles);
      for (const key of Object.keys(LONGORAN_TUNING)) {
        const range = panel.querySelector(`#maaLongoranRange${key}`);
        const number = panel.querySelector(`#maaLongoranNum${key}`);
        range.addEventListener('input', () => { number.value = range.value; applyLongoranSliders(); });
        range.addEventListener('change', () => { applyLongoranSliders(true); persistProfiles(); });
        number.addEventListener('input', () => { if (number.value !== '') { range.value = number.value; applyLongoranSliders(); } });
        number.addEventListener('change', () => { range.value = number.value; applyLongoranSliders(true); persistProfiles(); });
      }
      panel.querySelector('#maaLongoranWalkPreview').addEventListener('click', toggleLongoranWalk);
      panel.querySelector('#maaLongoranExport').addEventListener('click', exportLongoranTuning);
      panel.querySelector('#maaFullScaleExport').addEventListener('click', exportJson);
      panel.querySelector('#maaFullScaleFrame').addEventListener('click', () => { manualViewInteraction = true; frame(); });
      panel.querySelector('#maaFullScaleFocus').addEventListener('click', focusSelected);
    }

    for (const [id, mode] of [['maaMultiTab','multi'],['maaSingleTab','single'],['maaRigTab','rig']]) {
      const tab = document.getElementById(id);
      if (!tab || tab.dataset.fullScaleExit === '1') continue;
      tab.dataset.fullScaleExit = '1';
      tab.addEventListener('click', event => {
        if (!active && !building && !exitingPromise) return;
        event.preventDefault();
        event.stopImmediatePropagation(); // Complete restoration before handing control to the native mode tab.
        exit(mode).catch(error => {
          console.warn('[full-character-scale] native tab restore failed', error);
          status(`Could not switch to ${mode}: ${error.message}`);
        });
      }, true);
    }

    const frameButton = document.getElementById('maaFrameAllBtn');
    if (frameButton && frameButton.dataset.fullScaleFrame !== '1') {
      frameButton.dataset.fullScaleFrame = '1';
      frameButton.addEventListener('click', event => {
        if (!active) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        manualViewInteraction = true; // Prevents the final loading pass from undoing an explicit top-toolbar frame.
        frame();
      }, true);
    }

    // Viewport pointer gestures belong exclusively to OrbitControls; selection is dropdown-only.
    // No raycasting or pointer-up selection listener is installed in Full Character Scale.
    return true;
  }

  function status(text) {
    const node = document.getElementById('maaFullScaleStatus');
    if (node) node.textContent = text;
  }

  function showStartupError(error) {
    const detail = `Full Character Scale: ${error?.message || String(error)}. Check the scale editor diagnostic banner.`; // Mobile-readable failure remains visible after exiting the hidden comparison panel.
    const pill = document.getElementById('statusPill');
    if (pill) pill.textContent = detail;
    let banner = document.getElementById('maaFullScaleErrorBanner'); // Independent of panel/tab visibility, so failed initialization cannot erase it.
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'maaFullScaleErrorBanner';
      banner.setAttribute('role', 'alert');
      banner.style.cssText = 'position:fixed;top:64px;left:8px;right:8px;max-height:25vh;overflow:auto;z-index:100000;background:#411e26;color:#fff;border:1px solid #e58a9a;border-radius:7px;padding:10px;font:13px/1.4 sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;';
      document.body.appendChild(banner);
    }
    banner.textContent = `${detail}\n${error?.stack || ''}`; // Message and stack are copyable on touch devices without a console.
  }

  function clearStartupError() {
    document.getElementById('maaFullScaleErrorBanner')?.remove?.(); // A successful retry clears the last startup error.
  }

  function chrome() {
    if (!active && !building) return;
    document.body.dataset.animationAuthorMode = MODE;
    for (const id of ['maaMultiTab','maaSingleTab','maaRigTab']) document.getElementById(id)?.setAttribute('aria-selected','false');
    document.getElementById(TAB_ID)?.setAttribute('aria-selected','true');
    const badge = document.getElementById('maaViewportBadge');
    if (badge) badge.textContent = 'Full character scale · choose a character from the open panel; age mode affects the entire lineup.';
    const panel = document.getElementById(PANEL_ID); // Keep the character chooser available whenever this tab is active, including during progressive loading.
    if (panel) panel.hidden = false; // Mode-scoped CSS makes it visible here and hides it again in other tabs.
  }

  function setSliderValue(axis, percent) {
    document.getElementById(`maaFullScaleRange${axis}`).value = String(percent);
    document.getElementById(`maaFullScaleNum${axis}`).value = String(Math.round(percent * 10) / 10);
  }

  function spineGapSourcePixels(entry) {
    const model = entry?.model?.userData; // Only the selected model's real portrait rig supplies geometry and source image dimensions.
    const rig = model?.neckRig; // The seven-bone gameplay skeleton is authoritative, not a drawn debug approximation.
    const sourcePixelHeight = Number(String(model?.sourceImagePixels || '').split('x')[1]); // Source sprite pixel height used when calculating the short head connection.
    const height = Number(model?.portraitModelHeight); // World/model units used by the spine layout solver.
    const gap = Number(rig?.neckLocal?.y) - Number(rig?.spineBase?.y); // Rest gap from spine tip to the last painted head pixel.
    return sourcePixelHeight > 0 && height > 0 && Number.isFinite(gap) ? Math.round(gap * sourcePixelHeight / height * 1000) / 1000 : null;
  }

  function syncSpineGuides() {
    for (const entry of entries) {
      if (entry === selected || !entry.spineGuide) continue;
      entry.spineGuide.dispose(); // Only one selected live guide consumes debug geometry on mobile.
      entry.spineGuide = null;
    }
    if (showSpineGuides && selected && !selected.spineGuide && THREE) {
      selected.spineGuide = window.HobunjiCharacterSpine?.makeBoneGuides?.(THREE, selected.model.userData.neckRig) || null; // Lazily bind the real seven-node gameplay spline to the selected skinned avatar.
    }
    selected?.spineGuide?.sync(showSpineGuides); // Head-scale and hunch sliders update the existing selected guide without building new textures.
  }

  function syncLongoranKyphosisAvailability() {
    const hunch = Number(document.getElementById('maaLongoranRangeHunch')?.value) || 0; // The same dependency used in Enemy Loadout Editor: no hunch means there can be no forward hook.
    for (const id of ['maaLongoranRangeKyphosis', 'maaLongoranNumKyphosis']) {
      const input = document.getElementById(id);
      if (input) input.disabled = hunch <= 0;
    }
  }

  function beltlineGeometryFor(entry) {
    const modelHeight = Number(entry?.model?.userData?.portraitModelHeight) || 1; // Same unscaled floor-to-top model height used when creating this character's leg IK.
    const contact = Number(entry?.feet?.standingFootContactY) / modelHeight; // Dynamic sole center follows resized GLB foot contacts without a new scan.
    return { hip: entry?.beltlineBaseFraction ?? .5, contact: Number.isFinite(contact) && contact > 0 ? contact : 0 }; // Keeps authored hip fixed while foot sizes change.
  }

  function renderedPortraitScaleFor(entry) {
    const actual = Number(entry?.model?.userData?.portraitScaleMultiplier); // Recorded by the real PNGPlaneAvatar builder, after species/gender ancestry and any child factors.
    if (Number.isFinite(actual) && actual > 0) return actual; // Do NOT assume the authored rig profile is what this particular preview actually rendered.
    try {
      const fallback = Number(window.PNGPlaneAvatar?.avatarScaleMultiplierFor?.({ appearance: { speciesId: entry?.species, gender: entry?.gender } }));
      if (Number.isFinite(fallback) && fallback > 0) return fallback;
    } catch (_) { /* A not-yet-loaded portrait runtime must not block selection. */ }
    const authored = Number(entry?.profile?.anatomy?.portraitScale);
    return Number.isFinite(authored) && authored > 0 ? authored : 1;
  }

  function select(entry) {
    if (!entry) return;
    if (selected !== entry) stopLongoranWalk();
    selected = entry;
    syncAgeControls(); // Individual stage fields follow the selected species and gender immediately.
    const chooser = document.getElementById('maaFullScaleChoose');
    if (chooser) chooser.value = entry.key; // Selection is exclusively via the always-visible character dropdown.
    const focusButton = document.getElementById('maaFullScaleFocus'); // A valid preview selection enables explicit framing for any species/gender.
    if (focusButton) focusButton.disabled = false;
    const scale = window.HobunjiCharacterRigScale?.scaleFor?.(entry.species, entry.gender, entry.profile) || { x: 1, y: 1, head: 1, offsetY: 0 };
    document.getElementById('maaFullScaleSelected').textContent = `${prettySpecies(entry.species)} · ${entry.gender}`;
    document.getElementById('maaFullScaleNpc').textContent = entry.npc?.name || entry.npc?.id || 'Repository NPC';
    for (const [axis, field] of [['X', 'x']]) {
      setSliderValue(axis, clampPercent((scale[field] || 1) * 100));
    }
    const portraitMultiplier = renderedPortraitScaleFor(entry); // The actual built model defines the source-PNG-to-world conversion.
    const rawHead = window.HobunjiCharacterRigScale?.rawPngHeadScaleFor?.(scale.head, portraitMultiplier)
      ?? ((Number(scale.head) || 1) * portraitMultiplier);
    setSliderValue('Head', rawHead * 100); // Never show the internal neck runtime factor as the user's raw-PNG Head value, even for one tick.
    const dimensions = window.HobunjiCharacterRigScale?.heightBeltlineFor?.(scale, beltlineGeometryFor(entry));
    setSliderValue('Height', clampPercent((dimensions?.height || scale.y || 1) * 100));
    setSliderValue('Beltline', Math.max(.1, Math.min(99.9, (dimensions?.beltline || entry.beltlineBaseFraction || .5) * 100))); // Display the actual floor-to-hip percentage after migration from legacy Y/legLength.
    setSliderValue('Hand', clampPercent(partScaleFor(entry, 'hand') * 100));
    setSliderValue('Foot', clampPercent(partScaleFor(entry, 'foot') * 100));
    setSliderValue('OffsetY', clampOffsetPercent(scale.offsetY * 100));
    const age = entry.npc?.id ? (host()?.npcAgeFor?.(entry.npc.id) || 0) : 0;
    setSliderValue('Age', clampAgePercent(age * 100));
    const longoranPanel = document.getElementById('maaFullScaleLongoranControls');
    if (longoranPanel) longoranPanel.hidden = entry.species !== 'longoran';
    const npcAgeRow = document.getElementById('maaFullScaleRangeAge')?.closest?.('.scaleRow'); // Longoran hunch is species-authored; don't show a second, misleading NPC-age hunch input.
    if (npcAgeRow) npcAgeRow.hidden = entry.species === 'longoran' || ageMode !== 'adult'; // Old-age hunch does not belong on newborn/toddler/child comparison models.
    if (entry.species === 'longoran') {
      const tune = window.HobunjiLongoranSpecies?.tuningFor?.(entry.gender);
      if (tune) {
        for (const [key, info] of Object.entries(LONGORAN_TUNING)) {
          const value = Number(tune.spine[info.field]) * 100; // Display the same percentage units as Enemy Loadout Editor.
          const formatted = String(Number(value.toFixed(1)));
          document.getElementById(`maaLongoranRange${key}`).value = formatted;
          document.getElementById(`maaLongoranNum${key}`).value = formatted;
        }
        syncLongoranKyphosisAvailability(); // Kyphosis is unavailable until some hunch exists, as in the enemy editor.
      }
    }
    syncSpineGuides(); // Selected species' actual spine becomes visible without moving the camera or modifying its rig.
    const measured = ageMode === 'adult' ? window.HobunjiCharacterRigScale?.pixelHeightCalibrationSnapshot?.()?.[entry.key] : null; // Adult source-art height only; never mislabel a child-stage height as the adult target.
    const chair = window.HobunjiCharacterRigScaleDefaults?.worldHeightCalibration;
    const gameUnitsPerFoot = Number(chair?.chairBackWorldHeight) / Number(chair?.chairHeightFeet); // Same scale as the six-foot ruler, no new guessing.
    const measuredText = measured && gameUnitsPerFoot > 0
      ? ` · painted crown ${(measured.measuredWorldHeight / gameUnitsPerFoot).toFixed(2)} ft (target ${(measured.targetWorldHeight / gameUnitsPerFoot).toFixed(2)} ft)`
      : (ageMode === 'adult' && window.HobunjiCharacterRigScaleDefaults?.maleHeightFeet?.[entry.species] ? ' · PNG crown not measured yet (nominal height only)' : '');
    status(`Selected ${prettySpecies(entry.species)} ${entry.gender}${measuredText} · ${entry.npc?.name || entry.npc?.id || 'repository NPC'}. Use Focus selected to center without changing the lineup.`);
    // Selection changes the edited character, never camera position, angle, projection, or zoom.
  }

  function currentAgeFraction() {
    return selected?.npc?.id ? (host()?.npcAgeFor?.(selected.npc.id) || 0) : 0;
  }



  function syncAgeControls() {
    const modeSelect = document.getElementById('maaFullScaleAgeMode'); // UI stage is independent of any species/gender selection.
    if (modeSelect) modeSelect.value = ageMode;
    const stage = document.getElementById('maaFullScaleAgeControls');
    if (stage) stage.hidden = ageMode === 'adult';
    const adultFields=document.getElementById('maaFullScaleAdultFields'); if(adultFields) adultFields.hidden=ageMode!=='adult';
    const overallRange=document.getElementById('maaFullScaleRangeOverall'), overallNumber=document.getElementById('maaFullScaleNumOverall');
    const overallPercent=String(Math.round(ageOverall[ageMode]*100));
    if(overallRange)overallRange.value=overallPercent;
    if(overallNumber && document.activeElement!==overallNumber)overallNumber.value=overallPercent;
    const npcAgeRow = document.getElementById('maaFullScaleRangeAge')?.closest?.('.scaleRow'); // Adult donor hunch cannot distort the growth-stage lineup.
    if (npcAgeRow) npcAgeRow.hidden = ageMode !== 'adult' || selected?.species === 'longoran';
    const runtimeStatus = document.getElementById('maaFullScaleRuntimeStatus'); // Remains visible while a user is tuning a growth stage.
    const applied = window.HobunjiCharacterAgeRigConfig?.snapshot?.()?.applied || false;
    if (runtimeStatus) runtimeStatus.textContent = applied
      ? 'Applied for this site in this browser. Reload the same-site game to rebuild existing NPCs; other domains require JSON integration.'
      : 'Draft only. Apply to the same-site game for a local test, or export JSON for deployment.';
    const title = document.getElementById('maaFullScaleAgeTitle');
    if (title) title.textContent = ageMode;
    const values = individualAgeValues(selected);
    for (const [name, axis] of [['Width','width'],['Height','height'],['Head','head'],['Hands','hand'],['Feet','foot'],['WidthConvergence','widthConvergence'],['HeightConvergence','heightConvergence']]) {
      const percent = String(Math.round((axis.endsWith('Convergence')?ageValues():values)[axis] * 1000)/10);
      const range = document.getElementById(`maaFullScaleAgeRange${name}`);
      const number = document.getElementById(`maaFullScaleAgeNum${name}`);
      if (range) { if(!axis.endsWith('Convergence')) range.max=String(Math.max(200,Math.ceil(Number(percent)/100)*100)); range.value = percent; }
      if (number && document.activeElement !== number) number.value = percent; // Do not overwrite partially entered percentages on mobile keyboards.
    }
  }

  function syncAgeLimbs(entry, onlyKind = null) {
    if (!entry?.group?.getObjectByName) return 0;
    const values = individualAgeValues(entry);
    const visuals = entry.ageVisuals ||= {}; // Reuse discovered GLB nodes until an actual rig rebuild invalidates them.
    let missing = 0; // Retry only genuine late GLB arrivals, not every character every frame.
    for (const kind of (onlyKind ? [onlyKind] : ['hand', 'foot'])) {
      for (const side of ['left', 'right']) {
        const name = `${side}_${kind === 'hand' ? 'hand_visual' : 'foot'}`;
        let visual = visuals[name];
        if (!visual?.scale) {
          agePerf.limbLookups++;
          visual = entry.group.getObjectByName(name); // One lookup per missing limb; stable loaded limbs use their cached node.
          if (!visual?.scale) { missing++; continue; }
          visuals[name] = visual;
        }
        const base = ageLimbBases.get(visual) || { x: visual.scale.x, y: visual.scale.y, z: visual.scale.z };
        if (!ageLimbBases.has(visual)) ageLimbBases.set(visual, base);
        const factor = values[kind];
        const x = base.x * factor, y = base.y * factor, z = base.z * factor;
        if (Math.abs(visual.scale.x - x) < 1e-7 && Math.abs(visual.scale.y - y) < 1e-7 && Math.abs(visual.scale.z - z) < 1e-7) continue;
        visual.scale.set(x, y, z);
        visual.updateMatrix?.();
      }
    }
    return missing;
  }

  function lineupConvergenceBasis() {
    if (!ageConvergenceBasis) {
      const api = window.HobunjiCharacterAgeRigConfig;
      const keys = Object.keys(window.HobunjiCharacterRigScaleDefaults?.uploadedScaleRestoreValues || {}); // Stable full lineup, not just the currently selected or already rendered entries.
      const byKey = new Map(keys.map(key => { const [species, gender] = key.split('::'); return [key, { species, gender }]; }));
      for (const entry of entries) byKey.set(`${entry.species}::${entry.gender}`, entry);
      ageConvergenceBasis = api?.buildConvergenceBasis?.([...byKey.values()]) || {};
    }
    return ageConvergenceBasis;
  }

  function applyPreviewProportions(entry, authoredOverride = null) {
    if (!entry?.group?.isObject3D) return;
    const authored = authoredOverride || window.HobunjiCharacterRigScale?.scaleFor?.(entry.species, entry.gender, entry.profile) || { x: 1, y: 1, legLength: 1, head: 1, offsetY: 0 };
    const stage = previewAgeValues(entry,authored);
    const composed = window.HobunjiCharacterAgeRigConfig?.composePreviewScale?.(authored, stage, entry, ageMode === 'adult' ? {} : lineupConvergenceBasis())
      || { x: authored.x * (stage.width ?? stage.body), y: authored.y * (stage.height ?? stage.body), head: authored.head * stage.head, offsetY: authored.offsetY };
    composed.legLength = (Number(authored.legLength) > 0 ? Number(authored.legLength) : Number(authored.y) || 1) * (composed.y / (Number(authored.y) || 1));
    if (ageMode === 'adult' && ageOverall.adult !== 1) { for(const field of ['x','y','legLength','head']) composed[field]*=ageOverall.adult; }
    if (ageMode !== 'adult' || ageOverall.adult !== 1) composed.ageComposed = true; // Derived preview multipliers can exceed the adult authoring bounds; both leg and portrait height follow the same factor.
    // Gameplay builds the child body scale into modelWidth/modelHeight and uses childHeadFactor=head/body at the neck.
    // This editor starts with a neutral adult portrait and applies the mathematically equivalent floor-parent transform.
    window.HobunjiCharacterRigScale?.applyToParent?.(entry.group, entry.species, entry.gender, composed,
      entry.species === 'longoran' ? (window.HobunjiLongoranSpecies?.spineFor?.(entry.gender)?.hunch || 0)
        : ageMode === 'adult' && entry.npc?.id ? (host()?.npcAgeFor?.(entry.npc.id) || 0) : 0); // Adult representative age hunch is excluded from child stages, but Longoran species posture remains.
    agePerf.rigPasses++;
    syncAgeLimbs(entry);
  }

  function syncHandsOnce() {
    window.ProceduralHandFrameDriver?.syncNow?.(); // Only once after a body/head batch, never per-hand slider tick/entry.
    agePerf.handSyncs++;
  }

  function relayoutForAge() {
    layout(selected); // Keep the selected rig's world X stable while neighbors redistribute. Box3 traversal is proportional to every rig's mesh count; only call after body/head changes.
    agePerf.layoutPasses++;
  }

  function scheduleSelectedLayout() {
    if (selectedLayoutFrame || (!active && !building)) return;
    if (typeof requestAnimationFrame !== 'function') { relayoutForAge(); return; }
    selectedLayoutFrame = requestAnimationFrame(() => {
      selectedLayoutFrame = 0;
      if (active || building) relayoutForAge(); // Other species keep their own physical slots after a selected-width/head edit.
    });
  }

  function flushAgeRender() {
    ageRenderFrame = 0;
    if (!active && !building) { ageDirtyBody = false; ageDirtyLimb = null; return; }
    if (ageDirtyBody) {
      for (const entry of entries) applyPreviewProportions(entry);
      syncHandsOnce();
      for (const entry of entries) syncAgeLimbs(entry, 'hand'); // Reassert only hands after pose ownership settles.
      relayoutForAge();
    } else if (ageDirtyLimb) {
      for (const entry of entries) syncAgeLimbs(entry, ageDirtyLimb === 'both' ? null : ageDirtyLimb); // Hands/feet only: no full rig traversal, leg solver, or layout.
    }
    ageDirtyBody = false;
    ageDirtyLimb = null;
  }

  function queueAgeRender(axis) {
    ageDirtyBody ||= axis === 'width' || axis === 'height' || axis === 'head' || axis.endsWith('Convergence');
    if (!ageDirtyBody && (axis === 'hand' || axis === 'foot')) ageDirtyLimb = ageDirtyLimb && ageDirtyLimb !== axis ? 'both' : axis;
    if (ageRenderFrame) return;
    if (typeof requestAnimationFrame !== 'function') { flushAgeRender(); return; } // Node/mobile diagnostics use the same path without a render loop.
    ageRenderFrame = requestAnimationFrame(flushAgeRender); // Coalesces multiple pointer-input events to one frame.
  }

  function retryLateAgeLimbs() {
    if (ageLimbTimer) clearInterval(ageLimbTimer);
    ageLimbTimer = 0;
    const unresolved = () => entries.reduce((count, entry) => count + syncAgeLimbs(entry), 0); // Discovered visual refs are cached between retries.
    if (!unresolved()) return; // Loaded GLBs do not need a 3-second timer at all.
    let passes = 0;
    ageLimbTimer = setInterval(() => {
      agePerf.lateRetries++;
      if ((!active && !building) || ++passes >= 16 || !unresolved()) {
        clearInterval(ageLimbTimer);
        ageLimbTimer = 0;
      }
    }, 250); // Bounded four-second fallback for slow mobile GLB/hand arrivals; not a permanent gameplay frame hook.
  }

  function setAgeMode(nextMode) {
    if (!AGE_MODES.includes(nextMode) || (!active && !building)) return;
    stopLongoranWalk();
    if (selectedLayoutFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(selectedLayoutFrame);
    selectedLayoutFrame = 0; // Cancel stale selected-layout updates on age switch.
    if (ageRenderFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(ageRenderFrame);
    ageRenderFrame = 0;
    ageDirtyBody = false;
    ageDirtyLimb = null;
    ageMode = nextMode;
    stageBasisCache=null;
    manualViewInteraction = true;
    focusedEntryKey = null;
    syncAgeControls();
    for (const entry of entries) applyPreviewProportions(entry);
    syncHandsOnce();
    for (const entry of entries) syncAgeLimbs(entry, 'hand');
    retryLateAgeLimbs();
    relayoutForAge();
    frame(); // Explicit stage switch reframes the new whole lineup; slider movements never move the camera.
    status(`Showing ${ageMode} proportions on ${entries.length} previews. Choose a species/gender to edit individual values; bake temporary lineup adjustments separately.`);
  }

  function applyAgeModifiers(axis, rawPercent) {
    if (!active || ageMode === 'adult' || !AGE_AXES.includes(axis)) return;
    const values = ageValues();
    const parsed = Number(rawPercent) / 100; // Incomplete numeric edits must not force the slider to an unrelated valid value.
    if (!Number.isFinite(parsed) || parsed < 0 || (parsed === 0 && !axis.endsWith('Convergence'))) return;
    values[axis] = clampAgeModifier(parsed, axis, values[axis]);
    stageBasisCache=null;
    syncAgeControls();
    queueAgeRender(axis);
    persistAgeModifiers();
    status(`${ageMode} ${axis} ${Math.round(values[axis] * 100)}% applies across ${entries.length} previews. Draft is separate from gameplay until explicitly applied.`);
  }

  function applyAgeToGame() {
    try {
      const baked=Object.fromEntries(Object.entries(ageModifiers).map(([mode,row])=>[mode,{...row,widthConvergence:0,heightConvergence:0}]));
      const saved = window.HobunjiCharacterAgeRigConfig?.applyOnThisDevice?.(baked, lineupConvergenceBasis(), ageProfiles);
      if (!saved) throw new Error('Shared game age configuration is unavailable');
      syncAgeControls();
      status('Applied all growth stages for this browser/site origin. Open or reload the game at the SAME site to build children with these settings. Other hosted domains need an exported JSON/config update.');
    } catch (error) { status(`Could not apply age configuration: ${error.message}`); }
  }

  function restoreGameAges() {
    try {
      window.HobunjiCharacterAgeRigConfig?.restoreRepositoryOnThisDevice?.();
      syncAgeControls();
      status('Restored game age defaults for this browser/site. Your draft remains editable; reload the game to rebuild existing NPC portraits.');
    } catch (error) { status(`Could not restore game defaults: ${error.message}`); }
  }

  function exportAgeModifiers() {
    const values = Object.fromEntries(Object.entries(ageModifiers).map(([mode,row])=>[mode,{...row,widthConvergence:0,heightConvergence:0}])); // Export baked values only; species/gender rig-scale export remains backwards-compatible.
    const data = { schema: 'hobunji.character-age-rig-modifiers.v1',
      profiles: clone(ageProfiles), // Baked individual stage values are the portable authority.
      convergenceBasis: clone(lineupConvergenceBasis()), // Include the measured reference for portability to other domains.
      phaseScales: { basket: { ...clone(values.baby), body: values.baby.height }, toddler: { ...clone(values.toddler), body: values.toddler.height } }, // Height remains the legacy body alias for older game code consuming exported JSON.
      pngPlaneAvatar: { childScaleMultiplier: values.child.height, childWidthScaleMultiplier: values.child.width, childHeadScaleMultiplier: values.child.head, childWidthConvergence: values.child.widthConvergence, childHeightConvergence: values.child.heightConvergence, ageConvergenceBasis: clone(lineupConvergenceBasis()), ageProfiles: clone(ageProfiles) }, // Vertical height retains legacy child body alias.
      childLimbModifiers: { hand: values.child.hand, foot: values.child.foot },
      note: 'Baked profiles are authoritative per growth stage and species/gender. Install pngPlaneAvatar.ageProfiles with the exported fallback phase and PNG settings; adultReference preserves dimensions across adult overall edits. Temporary convergence and overall preview adjustments are not exported.' };
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'hobunji_character_age_rig_modifiers.json';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status('Exported shared baby, toddler and child proportions separately from species/gender scales.');
  }

  function refreshLongoranSpine(entry) {
    if (entry?.species !== 'longoran' || !entry.model) return;
    const api = window.HobunjiLongoranSpecies;
    const spineValues = api?.spineFor?.(entry.gender); // Single authored posture source shared with the game's portrait rig.
    const spine = window.HobunjiCharacterSpine?.bind?.(entry.model, { speciesId: 'longoran', gender: entry.gender, spine: spineValues });
    applyPreviewProportions(entry); // Preserve authored Longoran spine and the current age-wide scale in one pass.
    entry.spinePreviewApplied = !!(spine && window.HobunjiCharacterSpine?.applyToRig?.(entry.model.userData.neckRig, spine, Number(entry.model.userData.portraitModelHeight))); // The spline is bent only after the skull-to-neck connection has been updated.
    entry.spineGuide?.sync(showSpineGuides && entry === selected); // The seven bones and cyan neck endpoint follow the actual scale/hunch result immediately.
  }

  // Same garment rule as gameplay NPCs (game.js): the NPC's authored leg
  // garment, else basic pants for humanoids with a pants rig. Without this the
  // lineup showed an empty hip-to-foot gap that gameplay always covers, which
  // made Leg length and lanky species proportions impossible to judge.
  function pantsAssetUrl(path) {
    const value = String(path || '').trim();
    if (!value || /^(?:https?:|data:|blob:|\/)/i.test(value)) return value;
    return new URL(`../../${value.replace(/^\.\//, '')}`, location.href).href; // Tool pages live two folders below docs/.
  }

  function attachPreviewPants(entry, frontCanvas) {
    const Renderer = window.PantsGarmentRenderer;
    if (!THREE || !entry?.feet || !entry.model || !Renderer?.attachToLegs) return null;
    const exportNpc = portraitExportFor(entry.npc);
    const equipped = Renderer.garmentForCosmetics?.(exportNpc.equippedCosmetics) || null;
    const garmentId = equipped || (entry.npc?.noPants !== true && Renderer.hasRigFor?.(entry.species, entry.gender, 'pants_basic') ? 'pants_basic' : null);
    const source = garmentId ? window.HOBUNJI_PANTS_RIGS?.garments?.[garmentId] : null;
    if (!source) return null; // Pantless/unsupported species stay uncovered, exactly as in gameplay.
    const garmentRecord = clone(source);
    if (garmentRecord.image) garmentRecord.image = pantsAssetUrl(garmentRecord.image);
    if (Array.isArray(garmentRecord.imageLayers)) garmentRecord.imageLayers = garmentRecord.imageLayers.map(layer => ({ ...layer, url: pantsAssetUrl(layer?.url) }));
    const bodyColors = entry.avatarProfile?.bodyColors || exportNpc.appearance?.bodyColors || {};
    const pants = Renderer.attachToLegs(THREE, entry.feet, {
      avatarGroup: entry.model, speciesId: entry.species, gender: entry.gender, garmentId, garmentRecord, meshBudget: 'npc',
      appearance: Renderer.appearanceFromBodyColors?.(bodyColors) || {}, name: `${entry.group?.name || entry.key}_pants`,
    }) || null;
    const front = frontCanvas || entry.frontCanvas;
    if (pants && front && entry.avatarProfile && Renderer.buildOverlayMask) {
      Renderer.buildOverlayMask(front, entry.avatarProfile, { forceEyesOpen: true }).then(mask => {
        if (pants.disposed || entry.feet?.pants !== pants) return;
        pants.setOverlayMask?.(mask); // Arm clothing, overwear and hoods stay in front of the pants like gameplay.
        pants.update?.();
      }).catch(() => {});
    }
    pants?.update?.();
    return pants;
  }

  function rebuildLongoranFeet(entry) {
    if (entry?.species !== 'longoran' || !THREE || !entry?.group || !entry.model) return;
    entry.feet?.dispose?.();
    if (entry.ageVisuals) { delete entry.ageVisuals.left_foot; delete entry.ageVisuals.right_foot; } // Rebuilt GLBs invalidate cached limb nodes.
    const modelWidth = Number(entry.model.userData?.portraitModelWidth) || avatarBaseWidth();
    const modelHeight = Number(entry.model.userData?.portraitModelHeight) || modelWidth;
    entry.feet = window.ProceduralLegAnimation?.attach?.(THREE, entry.group, {
      speciesId: entry.species, gender: entry.gender, bodyColors: entry.avatarProfile?.bodyColors || entry.npc?.appearance?.bodyColors,
      modelWidth, modelHeight, handAttachY: entry.model.userData.handAttachY,
      profile: entry.avatarProfile, spine: window.HobunjiLongoranSpecies?.spineFor?.(entry.gender),
      gaitProfile: window.HobunjiLongoranSpecies?.gaitFor?.(entry.gender),
      name: `${entry.group.name}_feet`, portraitSize: 200,
      onFootVisualsReplaced({ left, right }) {
        if (!entry.group?.parent) return; // The edited rig may have been disposed while its GLB import was pending.
        entry.ageVisuals ||= {};
        entry.ageVisuals.left_foot = left;
        entry.ageVisuals.right_foot = right;
        syncAgeLimbs(entry, 'foot');
      },
    }) || null; // Recreates just the comparison feet, never gameplay actors or other species.
    attachPreviewPants(entry); // Disposing the old leg handle disposed its pants too.
    entry.feet?.update?.(0, 0, false, null);
    syncLegPortraitAlignment(entry); // A rebuilt species foot rig retains its independent hip height and torso connection.
    syncAgeLimbs(entry, 'foot'); // The replacement GLB inherits the active age-wide size.
  }

  function applyLongoranSliders(rebuildNow = false) {
    if (!active || selected?.species !== 'longoran') return;
    const spine = {}; // Only posture is edited here; existing per-gender gait tuning is preserved when saving.
    for (const [key, info] of Object.entries(LONGORAN_TUNING)) {
      const input = document.getElementById(`maaLongoranRange${key}`);
      const number = input?.value === '' ? NaN : Number(input?.value);
      const percent = Number.isFinite(number) ? Math.max(info.min, Math.min(info.max, number)) : info.min;
      spine[info.field] = percent / 100;
      if (input) input.value = String(percent);
      const numberInput = document.getElementById(`maaLongoranNum${key}`);
      if (numberInput) numberInput.value = String(percent);
    }
    window.HobunjiLongoranSpecies?.setAuthorTuning?.(selected.gender, { spine });
    syncLongoranKyphosisAvailability();
    refreshLongoranSpine(selected);
    clearTimeout(longoranFeetTimer);
    if (rebuildNow) rebuildLongoranFeet(selected);
    else {
      const entry = selected; // Debounces expensive foot GLB and bone rebuilds during touch drags.
      longoranFeetTimer = setTimeout(() => { if (selected === entry && active) rebuildLongoranFeet(entry); }, 180);
    }
    status(`Longoran ${selected.gender}: hunch ${Math.round(spine.hunch * 100)}%, kyphosis ${Math.round(spine.kyphosis * 100)}%.${selected.spinePreviewApplied ? '' : ' Spine preview unavailable: this portrait has no usable spline.'} Saved on this device; export tuning to review for repository use.`);
  }

  function stopLongoranWalk() {
    const wasWalking = !!longoranWalkTimer; // Avoid recomputing every species' foot solver when no walk preview was active.
    if (longoranWalkTimer) clearInterval(longoranWalkTimer);
    longoranWalkTimer = 0;
    if (wasWalking) for (const entry of entries) {
      if (entry.species !== 'longoran') continue;
      if (entry.model) entry.model.rotation.x = 0;
      entry.feet?.update?.(0, 0, false, null);
    }
    const button = document.getElementById('maaLongoranWalkPreview');
    if (button) { button.textContent = 'Preview walk'; button.setAttribute('aria-pressed', 'false'); }
  }

  function toggleLongoranWalk() {
    if (longoranWalkTimer) { stopLongoranWalk(); return; }
    if (!active || selected?.species !== 'longoran') return;
    const button = document.getElementById('maaLongoranWalkPreview');
    if (button) { button.textContent = 'Stop walk'; button.setAttribute('aria-pressed', 'true'); }
    longoranWalkTimer = setInterval(() => {
      if (!active || selected?.species !== 'longoran') { stopLongoranWalk(); return; }
      const entry = selected;
      entry.feet?.update?.(.05, 3.6, false, null, { speed: 3.6, velocityX: 0, velocityZ: 3.6, combat: false }); // Use the same walking-motion input contract as the enemy preview; enough speed to see the lurch.
      // Only the portrait pitches: the planted feet stay world-horizontal in the preview.
      if (entry.model) entry.model.rotation.x = Number(entry.feet?.getRunLean?.()) || 0; // Positive pitch matches the real gameplay body lean, not its backwards mirror.
    }, 50); // Author-only, opt-in 20 Hz preview; disposed on tab exit.
  }

  function exportLongoranTuning() {
    const data = { schema: 'hobunji.longoran-author-tuning.v1',
      note: 'Gender-specific spine/gait authored against the gameplay solvers; body x/y/head/offsetY remain in Full Character Scale export.',
      genders: window.HobunjiLongoranSpecies?.exportAuthorTuning?.() || {} };
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'longoran_author_tuning.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status('Exported Longoran male/female spine and gait settings; this editor does not alter the repository until reviewed and committed.');
  }

  function partScaleFor(entry, part) {
    const saved = Number(entry?.profile?.anatomy?.[part === 'hand' ? 'handScale' : 'footScale']); // Existing attachment-rig profile is authoritative when an explicit part size was authored.
    if (Number.isFinite(saved) && saved > 0) return Math.max(.1, Math.min(4, saved));
    const api = window.HobunjiHandModelProfiles; // Existing shared character hand/foot sizing inherits the appropriate species/gender defaults.
    return Math.max(.1, Math.min(4, Number(part === 'hand'
      ? api?.speciesScaleFor?.(entry?.species, entry?.gender)
      : api?.footScaleFor?.(entry?.species, entry?.gender)) || 1));
  }

  function syncLegPortraitAlignment(entry) {
    if (entry?.group && entry.feet) window.ProceduralLegAnimation?.alignPortraitWithLegs?.(entry.group, entry.feet); // One shared game/editor hip anchor, with no duplicate fallback geometry.
  }

  function scheduleHandResize(entry) {
    clearTimeout(handScaleTimer);
    handScaleTimer = setTimeout(() => {
      if (!active || !entry || !entries.includes(entry)) return; // Deferred GLB replacement must not mutate a disposed lineup.
      applyAnatomyConfig(entry.profile); // The existing hand-profile subscription rebuilds the two selected-size hands from cached source GLBs.
      window.ProceduralHandFrameDriver?.syncNow?.();
    }, 140);
  }

  function refreshFromScaleChange(scale, changedField = '') {
    if (!active || !selected) return false;
    const hand = Number(scale?.handScale) > 0 ? Number(scale.handScale) : partScaleFor(selected, 'hand'); // Guard copies part sizes verbatim on unrelated edits.
    const foot = Number(scale?.footScale) > 0 ? Number(scale.footScale) : partScaleFor(selected, 'foot');
    if (changedField === 'footScale') {
      applyAnatomyConfig(selected.profile); // Materialize the current Hand scale once before Foot scale changes its inherited fallback, keeping the two dimensions genuinely independent.
      selected.feet?.setFootScaleMultiplier?.(foot); // Resize real feet now, not just after leaving this workspace.
    }
    ageConvergenceBasis = null; stageBasisCache=null; // Adult authoring changes the reference for every species, not just this preview.
    applyPreviewProportions(selected, scale); // Use the exact persisted slider scale without discarding the global age mode.
    if (['x', 'y', 'legLength', 'height', 'beltline', 'footScale'].includes(changedField))
      selected.feet?.update?.(0, 0, false, null); // Recheck planted soles only when geometry changes; Head and Hand edits need no gait work.
    if (ageMode !== 'adult' && (ageValues().widthConvergence > 0 || ageValues().heightConvergence > 0)) queueAgeRender('widthConvergence'); // Recompute all actors once, since the reference changed.
    syncLegPortraitAlignment(selected); // Hip and painted torso stay attached under separate Leg length and Portrait height edits.
    if (changedField === 'handScale') scheduleHandResize(selected); // Debounced cached GLB replacement keeps mobile slider movement responsive.
    syncSpineGuides(); // The guide follows the true resized body, not the former combined Height factor.
    window.ProceduralHandFrameDriver?.syncNow?.();
    return true;
  }

  // Age is per-NPC instance data, not species+gender-authored — it's stored and
  // persisted separately (see host().setNpcAge), and only ever composes with
  // whatever headOffsetY the selected character's profile already has.
  function applyAgeSlider() {
    if (!active || ageMode !== 'adult' || !selected?.npc?.id) return;
    const percent = clampAgePercent(document.getElementById('maaFullScaleRangeAge').value);
    setSliderValue('Age', percent);
    host()?.setNpcAge?.(selected.npc.id, percent / 100);
    applyPreviewProportions(selected); // Keep the selected NPC's age hunch and lineup stage independent.
    syncSpineGuides(); // Age only shifts head/spine; do not re-solve or relocate unchanged procedural legs. // Aged stoop may move the head independently of permanent species posture.
  }

  function persistProfiles() {
    clearTimeout(persistTimer);
    persistTimer = 0;
    try {
      const data = host()?.serializeRig?.() || {
        schema: 'hobunji.attachment-rig-profiles.v10',
        exportedAt: new Date().toISOString(),
        profiles: clone(window.HOBUNJI_ATTACHMENT_RIG_PROFILES || {}),
      };
      localStorage.setItem(RIG_SAVE_KEY, JSON.stringify(data));
    } catch (error) { console.warn('[full-character-scale] profile autosave failed', error); }
  }

  // Restore the 26 user-uploaded adult silhouettes, rather than an older main checkpoint.
  // A saved local rig can outlive new defaults, so provide an explicit adult-only import action.
  function applyUploadedAdultScales() {
    if (!active) return;
    ageConvergenceBasis = null; stageBasisCache=null; // Imported adult values change the shared reference.
    const baseline = window.HobunjiCharacterRigScaleDefaults?.uploadedScaleRestoreValues; // All 18 canonical plus 8 auxiliary identities; each adult part comes from the approved upload.
    const bridge = host();
    if (!baseline || typeof bridge?.setRigScale !== 'function') {
      status('Cannot apply uploaded scales: imported reference or Rig persistence is unavailable.');
      return;
    }
    const items = Object.entries(baseline); // Stable per-profile order; only the final write persists the completed map.
    let count = 0; // Reported on mobile, never inferred from the number of visible preview actors.
    for (let i = 0; i < items.length; i++) {
      const [key, original] = items[i];
      const [species, gender] = key.split('::');
      if (!species || !gender || !(Number(original?.y) > 0)) continue;
      const next = {
        x: original.x, y: original.y, legLength: original.legLength ?? original.y,
        head: original.head, offsetY: original.offsetY,
        handScale: original.handScale, footScale: original.footScale,
      }; // Apply the complete uploaded adult silhouette, retaining independent age-wide controls.
      if (bridge.setRigScale(species, gender, next, { persist: i === items.length - 1 }) != null) count++;
    }
    const pngFeet = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.footScale; // Keep newly spawned gameplay feet consistent with restored author scales.
    if (pngFeet) for (const [key, original] of items) {
      const [species, gender] = key.split('::');
      pngFeet[species] ||= {};
      pngFeet[species][gender] = original.footScale;
    }
    const handApi = window.HobunjiHandModelProfiles; // One mutation instead of 26 separate GLB reloads.
    if (typeof handApi?.mutate === 'function') handApi.mutate(data => {
      data.speciesScaleOverrides ||= {};
      for (const [key, original] of items) {
        const [species, gender] = key.split('::');
        data.speciesScaleOverrides[species] ||= {};
        data.speciesScaleOverrides[species][gender] = original.handScale;
      }
    }, { kind: 'data' });
    for (const entry of entries) {
      entry.feet?.setFootScaleMultiplier?.(baseline[entry.key]?.footScale || partScaleFor(entry, 'foot')); // Actual procedural foot shapes update, not just their JSON profile.
      applyPreviewProportions(entry);
      syncLegPortraitAlignment(entry);
      if (entry.species === 'longoran') refreshLongoranSpine(entry); // Restore silhouettes without resetting authored kyphosis.
    }
    window.ProceduralHandFrameDriver?.syncNow?.();
    syncSpineGuides();
    if (selected) select(selected);
    persistProfiles(); // Native Rig export and local backup get the same restored adult values.
    layout();
    frame();
    status(`Applied ${count}/${items.length} adult profiles from uploaded Full Character Scale (3). Baby/toddler/child modifiers and per-NPC hunches remain unchanged.`);
    return count; // Autosave migration records success only after the complete uploaded adult map is persisted.
  }

  function migratePersistedUploadedScalesOnce() {
    // Previously opened Raw Githack builds share localStorage. Import user-approved values
    // once for stale local rigs, but never overwrite new edits on subsequent visits.
    let saved = false; // Do not write default overrides for a fresh browser with no older authored scale data.
    try {
      if (localStorage.getItem(UPLOADED_SCALE_MIGRATION_KEY)) return false; // Never repeat after a later deliberate author edit.
      saved = ['hobunjiFullCharacterRigScales.v2', 'hobunjiFullCharacterRigScales.v1', RIG_SAVE_KEY]
        .some(key => !!localStorage.getItem(key)); // Only already-persisted local rigs require corrective migration.
    } catch (_) { return false; } // Storage may be disabled on mobile private browsing.
    if (!saved) return false;
    const restored = applyUploadedAdultScales(); // All 26 approved profiles, without touching age-stage drafts or NPC hunch.
    if (!(restored > 0)) return false;
    try { localStorage.setItem(UPLOADED_SCALE_MIGRATION_KEY, 'uploaded-v3'); } catch (_) {}
    return true;
  }

  // Discards every author override — in-memory, both localStorage persistence keys,
  // and the authored fields on every live shared profile — then re-derives x/y/head/
  // offsetY straight from character-rig-scale-defaults.js and reapplies it to every
  // visible lineup avatar (not just the selected one). Also clears every per-NPC age
  // override, so "everything" really does mean the whole comparison, not just
  // whatever's currently picked.
  function resetAllToRepoDefaults() {
    ageConvergenceBasis = null; // Reset invalidates the cached reference.
    if (!active) return;
    if (window.confirm && !window.confirm('Reset every species/gender scale, Longoran posture/gait, every per-NPC hunch, and the global baby/toddler/child proportions to repository defaults? This discards local overrides.')) return;
    ageProfiles=window.HobunjiCharacterAgeRigConfig?.repositoryProfiles?.() || {}; ageOverall={adult:1,baby:1,toddler:1,child:1}; stageBasisCache=null;
    ageModifiers = repositoryAgeModifiers(); // Reset global baby/toddler/child modifiers alongside per-species edits.
    try { localStorage.removeItem(AGE_SAVE_KEY); } catch (_) {}
    syncAgeControls();
    try { window.HobunjiCharacterAgeRigConfig?.restoreRepositoryOnThisDevice?.(); } catch (error) { console.warn('[full-character-scale] game age reset failed', error); }
    window.HobunjiLongoranSpecies?.resetAuthorTuning?.(); // Restores the same shipped defaults used by new Longoran spawns.
    clearTimeout(handScaleTimer); // A queued pre-reset hand rebuild must not restore an abandoned scale.
    handScaleTimer = 0;
    const count = host()?.resetToRepositoryDefaults?.() || 0;
    for (const entry of entries) {
      applyAnatomyConfig(entry.profile); // Preserve native hand/foot source tables when resetting all ages.
      entry.feet?.setFootScaleMultiplier?.(partScaleFor(entry, 'foot'));
      applyPreviewProportions(entry); // Restore species scale and current reset age stage together.
      syncLegPortraitAlignment(entry);
      if (entry.species === 'longoran') { refreshLongoranSpine(entry); rebuildLongoranFeet(entry); }
    }
    restorePartRuntimeDefaults(); // Reset the *actual* source tables as well: a missing hand/foot author override must not leave last-edited geometry on future characters.
    for (const entry of entries) entry.feet?.setFootScaleMultiplier?.(partScaleFor(entry, 'foot')); // Newly restored fallback values also affect current lineup feet.
    syncSpineGuides(); // Reset visibly restores all selected vertebra positions and the real head pivot.
    window.ProceduralHandFrameDriver?.syncNow?.();
    if (selected) select(selected);
    persistProfiles();
    layout();
    retryLateAgeLimbs();
    status(`Reset ${count} species/gender scales, every per-NPC hunch, and all global age modifiers to repository defaults.`);
  }

  function exportJson() {
    const data = {};
    for (const descriptor of profileDescriptors()) {
      const profile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[descriptor.key];
      const scale = window.HobunjiCharacterRigScale?.scaleFor?.(descriptor.species, descriptor.gender, profile) || { x: 1, y: 1, head: 1, offsetY: 0 };
      data[descriptor.species] ||= {};
      const preview = entries.find(entry => entry.key === descriptor.key); // Loaded preview supplies the real unscaled hip; absent previews use a neutral diagnostic fallback.
      const dimensions = preview ? window.HobunjiCharacterRigScale?.heightBeltlineFor?.(scale, beltlineGeometryFor(preview)) : null; // Never invent a beltline percentage for missing/unrendered preview anatomy.
      data[descriptor.species][descriptor.gender] = {
        ...(dimensions ? {
          height: Math.round(dimensions.height * 10000) / 10000,
          beltlineHeightPercent: Math.round(dimensions.beltline * 1000000) / 10000, // Actual floor-to-hip %, including sole-contact height.
        } : {}),
        x: Math.round(scale.x * 10000) / 10000,
        y: Math.round(scale.y * 10000) / 10000, // Legacy field: same value as portraitHeight, for older consumers.
        portraitHeight: Math.round(scale.y * 10000) / 10000,
        legLength: Math.round((scale.legLength || scale.y) * 10000) / 10000,
        handScale: Math.round(partScaleFor({ species: descriptor.species, gender: descriptor.gender, profile }, 'hand') * 10000) / 10000,
        footScale: Math.round(partScaleFor({ species: descriptor.species, gender: descriptor.gender, profile }, 'foot') * 10000) / 10000,
        head: Math.round(scale.head * 10000) / 10000,
        offsetY: Math.round(scale.offsetY * 10000) / 10000,
      };
    }
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hobunji_full_character_scales.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status('Exported Height and Beltline height (%), with backward-compatible portrait/leg factors for gameplay and Rig imports.');
  }

  function rememberPartRuntimeDefaults(species, gender) {
    const key = `${species}::${gender}`; // Stable species+gender snapshot for Reset all, independent of user-authored slider values.
    if (originalPartRuntime.has(key)) return;
    const hand = window.HobunjiHandModelProfiles?.data?.speciesScaleOverrides?.[species]; // Original hand-model scale table before slider edits.
    const feet = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.footScale?.[species]; // Original procedural foot scale table.
    originalPartRuntime.set(key, {
      hand: hand != null && Object.prototype.hasOwnProperty.call(hand, gender) ? hand[gender] : null,
      foot: feet != null && Object.prototype.hasOwnProperty.call(feet, gender) ? feet[gender] : null,
    });
  }

  function restorePartRuntimeDefaults() {
    const png = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar; // Existing game-wide source for procedural feet; restore before spawning new previews.
    const handApi = window.HobunjiHandModelProfiles; // One batched notification rebuilds hands instead of one rebuild per lineup member.
    const handRestores = [];
    for (const [key, original] of originalPartRuntime) {
      const [species, gender] = key.split('::');
      const feet = png?.proceduralFeet?.footScale;
      if (feet) {
        if (original.foot == null) {
          if (feet[species]) {
            delete feet[species][gender];
            if (!Object.keys(feet[species]).length) delete feet[species];
          }
        } else {
          feet[species] ||= {};
          feet[species][gender] = original.foot;
        }
      }
      const currentHand = handApi?.data?.speciesScaleOverrides?.[species]?.[gender];
      if ((currentHand ?? null) !== original.hand) handRestores.push({ species, gender, value: original.hand });
    }
    if (handRestores.length && handApi?.mutate) handApi.mutate(data => {
      data.speciesScaleOverrides ||= {};
      for (const { species, gender, value } of handRestores) {
        if (value == null) {
          if (!data.speciesScaleOverrides[species]) continue;
          delete data.speciesScaleOverrides[species][gender];
          if (!Object.keys(data.speciesScaleOverrides[species]).length) delete data.speciesScaleOverrides[species];
        } else {
          data.speciesScaleOverrides[species] ||= {};
          data.speciesScaleOverrides[species][gender] = value;
        }
      }
    }, { kind: 'data' }); // Revert precisely the touched entries; do not erase unrelated Hand Model Author changes.
  }

  function applyAnatomyConfig(profile) {
    const anatomy = profile?.anatomy || {};
    const species = normalizeSpecies(profile?.species);
    const gender = normalizeGender(profile?.gender);
    const pngConfig = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar;
    if (!species || !gender || !pngConfig) return;
    rememberPartRuntimeDefaults(species, gender); // Save unedited hand/foot fallback tables once before a slider changes them.

    const placement = Number(anatomy.portraitVerticalPlacementRatio);
    if (Number.isFinite(placement)) {
      pngConfig.portraitVerticalPlacement ||= { default: .5 };
      pngConfig.portraitVerticalPlacement[species] ||= {};
      pngConfig.portraitVerticalPlacement[species][gender] = placement;
    }

    const portraitScale = Number(anatomy.portraitScale);
    if (Number.isFinite(portraitScale) && portraitScale > 0) {
      pngConfig.portraitScaleBySpecies ||= {};
      const legacy = Number(pngConfig.portraitScaleBySpecies[species]);
      const entry = typeof pngConfig.portraitScaleBySpecies[species] === 'object'
        ? pngConfig.portraitScaleBySpecies[species]
        : { default: Number.isFinite(legacy) && legacy > 0 ? legacy : 1 };
      entry[gender] = portraitScale;
      pngConfig.portraitScaleBySpecies[species] = entry;
    }

    const footScale = Number(anatomy.footScale);
    if (Number.isFinite(footScale) && footScale > 0) {
      pngConfig.proceduralFeet ||= {};
      pngConfig.proceduralFeet.footScale ||= { default: 1 };
      pngConfig.proceduralFeet.footScale[species] ||= {};
      pngConfig.proceduralFeet.footScale[species][gender] = footScale;
    }

    const handScale = Number(anatomy.handScale);
    const profiles = window.HobunjiHandModelProfiles; // Existing hand-model profiles rebuild active GLBs when the species-scale value actually changes.
    const currentHand = Number(profiles?.data?.speciesScaleOverrides?.[species]?.[gender]);
    if (Number.isFinite(handScale) && handScale > 0 && currentHand !== handScale && profiles?.mutate) {
      profiles.mutate(data => {
        data.speciesScaleOverrides ||= {};
        data.speciesScaleOverrides[species] ||= {};
        data.speciesScaleOverrides[species][gender] = handScale;
      }, { kind: 'species-scale', speciesId: species, gender }); // Do not refresh every actor's hands on unrelated width/head sliders.
    }
  }

  async function renderPortrait(canvas, profile, options) {
    const job = portraitRenderChain.then(() => window.NpcAvatarPreview.renderProfileToCanvas(canvas, profile, options));
    portraitRenderChain = job.catch(() => {});
    return job;
  }

  async function buildPortrait(npc) {
    await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: '../../assets/', configBase: '../../config/' });
    const exportNpc = portraitExportFor(npc);
    let profile = window.NpcAvatarPreview.buildProfileFromNpcExport(exportNpc);
    if (!profile) {
      profile = window.NpcAvatarPreview.randomProfile(`full-scale:${npc.id || npc.name}`, {
        speciesId: exportNpc.appearance.speciesId,
        gender: exportNpc.appearance.gender,
      });
    }
    if (!profile) throw new Error(`Could not build a portrait profile for ${npc.name || npc.id}.`);
    const size = Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.previewPortraitCanvasSize) || 200;
    const front = Object.assign(document.createElement('canvas'), { width: size, height: size });
    const back = Object.assign(document.createElement('canvas'), { width: size, height: size });
    const head = Object.assign(document.createElement('canvas'), { width: size, height: size });
    await renderPortrait(front, profile, { seatId: npc.id || npc.name || 'full-scale', forceEyesOpen: true }); // Static model texture: suppress unused blink PNG requests.
    await renderPortrait(back, profile, { seatId: npc.id || npc.name || 'full-scale', portraitView: 'behind', forceEyesOpen: true }); // Preserve full rear cosmetics.
    // Same pattern the real game uses (see game.js's playerNeckJoint/NPC dialogue setup): a
    // head-only render lets buildSinglePlaneAvatarModel's neckRig option locate the head pixels
    // and skin-weight a neck bone for it. Without this, there is no bone for Full Character
    // Scale's Head slider to drive at all — it silently does nothing.
    await renderPortrait(head, profile, { seatId: npc.id || npc.name || 'full-scale', onlyHeadSprite: true, forceEyesOpen: true });
    return { exportNpc, profile, front, back, head };
  }

  function avatarBaseWidth() {
    const configured = Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth);
    return Number.isFinite(configured) && configured > 0 ? configured : 0.9;
  }

  async function buildPreviewEntry(rep, buildId) {
    const rigProfile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[rep.key];
    if (!rigProfile) throw new Error(`Missing rig profile ${rep.key}.`);
    rigProfile.anatomy ||= {};
    const initialScale = window.HobunjiCharacterRigScale?.scaleFor?.(rep.species, rep.gender, rigProfile) || { x: 1, y: 1, head: 1, offsetY: 0 };
    rigProfile.anatomy.rigScaleX ??= initialScale.x;
    rigProfile.anatomy.rigScaleY ??= initialScale.y;
    rigProfile.anatomy.headScale ??= initialScale.head;
    rigProfile.anatomy.headOffsetY ??= initialScale.offsetY;
    rigProfile.anatomy.legLengthScale ??= initialScale.legLength; // Seed alongside rigScaleY so the species' authored leg default survives later scaleFor reads.
    applyAnatomyConfig(rigProfile);

    const previewNpc = isChild(rep.npc)
      ? { ...rep.npc, role: 'adult', tags: (rep.npc.tags || []).filter(tag => String(tag).toLowerCase() !== 'child') }
      : rep.npc; // Child-only NPC donors must not pre-shrink the rig before the selected global age stage is applied.
    const avatar = await buildPortrait(rep.npc);
    if (buildId !== generation || !previewRoot) return null; // Exiting mid-network-load must never attach a stale mesh to a disposed comparison scene.
    const group = new THREE.Group(); // Preview-only parent used by portrait, hands, feet, and whole-character scale together.
    group.name = `FullScalePreview_${rep.key}`;
    group.userData.fullScalePreviewKey = rep.key;
    let entry = null; // Both async hand and foot GLB callbacks refer to the same preview entry after registration.

    const baseWidth = avatarBaseWidth();
    const model = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE, avatar.front, {
      backCanvas: avatar.back,
      headCanvas: avatar.head,
      neckRig: true, // Without this, buildSinglePlaneAvatarModel never builds a neck bone, and the Head slider (which only ever drives that bone — see applyHeadCompensation) has nothing to act on.
      profile: avatar.profile,
      appearance: avatar.exportNpc.appearance,
      npcRecord: previewNpc, // Preview starts from unscaled adult anatomy even if the only available representative was an authored child.
      onHandVisualReplaced(side, visual) {
        if (!entry?.group?.parent) return; // Never mutate a preview that was already exited or cancelled.
        entry.ageVisuals ||= {};
        entry.ageVisuals[`${side}_hand_visual`] = visual;
        syncAgeLimbs(entry, 'hand'); // Apply age proportions again when imported GLBs replace their original fallback hands.
      },
      modelWidth: baseWidth,
      modelHeight: baseWidth,
      name: `${group.name}_portrait`,
      userData: { source: 'full-character-scale-preview', nonInteractive: true, npcId: rep.npc.id || null },
    });
    model.userData.proceduralHandParent = group; // Exact Rig reference-NPC contract: the normal free-hand runtime owns hand placement under this floor-relative parent.
    model.userData.rigAvatarProfile = avatar.profile;
    group.add(model);

    const modelHeight = Number(model.userData.portraitModelHeight) || 1;
    const modelWidth = Number(model.userData.portraitModelWidth) || modelHeight;
    model.position.y = modelHeight / 2;

    const feet = window.ProceduralLegAnimation?.attach?.(THREE, group, {
      speciesId: rep.species,
      gender: rep.gender,
      bodyColors: avatar.profile?.bodyColors || avatar.exportNpc.appearance?.bodyColors,
      modelWidth,
      modelHeight,
      handAttachY: model.userData.handAttachY,
      name: `${group.name}_feet`,
      profile: avatar.profile,
      ...(rep.species === 'longoran' ? { spine: window.HobunjiLongoranSpecies?.spineFor?.(rep.gender), gaitProfile: window.HobunjiLongoranSpecies?.gaitFor?.(rep.gender) } : {}), // Uses the identical authored gait when building the lineup.
      portraitSize: avatar.front.width || 200,
      onFootVisualsReplaced({ left, right }) {
        if (!entry || !entry.group?.parent) return; // A disposed/cancelled comparison must never retain a late-arriving GLB.
        entry.ageVisuals ||= {};
        entry.ageVisuals.left_foot = left;
        entry.ageVisuals.right_foot = right;
        syncAgeLimbs(entry, 'foot'); // Scale the visible final GLBs, not their discarded placeholder meshes.
      },
    }) || null; // Same orientation as gameplay: the portrait front, toes and spine hunch all face +Z (toward the lineup camera).

    previewRoot.add(group);
    const measuredBeltline = Number(feet?.restPosteriorY) / modelHeight; // Shared model/leg floor-local coordinates: the unscaled hip divided by the unscaled top.
    entry = { ...rep, group, model, feet, spineGuide: null, profile: rigProfile, avatarProfile: avatar.profile, frontCanvas: avatar.front,
      basePortraitY: model.position.y,
      beltlineBaseFraction: Number.isFinite(measuredBeltline) && measuredBeltline > .05 && measuredBeltline < .95 ? measuredBeltline : .5 }; // Never invent a modified hip ratio from authored portrait or leg scales. // Shared entry for late age-limb imports, the spine guide and pants.
    applyPreviewProportions(entry); // Preserve both age stage and independent portrait/leg authored scale at spawn.
    window.ProceduralHandFrameDriver?.syncNow?.();
    attachPreviewPants(entry, avatar.front); // Gameplay covers the hip-to-foot span with the NPC's leg garment.
    feet?.update?.(0, 0, false, null);
    syncLegPortraitAlignment(entry); // The lineup starts with any previously authored independent leg length without separating hips from the torso.
    if (rep.species === 'longoran') refreshLongoranSpine(entry); // Gameplay-static back curvature is visible on the initial lineup, not only after touching a slider.
    return entry;
  }

  async function buildChair() {
    const config = await json(chairUrl);
    const group = new THREE.Group();
    group.name = 'FullScaleReference_chairSimple';
    for (const part of (config?.parts || [])) {
      if (!['box','legSquare'].includes(part?.kind)) continue;
      const t = part.transform || {};
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial({ color: part.color || '#8b6540' }));
      mesh.position.set(Number(t.x)||0, Number(t.y)||0, Number(t.z)||0);
      mesh.rotation.set(THREE.MathUtils.degToRad(Number(t.rx)||0), THREE.MathUtils.degToRad(Number(t.ry)||0), THREE.MathUtils.degToRad(Number(t.rz)||0));
      mesh.scale.set(Math.abs(Number(t.sx)||0.01), Math.abs(Number(t.sy)||0.01), Math.abs(Number(t.sz)||0.01));
      group.add(mesh);
    }
    return group;
  }

  function installSixFootGuide(referenceChair, scene) {
    if (!THREE || !referenceChair || !scene) return;
    const bounds = new THREE.Box3().setFromObject(referenceChair);
    if (bounds.isEmpty()) return;
    const chairBackHeight = bounds.max.y; // chairSimple's authored top measured strictly from game floor Y=0.
    if (!(chairBackHeight > 0)) return;
    sixFootHeight = chairBackHeight * (6 / 3); // A standard ~3 ft full chair height is the game's physical ruler; 6 ft = two chair backs.
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      color: 0xb6c9d6, transparent: true, opacity: 0.58, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    })); // Single 1.5-screen-pixel stripe; no shadows, textures or extra scene searches per frame.
    line.name = 'FullScaleReference_sixFootLine';
    line.frustumCulled = false; // Its camera-following position changes during onBeforeRender, after frustum tests.
    line.renderOrder = -1000; // Draw behind portrait sprites; their depth/alpha remains in front of the marker.
    line.userData.fullCharacterScalePreviewOnly = true;
    line.userData.referenceHeightFeet = 6;
    const forward = new THREE.Vector3(); // Reused per draw; camera direction towards the center of the lineup.
    const rotation = new THREE.Quaternion(); // Reused per draw; billboard faces the live orbit/pinch camera.
    const projected = new THREE.Vector3(); // Camera-space projection of the proposed world-height marker.
    const center = new THREE.Vector3(); // NDC-to-world horizontal centering at the reference depth.
    const edgeL = new THREE.Vector3(); // Clip-space left extent, unprojected at that depth.
    const edgeR = new THREE.Vector3(); // Clip-space right extent, unprojected at that depth.
    const edgeTop = new THREE.Vector3(); // Clip-space top extent for constant pixel-thickness.
    const edgeBottom = new THREE.Vector3(); // Clip-space bottom extent for constant pixel-thickness.
    const fallbackTarget = new THREE.Vector3(); // Used when the backdrop has no OrbitControls target.
    const canvas = document.getElementById('view3d'); // Capture once, read its live height when the renderer draws.
    line.onBeforeRender = (_renderer, _scene, camera) => {
      if ((!active && !building) || !camera || !previewRoot) return;
      camera.getWorldDirection(forward); // Orbit controls can rotate freely; stay behind the characters along viewing direction.
      forward.y = 0;
      if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
      else forward.normalize();
      const target = window.HobunjiGameplayBackdrop?.getCameraControls?.()?.target || fallbackTarget;
      const bounds = sixFootLineupBounds;
      const backX = forward.x >= 0 ? bounds?.maxX : bounds?.minX;
      const backZ = forward.z >= 0 ? bounds?.maxZ : bounds?.minZ;
      const projectedBack = bounds ? (backX - target.x) * forward.x + (backZ - target.z) * forward.z : 0; // Four precomputed bounds handle end-on views of the wide lineup without a character scan.
      const depth = Math.max(sixFootGuideDepth, projectedBack + 1); // Always behind the furthest character/chair for any horizontal orbit angle.
      line.position.set(target.x + forward.x * depth, sixFootHeight, target.z + forward.z * depth);
      projected.copy(line.position).project(camera);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) return; // No transient array allocations in render hook.
      center.set(0, projected.y, projected.z).unproject(camera);
      line.position.x += center.x - line.position.x; // Fix the horizontal shift from the orthographic author sidebar.
      line.position.z += center.z - line.position.z; // Still level at precisely six feet, even when orbiting.
      edgeL.set(-1, projected.y, projected.z).unproject(camera);
      edgeR.set(1, projected.y, projected.z).unproject(camera);
      edgeTop.set(0, 1, projected.z).unproject(camera);
      edgeBottom.set(0, -1, projected.z).unproject(camera);
      const viewWidth = edgeL.distanceTo(edgeR);
      const viewHeight = edgeTop.distanceTo(edgeBottom);
      const pixels = Math.max(1, canvas?.clientHeight || 450);
      camera.getWorldQuaternion(rotation);
      line.quaternion.copy(rotation);
      line.scale.set(viewWidth * 1.04, viewHeight / pixels * 1.5, 1); // Width tracks zoom; line remains ~1.5 pixels thick on mobile.
      line.updateMatrixWorld(true); // onBeforeRender runs after the renderer's normal world-matrix update.
    };
    scene.add(line); // Keep OUTSIDE previewRoot so Frame lineup and Focus do not include the screen-following ruler.
    sixFootGuide = line;
  }

  function layout(anchor = manualViewInteraction ? selected : null) {
    if (!THREE || !entries.length || !previewRoot) return;
    const anchorX = entries.includes(anchor) ? Number(anchor.group.position.x) : NaN; // Snapshot before resetting group positions to measure new widths.
    if (chair) chair.parent?.remove?.(chair);
    let cursor = 0;
    let minDepth = Infinity, maxDepth = -Infinity; // Cached Box3 depth of all previews; avoids an all-NPC traversal on each camera frame.
    let previous = null; // Family boundaries get more breathing room than male/female companions, without extra geometry.
    for (const entry of entries) {
      cursor += lineupSpacing(previous, entry); // Linear pass: no sorting or scene-wide search during size edits.
      entry.group.position.set(0,0,0);
      entry.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(entry.group);
      minDepth = Math.min(minDepth, box.min.z); maxDepth = Math.max(maxDepth, box.max.z); // Reuse the Box3 already computed for pair spacing.
      const width = Math.max(0.45, box.getSize(new THREE.Vector3()).x);
      const centerX = box.getCenter(new THREE.Vector3()).x;
      entry._lineX = cursor + width / 2 - centerX;
      cursor += width;
      previous = entry;
    }
    if (chair) {
      previewRoot.add(chair);
      chair.position.set(cursor + 0.48,0,0);
      chair.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(chair);
      minDepth = Math.min(minDepth, box.min.z); maxDepth = Math.max(maxDepth, box.max.z); // Chair must also stay in front of the ruler.
      const width = Math.max(0.45, box.getSize(new THREE.Vector3()).x);
      chair.position.x += width / 2 - box.getCenter(new THREE.Vector3()).x;
      cursor += 0.48 + width;
    }
    if (Number.isFinite(minDepth) && Number.isFinite(maxDepth)) sixFootGuideDepth = Math.max(1.5, Math.abs(minDepth), Math.abs(maxDepth)) + 1; // Conservative back-plane distance for all orbit directions.
    const shift = Number.isFinite(anchorX) ? anchor._lineX - anchorX : cursor / 2; // Preserve the selected floor origin; camera and zoom remain untouched.
    sixFootLineupBounds = { minX: -shift, maxX: cursor - shift, minZ: minDepth, maxZ: maxDepth }; // Exact shifted X extents and cached geometry Z, measured once per layout.
    for (const entry of entries) entry.group.position.x = entry === anchor && Number.isFinite(anchorX) ? anchorX : entry._lineX - shift; // Assign the exact saved anchor to prevent cumulative roundoff.
    if (chair) chair.position.x -= shift;
    previewRoot.updateMatrixWorld(true);
  }

  function focusSelected() {
    if ((!active && !building) || !THREE || !selected?.group) return;
    manualViewInteraction = true; // Explicit camera requests win over the deferred auto-fit at the end of loading.
    focusedEntryKey = selected.key; // Explicit user action: keep this focus even if a different character is selected for editing.
    if (window.HobunjiFullScaleEditorPresentation?.frameOrthographic) {
      window.HobunjiFullScaleEditorPresentation.frameOrthographic(true, true); // The shared orthographic owner centers and sizes the chosen preview exactly once.
    } else {
      const camera = window.HobunjiGameplayBackdrop?.getCamera?.();
      if (!camera) return;
      const box = new THREE.Box3().setFromObject(selected.group); // Perspective fallback for tools without the orthographic adapter.
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const canvas = document.getElementById('view3d');
      const aspect = Math.max(0.1, Number(camera.aspect) || ((canvas?.clientWidth || 1) / Math.max(1, canvas?.clientHeight || 1)));
      const verticalFov = THREE.MathUtils.degToRad(Number(camera.fov) || 50);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const byWidth = (size.x / 2 + 0.3) / Math.max(0.01, Math.tan(horizontalFov / 2));
      const byHeight = (size.y / 2 + 0.3) / Math.max(0.01, Math.tan(verticalFov / 2));
      const distance = Math.max(1.5, byWidth, byHeight) * 1.25 + size.z / 2;
      const angleX = selected.species === 'longoran' ? distance * 0.7 : 0; // Longoran depth curvature is only exposed when explicitly focused.
      camera.position.set(center.x + angleX, center.y + (angleX ? distance * 0.1 : 0), center.z + distance);
      camera.lookAt(center);
      const controls = window.HobunjiGameplayBackdrop?.getCameraControls?.(); // Perspective fallback still orbits the explicitly focused character.
      controls?.target?.copy?.(center);
      controls?.update?.();
      camera.updateMatrixWorld?.(true);
    }
    status(`Focused ${prettySpecies(selected.species)} ${selected.gender}. Camera stays put while editing; Frame lineup returns to the whole comparison.`);
  }

  function frame() {
    if ((!active && !building) || !THREE || !previewRoot) return;
    focusedEntryKey = null; // Only an explicit Frame lineup action clears the previously chosen camera focus.
    if (window.HobunjiFullScaleEditorPresentation?.frameOrthographic) {
      window.HobunjiFullScaleEditorPresentation.frameOrthographic(true, true);
      return;
    }
    const camera = window.HobunjiGameplayBackdrop?.getCamera?.();
    if (!camera) return;
    const box = new THREE.Box3().setFromObject(previewRoot);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const canvas = document.getElementById('view3d');
    const aspect = Math.max(0.1, Number(camera.aspect) || ((canvas?.clientWidth || 1) / Math.max(1, canvas?.clientHeight || 1)));
    const verticalFov = THREE.MathUtils.degToRad(Number(camera.fov) || 50);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const byWidth = (size.x / 2 + 0.35) / Math.max(0.01, Math.tan(horizontalFov / 2));
    const byHeight = (size.y / 2 + 0.3) / Math.max(0.01, Math.tan(verticalFov / 2));
    const distance = Math.max(1.6, byWidth, byHeight) * 1.12 + size.z / 2;
    const targetY = Math.max(center.y, size.y * 0.42);
    camera.position.set(center.x, targetY + Math.min(0.2, size.y * 0.08), center.z + distance);
    camera.lookAt(center.x, targetY, center.z);
    const controls = window.HobunjiGameplayBackdrop?.getCameraControls?.(); // Perspective fallback resets the orbit pivot with the whole lineup.
    controls?.target?.set?.(center.x, targetY, center.z);
    controls?.update?.();
    camera.updateMatrixWorld?.(true);
  }

  function isolateNativeWorkspace() {
    if (nativeWorkspaceVisibility) return;
    const scene = window.HobunjiGameplayBackdrop?.getScene?.();
    const root = scene?.getObjectByName?.('AnimationAuthorWorkspace'); // Stable master root shared by Multi, Single and Rig; the comparison preview is a separate scene child.
    if (!root) return;
    nativeWorkspaceVisibility = { root, visible: root.visible }; // Preserve the actual starting mode's visibility without importing any project.
    root.visible = false;
  }

  function restoreNativeWorkspace() {
    if (!nativeWorkspaceVisibility) return;
    nativeWorkspaceVisibility.root.visible = nativeWorkspaceVisibility.visible; // Never alter native actor selection, undo stack, or rig state.
    nativeWorkspaceVisibility = null;
  }

  async function buildLineup(buildId) {
    const reps = await representatives();
    if (buildId !== generation) return; // Abort immediately if a tab switch occurred while fetching the NPC roster.
    const ordered = reps.sort(compareLineupEntries); // Kenkari → Slagothim → Engh-sho/Mao'ao → Oliphanti → others; each male/female pair is adjacent.
    const missing = ordered.filter(item => !item.npc);
    if (missing.length) status(`Missing preview NPC: ${missing.map(item => item.key).join(', ')}`);
    entries = [];
    const expected = ordered.filter(item => item.npc).length; // The mobile progress text counts only buildable representatives.

    THREE = (await window.PNGPlaneAvatar?.loadThreeModules?.())?.THREE || null;
    if (buildId !== generation) return;
    if (!THREE) throw new Error('Three.js is unavailable.');
    const scene = window.HobunjiGameplayBackdrop?.getScene?.();
    if (!scene) throw new Error('Animation Author backdrop scene is unavailable.');
    if (!window.NpcAvatarPreview || !window.ProceduralLegAnimation || !window.ProceduralHandFrameDriver) {
      throw new Error('Rig preview hand/foot runtime is unavailable.');
    }

    previewRoot = new THREE.Group();
    previewRoot.name = 'FullCharacterScalePreviewRoot';
    previewRoot.userData.fullCharacterScalePreviewOnly = true;
    scene.add(previewRoot);
    const chooser = document.getElementById('maaFullScaleChoose'); // Options appear as soon as their actual preview meshes are ready.
    chooser?.replaceChildren();

    for (const rep of ordered) {
      if (buildId !== generation) return;
      if (!rep.npc) continue;
      status(`Loading ${entries.length + 1}/${expected}: ${prettySpecies(rep.species)} ${rep.gender} (ready previews remain editable)…`);
      let entry;
      try { entry = await buildPreviewEntry(rep, buildId); }
      catch (error) {
        if (buildId !== generation) return;
        console.warn('[full-character-scale] skipped unrenderable species preview', rep.key, error);
        status(`Skipped ${prettySpecies(rep.species)} ${rep.gender}: ${error.message}`);
        continue; // One missing optional species asset must not discard all successfully rendered comparisons.
      }
      if (buildId !== generation || !entry) return;
      entries.push(entry);
      ageConvergenceBasis=null; stageBasisCache=null; // Include newly available identities in the next whole-lineup correction.
      if (chooser) {
        const option = document.createElement('option');
        option.value = entry.key;
        option.textContent = `${prettySpecies(entry.species)} · ${entry.gender}`;
        chooser.appendChild(option);
      }
      if (!selected) {
        active = true; // The first Kenkari is editable as soon as its preview is available.
        layout();
        select(entry); // The first Kenkari can be edited immediately, without forcing a new camera angle.
        frame(); // Establish one initial framing; later edits and background loading must not move the camera.
      } else {
        layout(); // Every newly loaded character receives its own slot immediately; never overlap previews while images stream.
        // Background portrait arrivals can reposition models, but must never override a user's camera orbit or zoom.
      }
      chrome();
      await new Promise(resolve => setTimeout(resolve, 0)); // Yield a paint opportunity on mobile rather than monopolizing the UI between portraits.
    }
    if (buildId !== generation) return;
    if (!entries.length) throw new Error('No repository character previews could be built.');

    if (ageMode !== 'adult' && (ageValues().widthConvergence || ageValues().heightConvergence)) {
      for (const entry of entries) applyPreviewProportions(entry); // A draft started during progressive loading must converge the complete final lineup consistently.
    }
    const finishedChair = await buildChair();
    if (buildId !== generation) return;
    chair = finishedChair;
    installSixFootGuide(chair, scene); // Uses chairSimple's measured back top; scene-owned so camera fitting excludes the line.
    layout();
    // The final chair/layout must not undo manually chosen camera orientation or placement.
    window.ProceduralHandFrameDriver?.syncNow?.();
    // Do not automatically reframe after all backgrounds finish: a player may already be editing
    // Longoran or inspecting a specific face. The existing Frame lineup action shows everyone.
    if (!selected) select(entries[0]);
    if (!manualViewInteraction) frame(); // Initial auto-fit only after all previews arrive, and never after edits, gestures or explicit focus.
    retryLateAgeLimbs(); // Give async hand/foot GLBs a bounded chance to receive the active stage's shared scale.
    status(`All ${entries.length}/${expected} species/gender previews ready. Use Frame lineup to see everyone.`);
    // Do not compete with buildPortrait's shared renderer while the lineup loads.
    // The existing CharacterDimensions module measures only bare source art, once per
    // session. Afterward the shared gameplay rig scaler corrects each target height.
    const dimensions = window.HobunjiCharacterDimensions;
    if (dimensions?.subscribe && dimensions?.measureAll) {
      unsubscribePixelHeights?.();
      unsubscribePixelHeights = dimensions.subscribe(() => {
        if (buildId !== generation || (!active && !building) || !entries.length) return;
        ageConvergenceBasis = null; stageBasisCache=null; // Replace nominal fallback with the measured full-lineup reference once the existing scan finishes.
        for (const entry of entries) {
          applyPreviewProportions(entry); // The cached pixel solver now knows real source head/body bounds.
          syncLegPortraitAlignment(entry); // Keep the actual leg hip joined to its newly calibrated portrait.
        }
        window.ProceduralHandFrameDriver?.syncNow?.();
        layout(); // One Box3 pass after measurement; no new renderer or per-frame work.
        const count = Object.keys(lineupConvergenceBasis()).length;
        status(`Measured ${count} adult species/gender profiles for cross-lineup age convergence. Unmeasured art uses nominal proportions.`);
      });
      dimensions.measureAll().catch(error => {
        if (buildId === generation && (active || building)) status(`PNG crown measurement unavailable: ${error?.message || error}. Displayed height targets remain nominal.`);
      });
    }
  }

  function disposePreview() {
    ageConvergenceBasis = null; stageBasisCache=null; // Never keep stale live-profile measurements across editor sessions.
    unsubscribePixelHeights?.();
    unsubscribePixelHeights = null; // An asynchronous portrait measurement cannot mutate a disposed lineup.
    if (selectedLayoutFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(selectedLayoutFrame);
    selectedLayoutFrame = 0; // Avoid a late relayout referencing disposed actors.
    stopLongoranWalk();
    clearTimeout(longoranFeetTimer);
    longoranFeetTimer = 0;
    if (ageLimbTimer) clearInterval(ageLimbTimer);
    ageLimbTimer = 0;
    if (ageRenderFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(ageRenderFrame);
    ageRenderFrame = 0;
    ageDirtyBody = false;
    ageDirtyLimb = null;
    focusedEntryKey = null;
    manualViewInteraction = false; // A new editor session starts with a fresh no-interaction initial camera fit.
    selected = null;
    const focusButton = document.getElementById('maaFullScaleFocus');
    if (focusButton) focusButton.disabled = true;
    for (const entry of entries) {
      try { entry.spineGuide?.dispose?.(); } catch (_) {} // Remove line/joint meshes and release their shared geometry before disposing the skinned model.
      try { entry.feet?.dispose?.(); } catch (_) {}
      try { window.PNGPlaneAvatar?.disposeAvatarModel?.(entry.model); } catch (_) {}
      try { entry.group?.parent?.remove?.(entry.group); } catch (_) {}
    }
    entries = [];
    if (sixFootGuide) {
      sixFootGuide.parent?.remove?.(sixFootGuide);
      sixFootGuide.onBeforeRender = () => {}; // Clear captured camera/scene references on editor exit.
      sixFootGuide.geometry.dispose();
      sixFootGuide.material.dispose();
      sixFootGuide = null;
      sixFootHeight = null;
      sixFootGuideDepth = 2;
      sixFootLineupBounds = null; // Release the stale layout bounds before any subsequent preview session.
    }
    if (chair) {
      try { chair.parent?.remove?.(chair); } catch (_) {}
      chair.traverse?.(node => {
        try { node.geometry?.dispose?.(); } catch (_) {}
        try { node.material?.dispose?.(); } catch (_) {}
      });
      chair = null;
    }
    if (previewRoot) {
      try { previewRoot.parent?.remove?.(previewRoot); } catch (_) {}
      previewRoot = null;
    }
    window.ProceduralHandFrameDriver?.syncNow?.();
  }

  async function enter() {
    if (active || building || exitingPromise || !ensureUi()) return;
    building = true;
    isolationDebug.entries++;
    const buildId = ++generation;
    originMode = ['multi','single','rig'].includes(document.body.dataset.animationAuthorMode) ? document.body.dataset.animationAuthorMode : 'multi';
    try {
      const scaleHost = host();
      if (!scaleHost) throw new Error('Full Character Scale host is unavailable.');
      if (!window.HobunjiFullScaleBodyInputGuard?.applyScaleField)
        throw new Error('Scale controls are unavailable: the shared input guard failed to load.'); // Mobile-visible failure instead of a second, incompatible slider path.
      loadAgeModifiers();
      syncAgeControls();
      clearStartupError();
      isolateNativeWorkspace(); // These previews are scene-owned, not project actors: do not switch to Multi, clear actors or import empty projects.
      chrome();
      status('Building preview-only species/gender lineup…');
      await buildLineup(buildId);
      if (buildId !== generation) return;
      building = false;
      active = true;
      chrome();
      const migrated = migratePersistedUploadedScalesOnce(); // Brings old on-device scale overrides into parity with the new uploaded adult source.
      if (!migrated) status('Use the always-open character dropdown for per-species edits; Baby/Toddler/Child modes show and adjust the entire lineup.');
    } catch (error) {
      if (buildId !== generation) return; // The already-requested exit owns restoration and error reporting.
      console.warn('[full-character-scale]', error);
      building = false;
      active = false;
      status(`Could not build scale comparison: ${error.message}`);
      showStartupError(error); // Do not hide all diagnostics by returning to Rig after a failed preview build.
      try { await restoreWorkspace(); }
      finally {
        await host()?.setMode?.(originMode); // Even if an actor import failed, leave the broken comparison tab.
        document.getElementById(TAB_ID)?.setAttribute('aria-selected','false');
      }
    }
  }

  async function restoreWorkspace() {
    // Only temporary preview meshes are disposed; the native actor project has never been cleared or imported.
    try { disposePreview(); }
    finally { restoreNativeWorkspace(); } // Even a failed preview disposal cannot leave Single/Rig content hidden.
    document.getElementById(TAB_ID)?.setAttribute('aria-selected','false');
  }

  function exit(targetMode = originMode) {
    const normalized = ['multi','single','rig'].includes(targetMode) ? targetMode : originMode;
    if (exitingPromise) {
      pendingExitMode = normalized; // Rapid taps update the destination without starting a second multi-project import.
      return exitingPromise;
    }
    if (!active && !building) return Promise.resolve();
    pendingExitMode = normalized;
    isolationDebug.exits++;
    ++generation;
    active = false;
    building = false;
    if (handScaleTimer && selected?.profile) {
      clearTimeout(handScaleTimer);
      handScaleTimer = 0;
      applyAnatomyConfig(selected.profile); // Flush pending authored hand changes before native workspace restore.
    }
    persistProfiles();
    exitingPromise = (async () => {
      let restoreFailure = null; // A broken actor import must not trap the user inside the comparison tab.
      try {
        try { await restoreWorkspace(); }
        catch (error) {
          restoreFailure = error;
          console.warn('[full-character-scale] could not restore the saved actors before switching tabs', error);
        }
        let applied;
        do {
          applied = pendingExitMode || originMode; // Last tap wins, even if another tab was requested during a slower native handoff.
          await host()?.setMode?.(applied); // ALWAYS include Multi: its native mode can already be Multi while CSS still says scale-compare.
        } while (pendingExitMode !== applied);
        document.getElementById(TAB_ID)?.setAttribute('aria-selected','false');
        if (restoreFailure) {
          const pill = document.getElementById('statusPill'); // Visible in other tabs without mobile devtools.
          if (pill) pill.textContent = 'Tab switched, but the prior animation project could not be restored. The autosave remains available.';
        }
      } finally {
        restoreNativeWorkspace(); // Defensive parity if the preview's own disposal threw.
      }
    })().finally(() => {
      exitingPromise = null;
      pendingExitMode = null;
    });
    return exitingPromise;
  }

  function install() {
    if (!ensureUi()) return false;
    window.HobunjiFullCharacterScaleComparison = Object.freeze({
      enter,
      exit,
      exportJson,
      get active() { return active; },
      get selectedKey() { return selected?.key || null; },
      get selectedPortraitScaleMultiplier() { return selected?.model ? renderedPortraitScaleFor(selected) : null; }, // Canonical rendered-model basis, shared by the Head input guard and presentation.

      get selectedBeltlineGeometry() { return beltlineGeometryFor(selected); }, // Unscaled hip PLUS live sole contact; one math source for editor and gameplay.
      get selectedDimensions() { return selected ? window.HobunjiCharacterRigScale?.heightBeltlineFor?.(window.HobunjiCharacterRigScale?.scaleFor?.(selected.species, selected.gender, selected.profile), beltlineGeometryFor(selected)) : null; },
      get focusKey() { return focusedEntryKey; }, // Independent of selectedKey: choosing a different editor target must never move the camera.
      get previewCount() { return entries.length; },
      get ageMode() { return ageMode; }, // Exposes stage and modifiers to mobile UI diagnostics and the raw-head presentation bridge.
      get ageModifiers() { return clone(ageModifiers); },
      refreshSelectedPreview: () => {
        if (!selected) return;
        ageConvergenceBasis = null; stageBasisCache=null; // Raw PNG head edits also affect estimated crown height.
        applyPreviewProportions(selected);
        if (ageMode !== 'adult' && (ageValues().widthConvergence > 0 || ageValues().heightConvergence > 0)) queueAgeRender('heightConvergence');
        scheduleSelectedLayout(); // One layout per display frame even if numeric body/head inputs fire dozens of events.
      }, // Preserve age scaling during raw-PNG head edits and prevent wider avatars overlapping neighboring lineup slots.
      refreshFromScaleChange, // Input guard maps Height/Beltline to legacy runtime portrait/leg scalars while preserving the raw-PNG Head and independent limb dimensions.
      debugSnapshot: () => ({
        active,
        building,
        isolation: { ...isolationDebug, nativeWorkspaceHidden: !!nativeWorkspaceVisibility }, // Mobile-visible: zero project imports and balanced scene isolation.
        sixFootReference: { visible: !!sixFootGuide?.parent, worldHeight: sixFootHeight, feet: 6, chairReferenceFeet: 3, behindDepth: sixFootGuideDepth, lineupBoundsCached: !!sixFootLineupBounds }, // Persistent mobile diagnostics without console access.
        maoaoRelativeDefaults: window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS?.maoaoScaleParity || null, // Mobile reports exactly how many profiles adopted the 65% raw-head baseline.
        worldHeightCalibration: { ...(window.HobunjiCharacterRigScaleDefaults?.worldHeightCalibration || {}), activeMultiplier: window.HobunjiCharacterRigScale?.worldVisualScale?.() || 1 }, // Compares canonical Mao'ao 6'3" calibration against the actual loaded game/editor transform on mobile.
        pixelCrownCalibration: { measurementStatus: window.HobunjiCharacterDimensions?.status || 'unavailable',
          profiles: window.HobunjiCharacterRigScale?.pixelHeightCalibrationSnapshot?.() || {} }, // Actual PNG top-of-head calibration replaces guessed portrait-canvas height in mobile diagnostics.
        exiting: !!exitingPromise, // Visible mobile diagnostic while an actor import is running.
        requestedTab: pendingExitMode, // Last native mode requested by the user.
        currentTabMode: document.body.dataset.animationAuthorMode,
        lineup: entries.map(entry => entry.key),
        selected: selected?.key || null, // Identifies which progressively loaded species is currently editable.
        headScaleParity: selected ? (() => {
          const portrait = renderedPortraitScaleFor(selected); // Read-only diagnostic: no texture readbacks or scene traversal.
          const runtime = window.HobunjiCharacterRigScale?.scaleFor?.(selected.species, selected.gender, selected.profile)?.head ?? 1;
          return { portraitMultiplier: portrait, runtimeHeadFactor: runtime,
            rawPngHeadPercent: (window.HobunjiCharacterRigScale?.rawPngHeadScaleFor?.(runtime, portrait) ?? runtime * portrait) * 100,
            expectedRuntimeForRaw100: window.HobunjiCharacterRigScale?.runtimeHeadScaleForRaw?.(1, portrait) ?? 1 / portrait,
            worldUniformMultiplier: window.HobunjiCharacterRigScale?.worldVisualScale?.() ?? 1 }; // 100% should cancel portrait scale; global multiplier is common to every character.
        })() : null,
        selection: 'dropdown-only',
        panelVisible: !!document.getElementById(PANEL_ID)?.offsetParent, // Detects a hidden selector on mobile.
        ageMode,
        individualAgeValues: clone(individualAgeValues(selected)), overallScalePreview: ageOverall[ageMode], bakedAgeProfiles: Object.keys(ageProfiles[ageMode]||{}).length,
        globalAgeModifiers: clone(ageValues()), // Confirms the active phase is shared by every lineup avatar.
        selectedAgeAxes: selected ? clone(previewAgeValues(selected)) : null, // Effective selected width/height after convergence.
        ageConvergenceMeasuredProfiles: Object.keys(lineupConvergenceBasis()).length, // Mobile diagnostics: distinguish measured convergence from nominal fallback.
        runtimeAgeConfig: window.HobunjiCharacterAgeRigConfig?.snapshot?.() || null, // Distinguishes local drafts from the explicit game override.
        agePerf: { ...agePerf }, // Counts rig/body recalculations and late GLB probes for phone performance checks.
        view: focusedEntryKey ? 'focused-character' : 'lineup', // Mobile diagnostics report the explicitly chosen camera mode.
        focused: focusedEntryKey, // Identifies the focused portrait even when a different character is selected.
        spinePreviewApplied: selected?.species === 'longoran' ? !!selected.spinePreviewApplied : null,
        facing: { portraitFrontZ: 1, spineForwardSign: 1, reverseFootVisualDepth: false, pants: selected?.feet?.pants?.garmentId || null }, // Lineup matches gameplay orientation: face, toes and hunch all point +Z.
        spineGuide: { enabled: showSpineGuides, available: !!selected?.spineGuide, visible: !!selected?.spineGuide?.group?.visible,
          nodeCount: selected?.model?.userData?.neckRig?.splineNodes?.length || 0,
          restGapSourcePixels: spineGapSourcePixels(selected), // Verify the real sprite-height conversion yields the intended 2.5px connection.
          requestedSpineReach: selected?.model?.userData?.neckRig?.neckReachY ?? null,
          appliedSpineReach: selected?.model?.userData?.neckRig?.neckReachAppliedY ?? null }, // Mobile-readable actual skinning layout without browser DevTools.
        anatomyScales: selected ? { ...window.HobunjiCharacterRigScale?.scaleFor?.(selected.species, selected.gender, selected.profile),
          hand: partScaleFor(selected, 'hand'), foot: partScaleFor(selected, 'foot'),
          restHipY: selected.feet?.restPosteriorY ?? null, liveHipY: selected.feet?.standingPosteriorY ?? null,
          portraitOffsetY: Number(selected.model?.position?.y) - Number(selected.basePortraitY) } : null, // Mobile diagnostics distinguish the four independently authored dimensions without DevTools.
        gait: selected?.species === 'longoran' ? selected.feet?.getStandingPoseDebug?.()?.gait || null : null, // Exposes actual Maskbound gait state in the preview.
        portraitLoading: window.__portraitPixelCacheDebug?.()?.imageLoads || null, // Displays slowest sprite and real request counts without devtools.
        portraitImageCache: window.__portraitPixelCacheDebug?.()?.images || null, // Cache size and evictions distinguish reload churn from network slowness.
        latestChange: 'Dropdown-only adult/baby/toddler/child lineup with short neck, independent leg length and authored pants.',
      }),
    });
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    const ready = !!window.MultiAvatarAnimationAuthor
      && !!host()
      && !!window.HobunjiCharacterRigScale
      && !!window.NpcAvatarPreview
      && !!window.PNGPlaneAvatar
      && !!window.ProceduralLegAnimation
      && !!window.ProceduralHandFrameDriver;
    if ((ready && install()) || ++attempts >= 600) clearInterval(timer);
  }, 50);
  install();
})();
