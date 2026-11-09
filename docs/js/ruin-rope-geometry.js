// Seeded shaft-wing rope geometry derived from unmodified RopeCore and player air-motion baselines.
// Independent of food, potions, and other future gameplay multipliers.
(function(root,factory){
  const rope=root.RopeCore||(typeof require==='function'?require('./rope-core.js'):null);
  const motion=root.PlayerAirMotionConfig||(typeof require==='function'?require('./player-air-motion-config.js'):null);
  const api=factory(rope,motion);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinRopeGeometry=api;
})(typeof self!=='undefined'?self:globalThis,function(RopeCore,Motion){
  'use strict';
  if(!RopeCore||!Motion)throw new Error('RuinRopeGeometry requires RopeCore and PlayerAirMotionConfig.');
  const ANCHOR_RISE=3.35,IDLE_GRIP_RISE=.92; // Existing mounted rope pivot and new-player idle hand height.
  const BANK=3; // Real walkable tile banks before and after the floorless crossing.
  const ROPE_LENGTH=ANCHOR_RISE-IDLE_GRIP_RISE;
  const MAX_LENGTH=ROPE_LENGTH+.12; // Original brake-controlled payout; not a player movement modifier.
  const GRIP_FRACTION=.75; // Top of the lowest quarter of the rope, measured from its ceiling anchor.
  function baselineFlight(){
    const length=ROPE_LENGTH*GRIP_FRACTION,gravity=RopeCore.GRAVITY;
    const steer=Motion.BASE.airTilesPerSecond*Motion.BASE.ropeSteerFactor;
    const pendulum=RopeCore.create({
      anchor:{x:0,y:ANCHOR_RISE,z:0},yaw:0,length,maxLength:length,angle:-.12,
    }); // New player grips at the top of the lowest quarter; no buffs or equipment.
    const input={forward:1,side:0,strength:1};
    const dt=1/60,steps=90*60; // Long fixed-step saturation proof: repeated ideal pumping reaches the real spring/damping/angle limit.
    let best={distance:0,time:0,releaseAngle:0,angularSpeed:0};
    for(let step=0;step<steps;step++){
      input.forward=pendulum.omega<0?-1:1; // Pump in the direction of travel, exactly as the actual player can.
      RopeCore.stepAttached(pendulum,input,dt);
      if(pendulum.omega<=0)continue;
      const flight=RopeCore.releaseFlight(pendulum); // The real release kick and tangent momentum, never an invented throw speed.
      const t=(flight.vy+Math.sqrt(flight.vy**2+2*gravity*flight.y))/gravity;
      const distance=flight.x+(flight.vx+steer)*t; // Full unbuffed air steering toward the exit, with a floor-height landing.
      if(distance>best.distance)best={distance,time:t,releaseAngle:pendulum.angle,angularSpeed:pendulum.omega};
    }
    return best;
  }
  const BASE_FLIGHT=Object.freeze(baselineFlight()); // Used for pit length, neighboring-anchor clamps and side clearance.
  const MAX_NEIGHBOR_DISTANCE=Math.max(1.5,BASE_FLIGHT.distance-ROPE_LENGTH*Math.sin(RopeCore.MAX_ANGLE)-RopeCore.AIR_CATCH_RADIUS);
  const MIN_NEIGHBOR_DISTANCE=Math.max(1.5,MAX_NEIGHBOR_DISTANCE-3*RopeCore.AIR_CATCH_RADIUS); // Catch tolerance sets the randomized design interval, not buff multipliers.
  const LATERAL_SWING_ROOM=ROPE_LENGTH*Math.sin(RopeCore.MAX_ANGLE)+RopeCore.COLLISION_RADIUS+RopeCore.AIR_CATCH_RADIUS;
  const LATERAL_OFFSET=Math.max(0,Math.min(
    (BASE_FLIGHT.time*Motion.BASE.airTilesPerSecond*Motion.BASE.ropeSteerFactor-RopeCore.AIR_CATCH_RADIUS)/2,
    Math.sqrt(Math.max(0,MAX_NEIGHBOR_DISTANCE**2-MIN_NEIGHBOR_DISTANCE**2))/2,
  )); // Opposite-side neighbors require at most the unbuffed air-steering displacement.
  const CROSS_WIDTH=Math.ceil(2*(LATERAL_SWING_ROOM+LATERAL_OFFSET+RopeCore.GRAB_RADIUS));
  const PIT_LENGTH=Math.ceil(BASE_FLIGHT.distance+MAX_NEIGHBOR_DISTANCE+RopeCore.COLLISION_RADIUS);
  const ROOM_LENGTH=PIT_LENGTH+2*BANK;
  const MAX_AXIAL_GAP=Math.sqrt(Math.max(.01,MAX_NEIGHBOR_DISTANCE**2-(2*LATERAL_OFFSET)**2));
  const COUNT=Math.max(4,Math.ceil((PIT_LENGTH-1)/MAX_AXIAL_GAP)+1); // Even alternating extreme offsets respect the neighbor distance clamp.
  function hash(value){
    let n=2166136261;
    for(const char of String(value))n=Math.imul(n^char.charCodeAt(0),16777619)>>>0;
    return n>>>0;
  }
  function random(seed){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
  function dimensions(side){
    return side==='E'||side==='W'?{w:ROOM_LENGTH,d:CROSS_WIDTH}:{w:CROSS_WIDTH,d:ROOM_LENGTH};
  }
  function anchors(pit,side,id,seed=0){
    const alongX=pit.axis==='x',positive=side==='E'||side==='S';
    const length=alongX?pit.maxX-pit.minX:pit.maxZ-pit.minZ;
    const start=alongX?(positive?pit.minX:pit.maxX):(positive?pit.minZ:pit.maxZ);
    const center=alongX?(pit.minZ+pit.maxZ)/2:(pit.minX+pit.maxX)/2;
    const rng=random(hash(String(seed)+':'+id));
    const direction=(rng()<.5?-1:1);
    const count=Math.max(COUNT,Math.ceil((length-1)/MAX_AXIAL_GAP)+1); // Longer authored chambers gain ropes rather than violating the baseline neighbor clamp.
    const avg=(length-1)/(count-1); // Longitudinal spacing is fixed; only the perpendicular translation varies.
    return Array.from({length:count},(_,i)=>{
      const inner=i>0&&i<count-1;
      const along=start+(positive?1:-1)*(.5+avg*i);
      const zig=inner?direction*(i%2?1:-1)*LATERAL_OFFSET*(.7+.3*rng()):0;
      return {x:alongX?along:center+zig,z:alongX?center+zig:along,y:0};
    });
  }
  function snapshot(){return {
    gripFraction:GRIP_FRACTION,baseFlight:BASE_FLIGHT,
    pitLength:PIT_LENGTH,roomLength:ROOM_LENGTH,crossWidth:CROSS_WIDTH,ropeCount:COUNT,
    maxNeighborDistance:MAX_NEIGHBOR_DISTANCE,minNeighborDistance:MIN_NEIGHBOR_DISTANCE,maxAxialGap:MAX_AXIAL_GAP,
    maxLateralOffset:LATERAL_OFFSET,ropeLength:ROPE_LENGTH,
  };} // Readable without devtools via the existing mobile ruin debug snapshot.
  return Object.freeze({ANCHOR_RISE,IDLE_GRIP_RISE,BANK,ROPE_LENGTH,MAX_LENGTH,
    BASE_FLIGHT,MAX_NEIGHBOR_DISTANCE,MIN_NEIGHBOR_DISTANCE,LATERAL_OFFSET,
    CROSS_WIDTH,PIT_LENGTH,ROOM_LENGTH,COUNT,dimensions,anchors,snapshot});
});
