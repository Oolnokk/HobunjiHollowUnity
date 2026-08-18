// Attack Editor UI for direct hand attachments and optional secondary tool grips.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const toolGrips = global.HobunjiHandToolGrips;
  const profileSelect = document.getElementById('handProfileSelect');
  const toolSelect = document.getElementById('toolSpriteSelect');
  if (!profiles || !toolGrips || !profileSelect || !toolSelect) return;
  if (document.getElementById('handSecondaryGripEnabled')) return;

  try { toolGrips.loadLocal(); } catch (_) {}

  const card = profileSelect.closest('.card');
  if (!card) return;
  const $ = id => document.getElementById(id);

  // Remove all arm/IK authoring affordances. Hands are now attachment points only.
  $('handShowArmBones')?.closest('.field')?.remove();
  $('handInverseReachHelp')?.remove();
  const tag = card.querySelector('.sectionTag');
  if (tag) tag.textContent = 'direct tool sockets + species scale';
  const topHelp = card.querySelector('.sectionTitle')?.nextElementSibling;
  if (topHelp?.classList.contains('help')) {
    topHelp.innerHTML = 'Hands are <b>direct attachments</b>: the right hand follows the tool attach frame exactly; an optional secondary tool-local grip frame can attach the left hand. There are no arm bones, elbows, reach limits, or IK.';
  }

  const inverseHelp = $('handFromToolRotationGroup')?.querySelector('.help');
  if (inverseHelp) inverseHelp.textContent = 'Pitch / yaw / roll are the complete hand orientation relative to the selected grip mode and tool attach frame. No hidden arm/wrist correction is added.';

  const section = document.createElement('div');
  section.className = 'poseGroup';
  section.id = 'handSecondaryGripGroup';
  section.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Optional second hand grip</div>
    <div class="help" style="margin-bottom:6px">Primary/right hand = the tool's existing attach origin. This secondary frame is tool-local and, when enabled, places the left hand. Hatchet and hoe start enabled; other tools start one-handed.</div>
    <div class="field"><label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handSecondaryGripEnabled" style="width:auto;margin-right:6px">Attach left hand to secondary grip</label></div>
    <div id="handSecondaryGripPositionFields"></div>
    <div id="handSecondaryGripRotationFields"></div>
    <div class="help" id="handSecondaryGripStatus" style="padding:7px;border:1px solid rgba(251,113,133,.22);border-radius:8px;margin:6px 0"></div>
    <div class="row">
      <button id="handSecondaryGripSave" class="good" style="font-size:11px">💾 Save grip draft</button>
      <button id="handSecondaryGripCopy" class="secondary" style="font-size:11px">Copy grip JSON</button>
      <button id="handSecondaryGripReset" class="warn" style="font-size:11px">Reset grip defaults</button>
    </div>
  `;
  const effectiveStatus = $('handEffectiveStatus');
  card.insertBefore(section, effectiveStatus || null);

  const positionFields = [
    { key: 'x', label: 'Secondary X', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'y', label: 'Secondary Y', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'z', label: 'Secondary Z', min: -1.5, max: 1.5, step: 0.01 },
  ];
  const rotationFields = [
    { key: 'pitch', label: 'Secondary Pitch°', min: -180, max: 180, step: 1 },
    { key: 'yaw', label: 'Secondary Yaw°', min: -180, max: 180, step: 1 },
    { key: 'roll', label: 'Secondary Roll°', min: -180, max: 180, step: 1 },
  ];

  function fieldMarkup(prefix, field) {
    return `<div class="field"><label>${field.label}</label><div class="fieldRow">
      <input id="${prefix}_${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}">
      <input id="${prefix}_${field.key}_n" type="number" min="${field.min}" max="${field.max}" step="${field.step}" style="width:78px;flex:0 0 78px">
    </div></div>`;
  }
  $('handSecondaryGripPositionFields').innerHTML = positionFields.map(field => fieldMarkup('handSecondaryPos', field)).join('');
  $('handSecondaryGripRotationFields').innerHTML = rotationFields.map(field => fieldMarkup('handSecondaryRot', field)).join('');

  function currentToolKey() { return toolGrips.toolKeyFor(toolSelect.value); }
  function currentEntry() { return toolGrips.ensureTool(currentToolKey()); }
  function currentSecondary() { return currentEntry()?.secondaryGrip || null; }

  function setPair(range, number, value) {
    const v = Number(value) || 0;
    range.value = Math.max(Number(range.min), Math.min(Number(range.max), v));
    number.value = v;
  }

  function refreshDirectStatus() {
    const species = String($('avatarSpecies')?.value || '').trim();
    const gender = String($('avatarGender')?.value || 'male').trim();
    const mappedKey = profiles.modelKeyForSpecies?.(species);
    const modelScale = Number(profiles.data.models?.[mappedKey]?.scale) || 1;
    const speciesScale = Number(profiles.speciesScaleFor?.(species, gender)) || 1;
    const debug = global.ProceduralHandFrameDriver?.getDebug?.().find(entry => entry?.speciesId === species) || null;
    if (effectiveStatus) {
      const second = debug?.secondaryActive ? `left→${debug.toolKey || currentToolKey()} secondary` : 'left→idle';
      effectiveStatus.textContent = `${mappedKey || 'no model'}: model ${modelScale.toFixed(3)} × species ${speciesScale.toFixed(3)} = effective ${(modelScale * speciesScale).toFixed(3)} · direct attachment · right→primary · ${second} · NO ARM IK`;
      effectiveStatus.style.color = debug?.hand?.loadError ? '#fb7185' : '';
    }
  }

  function syncFields() {
    const key = currentToolKey();
    const secondary = currentSecondary();
    if (!secondary) return;
    $('handSecondaryGripEnabled').checked = secondary.enabled === true;
    for (const field of positionFields) setPair($(`handSecondaryPos_${field.key}`), $(`handSecondaryPos_${field.key}_n`), secondary.position?.[field.key]);
    for (const field of rotationFields) setPair($(`handSecondaryRot_${field.key}`), $(`handSecondaryRot_${field.key}_n`), secondary.rotationDeg?.[field.key]);
    $('handSecondaryGripStatus').textContent = secondary.enabled
      ? `${key || 'tool'}: TWO-HAND · right at primary origin · left at authored secondary frame.`
      : `${key || 'tool'}: ONE-HAND · left hand stays at its avatar idle attachment.`;
    refreshDirectStatus();
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function mutateSecondary(mutator) {
    const key = currentToolKey();
    if (!key) return;
    toolGrips.mutate(data => {
      if (!data.tools[key]) data.tools[key] = { secondaryGrip: { enabled: false, position: { x: 0, y: 0, z: 0 }, rotationDeg: { pitch: 0, yaw: 0, roll: 0 } } };
      mutator(data.tools[key].secondaryGrip);
    });
    syncFields();
  }

  function bindPair(range, number, onValue) {
    const apply = source => {
      const value = Number(source.value);
      if (!Number.isFinite(value)) return;
      setPair(range, number, value);
      onValue(value);
    };
    range.addEventListener('input', () => apply(range));
    number.addEventListener('input', () => apply(number));
  }

  $('handSecondaryGripEnabled').addEventListener('change', event => {
    mutateSecondary(secondary => { secondary.enabled = event.target.checked; });
  });
  for (const field of positionFields) {
    bindPair($(`handSecondaryPos_${field.key}`), $(`handSecondaryPos_${field.key}_n`), value => {
      mutateSecondary(secondary => { secondary.position[field.key] = value; });
    });
  }
  for (const field of rotationFields) {
    bindPair($(`handSecondaryRot_${field.key}`), $(`handSecondaryRot_${field.key}_n`), value => {
      mutateSecondary(secondary => { secondary.rotationDeg[field.key] = value; });
    });
  }

  toolSelect.addEventListener('change', syncFields);
  $('avatarSpecies')?.addEventListener('change', refreshDirectStatus);
  $('avatarGender')?.addEventListener('change', refreshDirectStatus);
  profileSelect.addEventListener('change', refreshDirectStatus);
  profiles.subscribe?.(refreshDirectStatus);
  toolGrips.subscribe?.(syncFields);

  $('handSecondaryGripSave').addEventListener('click', () => {
    try {
      toolGrips.saveLocal();
      $('handSecondaryGripStatus').textContent = `${currentToolKey()}: grip draft saved locally.`;
    } catch (error) {
      $('handSecondaryGripStatus').textContent = `Grip save failed: ${error?.message || error}`;
    }
  });
  $('handSecondaryGripCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(toolGrips.clone(), null, 2));
      $('handSecondaryGripStatus').textContent = 'Copied hand-tool-grips JSON.';
    } catch (error) {
      $('handSecondaryGripStatus').textContent = `Copy failed: ${error?.message || error}`;
    }
  });
  $('handSecondaryGripReset').addEventListener('click', () => {
    toolGrips.clearLocal();
    syncFields();
  });

  syncFields();
})(window);
