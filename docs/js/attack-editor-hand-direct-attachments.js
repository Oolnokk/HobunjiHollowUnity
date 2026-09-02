// Attack Editor UI for direct primary/right-hand and optional secondary/left-hand grips.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const toolGrips = global.HobunjiHandToolGrips;
  const profileSelect = document.getElementById('handProfileSelect');
  const toolSelect = document.getElementById('toolSpriteSelect');
  if (!profiles || !toolGrips || !profileSelect || !toolSelect) return;
  if (document.getElementById('handPrimaryGripGroup')) return;

  try { toolGrips.loadLocal(); } catch (_) {}

  const card = profileSelect.closest('.card');
  if (!card) return;
  const $ = id => document.getElementById(id);

  const tag = card.querySelector('.sectionTag');
  if (tag) tag.textContent = 'authored held-item sockets + species scale';
  const topHelp = card.querySelector('.sectionTitle')?.nextElementSibling;
  if (topHelp?.classList.contains('help')) {
    topHelp.innerHTML = 'Hands are <b>direct attachments</b>: an authored primary held-item-local frame places the right hand; an optional secondary frame places the left. There are no arm bones, elbows, reach limits, or IK.';
  }

  const inverseHelp = $('handFromToolRotationGroup')?.querySelector('.help');
  if (inverseHelp) inverseHelp.textContent = 'Pitch / yaw / roll are the complete hand orientation relative to the selected grip mode and authored grip frame. No hidden arm/wrist correction is added.';

  const section = document.createElement('div'); // Inserted into the existing hand card for grip authoring.
  section.className = 'poseGroup';
  section.id = 'handPrimaryGripGroup';
  section.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#a78bfa"></span>Primary right-hand grip</div>
    <div class="help" style="margin-bottom:6px">This held-item-local frame is the right hand's socket. Use <b>Pick on sprite</b>, then fine-tune position and rotation below. Identity (all zeroes) preserves the legacy tool-origin attachment.</div>
    <div class="row" style="margin-bottom:7px">
      <button id="handPrimaryGripPick" class="secondary" style="font-size:11px">◎ Pick on sprite</button>
      <button id="handPrimaryGripZero" class="warn" style="font-size:11px">Zero primary</button>
    </div>
    <div id="handPrimaryGripPositionFields"></div>
    <div id="handPrimaryGripRotationFields"></div>
    <div class="hr"></div>
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Optional left-hand grip</div>
    <div class="help" style="margin-bottom:6px">When enabled, this independent held-item-local frame places the left hand. Otherwise that hand keeps its avatar idle motion.</div>
    <div class="field"><label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handSecondaryGripEnabled" style="width:auto;margin-right:6px">Attach left hand to secondary grip</label></div>
    <div id="handSecondaryGripPositionFields"></div>
    <div id="handSecondaryGripRotationFields"></div>
    <div class="help" id="handGripStatus" style="padding:7px;border:1px solid rgba(167,139,250,.24);border-radius:8px;margin:6px 0"></div>
    <div class="row">
      <button id="handGripSave" class="good" style="font-size:11px">💾 Save grip draft</button>
      <button id="handGripCopy" class="secondary" style="font-size:11px">Copy grip JSON</button>
      <button id="handGripReset" class="warn" style="font-size:11px">Reset grip defaults</button>
    </div>
  `;
  const effectiveStatus = $('handEffectiveStatus');
  card.insertBefore(section, effectiveStatus || null);

  const positionFields = [ // Used to build and synchronize both grip position panels.
    { key: 'x', label: 'X', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'y', label: 'Y', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'z', label: 'Z', min: -1.5, max: 1.5, step: 0.01 },
  ];
  const rotationFields = [ // Used to build and synchronize both grip rotation panels.
    { key: 'pitch', label: 'Pitch°', min: -180, max: 180, step: 1 },
    { key: 'yaw', label: 'Yaw°', min: -180, max: 180, step: 1 },
    { key: 'roll', label: 'Roll°', min: -180, max: 180, step: 1 },
  ];

  function fieldMarkup(prefix, name, field) {
    return `<div class="field"><label>${name} ${field.label}</label><div class="fieldRow">
      <input id="${prefix}_${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}">
      <input id="${prefix}_${field.key}_n" type="number" min="${field.min}" max="${field.max}" step="${field.step}" style="width:78px;flex:0 0 78px">
    </div></div>`;
  }
  $('handPrimaryGripPositionFields').innerHTML = positionFields.map(field => fieldMarkup('handPrimaryPos', 'Primary', field)).join('');
  $('handPrimaryGripRotationFields').innerHTML = rotationFields.map(field => fieldMarkup('handPrimaryRot', 'Primary', field)).join('');
  $('handSecondaryGripPositionFields').innerHTML = positionFields.map(field => fieldMarkup('handSecondaryPos', 'Secondary', field)).join('');
  $('handSecondaryGripRotationFields').innerHTML = rotationFields.map(field => fieldMarkup('handSecondaryRot', 'Secondary', field)).join('');

  function currentToolKey() { return toolGrips.toolKeyFor(toolSelect.value); }
  function currentToolScale() { return Math.max(0.1, Number(toolGrips.toolScaleForTool?.(currentToolKey())) || 1); }
  function currentEntry() { return toolGrips.ensureTool(currentToolKey()); }
  function currentPrimary() { return currentEntry()?.primaryGrip || null; }
  function currentSecondary() { return currentEntry()?.secondaryGrip || null; }

  function setPair(range, number, value) {
    const v = Number(value) || 0;
    range.value = Math.max(Number(range.min), Math.min(Number(range.max), v));
    number.value = v;
  }

  let editorContext = null; // Shared editor scene bridge used by marker rendering and viewport picking.
  let primaryMarker = null; // Visible right-hand socket marker parented to the current tool holder.
  let pickActive = false; // True while the next viewport pointer-down should choose a grip point.
  let pointerTarget = null; // Canvas currently carrying the grip picker listener.

  function updatePrimaryMarker() {
    if (!primaryMarker || !editorContext) return;
    const primary = currentPrimary();
    const p = primary?.position || {};
    const r = primary?.rotationDeg || {};
    const visualScale = pickActive ? currentToolScale() : 1; // Pick mode shows the uncorrected scaled sprite, so its stored unscaled grip point is displayed at the matching scaled position.
    primaryMarker.position.set((Number(p.x) || 0) * visualScale, (Number(p.y) || 0) * visualScale, (Number(p.z) || 0) * visualScale);
    const qYaw = new editorContext.THREE.Quaternion().setFromAxisAngle(new editorContext.THREE.Vector3(0, 1, 0), editorContext.THREE.MathUtils.degToRad(Number(r.yaw) || 0));
    const qPitch = new editorContext.THREE.Quaternion().setFromAxisAngle(new editorContext.THREE.Vector3(1, 0, 0), editorContext.THREE.MathUtils.degToRad(Number(r.pitch) || 0));
    const qRoll = new editorContext.THREE.Quaternion().setFromAxisAngle(new editorContext.THREE.Vector3(0, 0, 1), editorContext.THREE.MathUtils.degToRad(Number(r.roll) || 0));
    primaryMarker.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll);
  }

  function stopPicking(message) {
    pickActive = false;
    $('handPrimaryGripPick').classList.remove('active');
    $('handPrimaryGripPick').textContent = '◎ Pick on sprite';
    if (message) $('handGripStatus').textContent = message;
    updatePrimaryMarker();
  }

  function mutateGrip(gripKey, mutator) {
    const key = currentToolKey();
    if (!key) return;
    toolGrips.ensureTool(key);
    toolGrips.mutate(data => mutator(data.tools[key][gripKey]));
  }

  function handleGripPick(event) {
    if (!pickActive || !editorContext?.toolPlaneMesh) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const rect = editorContext.renderer.domElement.getBoundingClientRect();
    const pointer = new editorContext.THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new editorContext.THREE.Raycaster();
    raycaster.setFromCamera(pointer, editorContext.camera);
    const hit = raycaster.intersectObject(editorContext.toolPlaneMesh, true)[0];
    if (!hit) {
      $('handGripStatus').textContent = 'No sprite plane hit. Click directly on the weapon handle, or cancel Pick.';
      return;
    }
    const local = editorContext.toolHolder.worldToLocal(hit.point.clone());
    const baseScale = currentToolScale(); // worldToLocal removes animation/toolHolder scale, but intrinsic held-item scale lives on the visual child and must be removed here to keep authored grip coordinates scale-independent.
    local.multiplyScalar(1 / baseScale);
    mutateGrip('primaryGrip', primary => {
      primary.position.x = Number(local.x.toFixed(4));
      primary.position.y = Number(local.y.toFixed(4));
      primary.position.z = Number(local.z.toFixed(4));
    });
    stopPicking(`${currentToolKey()}: primary/right-hand point picked at base scale ×${baseScale.toFixed(2)}; stored in unscaled item coordinates.`);
  }

  function installEditorContext(context) {
    if (!context?.THREE || !context?.toolHolder || !context?.renderer || editorContext === context) return;
    editorContext = context;
    const marker = new context.THREE.Group(); // Parent carries the authored primary position and orientation.
    marker.name = 'primary_right_hand_grip_marker';
    const sphere = new context.THREE.Mesh(
      new context.THREE.SphereGeometry(0.025, 12, 8),
      new context.THREE.MeshBasicMaterial({ color: 0xa78bfa, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    sphere.renderOrder = 10000;
    marker.add(sphere);
    const axes = new context.THREE.AxesHelper(0.14);
    axes.material.depthTest = false;
    axes.renderOrder = 10000;
    marker.add(axes);
    context.toolHolder.add(marker);
    primaryMarker = marker;
    pointerTarget?.removeEventListener('pointerdown', handleGripPick, true);
    pointerTarget = context.renderer.domElement;
    pointerTarget.addEventListener('pointerdown', handleGripPick, true);
    updatePrimaryMarker();
  }

  function refreshDirectStatus() {
    const species = String($('avatarSpecies')?.value || '').trim();
    const gender = String($('avatarGender')?.value || 'male').trim();
    const mappedKey = profiles.modelKeyForSpecies?.(species);
    const modelScale = Number(profiles.data.models?.[mappedKey]?.scale) || 1;
    const speciesScale = Number(profiles.speciesScaleFor?.(species, gender)) || 1;
    const debug = global.ProceduralHandFrameDriver?.getDebug?.().find(entry => entry?.speciesId === species && entry?.gender === gender)
      || global.ProceduralHandFrameDriver?.getDebug?.().find(entry => entry?.speciesId === species)
      || null;
    if (effectiveStatus) {
      const second = debug?.secondaryActive ? `left→${debug.toolKey || currentToolKey()} secondary` : 'left→idle';
      effectiveStatus.textContent = `${mappedKey || 'no model'}: model ${modelScale.toFixed(3)} × species ${speciesScale.toFixed(3)} = effective ${(modelScale * speciesScale).toFixed(3)} · item ×${currentToolScale().toFixed(2)} · direct attachment · right→authored primary · ${second} · NO ARM IK`;
      effectiveStatus.style.color = debug?.hand?.loadError ? '#fb7185' : '';
    }
  }

  function syncFields() {
    const key = currentToolKey();
    const primary = currentPrimary();
    const secondary = currentSecondary();
    if (!primary || !secondary) return;
    for (const field of positionFields) setPair($(`handPrimaryPos_${field.key}`), $(`handPrimaryPos_${field.key}_n`), primary.position?.[field.key]);
    for (const field of rotationFields) setPair($(`handPrimaryRot_${field.key}`), $(`handPrimaryRot_${field.key}_n`), primary.rotationDeg?.[field.key]);
    $('handSecondaryGripEnabled').checked = secondary.enabled === true;
    for (const field of positionFields) setPair($(`handSecondaryPos_${field.key}`), $(`handSecondaryPos_${field.key}_n`), secondary.position?.[field.key]);
    for (const field of rotationFields) setPair($(`handSecondaryRot_${field.key}`), $(`handSecondaryRot_${field.key}_n`), secondary.rotationDeg?.[field.key]);
    if (!pickActive) {
      $('handGripStatus').textContent = secondary.enabled
        ? `${key || 'held item'}: TWO-HAND · right and left use independent authored frames.`
        : `${key || 'held item'}: ONE-HAND · right uses its authored primary frame; left stays idle.`;
    }
    updatePrimaryMarker();
    refreshDirectStatus();
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function bindPair(range, number, onValue) {
    const apply = source => {
      const value = Number(source.value);
      if (!Number.isFinite(value)) return;
      setPair(range, number, value);
      onValue(value);
    };
    range.addEventListener('input', () => apply(range));
    number.addEventListener('input', () => apply(number));
  }

  for (const [gripKey, posPrefix, rotPrefix] of [
    ['primaryGrip', 'handPrimaryPos', 'handPrimaryRot'],
    ['secondaryGrip', 'handSecondaryPos', 'handSecondaryRot'],
  ]) {
    for (const field of positionFields) {
      bindPair($(`${posPrefix}_${field.key}`), $(`${posPrefix}_${field.key}_n`), value => {
        mutateGrip(gripKey, grip => { grip.position[field.key] = value; });
      });
    }
    for (const field of rotationFields) {
      bindPair($(`${rotPrefix}_${field.key}`), $(`${rotPrefix}_${field.key}_n`), value => {
        mutateGrip(gripKey, grip => { grip.rotationDeg[field.key] = value; });
      });
    }
  }

  $('handSecondaryGripEnabled').addEventListener('change', event => {
    mutateGrip('secondaryGrip', secondary => { secondary.enabled = event.target.checked; });
  });
  $('handPrimaryGripPick').addEventListener('click', () => {
    if (pickActive) {
      stopPicking(`${currentToolKey()}: grip picking cancelled.`);
      return;
    }
    if (!editorContext?.toolPlaneMesh) {
      $('handGripStatus').textContent = 'The weapon preview is not ready yet; try Pick again in a moment.';
      return;
    }
    editorContext.focusNeutral?.();
    pickActive = true;
    $('handPrimaryGripPick').classList.add('active');
    $('handPrimaryGripPick').textContent = 'Cancel pick';
    $('handGripStatus').textContent = `Click the weapon handle in the viewport to place the primary/right-hand grip. Base scale ×${currentToolScale().toFixed(2)} is ignored in the stored coordinates.`;
    updatePrimaryMarker();
  });
  $('handPrimaryGripZero').addEventListener('click', () => {
    mutateGrip('primaryGrip', primary => {
      primary.position = { x: 0, y: 0, z: 0 };
      primary.rotationDeg = { pitch: 0, yaw: 0, roll: 0 };
    });
  });

  toolSelect.addEventListener('change', () => { stopPicking(); syncFields(); });
  $('avatarSpecies')?.addEventListener('change', refreshDirectStatus);
  $('avatarGender')?.addEventListener('change', refreshDirectStatus);
  profileSelect.addEventListener('change', refreshDirectStatus);
  profiles.subscribe?.(refreshDirectStatus);
  toolGrips.subscribe?.(syncFields);

  $('handGripSave').addEventListener('click', () => {
    try {
      toolGrips.saveLocal();
      $('handGripStatus').textContent = `${currentToolKey()}: grip + base-scale draft saved locally.`;
    } catch (error) {
      $('handGripStatus').textContent = `Grip save failed: ${error?.message || error}`;
    }
  });
  $('handGripCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(toolGrips.clone(), null, 2));
      $('handGripStatus').textContent = 'Copied held-item grip + base-scale JSON.';
    } catch (error) {
      $('handGripStatus').textContent = `Copy failed: ${error?.message || error}`;
    }
  });
  $('handGripReset').addEventListener('click', () => {
    toolGrips.clearLocal();
    syncFields();
  });

  global.addEventListener('hobunji-attack-editor-tool-context-ready', () => installEditorContext(global.HobunjiAttackEditorToolContext));
  installEditorContext(global.HobunjiAttackEditorToolContext);

  global.HobunjiAttackEditorDirectHandAttachments = Object.freeze({
    syncFields,
    refreshDirectStatus,
    get toolKey() { return currentToolKey(); },
    get toolScale() { return currentToolScale(); },
    get primaryGrip() { return toolGrips.primaryGripForTool(currentToolKey()); },
  });

  syncFields();
})(window);