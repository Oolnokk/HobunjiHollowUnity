// Hobunji Hollow — linear first-time onboarding flow.
// The preserved onboarding core remains authoritative for character/world data; this module
// constrains its existing creator/world screens into one-at-a-time required decisions.
(() => {
  'use strict';

  const FLOW_ID = 'hobunjiOnboardingLinearFlow'; // Global install guard and diagnostics owner used by this module.
  const SETUP_KEY = 'hobunjiOnboardingPendingFarmSetup.v1'; // Session handoff used to resume a just-created character at farm naming after the clean creator reload.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Existing save-meta key rewritten during the legacy creator handoff so its temporary default world is never retained.
  const PROFILE_KEY = 'hobunjiPlayerProfile'; // Existing active-profile key cleared until the player actually finishes farm setup.
  if (window[FLOW_ID]) return;

  const status = {
    installed: true,
    creatorStep: null,
    worldStep: null,
    characterId: null,
    interceptedLegacyWorldId: null,
    farmNameRequired: false,
    lastError: null,
  }; // Mobile-readable flow state exposed below for in-page diagnostics.

  let creatorStep = 'appearance'; // Current linear creator page; drives which preserved core tab is shown and which controls are hidden.
  let creatorHandoffArmed = false; // Set only on the final Name confirmation so the legacy character+world completion can be split safely.
  let worldStep = null; // Null for ordinary world selection, otherwise 'name' or 'setup' while creating a new farm.
  let clearFarmNameOnNextEnhance = false; // Clears the core's automatic random world name once when entering the required Farm Name page.
  let bodyObserver = null; // Watches only for the onboarding overlay being mounted or removed.
  let overlayObserver = null; // Watches only direct card replacements performed by onboarding-core.js.
  let observedOverlay = null; // Overlay currently attached to overlayObserver.
  let enhanceQueued = false; // Coalesces synchronous core/redesign rerenders into one flow pass.
  let resumeMarker = null; // Pending post-character marker consumed only when farm setup is actually abandoned or completed.

  function overlayElement() {
    const overlay = document.getElementById('ob-overlay'); // Current onboarding overlay used by every flow enhancer below.
    return overlay || null;
  }

  function creatorOverlay() {
    const overlay = overlayElement(); // Candidate overlay checked for the creator's canonical hidden portrait canvas.
    return overlay?.querySelector('#ob-portrait-canvas') ? overlay : null;
  }

  function installStyle() {
    const existing = document.getElementById(`${FLOW_ID}Style`); // Existing style guard prevents duplicate CSS on rerenders.
    if (existing) return;
    const style = document.createElement('style'); // Dedicated flow styling keeps the preserved core stylesheet untouched.
    style.id = `${FLOW_ID}Style`;
    style.textContent = `
#ob-overlay .ob-linear-steps{display:flex;align-items:center;justify-content:center;gap:7px;flex-wrap:wrap;margin:7px 0 12px;font:9px/1.2 'DM Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.07em;color:#78907e}
#ob-overlay .ob-linear-step{display:flex;align-items:center;gap:5px;opacity:.55}
#ob-overlay .ob-linear-step::before{content:attr(data-step-number);display:grid;place-items:center;width:18px;height:18px;border:1px solid rgba(255,255,255,.18);border-radius:50%;font-size:8px}
#ob-overlay .ob-linear-step.ob-linear-active{opacity:1;color:#f9e28a}
#ob-overlay .ob-linear-step.ob-linear-done{opacity:.82;color:#91b89a}
#ob-overlay .ob-linear-step-sep{width:16px;height:1px;background:rgba(255,255,255,.15)}
#ob-overlay .ob-linear-back{margin-right:auto}
#ob-overlay .ob-linear-hint{max-width:430px;font-size:9px;line-height:1.4;color:#91aa96}
#ob-overlay .ob-linear-name-copy{margin:0 0 9px;font-size:10px;line-height:1.45;color:#a9c1ad}
#ob-overlay .ob-linear-flow-error{margin:7px 0 0;padding:7px 9px;border:1px solid rgba(255,110,80,.35);border-radius:7px;background:rgba(120,25,15,.18);color:#ffb59e;font:9px/1.4 'DM Mono',ui-monospace,monospace}
#ob-overlay [data-ob-linear-hidden='1']{display:none!important}
@media (max-width:560px){#ob-overlay .ob-linear-steps{gap:5px}.ob-linear-step-sep{width:9px!important}#ob-overlay .ob-footer,#ob-overlay .sl-footer{gap:7px;flex-wrap:wrap}}
`;
    document.head.appendChild(style);
  }

  function stepStripHtml(keys, currentKey) {
    const currentIndex = keys.findIndex(entry => entry.key === currentKey); // Active step index controls done/active styling without making the strip clickable.
    return `<div class="ob-linear-steps">${keys.map((entry, index) => `
      <div class="ob-linear-step${index === currentIndex ? ' ob-linear-active' : ''}${index < currentIndex ? ' ob-linear-done' : ''}" data-step-number="${index + 1}">${entry.label}</div>`).join('<div class="ob-linear-step-sep"></div>')}</div>`;
  }

  function setLinearHidden(element, hidden) {
    if (!element) return;
    if (hidden) element.dataset.obLinearHidden = '1';
    else delete element.dataset.obLinearHidden;
  }

  function clearLinearHidden(root) {
    if (!root) return;
    root.querySelectorAll('[data-ob-linear-hidden="1"]').forEach(element => { delete element.dataset.obLinearHidden; });
  }

  function showError(message) {
    status.lastError = String(message || 'Unknown onboarding flow error');
    const overlay = overlayElement(); // Current overlay receives the mobile-visible error block if one is mounted.
    if (!overlay) return;
    let element = overlay.querySelector('.ob-linear-flow-error'); // Reused error block avoids stacking messages across observer passes.
    if (!element) {
      element = document.createElement('div');
      element.className = 'ob-linear-flow-error';
      element.setAttribute('role', 'alert');
      const footer = overlay.querySelector('.ob-footer, .sl-footer'); // Footer is the least disruptive place for an actionable onboarding error.
      (footer || overlay.firstElementChild || overlay).appendChild(element);
    }
    element.textContent = status.lastError;
  }

  function clearError() {
    status.lastError = null;
    overlayElement()?.querySelector('.ob-linear-flow-error')?.remove();
  }

  function creatorCoreTab(overlay) {
    const active = overlay?.querySelector('[data-ob-tab].ob-active'); // Preserved core tab indicates which underlying controls are currently rendered.
    return active?.dataset?.obTab || (overlay?.querySelector('.ob-equip-sel') ? 'collections' : 'appearance');
  }

  function switchCreatorCoreTab(target, overlay = creatorOverlay()) {
    if (!overlay || creatorCoreTab(overlay) === target) return false;
    const button = overlay.querySelector(`[data-ob-tab="${target}"]`); // Hidden legacy tab remains the canonical state-changing control for dependent creator modules.
    if (!button) return false;
    button.click();
    return true;
  }

  function nameNodes(overlay) {
    const input = overlay?.querySelector('#ob-nickname'); // Authoritative nickname input whose input event updates onboarding-core's private state.
    const row = input?.closest('.ob-random-name-row') || input; // Random-name enhancer may wrap the input after the core render.
    const label = [...(overlay?.querySelectorAll('.ob-col-right > .ob-section-label') || [])].find(element => /farmer name/i.test(element.textContent || '')); // Exact name heading used to isolate the dedicated Name page.
    const suggestions = overlay?.querySelector('.ob-name-suggestions'); // Existing lore-alignment suggestions travel with the Name page.
    const diagnostic = overlay?.querySelector('[data-ob-random-name-status="1"]'); // Existing random-name error text stays visible with the Name page.
    return { input, row, label, suggestions, diagnostic };
  }

  function currentIdentity(overlay) {
    const speciesButton = overlay?.querySelector('[data-ob-species].ob-active'); // Selected core species feeds the existing cultural random-name generator.
    const genderButton = overlay?.querySelector('[data-ob-gender].ob-active'); // Selected core gender feeds the same generator.
    return {
      speciesId: speciesButton?.dataset?.obSpecies || '',
      gender: genderButton?.dataset?.obGender || 'male',
    };
  }

  function ensureRandomCharacterName(overlay) {
    const nodes = nameNodes(overlay); // Name input is filled only at final confirmation, preserving the player's ability to type or clear freely beforehand.
    const current = String(nodes.input?.value || '').trim(); // Nonblank manual/generated choice wins unchanged.
    if (current) return current;
    if (!nodes.input) return '';

    const identity = currentIdentity(overlay); // Current species/gender selects the same culture-aware generator already used by the Random Name button.
    let generated = '';
    try {
      generated = String(window.hobunjiOnboardingRandomName?.generateFor?.(identity.speciesId, identity.gender) || '').trim();
      if (!generated && window.BanditNameForge?.generateCulturalIdentity) {
        const result = window.BanditNameForge.generateCulturalIdentity({ speciesId: identity.speciesId, gender: identity.gender }); // Direct forge fallback covers an unexpectedly unavailable enhancer without ever reverting to “Farmer.”
        generated = String(result?.givenName || '').trim();
      }
    } catch (error) {
      status.lastError = error?.message || String(error);
    }
    if (!generated) generated = `Traveler-${Math.floor(1000 + Math.random() * 9000)}`; // Last-resort random identifier keeps a blank name from silently becoming the old generic Farmer fallback.
    nodes.input.value = generated;
    nodes.input.dispatchEvent(new Event('input', { bubbles: true }));
    return generated;
  }

  function setCreatorStep(nextStep) {
    creatorStep = nextStep; // Linear step is retained across the core's synchronous card replacement.
    status.creatorStep = nextStep;
    clearError();
    const targetTab = nextStep === 'collections' ? 'collections' : 'appearance'; // Name reuses the appearance render because that is where the authoritative nickname input lives.
    const overlay = creatorOverlay(); // Current overlay is asked to switch through the preserved core handler before enhancement.
    if (!switchCreatorCoreTab(targetTab, overlay)) scheduleEnhance();
  }

  function enhanceCreator(overlay) {
    status.creatorStep = creatorStep;
    status.worldStep = null;

    const desiredTab = creatorStep === 'collections' ? 'collections' : 'appearance'; // Only one underlying core panel is allowed to be visible for each linear page.
    if (creatorCoreTab(overlay) !== desiredTab) {
      switchCreatorCoreTab(desiredTab, overlay);
      return;
    }

    const card = overlay.querySelector('.ob-card'); // Creator card receives the non-clickable progress strip.
    const title = card?.querySelector('.ob-title'); // Progress strip is anchored directly beneath the creator title.
    card?.querySelector('.ob-linear-steps')?.remove();
    if (title) title.insertAdjacentHTML('afterend', stepStripHtml([
      { key: 'appearance', label: 'Appearance' },
      { key: 'collections', label: 'Clothing' },
      { key: 'name', label: 'Name' },
    ], creatorStep));

    setLinearHidden(overlay.querySelector('.ob-tabs'), true); // Removes tab-choice overload while preserving the hidden buttons for existing redesign/randomization code.

    const right = overlay.querySelector('.ob-col-right'); // Right column is filtered differently for Appearance versus the dedicated Name page.
    const nodes = nameNodes(overlay); // Current name-control nodes may include enhancer wrappers/suggestions.
    if (right) {
      [...right.children].forEach(child => { if (child.dataset.obLinearHidden === '1') delete child.dataset.obLinearHidden; });
      if (creatorStep === 'appearance') {
        [nodes.label, nodes.row, nodes.suggestions, nodes.diagnostic].forEach(element => setLinearHidden(element, true));
      } else if (creatorStep === 'name') {
        const keep = new Set([nodes.label, nodes.row, nodes.suggestions, nodes.diagnostic].filter(Boolean)); // Only explicit naming controls survive on the Name page.
        [...right.children].forEach(child => setLinearHidden(child, !keep.has(child)));
        if (nodes.label && !right.querySelector('.ob-linear-name-copy')) {
          const copy = document.createElement('div'); // Dedicated instruction makes the blank-name random behavior discoverable instead of implicit.
          copy.className = 'ob-linear-name-copy';
          copy.textContent = 'Choose a name, use Random Name, or leave this blank and a culturally appropriate random name will be chosen when you continue.';
          nodes.label.after(copy);
        }
      }
    }

    const footer = overlay.querySelector('.ob-footer'); // Existing footer button remains the single forward action so controller/mobile bindings stay consistent.
    const hint = footer?.querySelector('.ob-footer-hint'); // Existing hint is rewritten to describe the current required decision.
    const startButton = overlay.querySelector('#ob-start-btn'); // Core completion button is intercepted until the Name page.
    if (hint) {
      hint.classList.add('ob-linear-hint');
      hint.textContent = creatorStep === 'appearance'
        ? 'Step 1 of 3 — choose your body, colors and appearance.'
        : creatorStep === 'collections'
          ? 'Step 2 of 3 — choose your starting clothing and dyes. Choosing “None” is allowed, but this step cannot be skipped.'
          : 'Step 3 of 3 — name this character before moving on to the farm.';
    }
    if (startButton) {
      startButton.textContent = creatorStep === 'appearance' ? 'Continue to Clothing →' : creatorStep === 'collections' ? 'Continue to Name →' : 'Create Farmer →';
      if (startButton.dataset.obLinearBound !== '1') {
        startButton.dataset.obLinearBound = '1';
        startButton.addEventListener('click', event => {
          if (creatorStep === 'appearance') {
            event.preventDefault();
            event.stopImmediatePropagation();
            setCreatorStep('collections');
            return;
          }
          if (creatorStep === 'collections') {
            event.preventDefault();
            event.stopImmediatePropagation();
            setCreatorStep('name');
            return;
          }
          const currentOverlay = creatorOverlay(); // Final Name confirmation must populate a random name before the core can see an empty nickname.
          const resolvedName = ensureRandomCharacterName(currentOverlay);
          if (!resolvedName) {
            event.preventDefault();
            event.stopImmediatePropagation();
            showError('A character name could not be generated. Use Random Name or type a name before continuing.');
            return;
          }
          creatorHandoffArmed = true;
          status.characterId = null;
          clearError();
          // Do not stop this final click: onboarding-core creates the canonical character record.
          // Its legacy default world is intercepted synchronously by onPlayerReadyFromCreator below.
        }, true);
      }
    }

    let back = footer?.querySelector('#obLinearBack'); // Flow-owned back button replaces the hidden tab row's optional Back control.
    if (!back && footer) {
      back = document.createElement('button');
      back.id = 'obLinearBack';
      back.type = 'button';
      back.className = 'ob-tab ob-back-tab ob-linear-back';
      footer.prepend(back);
      back.addEventListener('click', () => {
        if (creatorStep === 'name') { setCreatorStep('collections'); return; }
        if (creatorStep === 'collections') { setCreatorStep('appearance'); return; }
        const coreBack = overlayElement()?.querySelector('#ob-back-btn'); // Existing-character creation returns through the preserved save-select handler.
        coreBack?.click();
      });
    }
    if (back) {
      const hasCoreBack = !!overlay.querySelector('#ob-back-btn'); // Fresh first character has nowhere meaningful to go before Appearance.
      back.hidden = creatorStep === 'appearance' && !hasCoreBack;
      back.textContent = creatorStep === 'appearance' ? '← Character Select' : creatorStep === 'collections' ? '← Appearance' : '← Clothing';
    }
  }

  function persistSetupMarker(characterId) {
    const marker = { characterId, createdAt: Date.now() }; // Session marker identifies exactly which just-created character should resume at Farm Name.
    try { sessionStorage.setItem(SETUP_KEY, JSON.stringify(marker)); } catch (_) {}
    resumeMarker = marker;
    return marker;
  }

  function readSetupMarker() {
    try {
      const raw = sessionStorage.getItem(SETUP_KEY); // Marker is intentionally retained through farm setup so an accidental reload returns to the unfinished required steps.
      const marker = raw ? JSON.parse(raw) : null;
      return marker?.characterId ? marker : null;
    } catch (_) { return null; }
  }

  function clearSetupMarker() {
    try { sessionStorage.removeItem(SETUP_KEY); } catch (_) {}
    resumeMarker = null;
  }

  async function flushCorrectedFolderSnapshot() {
    const localSave = window.LocalSaveFolder; // Existing folder-save API is used after removing the core's temporary legacy world.
    if (!localSave?.getStatus || !localSave?.syncNow) return true;
    const folderStatus = localSave.getStatus(); // Only an already-ready primary folder needs an explicit corrected flush before reload.
    if (folderStatus.state !== 'ready' || !folderStatus.folderName) return true;
    try {
      const result = await localSave.syncNow(); // Ensures the folder sees character-only state, never the discarded auto-created world.
      if (result?.lastError || result?.dataLossRisk) throw new Error(result.lastError || result.dataLossRisk);
      return true;
    } catch (error) {
      status.lastError = error?.message || String(error);
      return false;
    }
  }

  function onPlayerReadyFromCreator(event) {
    if (!creatorHandoffArmed) return;
    creatorHandoffArmed = false;
    event.stopImmediatePropagation(); // Prevents gameplay/reload consumers from treating the core's temporary legacy world as a real completed onboarding.

    const playerData = event?.detail || null; // Core event contains the canonical new character id and the temporary legacy world id.
    const characterId = playerData?.characterId || null; // New character survives this split handoff.
    const worldId = playerData?.worldId || null; // Legacy auto-created world is removed before any next-page setup begins.
    const api = window.HobunjiOnboarding; // Public core API reads the exact save-meta object that was just authored.
    const meta = api?.loadSaveMeta?.() || null; // Corrected metadata preserves all character fields, including starter-weapon persistence from earlier capture listeners.
    if (!characterId || !worldId || !meta) {
      showError('Character creation completed without a readable character/world handoff. Reloading the saved browser state.');
      setTimeout(() => location.reload(), 0);
      return;
    }

    meta.worlds = (meta.worlds || []).filter(world => world?.id !== worldId); // Removes only the world the legacy completion just made; unrelated saves are untouched.
    try {
      localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
      localStorage.removeItem(PROFILE_KEY); // No active player profile exists until farm setup creates/selects a real world.
    } catch (error) {
      status.lastError = error?.message || String(error);
    }
    window.__hobunjiPlayerProfile = null;
    persistSetupMarker(characterId);
    status.characterId = characterId;
    status.interceptedLegacyWorldId = worldId;
    status.creatorStep = 'complete';
    status.worldStep = 'name';
    status.farmNameRequired = true;

    flushCorrectedFolderSnapshot().then(folderOk => {
      if (!folderOk) alert('Your new character was preserved in the browser, but the primary save folder could not be updated before farm setup. The browser copy will continue; reconnect/sync the folder afterward.');
      location.reload(); // Clean reload discards the creator WebGL scene before the real world/preset flow, matching the existing safe creator handoff.
    });
  }

  function worldSections(overlay, nameInput) {
    const worldSection = nameInput?.closest('.sl-section') || null; // Contains the New World card and required farm-name input.
    const settingsControl = overlay?.querySelector('#slFarmStone, #slFarmWood, #slFarmSpecialization'); // Any canonical farm-setting control locates the preset section.
    const settingsSection = settingsControl?.closest('.sl-section') || null; // Contains colors, specialization description and starter supplies.
    return { worldSection, settingsSection };
  }

  function addWorldStepStrip(overlay) {
    overlay.querySelector('#obLinearWorldSteps')?.remove();
    const saveSteps = overlay.querySelector('.sl-steps'); // Nested Farm Name/Farm Setup progress sits beneath the broader Source/Character/World strip.
    if (!saveSteps || !worldStep) return;
    const holder = document.createElement('div'); // Wrapper gets a stable id because core replaces the entire card on world-selection rerenders.
    holder.id = 'obLinearWorldSteps';
    holder.innerHTML = stepStripHtml([
      { key: 'name', label: 'Farm Name' },
      { key: 'setup', label: 'Farm Setup' },
    ], worldStep);
    saveSteps.insertAdjacentElement('afterend', holder);
  }

  function updateFarmNameForwardState(overlay) {
    const input = overlay?.querySelector('#slNewWorldName'); // Current required farm-name field controls whether the first world-creation forward action can fire.
    const play = overlay?.querySelector('#slPlay'); // Existing core Play button is repurposed as Continue on the Farm Name page.
    if (!input || !play || worldStep !== 'name') return;
    const valid = !!String(input.value || '').trim(); // Whitespace-only farm names are treated as missing instead of falling through to a random default.
    play.disabled = !valid;
    status.farmNameRequired = !valid;
  }

  function setWorldStep(nextStep) {
    worldStep = nextStep; // Farm creation substep persists while DOM visibility is rearranged without changing core save state.
    status.worldStep = nextStep;
    clearError();
    scheduleEnhance();
  }

  function enhanceNewWorld(overlay, nameInput) {
    if (!worldStep) {
      worldStep = 'name'; // Selecting New World always enters naming before any preset/building options can be used.
      clearFarmNameOnNextEnhance = true;
    }
    status.worldStep = worldStep;
    status.farmNameRequired = worldStep === 'name' && !String(nameInput.value || '').trim();
    addWorldStepStrip(overlay);

    if (clearFarmNameOnNextEnhance) {
      clearFarmNameOnNextEnhance = false;
      nameInput.value = '';
      nameInput.dispatchEvent(new Event('input', { bubbles: true })); // Clears onboarding-core's draft too, so Play cannot silently fall back to its generated name.
    }

    const sections = worldSections(overlay, nameInput); // World chooser/name and preset controls are displayed one at a time.
    clearLinearHidden(overlay.querySelector('.sl-card'));
    const allSections = [...overlay.querySelectorAll('.sl-card > .sl-section')]; // Other joinable-world sections are hidden while the player is inside New Farm creation.
    for (const section of allSections) {
      const keep = worldStep === 'name' ? section === sections.worldSection : section === sections.settingsSection;
      setLinearHidden(section, !keep);
    }

    if (worldStep === 'name' && sections.worldSection) {
      sections.worldSection.querySelectorAll('.sl-world-card-wrap').forEach(wrapper => {
        setLinearHidden(wrapper, !wrapper.querySelector('#slNewWorld')); // Once New World is chosen, existing worlds stop competing visually with the required name decision.
      });
      const randomize = overlay.querySelector('#slFarmRerollName'); // Existing core randomizer is moved beside the name instead of living on the later preset page.
      if (randomize && nameInput.parentElement && randomize.parentElement !== nameInput.parentElement) nameInput.insertAdjacentElement('afterend', randomize);
      if (randomize && randomize.dataset.obLinearNameBound !== '1') {
        randomize.dataset.obLinearNameBound = '1';
        randomize.addEventListener('click', () => queueMicrotask(() => updateFarmNameForwardState(overlay)));
      }
      let copy = sections.worldSection.querySelector('.ob-linear-name-copy'); // Required naming instruction is explicit even though Randomize remains available.
      if (!copy) {
        copy = document.createElement('div');
        copy.className = 'ob-linear-name-copy';
        copy.textContent = 'Name your farm before choosing its starting specialization and buildings.';
        sections.worldSection.prepend(copy);
      }
    }

    const back = overlay.querySelector('#slBackToCharacter'); // Existing World back button becomes one-step-back inside the new-farm subflow.
    const play = overlay.querySelector('#slPlay'); // Existing Play button stays the only controller/mobile forward action.
    if (play) {
      play.textContent = worldStep === 'name' ? 'Continue to Farm Setup →' : '🌱 Create Farm & Play';
      if (play.dataset.obLinearWorldBound !== '1') {
        play.dataset.obLinearWorldBound = '1';
        play.addEventListener('click', event => {
          if (worldStep === 'name') {
            const currentInput = overlayElement()?.querySelector('#slNewWorldName'); // Reacquired field reflects any core randomizer or typed changes.
            if (!String(currentInput?.value || '').trim()) {
              event.preventDefault();
              event.stopImmediatePropagation();
              updateFarmNameForwardState(overlayElement());
              showError('Name the farm or use Randomize farm name before continuing.');
              currentInput?.focus?.();
              return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            setWorldStep('setup');
            return;
          }
          clearSetupMarker(); // Setup is complete; future reloads should use the ordinary save-select or post-creator gameplay resume path.
          status.farmNameRequired = false;
          let marker = overlayElement()?.querySelector('#ob-start-btn[data-ob-linear-final-play="1"]'); // Hidden marker lets the existing clean creator reload-handoff recognize final Play after the inserted farm steps.
          if (!marker) {
            marker = document.createElement('span');
            marker.id = 'ob-start-btn';
            marker.dataset.obLinearFinalPlay = '1';
            marker.hidden = true;
            overlayElement()?.appendChild(marker);
          }
          // Do not stop final Play: onboarding-core now creates the real named/configured world,
          // weapon persistence runs, then the existing reload-handoff performs the clean gameplay reload.
        }, true);
      }
    }

    if (back && back.dataset.obLinearWorldBound !== '1') {
      back.dataset.obLinearWorldBound = '1';
      back.addEventListener('click', event => {
        if (worldStep === 'setup') {
          event.preventDefault();
          event.stopImmediatePropagation();
          setWorldStep('name');
          return;
        }
        clearSetupMarker(); // Leaving Farm Name intentionally cancels auto-resume; the character itself remains safely saved.
        worldStep = null;
        status.worldStep = null;
        const existingWorld = [...(overlayElement()?.querySelectorAll('[data-sl-world]') || [])][0]; // Existing characters can return to their world chooser without backing all the way to character select.
        if (existingWorld) {
          event.preventDefault();
          event.stopImmediatePropagation();
          existingWorld.click();
        }
        // If this character has no world yet, allow onboarding-core's Back to Character handler to run normally.
      }, true);
    }
    if (back) back.textContent = worldStep === 'setup' ? '← Farm Name' : ([...(overlay.querySelectorAll('[data-sl-world]') || [])].length ? '← World Choices' : '← Character');

    if (nameInput.dataset.obLinearNameInputBound !== '1') {
      nameInput.dataset.obLinearNameInputBound = '1';
      nameInput.addEventListener('input', () => updateFarmNameForwardState(overlayElement()));
      nameInput.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || worldStep !== 'name') return;
        event.preventDefault();
        event.stopImmediatePropagation(); // Beats onboarding-core's old Enter→Play shortcut so naming always proceeds to Farm Setup first.
        const currentOverlay = overlayElement(); // Current card contains the current Continue button after any rerender.
        updateFarmNameForwardState(currentOverlay);
        currentOverlay?.querySelector('#slPlay')?.click();
      }, true);
    }
    updateFarmNameForwardState(overlay);
  }

  function enhanceWorld(overlay) {
    const nameInput = overlay.querySelector('#slNewWorldName'); // Presence means the core currently has New World selected (or this character has no worlds yet).
    if (!nameInput) {
      worldStep = null;
      status.worldStep = null;
      status.farmNameRequired = false;
      return;
    }
    enhanceNewWorld(overlay, nameInput);
  }

  function resumePendingFarmSetup(marker, attempt = 0) {
    if (!marker?.characterId || attempt > 80) {
      if (attempt > 80) showError('Could not resume the new character at farm setup. Choose that character manually; no character data was lost.');
      return;
    }
    const overlay = overlayElement(); // Current save-select card advances synchronously through its canonical buttons when available.
    if (!overlay) { setTimeout(() => resumePendingFarmSetup(marker, attempt + 1), 50); return; }

    const sourceContinue = overlay.querySelector('#slSourceContinue'); // First broad save-source step may still be present after the clean reload.
    if (sourceContinue) { sourceContinue.click(); setTimeout(() => resumePendingFarmSetup(marker, attempt + 1), 0); return; }

    const characterCard = overlay.querySelector(`[data-sl-char="${CSS.escape(String(marker.characterId))}"]`); // Exact saved character created on the previous page.
    if (characterCard) {
      characterCard.click();
      const currentOverlay = overlayElement(); // Core rerenders synchronously after character selection.
      currentOverlay?.querySelector('#slCharNext')?.click();
      worldStep = 'name';
      clearFarmNameOnNextEnhance = true;
      status.characterId = marker.characterId;
      status.worldStep = 'name';
      scheduleEnhance();
      return;
    }

    if (overlay.querySelector('#slNewWorldName')) {
      worldStep = 'name';
      clearFarmNameOnNextEnhance = true;
      status.characterId = marker.characterId;
      status.worldStep = 'name';
      scheduleEnhance();
      return;
    }

    setTimeout(() => resumePendingFarmSetup(marker, attempt + 1), 50); // Folder/startup gates can briefly delay the underlying save-select card on mobile.
  }

  function installInitResume() {
    const api = window.HobunjiOnboarding; // Public onboarding API exists because this module parser-loads after onboarding-core.js.
    if (!api?.init || api.init.__hobunjiLinearFlowResume) return !!api?.init;
    const originalInit = api.init.bind(api); // Preserved init remains authoritative; wrapper only continues an unfinished required farm setup afterward.
    const wrappedInit = function linearOnboardingInit(options) {
      resumeMarker = readSetupMarker();
      const result = originalInit(options); // Core builds its normal save-select/creator card first.
      if (resumeMarker) queueMicrotask(() => resumePendingFarmSetup(resumeMarker));
      return result;
    };
    wrappedInit.__hobunjiLinearFlowResume = true;
    api.init = wrappedInit;
    return true;
  }

  function enhanceCurrentOverlay() {
    enhanceQueued = false;
    const overlay = overlayElement(); // One pass chooses creator, new-world, or ordinary save-select behavior from the current core card.
    if (!overlay) return;
    // In-game creator sessions (HobunjiOnboarding.openCreator, e.g. the romance
    // adoption dream) reuse the creator UI but never create a farmer or world;
    // the new-farmer steps and their world hand-off must not apply to them.
    if (window.HobunjiOnboarding?.creatorSessionInfo?.()) return;
    installStyle();
    if (creatorOverlay()) {
      enhanceCreator(overlay);
      return;
    }
    if (overlay.querySelector('#slPlay')) enhanceWorld(overlay);
  }

  function scheduleEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    queueMicrotask(enhanceCurrentOverlay);
  }

  function syncOverlayObserver() {
    const overlay = overlayElement(); // Direct overlay replacement is the only mutation source this observer needs to follow.
    if (overlay === observedOverlay) return;
    overlayObserver?.disconnect();
    overlayObserver = null;
    observedOverlay = overlay;
    if (overlay) {
      overlayObserver = new MutationObserver(scheduleEnhance);
      overlayObserver.observe(overlay, { childList: true });
    }
    scheduleEnhance();
  }

  function install() {
    installStyle();
    installInitResume();
    document.addEventListener('hobunjiPlayerReady', onPlayerReadyFromCreator, { capture: true }); // Loaded before the existing reload-handoff, so the legacy temporary world cannot reach gameplay.
    bodyObserver = new MutationObserver(syncOverlayObserver);
    bodyObserver.observe(document.body, { childList: true });
    syncOverlayObserver();
  }

  window[FLOW_ID] = Object.freeze({
    status,
    install,
    get creatorStep() { return creatorStep; },
    get worldStep() { return worldStep; },
    resumeKey: SETUP_KEY,
  }); // Exposed status/getters support mobile-visible diagnostic panels without requiring DevTools.

  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
})();
