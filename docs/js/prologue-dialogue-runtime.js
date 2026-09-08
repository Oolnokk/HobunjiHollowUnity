(() => {
  'use strict';

  // Scripted gameplay-cutscene dialogue for the prologue rescue stage.
  //
  // Loader ownership deliberately lives in PrologueRescueMapRuntime. This
  // module only constructs scripted actors, primes the ordinary gameplay
  // dialogue surface, and reports readiness. Keeping DOM loader ownership in
  // one module prevents competing MutationObservers from pinning the overlay.
  const RESCUE_MAP_ID = 'map_prologue_rescue'; // First prologue stage.
  const CHAPTER_URL = './config/cutscenes/prologue-chapter.json'; // Authored actors/line order.
  const NPC_DATABASE_URL = './config/npcs/hobunji-starter-npc-database.json'; // Fallback NPC data source.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Early owner/stage detection.
  const MONITOR_MS = 80; // Retries setup as normal game dependencies initialize.
  const ACTOR_LOG_EVERY = 25; // Rate-limits mobile-visible waiting logs.

  let cameraDeps = null; // Captured from FarmAnimals.init for camera mode/target controls.
  let dialogueBridge = null; // Captured from DialogueContent.init for active-walker integration.
  let chapterPromise = null; // Session cache for prologue chapter JSON.
  let npcDatabasePromise = null; // Session cache for NPC database.
  let preparePromise = null; // Prevents overlapping actor-build attempts.
  const actorInstances = new Map(); // npcId -> prologue-owned scripted actor.
  let session = null; // Active automatic-speaker sequence.
  let stageReady = false; // True after both actors and first speaker/portrait/camera target are ready.
  let testFinished = false; // Stops the temporary target test reopening after completion.
  let monitorAttempts = 0; // Mobile-readable retry count.
  let targetChanges = 0; // Successful automatic speaker/camera retargets.
  let revealSignals = 0; // Number of readiness signals sent to the map/loader owner.
  let lastStatus = 'waiting-rescue'; // Mobile-readable setup state.
  let lastError = null; // Most recent setup error.

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog;
    if (typeof logger === 'function') {
      try { logger(`[prologue-dialogue] ${message}`, level); return; } catch (_) {}
    }
    console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](`[prologue-dialogue] ${message}`);
  }

  function loadMeta() {
    const raw = localStorage.getItem(SAVE_META_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function persistedWorldState(worldId) {
    return (loadMeta()?.worlds || []).find(world => world.id === worldId)?.prologue || null;
  }

  function currentArea() {
    try { return window.GridTileAccessors?.getCurrentArea?.() || null; }
    catch (_) { return null; }
  }

  function rescuePrologueActive() {
    const profile = window.__hobunjiPlayerProfile;
    if (!profile?.worldId || !profile?.isWorldOwner) return false;
    const liveState = window.PrologueSystem?.getWorldPrologue?.(profile.worldId);
    const state = liveState || persistedWorldState(profile.worldId);
    if (profile.isNewWorld && !state) return true;
    return !!state && !state.completed && state.stage === 'rescue';
  }

  function signalRevealReadiness() {
    revealSignals += 1;
    try { window.LoadingScreenRuntime?.setProgress?.(98, 'prologue-dialogue-ready'); } catch (_) {}
    try { window.PrologueRescueMapRuntime?.requestRevealCheck?.(); } catch (_) {}
  }

  function loadChapter() {
    if (chapterPromise) return chapterPromise;
    chapterPromise = fetch(CHAPTER_URL, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`chapter HTTP ${response.status}`);
        return response.json();
      })
      .catch(error => {
        lastError = `chapter:${error?.message || error}`;
        lastStatus = 'chapter-load-failed';
        debugLog(`chapter config unavailable: ${error?.message || error}`, 'error');
        return null;
      });
    return chapterPromise;
  }

  function loadNpcDatabase() {
    if (npcDatabasePromise) return npcDatabasePromise;
    npcDatabasePromise = (async () => {
      try {
        const overridden = window.LocalDBOverrides?.loadDatabase
          ? await window.LocalDBOverrides.loadDatabase('npcDatabase')
          : null;
        if (overridden) return overridden;
        const response = await fetch(NPC_DATABASE_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`NPC database HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = `npc-database:${error?.message || error}`;
        lastStatus = 'npc-database-load-failed';
        debugLog(`NPC database unavailable: ${error?.message || error}`, 'error');
        return null;
      }
    })();
    return npcDatabasePromise;
  }

  function npcRecordsFromDatabase(database) {
    if (Array.isArray(database)) return database;
    if (Array.isArray(database?.npcs)) return database.npcs;
    if (Array.isArray(database?.records)) return database.records;
    return [];
  }

  function portraitExportFor(rec) {
    return {
      id: rec.id,
      name: rec.name,
      appearance: rec.appearance,
      equippedCosmetics: Array.isArray(rec.equippedCosmetics) ? rec.equippedCosmetics : [],
      appliedDyes: rec.appliedDyes || {},
    };
  }

  async function buildScriptedActor(actor, scene, npcRecords) {
    const npcId = String(actor?.npcId || '');
    if (!npcId || !scene) return null;

    const existing = actorInstances.get(npcId);
    if (existing?.root?.parent === scene) return existing;

    const rec = npcRecords.find(candidate => String(candidate?.id || '') === npcId) || null;
    if (!rec) throw new Error(`NPC record ${npcId} not found`);

    if (!window.NpcAvatarPreview?.ensurePortraitCosmetics || !window.NpcAvatarPreview?.buildProfileFromNpcExport) {
      throw new Error('NpcAvatarPreview is not ready');
    }
    if (!window.PNGPlaneAvatar?.buildSinglePlaneAvatarModel || !window.THREE) {
      throw new Error('PNGPlaneAvatar/THREE is not ready');
    }

    await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: './assets/', configBase: './config/' });
    const profile = window.NpcAvatarPreview.buildProfileFromNpcExport(portraitExportFor(rec));
    if (!profile) throw new Error(`profile build failed for ${npcId}`);

    const avatarCfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
    const modelWidth = Number(avatarCfg.worldModelWidth) || 0.9;
    const portraitSize = Number(avatarCfg.previewPortraitCanvasSize) || 200;
    const frontCanvas = document.createElement('canvas'); // World-facing portrait texture.
    frontCanvas.width = frontCanvas.height = portraitSize;
    const backCanvas = document.createElement('canvas'); // Rear-facing portrait texture.
    backCanvas.width = backCanvas.height = portraitSize;

    await window.NpcAvatarPreview.renderProfileToCanvas(frontCanvas, profile, { forceEyesOpen: true });
    await window.NpcAvatarPreview.renderProfileToCanvas(backCanvas, profile, { portraitView: 'behind', forceEyesOpen: true });

    const root = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(window.THREE, frontCanvas, {
      backCanvas,
      profile,
      npcRecord: rec,
      name: `prologue_actor_${npcId}`,
      modelWidth,
      modelHeight: modelWidth,
      anchorZ: 0,
      alphaTest: avatarCfg.worldAlphaTest ?? 0.01,
    });
    if (!root) throw new Error(`world avatar build failed for ${npcId}`);

    const avatarHeight = Number(root.userData?.portraitModelHeight) || modelWidth;
    const col = Number(actor.col);
    const row = Number(actor.row);
    const rotY = Number(actor.rotY);
    root.position.set(
      Number.isFinite(col) ? col + 0.5 : 12.5,
      avatarHeight / 2,
      Number.isFinite(row) ? row + 0.5 : 12.5,
    );
    if (Number.isFinite(rotY)) root.rotation.y = rotY;

    root.userData ||= {};
    root.userData.prologueActor = true;
    root.userData.prologueAuthored = true;
    root.userData.prologueNpcId = npcId;
    scene.add(root);

    const walker = {
      rec,
      profile,
      root,
      avatarGroup: root,
      avatarFrontCanvas: frontCanvas,
      avatarBackCanvas: backCanvas,
      avatarHeight,
      area: RESCUE_MAP_ID,
      state: 'idle',
      pause: Infinity,
      path: [],
      currentScheduleTarget: null,
      scriptedPrologueActor: true,
    }; // Synthetic dialogue-walker contract; never enrolled in ordinary scheduling.

    const instance = { npcId, rec, profile, root, walker, frontCanvas, backCanvas, avatarHeight };
    actorInstances.set(npcId, instance);
    debugLog(`built scripted actor ${rec.name || npcId} at (${root.position.x.toFixed(1)}, ${root.position.z.toFixed(1)})`);
    return instance;
  }

  function actorForNpc(npcId) {
    return actorInstances.get(String(npcId || '')) || null;
  }

  function disposeActors() {
    for (const instance of actorInstances.values()) {
      instance.root?.parent?.remove?.(instance.root);
      try { window.PNGPlaneAvatar?.disposeAvatarModel?.(instance.root); } catch (_) {}
    }
    actorInstances.clear();
    stageReady = false;
    preparePromise = null;
  }

  function openDialogueShell() {
    window.WorldPopupText?.clearInteractionPrompts?.();
    document.getElementById('arcContainer')?.classList.add('arc-hidden');
    const dialogueEl = document.getElementById('npcDialogue');
    dialogueEl?.classList.add('open');
    dialogueEl?.setAttribute('aria-hidden', 'false');
  }

  function closeDialogueShell() {
    const dialogueEl = document.getElementById('npcDialogue');
    dialogueEl?.classList.remove('open');
    dialogueEl?.setAttribute('aria-hidden', 'true');
    document.getElementById('arcContainer')?.classList.remove('arc-hidden');
  }

  function dialogueCameraMode() {
    return cameraDeps?.cameraConfig?.()?.dialogueMode || 'npcDialogue';
  }

  async function showLine(index) {
    if (!session) return false;
    const line = session.lines[index];
    if (!line) return false;

    const actor = actorForNpc(line.speakerNpcId);
    const walker = actor?.walker;
    const root = actor?.root;
    if (!walker || !root) {
      lastStatus = `missing-speaker:${line.speakerNpcId || 'unknown'}`;
      lastError = lastStatus;
      debugLog(`cannot target dialogue speaker ${line.speakerNpcId || 'unknown'}: scripted actor unavailable`, 'error');
      return false;
    }

    session.index = index;
    session.walker = walker;
    session.speakerNpcId = line.speakerNpcId;

    const rec = walker.rec;
    const nameEl = document.getElementById('npcDialogueName');
    const textEl = document.getElementById('npcDialogueText');
    const heartsEl = document.getElementById('npcDialogueHearts');
    if (nameEl) nameEl.textContent = rec?.name || line.speakerNpcId;
    if (heartsEl) heartsEl.textContent = window.DialogueContent?.renderRelationshipHearts?.(rec) || '';

    // Cancel any ordinary typewriter before swapping speaker. Test copy is set
    // directly, so hidden setup never schedules letter blips.
    window.DialogueContent?.stopNpcDialogueTypewriter?.(false);
    if (textEl) textEl.textContent = String(line.text || '...');

    cameraDeps?.setCameraMode?.(dialogueCameraMode());
    cameraDeps?.setCameraTarget?.(root);
    window.DialogueContent?.hideChoiceButtons?.();
    try { await Promise.resolve(window.DialogueContent?.renderNpcDialoguePortrait?.()); } catch (_) {}

    targetChanges += 1;
    lastStatus = `line-${index + 1}:${line.speakerNpcId}`;
    debugLog(`line ${index + 1}/${session.lines.length} target → ${rec?.name || line.speakerNpcId}`);
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

  async function advanceDialogueTest() {
    if (!session) return false;
    const nextIndex = session.index + 1;
    if (nextIndex >= session.lines.length) {
      closeDialogueTest({ completed: true });
      return true;
    }
    return showLine(nextIndex);
  }

  async function prepareRescueStage() {
    if (stageReady) return true;
    if (preparePromise) return preparePromise;
    if (currentArea() !== RESCUE_MAP_ID || !rescuePrologueActive()) return false;

    try { window.LoadingScreenRuntime?.setProgress?.(96, 'prologue-actors'); } catch (_) {}

    const run = (async () => {
      try {
        if (!cameraDeps || !dialogueBridge || !window.DialogueContent) {
          lastStatus = 'waiting-dialogue-camera-deps';
          return false;
        }

        const scene = window.GridTileAccessors?.getActiveScene?.();
        const grid = window.GridTileAccessors?.getActiveGrid?.();
        if (!scene || !grid) {
          lastStatus = 'waiting-rescue-scene';
          return false;
        }

        const [chapter, database] = await Promise.all([loadChapter(), loadNpcDatabase()]);
        const rescue = chapter?.stages?.rescue;
        const actors = Array.isArray(rescue?.actors) ? rescue.actors : [];
        const lines = Array.isArray(rescue?.dialogue) ? rescue.dialogue : [];
        const npcRecords = npcRecordsFromDatabase(database);
        if (!actors.length || lines.length < 2) throw new Error('authored rescue actor/dialogue data is missing');
        if (!npcRecords.length) throw new Error('NPC database has no records');

        for (const actor of actors) await buildScriptedActor(actor, scene, npcRecords);
        if (actorInstances.size < actors.length) {
          throw new Error(`only ${actorInstances.size}/${actors.length} scripted actors built`);
        }

        if (!session && !testFinished) {
          session = {
            lines,
            index: -1,
            walker: null,
            speakerNpcId: null,
            prevCameraMode: cameraDeps?.getCameraMode?.(),
            prevCameraTarget: cameraDeps?.getCameraTarget?.(),
          };
          openDialogueShell();
          lastStatus = 'priming-first-line';
          const opened = await showLine(0);
          if (!opened) throw new Error('first automatic-speaker line could not be primed');
        }

        stageReady = true;
        lastError = null;
        lastStatus = session ? 'rescue-ready-dialogue-open' : 'rescue-ready';
        debugLog(`rescue stage setup complete with ${actorInstances.size} scripted NPC actors`);
        signalRevealReadiness();
        return true;
      } catch (error) {
        lastError = String(error?.message || error);
        lastStatus = `setup-error:${lastError}`;
        debugLog(`rescue actor/dialogue setup failed: ${lastError}`, 'error');
        return false;
      }
    })();

    preparePromise = run;
    try {
      return await run;
    } finally {
      if (preparePromise === run) preparePromise = null;
    }
  }

  async function monitor() {
    monitorAttempts += 1;
    const inRescue = currentArea() === RESCUE_MAP_ID && rescuePrologueActive();

    if (!inRescue) {
      if (session) closeDialogueTest({ completed: false });
      if (actorInstances.size) disposeActors();
      lastStatus = 'waiting-rescue';
      return;
    }

    if (!stageReady) {
      const ready = await prepareRescueStage();
      if (!ready && monitorAttempts % ACTOR_LOG_EVERY === 0) {
        debugLog(
          `waiting for rescue actor setup (${lastStatus}); camera=${!!cameraDeps} dialogue=${!!dialogueBridge} actors=${actorInstances.size}`,
          'warn',
        );
      }
    }
  }

  function wrapFarmAnimals(api) {
    if (!api?.init || api.__prologueDialogueTargetWrapped) return api;
    const originalInit = api.init.bind(api);
    api.init = function prologueDialogueFarmAnimalsInit(injectedDeps) {
      cameraDeps = injectedDeps || null;
      const result = originalInit(injectedDeps);
      try { window.PrologueRescueMapRuntime?.requestRevealCheck?.(); } catch (_) {}
      return result;
    };
    Object.defineProperty(api, '__prologueDialogueTargetWrapped', { value: true, configurable: true });
    return api;
  }

  function wrapDialogueContent(api) {
    if (!api?.init || api.__prologueDialogueTargetWrapped) return api;
    const originalInit = api.init.bind(api);
    api.init = function prologueDialogueContentInit(injectedDeps) {
      const source = injectedDeps || {};
      const gameGetDialogueOpen = source.getDialogueOpen;
      const gameGetDialogueWalker = source.getDialogueWalker;
      const gameCloseNpcDialogue = source.closeNpcDialogue;
      dialogueBridge = { gameGetDialogueOpen, gameGetDialogueWalker, gameCloseNpcDialogue };

      const result = originalInit({
        ...source,
        getDialogueOpen: () => !!session || !!gameGetDialogueOpen?.(),
        getDialogueWalker: () => session?.walker || gameGetDialogueWalker?.(),
        closeNpcDialogue: () => session ? closeDialogueTest({ completed: false }) : gameCloseNpcDialogue?.(),
      });
      try { window.PrologueRescueMapRuntime?.requestRevealCheck?.(); } catch (_) {}
      return result;
    };
    Object.defineProperty(api, '__prologueDialogueTargetWrapped', { value: true, configurable: true });
    return api;
  }

  function chainGlobal(name, installer) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
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

    if (window[name]) {
      installer(window[name]);
      return;
    }

    let stored = null;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return stored; },
      set(value) { stored = installer(value); },
    });
  }

  function bindDialogueControls() {
    document.addEventListener('click', event => {
      if (!session) return;
      const id = event.target?.closest?.('#npcDialogueContinue,#npcDialogueLeave')?.id;
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (id === 'npcDialogueLeave') closeDialogueTest({ completed: false });
      else void advanceDialogueTest();
    }, true);
  }

  chainGlobal('FarmAnimals', wrapFarmAnimals);
  chainGlobal('DialogueContent', wrapDialogueContent);
  bindDialogueControls();
  setInterval(monitor, MONITOR_MS);

  window.PrologueDialogueRuntime = Object.freeze({
    prepareRescueStage,
    isRescueStageReady: () => stageReady,
    advanceDialogueTest,
    closeDialogueTest,
    debugSnapshot: () => ({
      currentArea: currentArea(),
      rescueActive: rescuePrologueActive(),
      stageReady,
      loaderOwnedBy: 'PrologueRescueMapRuntime',
      hiddenSetup: !!window.__hobunjiPrologueHiddenSetup,
      actorsReady: actorInstances.size,
      actorNpcIds: [...actorInstances.keys()],
      sessionActive: !!session,
      speakerNpcId: session?.speakerNpcId || null,
      lineIndex: session?.index ?? null,
      targetChanges,
      revealSignals,
      testFinished,
      cameraDepsReady: !!cameraDeps,
      dialogueBridgeReady: !!dialogueBridge,
      monitorAttempts,
      lastStatus,
      lastError,
    }),
    debugText: () => JSON.stringify(window.PrologueDialogueRuntime.debugSnapshot(), null, 2),
  });
})();
