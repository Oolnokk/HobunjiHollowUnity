// Builds furniture meshes from primitive part recipes (boxes/cylinders/discs/tapered
// legs) instead of loading GLB models. Recipes use the same part schema authored in
// docs/tools/furniture-avatar-author/index.html: { kind, transform:{x,y,z,rx,ry,rz,sx,sy,sz},
// topScaleX/Z, bottomScaleX/Z, segments, tint|color }. A recipe's local origin (0,0,0) is
// the center of its own footprint at floor level, matching the fw/fd placement convention
// used by docs/game.js and docs/tools/building-interior-author/index.html
// (cx = col + fw/2, cz = row + fd/2).
(function () {
  'use strict';

  const DEG = Math.PI / 180;

  function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  function shade(hex, factor) {
    const h = hex == null ? 0x8b6540 : hex;
    const r = clampByte(((h >> 16) & 255) * factor);
    const g = clampByte(((h >> 8) & 255) * factor);
    const b = clampByte((h & 255) * factor);
    return (r << 16) | (g << 8) | b;
  }

  function resolveColor(part, baseColor) {
    if (typeof part.color === 'number') return part.color;
    if (typeof part.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(part.color)) return parseInt(part.color.slice(1), 16);
    return shade(baseColor, part.tint != null ? part.tint : 1);
  }

  function createTaperedBoxGeometry(part) {
    const t = part.transform;
    const sx = Math.max(0.001, t.sx || 0.001);
    const sy = Math.max(0.001, t.sy || 0.001);
    const sz = Math.max(0.001, t.sz || 0.001);
    const topX = part.topScaleX ?? 1, topZ = part.topScaleZ ?? 1;
    const botX = part.bottomScaleX ?? 1, botZ = part.bottomScaleZ ?? 1;
    const verts = [
      [-0.5 * botX, -0.5, -0.5 * botZ], [0.5 * botX, -0.5, -0.5 * botZ], [0.5 * botX, -0.5, 0.5 * botZ], [-0.5 * botX, -0.5, 0.5 * botZ],
      [-0.5 * topX, 0.5, -0.5 * topZ], [0.5 * topX, 0.5, -0.5 * topZ], [0.5 * topX, 0.5, 0.5 * topZ], [-0.5 * topX, 0.5, 0.5 * topZ],
    ];
    const pos = [];
    verts.forEach(v => pos.push(v[0] * sx, v[1] * sy, v[2] * sz));
    // Outward-facing winding (verified to match the corrected winding used by the
    // furniture-avatar-author authoring tool's tapered-box primitive).
    const idx = [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 5, 1, 0, 4, 5,
      1, 6, 2, 1, 5, 6,
      2, 7, 3, 2, 6, 7,
      3, 4, 0, 3, 7, 4,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return ensureUvs(geo);
  }

  // Per-triangle dominant-axis box-projected UVs — ported from
  // docs/js/procedural-leg-animation.js's generateBoxProjectedUvs (built for
  // the same problem there: imported foot GLBs with no authored UVs).
  // createTaperedBoxGeometry/createTaperedCylinderGeometry only ever set
  // position+index, never uv, since their 8/2N shared vertices can't each
  // carry a single correct UV across the multiple faces they belong to —
  // this expands to non-indexed (one vertex per triangle-corner, matching
  // how computeVertexNormals already effectively treats a shared-vertex cube
  // as smooth-shaded, unchanged) and derives UVs from each triangle's own
  // dominant normal axis instead of requiring a hand-authored unwrap.
  function ensureUvs(geo) {
    const position = geo.getAttribute('position');
    if (!position) return geo;
    if (geo.getAttribute('uv')) return geo;
    const projected = geo.index ? geo.toNonIndexed() : geo;
    const pos = projected.getAttribute('position');
    projected.computeBoundingBox();
    const box = projected.boundingBox;
    const sizeX = Math.max(1e-6, box.max.x - box.min.x);
    const sizeY = Math.max(1e-6, box.max.y - box.min.y);
    const sizeZ = Math.max(1e-6, box.max.z - box.min.z);
    const uv = new Float32Array(pos.count * 2);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    for (let first = 0; first + 2 < pos.count; first += 3) {
      a.fromBufferAttribute(pos, first);
      b.fromBufferAttribute(pos, first + 1);
      c.fromBufferAttribute(pos, first + 2);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      n.crossVectors(e1, e2).normalize();
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const dominant = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
      for (let corner = 0; corner < 3; corner++) {
        const v = corner === 0 ? a : corner === 1 ? b : c;
        let u, vv;
        if (dominant === 'x') { u = (v.z - box.min.z) / sizeZ; vv = (v.y - box.min.y) / sizeY; if (n.x < 0) u = 1 - u; }
        else if (dominant === 'y') { u = (v.x - box.min.x) / sizeX; vv = (v.z - box.min.z) / sizeZ; if (n.y > 0) vv = 1 - vv; }
        else { u = (v.x - box.min.x) / sizeX; vv = (v.y - box.min.y) / sizeY; if (n.z > 0) u = 1 - u; }
        const t = (first + corner) * 2;
        uv[t] = u; uv[t + 1] = vv;
      }
    }
    projected.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return projected;
  }

  function createTaperedCylinderGeometry(part) {
    const t = part.transform;
    const seg = Math.max(3, Math.min(64, Math.round(part.segments || 16)));
    const sx = Math.max(0.001, t.sx || 0.001);
    const sy = Math.max(0.001, t.sy || 0.001);
    const sz = Math.max(0.001, t.sz || 0.001);
    const topX = part.topScaleX ?? 1, topZ = part.topScaleZ ?? 1;
    const botX = part.bottomScaleX ?? 1, botZ = part.bottomScaleZ ?? 1;
    const pos = [];
    const idx = [];
    const add = (x, y, z) => { pos.push(x * sx, y * sy, z * sz); return pos.length / 3 - 1; };
    const bot = [], top = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      bot.push(add(Math.cos(a) * 0.5 * botX, -0.5, Math.sin(a) * 0.5 * botZ));
      top.push(add(Math.cos(a) * 0.5 * topX, 0.5, Math.sin(a) * 0.5 * topZ));
    }
    const cb = add(0, -0.5, 0);
    const ct = add(0, 0.5, 0);
    for (let i = 0; i < seg; i++) {
      const n = (i + 1) % seg;
      idx.push(bot[i], top[n], bot[n]);
      idx.push(bot[i], top[i], top[n]);
      // Cap fans wind opposite to the side quads' i/n order so their normals
      // point outward (down for the bottom cap, up for the top) rather than
      // facing into the solid — backwards here left both caps back-face
      // culled from their own outward side, e.g. a flat disc's top surface
      // (mostly cap, negligible side wall) rendering as a hole showing the
      // clear-color background straight through it.
      idx.push(cb, bot[i], bot[n]);
      idx.push(ct, top[n], top[i]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return ensureUvs(geo);
  }

  // Ring shape for 'hoop' parts (barrel/vat bands) — sx/sz set the outer
  // diameter, sy sets the tube (band) thickness relative to that diameter.
  function createHoopGeometry(part) {
    const t = part.transform;
    const seg = Math.max(3, Math.min(64, Math.round(part.segments || 16)));
    const outerRadius = 0.5 * Math.max(t.sx || 0.001, t.sz || 0.001);
    const tubeRadius = Math.max(0.001, (t.sy || 0.05) * 0.5);
    const geo = new THREE.TorusGeometry(Math.max(0.001, outerRadius - tubeRadius), tubeRadius, Math.max(4, Math.round(seg / 2)), seg);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  function partMaterial(part, baseColor) {
    const color = resolveColor(part, baseColor); // Preserves the existing authored/fallback color contract for both lit and explicitly-unlit furniture.
    if (part.materialLighting !== 'unlit') return new THREE.MeshLambertMaterial({ color });
    const pngSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit; // Same canonical unlit PNG material factory used by farm-cliff natural surfaces after the old Banubu cave Lambert regression.
    const overrides = {
      color,
      transparent: false,
      alphaTest: 0,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
      opacity: 1,
    };
    const mat = typeof pngSurface?.makeMaterial === 'function'
      ? pngSurface.makeMaterial(THREE, null, `furniture_${part.name || part.kind}_unlit`, overrides)
      : new THREE.MeshBasicMaterial(overrides);
    mat.userData = Object.assign({}, mat.userData, { authoredFurnitureLighting: 'unlit' });
    return mat;
  }

  function applyAuthoredSurfaceMapping(mesh, part) {
    if (part.materialUvMapping !== 'connected-surface-stretch') return false;
    const mapper = window.HobunjiSurfaceStretchUV; // Reuses the exact connected-surface detector/stretch mapper that fixed Banubu's cave instead of inventing a second furniture UV algorithm.
    if (typeof mapper?.mapMesh !== 'function') return false;
    const maxPatchWorldSize = Math.max(0.1, Number(part.materialUvMaxPatchWorldSize) || 6);
    const report = mapper.mapMesh(mesh, {
      label: `furniture:${part.name || part.kind}:connected-surface`,
      maxPatchWorldSize,
    });
    if (!report) return false;
    mesh.userData = Object.assign({}, mesh.userData, {
      authoredFurnitureSurfaceMapping: 'connected-surface-stretch',
      authoredFurnitureSurfaceMaxPatchWorldSize: maxPatchWorldSize,
    });
    return true;
  }

  // Authored surfaceOpacity < 1 makes the part body see-through (0 = fully
  // hidden) while its decals, which are child meshes, stay visible — e.g. a
  // lone glowing seal with no plate around it.
  function applySurfaceOpacity(mat, part) {
    const opacity = Number(part?.surfaceOpacity);
    if (!Number.isFinite(opacity) || opacity >= 1) return;
    mat.transparent = true;
    mat.opacity = Math.max(0, opacity);
    mat.depthWrite = opacity > .5;
    if (opacity <= 0) mat.colorWrite = false;
  }

  const glbTemplates = new Map(); // Shared decoded templates; instances clone geometry/materials before applying furniture edits.
  function loadFurnitureGlb(path) {
    if (!glbTemplates.has(path)) glbTemplates.set(path, new Promise((resolve, reject) => {
      if (!THREE.GLTFLoader) { reject(new Error('GLTFLoader unavailable')); return; }
      new THREE.GLTFLoader().load(path, gltf => resolve(gltf.scene), undefined, reject);
    }));
    return glbTemplates.get(path);
  }
  // The roof shingle GLB is drawn through HousePieceGen's shingle pipeline (bone-aligned,
  // surface-mapped geometry and the farm roofs' tinted material) so windmill blades match
  // every roof. The raw GLB has no UVs, near-black vertex colours and full metalness.
  const ROOF_SHINGLE_GLB = /(?:^|\/)HighlandLongshingle_boned\.glb$/i;
  function loadRoofShingle(path) {
    const gen = window.HousePieceGen;
    if (!ROOF_SHINGLE_GLB.test(path) || typeof gen?.makeShingleModel !== 'function') return null;
    return gen.loadShingleGlb().then(() => gen.makeShingleModel('farm'));
  }
  function attachGlb(mesh, part, baseColor) {
    const path = /^(?:https?:|data:|blob:|\/)/.test(part.modelPath || '') ? part.modelPath : (window.__hobunjiFurnitureAssetBase || 'assets/') + String(part.modelPath || '').replace(/^assets\//, ''); // Runtime and isolated editor resolve the same saved model identity.
    (loadRoofShingle(path) || loadFurnitureGlb(path).then(template => template.clone(true))).then(instance => {
      if (mesh.userData.glbDisposed) return; // A world reset/move can dispose the owner while the GLB is still loading.
      // Cached materials/geometries are never mutated or disposed by a furniture instance.
      const convertedSkins=[];let sourceMeshIndex=0; // Converted model parts keep stable source keys under the same animated GLB owner.
      instance.traverse(child => {
        if (/^(?:shinglebone|.*_bone|bone)$/i.test(child.name || '')) child.visible = false;
        if (!child.isMesh) return;
        child.userData.rockSourceKey=String(sourceMeshIndex++);
        if (child.userData.sharedShingle&&!part.rockShape?.enabled) { child.castShadow = child.receiveShadow = true; return; } // Keeps the roofs' shared look unless this furniture explicitly requests stone.
        child.geometry = child.geometry.clone();
        if(part.rockShape?.enabled){const original=child.geometry;rockSourceGeometries.set(child,original.clone());child.geometry=createRockGeometry(original,part.rockShape,child.userData.rockSourceKey);original.dispose();if(child.isSkinnedMesh)convertedSkins.push(child);}
        const color = material => {const result = material.clone(); result.color?.set(resolveColor(part, baseColor)); if (part.materialTexture) applyPartTexture(result, part); return result; }; // Existing per-part furniture texture/color pipeline.
        child.material = part.rockShape?.enabled?makePartMaterial(rockMaterialPart(part),baseColor):Array.isArray(child.material) ? child.material.map(color) : color(child.material);
        child.castShadow = child.receiveShadow = true;
      });
      for(const skin of convertedSkins){
        const stone=new THREE.Mesh(skin.geometry,skin.material); // Rigid furniture animation still targets the original wrapper; rocks need no missing skin vertex attributes.
        stone.name=skin.name;stone.position.copy(skin.position);stone.quaternion.copy(skin.quaternion);stone.scale.copy(skin.scale);stone.visible=skin.visible;
        stone.castShadow=stone.receiveShadow=true;stone.userData={...skin.userData,rockShape:true};
        rockSourceGeometries.set(stone,rockSourceGeometries.get(skin));
        for(const child of [...skin.children])stone.add(child);
        skin.parent.add(stone);skin.parent.remove(skin);
      }
      instance.updateMatrixWorld(true);
      const box = new THREE.Box3(); // Visible geometry only; the hidden alignment bone cannot inflate the model bounds.
      instance.traverse(child => { if (child.isMesh && child.visible) { child.geometry.computeBoundingBox(); box.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld)); } });
      if (box.isEmpty()) throw new Error('GLB has no visible geometry');
      const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()); // Imported model fills authored X/Y/Z dimensions independently.
      const holder = new THREE.Group(); holder.scale.set(part.transform.sx / Math.max(.001, size.x), part.transform.sy / Math.max(.001, size.y), part.transform.sz / Math.max(.001, size.z)); // Geometry stays centered like every other furniture part.
      instance.position.sub(center); holder.add(instance); mesh.add(holder);
      mesh.material.colorWrite = false; mesh.material.depthWrite = false; mesh.castShadow = false; mesh.receiveShadow = false; // Keeps a tiny renderable driver for existing rigid-piece animation hooks.
      mesh.userData.glbReady = true;
      mesh.userData.onRockSourceReady?.(); // Resolve contacts against real imported geometry after all asynchronous model parts become available.
    }).catch(error => { mesh.userData.glbError = String(error); window.__farmLog?.('Furniture GLB: ' + error.message, 'error'); });
  }

  // Same central barrel shoulder and hollow cup interior as the Furniture Author.
  // Generic tapered cylinders made authored Shattercask necks look capped and
  // collapsed the rounded barrel body to a straight cone.
  function createAuthoredVesselGeometry(part) {
    const t=part.transform,segments=Math.max(3,Math.min(64,Math.round(part.segments||20)));
    const sx=Math.max(.001,t.sx),sy=Math.max(.001,t.sy),sz=Math.max(.001,t.sz);
    const at=(x,y,z)=>part.taperAxis==='x'?new THREE.Vector3(y*sx,x*sy,z*sz)
      :part.taperAxis==='z'?new THREE.Vector3(x*sx,z*sy,y*sz):new THREE.Vector3(x*sx,y*sy,z*sz);
    const topX=part.topScaleX??1,topZ=part.topScaleZ??1,botX=part.bottomScaleX??1,botZ=part.bottomScaleZ??1;
    const skewX=part.topSkewX||0,skewZ=part.topSkewZ||0;
    const pos=[],uv=[],origin=new THREE.Vector3(),tile=part.textureTileSize||1;
    const face=(vertices,reference=origin)=>{
      const c=new THREE.Vector3();
      for(const v of vertices)c.add(v);
      c.multiplyScalar(1/vertices.length).sub(reference);
      const n=new THREE.Vector3().subVectors(vertices[1],vertices[0])
        .cross(new THREE.Vector3().subVectors(vertices[2],vertices[0]));
      return n.dot(c)<0?[vertices[0],...vertices.slice(1).reverse()]:vertices;
    };
    const quad=(a,b,c,d,reference=origin)=>{
      const v=face([a,b,c,d],reference);
      const u=v[0].distanceTo(v[1])/tile,w=v[0].distanceTo(v[3])/tile;
      for(const k of [0,1,2,0,2,3])pos.push(v[k].x,v[k].y,v[k].z);
      uv.push(0,0,u,0,u,w,0,0,u,w,0,w);
    };
    const tri=(a,b,c,reference=origin)=>{
      const v=face([a,b,c],reference),u=v[0].distanceTo(v[1])/tile,w=v[0].distanceTo(v[2])/tile;
      for(const p of v)pos.push(p.x,p.y,p.z);
      uv.push(0,0,u,0,0,w);
    };
    const bottom=[],top=[],middle=[],innerFloor=[],innerTop=[];
    const isCup=part.kind==='cup',inner=Math.max(.05,Math.min(.95,Number(part.innerScale)||.78));
    const basin=Math.max(.03,Math.min(.8,Number(part.basinDepth??.18)));
    for(let i=0;i<segments;i++){
      const angle=i/segments*Math.PI*2,c=Math.cos(angle)*.5,z=Math.sin(angle)*.5;
      bottom.push(at(c*botX,-.5,z*botZ));
      top.push(at(c*topX+skewX,.5,z*topZ+skewZ));
      if(isCup){
        innerFloor.push(at(c*(botX+(topX-botX)*basin)*inner+skewX*basin,-.5+basin,z*(botZ+(topZ-botZ)*basin)*inner+skewZ*basin));
        innerTop.push(at(c*topX*inner+skewX,.5,z*topZ*inner+skewZ));
      }else middle.push(at(c,0,z));
    }
    const bottomCenter=at(0,-.5,0),topCenter=at(skewX,.5,skewZ);
    const below=at(0,-2,0),above=at(0,2,0),floor=at(skewX*basin,-.5+basin,skewZ*basin);
    for(let i=0;i<segments;i++){
      const n=(i+1)%segments;
      if(isCup){
        quad(bottom[i],bottom[n],top[n],top[i]);
        const innerRef=innerFloor[i].clone().add(innerFloor[n]).add(innerTop[n]).add(innerTop[i]).multiplyScalar(.5);
        quad(innerFloor[n],innerFloor[i],innerTop[i],innerTop[n],innerRef);
        quad(top[i],top[n],innerTop[n],innerTop[i],below);
        tri(floor,innerFloor[i],innerFloor[n],below);
        tri(bottomCenter,bottom[n],bottom[i],above);
      }else{
        quad(bottom[i],bottom[n],middle[n],middle[i]);
        quad(middle[i],middle[n],top[n],top[i]);
        tri(bottomCenter,bottom[i],bottom[n]);
        tri(topCenter,top[n],top[i]);
      }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geo.computeVertexNormals();
    return geo;
  }

  function rockMaterialPart(part) {
    return {...part,color:'#808080',materialRole:'stone',materialTexture:'carved_smooth.png',
      materialCapTexture:null,materialFillEnabled:true,materialFillColor:'#808080',materialFillMode:'always',
      materialLighting:'unlit',surfaceOpacity:1,textureTransparent:false,patternSurfaces:[]}; // Keep the authored source finish intact so the editor can restore it.
  }
  const rockSourceGeometries=new WeakMap(); // Keep original CPU geometry outside serializable userData so contact detection never samples an already-rounded rock.
  function rockSourceRecords(meshById,parts){
    const records=[]; // All positions are measured in the furniture's authored rest frame, independent of active animations.
    for(const part of parts){
      const owner=meshById.get(part.id);if(!owner)continue;
      owner.updateWorldMatrix(true,true);
      const t=part.transform||{};
      const authored=new THREE.Matrix4().compose(new THREE.Vector3(t.x||0,t.y||0,t.z||0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((t.rx||0)*DEG,(t.ry||0)*DEG,(t.rz||0)*DEG)),new THREE.Vector3(1,1,1));
      owner.traverse(mesh=>{
        if(!mesh.isMesh||mesh.userData?.furnitureGlbPart||mesh!==owner&&(part.kind!=='glb'||mesh.visible===false||mesh.userData?.rockSourceKey==null))return;
        const geometry=rockSourceGeometries.get(mesh)||mesh.geometry; // Unconverted neighboring pieces also support rock joints.
        if(!geometry?.getAttribute('position'))return;
        geometry.computeBoundingBox();
        const matrix=authored.clone(),key=mesh===owner?'body':mesh.userData.rockSourceKey;
        if(mesh!==owner){const relative=mesh.matrix.clone();for(let parent=mesh.parent;parent&&parent!==owner;parent=parent.parent)relative.premultiply(parent.matrix);matrix.multiply(relative);} // Local ancestor matrices avoid animation-dependent floating-point cancellation in world inverses.
        records.push({part,mesh,geometry,matrix,key,bounds:geometry.boundingBox.clone().applyMatrix4(matrix),planes:new Map()});
      });
    }
    return records;
  }
  function rockTriangles(record){
    if(record.triangles)return record.triangles;
    const geometry=record.geometry,positions=geometry.getAttribute('position'),index=geometry.index;
    const size=geometry.boundingBox.getSize(new THREE.Vector3()),center=geometry.boundingBox.getCenter(new THREE.Vector3()),triangles=[]; // Local normalized planes remain valid when a saved piece is resized.
    for(let offset=0;offset+2<(index?index.count:positions.count);offset+=3){
      const local=[0,1,2].map(corner=>new THREE.Vector3().fromBufferAttribute(positions,index?index.getX(offset+corner):offset+corner));
      const points=local.map(point=>point.clone().applyMatrix4(record.matrix)),triangle=new THREE.Triangle(...points);
      if(triangle.getArea()<1e-12)continue;
      const normalized=local.map(point=>new THREE.Vector3(size.x?(point.x-center.x)/size.x:0,size.y?(point.y-center.y)/size.y:0,size.z?(point.z-center.z)/size.z:0));
      const normal=new THREE.Triangle(...normalized).getNormal(new THREE.Vector3()),offsetPlane=normal.dot(normalized[0]);
      triangles.push({triangle,points,sourceFace:offset/3,bounds:new THREE.Box3().setFromPoints(points),plane:{source:record.key,normal:normal.toArray(),offset:offsetPlane}});
    }
    record.triangles=triangles;return triangles;
  }
  function applyRockContacts(meshById,parts,options={}){
    if(!parts.some(part=>part.rockShape?.enabled))return {contacts:0,protectedFaces:0};
    const records=rockSourceRecords(meshById,parts),epsilon=.0001,epsilonSq=epsilon*epsilon; // Exact face contacts/intersections count; nearby disconnected surfaces do not.
    const closest=new THREE.Vector3(),direction=new THREE.Vector3(),onRay=new THREE.Vector3(),onEdge=new THREE.Vector3(),ray=new THREE.Ray();
    const touch=(a,b)=>{
      if(!a.bounds.clone().expandByScalar(epsilon).intersectsBox(b.bounds))return false;
      for(const point of a.points){b.triangle.closestPointToPoint(point,closest);if(point.distanceToSquared(closest)<=epsilonSq)return true;}
      for(const point of b.points){a.triangle.closestPointToPoint(point,closest);if(point.distanceToSquared(closest)<=epsilonSq)return true;}
      for(const [from,to] of [[a,b],[b,a]])for(let edge=0;edge<3;edge++){
        const origin=from.points[edge],end=from.points[(edge+1)%3],length=direction.subVectors(end,origin).length();
        if(length<epsilon)continue;
        ray.set(origin,direction.multiplyScalar(1/length));
        const hit=ray.intersectTriangle(...to.points,false,closest);
        if(hit&&origin.distanceToSquared(hit)<=(length+epsilon)**2)return true;
        for(let other=0;other<3;other++)if(ray.distanceSqToSegment(to.points[other],to.points[(other+1)%3],onRay,onEdge)<=epsilonSq&&origin.distanceToSquared(onRay)<=(length+epsilon)**2)return true;
      }
      return false;
    };
    const protect=(record,face,other,neighbor)=>{
      if(!record.part.rockShape?.enabled)return;
      const patch=face.bounds.clone().expandByScalar(epsilon).intersect(other.bounds.clone().expandByScalar(epsilon)).applyMatrix4(record.matrix.clone().invert()); // Preserve the joint patch, rather than straightening the full length of an embedded leg.
      const size=record.geometry.boundingBox.getSize(new THREE.Vector3()),center=record.geometry.boundingBox.getCenter(new THREE.Vector3());
      const normalized=point=>[size.x?(point.x-center.x)/size.x:0,size.y?(point.y-center.y)/size.y:0,size.z?(point.z-center.z)/size.z:0];
      const plane={...face.plane,sourceFaces:[face.sourceFace],min:normalized(patch.min),max:normalized(patch.max)},key=plane.normal.map(value=>value.toFixed(5)).join(',')+':'+plane.offset.toFixed(5)+':'+neighbor,previous=record.planes.get(key);
      if(previous){plane.sourceFaces=[...new Set([...previous.sourceFaces,face.sourceFace])];plane.min=plane.min.map((value,axis)=>Math.min(value,previous.min[axis]));plane.max=plane.max.map((value,axis)=>Math.max(value,previous.max[axis]));}
      record.planes.set(key,plane);
    };
    let contacts=0; // Build-time diagnostics, never a per-frame collision query.
    for(let a=0;a<records.length;a++)for(let b=a+1;b<records.length;b++){
      const first=records[a],second=records[b];
      if(!first.part.rockShape?.enabled&&!second.part.rockShape?.enabled||!first.bounds.clone().expandByScalar(epsilon).intersectsBox(second.bounds))continue;
      const left=rockTriangles(first).filter(face=>face.bounds.clone().expandByScalar(epsilon).intersectsBox(second.bounds));
      const right=rockTriangles(second).filter(face=>face.bounds.clone().expandByScalar(epsilon).intersectsBox(first.bounds));
      for(const face of left)for(const other of right)if(touch(face,other)){
        protect(first,face,other,b);protect(second,other,face,a);contacts++;
      }
    }
    const facesByPart=new Map(); // Save only compact contact planes; animation records and original source definitions remain intact.
    for(const record of records){const faces=facesByPart.get(record.part.id)||[];if(record.part.rockShape?.enabled)faces.push(...record.planes.values());facesByPart.set(record.part.id,faces);}
    let protectedFaces=0; // Count active attachment groups for the editor diagnostics.
    for(const record of records)if(record.part.rockShape?.enabled){
      const faces=facesByPart.get(record.part.id)||[],settings={...record.part.rockShape,contactFaces:faces};
      const geometry=createRockGeometry(record.geometry,settings,record.key); // Extend joint surfaces after final bounds fitting, so refitting cannot open the joint again.
      if(Array.isArray(record.mesh.material))for(const group of record.mesh.geometry.groups.length?record.mesh.geometry.groups:[{start:0,count:geometry.getAttribute('position').count,materialIndex:0}])geometry.addGroup(group.start,group.count,group.materialIndex); // Retain the editor's material/picking groups on replacement geometry.
      record.mesh.geometry.dispose();record.mesh.geometry=geometry;
      const activeFaces=getRockContactArea(settings)>0?record.planes.size:0; // A zero area keeps all of the unconstrained rock shape.
      record.mesh.userData.rockContactFaceCount=activeFaces;protectedFaces+=activeFaces;
      if(options.persist)record.part.rockShape={...record.part.rockShape,contactFaces:faces}; // Only the editor opts into modifying its owned recipe.
    }
    return {contacts,protectedFaces};
  }
  function getRockContactArea(settings={}){
    const value=Number(settings?.contactArea??.35); // Shared default/validation for saved recipes and editor diagnostics.
    return Number.isFinite(value)?Math.max(0,Math.min(1,value)):.35;
  }
  function createRockGeometry(source,settings={},sourceKey='body') {
    const terrain=window.TerrainPreview; // The same seeded boulder-mound solver used by terrain/cavern previews supplies the stone lobes.
    if(!terrain?.buildRockMoundBumpField||!terrain?.sampleRockMoundBump)throw new Error('Rock conversion requires TerrainPreview.');
    const input=source.index?source.toNonIndexed():source.clone(); // Never mutate cached GLB/primitive buffers.
    input.computeBoundingBox();
    const bounds=input.boundingBox.clone(),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()); // Preserve each original piece's dimensions and local pivot.
    if(!Number.isFinite(size.x+size.y+size.z)||Math.max(size.x,size.y,size.z)<=0){input.dispose();throw new Error('The furniture piece has no finite rock shape.');}
    let salt=2166136261; // A saved part ID/seed keeps the same stone shape through exports, animation and rebuilds.
    for(const character of String(settings.seed||'furniture-rock').slice(0,128))salt=Math.imul(salt^character.charCodeAt(0),16777619)>>>0;
    const fields=[0,1,2].map(axis=>terrain.buildRockMoundBumpField(3,3,0,0,(salt+axis*7919)>>>0)); // Triplanar samples avoid seams at coincident vertices.
    const roughness=Number.isFinite(Number(settings.roughness))?Math.max(0,Math.min(1,Number(settings.roughness))):.35; // Thin legs and oversized inputs retain bounded shape changes.
    const sourcePositions=input.getAttribute('position'); // Imported GLBs may use interleaved attributes with no direct .array property.
    let vertices=[]; // Subdivide coarse boxes enough to show lobes without replacing holes or disconnected sections.
    for(let index=0;index<sourcePositions.count;index++)vertices.push(sourcePositions.getX(index),sourcePositions.getY(index),sourcePositions.getZ(index));
    const levels=vertices.length/9<256?2:vertices.length/9<1024?1:0; // At most 4,096 new triangles; detailed imports reuse their existing tessellation.
    for(let level=0;level<levels;level++){
      const next=[]; // Temporary triangle buffer used only while authoring/building.
      for(let offset=0;offset+8<vertices.length;offset+=9){
        const a=vertices.slice(offset,offset+3),b=vertices.slice(offset+3,offset+6),c=vertices.slice(offset+6,offset+9);
        const ab=a.map((value,axis)=>(value+b[axis])*.5),bc=b.map((value,axis)=>(value+c[axis])*.5),ca=c.map((value,axis)=>(value+a[axis])*.5);
        next.push(...a,...ab,...ca,...ab,...b,...bc,...ca,...bc,...c,...ab,...bc,...ca);
      }
      vertices=next;
    }
    const geometry=new THREE.BufferGeometry(); // Rock topology remains under the original independently animated piece owner.
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('rockSourceFace',new THREE.Float32BufferAttribute(Array.from({length:vertices.length/3},(_,index)=>Math.floor(index/(3*4**levels))),1)); // Every child triangle remembers its original surface through subdivision and roughening.
    const positions=geometry.getAttribute('position'); // Deterministic deformation is evaluated once, never during animation frames.
    for(let index=0;index<positions.count;index++){
      const x=size.x>.000001?(positions.getX(index)-center.x)/size.x:0,y=size.y>.000001?(positions.getY(index)-center.y)/size.y:0,z=size.z>.000001?(positions.getZ(index)-center.z)/size.z:0;
      const weight=Math.abs(x)+Math.abs(y)+Math.abs(z)||1;
      const bump=(Math.abs(x)*terrain.sampleRockMoundBump(fields[0],y+.5,z+.5)+Math.abs(y)*terrain.sampleRockMoundBump(fields[1],x+.5,z+.5)+Math.abs(z)*terrain.sampleRockMoundBump(fields[2],x+.5,y+.5))/weight;
      const rounding=1-roughness*.5*Math.max(0,Math.hypot(x,y,z)-.5),scale=rounding*(1+roughness*(bump-.12)); // Rounded edges and the existing rock ridges soften each source silhouette.
      positions.setXYZ(index,center.x+x*size.x*scale,center.y+y*size.y*scale,center.z+z*size.z*scale);
    }
    geometry.computeBoundingBox();
    const rockSize=geometry.boundingBox.getSize(new THREE.Vector3()),rockMin=geometry.boundingBox.min.clone(); // Fit the rough result back to authored bounds so attachments/pivots do not drift.
    for(let index=0;index<positions.count;index++)positions.setXYZ(index,
      rockSize.x>.000001?bounds.min.x+(positions.getX(index)-rockMin.x)*size.x/rockSize.x:center.x,
      rockSize.y>.000001?bounds.min.y+(positions.getY(index)-rockMin.y)*size.y/rockSize.y:center.y,
      rockSize.z>.000001?bounds.min.z+(positions.getZ(index)-rockMin.z)*size.z/rockSize.z:center.z);
    const contactArea=getRockContactArea(settings),patchScale=Math.sqrt(contactArea); // Area changes patch width, not the strength of the attachment.
    const contactFaces=contactArea>0&&Array.isArray(settings.contactFaces)?settings.contactFaces.filter(face=>face?.source===sourceKey&&Array.isArray(face.normal)&&face.normal.length===3&&face.normal.every(Number.isFinite)&&Number.isFinite(face.offset)&&Array.isArray(face.min)&&Array.isArray(face.max)&&face.min.length===3&&face.max.length===3&&[...face.min,...face.max].every(Number.isFinite)).map(face=>{
      const midpoint=face.min.map((value,axis)=>(value+face.max[axis])*.5); // Center each attachment on its original contact region.
      return {...face,min:midpoint.map((value,axis)=>value+(face.min[axis]-value)*patchScale),max:midpoint.map((value,axis)=>value+(face.max[axis]-value)*patchScale)};
    }):[]; // Legacy stretch targets are ignored; source contact patches are the only attachment authority.
    const normalizedAt=index=>[size.x?(vertices[index*3]-center.x)/size.x:0,size.y?(vertices[index*3+1]-center.y)/size.y:0,size.z?(vertices[index*3+2]-center.z)/size.z:0];
    const lockKey=point=>point.map(value=>value.toFixed(7)).join(','),jointVertices=new Set(); // Shared edge vertices must agree across separate non-indexed faces to keep the rock watertight.
    for(let first=0;first+2<positions.count&&contactFaces.length;first+=3){
      const corners=[0,1,2].map(offset=>normalizedAt(first+offset));
      for(const face of contactFaces){
        if(Array.isArray(face.sourceFaces)&&!face.sourceFaces.includes(geometry.getAttribute('rockSourceFace').getX(first)))continue;
        if(!corners.every(point=>Math.abs(face.normal.reduce((sum,value,axis)=>sum+value*point[axis],0)-face.offset)<.00001))continue;
        const patch=Array.isArray(face.min)&&Array.isArray(face.max)&&face.min.length===3&&face.max.length===3&&[...face.min,...face.max].every(Number.isFinite);
        if(patch&&[0,1,2].some(axis=>Math.max(...corners.map(point=>point[axis]))<face.min[axis]||Math.min(...corners.map(point=>point[axis]))>face.max[axis]))continue;
        for(const point of corners)jointVertices.add(lockKey(point)); // Even a small foot between vertices extends its supporting triangle to the joint.
      }
    }
    for(let index=0;index<positions.count&&contactFaces.length;index++){
      const x=vertices[index*3],y=vertices[index*3+1],z=vertices[index*3+2];
      const normalized=[size.x?(x-center.x)/size.x:0,size.y?(y-center.y)/size.y:0,size.z?(z-center.z)/size.z:0];
      let lock=jointVertices.has(lockKey(normalized))?1:0; // Hold the patch in its shared source position; adjacent sides follow the same edge vertices.
      for(const face of contactFaces){let distance=Math.abs(face.normal.reduce((sum,value,axis)=>sum+value*normalized[axis],0)-face.offset);
        for(let axis=0;axis<3;axis++)distance=Math.max(distance,face.min[axis]-normalized[axis],normalized[axis]-face.max[axis]);
        lock=Math.max(lock,Math.max(0,1-distance/.06)); // Blend the attachment into the surrounding rock instead of creating a sharp transition.
      }
      if(lock)positions.setXYZ(index,positions.getX(index)*(1-lock)+x*lock,positions.getY(index)*(1-lock)+y*lock,positions.getZ(index)*(1-lock)+z*lock);
    }
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    input.dispose();
    return ensureUvs(geometry);
  }

  function buildPartMesh(part, baseColor) {
    let geo;
    const t = part.transform;
    if (part.kind === 'glb') {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(.001, .001, .001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); // Animation/picking owner while the bone-hidden model loads.
      mesh.position.set(t.x || 0, t.y || 0, t.z || 0); mesh.rotation.set((t.rx || 0) * DEG, (t.ry || 0) * DEG, (t.rz || 0) * DEG);
      mesh.userData.furnitureGlbPart = true; attachGlb(mesh, part, baseColor); return mesh;
    }
    if (part.kind === 'banner') {
      geo = new THREE.PlaneGeometry(Math.max(.01, t.sx || 1), Math.max(.01, t.sy || 1), 12, 16);
    } else if (part.kind === 'sphere') {
      geo = new THREE.SphereGeometry(0.5 * Math.max(t.sx, t.sy, t.sz), 16, 10);
    } else if (part.kind === 'hoop') {
      geo = createHoopGeometry(part);
    } else if (part.kind === 'barrel' || part.kind === 'cup') {
      geo = createAuthoredVesselGeometry(part);
    } else if (part.kind === 'legRound' || part.kind === 'cylinder' || part.kind === 'disc' || part.kind === 'liquidSurface') {
      geo = createTaperedCylinderGeometry(part);
    } else {
      geo = createTaperedBoxGeometry(part);
    }
    const rock=part.rockShape?.enabled===true,renderPart=rock?rockMaterialPart(part):part; // Conversion changes geometry/finish, never kind, transform, part ID or animation bindings.
    if(rock&&part.kind==='banner'){geo.dispose();geo=new THREE.BoxGeometry(Math.max(.01,t.sx),Math.max(.01,t.sy),Math.max(.01,t.sz||.02));} // A formerly flat fabric guide becomes a thin stone slab.
    const rockSource=rock?geo.clone():null; // Rest geometry survives rounding without bloating cloned/serialized mesh userData.
    if(rock){const original=geo;geo=createRockGeometry(original,part.rockShape);original.dispose();}
    const mat = partMaterial(renderPart, baseColor);
    applySurfaceOpacity(mat, renderPart);
    const mesh = new THREE.Mesh(geo, mat);
    if(rockSource)rockSourceGeometries.set(mesh,rockSource);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(t.x || 0, t.y || 0, t.z || 0);
    mesh.rotation.set((t.rx || 0) * DEG, (t.ry || 0) * DEG, (t.rz || 0) * DEG);
    mesh.name = part.name || part.kind;
    if (renderPart.materialTexture) applyPartTexture(mat, renderPart);
    applyAuthoredSurfaceMapping(mesh, renderPart); // Must run after the final primitive geometry exists; material assignment above remains authoritative.
    if (part.depthWrite === false) mat.depthWrite = false; // Background/firebox planes stay visible behind transparent effects.
    if(rock)mat.depthWrite=true; // Converted stone is solid even when its source was a VFX backdrop.
    mesh.userData ||= {};
    mesh.userData.authoredPart = part; // Pattern placement/instance edits use the same immutable authored definition.
    mesh.userData.rockShape=rock;
    window.FurniturePatternSurfaces?.applyPart?.(mesh, renderPart);
    if (part.kind === 'banner'&&!rock) { mat.visible = false; mesh.castShadow = false; } // Converted banners are visible stone rather than hidden fabric guides.
    return mesh;
  }

  // ── Authored material textures (docs/config/furniture-authored/*.json's
  // materialTexture/materialRotationDeg fields, from docs/assets/textures/)
  // — cached per filename since most parts across a whole furniture piece
  // (and across many placed instances) share the same handful of textures.
  const _texLoader = new THREE.TextureLoader();
  const _texCache = new Map(); // filename -> { base: THREE.Texture, loaded: boolean, pendingClones: Set<THREE.Texture> }
  // THREE.Texture.copy() (used by .clone()) snapshots `image` by reference at
  // call time — the loader's onLoad only ever back-fills the ORIGINAL texture
  // object, so a clone made before the network fetch finishes captures the
  // still-empty image forever and renders solid black. Every part needs its
  // own clone (independent rotation per authored part), so instead of cloning
  // once and hoping the fetch already resolved, track pending clones per
  // filename and patch their `image`/`needsUpdate` in when the base loads.
  function texEntry(filename) {
    let entry = _texCache.get(filename);
    if (entry) return entry;
    entry = { base: null, loaded: false, pendingClones: new Set() };
    entry.base = _texLoader.load((window.__hobunjiFurnitureAssetBase || 'assets/') + 'textures/' + filename, () => {
      entry.loaded = true;
      for (const clone of entry.pendingClones) {
        finishPartTexture(clone, entry.base.image);
        clone.format = entry.base.format;
        clone.needsUpdate = true;
      }
      entry.pendingClones.clear();
    }, undefined, () => {});
    entry.base.wrapS = entry.base.wrapT = THREE.RepeatWrapping;
    entry.base.center.set(0.5, 0.5);
    _texCache.set(filename, entry);
    return entry;
  }
  function finishPartTexture(texture, image) {
    const fill = texture.userData?.furnitureFill; // Authored fill settings retained while the PNG loads.
    if (fill && typeof window.getShadeFillCanvas === 'function') {
      const hex = fill.replace('#', ''); // Used to pass the furniture fill color to the shared adaptive shade-fill pipeline.
      image = window.getShadeFillCanvas(image, `furniture:${texture.userData.furnitureTexture}:${fill}`, {
        mode: 'shadeFill', rgb: [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16)),
        options: window.getPortraitTintingConfig?.(),
      });
    }
    if (THREE.Source && texture.source) texture.source = new THREE.Source(image);
    else texture.image = image;
    texture.needsUpdate = true;
  }

  function makePartMaterial(part, baseColor) {
    const material = partMaterial(part, baseColor); // Shared authored material factory for procedural ruin surfaces and furniture parts.
    applySurfaceOpacity(material, part);
    if (part.materialTexture) applyPartTexture(material, part);
    return material;
  }

  function applyPartTexture(mat, part) {
    const entry = texEntry(part.materialTexture);
    const tex = entry.base.clone();
    tex.needsUpdate = true;
    tex.rotation = (part.materialRotationDeg || 0) * DEG;
    tex.userData = Object.assign({}, tex.userData); // three.js r128 Textures have no userData field; give each clone its own.
    tex.userData.furnitureTexture = part.materialTexture;
    tex.userData.furnitureFill = part.materialFillMode !== 'never' && part.materialFillEnabled && /^#[0-9a-f]{6}$/i.test(part.materialFillColor || '') ? part.materialFillColor : null;
    if (!entry.loaded) entry.pendingClones.add(tex);
    else finishPartTexture(tex, entry.base.image);
    tex.repeat.set(Math.max(.01, Number(part.materialRepeatU) || 1), Math.max(.01, Number(part.materialRepeatV) || 1));
    mat.map = tex;
    mat.color.set(0xffffff);
    mat.transparent = !!part.textureTransparent;
    mat.needsUpdate = true;
  }

  function buildFurnitureGroup(key, baseColor) {
    const group = new THREE.Group();
    group.name = 'procedural_furniture_' + key;
    const recipe = CATALOG[key];
    if (!recipe) return group;
    for (const part of recipe) group.add(buildPartMesh(part, baseColor));
    return group;
  }

  // ── Recipe building blocks ──────────────────────────────────────────
  // `extra` may include rx/ry/rz (merged into transform) plus any other part field
  // (topScaleX, bottomScaleX, segments, color, tint, ...).
  function withExtra(part, extra) {
    if (!extra) return part;
    const { rx, ry, rz, ...rest } = extra;
    if (rx != null) part.transform.rx = rx;
    if (ry != null) part.transform.ry = ry;
    if (rz != null) part.transform.rz = rz;
    return Object.assign(part, rest);
  }
  function leg(x, z, h, size, tint, extra) {
    return withExtra({ kind: 'legSquare', tint, transform: { x, y: h / 2, z, sx: size, sy: h, sz: size } }, extra);
  }
  function roundLeg(x, z, h, size, tint, segments, extra) {
    return withExtra({ kind: 'legRound', tint, segments: segments || 10, transform: { x, y: h / 2, z, sx: size, sy: h, sz: size } }, extra);
  }
  function box(x, y, z, sx, sy, sz, tint, extra) {
    return withExtra({ kind: 'box', tint, transform: { x, y, z, sx, sy, sz } }, extra);
  }
  function cyl(x, y, z, sx, sy, sz, tint, extra) {
    return withExtra({ kind: 'cylinder', tint, transform: { x, y, z, sx, sy, sz } }, extra);
  }
  function disc(x, y, z, sx, sy, sz, tint, extra) {
    return withExtra({ kind: 'disc', tint, segments: 24, transform: { x, y, z, sx, sy, sz } }, extra);
  }

  // Table-like: flat top on four (or more, for long tables) legs.
  function tableRecipe(fw, fd, topThickness, legHeight) {
    const w = fw * 0.92, d = fd * 0.92;
    const legInsetX = Math.min(0.18, w * 0.12), legInsetZ = Math.min(0.18, d * 0.12);
    const lx = w / 2 - legInsetX, lz = d / 2 - legInsetZ;
    const legSize = Math.min(0.16, Math.min(w, d) * 0.14);
    const topY = legHeight + topThickness / 2;
    const parts = [box(0, topY, 0, w, topThickness, d, 1.05, { topScaleX: .96, topScaleZ: .96 })];
    const xs = fw >= 3 ? [-lx, -lx / 3, lx / 3, lx] : [-lx, lx];
    for (const x of xs) for (const z of [-lz, lz]) parts.push(leg(x, z, legHeight, legSize, 0.8));
    return parts;
  }

  function cabinetRecipe(fw, fd, height, shelfLines) {
    const w = fw * 0.85, d = fd * 0.85;
    const parts = [box(0, height / 2, 0, w, height, d, 1)];
    const n = shelfLines || 0;
    for (let i = 1; i <= n; i++) {
      const y = (height * i) / (n + 1);
      parts.push(box(0, y, d / 2 + 0.001, w * 0.96, 0.025, 0.02, 0.6));
    }
    return parts;
  }

  function barrelRecipe(radius, height, tint) {
    return [
      cyl(0, height / 2, 0, radius * 2, height, radius * 2, tint != null ? tint : 1, { topScaleX: .85, topScaleZ: .85, bottomScaleX: .92, bottomScaleZ: .92, segments: 20 }),
      disc(0, height * 0.92, 0, radius * 2.08, 0.05, radius * 2.08, 1.3, { segments: 20 }),
      disc(0, height * 0.08, 0, radius * 2.12, 0.05, radius * 2.12, 1.3, { segments: 20 }),
    ];
  }

  // Bed-like: frame + mattress + a pillow placed at one end of whichever axis (X or Z)
  // is the longer one, matching that axis's footprint dimension.
  function bedRecipe(fw, fd) {
    const longIsZ = fd >= fw;
    const frameW = fw * 0.92, frameD = fd * 0.92;
    const longLen = longIsZ ? frameD : frameW;
    const shortLen = longIsZ ? frameW : frameD;
    const headOffset = -(longLen / 2 - shortLen * 0.32);
    const parts = [
      box(0, .14, 0, frameW, .22, frameD, .85),
      box(0, .33, 0, frameW * 0.93, .22, frameD * 0.93, 1, { topScaleX: .96, topScaleZ: .96 }),
    ];
    const pillowDepth = shortLen * 0.32, pillowWidth = shortLen * 0.78;
    if (longIsZ) parts.push(box(0, .50, headOffset, pillowWidth, .16, pillowDepth, 1.25));
    else parts.push(box(headOffset, .50, 0, pillowDepth, .16, pillowWidth, 1.25));
    const fx = frameW / 2 - .07, fz = frameD / 2 - .07;
    for (const x of [-fx, fx]) for (const z of [-fz, fz]) parts.push(leg(x, z, .14, .14, .65));
    return parts;
  }

  // ── Catalog: one entry per furniture key in DECORATIVE_FURNITURE_DEFS / PROCESSING_FURNITURE_DEFS ──
  const CATALOG = {};

  // -- Decorative furniture --
  CATALOG.basicBed = bedRecipe(1, 2);
  CATALOG.doubleBed = bedRecipe(2, 2);

  CATALOG.bedroll = [
    box(0, .05, .05, .8, .1, 1.55, 1),
    cyl(0, .13, -.78, .24, .8, .24, 1.15, { rx: 90, segments: 14 }),
  ];

  CATALOG.bench = [
    box(0, .31, 0, 1.7, .18, .5, 1),
    box(0, .11, .22, 1.5, .12, .1, .85),
    box(0, .11, -.22, 1.5, .12, .1, .85),
    leg(-.68, -.18, .27, .12, .75), leg(.68, -.18, .27, .12, .75),
    leg(-.68, .18, .27, .12, .75), leg(.68, .18, .27, .12, .75),
  ];

  CATALOG.bookshelf = cabinetRecipe(2, 1, 1.5, 3);

  CATALOG.bucket = [
    cyl(0, .19, 0, .42, .38, .42, 1, { topScaleX: 1.08, topScaleZ: 1.08, bottomScaleX: .85, bottomScaleZ: .85, segments: 16 }),
    disc(0, .37, 0, .46, .03, .46, 1.3, { segments: 16 }),
  ];

  // Drenkirra nest — the bucket recipe's exact tapered-cylinder-body +
  // rim-disc shape, just halved in height and rendered in a yellow "woven"
  // tint (see DECORATIVE_FURNITURE_DEFS.nestBranch/nest's color) instead of
  // the bucket's tin gray. diameter is the caller's own knob rather than a
  // fixed size, since a 1x1 branch nest and a 2x2 den nest need different
  // footprints out of the same recipe.
  function nestRecipe(diameter) {
    const bodyH = .19; // Half of bucket's .38 body height.
    return [
      cyl(0, bodyH / 2, 0, diameter, bodyH, diameter, 1, { topScaleX: 1.08, topScaleZ: 1.08, bottomScaleX: .85, bottomScaleZ: .85, segments: 16 }),
      disc(0, bodyH * 0.97, 0, diameter + .04, .03, diameter + .04, 1.3, { segments: 16 }),
    ];
  }
  // Baby basket (js/romance-family.js): a low oval woven basket with a soft
  // folded blanket, wide enough to read as a crib for a newborn.
  CATALOG.babyBasket = [
    cyl(0, .13, 0, .8, .26, .56, 1, { topScaleX: 1.1, topScaleZ: 1.12, bottomScaleX: .84, bottomScaleZ: .84, segments: 20 }),
    disc(0, .255, 0, .9, .035, .64, 1.3, { segments: 20 }),
    box(0, .215, .1, .62, .07, .3, 1, { color: '#e8c9d6' }),
  ];
  CATALOG.nestBranch = nestRecipe(.84); // 1x1 tile footprint, same scale as the bucket.
  CATALOG.nest = nestRecipe(1.7); // 2x2 tile footprint — matches the den nest marker's existing w:2,h:2 size.

  CATALOG.candleTable = [
    box(0, .42, 0, .6, .08, .6, 1.05, { topScaleX: .96, topScaleZ: .96 }),
    leg(-.22, -.22, .38, .07, .8), leg(.22, -.22, .38, .07, .8),
    leg(-.22, .22, .38, .07, .8), leg(.22, .22, .38, .07, .8),
    cyl(0, .55, 0, .06, .22, .06, .5, { segments: 8 }),
    disc(0, .47, 0, .14, .02, .14, 1.3, { segments: 12 }),
  ];

  CATALOG.chairSimple = [
    box(0, .38, 0, .42, .06, .42, 1),
    box(0, .65, -.19, .4, .5, .06, 1),
    leg(-.17, -.17, .38, .05, .8), leg(.17, -.17, .38, .05, .8),
    leg(-.17, .17, .38, .05, .8), leg(.17, .17, .38, .05, .8),
  ];

  CATALOG.chairCushion = [
    ...CATALOG.chairSimple,
    box(0, .42, 0, .38, .05, .38, 0.55),
  ];

  CATALOG.chest = [
    box(0, .19, 0, .8, .38, .5, 1),
    box(0, .42, 0, .82, .08, .52, 1.15),
    box(0, .39, .26, .06, .08, .03, .5),
  ];

  CATALOG.crateStack = [
    box(-.08, .17, -.05, .5, .34, .5, 1),
    box(.1, .42, .06, .38, .26, .38, .85, { ry: 12 }),
  ];

  CATALOG.copperBarrel = barrelRecipe(.36, .45, 1);

  CATALOG.desk = [
    ...tableRecipe(2, 1, .08, .42),
    box(.45, .27, 0, .5, .3, .7, .9),
  ];

  CATALOG.groomingKit = [
    ...tableRecipe(1, 1, .08, .42),
    { kind: 'cup', color: 0x8bafbd, segments: 24, innerScale: .84, basinDepth: .14,
      transform: { x: 0, y: .61, z: 0, sx: .62, sy: .23, sz: .62 } },
    disc(0, .68, 0, .48, .015, .48, 1, { color: 0x66bbdd, segments: 24 }),
  ];

  CATALOG.dresser = cabinetRecipe(2, 1, .85, 2);

  // Stone-hearth loading fallback: mirrors the authored open-front masonry silhouette
  // so slow JSON/texture loads never flash the old three-brown-box placeholder.
  CATALOG.hearth = [
    box(0, .06, 0, 1.82, .12, .88, 1, { color: 0x625c52, topScaleX: .98, topScaleZ: .98, materialTexture: 'carved_smooth.png' }),
    box(0, .15, .08, 1.62, .10, .72, 1, { color: 0x7b7466, topScaleX: .96, topScaleZ: .96, materialTexture: 'carved_smooth.png' }),
    box(0, .78, -.34, 1.48, 1.16, .18, 1, { color: 0x625c52, materialTexture: 'carved_smooth.png', depthWrite: false }),
    box(-.64, .69, -.06, .30, 1.04, .48, 1, { color: 0x7b7466, topScaleX: .92, topScaleZ: .95, bottomScaleX: 1.04, bottomScaleZ: 1.02, materialTexture: 'carved_smooth.png' }),
    box(.64, .69, -.06, .30, 1.04, .48, 1, { color: 0x7b7466, topScaleX: .92, topScaleZ: .95, bottomScaleX: 1.04, bottomScaleZ: 1.02, materialTexture: 'carved_smooth.png' }),
    box(0, 1.20, -.06, 1.50, .20, .48, 1, { color: 0x928a78, topScaleX: .97, topScaleZ: .97, materialTexture: 'carved_smooth.png' }),
    box(0, 1.36, -.10, 1.78, .12, .56, 1, { color: 0x928a78, topScaleX: .96, topScaleZ: .96, materialTexture: 'carved_smooth.png' }),
    disc(0, .225, .10, .92, .05, .44, 1, { color: 0x2d2928, segments: 20, materialTexture: 'carved_smooth.png' }),
    box(0, .30, .10, .74, .11, .12, 1, { color: 0x5b321b, ry: 32, materialTexture: 'boards.png', materialRotationDeg: 90 }),
    box(0, .31, .10, .74, .11, .12, 1, { color: 0x6f3c1f, ry: -32, materialTexture: 'boards.png', materialRotationDeg: 90 }),
  ];

function campfireRecipe() {
    const parts = [
      cyl(0, .12, 0, .16, .92, .16, .82, { rz: 90, ry: 45, segments: 8, color: 0x5b321b }),
      cyl(0, .14, 0, .16, .92, .16, .70, { rz: 90, ry: -45, segments: 8, color: 0x6f3c1f }),
    ];
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9;
      parts.push(cyl(Math.cos(a) * .42, .09, Math.sin(a) * .42, .23, .18, .23, 1, {
        segments: 7,
        color: i % 2 ? 0x68635a : 0x777168,
      }));
    }
    return parts;
  }
  CATALOG.campfire = campfireRecipe();

  CATALOG.loom = [
    leg(-.3, -.85, 1.6, .12, .8), leg(.3, -.85, 1.6, .12, .8),
    leg(-.3, .85, 1.6, .12, .8), leg(.3, .85, 1.6, .12, .8),
    box(0, 1.5, -.85, .76, .08, .12, .9),
    box(0, .25, -.85, .76, .08, .12, .9),
    box(0, 1.5, .85, .76, .08, .12, .9),
    box(0, .25, .85, .76, .08, .12, .9),
  ];

  CATALOG.nightstand = cabinetRecipe(1, 1, .55, 1);

  CATALOG.rug = [
    box(0, .015, 0, 1.85, .03, 1.85, 1),
  ];

  CATALOG.standingLamp = [
    roundLeg(0, 0, 1.3, .07, .85),
    cyl(0, 1.42, 0, .4, .22, .4, 1, { topScaleX: .55, topScaleZ: .55, segments: 14 }),
    disc(0, 1.0, 0, .26, .03, .26, .85, { segments: 10 }),
  ];

  // Placeholder weathered-stone statue/totem: a plinth, a tapered column, and
  // a small pointed cap -- explicit stone-gray colors (not tinted off the
  // passed-in base color) so it reads consistently regardless of what a
  // placement happens to pass as its "furniture color".
  // Fallback for the repo-authored stone pedestal used as the Color Pools altar.
  // The real geometry is docs/config/furniture-authored/stonePedestal.json;
  // this exact five-stage silhouette prevents a placeholder cube if authored
  // furniture finishes loading a frame after the cave scene.
  CATALOG.stonePedestal = [
    box(0, .05, 0, .78, .10, .78, 1, { color: 0x625c52, materialTexture: 'carved_smooth.png', materialLighting: 'unlit', materialUvMapping: 'connected-surface-stretch', materialUvMaxPatchWorldSize: 6 }),
    box(0, .14, 0, .64, .08, .64, 1, { color: 0x7b7466, topScaleX: .94, topScaleZ: .94, materialTexture: 'carved_smooth.png', materialLighting: 'unlit', materialUvMapping: 'connected-surface-stretch', materialUvMaxPatchWorldSize: 6 }),
    box(0, .43, 0, .46, .50, .46, 1, { color: 0x7b7466, topScaleX: .88, topScaleZ: .88, bottomScaleX: 1.04, bottomScaleZ: 1.04, materialTexture: 'carved_smooth.png', materialLighting: 'unlit', materialUvMapping: 'connected-surface-stretch', materialUvMaxPatchWorldSize: 6 }),
    box(0, .71, 0, .56, .08, .56, 1, { color: 0x928a78, materialTexture: 'carved_smooth.png', materialLighting: 'unlit', materialUvMapping: 'connected-surface-stretch', materialUvMaxPatchWorldSize: 6 }),
    box(0, .80, 0, .76, .10, .76, 1, { color: 0x928a78, topScaleX: .96, topScaleZ: .96, materialTexture: 'carved_smooth.png', materialLighting: 'unlit', materialUvMapping: 'connected-surface-stretch', materialUvMaxPatchWorldSize: 6 }),
  ];

  CATALOG.statue = [
    box(0, .06, 0, .68, .12, .68, 1, { color: 0x63666c }),
    cyl(0, .34, 0, .42, .5, .42, 1, { color: 0x54585e, topScaleX: .8, topScaleZ: .8, segments: 8 }),
    cyl(0, .68, 0, .2, .18, .2, 1, { color: 0x40444a, topScaleX: .25, topScaleZ: .25, segments: 6 }),
  ];

  CATALOG.stool = [
    disc(0, .31, 0, .8, .14, .8, 1, { segments: 20 }),
    roundLeg(Math.cos(Math.PI / 6) * .26, Math.sin(Math.PI / 6) * .26, .28, .1, .8),
    roundLeg(Math.cos(Math.PI / 6 + Math.PI * 2 / 3) * .26, Math.sin(Math.PI / 6 + Math.PI * 2 / 3) * .26, .28, .1, .8),
    roundLeg(Math.cos(Math.PI / 6 + Math.PI * 4 / 3) * .26, Math.sin(Math.PI / 6 + Math.PI * 4 / 3) * .26, .28, .1, .8),
  ];

  CATALOG.tableLong = tableRecipe(4, 1, .12, .42);
  CATALOG.tableRound = [
    disc(0, .42, 0, 1.7, .12, 1.7, 1.05, { segments: 24, topScaleX: .96, topScaleZ: .96 }),
    cyl(0, .19, 0, .2, .38, .2, .85, { segments: 16 }),
    disc(0, .02, 0, .55, .04, .55, .85, { segments: 16 }),
  ];
  CATALOG.tableSmall = tableRecipe(1, 1, .1, .42);

  CATALOG.wardrobe = [
    ...cabinetRecipe(2, 1, 1.7, 0),
    box(0, .85, .43, .02, 1.6, .02, .5),
  ];

  CATALOG.washTub = [
    cyl(0, .17, 0, .68, .32, .68, 1, { topScaleX: 1.06, topScaleZ: 1.06, bottomScaleX: .88, bottomScaleZ: .88, segments: 18 }),
    disc(0, .32, 0, .72, .03, .72, 1.25, { segments: 18 }),
  ];

  CATALOG.counter = [
    box(0, .45, 0, 2.7, .9, .7, 1),
    box(0, .93, 0, 2.8, .06, .8, 1.15),
  ];

  // Bulletin Board: a post-mounted panel with a couple of pinned notices —
  // the public task board (see game.js's task/favor system).
  CATALOG.bulletinBoard = [
    leg(-.55, 0, .95, .09, .7), leg(.55, 0, .95, .09, .7),
    box(0, .95, 0, 1.3, 1.0, .08, 1, { topScaleX: .97, topScaleZ: 1 }),
    box(0, .95, .045, 1.15, .82, .02, 1.4),
    box(-.28, 1.08, .06, .32, .22, .01, 1.6),
    box(.22, .82, .06, .3, .2, .01, 1.6),
  ];

  // Alchemy Table: a squat cauldron on a stubby tripod, ringed with a few
  // corked reagent bottles — reuses the tapered-cylinder/disc primitives
  // rather than a bespoke model, matching every other CATALOG entry.
  CATALOG.alchemyTable = [
    roundLeg(0, 0, .32, .16, .8, 10),
    cyl(0, .5, 0, .78, .5, .78, .55, { segments: 18, topScaleX: 1.12, topScaleZ: 1.12, bottomScaleX: .7, bottomScaleZ: .7 }),
    disc(0, .74, 0, .84, .05, .84, 1.35, { segments: 18 }),
    cyl(-.34, .34, .22, .09, .3, .09, .95, { segments: 8 }),
    cyl(.3, .3, -.28, .08, .24, .08, 1.1, { segments: 8 }),
    cyl(.1, .28, .36, .07, .2, .07, 1.25, { segments: 8 }),
  ];

  // -- Processing furniture (used by docs/tools/building-interior-author preview) --
  CATALOG.pestle = [
    box(0, .19, 0, .6, .38, .6, .85),
    disc(0, .42, 0, .5, .1, .5, 1.15, { segments: 18, topScaleX: .8, topScaleZ: .8 }),
    cyl(.12, .55, 0, .08, .3, .08, .7, { segments: 8 }),
  ];

  CATALOG.squeezer = [
    cyl(0, .26, 0, 1.3, .5, 1.3, .9, { segments: 18, topScaleX: 1.05, topScaleZ: 1.05 }),
    roundLeg(0, 0, .9, .1, .8),
    disc(0, .92, 0, .5, .06, .5, 1.2, { segments: 14 }),
  ];

  CATALOG.handMill = [
    box(0, .22, 0, .62, .44, .62, .85),
    disc(0, .48, 0, .56, .14, .56, 1.1, { segments: 18 }),
    cyl(.32, .5, 0, .06, .3, .06, .7, { rz: 90, segments: 8 }),
  ];

  // Banubu's Tea Grinder: a low green-stained rotary stone with three
  // ingredient cups around the grinding plate, visually distinct from the
  // ordinary Hand Mill while staying inside the existing processor renderer.
  CATALOG.teaGrinder = [
    box(0, .18, 0, .7, .36, .7, .72),
    disc(0, .43, 0, .62, .16, .62, 1.15, { segments: 20 }),
    cyl(.34, .48, 0, .055, .32, .055, .65, { rz: 90, segments: 8 }),
    cyl(-.25, .48, -.28, .2, .12, .2, 1.25, { segments: 12, topScaleX: 1.15, topScaleZ: 1.15, bottomScaleX: .75, bottomScaleZ: .75 }),
    cyl(.25, .48, -.28, .2, .12, .2, 1.05, { segments: 12, topScaleX: 1.15, topScaleZ: 1.15, bottomScaleX: .75, bottomScaleZ: .75 }),
    cyl(0, .48, .32, .2, .12, .2, .9, { segments: 12, topScaleX: 1.15, topScaleZ: 1.15, bottomScaleX: .75, bottomScaleZ: .75 }),
  ];

  CATALOG.dryingRack = [
    leg(-.85, -.38, 1.1, .1, .8), leg(.85, -.38, 1.1, .1, .8),
    leg(-.85, .38, 1.1, .1, .8), leg(.85, .38, 1.1, .1, .8),
    box(0, 1.05, 0, 1.8, .07, .85, .9),
    box(0, .55, 0, 1.8, .05, .85, .9),
  ];

  CATALOG.smoker = [
    box(0, .8, 0, 1.5, 1.6, 1.5, .8),
    cyl(0, 1.75, 0, .26, .35, .26, .55, { segments: 10 }),
  ];

  CATALOG.agingBarrel = barrelRecipe(.36, .45, .75);

  CATALOG.agingVase = [
    cyl(0, .32, 0, .56, .64, .56, .9, { segments: 18, topScaleX: .55, topScaleZ: .55, bottomScaleX: .8, bottomScaleZ: .8 }),
    disc(0, .66, 0, .3, .04, .3, 1.2, { segments: 14 }),
  ];

  // -- Barn-interior fixtures (see game.js's synthesizeBarnInteriorMapData) --
  // Same hand-mill silhouette as CATALOG.handMill, tipped on its side (the
  // grinding face now points +X, toward the right wall) with a small catch
  // bowl on top — the real look comes from feedGrinder.json (authored) once
  // that loads; this is only the fallback before/if it doesn't.
  CATALOG.feedGrinder = [
    box(0, .14, 0, .5, .28, .42, .85),
    cyl(0, .34, 0, .22, .55, .22, 1, { rz: 90, segments: 14 }),
    disc(.26, .34, 0, .24, .07, .24, 1.1, { rz: 90, segments: 18 }),
    cyl(-.06, .34, -.3, .045, .16, .045, .7, { rx: 90, segments: 8 }),
    cyl(.34, .5, 0, .2, .18, .2, .9, { segments: 12, topScaleX: 1.1, topScaleZ: 1.1, bottomScaleX: .7, bottomScaleZ: .7 }),
  ];

  CATALOG.trough = [
    box(0, .07, 0, .7, .14, .26, .85),
    cyl(0, .2, 0, .76, .22, .32, 1, { segments: 16, topScaleX: 1.1, topScaleZ: 1.1, bottomScaleX: .82, bottomScaleZ: .82 }),
  ];

  // Loading can briefly race the first scene build; this tiny recipe keeps
  // the authored mine ladder on the normal furniture path until its JSON is
  // ready, at which point AuthoredFurniture supplies the real model.
  CATALOG.mineLadder = [
    box(0, .65, 0, .6, 1.3, .12, .85),
  ];

  function hangingSignSupportPart(id = 'hanging_sign_post') {
    return {id,kind:'beam',name:'Horizontal Sign Post',color:'#60452c',materialRole:'wood',materialTexture:'carved_smooth.png',transform:{x:0,y:1.72,z:0,rx:0,ry:0,rz:0,sx:1.25,sy:.14,sz:.14},topScaleX:1,topScaleZ:1,bottomScaleX:1,bottomScaleZ:1,wonkiness:.01}; // Shared by the animation-tab sign and banner preset, returning an independent recipe.
  }
  CATALOG.hangingBanner = [
    hangingSignSupportPart(),
    {id:'banner-cloth',kind:'banner',name:'Wind banner',bannerWindStrength:.1,transform:{x:-.0863,y:1.0539,z:0,rx:0,ry:0,rz:0,sx:.7,sy:1.1922,sz:.01},patternSurfaces:[{slot:'banner',mode:'cloth',patternId:'omgurku_knot',scale:1,palette:['#b7a185','#315b67']}]}, // Replaces the sign and ropes; cloth top is flush with the shared beam underside at Y=1.65.
  ];

  window.ProceduralFurniture = {
    hangingSignSupportPart,
    buildFurnitureGroup,
    buildPartMesh,
    createRockGeometry,
    applyRockContacts,
    getRockContactArea,
    makePartMaterial,
    latestChange: 'Contact area now controls shared attachment patches before roughening: small patches preserve more rock detail; large patches hold broader joints together.',
    shade,
    CATALOG,
  };
})();
