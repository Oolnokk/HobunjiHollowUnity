// Manual shoulder targets used by the direct 3D hand compass.
//
// Coordinates are in the canonical 200x200 front-portrait pixel space used by
// Animation Author. A side whose X and Y are both zero is intentionally UNAUTHORED
// and falls back to the raw-arm main-mass detector in portrait-hand-shoulder-scan.js.
// This keeps every existing species on automatic detection until an artist places
// the point manually in Animation Author's Attachment Rig Coordinates mode.
(function (global) {
  'use strict';

  const DEFAULT_POINT = Object.freeze({ x: 0, y: 0 });
  const DEFAULT_KEYS = Object.freeze([
    'mao-ao::male', 'mao-ao::female',
    'engh-sho::male', 'engh-sho::female',
    'tletingan::male', 'tletingan::female',
    'mashtzarr::male', 'mashtzarr::female',
    'kenkari::male', 'kenkari::female',
  ]);

  const STORAGE_KEY = 'hobunji.handShoulderPoints.v1';
  const source = {
    schema: 'hobunji_hand_shoulder_points.v1',
    coordinateSpace: 'portrait-200px',
    characters: Object.fromEntries(DEFAULT_KEYS.map(key => [key, {
      left: { ...DEFAULT_POINT },
      right: { ...DEFAULT_POINT },
    }])),
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const normalizeKey = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const normalizeGender = value => String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male';
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const transformSpeciesId = value => {
    const species = normalizeKey(value);
    if (typeof global.hobunjiTransformSpeciesId === 'function') return global.hobunjiTransformSpeciesId(species);
    if (species === 'rakakoan') return 'kenkari';
    if (species === 'ghoul') return 'mao-ao';
    return species;
  }; // Alias species always target the canonical species/gender transform record.

  function normalizePoint(raw) {
    return { x: number(raw?.x), y: number(raw?.y) };
  }

  function normalizeData(raw) {
    const next = clone(source);
    if (raw?.characters && typeof raw.characters === 'object') {
      for (const [key, entry] of Object.entries(raw.characters)) {
        const rawSpecies = normalizeKey(key.split('::')[0]);
        const canonicalSpecies = transformSpeciesId(rawSpecies);
        if (canonicalSpecies !== rawSpecies) continue; // Ignore stale independently-authored aliases instead of overwriting canonical transforms.
        const normalized = canonicalSpecies + '::' + normalizeGender(key.split('::')[1]);
        next.characters[normalized] = {
          left: normalizePoint(entry?.left),
          right: normalizePoint(entry?.right),
        };
      }
    }
    return next;
  }

  let data = normalizeData(source);
  const listeners = new Set();

  function keyFor(speciesId, gender) {
    return `${transformSpeciesId(speciesId)}::${normalizeGender(gender)}`;
  }

  function pointsFor(speciesId, gender) {
    const key = keyFor(speciesId, gender);
    const entry = data.characters[key] || { left: DEFAULT_POINT, right: DEFAULT_POINT };
    return { left: normalizePoint(entry.left), right: normalizePoint(entry.right) };
  }

  function pointFor(speciesId, gender, side) {
    const entry = pointsFor(speciesId, gender);
    return normalizePoint(side === 'left' ? entry.left : entry.right);
  }

  function isAuthored(point) {
    const p = normalizePoint(point);
    return Math.abs(p.x) > 1e-9 || Math.abs(p.y) > 1e-9;
  }

  function notify() {
    global.HOBUNJI_HAND_SHOULDER_POINTS = data;
    for (const listener of listeners) {
      try { listener(data); } catch (_) {}
    }
  }

  function replace(raw) {
    data = normalizeData(raw);
    notify();
    return data;
  }

  function setPoint(speciesId, gender, side, point) {
    const key = keyFor(speciesId, gender);
    if (!data.characters[key]) data.characters[key] = { left: { ...DEFAULT_POINT }, right: { ...DEFAULT_POINT } };
    data.characters[key][side === 'left' ? 'left' : 'right'] = normalizePoint(point);
    notify();
    return pointFor(speciesId, gender, side);
  }

  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
    catch (_) { return false; }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      replace(JSON.parse(raw));
      return true;
    } catch (_) { return false; }
  }

  function clearLocal() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    replace(source);
  }

  global.HOBUNJI_HAND_SHOULDER_POINTS = data;
  global.HobunjiHandShoulderPoints = {
    schema: source.schema,
    coordinateSpace: source.coordinateSpace,
    transformSpeciesAliases: Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao' }),
    get data() { return data; },
    get defaultData() { return normalizeData(source); },
    keyFor,
    pointsFor,
    pointFor,
    isAuthored,
    setPoint,
    replace,
    saveLocal,
    loadLocal,
    clearLocal,
    serialize: () => JSON.stringify(data, null, 2),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };

  // Animation Author and the game share origin, so a point placed in the author
  // can be tested immediately in the preview/game without manually re-importing it.
  loadLocal();

  // ---------------------------------------------------------------------------
  // Attachment-rig shoulder recovery (2026-09-03)
  // ---------------------------------------------------------------------------
  // The v1 forensic master made one incorrect assumption: it treated the exact
  // v9 hand-shoulder tuples as pre-calibration leftovers and replaced them with
  // the older V15.28 values multiplied by 0.9. The v9 export was actually made
  // on 2026-08-26, several days AFTER V15.36 changed the author to a 0.9-wide
  // gameplay avatar, and it marks all supplied character shoulders as
  // `rig-anchor-gizmo`. Therefore those v9 tuples are the later authored state.
  // Restore them by undoing only the v1 master's extra 0.9 reduction. This is
  // intentionally scoped to that exact master version so future masters cannot
  // be transformed twice.
  const BAD_MASTER_VERSION = 'hobunji-attachment-rig-master-2026-09-03-v1';
  const V15_28_TO_GAME_SCALE = 0.9;
  const V9_EXPORTED_AT = '2026-08-26T03:30:34.506Z';
  const CHARACTER_ALIAS_SOURCES = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao' });
  const CHARACTER_ANCHORS_TO_RECOVER = Object.freeze(['leftHandShoulder', 'rightHandShoulder']);

  function validPosition(position) {
    return ['x', 'y', 'z'].every(axis => Number.isFinite(Number(position?.[axis])));
  }

  function validAnchor(anchor) {
    return validPosition(anchor?.position)
      && ['x', 'y', 'z'].some(axis => Math.abs(Number(anchor.position[axis])) > 1e-12);
  }

  function cloneAnchor(anchor) {
    return clone(anchor);
  }

  function canonicalCharacterKeys(characters) {
    return Object.keys(characters || {}).filter(key => {
      const species = normalizeKey(key.split('::')[0]);
      return !Object.prototype.hasOwnProperty.call(CHARACTER_ALIAS_SOURCES, species);
    });
  }

  function recoverPostCalibrationV9Shoulders(library) {
    if (global.HOBUNJI_ATTACHMENT_RIG_MASTER?.version !== BAD_MASTER_VERSION || !library?.characters) return 0;
    let recovered = 0;
    for (const key of canonicalCharacterKeys(library.characters)) {
      const profile = library.characters[key];
      if (!profile?.anchors) continue;
      const rule = profile.handShoulderRule || {};
      const v1Fingerprint = Number(rule.positionScaleApplied) === V15_28_TO_GAME_SCALE
        || /pre-v9/i.test(String(rule.source || ''));
      if (!v1Fingerprint || rule.v9PostCalibrationRecovered) continue;
      for (const anchorName of CHARACTER_ANCHORS_TO_RECOVER) {
        const anchor = profile.anchors[anchorName];
        if (!validAnchor(anchor)) continue;
        for (const axis of ['x', 'y', 'z']) anchor.position[axis] = Number(anchor.position[axis]) / V15_28_TO_GAME_SCALE;
        recovered++;
      }
      profile.handShoulderRule = {
        ...rule,
        source: 'rig-anchor-gizmo-v9-exact-supplied',
        coordinateSpace: 'character-visual-local',
        version: Math.max(4, Number(rule.version) || 0),
        v9PostCalibrationRecovered: true,
        v9ExportedAt: V9_EXPORTED_AT,
        erroneousExtraScaleRemoved: V15_28_TO_GAME_SCALE,
      };
    }
    for (const [aliasSpecies, sourceSpecies] of Object.entries(CHARACTER_ALIAS_SOURCES)) {
      for (const gender of ['male', 'female']) {
        const sourceKey = `${sourceSpecies}::${gender}`;
        const aliasKey = `${aliasSpecies}::${gender}`;
        if (library.characters[sourceKey]) library.characters[aliasKey] = library.characters[sourceKey];
      }
    }
    if (recovered) {
      global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
      global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.handShoulderRecovery = 'v9-post-calibration-exact-supplied';
      global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.handShoulderRecoveryCount = recovered;
    }
    return recovered;
  }

  // Apply before Animation Author snapshots the shared profile library. In the
  // game this also makes the procedural hand runtime consume the later v9
  // shoulder authoring, while shoulder-perch/saddle/grip/posterior are untouched.
  recoverPostCalibrationV9Shoulders(global.HOBUNJI_ATTACHMENT_RIG_PROFILES);

  // The old 200px shoulder author and the later Rig Coordinates author both
  // persisted work only in raw.githack.com's origin-wide localStorage before a
  // JSON export was committed. The v1 master guard intentionally redirected the
  // old key, which made that historical authored state invisible. A same-origin
  // about:blank iframe has its own unpatched Storage prototype, so Animation
  // Author can still inspect the untouched legacy key without making the game
  // depend on browser-local data.
  const isAnimationAuthor = typeof location !== 'undefined'
    && /\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname || '');
  const LEGACY_RIG_STORAGE_KEY = 'hobunjiAttachmentRigProfiles.v2';

  function readUntouchedLegacyStorage(key) {
    if (!isAnimationAuthor || typeof document === 'undefined') return null;
    let frame = null;
    try {
      frame = document.createElement('iframe');
      frame.src = 'about:blank';
      frame.style.display = 'none';
      (document.documentElement || document.body).appendChild(frame);
      return frame.contentWindow?.localStorage?.getItem(key) || null;
    } catch (_) {
      return null;
    } finally {
      try { frame?.remove(); } catch (_) {}
    }
  }

  function locateRigProfiles(value, depth = 0, seen = new Set()) {
    if (!value || typeof value !== 'object' || depth > 7 || seen.has(value)) return null;
    seen.add(value);
    if (value.characters && value.creatures && typeof value.characters === 'object' && typeof value.creatures === 'object') return value;
    const preferred = ['profiles', 'attachmentRigProfiles', 'rigProfiles', 'project', 'rig', 'data'];
    for (const key of preferred) {
      const found = locateRigProfiles(value[key], depth + 1, seen);
      if (found) return found;
    }
    for (const child of Object.values(value)) {
      const found = locateRigProfiles(child, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }

  function recoverLegacyAuthoredFamilies(targetLibrary, legacyLibrary) {
    if (!targetLibrary || !legacyLibrary) return { characterAnchors: 0, characterAnatomy: 0, creatureAnchors: 0 };
    const counts = { characterAnchors: 0, characterAnatomy: 0, creatureAnchors: 0 };
    for (const key of canonicalCharacterKeys(targetLibrary.characters)) {
      const target = targetLibrary.characters[key];
      const legacy = legacyLibrary.characters?.[key];
      if (!target || !legacy) continue;
      target.anchors ||= {};
      for (const anchorName of ['leftHandShoulder', 'rightHandShoulder', 'shoulderPerch']) {
        if (!validAnchor(legacy.anchors?.[anchorName])) continue;
        target.anchors[anchorName] = cloneAnchor(legacy.anchors[anchorName]);
        counts.characterAnchors++;
      }
      if (legacy.anatomy && typeof legacy.anatomy === 'object') {
        target.anatomy ||= {};
        for (const field of ['portraitVerticalPlacementRatio', 'portraitScale', 'handScale', 'footScale', 'armLengthHeightPercentOffset']) {
          const value = Number(legacy.anatomy[field]);
          if (!Number.isFinite(value) || (field.includes('Scale') && value <= 0)) continue;
          target.anatomy[field] = value;
          counts.characterAnatomy++;
        }
      }
      // Deliberately DO NOT restore posteriorRule/anchor here. v9's zeroed
      // heightPercentFromFloor is the one field we have positive evidence was
      // corrupted by the exporter, and the master recovery is authoritative.
    }
    for (const [aliasSpecies, sourceSpecies] of Object.entries(CHARACTER_ALIAS_SOURCES)) {
      for (const gender of ['male', 'female']) {
        const sourceKey = `${sourceSpecies}::${gender}`;
        const aliasKey = `${aliasSpecies}::${gender}`;
        if (targetLibrary.characters?.[sourceKey]) targetLibrary.characters[aliasKey] = targetLibrary.characters[sourceKey];
      }
    }
    for (const [kind, target] of Object.entries(targetLibrary.creatures || {})) {
      const legacy = legacyLibrary.creatures?.[kind];
      if (!target || !legacy) continue;
      target.anchors ||= {};
      for (const anchorName of ['saddle', 'shoulderGrip']) {
        if (!validAnchor(legacy.anchors?.[anchorName])) continue;
        target.anchors[anchorName] = cloneAnchor(legacy.anchors[anchorName]);
        counts.creatureAnchors++;
      }
    }
    return counts;
  }

  let legacyRigRecovery = { found: false, characterAnchors: 0, characterAnatomy: 0, creatureAnchors: 0 };
  if (isAnimationAuthor) {
    try {
      const rawLegacy = readUntouchedLegacyStorage(LEGACY_RIG_STORAGE_KEY);
      const parsedLegacy = rawLegacy ? JSON.parse(rawLegacy) : null;
      const legacyProfiles = locateRigProfiles(parsedLegacy);
      if (legacyProfiles) {
        legacyRigRecovery = { found: true, ...recoverLegacyAuthoredFamilies(global.HOBUNJI_ATTACHMENT_RIG_PROFILES, legacyProfiles) };
      }
    } catch (_) {}
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.legacyRigAutosaveRecovery = legacyRigRecovery;
  }

  // The v1 storage wrapper reconciled the entire mutable library on every save,
  // which could immediately overwrite recovered shoulders/perches again. In the
  // author only, bypass that destructive reconciliation and write the current
  // project straight to the master-versioned key. The recovered posterior is
  // already canonical before any actor is built.
  function installNonDestructiveRigAutosaveBridge() {
    const guard = global.HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD;
    if (!isAnimationAuthor || !guard || typeof Storage === 'undefined' || typeof localStorage === 'undefined') return false;
    const proto = Storage.prototype;
    if (proto.__hobunjiNonDestructiveRigAutosaveBridgeV1) return true;
    const previousSetItem = proto.setItem;
    proto.setItem = function(key, value) {
      if (this === localStorage && key === guard.legacyStorageKey) {
        return previousSetItem.call(this, guard.storageKey, String(value));
      }
      return previousSetItem.call(this, key, value);
    };
    Object.defineProperty(proto, '__hobunjiNonDestructiveRigAutosaveBridgeV1', { value: true });
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.autosaveGuard = 'non-destructive-authored-fields';
    return true;
  }
  installNonDestructiveRigAutosaveBridge();

  // The v1 public exporter had the same fingerprint replacement behavior. Wait
  // until that wrapper installs, then layer the live authored anchor/anatomy
  // families back over its output. Posterior stays whatever the master-safe
  // exporter resolved, so this cannot reintroduce the known v9 zero.
  function copyLiveAuthoredFamiliesToExport(output, liveLibrary) {
    const exported = output?.profiles || output?.attachmentRigProfiles;
    if (!exported || !liveLibrary) return output;
    for (const [key, live] of Object.entries(liveLibrary.characters || {})) {
      const target = exported.characters?.[key];
      if (!target || !live) continue;
      target.anchors ||= {};
      for (const anchorName of ['leftHandShoulder', 'rightHandShoulder', 'shoulderPerch']) {
        if (validAnchor(live.anchors?.[anchorName])) target.anchors[anchorName] = cloneAnchor(live.anchors[anchorName]);
      }
      if (live.anatomy) target.anatomy = clone(live.anatomy);
    }
    for (const [kind, live] of Object.entries(liveLibrary.creatures || {})) {
      const target = exported.creatures?.[kind];
      if (!target || !live) continue;
      target.anchors ||= {};
      for (const anchorName of ['saddle', 'shoulderGrip']) {
        if (validAnchor(live.anchors?.[anchorName])) target.anchors[anchorName] = cloneAnchor(live.anchors[anchorName]);
      }
      if (live.groundOffsets) target.groundOffsets = clone(live.groundOffsets);
    }
    output.exportGuard = {
      ...(output.exportGuard || {}),
      authoredFieldRecovery: 'live shoulder/perch/anatomy/saddle/grip preserved; master posterior retained',
    };
    return output;
  }

  function installNonDestructiveRigExportBridge() {
    if (!isAnimationAuthor) return false;
    const api = global.MultiAvatarAnimationAuthor;
    if (!api?.exportProject || !api?.getAttachmentRigProfiles || !api.__hobunjiMasterExporterGuard || api.__hobunjiAuthoredFieldRecoveryExportBridge) return false;
    const previousExport = api.exportProject.bind(api);
    api.exportProject = function() {
      const liveLibrary = api.getAttachmentRigProfiles();
      const output = previousExport();
      return document.body?.dataset?.animationAuthorMode === 'rig'
        ? copyLiveAuthoredFamiliesToExport(output, liveLibrary)
        : output;
    };
    Object.defineProperty(api, '__hobunjiAuthoredFieldRecoveryExportBridge', { value: true });
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.exporterGuard = 'master-posterior-plus-live-authored-fields';
    return true;
  }

  if (isAnimationAuthor && !installNonDestructiveRigExportBridge()) {
    let attempts = 0;
    const timer = setInterval(() => {
      if (installNonDestructiveRigExportBridge() || ++attempts >= 200) clearInterval(timer);
    }, 50);
  }

  global.HobunjiAttachmentRigRecovery = Object.freeze({
    recoverPostCalibrationV9Shoulders,
    recoverLegacyAuthoredFamilies,
    getLegacyRecoveryStatus: () => ({ ...legacyRigRecovery }),
  });
})(window);