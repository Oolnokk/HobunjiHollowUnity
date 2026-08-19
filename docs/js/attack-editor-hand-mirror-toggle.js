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
  `;
  scaleGroup.appendChild(field);

  const checkbox = document.getElementById('handMirrorGlbX');

  function currentModel() {
    return profiles.data.models?.[profileSelect.value] || null;
  }

  function sync() {
    checkbox.checked = currentModel()?.horizontalMirrorX === true;
  }

  checkbox.addEventListener('change', () => {
    const key = profileSelect.value;
    profiles.mutate(data => {
      const model = data.models?.[key];
      if (model) model.horizontalMirrorX = checkbox.checked;
    });
    global.ProceduralHandPairMirror?.refreshAll?.();
  });

  profileSelect.addEventListener('change', sync);
  profiles.subscribe?.(sync);
  sync();
})(window);
