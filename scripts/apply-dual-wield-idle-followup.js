'use strict';
const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`Missing replacement target: ${label}`);
  if (text.indexOf(before, first + 1) >= 0) throw new Error(`Replacement target is not unique: ${label}`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}
function replaceRegexOnce(text, regex, after, label) {
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g'))];
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}`);
  return text.replace(regex, after);
}

// -----------------------------------------------------------------------------
// hand-tool-grips.js: Neutral can own Dual Wield; idle keeps the last authored
// melee hand mode; transitions expose an idleBlend for the duplicate weapon roots.
// -----------------------------------------------------------------------------
{
  const path = 'docs/js/hand-tool-grips.js';
  let s = read(path);

  s = replaceOnce(
    s,
    "  let capturedMelee = null;\n",
    "  let capturedMelee = null;\n  let runtimeIdleDualWield = false; // Persists the most recently chosen melee Neutral hand mode after the attack visual finishes.\n  let runtimeIdleDualToolKey = null; // Prevents a dual-wield idle from leaking across weapon swaps or dequip/re-equip.\n",
    'runtime dual idle state'
  );

  s = replaceRegexOnce(
    s,
    /  function normalizeAnimationGrip\(raw, \{ defaultEnabled = false, dualWield = false \} = \{\}\) \{\n[\s\S]*?\n  \}\n\n  function lerpAnimationGrip/,
`  function normalizeAnimationGrip(raw, { defaultEnabled = false, dualWield = false, dualWieldIdle = false } = {}) {
    const explicit = raw && typeof raw === 'object';
    const twoHandEnabled = !dualWield && (explicit ? raw.enabled === true : defaultEnabled);
    return {
      influence: twoHandEnabled ? 1 : 0,
      dualWieldInfluence: dualWield ? 1 : 0,
      dualWieldIdleBlend: dualWield && dualWieldIdle ? 1 : 0,
      percent: clamp(raw?.percent ?? 50, 0, 100),
      primaryPercent: clamp(raw?.primaryPercent ?? 50, 0, 100),
    };
  }

  function lerpAnimationGrip`,
    'normalizeAnimationGrip function'
  );

  s = replaceOnce(
    s,
`      dualWieldInfluence: a.dualWieldInfluence + (b.dualWieldInfluence - a.dualWieldInfluence) * k,
      percent: a.percent + (b.percent - a.percent) * k,`,
`      dualWieldInfluence: a.dualWieldInfluence + (b.dualWieldInfluence - a.dualWieldInfluence) * k,
      dualWieldIdleBlend: (a.dualWieldIdleBlend || 0) + ((b.dualWieldIdleBlend || 0) - (a.dualWieldIdleBlend || 0)) * k,
      percent: a.percent + (b.percent - a.percent) * k,`,
    'lerp dual idle blend'
  );

  s = replaceOnce(
    s,
`    const neutral = normalizeAnimationGrip({ ...poseSet.neutral?.secondaryGrip, enabled: false }, { defaultEnabled: false, dualWield: false }); // Idle/Neutral always keeps one weapon and one gripping hand.
    const windup = normalizeAnimationGrip(poseSet.windup?.secondaryGrip, {`,
`    const neutralDualWield = dualWieldEnabled(poseSet.neutral?.dualWield);
    const neutral = normalizeAnimationGrip(
      { ...poseSet.neutral?.secondaryGrip, enabled: false },
      { defaultEnabled: false, dualWield: neutralDualWield, dualWieldIdle: neutralDualWield },
    ); // Neutral may explicitly own the persistent Dual Wield idle; 2H itself remains attack-only.
    const windup = normalizeAnimationGrip(poseSet.windup?.secondaryGrip, {`,
    'neutral dual-wield grip state'
  );

  s = replaceOnce(
    s,
`      influence: clamp01(result.influence) * (1 - dualWieldInfluence), // 2H and Dual Wield never own the left hand at the same time.
      dualWieldInfluence,
      source: hasAnimationGripMetadata(poseSet) ? 'animation-pose' : 'default-two-hand',`,
`      influence: clamp01(result.influence) * (1 - dualWieldInfluence), // 2H and Dual Wield never own the left hand at the same time.
      dualWieldInfluence,
      dualWieldIdleBlend: clamp01(result.dualWieldIdleBlend),
      source: hasAnimationGripMetadata(poseSet) ? 'animation-pose' : 'default-two-hand',`,
    'return dual idle blend'
  );

  s = replaceOnce(
    s,
`    if (!active) {
      capturedMelee = null;
      return { influence: 0, percent: 50, source: 'idle' };
    }`,
`    if (!active) {
      const currentTool = toolKeyFor(snapshot?.itemKey || snapshot?.shape || '');
      if (snapshot?.activeSlot !== 'weapon' || (runtimeIdleDualToolKey && currentTool !== runtimeIdleDualToolKey)) {
        runtimeIdleDualWield = false;
        runtimeIdleDualToolKey = null;
      }
      capturedMelee = null;
      return {
        influence: 0,
        dualWieldInfluence: runtimeIdleDualWield ? 1 : 0,
        dualWieldIdleBlend: runtimeIdleDualWield ? 1 : 0,
        percent: 50,
        primaryPercent: 50,
        source: runtimeIdleDualWield ? 'dual-wield-idle' : 'idle',
      };
    }`,
    'runtime idle hand mode'
  );

  s = replaceOnce(
    s,
`  function currentDualWieldAnimationState() {
    const state = currentSecondaryGripAnimationState();
    return { influence: clamp01(state?.dualWieldInfluence), source: state?.source || 'none' };
  }`,
`  function currentDualWieldAnimationState() {
    const state = currentSecondaryGripAnimationState();
    return {
      influence: clamp01(state?.dualWieldInfluence),
      idleBlend: clamp01(state?.dualWieldIdleBlend),
      source: state?.source || 'none',
    };
  }`,
    'current dual state'
  );

  s = replaceOnce(
    s,
`      deps[name] = function secondarySpanAwareCombatStart(durationS, opts = {}) {
        capturedMelee = { durationS: Math.max(0.001, Number(durationS) || 0.5), opts: opts && typeof opts === 'object' ? opts : {}, kind: name === 'triggerWeaponHoldVisual' ? 'hold' : 'swing', startedAt: performance.now() };
        global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
        return original.call(this, durationS, opts);
      };`,
`      deps[name] = function secondarySpanAwareCombatStart(durationS, opts = {}) {
        const stanceSnapshot = global.WeaponToolStances?.getRuntimeState?.() || null;
        runtimeIdleDualWield = dualWieldEnabled(opts?.pose?.neutral?.dualWield);
        runtimeIdleDualToolKey = toolKeyFor(stanceSnapshot?.itemKey || stanceSnapshot?.shape || '') || null;
        capturedMelee = { durationS: Math.max(0.001, Number(durationS) || 0.5), opts: opts && typeof opts === 'object' ? opts : {}, kind: name === 'triggerWeaponHoldVisual' ? 'hold' : 'swing', startedAt: performance.now() };
        global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
        return original.call(this, durationS, opts);
      };`,
    'capture persistent dual idle'
  );

  s = replaceOnce(
    s,
`      const dualWield = phase !== 'neutral' && editorSecondaryPoses[phase].dualWield === true;`,
`      const dualWield = editorSecondaryPoses[phase].dualWield === true;`,
    'editor JSON neutral dual'
  );

  s = replaceOnce(
    s,
`      const dualWield = phase !== 'neutral' && dualWieldEnabled(pose?.dualWield);`,
`      const dualWield = dualWieldEnabled(pose?.dualWield);`,
    'load neutral dual'
  );

  s = replaceOnce(
    s,
`      if (pose && typeof pose === 'object') {
        pose.secondaryGrip = {
          enabled: editorSecondaryPoses[phase].enabled,
          percent: editorSecondaryPoses[phase].percent,
          primaryPercent: editorSecondaryPoses[phase].primaryPercent,
        };
        pose.dualWield = { enabled: dualWield };
      }
    }
    syncEditorSpanUi(); patchEditorJsonView();`,
`      if (pose && typeof pose === 'object') {
        pose.secondaryGrip = {
          enabled: editorSecondaryPoses[phase].enabled,
          percent: editorSecondaryPoses[phase].percent,
          primaryPercent: editorSecondaryPoses[phase].primaryPercent,
        };
        pose.dualWield = { enabled: dualWield };
      }
    }
    if ((editorSecondaryPoses.windup.dualWield || editorSecondaryPoses.strike.dualWield) && !editorSecondaryPoses.neutral.dualWield) {
      editorSecondaryPoses.neutral.dualWield = true; // Existing dual attacks gain the requested Dual Wield idle automatically.
      if (dataObj?.poses?.neutral) dataObj.poses.neutral.dualWield = { enabled: true };
    }
    syncEditorSpanUi(); patchEditorJsonView();`,
    'infer dual idle for dual attacks'
  );

  s = replaceOnce(
    s,
`      const canDual = melee && phase !== 'neutral';`,
`      const canDual = melee;`,
    'allow neutral dual toggle'
  );

  s = replaceOnce(
    s,
`      <div class="help" style="margin-bottom:6px">Melee attacks default to <b>2H when the equipped weapon has both ranges</b>. Windup and Strike can instead use <b>Dual wield</b>; its toggle sits beside 2H and the two are mutually exclusive. Dual wield hides the original weapon, renders two offset duplicates, and gives the main-hand copy a small transform lag. Neutral stays single-weapon and ranged/load/fire poses use neither mode.</div>`,
`      <div class="help" style="margin-bottom:6px">Melee attacks default to <b>2H when the equipped weapon has both ranges</b>. Any phase can instead use <b>Dual wield</b>; its toggle sits beside 2H and the two are mutually exclusive. Neutral Dual Wield uses the authored Dual Wield idle stance, Windup/Strike use the attack duplicate path, and ranged/load/fire poses use neither mode.</div>`,
    'hand mode editor help'
  );

  s = replaceOnce(
    s,
`      dual.addEventListener('change', () => { editorSecondaryPoses[phase].dualWield = dual.checked; if (dual.checked) editorSecondaryPoses[phase].enabled = false; patchEditorJsonView(); syncEditorSpanUi(); global.HobunjiDualWieldWeaponVisuals?.syncNow?.(); });`,
`      dual.addEventListener('change', () => {
        editorSecondaryPoses[phase].dualWield = dual.checked;
        if (dual.checked) {
          editorSecondaryPoses[phase].enabled = false;
          if (phase !== 'neutral') editorSecondaryPoses.neutral.dualWield = true; // A dual attack returns to a dual idle unless the user later disables Neutral explicitly.
          if (phase === 'neutral') global.AttackIdleStanceEditor?.previewDualWieldMain?.();
        }
        patchEditorJsonView();
        syncEditorSpanUi();
        global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
      });`,
    'dual toggle behavior'
  );

  s = replaceOnce(
    s,
`      const dualWield = phase !== 'neutral' && raw.dualWield === true;`,
`      const dualWield = raw.dualWield === true;`,
    'history restore neutral dual'
  );

  write(path, s);
}

// -----------------------------------------------------------------------------
// weapon-tool-stances.js: schema carries explicit main/offhand dual idle poses;
// dual attacks use dualWieldMain as their neutral and runtime idle does the same.
// -----------------------------------------------------------------------------
{
  const path = 'docs/js/weapon-tool-stances.js';
  let s = read(path);

  s = replaceOnce(
    s,
`    lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
  });`,
`    lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
    dualWieldMain: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
    dualWieldOffhand: Object.freeze({ x: 0.09, y: 0, z: -0.04, pitch: 37, yaw: 68, bodyYaw: -40, roll: 114 }),
  });`,
    'runtime dual idle defaults'
  );

  s = replaceOnce(
    s,
`    lightWeapon: { ...DEFAULT_IDLE_STANCES.lightWeapon },
  };`,
`    lightWeapon: { ...DEFAULT_IDLE_STANCES.lightWeapon },
    dualWieldMain: { ...DEFAULT_IDLE_STANCES.dualWieldMain },
    dualWieldOffhand: { ...DEFAULT_IDLE_STANCES.dualWieldOffhand },
  };`,
    'runtime dual idle storage'
  );

  s = replaceOnce(
    s,
`  function targetPoseFor(activeSlot, itemKey, def) {`,
`  function targetPoseFor(activeSlot, itemKey, def, { dualWield = false } = {}) {`,
    'targetPoseFor options'
  );

  s = replaceOnce(
    s,
`    const idleClass = weaponIdleClass(itemKey, def);
    if (idleClass === 'heavy') return idleStances.heavyWeapon;
    if (idleClass === 'light') return idleStances.lightWeapon;`,
`    const idleClass = weaponIdleClass(itemKey, def);
    if (dualWield) return idleStances.dualWieldMain; // Dual Wield always starts from its explicitly authored light-style main-hand rest.
    if (idleClass === 'heavy') return idleStances.heavyWeapon;
    if (idleClass === 'light') return idleStances.lightWeapon;`,
    'select dual idle main'
  );

  s = replaceOnce(
    s,
`  function currentCombatNeutral() {
    const state = activeState();
    if (state.activeSlot !== 'weapon') return null;
    const pose = targetPoseFor(state.activeSlot, state.itemKey, state.def);
    return pose ? clonePose(pose) : null;
  }`,
`  function currentCombatNeutral(options = {}) {
    const state = activeState();
    if (state.activeSlot !== 'weapon') return null;
    const pose = targetPoseFor(state.activeSlot, state.itemKey, state.def, options);
    return pose ? clonePose(pose) : null;
  }

  function dualWieldIdleRequested(rawOpts = {}) {
    const raw = rawOpts?.pose?.neutral?.dualWield;
    return raw === true || raw?.enabled === true;
  }

  function handModeMeta(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    if (raw.secondaryGrip && typeof raw.secondaryGrip === 'object') out.secondaryGrip = { ...raw.secondaryGrip };
    if (raw.dualWield != null) out.dualWield = typeof raw.dualWield === 'object' ? { ...raw.dualWield } : raw.dualWield;
    return out;
  }`,
    'combat neutral helpers'
  );

  s = replaceOnce(
    s,
`    const state = activeState();
    const targetNeutral = currentCombatNeutral();
    if (!targetNeutral || state.activeSlot !== 'weapon') return rawOpts || {};`,
`    const state = activeState();
    const useDualWieldIdle = dualWieldIdleRequested(rawOpts);
    const targetNeutral = currentCombatNeutral({ dualWield: useDualWieldIdle });
    if (!targetNeutral || state.activeSlot !== 'weapon') return rawOpts || {};`,
    'prepare dual neutral'
  );

  s = replaceOnce(
    s,
`      pose: {
        neutral: neutralInputForSigns(targetNeutral, startNeutralSign, effectiveSign),
        returnNeutral: neutralInputForSigns(targetNeutral, returnNeutralSign, effectiveSign),
        neutralMirrorSign: startNeutralSign,
        returnNeutralMirrorSign: returnNeutralSign,
        windup,
        strike,
      },`,
`      dualWieldIdle: useDualWieldIdle,
      pose: {
        neutral: { ...neutralInputForSigns(targetNeutral, startNeutralSign, effectiveSign), ...handModeMeta(authoredPose?.neutral) },
        returnNeutral: { ...neutralInputForSigns(targetNeutral, returnNeutralSign, effectiveSign), ...handModeMeta(authoredPose?.neutral) },
        neutralMirrorSign: startNeutralSign,
        returnNeutralMirrorSign: returnNeutralSign,
        windup: { ...windup, ...handModeMeta(authoredPose?.windup) },
        strike: { ...strike, ...handModeMeta(authoredPose?.strike) },
      },`,
    'preserve hand metadata'
  );

  s = replaceOnce(
    s,
`      const targetPose = targetPoseFor(activeSlot, itemKey, def);
      const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust;`,
`      const idleDualState = !attackInProgress ? window.HobunjiHandToolGrips?.currentDualWieldAnimationState?.() : null;
      const idleDualWield = !!idleDualState && idleDualState.source === 'dual-wield-idle' && idleDualState.influence > 0.0001;
      const targetPose = targetPoseFor(activeSlot, itemKey, def, { dualWield: idleDualWield });
      const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust;`,
    'runtime dual idle target'
  );

  s = replaceOnce(
    s,
`    const idleClass = weaponIdleClass(itemKey, def);
    const pose = idleClass === 'light' ? idleStances.lightWeapon : idleClass === 'heavy' ? idleStances.heavyWeapon : null;`,
`    const idleClass = weaponIdleClass(itemKey, def);
    const dualState = window.HobunjiHandToolGrips?.currentDualWieldAnimationState?.() || null;
    const dualIdle = dualState?.source === 'dual-wield-idle' && dualState.influence > 0.0001;
    const pose = dualIdle ? idleStances.dualWieldMain : idleClass === 'light' ? idleStances.lightWeapon : idleClass === 'heavy' ? idleStances.heavyWeapon : null;`,
    'idle body yaw dual main'
  );

  s = replaceOnce(
    s,
`        lightWeapon: { ...idleStances.lightWeapon },
      },`,
`        lightWeapon: { ...idleStances.lightWeapon },
        dualWieldMain: { ...idleStances.dualWieldMain },
        dualWieldOffhand: { ...idleStances.dualWieldOffhand },
      },`,
    'debug dual idle poses'
  );

  write(path, s);
}

// -----------------------------------------------------------------------------
// attack-idle-stance-editor.js: add explicit Dual Wield Main/Offhand presets and
// a pair preview. Offhand is editable with the same numeric controls + neutral
// gizmo instead of being a permanent runtime mirror formula.
// -----------------------------------------------------------------------------
{
  const path = 'docs/js/attack-idle-stance-editor.js';
  let s = read(path);

  s = replaceOnce(
    s,
`  const STANCE_ORDER = ['tool', 'hoeTool', 'heavyWeapon', 'lightWeapon'];
  const STANCE_LABELS = Object.freeze({
    tool: 'Tool / Shovel-style',
    hoeTool: 'Hoe Tool',
    heavyWeapon: 'Heavy Weapon',
    lightWeapon: 'Light Weapon',
  });`,
`  const STANCE_ORDER = ['tool', 'hoeTool', 'heavyWeapon', 'lightWeapon', 'dualWieldMain', 'dualWieldOffhand'];
  const STANCE_LABELS = Object.freeze({
    tool: 'Tool / Shovel-style',
    hoeTool: 'Hoe Tool',
    heavyWeapon: 'Heavy Weapon',
    lightWeapon: 'Light Weapon',
    dualWieldMain: 'Dual Wield — Main hand',
    dualWieldOffhand: 'Dual Wield — Offhand',
  });`,
    'idle editor stance order'
  );

  s = replaceOnce(
    s,
`    version: 1,
    kind: 'hobunji_weapon_idle_stances',`,
`    version: 2,
    kind: 'hobunji_weapon_idle_stances',`,
    'idle fallback version'
  );

  s = replaceOnce(
    s,
`      lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
    }),`,
`      lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
      dualWieldMain: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
      dualWieldOffhand: Object.freeze({ x: 0.09, y: 0, z: -0.04, pitch: 37, yaw: 68, bodyYaw: -40, roll: 114 }),
    }),`,
    'idle editor dual defaults'
  );

  s = replaceOnce(
    s,
`    const out = { version: 1, kind: 'hobunji_weapon_idle_stances', stances: {} };`,
`    const out = { version: 2, kind: 'hobunji_weapon_idle_stances', stances: {} };`,
    'idle normalized version'
  );

  s = replaceOnce(
    s,
`    let selectedKey = 'lightWeapon';
    let editingNeutral = false;
    let lastNeutralSignature = '';`,
`    let selectedKey = 'lightWeapon';
    let editingNeutral = false;
    let dualPairPreview = false; // Shows both explicitly authored idle weapons together while keeping offhand data independent.
    let lastNeutralSignature = '';`,
    'idle pair preview state'
  );

  s = replaceOnce(
    s,
`      <div class="row" style="margin-top:6px">
        <button id="idleCaptureBtn" class="secondary">Capture Neutral</button>
        <button id="idleResetBtn" class="secondary">Reset Selected</button>
      </div>
      <div class="hr"></div>`,
`      <div class="row" style="margin-top:6px">
        <button id="idleCaptureBtn" class="secondary">Capture Neutral</button>
        <button id="idleResetBtn" class="secondary">Reset Selected</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="idlePreviewDualPairBtn" class="secondary">Preview Dual Wield Pair</button>
        <button id="idleStopDualPairBtn" class="secondary">Stop Pair Preview</button>
      </div>
      <div class="hr"></div>`,
    'idle pair preview buttons'
  );

  s = replaceOnce(
    s,
`      <div class="help" style="margin-top:7px">Use <b>Edit Selected in Neutral</b> to route the existing Neutral sliders and 3D gizmo into this idle preset. The committed JSON is the game default; Local Override is shared with the game on the same origin for rapid testing.</div>`,
`      <div class="help" style="margin-top:7px">Use <b>Edit Selected in Neutral</b> to route the existing Neutral sliders and 3D gizmo into any idle preset, including the offhand. Dual Wield stores Main and Offhand as two explicit authored poses: the default Offhand begins as a body-relative mirror of the Light Weapon stance, but runtime never re-mirrors it after authoring. <b>Preview Dual Wield Pair</b> shows both saved poses together. The committed JSON is the game default; Local Override is shared with the game on the same origin for rapid testing.</div>`,
    'idle editor help'
  );

  s = replaceOnce(
    s,
`    function currentPose() {
      return workingConfig.stances[selectedKey];
    }`,
`    function currentPose() {
      return workingConfig.stances[selectedKey];
    }

    function setDualPairPreview(active) {
      dualPairPreview = !!active;
      global.HobunjiDualWieldWeaponVisuals?.setEditorIdlePreview?.(dualPairPreview);
      global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
      global.ProceduralHandFrameDriver?.syncNow?.();
      return dualPairPreview;
    }

    function previewDualWieldMain() {
      const main = workingConfig.stances.dualWieldMain;
      if (!main) return false;
      const shown = writeNeutralPose(main);
      if (shown) {
        setDualPairPreview(true);
        setStatus('Previewing the authored Dual Wield main + offhand idle pair.');
      }
      return shown;
    }`,
    'idle pair preview functions'
  );

  s = replaceOnce(
    s,
`        if (editingNeutral) writeNeutralPose(currentPose());
      });`,
`        if (editingNeutral) writeNeutralPose(currentPose());
        if (dualPairPreview && selectedKey === 'dualWieldMain') writeNeutralPose(currentPose());
        if (selectedKey === 'dualWieldMain' || selectedKey === 'dualWieldOffhand') global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
      });`,
    'idle field live pair sync'
  );

  s = replaceOnce(
    s,
`    select.addEventListener('change', () => {
      selectedKey = select.value;
      syncFieldsFromPose();`,
`    select.addEventListener('change', () => {
      selectedKey = select.value;
      syncFieldsFromPose();
      global.HobunjiDualWieldWeaponVisuals?.syncNow?.();`,
    'idle selection sync'
  );

  s = replaceOnce(
    s,
`    $('idleEditNeutralBtn').addEventListener('click', () => {
      editingNeutral = !editingNeutral;`,
`    $('idleEditNeutralBtn').addEventListener('click', () => {
      if (selectedKey === 'dualWieldOffhand' && dualPairPreview) setDualPairPreview(false); // Gizmo editing isolates the explicit offhand pose; pair preview can be restored afterward.
      editingNeutral = !editingNeutral;`,
    'offhand gizmo isolation'
  );

  s = replaceOnce(
    s,
`    $('idleCaptureBtn').addEventListener('click', () => captureNeutralPose());
    $('idleResetBtn').addEventListener('click', () => {`,
`    $('idleCaptureBtn').addEventListener('click', () => captureNeutralPose());
    $('idlePreviewDualPairBtn').addEventListener('click', previewDualWieldMain);
    $('idleStopDualPairBtn').addEventListener('click', () => {
      setDualPairPreview(false);
      setStatus('Stopped Dual Wield pair preview.');
    });
    $('idleResetBtn').addEventListener('click', () => {`,
    'wire pair preview buttons'
  );

  s = replaceOnce(
    s,
`        return { workingConfig: clone(exportPayload()), selectedKey, editingNeutral }; // Undo/Redo must preserve hidden stances, not only the selected sliders.`,
`        return { workingConfig: clone(exportPayload()), selectedKey, editingNeutral, dualPairPreview }; // Undo/Redo must preserve hidden stances, not only the selected sliders.`,
    'snapshot pair preview'
  );

  s = replaceOnce(
    s,
`        editingNeutral = snapshot.editingNeutral === true;
        select.value = selectedKey;`,
`        editingNeutral = snapshot.editingNeutral === true;
        dualPairPreview = snapshot.dualPairPreview === true;
        select.value = selectedKey;`,
    'restore pair preview flag'
  );

  s = replaceOnce(
    s,
`        if (editingNeutral) writeNeutralPose(currentPose());
        setStatus(`History restored ${STANCE_LABELS[selectedKey]}.`);`,
`        if (editingNeutral) writeNeutralPose(currentPose());
        setDualPairPreview(dualPairPreview);
        setStatus(`History restored ${STANCE_LABELS[selectedKey]}.`);`,
    'restore pair preview visuals'
  );

  s = replaceOnce(
    s,
`      captureSelected: () => captureNeutralPose(),
      stopEditing: () => stopEditingNeutral('Stopped idle stance editing.'),`,
`      captureSelected: () => captureNeutralPose(),
      previewDualWieldMain,
      setDualPairPreview,
      dualWieldPreviewActive: () => dualPairPreview,
      stopEditing: () => stopEditingNeutral('Stopped idle stance editing.'),`,
    'idle editor public dual APIs'
  );

  write(path, s);
}

// -----------------------------------------------------------------------------
// Regression coverage: update existing dual test for true plane-normal gap/scale
// contract and add an idle-stance schema/editor/runtime contract test.
// -----------------------------------------------------------------------------
{
  const path = 'scripts/test-dual-wield-weapon-visuals.js';
  let s = read(path);
  s = s.replace(/assert\.match\(dual, \/const DUPLICATE_SEPARATION = 0\\\.09\/, 'dual weapons keep equal\/opposite authored separation'\);/,
    "assert.match(dual, /const DUPLICATE_Z_GAP = 0\\.30/, 'dual weapons use the requested 0.30 total plane-normal gap');");
  s = s.replace(/assert\.match\(dual, \/makeTranslation\\\(0, -DUPLICATE_SEPARATION, 0\\\)\/, 'main duplicate uses one side of the plane-local axis that maps to weapon-parent local Z'\);/,
    "assert.match(dual, /offsetWorld\\.set\\(0, 0, -HALF_Z_SEPARATION\\)/, 'main duplicate sits on one side of the actual sprite-plane normal');");
  s = s.replace(/assert\.match\(dual, \/offRoot\\\.position\\\.set\\\(0, DUPLICATE_SEPARATION \\\* influence, 0\\\)\/, 'offhand duplicate uses the equal opposite offset'\);/,
    "assert.match(dual, /new Vector3\\(0, 0, HALF_Z_SEPARATION\\)/, 'offhand attack duplicate sits on the equal opposite side of the sprite-plane normal');");
  s = s.replace(/assert\.match\(dual, \/delayedParentMatrix\[\\s\\S\]\*MAIN_HAND_LAG_MS\/, 'main root replays a delayed copy of original transforms'\);/,
    "assert.match(dual, /delayedParentPose[\\s\\S]*MAIN_HAND_LAG_MS/, 'main root replays a delayed translation + rotation pose rather than inheriting scale twice');");
  s = replaceOnce(
    s,
`assert.match(dual, /current\\.plane\\.updateWorldMatrix\\?\\.\\(true, false\\)[\\s\\S]*current\\.offRoot\\.updateMatrixWorld\\?\\.\\(true\\)[\\s\\S]*current\\.mainRoot\\.updateMatrixWorld\\?\\.\\(true\\)/, 'duplicate world matrices are current before either hand reads its weapon socket');`,
`assert.match(dual, /current\\.plane\\.updateWorldMatrix\\?\\.\\(true, false\\)[\\s\\S]*current\\.offRoot\\.updateMatrixWorld\\?\\.\\(true\\)[\\s\\S]*current\\.mainRoot\\.updateMatrixWorld\\?\\.\\(true\\)/, 'duplicate world matrices are current before either hand reads its weapon socket');
assert.match(dual, /root\\.scale\\.set\\(1, 1, 1\\)/, 'dual roots always keep unit local scale so the hidden parent is the sole sprite-scale authority');
assert.match(dual, /dualWieldMain[\\s\\S]*dualWieldOffhand/, 'idle dual wield consumes two explicit authored stance poses');`,
    'dual scale/idle assertions'
  );
  s = s.replace(
    "console.log('dual wield: hidden parent, opposite duplicate offsets, main-hand lag, live per-hand sockets, default 2H, and mutually exclusive editor mode PASS');",
    "console.log('dual wield: single inherited scale, 0.30 plane-normal gap, lagged attack main, authored idle pair, live per-hand sockets, default 2H, and mutually exclusive editor mode PASS');"
  );
  write(path, s);
}

{
  const path = 'scripts/test-dual-wield-idle-stance.js';
  const content = `'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const config = JSON.parse(fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8'));
const runtime = fs.readFileSync('docs/js/weapon-tool-stances.js', 'utf8');
const editor = fs.readFileSync('docs/js/attack-idle-stance-editor.js', 'utf8');
const grips = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const dual = fs.readFileSync('docs/js/dual-wield-weapon-visuals.js', 'utf8');

assert.equal(config.version, 2, 'dual idle authoring upgrades the stance schema');
assert.deepEqual(config.stances.dualWieldMain, config.stances.lightWeapon, 'default dual main is exactly the Light Weapon stance');
const main = config.stances.dualWieldMain;
const off = config.stances.dualWieldOffhand;
assert.equal(off.x, -main.x, 'default offhand mirrors X after the shared body yaw');
assert.equal(off.y, main.y, 'default offhand preserves Y');
assert.equal(off.z, main.z, 'default offhand preserves forward Z');
assert.equal(off.pitch, main.pitch, 'default offhand preserves pitch');
assert.equal(off.yaw, -main.yaw, 'default offhand mirrors yaw');
assert.equal(off.roll, -main.roll, 'default offhand mirrors roll');
assert.equal(off.bodyYaw, main.bodyYaw, 'both idle weapons share the normal body yaw rather than mirroring the body itself');

assert.match(editor, /dualWieldMain: 'Dual Wield — Main hand'/, 'idle editor exposes a dedicated main-hand preset');
assert.match(editor, /dualWieldOffhand: 'Dual Wield — Offhand'/, 'idle editor exposes a dedicated offhand preset');
assert.match(editor, /Preview Dual Wield Pair/, 'idle editor can preview both explicitly authored poses together');
assert.match(editor, /Edit Selected in Neutral[\\s\\S]*3D gizmo/, 'existing neutral gizmo is explicitly available to author the offhand pose');
assert.match(editor, /previewDualWieldMain/, 'attack hand-mode UI can switch the Neutral preview to the shared dual idle main pose');

assert.match(runtime, /if \\(dualWield\\) return idleStances\\.dualWieldMain/, 'runtime holder uses authored dual main instead of ordinary light idle while dual wielding');
assert.match(runtime, /dualWieldIdleRequested/, 'runtime attacks select their dual idle from authored Neutral hand metadata');
assert.match(runtime, /dualWieldOffhand: \\{ \\.\\.\\.idleStances\\.dualWieldOffhand \\}/, 'runtime diagnostics/config expose the custom offhand pose');
assert.match(grips, /runtimeIdleDualWield/, 'hand-mode state persists dual idle after a dual attack ends');
assert.match(grips, /dualWieldIdleBlend/, 'Neutral↔attack transitions expose a continuous idle-pose blend');
assert.match(grips, /const canDual = melee;/, 'Neutral Dual Wield is authorable beside the existing hand-mode controls');
assert.match(dual, /idleOffhandLocalTransform/, 'dual visuals convert the explicit body-relative offhand stance into the weapon-plane hierarchy');
assert.match(dual, /HALF_Z_SEPARATION = DUPLICATE_Z_GAP \\* 0\\.5/, 'the two sprite planes straddle the hidden original with a 0.30 total gap');

console.log('dual wield idle stance: light-main default, authored mirrored offhand, pair preview, runtime persistence, and editable Neutral metadata PASS');
`;
  fs.writeFileSync(path, content);
}

console.log('Applied dual-wield scale/gap/idle stance follow-up patch.');
