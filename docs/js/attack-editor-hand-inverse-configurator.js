// Per-GLB hand-model calibration overlay for the Attack Animation Editor.
// Weapon grip targets answer "where on this weapon should the hand land?"; Grip Mode
// answers "which generic palm relationship?"; THIS file answers only "how must this
// particular hand model's authored origin/palm be corrected to fit that target?".
// No arm IK, reach clamp, elbow, forearm, or hidden wrist correction participates.
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

  const topHelp = card.querySelector('.sectionTitle')?.nextElementSibling;
  if (topHelp?.classList.contains('help')) {
    topHelp.innerHTML = 'Final hand size = <b>model scale × species/gender scale</b>. Weapon grip targets move the hand to the weapon. <b>Hand Model Calibration</b> below is a reusable per-GLB correction applied afterward so different hand models put the same anatomical palm point on that target.';
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
      <div class="poseGroupHead"><span class="dot" style="background:#34d399"></span>Hand Model Calibration · position correction</div>
      <div class="help" style="margin-bottom:6px"><b>These values move the selected HAND MODEL, not the weapon and not the weapon's grip target.</b> They correct the model's authored origin/palm after Grip Mode. Units are normalized hand-height units, so one calibration can be reused anywhere this GLB appears.</div>
      <div class="field" style="padding:7px;border:1px solid rgba(255,255,255,.08);border-radius:8px;margin-bottom:7px">
        <label class="fieldRow" style="cursor:pointer;margin:0"><input type="checkbox" id="handShowPaperHandGuide" style="width:auto;margin-right:6px">Show locked paper-hand reference</label>
        <div class="help" style="margin-top:5px"><b>Reference only:</b> a fixed wireframe/x-ray grasping mitten made from one palm plane, three folded finger planes, and two folded thumb planes. It is locked to the raw right-hand grip target <b>before</b> Hand Model Calibration, so these position/rotation sliders visibly move the real GLB against it. Its folds never animate independently. Use it as a stable alignment/descriptive scaffold when directing an LLM.</div>
      </div>
      <div id="handFromToolPositionFields"></div>
    </div>
    <div class="poseGroup" id="handFromToolRotationGroup">
      <div class="poseGroupHead"><span class="dot" style="background:#fbbf24"></span>Hand Model Calibration · rotation correction</div>
      <div class="help" style="margin-bottom:6px"><b>X/Y/Z use orthogonal quaternion correction coordinates anchored to this GLB's preserved calibration base.</b> A solo X, Y, or Z value is the exact requested rotation around that model-basis axis. Multiple corrections are solved simultaneously instead of as a sequential Z·Y·X rotation, so setting one correction to ±90° cannot collapse the other two controls onto the same physical axis. Grip Mode is applied first; shoulder-follow is a separate later layer.</div>
      <div id="handFromToolRotationFields"></div>
    </div>
    <div class="help" id="handInverseLiveStatus" style="padding:7px;border:1px solid rgba(34,211,238,.22);border-radius:8px;margin-bottom:8px">Direct hand attachment preview ready.</div>
  `;
  while (wrapper.firstChild) card.insertBefore(wrapper.firstChild, guideField || $('handEffectiveStatus'));

  const positionFields = [
    { key: 'x', label: 'Hand-model X position correction', min: -2, max: 2, step: 0.01 },
    { key: 'y', label: 'Hand-model Y position correction', min: -2, max: 2, step: 0.01 },
    { key: 'z', label: 'Hand-model Z position correction', min: -2, max: 2, step: 0.01 },
  ];
  const rotationFields = [
    { key: 'x', label: 'Hand-model X rotation correction°', min: -180, max: 180, step: 1 },
    { key: 'y', label: 'Hand-model Y rotation correction°', min: -180, max: 180, step: 1 },
    { key: 'z', label: 'Hand-model Z rotation correction°', min: -180, max: 180, step: 1 },
  ];

  function fieldMarkup(prefix, field) {
    return `<div class="field"><label>${field.label}</label><div class="fieldRow">
      <input id="${prefix}_${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}">
      <input id="${prefix}_${field.key}_n" type="number" min="${field.min}" max="${field.max}" step="${field.step}" style="width:78px;flex:0 0 78px">
    </div></div>`;
  }
  $('handFromToolPositionFields').innerHTML = positionFields.map(field => fieldMarkup('handFromToolPos', field)).join('');
  $('handFromToolRotationFields').innerHTML = rotationFields.map(field => fieldMarkup('handFromToolRot', field)).join('');

  const paperGuideToggle = $('handShowPaperHandGuide'); // Editor-only visibility switch for the locked right-hand description scaffold.
  function syncPaperHandGuide() {
    hands.setShowPaperHandGuide?.(!!paperGuideToggle?.checked);
  }
  paperGuideToggle?.addEventListener('change', syncPaperHandGuide);

  function currentModel() {
    return profiles.data.models?.[profileSelect.value] || null;
  }

  function ensureTransform(model) {
    if (!model.handFromTool) model.handFromTool = {};
    model.handFromTool = profiles.normalizeHandTransform?.(model.handFromTool) || model.handFromTool;
    if (!model.handFromTool.position) model.handFromTool.position = { x: 0, y: 0, z: 0 };
    if (!model.handFromTool.rotationCorrectionDeg) model.handFromTool.rotationCorrectionDeg = { x: 0, y: 0, z: 0 };
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
      setPaired($(`handFromToolRot_${field.key}`), $(`handFromToolRot_${field.key}_n`), model.handFromTool.rotationCorrectionDeg[field.key]);
    }
  }

  function shortTransform(transform) {
    const p = transform?.position || {};
    const correction = transform?.rotationCorrectionDeg || {};
    return `XYZ pos ${['x','y','z'].map(k => (Number(p[k]) || 0).toFixed(2)).join('/')} · orthogonal quaternion XYZ ${['x','y','z'].map(k => Math.round(Number(correction[k]) || 0)).join('/')}°`;
  }

  function syncPreview() {
    syncPaperHandGuide(); // History restores and profile refreshes reapply the toggle even when no checkbox change event fires.
    const results = global.ProceduralHandFrameDriver?.syncNow?.() || [];
    const live = results.find(Boolean) || null;
    const debug = global.ProceduralHandFrameDriver?.getDebug?.() || [];
    const d = debug[0] || null;
    const status = $('handInverseLiveStatus');
    if (status) {
      const authored = currentModel()?.handFromTool || null;
      const gripMode = global.HobunjiHandGripModes?.currentModeKey?.() || '-';
      const second = live?.secondaryActive ? `${live.toolKey || d?.toolKey || 'tool'} secondary` : 'idle';
      const paperLock = paperGuideToggle?.checked ? ' · paper=LOCKED RAW GRIP TARGET' : '';
      status.textContent = `mode=${gripMode} · authored ${shortTransform(authored)} · effective ${shortTransform(d?.handFromTool)} · right=primary grip · left=${second} · ORTHOGONAL QUATERNION XYZ / NO 90° AXIS COLLAPSE${paperLock}`;
      status.style.color = '';
    }
    return results;
  }

  function mutateTransform(mutator) {
    const key = profileSelect.value;
    if (!profiles.data.models?.[key]) return;
    profiles.updateModelHandTransform?.(key, mutator); // Store-owned mutation notifies the live frame driver immediately; no GLB reload and no Undo/Redo "wake-up".
    syncPreview();
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
      mutateTransform(transform => { transform.rotationCorrectionDeg[field.key] = value; });
    });
  }

  profileSelect.addEventListener('change', () => { syncFields(); syncPreview(); });
  profiles.subscribe?.((_data, change) => {
    if (!change?.modelKey || change.modelKey === profileSelect.value || change.kind === 'replace') syncFields();
  });



  global.HobunjiAttackEditorHandCalibration = Object.freeze({
    syncFields,
    syncPreview,
    syncPaperHandGuide,
    refresh() { syncFields(); syncPaperHandGuide(); syncPreview(); },
  });

  syncFields();
  syncPaperHandGuide();
  syncPreview();
})(window);
