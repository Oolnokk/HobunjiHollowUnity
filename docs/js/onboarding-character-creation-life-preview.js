// Character-creator runtime-life additions: breathing/blinking, face view, Kasa dye parity, and a starter weapon idle preview.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingCharacterCreationLifePreview'; // Prevents duplicate installation when a cached bootstrap is replayed.
  if (window[PATCH_ID]) return;

  const LIFE_SEAT_ID = 'onboarding-character-preview'; // Stable breathing/blink identity used by the portrait renderer.
  const LIFE_FRAME_MS = 90; // Keeps breathing/blinking alive without repainting the 200px portrait every display frame.
  const STARTER_WEAPON_KEY = 'hatchet_nativeCopper'; // One of makeDefaultGear()'s five starting Native Copper tools.
  const STARTER_WEAPON_SHAPE = 'hatchet'; // Shared hand-grip/visual shape for the crafted-metal starter key above.
  const STARTER_WEAPON_SPRITE = './assets/toolsprites/axe_hatchet.png'; // Same authored PNG used by gameplay/Attack Editor.
  const KASA_RANDOM_DYE_IDS = new Set([
    'dye:CLOTH:brown',
    'dye:CLOTH:dusty_yellow',
    'dye:CLOTH:dusty_orange',
  ]); // All randomly generated Kasas, including Kenkari Bowl-Kasa, are limited to these starter dyes.

  const life = {
    model: null,
    profile: null,
    frontCanvas: null,
    backCanvas: null,
    scratchFront: null,
    scratchBack: null,
    renderPending: false,
    lastLifeRenderMs: 0,
    weaponRoot: null,
    toolHolder: null,
    speciesId: null,
    gender: null,
    viewMode: 'body',
  }; // Current preview references captured from the real PNGPlaneAvatar build.

  let overlayObserver = null; // Watches only direct onboarding-card replacement; never our own nested UI mutations.
  let bodyObserver = null; // Watches only #ob-overlay mount/unmount at document-body level.
  let observedOverlay = null; // Overlay currently watched by overlayObserver.
  let creatorSyncPending = false; // Coalesces the redesign's synchronous tab/rerender transaction.
  let kasaPolicyBusy = false; // Prevents our Collections round trip from recursively applying itself.
  let lastKasaPolicyIdentity = null; // Applies random-only Kasa dye policy once per generated species/gender identity.

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
  }

  function normalizeGender(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  }

  function creatorOverlay() {
    const overlay = document.getElementById('ob-overlay');
    return overlay?.querySelector('#ob-portrait-canvas') ? overlay : null;
  }

  function currentIdentity(overlay = creatorOverlay()) {
    const speciesId = normalizeSpecies(overlay?.querySelector('[data-ob-species].ob-active')?.dataset?.obSpecies || '');
    const gender = normalizeGender(overlay?.querySelector('[data-ob-gender].ob-active')?.dataset?.obGender || 'male');
    return { speciesId, gender, key: speciesId ? `${speciesId}::${gender}` : '' };
  }

  function installStyle() {
    if (document.getElementById(`${PATCH_ID}Style`)) return;
    const style = document.createElement('style');
    style.id = `${PATCH_ID}Style`;
    style.textContent = `
#ob-overlay .ob-3d-view-toggle{position:absolute;right:8px;top:8px;z-index:4;padding:5px 7px;border:1px solid rgba(249,226,138,.38);border-radius:7px;background:rgba(0,0,0,.68);color:#f9e28a;font:8px/1.2 'DM Mono',ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
#ob-overlay .ob-3d-canvas{transition:transform .18s ease;transform-origin:50% 30%}
#ob-overlay .ob-3d-shell.ob-face-view .ob-3d-canvas{transform:translateY(18%) scale(2.25)}
`;
    document.head.appendChild(style);
  }

  function updateStatus(extra = {}) {
    const status = window.HOBUNJI_ONBOARDING_REDESIGN_STATUS;
    if (!status || typeof status !== 'object') return;
    Object.assign(status, {
      portraitLife: 'breathing+blink',
      viewMode: life.viewMode,
      previewWeapon: STARTER_WEAPON_KEY,
      previewWeaponSlot: 'weapon',
      ...extra,
    });
  }

  function ensureViewButton() {
    const shell = creatorOverlay()?.querySelector('.ob-3d-shell');
    if (!shell) return;
    shell.classList.toggle('ob-face-view', life.viewMode === 'face');
    let button = shell.querySelector('.ob-3d-view-toggle');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ob-3d-view-toggle';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        life.viewMode = life.viewMode === 'face' ? 'body' : 'face';
        ensureViewButton();
        updateStatus();
      });
      shell.appendChild(button);
    }
    const faceMode = life.viewMode === 'face';
    button.textContent = faceMode ? 'Change View: Full Body' : 'Change View: Face';
    button.setAttribute('aria-pressed', faceMode ? 'true' : 'false');
  }

  function dyeIdForButton(button) {
    return button?.dataset?.obClothDyeA || button?.dataset?.obClothDyeB || '';
  }

  function clickRestrictedKasaDye(overlay, attributeName) {
    const pool = [...overlay.querySelectorAll(`[${attributeName}]`)].filter(button => KASA_RANDOM_DYE_IDS.has(dyeIdForButton(button)));
    if (!pool.length) return;
    pool[Math.floor(Math.random() * pool.length)]?.click();
  }

  function selectedHatIsKasa(overlay) {
    const option = overlay?.querySelector('.ob-equip-sel[data-ob-equip-cat="hat"]')?.selectedOptions?.[0];
    const text = `${option?.value || ''} ${option?.textContent || ''}`.toLowerCase();
    return text.includes('kasa'); // Deliberately includes ordinary Kasas and Kenkari Bowl-Kasa.
  }

  function enforceGeneratedKasaDyes() {
    if (kasaPolicyBusy) return;
    let overlay = creatorOverlay();
    if (!overlay) {
      lastKasaPolicyIdentity = null;
      return;
    }
    const identity = currentIdentity(overlay);
    if (!identity.key || identity.key === lastKasaPolicyIdentity) return;

    // The integrated redesign owns the actual random look. Wait until it records
    // this identity so this policy cannot accidentally alter a manual selection.
    const generatedIdentity = window.HOBUNJI_ONBOARDING_REDESIGN_STATUS?.randomizedIdentity;
    if (generatedIdentity !== identity.key) {
      setTimeout(scheduleCreatorSync, 40);
      return;
    }

    kasaPolicyBusy = true;
    lastKasaPolicyIdentity = identity.key; // Set before tab clicks so direct-card observers cannot repeat the transaction.
    try {
      overlay.querySelector('[data-ob-tab="collections"]')?.click();
      overlay = creatorOverlay();
      if (overlay && selectedHatIsKasa(overlay)) {
        clickRestrictedKasaDye(overlay, 'data-ob-cloth-dye-a');
        overlay = creatorOverlay();
        if (overlay) clickRestrictedKasaDye(overlay, 'data-ob-cloth-dye-b');
      }
      overlay = creatorOverlay();
      overlay?.querySelector('[data-ob-tab="appearance"]')?.click();
    } finally {
      kasaPolicyBusy = false;
    }
  }

  function makeScratchLike(source) {
    return Object.assign(document.createElement('canvas'), {
      width: Math.max(1, Number(source?.width) || 200),
      height: Math.max(1, Number(source?.height) || 200),
    });
  }

  function copyCanvas(source, target) {
    if (!source || !target) return;
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0, target.width, target.height);
  }

  function captureOnboardingAvatar(model, sourceCanvas, options) {
    life.model = model;
    life.profile = options?.profile || null;
    life.frontCanvas = sourceCanvas || null;
    life.backCanvas = options?.backCanvas || null;
    life.scratchFront = sourceCanvas ? makeScratchLike(sourceCanvas) : null;
    life.scratchBack = options?.backCanvas ? makeScratchLike(options.backCanvas) : null;
    life.renderPending = false;
    life.lastLifeRenderMs = 0;
    const appearance = options?.appearance || options?.profile?.appearance || options?.profile?.fighter || {};
    life.speciesId = normalizeSpecies(options?.speciesId || appearance.speciesId || appearance.species);
    life.gender = normalizeGender(options?.gender || appearance.gender);
    life.weaponRoot = null;
    life.toolHolder = null;
    updateStatus();
    requestAnimationFrame(() => installStarterWeapon(model));
  }

  function wrapAvatarBuilder() {
    const api = window.PNGPlaneAvatar;
    const original = api?.buildSinglePlaneAvatarModel;
    if (typeof original !== 'function' || original.__hobunjiOnboardingLifeWrapped) return;
    const wrapped = function onboardingLifeAvatarBuild(THREE, sourceCanvas, options = {}) {
      const model = original.call(this, THREE, sourceCanvas, options);
      if (options?.userData?.source === 'onboarding-character-creator') captureOnboardingAvatar(model, sourceCanvas, options);
      return model;
    };
    wrapped.__hobunjiOnboardingLifeWrapped = true;
    api.buildSinglePlaneAvatarModel = wrapped;
  }

  async function repaintLivingPortrait(nowMs) {
    if (life.renderPending || !life.model?.parent || !life.frontCanvas?.isConnected || !life.profile || !life.scratchFront) return;
    const preview = window.NpcAvatarPreview;
    const refresh = window.PNGPlaneAvatar?.refreshSinglePlaneAvatarModel;
    if (typeof preview?.renderProfileToCanvas !== 'function' || typeof refresh !== 'function') return;

    life.renderPending = true;
    const modelAtStart = life.model;
    try {
      const common = { breathingComposer: window.portraitBreathingComposer || null, seatId: LIFE_SEAT_ID };
      // No forceEyesOpen here: portrait-utils' own shouldRenderBlink() supplies
      // the exact blink cadence used by continuously refreshed runtime portraits.
      await preview.renderProfileToCanvas(life.scratchFront, life.profile, common);
      if (modelAtStart !== life.model) return;
      copyCanvas(life.scratchFront, life.frontCanvas);

      if (life.backCanvas && life.scratchBack) {
        await preview.renderProfileToCanvas(life.scratchBack, life.profile, { ...common, portraitView: 'behind' });
        if (modelAtStart !== life.model) return;
        copyCanvas(life.scratchBack, life.backCanvas);
      }
      refresh(modelAtStart, life.frontCanvas, { backCanvas: life.backCanvas });
      life.lastLifeRenderMs = nowMs;
    } catch (error) {
      updateStatus({ portraitLifeError: error?.message || String(error) });
    } finally {
      life.renderPending = false;
    }
  }

  function idleWeaponPose() {
    return window.WeaponToolStances?.poses?.heavyWeapon || {
      x: 0.03, y: 0.37, z: -0.01,
      pitch: -155, yaw: -79, bodyYaw: -15, roll: -82,
    }; // Exact built-in Heavy Weapon fallback from weapon-tool-stances.js.
  }

  function applyPoseQuaternion(THREE, object, pose) {
    const rad = THREE.MathUtils.degToRad;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad(Number(pose.yaw) || 0));
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad(Number(pose.pitch) || 0));
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad(Number(pose.roll) || 0));
    object.quaternion.copy(qYaw.multiply(qPitch).multiply(qRoll)); // Same Y*X*Z composition used by gameplay and the Attack Editor.
  }

  function runtimeToolTexture(THREE, spritePath) {
    return new Promise(resolve => {
      new THREE.TextureLoader().load(spritePath, texture => {
        texture.magFilter = texture.minFilter = THREE.NearestFilter;
        texture.needsUpdate = true;
        resolve(texture);
      }, undefined, () => resolve(null));
    });
  }

  async function installStarterWeapon(model) {
    if (!model?.parent || model !== life.model) return;
    const THREE = window.THREE;
    const avatarGroup = model.parent;
    const modelHeight = Number(model.userData?.portraitModelHeight) || 0.9;
    const modelWidth = Number(model.userData?.portraitModelWidth) || 0.9;
    const toolBase = new THREE.Object3D(); // Sibling of the portrait, matching runtime/Attack Editor's scanned hand-attach origin.
    const toolHolder = new THREE.Object3D(); // Receives the weapon-slot Heavy idle pose.
    toolBase.name = 'OnboardingStarterWeaponBase';
    toolHolder.name = 'OnboardingStarterWeaponHolder';
    toolBase.position.set(
      Number(model.userData?.handAttachX ?? (-modelWidth / 2)),
      Number(model.userData?.handAttachY ?? (modelHeight / 2)),
      0,
    );
    toolBase.add(toolHolder);
    avatarGroup.add(toolBase);

    const pose = idleWeaponPose();
    toolHolder.position.set(Number(pose.x) || 0, Number(pose.y) || 0, Number(pose.z) || 0);
    applyPoseQuaternion(THREE, toolHolder, pose);
    avatarGroup.rotation.y = THREE.MathUtils.degToRad(Number(pose.bodyYaw) || 0); // Weapon-slot body yaw, not a preview-only flourish.
    const neckJoint = model.userData?.neckRig?.neckJoint;
    if (neckJoint) neckJoint.rotation.y = -avatarGroup.rotation.y; // Mirrors runtime's head counter-turn while the body assumes its weapon idle.

    const texture = await runtimeToolTexture(THREE, STARTER_WEAPON_SPRITE);
    if (!texture || model !== life.model || !toolHolder.parent) return;
    const imageW = Math.max(1, Number(texture.image?.width) || 1);
    const imageH = Math.max(1, Number(texture.image?.height) || 1);
    const gripScale = Number(window.HobunjiHandToolGrips?.toolScaleForTool?.(STARTER_WEAPON_SHAPE)) || 1;
    const planeW = 0.5 * gripScale; // Runtime/Attack Editor TOOL_MODEL_WIDTH.
    const planeH = planeW * (imageH / imageW);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), material);
    plane.name = 'OnboardingStarterHatchetNativeCopper';
    plane.rotation.x = -Math.PI / 2; // Same flat-in-XZ tool-sprite basis as gameplay.
    toolHolder.add(plane);
    toolHolder.userData.toolPlane = plane; // Shared hand-grip helpers recognize this convention.

    life.weaponRoot = toolBase;
    life.toolHolder = toolHolder;
    window.ProceduralHandFrameDriver?.syncNow?.(); // Ensures the existing procedural-hand rig exists before our weapon socket placement.
    updateStatus({ previewWeaponPose: 'heavyWeapon' });
  }

  function quaternionFromDeg(THREE, rotation = {}) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(rotation.pitch) || 0),
      THREE.MathUtils.degToRad(Number(rotation.yaw) || 0),
      THREE.MathUtils.degToRad(Number(rotation.roll) || 0),
      'YXZ',
    ));
  }

  function placeStarterWeaponHand() {
    const model = life.model;
    const holder = life.toolHolder;
    const handRig = model?.userData?.proceduralHandRig;
    if (!model?.parent || !holder?.parent || typeof handRig?.placeHandWorld !== 'function') return;
    const THREE = window.THREE;
    holder.updateWorldMatrix?.(true, true);

    // Hatchet's authored primary grip is identity; use the same species-specific
    // hand-from-tool frame that ProceduralHandFrameDriver uses in live gameplay.
    const profiles = window.HobunjiHandModelProfiles;
    const raw = window.HobunjiHandGripModes?.effectiveFrameForSpecies?.(life.speciesId)
      || profiles?.handTransformForSpecies?.(life.speciesId)
      || profiles?.modelForSpecies?.(life.speciesId)?.handFromTool
      || {};
    const p = raw.position || {};
    const rotation = raw.rotationDeg || {};
    const modelHeight = Number(model.userData?.portraitModelHeight) || 0.9;
    const effectiveScale = Number(profiles?.effectiveScaleFor?.(life.speciesId, life.gender)) || 1;
    const unit = modelHeight * (Number(profiles?.data?.handHeightFraction) || 0.12) * effectiveScale;

    const socketPosition = holder.getWorldPosition(new THREE.Vector3());
    const socketQuaternion = holder.getWorldQuaternion(new THREE.Quaternion());
    const handOffset = new THREE.Vector3(
      (Number(p.x) || 0) * unit,
      (Number(p.y) || 0) * unit,
      (Number(p.z) || 0) * unit,
    ).applyQuaternion(socketQuaternion);
    const handQuaternion = socketQuaternion.clone().multiply(quaternionFromDeg(THREE, rotation));
    handRig.placeHandWorld('right', socketPosition.add(handOffset), handQuaternion);
  }

  function lifeFrame(nowMs) {
    if (life.model?.parent) {
      if (nowMs - life.lastLifeRenderMs >= LIFE_FRAME_MS) repaintLivingPortrait(nowMs);
      placeStarterWeaponHand(); // Runs after the normal free-hand driver so the weapon owns the right hand exactly as gameplay does.
    }
    requestAnimationFrame(lifeFrame);
  }

  function scheduleCreatorSync() {
    if (creatorSyncPending) return;
    creatorSyncPending = true;
    setTimeout(() => {
      creatorSyncPending = false;
      ensureViewButton();
      enforceGeneratedKasaDyes();
    }, 0); // Lets the integrated redesign finish its own synchronous rerender/randomization first.
  }

  function attachOverlayObserver() {
    const overlay = document.getElementById('ob-overlay');
    if (overlay === observedOverlay) return;
    overlayObserver?.disconnect();
    observedOverlay = overlay;
    if (!overlay) return;
    overlayObserver = new MutationObserver(scheduleCreatorSync);
    overlayObserver.observe(overlay, { childList: true }); // Direct children only; avoids the old self-observing freeze class.
  }

  function installObservers() {
    const start = () => {
      if (bodyObserver) return;
      bodyObserver = new MutationObserver(() => {
        attachOverlayObserver();
        scheduleCreatorSync();
      });
      bodyObserver.observe(document.body, { childList: true });
      attachOverlayObserver();
      scheduleCreatorSync();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  function install() {
    installStyle();
    try { window.portraitBreathingComposer?.load?.('./config/'); } catch (_) {}
    wrapAvatarBuilder();
    installObservers();
    requestAnimationFrame(lifeFrame);

    // The hand/bootstrap scripts are parser-loaded before onboarding, but keep a
    // short retry for cache/race cases where PNGPlaneAvatar is late to publish.
    let attempts = 0;
    const retry = setInterval(() => {
      wrapAvatarBuilder();
      if (window.PNGPlaneAvatar?.buildSinglePlaneAvatarModel?.__hobunjiOnboardingLifeWrapped || ++attempts >= 100) clearInterval(retry);
    }, 50);
  }

  window[PATCH_ID] = Object.freeze({ install, life, starterWeaponKey: STARTER_WEAPON_KEY });
  install();
})();
