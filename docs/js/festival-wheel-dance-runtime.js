// Festival Wheel Dance: the two-avatar Animation Author preset, applied to live
// player and NPC visual roots after ordinary locomotion, before the scene renders.
(() => {
  'use strict';
  const DURATION_S = 4; // Mirrors AUTHORED_ROMANTIC_DANCE_TEMPLATE.duration in the Animation Author.
  const RADIUS = (0.34 * 1.18) / 2; // Half the preset's partner spacing; shared by both root tracks.
  const TILT_RAD = 22 * Math.PI / 180; // Author's four alternating tilt-jumps per four-second cycle.
  let session = null; // Owns the pair's original transforms, action lock, and animation clock.
  let lastStopReason = ''; // Included in mobile-readable festival diagnostics.

  function sample(seconds) {
    const t = ((Math.max(0, Number(seconds) || 0) % DURATION_S) + DURATION_S) % DURATION_S;
    const progress = t / DURATION_S;
    const spin = Math.PI * 2 * 2 * progress; // Two complete paired revolutions per loop.
    const tilt = TILT_RAD * Math.sin(Math.PI * 2 * 4 * progress); // Four oscillations.
    const lift = RADIUS * .82 * Math.abs(Math.sin(tilt));
    return { spin, tilt, lift, radius: RADIUS, progress };
  }

  function isPartner(walker) {
    return !!session && session.walker === walker; // Called in the existing NPC walker update loop to freeze only the partnered NPC.
  }
  function activeFor(npcId) {
    return !!session && session.walker?.rec?.id === npcId
      && !!session.player?.parent && !!session.walker?.root?.parent;
  }
  function elapsedSeconds(npcId) {
    return activeFor(npcId) ? session.elapsed : 0; // Festival Fun uses this simulation clock, never wall time.
  }
  function stop(reason = 'canceled') {
    if (!session) return false;
    const old = session;
    session = null; // Clear before transform or lock cleanup can re-enter our public API.
    old.player.position.copy(old.playerInitial.position);
    old.player.quaternion.copy(old.playerInitial.quaternion);
    if (old.walker?.root === old.partner) {
      old.partner.position.copy(old.partnerInitial.position);
      old.partner.quaternion.copy(old.partnerInitial.quaternion);
    }
    old.lock?.release?.();
    lastStopReason = String(reason);
    window.__farmLog?.('[festival dance] paired wheel stopped: ' + lastStopReason, 'social');
    return true;
  }

  function start(walker, player, options = {}) {
    if (session || !walker?.root?.parent || !player?.parent
        || walker.root === player || !walker.rec?.id
        || typeof player.position?.clone !== 'function'
        || typeof walker.root.quaternion?.clone !== 'function') return false;
    const THREE = window.THREE;
    if (!THREE?.Quaternion || !THREE?.Vector3) return false;
    const p = player.position, n = walker.root.position;
    const dx = n.x - p.x, dz = n.z - p.z;
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx,dz) > 3.6) return false;
    const angle = Math.atan2(dx,dz);
    const origin = new THREE.Vector3((p.x+n.x)/2,(p.y+n.y)/2,(p.z+n.z)/2);
    const lock = window.CharacterActionLocks?.acquire?.({
      owner:'festival-wheel-dance',
      reason:'Animation Author Festival Wheel Dance',
      participants:[
        {id:'player',channels:['movement','tools']},
        {id:walker.rec.id,channels:['movement','tools','actions']},
      ],
    }) || null;
    session={
      player,partner:walker.root,walker,lock,elapsed:0,anchor:origin,heading:angle,
      playerInitial:{position:p.clone(),quaternion:player.quaternion.clone()},
      partnerInitial:{position:n.clone(),quaternion:walker.root.quaternion.clone()},
      baseHeading:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle),
      yawAxis:new THREE.Vector3(0,1,0),
      tiltAxis:new THREE.Vector3(1,0,0),
      flip:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI),
      qWheel:new THREE.Quaternion(),qTilt:new THREE.Quaternion(),qWorld:new THREE.Quaternion(),
      radial:new THREE.Vector3(),
      latestSample:null,
    }; // Reused quaternion/vector instances avoid per-frame garbage during a busy town festival.
    applyFrame();
    window.__farmLog?.('[festival dance] paired wheel started with '+walker.rec.id, 'social');
    return true;
  }

  function applyFrame() {
    const s=session;
    if(!s)return;
    const pose=sample(s.elapsed);
    s.qWheel.setFromAxisAngle(s.yawAxis,pose.spin);
    s.qTilt.setFromAxisAngle(s.tiltAxis,pose.tilt);
    s.qWheel.multiply(s.qTilt); // Exactly the author: yawQuaternion.multiply(tiltQuaternion).
    s.qWorld.copy(s.baseHeading).multiply(s.qWheel);
    // The authored leader starts with negative Z radius, and the partner's
    // local +0.34*1.18 offset places them at the opposite side of this wheel.
    s.radial.set(0,0,-RADIUS).applyQuaternion(s.qWorld);
    s.player.position.copy(s.anchor).add(s.radial);
    s.player.position.y += pose.lift;
    s.player.quaternion.copy(s.qWorld);
    s.radial.set(0,0,RADIUS).applyQuaternion(s.qWorld);
    s.partner.position.copy(s.anchor).add(s.radial);
    s.partner.position.y += pose.lift;
    s.partner.quaternion.copy(s.qWorld).multiply(s.flip); // Follower faces inward; no independent spin.
    s.latestSample=pose;
    s.player.updateMatrix?.();
    s.partner.updateMatrix?.();
  }
  function update(dt, paused = false, currentArea = 'town') {
    if(!session)return;
    if(currentArea!=='town' || !session.player?.parent || !session.partner?.parent
        || session.walker?.root!==session.partner || session.walker.area!=='town') {
      stop('partner-or-scene-gone');
      return;
    }
    if(!paused)session.elapsed+=Math.max(0,Math.min(.05,Number(dt)||0));
    applyFrame(); // Called after the game's player and NPC roots update; never a second requestAnimationFrame.
  }
  function diagnostics() {
    return session ? {
      active:true,npcId:session.walker.rec.id,elapsedS:Number(session.elapsed.toFixed(2)),
      progress:session.latestSample?.progress,leader:session.player.position.toArray?.()||null,
      partner:session.partner.position.toArray?.()||null,
      authorDurationS:DURATION_S,authorRevolutions:2,authorTiltDeg:22,lastStopReason,
    } : {active:false,lastStopReason};
  }
  window.FestivalWheelDanceRuntime=Object.freeze({start,stop,update,activeFor,isPartner,elapsedSeconds,sample,diagnostics});
})();
