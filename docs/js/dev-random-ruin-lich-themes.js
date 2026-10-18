// Environmental traditions in Harlyao ruins. A simple-puzzles composer owns
// generation, frame updates and teardown; CloudForestFog consumes lightSources().
(() => {
  'use strict';
  const SP = window.DevRandomRuinSimplePuzzles;
  const THREE = window.THREE;
  if (!SP?.registerComposer || !THREE) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const PULSE_SECONDS = 1; // Hronal pillar warning: three pulses at one-second spacing.
  const PILLAR_RADIUS = 3.1; // Hronal trigger and eruption radius, measured in tiles.
  const ICE_COVERAGE = 0.70; // Tothal floor tiles covered by an ice skin per room.
  const ICE_GLIDE_FRACTION = 0.25; // After release, replay the movement vector for 25% of the preceding continuous hold time.
  const PLASM_DEPTH = 0.11; // Half the Western Slope snow height; used for Kanthic tiles.
  const PLASM_EXPANSION_MS = 1000; // One tile of hidden Kanthic growth per room per second.
  const PLASM_PULL_TILES_S = 0.72; // Player drift toward the nearest patch's interior.
  const PLASM_SINK_SECONDS = 2.8; // Time immersed in the pull before a full-body fatal sink.
  const ROCK_SFX = 'assets/audio/sfx/sfx_break_rock.mp3'; // Existing rock-break sample used for the three warning pulses.
  const OIL_TEXTURE = 'assets/textures/canvas.png'; // Same petroleum-surface texture as HarlyaoLichCombat.
  const LIGHT_CAP = 120; // Bound per-frame 2D light-mask work on large generated sites.
  let world = null; // Active composer state, invalidated on reroll/exit.
  let audioContext = null; // Hronal warning gain and independently pitched icicle-impact playback.
  let rockHitBuffer=null,rockHitLoading=null; // Once-per-session 1.5x-pitched, 1x-duration break-rock sample.
  let lastEvent = 'none'; // Shown in the mobile Dev Random Ruin diagnostic.
  let badgeClock = 0; // Throttles mobile-visible hazard counts to four updates a second.

  const between = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const tileKey = (x, z) => Math.floor(x) + ',' + Math.floor(z);
  const tileFromKey = key => key.split(',').map(Number);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const alive = actor => !!actor && actor.health !== 0 && actor.dead !== true && actor.isDead !== true;
  const getActors = kit => {
    const all = [kit.deps?.player, ...(kit.deps?.hostileObjects || [])]; // Player and enemies share ice and icicle collision checks.
    return all.filter(actor => alive(actor) && (actor === kit.deps.player || (actor.areaId || actor.area || actor.mapId || MAP_ID) === MAP_ID)); // Never slide/hit a hostile cached in another area.
  };
  const pointOf = (actor, tile) => ({ x:(Number(actor.x) || 0) / tile, z:(Number(actor.y) || 0) / tile });
  const floorY = (kit, x, z) => Number(kit.sampleSupport(x, z)?.y) || Number(world?.context?.meta?.floorSurfaceY) || 0;
  const cellExists = (x, z) => !!world?.context?.floorSet?.has(tileKey(x, z));
  const clearAt = (x, z, y) => cellExists(x, z) && !window.DevRandomRuinTileOccupancy?.solidAt?.(x, z, .27, y + .35);
  function roomAt(point) {
    if (!world) return null;
    for (const room of world.rooms) {
      const b = room.bounds;
      if (point.x >= b.minX && point.x < b.maxX && point.z >= b.minZ && point.z < b.maxZ) return room;
    }
    return null;
  }
  function seeded(key, salt = 0) {
    let n = (Number(world?.context?.seed) || 0) ^ Math.imul(key + 1, 0x45d9f3b) ^ salt;
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function playRockPulse(gain,rate=1) {
    try {
      const settings = window.AudioSystem?.gameAudioConfig?.() || {}; // All three warning pulses respect the game's master SFX/mute setting.
      if (settings.enabled === false) return;
      const configuredVolume = Number(settings.sfxVolume);
      const volume = Number.isFinite(configuredVolume) ? between(configuredVolume, 0, 1) : 1;
      const audio = new Audio(ROCK_SFX); // Reused audio asset; each scheduled pulse has its own playback.
      audio.volume = Math.min(1, gain * volume);
      audio.playbackRate=rate; // Icicle release: double pitch AND double playback speed.
      audio.preservesPitch=false; // Modern browsers otherwise hold pitch constant while changing playback rate.
      if (gain > 1 && (window.AudioContext || window.webkitAudioContext)) {
        const Context = window.AudioContext || window.webkitAudioContext;
        audioContext ||= new Context();
        const source = audioContext.createMediaElementSource(audio);
        const amplifier = audioContext.createGain();
        amplifier.gain.value = gain; // WebAudio permits 150% volume without HTMLMediaElement's hard 1.0 ceiling.
        audio.volume = volume;
        source.connect(amplifier).connect(audioContext.destination);
      }
      audio.play().catch(() => {});
    } catch (_) {}
  }
  function pitchRockWithoutSpeedChange(source,context,factor=1.5) {
    // Offline granular overlap-add: each ~70ms grain is read at 1.5x pitch
    // but its *centres* advance at normal time. Output lasts exactly as long
    // as the source; this avoids playbackRate's unwanted impact-speed change.
    // Stone impacts are broadband, so the short crossfades hide the seams.
    const count=source.length,rate=source.sampleRate;
    const output=context.createBuffer(source.numberOfChannels,count,rate);
    const hop=Math.max(128,Math.round(rate*.017));
    const grain=hop*4;
    for(let channel=0;channel<source.numberOfChannels;channel++){
      const input=source.getChannelData(channel),dest=output.getChannelData(channel);
      const weights=new Float32Array(count);
      for(let center=0;center<count+grain/2;center+=hop){
        for(let j=0;j<grain;j++){
          const outputAt=center+j-grain/2;
          if(outputAt<0||outputAt>=count)continue;
          const sampleAt=center+(j-grain/2)*factor;
          const index=Math.floor(sampleAt);
          if(index<0||index+1>=count)continue;
          const weight=.5-.5*Math.cos((j+.5)*Math.PI*2/grain);
          const sample=input[index]+(input[index+1]-input[index])*(sampleAt-index);
          dest[outputAt]+=sample*weight;
          weights[outputAt]+=weight;
        }
      }
      for(let i=0;i<count;i++)if(weights[i]>.001)dest[i]/=weights[i];
    }
    return output;
  }
  function preloadRockImpact() {
    if(rockHitLoading||rockHitBuffer||!(window.AudioContext||window.webkitAudioContext)||!window.fetch)return;
    const Context=window.AudioContext||window.webkitAudioContext;
    try{
      audioContext||=new Context();
      rockHitLoading=window.fetch(ROCK_SFX).then(response=>{
        if(!response.ok)throw new Error('Rock impact sample unavailable');
        return response.arrayBuffer();
      }).then(data=>audioContext.decodeAudioData(data)).then(decoded=>{
        rockHitBuffer=pitchRockWithoutSpeedChange(decoded,audioContext,1.5);
      }).catch(()=>{rockHitLoading=null;}); // Standard sample remains available if decoding fails.
    }catch(_){}
  }
  function playRockImpact() {
    const config=window.AudioSystem?.gameAudioConfig?.()||{};
    if(config.enabled===false)return;
    const volume=Number.isFinite(Number(config.sfxVolume))?between(Number(config.sfxVolume),0,1):1;
    if(!rockHitBuffer){preloadRockImpact();playRockPulse(.8,1);return;}
    try{
      audioContext.resume?.().catch?.(()=>{});
      const source=audioContext.createBufferSource(),gain=audioContext.createGain();
      source.buffer=rockHitBuffer;source.playbackRate.value=1;
      gain.gain.value=.8*volume;
      source.connect(gain).connect(audioContext.destination);
      source.start(); // Same original duration, reconstructed at 1.5x source pitch.
    }catch(_){playRockPulse(.8,1);}
  }
  function addLight(x, y, z, radius, strength, color) {
    if (world.lights.length >= LIGHT_CAP) return null;
    const light = { x, y, z, radius, strength, color }; // Native Hronal cracked pillars mutate their own emitted glow during warning and eruption.
    world.lights.push(light);
    return light;
  }
  function makeRoomLights(kit) {
    for (const room of world.rooms) {
      const b = room.bounds, middleX = (b.minX + b.maxX) / 2, middleZ = (b.minZ + b.maxZ) / 2;
      if (world.theme === 'hronal') {
        for (let x = b.minX + 1; x < b.maxX - .4; x += 3.8) {
          addLight(x, floorY(kit, x, middleZ) + .08, middleZ, 3.2, .73, [255, 105, 28]); // Floor firelight falls sharply with distance.
          addLight(x, floorY(kit, x, b.minZ + .3) + 1.3, b.minZ + .3, 2.8, .68, [255, 87, 20]);
        }
        for (let z = b.minZ + 2; z < b.maxZ - 1; z += 4) addLight(b.maxX - .3, floorY(kit, b.maxX - .7, z) + 1.2, z, 2.8, .66, [255, 119, 44]);
      } else if (world.theme === 'tothal') {
        const radius = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * .64 + 1.2; // Broad blue wash reaches even the room's far corners.
        addLight(middleX, world.ceilingY - .1, middleZ, radius, .58, [57, 107, 170]);
        for (let z = b.minZ + 1; z < b.maxZ - .5; z += 5.5) {
          addLight(b.minX + .25, world.ceilingY - 1, z, Math.max(5, radius * .7), .48, [38, 83, 157]);
          addLight(b.maxX - .25, world.ceilingY - 1, z, Math.max(5, radius * .7), .48, [42, 92, 170]);
        }
      }
    }
  }
  // Snow-style caps: adjacent tiles meet flush, but an exposed boundary drops
  // through a smooth curved shoulder to the original floor. 16 shared
  // neighbour-mask geometries avoid generating unique vertices for each tile.
  // N=1 E=2 S=4 W=8; mask selection also works for growing plasm patches.
  function surfaceMask(x,z,tiles) {
    return (tiles.has(x+','+(z-1))?1:0) |
      (tiles.has((x+1)+','+z)?2:0) |
      (tiles.has(x+','+(z+1))?4:0) |
      (tiles.has((x-1)+','+z)?8:0);
  }
  function curvedCapGeometry(mask,height) {
    const g=new THREE.BufferGeometry();
    const axis=[0,.17,.83,1],verts=[],uv=[],indices=[];
    const smooth=t=>{t=between(t,0,1);return t*t*(3-2*t);};
    for(let zi=0;zi<4;zi++)for(let xi=0;xi<4;xi++){
      const u=axis[xi],v=axis[zi];
      let factor=1;
      if(!(mask&1))factor=Math.min(factor,smooth(v/.25));
      if(!(mask&2))factor=Math.min(factor,smooth((1-u)/.25));
      if(!(mask&4))factor=Math.min(factor,smooth((1-v)/.25));
      if(!(mask&8))factor=Math.min(factor,smooth(u/.25));
      verts.push(u-.5,height*factor,v-.5);
      uv.push(u,v);
    }
    for(let z=0;z<3;z++)for(let x=0;x<3;x++){
      const i=z*4+x;indices.push(i,i+4,i+1,i+1,i+4,i+5);
    }
    g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(indices);
    return g;
  }
  function capGeometry(mask,height) {
    const key=(height>.05?'plasm':'ice')+mask;
    let geometry=world.surfaceGeometries.get(key);
    if(!geometry){geometry=curvedCapGeometry(mask,height);world.surfaceGeometries.set(key,geometry);}
    return geometry;
  }
  function addSurfaceInstance(mesh,index,x,y,z) {
    const dummy=world.dummy; // Shared instance transform avoids per-tile allocations.
    dummy.position.set(x,y,z);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);
    dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
  }
  function renderCurvedTiles(kit,tiles,material,height,label) {
    const byMask=Array.from({length:16},()=>[]);
    for(const key of tiles){
      const [x,z]=tileFromKey(key),mask=surfaceMask(x,z,tiles);
      byMask[mask].push({x:x+.5,z:z+.5,y:floorY(kit,x+.5,z+.5)});
    }
    const root=new THREE.Group();
    root.name=label;
    byMask.forEach((items,mask)=>{
      if(!items.length)return;
      const mesh=new THREE.InstancedMesh(capGeometry(mask,height),material,items.length);
      mesh.name=label+'_edge_'+mask;
      items.forEach((p,i)=>addSurfaceInstance(mesh,i,p.x,p.y+.006,p.z));
      mesh.instanceMatrix.needsUpdate=true;
      mesh.frustumCulled=false;
      root.add(mesh);
    });
    world.group.add(root);
    return root;
  }
  function makeIce(kit) {
    for(const room of world.rooms){
      const keys=[];
      for(const key of world.context.floorSet||[]){
        const [x,z]=tileFromKey(key),p={x:x+.5,z:z+.5};
        if(p.x>=room.bounds.minX&&p.x<room.bounds.maxX&&p.z>=room.bounds.minZ&&p.z<room.bounds.maxZ)keys.push(key);
      }
      const ranked=keys.map((key,i)=>({key,sort:seeded(i,room.index+0x3107)})).sort((a,b)=>a.sort-b.sort);
      for(const entry of ranked.slice(0,Math.round(keys.length*ICE_COVERAGE))){
        const [x,z]=tileFromKey(entry.key),cx=x+.5,cz=z+.5;
        if(!clearAt(cx,cz,floorY(kit,cx,cz)))continue;
        world.iceTiles.add(entry.key);
      }
    }
    if(!world.iceTiles.size)return;
    world.iceMaterial=new THREE.MeshBasicMaterial({color:0x8bcdf5,transparent:true,opacity:.31,depthWrite:false,side:THREE.DoubleSide});
    world.iceMesh=renderCurvedTiles(kit,world.iceTiles,world.iceMaterial,.025,'tothal_ice_sheen');
  }
  function clusterGeometry(variant) {
    // One authored cluster draws as one mesh: 5–8 narrow, nonuniform tapered
    // cones fused into a single BufferGeometry (instead of 5–8 draw calls).
    // Each individual needle is at most .052 radius: under one-third of the
    // previous .16u cone. Heights and offsets vary within each cluster.
    const vertices=[],spikes=5+variant%4;
    let deepest=0;
    for(let n=0;n<spikes;n++){
      const jitter=seeded(variant*43+n*11,0x8172),angle=n*2.399963+variant*.47;
      const radial=n===0?0:.11+seeded(variant*71+n,0x109b)*.23;
      const cx=Math.cos(angle)*radial,cz=Math.sin(angle)*radial;
      const radius=.021+seeded(variant*19+n,0x222f)*.031;
      const height=.56+seeded(variant*37+n,0x8891)*.86;
      const top=-seeded(variant*27+n,0x331c)*.11;
      deepest=Math.max(deepest,height-top);
      for(let side=0;side<7;side++){
        const a=side*Math.PI*2/7,b=(side+1)*Math.PI*2/7;
        const pa=[cx+Math.cos(a)*radius,top,cz+Math.sin(a)*radius];
        const pb=[cx+Math.cos(b)*radius,top,cz+Math.sin(b)*radius];
        vertices.push(...pa,cx+jitter*.035,height*-1+top,cz+jitter*.03,...pb);
      }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    return {geometry:geo,deepest};
  }
  function makeIcicles(kit) {
    const variants=Array.from({length:5},(_,i)=>clusterGeometry(i));
    world.icicleGeometries=variants.map(v=>v.geometry);
    world.icicleMaterial=new THREE.MeshBasicMaterial({color:0xa0d7ef,transparent:true,opacity:.82,side:THREE.DoubleSide});
    for(const room of world.rooms){
      const b=room.bounds;
      // Expand the spacing for exceptionally large rooms instead of
      // clustering the first 48 icicles at one end of the ceiling.
      const availableW=Math.max(0,b.maxX-b.minX-2),availableD=Math.max(0,b.maxZ-b.minZ-2);
      let spacing=3;
      while(Math.ceil(availableW/spacing)*Math.ceil(availableD/spacing)>48)spacing++;
      let count=0;
      for(let z=Math.floor(b.minZ+1);z<b.maxZ-1;z+=spacing){
        for(let x=Math.floor(b.minX+1);x<b.maxX-1;x+=spacing){
          if(count>=48)break; // Stable per-room draw-call ceiling even in very large generated rooms.
          const candidates=[];
          for(let dz=0;dz<spacing;dz++)for(let dx=0;dx<spacing;dx++){
            const px=x+dx+.5,pz=z+dz+.5;
            if(px>=b.maxX-.75||pz>=b.maxZ-.75)continue;
            if(!clearAt(px,pz,floorY(kit,px,pz)))continue;
            candidates.push({x:px,z:pz,key:seeded((x+dx)*61+(z+dz)*97,room.index+0x49a2)});
          }
          if(!candidates.length)continue;
          candidates.sort((a,b)=>a.key-b.key);
          const p=candidates[0],ground=floorY(kit,p.x,p.z);
          if(world.ceilingY-ground<2.1)continue;
          const variant=Math.floor(seeded(x*17+z*29,room.index+0x1817)*variants.length);
          const shape=variants[variant];
          const mesh=new THREE.Mesh(shape.geometry,world.icicleMaterial);
          mesh.position.set(p.x,world.ceilingY-.04,p.z);
          mesh.name='tothal_falling_icicle';
          world.group.add(mesh);
          world.icicles.push({...p,ground,mesh,deepest:shape.deepest,phase:'hanging',speed:0,variant});
          count++;
        }
      }
    }
  }
  function emitShards(x, y, z, color, radius, count, pillarHeight = 0, pillarWidth = 0) {
    const group = new THREE.Group();
    const geo = new THREE.TetrahedronGeometry(.11);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.InstancedMesh(geo, mat, count); // All debris in one GPU draw call instead of separate meshes.
    const parts = [];
    for (let i = 0; i < count; i++) {
      const a = i * 2.399963, speed = radius * (.45 + (i % 8) / 13);
      parts.push({
        x:pillarWidth ? (i % 7 / 6 - .5) * pillarWidth : 0,
        y:pillarHeight ? (i / Math.max(1,count-1) - .5) * pillarHeight : 0,
        z:pillarWidth ? (Math.floor(i/7)%7/6 - .5) * pillarWidth : 0,
        vx:Math.cos(a) * speed, vz:Math.sin(a) * speed, vy:2 + (i % 7) * .32
      }); // The shattered stone first reproduces the original pillar's height/width, then sprays out like the lich eruption.
    }
    group.position.set(x, y, z); group.add(mesh);
    world.group.add(group);
    world.bursts.push({ group, mesh, parts, age:0, duration:1.25 });
  }
  function updateBursts(dt) {
    for (let i = world.bursts.length - 1; i >= 0; i--) {
      const burst = world.bursts[i];
      burst.age += dt;
      if (burst.age >= burst.duration) {
        burst.group.parent?.remove(burst.group);
        burst.mesh.geometry.dispose(); burst.mesh.material.dispose();
        world.bursts.splice(i, 1);
        continue;
      }
      const dummy = world.dummy;
      for (let k = 0; k < burst.parts.length; k++) {
        const p = burst.parts[k];
        p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt; p.vy -= 7.5 * dt;
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(burst.age * (k % 3 + 1), burst.age * 2, 0);
        dummy.scale.setScalar(Math.max(.001, 1 - burst.age / burst.duration));
        dummy.updateMatrix(); burst.mesh.setMatrixAt(k, dummy.matrix);
      }
      burst.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function findMixedPillarRooms(context) {
    const result = new Map(); // Room -> original support pillars and active hollow glyph housings, discovered once from V50's source scene.
    const rooms = world.rooms; // Room bounds are already translated to the same world units as the generated locale root.
    for (const room of rooms) result.set(room.id, { room, targets:[], supports:[] });
    context.root?.updateWorldMatrix?.(true, true);
    context.root?.traverse?.(node => {
      const meta = node.userData || {};
      const isTarget = meta.squarePillarHousing === true && meta.hiddenActivatorMount === 'pillarNiche'
        && meta.activatorType === 'glyphObelisk' && !!meta.linkedMechanismId;
      const isSupport = meta.squarePillar === true && /ceiling support pillar/i.test(String(meta.interiorRuinRole || ''))
        && meta.usedAuthoredPillarSquare === true && node.visible !== false;
      if (!isTarget && !isSupport) return;
      const position = node.getWorldPosition?.(new THREE.Vector3()); // Cached at generation: source pillars are stationary.
      if (!position) return;
      const room = rooms.find(entry => position.x >= entry.bounds.minX && position.x < entry.bounds.maxX
        && position.z >= entry.bounds.minZ && position.z < entry.bounds.maxZ);
      if (!room) return;
      const record = result.get(room.id);
      if (isTarget) record.targets.push(node);
      else record.supports.push(node);
    });
    return result;
  }
  function pillarShaft(support) {
    let best = null, tallest = 0; // The authored square-pillar shaft is preferred over its plinth/collar/capital.
    support.traverse(mesh => {
      if (!mesh?.isMesh || !/square tapered shaft/i.test(String(mesh.name || '')) || !mesh.geometry) return;
      mesh.geometry.computeBoundingBox?.();
      const bounds = mesh.geometry.boundingBox;
      const h = Number(bounds?.max?.y) - Number(bounds?.min?.y);
      if (Number.isFinite(h) && h > tallest) { best = mesh; tallest = h; }
    });
    return best;
  }
  function crackSurfaceProfile(shaft) {
    const geometry = shaft.geometry; // Sample the actual tapered shaft's vertices; the source mesh itself is unchanged.
    geometry.computeBoundingBox?.();
    const bounds = geometry.boundingBox, positions = geometry.getAttribute?.('position') || geometry.attributes?.position;
    if (!bounds || !positions?.count) return null;
    const min = bounds.min, max = bounds.max, span = max.y - min.y;
    if (!(span > .1)) return null;
    const low = {x:0,z:0}, high = {x:0,z:0}; // Extreme lower/upper-face radii approximate the tapered/wonky authored sides.
    let lowCount = 0, highCount = 0;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i), x = Math.abs(positions.getX(i)), z = Math.abs(positions.getZ(i));
      if (y < min.y + span * .14) { low.x = Math.max(low.x,x); low.z = Math.max(low.z,z); lowCount++; }
      if (y > max.y - span * .14) { high.x = Math.max(high.x,x); high.z = Math.max(high.z,z); highCount++; }
    }
    if (!lowCount || !highCount) return null;
    return {min,max,span,low,high};
  }
  function crackRibbon(shaft, profile, stage, salt) {
    const vertices = []; // Four tapered source faces batched into one mesh for each crack stage (three draw calls per converted pillar).
    const start = stage === 1 ? .11 : stage === 2 ? .28 : .41;
    const end = stage === 1 ? .85 : stage === 2 ? .75 : .93;
    const offset = stage === 1 ? 0 : stage === 2 ? -.20 : .23;
    const halfWidth = stage === 1 ? .010 : .008;
    for (let face = 0; face < 4; face++) {
      const positive = face % 2 === 0, axisX = face >= 2;
      const horizontalSpan = axisX ? Math.max(Math.abs(profile.min.z),Math.abs(profile.max.z))
        : Math.max(Math.abs(profile.min.x),Math.abs(profile.max.x));
      const pointAt = step => {
        const portion = step / 8, y = profile.min.y + profile.span * (start + (end - start) * portion);
        const t = (y - profile.min.y) / profile.span;
        const extent = THREE.MathUtils.lerp(axisX ? profile.low.x : profile.low.z,
          axisX ? profile.high.x : profile.high.z, t);
        const cross = (offset + Math.sin(step * 1.75 + salt + face) * .08
          + Math.sin(step * 3.2 + salt + face) * .04) * horizontalSpan * 2;
        const position = (positive ? 1 : -1) * (extent + .014); // Keep fracture triangles just above the original textured stone.
        return axisX ? {x:position,y,z:cross} : {x:cross,y,z:position};
      };
      for (let i = 0; i < 8; i++) {
        const a = pointAt(i), b = pointAt(i+1);
        const leftA = axisX ? {x:a.x,y:a.y,z:a.z-halfWidth} : {x:a.x-halfWidth,y:a.y,z:a.z};
        const rightA = axisX ? {x:a.x,y:a.y,z:a.z+halfWidth} : {x:a.x+halfWidth,y:a.y,z:a.z};
        const leftB = axisX ? {x:b.x,y:b.y,z:b.z-halfWidth} : {x:b.x-halfWidth,y:b.y,z:b.z};
        const rightB = axisX ? {x:b.x,y:b.y,z:b.z+halfWidth} : {x:b.x+halfWidth,y:b.y,z:b.z};
        for (const vertex of [leftA,rightA,leftB,rightA,rightB,leftB]) vertices.push(vertex.x,vertex.y,vertex.z);
      }
    }
    const geometry = new THREE.BufferGeometry(); // Draw once for all four jagged crack ribbons at this stage.
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.computeVertexNormals?.();
    const material = new THREE.MeshBasicMaterial({
      color:0xff8a21, transparent:true, opacity:stage === 1 ? .48 : 0,
      depthWrite:false, side:THREE.DoubleSide
    });
    const crack = new THREE.Mesh(geometry,material);
    crack.name = 'hronal_crack_decal';
    crack.userData.devRuinFootprintIgnore = true; // Crack art must never become a horizontal blocker.
    crack.userData.ruinCrackStage = stage; // Each pulse reveals one additional four-sided fissure layer.
    crack.visible = stage === 1;
    shaft.add(crack); // The original authored support's shaft/parent transform still determines the final silhouette.
    return crack;
  }
  function convertDecoyPillar(kit, room, support) {
    const shaft = pillarShaft(support), profile = shaft && crackSurfaceProfile(shaft);
    if (!profile) return false; // No mismatched fallback: only transform shapes whose original tapered shaft is readable.
    const box = new THREE.Box3().setFromObject(support);
    if (box.isEmpty?.()) return false;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (!(size.y >= 1.7) || !(Math.max(size.x,size.z) > .1)) return false;
    const cracks = []; // Native decals are separately owned and explicitly removed on a reroll.
    for (let stage = 1; stage <= 3; stage++) cracks.push(crackRibbon(shaft,profile,stage,room.index)); // Three batched meshes, each drawing four crack faces.
    const light = addLight(center.x,center.y,center.z,2.2,.34,[255,109,28]); // Readable orange glow before the first pulse even under Hronal's heavy darkness.
    world.pillars.push({
      x:center.x,z:center.z,y:box.min.y,height:size.y,width:Math.max(size.x,size.z),
      group:support,sourcePillar:support,cracks,light,phase:'idle',elapsed:0,pulses:0,roomId:room.id,
    }); // The normal V50 mesh + static collision are reused without replacement or duplicate geometry.
    return true;
  }
  function releasePillarCameraOcclusion(pillar) {
    if (!pillar.sourcePillar) return;
    const occlusion = window.DevRandomRuin?.getOcclusionMeshes?.();
    if (!Array.isArray(occlusion)) return;
    const members = new Set();
    pillar.sourcePillar.traverse(node => { if (node.isMesh) members.add(node); });
    const removed = [];
    for (let i = occlusion.length - 1; i >= 0; i--) {
      if (members.has(occlusion[i])) removed.push(occlusion.splice(i, 1)[0]);
    }
    pillar.removedOccluders = removed; // Raycast cameras can still hit hidden THREE.Mesh objects; keep no invisible boom obstruction.
    pillar.occlusionList = occlusion;
  }
  function restorePillarCameraOcclusion(pillar) {
    if (!pillar.removedOccluders?.length) return;
    const current = window.DevRandomRuin?.getRuntimeContext?.();
    const occlusion = window.DevRandomRuin?.getOcclusionMeshes?.();
    if (current?.root !== world.context.root || occlusion !== pillar.occlusionList) return;
    for (const mesh of pillar.removedOccluders) if (!occlusion.includes(mesh)) occlusion.push(mesh);
    pillar.removedOccluders.length = 0; // Restored originals remain in the cache once, even across composer rebuilds.
  }
  function convertMixedRoomDecoys(kit, room, record) {
    if (!record?.targets.length || !record.supports.length) return 0;
    const candidates = record.supports.map((support,index) => {
      const p = support.getWorldPosition(new THREE.Vector3());
      return {support,sort:seeded(Math.round(p.x*61+p.z*109)+index, room.index^0x7b201)};
    }).sort((a,b) => a.sort-b.sort);
    const count = Math.max(1,Math.ceil(candidates.length * .4)); // Some false pillars become traps; others remain inert decoys.
    let converted = 0;
    for (const candidate of candidates) {
      if (converted >= count) break;
      if (convertDecoyPillar(kit,room,candidate.support)) converted++;
    }
    return converted;
  }
  function makePillars(kit) {
    const mixedRooms = findMixedPillarRooms(world.context); // Hollow-target rooms reuse their original non-target square support meshes.
    for (const room of world.rooms) {
      const mixed = mixedRooms.get(room.id); // Only exact authored square-pillar geometry qualifies in a room with real niche targets.
      if (mixed?.targets.length) {
        if (mixed.supports.length) convertMixedRoomDecoys(kit,room,mixed);
        continue; // A room made entirely of real target housings must never gain an extra false generic box pillar.
      }
      if (room.index % 2 !== 0) continue; // Other Hronal rooms retain the earlier supplemental corner hazard.
      const b = room.bounds;
      const candidates = [
        { x:b.minX + 1.1, z:b.minZ + 1.1 }, { x:b.maxX - 1.1, z:b.maxZ - 1.1 },
        { x:b.minX + 1.1, z:b.maxZ - 1.1 }, { x:b.maxX - 1.1, z:b.minZ + 1.1 },
      ];
      const point = candidates.find(p => clearAt(p.x, p.z, floorY(kit, p.x, p.z)));
      if (!point) continue;
      const y = floorY(kit, point.x, point.z), height = world.ceilingY - y;
      if (height < 1.7) continue;
      const group = new THREE.Group();
      group.position.set(point.x, y, point.z);
      group.name = 'hronal_exploding_pillar';
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(.62, height, .62), kit.makeBasic(0x65554b));
      shaft.position.y = height / 2;
      group.add(shaft);
      const cracks = [];
      for (let face = 0; face < 4; face++) {
        const crack = new THREE.Mesh(new THREE.PlaneGeometry(.045, height * .68),
          new THREE.MeshBasicMaterial({color:0xff8a21, transparent:true, opacity:.14, depthWrite:false, side:THREE.DoubleSide}));
        crack.position.set(0, height * .5, .319);
        crack.rotation.y = face * Math.PI / 2;
        crack.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), face * Math.PI / 2);
        group.add(crack); cracks.push(crack);
      }
      world.group.add(group);
      const pillar = { x:point.x, z:point.z, y, height, width:.62, group, cracks, phase:'idle', elapsed:0, pulses:0 }; // Explosion state is also the live collision-footprint gate.
      world.pillars.push(pillar);
      window.DevRandomRuinTileOccupancy?.addSolidBox?.('hronal-pillar-'+room.id,
        {cx:point.x,cz:point.z,halfX:.31,halfZ:.31},()=>pillar.phase!=='spent','lich-theme-pillars'); // The intact stone blocks movement; the blasted column does not.
    }
  }
  function updatePillars(kit, dt, actors) {
    for (const pillar of world.pillars) {
      if (pillar.phase === 'spent') continue;
      if (pillar.phase === 'idle') {
        if (!actors.some(a => distance(pointOf(a, kit.deps.TILE), pillar) <= PILLAR_RADIUS)) continue;
        pillar.phase = 'charging'; pillar.elapsed = 0; pillar.pulses = 0;
      }
      pillar.elapsed += dt;
      while (pillar.pulses < 3 && pillar.elapsed >= pillar.pulses * PULSE_SECONDS) {
        const gain = [.25, 1, 1.5][pillar.pulses]; // Author's exact three pulse gains.
        playRockPulse(gain);
        pillar.pulses++;
        for (const crack of pillar.cracks) {
          const stage = crack.userData?.ruinCrackStage; // Native square pillars reveal more glowing fracture branches each second.
          if (stage) {
            crack.visible = stage <= pillar.pulses;
            crack.material.opacity = stage <= pillar.pulses ? Math.min(.96,.48 + pillar.pulses*.16) : 0;
          } else {
            crack.material.opacity = .14 + pillar.pulses * .25;
            crack.scale.x = 1 + pillar.pulses * 1.5;
          }
        }
        if (pillar.light) pillar.light.strength = .34 + pillar.pulses * .20;
        lastEvent = 'hronal:pulse-' + pillar.pulses;
      }
      if (pillar.elapsed < 3) continue; // Blast one second after the third pulse.
      pillar.phase = 'spent';
      pillar.group.visible = false; // Existing V50 support footprints automatically become inactive when the ancestor is hidden.
      releasePillarCameraOcclusion(pillar); // Drop the matching source mesh from camera raycasting as well.
      if (pillar.light) pillar.light.strength = 0; // No ghost glow remains after the native pillar explodes.
      window.DevRandomRuinTileOccupancy?.refresh?.(); // Remove destroyed pillar collision on the same frame as the explosion.
      emitShards(pillar.x, pillar.y + pillar.height * .45, pillar.z, 0x726359, PILLAR_RADIUS, 64, pillar.height, pillar.width || .62);
      emitShards(pillar.x, pillar.y + pillar.height * .5, pillar.z, 0xff6419, PILLAR_RADIUS * .85, 24);
      for (const actor of actors) {
        if (distance(pointOf(actor, kit.deps.TILE), pillar) <= PILLAR_RADIUS) {
          window.ResourceSystem?.addAffliction?.(actor, 'burningHealth', 25);
          window.ResourceSystem?.spendFooting?.(actor, 22, 'Hronal exploding pillar');
        }
      }
      lastEvent = 'hronal:pillar-burst';
    }
  }
  function updateIcicles(kit, dt, actors) {
    for (const spike of world.icicles) {
      if (spike.phase === 'done') continue;
      if (spike.phase === 'hanging') {
        if (actors.some(a => distance(pointOf(a, kit.deps.TILE), spike) < 2)) {
          spike.phase = 'falling'; spike.speed = .5; playRockPulse(.8,2); lastEvent = 'tothal:icicle-fall';
        }
      } else {
        spike.speed = Math.min(3.4, spike.speed + dt * 2.3); // Enough fall time to step or dodge out.
        spike.mesh.position.y -= spike.speed * dt;
        if (spike.mesh.position.y - spike.deepest > spike.ground + .06) continue;
        spike.mesh.visible = false; spike.phase = 'done';
        playRockImpact();
        emitShards(spike.x, spike.ground + .1, spike.z, 0xaad9ff, 2, 28);
        for (const actor of actors) if (distance(pointOf(actor, kit.deps.TILE), spike) < 2) {
          window.ResourceSystem?.addAffliction?.(actor, 'shatteredStamina', 13);
          window.ResourceSystem?.spendFooting?.(actor, 10, 'falling icicle');
        }
        lastEvent = 'tothal:icicle-shatter';
      }
    }
  }
  function collisionImpact(actor, kit, deficitTiles) {
    const impact = window.KnockbackCollisionImpact;
    impact?.resolveStrength?.(actor, {kind:'stone', label:'Tothal ice slide'}, deficitTiles * .25, kit.deps.TILE, {
      dealHealthDamage: (target, damage) => {
        const previous = Number(target.health) || 0;
        const options = {tag:'blunt',environmentalImpact:true,friendlyFire:true}; // The existing damage/death authority, never ad-hoc Health subtraction.
        if (target === kit.deps.player) (kit.deps.damagePlayer || window.Combat?.deps?.damagePlayer)?.(damage,target.x,target.y,0,options);
        else (kit.deps.damageCreature || window.Combat?.deps?.damageCreature)?.(target,damage,target.x,target.y,0,options);
        const applied = Math.max(0,previous - Math.max(0,Number(target.health) || 0));
        return {applied,lethal:previous > 0 && target.health <= 0};
      },
    }, { mode:'ice-slide' });
    lastEvent = 'tothal:slide-collision';
  }
  function updateIceMotion(kit, dt, actors) {
    const tile=kit.deps.TILE;
    for(const actor of actors){
      const point=pointOf(actor,tile);
      let motion=world.motion.get(actor);
      if(!motion){
        motion={last:point,hold:0,dir:{x:0,z:0},speed:0,remaining:0,sliding:false};
        world.motion.set(actor,motion);continue;
      }
      const dx=point.x-motion.last.x,dz=point.z-motion.last.z,delta=Math.hypot(dx,dz);
      const icy=world.iceTiles.has(tileKey(point.x,point.z));
      if(!icy||delta>.65||(actor===kit.deps.player&&window.DevRandomRuinSimplePuzzles?.ownsPlayerMotion?.())){
        motion.hold=0;motion.remaining=0;motion.sliding=false;motion.last=point;
        continue; // Dry ground, teleports and authored traversal cancel glide immediately.
      }
      const advance=()=>{
        const step=Math.min(motion.speed*dt,motion.speed*motion.remaining);
        motion.remaining=Math.max(0,motion.remaining-dt);
        if(step>.00001){
          const target={x:point.x+motion.dir.x*step,z:point.z+motion.dir.z*step};
          const y=floorY(kit,point.x,point.z);
          // Cross onto the first dry tile normally, then immediately cancel
          // inertia. A dry boundary is a brake, not an invisible collision wall.
          if(!clearAt(target.x,target.z,y)||Math.abs(floorY(kit,target.x,target.z)-y)>=.4){
            collisionImpact(actor,kit,step);motion.remaining=0;
          }else{
            actor.x=target.x*tile;actor.y=target.z*tile;
            if(actor===kit.deps.player)window.DevRandomRuin?.syncPlayerPresentationHeight?.(floorY(kit,target.x,target.z));
            if(!world.iceTiles.has(tileKey(target.x,target.z)))motion.remaining=0;
          }
        }
        if(motion.remaining<=.00001){motion.sliding=false;motion.hold=0;}
        motion.last=pointOf(actor,tile);
      };
      if(motion.sliding){advance();continue;}
      if(delta>.001&&delta<.65){
        motion.dir.x=dx/delta;motion.dir.z=dz/delta;
        motion.speed=between(delta/Math.max(.001,dt),.1,8);
        motion.hold+=dt;
      }else if(delta<=.001&&motion.hold>.045){
        // Do not pause for a separate 'stillness' timer: the FIRST released
        // input frame already advances along the previously held vector.
        motion.remaining=motion.hold*ICE_GLIDE_FRACTION;
        motion.sliding=true;motion.hold=0;
        advance();
        continue;
      }
      motion.last=point;
    }
  }
  function makePlasm(kit) {
    for (const room of world.rooms) {
      const keys = [...(world.context.floorSet || [])].filter(key => {
        const [x,z] = tileFromKey(key), b = room.bounds;
        return x + .5 >= b.minX + .4 && x + .5 < b.maxX - .4 && z + .5 >= b.minZ + .4 && z + .5 < b.maxZ - .4;
      });
      if (keys.length < 9) continue;
      const origin = keys[Math.floor(seeded(room.index, 0x1919) * keys.length)];
      room.plasmOriginal = origin; room.plasm = new Set([origin]); room.plasmElapsed = 0;
    }
    const loader = new THREE.TextureLoader();
    const texture = loader.load(OIL_TEXTURE, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
    world.ownedTexture = texture;
    // Plasm uses the same snow-style curved cap geometry as the ice, at 0.11u depth.
    world.plasmMaterial = new THREE.MeshBasicMaterial({color:0x251c34, map:texture, transparent:true, opacity:.88, depthWrite:false});
    updatePlasmMesh(kit);
  }
  function updatePlasmMesh(kit) {
    const patches=new Set(world.rooms.flatMap(room=>[...(room.plasm||[])]));
    world.plasmMesh?.parent?.remove(world.plasmMesh); // Geometry variants remain shared until composer teardown.
    world.plasmMesh=null;
    if(!patches.size)return;
    world.plasmMesh=renderCurvedTiles(kit,patches,world.plasmMaterial,PLASM_DEPTH,'kanthic_plasm_snow_shelf');
  }
  function obstructed(a,b,kit) {
    const count = Math.ceil(distance(a,b) * 3);
    for (let i = 1; i < count; i++) {
      const t = i / count, x = a.x + (b.x-a.x)*t, z = a.z + (b.z-a.z)*t;
      if (!clearAt(x,z,floorY(kit,x,z))) return true;
    }
    return false;
  }
  function resetPlasmRoom(kit,room) {
    if (!room.plasmOriginal) return;
    room.plasm = new Set([room.plasmOriginal]); room.plasmElapsed = 0;
    world.sink = 0;
    updatePlasmMesh(kit);
    lastEvent = 'kanthic:room-reset';
  }
  function updatePlasm(kit, dt) {
    const player = kit.deps.player, tile = kit.deps.TILE;
    if (!player || !tile) return;
    const point = pointOf(player, tile), room = roomAt(point);
    if (world.lastPlasmRoom && world.lastPlasmRoom !== room) resetPlasmRoom(kit, world.lastPlasmRoom);
    world.lastPlasmRoom = room;
    if (!room?.plasm?.size || !alive(player)) { world.sink = 0; return; }
    const patch = [...room.plasm].map(tileFromKey).map(([x,z]) => ({x:x+.5,z:z+.5})).sort((a,b)=>distance(a,point)-distance(b,point))[0];
    const inside = room.plasm.has(tileKey(point.x,point.z));
    if (!inside) {
      world.sink = 0;
      const first = tileFromKey(room.plasmOriginal), center = {x:first[0]+.5,z:first[1]+.5};
      const facing = Number(player.facing); // Used with occluders to test player sight, not camera visibility (which depends on third-person orbit).
      const bearing = Math.atan2(center.z-point.z, center.x-point.x);
      const outOfView = Number.isFinite(facing) && Math.cos(bearing - facing) < .35;
      if (!outOfView && !obstructed(point, center, kit)) return; // Behind the player's gaze or physically occluded, never visible directly ahead.
      room.plasmElapsed += dt * 1000;
      if (room.plasmElapsed >= PLASM_EXPANSION_MS) {
        room.plasmElapsed -= PLASM_EXPANSION_MS;
        const frontier = [];
        for (const key of room.plasm) {
          const [x,z] = tileFromKey(key);
          for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nk = (x+dx)+','+(z+dz), n = {x:x+dx+.5,z:z+dz+.5};
            if (room.plasm.has(nk) || !clearAt(n.x,n.z,floorY(kit,n.x,n.z))) continue;
            if (n.x <= room.bounds.minX || n.x >= room.bounds.maxX || n.z <= room.bounds.minZ || n.z >= room.bounds.maxZ) continue;
            frontier.push({ key:nk, d:distance(n,point) });
          }
        }
        frontier.sort((a,b)=>a.d-b.d);
        if (frontier.length) { room.plasm.add(frontier[0].key); updatePlasmMesh(kit); lastEvent = 'kanthic:plasm-grow'; }
      }
      return;
    }
    world.sink = Math.min(1, world.sink + dt / PLASM_SINK_SECONDS);
    const pull = Math.min(distance(point,patch), PLASM_PULL_TILES_S * dt * (1 + world.sink));
    if (pull > 0) {
      const vx = (patch.x-point.x)/Math.max(.001,distance(point,patch)), vz = (patch.z-point.z)/Math.max(.001,distance(point,patch));
      const nx = point.x + vx*pull, nz = point.z + vz*pull;
      if (clearAt(nx,nz,floorY(kit,point.x,point.z))) { player.x=nx*tile;player.y=nz*tile; }
    }
    const baseY = floorY(kit,player.x/tile,player.y/tile);
    const bodyHeight = Math.max(.9, Number(kit.deps.playerMesh?.userData?.portraitModelHeight) || 1.8); // A full sink hides the entire rendered body, not merely its knees.
    window.DevRandomRuin?.syncPlayerPresentationHeight?.(baseY - world.sink * bodyHeight);
    if (world.sink >= 1) {
      world.sink = 0;
      resetPlasmRoom(kit,room);
      player.health = 0; // PlayerVitals owns the guaranteed next-tick death transition if the optional direct hook is not injected into DevSpawner.
      kit.deps.handlePlayerDeath?.('kanthic-plasm'); // Prefer an immediate canonical respawn when the hook is present.
      lastEvent = 'kanthic:plasm-death';
    }
  }
  function buildRooms(kit,context) {
    clear();
    if (!['hronal','tothal','kanthic'].includes(context.theme) || !context.floorSet?.size) return;
    const rooms = (context.meta?.rooms || []).map((entry,index)=>({id:entry.id,index,bounds:kit.roomBounds(context.meta,entry)}));
    world = {
      theme:context.theme,context,rooms,kit,group:new THREE.Group(),dummy:new THREE.Object3D(),
      ceilingY:Number(context.ceilingY) || (Number(context.meta?.floorSurfaceY)||0) + (Number(context.meta?.wallHeight)||3),
      lights:[],pillars:[],iceTiles:new Set(),icicles:[],icicleGeometries:[],icicleMaterial:null,bursts:[],motion:new WeakMap(),surfaceGeometries:new Map(),iceMesh:null,iceMaterial:null,
      plasmMesh:null,plasmGeometry:null,plasmMaterial:null,ownedTexture:null,lastPlasmRoom:null,sink:0,
    };
    world.group.name = 'dev_ruin_lich_theme_'+world.theme;
    kit.group().add(world.group);
    makeRoomLights(kit);
    if (world.theme === 'hronal') { makePillars(kit); window.DevRandomRuinTileOccupancy?.refresh?.(); }
    if (world.theme === 'tothal') { makeIce(kit); makeIcicles(kit); preloadRockImpact(); }
    if (world.theme === 'kanthic') makePlasm(kit);
    lastEvent = 'generated:'+world.theme;
  }
  function update(kit, now, dt) {
    if (!world || world.context.root !== kit.state?.context?.root || dt <= 0) return;
    const actors = getActors(kit);
    if (world.theme === 'hronal') updatePillars(kit,dt,actors);
    if (world.theme === 'tothal') { updateIceMotion(kit,dt,actors); updateIcicles(kit,dt,actors); }
    if (world.theme === 'kanthic') updatePlasm(kit,dt);
    updateBursts(dt);
    badgeClock += dt;
    if (badgeClock >= .25) { // The composer snapshot already feeds mobile Pixel Probe; echo a compact live state in the in-game badge.
      badgeClock = 0;
      const report = snapshot();
      const segment = ' · lich '+world.theme[0].toUpperCase()+' P'+report.burstPillars+'/'+report.totalPillars+
        ' I'+report.iceTiles+' C'+report.fallenIcicles+'/'+report.icicles+' K'+report.plasmTiles+
        ' sink'+Math.round(report.sinking*100)+'% '+report.lastEvent;
      window.DevRandomRuin?.setDebugBadgePart?.('lich',segment); // A keyed segment cannot accumulate duplicate warnings over time.
    }
  }
  function clear() {
    if (!world) return;
    for(const spike of world.icicles)spike.mesh.parent?.remove(spike.mesh); // Each cluster is a shared-variant single-mesh draw.
    for(const geometry of world.icicleGeometries||[])geometry.dispose();
    world.icicleMaterial?.dispose();
    for (const burst of world.bursts) {burst.mesh.geometry.dispose();burst.mesh.material.dispose();}
    for (const pillar of world.pillars) {
      if (!pillar.sourcePillar) continue;
      pillar.sourcePillar.visible = true; // A reused V50 generator root must never retain the previous run's exploded state.
      restorePillarCameraOcclusion(pillar);
      for (const crack of pillar.cracks) {
        crack.parent?.remove(crack);
        crack.geometry.dispose();
        crack.material.dispose();
      }
    }
    window.DevRandomRuinTileOccupancy?.clearSolids?.('lich-theme-pillars'); // Reroll/leave cannot strand invisible, still-colliding Hronal columns.
    window.DevRandomRuinTileOccupancy?.refresh?.();
    world.ownedTexture?.dispose();
    const ownedGeometries=new Set(world.surfaceGeometries.values());
    const ownedMaterials=new Set([world.iceMaterial,world.plasmMaterial].filter(Boolean));
    world.group.parent?.remove(world.group);
    const icicleMeshes=new Set(world.icicles.map(spike=>spike.mesh));
    const burstMeshes=new Set(world.bursts.map(b=>b.mesh));
    world.group.traverse(obj=>{
      if(!obj.isMesh||icicleMeshes.has(obj)||burstMeshes.has(obj))return;
      if(obj.geometry)ownedGeometries.add(obj.geometry);
      for(const material of Array.isArray(obj.material)?obj.material:[obj.material])if(material)ownedMaterials.add(material);
    });
    for(const geometry of ownedGeometries)geometry.dispose?.();
    for(const material of ownedMaterials)material.dispose?.();
    world = null;
    badgeClock = 0;
  }
  function snapshot() {
    return world ? {
      theme:world.theme,rooms:world.rooms.length,lightSources:world.lights.length,
      chargedPillars:world.pillars.filter(p=>p.phase==='charging').length,
      burstPillars:world.pillars.filter(p=>p.phase==='spent').length,
      totalPillars:world.pillars.length,reusedDecoyPillars:world.pillars.filter(p=>!!p.sourcePillar).length,
      iceTiles:world.iceTiles.size,
      icicles:world.icicles.length,fallenIcicles:world.icicles.filter(p=>p.phase==='done').length,
      plasmTiles:world.rooms.reduce((n,r)=>n+(r.plasm?.size||0),0),
      sinking:world.sink,lastEvent,
    } : {active:false,lastEvent};
  }
  SP.registerComposer({id:'lichThemes',buildRooms,update,clear,snapshot});
  window.DevRandomRuinLichThemes = Object.freeze({
    lightSources:()=>world?.lights||[],
    activeTheme:()=>world?.theme||null,
    snapshot,
    isIceAt:(x,z)=>!!world?.iceTiles?.has(tileKey(x,z)), // Mobile/test query reads the same authored slippery footprint as locomotion.
  });
})();
