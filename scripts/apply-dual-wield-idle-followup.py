from pathlib import Path


def replace_once(text: str, before: str, after: str, label: str) -> str:
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(before, after, 1)


def patch(path: str, changes):
    p = Path(path)
    text = p.read_text()
    for before, after, label in changes:
        text = replace_once(text, before, after, label)
    p.write_text(text)


# ---------------------------------------------------------------------------
# Hand mode state: Neutral may own Dual Wield, and that state persists into
# ordinary idle after a dual-wield attack ends. 2H itself remains attack-only.
# ---------------------------------------------------------------------------
patch('docs/js/hand-tool-grips.js', [
    (
        "  let capturedMelee = null;\n",
        "  let capturedMelee = null;\n  let runtimeIdleDualWield = false; // Persists the most recently requested melee Neutral dual-wield stance after the attack visual ends.\n  let runtimeIdleDualToolKey = null; // Prevents that idle stance from leaking across weapon swaps or dequip/re-equip.\n",
        'runtime dual idle state',
    ),
    (
        "  function normalizeAnimationGrip(raw, { defaultEnabled = false, dualWield = false } = {}) {\n    const explicit = raw && typeof raw === 'object';\n    const twoHandEnabled = !dualWield && (explicit ? raw.enabled === true : defaultEnabled);\n    return {\n      influence: twoHandEnabled ? 1 : 0,\n      dualWieldInfluence: dualWield ? 1 : 0,\n      percent: clamp(raw?.percent ?? 50, 0, 100),\n      primaryPercent: clamp(raw?.primaryPercent ?? 50, 0, 100),\n    };\n  }",
        "  function normalizeAnimationGrip(raw, { defaultEnabled = false, dualWield = false, dualWieldIdle = false } = {}) {\n    const explicit = raw && typeof raw === 'object';\n    const twoHandEnabled = !dualWield && (explicit ? raw.enabled === true : defaultEnabled);\n    return {\n      influence: twoHandEnabled ? 1 : 0,\n      dualWieldInfluence: dualWield ? 1 : 0,\n      dualWieldIdleBlend: dualWield && dualWieldIdle ? 1 : 0,\n      percent: clamp(raw?.percent ?? 50, 0, 100),\n      primaryPercent: clamp(raw?.primaryPercent ?? 50, 0, 100),\n    };\n  }",
        'normalize animation grip',
    ),
    (
        "      dualWieldInfluence: a.dualWieldInfluence + (b.dualWieldInfluence - a.dualWieldInfluence) * k,\n      percent: a.percent + (b.percent - a.percent) * k,",
        "      dualWieldInfluence: a.dualWieldInfluence + (b.dualWieldInfluence - a.dualWieldInfluence) * k,\n      dualWieldIdleBlend: (a.dualWieldIdleBlend || 0) + ((b.dualWieldIdleBlend || 0) - (a.dualWieldIdleBlend || 0)) * k,\n      percent: a.percent + (b.percent - a.percent) * k,",
        'lerp idle blend',
    ),
    (
        "    const neutral = normalizeAnimationGrip({ ...poseSet.neutral?.secondaryGrip, enabled: false }, { defaultEnabled: false, dualWield: false }); // Idle/Neutral always keeps one weapon and one gripping hand.",
        "    const neutralDualWield = dualWieldEnabled(poseSet.neutral?.dualWield);\n    const neutral = normalizeAnimationGrip(\n      { ...poseSet.neutral?.secondaryGrip, enabled: false },\n      { defaultEnabled: false, dualWield: neutralDualWield, dualWieldIdle: neutralDualWield },\n    ); // Neutral can explicitly own Dual Wield; 2H itself remains attack-only.",
        'neutral dual state',
    ),
    (
        "      dualWieldInfluence,\n      source: hasAnimationGripMetadata(poseSet) ? 'animation-pose' : 'default-two-hand',",
        "      dualWieldInfluence,\n      dualWieldIdleBlend: clamp01(result.dualWieldIdleBlend),\n      source: hasAnimationGripMetadata(poseSet) ? 'animation-pose' : 'default-two-hand',",
        'return idle blend',
    ),
    (
        "    if (!active) {\n      capturedMelee = null;\n      return { influence: 0, percent: 50, source: 'idle' };\n    }",
        "    if (!active) {\n      const currentTool = toolKeyFor(snapshot?.itemKey || snapshot?.shape || '');\n      if (snapshot?.activeSlot !== 'weapon' || (runtimeIdleDualToolKey && currentTool !== runtimeIdleDualToolKey)) {\n        runtimeIdleDualWield = false;\n        runtimeIdleDualToolKey = null;\n      }\n      capturedMelee = null;\n      return {\n        influence: 0,\n        dualWieldInfluence: runtimeIdleDualWield ? 1 : 0,\n        dualWieldIdleBlend: runtimeIdleDualWield ? 1 : 0,\n        percent: 50,\n        primaryPercent: 50,\n        source: runtimeIdleDualWield ? 'dual-wield-idle' : 'idle',\n      };\n    }",
        'persistent runtime idle state',
    ),
    (
        "  function currentDualWieldAnimationState() {\n    const state = currentSecondaryGripAnimationState();\n    return { influence: clamp01(state?.dualWieldInfluence), source: state?.source || 'none' };\n  }",
        "  function currentDualWieldAnimationState() {\n    const state = currentSecondaryGripAnimationState();\n    return {\n      influence: clamp01(state?.dualWieldInfluence),\n      idleBlend: clamp01(state?.dualWieldIdleBlend),\n      source: state?.source || 'none',\n    };\n  }",
        'public dual state idle blend',
    ),
    (
        "      deps[name] = function secondarySpanAwareCombatStart(durationS, opts = {}) {\n        capturedMelee = { durationS: Math.max(0.001, Number(durationS) || 0.5), opts: opts && typeof opts === 'object' ? opts : {}, kind: name === 'triggerWeaponHoldVisual' ? 'hold' : 'swing', startedAt: performance.now() };\n        global.HobunjiDualWieldWeaponVisuals?.syncNow?.();\n        return original.call(this, durationS, opts);\n      };",
        "      deps[name] = function secondarySpanAwareCombatStart(durationS, opts = {}) {\n        const stanceSnapshot = global.WeaponToolStances?.getRuntimeState?.() || null;\n        runtimeIdleDualWield = dualWieldEnabled(opts?.pose?.neutral?.dualWield);\n        runtimeIdleDualToolKey = toolKeyFor(stanceSnapshot?.itemKey || stanceSnapshot?.shape || '') || null;\n        capturedMelee = { durationS: Math.max(0.001, Number(durationS) || 0.5), opts: opts && typeof opts === 'object' ? opts : {}, kind: name === 'triggerWeaponHoldVisual' ? 'hold' : 'swing', startedAt: performance.now() };\n        global.HobunjiDualWieldWeaponVisuals?.syncNow?.();\n        return original.call(this, durationS, opts);\n      };",
        'capture persistent dual idle',
    ),
    (
        "      const dualWield = phase !== 'neutral' && editorSecondaryPoses[phase].dualWield === true;",
        "      const dualWield = editorSecondaryPoses[phase].dualWield === true;",
        'write neutral dual metadata',
    ),
    (
        "      const dualWield = phase !== 'neutral' && dualWieldEnabled(pose?.dualWield);",
        "      const dualWield = dualWieldEnabled(pose?.dualWield);",
        'load neutral dual metadata',
    ),
    (
        "    }\n    syncEditorSpanUi(); patchEditorJsonView();\n    global.HobunjiDualWieldWeaponVisuals?.syncNow?.();\n  }\n\n  function editorFieldPair",
        "    }\n    if ((editorSecondaryPoses.windup.dualWield || editorSecondaryPoses.strike.dualWield) && !editorSecondaryPoses.neutral.dualWield) {\n      editorSecondaryPoses.neutral.dualWield = true; // Older dual attacks gain the requested Dual Wield idle automatically.\n      if (dataObj?.poses?.neutral) dataObj.poses.neutral.dualWield = { enabled: true };\n    }\n    syncEditorSpanUi(); patchEditorJsonView();\n    global.HobunjiDualWieldWeaponVisuals?.syncNow?.();\n  }\n\n  function editorFieldPair",
        'infer neutral dual from active phases',
    ),
    (
        "      const canDual = melee && phase !== 'neutral';",
        "      const canDual = melee;",
        'allow neutral dual toggle',
    ),
    (
        "      <div class=\"help\" style=\"margin-bottom:6px\"><b>Melee attacks default to <b>2H when the equipped weapon has both ranges</b>. Windup and Strike can instead use <b>Dual wield</b>; its toggle sits beside 2H and the two are mutually exclusive. Dual wield hides the original weapon, renders two offset duplicates, and gives the main-hand copy a small transform lag. Neutral stays single-weapon and ranged/load/fire poses use neither mode.</div>",
        "      <div class=\"help\" style=\"margin-bottom:6px\">Melee attacks default to <b>2H when the equipped weapon has both ranges</b>. Any melee phase can instead use <b>Dual wield</b>; its toggle sits beside 2H and the two are mutually exclusive. Neutral Dual Wield uses the authored Dual Wield idle pair, while Windup/Strike use the attack duplicate path. Ranged/load/fire poses use neither mode.</div>",
        'hand mode help',
    ),
    (
        "      dual.addEventListener('change', () => { editorSecondaryPoses[phase].dualWield = dual.checked; if (dual.checked) editorSecondaryPoses[phase].enabled = false; patchEditorJsonView(); syncEditorSpanUi(); global.HobunjiDualWieldWeaponVisuals?.syncNow?.(); });",
        "      dual.addEventListener('change', () => {\n        editorSecondaryPoses[phase].dualWield = dual.checked;\n        if (dual.checked) {\n          editorSecondaryPoses[phase].enabled = false;\n          if (phase !== 'neutral') editorSecondaryPoses.neutral.dualWield = true;\n          if (phase === 'neutral') global.AttackIdleStanceEditor?.previewDualWieldMain?.();\n        }\n        patchEditorJsonView();\n        syncEditorSpanUi();\n        global.HobunjiDualWieldWeaponVisuals?.syncNow?.();\n      });",
        'dual toggle behavior',
    ),
    (
        "      const dualWield = phase !== 'neutral' && raw.dualWield === true;",
        "      const dualWield = raw.dualWield === true;",
        'history neutral dual restore',
    ),
])

