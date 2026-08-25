(() => {
  'use strict';

  // Procedural border terrain surrounding the playable farm, town, and
  // wilderness-zone grids. Town background scenery additionally consumes
  // path/river edge attachments derived from authored map splines or, for
  // legacy maps, from painted edge-water tiles.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function buildBorderTerrain() {
    const BORDER_W = 18, SEED = 2026, BLEND_STEPS = 8;
    const BV = BORDER_W * 2, PVW = deps.COLS * 2, PVH = deps.ROWS * 2;
    const GW = PVW + 2 * BV + 1, GH = PVH + 2 * BV + 1, CW = GW - 1, CH = GH - 1;
    let _s = SEED >>> 0;
    const rng = () => { _s += 0x6D2B79F5; let t = Math.imul(_s ^ _s >>> 15, _s | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const hashDisp = (vi, vj) => { let h = (2166136261 ^ (vi * 374761393) ^ (vj * 668265263)) >>> 0; h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0; return (h / 4294967296 - 0.5) * 0.026; };
    const vSteps = (gi, gj) => { const vi = gi - BV, vj = gj - BV; const dx = Math.max(0, -vi, vi - PVW), dz = Math.max(0, -vj, vj - PVH); return Math.sqrt(dx * dx + dz * dz); };
    const isPlayable = (ci, cj) => ci >= BV && ci < BV + PVW && cj >= BV && cj < BV + PVH;
    const Y = new Float32Array(GW * GH);
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) Y[gj * GW + gi] = deps.NORMAL_TOP + hashDisp(gi - BV, gj - BV);
    const cv4 = (ci, cj) => [cj * GW + ci, cj * GW + ci + 1, (cj + 1) * GW + ci, (cj + 1) * GW + ci + 1];
    function pickGroup(ci0, cj0, maxSz) {
      const group = [], seen = new Set([cj0 * CW + ci0]), front = [[ci0, cj0]];
      while (front.length && group.length < maxSz) {
        const fi = Math.floor(rng() * front.length), [ci, cj] = front.splice(fi, 1)[0]; group.push([ci, cj]);
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) { const ni = ci + dc, nj = cj + dr; if (ni < 0 || ni >= CW || nj < 0 || nj >= CH) continue; const nk = nj * CW + ni; if (seen.has(nk) || isPlayable(ni, nj)) continue; seen.add(nk); front.push([ni, nj]); }
      }
      return group;
    }
    function raiseGroup(group, amount) {
      let maxY = -Infinity; const verts = new Set();
      for (const [ci, cj] of group) for (const vi of cv4(ci, cj)) { verts.add(vi); if (Y[vi] > maxY) maxY = Y[vi]; }
      const target = maxY + amount;
      for (const vi of verts) { const gi = vi % GW, gj = vi / GW | 0, st = vSteps(gi, gj); if (st === 0) continue; const blend = Math.min(1, st / BLEND_STEPS), raised = deps.NORMAL_TOP + hashDisp(gi - BV, gj - BV) + blend * (target - deps.NORMAL_TOP); if (raised > Y[vi]) Y[vi] = raised; }
    }
    function pickCell(outerBias) {
      const rim = BV >> 2;
      for (let attempt = 0; attempt < 300; attempt++) {
        let ci, cj;
        if (rng() < outerBias) { const side = Math.floor(rng() * 4); if (side === 0) { ci = Math.floor(rng() * CW); cj = Math.floor(rng() * rim); } else if (side === 1) { ci = Math.floor(rng() * CW); cj = (CH - 1 - Math.floor(rng() * rim)) | 0; } else if (side === 2) { ci = Math.floor(rng() * rim); cj = Math.floor(rng() * CH); } else { ci = (CW - 1 - Math.floor(rng() * rim)) | 0; cj = Math.floor(rng() * CH); } }
        else { ci = Math.floor(rng() * CW); cj = Math.floor(rng() * CH); }
        if (!isPlayable(ci, cj)) return [ci, cj];
      }
      return [0, 0];
    }
    for (let p = 0; p < 55; p++) { const [ci, cj] = pickCell(0.12); raiseGroup(pickGroup(ci, cj, 4 + Math.floor(rng() * 18)), 0.05 + rng() * 0.32); }
    for (let p = 0; p < 32; p++) { const [ci, cj] = pickCell(0.88); raiseGroup(pickGroup(ci, cj, 10 + Math.floor(rng() * 38)), 0.9 + rng() * 3.2); }
    const RIM_V = 20, RIM_MIN = deps.NORMAL_TOP + 3.0;
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) { if (gj >= RIM_V && gj <= GH - 1 - RIM_V && gi >= RIM_V && gi <= GW - 1 - RIM_V) continue; const k = gj * GW + gi; if (Y[k] < RIM_MIN) Y[k] = RIM_MIN; }
    const pos = new Float32Array(GW * GH * 3), uv = new Float32Array(GW * GH * 2);
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) { const k = gj*GW+gi, wx = (gi - BV) * 0.5, wz = (gj - BV) * 0.5; pos[k*3] = wx; pos[k*3+1] = Y[k]; pos[k*3+2] = wz; uv[k*2] = wx; uv[k*2+1] = wz; }
    const indices = [];
    for (let cj = 0; cj < GH - 1; cj++) for (let ci = 0; ci < GW - 1; ci++) { if (isPlayable(ci, cj)) continue; const v00 = cj*GW+ci, v10=v00+1, v01=(cj+1)*GW+ci, v11=v01+1; indices.push(v00,v01,v11,v00,v11,v10); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, deps.resolveTileMat('farm', deps.TileType.GRASS)); mesh.receiveShadow = true; deps.scene.add(mesh);
    const cliffMat = deps.resolveCliffMat('farm');
    function elevStoneSkin(gjMin, gjMax, giMin, giMax) {
      const positions=[], skinUv=[], idxArr=[]; let vi=0;
      for (let gj=gjMin; gj<gjMax; gj++) for (let gi=giMin; gi<giMax; gi++) { const y00=Y[gj*GW+gi], y10=Y[gj*GW+gi+1], y01=Y[(gj+1)*GW+gi], y11=Y[(gj+1)*GW+gi+1], cnx=-0.5*((y10+y11)-(y00+y01)), cnz=0.5*((y10-y01)-(y11-y00)); if (cnx*cnx+cnz*cnz<=0.194) continue; const x0=(gi-BV)*0.5,x1=x0+0.5,z0=(gj-BV)*0.5,z1=z0+0.5; positions.push(x0,y00,z0,x1,y10,z0,x0,y01,z1,x1,y11,z1); skinUv.push(x0,z0,x1,z0,x0,z1,x1,z1); idxArr.push(vi,vi+2,vi+3,vi,vi+3,vi+1); vi+=4; }
      if (!positions.length) return; const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(skinUv,2)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr),1)); g.computeVertexNormals(); deps.scene.add(new THREE.Mesh(g,cliffMat));
    }
    elevStoneSkin(0,BV,0,GW-1); elevStoneSkin(GH-1-BV,GH-1,0,GW-1); elevStoneSkin(BV,GH-1-BV,0,BV); elevStoneSkin(BV,GH-1-BV,GW-1-BV,GW-1);
  }

  function buildZoneBorderTerrain(zScene, zcols, zrows, mapId, zoneBaseElev = 0, zGrid = null) {
    const BASE = deps.NORMAL_TOP + zoneBaseElev, BORDER_W = 18;
    const SEED = (mapId.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0)) || 1, BLEND_STEPS = 8;
    const BV=BORDER_W*2, PVW=zcols*2, PVH=zrows*2, GW=PVW+2*BV+1, GH=PVH+2*BV+1, CW=GW-1, CH=GH-1;
    let _s=SEED>>>0; const rng=()=>{_s+=0x6D2B79F5;let t=Math.imul(_s^_s>>>15,_s|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
    const hashDisp=(vi,vj)=>{let h=(2166136261^(vi*374761393)^(vj*668265263))>>>0;h=Math.imul(h^h>>>13,1274126177)>>>0;return(h/4294967296-0.5)*0.026;};
    const vSteps=(gi,gj)=>{const vi=gi-BV,vj=gj-BV,dx=Math.max(0,-vi,vi-PVW),dz=Math.max(0,-vj,vj-PVH);return Math.sqrt(dx*dx+dz*dz);};
    const isPlayable=(ci,cj)=>ci>=BV&&ci<BV+PVW&&cj>=BV&&cj<BV+PVH;
    const SEAM_WELD_STEPS=16;
    const nearestEdgeElevTier=(gi,gj)=>{if(!zGrid)return null;const col=deps.clamp(Math.floor((gi-BV)/2),0,zcols-1),row=deps.clamp(Math.floor((gj-BV)/2),0,zrows-1),t=zGrid[row]?.[col];return(t&&typeof t.elevTier==='number')?t.elevTier:null;};
    const Y=new Float32Array(GW*GH);
    for(let gj=0;gj<GH;gj++)for(let gi=0;gi<GW;gi++){const jitter=hashDisp(gi-BV,gj-BV),edgeTier=nearestEdgeElevTier(gi,gj);if(edgeTier===null){Y[gj*GW+gi]=BASE+jitter;continue;}const edgeY=deps.NORMAL_TOP+edgeTier*deps.PLATEAU_UNIT,weld=1-deps.clamp(vSteps(gi,gj)/SEAM_WELD_STEPS,0,1);Y[gj*GW+gi]=BASE+jitter+weld*(edgeY-BASE);}
    const cv4=(ci,cj)=>[cj*GW+ci,cj*GW+ci+1,(cj+1)*GW+ci,(cj+1)*GW+ci+1];
    function pickGroup(ci0,cj0,maxSz){const group=[],seen=new Set([cj0*CW+ci0]),front=[[ci0,cj0]];while(front.length&&group.length<maxSz){const fi=Math.floor(rng()*front.length),[ci,cj]=front.splice(fi,1)[0];group.push([ci,cj]);for(const[dc,dr]of[[1,0],[-1,0],[0,1],[0,-1]]){const ni=ci+dc,nj=cj+dr;if(ni<0||ni>=CW||nj<0||nj>=CH)continue;const nk=nj*CW+ni;if(seen.has(nk)||isPlayable(ni,nj))continue;seen.add(nk);front.push([ni,nj]);}}return group;}
    function raiseGroup(group,amount){let maxY=-Infinity;const verts=new Set();for(const[ci,cj]of group)for(const vi of cv4(ci,cj)){verts.add(vi);if(Y[vi]>maxY)maxY=Y[vi];}const target=maxY+amount;for(const vi of verts){const gi=vi%GW,gj=vi/GW|0,st=vSteps(gi,gj);if(st===0)continue;const blend=Math.min(1,st/BLEND_STEPS),raised=BASE+hashDisp(gi-BV,gj-BV)+blend*(target-BASE);if(raised>Y[vi])Y[vi]=raised;}}
    function pickCell(outerBias){const rim=BV>>2;for(let attempt=0;attempt<300;attempt++){let ci,cj;if(rng()<outerBias){const side=Math.floor(rng()*4);if(side===0){ci=Math.floor(rng()*CW);cj=Math.floor(rng()*rim);}else if(side===1){ci=Math.floor(rng()*CW);cj=(CH-1-Math.floor(rng()*rim))|0;}else if(side===2){ci=Math.floor(rng()*rim);cj=Math.floor(rng()*CH);}else{ci=(CW-1-Math.floor(rng()*rim))|0;cj=Math.floor(rng()*CH);}}else{ci=Math.floor(rng()*CW);cj=Math.floor(rng()*CH);}if(!isPlayable(ci,cj))return[ci,cj];}return[0,0];}
    for(let p=0;p<55;p++){const[ci,cj]=pickCell(0.12);raiseGroup(pickGroup(ci,cj,4+Math.floor(rng()*18)),0.05+rng()*0.32);}for(let p=0;p<32;p++){const[ci,cj]=pickCell(0.88);raiseGroup(pickGroup(ci,cj,10+Math.floor(rng()*38)),0.9+rng()*3.2);}
    const RIM_V=20,RIM_MIN=BASE+3.0;for(let gj=0;gj<GH;gj++)for(let gi=0;gi<GW;gi++){if(gj>=RIM_V&&gj<=GH-1-RIM_V&&gi>=RIM_V&&gi<=GW-1-RIM_V)continue;const k=gj*GW+gi;if(Y[k]<RIM_MIN)Y[k]=RIM_MIN;}
    const pos=new Float32Array(GW*GH*3),uv=new Float32Array(GW*GH*2);for(let gj=0;gj<GH;gj++)for(let gi=0;gi<GW;gi++){const k=gj*GW+gi,wx=(gi-BV)*0.5,wz=(gj-BV)*0.5;pos[k*3]=wx;pos[k*3+1]=Y[k];pos[k*3+2]=wz;uv[k*2]=wx;uv[k*2+1]=wz;}
    const idx=[];for(let cj=0;cj<CH;cj++)for(let ci=0;ci<CW;ci++){if(isPlayable(ci,cj))continue;const[v00,v10,v01,v11]=cv4(ci,cj);idx.push(v00,v01,v11,v00,v11,v10);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setIndex(new THREE.BufferAttribute(idx.length>65535?new Uint32Array(idx):new Uint16Array(idx),1));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,deps.resolveTileMat(mapId,deps.TileType.GRASS));mesh.receiveShadow=true;zScene.add(mesh);
    const cliffMat=deps.resolveCliffMat(mapId);function elevStoneSkin(gjMin,gjMax,giMin,giMax){const skinPos=[],skinUv=[],idxArr=[];let vi=0;for(let gj=gjMin;gj<gjMax;gj++)for(let gi=giMin;gi<giMax;gi++){const y00=Y[gj*GW+gi],y10=Y[gj*GW+gi+1],y01=Y[(gj+1)*GW+gi],y11=Y[(gj+1)*GW+gi+1],cnx=-0.5*((y10+y11)-(y00+y01)),cnz=0.5*((y10-y01)-(y11-y00));if(cnx*cnx+cnz*cnz<=0.194)continue;const x0=(gi-BV)*0.5,x1=x0+0.5,z0=(gj-BV)*0.5,z1=z0+0.5;skinPos.push(x0,y00,z0,x1,y10,z0,x0,y01,z1,x1,y11,z1);skinUv.push(x0,z0,x1,z0,x0,z1,x1,z1);idxArr.push(vi,vi+2,vi+3,vi,vi+3,vi+1);vi+=4;}if(!skinPos.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(skinPos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(skinUv,2));g.setIndex(new THREE.BufferAttribute(idxArr.length>65535?new Uint32Array(idxArr):new Uint16Array(idxArr),1));g.computeVertexNormals();zScene.add(new THREE.Mesh(g,cliffMat));}
    elevStoneSkin(0,BV,0,GW-1);elevStoneSkin(GH-1-BV,GH-1,0,GW-1);elevStoneSkin(BV,GH-1-BV,0,BV);elevStoneSkin(BV,GH-1-BV,GW-1-BV,GW-1);

    const authoredProfile=WILDERNESS_SCENERY_PROFILES[mapId];
    if(authoredProfile) buildAuthoredWildernessScenery(zScene,zcols,zrows,mapId,zoneBaseElev,zGrid,authoredProfile);
  }

  // ── Authored scenery profiles for procedural wilderness maps ─────────────
  // These live outside the generated playable grid. The map itself can reroll,
  // but the profile is authored and attaches itself to the generated edge
  // entrance (currently by scanning the edge PATH run), so Tothal Shift can
  // move the entrance without breaking the scenery composition.
  const WILDERNESS_SCENERY_PROFILES=Object.freeze({
    map_southern_cloud_forest:Object.freeze({
      side:'north', depthTiles:18, riseWorld:5.0, pathMinWidth:3.25,
      pathClearance:1.15, noiseAmp:0.08, bakeChunkWidth:50,
      treeScaleMin:0.92, treeScaleMax:1.08,
      treeRows:Object.freeze([
        Object.freeze({out:2.8,spacing:4.5,offset:0.4}),
        Object.freeze({out:7.7,spacing:4.9,offset:2.25}),
        Object.freeze({out:13.2,spacing:5.35,offset:1.1}),
      ]),
    }),
  });

  function bgFindEdgePathRun(zGrid,zcols,zrows,side){
    if(!zGrid||!zcols||!zrows)return null;
    const isPath=(c,r)=>{const t=String(zGrid?.[r]?.[c]?.type||'').toLowerCase();return t==='path';};
    const horizontal=side==='north'||side==='south',fixed=side==='north'?0:side==='south'?zrows-1:side==='west'?0:zcols-1,limit=horizontal?zcols:zrows,runs=[];
    let start=-1;
    for(let a=0;a<=limit;a++){
      const hit=a<limit&&(horizontal?isPath(a,fixed):isPath(fixed,a));
      if(hit&&start<0)start=a;
      if(!hit&&start>=0){runs.push({start,end:a-1,widthCells:a-start});start=-1;}
    }
    if(!runs.length)return null;
    const centerAxis=limit*0.5;
    runs.sort((a,b)=>b.widthCells-a.widthCells||Math.abs((a.start+a.end+1)*0.5-centerAxis)-Math.abs((b.start+b.end+1)*0.5-centerAxis));
    const best=runs[0];
    return{side,minAxis:best.start,maxAxis:best.end,widthCells:best.widthCells,center:(best.start+best.end+1)*0.5};
  }

  function bgSceneryHash01(a,b,salt=0){let h=(2166136261^(Math.round(a*8)*374761393)^(Math.round(b*8)*668265263)^(salt*2246822519))>>>0;h=Math.imul(h^(h>>>13),1274126177)>>>0;return(h>>>0)/4294967296;}
  function bgSmooth01(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}

  function buildAuthoredWildernessScenery(scene,zcols,zrows,mapId,zoneBaseElev,zGrid,profile){
    if(!scene||!profile||profile.side!=='north'||!zGrid)return;
    scene.userData=scene.userData||{};
    const stamp=`${mapId}:north-authored-v1`;
    if(scene.userData.backgroundSceneryStamp===stamp)return;
    scene.userData.backgroundSceneryStamp=stamp;

    const run=bgFindEdgePathRun(zGrid,zcols,zrows,'north');
    const pathCenter=run?.center??zcols*0.5;
    const pathWidth=Math.max(profile.pathMinWidth,run?.widthCells||0);
    const depth=profile.depthTiles;
    const rawEdgeY=(x)=>{const c=Math.max(0,Math.min(zcols-1,Math.floor(x))),tier=Number(zGrid?.[0]?.[c]?.elevTier);return Number.isFinite(tier)?deps.NORMAL_TOP+tier*deps.PLATEAU_UNIT:deps.NORMAL_TOP+zoneBaseElev;};
    const smoothEdgeY=(x)=>{const c=Math.max(0,Math.min(zcols-1,Math.floor(x)));let total=0,wtotal=0;for(let d=-3;d<=3;d++){const cc=Math.max(0,Math.min(zcols-1,c+d)),tier=Number(zGrid?.[0]?.[cc]?.elevTier),w=4-Math.abs(d);total+=(Number.isFinite(tier)?deps.NORMAL_TOP+tier*deps.PLATEAU_UNIT:deps.NORMAL_TOP+zoneBaseElev)*w;wtotal+=w;}return total/Math.max(1,wtotal);};
    const heightAt=(x,z)=>{const out=Math.max(0,Math.min(depth,-z)),seamBlend=bgSmooth01(out/3),edge=rawEdgeY(x)*(1-seamBlend)+smoothEdgeY(x)*seamBlend,t=out/depth,rise=profile.riseWorld*(0.78*t+0.22*t*t),noise=(bgSceneryHash01(x,out,911)*2-1)*profile.noiseAmp*bgSmooth01(out/2);return edge+rise+noise;};

    // A new grass sheet replaces the visible north-edge drop with one continuous
    // gentle uphill surface. It sits a hair above the generic border terrain so
    // the old procedural skirt remains an invisible fallback underneath it.
    const step=0.5,xCount=Math.round(zcols/step)+1,zCount=Math.round(depth/step)+1,positions=new Float32Array(xCount*zCount*3),uvs=new Float32Array(xCount*zCount*2),indices=[];
    for(let rz=0;rz<zCount;rz++)for(let cx=0;cx<xCount;cx++){const x=Math.min(zcols,cx*step),z=-Math.min(depth,rz*step),k=rz*xCount+cx,y=heightAt(x,z)+0.015;positions[k*3]=x;positions[k*3+1]=y;positions[k*3+2]=z;uvs[k*2]=x;uvs[k*2+1]=z;}
    for(let rz=0;rz<zCount-1;rz++)for(let cx=0;cx<xCount-1;cx++){const v00=rz*xCount+cx,v10=v00+1,v01=(rz+1)*xCount+cx,v11=v01+1;indices.push(v00,v11,v01,v00,v10,v11);}
    const slopeGeo=new THREE.BufferGeometry();slopeGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));slopeGeo.setAttribute('uv',new THREE.BufferAttribute(uvs,2));slopeGeo.setIndex(new THREE.BufferAttribute(positions.length/3>65535?new Uint32Array(indices):new Uint16Array(indices),1));slopeGeo.computeVertexNormals();
    const slope=new THREE.Mesh(slopeGeo,deps.resolveTileMat(mapId,deps.TileType.GRASS));slope.name='AuthoredCloudForestNorthIncline';slope.receiveShadow=true;slope.renderOrder=1;slope.userData.backgroundScenery=true;scene.add(slope);

    // Continue the generated entrance road visibly through the scenery. The
    // forest cut is based on this same run, so the road remains centered even
    // when the proc-gen entrance moves after a Tothal Shift.
    const half=pathWidth*0.5,pathVerts=[],pathUvs=[],pathIdx=[];
    for(let i=0;i<zCount;i++){const z=-Math.min(depth,i*step),lx=Math.max(0,pathCenter-half),rx=Math.min(zcols,pathCenter+half),v=i*2;pathVerts.push(lx,heightAt(lx,z)+0.045,z,rx,heightAt(rx,z)+0.045,z);pathUvs.push(0,-z,pathWidth,-z);if(i){pathIdx.push(v-2,v+1,v,v-2,v-1,v+1);}}
    if(pathVerts.length>=12){const pathGeo=new THREE.BufferGeometry();pathGeo.setAttribute('position',new THREE.Float32BufferAttribute(pathVerts,3));pathGeo.setAttribute('uv',new THREE.Float32BufferAttribute(pathUvs,2));pathGeo.setIndex(pathIdx);pathGeo.computeVertexNormals();let pathMat=null;try{pathMat=deps.resolveTileMat(mapId,deps.TileType.PATH||'path');}catch(_){pathMat=null;}if(!pathMat)pathMat=new THREE.MeshStandardMaterial({color:0x9f8357,roughness:1});const pathMesh=new THREE.Mesh(pathGeo,pathMat);pathMesh.name='AuthoredCloudForestTownPath';pathMesh.renderOrder=3;pathMesh.receiveShadow=true;pathMesh.userData.backgroundScenery=true;scene.add(pathMesh);}

    // Tree positions are authored as a few staggered rows rather than generated
    // from the wilderness seed. The only dynamic cut is the entrance corridor.
    // Each row uses real cached Shadewood variants, then the resulting geometry
    // is baked by material into ~50-tile-wide chunks for low draw-call/object
    // overhead while retaining useful frustum-culling granularity.
    const entries=[],clearHalf=half+profile.pathClearance;
    for(let rowIndex=0;rowIndex<profile.treeRows.length;rowIndex++){
      const row=profile.treeRows[rowIndex];
      for(let x=-2+row.offset;x<=zcols+2;x+=row.spacing){const jx=(bgSceneryHash01(x,row.out,1301+rowIndex)*2-1)*0.62,jz=(bgSceneryHash01(x,row.out,2301+rowIndex)*2-1)*0.48,px=x+jx;if(Math.abs(px-pathCenter)<clearHalf)continue;const pz=-row.out+jz,scale=profile.treeScaleMin+(profile.treeScaleMax-profile.treeScaleMin)*bgSceneryHash01(x,row.out,3301+rowIndex),yaw=(bgSceneryHash01(x,row.out,4301+rowIndex)-0.5)*0.7;entries.push({x:px,y:heightAt(px,pz)+0.02,z:pz,scale,yaw,seedA:Math.round(px*17)+rowIndex*401,seedB:Math.round(row.out*29)+rowIndex*887});}
    }
    bakeShadewoodWall(scene,entries,profile.bakeChunkWidth);
    scene.userData.authoredCloudForestScenery={pathCenter,pathWidth,treeCount:entries.length,baked:true};
  }

  function bakeShadewoodWall(scene,entries,chunkWidth){
    const FG=window.FoliageGenerator;if(!FG?.buildShadewoodMesh||!entries.length)return;
    const chunks=new Map();
    for(const e of entries){const key=Math.floor(e.x/Math.max(8,chunkWidth));if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(e);}
    let chunkOrdinal=0;
    for(const chunkEntries of chunks.values()){
      const buckets=new Map();
      for(const e of chunkEntries){const tree=FG.buildShadewoodMesh(e.seedA,e.seedB);if(!tree)continue;tree.position.set(e.x,e.y,e.z);tree.rotation.y+=e.yaw;tree.scale.multiplyScalar(e.scale);tree.updateMatrixWorld(true);tree.traverse(o=>{if(!o?.isMesh||!o.geometry||!o.material)return;const material=Array.isArray(o.material)?o.material[0]:o.material;if(!material)return;const g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);if(!g.getAttribute('normal'))g.computeVertexNormals();const pa=g.getAttribute('position'),na=g.getAttribute('normal'),ua=g.getAttribute('uv');if(!pa){g.dispose();return;}let b=buckets.get(material);if(!b){b={positions:[],normals:[],uvs:[],indices:[],hasUv:false};buckets.set(material,b);}const base=b.positions.length/3;for(let i=0;i<pa.array.length;i++)b.positions.push(pa.array[i]);if(na){for(let i=0;i<na.array.length;i++)b.normals.push(na.array[i]);}else{for(let i=0;i<pa.count*3;i++)b.normals.push(0);}if(ua){b.hasUv=true;for(let i=0;i<ua.count;i++){b.uvs.push(ua.getX(i),ua.getY(i));}}else{for(let i=0;i<pa.count;i++)b.uvs.push(0,0);}if(g.index){const arr=g.index.array;for(let i=0;i<arr.length;i++)b.indices.push(base+arr[i]);}else{for(let i=0;i<pa.count;i++)b.indices.push(base+i);}g.dispose();});}
      let materialOrdinal=0;
      for(const[material,b]of buckets){if(!b.positions.length)continue;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.normals,3));if(b.hasUv)g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uvs,2));const vCount=b.positions.length/3;g.setIndex(new THREE.BufferAttribute(vCount>65535?new Uint32Array(b.indices):new Uint16Array(b.indices),1));g.computeBoundingSphere();const mesh=new THREE.Mesh(g,material);mesh.name=`AuthoredCloudForestShadewoodWall_${chunkOrdinal}_${materialOrdinal++}`;mesh.castShadow=false;mesh.receiveShadow=true;mesh.frustumCulled=true;mesh.userData.backgroundScenery=true;mesh.userData.bakedForestWall=true;scene.add(mesh);}chunkOrdinal++;
    }
  }

  // ── Shared background-scenery attachment contract ────────────────────────
  // These helpers are deliberately pure and exported as window.BackgroundScenery
  // so the author tool and runtime use the same edge rules.
  const BG_DEFAULTS=Object.freeze({schema:'hobunji_background_scenery.v1',ridgeClearanceTiles:0,borderDepthTiles:18,defaultExtensionLengthTiles:18,routeShoulderTiles:1.5,riverBankTiles:1.25,riverChannelDepth:0.22,waterfallThreshold:0.75,attachments:Object.freeze({})});
  const BG_PATH_DEFAULTS=Object.freeze({pathWidth:3.25,edgeTolerance:0.05,wallRecipeId:'town_path_surface',unitMult:0.55,densityMult:1,rockScale:1.15,preScale:Object.freeze([1,1,0.32]),brickJitter:Object.freeze({rotYDeg:8,shiftU:0.04,shiftV:0.03}),texture:'assets/textures/carved_smooth.png',tint:'#545039'});
  const bgClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const bgEdgeNormal=e=>e==='north'?[0,-1]:e==='south'?[0,1]:e==='west'?[-1,0]:[1,0];
  const bgFinite=(...vals)=>{for(const v of vals){const n=Number(v);if(Number.isFinite(n))return n;}return null;};
  function bgEdgeCandidates(node,map){const[c,r]=node||[];const out=[];if(r===0)out.push('north');if(r===map.rows-1)out.push('south');if(c===0)out.push('west');if(c===map.cols-1)out.push('east');return out;}
  function bgChooseEdge(candidates,rawDir,kind,overrideEdge){if(overrideEdge&&candidates.includes(overrideEdge))return overrideEdge;if(candidates.length<=1)return candidates[0]||null;if(kind==='river'){if(candidates.includes('north'))return'north';if(candidates.includes('south'))return'south';}let best=candidates[0],score=-Infinity;for(const e of candidates){const n=bgEdgeNormal(e),s=rawDir[0]*n[0]+rawDir[1]*n[1];if(s>score){score=s;best=e;}}return best;}
  function bgNormalizeDir(v,fallback){let[x,y]=v||fallback||[0,-1],d=Math.hypot(x,y);if(d<1e-6){[x,y]=fallback||[0,-1];d=Math.hypot(x,y)||1;}return[x/d,y/d];}
  function bgAttachPosition(node,edge,map){const[c,r]=node;if(edge==='north')return[c+0.5,0];if(edge==='south')return[c+0.5,map.rows];if(edge==='west')return[0,r+0.5];return[map.cols,r+0.5];}
  function bgRawDirectionAt(nodes,i,edge){const n=bgEdgeNormal(edge),p=nodes[i];if(i===0&&nodes[1])return[p[0]-nodes[1][0],p[1]-nodes[1][1]];if(i===nodes.length-1&&nodes[i-1])return[p[0]-nodes[i-1][0],p[1]-nodes[i-1][1]];const a=nodes[i-1],b=nodes[i+1],va=a?[p[0]-a[0],p[1]-a[1]]:n,vb=b?[p[0]-b[0],p[1]-b[1]]:n;return(va[0]*n[0]+va[1]*n[1])>=(vb[0]*n[0]+vb[1]*n[1])?va:vb;}
  function bgDirectionFromRaw(raw,edge){const n=bgEdgeNormal(edge);let d=bgNormalizeDir(raw,n),out=d[0]*n[0]+d[1]*n[1];if(out<0.35)d=bgNormalizeDir([d[0]+n[0]*(0.45-out),d[1]+n[1]*(0.45-out)],n);return d;}
  function bgPathEdgePaintWidth(map,node,edge){
    const isPath=(c,r)=>String(map?.tiles?.[`${c},${r}`]?.type||'').toLowerCase()==='path';
    let c=Math.round(Number(node?.[0])),r=Math.round(Number(node?.[1]));if(!Number.isFinite(c)||!Number.isFinite(r))return 0;
    let count=0;
    if(edge==='north'||edge==='south'){
      r=edge==='north'?0:map.rows-1;if(!isPath(c,r))return 0;
      for(let x=c;x>=0&&isPath(x,r);x--)count++;
      for(let x=c+1;x<map.cols&&isPath(x,r);x++)count++;
    }else{
      c=edge==='west'?0:map.cols-1;if(!isPath(c,r))return 0;
      for(let z=r;z>=0&&isPath(c,z);z--)count++;
      for(let z=r+1;z<map.rows&&isPath(c,z);z++)count++;
    }
    return count;
  }
  function bgResolvePathStyle(src,map,node,edge){
    const hook=(src?.backgroundPath&&typeof src.backgroundPath==='object')?src.backgroundPath:(src?.pathSettings&&typeof src.pathSettings==='object'?src.pathSettings:{});
    const brick=(hook.bricks&&typeof hook.bricks==='object')?hook.bricks:(hook.brick&&typeof hook.brick==='object'?hook.brick:(src?.brickSettings&&typeof src.brickSettings==='object'?src.brickSettings:(src?.bricks&&typeof src.bricks==='object'?src.bricks:{})));
    const painted=bgPathEdgePaintWidth(map,node,edge);
    const explicit=bgFinite(src?.pathWidth,hook.pathWidth,hook.width);
    const pathWidth=explicit!==null&&explicit>0?explicit:Math.max(BG_PATH_DEFAULTS.pathWidth,painted||0);
    const preScale=Array.isArray(brick.preScale)&&brick.preScale.length>=3?brick.preScale.slice(0,3).map(Number):BG_PATH_DEFAULTS.preScale.slice();
    const j=brick.brickJitter&&typeof brick.brickJitter==='object'?brick.brickJitter:(hook.brickJitter&&typeof hook.brickJitter==='object'?hook.brickJitter:{});
    return{
      pathWidth,
      edgeTolerance:bgFinite(src?.edgeTolerance,hook.edgeTolerance,BG_PATH_DEFAULTS.edgeTolerance),
      wallRecipeId:String(brick.wallRecipeId||hook.wallRecipeId||src?.pathWallRecipeId||BG_PATH_DEFAULTS.wallRecipeId),
      unitMult:bgFinite(brick.unitMult,hook.unitMult,BG_PATH_DEFAULTS.unitMult),
      densityMult:bgFinite(brick.densityMult,hook.densityMult,BG_PATH_DEFAULTS.densityMult),
      rockScale:bgFinite(brick.rockScale,hook.rockScale,BG_PATH_DEFAULTS.rockScale),
      preScale:preScale.every(Number.isFinite)?preScale:BG_PATH_DEFAULTS.preScale.slice(),
      brickJitter:{rotYDeg:bgFinite(j.rotYDeg,BG_PATH_DEFAULTS.brickJitter.rotYDeg),shiftU:bgFinite(j.shiftU,BG_PATH_DEFAULTS.brickJitter.shiftU),shiftV:bgFinite(j.shiftV,BG_PATH_DEFAULTS.brickJitter.shiftV)},
      texture:String(brick.texture||hook.texture||BG_PATH_DEFAULTS.texture),
      tint:String(brick.tint||hook.tint||BG_PATH_DEFAULTS.tint),
      paintedEdgeWidth:painted,
    };
  }

  function bgWaterTileRuns(map) {
    const waterTypes = new Set(['river', 'stream', 'waterfall']);
    const edgeValues = { north: [], south: [], west: [], east: [] };
    for (const [key, tile] of Object.entries(map?.tiles || {})) {
      if (!waterTypes.has(String(tile?.type || '').toLowerCase())) continue;
      const [c, r] = key.split(',').map(Number);
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      if (r === 0) edgeValues.north.push({ axis: c, c, r, type: tile.type });
      if (r === map.rows - 1) edgeValues.south.push({ axis: c, c, r, type: tile.type });
      if (c === 0) edgeValues.west.push({ axis: r, c, r, type: tile.type });
      if (c === map.cols - 1) edgeValues.east.push({ axis: r, c, r, type: tile.type });
    }
    const runs = [];
    for (const side of ['north','south','west','east']) {
      const items = edgeValues[side].sort((a,b)=>a.axis-b.axis);
      let run = [];
      const flush = () => { if (run.length) runs.push({ side, items: run }); run = []; };
      for (const item of items) {
        if (run.length && item.axis > run[run.length-1].axis + 1) flush();
        run.push(item);
      }
      flush();
    }
    return runs;
  }

  // Older exterior maps paint their river/stream tiles but don't serialize a
  // `rivers` spline array. In that case derive stable boundary centerlines from
  // contiguous water runs on each tile edge. Corner spill (a wide north-entry
  // stream also occupying a few west-edge cells) is suppressed in favour of
  // north/south so one waterway doesn't create a bogus second attachment.
  function bgInferWaterAttachments(map) {
    const runs = bgWaterTileRuns(map);
    if (!runs.length) return [];
    const near = (run, end) => {
      const vals = run.items.map(x => x.axis);
      return end === 'start' ? Math.min(...vals) <= 2 : Math.max(...vals) >= ((run.side === 'north' || run.side === 'south') ? map.cols - 3 : map.rows - 3);
    };
    const hasCornerRun = (side, end) => runs.some(r => r.side === side && near(r, end));
    const filtered = runs.filter(run => {
      if (run.side === 'west' && near(run,'start') && hasCornerRun('north','start')) return false;
      if (run.side === 'west' && near(run,'end') && hasCornerRun('south','start')) return false;
      if (run.side === 'east' && near(run,'start') && hasCornerRun('north','end')) return false;
      if (run.side === 'east' && near(run,'end') && hasCornerRun('south','end')) return false;
      return true;
    });
    return filtered.map((run, index) => {
      const side = run.side;
      const axisCenter = run.items.reduce((sum, item) => sum + item.axis + 0.5, 0) / run.items.length;
      const node = side === 'north' ? [axisCenter - 0.5, 0]
        : side === 'south' ? [axisCenter - 0.5, map.rows - 1]
        : side === 'west' ? [0, axisCenter - 0.5]
        : [map.cols - 1, axisCenter - 0.5];
      const types = run.items.map(item => String(item.type || '').toLowerCase());
      const sourceType = types.includes('river') ? 'river' : types.includes('waterfall') ? 'waterfall' : 'stream';
      const n = bgEdgeNormal(side);
      const startAxis = run.items[0].axis, endAxis = run.items[run.items.length - 1].axis;
      return {
        id: `river:edge-water:${side}:${startAxis}-${endAxis}`,
        kind: 'river',
        sourceId: `edge-water-${side}-${index}`,
        sourceLabel: `${side} edge ${sourceType}`,
        sourceType,
        nodeIndex: 0,
        node,
        mapCols: map.cols,
        mapRows: map.rows,
        candidateEdges: [side],
        edge: side,
        position: bgAttachPosition(node, side, map),
        rawDirection: n,
        direction: n,
        width: Math.max(1, run.items.length),
        seed: ((startAxis + 1) * 73856093 ^ (endAxis + 1) * 19349663 ^ index * 83492791) >>> 0,
        paintTiles: true,
        inferredFromEdgeTiles: true,
      };
    });
  }

  function collectBoundaryAttachments(map){
    if(!map||!Number.isFinite(map.cols)||!Number.isFinite(map.rows))return[];
    const saved=map.backgroundScenery?.attachments||{},out=[];
    const scan=(items,kind)=>{for(const src of items||[]){const nodes=Array.isArray(src.nodes)?src.nodes:[];for(let i=0;i<nodes.length;i++){const cand=bgEdgeCandidates(nodes[i],map);if(!cand.length)continue;const id=`${kind}:${src.id||'unnamed'}:${i===0?'start':i===nodes.length-1?'end':`node-${i}`}`;const raw=bgRawDirectionAt(nodes,i,cand[0]),edge=bgChooseEdge(cand,raw,kind,saved[id]?.edge),pathStyle=kind==='route'?bgResolvePathStyle(src,map,nodes[i],edge):null,width=kind==='route'?pathStyle.pathWidth:Math.max(0.25,Number(src.width)||(src.kind==='stream'?1:3));out.push({id,kind,sourceId:src.id||'',sourceLabel:src.label||src.id||kind,sourceType:kind==='route'?'path':(src.kind||'river'),nodeIndex:i,node:[nodes[i][0],nodes[i][1]],mapCols:map.cols,mapRows:map.rows,candidateEdges:cand,edge,position:bgAttachPosition(nodes[i],edge,map),rawDirection:raw,direction:bgDirectionFromRaw(raw,edge),width,seed:Number(src.seed)||1,paintTiles:src.paintTiles!==false,pathStyle});}}};
    scan(map.routes,'route');
    scan(map.rivers,'river');
    if (!out.some(a => a.kind === 'river')) out.push(...bgInferWaterAttachments(map));
    return out;
  }
  function resolveBackgroundSceneryConfig(map){const raw=map?.backgroundScenery&&typeof map.backgroundScenery==='object'?map.backgroundScenery:{};return{schema:'hobunji_background_scenery.v1',ridgeClearanceTiles:bgClamp(Number.isFinite(Number(raw.ridgeClearanceTiles))?Number(raw.ridgeClearanceTiles):BG_DEFAULTS.ridgeClearanceTiles,0,8),borderDepthTiles:bgClamp(Number.isFinite(Number(raw.borderDepthTiles))?Number(raw.borderDepthTiles):BG_DEFAULTS.borderDepthTiles,6,30),defaultExtensionLengthTiles:bgClamp(Number.isFinite(Number(raw.defaultExtensionLengthTiles))?Number(raw.defaultExtensionLengthTiles):BG_DEFAULTS.defaultExtensionLengthTiles,1,40),routeShoulderTiles:bgClamp(Number.isFinite(Number(raw.routeShoulderTiles))?Number(raw.routeShoulderTiles):BG_DEFAULTS.routeShoulderTiles,0,8),riverBankTiles:bgClamp(Number.isFinite(Number(raw.riverBankTiles))?Number(raw.riverBankTiles):BG_DEFAULTS.riverBankTiles,0,8),riverChannelDepth:bgClamp(Number.isFinite(Number(raw.riverChannelDepth))?Number(raw.riverChannelDepth):BG_DEFAULTS.riverChannelDepth,0,2),waterfallThreshold:bgClamp(Number.isFinite(Number(raw.waterfallThreshold))?Number(raw.waterfallThreshold):BG_DEFAULTS.waterfallThreshold,0.1,5),attachments:raw.attachments&&typeof raw.attachments==='object'?JSON.parse(JSON.stringify(raw.attachments)): {}};}
  function resolveAttachmentSettings(a,s,o={}){return{enabled:o.enabled!==false,edge:a.candidateEdges.includes(o.edge)?o.edge:a.edge,lengthTiles:bgClamp(Number.isFinite(Number(o.lengthTiles))?Number(o.lengthTiles):s.defaultExtensionLengthTiles,1,40),widthScale:bgClamp(Number.isFinite(Number(o.widthScale))?Number(o.widthScale):1,0.25,4),shoulderTiles:bgClamp(Number.isFinite(Number(o.shoulderTiles))?Number(o.shoulderTiles):s.routeShoulderTiles,0,8),bankTiles:bgClamp(Number.isFinite(Number(o.bankTiles))?Number(o.bankTiles):s.riverBankTiles,0,8),channelDepth:bgClamp(Number.isFinite(Number(o.channelDepth))?Number(o.channelDepth):s.riverChannelDepth,0,2),waterfallThreshold:bgClamp(Number.isFinite(Number(o.waterfallThreshold))?Number(o.waterfallThreshold):s.waterfallThreshold,0.1,5)};}
  function bgHash01(seed,salt){let h=((seed>>>0)^Math.imul((salt+1)>>>0,0x9e3779b1))>>>0;h=Math.imul(h^(h>>>16),0x21f0aaad)>>>0;h=Math.imul(h^(h>>>15),0x735a2d97)>>>0;return((h^(h>>>15))>>>0)/4294967296;}
  function buildContinuationPolyline(a,s,o={}){const e=resolveAttachmentSettings(a,s,o),start=bgAttachPosition(a.node,e.edge,{cols:a.mapCols,rows:a.mapRows}),cp=Array.isArray(o.controlPoints)?o.controlPoints.filter(p=>Array.isArray(p)&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]))).map(p=>[Number(p[0]),Number(p[1])]):[];if(cp.length)return[start,...cp];const d=bgDirectionFromRaw(a.rawDirection,e.edge);if(a.kind==='river'){const perp=[-d[1],d[0]],amp=(a.sourceType==='stream'?0.7:1.25)*Math.min(1,e.lengthTiles/8),pts=[start];for(let i=1;i<=4;i++){const t=i/4,wobble=(bgHash01(a.seed,a.nodeIndex*17+i)*2-1)*amp*Math.sin(Math.PI*t);pts.push([start[0]+d[0]*e.lengthTiles*t+perp[0]*wobble,start[1]+d[1]*e.lengthTiles*t+perp[1]*wobble]);}return pts;}return[start,[start[0]+d[0]*e.lengthTiles,start[1]+d[1]*e.lengthTiles]];}
  function bgDistToSegment(px,pz,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],d2=dx*dx+dz*dz;if(d2<1e-8)return Math.hypot(px-a[0],pz-a[1]);const t=bgClamp(((px-a[0])*dx+(pz-a[1])*dz)/d2,0,1),x=a[0]+dx*t,z=a[1]+dz*t;return Math.hypot(px-x,pz-z);}
  function bgDistToPolyline(px,pz,pts){let best=Infinity;for(let i=0;i<pts.length-1;i++)best=Math.min(best,bgDistToSegment(px,pz,pts[i],pts[i+1]));return best;}
  function bgDensify(pts,step=0.5){if(pts.length<2)return pts.slice();const out=[pts[0].slice()];for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/step));for(let j=1;j<=n;j++){const t=j/n;out.push([a[0]+dx*t,a[1]+dz*t]);}}return out;}
  function bgOutwardDistance(c,p){const n=bgEdgeNormal(c.settings.edge),s=c.points[0];return Math.max(0,(p[0]-s[0])*n[0]+(p[1]-s[1])*n[1]);}
  window.BackgroundScenery={DEFAULTS:BG_DEFAULTS,PATH_DEFAULTS:BG_PATH_DEFAULTS,WILDERNESS_PROFILES:WILDERNESS_SCENERY_PROFILES,edgeNormal:bgEdgeNormal,collectBoundaryAttachments,resolveConfig:resolveBackgroundSceneryConfig,resolveAttachmentSettings,buildContinuationPolyline,inferWaterAttachments:bgInferWaterAttachments,findEdgePathRun:bgFindEdgePathRun};

  // Scenery paths use the same WallBuilder paving recipe/tint/brick transform
  // settings as the normal path-brick renderer in game.js. The attachment hook
  // carries the source route's usable paving settings, with playable-path
  // defaults only filling fields that were not authored.
  const SCENERY_PATH_RECIPE_ID = 'town_path_surface';
  const SCENERY_PATH_CHUNK_SIZE = 10;
  let sceneryPathWallBuilder = null;
  let sceneryPathReadyPromise = null;
  let sceneryPathGroups = [];
  function ensureSceneryPathSurfaceReady(style=BG_PATH_DEFAULTS) {
    if (sceneryPathReadyPromise) return sceneryPathReadyPromise;
    if (typeof WallBuilder === 'undefined') return Promise.reject(new Error('WallBuilder unavailable'));
    sceneryPathWallBuilder = new WallBuilder({ glbBasePath: 'assets/models/' });
    sceneryPathReadyPromise = Promise.all([
      sceneryPathWallBuilder.loadDefaultGlb(),
      fetch('assets/models/recipes/walls/wallrecipe2.json').then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching wallrecipe2.json');
        return r.json();
      }),
    ]).then(([, recipe]) => {
      sceneryPathWallBuilder.addRecipe(SCENERY_PATH_RECIPE_ID, recipe);
      sceneryPathWallBuilder.tintDefaultGlb(style.texture||BG_PATH_DEFAULTS.texture,style.tint||BG_PATH_DEFAULTS.tint);
    });
    return sceneryPathReadyPromise;
  }
  function clearSceneryPathGroups(townScene) {
    for (const group of sceneryPathGroups) {
      townScene?.remove(group);
      try { WallBuilder.disposeGroup(group); } catch (_) {}
    }
    sceneryPathGroups = [];
  }
  function buildSceneryPathBrickSurface(routeContinuations, townScene, sampleHeight) {
    clearSceneryPathGroups(townScene);
    if (!routeContinuations.length) return Promise.resolve(false);
    const style=routeContinuations[0].a.pathStyle||BG_PATH_DEFAULTS;
    return ensureSceneryPathSurfaceReady(style).then(() => {
      const containsPoint = (x, z) => routeContinuations.some(c => bgDistToPolyline(x, z, c.points) <= c.a.width * c.settings.widthScale * 0.5 + (c.a.pathStyle?.edgeTolerance||0));
      let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,maxHalf=0;
      for (const c of routeContinuations) {
        maxHalf = Math.max(maxHalf, c.a.width * c.settings.widthScale * 0.5);
        for (const p of c.points) { minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minZ=Math.min(minZ,p[1]);maxZ=Math.max(maxZ,p[1]); }
      }
      minX-=maxHalf+0.8;maxX+=maxHalf+0.8;minZ-=maxHalf+0.8;maxZ+=maxHalf+0.8;
      const size=SCENERY_PATH_CHUNK_SIZE;
      for(let cz=Math.floor(minZ/size)*size;cz<maxZ;cz+=size){
        for(let cx=Math.floor(minX/size)*size;cx<maxX;cx+=size){
          const y=deps.NORMAL_TOP+0.01;
          const panel={id:'scenery_path_surface_chunk',width:size,height:size,wallRecipeId:SCENERY_PATH_RECIPE_ID,position:[cx+size/2,y,cz+size/2],rotationDeg:[0,0,0],corners:[[cx,y,cz+size],[cx+size,y,cz+size],[cx+size,y,cz],[cx,y,cz]]};
          const opts={usePlaceholder:true,unitMult:style.unitMult,densityMult:style.densityMult,rockScale:style.rockScale,preScale:style.preScale.slice(),brickJitter:{...style.brickJitter}};
          const group=sceneryPathWallBuilder.build([panel],opts);
          group.name='SceneryPathBrickSurfaceChunk';
          const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
          let anyKept=false;
          group.traverse(o=>{
            if(!o.isInstancedMesh)return;
            const n=o.count;let kept=0;
            for(let i=0;i<n;i++){
              o.getMatrixAt(i,m);m.decompose(p,q,s);
              if(!containsPoint(p.x,p.z))continue;
              p.y+=sampleHeight(p.x,p.z)-deps.NORMAL_TOP;
              m.compose(p,q,s);
              if(kept!==i)o.setMatrixAt(kept,m);
              kept++;
            }
            o.count=kept;o.instanceMatrix.needsUpdate=true;o.castShadow=true;o.receiveShadow=true;if(kept)anyKept=true;
          });
          if(!anyKept){WallBuilder.disposeGroup(group);continue;}
          townScene.add(group);sceneryPathGroups.push(group);
        }
      }
      return sceneryPathGroups.length>0;
    });
  }

  let _townBorderGrassPoints=[];
  let townBorderGrassBillMesh=null;
  function _buildTownBorderGrassBillboards(){const grassBillboardMat=deps.getGrassBillboardMat(),townScene=deps.getTownScene();if(!grassBillboardMat)return;if(townBorderGrassBillMesh){townScene.remove(townBorderGrassBillMesh);townBorderGrassBillMesh=null;}const pts=_townBorderGrassPoints;if(!pts.length)return;const BLADES=6;townBorderGrassBillMesh=new THREE.InstancedMesh(deps.grassBladeGeo,grassBillboardMat,pts.length*BLADES*2);townBorderGrassBillMesh.frustumCulled=false;townBorderGrassBillMesh.visible=deps.getGrassEnabled();townBorderGrassBillMesh.userData.isBillboard=true;const dummy=new THREE.Object3D();let idx=0;for(const{px,pz,py,seed}of pts){const rand=deps.mbRng(seed);for(let b=0;b<BLADES;b++){const ox=(rand()-0.5)*0.7,oz=(rand()-0.5)*0.7,w=0.16+rand()*0.10,h=0.22+rand()*0.14,rot=rand()*Math.PI;dummy.position.set(px+ox,py,pz+oz);dummy.rotation.set(0,rot,0);dummy.scale.set(w,h,1);dummy.updateMatrix();townBorderGrassBillMesh.setMatrixAt(idx++,dummy.matrix);dummy.rotation.set(0,rot+Math.PI*0.5,0);dummy.updateMatrix();townBorderGrassBillMesh.setMatrixAt(idx++,dummy.matrix);}}townBorderGrassBillMesh.count=idx;townBorderGrassBillMesh.instanceMatrix.needsUpdate=true;townScene.add(townBorderGrassBillMesh);}

  function buildTownBorderTerrain(){
    const townScene=deps.getTownScene(),townZone=deps.getTownZone(),TCOLS=townZone?.cols||60,TROWS=townZone?.rows||50;
    const scenery=resolveBackgroundSceneryConfig(townZone||{cols:TCOLS,rows:TROWS}),BORDER_W=Math.max(6,Math.round(scenery.borderDepthTiles)),SEED=4077,BLEND_STEPS=8;
    const BV=BORDER_W*2,PVW=TCOLS*2,PVH=TROWS*2,GW=PVW+2*BV+1,GH=PVH+2*BV+1,CW=GW-1,CH=GH-1;
    const attachments=collectBoundaryAttachments(townZone||{cols:TCOLS,rows:TROWS,routes:[],rivers:[]});
    const continuations=attachments.map(a=>{const o=scenery.attachments[a.id]||{},settings=resolveAttachmentSettings(a,scenery,o);return{a,settings,points:buildContinuationPolyline(a,scenery,o)};}).filter(c=>c.settings.enabled);
    const routeContinuations=continuations.filter(c=>c.a.kind==='route'),riverContinuations=continuations.filter(c=>c.a.kind==='river');
    let _s=SEED>>>0;const rng=()=>{_s+=0x6D2B79F5;let t=Math.imul(_s^_s>>>15,_s|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
    const hashDisp=(vi,vj)=>{let h=(2166136261^(vi*374761393)^(vj*668265263))>>>0;h=Math.imul(h^h>>>13,1274126177)>>>0;return(h/4294967296-0.5)*0.026;};
    const vSteps=(gi,gj)=>{const vi=gi-BV,vj=gj-BV,dx=Math.max(0,-vi,vi-PVW),dz=Math.max(0,-vj,vj-PVH);return Math.sqrt(dx*dx+dz*dz);};
    const isPlayable=(ci,cj)=>ci>=BV&&ci<BV+PVW&&cj>=BV&&cj<BV+PVH;
    const Y=new Float32Array(GW*GH);for(let gj=0;gj<GH;gj++)for(let gi=0;gi<GW;gi++)Y[gj*GW+gi]=deps.NORMAL_TOP+hashDisp(gi-BV,gj-BV);
    const cv4=(ci,cj)=>[cj*GW+ci,cj*GW+ci+1,(cj+1)*GW+ci,(cj+1)*GW+ci+1];
    function pickGroup(ci0,cj0,maxSz){const group=[],seen=new Set([cj0*CW+ci0]),front=[[ci0,cj0]];while(front.length&&group.length<maxSz){const fi=Math.floor(rng()*front.length),[ci,cj]=front.splice(fi,1)[0];group.push([ci,cj]);for(const[dc,dr]of[[1,0],[-1,0],[0,1],[0,-1]]){const ni=ci+dc,nj=cj+dr;if(ni<0||ni>=CW||nj<0||nj>=CH)continue;const nk=nj*CW+ni;if(seen.has(nk)||isPlayable(ni,nj))continue;seen.add(nk);front.push([ni,nj]);}}return group;}
    function raiseGroup(group,amount){let maxY=-Infinity;const verts=new Set();for(const[ci,cj]of group)for(const vi of cv4(ci,cj)){verts.add(vi);if(Y[vi]>maxY)maxY=Y[vi];}const target=maxY+amount;for(const vi of verts){const gi=vi%GW,gj=vi/GW|0,st=vSteps(gi,gj);if(st===0)continue;const blend=Math.min(1,st/BLEND_STEPS),raised=deps.NORMAL_TOP+hashDisp(gi-BV,gj-BV)+blend*(target-deps.NORMAL_TOP);if(raised>Y[vi])Y[vi]=raised;}}
    function pickCell(outerBias,sides){const rim=BV>>2;for(let attempt=0;attempt<300;attempt++){let ci,cj;if(rng()<outerBias){const side=sides[Math.floor(rng()*sides.length)];if(side===0){ci=Math.floor(rng()*CW);cj=Math.floor(rng()*rim);}else if(side===1){ci=Math.floor(rng()*CW);cj=(CH-1-Math.floor(rng()*rim))|0;}else if(side===2){ci=Math.floor(rng()*rim);cj=Math.floor(rng()*CH);}else{ci=(CW-1-Math.floor(rng()*rim))|0;cj=Math.floor(rng()*CH);}}else{ci=Math.floor(rng()*CW);cj=Math.floor(rng()*CH);}if(!isPlayable(ci,cj))return[ci,cj];}return[0,0];}
    for(let p=0;p<55;p++){const[ci,cj]=pickCell(0.12,[0,1,2,3]);raiseGroup(pickGroup(ci,cj,4+Math.floor(rng()*18)),0.05+rng()*0.32);}
    const cliffGroups=[];for(let p=0;p<32;p++){const[ci,cj]=pickCell(0.88,[0,2,3]),group=pickGroup(ci,cj,10+Math.floor(rng()*38));raiseGroup(group,0.9+rng()*3.2);cliffGroups.push(group);}let subGroups=cliffGroups;for(const[count,sizeRange,amtRange]of[[3,[3,17],[0.4,2.2]],[2,[2,8],[0.2,1.0]]]){const next=[];for(const group of subGroups){const n=1+Math.floor(rng()*count);for(let s=0;s<n;s++){const[sci,scj]=group[Math.floor(rng()*group.length)],sub=pickGroup(sci,scj,sizeRange[0]+Math.floor(rng()*(sizeRange[1]-sizeRange[0])));raiseGroup(sub,amtRange[0]+rng()*(amtRange[1]-amtRange[0]));next.push(sub);}}subGroups=next;}
    const ridgeNoise=(gi,gj)=>{const qi=Math.round(gi/5),qj=Math.round(gj/5);let h=(2166136261^(qi*374761393)^(qj*668265263))>>>0;h=Math.imul(h^h>>>13,1274126177)>>>0;return(h>>>0)/4294967296;};
    const rimMinAt=(gi,gj)=>deps.NORMAL_TOP+2.2+ridgeNoise(gi,gj)*3.2,clearSteps=scenery.ridgeClearanceTiles*2;
    const inRoute=(wx,wz)=>routeContinuations.some(c=>bgDistToPolyline(wx,wz,c.points)<=c.a.width*c.settings.widthScale*0.5+c.settings.shoulderTiles);
    for(let gj=0;gj<GH;gj++)for(let gi=0;gi<GW;gi++){const north=BV-gj,west=BV-gi,east=gi-(BV+PVW),nearN=north>clearSteps,nearW=west>clearSteps,nearE=east>clearSteps;if(!nearN&&!nearW&&!nearE)continue;const wx=(gi-BV)*0.5,wz=(gj-BV)*0.5;if(inRoute(wx,wz))continue;const k=gj*GW+gi,r=rimMinAt(gi,gj);if(Y[k]<r)Y[k]=r;}
    // Legacy fallback keeps old canyon openings for maps authored before spline edge attachments existed.
    if(!routeContinuations.length){const carve=(giMin,giMax,gjMin,gjMax)=>{for(let gj=gjMin;gj<gjMax;gj++)for(let gi=giMin;gi<giMax;gi++)Y[gj*GW+gi]=deps.NORMAL_TOP+hashDisp(gi-BV,gj-BV);},toViRange=(a,b)=>[BV+a*2,BV+(b+1)*2],n=toViRange(25,35),w=toViRange(20,30),e=toViRange(20,30);carve(n[0],n[1],0,BV);carve(0,BV,w[0],w[1]);carve(BV+PVW,GW-1,e[0],e[1]);}
    const sampleTerrain=(x,z)=>{const gx=bgClamp(x*2+BV,0,GW-1),gz=bgClamp(z*2+BV,0,GH-1),x0=Math.floor(gx),z0=Math.floor(gz),x1=Math.min(GW-1,x0+1),z1=Math.min(GH-1,z0+1),tx=gx-x0,tz=gz-z0,a=Y[z0*GW+x0]*(1-tx)+Y[z0*GW+x1]*tx,b=Y[z1*GW+x0]*(1-tx)+Y[z1*GW+x1]*tx;return a*(1-tz)+b*tz;};
    // A river that meets a tall scenery ridge gets an explicit cliff-lip profile.
    // The upper channel is carved into the high terrain but stops short of the
    // playable edge, preserving a vertical face for the waterfall itself.
    for(const c of riverContinuations){
      const start=c.points[0],n=bgEdgeNormal(c.settings.edge),probeDist=Math.min(Math.max(2.0,c.a.width*c.settings.widthScale*0.75),Math.max(2.0,c.settings.lengthTiles*0.28)),probe=[start[0]+n[0]*probeDist,start[1]+n[1]*probeDist],edgeY=sampleTerrain(start[0],start[1]),probeY=sampleTerrain(probe[0],probe[1]);
      if(probeY-edgeY>=c.settings.waterfallThreshold){const lipDistance=Math.min(1.2,Math.max(0.55,c.a.width*c.settings.widthScale*0.20)),highY=Math.max(edgeY+c.settings.waterfallThreshold,probeY-Math.max(0.08,c.settings.channelDepth*0.35));c.waterfallProfile={edgeY,highY,lipDistance,probeDist};}
    }
    // Paths flatten their core and blend through shoulders. Ordinary rivers use
    // a shallow channel cut. Waterfall rivers instead carve the upper channel
    // down to a stable high-side bed while leaving the lip/cliff face intact.
    for(let gj=0;gj<GH;gj++)for(let gi=0;gi<GW;gi++){if(vSteps(gi,gj)===0)continue;const wx=(gi-BV)*0.5,wz=(gj-BV)*0.5,k=gj*GW+gi,base=deps.NORMAL_TOP+hashDisp(gi-BV,gj-BV);for(const c of routeContinuations){const half=c.a.width*c.settings.widthScale*0.5,d=bgDistToPolyline(wx,wz,c.points),shoulder=c.settings.shoulderTiles;if(d>half+shoulder)continue;const weight=d<=half?1:shoulder>0?1-(d-half)/shoulder:0,s=weight*weight*(3-2*weight);Y[k]=Y[k]+(base-Y[k])*s;}for(const c of riverContinuations){const half=c.a.width*c.settings.widthScale*0.5,d=bgDistToPolyline(wx,wz,c.points),bank=c.settings.bankTiles;if(d>half+bank)continue;const weight=d<=half?1:bank>0?1-(d-half)/bank:0;if(c.waterfallProfile){const out=bgOutwardDistance(c,[wx,wz]);if(out<c.waterfallProfile.lipDistance)continue;const bedY=c.waterfallProfile.highY-Math.max(0.08,c.settings.channelDepth),target=Math.min(Y[k],bedY);Y[k]=Y[k]+(target-Y[k])*weight;}else{const minY=base-0.35;Y[k]=Math.max(minY,Y[k]-c.settings.channelDepth*weight);}}}
    const sampleHeight=(x,z)=>{const gx=bgClamp(x*2+BV,0,GW-1),gz=bgClamp(z*2+BV,0,GH-1),x0=Math.floor(gx),z0=Math.floor(gz),x1=Math.min(GW-1,x0+1),z1=Math.min(GH-1,z0+1),tx=gx-x0,tz=gz-z0,a=Y[z0*GW+x0]*(1-tx)+Y[z0*GW+x1]*tx,b=Y[z1*GW+x0]*(1-tx)+Y[z1*GW+x1]*tx;return a*(1-tz)+b*tz;};
    const pos=new Float32Array(GW*GH*3),uv=new Float32Array(GW*GH*2);for(let gj=0;gj<GH;gj++)for(let gi=0;gi<GW;gi++){const k=gj*GW+gi,wx=(gi-BV)*0.5,wz=(gj-BV)*0.5;pos[k*3]=wx;pos[k*3+1]=Y[k];pos[k*3+2]=wz;uv[k*2]=wx;uv[k*2+1]=wz;}
    const indices=[];for(let cj=0;cj<GH-1;cj++)for(let ci=0;ci<GW-1;ci++){if(isPlayable(ci,cj))continue;const v00=cj*GW+ci,v10=v00+1,v01=(cj+1)*GW+ci,v11=v01+1;indices.push(v00,v01,v11,v00,v11,v10);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setIndex(new THREE.BufferAttribute((pos.length/3>65535)?new Uint32Array(indices):new Uint16Array(indices),1));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,deps.resolveTileMat('map_hobunji_town',deps.TileType.GRASS));mesh.receiveShadow=true;townScene.add(mesh);
    const cliffMat=deps.resolveCliffMat('map_hobunji_town');function elevStoneSkin(gjMin,gjMax,giMin,giMax){const positions=[],skinUv=[],idxArr=[];let vi=0;for(let gj=gjMin;gj<gjMax;gj++)for(let gi=giMin;gi<giMax;gi++){const y00=Y[gj*GW+gi],y10=Y[gj*GW+gi+1],y01=Y[(gj+1)*GW+gi],y11=Y[(gj+1)*GW+gi+1],cnx=-0.5*((y10+y11)-(y00+y01)),cnz=0.5*((y10-y01)-(y11-y00));if(cnx*cnx+cnz*cnz<=0.194)continue;const x0=(gi-BV)*0.5,x1=x0+0.5,z0=(gj-BV)*0.5,z1=z0+0.5;positions.push(x0,y00,z0,x1,y10,z0,x0,y01,z1,x1,y11,z1);skinUv.push(x0,z0,x1,z0,x0,z1,x1,z1);idxArr.push(vi,vi+2,vi+3,vi,vi+3,vi+1);vi+=4;}if(!positions.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(skinUv,2));g.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr),1));g.computeVertexNormals();townScene.add(new THREE.Mesh(g,cliffMat));}
    elevStoneSkin(0,BV,0,GW-1);elevStoneSkin(BV,GH-1-BV,0,BV);elevStoneSkin(BV,GH-1-BV,GW-1-BV,GW-1);elevStoneSkin(GH-1-BV,GH-1,0,BV);elevStoneSkin(GH-1-BV,GH-1,GW-1-BV,GW-1);
    function addRibbon(c,material,yLift,heightFn=null,minOut=0){const samples=bgDensify(c.points,0.45).filter(p=>bgOutwardDistance(c,p)+1e-5>=minOut);if(samples.length<2)return null;const verts=[],uvs=[],idx=[];let vDist=0;for(let i=0;i<samples.length;i++){const p=samples[i],p0=samples[Math.max(0,i-1)],p1=samples[Math.min(samples.length-1,i+1)],dx=p1[0]-p0[0],dz=p1[1]-p0[1],dl=Math.hypot(dx,dz)||1,px=-dz/dl,pz=dx/dl,half=c.a.width*c.settings.widthScale*0.5,y=(heightFn?heightFn(p):sampleHeight(p[0],p[1]))+yLift;if(i)vDist+=Math.hypot(p[0]-samples[i-1][0],p[1]-samples[i-1][1]);verts.push(p[0]+px*half,y,p[1]+pz*half,p[0]-px*half,y,p[1]-pz*half);uvs.push(0,vDist,Math.max(1,c.a.width*c.settings.widthScale),vDist);if(i){const v=i*2;idx.push(v-2,v,v+1,v-2,v+1,v-1);}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(idx);g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.renderOrder=2;townScene.add(m);return{samples,mesh:m};}

    // Use the same WallBuilder paving recipe as normal playable paths. Keep a
    // flat-material fallback only for a failed recipe/GLB load.
    buildSceneryPathBrickSurface(routeContinuations,townScene,sampleHeight).then(built=>{
      if(built)return;
      let pathMat=null;try{pathMat=deps.resolveTileMat('map_hobunji_town',deps.TileType.PATH||'path');}catch(_){pathMat=null;}if(!pathMat)pathMat=new THREE.MeshStandardMaterial({color:0x9f8357,roughness:1});for(const c of routeContinuations)addRibbon(c,pathMat,0.025);
    }).catch(()=>{
      let pathMat=null;try{pathMat=deps.resolveTileMat('map_hobunji_town',deps.TileType.PATH||'path');}catch(_){pathMat=null;}if(!pathMat)pathMat=new THREE.MeshStandardMaterial({color:0x9f8357,roughness:1});for(const c of routeContinuations)addRibbon(c,pathMat,0.025);
    });

    const waterMat=new THREE.MeshStandardMaterial({color:0x4f9fbd,transparent:true,opacity:0.78,roughness:0.28,metalness:0,side:THREE.DoubleSide,depthWrite:false});
    for(const c of riverContinuations){
      if(c.waterfallProfile){
        const profile=c.waterfallProfile,topY=profile.highY+0.035,botY=profile.edgeY+0.035;
        addRibbon(c,waterMat,0,p=>profile.highY+0.035,profile.lipDistance);
        const start=c.points[0],n=bgEdgeNormal(c.settings.edge),lip=[start[0]+n[0]*profile.lipDistance,start[1]+n[1]*profile.lipDistance],dense=bgDensify(c.points,0.45),near=dense.find(p=>bgOutwardDistance(c,p)>=profile.lipDistance)||dense[1]||c.points[1],dx=near[0]-start[0],dz=near[1]-start[1],dl=Math.hypot(dx,dz)||1,px=-dz/dl,pz=dx/dl,half=c.a.width*c.settings.widthScale*0.5,v=[lip[0]+px*half,topY,lip[1]+pz*half,lip[0]-px*half,topY,lip[1]-pz*half,lip[0]+px*half,botY,lip[1]+pz*half,lip[0]-px*half,botY,lip[1]-pz*half],g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,0,0,1,0],2));g.setIndex([0,2,3,0,3,1]);g.computeVertexNormals();const fall=new THREE.Mesh(g,waterMat);fall.name='BackgroundSceneryWaterfall';fall.renderOrder=3;townScene.add(fall);
        continue;
      }
      const built=addRibbon(c,waterMat,0.035);if(!built)continue;const s=built.samples;for(let i=0;i<s.length-1;i++){const a=s[i],b=s[i+1],ya=sampleHeight(a[0],a[1])+0.035,yb=sampleHeight(b[0],b[1])+0.035;if(Math.abs(ya-yb)<c.settings.waterfallThreshold)continue;const mx=(a[0]+b[0])*0.5,mz=(a[1]+b[1])*0.5,dx=b[0]-a[0],dz=b[1]-a[1],dl=Math.hypot(dx,dz)||1,px=-dz/dl,pz=dx/dl,half=c.a.width*c.settings.widthScale*0.5,top=Math.max(ya,yb),bot=Math.min(ya,yb),v=[mx+px*half,top,mz+pz*half,mx-px*half,top,mz-pz*half,mx+px*half,bot,mz+pz*half,mx-px*half,bot,mz-pz*half],g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,0,0,1,0],2));g.setIndex([0,2,3,0,3,1]);g.computeVertexNormals();const fall=new THREE.Mesh(g,waterMat);fall.renderOrder=3;townScene.add(fall);}
    }
    _townBorderGrassPoints=[];for(let cj=0;cj<CH;cj++)for(let ci=0;ci<CW;ci++){if(isPlayable(ci,cj)||vSteps(ci,cj)>16)continue;const y00=Y[cj*GW+ci],y10=Y[cj*GW+ci+1],y01=Y[(cj+1)*GW+ci],y11=Y[(cj+1)*GW+ci+1],cnx=-0.5*((y10+y11)-(y00+y01)),cnz=0.5*((y10-y01)-(y11-y00));if(cnx*cnx+cnz*cnz>0.194)continue;const seed=(ci*7919+cj*104173)>>>0;if(deps.mbRng(seed)()>0.44)continue;const px=(ci-BV)*0.5+0.25,pz=(cj-BV)*0.5+0.25,py=(y00+y10+y01+y11)/4;_townBorderGrassPoints.push({px,pz,py,seed});}_buildTownBorderGrassBillboards();
    if(window.FoliageGenerator){const STEP=4;for(let cj=BV+PVH;cj<CH;cj+=STEP){const depth=cj-(BV+PVH);if(depth>22)continue;for(let ci=0;ci<CW;ci+=STEP){const px=(ci-BV)*0.5+0.25,pz=(cj-BV)*0.5+0.25;if(routeContinuations.some(c=>bgDistToPolyline(px,pz,c.points)<=c.a.width*c.settings.widthScale*0.5+c.settings.shoulderTiles+0.75))continue;const seed=(777+ci*7919+cj*104173)>>>0,r=deps.mbRng(seed);if(r()>0.22)continue;const y00=Y[cj*GW+ci],y10=Y[cj*GW+ci+1],y01=Y[(cj+1)*GW+ci],y11=Y[(cj+1)*GW+ci+1],cnx=-0.5*((y10+y11)-(y00+y01)),cnz=0.5*((y10-y01)-(y11-y00));if(cnx*cnx+cnz*cnz>0.194)continue;const py=(y00+y10+y01+y11)/4,vegGroup=window.FoliageGenerator.buildShrubMesh(1000+ci,1000+cj),sc=1.6+r()*1.2;vegGroup.scale.set(sc,sc,sc);vegGroup.rotation.y=r()*Math.PI*2;vegGroup.position.set(px,py,pz);townScene.add(vegGroup);deps.markOutline(vegGroup);}}}
  }

  function setGrassVisible(enabled){if(townBorderGrassBillMesh)townBorderGrassBillMesh.visible=enabled;}
  window.BorderTerrain={init,buildBorderTerrain,buildZoneBorderTerrain,buildTownBorderTerrain,buildTownBorderGrassBillboards:_buildTownBorderGrassBillboards,setGrassVisible};
})();

