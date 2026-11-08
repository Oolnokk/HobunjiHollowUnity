// Spouse kiss — shared height solver and in-world two-actor motion.
// The Multi-Avatar Animation Author consumes solveHeights/samplePose too, so its
// default kiss timeline has the same timing and body-sink percentages as gameplay.
(() => {
  'use strict';
  if (window.SpouseKissMotion) return;

  const DURATION_S = 2.4; // Used by the editor timeline and the live contact/exit sequence.
  const MOUTH_HEIGHT_FRACTION = .82; // Floor-relative portrait mouth proxy; scaled by actual rig height.
  const MAX_SINK_PCT = 82; // Extreme-size kneeling limit, measured like Attack Editor bodySink.
  const MAX_DISTANCE = .95; // A deliberate close-range action; avoids sliding partners through distant obstacles.
  const SOURCE = 'spouse-kiss'; // Composer/input-claim ownership; never replaces other effect owners.
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const ease = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
  let active = null; // Contains the locked pair until the 2.4-second interaction ends.
  let lastError = null; // Exposed through diagnostics for touch-only debugging.
  let lastResult = null; // Exposed through diagnostics after a completed or interrupted kiss.
  let schedulerInstalled = false; // Avoids duplicate pre-render callbacks on repeated init.

  function solveHeights(firstHeight, secondHeight, options = {}) {
    const first = Math.max(.001, finite(firstHeight, 1)); // First actor's rendered floor-to-head height.
    const second = Math.max(.001, finite(secondHeight, 1)); // Second actor's rendered floor-to-head height.
    const taller = first >= second ? 'first' : 'second'; // Selects who kneels, independent of player/NPC ordering.
    const tall = Math.max(first, second);
    const short = Math.min(first, second);
    const requestedSink = (tall - short) * MOUTH_HEIGHT_FRACTION;
    const limitPct = clamp(finite(options.maxSinkPct, MAX_SINK_PCT), 0, MAX_SINK_PCT);
    const bodySink = Math.min(requestedSink, tall * limitPct / 100);
    const remainingGap = Math.max(0, requestedSink - bodySink);
    return {
      taller, firstHeight: first, secondHeight: second,
      mouthHeightRatio: MOUTH_HEIGHT_FRACTION,
      tallerSinkWorld: bodySink,
      tallerSinkPct: bodySink / tall * 100,
      shorterSinkPct: 0,
      remainingGap,
      pose: bodySink / tall > .5 ? 'deep-kneel' : bodySink / tall > .18 ? 'crouch' : 'lean',
      contactPossible: remainingGap < .025,
    };
  }

  function samplePose(seconds) {
    const time = clamp(finite(seconds), 0, DURATION_S); // Shared editor/runtime timeline position.
    const blend = time <= .82 ? ease(time / .82) : time <= 1.52 ? 1 : ease((DURATION_S - time) / .88);
    return { time, durationS: DURATION_S, blend, touch: time >= 1.02 && time <= 1.52 };
  }

  function actorHeight(model, legs, root) {
    const local = Math.max(.05, finite(legs?.modelHeight, finite(model?.userData?.portraitModelHeight, 1)));
    const THREE = window.THREE;
    const scale = THREE?.Vector3 && root?.getWorldScale ? root.getWorldScale(new THREE.Vector3()) : null;
    return local * Math.max(.01, Math.abs(finite(scale?.y, 1)));
  }

  function scenePoint(root) {
    const THREE = window.THREE;
    return root.getWorldPosition(new THREE.Vector3());
  }

  function clearMotion(reason) {
    const old = active;
    if (!old) return false;
    active = null;
    try {
      window.PlayerBodyTransformComposer?.clearChannel?.(SOURCE);
      old.playerLegs?.setStanceDrop?.(0, true);
      if (old.npcSink && window.ActorBodySink?.apply) window.ActorBodySink.apply(old.npcSink, 0, 0, true);
      if (old.walker?.root?.parent === old.npcParent) {
        old.walker.root.rotation.y = old.originalNpcYaw;
        old.walker.root.position.x = old.originalNpcPosition.x; // Restores the approach displacement, including early dodge.
        old.walker.root.position.z = old.originalNpcPosition.z;
      }
      if (old.npcNeck && old.originalNpcNeck) old.npcNeck.quaternion.copy(old.originalNpcNeck);
      if (old.playerNeck && old.originalPlayerNeck) old.playerNeck.quaternion.copy(old.originalPlayerNeck);
    } finally {
      old.lock?.release?.();
      window.WorldActionInputClaims?.clearClaims?.(SOURCE);
    }
    lastResult = { reason, npcId: old.walker?.rec?.id || null, touched: old.touched, height: old.height, elapsedS: old.elapsed };
    return true;
  }

  function start(walker, onContact) {
    if (active) { lastError = 'already-kissing'; return false; }
    if (!walker?.rec?.id || !walker?.root?.parent || walker.root.visible === false) {
      lastError = 'spouse-unavailable'; return false;
    }
    if (window.CinematicCameraRuntime?.isActive?.() || window.FestivalWheelDanceRuntime?.isActive?.()) {
      lastError = 'another-paired-animation-active'; return false;
    }
    if (window.CharacterActionLocks?.isLocked?.('player', 'movement')) {
      lastError = 'player-busy'; return false;
    }
    const composer = window.PlayerBodyTransformComposer;
    const player = composer?.getPlayerMesh?.();
    const playerLegs = composer?.getPlayerLegHandle?.();
    const npcLegs = walker.legs;
    if (!window.THREE?.Vector3 || !window.ActorBodySink?.apply || !player?.parent ||
        !playerLegs?.setStanceDrop || !npcLegs?.setStanceDrop) {
      lastError = 'paired-rigs-not-ready'; return false;
    }
    player.updateWorldMatrix(true, false);
    walker.root.updateWorldMatrix(true, false);
    const playerPoint = scenePoint(player); // Actual player world position, not a tile rounded to the NPC grid.
    const npcPoint = scenePoint(walker.root);
    const dist = Math.hypot(playerPoint.x - npcPoint.x, playerPoint.z - npcPoint.z);
    if (dist > MAX_DISTANCE || Math.abs(playerPoint.y - npcPoint.y) > .5) {
      lastError = 'spouse-too-far-or-on-different-floor'; return false;
    }
    const npcRigRoot = walker.root.getObjectByName?.('npc_character_rig_root');
    if (!npcRigRoot) { lastError = 'spouse-body-rig-not-ready'; return false; }
    const firstHeight = actorHeight(player, playerLegs, player);
    const secondHeight = actorHeight(walker.avatarGroup, npcLegs, walker.root);
    const height = solveHeights(firstHeight, secondHeight);
    if (!height.contactPossible) { lastError = 'mouth-height-not-reachable'; return false; }
    const contactGap = Math.min(dist, .2 + Math.min(firstHeight, secondHeight) * .11); // Shortest partner's head width controls mouth proximity.
    const approach = Math.max(0, dist - contactGap); // Move only the spouse, so player collider and camera stay stable.
    const approachX = dist > .0001 ? (playerPoint.x - npcPoint.x) * approach / dist : 0;
    const approachZ = dist > .0001 ? (playerPoint.z - npcPoint.z) * approach / dist : 0;

    const npcSink = { legs: npcLegs, lower: [{ obj: npcRigRoot, factor: () => npcRigRoot.scale?.y || 1 }] };
    const playerNeck = player.userData?.neckRig?.neckJoint || null;
    const npcNeck = walker.avatarGroup?.userData?.neckRig?.neckJoint || null;
    const lock = window.CharacterActionLocks?.acquire?.({
      owner: SOURCE, reason: 'Kissing spouse', timeoutMs: 5000,
      participants: [
        { id: 'player', channels: ['movement', 'tools', 'pose', 'facing', 'head'] },
        { id: window.NpcCharacterState?.participantId?.(walker.rec.id) || 'npc:' + walker.rec.id,
          channels: ['movement', 'tools', 'actions', 'pose', 'facing', 'head'] },
      ],
    });
    active = {
      walker, player, playerLegs, npcLegs, npcRigRoot, npcSink, composer,
      playerNeck, npcNeck,
      originalPlayerNeck: playerNeck?.quaternion?.clone?.() || null,
      originalNpcNeck: npcNeck?.quaternion?.clone?.() || null,
      originalNpcYaw: walker.root.rotation.y,
      npcParent: walker.root.parent, // Prevents scene transfers from restoring an obsolete local world position.
      originalNpcPosition: { x: walker.root.position.x, z: walker.root.position.z },
      approachX, approachZ, height, lock, onContact, touched: false, elapsed: 0,
      headingPlayer: Math.atan2(npcPoint.x - playerPoint.x, npcPoint.z - playerPoint.z),
      headingNpc: Math.atan2(playerPoint.x - npcPoint.x, playerPoint.z - npcPoint.z),
    };
    lastError = null;
    window.WorldActionInputClaims?.setClaims?.(SOURCE, [
      { actionId: 'dodge', label: 'Stop kissing', priority: 600, onPress: () => clearMotion('canceled') },
    ]);
    return true;
  }

  function update(context = {}) {
    const session = active;
    if (!session) return;
    if (!session.player?.parent || session.walker?.root?.parent !== session.npcParent ||
        session.composer?.getPlayerMesh?.() !== session.player ||
        session.walker.legs !== session.npcLegs ||
        window.RomanceSystem?.getSpouse?.()?.npcId !== session.walker.rec.id) {
      clearMotion('partner-or-rig-changed');
      return;
    }
    session.elapsed += clamp(finite(context.deltaMs) / 1000, 0, .08);
    const pose = samplePose(session.elapsed);
    const pct = session.height.tallerSinkPct * pose.blend; // Percent-of-height body sink; same units as Attack Editor.
    const playerIsTaller = session.height.taller === 'first';
    const playerPct = playerIsTaller ? pct : 0;
    const npcPct = playerIsTaller ? 0 : pct;

    session.playerLegs.setStanceDrop(playerPct / 100 * (session.playerLegs.modelHeight || 0), true);
    const playerDrop = session.playerLegs.getStanceDrop?.() || 0;
    session.composer.setChannel(SOURCE, {
      priority: 20, absoluteYaw: session.headingPlayer,
      translation: { x: 0, y: -playerDrop, z: 0 },
      rotation: { pitch: (playerIsTaller ? -.09 : .035) * pose.blend },
    });
    window.ActorBodySink.apply(session.npcSink, npcPct, 0, true);
    session.walker.root.position.x = session.originalNpcPosition.x + session.approachX * pose.blend;
    session.walker.root.position.z = session.originalNpcPosition.z + session.approachZ * pose.blend;
    session.walker.root.rotation.y = session.originalNpcYaw + 
      Math.atan2(Math.sin(session.headingNpc - session.originalNpcYaw), Math.cos(session.headingNpc - session.originalNpcYaw)) * pose.blend;
    if (session.playerNeck && session.originalPlayerNeck) {
      session.playerNeck.quaternion.copy(session.originalPlayerNeck);
      session.playerNeck.rotateX((playerIsTaller ? -.14 : .10) * pose.blend);
    }
    if (session.npcNeck && session.originalNpcNeck) {
      session.npcNeck.quaternion.copy(session.originalNpcNeck);
      session.npcNeck.rotateX((playerIsTaller ? .10 : -.14) * pose.blend);
    }
    if (!session.touched && pose.touch) {
      session.touched = true;
      try { session.onContact?.(); }
      catch (error) { lastError = 'contact-callback: ' + (error?.message || error); }
    }
    if (session.elapsed >= DURATION_S) clearMotion('completed');
  }

  function init() {
    if (schedulerInstalled || !window.RuntimeFrameScheduler?.register) return false;
    window.RuntimeFrameScheduler.register(SOURCE, update, {
      phase: 'pre-render', owner: 'SpouseKissMotion',
      description: 'Locks a spouse pair and applies adaptive kneeling with the existing leg/body sink solvers.',
    });
    schedulerInstalled = true;
    return true;
  }

  function diagnostics() {
    return { version: 1, active: !!active, lastError, lastResult,
      session: active ? { npcId: active.walker?.rec?.id, elapsedS: active.elapsed, touched: active.touched, height: { ...active.height } } : null };
  }

  window.SpouseKissMotion = Object.freeze({
    DURATION_S, MAX_SINK_PCT, MOUTH_HEIGHT_FRACTION,
    solveHeights, samplePose, actorHeight, init, start, stop: clearMotion, diagnostics,
  });
})();