# Fix the exact help replacement separately because the original contains normal
# text (not a nested bold typo) and we want failure to be obvious if UI copy moves.
p = Path('docs/js/hand-tool-grips.js')
s = p.read_text()
old_help = "      <div class=\"help\" style=\"margin-bottom:6px\">Melee attacks default to <b>2H when the equipped weapon has both ranges</b>. Windup and Strike can instead use <b>Dual wield</b>; its toggle sits beside 2H and the two are mutually exclusive. Dual wield hides the original weapon, renders two offset duplicates, and gives the main-hand copy a small transform lag. Neutral stays single-weapon and ranged/load/fire poses use neither mode.</div>"
new_help = "      <div class=\"help\" style=\"margin-bottom:6px\">Melee attacks default to <b>2H when the equipped weapon has both ranges</b>. Any melee phase can instead use <b>Dual wield</b>; its toggle sits beside 2H and the two are mutually exclusive. Neutral Dual Wield uses the authored Dual Wield idle pair, while Windup/Strike use the attack duplicate path. Ranged/load/fire poses use neither mode.</div>"
if old_help in s:
    s = replace_once(s, old_help, new_help, 'hand mode help exact')
p.write_text(s)

# ---------------------------------------------------------------------------
# Weapon stance runtime: dual idle main is a first-class holder pose. The offhand
# pose is consumed by dual-wield-weapon-visuals.js relative to the same body yaw.
# ---------------------------------------------------------------------------
patch('docs/js/weapon-tool-stances.js', [
    (
        "  const STANCE_CONFIG_URL = 'config/combat/weapon-idle-stances.json?v=20260817a';",
        "  const STANCE_CONFIG_URL = 'config/combat/weapon-idle-stances.json?v=20261005dualidle1';",
        'stance config cache token',
    ),
    (
        "    lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),\n  });",
        "    lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),\n    dualWieldMain: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),\n    dualWieldOffhand: Object.freeze({ x: 0.09, y: 0, z: -0.04, pitch: 37, yaw: 68, bodyYaw: -40, roll: 114 }),\n  });",
        'runtime dual idle defaults',
    ),
    (
        "    lightWeapon: { ...DEFAULT_IDLE_STANCES.lightWeapon },\n  };",
        "    lightWeapon: { ...DEFAULT_IDLE_STANCES.lightWeapon },\n    dualWieldMain: { ...DEFAULT_IDLE_STANCES.dualWieldMain },\n    dualWieldOffhand: { ...DEFAULT_IDLE_STANCES.dualWieldOffhand },\n  };",
        'runtime dual idle storage',
    ),
    (
        "  function targetPoseFor(activeSlot, itemKey, def) {",
        "  function targetPoseFor(activeSlot, itemKey, def, { dualWield = false } = {}) {",
        'targetPoseFor options',
    ),
    (
        "    const idleClass = weaponIdleClass(itemKey, def);\n    if (idleClass === 'heavy') return idleStances.heavyWeapon;",
        "    const idleClass = weaponIdleClass(itemKey, def);\n    if (dualWield) return idleStances.dualWieldMain; // Dual Wield rests in its explicitly authored light-style main-hand stance.\n    if (idleClass === 'heavy') return idleStances.heavyWeapon;",
        'select dual main idle',
    ),
    (
        "  function currentCombatNeutral() {\n    const state = activeState();\n    if (state.activeSlot !== 'weapon') return null;\n    const pose = targetPoseFor(state.activeSlot, state.itemKey, state.def);\n    return pose ? clonePose(pose) : null;\n  }",
        "  function currentCombatNeutral(options = {}) {\n    const state = activeState();\n    if (state.activeSlot !== 'weapon') return null;\n    const pose = targetPoseFor(state.activeSlot, state.itemKey, state.def, options);\n    return pose ? clonePose(pose) : null;\n  }\n\n  function dualWieldIdleRequested(rawOpts = {}) {\n    const raw = rawOpts?.pose?.neutral?.dualWield;\n    return raw === true || raw?.enabled === true;\n  }",
        'dual idle request helper',
    ),
    (
        "  function prepareCombatOptions(rawOpts = {}) {\n    const state = activeState();\n    const targetNeutral = currentCombatNeutral();",
        "  function prepareCombatOptions(rawOpts = {}) {\n    const state = activeState();\n    const useDualWieldIdle = dualWieldIdleRequested(rawOpts);\n    const targetNeutral = currentCombatNeutral({ dualWield: useDualWieldIdle });",
        'prepare dual main neutral',
    ),
    (
        "      const targetPose = targetPoseFor(activeSlot, itemKey, def);\n      const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust;",
        "      const idleDualState = !attackInProgress ? window.HobunjiHandToolGrips?.currentDualWieldAnimationState?.() : null;\n      const idleDualWield = !!idleDualState && idleDualState.source === 'dual-wield-idle' && idleDualState.influence > 0.0001;\n      const targetPose = targetPoseFor(activeSlot, itemKey, def, { dualWield: idleDualWield });\n      const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust;",
        'runtime holder dual idle',
    ),
])

