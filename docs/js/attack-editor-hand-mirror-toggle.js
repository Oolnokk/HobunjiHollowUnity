// Adds a per-model GLB handedness toggle to the Attack Animation Editor.
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
      Mirror GLB horizontally
    </label>
    <div class="help">Flips the imported hand source across local X before left/right side mirroring. Use this if the GLB was authored with the opposite handedness.</div>
  `;
  scaleGroup.appendChild(field);

  const checkbox = document.getElementById('handMirrorGlbX');

  function currentModel() {
    return profiles.data.models?.[profileSelect.value] || null;
  }

  function sync() {
    checkbox.checked = currentModel()?.mirrorX === true;
  }

  checkbox.addEventListener('change', () => {
    const key = profileSelect.value;
    profiles.mutate(data => {
      const model = data.models?.[key];
      if (model) model.mirrorX = checkbox.checked;
    });
  });

  profileSelect.addEventListener('change', sync);
  profiles.subscribe?.(sync);
  sync();
})(window);
