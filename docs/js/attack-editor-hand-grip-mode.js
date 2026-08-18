// Adds reusable hand grip-mode selection to the Attack Animation Editor and
// persists the selected mode in the editor's normal animation JSON.
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
  const jsonView = document.getElementById('jsonView');
  const exportBtn = document.getElementById('exportBtn');
  const loadFile = document.getElementById('loadFile');
  const textareaValue = global.HTMLTextAreaElement
    ? Object.getOwnPropertyDescriptor(global.HTMLTextAreaElement.prototype, 'value')
    : null;

  select.innerHTML = Object.values(gripModes.modes)
    .map(mode => `<option value="${mode.key}">${mode.label}</option>`)
    .join('');

  let manualChoice = false;

  function jsonWithGripMode(raw) {
    try {
      const parsed = JSON.parse(String(raw || ''));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
      parsed.gripMode = select.value || gripModes.currentModeKey();
      return JSON.stringify(parsed, null, 2);
    } catch (_) {
      return raw;
    }
  }

  function refreshJsonGripMode() {
    if (!jsonView || !textareaValue?.get || !textareaValue?.set) return;
    const current = textareaValue.get.call(jsonView);
    if (!current) return;
    textareaValue.set.call(jsonView, jsonWithGripMode(current));
  }

  // Core refreshJsonView() assigns textarea.value directly. Intercept only this
  // textarea so every normal core refresh automatically carries gripMode without
  // replacing or forking the editor's module-scoped animation object.
  if (jsonView && textareaValue?.get && textareaValue?.set && !jsonView.__hobunjiGripModeValueWrapped) {
    Object.defineProperty(jsonView, 'value', {
      configurable: true,
      enumerable: true,
      get() { return textareaValue.get.call(this); },
      set(value) { textareaValue.set.call(this, jsonWithGripMode(value)); },
    });
    Object.defineProperty(jsonView, '__hobunjiGripModeValueWrapped', { value: true, configurable: true });
  }

  function applyMode(key, manual) {
    if (!gripModes.modes[key]) return;
    manualChoice = !!manual;
    select.value = key;
    gripModes.setEditorMode(key);
    const mode = gripModes.modes[key];
    if (help) help.textContent = `${mode.description} Palm clearance: ${gripModes.palmClearance.toFixed(2)} hand-height units.`;
    refreshJsonGripMode();
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

  // Core export builds directly from its private animation object rather than
  // jsonView, so handle the export button in capture phase and add the one extra
  // serializable field to the already-rendered core JSON. Copy JSON needs no
  // special handler because it already copies jsonView.value.
  exportBtn?.addEventListener('click', event => {
    if (!jsonView || !textareaValue?.get) return;
    let obj;
    try { obj = JSON.parse(textareaValue.get.call(jsonView)); }
    catch (_) { return; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    obj.gripMode = select.value || gripModes.currentModeKey();
    event.preventDefault();
    event.stopImmediatePropagation();
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${(obj.name || 'attack').replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }, true);

  // Restore the mode when loading an animation exported with this field. The
  // editor's own loader still owns every other field.
  loadFile?.addEventListener('change', async () => {
    const file = loadFile.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (gripModes.modes[parsed?.gripMode]) {
        setTimeout(() => applyMode(parsed.gripMode, true), 0);
      }
    } catch (_) {}
  });

  chooseDefaultForTool();
})(window);