# ---------------------------------------------------------------------------
# Idle stance authoring: main + offhand are explicit saved poses. The default
# offhand starts as a mirror of Light Weapon after the shared body yaw, but the
# offhand weapon transform can then be edited numerically or with the Neutral gizmo.
# ---------------------------------------------------------------------------
patch('docs/js/attack-idle-stance-editor.js', [
    (
        "  const CONFIG_URL = '../../config/combat/weapon-idle-stances.json?v=20260817a';",
        "  const CONFIG_URL = '../../config/combat/weapon-idle-stances.json?v=20261005dualidle1';",
        'editor stance config cache token',
    ),
    (
        "  const STANCE_ORDER = ['tool', 'hoeTool', 'heavyWeapon', 'lightWeapon'];",
        "  const STANCE_ORDER = ['tool', 'hoeTool', 'heavyWeapon', 'lightWeapon', 'dualWieldMain', 'dualWieldOffhand'];",
        'editor dual stance order',
    ),
    (
        "    lightWeapon: 'Light Weapon',\n  });",
        "    lightWeapon: 'Light Weapon',\n    dualWieldMain: 'Dual Wield — Main hand',\n    dualWieldOffhand: 'Dual Wield — Offhand',\n  });",
        'editor dual labels',
    ),
    (
        "    version: 1,",
        "    version: 2,",
        'fallback schema v2',
    ),
    (
        "      lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),\n    }),",
        "      lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),\n      dualWieldMain: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),\n      dualWieldOffhand: Object.freeze({ x: 0.09, y: 0, z: -0.04, pitch: 37, yaw: 68, bodyYaw: -40, roll: 114 }),\n    }),",
        'editor dual fallback poses',
    ),
    (
        "    const out = { version: 1, kind: 'hobunji_weapon_idle_stances', stances: {} };",
        "    const out = { version: 2, kind: 'hobunji_weapon_idle_stances', stances: {} };",
        'normalized schema v2',
    ),
    (
        "    if (wasPreviousDefault) out.stances.lightWeapon.y = 0; // Keep editor/runtime parity for exact old saved defaults without touching authored variants.\n    return out;",
        "    if (wasPreviousDefault) out.stances.lightWeapon.y = 0; // Keep editor/runtime parity for exact old saved defaults without touching authored variants.\n    out.stances.dualWieldOffhand.bodyYaw = out.stances.dualWieldMain.bodyYaw; // Body yaw is shared; only the offhand weapon transform is independently authored.\n    return out;",
        'share dual body yaw',
    ),
    (
        "    let selectedKey = 'lightWeapon';\n    let editingNeutral = false;\n    let lastNeutralSignature = '';",
        "    let selectedKey = 'lightWeapon';\n    let editingNeutral = false;\n    let dualPairPreview = false; // Pair preview renders both explicit idle weapons while each pose remains independently authorable.\n    let lastNeutralSignature = '';",
        'pair preview state',
    ),
    (
        "      <div class=\"row\" style=\"margin-top:6px\">\n        <button id=\"idleCaptureBtn\" class=\"secondary\">Capture Neutral</button>\n        <button id=\"idleResetBtn\" class=\"secondary\">Reset Selected</button>\n      </div>\n      <div class=\"hr\"></div>",
        "      <div class=\"row\" style=\"margin-top:6px\">\n        <button id=\"idleCaptureBtn\" class=\"secondary\">Capture Neutral</button>\n        <button id=\"idleResetBtn\" class=\"secondary\">Reset Selected</button>\n      </div>\n      <div class=\"row\" style=\"margin-top:6px\">\n        <button id=\"idlePreviewDualPairBtn\" class=\"secondary\">Preview Dual Wield Pair</button>\n        <button id=\"idleStopDualPairBtn\" class=\"secondary\">Stop Pair Preview</button>\n      </div>\n      <div class=\"hr\"></div>",
        'pair preview buttons',
    ),
    (
        "      <div class=\"help\" style=\"margin-top:7px\">Use <b>Edit Selected in Neutral</b> to route the existing Neutral sliders and 3D gizmo into this idle preset. The committed JSON is the game default; Local Override is shared with the game on the same origin for rapid testing.</div>",
        "      <div class=\"help\" style=\"margin-top:7px\">Use <b>Edit Selected in Neutral</b> to route the existing Neutral sliders and 3D gizmo into any idle preset, including <b>Dual Wield — Offhand</b>. The offhand begins as a body-relative mirror of Light Weapon, but that mirror is only the default: its x/y/z and pitch/yaw/roll are saved explicitly and runtime uses exactly what you author. Body yaw stays shared with Dual Wield — Main hand. <b>Preview Dual Wield Pair</b> shows both saved poses together.</div>",
        'dual idle editor help',
    ),
    (
        "    function currentPose() {\n      return workingConfig.stances[selectedKey];\n    }",
        "    function currentPose() {\n      return workingConfig.stances[selectedKey];\n    }\n\n    function setDualPairPreview(active) {\n      dualPairPreview = !!active;\n      window.HobunjiDualWieldWeaponVisuals?.setEditorIdlePreview?.(dualPairPreview);\n      window.HobunjiDualWieldWeaponVisuals?.syncNow?.();\n      window.ProceduralHandFrameDriver?.syncNow?.();\n      return dualPairPreview;\n    }\n\n    function previewDualWieldMain() {\n      const main = workingConfig.stances.dualWieldMain;\n      if (!main) return false;\n      const shown = writeNeutralPose(main);\n      if (shown) {\n        setDualPairPreview(true);\n        setStatus('Previewing the authored Dual Wield main + offhand idle pair.');\n      }\n      return shown;\n    }",
        'pair preview helpers',
    ),
    (
        "      const pose = currentPose();\n      for (const field of FIELD_DEFS) {\n        const value = numberOr(pose[field.key]);\n        $(`idle_${field.key}`).value = value;\n        $(`idle_${field.key}_val`).textContent = field.angle ? `${value.toFixed(0)}°` : value.toFixed(2);\n      }",
        "      const pose = currentPose();\n      if (selectedKey === 'dualWieldOffhand') pose.bodyYaw = workingConfig.stances.dualWieldMain.bodyYaw;\n      for (const field of FIELD_DEFS) {\n        const value = numberOr(pose[field.key]);\n        const input = $(`idle_${field.key}`);\n        input.value = value;\n        input.disabled = selectedKey === 'dualWieldOffhand' && field.key === 'bodyYaw';\n        $(`idle_${field.key}_val`).textContent = field.angle ? `${value.toFixed(0)}°` : value.toFixed(2);\n      }",
        'disable offhand body yaw',
    ),
    (
        "        currentPose()[field.key] = value;\n        $(`idle_${field.key}_val`).textContent = field.angle ? `${value.toFixed(0)}°` : value.toFixed(2);\n        if (editingNeutral) writeNeutralPose(currentPose());",
        "        if (selectedKey === 'dualWieldOffhand' && field.key === 'bodyYaw') return;\n        currentPose()[field.key] = value;\n        if (selectedKey === 'dualWieldMain' && field.key === 'bodyYaw') workingConfig.stances.dualWieldOffhand.bodyYaw = value;\n        $(`idle_${field.key}_val`).textContent = field.angle ? `${value.toFixed(0)}°` : value.toFixed(2);\n        if (editingNeutral) writeNeutralPose(currentPose());\n        if (selectedKey === 'dualWieldMain' || selectedKey === 'dualWieldOffhand') window.HobunjiDualWieldWeaponVisuals?.syncNow?.();",
        'live explicit dual pose editing',
    ),
    (
        "      selectedKey = select.value;\n      syncFieldsFromPose();",
        "      selectedKey = select.value;\n      syncFieldsFromPose();\n      window.HobunjiDualWieldWeaponVisuals?.syncNow?.();",
        'stance selection dual sync',
    ),
    (
        "    $('idleEditNeutralBtn').addEventListener('click', () => {\n      editingNeutral = !editingNeutral;",
        "    $('idleEditNeutralBtn').addEventListener('click', () => {\n      if (selectedKey === 'dualWieldOffhand' && dualPairPreview) setDualPairPreview(false); // Isolate the offhand copy while the existing Neutral gizmo authors its explicit transform.\n      editingNeutral = !editingNeutral;",
        'offhand gizmo isolation',
    ),
    (
        "    $('idleCaptureBtn').addEventListener('click', () => captureNeutralPose());\n    $('idleResetBtn').addEventListener('click', () => {",
        "    $('idleCaptureBtn').addEventListener('click', () => captureNeutralPose());\n    $('idlePreviewDualPairBtn').addEventListener('click', previewDualWieldMain);\n    $('idleStopDualPairBtn').addEventListener('click', () => {\n      setDualPairPreview(false);\n      setStatus('Stopped Dual Wield pair preview.');\n    });\n    $('idleResetBtn').addEventListener('click', () => {",
        'wire pair preview buttons',
    ),
    (
        "      previewSelected: () => writeNeutralPose(currentPose()),\n      captureSelected: () => captureNeutralPose(),\n      stopEditing: () => stopEditingNeutral('Stopped idle stance editing.'),",
        "      previewSelected: () => writeNeutralPose(currentPose()),\n      captureSelected: () => captureNeutralPose(),\n      previewDualWieldMain,\n      setDualPairPreview,\n      dualWieldPreviewActive: () => dualPairPreview,\n      stopEditing: () => stopEditingNeutral('Stopped idle stance editing.'),",
        'public dual idle editor API',
    ),
    (
        "        return { workingConfig: clone(exportPayload()), selectedKey, editingNeutral }; // Undo/Redo must preserve hidden stances, not only the selected sliders.",
        "        return { workingConfig: clone(exportPayload()), selectedKey, editingNeutral, dualPairPreview }; // Undo/Redo must preserve hidden stances, not only the selected sliders.",
        'history snapshot pair state',
    ),
    (
        "        editingNeutral = snapshot.editingNeutral === true;\n        select.value = selectedKey;",
        "        editingNeutral = snapshot.editingNeutral === true;\n        dualPairPreview = snapshot.dualPairPreview === true;\n        select.value = selectedKey;",
        'history restore pair flag',
    ),
    (
        "        if (editingNeutral) writeNeutralPose(currentPose());\n        setStatus(`History restored ${STANCE_LABELS[selectedKey]}.`);",
        "        if (editingNeutral) writeNeutralPose(currentPose());\n        setDualPairPreview(dualPairPreview);\n        setStatus(`History restored ${STANCE_LABELS[selectedKey]}.`);",
        'history restore pair visuals',
    ),
])

