(() => {
  'use strict';

  const CONFIG_URL = '../../config/combat/weapon-idle-stances.json?v=20261017toolstance1';
  const LOCAL_STORAGE_KEY = 'hobunji.weaponIdleStances.v1';
  const STANCE_ORDER = ['tool', 'hoeTool', 'topHeavyTool', 'longHaftedTool', 'heavyWeapon', 'lightWeapon', 'dualWieldMain', 'dualWieldOffhand'];
  const STANCE_LABELS = Object.freeze({
    tool: 'Tool / Shovel-style',
    hoeTool: 'Hoe Tool (unused — Top-heavy Tool replaced it)',
    topHeavyTool: 'Top-heavy Tool (hoe / hatchet / fishing mace)',
    longHaftedTool: 'Long-hafted Tool (fishing spear / pick-shovel)',
    heavyWeapon: 'Heavy Weapon',
    lightWeapon: 'Light Weapon',
    dualWieldMain: 'Dual Wield — Main hand',
    dualWieldOffhand: 'Dual Wield — Offhand',
  });
  const FIELD_DEFS = Object.freeze([
    { key: 'x', label: 'Tool X position (side)', min: -1, max: 1, step: 0.01, angle: false },
    { key: 'y', label: 'Tool Y position (height)', min: -1, max: 1, step: 0.01, angle: false },
    { key: 'z', label: 'Tool Z position (forward)', min: -1, max: 1, step: 0.01, angle: false },
    { key: 'pitch', label: 'Tool X rotation°', min: -180, max: 180, step: 1, angle: true },
    { key: 'yaw', label: 'Tool Y rotation°', min: -180, max: 180, step: 1, angle: true },
    { key: 'roll', label: 'Tool Z rotation°', min: -180, max: 180, step: 1, angle: true },
    { key: 'bodyYaw', label: 'Character Y rotation°', min: -180, max: 180, step: 1, angle: true },
  ]);

  const FALLBACK_CONFIG = Object.freeze({
    version: 2,
    kind: 'hobunji_weapon_idle_stances',
    stances: Object.freeze({
      tool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 }),
      hoeTool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: -95 }),
      topHeavyTool: Object.freeze({ x: -0.14, y: -0.07, z: -0.18, pitch: -22, yaw: -21, bodyYaw: -8, roll: -99 }),
      longHaftedTool: Object.freeze({ x: 0.21, y: -0.12, z: -0.08, pitch: 17, yaw: -49, bodyYaw: -8, roll: -96 }),
      heavyWeapon: Object.freeze({ x: -0.03, y: 0.27, z: 0.02, pitch: -23, yaw: 104, bodyYaw: -15, roll: 89 }),
      lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
      dualWieldMain: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
      dualWieldOffhand: Object.freeze({ x: 0.13, y: -0.04, z: 0.1, pitch: 40, yaw: 88, bodyYaw: -40, roll: -73 }),
    }),
  });

  const PREVIOUS_LIGHT_WEAPON_STANCE = Object.freeze({ x: -0.09, y: -0.08, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function normalizePose(raw, fallback) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const field of FIELD_DEFS) out[field.key] = numberOr(source[field.key], fallback[field.key]);
    return out;
  }

  function normalizeConfig(raw, fallback = FALLBACK_CONFIG) {
    const out = { version: 2, kind: 'hobunji_weapon_idle_stances', stances: {} };
    for (const key of STANCE_ORDER) {
      out.stances[key] = normalizePose(raw?.stances?.[key], fallback.stances[key]);
    }
    const incomingLight = raw?.stances?.lightWeapon;
    const wasPreviousDefault = incomingLight && FIELD_DEFS.every(field =>
      Math.abs(numberOr(incomingLight[field.key]) - PREVIOUS_LIGHT_WEAPON_STANCE[field.key]) < 1e-9
    );
    if (wasPreviousDefault) out.stances.lightWeapon.y = 0; // Keep editor/runtime parity for exact old saved defaults without touching authored variants.
    out.stances.dualWieldOffhand.bodyYaw = out.stances.dualWieldMain.bodyYaw; // Body yaw is shared; only the offhand weapon transform is independently authored.
    return out;
  }

  function whenReady(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  whenReady(() => {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || document.getElementById('idleStanceCard')) return;

    let fileConfig = clone(FALLBACK_CONFIG);
    let workingConfig = clone(FALLBACK_CONFIG);
    let selectedKey = 'lightWeapon';
    let editingNeutral = false;
    let savedLocalOverride = null; // Kept so a later committed-config retry cannot overwrite the local user's chosen poses.
    let lastAutoAppliedConfig = JSON.stringify(workingConfig); // Tracks only automatic loads; user edits remain untouched after delayed fetches.
    let configRequest = null; // Coalesces concurrent editor config retries.
    let configRetryTimer = null; // Retries a temporary failure without asking the user to reload the editor.
    let configFailures = 0; // Backoff grows to a 30-second ceiling during network outages.
    const dualPairPreviewActive = () => window.HobunjiHandToolGrips?.getEditorIdlePreview?.() === true;
    let lastNeutralSignature = '';

    const card = document.createElement('div');
    card.id = 'idleStanceCard';
    card.className = 'card section';
    card.style.cssText = '--sec:#22d3ee;--secBg:rgba(34,211,238,.10)';
    card.innerHTML = `
      <div class="sectionTitle"><b>Idle Stances</b><span class="sectionTag">tool / weapon rest</span></div>
      <div class="field"><label>Stance preset</label><select id="idleStanceSelect"></select></div>
      <div id="idleStanceFields"></div>
      <div class="row" style="margin-top:4px">
        <button id="idleEditNeutralBtn" class="good">Edit Selected in Neutral</button>
        <button id="idlePreviewBtn" class="secondary">Preview Once</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="idleCaptureBtn" class="secondary">Capture Neutral</button>
        <button id="idleResetBtn" class="secondary">Reset Selected</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="idleMirrorDualOffhandBtn" class="secondary">Mirror Main → Offhand</button>
        <button id="idlePreviewDualPairBtn" class="secondary">Preview Dual Wield Pair</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="idleStopDualPairBtn" class="secondary">Stop Pair Preview</button>
      </div>
      <div class="hr"></div>
      <div class="row">
        <button id="idleDownloadBtn" class="secondary">⭳ Download idle-stances.json</button>
        <button id="idleCopyBtn" class="secondary">Copy JSON</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="idleSaveOverrideBtn" class="secondary">💾 Save as Local Override</button>
        <button id="idleClearOverrideBtn" class="secondary">🗑 Clear Local Override</button>
        <button id="idleReloadConfigBtn" class="secondary">↻ Retry Committed Config</button>
      </div>
      <div class="help" id="idleStanceStatus" style="margin-top:7px"></div>
      <div class="help" style="margin-top:7px">Use <b>Edit Selected in Neutral</b> to route the existing Neutral sliders and 3D gizmo into any idle preset, including <b>Dual Wield — Offhand</b>. <b>Mirror Main → Offhand</b> performs the same stance mirror as the editor's <b>Mirror Animation</b> operation—X/Yaw/Roll mirror, Y/Z/Pitch stay—but intentionally leaves Body Yaw unchanged and assigns the result to the other hand. The runtime also mirrors the hand-side anchor and grip direction. Afterward the offhand x/y/z and pitch/yaw/roll remain fully custom and saved explicitly. <b>Preview Dual Wield Pair</b> shows both saved poses together.</div>
    `;

    const firstCard = sidebar.querySelector('.card');
    if (firstCard?.nextSibling) sidebar.insertBefore(card, firstCard.nextSibling);
    else sidebar.appendChild(card);

    const $ = id => document.getElementById(id);
    const select = $('idleStanceSelect');
    const fieldsHost = $('idleStanceFields');
    const status = $('idleStanceStatus');
    select.innerHTML = STANCE_ORDER.map(key => `<option value="${key}">${STANCE_LABELS[key]}</option>`).join('');
    select.value = selectedKey;

    fieldsHost.innerHTML = FIELD_DEFS.map(field => `
      <div class="field">
        <label>${field.label}</label>
        <div class="fieldRow">
          <input type="range" id="idle_${field.key}" min="${field.min}" max="${field.max}" step="${field.step}">
          <span class="val" id="idle_${field.key}_val"></span>
        </div>
      </div>`).join('');

    function setStatus(message) {
      status.textContent = message;
    }

    function currentPose() {
      return workingConfig.stances[selectedKey];
    }

    function setDualPairPreview(active) {
      window.HobunjiDualWieldWeaponVisuals?.setEditorIdlePreview?.(active);
      window.HobunjiDualWieldWeaponVisuals?.syncNow?.();
      window.ProceduralHandFrameDriver?.syncNow?.();
      return dualPairPreviewActive();
    }

    function mirrorDualWieldMainToOffhand() {
      const main = workingConfig.stances.dualWieldMain;
      if (!main) return false;
      workingConfig.stances.dualWieldOffhand = normalizePose({
        ...main,
        x: -(Number(main.x) || 0),
        yaw: -(Number(main.yaw) || 0),
        roll: -(Number(main.roll) || 0),
        bodyYaw: Number(main.bodyYaw) || 0, // Deliberately NOT mirrored: both weapons share the normal body yaw.
      }, FALLBACK_CONFIG.stances.dualWieldOffhand);
      selectedKey = 'dualWieldOffhand';
      select.value = selectedKey;
      syncFieldsFromPose();
      updateEditButton();
      previewDualWieldMain();
      setStatus('Mirrored Dual Wield Main into Offhand using Mirror Animation rules, with Body Yaw preserved. Offhand transforms are now independently editable.');
      return true;
    }

    function previewDualWieldMain() {
      const main = workingConfig.stances.dualWieldMain;
      if (!main) return false;
      stopEditingNeutral(); // Pair preview must not capture the main pose into a selected offhand preset.
      const shown = writeNeutralPose(main);
      if (shown) {
        setDualPairPreview(true);
        setStatus('Previewing the authored Dual Wield main + offhand idle pair.');
      }
      return shown;
    }

    function syncFieldsFromPose() {
      const pose = currentPose();
      if (selectedKey === 'dualWieldOffhand') pose.bodyYaw = workingConfig.stances.dualWieldMain.bodyYaw;
      for (const field of FIELD_DEFS) {
        const value = numberOr(pose[field.key]);
        const input = $(`idle_${field.key}`);
        input.value = value;
        input.disabled = selectedKey === 'dualWieldOffhand' && field.key === 'bodyYaw';
        $(`idle_${field.key}_val`).textContent = field.angle ? `${value.toFixed(0)}°` : value.toFixed(2);
      }
    }

    function focusNeutralEditorPose() {
      const neutralTab = document.getElementById('poseTabNeutral'); // Current editor has one pose panel; selecting Neutral materializes pose_* controls.
      if (neutralTab && !neutralTab.classList.contains('active')) neutralTab.click();
    }

    function neutralControl(fieldKey) {
      return document.getElementById(`pose_${fieldKey}`);
    }

    function neutralControlsReady() {
      focusNeutralEditorPose();
      return FIELD_DEFS.every(field => neutralControl(field.key));
    }

    function readNeutralPose() {
      if (!neutralControlsReady()) return null;
      const pose = {};
      for (const field of FIELD_DEFS) pose[field.key] = numberOr(neutralControl(field.key).value);
      return pose;
    }

    function writeNeutralPose(pose) {
      focusNeutralEditorPose();
      if (!neutralControlsReady()) {
        setStatus('Neutral pose controls are not ready yet.');
        return false;
      }
      for (const field of FIELD_DEFS) {
        const input = neutralControl(field.key);
        const next = numberOr(pose[field.key]);
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      lastNeutralSignature = JSON.stringify(readNeutralPose());
      return true;
    }

    // The saved stance belongs to the hidden source weapon, which sits a little off the visible offhand copy, so turning only
    // the rotation would swing the copy around that point. Re-aim X/Y/Z so the copy turns in place; both rotation frames use
    // the editor's YXZ order (yaw, pitch, roll).
    let pivotOffsetCache = null;
    function pivotCompensated(prev, next) {
      const ctx = window.HobunjiAttackEditorToolContext;
      if (!(editingNeutral && selectedKey === 'dualWieldOffhand') || !ctx?.offhandPivotPoseOffset || !ctx.THREE) return next;
      const rotated = ['pitch', 'yaw', 'roll'].some(key => Math.abs(numberOr(next[key]) - numberOr(prev[key])) > 1e-9);
      const moved = ['x', 'y', 'z'].some(key => Math.abs(numberOr(next[key]) - numberOr(prev[key])) > 0.0075); // Neutral's 0.01-step sliders hand back rounded X/Y/Z; that rounding is not a position edit.
      if (!rotated || moved) return next; // Position edits (e.g. a gizmo drag, which already pivots on the copy) are left as authored.
      if (!pivotOffsetCache || pivotOffsetCache.key !== ctx.toolKey) { // Constant for a given weapon sprite, so measure it once rather than mid-update.
        const measured = ctx.offhandPivotPoseOffset();
        pivotOffsetCache = measured ? { key: ctx.toolKey, ...measured } : null;
      }
      const offset = pivotOffsetCache;
      if (!offset) return next;
      const T = ctx.THREE;
      const quat = pose => new T.Quaternion().setFromEuler(new T.Euler(
        numberOr(pose.pitch) * Math.PI / 180, numberOr(pose.yaw) * Math.PI / 180, numberOr(pose.roll) * Math.PI / 180, 'YXZ'));
      const before = new T.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quat(prev));
      const after = new T.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quat(next));
      return { ...next, x: numberOr(next.x) + before.x - after.x, y: numberOr(next.y) + before.y - after.y, z: numberOr(next.z) + before.z - after.z };
    }

    function captureNeutralPose({ quiet = false } = {}) {
      let pose = readNeutralPose();
      if (!pose) return false;
      const compensated = pivotCompensated(currentPose(), pose);
      if (compensated !== pose) { pose = compensated; writeNeutralPose(pose); } // Neutral sliders show the re-aimed position too.
      workingConfig.stances[selectedKey] = normalizePose(pose, currentPose());
      syncFieldsFromPose();
      lastNeutralSignature = JSON.stringify(pose);
      if (!quiet) setStatus(`Captured Neutral as ${STANCE_LABELS[selectedKey]}.`);
      return true;
    }

    function updateEditButton() {
      const button = $('idleEditNeutralBtn');
      button.classList.toggle('active', editingNeutral);
      button.textContent = editingNeutral
        ? `✓ Editing ${STANCE_LABELS[selectedKey]} in Neutral`
        : 'Edit Selected in Neutral';
    }

    function dualToolActive() {
      return window.HobunjiHandToolGrips?.isDualWieldWeapon?.(window.HobunjiAttackEditorToolContext?.toolKey || '') === true;
    }

    // Decides what the Neutral gizmo drags. Offhand: the visible offhand weapon itself (anchor on its side, main copy
    // placed from its saved stance), not the hidden main-hand parent the attack copies follow. Everything else: one weapon.
    function applyEditPreviewMode() {
      pivotOffsetCache = null;
      const offhand = editingNeutral && selectedKey === 'dualWieldOffhand';
      const pair = offhand && dualToolActive();
      window.HobunjiDualWieldWeaponVisuals?.setEditorOffhandAuthoring?.(pair);
      if (pair) setDualPairPreview(true);
      else window.HobunjiHandToolGrips?.setEditorSingleHandPreview?.(editingNeutral);
      window.HobunjiDualWieldWeaponVisuals?.syncNow?.();
      window.ProceduralHandFrameDriver?.syncNow?.();
      window.HobunjiAttackEditorToolContext?.setOffhandAuthoringBase?.(offhand); // Last: it re-targets the gizmo, which needs the offhand copy to exist already.
    }

    function stopEditingNeutral(message = '') {
      const wasEditing = editingNeutral;
      editingNeutral = false;
      if (wasEditing) applyEditPreviewMode();
      updateEditButton();
      if (message) setStatus(message);
    }

    function exportPayload() {
      return normalizeConfig(workingConfig, fileConfig);
    }

    function jsonText() {
      return JSON.stringify(exportPayload(), null, 2) + '\n';
    }

    function downloadJson() {
      const blob = new Blob([jsonText()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'weapon-idle-stances.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus('Downloaded weapon-idle-stances.json.');
    }

    async function copyJson() {
      try {
        await navigator.clipboard.writeText(jsonText());
        setStatus('Copied idle stance JSON.');
      } catch (error) {
        setStatus(`Copy failed: ${error?.message || error}`);
      }
    }

    function saveLocalOverride() {
      try {
        savedLocalOverride = exportPayload();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(savedLocalOverride));
        lastAutoAppliedConfig = JSON.stringify(workingConfig);
        setStatus('Saved Local Override. Reload the game on this origin to use it.');
      } catch (error) {
        setStatus(`Local Override save failed: ${error?.message || error}`);
      }
    }

    function clearLocalOverride() {
      try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch (_) {}
      savedLocalOverride = null;
      workingConfig = clone(fileConfig);
      lastAutoAppliedConfig = JSON.stringify(workingConfig);
      syncFieldsFromPose();
      if (editingNeutral) writeNeutralPose(currentPose());
      setStatus('Cleared Local Override and restored committed idle stances.');
    }

    for (const field of FIELD_DEFS) {
      const input = $(`idle_${field.key}`);
      input.addEventListener('input', () => {
        const value = numberOr(input.value);
        if (selectedKey === 'dualWieldOffhand' && field.key === 'bodyYaw') return;
        const previous = { ...currentPose() };
        currentPose()[field.key] = value;
        const compensated = pivotCompensated(previous, currentPose());
        if (compensated !== currentPose()) {
          Object.assign(currentPose(), { x: compensated.x, y: compensated.y, z: compensated.z });
          for (const key of ['x', 'y', 'z']) { // Show the re-aimed position on the stance sliders too.
            $(`idle_${key}`).value = currentPose()[key];
            $(`idle_${key}_val`).textContent = currentPose()[key].toFixed(2);
          }
        }
        if (selectedKey === 'dualWieldMain' && field.key === 'bodyYaw') workingConfig.stances.dualWieldOffhand.bodyYaw = value;
        $(`idle_${field.key}_val`).textContent = field.angle ? `${value.toFixed(0)}°` : value.toFixed(2);
        if (editingNeutral) writeNeutralPose(currentPose());
        if (selectedKey === 'dualWieldMain' || selectedKey === 'dualWieldOffhand') window.HobunjiDualWieldWeaponVisuals?.syncNow?.();
      });
    }

    select.addEventListener('change', () => {
      selectedKey = select.value;
      syncFieldsFromPose();
      window.HobunjiDualWieldWeaponVisuals?.syncNow?.();
      updateEditButton();
      if (editingNeutral) { writeNeutralPose(currentPose()); applyEditPreviewMode(); }
      setStatus(`${STANCE_LABELS[selectedKey]} selected.`);
    });

    $('idleEditNeutralBtn').addEventListener('click', () => {
      if (dualPairPreviewActive()) setDualPairPreview(false); // Any earlier pair preview is rebuilt below for the mode actually being edited.
      editingNeutral = !editingNeutral;
      updateEditButton();
      if (editingNeutral) {
        if (writeNeutralPose(currentPose())) {
          applyEditPreviewMode();
          setStatus(selectedKey === 'dualWieldOffhand' && dualToolActive()
            ? 'Neutral sliders + gizmo now move the offhand weapon itself; the main-hand copy stays at its saved stance.'
            : `Neutral sliders + gizmo now edit ${STANCE_LABELS[selectedKey]}.`);
        } else stopEditingNeutral();
      } else {
        applyEditPreviewMode();
        setStatus('Stopped routing Neutral edits into idle stances.');
      }
    });

    // Offhand authoring re-anchors the preview, so it must never leak into attack authoring: picking another action or
    // opening a Windup/Strike pose ends it. (Neutral stays, since that is where the stance is edited.)
    const leaveOffhandAuthoring = () => {
      if (editingNeutral && selectedKey === 'dualWieldOffhand') stopEditingNeutral('Stopped idle stance editing: moved on to attack authoring.');
    };
    document.getElementById('actionSelect')?.addEventListener('change', leaveOffhandAuthoring);
    document.querySelectorAll('[data-edit-phase]').forEach(button => {
      button.addEventListener('click', () => { if (button.dataset.editPhase !== 'neutral') leaveOffhandAuthoring(); });
    });

    $('idleMirrorDualOffhandBtn').addEventListener('click', mirrorDualWieldMainToOffhand);

    $('idlePreviewBtn').addEventListener('click', () => {
      if (writeNeutralPose(currentPose())) setStatus(`Previewing ${STANCE_LABELS[selectedKey]} in Neutral.`);
    });
    $('idleCaptureBtn').addEventListener('click', () => captureNeutralPose());
    $('idlePreviewDualPairBtn').addEventListener('click', previewDualWieldMain);
    $('idleStopDualPairBtn').addEventListener('click', () => {
      setDualPairPreview(false);
      setStatus('Stopped Dual Wield pair preview.');
    });
    $('idleResetBtn').addEventListener('click', () => {
      workingConfig.stances[selectedKey] = clone(fileConfig.stances[selectedKey] || FALLBACK_CONFIG.stances[selectedKey]);
      syncFieldsFromPose();
      if (editingNeutral) writeNeutralPose(currentPose());
      setStatus(`Reset ${STANCE_LABELS[selectedKey]} to the committed value.`);
    });
    $('idleDownloadBtn').addEventListener('click', downloadJson);
    $('idleCopyBtn').addEventListener('click', copyJson);
    $('idleSaveOverrideBtn').addEventListener('click', saveLocalOverride);
    $('idleClearOverrideBtn').addEventListener('click', clearLocalOverride);

    function pollNeutralGizmoEdits() {
      if (editingNeutral) {
        const pose = readNeutralPose();
        const signature = pose ? JSON.stringify(pose) : '';
        if (signature && signature !== lastNeutralSignature) captureNeutralPose({ quiet: true });
      }
      requestAnimationFrame(pollNeutralGizmoEdits);
    }
    requestAnimationFrame(pollNeutralGizmoEdits);

    // Apply the locally-authored stance immediately: remote JSON may be slow or unavailable.
    try {
      const localRaw = localStorage.getItem(LOCAL_STORAGE_KEY); // Cached override for this browser origin, separate from the committed JSON.
      if (localRaw) {
        savedLocalOverride = JSON.parse(localRaw);
        if (savedLocalOverride?.kind !== 'hobunji_weapon_idle_stances' || !savedLocalOverride.stances) throw new Error('schema mismatch');
        workingConfig = normalizeConfig(savedLocalOverride, fileConfig);
        setStatus('Loaded Local Override; checking committed stance config.');
      }
    } catch (error) {
      savedLocalOverride = null;
      setStatus(`Ignored invalid Local Override: ${error?.message || error}`);
    }
    lastAutoAppliedConfig = JSON.stringify(workingConfig);

    function refreshCommittedConfig() {
      if (configRequest) return configRequest;
      if (configRetryTimer !== null) {
        clearTimeout(configRetryTimer);
        configRetryTimer = null;
      }
      configRequest = (async () => {
        const controller = typeof AbortController === 'function' ? new AbortController() : null; // Stops a hung editor fetch from locking fallback stances forever.
        const deadline = controller ? setTimeout(() => controller.abort(), 10000) : null; // Ten-second cap per request before backing off.
        try {
          const response = await fetch(CONFIG_URL, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const parsed = await response.json();
          const complete = parsed?.kind === 'hobunji_weapon_idle_stances'
            && parsed.stances && STANCE_ORDER.every(key => FIELD_DEFS.every(field =>
              typeof parsed.stances[key]?.[field.key] === 'number' && Number.isFinite(parsed.stances[key][field.key]))); // Missing committed poses must retry, not silently fall back for this session.
          if (!complete) throw new Error('incomplete stance config');
          fileConfig = normalizeConfig(parsed, FALLBACK_CONFIG);
          if (JSON.stringify(workingConfig) === lastAutoAppliedConfig) {
            workingConfig = savedLocalOverride ? normalizeConfig(savedLocalOverride, fileConfig) : clone(fileConfig);
            lastAutoAppliedConfig = JSON.stringify(workingConfig);
            syncFieldsFromPose();
            if (editingNeutral) writeNeutralPose(currentPose());
          }
          configFailures = 0;
          setStatus(savedLocalOverride
            ? 'Loaded committed stance config; Local Override retained.'
            : 'Loaded committed stance config (existing unsaved edits preserved).');
          return true;
        } catch (error) {
          configFailures += 1;
          const retryMs = Math.min(30000, 1000 * (2 ** Math.min(configFailures - 1, 5))); // A persistent outage no longer locks the editor for a full session.
          setStatus(`Using local/built-in stance defaults (${error?.message || error}); retrying in ${Math.round(retryMs / 1000)}s.`);
          configRetryTimer = setTimeout(() => {
            configRetryTimer = null;
            void refreshCommittedConfig();
          }, retryMs);
          return false;
        } finally {
          if (deadline !== null) clearTimeout(deadline);
        }
      })().finally(() => { configRequest = null; });
      return configRequest;
    }

    $('idleReloadConfigBtn').addEventListener('click', () => { void refreshCommittedConfig(); });

    syncFieldsFromPose();
    updateEditButton();

    window.AttackIdleStanceEditor = {
      getConfig: () => clone(exportPayload()),
      reloadCommittedConfig: refreshCommittedConfig,
      getSelected: () => selectedKey,
      previewSelected: () => writeNeutralPose(currentPose()),
      captureSelected: () => captureNeutralPose(),
      previewDualWieldMain,
      mirrorDualWieldMainToOffhand,
      setDualPairPreview,
      dualWieldPreviewActive: dualPairPreviewActive,
      stopEditing: () => stopEditingNeutral('Stopped idle stance editing.'),
      snapshot() {
        return { workingConfig: clone(exportPayload()), selectedKey, editingNeutral, dualPairPreview: dualPairPreviewActive() }; // Undo/Redo must preserve hidden stances, not only the selected sliders.
      },
      restore(snapshot) {
        if (!snapshot?.workingConfig) return false;
        workingConfig = normalizeConfig(clone(snapshot.workingConfig), fileConfig);
        selectedKey = STANCE_ORDER.includes(snapshot.selectedKey) ? snapshot.selectedKey : selectedKey;
        editingNeutral = snapshot.editingNeutral === true;
        const dualPairPreview = snapshot.dualPairPreview === true;
        select.value = selectedKey;
        syncFieldsFromPose();
        updateEditButton();
        if (editingNeutral) writeNeutralPose(currentPose());
        setDualPairPreview(dualPairPreview);
        if (editingNeutral) applyEditPreviewMode();
        else {
          window.HobunjiDualWieldWeaponVisuals?.setEditorOffhandAuthoring?.(false);
          window.HobunjiAttackEditorToolContext?.setOffhandAuthoringBase?.(false);
        }
        setStatus(`History restored ${STANCE_LABELS[selectedKey]}.`);
        return true;
      },
      refresh() {
        syncFieldsFromPose();
        updateEditButton();
        if (editingNeutral) writeNeutralPose(currentPose());
      },
    };
    void refreshCommittedConfig();
  });
})();
