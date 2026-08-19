// Keeps the Attack Animation Editor's hand authoring context coherent and exposes
// a mobile-readable summary of the separated hand / forearm / bicep authorities.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const gripModes = global.HobunjiHandGripModes;
  const frameDriver = global.ProceduralHandFrameDriver;
  const settings = global.HobunjiHandExperimentalRigSettings;
  const speciesSelect = document.getElementById('avatarSpecies');
  const genderSelect = document.getElementById('avatarGender');
  const profileSelect = document.getElementById('handProfileSelect');
  const speciesModelSelect = document.getElementById('handSpeciesModelSelect');
  const toolSelect = document.getElementById('toolSpriteSelect');
  const presetButton = document.getElementById('loadPresetBtn');
  if (!profiles || !speciesSelect || !profileSelect || !speciesModelSelect || !toolSelect) return;
  if (global.HobunjiAttackEditorHandStateCoherence) return;

  let presetToolBeforeClick = toolSelect.value;
  let syncSerial = 0;
  let lastReason = 'initial';

  const handCard = profileSelect.closest('.card');
  const status = document.createElement('div');
  status.id = 'handStateCoherenceStatus';
  status.className = 'help';
  status.style.cssText = 'padding:7px;border:1px solid rgba(34,211,238,.22);border-radius:8px;margin:6px 0;white-space:normal';
  const insertionPoint = document.getElementById('handInverseLiveStatus') || document.getElementById('handEffectiveStatus');
  if (insertionPoint?.parentElement === handCard) insertionPoint.insertAdjacentElement('afterend', status);
  else handCard?.appendChild(status);

  for (const id of [
    'handGripPos_x', 'handGripPos_y', 'handGripPos_z',
    'handGripPos_x_n', 'handGripPos_y_n', 'handGripPos_z_n',
    'handGripRot_pitch', 'handGripRot_yaw', 'handGripRot_roll',
    'handGripRot_pitch_n', 'handGripRot_yaw_n', 'handGripRot_roll_n',
  ]) {
    const input = document.getElementById(id);
    if (input) input.disabled = true;
  }

  function mappedModelKey() { return String(profiles.modelKeyForSpecies?.(speciesSelect.value) || ''); }
  function optionExists(select, value) { return !!value && [...select.options].some(option => option.value === value); }
  function dispatchProfileRefresh() { profileSelect.dispatchEvent(new Event('change', { bubbles: true })); }

  function syncSpeciesModelContext(reason) {
    const mapped = mappedModelKey();
    if (mapped && optionExists(speciesModelSelect, mapped)) speciesModelSelect.value = mapped;
    if (mapped && optionExists(profileSelect, mapped)) profileSelect.value = mapped;
    dispatchProfileRefresh();
    frameDriver?.syncNow?.();
    syncSerial += 1;
    lastReason = reason || 'species-model';
    updateStatus();
  }

  function currentRigDebug() {
    const species = String(speciesSelect.value || '');
    const gender = String(genderSelect?.value || 'male');
    const rows = frameDriver?.getDebug?.() || [];
    return rows.find(row => row?.speciesId === species && row?.gender === gender)
      || rows.find(row => row?.speciesId === species)
      || rows[0]
      || null;
  }
  function fmt(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : '-';
  }

  function updateStatus() {
    if (!status) return;
    const species = String(speciesSelect.value || '-');
    const mapped = mappedModelKey() || '-';
    const selected = String(profileSelect.value || '-');
    const tool = String(toolSelect.value || '-');
    const mode = gripModes?.currentModeKey?.() || '-';
    const hand = currentRigDebug()?.hand || null;
    const compass = hand?.shoulderCompass || null;
    const target = compass?.sides?.right || null;
    const skin = hand?.twoBoneSkin?.sides?.right || null;
    const mismatch = mapped !== '-' && selected !== mapped;
    const axis = skin?.axisWeights || target?.axisWeights || null;
    const axisText = axis
      ? `P/Y/R ${fmt((axis.pitch || 0) * 100, 0)}/${fmt((axis.yaw || 0) * 100, 0)}/${fmt((axis.roll || 0) * 100, 0)}%`
      : 'P/Y/R -';
    const rigText = skin?.rigged
      ? `hand=grip · forearm→${target?.targetKind || skin.targetKind || 'shoulder'} ${axisText} residual ${fmt(target?.residualDeg ?? skin.residualDeg, 2)}°${target?.bicepResidualDeg != null ? ` · bicep→elbow ${fmt(target.bicepResidualDeg, 2)}°` : ''}`
      : `forearm ${target?.reason || compass?.scanState || 'pending'}`;
    const experiments = `axisExp=${settings?.forearmAxisTracking !== false ? 'ON' : 'OFF'} · bicepExp=${settings?.bicepElbowTracking === true ? 'ON' : 'OFF'}`;
    status.textContent = `Context #${syncSerial} (${lastReason}) · ${species} → ${mapped}${mismatch ? ` [editing ${selected}]` : ''} · tool ${tool} · grip ${mode} · ${experiments} · ${rigText}`;
    status.style.color = mismatch ? '#fbbf24' : '';
  }

  function syncHandToolContext(reason) {
    global.HobunjiAttackEditorHandGripMode?.syncForTool?.();
    global.HobunjiAttackEditorDirectHandAttachments?.syncFields?.();
    global.ProceduralHandTwoBoneSkin?.refreshAll?.();
    frameDriver?.syncNow?.();
    syncSerial += 1;
    lastReason = reason || 'tool context';
    updateStatus();
  }

  speciesSelect.addEventListener('change', () => setTimeout(() => syncSpeciesModelContext('species changed'), 0));
  genderSelect?.addEventListener('change', () => setTimeout(() => {
    frameDriver?.syncNow?.();
    lastReason = 'gender changed';
    updateStatus();
  }, 0));

  speciesModelSelect.addEventListener('change', () => setTimeout(() => {
    const mapped = String(speciesModelSelect.value || mappedModelKey());
    if (mapped && optionExists(profileSelect, mapped)) profileSelect.value = mapped;
    dispatchProfileRefresh();
    frameDriver?.syncNow?.();
    syncSerial += 1;
    lastReason = 'species model remapped';
    updateStatus();
  }, 0));

  profileSelect.addEventListener('change', () => {
    lastReason = 'model profile selected';
    updateStatus();
  });
  toolSelect.addEventListener('change', () => setTimeout(() => {
    frameDriver?.syncNow?.();
    syncSerial += 1;
    lastReason = 'tool changed';
    updateStatus();
  }, 0));

  if (presetButton) {
    presetButton.addEventListener('click', () => {
      presetToolBeforeClick = toolSelect.value;
      setTimeout(() => {
        if (toolSelect.value !== presetToolBeforeClick) syncHandToolContext('preset changed tool');
        else {
          global.ProceduralHandTwoBoneSkin?.refreshAll?.();
          frameDriver?.syncNow?.();
          lastReason = 'preset same tool';
          updateStatus();
        }
      }, 0);
    }, true);
  }

  profiles.subscribe?.(() => setTimeout(updateStatus, 0));
  settings?.subscribe?.(() => setTimeout(() => {
    syncSerial += 1;
    lastReason = 'experimental toggle';
    updateStatus();
  }, 0));
  setInterval(updateStatus, 350);
  setTimeout(() => syncSpeciesModelContext('initial species context'), 0);

  global.HobunjiAttackEditorHandStateCoherence = Object.freeze({
    syncSpeciesModelContext,
    syncHandToolContext,
    updateStatus,
    get statusText() { return status?.textContent || ''; },
  });
})(window);
