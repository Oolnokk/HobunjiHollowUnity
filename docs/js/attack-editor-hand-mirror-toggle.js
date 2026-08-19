// Adds a pair-wide horizontal hand mirror toggle to the Attack Animation Editor.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const profileSelect = document.getElementById('handProfileSelect');
  const modelScale = document.getElementById('handModelScale');
  if (!profiles || !profileSelect || !modelScale || document.getElementById('handMirrorGlbX')) return;

  const scaleGroup = modelScale.closest('.poseGroup');
  if (!scaleGroup) return;

  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `
    <label class="fieldRow" style="cursor:pointer">
      <input type="checkbox" id="handMirrorGlbX" style="width:auto;margin-right:6px">
      Mirror hands horizontally
    </label>
    <div class="help">Flips both generated hands across their own local X axis. This is separate from the model's source-handedness convention, so left and right always change together.</div>
    <div class="help" id="handMirrorPairStatus" style="margin-top:5px"></div>
  `;
  scaleGroup.appendChild(field);

  const checkbox = document.getElementById('handMirrorGlbX');
  const status = document.getElementById('handMirrorPairStatus');

  function currentModel() {
    return profiles.data.models?.[profileSelect.value] || null;
  }

  function refreshStatus() {
    if (!status) return;
    const enabled = currentModel()?.horizontalMirrorX === true;
    const rows = global.ProceduralHandPairMirror?.getDebug?.()?.rigs || [];
    const species = String(document.getElementById('avatarSpecies')?.value || '');
    const row = rows.find(entry => entry?.speciesId === species) || rows[0] || null;
    const left = row ? (row.leftApplied === enabled ? '✓' : '…') : '…';
    const right = row ? (row.rightApplied === enabled ? '✓' : '…') : '…';
    status.textContent = `Pair mirror ${enabled ? 'ON' : 'OFF'} · left ${left} · right ${right}`;
    status.style.color = row && (row.leftApplied !== enabled || row.rightApplied !== enabled) ? '#fbbf24' : '';
  }

  function sync() {
    checkbox.checked = currentModel()?.horizontalMirrorX === true;
    refreshStatus();
  }

  checkbox.addEventListener('change', () => {
    const key = profileSelect.value;
    profiles.mutate(data => {
      const model = data.models?.[key];
      if (model) model.horizontalMirrorX = checkbox.checked;
    });
    global.ProceduralHandPairMirror?.refreshAll?.();
    requestAnimationFrame(refreshStatus);
  });

  profileSelect.addEventListener('change', sync);
  profiles.subscribe?.(sync);
  setInterval(refreshStatus, 350); // Keeps left/right application visible after asynchronous GLB replacement.
  sync();
})(window);
