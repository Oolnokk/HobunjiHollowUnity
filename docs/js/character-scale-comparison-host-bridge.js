// Dedicated host API for the Animation Author's Full Character Scale workspace.
//
// Animation Author itself lives inside an IIFE, so its private actor/profile helpers
// are intentionally invisible to separately loaded scripts. This host therefore uses
// only APIs the author deliberately exposes plus the public backdrop scene. Compatibility
// Window names are supplied only for the existing comparison script and never used as
// inputs by this host, eliminating the old self-recursive bridge failure mode.
(() => {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const publicApi = () => window.MultiAvatarAnimationAuthor || {}; // Used for supported project, mode, actor-add, selection, and rig-profile reads.
  const MODE_TAB_IDS = Object.freeze({ multi: 'maaMultiTab', single: 'maaSingleTab', rig: 'maaRigTab' }); // Used only when restoring a mode the early public setMode API does not understand.
  const RIG_SCALE_STORAGE_KEY = 'hobunjiFullCharacterRigScales.v2'; // Persists whole-character scales independently because the editor's V15.30 anatomy normalizer drops unknown fields. v2 stores {x,y,head} triples instead of v1's single uniform number.
  const LEGACY_SCALE_STORAGE_KEY_V1 = 'hobunjiFullCharacterRigScales.v1'; // Recovers pre-split saves (a single uniform number per species/gender) so upgrading never loses an author's existing tuning.
  const LEGACY_RIG_SAVE_KEY = 'hobunjiAttachmentRigProfiles.v2'; // Recovers scales already autosaved by earlier Full Character Scale builds even though their native Rig export omitted them.
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

  let lastActor = null; // Used by the comparison UI to recover the real actor returned by public add/select operations.
  let comparisonActors = []; // Used for lineup framing and direct tap picking without access to Animation Author's private actor array.
  let pendingClear = Promise.resolve(); // Used so addNpc waits for the public empty-project import even though the legacy caller does not await clearActors().
  let threePromise = null; // Used to share the already-cached Three.js module load with tap picking.
  const rigScaleOverrides = new Map(); // Survives Rig's fixed-field normalizer and is merged back into both shared profiles and every attachment-rig export.
  const repositoryPartScales = new Map(); // Original hand/foot sizes are cached once for Reset; the new sliders cannot erase shipped anatomy.

  function profileKey(species, gender) {
    const normalizedSpecies = canonicalSpecies(species);
    const normalizedGender = normalizeGender(gender);
    return normalizedSpecies && normalizedGender ? `${normalizedSpecies}::${normalizedGender}` : '';
  }

  function profileKeyFromEntry(rawKey, profile = {}) {
    const [rawSpecies, rawGender] = String(rawKey || '').split('::');
    return profileKey(profile.species || rawSpecies, profile.gender || rawGender);
  }

  function normalizedRigScaleNumber(value) {
    if (value == null || value === '') return null; // Missing optional leg/hand/foot fields must not silently become 10% via Number(null).
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0.1, Math.min(4, number)) : null; // Same [10%, 400%] envelope as HobunjiCharacterRigScale; female Longoran's 209.4% height must survive save/reload.
  }

  function normalizedOffsetYNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(-0.5, Math.min(0.5, number)) : null;
  }

  // Accepts either a { x, y, head, offsetY } tuple or a legacy single uniform
  // number (treated as that same value on x/y/head; offsetY defaults to 0,
  // it has no legacy single-field form). Returns a fully-resolved tuple, or
  // null if nothing usable was supplied.
  function normalizedRigScale(value) {
    if (value == null) return null;
    if (typeof value === 'number' || typeof value === 'string') {
      const uniform = normalizedRigScaleNumber(value);
      return uniform == null ? null : { x: uniform, y: uniform, head: uniform, offsetY: 0 };
    }
    const x = normalizedRigScaleNumber(value.x);
    const y = normalizedRigScaleNumber(value.y);
    const head = normalizedRigScaleNumber(value.head);
    const offsetY = normalizedOffsetYNumber(value.offsetY);
    if (x == null && y == null && head == null && offsetY == null) return null;
    const resolved = { x: x ?? y ?? head ?? 1, y: y ?? x ?? head ?? 1, head: head ?? x ?? y ?? 1, offsetY: offsetY ?? 0 };
    const legLength = normalizedRigScaleNumber(value.legLength ?? value.legLengthScale); // Independent reach; omitted by old saves.
    const handScale = normalizedRigScaleNumber(value.handScale); // Existing species/gender hand size field.
    const footScale = normalizedRigScaleNumber(value.footScale); // Existing species/gender foot size field.
    if (legLength != null) resolved.legLength = legLength;
    if (handScale != null) resolved.handScale = handScale;
    if (footScale != null) resolved.footScale = footScale;
    return resolved;
  }

  function anatomyRigScale(anatomy) {
    if (!anatomy) return null;
    const x = normalizedRigScaleNumber(anatomy.rigScaleX);
    const y = normalizedRigScaleNumber(anatomy.rigScaleY);
    const head = normalizedRigScaleNumber(anatomy.headScale);
    const offsetY = normalizedOffsetYNumber(anatomy.headOffsetY);
    const legLength = normalizedRigScaleNumber(anatomy.legLengthScale); // Old rigScaleY controls legs when this field is absent.
    const handScale = normalizedRigScaleNumber(anatomy.handScale);
    const footScale = normalizedRigScaleNumber(anatomy.footScale);
    if (x != null || y != null || head != null || offsetY != null || legLength != null || handScale != null || footScale != null)
      return normalizedRigScale({ x, y, head, offsetY, legLength, handScale, footScale });
    return normalizedRigScale(anatomy.rigScale); // Pre-split single-field profiles.
  }

  function applyRigScaleToSharedProfiles(key, value) {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    for (const [rawKey, profile] of Object.entries(characters)) {
      if (profileKeyFromEntry(rawKey, profile) !== key) continue;
      profile.anatomy ||= {};
      profile.anatomy.rigScaleX = value.x;
      profile.anatomy.rigScaleY = value.y;
      profile.anatomy.headScale = value.head;
      profile.anatomy.headOffsetY = value.offsetY;
      if (value.legLength != null) profile.anatomy.legLengthScale = value.legLength; // Explicit independent leg reach.
      else delete profile.anatomy.legLengthScale; // Importing an old Height tuple must restore its original shared portrait/leg proportion, never retain stale newer authoring.
      if (value.handScale != null) profile.anatomy.handScale = value.handScale;
      if (value.footScale != null) profile.anatomy.footScale = value.footScale;
    }
  }

  function persistRigScaleOverrides() {
    try {
      localStorage.setItem(RIG_SCALE_STORAGE_KEY, JSON.stringify(Object.fromEntries(rigScaleOverrides)));
    } catch (_) {}
  }

  function setRigScale(species, gender, value, { persist = true } = {}) {
    const key = profileKey(species, gender);
    const scale = normalizedRigScale(value);
    if (!key || scale == null) return null;
    rigScaleOverrides.set(key, scale);
    applyRigScaleToSharedProfiles(key, scale);
    if (persist) persistRigScaleOverrides();
    return scale;
  }

  function rigScaleFor(species, gender, fallback = 1) {
    const key = profileKey(species, gender);
    if (key && rigScaleOverrides.has(key)) return rigScaleOverrides.get(key);
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    for (const [rawKey, profile] of Object.entries(characters)) {
      if (profileKeyFromEntry(rawKey, profile) !== key) continue;
      const scale = anatomyRigScale(profile?.anatomy);
      if (scale != null) return scale;
    }
    return normalizedRigScale(fallback) ?? { x: 1, y: 1, head: 1, offsetY: 0 };
  }

  function captureSharedRigScales({ persist = true } = {}) {
    let changed = false;
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    for (const [rawKey, profile] of Object.entries(characters)) {
      const key = profileKeyFromEntry(rawKey, profile);
      const scale = anatomyRigScale(profile?.anatomy);
      if (!key || scale == null) continue;
      const existing = rigScaleOverrides.get(key);
      if (!existing || existing.x !== scale.x || existing.y !== scale.y || existing.head !== scale.head || existing.offsetY !== scale.offsetY
          || existing.legLength !== scale.legLength || existing.handScale !== scale.handScale || existing.footScale !== scale.footScale) {
        rigScaleOverrides.set(key, scale);
        changed = true;
      }
    }
    if (changed && persist) persistRigScaleOverrides();
    return changed;
  }

  // Discards every local override (in-memory, both persistence keys) and deletes the
  // authored fields from every live shared profile so scaleFor()'s normal fallback
  // chain resolves straight through to the repository's own authored defaults
  // (character-rig-scale-defaults.js) — not a frozen snapshot of them, so a later
  // change to that file is picked up without needing another reset. Also clears
  // every per-NPC age override, since "reset everything" should mean everything.
  function rememberRepositoryPartScales() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Canonical source snapshot retained without deep-cloning meshes or textures.
    for (const [key, profile] of Object.entries(characters)) {
      if (repositoryPartScales.has(key)) continue;
      const anatomy = profile?.anatomy || {};
      repositoryPartScales.set(key, { handScale: anatomy.handScale, footScale: anatomy.footScale });
    }
  }

  function resetToRepositoryDefaults() {
    rememberRepositoryPartScales(); // Reset uses the initial canonical species/gender extremity proportions.
    rigScaleOverrides.clear();
    try { localStorage.removeItem(RIG_SCALE_STORAGE_KEY); } catch (_) {}
    try { localStorage.removeItem(LEGACY_SCALE_STORAGE_KEY_V1); } catch (_) {}
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    let reset = 0;
    for (const [rawKey, profile] of Object.entries(characters)) {
      if (!profile?.anatomy) continue;
      const original = repositoryPartScales.get(rawKey); // Restore exactly the authored hand/foot sizes rather than resetting every species to 100%.
      if (original) for (const part of ['handScale', 'footScale']) {
        if (original[part] == null) delete profile.anatomy[part];
        else profile.anatomy[part] = original[part];
      }
      delete profile.anatomy.legLengthScale; // With no independent reach, the original Height default again controls both regions.
      delete profile.anatomy.rigScaleX;
      delete profile.anatomy.rigScaleY;
      delete profile.anatomy.headScale;
      delete profile.anatomy.headOffsetY;
      delete profile.anatomy.rigScale; // Pre-split legacy field — also cleared so it can't resurrect an old override.
      reset += 1;
    }
    window.HobunjiCharacterRigScale?.installProfileDefaults?.(); // Re-derives x/y/head/offsetY immediately instead of waiting for the next bootstrap poll tick.
    resetNpcAges();
    return reset;
  }

  // Per-NPC age (0-1, "how hunched") is instance data, not species/gender-authored
  // data — it never lives in HOBUNJI_ATTACHMENT_RIG_PROFILES or the attachment-rig
  // export, only in its own storage key, kept simple/separate from the rigScale
  // round-trip machinery above.
  const NPC_AGE_STORAGE_KEY = 'hobunjiFullCharacterNpcAges.v1';
  const npcAgeOverrides = new Map();

  function normalizedAge(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
  }

  function persistNpcAgeOverrides() {
    try {
      localStorage.setItem(NPC_AGE_STORAGE_KEY, JSON.stringify(Object.fromEntries(npcAgeOverrides)));
    } catch (_) {}
  }

  function setNpcAge(npcId, age) {
    const id = String(npcId || '');
    const value = normalizedAge(age);
    if (!id || value == null) return null;
    npcAgeOverrides.set(id, value); // Zero explicitly straightens an NPC whose authored base pose is hunched.
    persistNpcAgeOverrides();
    return value;
  }

  function npcAgeFor(npcId, fallback = 0) {
    return npcAgeOverrides.get(String(npcId || '')) ?? fallback;
  }

  function resetNpcAges() {
    npcAgeOverrides.clear();
    try { localStorage.removeItem(NPC_AGE_STORAGE_KEY); } catch (_) {}
  }

  function restorePersistedNpcAges() {
    try {
      const parsed = JSON.parse(localStorage.getItem(NPC_AGE_STORAGE_KEY) || '{}');
      for (const [id, value] of Object.entries(parsed || {})) setNpcAge(id, value);
    } catch (_) {}
  }

  function migratePreviousLongoranDefaults(key, value) {
    // The only old saved profiles eligible for automatic migration: exact earlier
    // *shipped defaults* (which captureSharedRigScales snapshots into storage),
    // never an author's custom shape. v22/v24 entries let the Nov 22 Longoran /
    // Tletingan / Nuhongan proportion pass reach browsers that already opened the editor.
    const previous = {
      'longoran::male': [{ x: 1.0625, y: 1.275, head: 0.8, offsetY: 0 }, { x: 1.05, y: 2, head: 0.9647, offsetY: -0.055 }, { x: 1.15, y: 1.4, head: 1.1, offsetY: -0.055 }],
      'longoran::female': [{ x: 1.14375, y: 1.335, head: 0.8823529411764706, offsetY: 0 },
        { x: 1.130294117647059, y: 2.0941176470588236, head: 1.0640073529411764, offsetY: -0.055 }, { x: 1.1, y: 2.25, head: 1.05, offsetY: -0.055 }],
      'tletingan::male': [{ x: 0.85, y: 0.85, head: 0.8, offsetY: 0 }, { x: 0.9, y: 1.2, head: 0.85, offsetY: 0 }, { x: 0.675, y: 0.9, head: 0.638, offsetY: 0 }],
      'tletingan::female': [{ x: 0.915, y: 0.89, head: 0.8823529411764706, offsetY: 0 }, { x: 0.9, y: 1.15, head: 0.85, offsetY: 0 }, { x: 0.771, y: 0.986, head: 0.728, offsetY: 0 }],
      'nuhongan::male': [{ x: 0.68, y: 0.6375, head: 0.8, offsetY: 0 }, { x: 0.78, y: 0.7, head: 0.8, offsetY: 0 }, { x: 0.654, y: 0.587, head: 0.671, offsetY: 0 }],
      'nuhongan::female': [{ x: 0.732, y: 0.6675, head: 0.8823529411764706, offsetY: 0 }, { x: 0.8, y: 0.7, head: 0.85, offsetY: 0 }, { x: 0.71, y: 0.622, head: 0.755, offsetY: 0 }],
      'kenkari::male': [{ x: 1.225, y: 1.225, head: 1, offsetY: 0 }],
      'kenkari::female': [{ x: 1.1, y: 1.1, head: 1, offsetY: 0 }],
    }[key];
    const scale = normalizedRigScale(value); // Current fields are normalized once before comparing with the old shipped defaults.
    const matches = candidate => Object.keys(candidate).every(field => Math.abs(scale[field] - candidate[field]) <= 0.000051);
    if (!previous || !scale || !previous.some(matches)) {
      return { value, upgraded: false }; // Preserve genuinely edited values, including the uploaded custom male Longoran.
    }
    const [species, gender] = key.split('::');
    const next = window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(species, gender);
    if (!next) return { value, upgraded: false };
    const hand = normalizedRigScaleNumber(value?.handScale), foot = normalizedRigScaleNumber(value?.footScale);
    return { value: { ...next, ...(hand != null ? { handScale: hand } : {}), ...(foot != null ? { footScale: foot } : {}) }, upgraded: true }; // Keep separately authored hand/foot sizes.
  }

  function restorePersistedRigScales() {
    let recoveredLegacy = 0;
    let migratedLongoran = false; // Persists migrated earlier *default* saves so they do not mask the newly shipped female Longoran height.
    try {
      const parsed = JSON.parse(localStorage.getItem(RIG_SCALE_STORAGE_KEY) || '{}');
      for (const [key, value] of Object.entries(parsed || {})) {
        const [species, gender] = key.split('::');
        const migrated = migratePreviousLongoranDefaults(key, value); // Do not overwrite custom values; only old shipped Longoran defaults migrate.
        migratedLongoran ||= migrated.upgraded;
        setRigScale(species, gender, migrated.value, { persist: false });
      }
    } catch (_) {}
    // Pre-split saves stored a single uniform number per species/gender — normalizedRigScale
    // mirrors it onto x/y/head so an author's existing tuning survives the upgrade untouched.
    if (!rigScaleOverrides.size) {
      try {
        const parsedLegacy = JSON.parse(localStorage.getItem(LEGACY_SCALE_STORAGE_KEY_V1) || '{}');
        for (const [key, value] of Object.entries(parsedLegacy || {})) {
          const [species, gender] = key.split('::');
          const migrated = migratePreviousLongoranDefaults(key, value); // Handles old single-axis saved scales without changing unrelated species.
          migratedLongoran ||= migrated.upgraded;
          if (setRigScale(species, gender, migrated.value, { persist: false }) != null) recoveredLegacy += 1;
        }
      } catch (_) {}
    }
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_RIG_SAVE_KEY) || 'null');
      for (const [key, scale] of importedRigScaleEntries(legacy)) {
        if (rigScaleOverrides.has(key)) continue;
        const [species, gender] = key.split('::');
        const migrated = migratePreviousLongoranDefaults(key, scale); // Recover canonical values from earlier attachment-rig saves too.
        migratedLongoran ||= migrated.upgraded;
        if (setRigScale(species, gender, migrated.value, { persist: false }) != null) recoveredLegacy += 1;
      }
    } catch (_) {}
    if (recoveredLegacy || migratedLongoran) persistRigScaleOverrides();
    return recoveredLegacy;
  }

  function importedRigScaleEntries(data) {
    const profiles = data?.profiles || data?.attachmentRigProfiles || data || {};
    const characters = profiles?.characters || {};
    const entries = [];
    for (const [rawKey, profile] of Object.entries(characters)) {
      const key = profileKeyFromEntry(rawKey, profile);
      const scale = anatomyRigScale(profile?.anatomy);
      if (key && scale != null) entries.push([key, scale]);
    }
    return entries;
  }

  function applyImportedRigScaleEntries(entries) {
    if (!entries?.length) return 0;
    for (const [key, scale] of entries) {
      const [species, gender] = key.split('::');
      setRigScale(species, gender, scale, { persist: false });
    }
    persistRigScaleOverrides();
    return entries.length;
  }

  function mergeRigScalesIntoProfiles(sourceProfiles) {
    captureSharedRigScales({ persist: false });
    const profiles = JSON.parse(JSON.stringify(sourceProfiles || { characters: {}, creatures: {} }));
    profiles.characters ||= {};
    profiles.creatures ||= {};
    for (const [rawKey, profile] of Object.entries(profiles.characters)) {
      const key = profileKeyFromEntry(rawKey, profile);
      const [species, gender] = key.split('::');
      const scale = rigScaleFor(species, gender, anatomyRigScale(profile?.anatomy) ?? 1);
      profile.anatomy ||= {};
      profile.anatomy.rigScaleX = scale.x;
      profile.anatomy.rigScaleY = scale.y;
      profile.anatomy.headScale = scale.head;
      profile.anatomy.headOffsetY = scale.offsetY;
      if (scale.legLength != null) profile.anatomy.legLengthScale = scale.legLength;
      else delete profile.anatomy.legLengthScale; // Legacy rig imports do not preserve a previously authored independent limb length.
      if (scale.handScale != null) profile.anatomy.handScale = scale.handScale;
      if (scale.footScale != null) profile.anatomy.footScale = scale.footScale;
      delete profile.anatomy.rigScale; // Superseded by the x/y/head split; dropped so a re-export never resurrects the ambiguous uniform field.
    }
    return profiles;
  }

  function patchAttachmentRigExportObject(data) {
    if (!data || data.schema !== 'hobunji.attachment-rig-profiles.v10') return data;
    data.profiles = mergeRigScalesIntoProfiles(data.profiles || data.attachmentRigProfiles || {});
    data.anatomySemantics ||= {};
    data.anatomySemantics.rigScale = 'Full Character Scale authors per-species/gender width rigScaleX and portrait height rigScaleY (the legacy Y field). legLengthScale controls independent hip-to-foot reach, while handScale and footScale control procedural extremity sizes. Missing legLengthScale inherits the old Y scale for backward compatibility. headScale is independently compensated at the neck, and headOffsetY composes with the instance-only age hunch. The floor-relative root retains the original axis/coordinate conventions.';
    data.fullCharacterScaleRoundTripVersion = 4; // Includes independent leg/portrait height and both existing extremity multipliers.
    return data;
  }

  function installRigExportBlobPatch() {
    const NativeBlob = window.Blob; // Native constructor retained so non-rig downloads remain byte-for-byte unchanged.
    if (!NativeBlob || NativeBlob.__hobunjiRigScaleExportWrapped) return false;
    function RigScaleAwareBlob(parts = [], options = {}) {
      let nextParts = parts;
      const type = String(options?.type || '').toLowerCase();
      if (type.includes('json') && parts.length === 1 && typeof parts[0] === 'string'
          && parts[0].includes('hobunji.attachment-rig-profiles.v10')) {
        try {
          const parsed = JSON.parse(parts[0]);
          if (parsed?.schema === 'hobunji.attachment-rig-profiles.v10') {
            const patched = patchAttachmentRigExportObject(parsed);
            const pretty = /\n\s{2}"/.test(parts[0]);
            nextParts = [JSON.stringify(patched, null, pretty ? 2 : 0) + (/\n$/.test(parts[0]) ? '\n' : '')];
          }
        } catch (_) {}
      }
      return new NativeBlob(nextParts, options);
    }
    RigScaleAwareBlob.prototype = NativeBlob.prototype;
    try { Object.setPrototypeOf(RigScaleAwareBlob, NativeBlob); } catch (_) {}
    RigScaleAwareBlob.__hobunjiRigScaleExportWrapped = true;
    RigScaleAwareBlob.__hobunjiNativeBlob = NativeBlob;
    window.Blob = RigScaleAwareBlob;
    return true;
  }

  rememberRepositoryPartScales(); // Before recovery/import modifies the live rig's hand/foot scale settings.

  function installRigScaleRoundTripHooks() {
    if (document.documentElement.dataset.fullScaleRoundTripHooks === '1') return;
    document.documentElement.dataset.fullScaleRoundTripHooks = '1';

    const FULL_SCALE_RANGE_IDS = new Set(['maaFullScaleRangeX', 'maaFullScaleRangePortraitHeight', 'maaFullScaleRangeLegLength',
      'maaFullScaleRangeHand', 'maaFullScaleRangeFoot', 'maaFullScaleRangeHead']);
    // The comparison sliders update the shared profile in their own target listener.
    // Capture it afterward at document bubble phase so the value is durable across reloads.
    document.addEventListener('input', event => {
      if (!FULL_SCALE_RANGE_IDS.has(event.target?.id)) return;
      queueMicrotask(() => captureSharedRigScales());
    });
    document.addEventListener('change', event => {
      if (FULL_SCALE_RANGE_IDS.has(event.target?.id)) {
        queueMicrotask(() => captureSharedRigScales());
        return;
      }
      if (event.target?.id !== 'maaImportInput') return;
      const file = event.target.files?.[0]; // Reads the exact Rig JSON selected by the existing native importer without replacing that importer.
      if (!file || typeof file.text !== 'function') return;
      file.text().then(text => {
        const data = JSON.parse(text);
        const entries = importedRigScaleEntries(data);
        if (!entries.length) return;
        applyImportedRigScaleEntries(entries);
        // Native Rig import rebuilds its private profile copy asynchronously and drops
        // unknown anatomy fields. Reassert the shared scale after that work finishes.
        setTimeout(() => applyImportedRigScaleEntries(entries), 0);
        setTimeout(() => applyImportedRigScaleEntries(entries), 120);
        const status = document.getElementById('statusPill');
        if (status) {
          status.textContent = `Imported ${entries.length} full-character scale${entries.length === 1 ? '' : 's'}`;
          status.className = 'pill good';
        }
      }).catch(error => console.warn('[full-character-scale] rigScale import recovery failed', error));
    }, true);
  }

  function profileForActorFallback(actor) {
    if (!actor) return null;
    const source = actor.source || {};
    const species = canonicalSpecies(source.species || source.appearance?.speciesId || source.appearance?.species);
    const gender = normalizeGender(source.gender || source.appearance?.gender);
    const profile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${species}::${gender}`] || null;
    if (profile) {
      profile.anatomy ||= {};
      const scale = rigScaleFor(species, gender, anatomyRigScale(profile.anatomy) ?? 1);
      profile.anatomy.rigScaleX = scale.x;
      profile.anatomy.rigScaleY = scale.y;
      profile.anatomy.headScale = scale.head;
      if (scale.legLength != null) profile.anatomy.legLengthScale = scale.legLength;
      else delete profile.anatomy.legLengthScale; // Legacy rig imports do not preserve a previously authored independent limb length.
      if (scale.handScale != null) profile.anatomy.handScale = scale.handScale;
      if (scale.footScale != null) profile.anatomy.footScale = scale.footScale;
    }
    return profile;
  }

  function loadThree() {
    if (!threePromise) {
      threePromise = Promise.resolve(window.PNGPlaneAvatar?.loadThreeModules?.())
        .then(modules => modules?.THREE || null)
        .catch(() => null);
    }
    return threePromise;
  }

  async function setMode(mode) {
    const normalizedMode = String(mode || 'multi'); // Multi, Single and Rig all share one native mode switch.
    if (!MODE_TAB_IDS[normalizedMode]) throw new Error(`Unknown Animation Author mode “${normalizedMode}”.`);
    const api = publicApi();
    if (typeof api.setMode !== 'function') throw new Error(`Animation Author mode “${normalizedMode}” is unavailable.`);
    // Its public method is now a late-bound wrapper, so Rig uses the real final handler without a synthetic tab click.
    // Also refresh chrome for Multi->Scale->Multi: the underlying mode was already Multi, so setMode itself is a no-op.
    await api.setMode(normalizedMode);
    api.refreshModeChrome?.();
  }

  async function addNpc(id, options) {
    await pendingClear;
    const api = publicApi(); // addNpc is a supported public function and returns the real actor object created inside the author's private scope.
    if (typeof api.addNpc !== 'function') throw new Error('Animation Author NPC preview API is unavailable.');
    const actor = await api.addNpc(id, options);
    if (!actor) throw new Error(`Animation Author did not return the actor for ${id}.`);
    lastActor = actor;
    if (!comparisonActors.some(candidate => candidate?.id === actor.id)) comparisonActors.push(actor);
    return actor;
  }

  function selectedActor() {
    return lastActor;
  }

  function selectActor(id) {
    const api = publicApi(); // Used to let the editor update its own selection box/gizmo while this host tracks the same selected actor.
    if (typeof api.selectActor !== 'function') throw new Error('Animation Author selection API is unavailable.');
    const result = api.selectActor(id);
    lastActor = comparisonActors.find(actor => actor?.id === id) || lastActor;
    return result;
  }

  function profileForActor(actor) {
    // Full Character Scale intentionally edits the canonical shared character profile.
    // The external comparison cannot access Animation Author's private per-session copy.
    return profileForActorFallback(actor);
  }

  function emptyProjectSnapshot() {
    const api = publicApi(); // Used to ask Animation Author to clear itself through its own import path instead of reaching into private state.
    const current = typeof api.exportProject === 'function' ? api.exportProject() : null;
    if (!current || !Array.isArray(current.actors)) return null;
    const empty = JSON.parse(JSON.stringify(current));
    empty.actors = [];
    if (empty.project) empty.project.name = 'Full Character Scale Scratch';
    return empty;
  }

  function clearActors() {
    comparisonActors = [];
    lastActor = null;
    // During restore, the comparison immediately imports its saved multi project;
    // that import already clears the temporary lineup internally. Starting a second
    // empty import here would race it, so the restore-side clear is deliberately a no-op.
    if (document.body.dataset.animationAuthorMode === 'scale-compare') {
      pendingClear = Promise.resolve();
      return pendingClear;
    }
    const api = publicApi(); // Used for a non-destructive scene clear via the author's own validated project importer.
    const empty = emptyProjectSnapshot();
    if (!empty || typeof api.importProject !== 'function') {
      pendingClear = Promise.reject(new Error('Animation Author project clear API is unavailable.'));
      pendingClear.catch(() => {});
      return pendingClear;
    }
    pendingClear = Promise.resolve(api.importProject(empty)).then(() => undefined);
    return pendingClear;
  }

  function serializeRig() {
    const privateProfiles = publicApi().getAttachmentRigProfiles?.(); // Preserves every native Rig edit; only rigScale is overlaid from the external Full Character Scale source.
    const profiles = mergeRigScalesIntoProfiles(privateProfiles || window.HOBUNJI_ATTACHMENT_RIG_PROFILES || {});
    return {
      schema: 'hobunji.attachment-rig-profiles.v10',
      exportedAt: new Date().toISOString(),
      profiles,
      anatomySemantics: {
        rigScale: 'Whole-character species/gender x/y scale (rigScaleX, rigScaleY) plus a separate, neck-rig-compensated headScale and headOffsetY, authored in Full Character Scale.',
      },
      fullCharacterScaleRoundTripVersion: 3,
      exportSource: privateProfiles ? 'animation-author-public-rig-profiles+full-character-scale' : 'full-character-scale-shared-profiles',
    };
  }

  function objectBounds(root) {
    if (!root?.traverse) return null;
    root.updateMatrixWorld?.(true);
    let bounds = null; // Accumulates world-space geometry bounds using each mesh's own Three.js Box3 implementation.
    root.traverse(node => {
      const geometry = node?.geometry;
      if (!geometry || !node.matrixWorld) return;
      geometry.computeBoundingBox?.();
      const box = geometry.boundingBox?.clone?.();
      if (!box?.applyMatrix4) return;
      box.applyMatrix4(node.matrixWorld);
      bounds = bounds ? bounds.union(box) : box;
    });
    return bounds;
  }

  function frameAll(view = 'front') {
    const backdrop = window.HobunjiGameplayBackdrop; // Public backdrop access supplies the real renderer camera without touching Animation Author's private state.
    const camera = backdrop?.getCamera?.();
    const scene = backdrop?.getScene?.();
    if (!camera || !scene) return undefined;
    let bounds = null; // Accumulates only the temporary lineup plus its fixed-size chair reference.
    for (const actor of comparisonActors) {
      const box = objectBounds(actor?.visualOffset || actor?.model || actor?.root);
      if (box) bounds = bounds ? bounds.union(box) : box;
    }
    const chair = scene.getObjectByName?.('FullScaleReference_chairSimple');
    const chairBounds = objectBounds(chair);
    if (chairBounds) bounds = bounds ? bounds.union(chairBounds) : chairBounds;
    if (!bounds || bounds.isEmpty?.()) return backdrop.setCameraView?.(view === 'front' ? 'front' : 'angle');

    const center = bounds.getCenter(bounds.min.clone()); // Reuses a real Three.js Vector3 supplied by the Box3 instead of importing private editor modules.
    const size = bounds.getSize(bounds.max.clone());
    const canvas = document.getElementById('view3d');
    const aspect = Math.max(0.1, Number(camera.aspect) || ((canvas?.clientWidth || 1) / Math.max(1, canvas?.clientHeight || 1)));
    const verticalFov = Math.max(0.1, Number(camera.fov) || 50) * Math.PI / 180;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const byWidth = (size.x / 2 + 0.35) / Math.max(0.01, Math.tan(horizontalFov / 2));
    const byHeight = (size.y / 2 + 0.3) / Math.max(0.01, Math.tan(verticalFov / 2));
    const distance = Math.max(1.6, byWidth, byHeight) * 1.12 + size.z / 2;
    const targetY = Math.max(center.y, size.y * 0.42);
    camera.position.set(center.x, targetY + Math.min(0.2, size.y * 0.08), center.z + distance);
    camera.lookAt(center.x, targetY, center.z);
    camera.updateMatrixWorld?.(true);
    return undefined;
  }

  function strictAppearance() {
    return null; // The comparison script already has a complete NPC appearance fallback when the private V15.14 helper is unavailable.
  }

  function diagnostics() {
    const api = publicApi(); // Returned through the mobile-accessible rig diagnostics status object when an open fails.
    return {
      publicApi: !!window.MultiAvatarAnimationAuthor,
      addNpcReturnsActor: typeof api.addNpc === 'function',
      importProjectClear: typeof api.importProject === 'function' && typeof api.exportProject === 'function',
      nativeRigProfilesReadable: typeof api.getAttachmentRigProfiles === 'function',
      rigScaleRoundTripOverrides: rigScaleOverrides.size,
      npcAgeOverrides: npcAgeOverrides.size,
      rigScaleExportBlobPatch: !!window.Blob?.__hobunjiRigScaleExportWrapped,
      selectActor: typeof api.selectActor === 'function',
      sharedProfiles: !!window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters,
      backdropScene: !!window.HobunjiGameplayBackdrop?.getScene?.(),
      comparisonActors: comparisonActors.length,
    };
  }

  // Viewport click-to-select was retired: Full Character Scale selection is dropdown-only.
  // Do not install asynchronous pointer raycasts, which also outlive editor mode transitions.

  const host = Object.freeze({ // Used exclusively by Full Character Scale and its compatibility shims below.
    setMode,
    addNpc,
    selectedActor,
    profileForActor,
    clearActors,
    selectActor,
    serializeRig,
    setRigScale,
    rigScaleFor,
    captureSharedRigScales,
    resetToRepositoryDefaults,
    setNpcAge,
    npcAgeFor,
    frameAll,
    strictAppearance,
    diagnostics,
  });
  window.HobunjiAnimationAuthorScaleHost = host;
  window.HobunjiAnimationAuthorHost = host;

  // Existing comparison revisions call these names. Animation Author's real helpers
  // are private IIFE bindings, so these Window slots are extension shims rather than
  // replacements. The host above never reads them, preventing wrapper self-recursion.
  const compatibility = { // Used only until character-scale-comparison.js is migrated to call the dedicated host object directly.
    setAnimationAuthorMode: host.setMode,
    addNpcAnimationActor: host.addNpc,
    selectedAnimationActor: host.selectedActor,
    attachmentRigProfileForActor: host.profileForActor,
    clearAnimationActors: host.clearActors,
    selectAnimationActor: host.selectActor,
    serializeAttachmentRigLibrary: host.serializeRig,
    frameAllAnimationActors: host.frameAll,
    strictNpcAppearanceV1514: host.strictAppearance,
  };
  for (const [name, fn] of Object.entries(compatibility)) {
    if (typeof window[name] !== 'function') window[name] = fn;
  }

  restorePersistedRigScales();
  restorePersistedNpcAges();
  installRigExportBlobPatch();
  installRigScaleRoundTripHooks();

  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.fullCharacterScaleHostBridge = {
    installed: true,
    dedicatedHostApi: true,
    editorGlobalsOverridden: false,
    extensionCompatibilityShims: true,
    privateEditorStateRequired: false,
    destructiveDomFallbacks: false,
    rigScaleRoundTrip: true,
    rigScaleStorageKey: RIG_SCALE_STORAGE_KEY,
    legacyRigScaleRecoveryKey: LEGACY_RIG_SAVE_KEY,
    nativeRigExportBlobPatched: !!window.Blob?.__hobunjiRigScaleExportWrapped,
  };

})();