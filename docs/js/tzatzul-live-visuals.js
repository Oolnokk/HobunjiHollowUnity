// Game-owned Tzatzul flying rig presentation. The existing WildlifeSpawn
// update tick supplies lifecycle; there is no new RAF or scene-wide traversal.
(() => {
  'use strict';
  if (window.TzatzulLiveVisuals) return;
  const SCAN_PERIOD_S = 1.4; // Finds dev-spawned birds without checking every creature on every rendered frame.
  const RETRY_DELAY_MS = 10000; // An absent sprite or GLB cannot initiate a failing fetch every frame.
  const tracked = new Map(); // Live adults only; stale area and removed Set members are disposed on the next reconciliation.
  const captivePoses = new WeakMap(); // Original rotation and size of the actual aligned actor root, not a potentially different portrait child.
  const releasedPoseChecks = new Map(); // Short ownership-checked guard against a late talon write; never reassert over a new native pose.
  let deps = null; // WildlifeSpawn's live hostile collection and optional camera dependency.
  let scanT = 0; // Timer for bounded active-area scans rather than per-frame global searches.
  let area = null; // Last map id, used to immediately clear attachments across scene transitions.
  let seconds = 0; // Shared wing flap clock; prevents one Date.now call per bird.
  const debug = { scans: 0, mounts: 0, unmounts: 0, loadFailures: 0, lastError: null,
    lastBird: null, lastPose: null, captiveRestores: 0, captiveRestoreMisses: 0,
    lastCaptiveRestore: null, captiveHandoffs: 0, staleCarryCorrections: 0,
    tintRestores: 0, refreshedPlanes: 0, staleCarryScaleCorrections: 0,
    captivePositionRestores: 0, captivePositionHandoffs: 0, staleCarryPositionCorrections: 0 }; // Captive root translation is tracked separately from rotation/scale for mobile diagnostics.
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
  function playerRoot(prey) {
    if (!prey || prey !== deps?.player) return null;
    return window.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || window.Combat?.deps?.playerMesh
      || window.ProceduralHandAttachments?.gameDeps?.playerMesh
      || null; // The player is aligned through game.js's playerMesh, not the optional avatarRef portrait child.
  }
  function currentCaptiveGroup(prey) {
    return playerRoot(prey) || prey?.avatarRef?.group || null; // Both capture and release must use the root that alignCaptive actually changes.
  }
  function stillOwnsCaptiveGroup(prey, group) {
    if (prey === deps?.player) {
      const liveRoot = playerRoot(prey); // An appearance rebuild may replace the real player rig before a delayed release.
      return liveRoot ? liveRoot === group : !!group?.parent;
    }
    return prey?.avatarRef?.group === group; // NPC and creature visual promotion must not restore detached old portraits.
  }
  function sameVector(current, expected) {
    if (!expected) return true;
    return !!current && ['x', 'y', 'z'].every(axis => {
      if (current[axis] == null && expected[axis] == null) return true; // Sparse isolated tool/test vectors still compare their authored axes.
      return Number.isFinite(current[axis]) && Number.isFinite(expected[axis])
        && Math.abs(current[axis] - expected[axis]) <= 1e-7;
    });
  }

  function sameOrientation(current, expected) {
    if (!current || !expected) return false;
    if (typeof current.dot === 'function') {
      const dot = Math.abs(current.dot(expected)); // Quaternions q and -q represent the same orientation.
      return Number.isFinite(dot) && dot >= 1 - 1e-12;
    }
    return current.equals?.(expected) === true; // Preview/test quaternions may expose equality without a dot product.
  }
  function rememberCaptive(prey, group = currentCaptiveGroup(prey)) {
    if (!prey || !group?.quaternion?.clone) return false;
    const previous = captivePoses.get(prey); // A rebuilt avatar may change its aligned root while the same bird is still carrying it.
    if (previous?.group === group) return true;
    if (previous) {
      previous.poseSession?.release(); // Clear the outgoing rig's claims before tracking the replacement root.
      captivePoses.delete(prey);
    }
    releasedPoseChecks.delete(prey); // The new capture supersedes any previous drop correction.
    const poseSession = window.ActorRigCompositor?.createAbsoluteSession?.('tzatzul-captive') || null; // One scoped rotation/size owner, never a world-position owner.
    if (poseSession) {
      const fields = group.scale?.clone ? ['quaternion', 'scale'] : ['quaternion']; // Bare preview rigs can still supply only orientation.
      if (!poseSession.capture(group, fields)) {
        poseSession.release(); // A locked NPC/dance body must not be stolen by an approaching bird.
        debug.captiveHandoffs++;
        debug.lastCaptiveRestore = 'capture rejected: another absolute pose owns the rig';
        return false;
      }
    }
    captivePoses.set(prey, { group, parent: group.parent, quaternion: group.quaternion.clone(),
      scale: group.scale?.clone?.() || null, lastAlignedQuaternion: null, poseSession,
      lastNativePosition: null, lastAlignedPosition: null }); // Translation is a per-frame visual offset, not a claim on the actor's world travel.
    return true;
  }
  function restoreCaptive(prey) {
    const pose = prey && captivePoses.get(prey);
    if (!pose) {
      debug.lastCaptiveRestore = 'no saved pose';
      return false;
    }
    captivePoses.delete(prey); // Never reuse a previous capture's rotation on the next abduction.
    if (!stillOwnsCaptiveGroup(prey, pose.group) || !pose.group?.quaternion?.copy) {
      pose.poseSession?.release(); // Even a detached/replaced rig must release its original scoped claims.
      debug.captiveRestoreMisses++;
      debug.lastCaptiveRestore = (prey === deps?.player ? 'player' : 'creature') + ': visual root replaced';
      return false;
    }
    // Talon alignment also overwrites the live root's position. Restore only the last
    // clean simulation position when the root still contains OUR exact talon output.
    // Do not rewind world travel to the original pickup, or fight a new position owner.
    const positionOwned = !!pose.lastNativePosition && !!pose.lastAlignedPosition
      && pose.group.parent === pose.parent
      && sameVector(pose.group.position, pose.lastAlignedPosition)
      && !window.ActorRigCompositor?.absoluteOwner?.(pose.group, 'position');
    if (positionOwned) {
      pose.group.position.copy(pose.lastNativePosition);
      debug.captivePositionRestores++;
    } else if (pose.lastAlignedPosition) debug.captivePositionHandoffs++;
    const orientationOwned = sameOrientation(pose.group.quaternion, pose.lastAlignedQuaternion); // A fall/impact writer may already have replaced the talon orientation.
    const scaleOwned = sameVector(pose.group.scale, pose.scale); // A new scale owner must also defeat stale talon reset.
    const staleTalonScale = !scaleOwned && sameVector(pose.group.scale, pose.lastDecomposedScale); // A precisely recognized late replay of the bird's intermediate matrix scale is not a new native scale owner.
    if (orientationOwned && staleTalonScale && pose.scale) {
      pose.group.scale.copy(pose.scale); // Correct ONLY the known talon intermediate scale before shared owner validation.
      debug.staleCarryScaleCorrections++;
    }
    let owned = orientationOwned && (scaleOwned || staleTalonScale);
    if (pose.poseSession) {
      pose.poseSession.release(); // Restores only this talon owner's quaternion/scale; an externally displaced rig keeps its newer pose.
      owned = !!pose.lastAlignedQuaternion && pose.poseSession.wasRestored(pose.group, 'quaternion')
        && (!pose.scale || pose.poseSession.wasRestored(pose.group, 'scale'));
    }
    if (owned) {
      if (!pose.poseSession) {
        pose.group.quaternion.copy(pose.quaternion); // Compatibility for isolated tools without the shared compositor.
        if (pose.scale) pose.group.scale?.copy?.(pose.scale);
      }
      releasedPoseChecks.set(prey, { ...pose, poseSession: null, remaining: 2 }); // Guard only a verified late replay, not the new native pose.
    } else {
      releasedPoseChecks.delete(prey);
      debug.captiveHandoffs++;
    }
    debug.captiveRestores++;
    debug.lastCaptiveRestore = (prey === deps?.player ? 'player' : 'creature')
      + (owned ? ': restored root baseline' : ': newer pose retained');
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
    const flightPose = isSkeeriActor(actor) ? actor.skeeriFlightPose : kind(actor)==='pingdort' ? actor.pingdortFlightPose : actor.tzatzulFlightPose; // All three flyers use the shared authored wing assembly.
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
        state.rig.root.rotation.z = pose !== 'perched' && !hatchling ? Number(isSkeeriActor(actor) ? actor.skeeriDivePitchRad : kind(actor)==='pingdort' ? actor.pingdortDivePitchRad : actor.tzatzulDivePitchRad) || 0 : 0; // Shared headfirst swoop pitch.
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
    releasedPoseChecks.clear(); // A new scene/roster must never retain pending release writers from the old one.
  }
  function tick(dt, activeArea = deps?.getCurrentArea?.()) {
    if (!deps?.hostileObjects || !activeArea) return 0;
    const step = Math.max(0, Math.min(.25, Number(dt) || 0));
    for (const [prey, reset] of releasedPoseChecks) {
      if (prey.tzatzulCapturedBy || !stillOwnsCaptiveGroup(prey, reset.group) || !(prey.health > 0)) {
        releasedPoseChecks.delete(prey); continue;
      }
      // One delayed depth/render pass can replay just the portrait translation, with
      // no stale quaternion. Correct only an exact talon position on the original rig.
      if (reset.lastAlignedPosition && reset.lastNativePosition && reset.group.parent === reset.parent
        && !window.ActorRigCompositor?.absoluteOwner?.(reset.group, 'position')
        && sameVector(reset.group.position, reset.lastAlignedPosition)) {
        reset.group.position.copy(reset.lastNativePosition);
        debug.staleCarryPositionCorrections++;
      }
      const newOwner = window.ActorRigCompositor?.absoluteOwner?.(reset.group, 'quaternion')
        || window.ActorRigCompositor?.absoluteOwner?.(reset.group, 'scale'); // A resumed fall/locomotion action takes precedence over stale talon replay.
      if (newOwner || (!sameVector(reset.group.scale, reset.scale)
        && !sameVector(reset.group.scale, reset.lastDecomposedScale))) {
        releasedPoseChecks.delete(prey);
        debug.captiveHandoffs++;
        continue;
      }
      const current = reset.group.quaternion;
      if (sameOrientation(current, reset.lastAlignedQuaternion)) {
        current.copy(reset.quaternion); // An exact late talon pose is stale, not an independent combat/locomotion writer.
        if (reset.scale) reset.group.scale?.copy?.(reset.scale);
        debug.staleCarryCorrections++;
      } else if (!sameOrientation(current, reset.quaternion)) {
        releasedPoseChecks.delete(prey); // A distinct native pose has taken over: do not override it on this or later ticks.
        debug.captiveHandoffs++;
        continue;
      }
      if (--reset.remaining <= 0) releasedPoseChecks.delete(prey);
    } // The guard is bounded and conditional, not a two-frame absolute pose lock.
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
        if (tracked.has(actor)) continue;
        if (!isSkeeri && !isPingdort) actor.tzatzulIdentity ||= window.TzatzulRegistration.identityFor(area, stableIndex(actor)); // Tzatzul retain their nest identity; Pingdort genotype tints are supplied on rig mount.
        tracked.set(actor, { rig: null, loading: false, removed: false, originals: [],
          group: null, retryAt: 0, lastPose: null });
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
    if (!rememberCaptive(prey, group)) return false; // Do not override an action that already owns the captive's rig.
    const captiveBefore = captivePoses.get(prey); // The same live talon owner is refreshed at each flight-pose update.
    if (captiveBefore?.poseSession && !captiveBefore.poseSession.owns()) {
      debug.captiveHandoffs++;
      return false; // A newer combat/fall animator displaced the talon orientation mid-flight.
    }
    if (group.position?.clone && (!captiveBefore.lastAlignedPosition
      || !sameVector(group.position, captiveBefore.lastAlignedPosition))) {
      // Cache the *latest* native body root, not the pickup root. If a previous
      // talon frame is still there, retain the known clean position instead.
      if (captiveBefore.lastNativePosition) captiveBefore.lastNativePosition.copy(group.position);
      else captiveBefore.lastNativePosition = group.position.clone();
    }
    payload.matrix.decompose(group.position, group.quaternion, group.scale);
    const captivePose = captivePoses.get(prey); // Used by restoreCaptive to identify the exact orientation this talon pass last wrote.
    if (captivePose?.group === group) {
      if (group.position?.clone) {
        if (captivePose.lastAlignedPosition) captivePose.lastAlignedPosition.copy(group.position);
        else captivePose.lastAlignedPosition = group.position.clone(); // Exact talon translation used for ownership-aware release.
      }
      if (captivePose.lastAlignedQuaternion) captivePose.lastAlignedQuaternion.copy(group.quaternion);
      else captivePose.lastAlignedQuaternion = group.quaternion.clone(); // Allocate once per capture, not per animated flight frame.
      if (captivePose.lastDecomposedScale) captivePose.lastDecomposedScale.copy(group.scale);
      else captivePose.lastDecomposedScale = group.scale.clone(); // Recognize a delayed bird-matrix scale replay without overriding unrelated growth.
    }
    group.scale.copy(payload.scale);
    captivePose?.poseSession?.stamp(); // Stamp the exact flight-frame quaternion and size without claiming the new world position.
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
