// Shared gameplay, HUD, and editor tuning. Loaded before dependent scripts.
(function (root) {
  'use strict';
  const plateauVerticalUnit = 2.5;
  root.HOBUNJI_CONFIG = Object.freeze({
    terrain: Object.freeze({
      plateauVerticalUnit,
      // visualHeights stores normalized values. Keep its full displacement
      // strictly below one gameplay cliff tier.
      subtleHeightMaxDisplacement: plateauVerticalUnit * 0.24,
      subtleHeightMin: -1,
      subtleHeightMax: 1,
      subtleHeightDefault: 0,
      subtleHeightMaxNeighborDelta: 1.99
    }),
    editor: Object.freeze({
      visualHeightBrushStrength: 0.1,
      visualHeightBrushRadius: 1,
      visualHeightBrushMode: 'literal',
      visualHeightColorStops: Object.freeze([
        Object.freeze({ value: -1, color: '#2563eb' }),
        Object.freeze({ value: 0, color: '#f8fafc' }),
        Object.freeze({ value: 1, color: '#ef4444' })
      ])
    }),
    resourceRings: Object.freeze({
      arcs: Object.freeze({
        health: Object.freeze({ start: 292, end: 186 }),
        stamina: Object.freeze({ start: 174, end: 68 }),
        footing: Object.freeze({ start: 56, end: -56 })
      }),
      colors: Object.freeze({
        health: '#55d76f',
        stamina: '#67b7ff',
        footing: '#d9a441',
        exhausted: '#050608',
        outline: '#000000',
        target: '#ff2020'
      }),
      afflictionColors: Object.freeze({
        woundedStamina: '#ff9b2f',
        bleedingHealth: '#cf1e2e',
        congealedHealth: '#c98d41',
        infectedStamina: '#284f2a',
        windedStamina: '#90949c',
        bruisedHealth: '#4c42a9',
        shatteredStamina: '#8c4ad9',
        poisonedHealth: '#37651c'
      }),
      neon: Object.freeze({
        minSourceSaturation: 0.12,
        minSourceLightness: 0.08,
        saturation: 1,
        minLightness: 0.42,
        maxLightness: 0.6,
        glowHaloPadFraction: 0.34,
        glowHaloOpacityMultiplier: 0.75
      }),
      afflictionPulse: Object.freeze({ durationSeconds: 1, scale: 0.22, shakeUnits: 0.035 })
    })
  });

  // These legacy records have historically been authored as people who must
  // not participate in live town schedules. Two are deceased; Hammerhead was
  // previously represented as banished, and old/local database copies can
  // therefore lack the newer lifecycle wording the generic filter expects.
  const LEGACY_NONSPAWN_NPC_IDS = new Set([
    'talisman_hatayap',
    'bowstring_hatayap',
    'hammerhead_tuhupnuk',
  ]);

  function isRuntimeNonspawnNpc(npc) {
    if (!npc || typeof npc !== 'object') return false;
    if (LEGACY_NONSPAWN_NPC_IDS.has(String(npc.id || ''))) return true;
    if (npc.isDeceased === true || npc.spawnEnabled === false || npc.spawn === false) return true;
    const status = String(npc.lifecycleStatus ?? npc.lifeStatus ?? npc.status ?? '').trim().toLowerCase(); // Used to catch explicit lifecycle fields in newer database exports.
    if (status === 'deceased' || status === 'dead' || status === 'banished') return true;
    const authoredSignals = [npc.role, npc.homeId, ...(Array.isArray(npc.tags) ? npc.tags : [])]; // Used to catch legacy structured naming without scanning biography/lore prose.
    return authoredSignals.some(value => /(^|[^a-z])(deceased|dead|banished)([^a-z]|$)/i.test(String(value || '')));
  }

  function wrapRuntimeNpcDatabaseLoader(localDb) {
    if (!localDb || localDb.__hobunjiRuntimeNonspawnWrapped) return localDb;
    const originalLoadDatabase = localDb.loadDatabase; // Used to preserve the normal repo/local-source selection and dialogue composition.
    if (typeof originalLoadDatabase !== 'function') return localDb;
    localDb.loadDatabase = async function (id, ...args) {
      const data = await originalLoadDatabase.call(this, id, ...args); // Used as the already-selected database result before final spawn admission filtering.
      if (id !== 'npcDatabase' || !Array.isArray(data?.npcs)) return data;
      const removed = data.npcs.filter(isRuntimeNonspawnNpc); // Used for both the authoritative final filter and startup diagnostics.
      if (!removed.length) return data;
      const filtered = { ...data, npcs: data.npcs.filter(npc => !isRuntimeNonspawnNpc(npc)) }; // Used so stale defaultPosition data can never reach spawnScheduledNpcs.
      const message = `[NPC lifecycle] Runtime spawn gate removed ${removed.length} nonspawn NPC(s): ${removed.map(n => n.id || n.name || '<unnamed>').join(', ')}`;
      if (typeof root.debugLog === 'function') root.debugLog(message, 'schedule');
      else root.__farmLog?.(message, 'info');
      return filtered;
    };
    Object.defineProperty(localDb, '__hobunjiRuntimeNonspawnWrapped', { value: true, configurable: true });
    return localDb;
  }

  // config.js loads before local-db-overrides.js. Intercept that module's one
  // global assignment so the spawn gate is installed before game.js can ever
  // request the NPC database; this cannot lose a race to a startup schedule.
  function installRuntimeNpcSpawnGate() {
    const existing = root.LocalDBOverrides;
    if (existing) { wrapRuntimeNpcDatabaseLoader(existing); return; }
    let assignedValue; // Used only until local-db-overrides.js assigns its API object.
    try {
      Object.defineProperty(root, 'LocalDBOverrides', {
        configurable: true,
        enumerable: true,
        get() { return assignedValue; },
        set(value) {
          assignedValue = wrapRuntimeNpcDatabaseLoader(value) || value;
          Object.defineProperty(root, 'LocalDBOverrides', {
            configurable: true, enumerable: true, writable: true, value: assignedValue,
          });
        },
      });
    } catch (_) {}
  }
  installRuntimeNpcSpawnGate();

  // The old hard-surface footstep voice still lives in AudioSystem as the
  // gravel fallback. Recorded gravel/path clips were later configured on top
  // of it; disable those clips for the live game so paths, building floors,
  // and BuildingDoor-classified porches consistently use the procedural voice.
  // Run after synchronous config scripts have populated SCRATCHBONES_CONFIG;
  // playback happens later, so AudioSystem sees this before any footfall.
  function useProceduralHardSurfaceFootsteps() {
    if (typeof location !== 'undefined' && /\/tools\//.test(location.pathname)) return;
    const directAudio = root.SCRATCHBONES_CONFIG?.game?.audio; // Used when the modern direct audio config is populated.
    const audio = directAudio && Object.keys(directAudio).length
      ? directAudio
      : root.SCRATCHBONES_CONFIG?.game?.assets?.audio; // Used by older/current assets.audio config layouts.
    const footsteps = audio?.footsteps; // Used as the same config object AudioSystem reads for each footfall.
    if (!footsteps) return;
    const surfaces = footsteps.surfaces || (footsteps.surfaces = {}); // Used to replace only the hard/gravel surface configuration.
    const existingGravel = surfaces.gravel || {}; // Used to preserve any non-recording hard-surface tuning already authored in config.
    surfaces.gravel = {
      ...existingGravel,
      urls: [],
      url: null,
      volumeMul: 1.65,
    };
    const message = '[footsteps] Recorded hard-surface clips disabled; procedural path/porch/interior voice active at volumeMul=1.65.'; // Used for mobile-visible confirmation in the existing debug log.
    if (typeof root.debugLog === 'function') root.debugLog(message, 'audio');
    else console.info(message);
  }

  if (typeof setTimeout === 'function') setTimeout(useProceduralHardSurfaceFootsteps, 0);
})(typeof self !== 'undefined' ? self : globalThis);
