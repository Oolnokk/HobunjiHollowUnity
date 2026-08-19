// Keeps the Attack Animation Editor's hand authoring context coherent.
//
// Several older adapters intentionally own separate pieces of the UI. This bridge
// only synchronizes their public controls/events so changing species, model mapping,
// or a preset cannot leave a hidden previous model/tool/grip mode active.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles; // Resolves the model actually used by the currently previewed species.
  const gripModes = global.HobunjiHandGripModes; // Supplies the live grip-mode key/default shown in the diagnostic below.
  const frameDriver = global.ProceduralHandFrameDriver; // Forces a hand-frame refresh after context changes.
  const speciesSelect = document.getElementById('avatarSpecies'); // Drives model-profile selection when the preview species changes.
  const genderSelect = document.getElementById('avatarGender'); // Identifies the exact live rig used by the mobile-visible diagnostic.
  const profileSelect = document.getElementById('handProfileSelect'); // Must always refresh dependent handFromTool/mirror controls when changed programmatically.
  const speciesModelSelect = document.getElementById('handSpeciesModelSelect'); // Maps the current species to a reusable hand model.
  const toolSelect = document.getElementById('toolSpriteSelect'); // Drives grip-mode and secondary-grip context.
  const presetButton = document.getElementById('loadPresetBtn'); // Core preset loading changes toolSelect.value without dispatching change.
  if (!profiles || !speciesSelect || !profileSelect || !speciesModelSelect || !toolSelect) return;
  if (global.HobunjiAttackEditorHandStateCoherence) return;

  let presetToolBeforeClick = toolSelect.value; // Captures tool context before the core preset onclick mutates it.
  let syncSerial = 0; // Increments for the visible diagnostic so repeated synchronization is obvious on mobile.
  let lastReason = 'initial'; // Records which context transition most recently forced a coherent refresh.

  const handCard = profileSelect.closest('.card'); // Hosts the diagnostic beside the hand controls it describes.
  const status = document.createElement('div'); // Surfaces context/rotation state without requiring browser devtools.
  status.id = 'handStateCoherenceStatus';
  status.className = 'help';
  status.style.cssText = 'padding:7px;border:1px solid rgba(34,211,238,.22);border-radius:8px;margin:6px 0;white-space:normal';
  const insertionPoint = document.getElementById('handInverseLiveStatus') || document.getElementById('handEffectiveStatus'); // Keeps diagnostics near the active direct-hand fields.
  if (insertionPoint?.parentElement === handCard) insertionPoint.insertAdjacentElement('afterend', status);
  else handCard?.appendChild(status);

  // Legacy toolGrip controls are kept in the older configurator only as bootstrap
  // scaffolding. The runtime source of truth is handFromTool; disabling the hidden
  // inputs prevents synthetic/autofill input from ever mutating the dead identity frame.
  for (const id of [
    'handGripPos_x', 'handGripPos_y', 'handGripPos_z',
    'handGripPos_x_n', 'handGripPos_y_n', 'handGripPos_z_n',
    'handGripRot_pitch', 'handGripRot_yaw', 'handGripRot_roll',
    'handGripRot_pitch_n', 'handGripRot_yaw_n', 'handGripRot_roll_n',
  ]) {
    const input = document.getElementById(id); // Marks each superseded control as inert even though its group is already hidden.
    if (input) input.disabled = true;
  }

  function mappedModelKey() {
    return String(profiles.modelKeyForSpecies?.(speciesSelect.value) || '');
  }

  function optionExists(select, value) {
    return !!value && [...select.options].some(option => option.value === value);
  }

  function dispatchProfileRefresh() {
    // Existing inverse/mirror adapters already listen to this public event. Reuse
    // that path instead of reaching into their private sync functions.
    profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function syncSpeciesModelContext(reason) {
    const mapped = mappedModelKey(); // Becomes the profile edited immediately after a species/context transition.
    if (mapped && optionExists(speciesModelSelect, mapped)) speciesModelSelect.value = mapped;
    if (mapped && optionExists(profileSelect, mapped)) profileSelect.value = mapped;
    dispatchProfileRefresh();
    frameDriver?.syncNow?.();
    syncSerial += 1;
    lastReason = reason || 'species-model';
    updateStatus();
  }

  function currentRigDebug() {
    const species = String(speciesSelect.value || ''); // Narrows the status to the previewed species instead of whichever rig happened to attach first.
    const gender = String(genderSelect?.value || 'male'); // Narrows the status to the previewed gender when both variants are present.
    const rows = frameDriver?.getDebug?.() || []; // Supplies authored/effective shoulder-quaternion diagnostics from the live rig.
    return rows.find(row => row?.speciesId === species && row?.gender === gender)
      || rows.find(row => row?.speciesId === species)
      || rows[0]
      || null;
  }

  function fmt(value, digits = 1) {
    const number = Number(value); // Normalizes optional debug values for compact mobile text.
    return Number.isFinite(number) ? number.toFixed(digits) : '-';
  }

  function updateStatus() {
    if (!status) return;
    const species = String(speciesSelect.value || '-'); // Shown so screenshots/debug copies retain the active preview context.
    const mapped = mappedModelKey() || '-'; // Shows the profile the species actually uses at runtime.
    const selected = String(profileSelect.value || '-'); // Detects a deliberate/manual cross-model edit versus accidental stale state.
    const tool = String(toolSelect.value || '-'); // Shows the tool whose grip-mode/secondary frame is active.
    const mode = gripModes?.currentModeKey?.() || '-'; // Shows the effective reusable grip mode after tool/preset synchronization.
    const debug = currentRigDebug(); // Provides the right-hand shoulder correction generated from this exact context.
    const compass = debug?.hand?.shoulderCompass || null; // Exposes the quaternion-native compass implementation/mode.
    const right = compass?.sides?.right || null; // Right hand follows the primary tool socket in the direct-hand driver.
    const applied = right?.appliedRotationVectorDeg || null; // Shows parent-space P/Y/R rotation-vector components instead of unstable Euler decomposition.
    const mismatch = mapped !== '-' && selected !== mapped; // A mismatch is allowed only when the user intentionally picked another model profile.
    const shoulderText = right?.applied
      ? `shoulder Δrv ${fmt(applied?.pitch)}/${fmt(applied?.yaw)}/${fmt(applied?.roll)}° · residual ${fmt(right?.residualDeg)}°`
      : `shoulder ${right?.reason || compass?.scanState || 'pending'}`;
    status.textContent = `Context #${syncSerial} (${lastReason}) · ${species} → model ${mapped}${mismatch ? ` [editing ${selected}]` : ''} · tool ${tool} · grip ${mode} · ${shoulderText}`;
    status.style.color = mismatch ? '#fbbf24' : '';
  }

  // The older configurator schedules its own species refresh with setTimeout(0) and
  // preserves the previous profile by design. Schedule ours afterward so the new
  // species becomes the editor target, while a later manual profile pick still works.
  speciesSelect.addEventListener('change', () => {
    setTimeout(() => syncSpeciesModelContext('species changed'), 0);
  });

  genderSelect?.addEventListener('change', () => {
    setTimeout(() => {
      frameDriver?.syncNow?.();
      lastReason = 'gender changed';
      updateStatus();
    }, 0);
  });

  // Mapping changes set profileSelect.value in the legacy configurator but do not
  // emit change, which leaves handFromTool and mirror controls showing the old model.
  speciesModelSelect.addEventListener('change', () => {
    setTimeout(() => {
      const mapped = String(speciesModelSelect.value || mappedModelKey()); // Uses the newly committed mapping after the older handler runs.
      if (mapped && optionExists(profileSelect, mapped)) profileSelect.value = mapped;
      dispatchProfileRefresh();
      frameDriver?.syncNow?.();
      syncSerial += 1;
      lastReason = 'species model remapped';
      updateStatus();
    }, 0);
  });

  profileSelect.addEventListener('change', () => {
    lastReason = 'model profile selected';
    updateStatus();
  });

  toolSelect.addEventListener('change', () => {
    setTimeout(() => {
      frameDriver?.syncNow?.();
      syncSerial += 1;
      lastReason = 'tool changed';
      updateStatus();
    }, 0);
  });

  if (presetButton) {
    presetButton.addEventListener('click', () => {
      presetToolBeforeClick = toolSelect.value;
      // Core applyPreset runs later in the target/bubble phase. If it swaps the
      // selector programmatically, replay the selector's normal public change path
      // so grip-mode and secondary-grip adapters receive exactly the same update as
      // a manual tool change.
      setTimeout(() => {
        if (toolSelect.value !== presetToolBeforeClick) {
          toolSelect.dispatchEvent(new Event('change', { bubbles: true }));
          lastReason = 'preset changed tool';
        } else {
          frameDriver?.syncNow?.();
          lastReason = 'preset same tool';
          updateStatus();
        }
      }, 0);
    }, true);
  }

  profiles.subscribe?.(() => setTimeout(updateStatus, 0));
  setInterval(updateStatus, 400); // Keeps async shoulder scans/playback weights visible on mobile without console access.

  // Initial state should follow the previewed species rather than whichever model a
  // persisted editor draft happened to leave selected in an earlier session.
  setTimeout(() => syncSpeciesModelContext('initial species context'), 0);

  global.HobunjiAttackEditorHandStateCoherence = Object.freeze({
    syncSpeciesModelContext,
    updateStatus,
    get statusText() { return status?.textContent || ''; },
  });
})(window);
