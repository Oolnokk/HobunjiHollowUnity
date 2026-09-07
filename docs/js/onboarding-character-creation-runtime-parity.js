// Character-creation follow-up parity: gameplay lighting, visible loading state, and randomized body colors.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingCharacterCreationRuntimeParity'; // Used to prevent duplicate installation if the bootstrap is evaluated twice.
  if (window[PATCH_ID]) return;

  const GAME_LIGHTING = Object.freeze({ // Used to mirror buildZoneScene's outdoor light rig inside the creator preview scene.
    ambientColor: 0xfff0e0,
    ambientIntensity: 0.7,
    sunColor: 0xffeedd,
    sunIntensity: 1.1,
    sunPosition: Object.freeze([4, 8, 2]),
  });

  let observer = null; // Watches creator DOM replacements so loading/randomization behavior survives onboarding rerenders.
  let lastSpecies = null; // Tracks the last concrete selected species so body colors reroll only on actual species changes.
  let syncQueued = false; // Coalesces many DOM mutations into one creator synchronization pass.

  function normalizeSpecies(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-'); // Used to compare internal species IDs across rerenders.
    return raw;
  }

  function creatorOverlay() {
    const overlay = document.getElementById('ob-overlay'); // Used to distinguish character creation from save-select and gameplay.
    return overlay?.querySelector('#ob-portrait-canvas') ? overlay : null;
  }

  function activeSpecies(overlay) {
    const active = overlay?.querySelector('[data-ob-species].ob-active'); // Reads the core's actual selected species; Slagothim-family-only state intentionally returns null until a subspecies is chosen.
    return normalizeSpecies(active?.dataset?.obSpecies || '');
  }

  function speciesLabel(speciesId) {
    const labels = { 'mao-ao': "Mao'ao", tletingan: 'Tletingan', mashtzarr: 'Mashtzarr', kenkari: 'Kenkari', 'engh-sho': 'Engh-sho' }; // Used by the visible loading overlay while the runtime avatar is being built.
    return labels[speciesId] || 'character';
  }

  function randomIndex(length) {
    return length > 0 ? Math.floor(Math.random() * length) : -1; // Used to pick one valid body-color swatch without manufacturing colors outside the authored palette.
  }

  function randomizeBodyColors(overlay, speciesId) {
    const primary = [...(overlay?.querySelectorAll('[data-ob-a]') || [])]; // Uses the existing primary-color buttons so the core remains the single owner of appearance state.
    const secondary = [...(overlay?.querySelectorAll('[data-ob-b]') || [])]; // Uses the existing secondary-color buttons so preview/save behavior stays unchanged.
    if (!primary.length || !secondary.length || activeSpecies(overlay) !== speciesId) return false;

    const primaryIndex = randomIndex(primary.length); // Used below to trigger the selected authored primary color.
    let secondaryIndex = randomIndex(secondary.length); // Used below to trigger the selected authored secondary color.
    if (secondary.length > 1 && secondaryIndex === primaryIndex) secondaryIndex = (secondaryIndex + 1) % secondary.length;
    primary[primaryIndex]?.click();
    secondary[secondaryIndex]?.click();
    return true;
  }

  function ensureLoadingOverlay(overlay) {
    const shell = overlay?.querySelector('.ob-3d-shell'); // Hosts the visible loading/error message directly over the 3D viewport.
    if (!shell) return null;
    let loading = shell.querySelector('.ob-3d-loading'); // Reused while the same creator DOM generation remains mounted.
    if (!loading) {
      loading = document.createElement('div');
      loading.className = 'ob-3d-loading';
      loading.innerHTML = '<div class="ob-3d-loading-spinner" aria-hidden="true"></div><div class="ob-3d-loading-text">Loading character…</div>';
      shell.appendChild(loading);
    }
    return loading;
  }

  function syncLoadingState(overlay) {
    const loading = ensureLoadingOverlay(overlay); // Receives the current status every time the core/redesign changes the creator DOM.
    if (!loading) return;
    const redesignStatus = window.HOBUNJI_ONBOARDING_REDESIGN_STATUS || {}; // Supplies the preview build state without requiring console access.
    const statusLine = overlay.querySelector('.ob-3d-status')?.textContent || ''; // Provides a DOM fallback if status updates happen before this patch sees the shared object.
    const speciesId = activeSpecies(overlay) || normalizeSpecies(redesignStatus.speciesId); // Used to name the thing currently loading.
    const loadingText = loading.querySelector('.ob-3d-loading-text'); // Updated below for loading and failure states.
    const ready = redesignStatus.preview === 'ready' || /3D preview:\s*ready/i.test(statusLine); // Hides the overlay only after a runtime avatar is actually ready.
    const failed = redesignStatus.preview === 'error' || /3D preview unavailable/i.test(statusLine); // Keeps failures visible inside the viewport instead of leaving it apparently blank.

    loading.classList.toggle('ob-ready', ready);
    loading.classList.toggle('ob-error', failed);
    if (loadingText) {
      loadingText.textContent = failed
        ? `Preview failed to load${redesignStatus.lastError ? `: ${redesignStatus.lastError}` : '.'}`
        : `Loading ${speciesLabel(speciesId)} preview…`;
    }
  }

  function installStyle() {
    if (document.getElementById(`${PATCH_ID}Style`)) return;
    const style = document.createElement('style'); // Adds only the follow-up loading presentation; existing creator layout remains owned by the redesign module.
    style.id = `${PATCH_ID}Style`;
    style.textContent = `
#ob-overlay .ob-3d-loading{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:24px;box-sizing:border-box;background:rgba(3,9,7,.72);color:#d8ead8;text-align:center;font:10px/1.4 'DM Mono',ui-monospace,monospace;pointer-events:none;transition:opacity .16s ease}
#ob-overlay .ob-3d-loading.ob-ready{opacity:0;visibility:hidden}
#ob-overlay .ob-3d-loading.ob-error{color:#ffb59e;background:rgba(20,5,3,.78)}
#ob-overlay .ob-3d-loading-spinner{width:20px;height:20px;border:2px solid rgba(249,226,138,.18);border-top-color:#f9e28a;border-radius:50%;animation:obRuntimePreviewSpin .8s linear infinite}
#ob-overlay .ob-3d-loading.ob-error .ob-3d-loading-spinner{display:none}
@keyframes obRuntimePreviewSpin{to{transform:rotate(360deg)}}
`;
    document.head.appendChild(style);
  }

  function installGameplayLightingParity() {
    const THREE = window.THREE; // Uses the exact Three.js instance already powering the live game and onboarding preview.
    const rendererProto = THREE?.WebGLRenderer?.prototype; // Wrapped once so only the named onboarding scene gets corrected at render time.
    if (!rendererProto?.render || rendererProto.render.__hobunjiOnboardingGameplayLightingParity) return;
    const originalRender = rendererProto.render; // Preserved so every non-onboarding render path remains byte-for-byte behaviorally unchanged.

    const wrappedRender = function (scene, camera) {
      const previewRoot = scene?.getObjectByName?.('OnboardingCharacterPreviewRoot'); // Identifies only the character-creator scene created by the redesign module.
      if (previewRoot && !scene.userData?.hobunjiOnboardingGameplayLightingParity) {
        const oldLights = [...(scene.children || [])].filter(node => node?.isHemisphereLight || node?.isAmbientLight || node?.isDirectionalLight); // Removes the redesign's neutral studio lights before adding the game's actual outdoor pair.
        for (const light of oldLights) scene.remove(light);
        const ambient = new THREE.AmbientLight(GAME_LIGHTING.ambientColor, GAME_LIGHTING.ambientIntensity); // Matches buildZoneScene's ambient light exactly.
        const sun = new THREE.DirectionalLight(GAME_LIGHTING.sunColor, GAME_LIGHTING.sunIntensity); // Matches buildZoneScene's directional light exactly.
        sun.position.set(...GAME_LIGHTING.sunPosition);
        scene.add(ambient);
        scene.add(sun);
        scene.userData ||= {};
        scene.userData.hobunjiOnboardingGameplayLightingParity = {
          source: 'game.buildZoneScene',
          ambient: [GAME_LIGHTING.ambientColor, GAME_LIGHTING.ambientIntensity],
          sun: [GAME_LIGHTING.sunColor, GAME_LIGHTING.sunIntensity, ...GAME_LIGHTING.sunPosition],
        }; // Mobile-friendly proof that the creator scene received the gameplay light rig.
        if (window.HOBUNJI_ONBOARDING_REDESIGN_STATUS) window.HOBUNJI_ONBOARDING_REDESIGN_STATUS.lighting = 'game.buildZoneScene';
      }
      return originalRender.call(this, scene, camera);
    };
    wrappedRender.__hobunjiOnboardingGameplayLightingParity = true;
    rendererProto.render = wrappedRender;
  }

  function syncCreator() {
    syncQueued = false;
    installGameplayLightingParity();
    const overlay = creatorOverlay(); // Null means the player is on save-select or gameplay, so the next creator should reroll its initial Mao'ao colors again.
    if (!overlay) {
      lastSpecies = null;
      return;
    }

    syncLoadingState(overlay);
    const speciesId = activeSpecies(overlay); // Concrete species changes drive randomization; merely opening the Slagothim family step does not.
    if (!speciesId || speciesId === lastSpecies) return;
    lastSpecies = speciesId;
    queueMicrotask(() => {
      const currentOverlay = creatorOverlay(); // Rechecks the current DOM after the core has finished the species rerender.
      if (!currentOverlay || activeSpecies(currentOverlay) !== speciesId) return;
      randomizeBodyColors(currentOverlay, speciesId);
      syncLoadingState(currentOverlay);
    });
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncCreator);
  }

  function installObserver() {
    if (observer) return;
    observer = new MutationObserver(queueSync); // Watches both core innerHTML replacements and 3D-status text updates.
    observer.observe(document.body, { childList: true, subtree: true });
    queueSync();
  }

  function install() {
    installStyle();
    installGameplayLightingParity();
    installObserver();
  }

  window[PATCH_ID] = Object.freeze({ install, gameLighting: GAME_LIGHTING });
  install();
})();
