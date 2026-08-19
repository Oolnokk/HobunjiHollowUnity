// Attack Editor controls for the separated hand/forearm/bicep rig.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralHandAttachments;
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

  // Master switches live at the top because both systems are intentionally easy
  // to disable while their behavior is still being tuned.
  const experimental = document.createElement('div');
  experimental.className = 'poseGroup';
  experimental.id = 'handExperimentalRigGroup';
  experimental.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#f472b6"></span>Experimental arm rig</div>
    <div class="field"><label class="fieldRow" style="cursor:pointer;margin:0">
      <input id="handExperimentalForearmAxes" type="checkbox" style="width:auto;margin-right:6px">
      Per-axis forearm target tracking
    </label></div>
    <div class="help" style="margin:4px 0 8px">Checked Pitch/Yaw/Roll components come from the forearm target. Unchecked components stay at identity on the forearm bone and therefore inherit the hand/grip direction.</div>
    <div class="field"><label class="fieldRow" style="cursor:pointer;margin:0">
      <input id="handExperimentalBicepElbow" type="checkbox" style="width:auto;margin-right:6px">
      PNG bicep + pose elbow tracking
    </label></div>
    <div class="help">When enabled, both the GLB forearm and the painted PNG arm aim at the pose's 3D elbow target. Neither bone is translated to that target.</div>
  `;
  const profileField = profileSelect.closest('.field');
  if (profileField?.parentElement === card) card.insertBefore(experimental, profileField);
  else card.prepend(experimental);

  // Restore the old per-pose checkboxes, but redefine them strictly as FOREARM
  // child-bone axes. They no longer rotate the hand socket or grip frame.
  for (const box of document.querySelectorAll('[data-hand-shoulder-phase]')) {
    box.style.display = '';
    const phase = box.dataset.handShoulderPhase || 'pose';
    const title = box.querySelector('.help b');
    if (title) title.textContent = `Forearm target axes — ${phase}`;
    for (const axis of ['pitch', 'yaw', 'roll']) {
      const input = box.querySelector(`#handShoulderAim_${phase}_${axis}`);
      const label = input?.closest('label');
      if (!label) continue;
      const pretty = axis[0].toUpperCase() + axis.slice(1);
      for (const node of [...label.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.textContent = `${pretty} tracks target`;
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
    if (head) head.innerHTML = '<span class="dot" style="background:#fb7185"></span>Forearm / bicep target preview';
    const firstHelp = shoulderPreview.querySelector('.help');
    if (firstHelp) firstHelp.innerHTML = '<b>Hand direction always remains grip-authored.</b> Forearm axes optionally track the active shoulder/elbow target. The bicep experiment uses the PNG arm silhouette and the same elbow target.';
  }

  const group = document.createElement('div');
  group.className = 'poseGroup';
  group.id = 'handForearmRigGroup';
  group.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>GLB hand / forearm skin</div>
    <div class="help" style="margin-bottom:7px">Source GLB basis: <b>+Y wrist</b> · <b>+Z palm</b> · <b>+X thumb</b>. Joint and weights update live without reloading the GLB.</div>
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
  const axisToggle = $('handExperimentalForearmAxes');
  const bicepToggle = $('handExperimentalBicepElbow');
  let reloadTimer = 0;

  function currentModel() { return profiles.data.models?.[profileSelect.value] || null; }
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

  function syncExperimentalUi() {
    axisToggle.checked = settings?.forearmAxisTracking !== false;
    bicepToggle.checked = settings?.bicepElbowTracking === true;
    const enabled = axisToggle.checked;
    for (const box of document.querySelectorAll('[data-hand-shoulder-phase]')) {
      box.style.opacity = enabled ? '1' : '0.48';
      for (const input of box.querySelectorAll('input[type=checkbox]')) input.disabled = !enabled;
    }
    global.HobunjiAttackEditorElbowControls?.syncVisibility?.();
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
  bicepToggle.addEventListener('change', () => {
    settings?.setBicepElbowTracking?.(bicepToggle.checked);
    syncExperimentalUi();
    refreshLive();
  });
  settings?.subscribe?.(() => syncExperimentalUi());

  // One delegated live-sync safety net covers the many independently-authored hand
  // editor adapters. Socket/grip values update the frame immediately; settings that
  // genuinely alter the imported GLB (scale/mirror/model mapping) get a short
  // debounced reload instead of waiting for some unrelated control to rebuild it.
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
    const shoulder = hand?.shoulderCompass?.sides?.right || null;
    if (!debug?.rigged) {
      status.textContent = 'Two-bone skin pending GLB load.';
      return;
    }
    const weights = debug.axisWeights || {};
    status.textContent = `Right: joint ${(Number(debug.jointYPercent) * 100).toFixed(1)}% · blend ${(Number(debug.blendWidthPercent) * 100).toFixed(0)}% · cross ${(Number(debug.crossBoneWeight) * 100).toFixed(1)}% · target=${debug.targetKind || 'shoulder'} · axes P/Y/R ${(Number(weights.pitch) * 100).toFixed(0)}/${(Number(weights.yaw) * 100).toFixed(0)}/${(Number(weights.roll) * 100).toFixed(0)}% · forearm residual ${Number(debug.residualDeg || 0).toFixed(2)}°${shoulder?.bicepResidualDeg != null ? ` · bicep ${Number(shoulder.bicepResidualDeg).toFixed(2)}°` : ''}.`;
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
