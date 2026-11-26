// Game-owned Tzatzul flying rig presentation. The existing WildlifeSpawn
// update tick supplies lifecycle; there is no new RAF or scene-wide traversal.
(() => {
  'use strict';
  if (window.TzatzulLiveVisuals) return;
  const SCAN_PERIOD_S = 1.4; // Finds dev-spawned birds without checking every creature on every rendered frame.
  const RETRY_DELAY_MS = 10000; // An absent sprite or GLB cannot initiate a failing fetch every frame.
  const tracked = new Map(); // Live adults only; stale area and removed Set members are disposed on the next reconciliation.
  const CARRY_POSE_OWNER = 'tzatzul-carry'; // Shared name in render and mobile pose diagnostics.
  const carryUndo = []; // The wildlife render hook reuses its rollback stack each world frame.
  let deps = null; // WildlifeSpawn's live hostile collection and optional camera dependency.
  let scanT = 0; // Timer for bounded active-area scans rather than per-frame global searches.
  let area = null; // Last map id, used to immediately clear attachments across scene transitions.
  let seconds = 0; // Shared wing flap clock; prevents one Date.now call per bird.
  const debug = { scans: 0, mounts: 0, unmounts: 0, loadFailures: 0, lastError: null,
    lastBird: null, lastPose: null, tintRestores: 0, refreshedPlanes: 0,
    captivePoseFrames: 0, captivePoseUnavailable: 0, captivePoseConflicts: 0,
    lastCaptivePose: null }; // Available in the mobile Wildlife panel.
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const kind = actor => actor?.creatureKey || actor?.def?.id || actor?.def?.key;
  const isSkeeriActor = actor => actor?.isRuinSkeeri === true || (kind(actor) === 'skeeri' && actor?.isCompanion === true); // Shared native wing rig for authored ruin enemies and trained Skeeri.
  function stableIndex(actor) {
    const seed = String(actor.tzatzulNestId || actor.nestTreeKey || actor.id
      || [actor.homeX ?? actor.x, actor.homeY ?? actor.y].map(n => Math.round(Number(n) || 0)).join(':'));
    let hash = 2166136261; // Deterministic individual color fallback for dev/test spawns.
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
    return hash % 16384;
  }
  function clearOriginal(state) {
    for (const record of state.originals) {
      if (record.node?.parent === state.group) record.node.visible = record.visible;
    } // Never restore visibility on disposed or reparented creature planes.
    state.originals.length = 0;
  }
  function release(actor, reason = 'removed') {
    const state = tracked.get(actor);
    if (!state) return false;
    tracked.delete(actor);
    window.AudioSystem?.stopWingflapSfx?.(actor); // Despawn ends an active flap without affecting other birds in the audio pool.
    state.removed = true; // In-flight async rig loads discard their result rather than attaching to a corpse.
    clearOriginal(state);
    if (state.rig) {
      try { state.rig.dispose(); } catch (error) { debug.lastError = String(error); }
      state.rig = null;
      debug.unmounts++;
    }
    if (state.group?.userData) { delete state.group.userData.tzatzulFlyingRig; delete state.group.userData.skeeriFlyingRig; delete state.group.userData.pingdortFlyingRig; }
    debug.lastBird = String(actor?.id || kind(actor) || 'tzatzul') + ':' + reason;
    return true;
  }
  function portraitPlanes(actor, group) {
    const ref = actor.avatarRef || {};
    const candidates = [ref.frontPlane, ref.backPlane, ...(group.children || [])];
    return [...new Set(candidates)].filter(node => node?.parent === group && node?.isMesh
      && (node.userData?.hobunjiPlaneFace === 'front' || node.userData?.hobunjiPlaneFace === 'back'
        || /_(front|back)_plane$/.test(node.name || '') || node === ref.frontPlane || node === ref.backPlane));
  }
  function nativeGroundPlaneY(actor, state) {
    const authoredPlaneY = actor.avatarRef?.frontPlane?.position?.y
      ?? state.originals?.[0]?.node?.position?.y; // Reuse the opaque-bottom correction already applied to the native idle/perched sprite.
    return Number.isFinite(Number(authoredPlaneY)) ? Number(authoredPlaneY) : 0; // An unscanned or absent plane has the original neutral local offset.
  }
  function cueWingbeat(actor, state, pose) {
    if (pose !== 'flap' || state.rig.root.visible === false || actor.tzatzulInNest || actor.prone || !(actor.health > 0)) {
      if (state.wingflapActive) window.AudioSystem?.stopWingflapSfx?.(actor); // A lingering MP3 tail must not sound during a glide, perch or knockdown.
      state.wingflapActive = false;
      state.nextWingbeatAt = 0; // Re-entering a flap pose starts a fresh beat immediately.
      return;
    }
    state.wingflapActive = true; // Only the currently animated flapping phase is allowed to produce flight footsteps.
    if (state.lastPose === 'flap' && seconds < state.nextWingbeatAt) return;
    const hz = Number(state.rig.flapHz); // Reads the same authored frequency used by FlyingAnimalRig.flapAngle, not an invented audio-only timer.
    state.nextWingbeatAt = seconds + 1 / (Number.isFinite(hz) && hz > 0 ? hz : 2.2);
    window.AudioSystem?.playWingflapSfx?.(actor); // One beat per flapping cycle, shared by Tzatzul, Pingdort and Skeeri.
  }

  // Shared owned-bird locomotion. Existing navigation still decides safe horizontal movement;
  // the caller supplies clearance at the actual previous/current footprint.
  function updateCompanionLocomotion(actor, dt, movedPx, flightClear, interrupted = false) {
    if (!actor?.def?.isFlyingSpecies || actor.stableRole !== 'companion') return;
    const state = actor._companionBirdMotion || (actor._companionBirdMotion = { mode: 'perched', lift: 0, phase: 0 }); // Read by native and articulated renderers and Pixel Probe.
    const step = Math.max(0, Math.min(.1, Number(dt) || 0)); // No giant hop or flap after tab resume.
    const moving = Number(movedPx) > .08;
    if (interrupted) {
      state.mode = 'perched'; state.lift = 0; state.phase = 0;
    } else if (moving && flightClear) {
      state.mode = 'flight'; state.phase = 0;
      state.lift = Math.min(.65, state.lift + step * 2.8);
    } else if (moving) {
      state.mode = 'hop';
      state.phase += step * 21;
      state.lift = Math.abs(Math.sin(state.phase)) * .13;
    } else {
      state.lift = flightClear ? Math.max(0, state.lift - step * 3.6) : 0;
      state.mode = state.lift > 0 && state.mode === 'flight' ? 'flight' : 'perched';
      state.phase = 0;
    }
    return state;
  }

  function present(actor, state, camera) {
    if (!state.rig) return;
    const flightPose = isSkeeriActor(actor) ? actor.skeeriFlightPose : kind(actor)==='pingdort' ? actor.pingdortFlightPose : actor.tzatzulFlightPose; // All three flyers use the shared authored wing assembly.
    const hatchling = kind(actor) === window.TzatzulRegistration?.HATCHLING_KIND; // Perched artwork with no adult seated deformation.
    const ownedBird = actor.isCompanion && actor.def?.isFlyingSpecies; // Only tame flyers opt out of the curled wild perch.
    const ownedPose = actor._companionBirdMotion?.mode === 'flight' ? 'flap' : 'perched'; // Hops use folded wings and the native ground pose.
    const pose = hatchling ? 'hatchling' : ownedBird && !actor._animalAttack && !actor._companionBiteTarget && !actor.tzatzulCapturedBy ? ownedPose : flightPose === 'perched' || flightPose === 'glide'
      || flightPose === 'flap' ? flightPose
      : actor.onBranch ? 'perched'
        : actor._animalAttack || ['chase','patrol-chase','fleeing-low-health'].includes(actor.state) ? 'flap' : 'perched';
    // A head-rigged bird can look around on its undeformed native perch. Keep that
    // rig visible instead of replacing it with the articulated body's flat card.
    if (ownedBird && pose === 'perched' && actor.avatarRef?.headRig) {
      clearOriginal(state);
      state.rig.root.visible = false;
      cueWingbeat(actor, state, 'perched');
      state.lastPose = 'perched'; debug.lastPose = 'perched';
      return;
    }
    // Ordinary avatar code can re-enable its canonical sprite after a genotype
    // animation or visual promotion. Keep it hidden only while our rig exists.
    const known = new Set(state.originals.map(record => record.node)); // Damage/genotype refresh can replace a native plane without replacing the whole avatar group.
    for (const node of portraitPlanes(actor, state.group)) {
      if (!known.has(node)) {
        state.originals.push({ node, visible: node.visible });
        debug.refreshedPlanes++;
      }
      node.visible = false; // Never let an untinted native replacement draw on top of this bird's individually colored rig.
    }
    if (state.rig.root?.parent === state.group) {
      state.rig.root.visible = !actor.tzatzulInNest; // Parents inside their cave are absent from the exterior renderer.
      // On a few zone-load paths a creature mounts before an active Camera is
      // injected. Always choose one authored pose, or flying/perched/wing
      // sprites all overlap until the next camera transition.
      const fallback = {
        getWorldPosition(vector) {
          const unit = Math.max(1, Number(deps?.TILE) || 64);
          const perspective = deps?.player || actor;
          return vector.set((Number(perspective.x) || 0) / unit,
            (Number(actor.branchSurfaceY) || 0) + 3,
            (Number(perspective.y) || 0) / unit + 2);
        },
      }; // Cheap game-space viewpoint; no additional scene camera or RAF.
      try {
        state.rig.update(camera?.getWorldPosition ? camera : fallback,
          pose, seconds, !!actor.tzatzulCarrying, window.CreatureBlink?.isShut?.(actor) === true);
        cueWingbeat(actor, state, pose); // SFX stays in lockstep with the actually rendered wing pose.
        if (!(Number(actor.hitFlashT) > 0) && state.rig.restoreTint?.(kind(actor)==='pingdort' ? actor.genotype?.base?.color : undefined)) debug.tintRestores++; // Repair native hit-flash tint and reflect any live Pingdort genotype edits.
        state.rig.root.rotation.z = pose !== 'perched' && !hatchling ? Number(isSkeeriActor(actor) ? actor.skeeriDivePitchRad : kind(actor)==='pingdort' ? actor.pingdortDivePitchRad : actor.tzatzulDivePitchRad) || 0 : 0; // Shared headfirst swoop pitch.
        if (state.rig.root.position) {
          let hopY = 0; // Only mobile hatchlings add hop height above the same native foot anchor used by every perched bird.
          if (hatchling) {
            const moved = state.previousHatchlingPosition && Math.hypot(actor.x - state.previousHatchlingPosition.x, actor.y - state.previousHatchlingPosition.y) > .08;
            state.hopPhase = moved ? (state.hopPhase || 0) + Math.min(.1, state.renderDt || 0) * 21 : 0; // Native foot pathing moves, while only the visual body hops.
            hopY = moved ? Math.max(0, Math.sin(state.hopPhase)) * .13 : 0;
            state.previousHatchlingPosition = { x: actor.x, y: actor.y };
          }
          state.rig.root.position.y = nativeGroundPlaneY(actor, state) + hopY; // Never let the flying-rig swap discard authored ground-Y/opaque-padding placement.
        }
      } catch (error) {
        debug.lastError = String(error);
        cueWingbeat(actor, state, 'perched'); // A failed rig frame cannot leave an earlier flap audible.
      }
    } else cueWingbeat(actor, state, 'perched'); // Detached or hidden rig art has no visible flap and must be silent.
    state.lastPose = pose;
    debug.lastPose = pose;
  }
  function mount(actor, state) {
    if (state.loading || state.rig || now() < state.retryAt) return;
    const group = actor.avatarRef?.group;
    if (!group?.add || !group.parent || actor._wildlifeVisualsReleased) return;
    state.loading = true;
    const create = isSkeeriActor(actor) ? window.SkeeriRuins?.createRig : kind(actor)==='pingdort' ? window.PingdortRegistration?.createRig : window.TzatzulRegistration?.createRig; // The configured species supplies its own three sprite PNGs.
    if (!create) { state.loading = false; return; }
    const appearance = isSkeeriActor(actor) ? (actor.isRuinSkeeri ? actor : {
      skeeriPalette: window.SkeeriLivestockRegistration?.paletteForGenotype?.(
        actor.genotype ||= window.CreatureGenetics?.makeDefaultGenotype?.('skeeri'), actor.id),
    })
      : kind(actor) === 'pingdort'
        ? (actor.genotype ||= window.CreatureGenetics?.makeDefaultGenotype?.('pingdort'))
        : actor.tzatzulIdentity; // Preserve each species' authored palette source and individual identity.
    Promise.resolve().then(() => kind(actor) === window.TzatzulRegistration?.HATCHLING_KIND
      ? create(appearance, { undeformedPerch: true }) : create(appearance)).then(rig => { // Only Tzatzul hatchlings receive an override; Pingdort and Skeeri retain their existing genotype/rig contract.
      if (!rig?.root || !rig?.dispose) throw new Error('Flying rig renderer did not return a disposable root');
      if (state.removed || tracked.get(actor) !== state || actor.health <= 0
        || actor.avatarRef?.group !== group || !group.parent || actor._wildlifeVisualsReleased) {
        rig.dispose(); // Prevent leaked geometry and detached late-loading meshes.
        return;
      }
      state.group = group; // Pose and visual cleanup use the exact native avatar owner.
      state.rig = rig;
      if (actor.isCompanion && actor.def?.isFlyingSpecies) rig.setPerchSpline?.(null); // Flatten every owned flying species, preserving its authored palette and wing assembly.
      state.originals = portraitPlanes(actor, group).map(node => ({ node, visible: node.visible }));
      for (const record of state.originals) record.node.visible = false;
      const height = Number(actor.avatarRef?.frontPlane?.geometry?.parameters?.height)
        || Number(state.originals[0]?.node?.geometry?.parameters?.height)
        || Number(actor.def?.modelWidth) || 1; // Match the authoritative native portrait height, including large birds.
      if (rig.root.scale?.setScalar) {
        rig.root.scale.setScalar(height);
        if (kind(actor) === window.TzatzulRegistration?.HATCHLING_KIND) {
          const ratios = window.TzatzulRegistration.HATCHLING_SCALE; // Height comes from the native plane; correct only the width for the deformed hatchling body.
          rig.root.scale.x *= ratios.x / ratios.y;
        }
      }
      rig.root.rotation.y = Math.PI / 2; // Flying side sprite inherits the same orientation as the native animal front plane.
      if (rig.root.position) rig.root.position.y = nativeGroundPlaneY(actor, state); // Production Three.Group always has position; tolerate lightweight corpse/rig test stubs.
      group.add(rig.root);
      group.userData ||= {};
      group.userData[isSkeeriActor(actor) ? 'skeeriFlyingRig' : kind(actor)==='pingdort' ? 'pingdortFlyingRig' : 'tzatzulFlyingRig'] = true; // One native avatar owns the corresponding rig.
      debug.mounts++;
      debug.lastBird = String(actor.id || 'tzatzul') + ':mounted';
    }).catch(error => {
      state.retryAt = now() + RETRY_DELAY_MS;
      debug.loadFailures++;
      debug.lastError = String(error?.message || error);
      window.__farmLog?.('[tzatzul] flying rig unavailable: ' + debug.lastError, 'warn', 'wildlife');
    }).finally(() => { state.loading = false; });
  }
  function init(injected = {}) {
    deps = injected; // Uses the same lifetime as WildlifeSpawn, not a private global creature roster.
    for (const actor of [...tracked.keys()]) release(actor, 'reinitialized');
    area = null;
    scanT = 0;
  }
  function tick(dt, activeArea = deps?.getCurrentArea?.()) {
    if (!deps?.hostileObjects || !activeArea) return 0;
    const step = Math.max(0, Math.min(.25, Number(dt) || 0));
    seconds += step;
    if (area !== activeArea) {
      for (const actor of [...tracked.keys()]) release(actor, 'area transition');
      area = activeArea; scanT = 0;
    }
    scanT -= step;
    if (scanT <= 0) {
      scanT = SCAN_PERIOD_S;
      debug.scans++;
      for (const actor of new Set([...deps.hostileObjects,...(deps.companionObjects||[])])) { // Include player-owned Pingdort companions in the same scan, never a second renderer.
        const isSkeeri = isSkeeriActor(actor) && (kind(actor) === 'skeeri' || Object.values(window.SkeeriRuins?.SPECIES || {}).some(spec => spec.key === kind(actor))); // Stable Skeeri can fly without allowing arbitrary hostile lookalikes to acquire ruin rigs.
        const isPingdort = kind(actor)==='pingdort' && (actor.isWildPingdort || actor.isCompanion); // Wild flocks and active trained companions get wings, not farm pen renderers.
        if (!isSkeeri && !isPingdort && ![window.TzatzulRegistration?.KIND, window.TzatzulRegistration?.HATCHLING_KIND].includes(kind(actor)) || actor.areaId !== area || !(actor.health > 0)) continue;
        if (actor.stableRole === 'shoulderPet') continue; // Native undeformed idle and head rig own the shoulder grip, not the alternate flying card.
        if (tracked.has(actor)) continue;
        if (!isSkeeri && !isPingdort) actor.tzatzulIdentity ||= window.TzatzulRegistration.identityFor(area, stableIndex(actor)); // Tzatzul retain their nest identity; Pingdort genotype tints are supplied on rig mount.
        tracked.set(actor, { rig: null, loading: false, removed: false, originals: [],
          group: null, retryAt: 0, lastPose: null, nextWingbeatAt: 0, wingflapActive: false }); // Actor-local beat gate and active sound ownership require no new loop.
      }
    }
    const camera = deps.getActiveCamera?.() || window.Combat?.deps?.getActiveCamera?.()
      || deps.camera || null; // Real combat camera; no new renderer or global camera mutation.
    for (const [actor, state] of tracked) {
      const lootableSkeeriCorpse = actor.isRuinSkeeri === true && !(actor.health > 0)
        && (actor.state === 'dying' || actor.state === 'corpse') && actor.areaId === area
        && state.rig && state.group?.parent && actor.avatarRef?.group === state.group
        && !actor._wildlifeVisualsReleased
        && window.CreatureDeath?.getCorpseObjects?.()?.has?.(actor) === true; // This rare ruin corpse still owns the visible palette and must be lootable.
      if (lootableSkeeriCorpse) {
        actor.skeeriFlightPose = 'perched'; // Death uses the folded pose; the corpse owner rotates the whole group onto the ground.
        actor.skeeriDivePitchRad = 0;
        present(actor, state, camera); // Keep the authored dye and camera-facing card; no new rig is created for dead actors.
        continue;
      }
      if (actor.stableRole === 'shoulderPet' || actor.health <= 0 || actor.areaId !== area || (!deps.hostileObjects.has(actor) && !deps.companionObjects?.has?.(actor))) {
        release(actor, 'died, despawned or left area');
        continue;
      }
      if (state.group && (actor.avatarRef?.group !== state.group || actor._wildlifeVisualsReleased || !state.group.parent)) {
        if (state.wingflapActive) window.AudioSystem?.stopWingflapSfx?.(actor); // Visual unmount cannot leave an orphaned audible flap.
        state.wingflapActive = false; state.nextWingbeatAt = 0; state.lastPose = null;
        if (state.rig) {
          clearOriginal(state);
          state.rig.dispose(); state.rig = null; debug.unmounts++;
        }
        state.group = null;
      }
      state.renderDt = step; // Existing wildlife renderer cadence drives hatchling hops.
      if (!state.rig) mount(actor, state);
      else present(actor, state, camera);
    }
    return tracked.size;
  }
  function belongsToScene(node, scene) {
    for (let parent = node; parent; parent = parent.parent) if (parent === scene) return true;
    return false;
  }

  function resolveCarryPlacement(prey, bird, group, scene) {
    if (!prey?.tzatzulCapturedBy || bird?._tzFlight?.captive !== prey || !(prey.health > 0)
      || !group?.parent || group.visible === false || !belongsToScene(group, scene)) return null;
    const state = tracked.get(bird); // Flight owns the capture record; this map only supplies the carrier's live art.
    const rig = state?.rig;
    if (!rig?.talonCarry || !rig.root?.parent || rig.root.parent !== bird.avatarRef?.group
      || rig.root.visible === false || !belongsToScene(rig.root, scene)) {
      debug.captivePoseUnavailable++;
      debug.lastCaptivePose = 'waiting for carrier rig';
      return null;
    }
    const THREE = window.THREE, animal = prey !== deps.player && !prey.isBandit; // The live actor, including clothing and genotype, is the payload.
    state.payload ||= { frame: new THREE.Object3D(), object: new THREE.Object3D(),
      worldScale: new THREE.Vector3(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      decomposedScale: new THREE.Vector3(), inverse: new THREE.Matrix4(), matrix: new THREE.Matrix4() };
    const payload = state.payload; // Scratch transforms are allocated once per bird, rather than per animation frame.
    if (payload.frame.parent !== rig.root) { rig.root.add(payload.frame); payload.frame.add(payload.object); }
    rig.root.getWorldScale(payload.worldScale);
    let source = deps.getTzatzulCarryAnchor?.(prey); // Player and animal anchors come from the live game's canonical resolver.
    if (!source && prey.isBandit) {
      const appearance = prey.rosterRecord?.appearance || prey.avatarRef?.profile || {};
      const profile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[appearance.speciesId + '::' + appearance.gender];
      const posterior = profile?.anchors?.posterior;
      const height = Number(prey.avatarRef?.modelHeight) || 1; // Same profile-derived portrait dimensions as the Furniture Editor's humanoid hold preview.
      source = { ...(posterior?.position || {}), y: window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(profile?.posteriorRule, height, prey.avatarRef?.group?.userData?.handAttachY) || 0, rotationDeg:posterior?.rotationDeg };
    }
    source ||= { x:0, y:0, z:0 };
    const anchor = { position: animal ? { x:-(source.z || 0), y:source.y || 0, z:source.x || 0 } : source,
      rotation: source.rotationDeg };
    window.FlyingAnimalRig.placeTalonPayload(payload.frame, payload.object,
      { ...rig.talonCarry, birdScale: Math.max(.01, Math.abs(payload.worldScale.x)) },
      animal ? 'animal' : 'humanoid', anchor);
    if (animal) payload.object.rotateY(-Math.PI / 2); // Same X-normal to Z-normal adapter as the authored animal preview.
    payload.frame.updateWorldMatrix(true, true);
    group.parent.updateWorldMatrix(true, false);
    payload.inverse.copy(group.parent.matrixWorld).invert();
    payload.matrix.multiplyMatrices(payload.inverse, payload.object.matrixWorld);
    // Decompose into scratch, away from the live rig. Its size remains owned by native animation.
    payload.matrix.decompose(payload.position, payload.quaternion, payload.decomposedScale);
    payload.quaternion.normalize();
    return payload;
  }

  function applyCarryPlacement(prey, group, placement, undo) {
    const applied = window.ActorRigCompositor.applyRenderPose(
      group, CARRY_POSE_OWNER, placement.position, placement.quaternion, undo);
    if (applied) debug.captivePoseFrames++;
    else debug.captivePoseConflicts++;
    debug.lastCaptivePose = applied ? (prey === deps.player ? 'player placed' : 'creature placed') : 'root already owned';
    return applied;
  }

  // The player body composer owns this transaction so its other whole-body
  // effects and scene-sibling attachments share the same render and rollback.
  function getPlayerCarryPlacement(group, scene) {
    const prey = deps?.player; // Use the registered gameplay player and the composer's actual root.
    if (!prey?.tzatzulCapturedBy) return null;
    const bird = window.TzatzulFlightRuntime?.carrierOf(prey); // Direct lookup, including consecutive grabs by different birds.
    return resolveCarryPlacement(prey, bird, group, scene);
  }

  function restoreWildlifeCarry() {
    while (carryUndo.length) {
      try { carryUndo.pop()(); }
      catch (error) { debug.lastError = String(error); }
    }
  }

  window.RenderHooks?.register({
    id: 'tzatzul-wildlife-carry',
    owner: 'tzatzul-live-visuals.js',
    order: window.RenderHooks.ORDER.ACTOR_RENDER_PLACEMENT,
    scope: 'frame',
    appliesTo: ctx => ctx.worldScene && !carryUndo.length && !!window.TzatzulFlightRuntime?.hasCaptives(),
    before(ctx) {
      try {
        window.TzatzulFlightRuntime.forEachCaptive((prey, bird) => {
          if (prey === deps?.player) return;
          const group = prey.avatarRef?.group; // Resolve the present rig, including a streamed-in replacement.
          const placement = resolveCarryPlacement(prey, bird, group, ctx.scene); // Reused per-carrier scratch.
          if (placement) applyCarryPlacement(prey, group, placement, carryUndo);
        });
      } catch (error) {
        restoreWildlifeCarry();
        throw error;
      }
    },
    after: restoreWildlifeCarry,
  });

  function snapshot() {
    return { ...debug, activeArea: area, tracked: tracked.size,
      liveRigs: [...tracked.values()].filter(state => !!state.rig).length,
      loading: [...tracked.values()].filter(state => state.loading).length };
  }
  window.TzatzulLiveVisuals = Object.freeze({ init, tick, snapshot, release, updateCompanionLocomotion, getPlayerCarryPlacement,
    applyPlayerCarryPlacement: (group, placement, undo) => applyCarryPlacement(deps.player, group, placement, undo) });
})();
