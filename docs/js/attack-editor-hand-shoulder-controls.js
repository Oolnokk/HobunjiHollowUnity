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
  function elbowInputId(phase, side, axis) {
    return `handElbow_${phase}_${side}_${axis}`;
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
        <div class="help" style="margin-top:7px">Elbows are direct offsets from each species/gender shoulder in the hand rig's local pose space. Blank = legacy midpoint fallback. These values interpolate with Neutral/Windup/Strike exactly like any other pose channel.</div>
        ${SIDES.map(side => `
          <div class="row" style="gap:7px;align-items:center;flex-wrap:wrap;margin-top:5px">
            <span class="val" style="min-width:42px">${side === 'left' ? 'Left' : 'Right'}</span>
            ${ELBOW_AXES.map(axis => `<label class="fieldRow" style="margin:0;min-width:88px">${axis.toUpperCase()} <input id="${elbowInputId(phase, side, axis)}" type="number" step="0.01" placeholder="auto" style="width:72px"></label>`).join('')}
          </div>`).join('')}
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
      for (const side of SIDES) {
        for (const axis of ELBOW_AXES) {
          const input = document.getElementById(elbowInputId(phase, side, axis));
          if (!input || document.activeElement === input) continue;
          const value = poseElbows[phase]?.[side]?.[axis];
          input.value = Number.isFinite(Number(value)) ? String(Number(value)) : '';
        }
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
  function setElbowAxis(phase, side, axis) {
    const values = Object.fromEntries(ELBOW_AXES.map(key => {
      const raw = document.getElementById(elbowInputId(phase, side, key))?.value?.trim?.() ?? '';
      return [key, raw === '' ? null : Number(raw)];
    }));
    const anyAuthored = ELBOW_AXES.some(key => Number.isFinite(values[key]));
    poseElbows[phase][side] = anyAuthored
      ? Object.fromEntries(ELBOW_AXES.map(key => [key, Number.isFinite(values[key]) ? values[key] : 0]))
      : null;
    refreshJsonExtension();
    global.ProceduralHandFrameDriver?.syncNow?.();
    global.ProceduralHandShoulderAim?.refreshPaperArmGuides?.();
  }

  for (const phase of PHASES) {
    for (const axis of AXES) {
      document.getElementById(checkboxId(phase, axis))?.addEventListener('change', event => setAxis(phase, axis, event.currentTarget.checked));
    }
    for (const side of SIDES) {
      for (const axis of ELBOW_AXES) {
        document.getElementById(elbowInputId(phase, side, axis))?.addEventListener('input', () => setElbowAxis(phase, side, axis));
      }
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
      global.ProceduralHandFrameDriver?.syncNow?.();
      return true;
    },
    get poseAim() { return JSON.parse(JSON.stringify(poseAim)); },
    get poseElbows() { return JSON.parse(JSON.stringify(poseElbows)); },
    currentWeights,
    currentElbow,
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