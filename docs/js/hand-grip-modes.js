// Reusable hand/tool grip modes shared by gameplay and the Attack Animation Editor.
// Model handFromTool remains a per-GLB fine alignment. The selected grip mode adds
// a reusable stance transform on top so one calibrated model can hold tools in
// multiple anatomically distinct ways.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  if (!profiles || profiles.__hobunjiGripModesWrapped) return;

  const PALM_CLEARANCE = 0.18; // Hand-height units: keeps a zero-origin handle on the palm surface instead of through its center.
  const modes = Object.freeze({
    'palm-parallel': Object.freeze({
      key: 'palm-parallel',
      label: 'Palm parallel',
      description: 'Tool shaft lies in the palm plane. Hoe-style grip.',
      position: Object.freeze({ x: 0, y: 0, z: -PALM_CLEARANCE }),
      rotationDeg: Object.freeze({ pitch: 0, yaw: 0, roll: 0 }),
    }),
    'palm-perpendicular': Object.freeze({
      key: 'palm-perpendicular',
      label: 'Palm perpendicular',
      description: 'Palm normal aligns with the tool shaft. Pick-shovel-style grip.',
      position: Object.freeze({ x: 0, y: PALM_CLEARANCE, z: 0 }),
      rotationDeg: Object.freeze({ pitch: 90, yaw: 0, roll: 0 }),
    }),
  });

  let editorMode = null;
  let runtimeOverride = null;
  const listeners = new Set();
  const originalHandTransformForSpecies = profiles.handTransformForSpecies.bind(profiles);

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function defaultForTool(value) {
    const key = normalizeKey(value);
    if (key.includes('pickshovel') || key.includes('pick-shovel')) return 'palm-perpendicular';
    if (key.includes('hoe')) return 'palm-parallel';
    return 'palm-parallel';
  }

  function editorDefault() {
    return defaultForTool(document.getElementById('toolSpriteSelect')?.value || '');
  }

  function runtimeDefault() {
    const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
    return defaultForTool(snapshot?.itemKey || snapshot?.shape || '');
  }

  function currentModeKey() {
    if (/\/tools\/attack-animation-editor\//.test(location.pathname)) {
      return modes[editorMode] ? editorMode : editorDefault();
    }
    if (modes[runtimeOverride]) return runtimeOverride;
    return runtimeDefault();
  }

  function currentMode() {
    return modes[currentModeKey()] || modes['palm-parallel'];
  }

  function combine(base, mode) {
    const bp = base?.position || {};
    const br = base?.rotationDeg || {};
    const mp = mode?.position || {};
    const mr = mode?.rotationDeg || {};
    return {
      position: {
        x: (Number(bp.x) || 0) + (Number(mp.x) || 0),
        y: (Number(bp.y) || 0) + (Number(mp.y) || 0),
        z: (Number(bp.z) || 0) + (Number(mp.z) || 0),
      },
      rotationDeg: {
        pitch: (Number(br.pitch) || 0) + (Number(mr.pitch) || 0),
        yaw: (Number(br.yaw) || 0) + (Number(mr.yaw) || 0),
        roll: (Number(br.roll) || 0) + (Number(mr.roll) || 0),
      },
    };
  }

  function handTransformForSpecies(speciesId) {
    return combine(originalHandTransformForSpecies(speciesId), currentMode());
  }

  function notify() {
    for (const listener of listeners) {
      try { listener(currentModeKey()); } catch (_) {}
    }
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function setEditorMode(key) {
    editorMode = modes[key] ? key : null;
    notify();
    return currentModeKey();
  }

  function setRuntimeMode(key) {
    runtimeOverride = modes[key] ? key : null;
    notify();
    return currentModeKey();
  }

  profiles.handTransformForSpecies = handTransformForSpecies;
  Object.defineProperty(profiles, '__hobunjiGripModesWrapped', { value: true, configurable: true });

  global.HobunjiHandGripModes = {
    modes,
    defaultForTool,
    currentModeKey,
    currentMode,
    setEditorMode,
    setRuntimeMode,
    clearRuntimeMode() { runtimeOverride = null; notify(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get palmClearance() { return PALM_CLEARANCE; },
  };
})(window);
