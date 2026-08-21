(() => {
  'use strict';

  const CONFIG_URL = '../../config/combat/weapon-idle-stances.json?v=20260817a';
  const LOCAL_STORAGE_KEY = 'hobunji.weaponIdleStances.v1';
  const STANCE_ORDER = ['tool', 'hoeTool', 'heavyWeapon', 'lightWeapon'];
  const STANCE_LABELS = Object.freeze({
    tool: 'Tool / Shovel-style',
    hoeTool: 'Hoe Tool',
    heavyWeapon: 'Heavy Weapon',
    lightWeapon: 'Light Weapon',
  });
  const FIELD_DEFS = Object.freeze([
    { key: 'x', label: 'X (side)', min: -1, max: 1, step: 0.01, angle: false },
    { key: 'y', label: 'Y (height)', min: -1, max: 1, step: 0.01, angle: false },
    { key: 'z', label: 'Z (forward)', min: -1, max: 1, step: 0.01, angle: false },
    { key: 'pitch', label: 'Pitch°', min: -180, max: 180, step: 1, angle: true },
    { key: 'yaw', label: 'Tool Yaw°', min: -180, max: 180, step: 1, angle: true },
    { key: 'roll', label: 'Tool Roll°', min: -180, max: 180, step: 1, angle: true },
    { key: 'bodyYaw', label: 'Body Yaw°', min: -180, max: 180, step: 1, angle: true },
  ]);

  const FALLBACK_CONFIG = Object.freeze({
    version: 1,
    kind: 'hobunji_weapon_idle_stances',
    stances: Object.freeze({
      tool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 }),
      hoeTool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: -90 }),
      heavyWeapon: Object.freeze({ x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: -15, roll: -82 }),
      lightWeapon: Object.freeze({ x: 0.04, y: 0, z: 0, pitch: 20, yaw: -70, bodyYaw: -40, roll: -65 }),
    }),
  });

  const clone = value => JSON.parse(JSON.stringify(value));
  const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function normalizePose(raw, fallback) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const field of FIELD_DEFS) out[field.key] = numberOr(source[field.key], fallback[field.key]);
    return out;
  }

  function normalizeConfig(raw, fallback = FALLBACK_CONFIG) {
    const out = { version: 1, kind: 'hobunji_weapon_idle_stances', stances: {} };
    for (const key of STANCE_ORDER) {
      out.stances[key] = normalizePose(raw?.stances?.[key], fallback.stances[key]);
    }
    return out;
  }

  function whenReady(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  whenReady(async () => {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || document.getElementById('idleStanceCard')) return;

    let fileConfig = clone(FALLBACK_CONFIG);
    let workingConfig = clone(FALLBACK_CONFIG);
    let selectedKey = 'lightWeapon';
    let editingNeutral = false;
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
      <div class="hr"></div>
      <div class="row">
        <button id="idleDownloadBtn" class="secondary">⭳ Download idle-stances.json</button>
        <button id="idleCopyBtn" class="secondary">Copy JSON</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="idleSaveOverrideBtn" class="secondary">💾 Save as Local Override</button>
        <button id="idleClearOverrideBtn" class="secondary">🗑 Clear Local Override</button>
      </div>
      <div class="help" id="idleStanceStatus" style="margin-top:7px"></div>
      <div class="help" style="margin-top:7px">Use <b>Edit Selected in Neutral</b> to route the existing Neutral sliders and 3D gizmo into this idle preset. The committed JSON is the game default; Local Override is shared with the game on the same origin for rapid testing.</div>
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

    function syncFieldsFromPose() {
      const pose = currentPose();
      for (const field of FIELD_DEFS) {
        const value = numberOr(pose[field.key]);
        $(`idle_${field.key}`).value = value;
        $(`idle_${field.key}_val`).textContent = field.angle ? `${value.toFixed(0)}°` : value.toFixed(2);
      }
    }

    function neutralControl(fieldKey) {
      return document.getElementById(`neutral_${fieldKey}`);
    }

    function neutralControlsReady() {
      return FIELD_DEFS.every(field => neutralControl(field.key));
    }

    function readNeutralPose() {
      if (!neutralControlsReady()) return null;
      const pose = {};
      for (const field of FIELD_DEFS) pose[field.key] = numberOr(neutralControl(field.key).value);
      return pose;
    }

    function writeNeutralPose(pose) {
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

    function captureNeutralPose({ quiet = false } = {}) {
      const pose = readNeutralPose();
      if (!pose) return false;
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

    function stopEditingNeutral(message = '') {
      editingNeutral = false;
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
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(exportPayload()));
        setStatus('Saved Local Override. Reload the game on this origin to use it.');
      } catch (error) {
        setStatus(`Local Override save failed: ${error?.message || error}`);
      }
    }

    function clearLocalOverride() {
      try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch (_) {}
      workingConfig = clone(fileConfig);
      syncFieldsFromPose();
      if (editingNeutral) writeNeutralPose(currentPose());
      setStatus('Cleared Local Override and restored committed idle stances.');
    }

    for (const field of FIELD_DEFS) {
      const input = $(`idle_${field.key}`);
      input.addEventListener('input', () => {
        const value = numberOr(input.value);
        currentPose()[field.key] = value;
        $(`idle_${field.key}_val`).textContent = field.angle ? `${value.toFixed(0)}°` : value.toFixed(2);
        if (editingNeutral) writeNeutralPose(currentPose());
      });
    }

    select.addEventListener('change', () => {
      selectedKey = select.value;
      syncFieldsFromPose();
      updateEditButton();
      if (editingNeutral) writeNeutralPose(currentPose());
      setStatus(`${STANCE_LABELS[selectedKey]} selected.`);
    });

    $('idleEditNeutralBtn').addEventListener('click', () => {
      editingNeutral = !editingNeutral;
      updateEditButton();
      if (editingNeutral) {
        if (writeNeutralPose(currentPose())) setStatus(`Neutral sliders + gizmo now edit ${STANCE_LABELS[selectedKey]}.`);
        else stopEditingNeutral();
      } else {
        setStatus('Stopped routing Neutral edits into idle stances.');
      }
    });

    $('idlePreviewBtn').addEventListener('click', () => {
      if (writeNeutralPose(currentPose())) setStatus(`Previewing ${STANCE_LABELS[selectedKey]} in Neutral.`);
    });
    $('idleCaptureBtn').addEventListener('click', () => captureNeutralPose());
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

    try {
      const response = await fetch(CONFIG_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      fileConfig = normalizeConfig(await response.json(), FALLBACK_CONFIG);
      workingConfig = clone(fileConfig);
      setStatus('Loaded committed idle stance config.');
    } catch (error) {
      fileConfig = clone(FALLBACK_CONFIG);
      workingConfig = clone(FALLBACK_CONFIG);
      setStatus(`Using built-in idle stance defaults (${error?.message || error}).`);
    }

    try {
      const localRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (localRaw) {
        workingConfig = normalizeConfig(JSON.parse(localRaw), fileConfig);
        setStatus('Loaded Local Override over the committed idle stance config.');
      }
    } catch (error) {
      setStatus(`Ignored invalid Local Override: ${error?.message || error}`);
    }

    syncFieldsFromPose();
    updateEditButton();

    window.AttackIdleStanceEditor = {
      getConfig: () => clone(exportPayload()),
      getSelected: () => selectedKey,
      previewSelected: () => writeNeutralPose(currentPose()),
      captureSelected: () => captureNeutralPose(),
      stopEditing: () => stopEditingNeutral('Stopped idle stance editing.'),
    };
  });
})();
