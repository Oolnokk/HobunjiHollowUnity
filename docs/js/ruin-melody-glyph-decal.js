// Plate-revealed Scratchbone inscriptions on visible ruin stone faces.
// The notes are supplied by the ruin composer, never baked into a texture or songbook.
(() => {
  'use strict';
  const THREE = window.THREE;
  if (!THREE || window.RuinMelodyGlyphDecal) return;
  const pngSurface = window.HobunjiSpritePngSurface; // Use the game's existing PNG-plane filter, alpha and color pipeline for the Scratchbone sprites.

  const MAX_COLUMNS = 6; // Long authored sequences wrap instead of spanning an entire hallway.
  const GLYPH_STEP = .31; // Distance between consecutive Scratchbone glyph centers on an authored stone inscription.
  const LINE_STEP = .35; // Distance between rows for melodies longer than six notes.
  const glyphTextures = new Map(); // Eight PNG textures reused by every generated decal and every subsequent ruin reroll.
  const haloTextures = new Map(); // Blurred, padded halo canvases; only light spreads, never the Scratchbone geometry.
  const haloImages = new Map(); // Loaded source PNG images feed halo creation even if they finish before the halo is requested.
  let glyphGeometry = null; // Single shared alpha-plane geometry for every Scratchbone numeral.

  function layoutFor(notes, maxColumns=MAX_COLUMNS) {
    if (!Array.isArray(notes) || !notes.length) return null;
    const capacity = Math.max(1,Math.min(MAX_COLUMNS,Math.floor(Number(maxColumns)||MAX_COLUMNS))); // A purpose-built narrow pillar can request a single vertical note column.
    const columns = Math.min(capacity, notes.length); // Horizontal capacity of this particular inscription.
    const rows = Math.ceil(notes.length / columns); // Additional lines wrap without spilling past the authored stone face.
    return { columns, rows, width:columns * GLYPH_STEP + .20, depth:rows * LINE_STEP + .20 };
  }

  function getGlyphTexture(index) {
    let texture = glyphTextures.get(index);
    if (!texture) {
      texture = new THREE.TextureLoader().load('assets/hud/scratchbone' + (index + 1) + '.png',loaded=>{
        const image=loaded?.image;
        if(image?.width&&image?.height){
          haloImages.set(index,image);
          haloTextures.get(index)?.paint(image); // One texture load supplies both immovable ink and diffused light.
        }
      });
      if (pngSurface?.configureTexture) pngSurface.configureTexture(THREE,texture,'ruin-melody-glyph-' + (index+1));
      else if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      glyphTextures.set(index, texture);
    }
    return texture;
  }

  function getHaloTexture(index) {
    const source=getGlyphTexture(index);
    if(!window.document?.createElement||!THREE.CanvasTexture)return source; // Headless/old-renderer compatibility; real browsers use a diffused aura.
    if(haloTextures.has(index))return haloTextures.get(index).texture;
    const canvas=window.document.createElement('canvas');
    canvas.width=canvas.height=128; // Transparent padding permits a real soft penumbra instead of enlarging the numeral.
    const texture=new THREE.CanvasTexture(canvas);
    if(pngSurface?.configureTexture)pngSurface.configureTexture(THREE,texture,'ruin-melody-soft-halo-'+(index+1));
    else if('colorSpace' in texture&&THREE.SRGBColorSpace)texture.colorSpace=THREE.SRGBColorSpace;
    const paint=image=>{
      const ctx=canvas.getContext?.('2d');
      if(!ctx||!image?.width||!image?.height)return;
      ctx.clearRect(0,0,128,128);
      ctx.filter='blur(7px)';
      ctx.drawImage(image,32,32,64,64); // Keep the source inscription centered and unscaled in its own mesh.
      ctx.filter='none';
      texture.needsUpdate=true;
    };
    haloTextures.set(index,{texture,paint});
    if(haloImages.has(index))paint(haloImages.get(index));
    else if(source?.image?.width)paint(source.image);
    return texture;
  }

  function getGlyphGeometry() {
    if (!glyphGeometry) {
      glyphGeometry = new THREE.PlaneGeometry(1, 1);
      glyphGeometry.userData = Object.assign({}, glyphGeometry.userData, {devRuinSharedPrimitive:true});
    }
    return glyphGeometry;
  }

  function makeInkMaterial(texture,options={},debugName='ruin-melody-scratchbone'){
    const appearance={...options,transparent:true,depthWrite:false,side:THREE.DoubleSide};
    const material=pngSurface?.makeMaterial
      ? pngSurface.makeMaterial(THREE,texture,debugName,appearance)
      : new THREE.MeshBasicMaterial({map:texture,alphaTest:pngSurface?.alphaTest?.() ?? .001,...appearance});
    const previousCompile=material.onBeforeCompile; // Preserve the canonical sprite material's shader customization.
    material.onBeforeCompile=shader=>{
      previousCompile?.call(material,shader);
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        #ifdef USE_MAP
          diffuseColor.a *= texture2D(map, vUv).a;
        #endif
      `); // Same alpha-only shader used by Witch-bomb engraving glow: BLACK Scratchbone ink must not multiply emitted light to zero.
    };
    material.userData ||= {};
    material.userData.scratchboneAlphaGlow=true; // Mobile diagnostic/debug test can identify actual alpha-only glowing materials.
    return material;
  }
  function candidatePoints(plate, layout, axis, hallway) {
    const along = axis === 'z' ? {x:0,z:1} : {x:1,z:0}; // The inscription reads along the hall's long axis, or X in a room.
    const across = axis === 'z' ? {x:1,z:0} : {x:0,z:1}; // Room plaques sit to one side of the trigger, not on its working surface.
    const alongDistance = layout.width / 2 + .51; // Places the nearest glyph stone beyond the 0.68-unit trigger plate.
    const acrossDistance = layout.depth / 2 + .51; // Keeps the entire plaque out of the plate's down/up animation.
    const offsets = hallway
      ? [[along,alongDistance],[along,-alongDistance],[across,acrossDistance],[across,-acrossDistance]]
      : [[across,acrossDistance],[across,-acrossDistance],[along,alongDistance],[along,-alongDistance]];
    const candidates = offsets.map(([vector,distance])=>({
      x:plate.x + vector.x * distance,
      z:plate.z + vector.z * distance,
    })); // Try the four immediately adjacent faces first, keeping the working trigger clear.
    const lateralStep = Math.max(.65,layout.width * .6); // If adjacent faces are obstructed, slide along their edges before falling back onto the trigger.
    for (const [vector,distance] of offsets) for (const side of [-1,1]) for(const spread of [1,1.5,2]) {
      const perpendicular = {x:-vector.z,z:vector.x};
      candidates.push({
        x:plate.x + vector.x * distance + perpendicular.x * lateralStep * side * spread,
        z:plate.z + vector.z * distance + perpendicular.z * lateralStep * side * spread,
      });
    }
    return candidates;
  }

  function choosePlacement(plate, layout, axis, hallway, bounds, sampleSupport, blockedAt) {
    const yaw = axis === 'z' ? Math.PI / 2 : 0; // The local glyph row becomes a line of notes along world Z in a north/south hall.
    const points = candidatePoints(plate,layout,axis,hallway); // Try adjacent floor in a stable order before using the embedded fallback.
    const samples = [[-.5,-.5],[-.5,0],[-.5,.5],[0,-.5],[0,0],[0,.5],[.5,-.5],[.5,0],[.5,.5]]; // Check the actual stone corners and edges, not inset points that can leave a visible strip through a wall.
    const fits = (position, strict) => samples.every(([u,v]) => {
      if (!strict && (u || v)) return true; // The emergency placement only requires its center to be supported.
      const facing=Math.atan2(plate.x-position.x,plate.z-position.z); // Validate the final plate-facing footprint, including diagonal fallback placements.
      const cos=Math.cos(facing),sin=Math.sin(facing);
      const localX=u * layout.width, localZ=v * layout.depth;
      const x=position.x + cos * localX + sin * localZ;
      const z=position.z - sin * localX + cos * localZ;
      if (bounds && (x < bounds.minX + .05 || x > bounds.maxX - .05 ||
                     z < bounds.minZ + .05 || z > bounds.maxZ - .05)) return false;
      const support=sampleSupport(x,z);
      if (!support || !Number.isFinite(Number(support.y)) || Math.abs(Number(support.y)-plate.y)>.08) return false;
      return !blockedAt?.(x,z,.09);
    });
    const supported = points.find(point=>fits(point,true)); // Normal placement must be flat, clear and fully on supported ruin floor.
    if (supported) return {x:supported.x,z:supported.z,y:plate.y,yaw,fallback:false};
    const centerOnly = points.find(point=>fits(point,false)); // Rare cramped halls still get a readable plaque near their trigger.
    if (centerOnly) return {x:centerOnly.x,z:centerOnly.z,y:plate.y,yaw,fallback:true};
    return {x:plate.x,z:plate.z,y:plate.y+.07,yaw,fallback:true}; // Last resort: a raised inscription centered over its own bronze trigger.
  }

  function chooseSurface(plate,layout,surfaces,surfaceRoot,seed) {
    const candidates=surfaces.slice(); // Explicit fixtures and sampled stone faces share one placement path.
    const visibleHit=entry=>{
      if(!entry.face||entry.distance<=.9)return false;
      for(let node=entry.object;node;node=node.parent)if(node.visible===false)return false;
      const material=entry.object.material; // Invisible collider helpers cannot receive a visible inscription.
      return !material||Array.isArray(material)||material.visible!==false&&material.opacity!==0;
    };
    if(surfaceRoot&&THREE.Raycaster){
      surfaceRoot.updateWorldMatrix?.(true,true);
      const origin=new THREE.Vector3(plate.x,plate.y+1.6,plate.z); // Eye-height rays select only faces visible from the trigger.
      const ray=new THREE.Raycaster(); // Used at creation only; no scene scan or ray allocations in the frame loop.
      for(let i=0;i<16;i++){
        const angle=i*Math.PI/8; // Sample surrounding walls and pillars without favoring a compass direction.
        ray.set(origin,new THREE.Vector3(Math.sin(angle),0,Math.cos(angle)));
        ray.far=14;
        const hit=ray.intersectObject(surfaceRoot,true).find(visibleHit);
        if(!hit)continue;
        const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld); // Accept vertical faces, never floors or ceilings.
        if(Math.abs(normal.y)>.15)continue;
        if(normal.x*(plate.x-hit.point.x)+normal.z*(plate.z-hit.point.z)<0)normal.negate();
        const yaw=Math.atan2(normal.x,normal.z); // The PNG's top stays world-up, and its front faces the plate.
        let fits=true;
        for(const offset of [-layout.width/2,layout.width/2])for(const height of [-layout.depth/2,layout.depth/2]){
          const edge=new THREE.Vector3(hit.point.x+Math.cos(yaw)*offset,hit.point.y+height,hit.point.z-Math.sin(yaw)*offset);
          ray.set(origin,edge.clone().sub(origin).normalize());
          const edgeHit=ray.intersectObject(surfaceRoot,true).find(visibleHit);
          if(!edgeHit||edgeHit.object!==hit.object||edgeHit.point.distanceTo(edge)>.12){fits=false;break;}
        }
        if(fits)candidates.push({x:hit.point.x+normal.x*.025,y:hit.point.y,z:hit.point.z+normal.z*.025,yaw});
      }
    }
    if(!candidates.length)return null;
    return {...candidates[(Number(seed)>>>0)%candidates.length],vertical:true,fallback:false};
  }

  function create({root,plate,notes,bounds=null,hallway=false,hallAxis='x',sampleSupport,blockedAt,makeStoneMaterial,surfaces=[],surfaceRoot=null,seed=0,maxColumns=MAX_COLUMNS} = {}) {
    if (!root?.add || !plate || typeof sampleSupport !== 'function') return null;
    const noteLimit = window.KurrayaPuzzle?.NOTE_CODES?.length ?? 8; // Only the eight playable pitches have matching Scratchbone number sprites.
    const valid = value => Array.isArray(value) && value.length > 0 &&
      value.every(note=>Number.isInteger(note) && note>=0 && note<noteLimit);
    if (!valid(notes)) return null;

    const axis = hallway && hallAxis === 'z' ? 'z' : 'x'; // Room glyph rows run east/west; hall inscriptions align with the corridor.
    const group = new THREE.Group(); // Owns every part of this inscription so its parent ruin disposes it on reroll.
    group.name = 'dev_ruin_melody_scratchbone_decal';
    group.userData.devRuinFootprintIgnore = true;
    group.userData.hobunjiGroundSurface = true;
    root.add(group);
    let sequenceKey = ''; // Used to detect changes from the generator and avoid rebuilding an identical inscription every frame.
    let placement = null; // Exposed to the existing mobile ruin diagnostics.

    function clearParts() {
      for (const part of [...group.children]) {
        group.remove(part);
        const stack=[part]; // Additive note halos are children of each glyph; all owned material passes must retire on reroll.
        while(stack.length){
          const node=stack.pop();
          if(node.children?.length)stack.push(...node.children);
          node.material?.dispose?.();
          if(node.geometry && !node.geometry.userData?.devRuinSharedPrimitive)node.geometry.dispose?.();
        }
      }
    }

    function setNotes(nextNotes) {
      if (!valid(nextNotes)) return false;
      const nextKey = nextNotes.join(','); // Every arbitrary sequence, including repeats, has a distinct ordered key.
      if (nextKey === sequenceKey) return true;
      const layout = layoutFor(nextNotes,maxColumns); // A narrow purpose-built pillar uses one note per row; other ruin inscriptions retain their existing layout.
      const nextPlacement = chooseSurface(plate,layout,surfaces,surfaceRoot,seed)
        || choosePlacement(plate,layout,axis,hallway,bounds,sampleSupport,blockedAt);
      if(!nextPlacement.vertical)nextPlacement.yaw=Math.atan2(plate.x-nextPlacement.x,plate.z-nextPlacement.z); // Floor fallback reads upright from its own plate.
      clearParts();
      const backingMaterial = makeStoneMaterial?.() || new THREE.MeshBasicMaterial({color:0xc2b39b});
      const backing = new THREE.Mesh(new THREE.BoxGeometry(layout.width,nextPlacement.vertical?layout.depth:.03,nextPlacement.vertical?.03:layout.depth),backingMaterial);
      backing.name = 'dev_ruin_melody_decal_stone';
      backing.position.y = nextPlacement.vertical?0:.027;
      backing.userData.devRuinFootprintIgnore = true;
      backing.userData.hobunjiGroundSurface = true;
      backing.raycast = () => {}; // Decorative stone and ink must never steal an interaction or projectile hit.
      group.add(backing);

      for (let index=0; index<nextNotes.length; index++) {
        const note = nextNotes[index]; // Exact generated scale-button index, not a pitch converted back to its nearest numeral.
        const row = Math.floor(index/layout.columns), column=index%layout.columns;
        const rowLength = Math.min(layout.columns,nextNotes.length-row*layout.columns);
        const texture=getGlyphTexture(note); // Reuses the authored Scratchbone silhouette through the canonical sprite pipeline.
        const appearance={color:0xffda70,transparent:true,side:THREE.DoubleSide,
          depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2};
        const material=makeInkMaterial(texture,appearance,'ruin-melody-scratchbone-' + (index+1));
        const glyph = new THREE.Mesh(getGlyphGeometry(),material);
        glyph.name = 'dev_ruin_melody_scratchbone_' + (index+1);
        glyph.scale.set(.26,.28,1);
        glyph.rotation.x = nextPlacement.vertical?0:-Math.PI/2; // Vertical faces keep world-up; floor fallbacks face upward.
        glyph.position.set((column-(rowLength-1)/2)*GLYPH_STEP,
          nextPlacement.vertical?((layout.rows-1)/2-row)*LINE_STEP:.048,
          nextPlacement.vertical?.028:(row-(layout.rows-1)/2)*LINE_STEP);
        glyph.userData.devRuinFootprintIgnore = true;
        glyph.userData.hobunjiGroundSurface = true;
        glyph.userData.melodyNoteIndex = note;
        glyph.raycast = () => {}; // The glyph is a clue, not a separate activator.
        const softHalo=getHaloTexture(note); // Blurred source alpha, never a scaled-up crisp copy of carved ink.
        const glowMaterial=makeInkMaterial(softHalo,{
          color:0xeaf5ff,transparent:true,opacity:.11,depthTest:true,depthWrite:false,
          blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,
        },'ruin-melody-additive-glow-' + (index+1));
        const halo=new THREE.Mesh(getGlyphGeometry(),glowMaterial);
        halo.name='ruin-melody-scratchbone-glow-'+index;
        halo.scale.set(2.3,2.4,1); // Static padded halo; its opacity, not geometry, controls apparent reach.
        halo.position.z=.005;
        halo.raycast=()=>{};
        halo.renderOrder=(glyph.renderOrder||0)+1;
        halo.frustumCulled=false;
        glyph.userData.melodyGlowMaterial=glowMaterial;
        glyph.add(halo);
        const outerMaterial=makeInkMaterial(softHalo,{
          color:0xeaf5ff,transparent:true,opacity:.045,depthTest:true,depthWrite:false,
          blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3,
        },'ruin-melody-wide-halo-'+(index+1));
        const wide=new THREE.Mesh(getGlyphGeometry(),outerMaterial);
        wide.name='ruin-melody-scratchbone-wide-halo-'+index;
        wide.scale.set(3.25,3.35,1); // Fixed outer diffusion plane; lerped alpha expands the visible *light*, not the symbol.
        wide.position.z=.003;
        wide.raycast=()=>{};
        wide.renderOrder=(glyph.renderOrder||0)+2;
        wide.frustumCulled=false;
        glyph.userData.melodyOuterGlowMaterial=outerMaterial;
        glyph.add(wide);
        glyph.material.color?.setHex?.(0xeaf5ff); // Unselected notes retain a soft neutral-white ink glow.
        group.add(glyph);
      }
      group.position.set(nextPlacement.x,nextPlacement.y,nextPlacement.z);
      group.rotation.y = nextPlacement.yaw;
      group.userData.melodyNotes = nextNotes.slice();
      placement = {...nextPlacement,width:layout.width,depth:layout.depth,rows:layout.rows};
      sequenceKey = nextKey;
      return true;
    }

    if (!setNotes(notes)) {root.remove(group);return null;}
    group.visible=false; // Clues appear only while the player stands on the owning pressure plate.
    const matchesNotes = candidate => {
      const displayed=group.userData.melodyNotes; // Avoid allocation/serialization in the ruin's per-frame sequence synchronization.
      return Array.isArray(candidate) && candidate.length===displayed.length &&
        candidate.every((note,index)=>note===displayed[index]);
    };
    return {
      group,setNotes,matchesNotes,
      setVisible(visible){group.visible=!!visible;},
      dispose(){clearParts();group.parent?.remove(group);},
      get sequenceKey() {return sequenceKey;},
      diagnostics:()=>({visible:group.visible,notes:group.userData.melodyNotes?.slice()||[],...placement}),
    };
  }

  window.RuinMelodyGlyphDecal = Object.freeze({create,layoutFor,makeInkMaterial});
})();
