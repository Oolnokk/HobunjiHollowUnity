// Character-creator handoff: save first, reload once, then enter the new game from clean WebGL state.
(() => {
  'use strict';

  const PATCH_ID = 'hobunjiOnboardingCharacterCreationReloadHandoff'; // Prevents duplicate listeners/wrappers.
  const RESUME_KEY = 'hobunjiOnboardingPostCreatorReload.v1'; // Session-only marker consumed exactly once on the next page load.
  if (window[PATCH_ID]) return;

  const status = {
    armed: false,
    resumed: false,
    characterId: null,
    worldId: null,
    lastError: null,
  }; // Mobile-readable handoff diagnostics.

  function creatorConfirmIsStillMounted() {
    return !!document.querySelector('#ob-overlay #ob-start-btn');
  }

  function writeResumeMarker(playerData) {
    if (!playerData?.characterId || !playerData?.worldId) return false;
    try {
      const marker = {
        characterId: playerData.characterId,
        worldId: playerData.worldId,
        createdAt: Date.now(),
      };
      sessionStorage.setItem(RESUME_KEY, JSON.stringify(marker));
      status.armed = true;
      status.characterId = marker.characterId;
      status.worldId = marker.worldId;
      status.lastError = null;
      return true;
    } catch (error) {
      status.lastError = error?.message || String(error);
      return false;
    }
  }

  function takeResumeMarker() {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(RESUME_KEY); // Consume before doing anything else so a failed boot can never reload-loop.
      const marker = JSON.parse(raw);
      return marker?.characterId && marker?.worldId ? marker : null;
    } catch (error) {
      try { sessionStorage.removeItem(RESUME_KEY); } catch (_) {}
      status.lastError = error?.message || String(error);
      return null;
    }
  }

  function playerMatchesMarker(playerData, marker) {
    return !!playerData
      && String(playerData.characterId || '') === String(marker?.characterId || '')
      && String(playerData.worldId || '') === String(marker?.worldId || '');
  }

  function installInitResume() {
    const api = window.HobunjiOnboarding;
    if (!api?.init || api.init.__hobunjiCreatorReloadResume) return !!api?.init;
    const originalInit = api.init.bind(api);

    const wrappedInit = function onboardingInitAfterCreatorReload(options) {
      const marker = takeResumeMarker();
      if (!marker) return originalInit(options);

      const playerData = api.loadProfile?.() || null;
      if (!playerMatchesMarker(playerData, marker)) {
        status.lastError = 'Saved player profile did not match the post-creator reload marker.';
        return originalInit(options);
      }

      // All scripts, including game.js's hobunjiPlayerReady listeners, have
      // loaded before index.html calls HobunjiOnboarding.init() at the bottom
      // of the page. Skip rebuilding the onboarding overlay and deliver the
      // already-saved profile on a fresh renderer/page session instead.
      window.__hobunjiPlayerProfile = playerData;
      status.resumed = true;
      status.armed = false;
      status.characterId = playerData.characterId;
      status.worldId = playerData.worldId;
      status.lastError = null;
      queueMicrotask(() => {
        document.dispatchEvent(new CustomEvent('hobunjiPlayerReady', { detail: playerData }));
      });
      return undefined;
    };
    wrappedInit.__hobunjiCreatorReloadResume = true;
    api.init = wrappedInit;
    return true;
  }

  function onPlayerReadyBeforeOldPageGameBoot(event) {
    // Save-select Play should continue to enter gameplay without a reload.
    // Only the creator's Start Farming confirmation gets the clean-page handoff.
    if (!creatorConfirmIsStillMounted()) return;
    const playerData = event?.detail;
    if (!writeResumeMarker(playerData)) return;

    // The randomized-weapon module is loaded before this module and has an
    // earlier capture listener, so its equipmentSlots.weapon/localStorage
    // persistence has already completed. Stop the remaining old-page game
    // listeners from initializing a renderer we are about to discard.
    event.stopImmediatePropagation();
    setTimeout(() => location.reload(), 0);
  }

  function install() {
    installInitResume();
    document.addEventListener('hobunjiPlayerReady', onPlayerReadyBeforeOldPageGameBoot, { capture: true });
  }

  window[PATCH_ID] = Object.freeze({ install, status, resumeKey: RESUME_KEY });
  install();
})();
