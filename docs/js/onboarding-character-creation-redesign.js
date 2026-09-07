// Hobunji Hollow — character-creation workflow redesign.
// onboarding-core.js remains authoritative for save/profile state; this module owns creator presentation.
(() => {
  'use strict';

  const REDESIGN_ID = 'hobunjiOnboardingCharacterCreationRedesign'; // Prevents duplicate installation.
  if (window[REDESIGN_ID]) return;

  const LORE = Object.freeze({
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

  const KASA_RANDOM_DYE_IDS = new Set([
    'dye:CLOTH:brown',
    'dye:CLOTH:dusty_yellow',
    'dye:CLOTH:dusty_orange',
  ]); // Restricts generated ordinary Kasa outfits without removing any manual dye choices.

  const status = {
    installed: true,
    preview: 'idle',
    speciesId: null,
    gender: null,
    scale: null,
    lighting: 'game.buildZoneScene',
    materials: 'runtime HobunjiSpritePngSurface / MeshBasicMaterial',
    rendererOutput: 'runtime r128 LinearEncoding',
    shellOutline: 'runtime layer-1 shell',
    randomizedIdentity: null,
    lastError: null,
  }; // Mobile-visible diagnostics for the creator.
  window.HOBUNJI_ONBOARDING_REDESIGN_STATUS = status;

  let familyOpen = false; // Tracks whether the Slagothim/Tletingan second step is visible.
  let previewScene = null; // Current creator-only Three.js scene.
  let previewBuildGeneration = 0; // Invalidates stale async avatar builds.
  let lastRenderPromise = Promise.resolve(); // Serializes rear/head portrait rendering.
  let bodyObserver = null; // Watches only for the onboarding overlay being mounted/unmounted.
  let overlayObserver = null; // Watches only direct overlay-card replacement performed by onboarding-core.
  let observedOverlay = null; // Overlay currently owned by overlayObserver.
  let enhanceQueued = false; // Coalesces core rerenders into one enhancement pass.
  let lastRandomizedIdentity = null; // Species+gender key most recently given a generated look.
  let randomizingLook = false; // Prevents the synchronous Collections transaction from re-entering itself.

  function normalizeSpecies(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
    return raw === 'rakakoan' ? 'kenkari' : raw === 'ghoul' ? 'mao-ao' : raw;
  }

  function normalizeGender(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  }

  function overlayElement() {
    return document.getElementById('ob-overlay');
  }

  function creatorOverlay() {
    const overlay = overlayElement();
    return overlay?.querySelector('#ob-portrait-canvas') ? overlay : null;
  }

  function activeCoreSpecies(overlay = creatorOverlay()) {
    const active = overlay?.querySelector('[data-ob-species].ob-active');
    return normalizeSpecies(active?.dataset?.obSpecies || '');
  }

  function activeCoreGender(overlay = creatorOverlay()) {
    const active = overlay?.querySelector('[data-ob-gender].ob-active');
    return normalizeGender(active?.dataset?.obGender || 'male');
  }

  function identityFromProfile(profile, overlay = creatorOverlay()) {
    const fighter = profile?.fighter || {};
    const appearance = profile?.appearance || {};
    const speciesId = normalizeSpecies(
      profile?.speciesId || profile?.species || fighter?.speciesId || fighter?.species || appearance?.speciesId || activeCoreSpecies(overlay),
    );
    const gender = normalizeGender(profile?.gender || fighter?.gender || appearance?.gender || activeCoreGender(overlay));
    return { speciesId, gender };
  }

  function installStyle() {
    if (document.getElementById(`${REDESIGN_ID}Style`)) return;
    const style = document.createElement('style');
    style.id = `${REDESIGN_ID}Style`;
    style.textContent = `
#ob-overlay .ob-col-left{position:relative;min-width:220px}
#ob-overlay #ob-portrait-canvas.ob-portrait{position:absolute!important;left:-10000px!important;top:-10000px!important;width:200px!important;height:200px!important;opacity:0!important;pointer-events:none!important}
#ob-overlay .ob-3d-shell{position:relative;width:220px;height:300px;border:1px solid rgba(249,226,138,.18);border-radius:13px;overflow:hidden;background:radial-gradient(circle at 50% 28%,rgba(249,226,138,.07),rgba(3,9,7,.86) 70%);touch-action:none}
#ob-overlay .ob-3d-canvas{display:block;width:100%;height:100%;touch-action:none}
#ob-overlay .ob-3d-scale-label{position:absolute;left:8px;top:8px;z-index:2;padding:4px 6px;border-radius:6px;background:rgba(0,0,0,.62);border:1px solid rgba(255,255,255,.1);font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#b7ceb9;pointer-events:none}
#ob-overlay .ob-3d-loading{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:24px;box-sizing:border-box;background:rgba(3,9,7,.76);color:#d8ead8;text-align:center;font:10px/1.4 'DM Mono',ui-monospace,monospace;pointer-events:none;transition:opacity .16s ease}
#ob-overlay .ob-3d-loading.ob-ready{opacity:0;visibility:hidden}
#ob-overlay .ob-3d-loading.ob-error{color:#ffb59e;background:rgba(20,5,3,.82)}
#ob-overlay .ob-3d-loading-spinner{width:20px;height:20px;border:2px solid rgba(249,226,138,.18);border-top-color:#f9e28a;border-radius:50%;animation:obRuntimePreviewSpin .8s linear infinite}
#ob-overlay .ob-3d-loading.ob-error .ob-3d-loading-spinner{display:none}
@keyframes obRuntimePreviewSpin{to{transform:rotate(360deg)}}
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
    return entry ? `<div class="ob-species-description"><strong>${entry.label}</strong>${entry.text}</div>` : '';
  }

  function speciesGroup(overlay) {
    const tletinganButton = overlay?.querySelector('[data-ob-species="tletingan"]');
    return tletinganButton?.closest?.('.ob-group') || null;
  }

  function renderSpeciesDetails(overlay, group, tletinganButton) {
    group.parentElement?.querySelector('[data-ob-redesign-details="1"]')?.remove();
    const currentSpecies = activeCoreSpecies(overlay);
    const tletinganActive = currentSpecies === 'tletingan' || !!tletinganButton?.classList.contains('ob-active');
    if (tletinganActive) familyOpen = true;

    const familyButton = group.querySelector('[data-ob-family="slagothim"]');
    const showFamily = familyOpen || tletinganActive;
    familyButton?.classList.toggle('ob-active', showFamily);

    const details = document.createElement('div');
    details.dataset.obRedesignDetails = '1';

    if (!showFamily) {
      details.innerHTML = speciesDescriptionHtml(LORE[currentSpecies]);
      group.after(details);
      return;
    }

    details.innerHTML = speciesDescriptionHtml(LORE.slagothim);
    const subspecies = document.createElement('div');
    subspecies.className = 'ob-subspecies-wrap';
    subspecies.innerHTML = `
      <div class="ob-subspecies-title">Slagothim subspecies</div>
      <div class="ob-subspecies-group">
        <button type="button" class="ob-sel-btn${tletinganActive ? ' ob-active' : ''}" data-ob-subspecies="tletingan">Tletingan</button>
        <button type="button" class="ob-sel-btn ob-disabled ob-subspecies-unavailable" data-ob-subspecies="nuhongan" disabled>Nuhongan</button>
        <button type="button" class="ob-sel-btn ob-disabled ob-subspecies-unavailable" data-ob-subspecies="longoran" disabled>Longoran</button>
      </div>
      <div class="ob-subspecies-description"><strong>${LORE.tletingan.label}:</strong> ${LORE.tletingan.text}</div>`;
    details.appendChild(subspecies);
    group.after(details);

    subspecies.querySelector('[data-ob-subspecies="tletingan"]')?.addEventListener('click', () => {
      familyOpen = true;
      tletinganButton?.click();
    });
  }

  function enhanceSpeciesWorkflow(overlay) {
    const group = speciesGroup(overlay);
    if (!group) return;
    const tletinganButton = group.querySelector('[data-ob-species="tletingan"]');
    if (!tletinganButton) return;

    tletinganButton.hidden = true;
    if (tletinganButton.classList.contains('ob-active')) familyOpen = true;

    const maoButton = group.querySelector('[data-ob-species="mao-ao"]');
    if (maoButton) maoButton.textContent = "Mao'ao";

    let familyButton = group.querySelector('[data-ob-family="slagothim"]');
    if (!familyButton) {
      familyButton = document.createElement('button');
      familyButton.type = 'button';
      familyButton.className = 'ob-sel-btn ob-family-btn';
      familyButton.dataset.obFamily = 'slagothim';
      familyButton.textContent = 'Slagothim';
      tletinganButton.before(familyButton);
      familyButton.addEventListener('click', () => {
        familyOpen = true;
        tletinganButton.click(); // Slagothim's first/current available subspecies is Tletingan; core owns the real state change.
      });
    }

    group.querySelectorAll('[data-ob-species]').forEach(button => {
      if (button.dataset.obRedesignBound === '1') return;
      button.dataset.obRedesignBound = '1';
      button.addEventListener('click', () => {
        if (button.dataset.obSpecies !== 'tletingan') familyOpen = false;
      }, true);
    });

    renderSpeciesDetails(overlay, group, tletinganButton);
  }

  function randomIndex(length) {
    return length > 0 ? Math.floor(Math.random() * length) : -1;
  }

  function chooseRandom(array) {
    return array.length ? array[randomIndex(array.length)] : null;
  }

  function clickRandomBodyColors(overlay) {
    const primary = [...overlay.querySelectorAll('[data-ob-a]')];
    const secondary = [...overlay.querySelectorAll('[data-ob-b]')];
    if (!primary.length || !secondary.length) return;

    const primaryIndex = randomIndex(primary.length);
    let secondaryIndex = randomIndex(secondary.length);
    if (secondary.length > 1 && secondaryIndex === primaryIndex) secondaryIndex = (secondaryIndex + 1) % secondary.length;
    primary[primaryIndex]?.click();
    secondary[secondaryIndex]?.click();
  }

  function randomizeAppearanceCosmetics(overlay) {
    for (const select of overlay.querySelectorAll('[data-ob-slot]')) {
      if (select.disabled || !select.options.length) continue;
      const option = chooseRandom([...select.options]);
      if (!option) continue;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function kasaKindForOption(option) {
    const haystack = `${option?.value || ''} ${option?.textContent || ''}`.toLowerCase();
    if (!haystack.includes('kasa')) return null;
    if (/bowl[-_\s]?kasa|bowlkasa/.test(haystack)) return 'kenkari-bowl-kasa';
    return 'ordinary-kasa';
  }

  function randomClothingOptionAllowed(option, speciesId, gender) {
    const kind = kasaKindForOption(option);
    if (!kind) return true;
    if (gender !== 'male') return false;
    if (kind === 'kenkari-bowl-kasa') return speciesId === 'kenkari';
    return speciesId === 'tletingan' || speciesId === 'mao-ao';
  }

  function randomizeVisibleClothing(overlay, speciesId, gender) {
    const selects = [...overlay.querySelectorAll('.ob-equip-sel')].filter(select => !select.disabled);
    if (!selects.length) return { kasaSelected: false, kasaKind: null };

    let choseClothing = false;
    const forceable = [];
    for (const select of selects) {
      const allowed = [...select.options].filter(option => randomClothingOptionAllowed(option, speciesId, gender));
      const nonEmpty = allowed.filter(option => option.value);
      if (nonEmpty.length) forceable.push({ select, nonEmpty });
      if (!allowed.length) continue;

      const category = select.dataset.obEquipCat;
      const pool = category === 'torso' && nonEmpty.length ? nonEmpty : allowed;
      const chosen = chooseRandom(pool);
      select.value = chosen?.value || '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      if (select.value) choseClothing = true;
    }

    if (!choseClothing && forceable.length) {
      const forced = chooseRandom(forceable);
      const option = chooseRandom(forced.nonEmpty);
      forced.select.value = option.value;
      forced.select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const selectedHat = overlay.querySelector('.ob-equip-sel[data-ob-equip-cat="hat"]')?.selectedOptions?.[0] || null;
    const kasaKind = kasaKindForOption(selectedHat);
    return { kasaSelected: !!kasaKind, kasaKind };
  }

  function kasaRandomDyeButtonAllowed(button) {
    const id = button?.dataset?.obClothDyeA || button?.dataset?.obClothDyeB || '';
    if (KASA_RANDOM_DYE_IDS.has(id)) return true;
    const label = String(button?.title || '').trim().toLowerCase();
    return label === 'brown' || label === 'dusty yellow' || label === 'dusty orange';
  }

  function clickRandomDye(attributeName, kasaRestricted = false) {
    const overlay = creatorOverlay();
    const buttons = overlay ? [...overlay.querySelectorAll(`[${attributeName}]`)] : [];
    if (!buttons.length) return;
    const pool = kasaRestricted ? buttons.filter(kasaRandomDyeButtonAllowed) : buttons;
    chooseRandom(pool)?.click(); // Empty restricted pool means leave the current dye instead of violating the ordinary-Kasa palette rule.
  }

  function randomizeCreationLook(overlay, speciesId, gender) {
    const identityKey = `${speciesId}::${gender}`;
    if (randomizingLook || !speciesId || identityKey === lastRandomizedIdentity) return;
    randomizingLook = true;
    lastRandomizedIdentity = identityKey; // Set before synthetic rerenders so observer callbacks cannot repeat the transaction.
    status.randomizedIdentity = identityKey;

    try {
      clickRandomBodyColors(overlay);
      randomizeAppearanceCosmetics(overlay);

      const collectionsTab = overlay.querySelector('[data-ob-tab="collections"]');
      collectionsTab?.click(); // Core rerenders synchronously; all following queries intentionally reacquire the current DOM.
      let current = creatorOverlay();
      const clothingRoll = current ? randomizeVisibleClothing(current, speciesId, gender) : { kasaSelected: false, kasaKind: null };
      const restrictOrdinaryKasaDyes = clothingRoll.kasaKind === 'ordinary-kasa' && (speciesId === 'tletingan' || speciesId === 'mao-ao');

      clickRandomDye('data-ob-cloth-dye-a', restrictOrdinaryKasaDyes);
      clickRandomDye('data-ob-cloth-dye-b', restrictOrdinaryKasaDyes);

      current = creatorOverlay();
      current?.querySelector('[data-ob-tab="appearance"]')?.click();
    } finally {
      randomizingLook = false;
    }
  }

  function setPreviewStatus(text, isError = false) {
    const node = creatorOverlay()?.querySelector('.ob-3d-status');
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('ob-error', isError);
  }

  function setPreviewLoading(text, state = 'loading') {
    const loading = creatorOverlay()?.querySelector('.ob-3d-loading');
    if (!loading) return;
    const label = loading.querySelector('.ob-3d-loading-text');
    if (label) label.textContent = text;
    loading.classList.toggle('ob-ready', state === 'ready');
    loading.classList.toggle('ob-error', state === 'error');
  }

  function makeRuntimeShellOutlineMaterial(THREE) {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uThickness: { value: 0.006 } },
      ]),
      vertexShader: `
        uniform float uThickness;
        varying float vFogDepth;
        void main() {
          #ifdef USE_INSTANCING
            mat4 mvMatrix = modelViewMatrix * instanceMatrix;
            vec3 viewNormal = normalize(mat3(mvMatrix) * normal);
          #else
            mat4 mvMatrix = modelViewMatrix;
            vec3 viewNormal = normalize(normalMatrix * normal);
          #endif
          vec4 viewPos = mvMatrix * vec4(position, 1.0);
          vec4 clip = projectionMatrix * viewPos;
          vec4 clipN = projectionMatrix * (viewPos + vec4(viewNormal, 0.0));
          vec2 dir = clipN.xy / clipN.w - clip.xy / clip.w;
          float len = length(dir);
          dir = (len > 1e-5) ? dir / len : vec2(0.0, 0.0);
          clip.xy += dir * uThickness * clip.w;
          gl_Position = clip;
          vFogDepth = -viewPos.z;
        }
      `,
      fragmentShader: `
        uniform vec3 fogColor;
        #ifdef FOG_EXP2
          uniform float fogDensity;
        #else
          uniform float fogNear;
          uniform float fogFar;
        #endif
        varying float vFogDepth;
        void main() {
          vec3 outlineColor = vec3(0.0);
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
            outlineColor = mix(outlineColor, fogColor, fogFactor);
          #endif
          gl_FragColor = vec4(outlineColor, 1.0);
        }
      `,
      depthWrite: false,
      depthFunc: THREE.LessDepth,
    });
  }

  function disposePreviewScene() {
    const sceneState = previewScene;
    previewScene = null;
    if (!sceneState) return;
    sceneState.running = false;
    try { sceneState.feet?.dispose?.(); } catch (_) {}
    try { window.PNGPlaneAvatar?.disposeAvatarModel?.(sceneState.model); } catch (_) {}
    try { sceneState.avatarGroup?.parent?.remove?.(sceneState.avatarGroup); } catch (_) {}
    try { sceneState.shellOutlineMaterial?.dispose?.(); } catch (_) {}
    try { sceneState.renderer?.dispose?.(); } catch (_) {}
  }

  function renderPreviewFrame(sceneState) {
    const { renderer, scene, camera, shellOutlineMaterial } = sceneState;
    const baseMask = camera.layers.mask;
    renderer.render(scene, camera);

    const previousOverride = scene.overrideMaterial;
    const previousAutoClearColor = renderer.autoClearColor;
    const previousAutoClearDepth = renderer.autoClearDepth;
    try {
      renderer.autoClearColor = false;
      renderer.autoClearDepth = false;
      scene.overrideMaterial = shellOutlineMaterial;
      camera.layers.set(1);
      renderer.render(scene, camera);
    } finally {
      camera.layers.mask = baseMask;
      scene.overrideMaterial = previousOverride;
      renderer.autoClearColor = previousAutoClearColor;
      renderer.autoClearDepth = previousAutoClearDepth;
    }
  }

  function makePreviewScene(canvas) {
    const THREE = window.THREE;
    if (!THREE?.WebGLRenderer) throw new Error('Three.js runtime is unavailable.');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ('outputEncoding' in renderer && THREE.LinearEncoding !== undefined) renderer.outputEncoding = THREE.LinearEncoding; // Runtime r128 leaves outputEncoding at its LinearEncoding default; the old sRGB override gamma-washed the unlit PNG planes.

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    camera.position.set(1.55, 1.08, 2.75);
    camera.lookAt(0, 0.53, 0);

    scene.add(new THREE.AmbientLight(0xfff0e0, 0.7));
    const sun = new THREE.DirectionalLight(0xffeedd, 1.1);
    sun.position.set(4, 8, 2);
    scene.add(sun);

    const grid = new THREE.GridHelper(4, 8, 0x526f5a, 0x26372b);
    grid.position.y = 0;
    scene.add(grid);

    const root = new THREE.Group();
    root.name = 'OnboardingCharacterPreviewRoot';
    scene.add(root);

    const sceneState = {
      THREE, renderer, scene, camera, root, canvas,
      shellOutlineMaterial: makeRuntimeShellOutlineMaterial(THREE),
      avatarGroup: null, model: null, feet: null,
      running: true, yaw: -0.18, pointer: null,
      lastWidth: 0, lastHeight: 0,
    };

    canvas.addEventListener('pointerdown', event => {
      sceneState.pointer = { id: event.pointerId, x: event.clientX, yaw: sceneState.yaw };
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    });
    canvas.addEventListener('pointermove', event => {
      const pointer = sceneState.pointer;
      if (!pointer || pointer.id !== event.pointerId) return;
      sceneState.yaw = pointer.yaw + (event.clientX - pointer.x) * 0.012;
    });
    const endPointer = event => {
      if (sceneState.pointer?.id === event.pointerId) sceneState.pointer = null;
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    const frame = () => {
      if (!sceneState.running) return;
      if (!canvas.isConnected) {
        disposePreviewScene();
        return;
      }
      const rect = canvas.getBoundingClientRect();
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
      renderPreviewFrame(sceneState);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return sceneState;
  }

  function ensurePreviewShell(overlay) {
    const left = overlay.querySelector('.ob-col-left');
    const sourceCanvas = left?.querySelector('#ob-portrait-canvas');
    if (!left || !sourceCanvas) return null;

    let shell = left.querySelector('.ob-3d-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'ob-3d-shell';
      shell.innerHTML = `
        <canvas class="ob-3d-canvas" aria-label="To-scale 3D preview of your in-game character"></canvas>
        <div class="ob-3d-scale-label">Runtime scale · drag to rotate</div>
        <div class="ob-3d-loading"><div class="ob-3d-loading-spinner" aria-hidden="true"></div><div class="ob-3d-loading-text">Loading character preview…</div></div>`;
      sourceCanvas.after(shell);
      const oldHint = left.querySelector('.ob-preview-hint');
      if (oldHint) oldHint.textContent = 'To-scale in-game preview';
      const debug = document.createElement('div');
      debug.className = 'ob-3d-status';
      debug.textContent = '3D preview: preparing…';
      shell.after(debug);
    }

    const canvas = shell.querySelector('.ob-3d-canvas');
    if (!canvas) return sourceCanvas;
    if (!previewScene || previewScene.canvas !== canvas) {
      disposePreviewScene();
      try {
        previewScene = makePreviewScene(canvas);
      } catch (error) {
        status.preview = 'error';
        status.lastError = error?.message || String(error);
        setPreviewStatus(`3D preview unavailable: ${status.lastError}`, true);
        setPreviewLoading(`Preview failed to load: ${status.lastError}`, 'error');
      }
    }
    return sourceCanvas;
  }

  function runtimeScaleFor(speciesId, gender) {
    return window.HobunjiCharacterRigScale?.scaleFor?.(speciesId, gender)
      || window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(speciesId, gender)
      || { x: 1, y: 1, head: 1, offsetY: 0 };
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
    const overlay = creatorOverlay();
    if (!overlay || !frontCanvas?.isConnected || buildGeneration !== previewBuildGeneration) return;

    const sourceCanvas = ensurePreviewShell(overlay);
    const sceneState = previewScene;
    if (!sceneState || !sourceCanvas) return;
    if (!window.NpcAvatarPreview?.renderProfileToCanvas || !window.PNGPlaneAvatar?.buildSinglePlaneAvatarModel) {
      throw new Error('Runtime avatar preview helpers are unavailable.');
    }

    const identity = identityFromProfile(profile, overlay);
    if (!identity.speciesId) throw new Error('Could not resolve the selected species.');

    const portraitSize = Math.max(64, Number(frontCanvas.width) || 200);
    const backCanvas = Object.assign(document.createElement('canvas'), { width: portraitSize, height: portraitSize });
    const headCanvas = Object.assign(document.createElement('canvas'), { width: portraitSize, height: portraitSize });
    await window.NpcAvatarPreview.renderProfileToCanvas(backCanvas, profile, { portraitView: 'behind', forceEyesOpen: true });
    await window.NpcAvatarPreview.renderProfileToCanvas(headCanvas, profile, { onlyHeadSprite: true, forceEyesOpen: true });
    if (buildGeneration !== previewBuildGeneration || previewScene !== sceneState || !sceneState.canvas.isConnected) return;

    clearAvatarFromPreview(sceneState);
    const THREE = sceneState.THREE;
    const group = new THREE.Group();
    group.name = `OnboardingPlayerPreview_${identity.speciesId}_${identity.gender}`;

    const avatarCfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
    const baseWidth = Number(avatarCfg.worldModelWidth) > 0 ? Number(avatarCfg.worldModelWidth) : 0.9;
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
    });
    model.userData.proceduralHandParent = group;
    model.userData.rigAvatarProfile = profile;
    group.add(model);

    const modelHeight = Number(model.userData.portraitModelHeight) || baseWidth;
    const modelWidth = Number(model.userData.portraitModelWidth) || baseWidth;
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
    }) || null;
    feet?.update?.(0, 0, false, null);

    sceneState.root.add(group);
    const scale = runtimeScaleFor(identity.speciesId, identity.gender);
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
    setPreviewStatus(`3D preview: ready · ${LORE[identity.speciesId]?.label || identity.speciesId} ${identity.gender} · scale ${status.scale.x.toFixed(3)}×${status.scale.y.toFixed(3)} · runtime shell`);
    setPreviewLoading('Preview ready', 'ready');
  }

  function queueRuntimeAvatar(frontCanvas, profile) {
    const generation = ++previewBuildGeneration;
    const identity = identityFromProfile(profile);
    status.preview = 'building';
    status.speciesId = identity.speciesId || status.speciesId;
    status.gender = identity.gender || status.gender;
    status.lastError = null;
    setPreviewStatus(`3D preview: loading ${LORE[identity.speciesId]?.label || identity.speciesId || 'character'}…`);
    setPreviewLoading(`Loading ${LORE[identity.speciesId]?.label || identity.speciesId || 'character'} preview…`, 'loading');

    lastRenderPromise = lastRenderPromise
      .catch(() => {})
      .then(() => buildRuntimeAvatar(frontCanvas, profile, generation))
      .catch(error => {
        if (generation !== previewBuildGeneration) return;
        status.preview = 'error';
        status.lastError = error?.message || String(error);
        setPreviewStatus(`3D preview unavailable: ${status.lastError}`, true);
        setPreviewLoading(`Preview failed to load: ${status.lastError}`, 'error');
        console.warn('[onboarding-3d] preview build failed', error);
      });
  }

  function wrapPortraitRenderer(name) {
    const original = window[name];
    if (typeof original !== 'function' || original.__hobunjiOnboarding3dWrapped) return true;
    const wrapped = function (...args) {
      const [canvas, profile] = args;
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
    return true;
  }

  function enhanceCreator() {
    enhanceQueued = false;
    let overlay = creatorOverlay();
    if (!overlay) {
      lastRandomizedIdentity = null;
      familyOpen = false;
      if (previewScene?.canvas && !previewScene.canvas.isConnected) disposePreviewScene();
      return;
    }

    const speciesId = activeCoreSpecies(overlay);
    const gender = activeCoreGender(overlay);
    randomizeCreationLook(overlay, speciesId, gender);

    overlay = creatorOverlay(); // Generated-look transaction finishes back on Appearance with a fresh core DOM.
    if (!overlay) return;
    ensurePreviewShell(overlay);
    enhanceSpeciesWorkflow(overlay);
  }

  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    queueMicrotask(enhanceCreator);
  }

  function attachOverlayObserver() {
    const overlay = overlayElement();
    if (overlay === observedOverlay) return;
    overlayObserver?.disconnect();
    observedOverlay = overlay;
    if (!overlay) return;

    overlayObserver = new MutationObserver(() => queueEnhance());
    overlayObserver.observe(overlay, { childList: true }); // Direct children only: core innerHTML replacements trigger; nested redesign changes do not.
  }

  function installObservers() {
    const start = () => {
      if (bodyObserver) return;
      bodyObserver = new MutationObserver(() => {
        attachOverlayObserver();
        queueEnhance();
      });
      bodyObserver.observe(document.body, { childList: true }); // Only detects #ob-overlay mount/unmount at body level.
      attachOverlayObserver();
      queueEnhance();
    };

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  function install() {
    installStyle();
    wrapPortraitRenderer('renderPortraitProfile');
    wrapPortraitRenderer('renderProfile');
    installObservers();

    let attempts = 0;
    const timer = setInterval(() => {
      const a = wrapPortraitRenderer('renderPortraitProfile');
      const b = wrapPortraitRenderer('renderProfile');
      if ((a && b) || ++attempts >= 200) clearInterval(timer);
    }, 50);
  }

  window[REDESIGN_ID] = Object.freeze({ install, lore: LORE, status });
  install();
})();
