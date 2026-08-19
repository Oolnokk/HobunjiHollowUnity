// Tool-local hand grip sockets shared by gameplay and the Attack Animation Editor.
// Primary grip is always the toolHolder origin. Weapons/tools may optionally define
// one secondary grip frame for the opposite hand. No arm reach or IK participates.
(function (global) {
  'use strict';

  const SCHEMA = 'hobunji_hand_tool_grips.v1';
  const LOCAL_KEY = 'hobunji.handToolGrips.v1';
  const SECONDARY_DEFAULTS_VERSION = 2; // Marks data after the old auto-enabled hatchet/hoe secondary defaults have been migrated.

  function identityTransform() {
    return {
      position: { x: 0, y: 0, z: 0 },
      rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
    };
  }

  const DEFAULT_DATA = {
    schema: SCHEMA,
    secondaryDefaultsVersion: SECONDARY_DEFAULTS_VERSION,
    tools: {
      // Keep useful authored starting offsets, but a secondary grip is genuinely
      // optional: every tool starts one-handed until the user explicitly enables it.
      hatchet: {
        secondaryGrip: {
          enabled: false,
          position: { x: 0, y: -0.28, z: 0 },
          rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
        },
      },
      hoe: {
        secondaryGrip: {
          enabled: false,
          position: { x: 0, y: -0.32, z: 0 },
          rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
        },
      },
    },
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const listeners = new Set();

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function toolKeyFor(value) {
    const key = normalizeKey(value);
    if (key.includes('hatchet')) return 'hatchet';
    if (key.includes('hoe')) return 'hoe';
    if (key.includes('pickshovel') || key.includes('pick-shovel')) return 'pickshovel';
    if (key.includes('fishingspear') || key.includes('fishing-spear')) return 'fishingspear';
    if (key.includes('fishingmace') || key.includes('fishing-mace')) return 'fishingmace';
    return key;
  }

  function numberOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeTransform(raw) {
    return {
      position: {
        x: numberOrZero(raw?.position?.x),
        y: numberOrZero(raw?.position?.y),
        z: numberOrZero(raw?.position?.z),
      },
      rotationDeg: {
        pitch: numberOrZero(raw?.rotationDeg?.pitch),
        yaw: numberOrZero(raw?.rotationDeg?.yaw),
        roll: numberOrZero(raw?.rotationDeg?.roll),
      },
    };
  }

  function matchesLegacyAutoDefault(key, secondary) {
    if (secondary?.enabled !== true) return false;
    const expectedY = key === 'hatchet' ? -0.28 : key === 'hoe' ? -0.32 : null;
    if (expectedY == null) return false;
    const p = secondary.position || {};
    const r = secondary.rotationDeg || {};
    return numberOrZero(p.x) === 0
      && numberOrZero(p.y) === expectedY
      && numberOrZero(p.z) === 0
      && numberOrZero(r.pitch) === 0
      && numberOrZero(r.yaw) === 0
      && numberOrZero(r.roll) === 0;
  }

  function migrateLegacySecondaryDefaults(raw) {
    const next = clone(raw || DEFAULT_DATA);
    if ((Number(next.secondaryDefaultsVersion) || 0) >= SECONDARY_DEFAULTS_VERSION) return next;

    // Older builds silently started hatchet/hoe in two-hand mode. That produced
    // exactly a duplicate primary-hand frame with only a vertical offset. Migrate
    // only that untouched legacy signature; customized secondary grips are kept.
    for (const key of ['hatchet', 'hoe']) {
      const secondary = next.tools?.[key]?.secondaryGrip;
      if (matchesLegacyAutoDefault(key, secondary)) secondary.enabled = false;
    }
    next.secondaryDefaultsVersion = SECONDARY_DEFAULTS_VERSION;
    return next;
  }

  function normalizeData(raw) {
    const next = migrateLegacySecondaryDefaults(raw || DEFAULT_DATA);
    next.schema = SCHEMA;
    next.secondaryDefaultsVersion = SECONDARY_DEFAULTS_VERSION;
    if (!next.tools || typeof next.tools !== 'object') next.tools = {};
    for (const entry of Object.values(next.tools)) {
      if (!entry || typeof entry !== 'object') continue;
      const secondary = entry.secondaryGrip || {};
      entry.secondaryGrip = {
        enabled: secondary.enabled === true,
        ...normalizeTransform(secondary),
      };
    }
    return next;
  }

  let data = normalizeData(DEFAULT_DATA);

  function notify() {
    for (const listener of listeners) {
      try { listener(data); } catch (_) {}
    }
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function replace(next) {
    if (!next || next.schema !== SCHEMA) throw new Error(`Expected ${SCHEMA}`);
    data = normalizeData(next);
    notify();
    return data;
  }

  function mutate(mutator) {
    mutator(data);
    data = normalizeData(data);
    notify();
    return data;
  }

  function ensureTool(value) {
    const key = toolKeyFor(value);
    if (!key) return null;
    if (!data.tools[key]) data.tools[key] = { secondaryGrip: { enabled: false, ...identityTransform() } };
    if (!data.tools[key].secondaryGrip) data.tools[key].secondaryGrip = { enabled: false, ...identityTransform() };
    return data.tools[key];
  }

  function secondaryGripForTool(value) {
    const key = toolKeyFor(value);
    const raw = data.tools?.[key]?.secondaryGrip;
    if (!raw?.enabled) return null;
    return { enabled: true, ...normalizeTransform(raw) };
  }

  function saveLocal() { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); }
  function loadLocal() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return false;
    replace(JSON.parse(raw));
    return true;
  }
  function clearLocal() {
    localStorage.removeItem(LOCAL_KEY);
    data = normalizeData(DEFAULT_DATA);
    notify();
  }

  global.HobunjiHandToolGrips = {
    schema: SCHEMA,
    get data() { return data; },
    get defaultData() { return normalizeData(DEFAULT_DATA); },
    clone: () => clone(data),
    toolKeyFor,
    ensureTool,
    secondaryGripForTool,
    replace,
    mutate,
    saveLocal,
    loadLocal,
    clearLocal,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
})(window);
