'use strict';
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, source) { fs.writeFileSync(path, source); }
function replaceExact(path, oldText, newText, label = oldText.slice(0, 80)) {
  const source = read(path);
  if (!source.includes(oldText)) throw new Error(`Expected target not found in ${path}: ${label}`);
  write(path, source.replace(oldText, newText));
}
function replaceRegex(path, regex, replacement, label) {
  const source = read(path);
  if (!regex.test(source)) throw new Error(`Expected regex target not found in ${path}: ${label}`);
  write(path, source.replace(regex, replacement));
}
function assertContains(path, needle, label = needle) {
  if (!read(path).includes(needle)) throw new Error(`Post-patch assertion failed in ${path}: ${label}`);
}

const gripsPath = 'docs/js/hand-tool-grips.js';
const driverPath = 'docs/js/procedural-hand-frame-driver.js';
const heldPath = 'docs/js/held-action-animations.js';
const editorPath = 'docs/tools/attack-animation-editor/index.html';
const dualPath = 'docs/js/dual-wield-weapon-visuals.js';

// 1) Shared animation hand-mode state: default melee attacks to 2H when ranges exist,
// while allowing an explicit per-phase Dual Wield mode that is mutually exclusive.
replaceExact(gripsPath,
`  function twoHandGripStateForTool(value, context = currentGripContext(), identity = null) {
    if (normalizeGripContext(context) === 'ranged' || !primaryGripSpanForTool(value, context) || !secondaryGripSpanForTool(value, context)) return null;
    const state = identity?.animationGripState !== undefined ? identity.animationGripState : currentSecondaryGripAnimationState(); // Actor-owned poses never inherit the player’s current attack.
    if (!state) return null;
    return state.influence > 0.0001 ? state : null;
  }

  const editorSecondaryPoses = {
    neutral: { enabled: false, percent: 50, primaryPercent: 50 },
    windup: { enabled: false, percent: 50, primaryPercent: 50 },
    strike: { enabled: false, percent: 50, primaryPercent: 50 },
  };`,
`  function twoHandGripStateForTool(value, context = currentGripContext(), identity = null) {
    if (normalizeGripContext(context) === 'ranged' || !primaryGripSpanForTool(value, context) || !secondaryGripSpanForTool(value, context)) return null;
    const state = identity?.animationGripState !== undefined ? identity.animationGripState : currentSecondaryGripAnimationState(); // Actor-owned poses never inherit the player’s current attack.
    if (!state) return null;
    return state.influence > 0.0001 ? state : null;
  }

  function dualWieldStateForTool(value, context = currentGripContext(), identity = null) {
    if (normalizeGripContext(context) === 'ranged') return null; // Dual wield is a melee attack hand mode, never a ranged/load/fire pose.
    const state = identity?.animationGripState !== undefined ? identity.animationGripState : currentSecondaryGripAnimationState();
    const influence = clamp01(state?.dualWieldInfluence);
    return influence > 0.0001 ? { ...state, influence } : null;
  }

  const editorSecondaryPoses = {
    neutral: { enabled: false, dualWield: false, percent: 50, primaryPercent: 50 },
    windup: { enabled: true, dualWield: false, percent: 50, primaryPercent: 50 },
    strike: { enabled: true, dualWield: false, percent: 50, primaryPercent: 50 },
  };`,
'insert dual-wield state and default editor 2H modes');

