// RuinRoomSystem — seamless room ownership, enclosure blueprints and Zelda-style enemy suspension.
// The ruin stays one scene. Story height, not the shared 2D tile map, disambiguates overlapping rooms.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinRoomSystem=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const SLEEP_AREA='__ruin_room_sleep__:'; // Used to let the existing updateHostiles area guard skip inactive-room actors.
  const DOOR_SPAN=3; // Every room entrance uses the generator's three-cell corridor aperture.
  const WALL_HEIGHT=3.6; // Supports the rope-chamber ceiling beams at +3.4 and covers upper projectile routes.
  const PROBE_PERIOD=.3; // Batches hostile ownership detection instead of scanning all hostiles every render frame.
  let live=null; // Shared by the lighting compositor and mobile diagnostics; cleared on dungeon disposal.

  const inside=(room,x,z)=>x>=room.x&&x<room.x+room.w&&z>=room.z&&z<room.z+room.d;
  const key=(x,z)=>x+','+z;
  function planRooms(plan,pitForRoom){
    const rooms=[],doors=[],errors=[],ids=new Set(); // Used to validate all generated room/door identities once per ruin build.
    for(const floor of plan?.floors||[])for(const wing of floor.wings||[]){
      for(let i=0;i<wing.rooms.length;i++){
        const source=wing.rooms[i],name=String(source.id||'');
        const entry=(floor.doorways||[]).find(port=>port.to===name);
        if(!name||ids.has(name)){errors.push('Duplicate or empty room id: '+name);continue;}
        ids.add(name);
        if(![source.x,source.z,source.w,source.d,floor.y].every(Number.isFinite)
          ||source.w<DOOR_SPAN+2||source.d<DOOR_SPAN+2){errors.push(name+': invalid room rectangle');continue;}
        const side=wing.side;
        const p=entry?.point;
        const correct=!!p&&(side==='E'?p.x===source.x
          :side==='W'?p.x===source.x+source.w-1
          :side==='S'?p.z===source.z
          :side==='N'?p.z===source.z+source.d-1:false);
        const across=side==='E'||side==='W'?'z':'x';
        const lo=source[across],hi=lo+source[across==='x'?'w':'d'];
        const centre=p?.[across];
        if(!correct||!Number.isInteger(centre)||centre-1<lo||centre+1>=hi){
          errors.push(name+': entrance not aligned with enclosed three-cell aperture');continue;
        }
        const pit=source.challenge==='ropeChain'?pitForRoom?.(source,side):null;
        if(source.challenge==='ropeChain'&&!pit){errors.push(name+': missing declared rope pit');continue;}
        const blocked=[]; // The one-cell-deep entrance partition leaves exactly the authored doorway unblocked.
        for(let coord=lo;coord<hi;coord++){
          if(Math.abs(coord-centre)<=1)continue;
          const x=across==='x'?coord:p.x,z=across==='z'?coord:p.z;
          blocked.push([x,z]);
        }
        const room={id:name,floor:floor.floor,y:floor.y,wingId:wing.id,side,
          kind:source.kind,challenge:source.challenge,x:source.x,z:source.z,w:source.w,d:source.d,
          pit,blocked,entry:{x:p.x,z:p.z,axis:across==='z'?'x':'z',span:DOOR_SPAN,
            line:across==='z'?p.x+.5:p.z+.5,across,centre,lo,hi},
          // Per-room values feed the unified darkness overlay, not additional Three.js lights.
          ambient:{darknessOffset:source.kind==='brazier-chamber' ? -.035 : 0,color:plan.options?.theme==='tothal'?[6,18,44]
            :plan.options?.theme==='hronal'?[20,7,2]:[0,0,0]},
        };
        rooms.push(room);
        doors.push({id:name+':entry',roomId:name,from:entry.from,to:name,floor:floor.floor,
          x:p.x+.5,z:p.z+.5,y:floor.y,axis:room.entry.axis,span:DOOR_SPAN,
          initiallyLocked:i>0});
      }
    }
    return {rooms,doors,errors,ok:errors.length===0};
  }

  function v50Rooms(meta,{originX=0,originZ=0,tileScale=2,y=0,prefix='v50',theme='hronal',supportYAt=null}={}){
    const cs=(Number(meta?.cellSize)||.5)*tileScale; // Matches nativeRoom and the original V50 2x horizontal projection, not a second tile grid.
    const color=theme==='tothal'?[6,18,44]:theme==='hronal'?[20,7,2]:[0,0,0];
    if(!(cs>0)||!Number.isFinite(cs))return [];
    return (meta?.rooms||[]).flatMap((raw,index)=>{
      const x=originX+Number(raw.col)*cs,z=originZ+Number(raw.row)*cs;
      const w=Number(raw.w)*cs,d=Number(raw.h)*cs;
      if(![x,z,w,d,y].every(Number.isFinite)||w<=0||d<=0)return [];
      return [{id:prefix+':'+String(raw.id||index),kind:'v50',floor:Math.round(y),
        y,wingId:null,challenge:null,x,z,w,d,
        supportYAt:typeof supportYAt==='function'?supportYAt:null, // V50 uses the floor's exact plateau height when deciding which room is awake.
        ambient:{darknessOffset:0,color}}];
    });
  }
  function projectedFloorArea(data){
    const p=data?.positions;
    if(!p?.length||p.length%12!==0)return 0; // Each merged quad consists of four vertices, preserving exact floor area.
    let area=0;
    for(let i=0;i<p.length;i+=12){
      const ax=p[i+3]-p[i],az=p[i+5]-p[i+2];
      const bx=p[i+9]-p[i],bz=p[i+11]-p[i+2];
      area+=Math.abs(ax*bz-az*bx);
    }
    return area;
  }
  function floorAudit(room,supportedCells){
    let expected=0,missing=0; // Checks only required floors; a rope pit is a deliberate open volume, not a missing tile.
    for(let z=room.z;z<room.z+room.d;z++)for(let x=room.x;x<room.x+room.w;x++){
      if(room.pit?.contains?.(x+.5,z+.5))continue;
      expected++;
      if(!supportedCells.has(key(x,z)))missing++;
    }
    return {roomId:room.id,expectedFloorTiles:expected,missingFloorTiles:missing,
      ceilingTiles:room.w*room.d,partitionTiles:room.blocked.length,
      deliberateVoidTiles:room.w*room.d-expected,ok:missing===0};
  }

  function wallAudit(room,walkable,wallsX,wallsZ){
    const xEdges=new Set((wallsX||[]).map(([x,z])=>x+','+z));
    const zEdges=new Set((wallsZ||[]).map(([x,z])=>x+','+z));
    let exposed=0,missing=0; // Checks the wall faces emitted by the wing mesher, not an unrelated rectangle outline.
    for(let z=room.z;z<room.z+room.d;z++)for(let x=room.x;x<room.x+room.w;x++){
      for(const [dx,dz,edges,ex,ez] of [
        [-1,0,zEdges,x,z+.5],[1,0,zEdges,x+1,z+.5],
        [0,-1,xEdges,x+.5,z],[0,1,xEdges,x+.5,z+1],
      ]){
        if(walkable.has(key(x+dx,z+dz)))continue; // Adjoining corridors are intentional entrances, not missing masonry.
        exposed++;
        if(!edges.has(ex+','+ez))missing++;
      }
    }
    return {roomId:room.id,exposedWallEdges:exposed,missingWallEdges:missing,ok:missing===0};
  }
  function makeShell({room,THREE,Faces,parent,material,supportedCells,grid,CG}){
    const audit=floorAudit(room,supportedCells); // Published by the owner; missing walkable support is a hard generation error.
    if(!audit.ok)throw new Error('Ruin room '+room.id+' has '+audit.missingFloorTiles+' missing floor tiles');
    if(!THREE?.Mesh||!Faces?.buildQuads||!Faces?.toGeometry)return {audit,meshes:[]}; // Headless fixtures can audit without a renderer.
    const rects=[{axis:'y',side:-1,plane:0,a0:0,a1:room.w,b0:0,b1:room.d}];
    const roofFaces=Faces.buildQuads(rects,{
      origin:{x:room.x,y:room.y+WALL_HEIGHT,z:room.z},size:{x:1,y:1,z:1},patch:{h:6,v:6},
    });
    const covered=projectedFloorArea(roofFaces); // A ceiling advertised in the room manifest must also exist as actual triangles.
    if(Math.abs(covered-room.w*room.d)>1e-3)throw new Error(
      'Ruin room '+room.id+' has an incomplete ceiling: '+covered+' of '+room.w*room.d);
    const roof=new THREE.Mesh(Faces.toGeometry(THREE,roofFaces),material);
    roof.name='ruin-room-ceiling-'+room.id;
    roof.userData.ruinRoomId=room.id;
    roof.userData.devRuinFootprintIgnore=true; // A ceiling never creates a fake collision floor or a ground-navigation tile.
    parent.add(roof);
    const e=room.entry;
    const runs=[{along:e.across,line:e.line,from:e.lo,to:e.centre-1},
      {along:e.across,line:e.line,from:e.centre+2,to:e.hi}]
      .filter(run=>run.to>run.from);
    const wall=new THREE.Mesh(Faces.toGeometry(THREE,Faces.buildEdgeWallQuads(runs,{
      y0:room.y,y1:room.y+WALL_HEIGHT,thickness:.14,patch:{h:6,v:6},
    })),material);
    wall.name='ruin-room-entry-partition-'+room.id;
    wall.userData.ruinRoomId=room.id;
    parent.add(wall);
    if(grid?.set&&CG?.KIND){
      for(const [x,z] of room.blocked){
        const c=grid.xToCol(x+.5),r=grid.zToRow(z+.5);
        for(let level=0;level<Math.min(4,grid.levels||4);level++)grid.set(c,r,level,CG.KIND.SOLID);
      }
    }
    return {audit,meshes:[roof,wall]};
  }

  function doorNear(player,door,wasOpen=false,playerY=player?.y){
    if(!player||!door||![player.x,player.z,door.x,door.z].every(Number.isFinite))return false;
    const floor=Number(door.y),height=Number(playerY);
    if(Number.isFinite(floor)&&Number.isFinite(height)&&Math.abs(height-floor)>WALL_HEIGHT+1)return false;
    // Preserve a traversable doorway during vertical jumps and during crossing; the open radius has hysteresis.
    return Math.hypot(player.x-door.x,player.z-door.z)<(wasOpen?3.5:2.8);
  }
  function roomAt(rooms,x,z,y){
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    let best=null,distance=Infinity;
    for(const room of rooms){
      if(!inside(room,x,z))continue;
      const localSupport=room.supportYAt?.(x,z); // V50 uses real per-cell plateau elevation rather than the nominal room origin.
      const baseY=Number.isFinite(localSupport)?localSupport:room.y; // Flat authored rooms keep their existing floor-height ownership.
      const delta=Number.isFinite(y)?Math.abs(y-baseY):0;
      if(Number.isFinite(y)&&(y<baseY-.65||y>baseY+WALL_HEIGHT+1))continue; // Never treat an actor below the local deck as being inside the chamber.
      if(delta<distance-1e-6||(Math.abs(delta-distance)<=1e-6&&(!best||room.w*room.d<best.w*best.d))){
        best=room;distance=delta; // A nested V50 puzzle chamber wins over its containing hall at the same elevation.
      }
    }
    return best;
  }

  function projectHull(room,project){
    const points=[];
    for(const y of [room.y-.15,room.y+WALL_HEIGHT+.1])
      for(const x of [room.x,room.x+room.w])
        for(const z of [room.z,room.z+room.d]){
          const v=project(x,y,z);
          if(Number.isFinite(v?.x)&&Number.isFinite(v?.y))points.push(v);
        }
    if(points.length<3)return [];
    points.sort((a,b)=>a.x-b.x||a.y-b.y);
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const hull=[];
    for(const p of points){
      while(hull.length>=2&&cross(hull[hull.length-2],hull[hull.length-1],p)<=0)hull.pop();
      hull.push(p);
    }
    const lower=hull.length;
    for(let i=points.length-2;i>=0;i--){
      const p=points[i];
      while(hull.length>lower&&cross(hull[hull.length-2],hull[hull.length-1],p)<=0)hull.pop();
      hull.push(p);
    }
    hull.pop();
    return hull; // The active room's camera silhouette is identical for all lights in one overlay redraw.
  }
  const LIGHT_CLIP_FEATHER_PX=24; // The shared darkness overlay feathers the inside of each room silhouette; no light crosses a sealed wall.
  const LIGHT_CLIP_PASS_BUDGET=72; // Budget for high-quality feather paints per overlay redraw; later engravings use the single-pass sealed fallback.
  function hullArea(points){
    let area=0;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      area+=a.x*b.y-b.x*a.y;
    }
    return area/2;
  }
  function insetHull(points,distance){
    if(points.length<3||!(distance>0))return null;
    const area=hullArea(points),sign=Math.sign(area);
    if(!sign||!Number.isFinite(area))return null;
    const result=[];
    for(let i=0;i<points.length;i++){
      const prev=points[(i+points.length-1)%points.length],p=points[i],next=points[(i+1)%points.length];
      const ax=p.x-prev.x,ay=p.y-prev.y,bx=next.x-p.x,by=next.y-p.y;
      const alen=Math.hypot(ax,ay),blen=Math.hypot(bx,by);
      if(alen<.001||blen<.001)return null;
      const anx=-sign*ay/alen,any=sign*ax/alen,bnx=-sign*by/blen,bny=sign*bx/blen;
      const denominator=1+anx*bnx+any*bny;
      if(denominator<.08)return null; // A near-zero interior angle would send the inset far beyond the room.
      const offset=distance/denominator;
      const point={x:p.x+(anx+bnx)*offset,y:p.y+(any+bny)*offset};
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
      result.push(point);
    }
    const innerArea=hullArea(result);
    if(Math.sign(innerArea)!==sign||Math.abs(innerArea)>=Math.abs(area))return null;
    for(const point of result)for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      if(sign*((b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x))<-.01)return null;
    }
    return result; // Convex inset stays inside the real room projection, including all stacked-story silhouettes.
  }
  function roomLightClip(room,project){
    const outer=projectHull(room,project);
    if(outer.length<3)return {outer,inner:null,bands:null};
    const xs=outer.map(p=>p.x),ys=outer.map(p=>p.y);
    const width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys);
    let feather=Math.min(LIGHT_CLIP_FEATHER_PX,(Math.min(width,height)-2)/4); // Room size limits the fade so thin silhouettes retain their center light.
    for(let attempt=0;attempt<4&&feather>.25;attempt++,feather/=2){
      const count=Math.max(3,Math.min(6,Math.ceil(feather/3))); // At most six concentric bands per source; project and inset only once per overlay redraw.
      const contours=[outer]; // Shared by all lights while the current room and camera projection are unchanged.
      for(let i=1;i<=count;i++){
        const inset=insetHull(outer,feather*i/count);
        if(!inset)break;
        contours.push(inset);
      }
      if(contours.length!==count+1)continue; // Narrow/acute camera projections retry with a smaller, still strictly contained feather.
      const bands=[]; // Nonoverlapping light strips, ordered from the room interior toward the strictly sealed outer boundary.
      for(let i=count-1;i>=0;i--){
        const t=(i+.5)/count;
        bands.push({outer:contours[i],inner:contours[i+1],alpha:t*t*(3-2*t)}); // Smoothstep samples approach zero at the real wall boundary.
      }
      return {outer,inner:contours[count],bands};
    }
    return {outer,inner:null,bands:null}; // Degenerate silhouettes use the original hard clip rather than leak light.
  }
  function traceHull(ctx,hull){
    ctx.moveTo(hull[0].x,hull[0].y);
    for(let i=1;i<hull.length;i++)ctx.lineTo(hull[i].x,hull[i].y);
    ctx.closePath();
  }
  function drawLightBand(ctx,outer,inner,alpha,draw){
    ctx.save();
    try{
      ctx.globalAlpha*=alpha;
      ctx.beginPath();traceHull(ctx,outer);
      if(inner)traceHull(ctx,inner);
      ctx.clip(inner?'evenodd':'nonzero');
      draw();
    }finally{ctx.restore();}
  }
  function drawClippedRoomLight(ctx,clip,draw,feather=true){
    if(clip.outer.length<3)return; // No safe projected room: do not reveal light outside its sealed boundaries.
    ctx.save();
    try{
      if(!feather||!clip.inner||!clip.bands?.length){ // The low-cost or degenerate fallback still enforces the outer room boundary.
        ctx.beginPath();traceHull(ctx,clip.outer);ctx.clip();draw();return;
      }
      // A solid core and smoothstep-sampled disjoint bands replace the visible three-step cutout.
      // The outside band's opacity approaches zero without ever drawing beyond the room perimeter.
      drawLightBand(ctx,clip.inner,null,1,draw);
      for(const band of clip.bands)drawLightBand(ctx,band.outer,band.inner,band.alpha,draw);
    }finally{ctx.restore();}
  }

  function visual(record,show){
    if(show){
      for(const [node,original] of record.hidden||[])node.visible=original;
      record.hidden=[];return;
    }
    const entity=record.enemy;
    record.hidden=[]; // Save each component's real state: waking a naturally invisible enemy must not reveal it.
    for(const node of [entity.avatarRef?.group,entity.groundShadow,entity._banditToolHolder,
      entity._banditRangedToolHolder,entity._banditTrailMesh]){
      if(!node)continue;
      record.hidden.push([node,node.visible]);node.visible=false;
    }
  }
  function resetHostile(entity,home){
    entity.x=home.x;entity.y=home.y;
    entity.vx=0;entity.vy=0;entity.state='idle';entity.targetPlayer=null;
    entity._chunkCombatTarget=null;entity._banditAction=null;entity._banditLunging=false;
    entity._rangedAction=null;entity.telegraphState=null;entity.wanderTarget={x:home.x,y:home.y};
    if(entity.avatarRef?.group?.position){
      entity.avatarRef.group.position.x=home.x/home.tile;
      entity.avatarRef.group.position.z=home.y/home.tile;
    }
  }
  function mount({layout,getPlayerPosition,getPlayerY,getHostiles,getWalkers,mapId='map_i_dev_random_ruin',tile=64,onRoomChange}={}){
    if(live)live.dispose(); // No room-owned hostiles or compositor masks leak across a ruin reroll.
    const rooms=[...(layout?.rooms||[])],ownership=new Map(); // Tracks each spawned hostile's original map, room and spawn tile.
    const walkersOwnership=new Map(); // Holds only actual ruin NPC walkers, independent of wilderness/town scheduling.
    let active=null,clock=PROBE_PERIOD,transitions=0,resets=0,disposed=false,lightHull=null; // One cached projected room silhouette per unified lighting pass.
    let lightClipPasses=0,lightClipDowngrades=0; // Overlay-owned budget counters reset by prepareLightClip, not every light or render frame.
    const byId=new Map(rooms.map(r=>[r.id,r])); // O(1) stable room-id lookup for encounters and diagnostics.
    const lookup=(x,z,y)=>roomAt(rooms,x,z,y);
    const sleepingArea=SLEEP_AREA+mapId;
    function wake(record){
      if(!record.sleeping)return;
      record.enemy.areaId=record.originalArea;
      record.sleeping=false;visual(record,true);
    }
    function sleep(record){
      if(record.sleeping)return;
      const enemy=record.enemy;
      if((Number(enemy.health)||0)<=0)return;
      resetHostile(enemy,record.home);
      enemy.areaId=sleepingArea;record.sleeping=true;visual(record,false);resets++;
    }
    function scanHostiles(){
      const hostiles=getHostiles?.()||root.Combat?.deps?.hostileObjects;
      if(!hostiles)return;
      for(const enemy of hostiles){
        if(!enemy||(Number(enemy.health)||0)<=0||ownership.has(enemy))continue;
        if(enemy.areaId!==mapId&&enemy.zoneId!==mapId)continue;
        const x=Number(enemy.x)/tile,z=Number(enemy.y)/tile;
        const entityY=Number(enemy.surfaceYOverride?.()??enemy.avatarRef?.group?.position?.y??getPlayerY?.());
        const room=lookup(x,z,entityY);
        if(!room)continue;
        const homeX=Number.isFinite(Number(enemy.homeX))?Number(enemy.homeX):Number(enemy.x);
        const homeY=Number.isFinite(Number(enemy.homeY))?Number(enemy.homeY):Number(enemy.y);
        ownership.set(enemy,{enemy,id:room.id,originalArea:enemy.areaId,
          home:{x:homeX,y:homeY,tile},sleeping:false});
      }
      for(const [enemy,record] of ownership){
        if((Number(enemy.health)||0)<=0||!hostiles.has?.(enemy)){ownership.delete(enemy);continue;}
        if(record.id===active?.id)wake(record);
        else sleep(record);
      }
    }
    function scanWalkers(){
      const collection=getWalkers?.()||root._npcWalkers||[];
      const walkers=typeof collection.values==='function'?collection.values():collection;
      if(!walkers?.[Symbol.iterator])return;
      const alive=new Set(); // Removes deleted walker references from this small ruin-only ownership set.
      for(const walker of walkers){
        if(!walker?.root?.position)continue;
        alive.add(walker);
        if(walkersOwnership.has(walker)||walker.area!==mapId)continue;
        const p=walker.root.position,room=lookup(Number(p.x),Number(p.z),Number(p.y));
        if(!room)continue;
        walkersOwnership.set(walker,{id:room.id,area:walker.area,
          originallyVisible:walker.root.visible!==false,sleeping:false});
      }
      for(const [walker,record] of walkersOwnership){
        if(!alive.has(walker)){walkersOwnership.delete(walker);continue;}
        if(walker.area!==record.area&&walker.area!==sleepingArea){
          if(record.sleeping)walker.root.visible=record.originallyVisible;
          walkersOwnership.delete(walker);continue; // Respect an authored transfer to another map.
        }
        const shouldWake=record.id===active?.id;
        if(shouldWake&&record.sleeping){
          walker.area=record.area;walker.root.visible=record.originallyVisible;record.sleeping=false;
        }else if(!shouldWake&&!record.sleeping){
          walker.area=sleepingArea;walker.root.visible=false;record.sleeping=true;
        }
      }
    }
    const session={
      rooms,layout,
      addRooms(additional){
        for(const room of additional||[]){
          if(!room?.id||byId.has(room.id))continue;
          rooms.push(room);byId.set(room.id,room);
        }
      }, // Native V50 upper stories are registered after their meshes are mounted in the same scene.
      get activeRoomId(){return active?.id||null;},
      isRoomActive(id){return !!active&&active.id===id;},
      ambient(){return active?.ambient||null;}, // Read by the unified overlay, preserving its accessibility-adjusted base darkness.
      roomAt:lookup,
      prepareLightClip(project){
        lightHull=active&&typeof project==='function'?roomLightClip(active,project):null;
        lightClipPasses=0;lightClipDowngrades=0;
      }, // Called once by the shared lighting overlay, not once per flame/rune/torch.
      lightAllowed(light){
        const source=lookup(Number(light?.x),Number(light?.z),Number(light?.y));
        return active?source?.id===active.id:!source; // Closed rooms and the shaft cannot light each other.
      },
      withLightClip(ctx,light,project,draw){
        if(!session.lightAllowed(light))return false;
        const room=lookup(Number(light?.x),Number(light?.z),Number(light?.y));
        if(!room||!ctx?.save||!ctx?.clip||typeof project!=='function'){draw();return true;}
        const clip=lightHull||roomLightClip(room,project);
        if(clip.outer.length<3)return false; // A collapsed camera projection must never reveal the neighboring room.
        const required=clip.bands?.length?clip.bands.length+1:1;
        const feather=required>1&&lightClipPasses+required<=LIGHT_CLIP_PASS_BUDGET;
        if(required>1&&!feather)lightClipDowngrades++; // Tiny late-drawn engraving glows retain strict clipping, not expensive repeated feathering.
        lightClipPasses+=feather?required:1;
        drawClippedRoomLight(ctx,clip,draw,feather);
        return true;
      },
      tick(dt){
        if(disposed)return;
        const p=getPlayerPosition?.(),y=Number(getPlayerY?.());
        const next=p?lookup(p.x,p.z,y):null;
        if(next?.id!==active?.id){
          active=next;transitions++;lightHull=null;lightClipPasses=0;lightClipDowngrades=0;
          scanHostiles();scanWalkers();clock=0; // Room transitions also freeze off-room civilian NPC walkers immediately.
          onRoomChange?.(active?.id||null);
          root.CloudForestFog?.refreshLightingOverlay?.();
        }
        clock+=Math.max(0,Number(dt)||0);
        if(clock>=PROBE_PERIOD){clock=0;scanHostiles();scanWalkers();}
      },
      dispose(){
        if(disposed)return;disposed=true;
        for(const record of ownership.values())if(record.sleeping)wake(record);
        ownership.clear();
        for(const [walker,record] of walkersOwnership){
          if(!record.sleeping)continue;
          walker.area=record.area;walker.root.visible=record.originallyVisible;
        }
        walkersOwnership.clear();if(live===session)live=null;
      },
      snapshot(){return {activeRoomId:active?.id||null,totalRooms:rooms.length,
        sleepingEnemies:[...ownership.values()].filter(r=>r.sleeping).length,
        sleepingNpcWalkers:[...walkersOwnership.values()].filter(r=>r.sleeping).length,
        assignedEnemies:ownership.size,transitions,resets,errors:layout?.errors||[],
        lightClip:{featherPx:LIGHT_CLIP_FEATHER_PX,feathered:!!lightHull?.inner,bands:lightHull?.bands?.length||0,
          canvasPasses:lightClipPasses,passBudget:LIGHT_CLIP_PASS_BUDGET,budgetDowngrades:lightClipDowngrades}};},
    };
    live=session;
    return session;
  }
  return Object.freeze({DOOR_SPAN,WALL_HEIGHT,planRooms,v50Rooms,projectedFloorArea,floorAudit,wallAudit,makeShell,roomAt,doorNear,mount,
    mounted:()=>!!live,
    isRoomActive:id=>live?.isRoomActive(id)===true,
    ambient:()=>live?.ambient()||null,
    lightAllowed:source=>live?live.lightAllowed(source):true,
    withLightClip:(ctx,light,project,draw)=>live?live.withLightClip(ctx,light,project,draw):(draw(),true),
    prepareLightClip:project=>live?.prepareLightClip(project),
    debugSnapshot:()=>live?.snapshot()||{activeRoomId:null,totalRooms:0,sleepingEnemies:0}});
});
