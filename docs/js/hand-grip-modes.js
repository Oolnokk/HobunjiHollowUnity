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

  // An artist-committed per-tool choice (authored via the Attack Editor's grip-mode
  // dropdown and stored in HobunjiHandToolGrips, the same shared object the game
  // reads) always wins. This is what makes the editor's grip-mode picker actually
  // change gameplay instead of only the editor preview. Tools without a committed
  // choice keep falling back to the tool-name heuristic below.
  function storedModeForTool(value) {
    const stored = global.HobunjiHandToolGrips?.gripModeForTool?.(value);
    return modes[stored] ? stored : null;
  }

  function defaultForTool(value) {
    const stored = storedModeForTool(value);
    if (stored) return stored;
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

  function multiplyQuat(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  // Matches THREE.Euler(..., 'YXZ'): yaw * pitch * roll. Keep this utility
  // independent of a global THREE so it works in both the classic game build and
  // the Attack Editor's ESM/import-map Three instance.
  function quatFromYXZ(rotation = {}) {
    const pitch = (Number(rotation.pitch) || 0) * Math.PI / 180;
    const yaw = (Number(rotation.yaw) || 0) * Math.PI / 180;
    const roll = (Number(rotation.roll) || 0) * Math.PI / 180;
    const qYaw = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const qPitch = { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) };
    const qRoll = { x: 0, y: 0, z: Math.sin(roll / 2), w: Math.cos(roll / 2) };
    return multiplyQuat(multiplyQuat(qYaw, qPitch), qRoll);
  }

  function normalizeQuat(q) {
    const x = Number(q?.x) || 0;
    const y = Number(q?.y) || 0;
    const z = Number(q?.z) || 0;
    const w = Number.isFinite(Number(q?.w)) ? Number(q.w) : 1;
    const length = Math.hypot(x, y, z, w) || 1;
    return { x: x / length, y: y / length, z: z / length, w: w / length };
  }

  function inverseQuat(rawQuat) {
    const q = normalizeQuat(rawQuat); // Used to derive the actual spatial delta between the calibrated and mode-adjusted authored frames.
    return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  }

  function rotateVectorByQuat(vector = {}, rawQuat = {}) {
    const q = normalizeQuat(rawQuat);
    const vx = Number(vector.x) || 0;
    const vy = Number(vector.y) || 0;
    const vz = Number(vector.z) || 0;
    const tx = 2 * (q.y * vz - q.z * vy);
    const ty = 2 * (q.z * vx - q.x * vz);
    const tz = 2 * (q.x * vy - q.y * vx);
    return {
      x: vx + q.w * tx + (q.y * tz - q.z * ty),
      y: vy + q.w * ty + (q.z * tx - q.x * tz),
      z: vz + q.w * tz + (q.x * ty - q.y * tx),
    };
  }

  function eulerYXZFromQuat(rawQuat) {
    const q = normalizeQuat(rawQuat);
    const { x, y, z, w } = q;
    const m11 = 1 - 2 * (y * y + z * z);
    const m13 = 2 * (x * z + y * w);
    const m21 = 2 * (x * y + z * w);
    const m22 = 1 - 2 * (x * x + z * z);
    const m23 = 2 * (y * z - x * w);
    const m31 = 2 * (x * z - y * w);
    const m33 = 1 - 2 * (x * x + y * y);
    const clamp = value => Math.max(-1, Math.min(1, value));
    const pitch = Math.asin(-clamp(m23));
    let yaw;
    let roll;
    if (Math.abs(m23) < 0.9999999) {
      yaw = Math.atan2(m13, m33);
      roll = Math.atan2(m21, m22);
    } else {
      yaw = Math.atan2(-m31, m11);
      roll = 0;
    }
    const toDeg = radians => radians * 180 / Math.PI;
    return { pitch: toDeg(pitch), yaw: toDeg(yaw), roll: toDeg(roll) };
  }

  function combine(base, mode) {
    const bp = base?.position || {};
    const br = base?.rotationDeg || {};
    const mp = mode?.position || {};
    const mr = mode?.rotationDeg || {};
    const fineQ = quatFromYXZ(br);

    // Grip-mode axes are authoring axes, not pre-calibration/world axes. Applying
    // +90° pitch before the shared -90° yaw calibration turned Palm Perpendicular
    // into an apparent roll. Build the target authored Euler first so the preset
    // changes exactly the named axis, then derive the rigid spatial delta from it.
    const targetRotation = {
      pitch: (Number(br.pitch) || 0) + (Number(mr.pitch) || 0),
      yaw: (Number(br.yaw) || 0) + (Number(mr.yaw) || 0),
      roll: (Number(br.roll) || 0) + (Number(mr.roll) || 0),
    };
    const rotationQuaternion = normalizeQuat(quatFromYXZ(targetRotation));
    const modeDeltaQ = normalizeQuat(multiplyQuat(rotationQuaternion, inverseQuat(fineQ)));

    // Keep translation a true rigid transform under the same effective mode delta.
    const rotatedFinePosition = rotateVectorByQuat(bp, modeDeltaQ);
    return {
      position: {
        x: (Number(mp.x) || 0) + rotatedFinePosition.x,
        y: (Number(mp.y) || 0) + rotatedFinePosition.y,
        z: (Number(mp.z) || 0) + rotatedFinePosition.z,
      },
      rotationDeg: targetRotation,
      rotationQuaternion,
    };
  }

  function effectiveFrameForSpecies(speciesId) {
    return combine(originalHandTransformForSpecies(speciesId), currentMode());
  }

  function handTransformForSpecies(speciesId) {
    return effectiveFrameForSpecies(speciesId);
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
    effectiveFrameForSpecies,
    quaternionForRotation: quatFromYXZ,
    setEditorMode,
    setRuntimeMode,
    clearRuntimeMode() { runtimeOverride = null; notify(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get palmClearance() { return PALM_CLEARANCE; },
  };
})(window);