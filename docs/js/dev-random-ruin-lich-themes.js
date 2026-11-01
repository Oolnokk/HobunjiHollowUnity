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
  // Minecraft-like ground friction (ice slipperiness .98 x normal drag .91 ≈ .892)
  // at a 20 Hz reference step. Normal movement's collision/swept handling stays
  // authoritative; no post-frame position override or accumulated hold timer.
  const ICE_PHYSICS=Object.freeze({accelerationFactor:.28,turningFactor:.22,retention20Hz:.892});
  const PLASM_DEPTH = 0.22; // Match Western Slope snow's visibly raised cap and .22-wide curved perimeter lip.
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
    // Tothal's *entire* generated floor, including corridor links and room
    // thresholds, is iced. Do not randomly discard 30% of tiles or skip
    // tile skins underneath furniture: visuals and physics share floorSet.
    for(const key of world.context.floorSet || [])world.iceTiles.add(key);
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
  function triggerBossBlizzard(boss) {
    if (!world || world.theme !== 'tothal' || !boss?.isSpecialLich || boss.lichType !== 'tothal') return 0;
    const arena = window.DevRandomRuinSanctum?.getState?.()?.layout?.arena; // Existing boss chamber is the only ceiling-wide blizzard target.
    if (!arena || !world.icicleGeometries?.length || !world.icicleMaterial) return 0;
    const tiles = [], kit = world.kit; // Shares real ceiling geometry, impacts, and floor support.
    const wave = world.bossBlizzardWave || 0; // Pattern offset staggers the repeated overlapping waves.
    world.bossBlizzardWave = wave + 1; // Monotonic per-ruin phase, reset when the ruin is rebuilt.
    for (let z = arena.minZ + 1 + (wave % 2) * .7; z < arena.maxZ - 1; z += 2)
      for (let x = arena.minX + 1 + (wave % 3) * .6; x < arena.maxX - 1; x += 2) {
        if (tiles.length >= 32 || !clearAt(x, z, floorY(kit, x, z))) continue;
        tiles.push({x,z});
      }
    for (const [index,p] of tiles.entries()) {
      const geometry = world.icicleGeometries[(index + wave) % world.icicleGeometries.length]; // Reuses shared low-draw-call cluster shapes.
      const mesh = new THREE.Mesh(geometry,world.icicleMaterial);
      const ceiling = Math.max(world.ceilingY,(Number(world.context.meta?.floorSurfaceY)||0)+4.2);
      mesh.position.set(p.x,ceiling-.05,p.z);
      mesh.name='tothal_boss_ceiling_icicles';
      world.group.add(mesh);
      geometry.computeBoundingBox?.();
      const deepest = Math.max(.7,Math.abs(Number(geometry.boundingBox?.min?.y) || -1.2));
      world.icicles.push({...p,ground:floorY(kit,p.x,p.z),mesh,deepest,phase:'falling',speed:1.1+index%3*.2,owner:boss,temporary:true});
    }
    lastEvent='tothal:boss-overlap-wave-'+wave;
    return tiles.length;
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
        for (const actor of actors) if (actor !== spike.owner && !(actor.isSpecialLich && actor.lichType === 'tothal') && distance(pointOf(actor, kit.deps.TILE), spike) < 2) { // Nanahi is immune to every icicle in her sanctum; her skeleton minions are not.
          window.ResourceSystem?.addAffliction?.(actor, 'shatteredStamina', 13);
          window.ResourceSystem?.spendFooting?.(actor, 10, 'falling icicle');
          const fromX=spike.x*kit.deps.TILE,fromZ=spike.z*kit.deps.TILE; // Impact center produces outward canonical knockback.
          const options={footingDamageMultiplier:0}; // Existing explicit footing cost remains the sole footing damage.
          const sourceX=actor.x===fromX&&actor.y===fromZ?fromX-1:fromX; // Exact-center hits still have a defined outward direction.
          if(actor===kit.deps.player)kit.deps.damagePlayer?.(18,sourceX,fromZ,220,options);
          else kit.deps.damageCreature?.(actor,18,sourceX,fromZ,220,options);
        }
        lastEvent = 'tothal:icicle-shatter';
      }
    }
  }
  function initialPlasmCluster(kit,room) {
    const b=room.bounds;
    // Deterministically pick a 2x2, 3x3 or 4x4 contiguous puddle. A full
    // clear square is required: the seed can never be split around furniture
    // or through a wall. If the chosen size cannot fit, try smaller squares.
    const size=2+Math.floor(seeded(room.index,0x1919)*3);
    const candidates=[];
    for(let z=Math.ceil(b.minZ);z+1<b.maxZ;z++){
      for(let x=Math.ceil(b.minX);x+1<b.maxX;x++){
        candidates.push({x,z,sort:seeded(x*97+z*137,room.index+0x61b)});
      }
    }
    candidates.sort((a,b)=>a.sort-b.sort);
    for(let side=size;side>=2;side--){
      for(const origin of candidates){
        if(origin.x+side>b.maxX||origin.z+side>b.maxZ)continue;
        const cluster=[];
        let fits=true;
        for(let dz=0;dz<side&&fits;dz++)for(let dx=0;dx<side;dx++){
          const x=origin.x+dx,z=origin.z+dz,cx=x+.5,cz=z+.5;
          if(protectedPlasmTile(kit,x,z)||!clearAt(cx,cz,floorY(kit,cx,cz))){fits=false;break;}
          cluster.push(x+','+z);
        }
        if(fits)return new Set(cluster);
      }
    }
    return null; // No clear 2x2: do not plant a puddle through a solid or outside a room.
  }
  function makePlasm(kit) {
    for(const room of world.rooms){
      room.plasm=initialPlasmCluster(kit,room);
      room.plasmInitial=room.plasm ? new Set(room.plasm) : null; // Stable seed retained for diagnostics; active patches never grow, shrink or regenerate.
      room.plasmFloorY=new Map(); // Only the initial patch needs ground elevation; no room-wide floor scan per patch.
      for(const key of room.plasm||[]){
        const [x,z]=tileFromKey(key);
        room.plasmFloorY.set(key,floorY(kit,x+.5,z+.5));
      }
      room.plasmCap=room.plasm?.size||0; // Static occupancy is bounded exactly to its initial clear 2x2–4x4 cluster.
      room.plasmCulls=0;
    }
    const loader=new THREE.TextureLoader();
    const texture=loader.load(OIL_TEXTURE,t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;});
    world.ownedTexture=texture;
    // Snow-style curved edges; an individual patch is contiguous at birth and
    // remains in place until the entire ruin is left or regenerated.
    world.plasmMaterial=new THREE.MeshBasicMaterial({color:0x251c34,map:texture,transparent:true,opacity:.88,depthWrite:false});
    updatePlasmMesh(kit);
  }
  // Mirrors EnvironmentSurfaceMicroPlateau's snow: assemble the whole
  // connected patch, including its perimeter lip, BEFORE mapping the UVs.
  // The 9-slice mapper sees one real topological surface, not a copy of
  // canvas.png on each separate tile. Adjacent caps share their full-height
  // edge, while exposed edges slope down to ground.
  function plasmTextureCorners(patch,room) {
    // Build a deliberately low-detail connected quad lattice solely for
    // the shared snow nine-slice *UV solve*. Mapping thousands of curve
    // triangles every 500ms is prohibitively expensive; resolving two
    // triangles per cell and bilinearly transferring their mapped UVs
    // preserves one joined PNG and perimeter-aware border protection.
    const positions=[],indices=[];
    for(const key of patch){
      const [x,z]=tileFromKey(key),base=positions.length/3;
      positions.push(x,0,z,x+1,0,z,x,0,z+1,x+1,0,z+1);
      indices.push(base,base+2,base+3,base,base+3,base+1);
    }
    const source=new THREE.BufferGeometry();
    source.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    source.setIndex(indices);
    const corners=new Map();
    let mapping='continuous-planar-fallback';
    const mapper=window.HobunjiSurfaceStretchUV;
    if(typeof mapper?.mapGeometry==='function'){
      let mapped=null;
      try{
        mapped=mapper.mapGeometry(source,{
          label:'kanthic-plasm-room-'+room.index,
          angleToleranceDeg:89,edgeSourceFraction:.32,edgeReferenceWorldSize:6,
        });
        const p=mapped?.getAttribute?.('position'),uv=mapped?.getAttribute?.('uv');
        if(p&&uv?.count===p.count){
          for(let i=0;i<p.count;i++){
            const x=Math.round(p.getX(i)),z=Math.round(p.getZ(i));
            corners.set(x+','+z,[uv.getX(i),uv.getY(i)]);
          }
          mapping='edge-preserving-nine-slice';
        }
      }catch(error){console.warn?.('[kanthic-plasm] connected-surface UV mapping failed',error);}
      if(mapped&&mapped!==source)mapped.dispose?.();
    }
    source.dispose();
    return {corners,mapping};
  }
  function plasmHeightFactor(x,z,patch) {
    let nearest=.22; // Distance to the whole patch perimeter, shared by both sides of every tile seam.
    for(let tz=Math.floor(z-.22);tz<=Math.floor(z+.22);tz++){
      for(let tx=Math.floor(x-.22);tx<=Math.floor(x+.22);tx++){
        if(!patch.has(tx+','+tz))continue;
        const dx=Math.max(tx-x,0,x-tx-1),dz=Math.max(tz-z,0,z-tz-1); // Distance along an exposed unit edge, including its endpoints.
        if(!patch.has(tx+','+(tz-1)))nearest=Math.min(nearest,Math.hypot(dx,z-tz));
        if(!patch.has(tx+','+(tz+1)))nearest=Math.min(nearest,Math.hypot(dx,z-tz-1));
        if(!patch.has((tx-1)+','+tz))nearest=Math.min(nearest,Math.hypot(x-tx,dz));
        if(!patch.has((tx+1)+','+tz))nearest=Math.min(nearest,Math.hypot(x-tx-1,dz));
      }
    }
    const t=nearest/.22; // Smooth curved shoulder without independently tapering the adjoining tiles.
    return t*t*(3-2*t);
  }
  function makePlasmSurface(kit,room) {
    const patch=room.plasm;
    if(!patch?.size)return null;
    const axis=[0,.11,.22,.78,.89,1],width=axis.length;
    const pos=[],idx=[],uv=[];
    const {corners,mapping}=plasmTextureCorners(patch,room);
    const coordBounds=[Infinity,Infinity,-Infinity,-Infinity];
    if(mapping!=='edge-preserving-nine-slice'){
      for(const key of patch){
        const [x,z]=tileFromKey(key);
        coordBounds[0]=Math.min(coordBounds[0],x);coordBounds[1]=Math.min(coordBounds[1],z);
        coordBounds[2]=Math.max(coordBounds[2],x+1);coordBounds[3]=Math.max(coordBounds[3],z+1);
      }
    }
    for(const key of patch){
      const [x,z]=tileFromKey(key);
      const a=corners.get(x+','+z),b=corners.get((x+1)+','+z);
      const c=corners.get(x+','+(z+1)),d=corners.get((x+1)+','+(z+1));
      const mapped=!!(a&&b&&c&&d&&mapping==='edge-preserving-nine-slice');
      const base=pos.length/3;
      for(let j=0;j<width;j++)for(let i=0;i<width;i++){
        const u=axis[i],v=axis[j];
        const factor=plasmHeightFactor(x+u,z+v,patch); // Concave corners use the same perimeter distance from either neighboring tile.
        pos.push(x+u,(room.plasmFloorY.get(key)??floorY(kit,x+.5,z+.5))+.006+PLASM_DEPTH*factor,z+v);
        if(mapped){
          uv.push(a[0]*(1-u)*(1-v)+b[0]*u*(1-v)+c[0]*(1-u)*v+d[0]*u*v,
            a[1]*(1-u)*(1-v)+b[1]*u*(1-v)+c[1]*(1-u)*v+d[1]*u*v);
        }else{
          uv.push((x+u-coordBounds[0])/Math.max(1,coordBounds[2]-coordBounds[0]),
            (z+v-coordBounds[1])/Math.max(1,coordBounds[3]-coordBounds[1]));
        }
      }
      for(let j=0;j<width-1;j++)for(let i=0;i<width-1;i++){
        const v00=base+j*width+i,v10=v00+1,v01=v00+width,v11=v01+1;
        idx.push(v00,v01,v11,v00,v11,v10);
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setIndex(idx);
    const mesh=new THREE.Mesh(geometry,world.plasmMaterial);
    mesh.name='kanthic_plasm_connected_room_'+room.index;
    mesh.userData.plasmUvMapping=mapping;
    mesh.userData.plasmTileCount=patch.size;
    mesh.frustumCulled=false;
    return mesh;
  }
  function updatePlasmMesh(kit,changedRoom=null) {
    if(!world.plasmMesh){
      world.plasmMesh=new THREE.Group();
      world.plasmMesh.name='kanthic_plasm_connected_surfaces';
      world.group.add(world.plasmMesh);
    }
    const rooms=changedRoom?[changedRoom]:world.rooms;
    for(const room of rooms){
      const old=world.plasmRoomMeshes.get(room.index);
      if(old){old.parent?.remove(old);old.geometry?.dispose?.();}
      world.plasmRoomMeshes.delete(room.index);
      const mesh=makePlasmSurface(kit,room);
      if(mesh){world.plasmMesh.add(mesh);world.plasmRoomMeshes.set(room.index,mesh);}
    }
  }
  function obstructed(a,b,kit) {
    const count = Math.ceil(distance(a,b) * 3);
    for (let i = 1; i < count; i++) {
      const t = i / count, x = a.x + (b.x-a.x)*t, z = a.z + (b.z-a.z)*t;
      if (!clearAt(x,z,floorY(kit,x,z))) return true;
    }
    return false;
  }
  function protectedPlasmTile(kit,x,z) {
    const checkpoints=kit.state?.checkpoints; // Read the live checkpoint owner, including later activations.
    const points=[world.context.spawn,checkpoints?.active?.point]; // Entrance and any custom active respawn are always safe.
    for(const point of points)if(point&&Math.abs(x+.5-point.x)<=1.5&&Math.abs(z+.5-point.z)<=1.5)return true;
    for(const door of checkpoints?.doorways||[]){
      const normal=door.axis==='x'?Math.abs(x+.5-door.x):Math.abs(z+.5-door.z); // Protect both doorway landing sides before they become checkpoints.
      const across=door.axis==='x'?Math.abs(z+.5-door.z):Math.abs(x+.5-door.x);
      if(normal<=1.5&&across<=door.width*.5+.8)return true;
    }
    return false;
  }
  function resetPlasmOnDeath(kit) {
    if(!world)return;
    // Stationary patches are immutable: deaths only reset immersion, never rebuild geometry or change walkable space.
    world.sink=0;
    lastEvent='kanthic:immersion-reset';
  }
  function createSpellPlasm(x,z) {
    if(world?.theme!=='kanthic'||!Number.isFinite(x)||!Number.isFinite(z))return null;
    const kit=world.kit,patch={index:'spell',plasm:new Set(),plasmFloorY:new Map()};
    const baseX=Math.floor(x-.5),baseZ=Math.floor(z-.5);
    // A finite tile patch uses the very same curved, textured surface as room plasm.
    for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++){
      const tx=baseX+dx,tz=baseZ+dz,y=floorY(kit,tx+.5,tz+.5);
      if(protectedPlasmTile(kit,tx,tz)||!clearAt(tx+.5,tz+.5,y))continue;
      const key=tileKey(tx,tz),existing=plasmPatchAt(tx+.5,tz+.5,y);
      if(existing&&Math.abs(existing.plasmFloorY.get(key)-y)<.01)continue; // Never stack translucent copies of the same floor tile.
      patch.plasm.add(key);patch.plasmFloorY.set(key,y);
    }
    if(!patch.plasm.size)return null;
    patch.mesh=makePlasmSurface(kit,patch);
    world.group.add(patch.mesh);
    const owner=world;
    owner.spellPlasm.add(patch);
    return {mesh:patch.mesh,contains(x,z,y){
      const key=tileKey(x,z);
      return owner.spellPlasm.has(patch)&&patch.plasm.has(key)&&
        (!Number.isFinite(y)||Math.abs(patch.plasmFloorY.get(key)-y)<.01);
    },dispose(){
      if(!owner.spellPlasm.delete(patch))return;
      patch.mesh.parent?.remove(patch.mesh);patch.mesh.geometry.dispose?.();
    }};
  }

  function plasmPatchAt(x,z,supportY) {
    if(!world)return null;
    const key=tileKey(x,z);
    let best=null,bestDistance=Infinity;
    for(const room of world.rooms){
      if(!room.plasm?.has(key))continue;
      if(!Number.isFinite(supportY))return room;
      const distance=Math.abs(room.plasmFloorY.get(key)-supportY);
      if(distance<bestDistance){best=room;bestDistance=distance;}
    }
    for(const patch of world.spellPlasm){
      if(!patch.plasm.has(key))continue;
      if(!Number.isFinite(supportY))return patch;
      const distance=Math.abs(patch.plasmFloorY.get(key)-supportY);
      if(distance<bestDistance){best=patch;bestDistance=distance;}
    }
    return best;
  }

  function updatePlasm(kit,dt) {
    const player=kit.deps.player,tile=kit.deps.TILE;
    if(!player||!tile)return;
    const point=pointOf(player,tile);
    if(!alive(player)){
      if(world.playerWasAlive!==false)resetPlasmOnDeath(kit);
      world.playerWasAlive=false;
      return;
    }
    world.playerWasAlive=true;
    const key=tileKey(point.x,point.z);
    const playerY=Number(window.DevRandomRuin?.getPlayerGroundSupportY?.()??kit.deps.playerMesh?.position?.y); // Physical support chooses the matching tier when two floors share a tile.
    const room=plasmPatchAt(point.x,point.z,playerY);
    // Newly activated checkpoints are always safe, without altering or re-uploading the authored surface.
    if(!room?.plasm?.has(key)||protectedPlasmTile(kit,Math.floor(point.x),Math.floor(point.z))){
      world.sink=0;
      return;
    }
    const baseY=room.plasmFloorY.get(key)??floorY(kit,point.x,point.z); // Keep static puddles at the original floor, even if a bridge appears later.
    if(kit.ownsPlayerMotion?.()||player.climbing||playerY>baseY+PLASM_DEPTH+.08||(world.sink===0&&playerY<baseY-.3)){
      world.sink=0;
      return; // Ropes, flying and elevated supports take precedence.
    }
    let patch=null,best=Infinity; // Nearest seeded tile attracts the player; avoid allocating/sorting an array every frame.
    for(const tileName of room.plasm){
      const [x,z]=tileFromKey(tileName);
      const center={x:x+.5,z:z+.5};
      const squared=(center.x-point.x)**2+(center.z-point.z)**2;
      if(squared<best){best=squared;patch=center;}
    }
    world.sink=Math.min(1,world.sink+dt/PLASM_SINK_SECONDS);
    const pull=Math.min(distance(point,patch),PLASM_PULL_TILES_S*dt*(1+world.sink));
    if(pull>0){
      const dx=patch.x-point.x,dz=patch.z-point.z,d=Math.max(.001,Math.hypot(dx,dz));
      const nx=point.x+dx/d*pull,nz=point.z+dz/d*pull;
      if(clearAt(nx,nz,floorY(kit,point.x,point.z))){player.x=nx*tile;player.y=nz*tile;}
    }
    const bodyHeight=Math.max(.9,Number(kit.deps.playerMesh?.userData?.portraitModelHeight)||1.8);
    window.DevRandomRuin?.syncPlayerPresentationHeight?.(baseY-world.sink*bodyHeight);
    if(world.sink>=1){
      world.sink=0;
      player.health=0;
      if(SP.respawnAtCheckpoint?.('kanthic-plasm'))return;
      resetPlasmOnDeath(kit);
      world.playerWasAlive=false;
      kit.deps.handlePlayerDeath?.('kanthic-plasm');
      lastEvent='kanthic:plasm-death-reset';
    }
  }
  function onPlayerDeath(kit) {
    if(world?.theme!=='kanthic')return;
    resetPlasmOnDeath(kit); // Runs synchronously before checkpoint recovery restores health, so no death can be missed between frames.
    world.playerWasAlive=false;
  }
  function buildRooms(kit,context) {
    clear();
    if (context.hachutu===true || !['hronal','tothal','kanthic'].includes(context.theme) || !context.floorSet?.size) return; // The Hachutu dev wing never inherits unrelated Harlyao lich hazards or wall lighting.
    const rooms = (context.meta?.rooms || []).map((entry,index)=>({id:entry.id,index,bounds:kit.roomBounds(context.meta,entry)}));
    world = {
      theme:context.theme,context,rooms,kit,group:new THREE.Group(),dummy:new THREE.Object3D(),
      ceilingY:Number(context.ceilingY) || (Number(context.meta?.floorSurfaceY)||0) + (Number(context.meta?.wallHeight)||3),
      lights:[],pillars:[],iceTiles:new Set(),icicles:[],icicleGeometries:[],icicleMaterial:null,bursts:[],surfaceGeometries:new Map(),iceMesh:null,iceMaterial:null,
      spellPlasm:new Set(),plasmMesh:null,plasmRoomMeshes:new Map(),plasmGeometry:null,plasmMaterial:null,ownedTexture:null,sink:0,playerWasAlive:true,
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
    if (world.theme === 'tothal') {
      updateIcicles(kit,dt,actors); // Player ice physics run inside native game.js movement, before collision.
      for (const spike of world.icicles) if (spike.temporary && spike.phase === 'done') spike.mesh.parent?.remove?.(spike.mesh); // Shared geometry/material remain owned by the ruin.
      world.icicles = world.icicles.filter(spike => !spike.temporary || spike.phase !== 'done');
    }
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
    world.spellPlasm.clear(); // The traversal below owns all remaining spell geometry.
    world.group.traverse(obj=>{
      if(!obj.isMesh||icicleMeshes.has(obj)||burstMeshes.has(obj))return;
      if(obj.isInstancedMesh)obj.dispose?.(); // Release each surviving ice/plasm instance buffer.
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
      plasmCapacity:world.rooms.reduce((n,r)=>n+(r.plasmCap||0),0),
      plasmCulled:world.rooms.reduce((n,r)=>n+(r.plasmCulls||0),0),
      plasmGrowthMs:0, plasmStatic:true, latestChange:'Static, checkpoint-safe seeded plasm; no automatic growth, lantern erasure or geometry rebuilds.',
      sinking:world.sink,lastEvent,
    } : {active:false,lastEvent};
  }
  SP.registerComposer({id:'lichThemes',buildRooms,update,clear,snapshot,onPlayerDeath});
  window.DevRandomRuinLichThemes = Object.freeze({
    lightSources:()=>world?.lights||[],
    activeTheme:()=>world?.theme||null,
    snapshot,
    isIceAt:(x,z)=>!!world?.iceTiles?.has(tileKey(x,z)), // Identical coverage for rendering and native locomotion.
    movementPhysicsAt:(x,z)=>world?.theme==='tothal'&&world.iceTiles.has(tileKey(x,z))?ICE_PHYSICS:null, // No allocations per game frame.
    createSpellPlasm, // Lich drops share tile rendering, immersion and checkpoint recovery.
    triggerBossBlizzard, // Named Tothal phase uses the normal icicle physics, hit and shatter handlers.
    plasmTexture:() => world?.plasmMaterial?.map || null, // Shared Kanthic material source for headless Imlao's temporary body retexture.
    isPlasmAt:(x,z)=>!!plasmPatchAt(x,z), // Exact stationary render/physics occupancy.
    isProtectedPlasmAt:(x,z)=>!!(world?.theme==='kanthic'&&protectedPlasmTile(world.kit,Math.floor(x),Math.floor(z))), // Shared landing/doorway safety for both room and lich-spell plasm.
  });
})();
