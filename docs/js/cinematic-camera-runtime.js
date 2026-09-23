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
  const fadedMaterials = new Map(); // mesh -> { originalMaterial, states }; temporary fade clones are restored/disposed when the shot ends.

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
    const targetNpcId = String(camera.targetNpcId || '');
    const target = normalizePoint(camera.target, targetNpcId ? 0 : 0.8); // When targetNpcId is set this is a face-relative offset; otherwise it remains an absolute authored point.
    const stageRaw = camera.playerStage && typeof camera.playerStage === 'object' ? camera.playerStage : null;
    return {
      ...camera,
      id,
      label: String(camera.label || id),
      position,
      target,
      targetNpcId,
      targetAnchorId: String(camera.targetAnchorId || ''),
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
      targetWalker: options.targetWalker || null,
      lastResolvedTarget: null,
      activatedAt: performance.now(),
    };
    return active;
  }

  function deactivate() {
    active = null;
  }

  function walkerNpcId(walker) {
    return String(walker?.rec?.id || walker?.npcId || '');
  }

  function targetWalkerFor(camera, record = active) {
    const npcId = String(camera?.targetNpcId || '');
    if (!npcId) return null;
    const direct = record?.targetWalker;
    if (direct && walkerNpcId(direct) === npcId) return direct;
    return deps?.getNpcWalker?.(npcId, record?.areaId || deps?.getCurrentArea?.()) || null;
  }

  function resolvedTargetFor(camera, record = active) {
    if (!camera) return null;
    if (!camera.targetNpcId) return { ...camera.target };
    const walker = targetWalkerFor(camera, record);
    const face = walker ? deps?.getNpcFacePosition?.(walker) : null;
    if (!face || !Number.isFinite(Number(face.x)) || !Number.isFinite(Number(face.y)) || !Number.isFinite(Number(face.z))) {
      return record?.lastResolvedTarget ? { ...record.lastResolvedTarget } : null;
    }
    const resolved = {
      x: Number(face.x) + finite(camera.target?.x, 0),
      y: Number(face.y) + finite(camera.target?.y, 0),
      z: Number(face.z) + finite(camera.target?.z, 0),
    };
    if (record) record.lastResolvedTarget = resolved;
    return { ...resolved };
  }

  function resolvedTarget() {
    return resolvedTargetFor(active?.camera, active);
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

    const stationId = String(context?.walker?.currentScheduleTarget?.stationId || context?.walker?.currentScheduleTarget?.id || context?.walker?._seatedStationKey || '');
    if (stationId) {
      const stationMatch = candidates.find(camera => camera.targetAnchorId && camera.targetAnchorId === stationId);
      if (stationMatch) return stationMatch;
    }

    let best = candidates[0];
    let bestDistance = Infinity;
    for (const camera of candidates) {
      // NPC-targeted cameras store target as a face-relative offset, so it cannot identify which authored shot is spatially nearest.
      // Use the camera position as the fallback discriminator; legacy absolute-target cameras keep their old target-based behavior.
      const px = camera.targetNpcId ? finite(camera.position?.x, 0) : finite(camera.target?.x, 0);
      const pz = camera.targetNpcId ? finite(camera.position?.z, 0) : finite(camera.target?.z, 0);
      const distance = (px - x) * (px - x) + (pz - z) * (pz - z);
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
    return activate(dialogueContext.areaId, camera.id, { reason: 'dialogue', targetWalker: dialogueContext.walker });
  }

  function applyDialogueNodeCamera(node) {
    if (!dialogueContext || !node || typeof node !== 'object') return active;
    const cameraId = String(node.cameraId || '');
    if (!cameraId) return active;
    return activate(dialogueContext.areaId, cameraId, { reason: 'dialogue-node', targetWalker: dialogueContext.walker }) || active;
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
      const originalMaterial = object.material; // Restored verbatim after the fade so repeated conversations never accumulate cloned avatar materials.
      const source = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
      const cloned = source.map(material => material?.clone ? material.clone() : material);
      object.material = Array.isArray(originalMaterial) ? cloned : cloned[0];
      fadedMaterials.set(object, {
        originalMaterial,
        states: cloned.map((material, index) => ({
          material,
          ownedClone: material !== source[index], // Only temporary clones are ours to dispose; non-cloneable originals are merely property-restored.
          opacity: Number.isFinite(Number(material?.opacity)) ? Number(material.opacity) : 1,
          transparent: !!material?.transparent,
          depthWrite: material?.depthWrite !== false,
        })),
      });
    });
  }

  function restoreFadeEntry(mesh, record) {
    if (!record) return;
    for (const state of record.states || []) {
      if (!state.material) continue;
      if (state.ownedClone) {
        state.material.dispose?.(); // Temporary per-shot material clone; textures remain shared and are not disposed here.
      } else {
        state.material.opacity = state.opacity;
        state.material.transparent = state.transparent;
        state.material.depthWrite = state.depthWrite;
        state.material.needsUpdate = true;
      }
    }
    if (mesh) mesh.material = record.originalMaterial;
  }

  function applyPetOpacity(visibleFactor) {
    const roots = petRoots();
    for (const root of roots) captureFadeMaterials(root);
    for (const [mesh, record] of fadedMaterials) {
      if (!mesh?.parent) {
        restoreFadeEntry(mesh, record);
        fadedMaterials.delete(mesh);
        continue;
      }
      for (const state of record.states || []) {
        if (!state.material) continue;
        state.material.opacity = state.opacity * visibleFactor;
        state.material.transparent = state.transparent || visibleFactor < 0.999;
        state.material.depthWrite = visibleFactor >= 0.999 ? state.depthWrite : false;
        state.material.needsUpdate = true;
      }
    }
  }

  function restorePetMaterials() {
    if (petFade > 0.0001) return;
    for (const [mesh, record] of fadedMaterials) restoreFadeEntry(mesh, record);
    fadedMaterials.clear();
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
    const target = resolvedTarget(); // Used by Pixel Probe to verify the live face point on mobile without devtools.
    const camera = active?.camera || null; // Used by Pixel Probe to verify authored camera height/position.
    return {
      activeArea: active?.areaId || null,
      activeCameraId: camera?.id || null,
      activeReason: active?.reason || null,
      cameraPosition: camera ? { ...camera.position } : null,
      resolvedTarget: target ? { ...target } : null,
      targetNpcId: camera?.targetNpcId || null,
      petFade,
      registeredAreas: camerasByArea.size,
      latestChange: 'World-space dialogue framing; live scaled face targeting; Banubu camera Y=0',
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
    resolvedTarget,
    currentPlayerStage,
    isActive,
    update,
    debugSnapshot,
  };
})();