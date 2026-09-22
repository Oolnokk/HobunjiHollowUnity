// Authored cinematic-camera runtime shared by dialogue and cutscene playback.
//
// Maps/locales may expose `cinematicCameras` records. The live game registers
// those records per area and can then resolve one by id, or automatically pick
// the nearest camera tagged for a dialogue NPC. Camera movement itself remains
// owned by game.js's existing updateCameraPosition() loop; this module only
// owns authoring data, selection, dialogue presentation metadata, and the
// smooth pet fade requested by a camera.
(() => {
  'use strict';

  let deps = null;
  const camerasByArea = new Map(); // areaId -> normalized authored cameras used by dialogue/cutscene camera lookup.
  let active = null; // { areaId, camera, reason } consumed by game.js's camera override.
  let dialogueContext = null; // Current NPC conversation, used by node-level camera swaps.
  let petFade = 0; // 0 = ordinary pet visibility, 1 = fully faded for the current cinematic shot.
  const fadedMaterials = new Map(); // mesh -> [{material, opacity, transparent, depthWrite}] restored after cinematic fade.

  function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizePoint(raw, fallbackY = 0) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      x: finite(value.x ?? value.col, 0),
      y: finite(value.y ?? value.height, fallbackY),
      z: finite(value.z ?? value.row, 0),
    };
  }

  function normalizeCamera(raw, index = 0) {
    const camera = raw && typeof raw === 'object' ? raw : {};
    const id = String(camera.id || `camera_${index + 1}`);
    const position = normalizePoint(camera.position, 0.35);
    const target = normalizePoint(camera.target, 0.8);
    const stageRaw = camera.playerStage && typeof camera.playerStage === 'object' ? camera.playerStage : null;
    return {
      ...camera,
      id,
      label: String(camera.label || id),
      position,
      target,
      fovDeg: Math.max(10, Math.min(120, finite(camera.fovDeg, 42))),
      blendSeconds: Math.max(0, finite(camera.blendSeconds, 0.45)),
      dialogueNpcId: String(camera.dialogueNpcId || ''),
      useForDialogue: camera.useForDialogue === true || !!camera.dialogueNpcId,
      fadePets: camera.fadePets === true,
      playerStage: stageRaw ? {
        x: finite(stageRaw.x ?? stageRaw.col, position.x),
        z: finite(stageRaw.z ?? stageRaw.row, position.z),
      } : null,
    };
  }

  function init(injectedDeps) {
    deps = injectedDeps || {};
  }

  function registerArea(areaId, cameras) {
    const id = String(areaId || '');
    if (!id) return [];
    const normalized = Array.isArray(cameras)
      ? cameras.map((camera, index) => normalizeCamera(camera, index))
      : [];
    camerasByArea.set(id, normalized);
    return normalized;
  }

  function unregisterArea(areaId) {
    camerasByArea.delete(String(areaId || ''));
    if (active?.areaId === areaId) deactivate('area-unregistered');
  }

  function camerasForArea(areaId) {
    return camerasByArea.get(String(areaId || '')) || [];
  }

  function cameraForId(areaId, cameraId) {
    const id = String(cameraId || '');
    if (!id) return null;
    return camerasForArea(areaId).find(camera => camera.id === id) || null;
  }

  function activate(areaId, cameraId, options = {}) {
    const camera = typeof cameraId === 'object'
      ? normalizeCamera(cameraId, 0)
      : cameraForId(areaId, cameraId);
    if (!camera) return null;
    active = {
      areaId: String(areaId || ''),
      camera,
      reason: String(options.reason || 'manual'),
      activatedAt: performance.now(),
    };
    return active;
  }

  function deactivate() {
    active = null;
  }

  function nearestDialogueCamera(context) {
    const areaId = String(context?.areaId || '');
    const npcId = String(context?.npcId || '');
    const explicit = String(context?.cameraId || '');
    if (explicit) return cameraForId(areaId, explicit);

    const candidates = camerasForArea(areaId).filter(camera =>
      camera.dialogueNpcId === npcId
      || (camera.useForDialogue && !camera.dialogueNpcId)
    );
    if (!candidates.length) return null;

    const root = context?.walker?.root;
    const x = finite(root?.position?.x, NaN);
    const z = finite(root?.position?.z, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return candidates[0];

    let best = candidates[0];
    let bestDistance = Infinity;
    for (const camera of candidates) {
      const tx = finite(camera.target?.x, 0);
      const tz = finite(camera.target?.z, 0);
      const distance = (tx - x) * (tx - x) + (tz - z) * (tz - z);
      if (distance < bestDistance) {
        best = camera;
        bestDistance = distance;
      }
    }
    return best;
  }

  function beginDialogue(context = {}) {
    dialogueContext = {
      areaId: String(context.areaId || ''),
      npcId: String(context.npcId || ''),
      walker: context.walker || null,
      cameraId: String(context.cameraId || ''),
    };
    const camera = nearestDialogueCamera(dialogueContext);
    if (!camera) {
      active = null;
      return null;
    }
    return activate(dialogueContext.areaId, camera.id, { reason: 'dialogue' });
  }

  function applyDialogueNodeCamera(node) {
    if (!dialogueContext || !node || typeof node !== 'object') return active;
    const cameraId = String(node.cameraId || '');
    if (!cameraId) return active;
    return activate(dialogueContext.areaId, cameraId, { reason: 'dialogue-node' }) || active;
  }

  function endDialogue() {
    dialogueContext = null;
    if (active?.reason === 'dialogue' || active?.reason === 'dialogue-node') active = null;
  }

  function activeCamera() {
    return active?.camera || null;
  }

  function activeRecord() {
    return active;
  }

  function currentPlayerStage() {
    return active?.camera?.playerStage || null;
  }

  function isActive() {
    return !!active?.camera;
  }

  function petRoots() {
    if (!deps) return [];
    const areaId = String(deps.getCurrentArea?.() || '');
    const player = deps.getPlayer?.();
    const out = [];
    for (const creature of (deps.getCompanionObjects?.() || [])) {
      if (!creature || !(creature.health > 0)) continue;
      if (String(creature.areaId || creature.zoneId || '') !== areaId) continue;
      if (creature.master && player && creature.master !== player) continue;
      if (creature.stableRole !== 'shoulderPet' && creature.stableRole !== 'companion') continue;
      const root = creature.avatarRef?.group || creature.mesh || null;
      if (root) out.push(root);
    }
    return out;
  }

  function captureFadeMaterials(root) {
    root?.traverse?.(object => {
      if (!object?.isMesh || !object.material || fadedMaterials.has(object)) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      const cloned = source.map(material => material?.clone ? material.clone() : material);
      object.material = Array.isArray(object.material) ? cloned : cloned[0];
      fadedMaterials.set(object, cloned.map(material => ({
        material,
        opacity: Number.isFinite(Number(material?.opacity)) ? Number(material.opacity) : 1,
        transparent: !!material?.transparent,
        depthWrite: material?.depthWrite !== false,
      })));
    });
  }

  function applyPetOpacity(visibleFactor) {
    const roots = petRoots();
    for (const root of roots) captureFadeMaterials(root);
    for (const [mesh, states] of fadedMaterials) {
      if (!mesh?.parent) {
        fadedMaterials.delete(mesh);
        continue;
      }
      for (const state of states) {
        if (!state.material) continue;
        state.material.opacity = state.opacity * visibleFactor;
        state.material.transparent = state.transparent || visibleFactor < 0.999;
        state.material.depthWrite = visibleFactor >= 0.999 ? state.depthWrite : false;
        state.material.needsUpdate = true;
      }
    }
  }

  function restorePetMaterials() {
    for (const [mesh, states] of fadedMaterials) {
      for (const state of states) {
        if (!state.material) continue;
        state.material.opacity = state.opacity;
        state.material.transparent = state.transparent;
        state.material.depthWrite = state.depthWrite;
        state.material.needsUpdate = true;
      }
      if (!mesh?.parent) fadedMaterials.delete(mesh);
    }
    if (petFade <= 0.0001) fadedMaterials.clear();
  }

  function update(dt) {
    const target = active?.camera?.fadePets ? 1 : 0;
    const safeDt = Math.max(0, Math.min(0.1, Number(dt) || 0));
    const alpha = 1 - Math.exp(-9 * safeDt);
    petFade += (target - petFade) * alpha;
    if (Math.abs(target - petFade) < 0.002) petFade = target;
    if (petFade > 0.0001) applyPetOpacity(Math.max(0, 1 - petFade));
    else restorePetMaterials();
  }

  function debugSnapshot() {
    return {
      activeArea: active?.areaId || null,
      activeCameraId: active?.camera?.id || null,
      activeReason: active?.reason || null,
      petFade,
      registeredAreas: camerasByArea.size,
    };
  }

  window.CinematicCameraRuntime = {
    init,
    registerArea,
    unregisterArea,
    camerasForArea,
    cameraForId,
    activate,
    deactivate,
    beginDialogue,
    applyDialogueNodeCamera,
    endDialogue,
    activeCamera,
    activeRecord,
    currentPlayerStage,
    isActive,
    update,
    debugSnapshot,
  };
})();