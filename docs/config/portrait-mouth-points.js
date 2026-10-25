// Species/gender "mouth" coordinate on the portrait. Head-anchored tool poses (blowgun, drink) mate their
// tool's aperture with this point; SharedAttackPose.headFrame resolves it through the live skinned head.
//
// A point is { u, v }: fractions of the portrait SOURCE image, from its top-left (0..1), so it holds at any
// render resolution. A species with no point uses its head centroid, which is every species for now.
//
// Where to set one: Attack Animation Editor -> "Portrait mouth point" (under Preview species). Edits are kept
// as a draft in this browser (applies in the game here too); "Copy mouth table" gives the JSON to paste into
// POINTS below so it ships for everyone, after which "Clear draft" drops the local copy.
(() => {
  'use strict';

  const VERSION = 2;
  const DRAFT_KEY = 'hobunji.portraitMouthPoints.draft.v1';
  const POINTS = { // Committed table, e.g. 'mao-ao::male': { u: 0.5, v: 0.32 }
  };

  const keyFor = (speciesId, gender) => `${String(speciesId || '').trim().toLowerCase().replace(/_/g, '-')}::${String(gender || 'male').trim().toLowerCase() === 'female' ? 'female' : 'male'}`;
  const valid = point => !!point && Number.isFinite(Number(point.u)) && Number.isFinite(Number(point.v)) && point.u >= 0 && point.u <= 1 && point.v >= 0 && point.v <= 1;
  const points = {}; // Live table: committed POINTS, then this browser's draft on top.
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) { try { listener(); } catch (_) {} } };

  for (const [key, point] of Object.entries(POINTS)) if (valid(point)) points[key] = { u: point.u, v: point.v };
  try {
    const draft = JSON.parse(window.localStorage?.getItem(DRAFT_KEY) || 'null');
    if (draft && typeof draft === 'object') for (const [key, point] of Object.entries(draft)) if (valid(point)) points[key] = { u: Number(point.u), v: Number(point.v) };
  } catch (_) { /* Private mode or a malformed draft: fall back to the committed table. */ }

  function persist() {
    try {
      const draft = {};
      for (const [key, point] of Object.entries(points)) if (!POINTS[key] || POINTS[key].u !== point.u || POINTS[key].v !== point.v) draft[key] = point;
      if (Object.keys(draft).length) window.localStorage?.setItem(DRAFT_KEY, JSON.stringify(draft));
      else window.localStorage?.removeItem(DRAFT_KEY);
    } catch (_) { /* The in-memory table still applies this session. */ }
  }

  const get = (speciesId, gender) => points[keyFor(speciesId, gender)] || null;

  function set(speciesId, gender, point) {
    const next = { u: Number(point?.u), v: Number(point?.v) };
    if (!valid(next)) return false;
    points[keyFor(speciesId, gender)] = next;
    persist(); notify();
    return true;
  }

  function clear(speciesId, gender) {
    const key = keyFor(speciesId, gender);
    if (POINTS[key]) points[key] = { u: POINTS[key].u, v: POINTS[key].v }; // Falls back to the committed value, not to nothing.
    else delete points[key];
    persist(); notify();
  }

  // Mouth pixel in the portrait's source-pixel space (what the skinned-pixel resolver takes), or the head centroid.
  function pixelFor(speciesId, gender, rig = null, sourceCanvas = null) {
    const point = get(speciesId, gender);
    const width = Number(sourceCanvas?.naturalWidth || sourceCanvas?.width), height = Number(sourceCanvas?.naturalHeight || sourceCanvas?.height);
    if (point && width > 0 && height > 0) return { x: point.u * width, y: point.v * height };
    return rig?.headCentroidPx || null;
  }

  const table = () => JSON.parse(JSON.stringify(points));
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };

  window.HobunjiPortraitMouthPoints = Object.freeze({ version: VERSION, DRAFT_KEY, keyFor, get, set, clear, pixelFor, table, subscribe });
})();
