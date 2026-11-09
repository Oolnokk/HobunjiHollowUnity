// Visual-only root-snare finishing throw. Mesh snapshots never move, reparent,
// dispose, or alter the character's actual skinned avatar or gameplay state.
((root)=>{
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function cloneMaterial(material){
    // Each thrown mesh owns its material, but deliberately shares read-only textures
    // with the original. Disposing a throw must never dispose an avatar texture.
    const copy=material?.clone?.();
    if(!copy||copy===material)throw Error('Root snare cannot safely copy a material without its own instance');
    copy.skinning=false;return copy;
  }
  function snapshotGeometry(T,node){
    const geometry=node.geometry?.clone?.();
    if(!geometry)return null;
    if(node.isSkinnedMesh){
      // Bake the current bone pose into standalone vertices so thrown graphics
      // cannot keep following live player/NPC bones after the grab is released.
      const skin=node.applyBoneTransform||node.boneTransform;
      const attr=geometry.getAttribute('position');
      if(!skin||!attr){
        geometry.dispose();
        throw Error('Cannot snapshot skinned root-snare fragment without vertex skinning');
      }
      node.skeleton?.update?.();
      const position=new T.Vector3();
      for(let i=0;i<attr.count;i++){
        position.fromBufferAttribute(node.geometry.getAttribute('position'),i);
        skin.call(node,i,position);
        attr.setXYZ(i,position.x,position.y,position.z);
      }
      attr.needsUpdate=true;
      if(geometry.getAttribute('normal'))geometry.computeVertexNormals();
      // The copied object is a plain Mesh: skin indices/bones are not retained.
      geometry.deleteAttribute('skinIndex');
      geometry.deleteAttribute('skinWeight');
    }
    return geometry;
  }
  function disposeRenderables(scene){
    // A partially constructed snapshot must not leak if a later mesh fails.
    scene.traverse(node=>{
      node.geometry?.dispose?.();
      const materials=Array.isArray(node.material)?node.material:[node.material];
      for(const material of materials)material?.dispose?.();
    });
  }
  function snapshotPart(T,parent,source,label){
    const sourceInverse=source.matrixWorld.clone().invert(),parentInverse=parent.matrixWorld.clone().invert();
    const appearance=new T.Group();appearance.name=label+' baked renderables';
    let count=0;
    try{source.traverse(node=>{
      if(!node.isMesh&&!node.isLine&&!node.isPoints)return;
      let visible=true;
      for(let p=node;p&&p!==source.parent;p=p.parent)if(!p.visible){visible=false;break;}
      if(!visible||!node.geometry)return;
      const geometry=snapshotGeometry(T,node);
      if(!geometry)return;
      const materials=Array.isArray(node.material)?node.material.map(cloneMaterial):cloneMaterial(node.material);
      const copy=node.isPoints?new T.Points(geometry,materials):
        node.isLineSegments?new T.LineSegments(geometry,materials):
        node.isLine?new T.Line(geometry,materials):new T.Mesh(geometry,materials);
      copy.name='Toss-only '+(node.name||node.type);
      const relative=new T.Matrix4().multiplyMatrices(sourceInverse,node.matrixWorld);
      relative.decompose(copy.position,copy.quaternion,copy.scale);
      copy.renderOrder=node.renderOrder;
      copy.frustumCulled=false;
      copy.castShadow=node.castShadow;copy.receiveShadow=node.receiveShadow;
      appearance.add(copy);count++;
    });}catch(error){disposeRenderables(appearance);throw error;}
    if(!count){throw Error('Root snare '+label+' has no visible renderable geometry');}
    const transform=new T.Matrix4().multiplyMatrices(parentInverse,source.matrixWorld);
    const cloneRoot=new T.Group();cloneRoot.name=label+' visual-only snapshot';
    transform.decompose(cloneRoot.position,cloneRoot.quaternion,cloneRoot.scale);
    cloneRoot.add(appearance);
    // Rotate about the actual center of each half, not about the NPC's feet.
    const worldBounds=new T.Box3().setFromObject(source);
    const centerLocal=parent.worldToLocal(worldBounds.getCenter(new T.Vector3()));
    const pivot=new T.Group();pivot.name=label+' flying visual clone';
    pivot.position.copy(centerLocal);parent.add(pivot);
    cloneRoot.position.sub(centerLocal);
    pivot.add(cloneRoot);
    return {pivot,renderables:count,velocity:new T.Vector3(),spin:new T.Vector3(),bounces:0,landed:false};
  }
  function create({THREE,parent,upperSource,lowerSource,neckAnchor,feetAnchor,floorY=0}={}){
    if(!THREE||!parent||!upperSource||!lowerSource)throw TypeError('Root snare visual toss needs both rendered halves and their parent');
    const T=THREE,pieces=[];
    parent.updateWorldMatrix(true,true);
    try{
      pieces.push(snapshotPart(T,parent,upperSource,'Upper half'));
      pieces.push(snapshotPart(T,parent,lowerSource,'Lower half'));
    }catch(error){for(const piece of pieces)disposePiece(piece);throw error;}
    // Throw apart in the horizontal direction of the actual opposing root
    // sources; choose a stable diagonal when their anchors are vertically aligned.
    const direction=new T.Vector3().subVectors(neckAnchor?.point||upperSource.position,
      feetAnchor?.point||lowerSource.position);
    direction.y=0;
    if(direction.lengthSq()<.01)direction.set(.85,0,.52);
    direction.normalize();
    const sideways=new T.Vector3(-direction.z,0,direction.x);
    pieces[0].velocity.copy(direction).multiplyScalar(3.4).addScaledVector(sideways,1.2);
    pieces[1].velocity.copy(direction).multiplyScalar(-3.1).addScaledVector(sideways,-1.1);
    pieces[0].velocity.y=3.5;pieces[1].velocity.y=2.8;
    pieces[0].spin.set(6.8,2.1,4.2);
    pieces[1].spin.set(-6.2,-1.7,-4.8);
    const ground=Number.isFinite(Number(floorY))?Number(floorY):0;
    let age=0,closed=false;
    function disposePiece(piece){
      if(!piece)return;
      if(piece.pivot)disposeRenderables(piece.pivot); // Only copied geometry and material; source textures stay alive.
      piece.pivot?.parent?.remove(piece.pivot);
    }
    function update(dt){
      if(closed)return false;
      const step=clamp(Number(dt)||0,0,.05);
      if(!step)return false;
      age+=step;
      for(const piece of pieces){
        if(piece.landed)continue;
        piece.pivot.position.addScaledVector(piece.velocity,step);
        piece.velocity.y-=11*step;
        piece.velocity.x*=1-.14*step;piece.velocity.z*=1-.14*step;
        piece.pivot.rotation.x+=piece.spin.x*step;
        piece.pivot.rotation.y+=piece.spin.y*step;
        piece.pivot.rotation.z+=piece.spin.z*step;
        const bounds=new T.Box3().setFromObject(piece.pivot);
        if(piece.velocity.y<=0&&bounds.min.y<=ground){
          piece.pivot.position.y+=ground-bounds.min.y;
          piece.bounces++;
          piece.velocity.y=piece.bounces<3&&Math.abs(piece.velocity.y)>1.2?-piece.velocity.y*.24:0;
          piece.velocity.x*=.55;piece.velocity.z*=.55;
          piece.spin.multiplyScalar(.43);
          if(!piece.velocity.y)piece.landed=true;
        }
      }
      return true;
    }
    function dispose(){if(closed)return;closed=true;for(const piece of pieces)disposePiece(piece);}
    return {pieces,update,dispose,diagnostics:()=>({age,closed,pieces:pieces.map(p=>({
      name:p.pivot.name,renderables:p.renderables,landed:p.landed,bounces:p.bounces,
      position:p.pivot.position.toArray(),rotation:p.pivot.rotation.toArray().slice(0,3)
    }))})};
  }
  root.RootSnareToss=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
