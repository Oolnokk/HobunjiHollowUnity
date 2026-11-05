// RuinMultifloorV50Style — V50 stone panels and collectible engraving motifs for
// the shaft and hand-built puzzle wings. All physical walls remain on their
// existing voxel grids; these small, non-colliding reliefs are visual only.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinMultifloorV50Style=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  function apply({rec,ruin,hub,seed,THREE}={}){
    if(!rec?.scene||!ruin?.localeRoot||!hub?.grid||!THREE?.Mesh)
      throw new Error('V50 multifloor wall style needs a mounted scene and shaft grid.');
    const accents=new THREE.Group(); // Owns the V50-style wall reliefs for cleanup on dungeon reroll.
    accents.name='ruin-v50-engraved-masonry';rec.scene.add(accents);
    const stone=root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',
      materialFillMode:'never',color:'#7a746b',
    })||new THREE.MeshBasicMaterial({color:0x7a746b}); // Same shared material factory and stone texture as original V50 walls.
    const wallFace=new THREE.BoxGeometry(.89,1.64,.055); // Thin geometry supports the existing engraving projection, rather than a new shader.
    const pilaster=new THREE.BoxGeometry(.35,2.25,.22); // Repeats the V50 narrow pillar rhythm along otherwise featureless corridor walls.
    const matrix=new THREE.Matrix4(),world=new THREE.Matrix4(),point=new THREE.Vector3();
    let faces=0,pillars=0; // Exposed in the mobile ruin badge to confirm themed wall pieces were built.
    function panel(x,y,z,aroundY=0,isPillar=false){
      const mesh=new THREE.Mesh(isPillar?pilaster:wallFace,stone);
      mesh.name=isPillar?'v50 ruin wall pillar':'v50 ruin wall panel';
      mesh.userData.interiorRuinRole=isPillar?'pillar':'wall';
      mesh.userData.devRuinFootprintIgnore=true;
      mesh.position.set(x,y,z);mesh.rotation.y=aroundY;
      accents.add(mesh);
      if(isPillar)pillars++;else faces++;
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
        const floorSet=rec.floorSet; // Position V50 engravings on the walkable side of the existing wall, not its outside face.
        const onMinus=alongX?floorSet.has(cellX+','+(cellZ-1))
          :floorSet.has((cellX-1)+','+cellZ);
        const onPlus=alongX?floorSet.has(cellX+','+cellZ)
          :floorSet.has(cellX+','+cellZ);
        const direction=onMinus&&!onPlus?-1:1;
        const offset=direction*.095;
        panel(point.x+(alongZ?offset:0),point.y,point.z+(alongX?offset:0),yaw);
        if(i%32===3)panel(point.x+(alongZ?direction*.17:0),point.y,
          point.z+(alongX?direction*.17:0),yaw,true);
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
          panel(x,y,z,yaw);
          if(((c+r+story) % 4)===0)panel(x+dx*.055,y,z+dz*.055,yaw,true);
        }
      }
    }
    const special=ruin.specialBoss?{
      specialBoss:true,
      patternId:ruin.specialGlyph,
      ink:ruin.specialBodyColor3,
    }:undefined; // Named-lich masonry shares the original wall-ink selection.
    const ids=root.FurniturePatternSurfaces?.decorateRuin?.(accents,seed,special)||[];
    const original=ruin.localeRoot.userData||{};
    original.ruinPatternIds=[...new Set([...(original.ruinPatternIds||[]),...ids])];
    ruin.shaftConnection.patternedWallPanels=faces;
    ruin.shaftConnection.patternedPilasters=pillars;
    ruin.shaftConnection.patternIds=ids.length;
    return ()=>{
      accents.parent?.remove(accents);
      const geometries=new Set([wallFace,pilaster]),materials=new Set([stone]);
      accents.traverse(node=>{
        if(node.geometry)geometries.add(node.geometry);
        for(const mat of Array.isArray(node.material)?node.material:[node.material])
          if(mat)materials.add(mat);
      });
      geometries.forEach(geometry=>geometry.dispose?.());
      materials.forEach(material=>material.dispose?.());
    };
  }
  return Object.freeze({apply});
});
