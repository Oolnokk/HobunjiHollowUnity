'use strict';
function renderAll(){
  syncControls();renderWorkspaceClasses();renderNpcSelect();renderNavigator();renderGraph();renderAlternatives();renderStateSummary();updateHistoryButtons();syncAuthoringButtons();refreshDbOverrideStatus();
}
function syncControls(){
  const s=state.settings;
  ['workspaceOrientation','navPlacement','graphFlow','portAttachment','routeStyle','nodeDensity','navStyle','emptyHandling','multiHandling','sortMode'].forEach(k=>{$(k).value=s[k]});
  $('showConditionSummary').checked=!!s.showConditionSummary;
  $('autoArrangeOrthographic').checked=!!s.autoArrangeOrthographic;$('colorCodeNodes').checked=!!s.colorCodeNodes;
  renderLevelControls();
}
function renderLevelControls(){
  const box=$('levelControls');
  box.innerHTML='';
  for(let i=0;i<5;i++){
    const row=document.createElement('div');row.className='levelRow';
    const selected=state.settings.hierarchy[i]||'';
    const used=new Set(state.settings.hierarchy.filter((_,idx)=>idx!==i));
    row.innerHTML=`<div class="levelNum">${i+1}</div><select data-level="${i}"><option value="">— no further level —</option>${DIMENSIONS.map(d=>`<option value="${d.key}"${d.key===selected?' selected':''}${used.has(d.key)?' disabled':''}>${esc(d.label)}</option>`).join('')}</select>`;
    box.appendChild(row);
  }
  box.querySelectorAll('select').forEach(sel=>sel.addEventListener('change',()=>{
    const i=+sel.dataset.level;const next=[...state.settings.hierarchy];
    if(sel.value){next[i]=sel.value}else next.splice(i);
    const hierarchy=next.filter(Boolean).filter((v,idx,a)=>a.indexOf(v)===idx).slice(0,5);
    commitMutation('Changed hierarchy order',()=>{state.settings.hierarchy=hierarchy;state.millerPath=[]},{detail:hierarchy});
  }));
}
function renderWorkspaceClasses(){
  const ws=$('workspace');const s=state.settings;
  ws.className=s.workspaceOrientation==='vertical'?'split-vertical':'split-horizontal';
  if(s.navPlacement==='right')ws.classList.add('nav-right');
  $('navigatorPane').classList.toggle('nav-hidden',s.navPlacement==='hidden');
}
function renderNpcSelect(){
  const sel=$('npcSelect');const npcs=state.db?.npcs||[];
  sel.innerHTML=npcs.length?npcs.map(n=>`<option value="${esc(n.id)}"${n.id===state.npcId?' selected':''}>${esc(n.name||n.id)} · ${(n.dialogueTrees||[]).length} trees</option>`).join(''):'<option>No NPCs</option>';
}
function renderNavigator(){
  const npc=currentNpc();const body=$('navigatorBody');
  if(!npc){body.innerHTML='<div class="fieldNote">No NPC selected.</div>';$('breadcrumb').textContent='';return}
  const trees=searchTrees(npc.dialogueTrees||[]);const root=buildHierarchy(trees);const metrics=countHierarchy(root);
  $('navMetrics').innerHTML=`<span class="metric">${trees.length} trees</span><span class="metric">${metrics.groups} folders</span><span class="metric">depth ${metrics.maxDepth}</span>${metrics.leafRefs>trees.length?`<span class="metric">${metrics.leafRefs-trees.length} duplicate refs</span>`:''}`;
  const order=state.settings.hierarchy.map(k=>DIM_BY_KEY[k].label).join(' → ');
  const crumb=$('breadcrumb');crumb.setAttribute('data-root-drop','');crumb.innerHTML=(order?`Order: <b>${esc(order)}</b>`:'Order: <b>Flat list</b>')+(state.settings.hierarchy.length?'<span class="dragHint">Drag here to clear hierarchy conditions</span>':'');
  if(state.settings.navStyle==='columns')renderMiller(body,root);
  else if(state.settings.navStyle==='cards')renderCards(body,root);
  else{body.innerHTML=renderNested(root,0);wireLeafClicks(body)}
}
function renderNested(node,depth){
  const leaves=node.leaves?.length?`<div class="${depth?'promotedLeaves':''}">${node.leaves.map(renderLeaf).join('')}</div>`:'';
  const groups=(node.groups||[]).map(g=>`<details class="treeGroup" open data-drop-path="${esc(encodeDropPath(g.path))}"><summary><span class="groupLabel">${esc(g.label)}</span><span class="groupCount">${g.count}</span></summary><div class="groupChildren">${renderNested(g.child,depth+1)}</div></details>`).join('');
  return leaves+groups||'<div class="fieldNote" style="padding:12px">No matching trees.</div>';
}
function renderLeaf(t){
  return `<div class="treeLeaf${t.id===state.treeId?' selected':''}" data-tree-id="${esc(t.id)}"><span class="leafDot"></span><div class="leafMain"><div class="leafTitle">${esc(t.label||t.id)}</div>${state.settings.showConditionSummary?`<div class="leafMeta">${esc(conditionSummary(t))}</div>`:''}</div><span class="leafPrio">p${t.priority||0}</span></div>`;
}
function wireLeafClicks(container){
  container.querySelectorAll('[data-tree-id]').forEach(el=>el.addEventListener('click',()=>{if(Date.now()<(state.suppressTreeClickUntil||0))return;selectTree(el.dataset.treeId)}));
  wireDragDrop(container);
}