replaceRegex(gripsPath,
/  function normalizeAnimationGrip\(raw\) \{[\s\S]*?\n  function inAttackEditor\(\)/,
`  function dualWieldEnabled(raw) {
    return raw === true || raw?.enabled === true;
  }

  function normalizeAnimationGrip(raw, { defaultEnabled = false, dualWield = false } = {}) {
    const explicit = raw && typeof raw === 'object';
    const twoHandEnabled = !dualWield && (explicit ? raw.enabled === true : defaultEnabled);
    return {
      influence: twoHandEnabled ? 1 : 0,
      dualWieldInfluence: dualWield ? 1 : 0,
      percent: clamp(raw?.percent ?? 50, 0, 100),
      primaryPercent: clamp(raw?.primaryPercent ?? 50, 0, 100),
    };
  }

  function lerpAnimationGrip(a, b, t) {
    const k = clamp01(t);
    return {
      influence: a.influence + (b.influence - a.influence) * k,
      dualWieldInfluence: a.dualWieldInfluence + (b.dualWieldInfluence - a.dualWieldInfluence) * k,
      percent: a.percent + (b.percent - a.percent) * k,
      primaryPercent: a.primaryPercent + (b.primaryPercent - a.primaryPercent) * k,
    };
  }

  function hasAnimationGripMetadata(poseSet) {
    return ['neutral', 'windup', 'strike'].some(phase => {
      const pose = poseSet?.[phase];
      return (pose?.secondaryGrip && typeof pose.secondaryGrip === 'object') || pose?.dualWield != null;
    });
  }

  function animationGripAt(progress, timing = {}, poseSet = {}, sequence = 'attack') {
    if (sequence === 'load' || sequence === 'fire') {
      return { influence: 0, dualWieldInfluence: 0, percent: 50, primaryPercent: 50, source: 'ranged' };
    }
    const defaultTwoHand = sequence === 'attack'; // Ordinary melee attacks use 2H automatically when the equipped weapon exposes both grip ranges.
    const t = clamp01(progress);
    const wf = clamp01(timing.windupFrac ?? timing.wf ?? 0.16);
    const sf = Math.max(wf, clamp01(timing.strikeFrac ?? timing.sf ?? 0.55));
    const hf = Math.max(sf, clamp01(timing.holdFrac ?? timing.hf ?? 0.68));
    const neutral = normalizeAnimationGrip({ ...poseSet.neutral?.secondaryGrip, enabled: false }, { defaultEnabled: false, dualWield: false }); // Idle/Neutral always keeps one weapon and one gripping hand.
    const windup = normalizeAnimationGrip(poseSet.windup?.secondaryGrip, {
      defaultEnabled: defaultTwoHand,
      dualWield: dualWieldEnabled(poseSet.windup?.dualWield),
    });
    const strike = normalizeAnimationGrip(poseSet.strike?.secondaryGrip, {
      defaultEnabled: defaultTwoHand,
      dualWield: dualWieldEnabled(poseSet.strike?.dualWield),
    });
    const poseScale = clamp01(timing.poseScale ?? 1);
    const scaledWindup = lerpAnimationGrip(neutral, windup, poseScale);
    const scaledStrike = lerpAnimationGrip(neutral, strike, poseScale);
    let result;
    if (t <= wf) {
      const rawWindupT = t / Math.max(1e-6, wf);
      const poseT = global.Combat?.windupPoseProgress?.(rawWindupT, timing.windupSlowdown) ?? rawWindupT;
      result = lerpAnimationGrip(neutral, scaledWindup, poseT);
    } else if (t <= sf) {
      result = lerpAnimationGrip(scaledWindup, scaledStrike, (t - wf) / Math.max(1e-6, sf - wf));
    } else if (t <= hf) {
      result = { ...scaledStrike };
    } else {
      result = lerpAnimationGrip(scaledStrike, neutral, (t - hf) / Math.max(1e-6, 1 - hf));
    }
    const dualWieldInfluence = clamp01(result.dualWieldInfluence);
    return {
      ...result,
      influence: clamp01(result.influence) * (1 - dualWieldInfluence), // 2H and Dual Wield never own the left hand at the same time.
      dualWieldInfluence,
      source: hasAnimationGripMetadata(poseSet) ? 'animation-pose' : 'default-two-hand',
    };
  }

  function inAttackEditor()`,
'animation hand-mode sampling');

replaceExact(gripsPath,
`    const poseSet = {
      neutral: { secondaryGrip: editorSecondaryPoses.neutral },
      windup: { secondaryGrip: editorSecondaryPoses.windup },
      strike: { secondaryGrip: editorSecondaryPoses.strike },
    };`,
`    const poseSet = {
      neutral: { secondaryGrip: editorSecondaryPoses.neutral, dualWield: { enabled: editorSecondaryPoses.neutral.dualWield === true } },
      windup: { secondaryGrip: editorSecondaryPoses.windup, dualWield: { enabled: editorSecondaryPoses.windup.dualWield === true } },
      strike: { secondaryGrip: editorSecondaryPoses.strike, dualWield: { enabled: editorSecondaryPoses.strike.dualWield === true } },
    };`,
'editor pose-set dual metadata');

replaceExact(gripsPath,
`  function currentSecondaryGripAnimationState() { return inAttackEditor() ? editorAnimationGripState() : runtimeAnimationGripState(); }
`,
`  function currentSecondaryGripAnimationState() { return inAttackEditor() ? editorAnimationGripState() : runtimeAnimationGripState(); }
  function currentDualWieldAnimationState() {
    const state = currentSecondaryGripAnimationState();
    return { influence: clamp01(state?.dualWieldInfluence), source: state?.source || 'none' };
  }
`,
'current dual-wield animation state');

replaceExact(gripsPath,
`        capturedMelee = { durationS: Math.max(0.001, Number(durationS) || 0.5), opts: opts && typeof opts === 'object' ? opts : {}, kind: name === 'triggerWeaponHoldVisual' ? 'hold' : 'swing', startedAt: performance.now() };
        return original.call(this, durationS, opts);`,
`        capturedMelee = { durationS: Math.max(0.001, Number(durationS) || 0.5), opts: opts && typeof opts === 'object' ? opts : {}, kind: name === 'triggerWeaponHoldVisual' ? 'hold' : 'swing', startedAt: performance.now() };
        global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
        return original.call(this, durationS, opts);`,
'combat start dual sync');
replaceExact(gripsPath,
`      deps.cancelWeaponSwingHold = function secondarySpanAwareCancel(...args) { capturedMelee = null; return cancel.apply(this, args); };`,
`      deps.cancelWeaponSwingHold = function secondarySpanAwareCancel(...args) { capturedMelee = null; global.HobunjiDualWieldWeaponVisuals?.syncNow?.(); return cancel.apply(this, args); };`,
'combat cancel dual sync');

replaceRegex(gripsPath,
/  function editorAnimationJsonObject\(\) \{[\s\S]*?\n  function patchEditorJsonView\(\)/,
`  function editorAnimationJsonObject() {
    const view = document.getElementById('jsonView');
    if (!view) return null;
    let parsed;
    try { parsed = JSON.parse(view.value || '{}'); } catch (_) { return null; }
    if (!parsed.poses || typeof parsed.poses !== 'object') parsed.poses = {};
    for (const phase of ['neutral', 'windup', 'strike']) {
      if (!parsed.poses[phase] || typeof parsed.poses[phase] !== 'object') parsed.poses[phase] = {};
      const dualWield = phase !== 'neutral' && editorSecondaryPoses[phase].dualWield === true;
      parsed.poses[phase].secondaryGrip = {
        enabled: phase !== 'neutral' && !dualWield && editorSecondaryPoses[phase].enabled === true,
        percent: clamp(editorSecondaryPoses[phase].percent, 0, 100),
        primaryPercent: clamp(editorSecondaryPoses[phase].primaryPercent, 0, 100),
      };
      parsed.poses[phase].dualWield = { enabled: dualWield };
    }
    return parsed;
  }

  function patchEditorJsonView()`,
'editor JSON hand modes');

replaceRegex(gripsPath,
/  function loadEditorAnimationGrip\(dataObj\) \{[\s\S]*?\n  function editorFieldPair\(/,
`  function loadEditorAnimationGrip(dataObj) {
    const sequence = dataObj?.sequence || document.getElementById('playbackSequence')?.value || 'attack';
    const defaultTwoHand = sequence === 'attack';
    for (const phase of ['neutral', 'windup', 'strike']) {
      const pose = dataObj?.poses?.[phase] || null;
      const raw = pose?.secondaryGrip;
      const dualWield = phase !== 'neutral' && dualWieldEnabled(pose?.dualWield);
      const explicitTwoHand = raw && typeof raw === 'object';
      editorSecondaryPoses[phase].dualWield = dualWield;
      editorSecondaryPoses[phase].enabled = phase !== 'neutral' && !dualWield && (explicitTwoHand ? raw.enabled === true : defaultTwoHand);
      editorSecondaryPoses[phase].percent = clamp(raw?.percent ?? 50, 0, 100);
      editorSecondaryPoses[phase].primaryPercent = clamp(raw?.primaryPercent ?? 50, 0, 100);
      if (pose && typeof pose === 'object') {
        pose.secondaryGrip = {
          enabled: editorSecondaryPoses[phase].enabled,
          percent: editorSecondaryPoses[phase].percent,
          primaryPercent: editorSecondaryPoses[phase].primaryPercent,
        };
        pose.dualWield = { enabled: dualWield };
      }
    }
    syncEditorSpanUi(); patchEditorJsonView();
    global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
  }

  function editorFieldPair(`,
'editor hand-mode loader');

replaceExact(gripsPath,
`      controls.enabled.checked = editorSecondaryPoses[phase].enabled === true;
      controls.percent.set(clamp(editorSecondaryPoses[phase].percent, 0, 100));
      controls.primaryPercent.set(clamp(editorSecondaryPoses[phase].primaryPercent, 0, 100));
      const canGrip = melee && mainSpan.enabled === true && span.enabled === true && phase !== 'neutral'; // Neutral remains 1H even if an older export enabled it.
      controls.primaryPercent.range.disabled = !canGrip; controls.primaryPercent.number.disabled = !canGrip;
      controls.enabled.disabled = !canGrip; controls.percent.range.disabled = !canGrip; controls.percent.number.disabled = !canGrip;`,
`      controls.enabled.checked = editorSecondaryPoses[phase].enabled === true;
      controls.dual.checked = editorSecondaryPoses[phase].dualWield === true;
      controls.percent.set(clamp(editorSecondaryPoses[phase].percent, 0, 100));
      controls.primaryPercent.set(clamp(editorSecondaryPoses[phase].primaryPercent, 0, 100));
      const canGrip = melee && mainSpan.enabled === true && span.enabled === true && phase !== 'neutral'; // Neutral remains 1H even if an older export enabled it.
      const canDual = melee && phase !== 'neutral';
      const editingTwoHand = canGrip && editorSecondaryPoses[phase].enabled === true;
      controls.primaryPercent.range.disabled = !editingTwoHand; controls.primaryPercent.number.disabled = !editingTwoHand;
      controls.enabled.disabled = !canGrip; controls.dual.disabled = !canDual;
      controls.percent.range.disabled = !editingTwoHand; controls.percent.number.disabled = !editingTwoHand;`,
'editor hand-mode sync');

replaceExact(gripsPath,
`      <div class="poseGroupHead"><span class="dot" style="background:#f59e0b"></span>Animation two-hand poses</div>
      <div class="help" style="margin-bottom:6px">Enable 2H separately for Windup and Strike, then set each hand’s percentage within its own range. Both blend with the animation timing. Neutral always uses one hand; ranged poses cannot use 2H ranges.</div>`,
`      <div class="poseGroupHead"><span class="dot" style="background:#f59e0b"></span>Animation hand mode</div>
      <div class="help" style="margin-bottom:6px">Melee attacks default to <b>2H when the equipped weapon has both ranges</b>. Windup and Strike can instead use <b>Dual wield</b>; its toggle sits beside 2H and the two are mutually exclusive. Dual wield hides the original weapon, renders two offset duplicates, and gives the main-hand copy a small transform lag. Neutral stays single-weapon and ranged/load/fire poses use neither mode.</div>`,
'editor hand-mode help');

replaceExact(gripsPath,
`      box.innerHTML = \`<label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handSecondaryAnim_\${phase}_enabled" style="width:auto;margin-right:6px">\${phase[0].toUpperCase() + phase.slice(1)} uses two hands (2H)</label><div id="handSecondaryAnim_\${phase}_percent"></div>\`;
      animationFields.appendChild(box);
      const enabled = box.querySelector(\`#handSecondaryAnim_\${phase}_enabled\`);
      const percent = editorFieldPair(box.querySelector(\`#handSecondaryAnim_\${phase}_percent\`), \`handSecondaryAnim_\${phase}_pct\`, \`\${phase[0].toUpperCase() + phase.slice(1)} offhand range %\`, 50, 0, 100, 1, value => { editorSecondaryPoses[phase].percent = clamp(value, 0, 100); patchEditorJsonView(); syncEditorSpanUi(); });
      enabled.addEventListener('change', () => { editorSecondaryPoses[phase].enabled = enabled.checked; patchEditorJsonView(); syncEditorSpanUi(); });
      const primaryPercent = editorFieldPair(box, \`handPrimaryAnim_\${phase}_pct\`, \`\${phase[0].toUpperCase() + phase.slice(1)} main-hand range %\`, 50, 0, 100, 1, value => { editorSecondaryPoses[phase].primaryPercent = clamp(value, 0, 100); patchEditorJsonView(); syncEditorSpanUi(); }); // Authored independently from the offhand percentage.
      pose[phase] = { enabled, percent, primaryPercent };`,
`      box.innerHTML = \`<div class="fieldRow" style="gap:12px;flex-wrap:wrap"><label class="fieldRow" style="cursor:pointer;margin:0"><input type="checkbox" id="handSecondaryAnim_\${phase}_enabled" style="width:auto;margin-right:6px">\${phase[0].toUpperCase() + phase.slice(1)} 2H</label><label class="fieldRow" style="cursor:pointer;margin:0"><input type="checkbox" id="handDualWieldAnim_\${phase}_enabled" style="width:auto;margin-right:6px">Dual wield</label></div><div id="handSecondaryAnim_\${phase}_percent"></div>\`;
      animationFields.appendChild(box);
      const enabled = box.querySelector(\`#handSecondaryAnim_\${phase}_enabled\`);
      const dual = box.querySelector(\`#handDualWieldAnim_\${phase}_enabled\`);
      const percent = editorFieldPair(box.querySelector(\`#handSecondaryAnim_\${phase}_percent\`), \`handSecondaryAnim_\${phase}_pct\`, \`\${phase[0].toUpperCase() + phase.slice(1)} offhand range %\`, 50, 0, 100, 1, value => { editorSecondaryPoses[phase].percent = clamp(value, 0, 100); patchEditorJsonView(); syncEditorSpanUi(); });
      enabled.addEventListener('change', () => { editorSecondaryPoses[phase].enabled = enabled.checked; if (enabled.checked) editorSecondaryPoses[phase].dualWield = false; patchEditorJsonView(); syncEditorSpanUi(); global.HobunjiDualWieldWeaponVisuals?.syncNow?.(); });
      dual.addEventListener('change', () => { editorSecondaryPoses[phase].dualWield = dual.checked; if (dual.checked) editorSecondaryPoses[phase].enabled = false; patchEditorJsonView(); syncEditorSpanUi(); global.HobunjiDualWieldWeaponVisuals?.syncNow?.(); });
      const primaryPercent = editorFieldPair(box, \`handPrimaryAnim_\${phase}_pct\`, \`\${phase[0].toUpperCase() + phase.slice(1)} main-hand range %\`, 50, 0, 100, 1, value => { editorSecondaryPoses[phase].primaryPercent = clamp(value, 0, 100); patchEditorJsonView(); syncEditorSpanUi(); }); // Authored independently from the offhand percentage.
      pose[phase] = { enabled, dual, percent, primaryPercent };`,
'editor mutually-exclusive hand-mode controls');

replaceExact(gripsPath,
`    if (topHelp?.classList.contains('help')) topHelp.innerHTML = 'The fixed <b>primary grip</b> is used for 1H, idle, and ranged poses. Melee 2H poses sample separate <b>main-hand and offhand ranges</b>, with an independent percentage for each hand. Base scale and calculated-height influence remain shared held-item metadata.';`,
`    if (topHelp?.classList.contains('help')) topHelp.innerHTML = 'The fixed <b>primary grip</b> is used for 1H, idle, ranged, and each duplicated Dual Wield weapon. Melee attacks default to <b>2H when both ranges exist</b>; Windup/Strike can instead choose mutually exclusive <b>Dual wield</b>. Base scale and calculated-height influence remain shared held-item metadata.';`,
'editor top help');

replaceRegex(gripsPath,
/  function restoreEditorSecondaryGripState\(snapshot\) \{[\s\S]*?\n  global\.HobunjiHandToolGrips = \{/,
`  function restoreEditorSecondaryGripState(snapshot) {
    for (const phase of ['neutral', 'windup', 'strike']) {
      const raw = snapshot?.[phase] || {};
      const dualWield = phase !== 'neutral' && raw.dualWield === true;
      editorSecondaryPoses[phase].dualWield = dualWield;
      editorSecondaryPoses[phase].enabled = phase !== 'neutral' && !dualWield && (raw.enabled === undefined ? true : raw.enabled === true);
      editorSecondaryPoses[phase].percent = clamp(raw.percent ?? 50, 0, 100);
      editorSecondaryPoses[phase].primaryPercent = clamp(raw.primaryPercent ?? 50, 0, 100);
    }
    syncEditorSpanUi();
    patchEditorJsonView();
    global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  global.HobunjiHandToolGrips = {`,
'editor hand-mode history restore');

replaceExact(gripsPath,
`    authoredPrimaryGripForTool, primaryGripForTool, spinPivotOffsetForTool, primaryGripSpanForTool, secondaryGripSpanForTool, secondaryGripForTool,
    currentSecondaryGripAnimationState, animationGripAt, gripModeForTool, setGripMode, replace, mutate, saveLocal, loadLocal, clearLocal, applyPrimaryGripVisuals, debugForTool,
    editorSecondaryGripStateSnapshot, restoreEditorSecondaryGripState,`,
`    authoredPrimaryGripForTool, primaryGripForTool, spinPivotOffsetForTool, primaryGripSpanForTool, secondaryGripSpanForTool, secondaryGripForTool, dualWieldStateForTool,
    currentSecondaryGripAnimationState, currentDualWieldAnimationState, animationGripAt, gripModeForTool, setGripMode, replace, mutate, saveLocal, loadLocal, clearLocal, applyPrimaryGripVisuals, debugForTool,
    editorSecondaryGripStateSnapshot, restoreEditorSecondaryGripState, loadEditorAnimationGrip,`,
'public dual-wield grip API');

replaceExact(gripsPath,
`  function notify() {
    applyPrimaryGripVisuals();
    for (const listener of listeners) { try { listener(data); } catch (_) {} }
    global.ProceduralHandFrameDriver?.syncNow?.();
  }`,
`  function notify() {
    applyPrimaryGripVisuals();
    for (const listener of listeners) { try { listener(data); } catch (_) {} }
    global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
    global.ProceduralHandFrameDriver?.syncNow?.();
  }`,
'notify dual-wield visuals');

replaceRegex(driverPath,
/      const primaryGrip = toolGrips\.primaryGripForTool\(toolKey, gripContext, scaleIdentity\);[\s\S]*?      record\.lastVisualGripBasis = primary\.visualBasis \|\| null;/,
`      const dualWield = toolGrips.dualWieldStateForTool?.(toolKey, gripContext, scaleIdentity) || null;
      const primaryGrip = toolGrips.primaryGripForTool(toolKey, gripContext, scaleIdentity);
      const basePrimarySocket = toolSocketWorld(record, toolHolder, primaryGrip); // Raw fixed 1H target on the hidden/original weapon.
      const primarySocket = dualWield
        ? (global.HobunjiDualWieldWeaponVisuals?.transformSocketForHand?.(record, 'right', basePrimarySocket) || basePrimarySocket)
        : basePrimarySocket;
      record.rig.placePaperHandGuideWorld?.(primarySocket.position, primarySocket.quaternion);
      const primary = handSocketAfterGripMode(record, primarySocket);
      const modelCalibration = modelCalibrationForRecord(record);
      record.rig.placeHandWorld?.('right', primary.position, primary.quaternion, modelCalibration);
      ensureFallbackState(record).owners.right = dualWield ? 'dual-wield-main-grip' : 'primary-grip';

      let secondaryGrip = null;
      if (dualWield) {
        const offhandBaseSocket = toolSocketWorld(record, toolHolder, primaryGrip); // Both duplicated weapons use the same authored 1H grip frame.
        const offhandSocket = global.HobunjiDualWieldWeaponVisuals?.transformSocketForHand?.(record, 'left', offhandBaseSocket) || offhandBaseSocket;
        const secondary = handSocketAfterGripMode(record, offhandSocket);
        record.rig.placeHandWorld?.('left', secondary.position, secondary.quaternion, modelCalibration, dualWield.influence);
        record.secondaryActive = true;
        ensureFallbackState(record).owners.left = 'dual-wield-offhand-grip';
      } else {
        secondaryGrip = toolGrips.secondaryGripForTool(toolKey, gripContext, scaleIdentity);
        if (secondaryGrip) {
          const secondary = handSocketAfterGripMode(record, toolSocketWorld(record, toolHolder, secondaryGrip));
          record.rig.placeHandWorld?.('left', secondary.position, secondary.quaternion, modelCalibration, secondaryGrip.influence);
          record.secondaryActive = true;
          ensureFallbackState(record).owners.left = 'secondary-grip';
        } else {
          applyFallbackSide(record, 'left');
          record.secondaryActive = false;
        }
      }
      record.lastToolKey = toolKey || null;
      record.lastVisualGripBasis = primary.visualBasis || null;`,
'dual-wield per-hand sockets');

replaceExact(driverPath,
`        secondaryActive: record.secondaryActive,
        secondaryGrip: secondaryGrip ? JSON.parse(JSON.stringify(secondaryGrip)) : null,`,
`        secondaryActive: record.secondaryActive,
        dualWield: dualWield ? JSON.parse(JSON.stringify(dualWield)) : null,
        secondaryGrip: dualWield
          ? { mode: 'dual-wield', grip: JSON.parse(JSON.stringify(primaryGrip)), influence: dualWield.influence }
          : (secondaryGrip ? JSON.parse(JSON.stringify(secondaryGrip)) : null),`,
'frame-driver dual diagnostics');

replaceRegex(heldPath,
/(new URL\('js\/hand-tool-grips\.js\?v=[^']+', docsBase\)\.href,)/,
`$1
    new URL('js/dual-wield-weapon-visuals.js?v=20261004dualwield1', docsBase).href,`,
'bootstrap dual-wield visual module');

replaceExact(editorPath,
`    shoulderAim: pose.shoulderAim ? { ...pose.shoulderAim } : pose.shoulderAim,
    elbows: pose.elbows ? Object.fromEntries(Object.entries(pose.elbows).map(([side, point]) => [side, point ? { ...point } : point])) : pose.elbows,`,
`    shoulderAim: pose.shoulderAim ? { ...pose.shoulderAim } : pose.shoulderAim,
    secondaryGrip: pose.secondaryGrip ? { ...pose.secondaryGrip } : pose.secondaryGrip,
    dualWield: pose.dualWield && typeof pose.dualWield === 'object' ? { ...pose.dualWield } : pose.dualWield,
    elbows: pose.elbows ? Object.fromEntries(Object.entries(pose.elbows).map(([side, point]) => [side, point ? { ...point } : point])) : pose.elbows,`,
'clone hand-mode pose metadata');

replaceExact(editorPath,
`  if (p.shoulderAim) flipped.shoulderAim = { ...p.shoulderAim };
  if (p.elbows) {`,
`  if (p.shoulderAim) flipped.shoulderAim = { ...p.shoulderAim };
  if (p.secondaryGrip) flipped.secondaryGrip = { ...p.secondaryGrip };
  if (p.dualWield != null) flipped.dualWield = typeof p.dualWield === 'object' ? { ...p.dualWield } : p.dualWield;
  if (p.elbows) {`,
'flip preserves hand-mode pose metadata');

replaceExact(editorPath,
`  window.HobunjiAttackEditorHandShoulderControls?.loadFromAnimationObject?.({ poses: anim.poses });
  anim.windupFrac = preset.windupFrac;`,
`  window.HobunjiAttackEditorHandShoulderControls?.loadFromAnimationObject?.({ poses: anim.poses });
  window.HobunjiHandToolGrips?.loadEditorAnimationGrip?.({ sequence: preset.sequence || 'attack', poses: anim.poses }); // Switching Actions reloads 2H/Dual state instead of leaking the prior Action's mode.
  anim.windupFrac = preset.windupFrac;`,
'Action switch reloads hand-mode state');

replaceExact(editorPath,
`    if (raw?.shoulderAim && typeof raw.shoulderAim === 'object') anim.poses[phase].shoulderAim = { ...raw.shoulderAim };
    if (raw?.elbows && typeof raw.elbows === 'object') {`,
`    if (raw?.shoulderAim && typeof raw.shoulderAim === 'object') anim.poses[phase].shoulderAim = { ...raw.shoulderAim };
    if (raw?.secondaryGrip && typeof raw.secondaryGrip === 'object') anim.poses[phase].secondaryGrip = { ...raw.secondaryGrip };
    if (raw?.dualWield != null) anim.poses[phase].dualWield = typeof raw.dualWield === 'object' ? { ...raw.dualWield } : raw.dualWield;
    if (raw?.elbows && typeof raw.elbows === 'object') {`,
'import carries hand-mode metadata');

replaceExact(editorPath,
`  window.HobunjiAttackEditorHandShoulderControls?.loadFromAnimationObject?.(data);
  $('animName').value = action.label;`,
`  window.HobunjiAttackEditorHandShoulderControls?.loadFromAnimationObject?.(data);
  window.HobunjiHandToolGrips?.loadEditorAnimationGrip?.({ sequence: anim.sequence, poses: anim.poses });
  $('animName').value = action.label;`,
'import reloads hand-mode adapter');

replaceExact(dualPath,
`    current.offRoot.updateMatrix?.();
    current.mainRoot.updateMatrix?.();
    return current;`,
`    current.offRoot.updateMatrix?.();
    current.mainRoot.updateMatrix?.();
    current.plane.updateWorldMatrix?.(true, false); // Parent must be current before per-hand socket transforms read duplicate matrixWorld values.
    current.offRoot.updateMatrixWorld?.(true);
    current.mainRoot.updateMatrixWorld?.(true);
    return current;`,
'update dual root matrices before hand sync');

const twoHandTest = 'scripts/test-two-hand-grip-ranges.js';
replaceExact(twoHandTest,
`tasks.get('hand-tool-grips-install')();
const pose = {`,
`tasks.get('hand-tool-grips-install')();
const defaultTwoHandState = grips.animationGripAt(0.25, { windupFrac: 0.25, strikeFrac: 0.6, holdFrac: 0.8 }, {}, 'attack');
assert(defaultTwoHandState.influence > 0.999, 'melee attacks without explicit hand metadata default to 2H when the equipped weapon exposes valid ranges');
assert.equal(defaultTwoHandState.dualWieldInfluence, 0);
const dualWieldState = grips.animationGripAt(0.25, { windupFrac: 0.25, strikeFrac: 0.6, holdFrac: 0.8 }, {
  windup: { dualWield: { enabled: true } }, strike: { dualWield: { enabled: true } },
}, 'attack');
assert.equal(dualWieldState.influence, 0, 'Dual Wield suppresses the mutually exclusive 2H influence');
assert(dualWieldState.dualWieldInfluence > 0.999, 'Dual Wield reaches full influence at the Windup endpoint');
const pose = {`,
'default 2H and dual animation-state tests');

replaceExact(twoHandTest,
`grips.restoreEditorSecondaryGripState({ windup: { enabled: true, percent: 25, primaryPercent: 75 } });
assert.equal(grips.editorSecondaryGripStateSnapshot().windup.primaryPercent, 75);`,
`grips.restoreEditorSecondaryGripState({ windup: { enabled: true, percent: 25, primaryPercent: 75 } });
assert.equal(grips.editorSecondaryGripStateSnapshot().windup.primaryPercent, 75);
grips.loadEditorAnimationGrip({ sequence: 'attack', poses: { neutral: {}, windup: {}, strike: {} } });
let editorModes = grips.editorSecondaryGripStateSnapshot();
assert.equal(editorModes.windup.enabled, true, 'new/imported melee attacks default Windup to 2H');
assert.equal(editorModes.strike.enabled, true, 'new/imported melee attacks default Strike to 2H');
grips.loadEditorAnimationGrip({ sequence: 'attack', poses: { neutral: {}, windup: { dualWield: { enabled: true } }, strike: {} } });
editorModes = grips.editorSecondaryGripStateSnapshot();
assert.equal(editorModes.windup.dualWield, true, 'Dual Wield metadata loads into the editor phase toggle');
assert.equal(editorModes.windup.enabled, false, 'Dual Wield and 2H are mutually exclusive in editor state');`,
'editor default 2H and dual exclusivity tests');

const inverseTest = 'scripts/test-hand-inverse-authoring.js';
replaceExact(inverseTest,
`  'hand-tool-grips.js',
  'procedural-hand-attachments.js',`,
`  'hand-tool-grips.js',
  'dual-wield-weapon-visuals.js',
  'procedural-hand-attachments.js',`,
'bootstrap regression includes dual module');

const dualTest = 'scripts/test-dual-wield-weapon-visuals.js';
write(dualTest, `'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const dual = fs.readFileSync('docs/js/dual-wield-weapon-visuals.js', 'utf8');
const grips = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const driver = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8');
const held = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
assert.match(dual, /const DUPLICATE_SEPARATION = 0\\.09/, 'dual weapons keep equal/opposite authored separation');
assert.match(dual, /const MAIN_HAND_LAG_MS = 45/, 'main-hand duplicate keeps the requested small transform lag');
assert.match(dual, /plane\\.add\\(offRoot\\)[\\s\\S]*plane\\.add\\(mainRoot\\)/, 'both visible weapon roots are children of the hidden original plane');
assert.match(dual, /record\\.material\\.visible = false/, 'original weapon material is hidden without hiding child duplicates');
assert.match(dual, /makeTranslation\\(0, -DUPLICATE_SEPARATION, 0\\)/, 'main duplicate uses one side of the plane-local axis that maps to weapon-parent local Z');
assert.match(dual, /offRoot\\.position\\.set\\(0, DUPLICATE_SEPARATION \\* influence, 0\\)/, 'offhand duplicate uses the equal opposite offset');
assert.match(dual, /delayedParentMatrix[\\s\\S]*MAIN_HAND_LAG_MS/, 'main root replays a delayed copy of original transforms');
assert.match(dual, /transformSocketForHand/, 'dual visual layer exposes per-hand socket transforms');
assert.match(driver, /transformSocketForHand\\?\\.\\(record, 'right'/, 'right hand follows the lagged main duplicate');
assert.match(driver, /transformSocketForHand\\?\\.\\(record, 'left'/, 'left hand follows the offhand duplicate');
assert.match(driver, /offhandBaseSocket = toolSocketWorld\\(record, toolHolder, primaryGrip\\)/, 'both duplicated weapons use the same fixed 1H grip frame');
assert.match(grips, /dualWieldStateForTool/, 'shared grip state exposes Dual Wield as a melee hand mode');
assert.match(grips, /defaultTwoHand = sequence === 'attack'/, 'ordinary melee attacks default to 2H');
assert.match(grips, /if \\(dual\\.checked\\) editorSecondaryPoses\\[phase\\]\\.enabled = false/, 'editor Dual Wield switches off 2H');
assert.match(grips, /if \\(enabled\\.checked\\) editorSecondaryPoses\\[phase\\]\\.dualWield = false/, 'editor 2H switches off Dual Wield');
assert(held.includes('dual-wield-weapon-visuals.js'), 'held-action bootstrap loads dual-wield visuals');
assert.match(editor, /loadEditorAnimationGrip\\?\\.\\(\\{ sequence: preset\\.sequence \\|\\| 'attack', poses: anim\\.poses \\}\\)/, 'switching Actions reloads per-attack hand-mode metadata');
console.log('dual wield: hidden parent, opposite duplicate offsets, main-hand lag, per-hand sockets, default 2H, and mutually exclusive editor mode PASS');
`);

for (const [path, needle] of [
  [gripsPath, 'function dualWieldStateForTool'],
  [gripsPath, 'handDualWieldAnim_${phase}_enabled'],
  [driverPath, "'dual-wield-main-grip'"],
  [heldPath, 'dual-wield-weapon-visuals.js'],
  [editorPath, 'loadEditorAnimationGrip?.({ sequence: preset.sequence'],
  [dualPath, 'current.mainRoot.updateMatrixWorld?.(true);'],
  [dualTest, 'main-hand lag'],
]) assertContains(path, needle);

console.log('Applied dual-wield + default-2H patch.');
