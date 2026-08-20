// Keeps Attack Editor weapon-idle previews on the same hand/stance path as gameplay.
//
// The editor normally derives shoulder-compass weights from the attack timeline.
// That is correct while previewing an attack, but wrong while the separate Idle
// Stances UI is showing a resting Heavy/Light weapon pose: gameplay uses the fixed
// idle hand weights there. This adapter also re-reads the Idle Stance editor's
// current config when loading the legacy Heavy/Light still presets, preventing a
// stale hard-coded preset literal from disagreeing with the game/local override.
(function (global) {
  'use strict';

  const poseRuntime = global.HobunjiHandShoulderPoseRuntime; // Supplies the same idle weights used by gameplay.
  let idlePreviewActive = false; // Read by the wrapped shoulder controls while a weapon-idle pose is being previewed.
  let controlsPatched = false; // Prevents wrapping the editor shoulder controls more than once.
  let listenersInstalled = false; // Prevents duplicate DOM listeners while the adapter waits for late editor controls.
  let suppressTimelineClear = false; // Keeps our own forced Neutral scrub from immediately cancelling idle-preview mode.

  const STANCE_BY_PRESET = Object.freeze({
    heavy_weapon_idle: 'heavyWeapon',
    light_weapon_idle: 'lightWeapon',
  }); // Maps legacy still-preset IDs to the shared idle-stance config keys.
  const POSE_KEYS = Object.freeze(['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw']); // Copied into all three still-preset phases below.
  const FALLBACK_STANCES = Object.freeze({
    heavyWeapon: Object.freeze({ x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: -15, roll: -82 }),
    lightWeapon: Object.freeze({ x: 0.04, y: 0, z: 0, pitch: 20, yaw: -70, bodyYaw: -40, roll: -65 }),
  }); // Used only if the shared Idle Stance editor has not finished loading yet.

  function idleWeights() {
    const runtimeIdle = poseRuntime?.idle || { pitch: 1, yaw: 0, roll: 1 }; // Returned during resting-stance previews to match gameplay exactly.
    return { pitch: Number(runtimeIdle.pitch) || 0, yaw: Number(runtimeIdle.yaw) || 0, roll: Number(runtimeIdle.roll) || 0 };
  }

  function syncHands() {
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function forceNeutralScrub() {
    const button = document.getElementById('scrubNeutralBtn'); // Uses the editor's own scrub function so previewT and marker stay in sync.
    suppressTimelineClear = true;
    try { button?.click(); }
    finally { queueMicrotask(() => { suppressTimelineClear = false; }); }
  }

  function setIdlePreview(active) {
    idlePreviewActive = !!active;
    if (idlePreviewActive) forceNeutralScrub();
    syncHands();
  }

  function currentSharedStance(stanceKey) {
    const editorConfig = global.AttackIdleStanceEditor?.getConfig?.(); // Preferred because it includes the same Local Override the game reads.
    return editorConfig?.stances?.[stanceKey] || FALLBACK_STANCES[stanceKey] || null;
  }

  function writeStillPoseFromSharedConfig(presetId) {
    const stanceKey = STANCE_BY_PRESET[presetId]; // Selects Heavy/Light config for the legacy still preset that was just loaded.
    const pose = stanceKey ? currentSharedStance(stanceKey) : null; // Applied below to Neutral/Windup/Strike so a still pose cannot interpolate away.
    if (!pose) return false;

    for (const phase of ['neutral', 'windup', 'strike']) {
      for (const key of POSE_KEYS) {
        const input = document.getElementById(`${phase}_${key}`); // Existing core pose input; dispatching input updates the module-scoped animation data too.
        const value = Number(pose[key]); // Validated before replacing the field so malformed local data cannot poison the preview.
        if (!input || !Number.isFinite(value)) continue;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return true;
  }

  function patchShoulderControls() {
    const controls = global.HobunjiAttackEditorHandShoulderControls; // Existing per-pose shoulder UI installed by attack-editor-hand-shoulder-controls.js.
    if (!controls || controlsPatched) return false;
    const originalCurrentWeights = controls.currentWeights?.bind(controls); // Retained for all normal attack playback/scrubbing.
    if (!originalCurrentWeights) return false;

    controls.currentWeights = function idleParityCurrentWeights() {
      return idlePreviewActive ? idleWeights() : originalCurrentWeights();
    };
    controlsPatched = true;
    return true;
  }

  function installListeners() {
    if (listenersInstalled) return true;
    const loadPreset = document.getElementById('loadPresetBtn'); // Legacy preset loader patched below after its own click handler runs.
    const presetSelect = document.getElementById('presetSelect'); // Tells us whether Heavy/Light still is the requested legacy preset.
    const idleEdit = document.getElementById('idleEditNeutralBtn'); // Separate Idle Stances editor toggle; active means it must look like gameplay idle.
    const idlePreview = document.getElementById('idlePreviewBtn'); // One-shot Idle Stances preview also needs gameplay idle hand weights.
    const scrub = document.getElementById('scrub'); // Any manual timeline motion returns ownership to attack-pose shoulder weights.
    const play = document.getElementById('playPauseBtn'); // Playing the attack exits the special resting-stance preview.
    if (!loadPreset || !presetSelect || !scrub || !play) return false;

    loadPreset.addEventListener('click', () => {
      const presetId = presetSelect.value; // Captured before the deferred parity pass below.
      const stanceKey = STANCE_BY_PRESET[presetId]; // Non-weapon-idle presets should use ordinary attack shoulder behavior.
      if (!stanceKey) {
        setIdlePreview(false);
        return;
      }
      setTimeout(() => {
        writeStillPoseFromSharedConfig(presetId);
        setIdlePreview(true);
      }, 0);
    });

    presetSelect.addEventListener('change', () => setIdlePreview(false));
    idleEdit?.addEventListener('click', () => {
      setTimeout(() => setIdlePreview(idleEdit.classList.contains('active')), 0);
    });
    idlePreview?.addEventListener('click', () => setTimeout(() => setIdlePreview(true), 0));

    const clearForTimeline = () => {
      if (!suppressTimelineClear) setIdlePreview(false);
    }; // Shared by timeline controls that mean the user has resumed attack previewing.
    scrub.addEventListener('input', clearForTimeline);
    play.addEventListener('click', clearForTimeline);
    document.getElementById('scrubWindupBtn')?.addEventListener('click', clearForTimeline);
    document.getElementById('scrubStrikeBtn')?.addEventListener('click', clearForTimeline);
    document.getElementById('scrubNeutralBtn')?.addEventListener('click', clearForTimeline);

    listenersInstalled = true;
    return true;
  }

  function boot() {
    patchShoulderControls();
    installListeners();
    if (!controlsPatched || !listenersInstalled) global.requestAnimationFrame(boot);
  }
  boot();

  global.HobunjiAttackEditorIdleHandParity = {
    get active() { return idlePreviewActive; },
    forcePreview(presetId) {
      if (STANCE_BY_PRESET[presetId]) writeStillPoseFromSharedConfig(presetId);
      setIdlePreview(true);
    },
    clear() { setIdlePreview(false); },
    getDebug() {
      return {
        active: idlePreviewActive,
        shoulderWeights: idlePreviewActive ? idleWeights() : null,
        controlsPatched,
        listenersInstalled,
      };
    },
  };
})(window);
