// Keeps the Attack Animation Editor's hand context synchronized without owning
// a second copy of model/tool/grip state. The current species mapping is the only
// editable hand-model selection; all other hand modules read that same source.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const gripModes = global.HobunjiHandGripModes;
  const frameDriver = global.ProceduralHandFrameDriver;
  const speciesSelect = document.getElementById('avatarSpecies');
  const genderSelect = document.getElementById('avatarGender');
  const profileSelect = document.getElementById('handProfileSelect');
  const toolSelect = document.getElementById('toolSpriteSelect');
  if (!profiles || !speciesSelect || !profileSelect || !toolSelect) return;
  if (global.HobunjiAttackEditorHandStateCoherence) return;

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

  function mappedModelKey() {
    return String(profiles.modelKeyForSpecies?.(speciesSelect.value) || '');
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

  function updateStatus() {
    if (!status) return;
    const species = String(speciesSelect.value || '-');
    const model = mappedModelKey() || '-';
    const tool = String(toolSelect.value || '-');
    const mode = gripModes?.currentModeKey?.() || '-';
    const debug = currentRigDebug();
    const shoulder = debug?.hand?.shoulderCompass?.sides?.right || null;
    const shoulderText = shoulder?.applied
      ? 'shoulder-follow active'
      : `shoulder-follow ${shoulder?.reason || 'off/pending'}`;
    status.textContent = `Context #${syncSerial} (${lastReason}) · ${species} → model ${model} · tool ${tool} · grip ${mode} · ${shoulderText}`;
    status.style.color = profileSelect.value && profileSelect.value !== model ? '#fb7185' : '';
  }

  function syncSpeciesContext(reason) {
    const mapped = mappedModelKey();
    if (mapped && [...profileSelect.options].some(option => option.value === mapped)) profileSelect.value = mapped;
    global.HobunjiAttackEditorHandCalibration?.refresh?.();
    global.HobunjiAttackEditorDirectHandAttachments?.syncFields?.();
    frameDriver?.syncNow?.();
    syncSerial += 1;
    lastReason = reason || 'species context';
    updateStatus();
  }

  function syncToolContext(reason) {
    global.HobunjiAttackEditorHandGripMode?.syncForTool?.();
    global.HobunjiAttackEditorDirectHandAttachments?.syncFields?.();
    frameDriver?.syncNow?.();
    syncSerial += 1;
    lastReason = reason || 'tool context';
    updateStatus();
  }

  speciesSelect.addEventListener('change', () => setTimeout(() => syncSpeciesContext('species changed'), 0));
  genderSelect?.addEventListener('change', () => setTimeout(() => syncSpeciesContext('gender changed'), 0));
  profileSelect.addEventListener('change', () => setTimeout(() => syncSpeciesContext('species model changed'), 0));
  toolSelect.addEventListener('change', () => setTimeout(() => syncToolContext('tool changed'), 0));

  profiles.subscribe?.((_data, change) => {
    if (change?.kind === 'model-mapping' || change?.kind === 'replace') syncSpeciesContext(change.kind);
    else updateStatus();
  });
  gripModes?.subscribe?.(() => updateStatus());

  setTimeout(() => syncSpeciesContext('initial species context'), 0);

  global.HobunjiAttackEditorHandStateCoherence = Object.freeze({
    syncSpeciesContext,
    syncToolContext,
    updateStatus,
    get statusText() { return status?.textContent || ''; },
  });
})(window);
