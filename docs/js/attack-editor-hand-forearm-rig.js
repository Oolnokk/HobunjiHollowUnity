// Attack Editor controls for the separated hand/forearm rig.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralHandAttachments;
  const basisApi = global.HobunjiHandToolSemanticBasis;
  const settings = global.HobunjiHandExperimentalRigSettings;
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

  // Keep the promising per-axis forearm experiment easy to disable without ever
  // handing shoulder authority back to the hand/grip socket.
  const experimental = document.createElement('div');
  experimental.className = 'poseGroup';
  experimental.id = 'handExperimentalRigGroup';
  experimental.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#f472b6"></span>Experimental forearm tracking</div>
    <div class="field"><label class="fieldRow" style="cursor:pointer;margin:0">
      <input id="handExperimentalForearmAxes" type="checkbox" style="width:auto;margin-right:6px">
      Per-axis forearm target tracking
    </label></div>
    <div class="help">On by default. Checked Pitch/Yaw/Roll components follow the shoulder target. Unchecked components stay at identity on the forearm child bone, so those axes inherit the hand's authored grip direction.</div>
  `;
  const profileField = profileSelect.closest('.field');
  if (profileField?.parentElement === card) card.insertBefore(experimental, profileField);
  else card.prepend(experimental);

  // These legacy checkbox containers are retained as pose data, but now control
  // ONLY the child forearm bone. They never rotate the hand socket.
  for (const box of document.querySelectorAll('[data-hand-shoulder-phase]')) {
    box.style.display = '';
    const phase = box.dataset.handShoulderPhase || 'pose';
    const title = box.querySelector('.help b');
    if (title) title.textContent = `Forearm shoulder axes — ${phase}`;
    for (const axis of ['pitch', 'yaw', 'roll']) {
      const input = box.querySelector(`#handShoulderAim_${phase}_${axis}`);
      const label = input?.closest('label');
      if (!label) continue;
      const pretty = axis[0].toUpperCase() + axis.slice(1);
      for (const node of [...label.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.textContent = `${pretty} tracks shoulder`;
      }
    }
  }

  const oldAnimationStatus = $('handShoulderAnimationStateStatus');
  if (oldAnimationStatus) oldAnimationStatus.style.display = '';
  const oldCompassStatus = $('handShoulderAimStatus');
  if (oldCompassStatus) oldCompassStatus.style.display = '';
  const shoulderPreview = $('handHideArmSpritesPreview')?.closest('.poseGroup');
  if (shoulderPreview) {
    const head = shoulderPreview.querySelector('.poseGroupHead');
    if (head) head.innerHTML = '<span class="dot" style="background:#fb7185"></span>Forearm shoulder tracking preview';
    const firstHelp = shoulderPreview.querySelector('.help');
    if (firstHelp) firstHelp.innerHTML = '<b>Hand direction always remains grip-authored.</b> The forearm child bone can independently borrow selected Pitch/Yaw/Roll components from the shoulder-target solve.';
  }

  const group = document.createElement('div');
  group.className = 'poseGroup';
  group.id = 'handForearmRigGroup';
  group.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>GLB hand / forearm skin</div>
    <div class="help" style="margin-bottom:7px">The wrist direction now comes from the model's <b>semantic Fingers axis</b> (wrist = opposite Fingers), rather than assuming raw +Y. Joint and weights update live without reloading the GLB.</div>
    <div class="field"><label>Forearm joint toward wrist <span id="handForearmJointVal"></span></label><div class="fieldRow">
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
  const axisToggle = $('handExperimentalForearmAxes');
  let reloadTimer = 0;

  function currentModel() { return profiles.data.models?.[profileSelect.value] || null; }
  function ensureConfig(model) {
    if (!model.forearmRig || typeof model.forearmRig !== 'object') model.forearmRig = {};
    // jointYPercent is retained as the persisted compatibility key; runtime now
    // interprets it as percent along the semantic wrist axis.
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

  function syncExperimentalUi() {
    axisToggle.checked = settings?.forearmAxisTracking !== false;
    const enabled = axisToggle.checked;
    for (const box of document.querySelectorAll('[data-hand-shoulder-phase]')) {
      box.style.opacity = enabled ? '1' : '0.48';
      for (const input of box.querySelectorAll('input[type=checkbox]')) input.disabled = !enabled;
    }
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
    syncExperimentalUi();
    updateStatus();
  }

  function refreshLive() {
    global.ProceduralHandTwoBoneSkin?.refreshAll?.();
    global.ProceduralHandFrameDriver?.syncNow?.();
    requestAnimationFrame(() => {
      global.ProceduralHandTwoBoneSkin?.refreshAll?.();
      global.ProceduralHandFrameDriver?.syncNow?.();
      updateStatus();
    });
  }
  function scheduleModelReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      hands.refreshAllProfiles?.();
      global.ProceduralHandFrameDriver?.syncNow?.();
    }, 45);
  }

  function mutateConfig(key, percent) {
    const model = currentModel();
    if (!model) return;
    const cfg = ensureConfig(model);
    cfg[key] = Math.max(0.001, Number(percent) / 100);
    global.HOBUNJI_HAND_MODEL_PROFILES = profiles.data;
    syncFields();
    refreshLive();
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

  axisToggle.addEventListener('change', () => {
    settings?.setForearmAxisTracking?.(axisToggle.checked);
    syncExperimentalUi();
    refreshLive();
  });
  settings?.subscribe?.(() => syncExperimentalUi());

  // One delegated live-sync safety net covers the independently-authored hand
  // editor adapters. Socket/grip values update immediately; settings that genuinely
  // alter the imported GLB use a short debounced profile reload.
  function liveInput(event) {
    const id = String(event.target?.id || '');
    if (!id || !event.target?.closest?.('.card') || event.target.closest('.card') !== card) return;
    refreshLive();
    if (/^(handModelScale|handSpeciesScale|handMirrorGlbX|handSpeciesModelSelect)/.test(id)) scheduleModelReload();
  }
  card.addEventListener('input', liveInput);
  card.addEventListener('change', liveInput);

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
    const hand = currentDebug()?.hand || null;
    const debug = hand?.twoBoneSkin?.sides?.right || null;
    if (!debug?.rigged) {
      const audit = basisApi?.handTransformAuditForModel?.(profileSelect.value) || null;
      status.textContent = `Two-bone skin pending GLB load · semantic wrist ${audit?.wristVector ? JSON.stringify(audit.wristVector) : '+Y legacy'}.`;
      return;
    }
    const weights = debug.axisWeights || {};
    status.textContent = `Right: wrist ${debug.wristAxisLabel || '+Y'} · joint ${(Number(debug.jointYPercent) * 100).toFixed(1)}% · blend ${(Number(debug.blendWidthPercent) * 100).toFixed(0)}% · cross ${(Number(debug.crossBoneWeight) * 100).toFixed(1)}% · shoulder axes P/Y/R ${(Number(weights.pitch) * 100).toFixed(0)}/${(Number(weights.yaw) * 100).toFixed(0)}/${(Number(weights.roll) * 100).toFixed(0)}% · residual ${Number(debug.residualDeg || 0).toFixed(2)}°.`;
  }

  profileSelect.addEventListener('change', syncFields);
  profiles.subscribe?.(() => setTimeout(syncFields, 0));
  setInterval(updateStatus, 350);
  syncFields();
  refreshLive();

  global.HobunjiAttackEditorHandForearmRig = Object.freeze({
    syncFields,
    syncExperimentalUi,
    refreshLive,
    updateStatus,
  });
})(window);
