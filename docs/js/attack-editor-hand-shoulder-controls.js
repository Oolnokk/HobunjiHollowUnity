// Attack Editor shoulder-compass authoring.
//
// Pitch/Yaw/Roll are stored PER POSE in the normal animation JSON. Checkbox states
// become 0..1 weights at runtime and lerp with the same Neutral/Windup/Strike phase
// curve as the tool pose. Arm hiding remains a preview-only convenience.
(function (global) {
  'use strict';

  const poseRuntime = global.HobunjiHandShoulderPoseRuntime;
  const profileSelect = document.getElementById('handProfileSelect');
  if (!profileSelect || global.HobunjiAttackEditorHandShoulderControls) return;

  const PHASES = ['neutral', 'windup', 'strike'];
  const DEFAULTS = Object.freeze({
    neutral: Object.freeze({ pitch: true, yaw: false, roll: true }),
    windup: Object.freeze({ pitch: false, yaw: false, roll: true }),
    strike: Object.freeze({ pitch: false, yaw: false, roll: true }),
  });
  const poseAim = Object.fromEntries(PHASES.map(phase => [phase, { ...DEFAULTS[phase] }]));
  let hideArmSprites = false;
  let poseAimSource = 'defaults'; // Shown in the mobile-readable status so preset/reset/import state transitions are easy to verify.

  function resolvedFighter(profile) {
    const fighter = profile?.fighter || null;
    if (!fighter) return null;
    const fighters = global.getPortraitFighters?.() || [];
    return fighters.find(candidate => candidate?.id === fighter.id)
      || (fighter.headUrl ? fighters.find(candidate => candidate?.headUrl === fighter.headUrl) : null)
      || fighter;
  }

  function noArmPreviewProfile(profile) {
    if (!hideArmSprites || !profile?.fighter) return profile;
    const sourceFighter = resolvedFighter(profile);
    if (!sourceFighter) return profile;
    const bodyLayers = (sourceFighter.bodyLayers || []).filter(layer => !/arm[lr]/i.test(String(layer?.id || '')));
    // Private identity prevents portrait-utils from resolving this temporary clone
    // straight back to the catalog fighter and restoring its arms.
    const headUrl = sourceFighter.headUrl
      ? `${sourceFighter.headUrl}${String(sourceFighter.headUrl).includes('?') ? '&' : '?'}hobunjiHideArms=1`
      : sourceFighter.headUrl;
    return {
      ...profile,
      fighter: {
        ...sourceFighter,
        id: `__hobunji_no_arm_preview__${sourceFighter.id || 'fighter'}`,
        originalId: sourceFighter.id,
        headUrl,
        bodyLayers,
      },
      __hobunjiShoulderSourceFighter: sourceFighter,
    };
  }

  const previewApi = global.NpcAvatarPreview;
  if (previewApi?.renderProfileToCanvas && !previewApi.renderProfileToCanvas.__hobunjiAttackEditorArmHideWrapped) {
    const originalPreviewRender = previewApi.renderProfileToCanvas.bind(previewApi);
    const wrappedPreviewRender = async function attackEditorArmHidePreview(canvas, profile, renderOptions = {}) {
      const result = await originalPreviewRender(canvas, hideArmSprites ? noArmPreviewProfile(profile) : profile, renderOptions);
      if (hideArmSprites && canvas) canvas.hobunjiArmCloudAlphaMap = null;
      return result;
    };
    wrappedPreviewRender.__hobunjiAttackEditorArmHideWrapped = true;
    previewApi.renderProfileToCanvas = wrappedPreviewRender;
  }

  function checkboxId(phase, axis) {
    return `handShoulderAim_${phase}_${axis}`;
  }

  function addPoseControls(phase) {
    const panel = document.getElementById(`panel${phase[0].toUpperCase()}${phase.slice(1)}`);
    const group = panel?.closest('.poseGroup');
    if (!group || group.querySelector(`[data-hand-shoulder-phase="${phase}"]`)) return;
    const box = document.createElement('div');
    box.dataset.handShoulderPhase = phase;
    box.style.cssText = 'margin-top:8px;padding:7px;border:1px solid rgba(251,113,133,.22);border-radius:8px;background:rgba(251,113,133,.045)';
    box.innerHTML = `
      <div class="help" style="margin-bottom:5px"><b>Shoulder compass — ${phase}</b></div>
      <div class="row" style="gap:12px">
        ${['pitch','yaw','roll'].map(axis => `<label class="fieldRow" style="cursor:pointer;margin:0"><input id="${checkboxId(phase, axis)}" type="checkbox" style="width:auto">${axis[0].toUpperCase()}${axis.slice(1)} → shoulder</label>`).join('')}
      </div>
    `;
    const scrubButton = group.querySelector('button');
    group.insertBefore(box, scrubButton || null);
  }
  PHASES.forEach(addPoseControls);

  const handCard = profileSelect.closest('.card');
  const previewGroup = document.createElement('div');
  previewGroup.className = 'poseGroup';
  previewGroup.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Shoulder compass preview</div>
    <div class="help" style="margin-bottom:7px">Neutral defaults to <b>Pitch + Roll</b>. Windup and Strike default to <b>Roll only</b>. Different boxes blend continuously with the animation lerp.</div>
    <div class="field"><label class="fieldRow" style="cursor:pointer"><input id="handHideArmSpritesPreview" type="checkbox" style="width:auto;margin-right:6px">Hide arm sprites in preview</label></div>
    <div class="help" id="handShoulderAimStatus">Arm hiding is preview-only and is not exported.</div>
  `;
  const status = document.getElementById('handEffectiveStatus');
  if (status?.parentElement === handCard) handCard.insertBefore(previewGroup, status);
  else handCard?.appendChild(previewGroup);

  const hide = document.getElementById('handHideArmSpritesPreview');
  const compassStatus = document.getElementById('handShoulderAimStatus');
  const jsonView = document.getElementById('jsonView');
  const loadFile = document.getElementById('loadFile');
  const resetPosesButton = document.getElementById('resetPosesBtn'); // Used below to restore shoulder metadata whenever numeric poses are reset.
  const loadPresetButton = document.getElementById('loadPresetBtn'); // Used below to prevent a newly loaded preset inheriting the previous animation's shoulder metadata.
  const presetSelect = document.getElementById('presetSelect'); // Supplies the selected preset id to the post-preset shoulder-state restore.
  if (!hide || !compassStatus || !jsonView) return;

  function normalizeBooleanAim(raw, fallback) {
    return {
      pitch: raw?.pitch === true ? true : raw?.pitch === false ? false : !!fallback.pitch,
      yaw: raw?.yaw === true ? true : raw?.yaw === false ? false : !!fallback.yaw,
      roll: raw?.roll === true ? true : raw?.roll === false ? false : !!fallback.roll,
    };
  }

  function syncCheckboxes() {
    for (const phase of PHASES) {
      for (const axis of ['pitch','yaw','roll']) {
        const input = document.getElementById(checkboxId(phase, axis));
        if (input) input.checked = !!poseAim[phase][axis];
      }
    }
    hide.checked = hideArmSprites;
    const weights = currentWeights();
    compassStatus.textContent = `Live lerp: Pitch ${(weights.pitch * 100).toFixed(0)}% · Yaw ${(weights.yaw * 100).toFixed(0)}% · Roll ${(weights.roll * 100).toFixed(0)}% · arms ${hideArmSprites ? 'hidden' : 'visible'} · source ${poseAimSource}.`;
  }

  function injectPoseAimIntoObject(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    if (!parsed.poses || typeof parsed.poses !== 'object') parsed.poses = {};
    for (const phase of PHASES) {
      if (!parsed.poses[phase] || typeof parsed.poses[phase] !== 'object') parsed.poses[phase] = {};
      parsed.poses[phase].shoulderAim = { ...poseAim[phase] };
    }
    return parsed;
  }

  function jsonWithPoseAim(raw) {
    try { return JSON.stringify(injectPoseAimIntoObject(JSON.parse(String(raw || ''))), null, 2); }
    catch (_) { return raw; }
  }

  // Compose on top of grip-mode's existing jsonView wrapper rather than replacing
  // its behavior. Its export handler now reads jsonView.value publicly, so both
  // independent extensions survive normal refresh, copy, and download.
  const previousValueDescriptor = Object.getOwnPropertyDescriptor(jsonView, 'value')
    || Object.getOwnPropertyDescriptor(global.HTMLTextAreaElement?.prototype || {}, 'value');
  if (previousValueDescriptor?.get && previousValueDescriptor?.set && !jsonView.__hobunjiShoulderPoseValueWrapped) {
    Object.defineProperty(jsonView, 'value', {
      configurable: true,
      enumerable: true,
      get() { return previousValueDescriptor.get.call(this); },
      set(value) { previousValueDescriptor.set.call(this, jsonWithPoseAim(value)); },
    });
    Object.defineProperty(jsonView, '__hobunjiShoulderPoseValueWrapped', { value: true, configurable: true });
  }

  function refreshJsonExtension() {
    try { jsonView.value = jsonView.value; } catch (_) {}
  }

  function replacePoseAim(source, sourceLabel) {
    for (const phase of PHASES) poseAim[phase] = normalizeBooleanAim(source?.[phase]?.shoulderAim, DEFAULTS[phase]);
    poseAimSource = sourceLabel || 'defaults';
    syncCheckboxes();
    refreshJsonExtension();
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function setAxis(phase, axis, value) {
    poseAim[phase][axis] = !!value;
    poseAimSource = 'manual edit';
    refreshJsonExtension();
    global.ProceduralHandFrameDriver?.syncNow?.();
    syncCheckboxes();
  }

  for (const phase of PHASES) {
    for (const axis of ['pitch','yaw','roll']) {
      document.getElementById(checkboxId(phase, axis))?.addEventListener('change', event => setAxis(phase, axis, event.currentTarget.checked));
    }
  }

  function progressFromTimeline() {
    const marker = document.getElementById('timelineMarker');
    const raw = parseFloat(marker?.style?.left || '0');
    return Math.max(0, Math.min(1, Number.isFinite(raw) ? raw / 100 : Number(document.getElementById('scrub')?.value) || 0));
  }

  function currentWeights() {
    const progress = progressFromTimeline();
    const timing = {
      windupFrac: Number(document.getElementById('windupFrac')?.value) || 0.16,
      strikeFrac: Number(document.getElementById('strikeFrac')?.value) || 0.55,
      holdFrac: Number(document.getElementById('holdFrac')?.value) || 0.68,
    };
    const sequence = document.getElementById('playbackSequence')?.value || 'attack';
    if (poseRuntime?.weightsAt) return poseRuntime.weightsAt(progress, timing, poseAim, sequence);
    return progress <= timing.windupFrac ? { pitch: 1 - progress / Math.max(1e-6, timing.windupFrac), yaw: 0, roll: 1 } : { pitch: 0, yaw: 0, roll: 1 };
  }

  function requestPreviewRebuild() {
    const species = document.getElementById('avatarSpecies');
    if (species) species.dispatchEvent(new Event('change', { bubbles: true }));
    else global.ProceduralHandFrameDriver?.syncNow?.();
  }

  hide.addEventListener('change', () => {
    hideArmSprites = hide.checked;
    syncCheckboxes();
    requestPreviewRebuild();
  });

  resetPosesButton?.addEventListener('click', () => {
    // Numeric Reset returns to the editor's canonical pose defaults; keep the
    // independently-owned shoulder metadata on the same deterministic reset path.
    setTimeout(() => replacePoseAim(null, 'pose reset'), 0);
  });

  loadPresetButton?.addEventListener('click', () => {
    const presetId = String(presetSelect?.value || ''); // Captured before the core module swaps pose data later in the same click dispatch.
    setTimeout(() => {
      const sharedPoses = presetId === 'drink' ? global.HeldActionAnimations?.drink?.poses : null;
      replacePoseAim(sharedPoses, sharedPoses ? `preset ${presetId}` : `preset ${presetId || 'default'}`);
    }, 0);
  });

  // Restore per-pose boxes from exported JSON. Missing older data deliberately
  // migrates to Neutral Pitch+Roll and active Roll-only.
  loadFile?.addEventListener('change', async () => {
    const file = loadFile.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      replacePoseAim(parsed?.poses, 'JSON import');
    } catch (_) {}
  });

  // Keep the live status useful while playback/scrubbing changes interpolation.
  let lastStatusSignature = '';
  function statusFrame() {
    const w = currentWeights();
    const signature = `${hideArmSprites}|${poseAimSource}|${w.pitch.toFixed(2)}|${w.yaw.toFixed(2)}|${w.roll.toFixed(2)}`;
    if (signature !== lastStatusSignature) {
      lastStatusSignature = signature;
      syncCheckboxes();
    }
    requestAnimationFrame(statusFrame);
  }

  syncCheckboxes();
  refreshJsonExtension();
  requestAnimationFrame(statusFrame);

  global.HobunjiAttackEditorHandShoulderControls = {
    get hideArmSprites() { return hideArmSprites; },
    get poseAim() { return JSON.parse(JSON.stringify(poseAim)); },
    get poseAimSource() { return poseAimSource; },
    currentWeights,
    setHideArmSprites(value) {
      hideArmSprites = !!value;
      syncCheckboxes();
      requestPreviewRebuild();
    },
    syncControls: syncCheckboxes,
  };
})(window);