// Hobunji Hollow — character-creation workflow redesign.
// Enhances the existing onboarding save/profile core without duplicating its persistence logic.
(() => {
  'use strict';

  const REDESIGN_ID = 'hobunjiOnboardingCharacterCreationRedesign'; // Used to prevent duplicate installation if the bootstrap is evaluated twice.
  if (window[REDESIGN_ID]) return;

  const LORE = Object.freeze({ // Used by the species and subspecies description panels.
    slagothim: Object.freeze({
      label: 'Slagothim',
      text: 'Sloth-folk of the Northern Archipelago, and the lifeblood of cross-continental trade. Their people possess an unusual affinity for beasts, impossibly strong backs and the ability to turn completely invisible with sustained stillness. However, without regularly chewing their sacred Koma Leaf, they are cursed to move with the extreme slowness of their tree-dwelling ancestors.',
    }),
    tletingan: Object.freeze({
      label: 'Tletingan',
      text: 'Natives of the islands of Tletinga-taru and Tletinga-iku. The most populous of the Slagothim subspecies.',
    }),
    mashtzarr: Object.freeze({
      label: 'Mashtzarr',
      text: 'Oliphanti of the Eastern Highplains. Though smaller and rounder-headed than their western cousins, the Mammakhbuur, but still tower over most other peoples of Khymeryya. Their homeland is a harsh, elevated grassland rich with deep copper mines. Most live their whole lives in isolated communities, working as miners or herders.',
    }),
    'mao-ao': Object.freeze({
      label: "Mao'ao",
      text: 'Tall, agile Yubashi native to the hot rainforests and riverlands of Tanka. Their speed, climbing ability, keen senses, and familiarity with dense jungle make them exceptionally capable travelers through terrain that can be deadly to outsiders. They are the ruling caste of the Tankan Empire, a sovereignty in which Hobunji Hollow and the entire Harugasirri Highlands stand.',
    }),
    'engh-sho': Object.freeze({
      label: 'Engh-sho',
      text: 'Sailors of the Snow-sea that pools between the twin chains of the Sho-ngyankwani Mountains. Engh-sho children are traditionally named for the first object they grasp, whose significance is interpreted by a village elder through communion with their ancestors.',
    }),
    kenkari: Object.freeze({
      label: 'Kenkari',
      text: 'Round parrotfolk of the Southern Archipelago. From their people have come renowned musicians amd playwrights, deadly bounty hunters and whistling warriors. For them an ideal life is not one of wealth, wholeness or wellbeing. For a kenkari, an great life is one interesting enough to outlive them.',
    }),
  });

  const status = { // Exposed below for mobile-friendly diagnosis without requiring DevTools.
    installed: true,
    preview: 'idle',
    speciesId: null,
    gender: null,
    scale: null,
    lastError: null,
  };
  window.HOBUNJI_ONBOARDING_REDESIGN_STATUS = status;

  let familyOpen = false; // Tracks whether the Slagothim family step is open before a concrete subspecies is chosen.
  let observer = null; // Watches the onboarding overlay because the legacy core replaces its innerHTML on every selection change.
  let enhanceQueued = false; // Coalesces many mutation notifications into one DOM enhancement pass.
  let previewScene = null; // Holds the currently mounted Three.js preview scene for the active creator render.
  let previewBuildGeneration = 0; // Invalidates asynchronous front/back/head builds when the player changes appearance quickly.
  let latestProfile = null; // Reused to rebuild the 3D avatar after the creator DOM rerenders without requiring another portrait change.
  let latestFrontCanvas = null; // Retains the core's freshly-rendered front texture canvas for the current profile.
  let lastRenderPromise = Promise.resolve(); // Serializes preview rebuilds so shared portrait rendering cannot race itself.

  function normalizeSpecies(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-'); // Normalized for runtime profile/config lookups.
    return raw === 'rakakoan' ? 'kenkari' : raw === 'ghoul' ? 'mao-ao' : raw;
  }

  function normalizeGender(value) {
    const raw = String(value || '').trim().toLowerCase(); // Normalized for the authored species/gender scale table.
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  }

  function creatorOverlay() {
    const overlay = document.getElementById('ob-overlay'); // Used to distinguish character creation from the save-select screen.
    return overlay?.querySelector('#ob-portrait-canvas') ? overlay : null;
  }

  function activeCoreSpecies(overlay = creatorOverlay()) {
    const active = overlay?.querySelector('[data-ob-species].ob-active'); // Reads the legacy core's actual selected internal species ID.
    return normalizeSpecies(active?.dataset?.obSpecies || '');
  }

  function activeCoreGender(overlay = creatorOverlay()) {
    const active = overlay?.querySelector('[data-ob-gender].ob-active'); // Reads the legacy core's actual selected gender.
    return normalizeGender(active?.dataset?.obGender || 'male');
  }

  function identityFromProfile(profile, overlay = creatorOverlay()) {
    const fighter = profile?.fighter || {}; // Provides a fallback identity for portrait-profile shapes that do not expose top-level species fields.
    const appearance = profile?.appearance || {}; // Provides the runtime-compatible appearance fallback used by PNGPlaneAvatar.
    const speciesId = normalizeSpecies(
      profile?.speciesId || profile?.species || fighter?.speciesId || fighter?.species || appearance?.speciesId || activeCoreSpecies(overlay),
    ); // Used by scale, feet, hands, and diagnostic status.
    const gender = normalizeGender(profile?.gender || fighter?.gender || appearance?.gender || activeCoreGender(overlay)); // Used by scale, feet, hands, and diagnostics.
    return { speciesId, gender };
  }

  function installStyle() {
    if (document.getElementById(`${REDESIGN_ID}Style`)) return;
    const style = document.createElement('style'); // Carries redesign-only layout so onboarding.css stays untouched.
    style.id = `${REDESIGN_ID}Style`;
    style.textContent = `
#ob-overlay .ob-col-left{position:relative;min-width:220px}
#ob-overlay #ob-portrait-canvas.ob-portrait{position:absolute!important;left:-10000px!important;top:-10000px!important;width:200px!important;height:200px!important;opacity:0!important;pointer-events:none!important}
#ob-overlay .ob-3d-shell{position:relative;width:220px;height:300px;border:1px solid rgba(249,226,138,.18);border-radius:13px;overflow:hidden;background:radial-gradient(circle at 50% 28%,rgba(249,226,138,.07),rgba(3,9,7,.86) 70%);touch-action:none}
#ob-overlay .ob-3d-canvas{display:block;width:100%;height:100%;touch-action:none}
#ob-overlay .ob-3d-scale-label{position:absolute;left:8px;top:8px;z-index:2;padding:4px 6px;border-radius:6px;background:rgba(0,0,0,.62);border:1px solid rgba(255,255,255,.1);font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#b7ceb9;pointer-events:none}
#ob-overlay .ob-3d-status{width:220px;box-sizing:border-box;font:9px/1.35 'DM Mono',ui-monospace,monospace;color:#8aad8f;text-align:center;overflow-wrap:anywhere}
#ob-overlay .ob-3d-status.ob-error{color:#ffb59e}
#ob-overlay .ob-species-description{margin:7px 0 3px;padding:9px 10px;border-left:2px solid rgba(249,226,138,.48);border-radius:0 8px 8px 0;background:rgba(249,226,138,.045);font-size:10px;line-height:1.5;color:#c9dcc8}
#ob-overlay .ob-species-description strong{display:block;margin-bottom:3px;color:#f9e28a;font-size:11px}
#ob-overlay .ob-subspecies-wrap{margin:7px 0 4px;padding:9px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.025)}
#ob-overlay .ob-subspecies-title{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#8aad8f;margin-bottom:6px}
#ob-overlay .ob-subspecies-group{display:flex;gap:5px;flex-wrap:wrap}
#ob-overlay .ob-subspecies-description{margin-top:7px;font-size:9px;line-height:1.45;color:#a9c1ad}
#ob-overlay .ob-family-btn.ob-active{background:rgba(249,226,138,.11);border-color:rgba(249,226,138,.42);color:#f9e28a}
#ob-overlay .ob-subspecies-unavailable{position:relative}
#ob-overlay .ob-subspecies-unavailable::after{content:'Unavailable';display:block;font-size:7px;line-height:1;margin-top:2px;letter-spacing:.05em;text-transform:uppercase}
@media (max-width:560px){#ob-overlay .ob-col-left{min-width:0}.ob-3d-shell{width:min(270px,82vw)!important;height:min(330px,44vh)!important}.ob-3d-status{width:min(270px,82vw)!important}#ob-overlay .ob-col-right{width:100%}}
`;
    document.head.appendChild(style);
  }

  function speciesDescriptionHtml(entry) {
    if (!entry) return '';
    return `<div class="ob-species-description" data-ob-redesign-description="1"><strong>${entry.label}</strong>${entry.text}</div>`;
  }

  function enhanceSpeciesWorkflow(overlay) {
    const speciesLabel = [...overlay.querySelectorAll('.ob-section-label')].find(node => node.textContent?.trim() === 'Species'); // Locates the legacy top-level selector without depending on DOM position elsewhere.
    const group = speciesLabel?.nextElementSibling?.classList?.contains('ob-group') ? speciesLabel.nextElementSibling : null; // Used as the insertion point for family/subspecies UI.
    if (!group || group.dataset.obSpeciesRedesign === '1') return;
    group.dataset.obSpeciesRedesign = '1';

    const tletinganButton = group.querySelector('[data-ob-species="tletingan"]'); // Kept hidden as the canonical legacy state-change trigger for Tletingan.
    if (!tletinganButton) return;
    const tletinganActive = tletinganButton.classList.contains('ob-active'); // Keeps returning/current Tletingan characters on the Slagothim family step.
    if (tletinganActive) familyOpen = true;
    tletinganButton.hidden = true;

    const maoButton = group.querySelector('[data-ob-species="mao-ao"]'); // Used only to correct the player-facing lore spelling without changing the internal asset ID.
    if (maoButton) maoButton.textContent = "Mao'ao";

    const familyButton = document.createElement('button'); // Opens the second-step subspecies choice instead of directly changing the core species ID.
    familyButton.type = 'button';
    familyButton.className = `ob-sel-btn ob-family-btn${familyOpen || tletinganActive ? ' ob-active' : ''}`;
    familyButton.dataset.obFamily = 'slagothim';
    familyButton.textContent = 'Slagothim';
    tletinganButton.before(familyButton);

    group.addEventListener('click', event => {
      const speciesButton = event.target.closest?.('[data-ob-species]'); // Used to close the family step when a different top-level species is chosen.
      if (speciesButton && speciesButton.dataset.obSpecies !== 'tletingan') familyOpen = false;
    }, true);

    familyButton.addEventListener('click', () => {
      familyOpen = true;
      group.querySelectorAll('[data-ob-species].ob-active').forEach(button => button.classList.remove('ob-active'));
      familyButton.classList.add('ob-active');
      renderSpeciesDetails(overlay, group, tletinganButton);
    });

    renderSpeciesDetails(overlay, group, tletinganButton);
  }

  function renderSpeciesDetails(overlay, group, tletinganButton) {
    overlay.querySelectorAll('[data-ob-redesign-description], [data-ob-subspecies-wrap]').forEach(node => node.remove());
    const currentSpecies = activeCoreSpecies(overlay); // Used to choose the active non-Slagothim lore entry.
    const tletinganActive = tletinganButton?.classList.contains('ob-active') || currentSpecies === 'tletingan'; // Used to keep Tletingan selected after the core rerender.
    const familyButton = group.querySelector('[data-ob-family="slagothim"]'); // Used to reflect the Slagothim family selection visually.
    const showFamily = familyOpen || tletinganActive; // Determines whether the second-step selector is visible.

    if (familyButton) familyButton.classList.toggle('ob-active', showFamily);
    const detailHost = document.createElement('div'); // Inserted after the top-level species group so descriptions stay with their selector.
    detailHost.dataset.obRedesignDescription = '1';

    if (!showFamily) {
      const entry = LORE[currentSpecies]; // Supplies lore for ordinary top-level species.
      if (entry) detailHost.innerHTML = speciesDescriptionHtml(entry);
      group.after(detailHost);
      return;
    }

    detailHost.innerHTML = speciesDescriptionHtml(LORE.slagothim);
    const subspecies = document.createElement('div'); // Holds the required second-step Slagothim subspecies choices.
    subspecies.className = 'ob-subspecies-wrap';
    subspecies.dataset.obSubspeciesWrap = '1';
    subspecies.innerHTML = `
      <div class="ob-subspecies-title">Slagothim subspecies</div>
      <div class="ob-subspecies-group">
        <button type="button" class="ob-sel-btn${tletinganActive ? ' ob-active' : ''}" data-ob-subspecies="tletingan">Tletingan</button>
        <button type="button" class="ob-sel-btn ob-disabled ob-subspecies-unavailable" data-ob-subspecies="nuhongan" disabled>Nuhongan</button>
        <button type="button" class="ob-sel-btn ob-disabled ob-subspecies-unavailable" data-ob-subspecies="longoran" disabled>Longoran</button>
      </div>
      <div class="ob-subspecies-description"><strong>${LORE.tletingan.label}:</strong> ${LORE.tletingan.text}</div>`;
    detailHost.appendChild(subspecies);
    group.after(detailHost);

    subspecies.querySelector('[data-ob-subspecies="tletingan"]')?.addEventListener('click', () => {
      familyOpen = true;
      tletinganButton?.click();
    });
  }

  function setPreviewStatus(text, isError = false) {
    const node = creatorOverlay()?.querySelector('.ob-3d-status'); // Mirrors preview health directly in the creator for mobile debugging.
    if (node) {
      node.textContent = text;
      node.classList.toggle('ob-error', isError);
    }
  }

  function disposePreviewScene() {
    const sceneState = previewScene; // Snapshot prevents cleanup from touching a newly-created scene after a rapid rerender.
    previewScene = null;
    if (!sceneState) return;
    sceneState.running = false;
    try { sceneState.feet?.dispose?.(); } catch (_) {}
    try { window.PNGPlaneAvatar?.disposeAvatarModel?.(sceneState.model); } catch (_) {}
    try { sceneState.avatarGroup?.parent?.remove?.(sceneState.avatarGroup); } catch (_) {}
    try { sceneState.renderer?.dispose?.(); } catch (_) {}
  }

  function makePreviewScene(canvas) {
    const THREE = window.THREE; // Uses the same Three.js r128 global loaded by docs/index.html for gameplay.
    if (!THREE?.WebGLRenderer) throw new Error('Three.js runtime is unavailable.');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false }); // Draws only the creator preview and is disposed on every core rerender.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene(); // Holds the floor grid and one runtime-scaled avatar group.
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100); // Fixed framing keeps species height differences visibly comparable rather than auto-normalizing them.
    camera.position.set(1.55, 1.08, 2.75);
    camera.lookAt(0, 0.53, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x16241c, 1.7); // Matches the neutral preview lighting used by the shared avatar preview scene.
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.15); // Gives the flat avatar and 3D hands/feet readable form from the front-right.
    key.position.set(2.4, 3.1, 3.5);
    scene.add(key);
    const grid = new THREE.GridHelper(4, 8, 0x526f5a, 0x26372b); // Provides a fixed world-space scale reference under every species.
    grid.position.y = 0;
    scene.add(grid);

    const root = new THREE.Group(); // Rotated by pointer drag so the front/back character textures can be inspected in 3D.
    root.name = 'OnboardingCharacterPreviewRoot';
    scene.add(root);

    const sceneState = { // Stored globally so rerenders and profile changes can replace only the avatar contents.
      THREE, renderer, scene, camera, root, canvas,
      avatarGroup: null, model: null, feet: null,
      running: true, yaw: -0.18, pointer: null,
      lastWidth: 0, lastHeight: 0,
    };

    canvas.addEventListener('pointerdown', event => {
      sceneState.pointer = { id: event.pointerId, x: event.clientX, yaw: sceneState.yaw }; // Used to turn drag distance into a stable yaw without accumulating pointer jitter.
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    });
    canvas.addEventListener('pointermove', event => {
      const pointer = sceneState.pointer; // Reads the active drag gesture for desktop and mobile rotation.
      if (!pointer || pointer.id !== event.pointerId) return;
      sceneState.yaw = pointer.yaw + (event.clientX - pointer.x) * 0.012;
    });
    const endPointer = event => {
      if (sceneState.pointer?.id === event.pointerId) sceneState.pointer = null;
    }; // Clears drag state on either a normal release or a browser-cancelled touch gesture.
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    const frame = () => {
      if (!sceneState.running) return;
      if (!canvas.isConnected) {
        disposePreviewScene();
        return;
      }
      const rect = canvas.getBoundingClientRect(); // Used to keep the WebGL buffer in sync with responsive CSS dimensions.
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      if (width !== sceneState.lastWidth || height !== sceneState.lastHeight) {
        sceneState.lastWidth = width;
        sceneState.lastHeight = height;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      root.rotation.y = sceneState.yaw;
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }; // Owns the lightweight creator-only render loop.
    requestAnimationFrame(frame);
    return sceneState;
  }

  function ensurePreviewShell(overlay) {
    const left = overlay.querySelector('.ob-col-left'); // Replaces only the visual preview portion; the hidden core canvas remains its rendering source.
    const sourceCanvas = left?.querySelector('#ob-portrait-canvas'); // Kept alive so the original onboarding renderer does not need to be rewritten.
    if (!left || !sourceCanvas) return null;

    let shell = left.querySelector('.ob-3d-shell'); // Reused within one core render to avoid repeatedly constructing a WebGL context.
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'ob-3d-shell';
      shell.innerHTML = '<canvas class="ob-3d-canvas" aria-label="To-scale 3D preview of your in-game character"></canvas><div class="ob-3d-scale-label">Runtime scale · drag to rotate</div>';
      sourceCanvas.after(shell);
      const oldHint = left.querySelector('.ob-preview-hint'); // Replaced with a more specific 3D/runtime-scale hint.
      if (oldHint) oldHint.textContent = 'To-scale in-game preview';
      const debug = document.createElement('div'); // Always-visible compact status replaces console-only preview diagnostics.
      debug.className = 'ob-3d-status';
      debug.textContent = '3D preview: preparing…';
      shell.after(debug);
    }

    const canvas = shell.querySelector('.ob-3d-canvas'); // Becomes the WebGL render target for this creator DOM generation.
    if (!canvas) return sourceCanvas;
    if (!previewScene || previewScene.canvas !== canvas) {
      disposePreviewScene();
      try {
        previewScene = makePreviewScene(canvas);
      } catch (error) {
        status.preview = 'error';
        status.lastError = error?.message || String(error);
        setPreviewStatus(`3D preview unavailable: ${status.lastError}`, true);
      }
    }
    return sourceCanvas;
  }

  function runtimeScaleFor(speciesId, gender) {
    const apiScale = window.HobunjiCharacterRigScale?.scaleFor?.(speciesId, gender); // Preferred authored scale API used by live characters.
    if (apiScale) return apiScale;
    return window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(speciesId, gender) || { x: 1, y: 1, head: 1, offsetY: 0 }; // Fallback keeps the preview proportional if the runtime bridge finishes loading a moment later.
  }

  function clearAvatarFromPreview(sceneState) {
    if (!sceneState) return;
    try { sceneState.feet?.dispose?.(); } catch (_) {}
    try { window.PNGPlaneAvatar?.disposeAvatarModel?.(sceneState.model); } catch (_) {}
    try { sceneState.avatarGroup?.parent?.remove?.(sceneState.avatarGroup); } catch (_) {}
    sceneState.avatarGroup = null;
    sceneState.model = null;
    sceneState.feet = null;
  }

  async function buildRuntimeAvatar(frontCanvas, profile, buildGeneration) {
    const overlay = creatorOverlay(); // Ensures an async build never writes into the save-select screen or a destroyed creator render.
    if (!overlay || !frontCanvas?.isConnected || buildGeneration !== previewBuildGeneration) return;
    const sourceCanvas = ensurePreviewShell(overlay); // Ensures the current creator DOM owns an active WebGL scene.
    const sceneState = previewScene; // Snapshot guards against a subsequent rerender replacing the scene while textures are rendering.
    if (!sceneState || !sourceCanvas) return;
    if (!window.NpcAvatarPreview?.renderProfileToCanvas || !window.PNGPlaneAvatar?.buildSinglePlaneAvatarModel) {
      throw new Error('Runtime avatar preview helpers are unavailable.');
    }

    const identity = identityFromProfile(profile, overlay); // Supplies the exact selected species/gender to every runtime rig component.
    if (!identity.speciesId) throw new Error('Could not resolve the selected species.');
    const portraitSize = Math.max(64, Number(frontCanvas.width) || 200); // Keeps rear/head texture resolution matched to the core front canvas.
    const backCanvas = Object.assign(document.createElement('canvas'), { width: portraitSize, height: portraitSize }); // Supplies the actual rear texture when the player drags the preview around.
    const headCanvas = Object.assign(document.createElement('canvas'), { width: portraitSize, height: portraitSize }); // Supplies head-only alpha for the same neck/head rig used by gameplay.
    await window.NpcAvatarPreview.renderProfileToCanvas(backCanvas, profile, { portraitView: 'behind', forceEyesOpen: true });
    await window.NpcAvatarPreview.renderProfileToCanvas(headCanvas, profile, { onlyHeadSprite: true, forceEyesOpen: true });
    if (buildGeneration !== previewBuildGeneration || previewScene !== sceneState || !sceneState.canvas.isConnected) return;

    clearAvatarFromPreview(sceneState);
    const THREE = sceneState.THREE; // Used for the floor-relative parent shared by portrait, feet, hands, and whole-character scaling.
    const group = new THREE.Group();
    group.name = `OnboardingPlayerPreview_${identity.speciesId}_${identity.gender}`;
    const avatarCfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {}; // Provides the exact gameplay model-width baseline.
    const baseWidth = Number(avatarCfg.worldModelWidth) > 0 ? Number(avatarCfg.worldModelWidth) : 0.9; // Passed unchanged to PNGPlaneAvatar before authored species scaling.
    const model = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE, frontCanvas, {
      backCanvas,
      headCanvas,
      neckRig: true,
      profile,
      appearance: { speciesId: identity.speciesId, gender: identity.gender },
      speciesId: identity.speciesId,
      gender: identity.gender,
      modelWidth: baseWidth,
      modelHeight: baseWidth,
      name: `${group.name}_portrait`,
      userData: { source: 'onboarding-character-creator', nonInteractive: true },
    }); // Reuses the same PNG-plane avatar constructor as gameplay rather than a presentation-only model.
    model.userData.proceduralHandParent = group;
    model.userData.rigAvatarProfile = profile;
    group.add(model);

    const modelHeight = Number(model.userData.portraitModelHeight) || baseWidth; // Used to floor-anchor the portrait and configure procedural feet.
    const modelWidth = Number(model.userData.portraitModelWidth) || baseWidth; // Used by the same hand/foot positioning contract as runtime walkers.
    model.position.y = modelHeight / 2;
    const feet = window.ProceduralLegAnimation?.attach?.(THREE, group, {
      speciesId: identity.speciesId,
      gender: identity.gender,
      bodyColors: profile?.bodyColors,
      modelWidth,
      modelHeight,
      handAttachY: model.userData.handAttachY,
      name: `${group.name}_feet`,
      profile,
      portraitSize,
    }) || null; // Uses the normal procedural foot rig so the preview reflects full in-game stature, not just the portrait plane.
    feet?.update?.(0, 0, false, null);

    sceneState.root.add(group);
    const scale = runtimeScaleFor(identity.speciesId, identity.gender); // Captures canonical authored body/head proportions for both application and diagnostics.
    if (window.HobunjiCharacterRigScale?.applyToParent) {
      window.HobunjiCharacterRigScale.applyToParent(group, identity.speciesId, identity.gender, scale, 0);
    } else {
      group.scale.set(Number(scale.x) || 1, Number(scale.y) || 1, 1);
    }
    window.ProceduralHandFrameDriver?.syncNow?.();

    sceneState.avatarGroup = group;
    sceneState.model = model;
    sceneState.feet = feet;
    status.preview = 'ready';
    status.speciesId = identity.speciesId;
    status.gender = identity.gender;
    status.scale = { x: Number(scale.x) || 1, y: Number(scale.y) || 1 };
    status.lastError = null;
    setPreviewStatus(`3D preview: ready · ${LORE[identity.speciesId]?.label || identity.speciesId} ${identity.gender} · scale ${status.scale.x.toFixed(3)}×${status.scale.y.toFixed(3)}`);
  }

  function queueRuntimeAvatar(frontCanvas, profile) {
    latestFrontCanvas = frontCanvas; // Reused after DOM-only workflow enhancements that do not change appearance.
    latestProfile = profile; // Reused after the creator core rerenders its left column.
    const generation = ++previewBuildGeneration; // Marks every older asynchronous back/head texture build as stale.
    status.preview = 'building';
    setPreviewStatus('3D preview: building runtime avatar…');
    lastRenderPromise = lastRenderPromise
      .catch(() => {})
      .then(() => buildRuntimeAvatar(frontCanvas, profile, generation))
      .catch(error => {
        if (generation !== previewBuildGeneration) return;
        status.preview = 'error';
        status.lastError = error?.message || String(error);
        setPreviewStatus(`3D preview unavailable: ${status.lastError}`, true);
        console.warn('[onboarding-3d] preview build failed', error);
      });
  }

  function wrapPortraitRenderer(name) {
    const original = window[name]; // Captures the existing Scratchbones portrait renderer used by onboarding-core.js.
    if (typeof original !== 'function' || original.__hobunjiOnboarding3dWrapped) return;
    const wrapped = function (...args) {
      const [canvas, profile] = args; // Used after the original render completes to build the same profile into the runtime 3D rig.
      const result = original.apply(this, args);
      if (canvas?.id !== 'ob-portrait-canvas') return result;
      return Promise.resolve(result).then(value => {
        queueRuntimeAvatar(canvas, profile);
        return value;
      });
    };
    Object.assign(wrapped, original);
    wrapped.__hobunjiOnboarding3dWrapped = true;
    window[name] = wrapped;
  }

  function enhanceCreator() {
    enhanceQueued = false;
    const overlay = creatorOverlay(); // A null result means save-select or no onboarding is currently visible.
    if (!overlay) {
      if (previewScene?.canvas && !previewScene.canvas.isConnected) disposePreviewScene();
      return;
    }
    installStyle();
    ensurePreviewShell(overlay); // Installs the 3D viewport while retaining the hidden core canvas as the source texture.
    enhanceSpeciesWorkflow(overlay);
  }

  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    queueMicrotask(enhanceCreator);
  }

  function installObserver() {
    if (observer) return;
    observer = new MutationObserver(queueEnhance); // Reapplies enhancements after every legacy core innerHTML replacement.
    observer.observe(document.body, { childList: true, subtree: true });
    queueEnhance();
  }

  function installOnboardingInitHook() {
    const api = window.HobunjiOnboarding; // Core onboarding API remains the owner of state, saves, creation, and completion.
    if (!api?.init || api.init.__hobunjiCharacterCreatorRedesignWrapped) return false;
    const originalInit = api.init.bind(api); // Used so the redesign only adds UI behavior around the existing initialization path.
    const wrappedInit = function (...args) {
      installObserver();
      const result = originalInit(...args);
      queueEnhance();
      return result;
    };
    wrappedInit.__hobunjiCharacterCreatorRedesignWrapped = true;
    api.init = wrappedInit;
    return true;
  }

  function install() {
    installStyle();
    wrapPortraitRenderer('renderPortraitProfile');
    wrapPortraitRenderer('renderProfile');
    installObserver();
    if (!installOnboardingInitHook()) {
      let attempts = 0; // Bounds the late-core retry so a malformed page cannot poll forever.
      const timer = setInterval(() => {
        wrapPortraitRenderer('renderPortraitProfile');
        wrapPortraitRenderer('renderProfile');
        if (installOnboardingInitHook() || ++attempts >= 200) clearInterval(timer);
      }, 50); // Covers unusual script-loading order while staying inert once the core API exists.
    }
  }

  window[REDESIGN_ID] = Object.freeze({ install, lore: LORE, status });
  install();
})();
