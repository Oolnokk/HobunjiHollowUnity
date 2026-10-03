// Surface decorations use the same motif compositor as weaving and Color Pools.
// Records live on parts, so furniture imports, instance overrides and transforms keep them.
(() => {
  'use strict';
  const TILE_PX = 256; // Raster density for one pattern tile, independent of furniture dimensions.
  const textureCache = new WeakMap(); // Identical tiles share one GPU texture while any furniture material still uses it.
  const tileCache = new Map(); // Bounded composite promises shared by identical pattern/palette definitions.
  const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function normalize(record = {}) {
    return {
      ...record,
      slot: String(record.slot || 'surface'),
      mode: ['cloth', 'glass', 'engraving'].includes(record.mode) ? record.mode : 'cloth',
      selector: String(record.selector || 'all'),
      scale: Math.max(.05, Math.min(20, finite(record.scale, 1))),
      palette: [hex(record.palette?.[0], '#b7a185'), hex(record.palette?.[1], '#315b67')],
      opacity: Math.max(0, Math.min(1, finite(record.opacity, record.mode === 'glass' ? .8 : record.mode === 'engraving' ? .5 : 1))),
    };
  }

  function resolvePattern(record) {
    if (record.pattern?.motifDataUrl || record.pattern?.motifUrl || record.pattern?.customMotifId) return record.pattern;
    const id = record.patternId; // Supports owned character patterns and repo-authored decorative defaults.
    return window.PatternLibrary?.getById?.(id)
      || window.RepoPatternLibrary?.getCachedById?.(id)
      || window.PatternLibrary?.getCatalog?.().find(entry => entry.id === id)?.pattern
      || null;
  }

  async function editablePattern(record) {
    const pattern = resolvePattern(record); // Authoring requires ink bytes; runtime references may only carry a URL or MotifStore key.
    if (!pattern || pattern.motifDataUrl) return pattern;
    if (pattern.customMotifId) {
      const motifDataUrl = await window.MotifStore?.loadMotif?.(pattern.customMotifId); // Export a portable snapshot rather than a browser-specific database reference.
      return motifDataUrl ? {...pattern,motifDataUrl} : pattern;
    }
    const repo = record.patternId ? await window.RepoPatternLibrary?.getEditableById?.(record.patternId) : null; // Preloaded repo ink retains instance-authored placement settings.
    if (repo?.motifDataUrl) return {...repo,...pattern,motifDataUrl:repo.motifDataUrl};
    if (!pattern.motifUrl) return pattern;
    const image = await new Promise((resolve,reject)=>{ const source = new Image(); source.crossOrigin='anonymous'; source.onload=()=>resolve(source); source.onerror=()=>reject(new Error('Could not read the pattern image')); source.src=pattern.motifUrl; }); // CORS must precede src for exported/readable canvas pixels.
    const canvas = document.createElement('canvas'); // Read the actual motif into the existing sketch editor, instead of opening an empty drawing.
    canvas.width=image.naturalWidth || image.width; canvas.height=image.naturalHeight || image.height;
    canvas.getContext('2d').drawImage(image,0,0);
    return {...pattern,motifDataUrl:canvas.toDataURL('image/png')};
  }

  async function renderTile(raw, patternOverride, size = [TILE_PX, TILE_PX]) {
    const record = normalize(raw); // Validation is shared by the author preview and runtime.
    if (!patternOverride && !resolvePattern(record)) await window.RepoPatternLibrary?.load?.();
    const pattern = patternOverride || resolvePattern(record); // Never mutate a shared library definition.
    if (!pattern) throw new Error(`Pattern unavailable: ${record.patternId || 'custom'}`);
    const compositor = window.ClothingWeavingSystem?.applyPatternStackToTintedImage; // Canonical tiling, inversion, thickness and overpass implementation.
    if (!compositor) throw new Error('The weaving pattern renderer has not loaded');
    const key = JSON.stringify([record.mode, record.palette, pattern, size]); // Scale/opacity belong to placement rather than the reusable tile pixels.
    if (tileCache.has(key)) return tileCache.get(key);
    const pending = (async () => {
      const canvas = document.createElement('canvas'); // Solid dyed base provides the same opaque eligibility mask as cloth.
      canvas.width = size[0]; canvas.height = size[1];
      const ctx = canvas.getContext('2d'); // Neutral gray is eligible for shade-fill; authored white is intentionally protected by ColorFill.
      ctx.fillStyle = '#c0c0c0'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const shading = document.createElement('canvas'); // Separate pre-tint reference required by the canonical compositor.
      shading.width = canvas.width; shading.height = canvas.height;
      shading.getContext('2d').drawImage(canvas, 0, 0);
      ctx.fillStyle = record.palette[0]; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const result = await compositor(canvas, [{...pattern,renderRasterScale:size[2] || 1}], record.palette[1], `furniture:${key}`, shading, 'woven-motif', {inkOnly: record.mode === 'engraving', cache:false}); // Use authored settings without an extra purpose-specific magnification.
      if (record.mode !== 'engraving') return result;
      const engraving = document.createElement('canvas'); // Never mutate the compositor's cached mask.
      engraving.width = canvas.width; engraving.height = canvas.height;
      engraving.getContext('2d').drawImage(result, 0, 0);
      const core = await compositor(canvas, [{...pattern,motifThinPx:finite(pattern.motifThinPx,0)+2,renderRasterScale:size[2] || 1}], record.palette[1], `furniture-core:${key}`, shading, 'woven-motif', {inkOnly:true,cache:false}); // Exactly the authoring slider's two-source-pixel thinning, including inversion and frame/mesh transforms.
      return window.HobunjiSpritePngSurface.carveCanvas(engraving,core);
    })();
    tileCache.set(key, pending);
    if (tileCache.size > 24) tileCache.delete(tileCache.keys().next().value);
    try { return await pending; }
    catch (error) { tileCache.delete(key); throw error; }
  }

  function matches(record, nx, ny, nz) {
    if (Array.isArray(record.normal)) {
      const length = Math.hypot(...record.normal); // Recognized editor surfaces retain their own local direction.
      return length > 0 && (nx * record.normal[0] + ny * record.normal[1] + nz * record.normal[2]) / length > .97;
    }
    if (record.selector === 'top') return ny > .7;
    if (record.selector === 'bottom') return ny < -.7;
    if (record.selector === 'sides') return Math.abs(ny) < .7;
    if (record.selector === 'front') return nz > .7;
    if (record.selector === 'back') return nz < -.7;
    return true;
  }

  function surfaceGeometry(mesh, record, part = {}) {
    const THREE = window.THREE; // Uses the source's triangle topology so decorations match curved/tapered surfaces.
    const source = mesh.geometry; // Only this part's own faces are sampled; decals and VFX remain separate.
    const position = source?.getAttribute?.('position');
    if (!position) return null;
    const indices = source.index; // Both imported indexed geometry and editor triangle soup are supported.
    const count = indices ? indices.count : position.count;
    const vertices = [], uvs = [], axes = [], weights = [], baseUvs = [], materialIds = []; // Temporary arrays exist only during construction, never per frame.
    const bounds = {x:0,z:0}; // Dimensions of the actual source geometry anchor the continuous side unwrap.
    for (let i=0;i<position.count;i++) { bounds.x=Math.max(bounds.x,Math.abs(position.array[i*3])); bounds.z=Math.max(bounds.z,Math.abs(position.array[i*3+2])); }
    const curved = ['cylinder','disc','legRound','barrel','cup','sphere'].includes(part.kind); // Curved side groups use angular coordinates rather than switching box planes.
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); // Reused triangle scratch vectors.
    const edge = new THREE.Vector3(), normal = new THREE.Vector3(); // Reused normal computation for selection and offset.
    for (let first = 0; first + 2 < count; first += 3) {
      const materialIndex = source.groups?.find(group=>first>=group.start&&first<group.start+group.count)?.materialIndex || 0; // Each overlay triangle retains its underlying surface material.
      a.fromBufferAttribute(position, indices ? indices.getX(first) : first);
      b.fromBufferAttribute(position, indices ? indices.getX(first + 1) : first + 1);
      c.fromBufferAttribute(position, indices ? indices.getX(first + 2) : first + 2);
      edge.subVectors(b, a); normal.subVectors(c, a).cross(edge).negate().normalize();
      if (!matches(record, normal.x, normal.y, normal.z)) continue;
      if (record.localCentroid && record.dimensions) {
        const center = record.localCentroid.map((value, axis) => value * finite(part.transform?.[['sx','sy','sz'][axis]], record.dimensions[axis]) / Math.max(.001, record.dimensions[axis])); // Keep the authored face plane attached during piece resizing.
        if (Math.abs(normal.dot(a) - normal.x * center[0] - normal.y * center[1] - normal.z * center[2]) > .02) continue;
      }
      const direction = record.normal || [normal.x,normal.y,normal.z]; // Selected planar faces share one projection even when individual triangles are slightly tilted.
      const axis = record.selector === 'sides' ? 'z' : Math.abs(direction[1]) >= Math.max(Math.abs(direction[0]), Math.abs(direction[2])) ? 'y' : Math.abs(direction[0]) >= Math.abs(direction[2]) ? 'x' : 'z'; // Stable box projection uses actual local dimensions, not normalized bounds.
      const angles = [a,b,c].map(point => (Math.atan2(point.z / (bounds.z || 1), point.x / (bounds.x || 1)) + Math.PI*2) % (Math.PI*2)); // Shared edge vertices keep identical coordinates; only the back closing seam is unwrapped.
      if (Math.max(...angles)-Math.min(...angles)>Math.PI) for(let i=0;i<3;i++) if(angles[i]<Math.PI) angles[i]+=Math.PI*2;
      let vertex = 0; // Associates triangle vertices with their seam-corrected angle.
      for (const point of [a, b, c]) {
        const sourceIndex = indices ? indices.getX(first+vertex) : first+vertex, sourceUv = source.getAttribute('uv'); // Texture masking uses original PNG coordinates, independently of motif atlas coordinates.
        baseUvs.push(sourceUv?.array[sourceIndex*2] || 0,sourceUv?.array[sourceIndex*2+1] || 0); materialIds.push(materialIndex);
        vertices.push(point.x, point.y, point.z); // Polygon offset prevents z-fighting without opening cracks between neighboring triangle planes.
        let u = axis === 'x' ? point.z : point.x; // Default planar mapping is continuous across the selected face.
        let ux=axis === 'x' ? 0 : point.x, uz=axis === 'x' ? point.z : 0; // Linear coordinates let non-uniform resizing preserve the side perimeter.
        if (record.selector === 'sides' && curved) u = angles[vertex] * Math.sqrt((bounds.x*bounds.x+bounds.z*bounds.z)/2);
        else if (record.selector === 'sides') { ux=normal.z > .7 ? point.x : normal.x > .7 ? bounds.x : normal.z < -.7 ? 2*bounds.x-point.x : 3*bounds.x; uz=normal.z > .7 ? 0 : normal.x > .7 ? bounds.z-point.z : normal.z < -.7 ? 2*bounds.z : 3*bounds.z+point.z; u=ux+uz; } // One perimeter coordinate continues around rectangular pillars.
        uvs.push(u / record.scale, (axis === 'y' ? -point.z : point.y) / record.scale);
        vertex++;
        axes.push(record.selector === 'sides' && curved ? 3 : axis === 'x' ? 2 : 0, axis === 'y' ? 2 : 1);
        weights.push(ux/record.scale,uz/record.scale); // U axis may depend on both X and Z for a continuous box-side unwrap.
      }
    }
    if (!vertices.length) return null;
    const geometry = new THREE.BufferGeometry(); // Each instance owns its overlay geometry and material.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('patternBaseSurfaceUv',new THREE.Float32BufferAttribute(baseUvs,2));
    geometry.userData.patternMaterialIds=materialIds;
    geometry.computeVertexNormals();
    geometry.userData.patternBaseUvs = new Float32Array(uvs);
    geometry.userData.patternUvAxes = new Uint8Array(axes);
    geometry.userData.patternUvWeights = new Float32Array(weights);
    geometry.userData.patternSideRadii = [bounds.x,bounds.z];
    return geometry;
  }

  function splitSurfaceMaterials(geometry) {
    const ids = [...new Set(geometry.userData.patternMaterialIds)]; // Source material groups may use different PNGs within the same selected surface.
    if(ids.length===1)return [{geometry,index:ids[0]}];
    const atlas = geometry.userData; // All partitions share full-surface bounds, preserving pattern phase across material/plane joins.
    const result = ids.map(index=>{
      const positions=[],uvs=[],baseUvs=[],base=[],axes=[],weights=[]; // Construction-only arrays contain this source material's triangles.
      for(let vertex=0;vertex<atlas.patternMaterialIds.length;vertex++)if(atlas.patternMaterialIds[vertex]===index) {
        positions.push(...geometry.getAttribute('position').array.slice(vertex*3,vertex*3+3));
        uvs.push(...geometry.getAttribute('uv').array.slice(vertex*2,vertex*2+2));baseUvs.push(...geometry.getAttribute('patternBaseSurfaceUv').array.slice(vertex*2,vertex*2+2));
        base.push(...atlas.patternBaseUvs.slice(vertex*2,vertex*2+2));axes.push(...atlas.patternUvAxes.slice(vertex*2,vertex*2+2));weights.push(...atlas.patternUvWeights.slice(vertex*2,vertex*2+2));
      }
      const part = new window.THREE.BufferGeometry(); // Each overlay owns only its partition geometry.
      part.setAttribute('position',new window.THREE.Float32BufferAttribute(positions,3));part.setAttribute('uv',new window.THREE.Float32BufferAttribute(uvs,2));part.setAttribute('patternBaseSurfaceUv',new window.THREE.Float32BufferAttribute(baseUvs,2));part.computeVertexNormals();
      part.userData={patternBaseUvs:new Float32Array(base),patternUvAxes:new Uint8Array(axes),patternUvWeights:new Float32Array(weights),patternSideRadii:atlas.patternSideRadii,patternAtlas:atlas};
      return {geometry:part,index};
    });
    geometry.dispose();return result;
  }

  function installBlackTextureMask(overlay, source, materialIndex) {
    const THREE=window.THREE, uniforms={map:{value:null},enabled:{value:0},transform:{value:new THREE.Matrix3()},size:{value:new THREE.Vector2(1,1)}}; // Shared with this overlay's shader; original texture transforms stay authoritative.
    const compile=overlay.material.onBeforeCompile,key=overlay.material.customProgramCacheKey?.bind(overlay.material); // Preserve banner wind and the canonical PNG material pipeline.
    overlay.material.onBeforeCompile=shader=>{
      compile?.call(overlay.material,shader);
      shader.uniforms.patternBackingMap=uniforms.map;shader.uniforms.patternBackingEnabled=uniforms.enabled;shader.uniforms.patternBackingTransform=uniforms.transform;shader.uniforms.patternBackingSize=uniforms.size;
      shader.vertexShader='attribute vec2 patternBaseSurfaceUv; varying vec2 patternBackingUv;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npatternBackingUv = patternBaseSurfaceUv;');
      shader.fragmentShader='uniform sampler2D patternBackingMap; uniform float patternBackingEnabled; uniform mat3 patternBackingTransform; uniform vec2 patternBackingSize; varying vec2 patternBackingUv;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
        if(patternBackingEnabled > 0.5) {
          vec2 backingUv=(patternBackingTransform*vec3(patternBackingUv,1.0)).xy;
          backingUv=(floor(backingUv*patternBackingSize)+0.5)/patternBackingSize;
          vec4 backing=texture2D(patternBackingMap,backingUv,-100.0);
          if(backing.a > 0.0 && max(backing.r,max(backing.g,backing.b)) < 0.000001) discard;
        }`); // Nearest source texel at base mip: pure black fully masks every pattern mode; transparent black never masks.
    };
    overlay.material.customProgramCacheKey=()=>`${key?.() || ''}:black-backing-mask-v1`;
    const before=overlay.onBeforeRender; // Update late-loaded/replaced base maps without rebuilding geometry or sampling CPU pixels per frame.
    overlay.onBeforeRender=function(renderer,scene,camera,geometry,overlayMaterial,group){
      before?.call(this,renderer,scene,camera,geometry,overlayMaterial,group);
      const material=Array.isArray(source.material)?source.material[materialIndex]:source.material,map=material?.map; // Resolve the actual material currently used by this furniture face.
      const image=map?.image,width=image?.naturalWidth || image?.width,height=image?.naturalHeight || image?.height; // Loader completion activates masking automatically.
      uniforms.enabled.value=map&&width&&height?1:0;uniforms.map.value=map || null;
      if(uniforms.enabled.value){if(map.matrixAutoUpdate)map.updateMatrix();uniforms.transform.value.copy(map.matrix);uniforms.size.value.set(width,height);}
      overlay.userData.furniturePattern.blackTextureMask=!!uniforms.enabled.value;
    };
  }

  function retainTexture(canvas) {
    let entry = textureCache.get(canvas); // UV density lives in geometry, so shared textures never need per-instance rotation/repeat changes.
    if (!entry) {
      const THREE = window.THREE, png = window.HobunjiSpritePngSurface; // Canonical PNG texture creation remains authoritative.
      const texture = png?.makeCanvasTexture?.(THREE, canvas, 'furniture-pattern') || new THREE.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; // Full surface atlas must never repeat an arbitrary crop of a rotated lattice.
      entry = {canvas,texture,refs:0};
      const dispose = texture.dispose.bind(texture); // External generic mesh cleanup cannot destroy a tile still used by other furniture.
      texture.dispose = () => { if (!entry.refs) dispose(); };
      textureCache.set(canvas,entry);
    }
    entry.refs++;
    return entry;
  }

  function releaseTexture(entry) {
    if (!entry || --entry.refs > 0) return;
    textureCache.delete(entry.canvas);
    entry.texture.dispose();
  }

  function applyPart(mesh, part) {
    const records = Array.isArray(part?.patternSurfaces) ? part.patternSurfaces : []; // Unknown metadata survives the base editor's part normalization.
    if (!records.length || !mesh) return mesh;
    const THREE = window.THREE, png = window.HobunjiSpritePngSurface; // Reuses the canonical canvas texture and unlit surface factories.
    for (const raw of records) {
      const record = normalize(raw); // Copy per-instance settings; authored recipes remain immutable.
      const complete = surfaceGeometry(mesh, record, part);
      if (!complete) continue;
      for(const {geometry,index:materialIndex} of splitSurfaceMaterials(complete)) {
      const material = png?.makeMaterial?.(THREE, null, 'furniture-pattern', { side: THREE.DoubleSide, transparent: record.mode === 'engraving' || record.opacity < 1, depthWrite: record.mode !== 'engraving' && record.opacity >= 1, opacity: record.mode === 'engraving' ? Math.min(.5,record.opacity) : record.opacity, alphaTest: record.mode === 'engraving' ? .001 : png?.alphaTest?.() })
        || new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: record.mode === 'engraving' || record.opacity < 1, depthWrite: record.mode !== 'engraving' && record.opacity >= 1, opacity: record.mode === 'engraving' ? Math.min(.5,record.opacity) : record.opacity, alphaTest: record.mode === 'engraving' ? .001 : png?.alphaTest?.() });
      const overlay = new THREE.Mesh(geometry, material); // Surface child inherits furniture transforms and existing disposal lifecycle.
      overlay.name = `pattern:${record.slot}`;
      overlay.visible = false; // Keep the furniture's authored base visible until its composed tile is ready.
      overlay.userData.furniturePattern = { slot: record.slot, mode: record.mode, patternId: record.patternId || 'custom', palette: record.palette, scale: record.scale, status: 'loading' };
      overlay.userData.devRuinFootprintIgnore = true;
      overlay.raycast = () => {}; // Visual decoration does not claim interactions, collision or Pixel Probe hits.
      material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
      if (part.kind === 'banner') installBannerWind(overlay, part);
      retainPatternScale(overlay);
      installBlackTextureMask(overlay,mesh,materialIndex);
      mesh.add(overlay);
      let ownedTexture = null; // Material disposal releases exactly one reference to a shared GPU tile.
      let disposed = false; // Prevents asynchronous tile completion from reviving disposed preview/world objects.
      material.addEventListener?.('dispose', () => { if (disposed) return; disposed = true; releaseTexture(ownedTexture); });
      let generation = 0; // Discard stale atlas loads if an instance is resized again before composition finishes.
      overlay.userData.refreshPatternAtlas = size => {
        const request = ++generation; // Each rescale owns one asynchronous atlas generation.
        overlay.userData.patternReady = renderTile(record, null, size).then(canvas => { // Preview callers can await the exact atlas uploaded by this surface.
          if (disposed || request !== generation) return;
          releaseTexture(ownedTexture); ownedTexture = retainTexture(canvas);
          material.map = ownedTexture.texture; material.needsUpdate = true;
          overlay.visible = true; overlay.userData.furniturePattern.status = 'ready';
          if (record.mode === 'glass') syncGlass(mesh);
        }).catch(error => { if (!disposed && request === generation) { overlay.visible = false; overlay.userData.furniturePattern.status = error.message; } });
      };
      overlay.onBeforeRender(); // Build the first atlas while invisible; later render hooks react only to resizing.
      }
    }
    return mesh;
  }

  function syncGlass(mesh) {
    const patterns = mesh.children.filter(child => child.userData?.furniturePattern?.mode === 'glass' && child.userData.furniturePattern.status === 'ready'); // Rebuilt only when decoration changes, never each frame.
    for (const pane of mesh.children) {
      const source = pane.userData?.daylightWindowSource; // Keep the daylight descriptor active while replacing its plain visual.
      if (!source) continue;
      source.patternMeshes = patterns.filter(child => child.userData.furniturePattern.slot === source.surfaceId || !child.userData.furniturePattern.slot.includes(':surface:'));
      pane.material.visible = !source.patternMeshes.length;
    }
  }

  function retainPatternScale(mesh) {
    const base = mesh.geometry.userData.patternBaseUvs, axes = mesh.geometry.userData.patternUvAxes; // Rest UVs retain authored coordinates without cumulative drift.
    const previous = [-1, -1, -1], lengths = [1, 1, 1]; // Reused scale scratch; no per-frame vector allocations.
    const beforeRender = mesh.onBeforeRender; // Preserve the banner's existing time update.
    mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      beforeRender?.call(this, renderer, scene, camera, geometry, material, group);
      const matrix = mesh.matrixWorld.elements; // Column lengths remove translation/rotation while preserving non-uniform world scale.
      for (let axis = 0; axis < 3; axis++) lengths[axis] = Math.hypot(matrix[axis * 4], matrix[axis * 4 + 1], matrix[axis * 4 + 2]);
      if (Math.abs(lengths[0]-previous[0]) < 1e-6 && Math.abs(lengths[1]-previous[1]) < 1e-6 && Math.abs(lengths[2]-previous[2]) < 1e-6) return;
      const uv = mesh.geometry.getAttribute('uv'); // Resample only when the furniture was resized; ordinary frames do no buffer writes.
      const weights=mesh.geometry.userData.patternUvWeights,radii=mesh.geometry.userData.patternSideRadii; // Source unwrap metadata is immutable across resizes.
      lengths[3]=Math.hypot(radii[0]*lengths[0],radii[1]*lengths[2])/Math.max(.001,Math.hypot(...radii)); // Elliptical side mapping retains one consistent circumference scale.
      const atlas=mesh.geometry.userData.patternAtlas || mesh.geometry.userData; // Partitions share the original full selected-surface extent.
      let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
      for(let i=0;i<atlas.patternBaseUvs.length;i++) {
        const value=i%2 || atlas.patternUvAxes[i]===3 ? atlas.patternBaseUvs[i]*lengths[atlas.patternUvAxes[i]] : atlas.patternUvWeights[i]*lengths[0]+atlas.patternUvWeights[i+1]*lengths[2]; // Non-uniform scale retains continuous coordinates across all source materials.
        if(i%2){minV=Math.min(minV,value);maxV=Math.max(maxV,value);}else{minU=Math.min(minU,value);maxU=Math.max(maxU,value);}
      }
      for(let i=0;i<base.length;i++)uv.array[i]=i%2 || axes[i]===3 ? base[i]*lengths[axes[i]] : weights[i]*lengths[0]+weights[i+1]*lengths[2];
      const width=Math.max(.001,maxU-minU),height=Math.max(.001,maxV-minV); // World dimensions determine pixel extent while authored meshScale determines motif density.
      const density=Math.min(TILE_PX,1024/Math.max(width,height)); // Bound mobile GPU allocation while preserving aspect and pattern size.
      const size=[Math.max(1,Math.ceil(width*density)),Math.max(1,Math.ceil(height*density)),density/TILE_PX]; // One atlas per actual surface extent.
      for(let i=0;i<base.length;i+=2) {uv.array[i]=(uv.array[i]-minU)/width;uv.array[i+1]=(uv.array[i+1]-minV)/height;}
      mesh.userData.refreshPatternAtlas?.(size);
      uv.needsUpdate = true;
      for (let axis = 0; axis < 3; axis++) previous[axis] = lengths[axis];
    };
  }

  function installBannerWind(mesh, part) {
    const uniforms = { time: { value: 0 }, strength: { value: Math.max(0, Math.min(.5, finite(part.bannerWindStrength, .1))) } }; // Shared by this banner's shader and render hook.
    const height = Math.max(.01, finite(part.transform?.sy, 1)); // Top edge remains pinned; movement grows toward the bottom.
    mesh.material.onBeforeCompile = shader => {
      shader.uniforms.bannerTime = uniforms.time; shader.uniforms.bannerStrength = uniforms.strength;
      shader.vertexShader = `uniform float bannerTime; uniform float bannerStrength;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>\nfloat hanging = clamp(0.5 - position.y / ${height.toFixed(6)}, 0.0, 1.0);\ntransformed.z += sin(bannerTime * 2.0 + position.x * 4.0 + hanging * 3.0) * bannerStrength * hanging;`);
    };
    mesh.material.customProgramCacheKey = () => `furniture-banner:${height}`;
    mesh.onBeforeRender = () => { uniforms.time.value = performance.now() / 1000; }; // Render-order owner: no extra RAF or scene traversal.
    mesh.frustumCulled = false; // Shader displacement can extend beyond the undeformed plane's bounds.
  }

  function hash(value) {
    let result = 2166136261; // Stable FNV hash seeds independent surface choices across visits/save loads.
    for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
    return result >>> 0;
  }

  function decorateRuin(root, seed) {
    if (!root) return [];
    const catalog = [...(window.PatternLibrary?.getCatalog?.() || []), ...(window.RepoPatternLibrary?.listCached?.() || []).filter(entry=>entry.collectible)]; // Engravings grant exactly the reusable catalog motif rendered on the ruin.
    const ids = new Set(), meshes = []; // Collect first so adding overlay children cannot extend traversal.
    root.traverse(node => { if (node.isMesh && !node.userData?.furniturePattern) meshes.push(node); });
    for (let index = 0; index < meshes.length; index++) {
      const mesh = meshes[index];
      let node = mesh, role = ''; // Walk ancestors only once at generation to find renderer-owned structural semantics.
      while (node && node !== root) { role += ` ${node.name || ''} ${node.userData?.interiorRuinRole || ''} ${node.userData?.ruinFurnitureKey || ''}`; if (node.userData?.ruinInteriorWall) role += ' wall'; node = node.parent; }
      if (!/wall|pillar|pedestal|platform/i.test(role) || /seal|glyph|decal|fire|ceiling/i.test(mesh.name || '') || !catalog.length) continue;
      const authoredSlots = mesh.userData?.authoredPart?.patternSurfaces?.filter(record => record.mode === 'engraving'); // Explicit author slots replace the generic structural defaults.
      const slots = /pedestal|platform/i.test(role) ? ['sides', 'top'] : ['sides']; // Bases and tops roll separately, alongside walls and pillars.
      const templates = authoredSlots?.length ? authoredSlots : slots.map(slot => ({slot,selector:slot,mode:'engraving',random:true})); // No mutation of shared part recipes.
      const records = templates.map(template => {
        const slot = template.slot; // Independent deterministic choice for each authored surface slot.
        const entry = catalog[hash(`${seed}|${index}|${slot}`) % catalog.length]; // Stable per-element/per-slot selection.
        const patternId = template.random === false && template.patternId ? template.patternId : entry.id; // Completion grants the actual displayed motif.
        ids.add(patternId);
        return { ...template, pattern: template.random === false ? template.pattern : null, patternId, palette: template.palette || ['#b7a185', '#625447'], scale: template.scale || 1.5 };
      });
      for (const child of [...mesh.children]) if (child.userData?.furniturePattern?.mode === 'engraving') { mesh.remove(child); child.geometry?.dispose(); child.material?.map?.dispose(); child.material?.dispose(); }
      applyPart(mesh, { ...mesh.userData?.authoredPart, patternSurfaces: records });
    }
    root.userData.ruinPatternIds = [...ids];
    return [...ids];
  }

  function unlockRuin(root) {
    const granted = []; // Only completion paths call this; entering/leaving normally cannot grant patterns.
    for (const id of root?.userData?.ruinPatternIds || []) if (window.PatternLibrary?.unlock?.(id)) granted.push(id);
    return granted;
  }

  function applyOverrides(root, overrides) {
    if (!root || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return;
    root.userData.patternOverrides = overrides; // Cold-load authored visual adoption reapplies this same instance snapshot.
    const parts = []; // Snapshot avoids walking new overlays during the same pass.
    root.traverse(node => { if (node.userData?.authoredPart && overrides[node.userData.authoredPart.id]) parts.push(node); });
    for (const mesh of parts) {
      for (const child of [...mesh.children]) if (child.userData?.furniturePattern) {
        mesh.remove(child); child.geometry?.dispose(); child.material?.map?.dispose(); child.material?.dispose();
      }
      syncGlass(mesh);
      applyPart(mesh, { ...mesh.userData.authoredPart, patternSurfaces: overrides[mesh.userData.authoredPart.id] });
    }
  }

  async function editInstance(object, persist) {
    await window.AuthoredFurniture?.load?.(object.key); // Wait for the existing live visual upgrade before opening a cold-loaded rug/window.
    const candidates = []; // Authored patterned slots and existing daylight panes are eligible.
    object.mesh?.traverse(node => {
      const part = node.userData?.authoredPart;
      if (part && (part.patternSurfaces?.length || /pane/i.test(part.name || ''))) candidates.push({ mesh: node, part });
    });
    if (!candidates.length) return false;
    const panel = document.createElement('div'); // Touch-sized controls share the player's unlocked/saved pattern library.
    panel.style.cssText = 'position:fixed;inset:10% 5%;z-index:9400;background:#172126;color:white;padding:18px;overflow:auto;border:2px solid #b7a185;border-radius:12px';
    panel.innerHTML = '<h3>Furniture pattern</h3><label>Surface <select data-part></select></label><br><label>Pattern tile size <input data-scale type="number" min="0.05" max="20" step="0.05"></label><br><label>Base dye <input data-base type="color"></label><br><label>Pattern dye <input data-dye type="color"></label><br><button data-edit>Choose / draw pattern</button> <button data-apply>Apply settings</button> <button data-close>Close</button><pre data-debug style="white-space:pre-wrap"></pre>';
    const find = name => panel.querySelector(`[data-${name}]`); // Dialog-scoped lookup avoids collisions with the furniture editor.
    candidates.forEach(({part}, index) => { const option = document.createElement('option'); option.value = index; option.textContent = part.name || part.id; find('part').appendChild(option); });
    const selected = () => candidates[Number(find('part').value) || 0]; // Selection is read at each action, never inferred from a global mesh name.
    const current = () => {
      const part = selected().part;
      return normalize(object.patternOverrides?.[part.id]?.[0] || part.patternSurfaces?.[0] || {slot:'stained-glass',mode:'glass',selector:'all',patternId:'diamond-ring'});
    };
    const refresh = () => { const record = current(); find('scale').value = record.scale; find('base').value = record.palette[0]; find('dye').value = record.palette[1]; find('debug').textContent = JSON.stringify(debug(object.mesh), null, 2); };
    const settings = () => normalize({...current(),scale:find('scale').value,palette:[find('base').value,find('dye').value]});
    const save = record => {
      const overrides = {...object.patternOverrides, [selected().part.id]: [record]}; // Per-instance only; does not edit shared furniture definitions.
      object.patternOverrides = overrides;
      applyOverrides(object.mesh, overrides); persist?.(overrides); refresh();
    };
    find('part').onchange = refresh; find('close').onclick = () => panel.remove();
    find('apply').onclick = () => save(settings());
    find('edit').onclick = async () => {
      const record = settings(); // Preview and save use the same record and shared compositor.
      const initialPattern = await editablePattern(record); // Existing repo/custom ink appears when reopening a placed pattern.
      window.PatternAuthoring?.openEditor?.({ title:'Furniture pattern',initialPattern,
        library:{list:()=>window.PatternLibrary?.listAvailable?.() || [],get:id=>window.PatternLibrary?.getById?.(id),save:(label,data)=>window.PatternLibrary?.saveToLibrary?.(label,data),remove:id=>window.PatternLibrary?.removeSaved?.(id)},
        renderPreview:pattern=>renderTile(record,pattern),onSave:async (pattern,id)=>save({...record,patternId:id || null,pattern:await editablePattern({pattern})}) });
    };
    document.body.appendChild(panel); refresh();
    return true;
  }

  function debug(root) {
    const records = []; // On-demand only; Pixel Probe and editor readout share this exact snapshot.
    root?.traverse?.(node => { if (node.userData?.furniturePattern) records.push({ ...node.userData.furniturePattern, mesh: node.name }); });
    return records;
  }

  window.FurniturePatternSurfaces = { normalize, resolvePattern, editablePattern, renderTile, surfaceGeometry, applyPart, decorateRuin, unlockRuin, applyOverrides, editInstance, debug, hash };
})();
