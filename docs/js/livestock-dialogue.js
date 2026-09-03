// Full 3D livestock dialogue session.
//
// This module deliberately owns every livestock-specific concern: opening and
// closing the shared dialogue shell, player staging, animal facing/head gaze,
// authored head-world coordinates, camera targeting, and cleanup. game.js only
// continues to own ordinary NPC dialogue; FarmAnimals receives one injected
// openLivestockDialogue callback through its existing init(deps) contract.
(() => {
  'use strict';

  const PLAYER_LOCK_ID = 'player';
  const STAGE_DISTANCE_TILES = 1.35;
  const STAGE_DURATION_S = 0.34;
  const MAX_DT_S = 0.05;
  const FALLBACK_HEAD_HEIGHT_RATIO = 0.25;

  let farmDeps = null;
  let dialogueBridge = null;
  let session = null;
  let controlsBound = false;

  const debug = {
    farmBridgeInstalled: false,
    dialogueBridgeInstalled: false,
    opens: 0,
    closes: 0,
    lastError: null,
    last: null,
  };

  function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeKind(kind) {
    return String(kind || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function angleDiff(target, current) {
    if (typeof farmDeps?.angleDiff === 'function') return farmDeps.angleDiff(target, current);
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function headWorldPosition(animal, kind, out = new THREE.Vector3()) {
    const resolved = window.AnimalChatheadFrame?.frameForKind?.(kind);
    const frame = resolved?.frame || resolved;
    const plane = animal?.avatarRef?.frontPlane || null;
    const modelWidth = finite(animal?.modelWidth, 0);
    const modelHeight = finite(animal?.modelHeight, 0);
    if (frame && plane?.localToWorld && modelWidth > 0 && modelHeight > 0) {
      const centerX = finite(frame.x) + finite(frame.width) * 0.5;
      const centerY = finite(frame.y) + finite(frame.height) * 0.5;
      out.set((centerX - 0.5) * modelWidth, (0.5 - centerY) * modelHeight, 0);
      plane.updateWorldMatrix?.(true, false);
      return plane.localToWorld(out);
    }
    if (animal?.avatarRef?.group?.getWorldPosition) {
      animal.avatarRef.group.updateWorldMatrix?.(true, false);
      animal.avatarRef.group.getWorldPosition(out);
      out.y += (modelHeight || 1) * FALLBACK_HEAD_HEIGHT_RATIO;
      return out;
    }
    out.set(finite(animal?.wx), finite(animal?.wy) + (modelHeight || 1) * FALLBACK_HEAD_HEIGHT_RATIO, finite(animal?.wz));
    return out;
  }

  function currentAnimalWorld(animal) {
    return {
      x: Number.isFinite(Number(animal?.wx)) ? Number(animal.wx) : finite(animal?.avatarRef?.group?.position?.x),
      z: Number.isFinite(Number(animal?.wz)) ? Number(animal.wz) : finite(animal?.avatarRef?.group?.position?.z),
    };
  }

  function stageTileIsUsable(worldX, worldZ, animal) {
    const col = Math.floor(worldX);
    const row = Math.floor(worldZ);
    const grid = farmDeps?.getGrid?.();
    const tile = grid?.[row]?.[col];
    if (!tile) return false;
    if (farmDeps?.isSolid?.(tile.type)) return false;
    const blockedTypes = [farmDeps?.TileType?.TRENCH, farmDeps?.TileType?.RIVER, farmDeps?.TileType?.STREAM].filter(value => value != null);
    if (blockedTypes.includes(tile.type)) return false;
    const occupant = farmDeps?.getWorldObjectAt?.(col, row);
    return !occupant || occupant === animal;
  }

  function computeStageTarget(animal) {
    const player = farmDeps?.player;
    const tileSize = finite(farmDeps?.TILE, 1) || 1;
    const animalWorld = currentAnimalWorld(animal);
    const playerWorldX = finite(player?.x) / tileSize;
    const playerWorldZ = finite(player?.y) / tileSize;
    let dx = playerWorldX - animalWorld.x;
    let dz = playerWorldZ - animalWorld.z;
    let distance = Math.hypot(dx, dz);
    if (distance < 0.05) {
      const bodyRot = finite(animal?.groupRot, 0);
      dx = Math.sin(bodyRot + Math.PI / 2);
      dz = Math.cos(bodyRot + Math.PI / 2);
      distance = Math.hypot(dx, dz) || 1;
    }
    const candidateX = animalWorld.x + dx / distance * STAGE_DISTANCE_TILES;
    const candidateZ = animalWorld.z + dz / distance * STAGE_DISTANCE_TILES;
    if (!stageTileIsUsable(candidateX, candidateZ, animal)) {
      return { x: finite(player?.x), y: finite(player?.y), moved: false };
    }
    return { x: candidateX * tileSize, y: candidateZ * tileSize, moved: true };
  }

  function playerFaceWorldTarget() {
    const provided = farmDeps?.getPlayerFaceTarget?.();
    if (provided) {
      const z = Number.isFinite(Number(provided.z)) ? Number(provided.z) : Number(provided.y);
      const y = Number(provided.worldY);
      if (Number.isFinite(Number(provided.x)) && Number.isFinite(z) && Number.isFinite(y)) {
        return { x: Number(provided.x), y, z };
      }
    }
    const tileSize = finite(farmDeps?.TILE, 1) || 1;
    const player = farmDeps?.player;
    return {
      x: finite(player?.x) / tileSize,
      y: session ? headWorldPosition(session.animal, session.kind, session.headScratch).y + 0.25 : 1,
      z: finite(player?.y) / tileSize,
    };
  }

  function updatePlayerStaging(s, nowMs) {
    const player = farmDeps?.player;
    if (!player) return;
    const elapsed = Math.max(0, (nowMs - s.startedAtMs) / 1000);
    const t = Math.min(1, elapsed / STAGE_DURATION_S);
    const eased = t * t * (3 - 2 * t);
    if (s.stage.moved && t < 1) {
      player.x = s.startPlayer.x + (s.stage.x - s.startPlayer.x) * eased;
      player.y = s.startPlayer.y + (s.stage.y - s.startPlayer.y) * eased;
    } else if (s.stage.moved) {
      player.x = s.stage.x;
      player.y = s.stage.y;
    }
    player.vx = 0;
    player.vy = 0;

    const tileSize = finite(farmDeps?.TILE, 1) || 1;
    const animalWorld = currentAnimalWorld(s.animal);
    const playerWorldX = finite(player.x) / tileSize;
    const playerWorldZ = finite(player.y) / tileSize;
    const playerAngle = Math.atan2(animalWorld.z - playerWorldZ, animalWorld.x - playerWorldX);
    farmDeps?.setFacingAngle?.(playerAngle);
    player.angle = playerAngle;
  }

  function updateAnimalFacing(s, dt) {
    const animal = s.animal;
    const player = farmDeps?.player;
    const tileSize = finite(farmDeps?.TILE, 1) || 1;
    if (!animal || !player) return;
    const animalWorld = currentAnimalWorld(animal);
    const playerWorldX = finite(player.x) / tileSize;
    const playerWorldZ = finite(player.y) / tileSize;
    const requested = -Math.atan2(playerWorldZ - animalWorld.z, playerWorldX - animalWorld.x) + Math.PI / 2;
    let target = requested;
    const baseDeadRad = Number(farmDeps?.CREATURE_PERP_DEAD_RAD ?? window.PerpRotation?.CREATURE_PERP_DEAD_RAD);
    const perps = farmDeps?.cameraRelativeCreaturePerps?.();
    const perpClamp = farmDeps?.perpClamp || window.PerpRotation?.perpClamp;
    if (typeof perpClamp === 'function' && Array.isArray(perps) && perps.length && Number.isFinite(baseDeadRad)) {
      const extraRad = finite(window.AnimalChatheadFrame?.DIALOGUE_FACE_EXTRA_DEG, 8) * Math.PI / 180;
      const dialogueDeadRad = Math.min(Math.PI / 2 - 0.01, baseDeadRad + extraRad);
      const resolved = perpClamp(s.perpState, requested, perps, dialogueDeadRad);
      if (Number.isFinite(Number(resolved?.effectiveTarget))) target = Number(resolved.effectiveTarget);
      s.lastDeadzoneDeg = dialogueDeadRad * 180 / Math.PI;
    }
    const current = Number.isFinite(Number(animal.groupRot)) ? Number(animal.groupRot) : finite(animal.avatarRef?.group?.rotation?.y);
    const blend = Math.min(1, Math.max(0, dt) * 9.5);
    animal.groupRot = current + angleDiff(target, current) * blend;
    animal.targetRot = requested;
    if (animal.avatarRef?.group) animal.avatarRef.group.rotation.y = animal.groupRot;

    const targetWorld = playerFaceWorldTarget();
    const selfHead = headWorldPosition(animal, s.kind, s.headScratch);
    const dx = targetWorld.x - selfHead.x;
    const dy = targetWorld.y - selfHead.y;
    const dz = targetWorld.z - selfHead.z;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > 1e-5 || Math.abs(dy) > 1e-5) {
      const desiredWorldRot = -Math.atan2(dz, dx) + Math.PI / 2;
      const yawDeg = angleDiff(desiredWorldRot, animal.groupRot) * 180 / Math.PI;
      const pitchDeg = -Math.atan2(dy, Math.max(0.0001, horizontal)) * 180 / Math.PI;
      animal.avatarRef?.updateHeadYaw?.(yawDeg, dt);
      animal.avatarRef?.updateHeadRotation?.(pitchDeg, dt);
      animal._lookAtDebug = {
        head: { x: selfHead.x, y: selfHead.y, z: selfHead.z },
        target: { x: targetWorld.x, y: targetWorld.y, z: targetWorld.z },
      };
    }
  }

  function tick(nowMs) {
    const s = session;
    if (!s) return;
    const dt = Math.min(MAX_DT_S, Math.max(0, (nowMs - s.lastFrameMs) / 1000));
    s.lastFrameMs = nowMs;
    updatePlayerStaging(s, nowMs);
    updateAnimalFacing(s, dt);
    s.raf = requestAnimationFrame(tick);
  }

  function cameraModeKey() {
    return farmDeps?.cameraConfig?.()?.dialogueMode || 'npcDialogue';
  }

  function openDialogueShell(rec) {
    window.WorldPopupText?.clearInteractionPrompts?.();
    const dialogueEl = document.getElementById('npcDialogue');
    const portraitCanvas = document.getElementById('npcPortraitCanvas');
    const nameEl = document.getElementById('npcDialogueName');
    const heartsEl = document.getElementById('npcDialogueHearts');
    const arc = document.getElementById('arcContainer');
    if (nameEl) nameEl.textContent = rec?.name || 'Livestock';
    if (heartsEl) heartsEl.textContent = '';
    portraitCanvas?.getContext?.('2d')?.clearRect(0, 0, portraitCanvas.width, portraitCanvas.height);
    arc?.classList.add('arc-hidden');
    dialogueEl?.classList.add('open');
    dialogueEl?.setAttribute('aria-hidden', 'false');
  }

  function closeDialogueShell() {
    const dialogueEl = document.getElementById('npcDialogue');
    const arc = document.getElementById('arcContainer');
    dialogueEl?.classList.remove('open');
    dialogueEl?.setAttribute('aria-hidden', 'true');
    arc?.classList.remove('arc-hidden');
  }

  function open(animal, livestockRec, dialogueLines = []) {
    try {
      if (!animal || !livestockRec || session || !farmDeps || !dialogueBridge) return false;
      if (dialogueBridge.gameGetDialogueOpen?.()) return false;
      const kind = normalizeKind(livestockRec.kind || animal.animalKey);
      const lines = Array.isArray(dialogueLines) && dialogueLines.length
        ? dialogueLines.filter(line => String(line || '').trim())
        : (window.AnimalVocalizations?.dialogueLinesFor?.(animal) || []).filter(line => String(line || '').trim());
      const rec = {
        id: `livestock:${livestockRec.id || animal.livestockId || animal.id}`,
        name: livestockRec.name || 'Livestock',
        speciesId: kind,
        dialogueLines: lines.length ? lines : ['...'],
      };
      const cameraScratch = new THREE.Vector3();
      const walker = {
        rec,
        root: animal.avatarRef?.group || null,
        avatarHeight: finite(animal.modelHeight, 1),
        pause: Infinity,
        dialogueHeadWorldPosition(out = new THREE.Vector3()) { return headWorldPosition(animal, kind, out); },
      };
      const stage = computeStageTarget(animal);
      const now = performance.now();
      const lock = window.CharacterActionLocks?.acquire?.({
        owner: 'livestock-dialogue',
        reason: `talking to ${rec.name}`,
        participants: [PLAYER_LOCK_ID],
        channels: ['movement', 'tools', 'actions'],
      }) || null;
      session = {
        animal,
        livestockRec,
        kind,
        rec,
        walker,
        lock,
        stage,
        startPlayer: { x: finite(farmDeps.player?.x), y: finite(farmDeps.player?.y) },
        startedAtMs: now,
        lastFrameMs: now,
        prevCameraMode: farmDeps.getCameraMode?.(),
        prevCameraTarget: farmDeps.getCameraTarget?.(),
        headScratch: new THREE.Vector3(),
        perpState: {},
        raf: 0,
        cameraTarget: {
          get position() { return headWorldPosition(animal, kind, cameraScratch); },
        },
      };
      animal._dialogueFrozen = true;
      farmDeps.setCameraMode?.(cameraModeKey());
      farmDeps.setCameraTarget?.(session.cameraTarget);
      openDialogueShell(rec);
      window.DialogueContent?.hideChoiceButtons?.();
      window.DialogueContent?.beginNpcConversation?.(rec);
      session.raf = requestAnimationFrame(tick);
      debug.opens++;
      debug.lastError = null;
      debug.last = { livestockId: livestockRec.id || animal.livestockId || null, kind, name: rec.name, openedAt: Date.now() };
      return true;
    } catch (error) {
      debug.lastError = String(error?.message || error);
      console.warn('[livestock-dialogue] failed to open', error);
      close();
      return false;
    }
  }

  function close() {
    const s = session;
    if (!s) return false;
    session = null;
    if (s.raf) cancelAnimationFrame(s.raf);
    window.DialogueContent?.stopNpcDialogueTypewriter?.(false);
    window.DialogueContent?.hideChoiceButtons?.();
    window.DialogueContent?.resetDialogueState?.();
    closeDialogueShell();
    if (s.animal) {
      s.animal._dialogueFrozen = false;
      s.animal._lookAtDebug = null;
      delete s.animal._animalChatheadDialoguePerpState;
      s.animal.avatarRef?.updateHeadYaw?.(0, 1);
      const restDeg = Number(s.animal.avatarRef?.headRig?.rig?.restDeg);
      s.animal.avatarRef?.updateHeadRotation?.(Number.isFinite(restDeg) ? restDeg : 0, 1);
    }
    s.lock?.release?.();
    farmDeps?.setCameraMode?.(s.prevCameraMode ?? (farmDeps?.cameraConfig?.()?.defaultMode || 'default'));
    farmDeps?.setCameraTarget?.(s.prevCameraTarget ?? null);
    debug.closes++;
    return true;
  }

  function bindDialogueControls() {
    if (controlsBound || typeof document === 'undefined') return;
    controlsBound = true;
    document.addEventListener('click', event => {
      if (!session) return;
      const id = event.target?.closest?.('#npcDialogueContinue,#npcDialogueLeave')?.id;
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (id === 'npcDialogueLeave') close();
      else window.DialogueContent?.advanceNpcDialogue?.();
    }, true);
  }

  function installFarmBridge(value) {
    if (!value?.init || value.__livestockDialogueInitWrapped) return;
    const originalInit = value.init;
    value.init = function livestockDialogueAwareFarmInit(injectedDeps) {
      farmDeps = injectedDeps || null;
      return originalInit.call(value, { ...(injectedDeps || {}), openLivestockDialogue: open });
    };
    value.__livestockDialogueInitWrapped = true;
    debug.farmBridgeInstalled = true;
  }

  function installDialogueBridge(value) {
    if (!value?.init || value.__livestockDialogueInitWrapped) return;
    const originalInit = value.init;
    value.init = function livestockDialogueAwareContentInit(injectedDeps) {
      const source = injectedDeps || {};
      const gameGetDialogueOpen = source.getDialogueOpen;
      const gameGetDialogueWalker = source.getDialogueWalker;
      const gameCloseNpcDialogue = source.closeNpcDialogue;
      dialogueBridge = { gameGetDialogueOpen, gameGetDialogueWalker, gameCloseNpcDialogue };
      return originalInit.call(value, {
        ...source,
        getDialogueOpen: () => !!session || !!gameGetDialogueOpen?.(),
        getDialogueWalker: () => session?.walker || gameGetDialogueWalker?.(),
        closeNpcDialogue: () => session ? close() : gameCloseNpcDialogue?.(),
      });
    };
    value.__livestockDialogueInitWrapped = true;
    debug.dialogueBridgeInstalled = true;
  }

  function watchGlobal(name, installer) {
    const current = window[name];
    if (current) { installer(current); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && descriptor.configurable === false) return;
    let stored = current;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return stored; },
      set(value) { stored = value; installer(value); },
    });
  }

  function debugSnapshot() {
    return {
      ...debug,
      active: !!session,
      activeLivestockId: session?.livestockRec?.id || session?.animal?.livestockId || null,
      activeKind: session?.kind || null,
      dialogueDeadzoneDeg: session?.lastDeadzoneDeg || null,
      cameraMode: farmDeps?.getCameraMode?.() || null,
    };
  }

  window.LivestockDialogue = Object.freeze({
    open,
    close,
    headWorldPosition,
    debugSnapshot,
    get active() { return !!session; },
  });
  window.__livestockDialogueDebug = debug;
  bindDialogueControls();
  watchGlobal('FarmAnimals', installFarmBridge);
  watchGlobal('DialogueContent', installDialogueBridge);
})();
