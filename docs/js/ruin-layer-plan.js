// RuinLayerPlan — sparse 2D dungeon floors snapped around multi-level rooms.
// Shared geometry coordinates; each floor owns its own independent network.
// Nothing renders or teleports here. Runtime geometry/puzzles must consume this plan.
(function(root,factory) {
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinLayerPlan=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const ropeGeometry=()=>root.RuinRopeGeometry||(typeof require==='function'?require('./ruin-rope-geometry.js'):null); // Browser loads RopeCore after this module: resolve only when composing.
  const DIRS=Object.freeze([
    {side:'N',dx:0,dz:-1},{side:'E',dx:1,dz:0},
    {side:'S',dx:0,dz:1},{side:'W',dx:-1,dz:0},
  ]);
  const TRAVERSAL_METHODS=Object.freeze(['reachingObelisks']); // Expand this list as distinct complete shaft methods are authored.
  // Ruin size by rarity. `centralScale` shrinks only the empty central chamber
  // (the 35-cell space inside the 5-cell balcony galleries); the galleries keep
  // their thickness, so shaftSize = central + 2 * GALLERY_WIDTH. `wings` is the
  // TOTAL across the ruin (one brazier each); `wingRooms` counts the brazier
  // chamber (2 = one puzzle + brazier, 3 = two puzzles + brazier).
  const GALLERY_WIDTH=5,FULL_CENTRAL=35;
  const TIERS=Object.freeze({
    cave:Object.freeze({floors:2,centralScale:.375,wings:3,wingRooms:2,floorHeight:6}),
    hole:Object.freeze({floors:3,centralScale:.75,wings:4,wingRooms:3,floorHeight:10}),
    lich:Object.freeze({floors:4,centralScale:1.125,wings:5,wingRooms:3,floorHeight:12}),
  });
  // Wings are spread as evenly as possible with the remainder on the upper
  // floors (ground floor loses one side to the entrance, so it is capped at 3).
  function distributeWings(total,floors,groundCap=3){
    const counts=Array.from({length:floors},()=>Math.floor(total/floors));
    for(let extra=total-counts.reduce((a,b)=>a+b,0),f=floors-1;extra>0;extra--,f=(f-1+floors)%floors)counts[f]++;
    if(counts[0]>groundCap){counts[floors-1]+=counts[0]-groundCap;counts[0]=groundCap;}
    return counts;
  }
  function tierOptions(tier){
    const t=TIERS[tier];
    if(!t)return null;
    const central=Math.max(5,Math.round(FULL_CENTRAL*t.centralScale));
    return {
      minFloors:t.floors,maxFloors:t.floors,
      shaftSize:(central+2*GALLERY_WIDTH)|1,
      floorHeight:t.floorHeight,
      wingsPerFloor:distributeWings(t.wings,t.floors),
      minChallenges:t.wingRooms-1,maxChallenges:t.wingRooms-1,
      nativeV50:false, // Native V50 upper floors would add unaccounted rooms and braziers; tiers specify exact counts.
      shaftTraversal:'jumpPlatforms',
      tier,
    };
  }
  const PLAYABLE_PUZZLES=Object.freeze(['pressurePlate','glyphObelisk','ceilingRailTargets','timedMelody','dungeonFire','ropeChain','statueDefense','findBlocks']); // Shared by composer and acceptance proof.
  const RANGED_PUZZLES=Object.freeze(['glyphObelisk','ceilingRailTargets']); // Every wing includes at least one actual ranged stage.
  const DEFAULTS=Object.freeze({
    spacing:64, // World cells between invisible multi-floor anchor slots; normal rooms fit between them.
    shaftSize:45, // Giant obelisk chamber; shell spans 45 + 2*shaftWall cells.
    shaftWall:8, // Matches ShaftHub's real shell thickness; door ends must be outside this wall.
    portalOffset:8, // Side-wall wing doors sit away from the climbing buttresses.
    floorHeight:16, // Dramatically taller continuous drops between independent puzzle floors.
    minFloors:3,maxFloors:5,minWings:4,maxWings:4, // Fill every free shaft wall exit; the entrance and native V50 keep their own portals.
    wingsPerFloor:null, // Optional exact wing count for each floor (see TIERS); overrides minWings/maxWings.
    tier:null,
    theme:null, // The ruin's tradition (tothal | hronal | kanthic): fire-and-ice puzzles belong to Tothal only.
    minChallenges:1,maxChallenges:2, // Divide the same puzzle load into shorter independent branches, each with its own fire.
    corridorWidth:3,
    seed:1,
    nativeV50:false, // When enabled, upper stories reserve one EAST shaft portal for an independently generated V50 room graph.
    groundEntranceSide:null, // The one-room V50 vestibule claims this shaft wall; no puzzle wing may occupy the same portal.
    shaftTraversal:null, // Seed-selected from TRAVERSAL_METHODS unless explicitly supplied for testing.
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
    const baseline=composeLayout(options);
    if(!options.plinthTrial)return baseline;
    const slots=baseline.floors.flatMap(floor=>floor.rooms.filter(room=>room.kind==='challenge-room')); // Every ordinary wing challenge slot is eligible.
    const pick=random((Number(options.seed)^0x452b9813)>>>0); // Separate from layout RNG so the replacement keeps the same topology.
    return composeLayout(options,slots[integer(pick,0,slots.length-1)].id);
  }
  function composeLayout(options,trialRoomId=null){
    const o={...DEFAULTS,...options};
    o.spacing=Math.max(48,Math.min(128,Math.round(Number(o.spacing)||DEFAULTS.spacing)));
    o.shaftSize=Math.max(17,Math.min(o.spacing-12,(Math.round(Number(o.shaftSize)||33)|1)));
    o.minFloors=Math.max(2,Math.min(5,o.minFloors|0)); // Cave ruins have two stories.
    o.maxFloors=Math.max(o.minFloors,Math.min(5,o.maxFloors|0));
    o.minWings=Math.max(1,Math.min(4,o.minWings|0));
    o.maxWings=Math.max(o.minWings,Math.min(4,o.maxWings|0));
    o.minChallenges=Math.max(1,Math.min(4,o.minChallenges|0));
    o.maxChallenges=Math.max(o.minChallenges,Math.min(4,o.maxChallenges|0));
    o.corridorWidth=3;
    o.nativeV50=o.nativeV50===true; // Non-native story vaults and existing standalone floor tests preserve their original layout.
    o.groundEntranceSide=['N','E','S','W'].includes(o.groundEntranceSide)?o.groundEntranceSide:null;
    o.shaftWall=Math.max(5,Math.min(12,Math.round(Number(o.shaftWall)||8)));
    o.portalOffset=Math.max(1,Math.min(8,Math.round(Number(o.portalOffset)||8)));
    o.floorHeight=Math.max(o.tier?6:12,Math.min(32,Math.round(Number(o.floorHeight)||DEFAULTS.floorHeight)));
    o.portalOffset=Math.max(1,Math.min(o.portalOffset,Math.floor((o.shaftSize-1)/2)-Math.floor(o.shaftSize*.19)-2)); // Must match ShaftHub's own wing-door offset on a small shaft.
    if(o.shaftTraversal!=='buttress'&&o.shaftTraversal!=='jumpPlatforms'&&!TRAVERSAL_METHODS.includes(o.shaftTraversal))
      o.shaftTraversal=TRAVERSAL_METHODS[Math.floor(random((o.seed^0x85bd7ca1)>>>0)()*TRAVERSAL_METHODS.length)]; // Does not perturb wing layout RNG.
    const rng=random(o.seed);
    const floorCount=integer(rng,o.minFloors,o.maxFloors); // Used to bound both the shared shaft and independent 2D floor maps.
    // A shaft reserves the same snapped invisible-grid slot on ALL floor layers.
    const cx=snap(Number.isFinite(Number(o.anchorX))?Number(o.anchorX):o.spacing*5,o.spacing);
    const cz=snap(Number.isFinite(Number(o.anchorZ))?Number(o.anchorZ):o.spacing*5,o.spacing);
    const shaft=rect(cx,cz,o.shaftSize,o.shaftSize);
    shaft.shape='octagon';shaft.floors=floorCount;
    shaft.anchor={x:cx,z:cz};
    const floors=[];
    // ONLY puzzle families backed by an implemented real runtime may be
    // selected. Advanced rope/defence/fire variants will be added as their
    // actual mechanics are integrated, never disguised as plain floor plates.
    const puzzles=PLAYABLE_PUZZLES.filter(type=>type!=='statueDefense'&&type!=='findBlocks'&&(type!=='dungeonFire'||!o.theme||o.theme==='tothal')); // Oversized compound rooms are selected before dimensions are calculated, not from the small solo-room pool. // Ordinary-size rooms cannot fit the authored enemy pillars, so they exclude the oversized objective.
    const rangedPuzzles=RANGED_PUZZLES;
    for(let floor=0;floor<floorCount;floor++){
      const y=floor*o.floorHeight; // Physical y datum for this otherwise ordinary 2D map.
      const nativePort=o.nativeV50&&floor>0?{
        floor,side:'E',x:cx+Math.floor((o.shaftSize+o.shaftWall*2)/2),
        z:cz+o.portalOffset,y,kind:'native-v50',
      }:null; // Reserved BEFORE V50 renders another native room/hallway graph.
      if(nativePort){
        // Every upper V50 floor owns a fixed 180x180 eastern allocation
        // BEFORE any room graphs are generated. The eventual V50 scene may
        // occupy a smaller rectangle inside it, never another wing's space.
        const maxNativeExtent=180; // Maximum accepted V50 footprint in RuinV50NativeFloors.layoutPlacement.
        nativePort.reservation={x:nativePort.x+28,
          z:Math.max(8,Math.floor(nativePort.z-maxNativeExtent/2)),
          w:maxNativeExtent,d:maxNativeExtent};
      }
      const shuffled=DIRS.map(d=>({d,roll:rng()})).sort((a,b)=>a.roll-b.roll).map(x=>x.d)
        .filter(d=>(!nativePort||d.side!==nativePort.side)&&(floor!==0||d.side!==o.groundEntranceSide));
      const maxCustomWings=Math.min(shuffled.length,nativePort?Math.min(3,o.maxWings-1):o.maxWings);
      const minCustomWings=Math.min(maxCustomWings,nativePort?Math.max(0,o.minWings-1):o.minWings);
      const fixedWings=Array.isArray(o.wingsPerFloor)&&Number.isInteger(o.wingsPerFloor[floor])?o.wingsPerFloor[floor]:null;
      const wingCount=fixedWings!==null?Math.min(maxCustomWings,Math.max(0,fixedWings)):integer(rng,minCustomWings,maxCustomWings), wings=[],rooms=[],hallways=[],doorways=[],braziers=[]; // Each free exit is a separate fire objective, not another room added to a long corridor.
      rooms.push({id:`shaft-f${floor}`,kind:'shaft',...shaft,y,anchor:shaft.anchor,shared:true}); // Same x/z on every layer; unique floor-local room.
      for(let wi=0;wi<wingCount;wi++){
        const dir=shuffled[wi],challengeCount=Math.min(o.maxChallenges,Math.max(o.minChallenges,wi===0?o.maxChallenges:integer(rng,o.minChallenges,o.maxChallenges))); // First wing keeps the classic plate→ranged progression; the other exits get 1–2-room branches.
        const wingId=`floor${floor}-${dir.side}`, nodes=[], corridors=[];
        const lateral=dir.dx!==0?{dx:0,dz:1}:{dx:1,dz:0};
        // Only the multi-floor shaft snaps to the invisible anchor grid.
        // Rather than putting four puzzles in series, branch their rooms across
        // the same story's other shaft exits. Every branch ends at another brazier;
        // ordinary 3–6-tile connectors remain physically walkable.
        const outerRadius=Math.floor((o.shaftSize+o.shaftWall*2)/2);
        const portal={x:cx+dir.dx*outerRadius+lateral.dx*o.portalOffset,
          z:cz+dir.dz*outerRadius+lateral.dz*o.portalOffset};
        let previous={...portal}; // Far wall of the last room, initially the shaft portal threshold.
        for(let stage=1;stage<=challengeCount+1;stage++){ // One or two authored puzzles per shaft exit, followed by one required brazier.
          const isGoal=stage===challengeCount+1;
          // A room is a room: every puzzle room draws from the WHOLE implemented set, whatever its position in the wing.
          // Only two soft rules: the very first room of the ground floor's lead wing is the gentle pressure-plate
          // tutorial, and a wing never repeats the previous room's puzzle back to back.
          const prevKind=nodes[stage-2]?.challenge||null;
          const tutorial=!isGoal&&floor===0&&wi===0&&stage===1;
          const roll=isGoal||tutorial?1:rng();
          const findBlocks=!isGoal&&!tutorial&&roll<.18&&prevKind!=='findBlocks'&&rooms.filter(r=>r.challenge==='findBlocks').length<2; // Needs a full 18x18 footprint.
          const defence=!isGoal&&!tutorial&&!findBlocks&&roll<.3&&prevKind!=='statueDefense'&&prevKind!=='findBlocks'; // Authored enemy pillars also need 18x18.
          const large=defence||findBlocks;
          let rw=large?18:(dir.dx?integer(rng,11,19):integer(rng,9,15));
          let rd=large?18:(dir.dz?integer(rng,11,19):integer(rng,9,15));
          const gap=integer(rng,3,6); // Short walk between consecutive puzzle rooms; no empty approach needs the old 7–15 cells.
          const offset=integer(rng,-2,2); // Lateral hallway variation stays independent of rope room sizing.
          const id=`${wingId}-room${stage}`;
          const smallPool=puzzles.filter(kind=>kind!==prevKind); // The authored small-puzzle families share one selectable pool.
          const challenge=isGoal?null:findBlocks?'findBlocks':defence?'statueDefense'
            :tutorial?'pressurePlate':smallPool[integer(rng,0,smallPool.length-1)];
          if(challenge==='ropeChain'){
            const math=ropeGeometry();
            if(!math)throw new Error('Ruin rope geometry must load before building puzzle rooms.');
            const dimensions=math.dimensions(dir.side); // Reserve the full unbuffed flight footprint before any floors and walls are built.
            rw=dimensions.w;rd=dimensions.d;
          }
          const depth=Math.floor((dir.dx?rw:rd)/2);
          const rx=previous.x+dir.dx*(gap+depth+1)+lateral.dx*offset;
          const rz=previous.z+dir.dz*(gap+depth+1)+lateral.dz*offset;
          const plinthTrial=id===trialRoomId;
          const area=plinthTrial?rect(rx+dir.dx*(9-depth),rz+dir.dz*(9-depth),18,18):rect(rx,rz,rw,rd); // Keep the planned approach gap while reserving room for the authored spawners.
          const room={id,kind:isGoal?'brazier-chamber':'challenge-room',...area,y,wingId,
            challenge:plinthTrial?'statueDefense':challenge};
          nodes.push(room);rooms.push(room);
          // Thresholds derive from the actual rectangle bounds, not the
          // conceptual centre. Even-width rooms otherwise leave a one-cell
          // invisible gap between their floors and the adjoining hallway.
          const door={
            x:dir.dx>0?area.x:dir.dx<0?area.x+area.w-1:Math.floor(area.x+area.w/2),
            z:dir.dz>0?area.z:dir.dz<0?area.z+area.d-1:Math.floor(area.z+area.d/2)
          };
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
          previous={
            x:dir.dx>0?area.x+area.w-1:dir.dx<0?area.x:Math.floor(area.x+area.w/2),
            z:dir.dz>0?area.z+area.d-1:dir.dz<0?area.z:Math.floor(area.z+area.d/2)
          };
          if(isGoal)braziers.push({id:`${wingId}-brazier`,wingId,roomId:id,
            x:rx,z:rz,y,requires:nodes.filter(n=>n.challenge).map(n=>n.id)});
        }
        wings.push({id:wingId,floor,side:dir.side,entry:{...portal,y},rooms:nodes,corridors,goalBrazierId:braziers[braziers.length-1].id});
      }
      floors.push({floor,y,anchor:{...shaft.anchor},rooms,hallways,doorways,wings,braziers,nativePort,entry:floor===0?{kind:'external-wing',side:o.groundEntranceSide||'S'}:null});
    }
    const plan={schema:'hobunji.ruin-layer-plan.v1',options:o,shaft,floorCount,floors,trialRoomId,
      totalWings:floors.reduce((n,f)=>n+f.wings.length,0),
      totalBraziers:floors.reduce((n,f)=>n+f.braziers.length,0),
      nativeFloorCount:floors.filter(f=>!!f.nativePort).length}; // Upper V50 native layouts are counted separately until their actual brazier is mounted.
    plan.checks=verify(plan);plan.ok=plan.checks.every(c=>c.ok);
    return plan;
  }
  function verify(plan){
    const checks=[],add=(name,ok)=>checks.push({name,ok:!!ok});
    add('floorRange',plan.floors.length>=2&&plan.floors.length<=5);
    if(plan.options.tier){
      const t=TIERS[plan.options.tier];
      add('tierFloors',plan.floors.length===t.floors);
      add('tierWings',plan.totalWings===t.wings);
      add('tierWingRooms',plan.floors.every(f=>f.wings.every(w=>w.rooms.length===t.wingRooms)));
    }
    add('shaftSnapped',plan.shaft.anchor.x%plan.options.spacing===0&&plan.shaft.anchor.z%plan.options.spacing===0);
    const first=plan.floors[0]?.anchor;
    for(const floor of plan.floors){
      add(`floor${floor.floor}-aligned`,floor.anchor.x===first.x&&floor.anchor.z===first.z);
      add(`floor${floor.floor}-wingCount`,floor.wings.length+(floor.nativePort?1:0)>=1&&floor.wings.length+(floor.nativePort?1:0)<=4);
      add(`floor${floor.floor}-uniqueSides`,new Set([...floor.wings.map(w=>w.side),...(floor.nativePort?[floor.nativePort.side]:[])]).size===floor.wings.length+(floor.nativePort?1:0));
      if(floor.floor===0&&plan.options.groundEntranceSide)
        add('groundEntranceClear',floor.wings.every(w=>w.side!==plan.options.groundEntranceSide));
      add(`floor${floor.floor}-nativeReserved`,!plan.options.nativeV50||floor.floor===0||!!floor.nativePort&&floor.nativePort.side==='E');
      if(floor.nativePort){
        const area=floor.nativePort.reservation; // The V50 allocation is fixed before the iframe generates this floor's room graph.
        add(`floor${floor.floor}-nativeAllocation`,!!area&&area.w===180&&area.d===180
          &&area.x>=floor.nativePort.x+28&&area.z>=0);
        add(`floor${floor.floor}-nativeClearance`,!!area&&floor.wings.every(wing=>
          wing.rooms.every(room=>!intersects(room,area))
          &&wing.corridors.every(hall=>hall.rects.every(rect=>!intersects(rect,area)))));
      }
      for(const wing of floor.wings){
        add(wing.id+'-challenges',wing.rooms.length>=2&&wing.rooms.length<=5);
        add(wing.id+'-playableMechanisms',wing.rooms.slice(0,-1).every(
          r=>PLAYABLE_PUZZLES.includes(r.challenge)
            &&(!['statueDefense','findBlocks'].includes(r.challenge)||r.w>=18&&r.d>=18))
);
        add(wing.id+'-portalConnected', wing.corridors[0]?.start.x===wing.entry.x&&wing.corridors[0]?.start.z===wing.entry.z);
        const shellRadius=Math.floor((plan.options.shaftSize+plan.options.shaftWall*2)/2);
        add(wing.id+'-clearShaft', wing.rooms.every(room=>!
          intersects(room,{x:plan.shaft.anchor.x-shellRadius,z:plan.shaft.anchor.z-shellRadius,w:shellRadius*2+1,d:shellRadius*2+1})));
        add(wing.id+'-braziers',floor.braziers.filter(b=>b.wingId===wing.id).length===1);
        add(wing.id+'-corridors',wing.corridors.length===wing.rooms.length&&wing.corridors.every(c=>
          c.length>0&&c.rects.length>=1&&c.rects.some(r=>inRect(c.start,r))&&
          c.rects.some(r=>inRect(c.end,r))&&c.rects.every((r,i)=>i===0||connectedRects(r,c.rects[i-1]))));
        add(wing.id+'-roomJunctions',wing.corridors.every((hall,i)=>
          hall.rects.some(r=>connectedRects(r,wing.rooms[i]))&&
          (i===0||hall.rects.some(r=>connectedRects(r,wing.rooms[i-1])))));
        add(wing.id+'-roomsSeparate',wing.rooms.every((room,i)=>floor.rooms.every((other,j)=>other.id===room.id||!intersects(room,other)||j<=i&&other.wingId===wing.id&&other===room)));
      }
    }
    add('braziersMatchWings',plan.totalBraziers===plan.totalWings);
    return checks;
  }
  return Object.freeze({DEFAULTS,TRAVERSAL_METHODS,TIERS,tierOptions,distributeWings,compose,verify,snap,intersects});
});