# ---------------------------------------------------------------------------
# Update dual-wield regression and add idle-stance coverage.
# ---------------------------------------------------------------------------
p = Path('scripts/test-dual-wield-weapon-visuals.js')
s = p.read_text()
repls = [
    ("assert.match(dual, /const DUPLICATE_SEPARATION = 0\\.09/, 'dual weapons keep equal/opposite authored separation');", "assert.match(dual, /const DUPLICATE_Z_GAP = 0\\.30/, 'dual weapons use the requested 0.30 total plane-normal gap');", 'dual test gap'),
    ("assert.match(dual, /makeTranslation\\(0, -DUPLICATE_SEPARATION, 0\\)/, 'main duplicate uses one side of the plane-local axis that maps to weapon-parent local Z');", "assert.match(dual, /offsetWorld\\.set\\(0, 0, -HALF_Z_SEPARATION\\)/, 'main duplicate sits on one side of the actual sprite-plane normal');", 'dual test main normal'),
    ("assert.match(dual, /offRoot\\.position\\.set\\(0, DUPLICATE_SEPARATION \\* influence, 0\\)/, 'offhand duplicate uses the equal opposite offset');", "assert.match(dual, /new Vector3\\(0, 0, HALF_Z_SEPARATION\\)/, 'offhand attack duplicate sits on the equal opposite side of the sprite-plane normal');", 'dual test off normal'),
    ("assert.match(dual, /delayedParentMatrix[\\s\\S]*MAIN_HAND_LAG_MS/, 'main root replays a delayed copy of original transforms');", "assert.match(dual, /delayedParentPose[\\s\\S]*MAIN_HAND_LAG_MS/, 'main root replays delayed translation + rotation without inheriting sprite scale twice');", 'dual test delayed pose'),
]
for before, after, label in repls:
    s = replace_once(s, before, after, label)
