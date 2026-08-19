// Keeps Attack Editor shoulder-compass choices scoped to the animation being edited.
//
// The original shoulder-control adapter owns the actual checkbox -> poseAim plumbing.
// This layer only swaps that state when the editor loads a different preset/file, so
// changing one animation no longer leaks its compass choices into every other one.
(function (global) {
  'use strict';

  const controls = global.HobunjiAttackEditorHandShoulderControls;
  const presetSelect = document.getElementById('presetSelect');
  const loadPresetButton = document.getElementById('loadPresetBtn');
  const loadFile = document.getElementById('loadFile');
  if (!controls || !presetSelect || !loadPresetButton || !loadFile || global.HobunjiAttackEditorShoulderAnimationState) return;

  const PHASES = Object.freeze(['neutral', 'windup', 'strike']);
  const AXES = Object.freeze(['pitch', 'yaw', 'roll']);
  const DEFAULTS = Object.freeze({
    neutral: Object.freeze({ pitch: true, yaw: false, roll: true }),
    windup: Object.freeze({ pitch: false, yaw: false, roll: true }),
    strike: Object.freeze({ pitch: false, yaw: false, roll: true }),
  });
  const cache = new Map(); // Stores independent checkbox sets for each editor animation key.
  let activeKey = 'draft:new-attack'; // Identifies the animation whose checkboxes are currently visible.
  let applyingState = false; // Prevents our own synthetic checkbox events from recursively saving partial state.

  function checkboxId(phase, axis) {
    return `handShoulderAim_${phase}_${axis}`;
  }

  function cloneState(state) {
    return Object.fromEntries(PHASES.map(phase => [phase, { ...state[phase] }]));
  }

  function defaultState() {
    return cloneState(DEFAULTS);
  }

  function normalizeAxes(raw, fallback) {
    return {
      pitch: raw?.pitch === true ? true : raw?.pitch === false ? false : !!fallback.pitch,
      yaw: raw?.yaw === true ? true : raw?.yaw === false ? false : !!fallback.yaw,
      roll: raw?.roll === true ? true : raw?.roll === false ? false : !!fallback.roll,
    };
  }

  function normalizePoseSet(raw = {}) {
    return {
      neutral: normalizeAxes(raw?.neutral?.shoulderAim || raw?.neutral, DEFAULTS.neutral),
      windup: normalizeAxes(raw?.windup?.shoulderAim || raw?.windup, DEFAULTS.windup),
      strike: normalizeAxes(raw?.strike?.shoulderAim || raw?.strike, DEFAULTS.strike),
    };
  }

  function hasAuthoredPoseAim(raw = {}) {
    return PHASES.some(phase => raw?.[phase]?.shoulderAim && typeof raw[phase].shoulderAim === 'object');
  }

  function readCheckboxState() {
    const state = defaultState();
    for (const phase of PHASES) {
      for (const axis of AXES) {
        const input = document.getElementById(checkboxId(phase, axis));
        if (input) state[phase][axis] = !!input.checked;
      }
    }
    return state;
  }

  function writeCheckboxState(state) {
    const next = normalizePoseSet(state);
    applyingState = true;
    try {
      for (const phase of PHASES) {
        for (const axis of AXES) {
          const input = document.getElementById(checkboxId(phase, axis));
          if (!input || input.checked === next[phase][axis]) continue;
          input.checked = next[phase][axis];
          // Reuse the original shoulder-control listener so its private poseAim
          // object and exported animation JSON remain the source of truth.
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      controls.syncControls?.();
      global.ProceduralHandFrameDriver?.syncNow?.();
    } finally {
      applyingState = false;
    }
  }

  function profileKeyForPreset(presetId) {
    const id = String(presetId || '');
    if (id === 'drink') return 'held:drink';
    if (id === 'crossbow_load') return 'ranged:crossbow:load';
    if (id === 'crossbow_fire') return 'ranged:crossbow:fire';
    if (id === 'scatterbow_load') return 'ranged:scatterbow:load';
    if (id === 'scatterbow_fire') return 'ranged:scatterbow:fire';
    if (id === 'bronzehoe_idle' || id === 'bronzehoe_swing') return 'melee:chop';
    if (id === 'light_weapon_idle' || id === 'pickshovel_idle' || id === 'pickshovel_swing') return 'melee:thrust';
    if (id === 'heavy_weapon_idle' || id.startsWith('hatchet_') || id.startsWith('fishingspear_') || id.startsWith('fishingmace_')) return 'melee:sweep';
    return null;
  }

  function profileState(profileKey) {
    const profile = profileKey ? global.HobunjiHandShoulderPoseProfiles?.forKey?.(profileKey) : null;
    return profile ? normalizePoseSet(profile) : defaultState();
  }

  function profileKeyForLoadedAnimation(data) {
    const name = String(data?.name || '').toLowerCase();
    if (data?.style === 'drink') return 'held:drink';
    if (/crossbow/.test(name)) return `ranged:crossbow:${/\bload\b/.test(name) ? 'load' : 'fire'}`;
    if (/scatterbow/.test(name)) return `ranged:scatterbow:${/\bload\b/.test(name) ? 'load' : 'fire'}`;
    if (data?.style === 'chop') return 'melee:chop';
    if (data?.style === 'thrust') return 'melee:thrust';
    if (data?.style === 'sweep') return 'melee:sweep';
    return null;
  }

  const parentStatus = document.getElementById('handShoulderAimStatus');
  const animationStatus = document.createElement('div');
  animationStatus.id = 'handShoulderAnimationStateStatus';
  animationStatus.className = 'help';
  animationStatus.style.marginTop = '4px';
  parentStatus?.insertAdjacentElement('afterend', animationStatus);

  function updateStatus() {
    animationStatus.textContent = `Compass set: ${activeKey}`;
  }

  function saveActiveState() {
    if (applyingState || !activeKey) return;
    cache.set(activeKey, readCheckboxState());
  }

  function switchTo(key, fallbackState) {
    saveActiveState();
    activeKey = String(key || 'draft:new-attack');
    const state = cache.has(activeKey) ? cache.get(activeKey) : normalizePoseSet(fallbackState || DEFAULTS);
    cache.set(activeKey, cloneState(state));
    writeCheckboxState(state);
    updateStatus();
  }

  // Capture runs before the editor's existing .onclick handler. That matters:
  // applyPreset() calls refreshJsonView(), whose shoulder adapter injects the
  // CURRENT checkbox state into the newly loaded animation JSON. We therefore
  // swap to the target animation's state first, before that refresh happens.
  loadPresetButton.addEventListener('click', () => {
    const presetId = presetSelect.value || 'unknown';
    switchTo(`preset:${presetId}`, profileState(profileKeyForPreset(presetId)));
  }, true);

  // Files carry their own per-pose shoulderAim metadata when authored by this
  // editor. Treat that metadata as authoritative; older files without it migrate
  // from the matching animation profile/default instead of inheriting the file
  // that happened to be open previously.
  loadFile.addEventListener('change', async () => {
    const file = loadFile.files?.[0];
    if (!file) return;
    saveActiveState();
    activeKey = `file:${file.name}`;
    updateStatus();
    try {
      const parsed = JSON.parse(await file.text());
      const state = hasAuthoredPoseAim(parsed?.poses)
        ? normalizePoseSet(parsed.poses)
        : profileState(profileKeyForLoadedAnimation(parsed));
      cache.set(activeKey, cloneState(state));
      writeCheckboxState(state);
      updateStatus();
    } catch (_) {
      const state = defaultState();
      cache.set(activeKey, cloneState(state));
      writeCheckboxState(state);
      updateStatus();
    }
  }, true);

  // Checkbox edits belong only to the currently active animation key.
  for (const phase of PHASES) {
    for (const axis of AXES) {
      document.getElementById(checkboxId(phase, axis))?.addEventListener('change', () => {
        if (!applyingState) saveActiveState();
      });
    }
  }

  cache.set(activeKey, readCheckboxState());
  updateStatus();

  global.HobunjiAttackEditorShoulderAnimationState = {
    get activeKey() { return activeKey; },
    get cachedKeys() { return [...cache.keys()]; },
    get current() { return cloneState(readCheckboxState()); },
    switchToPreset(presetId) {
      switchTo(`preset:${presetId}`, profileState(profileKeyForPreset(presetId)));
    },
  };
})(window);
