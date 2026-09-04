// Root Totem-only Shadewood surface/density adapter.
//
// This module does not patch FoliageGenerator or NaturalSurfaceMaterials.
// RootTotemPlants explicitly calls it for its own source trees, so ordinary
// Cloud Forest Shadewoods remain untouched.
(() => {
  'use strict';

  const T = window.THREE;
  const CFG = window.HOBUNJI_ROOT_TOTEM_CONFIG;
  const STYLE = CFG?.shadewoodSurface;

  function materialList(mesh) {
    return Array.isArray(mesh?.material) ? mesh.material.filter(Boolean)
      : mesh?.material ? [mesh.material] : [];
  }

  function isLeafLike(mesh) {
    if (!mesh?.isMesh) return true;
    if (mesh.userData?.noOutline || mesh.userData?.deadzoneBillboardPlane) return true;
    const mats = materialList(mesh);
    return mats.some(mat => mat.transparent === true || Number(mat.alphaTest) > 0);
  }

  function averageColor(mesh) {
    const colors = materialList(mesh).map(mat => mat?.color).filter(color => color?.isColor);
    if (!colors.length) return null;
    const out = { r:0, g:0, b:0 };
    for (const c of colors) { out.r += c.r; out.g += c.g; out.b += c.b; }
    out.r /= colors.length; out.g /= colors.length; out.b /= colors.length;
    return out;
  }

  function classifyMesh(mesh) {
    if (!mesh?.isMesh || isLeafLike(mesh)) return null;
    if (mesh.name === 'climbBranch' || mesh.userData?.isClimbBranch) return STYLE?.trunkSurface || 'trunks';
    const existing = mesh.userData?.rootTotemSurfaceKind || mesh.userData?.naturalSurface;
    if (existing === STYLE?.vineSurface || existing === 'vines') return STYLE?.vineSurface || 'vines';
    if (existing === STYLE?.trunkSurface || existing === 'trunks') return STYLE?.trunkSurface || 'trunks';
    const color = averageColor(mesh);
    if (!color) return STYLE?.trunkSurface || 'trunks';
    const dominance = color.g - Math.max(color.r, color.b);
    return dominance > Number(STYLE?.vineGreenDominanceThreshold || 0)
      ? (STYLE?.vineSurface || 'vines')
      : (STYLE?.trunkSurface || 'trunks');
  }

  function collectSurfaceMeshes(tree) {
    const trunks = [], vines = [];
    tree?.traverse?.(mesh => {
      const surface = classifyMesh(mesh);
      if (!surface) return;
      mesh.userData = { ...(mesh.userData || {}), rootTotemSurfaceKind: surface };
      if (surface === (STYLE?.vineSurface || 'vines')) vines.push(mesh);
      else trunks.push(mesh);
    });
    return { trunks, vines };
  }

  function unionFind(count) {
    const parent = new Int32Array(count);
    const rank = new Uint8Array(count);
    for (let i=0;i<count;i++) parent[i]=i;
    const find = x => {
      let y=x;
      while(parent[y]!==y){ parent[y]=parent[parent[y]]; y=parent[y]; }
      while(parent[x]!==x){ const p=parent[x]; parent[x]=y; x=p; }
      return y;
    };
    const union = (a,b) => {
      a=find(a); b=find(b); if(a===b)return;
      if(rank[a]<rank[b]) parent[a]=b;
      else if(rank[a]>rank[b]) parent[b]=a;
      else { parent[b]=a; rank[a]++; }
    };
    return { find, union };
  }

  function componentsForGeometry(geometry) {
    const pos = geometry?.getAttribute?.('position');
    const index = geometry?.index?.array;
    if (!pos || !index?.length) return [];
    const uf = unionFind(pos.count);
    for (let i=0;i<index.length;i+=3) {
      const a=index[i], b=index[i+1], c=index[i+2];
      uf.union(a,b); uf.union(b,c);
    }
    const map = new Map();
    for (let i=0;i<index.length;i+=3) {
      const tri=[index[i],index[i+1],index[i+2]];
      const root=uf.find(tri[0]);
      let comp=map.get(root);
      if(!comp) map.set(root, comp={ vertices:new Set(), triangles:[], minVertex:Infinity });
      comp.triangles.push(tri);
      for(const v of tri){ comp.vertices.add(v); if(v<comp.minVertex)comp.minVertex=v; }
    }
    return [...map.values()].sort((a,b)=>a.minVertex-b.minVertex);
  }

  function inferredRingSize(component) {
    const first = component.minVertex;
    let candidate = Infinity;
    for (const tri of component.triangles) {
      if (!tri.includes(first)) continue;
      for (const v of tri) {
        const d=v-first;
        if(d>1 && d<candidate)candidate=d;
      }
    }
    if(!Number.isFinite(candidate) || candidate<3) return 0;
    const ordered=[...component.vertices].sort((a,b)=>a-b);
    if(ordered.length % candidate) return 0;
    for(let i=0;i<ordered.length;i+=candidate) {
      const start=ordered[i];
      for(let j=1;j<candidate;j++) if(ordered[i+j]!==start+j) return 0;
    }
    return candidate;
  }

  function thickenComponent(positionArray, component, radiusScale) {
    if (!(radiusScale > 0) || Math.abs(radiusScale-1)<1e-6) return true;
    const ringSize=inferredRingSize(component);
    if(!ringSize) return false;
    const ordered=[...component.vertices].sort((a,b)=>a-b);
    for(let i=0;i<ordered.length;i+=ringSize) {
      let cx=0,cy=0,cz=0;
      for(let j=0;j<ringSize;j++) {
        const p=ordered[i+j]*3;
        cx+=positionArray[p]; cy+=positionArray[p+1]; cz+=positionArray[p+2];
      }
      cx/=ringSize; cy/=ringSize; cz/=ringSize;
      for(let j=0;j<ringSize;j++) {
        const p=ordered[i+j]*3;
        positionArray[p]=cx+(positionArray[p]-cx)*radiusScale;
        positionArray[p+1]=cy+(positionArray[p+1]-cy)*radiusScale;
        positionArray[p+2]=cz+(positionArray[p+2]-cz)*radiusScale;
      }
    }
    return true;
  }

  function targetCount(sourceCount, treeIndex) {
    if (!sourceCount) return 0;
    const scale=Math.max(0,Number(STYLE?.vineCountScale ?? 1));
    const min=Math.max(0,Math.floor(Number(STYLE?.minVineStrands ?? 0)));
    // Cumulative rounding distributes fractional halves across the sequence:
    // five source strands at 0.5 become 2,3,2 across the canonical 3 trees.
    const before=Math.floor(Math.max(0,treeIndex)*sourceCount*scale);
    const after=Math.floor((Math.max(0,treeIndex)+1)*sourceCount*scale);
    return Math.min(sourceCount, Math.max(min, after-before));
  }

  function chooseEvenly(items, count) {
    if(count>=items.length)return new Set(items);
    const out=new Set();
    for(let i=0;i<count;i++) {
      const idx=Math.min(items.length-1,Math.floor((i+0.5)*items.length/count));
      out.add(items[idx]);
    }
    for(const item of items){ if(out.size>=count)break; out.add(item); }
    return out;
  }

  function rebuildGeometry(mesh, keptComponents) {
    const old=mesh.geometry;
    const pos=old?.getAttribute?.('position');
    if(!pos || !keptComponents.length)return false;
    const working=new Float32Array(pos.array);
    let thickened=0;
    for(const comp of keptComponents) {
      if(thickenComponent(working,comp,Number(STYLE?.vineRadiusScale ?? 1))) thickened++;
    }

    const oldToNew=new Map();
    const positions=[];
    const indices=[];
    let next=0;
    for(const comp of keptComponents) {
      const verts=[...comp.vertices].sort((a,b)=>a-b);
      for(const v of verts) {
        if(oldToNew.has(v))continue;
        oldToNew.set(v,next++);
        const p=v*3;
        positions.push(working[p],working[p+1],working[p+2]);
      }
      for(const tri of comp.triangles) {
        indices.push(oldToNew.get(tri[0]),oldToNew.get(tri[1]),oldToNew.get(tri[2]));
      }
    }
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setIndex(new T.BufferAttribute(
      positions.length/3>65535 ? new Uint32Array(indices) : new Uint16Array(indices),1
    ));
    geometry.computeVertexNormals();
    geometry.userData={ ...(old.userData||{}), rootTotemVineGeometry:true };
    mesh.geometry=geometry;
    mesh.userData.rootTotemVineThickenedComponents=thickened;
    return true;
  }

  function tuneVines(tree, treeIndex=0) {
    const { vines }=collectSurfaceMeshes(tree);
    const records=[];
    for(const mesh of vines) {
      const comps=componentsForGeometry(mesh.geometry);
      if(comps.length) for(const comp of comps) records.push({mesh,comp});
      else records.push({mesh,comp:null});
    }
    if(!records.length)return { source:0, kept:0, thickened:0 };

    const keep=targetCount(records.length,treeIndex);
    const chosen=chooseEvenly(records,keep);
    let thickened=0;
    for(const mesh of vines) {
      const meshRecords=records.filter(record=>record.mesh===mesh);
      const keptComps=meshRecords.filter(record=>chosen.has(record)&&record.comp).map(record=>record.comp);
      if(!keptComps.length) {
        mesh.parent?.remove?.(mesh);
        continue;
      }
      // Clone/rebuild only Totem geometry; ordinary/baked Shadewood buffers stay shared.
      if(rebuildGeometry(mesh,keptComps)) thickened+=Number(mesh.userData.rootTotemVineThickenedComponents)||0;
    }
    tree.userData={ ...(tree.userData||{}), rootTotemVineTuning:{
      sourceComponents:records.length, keptComponents:keep,
      countScale:Number(STYLE?.vineCountScale ?? 1),
      radiusScale:Number(STYLE?.vineRadiusScale ?? 1),
      thickenedComponents:thickened,
    }};
    return { source:records.length, kept:keep, thickened };
  }

  function prepareTreeGeometry(tree, options={}) {
    if(!tree || STYLE?.enabled===false)return tree;
    collectSurfaceMeshes(tree);
    tuneVines(tree,Number(options.treeIndex)||0);
    tree.userData={ ...(tree.userData||{}), rootTotemSurfacePrepared:true };
    return tree;
  }

  function finalizeTreeSurface(tree) {
    if(!tree || STYLE?.enabled===false)return tree;
    const surfaces=collectSurfaceMeshes(tree);
    const api=window.NaturalSurfaceMaterials;
    for(const mesh of [...surfaces.trunks,...surfaces.vines]) {
      const surface=mesh.userData.rootTotemSurfaceKind;
      if(STYLE?.reuseNaturalSurfaceMaterials!==false && api?.naturalizeMesh) {
        api.naturalizeMesh(mesh,surface,'cylindrical-stretch');
      }
      if(STYLE?.shellOutline===true) {
        mesh.userData.noOutline=false;
        mesh.layers?.enable?.(1);
      }
    }
    tree.userData={ ...(tree.userData||{}), rootTotemSurfaceFinalized:true,
      rootTotemSurfaceCounts:{ trunks:surfaces.trunks.length, vines:surfaces.vines.length } };
    return tree;
  }

  window.RootTotemSurfaceStyle={
    CONFIG:STYLE,
    classifyMesh,
    collectSurfaceMeshes,
    componentsForGeometry,
    inferredRingSize,
    targetCount,
    tuneVines,
    prepareTreeGeometry,
    finalizeTreeSurface,
  };
})();
