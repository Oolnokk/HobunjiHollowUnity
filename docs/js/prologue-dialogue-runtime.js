(() => {
  'use strict';

  // Scripted gameplay-cutscene dialogue for the prologue rescue stage.
  // Scripted actors are prologue-owned avatar instances, not scheduled NPC walkers.
  const RESCUE_MAP_ID = 'map_prologue_rescue'; // Used to scope actor construction/dialogue to the first prologue stage.
  const CHAPTER_URL = './config/cutscenes/prologue-chapter.json'; // Used to load authored actor positions and line ordering.
  const NPC_DATABASE_URL = './config/npcs/hobunji-starter-npc-database.json'; // Used when LocalDBOverrides is unavailable.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used before PrologueSystem is fully initialized to identify an owner rescue boot.
  const MONITOR_MS = 80; // Used to retry setup while normal game dependencies finish initializing.
  const ACTOR_LOG_EVERY = 25; // Used to rate-limit mobile-visible startup diagnostics.

  let cameraDeps = null; // Captured from FarmAnimals.init; supplies camera mode/target getters and setters.
  let dialogueBridge = null; // Captured from DialogueContent.init so portrait rendering can read our synthetic active walker.
  let chapterPromise = null; // Caches the authored prologue chapter for the session.
  let npcDatabasePromise = null; // Caches the real NPC database used to build scripted actors.
  let preparePromise = null; // Prevents overlapping async actor setup runs.
  const actorInstances = new Map(); // npcId -> scripted actor instance used by world rendering and dialogue targeting.
  let session = null; // Active automatic-speaker dialogue sequence.
  let stageReady = false; // True only after all scripted actors and the first dialogue target are ready.
  let testFinished = false; // Prevents the temporary target test from reopening after all three lines are advanced.
  let monitorAttempts = 0; // Used for mobile-readable diagnostics.
  let targetChanges = 0; // Counts successful automatic speaker/camera target changes.
  let lastStatus = 'waiting-rescue'; // Human-readable setup state exposed through debugSnapshot.
  let lastError = null; // Most recent actor/dialogue setup error.

  // This is intentionally a single acquisition. Calling LoadingScreenRuntime.show()
  // repeatedly starts a brand-new loading generation, resets progress, and picks a
  // new tip. The monitor runs every 80 ms, so the old implementation accidentally
  // restarted the loader on every retry. active=true now makes retries no-ops.
  const loadingHold = {
    active: false,
    rootObserver: null,
    findObserver: null,
    releaseToken: 0,
    showCalls: 0,
  }; // Used to keep the already-existing game loader over actor setup without restarting it.

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog; // Reuses the existing mobile-visible game log instead of requiring devtools.
    if (typeof logger === 'function') {
      try { logger(`[prologue-dialogue] ${message}`, level); return; } catch (_) {}
    }
    console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](`[prologue-dialogue] ${message}`);
  }

  function loadMeta() {
    const raw = localStorage.getItem(SAVE_META_KEY); // Used only for pre-PrologueSystem owner/stage detection.
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
    const profile = window.__hobunjiPlayerProfile; // Used to bind actor setup to the selected real owner/world.
    if (!profile?.worldId || !profile?.isWorldOwner) return false;
    const liveState = window.PrologueSystem?.getWorldPrologue?.(profile.worldId);
    const state = liveState || persistedWorldState(profile.worldId);
    if (profile.isNewWorld && !state) return true;
    return !!state && !state.completed && state.stage === 'rescue';
  }

  function loaderRoot() {
    return document.getElementById('hobunjiLoadScreen');
  }

  function forceActorLoaderVisible() {
    if (!loadingHold.active) return;
    const root = loaderRoot();
    if (root && !root.classList.contains('visible')) root.classList.add('visible');
  }

  function observeActorLoaderRoot(root) {
    if (!root || loadingHold.rootObserver || typeof MutationObserver !== 'function') return;
    loadingHold.rootObserver = new MutationObserver(forceActorLoaderVisible);
    loadingHold.rootObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  function installActorLoaderObserver() {
    const root = loaderRoot();
    if (root) {
      observeActorLoaderRoot(root);
      forceActorLoaderVisible();
      return;
    }
    if (loadingHold.findObserver || typeof MutationObserver !== 'function') return;
    loadingHold.findObserver = new MutationObserver(() => {
      const found = loaderRoot();
      if (!found) return;
      loadingHold.findObserver.disconnect();
      loadingHold.findObserver = null;
      observeActorLoaderRoot(found);
      forceActorLoaderVisible();
    });
    loadingHold.findObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function beginActorLoadingHold(reason = 'prologue-rescue-actors') {
    if (loadingHold.active) {
      // Retry ticks may only reassert the DOM class. They must never create a
      // new LoadingScreenRuntime generation or reset the active tip/progress.
      installActorLoaderObserver();
      forceActorLoaderVisible();
      return false;
    }

    loadingHold.active = true;
    loadingHold.releaseToken += 1;
    window.__hobunjiPrologueHiddenSetup = true; // Read by scripted-area audio suppression while setup is still invisible.
    installActorLoaderObserver();

    try {
      const loaderDebug = window.LoadingScreenRuntime?.getDebug?.(); // Used to preserve the already-running initial boot loader when possible.
      if (!loaderDebug?.visible) {
        loadingHold.showCalls += 1;
        window.LoadingScreenRuntime?.show?.({ reason });
      }
      window.LoadingScreenRuntime?.setProgress?.(96, 'prologue-actors');
    } catch (_) {}
    forceActorLoaderVisible();
    return true;
  }

  function finishActorLoadingHoldAfterPaint() {
    if (!loadingHold.active || !stageReady) return;
    const token = ++loadingHold.releaseToken; // Invalidates stale releases if the stage restarts before paint.
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      if (!loadingHold.active || token !== loadingHold.releaseToken || !stageReady || currentArea() !== RESCUE_MAP_ID) return;
      loadingHold.active = false;
      loadingHold.rootObserver?.disconnect();
      loadingHold.rootObserver = null;
      loadingHold.findObserver?.disconnect();
      loadingHold.findObserver = null;
      try {
        window.LoadingScreenRuntime?.setProgress?.(100, 'prologue-actors-ready');
        await window.LoadingScreenRuntime?.hide?.();
      } catch (_) {}
      loaderRoot()?.classList.remove('visible');
      window.__hobunjiPrologueHiddenSetup = false;
      debugLog('rescue actors + first dialogue target painted; loading screen released');
    }));
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
    const npcId = String(actor?.npcId || ''); // Used as both database lookup key and stable actor-instance id.
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
    const modelWidth = Number(avatarCfg.worldModelWidth) || 0.9; // Used by the same world-avatar sizing path as normal NPC portraits.
    const portraitSize = Number(avatarCfg.previewPortraitCanvasSize) || 200; // Used for static world front/back textures.
    const frontCanvas = document.createElement('canvas');
    frontCanvas.width = frontCanvas.height = portraitSize;
    const backCanvas = document.createElement('canvas');
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

    const avatarHeight = Number(root.userData?.portraitModelHeight) || modelWidth; // Used to ground the portrait like other world NPC avatars.
    const col = Number(actor.col); // Authored actor column in the rescue clearing.
    const row = Number(actor.row); // Authored actor row in the rescue clearing.
    const rotY = Number(actor.rotY); // Authored body yaw; no implicit player-facing/headtracking is applied.
    root.position.set(Number.isFinite(col) ? col + 0.5 : 12.5, avatarHeight / 2, Number.isFinite(row) ? row + 0.5 : 12.5);
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
    }; // Synthetic dialogue-walker contract; deliberately never added to npcWalkers.

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
    const dialogueEl = document.getElementById('npcDialogue'); // Uses the ordinary gameplay dialogue surface.
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
    const line = session.lines[index]; // Used as the authored line whose speaker becomes the active target automatically.
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
    window.DialogueContent?.stopNpcDialogueTypewriter?.(false);
    // Deliberately set the test line directly instead of starting a typewriter;
    // no dialogue-letter audio should be emitted while setup is hidden.
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
    const nextIndex = session.index + 1; // Automatic target swap follows line metadata; no second NPC interaction is required.
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
    beginActorLoadingHold();

    preparePromise = (async () => {
      try {
        if (!cameraDeps || !dialogueBridge || !window.DialogueContent) {
          lastStatus = 'waiting-dialogue-camera-deps';
          return false;
        }
        const scene = window.GridTileAccessors?.getActiveScene?.(); // Must be the real built rescue gameplay scene.
        const grid = window.GridTileAccessors?.getActiveGrid?.(); // Basic real-map readiness check before actor attachment.
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
        if (actorInstances.size < actors.length) throw new Error(`only ${actorInstances.size}/${actors.length} scripted actors built`);

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
        finishActorLoadingHoldAfterPaint();
        return true;
      } catch (error) {
        lastError = String(error?.message || error);
        lastStatus = `setup-error:${lastError}`;
        debugLog(`rescue actor/dialogue setup failed: ${lastError}`, 'error');
        return false;
      } finally {
        preparePromise = null;
      }
    })();
    return preparePromise;
  }

  async function monitor() {
    monitorAttempts += 1;
    const inRescue = currentArea() === RESCUE_MAP_ID && rescuePrologueActive();
    if (!inRescue) {
      if (session) closeDialogueTest({ completed: false });
      if (actorInstances.size) disposeActors();
      if (loadingHold.active && !rescuePrologueActive()) {
        loadingHold.active = false;
        loadingHold.rootObserver?.disconnect();
        loadingHold.rootObserver = null;
        loadingHold.findObserver?.disconnect();
        loadingHold.findObserver = null;
        window.__hobunjiPrologueHiddenSetup = false;
      }
      lastStatus = 'waiting-rescue';
      return;
    }
    if (!stageReady) {
      beginActorLoadingHold();
      const ready = await prepareRescueStage();
      if (!ready) {
        forceActorLoaderVisible();
        if (monitorAttempts % ACTOR_LOG_EVERY === 0) {
          debugLog(`waiting for rescue actor setup (${lastStatus}); camera=${!!cameraDeps} dialogue=${!!dialogueBridge} actors=${actorInstances.size}`, 'warn');
        }
      }
    }
  }

  function wrapFarmAnimals(api) {
    if (!api?.init || api.__prologueDialogueTargetWrapped) return api;
    const originalInit = api.init.bind(api); // Preserves FarmAnimals while capturing camera integration.
    api.init = function prologueDialogueFarmAnimalsInit(injectedDeps) {
      cameraDeps = injectedDeps || null;
      return originalInit(injectedDeps);
    };
    Object.defineProperty(api, '__prologueDialogueTargetWrapped', { value: true, configurable: true });
    return api;
  }

  function wrapDialogueContent(api) {
    if (!api?.init || api.__prologueDialogueTargetWrapped) return api;
    const originalInit = api.init.bind(api); // Composes on top of LivestockDialogue's earlier shared-dialogue bridge.
    api.init = function prologueDialogueContentInit(injectedDeps) {
      const source = injectedDeps || {};
      const gameGetDialogueOpen = source.getDialogueOpen;
      const gameGetDialogueWalker = source.getDialogueWalker;
      const gameCloseNpcDialogue = source.closeNpcDialogue;
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
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Used to compose safely with earlier parser-time global watchers.
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
    let stored = null; // Used only when the observed namespace has not been assigned yet.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return stored; },
      set(value) { stored = installer(value); },
    });
  }

  function onPlayerReady(event) {
    const profile = event?.detail;
    if (!profile?.worldId || !profile?.characterId || !profile?.isWorldOwner || window.__hobunjiCutscenePreview) return;
    const state = persistedWorldState(profile.worldId);
    if (profile.isNewWorld || (state && !state.completed && state.stage === 'rescue')) beginActorLoadingHold();
  }

  function bindDialogueControls() {
    document.addEventListener('click', event => {
      if (!session) return;
      const id = event.target?.closest?.('#npcDialogueContinue,#npcDialogueLeave')?.id;
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (id === 'npcDialogueLeave') closeDialogueTest({ completed: false });
      else advanceDialogueTest();
    }, true);
  }

  chainGlobal('FarmAnimals', wrapFarmAnimals);
  chainGlobal('DialogueContent', wrapDialogueContent);
  document.addEventListener('hobunjiPlayerReady', onPlayerReady, true);
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
      loadingHoldActive: loadingHold.active,
      loadingShowCalls: loadingHold.showCalls,
      hiddenSetup: !!window.__hobunjiPrologueHiddenSetup,
      actorsReady: actorInstances.size,
      actorNpcIds: [...actorInstances.keys()],
      sessionActive: !!session,
      speakerNpcId: session?.speakerNpcId || null,
      lineIndex: session?.index ?? null,
      targetChanges,
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
