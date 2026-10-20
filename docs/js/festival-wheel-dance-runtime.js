// Paired wheel choreography on the existing procedural feet, hands, gaze and cinematic camera owners.
(() => {
  'use strict';
  const DURATION_S=4, RADIUS=(.34*1.18)/2, TILT_RAD=22*Math.PI/180; // Preserves the preview's transport and alternating rock rhythm.
  const SIDES=['left','right']; // Fixed two-hand/two-leg work, independent of the festival crowd.
  let lastStartFailure=null; // Mobile diagnostics distinguish preparation failures from an actual pose/reach failure.
  function failStart(code,actor=null,details={}){lastStartFailure={code,actor,...details};return false;}
  let deps=null, session=null, lastStopReason=''; // One scoped pair; no independent frame loop or world scan.
  function init(value){deps=value;}
  function sample(seconds,out={}) {
    const progress=((Math.max(0,Number(seconds)||0)%DURATION_S)+DURATION_S)%DURATION_S/DURATION_S; // Simulation time, including exact pause behavior.
    out.progress=progress;out.spin=Math.PI*4*progress;out.tilt=TILT_RAD*Math.sin(Math.PI*8*progress);
    out.lift=RADIUS*.82*Math.abs(Math.sin(out.tilt));out.radius=RADIUS;return out;
  }
  function isPartner(walker){return !!session&&session.walker===walker;}
  function activeFor(id){return !!session&&session.walker.rec.id===id&&!!session.player.parent&&!!session.partner.parent;}
  function elapsedSeconds(id){return activeFor(id)?session.elapsed:0;}
  function captureActor(root,model,legs,who) {
    const T=window.THREE, hands=model?.userData?.proceduralHandRig, neck=model?.userData?.neckRig; // Resolve existing owners once at invitation acceptance.
    if(!legs?.motionAnatomy){failStart('legs-not-ready',who);return null;}
    if(!hands?.shoulderPositionLocal){failStart('hands-not-ready',who);return null;}
    if(!neck?.neckJoint){failStart('neck-not-ready',who);return null;}
    root.updateWorldMatrix(true,true);
    const scale=root.getWorldScale(new T.Vector3()); // Actual body scaling, including any scene/instance scale.
    if([scale.x,scale.y,scale.z].some(v=>!Number.isFinite(v)||Math.abs(v)<1e-6)){failStart('invalid-rig-scale',who,{scale:{x:scale.x,y:scale.y,z:scale.z}});return null;} // Independent width/height and mirrored PNG roots are intentional; only singular transforms cannot be solved.
    const actor={root,model,legs,hands,neck:neck.neckJoint,anatomy:null,scale:Math.abs(scale.y),worldScale:scale,verticalFactor:Math.abs(scale.y),
      localUp:new T.Vector3(),inverseRotation:new T.Quaternion(),
      initial:{position:root.position.clone(),quaternion:root.quaternion.clone(),legRotation:legs.group.quaternion.clone(),neck:neck.neckJoint.quaternion.clone()},
      shoulders:{},reach:{},worldShoulders:{left:new T.Vector3(),right:new T.Vector3()},
      targets:{left:new T.Vector3(),right:new T.Vector3()},
      footTargets:{left:new T.Vector3(),right:new T.Vector3()},groundAnchors:{left:new T.Vector3(),right:new T.Vector3()},handTargets:{left:new T.Vector3(),right:new T.Vector3()},
      handSockets:{left:hands.group.getObjectByName('left_hand_socket'),right:hands.group.getObjectByName('right_hand_socket')},eye:new T.Vector3(),eyeOffset:new T.Vector3(),
      sourceLocal:new T.Vector3(),targetLocal:new T.Vector3(),hip:new T.Vector3(),
      handLocal:new T.Vector3(),handInverse:new T.Quaternion(),footYaw:new T.Quaternion(),
      grounded:true,wasSupport:false,crouch:0,lift:0,airBlend:0,supportSlides:0}; // All transform scratch belongs to the action, never allocated by its frame path.
    if(!actor.handSockets.left||!actor.handSockets.right){failStart('hand-sockets-not-ready',who);return null;}
    const parentScale=hands.parent.getWorldScale(new T.Vector3()); // Hand reach is already expressed in the floor-relative hand parent's units.
    for(const side of SIDES) {
      const shoulder=hands.shoulderPositionLocal(side,new T.Vector3()); // Canonical species/gender attachment-rig shoulders, including posterior placement.
      if(!shoulder){failStart('shoulders-not-ready',who);return null;}
      hands.parent.localToWorld(shoulder);root.worldToLocal(shoulder);actor.shoulders[side]=shoulder;
      actor.reach[side]=hands.armLengthForSide(side)*Math.min(Math.abs(parentScale.x),Math.abs(parentScale.y),Math.abs(parentScale.z))*.98;
      if(!Number.isFinite(actor.reach[side])||actor.reach[side]<=0){failStart('arm-reach-not-ready',who);return null;}
    }
    actor.shoulderCenter=actor.shoulders.left.clone().add(actor.shoulders.right).multiplyScalar(.5);
    if(!refreshLegAnatomy(actor)){failStart('leg-anatomy-not-ready',who);return null;}
    actor.eyeOffset.copy(neck.headCentroidLocal||{x:0,y:0,z:0}).sub(neck.neckLocal||{x:0,y:0,z:0}); // Same head-centroid landmark used by the preview's eye marker.
    actor.eyeOffset.z+=.006;
    return actor;
  }
  function refreshLegAnatomy(actor) {
    actor.anatomy=actor.legs.motionAnatomy(); // Recomputed only at action start or an asset-readiness revision.
    if(!Array.isArray(actor.anatomy)||actor.anatomy.length<2||actor.anatomy.some(a=>!a?.hip?.clone||!Number.isFinite(a.length)||a.length<=0||!Number.isFinite(a.ankle?.y)))return false;
    actor.anatomyRevision=actor.legs.anatomyRevision?.();
    actor.legLength=Math.min(...actor.anatomy.map(a=>a.length))*actor.scale;
    actor.soleHeight=Math.max(...actor.anatomy.map(a=>a.ankle.y))*actor.scale;
    actor.hipLocal=actor.anatomy[0].hip.clone().add(actor.anatomy[1].hip).multiplyScalar(.5);
    actor.wasSupport=false;
    return true;
  }
  function stop(reason='canceled') {
    if(!session)return false;
    const old=session;session=null; // Clear before releasing locks or camera selection can reenter gameplay.
    window.WorldActionInputClaims?.clearClaims?.('paired-dance');
    for(const actor of old.actors) {
      actor.hands.setPoseProvider('paired-dance',null);
      actor.root.position.copy(actor.initial.position);actor.root.quaternion.copy(actor.initial.quaternion);
      actor.legs.group.quaternion.copy(actor.initial.legRotation);actor.neck.quaternion.copy(actor.initial.neck);
      actor.legs.update(0,0,false,null);actor.legs.pants?.update?.();actor.hands.useIdlePose();
    }
    if(old.cameraRecord && window.CinematicCameraRuntime?.activeRecord?.()===old.cameraRecord)window.CinematicCameraRuntime.deactivate(); // Never cancel a new cutscene/dialogue that took over.
    deps?.restoreCamera?.(old.cameraState);
    old.lock?.release?.();lastStopReason=String(reason);
    window.__farmLog?.('[festival dance] stopped: '+lastStopReason,'social');
    return true;
  }
  function start(walker,player) {
    lastStartFailure=null;
    if(session)return failStart('already-dancing');
    if(window.SocialActionWheel?.isDancing?.())return failStart('solo-dance-active');
    if(window.CinematicCameraRuntime?.isActive?.())return failStart('camera-busy');
    if(!walker?.root?.parent||!player?.parent||!walker.rec?.id||walker.root===player)return failStart('partner-unavailable');
    const T=window.THREE,p=player.position,n=walker.root.position; // World roots remain the real participants, never preview clones.
    if(!T?.Vector3)return failStart('renderer-not-ready');
    if(Math.hypot(n.x-p.x,n.z-p.z)>3.6)return failStart('too-far');
    if(Math.abs(p.y-n.y)>1)return failStart('different-floor-height');
    const a=captureActor(player,deps?.getPlayerModel?.(),deps?.getPlayerLegs?.(),'player');
    if(!a){lastStopReason=lastStartFailure?.code||'waiting-for-procedural-rigs';return false;}
    const b=captureActor(walker.root,walker.avatarGroup,walker.legs,'partner');
    if(!b){lastStopReason=lastStartFailure?.code||'waiting-for-procedural-rigs';return false;}
    const separation=Math.min(RADIUS*2*(a.scale+b.scale)/2,(Math.min(a.reach.left,a.reach.right)+Math.min(b.reach.left,b.reach.right))*.6); // Keep an elbow reserve instead of assuming all species have equal arms.
    const heightDifference=b.shoulderCenter.y*b.scale-a.shoulderCenter.y*a.scale; // Compensates for tall/short partners before adding rhythmic rocking.
    session={player,partner:walker.root,walker,actors:[a,b],elapsed:0,heading:Math.atan2(n.x-p.x,n.z-p.z),
      anchor:new T.Vector3((p.x+n.x)/2,Math.max(p.y,n.y),(p.z+n.z)/2),separation:Math.max(.12,separation),
      hopHeight:Math.min(a.legLength*.42,b.legLength*.42,Math.min(a.reach.left,a.reach.right,b.reach.left,b.reach.right)*.35),
      baseTilt:Math.max(-.42,Math.min(.42,Math.atan2(heightDifference,Math.max(.12,separation))*.45)),
      pose:{},rotation:new T.Quaternion(),yaw:new T.Quaternion(),tilt:new T.Quaternion(),flip:new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI),
      up:new T.Vector3(0,1,0),xAxis:new T.Vector3(1,0,0),radial:new T.Vector3(),delta:new T.Vector3(),
      contacts:[new T.Vector3(),new T.Vector3()],cameraPosition:new T.Vector3(),cameraTarget:new T.Vector3(),cameraState:deps?.captureCamera?.(),
      supportPoint:new T.Vector3(),lastSupport:null,cameraRecord:null,lock:null}; // Reused vectors and a fixed count of analytic constraints replace per-frame anatomy checks/searches.
    if(!applyFrame()){stop('anatomical-reach');return failStart('anatomical-reach');}
    const s=session; // Callbacks retain only this action's preallocated pose buffers.
    for(const actor of s.actors)actor.hands.setPoseProvider('paired-dance',()=>applyHands(actor));
    s.lock=window.CharacterActionLocks?.acquire?.({owner:'festival-wheel-dance',reason:'Procedural paired dance',participants:[
      {id:'player',channels:['movement','tools','pose','facing','head','camera']},{id:window.NpcCharacterState?.participantId?.(walker.rec.id)||`npc:${walker.rec.id}`,channels:['movement','tools','actions','pose','facing','head']}]});
    s.cameraRecord=window.CinematicCameraRuntime?.activate?.('town',{id:'paired-dance',fovDeg:48,blendSeconds:.25,
      positionProvider:()=>s.cameraPosition,targetProvider:()=>s.cameraTarget,dialogueFraming:false},{reason:'paired-dance'});
    window.WorldActionInputClaims?.setClaims?.('paired-dance',['dodge','action2'].map(actionId=>({actionId,label:'Stop dancing',priority:600,onPress:()=>stop('player-canceled')}))); // Uses the existing bound inputs on keyboard, touch and controller.
    lastStopReason='';
    deps?.refreshCamera?.();
    return true;
  }
  function placeActor(actor,index,amplitude,support) {
    const s=session; // Both bodies share one world rock plane and face inward, just like the author preset.
    actor.root.quaternion.copy(s.rotation);if(index===1)actor.root.quaternion.multiply(s.flip);
    actor.legs.group.quaternion.identity();
    actor.localUp.set(0,1,0).applyQuaternion(actor.inverseRotation.copy(actor.root.quaternion).invert());
    actor.localUp.x/=actor.worldScale.x;actor.localUp.y/=actor.worldScale.y;actor.localUp.z/=actor.worldScale.z;
    actor.verticalFactor=1/actor.localUp.length(); // World-vertical reach of a fixed local leg under this tilted, independently scaled root.
    s.radial.set(0,0,(index===0?-1:1)*s.separation*.5).applyQuaternion(s.yaw);
    actor.root.position.copy(s.anchor).add(s.radial);
    actor.grounded=index===support;actor.crouch=actor.grounded ? .22*amplitude : 0;
    actor.airBlend=amplitude;actor.lift=actor.grounded?0:s.hopHeight*amplitude;
    s.radial.copy(actor.hipLocal).multiply(actor.worldScale).applyQuaternion(actor.root.quaternion);
    actor.floor=deps?.surfaceY?.(actor.root.position.x,actor.root.position.z) ?? s.anchor.y;
    actor.root.position.y=actor.floor+actor.soleHeight+actor.legLength/actor.scale*actor.verticalFactor*(.995-actor.crouch)+actor.lift-s.radial.y; // Root height follows the posterior, not a portrait bounding-box guess.
    actor.root.updateWorldMatrix(true,false);
  }
  function shoulderWorld(actor,side,out){return actor.root.localToWorld(out.copy(actor.shoulders[side]));}
  function constrainPair(support) {
    const s=session,a=s.actors[0],b=s.actors[1],air=s.actors[1-support]; // Two fixed passes over two links; no search or iterative convergence loop.
    // All links share the same separation direction. First limit vertical shoulder mismatch by lowering only the airborne body when possible.
    for(const side of SIDES) {
      const other=side==='left'?'right':'left'; // Facing partners join opposite anatomical hands.
      shoulderWorld(a,side,a.worldShoulders[side]);shoulderWorld(b,other,b.worldShoulders[other]);
    }
    let correctionY=0; // Common vertical correction preserves both body/arm proportions.
    const floorY=air.floor+air.soleHeight+air.legLength/air.scale*air.verticalFactor*.995-s.radial.copy(air.hipLocal).multiply(air.worldScale).applyQuaternion(air.root.quaternion).y;
    for(const side of SIDES) {
      const other=side==='left'?'right':'left',pa=a.worldShoulders[side],pb=b.worldShoulders[other],limit=(a.reach[side]+b.reach[other])*.98;
      const dy=(support===0?pb.y-pa.y:pa.y-pb.y)+correctionY; // Reach reserve leaves room for natural hand rotations.
      if(Math.abs(dy)>limit*.8)correctionY+=(dy>0?1:-1)*(limit*.8-Math.abs(dy));
    }
    air.root.position.y=Math.max(floorY,air.root.position.y+correctionY);
    air.root.updateWorldMatrix(true,false);
    s.delta.copy(b.root.position).sub(a.root.position);s.delta.y=0;
    const gap=s.delta.length(); // Root separation is the only planar degree of freedom; shoulder offsets remain anatomical.
    s.delta.multiplyScalar(1/Math.max(.0001,gap));
    let allowedGap=gap,minGap=0; // Intersection of two quadratic reach intervals, solved directly without searching.
    for(const side of SIDES) {
      const other=side==='left'?'right':'left',pa=shoulderWorld(a,side,a.worldShoulders[side]),pb=shoulderWorld(b,other,b.worldShoulders[other]);
      const ux=pb.x-pa.x-s.delta.x*gap,uz=pb.z-pa.z-s.delta.z*gap,dy=pb.y-pa.y,limit=(a.reach[side]+b.reach[other])*.98;
      const along=ux*s.delta.x+uz*s.delta.z,discriminant=along*along+limit*limit-dy*dy-ux*ux-uz*uz; // Exact sphere reach with preserved lateral shoulder spacing.
      if(discriminant<0)return false;
      const upper=-along+Math.sqrt(discriminant),lower=-along-Math.sqrt(discriminant);
      allowedGap=Math.min(allowedGap,upper);
      minGap=Math.max(minGap,lower);
    }
    if(allowedGap<minGap)return false;
    if(allowedGap<gap) {
      s.delta.multiplyScalar(gap-allowedGap);if(support===0)b.root.position.sub(s.delta);else a.root.position.add(s.delta);
      a.root.updateWorldMatrix(true,false);b.root.updateWorldMatrix(true,false);
    }
    for(let i=0;i<2;i++) {
      const side=SIDES[i],other=SIDES[1-i],pa=shoulderWorld(a,side,a.worldShoulders[side]),pb=shoulderWorld(b,other,b.worldShoulders[other]);
      const distance=pa.distanceTo(pb),ra=a.reach[side],rb=b.reach[other]; // Intersection of the two reachable spheres places one shared wrist contact without arm extension.
      if(distance>ra+rb+1e-5)return false;
      const fraction=Math.max(0,Math.min(1,Math.max(1-rb/Math.max(distance,.0001),Math.min(.5,ra/Math.max(distance,.0001)))));
      s.contacts[i].copy(pa).lerp(pb,fraction);a.targets[side].copy(s.contacts[i]);b.targets[other].copy(s.contacts[i]);
    }
    return true;
  }
  function prepareGrounding(actor) {
    if(!actor.grounded){actor.wasSupport=false;return;}
    let correction=0; // One vertical correction keeps both retained support soles planted without extending either leg.
    for(const leg of actor.anatomy) {
      actor.root.localToWorld(actor.hip.copy(leg.hip));
      const anchor=actor.groundAnchors[leg.side]; // Captured only at a support handoff; the planted feet do not skate around the pair's orbit.
      if(!actor.wasSupport){anchor.copy(actor.hip);anchor.y=actor.floor+leg.ankle.y*actor.scale;}
      const horizontal=Math.hypot(actor.hip.x-anchor.x,actor.hip.z-anchor.z); // Short-legged anatomies may need the same bounded support slide used by ordinary lunges.
      const maxReach=leg.length*Math.min(Math.abs(actor.worldScale.x),Math.abs(actor.worldScale.y),Math.abs(actor.worldScale.z))*.55; // Conservative slide bound keeps the local two-bone solve reachable on every axis.
      if(horizontal>maxReach){const ratio=maxReach/horizontal;anchor.x=actor.hip.x+(anchor.x-actor.hip.x)*ratio;anchor.z=actor.hip.z+(anchor.z-actor.hip.z)*ratio;actor.supportSlides++;}
      actor.root.worldToLocal(actor.targetLocal.copy(anchor)).sub(leg.hip);
      const delta=actor.targetLocal,up=actor.localUp; // Solve the ground anchor in the leg's canonical local metric, preserving both segment lengths.
      const dot=delta.x*up.x+delta.y*up.y+delta.z*up.z,upSq=up.x*up.x+up.y*up.y+up.z*up.z;
      const distanceSq=delta.x*delta.x+delta.y*delta.y+delta.z*delta.z;
      const discriminant=Math.max(0,dot*dot-upSq*(distanceSq-leg.length*leg.length*.998001));
      correction=Math.min(correction,(dot+Math.sqrt(discriminant))/upSq);
    }
    actor.root.position.y+=correction;actor.root.updateWorldMatrix(true,false);actor.wasSupport=true;
  }
  function applyLegs(actor) {
    const s=session; // Ground targets are straight below each actual transformed hip; knees fold forward in the existing leg solver.
    for(const leg of actor.anatomy) {
      actor.root.localToWorld(actor.hip.copy(leg.hip));
      const target=actor.footTargets[leg.side]; // Fixed-length world-vertical dangling or support legs, independent of body tilt.
      target.copy(actor.hip);target.y-=leg.length*actor.verticalFactor*(actor.grounded ? .995-actor.crouch : .995-.025*actor.airBlend);
      if(actor.grounded)target.copy(actor.groundAnchors[leg.side]);
    }
    actor.footYaw.copy(s.yaw);if(actor===s.actors[1])actor.footYaw.multiply(s.flip);
    actor.legs.applyWorldFootTargets(actor.footTargets,actor.footYaw);actor.legs.pants?.update?.();
  }
  function applyHands(actor) {
    actor.root.updateWorldMatrix(true,false);actor.hands.parent.updateWorldMatrix(true,false);
    actor.hands.parent.getWorldQuaternion(actor.handInverse).invert();
    for(const side of SIDES) {
      actor.handLocal.copy(actor.handTargets[side]);actor.hands.parent.worldToLocal(actor.handLocal);
      const socket=actor.handSockets[side]; // Existing driver-owned sockets, cached once; no hand mesh reconstruction.
      socket.position.copy(actor.handLocal);socket.quaternion.copy(actor.handInverse).multiply(actor.root.quaternion);socket.visible=true;
      actor.hands.applyToolCalibration(side,null);socket.updateMatrix();
    }
  }
  function eyeWorld(actor){actor.neck.updateWorldMatrix(true,false);return actor.neck.localToWorld(actor.eye.copy(actor.eyeOffset));}
  function aimEye(actor,target) {
    actor.neck.parent.updateWorldMatrix(true,false);
    actor.neck.parent.worldToLocal(actor.sourceLocal.copy(actor.eye));actor.neck.parent.worldToLocal(actor.targetLocal.copy(target));
    actor.targetLocal.sub(actor.sourceLocal);
    const yaw=Math.max(-38*Math.PI/180,Math.min(38*Math.PI/180,Math.atan2(actor.targetLocal.x,actor.targetLocal.z)));
    const pitch=Math.max(-32*Math.PI/180,Math.min(32*Math.PI/180,-Math.atan2(actor.targetLocal.y,Math.max(.0001,Math.hypot(actor.targetLocal.x,actor.targetLocal.z))))); // Exact preview gaze limits and parent-space direction; no camera deadzone.
    actor.neck.rotation.set(pitch,yaw,0,'XYZ');
  }
  function applyFrame() {
    const s=session;if(!s)return false;
    const pose=sample(s.elapsed,s.pose),rock=Math.sin(pose.progress*Math.PI*8),amplitude=Math.abs(rock),support=rock>=0?1:0; // Lower dancer supports the alternating hop and bends smoothly with it.
    if(s.lastSupport!==null && support!==s.lastSupport)s.actors[support].root.localToWorld(s.supportPoint.copy(s.actors[support].hipLocal)); // Transfer the pivot onto the partner's actual landing position.
    s.yaw.setFromAxisAngle(s.up,s.heading+pose.spin);s.tilt.setFromAxisAngle(s.xAxis,s.baseTilt+pose.tilt*.65);s.rotation.copy(s.yaw).multiply(s.tilt);
    for(let i=0;i<2;i++)placeActor(s.actors[i],i,amplitude,support);
    if(s.lastSupport===null)s.actors[support].root.localToWorld(s.supportPoint.copy(s.actors[support].hipLocal));
    s.lastSupport=support;
    for(let i=0;i<2;i++) {
      const actor=s.actors[i]; // The non-hopper pivots over planted soles; the hopper orbits around that support rather than dragging both feet around a midpoint.
      s.radial.set(0,0,i===support?0:(i===0?-1:1)*s.separation).applyQuaternion(s.yaw);
      s.delta.copy(actor.hipLocal).multiply(actor.worldScale).applyQuaternion(actor.root.quaternion); // Rock around the real posterior so a body tilt does not drag planted hips sideways.
      actor.root.position.x=s.supportPoint.x+s.radial.x-s.delta.x;actor.root.position.z=s.supportPoint.z+s.radial.z-s.delta.z;
      const floor=deps?.surfaceY?.(actor.root.position.x,actor.root.position.z) ?? actor.floor; // Reuse the existing support registry after pivot transfer, including raised furniture.
      actor.root.position.y+=floor-actor.floor;actor.floor=floor;
      actor.root.updateWorldMatrix(true,false);
      prepareGrounding(actor);
    }
    if(!constrainPair(support))return false;
    for(const actor of s.actors){for(const side of SIDES)actor.handTargets[side].copy(actor.targets[side]);applyLegs(actor);applyHands(actor);}
    const a=s.actors[0],b=s.actors[1]; // Two fixed mutual-gaze passes reproduce the preview's moving eye-marker contact without a convergence search.
    for(let i=0;i<2;i++){eyeWorld(a);eyeWorld(b);aimEye(a,b.eye);aimEye(b,a.eye);}
    eyeWorld(a);eyeWorld(b);s.cameraTarget.copy(b.eye);
    s.radial.set(.3,0,-Math.max(1.25,(a.legLength+b.legLength)*1.4)).applyQuaternion(s.yaw);
    s.cameraPosition.copy(a.eye).add(s.radial);s.cameraPosition.y+=.12;
    return true;
  }
  function update(dt,paused=false,currentArea='town') {
    if(!session)return;
    if(session.cameraRecord && window.CinematicCameraRuntime?.activeRecord?.()!==session.cameraRecord){stop('camera-taken-over');return;}
    if(currentArea!=='town'||!session.player.parent||!session.partner.parent||session.walker.root!==session.partner||session.walker.area!=='town'
      ||session.actors.some(a=>a.model.userData.proceduralHandRig!==a.hands||!a.legs.group.parent)
      ||deps?.getPlayerModel?.()!==session.actors[0].model||session.walker.avatarGroup!==session.actors[1].model){stop('partner-or-scene-gone');return;}
    for(const actor of session.actors)if(actor.anatomyRevision!==actor.legs.anatomyRevision?.()) {
      if(!refreshLegAnatomy(actor)){stop('waiting-for-leg-anatomy');return;}
      session.hopHeight=Math.min(...session.actors.map(a=>Math.min(a.legLength*.42,a.reach.left*.35,a.reach.right*.35))); // A late GLB keeps its actual sole height and fixed leg reach.
    }
    if(!paused)session.elapsed+=Math.max(0,Math.min(.05,Number(dt)||0));
    if(!applyFrame()){stop('anatomical-reach');return;}
    deps?.refreshCamera?.(); // Reuses game.js's cinematic collision/framing owner after this frame's paired pose settles.
  }
  function diagnostics() {
    return {latestChange:'Paired dancing accepts independent character width/height and mirrored roots; grounding uses the local leg metric and hands retain conservative anatomical reach.',
      active:!!session,lastStopReason,lastStartFailure,...(session?{npcId:session.walker.rec.id,elapsedS:session.elapsed,progress:session.pose.progress,
        baseTiltDeg:session.baseTilt*180/Math.PI,authorDurationS:DURATION_S,authorRevolutions:2,
        actors:session.actors.map(a=>({species:a.model.userData.speciesId,gender:a.model.userData.gender,rigScale:{x:a.worldScale.x,y:a.worldScale.y,z:a.worldScale.z},verticalLegFactor:a.verticalFactor,grounded:a.grounded,crouch:a.crouch,supportSlides:a.supportSlides,legLength:a.legLength,armReach:a.reach,neckDeg:{pitch:a.neck.rotation.x*180/Math.PI,yaw:a.neck.rotation.y*180/Math.PI},handReachRatio:Object.fromEntries(SIDES.map(side=>[side,a.handTargets[side].distanceTo(a.worldShoulders[side])/a.reach[side]]))})),
        cameraTarget:{x:session.cameraTarget.x,y:session.cameraTarget.y,z:session.cameraTarget.z}}:{})};
  }
  window.FestivalWheelDanceRuntime=Object.freeze({init,start,stop,update,isActive:()=>!!session,activeFor,isPartner,elapsedSeconds,sample,diagnostics});
})();
