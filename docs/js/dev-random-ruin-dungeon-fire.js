// Dungeon Fire mechanisms for Harlyao's authored/generated ruin spaces.
// Fire source interaction, theme-specific targets, and modular ceiling Burdens
// all share the ordinary SimplePuzzles composer and RangedWeapons collision path.
(() => {
  'use strict';
  const SP = window.DevRandomRuinSimplePuzzles;
  const THREE = window.THREE;
  if (!SP?.registerComposer || !THREE) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const PAYLOAD_KIND = 'shattercask'; // Default physical burden; other kinds register factories and impact handlers with Shattercasks.
  let payloadKind = PAYLOAD_KIND; // Used by the next generated net/icicle payload; changed through the mobile-safe debug API.
  const CLEANSING_RADIUS = 2.4; // Kanthic cleansing radius in world tiles.
  const FIRE_CONTACT_PADDING = .2; // Slightly forgiving contact around mesh geometry, never through terrain/cover.
  const ICE_WALL_HEIGHT = 2.05; // Full-height Tothal barrier; the solid footprint is removed immediately on ignition.
  const MELT_SECONDS = .9; // Visible collapse time after the ice-wall collision blocker is removed.
  let world = null; // Active composer; replaced on ruin reroll and disposed on exit.
  let lastEvent = 'idle'; // Visible in the mobile dungeon-fire snapshot.

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const tileKey = (x,z) => Math.floor(x) + ',' + Math.floor(z);
  const distanceSq = (a,b) => (a.x-b.x)**2 + (a.z-b.z)**2;

  function material(color, options = {}) {
    return new THREE.MeshStandardMaterial({
      color, metalness:options.metalness ?? 0,
      roughness:options.roughness ?? .78,
      transparent:options.transparent === true,
      opacity:options.opacity ?? 1,
      emissive:options.emissive ?? 0x000000,
      emissiveIntensity:options.emissiveIntensity ?? 0,
      depthWrite:options.depthWrite !== false,
      side:THREE.DoubleSide,
    });
  }

  function addRod(group, from, to, radius, mat, name) {
    const a = new THREE.Vector3(from.x,from.y,from.z), b = new THREE.Vector3(to.x,to.y,to.z);
    const direction = b.clone().sub(a), length = direction.length();
    if (length < .001) return null;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,6),mat);
    mesh.name = name || 'dungeonFire_rod';
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
    group.add(mesh);
    return mesh;
  }

  function basketBrazier(x,y,z,kind='source') {
    const group = new THREE.Group();
    group.name = kind==='cleansing'?'kanthic_cleansing_brazier':'dungeon_fire_basket_brazier';
    group.position.set(x,y,z);
    group.userData.interactive3D = kind==='source';
    group.userData.devRuinInteractionType = kind==='source'?'dungeonFireSource':'dungeonFireTarget';
    const bronze = material(0x855326,{metalness:.78,roughness:.34});
    const darkBronze = material(0x4a2c19,{metalness:.7,roughness:.48});
    const coal = material(kind==='cleansing'?0x1b3432:0x241c18,{roughness:.92,emissive:kind==='cleansing'?0x174f47:0x842600,emissiveIntensity:.5});
    const amber = material(kind==='cleansing'?0x51c9a0:0xff7a1b,{emissive:kind==='cleansing'?0x19896b:0xb62c00,emissiveIntensity:1.6,roughness:.38});
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.23,.27,.10,10),darkBronze);
    base.position.y=.055;base.name='bronze_brazier_foot';group.add(base);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.32,.205,.29,10,1,true),bronze);
    bowl.position.y=.245;bowl.name='bronze_basket_bowl';group.add(bowl);
    const lowerRing = new THREE.Mesh(new THREE.TorusGeometry(.22,.035,6,12),darkBronze);
    lowerRing.rotation.x=Math.PI/2;lowerRing.position.y=.12;group.add(lowerRing);
    const upperRing = new THREE.Mesh(new THREE.TorusGeometry(.315,.034,6,12),bronze);
    upperRing.rotation.x=Math.PI/2;upperRing.position.y=.39;group.add(upperRing);
    for(let i=0;i<9;i++){
      const angle=i*Math.PI*2/9;
      const lower={x:Math.cos(angle)*.2,y:.12,z:Math.sin(angle)*.2};
      const upper={x:Math.cos(angle)*.292,y:.4,z:Math.sin(angle)*.292};
      addRod(group,lower,upper,.024,bronze,'basket_slat_'+i);
      if(i%2===0)addRod(group,{x:lower.x*.92,y:.2,z:lower.z*.92},{x:upper.x*.92,y:.31,z:upper.z*.92},.012,darkBronze,'basket_cross_slat_'+i);
    }
    const coals = new THREE.Mesh(new THREE.SphereGeometry(.17,10,6),coal);
    coals.scale.set(1,.32,1);coals.position.y=.37;group.add(coals);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(.085,8,6),amber);
    ember.scale.set(1,.35,1);ember.position.y=.41;ember.name='brazier_ember';group.add(ember);
    const pilot = new THREE.Mesh(new THREE.ConeGeometry(.065,.23,7),amber);
    pilot.position.y=.54;pilot.visible=false;pilot.name='brazier_armed_pilot';group.add(pilot);
    const collider = new THREE.Mesh(new THREE.BoxGeometry(.75,.68,.75),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false}));
    collider.position.y=.34;collider.name='brazier_fire_contact';group.add(collider);
    group.userData.dungeonFireParts={bronze,darkBronze,coal,amber,ember,pilot,collider};
    return group;
  }

  function floorPoints(kit,context,room) {
    const bounds=kit.roomBounds(context.meta,room),cx=(bounds.minX+bounds.maxX)*.5,cz=(bounds.minZ+bounds.maxZ)*.5;
    const points=[];
    for(const key of context.floorSet||[]){
      const [tx,tz]=String(key).split(',').map(Number);
      if(!Number.isFinite(tx)||!Number.isFinite(tz))continue;
      const x=tx+.5,z=tz+.5;
      if(x<bounds.minX+.3||x>bounds.maxX-.3||z<bounds.minZ+.3||z>bounds.maxZ-.3)continue;
      const support=kit.sampleSupport(x,z);
      if(!support)continue;
      if(window.DevRandomRuinTileOccupancy?.blocksAt?.(x,z,.3))continue;
      points.push({x,z,y:Number(support.y)||0,centerDistance:distanceSq({x,z},{x:cx,z:cz})});
    }
    points.sort((a,b)=>a.centerDistance-b.centerDistance||a.x-b.x||a.z-b.z);
    return points;
  }

  function choosePoint(kit,context,room,mode='center') {
    const points=floorPoints(kit,context,room);
    if(!points.length)return null;
    if(mode==='edge')return points[points.length-1];
    if(mode==='alternate')return points[Math.min(points.length-1,Math.floor(points.length*.65))];
    return points[0];
  }

  function addMechanismRecord(record) {
    world.records.push(record);
    return record;
  }

  function registerFireTarget(record,onBurn) {
    record.targetId=window.DungeonFire?.registerTarget?.({
      id:record.id,object:record.hitObject||record.group,
      active:true,contactPadding:FIRE_CONTACT_PADDING,
      onBurn:payload=>onBurn(record,payload),
    }) || null;
    return record.targetId;
  }

  function buildSourceBrazier(kit,point,index=0) {
    const group=basketBrazier(point.x,point.y,point.z,'source');
    group.name='dungeon_fire_source_brazier_'+index;
    kit.group().add(group);
    const record=addMechanismRecord({id:'dungeon-fire-source-'+index,kind:'source',group,point,armed:false});
    record.control={
      kind:'dungeonFireSource',object:group,promptRoot:group,
      range:1.55,priority:34,claimAction1:true,touchIcon:'🔥',
      label:'Ignite Next Shot',
      onPress:()=>{
        const armed=window.DungeonFire?.armNextProjectile?.()===true;
        if(!armed){kit.deps?.showToast?.('Equip a ranged weapon first.',false);return;}
        record.armed=true;
        kit.deps?.showToast?.('Next ranged projectile ignited.',true);
        lastEvent='source armed';
      },
    };
    return record;
  }

  function buildNet(point,ceilingY,index) {
    const group=new THREE.Group();
    group.name='dungeon_fire_burden_net_'+index;
    group.position.set(point.x,ceilingY-.05,point.z);
    const ropeMat=material(0x60472e,{roughness:.95});
    const netMat=material(0x725a3b,{roughness:.92,transparent:true,opacity:.9});
    const beamMat=material(0x59432d,{roughness:.92});
    const width=.82,depth=.68,drop=.92;
    addRod(group,{x:-width*.5,y:0,z:0},{x:width*.5,y:0,z:0},.035,beamMat,'net_top_beam');
    addRod(group,{x:0,y:0,z:-depth*.5},{x:0,y:0,z:depth*.5},.025,beamMat,'net_top_crossbeam');
    for(let i=0;i<=6;i++){
      const t=i/6-.5,x=t*width,z=t*depth;
      addRod(group,{x,y:-.02,z:-depth*.5},{x,y:-drop,z:0},.009,netMat,'net_longitudinal_'+i);
      addRod(group,{x:-width*.5,y:-.02,z},{x:0,y:-drop,z},.009,netMat,'net_lateral_'+i);
      addRod(group,{x:width*.5,y:-.02,z},{x:0,y:-drop,z},.009,netMat,'net_diagonal_'+i);
    }
    for(const x of [-width*.5,width*.5])for(const z of [-depth*.5,depth*.5]){
      addRod(group,{x,y:0,z},{x:x*.45,y:-drop*.84,z:z*.45},.016,ropeMat,'net_hanging_cord');
    }
    const anchor=new THREE.Group();
    anchor.name='net_burden_attachment';
    anchor.position.set(0,-drop*.8,0);
    group.add(anchor);
    const hitObject=new THREE.Mesh(new THREE.BoxGeometry(width*.88,drop,depth*.88),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false}));
    hitObject.position.y=-drop*.48;hitObject.name='dungeon_fire_net_contact';group.add(hitObject);
    const record=addMechanismRecord({
      id:'dungeon-fire-net-'+index,kind:'net',group,hitObject,anchor,burden:null,
      payloadPending:false,releaseRequested:false,removed:false,phase:'hanging',
    });
    world.group.add(group);
    registerFireTarget(record,net=>{
      if(net.phase!=='hanging')return false;
      net.phase='burned';net.group.visible=false;
      net.releaseRequested=true;
      releasePayload(net,'dungeon-fire-net');
      lastEvent='net burned: '+(net.burden?.displayName||'payload')+' released';
      return true;
    });
    mountPayload(record);
    return record;
  }

  function buildIcicle(point,ceilingY,index) {
    const group=new THREE.Group();
    group.name='tothal_dungeon_fire_burden_icicle_'+index;
    group.position.set(point.x,ceilingY-.08,point.z);
    const iceMat=material(0xa8e9ff,{metalness:.12,roughness:.23,transparent:true,opacity:.66,emissive:0x2b8eab,emissiveIntensity:.22,depthWrite:false});
    const frostMat=material(0xdff9ff,{roughness:.18,transparent:true,opacity:.48,depthWrite:false});
    const main=new THREE.Mesh(new THREE.OctahedronGeometry(.52,1),iceMat);
    main.position.y=-.82;main.scale.set(.66,1.3,.66);main.name='burden_encasing_ice';group.add(main);
    const needle=new THREE.Mesh(new THREE.ConeGeometry(.29,.88,7),frostMat);
    needle.position.y=-1.55;needle.name='icicle_tip';group.add(needle);
    const crown=new THREE.Mesh(new THREE.ConeGeometry(.25,.55,7),iceMat);
    crown.rotation.z=Math.PI;crown.position.y=-.28;group.add(crown);
    const anchor=new THREE.Group();
    anchor.position.set(0,-.9,0);anchor.name='icicle_burden_attachment';group.add(anchor);
    const hitObject=new THREE.Mesh(new THREE.BoxGeometry(.82,1.55,.82),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false}));
    hitObject.position.y=-.83;hitObject.name='dungeon_fire_icicle_contact';group.add(hitObject);
    const record=addMechanismRecord({
      id:'dungeon-fire-icicle-'+index,kind:'icicle',group,hitObject,anchor,burden:null,
      payloadPending:false,releaseRequested:false,removed:false,phase:'encased',iceMat,frostMat,
    });
    world.group.add(group);
    registerFireTarget(record,icicle=>{
      if(icicle.phase!=='encased')return false;
      icicle.phase='shattered';icicle.group.visible=false;
      icicle.releaseRequested=true;
      releasePayload(icicle,'dungeon-fire-icicle');
      lastEvent='icicle shattered: '+(icicle.burden?.displayName||'payload')+' released';
      return true;
    });
    mountPayload(record);
    return record;
  }

  function mountPayload(record) {
    const burdens=window.Shattercasks;
    if(!burdens?.createHangingBurden&&!burdens?.createHangingShattercask){record.payloadUnavailable=true;lastEvent='Burden runtime unavailable';return;}
    record.payloadPending=true;
    const createPayload=burdens.createHangingBurden||burdens.createHangingShattercask;
    const task=createPayload.call(burdens,{
      id:record.id+'_payload',mapId:MAP_ID,scene:world.context.scene,anchor:record.anchor,
      localY:record.kind==='icicle'?-.34:-.32,
      mechanismId:record.id,kind:payloadKind,
      furnitureKey:payloadKind==='shattercask'?'shattercaskBlasting':null,
      displayName:payloadKind==='shattercask'?'Shattercask':payloadKind,
    });
    Promise.resolve(task).then(burden=>{
      record.payloadPending=false;
      if(!burden){record.payloadUnavailable=true;lastEvent='ceiling Burden model unavailable: '+record.id;return;}
      if(!world||record.removed){burdens.discardBurden?.(burden);return;}
      record.burden=burden;
      if(record.releaseRequested)releasePayload(record,record.kind==='icicle'?'dungeon-fire-icicle':'dungeon-fire-net');
    }).catch(error=>{
      record.payloadPending=false;record.payloadUnavailable=true;
      console.warn('[Dungeon Fire] ceiling Burden creation failed',error);
      lastEvent='payload creation failed: '+record.id;
    });
  }

  function releasePayload(record,cause) {
    if(!record?.releaseRequested||!record.burden)return false;
    const released=window.Shattercasks?.releaseBurdenDownward?.(record.burden,cause)===true;
    if(released){record.phase='released';record.releaseRequested=false;}
    else lastEvent='payload release rejected: '+record.id;
    return released;
  }

  function buildIceWall(kit,context,doorway,index) {
    const support=kit.sampleSupport(doorway.x,doorway.z);
    if(!support)return null;
    const width=Math.max(1.25,Math.min(doorway.width*.86,3.4));
    const thickness=.17;
    const geometry=doorway.axis==='x'
      ?new THREE.BoxGeometry(thickness,ICE_WALL_HEIGHT,width)
      :new THREE.BoxGeometry(width,ICE_WALL_HEIGHT,thickness);
    const iceMat=material(0x9ce8ff,{metalness:.1,roughness:.24,transparent:true,opacity:.74,emissive:0x287eac,emissiveIntensity:.28,depthWrite:false});
    const mesh=new THREE.Mesh(geometry,iceMat);
    mesh.name='tothal_dungeon_fire_ice_wall_'+index;
    mesh.position.set(doorway.x,Number(support.y)+ICE_WALL_HEIGHT*.5,doorway.z);
    mesh.userData.dungeonFireMechanism='tothalIceWall';
    world.group.add(mesh);
    const wall={
      id:'dungeon-fire-ice-wall-'+index,kind:'iceWall',group:mesh,mesh,iceMat,
      point:{x:doorway.x,y:Number(support.y),z:doorway.z},
      blocking:true,phase:'frozen',elapsed:0,
      footprintId:'dungeon-fire-ice-wall-footprint-'+index,
    };
    window.DevRandomRuinTileOccupancy?.addSolidBox?.(
      wall.footprintId,
      {cx:doorway.x,cz:doorway.z,halfX:doorway.axis==='x'?thickness*.5:width*.5,halfZ:doorway.axis==='x'?width*.5:thickness*.5},
      ()=>wall.blocking,
      'dungeon-fire-ice-walls'
    );
    world.walls.push(wall);world.records.push(wall);
    const target={id:wall.id,object:mesh,active:true,contactPadding:.16,onBurn:()=>{
      if(wall.phase!=='frozen')return false;
      wall.phase='melting';wall.elapsed=0;wall.blocking=false;
      window.DevRandomRuinTileOccupancy?.refresh?.();
      lastEvent='Tothal ice wall melting';
      return true;
    }};
    wall.targetId=window.DungeonFire?.registerTarget?.(target)||null;
    return wall;
  }

  function buildCleansingBrazier(kit,point,index) {
    const group=basketBrazier(point.x,point.y,point.z,'cleansing');
    group.name='kanthic_cleansing_brazier_'+index;
    world.group.add(group);
    const targetMesh=group.userData.dungeonFireParts.collider;
    const record=addMechanismRecord({id:'dungeon-fire-cleansing-brazier-'+index,kind:'cleansingBrazier',group,hitObject:targetMesh,point,radius:CLEANSING_RADIUS,cleansed:0});
    registerFireTarget(record,brazier=>{
      if(brazier.cleansed>0)return false;
      brazier.cleansed=window.DevRandomRuinLichThemes?.clearPlasmRadius?.(point.x,point.z,brazier.radius)||0;
      if(!brazier.cleansed){lastEvent='cleansing brazier burned but no plasm in radius';return false;}
      const parts=group.userData.dungeonFireParts;
      parts.ember.material.color.setHex(0x72ffbd);
      parts.pilot.visible=true;
      lastEvent='Kanthic plasm cleansed '+brazier.cleansed+' tiles';
      return true;
    });
    return record;
  }

  function buildThemeMechanisms(kit,context) {
    const theme=String(context.theme||'').toLowerCase();
    if(theme==='tothal'){
      const doors=[];
      for(const room of context.meta?.rooms||[]){
        for(const entry of kit.roomDoorways(context,room)){
          const doorway=kit.doorwayWorld(context.meta,entry.door,entry.index);
          if(doorway&&!doors.some(item=>item.index===entry.index))doors.push(doorway);
        }
      }
      doors.slice(0,2).forEach((door,index)=>buildIceWall(kit,context,door,index));
      const rooms=(context.meta?.rooms||[]).slice(-2);
      rooms.forEach((room,index)=>{
        const point=choosePoint(kit,context,room,index?'edge':'alternate');
        if(point)buildIcicle(point,Number(context.ceilingY)||point.y+3.15,index);
      });
    }
    if(theme==='kanthic'){
      const centers=window.DevRandomRuinLichThemes?.plasmTileCenters?.()||[];
      const chosen=[];
      if(centers.length){
        chosen.push(centers[0]);
        if(centers.length>5){
          const first=centers[0];
          const farthest=centers.reduce((best,item)=>distanceSq(item,first)>distanceSq(best,first)?item:best,first);
          if(distanceSq(farthest,first)>CLEANSING_RADIUS*CLEANSING_RADIUS*.8)chosen.push(farthest);
        }
      }
      chosen.slice(0,2).forEach((entry,index)=>buildCleansingBrazier(kit,{x:entry.x,y:Number(entry.y)||0,z:entry.z},index));
    }
  }

  function buildRooms(kit,context) {
    clear();
    if(context.hachutu===true||!context.floorSet?.size)return;
    const rooms=context.meta?.rooms||[];
    if(!rooms.length)return;
    world={
      context,kit,theme:String(context.theme||'').toLowerCase(),
      group:new THREE.Group(),records:[],walls:[],source:null,
      ceilingY:Number(context.ceilingY)||(Number(context.meta?.floorSurfaceY)||0)+(Number(context.meta?.wallHeight)||3),
      startedAt:performance.now(),
    };
    world.group.name='dev_random_ruin_dungeon_fire';
    kit.group().add(world.group);
    const sourcePoint=choosePoint(kit,context,rooms[0],'center');
    if(sourcePoint)world.source=buildSourceBrazier(kit,sourcePoint,0);
    const netRooms=[rooms[Math.min(rooms.length-1,1)]||rooms[0]];
    if(rooms.length>=4&&rooms[rooms.length-1]!==netRooms[0])netRooms.push(rooms[rooms.length-1]);
    netRooms.forEach((room,index)=>{
      const point=choosePoint(kit,context,room,index?'alternate':'edge')||sourcePoint;
      if(point)buildNet(point,world.ceilingY,index);
    });
    buildThemeMechanisms(kit,context);
    // Nets, braziers and icicle shells are intentionally non-blocking; only Tothal ice walls register a solid footprint.
    lastEvent='generated:'+world.theme;
  }

  function update(_kit,_now,dt) {
    if(!world||dt<=0)return;
    const fireState=window.DungeonFire?.debugSnapshot?.()||{};
    if(world.source){
      const pilot=world.source.group.userData?.dungeonFireParts?.pilot;
      if(pilot)pilot.visible=fireState.armed===true;
    }
    for(const wall of world.walls){
      if(wall.phase!=='melting')continue;
      wall.elapsed+=dt;
      const t=clamp01(wall.elapsed/MELT_SECONDS);
      wall.mesh.scale.y=Math.max(.02,1-t);
      wall.mesh.position.y=wall.point.y+ICE_WALL_HEIGHT*.5-t*.3;
      wall.iceMat.opacity=.74*(1-t);
      if(t>=1){
        wall.mesh.visible=false;
        if(wall.targetId)window.DungeonFire?.unregisterTarget?.(wall.targetId);
        wall.phase='melted';
      }
    }
    for(const record of world.records){
      if(record.kind==='cleansingBrazier'&&record.cleansed>0){
        const pilot=record.group.userData?.dungeonFireParts?.pilot;
        if(pilot)pilot.visible=true;
      }
    }
  }

  function controls(kit) {
    if(!world?.source||!window.RangedWeapons?.equippedRangedKey?.())return [];
    return [world.source.control];
  }

  function snapshot() {
    if(!world)return {active:false,lastEvent};
    return {
      active:true,theme:world.theme,
      source:world.source?{id:world.source.id,armed:window.DungeonFire?.debugSnapshot?.().armed===true,at:world.source.point}:null,
      iceWalls:world.walls.map(wall=>({id:wall.id,phase:wall.phase,blocking:wall.blocking,elapsed:+wall.elapsed.toFixed(2)})),
      nets:world.records.filter(record=>record.kind==='net').map(record=>({id:record.id,phase:record.phase,payload:record.burden?.id||null,payloadPending:record.payloadPending,unavailable:!!record.payloadUnavailable})),
      icicles:world.records.filter(record=>record.kind==='icicle').map(record=>({id:record.id,phase:record.phase,payload:record.burden?.id||null,payloadPending:record.payloadPending})),
      cleansers:world.records.filter(record=>record.kind==='cleansingBrazier').map(record=>({id:record.id,cleansed:record.cleansed,radius:record.radius})),
      lastEvent,
    };
  }

  function clear() {
    if(!world)return;
    for(const record of world.records){
      record.removed=true;
      if(record.targetId)window.DungeonFire?.unregisterTarget?.(record.targetId);
      if(record.burden)window.Shattercasks?.discardBurden?.(record.burden);
    }
    for(const wall of world.walls){
      if(wall.targetId)window.DungeonFire?.unregisterTarget?.(wall.targetId);
      wall.blocking=false;
    }
    window.DevRandomRuinTileOccupancy?.clearSolids?.('dungeon-fire-ice-walls');
    window.DevRandomRuinTileOccupancy?.clearSolids?.('dungeon-fire-mechanisms');
    window.DevRandomRuinTileOccupancy?.refresh?.();
    const geometries=new Set(),materials=new Set();
    world.group.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      for(const entry of Array.isArray(object.material)?object.material:[object.material])if(entry)materials.add(entry);
    });
    world.group.parent?.remove(world.group);
    for(const geometry of geometries)geometry.dispose?.();
    for(const entry of materials)entry.dispose?.();
    window.DungeonFire?.clear?.(); // Reroll/exit cannot leave armed shots, flame zones, or orphaned target callbacks.
    world=null;
    lastEvent='cleared';
  }

  SP.registerComposer({id:'dungeonFire',buildRooms,update,controls,snapshot,clear});
  window.DevRandomRuinDungeonFire=Object.freeze({
    snapshot,clear,
    armNextProjectile:()=>window.DungeonFire?.armNextProjectile?.()===true,
    setPayloadKind:kind=>{const value=String(kind||'').trim();if(!value)return false;payloadKind=value;return true;}, // Applies to the next generated net/icicle set; custom kinds use Shattercasks.registerBurdenFactory/ImpactHandler.
    releaseBurden:recordId=>{
      const record=world?.records?.find(item=>item.id===recordId);
      if(!record||!record.burden)return false;
      record.releaseRequested=true;
      return releasePayload(record,'dev-dungeon-fire-release');
    },
    debugSnapshot:()=>({composer:snapshot(),fire:window.DungeonFire?.debugSnapshot?.()||null,burdens:window.Shattercasks?.debugSnapshot?.().downwardBurdenFalls||[]}),
  });
})();
