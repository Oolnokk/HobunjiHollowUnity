(() => {
  'use strict';

  // Procedural border terrain surrounding the playable farm, town, and
  // wilderness-zone grids. Town background scenery additionally consumes
  // path/river edge attachments derived from authored map splines.
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
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) { const k = gj * GW + gi, wx = (gi - BV) * 0.5, wz = (gj - BV) * 0.5; pos[k*3] = wx; pos[k*3+1] = Y[k]; pos[k*3+2] = wz; uv[k*2] = wx; uv[k*2+1] = wz; }
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
  }

  // ── Shared background-scenery attachment contract ────────────────────────
  // These helpers are deliberately pure and exported as window.BackgroundScenery
  // so the dedicated author tool and the runtime use the exact same edge rules.
  const BG_DEFAULTS=Object.freeze({schema:'hobunji_background_scenery.v1',ridgeClearanceTiles:0,borderDepthTiles:18,defaultExtensionLengthTiles:18,routeShoulderTiles:1.5,riverBankTiles:1.25,riverChannelDepth:0.22,waterfallThreshold:0.75,attachments:Object.freeze({})});
  const bgClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const bgEdgeNormal=e=>e==='north'?[0,-1]:e==='south'?[0,1]:e==='west'?[-1,0]:[1,0];
  function bgEdgeCandidates(node,map){const[c,r]=node||[];const out=[];if(r===0)out.push('north');if(r===map.rows-1)out.push('south');if(c===0)out.push('west');if(c===map.cols-1)out.push('east');return out;}
  function bgChooseEdge(candidates,rawDir,kind,overrideEdge){if(overrideEdge&&candidates.includes(overrideEdge))return overrideEdge;if(candidates.length<=1)return candidates[0]||null;if(kind==='river'){if(candidates.includes('north'))return'north';if(candidates.includes('south'))return'south';}let best=candidates[0],score=-Infinity;for(const e of candidates){const n=bgEdgeNormal(e),s=rawDir[0]*n[0]+rawDir[1]*n[1];if(s>score){score=s;best=e;}}return best;}
  function bgNormalizeDir(v,fallback){let[x,y]=v||fallback||[0,-1],d=Math.hypot(x,y);if(d<1e-6){[x,y]=fallback||[0,-1];d=Math.hypot(x,y)||1;}return[x/d,y/d];}
  function bgAttachPosition(node,edge,map){const[c,r]=node;if(edge==='north')return[c+0.5,0];if(edge==='south')return[c+0.5,map.rows];if(edge==='west')return[0,r+0.5];return[map.cols,r+0.5];}
  function bgRawDirectionAt(nodes,i,edge){const n=bgEdgeNormal(edge),p=nodes[i];if(i===0&&nodes[1])return[p[0]-nodes[1][0],p[1]-nodes[1][1]];if(i===nodes.length-1&&nodes[i-1])return[p[0]-nodes[i-1][0],p[1]-nodes[i-1][1]];const a=nodes[i-1],b=nodes[i+1],va=a?[p[0]-a[0],p[1]-a[1]]:n,vb=b?[p[0]-b[0],p[1]-b[1]]:n;return(va[0]*n[0]+va[1]*n[1])>=(vb[0]*n[0]+vb[1]*n[1])?va:vb;}
  function bgDirectionFromRaw(raw,edge){const n=bgEdgeNormal(edge);let d=bgNormalizeDir(raw,n),out=d[0]*n[0]+d[1]*n[1];if(out<0.35)d=bgNormalizeDir([d[0]+n[0]*(0.45-out),d[1]+n[1]*(0.45-out)],n);return d;}
  function collectBoundaryAttachments(map){
    if(!map||!Number.isFinite(map.cols)||!Number.isFinite(map.rows))return[];
    const saved=map.backgroundScenery?.attachments||{},out=[];
    const scan=(items,kind)=>{for(const src of items||[]){const nodes=Array.isArray(src.nodes)?src.nodes:[];for(let i=0;i<nodes.length;i++){const cand=bgEdgeCandidates(nodes[i],map);if(!cand.length)continue;const id=`${kind}:${src.id||'unnamed'}:${i===0?'start':i===nodes.length-1?'end':`node-${i}`}`;const raw=bgRawDirectionAt(nodes,i,cand[0]),edge=bgChooseEdge(cand,raw,kind,saved[id]?.edge),width=kind==='route'?Math.max(0.25,Number(src.pathWidth)||1):Math.max(0.25,Number(src.width)||(src.kind==='stream'?1:3));out.push({id,kind,sourceId:src.id||'',sourceLabel:src.label||src.id||kind,sourceType:kind==='route'?'path':(src.kind||'river'),nodeIndex:i,node:[nodes[i][0],nodes[i][1]],mapCols:map.cols,mapRows:map.rows,candidateEdges:cand,edge,position:bgAttachPosition(nodes[i],edge,map),rawDirection:raw,direction:bgDirectionFromRaw(raw,edge),width,seed:Number(src.seed)||1,paintTiles:src.paintTiles!==false});}}};
    scan(map.routes,'route'); scan(map.rivers,'river'); return out;
  }
  function resolveBackgroundSceneryConfig(map){const raw=map?.backgroundScenery&&typeof map.backgroundScenery==='object'?map.backgroundScenery:{};return{schema:'hobunji_background_scenery.v1',ridgeClearanceTiles:bgClamp(Number.isFinite(Number(raw.ridgeClearanceTiles))?Number(raw.ridgeClearanceTiles):BG_DEFAULTS.ridgeClearanceTiles,0,8),borderDepthTiles:bgClamp(Number.isFinite(Number(raw.borderDepthTiles))?Number(raw.borderDepthTiles):BG_DEFAULTS.borderDepthTiles,6,30),defaultExtensionLengthTiles:bgClamp(Number.isFinite(Number(raw.defaultExtensionLengthTiles))?Number(raw.defaultExtensionLengthTiles):BG_DEFAULTS.defaultExtensionLengthTiles,1,40),routeShoulderTiles:bgClamp(Number.isFinite(Number(raw.routeShoulderTiles))?Number(raw.routeShoulderTiles):BG_DEFAULTS.routeShoulderTiles,0,8),riverBankTiles:bgClamp(Number.isFinite(Number(raw.riverBankTiles))?Number(raw.riverBankTiles):BG_DEFAULTS.riverBankTiles,0,8),riverChannelDepth:bgClamp(Number.isFinite(Number(raw.riverChannelDepth))?Number(raw.riverChannelDepth):BG_DEFAULTS.riverChannelDepth,0,2),waterfallThreshold:bgClamp(Number.isFinite(Number(raw.waterfallThreshold))?Number(raw.waterfallThreshold):BG_DEFAULTS.waterfallThreshold,0.1,5),attachments:raw.attachments&&typeof raw.attachments==='object'?JSON.parse(JSON.stringify(raw.attachments)): {}};}
  function resolveAttachmentSettings(a,s,o={}){return{enabled:o.enabled!==false,edge:a.candidateEdges.includes(o.edge)?o.edge:a.edge,lengthTiles:bgClamp(Number.isFinite(Number(o.lengthTiles))?Number(o.lengthTiles):s.defaultExtensionLengthTiles,1,40),widthScale:bgClamp(Number.isFinite(Number(o.widthScale))?Number(o.widthScale):1,0.25,4),shoulderTiles:bgClamp(Number.isFinite(Number(o.shoulderTiles))?Number(o.shoulderTiles):s.routeShoulderTiles,0,8),bankTiles:bgClamp(Number.isFinite(Number(o.bankTiles))?Number(o.bankTiles):s.riverBankTiles,0,8),channelDepth:bgClamp(Number.isFinite(Number(o.channelDepth))?Number(o.channelDepth):s.riverChannelDepth,0,2),waterfallThreshold:bgClamp(Number.isFinite(Number(o.waterfallThreshold))?Number(o.waterfallThreshold):s.waterfallThreshold,0.1,5)};}
  function bgHash01(seed,salt){let h=((seed>>>0)^Math.imul((salt+1)>>>0,0x9e3779b1))>>>0;h=Math.imul(h^(h>>>16),0x21f0aaad)>>>0;h=Math.imul(h^(h>>>15),0x735a2d97)>>>0;return((h^(h>>>15))>>>0)/4294967296;}
  function buildContinuationPolyline(a,s,o={}){const e=resolveAttachmentSettings(a,s,o),start=bgAttachPosition(a.node,e.edge,{cols:a.mapCols,rows:a.mapRows}),cp=Array.isArray(o.controlPoints)?o.controlPoints.filter(p=>Array.isArray(p)&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]))).map(p=>[Number(p[0]),Number(p[1])]):[];if(cp.length)return[start,...cp];const d=bgDirectionFromRaw(a.rawDirection,e.edge);if(a.kind==='river'){const perp=[-d[1],d[0]],amp=(a.sourceType==='stream'?0.7:1.25)*Math.min(1,e.lengthTiles/8),pts=[start];for(let i=1;i<=4;i++){const t=i/4,wobble=(bgHash01(a.seed,a.nodeIndex*17+i)*2-1)*amp*Math.sin(Math.PI*t);pts.push([start[0]+d[0]*e.lengthTiles*t+perp[0]*wobble,start[1]+d[1]*e.lengthTiles*t+perp[1]*wobble]);}return pts;}return[start,[start[0]+d[0]*e.lengthTiles,start[1]+d[1]*e.lengthTiles]];}
  function bgDistToSegment(px,pz,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],d2=dx*dx+dz*dz;if(d2<1e-8)return Math.hypot(px-a[0],pz-a[1]);const t=bgClamp(((px-a[0])*dx+(pz-a[1])*dz)/d2,0,1),x=a[0]+dx*t,z=a[1]+dz*t;return Math.hypot(px-x,pz-z);}
  function bgDistToPolyline(px,pz,pts){let best=Infinity;for(let i=0;i<pts.length-1;i++)best=Math.min(best,bgDistToSegment(px,pz,pts[i],pts[i+1]));return best;}
  function bgDensify(pts,step=0.5){if(pts.length<2)return pts.slice();const out=[pts[0].slice()];for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/step));for(let j=1;j<=n;j++){const t=j/n;out.push([a[0]+dx*t,a[1]+dz*t]);}}return out;}
  window.BackgroundScenery={DEFAULTS:BG_DEFAULTS,edgeNormal:bgEdgeNormal,collectBoundaryAttachments,resolveConfig:resolveBackgroundSceneryConfig,resolveAttachmentSettings,buildContinuationPolyline};

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
    // Paths flatten their core and blend through shoulders. Rivers only cut into
    // the existing heightfield, so a high background river can still fall over a cliff.
    for(let gj=0;gj<GH;gj++)for(let gi=0;gi<GW;gi++){if(vSteps(gi,gj)===0)continue;const wx=(gi-BV)*0.5,wz=(gj-BV)*0.5,k=gj*GW+gi,base=deps.NORMAL_TOP+hashDisp(gi-BV,gj-BV);for(const c of routeContinuations){const half=c.a.width*c.settings.widthScale*0.5,d=bgDistToPolyline(wx,wz,c.points),shoulder=c.settings.shoulderTiles;if(d>half+shoulder)continue;const weight=d<=half?1:shoulder>0?1-(d-half)/shoulder:0,s=weight*weight*(3-2*weight);Y[k]=Y[k]+(base-Y[k])*s;}for(const c of riverContinuations){const half=c.a.width*c.settings.widthScale*0.5,d=bgDistToPolyline(wx,wz,c.points),bank=c.settings.bankTiles;if(d>half+bank)continue;const weight=d<=half?1:bank>0?1-(d-half)/bank:0,minY=base-0.35;Y[k]=Math.max(minY,Y[k]-c.settings.channelDepth*weight);}}
    const sampleHeight=(x,z)=>{const gx=bgClamp(x*2+BV,0,GW-1),gz=bgClamp(z*2+BV,0,GH-1),x0=Math.floor(gx),z0=Math.floor(gz),x1=Math.min(GW-1,x0+1),z1=Math.min(GH-1,z0+1),tx=gx-x0,tz=gz-z0,a=Y[z0*GW+x0]*(1-tx)+Y[z0*GW+x1]*tx,b=Y[z1*GW+x0]*(1-tx)+Y[z1*GW+x1]*tx;return a*(1-tz)+b*tz;};
    const pos=new Float32Array(GW*GH*3),uv=new Float32Array(GW*GH*2);for(let gj=0;gj<GH;gj++)for(let gi=0;gi<GW;gi++){const k=gj*GW+gi,wx=(gi-BV)*0.5,wz=(gj-BV)*0.5;pos[k*3]=wx;pos[k*3+1]=Y[k];pos[k*3+2]=wz;uv[k*2]=wx;uv[k*2+1]=wz;}
    const indices=[];for(let cj=0;cj<GH-1;cj++)for(let ci=0;ci<GW-1;ci++){if(isPlayable(ci,cj))continue;const v00=cj*GW+ci,v10=v00+1,v01=(cj+1)*GW+ci,v11=v01+1;indices.push(v00,v01,v11,v00,v11,v10);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setIndex(new THREE.BufferAttribute((pos.length/3>65535)?new Uint32Array(indices):new Uint16Array(indices),1));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,deps.resolveTileMat('map_hobunji_town',deps.TileType.GRASS));mesh.receiveShadow=true;townScene.add(mesh);
    const cliffMat=deps.resolveCliffMat('map_hobunji_town');function elevStoneSkin(gjMin,gjMax,giMin,giMax){const positions=[],skinUv=[],idxArr=[];let vi=0;for(let gj=gjMin;gj<gjMax;gj++)for(let gi=giMin;gi<giMax;gi++){const y00=Y[gj*GW+gi],y10=Y[gj*GW+gi+1],y01=Y[(gj+1)*GW+gi],y11=Y[(gj+1)*GW+gi+1],cnx=-0.5*((y10+y11)-(y00+y01)),cnz=0.5*((y10-y01)-(y11-y00));if(cnx*cnx+cnz*cnz<=0.194)continue;const x0=(gi-BV)*0.5,x1=x0+0.5,z0=(gj-BV)*0.5,z1=z0+0.5;positions.push(x0,y00,z0,x1,y10,z0,x0,y01,z1,x1,y11,z1);skinUv.push(x0,z0,x1,z0,x0,z1,x1,z1);idxArr.push(vi,vi+2,vi+3,vi,vi+3,vi+1);vi+=4;}if(!positions.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(skinUv,2));g.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr),1));g.computeVertexNormals();townScene.add(new THREE.Mesh(g,cliffMat));}
    elevStoneSkin(0,BV,0,GW-1);elevStoneSkin(BV,GH-1-BV,0,BV);elevStoneSkin(BV,GH-1-BV,GW-1-BV,GW-1);elevStoneSkin(GH-1-BV,GH-1,0,BV);elevStoneSkin(GH-1-BV,GH-1,GW-1-BV,GW-1);
    function addRibbon(c,material,yLift){const samples=bgDensify(c.points,0.45);if(samples.length<2)return null;const verts=[],uvs=[],idx=[];let vDist=0;for(let i=0;i<samples.length;i++){const p=samples[i],p0=samples[Math.max(0,i-1)],p1=samples[Math.min(samples.length-1,i+1)],dx=p1[0]-p0[0],dz=p1[1]-p0[1],dl=Math.hypot(dx,dz)||1,px=-dz/dl,pz=dx/dl,half=c.a.width*c.settings.widthScale*0.5,y=sampleHeight(p[0],p[1])+yLift;if(i)vDist+=Math.hypot(p[0]-samples[i-1][0],p[1]-samples[i-1][1]);verts.push(p[0]+px*half,y,p[1]+pz*half,p[0]-px*half,y,p[1]-pz*half);uvs.push(0,vDist,Math.max(1,c.a.width*c.settings.widthScale),vDist);if(i){const v=i*2;idx.push(v-2,v,v+1,v-2,v+1,v-1);}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(idx);g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.renderOrder=2;townScene.add(m);return{samples,mesh:m};}
    let pathMat=null;try{pathMat=deps.resolveTileMat('map_hobunji_town',deps.TileType.PATH||'path');}catch(_){pathMat=null;}if(!pathMat)pathMat=new THREE.MeshStandardMaterial({color:0x9f8357,roughness:1});for(const c of routeContinuations)addRibbon(c,pathMat,0.025);
    const waterMat=new THREE.MeshStandardMaterial({color:0x4f9fbd,transparent:true,opacity:0.78,roughness:0.28,metalness:0,side:THREE.DoubleSide,depthWrite:false});
    for(const c of riverContinuations){const built=addRibbon(c,waterMat,0.035);if(!built)continue;const s=built.samples;for(let i=0;i<s.length-1;i++){const a=s[i],b=s[i+1],ya=sampleHeight(a[0],a[1])+0.035,yb=sampleHeight(b[0],b[1])+0.035;if(Math.abs(ya-yb)<c.settings.waterfallThreshold)continue;const mx=(a[0]+b[0])*0.5,mz=(a[1]+b[1])*0.5,dx=b[0]-a[0],dz=b[1]-a[1],dl=Math.hypot(dx,dz)||1,px=-dz/dl,pz=dx/dl,half=c.a.width*c.settings.widthScale*0.5,top=Math.max(ya,yb),bot=Math.min(ya,yb),v=[mx+px*half,top,mz+pz*half,mx-px*half,top,mz-pz*half,mx+px*half,bot,mz+pz*half,mx-px*half,bot,mz-pz*half],g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,0,0,1,0],2));g.setIndex([0,2,3,0,3,1]);g.computeVertexNormals();const fall=new THREE.Mesh(g,waterMat);fall.renderOrder=3;townScene.add(fall);}}
    _townBorderGrassPoints=[];for(let cj=0;cj<CH;cj++)for(let ci=0;ci<CW;ci++){if(isPlayable(ci,cj)||vSteps(ci,cj)>16)continue;const y00=Y[cj*GW+ci],y10=Y[cj*GW+ci+1],y01=Y[(cj+1)*GW+ci],y11=Y[(cj+1)*GW+ci+1],cnx=-0.5*((y10+y11)-(y00+y01)),cnz=0.5*((y10-y01)-(y11-y00));if(cnx*cnx+cnz*cnz>0.194)continue;const seed=(ci*7919+cj*104173)>>>0;if(deps.mbRng(seed)()>0.44)continue;const px=(ci-BV)*0.5+0.25,pz=(cj-BV)*0.5+0.25,py=(y00+y10+y01+y11)/4;_townBorderGrassPoints.push({px,pz,py,seed});}_buildTownBorderGrassBillboards();
    if(window.FoliageGenerator){const STEP=4;for(let cj=BV+PVH;cj<CH;cj+=STEP){const depth=cj-(BV+PVH);if(depth>22)continue;for(let ci=0;ci<CW;ci+=STEP){const px=(ci-BV)*0.5+0.25,pz=(cj-BV)*0.5+0.25;if(routeContinuations.some(c=>bgDistToPolyline(px,pz,c.points)<=c.a.width*c.settings.widthScale*0.5+c.settings.shoulderTiles+0.75))continue;const seed=(777+ci*7919+cj*104173)>>>0,r=deps.mbRng(seed);if(r()>0.22)continue;const y00=Y[cj*GW+ci],y10=Y[cj*GW+ci+1],y01=Y[(cj+1)*GW+ci],y11=Y[(cj+1)*GW+ci+1],cnx=-0.5*((y10+y11)-(y00+y01)),cnz=0.5*((y10-y01)-(y11-y00));if(cnx*cnx+cnz*cnz>0.194)continue;const py=(y00+y10+y01+y11)/4,vegGroup=window.FoliageGenerator.buildShrubMesh(1000+ci,1000+cj),sc=1.6+r()*1.2;vegGroup.scale.set(sc,sc,sc);vegGroup.rotation.y=r()*Math.PI*2;vegGroup.position.set(px,py,pz);townScene.add(vegGroup);deps.markOutline(vegGroup);}}}
  }

  function setGrassVisible(enabled){if(townBorderGrassBillMesh)townBorderGrassBillMesh.visible=enabled;}
  window.BorderTerrain={init,buildBorderTerrain,buildZoneBorderTerrain,buildTownBorderTerrain,buildTownBorderGrassBillboards:_buildTownBorderGrassBillboards,setGrassVisible};
})();
