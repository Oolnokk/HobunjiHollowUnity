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
  const ICE_GLIDE_FRACTION = 0.25; // Extra movement following intentional, lunge, dodge or knockback travel.
  const PLASM_DEPTH = 0.11; // Half the Western Slope snow height; used for Kanthic tiles.
  const PLASM_EXPANSION_MS = 1000; // One tile of hidden Kanthic growth per room per second.
  const PLASM_PULL_TILES_S = 0.72; // Player drift toward the nearest patch's interior.
  const PLASM_SINK_SECONDS = 2.8; // Time immersed in the pull before a full-body fatal sink.
  const ROCK_SFX = 'assets/audio/sfx/sfx_break_rock.mp3'; // Existing rock-break sample used for the three warning pulses.
  const OIL_TEXTURE = 'assets/textures/canvas.png'; // Same petroleum-surface texture as HarlyaoLichCombat.
  const LIGHT_CAP = 120; // Bound per-frame 2D light-mask work on large generated sites.
  let world = null; // Active composer state, invalidated on reroll/exit.
  let audioContext = null; // Lazily used for the 150%-gain third Hronal pulse.
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
  function playRockPulse(gain) {
    try {
      const settings = window.AudioSystem?.gameAudioConfig?.() || {}; // All three warning pulses respect the game's master SFX/mute setting.
      if (settings.enabled === false) return;
      const configuredVolume = Number(settings.sfxVolume);
      const volume = Number.isFinite(configuredVolume) ? between(configuredVolume, 0, 1) : 1;
      const audio = new Audio(ROCK_SFX); // Reused audio asset; each scheduled pulse has its own playback.
      audio.volume = Math.min(1, gain * volume);
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
  function addLight(x, y, z, radius, strength, color) {
    if (world.lights.length < LIGHT_CAP) world.lights.push({ x, y, z, radius, strength, color });
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
  function addSurfaceInstance(mesh, index, x, y, z, scale = 1) {
    const dummy = world.dummy; // One reusable Object3D for all instance matrices.
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(scale, 1, scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  function makeIce(kit) {
    const tiles = []; // Coverage and movement test share this one exact set.
    for (const room of world.rooms) {
      const keys = [];
      for (const key of world.context.floorSet || []) {
        const [x, z] = tileFromKey(key), p = { x:x + .5, z:z + .5 };
        if (p.x >= room.bounds.minX && p.x < room.bounds.maxX && p.z >= room.bounds.minZ && p.z < room.bounds.maxZ) keys.push(key);
      }
      const ranked = keys.map((key, i) => ({ key, sort:seeded(i, room.index + 0x3107) })).sort((a, b) => a.sort - b.sort);
      for (const entry of ranked.slice(0, Math.round(keys.length * ICE_COVERAGE))) {
        const [x, z] = tileFromKey(entry.key), cx = x + .5, cz = z + .5;
        if (!clearAt(cx, cz, floorY(kit, cx, cz))) continue; // Do not bury a solid puzzle/door in a slippery tile.
        world.iceTiles.add(entry.key); tiles.push({ x:cx, z:cz, y:floorY(kit, cx, cz) });
      }
    }
    if (!tiles.length) return;
    const geo = new THREE.PlaneGeometry(.985, .985); // Almost-flat ice skin, slightly inset to avoid tile-edge z fighting.
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color:0x8bcdf5, transparent:true, opacity:.31, depthWrite:false, side:THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, tiles.length); // One draw call for all icy tiles.
    mesh.name = 'tothal_ice_sheen';
    for (let i = 0; i < tiles.length; i++) addSurfaceInstance(mesh, i, tiles[i].x, tiles[i].y + .018, tiles[i].z);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    world.group.add(mesh);
  }
  function makeIcicles(kit) {
    const geo = new THREE.ConeGeometry(.16, .94, 6);
    geo.rotateZ(Math.PI); // Cone tip points down from the structural ceiling.
    const mat = new THREE.MeshBasicMaterial({ color:0xa0d7ef, transparent:true, opacity:.82 });
    for (const room of world.rooms) {
      const candidates = [];
      for (const key of world.iceTiles) {
        const [x, z] = tileFromKey(key);
        if (x + .5 > room.bounds.minX + 1 && x + .5 < room.bounds.maxX - 1 &&
            z + .5 > room.bounds.minZ + 1 && z + .5 < room.bounds.maxZ - 1) candidates.push({x:x + .5, z:z + .5});
      }
      candidates.sort((a, b) => seeded(Math.round(a.x * 57 + a.z * 83), room.index) - seeded(Math.round(b.x * 57 + b.z * 83), room.index));
      for (const p of candidates.slice(0, Math.min(6, Math.floor(candidates.length / 9)))) {
        const ground = floorY(kit, p.x, p.z);
        if (world.ceilingY - ground < 2.1) continue;
        const mesh = new THREE.Mesh(geo, mat); // Shared icicle geometry/material, individually movable on release.
        mesh.position.set(p.x, world.ceilingY - .47, p.z);
        mesh.name = 'tothal_falling_icicle';
        world.group.add(mesh);
        world.icicles.push({ ...p, ground, mesh, phase:'hanging', speed:0 });
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
  function makePillars(kit) {
    // Decorative traps are placed in accessible room corners, grounded to their support
    // and ceiling. They do not replace progression-critical V50 support columns.
    for (const room of world.rooms) {
      if (room.index % 2 !== 0) continue;
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
      const pillar = { x:point.x, z:point.z, y, height, group, cracks, phase:'idle', elapsed:0, pulses:0 }; // Explosion state is also the live collision-footprint gate.
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
          crack.material.opacity = .14 + pillar.pulses * .25;
          crack.scale.x = 1 + pillar.pulses * 1.5;
        }
        lastEvent = 'hronal:pulse-' + pillar.pulses;
      }
      if (pillar.elapsed < 3) continue; // Blast one second after the third pulse.
      pillar.phase = 'spent';
      pillar.group.visible = false;
      window.DevRandomRuinTileOccupancy?.refresh?.(); // Remove destroyed pillar collision on the same frame as the explosion.
      emitShards(pillar.x, pillar.y + pillar.height * .45, pillar.z, 0x726359, PILLAR_RADIUS, 64, pillar.height, .62);
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
        if (actors.some(a => distance(pointOf(a, kit.deps.TILE), spike) < .55)) {
          spike.phase = 'falling'; spike.speed = .5; lastEvent = 'tothal:icicle-fall';
        }
      } else {
        spike.speed = Math.min(3.4, spike.speed + dt * 2.3); // Enough fall time to step or dodge out.
        spike.mesh.position.y -= spike.speed * dt;
        if (spike.mesh.position.y > spike.ground + .2) continue;
        spike.mesh.visible = false; spike.phase = 'done';
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
    const tile = kit.deps.TILE;
    for (const actor of actors) {
      const point = pointOf(actor, tile);
      let motion = world.motion.get(actor);
      if (!motion) {
        motion = { last:point, path:0, dir:{x:0,z:0}, still:0, slide:0, sliding:false };
        world.motion.set(actor, motion);
        continue;
      }
      const dx = point.x - motion.last.x, dz = point.z - motion.last.z;
      const delta = Math.hypot(dx, dz), icy = world.iceTiles.has(tileKey(point.x, point.z));
      if (!icy) { motion.path = 0; motion.sliding = false; motion.slide = 0; motion.still = 0; motion.last = point; continue; }
      if (motion.sliding) {
        if (delta > .3) { motion.sliding = false; motion.slide = 0; motion.path = 0; }
        else {
          const step = Math.min(motion.slide, dt * 4);
          if (step > 0) {
            const target = { x:point.x + motion.dir.x * step, z:point.z + motion.dir.z * step };
            const y = floorY(kit, point.x, point.z);
            const permitted = clearAt(target.x, target.z, y) && Math.abs(floorY(kit,target.x,target.z) - y) < .4;
            if (!permitted) { collisionImpact(actor, kit, motion.slide); motion.slide = 0; }
            else {
              actor.x = target.x * tile; actor.y = target.z * tile;
              motion.slide -= step;
              if (actor === kit.deps.player) window.DevRandomRuin?.syncPlayerPresentationHeight?.(floorY(kit, target.x, target.z));
            }
          }
          if (motion.slide <= .0001) motion.sliding = false;
          motion.last = pointOf(actor, tile);
          continue;
        }
      }
      if (delta > .001 && delta < 1) {
        motion.path += delta;
        motion.dir.x = dx / delta; motion.dir.z = dz / delta;
        motion.still = 0;
      } else if (delta <= .001) {
        motion.still += dt;
        if (motion.path > .12 && motion.still >= .08 && !window.DevRandomRuinSimplePuzzles?.ownsPlayerMotion?.()) {
          motion.slide = motion.path * ICE_GLIDE_FRACTION;
          motion.sliding = true; motion.path = 0; motion.still = 0;
        }
      }
      motion.last = point;
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
    world.plasmGeometry = new THREE.BoxGeometry(.99, PLASM_DEPTH, .99);
    world.plasmMaterial = new THREE.MeshBasicMaterial({color:0x251c34, map:texture, transparent:true, opacity:.88, depthWrite:false});
    updatePlasmMesh(kit);
  }
  function updatePlasmMesh(kit) {
    const patches = world.rooms.flatMap(room => [...(room.plasm || [])]);
    world.plasmMesh?.parent?.remove(world.plasmMesh);
    world.plasmMesh?.dispose?.();
    if (!patches.length) { world.plasmMesh = null; return; }
    const mesh = new THREE.InstancedMesh(world.plasmGeometry, world.plasmMaterial, patches.length);
    mesh.name = 'kanthic_plasm_snow_shelf';
    patches.forEach((key, index) => {
      const [x,z] = tileFromKey(key);
      addSurfaceInstance(mesh, index, x+.5, floorY(kit,x+.5,z+.5) + PLASM_DEPTH*.4, z+.5);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    world.group.add(mesh); world.plasmMesh = mesh;
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
      lights:[],pillars:[],iceTiles:new Set(),icicles:[],bursts:[],motion:new WeakMap(),
      plasmMesh:null,plasmGeometry:null,plasmMaterial:null,ownedTexture:null,lastPlasmRoom:null,sink:0,
    };
    world.group.name = 'dev_ruin_lich_theme_'+world.theme;
    kit.group().add(world.group);
    makeRoomLights(kit);
    if (world.theme === 'hronal') { makePillars(kit); window.DevRandomRuinTileOccupancy?.refresh?.(); }
    if (world.theme === 'tothal') { makeIce(kit); makeIcicles(kit); }
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
      const badge = document.getElementById('devRandomRuinBadge');
      if (badge) {
        const report = snapshot();
        const suffix = ' · lich '+world.theme[0].toUpperCase()+' P'+report.burstPillars+'/'+report.totalPillars+
          ' I'+report.iceTiles+' C'+report.fallenIcicles+'/'+report.icicles+' K'+report.plasmTiles+
          ' sink'+Math.round(report.sinking*100)+'% '+report.lastEvent;
        badge.textContent = badge.textContent.replace(/ · lich [HTK] P[^·]+/, '') + suffix;
      }
    }
  }
  function clear() {
    if (!world) return;
    for (const spike of world.icicles) spike.mesh.parent?.remove(spike.mesh); // Shared geometry belongs to the composer instance.
    if (world.icicles.length) {world.icicles[0].mesh.geometry.dispose();world.icicles[0].mesh.material.dispose();}
    for (const burst of world.bursts) {burst.mesh.geometry.dispose();burst.mesh.material.dispose();}
    window.DevRandomRuinTileOccupancy?.clearSolids?.('lich-theme-pillars'); // Reroll/leave cannot strand invisible, still-colliding Hronal columns.
    window.DevRandomRuinTileOccupancy?.refresh?.();
    world.plasmGeometry?.dispose(); world.plasmMaterial?.dispose(); world.ownedTexture?.dispose();
    world.group.parent?.remove(world.group);
    world.group.traverse(obj => {
      if (obj.isMesh && obj !== world.plasmMesh && !world.icicles.some(i=>i.mesh===obj) && !world.bursts.some(b=>b.mesh===obj)) {
        obj.geometry?.dispose?.(); obj.material?.dispose?.();
      }
    });
    world = null;
    badgeClock = 0;
  }
  function snapshot() {
    return world ? {
      theme:world.theme,rooms:world.rooms.length,lightSources:world.lights.length,
      chargedPillars:world.pillars.filter(p=>p.phase==='charging').length,
      burstPillars:world.pillars.filter(p=>p.phase==='spent').length,
      totalPillars:world.pillars.length,iceTiles:world.iceTiles.size,
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
