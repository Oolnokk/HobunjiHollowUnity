// Adds pair-wide local-axis hand mirror toggles to the Attack Animation Editor.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const profileSelect = document.getElementById('handProfileSelect');
  const modelScale = document.getElementById('handModelScale');
  if (!profiles || !profileSelect || !modelScale || document.getElementById('handMirrorAxisX')) return;

  const scaleGroup = modelScale.closest('.poseGroup');
  if (!scaleGroup) return;

  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `
    <label>Mirror hands on local axes</label>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <label class="fieldRow" style="cursor:pointer;flex:0 0 auto">
        <input type="checkbox" id="handMirrorAxisX" style="width:auto;margin-right:5px"> X
      </label>
      <label class="fieldRow" style="cursor:pointer;flex:0 0 auto">
        <input type="checkbox" id="handMirrorAxisY" style="width:auto;margin-right:5px"> Y
      </label>
      <label class="fieldRow" style="cursor:pointer;flex:0 0 auto">
        <input type="checkbox" id="handMirrorAxisZ" style="width:auto;margin-right:5px"> Z
      </label>
    </div>
    <div class="help">Each axis reflects both generated hands across that hand model's own local axis. Any combination is valid. This is separate from the source-GLB handedness setting.</div>
    <div class="help" id="handMirrorPairStatus" style="margin-top:5px"></div>
  `;
  scaleGroup.appendChild(field);

  const checkboxes = {
    x: document.getElementById('handMirrorAxisX'),
    y: document.getElementById('handMirrorAxisY'),
    z: document.getElementById('handMirrorAxisZ'),
  };
  const status = document.getElementById('handMirrorPairStatus');
  const AXES = ['x', 'y', 'z'];

  function currentModel() {
    return profiles.data.models?.[profileSelect.value] || null;
  }

  function axesForModel(model) {
    return global.ProceduralHandPairMirror?.axesForModel?.(model) || {
      x: model?.mirrorAxes?.x === true || (!model?.mirrorAxes && model?.horizontalMirrorX === true),
      y: model?.mirrorAxes?.y === true,
      z: model?.mirrorAxes?.z === true,
    };
  }

  function axisLabel(axes) {
    const enabled = AXES.filter(axis => axes[axis]);
    return enabled.length ? enabled.map(axis => axis.toUpperCase()).join('+') : 'none';
  }

  function refreshStatus() {
    if (!status) return;
    const expected = axesForModel(currentModel());
    const rows = global.ProceduralHandPairMirror?.getDebug?.()?.rigs || [];
    const species = String(document.getElementById('avatarSpecies')?.value || '');
    const row = rows.find(entry => entry?.speciesId === species) || rows[0] || null;
    const sideMatches = side => row && AXES.every(axis => row?.[`${side}Applied`]?.[axis] === expected[axis]);
    const left = row ? (sideMatches('left') ? '✓' : '…') : '…';
    const right = row ? (sideMatches('right') ? '✓' : '…') : '…';
    status.textContent = `Pair mirror ${axisLabel(expected)} · left ${left} · right ${right}`;
    status.style.color = row && (!sideMatches('left') || !sideMatches('right')) ? '#fbbf24' : '';
  }

  function sync() {
    const axes = axesForModel(currentModel());
    for (const axis of AXES) checkboxes[axis].checked = axes[axis];
    refreshStatus();
  }

  function commitAxes() {
    const key = profileSelect.value;
    const nextAxes = Object.fromEntries(AXES.map(axis => [axis, checkboxes[axis].checked]));
    profiles.mutate(data => {
      const model = data.models?.[key];
      if (!model) return;
      model.mirrorAxes = { ...nextAxes };
      // Keep the legacy X alias synchronized for old export/debug readers. New
      // mirror runtime code never consults it once mirrorAxes exists.
      model.horizontalMirrorX = nextAxes.x;
    });
    global.ProceduralHandPairMirror?.refreshAll?.();
    requestAnimationFrame(refreshStatus);
  }

  for (const axis of AXES) checkboxes[axis].addEventListener('change', commitAxes);

  profileSelect.addEventListener('change', sync);
  profiles.subscribe?.(sync);
  setInterval(refreshStatus, 350); // Keeps left/right application visible after asynchronous GLB replacement.
  sync();
})(window);
