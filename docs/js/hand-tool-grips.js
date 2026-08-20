// Tool-local hand grip sockets shared by gameplay and the Attack Animation Editor.
// Primary grip is always the toolHolder origin. Weapons/tools may optionally define
// one secondary grip frame for the opposite hand. No arm reach or IK participates.
(function (global) {
  'use strict';

  const SCHEMA = 'hobunji_hand_tool_grips.v1';
  const LOCAL_KEY = 'hobunji.handToolGrips.v1';

  function identityTransform() {
    return {
      position: { x: 0, y: 0, z: 0 },
      rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
    };
  }

  const DEFAULT_DATA = {
    schema: SCHEMA,
    tools: {
      // Initial two-handed tools requested. These offsets are conservative
      // starting points and are intentionally editable in the Attack Editor.
      hatchet: {
        secondaryGrip: {
          enabled: true,
          position: { x: 0, y: -0.28, z: 0 },
          rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
        },
      },
      hoe: {
        secondaryGrip: {
          enabled: true,
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

  function normalizeData(raw) {
    const next = clone(raw || DEFAULT_DATA);
    next.schema = SCHEMA;
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
