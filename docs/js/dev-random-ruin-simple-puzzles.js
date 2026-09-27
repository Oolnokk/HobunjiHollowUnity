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
  const GRID_WALL_CLEARANCE = 0.52; // Used by safe-path grids so every plate center clears the ruin player's 0.28u collision radius plus the authored wall thickness.
  const HALL_FIRE_BURNING = 18;
  const HALL_POISON = 16;
  const HALL_SHOT_PERIOD = 0.9;
  const ROPE_FALL_BURNING = 14;
  const ROPE_GRAB_RADIUS = 0.8;
  const ROPE_GRAVITY = 8.2;
  const ROPE_MIN_LENGTH = 1.65;
  const CHECKPOINT_INVULN_MS = 1200;
  const KURRAYA_NOTE_URL = 'assets/audio/music/instruments/sfx_kurraya_pluck.m4a'; // Shared authored pluck used by modular musical pressure plates until a dedicated ruin-note sample exists.
  const CHORD_PITCHES = Object.freeze([1, 1.25, 1.5, 1.875]); // Root, major third, fifth, major seventh; four independent plates form one recognisable chord without requiring an order.

  const DS = window.DynamicSurfaces;
  const GridTileAccessors = window.GridTileAccessors;
  const DevSpawner = window.DevSpawner;
  if (!DS || !GridTileAccessors || !DevSpawner || !window.THREE) return;

  let deps = null;
  let state = null;
  let lastFrameMs = performance.now();
  let lastBadgeAt = -Infinity; // Throttles the mobile diagnostic DOM write; the simple runtime otherwise touched layout every rendered frame.
  let lastBadgeText = '';

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

  function setPlayerWorld(point, setHeight = true, grounded = false) {
    if (!point || !deps?.player || !deps?.TILE) return false;
    if (setHeight && typeof window.DevRandomRuin?.setPlayerWorldPoint === 'function') {
      return window.DevRandomRuin.setPlayerWorldPoint(point, { snapCamera:false, grounded });
    }
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

  let modularProjectileHookInstalled=false; // One wrapper handles every reusable canopy/glyph module without each puzzle installing its own ranged-weapon seam.
  let modularProjectileUpdateDepth=0; // Restricts modular segment tests to real ranged-projectile updates, matching the existing ruin glyph hook's authority.

  function segmentBoxInterval(start,end,rawBox,radius=0) {
    if(!rawBox)return null;
    const box=rawBox.clone();box.expandByScalar(Math.max(0,Number(radius)||0));
    let enter=0,exit=1;
    for(const axis of ['x','y','z']){
      const delta=end[axis]-start[axis],min=box.min[axis],max=box.max[axis];
      if(Math.abs(delta)<1e-9){if(start[axis]<min||start[axis]>max)return null;continue;}
      let a=(min-start[axis])/delta,b=(max-start[axis])/delta;if(a>b)[a,b]=[b,a];
      enter=Math.max(enter,a);exit=Math.min(exit,b);if(enter>exit)return null;
    }
    return exit>=0&&enter<=1?{enter:Math.max(0,Math.min(1,enter)),exit:Math.max(0,Math.min(1,exit))}:null;
  }

  function modularProjectileHit(start,end,radius) {
    if(!state||!inRuin())return null;
    let nearest=null;
    const consider=(object,kind,record)=>{
      if(!object?.visible)return;
      object.updateWorldMatrix?.(true,true);
      const box=new THREE.Box3().setFromObject(object);
      if(box.isEmpty())return;
      const interval=segmentBoxInterval(start,end,box,Math.max(.02,Number(radius)||0));
      if(!interval||(nearest&&interval.enter>=nearest.t))return;
      nearest={t:interval.enter,object,kind,record};
    };
    for(const canopy of state.canopies)consider(canopy.slab,'canopy',canopy);
    for(const glyph of state.ceilingGlyphs)if(!glyph.active)consider(glyph.mesh,'glyph',glyph);
    return nearest;
  }

  function activateCeilingGlyph(glyph) {
    if(!glyph||glyph.active)return false;
    glyph.active=true;glyph.hitCount++;
    glyph.material.color.setHex(0x8fe6ff);
    deps?.showToast?.('Ceiling glyph struck.',true);
    try{glyph.onActivate?.(glyph);}catch(error){console.warn('[Random Test Ruin] ceiling glyph activation failed',error);}
    return true;
  }

  function installModularProjectileHook() {
    if(modularProjectileHookInstalled)return true;
    const ranged=window.RangedWeapons,cover=window.NearbyVolumeCollision;
    if(!ranged?.update||!cover?.segmentHit)return false;
    const nativeUpdate=ranged.update,nativeSegmentHit=cover.segmentHit;
    ranged.update=function(...args){
      modularProjectileUpdateDepth++;
      try{return nativeUpdate.apply(this,args);}finally{modularProjectileUpdateDepth--;}
    };
    cover.segmentHit=function(start,end,radiusWorld=0){
      const ordinary=nativeSegmentHit.call(this,start,end,radiusWorld);
      if(modularProjectileUpdateDepth<=0||!state||!inRuin())return ordinary;
      const modular=modularProjectileHit(start,end,radiusWorld);
      if(!modular||(ordinary&&Number.isFinite(Number(ordinary.t))&&Number(ordinary.t)<=modular.t))return ordinary;
      if(modular.kind==='glyph')activateCeilingGlyph(modular.record);
      return {
        t:modular.t,
        distanceWorld:start.distanceTo?.(end)*modular.t||0,
        object:modular.object,
        kind:modular.kind==='glyph'?'ruinModularGlyph':'ruinStoneCanopy',
        key:modular.record?.id||null,
        point:start.clone?.().lerp?start.clone().lerp(end,modular.t):null,
      };
    };
    modularProjectileHookInstalled=true;
    return true;
  }

  function recordModulePlacement(type, slotKind, slotId, extra = {}) {
    if(!state)return null;
    const record={type,slotKind,slotId:String(slotId||''),...extra}; // Runtime diagnostics use these records to prove compound puzzles are assembled from reusable pieces rather than one bespoke scene.
    state.modulePlacements.push(record);
    return record;
  }

  function playKurrayaPlateNote(index) {
    const pitch=CHORD_PITCHES[Math.max(0,Math.min(CHORD_PITCHES.length-1,Number(index)||0))]; // Each plate owns one stable chord tone.
    window.AudioSystem?.playObjectSfx?.({url:KURRAYA_NOTE_URL,volume:.58,pitchVarianceMul:0},1,pitch);
  }

  function playGeneratedStoneKchunk() {
    const AudioCtx=window.AudioContext||window.webkitAudioContext; // Temporary procedural completion cue; intended to be replaced by a recorded stone kchunk asset later.
    if(!AudioCtx)return false;
    try{
      const ctx=playGeneratedStoneKchunk._ctx||(playGeneratedStoneKchunk._ctx=new AudioCtx());
      ctx.resume?.();
      const now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
      osc.type='square';osc.frequency.setValueAtTime(92,now);osc.frequency.exponentialRampToValueAtTime(46,now+.18);
      filter.type='lowpass';filter.frequency.value=520;
      gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.16,now+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+.24);
      osc.connect(filter).connect(gain).connect(ctx.destination);osc.start(now);osc.stop(now+.25);
      return true;
    }catch(_){return false;}
  }

  function disposeObject(root) {
    if (!root) return;
    const geometries = new Set(), materials = new Set();
    root.traverse?.(object => {
      if (object.geometry) geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of list) materials.add(material);
    });
    root.parent?.remove?.(root);
    // NaturalSurfaceMaterials can reuse cached carved_smooth textures across the
    // ruin. Dispose our material wrappers/geometry only; never dispose shared maps.
    for (const material of materials) material.dispose?.();
    for (const geometry of geometries) geometry.dispose?.();
  }

  function restoreRopeEquipment() {
    const snapshot=state?.ropeHeldToolSnapshot||null; // Exact drawn weapon/tool + action captured when the rope took movement/input ownership.
    if(!snapshot)return false;
    state.ropeHeldToolSnapshot=null;
    const restored=deps?.restoreHeldToolSnapshot?.(snapshot) === true;
    if(restored)state.ropeEquipmentRestoreCount++;
    return restored;
  }

  function holsterRopeEquipment() {
    if(!state||state.ropeHeldToolSnapshot||deps?.getHeldMode?.()!=='tool')return false;
    const snapshot={tool:deps.getActiveTool?.()||null,action:deps.getActiveAction?.()||'none'};
    if(!snapshot.tool||typeof deps?.putAwayHeldEquipment!=='function')return false;
    state.ropeHeldToolSnapshot=snapshot;
    deps.putAwayHeldEquipment({silent:true}); // Prevents attack buttons/input from competing with rope prompts while the player is hanging.
    state.ropeEquipmentHolsterCount++;
    return true;
  }

  function clearState() {
    if (!state) return;
    restoreRopeEquipment();
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
    return { centerX, centerZ, y:ys.reduce((sum,value) => sum + value, 0) / ys.length, bounds }; // Plates/platforms ground to their own support; authored plateau steps are valid, not a generation failure.
  }

  function safePathCells(cols, rows, rng) {
    const path = new Set();
    let col = Math.floor(rng() * cols);
    for (let row = 0; row < rows; row++) {
      path.add(col + ',' + row);
      if (row >= rows - 1) continue;
      const next = Math.max(0, Math.min(cols - 1, col + (Math.floor(rng() * 3) - 1)));
      if (next !== col) path.add(next + ',' + row);
      col = next;
    }
    return path;
  }

  function buildSafePathGrid(context, rng, usedHallways) {
    const cs = worldCellSize(context.meta);
    const candidates = shuffle((context.meta?.hallways || []).filter(hall => {
      const longCells = hall.axis === 'x' ? Number(hall.w) : Number(hall.h);
      const crossCells = hall.axis === 'x' ? Number(hall.h) : Number(hall.w);
      return longCells >= 5 && crossCells >= 5 && !usedHallways.has(hall.id);
    }), rng);

    for (const hall of candidates) {
      const axis = hall.axis === 'z' ? 'z' : 'x';
      const longStart = PAD + (axis === 'x' ? Number(hall.col) : Number(hall.row)) * cs;
      const longLength = (axis === 'x' ? Number(hall.w) : Number(hall.h)) * cs;
      const crossStart = PAD + (axis === 'x' ? Number(hall.row) : Number(hall.col)) * cs;
      const crossWidth = (axis === 'x' ? Number(hall.h) : Number(hall.w)) * cs;
      const cols = Math.max(5, Math.min(9, Math.ceil(crossWidth / .76)));
      const rows = Math.max(5, Math.min(8, Math.floor((longLength - 1.4) / .72) + 1));
      if (rows < 5) continue;

      const crossMargin = GRID_WALL_CLEARANCE;
      const alongMargin = .7;
      const crossSpacing = (crossWidth - crossMargin * 2) / Math.max(1, cols - 1);
      const alongSpan = Math.min(longLength - alongMargin * 2, .78 * (rows - 1));
      const alongSpacing = alongSpan / Math.max(1, rows - 1);
      const plateSize = Math.max(.52, Math.min(.72, crossSpacing * .94, alongSpacing * .94));
      const originAlong = longStart + (longLength - alongSpan) * .5;
      const originCross = crossStart + crossMargin;
      const safe = safePathCells(cols, rows, rng);

      const root = new THREE.Group();
      root.name = 'dev_ruin_safe_path_grid_' + hall.id;
      root.userData.devRandomRuinSimplePuzzle = 'safePath';
      root.userData.devRandomRuinMandatoryTraversal = true;
      state.group.add(root);

      const cells = [];
      let invalidPatch = false;
      for (let row = 0; row < rows && !invalidPatch; row++) {
        for (let col = 0; col < cols; col++) {
          const key = col + ',' + row;
          const along = originAlong + row * alongSpacing;
          const cross = originCross + col * crossSpacing;
          const x = axis === 'x' ? along : cross;
          const z = axis === 'x' ? cross : along;
          const support = sampleSupport(x, z);
          if (!support) { invalidPatch = true; break; }
          const material = makeBasic(0x57534a);
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(plateSize,.055,plateSize), material);
          mesh.position.set(x, Number(support.y)+.028, z);
          mesh.name = 'dev_ruin_pressure_plate_' + hall.id + '_' + key.replace(',','_');
          mesh.userData.devRandomRuinPressurePlate = true;
          mesh.userData.safePathCell = safe.has(key);
          root.add(mesh);
          cells.push({ key, col, row, x, z, y:Number(support.y), safe:safe.has(key), mesh, material, lastTriggeredAt:-Infinity });
        }
      }
      if (invalidPatch || cells.length !== cols * rows) {
        disposeObject(root);
        continue;
      }

      const buttonAlong = Math.max(longStart + .18, originAlong - Math.max(.58, alongSpacing * .82));
      const buttonCross = crossStart + crossWidth * .5;
      const buttonX = axis === 'x' ? buttonAlong : buttonCross;
      const buttonZ = axis === 'x' ? buttonCross : buttonAlong;
      const buttonSupport = sampleSupport(buttonX, buttonZ) || { y:cells[0]?.y || 0 };
      const button = new THREE.Group();
      button.name = 'dev_ruin_safe_path_button_' + hall.id;
      button.userData.devRuinInteractionType = 'safePathReveal';
      button.userData.interactive3D = true;
      const pedestal = naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(.62,.35,.62), makeBasic(0x777777)));
      pedestal.position.y = .175;
      const capMat = makeBasic(0x718a72);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(.42,.09,.42), capMat);
      cap.position.y = .395;
      button.add(pedestal,cap);
      button.position.set(buttonX, Number(buttonSupport.y), buttonZ);
      root.add(button);

      const grid = {
        hallId:String(hall.id), axis, cols, rows, root, cells, safe, button, capMat,
        revealUntil:0, lastPlayerKey:null, triggerCount:0,
      };
      state.safeGrids.push(grid);
      state.controls.push({
        kind:'safePathReveal', object:button, promptRoot:button, range:1.9, priority:20, touchIcon:'✦',
        label:'Reveal Safe Path',
        onPress:() => {
          grid.revealUntil = performance.now() + GRID_REVEAL_MS;
          deps?.showToast?.('The safe pressure plates flare briefly.', true);
        },
      });
      usedHallways.add(hall.id);
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
    const intent=ropeIntent(rope,true); // Preserve the approach impulse on auto-grab; attached pumping switches to the game's published movement intent.
    rope.angle=rope.launchAngle;
    rope.omega=Math.max(.28,intent.forward*.9);
    rope.attached = true;
    rope.braking = false;
    state.activeRope = rope;
    holsterRopeEquipment();
    updateRopeVisual(rope);
    deps?.showToast?.('Caught the rope — move to pump; Dodge to jump off.', true);
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
    restoreRopeEquipment();
    return true;
  }

  function createRopeTraversalBetween(context,room,pa,pb,idSuffix='') {
    const dx=pb.x-pa.x,dz=pb.z-pa.z;
    const axis=Math.abs(dx)>=Math.abs(dz)?'x':'z';
    const separation=axis==='x'?Math.abs(dx):Math.abs(dz);
    if(separation<4.4)return null;
    const dirX=dx/Math.max(.001,Math.hypot(dx,dz)),dirZ=dz/Math.max(.001,Math.hypot(dx,dz));
    const bounds=roomBounds(context.meta,room),roomWidth=bounds.maxX-bounds.minX,roomDepth=bounds.maxZ-bounds.minZ;
    const cx=(pa.x+pb.x)*.5,cz=(pa.z+pb.z)*.5;
    const sm=sampleSupport(cx,cz)||{y:Math.min(Number(pa.baseY)||0,Number(pb.baseY)||0)};
    const hazardLength=Math.max(1.5,separation-(axis==='x'?Math.min(pa.width,pb.width):Math.min(pa.depth,pb.depth)));
    const hazardWidth=Math.min(2.2,(axis==='x'?roomDepth:roomWidth)-2);
    const hazard=new THREE.Mesh(
      new THREE.BoxGeometry(axis==='x'?hazardLength:hazardWidth,.025,axis==='x'?hazardWidth:hazardLength),
      makeBasic(0x5e2118,{transparent:true,opacity:.62})
    );
    hazard.name='dev_ruin_rope_hazard_'+room.id+(idSuffix?'_'+idSuffix:'');
    hazard.position.set(cx,Number(sm.y)+.014,cz);
    hazard.userData.devRandomRuinRopeHazard=true;
    state.group.add(hazard);

    const alongPlatformSize=axis==='x'?pa.width:pa.depth;
    const swingHorizontal=Math.max(.8,separation*.5-alongPlatformSize*.46);
    const topY=Math.max(Number(pa.topY)||0,Number(pb.topY)||0);
    const ceilingBase=Number(context.meta?.floorSurfaceY)||0;
    const wallHeight=Number(context.meta?.wallHeight)||3;
    const anchorY=ceilingBase+wallHeight-.035;
    const bobRestY=topY+.72;
    const verticalDrop=anchorY-bobRestY;
    if(verticalDrop<=.6){disposeObject(hazard);return null;}
    const length=Math.hypot(swingHorizontal,verticalDrop),startAngle=Math.atan2(swingHorizontal,verticalDrop);

    const mount=naturalizeStone(new THREE.Mesh(new THREE.CylinderGeometry(.15,.11,.10,10),makeBasic(0x808080)));
    mount.name='dev_ruin_swing_rope_ceiling_mount_'+room.id+(idSuffix?'_'+idSuffix:'');
    mount.position.set(cx,anchorY-.025,cz);
    mount.userData.devRandomRuinRopeCeilingMount=true;
    state.group.add(mount);

    const lineGeometry=new THREE.BufferGeometry();
    lineGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
    const line=new THREE.Line(lineGeometry,new THREE.LineBasicMaterial({color:0xc9ad77,transparent:true,opacity:.96}));
    line.name='dev_ruin_swing_rope_'+room.id+(idSuffix?'_'+idSuffix:'');
    line.frustumCulled=false;state.group.add(line);
    const marker=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),makeBasic(0xd1b682));
    marker.name='dev_ruin_swing_rope_grip_'+room.id+(idSuffix?'_'+idSuffix:'');
    marker.userData.interactive3D=true;marker.userData.devRuinInteractionType='ropeSwing';state.group.add(marker);

    const grabPoint={x:cx-dirX*swingHorizontal,z:cz-dirZ*swingHorizontal,y:bobRestY};
    const rope={
      id:'rope-'+room.id+(idSuffix?'-'+idSuffix:''),
      roomId:room.id,line,marker,mount,anchor:{x:cx,y:anchorY,z:cz},ceilingY:anchorY,
      yaw:Math.atan2(dirZ,dirX),length,maxLength:length+.55,angle:-startAngle,launchAngle:-startAngle,omega:0,
      attached:false,braking:false,startPlatform:pa,endPlatform:pb,
      hazard:{mesh:hazard,cx,cz,length:hazardLength,width:hazardWidth,axis,lastBurnAt:-Infinity},
      grabPoint,bob:null,
    };
    updateRopeVisual(rope);state.ropes.push(rope);return rope;
  }

  function startPlatformForTarget(context,room,target,rng) {
    const bounds=roomBounds(context.meta,room),margin=1.45;
    const candidates=[
      {x:bounds.minX+margin,z:target.z},{x:bounds.maxX-margin,z:target.z},
      {x:target.x,z:bounds.minZ+margin},{x:target.x,z:bounds.maxZ-margin},
    ].filter(point=>point.x>bounds.minX+1&&point.x<bounds.maxX-1&&point.z>bounds.minZ+1&&point.z<bounds.maxZ-1)
      .map(point=>({...point,distance:Math.hypot(point.x-target.x,point.z-target.z),support:sampleSupport(point.x,point.z)}))
      .filter(point=>point.support&&point.distance>=4.4)
      .sort((a,b)=>b.distance-a.distance);
    if(!candidates.length)return null;
    const pick=candidates[Math.min(candidates.length-1,Math.floor(rng()*Math.min(2,candidates.length)))];
    const axis=Math.abs(pick.x-target.x)>=Math.abs(pick.z-target.z)?'x':'z';
    return createPlatform('dev_ruin_rope_balcony_'+room.id,pick.x,pick.z,Number(pick.support.y),axis==='x'?2.1:2.5,axis==='x'?2.5:2.1);
  }

  function buildRopeSwing(context,rng,usedRooms,options={}) {
    const candidates=options.room?[options.room]:usableRoomCandidates(context).filter(room=>!usedRooms.has(room.id));
    for(const room of candidates){
      const bounds=roomBounds(context.meta,room);
      let pa=null,pb=null;
      if(options.endPlatform){
        pb=options.endPlatform;
        pa=startPlatformForTarget(context,room,pb,rng);
        if(!pa)continue;
      }else{
        const roomWidth=bounds.maxX-bounds.minX,roomDepth=bounds.maxZ-bounds.minZ;
        const axis=roomWidth>=roomDepth?'x':'z',longSpan=axis==='x'?roomWidth:roomDepth;
        const separation=Math.max(4.6,Math.min(6.4,longSpan-3.5));if(separation<4.4)continue;
        const cx=(bounds.minX+bounds.maxX)*.5,cz=(bounds.minZ+bounds.maxZ)*.5,dir=axis==='x'?{x:1,z:0}:{x:0,z:1};
        const a={x:cx-dir.x*separation*.5,z:cz-dir.z*separation*.5},b={x:cx+dir.x*separation*.5,z:cz+dir.z*separation*.5};
        const sa=sampleSupport(a.x,a.z),sb=sampleSupport(b.x,b.z);if(!sa||!sb)continue;
        pa=createPlatform('dev_ruin_rope_platform_a_'+room.id,a.x,a.z,Number(sa.y),axis==='x'?2.1:2.5,axis==='x'?2.5:2.1);
        pb=createPlatform('dev_ruin_rope_platform_b_'+room.id,b.x,b.z,Number(sb.y),axis==='x'?2.1:2.5,axis==='x'?2.5:2.1);
      }
      const rope=createRopeTraversalBetween(context,room,pa,pb,options.idSuffix||'');
      if(!rope)continue;
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

  function buildHallwayTraps(context, rng, usedHallways = new Set(), forcedHallways = null) {
    const hallways=(context.meta?.hallways||[])
      .filter(hall => !usedHallways.has(hall.id) && (hall.axis==='x'?Number(hall.w):Number(hall.h))>=5)
      .sort((a,b)=>(b.axis==='x'?Number(b.w):Number(b.h))-(a.axis==='x'?Number(a.w):Number(a.h)));
    const selected=Array.isArray(forcedHallways)?forcedHallways.filter(Boolean):shuffle(hallways,rng).slice(0,Math.min(2,hallways.length));
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
      usedHallways.add(hall.id);
      recordModulePlacement('projectileHallwayTrap','hallway',hall.id,{axis}); // Ordinary alternating wall traps now occupy the same generic hallway-module slot as other procedural pieces.
    }
  }

  function buildChordPlateSet(context, rng, slot, usedHallways = null) {
    if(!slot)return null;
    const isHallway=slot.kind==='hallway';
    const owner=slot.owner;
    const id=String(owner?.id||('slot-'+state.chordPlateSets.length));
    const points=[];
    if(isHallway){
      const hall=owner,axis=hall.axis==='z'?'z':'x',cs=worldCellSize(context.meta);
      const longStart=PAD+(axis==='x'?Number(hall.col):Number(hall.row))*cs;
      const longLength=(axis==='x'?Number(hall.w):Number(hall.h))*cs;
      const crossStart=PAD+(axis==='x'?Number(hall.row):Number(hall.col))*cs;
      const crossWidth=(axis==='x'?Number(hall.h):Number(hall.w))*cs;
      const centerCross=crossStart+crossWidth*.5;
      for(let i=0;i<4;i++){
        const along=longStart+longLength*((i+1)/5);
        const cross=centerCross+(i%2?1:-1)*Math.min(.65,crossWidth*.18);
        points.push(axis==='x'?{x:along,z:cross}:{x:cross,z:along});
      }
    }else{
      const bounds=slot.bounds||roomBounds(context.meta,owner); // Explicit bounds let the same plate-set module live inside generated micro-rooms as well as ordinary V50 rooms.
      const centerX=(bounds.minX+bounds.maxX)*.5,centerZ=(bounds.minZ+bounds.maxZ)*.5;
      const d=Math.min(1.15,Math.max(.62,Math.min(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ)*.28));
      points.push({x:centerX-d,z:centerZ-d},{x:centerX+d,z:centerZ-d},{x:centerX-d,z:centerZ+d},{x:centerX+d,z:centerZ+d});
    }
    const root=new THREE.Group();
    root.name='dev_ruin_chord_plates_'+id;
    root.userData.devRandomRuinSimplePuzzle='chordPlates';
    state.group.add(root);
    const plates=[];
    for(let i=0;i<4;i++){
      const p=points[i],support=sampleSupport(p.x,p.z);
      if(!support){disposeObject(root);return null;}
      const material=makeBasic(0x59544b);
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(.68,.06,.68),material);
      mesh.name='dev_ruin_chord_plate_'+id+'_'+i;
      mesh.position.set(p.x,Number(support.y)+.03,p.z);
      mesh.userData.devRandomRuinChordPlate=true;
      mesh.userData.chordNoteIndex=i;
      root.add(mesh);
      plates.push({index:i,x:p.x,z:p.z,y:Number(support.y),mesh,material,down:false,played:false,pressCount:0});
    }
    const set={id,slotKind:isHallway?'hallway':'room',root,plates,solved:false,solveCount:0,onComplete:typeof slot.onComplete==='function'?slot.onComplete:null};
    state.chordPlateSets.push(set);
    if(isHallway)usedHallways?.add?.(owner.id);
    recordModulePlacement('chordPressurePlates',set.slotKind,id,{plateCount:4});
    return set;
  }

  function roomDoorways(context, room) {
    return (context.meta?.doorways||[]).map((door,index)=>({door,index})).filter(entry=>entry.door?.from===room.id||entry.door?.to===room.id); // Shared room-connectivity query keeps lock-room selection independent from any one compound recipe.
  }

  function roomDoorway(context, room) {
    const entry=roomDoorways(context,room)[0];
    return entry?doorwayWorld(context.meta,entry.door,entry.index):null;
  }

  function buildLockableDoorModule(context, room, options = {}) {
    const doorway=options.doorway||roomDoorway(context,room);
    if(!doorway)return null;
    const support=sampleSupport(doorway.x,doorway.z);
    if(!support)return null;
    const thickness=.18,height=1.9,width=Math.max(.9,doorway.width*.82);
    const geometry=doorway.axis==='x'
      ? new THREE.BoxGeometry(thickness,height,width)
      : new THREE.BoxGeometry(width,height,thickness);
    const panel=naturalizeStone(new THREE.Mesh(geometry,makeBasic(0x808080)));
    panel.name='dev_ruin_modular_lock_door_'+room.id;
    panel.position.set(doorway.x,Number(support.y)+height*.5+(options.startOpen===false?0:height+.18),doorway.z);
    panel.userData.devRandomRuinModularDoor=true;
    state.group.add(panel);
    const blockerId='devruin-modular-door-'+room.id;
    const module={
      id:'lock-door-'+room.id,roomId:String(room.id),doorway,panel,baseY:Number(support.y)+height*.5,
      openY:Number(support.y)+height*.5+height+.18,progress:options.startOpen===false?0:1,targetOpen:options.startOpen!==false,
      blockerId,width,height,
    };
    DS.registerBlocker({
      id:blockerId,scope:SCOPE,
      bounds:()=>doorway.axis==='x'
        ? {minX:doorway.x-thickness*.6,maxX:doorway.x+thickness*.6,minZ:doorway.z-width*.5,maxZ:doorway.z+width*.5}
        : {minX:doorway.x-width*.5,maxX:doorway.x+width*.5,minZ:doorway.z-thickness*.6,maxZ:doorway.z+thickness*.6},
      minY:Number(support.y),maxY:Number(support.y)+height,
      enabled:()=>module.progress<.72,
      purpose:'modular_lock_door',
    });
    state.surfaceIds.add(blockerId);
    state.lockDoors.push(module);
    recordModulePlacement('lockableStoneDoor','doorway',module.id,{roomId:String(room.id)});
    return module;
  }

  function setLockDoorOpen(module, open) {
    if(!module)return false;
    module.targetOpen=open!==false;
    return true;
  }

  function buildStoneCanopyModule(context, room, anchor = null) {
    const bounds=roomBounds(context.meta,room);
    const support=anchor?sampleSupport(anchor.x,anchor.z):roomPatch(context,room,3.4,2.8);
    const x=anchor?.x??support?.centerX,z=anchor?.z??support?.centerZ,baseY=Number(anchor?.topY??support?.y);
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(baseY))return null;
    const width=Math.min(3.2,Math.max(2.2,(bounds.maxX-bounds.minX)*.35));
    const depth=Math.min(2.6,Math.max(1.8,(bounds.maxZ-bounds.minZ)*.28));
    const roofY=baseY+1.72;
    const root=new THREE.Group();
    root.name='dev_ruin_stone_canopy_'+room.id;
    const slab=naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(width,.22,depth),makeBasic(0x808080)));
    slab.position.set(x,roofY,z);slab.userData.devRandomRuinStoneCanopy=true;slab.userData.cameraObstacle=true;root.add(slab);
    const postOffsets=[[-width*.42,-depth*.38],[width*.42,-depth*.38]];
    for(const [dx,dz] of postOffsets){
      const post=naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(.22,1.7,.22),makeBasic(0x808080)));
      post.position.set(x+dx,baseY+.85,z+dz);root.add(post);
    }
    state.group.add(root);
    const module={id:'canopy-'+room.id,roomId:String(room.id),root,slab,x,z,roofY,width,depth};
    state.canopies.push(module);
    recordModulePlacement('stoneCanopy','room',module.id,{roomId:String(room.id)});
    return module;
  }

  function buildCeilingGlyphModule(context,room,anchor,options={}) {
    const ceilingBase=Number(context.meta?.floorSurfaceY)||0,wallHeight=Number(context.meta?.wallHeight)||3;
    const ceilingY=ceilingBase+wallHeight-.34;
    const x=Number(anchor?.x),z=Number(anchor?.z);
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    const material=makeBasic(0x466b70);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.29,.29,.10,8),material);
    mesh.rotation.x=Math.PI*.5; // Thin octagonal stone target faces horizontally into the room just below the ceiling.
    mesh.position.set(x,ceilingY,z);
    mesh.name='dev_ruin_modular_ceiling_glyph_'+room.id+'_'+state.ceilingGlyphs.length;
    mesh.userData.devRandomRuinModularGlyph=true;
    state.group.add(mesh);
    const glyph={id:'ceiling-glyph-'+room.id+'-'+state.ceilingGlyphs.length,roomId:String(room.id),mesh,material,active:false,hitCount:0,onActivate:typeof options.onActivate==='function'?options.onActivate:null};
    state.ceilingGlyphs.push(glyph);
    recordModulePlacement('ceilingProjectileGlyph','ceiling',glyph.id,{roomId:String(room.id)});
    return glyph;
  }

  function buildBalconyRopeElevatorComposer(context,rng,usedRooms) {
    const candidates=shuffle(usableRoomCandidates(context).filter(room=>!usedRooms.has(room.id)&&deepestSunkenRegionForRoom(context,room)),rng);
    for(const room of candidates){
      const elevator=buildCyclingElevatorModule(context,room,{startActive:false,cycleSeconds:8});
      if(!elevator)continue;
      const landing={mesh:elevator.mesh,x:elevator.x,z:elevator.z,width:elevator.width,depth:elevator.depth,baseY:elevator.topTopY-elevator.height,topY:elevator.topTopY};
      const rope=buildRopeSwing(context,rng,usedRooms,{room,endPlatform:landing,idSuffix:'elevator'});
      if(!rope){elevator.active=true;continue;} // If geometry cannot support the intended chain, the elevator remains a valid standalone cycling module instead of becoming dead machinery.
      const canopy=buildStoneCanopyModule(context,room,rope.startPlatform);
      const glyph=buildCeilingGlyphModule(context,room,{x:elevator.x,z:elevator.z},{onActivate:()=>activateCyclingElevator(elevator)});
      if(!glyph){elevator.active=true;return rope;}
      const module={id:'balcony-rope-elevator-'+room.id,roomId:String(room.id),rope,elevator,glyph,canopy};
      state.ropeElevatorComposers.push(module);
      recordModulePlacement('balconyRopeElevatorComposer','room',module.id,{roomId:String(room.id),wires:['ropeTraverse','stoneCanopy','ceilingProjectileGlyph','cyclingElevator']});
      return rope;
    }
    return null;
  }

  function deepestSunkenRegionForRoom(context,room) {
    return (context.meta?.plateauModel?.regions||[])
      .filter(region=>region?.kind==='sunkenFloor'&&String(region.sourceRoomId)===String(room.id)&&Number(region.level)<0)
      .sort((a,b)=>Number(a.level)-Number(b.level))[0]||null; // Most-negative tier is preferred so a cycling platform can expose a genuinely deep lower stop.
  }

  function buildCyclingElevatorModule(context,room,options={}) {
    const region=options.region||deepestSunkenRegionForRoom(context,room);
    if(!region)return null;
    const cs=worldCellSize(context.meta),step=Math.abs(Number(context.meta?.plateauModel?.stepHeight)||.42);
    const topFloorY=Number(context.meta?.floorSurfaceY)||0,lowerFloorY=topFloorY+Number(region.level)*step;
    if(topFloorY-lowerFloorY<.65)return null;
    const regionBounds={
      minX:PAD+Number(region.col)*cs,maxX:PAD+(Number(region.col)+Number(region.w))*cs,
      minZ:PAD+Number(region.row)*cs,maxZ:PAD+(Number(region.row)+Number(region.h))*cs,
    };
    const regionWidth=regionBounds.maxX-regionBounds.minX,regionDepth=regionBounds.maxZ-regionBounds.minZ;
    let x=(regionBounds.minX+regionBounds.maxX)*.5,z=(regionBounds.minZ+regionBounds.maxZ)*.5;
    let width=Math.max(1.5,regionWidth-.16),depth=Math.max(1.5,regionDepth-.16),annexBounds=null,annexDoorway=null;
    if(options.reserveAnnex===true){
      const longAxis=regionWidth>=regionDepth?'x':'z';
      if((longAxis==='x'?regionWidth:regionDepth)<6.1||(longAxis==='x'?regionDepth:regionWidth)<3.8)return null;
      if(longAxis==='x'){
        width=Math.min(2.8,regionWidth*.40);depth=Math.min(regionDepth-.22,3.5);
        x=regionBounds.minX+.12+width*.5;
        const minX=x+width*.5+.28,maxX=regionBounds.maxX-.16;
        const roomDepth=Math.min(regionDepth-.26,4.3),centerZ=(regionBounds.minZ+regionBounds.maxZ)*.5;
        annexBounds={minX,maxX,minZ:centerZ-roomDepth*.5,maxZ:centerZ+roomDepth*.5};
        annexDoorway={id:'sunken-annex-door-'+room.id,axis:'x',x:minX,z:centerZ,width:1.05,from:'elevator',to:'ossuary'};
      }else{
        depth=Math.min(2.8,regionDepth*.40);width=Math.min(regionWidth-.22,3.5);
        z=regionBounds.minZ+.12+depth*.5;
        const minZ=z+depth*.5+.28,maxZ=regionBounds.maxZ-.16;
        const roomWidth=Math.min(regionWidth-.26,4.3),centerX=(regionBounds.minX+regionBounds.maxX)*.5;
        annexBounds={minX:centerX-roomWidth*.5,maxX:centerX+roomWidth*.5,minZ,maxZ};
        annexDoorway={id:'sunken-annex-door-'+room.id,axis:'z',x:centerX,z:minZ,width:1.05,from:'elevator',to:'ossuary'};
      }
      if(!annexBounds||annexBounds.maxX-annexBounds.minX<3.0||annexBounds.maxZ-annexBounds.minZ<3.0)return null;
    }
    const height=.26;
    const mesh=naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),makeBasic(0x808080)));
    mesh.name='dev_ruin_cycling_elevator_'+room.id;
    const topTopY=topFloorY+.05,bottomTopY=lowerFloorY+.08;
    mesh.position.set(x,topTopY-height*.5,z);state.group.add(mesh);
    const module={
      id:'cycling-elevator-'+room.id,roomId:String(room.id),mesh,x,z,width,depth,height,region,regionBounds,annexBounds,annexDoorway,
      topTopY,bottomTopY,lowerFloorY,progress:0,active:options.startActive===true,elapsed:0,cycleSeconds:Math.max(5,Number(options.cycleSeconds)||8),
    };
    const surfaceId=module.id+'-surface';
    DS.registerSurface({
      id:surfaceId,scope:SCOPE,
      bounds:{minX:x-width*.5,maxX:x+width*.5,minZ:z-depth*.5,maxZ:z+depth*.5},
      topY:()=>module.topTopY+(module.bottomTopY-module.topTopY)*module.progress,
      enabled:()=>mesh.visible!==false,priority:24,
    });
    state.surfaceIds.add(surfaceId);
    state.cyclingElevators.push(module);
    recordModulePlacement('cyclingElevator','sunkenFloor',module.id,{roomId:String(room.id),depth:+(topFloorY-lowerFloorY).toFixed(3),reservesAnnex:!!annexBounds});
    return module;
  }

  function activateCyclingElevator(module) {
    if(!module)return false;
    module.active=true;module.elapsed=0;module.progress=0;
    return true;
  }

  function addStaticWallBlocker(id,bounds) {
    DS.registerBlocker({id,scope:SCOPE,bounds,purpose:'modular_ossuary_wall'});
    state.surfaceIds.add(id);
  }

  function buildSunkenRoomShell(context,room,bounds,doorway,floorY) {
    if(!bounds||!doorway)return null;
    const root=new THREE.Group();
    root.name='dev_ruin_sunken_ossuary_shell_'+room.id;
    state.group.add(root);
    const thickness=.18,height=2.15,gap=Math.max(.9,doorway.width),centerX=(bounds.minX+bounds.maxX)*.5,centerZ=(bounds.minZ+bounds.maxZ)*.5;
    const wallRecords=[];
    const addWall=(name,x,z,w,d)=>{
      const wall=naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(w,height,d),makeBasic(0x808080)));
      wall.name=name;wall.position.set(x,floorY+height*.5,z);root.add(wall);
      const blockerId='devruin-'+name;
      addStaticWallBlocker(blockerId,{minX:x-w*.5,maxX:x+w*.5,minZ:z-d*.5,maxZ:z+d*.5});
      wallRecords.push({name,wall,blockerId});
    };
    const xSpan=bounds.maxX-bounds.minX,zSpan=bounds.maxZ-bounds.minZ;
    addWall('modular_ossuary_north_'+room.id,centerX,bounds.minZ,xSpan,thickness);
    addWall('modular_ossuary_south_'+room.id,centerX,bounds.maxZ,xSpan,thickness);
    addWall('modular_ossuary_west_'+room.id,bounds.minX,centerZ,thickness,zSpan);
    addWall('modular_ossuary_east_'+room.id,bounds.maxX,centerZ,thickness,zSpan);
    const sideName=doorway.axis==='x'
      ? (Math.abs(doorway.x-bounds.minX)<Math.abs(doorway.x-bounds.maxX)?'west':'east')
      : (Math.abs(doorway.z-bounds.minZ)<Math.abs(doorway.z-bounds.maxZ)?'north':'south');
    const sideRecord=wallRecords.find(record=>record.name==='modular_ossuary_'+sideName+'_'+room.id);
    if(sideRecord){
      sideRecord.wall.parent?.remove?.(sideRecord.wall);
      sideRecord.wall.geometry?.dispose?.();sideRecord.wall.material?.dispose?.();
      DS.remove(sideRecord.blockerId);state.surfaceIds.delete(sideRecord.blockerId);
    }
    if(doorway.axis==='x'){
      const lower=(doorway.z-gap*.5)-bounds.minZ,upper=bounds.maxZ-(doorway.z+gap*.5);
      if(lower>.2)addWall('modular_ossuary_'+sideName+'_a_'+room.id,doorway.x,bounds.minZ+lower*.5,thickness,lower);
      if(upper>.2)addWall('modular_ossuary_'+sideName+'_b_'+room.id,doorway.x,doorway.z+gap*.5+upper*.5,thickness,upper);
    }else{
      const lower=(doorway.x-gap*.5)-bounds.minX,upper=bounds.maxX-(doorway.x+gap*.5);
      if(lower>.2)addWall('modular_ossuary_'+sideName+'_a_'+room.id,bounds.minX+lower*.5,doorway.z,lower,thickness);
      if(upper>.2)addWall('modular_ossuary_'+sideName+'_b_'+room.id,doorway.x+gap*.5+upper*.5,doorway.z,upper,thickness);
    }
    const ceiling=naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(xSpan,.18,zSpan),makeBasic(0x808080)));
    ceiling.name='dev_ruin_sunken_ossuary_ceiling_'+room.id;ceiling.position.set(centerX,floorY+height+.09,centerZ);root.add(ceiling);
    const module={id:'sunken-room-shell-'+room.id,roomId:String(room.id),root,bounds:{...bounds},doorway:{...doorway},floorY};
    state.sunkenRoomShells.push(module);
    recordModulePlacement('sunkenRoomShell','sunkenFloor',module.id,{roomId:String(room.id)});
    return module;
  }

  function nearestGeneratedStoneDoorMechanism(context,point) {
    let best=null;
    context.root?.traverse?.(object=>{
      if(object?.userData?.previewMotion?.type!=='stoneDoor'||!object.userData?.mechanismId)return;
      object.updateWorldMatrix?.(true,true);
      const box=new THREE.Box3().setFromObject(object);if(box.isEmpty())return;
      const center=box.getCenter(new THREE.Vector3()),distance=Math.hypot(center.x-point.x,center.z-point.z);
      if(!best||distance<best.distance)best={id:String(object.userData.mechanismId),distance};
    });
    return best?.id||null;
  }

  function sarcophagusPlacements(context, room, explicitBounds = null) {
    const b=explicitBounds||roomBounds(context.meta,room),cx=(b.minX+b.maxX)*.5,cz=(b.minZ+b.maxZ)*.5;
    const inset=Math.min(.7,Math.max(.42,Math.min(b.maxX-b.minX,b.maxZ-b.minZ)*.18));
    return [
      {x:b.minX+inset,z:cz-.9,yaw:Math.PI/2,spawnX:b.minX+1.35,spawnZ:cz-.9},
      {x:b.minX+inset,z:cz+.9,yaw:Math.PI/2,spawnX:b.minX+1.35,spawnZ:cz+.9},
      {x:b.maxX-inset,z:cz-.9,yaw:-Math.PI/2,spawnX:b.maxX-1.35,spawnZ:cz-.9},
      {x:b.maxX-inset,z:cz+.9,yaw:-Math.PI/2,spawnX:b.maxX-1.35,spawnZ:cz+.9},
    ];
  }

  function buildSarcophagusSpawnerModule(context,rng,room,options={}) {
    const root=new THREE.Group();root.name='dev_ruin_sarcophagus_set_'+room.id;state.group.add(root);
    const coffins=[];
    for(const [index,p] of sarcophagusPlacements(context,room,options.bounds||null).entries()){
      const support=sampleSupport(p.x,p.z);if(!support)continue;
      const body=naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(.72,1.75,.52),makeBasic(0x808080)));
      body.position.set(p.x,Number(support.y)+.875,p.z);body.rotation.y=p.yaw;body.name='dev_ruin_sarcophagus_body_'+room.id+'_'+index;root.add(body);
      const panel=naturalizeStone(new THREE.Mesh(new THREE.BoxGeometry(.58,1.55,.12),makeBasic(0x808080)));
      panel.position.set(0,0,.32);body.add(panel);
      coffins.push({index,body,panel,closedY:0,openY:1.62,progress:0,spawnX:p.spawnX,spawnZ:p.spawnZ,spawned:false});
    }
    if(coffins.length<2){disposeObject(root);return null;}
    const bounds=options.bounds||roomBounds(context.meta,room);
    const module={id:'sarcophagi-'+room.id,roomId:String(options.roomId||room.id),root,coffins,activated:false,spawnStarted:false,spawnCount:0,tier:Math.max(0,Number(options.tier)||1),autoActivateRadius:Math.max(0,Number(options.autoActivateRadius)||0),center:{x:(bounds.minX+bounds.maxX)*.5,z:(bounds.minZ+bounds.maxZ)*.5}};
    state.sarcophagusModules.push(module);
    recordModulePlacement('sarcophagusSpawner','room',module.id,{roomId:String(room.id),count:coffins.length});
    return module;
  }

  async function activateSarcophagusSpawner(module) {
    if(!module||module.activated)return false;
    module.activated=true;
    if(module.spawnStarted)return true;
    module.spawnStarted=true;
    for(const coffin of module.coffins){
      const px=coffin.spawnX*(Number(deps?.TILE)||1),py=coffin.spawnZ*(Number(deps?.TILE)||1); // Humanoid combat entities use the game's pixel-space X/Y plane, while modular ruin geometry is authored in world units.
      try{
        const creature=await window.MinionCombat?.makeEntity?.({
          speciesId:'harlyao-skeleton',name:'Harlyao Skeleton',tier:module.tier,x:px,y:py,zoneId:MAP_ID,
          scene:state.context.scene,grid:state.context.grid,cols:state.context.cols,rows:state.context.rows,weaponMetalKey:'nativeCopper',
          extra:{homeX:px,homeY:py,state:'idle',devRandomRuinSarcophagus:true},
        });
        if(creature&&state&&inRuin()){
          deps?.hostileObjects?.add?.(creature);
          coffin.spawned=true;module.spawnCount++;
        }else creature?.avatarRef?.dispose?.();
      }catch(error){console.warn('[Random Test Ruin] sarcophagus skeleton spawn failed',error);}
    }
    return true;
  }

  function buildOssuaryChordComposer(context,rng,room,options={}) {
    const roomId=String(options.roomId||room.id),owner={...room,id:roomId};
    const bounds=options.bounds||roomBounds(context.meta,room);
    const lockDoor=buildLockableDoorModule(context,owner,{startOpen:true,doorway:options.doorway||null});
    const sarcophagi=buildSarcophagusSpawnerModule(context,rng,owner,{tier:1,bounds,roomId});
    const chord=buildChordPlateSet(context,rng,{kind:'room',owner,bounds,onComplete:()=>{
      setLockDoorOpen(lockDoor,true);
      try{options.onComplete?.();}catch(error){console.warn('[Random Test Ruin] ossuary completion signal failed',error);}
    }});
    if(!lockDoor||!sarcophagi||!chord)return null;
    const module={id:'ossuary-composer-'+roomId,roomId,bounds,lockDoor,sarcophagi,chord,entered:false,completed:false};
    state.ossuaryComposers.push(module);
    recordModulePlacement('ossuaryComposer','room',module.id,{roomId,wires:['lockableStoneDoor','sarcophagusSpawner','chordPressurePlates']});
    return module;
  }

  function buildSwappableHallwayModules(context,rng,usedHallways) {
    const candidates=shuffle((context.meta?.hallways||[]).filter(hall=>!usedHallways.has(hall.id)&&(hall.axis==='x'?Number(hall.w):Number(hall.h))>=5),rng);
    const selected=candidates.slice(0,Math.min(2,candidates.length)); // Two generic hallway slots replace the previous unconditional two-trap pass.
    for(const hall of selected){
      if(rng()<.48){
        const chord=buildChordPlateSet(context,rng,{kind:'hallway',owner:hall},usedHallways);
        if(chord)continue;
      }
      buildHallwayTraps(context,rng,usedHallways,[hall]);
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

  function doorwayProximity(door, point) {
    if (!door || !point) return null;
    const normalDistance = door.axis === 'x' ? Math.abs(point.x - door.x) : Math.abs(point.z - door.z);
    const crossDistance = door.axis === 'x' ? Math.abs(point.z - door.z) : Math.abs(point.x - door.x);
    if (normalDistance > 1.05 || crossDistance > door.width * .5 + .3) return null;
    const sideValue = door.axis === 'x' ? point.x - door.x : point.z - door.z;
    return { x:point.x, z:point.z, side:Math.sign(sideValue) || 1 };
  }

  function updateDoorwayCheckpoints() {
    const nowPoint=playerWorld();
    if(!nowPoint||state.activeRope||state.flight){state.lastPlayerWorld=nowPoint;return;}
    const previous=state.lastPlayerWorld;
    if(previous){
      const jumped=Math.hypot(nowPoint.x-previous.x,nowPoint.z-previous.z)>.75;
      for(const door of state.checkpoints.doorways){
        const crossing=doorwayCrossing(door,previous,nowPoint);
        const proximity=!crossing&&jumped?doorwayProximity(door,nowPoint):null;
        const trigger=crossing||proximity;
        if(!trigger)continue;
        const side=trigger.side||1;
        const lastSide=state.checkpoints.lastDoorSide.get(door.id);
        if(!crossing&&lastSide===side)continue;
        const inset=.72;
        const point=door.axis==='x'
          ? {x:door.x+side*inset,z:trigger.z,y:nowPoint.y}
          : {x:trigger.x,z:door.z+side*inset,y:nowPoint.y};
        activateCheckpoint(door.id,point,true);
        state.checkpoints.lastDoorSide.set(door.id,side);
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
    if(!inRuin()||!state?.checkpoints?.active||!deps?.player)return false; // Canonical game respawn calls this for every death source; never hijack deaths after leaving the test ruin.
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
    setPlayerWorld(checkpoint.point,true,true);
    state.flight=null;
    if(state.activeRope){state.activeRope.attached=false;state.activeRope.braking=false;}
    state.activeRope=null;
    restoreRopeEquipment();
    state.lastPlayerWorld=clonePoint(checkpoint.point);
    deps._snapCameraTarget?.();
    deps.refreshActionBar?.();
    deps.showToast?.('Returned to the last ruin checkpoint.',true);
    state.checkpoints.respawnCount++;
    state.checkpoints.lastReason=String(reason||'death');
    return true;
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
      lastDoorSide:new Map(), // Used only to suppress duplicate skipped-frame proximity activation on the same side of a doorway.
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
      chordPlateSets:[],
      lockDoors:[],
      canopies:[],
      ceilingGlyphs:[],
      cyclingElevators:[],
      sarcophagusModules:[],
      sunkenRoomShells:[],
      ossuaryComposers:[],
      ropeElevatorComposers:[],
      modulePlacements:[], // Every placed puzzle piece is recorded independently so compound sequences remain inspectable/recomposable.
      projectiles:[],
      surfaceIds:new Set(),
      activeRope:null,
      ropeHeldToolSnapshot:null, // Restored immediately after release/fall/clear so rope traversal never permanently changes the player's loadout.
      ropeEquipmentHolsterCount:0,
      ropeEquipmentRestoreCount:0,
      flight:null,
      elapsed:0,
      lastPlayerWorld:null,
      checkpoints:null,
      buildSeed:Number(context.seed)||0,
    };
    buildCheckpoints(context);
    installModularProjectileHook(); // Reusable ceiling glyphs and stone canopies share one projectile seam no matter which procedural composer places them.
    const rng=seededRng((Number(context.seed)||0)^0x7f4a7c15);
    const usedRooms=new Set();
    const usedHallways=new Set(); // The mandatory safe-path crossing claims one hallway so repeating wall traps do not overlap it.
    const options=context.puzzleOptions||{};
    if(options.safePath!==false){
      const grid=buildSafePathGrid(context,rng,usedHallways);
      if(grid)recordModulePlacement('safePathGrid','hallway',grid.hallId,{mandatoryTraversal:true});
    }
    if(options.ropeSwing!==false){
      let rope=rng()<.58?buildBalconyRopeElevatorComposer(context,rng,usedRooms):null; // Full balcony→rope→glyph→elevator chain is one possible composition, not a dedicated puzzle type.
      if(!rope)rope=buildRopeSwing(context,rng,usedRooms);
      if(rope){
        recordModulePlacement('ropeTraverse','room',rope.roomId,{ceilingMounted:true});
        const alreadyComposed=state.ropeElevatorComposers.some(module=>module.rope===rope);
        const ropeRoom=(context.meta?.rooms||[]).find(room=>String(room.id)===String(rope.roomId));
        if(!alreadyComposed&&ropeRoom&&rng()<.65)buildStoneCanopyModule(context,ropeRoom,rope.startPlatform); // Standalone rope rooms may independently roll architectural canopy cover.
      }
    }
    const freeRooms=shuffle(usableRoomCandidates(context).filter(room=>!usedRooms.has(room.id)),rng);
    const ossuaryIndex=freeRooms.findIndex(room=>roomDoorways(context,room).length===1); // A lock-in composer only claims a cul-de-sac room; standalone modules remain valid in rooms with arbitrary connectivity.
    if(ossuaryIndex>=0&&rng()<.55){
      const [room]=freeRooms.splice(ossuaryIndex,1);usedRooms.add(room.id);buildOssuaryChordComposer(context,rng,room); // Compound encounter is wiring only; door, sarcophagi and chord plates remain separately recorded modules.
    }else if(freeRooms.length&&rng()<.5){
      const room=freeRooms.shift();usedRooms.add(room.id);buildChordPlateSet(context,rng,{kind:'room',owner:room}); // Same four-note module can appear by itself with no skeleton encounter at all.
    }
    if(freeRooms.length&&rng()<.35){
      const room=freeRooms.shift();usedRooms.add(room.id);buildStoneCanopyModule(context,room); // Canopies may also appear as standalone architectural cover, independent of ropes.
    }
    if(freeRooms.length&&rng()<.3){
      const room=freeRooms.shift();usedRooms.add(room.id);buildSarcophagusSpawnerModule(context,rng,room,{tier:1,autoActivateRadius:2.5}); // Sarcophagus enemies can occur independently; entering their room wakes them without requiring musical plates or a lock door.
    }
    if(options.hallwayTraps!==false)buildSwappableHallwayModules(context,rng,usedHallways);
    updateBadge(true);
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

  function updateCyclingElevators(dt) {
    for(const elevator of state.cyclingElevators){
      if(elevator.active){
        elevator.elapsed+=dt;
        const phase=(elevator.elapsed/elevator.cycleSeconds)*Math.PI*2;
        elevator.progress=(1-Math.cos(phase))*.5; // Smooth top→bottom→top loop with zero velocity at each stop.
      }
      const topY=elevator.topTopY+(elevator.bottomTopY-elevator.topTopY)*elevator.progress;
      elevator.mesh.position.y=topY-elevator.height*.5;
    }
  }

  function updateLockDoors(dt) {
    for(const door of state.lockDoors){
      const target=door.targetOpen?1:0;
      door.progress+=Math.max(-dt*1.7,Math.min(dt*1.7,target-door.progress));
      const t=door.progress*door.progress*(3-2*door.progress);
      door.panel.position.y=door.baseY+(door.openY-door.baseY)*t;
    }
  }

  function updateSarcophagusModules(dt) {
    const player=playerWorld();
    for(const module of state.sarcophagusModules){
      if(!module.activated&&module.autoActivateRadius>0&&player&&Math.hypot(player.x-module.center.x,player.z-module.center.z)<=module.autoActivateRadius)activateSarcophagusSpawner(module); // Standalone sarcophagus modules wake by proximity; compound composers can still activate them explicitly.
      const target=module.activated?1:0;
      for(const coffin of module.coffins){
        coffin.progress+=Math.max(-dt*1.45,Math.min(dt*1.45,target-coffin.progress));
        const t=coffin.progress*coffin.progress*(3-2*coffin.progress);
        coffin.panel.position.y=coffin.closedY+(coffin.openY-coffin.closedY)*t;
      }
    }
  }

  function updateOssuaryComposers() {
    const player=playerWorld();if(!player)return;
    for(const module of state.ossuaryComposers){
      const b=module.bounds;
      const inside=player.x>b.minX+.5&&player.x<b.maxX-.5&&player.z>b.minZ+.5&&player.z<b.maxZ-.5;
      if(inside&&!module.entered){
        module.entered=true;
        setLockDoorOpen(module.lockDoor,false);
        activateSarcophagusSpawner(module.sarcophagi);
        deps?.showToast?.('The stone door seals behind you.',false);
      }
      if(module.chord.solved&&!module.completed){
        module.completed=true;
        setLockDoorOpen(module.lockDoor,true);
      }
    }
  }

  function updateChordPlateSets() {
    const player=playerWorld();
    if(!player)return;
    for(const set of state.chordPlateSets){
      for(const plate of set.plates){
        const down=Math.abs(player.x-plate.x)<=.39&&Math.abs(player.z-plate.z)<=.39;
        plate.mesh.position.y=plate.y+.03-(down?.035:0);
        if(down&&!plate.down){
          plate.pressCount++;
          if(!plate.played){plate.played=true;plate.material.color.setHex(0x8a825f);}
          playKurrayaPlateNote(plate.index);
        }
        plate.down=down;
      }
      if(!set.solved&&set.plates.every(plate=>plate.played)){
        set.solved=true;set.solveCount++;
        playGeneratedStoneKchunk();
        deps?.showToast?.('The four notes settle into a chord. Stone machinery unlocks.',true);
        try{set.onComplete?.(set);}catch(error){console.warn('[Random Test Ruin] chord completion failed',error);}
      }
    }
  }

  function ropeIntent(rope, allowVelocityFallback = false) {
    const player=deps?.player;
    const strength=Math.max(0,Math.min(1,Number(player?.inputStrength)||0)); // Game-published, camera-resolved movement intent remains live while the rope runtime owns physical motion.
    const rawX=Number(player?.inputX)||0, rawZ=Number(player?.inputY)||0;
    const rawLength=Math.hypot(rawX,rawZ);
    let ix=rawLength>.001 ? rawX/rawLength*strength : 0;
    let iz=rawLength>.001 ? rawZ/rawLength*strength : 0;
    if(allowVelocityFallback&&strength<=.001){ // Preserve approach momentum on the one frame auto-grab happens before movement input has necessarily been published.
      const tile=Math.max(1e-6,Number(deps?.TILE)||1);
      const vx=(Number(player?.vx)||0)/tile, vz=(Number(player?.vy)||0)/tile;
      const speed=Math.hypot(vx,vz);
      if(speed>.001){ix=vx/Math.max(3,speed);iz=vz/Math.max(3,speed);}
    }
    const dx=Math.cos(rope.yaw),dz=Math.sin(rope.yaw);
    const sx=-dz,sz=dx;
    return {
      forward:Math.max(-1,Math.min(1,ix*dx+iz*dz)),
      side:Math.max(-1,Math.min(1,ix*sx+iz*sz)),
      strength:Math.min(1,Math.hypot(ix,iz)),
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
    setPlayerWorld(bob,true,false);
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
      setPlayerWorld(f,true,true);
      state.flight=null;
      state.lastPlayerWorld=clonePoint(f);
      return;
    }
    if(f.y<-2.5){
      respawnAtCheckpoint('rope-fall');
      return;
    }
    setPlayerWorld(f,true,false);
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

  function updateBadge(force=false) {
    if(!state)return;
    const now=performance.now();
    if(!force&&now-lastBadgeAt<250)return; // Diagnostics are human-readable, not simulation state; 4 Hz is plenty and avoids a layout-affecting DOM mutation every frame.
    lastBadgeAt=now;
    const badge=document.getElementById('devRandomRuinBadge');
    if(!badge)return;
    const base=badge.textContent.replace(/ · simple G\d+ R\d+ T\d+ CP \d+\/\d+/g,''); // Other ruin diagnostics rewrite the same badge; strip any prior simple suffix wherever it landed before appending one canonical copy.
    const cp=state.checkpoints;
    const next=base+' · simple G'+state.safeGrids.length+' R'+state.ropes.length+' T'+state.trapHallways.length+' CP '+cp.triggered.size+'/'+(cp.doorwayCount+1);
    if(next!==lastBadgeText){badge.textContent=next;lastBadgeText=next;}
  }

  function update() {
    const now=performance.now();
    const dt=Math.max(0,Math.min(.05,(now-lastFrameMs)/1000));
    lastFrameMs=now;

    if(!inRuin()){
      if(state)clearState();
      return;
    }
    const context=window.DevRandomRuin?.getRuntimeContext?.()||null;
    if(!context?.root||!context?.scene)return;
    if(!state||state.root!==context.root)buildForContext(context);

    updateSafeGrids(now);
    updateChordPlateSets();
    updateCyclingElevators(dt);
    updateLockDoors(dt);
    updateSarcophagusModules(dt);
    updateOssuaryComposers();
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
        inputAction:'dodge', // Prompt only: the game's native Dodge input owns the release on keyboard/controller/touch.
        nativeInput:true,
        touchIcon:'↗',
        label:'Jump Off Rope',
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
        hallId:grid.hallId,
        axis:grid.axis,
        cols:grid.cols,
        rows:grid.rows,
        mandatoryTraversal:true,
        revealMs:Math.max(0,Math.round(grid.revealUntil-now)),
        triggerCount:grid.triggerCount,
        safe:grid.cells.filter(cell=>cell.safe).map(cell=>({key:cell.key,x:+cell.x.toFixed(3),z:+cell.z.toFixed(3)})),
        unsafe:grid.cells.filter(cell=>!cell.safe).map(cell=>({key:cell.key,x:+cell.x.toFixed(3),z:+cell.z.toFixed(3)})),
      })),
      ropes:state.ropes.map(rope=>({
        id:rope.id,roomId:rope.roomId,attached:rope.attached,braking:rope.braking,
        length:+rope.length.toFixed(3),angle:+rope.angle.toFixed(3),omega:+rope.omega.toFixed(3),yaw:+rope.yaw.toFixed(3), // Mobile/browser diagnostics prove movement input changes the live pendulum rather than a canned traversal.
        ceilingY:+rope.ceilingY.toFixed(3),ceilingMounted:rope.mount?.parent===state.group,weaponStowed:!!state.ropeHeldToolSnapshot,
        anchor:clonePoint(rope.anchor),bob:clonePoint(rope.bob),grabPoint:clonePoint(rope.grabPoint),
      })),
      flight:state.flight?clonePoint(state.flight):null,
      ropeEquipment:{holstered:state.ropeEquipmentHolsterCount,restored:state.ropeEquipmentRestoreCount,currentlyStowed:!!state.ropeHeldToolSnapshot},
      trapHallways:state.trapHallways.map(trap=>({id:trap.id,axis:trap.axis,stations:trap.stations.length})),
      chordPlateSets:state.chordPlateSets.map(set=>({id:set.id,slotKind:set.slotKind,played:set.plates.filter(plate=>plate.played).length,solved:set.solved,solveCount:set.solveCount,pressCounts:set.plates.map(plate=>plate.pressCount)})),
      lockDoors:state.lockDoors.map(door=>({id:door.id,roomId:door.roomId,open:door.targetOpen,progress:+door.progress.toFixed(3)})),
      canopies:state.canopies.map(canopy=>({id:canopy.id,roomId:canopy.roomId,roofY:+canopy.roofY.toFixed(3)})),
      ceilingGlyphs:state.ceilingGlyphs.map(glyph=>({id:glyph.id,roomId:glyph.roomId,active:glyph.active,hitCount:glyph.hitCount})),
      cyclingElevators:state.cyclingElevators.map(elevator=>({id:elevator.id,roomId:elevator.roomId,active:elevator.active,progress:+elevator.progress.toFixed(3),topY:+elevator.topTopY.toFixed(3),bottomY:+elevator.bottomTopY.toFixed(3)})),
      sarcophagi:state.sarcophagusModules.map(module=>({id:module.id,roomId:module.roomId,activated:module.activated,spawnCount:module.spawnCount,count:module.coffins.length})),
      sunkenRoomShells:state.sunkenRoomShells.map(module=>({id:module.id,roomId:module.roomId,floorY:+module.floorY.toFixed(3)})),
      ossuaryComposers:state.ossuaryComposers.map(module=>({id:module.id,roomId:module.roomId,entered:module.entered,completed:module.completed})),
      ropeElevatorComposers:state.ropeElevatorComposers.map(module=>({id:module.id,roomId:module.roomId,ropeId:module.rope.id,elevatorId:module.elevator.id,glyphId:module.glyph.id,canopyId:module.canopy?.id||null})),
      modules:state.modulePlacements.map(module=>({...module})),
      liveProjectiles:state.projectiles.length,
      checkpoints:{
        activeId:state.checkpoints.active?.id||null,
        activePoint:clonePoint(state.checkpoints.active?.point),
        triggered:[...state.checkpoints.triggered],
        doorwayCount:state.checkpoints.doorwayCount,
        doorways:state.checkpoints.doorways.map(door=>({id:door.id,axis:door.axis,x:+door.x.toFixed(3),z:+door.z.toFixed(3),width:+door.width.toFixed(3)})),
        activationCount:state.checkpoints.activationCount,
        respawnCount:state.checkpoints.respawnCount,
        lastReason:state.checkpoints.lastReason,
      },
    };
  }

  DS.addBeforeRenderClient(update);

  window.DevRandomRuinSimplePuzzles=Object.freeze({
    getInteractionControls,
    ownsPlayerMotion:()=>!!(state?.activeRope||state?.flight),
    releaseActiveRope:()=>state?.activeRope?releaseRope(state.activeRope):false, // Called by the canonical Dodge context action so every input device shares one release path.
    respawnAtCheckpoint,
    snapshot,
    clear:clearState,
  });
})();
