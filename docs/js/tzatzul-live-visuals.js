// Game-owned Tzatzul flying rig presentation. The existing WildlifeSpawn
// update tick supplies lifecycle; there is no new RAF or scene-wide traversal.
(() => {
  'use strict';
  if (window.TzatzulLiveVisuals) return;
  const SCAN_PERIOD_S = 1.4; // Finds dev-spawned birds without checking every creature on every rendered frame.
  const RETRY_DELAY_MS = 10000; // An absent sprite or GLB cannot initiate a failing fetch every frame.
  const tracked = new Map(); // Live adults only; stale area and removed Set members are disposed on the next reconciliation.
  const captivePoses = new WeakMap(); // Original rotation and size before matrix-decomposed talon carrying.
  const releasedPoseChecks = new Map(); // Two native ticks to stop a late talon renderer leaving prey permanently sideways.
  let deps = null; // WildlifeSpawn's live hostile collection and optional camera dependency.
  let scanT = 0; // Timer for bounded active-area scans rather than per-frame global searches.
  let area = null; // Last map id, used to immediately clear attachments across scene transitions.
  let seconds = 0; // Shared wing flap clock; prevents one Date.now call per bird.
  const debug = { scans: 0, mounts: 0, unmounts: 0, loadFailures: 0, lastError: null,
    lastBird: null, lastPose: null, captiveRestores: 0, tintRestores: 0, refreshedPlanes: 0 }; // Plain serializable diagnostics for mobile.
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const kind = actor => actor?.creatureKey || actor?.def?.id || actor?.def?.key;
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
  function rememberCaptive(prey, group = prey?.avatarRef?.group) {
    if (!prey || !group?.quaternion?.clone) return false;
    if (captivePoses.get(prey)?.group === group) return true;
    releasedPoseChecks.delete(prey); // The new capture supersedes any previous drop correction.
    captivePoses.set(prey, { group, quaternion: group.quaternion.clone(),
      scale: group.scale?.clone?.() || null }); // Restore the actual live avatar's original size and orientation.
    return true;
  }
  function restoreCaptive(prey) {
    const pose = prey && captivePoses.get(prey);
    if (!pose) return false;
    captivePoses.delete(prey); // Never reuse a previous capture's rotation on the next abduction.
    if (prey.avatarRef?.group !== pose.group || !pose.group?.quaternion?.copy) return false;
    pose.group.quaternion.copy(pose.quaternion); // Native locomotion resolves position; never teleport back to the pickup.
    if (pose.scale) pose.group.scale?.copy?.(pose.scale); // Matrix decomposition must not leave an altered scale behind.
    releasedPoseChecks.set(prey, { ...pose, remaining: 2 }); // Clear the old pose after the release frame and next native render.
    debug.captiveRestores++;
    return true;
  }
  function release(actor, reason = 'removed') {
    const state = tracked.get(actor);
    if (!state) return false;
    tracked.delete(actor);
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
  function present(actor, state, camera) {
    if (!state.rig) return;
    const flightPose = actor.isRuinSkeeri ? actor.skeeriFlightPose : kind(actor)==='pingdort' ? actor.pingdortFlightPose : actor.tzatzulFlightPose; // All three flyers use the shared authored wing assembly.
    const hatchling = kind(actor) === window.TzatzulRegistration?.HATCHLING_KIND; // Perched artwork with no adult seated deformation.
    const pose = hatchling ? 'hatchling' : flightPose === 'perched' || flightPose === 'glide'
      || flightPose === 'flap' ? flightPose
      : actor.onBranch ? 'perched'
        : actor._animalAttack || ['chase','patrol-chase','fleeing-low-health'].includes(actor.state) ? 'flap' : 'perched';
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
        if (!(Number(actor.hitFlashT) > 0) && state.rig.restoreTint?.(kind(actor)==='pingdort' ? actor.genotype?.base?.color : undefined)) debug.tintRestores++; // Repair native hit-flash tint and reflect any live Pingdort genotype edits.
        state.rig.root.rotation.z = pose !== 'perched' && !hatchling ? Number(actor.isRuinSkeeri ? actor.skeeriDivePitchRad : kind(actor)==='pingdort' ? actor.pingdortDivePitchRad : actor.tzatzulDivePitchRad) || 0 : 0; // Shared headfirst swoop pitch.
        if (hatchling && state.rig.root.position) {
          const moved = state.previousHatchlingPosition && Math.hypot(actor.x - state.previousHatchlingPosition.x, actor.y - state.previousHatchlingPosition.y) > .08;
          state.hopPhase = moved ? (state.hopPhase || 0) + Math.min(.1, state.renderDt || 0) * 21 : 0; // Native foot pathing moves, while only the visual body hops.
          state.rig.root.position.y = moved ? Math.max(0, Math.sin(state.hopPhase)) * .13 : 0;
          state.previousHatchlingPosition = { x: actor.x, y: actor.y };
        }
      } catch (error) { debug.lastError = String(error); }
    }
    state.lastPose = pose;
    debug.lastPose = pose;
  }
  function mount(actor, state) {
    if (state.loading || state.rig || now() < state.retryAt) return;
    const group = actor.avatarRef?.group;
    if (!group?.add || !group.parent || actor._wildlifeVisualsReleased) return;
    state.loading = true;
    const create = actor.isRuinSkeeri ? window.SkeeriRuins?.createRig : kind(actor)==='pingdort' ? window.PingdortRegistration?.createRig : window.TzatzulRegistration?.createRig; // The configured species supplies its own three sprite PNGs.
    if (!create) { state.loading = false; return; }
    const appearance = actor.isRuinSkeeri ? actor
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
      group.add(rig.root);
      group.userData ||= {};
      group.userData[actor.isRuinSkeeri ? 'skeeriFlyingRig' : kind(actor)==='pingdort' ? 'pingdortFlyingRig' : 'tzatzulFlyingRig'] = true; // One native avatar owns the corresponding rig.
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
    for (const [prey, reset] of releasedPoseChecks) {
      if (prey.tzatzulCapturedBy || prey.avatarRef?.group !== reset.group || !(prey.health > 0)) {
        releasedPoseChecks.delete(prey); continue;
      }
      reset.group.quaternion?.copy?.(reset.quaternion);
      if (reset.scale) reset.group.scale?.copy?.(reset.scale);
      if (--reset.remaining <= 0) releasedPoseChecks.delete(prey);
    } // Ordinary movement regains control after two frames; no persistent pose lock.
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
        const isSkeeri = actor.isRuinSkeeri === true && Object.values(window.SkeeriRuins?.SPECIES || {}).some(spec => spec.key === kind(actor)); // Only the ruin encounter owns Skeeri rigs; generic creatures cannot impersonate them.
        const isPingdort = kind(actor)==='pingdort' && (actor.isWildPingdort || actor.isCompanion); // Wild flocks and active trained companions get wings, not farm pen renderers.
        if (!isSkeeri && !isPingdort && ![window.TzatzulRegistration?.KIND, window.TzatzulRegistration?.HATCHLING_KIND].includes(kind(actor)) || actor.areaId !== area || !(actor.health > 0)) continue;
        if (tracked.has(actor)) continue;
        if (!isSkeeri && !isPingdort) actor.tzatzulIdentity ||= window.TzatzulRegistration.identityFor(area, stableIndex(actor)); // Tzatzul retain their nest identity; Pingdort genotype tints are supplied on rig mount.
        tracked.set(actor, { rig: null, loading: false, removed: false, originals: [],
          group: null, retryAt: 0, lastPose: null });
      }
    }
    const camera = deps.getActiveCamera?.() || window.Combat?.deps?.getActiveCamera?.()
      || deps.camera || null; // Real combat camera; no new renderer or global camera mutation.
    for (const [actor, state] of tracked) {
      if (actor.health <= 0 || actor.areaId !== area || (!deps.hostileObjects.has(actor) && !deps.companionObjects?.has?.(actor))) {
        release(actor, 'died, despawned or left area');
        continue;
      }
      if (state.group && (actor.avatarRef?.group !== state.group || actor._wildlifeVisualsReleased || !state.group.parent)) {
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
  function alignCaptive(prey, group = prey?.avatarRef?.group) {
    if (!prey?.tzatzulCapturedBy || !group?.parent || !window.THREE?.Object3D) return false;
    let state = null; // Only registered bird rigs can own the exact original captive actor.
    for (const [actor, candidate] of tracked) if (actor._tzFlight?.captive === prey) { state = candidate; break; }
    const rig = state?.rig;
    if (!rig?.talonCarry || !rig.root?.parent) return false;
    const THREE = window.THREE, animal = prey !== deps.player && !prey.isBandit; // The live actor, including clothing and genotype, is the payload.
    state.payload ||= { frame: new THREE.Object3D(), object: new THREE.Object3D(),
      worldScale: new THREE.Vector3(), scale: new THREE.Vector3(), inverse: new THREE.Matrix4(), matrix: new THREE.Matrix4() };
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
    payload.scale.copy(group.scale); // Keep the prey's actual dimensions; the bird's scale must never resize its captive.
    group.parent.updateWorldMatrix(true, false);
    payload.inverse.copy(group.parent.matrixWorld).invert();
    payload.matrix.multiplyMatrices(payload.inverse, payload.object.matrixWorld);
    rememberCaptive(prey, group); // A visual streamed in after capture must still save the upright baseline before tilting.
    payload.matrix.decompose(group.position, group.quaternion, group.scale);
    group.scale.copy(payload.scale);
    group.updateWorldMatrix(false, true);
    return true;
  }
  function snapshot() {
    return { ...debug, activeArea: area, tracked: tracked.size,
      liveRigs: [...tracked.values()].filter(state => !!state.rig).length,
      loading: [...tracked.values()].filter(state => state.loading).length };
  }
  window.TzatzulLiveVisuals = Object.freeze({ init, tick, snapshot, release, alignCaptive, rememberCaptive, restoreCaptive });
})();
