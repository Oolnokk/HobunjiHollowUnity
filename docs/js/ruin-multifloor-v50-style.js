// RuinMultifloorV50Style — V50 stone panels and collectible engraving motifs for
// the shaft and hand-built puzzle wings. All physical walls remain on their
// existing voxel grids; these small, non-colliding reliefs are visual only.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinMultifloorV50Style=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  function apply({rec,ruin,hub,seed,THREE,getPlayerY,routeTiles=[]}={}){
    if(!rec?.scene||!ruin?.localeRoot||!hub?.grid||!THREE?.Mesh)
      throw new Error('V50 multifloor wall style needs a mounted scene and shaft grid.');
    const accents=new THREE.Group(); // Owns the V50-style wall reliefs for cleanup on dungeon reroll.
    accents.name='ruin-v50-engraved-masonry';rec.scene.add(accents);
    root.FurniturePatternSurfaces?.setRuinAwardTarget?.(accents,ruin.localeRoot); // Late motifs grant to the playable ruin without circular serialized scene data.
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
      const y=Number(getPlayerY?.()); // Match the existing shaft wing rule: floors above the player's feet cannot cover the camera.
      if(!Number.isFinite(y))return;
      for(const [story,group] of floorGroups)
        group.visible=story*hub.options.spacing<=y+.8;
    };
    tick(); // Hide upper-story decorations from the first displayed frame.
    const cleanup=()=>{
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
  return Object.freeze({apply});
});
