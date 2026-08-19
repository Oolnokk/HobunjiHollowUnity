// Attack Editor controls for the runtime two-bone hand/forearm skin.
// Values belong to the reusable GLB model profile, not to a species or animation.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralHandAttachments;
  const defaults = global.ProceduralHandTwoBoneSkin?.defaults || {
    jointYPercent: 0.62,
    blendWidthPercent: 0.62,
    crossBoneWeight: 0.04,
  };
  const profileSelect = document.getElementById('handProfileSelect');
  if (!profiles || !hands || !profileSelect || document.getElementById('handForearmRigGroup')) return;

  const $ = id => document.getElementById(id);
  const card = profileSelect.closest('.card');
  if (!card) return;

  // The old shoulder-compass controls rotated the entire hand socket and are no
  // longer part of the runtime solve. Hide them so the editor cannot imply that
  // Pitch/Yaw/Roll shoulder flags still alter grip orientation.
  for (const box of document.querySelectorAll('[data-hand-shoulder-phase]')) box.style.display = 'none';
  const oldAnimationStatus = $('handShoulderAnimationStateStatus');
  if (oldAnimationStatus) oldAnimationStatus.style.display = 'none';
  const oldCompassStatus = $('handShoulderAimStatus');
  if (oldCompassStatus) oldCompassStatus.style.display = 'none';
  const shoulderPreview = $('handHideArmSpritesPreview')?.closest('.poseGroup');
  if (shoulderPreview) {
    const head = shoulderPreview.querySelector('.poseGroupHead');
    if (head) head.innerHTML = '<span class="dot" style="background:#fb7185"></span>Forearm shoulder tracking preview';
    const firstHelp = shoulderPreview.querySelector('.help');
    if (firstHelp) firstHelp.innerHTML = 'The <b>forearm bone always points at the shoulder</b>. Hand/grip direction is independent and never receives shoulder rotation. Arm hiding remains preview-only.';
  }

  const group = document.createElement('div');
  group.className = 'poseGroup';
  group.id = 'handForearmRigGroup';
  group.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Two-bone hand / forearm skin</div>
    <div class="help" style="margin-bottom:7px">The wrist joint is placed by this model's local Y-height percentage. Skinning uses a broad smoothstep and keeps a small non-zero influence from both bones across the mesh, avoiding a hard hinge seam.</div>
    <div class="field"><label>Forearm joint local Y <span id="handForearmJointVal"></span></label><div class="fieldRow">
      <input id="handForearmJoint" type="range" min="5" max="95" step="0.5">
      <input id="handForearmJointNumber" type="number" min="5" max="95" step="0.5" style="width:78px;flex:0 0 78px">
    </div></div>
    <div class="field"><label>Blend width <span id="handForearmBlendVal"></span></label><div class="fieldRow">
      <input id="handForearmBlend" type="range" min="5" max="150" step="1">
      <input id="handForearmBlendNumber" type="number" min="5" max="150" step="1" style="width:78px;flex:0 0 78px">
    </div></div>
    <div class="field"><label>Minimum opposite-bone influence <span id="handForearmCrossVal"></span></label><div class="fieldRow">
      <input id="handForearmCross" type="range" min="0.1" max="24" step="0.1">
      <input id="handForearmCrossNumber" type="number" min="0.1" max="24" step="0.1" style="width:78px;flex:0 0 78px">
    </div></div>
    <div class="help" id="handForearmRigStatus">Forearm rig pending.</div>
  `;

  const inverseStatus = $('handInverseLiveStatus');
  if (inverseStatus?.parentElement === card) card.insertBefore(group, inverseStatus);
  else card.appendChild(group);

  const jointRange = $('handForearmJoint');
  const jointNumber = $('handForearmJointNumber');
  const blendRange = $('handForearmBlend');
  const blendNumber = $('handForearmBlendNumber');
  const crossRange = $('handForearmCross');
  const crossNumber = $('handForearmCrossNumber');
  let refreshTimer = 0;

  function currentModel() {
    return profiles.data.models?.[profileSelect.value] || null;
  }

  function ensureConfig(model) {
    if (!model.forearmRig || typeof model.forearmRig !== 'object') model.forearmRig = {};
    if (!Number.isFinite(Number(model.forearmRig.jointYPercent))) model.forearmRig.jointYPercent = Number(defaults.jointYPercent) || 0.62;
    if (!Number.isFinite(Number(model.forearmRig.blendWidthPercent))) model.forearmRig.blendWidthPercent = Number(defaults.blendWidthPercent) || 0.62;
    if (!Number.isFinite(Number(model.forearmRig.crossBoneWeight))) model.forearmRig.crossBoneWeight = Number(defaults.crossBoneWeight) || 0.04;
    return model.forearmRig;
  }

  function paired(range, number, percent) {
    const value = Number(percent) || 0;
    range.value = Math.max(Number(range.min), Math.min(Number(range.max), value));
    number.value = value;
  }

  function syncFields() {
    const model = currentModel();
    if (!model) return;
    const cfg = ensureConfig(model);
    paired(jointRange, jointNumber, cfg.jointYPercent * 100);
    paired(blendRange, blendNumber, cfg.blendWidthPercent * 100);
    paired(crossRange, crossNumber, cfg.crossBoneWeight * 100);
    $('handForearmJointVal').textContent = `${(cfg.jointYPercent * 100).toFixed(1)}%`;
    $('handForearmBlendVal').textContent = `${(cfg.blendWidthPercent * 100).toFixed(0)}%`;
    $('handForearmCrossVal').textContent = `${(cfg.crossBoneWeight * 100).toFixed(1)}%`;
    updateStatus();
  }

  function scheduleRigRebuild() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      hands.refreshAllProfiles?.();
      global.ProceduralHandFrameDriver?.syncNow?.();
      setTimeout(updateStatus, 0);
    }, 90);
  }

  function mutateConfig(key, percent) {
    const model = currentModel();
    if (!model) return;
    const cfg = ensureConfig(model);
    cfg[key] = Math.max(0.001, Number(percent) / 100);
    global.HOBUNJI_HAND_MODEL_PROFILES = profiles.data;
    syncFields();
    scheduleRigRebuild();
  }

  function bindPair(range, number, key) {
    const apply = source => {
      const value = Number(source.value);
      if (!Number.isFinite(value)) return;
      paired(range, number, value);
      mutateConfig(key, value);
    };
    range.addEventListener('input', () => apply(range));
    number.addEventListener('input', () => apply(number));
  }

  bindPair(jointRange, jointNumber, 'jointYPercent');
  bindPair(blendRange, blendNumber, 'blendWidthPercent');
  bindPair(crossRange, crossNumber, 'crossBoneWeight');

  function currentDebug() {
    const species = String($('avatarSpecies')?.value || '');
    const gender = String($('avatarGender')?.value || 'male');
    const rows = global.ProceduralHandFrameDriver?.getDebug?.() || [];
    return rows.find(row => row?.speciesId === species && row?.gender === gender)
      || rows.find(row => row?.speciesId === species)
      || rows[0]
      || null;
  }

  function updateStatus() {
    const status = $('handForearmRigStatus');
    if (!status) return;
    const debug = currentDebug()?.hand?.twoBoneSkin?.sides?.right || null;
    if (!debug?.rigged) {
      status.textContent = 'Two-bone skin pending GLB load.';
      return;
    }
    status.textContent = `Right hand: joint ${(Number(debug.jointYPercent) * 100).toFixed(1)}% · blend ${(Number(debug.blendWidthPercent) * 100).toFixed(0)}% · cross ${(Number(debug.crossBoneWeight) * 100).toFixed(1)}% · forearm→shoulder residual ${Number(debug.residualDeg || 0).toFixed(2)}°.`;
  }

  profileSelect.addEventListener('change', syncFields);
  profiles.subscribe?.(() => setTimeout(syncFields, 0));
  setInterval(updateStatus, 400);
  syncFields();

  global.HobunjiAttackEditorHandForearmRig = Object.freeze({
    syncFields,
    updateStatus,
  });
})(window);