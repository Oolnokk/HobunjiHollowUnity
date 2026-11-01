// Surface decorations use the same motif compositor as weaving and Color Pools.
// Records live on parts, so furniture imports, instance overrides and transforms keep them.
(() => {
  'use strict';
  const TILE_PX = 256; // Raster density for one pattern tile, independent of furniture dimensions.
  const MAX_ATLAS_PX = 1024; // Default longest atlas edge; ruin decorations may lower it through RuinPatternSurfaceRules.
  const ATLAS_QUANTUM_PX = 64; // Atlas edges round up to this step so similarly sized surfaces share one composited GPU tile.
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
      palette: [hex(record.palette?.[0], '#b7a185'), hex(record.palette?.[1], '#315b67'),
        ...(record.palette?.[2] ? [hex(record.palette[2], hex(record.palette?.[1], '#315b67'))] : [])], // Optional third palette channel exclusively colors the overpass.
      engravingCoreOpacity: Number(record.opacity) === 0 ? 0 : Math.max(0,Math.min(1,finite(record.engravingCoreOpacity,.85))), // Core opacity is independent of the softer restored stroke.
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

  function placedPatterns(record, patternOverride, size) {
    const patterns = [...(record.patterns?.length ? record.patterns : [resolvePattern(record)])].slice(0, 2); // Copy the stack so editing one instance cannot change another or the library.
    if (patternOverride) patterns[0] = patternOverride;
    return patterns.filter(Boolean).map((pattern, index) => {
      const placement = record.layerTransforms?.[index]; // Optional instance settings preserve older authored transforms unchanged.
      const raster = size[2] || 1;
      if (!placement) return {...pattern, renderRasterScale:raster};
      return {...pattern, renderRasterScale:raster,
        tiling:placement.tiling !== false,
        usageScaleMultiplier:finite(pattern.usageScaleMultiplier,1) * Math.max(.1, Math.min(20,finite(placement.scale,1))),
        usageRotationDeg:finite(pattern.usageRotationDeg,0) + finite(placement.rotationDeg,0),
        usageOffsetX:finite(pattern.usageOffsetX,0) * raster + finite(placement.offsetX,0) * TILE_PX / record.scale * raster,
        usageOffsetY:finite(pattern.usageOffsetY,0) * raster + finite(placement.offsetY,0) * TILE_PX / record.scale * raster}; // Offsets are surface tile units, independent of atlas resolution.
    });
  }

  function patternCatalog() {
    return [...(window.PatternLibrary?.getCatalog?.() || []), ...(window.PatternLibrary?.listAvailable?.() || []), ...(window.RepoPatternLibrary?.listCached?.() || [])];
  }

  function placementControls(host, baseInput, dyeInput, overpassInput = null) {
    const controls = document.createElement('div'); // The same controls author defaults and per-instance furniture/window overrides.
    controls.innerHTML = '<label>Game base dye <select data-dye-base></select></label><label>Game pattern dye <select data-dye-ink></select></label><label>Game overpass dye <select data-dye-overpass></select></label>' +
      '<p>Offsets use surface tile units: X right, Y down. A non-tiling layer stamps its motif once.</p>' +
      [0,1].map(index => `<fieldset><legend>${index ? 'Overpass' : 'Primary pattern'}</legend>${index ? '<label>Overpass pattern <select data-overpass></select></label>' : ''}
        <label><input data-repeat-${index} type="checkbox" checked>Repeat / tile</label>
        <label>Scale multiplier <input data-zoom-${index} type="range" min="0.1" max="20" step="0.1" value="1" aria-label="${index ? "Overpass" : "Primary"} pattern scale"></label><output data-zoom-value-${index}>1.0×</output>
        <label>Rotation (degrees) <input data-rotation-${index} type="range" min="-180" max="180" step="1" value="0" aria-label="${index ? "Overpass" : "Primary"} pattern rotation"></label><output data-rotation-value-${index}>0°</output>
        <label>X offset <input data-x-${index} type="range" min="-10" max="10" step="0.05" value="0" aria-label="${index ? "Overpass" : "Primary"} pattern X offset"></label><output data-x-value-${index}>0.00</output>
        <label>Y offset <input data-y-${index} type="range" min="-10" max="10" step="0.05" value="0" aria-label="${index ? "Overpass" : "Primary"} pattern Y offset"></label><output data-y-value-${index}>0.00</output></fieldset>`).join('');
    host.appendChild(controls);
    const field = name => controls.querySelector(`[data-${name}]`); // Scoped fields allow multiple authoring panels without ID collisions.
    for(let index=0;index<2;index++) for(const name of ['zoom','rotation','x','y']) field(`${name}-${index}`)?.addEventListener?.('input',()=>{const output=field(`${name}-value-${index}`),value=Number(field(`${name}-${index}`).value);if(output)output.textContent=name==='zoom'?`${value.toFixed(1)}×`:name==='rotation'?`${value}°`:value.toFixed(2);});
    const dyes = () => window.DyeSystem?.getCatalog?.() || window.ScratchbonesAccount?.getDyeCatalog?.() || window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || [];
    const populate = (select, entries, first, selected) => {
      select.replaceChildren(); select.add(new Option(first,''));
      const seen = new Set();
      for (const entry of entries) if(entry.id && !seen.has(entry.id)) {seen.add(entry.id);select.add(new Option(entry.label || entry.name || entry.id,entry.id));}
      select.value = selected || '';
    };
    for (const [name,input] of [['base',baseInput],['ink',dyeInput], ...(overpassInput ? [['overpass',overpassInput]] : [])]) {
      field(`dye-${name}`).onchange = () => { const dye=dyes().find(entry=>entry.id===field(`dye-${name}`).value); if(dye?.hex)input.value=dye.hex; };
      input.addEventListener?.('input', () => { field(`dye-${name}`).value=dyes().find(entry=>entry.hex?.toLowerCase()===input.value.toLowerCase())?.id || ''; });
    }
    return {
      refresh(record = {}) {
        for (const [name,input] of [['base',baseInput],['ink',dyeInput], ...(overpassInput ? [['overpass',overpassInput]] : [])]) populate(field(`dye-${name}`),dyes(),'Custom color',dyes().find(entry=>entry.hex?.toLowerCase()===input.value.toLowerCase())?.id);
        if (!overpassInput) field('dye-overpass').disabled = true;
        const entries=patternCatalog();
        if(record.patterns?.[1] && !entries.some(entry=>entry.id===record.overpassPatternId))entries.unshift({id:record.overpassPatternId || '__custom',label:'Current overpass'});
        populate(field('overpass'),entries,'None',record.patterns?.[1] ? record.overpassPatternId || '__custom' : '');
        for(let index=0;index<2;index++) {
          const transform=record.layerTransforms?.[index] || {}, pattern=record.patterns?.[index] || (index===0 ? resolvePattern(record) : null);
          field(`repeat-${index}`).checked=transform.tiling ?? pattern?.tiling !== false;
          for(const [name,key,fallback] of [['zoom','scale',1],['rotation','rotationDeg',0],['x','offsetX',0],['y','offsetY',0]]) { const value=finite(transform[key],fallback),input=field(`${name}-${index}`); if(name==='rotation'){input.min=Math.min(-180,value);input.max=Math.max(180,value);} else if(name==='x'||name==='y'){input.min=Math.min(-10,value);input.max=Math.max(10,value);} input.value=value; const output=field(`${name}-value-${index}`); if(output)output.textContent=name==='zoom'?`${value.toFixed(1)}×`:name==='rotation'?`${value}°`:value.toFixed(2); }
        }
      },
      read(record) {
        const patterns=[...(record.patterns?.length ? record.patterns : [resolvePattern(record)])].slice(0,2), id=field('overpass').value;
        if(!id)patterns.length=1;
        else if(id!==(record.overpassPatternId || '__custom') || !patterns[1])patterns[1]=resolvePattern({patternId:id});
        const layerTransforms=[0,1].map(index=>({tiling:field(`repeat-${index}`).checked,
          scale:Math.max(.1,Math.min(20,finite(field(`zoom-${index}`).value,1))),rotationDeg:finite(field(`rotation-${index}`).value,0),
          offsetX:finite(field(`x-${index}`).value,0),offsetY:finite(field(`y-${index}`).value,0)}));
        return {...record,patterns,overpassPatternId:id || null,layerTransforms}; // Snapshot + transforms serialize with the existing part/instance record.
      }
    };
  }

  async function renderTile(raw, patternOverride, size = [TILE_PX, TILE_PX]) {
    const record = normalize(raw); // Validation is shared by the author preview and runtime.
    if(record.solid){const canvas=document.createElement('canvas');canvas.width=size[0];canvas.height=size[1];const ctx=canvas.getContext('2d');ctx.fillStyle=record.palette[0];ctx.fillRect(0,0,canvas.width,canvas.height);return canvas;} // Solid glass shares the same pane and projected-light path without inventing a motif.
    if (!patternOverride && !resolvePattern(record)) await window.RepoPatternLibrary?.load?.();
    const pattern = patternOverride || record.patterns?.[0] || resolvePattern(record); // Never mutate a shared library definition.
    if (!pattern) throw new Error(`Pattern unavailable: ${record.patternId || 'custom'}`);
    const compositor = window.ClothingWeavingSystem?.applyPatternStackToTintedImage; // Canonical tiling, inversion, thickness and overpass implementation.
    if (!compositor) throw new Error('The weaving pattern renderer has not loaded');
    const patterns = placedPatterns(record, patternOverride, size); // Furniture previews share the canonical primary/overpass stack.
    if (patterns[1] && record.palette[2]) patterns[1] = { ...patterns[1], inkColorHex: record.palette[2] }; // The third dye is an instance placement color, not a mutation of a saved motif.
    const key = JSON.stringify([record.mode, record.palette, patterns, size, record.mode === 'engraving' ? [record.opacity,record.engravingCoreOpacity] : null]); // Scale/opacity belong to placement rather than the reusable tile pixels.
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
      const result = await compositor(canvas, patterns, record.palette[1], `furniture:${key}`, shading, 'woven-motif', {inkOnly: record.mode === 'engraving', cache:false}); // Use authored settings without an extra purpose-specific magnification.
      if (record.mode !== 'engraving') return result;
      const engraving = document.createElement('canvas'); // Never mutate the compositor's cached mask.
      engraving.width = canvas.width; engraving.height = canvas.height;
      engraving.getContext('2d').drawImage(result, 0, 0);
      const core = await compositor(canvas, patterns.map(entry=>({...entry,motifThinPx:finite(entry.motifThinPx,0)+2,renderRasterScale:size[2] || 1})), record.palette[1], `furniture-core:${key}`, shading, 'woven-motif', {inkOnly:true,cache:false}); // Exactly the authoring slider's two-source-pixel thinning, including inversion and frame/mesh transforms.
      return window.HobunjiSpritePngSurface.carveCanvas(engraving,core,{strokeOpacity:.65*Math.min(.5,record.opacity),coreOpacity:record.engravingCoreOpacity});
    })();
    tileCache.set(key, pending);
    if (tileCache.size > 24) tileCache.delete(tileCache.keys().next().value);
    try { return await pending; }
    catch (error) { tileCache.delete(key); throw error; }
  }

  // Planar-region identity of a triangle (rounded normal + plane offset), in
  // mesh-local space. Ruin rules pass the regions they want patterned as
  // record.allowRegions so trims, insides and slivers of a mesh can be left plain.
  function regionKey(nx, ny, nz, d) {
    const r = v => Math.round(v * 20) / 20 + 0;
    return `${r(nx)},${r(ny)},${r(nz)}@${Math.round(d * 50) / 50 + 0}`;
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
    const allowRegions = record.allowRegions ? new Set(record.allowRegions) : null; // Optional planar-region whitelist (ruin rules).
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
      if (allowRegions && !allowRegions.has(regionKey(normal.x, normal.y, normal.z, normal.dot(a)))) continue;
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
    const pieceScale = Number(part.patternScale) > 0 ? Number(part.patternScale) : null; // Furniture Author per-piece override for every pattern on this part.
    for (const raw of records) {
      const record = normalize({...raw, scale: Number(raw.scaleOverride) > 0 ? raw.scaleOverride : pieceScale ?? raw.scale}); // Copy per-instance settings; authored recipes remain immutable. Dev rule > piece override > slot scale.
      const complete = surfaceGeometry(mesh, record, part);
      if (!complete) continue;
      for(const {geometry,index:materialIndex} of splitSurfaceMaterials(complete)) {
      const material = png?.makeMaterial?.(THREE, null, 'furniture-pattern', { side: THREE.DoubleSide, transparent: record.mode === 'engraving' || record.opacity < 1, depthWrite: record.mode !== 'engraving' && record.opacity >= 1, opacity: record.mode === 'engraving' ? 1 : record.opacity, alphaTest: record.mode === 'engraving' ? .001 : png?.alphaTest?.() })
        || new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: record.mode === 'engraving' || record.opacity < 1, depthWrite: record.mode !== 'engraving' && record.opacity >= 1, opacity: record.mode === 'engraving' ? 1 : record.opacity, alphaTest: record.mode === 'engraving' ? .001 : png?.alphaTest?.() });
      const overlay = new THREE.Mesh(geometry, material); // Surface child inherits furniture transforms and existing disposal lifecycle.
      overlay.name = `pattern:${record.slot}`;
      overlay.visible = false; // Keep the furniture's authored base visible until its composed tile is ready.
      overlay.userData.furniturePattern = { slot: record.slot, mode: record.mode, patternId: record.patternId || 'custom', palette: record.palette, scale: record.scale, status: 'loading' };
      overlay.userData.devRuinFootprintIgnore = true;
      overlay.raycast = () => {}; // Visual decoration does not claim interactions, collision or Pixel Probe hits.
      material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
      if (part.kind === 'banner') installBannerWind(overlay, part);
      retainPatternScale(overlay, record);
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
      if (overlay.userData.furniturePattern.status === 'skipped') { mesh.remove(overlay); material.dispose(); geometry.dispose(); } // Slivers too small to show a motif cost a draw call and an atlas for nothing.
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
      source.projectionPalette = source.patternMeshes[0]?.userData?.furniturePattern?.palette || null; // Shared fake daylight softly blends these authored dyes; no texture or floor projection is needed.
    }
  }

  function retainPatternScale(mesh, record = {}) {
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
      if (record.minSurfaceTiles > 0 && Math.min(width,height) < record.minSurfaceTiles) { mesh.visible = false; mesh.userData.furniturePattern.status = 'skipped'; return; } // Ruin-only: a strip thinner than a fraction of one tile cannot show a motif.
      const density=Math.min(Number(record.tilePx) > 0 ? Number(record.tilePx) : TILE_PX,(Number(record.maxAtlasPx) > 0 ? Number(record.maxAtlasPx) : MAX_ATLAS_PX)/Math.max(width,height)); // Bound mobile GPU allocation while preserving aspect and pattern size.
      const quantize=px=>px>ATLAS_QUANTUM_PX?Math.ceil(px/ATLAS_QUANTUM_PX)*ATLAS_QUANTUM_PX:Math.max(1,Math.ceil(px)); // Shared atlas sizes let repeated pieces reuse one tile.
      const size=[quantize(width*density),quantize(height*density),density/TILE_PX]; // The surface uses the lower-left part of its (possibly padded) atlas at the exact density.
      const fillU=width*density/size[0],fillV=height*density/size[1];
      for(let i=0;i<base.length;i+=2) {uv.array[i]=(uv.array[i]-minU)/width*fillU;uv.array[i+1]=(uv.array[i+1]-minV)/height*fillV;}
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

  // One motif per surface type per ruin: every wall shares one pattern, every
  // pillar (false pillars included, so they still pass for real ones)
  // another, and so on. The mesh's own type name decides first, then its
  // ancestors' names/roles; anything else is its own repeated piece type.
  const SURFACE_CATEGORIES = [['pillar', /pillar|column/i], ['wall', /wall/i], ['pedestal', /pedestal|plinth/i], ['platform', /platform|dais|balcony/i]];
  function surfaceCategory(key, role) {
    for (const [name, pattern] of SURFACE_CATEGORIES) if (pattern.test(key)) return name;
    for (const [name, pattern] of SURFACE_CATEGORIES) if (pattern.test(role)) return name;
    return key || 'other';
  }

  function decorateRuin(root, seed, special = null) {
    if (!root) return [];
    const catalog = [...(window.PatternLibrary?.getCatalog?.() || []), ...(window.RepoPatternLibrary?.listCached?.() || []).filter(entry=>entry.collectible)]; // Engravings grant exactly the reusable catalog motif rendered on the ruin.
    const ids = new Set(), meshes = []; // Collect first so adding overlay children cannot extend traversal.
    const rules = window.RuinPatternSurfaceRules; // Optional per-piece enable/scale/atlas rules (docs/js/ruin-pattern-surface-rules.js).
    const types = new Map(), overlays = []; // Per repeated piece type, for the Dev Companion's live surface list.
    root.userData.ruinPatternSeed = seed; // Rule edits re-run decoration with the same deterministic choices.
    root.updateMatrixWorld?.(true); // Rules measure faces in world space (a sideways pillar's faces are short, not tall).
    root.traverse(node => { if (node.isMesh && !node.userData?.furniturePattern) meshes.push(node); });
    for (let index = 0; index < meshes.length; index++) {
      const mesh = meshes[index];
      let node = mesh, role = ''; // Walk ancestors only once at generation to find renderer-owned structural semantics.
      while (node && node !== root) { role += ` ${node.name || ''} ${node.userData?.interiorRuinRole || ''} ${node.userData?.ruinFurnitureKey || ''}`; if (node.userData?.ruinInteriorWall) role += ' wall'; node = node.parent; }
      const structural = /wall|pillar|pedestal|platform/i.test(role) && !/seal|glyph|decal|fire|ceiling/i.test(mesh.name || '');
      const namedWall = !!special?.specialBoss && /wall/i.test(role) && !/seal|glyph|decal|fire|ceiling/i.test(mesh.name || ''); // Only the named tomb's walls glow with the guardian's own glyph. // Built-in eligibility when no rules module is loaded.
      if ((!rules && !structural) || !catalog.length) continue;
      for (const child of [...mesh.children]) if (child.userData?.furniturePattern?.mode === 'engraving') { mesh.remove(child); child.geometry?.dispose(); child.material?.map?.dispose(); child.material?.dispose(); } // Re-decoration (rule edits) starts clean, including types now switched off.
      const rule = rules?.resolve?.(mesh, root, structural) || null; // { key, label, context, enabled, scale, partScale, defaultScale, maxAtlasPx, minSurfaceTiles, tilePx }; every ruin mesh gets a type so the Dev Companion can list it.
      const type = rule ? (types.get(rule.key) || types.set(rule.key, { key: rule.key, label: rule.label, meshes: 0, overlays: 0, contexts: new Set(), classes: new Set(), nameExcluded: !!rule.nameExcluded, enabled: rule.enabled, scale: rule.scale, partScale: rule.partScale }).get(rule.key)) : null;
      if (type) { type.meshes++; if (rule.context) type.contexts.add(rule.context); for (const cls of rule.classes || []) type.classes.add(cls); }
      if (rule && !rule.enabled) continue;
      const authoredSlots = mesh.userData?.authoredPart?.patternSurfaces?.filter(record => record.mode === 'engraving'); // Explicit author slots replace the generic structural defaults.
      let templates;
      if (authoredSlots?.length) templates = authoredSlots;
      else if (rule?.sideRegions || rule?.topRegions) { // Rules pick exact face regions: broad sides by default, tops/narrow faces only when enabled.
        templates = [];
        if (rule.sideRegions?.length) templates.push({slot:'sides',selector:'sides',mode:'engraving',random:true,allowRegions:rule.sideRegions});
        if (rule.topRegions?.length) templates.push({slot:'top',selector:'top',mode:'engraving',random:true,allowRegions:rule.topRegions});
      } else {
        const slots = /pedestal|platform/i.test(role) ? ['sides', 'top'] : ['sides']; // Bases and tops roll separately, alongside walls and pillars.
        templates = slots.map(slot => ({slot,selector:slot,mode:'engraving',random:true})); // No mutation of shared part recipes.
      }
      if (!templates.length) continue;
      const category = surfaceCategory(rule?.key || String(mesh.name || ''), role);
      const records = templates.map(template => {
        const slot = template.slot; // Sides and tops of one surface type roll separately.
        const entry = catalog[hash(`${seed}|${category}|${slot}`) % catalog.length]; // Stable per-ruin, per-surface-type selection.
        const patternId = namedWall && special.patternId ? special.patternId : template.random === false && template.patternId ? template.patternId : entry.id; // Completion grants the actual displayed motif.
        return { ...template, pattern: template.random === false ? template.pattern : null,
          patterns:template.random === false ? template.patterns : template.patterns?.length > 1 ? [resolvePattern({patternId}),template.patterns[1]] : null, // Keep seeded ruin primaries independent of the authored overpass snapshot.
          patternId, palette: namedWall ? [special.ink || '#ffd5a3', special.ink || '#ffd5a3'] : (template.palette || ['#b7a185', '#625447']), scale: template.scale || rule?.defaultScale || 1.5,
          ...(rule?.scale > 0 ? { scaleOverride: rule.scale } : {}), ...(rule ? { maxAtlasPx: rule.maxAtlasPx, minSurfaceTiles: template.allowRegions ? 0 : rule.minSurfaceTiles, tilePx: rule.tilePx } : {}) }; // Region-picked faces were size-checked in world space already.
      });
      const authored = mesh.userData?.authoredPart; // Piece JSON data for V50 repo pieces is preloaded by the rules module.
      applyPart(mesh, { ...authored, patternScale: authored?.patternScale ?? rule?.partScale, patternSurfaces: records });
      for (const child of mesh.children) if (child.userData?.furniturePattern?.mode === 'engraving') {
        ids.add(child.userData.furniturePattern.patternId); overlays.push(child); if (type) type.overlays++;
        if (namedWall && child.material) {
          child.material.blending = THREE.AdditiveBlending; // Mask-eye-like glow preserves the existing base wall texture.
          child.material.transparent = true; child.material.depthWrite = false; child.material.needsUpdate = true;
          child.userData.specialLichGlyphGlow = {id:special.patternId, ink:special.ink}; // Exposed for per-wall diagnostics on mobile.
        }
      } // Only motifs actually shown are granted on completion.
    }
    root.userData.ruinPatternTypes = types;
    root.userData.ruinPatternOverlays = overlays;
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
    await window.RepoPatternLibrary?.load?.();
    const candidates = []; // Authored patterned slots and existing daylight panes are eligible.
    object.mesh?.traverse(node => {
      const part = node.userData?.authoredPart;
      if (part && (part.patternSurfaces?.length || /pane/i.test(part.name || ''))) candidates.push({ mesh: node, part });
    });
    if (!candidates.length) return false;
    const panel = document.createElement('div'); // Touch-sized controls share the player's unlocked/saved pattern library.
    panel.setAttribute('data-ctrl-panel', ''); // Lets controller navigation reach the surface dropdown and buttons.
    panel.style.cssText = 'position:fixed;inset:5% 3%;z-index:9400;background:#172126;color:white;padding:18px;overflow:auto;border:2px solid #b7a185;border-radius:12px;box-shadow:0 12px 40px #000b;display:flex;flex-direction:column;gap:12px;max-height:90dvh';
    panel.innerHTML = '<h2 style="margin:0">Furniture pattern</h2><p style="margin:0;color:#c6d0d2">Choose a surface, motif and dyes. Sliders are directly focusable with a controller.</p><section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px"><label>Surface <select data-part data-ctrl-default></select></label><label>Pattern <select data-pattern></select></label><label>Pattern tile size <input data-scale-range type="range" min="0.05" max="20" step="0.05" aria-label="Pattern tile size"></label><output data-scale-value aria-live="polite"></output><label>Base dye <input data-base type="color"></label><label>Pattern dye <input data-dye type="color"></label><label>Overpass dye <input data-overpass-ink type="color"></label><label><input data-solid type="checkbox">Solid color (no motif)</label></section><h3 style="margin:4px 0 0">Pattern placement</h3><p style="margin:0;color:#c6d0d2">Adjust each layer independently. Repeat controls whether the motif tiles or appears once.</p><button data-edit>Choose / draw pattern</button><button data-apply>Apply settings</button><button data-close data-ctrl-cancel>Close</button><details><summary>Pattern diagnostics</summary><pre data-debug style="white-space:pre-wrap;max-height:180px;overflow:auto"></pre></details>';
    const placement = placementControls(panel,panel.querySelector('[data-base]'),panel.querySelector('[data-dye]'),panel.querySelector('[data-overpass-ink]'));
    const find = name => panel.querySelector(`[data-${name}]`); // Dialog-scoped lookup avoids collisions with the furniture editor.
    candidates.forEach(({part}, index) => { const option = document.createElement('option'); option.value = index; option.textContent = part.name || part.id; find('part').appendChild(option); });
    const selected = () => candidates[Number(find('part').value) || 0]; // Selection is read at each action, never inferred from a global mesh name.
    const current = () => {
      const part = selected().part;
      return normalize(object.patternOverrides?.[part.id]?.[0] || part.patternSurfaces?.[0] || {slot:'stained-glass',mode:'glass',selector:'all',normal:[0,0,1],patternId:'diamond-ring',solid:true});
    };
    const refresh = () => { const record = current(); find('scale-range').value = record.scale; find('scale-value').textContent = `Tile size: ${record.scale.toFixed(2)}×`; find('base').value = record.palette[0]; find('dye').value = record.palette[1]; find('overpass-ink').value = record.palette[2] || record.palette[1]; find('solid').checked=!!record.solid;
      const catalog=[...(window.PatternLibrary?.getCatalog?.()||[]),...(window.RepoPatternLibrary?.listCached?.()||[])]; // Every authored/saved motif is selectable without redrawing it.
      find('pattern').replaceChildren();const ids=new Set();for(const entry of [{id:record.patternId,name:record.patternId},...catalog])if(entry.id&&!ids.has(entry.id)){ids.add(entry.id);find('pattern').add(new Option(entry.name||entry.label||entry.id,entry.id));}
      find('pattern').value=record.patternId||'';placement.refresh(record);find('debug').textContent = JSON.stringify(debug(object.mesh), null, 2); };
    const settings = () => {
      const record=placement.read(current()),patternId=find('pattern').value;
      if(patternId!==record.patternId){record.pattern=null;record.patterns[0]=resolvePattern({patternId});}
      return normalize({...record,patternId,solid:find('solid').checked,scale:find('scale-range').value,palette:[find('base').value,find('dye').value,find('overpass-ink').value]});
    };
    const save = record => {
      const overrides = {...object.patternOverrides, [selected().part.id]: [record]}; // Per-instance only; does not edit shared furniture definitions.
      object.patternOverrides = overrides;
      applyOverrides(object.mesh, overrides); persist?.(overrides); refresh();
    };
    panel.querySelector('[data-overpass]').onchange = () => { if(panel.querySelector('[data-overpass]').value)find('solid').checked=false; }; // Adding an overpass enables patterned glass.
    find('pattern').onchange = () => { find('solid').checked=false; }; // Choosing a motif switches plain glass back to patterned glass.
    find('part').onchange = refresh; find('scale-range').addEventListener('input', () => { find('scale-value').textContent = `Tile size: ${Number(find('scale-range').value).toFixed(2)}×`; }); find('close').onclick = () => panel.remove();
    find('apply').onclick = () => save(settings());
    find('edit').onclick = async () => {
      const record = {...settings(),solid:false}; // Preview and save use the same record and shared compositor.
      const initialPattern = await editablePattern(record); // Existing repo/custom ink appears when reopening a placed pattern.
      window.PatternAuthoring?.openEditor?.({ title:'Furniture pattern',initialPattern,
        library:{list:()=>window.PatternLibrary?.listAvailable?.() || [],get:id=>window.PatternLibrary?.getById?.(id),save:(label,data)=>window.PatternLibrary?.saveToLibrary?.(label,data),remove:id=>window.PatternLibrary?.removeSaved?.(id)},
        renderPreview:pattern=>renderTile(record,pattern),onSave:async (pattern,id)=>{const snapshot=await editablePattern({pattern});save({...record,patternId:id || null,pattern:snapshot,patterns:[snapshot,...(record.patterns || []).slice(1)]});} });
    };
    document.body.appendChild(panel); refresh();
    return true;
  }

  function debug(root) {
    const records = []; // On-demand only; Pixel Probe and editor readout share this exact snapshot.
    root?.traverse?.(node => { if (node.userData?.furniturePattern) records.push({ ...node.userData.furniturePattern, mesh: node.name }); });
    return records;
  }

  window.FurniturePatternSurfaces = { surfaceCategory, regionKey, normalize, resolvePattern, editablePattern, placedPatterns, placementControls, renderTile, surfaceGeometry, applyPart, decorateRuin, unlockRuin, applyOverrides, editInstance, debug, hash };
})();
