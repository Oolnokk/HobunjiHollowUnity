'use strict';
function folderEntriesForDimension(tree,key){
  let entries=[];
  const c=normalizeConditions(tree.conditions);
  if(key==='location'){
    entries=[...c.stations.map(v=>({label:`Station · ${v}`,value:`station:${v}`})),...c.maps.map(v=>({label:`Map · ${friendly(v)}`,value:`map:${v}`}))];
  }else if(key==='relationship'){
    const labels=relationshipValues(tree);const r=c.relationship;
    entries=labels.map(label=>({label,value:`relationship:${r.min??''}:${r.max??''}`}));
  }else{
    entries=(DIM_BY_KEY[key]?.values(tree)||[]).map(String).filter(Boolean).map(v=>({label:v,value:v}));
  }
  if(!entries.length)return[];
  if(state.settings.multiHandling==='primary')return[{label:entries[0].label,values:[entries[0].value],empty:false}];
  if(state.settings.multiHandling==='combined')return[{label:entries.map(v=>v.label).join(' / '),values:entries.map(v=>v.value),empty:false}];
  return entries.map(v=>({label:v.label,values:[v.value],empty:false}));
}
function buildHierarchy(trees,dims=state.settings.hierarchy,level=0,path=[]){
  const node={type:'groupRoot',groups:[],leaves:[],count:trees.length,path};
  if(level>=dims.length){node.leaves=sortTrees(trees);return node}
  const key=dims[level];const buckets=new Map();const promoted=[];
  for(const tree of trees){
    let entries=folderEntriesForDimension(tree,key);
    if(!entries.length){
      if(state.settings.emptyHandling==='promote'){promoted.push(tree);continue}
      entries=[{label:state.settings.emptyHandling==='general'?'General':`Any ${DIM_BY_KEY[key].label.toLowerCase()}`,values:[],empty:true}];
    }
    entries.forEach(entry=>{
      if(!buckets.has(entry.label))buckets.set(entry.label,{entry,items:[]});
      buckets.get(entry.label).items.push(tree);
    });
  }
  node.leaves=sortTrees(promoted);
  node.groups=[...buckets.values()].sort((a,b)=>a.entry.label.localeCompare(b.entry.label)).map(({entry,items})=>{
    const pathEntry={key,label:entry.label,values:[...entry.values],empty:entry.empty};
    const nextPath=[...path,pathEntry];
    return{type:'group',key,label:entry.label,values:entry.values,empty:entry.empty,path:nextPath,count:items.length,child:buildHierarchy(items,dims,level+1,nextPath)};
  });
  return node;
}
function encodeDropPath(path){return encodeURIComponent(JSON.stringify(path||[]))}
function decodeDropPath(raw){try{return JSON.parse(decodeURIComponent(raw||''))}catch{return[]}}
function clearTreeDimension(tree,key){
  const c=tree.conditions=normalizeConditions(tree.conditions);
  const arrayKey={encounter:'encounter',season:'seasons',weather:'weather',time:'timesOfDay',weekday:'weekdays',species:'playerSpecies'}[key];
  if(arrayKey)c[arrayKey]=[];
  else if(key==='location'){c.maps=[];c.stations=[]}
  else if(key==='relationship')c.relationship={min:null,max:null};
  else if(key==='trigger')tree.trigger='interact';
  else if(key==='priority')tree.priority=0;
}
function applyFolderDimension(tree,entry){
  const key=entry.key;const vals=entry.values||[];
  if(key==='specificity')return false;
  if(entry.empty||!vals.length){clearTreeDimension(tree,key);return true}
  const c=tree.conditions=normalizeConditions(tree.conditions);
  if(key==='trigger')tree.trigger=vals[0]||'interact';
  else if(key==='encounter')c.encounter=[...vals];
  else if(key==='season')c.seasons=[...vals];
  else if(key==='weather')c.weather=[...vals];
  else if(key==='time')c.timesOfDay=[...vals];
  else if(key==='weekday')c.weekdays=[...vals];
  else if(key==='species')c.playerSpecies=[...vals];
  else if(key==='location'){
    c.maps=[];c.stations=[];
    vals.forEach(v=>{if(v.startsWith('station:'))c.stations.push(v.slice(8));else if(v.startsWith('map:'))c.maps.push(v.slice(4));});
  }else if(key==='relationship'){
    const parts=String(vals[0]||'').split(':');
    if(parts[0]==='relationship')c.relationship={min:parts[1]===''?null:+parts[1],max:parts[2]===''?null:+parts[2]};
  }else if(key==='priority'){
    tree.priority=vals[0].startsWith('Critical')?9:vals[0].startsWith('High')?5:vals[0].startsWith('Normal')?1:0;
  }
  return true;
}
function moveTreeToPath(treeId,path){
  const npc=currentNpc();const tree=npc?.dialogueTrees?.find(t=>t.id===treeId);if(!tree)return;
  if((path||[]).some(e=>e.key==='specificity')){alert('Specificity is calculated from the other conditions, so it cannot be directly assigned by dropping. Choose a hierarchy without Specificity for drag editing.');return}
  const applicable=path||[];
  if(!(path||[]).length){
    commitMutation(`Moved “${tree.label||tree.id}” to hierarchy root`,()=>{state.settings.hierarchy.forEach(key=>clearTreeDimension(tree,key));},{render:'all',resetScale:true});
    return;
  }
  if(!applicable.length){alert('Specificity is calculated from the other conditions, so it cannot be directly assigned by dropping. Drop into a concrete condition folder instead.');return}
  const destination=applicable.map(e=>e.label).join(' → ');
  commitMutation(`Moved “${tree.label||tree.id}” to ${destination}`,()=>{applicable.forEach(entry=>applyFolderDimension(tree,entry));state.treeId=tree.id;state.millerPath=[]},{render:'all',resetScale:true,detail:{tree:tree.id,path:applicable}});
}
function clearDropHighlights(){document.querySelectorAll('.drop-ready').forEach(el=>el.classList.remove('drop-ready'))}
function beginTreePointerDrag(e,leaf){
  if(e.button!==undefined&&e.button!==0)return;
  state.pointerDrag={treeId:leaf.dataset.treeId,startX:e.clientX,startY:e.clientY,active:false,leaf,target:null,ghost:null,pointerId:e.pointerId};
}
function updateTreePointerDrag(e){
  const d=state.pointerDrag;if(!d)return;
  if(!d.active&&Math.hypot(e.clientX-d.startX,e.clientY-d.startY)<8)return;
  if(!d.active){
    d.active=true;d.leaf.classList.add('dragging');
    d.ghost=document.createElement('div');d.ghost.className='dragGhost';d.ghost.textContent=d.leaf.querySelector('.leafTitle')?.textContent||d.treeId;document.body.appendChild(d.ghost);
  }
  e.preventDefault();d.ghost.style.left=e.clientX+'px';d.ghost.style.top=e.clientY+'px';clearDropHighlights();
  const nav=$('navigatorBody'),nr=nav.getBoundingClientRect();if(e.clientY<nr.top+34)nav.scrollTop-=18;else if(e.clientY>nr.bottom-34)nav.scrollTop+=18;
  const hit=document.elementFromPoint(e.clientX,e.clientY);const target=hit?.closest?.('[data-drop-path],[data-root-drop]')||null;d.target=target;if(target)target.classList.add('drop-ready');
}
function finishTreePointerDrag(e){
  const d=state.pointerDrag;if(!d)return;state.pointerDrag=null;
  if(d.active){
    e.preventDefault();state.suppressTreeClickUntil=Date.now()+350;
    d.leaf.classList.remove('dragging');d.ghost?.remove();clearDropHighlights();
    if(d.target){const path=d.target.hasAttribute('data-root-drop')?[]:decodeDropPath(d.target.dataset.dropPath);moveTreeToPath(d.treeId,path)}
  }
}
function wireDragDrop(container){
  container.querySelectorAll('.treeLeaf[data-tree-id]').forEach(leaf=>{leaf.setAttribute('draggable','false');leaf.addEventListener('pointerdown',e=>beginTreePointerDrag(e,leaf))});
}
function countHierarchy(node){
  let groups=0,leaves=node.leaves?.length||0,maxDepth=0,leafRefs=leaves;
  for(const g of node.groups||[]){const c=countHierarchy(g.child);groups+=1+c.groups;leaves+=c.leaves;leafRefs+=c.leafRefs;maxDepth=Math.max(maxDepth,1+c.maxDepth)}
  return{groups,leaves,maxDepth,leafRefs};
}
