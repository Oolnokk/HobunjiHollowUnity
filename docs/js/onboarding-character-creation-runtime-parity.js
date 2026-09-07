// Character-creation follow-up parity: reliable species hierarchy/lore, gameplay lighting, visible loading state, and randomized body colors.
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

  const LORE = Object.freeze({ // Used to assert the requested descriptions directly into the visible creator on every render.
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

  let observer = null; // Watches creator DOM replacements so all follow-up behavior survives onboarding rerenders.
  let lastSpecies = null; // Tracks the last concrete selected species so body colors reroll only on actual species changes.
  let slagothimOpen = false; // Tracks whether the Slagothim family step is open before/after a concrete Tletingan selection.
  let syncQueued = false; // Coalesces many DOM mutations into one creator synchronization pass.

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-'); // Used to compare internal species IDs across rerenders.
  }

  function creatorOverlay() {
    const overlay = document.getElementById('ob-overlay'); // Used to distinguish character creation from save-select and gameplay.
    return overlay?.querySelector('#ob-portrait-canvas') ? overlay : null;
  }

  function activeSpecies(overlay) {
    const active = overlay?.querySelector('[data-ob-species].ob-active'); // Reads the core's actual selected internal species ID.
    return normalizeSpecies(active?.dataset?.obSpecies || '');
  }

  function speciesLabel(speciesId) {
    return LORE[speciesId]?.label || speciesId || 'character'; // Used by the visible loading overlay and diagnostics.
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

  function speciesGroup(overlay) {
    const labels = [...(overlay?.querySelectorAll('.ob-section-label') || [])]; // Finds the visible appearance-section Species heading without relying on its absolute position.
    const label = labels.find(node => node.textContent?.trim() === 'Species');
    const group = label?.nextElementSibling;
    return group?.classList?.contains('ob-group') ? group : null;
  }

  function loreBlock(entry, className = 'ob-runtime-species-lore') {
    const block = document.createElement('div'); // Rebuilt from canonical requested text after every core rerender.
    block.className = className;
    block.dataset.obRuntimeLore = '1';
    block.innerHTML = `<strong>${entry.label}</strong><span>${entry.text}</span>`;
    return block;
  }

  function renderSpeciesDetails(overlay, group, tletinganButton) {
    overlay.querySelectorAll('[data-ob-runtime-species-details="1"], [data-ob-runtime-lore="1"]').forEach(node => node.remove()); // Removes only this parity layer's previous details before rebuilding them.
    const currentSpecies = activeSpecies(overlay); // Determines ordinary top-level lore and whether Tletingan should keep Slagothim open.
    const tletinganSelected = currentSpecies === 'tletingan' || !!tletinganButton?.classList.contains('ob-active');
    if (tletinganSelected) slagothimOpen = true;

    const familyButton = group.querySelector('[data-ob-runtime-family="slagothim"]'); // Keeps top-level family highlight synchronized with its second step.
    familyButton?.classList.toggle('ob-active', slagothimOpen || tletinganSelected);

    const details = document.createElement('div'); // Always appears directly below the top-level species buttons.
    details.dataset.obRuntimeSpeciesDetails = '1';
    details.className = 'ob-runtime-species-details';

    if (!slagothimOpen && !tletinganSelected) {
      const entry = LORE[currentSpecies];
      if (entry) details.appendChild(loreBlock(entry));
      group.after(details);
      return;
    }

    details.appendChild(loreBlock(LORE.slagothim));
    const sub = document.createElement('div'); // Implements the requested second-step Slagothim subspecies choice visibly and independently of the legacy button row.
    sub.className = 'ob-runtime-subspecies';
    sub.innerHTML = `
      <div class="ob-runtime-subspecies-title">Slagothim subspecies</div>
      <div class="ob-group ob-runtime-subspecies-buttons">
        <button type="button" class="ob-sel-btn${tletinganSelected ? ' ob-active' : ''}" data-ob-runtime-subspecies="tletingan">Tletingan</button>
        <button type="button" class="ob-sel-btn ob-disabled" data-ob-runtime-subspecies="nuhongan" disabled>Nuhongan</button>
        <button type="button" class="ob-sel-btn ob-disabled" data-ob-runtime-subspecies="longoran" disabled>Longoran</button>
      </div>`;
    details.appendChild(sub);
    details.appendChild(loreBlock(LORE.tletingan, 'ob-runtime-species-lore ob-runtime-subspecies-lore'));
    group.after(details);

    sub.querySelector('[data-ob-runtime-subspecies="tletingan"]')?.addEventListener('click', () => {
      slagothimOpen = true;
      tletinganButton?.click(); // Delegates the actual internal species-state change to onboarding-core's existing handler.
    });
  }

  function assertSpeciesWorkflow(overlay) {
    const group = speciesGroup(overlay); // If this is absent, the user is likely on Collections rather than Appearance.
    if (!group) return;
    const tletinganButton = group.querySelector('[data-ob-species="tletingan"]'); // Legacy core button remains the authoritative internal state trigger.
    if (!tletinganButton) return;

    tletinganButton.hidden = true; // Removes Tletingan from the top-level row because it now lives under Slagothim.
    const maoButton = group.querySelector('[data-ob-species="mao-ao"]'); // Corrects the displayed lore spelling while retaining the asset/save id.
    if (maoButton) maoButton.textContent = "Mao'ao";

    let familyButton = group.querySelector('[data-ob-runtime-family="slagothim"]'); // Reuses the parity-owned family button within this DOM generation.
    if (!familyButton) {
      familyButton = document.createElement('button');
      familyButton.type = 'button';
      familyButton.className = 'ob-sel-btn';
      familyButton.dataset.obRuntimeFamily = 'slagothim';
      familyButton.textContent = 'Slagothim';
      tletinganButton.before(familyButton);
      familyButton.addEventListener('click', () => {
        slagothimOpen = true;
        renderSpeciesDetails(overlay, group, tletinganButton);
      });
    }

    group.querySelectorAll('[data-ob-species]').forEach(button => {
      if (button.dataset.obRuntimeSpeciesParityBound === '1') return;
      button.dataset.obRuntimeSpeciesParityBound = '1';
      button.addEventListener('click', () => {
        if (button.dataset.obSpecies !== 'tletingan') slagothimOpen = false;
      }, true); // Runs before onboarding-core rerenders the whole creator so the next DOM generation knows which hierarchy to show.
    });

    if (activeSpecies(overlay) === 'tletingan') slagothimOpen = true;
    renderSpeciesDetails(overlay, group, tletinganButton);
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
    const statusSpecies = normalizeSpecies(redesignStatus.speciesId); // Prevents a previous species' ready state from hiding the next species' loading screen.
    const ready = (redesignStatus.preview === 'ready' && statusSpecies === speciesId)
      || (/3D preview:\s*ready/i.test(statusLine) && statusLine.toLowerCase().includes(speciesLabel(speciesId).toLowerCase()));
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
    const style = document.createElement('style'); // Adds only follow-up UI owned by this parity layer.
    style.id = `${PATCH_ID}Style`;
    style.textContent = `
#ob-overlay .ob-runtime-species-details{margin:7px 0 4px}
#ob-overlay .ob-runtime-species-lore{padding:9px 10px;border-left:2px solid rgba(249,226,138,.48);border-radius:0 8px 8px 0;background:rgba(249,226,138,.045);font-size:10px;line-height:1.5;color:#c9dcc8}
#ob-overlay .ob-runtime-species-lore strong{display:block;margin-bottom:3px;color:#f9e28a;font-size:11px}
#ob-overlay .ob-runtime-species-lore span{display:block}
#ob-overlay .ob-runtime-subspecies{margin-top:7px;padding:9px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.025)}
#ob-overlay .ob-runtime-subspecies-title{margin-bottom:6px;font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#8aad8f}
#ob-overlay .ob-runtime-subspecies-lore{margin-top:7px}
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
    const originalRender = rendererProto.render; // Preserved so every non-onboarding render path remains behaviorally unchanged.

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
    const overlay = creatorOverlay(); // Null means the player is on save-select or gameplay, so the next creator rerolls initial Mao'ao colors again.
    if (!overlay) {
      lastSpecies = null;
      slagothimOpen = false;
      return;
    }

    assertSpeciesWorkflow(overlay); // Makes Slagothim + descriptions a visible invariant rather than a best-effort enhancement.
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
    observer = new MutationObserver(queueSync); // Watches core innerHTML replacements, enhancement inserts, and 3D-status text updates.
    observer.observe(document.body, { childList: true, subtree: true });
    queueSync();
  }

  function install() {
    installStyle();
    installGameplayLightingParity();
    installObserver();
  }

  window[PATCH_ID] = Object.freeze({ install, gameLighting: GAME_LIGHTING, lore: LORE });
  install();
})();
