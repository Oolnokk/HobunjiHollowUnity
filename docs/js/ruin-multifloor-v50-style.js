// RuinMultifloorV50Style — V50 stone panels and collectible engraving motifs for
// the shaft and hand-built puzzle wings. All physical walls remain on their
// existing voxel grids; these small, non-colliding reliefs are visual only.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinMultifloorV50Style=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';

  let activeKanthicLights=[]; // Only the currently mounted Kanthic shaft contributes to the shared darkness compositor.

  function mountKanthicFixtures({accents,rec,ruin,hub,THREE,getPlayerY,showToast,onStateChange}){
    if(ruin.theme!=='kanthic')return null;
    const rootGroup=new THREE.Group(); // Session-owned, non-colliding fire furniture in the actual shaft.
    rootGroup.name='kanthic-shaft-fire-fixtures';accents.add(rootGroup);
    const grid=hub.grid,o=hub.options,lights=[],flames=[],towerFixtures=[],controls=[]; // Shared source list and cleanup handles for sconces and optional hub braziers.
    const stone=root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#766b62'
    })||new THREE.MeshBasicMaterial({color:0x766b62}); // Use the same PNG stone as the ruin itself.
    const bronze=root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillEnabled:true,
      materialFillColor:'#66442c',materialFillMode:'always',color:'#66442c'
    })||new THREE.MeshBasicMaterial({color:0x66442c}); // Warm metallic fittings remain stone-textured on unlit phones.
    const fire=new THREE.MeshBasicMaterial({color:0xff8b31}); // Emissive-looking geometry stays visible under the new firelight mask.
    const ember=new THREE.MeshBasicMaterial({color:0xffcc68}); // The light core helps identify the fixture before a brazier is lit.
    const bracketGeo=new THREE.BoxGeometry(.95,.3,.65),armGeo=new THREE.BoxGeometry(.22,.8,.4); // Reused by every giant wall and moving-tower sconce.
    const sconceBowlGeo=new THREE.CylinderGeometry(.55,.39,.29,10),flameGeo=new THREE.ConeGeometry(.31,1.05,7); // Shared sconces keep draw and allocation counts bounded.
    const brazierBaseGeo=new THREE.CylinderGeometry(.68,.83,.8,10),brazierDishGeo=new THREE.CylinderGeometry(.83,.62,.28,10); // Freestanding hub braziers have real bowls, not flat markers.
    const geometries=[bracketGeo,armGeo,sconceBowlGeo,flameGeo,brazierBaseGeo,brazierDishGeo]; // Disposed with this ruin session, never while another shaft is active.
    const materials=[stone,bronze,fire,ember]; // No global material registry or extra WebGL PointLights.
    const worldPoint=new THREE.Vector3(); // Reused to track light emitters attached to rotating/elevating obelisk towers.
    const floorRoots=new Map(); // Hides decorative sconces above the current level, matching existing shaft-wing rendering.
    function floorRoot(story){
      if(!floorRoots.has(story)){
        const group=new THREE.Group(); // One visibility switch per story instead of per light.
        group.name='kanthic-fire-story-'+story;floorRoots.set(story,group);rootGroup.add(group);
      }
      return floorRoots.get(story);
    }
    function addMesh(parent,name,geo,mat,x,y,z){
      const mesh=new THREE.Mesh(geo,mat); // Visual-only mesh; never enters the ruin's interaction or projectile collision footprints.
      mesh.name=name;mesh.position.set(x,y,z);mesh.userData.devRuinFootprintIgnore=true;parent.add(mesh);
      return mesh;
    }
    function sconce(parent,x,y,z,dx,dz,story,tower=false){
      const group=new THREE.Group(); // Mounted against a real interior masonry face (or a moving obelisk holder).
      group.name=tower?'kanthic-tower-giant-sconce':'kanthic-wall-giant-sconce';
      group.position.set(x,y,z);group.rotation.y=Math.atan2(dx,dz);group.userData.devRuinFootprintIgnore=true;parent.add(group);
      addMesh(group,'sconce-wall-bracket',bracketGeo,stone,0,-.58,.17);
      addMesh(group,'sconce-protruding-arm',armGeo,bronze,0,-.23,.39);
      addMesh(group,'sconce-fire-bowl',sconceBowlGeo,bronze,0,-.32,.67);
      addMesh(group,'sconce-flame',flameGeo,fire,0,.29,.69);
      const source={x:0,y:0,z:0,anchor:group,story,floorY:grid.levelToY(story*o.spacing),
        radius:tower?4.0:3.4,strength:tower?.48:.42,color:[255,121,41],active:true}; // Small, constantly lit guide pools; full illumination must be earned from braziers.
      lights.push(source);return group;
    }
    const wallNormals=[{side:'N',dx:0,dz:1},{side:'E',dx:-1,dz:0},
      {side:'S',dx:0,dz:-1},{side:'W',dx:1,dz:0}]; // All normals point from the solid wall into the playable shaft.
    for(let story=0;story<o.floors;story++){
      const height=Math.min(5,Math.max(2,Math.floor(o.spacing*.35))); // Mount the giant fire above doorways without placing it in the roof.
      const level=story*o.spacing+height;
      if(level>=grid.levels-1)continue;
      for(const normal of wallNormals){
        const slots=story%2===0?[.34,.66]:[.5]; // Alternating pairs make the immense vertical walls legible without a grid of hundreds of lights.
        for(const fraction of slots){
          const along=o.wall+Math.floor((o.shaft-1)*fraction);
          const cellC=normal.side==='E'?o.wall+o.shaft:normal.side==='W'?o.wall-1:along;
          const cellR=normal.side==='N'?o.wall-1:normal.side==='S'?o.wall+o.shaft:along; // Select the masonry cell outside the hollow shaft, then face its adjacent empty cell.
          const openC=cellC+normal.dx,openR=cellR+normal.dz;
          if(!grid.isSolid(cellC,cellR,level)||grid.isSolid(openC,openR,level))continue; // No fixture over a portal or on clipped octagon corners.
          const x=grid.colToX(cellC+.5+normal.dx*.53),z=grid.rowToZ(cellR+.5+normal.dz*.53);
          sconce(floorRoot(story),x,grid.levelToY(level+.5),z,normal.dx,normal.dz,story);
        }
      }
    }
    for(const floor of ruin.shaftHubPlan?.floors||[])for(const wing of floor.wings||[]){
      const room=wing.rooms?.[0]; // Place one modest sconce in each outer wing, leaving the shaft as the brightest architectural landmark.
      if(!room||room.w<5||room.d<5)continue;
      const x=room.x+Math.max(2,Math.floor(room.w*.3)),z=room.z+.13; // The northern interior face is inset from its corner and stays clear of the central doorway.
      sconce(floorRoot(floor.floor),x,floor.y+2.05,z,0,1,floor.floor);
    }
    for(const pillar of hub.obelisks?.pillars||[]){
      if(!['A','D'].includes(pillar.name))continue; // Two luminous tower sides per story are enough to mark the moving shaft mechanisms.
      const holder=rec.scene.getObjectByName?.(pillar.id); // The live obelisk holder owns the motion; lights follow its animated transform.
      if(!holder)continue;
      const front=pillar.name==='A'?1:-1;
      const fixture=sconce(holder,0,-1.65,front*2.08,0,front,pillar.story,true);
      towerFixtures.push(fixture); // Explicitly detach from a different runtime's owner before it is destroyed.
    }
    for(let story=0;story<o.floors;story++){
      const level=story*o.spacing,lo=o.wall,hi=lo+o.shaft-1,mid=Math.floor((lo+hi)/2);
      const candidates=[[lo+3,mid-5],[mid+5,lo+3],[hi-3,mid+5],[mid-5,hi-3]]; // Gallery-side placements: never in the central fatal basin or the narrow entry tunnel.
      const ordered=candidates.slice(story%4).concat(candidates.slice(0,story%4));
      const cell=ordered.find(([c,r])=>grid.canStand(c,r,level)&&!grid.isSolid(c,r,level+1));
      if(!cell)continue; // Never invent a brazier on an unsupported story or block the only available path.
      const floorY=grid.levelToY(level),x=grid.colToX(cell[0]+.5),z=grid.rowToZ(cell[1]+.5);
      const group=new THREE.Group(); // Optional fire source, separate from the Great Door's required wing braziers.
      group.name='kanthic-shaft-optional-brazier-'+story;group.position.set(x,floorY,z);
      group.userData.devRuinFootprintIgnore=true;floorRoot(story).add(group);
      addMesh(group,'brazier-carved-base',brazierBaseGeo,stone,0,.43,0);
      addMesh(group,'brazier-bronze-fire-dish',brazierDishGeo,bronze,0,.96,0);
      const flame=new THREE.Group(); // Use the existing authored campfire particle emitter only for the few interactive braziers.
      flame.name='kanthic-shaft-brazier-fire';flame.position.y=1.15;flame.visible=false;group.add(flame);
      const visual=root.PersistentGroundFire?.attachCampfireFlame?.(flame,{scale:1.35,rateScale:.9});
      if(visual)flames.push(visual);
      const source={x,y:floorY+1.4,z,story,floorY,radius:7,strength:.91,
        color:[255,132,54],active:false}; // Igniting a brazier progressively lifts darkness around its actual floor.
      lights.push(source);
      const state={lit:false,group,source}; // Shared by the mobile prompt, fire emitter and light mask.
      const control={kind:'kanthicShaftBrazier',object:group,promptRoot:group,floorY,range:2.1,
        priority:18,touchIcon:'🔥',label:()=>state.lit?'Brazier Burning':'Ignite Shaft Brazier',
        onPress:()=>{
          const playerY=Number(getPlayerY?.()); // Prevent igniting the same X/Z position from another stacked floor.
          if(state.lit||!Number.isFinite(playerY)||Math.abs(playerY-floorY)>1.1)return;
          state.lit=true;flame.visible=true;source.active=true;
          root.RuinInteractionAudio?.activator?.(group,{size:1.5});
          showToast?.('The Kanthic shaft grows brighter.',true);
          root.CloudForestFog?.refreshLightingOverlay?.();onStateChange?.();
        }};
      ruin.controls.push(control);controls.push(control);
    }
    activeKanthicLights=lights;
    let lastTick=0; // Particle emitters share the existing shaft-style render tick rather than starting an independent loop.
    const tick=()=>{
      const now=typeof performance!=='undefined'?performance.now():Date.now(),dt=lastTick?Math.min(.05,Math.max(0,(now-lastTick)/1000)):0;
      lastTick=now;
      for(const effect of flames)effect.update?.(dt);
      const playerY=Number(getPlayerY?.());
      if(Number.isFinite(playerY))for(const [story,group] of floorRoots)group.visible=grid.levelToY(story*o.spacing)<=playerY+.8;
      for(const source of lights)if(source.anchor?.getWorldPosition){
        source.anchor.getWorldPosition(worldPoint);
        source.x=worldPoint.x;source.y=worldPoint.y;source.z=worldPoint.z;
      }
    };
    tick(); // Populate moving-tower light positions on the very first draw.
    const dispose=()=>{
      for(const control of controls){const index=ruin.controls.indexOf(control);if(index>=0)ruin.controls.splice(index,1);}
      for(const effect of flames)effect.dispose?.();
      for(const fixture of towerFixtures)fixture.parent?.remove(fixture);
      if(activeKanthicLights===lights)activeKanthicLights=[];
      for(const geo of geometries)geo.dispose();
      for(const mat of materials)mat.dispose();
      rootGroup.parent?.remove(rootGroup);
    };
    return {tick,dispose,lights,braziers:controls.length,sconces:lights.length-controls.length};
  }
  function apply({rec,ruin,hub,seed,THREE,getPlayerY,routeTiles=[],showToast,onStateChange}={}){
    if(!rec?.scene||!ruin?.localeRoot||!hub?.grid||!THREE?.Mesh)
      throw new Error('V50 multifloor wall style needs a mounted scene and shaft grid.');
    const accents=new THREE.Group(); // Owns the V50-style wall reliefs for cleanup on dungeon reroll.
    accents.name='ruin-v50-engraved-masonry';rec.scene.add(accents);
    root.FurniturePatternSurfaces?.setRuinAwardTarget?.(accents,ruin.localeRoot); // Late motifs grant to the playable ruin without circular serialized scene data.
    const kanthicFire=mountKanthicFixtures({accents,rec,ruin,hub,THREE,getPlayerY,showToast,onStateChange}); // Adds Kanthic-only hub and moving-tower fire without changing wing progression.
    if(kanthicFire){ruin.shaftConnection.kanthicSconces=kanthicFire.sconces;ruin.shaftConnection.kanthicOptionalBraziers=kanthicFire.braziers;}
    const stone=root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',
      materialFillMode:'never',color:'#7a746b',
    })||new THREE.MeshBasicMaterial({color:0x7a746b}); // Same shared material factory and stone texture as original V50 walls.
    const wallFace=new THREE.BoxGeometry(.89,1.64,.055); // Thin geometry supports the existing engraving projection, rather than a new shader.
    const pilaster=new THREE.BoxGeometry(.35,2.25,.22); // Repeats the V50 narrow pillar rhythm along otherwise featureless corridor walls.
    const matrix=new THREE.Matrix4(),world=new THREE.Matrix4(),point=new THREE.Vector3();
    const wingTiles=new Map(); // Resolve each authored wing's real story-specific floor, never the flattened cells shared with other elevations.
    for(const floor of ruin.shaftHubPlan?.floors||[])for(const wing of floor.wings||[])
      if(typeof root.RuinLayerPlayable?.collect==='function')
        wingTiles.set(wing.id,root.RuinLayerPlayable.collect(wing));
    const entryTiles=new Set([...(ruin.entryFloorSet||[]),...routeTiles.map(([x,z])=>x+','+z)]); // Ground-floor stone entrance/corridor only; upper stories must not flip engraving placement.
    const corridorTiles=entryTiles.size?entryTiles:rec.floorSet;
    const floorGroups=new Map(),floorCounts=new Map(); // Each story's visual accents follow the same elevation visibility as generated wing rooms.
    let faces=0,pillars=0; // Exposed in the mobile ruin badge to confirm themed wall pieces were built.
    const MAX_PANELS=96,MAX_PILASTERS=24; // Global material/atlas budget for one entire multi-story ruin.
    const PER_STORY_PANELS=28,PER_STORY_PILASTERS=8; // Avoid using every accent on floor zero and leaving higher stories bare.
    function panel(x,y,z,aroundY=0,isPillar=false,story=0){
      let counts=floorCounts.get(story);
      if(!counts){counts={panels:0,pilasters:0};floorCounts.set(story,counts);}
      if(isPillar?(pillars>=MAX_PILASTERS||counts.pilasters>=PER_STORY_PILASTERS)
        :(faces>=MAX_PANELS||counts.panels>=PER_STORY_PANELS))return;
      let group=floorGroups.get(story);
      if(!group){
        group=new THREE.Group();
        group.name='ruin-v50-masonry-floor-'+story;
        floorGroups.set(story,group);
        accents.add(group);
      }
      const mesh=new THREE.Mesh(isPillar?pilaster:wallFace,stone);
      mesh.name=isPillar?'v50 ruin wall pillar':'v50 ruin wall panel';
      mesh.userData.interiorRuinRole=isPillar?'pillar':'wall';
      mesh.userData.devRuinFootprintIgnore=true;
      mesh.position.set(x,y,z);mesh.rotation.y=aroundY;
      group.add(mesh);
      if(isPillar){pillars++;counts.pilasters++;}else{faces++;counts.panels++;}
    }
    rec.scene.updateMatrixWorld?.(true);
    rec.scene.traverse(node=>{
      if(!node.isInstancedMesh)return;
      const name=String(node.name||'');
      const corridor=name==='ruin-corridor-north-south-walls'||name==='ruin-corridor-east-west-walls';
      const wing=/^floor\d+-[NESW]-wall-(ns|ew)$/.test(name);
      if(!corridor&&!wing)return;
      const alongX=name.endsWith('wall-ns')||name.includes('north-south-walls');
      const alongZ=name.endsWith('wall-ew')||name.includes('east-west-walls');
      if(!alongX&&!alongZ)return;
      node.updateWorldMatrix?.(true,false);
      const count=Number(node.count)||0;
      for(let i=3;i<count;i+=8){ // Sparse authored-looking pattern rhythm; no one-mesh-per-wall-cell explosion.
        node.getMatrixAt(i,matrix);
        world.multiplyMatrices(node.matrixWorld,matrix);
        point.setFromMatrixPosition(world);
        const yaw=alongZ?Math.PI/2:0;
        const cellX=Math.floor(point.x),cellZ=Math.floor(point.z);
        const wingMatch=/^(floor\d+-[NESW])-wall-(ns|ew)$/.exec(name);
        const floorSet=(wingMatch&&wingTiles.get(wingMatch[1]))||(!wingMatch&&corridorTiles)||rec.floorSet; // World-space wall decorations face their actual room, not a floor that happens to overlap in 2D.
        const onMinus=alongX?floorSet.has(cellX+','+(cellZ-1))
          :floorSet.has((cellX-1)+','+cellZ);
        const onPlus=alongX?floorSet.has(cellX+','+(cellZ+1))
          :floorSet.has((cellX+1)+','+cellZ);
        const direction=onMinus&&!onPlus?-1:1;
        const offset=direction*.095;
        const storyMatch=/^floor(\d+)-/.exec(name);
        const story=storyMatch?Number(storyMatch[1]):0; // Upper authored-wing walls must not remain visible through the ground-floor ceiling.
        panel(point.x+(alongZ?offset:0),point.y,point.z+(alongX?offset:0),yaw,false,story);
        if(i%32===3)panel(point.x+(alongZ?direction*.17:0),point.y,
          point.z+(alongX?direction*.17:0),yaw,true,story);
      }
    });
    const grid=hub.grid;
    for(let story=0;story<hub.options.floors;story++){
      const level=story*hub.options.spacing;
      for(let r=1;r<grid.rows-1;r++)for(let c=1;c<grid.cols-1;c++){
        if(!grid.isSolid(c,r,level))continue;
        for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
          if(grid.isSolid(c+dx,r+dz,level))continue;
          if(((c*31+r*17+story*13+seed)>>>0)%9!==0)continue;
          const x=grid.colToX(c+.5+dx*.52),z=grid.rowToZ(r+.5+dz*.52);
          const y=grid.levelToY(level+1.1),yaw=dx?Math.PI/2:0;
          panel(x,y,z,yaw,false,story);
          if(((c+r+story) % 4)===0)panel(x+dx*.055,y,z+dz*.055,yaw,true,story);
        }
      }
    }
    const special=ruin.specialBoss?{
      specialBoss:true,
      patternId:ruin.specialGlyph,
      ink:ruin.specialBodyColor3,
    }:undefined; // Named-lich masonry shares the original wall-ink selection.
    const ids=root.FurniturePatternSurfaces?.decorateRuin?.(accents,seed,special)||[];
    // Broad walls of the shaft and the puzzle wings: real flat faces (js/ruin-wall-faces.js), one mesh each in a group
    // flagged ruinFeatureWalls, engraved exactly like the older V50 rooms. Only those groups, never the plain strips or
    // climb markings beside them.
    const featureGroups=[];rec.scene.traverse?.(node=>{if(node.userData?.ruinFeatureWalls===true)featureGroups.push(node);});
    const wallIds=[];
    for(const group of featureGroups){
      root.FurniturePatternSurfaces?.setRuinAwardTarget?.(group,ruin.localeRoot); // Broad wall groups are separate visual subtrees.
      wallIds.push(...(root.FurniturePatternSurfaces?.decorateRuin?.(group,seed,special)||[]));
    }
    const original=ruin.localeRoot.userData||{};
    original.ruinPatternIds=[...new Set([...(original.ruinPatternIds||[]),...ids,...wallIds])];
    ruin.shaftConnection.patternedWallPanels=faces;
    ruin.shaftConnection.patternedPilasters=pillars;
    ruin.shaftConnection.patternIds=ids.length;
    ruin.shaftConnection.patternedFeatureWalls=wallIds.length; // Engraving motifs placed on the shaft's and wings' broad merged stone walls.
    const tick=()=>{
      kanthicFire?.tick(); // Update optional brazier particles and light positions on the existing shaft update cadence.
      const y=Number(getPlayerY?.()); // Match the existing shaft wing rule: floors above the player's feet cannot cover the camera.
      if(!Number.isFinite(y))return;
      for(const [story,group] of floorGroups)
        group.visible=story*hub.options.spacing<=y+.8;
    };
    tick(); // Hide upper-story decorations from the first displayed frame.
    const cleanup=()=>{
      kanthicFire?.dispose(); // Remove Kanthic interaction controls, lights and tower fixtures before scene geometry teardown.
      const engravings=[];for(const group of featureGroups)group.traverse?.(node=>{if(node.userData?.furniturePattern)engravings.push(node);}); // Collected first: removing while traversing would skip siblings.
      for(const node of engravings){ // Engravings are overlay children of the shaft stone; release their own geometry and atlas textures.
        node.parent?.remove(node);node.geometry?.dispose?.();
        for(const mat of Array.isArray(node.material)?node.material:[node.material])if(mat){mat.map?.dispose?.();mat.dispose?.();}
      }
      accents.parent?.remove(accents);
      const geometries=new Set([wallFace,pilaster]),materials=new Set([stone]);
      accents.traverse(node=>{
        if(node.geometry)geometries.add(node.geometry);
        for(const mat of Array.isArray(node.material)?node.material:[node.material])
          if(mat)materials.add(mat);
      });
      geometries.forEach(geometry=>geometry.dispose?.());
      const textures=new Set(); // Each generated V50 engraving gets a PNG/atlas clone; material.dispose alone does not release GPU textures.
      materials.forEach(material=>{if(material.map)textures.add(material.map);material.dispose?.();});
      textures.forEach(texture=>texture.dispose?.());
      floorGroups.clear();floorCounts.clear();
    };
    cleanup.tick=tick; // Reused by the ruin's existing before-render client; never installs another frame loop.
    return cleanup;
  }
  return Object.freeze({apply,lightSources:()=>activeKanthicLights}); // Overlay compositor reads only live Kanthic fixture sources.
});
