// Simple, low-state puzzle/hazard runtime for the dev Random Test Ruin.
// V50 owns only the room graph + the proven projectile glyph activators. This
// module layers independent traversal/hazards on top so a broken puzzle can
// never strand the player behind a required mechanism.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const SCOPE = 'dev-random-ruin-simple-puzzles';
  const PAD = 2;
  const GRID_REVEAL_MS = 3600;
  const GRID_BURNING = 24;
  const GRID_RETRIGGER_MS = 900;
  const HALL_FIRE_BURNING = 18;
  const HALL_POISON = 16;
  const HALL_SHOT_PERIOD = 0.9;
  const ROPE_FALL_BURNING = 14;
  const ROPE_GRAB_RADIUS = 0.8;
  const ROPE_GRAVITY = 8.2;
  const ROPE_MIN_LENGTH = 1.65;
  const CHECKPOINT_INVULN_MS = 1200;

  const DS = window.DynamicSurfaces;
  const GridTileAccessors = window.GridTileAccessors;
  const DevSpawner = window.DevSpawner;
  const PlayerVitals = window.PlayerVitals;
  const Combat = window.Combat;
  if (!DS || !GridTileAccessors || !DevSpawner || !window.THREE) return;

  let deps = null;
  let state = null;
  let lastFrameMs = performance.now();
  let pendingDeathRecoveryUntil = 0;

  const nativeDevInit = DevSpawner.init;
  DevSpawner.init = function (injectedDeps) {
    deps = injectedDeps;
    return nativeDevInit.call(this, injectedDeps);
  };

  function currentArea() {
    return deps?.getCurrentArea?.() || GridTileAccessors.getCurrentArea?.() || null;
  }

  function inRuin() {
    return currentArea() === MAP_ID;
  }

  function clonePoint(point) {
    return point ? { x:Number(point.x) || 0, y:Number(point.y) || 0, z:Number(point.z) || 0 } : null;
  }

  function playerWorld() {
    if (!deps?.player || !deps?.TILE) return null;
    return {
      x:(Number(deps.player.x) || 0) / deps.TILE,
      z:(Number(deps.player.y) || 0) / deps.TILE,
      y:Number(deps.playerMesh?.position?.y) || 0,
    };
  }

  function setPlayerWorld(point, setHeight = true) {
    if (!point || !deps?.player || !deps?.TILE) return false;
    deps.player.x = point.x * deps.TILE;
    deps.player.y = point.z * deps.TILE;
    deps.player.vx = 0;
    deps.player.vy = 0;
    if (setHeight && deps.playerMesh?.position) {
      deps.playerMesh.position.x = point.x;
      deps.playerMesh.position.z = point.z;
      deps.playerMesh.position.y = Number(point.y) || 0;
    }
    return true;
  }

  function worldCellSize(meta) {
    return (Number(meta?.cellSize) || 0.5) * 2;
  }

  function cellWorld(meta, col, row) {
    const cs = worldCellSize(meta);
    return { x:PAD + (Number(col) + 0.5) * cs, z:PAD + (Number(row) + 0.5) * cs };
  }

  function roomBounds(meta, room) {
    const cs = worldCellSize(meta);
    return {
      minX:PAD + Number(room.col) * cs,
      maxX:PAD + (Number(room.col) + Number(room.w)) * cs,
      minZ:PAD + Number(room.row) * cs,
      maxZ:PAD + (Number(room.row) + Number(room.h)) * cs,
    };
  }

  function doorwayWorld(meta, door, index) {
    const cs = worldCellSize(meta);
    const axis = door.axis === 'z' ? 'z' : 'x';
    const point = axis === 'x'
      ? { x:PAD + Number(door.boundary) * cs, z:PAD + Number(door.center) * cs }
      : { x:PAD + Number(door.center) * cs, z:PAD + Number(door.boundary) * cs };
    return {
      id:'doorway-' + index + '-' + String(door.from || '?') + '-' + String(door.to || '?'),
      axis,
      x:point.x,
      z:point.z,
      width:Math.max(cs, Number(door.widthCells || 1) * cs),
      from:door.from || null,
      to:door.to || null,
    };
  }

  function sampleSupport(x, z, maxY = 10) {
    return DS.sampleSupport?.(x, z, { minY:-6, maxY, pad:.02 }) || null;
  }

  function supportPoint(x, z, fallbackY = 0) {
    const support = sampleSupport(x, z);
    return { x, z, y:Number(support?.y ?? fallbackY) };
  }

  function seededRng(seed) {
    let value = (Number(seed) >>> 0) || 0x6d2b79f5;
    return () => {
      value += 0x6d2b79f5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(array, rng) {
    const out = array.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  function makeBasic(color, options = {}) {
    return new THREE.MeshBasicMaterial({
      color,
      transparent:options.transparent === true,
      opacity:Number.isFinite(Number(options.opacity)) ? Number(options.opacity) : 1,
      side:options.side ?? THREE.DoubleSide,
      depthWrite:options.depthWrite !== false,
    });
  }

  function naturalizeStone(mesh) {
    const natural = window.NaturalSurfaceMaterials;
    if (mesh?.isMesh && typeof natural?.naturalizeMesh === 'function') {
      natural.naturalizeMesh(mesh, 'cliffs');
      mesh.userData.devRandomRuinDenMaterial = true;
      mesh.userData.devRandomRuinSimpleStone = true;
    }
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  function disposeObject(root) {
    if (!root) return;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    root.traverse?.(object => {
      if (object.geometry) geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of list) {
        materials.add(material);
        if (material?.map) textures.add(material.map);
      }
    });
    root.parent?.remove?.(root);
    for (const texture of textures) texture.dispose?.();
    for (const material of materials) material.dispose?.();
    for (const geometry of geometries) geometry.dispose?.();
  }

  function clearState() {
    if (!state) return;
    for (const id of state.surfaceIds) DS.remove?.(id);
    disposeObject(state.group);
    state = null;
  }

  function usableRoomCandidates(context) {
    return (context.meta?.rooms || [])
      .filter(room => Number(room.w) >= 8 && Number(room.h) >= 8)
      .sort((a, b) => (Number(b.w) * Number(b.h)) - (Number(a.w) * Number(a.h)));
  }

  function roomPatch(context, room, width, depth, offsetX = 0, offsetZ = 0) {
    const bounds = roomBounds(context.meta, room);
    const centerX = (bounds.minX + bounds.maxX) * 0.5 + offsetX;
    const centerZ = (bounds.minZ + bounds.maxZ) * 0.5 + offsetZ;
    const points = [
      [centerX, centerZ],
      [centerX-width*.45, centerZ-depth*.45],
      [centerX+width*.45, centerZ-depth*.45],
      [centerX-width*.45, centerZ+depth*.45],
      [centerX+width*.45, centerZ+depth*.45],
    ].map(([x,z]) => sampleSupport(x,z));
    if (points.some(point => !point || !Number.isFinite(Number(point.y)))) return null;
    const ys = points.map(point => Number(point.y));
    if (Math.max(...ys) - Math.min(...ys) > .14) return null;
    return { centerX, centerZ, y:ys.reduce((sum,value) => sum + value, 0) / ys.length, bounds };
  }

  function safePathCells(size, rng) {
    const path = new Set();
    let col = Math.floor(rng() * size);
    for (let row = 0; row < size; row++) {
      path.add(col + ',' + row);
      if (row >= size - 1) continue;
      const next = Math.max(0, Math.min(size - 1, col + (Math.floor(rng() * 3) - 1)));
      if (next !== col) path.add(next + ',' + row);
      col = next;
    }
    return path;
  }

  function buildSafePathGrid(context, rng, usedRooms) {
    const candidates = usableRoomCandidates(context).filter(room => !usedRooms.has(room.id));
    for (const room of candidates) {
      const size = 5;
      const spacing = .78;
      const footprint = (size - 1) * spacing + .72;
      const patch = roomPatch(context, room, footprint + 1.8, footprint + 1.8);
      if (!patch) continue;

      const root = new THREE.Group();
      root.name = 'dev_ruin_safe_path_grid_' + room.id;
      root.userData.devRandomRuinSimplePuzzle = 'safePath';
      state.group.add(root);

      const safe = safePathCells(size, rng);
      const cells = [];
      const originX = patch.centerX - (size - 1) * spacing * .5;
      const originZ = patch.centerZ - (size - 1) * spacing * .5;
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const key = col + ',' + row;
          const x = originX + col * spacing;
          const z = originZ + row * spacing;
          const support = sampleSupport(x,z,patch.y+.4);
          if (!support || Math.abs(Number(support.y)-patch.y) > .16) {
            disposeObject(root);
            state.group.add(root);
            root.clear?.();
            continue;
          }
          const material = makeBasic(0x57534a);
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(.7,.055,.7), material);
          mesh.position.set(x, Number(support.y)+.028, z);
          mesh.name = 'dev_ruin_pressure_plate_' + room.id + '_' + key.replace(',','_');
          mesh.userData.devRandomRuinPressurePlate = true;
          mesh.userData.safePathCell = safe.has(key);
          root.add(mesh);
          cells.push({ key, col, row, x, z, y:Number(support.y), safe:safe.has(key), mesh, material, lastTriggeredAt:-Infinity });
        }
      }
      if (cells.length !== size * size) {
        disposeObject(root);
        continue;
      }

      const buttonZ = originZ - 1.15;
      const buttonSupport = sampleSupport(patch.centerX, buttonZ, patch.y+.5) || { y:patch.y };
      const button = new THREE.Group();
      button.name = 'dev_ruin_safe_path_button_' + room.id;
      button.userData.devRuinInteractionType = 'safePathReveal';
      button.userData.interactive3D = true;
      const pedestal = naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(.62,.35,.62), makeBasic(0x777777)));
      pedestal.position.y = .175;
      const capMat = makeBasic(0x718a72);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(.42,.09,.42), capMat);
      cap.position.y = .395;
      button.add(pedestal,cap);
      button.position.set(patch.centerX, Number(buttonSupport.y), buttonZ);
      root.add(button);

      const grid = {
        roomId:room.id,
        root,
        cells,
        safe,
        button,
        capMat,
        revealUntil:0,
        lastPlayerKey:null,
        triggerCount:0,
      };
      state.safeGrids.push(grid);
      state.controls.push({
        kind:'safePathReveal',
        object:button,
        promptRoot:button,
        range:1.9,
        priority:20,
        touchIcon:'✦',
        label:'Reveal Safe Path',
        onPress:() => {
          grid.revealUntil = performance.now() + GRID_REVEAL_MS;
          deps?.showToast?.('The safe pressure plates flare briefly.', true);
        },
      });
      usedRooms.add(room.id);
      return grid;
    }
    return null;
  }

  function createPlatform(id, x, z, baseY, width, depth) {
    const height = .28;
    const mesh = naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(width,height,depth), makeBasic(0x808080)));
    mesh.name = id;
    mesh.position.set(x,baseY+height*.5,z);
    mesh.userData.devRandomRuinRopePlatform = true;
    state.group.add(mesh);
    const surfaceId = id + '-surface';
    DS.registerSurface({
      id:surfaceId,
      scope:SCOPE,
      bounds:{ minX:x-width*.5, maxX:x+width*.5, minZ:z-depth*.5, maxZ:z+depth*.5 },
      topY:baseY+height,
      enabled:() => mesh.visible !== false,
      priority:18,
    });
    state.surfaceIds.add(surfaceId);
    return { mesh, x, z, width, depth, baseY, topY:baseY+height };
  }

  function pointInsidePlatform(point, platform, pad = 0) {
    return Math.abs(point.x-platform.x) <= platform.width*.5+pad &&
      Math.abs(point.z-platform.z) <= platform.depth*.5+pad;
  }

  function updateRopeVisual(rope) {
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw);
    const horizontal = Math.sin(rope.angle) * rope.length;
    const bob = {
      x:rope.anchor.x + dirX * horizontal,
      z:rope.anchor.z + dirZ * horizontal,
      y:rope.anchor.y - Math.cos(rope.angle) * rope.length,
    };
    rope.bob = bob;
    const positions = rope.line.geometry.attributes.position.array;
    positions[0]=rope.anchor.x; positions[1]=rope.anchor.y; positions[2]=rope.anchor.z;
    positions[3]=bob.x; positions[4]=bob.y; positions[5]=bob.z;
    rope.line.geometry.attributes.position.needsUpdate = true;
    rope.marker.position.set(bob.x,bob.y,bob.z);
    return bob;
  }

  function attachRope(rope) {
    if (!rope || state.flight || rope.attached) return false;
    rope.attached = true;
    rope.braking = false;
    state.activeRope = rope;
    deps?.showToast?.('Caught the rope — move to pump; release when you have the arc.', true);
    return true;
  }

  function releaseRope(rope) {
    if (!rope?.attached) return false;
    const dirX = Math.cos(rope.yaw), dirZ = Math.sin(rope.yaw);
    const tangentSpeed = Math.cos(rope.angle) * rope.length * rope.omega;
    const verticalSpeed = Math.sin(rope.angle) * rope.length * rope.omega;
    const bob = updateRopeVisual(rope);
    state.flight = {
      x:bob.x, y:bob.y, z:bob.z,
      vx:dirX*tangentSpeed,
      vz:dirZ*tangentSpeed,
      vy:verticalSpeed + .55,
      ropeId:rope.id,
    };
    rope.attached = false;
    rope.braking = false;
    state.activeRope = null;
    return true;
  }

  function buildRopeSwing(context, rng, usedRooms) {
    const candidates = usableRoomCandidates(context).filter(room => !usedRooms.has(room.id));
    for (const room of candidates) {
      const bounds = roomBounds(context.meta,room);
      const roomWidth = bounds.maxX-bounds.minX;
      const roomDepth = bounds.maxZ-bounds.minZ;
      const axis = roomWidth >= roomDepth ? 'x' : 'z';
      const longSpan = axis === 'x' ? roomWidth : roomDepth;
      const separation = Math.max(4.6, Math.min(6.4, longSpan - 3.5));
      if (separation < 4.4) continue;
      const cx=(bounds.minX+bounds.maxX)*.5, cz=(bounds.minZ+bounds.maxZ)*.5;
      const dir = axis === 'x' ? {x:1,z:0} : {x:0,z:1};
      const a = { x:cx-dir.x*separation*.5, z:cz-dir.z*separation*.5 };
      const b = { x:cx+dir.x*separation*.5, z:cz+dir.z*separation*.5 };
      const sa=sampleSupport(a.x,a.z), sb=sampleSupport(b.x,b.z), sm=sampleSupport(cx,cz);
      if (!sa || !sb || !sm || Math.abs(Number(sa.y)-Number(sb.y))>.35) continue;

      const platformW = axis === 'x' ? 2.1 : 2.5;
      const platformD = axis === 'x' ? 2.5 : 2.1;
      const pa=createPlatform('dev_ruin_rope_platform_a_'+room.id,a.x,a.z,Number(sa.y),platformW,platformD);
      const pb=createPlatform('dev_ruin_rope_platform_b_'+room.id,b.x,b.z,Number(sb.y),platformW,platformD);

      const hazardLength=Math.max(1.5,separation-(axis==='x'?platformW:platformD));
      const hazardWidth=Math.min(2.2,(axis==='x'?roomDepth:roomWidth)-2);
      const hazard = new THREE.Mesh(
        new THREE.BoxGeometry(axis==='x'?hazardLength:hazardWidth,.025,axis==='x'?hazardWidth:hazardLength),
        makeBasic(0x5e2118,{transparent:true,opacity:.62})
      );
      hazard.name='dev_ruin_rope_hazard_'+room.id;
      hazard.position.set(cx,Number(sm.y)+.014,cz);
      hazard.userData.devRandomRuinRopeHazard=true;
      state.group.add(hazard);

      const length=Math.max(2.6,Math.min(3.35,separation*.56));
      const half=separation*.5;
      const startAngle=Math.asin(Math.min(.93,half/length));
      const topY=Math.max(pa.topY,pb.topY);
      const anchorY=topY+.72+Math.cos(startAngle)*length;
      const lineGeometry=new THREE.BufferGeometry();
      lineGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
      const line=new THREE.Line(lineGeometry,new THREE.LineBasicMaterial({color:0xc9ad77,transparent:true,opacity:.96}));
      line.name='dev_ruin_swing_rope_'+room.id;
      line.frustumCulled=false;
      state.group.add(line);
      const marker=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),makeBasic(0xd1b682));
      marker.name='dev_ruin_swing_rope_grip_'+room.id;
      marker.userData.interactive3D=true;
      marker.userData.devRuinInteractionType='ropeSwing';
      state.group.add(marker);

      const rope={
        id:'rope-'+room.id,
        roomId:room.id,
        line,marker,
        anchor:{x:cx,y:anchorY,z:cz},
        yaw:axis==='x'?0:Math.PI*.5,
        length,
        maxLength:length+.55,
        angle:-startAngle,
        omega:0,
        attached:false,
        braking:false,
        startPlatform:pa,
        endPlatform:pb,
        hazard:{mesh:hazard,cx,cz,length:hazardLength,width:hazardWidth,axis,lastBurnAt:-Infinity},
        grabPoint:{
          x:pa.x+dir.x*(axis==='x'?pa.width*.46:pa.depth*.46),
          z:pa.z+dir.z*(axis==='x'?pa.width*.46:pa.depth*.46),
          y:pa.topY,
        },
        bob:null,
      };
      updateRopeVisual(rope);
      state.ropes.push(rope);
      usedRooms.add(room.id);
      return rope;
    }
    return null;
  }

  function createEmitterFixture(id,x,y,z) {
    const mesh=naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(.24,.24,.24),makeBasic(0x808080)));
    mesh.name=id;
    mesh.position.set(x,y+.42,z);
    mesh.userData.devRandomRuinHallTrapEmitter=true;
    state.group.add(mesh);
    return mesh;
  }

  function spawnTrapProjectile(trap, station) {
    const fire = (station.sequence++ % 2) === 0;
    station.side *= -1;
    const side = station.side;
    const cross = trap.crossHalf + .08;
    let x=station.x, z=station.z, vx=0, vz=0;
    if (trap.axis === 'x') {
      z=trap.centerCross+cross*side;
      vz=-side*4.8;
    } else {
      x=trap.centerCross+cross*side;
      vx=-side*4.8;
    }
    let mesh;
    if (fire) {
      mesh=new THREE.Mesh(new THREE.SphereGeometry(.13,8,6),makeBasic(0xff6a22));
    } else {
      mesh=new THREE.Mesh(new THREE.BoxGeometry(.34,.055,.055),makeBasic(0x86a866));
      mesh.rotation.y=trap.axis==='x'?Math.PI*.5:0;
    }
    mesh.name='dev_ruin_hall_projectile_'+trap.id+'_'+station.index+'_'+station.sequence;
    mesh.position.set(x,station.y+.55,z);
    mesh.userData.devRandomRuinHallTrapProjectile=fire?'fire':'poison';
    state.group.add(mesh);
    state.projectiles.push({
      mesh,
      kind:fire?'fire':'poison',
      x,z,y:station.y+.55,
      vx,vz,
      age:0,
      maxAge:Math.max(1.1,(trap.crossHalf*2+.8)/4.8+.35),
      trapId:trap.id,
    });
  }

  function buildHallwayTraps(context, rng) {
    const hallways=(context.meta?.hallways||[])
      .filter(hall => (hall.axis==='x'?Number(hall.w):Number(hall.h))>=5)
      .sort((a,b)=>(b.axis==='x'?Number(b.w):Number(b.h))-(a.axis==='x'?Number(a.w):Number(a.h)));
    const selected=shuffle(hallways,rng).slice(0,Math.min(2,hallways.length));
    const cs=worldCellSize(context.meta);
    for(const hall of selected){
      const axis=hall.axis==='z'?'z':'x';
      const longStart=PAD+(axis==='x'?Number(hall.col):Number(hall.row))*cs;
      const longLength=(axis==='x'?Number(hall.w):Number(hall.h))*cs;
      const crossStart=PAD+(axis==='x'?Number(hall.row):Number(hall.col))*cs;
      const crossWidth=(axis==='x'?Number(hall.h):Number(hall.w))*cs;
      const centerCross=crossStart+crossWidth*.5;
      const crossHalf=Math.max(.45,crossWidth*.5-.16);
      const stations=[];
      for(let index=0;index<3;index++){
        const u=(index+1)/4;
        const along=longStart+longLength*u;
        const x=axis==='x'?along:centerCross;
        const z=axis==='x'?centerCross:along;
        const support=sampleSupport(x,z);
        if(!support)continue;
        const y=Number(support.y);
        const fixtureOffset=crossHalf+.02;
        if(axis==='x'){
          createEmitterFixture('dev_ruin_hall_emitter_'+hall.id+'_'+index+'_a',x,y,centerCross-fixtureOffset);
          createEmitterFixture('dev_ruin_hall_emitter_'+hall.id+'_'+index+'_b',x,y,centerCross+fixtureOffset);
        }else{
          createEmitterFixture('dev_ruin_hall_emitter_'+hall.id+'_'+index+'_a',centerCross-fixtureOffset,y,z);
          createEmitterFixture('dev_ruin_hall_emitter_'+hall.id+'_'+index+'_b',centerCross+fixtureOffset,y,z);
        }
        stations.push({index,x,z,y,side:index%2?1:-1,sequence:index,nextAt:.38+index*.28});
      }
      if(!stations.length)continue;
      state.trapHallways.push({
        id:String(hall.id),
        axis,
        centerCross,
        crossHalf,
        longStart,
        longLength,
        stations,
      });
    }
  }

  function doorwayCrossing(door, from, to) {
    if (!from || !to) return null;
    if (door.axis === 'x') {
      const a=from.x-door.x,b=to.x-door.x;
      if (a===0 || b===0 || a*b>0 || Math.abs(to.x-from.x)<1e-6) return null;
      const t=(door.x-from.x)/(to.x-from.x);
      if(t<0||t>1)return null;
      const crossZ=from.z+(to.z-from.z)*t;
      if(Math.abs(crossZ-door.z)>door.width*.5+.3)return null;
      return {x:door.x,z:crossZ,side:Math.sign(b)||1};
    }
    const a=from.z-door.z,b=to.z-door.z;
    if(a===0||b===0||a*b>0||Math.abs(to.z-from.z)<1e-6)return null;
    const t=(door.z-from.z)/(to.z-from.z);
    if(t<0||t>1)return null;
    const crossX=from.x+(to.x-from.x)*t;
    if(Math.abs(crossX-door.x)>door.width*.5+.3)return null;
    return {x:crossX,z:door.z,side:Math.sign(b)||1};
  }

  function activateCheckpoint(id, point, announce = true) {
    if (!state || !point) return false;
    const support=sampleSupport(point.x,point.z);
    const final={x:point.x,z:point.z,y:Number(support?.y ?? point.y ?? 0)};
    state.checkpoints.active={id,point:final,at:performance.now()};
    state.checkpoints.triggered.add(id);
    state.checkpoints.activationCount++;
    if(announce)deps?.showToast?.('Checkpoint',true);
    return true;
  }

  function updateDoorwayCheckpoints() {
    const nowPoint=playerWorld();
    if(!nowPoint||state.activeRope||state.flight){state.lastPlayerWorld=nowPoint;return;}
    const previous=state.lastPlayerWorld;
    if(previous){
      for(const door of state.checkpoints.doorways){
        const crossing=doorwayCrossing(door,previous,nowPoint);
        if(!crossing)continue;
        const inset=.72;
        const point=door.axis==='x'
          ? {x:door.x+crossing.side*inset,z:crossing.z,y:nowPoint.y}
          : {x:crossing.x,z:door.z+crossing.side*inset,y:nowPoint.y};
        activateCheckpoint(door.id,point,true);
        break;
      }
    }
    state.lastPlayerWorld=nowPoint;
  }

  function clearPlayerAfflictions(player) {
    const rs=window.ResourceSystem;
    if(!player||!rs?.AFFLICTIONS||typeof rs.removeAffliction!=='function')return;
    for(const id of Object.keys(rs.AFFLICTIONS)){
      const amount=Number(rs.getAffliction?.(player,id))||0;
      if(amount>0)rs.removeAffliction(player,id,amount+1);
    }
    rs.enforceCaps?.(player);
  }

  function restorePlayerScene(context) {
    const scene=context?.scene;
    if(!scene)return;
    const objects=[deps?.playerMesh,deps?.playerGroundShadow,deps?.toolHolder,deps?.reticleMesh,deps?.reticleCircleMesh,deps?.reticleRingMesh,deps?.reticleWavyGroup].filter(Boolean);
    for(const object of objects){
      object.parent?.remove?.(object);
      scene.add(object);
    }
  }

  function respawnAtCheckpoint(reason='death') {
    if(!state?.checkpoints?.active||!deps?.player)return false;
    const checkpoint=state.checkpoints.active;
    const context=state.context;
    deps.setCurrentArea?.(MAP_ID);
    deps.setCurrentBuildingMapId?.(MAP_ID);
    restorePlayerScene(context);
    clearPlayerAfflictions(deps.player);
    deps.player.health=Math.max(1,Math.round((Number(deps.player.maxHealth)||1)*.5));
    if(Number.isFinite(Number(deps.player.maxStamina)))deps.player.stamina=Number(deps.player.maxStamina);
    if(Number.isFinite(Number(deps.player.maxFooting)))deps.player.footing=Number(deps.player.maxFooting);
    if(deps.player.exhaustion){deps.player.exhaustion.active=false;deps.player.exhaustion.blackStamina=100;}
    deps.player.prone=false;
    if(deps.player.staggered)deps.player.staggered={active:false,direction:null,endsAt:0};
    deps.player.invulnUntil=performance.now()+CHECKPOINT_INVULN_MS;
    setPlayerWorld(checkpoint.point,true);
    state.flight=null;
    if(state.activeRope){state.activeRope.attached=false;state.activeRope.braking=false;}
    state.activeRope=null;
    state.lastPlayerWorld=clonePoint(checkpoint.point);
    deps._snapCameraTarget?.();
    deps.refreshActionBar?.();
    deps.showToast?.('Returned to the last ruin checkpoint.',true);
    state.checkpoints.respawnCount++;
    state.checkpoints.lastReason=String(reason||'death');
    return true;
  }

  function installDeathHooks() {
    if(PlayerVitals?.init && !PlayerVitals.init.__devRandomRuinCheckpointWrapped){
      const previous=PlayerVitals.init;
      const wrapped=function(injectedDeps){
        if(!injectedDeps)return previous.call(this,injectedDeps);
        const originalDeath=injectedDeps.handlePlayerDeath;
        const next={...injectedDeps,handlePlayerDeath:(reason)=>{
          if(inRuin()&&respawnAtCheckpoint(reason||'resource-tick'))return true;
          return originalDeath?.(reason);
        }};
        return previous.call(this,next);
      };
      wrapped.__devRandomRuinCheckpointWrapped=true;
      PlayerVitals.init=wrapped;
    }
    if(Combat?.init && !Combat.init.__devRandomRuinCheckpointWrapped){
      const previous=Combat.init;
      const wrapped=function(injectedDeps){
        const baseDamage=injectedDeps?.damagePlayer;
        if(typeof baseDamage==='function'&&!baseDamage.__devRandomRuinCheckpointWrapped){
          const damageWrapped=function(...args){
            const wasInRuin=inRuin()&&!!state?.checkpoints?.active;
            const beforeHealth=Number(injectedDeps.player?.health)||0;
            const result=baseDamage.apply(this,args);
            if(wasInRuin){
              const lethalNow=(Number(injectedDeps.player?.health)||0)<=0;
              const canonicalMoved=currentArea()!==MAP_ID;
              if(lethalNow||canonicalMoved){
                pendingDeathRecoveryUntil=performance.now()+2500;
                respawnAtCheckpoint('direct-hit');
              }else if(beforeHealth>0&&(Number(injectedDeps.player?.health)||0)>beforeHealth&&currentArea()!==MAP_ID){
                pendingDeathRecoveryUntil=performance.now()+2500;
                respawnAtCheckpoint('direct-hit');
              }
            }
            return result;
          };
          damageWrapped.__devRandomRuinCheckpointWrapped=true;
          damageWrapped.__devRandomRuinCheckpointBase=baseDamage;
          injectedDeps.damagePlayer=damageWrapped;
        }
        return previous.call(this,injectedDeps);
      };
      wrapped.__devRandomRuinCheckpointWrapped=true;
      Combat.init=wrapped;
    }
  }

  function buildCheckpoints(context) {
    const entry=supportPoint(context.spawn.x,context.spawn.z,0);
    state.checkpoints={
      active:null,
      doorwayCount:(context.meta?.doorways||[]).length,
      doorways:(context.meta?.doorways||[]).map((door,index)=>doorwayWorld(context.meta,door,index)),
      triggered:new Set(),
      activationCount:0,
      respawnCount:0,
      lastReason:null,
    };
    activateCheckpoint('ruin-entry',entry,false);
    state.lastPlayerWorld=playerWorld()||entry;
  }

  function buildForContext(context) {
    clearState();
    const group=new THREE.Group();
    group.name='dev_random_ruin_simple_puzzles';
    group.userData.devRandomRuinSimplePuzzles=true;
    context.scene.add(group);
    state={
      context,
      root:context.root,
      group,
      controls:[],
      safeGrids:[],
      ropes:[],
      trapHallways:[],
      projectiles:[],
      surfaceIds:new Set(),
      activeRope:null,
      flight:null,
      elapsed:0,
      lastPlayerWorld:null,
      checkpoints:null,
      buildSeed:Number(context.seed)||0,
    };
    buildCheckpoints(context);
    const rng=seededRng((Number(context.seed)||0)^0x7f4a7c15);
    const usedRooms=new Set();
    const options=context.puzzleOptions||{};
    if(options.safePath!==false)buildSafePathGrid(context,rng,usedRooms);
    if(options.ropeSwing!==false)buildRopeSwing(context,rng,usedRooms);
    if(options.hallwayTraps!==false)buildHallwayTraps(context,rng);
    updateBadge();
  }

  function updateSafeGrids(now) {
    const player=playerWorld();
    if(!player)return;
    for(const grid of state.safeGrids){
      const revealing=now<grid.revealUntil;
      grid.capMat.color.setHex(revealing?0xc9f7a2:0x718a72);
      let occupied=null;
      for(const cell of grid.cells){
        const on=Math.abs(player.x-cell.x)<=.34&&Math.abs(player.z-cell.z)<=.34;
        if(on)occupied=cell;
        cell.mesh.position.y=cell.y+.028-(on?.032:0);
        const color=revealing&&cell.safe?0x8fe67f:(now-cell.lastTriggeredAt<260?0xff5b2b:0x57534a);
        cell.material.color.setHex(color);
      }
      const key=occupied?.key||null;
      if(occupied&&!occupied.safe&&grid.lastPlayerKey!==key&&now-occupied.lastTriggeredAt>=GRID_RETRIGGER_MS){
        occupied.lastTriggeredAt=now;
        grid.triggerCount++;
        window.ResourceSystem?.addAffliction?.(deps.player,'burningHealth',GRID_BURNING);
        deps.showToast?.('Wrong pressure plate — Burning Health!',false);
      }
      grid.lastPlayerKey=key;
    }
  }

  function ropeIntent(rope) {
    const vx=(Number(deps?.player?.vx)||0)/(Number(deps?.TILE)||1);
    const vz=(Number(deps?.player?.vy)||0)/(Number(deps?.TILE)||1);
    const dx=Math.cos(rope.yaw),dz=Math.sin(rope.yaw);
    const sx=-dz,sz=dx;
    return {
      forward:Math.max(-1,Math.min(1,(vx*dx+vz*dz)/3)),
      side:Math.max(-1,Math.min(1,(vx*sx+vz*sz)/3)),
      speed:Math.hypot(vx,vz),
    };
  }

  function updateAttachedRope(rope,dt) {
    const intent=ropeIntent(rope);
    if(rope.braking){
      rope.omega*=Math.exp(-9*dt);
      rope.yaw+=intent.side*1.6*dt;
      rope.length=Math.max(ROPE_MIN_LENGTH,Math.min(rope.maxLength,rope.length-intent.forward*.9*dt));
    }else{
      rope.omega+=intent.forward*2.45*dt;
      rope.omega+=(-ROPE_GRAVITY/Math.max(.4,rope.length))*Math.sin(rope.angle)*dt;
      rope.omega*=Math.exp(-.16*dt);
      rope.angle+=rope.omega*dt;
      if(Math.abs(rope.angle)>1.28){rope.angle=Math.sign(rope.angle)*1.28;rope.omega*=.72;}
    }
    const bob=updateRopeVisual(rope);
    setPlayerWorld(bob,true);
    deps.player.vx=0;deps.player.vy=0;
  }

  function updateIdleRope(rope,dt) {
    rope.omega+=(-ROPE_GRAVITY/Math.max(.4,rope.length))*Math.sin(rope.angle)*dt;
    rope.omega*=Math.exp(-.28*dt);
    rope.angle+=rope.omega*dt;
    updateRopeVisual(rope);
    if(state.flight)return;
    const player=playerWorld();
    if(!player)return;
    const nearGrab=Math.hypot(player.x-rope.grabPoint.x,player.z-rope.grabPoint.z)<=ROPE_GRAB_RADIUS;
    const nearBob=Math.hypot(player.x-rope.bob.x,player.z-rope.bob.z)<=ROPE_GRAB_RADIUS*.72;
    if(nearGrab||nearBob)attachRope(rope);
  }

  function updateFlight(dt) {
    const f=state.flight;
    if(!f)return;
    f.vy-=ROPE_GRAVITY*dt;
    f.x+=f.vx*dt;f.z+=f.vz*dt;f.y+=f.vy*dt;
    const support=sampleSupport(f.x,f.z,f.y+.25);
    if(support&&f.vy<=0&&f.y<=Number(support.y)+.08){
      f.y=Number(support.y);
      setPlayerWorld(f,true);
      state.flight=null;
      state.lastPlayerWorld=clonePoint(f);
      return;
    }
    if(f.y<-2.5){
      respawnAtCheckpoint('rope-fall');
      return;
    }
    setPlayerWorld(f,true);
  }

  function updateRopeHazards(now) {
    if(state.activeRope||state.flight)return;
    const player=playerWorld();
    if(!player)return;
    for(const rope of state.ropes){
      const hazard=rope.hazard;
      const along=hazard.axis==='x'?Math.abs(player.x-hazard.cx):Math.abs(player.z-hazard.cz);
      const cross=hazard.axis==='x'?Math.abs(player.z-hazard.cz):Math.abs(player.x-hazard.cx);
      if(along<=hazard.length*.5&&cross<=hazard.width*.5&&
        !pointInsidePlatform(player,rope.startPlatform,.05)&&!pointInsidePlatform(player,rope.endPlatform,.05)&&
        now-hazard.lastBurnAt>1100){
        hazard.lastBurnAt=now;
        window.ResourceSystem?.addAffliction?.(deps.player,'burningHealth',ROPE_FALL_BURNING);
      }
    }
  }

  function updateRopes(now,dt) {
    updateFlight(dt);
    if(state.flight)return;
    for(const rope of state.ropes){
      if(rope.attached)updateAttachedRope(rope,dt);
      else updateIdleRope(rope,dt);
    }
    updateRopeHazards(now);
  }

  function updateHallwayTraps(dt) {
    state.elapsed+=dt;
    for(const trap of state.trapHallways){
      for(const station of trap.stations){
        if(state.elapsed>=station.nextAt){
          spawnTrapProjectile(trap,station);
          station.nextAt+=HALL_SHOT_PERIOD;
        }
      }
    }
    const player=playerWorld();
    for(let index=state.projectiles.length-1;index>=0;index--){
      const projectile=state.projectiles[index];
      projectile.age+=dt;
      projectile.x+=projectile.vx*dt;projectile.z+=projectile.vz*dt;
      projectile.mesh.position.x=projectile.x;projectile.mesh.position.z=projectile.z;
      let hit=false;
      if(player&&Math.hypot(player.x-projectile.x,player.z-projectile.z)<.34&&Math.abs(player.y-projectile.y)<1.05){
        if(projectile.kind==='fire')window.ResourceSystem?.addAffliction?.(deps.player,'burningHealth',HALL_FIRE_BURNING);
        else window.ResourceSystem?.addAffliction?.(deps.player,'poisonedHealth',HALL_POISON);
        deps.showToast?.(projectile.kind==='fire'?'Scorched by a wall trap!':'Poisoned by a wall dart!',false);
        hit=true;
      }
      if(hit||projectile.age>=projectile.maxAge){
        projectile.mesh.parent?.remove?.(projectile.mesh);
        projectile.mesh.geometry?.dispose?.();
        projectile.mesh.material?.dispose?.();
        state.projectiles.splice(index,1);
      }
    }
  }

  function updateBadge() {
    if(!state)return;
    const badge=document.getElementById('devRandomRuinBadge');
    if(!badge)return;
    const base=badge.textContent.replace(/ · simple G\d+ R\d+ T\d+ CP \d+\/\d+$/,'');
    const cp=state.checkpoints;
    badge.textContent=base+' · simple G'+state.safeGrids.length+' R'+state.ropes.length+' T'+state.trapHallways.length+' CP '+cp.triggered.size+'/'+(cp.doorwayCount+1);
  }

  function update() {
    const now=performance.now();
    const dt=Math.max(0,Math.min(.05,(now-lastFrameMs)/1000));
    lastFrameMs=now;

    if(state&&pendingDeathRecoveryUntil>now&&currentArea()!==MAP_ID){
      respawnAtCheckpoint('death-transition');
      return;
    }
    if(!inRuin()){
      if(state)clearState();
      return;
    }
    const context=window.DevRandomRuin?.getRuntimeContext?.()||null;
    if(!context?.root||!context?.scene)return;
    if(!state||state.root!==context.root)buildForContext(context);

    updateSafeGrids(now);
    updateRopes(now,dt);
    updateHallwayTraps(dt);
    updateDoorwayCheckpoints();
    updateBadge();
  }

  function getInteractionControls() {
    if(!state||!inRuin())return [];
    const controls=state.controls.slice();
    const rope=state.activeRope;
    if(rope){
      controls.push({
        kind:'ropeRelease',
        object:rope.marker,
        promptRoot:rope.marker,
        range:99,
        priority:100,
        touchIcon:'↗',
        label:'Release Rope',
        onPress:()=>releaseRope(rope),
      });
      controls.push({
        kind:'ropeBrake',
        object:rope.marker,
        promptRoot:rope.marker,
        range:99,
        priority:99,
        touchIcon:'✋',
        label:'Hold to Stop / Adjust Rope',
        onHoldStart:()=>{rope.braking=true;},
        onHoldEnd:()=>{rope.braking=false;},
      });
    }
    return controls;
  }

  function snapshot() {
    if(!state)return {active:false};
    const now=performance.now();
    return {
      active:true,
      seed:state.buildSeed,
      safeGrids:state.safeGrids.map(grid=>({
        roomId:grid.roomId,
        revealMs:Math.max(0,Math.round(grid.revealUntil-now)),
        triggerCount:grid.triggerCount,
        safe:grid.cells.filter(cell=>cell.safe).map(cell=>({key:cell.key,x:+cell.x.toFixed(3),z:+cell.z.toFixed(3)})),
        unsafe:grid.cells.filter(cell=>!cell.safe).map(cell=>({key:cell.key,x:+cell.x.toFixed(3),z:+cell.z.toFixed(3)})),
      })),
      ropes:state.ropes.map(rope=>({
        id:rope.id,roomId:rope.roomId,attached:rope.attached,braking:rope.braking,
        length:+rope.length.toFixed(3),angle:+rope.angle.toFixed(3),
        anchor:clonePoint(rope.anchor),bob:clonePoint(rope.bob),grabPoint:clonePoint(rope.grabPoint),
      })),
      flight:state.flight?clonePoint(state.flight):null,
      trapHallways:state.trapHallways.map(trap=>({id:trap.id,axis:trap.axis,stations:trap.stations.length})),
      liveProjectiles:state.projectiles.length,
      checkpoints:{
        activeId:state.checkpoints.active?.id||null,
        activePoint:clonePoint(state.checkpoints.active?.point),
        triggered:[...state.checkpoints.triggered],
        doorwayCount:state.checkpoints.doorwayCount,
        activationCount:state.checkpoints.activationCount,
        respawnCount:state.checkpoints.respawnCount,
        lastReason:state.checkpoints.lastReason,
      },
    };
  }

  installDeathHooks();
  DS.addBeforeRenderClient(update);

  window.DevRandomRuinSimplePuzzles=Object.freeze({
    getInteractionControls,
    ownsPlayerMotion:()=>!!(state?.activeRope||state?.flight),
    respawnAtCheckpoint,
    snapshot,
    clear:clearState,
  });
})();
