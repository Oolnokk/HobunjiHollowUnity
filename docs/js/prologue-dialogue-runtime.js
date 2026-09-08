(() => {
  'use strict';

  // Gameplay-cutscene dialogue proof of concept.
  //
  // This deliberately uses the ordinary #npcDialogue shell and real live NPC
  // walkers. The prologue supplies only authored actor positions + an ordered
  // line list. Advancing a line automatically changes the active walker, name,
  // portrait, and camera target. It does not move the player and does not call
  // any NPC look-at/headtracking behavior; those remain future per-beat options.
  const RESCUE_MAP_ID = 'map_prologue_rescue'; // Used to scope the temporary automatic-speaker test to the first prologue map.
  const CHAPTER_URL = './config/cutscenes/prologue-chapter.json'; // Used to read authored actor positions and test dialogue lines.
  const MONITOR_MS = 120; // Used to wait for normal game/NPC/dialogue initialization without racing startup.

  let npcDeps = null; // Captured from NpcScheduling.init; supplies the game's real npcWalkers array.
  let cameraDeps = null; // Captured from FarmAnimals.init; supplies the same camera getters/setters used by other gameplay interactions.
  let dialogueBridge = null; // Captured from DialogueContent.init; lets the shared portrait renderer see our current speaker as its dialogue walker.
  let chapterPromise = null; // Caches prologue-chapter.json for the session.
  let stagedActors = new Map(); // npcId -> saved walker/root state, used to restore the NPC after leaving the rescue map.
  let session = null; // Active automatic-speaker dialogue test session.
  let testFinished = false; // Prevents the three-line proof from reopening repeatedly in one rescue-map visit.
  let monitorTimer = 0; // Holds the single readiness/area monitor interval.
  let monitorAttempts = 0; // Used by mobile-visible diagnostics when NPC/camera dependencies are late.
  let targetChanges = 0; // Counts successful automatic speaker/camera-target changes.
  let lastStatus = 'waiting-rescue'; // Human-readable current state for mobile debugging.

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog; // Reuses the existing in-game log for mobile testing.
    if (typeof logger === 'function') {
      try { logger(`[prologue-dialogue] ${message}`, level); return; } catch (_) {}
    }
    console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](`[prologue-dialogue] ${message}`);
  }

  function currentArea() {
    try { return window.GridTileAccessors?.getCurrentArea?.() || null; }
    catch (_) { return null; }
  }

  function rescuePrologueActive() {
    const profile = window.__hobunjiPlayerProfile; // Used to bind the test to the currently selected real world/owner.
    if (!profile?.worldId || !profile?.isWorldOwner) return false;
    const state = window.PrologueSystem?.getWorldPrologue?.(profile.worldId);
    return !!state && !state.completed && state.stage === 'rescue';
  }

  function loadChapter() {
    if (chapterPromise) return chapterPromise;
    chapterPromise = fetch(CHAPTER_URL, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .catch(error => {
        debugLog(`chapter config unavailable: ${error?.message || error}`, 'error');
        return null;
      });
    return chapterPromise;
  }

  function liveWalkers() {
    return Array.isArray(npcDeps?.npcWalkers) ? npcDeps.npcWalkers : [];
  }

  function walkerForNpc(npcId) {
    return liveWalkers().find(walker => String(walker?.rec?.id || '') === String(npcId || '')) || null;
  }

  function walkerRoot(walker) {
    return walker?.root || walker?.avatarGroup || walker?.profile?.root || null;
  }

  function snapshotWalker(walker) {
    const root = walkerRoot(walker); // Used to restore the ordinary scheduler's actor after the prologue map is left.
    if (!root) return null;
    return {
      walker,
      parent: root.parent || null,
      position: { x: root.position?.x || 0, y: root.position?.y || 0, z: root.position?.z || 0 },
      rotationY: root.rotation?.y || 0,
      area: walker.area,
      state: walker.state,
      pause: walker.pause,
      path: Array.isArray(walker.path) ? [...walker.path] : walker.path,
      currentScheduleTarget: walker.currentScheduleTarget,
    };
  }

  function stageActor(actor, scene) {
    const npcId = actor?.npcId; // Used as the real NPC walker id rather than a synthetic portrait-only speaker.
    const walker = walkerForNpc(npcId);
    const root = walkerRoot(walker);
    if (!npcId || !walker || !root || !scene) return false;
    if (!stagedActors.has(npcId)) {
      const saved = snapshotWalker(walker); // Used exactly once so repeated readiness ticks cannot overwrite the true pre-prologue state.
      if (!saved) return false;
      stagedActors.set(npcId, saved);
    }
    const col = Number(actor.col); // Used as the authored rescue-map actor column.
    const row = Number(actor.row); // Used as the authored rescue-map actor row.
    const rotY = Number(actor.rotY); // Used as the authored body yaw; no automatic look-at-player rule is applied.
    scene.add(root);
    root.position.set(Number.isFinite(col) ? col + 0.5 : 12.5, 0, Number.isFinite(row) ? row + 0.5 : 12.5);
    if (Number.isFinite(rotY)) root.rotation.y = rotY;
    walker.area = RESCUE_MAP_ID;
    walker.state = 'idle';
    walker.pause = Infinity;
    walker.path = [];
    walker.currentScheduleTarget = null;
    return true;
  }

  function restoreStagedActors() {
    for (const saved of stagedActors.values()) {
      const walker = saved.walker;
      const root = walkerRoot(walker);
      if (!walker || !root) continue;
      if (saved.parent?.add) saved.parent.add(root);
      else root.parent?.remove?.(root);
      root.position?.set?.(saved.position.x, saved.position.y, saved.position.z);
      if (root.rotation) root.rotation.y = saved.rotationY;
      walker.area = saved.area;
      walker.state = saved.state;
      walker.pause = saved.pause;
      walker.path = saved.path;
      walker.currentScheduleTarget = saved.currentScheduleTarget;
    }
    stagedActors.clear();
  }

  function openDialogueShell() {
    window.WorldPopupText?.clearInteractionPrompts?.();
    document.getElementById('arcContainer')?.classList.add('arc-hidden');
    const dialogueEl = document.getElementById('npcDialogue'); // Used as the exact ordinary gameplay dialogue surface.
    dialogueEl?.classList.add('open');
    dialogueEl?.setAttribute('aria-hidden', 'false');
  }

  function closeDialogueShell() {
    const dialogueEl = document.getElementById('npcDialogue'); // Used to close only the shared gameplay shell without invoking ordinary NPC staging teardown.
    dialogueEl?.classList.remove('open');
    dialogueEl?.setAttribute('aria-hidden', 'true');
    document.getElementById('arcContainer')?.classList.remove('arc-hidden');
  }

  function dialogueCameraMode() {
    return cameraDeps?.cameraConfig?.()?.dialogueMode || 'npcDialogue';
  }

  function showLine(index) {
    if (!session) return false;
    const line = session.lines[index]; // Used as the authored line whose speaker becomes the active dialogue target.
    if (!line) return false;
    const walker = walkerForNpc(line.speakerNpcId);
    const root = walkerRoot(walker);
    if (!walker || !root) {
      lastStatus = `missing-speaker:${line.speakerNpcId || 'unknown'}`;
      debugLog(`cannot target dialogue speaker ${line.speakerNpcId || 'unknown'}: live walker unavailable`, 'warn');
      return false;
    }
    session.index = index;
    session.walker = walker;
    session.speakerNpcId = line.speakerNpcId;
    const rec = walker.rec || { id: line.speakerNpcId, name: line.speakerNpcId };
    const nameEl = document.getElementById('npcDialogueName'); // Used to visibly prove the speaker changed along with the camera target.
    const textEl = document.getElementById('npcDialogueText'); // Used as the normal gameplay dialogue text surface; test lines display immediately for fast target testing.
    const heartsEl = document.getElementById('npcDialogueHearts'); // Used to retain ordinary NPC relationship presentation where available.
    if (nameEl) nameEl.textContent = rec.name || line.speakerNpcId;
    if (heartsEl) heartsEl.textContent = window.DialogueContent?.renderRelationshipHearts?.(rec) || '';
    window.DialogueContent?.stopNpcDialogueTypewriter?.(false);
    if (textEl) textEl.textContent = String(line.text || '...');
    cameraDeps?.setCameraMode?.(dialogueCameraMode());
    cameraDeps?.setCameraTarget?.(root);
    window.DialogueContent?.hideChoiceButtons?.();
    Promise.resolve(window.DialogueContent?.renderNpcDialoguePortrait?.()).catch(() => {});
    targetChanges++;
    lastStatus = `line-${index + 1}:${line.speakerNpcId}`;
    debugLog(`line ${index + 1}/${session.lines.length} target → ${rec.name || line.speakerNpcId}`);
    return true;
  }

  function closeDialogueTest({ completed = false } = {}) {
    const active = session;
    if (!active) return false;
    session = null;
    window.DialogueContent?.stopNpcDialogueTypewriter?.(false);
    window.DialogueContent?.hideChoiceButtons?.();
    window.DialogueContent?.resetDialogueState?.();
    closeDialogueShell();
    cameraDeps?.setCameraMode?.(active.prevCameraMode ?? (cameraDeps?.cameraConfig?.()?.defaultMode || 'default'));
    cameraDeps?.setCameraTarget?.(active.prevCameraTarget ?? null);
    if (completed) testFinished = true;
    lastStatus = completed ? 'test-complete' : 'test-closed';
    return true;
  }

  function advanceDialogueTest() {
    if (!session) return false;
    const nextIndex = session.index + 1; // Used to make speaker changes automatic from authored line order, never another NPC click/selection.
    if (nextIndex >= session.lines.length) {
      closeDialogueTest({ completed: true });
      return true;
    }
    return showLine(nextIndex);
  }

  async function startDialogueTest() {
    if (session || testFinished || currentArea() !== RESCUE_MAP_ID || !rescuePrologueActive()) return false;
    if (!npcDeps || !cameraDeps || !dialogueBridge || !window.DialogueContent) return false;
    const chapter = await loadChapter(); // Used as the authored source for both temporary actor staging and automatic speaker order.
    const rescue = chapter?.stages?.rescue;
    const actors = Array.isArray(rescue?.actors) ? rescue.actors : [];
    const lines = Array.isArray(rescue?.dialogue) ? rescue.dialogue : [];
    if (!actors.length || lines.length < 2) {
      lastStatus = 'missing-authored-test-data';
      return false;
    }
    const scene = window.GridTileAccessors?.getActiveScene?.(); // Used as the already-loaded real rescue gameplay scene receiving the two real NPC roots.
    if (!scene) return false;
    const staged = actors.every(actor => stageActor(actor, scene));
    if (!staged) {
      lastStatus = 'waiting-live-speakers';
      return false;
    }
    session = {
      lines,
      index: -1,
      walker: null,
      speakerNpcId: null,
      prevCameraMode: cameraDeps?.getCameraMode?.(),
      prevCameraTarget: cameraDeps?.getCameraTarget?.(),
    };
    openDialogueShell();
    lastStatus = 'opening-test';
    return showLine(0);
  }

  async function monitor() {
    monitorAttempts++;
    if (currentArea() !== RESCUE_MAP_ID || !rescuePrologueActive()) {
      if (session) closeDialogueTest({ completed: false });
      if (stagedActors.size) restoreStagedActors();
      lastStatus = 'waiting-rescue';
      return;
    }
    if (testFinished || session) return;
    if (!window.PrologueRescueMapRuntime?.rescueMapReady?.()) {
      lastStatus = 'waiting-rescue-ready';
      return;
    }
    const started = await startDialogueTest();
    if (!started && monitorAttempts % 25 === 0) {
      debugLog(`waiting to start target test (${lastStatus}); npc=${!!npcDeps} camera=${!!cameraDeps} dialogue=${!!dialogueBridge}`, 'warn');
    }
  }

  function wrapNpcScheduling(api) {
    if (!api?.init || api.__prologueDialogueTargetWrapped) return api;
    const originalInit = api.init.bind(api); // Preserves scheduler setup while capturing the authoritative npcWalkers array.
    api.init = function prologueDialogueNpcSchedulingInit(injectedDeps) {
      npcDeps = injectedDeps || null;
      return originalInit(injectedDeps);
    };
    Object.defineProperty(api, '__prologueDialogueTargetWrapped', { value: true, configurable: true });
    return api;
  }

  function wrapFarmAnimals(api) {
    if (!api?.init || api.__prologueDialogueTargetWrapped) return api;
    const originalInit = api.init.bind(api); // Preserves FarmAnimals while capturing camera mode/target getters and setters already used by livestock dialogue.
    api.init = function prologueDialogueFarmAnimalsInit(injectedDeps) {
      cameraDeps = injectedDeps || null;
      return originalInit(injectedDeps);
    };
    Object.defineProperty(api, '__prologueDialogueTargetWrapped', { value: true, configurable: true });
    return api;
  }

  function wrapDialogueContent(api) {
    if (!api?.init || api.__prologueDialogueTargetWrapped) return api;
    const originalInit = api.init.bind(api); // Usually already contains LivestockDialogue's bridge; this wrapper composes on top of it.
    api.init = function prologueDialogueContentInit(injectedDeps) {
      const source = injectedDeps || {};
      const gameGetDialogueOpen = source.getDialogueOpen; // Used to preserve ordinary NPC/livestock dialogue detection outside our session.
      const gameGetDialogueWalker = source.getDialogueWalker; // Used to fall through to ordinary dialogue when no prologue line is active.
      const gameCloseNpcDialogue = source.closeNpcDialogue; // Used to preserve ordinary close behavior outside our session.
      dialogueBridge = { gameGetDialogueOpen, gameGetDialogueWalker, gameCloseNpcDialogue };
      return originalInit({
        ...source,
        getDialogueOpen: () => !!session || !!gameGetDialogueOpen?.(),
        getDialogueWalker: () => session?.walker || gameGetDialogueWalker?.(),
        closeNpcDialogue: () => session ? closeDialogueTest({ completed: false }) : gameCloseNpcDialogue?.(),
      });
    };
    Object.defineProperty(api, '__prologueDialogueTargetWrapped', { value: true, configurable: true });
    return api;
  }

  function chainGlobal(name, installer) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Used to chain cleanly onto LivestockDialogue/other early global watchers.
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get.call(window); },
        set(value) {
          descriptor.set.call(window, value);
          const installed = descriptor.get.call(window);
          if (installed) installer(installed);
        },
      });
      const existing = descriptor.get.call(window);
      if (existing) installer(existing);
      return;
    }
    if (window[name]) { installer(window[name]); return; }
    let stored = null; // Used only if the observed namespace has not been assigned yet.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return stored; },
      set(value) { stored = installer(value); },
    });
  }

  document.addEventListener('click', event => {
    if (!session) return;
    const id = event.target?.closest?.('#npcDialogueContinue,#npcDialogueLeave')?.id;
    if (!id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (id === 'npcDialogueLeave') closeDialogueTest({ completed: true });
    else advanceDialogueTest();
  }, true);

  // Restore the temporarily staged real NPC walkers before the existing test
  // control moves the player into Hunundi's room.
  document.addEventListener('click', event => {
    if (!event.target?.closest?.('#prologueMapFlowContinue')) return;
    if (session) closeDialogueTest({ completed: true });
    restoreStagedActors();
  }, true);

  chainGlobal('NpcScheduling', wrapNpcScheduling);
  chainGlobal('FarmAnimals', wrapFarmAnimals);
  chainGlobal('DialogueContent', wrapDialogueContent);
  monitorTimer = setInterval(monitor, MONITOR_MS);

  window.PrologueDialogueRuntime = Object.freeze({
    startDialogueTest,
    advanceDialogueTest,
    closeDialogueTest,
    restoreStagedActors,
    debugSnapshot: () => ({
      currentArea: currentArea(),
      rescueActive: rescuePrologueActive(),
      npcDepsReady: !!npcDeps,
      cameraDepsReady: !!cameraDeps,
      dialogueBridgeReady: !!dialogueBridge,
      stagedNpcIds: [...stagedActors.keys()],
      active: !!session,
      lineIndex: session?.index ?? null,
      speakerNpcId: session?.speakerNpcId || null,
      targetChanges,
      testFinished,
      monitorAttempts,
      lastStatus,
    }),
  });
})();
