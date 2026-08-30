(() => {
  'use strict';

  // Terrain surface UV baking + large-mesh spatial chunking.
  //
  // Jigsaw UVs are generated once, from the final triangle topology. Triangles
  // using the same material join only when they share a real geometric edge,
  // so grass separated by a path/water/rock strip naturally becomes separate
  // texture islands. Each island gets one 0..1 source-image domain; its outer
  // source-image band is pulled onto the island's literal boundary. Steep,
  // wall-like islands use a single wrapped domain around the whole face.
  // Rendering remains a normal single texture sample — the extra work is only
  // at terrain-build time.
  const THREE = window.THREE;
  const rendererProto = THREE?.WebGLRenderer?.prototype;
  if (!THREE?.BufferGeometry || !THREE?.Mesh || !rendererProto || typeof rendererProto.render !== 'function') return;

  const existing = window.TerrainRenderChunks;
  if (existing?.installed && window.TerrainJigsawUV?.installed) return;

  const originalRender = rendererProto.render;
  if (originalRender.__hobunjiTerrainSurfaceWrapped) {
    window.TerrainRenderChunks = originalRender.__hobunjiTerrainChunkApi || existing || { installed: true };
    window.TerrainJigsawUV = originalRender.__hobunjiTerrainJigsawApi || window.TerrainJigsawUV;
    return;
  }

  const MATERIAL_ID_LAYER = 3;
  const CHUNK_TILES = 12;
  const CHUNK_WORLD = CHUNK_TILES;
  const MIN_SOURCE_TRIANGLES = 60000;
  const SCAN_INTERVAL_MS = 500;
  const MAX_SPATIAL_BUCKETS = 400;
  const POS_QUANT = 10000;
  const DEFAULT_EDGE_PX = 16;
  const DEFAULT_EDGE_WORLD = 0.5;
  const DEFAULT_SOURCE_SIZE = 256;

  const lastChunkScanAt = new WeakMap();
  const lastJigsawScanAt = new WeakMap();
  let sourceMeshesChunked = 0;
  let chunksCreated = 0;
  let sourceTrianglesChunked = 0;
  let rejectedTooFewBuckets = 0;
  let rejectedTooManyBuckets = 0;
  let jigsawMeshesBaked = 0;
  let jigsawIslandsBaked = 0;
  let jigsawTrianglesBaked = 0;

  function triangleCount(geometry) {
    if (!geometry) return 0;
    const count = geometry.index?.count ?? geometry.attributes?.position?.count ?? 0;
    return Math.floor(Number(count) / 3) || 0;
  }

  function hasLayer(object, layer) {
    const mask = Number(object?.layers?.mask ?? 0) >>> 0;
    return !!(mask & ((1 << layer) >>> 0));
  }

  function sourceIndexAt(indexAttribute, element) {
    return indexAttribute ? indexAttribute.array[element] : element;
  }

  function materialAt(mesh, materialIndex) {
    return Array.isArray(mesh.material) ? mesh.material[materialIndex] : mesh.material;
  }

  function materialEligible(mat) {
    return !!(mat?.map && !mat.transparent && Number(mat.opacity ?? 1) >= 0.99);
  }

  function positionKey(position, vi) {
    const a = position.array, s = position.itemSize;
    const x = Math.round(a[vi*s] * POS_QUANT);
    const y = Math.round(a[vi*s+1] * POS_QUANT);
    const z = Math.round(a[vi*s+2] * POS_QUANT);
    return `${x},${y},${z}`;
  }

  function edgeKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

  function groupMaterialForElement(groups, element) {
    if (!groups?.length) return 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (element >= g.start && element < g.start + g.count) return Number(g.materialIndex) || 0;
    }
    return 0;
  }

  function smooth01(t) { t = Math.max(0, Math.min(1, t)); return t*t*(3-2*t); }
  function lerp(a,b,t) { return a + (b-a)*t; }

  function imageSize(texture) {
    const image = texture?.image || texture?.source?.data;
    const width = Number(image?.naturalWidth || image?.videoWidth || image?.width) || DEFAULT_SOURCE_SIZE;
    const height = Number(image?.naturalHeight || image?.videoHeight || image?.height) || DEFAULT_SOURCE_SIZE;
    return { width, height };
  }

  function cloneJigsawMaterial(mat, wallLike) {
    if (!mat) return mat;
    const out = mat.clone();
    out.userData = Object.assign({}, mat.userData, { terrainJigsawMaterial: true });
    if (mat.map) {
      const tex = mat.map.clone();
      tex.wrapS = wallLike ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(1, 1);
      tex.offset.set(0, 0);
      if (tex.center) tex.center.set(0, 0);
      tex.rotation = 0;
      tex.matrixAutoUpdate = true;
      tex.needsUpdate = true;
      out.map = tex;
    }
    out.needsUpdate = true;
    return out;
  }

  class MinHeap {
    constructor(){ this.a=[]; }
    push(item){
      const a=this.a; a.push(item); let i=a.length-1;
      while(i){ const p=(i-1)>>1; if(a[p][0] <= item[0]) break; a[i]=a[p]; i=p; }
      a[i]=item;
    }
    pop(){
      const a=this.a; if(!a.length) return null;
      const root=a[0], last=a.pop(); if(!a.length) return root;
      let i=0;
      while(true){
        let l=i*2+1,r=l+1;if(l>=a.length)break;let c=(r<a.length&&a[r][0]<a[l][0])?r:l;
        if(a[c][0]>=last[0])break;a[i]=a[c];i=c;
      }
      a[i]=last; return root;
    }
    get length(){ return this.a.length; }
  }

  function remapProtectedCoord(t, sourceFrac, targetFrac) {
    t = Math.max(0, Math.min(1, t));
    sourceFrac = Math.max(0, Math.min(0.49, sourceFrac));
    targetFrac = Math.max(0, Math.min(0.49, targetFrac));
    if (sourceFrac < 1e-6 || targetFrac < 1e-6) return sourceFrac + t * (1 - 2*sourceFrac);
    if (t < targetFrac) return (t / targetFrac) * sourceFrac;
    if (t > 1-targetFrac) return 1 - ((1-t)/targetFrac)*sourceFrac;
    return sourceFrac + ((t-targetFrac)/(1-2*targetFrac))*(1-2*sourceFrac);
  }

  function analyzeGeometry(mesh) {
    const geometry = mesh.geometry;
    const position = geometry?.attributes?.position;
    const uv = geometry?.attributes?.uv;
    if (!position?.array || position.isInterleavedBufferAttribute || !uv?.array || uv.isInterleavedBufferAttribute) return null;
    const index = geometry.index || null;
    const elementCount = Math.floor((index?.count ?? position.count) / 3) * 3;
    if (!elementCount) return null;

    const pKeys = new Array(position.count);
    for (let vi=0;vi<position.count;vi++) pKeys[vi]=positionKey(position,vi);

    const triangles=[];
    const edgeOwners=new Map();
    for(let e=0;e<elementCount;e+=3){
      const ia=sourceIndexAt(index,e),ib=sourceIndexAt(index,e+1),ic=sourceIndexAt(index,e+2);
      const mi=groupMaterialForElement(geometry.groups,e);
      const eligible=materialEligible(materialAt(mesh,mi));
      const tri={e,ia,ib,ic,mi,eligible,component:-1};
      const ti=triangles.length;triangles.push(tri);
      if(!eligible)continue;
      const keys=[pKeys[ia],pKeys[ib],pKeys[ic]];
      for(const [u,v] of [[0,1],[1,2],[2,0]]){
        const k=`${mi}:${edgeKey(keys[u],keys[v])}`;
        let owners=edgeOwners.get(k);if(!owners){owners=[];edgeOwners.set(k,owners);}owners.push(ti);
      }
    }

    const neighbors=Array.from({length:triangles.length},()=>[]);
    for(const owners of edgeOwners.values()) if(owners.length>1){
      for(let i=0;i<owners.length;i++)for(let j=i+1;j<owners.length;j++){
        neighbors[owners[i]].push(owners[j]);neighbors[owners[j]].push(owners[i]);
      }
    }
    const components=[];
    for(let ti=0;ti<triangles.length;ti++){
      if(!triangles[ti].eligible||triangles[ti].component>=0)continue;
      const id=components.length, stack=[ti], list=[];triangles[ti].component=id;
      while(stack.length){const q=stack.pop(),t=triangles[q];list.push(q);for(const n of neighbors[q])if(triangles[n].component<0){triangles[n].component=id;stack.push(n);}}
      components.push({id,triangles:list,materialIndex:triangles[ti].mi});
    }
    return { geometry, position, uv, index, elementCount, pKeys, triangles, components };
  }

  function componentData(analysis, comp, settings) {
    const {position,pKeys,triangles}=analysis;
    const pa=position.array,ps=position.itemSize;
    const logical=new Map();
    const edgeCounts=new Map();
    let normalAbsY=0, normalWeight=0;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;

    function ensure(vi){
      const key=pKeys[vi];let v=logical.get(key);if(v)return v;
      const x=pa[vi*ps],y=pa[vi*ps+1],z=pa[vi*ps+2];
      v={key,x,y,z,source:new Set(),adj:new Map(),boundary:false,dist:Infinity,anchor:null,baseU:0,baseV:0,u:0,v:0};
      logical.set(key,v);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);return v;
    }
    function connect(a,b){
      const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z,w=Math.hypot(dx,dy,dz)||1e-6;
      const old=a.adj.get(b.key);if(old===undefined||w<old){a.adj.set(b.key,w);b.adj.set(a.key,w);}
    }

    for(const ti of comp.triangles){
      const t=triangles[ti], vs=[ensure(t.ia),ensure(t.ib),ensure(t.ic)];
      vs[0].source.add(t.ia);vs[1].source.add(t.ib);vs[2].source.add(t.ic);
      connect(vs[0],vs[1]);connect(vs[1],vs[2]);connect(vs[2],vs[0]);
      for(const [a,b] of [[vs[0],vs[1]],[vs[1],vs[2]],[vs[2],vs[0]]]){
        const k=edgeKey(a.key,b.key);let rec=edgeCounts.get(k);if(!rec){rec={count:0,a,b};edgeCounts.set(k,rec);}rec.count++;
      }
      const ax=vs[1].x-vs[0].x,ay=vs[1].y-vs[0].y,az=vs[1].z-vs[0].z;
      const bx=vs[2].x-vs[0].x,by=vs[2].y-vs[0].y,bz=vs[2].z-vs[0].z;
      const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,w=Math.hypot(nx,ny,nz);
      if(w>1e-9){normalAbsY+=Math.abs(ny);normalWeight+=w;}
    }
    const wallLike = normalWeight>0 ? (normalAbsY/normalWeight)<0.55 : false;
    const vertices=[...logical.values()];
    const boundaryEdges=[];
    for(const rec of edgeCounts.values())if(rec.count===1){rec.a.boundary=true;rec.b.boundary=true;boundaryEdges.push(rec);}
    return {comp,logical,vertices,boundaryEdges,wallLike,minX,maxX,minY,maxY,minZ,maxZ,settings};
  }

  function planarUvs(data, sourceFracU, sourceFracV) {
    const {vertices,minX,maxX,minZ,maxZ,settings}=data;
    const sx=Math.max(1e-6,maxX-minX), sz=Math.max(1e-6,maxZ-minZ);
    for(const v of vertices){v.baseU=(v.x-minX)/sx;v.baseV=(v.z-minZ)/sz;}

    const heap=new MinHeap();
    for(const v of vertices){
      if(!v.boundary)continue;
      v.dist=0;v.anchor=v;heap.push([0,v.key]);
    }
    while(heap.length){
      const item=heap.pop();if(!item)break;const[d,key]=item,v=data.logical.get(key);if(!v||d!==v.dist)continue;
      for(const[nk,w]of v.adj){const n=data.logical.get(nk),nd=d+w;if(nd+1e-8<n.dist){n.dist=nd;n.anchor=v.anchor;heap.push([nd,nk]);}}
    }

    const edgeWorld=Math.max(1e-6,Number(settings.edgeWorldWidth)||DEFAULT_EDGE_WORLD);
    for(const v of vertices){
      const centerU=sourceFracU+v.baseU*(1-2*sourceFracU);
      const centerV=sourceFracV+v.baseV*(1-2*sourceFracV);
      if(!v.anchor||v.dist>=edgeWorld){v.u=centerU;v.v=centerV;continue;}
      const a=v.anchor;let bu=a.baseU,bv=a.baseV;
      const choices=[[bu,'L'],[1-bu,'R'],[bv,'B'],[1-bv,'T']].sort((x,y)=>x[0]-y[0]);
      const side=choices[0][1];let ou=bu,ov=bv;
      if(side==='L')ou=0;else if(side==='R')ou=1;else if(side==='B')ov=0;else ov=1;
      const t=smooth01(v.dist/edgeWorld);
      v.u=lerp(ou,centerU,t);v.v=lerp(ov,centerV,t);
    }
  }

  function wallUvs(data, sourceFracU, sourceFracV) {
    const {vertices,minY,maxY,settings}=data;
    let cx=0,cz=0;for(const v of vertices){cx+=v.x;cz+=v.z;}cx/=Math.max(1,vertices.length);cz/=Math.max(1,vertices.length);
    let xx=0,xz=0,zz=0;for(const v of vertices){const x=v.x-cx,z=v.z-cz;xx+=x*x;xz+=x*z;zz+=z*z;}
    const tr=xx+zz,det=xx*zz-xz*xz,disc=Math.sqrt(Math.max(0,tr*tr/4-det));
    const l1=tr/2+disc,l2=tr/2-disc,roundish=l1>1e-8&&(l2/l1)>0.22;
    const h=Math.max(1e-6,maxY-minY);
    let worldU=1;
    if(roundish){
      const angles=vertices.map(v=>{let a=Math.atan2(v.z-cz,v.x-cx);if(a<0)a+=Math.PI*2;return a;}).sort((a,b)=>a-b);
      let gap=-1,seam=0;for(let i=0;i<angles.length;i++){const a=angles[i],b=i+1<angles.length?angles[i+1]:angles[0]+Math.PI*2,g=b-a;if(g>gap){gap=g;seam=(a+b)*0.5;}}
      seam%=Math.PI*2;
      let radius=0;for(const v of vertices)radius+=Math.hypot(v.x-cx,v.z-cz);radius/=Math.max(1,vertices.length);worldU=Math.max(1e-6,2*Math.PI*radius);
      for(const v of vertices){let a=Math.atan2(v.z-cz,v.x-cx);if(a<0)a+=Math.PI*2;let d=a-seam;if(d<0)d+=Math.PI*2;v.baseU=d/(Math.PI*2);v.baseV=(v.y-minY)/h;}
    }else{
      let vx, vz;
      if(Math.abs(xz)>1e-9){vx=l1-zz;vz=xz;const len=Math.hypot(vx,vz)||1;vx/=len;vz/=len;}else if(xx>=zz){vx=1;vz=0;}else{vx=0;vz=1;}
      let minP=Infinity,maxP=-Infinity;for(const v of vertices){const p=(v.x-cx)*vx+(v.z-cz)*vz;v._p=p;minP=Math.min(minP,p);maxP=Math.max(maxP,p);}worldU=Math.max(1e-6,maxP-minP);
      for(const v of vertices){v.baseU=(v._p-minP)/worldU;v.baseV=(v.y-minY)/h;delete v._p;}
    }
    const tu=Math.min(0.49,(Number(settings.edgeWorldWidth)||DEFAULT_EDGE_WORLD)/worldU);
    const tv=Math.min(0.49,(Number(settings.edgeWorldWidth)||DEFAULT_EDGE_WORLD)/h);
    for(const v of vertices){v.u=remapProtectedCoord(v.baseU,sourceFracU,tu);v.v=remapProtectedCoord(v.baseV,sourceFracV,tv);}
    data.wrapU=roundish;
  }

  function bakeMesh(mesh, options={}) {
    if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || !mesh.geometry) return null;
    if (mesh.userData?.terrainJigsawBaked && !options.force) return mesh.userData.terrainJigsawStats || null;
    const analysis=analyzeGeometry(mesh);if(!analysis||!analysis.components.length)return null;
    const edgePx=Math.max(0,Number(options.edgePx ?? DEFAULT_EDGE_PX));
    const edgeWorldWidth=Math.max(0.01,Number(options.edgeWorldWidth ?? DEFAULT_EDGE_WORLD));
    const componentUv=new Map();
    const wallByMaterial=new Map();

    for(const comp of analysis.components){
      const data=componentData(analysis,comp,{edgeWorldWidth});
      const mat=materialAt(mesh,comp.materialIndex),size=imageSize(mat?.map);
      const fracU=Math.min(0.24,edgePx/Math.max(1,size.width));
      const fracV=Math.min(0.24,edgePx/Math.max(1,size.height));
      if(data.wallLike)wallUvs(data,fracU,fracV);else planarUvs(data,fracU,fracV);
      const byKey=new Map();for(const v of data.vertices)byKey.set(v.key,[v.u,v.v]);
      componentUv.set(comp.id,{data,byKey});
      if(data.wallLike)wallByMaterial.set(comp.materialIndex,true);
    }

    const source=analysis.geometry;
    const attrs=source.attributes;
    const outAttrs={};for(const [name]of Object.entries(attrs))outAttrs[name]=[];
    const outIndex=[];const remap=new Map();
    for(const tri of analysis.triangles){
      let wrapShift=[0,0,0];
      if(tri.component>=0){
        const cu=componentUv.get(tri.component),vals=[tri.ia,tri.ib,tri.ic].map(vi=>cu.byKey.get(analysis.pKeys[vi])?.[0]??0);
        if(cu.data.wrapU&&Math.max(...vals)-Math.min(...vals)>0.5)wrapShift=vals.map(u=>u<0.5?1:0);
      }
      const vis=[tri.ia,tri.ib,tri.ic];
      for(let k=0;k<3;k++){
        const vi=vis[k], cid=tri.component, key=`${cid}:${vi}:${wrapShift[k]}`;
        let ni=remap.get(key);
        if(ni===undefined){
          ni=remap.size;remap.set(key,ni);
          for(const [name,a]of Object.entries(attrs)){
            for(let c=0;c<a.itemSize;c++)outAttrs[name].push(a.array[vi*a.itemSize+c]);
          }
          if(cid>=0){
            const cu=componentUv.get(cid),pair=cu.byKey.get(analysis.pKeys[vi]);
            const arr=outAttrs.uv,base=ni*2;arr[base]=(pair?.[0]??0)+wrapShift[k];arr[base+1]=pair?.[1]??0;
          }
        }
        outIndex.push(ni);
      }
    }

    const next=new THREE.BufferGeometry();
    for(const [name,a]of Object.entries(attrs)){
      const Ctor=a.array.constructor,arr=new Ctor(outAttrs[name]);
      next.setAttribute(name,new THREE.BufferAttribute(arr,a.itemSize,a.normalized));
    }
    const IndexCtor=remap.size>65535?Uint32Array:Uint16Array;next.setIndex(new THREE.BufferAttribute(new IndexCtor(outIndex),1));
    for(const g of source.groups||[])next.addGroup(g.start,g.count,g.materialIndex);
    next.setDrawRange(source.drawRange?.start??0,source.drawRange?.count??Infinity);
    next.userData=Object.assign({},source.userData,{terrainJigsawBaked:true});
    next.computeBoundingBox();next.computeBoundingSphere();

    const mats=Array.isArray(mesh.material)?mesh.material.slice():[mesh.material];
    for(let i=0;i<mats.length;i++)if(materialEligible(mats[i]))mats[i]=cloneJigsawMaterial(mats[i],!!wallByMaterial.get(i));
    const oldGeo=mesh.geometry;mesh.geometry=next;mesh.material=Array.isArray(mesh.material)?mats:mats[0];
    mesh.userData.terrainGeometryRevision=(Number(mesh.userData.terrainGeometryRevision)||0)+1;
    if(options.disposeSource!==false){try{oldGeo.dispose?.();}catch(_){}}
    const stats={islands:analysis.components.length,triangles:analysis.triangles.filter(t=>t.component>=0).length,verticesBefore:analysis.position.count,verticesAfter:remap.size,edgePx,edgeWorldWidth};
    mesh.userData=Object.assign({},mesh.userData,{terrainJigsawBaked:true,terrainJigsawStats:stats});
    jigsawMeshesBaked++;jigsawIslandsBaked+=stats.islands;jigsawTrianglesBaked+=stats.triangles;
    return stats;
  }

  function isLikelyTerrainMesh(mesh) {
    if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh) return false;
    if (mesh.userData?.terrainJigsawBaked || mesh.userData?.terrainJigsawIgnore || mesh.userData?.terrainRenderChunkSource || mesh.userData?.terrainRenderChunk) return false;
    if (!mesh.parent?.isScene) return false;
    const g=mesh.geometry;if(!g?.attributes?.position||!g?.attributes?.uv||triangleCount(g)<2)return false;
    const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];if(!mats.some(materialEligible))return false;
    const name=String(mesh.name||'').toLowerCase();
    if(/water|billboard|sprite|avatar|player|npc|creature|foliage|tree|shrub|building|house|furniture/.test(name))return false;
    if(hasLayer(mesh,MATERIAL_ID_LAYER)||Array.isArray(mesh.material)||mesh.userData?.cameraObstacle||/terrain|ground|floor|border|cliff|mesa|ramp|rock/.test(name))return true;
    if(!g.boundingBox)g.computeBoundingBox();const b=g.boundingBox;if(!b)return false;
    const sx=b.max.x-b.min.x,sz=b.max.z-b.min.z;
    return Math.max(sx,sz)>=6 && triangleCount(g)>=16;
  }

  function scanJigsawScene(scene, now=performance.now()) {
    if(!scene?.isScene||scene.userData?.terrainJigsawDisableAuto)return 0;
    const last=lastJigsawScanAt.get(scene)||-Infinity;if(now-last<SCAN_INTERVAL_MS)return 0;lastJigsawScanAt.set(scene,now);
    let made=0;for(const mesh of scene.children.slice())if(isLikelyTerrainMesh(mesh)){const s=bakeMesh(mesh);if(s)made++;}
    if(made){const msg=`[terrain-jigsaw] baked ${made} terrain mesh(es), ${jigsawIslandsBaked} connected surface island(s) total`;if(typeof window.__farmLog==='function')window.__farmLog(msg,'render');else console.debug(msg);}
    return made;
  }

  function isEligibleTerrainMesh(mesh) {
    if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh) return false;
    if (mesh.userData?.terrainRenderChunkSource || mesh.userData?.terrainRenderChunk) return false;
    if (!mesh.parent?.isScene || !mesh.receiveShadow || !hasLayer(mesh, MATERIAL_ID_LAYER)) return false;
    const position = mesh.geometry?.attributes?.position;
    if (!position || position.isInterleavedBufferAttribute || !position.array) return false;
    if (Array.isArray(mesh.material) || mesh.geometry.groups?.length > 1) return false;
    return triangleCount(mesh.geometry) >= MIN_SOURCE_TRIANGLES;
  }

  function bucketKey(gx,gz){return`${gx},${gz}`;}
  function getOrCreateBucket(buckets,gx,gz){const key=bucketKey(gx,gz);let b=buckets.get(key);if(b)return b;b={key,gx,gz,count:0,start:0,write:0,minX:Infinity,minY:Infinity,minZ:Infinity,maxX:-Infinity,maxY:-Infinity,maxZ:-Infinity};buckets.set(key,b);return b;}
  function expandBounds(b,x,y,z){if(x<b.minX)b.minX=x;if(x>b.maxX)b.maxX=x;if(y<b.minY)b.minY=y;if(y>b.maxY)b.maxY=y;if(z<b.minZ)b.minZ=z;if(z>b.maxZ)b.maxZ=z;}

  function spatialPlan(geometry) {
    const position=geometry.attributes.position,p=position.array,stride=position.itemSize,sourceIndex=geometry.index||null;
    const elementCount=Math.floor((sourceIndex?.count??position.count)/3)*3,buckets=new Map();
    const vertex=(vi,c)=>p[vi*stride+c];
    for(let i=0;i<elementCount;i+=3){const ia=sourceIndexAt(sourceIndex,i),ib=sourceIndexAt(sourceIndex,i+1),ic=sourceIndexAt(sourceIndex,i+2);const ax=vertex(ia,0),ay=vertex(ia,1),az=vertex(ia,2),bx=vertex(ib,0),by=vertex(ib,1),bz=vertex(ib,2),cx=vertex(ic,0),cy=vertex(ic,1),cz=vertex(ic,2);const b=getOrCreateBucket(buckets,Math.floor(((ax+bx+cx)/3)/CHUNK_WORLD),Math.floor(((az+bz+cz)/3)/CHUNK_WORLD));b.count+=3;expandBounds(b,ax,ay,az);expandBounds(b,bx,by,bz);expandBounds(b,cx,cy,cz);}
    if(buckets.size<2){rejectedTooFewBuckets++;return null;}if(buckets.size>MAX_SPATIAL_BUCKETS){rejectedTooManyBuckets++;return null;}
    const ordered=[...buckets.values()].sort((a,b)=>(a.gz-b.gz)||(a.gx-b.gx));let cursor=0;for(const b of ordered){b.start=cursor;b.write=cursor;cursor+=b.count;}
    const SourceArray=sourceIndex?.array?.constructor||(position.count>65535?Uint32Array:Uint16Array),reordered=new SourceArray(elementCount);
    for(let i=0;i<elementCount;i+=3){const ia=sourceIndexAt(sourceIndex,i),ib=sourceIndexAt(sourceIndex,i+1),ic=sourceIndexAt(sourceIndex,i+2);const b=buckets.get(bucketKey(Math.floor(((vertex(ia,0)+vertex(ib,0)+vertex(ic,0))/3)/CHUNK_WORLD),Math.floor(((vertex(ia,2)+vertex(ib,2)+vertex(ic,2))/3)/CHUNK_WORLD)));let w=b.write;reordered[w++]=ia;reordered[w++]=ib;reordered[w++]=ic;b.write=w;}
    return{buckets:ordered,reordered,sourceIndex};
  }

  function boundsForBucket(b){const box=new THREE.Box3(new THREE.Vector3(b.minX,b.minY,b.minZ),new THREE.Vector3(b.maxX,b.maxY,b.maxZ)),center=box.getCenter(new THREE.Vector3()),dx=b.maxX-b.minX,dy=b.maxY-b.minY,dz=b.maxZ-b.minZ;return{box,sphere:new THREE.Sphere(center,.5*Math.sqrt(dx*dx+dy*dy+dz*dz))};}
  function wrapperGeometry(source,sharedIndex,bucket,reuse){const g=reuse?source:new THREE.BufferGeometry();if(!reuse){for(const[name,a]of Object.entries(source.attributes||{}))g.setAttribute(name,a);for(const[name,a]of Object.entries(source.morphAttributes||{}))g.morphAttributes[name]=a;g.morphTargetsRelative=!!source.morphTargetsRelative;}g.setIndex(sharedIndex);g.setDrawRange(bucket.start,bucket.count);const b=boundsForBucket(bucket);g.boundingBox=b.box;g.boundingSphere=b.sphere;return g;}
  function makeChunkMesh(source,g,b,index){const c=new THREE.Mesh(g,source.material);c.name=`${source.name||'zone_floor'}__spatial_chunk_${b.gx}_${b.gz}`;c.layers.mask=source.layers.mask;c.castShadow=source.castShadow;c.receiveShadow=source.receiveShadow;c.frustumCulled=true;c.renderOrder=source.renderOrder;c.visible=source.visible;c.onBeforeRender=source.onBeforeRender;c.onAfterRender=source.onAfterRender;c.customDepthMaterial=source.customDepthMaterial;c.customDistanceMaterial=source.customDistanceMaterial;c.userData=Object.assign({},source.userData,{terrainRenderChunk:true,terrainRenderChunkIndex:index,terrainRenderChunkCellX:b.gx,terrainRenderChunkCellZ:b.gz});return c;}
  function chunkMesh(mesh){const source=mesh.geometry,total=triangleCount(source),plan=spatialPlan(source);if(!plan)return 0;let sharedIndex;if(plan.sourceIndex){plan.sourceIndex.array.set(plan.reordered);plan.sourceIndex.needsUpdate=true;sharedIndex=plan.sourceIndex;}else sharedIndex=new THREE.BufferAttribute(plan.reordered,1);const chunks=[];for(let i=0;i<plan.buckets.length;i++)chunks.push(makeChunkMesh(mesh,wrapperGeometry(source,sharedIndex,plan.buckets[i],i===0),plan.buckets[i],i));mesh.geometry=new THREE.BufferGeometry();mesh.userData=Object.assign({},mesh.userData,{terrainRenderChunkSource:true,terrainRenderChunkCount:chunks.length,terrainRenderChunkTriangles:total,terrainRenderChunkWorldSize:CHUNK_WORLD,terrainRenderChunkCoordinateUnits:'tiles',terrainGeometryRevision:(Number(mesh.userData.terrainGeometryRevision)||0)+1});for(const c of chunks)mesh.add(c);sourceMeshesChunked++;chunksCreated+=chunks.length;sourceTrianglesChunked+=total;return chunks.length;}
  function compactNumber(v){if(v>=1e6)return`${(v/1e6).toFixed(v>=1e7?0:1)}m`;if(v>=1e3)return`${(v/1e3).toFixed(v>=1e4?0:1)}k`;return String(Math.round(v));}

  function scanChunkScene(scene,now=performance.now()){
    if(!scene?.isScene)return 0;const last=lastChunkScanAt.get(scene)||-Infinity;if(now-last<SCAN_INTERVAL_MS)return 0;lastChunkScanAt.set(scene,now);
    const candidates=scene.children.filter(isEligibleTerrainMesh);if(!candidates.length)return 0;let made=0,tris=0,sources=0;for(const mesh of candidates){const st=triangleCount(mesh.geometry),count=chunkMesh(mesh);if(!count)continue;made+=count;tris+=st;sources++;}
    if(made){const msg=`[terrain-perf] spatial split ${sources} whole-zone seam mesh(es), ${compactNumber(tris)} tri into ${made} real ${CHUNK_TILES}x${CHUNK_TILES}-tile cell(s) (tile-space)`;if(typeof window.__farmLog==='function')window.__farmLog(msg,'render');else console.debug(msg);}return made;
  }

  function notifyTerrainGeometryReady(scene){
    if(!scene?.isScene)return 0;
    let notified=0;
    for(const mesh of scene.children){
      const callback=mesh?.userData?.onTerrainGeometryReady;
      if(typeof callback!=='function')continue;
      const revision=Number(mesh.userData.terrainGeometryRevision)||0; // Detects jigsaw replacement and spatial index reordering.
      if(mesh.userData.terrainGeometryReadyRevision===revision)continue;
      const renderedChunk=mesh.children?.find?.(child=>child.userData?.terrainRenderChunk); // Owns the shared GPU-facing index after spatial splitting.
      const geometry=renderedChunk?.geometry || mesh.geometry; // Passed back to the terrain owner for runtime tile indexing.
      if(!geometry?.index)continue;
      callback(geometry);
      mesh.userData.terrainGeometryReadyRevision=revision;
      notified++;
    }
    return notified;
  }

  const jigsawApi={installed:true,bakeMesh,scanScene:scanJigsawScene,defaults:{edgePx:DEFAULT_EDGE_PX,edgeWorldWidth:DEFAULT_EDGE_WORLD},snapshot(){return{meshesBaked:jigsawMeshesBaked,islandsBaked:jigsawIslandsBaked,trianglesBaked:jigsawTrianglesBaked,edgePx:DEFAULT_EDGE_PX,edgeWorldWidth:DEFAULT_EDGE_WORLD};}};
  const chunkApi={installed:true,scanScene:scanChunkScene,snapshot(){return{sourceMeshesChunked,chunksCreated,sourceTrianglesChunked,chunkTiles:CHUNK_TILES,chunkWorldSize:CHUNK_WORLD,chunkCoordinateUnits:'tiles',rejectedTooFewBuckets,rejectedTooManyBuckets};}};

  function wrappedRender(scene,camera){const now=performance.now();scanJigsawScene(scene,now);scanChunkScene(scene,now);notifyTerrainGeometryReady(scene);return originalRender.call(this,scene,camera);}
  wrappedRender.__hobunjiTerrainSurfaceWrapped=true;wrappedRender.__hobunjiTerrainSurfaceOriginal=originalRender;wrappedRender.__hobunjiTerrainChunkApi=chunkApi;wrappedRender.__hobunjiTerrainJigsawApi=jigsawApi;
  rendererProto.render=wrappedRender;window.TerrainRenderChunks=chunkApi;window.TerrainJigsawUV=jigsawApi;
})();
