// Direct hand-from-tool authoring overlay for the Attack Animation Editor.
// Model/scale/import controls remain in attack-editor-hand-configurator.js; this
// layer authors the complete hand transform from a tool grip socket. No arm IK,
// reach clamp, elbow, forearm, or hidden wrist correction participates.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralHandAttachments || global.ProceduralArmAnimation;
  if (!profiles || !hands || !document.getElementById('handProfileSelect')) return;
  if (document.getElementById('handFromToolPositionFields')) return;

  const $ = id => document.getElementById(id);
  const profileSelect = $('handProfileSelect');
  const card = profileSelect.closest('.card');
  if (!card) return;

  // Hide the superseded model-local tool socket controls. hand-model-profiles.js
  // normalizes legacy toolGrip to identity so only handFromTool affects placement.
  $('handGripPositionFields')?.closest('.poseGroup')?.style.setProperty('display', 'none');
  $('handGripRotationFields')?.closest('.poseGroup')?.style.setProperty('display', 'none');

  const topHelp = card.querySelector('.sectionTitle')?.nextElementSibling;
  if (topHelp?.classList.contains('help')) {
    topHelp.innerHTML = 'Final hand size = <b>model scale × species/gender scale</b>. Grip mode + the values below are the complete transform from the tool grip socket to the hand. The tool is never moved by the hand system.';
  }
  const tag = card.querySelector('.sectionTag');
  if (tag) tag.textContent = 'hand ← tool socket';

  const guideCheckbox = $('handShowGripGuide');
  const guideField = guideCheckbox?.closest('.field');
  if (guideCheckbox?.parentElement) {
    for (const node of [...guideCheckbox.parentElement.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.textContent = 'Show hand target axes';
    }
  }

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="poseGroup" id="handFromToolPositionGroup">
      <div class="poseGroupHead"><span class="dot" style="background:#34d399"></span>Hand position relative to tool grip</div>
      <div class="help" style="margin-bottom:6px">Tool-local X/Y/Z offset from the primary or secondary grip frame. Values are normalized hand-height units and scale with the final hand size.</div>
      <div id="handFromToolPositionFields"></div>
    </div>
    <div class="poseGroup" id="handFromToolRotationGroup">
      <div class="poseGroupHead"><span class="dot" style="background:#fbbf24"></span>Hand direction relative to tool grip</div>
      <div class="help" style="margin-bottom:6px">Pitch / yaw / roll are composed with the selected grip mode and then applied directly to the hand.</div>
      <div id="handFromToolRotationFields"></div>
    </div>
    <div class="help" id="handInverseLiveStatus" style="padding:7px;border:1px solid rgba(34,211,238,.22);border-radius:8px;margin-bottom:8px">Direct hand attachment preview ready.</div>
  `;
  while (wrapper.firstChild) card.insertBefore(wrapper.firstChild, guideField || $('handEffectiveStatus'));

  const positionFields = [
    { key: 'x', label: 'X side', min: -2, max: 2, step: 0.01 },
    { key: 'y', label: 'Y height', min: -2, max: 2, step: 0.01 },
    { key: 'z', label: 'Z forward', min: -2, max: 2, step: 0.01 },
  ];
  const rotationFields = [
    { key: 'pitch', label: 'Pitch°', min: -180, max: 180, step: 1 },
    { key: 'yaw', label: 'Yaw°', min: -180, max: 180, step: 1 },
    { key: 'roll', label: 'Roll°', min: -180, max: 180, step: 1 },
  ];

  function fieldMarkup(prefix, field) {
    return `<div class="field"><label>${field.label}</label><div class="fieldRow">
      <input id="${prefix}_${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}">
      <input id="${prefix}_${field.key}_n" type="number" min="${field.min}" max="${field.max}" step="${field.step}" style="width:78px;flex:0 0 78px">
    </div></div>`;
  }
  $('handFromToolPositionFields').innerHTML = positionFields.map(field => fieldMarkup('handFromToolPos', field)).join('');
  $('handFromToolRotationFields').innerHTML = rotationFields.map(field => fieldMarkup('handFromToolRot', field)).join('');

  function currentModel() {
    return profiles.data.models?.[profileSelect.value] || null;
  }

  function ensureTransform(model) {
    if (!model.handFromTool) model.handFromTool = {};
    if (!model.handFromTool.position) model.handFromTool.position = { x: 0, y: 0, z: 0 };
    if (!model.handFromTool.rotationDeg) model.handFromTool.rotationDeg = { pitch: 0, yaw: 0, roll: 0 };
  }

  function setPaired(range, number, value) {
    range.value = Math.max(Number(range.min), Math.min(Number(range.max), Number(value) || 0));
    number.value = Number(value) || 0;
  }

  function syncFields() {
    const model = currentModel();
    if (!model) return;
    ensureTransform(model);
    for (const field of positionFields) {
      setPaired($(`handFromToolPos_${field.key}`), $(`handFromToolPos_${field.key}_n`), model.handFromTool.position[field.key]);
    }
    for (const field of rotationFields) {
      setPaired($(`handFromToolRot_${field.key}`), $(`handFromToolRot_${field.key}_n`), model.handFromTool.rotationDeg[field.key]);
    }
  }

  function shortTransform(transform) {
    const p = transform?.position || {};
    const r = transform?.rotationDeg || {};
    return `P ${['x','y','z'].map(k => (Number(p[k]) || 0).toFixed(2)).join('/')} · R ${['pitch','yaw','roll'].map(k => Math.round(Number(r[k]) || 0)).join('/')}`;
  }

  function syncPreview() {
    const results = global.ProceduralHandFrameDriver?.syncNow?.() || [];
    const live = results.find(Boolean) || null;
    const debug = global.ProceduralHandFrameDriver?.getDebug?.() || [];
    const d = debug[0] || null;
    const status = $('handInverseLiveStatus');
    if (status) {
      const authored = currentModel()?.handFromTool || null;
      const gripMode = global.HobunjiHandGripModes?.currentModeKey?.() || '-';
      const second = live?.secondaryActive ? `${live.toolKey || d?.toolKey || 'tool'} secondary` : 'idle';
      status.textContent = `mode=${gripMode} · authored ${shortTransform(authored)} · effective ${shortTransform(d?.handFromTool)} · right=primary grip · left=${second} · DIRECT / NO ARM IK`;
      status.style.color = '';
    }
    return results;
  }

  function mutateTransform(mutator) {
    const key = profileSelect.value;
    const model = profiles.data.models?.[key];
    if (!model) return;
    ensureTransform(model);
    // This is a socket transform, not an asset reload. Mutate in place so slider
    // movement does not rebuild both GLBs; the frame driver reads it immediately.
    mutator(model.handFromTool);
    global.HOBUNJI_HAND_MODEL_PROFILES = profiles.data;
    syncPreview();
    requestAnimationFrame(syncPreview);
  }

  function bindPair(range, number, onValue) {
    const apply = source => {
      const value = Number(source.value);
      if (!Number.isFinite(value)) return;
      setPaired(range, number, value);
      onValue(value);
    };
    range.addEventListener('input', () => apply(range));
    number.addEventListener('input', () => apply(number));
  }

  for (const field of positionFields) {
    bindPair($(`handFromToolPos_${field.key}`), $(`handFromToolPos_${field.key}_n`), value => {
      mutateTransform(transform => { transform.position[field.key] = value; });
    });
  }
  for (const field of rotationFields) {
    bindPair($(`handFromToolRot_${field.key}`), $(`handFromToolRot_${field.key}_n`), value => {
      mutateTransform(transform => { transform.rotationDeg[field.key] = value; });
    });
  }

  profileSelect.addEventListener('change', () => { syncFields(); syncPreview(); });
  profiles.subscribe?.(() => syncFields());

  for (const phase of ['neutral', 'windup', 'strike']) {
    for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw']) {
      $(`${phase}_${key}`)?.addEventListener('input', () => requestAnimationFrame(syncPreview));
    }
  }

  setInterval(syncPreview, 500);
  syncFields();
  syncPreview();
})(window);
