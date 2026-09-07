(() => {
  'use strict';

  // World-owner prologue, first gameplay-map pass.
  //
  // This deliberately does NOT use Cutscene Director preview mode. A prologue
  // stage is a real loaded game area with a temporary scripted-control layer:
  // the player is movement/tool/action locked, while the ordinary map runtime
  // owns terrain, grass/material selection, fog, interiors, loading screens,
  // NPCs, camera rendering, and every other environmental system.
  //
  // The next cutscene pass will drive the existing gameplay dialogue panel on
  // top of these maps. Its authored contract lives in prologue-chapter.json:
  // the speaker swaps automatically per line; player position is not moved;
  // NPC facing/headtracking are explicit authored behaviors, not implicit
  // "look at the player" behavior.
  const PrologueSystem = (() => {
    const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used to persist world-scoped prologue progress and owner gating.
    const PROFILE_KEY = 'hobunjiPlayerProfile'; // Used to identify the current member during calendar/debug checks.
    const CHAPTER_URL = './config/cutscenes/prologue-chapter.json'; // Used to resolve each prologue stage to a normal game map.
    const PROLOGUE_VERSION = 2; // Used to distinguish the real-map prologue state from the removed preview-handoff implementation.
    const STAGE_RESCUE = 'rescue'; // Used as the first persistent stage for a newly created owned world.
    const STAGE_HUNUNDI = 'hunundi_room'; // Used as the second persistent stage in Father Hunundi's authored room.
    const STAGE_COMPLETE = 'complete'; // Used to unlock other characters and the natural calendar tick.
    const PLAYER_LOCK_ID = 'player'; // Used by CharacterActionLocks while a gameplay cutscene stage owns player control.
    const FALLBACK_STAGES = Object.freeze({
      rescue: { kind: 'zone', mapId: 'map_southern_cloud_forest' },
      hunundi_room: { kind: 'building', mapId: 'map_i_temple_basement_hunundi' },
    }); // Used only if the authored chapter JSON cannot be fetched; normal map loading still remains available.

    let _runtimeDeps = null; // Captured from ActionArcUI.init; used for normal enterZone/enterBuilding/startSceneTransition calls.
    let _activeProfile = null; // Captured from hobunjiPlayerReady; used to enter the selected owner's saved prologue stage after boot.
    let _chapterPromise = null; // Caches prologue-chapter.json so repeated stage checks do not refetch it.
    let _stageLock = null; // CharacterActionLocks handle that keeps gameplay input disabled during the current prologue stage.
    let _transitionInFlight = false; // Prevents repeated observer/timer callbacks from starting the same normal map transition twice.
    let _entryRetryTimer = 0; // Retries stage entry until game.js has finished ordinary world startup and module initialization.
    let _saveObserver = null; // Keeps owner-only labels/buttons correct when onboarding rerenders save-select DOM.

    function debugLog(message, level = 'info') {
      const logger = window.__farmLog; // Used to route prologue diagnostics into the existing mobile-visible game log when available.
      if (typeof logger === 'function') {
        try { logger(`[prologue] ${message}`, level); return; } catch (_) {}
      }
      console[level === 'error' ? 'error' : 'log'](`[prologue] ${message}`);
    }

    function readJsonStorage(key, fallback = null) {
      const raw = localStorage.getItem(key); // Used as the serialized localStorage value being decoded.
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
      const meta = loadMeta(); // Used to locate and mutate the newly created target world.
      const world = worldById(meta, worldId); // Used as the world receiving the persistent prologue record.
      if (!world) return null;
      if (!world.prologue || typeof world.prologue !== 'object') {
        const now = Date.now(); // Used for debug-friendly creation/update timestamps on this world state.
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
        // Preserve already-started PR test worlds while migrating away from
        // the old preview handoff. Their stage is still meaningful; only the
        // transport/runtime implementation changed.
        world.prologue.version = PROLOGUE_VERSION;
        world.prologue.stage = normalizeStage(world.prologue.completed ? STAGE_COMPLETE : world.prologue.stage);
        world.prologue.completed = world.prologue.stage === STAGE_COMPLETE || !!world.prologue.completed;
        world.prologue.ownerCharacterId ||= world.ownerCharacterId || ownerCharacterId || null;
        saveMeta(meta);
      }
      return world.prologue;
    }

    function getWorldPrologue(worldId) {
      const meta = loadMeta(); // Used only to read the requested world's current persistent stage.
      return worldById(meta, worldId)?.prologue || null;
    }

    function isIncompleteState(state) {
      return !!state && !state.completed && normalizeStage(state.stage) !== STAGE_COMPLETE;
    }

    function canCharacterEnterWorld(worldId, characterId) {
      const meta = loadMeta(); // Used to resolve both target-world ownership and current prologue state.
      const world = worldById(meta, worldId); // Used as the entry-gate target.
      if (!world || !isIncompleteState(world.prologue)) return true;
      return !!characterId && characterId === world.ownerCharacterId;
    }

    function stageLabel(stage) {
      if (stage === STAGE_RESCUE) return 'Cloud Forest rescue';
      if (stage === STAGE_HUNUNDI) return "Hunundi's room";
      return 'Complete';
    }

    async function loadChapter() {
      if (_chapterPromise) return _chapterPromise;
      _chapterPromise = fetch(CHAPTER_URL, { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .catch(error => {
          debugLog(`chapter config unavailable (${error?.message || error}); using built-in normal-map fallbacks`, 'error');
          return { stages: FALLBACK_STAGES };
        });
      return _chapterPromise;
    }

    async function stageSpec(stage) {
      const normalized = normalizeStage(stage); // Used to select the authored normal-map stage definition.
      if (normalized === STAGE_COMPLETE) return null;
      const chapter = await loadChapter(); // Used as the canonical stage-to-map mapping when available.
      const authored = chapter?.stages?.[normalized]; // Used as the selected map definition from prologue-chapter.json.
      return authored?.mapId ? authored : FALLBACK_STAGES[normalized];
    }

    function acquireStageLock() {
      if (_stageLock) return _stageLock;
      _stageLock = window.CharacterActionLocks?.acquire?.({
        owner: 'world-prologue',
        reason: 'gameplay cutscene',
        participants: [{ id: PLAYER_LOCK_ID, channels: ['movement', 'tools', 'actions'] }],
      }) || null; // Used to keep the player's in-world position fixed without moving them for a cutscene beat.
      return _stageLock;
    }

    function releaseStageLock() {
      if (!_stageLock) return;
      try { _stageLock.release?.(); } catch (_) { window.CharacterActionLocks?.release?.(_stageLock); }
      _stageLock = null;
    }

    function currentArea() {
      try { return _runtimeDeps?.getCurrentArea?.() || null; }
      catch (_) { return null; }
    }

    function ensureStageControls(stage) {
      let panel = document.getElementById('prologueMapFlowTest'); // Used as a temporary no-console control for testing both real-map stages.
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'prologueMapFlowTest';
        panel.style.cssText = 'position:fixed;left:12px;top:12px;z-index:99990;max-width:min(78vw,360px);padding:10px 12px;border:1px solid rgba(255,255,255,.35);border-radius:9px;background:rgba(12,14,16,.88);color:#fff;font:600 12px/1.35 system-ui,sans-serif;box-shadow:0 5px 16px rgba(0,0,0,.35);';
        const title = document.createElement('div'); // Used to show the currently persisted prologue stage while testing on mobile.
        title.id = 'prologueMapFlowTitle';
        title.style.cssText = 'margin-bottom:7px;';
        panel.appendChild(title);
        const note = document.createElement('div'); // Used to make clear this control is temporary and not the intended final cutscene UI.
        note.textContent = 'Temporary real-map flow test';
        note.style.cssText = 'font-weight:400;opacity:.7;margin-bottom:8px;';
        panel.appendChild(note);
        const button = document.createElement('button'); // Used to advance maps until authored gameplay dialogue owns scene completion.
        button.id = 'prologueMapFlowContinue';
        button.type = 'button';
        button.style.cssText = 'width:100%;padding:7px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.45);background:#302a25;color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer;';
        button.addEventListener('click', () => advanceStageForTest());
        panel.appendChild(button);
        document.body.appendChild(panel);
      }
      const title = document.getElementById('prologueMapFlowTitle'); // Used to refresh the current stage after a normal in-page map transition.
      const button = document.getElementById('prologueMapFlowContinue'); // Used to refresh the correct next-stage action label.
      if (title) title.textContent = `Prologue: ${stageLabel(stage)}`;
      if (button) button.textContent = stage === STAGE_RESCUE ? "Continue to Hunundi's room" : 'Finish prologue map test';
      panel.style.display = '';
    }

    function hideStageControls() {
      const panel = document.getElementById('prologueMapFlowTest'); // Used to remove the temporary test control once normal gameplay is unlocked.
      if (panel) panel.remove();
    }

    function scheduleStageEntry(delayMs = 0) {
      if (_entryRetryTimer) clearTimeout(_entryRetryTimer);
      _entryRetryTimer = setTimeout(() => {
        _entryRetryTimer = 0;
        maybeEnterCurrentStage();
      }, Math.max(0, Number(delayMs) || 0));
    }

    async function maybeEnterCurrentStage() {
      const profile = _activeProfile || window.__hobunjiPlayerProfile || readJsonStorage(PROFILE_KEY); // Used to resolve the active owner/world after ordinary game startup.
      if (!profile?.worldId || !profile?.characterId) return;
      const state = getWorldPrologue(profile.worldId); // Used to select the persisted real-map stage on login/re-entry.
      if (!isIncompleteState(state)) {
        releaseStageLock();
        hideStageControls();
        return;
      }
      if (!canCharacterEnterWorld(profile.worldId, profile.characterId)) return;
      if (!_runtimeDeps || window.__hobunjiGameStarted !== true) {
        scheduleStageEntry(100);
        return;
      }
      const spec = await stageSpec(state.stage); // Used to choose ordinary wilderness-vs-building entry behavior for this stage.
      if (!spec?.mapId) return;
      acquireStageLock();
      ensureStageControls(state.stage);
      if (currentArea() === spec.mapId) return;
      if (_transitionInFlight) return;
      _transitionInFlight = true;
      debugLog(`entering real map ${spec.mapId} for ${state.stage}`);
      try {
        const runTransition = () => {
          if (spec.kind === 'building') return _runtimeDeps.enterBuilding(spec.mapId);
          const col = Number(spec.entryCol); // Used only when a future authored stage requests an ordinary zone-entry column.
          const row = Number(spec.entryRow); // Used only when a future authored stage requests an ordinary zone-entry row.
          return Number.isFinite(col) && Number.isFinite(row)
            ? _runtimeDeps.enterZone(spec.mapId, col, row)
            : _runtimeDeps.enterZone(spec.mapId);
        };
        _runtimeDeps.startSceneTransition(runTransition);
      } catch (error) {
        debugLog(`normal map transition failed: ${error?.message || error}`, 'error');
      } finally {
        // A synchronous wilderness rebuild blocks this timer naturally; an
        // asynchronous transition gets a generous quiet period before retry.
        setTimeout(() => {
          _transitionInFlight = false;
          scheduleStageEntry(250);
        }, 1500);
      }
    }

    function setWorldStage(worldId, expectedStage, nextStage) {
      const meta = loadMeta(); // Used to atomically advance only the currently expected saved prologue stage.
      const world = worldById(meta, worldId); // Used as the world whose map-flow stage is advancing.
      if (!world?.prologue || normalizeStage(world.prologue.stage) !== normalizeStage(expectedStage)) return null;
      const now = Date.now(); // Used as the saved stage-change/completion timestamp.
      world.prologue.version = PROLOGUE_VERSION;
      world.prologue.stage = normalizeStage(nextStage);
      world.prologue.completed = world.prologue.stage === STAGE_COMPLETE;
      world.prologue.updatedAt = now;
      if (world.prologue.completed) world.prologue.completedAt = now;
      saveMeta(meta);
      return world.prologue;
    }

    async function advanceStageForTest() {
      const profile = _activeProfile || window.__hobunjiPlayerProfile || readJsonStorage(PROFILE_KEY); // Used to advance only the active owner's currently loaded prologue world.
      if (!profile?.worldId || !profile?.characterId || !canCharacterEnterWorld(profile.worldId, profile.characterId)) return false;
      const state = getWorldPrologue(profile.worldId); // Used to determine the next normal map in the temporary map-flow test.
      if (!isIncompleteState(state)) return false;
      if (state.stage === STAGE_RESCUE) {
        const next = setWorldStage(profile.worldId, STAGE_RESCUE, STAGE_HUNUNDI); // Used to persist room two before transitioning into it.
        if (!next) return false;
        _transitionInFlight = false;
        scheduleStageEntry(0);
        return true;
      }
      if (state.stage === STAGE_HUNUNDI) {
        const next = setWorldStage(profile.worldId, STAGE_HUNUNDI, STAGE_COMPLETE); // Used to unlock the world when the room-loading test is finished.
        if (!next) return false;
        releaseStageLock();
        hideStageControls();
        debugLog(`${profile.worldId} prologue map-flow test complete; calendar and other characters unlocked`);
        return true;
      }
      return false;
    }

    function showBlockedEntry(playerData) {
      let overlay = document.getElementById('prologueOwnerGate'); // Used as a no-console explanation while returning an invalid farmhand entry to save select.
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'prologueOwnerGate';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#130909;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font:600 16px/1.45 system-ui,sans-serif;';
        document.body.appendChild(overlay);
      }
      overlay.textContent = 'This world is still in its owner-only prologue. Returning to world selection…';
      debugLog(`blocked ${playerData?.characterId || 'unknown'} from unfinished world ${playerData?.worldId || 'unknown'}`);
    }

    function blockNonOwnerEntry(playerData, event) {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      localStorage.removeItem(PROFILE_KEY);
      window.__hobunjiPlayerProfile = null;
      showBlockedEntry(playerData);
      // This reload is only the impossible/forged-entry safety backstop; the
      // actual prologue stage flow never reloads the page.
      setTimeout(() => location.reload(), 650);
    }

    function onPlayerReady(event) {
      if (window.__hobunjiCutscenePreview) return; // Director preview remains its own dev-tool mode and is not treated as a real world prologue.
      const playerData = event?.detail; // Used to initialize/select the persistent prologue before game.js finishes ordinary startup.
      if (!playerData?.worldId || !playerData?.characterId) return;
      _activeProfile = playerData;
      let state = getWorldPrologue(playerData.worldId); // Used to distinguish existing worlds from newly-created worlds that require the prologue.
      if (!state && playerData.isNewWorld && playerData.isWorldOwner) {
        state = ensureWorldPrologue(playerData.worldId, playerData.characterId);
      }
      if (!isIncompleteState(state)) return;
      if (!playerData.isWorldOwner || !canCharacterEnterWorld(playerData.worldId, playerData.characterId)) {
        blockNonOwnerEntry(playerData, event);
        return;
      }
      // IMPORTANT: owner startup is intentionally NOT prevented. game.js must
      // initialize the real world/calendar/season/material systems first; only
      // then does maybeEnterCurrentStage() use ordinary map-entry functions.
      scheduleStageEntry(0);
    }

    function selectedCharacterId() {
      return document.querySelector?.('[data-sl-char].sl-selected')?.dataset?.slChar || null;
    }

    function annotateWorldButton(button, world, selectedCharacter) {
      if (!button || !world || !isIncompleteState(world.prologue)) return;
      const isOwner = selectedCharacter === world.ownerCharacterId; // Used to choose progress text versus the owner-only lock message.
      const metaEl = button.querySelector?.('.sl-world-meta'); // Used to surface prologue state without developer tools.
      const desiredMeta = isOwner
        ? `Prologue — ${stageLabel(world.prologue.stage)} · Calendar not started`
        : '🔒 Prologue in progress · Owner only'; // Used to avoid recursive MutationObserver churn from identical text writes.
      if (metaEl && metaEl.textContent !== desiredMeta) metaEl.textContent = desiredMeta;
      if (!isOwner) {
        button.disabled = true;
        button.setAttribute?.('aria-disabled', 'true');
        button.title = 'The owning character must finish this world’s prologue first.';
        button.style.opacity = '0.58';
      }
    }

    function refreshSaveSelectLocks() {
      const meta = loadMeta(); // Used to map current save-select cards to persistent world ownership/prologue records.
      const selectedCharacter = selectedCharacterId(); // Used to decide whether each unfinished world card is playable.
      if (!selectedCharacter) return;
      for (const button of document.querySelectorAll?.('[data-sl-world]') || []) {
        const world = worldById(meta, button.dataset.slWorld); // Used to annotate an already-member world card.
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
      const selectedWorldButton = document.querySelector?.('[data-sl-world].sl-selected'); // Used to catch an auto-selected unfinished non-owner membership.
      const selectedWorld = selectedWorldButton ? worldById(meta, selectedWorldButton.dataset.slWorld) : null; // Used by the final Play-button gate below.
      const playButton = document.getElementById?.('slPlay'); // Used as the visible final save-select gate in addition to capture-phase player-ready protection.
      if (playButton && selectedWorld && isIncompleteState(selectedWorld.prologue) && selectedWorld.ownerCharacterId !== selectedCharacter) {
        playButton.disabled = true;
        if (playButton.textContent !== '🔒 Owner must finish prologue') playButton.textContent = '🔒 Owner must finish prologue';
      }
    }

    function installSaveSelectObserver() {
      if (_saveObserver || !document.documentElement || typeof MutationObserver !== 'function') return;
      _saveObserver = new MutationObserver(() => refreshSaveSelectLocks());
      _saveObserver.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener('click', event => {
        const joinButton = event.target?.closest?.('[data-sl-world-join]'); // Used as a capture-phase backstop for Join World cards.
        const worldButton = event.target?.closest?.('[data-sl-world]'); // Used as the matching backstop for member world cards.
        const targetButton = joinButton || worldButton; // Used to normalize both entry surfaces.
        if (!targetButton) return;
        const worldId = targetButton.dataset.slWorldJoin || targetButton.dataset.slWorld; // Used to resolve the clicked world against persistent state.
        const characterId = selectedCharacterId(); // Used to allow the actual owner through while blocking every other character.
        if (canCharacterEnterWorld(worldId, characterId)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        refreshSaveSelectLocks();
      }, true);
      setTimeout(refreshSaveSelectLocks, 0);
    }

    function installCalendarFreeze(calendar) {
      if (!calendar || calendar.__prologueFreezeAccessor) return;
      const descriptor = Object.getOwnPropertyDescriptor(calendar, 'time01'); // Used to wrap CalendarSystem's existing natural-time accessor after its own initialization.
      if (!descriptor?.get || !descriptor?.set) return;
      Object.defineProperty(calendar, 'time01', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get.call(calendar); },
        set(nextValue) {
          const current = Number(descriptor.get.call(calendar)); // Used to distinguish tiny natural game-loop writes from explicit load/wait/rollover writes.
          const numeric = Number(nextValue); // Used as the normalized candidate time value.
          const delta = numeric - current; // Used with CalendarSystem's same <=0.02 natural-frame boundary.
          const isNaturalFrameWrite = window.__hobunjiGameStarted === true && Number.isFinite(delta) && delta > 0 && delta <= 0.02;
          if (isNaturalFrameWrite && shouldFreezeCalendar()) return;
          descriptor.set.call(calendar, nextValue);
        },
      });
      Object.defineProperty(calendar, '__prologueFreezeAccessor', { value: true, configurable: true });
    }

    function wrapCalendarSystem(system) {
      if (!system?.init || system.__prologueInitWrapped) return system;
      const originalInit = system.init; // Used to preserve CalendarSystem's own natural-time scaling setup before adding the prologue freeze.
      system.init = function prologueAwareCalendarInit(injectedDeps) {
        const result = originalInit.apply(this, arguments); // Used to initialize the normal calendar/season runtime first.
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
      let calendarSystemValue; // Used as backing storage while intercepting CalendarSystem's later parser-time assignment.
      Object.defineProperty(window, 'CalendarSystem', {
        configurable: true,
        enumerable: true,
        get() { return calendarSystemValue; },
        set(value) { calendarSystemValue = wrapCalendarSystem(value); },
      });
    }

    function wrapActionArcUI(system) {
      if (!system?.init || system.__prologueRuntimeWrapped) return system;
      const originalInit = system.init; // Used to capture the existing transition deps without duplicating game.js area-loading internals.
      system.init = function prologueAwareActionArcInit(injectedDeps) {
        _runtimeDeps = injectedDeps; // Used by maybeEnterCurrentStage for the exact same enterZone/enterBuilding functions gameplay already uses.
        const result = originalInit.apply(this, arguments); // Used to preserve all ordinary action-arc listener setup.
        scheduleStageEntry(0);
        return result;
      };
      Object.defineProperty(system, '__prologueRuntimeWrapped', { value: true, configurable: true });
      return system;
    }

    function installActionArcHook() {
      if (window.ActionArcUI) {
        wrapActionArcUI(window.ActionArcUI);
        return;
      }
      let actionArcValue; // Used as backing storage because action-arc-ui.js loads after this early prologue bootstrap.
      Object.defineProperty(window, 'ActionArcUI', {
        configurable: true,
        enumerable: true,
        get() { return actionArcValue; },
        set(value) { actionArcValue = wrapActionArcUI(value); },
      });
    }

    function shouldFreezeCalendar() {
      const profile = _activeProfile || window.__hobunjiPlayerProfile || readJsonStorage(PROFILE_KEY); // Used to identify the real currently selected world, never an ephemeral preview world.
      if (!profile?.worldId) return false;
      return isIncompleteState(getWorldPrologue(profile.worldId));
    }

    function debugSnapshot(worldId = null) {
      const meta = loadMeta(); // Used to expose persistent state without direct localStorage inspection on mobile.
      const profile = _activeProfile || window.__hobunjiPlayerProfile || readJsonStorage(PROFILE_KEY); // Used to include the current character/world in the report.
      const targetWorldId = worldId || profile?.worldId || null; // Used to select the focused world entry.
      const targetWorld = worldById(meta, targetWorldId); // Used as the focused persistent world record.
      const stage = normalizeStage(targetWorld?.prologue?.stage); // Used to report the map expected for the focused stage.
      return {
        model: 'normal-gameplay-map',
        currentCharacterId: profile?.characterId || null,
        currentWorldId: profile?.worldId || null,
        currentArea: currentArea(),
        calendarFrozen: shouldFreezeCalendar(),
        playerLocked: !!_stageLock,
        transitionInFlight: _transitionInFlight,
        expectedMap: stage === STAGE_RESCUE ? FALLBACK_STAGES.rescue.mapId : stage === STAGE_HUNUNDI ? FALLBACK_STAGES.hunundi_room.mapId : null,
        world: targetWorld ? { id: targetWorld.id, ownerCharacterId: targetWorld.ownerCharacterId, prologue: targetWorld.prologue || null } : null,
        unfinishedWorlds: (meta.worlds || []).filter(world => isIncompleteState(world.prologue)).map(world => ({ id: world.id, ownerCharacterId: world.ownerCharacterId, stage: world.prologue.stage })),
      };
    }

    function debugText(worldId = null) {
      return JSON.stringify(debugSnapshot(worldId), null, 2);
    }

    document.addEventListener('hobunjiPlayerReady', onPlayerReady, true);
    installCalendarHook();
    installActionArcHook();
    installSaveSelectObserver();

    return {
      STAGE_RESCUE, STAGE_HUNUNDI, STAGE_COMPLETE,
      ensureWorldPrologue, getWorldPrologue, isIncompleteState, canCharacterEnterWorld,
      shouldFreezeCalendar, refreshSaveSelectLocks,
      enterCurrentStage: () => { _transitionInFlight = false; scheduleStageEntry(0); },
      advanceStageForTest,
      debugSnapshot, debugText,
    };
  })();

  window.PrologueSystem = PrologueSystem;
})();
