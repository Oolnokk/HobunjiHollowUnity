// Baseline geometry for multi-floor ruin rope chains. Player buffs and equipment never enter this model.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinRopeBaseline=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const ANCHOR_HEIGHT=3.35; // World height of the ceiling fixtures, shared by planning and challenge composition.
  const IDLE_GRIP_HEIGHT=.92; // Existing unmodified first/last rope grab height above the bank.
  const MAX_LENGTH_EXTRA=.12; // Existing rope let-out allowance, not a player movement modifier.
  const BOTTOM_QUARTER_START=.75; // At the top of the lowest 25% of the rope, measured from its anchor.
  const DT=1/60; // Matches the native rope-flight predictor and game integration.
  let lastKey='',lastProfile=null; // Cache the baseline calculation until a global RopeCore setting changes.
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function core(){
    const result=root.RopeCore||(typeof require==='function'?require('./rope-core.js'):null);
    if(!result)throw new Error('Ruin rope layout requires the global RopeCore physics.');
    return result;
  }
  function profile(){
    const RC=core(),length=ANCHOR_HEIGHT-IDLE_GRIP_HEIGHT,maxLength=length+MAX_LENGTH_EXTRA;
    const key=[ANCHOR_HEIGHT,IDLE_GRIP_HEIGHT,MAX_LENGTH_EXTRA,
      RC.GRAVITY,RC.PUMP,RC.MAX_ANGLE,RC.MIN_LENGTH,RC.AIR_CATCH_RADIUS,
      RC.COLLISION_RADIUS,RC.ATTACHED_DAMPING,RC.LIMIT_BOUNCE,RC.RELEASE_KICK].join(':');
    if(lastProfile&&lastKey===key)return lastProfile;
    const gripLength=clamp(length*BOTTOM_QUARTER_START,RC.MIN_LENGTH,maxLength);
    const rope=RC.create({anchor:{x:0,y:ANCHOR_HEIGHT,z:0},yaw:0,length:gripLength,maxLength:gripLength,angle:-RC.MAX_ANGLE});
    let landingReach=0,catchReach=0; // Extreme forward trajectory and rope-to-rope catch of the baseline unmodified player.
    const catchLow=ANCHOR_HEIGHT-length-RC.AIR_CATCH_RADIUS;
    const catchHigh=ANCHOR_HEIGHT-RC.MIN_LENGTH+RC.AIR_CATCH_RADIUS;
    for(let step=0;step<30/DT;step++){
      RC.stepAttached(rope,{forward:Math.sign(rope.omega)||1,side:0,strength:1},DT);
      if(rope.omega<=0||rope.angle<0)continue; // Forward releases only; the other direction is geometrically symmetric.
      const flight=RC.releaseFlight(rope),height=flight.y;
      if(height<0)continue;
      const time=(flight.vy+Math.sqrt(flight.vy*flight.vy+2*RC.GRAVITY*height))/RC.GRAVITY;
      landingReach=Math.max(landingReach,flight.x+flight.vx*time);
      for(let t=DT;t<=time;t+=DT){
        const x=flight.x+flight.vx*t,y=flight.y+flight.vy*t-.5*RC.GRAVITY*t*t;
        if(y>=catchLow&&y<=catchHigh)catchReach=Math.max(catchReach,x);
      }
    }
    const maxNeighborDistance=catchReach+RC.AIR_CATCH_RADIUS; // Exact air-catch radius extends the farthest eligible flight point.
    if(!(landingReach>0&&maxNeighborDistance>RC.AIR_CATCH_RADIUS))
      throw new Error('Base rope swing has no valid forward launch; inspect global RopeCore constants.');
    const swingRadius=maxLength*Math.sin(RC.MAX_ANGLE)+RC.COLLISION_RADIUS; // Unmodified full swing must clear both side walls.
    const bank=Math.ceil(swingRadius); // A rearward pump never strikes the entrance or exit wall.
    const pitLength=Math.ceil(Math.max(landingReach+RC.COLLISION_RADIUS,2*maxNeighborDistance));
    const alongSpacing=maxNeighborDistance/Math.SQRT2; // Equal forward/lateral budget for a 45-degree catch vector.
    const crossStep=Math.sqrt(maxNeighborDistance*maxNeighborDistance-alongSpacing*alongSpacing);
    const roomWidth=Math.ceil(2*(swingRadius+crossStep)); // Two full swing envelopes plus the permissible lateral catch travel.
    lastKey=key;
    lastProfile=Object.freeze({anchorHeight:ANCHOR_HEIGHT,length,maxLength,gripLength,
      landingReach,maxNeighborDistance,swingRadius,bank,pitLength,
      alongSpacing,crossStep,roomWidth,roomLength:pitLength+2*bank});
    return lastProfile;
  }
  function ropeLayout(pit,side,rng=Math.random){
    const cfg=profile(),alongX=pit.axis==='x',positive=side==='E'||side==='S';
    const length=alongX?pit.maxX-pit.minX:pit.maxZ-pit.minZ;
    const start=alongX?(positive?pit.minX:pit.maxX):(positive?pit.minZ:pit.maxZ);
    const middle=alongX?(pit.minZ+pit.maxZ)/2:(pit.minX+pit.maxX)/2;
    const count=Math.max(3,Math.ceil((length-1)/cfg.alongSpacing)+1);
    const forwardStep=(length-1)/(count-1);
    const maxCrossStep=Math.sqrt(Math.max(0,cfg.maxNeighborDistance**2-forwardStep**2));
    const maxOffset=maxCrossStep/2; // Opposite zigzag offsets then stay within one physically catchable step.
    const sign=rng()<.5?-1:1; // Seeded parity changes which wall receives the first zig.
    const anchors=Array.from({length:count},(_,i)=>{
      const along=start+(positive?1:-1)*(.5+(length-1)*i/(count-1));
      const across=i===0||i===count-1?0:sign*(i%2===0?-1:1)*rng()*maxOffset;
      return {x:alongX?along:middle+across,z:alongX?middle+across:along};
    });
    for(let i=0;i<count;i++){
      const next=anchors[i+1]||anchors[i-1];
      const dx=(next.x-anchors[i].x)*(i+1<count?1:-1);
      const dz=(next.z-anchors[i].z)*(i+1<count?1:-1);
      anchors[i].yaw=Math.atan2(dz,dx); // Aim each default swing toward the next catch; backwards pumping remains possible.
      if(i>0&&Math.hypot(anchors[i].x-anchors[i-1].x,anchors[i].z-anchors[i-1].z)>cfg.maxNeighborDistance+1e-8)
        throw new Error('Generated rope spacing exceeds the baseline aerial catch envelope.');
    }
    return anchors;
  }
  return Object.freeze({profile,ropeLayout,BOTTOM_QUARTER_START,DT});
});