function renderMiller(body,root){
  const cols=[];let node=root;let level=0;
  while(node){
    const groups=node.groups||[];const leaves=node.leaves||[];const active=state.millerPath[level];
    cols.push(`<div class="millerCol"><div class="millerTitle">${level===0?'Root':esc(DIM_BY_KEY[state.settings.hierarchy[level-1]]?.label||`Level ${level}`)}</div>${leaves.map(renderLeaf).join('')}${groups.map((g,i)=>`<div class="millerItem${active===i?' active':''}" data-miller-level="${level}" data-miller-index="${i}" data-drop-path="${esc(encodeDropPath(g.path))}"><span>${esc(g.label)}</span><b>${g.count} ›</b></div>`).join('')}</div>`);
    if(active==null||!groups[active])break;node=groups[active].child;level++;
  }
  body.innerHTML=`<div class="miller">${cols.join('')}</div>`;wireLeafClicks(body);
  body.querySelectorAll('[data-miller-level]').forEach(el=>el.addEventListener('click',()=>{
    if(Date.now()<(state.suppressTreeClickUntil||0))return;
    const level=+el.dataset.millerLevel;state.millerPath=state.millerPath.slice(0,level);state.millerPath[level]=+el.dataset.millerIndex;renderNavigator();
  }));
}
function renderCards(body,root){body.innerHTML=`<div class="cardHierarchy">${renderCardGroups(root,0)}</div>`;wireLeafClicks(body)}
function renderCardGroups(node,depth){
  const direct=node.leaves?.length?`<div>${node.leaves.map(renderLeaf).join('')}</div>`:'';
  if(!(node.groups||[]).length)return direct||'<div class="fieldNote">No matching trees.</div>';
  return direct+(node.groups||[]).map(g=>`<div class="hierCard" data-drop-path="${esc(encodeDropPath(g.path))}"><div class="hierCardHead"><span>${esc(g.label)}</span><span class="groupCount">${g.count}</span></div>${renderCardChild(g.child,depth+1)}</div>`).join('');
}
function renderCardChild(node,depth){
  let out=(node.leaves||[]).map(renderLeaf).join('');
  for(const g of node.groups||[]){out+=`<div class="hierSub" data-drop-path="${esc(encodeDropPath(g.path))}"><div class="hierSubTitle">${esc(g.label)} · ${g.count}</div>${renderCardChild(g.child,depth+1)}</div>`}
  return out;
}
function selectTree(id){state.treeId=id;state.nodeId=null;state.editorMode='tree';resetGraphScale();renderNavigator();renderGraph();syncAuthoringButtons();logEvent('Selected tree',id);if(innerWidth<720)$('controlPanel').classList.remove('open')}
