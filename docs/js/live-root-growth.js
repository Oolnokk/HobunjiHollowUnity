// LiveRootGrowth — purpose-agnostic growth/retraction on invisible furniture geometry.
// Shares the temple's FoliageGenerator surface-wrap implementation, not a second
// foliage renderer. No frame loop or collision/puzzle rules live in this module.
(function (root) {
  'use strict';

  const TEMPLE_ROOT_FINISH = Object.freeze({
    color: '#0e0d06', texture: 'assets/textures/wibbly_surface.png'
  }); // Fallback matches the Temple's authored roots in config/pieces/temple.json.

  const DEFAULTS = Object.freeze({
    seed: 'ruin-root-growth-1', floorWidth: 8, floorDepth: 8, floorY: 0,
    branchCount: 9, duration: 0.5, branchRadius: 0.065, bend: 0.42, arcConcavity: 0.72,
    floorDensity: 6, targetDensity: 6, strandLimit: 80,
    shapeInset: 0.035, volumeFillDepth: 0.24, // Inward bark surface clearance plus internal layers filling the target volume.
    targetLength: 12, floorLength: 12,
    radius: 0.045, curl: 0.6, showGuide: false
  }); // Every instance gets its own normalized, serializable configuration.

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value)); // Used by bounded imported recipes, animation and mesh budgets.
  const number = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? clamp(n, min, max) : fallback;
  }; // Rejects NaN/infinite values before allocating growth geometry.
  function normalizeRecipe(value = {}) {
    const data = value && typeof value === 'object' ? value : {};
    const result = { seed: String(data.seed ?? DEFAULTS.seed).slice(0, 128) }; // Stable serialized seed for both the floor and guide.
    for (const key of ['floorWidth', 'floorDepth']) result[key] = number(data[key], DEFAULTS[key], 1, 32);
    result.floorY = number(data.floorY, DEFAULTS.floorY, -10, 10);
    result.branchCount = Math.round(number(data.branchCount, DEFAULTS.branchCount, 1, 32));
    result.duration = number(data.duration, DEFAULTS.duration, 0.15, 60);
    result.branchRadius = number(data.branchRadius, DEFAULTS.branchRadius, 0.008, 0.3);
    result.bend = number(data.bend, DEFAULTS.bend, 0, 3);
    result.arcConcavity = number(data.arcConcavity, DEFAULTS.arcConcavity, 0, 1); // Controls how long rising branches hug the floor before curving toward their destination.
    for (const key of ['floorDensity', 'targetDensity']) result[key] = number(data[key], DEFAULTS[key], 0.05, 6);
    result.strandLimit = Math.round(number(data.strandLimit, DEFAULTS.strandLimit, 1, 80));
    for (const key of ['floorLength', 'targetLength']) result[key] = number(data[key], DEFAULTS[key], 0.5, 30);
    result.radius = number(data.radius, DEFAULTS.radius, 0.005, 0.3);
    result.shapeInset = number(data.shapeInset, DEFAULTS.shapeInset, 0, 0.5);
    result.volumeFillDepth = number(data.volumeFillDepth, DEFAULTS.volumeFillDepth, 0, 0.5);
    result.curl = number(data.curl, DEFAULTS.curl, 0, 2);
    result.showGuide = data.showGuide === true;
    return result;
  }

  function hashSeed(str) {
    let h = 2166136261 >>> 0; // FNV-1a seed; shared recipe strings always regenerate the same branch origins.
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function randomFromSeed(str) {
    let value = hashSeed(str); // Instance-local PRNG; never consumes the global random stream.
    return () => {
      let x = (value += 0x6D2B79F5);
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  const smooth = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); }; // Ease used by both extend and retract.

  function growthMeshes(group) {
    const meshes = [];
    group?.traverse?.(node => { if (node.isMesh && node.geometry?.getAttribute('position')) meshes.push(node); });
    return meshes;
  }
  function findGrowthMesh(group) { return growthMeshes(group)[0] || null; }

  // The shared FoliageGenerator deliberately caps each Wrap pass at density 1.
  // Higher values here mean layered independent seeded Wrap passes, rather
  // than modifying the generator's global semantics or silently clamping to 1.
  function disposeGenerated(groups) {
    const geometries=new Set(),materials=new Set(); // Generated assets can share materials across strands; release each owned resource once.
    for(const group of groups)group?.traverse(node=>{
      if(node.geometry)geometries.add(node.geometry);
      for(const material of Array.isArray(node.material)?node.material:[node.material])if(material)materials.add(material);
    });
    for(const geometry of geometries)geometry.dispose();
    for(const material of materials)material.dispose();
  }
  function* buildDenseWrap(THREE, foliage, parent, options, density, layerOptions = null) {
    if (density <= 1) {
      const layer=foliage.buildSurfaceGrowth(parent,{...options,density,...(layerOptions?.(0,1) || {})}); // Single-pass recipes also give the browser a chance to paint.
      let complete=false; // A cancelled asynchronous build owns and releases this unfinished layer.
      try{yield {part:options.growthLabel||'Floor',layer:1,layers:1};complete=true;return layer;}
      finally{if(!complete)disposeGenerated([layer]);}
    }
    const layers = new THREE.Group();
    layers.name = 'Layered surface roots';
    layers.userData.surfaceFoliage = true; // Other layers must ignore all already-generated growth.
    layers.userData.surfaceGrowthEndpoints = [];
    layers.userData.generatedStrands = 0;
    let remaining = density, pass = 0;
    let complete=false; // Cancellation while paused between layers must not leak partial geometry.
    try { while (remaining > 0.00001) {
      const totalPasses=Math.ceil(density);
      const layer = foliage.buildSurfaceGrowth(parent, {
        ...options, density:Math.min(1,remaining), seed:options.seed+':layer-'+pass,
        ...(layerOptions?.(pass,totalPasses) || {})
      });
      layers.add(layer); // Only generated geometry; the floor/furniture remains the source.
      layers.userData.generatedStrands += layer.userData?.generatedStrands || 0;
      for (const endpoint of layer.userData?.surfaceGrowthEndpoints || []) {
        layers.userData.surfaceGrowthEndpoints.push(endpoint);
      }
      remaining -= 1; pass++;
      yield {part:options.growthLabel||'Floor',layer:pass,layers:totalPasses};
    }
    layers.userData.diagnostics = pass + ' independent Wrap layers; ' +
      layers.userData.generatedStrands + ' total root strands';
    layers.userData.densityPasses = pass;
    complete=true;return layers;
    } finally {if(!complete)disposeGenerated([layers]);}
  }

  // Build a ground-rooted part graph from actual geometry, not part names.
  // This works for authored furniture parts and for independent GLB/procedural
  // meshes, including renamed legs/posts and multi-part arches.
  function planFurnitureGrowth(THREE, target, floorY, radius) {
    target.updateWorldMatrix(true, true);
    const parts=[];
    target.traverse(mesh=>{
      if(!mesh.isMesh || !mesh.geometry?.getAttribute?.('position'))return;
      let node=mesh,excluded=false;
      while(node){ excluded ||= !!(node.userData?.surfaceFoliage ||
        node.userData?.surfaceFoliageExclude || node.userData?.surfaceFoliageGuide);
        if(node===target)break; node=node.parent; }
      if(excluded)return;
      const bounds=new THREE.Box3().setFromObject(mesh);
      if(mesh.isInstancedMesh){
        mesh.geometry.computeBoundingBox();
        bounds.makeEmpty();
        const matrix=new THREE.Matrix4(),world=new THREE.Matrix4(); // Include every placed ruin-floor brick, rather than only the untransformed source brick.
        for(let instance=0;instance<mesh.count;instance++){
          mesh.getMatrixAt(instance,matrix);world.multiplyMatrices(mesh.matrixWorld,matrix);
          bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(world));
        }
      }
      if(bounds.isEmpty?.())return;
      const min=bounds.min,max=bounds.max;
      if(![min.x,min.y,min.z,max.x,max.y,max.z].every(Number.isFinite))return;
      parts.push({index:parts.length,mesh,bounds,
        label:String(mesh.userData?.authoredPart?.name || mesh.name || 'Furniture part '+parts.length),
        parent:null,depth:0,grounded:false,linkGap:0});
    });
    if(!parts.length)throw new Error('The imported furniture has no valid growth parts.');
    const floorGap=Math.max(.18,radius*4);
    const structuralFloors=parts.filter(p=>p.mesh.userData?.liveRootFloor); // A ruin grows from its real floor before reaching walls and furniture.
    let grounded=structuralFloors.length?structuralFloors:parts.filter(p=>p.bounds.min.y<=floorY+floorGap &&
      p.bounds.max.y>=floorY-floorGap);
    if(!grounded.length){ // An elevated asset still needs one entry point, never all-at-once targets.
      const minHeight=Math.min(...parts.map(p=>p.bounds.min.y));
      grounded=parts.filter(p=>p.bounds.min.y<=minHeight+floorGap);
    }
    for(const part of grounded)part.grounded=true;
    const visited=new Set(grounded);
    // AABB contact is independent of naming and mesh origin. Non-touching
    // sections can still be bridged by a visible connector from the nearest
    // already-rooted section; they must never sprout directly from the floor.
    const gap=(a,b)=>{
      const axis=(a0,a1,b0,b1)=>Math.max(0,a0-b1,b0-a1);
      return Math.hypot(axis(a.min.x,a.max.x,b.min.x,b.max.x),
        axis(a.min.y,a.max.y,b.min.y,b.max.y),
        axis(a.min.z,a.max.z,b.min.z,b.max.z));
    };
    while(visited.size<parts.length){
      let best=null;
      for(const parent of visited)for(const child of parts){
        if(visited.has(child))continue;
        const separation=gap(parent.bounds,child.bounds);
        const upward=Math.max(0,child.bounds.min.y-parent.bounds.min.y);
        const backwards=Math.max(0,parent.bounds.min.y-child.bounds.min.y);
        const cost=separation+upward*.015+backwards*.35+parent.depth*.005;
        if(!best||cost<best.cost)best={parent,child,separation,cost};
      }
      if(!best)break;
      best.child.parent=best.parent.index;best.child.depth=best.parent.depth+1;
      best.child.linkGap=best.separation;
      visited.add(best.child);
    }
    return parts;
  }

  // Find an actual rooted strand near each piece-to-piece connection. A
  // connecting shoot is animated BEFORE the newly reached part can fill in.
  function nearestStrandPoint(THREE, growth, destination, worldParent) {
    let nearest=null,dist=Infinity;
    for(const mesh of growthMeshes(growth)){
      const attr=mesh.geometry.getAttribute('position'),step=Math.max(6,Math.floor(attr.count/1800/6)*6);
      for(let i=0;i+5<attr.count;i+=step){
        const p=new THREE.Vector3();
        for(let j=0;j<5;j++)p.add(new THREE.Vector3().fromBufferAttribute(attr,i+j));
        p.multiplyScalar(.2);
        mesh.localToWorld(p); // Wrapped meshes are in target-local coordinates; bridge controls live in root-group space.
        worldParent.worldToLocal(p);
        const d=p.distanceToSquared(destination);
        if(d<dist){dist=d;nearest=p;}
      }
    }
    return nearest||destination.clone();
  }

  // Indexed triangles are grouped into ascending-height buckets, retaining
  // topology and UVs. Draw ranges can then grow up a leg/post rather than
  // revealing arbitrarily ordered whole strands along its length.
  function orderGrowthByHeight(mesh) {
    const geometry=mesh.geometry,index=geometry?.getIndex?.(),position=geometry?.getAttribute?.('position');
    const entries=index?.array;
    if(!entries||!position||entries.length<6)return;
    geometry.computeBoundingBox?.();
    const minY=geometry.boundingBox?.min?.y??0,maxY=geometry.boundingBox?.max?.y??minY;
    const buckets=Array.from({length:32},()=>[]);
    const range=Math.max(.0001,maxY-minY);
    for(let i=0;i<entries.length;i+=3){
      const y=Math.min(position.getY(entries[i]),position.getY(entries[i+1]),position.getY(entries[i+2]));
      const bin=clamp(Math.floor((y-minY)/range*32),0,31);
      buckets[bin].push(entries[i],entries[i+1],entries[i+2]);
    }
    let offset=0;
    for(const bucket of buckets){entries.set(bucket,offset);offset+=bucket.length;}
    index.needsUpdate=true;
  }

  // Particle emitters need real world positions but must NOT become descendants
  // of hidden furniture meshes. Rebuild the source part's transform-only ancestry
  // in a visible host, retaining nested part offsets/rotation/scale exactly.
  function buildParticleAnchors(THREE, group, target) {
    const host = new THREE.Group();
    host.name = 'Furniture particle effects (visible anchors, hidden source geometry)';
    host.position.copy(target.position);
    host.quaternion.copy(target.quaternion);
    host.scale.copy(target.scale);
    const sourceNodes = new Map(), anchors = new Map(), cloned = new Map();
    target.traverse(node => {
      if (node.userData?.authoredPartId) sourceNodes.set(node.userData.authoredPartId,node);
    });
    for (const [id,part] of sourceNodes) {
      const lineage = []; let current = part;
      while (current && current !== target) { lineage.unshift(current); current = current.parent; }
      if (current !== target) continue;
      let parent = host;
      for (const original of lineage) {
        let proxy = cloned.get(original);
        if (!proxy) {
          proxy = new THREE.Group(); proxy.name = 'Particle anchor ' + (original.name || id);
          proxy.position.copy(original.position); proxy.quaternion.copy(original.quaternion);
          proxy.scale.copy(original.scale); parent.add(proxy); cloned.set(original,proxy);
        }
        parent = proxy;
      }
      anchors.set(id,parent);
    }
    host.userData.meshById = anchors; // Uses AuthoredFurniture.createEmitterVisual's normal attachedPartId API.
    group.add(host);
    return host;
  }

  // Choose branch origins FROM the generated floor strands, not arbitrary tiles.
  // Each hidden node lies inside the existing dense root blanket.
  function floorNodes(THREE, floorGrowth, endpoints, recipe, random, actualFloor = false, vegetationSource = false, reference = null) {
    const candidates = [],meshes=vegetationSource?growthMeshes(floorGrowth):[findGrowthMesh(floorGrowth)].filter(Boolean); // Prepared vegetation may cover walls as well as the floor.
    floorGrowth.updateWorldMatrix?.(true,true);reference?.updateWorldMatrix?.(true,false);
    const budget=Math.max(1,Math.floor(4000/Math.max(1,meshes.length))); // Bound all-surface sampling across dense pre-grown layers.
    for(const mesh of meshes){
      const pos=mesh.geometry?.getAttribute('position');if(!pos)continue;
      const jump=Math.max(1,Math.ceil(pos.count/budget));
      for(let i=0;i<pos.count;i+=jump){
        const point=new THREE.Vector3().fromBufferAttribute(pos,i);
        if(vegetationSource){mesh.localToWorld(point);reference?.worldToLocal(point);}
        if(Number.isFinite(point.x+point.y+point.z)&&(vegetationSource||Math.abs(point.y-recipe.floorY)<=recipe.radius*5+.15))candidates.push(point);
      }
    }
    if(vegetationSource&&!candidates.length)throw new Error('The prepared ruin vegetation has no usable growth nodes.');
    const chosen = []; // Separated source nodes prevent a single conspicuous center tuft.
    for (let i = 0; i < recipe.branchCount; i++) {
      const end = endpoints[i % endpoints.length], goalX = actualFloor?end.x:clamp(end.x, -recipe.floorWidth * .45, recipe.floorWidth * .45);
      const goalZ = actualFloor?end.z:clamp(end.z, -recipe.floorDepth * .45, recipe.floorDepth * .45);
      let best = null, score = Infinity;
      for (let k = 0; k < Math.min(60, candidates.length); k++) {
        const point = candidates[Math.floor(random() * candidates.length)];
        const spread = chosen.reduce((penalty, node) => penalty + Math.max(0, .48 - node.distanceTo(point)) * 8, 0);
        const cost = (point.x - goalX) ** 2 + (point.z - goalZ) ** 2 + (vegetationSource?(point.y-end.y)**2:0) + spread + random() * 2.5;
        if (cost < score) { best = point; score = cost; }
      }
      // An empty wrap cannot yield genuine root nodes; keep the controller usable,
      // but expose this fallback explicitly in diagnostics instead of hiding it.
      chosen.push(best ? best.clone() : new THREE.Vector3(
        (random() - .5) * recipe.floorWidth * .85, recipe.floorY + recipe.radius, (random() - .5) * recipe.floorDepth * .85));
    }
    return { nodes: chosen, derivedFromWrap: !!candidates.length, candidateCount: candidates.length };
  }

  function sampledTargetPoints(THREE, target, growth, count, random, parent,
    interior = false, selectedGrowths = null, selectedSourceMeshes = null) {
    const endpoints = Array.isArray(growth.userData?.surfaceGrowthEndpoints) ? growth.userData.surfaceGrowthEndpoints : [];
    const points = []; // Inward-shrinkwrapped geometry replaces the old exterior boundary endpoints.
    target.updateWorldMatrix(true, true);
    parent.updateWorldMatrix(true, true);
    const toParent = world => parent.worldToLocal(world);
    const interiorMeshes=selectedGrowths ?
      selectedGrowths.flatMap((partGroup,i)=>growthMeshes(partGroup).map(mesh=>({
        mesh,source:selectedSourceMeshes?.[i]||null
      }))) : growthMeshes(growth).map(mesh=>({mesh,source:null}));
    if (interior) for (const {mesh,source} of interiorMeshes) {
      const bounds=source?new THREE.Box3().setFromObject(source):null;
      const entryCeiling=bounds && !source.userData?.liveRootFloor ? bounds.min.y+
        Math.max(.12,(bounds.max.y-bounds.min.y)*.25) : Infinity;
      const pos=mesh.geometry.getAttribute('position');
      const ringCount=Math.floor(pos.count/6);
      if(!ringCount) continue;
      const stride=Math.max(1,Math.ceil(ringCount/60)); // Bounded interior end-point choices even for six dense layers.
      for(let ring=0;ring<ringCount;ring+=stride){
        const center=new THREE.Vector3();
        for(let j=0;j<5;j++)center.add(new THREE.Vector3().fromBufferAttribute(pos,ring*6+j));
        center.multiplyScalar(.2); // Tube centerline, not an outermost skin vertex.
        const world=mesh.localToWorld(center);
        if(world.y>entryCeiling)continue; // Floor shoots attach near the FEET, not near the top of a leg.
        points.push(toParent(world));
      }
    }
    if (!points.length && !selectedGrowths) for (const entry of endpoints) for (const key of ['start', 'end']) {
      const coords = entry?.[key];
      if (!Array.isArray(coords) || coords.length < 3 || !coords.slice(0, 3).every(Number.isFinite)) continue;
      points.push(toParent(target.localToWorld(new THREE.Vector3(...coords))));
    }
    const candidates = []; // Fallback mesh vertices support imported GLBs without recognized perimeter loops.
    if (!points.length) {
      const appendCandidates=mesh=>{
        if (!mesh.isMesh || mesh.userData?.surfaceFoliage || mesh.userData?.surfaceFoliageGuide) return;
        const attr = mesh.geometry?.getAttribute?.('position');
        if (!attr) return;
        const stride = Math.max(1, Math.ceil(attr.count / 180));
        for (let i = 0; i < attr.count; i += stride) {
          const v = new THREE.Vector3().fromBufferAttribute(attr, i);
          if (Number.isFinite(v.x + v.y + v.z)) candidates.push(toParent(mesh.localToWorld(v)));
        }
      };
      if (selectedSourceMeshes) for(const mesh of selectedSourceMeshes){
        // Even if the Wrap generator made no near-floor strands, use the
        // ground source mesh's LOWEST vertices, never an upper leg tip.
        const bounds=new THREE.Box3().setFromObject(mesh);
        const ceiling=bounds.min.y+Math.max(.12,(bounds.max.y-bounds.min.y)*.25);
        const attr=mesh.geometry?.getAttribute?.('position');
        if(!attr)continue;
        for(let i=0;i<attr.count;i++){
          const world=mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(attr,i));
          if(world.y<=ceiling&&Number.isFinite(world.x+world.y+world.z))
            candidates.push(toParent(world));
        }
      }else target.traverse(appendCandidates);
    } // Never fall back to a floating tabletop just because grounded wraps produced no strands.
    const source = points.length ? points : candidates;
    if (!source.length) throw new Error('Imported furniture has no usable triangles or surface endpoints.');
    const chosen = []; // Round-robin with seeded jitter spreads branches across the hidden target.
    for (let i = 0; i < count; i++) chosen.push(source[Math.floor((i + random() * source.length) % source.length)].clone());
    return { points: chosen, wrapEndpointCount: endpoints.length, usedFallback: !points.length };
  }

  function makeBranch(THREE, a, b, index, recipe, random, material) {
    const dist = a.distanceTo(b); // Sets a bounded tube resolution without changing the growth timing.
    const side = new THREE.Vector3(random() - .5, 0, random() - .5).multiplyScalar(recipe.bend);
    const p1 = a.clone().lerp(b, .28).add(new THREE.Vector3(side.x, 0, side.z));
    const p2 = a.clone().lerp(b, .7).add(new THREE.Vector3(-side.z * .5, 0, side.x * .5));
    const rise = Math.max(0, b.y - a.y); // Only rising branches need upward concavity; flat/lower targets keep their direct path.
    const concavity = clamp(recipe.arcConcavity * (.85 + random() * .3), 0, 1); // Small seeded variation avoids mechanically identical arches.
    p1.y = Math.max(a.y, p1.y - rise * concavity * .38); // Stay rooted at floor height instead of arching upward immediately.
    p2.y = Math.max(p1.y, p2.y - rise * concavity * .60); // Accelerate upward near the object: concave, rather than convex, vertical profile.
    const curve = new THREE.CatmullRomCurve3([a, p1, p2, b], false, 'centripetal');
    const segments = Math.min(80, Math.max(16, Math.ceil(dist * 12))); // Static, bounded tube resolution; only draw ranges change per frame.
    const geometry = new THREE.TubeGeometry(curve, segments, recipe.branchRadius, 6, false);
    const position = geometry.getAttribute('position');
    for (let ring = 0; ring <= segments; ring++) {
      const center = curve.getPointAt(ring / segments), taper = 1 - .63 * smooth(ring / segments);
      for (let spoke = 0; spoke <= 6; spoke++) {
        const i = ring * 7 + spoke;
        const x = center.x + (position.getX(i) - center.x) * taper;
        const y = center.y + (position.getY(i) - center.y) * taper;
        const z = center.z + (position.getZ(i) - center.z) * taper;
        position.setXYZ(i, x, y, z);
      }
    }
    position.needsUpdate = true; geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Growth branch ' + (index + 1);
    mesh.userData.rootGrowthBranch = true;
    mesh.userData.noOutline = false; // Same outline eligibility as FoliageGenerator surface roots.
    mesh.layers?.enable?.(1); // Runtime shell pass already selects layer 1; editor preview uses the same layer.
    mesh.userData.fullDrawCount = geometry.index ? geometry.index.count : position.count;
    mesh.geometry.setDrawRange(0, 0);
    return mesh;
  }

  function* createSteps(options = {}) {
    const THREE = options.THREE || root.THREE; // Native Three instance, passed explicitly in previews if required.
    const foliage = options.foliage || root.FoliageGenerator?.forThree?.(THREE) || root.FoliageGenerator;
    if (!THREE || !foliage?.buildSurfaceGrowth || !foliage?.normalizeSurfaceGrowth) throw new Error('LiveRootGrowth requires THREE and FoliageGenerator.');
    if (!options.target?.isObject3D) throw new TypeError('Pass a Three.js furniture group as options.target.');
    if(options.growthSource!=null&&!options.growthSource.isObject3D)throw new TypeError('Pass prepared vegetation as options.growthSource.');
    if(options.substrate!=null&&!options.substrate.isObject3D)throw new TypeError('Pass a Three.js ruin group as options.substrate.');
    if(options.substrate){
      let hasFloor=false; // Reject invalid architecture before allocating generated roots.
      options.substrate.traverse(mesh=>{if(mesh.isMesh&&mesh.userData?.liveRootFloor)hasFloor=true;});
      if(!hasFloor)throw new Error('A ruin substrate must contain a mesh tagged liveRootFloor.');
    }
    const recipe = normalizeRecipe(options.recipe), random = randomFromSeed(recipe.seed);
    const proposedFinish = options.rootFinish || TEMPLE_ROOT_FINISH; // Editor may provide the current Temple configuration at build time.
    const rootFinish = {
      color: /^#[0-9a-f]{6}$/i.test(proposedFinish?.color || '') ? proposedFinish.color : TEMPLE_ROOT_FINISH.color,
      texture: typeof proposedFinish?.texture === 'string' &&
        /^(?:assets\/[^?#]*\.png(?:[?#].*)?|data:image\/png;base64,[a-z0-9+/=]+)$/i.test(proposedFinish.texture)
        ? proposedFinish.texture : TEMPLE_ROOT_FINISH.texture
    }; // Keep serialized material inputs safe for all callers.
    const group = new THREE.Group(); // Public scene-owned root, containing floor, hidden shape and generated foliage.
    group.name = 'Live root growth';
    const ownedGrowths=[];let ownedFloor=null,complete=false; // Only generated geometry is released when an asynchronous build is interrupted.
    try {
    const target = options.substrate?.isObject3D ? new THREE.Group() : options.target.clone(true); // A generated ruin and optional furniture share one staged growth graph.
    if(options.substrate?.isObject3D) target.add(options.substrate.clone(true),options.target.clone(true));
    target.name = 'Invisible growth shape';
    // Imported furniture GLBs use a tiny Mesh as an async driver. Replace the
    // loaded driver with a transform-identical Group so wrapping sees only the
    // real rendered geometry, not its 1-mm placeholder box.
    const glbDrivers = []; // Collected before editing the hierarchy to avoid traverse mutations.
    target.traverse(node => { if (node.isMesh && node.userData?.furnitureGlbPart) glbDrivers.push(node); });
    for (const driver of glbDrivers) {
      if (!driver.userData.glbReady) throw new Error('Furniture GLB has not finished loading: ' + driver.name);
      const holder = new THREE.Group(); // Preserves authored transforms and the real GLB child hierarchy.
      holder.name = driver.name;
      holder.userData = {...driver.userData}; // Preserve authoredPartId for emitter attachment after GLB driver replacement.
      delete holder.userData.furnitureGlbPart;
      holder.position.copy(driver.position);
      holder.quaternion.copy(driver.quaternion); holder.scale.copy(driver.scale);
      for (const child of [...driver.children]) holder.add(child);
      driver.parent.add(holder); driver.parent.remove(driver);
    }
    const floorHost = new THREE.Group(), floor = options.substrate || options.growthSource ? null : new THREE.Mesh(
      new THREE.PlaneGeometry(recipe.floorWidth, recipe.floorDepth),
      new THREE.MeshBasicMaterial({visible:false}));
    ownedFloor=floor;
    if(floor){
      floor.rotation.x = -Math.PI / 2; floor.position.y = recipe.floorY;
      floor.userData.surfaceFoliageRole = 'floors';
      floor.name = 'Invisible root-floor navigation surface';
      floorHost.add(floor);
    } // Room mode must never create, sample or display the synthetic rectangular substrate.
    group.add(floorHost, target);
    target.traverse(mesh => {
      if (!mesh.isMesh) return;
      const wasVisible = mesh.visible !== false; // Hidden GLB bones and existing guide meshes must remain excluded.
      let ancestor = mesh, isOriginalGrowth = false; // Existing authored foliage must never become a new target.
      while (ancestor && ancestor !== target) {
        if (ancestor.userData?.surfaceFoliage || ancestor.userData?.surfaceFoliageGuide) isOriginalGrowth = true;
        ancestor = ancestor.parent;
      }
      mesh.visible = wasVisible && recipe.showGuide && !isOriginalGrowth;
      mesh.layers?.disable?.(1); // A visible debug furniture guide is never part of the root-only shell outline pass.
      if (!wasVisible || isOriginalGrowth) mesh.userData.surfaceFoliageExclude = true;
    }); // The furniture is never rendered in normal mode, but its triangles remain eligible for sampling.
    const growthOptions = {kind:options.kind==='vines'?'vines':'roots', style:'wrap', count:recipe.strandLimit,
      strandLimit:recipe.strandLimit, radius:recipe.radius, curl:recipe.curl,
      offset:0.012, density:recipe.floorDensity, color:rootFinish.color, texture:rootFinish.texture};
    let floorGrowth = options.growthSource || (options.substrate ? null : yield* buildDenseWrap(THREE, foliage, floorHost, {
      ...growthOptions, seed:recipe.seed+':floor', target:'floors', length:recipe.floorLength
    }, recipe.floorDensity)); // Dense permanent cover uses precisely the temple Wrap solver.
    if(floorGrowth&&!options.growthSource){floorHost.add(floorGrowth);ownedGrowths.push(floorGrowth);}
    const partPlan=planFurnitureGrowth(THREE,target,recipe.floorY,recipe.radius);
    // One per-part generator per density pass would multiply an authored 30-part
    // festival arch's 80-strand budget by 30. Divide the shared pass budget
    // across pieces, with a small minimum for narrow posts and pennants.
    const partWrapLimit=Math.max(4,Math.ceil(recipe.strandLimit/partPlan.length));
    const targetGrowth=new THREE.Group();
    targetGrowth.name='Staged furniture interior roots';
    targetGrowth.userData.surfaceFoliage=true;
    targetGrowth.userData.generatedStrands=0;
    targetGrowth.userData.surfaceGrowthEndpoints=[];
    ownedGrowths.push(targetGrowth);
    // A per-mesh plan keeps elevated tabletop/overhang triangles out of the
    // initial roots. Each part retains the same six inward shrinkwrap passes.
    const partGrowths=[]; // Both synchronous gameplay callers and the cooperative author use this same per-piece construction.
    for(const part of partPlan){
      const extent=part.bounds.max.clone().sub(part.bounds.min);
      const minimumThickness=Math.max(.01,Math.min(...[extent.x,extent.y,extent.z].filter(size=>size>.001))); // Ruin walls are open planes: keep full root radius instead of treating their zero thickness as a tiny solid.
      const partRadius=Math.max(.005,Math.min(recipe.radius,minimumThickness*.42));
      const isFloor=part.mesh.userData?.liveRootFloor===true; // Structural floor roots use floor controls while retaining staged inward growth.
      const wrapped=yield* buildDenseWrap(THREE, foliage, target, {
        ...growthOptions, seed:recipe.seed+':part-'+part.index,
        growthLabel:part.label,
        radius:partRadius, strandLimit:partWrapLimit,count:partWrapLimit,
        target:isFloor?'floors':'all', targetMeshId:part.mesh.uuid, length:isFloor?recipe.floorLength:recipe.targetLength,
        shrinkwrapFinal:true, shrinkwrapHidden:true, shrinkwrapInside:true
      },isFloor?recipe.floorDensity:recipe.targetDensity,(pass,passes)=>({
        inset:Math.min(.5,recipe.shapeInset+
          recipe.volumeFillDepth*(passes<=1?0:pass/(passes-1)))
      }));
      wrapped.name='Roots of '+part.label;
      wrapped.userData.rootGrowthPartIndex=part.index;
      wrapped.userData.growthDepth=part.depth;
      targetGrowth.add(wrapped);
      targetGrowth.userData.generatedStrands+=wrapped.userData.generatedStrands||0;
      targetGrowth.userData.surfaceGrowthEndpoints.push(...(wrapped.userData.surfaceGrowthEndpoints||[]));
      partGrowths.push(wrapped);
    }
    targetGrowth.userData.densityPasses=partGrowths[0]?.userData?.densityPasses||1;
    target.add(targetGrowth);
    if(!floorGrowth){
      const floorPart=partPlan.find(part=>part.mesh.userData?.liveRootFloor); // Source nodes are sampled from generated room-floor roots, including irregular footprints.
      if(!floorPart)throw new Error('A ruin substrate must contain a mesh tagged liveRootFloor.');
      floorGrowth=partGrowths[floorPart.index];
    }
    const shapeMesh=findGrowthMesh(targetGrowth),floorMesh=findGrowthMesh(floorGrowth);
    const groundedPartPlan=partPlan.filter(part=>part.grounded);
    const groundGrowth=groundedPartPlan.map(part=>partGrowths[part.index]);
    const targets=sampledTargetPoints(THREE,target,targetGrowth,recipe.branchCount,random,group,
      true,groundGrowth,groundedPartPlan.map(part=>part.mesh));
    const source = floorNodes(THREE, floorGrowth, targets.points, recipe, random, !!(options.substrate||options.growthSource),!!options.growthSource,group);
    const branchSourceMaterial = shapeMesh?.material || floorMesh?.material; // Existing Temple-textured Wrap material is authoritative for branch finish.
    const branchMaterial = branchSourceMaterial?.clone?.() ||
      new THREE.MeshBasicMaterial({color:parseInt(rootFinish.color.slice(1),16)}); // No-shape fallback still uses Temple bark color.
    const branchGroup = new THREE.Group(); // Animation-only intermediate roots, independent of shape and collision.
    branchGroup.name = 'Extending branch roots';
    const branches = targets.points.map((point, i) => {
      const branch = makeBranch(THREE, source.nodes[i], point, i, recipe, random, branchMaterial);
      branchGroup.add(branch); return branch;
    });
    group.add(branchGroup);
    const maxDepth=Math.max(0,...partPlan.map(part=>part.depth));
    const stageStart=.28, stageLength=(1-stageStart)/(maxDepth+1);
    const partWindows=partPlan.map(part=>({
      start:stageStart+part.depth*stageLength,
      end:stageStart+(part.depth+1)*stageLength
    }));
    const shapeMeshes=growthMeshes(targetGrowth);
    for(const mesh of shapeMeshes){
      orderGrowthByHeight(mesh);
      mesh.userData.fullDrawCount=mesh.geometry.index?
        mesh.geometry.index.count:mesh.geometry.attributes.position.count;
    }
    group.updateWorldMatrix(true,true);
    const connectors=[]; // Only from an already rooted part; never directly to a tabletop or arch beam.
    for(const part of partPlan){
      if(part.parent===null)continue;
      const parentPart=partPlan[part.parent];
      const targetCenter=part.bounds.getCenter(new THREE.Vector3());
      const from=nearestStrandPoint(THREE,partGrowths[parentPart.index],targetCenter,group);
      const end=nearestStrandPoint(THREE,partGrowths[part.index],from,group);
      if(from.distanceTo(end)<.03)from.y-=Math.max(.04,recipe.branchRadius); // Avoid zero-length tubes at adjoining pieces.
      const connector=makeBranch(THREE,from,end,branches.length+connectors.length,
        recipe,random,branchMaterial);
      connector.name='Root transfer: '+parentPart.label+' → '+part.label;
      connector.userData.fromPart=parentPart.index;
      connector.userData.toPart=part.index;
      connectors.push(connector);branchGroup.add(connector);
    }
    const emitterRecords = Array.isArray(options.particleEmitters) ? options.particleEmitters :
      (Array.isArray(options.target.userData?.authoredParticleEmitters) ? options.target.userData.authoredParticleEmitters : []);
    const emitterRuntime = options.emitterRuntime || root.AuthoredFurniture;
    if (emitterRecords.length && typeof emitterRuntime?.createEmitterVisual !== 'function') {
      throw new Error('Furniture particle emitters require AuthoredFurniture.createEmitterVisual.');
    }
    const effectHost = emitterRecords.length ? buildParticleAnchors(THREE,group,target) : null;
    const emitterVisuals = emitterRecords.filter(record=>record && typeof record === 'object')
      .map(record=>emitterRuntime.createEmitterVisual(effectHost,record)); // Reuses the authored-furniture particle renderer.
    let progress = 0, direction = 0, disposed = false; // Per-instance animation state, independent of purpose/trigger.
    const apply = () => {
      const extent=smooth(progress / stageStart);
      for (let i = 0; i < branches.length; i++) {
        // Small per-branch offsets keep the growth organic without changing the authored final pose.
        const phase = clamp((extent - (i % 4) * .065) / (1 - (i % 4) * .065), 0, 1);
        const count = Math.floor(branches[i].userData.fullDrawCount * phase / 3) * 3;
        branches[i].geometry.setDrawRange(0, count);
        branches[i].visible = count > 0;
      }
      for(const part of partPlan){
        const window=partWindows[part.index],local=smooth((progress-window.start)/(window.end-window.start));
        for(const mesh of growthMeshes(partGrowths[part.index])){
          const count=Math.floor(mesh.userData.fullDrawCount*local/3)*3;
          mesh.geometry.setDrawRange(0,count);
        }
      }
      for(const connector of connectors){
        const childWindow=partWindows[connector.userData.toPart];
        const span=Math.min(.08,stageLength*.32);
        const start=childWindow.start-span,end=childWindow.start+span;
        const local=smooth((progress-start)/(end-start));
        connector.geometry.setDrawRange(0,Math.floor(connector.userData.fullDrawCount*local/3)*3);
        connector.visible=local>0;
      }
    };
    const api = {
      group, target, floorGrowth, targetGrowth, branches, connectors, partPlan, partGrowths,
      recipe, rootFinish, emitterVisuals,
      setProgress(value) { if (!disposed) { progress = number(value, progress, 0, 1); apply(); } return progress; },
      getProgress() { return progress; },
      extend() { if (!disposed) direction = 1; },
      retract() { if (!disposed) direction = -1; },
      pause() { direction = 0; },
      update(deltaSeconds) {
        if (disposed) return progress;
        const delta = number(deltaSeconds, 0, 0, .25); // Also ticks particles while growth is idle.
        if (direction !== 0) {
          progress = clamp(progress + direction * delta / recipe.duration, 0, 1);
          if ((progress === 1 && direction > 0) || (progress === 0 && direction < 0)) direction = 0;
          apply();
        }
        const complete = progress >= 1; // Emitters activate on completion, never during partial growth.
        for (const visual of emitterVisuals) visual.update(delta,complete,complete ? {enabled:true} : undefined); // Completion explicitly turns on even initially disabled authored emitters.
        return progress;
      },
      getDiagnostics() {
        return {progress, direction, branchCount:branches.length, rootFinish, outlinedBranches:branches.length,
          substrate:options.substrate||options.growthSource?'ruin':'flat',
          preparedVegetation:!!options.growthSource,vegetationKind:options.kind==='vines'?'vines':'roots',
          floorStrands:floorGrowth.userData?.generatedStrands || 0,
          shapeStrands:(targetGrowth.userData?.generatedStrands || 0)-(options.substrate?(floorGrowth.userData?.generatedStrands||0):0),
          groundedParts:partPlan.filter(part=>part.grounded).map(part=>part.label),
          partCount:partPlan.length, rootTransferCount:connectors.length,
          maxPartDepth:maxDepth, perPartStrandLimit:partWrapLimit,
          partGrowth:partPlan.map(part=>({label:part.label,grounded:part.grounded,
            parent:part.parent,depth:part.depth,progress:clamp((progress-
              partWindows[part.index].start)/stageLength,0,1),gap:part.linkGap})),
          floorDensityPasses:floorGrowth.userData?.densityPasses || 1,
          shapeDensityPasses:targetGrowth.userData?.densityPasses || 1,
          insideShrinkwrap:true, shapeInset:recipe.shapeInset, volumeFillDepth:recipe.volumeFillDepth,
          shrinkwrapRays:partGrowths.reduce((n,part)=>n+
            (part.userData?.surfaceGrowthStats?.shrinkwrapRays||0)+
            (part.children||[]).reduce((k,layer)=>k+(layer.userData?.surfaceGrowthStats?.shrinkwrapRays||0),0),0),
          shrinkwrapHits:partGrowths.reduce((n,part)=>n+
            (part.userData?.surfaceGrowthStats?.shrinkwrapHits||0)+
            (part.children||[]).reduce((k,layer)=>k+(layer.userData?.surfaceGrowthStats?.shrinkwrapHits||0),0),0),
          furnitureEmitterCount:emitterVisuals.length, furnitureEmittersActive:progress >= 1,
          floorNodesFromWrap:source.derivedFromWrap, sampledFloorNodes:source.candidateCount,
          shapeWrapEndpointPairs:targets.wrapEndpointCount, shapeEndpointFallback:targets.usedFallback,
          floor:floorGrowth.userData?.diagnostics, shape:targetGrowth.userData?.diagnostics};
      },
      dispose() {
        if (disposed) return; disposed = true; direction = 0;
        group.parent?.remove(group);
        // Only dispose generated assets; source clone materials/geometries can be shared with the importer.
        for (const visual of emitterVisuals) visual.dispose(); // Stops spawning and frees particles without touching the furniture.
        for (const mesh of [...branches,...connectors]) mesh.geometry.dispose();
        branchMaterial.dispose();
        for (const growth of options.substrate||options.growthSource?[targetGrowth]:[floorGrowth, targetGrowth]) growth.traverse(node => {
          node.geometry?.dispose?.(); if (Array.isArray(node.material)) node.material.forEach(mat => mat.dispose());
          else node.material?.dispose?.();
        });
        floor?.geometry.dispose(); floor?.material.dispose();
      }
    };
    api.setProgress(options.progress ?? 0);
    complete=true;return api;
    } finally {if(!complete){disposeGenerated(ownedGrowths);ownedFloor?.geometry.dispose();ownedFloor?.material.dispose();}}
  }

  function create(options = {}) {
    const steps=createSteps(options);let step; // Preserve the existing synchronous API and deterministic output.
    do{step=steps.next();}while(!step.done);
    return step.value;
  }
  async function createAsync(options = {}) {
    const steps=createSteps(options),schedule=options.schedule||(()=>new Promise(resolve=>root.setTimeout(resolve,0))); // Yield between Wrap passes so mobile input, progress and cancel can run.
    try {
      while(true){
        await schedule();
        if(options.signal?.aborted)throw Object.assign(new Error('Root preview build cancelled.'),{name:'AbortError'});
        const step=steps.next(); // A layer uses the original Wrap solver without changing its seed or density.
        if(step.done)return step.value;
        options.onProgress?.(step.value);
      }
    } finally {steps.return();}
  }

  async function createCoverAsync(options={}){
    const THREE=options.THREE||root.THREE,foliage=options.foliage||root.FoliageGenerator?.forThree?.(THREE)||root.FoliageGenerator; // Static cover uses the same recipe authority as authored building vegetation.
    if(!THREE||!foliage?.buildSurfaceGrowth||!foliage?.normalizeSurfaceGrowth)throw new Error('Static vegetation requires THREE and FoliageGenerator.');
    if(!options.target?.isObject3D)throw new TypeError('Pass a Three.js ruin group as options.target.');
    if(!Array.isArray(options.recipes)||!options.recipes.length)throw new Error('Static vegetation requires authored surface-growth recipes.');
    const recipes=options.recipes.map(recipe=>foliage.normalizeSurfaceGrowth({...recipe,seed:String(options.seed||'ruin-cover')+':'+recipe.seed,shrinkwrapHidden:true})); // Preserve each authored style, target, density, finish and signed inset.
    const group=new THREE.Group(),target=options.target.clone(true),targetGrowth=new THREE.Group(); // Source stone remains caller-owned; only generated vegetation is released by this instance.
    group.name='Prepared ruin with Life Temple vegetation';targetGrowth.userData.surfaceFoliage=true;targetGrowth.userData.generatedStrands=0;
    group.add(target);target.add(targetGrowth);
    const schedule=options.schedule||(()=>new Promise(resolve=>root.setTimeout(resolve,0))); // Yield between recipe layers for progress and cancellation.
    const checkCancelled=()=>{if(options.signal?.aborted)throw Object.assign(new Error('Ruin vegetation build cancelled.'),{name:'AbortError'});};
    let complete=false,disposed=false;
    try{
      for(let index=0;index<recipes.length;index++){
        await schedule();checkCancelled();
        const recipe=recipes[index],layer=foliage.buildSurfaceGrowth(target,recipe);
        targetGrowth.add(layer);targetGrowth.userData.generatedStrands+=layer.userData.generatedStrands||0;
        options.onProgress?.({part:recipe.kind+' / '+recipe.style,layer:index+1,layers:recipes.length});
      }
      checkCancelled();
      const partPlan=planFurnitureGrowth(THREE,target,Number(options.floorY)||0,.1); // Retain the existing guide/scenery mesh records without animation stages.
      const api={group,target,targetGrowth,partPlan,getProgress:()=>1,
        getDiagnostics:()=>({progress:1,vegetationKind:'temple-mixed',recipeCount:recipes.length,vegetationRecipes:recipes,
          shapeStrands:targetGrowth.userData.generatedStrands,shrinkwrapRays:targetGrowth.children.reduce((n,layer)=>n+(layer.userData.surfaceGrowthStats?.shrinkwrapRays||0),0),
          shrinkwrapHits:targetGrowth.children.reduce((n,layer)=>n+(layer.userData.surfaceGrowthStats?.shrinkwrapHits||0),0)}),
        dispose(){if(disposed)return;disposed=true;group.parent?.remove(group);disposeGenerated([targetGrowth]);}};
      complete=true;return api;
    }finally{if(!complete)disposeGenerated([targetGrowth]);}
  }

  root.LiveRootGrowth = {version:2, DEFAULTS, TEMPLE_ROOT_FINISH, normalizeRecipe, create, createAsync, createCoverAsync};
})(typeof window !== 'undefined' ? window : globalThis);
