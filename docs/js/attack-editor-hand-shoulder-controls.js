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
  const ELBOW_AXES = ['x', 'y', 'z'];
  const AUTO_ELBOW = Object.freeze({ x: 0, y: 0, z: 0 }); // Zero means automatic bend-plane selection.
  const DEFAULTS = Object.freeze({
    neutral: Object.freeze({ grip: true, palmNormal: true, elbowHint: AUTO_ELBOW }),
    windup: Object.freeze({ grip: false, palmNormal: true, elbowHint: AUTO_ELBOW }),
    strike: Object.freeze({ grip: false, palmNormal: true, elbowHint: AUTO_ELBOW }),
  });
  const poseAim = Object.fromEntries(PHASES.map(phase => [phase, {
    grip: DEFAULTS[phase].grip,
    palmNormal: DEFAULTS[phase].palmNormal,
    elbowHint: { ...AUTO_ELBOW },
  }]));
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
  function elbowInputId(phase, axis) {
    return `handElbowHint_${phase}_${axis}`;
  }

  const followGroup = document.createElement('div'); // Hand-only orientation assist; deliberately lives outside the tool-pose controls.
  followGroup.className = 'poseGroup';
  followGroup.id = 'handShoulderFollowGroup';
  followGroup.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Hand elbow-targeting by animation pose</div>
    <div class="help" style="margin-bottom:7px"><b>This rotates the HAND, never the weapon.</b> The wrist-facing side now aims toward the elbow. The elbow itself is solved between shoulder and wrist with equal upper-arm/forearm lengths. The two checkboxes only choose which hand-local hinges may rotate.</div>
    ${PHASES.map(phase => `
      <div class="field" data-hand-shoulder-phase="${phase}">
        <label>${phase[0].toUpperCase() + phase.slice(1)} hand follow</label>
        <div class="row" style="gap:9px;flex-wrap:wrap">
          ${[['grip','Grip axis (local X)'],['palmNormal','Palm-normal axis (local Z)']].map(([axis,label]) => `<label class="fieldRow" style="cursor:pointer;margin:0"><input id="${checkboxId(phase, axis)}" type="checkbox" style="width:auto">${label}</label>`).join('')}
        </div>
        <div class="help" style="margin-top:7px">Elbow location hint: midpoint-relative X/Y/Z in arm-length units. The solver projects this hint onto the physically valid equal-segment elbow circle. All zeros = automatic bend plane.</div>
        <div class="row" style="gap:7px">
          ${ELBOW_AXES.map(axis => `<label class="fieldRow" style="margin:0;min-width:88px">${axis.toUpperCase()} <input id="${elbowInputId(phase, axis)}" type="number" step="0.01" value="0" style="width:72px"></label>`).join('')}
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
    const elbowHint = poseRuntime?.normalizeElbowHint?.(raw?.elbowHint || raw?.elbow || fallback.elbowHint)
      || {
        x: Number(raw?.elbowHint?.x ?? raw?.elbow?.x ?? fallback.elbowHint?.x) || 0,
        y: Number(raw?.elbowHint?.y ?? raw?.elbow?.y ?? fallback.elbowHint?.y) || 0,
        z: Number(raw?.elbowHint?.z ?? raw?.elbow?.z ?? fallback.elbowHint?.z) || 0,
      };
    return {
      grip: booleanAxis(raw, 'grip', 'pitch', fallback.grip),
      palmNormal: booleanAxis(raw, 'palmNormal', 'roll', fallback.palmNormal),
      elbowHint,
    };
  }

  function syncCheckboxes() {
    for (const phase of PHASES) {
      for (const axis of AXES) {
        const input = document.getElementById(checkboxId(phase, axis));
        if (input) input.checked = !!poseAim[phase][axis];
      }
      for (const axis of ELBOW_AXES) {
        const input = document.getElementById(elbowInputId(phase, axis));
        if (input && document.activeElement !== input) input.value = String(Number(poseAim[phase].elbowHint?.[axis]) || 0);
      }
    }
    hide.checked = hideArmSprites;
    paperArm.checked = showPaperArmGuide;
    const weights = currentWeights();
    const elbow = currentElbowHint();
    compassStatus.textContent = `Live hand-follow: grip ${(weights.grip * 100).toFixed(0)}% · palm-normal ${(weights.palmNormal * 100).toFixed(0)}% · elbow hint (${elbow.x.toFixed(2)}, ${elbow.y.toFixed(2)}, ${elbow.z.toFixed(2)}) · arms ${hideArmSprites ? 'hidden' : 'visible'} · paper arm ${showPaperArmGuide ? 'shown' : 'hidden'}.`;
  }

  function injectPoseAimIntoObject(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    if (!parsed.poses || typeof parsed.poses !== 'object') parsed.poses = {};
    for (const phase of PHASES) {
      if (!parsed.poses[phase] || typeof parsed.poses[phase] !== 'object') parsed.poses[phase] = {};
      parsed.poses[phase].shoulderAim = { ...poseAim[phase], elbowHint: { ...poseAim[phase].elbowHint } };
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
  function setElbowAxis(phase, axis, value) {
    poseAim[phase].elbowHint ||= { ...AUTO_ELBOW };
    poseAim[phase].elbowHint[axis] = Number.isFinite(Number(value)) ? Number(value) : 0;
    refreshJsonExtension();
    global.ProceduralHandFrameDriver?.syncNow?.();
    global.ProceduralHandShoulderAim?.refreshPaperArmGuides?.();
  }

  for (const phase of PHASES) {
    for (const axis of AXES) {
      document.getElementById(checkboxId(phase, axis))?.addEventListener('change', event => setAxis(phase, axis, event.currentTarget.checked));
    }
    for (const axis of ELBOW_AXES) {
      document.getElementById(elbowInputId(phase, axis))?.addEventListener('input', event => setElbowAxis(phase, axis, event.currentTarget.value));
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
  function currentElbowHint() {
    const progress = progressFromTimeline();
    const timing = currentTiming();
    const sequence = document.getElementById('playbackSequence')?.value || 'attack';
    if (poseRuntime?.elbowHintAt) return poseRuntime.elbowHintAt(progress, timing, poseAim, sequence);
    return { ...AUTO_ELBOW };
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
    const e = currentElbowHint();
    const signature = `${hideArmSprites}|${showPaperArmGuide}|${w.grip.toFixed(2)}|${w.palmNormal.toFixed(2)}|${e.x.toFixed(3)}|${e.y.toFixed(3)}|${e.z.toFixed(3)}`;
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
    currentElbowHint,
    snapshot() {
      return { hideArmSprites, showPaperArmGuide, poseAim: JSON.parse(JSON.stringify(poseAim)) }; // Undo/Redo preserves both pose hinges and preview-only helper state.
    },
    restore(snapshot) {
      if (!snapshot) return false;
      hideArmSprites = snapshot.hideArmSprites === true;
      showPaperArmGuide = snapshot.showPaperArmGuide === true;
      for (const phase of PHASES) poseAim[phase] = normalizeBooleanAim(snapshot.poseAim?.[phase], DEFAULTS[phase]);
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