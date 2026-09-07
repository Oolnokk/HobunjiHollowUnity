(() => {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  //  World-owner prologue runtime
  // ──────────────────────────────────────────────────────────────────────
  //  This helper is intentionally loaded from the Cutscene Preview bridge:
  //  that is the earliest game-only parser-time script that already owns
  //  the real-game cutscene handoff. The prologue reuses that handoff rather
  //  than creating a second scene engine.
  const PrologueSystem = (() => {
    const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used to persist world-scoped prologue progress and owner gating.
    const PROFILE_KEY = 'hobunjiPlayerProfile'; // Used to preserve the owning character across cinematic reloads.
    const PREVIEW_HANDOFF_KEY = 'hobunji_cutscene_preview_v1'; // Used by index.html's existing one-shot real-game cutscene handoff.
    const RESUME_KEY = 'hobunji_prologue_resume_v1'; // Used once after the final cinematic to auto-enter the completed world.
    const CHAPTER_URL = './config/cutscenes/prologue-chapter.json'; // Used to load the authored rescue and Hunundi-room scene data.
    const NPC_DB_URL = './config/npcs/hobunji-starter-npc-database.json'; // Used to attach the same real NPC records Cutscene Director previews use.
    const PROLOGUE_VERSION = 1; // Used to version the persistent world.prologue record for future migrations.
    const STAGE_RESCUE = 'rescue'; // Used as the first persistent prologue stage for a newly created world.
    const STAGE_HUNUNDI = 'hunundi_room'; // Used after the rescue scene finishes successfully.
    const STAGE_COMPLETE = 'complete'; // Used to unlock farmhands and natural calendar progression.
    let _launchInFlight = false; // Used to prevent duplicate player-ready/observer callbacks from starting two cinematic reloads.
    let _advanceInFlight = false; // Used to make the runner's finish banner idempotent if it is emitted more than once.
    let _resumeClickInFlight = false; // Used while the completed-world save-select auto-resume clicks through rerenders.
    let _saveObserver = null; // Used to keep save-select world locks refreshed after onboarding rerenders its DOM.

    function debugLog(message, level = 'info') {
      const logger = window.__farmLog; // Used to put prologue diagnostics in the existing mobile-visible farm log when available.
      if (typeof logger === 'function') {
        try { logger(`[prologue] ${message}`, level); return; } catch (_) {}
      }
      console[level === 'error' ? 'error' : 'log'](`[prologue] ${message}`);
    }

    function readJsonStorage(key, fallback = null) {
      const raw = localStorage.getItem(key); // Used as the serialized payload for the requested localStorage record.
      if (!raw) return fallback;
      try { return JSON.parse(raw); } catch (_) { return fallback; }
    }

    function writeJsonStorage(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    }

    function loadMeta() {
      return readJsonStorage(SAVE_META_KEY, { version: 1, characters: [], worlds: [] });
    }

    function saveMeta(meta) {
      writeJsonStorage(SAVE_META_KEY, meta);
      refreshSaveSelectLocks();
    }

    function worldById(meta, worldId) {
      return (meta?.worlds || []).find(world => world.id === worldId) || null;
    }

    function normalizeStage(stage) {
      return [STAGE_RESCUE, STAGE_HUNUNDI, STAGE_COMPLETE].includes(stage) ? stage : STAGE_RESCUE;
    }

    function ensureWorldPrologue(worldId, ownerCharacterId) {
      const meta = loadMeta(); // Used to locate and mutate the requested world's persistent prologue record.
      const world = worldById(meta, worldId); // Used as the world receiving the new prologue record.
      if (!world) return null;
      if (!world.prologue || typeof world.prologue !== 'object') {
        const now = Date.now(); // Used for human/debug-friendly creation/update timestamps on this world state.
        world.prologue = {
          version: PROLOGUE_VERSION,
          stage: STAGE_RESCUE,
          completed: false,
          ownerCharacterId: world.ownerCharacterId || ownerCharacterId || null,
          startedAt: now,
          updatedAt: now,
        };
        saveMeta(meta);
        debugLog(`initialized ${world.id}: ${STAGE_RESCUE}`);
      } else {
        world.prologue.version = Number(world.prologue.version) || PROLOGUE_VERSION;
        world.prologue.stage = normalizeStage(world.prologue.completed ? STAGE_COMPLETE : world.prologue.stage);
        world.prologue.completed = world.prologue.stage === STAGE_COMPLETE || !!world.prologue.completed;
        world.prologue.ownerCharacterId ||= world.ownerCharacterId || ownerCharacterId || null;
      }
      return world.prologue;
    }

    function getWorldPrologue(worldId) {
      const meta = loadMeta(); // Used only to read the requested world's current persistent state.
      return worldById(meta, worldId)?.prologue || null;
    }

    function isIncompleteState(state) {
      return !!state && !state.completed && normalizeStage(state.stage) !== STAGE_COMPLETE;
    }

    function canCharacterEnterWorld(worldId, characterId) {
      const meta = loadMeta(); // Used to resolve world ownership and its prologue state for the entry gate.
      const world = worldById(meta, worldId); // Used as the target world for the ownership check.
      if (!world || !isIncompleteState(world.prologue)) return true;
      return !!characterId && characterId === world.ownerCharacterId;
    }

    function stageLabel(stage) {
      if (stage === STAGE_RESCUE) return 'Rescue';
      if (stage === STAGE_HUNUNDI) return "Hunundi's room";
      return 'Complete';
    }

    async function loadChapterData() {
      const response = await fetch(CHAPTER_URL, { cache: 'no-store' }); // Used to fetch the authored scene definitions from the repo.
      if (!response.ok) throw new Error(`prologue chapter HTTP ${response.status}`);
      const chapter = await response.json(); // Used as the source scene data for the requested prologue stage.
      if (!chapter?.scenes?.[STAGE_RESCUE] || !chapter?.scenes?.[STAGE_HUNUNDI]) throw new Error('prologue chapter is missing a required scene');
      return chapter;
    }

    async function loadNpcIndex() {
      const response = await fetch(NPC_DB_URL, { cache: 'no-store' }); // Used to fetch the same global NPC database the Director uses.
      if (!response.ok) throw new Error(`NPC database HTTP ${response.status}`);
      const json = await response.json(); // Used to normalize either the {npcs:[...]} or legacy bare-array database shape.
      const list = Array.isArray(json?.npcs) ? json.npcs : (Array.isArray(json) ? json : []); // Used to construct the actor npcId lookup below.
      return new Map(list.map(record => [record.id, record]));
    }

    function cloneScene(scene) {
      return JSON.parse(JSON.stringify(scene));
    }

    function attachNpcRecords(scene, npcIndex) {
      for (const actor of (scene.actors || [])) {
        if (!actor.npcId) continue;
        actor.npcRecord = npcIndex.get(actor.npcId) || null;
        if (!actor.npcRecord) throw new Error(`prologue NPC not found: ${actor.npcId}`);
      }
      return scene;
    }

    async function buildPayload(stage, worldId, ownerCharacterId) {
      const chapter = await loadChapterData(); // Used to select the authored scene matching the persistent stage.
      const npcIndex = await loadNpcIndex(); // Used to attach real NPC appearance/schedule records to scene actors.
      const sourceScene = chapter.scenes[normalizeStage(stage)]; // Used as the immutable authored scene definition before cloning.
      if (!sourceScene) throw new Error(`unknown prologue stage: ${stage}`);
      const payload = attachNpcRecords(cloneScene(sourceScene), npcIndex); // Used as the exact payload consumed by game.js's existing cutscene runner.
      payload.prologue = { version: PROLOGUE_VERSION, worldId, ownerCharacterId, stage: normalizeStage(stage) };
      return payload;
    }

    function showLaunchOverlay(message, isError = false) {
      let overlay = document.getElementById('prologueLaunchOverlay'); // Used as the persistent full-screen status/error surface during intercepted startup.
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'prologueLaunchOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#050707;color:#f3e6c8;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font:600 16px/1.5 system-ui,sans-serif;';
        const text = document.createElement('div'); // Used to display current prologue loading/error information without requiring a console.
        text.id = 'prologueLaunchOverlayText';
        text.style.cssText = 'max-width:560px;white-space:pre-wrap;';
        overlay.appendChild(text);
        document.body.appendChild(overlay);
      }
      const text = document.getElementById('prologueLaunchOverlayText'); // Used to refresh the already-created overlay message on retries/errors.
      if (text) text.textContent = message;
      overlay.style.background = isError ? '#1b0909' : '#050707';
      return overlay;
    }

    function failLaunch(error) {
      _launchInFlight = false;
      const message = error?.message || String(error || 'Unknown prologue error'); // Used in the visible no-console startup failure report.
      showLaunchOverlay(`The prologue could not start.\n\n${message}\n\nYour world is still locked and no progress was skipped. Reload to return to the save screen.`, true);
      debugLog(`launch failed: ${message}`, 'error');
    }

    async function launchStage(worldId, ownerCharacterId, stage) {
      if (_launchInFlight) return;
      _launchInFlight = true;
      showLaunchOverlay(`Loading prologue — ${stageLabel(stage)}…`);
      try {
        const payload = await buildPayload(stage, worldId, ownerCharacterId); // Used as the one-shot handoff consumed by index.html on the next load.
        writeJsonStorage(PREVIEW_HANDOFF_KEY, payload);
        debugLog(`launching ${worldId}: ${stage}`);
        location.reload();
      } catch (error) {
        failLaunch(error);
      }
    }

    function blockNonOwnerEntry(playerData, event) {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      localStorage.removeItem(PROFILE_KEY);
      showLaunchOverlay('This world is still in its owner-only prologue.\n\nThe owning character must finish the prologue before another character can join it.', true);
      debugLog(`blocked ${playerData?.characterId || 'unknown'} from unfinished world ${playerData?.worldId || 'unknown'}`);
      setTimeout(() => location.reload(), 900);
    }

    function onPlayerReady(event) {
      if (window.__hobunjiCutscenePreview) return;
      const playerData = event?.detail; // Used to identify the selected character/world before game.js receives the same startup event.
      if (!playerData?.worldId || !playerData?.characterId) return;
      let state = getWorldPrologue(playerData.worldId); // Used to decide whether this is a normal world or an unfinished prologue world.
      if (!state && playerData.isNewWorld && playerData.isWorldOwner) {
        state = ensureWorldPrologue(playerData.worldId, playerData.characterId);
      }
      if (!isIncompleteState(state)) return;
      if (!playerData.isWorldOwner || !canCharacterEnterWorld(playerData.worldId, playerData.characterId)) {
        blockNonOwnerEntry(playerData, event);
        return;
      }
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      launchStage(playerData.worldId, playerData.characterId, normalizeStage(state.stage));
    }

    function advanceWorldStage(prologueMeta) {
      const meta = loadMeta(); // Used to atomically advance the matching world's persistent prologue record.
      const world = worldById(meta, prologueMeta?.worldId); // Used to reject stale/foreign preview completion messages.
      if (!world?.prologue || world.ownerCharacterId !== prologueMeta?.ownerCharacterId) return null;
      const currentStage = normalizeStage(world.prologue.stage); // Used to ensure a stale cinematic cannot skip the current persistent stage.
      if (currentStage !== normalizeStage(prologueMeta.stage)) return null;
      const now = Date.now(); // Used as the update/completion timestamp for this successful scene boundary.
      if (currentStage === STAGE_RESCUE) {
        world.prologue.stage = STAGE_HUNUNDI;
        world.prologue.updatedAt = now;
      } else if (currentStage === STAGE_HUNUNDI) {
        world.prologue.stage = STAGE_COMPLETE;
        world.prologue.completed = true;
        world.prologue.updatedAt = now;
        world.prologue.completedAt = now;
      }
      saveMeta(meta);
      return world.prologue;
    }

    async function onSceneFinished(prologueMeta) {
      if (_advanceInFlight) return;
      _advanceInFlight = true;
      try {
        const nextState = advanceWorldStage(prologueMeta); // Used to determine whether to chain scene two or resume normal gameplay.
        if (!nextState) throw new Error('prologue completion did not match the saved world state');
        if (!nextState.completed) {
          const payload = await buildPayload(nextState.stage, prologueMeta.worldId, prologueMeta.ownerCharacterId); // Used to chain directly into scene two without exposing normal gameplay between scenes.
          writeJsonStorage(PREVIEW_HANDOFF_KEY, payload);
          debugLog(`advanced ${prologueMeta.worldId}: ${prologueMeta.stage} → ${nextState.stage}`);
          location.reload();
          return;
        }
        writeJsonStorage(RESUME_KEY, { characterId: prologueMeta.ownerCharacterId, worldId: prologueMeta.worldId, completedAt: Date.now() });
        localStorage.removeItem(PREVIEW_HANDOFF_KEY);
        debugLog(`completed ${prologueMeta.worldId}; normal calendar/gameplay unlocked`);
        location.reload();
      } catch (error) {
        _advanceInFlight = false;
        failLaunch(error);
      }
    }

    function handleCutsceneBanner(text, isError) {
      const prologueMeta = window.__hobunjiCutscenePreview?.prologue; // Used to distinguish a real prologue cinematic from ordinary Director preview mode.
      if (!prologueMeta) return false;
      if (isError) {
        debugLog(`cutscene runner error during ${prologueMeta.stage}: ${text}`, 'error');
        return false;
      }
      if (/\bfinished\.$/.test(String(text || ''))) onSceneFinished(prologueMeta);
      return true;
    }

    function selectedCharacterId() {
      return document.querySelector?.('[data-sl-char].sl-selected')?.dataset?.slChar || null;
    }

    function annotateWorldButton(button, world, selectedCharacter) {
      if (!button || !world || !isIncompleteState(world.prologue)) return;
      const isOwner = selectedCharacter === world.ownerCharacterId; // Used to choose between progress text and the hard owner-only lock presentation.
      const metaEl = button.querySelector?.('.sl-world-meta'); // Used to make prologue progress visible on mobile without opening developer tools.
      const desiredMeta = isOwner
        ? `Prologue — ${stageLabel(world.prologue.stage)} · Calendar not started`
        : '🔒 Prologue in progress · Owner only'; // Used to avoid rewriting identical text and recursively retriggering the childList MutationObserver.
      if (metaEl && metaEl.textContent !== desiredMeta) metaEl.textContent = desiredMeta;
      if (!isOwner) {
        button.disabled = true;
        button.setAttribute?.('aria-disabled', 'true');
        button.title = 'The owning character must finish this world’s prologue first.';
        button.style.opacity = '0.58';
      }
    }

    function refreshSaveSelectLocks() {
      const meta = loadMeta(); // Used to map current save-select world buttons to their persistent owner/prologue records.
      const selectedCharacter = selectedCharacterId(); // Used to decide whether an unfinished world is playable or locked on this save-select render.
      if (!selectedCharacter) {
        maybeResumeCompletedWorld();
        return;
      }
      for (const button of document.querySelectorAll?.('[data-sl-world]') || []) {
        const world = worldById(meta, button.dataset.slWorld); // Used to apply owner/prologue status to an existing member world card.
        annotateWorldButton(button, world, selectedCharacter);
      }
      for (const button of document.querySelectorAll?.('[data-sl-world-join]') || []) {
        const world = worldById(meta, button.dataset.slWorldJoin); // Used to disable joining an unfinished world before membership can be created.
        if (!world || !isIncompleteState(world.prologue)) continue;
        button.disabled = true;
        button.setAttribute?.('aria-disabled', 'true');
        button.title = 'The owning character must finish this world’s prologue first.';
        button.style.opacity = '0.58';
        const badge = button.querySelector?.('.sl-world-join-badge'); // Used to replace the misleading + Join affordance with the actual lock state.
        if (badge && badge.textContent !== '🔒 Prologue') badge.textContent = '🔒 Prologue';
        annotateWorldButton(button, world, selectedCharacter);
      }
      const selectedWorldButton = document.querySelector?.('[data-sl-world].sl-selected'); // Used to catch an unfinished non-owner world that onboarding auto-selected before this patch ran.
      const selectedWorld = selectedWorldButton ? worldById(meta, selectedWorldButton.dataset.slWorld) : null; // Used to hard-disable the Play footer when the selected world itself is locked.
      const playButton = document.getElementById?.('slPlay'); // Used as the final save-select UI gate in addition to the player-ready runtime gate.
      if (playButton && selectedWorld && isIncompleteState(selectedWorld.prologue) && selectedWorld.ownerCharacterId !== selectedCharacter) {
        playButton.disabled = true;
        if (playButton.textContent !== '🔒 Owner must finish prologue') playButton.textContent = '🔒 Owner must finish prologue';
      }
      maybeResumeCompletedWorld();
    }

    function selectorEscape(value) {
      const text = String(value || ''); // Used as the raw save id before inserting it into a data-attribute selector.
      return window.CSS?.escape ? window.CSS.escape(text) : text.replace(/[\"\\]/g, '\\$&');
    }

    function maybeResumeCompletedWorld() {
      if (_resumeClickInFlight || window.__hobunjiCutscenePreview) return;
      const resume = readJsonStorage(RESUME_KEY); // Used to continue seamlessly from the final cinematic through onboarding's existing save-select code.
      if (!resume?.characterId || !resume?.worldId) return;
      const meta = loadMeta(); // Used to verify the remembered transition still points at an existing completed world.
      const world = worldById(meta, resume.worldId); // Used to reject stale resume records instead of clicking an unrelated save.
      if (!world || isIncompleteState(world.prologue)) return;
      const charButton = document.querySelector?.(`[data-sl-char="${selectorEscape(resume.characterId)}"]`); // Used to select the owning character if onboarding auto-selected someone else.
      if (!charButton) return;
      if (!charButton.classList.contains('sl-selected')) {
        _resumeClickInFlight = true;
        charButton.click();
        setTimeout(() => { _resumeClickInFlight = false; refreshSaveSelectLocks(); }, 0);
        return;
      }
      const worldButton = document.querySelector?.(`[data-sl-world="${selectorEscape(resume.worldId)}"]`); // Used to select the just-completed world before invoking onboarding's normal Play path.
      if (!worldButton) return;
      if (!worldButton.classList.contains('sl-selected')) {
        _resumeClickInFlight = true;
        worldButton.click();
        setTimeout(() => { _resumeClickInFlight = false; refreshSaveSelectLocks(); }, 0);
        return;
      }
      const playButton = document.getElementById?.('slPlay'); // Used to enter normal gameplay with onboarding's own restored member data after the prologue is complete.
      if (!playButton || playButton.disabled) return;
      localStorage.removeItem(RESUME_KEY);
      _resumeClickInFlight = true;
      setTimeout(() => playButton.click(), 0);
    }

    function installSaveSelectObserver() {
      if (_saveObserver || !document.documentElement || typeof MutationObserver !== 'function') return;
      _saveObserver = new MutationObserver(() => refreshSaveSelectLocks());
      _saveObserver.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener('click', event => {
        const joinButton = event.target?.closest?.('[data-sl-world-join]'); // Used as a capture-proof UI backstop if a disabled join button is activated programmatically.
        const worldButton = event.target?.closest?.('[data-sl-world]'); // Used as the matching backstop for already-member farmhand cards.
        const targetButton = joinButton || worldButton; // Used to normalize both save-select world-entry surfaces below.
        if (!targetButton) return;
        const worldId = targetButton.dataset.slWorldJoin || targetButton.dataset.slWorld; // Used to resolve the clicked world against persistent prologue state.
        const characterId = selectedCharacterId(); // Used to allow only the actual owning character through an unfinished-world click.
        if (canCharacterEnterWorld(worldId, characterId)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        refreshSaveSelectLocks();
      }, true);
      setTimeout(refreshSaveSelectLocks, 0);
    }

    function installCalendarFreeze(calendar) {
      if (!calendar || calendar.__prologueFreezeAccessor) return;
      const descriptor = Object.getOwnPropertyDescriptor(calendar, 'time01'); // Used to wrap CalendarSystem's existing natural-time scaling accessor rather than replace its behavior.
      if (!descriptor?.get || !descriptor?.set) return;
      Object.defineProperty(calendar, 'time01', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get.call(calendar); },
        set(nextValue) {
          const current = Number(descriptor.get.call(calendar)); // Used to distinguish tiny natural game-loop writes from explicit loads/skips/rollovers.
          const numeric = Number(nextValue); // Used as the normalized candidate calendar value passed by the caller.
          const delta = numeric - current; // Used with the same <=0.02 frame-write boundary CalendarSystem itself uses.
          const isNaturalFrameWrite = window.__hobunjiGameStarted === true && Number.isFinite(delta) && delta > 0 && delta <= 0.02;
          if (isNaturalFrameWrite && shouldFreezeCalendar()) return;
          descriptor.set.call(calendar, nextValue);
        },
      });
      Object.defineProperty(calendar, '__prologueFreezeAccessor', { value: true, configurable: true });
    }

    function wrapCalendarSystem(system) {
      if (!system?.init || system.__prologueInitWrapped) return system;
      const originalInit = system.init; // Used to preserve CalendarSystem's own initialization before layering the prologue freeze accessor.
      system.init = function prologueAwareCalendarInit(injectedDeps) {
        const result = originalInit.apply(this, arguments); // Used to let CalendarSystem install its own natural-time scale first.
        installCalendarFreeze(injectedDeps?.calendar);
        return result;
      };
      Object.defineProperty(system, '__prologueInitWrapped', { value: true, configurable: true });
      return system;
    }

    function installCalendarHook() {
      if (window.CalendarSystem) {
        wrapCalendarSystem(window.CalendarSystem);
        return;
      }
      let calendarSystemValue; // Used as transparent backing storage while intercepting CalendarSystem's later parser-time assignment.
      Object.defineProperty(window, 'CalendarSystem', {
        configurable: true,
        enumerable: true,
        get() { return calendarSystemValue; },
        set(value) { calendarSystemValue = wrapCalendarSystem(value); },
      });
    }

    function shouldFreezeCalendar() {
      const previewState = window.__hobunjiCutscenePreview?.prologue; // Used to freeze the ephemeral cinematic world's natural clock while either prologue scene is running.
      if (previewState) return true;
      const profile = window.__hobunjiPlayerProfile || readJsonStorage(PROFILE_KEY); // Used to freeze a real unfinished owner world during the brief startup window before its cinematic reload.
      if (!profile?.worldId) return false;
      return isIncompleteState(getWorldPrologue(profile.worldId));
    }

    function debugSnapshot(worldId = null) {
      const meta = loadMeta(); // Used to expose persistent state without requiring direct localStorage inspection on mobile.
      const profile = window.__hobunjiPlayerProfile || readJsonStorage(PROFILE_KEY); // Used to include the currently selected character/world in the debug report.
      const targetWorldId = worldId || profile?.worldId || null; // Used to choose the requested/current world for the focused state block.
      const targetWorld = worldById(meta, targetWorldId); // Used as the focused world entry returned to the caller.
      return {
        currentCharacterId: profile?.characterId || null,
        currentWorldId: profile?.worldId || null,
        currentIsOwner: !!profile?.isWorldOwner,
        cutsceneStage: window.__hobunjiCutscenePreview?.prologue?.stage || null,
        calendarFrozen: shouldFreezeCalendar(),
        world: targetWorld ? {
          id: targetWorld.id,
          ownerCharacterId: targetWorld.ownerCharacterId,
          prologue: targetWorld.prologue || null,
        } : null,
        unfinishedWorlds: (meta.worlds || []).filter(world => isIncompleteState(world.prologue)).map(world => ({ id: world.id, ownerCharacterId: world.ownerCharacterId, stage: world.prologue.stage })),
      };
    }

    function debugText(worldId = null) {
      return JSON.stringify(debugSnapshot(worldId), null, 2);
    }

    document.addEventListener('hobunjiPlayerReady', onPlayerReady, true);
    installCalendarHook();
    installSaveSelectObserver();

    return {
      STAGE_RESCUE, STAGE_HUNUNDI, STAGE_COMPLETE,
      ensureWorldPrologue, getWorldPrologue, isIncompleteState, canCharacterEnterWorld,
      shouldFreezeCalendar, refreshSaveSelectLocks, handleCutsceneBanner,
      debugSnapshot, debugText,
    };
  })();

  window.PrologueSystem = PrologueSystem;

  const previewHelpers = window.CutscenePreviewHelpers; // Used to intercept only prologue banners while preserving ordinary Director preview UI.
  if (previewHelpers?.cutscenePreviewBanner && !previewHelpers.__prologueBannerWrapped) {
    const originalPreviewBanner = previewHelpers.cutscenePreviewBanner; // Used as the unchanged fallback for ordinary previews and prologue errors.
    previewHelpers.cutscenePreviewBanner = function prologueAwareCutsceneBanner(text, isError) {
      if (PrologueSystem.handleCutsceneBanner(text, isError)) return;
      return originalPreviewBanner.apply(this, arguments);
    };
    Object.defineProperty(previewHelpers, '__prologueBannerWrapped', { value: true, configurable: true });
  }
})();
