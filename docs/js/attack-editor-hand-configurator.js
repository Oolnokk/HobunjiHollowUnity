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
    <div class="sectionTitle"><b>3D Hand Model</b><span class="sectionTag">model socket + species scale</span></div>
    <div class="help" style="margin-bottom:8px">Final hand size = <b>model scale × species/gender scale</b>. Model scale and grip belong to the GLB; species scale is a separate anatomy multiplier.</div>

    <div class="field"><label>Model profile to edit</label><select id="handProfileSelect"></select></div>
    <div class="field"><label>Current species uses model</label><select id="handSpeciesModelSelect"></select></div>

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

    <div class="poseGroup">
      <div class="poseGroupHead"><span class="dot" style="background:#34d399"></span>Tool grip point</div>
      <div class="help" style="margin-bottom:6px">Position is stored in normalized hand-height units, so it scales with the model. The colored axes in the palm mark this socket.</div>
      <div id="handGripPositionFields"></div>
    </div>

    <div class="poseGroup">
      <div class="poseGroupHead"><span class="dot" style="background:#fbbf24"></span>Tool grip direction</div>
      <div class="help" style="margin-bottom:6px">Pitch / yaw / roll define the orientation the held tool should have at the grip point.</div>
      <div id="handGripRotationFields"></div>
    </div>

    <div class="field"><label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handShowGripGuide" checked style="width:auto;margin-right:6px">Show tool-grip axes</label></div>
    <div class="field"><label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handShowArmBones" style="width:auto;margin-right:6px">Show invisible arm bones</label></div>

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
  const profileSelect = $('handProfileSelect'); // Chooses which reusable GLB model's scale/socket fields are being edited.
  const speciesModelSelect = $('handSpeciesModelSelect'); // Chooses which model the currently previewed species references.
  const modelScaleRange = $('handModelScale'); // Edits the model-tied multiplier with touch-friendly dragging.
  const modelScaleNumber = $('handModelScaleNumber'); // Allows precise model-scale entry beside the slider.
  const speciesScaleRange = $('handSpeciesScale'); // Edits the current species/gender anatomy multiplier.
  const speciesScaleNumber = $('handSpeciesScaleNumber'); // Allows precise species-scale entry beside the slider.
  const saveStatus = $('handSaveStatus'); // Surfaces save/import errors directly in the editor for mobile users.

  const positionFields = [
    { key: 'x', label: 'X side', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'y', label: 'Y height', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'z', label: 'Z forward', min: -1.5, max: 1.5, step: 0.01 },
  ]; // Defines normalized socket-position controls shared across every model.
  const rotationFields = [
    { key: 'pitch', label: 'Pitch°', min: -180, max: 180, step: 1 },
    { key: 'yaw', label: 'Yaw°', min: -180, max: 180, step: 1 },
    { key: 'roll', label: 'Roll°', min: -180, max: 180, step: 1 },
  ]; // Defines the local grip-frame orientation controls.

  function fieldMarkup(prefix, field) {
    return `<div class="field"><label>${field.label}</label><div class="fieldRow">
      <input id="${prefix}_${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}">
      <input id="${prefix}_${field.key}_n" type="number" min="${field.min}" max="${field.max}" step="${field.step}" style="width:78px;flex:0 0 78px">
    </div></div>`;
  }
  $('handGripPositionFields').innerHTML = positionFields.map(field => fieldMarkup('handGripPos', field)).join('');
  $('handGripRotationFields').innerHTML = rotationFields.map(field => fieldMarkup('handGripRot', field)).join('');

  function currentSpecies() { return String($('avatarSpecies')?.value || '').trim(); }
  function currentGender() { return String($('avatarGender')?.value || 'male').trim(); }
  function modelKeys() { return Object.keys(profiles.data.models || {}); }
  function currentModelKey() { return profileSelect.value || modelKeys()[0] || ''; }
  function currentModel() { return profiles.data.models?.[currentModelKey()] || null; }

  function setStatus(message, isError) {
    saveStatus.textContent = message;
    saveStatus.style.color = isError ? '#fb7185' : '';
  }

  function ensureProfileShape(model) {
    if (!model.toolGrip) model.toolGrip = {};
    if (!model.toolGrip.position) model.toolGrip.position = { x: 0, y: 0, z: 0 };
    if (!model.toolGrip.rotationDeg) model.toolGrip.rotationDeg = { pitch: 0, yaw: 0, roll: 0 };
  }

  function fillModelSelects(preferredProfile) {
    const keys = modelKeys();
    const options = keys.map(key => `<option value="${key}">${key}</option>`).join('');
    profileSelect.innerHTML = options;
    speciesModelSelect.innerHTML = options;
    const speciesKey = profiles.modelKeyForSpecies(currentSpecies());
    profileSelect.value = keys.includes(preferredProfile) ? preferredProfile : (keys.includes(speciesKey) ? speciesKey : keys[0] || '');
    speciesModelSelect.value = keys.includes(speciesKey) ? speciesKey : keys[0] || '';
  }

  function authoredSpeciesScaleEntry(species, gender) {
    const exact = profiles.data.speciesScaleOverrides?.[species]?.[gender]; // Distinguishes an authored hand override from inherited foot/default scale.
    const number = Number(exact);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function syncModelFields() {
    const model = currentModel();
    if (!model) return;
    ensureProfileShape(model);
    const modelScale = Number(model.scale) > 0 ? Number(model.scale) : 1;
    modelScaleRange.value = Math.min(Number(modelScaleRange.max), modelScale);
    modelScaleNumber.value = modelScale;
    for (const field of positionFields) {
      const value = Number(model.toolGrip.position[field.key]) || 0;
      $(`handGripPos_${field.key}`).value = value;
      $(`handGripPos_${field.key}_n`).value = value;
    }
    for (const field of rotationFields) {
      const value = Number(model.toolGrip.rotationDeg[field.key]) || 0;
      $(`handGripRot_${field.key}`).value = value;
      $(`handGripRot_${field.key}_n`).value = value;
    }
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
    if (mapped && [...speciesModelSelect.options].some(option => option.value === mapped)) speciesModelSelect.value = mapped;
  }

  function refreshEffectiveStatus() {
    const species = currentSpecies();
    const gender = currentGender();
    const mappedKey = profiles.modelKeyForSpecies(species);
    const modelScale = Number(profiles.data.models?.[mappedKey]?.scale) || 1;
    const speciesScale = profiles.speciesScaleFor(species, gender);
    const effective = modelScale * speciesScale;
    const debug = hands.getActiveDebug?.().find(entry => entry?.speciesId === species && entry?.gender === gender) || null; // Adds live rig/scan/load information without requiring the browser console.
    const scanText = debug
      ? `${debug.scanSucceeded ? 'raw-arm scan ✓' : 'scan fallback'} · reach ${Number(debug.armLength || 0).toFixed(3)}`
      : 'preview rig pending';
    const loadText = debug?.loadError ? ` · MODEL ERROR: ${debug.loadError}` : '';
    $('handEffectiveStatus').textContent = `${mappedKey || 'no model'}: model ${modelScale.toFixed(3)} × species ${speciesScale.toFixed(3)} = effective ${effective.toFixed(3)} · ${scanText}${loadText}`;
    $('handEffectiveStatus').style.color = debug?.loadError ? '#fb7185' : '';
  }

  function syncAll(preferredProfile) {
    fillModelSelects(preferredProfile || currentModelKey());
    syncModelFields();
    syncSpeciesFields();
    refreshEffectiveStatus();
  }

  function mutateModel(mutator) {
    const key = currentModelKey();
    profiles.mutate(data => {
      const model = data.models?.[key];
      if (!model) return;
      ensureProfileShape(model);
      mutator(model);
    });
    syncModelFields();
    refreshEffectiveStatus();
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

  profileSelect.addEventListener('change', () => { syncModelFields(); refreshEffectiveStatus(); });
  speciesModelSelect.addEventListener('change', () => {
    const species = currentSpecies();
    const modelKey = speciesModelSelect.value;
    profiles.mutate(data => {
      if (!data.speciesModels) data.speciesModels = {};
      data.speciesModels[species] = modelKey;
    });
    profileSelect.value = modelKey;
    syncModelFields();
    refreshEffectiveStatus();
  });

  bindRangeAndNumber(modelScaleRange, modelScaleNumber, value => mutateModel(model => { model.scale = Math.max(0.01, value); }));
  bindRangeAndNumber(speciesScaleRange, speciesScaleNumber, value => {
    const species = currentSpecies();
    const gender = currentGender();
    profiles.mutate(data => {
      if (!data.speciesScaleOverrides) data.speciesScaleOverrides = {};
      if (!data.speciesScaleOverrides[species]) data.speciesScaleOverrides[species] = {};
      data.speciesScaleOverrides[species][gender] = Math.max(0.01, value);
    });
    syncSpeciesFields();
    refreshEffectiveStatus();
  });

  for (const field of positionFields) {
    bindRangeAndNumber($(`handGripPos_${field.key}`), $(`handGripPos_${field.key}_n`), value => {
      mutateModel(model => { model.toolGrip.position[field.key] = value; });
    });
  }
  for (const field of rotationFields) {
    bindRangeAndNumber($(`handGripRot_${field.key}`), $(`handGripRot_${field.key}_n`), value => {
      mutateModel(model => { model.toolGrip.rotationDeg[field.key] = value; });
    });
  }

  $('handClearSpeciesScale').addEventListener('click', () => {
    const species = currentSpecies();
    const gender = currentGender();
    profiles.mutate(data => {
      if (!data.speciesScaleOverrides?.[species]) return;
      delete data.speciesScaleOverrides[species][gender];
      if (!Object.keys(data.speciesScaleOverrides[species]).length) delete data.speciesScaleOverrides[species];
    });
    syncSpeciesFields();
    refreshEffectiveStatus();
  });

  $('handShowGripGuide').addEventListener('change', () => hands.setShowGripGuides($('handShowGripGuide').checked));
  $('handShowArmBones').addEventListener('change', () => hands.setShowBones($('handShowArmBones').checked));
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
    try {
      const parsed = JSON.parse(await file.text());
      profiles.replace(parsed);
      syncAll();
      setStatus(`Imported ${file.name}.`);
    } catch (error) {
      setStatus(`Import failed: ${error.message}`, true);
    } finally {
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
  profiles.subscribe(() => refreshEffectiveStatus());
  setInterval(refreshEffectiveStatus, 500); // Keeps mobile-visible scan/load/reach diagnostics current as async GLBs and avatar rebuilds settle.

  syncAll();
})(window);
