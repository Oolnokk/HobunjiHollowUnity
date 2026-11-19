// Five Wandering Blossoms: pooled falling-petal points attached to their real branch geometry.
// Uses the one RuntimeFrameScheduler pre-render phase; there is no independent RAF or per-tree timer.
(() => {
  'use strict';
  const SCHEDULER_ID = 'festival-blossom-falling-petals'; // Feature-owned scheduler slot, enabled only when at least one blossom is nearby.
  const CAP = 14; // Upper bound per currently visible blossom tree (at most two in any wilderness zone).
  const RANGE = 28; // Player-to-tree distance in final-map tiles, used by the existing 200-ms festival update.
  const SPAWN_RATE = 2.7; // Falling petals per second per nearby, unculled tree.
  const emitters = new Map(); // Tree root -> its one pooled GPU Points mesh and up to CAP mutable particle records.
  let petalTexture = null; // One immutable 12x12 RGBA petal sprite shared by every color and biome.
  let registered = false; // Prevents duplicate permanent frame subscriptions on world/character reload.
  let lastArea = ''; // Active zone supplied by the festival's existing low-frequency update.
  let lastTile = null; // Last tile coordinate gates emission without per-frame map or proximity searches.

  function spriteTexture(T) {
    if (petalTexture) return petalTexture;
    if (!T?.DataTexture || !T?.RGBAFormat) return null;
    const width = 12, bytes = new Uint8Array(width * width * 4); // Tiny CPU-generated white petal with a tapered tip and soft edge.
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      const ny = (y - 5.5) / 5.5, nx = (x - 5.5) / 5.5;
      const outline = nx*nx / Math.pow(0.85 - 0.24*ny, 2) + ny*ny;
      const idx = (y*width + x)*4;
      bytes[idx] = 255; bytes[idx+1] = 255; bytes[idx+2] = 255;
      bytes[idx+3] = outline >= 1 ? 0 : outline > 0.79 ? 155 : 245;
    }
    petalTexture = new T.DataTexture(bytes, width, width, T.RGBAFormat); // No canvas or fetched texture: safe in WebGL1/mobile.
    petalTexture.magFilter = T.NearestFilter; petalTexture.minFilter = T.NearestFilter;
    petalTexture.generateMipmaps = false; petalTexture.needsUpdate = true;
    return petalTexture;
  }

  function generator(seed) {
    let state = 2166136261; // Deterministic per-tree visual jitter, independent of world RNG or quest generation.
    for(const letter of String(seed)) {state ^= letter.charCodeAt(0);state = Math.imul(state,16777619);}
    return () => { state = (Math.imul(state,1664525)+1013904223)>>>0; return state/4294967296; };
  }

  function ensureScheduler() {
    if (registered) return true;
    const scheduler = window.RuntimeFrameScheduler;
    if (!scheduler?.register || !scheduler?.setEnabled) return false;
    scheduler.register(SCHEDULER_ID, frame, {phase:'pre-render',enabled:false,
      owner:'FestivalBlossomPetals',description:'Pooled branch-tip petals on nearby visible blossom trees'});
    registered = true;
    return true;
  }

  function attach(tree) {
    if (!tree || emitters.has(tree)) return emitters.has(tree);
    const T = window.THREE, sources = tree.userData?.wildernessBlossomPetalSources;
    if (!Array.isArray(sources) || !sources.length || !T?.Points || !T?.BufferGeometry || !T?.PointsMaterial ||
        !T?.Float32BufferAttribute || !spriteTexture(T)) return false;
    const geometry = new T.BufferGeometry(); // One position buffer, drawn as one Points call rather than 14 meshes.
    const positions = new T.Float32BufferAttribute(new Float32Array(CAP*3), 3);
    positions.setUsage?.(T.DynamicDrawUsage);
    geometry.setAttribute('position',positions);
    geometry.setDrawRange(0,0); // Do not display zero-initialized particles at the trunk before the first emission.
    const material = new T.PointsMaterial({
      map:petalTexture,color:tree.userData?.wildernessBlossom?.blossomColor || '#ffffff',
      size:0.24, sizeAttenuation:true,transparent:true,opacity:0.86,
      depthWrite:false,alphaTest:0.06
    });
    const points = new T.Points(geometry,material); // Children inherit tree transforms and its existing directional/radial culling.
    points.name = 'wilderness-blossom-falling-petals';
    points.frustumCulled = false; // The moving points extend beyond their initially empty BufferGeometry bounds.
    points.visible = false;
    points.raycast = () => {};
    tree.add(points);
    emitters.set(tree,{tree,points,geometry,positions,sources,rnd:generator(tree.userData.wildernessBlossom?.seed),
      particles:[],spawnDebt:0,active:false}); // Fixed allocation per tree; each active particle is reused until exit.
    ensureScheduler();
    return true;
  }

  function detach(tree) {
    const state = emitters.get(tree);
    if (!state) return false;
    state.points.parent?.remove?.(state.points);
    state.geometry.dispose?.();
    state.points.material.dispose?.(); // Color-specific material is owned by this tree; the immutable texture remains shared.
    emitters.delete(tree);
    refreshActivity();
    return true;
  }

  function isNear(state) {
    const tile = lastTile, tree = state.tree;
    return !!(tile && tile.area === lastArea && lastArea === tree.userData?.wildernessBlossom?.zoneId
      && Number.isFinite(tile.col) && Number.isFinite(tile.row) && tree.parent
      && Math.hypot(tile.col+0.5-tree.position.x,tile.row+0.5-tree.position.z) <= RANGE);
  }

  function refreshActivity() {
    let nearby = false;
    for (const state of emitters.values()) {
      state.active = isNear(state);
      if (!state.active) {
        state.points.visible = false; state.spawnDebt = 0; state.particles.length = 0;
        state.geometry.setDrawRange(0,0); // No stale points when teleporting back or changing zones.
      } else nearby = true;
    }
    if (ensureScheduler()) window.RuntimeFrameScheduler.setEnabled(SCHEDULER_ID,nearby);
  }

  function setContext(tile, area) {
    lastTile = tile; lastArea = area || '';
    refreshActivity(); // Called on the existing festival update/tile transition, never from the frame callback.
  }

  function spawn(state) {
    const rnd = state.rnd, source = state.sources[Math.floor(rnd()*state.sources.length)];
    if (!source || state.particles.length >= CAP) return;
    const speed = 0.7 + rnd()*0.50; // Local tree units/second; the native group transform supplies its physical scale.
    const fallHeight = Math.max(0,source[1]-0.12); // Actual branch-to-ground distance; canopy tiers can be much taller than five units.
    const fallTime = (Math.sqrt(speed*speed+0.9*fallHeight)-speed)/0.45; // Gentle acceleration gets tall-branch petals near ground before expiry.
    state.particles.push({
      x:source[0] + (rnd()-0.5)*0.14, y:source[1], z:source[2] + (rnd()-0.5)*0.14,
      vx:(rnd()-0.5)*0.24,vz:(rnd()-0.5)*0.24,age:0,phase:rnd()*Math.PI*2,speed,
      life:Math.min(12,Math.max(1.5,fallTime+0.25))
    }); // Falling petals reach the tree's local ground plane instead of despawning at mid-canopy height.
  }

  function frame({deltaMs = 0} = {}) {
    const dt = Math.min(0.05,Math.max(0,Number(deltaMs)||0)/1000); // Prevents background-tab resume from simulating minutes of petals.
    if (dt === 0) return;
    for (const state of emitters.values()) {
      const visible = state.active && state.tree.visible !== false && !!state.tree.parent;
      state.points.visible = visible; // Respect the native cullable's visibility; never issue a Points draw in a culled tree.
      if (!visible) { // Cull transitions remove old particles rather than freezing them in midair until the camera returns.
        state.points.visible=false; state.particles.length=0; state.spawnDebt=0;
        state.geometry.setDrawRange(0,0);
        continue;
      }
      state.spawnDebt = Math.min(2,state.spawnDebt + dt*SPAWN_RATE);
      while(state.spawnDebt >= 1) {
        if(state.particles.length < CAP) spawn(state);
        state.spawnDebt--;
      }
      const particles = state.particles;
      for (let i=0;i<particles.length;) {
        const p = particles[i];
        p.age += dt; p.y -= (p.speed+0.45*p.age)*dt; // Petals gently accelerate toward the ground instead of expiring in the upper canopy.
        if(p.age>=p.life || p.y<0.10) {
          particles[i]=particles[particles.length-1];particles.pop();continue;
        }
        p.x += p.vx*dt; p.z += p.vz*dt;
        const flutter = 0.045*Math.sin(p.age*6+p.phase); // A cheap drifting wobble, no per-particle mesh or trig transforms.
        state.positions.setXYZ(i,p.x+flutter,p.y,p.z-flutter*0.6);
        i++;
      }
      state.geometry.setDrawRange(0,particles.length);
      if(particles.length)state.positions.needsUpdate = true; // Upload only the tiny live position buffer.
    }
  }

  function debugSnapshot() {
    return {trees:emitters.size,nearby:[...emitters.values()].filter(s=>s.active).length,
      visible:[...emitters.values()].filter(s=>s.points.visible).length,
      livePetals:[...emitters.values()].reduce((n,s)=>n+s.particles.length,0),
      capPerTree:CAP,schedulerRegistered:registered,area:lastArea};
  }

  window.FestivalBlossomPetals = Object.freeze({attach,detach,setContext,debugSnapshot,
    __test:Object.freeze({frame,cap:CAP,range:RANGE})});
})();
