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
    return species === 'rakakoan' ? 'kenkari' : species;
  }; // Rakakoan shoulder reads/edits always target the matching Kenkari transform record.

  function normalizePoint(raw) {
    return { x: number(raw?.x), y: number(raw?.y) };
  }

  function normalizeData(raw) {
    const next = clone(source);
    if (raw?.characters && typeof raw.characters === 'object') {
      for (const [key, entry] of Object.entries(raw.characters)) {
        const rawSpecies = normalizeKey(key.split('::')[0]);
        const canonicalSpecies = transformSpeciesId(rawSpecies);
        if (canonicalSpecies !== rawSpecies) continue; // Ignore stale independently-authored Rakakoan saves instead of letting them overwrite Kenkari.
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
    transformSpeciesAliases: Object.freeze({ rakakoan: 'kenkari' }),
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
})(window);