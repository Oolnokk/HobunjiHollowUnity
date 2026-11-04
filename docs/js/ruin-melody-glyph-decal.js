// Procedural, readable Scratchbone inscriptions for the Random Ruin melody plates.
// The notes are supplied by the ruin composer, never baked into a texture or songbook.
(() => {
  'use strict';
  const THREE = window.THREE;
  if (!THREE || window.RuinMelodyGlyphDecal) return;
  const pngSurface = window.HobunjiSpritePngSurface; // Use the game's existing PNG-plane filter, alpha and color pipeline for the Scratchbone sprites.

  const MAX_COLUMNS = 6; // Long authored sequences wrap instead of spanning an entire hallway.
  const GLYPH_STEP = .31; // Distance between consecutive Scratchbone glyph centers on a stone floor inscription.
  const LINE_STEP = .35; // Distance between rows for melodies longer than six notes.
  const glyphTextures = new Map(); // Eight PNG textures reused by every generated decal and every subsequent ruin reroll.
  let glyphGeometry = null; // Single shared alpha-plane geometry for every Scratchbone numeral.

  function layoutFor(notes) {
    if (!Array.isArray(notes) || !notes.length) return null;
    const columns = Math.min(MAX_COLUMNS, notes.length); // Horizontal capacity of this particular inscription.
    const rows = Math.ceil(notes.length / MAX_COLUMNS); // Additional lines for a future longer generator sequence.
    return { columns, rows, width:columns * GLYPH_STEP + .20, depth:rows * LINE_STEP + .20 };
  }

  function getGlyphTexture(index) {
    let texture = glyphTextures.get(index);
    if (!texture) {
      texture = new THREE.TextureLoader().load('assets/hud/scratchbone' + (index + 1) + '.png');
      if (pngSurface?.configureTexture) pngSurface.configureTexture(THREE,texture,'ruin-melody-glyph-' + (index+1));
      else if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      glyphTextures.set(index, texture);
    }
    return texture;
  }

  function getGlyphGeometry() {
    if (!glyphGeometry) {
      glyphGeometry = new THREE.PlaneGeometry(1, 1);
      glyphGeometry.userData = Object.assign({}, glyphGeometry.userData, {devRuinSharedPrimitive:true});
    }
    return glyphGeometry;
  }

  function candidatePoints(plate, layout, axis, hallway) {
    const along = axis === 'z' ? {x:0,z:1} : {x:1,z:0}; // The inscription reads along the hall's long axis, or X in a room.
    const across = axis === 'z' ? {x:1,z:0} : {x:0,z:1}; // Room plaques sit to one side of the trigger, not on its working surface.
    const alongDistance = layout.width / 2 + .51; // Places the nearest glyph stone beyond the 0.68-unit trigger plate.
    const acrossDistance = layout.depth / 2 + .51; // Keeps the entire plaque out of the plate's down/up animation.
    const offsets = hallway
      ? [[along,alongDistance],[along,-alongDistance],[across,acrossDistance],[across,-acrossDistance]]
      : [[across,acrossDistance],[across,-acrossDistance],[along,alongDistance],[along,-alongDistance]];
    return offsets.map(([vector,distance])=>({
      x:plate.x + vector.x * distance,
      z:plate.z + vector.z * distance,
    }));
  }

  function choosePlacement(plate, layout, axis, hallway, bounds, sampleSupport, blockedAt) {
    const yaw = axis === 'z' ? Math.PI / 2 : 0; // The local glyph row becomes a line of notes along world Z in a north/south hall.
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const points = candidatePoints(plate,layout,axis,hallway); // Try adjacent floor in a stable order before using the embedded fallback.
    const samples = [[0,0],[-.42,0],[.42,0],[0,-.38],[0,.38],[-.42,-.38],[.42,-.38],[-.42,.38],[.42,.38]];
    const fits = (position, strict) => samples.every(([u,v]) => {
      if (!strict && (u || v)) return true; // The emergency placement only requires its center to be supported.
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

  function create({root,plate,notes,bounds=null,hallway=false,hallAxis='x',sampleSupport,blockedAt,makeStoneMaterial} = {}) {
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
        part.material?.dispose?.();
        if (part.geometry && !part.geometry.userData?.devRuinSharedPrimitive) part.geometry.dispose?.();
      }
    }

    function setNotes(nextNotes) {
      if (!valid(nextNotes)) return false;
      const nextKey = nextNotes.join(','); // Every arbitrary sequence, including repeats, has a distinct ordered key.
      if (nextKey === sequenceKey) return true;
      const layout = layoutFor(nextNotes); // Panel length and row wrapping are derived entirely from the new generated notes.
      const nextPlacement = choosePlacement(plate,layout,axis,hallway,bounds,sampleSupport,blockedAt);
      clearParts();
      const backingMaterial = makeStoneMaterial?.() || new THREE.MeshBasicMaterial({color:0xc2b39b});
      const backing = new THREE.Mesh(new THREE.BoxGeometry(layout.width,.03,layout.depth),backingMaterial);
      backing.name = 'dev_ruin_melody_decal_stone';
      backing.position.y = .027;
      backing.userData.devRuinFootprintIgnore = true;
      backing.userData.hobunjiGroundSurface = true;
      backing.raycast = () => {}; // Decorative stone and ink must never steal an interaction or projectile hit.
      group.add(backing);

      for (let index=0; index<nextNotes.length; index++) {
        const note = nextNotes[index]; // Exact generated scale-button index, not a pitch converted back to its nearest numeral.
        const row = Math.floor(index/MAX_COLUMNS), column=index%MAX_COLUMNS;
        const rowLength = Math.min(MAX_COLUMNS,nextNotes.length-row*MAX_COLUMNS);
        const texture=getGlyphTexture(note); // Reuses the authored Scratchbone silhouette through the canonical sprite pipeline.
        const appearance={color:0xffffff,transparent:true,side:THREE.DoubleSide,
          depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2};
        const material=pngSurface?.makeMaterial
          ? pngSurface.makeMaterial(THREE,texture,'ruin-melody-scratchbone-' + (index+1),appearance)
          : new THREE.MeshBasicMaterial({map:texture,alphaTest:pngSurface?.alphaTest?.() ?? .001,...appearance});
        const glyph = new THREE.Mesh(getGlyphGeometry(),material);
        glyph.name = 'dev_ruin_melody_scratchbone_' + (index+1);
        glyph.scale.set(.26,.28,1);
        glyph.rotation.x = -Math.PI/2; // Flat, upward-facing plane reads as an engraved floor decal from the gameplay camera.
        glyph.position.set((column-(rowLength-1)/2)*GLYPH_STEP,.048,
          (row-(layout.rows-1)/2)*LINE_STEP);
        glyph.userData.devRuinFootprintIgnore = true;
        glyph.userData.hobunjiGroundSurface = true;
        glyph.userData.melodyNoteIndex = note;
        glyph.raycast = () => {}; // The glyph is a clue, not a separate activator.
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
    const matchesNotes = candidate => {
      const displayed=group.userData.melodyNotes; // Avoid allocation/serialization in the ruin's per-frame sequence synchronization.
      return Array.isArray(candidate) && candidate.length===displayed.length &&
        candidate.every((note,index)=>note===displayed[index]);
    };
    return {
      group,setNotes,matchesNotes,
      get sequenceKey() {return sequenceKey;},
      diagnostics:()=>({notes:group.userData.melodyNotes?.slice()||[],...placement}),
    };
  }

  window.RuinMelodyGlyphDecal = Object.freeze({create,layoutFor});
})();
