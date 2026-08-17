// Direct inverse-hand authoring overlay for the Attack Animation Editor.
// The existing hand configurator still owns GLB selection, scale, imports and
// species overrides. This adapter replaces the old "tool socket on hand" UI with
// a direct hand-root transform relative to the tool attach frame, matching live
// runtime behavior and the arm-length pose clamp.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralArmAnimation;
  if (!profiles || !hands || !document.getElementById('handProfileSelect')) return;
  if (document.getElementById('handFromToolPositionFields')) return;

  const $ = id => document.getElementById(id);
  const profileSelect = $('handProfileSelect');
  const card = profileSelect.closest('.card');
  if (!card) return;

  // Hide the superseded socket-centric controls; their values are normalized to
  // identity by hand-model-profiles.js so they cannot double-transform the model.
  $('handGripPositionFields')?.closest('.poseGroup')?.style.setProperty('display', 'none');
  $('handGripRotationFields')?.closest('.poseGroup')?.style.setProperty('display', 'none');

  const topHelp = card.querySelector('.sectionTitle')?.nextElementSibling;
  if (topHelp?.classList.contains('help')) {
    topHelp.innerHTML = 'Final hand size = <b>model scale × species/gender scale</b>. The right hand is inverse-animated from the tool: author the hand root directly relative to the tool attach frame below.';
  }
  const tag = card.querySelector('.sectionTag');
  if (tag) tag.textContent = 'hand ← tool + species scale';

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
      <div class="poseGroupHead"><span class="dot" style="background:#34d399"></span>Hand position relative to tool attach</div>
      <div class="help" style="margin-bottom:6px">Direct inverse-animation offset. Values are normalized hand-height units and scale with the final model/species hand size.</div>
      <div id="handFromToolPositionFields"></div>
    </div>
    <div class="poseGroup" id="handFromToolRotationGroup">
      <div class="poseGroupHead"><span class="dot" style="background:#fbbf24"></span>Hand direction relative to tool attach</div>
      <div class="help" style="margin-bottom:6px">Pitch / yaw / roll rotate the hand from the tool attach orientation. The tool itself is not rotated to satisfy these values.</div>
      <div id="handFromToolRotationFields"></div>
    </div>
    <div class="help" id="handInverseLiveStatus" style="padding:7px;border:1px solid rgba(34,211,238,.22);border-radius:8px;margin-bottom:8px">Live inverse-hand preview ready.</div>
    <div class="help" id="handInverseReachHelp" style="padding:7px;border:1px solid rgba(52,211,153,.22);border-radius:8px;margin-bottom:8px">
      Tool pose is authoritative while reachable. If this hand target exceeds the current species' arm length, the tool's X/Y/Z are pulled inward only as far as needed. Paused Neutral/Windup/Strike keyframes are rewritten to the corrected coordinates, and the same clamp runs live in-game.
    </div>
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

  function syncPreview() {
    const results = global.ProceduralHandFrameDriver?.syncNow?.() || [];
    const live = results.find(Boolean) || null;
    const status = $('handInverseLiveStatus');
    if (status) {
      status.textContent = live?.clamped
        ? `Live preview: arm reach clamp active · tool translated ${live.clampDeltaWorld?.length?.().toFixed?.(3) ?? ''}`
        : 'Live preview: hand transform applied directly from the tool attach point.';
    }
    return results;
  }

  function mutateTransform(mutator) {
    const key = profileSelect.value;
    const model = profiles.data.models?.[key];
    if (!model) return;
    ensureTransform(model);
    // handFromTool is a live IK offset, not a model-asset change. Mutate the
    // existing profile object in place so slider motion does NOT trigger the
    // profile subscriber that rebuilds/reloads both GLB hands on every tick.
    mutator(model.handFromTool);
    global.HOBUNJI_HAND_MODEL_PROFILES = profiles.data;
    syncPreview();
    // The editor's animation loop reapplies the authored tool pose each frame;
    // run once more after that frame boundary so the hand visibly follows the
    // newest slider value even while playback is running.
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

  // When a pose slider is edited, ask the shared driver to resolve the current
  // hand target after the editor applies that pose on the next animation frame.
  // Any overreach is then written back through the editor's own X/Y/Z inputs.
  for (const phase of ['neutral', 'windup', 'strike']) {
    for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw']) {
      $(`${phase}_${key}`)?.addEventListener('input', () => {
        requestAnimationFrame(syncPreview);
      });
    }
  }

  syncFields();
  syncPreview();
})(window);
