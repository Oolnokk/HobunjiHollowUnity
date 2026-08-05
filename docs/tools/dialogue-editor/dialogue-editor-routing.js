'use strict';
function portPoint(p,kind,index,count,node){
  const attach=state.settings.portAttachment;const flow=state.settings.graphFlow;const out=kind!=='in';
  let x=p.x+p.w/2,y=p.y+p.h/2,side='';
  const follow=()=>{
    if(flow==='horizontal'){x=out?p.x+p.w:p.x;y=p.y+p.h/2;side=out?'right':'left'}
    else{x=p.x+p.w/2;y=out?p.y+p.h:p.y;side=out?'bottom':'top'}
  };
  if(attach==='sides'){x=out?p.x+p.w:p.x;y=p.y+p.h/2;side=out?'right':'left'}
  else if(attach==='topBottom'){x=p.x+p.w/2;y=out?p.y+p.h:p.y;side=out?'bottom':'top'}
  else if(attach==='corners'){x=out?p.x+p.w-13:p.x+13;y=out?p.y+p.h:p.y;side=out?'bottom':'top'}
  else{follow()}
  if(attach==='choiceRows'&&out&&node?.type==='choice'){
    if(flow==='horizontal'){x=p.x+p.w;y=p.y+50+(index+.5)*((p.h-55)/Math.max(1,count));side='right'}
    else{x=p.x+18+(index+.5)*((p.w-36)/Math.max(1,count));y=p.y+p.h;side='bottom'}
  }
  return{x,y,side};
}
function pathFor(a,b){
  if(state.settings.routeStyle==='straight')return`M${a.x},${a.y} L${b.x},${b.y}`;
  if(state.settings.routeStyle==='curved'){
    if(Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)){const mx=(a.x+b.x)/2;return`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`}
    const my=(a.y+b.y)/2;return`M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
  }
  const stub=28;
  if(a.side==='right'||b.side==='left'||(!a.side&&!b.side)){
    const mx=(a.x+b.x)/2;return`M${a.x},${a.y} H${mx} V${b.y} H${b.x}`;
  }
  if(a.side==='bottom'||b.side==='top'){
    const my=(a.y+b.y)/2;return`M${a.x},${a.y} V${my} H${b.x} V${b.y}`;
  }
  const mx=a.x+(a.side==='left'?-stub:stub);const my=(a.y+b.y)/2;return`M${a.x},${a.y} H${mx} V${my} H${b.x} V${b.y}`;
}
function renderEdges(tree,layout){
  const parts=[`<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="rgba(106,167,255,.78)"/></marker><marker id="arrowGood" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="rgba(67,214,161,.78)"/></marker></defs>`];
  const byId=new Map((tree.nodes||[]).map(n=>[n.id,n]));
  const outGroups=new Map();layout.edges.forEach(e=>{if(!outGroups.has(e.from))outGroups.set(e.from,[]);outGroups.get(e.from).push(e)});
  for(const e of layout.edges){
    const fp=layout.pos.get(e.from),tp=layout.pos.get(e.to);if(!fp||!tp)continue;
    const group=outGroups.get(e.from)||[];const idx=group.indexOf(e);const fromNode=byId.get(e.from);
    const a=portPoint(fp,e.kind,idx,group.length,fromNode);const b=portPoint(tp,'in',0,1,byId.get(e.to));
    const color=e.kind==='exhaust'?'rgba(67,214,161,.75)':e.kind==='slot'?'rgba(54,216,207,.52)':e.kind==='choice'?'rgba(245,191,75,.75)':'rgba(106,167,255,.75)';
    const dash=e.kind==='slot'?' stroke-dasharray="5 4"':'';const marker=e.kind==='exhaust'?'arrowGood':'arrow';
    parts.push(`<path d="${pathFor(a,b)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash} marker-end="url(#${marker})"/>`);
    parts.push(`<circle cx="${a.x}" cy="${a.y}" r="5" fill="${color}" stroke="#07111b" stroke-width="2"/><circle cx="${b.x}" cy="${b.y}" r="5" fill="#a9bdd5" stroke="#07111b" stroke-width="2"/>`);
    if(e.kind==='choice'||e.kind==='exhaust'||e.kind==='slot'){
      const lx=(a.x+b.x)/2,ly=(a.y+b.y)/2-5;const labelColor=state.settings.colorCodeNodes&&layout.colorIndex.has(e.to)?branchColor(layout.colorIndex.get(e.to)):'var(--muted)';parts.push(`<text class="edgeLabel" style="fill:${labelColor}" x="${lx}" y="${ly}" text-anchor="middle">${esc(String(e.label).slice(0,22))}</text>`);
    }
  }
  $('edgeSvg').innerHTML=parts.join('');
}
function fitGraph(){
  const viewport=$('graphViewport'),stage=$('graphStage');
  const sw=parseFloat(stage.style.width)||stage.scrollWidth,sh=parseFloat(stage.style.height)||stage.scrollHeight;
  const scale=Math.min(1,(viewport.clientWidth-24)/sw,(viewport.clientHeight-24)/sh);
  state.fitScale=Math.max(.25,scale);stage.style.transform=`scale(${state.fitScale})`;stage.style.width=(sw*state.fitScale)+'px';stage.style.height=(sh*state.fitScale)+'px';viewport.scrollTo({left:0,top:0,behavior:'smooth'});logEvent('Fit graph',state.fitScale);
}
function resetGraphScale(){const stage=$('graphStage');stage.style.transform='';state.fitScale=1}