// Cloud Forest north-edge authored scenery v2. Kept as a wrapper around the
// generic border module so the density/culling experiment stays isolated from
// the shared farm/town/wilderness border math above.
(() => {
  'use strict';

  const CLOUD_ID = 'map_southern_cloud_forest';
  const NORTH_DEPTH = 18;
  const BASE_TREE_SPACING_WORLD = 1;
  // Chunk footprint (was 10x6): each chunk's own cullSphere.radius grows with
  // its half-diagonal, and that radius gets ADDED to the player's chosen cull
  // radius in updateZoneVegetationCulling — so oversized chunks silently
  // floor out how small a "cull radius" setting can actually get (10x6 pinned
  // the effective minimum to ~15 tiles even with the slider at its own
  // minimum of 5). Shrinking depth more than width, since Z is the axis that
  // actually determines distance-from-player as you approach the wall from
  // the south. More, smaller chunks means more draw calls (partially offsets
  // the merge win below), so this isn't shrunk to the floor — see `pad`
  // below for why a further reduction now runs into a harder floor.
  const FOREST_CHUNK_WIDTH = 6;
  const FOREST_CHUNK_DEPTH = 3;
  const PATH_CLEARANCE = 1.15;

  function _hash01(x, z, salt = 0) {
    let h = (2166136261 ^ (Math.round(x * 8) * 374761393) ^ (Math.round(z * 8) * 668265263) ^ (salt * 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h >>> 0) / 4294967296;
  }

  function removeCloudForestNorthBoundaryCliffs(workspace) {
    const root = workspace?.maps?.find(m => !m?.isSubmap) || workspace?.maps?.[0];
    if (!root?.tiles) return workspace;
    let removed = 0;
    for (const [key, tile] of Object.entries(root.tiles)) {
      if (!tile?.borderEscarpment || tile.borderEscarpmentSide !== 'north') continue;
      const [c, r] = key.split(',').map(Number);
      let inward = null;
      for (let d = 1; d <= 24 && r + d < root.rows; d++) {
        const candidate = root.tiles[`${c},${r + d}`];
        if (!candidate || candidate.borderEscarpment || candidate.distantBoundaryLandscape) continue;
        inward = candidate;
        break;
      }
      if (inward?.plateau) tile.plateau = inward.plateau;
      else delete tile.plateau;
      if (tile.type === 'rock') tile.type = 'grass';
      if (tile.plateau) tile.borderEntryGate = true;
      else delete tile.borderEntryGate;
      delete tile.borderEscarpment;
      delete tile.generatedBorderEscarpment;
      delete tile.borderEscarpmentDepth;
      delete tile.borderEscarpmentSide;
      delete tile.borderEscarpmentHeightBonus;
      removed++;
    }
    if (removed) {
      root.generatedFrom = { ...(root.generatedFrom || {}), northBoundaryCliffsRemoved: removed };
      workspace.generatorPreset = { ...(workspace.generatorPreset || {}), northBoundaryCliffsRemoved: true };
    }
    return workspace;
  }

  function buildDenseCloudForestLayout(zcols, depth, pathCenter, clearHalf, heightAt = () => 0) {
    const entries = [];
    const insidePath = x => Math.abs(x - pathCenter) < clearHalf;
    const add = (x, z, scale, layer, salt) => {
      if (x < 0 || x > zcols || z > -0.35 || z < -depth + 0.25 || insidePath(x)) return;
      entries.push({
        x, z, y: heightAt(x, z) + 0.02, scale, layer,
        yaw: (_hash01(x, z, 7100 + salt) - 0.5) * 0.34,
        seedA: Math.round(x * 97 + (-z) * 31 + salt * 503),
        seedB: Math.round((-z) * 89 + x * 17 + salt * 997),
      });
    };

    // Wilderness TREE_SPACING_MIN_DIST is 1 final tile. Final wilderness tile
    // coordinates map 1:1 to world units, so the full-height layer uses a
    // literal one-world-unit center lattice without pretending this scenery is
    // itself tile-authored.
    for (let z = 0.5; z < depth; z += BASE_TREE_SPACING_WORLD) {
      for (let x = 0.5; x < zcols; x += BASE_TREE_SPACING_WORLD) add(x, -z, 1, 'full', 1);
    }
    // 75% trees occupy square gaps between four full-height centers.
    for (let z = 1; z < depth; z += BASE_TREE_SPACING_WORLD) {
      for (let x = 1; x < zcols; x += BASE_TREE_SPACING_WORLD) add(x, -z, 0.75, 'threeQuarter', 2);
    }
    // 50% trees occupy alternating edge-midpoint gaps so the wall becomes
    // nearly visually solid while avoiding exact center overlaps.
    for (let iz = 0; iz < Math.floor(depth); iz++) {
      for (let ix = 0; ix < Math.floor(zcols); ix++) {
        if (((ix + iz) & 1) === 0) add(ix + 1, -(iz + 0.5), 0.5, 'half', 3);
        else add(ix + 0.5, -(iz + 1), 0.5, 'half', 4);
      }
    }
    return entries;
  }

  function makeInclineSampler(slope, zcols, depth = NORTH_DEPTH) {
    const pos = slope?.geometry?.getAttribute?.('position');
    if (!pos?.array?.length) return () => 0;
    const step = 0.5;
    const xCount = Math.round(zcols / step) + 1;
    const zCount = Math.round(depth / step) + 1;
    const yAt = (ix, iz) => pos.array[(Math.max(0, Math.min(zCount - 1, iz)) * xCount + Math.max(0, Math.min(xCount - 1, ix))) * 3 + 1] || 0;
    return (x, z) => {
      const gx = Math.max(0, Math.min(xCount - 1, x / step));
      const gz = Math.max(0, Math.min(zCount - 1, -z / step));
      const x0 = Math.floor(gx), z0 = Math.floor(gz), x1 = Math.min(xCount - 1, x0 + 1), z1 = Math.min(zCount - 1, z0 + 1);
      const tx = gx - x0, tz = gz - z0;
      const a = yAt(x0, z0) * (1 - tx) + yAt(x1, z0) * tx;
      const b = yAt(x0, z1) * (1 - tx) + yAt(x1, z1) * tx;
      return a * (1 - tz) + b * tz;
    };
  }

  function removeSceneObject(scene, object) {
    if (!scene || !object) return;
    scene.remove?.(object);
    if (Array.isArray(scene.items)) {
      const i = scene.items.indexOf(object);
      if (i >= 0) scene.items.splice(i, 1);
    }
    object.geometry?.dispose?.();
  }

  function replaceNorthRuntimeCliff(scene, added, slope, zcols, heightAt) {
    const generic = added.find(o => o?.geometry?.getAttribute?.('position') && !o?.userData?.backgroundScenery);
    if (generic) {
      const p = generic.geometry.getAttribute('position');
      let changed = false;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX ? p.getX(i) : p.array[i * 3];
        const z = p.getZ ? p.getZ(i) : p.array[i * 3 + 2];
        if (x < 0 || x > zcols || z > 0 || z < -NORTH_DEPTH) continue;
        const y = heightAt(x, z) - 0.02;
        if (p.setY) p.setY(i, y); else p.array[i * 3 + 1] = y;
        changed = true;
      }
      if (changed) {
        p.needsUpdate = true;
        generic.geometry.computeVertexNormals?.();
        generic.geometry.computeBoundingBox?.();
        generic.geometry.computeBoundingSphere?.();
      }
    }

    // Generic wilderness stone skins are added one side at a time. Delete only
    // the skin whose complete Z bounds live north of the playable seam.
    for (const obj of added) {
      if (obj === generic || obj === slope || obj?.userData?.backgroundScenery || !obj?.geometry) continue;
      obj.geometry.computeBoundingBox?.();
      const box = obj.geometry.boundingBox;
      if (box && box.max.z <= 0.001 && box.min.z < -0.05) removeSceneObject(scene, obj);
    }
  }

  // Groups meshes that RENDER identically (same material class, color,
  // emissive, texture, blend/side state) instead of by material object
  // identity. FoliageGenerator's hexBarkMat() allocates a brand new
  // MeshLambertMaterial on every call — even for the same authored bark/vine
  // color — so every tree's trunk, climb branch, and vine mesh previously got
  // its own unique material object, which alongside each tree's own uniquely-
  // shaped procedural geometry (see mergeTreeGeometriesWithTransform below)
  // meant no two trees' meshes could ever land in the same instancing bucket.
  function _sceneryMaterialMergeKey(material) {
    if (!material) return 'none';
    return [
      material.type,
      material.color?.isColor ? material.color.getHexString() : '',
      material.emissive?.isColor ? material.emissive.getHexString() : '',
      material.map ? (material.map.uuid || material.map.id || material.map.name) : 'no-map',
      material.transparent ? 1 : 0,
      material.alphaTest || 0,
      material.side ?? '',
    ].join('|');
  }

  // Bakes each source mesh's world-space transform into its own vertex
  // positions and concatenates them into one static BufferGeometry. Real
  // GPU instancing (InstancedMesh) needs identical geometry across
  // instances; these procedurally-varied trees never have that, so static
  // merging — one draw call per material per chunk regardless of how many
  // uniquely-shaped trees it holds — is the only merge that actually reduces
  // draw calls here. Safe specifically because this scenery is static
  // background dressing (no per-tree runtime transform, fade, or pick
  // target) rather than a general-purpose utility.
  function mergeTreeGeometriesWithTransform(entries) {
    let totalV = 0, totalI = 0, anyUv = false;
    for (const e of entries) {
      const pos = e.geometry?.getAttribute?.('position');
      if (!pos?.count || !e.geometry.index) continue;
      totalV += pos.count;
      totalI += e.geometry.index.count;
      if (e.geometry.getAttribute('uv')) anyUv = true;
    }
    if (!totalV) return null;
    const pos = new Float32Array(totalV * 3);
    const uv = anyUv ? new Float32Array(totalV * 2) : null;
    const idx = new (totalV > 65535 ? Uint32Array : Uint16Array)(totalI);
    const v = new THREE.Vector3();
    let vOff = 0, iOff = 0;
    for (const e of entries) {
      const srcPos = e.geometry?.getAttribute?.('position');
      const srcIdx = e.geometry?.index;
      if (!srcPos?.count || !srcIdx) continue;
      for (let i = 0; i < srcPos.count; i++) {
        v.set(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i)).applyMatrix4(e.matrix);
        pos[(vOff + i) * 3] = v.x;
        pos[(vOff + i) * 3 + 1] = v.y;
        pos[(vOff + i) * 3 + 2] = v.z;
      }
      if (uv) {
        const srcUv = e.geometry.getAttribute('uv');
        for (let i = 0; i < srcPos.count; i++) {
          uv[(vOff + i) * 2] = srcUv ? srcUv.getX(i) : 0;
          uv[(vOff + i) * 2 + 1] = srcUv ? srcUv.getY(i) : 0;
        }
      }
      const arr = srcIdx.array;
      for (let i = 0; i < arr.length; i++) idx[iOff + i] = arr[i] + vOff;
      vOff += srcPos.count;
      iOff += arr.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeVertexNormals?.();
    return out;
  }

  // Cloud Forest Tree Wall outline pass draws layer 1 as a solid inverted-hull
  // silhouette (see game.js's shell-outline renderer / _markOutline) —
  // opacity-independent, so a flat alpha-cutout leaf card would draw a fully
  // opaque black outline over whatever it's supposed to let show through.
  // Matches foliage-generator.js's own noOutline rule for the same reason.
  function _isAlphaCardMaterial(material) {
    const mats = Array.isArray(material) ? material : [material];
    return mats.some(m => m && (m.transparent || Number(m.alphaTest) > 0 || m.depthWrite === false));
  }

  function instanceDenseShadewoodForest(scene, entries, options = {}) {
    const FG = window.FoliageGenerator;
    if (!FG?.buildShadewoodMesh || !entries.length || typeof THREE === 'undefined') return { chunks: 0, instances: 0 };
    // Density has to be decided per source tree, before any geometry is
    // merged — see the call site's comment for why. keepEvery=4 for a 0.25
    // keepFraction reproduces the previous "quarter density" look via
    // deterministic list-order thinning instead of post-hoc instance-count
    // truncation (which needed a true InstancedMesh to exist in the first
    // place).
    const keepFraction = Math.max(0.0001, Math.min(1, Number(options.keepFraction) || 1));
    const keepEvery = Math.max(1, Math.round(1 / keepFraction));
    const tagOutlineLayer = options.tagOutlineLayer === true;
    const chunkMap = new Map();
    for (const e of entries) {
      const key = `${Math.floor(e.x / FOREST_CHUNK_WIDTH)},${Math.floor((-e.z) / FOREST_CHUNK_DEPTH)}`;
      let list = chunkMap.get(key);
      if (!list) chunkMap.set(key, list = []);
      list.push(e);
    }

    let chunkCount = 0, instanceCount = 0;
    for (const list of chunkMap.values()) {
      const buckets = new Map(); // materialMergeKey -> { material, parts: [{geometry, matrix}] }
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < list.length; i++) {
        if (keepEvery > 1 && i % keepEvery !== 0) continue;
        const e = list[i];
        minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x); minZ = Math.min(minZ, e.z); maxZ = Math.max(maxZ, e.z);
        const tree = FG.buildShadewoodMesh(e.seedA, e.seedB);
        if (!tree) continue;
        tree.position.set(e.x, e.y, e.z);
        tree.rotation.y += e.yaw;
        tree.scale.multiplyScalar(e.scale);
        tree.updateMatrixWorld(true);
        tree.traverse(o => {
          if (!o?.isMesh || !o.geometry || !o.material) return;
          const material = Array.isArray(o.material) ? o.material[0] : o.material;
          if (!material) return;
          const key = _sceneryMaterialMergeKey(material);
          let bucket = buckets.get(key);
          if (!bucket) buckets.set(key, bucket = { material, parts: [] });
          bucket.parts.push({ geometry: o.geometry, matrix: o.matrixWorld.clone() });
        });
        instanceCount++;
      }
      if (!buckets.size) continue;
      const group = new THREE.Group();
      group.name = `AuthoredCloudForestDenseChunk_${chunkCount}`;
      for (const { material, parts } of buckets.values()) {
        const merged = mergeTreeGeometriesWithTransform(parts);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        // Parent-level cullSphere participates in the existing ~7 Hz
        // camera-aligned vegetation culler. Disable frustum testing so a base
        // geometry sphere spanning the whole merged chunk cannot incorrectly
        // reject part of it.
        mesh.frustumCulled = false;
        mesh.userData.backgroundScenery = true;
        if (tagOutlineLayer && !_isAlphaCardMaterial(material)) {
          mesh.layers?.enable?.(window.CloudForestSceneryOptions?.OUTLINE_LAYER ?? 1);
          mesh.userData.cloudForestShellOutline = true;
        }
        group.add(mesh);
      }
      const cx = (minX + maxX) * 0.5, cz = (minZ + maxZ) * 0.5;
      // This pad is now the dominant term in xzRadius as chunks shrink — even
      // at a near-zero chunk footprint, xzRadius bottoms out around
      // pad*sqrt(2) (~4.5 tiles). Shrinking it further to tighten the cull
      // radius floor beyond that would need reducing pad itself (a buffer
      // against pop-in at the ~7Hz vegetation-culling check rate), traded
      // against how well thick fog hides that pop-in.
      const pad = 3.2;
      const xzRadius = Math.hypot((maxX - minX) * 0.5 + pad, (maxZ - minZ) * 0.5 + pad);
      group.userData.backgroundScenery = true;
      group.userData.denseForestWall = true;
      group.userData.skipOcclusionFade = true;
      group.userData.cullSphere = { x: cx, z: cz, radius: xzRadius, xzRadius };
      scene.add?.(group);
      if (Array.isArray(scene.items) && !scene.items.includes(group)) scene.items.push(group);
      chunkCount++;
    }
    return { chunks: chunkCount, instances: instanceCount };
  }

  function installGeneratorPatch() {
    const gen = window.WildernessMapGenerator;
    if (!gen?.generateZoneWorkspace || gen.__cloudForestNorthNoCliffPatch) return;
    const original = gen.generateZoneWorkspace;
    gen.generateZoneWorkspace = function (zoneMapId, ...args) {
      const value = original.call(this, zoneMapId, ...args);
      const apply = workspace => zoneMapId === CLOUD_ID ? removeCloudForestNorthBoundaryCliffs(workspace) : workspace;
      return value && typeof value.then === 'function' ? value.then(apply) : apply(value);
    };
    gen.__cloudForestNorthNoCliffPatch = true;
  }

  function installBorderPatch() {
    const BT = window.BorderTerrain;
    if (!BT?.buildZoneBorderTerrain || BT.__cloudForestDenseNorthPatch) return;
    const original = BT.buildZoneBorderTerrain;
    BT.buildZoneBorderTerrain = function (scene, zcols, zrows, mapId, zoneBaseElev = 0, zGrid = null) {
      const before = new Set(scene?.children || scene?.items || []);
      const result = original.call(this, scene, zcols, zrows, mapId, zoneBaseElev, zGrid);
      if (mapId !== CLOUD_ID || !scene) return result;
      const collection = scene.children || scene.items || [];
      const added = collection.filter(o => !before.has(o));
      const slope = added.find(o => o?.name === 'AuthoredCloudForestNorthIncline') || collection.find(o => o?.name === 'AuthoredCloudForestNorthIncline');
      if (!slope) return result;
      const heightAt = makeInclineSampler(slope, zcols, NORTH_DEPTH);

      // The earlier sparse experiment physically copied every tree's vertices.
      // Remove it before building the dense instanced wall.
      for (const obj of [...collection]) if (obj?.userData?.bakedForestWall) removeSceneObject(scene, obj);
      replaceNorthRuntimeCliff(scene, added, slope, zcols, heightAt);

      const meta = scene.userData?.authoredCloudForestScenery || {};
      const pathCenter = Number.isFinite(meta.pathCenter) ? meta.pathCenter : zcols * 0.5;
      const pathWidth = Math.max(3.25, Number(meta.pathWidth) || 0);
      const clearHalf = pathWidth * 0.5 + PATH_CLEARANCE;
      const layout = buildDenseCloudForestLayout(zcols, NORTH_DEPTH, pathCenter, clearHalf, heightAt);
      // Cloud Forest Tree Wall setting (cloud-forest-scenery-options.js, loaded
      // earlier — see its own installGeneratorPatch/installBorderPatch guard
      // comments for why this direction of coupling, rather than the reverse,
      // is the one that's actually load-order-safe here) decides whether the
      // wall renders sparse+outlined or not at all; "not at all" is handled by
      // that module deleting this group afterward (see clearForestWall), so
      // this only needs to decide the ON-mode density/outline treatment.
      // Density has to be decided HERE, per source tree, before merging their
      // geometry — once merged into one static mesh per material (see
      // mergeTreeGeometriesWithTransform), there's no instance boundary left
      // to selectively thin the way a true InstancedMesh could be post-hoc.
      const sceneryOptions = window.CloudForestSceneryOptions;
      const treeWallOn = sceneryOptions?.treeWallEnabled?.() !== false;
      // Tree Wall OFF deletes this whole group afterward (see
      // cloud-forest-scenery-options.js's clearForestWall) — building it at
      // full, unthinned density (every full/0.75/0.5-scale gap-filler tree
      // buildDenseCloudForestLayout generates, not just the 25% kept when the
      // wall is actually shown) just to immediately throw it away wastes a
      // synchronous merge of several times the ON-mode geometry into a
      // handful of oversized static buffers for nothing. Skip the build
      // entirely instead.
      const stats = treeWallOn
        ? instanceDenseShadewoodForest(scene, layout, { keepFraction: sceneryOptions?.DENSITY_KEEP ?? 0.25, tagOutlineLayer: true })
        : { chunks: 0, instances: 0 };
      scene.userData = scene.userData || {};
      scene.userData.authoredCloudForestScenery = {
        ...meta,
        pathCenter,
        pathWidth,
        treeCount: layout.length,
        fullHeightCount: layout.filter(e => e.scale === 1).length,
        threeQuarterCount: layout.filter(e => e.scale === 0.75).length,
        halfHeightCount: layout.filter(e => e.scale === 0.5).length,
        baseTreeSpacingWorld: BASE_TREE_SPACING_WORLD,
        merged: treeWallOn,
        cullChunks: stats.chunks,
        northBoundaryCliffsRemoved: true,
      };
      return result;
    };
    BT.__cloudForestDenseNorthPatch = true;
    BT.removeCloudForestNorthBoundaryCliffs = removeCloudForestNorthBoundaryCliffs;
    BT.buildDenseCloudForestLayout = buildDenseCloudForestLayout;
    BT.CLOUD_FOREST_BASE_TREE_SPACING_WORLD = BASE_TREE_SPACING_WORLD;
  }

  installGeneratorPatch();
  installBorderPatch();
})();
