// Attack Editor hand/elbow targeting authoring.
//
// Each pose controls two meaningful HAND-LOCAL hinges: grip axis (local X) and
// palm-normal axis (local Z). Legacy pitch/roll animation data migrates into those
// hinges on load. Arm hiding and the paper-arm overlay remain preview-only.
(function (global) {
  'use strict';

  const poseRuntime = global.HobunjiHandShoulderPoseRuntime;
  const profileSelect = document.getElementById('handProfileSelect');
  if (!profileSelect || global.HobunjiAttackEditorHandShoulderControls) return;

  const PHASES = ['neutral', 'windup', 'strike'];
  const AXES = ['grip', 'palmNormal']; // The only hand-local hinges permitted to aim the wrist toward its elbow.
  const SIDES = ['left', 'right'];
  const ELBOW_AXES = ['x', 'y', 'z'];
  const DEFAULTS = Object.freeze({
    neutral: Object.freeze({ grip: true, palmNormal: true }),
    windup: Object.freeze({ grip: false, palmNormal: true }),
    strike: Object.freeze({ grip: false, palmNormal: true }),
  });
  const poseAim = Object.fromEntries(PHASES.map(phase => [phase, { ...DEFAULTS[phase] }]));
  const poseElbows = Object.fromEntries(PHASES.map(phase => [phase, { left: null, right: null }]));
  let hideArmSprites = false;
  let showPaperArmGuide = false; // Preview-only elbow/arm-strip visualization; never exported into attack data.

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
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Hand elbow-targeting by animation pose</div>
    <div class="help" style="margin-bottom:7px"><b>This rotates the HAND, never the weapon.</b> The wrist-facing side aims toward the pose-authored elbow. Elbows are ordinary pose keyframes; there is no arm-length projection, reach clamp, or joint-limit solve. The two checkboxes only choose which hand-local hinges may rotate.</div>
    ${PHASES.map(phase => `
      <div class="field" data-hand-shoulder-phase="${phase}">
        <label>${phase[0].toUpperCase() + phase.slice(1)} hand follow</label>
        <div class="row" style="gap:9px;flex-wrap:wrap">
          ${[['grip','Grip axis (local X)'],['palmNormal','Palm-normal axis (local Z)']].map(([axis,label]) => `<label class="fieldRow" style="cursor:pointer;margin:0"><input id="${checkboxId(phase, axis)}" type="checkbox" style="width:auto">${label}</label>`).join('')}
        </div>
      </div>`).join('')}
  `;
  handCard?.appendChild(followGroup);

  const previewGroup = document.createElement('div');
  previewGroup.className = 'poseGroup';
  previewGroup.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Arm-targeting preview</div>
    <div class="help" style="margin-bottom:7px">Neutral defaults to both hinges. Windup and Strike default to the palm-normal hinge only. The three pose settings blend continuously with the animation.</div>
    <div class="field"><label class="fieldRow" style="cursor:pointer"><input id="handHideArmSpritesPreview" type="checkbox" style="width:auto;margin-right:6px">Hide arm sprites in preview</label></div>
    <div class="field"><label class="fieldRow" style="cursor:pointer"><input id="handShowPaperArmGuide" type="checkbox" style="width:auto;margin-right:6px">Show paper arm guide (upper arm + elbow + forearm)</label></div>
    <div class="help" id="handShoulderAimStatus">Preview helpers are not exported. The paper arm is diagnostic only and does not drive the hand.</div>
  `;
  const status = document.getElementById('handEffectiveStatus');
  if (status?.parentElement === handCard) handCard.insertBefore(previewGroup, status);
  else handCard?.appendChild(previewGroup);

  const hide = document.getElementById('handHideArmSpritesPreview');
  const paperArm = document.getElementById('handShowPaperArmGuide'); // Toggles the non-authoritative two-strip elbow guide in the live preview.
  const compassStatus = document.getElementById('handShoulderAimStatus');
  const jsonView = document.getElementById('jsonView');
  const loadFile = document.getElementById('loadFile');
  if (!hide || !paperArm || !compassStatus || !jsonView) return;

  function booleanAxis(raw, key, legacyKey, fallback) {
    const value = raw?.[key] ?? raw?.[legacyKey]; // Backward-compatible load only; new exports use semantic hinge names.
    return value === true ? true : value === false ? false : !!fallback;
  }
  function normalizeBooleanAim(raw, fallback) {
    return {
      grip: booleanAxis(raw, 'grip', 'pitch', fallback.grip),
      palmNormal: booleanAxis(raw, 'palmNormal', 'roll', fallback.palmNormal),
    };
  }
  function normalizeElbows(rawPose = {}) {
    return Object.fromEntries(SIDES.map(side => [
      side,
      poseRuntime?.normalizeElbowPoint?.(rawPose?.elbows?.[side] || rawPose?.elbow?.[side]) || null,
    ]));
  }

  function syncCheckboxes() {
    for (const phase of PHASES) {
      for (const axis of AXES) {
        const input = document.getElementById(checkboxId(phase, axis));
        if (input) input.checked = !!poseAim[phase][axis];
      }
    }
    hide.checked = hideArmSprites;
    paperArm.checked = showPaperArmGuide;
    const weights = currentWeights();
    const fmt = point => point ? `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})` : 'auto midpoint';
    compassStatus.textContent = `Live hand-follow: grip ${(weights.grip * 100).toFixed(0)}% · palm-normal ${(weights.palmNormal * 100).toFixed(0)}% · elbows L ${fmt(currentElbow('left'))} / R ${fmt(currentElbow('right'))} · arms ${hideArmSprites ? 'hidden' : 'visible'} · paper arm ${showPaperArmGuide ? 'shown' : 'hidden'}.`;
  }

  function injectPoseAimIntoObject(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    if (!parsed.poses || typeof parsed.poses !== 'object') parsed.poses = {};
    for (const phase of PHASES) {
      if (!parsed.poses[phase] || typeof parsed.poses[phase] !== 'object') parsed.poses[phase] = {};
      parsed.poses[phase].shoulderAim = { ...poseAim[phase] };
      const elbows = Object.fromEntries(SIDES
        .map(side => [side, poseElbows[phase]?.[side]])
        .filter(([, point]) => point)
        .map(([side, point]) => [side, { ...point }]));
      if (Object.keys(elbows).length) parsed.poses[phase].elbows = elbows;
      else delete parsed.poses[phase].elbows;
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
  function normalizePoint(point) {
    const x = Number(point?.x), y = Number(point?.y), z = Number(point?.z);
    return [x,y,z].every(Number.isFinite) ? { x, y, z } : null;
  }

  function elbowForPhase(phase, side) {
    const point = poseElbows?.[phase]?.[side];
    return point ? { ...point } : null;
  }

  function setElbowForPhase(phase, side, point) {
    if (!PHASES.includes(phase) || !SIDES.includes(side)) return false;
    poseElbows[phase][side] = normalizePoint(point);
    refreshJsonExtension();
    global.ProceduralHandFrameDriver?.syncNow?.();
    global.ProceduralHandShoulderAim?.refreshPaperArmGuides?.();
    global.syncPosePanelFromState?.(phase);
    return true;
  }

  function authorMidpointElbow(phase, side) {
    if (!PHASES.includes(phase) || !SIDES.includes(side)) return null;
    global.ProceduralHandFrameDriver?.syncNow?.();
    const species = String(document.getElementById('avatarSpecies')?.value || '').toLowerCase();
    const gender = String(document.getElementById('avatarGender')?.value || '').toLowerCase();
    const snapshots = global.ProceduralHandAttachments?.getActiveDebug?.() || [];
    const hasPoints = snapshot => snapshot?.shoulderCompass?.sides?.[side]?.shoulder
      && snapshot?.shoulderCompass?.sides?.[side]?.wrist;
    const matching = snapshots.find(snapshot =>
      hasPoints(snapshot)
      && (!species || String(snapshot?.speciesId || '').toLowerCase() === species)
      && (!gender || String(snapshot?.gender || '').toLowerCase() === gender)
    ) || snapshots.find(hasPoints);
    const sideDebug = matching?.shoulderCompass?.sides?.[side];
    const shoulder = sideDebug?.shoulder;
    const wrist = sideDebug?.wrist;
    if (!shoulder || !wrist) return null;
    // Editor-only convenience: persist the point halfway between the displayed
    // shoulder and wrist as a shoulder-relative elbow pose. Runtime never
    // recalculates, clamps, or otherwise owns this midpoint.
    const point = {
      x: (Number(wrist.x) - Number(shoulder.x)) * 0.5,
      y: (Number(wrist.y) - Number(shoulder.y)) * 0.5,
      z: (Number(wrist.z) - Number(shoulder.z)) * 0.5,
    };
    if (!normalizePoint(point)) return null;
    setElbowForPhase(phase, side, point);
    return { ...point };
  }

  for (const phase of PHASES) {
    for (const axis of AXES) {
      document.getElementById(checkboxId(phase, axis))?.addEventListener('change', event => setAxis(phase, axis, event.currentTarget.checked));
    }
  }

  function progressFromTimeline() {
    const marker = document.getElementById('timelineMarker');
    const raw = parseFloat(marker?.style?.left || '0');
    return Math.max(0, Math.min(1, Number.isFinite(raw) ? raw / 100 : Number(document.getElementById('scrub')?.value) || 0));
  }

  function currentTiming() {
    return {
      windupFrac: Number(document.getElementById('windupFrac')?.value) || 0.16,
      strikeFrac: Number(document.getElementById('strikeFrac')?.value) || 0.55,
      holdFrac: Number(document.getElementById('holdFrac')?.value) || 0.68,
    };
  }
  function currentWeights() {
    const progress = progressFromTimeline();
    const timing = currentTiming();
    const sequence = document.getElementById('playbackSequence')?.value || 'attack';
    if (poseRuntime?.weightsAt) return poseRuntime.weightsAt(progress, timing, poseAim, sequence);
    return progress <= timing.windupFrac ? { grip: 1 - progress / Math.max(1e-6, timing.windupFrac), palmNormal: 1 } : { grip: 0, palmNormal: 1 };
  }
  function poseSetForRuntime() {
    return Object.fromEntries(PHASES.map(phase => [phase, {
      shoulderAim: { ...poseAim[phase] },
      elbows: Object.fromEntries(SIDES
        .map(side => [side, poseElbows[phase]?.[side]])
        .filter(([, point]) => point)
        .map(([side, point]) => [side, { ...point }])),
    }]));
  }
  function currentElbow(side) {
    const progress = progressFromTimeline();
    const timing = currentTiming();
    const sequence = document.getElementById('playbackSequence')?.value || 'attack';
    if (poseRuntime?.elbowAt) return poseRuntime.elbowAt(progress, timing, poseSetForRuntime(), sequence, side);
    return null;
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
  paperArm.addEventListener('change', () => {
    showPaperArmGuide = paperArm.checked;
    global.ProceduralHandShoulderAim?.setPaperArmGuideVisible?.(showPaperArmGuide);
    syncCheckboxes();
    global.ProceduralHandFrameDriver?.syncNow?.();
  });


  // Keep the live status useful while playback/scrubbing changes interpolation.
  let lastStatusSignature = '';
  function statusFrame() {
    const w = currentWeights();
    const l = currentElbow('left');
    const r = currentElbow('right');
    const sigPoint = p => p ? `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}` : 'auto';
    const signature = `${hideArmSprites}|${showPaperArmGuide}|${w.grip.toFixed(2)}|${w.palmNormal.toFixed(2)}|${sigPoint(l)}|${sigPoint(r)}`;
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
        poseElbows[phase] = normalizeElbows(parsed?.poses?.[phase] || {});
      }
      syncCheckboxes();
      refreshJsonExtension();
      global.renderActivePosePanel?.();
      global.ProceduralHandFrameDriver?.syncNow?.();
      return true;
    },
    get poseAim() { return JSON.parse(JSON.stringify(poseAim)); },
    get poseElbows() { return JSON.parse(JSON.stringify(poseElbows)); },
    elbowForPhase,
    setElbowForPhase,
    authorMidpointElbow,
    currentWeights,
    currentElbow,
    decorateAnimationObject(parsed) {
      return injectPoseAimIntoObject(parsed);
    },
    snapshot() {
      return { hideArmSprites, showPaperArmGuide, poseAim: JSON.parse(JSON.stringify(poseAim)), poseElbows: JSON.parse(JSON.stringify(poseElbows)) }; // Undo/Redo preserves pose hinges, elbow keyframes, and preview-only helper state.
    },
    restore(snapshot) {
      if (!snapshot) return false;
      hideArmSprites = snapshot.hideArmSprites === true;
      showPaperArmGuide = snapshot.showPaperArmGuide === true;
      for (const phase of PHASES) {
        poseAim[phase] = normalizeBooleanAim(snapshot.poseAim?.[phase], DEFAULTS[phase]);
        poseElbows[phase] = normalizeElbows({ elbows: snapshot.poseElbows?.[phase] || {} });
      }
      global.ProceduralHandShoulderAim?.setPaperArmGuideVisible?.(showPaperArmGuide);
      syncCheckboxes();
      refreshJsonExtension();
      global.renderActivePosePanel?.();
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
  global.renderActivePosePanel?.();
})(window);