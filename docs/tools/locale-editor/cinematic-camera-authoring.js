(() => {
  'use strict';

  const bridge = window._localeEditorBridge; // Locale Editor's private-state adapter used to edit cameras without coupling this extension to the monolith internals.
  if (!bridge?.getActiveLocale || !bridge?.addCinematicCamera || !bridge?.updateCinematicCamera) return;

  let selectedCameraId = null; // Stable camera id whose full transform/presentation fields are shown in this extension panel.
  const section = document.createElement('div'); // Dedicated sidebar section inserted beside the locale inspector and placement controls.
  section.className = 'section';
  section.style.cssText = '--sec:#f472b6;--secBg:rgba(244,114,182,.08)';
  section.innerHTML = `
    <div class="sect-head"><b>Cinematic Cameras</b><span class="sect-tag" id="cinCameraCount">0</span></div>
    <p class="muted">Author exact world-space dialogue/cutscene shots here. Dialogue Editor reads these camera ids and can attach them to individual nodes.</p>
    <div id="cinCameraList" class="itemlist" style="margin-top:7px"></div>
    <div class="row" style="margin-top:6px">
      <button class="ok" id="cinCameraAdd" type="button">+ Camera</button>
      <button class="sec" id="cinCameraDuplicate" type="button">Duplicate</button>
    </div>
    <div id="cinCameraInspector" style="margin-top:8px"></div>
    <div id="cinCameraStatus" class="muted" style="margin-top:6px"></div>`;
  const insertionPoint = document.getElementById('cavernSettingsSection'); // Keeps camera authoring close to the ordinary Inspector instead of hiding it after validation/JSON.
  if (insertionPoint) insertionPoint.before(section);
  else document.getElementById('sidebar-scroll')?.appendChild(section);

  const $ = id => document.getElementById(id);
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const escapeAttr = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const slug = value => String(value || 'camera').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'camera';
  const cameras = () => bridge.getCinematicCameras?.() || [];
  const locale = () => bridge.getActiveLocale?.() || null;

  function uniqueId(seed = 'camera') {
    const used = new Set(cameras().map(camera => camera.id));
    const base = slug(seed); // Base id reused while incrementing duplicate-safe suffixes.
    if (!used.has(base)) return base;
    let n = 2; // Suffix counter used only to make a newly-authored camera id unique in the active locale.
    while (used.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }

  function defaultCamera(id = uniqueId('cinematic_camera')) {
    return {
      id,
      label: 'Cinematic camera',
      position: { x: 0, y: 0.35, z: 0 },
      target: { x: 0, y: 0.8, z: 1 },
      fovDeg: 42,
      blendSeconds: 0.45,
      dialogueNpcId: '',
      useForDialogue: false,
      fadePets: false,
      playerStage: { x: 0, z: 0 },
      targetNpcId: '',
      targetAnchorId: '',
      stagePlayer: false,
    };
  }

  function targetMode(camera) {
    if (!camera?.targetNpcId) return 'world';
    return camera.targetNpcPoint === 'root' ? 'root' : 'face';
  }

  function setStatus(message) {
    const output = $('cinCameraStatus'); // Local authoring feedback stays visible on mobile without requiring console access.
    if (output) output.textContent = message || '';
  }

  function renderList() {
    const list = $('cinCameraList');
    const records = cameras();
    if (!list) return;
    $('cinCameraCount').textContent = String(records.length);
    if (selectedCameraId && !records.some(camera => camera.id === selectedCameraId)) selectedCameraId = records[0]?.id || null;
    if (!selectedCameraId && records.length) selectedCameraId = records[0].id;
    list.innerHTML = '';
    for (const camera of records) {
      const item = document.createElement('button'); // Camera selector mirrors the Locale Editor's ordinary workspace-list interaction.
      item.type = 'button';
      item.className = 'palBtn sec' + (camera.id === selectedCameraId ? ' act' : '');
      item.innerHTML = `🎥 <span style="min-width:0"><b>${escapeAttr(camera.label || camera.id)}</b><br><span class="muted">${escapeAttr(camera.id)}</span></span>`;
      item.addEventListener('click', () => { selectedCameraId = camera.id; render(); });
      list.appendChild(item);
    }
    if (!records.length) list.innerHTML = '<p class="muted">No cinematic cameras authored for this locale.</p>';
  }

  function renderInspector() {
    const box = $('cinCameraInspector');
    const camera = cameras().find(record => record.id === selectedCameraId);
    if (!box) return;
    if (!camera) {
      box.innerHTML = '<p class="muted">Add a camera to author its transform, live target anchor, FOV, blend, pet fade, and optional player staging.</p>';
      return;
    }
    const point = camera.position || {};
    const target = camera.target || {};
    const stage = camera.playerStage || {};
    const mode = targetMode(camera);
    const npcAnchors = bridge.getNpcAnchors?.() || []; // Active-locale NPC ids feed the target/dialogue datalists while still allowing manual ids.
    box.innerHTML = `
      <datalist id="cinNpcIds">${npcAnchors.map(anchor => `<option value="${escapeAttr(anchor.npcId)}">${escapeAttr(anchor.name || anchor.npcId)}</option>`).join('')}</datalist>
      <div class="g2"><div><label>Camera id</label><input id="cinId" value="${escapeAttr(camera.id)}"></div><div><label>Label</label><input id="cinLabel" value="${escapeAttr(camera.label || '')}"></div></div>
      <div style="margin-top:7px"><strong>Camera position</strong></div>
      <div class="g3" style="margin-top:4px"><div><label>X</label><input id="cinPX" type="number" step="0.01" value="${finite(point.x)}"></div><div><label>Y</label><input id="cinPY" type="number" step="0.01" value="${finite(point.y)}"></div><div><label>Z</label><input id="cinPZ" type="number" step="0.01" value="${finite(point.z)}"></div></div>
      <div class="g2" style="margin-top:7px"><div><label>Target mode</label><select id="cinTargetMode"><option value="world"${mode==='world'?' selected':''}>Absolute world point</option><option value="face"${mode==='face'?' selected':''}>NPC face + offset</option><option value="root"${mode==='root'?' selected':''}>NPC root + offset</option></select></div><div><label>Target NPC id</label><input id="cinTargetNpc" list="cinNpcIds" value="${escapeAttr(camera.targetNpcId || '')}" placeholder="banubu"></div></div>
      <div class="g3" style="margin-top:4px"><div><label id="cinTargetXLabel">Target X</label><input id="cinTX" type="number" step="0.01" value="${finite(target.x)}"></div><div><label id="cinTargetYLabel">Target Y</label><input id="cinTY" type="number" step="0.01" value="${finite(target.y)}"></div><div><label id="cinTargetZLabel">Target Z</label><input id="cinTZ" type="number" step="0.01" value="${finite(target.z)}"></div></div>
      <div class="g2" style="margin-top:7px"><div><label>Dialogue NPC id</label><input id="cinDialogueNpc" list="cinNpcIds" value="${escapeAttr(camera.dialogueNpcId || '')}" placeholder="optional"></div><div><label>Target anchor id</label><input id="cinTargetAnchor" value="${escapeAttr(camera.targetAnchorId || '')}" placeholder="station_…"></div></div>
      <label class="chk" style="margin-top:7px"><input id="cinUseForDialogue" type="checkbox"${camera.useForDialogue ? ' checked' : ''}> Eligible as the automatic dialogue shot</label>
      <div class="g2" style="margin-top:7px"><div><label>FOV degrees</label><input id="cinFov" type="number" min="10" max="120" step="1" value="${finite(camera.fovDeg,42)}"></div><div><label>Blend seconds</label><input id="cinBlend" type="number" min="0" step="0.05" value="${finite(camera.blendSeconds,0.45)}"></div></div>
      <label class="chk" style="margin-top:7px"><input id="cinFadePets" type="checkbox"${camera.fadePets ? ' checked' : ''}> Fade pets during shot</label>
      <label class="chk"><input id="cinStagePlayer" type="checkbox"${camera.stagePlayer ? ' checked' : ''}> Stage player at authored X/Z</label>
      <div class="g2" style="margin-top:4px"><div><label>Player stage X</label><input id="cinStageX" type="number" step="0.01" value="${finite(stage.x)}"></div><div><label>Player stage Z</label><input id="cinStageZ" type="number" step="0.01" value="${finite(stage.z)}"></div></div>
      <div class="row" style="margin-top:8px"><button class="ok" id="cinSave" type="button">Save camera</button><button class="bad" id="cinDelete" type="button">Delete</button></div>
      <p class="muted" style="margin-top:6px">Position/target values are exact runtime world coordinates. In-game Map Edit can still visually fine-tune the same record.</p>`;

    const syncTargetLabels = () => {
      const relative = $('cinTargetMode').value !== 'world'; // Relative modes interpret target XYZ as offsets from the live NPC anchor.
      $('cinTargetNpc').disabled = !relative;
      for (const axis of ['X','Y','Z']) $('cinTarget' + axis + 'Label').textContent = relative ? `Offset ${axis}` : `Target ${axis}`;
    };
    $('cinTargetMode').addEventListener('change', syncTargetLabels);
    syncTargetLabels();

    $('cinSave').addEventListener('click', () => {
      const nextId = slug($('cinId').value);
      const nextMode = $('cinTargetMode').value;
      const next = {
        ...camera,
        id: nextId,
        label: $('cinLabel').value.trim() || nextId,
        position: { x: finite($('cinPX').value), y: finite($('cinPY').value), z: finite($('cinPZ').value) },
        target: { x: finite($('cinTX').value), y: finite($('cinTY').value), z: finite($('cinTZ').value) },
        fovDeg: Math.max(10, Math.min(120, finite($('cinFov').value, 42))),
        blendSeconds: Math.max(0, finite($('cinBlend').value, 0.45)),
        dialogueNpcId: $('cinDialogueNpc').value.trim(),
        useForDialogue: $('cinUseForDialogue').checked,
        fadePets: $('cinFadePets').checked,
        playerStage: { x: finite($('cinStageX').value), z: finite($('cinStageZ').value) },
        targetAnchorId: $('cinTargetAnchor').value.trim(),
        stagePlayer: $('cinStagePlayer').checked,
      }; // Complete replacement preserves unknown future fields through the spread while normalizing every currently-authored camera property.
      if (nextMode === 'world') {
        next.targetNpcId = '';
        delete next.targetNpcPoint;
      } else {
        next.targetNpcId = $('cinTargetNpc').value.trim();
        next.targetNpcPoint = nextMode;
        if (!next.targetNpcId) { setStatus('NPC face/root targeting needs a target NPC id.'); return; }
      }
      if (!next.id) { setStatus('Camera id cannot be blank.'); return; }
      const previousId = selectedCameraId; // Restored if validation rejects a rename instead of leaving the inspector pointed at a nonexistent camera.
      selectedCameraId = next.id;
      if (!bridge.updateCinematicCamera(previousId, next)) {
        selectedCameraId = previousId;
        render();
        setStatus('Could not save: that camera id may already exist.');
        return;
      }
      render();
      setStatus(`Saved ${next.id}.`);
    });

    $('cinDelete').addEventListener('click', () => {
      if (!confirm(`Delete cinematic camera “${camera.id}”? Dialogue nodes referencing this id will be left intact for explicit repair.`)) return;
      selectedCameraId = null;
      bridge.deleteCinematicCamera(camera.id);
      render();
      setStatus(`Deleted ${camera.id}.`);
    });
  }

  function render() {
    const active = locale();
    section.style.display = active ? '' : 'none';
    if (!active) return;
    renderList();
    renderInspector();
  }

  $('cinCameraAdd').addEventListener('click', () => {
    const record = defaultCamera(); // Fresh default is intentionally neutral and editable rather than Banubu-specific.
    if (!bridge.addCinematicCamera(record)) { setStatus('Could not add camera.'); return; }
    selectedCameraId = record.id;
    render();
    setStatus(`Added ${record.id}.`);
  });

  $('cinCameraDuplicate').addEventListener('click', () => {
    const source = cameras().find(camera => camera.id === selectedCameraId);
    if (!source) return;
    const copy = JSON.parse(JSON.stringify(source)); // Duplicate preserves exact framing before assigning a new stable id/label.
    copy.id = uniqueId(source.id + '_copy');
    copy.label = (source.label || source.id) + ' copy';
    if (!bridge.addCinematicCamera(copy)) { setStatus('Could not duplicate camera.'); return; }
    selectedCameraId = copy.id;
    render();
    setStatus(`Duplicated as ${copy.id}.`);
  });

  bridge.subscribe(render);
  render();
})();
