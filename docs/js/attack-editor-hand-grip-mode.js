// Adds reusable hand grip-mode selection to the Attack Animation Editor.
(function (global) {
  'use strict';

  const gripModes = global.HobunjiHandGripModes;
  const profileSelect = document.getElementById('handProfileSelect');
  const toolSelect = document.getElementById('toolSpriteSelect');
  if (!gripModes || !profileSelect || document.getElementById('handGripModeSelect')) return;

  const card = profileSelect.closest('.card');
  if (!card) return;

  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `
    <label>Grip mode</label>
    <select id="handGripModeSelect"></select>
    <div class="help" id="handGripModeHelp" style="margin-top:5px"></div>
  `;

  const firstPoseGroup = card.querySelector('#handFromToolPositionGroup') || card.querySelector('.poseGroup');
  card.insertBefore(field, firstPoseGroup || null);

  const select = document.getElementById('handGripModeSelect');
  const help = document.getElementById('handGripModeHelp');
  select.innerHTML = Object.values(gripModes.modes)
    .map(mode => `<option value="${mode.key}">${mode.label}</option>`)
    .join('');

  let manualChoice = false;

  function applyMode(key, manual) {
    if (!gripModes.modes[key]) return;
    manualChoice = !!manual;
    select.value = key;
    gripModes.setEditorMode(key);
    const mode = gripModes.modes[key];
    if (help) help.textContent = `${mode.description} Palm clearance: ${gripModes.palmClearance.toFixed(2)} hand-height units.`;
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function chooseDefaultForTool() {
    const key = gripModes.defaultForTool(toolSelect?.value || '');
    applyMode(key, false);
  }

  select.addEventListener('change', () => applyMode(select.value, true));
  toolSelect?.addEventListener('change', () => {
    // Changing the referenced tool starts from its normal grip convention. The
    // dropdown remains fully manual afterward for attacks/stances that differ.
    manualChoice = false;
    chooseDefaultForTool();
  });

  gripModes.subscribe?.(key => {
    if (!manualChoice && gripModes.modes[key]) select.value = key;
  });

  chooseDefaultForTool();
})(window);
