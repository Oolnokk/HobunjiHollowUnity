// Reaching Obelisks — one selectable, deliberately non-linear shaft traversal method.
// The generator owns exact unbuffed ballistic catch windows; the runtime owns moving
// support, climb surfaces, targets, death-pit art, and complete scoped teardown.
(function(root,factory){
  const cjs=typeof module==='object'&&module.exports;
  const api=factory(cjs?require('./cell-grid-3d.js'):root.CellGrid3D);
  if(cjs)module.exports=api;else root.RuinReachingObelisks=api;
})(typeof self!=='undefined'?self:globalThis,function(Grid){
  'use strict';
  const GRAVITY=13; // Shared unpowered flight acceleration from RopeLaunch/Shattercasks.
  const UNBUFFED_MOVE_PX_S=238; // game.js base MOVE_SPEED, also documented in companion-movement-speed.js.
  const TILE_PIXELS=55; // Common player tile coordinate scaling; the test ruin projects one world cell per tile.
  const UNBUFFED_SPEED=UNBUFFED_MOVE_PX_S/TILE_PIXELS*.81; // Safe 19% allowance for acceleration and input delay, with no speed buffs.
  const SIZE=4; // Every obelisk is a four-cell-wide solid rectangular column with a four-cell mantle top.
  const DEATH_DEPTH=8; // Pit bottom sits below the entire ground-story gallery.
  const TRAVERSAL='reachingObelisks';
  const SIDES={N:{inX:0,inZ:1,tX:1,tZ:0},E:{inX:-1,inZ:0,tX:0,tZ:1},
    S:{inX:0,inZ:-1,tX:-1,tZ:0},W:{inX:1,inZ:0,tX:0,tZ:-1}};
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const fallDistanceForTiles=(tiles,speed=UNBUFFED_SPEED,gravity=GRAVITY)=>{
    if(!(speed>0)||!(gravity>0)||!(tiles>=0))throw new Error('Invalid obelisk fall physics.');
    return gravity*.5*Math.pow(tiles/speed,2);
  };
  const catchDepthForGap=gap=>Math.ceil(fallDistanceForTiles(gap+0.8)+1.5); // One reach radius plus a 1.5-cell reaction cushion.
  const random=seed=>{let s=(seed>>>0)||1;return()=>{s=(s+0x6d2b79f5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;}};
  const inside=(p,x,z,pad=0)=>Math.abs(x-p.x)<=SIZE/2+pad&&Math.abs(z-p.z)<=SIZE/2+pad;
  const gap=(a,b)=>Math.max(0,Math.hypot(a.x-b.x,a.z-b.z)-SIZE);
  // Per story: A starts lowered against the upper gallery; D's strand becomes
  // usable when A's plate rotates its climb faces. C sees B's back-mounted
  // target, whereas an archer on A faces the target's hidden (rear) side.
  function compose(options={}){
    const o={shaft:45,wall:8,spacing:16,floors:4,seed:1,originX:0,originZ:0,baseY:0,balconySides:['N','E','S','W'],...options};
    if(!Number.isInteger(o.spacing)||o.spacing<12||o.shaft<37||o.floors<2||o.floors>5)throw new Error('Reaching Obelisks requires a spacious, high shaft.');
    const mid=o.wall+(o.shaft-1)/2,edge=7; // Whole-cell facings align with the stone geometry.
    const point=(side,inward,lateral)=>{const d=SIDES[side];
      const base={N:{x:mid,z:o.wall},E:{x:o.wall+o.shaft-1,z:mid},
        S:{x:mid,z:o.wall+o.shaft-1},W:{x:o.wall,z:mid}}[side];
      return {x:base.x+d.inX*(edge+inward)+d.tX*lateral,
        z:base.z+d.inZ*(edge+inward)+d.tZ*lateral};
    };
    const rng=random(o.seed^0xa487351d),pillars=[],targets=[],plates=[],routes=[];
    const toWorld=(point)=>({x:o.originX+point.x,z:o.originZ+point.z});
    for(let story=0;story<o.floors-1;story++){
      const side=o.balconySides[story];if(!SIDES[side])throw new Error('Obelisk ascent missing a balcony side.');
      const base=o.baseY+story*o.spacing,landing=base+o.spacing;
      const jitter=(rng()<.5?-1:1); // Small seeded sideward variation, retained across the story's solution graph.
      const positions={
        A:point(side,0,0),
        D:point(side,6,5*jitter),
        C:point(side,13,7*jitter),
        B:point(side,13,1*jitter),
      };
      const heights={A:[base+8,landing],B:[base+7,base+11],C:[base+2,base+2],D:[base+5,base+5]};
      const byName={};
      for(const name of ['A','B','C','D']){
        const p=positions[name],id='obelisk-f'+story+'-'+name;
        const result={id,name,story,side,...toWorld(p),width:SIZE,bottomY:o.baseY-DEATH_DEPTH,
          lowY:heights[name][0],highY:heights[name][1],topY:heights[name][0],
          moving:name==='A'||name==='B',rotation:0,rotationTarget:0,active:false};
        byName[name]=result;pillars.push(result);
      }
      const a=byName.A,b=byName.B,c=byName.C,d=byName.D;
      // C is reached by descending from A via D, never by an invisible ground shortcut;
      // the D→A catch is gated by A's rotation rather than an invisible switch.
      const segments=[[a,d], [d,c], [c,d], [d,a], [a,'gallery']];
      const flights=segments.filter(pair=>typeof pair[0]==='object'&&typeof pair[1]==='object').map(pair=>{
        const horizontalGap=gap(pair[0],pair[1]),minimumDepth=catchDepthForGap(horizontalGap);
        return {from:pair[0].id,to:pair[1].id,gap:horizontalGap,
          freeFall:fallDistanceForTiles(horizontalGap+.8),requiredCatchDepth:minimumDepth};
      });
      // Spiral bands extend far enough below the tops for a no-buff airborne
      // player to reach the next face before dropping past the last grip.
      for(const p of [a,b,c,d]){
        p.catchDepth=Math.max(Math.ceil(o.spacing*.55),...flights.filter(f=>f.to===p.id).map(f=>f.requiredCatchDepth));
        p.catchDepth=Math.min(15,p.catchDepth); // Keeps each spiral on the upper half of its own tall body.
      }
      const plate={id:'obelisk-f'+story+'-rotate-A',pillarId:a.id,story,holdSeconds:.45,rotates:90};
      const switchA={id:'obelisk-f'+story+'-raise-A',pillarId:b.id,controls:a.id,
        story,face:'towardC',normal:{x:Math.sign(c.x-b.x),z:Math.sign(c.z-b.z)}};
      const switchB={id:'obelisk-f'+story+'-raise-B',pillarId:c.id,controls:b.id,
        story,face:'towardD',normal:{x:Math.sign(d.x-c.x),z:Math.sign(d.z-c.z)}};
      plates.push(plate);targets.push(switchA,switchB);
      routes.push({story,side,entryY:base,exitY:landing,
        states:['A lowered: climb from the gallery onto its plate','A rotated: descend through D to C','C: shoot B target from its visible face',
          'D: grab A rotated strand','A raised: step to the upper gallery'],
        flights,requires:[plate.id,switchA.id],galleryPillarId:a.id,approachPillarId:c.id});
    }
    const plan={method:TRAVERSAL,options:o,pillars,targets,plates,routes,
      pit:{bottomY:o.baseY-DEATH_DEPTH,style:'tradition',depth:DEATH_DEPTH},
      physics:{gravity:GRAVITY,unbuffedSpeed:UNBUFFED_SPEED,fallPerTile:fallDistanceForTiles(1)}};
    plan.checks=verify(plan);plan.ok=plan.checks.every(c=>c.ok);
    return plan;
  }
  function verify(plan){
    const checks=[],add=(name,ok,detail)=>checks.push({name,ok:!!ok,detail:detail||''});
    for(const route of plan.routes){
      const p=plan.pillars.filter(p=>p.story===route.story),a=p.find(p=>p.name==='A'),b=p.find(p=>p.name==='B'),c=p.find(p=>p.name==='C'),d=p.find(p=>p.name==='D');
      add('story'+route.story+'-complete',!!(a&&b&&c&&d&&route.requires.length===2));
      add('story'+route.story+'-raise-reaches-gallery',Math.abs(a.highY-route.exitY)<.01);
      add('story'+route.story+'-hidden-switch',plan.targets.some(t=>t.controls===a.id&&t.pillarId===b.id&&t.normal.x*(a.x-b.x)+t.normal.z*(a.z-b.z)<0));
      for(const f of route.flights){
        const dest=plan.pillars.find(p=>p.id===f.to);
        add('catch-'+f.from+'-'+f.to,!!dest&&f.requiredCatchDepth<=dest.catchDepth&&dest.catchDepth<=15,
          'fall '+f.freeFall.toFixed(2)+' tiles, catch depth '+(dest?.catchDepth||0));
      }
    }
    add('death-below-entry',plan.pit.bottomY<plan.options.baseY);
    add('unique-ids',new Set(plan.pillars.map(p=>p.id)).size===plan.pillars.length);
    return checks;
  }
  // Every band is two wall tiles wide and two wall tiles tall. Successive
  // bands turn a corner, forming four wrapping, descending strands. Unlike the
  // old evenly spaced hub holds these segments occupy only the upper pillar.
  function climbFaces(pillar,topY=pillar.topY,rotation=pillar.rotation){
    const start=Math.ceil(topY-pillar.catchDepth),end=Math.floor(topY),faces=[];
    const left=Math.round(pillar.x-SIZE/2),back=Math.round(pillar.z-SIZE/2);
    const normals=[Grid.DIR.N,Grid.DIR.W,Grid.DIR.S,Grid.DIR.E];
    // Two tile wide winding bands: on each successive vertical cell the
    // band advances one tile along its face, then crosses the exact shared
    // corner onto the next face. A two-row strip stays connected all the way
    // from its lowest catch point to the mantle lip.
    for(let y=start;y<end;y++){
      const descent=end-y-1,phase=Math.floor(descent/3),turn=(phase+rotation)%4;
      const along=descent%3;
      for(let step=0;step<2;step++){
        let c=left,r=back;
        if(turn===0)c=left+(2-along)+step; // N: east to west
        if(turn===1)r=back+along+step;     // W: north to south
        if(turn===2){r=back+SIZE-1;c=left+along+step;} // S: west to east
        if(turn===3){c=left+SIZE-1;r=back+(2-along)+step;} // E: south to north
        faces.push({c,r,l:y,dir:normals[turn],style:'obelisk-stone'});
      }
    }
    return Grid.mergeClimbFaces(faces);
  }
  const traditionOf=value=>{
    const text=String(value||'').toLowerCase();
    return text.includes('tothal')?'tothal':text.includes('kanthic')?'kanthic':'hronal';
  };
  function mount(plan,deps={}){
    if(!plan?.ok)throw new Error('Cannot mount an unverified obelisk route.');
    const {THREE,DynamicSurfaces:DS,ClimbSurfaces:CS,parent,getPlayerPosition,getPlayerY}=deps;
    if(!THREE?.Group||!parent?.add||!DS?.registerSurface||!CS?.register)throw new Error('Obelisk runtime dependencies are missing.');
    const scope=deps.scope||'shaft-obelisks',group=new THREE.Group(),owned=[],materials=[],links=[];
    const basic=color=>{const mat=new THREE.MeshBasicMaterial({color});materials.push(mat);return mat;};
    const stone=root.ProceduralFurniture?.makePartMaterial?.({materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#726d63'})||basic(0x726d63);
    if(!materials.includes(stone))materials.push(stone);
    const red=basic(0xe93d33),green=basic(0x46e75c),plateMat=basic(0x9b8778);
    group.name='reaching-obelisks';parent.add(group);
    const columns=new Map(),states=new Map(),plateStates=new Map();let elapsed=0,disposed=false,linked=false;
    const mesh=(geo,mat,name,holder)=>{
      const node=new THREE.Mesh(geo,mat);node.name=name;(holder||group).add(node);owned.push(node);return node;
    };
    const pitY=plan.pit.bottomY;
    const base=plan.options,side=base.wall,lo=base.originX+side,hi=lo+base.shaft,
      nearZ=base.originZ+side,farZ=nearZ+base.shaft;
    // The basin is lower than the first story, with no support on its face.
    const inner=base.shaft-10,pitSize=inner;
    const basin=mesh(new THREE.BoxGeometry(pitSize,.4,pitSize),basic(0x211c1b),'obelisk-death-pit');
    basin.position.set(base.originX+side+base.shaft/2,pitY-.22,base.originZ+side+base.shaft/2);
    const tradition=traditionOf(deps.tradition);
    const plane=mesh(new THREE.PlaneGeometry(pitSize,pitSize),tradition==='hronal'?basic(0xff4215)
      :tradition==='tothal'?basic(0xb7ecfa):basic(0x241536),'obelisk-'+tradition+'-hazard');
    plane.rotation.x=-Math.PI/2;plane.position.set(basin.position.x,pitY+(tradition==='kanthic'?.22:.03),basin.position.z);
    if(tradition==='tothal'&&root.IceStalagmiteCoverage?.build){
      const ice=root.IceStalagmiteCoverage;const tempMaterial=basic(0xffffff);
      tempMaterial.transparent=true;tempMaterial.opacity=0;tempMaterial.depthWrite=false;
      const chunk=8,half=pitSize/2,baseX=basin.position.x-half,baseZ=basin.position.z-half;
      for(let dz=0;dz<pitSize;dz+=chunk)for(let dx=0;dx<pitSize;dx+=chunk){
        const source=new THREE.Group();
        for(let zz=dz;zz<Math.min(pitSize,dz+chunk);zz++)for(let xx=dx;xx<Math.min(pitSize,dx+chunk);xx++){
          const cube=new THREE.Mesh(new THREE.BoxGeometry(1,.02,1),tempMaterial);
          cube.position.set(xx+.5,0,zz+.5);
          cube.userData.authoredPartId='ice-death-cube-'+xx+'-'+zz;
          source.add(cube);
        }
        const growth=ice.build(THREE,source,{kind:'iceStalagmites',seed:base.seed+dx*131+dz*17,
          count:Math.min(64,source.children.length),density:1,iceCluster:3,radius:.28,
          iceHeightMin:.65,iceHeightMax:2.2,iceRoughness:.27,iceOpacity:.92,color:'#c2e8fb',
          iceEngulf:.45,iceFootprintPadding:.06,iceFacets:5,iceTipSharpness:.84,iceLean:.14,
          target:'all'});
        growth.position.set(baseX+dx,pitY+.04,baseZ+dz);group.add(growth);
        growth.traverse(node=>{if(node.isMesh)owned.push(node);});
        for(const cube of source.children)cube.geometry.dispose();
      }
    }
    for(const pillar of plan.pillars){
      const holder=new THREE.Group();holder.name=pillar.id;holder.position.set(pillar.x,pillar.topY,pillar.z);group.add(holder);
      const shaft=mesh(new THREE.BoxGeometry(SIZE,1,SIZE),stone,pillar.id+'-stone',holder);
      const record={...pillar,holder,shaft,y:pillar.lowY,desiredY:pillar.lowY,worldFaces:[],baseY:pillar.bottomY,rotation:0};
      columns.set(pillar.id,record);
      DS.registerSurface({id:scope+'-'+pillar.id,scope,topY:()=>record.y,priority:4,
        bounds:{minX:pillar.x-SIZE/2,maxX:pillar.x+SIZE/2,minZ:pillar.z-SIZE/2,maxZ:pillar.z+SIZE/2}});
      const updateShape=()=>{
        holder.position.y=record.y;holder.rotation.y=record.rotation*Math.PI/2;
        const height=Math.max(.1,record.y-record.baseY);shaft.scale.y=height;shaft.position.y=-height/2;
      };
      record.updateShape=updateShape;updateShape();
    }
    // The climb registrations keep their normalized references, so a moving
    // pillar can carry climbable faces without unregister/re-register churn.
    const refreshFaces=record=>{
      for(const entry of record.worldFaces){CS.remove(entry.id);entry.visual?.parent?.remove(entry.visual);
        entry.visual?.traverse(n=>{n.geometry?.dispose();if(n.material&&!materials.includes(n.material))n.material.dispose();});}
      record.worldFaces=[];
      for(const [i,face] of climbFaces(record,Math.round(record.y),record.rotation).entries()){
        const id=scope+'-climb-'+record.id+'-'+i;
        const normalized=CS.register({...face,id,scope});
        const visual=CS.buildVisual?.(THREE,normalized);
        if(visual){visual.name=id;group.add(visual);} // buildVisual is already in world coordinates.
        record.worldFaces.push({id,surface:normalized,visual});
      }
    };
    for(const record of columns.values())refreshFaces(record);
    for(const plate of plan.plates){
      const record=columns.get(plate.pillarId);
      const node=mesh(new THREE.BoxGeometry(2,.15,2),plateMat,plate.id,record.holder);
      node.position.y=.09;node.userData.devRuinFootprintIgnore=true;
      plateStates.set(plate.id,{...plate,pillar:record,node,seconds:0,triggered:false});
    }
    for(const target of plan.targets){
      const pillar=columns.get(target.pillarId),controls=columns.get(target.controls);
      const toward={x:target.normal.x,z:target.normal.z};
      const length=Math.hypot(toward.x,toward.z)||1;
      const offset={x:toward.x/length*(SIZE/2+.12),z:toward.z/length*(SIZE/2+.12)};
      const rune=mesh(new THREE.BoxGeometry(.75,.75,.75),red,target.id,pillar.holder);
      rune.position.set(offset.x,-1.3,offset.z);
      rune.userData.devRuinProjectileTarget=true; rune.userData.devRuinFootprintIgnore=true;
      const state={id:target.id,object:rune,hitMesh:rune,active:false,
        hittable:()=>{
          const pos=getPlayerPosition?.(),y=Number(getPlayerY?.());
          if(disposed||!pos||!Number.isFinite(y)||Math.abs(y-(pillar.y-1.3))>base.spacing*.8)return false;
          // Targets on B face away from A; this physical front-face test also
          // prevents the shaft's vertical floors from shooting through walls.
          return (pos.x-rune.getWorldPosition(new THREE.Vector3()).x)*offset.x+
            (pos.z-rune.getWorldPosition(new THREE.Vector3()).z)*offset.z>0;
        },
        onHit:()=>{
          if(!state.hittable())return false;
          state.active=!state.active;controls.desiredY=state.active?controls.highY:controls.lowY;
          rune.material=state.active?green:red;
          deps.onStateChange?.();return true;
        },
        controls:controls.id,pillarId:pillar.id};
      states.set(state.id,state);
    }
    const link=()=>{
      if(linked||disposed)return;
      const bus=deps.projectileBus||root.DevRandomRuinSimplePuzzles;
      if(bus?.hasActiveRuinState?.()!==true)return;
      const next=[];for(const state of states.values()){
        const remove=bus.registerExternalProjectileTarget?.(state);
        if(typeof remove!=='function')break;
        next.push(remove);
      }
      if(next.length===states.size){links.push(...next);linked=true;deps.onStateChange?.();}
      else for(const remove of next)remove();
    };
    const turnPillar=plate=>{
      const record=plate.pillar;
      record.rotation=(record.rotation+1)%4;record.rotationTarget=record.rotation;
      refreshFaces(record);record.updateShape();
      plate.node.material=green;plate.triggered=true;deps.onStateChange?.();
    };
    const tick=dt=>{
      if(disposed)return;
      const elapsedStep=clamp(Number(dt)||0,0,.05);elapsed+=elapsedStep;link();
      for(const pillar of columns.values()){
        if(Math.abs(pillar.y-pillar.desiredY)>.0001){
          const oldY=pillar.y;
          pillar.y+=clamp(pillar.desiredY-pillar.y,-elapsedStep*2.5,elapsedStep*2.5);
          pillar.updateShape();
          const delta=pillar.y-oldY;
          // Keep the SAME surface objects while the obelisk moves: an attached
          // climber never loses its handhold when the supporting pillar rises.
          for(const entry of pillar.worldFaces){entry.surface.y0+=delta;entry.surface.y1+=delta;
            if(entry.visual)entry.visual.position.y+=delta;}
        }
      }
      const pos=getPlayerPosition?.(),y=Number(getPlayerY?.());
      for(const plate of plateStates.values()){
        if(plate.triggered)continue;
        const on=pos&&Number.isFinite(y)&&inside(plate.pillar,pos.x,pos.z,.05)
          &&Math.abs(plate.pillar.y-y)<.65;
        plate.seconds=on?plate.seconds+elapsedStep:0;
        if(plate.seconds>=plate.holdSeconds)turnPillar(plate);
      }
    };
    const centerX=basin.position.x,centerZ=basin.position.z;
    const isVoidAt=(x,z)=>Math.abs(x-centerX)<pitSize/2&&Math.abs(z-centerZ)<pitSize/2;
    const supportAt=(x,z,fromY=Infinity)=>{
      let best=null;
      for(const p of columns.values()){
        if(!inside(p,x,z,-.08)||p.y>fromY+.5)continue;
        if(!best||p.y>best.y)best={id:scope+'-'+p.id,y:p.y,pillar:p};
      }
      return best;
    };
    const dispose=()=>{
      if(disposed)return;disposed=true;
      for(const remove of links)remove();
      DS.clearScope(scope);CS.clearScope(scope);
      group.parent?.remove(group);
      for(const node of owned)node.geometry?.dispose?.();
      const extra=new Set();group.traverse(node=>{if(node.material&&!materials.includes(node.material))extra.add(node.material);});
      extra.forEach(mat=>mat.dispose?.());for(const mat of materials)mat.dispose?.();
      columns.clear();states.clear();plateStates.clear();
    };
    return {plan,method:TRAVERSAL,tick,dispose,columns,targets:states,plates:plateStates,
      supportAt,isVoidAt,isDeathAt:(x,z,y)=>isVoidAt(x,z)&&Number(y)<=pitY+.15,
      pitY,tradition,getState:()=>({method:TRAVERSAL,linked,targets:states.size,
        activated:[...states.values()].filter(t=>t.active).length,rotated:[...plateStates.values()].filter(p=>p.triggered).length,
        moving:[...columns.values()].filter(p=>Math.abs(p.y-p.desiredY)>.01).length,pit:tradition,gravity:GRAVITY,fallPerTile:plan.physics.fallPerTile})};
  }
  return Object.freeze({TRAVERSAL,GRAVITY,UNBUFFED_SPEED,SIZE,DEATH_DEPTH,fallDistanceForTiles,catchDepthForGap,climbFaces,compose,verify,mount,traditionOf});
});
