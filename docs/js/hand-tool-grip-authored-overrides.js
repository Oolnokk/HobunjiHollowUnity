// Canonical authored grip revisions layered over the large hand-tool-grips module.
// Each revision migrates older defaults/imports once, then leaves later artist edits alone.
(function (global) {
  'use strict';

  const api = global.HobunjiHandToolGrips; // Used below to migrate live/editor grip data after the core grip module loads.
  if (!api?.mutate || global.HobunjiAuthoredGripOverrides) return;

  const PREVIOUS_REVISION = 'spear-bshuakauitl-authored-20261006-v1'; // Identifies already-migrated drafts whose only new correction is the spear's fixed melee Z.
  const REVISION = 'spear-bshuakauitl-authored-20261007-v2'; // Stored on grip data so these authored coordinates migrate exactly once.
  const AUTHORED = Object.freeze({ // Canonical values copied from the newest Attack Animation Editor grip export.
    bshuakauitl: Object.freeze({
      primaryGrip: Object.freeze({ position: Object.freeze({ x: -0.04, y: -0.04, z: 0.05 }), rotationDeg: Object.freeze({ pitch: 90, yaw: -90, roll: 0 }) }),
      primaryGripSpan: Object.freeze({ enabled: true, startZ: 0.0394, endZ: 0.1594 }),
      secondaryGripSpan: Object.freeze({ enabled: true, startZ: -0.1606, endZ: -0.0406 }),
      rangedPrimaryGrip: Object.freeze({ position: Object.freeze({ x: -0.04, y: -0.04, z: -0.0006 }), rotationDeg: Object.freeze({ pitch: 90, yaw: -90, roll: 0 }) }),
      rangedSecondaryGripSpan: Object.freeze({ enabled: false, startZ: 0, endZ: 0 }),
    }),
    fishingspear: Object.freeze({
      primaryGrip: Object.freeze({ position: Object.freeze({ x: -0.04, y: -0.04, z: 0 }), rotationDeg: Object.freeze({ pitch: 90, yaw: -90, roll: 0 }) }),
      primaryGripSpan: Object.freeze({ enabled: true, startZ: -0.3522, endZ: -0.2322 }),
      secondaryGripSpan: Object.freeze({ enabled: true, startZ: -0.0722, endZ: 0.0478 }),
      rangedPrimaryGrip: Object.freeze({ position: Object.freeze({ x: 0.04, y: -0.04, z: 0.1522 }), rotationDeg: Object.freeze({ pitch: 90, yaw: -90, roll: 0 }) }),
      rangedSecondaryGripSpan: Object.freeze({ enabled: false, startZ: 0, endZ: 0 }),
    }),
  });
  let applying = false; // Prevents the subscription below from recursing while api.mutate() emits its own change notification.

  const clone = value => JSON.parse(JSON.stringify(value)); // Used below so frozen authored templates never become mutable runtime data.

  function applyAuthoredValues(data) {
    if (!data || typeof data !== 'object') return data;
    if (data.authoredGripRevision === REVISION) return data;
    data.tools ||= {};
    if (data.authoredGripRevision === PREVIOUS_REVISION && data.tools.fishingspear?.primaryGrip?.position) {
      data.tools.fishingspear.primaryGrip.position.z = AUTHORED.fishingspear.primaryGrip.position.z;
      data.authoredGripRevision = REVISION;
      return data;
    }
    for (const [toolKey, authored] of Object.entries(AUTHORED)) {
      const entry = data.tools[toolKey] ||= {}; // Existing per-tool scale/mode metadata stays intact; only authored grip fields are replaced.
      entry.primaryGrip = clone(authored.primaryGrip);
      entry.primaryGripSpan = clone(authored.primaryGripSpan);
      entry.secondaryGripSpan = clone(authored.secondaryGripSpan);
      entry.rangedPrimaryGrip = clone(authored.rangedPrimaryGrip);
      entry.rangedSecondaryGripSpan = clone(authored.rangedSecondaryGripSpan);
    }
    data.authoredGripRevision = REVISION;
    return data;
  }

  function apply() {
    if (applying || api.data?.authoredGripRevision === REVISION) return false;
    applying = true;
    try {
      api.mutate(data => applyAuthoredValues(data));
    } finally {
      applying = false;
    }
    return true;
  }

  const defaultDescriptor = Object.getOwnPropertyDescriptor(api, 'defaultData'); // Used to keep callers of defaultData aligned with the migrated live data.
  if (defaultDescriptor?.get && defaultDescriptor.configurable !== false) {
    Object.defineProperty(api, 'defaultData', {
      configurable: true,
      enumerable: defaultDescriptor.enumerable !== false,
      get() { return applyAuthoredValues(clone(defaultDescriptor.get.call(api))); },
    });
  }

  const unsubscribe = api.subscribe?.(() => { if (!applying) apply(); }) || null; // Re-applies only when an imported/cleared draft lacks this revision marker.
  apply();

  global.HobunjiAuthoredGripOverrides = Object.freeze({
    revision: REVISION,
    apply,
    dispose() { unsubscribe?.(); },
    debugSnapshot() {
      return {
        revision: REVISION,
        applied: api.data?.authoredGripRevision === REVISION,
        bshuakauitl: clone(api.data?.tools?.bshuakauitl || null),
        fishingspear: clone(api.data?.tools?.fishingspear || null),
      };
    },
  });
})(window);
