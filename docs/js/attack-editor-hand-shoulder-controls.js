// Attack Editor shoulder-compass authoring.
//
// X/Y/Z hand-rotation follow is stored PER POSE in the normal animation JSON
// (legacy data keys remain pitch/yaw/roll for compatibility). Checkbox states become
// 0..1 weights at runtime and lerp with the same Neutral/Windup/Strike phase
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

  const handCard = profileSelect.closest('.card');

  function checkboxId(phase, axis) {
    return `handShoulderAim_${phase}_${axis}`;
  }

  const followGroup = document.createElement('div'); // Hand-only orientation assist; deliberately lives outside the tool-pose controls.
  followGroup.className = 'poseGroup';
  followGroup.id = 'handShoulderFollowGroup';
  followGroup.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Hand shoulder-follow by animation pose</div>
    <div class="help" style="margin-bottom:7px"><b>This rotates the HAND, never the weapon.</b> Each checkbox lets that hand orientation axis follow toward the shoulder during the named pose. X/Y/Z below are hand rotations; stored legacy keys are pitch/yaw/roll.</div>
    ${PHASES.map(phase => `
      <div class="field" data-hand-shoulder-phase="${phase}">
        <label>${phase[0].toUpperCase() + phase.slice(1)} hand follow</label>
        <div class="row" style="gap:9px;flex-wrap:wrap">
          ${[['pitch','X'],['yaw','Y'],['roll','Z']].map(([axis,label]) => `<label class="fieldRow" style="cursor:pointer;margin:0"><input id="${checkboxId(phase, axis)}" type="checkbox" style="width:auto">${label} rotation → shoulder</label>`).join('')}
        </div>
      </div>`).join('')}
  `;
  handCard?.appendChild(followGroup);

  const previewGroup = document.createElement('div');
  previewGroup.className = 'poseGroup';
  previewGroup.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Shoulder-follow preview</div>
    <div class="help" style="margin-bottom:7px">Neutral defaults to <b>X + Z rotation follow</b>. Windup and Strike default to <b>Z only</b>. The three pose settings blend continuously with the animation.</div>
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
    compassStatus.textContent = `Live hand-follow lerp: X rotation ${(weights.pitch * 100).toFixed(0)}% · Y rotation ${(weights.yaw * 100).toFixed(0)}% · Z rotation ${(weights.roll * 100).toFixed(0)}% · arms ${hideArmSprites ? 'hidden' : 'visible'}.`;
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

  function setAxis(phase, axis, value) {
    poseAim[phase][axis] = !!value;
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



  // Keep the live status useful while playback/scrubbing changes interpolation.
  let lastStatusSignature = '';
  function statusFrame() {
    const w = currentWeights();
    const signature = `${hideArmSprites}|${w.pitch.toFixed(2)}|${w.yaw.toFixed(2)}|${w.roll.toFixed(2)}`;
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
    loadFromAnimationObject(parsed) {
      for (const phase of PHASES) {
        poseAim[phase] = normalizeBooleanAim(parsed?.poses?.[phase]?.shoulderAim, DEFAULTS[phase]);
      }
      syncCheckboxes();
      refreshJsonExtension();
      global.ProceduralHandFrameDriver?.syncNow?.();
      return true;
    },
    get poseAim() { return JSON.parse(JSON.stringify(poseAim)); },
    currentWeights,
    snapshot() {
      return { hideArmSprites, poseAim: JSON.parse(JSON.stringify(poseAim)) }; // Undo/Redo preserves all three hidden pose states.
    },
    restore(snapshot) {
      if (!snapshot) return false;
      hideArmSprites = snapshot.hideArmSprites === true;
      for (const phase of PHASES) poseAim[phase] = normalizeBooleanAim(snapshot.poseAim?.[phase], DEFAULTS[phase]);
      syncCheckboxes();
      refreshJsonExtension();
      requestPreviewRebuild();
      global.ProceduralHandFrameDriver?.syncNow?.();
      return true;
    },
    setHideArmSprites(value) {
      hideArmSprites = !!value;
      syncCheckboxes();
      requestPreviewRebuild();
    },
    syncControls: syncCheckboxes,
  };
})(window);