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
  const calibrationMount = $('handCalibrationWorkspaceMount') || card; // Dedicated tab owns every GLB↔paper alignment control.

  const topHelp = card.querySelector('.sectionTitle')?.nextElementSibling;
  if (topHelp?.classList.contains('help')) {
    topHelp.innerHTML = 'Final hand size = <b>model scale × species/gender scale</b>. Weapon grip targets move the hand to the weapon. <b>Hand Model Calibration</b> below is a reusable per-GLB correction applied afterward so different hand models put the same anatomical palm point on that target.';
  }
  const tag = card.querySelector('.sectionTag');
  if (tag) tag.textContent = 'hand ← tool socket';

  const guideCheckbox = $('handShowGripGuide');
  if (guideCheckbox?.parentElement) {
    for (const node of [...guideCheckbox.parentElement.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.textContent = 'Show hand target axes';
    }
  }

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="poseGroup" id="handFromToolPositionGroup">
      <div class="poseGroupHead"><span class="dot" style="background:#34d399"></span>Hand Model Calibration · position correction</div>
      <div class="help" style="margin-bottom:6px"><b>These values move only the selected GLB against the neutral paper hand.</b> Units are normalized hand-height units so the correction remains reusable anywhere this GLB appears.</div>
      <div class="field" style="padding:7px;border:1px solid rgba(255,255,255,.08);border-radius:8px;margin-bottom:7px">
        <label class="fieldRow" style="cursor:default;margin:0"><input type="checkbox" id="handShowPaperHandGuide" checked disabled style="width:auto;margin-right:6px">Neutral paper-hand reference · always on in this tab</label>
        <div class="help" style="margin-top:5px"><b>Only reference in this workflow:</b> a fixed wireframe/x-ray grasping hand at a neutral world orientation. It receives no attack pose, weapon target, Grip Mode, shoulder targeting, character-facing rotation, or animation transform. The GLB shares that exact neutral socket; only its own calibration moves it relative to the paper hand. Its folds never animate independently, so it remains a stable descriptive reference when directing an LLM.</div>
      </div>
      <div id="handFromToolPositionFields"></div>
    </div>
    <div class="poseGroup" id="handFromToolRotationGroup">
      <div class="poseGroupHead"><span class="dot" style="background:#fbbf24"></span>Hand Model Calibration · local rotation</div>
      <div class="help" style="margin-bottom:6px"><b>All rotation controls are local to <code>right_hand_calibration</code>.</b> They never display or author parent/world rotation. The quaternion-native internals prevent the old 90° axis collapse while the controls remain GLB-local from the user's point of view.</div>
      <div id="handFromToolRotationFields"></div>
      <div class="row" style="margin-top:7px">
        <button id="handSnapLocalRotation90" class="secondary" type="button">⌗ Snap local rotation to 90°</button>
      </div>
      <div class="help" id="handLocalRotationStatus" style="margin-top:6px">Local GLB rotation pending.</div>
    </div>
    <div class="help" id="handInverseLiveStatus" style="padding:7px;border:1px solid rgba(34,211,238,.22);border-radius:8px;margin-bottom:8px">Direct hand attachment preview ready.</div>
  `;
  while (wrapper.firstChild) calibrationMount.appendChild(wrapper.firstChild);

  const positionFields = [
    { key: 'x', label: 'Hand-model X position correction', min: -2, max: 2, step: 0.01 },
    { key: 'y', label: 'Hand-model Y position correction', min: -2, max: 2, step: 0.01 },
    { key: 'z', label: 'Hand-model Z position correction', min: -2, max: 2, step: 0.01 },
  ];
  const rotationFields = [
    { key: 'x', label: 'GLB local X rotation correction°', min: -180, max: 180, step: 1 },
    { key: 'y', label: 'GLB local Y rotation correction°', min: -180, max: 180, step: 1 },
    { key: 'z', label: 'GLB local Z rotation correction°', min: -180, max: 180, step: 1 },
  ];

  function fieldMarkup(prefix, field) {
    return `<div class="field"><label>${field.label}</label><div class="fieldRow">
      <input id="${prefix}_${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}">
      <input id="${prefix}_${field.key}_n" type="number" min="${field.min}" max="${field.max}" step="${field.step}" style="width:78px;flex:0 0 78px">
    </div></div>`;
  }
  $('handFromToolPositionFields').innerHTML = positionFields.map(field => fieldMarkup('handFromToolPos', field)).join('');
  $('handFromToolRotationFields').innerHTML = rotationFields.map(field => fieldMarkup('handFromToolRot', field)).join('');

  const paperGuideToggle = $('handShowPaperHandGuide'); // Disabled indicator: the neutral reference is mandatory whenever calibration mode is active.
  function syncPaperHandGuide() {
    const active = global.HobunjiAttackEditorHandCalibrationMode?.active === true;
    if (paperGuideToggle) paperGuideToggle.checked = active;
    hands.setShowPaperHandGuide?.(active);
  }

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
    syncLocalRotationStatus();
  }

  function localEulerFromQuaternion(raw) {
    const q = raw || {};
    const THREE = global.HobunjiAttackEditorToolContext?.THREE;
    if (!THREE || ![q.x, q.y, q.z, q.w].every(value => Number.isFinite(Number(value)))) return null;
    const euler = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(Number(q.x), Number(q.y), Number(q.z), Number(q.w)).normalize(),
      'YXZ',
    ); // Reads the calibration CHILD's local quaternion only; parent/world transforms never enter this display.
    return {
      pitch: THREE.MathUtils.radToDeg(euler.x),
      yaw: THREE.MathUtils.radToDeg(euler.y),
      roll: THREE.MathUtils.radToDeg(euler.z),
    };
  }

  function syncLocalRotationStatus() {
    const transform = profiles.normalizeHandTransform?.(currentModel()?.handFromTool) || currentModel()?.handFromTool || {};
    const local = localEulerFromQuaternion(transform.rotationQuaternion);
    const status = $('handLocalRotationStatus');
    if (!status) return;
    status.textContent = local
      ? `Final child-local orientation · X/P ${local.pitch.toFixed(2)}° · Y ${local.yaw.toFixed(2)}° · Z/R ${local.roll.toFixed(2)}°`
      : 'Final child-local orientation pending.';
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
      const active = global.HobunjiAttackEditorHandCalibrationMode?.active === true;
      const child = d?.hand?.toolCalibration?.right || null; // Mobile-visible proof that the authored correction reached the dedicated GLB child.
      const q = child?.quaternion;
      const qText = q ? `q=${[q.x,q.y,q.z,q.w].map(value => Number(value).toFixed(3)).join('/')}` : 'q=pending';
      const pos = child?.position;
      const posText = pos ? `childPos=${[pos.x,pos.y,pos.z].map(value => Number(value).toFixed(3)).join('/')}` : 'childPos=pending';
      status.textContent = active
        ? `CALIBRATION ONLY · neutral paper world frame · authored ${shortTransform(authored)} · ${posText} · ${qText} · animation/grip/shoulder BYPASSED`
        : 'Open the Calibrate GLB tab to compare this model against the neutral paper hand.';
      status.style.color = active && child?.enabled ? '#67e8f9' : '';
    }
    syncLocalRotationStatus();
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

  $('handSnapLocalRotation90')?.addEventListener('click', () => {
    const key = profileSelect.value;
    const model = profiles.data.models?.[key];
    if (!model) return;
    const normalized = profiles.normalizeHandTransform?.(model.handFromTool) || model.handFromTool;
    const snapped = profiles.snapQuaternionToRightAngles?.(normalized?.rotationQuaternion); // Snaps the FINAL child-local GLB orientation, never world/parent rotation or raw slider coordinates.
    if (!snapped?.quaternion) return;
    profiles.updateModelHandTransform?.(key, transform => {
      transform.rotationDeg = { ...snapped.rotationDeg }; // Legacy-readable local YXZ representation of the exact snapped child orientation.
      transform.rotationBaseQuaternion = { ...snapped.quaternion }; // Bakes the exact local right-angle quaternion as the new calibration base.
      transform.rotationCorrectionDeg = { x: 0, y: 0, z: 0 }; // Corrections reset because their result is now absorbed into the local base.
    });
    syncFields();
    syncPreview();
  });

  profileSelect.addEventListener('change', () => { syncFields(); syncPreview(); });
  profiles.subscribe?.((_data, change) => {
    if (!change?.modelKey || change.modelKey === profileSelect.value || change.kind === 'replace') syncFields();
  });
  global.HobunjiAttackEditorHandCalibrationMode?.subscribe?.(() => {
    syncPaperHandGuide();
    syncPreview();
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
