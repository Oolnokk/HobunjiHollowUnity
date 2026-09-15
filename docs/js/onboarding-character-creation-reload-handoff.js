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
    durableCommits: 0,
    durableCommitFallbacks: 0,
    durableCommitFailures: 0,
    folderFlushes: 0,
    folderFlushFailures: 0,
    lastError: null,
  }; // Mobile-readable handoff diagnostics for the durable commit and desktop folder flush that precede the clean-page reload.

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
      }; // Session-only creator identity used to resume exactly the farmer/world that was just persisted.
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

  function clearResumeMarker() {
    try { sessionStorage.removeItem(RESUME_KEY); } catch (_) {}
    status.armed = false;
  }

  function takeResumeMarker() {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY); // Marker consumed before resume work so a failed boot can never reload-loop.
      if (!raw) return null;
      sessionStorage.removeItem(RESUME_KEY);
      const marker = JSON.parse(raw); // Parsed farmer/world identity checked against the freshly loaded browser profile.
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

  async function commitDurableBeforeReload() {
    const coordinator = window.HobunjiSaveCoordinator; // Transport-neutral local authority captures the creator's completed browser save before navigation.
    if (!coordinator?.commitCurrent) {
      status.durableCommitFailures++;
      status.lastError = 'The durable save coordinator is unavailable.';
      return false;
    }
    try {
      const result = await coordinator.commitCurrent({ reason: 'character-creator-start' }); // The creator has already written its player/world data to localStorage before this capture listener runs.
      if (result?.ok) {
        status.durableCommits++;
        status.lastError = null;
        return true;
      }
      if (result?.unavailable) {
        // Preserve compatibility in browsers where IndexedDB is unavailable;
        // the existing browser localStorage + explicit desktop folder flush
        // still protect the newly-created farmer in this transitional branch.
        status.durableCommitFallbacks++;
        status.lastError = result.error || null;
        return true;
      }
      status.durableCommitFailures++;
      status.lastError = result?.error || 'The durable local save could not be committed.';
      return false;
    } catch (error) {
      status.durableCommitFailures++;
      status.lastError = error?.message || String(error);
      return false;
    }
  }

  async function flushPrimaryFolderBeforeReload() {
    const localSave = window.LocalSaveFolder; // Existing filesystem persistence API retained while the V3 canonical folder bundle is introduced.
    if (!localSave?.getStatus || !localSave?.syncNow) return true;
    const current = localSave.getStatus(); // Permission/connection state captured before starting the creator handoff flush.
    if (current.state !== 'ready' || !current.folderName) return true;

    try {
      const saved = await localSave.syncNow(); // Existing explicit folder flush remains after the durable local commit.
      if (saved?.lastError || saved?.dataLossRisk) {
        status.folderFlushFailures++;
        status.lastError = saved.lastError || `Primary folder save was blocked: ${saved.dataLossRisk}`;
        return false;
      }
      status.folderFlushes++;
      status.lastError = null;
      return true;
    } catch (error) {
      status.folderFlushFailures++;
      status.lastError = error?.message || String(error);
      return false;
    }
  }

  function installInitResume() {
    const api = window.HobunjiOnboarding; // Existing onboarding API whose init is wrapped only for the one post-creator reload.
    if (!api?.init || api.init.__hobunjiCreatorReloadResume) return !!api?.init;
    const originalInit = api.init.bind(api); // Normal onboarding path retained for every load without a valid creator resume marker.

    const wrappedInit = function onboardingInitAfterCreatorReload(options) {
      const marker = takeResumeMarker(); // One-shot creator handoff marker consumed before deciding whether normal onboarding should run.
      if (!marker) return originalInit(options);

      const playerData = api.loadProfile?.() || null; // Persisted browser profile must match the marker before bypassing save selection.
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

  async function onPlayerReadyBeforeOldPageGameBoot(event) {
    // Save-select Play should continue to enter gameplay without a reload.
    // Only the creator's Start Farming confirmation gets the clean-page handoff.
    if (!creatorConfirmIsStillMounted()) return;
    const playerData = event?.detail; // Newly-created saved profile used to arm the post-reload resume marker.
    if (!writeResumeMarker(playerData)) return;

    // The randomized-weapon module is loaded before this module and has an
    // earlier capture listener, so its equipmentSlots.weapon/localStorage
    // persistence has already completed. Stop the remaining old-page game
    // listeners from initializing a renderer we are about to discard.
    event.stopImmediatePropagation();

    // First make the completed browser save durable in the transport-neutral
    // local sync store. External folder/Drive work must never be the only copy
    // protecting a brand-new farmer during this clean-page handoff.
    const durableSaved = await commitDurableBeforeReload();
    if (!durableSaved) {
      clearResumeMarker();
      alert('Your farmer was saved in the browser, but the durable local sync copy could not be committed:\n' + (status.lastError || 'Unknown local save error') + '\n\nPress Start Farming again after resolving the save-storage problem.');
      return;
    }

    // Desktop folder persistence remains explicit during this migration. Finish
    // the folder write before discarding the page so current desktop guarantees
    // stay intact while the canonical V3 bundle is introduced.
    const folderSaved = await flushPrimaryFolderBeforeReload();
    if (!folderSaved) {
      clearResumeMarker();
      alert('Your farmer was saved in the browser and durable local storage, but the primary save folder could not be updated:\n' + (status.lastError || 'Unknown folder error') + '\n\nFix or change the save folder, then press Start Farming again.');
      return;
    }

    setTimeout(() => location.reload(), 0);
  }

  function install() {
    installInitResume();
    document.addEventListener('hobunjiPlayerReady', onPlayerReadyBeforeOldPageGameBoot, { capture: true });
  }

  window[PATCH_ID] = Object.freeze({ install, status, resumeKey: RESUME_KEY });
  install();
})();
