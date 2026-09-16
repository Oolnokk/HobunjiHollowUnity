// NPC dance presentation repair layer.
//
// Two deliberately presentation-only responsibilities live here:
// 1) Dance hands are applied AFTER ProceduralHandFrameDriver's -100000
//    pre-render sync, so the dance pose becomes the final hand pose just like
//    the proven-working player social dance path. The pose intentionally stays
//    on the sockets after the visible draw: outline/depth/material-ID renders
//    may filter invisible sentinels out by layer, so restoring between render()
//    calls can expose the ordinary idle hierarchy to those secondary passes.
//    Repeated sentinel draws are idempotent: each side remembers the latest
//    ordinary-driver baseline and always reapplies the dance from that baseline
//    instead of accumulating dance deltas.
// 2) World-avatar front textures are re-baked with the authored `smile`
//    mouth while an NPC is actually dancing, then restored to the ordinary
//    resting expression when the dance ends. This never mutates dialogue
//    state or the NPC's persisted appearance data.
(function (global) {
  'use strict';

  if (global.NpcDancePresentationRuntime?.installed) return;

  const THREE = global.THREE;
  if (!THREE) return;

  const state = {
    plannerDeps: null,
    sentinels: new Map(), // npcId -> { walker, sentinel, left, right, session, handPoseState }
    smile: new Map(), // npcId -> async expression refresh state
    handApplications: 0,
    handBaseRefreshes: 0, // Counts fresh ordinary-hand baselines captured after the normal hand driver updates a socket.
    handBaseReuses: 0, // Counts secondary/repeated draws that reuse the last ordinary baseline instead of stacking dance deltas.
    smileApplications: 0,
    smileRestores: 0,
    smileErrors: 0,
  };

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, Number(value) || 0));
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function socialConfig() {
    return global.SCRATCHBONES_CONFIG?.game?.socialActions || {};
  }

  function cfgNumber(key, fallback, lo = -Infinity, hi = Infinity) {
    const value = Number(socialConfig()[key]);
    return Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
  }

  function chainGlobal(name, patcher) {
    const current = global[name];
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : current;
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return oldGet ? oldGet.call(global) : stored; },
        set(value) {
          if (oldSet) oldSet.call(global, value);
          else stored = value;
          const resolved = oldGet ? oldGet.call(global) : stored;
          if (resolved) patcher(resolved);
        },
      });
    } catch (_) {}
  }

  function patchPlanner(api) {
    if (!api?.init || api.init.__npcDancePresentationDepsWrapped) return;
    const originalInit = api.init.bind(api);
    api.init = function npcDancePresentationPlannerInit(injectedDeps) {
      state.plannerDeps = injectedDeps || state.plannerDeps;
      return originalInit(injectedDeps);
    };
    api.init.__npcDancePresentationDepsWrapped = true;
  }

  function arrivedForSocialPose(walker, target) {
    if (!walker?.root || !target?.socialDance) return false;
    if (walker.state === 'idle') return true;
    if (!Number.isFinite(target.c) || !Number.isFinite(target.r)) return false;
    return Math.hypot(
      walker.root.position.x - (target.c + 0.5),
      walker.root.position.z - (target.r + 0.5),
    ) <= cfgNumber('npcDancePresentationArrivalRadiusTiles', 0.72, 0.05, 3);
  }

  function walkerDimensions(walker) {
    const height = Math.max(0.05, Number(walker?.avatarHeight) || 0.9);
    const width = Math.max(0.05, Number(walker?.avatarWidth) || height * 0.72 || 0.9);
    return { width, height };
  }

  function socketsFor(entry) {
    if (entry.left?.parent && entry.right?.parent) return { left: entry.left, right: entry.right };
    let left = null;
    let right = null;
    entry.walker?.root?.traverse?.(node => {
      if (node?.name === 'left_hand_socket') left = node;
      else if (node?.name === 'right_hand_socket') right = node;
    });
    entry.left = left;
    entry.right = right;
    return { left, right };
  }

  function socketMatchesAppliedPose(socket, poseState) {
    if (!socket || !poseState?.appliedPos || !poseState?.appliedQuat) return false;
    const positionError = socket.position.distanceToSquared(poseState.appliedPos); // Distinguishes an untouched dance pose from a fresh ordinary-driver socket write.
    const quaternionDot = Math.abs(socket.quaternion.dot(poseState.appliedQuat)); // Quaternion sign is irrelevant, so compare absolute dot product.
    return positionError <= 1e-12 && (1 - quaternionDot) <= 1e-10;
  }

  function baselineForSide(entry, side, socket) {
    const previous = entry.handPoseState?.[side] || null; // Last ordinary baseline and final dance pose for this side.
    if (previous && socketMatchesAppliedPose(socket, previous)) {
      state.handBaseReuses++;
      return previous;
    }

    const next = {
      basePos: socket.position.clone(), // Ordinary hand-driver position used as the source for every dance reapplication until that driver changes it.
      baseQuat: socket.quaternion.clone(), // Ordinary hand-driver rotation paired with basePos.
      appliedPos: null,
      appliedQuat: null,
    };
    entry.handPoseState[side] = next;
    state.handBaseRefreshes++;
    return next;
  }

  function rememberAppliedPose(socket, poseState) {
    if (!poseState.appliedPos) poseState.appliedPos = socket.position.clone();
    else poseState.appliedPos.copy(socket.position);
    if (!poseState.appliedQuat) poseState.appliedQuat = socket.quaternion.clone();
    else poseState.appliedQuat.copy(socket.quaternion);
  }

  function lateHandPose(entry, target) {
    if (!arrivedForSocialPose(entry.walker, target)) return;

    const presentation = target.socialDance;
    const { left, right } = socketsFor(entry);
    if (!left || !right) return;

    const session = `${presentation.stimulusId || 'dance'}:${presentation.style || 'loose-sway'}:${presentation.armStyle || 'overhead-punch'}`;
    if (entry.session !== session) {
      entry.session = session;
      entry.handPoseState = { left: null, right: null };
    }

    const beat = Number(global.SocialRhythmClock?.dancerBeatAt?.(
      entry.walker.rec?.id,
      nowMs(),
      session,
    ));
    if (!Number.isFinite(beat)) return;

    const dimensions = walkerDimensions(entry.walker);
    const phase = beat * Math.PI * 2;
    const fourBeatSway = Math.sin(phase * 0.25);
    const beatT = ((beat % 1) + 1) % 1;

    for (const side of ['left', 'right']) {
      const socket = side === 'left' ? left : right;
      const poseState = baselineForSide(entry, side, socket);
      socket.position.copy(poseState.basePos);
      socket.quaternion.copy(poseState.baseQuat);

      const sign = Math.sign(poseState.basePos.x) || (side === 'left' ? -1 : 1);
      if (presentation.armStyle === 'tpose-jiggle') {
        socket.position.x += sign * dimensions.width * 0.32;
        socket.position.y += dimensions.height * (
          0.08 + 0.035 * Math.sin(phase + (side === 'right' ? Math.PI : 0))
        );
        socket.position.z += fourBeatSway * dimensions.height * 0.035;
        socket.rotateZ(sign * (0.10 + 0.06 * Math.sin(phase * 0.5)));
      } else {
        const sidePhase = side === 'right' ? (beatT + 0.5) % 1 : beatT;
        const punch = Math.pow(Math.max(0, Math.sin(Math.PI * sidePhase)), 0.45);
        socket.position.x *= 1 - 0.32 * punch;
        socket.position.y += dimensions.height * (0.10 + 0.48 * punch);
        socket.position.z += dimensions.height * (0.045 - 0.055 * punch);
        socket.rotateX(-0.35 * punch);
      }
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
      rememberAppliedPose(socket, poseState);
    }

    // Deliberately do NOT restore the sockets after renderer.render(). The player
    // dance path leaves its final hand pose in place too. Secondary outline/depth
    // passes may omit invisible sentinels, so persisting this pose is what keeps
    // every later draw in the frame on the same hierarchy transform.
    state.handApplications++;
  }

  function disposeSentinel(entry) {
    const sentinel = entry?.sentinel;
    if (!sentinel) return;
    sentinel.parent?.remove?.(sentinel);
    sentinel.geometry?.dispose?.();
    sentinel.material?.dispose?.();
    entry.sentinel = null;
  }

  function makeSentinel(walker) {
    if (!walker?.root || !walker.rec?.id) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      0.0001, 0, 0,
      0, 0.0001, 0,
    ], 3));
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false });
    material.colorWrite = false;
    const sentinel = new THREE.Mesh(geometry, material);
    sentinel.name = `${walker.rec.id}_npc_dance_hand_sync`;
    sentinel.frustumCulled = false;
    // ProceduralHandFrameDriver owns -100000. This deliberately follows it,
    // matching the working player-social dance ownership ordering.
    sentinel.renderOrder = cfgNumber('npcDanceHandSyncRenderOrder', -99990, -99999, -1000);
    const entry = {
      walker,
      sentinel,
      left: null,
      right: null,
      session: null, // Current dance session key; a change invalidates remembered ordinary baselines.
      handPoseState: { left: null, right: null }, // Per-side ordinary baseline + last applied dance pose used to make repeated render passes idempotent.
    };
    sentinel.onBeforeRender = () => {
      const target = walker.currentScheduleTarget;
      if (!target?.socialDance) {
        entry.session = null;
        entry.handPoseState.left = null;
        entry.handPoseState.right = null;
        return;
      }
      lateHandPose(entry, target);
    };
    walker.root.add(sentinel);
    state.sentinels.set(String(walker.rec.id), entry);
    return entry;
  }

  function currentWalkers() {
    if (!state.plannerDeps?.listNpcWalkersInArea) return [];
    const area = state.plannerDeps.getCurrentArea?.();
    return state.plannerDeps.listNpcWalkersInArea(area) || [];
  }

  function syncSentinels() {
    const walkers = currentWalkers();
    const live = new Set();
    for (const walker of walkers) {
      const id = String(walker?.rec?.id || '');
      if (!id || !walker?.root) continue;
      live.add(id);
      const existing = state.sentinels.get(id);
      if (!existing || existing.walker !== walker || existing.sentinel?.parent !== walker.root) {
        if (existing) disposeSentinel(existing);
        makeSentinel(walker);
      }
    }
    for (const [id, entry] of state.sentinels) {
      if (live.has(id)) continue;
      disposeSentinel(entry);
      state.sentinels.delete(id);
    }
  }

  function profileForWalker(walker) {
    if (walker?.profile) return walker.profile;
    const rec = walker?.rec;
    if (!rec || !global.NpcAvatarPreview?.buildProfileFromNpcExport) return null;
    return global.NpcAvatarPreview.buildProfileFromNpcExport({
      name: rec.name || rec.id || 'npc',
      appearance: rec.appearance || {
        speciesId: undefined,
        gender: rec.gender === 'female' ? 'female' : 'male',
        cosmetics: {},
      },
      equippedCosmetics: rec.equippedCosmetics || [],
      appliedDyes: rec.appliedDyes || {},
    });
  }

  async function renderExpressionScratch(walker, smiling, seatId) {
    const preview = global.NpcAvatarPreview;
    const composer = global.portraitBreathingComposer;
    const source = walker?.avatarFrontCanvas || walker?.avatarGroup?.userData?.sourceCanvas;
    const profile = profileForWalker(walker);
    if (!source?.width || !source?.height || !profile || !preview?.renderProfileToCanvas || !composer) {
      throw new Error('NPC portrait expression renderer is not ready.');
    }

    if (smiling) {
      composer.setExpression?.(seatId, 'smile', cfgNumber('npcDanceSmileExpressionDurationMs', 86400000, 1000, 86400000));
    } else {
      composer.clearExpression?.(seatId);
    }

    const scratch = document.createElement('canvas');
    scratch.width = source.width;
    scratch.height = source.height;
    await preview.renderProfileToCanvas(scratch, profile, {
      seatId,
      forceEyesOpen: true,
    });
    return scratch;
  }

  function commitExpressionCanvas(walker, scratch) {
    const target = walker?.avatarFrontCanvas || walker?.avatarGroup?.userData?.sourceCanvas;
    if (!target?.getContext || !scratch) return false;
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(scratch, 0, 0, target.width, target.height);
    return !!global.PNGPlaneAvatar?.refreshSinglePlaneAvatarModel?.(
      walker.avatarGroup,
      target,
      { backCanvas: walker.avatarBackCanvas || walker.avatarGroup?.userData?.backCanvas || null },
    );
  }

  function ensureSmileRecord(walker) {
    const id = String(walker?.rec?.id || '');
    if (!id) return null;
    let record = state.smile.get(id);
    if (!record) {
      record = {
        id,
        walker,
        desired: false,
        applied: false,
        generation: 0,
        busy: false,
        nextRetryAt: 0,
        lastError: null,
      };
      state.smile.set(id, record);
    }
    record.walker = walker;
    return record;
  }

  async function processSmile(record) {
    if (!record || record.busy || nowMs() < record.nextRetryAt) return;
    record.busy = true;
    try {
      while (record.applied !== record.desired) {
        const desired = record.desired;
        const generation = record.generation;
        const walker = record.walker;
        const seatId = `world-dance:${record.id}`;
        let scratch;
        try {
          scratch = await renderExpressionScratch(walker, desired, seatId);
        } catch (error) {
          record.lastError = error?.message || String(error);
          record.nextRetryAt = nowMs() + 1200;
          state.smileErrors++;
          return;
        }
        // A dance may have ended/restarted while portrait assets were loading.
        // Never commit an obsolete expression frame to the live texture.
        if (generation !== record.generation || desired !== record.desired || walker !== record.walker) continue;
        if (!commitExpressionCanvas(walker, scratch)) {
          record.lastError = 'PNGPlaneAvatar refresh failed';
          record.nextRetryAt = nowMs() + 1200;
          state.smileErrors++;
          return;
        }
        record.applied = desired;
        record.lastError = null;
        record.nextRetryAt = 0;
        if (desired) state.smileApplications++;
        else state.smileRestores++;
      }
    } finally {
      record.busy = false;
    }
  }

  function requestSmile(walker, desired) {
    const record = ensureSmileRecord(walker);
    if (!record) return;
    const next = !!desired;
    if (record.desired !== next) {
      record.desired = next;
      record.generation++;
    }
    if (record.applied !== record.desired) processSmile(record);
  }

  function syncSmiles() {
    const walkers = currentWalkers();
    const live = new Set();
    for (const walker of walkers) {
      const id = String(walker?.rec?.id || '');
      if (!id) continue;
      live.add(id);
      const target = walker.currentScheduleTarget;
      requestSmile(walker, !!target?.socialDance && arrivedForSocialPose(walker, target));
    }
    // If somebody leaves the current area while smiling, restore the canvas
    // on the retained walker reference so they are not still smiling the next
    // time this already-existing world avatar becomes visible.
    for (const [id, record] of state.smile) {
      if (!live.has(id) && record.walker) requestSmile(record.walker, false);
    }
  }

  function tick() {
    syncSentinels();
    syncSmiles();
  }

  chainGlobal('NpcActivityPlanner', patchPlanner);
  global.setInterval?.(tick, cfgNumber('npcDancePresentationPollMs', 180, 60, 1000));
  global.setTimeout?.(tick, 0);

  global.NpcDancePresentationRuntime = Object.freeze({
    installed: true,
    getDebug(npcId) {
      if (npcId) {
        const id = String(npcId);
        const entry = state.sentinels.get(id);
        const smile = state.smile.get(id);
        return {
          npcId: id,
          hasHandSentinel: !!entry?.sentinel?.parent,
          handSentinelRenderOrder: entry?.sentinel?.renderOrder ?? null,
          handPoseOwnership: 'persist-until-ordinary-hand-sync',
          handSession: entry?.session || null,
          dancing: !!entry?.walker?.currentScheduleTarget?.socialDance,
          smileDesired: smile?.desired ?? false,
          smileApplied: smile?.applied ?? false,
          smileBusy: smile?.busy ?? false,
          smileError: smile?.lastError || null,
        };
      }
      return {
        depsCaptured: !!state.plannerDeps,
        handPoseOwnership: 'persist-until-ordinary-hand-sync',
        handSentinels: state.sentinels.size,
        handApplications: state.handApplications,
        handBaseRefreshes: state.handBaseRefreshes,
        handBaseReuses: state.handBaseReuses,
        smileApplications: state.smileApplications,
        smileRestores: state.smileRestores,
        smileErrors: state.smileErrors,
        smilingNpcIds: [...state.smile.values()].filter(record => record.applied).map(record => record.id),
      };
    },
  });
})(window);
