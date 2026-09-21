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
    topHelp.innerHTML = '<b>Weapon grip target → grip mode → hand-model calibration.</b> The weapon animation stays authoritative. Grip controls choose where a hand lands on that weapon; the Hand Model Calibration section only corrects how a particular GLB palm/origin sits on an otherwise-correct target.';
  }

  const inverseHelp = $('handFromToolRotationGroup')?.querySelector('.help');
  if (inverseHelp) inverseHelp.innerHTML = '<b>Orthogonal quaternion X/Y/Z correction.</b> The three controls are solved simultaneously in the HAND MODEL basis after the weapon target + Grip Mode. They are not sequential Euler rotations, so a ±90° value on one control cannot make the other two rotate on the same axis.';

  const section = document.createElement('div'); // Inserted into the existing hand card for grip authoring.
  section.className = 'poseGroup';
  section.id = 'handPrimaryGripGroup';
  section.innerHTML = `
    <div class="field">
      <label>Grip set</label>
      <select id="handGripContextSelect">
        <option value="melee">Melee grip</option>
        <option value="ranged">Ranged grip</option>
      </select>
      <div class="help" style="margin-top:5px">Dual-role weapons can keep completely separate hand targets for melee and ranged use. Existing weapons start with Ranged copied from Melee, so nothing changes until you edit it.</div>
    </div>
    <div class="poseGroupHead"><span class="dot" style="background:#60a5fa"></span>Right-hand target on weapon</div>
    <div class="help" style="margin-bottom:6px"><b>The blue marker is where the right hand is being told to grip.</b> The hand's own guide/origin should land on that marker after Grip Mode + Hand Model Calibration are applied. Picking a point moves the HAND TARGET; it does not move the weapon.</div>
    <div class="row" style="margin-bottom:7px">
      <button id="handPrimaryGripPick" class="secondary" style="font-size:11px">◎ Pick right-hand target on weapon</button>
      <button id="handPrimaryGripZero" class="warn" style="font-size:11px">Target = weapon origin</button>
    </div>
    <div id="handPrimaryGripPositionFields"></div>
    <div id="handPrimaryGripRotationFields"></div>
    <div class="hr"></div>
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Legacy left-hand target (replaced by span below)</div>
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

  const positionFields = [ // Item-local coordinates of the hand target, not tool animation motion.
    { key: 'x', label: 'X position (side)', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'y', label: 'Y position (height)', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'z', label: 'Z position (forward)', min: -1.5, max: 1.5, step: 0.01 },
  ];
  const rotationFields = [ // Legacy pitch/yaw/roll storage keys are displayed as their concrete axes.
    { key: 'pitch', label: 'X rotation°', min: -180, max: 180, step: 1 },
    { key: 'yaw', label: 'Y rotation°', min: -180, max: 180, step: 1 },
    { key: 'roll', label: 'Z rotation°', min: -180, max: 180, step: 1 },
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
  function currentGripContext() { return toolGrips.normalizeGripContext?.($('handGripContextSelect')?.value || 'melee') || ($('handGripContextSelect')?.value === 'ranged' ? 'ranged' : 'melee'); }
  function currentToolScale() { return Math.max(0.1, Number(toolGrips.toolScaleForTool?.(currentToolKey())) || 1); }
  function currentEntry() { return toolGrips.ensureTool(currentToolKey()); }
  function currentPrimaryField() { return currentGripContext() === 'ranged' ? 'rangedPrimaryGrip' : 'primaryGrip'; }
  function currentPrimary() { return currentEntry()?.[currentPrimaryField()] || null; }
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
    const visualScale = currentToolScale(); // Marker lives beside toolHolder, so explicitly scale the unscaled authored target to the visible weapon size.
    primaryMarker.position.set((Number(p.x) || 0) * visualScale, (Number(p.y) || 0) * visualScale, (Number(p.z) || 0) * visualScale);
    const qYaw = new editorContext.THREE.Quaternion().setFromAxisAngle(new editorContext.THREE.Vector3(0, 1, 0), editorContext.THREE.MathUtils.degToRad(Number(r.yaw) || 0));
    const qPitch = new editorContext.THREE.Quaternion().setFromAxisAngle(new editorContext.THREE.Vector3(1, 0, 0), editorContext.THREE.MathUtils.degToRad(Number(r.pitch) || 0));
    const qRoll = new editorContext.THREE.Quaternion().setFromAxisAngle(new editorContext.THREE.Vector3(0, 0, 1), editorContext.THREE.MathUtils.degToRad(Number(r.roll) || 0));
    primaryMarker.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll);
  }

  function stopPicking(message) {
    pickActive = false;
    $('handPrimaryGripPick').classList.remove('active');
    $('handPrimaryGripPick').textContent = '◎ Pick right-hand target on weapon';
    if (message) $('handGripStatus').textContent = message;
    updatePrimaryMarker();
  }

  function mutateGrip(gripKey, mutator) {
    const key = currentToolKey();
    if (!key) return;
    toolGrips.ensureTool(key);
    const authoredField = gripKey === 'primaryGrip' ? currentPrimaryField() : gripKey;
    toolGrips.mutate(data => mutator(data.tools[key][authoredField]));
    global.ProceduralHandFrameDriver?.syncNow?.();
    requestAnimationFrame(() => global.ProceduralHandFrameDriver?.syncNow?.()); // Ensures the same edit is visible after this frame's tool/pose matrices settle.
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
    stopPicking(`${currentToolKey()}: blue right-hand target picked. The weapon stayed in its authored pose; the hand now follows this target (stored before base scale ×${baseScale.toFixed(2)}).`);
  }

  function installEditorContext(context) {
    if (!context?.THREE || !context?.toolHolder || !context?.renderer || editorContext === context) return;
    editorContext = context;
    const marker = new context.THREE.Group(); // Parent carries the authored primary position and orientation.
    marker.name = 'primary_right_hand_grip_marker';
    const sphere = new context.THREE.Mesh(
      new context.THREE.SphereGeometry(0.025, 12, 8),
      new context.THREE.MeshBasicMaterial({ color: 0x60a5fa, depthTest: false, transparent: true, opacity: 0.98 }),
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
      effectiveStatus.textContent = `${mappedKey || 'no model'}: model ${modelScale.toFixed(3)} × species ${speciesScale.toFixed(3)} = effective ${(modelScale * speciesScale).toFixed(3)} · item ×${currentToolScale().toFixed(2)} · ${currentGripContext().toUpperCase()} grip · direct attachment · right→authored primary · ${second} · NO ARM IK`;
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
        ? `${key || 'held item'} · ${currentGripContext().toUpperCase()}: TWO-HAND · blue target drives RIGHT HAND; animation-gated span drives LEFT HAND. Weapon remains animation-owned.`
        : `${key || 'held item'} · ${currentGripContext().toUpperCase()}: ONE-HAND · blue target drives RIGHT HAND; left stays idle. Weapon remains animation-owned.`;
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
    $('handGripStatus').textContent = `Click the weapon where the RIGHT HAND should land. The blue marker will move there; the weapon will not move. Coordinates are stored before base scale ×${currentToolScale().toFixed(2)}.`;
    updatePrimaryMarker();
  });
  $('handPrimaryGripZero').addEventListener('click', () => {
    mutateGrip('primaryGrip', primary => {
      primary.position = { x: 0, y: 0, z: 0 };
      primary.rotationDeg = { pitch: 0, yaw: 0, roll: 0 };
    });
  });

  toolSelect.addEventListener('change', () => { stopPicking(); syncFields(); });
  $('handGripContextSelect')?.addEventListener('change', () => {
    stopPicking();
    syncFields();
    global.HobunjiAttackEditorHandGripMode?.syncForTool?.();
    global.ProceduralHandFrameDriver?.syncNow?.();
  });
  $('avatarSpecies')?.addEventListener('change', refreshDirectStatus);
  $('avatarGender')?.addEventListener('change', refreshDirectStatus);
  profileSelect.addEventListener('change', refreshDirectStatus);
  profiles.subscribe?.(refreshDirectStatus);
  toolGrips.subscribe?.(syncFields);

  $('handGripSave').addEventListener('click', () => {
    try {
      toolGrips.saveLocal();
      $('handGripStatus').textContent = `${currentToolKey()} · ${currentGripContext().toUpperCase()}: grip + base-scale draft saved locally.`;
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
    get gripContext() { return currentGripContext(); },
    get primaryGrip() { return toolGrips.primaryGripForTool(currentToolKey(), currentGripContext()); },
  });

  syncFields();
})(window);