function renderAlternatives(){
  const el=$('alternatives');el.classList.toggle('hidden',!state.settings.showAlternatives);
  const all=[...PRESETS,...state.customPresets];
  el.innerHTML=all.map((p,i)=>{
    const s=p.settings;const vert=s.graphFlow==='vertical';const stacked=s.workspaceOrientation==='vertical';
    let navStyle=stacked?'left:0;right:0;top:0;height:20px;border-width:0 0 1px 0':'left:0;top:0;bottom:0;width:42px;border-width:0 1px 0 0';
    if(s.navPlacement==='right')navStyle=stacked?'left:0;right:0;bottom:0;height:20px;border-width:1px 0 0 0':'right:0;top:0;bottom:0;width:42px;border-width:0 0 0 1px';
    if(s.navPlacement==='hidden')navStyle='display:none';
    const graphStyle=stacked?'left:5px;right:5px;top:23px;bottom:3px':s.navPlacement==='right'?'left:4px;right:45px;top:3px;bottom:3px':'left:45px;right:4px;top:3px;bottom:3px';
    return `<div class="altCard" data-preset="${esc(p.id)}"><div class="altName">${esc(p.name)}</div><div class="altWhy">${esc(p.why||'Pinned custom combination.')}</div><div class="miniPreview"><div class="miniNav" style="${navStyle}"></div><div class="miniGraph${vert?' vertical':''}" style="${graphStyle}"><span class="miniNode"></span><span class="miniLine"></span><span class="miniNode"></span><span class="miniLine"></span><span class="miniNode"></span></div></div><div class="altTags"><span class="altTag">${esc(s.workspaceOrientation)}</span><span class="altTag">${esc(s.graphFlow)} flow</span><span class="altTag">${esc((s.hierarchy||[]).length+' levels')}</span></div></div>`;
  }).join('');
  el.querySelectorAll('[data-preset]').forEach(card=>card.addEventListener('click',()=>applyPreset(card.dataset.preset)));
}
function applyPreset(id){
  const p=[...PRESETS,...state.customPresets].find(x=>x.id===id);if(!p)return;
  commitMutation(`Applied preset: ${p.name}`,()=>{state.settings=validateSettings(deepCopy(p.settings));state.millerPath=[]},{resetScale:true});
}
function pinCurrent(){
  const name=prompt('Name this combination:','My layout combination');if(!name)return;
  state.customPresets.push({id:`custom_${Date.now()}`,name,why:'Pinned during this session.',settings:deepCopy(state.settings)});renderAlternatives();logEvent('Pinned custom combination',name);
}
function renderStateSummary(){
  const npc=currentNpc(),tree=currentTree();
  $('stateSummary').textContent=safeStringify({source:$('statusText')?.textContent||'none',npc:npc?.name||null,tree:tree?.label||null,selectedNode:state.nodeId,hierarchy:state.settings.hierarchy,workspace:state.settings.workspaceOrientation,graphFlow:state.settings.graphFlow,ports:state.settings.portAttachment,route:state.settings.routeStyle,autoArrange:state.settings.autoArrangeOrthographic,undoSteps:state.history.past.length,redoSteps:state.history.future.length});
}
