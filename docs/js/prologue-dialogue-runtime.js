(() => {
  'use strict';

  // Scripted gameplay-cutscene dialogue for the prologue rescue stage.
  //
  // IMPORTANT: loading-screen ownership lives exclusively in
  // PrologueRescueMapRuntime. This module has two deliberately separate jobs:
  // 1) build/stage the real NPC world actors while the rescue map is covered;
  // 2) start the automatic-speaker gameplay dialogue only after reveal.
  //
  // Actor readiness is therefore allowed to release the map loader even when
  // the gameplay camera/dialogue bridge is late or unavailable. A dialogue
  // dependency can never strand the game behind a 100% loading screen again.
  const RESCUE_MAP_ID = 'map_prologue_rescue'; // First prologue stage.
  const CHAPTER_URL = './config/cutscenes/prologue-chapter.json'; // Authored actors/line order.
  const NPC_DATABASE_URL = './config/npcs/hobunji-starter-npc-database.json'; // Fallback NPC data source.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Early owner/stage detection.
  const MONITOR_MS = 80; // Retries actor/dialogue setup as normal game dependencies initialize.
  const ACTOR_LOG_EVERY = 25; // Rate-limits mobile-visible waiting logs.

  let cameraDeps = null; // Used only by post-reveal dialogue targeting/camera changes.
  let dialogueBridge = null; // Used only by post-reveal active-walker integration.
  let chapterPromise = null; // Session cache for prologue chapter JSON.
  let npcDatabasePromise = null; // Session cache for NPC database.
  let actorPreparePromise = null; // Prevents overlapping world-actor construction attempts.
  let dialoguePreparePromise = null; // Prevents overlapping post-reveal dialogue-open attempts.
  const actorInstances = new Map(); // npcId -> prologue-owned scripted actor.
  let session = null; // Active automatic-speaker sequence.
  let actorsReady = false; // Used by the map loader as its NPC staging readiness gate.
  let dialogueReady = false; // Used only to report whether the automatic speaker test is open.
  let testFinished = false; // Stops the temporary target test reopening after completion.
  let monitorAttempts = 0; // Mobile-readable retry count.
  let targetChanges = 0; // Successful automatic speaker/camera retargets.
  let revealSignals = 0; // Number of actor-readiness checks sent to the map/loader owner.
  let lastStatus = 'waiting-rescue'; // Mobile-readable setup state.
  let lastError = null; // Most recent setup error.

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog; // Used by mobile-visible debug output when available.
    if (typeof logger === 'function') {
      try { logger(`[prologue-dialogue] ${message}`, level); return; } catch (_) {}
    }
    console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](`[prologue-dialogue] ${message}`);
  }

  function loadMeta() {
    const raw = localStorage.getItem(SAVE_META_KEY); // Used to identify interrupted owner prologues before PrologueSystem is ready.
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
    const profile = window.__hobunjiPlayerProfile; // Used to scope scripted actors to the selected owner/world.
    if (!profile?.worldId || !profile?.isWorldOwner) return false;
    const liveState = window.PrologueSystem?.getWorldPrologue?.(profile.worldId);
    const state = liveState || persistedWorldState(profile.worldId);
    if (profile.isNewWorld && !state) return true;
    return !!state && !state.completed && state.stage === 'rescue';
  }

  function signalActorReadiness() {
    revealSignals += 1;
    try { window.LoadingScreenRuntime?.setProgress?.(98, 'prologue-actors-ready'); } catch (_) {}
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
    const npcId = String(actor?.npcId || ''); // Used as the stable scripted-actor/database key.
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
    const frontCanvas = document.createElement('canvas'); // Used as the scripted actor's front world texture.
    frontCanvas.width = frontCanvas.height = portraitSize;
    const backCanvas = document.createElement('canvas'); // Used as the scripted actor's rear world texture.
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
    }; // Synthetic dialogue-walker contract; never enrolled in ordinary NPC scheduling.

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
    actorsReady = false;
    dialogueReady = false;
    actorPreparePromise = null;
    dialoguePreparePromise = null;
  }

  function openDialogueShell() {
    window.WorldPopupText?.clearInteractionPrompts?.();
    document.getElementById('arcContainer')?.classList.add('arc-hidden');
    const dialogueEl = document.getElementById('npcDialogue'); // Uses the ordinary gameplay dialogue shell.
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
    const line = session.lines[index]; // Used to select the next automatic speaker/target.
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
    dialogueReady = false;
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
    const nextIndex = session.index + 1; // Used to switch speaker automatically from authored line metadata.
    if (nextIndex >= session.lines.length) {
      closeDialogueTest({ completed: true });
      return true;
    }
    return showLine(nextIndex);
  }

  async function prepareRescueActors() {
    if (actorsReady) return true;
    if (actorPreparePromise) return actorPreparePromise;
    if (currentArea() !== RESCUE_MAP_ID || !rescuePrologueActive()) return false;

    const run = (async () => {
      try {
        const scene = window.GridTileAccessors?.getActiveScene?.();
        const grid = window.GridTileAccessors?.getActiveGrid?.();
        if (!scene || !grid) {
          lastStatus = 'waiting-rescue-scene';
          return false;
        }

        const [chapter, database] = await Promise.all([loadChapter(), loadNpcDatabase()]);
        const rescue = chapter?.stages?.rescue;
        const actors = Array.isArray(rescue?.actors) ? rescue.actors : [];
        const npcRecords = npcRecordsFromDatabase(database);
        if (!actors.length) throw new Error('authored rescue actor data is missing');
        if (!npcRecords.length) throw new Error('NPC database has no records');

        for (const actor of actors) await buildScriptedActor(actor, scene, npcRecords);
        if (actorInstances.size < actors.length) {
          throw new Error(`only ${actorInstances.size}/${actors.length} scripted actors built`);
        }

        actorsReady = true;
        lastError = null;
        lastStatus = `rescue-actors-ready:${actorInstances.size}`;
        debugLog(`rescue actor staging complete with ${actorInstances.size} scripted NPC actors`);
        signalActorReadiness();
        return true;
      } catch (error) {
        lastError = String(error?.message || error);
        lastStatus = `actor-setup-error:${lastError}`;
        debugLog(`rescue actor setup failed: ${lastError}`, 'error');
        return false;
      }
    })();

    actorPreparePromise = run;
    try {
      return await run;
    } finally {
      if (actorPreparePromise === run) actorPreparePromise = null;
    }
  }

  async function prepareRescueDialogue() {
    if (dialogueReady || testFinished) return dialogueReady || testFinished;
    if (dialoguePreparePromise) return dialoguePreparePromise;
    if (!actorsReady || currentArea() !== RESCUE_MAP_ID || !rescuePrologueActive()) return false;

    // Dialogue is intentionally post-reveal. Its camera/portrait dependencies
    // are useful for the cutscene, but they are not map-loading dependencies.
    if (window.__hobunjiPrologueHiddenSetup) {
      lastStatus = 'actors-ready-waiting-map-reveal';
      return false;
    }
    if (!cameraDeps || !dialogueBridge || !window.DialogueContent) {
      lastStatus = 'actors-ready-waiting-dialogue-camera-deps';
      return false;
    }

    const run = (async () => {
      try {
        const chapter = await loadChapter();
        const lines = Array.isArray(chapter?.stages?.rescue?.dialogue) ? chapter.stages.rescue.dialogue : [];
        if (lines.length < 2) throw new Error('authored rescue dialogue test data is missing');

        if (!session) {
          session = {
            lines,
            index: -1,
            walker: null,
            speakerNpcId: null,
            prevCameraMode: cameraDeps?.getCameraMode?.(),
            prevCameraTarget: cameraDeps?.getCameraTarget?.(),
          };
          openDialogueShell();
          lastStatus = 'priming-first-line-after-reveal';
          const opened = await showLine(0);
          if (!opened) throw new Error('first automatic-speaker line could not be primed');
        }

        dialogueReady = true;
        lastError = null;
        lastStatus = 'rescue-dialogue-open';
        debugLog('automatic-speaker dialogue test opened after rescue reveal');
        return true;
      } catch (error) {
        lastError = String(error?.message || error);
        lastStatus = `dialogue-setup-error:${lastError}`;
        debugLog(`rescue dialogue setup failed: ${lastError}`, 'error');
        return false;
      }
    })();

    dialoguePreparePromise = run;
    try {
      return await run;
    } finally {
      if (dialoguePreparePromise === run) dialoguePreparePromise = null;
    }
  }

  async function prepareRescueStage() {
    const ready = await prepareRescueActors(); // Used as the loader-safe portion of rescue setup.
    if (!ready) return false;
    void prepareRescueDialogue(); // Best-effort post-reveal dialogue; never blocks actor/map readiness.
    return true;
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

    if (!actorsReady) {
      const ready = await prepareRescueActors();
      if (!ready && monitorAttempts % ACTOR_LOG_EVERY === 0) {
        debugLog(`waiting for rescue actors (${lastStatus}); actors=${actorInstances.size}`, 'warn');
      }
      return;
    }

    if (!dialogueReady && !testFinished) {
      const ready = await prepareRescueDialogue();
      if (!ready && monitorAttempts % ACTOR_LOG_EVERY === 0) {
        debugLog(
          `actors ready; waiting for post-reveal dialogue (${lastStatus}); camera=${!!cameraDeps} dialogue=${!!dialogueBridge} hidden=${!!window.__hobunjiPrologueHiddenSetup}`,
          'warn',
        );
      }
    }
  }

  function wrapFarmAnimals(api) {
    if (!api?.init || api.__prologueDialogueTargetWrapped) return api;
    const originalInit = api.init.bind(api);
    api.init = function prologueDialogueFarmAnimalsInit(injectedDeps) {
      cameraDeps = injectedDeps || null; // Used only for post-reveal speaker camera targeting.
      const result = originalInit(injectedDeps);
      void prepareRescueDialogue();
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
      dialogueBridge = { gameGetDialogueOpen, gameGetDialogueWalker, gameCloseNpcDialogue }; // Used by synthetic walker integration.

      const result = originalInit({
        ...source,
        getDialogueOpen: () => !!session || !!gameGetDialogueOpen?.(),
        getDialogueWalker: () => session?.walker || gameGetDialogueWalker?.(),
        closeNpcDialogue: () => session ? closeDialogueTest({ completed: false }) : gameCloseNpcDialogue?.(),
      });
      void prepareRescueDialogue();
      return result;
    };
    Object.defineProperty(api, '__prologueDialogueTargetWrapped', { value: true, configurable: true });
    return api;
  }

  function chainGlobal(name, installer) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Used to compose with earlier parser-time wrappers safely.
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

    let stored = null; // Used only until the protected namespace is assigned.
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
    prepareRescueActors,
    prepareRescueDialogue,
    prepareRescueStage,
    isRescueActorsReady: () => actorsReady,
    isRescueStageReady: () => dialogueReady,
    advanceDialogueTest,
    closeDialogueTest,
    debugSnapshot: () => ({
      currentArea: currentArea(),
      rescueActive: rescuePrologueActive(),
      actorsReady,
      dialogueReady,
      loaderOwnedBy: 'PrologueRescueMapRuntime',
      hiddenSetup: !!window.__hobunjiPrologueHiddenSetup,
      actorCount: actorInstances.size,
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