needle = "assert.match(dual, /current\\.plane\\.updateWorldMatrix\\?\\.\\(true, false\\)[\\s\\S]*current\\.offRoot\\.updateMatrixWorld\\?\\.\\(true\\)[\\s\\S]*current\\.mainRoot\\.updateMatrixWorld\\?\\.\\(true\\)/, 'duplicate world matrices are current before either hand reads its weapon socket');"
s = replace_once(s, needle, needle + "\nassert.match(dual, /root\\.scale\\.set\\(1, 1, 1\\)/, 'dual roots stay unit-scale so the hidden parent is the sole sprite-scale authority');\nassert.match(dual, /idleStancePoses/, 'dual presentation consumes explicit main/offhand idle stance poses');", 'dual test scale + idle')
s = s.replace("console.log('dual wield: hidden parent, opposite duplicate offsets, main-hand lag, live per-hand sockets, default 2H, and mutually exclusive editor mode PASS');", "console.log('dual wield: single inherited scale, 0.30 plane-normal gap, lagged attack main, authored idle pair, live per-hand sockets, default 2H, and mutually exclusive editor mode PASS');")
p.write_text(s)

Path('scripts/test-dual-wield-idle-stance.js').write_text(r"""'use strict';
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
assert.equal(off.bodyYaw, main.bodyYaw, 'both idle weapons share the normal body yaw');

assert.match(editor, /dualWieldMain: 'Dual Wield — Main hand'/, 'idle editor exposes a dedicated main-hand preset');
assert.match(editor, /dualWieldOffhand: 'Dual Wield — Offhand'/, 'idle editor exposes a dedicated offhand preset');
assert.match(editor, /Preview Dual Wield Pair/, 'idle editor can preview both explicitly authored poses together');
assert.match(editor, /selectedKey === 'dualWieldOffhand' && dualPairPreview/, 'offhand gizmo editing isolates the explicit offhand weapon');
assert.match(editor, /previewDualWieldMain/, 'attack hand-mode UI can switch Neutral preview to the shared dual idle main pose');
assert.match(editor, /input\.disabled = selectedKey === 'dualWieldOffhand' && field\.key === 'bodyYaw'/, 'offhand pose shares main body yaw instead of inventing a second body rotation');

assert.match(runtime, /if \(dualWield\) return idleStances\.dualWieldMain/, 'runtime holder uses authored dual main while dual wielding');
assert.match(runtime, /dualWieldIdleRequested/, 'runtime attacks select the dual idle from Neutral hand metadata');
assert.match(grips, /runtimeIdleDualWield/, 'hand-mode state persists dual idle after a dual attack ends');
assert.match(grips, /dualWieldIdleBlend/, 'Neutral-to-attack transitions expose a continuous idle-pose blend');
assert.match(grips, /const canDual = melee;/, 'Neutral Dual Wield is authorable beside the existing hand-mode controls');
assert.match(dual, /idleOffhandLocalTransform/, 'dual visuals convert the explicit body-relative offhand stance into the hidden-plane hierarchy');
assert.match(dual, /HALF_Z_SEPARATION = DUPLICATE_Z_GAP \* 0\.5/, 'the two sprite planes straddle the hidden original with a 0.30 total gap');

console.log('dual wield idle stance: light-main default, authored mirrored offhand, pair preview, runtime persistence, and editable Neutral metadata PASS');
""")

print('Applied dual-wield idle follow-up.')
