'use strict';
function graphEdges(tree){
  const edges=[];
  for(const n of tree.nodes||[]){
    if(n.next)edges.push({from:n.id,to:n.next,kind:'next',label:'next'});
    if(n.exhaustedNext)edges.push({from:n.id,to:n.exhaustedNext,kind:'exhaust',label:'exhausted'});
    (n.choices||[]).forEach((c,i)=>{if(c.next)edges.push({from:n.id,to:c.next,kind:'choice',choiceIndex:i,label:c.label||`choice ${i+1}`})});
    (n.slots||[]).forEach((s,i)=>{if(s.nodeId)edges.push({from:n.id,to:s.nodeId,kind:'slot',slotIndex:i,label:`slot ${i+1}`})});
  }
  return edges;
}
function layoutGraph(tree){
  const nodes=tree.nodes||[];const edges=graphEdges(tree);const byId=new Map(nodes.map(n=>[n.id,n]));
  const children=new Map(nodes.map(n=>[n.id,[]]));const parents=new Map(nodes.map(n=>[n.id,[]]));
  edges.forEach(e=>{
    if(children.has(e.from)&&byId.has(e.to)&&!children.get(e.from).includes(e.to))children.get(e.from).push(e.to);
    if(parents.has(e.to)&&byId.has(e.from)&&!parents.get(e.to).includes(e.from))parents.get(e.to).push(e.from);
  });
  const depth=new Map();const queue=[];const entry=tree.entryNode||nodes[0]?.id;
  if(entry&&byId.has(entry)){depth.set(entry,0);queue.push(entry)}
  for(let i=0;i<queue.length;i++){
    const id=queue[i],d=depth.get(id);
    for(const child of children.get(id)||[]){if(!depth.has(child)){depth.set(child,d+1);queue.push(child)}}
  }
  const maxReachable=depth.size?Math.max(...depth.values()):0;nodes.forEach(n=>{if(!depth.has(n.id))depth.set(n.id,maxReachable+1)});
  const layers=new Map();nodes.forEach((n,index)=>{const d=depth.get(n.id);if(!layers.has(d))layers.set(d,[]);layers.get(d).push({node:n,index})});
  const autoArrange=state.settings.routeStyle==='orthogonal'&&state.settings.autoArrangeOrthographic;
  const ordered=[...layers.entries()].sort((a,b)=>a[0]-b[0]);
  if(autoArrange){
    const rank=new Map();ordered.forEach(([,items])=>items.forEach((it,i)=>rank.set(it.node.id,i)));
    const averageRank=ids=>ids.length?ids.reduce((sum,id)=>sum+(rank.get(id)??0),0)/ids.length:Infinity;
    for(let pass=0;pass<4;pass++){
      for(let li=1;li<ordered.length;li++){
        ordered[li][1].sort((a,b)=>averageRank(parents.get(a.node.id)||[])-averageRank(parents.get(b.node.id)||[])||a.index-b.index);
        ordered[li][1].forEach((it,i)=>rank.set(it.node.id,i));
      }
      for(let li=ordered.length-2;li>=0;li--){
        ordered[li][1].sort((a,b)=>averageRank(children.get(a.node.id)||[])-averageRank(children.get(b.node.id)||[])||a.index-b.index);
        ordered[li][1].forEach((it,i)=>rank.set(it.node.id,i));
      }
    }
  }
  const density=state.settings.nodeDensity;
  const nodeW=density==='compact'?190:density==='roomy'?252:224;
  const mainGap=density==='compact'?58:density==='roomy'?86:70;
  const crossGap=density==='compact'?16:density==='roomy'?28:22;
  const heights=new Map(nodes.map(n=>[n.id,nodeHeight(n,density,nodeW)]));
  const layerSpans=new Map();
  ordered.forEach(([d,items])=>{
    const span=state.settings.graphFlow==='horizontal'
      ?items.reduce((sum,it)=>sum+heights.get(it.node.id),0)+Math.max(0,items.length-1)*crossGap
      :items.length*nodeW+Math.max(0,items.length-1)*crossGap;
    layerSpans.set(d,span);
  });
  const maxCross=Math.max(0,...layerSpans.values());const pos=new Map();let maxX=0,maxY=0;
  if(state.settings.graphFlow==='horizontal'){
    ordered.forEach(([d,items])=>{
      const x=42+d*(nodeW+mainGap);let y=42+(maxCross-layerSpans.get(d))/2;
      items.forEach(it=>{const h=heights.get(it.node.id);pos.set(it.node.id,{x,y,w:nodeW,h});y+=h+crossGap;maxX=Math.max(maxX,x+nodeW);maxY=Math.max(maxY,y-crossGap)});
    });
  }else{
    let y=42;
    ordered.forEach(([d,items])=>{
      const layerH=Math.max(...items.map(it=>heights.get(it.node.id)),56);let x=42+(maxCross-layerSpans.get(d))/2;
      items.forEach(it=>{const h=heights.get(it.node.id);pos.set(it.node.id,{x,y,w:nodeW,h});x+=nodeW+crossGap;maxX=Math.max(maxX,x-crossGap);maxY=Math.max(maxY,y+h)});
      y+=layerH+mainGap;
    });
  }
  const colorIndex=new Map();if(entry)colorIndex.set(entry,0);
  const colorQueue=[entry].filter(Boolean);const seen=new Set();let nextBranchColor=1;
  for(let i=0;i<colorQueue.length;i++){
    const id=colorQueue[i];if(seen.has(id))continue;seen.add(id);const parentColor=colorIndex.get(id)??0;
    const node=byId.get(id);const outgoing=children.get(id)||[];const splits=(node?.type==='choice'||node?.type==='sequence')&&outgoing.length>1;
    outgoing.forEach((child,childIndex)=>{
      if(!colorIndex.has(child))colorIndex.set(child,splits?(nextBranchColor+childIndex)%6:parentColor);
      colorQueue.push(child);
    });
    if(splits)nextBranchColor=(nextBranchColor+outgoing.length)%6;
  }
  nodes.forEach((n,i)=>{if(!colorIndex.has(n.id))colorIndex.set(n.id,(nextBranchColor+i)%6)});
  return{pos,edges,colorIndex,width:Math.max(700,maxX+80),height:Math.max(500,maxY+190),autoArrange};
}
function estimateLines(text,charsPerLine){return Math.max(1,String(text||'').split(/\n/).reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/charsPerLine)),0))}
function nodeHeight(n,density,nodeW){
  const chars=Math.max(18,Math.floor((nodeW-28)/6.3));
  if(nodeDisplayType(n)==='accessShop')return density==='compact'?62:72;
  if(n.type==='choice'){
    const rows=n.choices?.length?n.choices:[{label:'No choices'}];
    return 25+5+rows.reduce((sum,c)=>sum+Math.max(21,estimateLines(c.label||'Empty choice',chars-8)*14+6),0);
  }
  if(n.type==='sequence')return 25+6+Math.max(22,Math.min(6,n.slots?.length||0)*20);
  if(n.type==='end')return density==='compact'?58:64;
  const lines=estimateLines(n.text||'No text',chars);const min=density==='compact'?72:density==='roomy'?102:86;
  return Math.max(min,29+16+lines*14);
}
function branchColor(index){return `var(--branch-${Math.abs(index||0)%6})`}
function renderGraph(){
  const tree=currentTree();const empty=$('emptyGraph'),layer=$('nodeLayer'),svg=$('edgeSvg'),stage=$('graphStage');
  if(!tree){empty.classList.remove('hidden');layer.innerHTML='';svg.innerHTML='';$('graphTitle').textContent=currentNpc()?'Select or create a tree':'Select an NPC';$('graphSubtitle').textContent='';state.nodeId=null;renderNodeEditor();syncAuthoringButtons();return}
  if(state.nodeId&&!tree.nodes?.some(n=>n.id===state.nodeId))state.nodeId=null;
  empty.classList.add('hidden');$('graphTitle').textContent=tree.label||tree.id;
  const auto=state.settings.routeStyle==='orthogonal'&&state.settings.autoArrangeOrthographic;
  $('graphSubtitle').textContent=`${tree.trigger||'interact'} · priority ${tree.priority||0} · ${conditionSummary(tree)}${auto?' · live orthographic layout':''}`;
  const layout=layoutGraph(tree);state.lastGraphColorIndex=layout.colorIndex;stage.style.width=layout.width+'px';stage.style.height=layout.height+'px';svg.setAttribute('width',layout.width);svg.setAttribute('height',layout.height);svg.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);
  const related=new Set();if(state.nodeId){layout.edges.forEach(e=>{if(e.from===state.nodeId)related.add(e.to);if(e.to===state.nodeId)related.add(e.from)})}
  layer.innerHTML=(tree.nodes||[]).map(n=>renderNode(n,layout.pos.get(n.id),tree,layout.colorIndex.get(n.id),related.has(n.id),layout.colorIndex)).join('');
  layer.querySelectorAll('.dNode').forEach(el=>el.addEventListener('click',()=>selectNode(el.dataset.nodeId)));
  renderNodeEditor();syncAuthoringButtons();requestAnimationFrame(()=>renderEdges(tree,layout));
}
function renderNode(n,p,tree,colorIndex=0,isRelated=false,allColorIndexes=new Map()){
  if(!p)return'';const density=state.settings.nodeDensity;let body='';
  const displayType=nodeDisplayType(n); // Used to render editor-only macro nodes distinctly while preserving their runtime node type.
  const targetColor=targetId=>state.settings.colorCodeNodes&&targetId&&allColorIndexes.has(targetId)?branchColor(allColorIndexes.get(targetId)):'var(--muted)';
  if(displayType==='accessShop'){
    const shop=shopRegistryEntry(accessShopPool(n)); // Used to show the selected wares pool instead of the macro node's fallback choice internals.
    body=`<div class="dNodeText accessShopSummary">Open <b>${esc(shop?.label||accessShopPool(n))}</b></div>`;
  }else if(n.type==='choice')body=(n.choices||[]).map((c,i)=>`<div class="dChoice" data-choice-row="${i}" style="--split-color:${targetColor(c.next)}"><span class="dChoiceLabel">${esc(c.label||'Empty choice')}</span><span class="dChoiceTarget">${esc(c.next||'END')}</span></div>`).join('')||'<div class="dNodeText empty">No choices</div>';
  else if(n.type==='sequence')body=`<div class="dSeq">${(n.slots||[]).slice(0,6).map((s,i)=>`<div class="dSeqRow" style="--split-color:${targetColor(s.nodeId)}"><b>${i+1}.</b><span>${esc(s.nodeId||'unset')} · depth ${s.depth??0}</span></div>`).join('')||'<span class="dNodeText empty">No slots</span>'}</div>`;
  else if(n.type==='end')body='<div class="dNodeText empty">— end of conversation —</div>';
  else body=`<div class="dNodeText${n.text?'':' empty'}">${esc(n.text||'No text')}</div>`;
  const splitter=displayType==='choice'||displayType==='sequence';const selected=state.nodeId===n.id;
  return `<div class="dNode ${density}${splitter?' splitter':''}${tree.entryNode===n.id?' entry':''}${selected?' selected':''}${isRelated?' related':''}" data-node-id="${esc(n.id)}" style="--node-accent:${state.settings.colorCodeNodes?branchColor(colorIndex):'var(--accent)'};left:${p.x}px;top:${p.y}px;width:${p.w}px;min-height:${p.h}px"><div class="dNodeHead"><span class="dNodeType type-${esc(displayType)}">${esc(displayType==='accessShop'?'access shop':displayType)}</span>${tree.entryNode===n.id?'<span class="entryTag">entry</span>':''}<span class="dNodeId">${esc(n.id)}</span></div><div class="dNodeBody">${body}</div></div>`;
}
function nodeTargetOptions(tree,current){return `<option value="">— END —</option>`+(tree.nodes||[]).map(n=>`<option value="${esc(n.id)}"${n.id===current?' selected':''}>${esc(n.id)} · ${esc(nodeDisplayType(n))}</option>`).join('')}
function selectNode(id){state.nodeId=id;state.editorMode='node';renderGraph();syncAuthoringButtons();logEvent('Selected node',id)}
function updateVisibleNodeText(nodeId,text,selector){const el=document.querySelector(`.dNode[data-node-id="${cssEscape(nodeId)}"] ${selector}`);if(el){el.textContent=text||'No text';el.classList.toggle('empty',!text)}}
function nodeTargetOptions(tree,current,excludeId=null){return `<option value="">— END —</option>`+(tree.nodes||[]).filter(n=>n.id!==excludeId).map(n=>`<option value="${esc(n.id)}"${n.id===current?' selected':''}>${esc(n.id)} · ${esc(nodeDisplayType(n))}</option>`).join('')}
function insertAtCursor(textarea,value){const start=textarea.selectionStart??textarea.value.length,end=textarea.selectionEnd??textarea.value.length;textarea.value=textarea.value.slice(0,start)+value+textarea.value.slice(end);textarea.selectionStart=textarea.selectionEnd=start+value.length;textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.focus()}
function buildTokenButtonsHtml(){const builtin=BUILT_IN_TOKENS.map(([token,hint])=>`<button type="button" class="tokenBtn" data-token="${esc(token)}" title="${esc(hint)}">${esc(token.replace(/[{}]/g,''))}</button>`).join('');const pools=(currentNpc()?.phrasePools||[]).map(p=>`<button type="button" class="tokenBtn poolTokenBtn" data-token="{{pool:${esc(p.name)}}}" title="Phrase pool: ${esc(p.name)}">pool: ${esc(p.name)}</button>`).join('');return builtin+pools}
function wireTokenButtons(textarea,scope){scope.querySelectorAll('[data-token]').forEach(btn=>btn.addEventListener('click',()=>insertAtCursor(textarea,btn.dataset.token)))}
function refreshGraphSubtitle(){const tree=currentTree();if(!tree)return;const auto=state.settings.routeStyle==='orthogonal'&&state.settings.autoArrangeOrthographic;$('graphTitle').textContent=tree.label||tree.id;$('graphSubtitle').textContent=`${tree.trigger||'interact'} · priority ${tree.priority||0} · ${conditionSummary(tree)}${auto?' · live orthographic layout':''}`}
