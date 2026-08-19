// Runtime access to normalized furniture database entries that are authored in
// docs/tools/furniture-avatar-author/index.html. These records use the same
// part/emitter schema consumed by ProceduralFurniture/AuthoredFurnitureRuntime.
(() => {
  'use strict';
  if (window.HobunjiNormalizedFurnitureDatabase) return;

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const RAD = 180 / Math.PI;

  function emitterDefaults(type = 'fire') {
    const defs = {
      fire:   { name: 'Fire Emitter',   rate: 30, lifetime: 0.72, size: 0.17,  speed: 0.7,  spread: 0.30, radius: 0.08, gravity: -0.05, colorA: '#ffd45a', colorB: '#ff3d12' },
      smoke:  { name: 'Smoke Emitter',  rate: 6,  lifetime: 2.35, size: 0.22,  speed: 0.24, spread: 0.18, radius: 0.10, gravity: -0.03, colorA: '#b8b8b8', colorB: '#3e4148' },
      bubbles:{ name: 'Bubble Emitter', rate: 8,  lifetime: 1.65, size: 0.075, speed: 0.34, spread: 0.10, radius: 0.20, gravity: 0,     colorA: '#dff8ff', colorB: '#6fc8ff' },
      sparks: { name: 'Spark Emitter',  rate: 14, lifetime: 0.82, size: 0.055, speed: 1.15, spread: 0.72, radius: 0.06, gravity: 0.85,  colorA: '#fff1a0', colorB: '#ff6a16' },
    };
    return { ...(defs[type] || defs.fire), type, enabled: true, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  }

  function makeCampfireEntry() {
    const ashId = 'campfire_ash';
    const parts = [{
      id: ashId,
      kind: 'disc',
      name: 'Campfire Ash Bed',
      color: '#2d2928',
      segments: 20,
      materialRole: 'stone',
      materialTexture: 'carved_smooth.png',
      materialRotationDeg: 0,
      materialFillEnabled: true,
      materialFillColor: '#383130',
      materialFillMode: 'always',
      topScaleX: 1,
      topScaleZ: 1,
      bottomScaleX: 1,
      bottomScaleZ: 1,
      topSkewX: 0,
      topSkewZ: 0,
      wonkiness: 0,
      transform: { x: 0, y: 0.025, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.58, sy: 0.05, sz: 0.58 },
    }];

    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      parts.push({
        id: `campfire_stone_${i}`,
        kind: 'cylinder',
        name: `Fire Ring Stone ${i + 1}`,
        color: '#64605a',
        segments: 8,
        materialRole: 'stone',
        materialTexture: 'carved_smooth.png',
        materialRotationDeg: 0,
        materialFillEnabled: true,
        materialFillColor: '#64605a',
        materialFillMode: 'always',
        topScaleX: 0.82,
        topScaleZ: 0.88,
        bottomScaleX: 1,
        bottomScaleZ: 1,
        topSkewX: 0,
        topSkewZ: 0,
        wonkiness: 0.025,
        transform: { x: Math.cos(a) * 0.36, y: 0.085, z: Math.sin(a) * 0.36, rx: 0, ry: -a * RAD, rz: 0, sx: 0.20, sy: 0.15, sz: 0.15 },
      });
    }

    [0, 60, -60].forEach((angle, index) => parts.push({
      id: `campfire_log_${index}`,
      kind: 'beam',
      name: 'Campfire Log',
      color: '#6d3e20',
      segments: 4,
      materialRole: 'wood',
      materialTexture: 'boards.png',
      materialRotationDeg: 90,
      materialFillEnabled: false,
      materialFillColor: null,
      materialFillMode: 'never',
      topScaleX: 0.94,
      topScaleZ: 0.94,
      bottomScaleX: 1,
      bottomScaleZ: 1,
      topSkewX: 0,
      topSkewZ: 0,
      wonkiness: 0.012,
      transform: { x: 0, y: 0.17, z: 0, rx: 0, ry: angle, rz: 0, sx: 0.66, sy: 0.13, sz: 0.14 },
    }));

    return {
      key: 'campfire',
      name: 'Campfire',
      footprint: { w: 1, d: 1 },
      source: 'grounded stone-ring campfire with authored particle emitters',
      parts,
      particleEmitters: [
        {
          id: 'campfire_fire',
          ...emitterDefaults('fire'),
          type: 'fire',
          name: 'Campfire Flames',
          attachedPartId: ashId,
          position: { x: 0, y: 0.17, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          radius: 0.13,
          size: 0.19,
          rate: 38,
          enabled: true,
        },
        {
          id: 'campfire_smoke',
          ...emitterDefaults('smoke'),
          type: 'smoke',
          name: 'Campfire Smoke',
          attachedPartId: ashId,
          position: { x: 0, y: 0.31, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          radius: 0.08,
          rate: 5,
          enabled: true,
        },
      ],
      processingWarps: [],
      materialRules: { mapping: 'stretch' },
      surfaceRoles: [],
    };
  }

  const entries = Object.freeze({ campfire: makeCampfireEntry() });

  window.HobunjiNormalizedFurnitureDatabase = Object.freeze({
    schema: 'hobunji_furniture_database.v1',
    id: 'hobunji_normalized_furniture',
    name: 'Hobunji normalized furniture',
    has: key => Object.prototype.hasOwnProperty.call(entries, String(key || '')),
    get: key => clone(entries[String(key || '')] || null),
    keys: () => Object.keys(entries),
  });
})();
