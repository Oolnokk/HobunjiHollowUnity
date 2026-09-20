// Hand-model socket configurator injected into the existing Attack Animation
// Editor without modifying its large inline Three.js module. Edits the shared
// hobunji_hand_model_profiles.v1 data live while the procedural hand rig renders
// in the same preview scene.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles; // Owns reusable model profiles, species mapping and scale inheritance.
  const hands = global.ProceduralArmAnimation; // Refreshes live preview rigs and toggles authoring guides.
  if (!profiles || !hands || !document.getElementById('avatarSpecies')) return;

  try { profiles.loadLocal(); } catch (_) { /* A malformed local draft should never block the editor itself. */ }

  const avatarCard = document.getElementById('avatarSpecies')?.closest('.card'); // Places hand controls beside the existing species/gender chooser.
  const card = document.createElement('div'); // Becomes the self-contained hand-model authoring panel.
  card.className = 'card section';
  card.style.setProperty('--sec', '#22d3ee');
  card.style.setProperty('--secBg', 'rgba(34,211,238,.10)');
  card.innerHTML = `
    <div class="sectionTitle"><b>3D Hand Model</b><span class="sectionTag">usage / calibration</span></div>

    <div class="field"><label>Current species hand model</label><select id="handProfileSelect"></select>
      <div class="help">This is both the rendered model and the model being edited.</div>
    </div>

    <div class="poseTabs" id="handModelTabs" role="tablist" aria-label="3D hand workflow">
      <button id="handModelUsageTab" class="poseTab active" type="button">In animation</button>
      <button id="handModelCalibrationTab" class="poseTab" type="button">Calibrate GLB</button>
    </div>

    <div id="handModelUsagePane">
      <div class="help" style="margin-bottom:8px">Normal animation preview: weapon target, Grip Mode, attack pose, shoulder-follow, and species/gender anatomy are all visible here.</div>

      <div class="poseGroup">
        <div class="poseGroupHead"><span class="dot" style="background:#22d3ee"></span>Model-tied scale</div>
        <div class="field"><label>Model scale</label><div class="fieldRow">
          <input id="handModelScale" type="range" min="0.05" max="5" step="0.01">
          <input id="handModelScaleNumber" type="number" min="0.05" max="20" step="0.01" style="width:78px;flex:0 0 78px">
        </div></div>
        <div class="help">Correct this GLB once. Every species that uses the model inherits it before its own species multiplier is applied.</div>
      </div>

      <div class="poseGroup">
        <div class="poseGroupHead"><span class="dot" style="background:#a78bfa"></span>Current species/gender scale</div>
        <div class="field"><label id="handSpeciesScaleLabel">Species scale</label><div class="fieldRow">
          <input id="handSpeciesScale" type="range" min="0.1" max="3" step="0.01">
          <input id="handSpeciesScaleNumber" type="number" min="0.05" max="10" step="0.01" style="width:78px;flex:0 0 78px">
        </div></div>
        <div class="row"><button id="handClearSpeciesScale" class="secondary" style="font-size:11px">↩ Inherit foot scale</button></div>
        <div class="help" id="handSpeciesScaleSource"></div>
      </div>

      <div class="field"><label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handShowGripGuide" checked style="width:auto;margin-right:6px">Show hand-model origin / grip-target guides</label>
        <div class="help">These guides belong to the normal weapon/animation preview and are disabled in GLB calibration mode.</div>
      </div>
    </div>

    <div id="handModelCalibrationPane" style="display:none">
      <div class="help" style="padding:8px;border:1px solid rgba(34,211,238,.25);border-radius:9px;margin-bottom:8px"><b>Calibration-only preview.</b> The selected GLB is overlaid on one neutrally oriented paper hand at a fixed world frame. No attack animation, tool transform, Grip Mode, shoulder targeting, character-facing rotation, or animation-derived hand transform is allowed to affect either reference. Only this GLB's own calibration moves the real hand.</div>
      <div id="handCalibrationWorkspaceMount"></div>
    </div>

    <div class="help" id="handEffectiveStatus" style="padding:7px;border:1px solid rgba(255,255,255,.1);border-radius:8px;margin-bottom:8px"></div>
    <div class="row">
      <button id="handSaveLocal" class="good">💾 Save local draft</button>
      <button id="handDownloadConfig" class="secondary">⭳ Download config</button>
      <button id="handCopyConfig" class="secondary">Copy JSON</button>
    </div>
    <div class="row" style="margin-top:6px">
      <button id="handImportConfig" class="secondary">Import JSON</button>
      <input id="handImportFile" type="file" accept="application/json,.json" style="display:none">
      <button id="handResetConfig" class="warn">Reset source defaults</button>
    </div>
    <div class="help" id="handSaveStatus" style="margin-top:7px">Changes update the preview live; download <code>hand-model-profiles.json</code> to reuse the authored model sockets.</div>
  `;
  avatarCard?.insertAdjacentElement('afterend', card);

  const $ = id => document.getElementById(id);
  const profileSelect = $('handProfileSelect'); // Single source of truth: rendered model + edited model for the current species.
  const modelScaleRange = $('handModelScale'); // Edits the model-tied multiplier with touch-friendly dragging.
  const modelScaleNumber = $('handModelScaleNumber'); // Allows precise model-scale entry beside the slider.
  const speciesScaleRange = $('handSpeciesScale'); // Edits the current species/gender anatomy multiplier.
  const speciesScaleNumber = $('handSpeciesScaleNumber'); // Allows precise species-scale entry beside the slider.
  const saveStatus = $('handSaveStatus'); // Surfaces save/import errors directly in the editor for mobile users.
  const usageTab = $('handModelUsageTab'); // Switches back to the full animation/weapon hand preview.
  const calibrationTab = $('handModelCalibrationTab'); // Enters the isolated GLB↔paper-hand alignment workflow.
  const usagePane = $('handModelUsagePane'); // Normal hand usage controls shown outside calibration mode.
  const calibrationPane = $('handModelCalibrationPane'); // Contains only model-calibration controls and diagnostics.
  let calibrationModeActive = false; // Read by ProceduralHandFrameDriver to bypass every animation/tool/shoulder transform.
  const calibrationModeListeners = new Set(); // Lets late-loaded editor extensions react without polling.

  function notifyCalibrationMode() {
    for (const listener of calibrationModeListeners) { try { listener(calibrationModeActive); } catch (_) {} }
    global.HobunjiAttackEditorToolContext?.setHandCalibrationPresentation?.(calibrationModeActive);
    if (calibrationModeActive) {
      hands.setShowGripGuides?.(false);
      hands.setShowPaperHandGuide?.(true);
    } else {
      hands.setShowGripGuides?.(!!$('handShowGripGuide')?.checked);
      hands.setShowPaperHandGuide?.(!!$('handShowPaperHandGuide')?.checked);
    }
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function setCalibrationMode(active) {
    calibrationModeActive = !!active;
    usageTab?.classList.toggle('active', !calibrationModeActive);
    calibrationTab?.classList.toggle('active', calibrationModeActive);
    if (usagePane) usagePane.style.display = calibrationModeActive ? 'none' : '';
    if (calibrationPane) calibrationPane.style.display = calibrationModeActive ? '' : 'none';
    notifyCalibrationMode();
  }

  usageTab?.addEventListener('click', () => setCalibrationMode(false));
  calibrationTab?.addEventListener('click', () => setCalibrationMode(true));

  function currentSpecies() { return String($('avatarSpecies')?.value || '').trim(); }
  function currentGender() { return String($('avatarGender')?.value || 'male').trim(); }
  function modelKeys() { return Object.keys(profiles.data.models || {}); }
  function currentModelKey() { return profileSelect.value || modelKeys()[0] || ''; }
  function currentModel() { return profiles.data.models?.[currentModelKey()] || null; }

  function setStatus(message, isError) {
    saveStatus.textContent = message;
    saveStatus.style.color = isError ? '#fb7185' : '';
  }

  function fillModelSelects() {
    const keys = modelKeys();
    profileSelect.innerHTML = keys.map(key => `<option value="${key}">${key}</option>`).join('');
    const mapped = profiles.modelKeyForSpecies(currentSpecies());
    profileSelect.value = keys.includes(mapped) ? mapped : keys[0] || '';
  }

  function authoredSpeciesScaleEntry(species, gender) {
    const exact = profiles.data.speciesScaleOverrides?.[species]?.[gender]; // Distinguishes an authored hand override from inherited foot/default scale.
    const number = Number(exact);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function syncModelFields() {
    const model = currentModel();
    if (!model) return;
    const modelScale = Number(model.scale) > 0 ? Number(model.scale) : 1;
    modelScaleRange.value = Math.min(Number(modelScaleRange.max), modelScale);
    modelScaleNumber.value = modelScale;
  }

  function syncSpeciesFields() {
    const species = currentSpecies();
    const gender = currentGender();
    const authored = authoredSpeciesScaleEntry(species, gender);
    const inherited = profiles.footScaleFor(species, gender);
    const effectiveSpeciesScale = authored ?? inherited;
    speciesScaleRange.value = Math.min(Number(speciesScaleRange.max), effectiveSpeciesScale);
    speciesScaleNumber.value = effectiveSpeciesScale;
    $('handSpeciesScaleLabel').textContent = `${species || 'species'} / ${gender} scale`;
    $('handSpeciesScaleSource').textContent = authored == null
      ? `Inherited from procedural feet: ${inherited.toFixed(3)}. Changing the slider creates a hand-specific override.`
      : `Hand-specific override: ${authored.toFixed(3)} (foot fallback would be ${inherited.toFixed(3)}).`;
    const mapped = profiles.modelKeyForSpecies(species);
    if (mapped && [...profileSelect.options].some(option => option.value === mapped) && profileSelect.value !== mapped) profileSelect.value = mapped;
  }

  function refreshEffectiveStatus() {
    const species = currentSpecies();
    const gender = currentGender();
    const mappedKey = profiles.modelKeyForSpecies(species);
    const modelScale = Number(profiles.data.models?.[mappedKey]?.scale) || 1;
    const speciesScale = profiles.speciesScaleFor(species, gender);
    const effective = modelScale * speciesScale;
    const debug = hands.getActiveDebug?.().find(entry => entry?.speciesId === species && entry?.gender === gender) || null; // Adds live rig/load information without requiring the browser console.
    const loadText = debug
      ? (debug.loadError ? 'MODEL ERROR: ' + debug.loadError : (debug.glb ? 'GLB model loaded' : 'fallback capsule'))
      : 'preview rig pending';
    $('handEffectiveStatus').textContent = `${mappedKey || 'no model'}: model ${modelScale.toFixed(3)} × species ${speciesScale.toFixed(3)} = effective ${effective.toFixed(3)} · ${loadText}`;
    $('handEffectiveStatus').style.color = debug?.loadError ? '#fb7185' : '';
  }

  function syncAll() {
    fillModelSelects();
    syncModelFields();
    syncSpeciesFields();
    refreshEffectiveStatus();
  }

  let previewRefreshQueued = false; // Coalesces profile mutations so live hand GLBs refresh at most once per animation frame.
  function refreshHandPreview() {
    if (previewRefreshQueued) return;
    previewRefreshQueued = true;
    requestAnimationFrame(() => {
      previewRefreshQueued = false;
      global.ProceduralHandFrameDriver?.syncNow?.(); // Attachment rigs alone own GLB rebuilds in response to profile-store notifications.
      refreshEffectiveStatus();
    });
  }

  function mutateModel(mutator) {
    const key = currentModelKey();
    profiles.mutate(data => {
      const model = data.models?.[key];
      if (!model) return;
      mutator(model);
    }, { kind: 'visual-profile', modelKey: key });
    syncModelFields();
    refreshEffectiveStatus();
    refreshHandPreview();
  }

  function bindRangeAndNumber(range, number, onValue) {
    const apply = source => {
      const value = Number(source.value);
      if (!Number.isFinite(value)) return;
      range.value = Math.max(Number(range.min), Math.min(Number(range.max), value));
      number.value = value;
      onValue(value);
    };
    range.addEventListener('input', () => apply(range));
    number.addEventListener('input', () => apply(number));
  }

  profileSelect.addEventListener('change', () => {
    const species = currentSpecies();
    const modelKey = profileSelect.value;
    profiles.mutate(data => {
      if (!data.speciesModels) data.speciesModels = {};
      data.speciesModels[species] = modelKey;
    }, { kind: 'model-mapping', speciesId: species, modelKey });
    syncModelFields();
    refreshEffectiveStatus();
    refreshHandPreview();
  });

  bindRangeAndNumber(modelScaleRange, modelScaleNumber, value => mutateModel(model => { model.scale = Math.max(0.01, value); }));
  bindRangeAndNumber(speciesScaleRange, speciesScaleNumber, value => {
    const species = currentSpecies();
    const gender = currentGender();
    profiles.mutate(data => {
      if (!data.speciesScaleOverrides) data.speciesScaleOverrides = {};
      if (!data.speciesScaleOverrides[species]) data.speciesScaleOverrides[species] = {};
      data.speciesScaleOverrides[species][gender] = Math.max(0.01, value);
    }, { kind: 'species-scale', speciesId: species, gender });
    syncSpeciesFields();
    refreshEffectiveStatus();
    refreshHandPreview();
  });

  $('handClearSpeciesScale').addEventListener('click', () => {
    const species = currentSpecies();
    const gender = currentGender();
    profiles.mutate(data => {
      if (!data.speciesScaleOverrides?.[species]) return;
      delete data.speciesScaleOverrides[species][gender];
      if (!Object.keys(data.speciesScaleOverrides[species]).length) delete data.speciesScaleOverrides[species];
    }, { kind: 'species-scale', speciesId: species, gender });
    syncSpeciesFields();
    refreshEffectiveStatus();
    refreshHandPreview();
  });

  $('handShowGripGuide').addEventListener('change', () => hands.setShowGripGuides($('handShowGripGuide').checked));
  hands.setShowGripGuides(true);

  function configJson() { return JSON.stringify(profiles.clone(), null, 2); }

  $('handSaveLocal').addEventListener('click', () => {
    try {
      profiles.saveLocal();
      setStatus(`Local hand-profile draft saved ${new Date().toLocaleTimeString()}.`);
    } catch (error) {
      setStatus(`Local save failed: ${error.message}`, true);
    }
  });

  $('handDownloadConfig').addEventListener('click', () => {
    const blob = new Blob([configJson()], { type: 'application/json' }); // Carries all reusable model sockets plus species mappings/overrides in one portable file.
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'hand-model-profiles.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Downloaded hand-model-profiles.json.');
  });

  $('handCopyConfig').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(configJson());
      setStatus('Hand profile JSON copied.');
    } catch (error) {
      setStatus(`Clipboard failed: ${error.message}`, true);
    }
  });

  $('handImportConfig').addEventListener('click', () => $('handImportFile').click());
  $('handImportFile').addEventListener('change', async () => {
    const file = $('handImportFile').files?.[0];
    if (!file) return;
    const historyToken = global.HobunjiAttackEditorHistory?.beginExternal?.('Import hand-model profiles'); // Captures hidden model values, not just visible sliders.
    try {
      const parsed = JSON.parse(await file.text());
      profiles.replace(parsed, { kind: 'replace' });
      syncAll();
      refreshHandPreview();
      setStatus(`Imported ${file.name}.`);
    } catch (error) {
      setStatus(`Import failed: ${error.message}`, true);
    } finally {
      global.HobunjiAttackEditorHistory?.commitExternal?.(historyToken);
      $('handImportFile').value = '';
    }
  });

  $('handResetConfig').addEventListener('click', () => {
    profiles.clearLocal();
    syncAll();
    setStatus('Reset to repository source defaults and cleared local draft.');
  });

  document.getElementById('avatarSpecies')?.addEventListener('change', () => setTimeout(() => syncAll(), 0));
  document.getElementById('avatarGender')?.addEventListener('change', () => setTimeout(() => { syncSpeciesFields(); refreshEffectiveStatus(); }, 0));
  profiles.subscribe((_data, change) => {
    refreshEffectiveStatus();
    if (change?.kind === 'hand-transform') global.ProceduralHandFrameDriver?.syncNow?.();
  });
  setInterval(refreshEffectiveStatus, 500); // Keeps mobile-visible load diagnostics current as async GLBs and avatar rebuilds settle.

  global.HobunjiAttackEditorHandContext = Object.freeze({
    currentSpecies,
    currentGender,
    currentModelKey,
  });
  global.HobunjiAttackEditorHandCalibrationMode = Object.freeze({
    get active() { return calibrationModeActive; },
    setActive: setCalibrationMode,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      calibrationModeListeners.add(listener);
      return () => calibrationModeListeners.delete(listener);
    },
  });
  global.HobunjiAttackEditorHandConfigurator = Object.freeze({
    syncAll,
    syncModelFields,
    syncSpeciesFields,
    refreshEffectiveStatus,
    refreshHandPreview,
  });

  syncAll();
})(window);
