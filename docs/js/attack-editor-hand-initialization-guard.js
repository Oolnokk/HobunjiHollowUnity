// Resolves the Attack Animation Editor's initial avatar/hand context only after
// the core editor has populated its species selector. Several hand extensions load
// earlier than the module that fills that selector; choosing modelKeys()[0] during
// that gap used to show Pachyderm beside the later-default Mao-ao avatar until the
// user manually changed species.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const speciesSelect = document.getElementById('avatarSpecies');
  const genderSelect = document.getElementById('avatarGender');
  if (!profiles || !speciesSelect || global.HobunjiAttackEditorHandInitializationGuard) return;

  let resolved = false;
  let attempts = 0; // Exposed in the visible status so startup ordering can be checked without devtools.
  let lastResolution = 'waiting for species list';
  let status = null;

  function optionExists(select, value) {
    return !!select && !!value && [...select.options].some(option => option.value === value);
  }

  function ensureStatus() {
    if (status?.isConnected) return status;
    const profileSelect = document.getElementById('handProfileSelect');
    const card = profileSelect?.closest('.card');
    if (!card) return null;
    status = document.getElementById('handInitializationStatus');
    if (!status) {
      status = document.createElement('div');
      status.id = 'handInitializationStatus';
      status.className = 'help';
      status.style.cssText = 'padding:7px;border:1px solid rgba(34,211,238,.18);border-radius:8px;margin:6px 0;white-space:normal';
      const anchor = document.getElementById('handStateCoherenceStatus') || document.getElementById('handEffectiveStatus');
      if (anchor?.parentElement === card) anchor.insertAdjacentElement('afterend', status);
      else card.appendChild(status);
    }
    return status;
  }

  function renderStatus() {
    const el = ensureStatus();
    if (el) el.textContent = `Initial hand context · ${lastResolution} · attempts ${attempts}`;
  }

  function resolveContext(reason) {
    attempts += 1;
    const species = String(speciesSelect.value || '').trim();
    if (!species || speciesSelect.options.length === 0) {
      lastResolution = 'waiting for populated species selector';
      renderStatus();
      return false;
    }

    const mapped = String(profiles.modelKeyForSpecies?.(species) || '').trim();
    if (!mapped) {
      lastResolution = `${species} has no mapped hand model`;
      renderStatus();
      return false;
    }

    const profileSelect = document.getElementById('handProfileSelect');
    const speciesModelSelect = document.getElementById('handSpeciesModelSelect');
    if (!optionExists(profileSelect, mapped) || !optionExists(speciesModelSelect, mapped)) {
      lastResolution = `${species}→${mapped}, waiting for hand model menus`;
      renderStatus();
      return false;
    }

    // The populated avatar species is authoritative. These assignments only sync
    // editor selection state; they do NOT mutate the user's speciesModels mapping.
    speciesModelSelect.value = mapped;
    profileSelect.value = mapped;
    profileSelect.dispatchEvent(new Event('change', { bubbles: true }));

    global.HobunjiAttackEditorDirectHandAttachments?.syncFields?.();
    global.HobunjiAttackEditorHandStateCoherence?.updateStatus?.();
    global.ProceduralHandFrameDriver?.syncNow?.();

    resolved = true;
    lastResolution = `${species}/${String(genderSelect?.value || 'male')} → ${mapped} (${reason || 'startup'})`;
    renderStatus();
    return true;
  }

  function settleInitialContext() {
    if (resolveContext('startup')) return;
    global.requestAnimationFrame(settleInitialContext);
  }

  speciesSelect.addEventListener('change', () => setTimeout(() => resolveContext('species change'), 0));
  genderSelect?.addEventListener('change', () => setTimeout(() => resolveContext('gender change'), 0));

  global.HobunjiAttackEditorHandInitializationGuard = Object.freeze({
    resolveContext,
    get resolved() { return resolved; },
    get attempts() { return attempts; },
    get lastResolution() { return lastResolution; },
  });

  renderStatus();
  global.requestAnimationFrame(settleInitialContext);
})(window);
