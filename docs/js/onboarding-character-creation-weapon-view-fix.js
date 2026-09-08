// Character-creator follow-up: random starter weapon persistence, real weapon-hand ownership, and species-aware face view.
(() => {
  'use strict';

  const FIX_ID = 'hobunjiOnboardingCharacterCreationWeaponViewFix'; // Prevents duplicate installation from cached parser bootstraps.
  if (window[FIX_ID]) return;

  const BASE_PATCH_ID = 'hobunjiOnboardingCharacterCreationLifePreview'; // Life-preview module whose model/profile references we reuse.
  const FACE_ZOOM = 2.25; // Same close-up strength as the first face-view pass, now anchored to the actual current head.
  const FACE_NECK_OFFSET = 0.13; // Model-height fraction from neck joint toward the visual center of the face.
  const STARTER_WEAPONS = Object.freeze([
    Object.freeze({ itemKey: 'hoe_nativeCopper', shape: 'hoe', label: 'Native Copper Hoe', sprite: './assets/toolsprites/hoe_bronzehoe.png', idleClass: 'heavy', animStyle: 'chop' }),
    Object.freeze({ itemKey: 'hatchet_nativeCopper', shape: 'hatchet', label: 'Native Copper Hatchet', sprite: './assets/toolsprites/axe_hatchet.png', idleClass: 'heavy', animStyle: 'sweep' }),
    Object.freeze({ itemKey: 'fishingspear_nativeCopper', shape: 'fishingspear', label: 'Native Copper Fishing Spear', sprite: './assets/toolsprites/harpoon_fishingspear.png', idleClass: 'light', animStyle: 'sweep' }),
    Object.freeze({ itemKey: 'pickshovel_nativeCopper', shape: 'pickshovel', label: 'Native Copper Pick-Shovel', sprite: './assets/toolsprites/shovel_pickshovel.png', idleClass: 'light', animStyle: 'thrust' }),
  ]); // Fishing Mace is friendship-gated away from fresh characters by weapon-trust-visits, so it is not a true post-onboarding starter choice.

  const state = {
    choice: null,
    choiceIdentity: null,
    model: null,
    weaponRoot: null,
    toolHolder: null,
    toolPlane: null,
    installToken: 0,
    handRig: null,
  }; // Creator-only visual/equipment state; persisted into the real character only on hobunjiPlayerReady.

  let active = true; // Flips false once character creation hands off, stopping the forever per-frame sync loop.

  function baseLife() {
    return window[BASE_PATCH_ID]?.life || null;
  }

  function creatorOverlay() {
    const overlay = document.getElementById('ob-overlay');
    return overlay?.querySelector('#ob-portrait-canvas') ? overlay : null;
  }

  function currentIdentityKey() {
    const statusKey = window.HOBUNJI_ONBOARDING_REDESIGN_STATUS?.randomizedIdentity;
    if (statusKey) return String(statusKey);
    const overlay = creatorOverlay();
    const species = overlay?.querySelector('[data-ob-species].ob-active')?.dataset?.obSpecies || '';
    const gender = overlay?.querySelector('[data-ob-gender].ob-active')?.dataset?.obGender || 'male';
    return species ? `${species}::${gender}` : '';
  }

  function randomChoice(array) {
    return array.length ? array[Math.floor(Math.random() * array.length)] : null;
  }

  function ensureWeaponChoice() {
    const identity = currentIdentityKey();
    if (!identity) return state.choice;
    if (identity !== state.choiceIdentity || !state.choice) {
      state.choiceIdentity = identity;
      state.choice = randomChoice(STARTER_WEAPONS);
      state.installToken += 1; // Cancels any texture load still completing for the previous generated identity.
      disposeOwnWeapon();
    }
    updateStatus();
    return state.choice;
  }

  function updateStatus(extra = {}) {
    const status = window.HOBUNJI_ONBOARDING_REDESIGN_STATUS;
    if (!status || typeof status !== 'object') return;
    Object.assign(status, {
      randomizedStarterWeapon: state.choice?.itemKey || null,
      randomizedStarterWeaponLabel: state.choice?.label || null,
      previewWeapon: state.choice?.itemKey || null,
      previewWeaponSlot: 'weapon',
      previewWeaponHandOwner: state.handRig ? 'procedural-right-hand' : 'waiting-for-hand-rig',
      faceViewAnchor: 'current-avatar-neck-height',
      ...extra,
    });
  }

  function installStyle() {
    if (document.getElementById(`${FIX_ID}Style`)) return;
    const style = document.createElement('style');
    style.id = `${FIX_ID}Style`;
    style.textContent = `
#ob-overlay .ob-3d-shell > .ob-3d-view-toggle{display:none!important}
#ob-overlay .ob-3d-view-toggle-fixed{display:block;width:220px;box-sizing:border-box;margin:7px auto 0;padding:7px 9px;border:1px solid rgba(249,226,138,.38);border-radius:8px;background:rgba(249,226,138,.06);color:#f9e28a;font:9px/1.25 'DM Mono',ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
#ob-overlay .ob-3d-shell.ob-face-view .ob-3d-canvas{transform:none!important}
@media (max-width:560px){#ob-overlay .ob-3d-view-toggle-fixed{width:min(270px,82vw)}}
`;
    document.head.appendChild(style);
  }

  function ensureFixedViewButton() {
    const overlay = creatorOverlay();
    const shell = overlay?.querySelector('.ob-3d-shell');
    if (!shell) return null;

    // The original life module still creates its inside-canvas button; keep it
    // hidden and own a separate control beneath the viewport so later rerenders
    // cannot move the visible control back over the character.
    for (const old of shell.querySelectorAll(':scope > .ob-3d-view-toggle')) {
      old.setAttribute('aria-hidden', 'true');
      old.tabIndex = -1;
    }

    let button = overlay.querySelector('.ob-3d-view-toggle-fixed');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ob-3d-view-toggle-fixed';
      button.addEventListener('click', event => {
        event.preventDefault();
        const life = baseLife();
        if (!life) return;
        life.viewMode = life.viewMode === 'face' ? 'body' : 'face';
        applyAdaptiveView();
      });
    }
    if (button.previousElementSibling !== shell) shell.insertAdjacentElement('afterend', button);
    const face = baseLife()?.viewMode === 'face';
    button.textContent = face ? 'Change View: Full Body' : 'Change View: Face';
    button.setAttribute('aria-pressed', face ? 'true' : 'false');
    return button;
  }

  function faceWorldAnchor(THREE, model) {
    if (!model?.parent) return null;
    model.updateWorldMatrix?.(true, true);
    const neck = model.userData?.neckRig?.neckJoint || null;
    const modelHeight = Math.max(0.1, Number(model.userData?.portraitModelHeight) || 0.9);
    const group = model.parent;
    const worldScale = group.getWorldScale?.(new THREE.Vector3()) || new THREE.Vector3(1, 1, 1);

    if (neck?.getWorldPosition) {
      const anchor = neck.getWorldPosition(new THREE.Vector3());
      anchor.y += modelHeight * Math.abs(Number(worldScale.y) || 1) * FACE_NECK_OFFSET;
      return anchor;
    }
    return group.localToWorld(new THREE.Vector3(0, modelHeight * 0.80, 0));
  }

  function faceOriginPercent(shell, model) {
    const THREE = window.THREE;
    if (!THREE?.PerspectiveCamera || !model?.parent) return { x: 50, y: 30 };
    const width = Math.max(1, shell.clientWidth || 220);
    const height = Math.max(1, shell.clientHeight || 300);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 100); // Mirrors onboarding-character-creation-redesign's fixed preview camera.
    camera.position.set(1.55, 1.08, 2.75);
    camera.lookAt(0, 0.53, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const anchor = faceWorldAnchor(THREE, model);
    if (!anchor) return { x: 50, y: 30 };
    const projected = anchor.clone().project(camera);
    const x = Math.max(18, Math.min(82, (projected.x * 0.5 + 0.5) * 100));
    const y = Math.max(10, Math.min(72, (1 - (projected.y * 0.5 + 0.5)) * 100));
    return { x, y };
  }

  function applyAdaptiveView() {
    const overlay = creatorOverlay();
    const shell = overlay?.querySelector('.ob-3d-shell');
    const canvas = shell?.querySelector('.ob-3d-canvas');
    const life = baseLife();
    if (!shell || !canvas || !life) return;
    ensureFixedViewButton();

    const face = life.viewMode === 'face';
    shell.classList.toggle('ob-face-view', face);
    if (!face) {
      canvas.style.setProperty('transform', 'none', 'important');
      canvas.style.setProperty('transform-origin', '50% 30%', 'important');
      return;
    }
    const origin = faceOriginPercent(shell, life.model);
    canvas.style.setProperty('transform-origin', `${origin.x.toFixed(2)}% ${origin.y.toFixed(2)}%`, 'important');
    canvas.style.setProperty('transform', `scale(${FACE_ZOOM})`, 'important');
  }

  function hierarchyWorldQuaternion(THREE, node) {
    const chain = [];
    for (let cursor = node; cursor?.isObject3D; cursor = cursor.parent) chain.push(cursor);
    const result = new THREE.Quaternion();
    result.identity();
    for (let index = chain.length - 1; index >= 0; index -= 1) result.multiply(chain[index].quaternion);
    return result.normalize();
  }

  function quaternionFromAuthored(THREE, raw = {}) {
    const q = raw.rotationQuaternion;
    if (q && [q.x, q.y, q.z, q.w].every(value => Number.isFinite(Number(value)))) {
      return new THREE.Quaternion(Number(q.x), Number(q.y), Number(q.z), Number(q.w)).normalize();
    }
    const r = raw.rotationDeg || {};
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(r.pitch) || 0),
      THREE.MathUtils.degToRad(Number(r.yaw) || 0),
      THREE.MathUtils.degToRad(Number(r.roll) || 0),
      'YXZ',
    ));
  }

  function weaponPose(choice) {
    const key = choice?.idleClass === 'heavy' ? 'heavyWeapon' : 'lightWeapon';
    const authored = window.WeaponToolStances?.poses?.[key];
    if (authored) return { key, pose: authored };
    return choice?.idleClass === 'heavy'
      ? { key, pose: { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: -15, roll: -82 } }
      : { key, pose: { x: 0.04, y: 0, z: 0, pitch: 20, yaw: -70, bodyYaw: -40, roll: -65 } };
  }

  function applyPoseQuaternion(THREE, object, pose) {
    const rad = THREE.MathUtils.degToRad;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad(Number(pose.yaw) || 0));
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad(Number(pose.pitch) || 0));
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad(Number(pose.roll) || 0));
    object.quaternion.copy(qYaw.multiply(qPitch).multiply(qRoll));
  }

  function disposeObject(root) {
    root?.traverse?.(node => {
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
      for (const material of materials) {
        material?.map?.dispose?.();
        material?.dispose?.();
      }
    });
    root?.parent?.remove?.(root);
  }

  function disposeOwnWeapon() {
    disposeObject(state.weaponRoot);
    state.weaponRoot = null;
    state.toolHolder = null;
    state.toolPlane = null;
    state.handRig = null;
  }

  function suppressLegacyWeapon() {
    const life = baseLife();
    const group = life?.model?.parent || null;
    if (group) {
      for (const child of [...group.children]) {
        if (child?.name === 'OnboardingStarterWeaponBase') group.remove(child);
      }
    }
    // Keeping these null makes the original module's after-render manual hand
    // placement a no-op. The real fix below runs inside rig.useIdlePose, which
    // the global hand driver executes BEFORE the preview scene renders.
    if (life?.weaponRoot?.name === 'OnboardingStarterWeaponBase') {
      life.weaponRoot?.parent?.remove?.(life.weaponRoot);
      life.weaponRoot = null;
    }
    if (life?.toolHolder?.name === 'OnboardingStarterWeaponHolder') life.toolHolder = null;
  }

  function loadToolTexture(THREE, spritePath) {
    return new Promise(resolve => {
      new THREE.TextureLoader().load(spritePath, texture => {
        texture.magFilter = texture.minFilter = THREE.NearestFilter;
        texture.needsUpdate = true;
        resolve(texture);
      }, undefined, () => resolve(null));
    });
  }

  function applyPrimaryGripVisual(THREE, plane, choice, baseQuaternion) {
    const grips = window.HobunjiHandToolGrips;
    const primary = grips?.authoredPrimaryGripForTool?.(choice.shape) || {};
    const scale = Number(grips?.toolScaleForTool?.(choice.shape)) || 1;
    const p = primary.position || {};
    const gripQ = quaternionFromAuthored(THREE, primary);
    const correctionQ = gripQ.clone().invert();
    const correctionPosition = new THREE.Vector3(
      -(Number(p.x) || 0) * scale,
      -(Number(p.y) || 0) * scale,
      -(Number(p.z) || 0) * scale,
    ).applyQuaternion(correctionQ);
    plane.position.copy(correctionPosition);
    plane.quaternion.copy(correctionQ.multiply(baseQuaternion));
    plane.scale.setScalar(scale);
    return scale;
  }

  function makeToolMaterial(THREE, texture, name) {
    return window.HobunjiSpritePngSurface?.makeMaterial?.(THREE, texture, name)
      || new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide });
  }

  async function installRandomWeapon(model, choice) {
    if (!model?.parent || model !== baseLife()?.model || !choice) return;
    const token = ++state.installToken;
    disposeOwnWeapon();
    suppressLegacyWeapon();

    const THREE = window.THREE;
    const avatarGroup = model.parent;
    const modelHeight = Number(model.userData?.portraitModelHeight) || 0.9;
    const modelWidth = Number(model.userData?.portraitModelWidth) || 0.9;
    const toolBase = new THREE.Object3D();
    const holder = new THREE.Object3D();
    toolBase.name = 'OnboardingRandomStarterWeaponBase';
    holder.name = 'OnboardingRandomStarterWeaponHolder';
    toolBase.position.set(
      Number(model.userData?.handAttachX ?? (-modelWidth / 2)),
      Number(model.userData?.handAttachY ?? (modelHeight / 2)),
      0,
    );
    toolBase.add(holder);
    avatarGroup.add(toolBase);

    const idle = weaponPose(choice);
    const pose = idle.pose;
    holder.position.set(Number(pose.x) || 0, Number(pose.y) || 0, Number(pose.z) || 0);
    applyPoseQuaternion(THREE, holder, pose);
    avatarGroup.rotation.y = THREE.MathUtils.degToRad(Number(pose.bodyYaw) || 0);
    const neckJoint = model.userData?.neckRig?.neckJoint;
    if (neckJoint) neckJoint.rotation.y = -avatarGroup.rotation.y;

    state.model = model;
    state.weaponRoot = toolBase;
    state.toolHolder = holder;
    window.ProceduralHandFrameDriver?.syncNow?.();
    installHandOwnership();

    const texture = await loadToolTexture(THREE, choice.sprite);
    if (!texture || token !== state.installToken || model !== baseLife()?.model || !holder.parent) {
      texture?.dispose?.();
      return;
    }
    const imageW = Math.max(1, Number(texture.image?.width) || 1);
    const imageH = Math.max(1, Number(texture.image?.height) || 1);
    const planeW = 0.5; // Runtime/Attack Editor TOOL_MODEL_WIDTH; authored grip metadata supplies the permanent shape scale.
    const planeH = planeW * (imageH / imageW);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      makeToolMaterial(THREE, texture, `Onboarding_${choice.shape}_material`),
    );
    plane.name = `OnboardingRandomStarter_${choice.shape}`;
    plane.rotation.x = -Math.PI / 2;
    if (choice.animStyle === 'sweep') plane.rotation.z = Math.PI / 2; // Runtime weapon-slot neutral compensation for sweep sprites.
    const baseQuaternion = plane.quaternion.clone();
    applyPrimaryGripVisual(THREE, plane, choice, baseQuaternion);
    holder.add(plane);
    holder.userData.toolPlane = plane;
    state.toolPlane = plane;
    installHandOwnership();
    placeWeaponHand();
    updateStatus({ previewWeaponPose: idle.key });
  }

  function handTransform() {
    const life = baseLife();
    const model = life?.model;
    const profiles = window.HobunjiHandModelProfiles;
    const raw = window.HobunjiHandGripModes?.effectiveFrameForSpecies?.(life?.speciesId)
      || profiles?.handTransformForSpecies?.(life?.speciesId)
      || profiles?.modelForSpecies?.(life?.speciesId)?.handFromTool
      || {};
    const p = raw.position || {};
    const modelHeight = Number(model?.userData?.portraitModelHeight) || 0.9;
    const effectiveScale = Number(profiles?.effectiveScaleFor?.(life?.speciesId, life?.gender)) || 1;
    const unit = modelHeight * (Number(profiles?.data?.handHeightFraction) || 0.12) * effectiveScale;
    return {
      position: { x: (Number(p.x) || 0) * unit, y: (Number(p.y) || 0) * unit, z: (Number(p.z) || 0) * unit },
      quaternion: quaternionFromAuthored(window.THREE, raw),
    };
  }

  function placeWeaponHand() {
    const life = baseLife();
    const model = life?.model;
    const holder = state.toolHolder;
    const rig = model?.userData?.proceduralHandRig;
    if (!model?.parent || !holder?.parent || typeof rig?.placeHandWorld !== 'function') return false;
    const THREE = window.THREE;
    holder.updateWorldMatrix?.(true, true);
    const socketPosition = holder.getWorldPosition(new THREE.Vector3());
    const socketQuaternion = hierarchyWorldQuaternion(THREE, holder);
    const authored = handTransform();
    const offset = new THREE.Vector3(authored.position.x, authored.position.y, authored.position.z).applyQuaternion(socketQuaternion);
    const handQuaternion = socketQuaternion.clone().multiply(authored.quaternion);
    const result = rig.placeHandWorld('right', socketPosition.add(offset), handQuaternion);
    state.handRig = rig;
    return result !== false;
  }

  function installHandOwnership() {
    const model = baseLife()?.model;
    if (!model) return false;
    window.ProceduralHandFrameDriver?.syncNow?.();
    const rig = model.userData?.proceduralHandRig;
    if (!rig?.useIdlePose) return false;
    state.handRig = rig;
    if (rig.__hobunjiOnboardingWeaponOwner === FIX_ID) return true;

    const originalUseIdlePose = rig.useIdlePose.bind(rig);
    rig.useIdlePose = function onboardingWeaponOwnedIdle(poses) {
      const result = originalUseIdlePose(poses); // Keeps the left/free hand on the normal breathing idle pose.
      if (baseLife()?.model === model && state.model === model && state.toolHolder?.parent) placeWeaponHand();
      return result;
    };
    Object.defineProperty(rig, '__hobunjiOnboardingWeaponOwner', { value: FIX_ID, configurable: true });
    placeWeaponHand();
    updateStatus();
    return true;
  }

  function persistWeaponSelection(event) {
    const choice = ensureWeaponChoice();
    const playerData = event?.detail;
    if (!choice || !playerData?.characterId) return;

    playerData.equipmentSlots = { ...(playerData.equipmentSlots || {}), weapon: choice.itemKey };
    playerData.activeTool = 'weapon';
    if (window.__hobunjiPlayerProfile) {
      window.__hobunjiPlayerProfile.equipmentSlots = { ...(window.__hobunjiPlayerProfile.equipmentSlots || {}), weapon: choice.itemKey };
      window.__hobunjiPlayerProfile.activeTool = 'weapon';
    }

    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const character = meta?.characters?.find?.(entry => entry?.id === playerData.characterId);
      if (character) {
        character.equipmentSlots = { ...(character.equipmentSlots || {}), weapon: choice.itemKey };
        character.activeTool = 'weapon';
        localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
      }
      localStorage.setItem('hobunjiPlayerProfile', JSON.stringify(playerData));
    } catch (error) {
      updateStatus({ starterWeaponPersistError: error?.message || String(error) });
    }
    updateStatus({ starterWeaponPersisted: choice.itemKey });
  }

  function syncModelAndWeapon() {
    const life = baseLife();
    const model = life?.model || null;
    const choice = ensureWeaponChoice();
    suppressLegacyWeapon();
    ensureFixedViewButton();
    applyAdaptiveView();

    if (!model?.parent || !choice) return;
    if (state.model !== model || !state.weaponRoot?.parent) {
      state.model = model;
      requestAnimationFrame(() => {
        if (baseLife()?.model === model) installRandomWeapon(model, choice);
      });
      return;
    }
    installHandOwnership();
  }

  function frame() {
    if (!active) return; // Stops rescheduling once character creation has handed off.
    syncModelAndWeapon();
    requestAnimationFrame(frame);
  }

  function install() {
    installStyle();
    // Capture phase + parser load order means game/combat consumers receive the
    // selected weapon slot already populated on the same hobunjiPlayerReady event.
    document.addEventListener('hobunjiPlayerReady', persistWeaponSelection, { capture: true });
    // Separate, later listener: lets the closing fade (~420ms) keep syncing on
    // its way out, then stops the forever per-frame loop for the rest of the session.
    document.addEventListener('hobunjiPlayerReady', () => setTimeout(() => { active = false; }, 500), { once: true });
    requestAnimationFrame(frame);
  }

  window[FIX_ID] = Object.freeze({ install, state, starterWeapons: STARTER_WEAPONS, ensureWeaponChoice });
  install();
})();