// RuinLayerPlan — sparse 2D dungeon floors snapped around multi-level rooms.
// Shared geometry coordinates; each floor owns its own independent network.
// Nothing renders or teleports here. Runtime geometry/puzzles must consume this plan.
(function(root,factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinLayerPlan=api;
})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const DIRS=Object.freeze([
    {side:'N',dx:0,dz:-1},{side:'E',dx:1,dz:0},
    {side:'S',dx:0,dz:1},{side:'W',dx:-1,dz:0},
  ]);
  const DEFAULTS=Object.freeze({
    spacing:64, // World cells between invisible multi-floor anchor slots; normal rooms fit between them.
    shaftSize:33, // Interior octagon width; actual masonry spans shaftSize + 2*shaftWall.
    shaftWall:8, // Matches ShaftHub's real shell thickness; door ends must be outside this wall.
    portalOffset:8, // Side-wall wing doors sit away from the climbing buttresses.
    floorHeight:4, // Vertical separation between ordinary 2D layers at shaft access galleries.
    minFloors:3,maxFloors:5,minWings:1,maxWings:4,
    minChallenges:2,maxChallenges:4,
    corridorWidth:3,
    seed:1,
  });
  function random(seed){
    let a=(Number(seed)>>>0)||1;
    return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  }
  function integer(rng,min,max){return min+Math.floor(rng()*(max-min+1));}
  function snap(value,spacing){return Math.round(value/spacing)*spacing;}
  function rect(cx,cz,w,d){return {x:Math.round(cx-w/2),z:Math.round(cz-d/2),w,d};}
  function segment(start,end,width,axis){
    // Corridor rectangle between facing door thresholds; may have variable length per gap.
    const x0=Math.min(start.x,end.x),x1=Math.max(start.x,end.x),z0=Math.min(start.z,end.z),z1=Math.max(start.z,end.z);
    return axis==='x'?{x:x0,z:Math.round(start.z-width/2),w:Math.max(1,x1-x0+1),d:width}
      :{x:Math.round(start.x-width/2),z:z0,w:width,d:Math.max(1,z1-z0+1)};
  }
  function intersects(a,b){
    return a.x<b.x+b.w&&a.x+a.w>b.x&&a.z<b.z+b.d&&a.z+a.d>b.z;
  }
  const inRect=(p,r)=>p.x>=r.x&&p.x<r.x+r.w&&p.z>=r.z&&p.z<r.z+r.d;
  const connectedRects=(a,b)=>a.x<=b.x+b.w&&a.x+a.w>=b.x&&a.z<=b.z+b.d&&a.z+a.d>=b.z;
  function compose(options={}){
    const o={...DEFAULTS,...options};
    o.spacing=Math.max(48,Math.min(128,Math.round(Number(o.spacing)||DEFAULTS.spacing)));
    o.shaftSize=Math.max(17,Math.min(o.spacing-12,(Math.round(Number(o.shaftSize)||33)|1)));
    o.minFloors=Math.max(3,Math.min(5,o.minFloors|0));
    o.maxFloors=Math.max(o.minFloors,Math.min(5,o.maxFloors|0));
    o.minWings=Math.max(1,Math.min(4,o.minWings|0));
    o.maxWings=Math.max(o.minWings,Math.min(4,o.maxWings|0));
    o.minChallenges=Math.max(2,Math.min(4,o.minChallenges|0));
    o.maxChallenges=Math.max(o.minChallenges,Math.min(4,o.maxChallenges|0));
    o.corridorWidth=3;
    o.shaftWall=Math.max(5,Math.min(12,Math.round(Number(o.shaftWall)||8)));
    o.portalOffset=Math.max(1,Math.min(8,Math.round(Number(o.portalOffset)||8)));
    const rng=random(o.seed);
    const floorCount=integer(rng,o.minFloors,o.maxFloors); // Used to bound both the shared shaft and independent 2D floor maps.
    // A shaft reserves the same snapped invisible-grid slot on ALL floor layers.
    const cx=snap(Number.isFinite(Number(o.anchorX))?Number(o.anchorX):o.spacing*5,o.spacing);
    const cz=snap(Number.isFinite(Number(o.anchorZ))?Number(o.anchorZ):o.spacing*5,o.spacing);
    const shaft=rect(cx,cz,o.shaftSize,o.shaftSize);
    shaft.shape='octagon';shaft.floors=floorCount;
    shaft.anchor={x:cx,z:cz};
    const floors=[];
    const puzzles=['ropeChain','glyphObelisk','ceilingRailTargets','statueDefense','dungeonFire','pressurePlate']; // Planner placeholders; runtime puzzle composer chooses concrete playable configurations.
    for(let floor=0;floor<floorCount;floor++){
      const y=floor*o.floorHeight; // Physical y datum for this otherwise ordinary 2D map.
      const shuffled=DIRS.map(d=>({d,roll:rng()})).sort((a,b)=>a.roll-b.roll).map(x=>x.d);
      const wingCount=integer(rng,o.minWings,o.maxWings), wings=[],rooms=[],hallways=[],doorways=[],braziers=[];
      rooms.push({id:`shaft-f${floor}`,kind:'shaft',...shaft,y,anchor:shaft.anchor,shared:true}); // Same x/z on every layer; unique floor-local room.
      for(let wi=0;wi<wingCount;wi++){
        const dir=shuffled[wi],challengeCount=integer(rng,o.minChallenges,o.maxChallenges);
        const wingId=`floor${floor}-${dir.side}`, nodes=[], corridors=[];
        const lateral=dir.dx!==0?{dx:0,dz:1}:{dx:1,dz:0};
        // Only the multi-floor shaft snaps to the invisible anchor grid.
        // Ordinary chambers are freely laid out, separated by short variable
        // hallways; packing them between major anchors avoids 300-cell-long
        // empty passages when a wing has four sequential puzzles.
        const outerRadius=Math.floor((o.shaftSize+o.shaftWall*2)/2);
        const portal={x:cx+dir.dx*outerRadius+lateral.dx*o.portalOffset,
          z:cz+dir.dz*outerRadius+lateral.dz*o.portalOffset};
        let previous={...portal}; // Far wall of the last room, initially the shaft portal threshold.
        for(let stage=1;stage<=challengeCount+1;stage++){ // Always at least two actual puzzle rooms BEFORE the goal brazier.
          const rw=dir.dx?integer(rng,11,19):integer(rng,9,15);
          const rd=dir.dz?integer(rng,11,19):integer(rng,9,15);
          const gap=integer(rng,7,15); // Variable-length hall, not a snapped room-grid separation.
          const offset=integer(rng,-5,5),depth=Math.floor((dir.dx?rw:rd)/2);
          const rx=previous.x+dir.dx*(gap+depth+1)+lateral.dx*offset;
          const rz=previous.z+dir.dz*(gap+depth+1)+lateral.dz*offset;
          const area=rect(rx,rz,rw,rd);
          const isGoal=stage===challengeCount+1;
          const id=`${wingId}-room${stage}`;
          const room={id,kind:isGoal?'brazier-chamber':'challenge-room',...area,y,wingId,
            challenge:isGoal?null:puzzles[integer(rng,0,puzzles.length-1)]};
          nodes.push(room);rooms.push(room);
          const door={x:rx-dir.dx*Math.floor(rw/2),z:rz-dir.dz*Math.floor(rd/2)};
          const along=dir.dx?'x':'z';
          const approach={x:door.x-dir.dx,z:door.z-dir.dz};
          const bend=dir.dx!==0?{x:previous.x,z:approach.z}:{x:approach.x,z:previous.z}; // Preserve signed coordinates in west/north doglegs.
          const pieces=[];
          if((previous.x!==bend.x)||(previous.z!==bend.z))pieces.push(segment(previous,bend,o.corridorWidth,dir.dx?'z':'x')); // Lateral dogleg.
          if((bend.x!==approach.x)||(bend.z!==approach.z))pieces.push(segment(bend,approach,o.corridorWidth,along)); // Radial length varies to fit rooms.
          // Straight corridor if there was no lateral drift.
          if(!pieces.length)pieces.push(segment(previous,approach,o.corridorWidth,along));
          const hall={id:`${wingId}-hall${stage}`,floor,y,from:stage===1?`shaft-f${floor}`:nodes[stage-2].id,to:id,rects:pieces,
            start:{...previous},end:{...approach},bend:{...bend},length:Math.abs(previous.x-approach.x)+Math.abs(previous.z-approach.z)};
          corridors.push(hall);hallways.push(hall);
          doorways.push({from:hall.from,to:id,side:dir.side,point:{...door},floor});
          previous={x:rx+dir.dx*Math.floor((dir.dx?rw:rd)/2),z:rz+dir.dz*Math.floor((dir.dx?rw:rd)/2)};
          if(isGoal)braziers.push({id:`${wingId}-brazier`,wingId,roomId:id,
            x:rx,z:rz,y,requires:nodes.filter(n=>n.challenge).map(n=>n.id)});
        }
        wings.push({id:wingId,floor,side:dir.side,entry:{...portal,y},rooms:nodes,corridors,goalBrazierId:braziers[braziers.length-1].id});
      }
      floors.push({floor,y,anchor:{...shaft.anchor},rooms,hallways,doorways,wings,braziers,entry:floor===0?{kind:'external-wing',side:'S'}:null});
    }
    const plan={schema:'hobunji.ruin-layer-plan.v1',options:o,shaft,floorCount,floors,
      totalWings:floors.reduce((n,f)=>n+f.wings.length,0),
      totalBraziers:floors.reduce((n,f)=>n+f.braziers.length,0)};
    plan.checks=verify(plan);plan.ok=plan.checks.every(c=>c.ok);
    return plan;
  }
  function verify(plan){
    const checks=[],add=(name,ok)=>checks.push({name,ok:!!ok});
    add('floorRange',plan.floors.length>=3&&plan.floors.length<=5);
    add('shaftSnapped',plan.shaft.anchor.x%plan.options.spacing===0&&plan.shaft.anchor.z%plan.options.spacing===0);
    const first=plan.floors[0]?.anchor;
    for(const floor of plan.floors){
      add(`floor${floor.floor}-aligned`,floor.anchor.x===first.x&&floor.anchor.z===first.z);
      add(`floor${floor.floor}-wingCount`,floor.wings.length>=1&&floor.wings.length<=4);
      add(`floor${floor.floor}-uniqueSides`,new Set(floor.wings.map(w=>w.side)).size===floor.wings.length);
      for(const wing of floor.wings){
        add(wing.id+'-challenges',wing.rooms.length>=3&&wing.rooms.length<=5);
        add(wing.id+'-portalConnected', wing.corridors[0]?.start.x===wing.entry.x&&wing.corridors[0]?.start.z===wing.entry.z);
        const shellRadius=Math.floor((plan.options.shaftSize+plan.options.shaftWall*2)/2);
        add(wing.id+'-clearShaft', wing.rooms.every(room=>!
          intersects(room,{x:plan.shaft.anchor.x-shellRadius,z:plan.shaft.anchor.z-shellRadius,w:shellRadius*2+1,d:shellRadius*2+1})));
        add(wing.id+'-braziers',floor.braziers.filter(b=>b.wingId===wing.id).length===1);
        add(wing.id+'-corridors',wing.corridors.length===wing.rooms.length&&wing.corridors.every(c=>
          c.length>0&&c.rects.length>=1&&c.rects.some(r=>inRect(c.start,r))&&
          c.rects.some(r=>inRect(c.end,r))&&c.rects.every((r,i)=>i===0||connectedRects(r,c.rects[i-1]))));
        add(wing.id+'-roomsSeparate',wing.rooms.every((room,i)=>floor.rooms.every((other,j)=>other.id===room.id||!intersects(room,other)||j<=i&&other.wingId===wing.id&&other===room)));
      }
    }
    add('braziersMatchWings',plan.totalBraziers===plan.totalWings);
    return checks;
  }
  return Object.freeze({DEFAULTS,compose,verify,snap,intersects});
});
