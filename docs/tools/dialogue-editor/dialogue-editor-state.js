'use strict';
const DEFAULT_SETTINGS={
  workspaceOrientation:'vertical',navPlacement:'left',graphFlow:'vertical',portAttachment:'choiceRows',routeStyle:'orthogonal',nodeDensity:'standard',navStyle:'nested',hierarchy:['trigger','location','relationship','time','season'],emptyHandling:'bucket',multiHandling:'combined',sortMode:'label',showConditionSummary:true,showAlternatives:true,autoArrangeOrthographic:true,colorCodeNodes:true
};
const PRESETS=[
  {id:'baseline',name:'Current-editor baseline',why:'Flat tree list, horizontal BFS graph, choice-row exits.',settings:{...DEFAULT_SETTINGS,workspaceOrientation:'horizontal',graphFlow:'horizontal',hierarchy:[],navStyle:'nested'}},
  {id:'conversation',name:'Conversation first',why:'Start with why dialogue fired, then social state, then place.',settings:{...DEFAULT_SETTINGS,hierarchy:['trigger','encounter','relationship','location']}},
  {id:'world',name:'World first',why:'Best for finding gaps by place, season, weather, then time.',settings:{...DEFAULT_SETTINGS,hierarchy:['location','season','weather','time'],navStyle:'columns'}},
  {id:'social',name:'Social first',why:'Best when relationship progression is the authoring backbone.',settings:{...DEFAULT_SETTINGS,hierarchy:['relationship','encounter','species','trigger'],navStyle:'cards',multiHandling:'combined'}},
  {id:'vertical',name:'Vertical story flow',why:'Top navigator, top-to-bottom graph, top/bottom ports.',settings:{...DEFAULT_SETTINGS,workspaceOrientation:'vertical',graphFlow:'vertical',portAttachment:'topBottom',routeStyle:'curved',hierarchy:['encounter','relationship','weather'],navStyle:'nested'}},
  {id:'dense',name:'Dense audit mode',why:'Compact nodes and drill-down columns for coverage inspection.',settings:{...DEFAULT_SETTINGS,nodeDensity:'compact',hierarchy:['specificity','priority','trigger','location'],navStyle:'columns',showConditionSummary:false}},
  {id:'hybrid',name:'Hybrid ports',why:'Vertical macro flow with left/right node ports to test scanability.',settings:{...DEFAULT_SETTINGS,workspaceOrientation:'horizontal',graphFlow:'vertical',portAttachment:'sides',routeStyle:'orthogonal',hierarchy:['location','trigger','time','weather'],navStyle:'cards'}}
];

let state={
  db:{schema:'hobunji_npc_database.v2',npcs:[]},npcId:null,treeId:null,
  settings:loadSettings(),search:'',millerPath:[],customPresets:[],errors:[],events:[],fitScale:1,nodeId:null,editorMode:'tree',dragTreeId:null,lastGraphColorIndex:new Map(),history:{past:[],future:[],lastLabel:'No edits yet',lastCoalesceKey:null,lastCoalesceAt:0}
};
let poolSel={poolId:null,expandedEntryId:null};
let randomPromptPicks=[];
let mapRegistry=[{id:'farm',name:'Farm',stations:[]},{id:'interior',name:'Player House',stations:[]}];
let shopRegistry=[];
let _idSequence=1;

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const deepCopy=v=>JSON.parse(JSON.stringify(v));
const genId=prefix=>`${prefix}${Date.now().toString(36)}${(_idSequence++).toString(36)}`; // Used by tree, node, pool, and pool-entry creation.
const EXPRESSION_OPTIONS=['neutral','smile','frown','laugh','yap'];
const REVEAL_SPEED_OPTIONS=['normal','slow','fast','instant'];
const CHOICE_ACTION_TYPES=[
  {type:'setLocalNickname',label:'Set nickname',field:'value',fieldLabel:'Nickname'},
  {type:'openShop',label:'Open shop',field:'pool',fieldLabel:'Shop',kind:'shopSelect'},
  {type:'openCraftMenu',label:'Open craft menu',field:null},
  {type:'startChat',label:'Start chat',field:null},
  {type:'acceptFavor',label:'Accept favor',field:'taskId',fieldLabel:'Task ID'},
  {type:'declineFavor',label:'Decline favor',field:'taskId',fieldLabel:'Task ID'},
  {type:'turnInTask',label:'Turn in task',field:'taskId',fieldLabel:'Task ID'}
];
const BUILT_IN_TOKENS=[
  ['{{npcName}}','NPC name'],['{{playerName}}','Player name'],['{{playerNickname}}','Player nickname'],['{{playerLocalNickname}}','NPC-specific nickname'],['{{npcSpecies}}','NPC species'],['{{playerSpecies}}','Player species'],['{{role}}','NPC role'],['{{playerPronoun1}}','he/she/they'],['{{playerPronoun2}}','him/her/them'],['{{playerPronoun3}}','his/her/their'],['{{playerPronounSelf}}','reflexive pronoun'],['{{playerFirstL2V1}}','name fragment']
];
function mapLabel(id){return mapRegistry.find(m=>m.id===id)?.name||id}
function stationsForMap(id){return mapRegistry.find(m=>m.id===id)?.stations||[]}
function shopLabel(id){return shopRegistry.find(s=>s.id===id)?.label||id}
const cssEscape=v=>window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/[^a-zA-Z0-9_-]/g,m=>`\\${m}`);
function currentNpc(){return state.db?.npcs?.find(n=>n.id===state.npcId)||null}
function currentTree(){return currentNpc()?.dialogueTrees?.find(t=>t.id===state.treeId)||null}
function logEvent(message,data){
  const stamp=new Date().toLocaleTimeString();
  state.events.unshift(`[${stamp}] ${message}${data!==undefined?'\n'+safeStringify(data):''}`);
  state.events=state.events.slice(0,80);renderDiagnostics();
}
function safeStringify(v){try{return JSON.stringify(v,null,2)}catch{return String(v)}}
function captureError(kind,error){
  const text=`${kind}: ${error?.message||error||'Unknown error'}${error?.stack?'\n'+error.stack:''}`;
  state.errors.unshift(text);state.errors=state.errors.slice(0,30);
  $('errorCount').textContent=state.errors.length;$('errorBadge').classList.add('show');renderDiagnostics();
}
window.addEventListener('error',e=>captureError('Error',e.error||e.message));
window.addEventListener('unhandledrejection',e=>captureError('Unhandled promise rejection',e.reason));

const SETTINGS_STORAGE_KEY='hobunjiDialogueLayoutLab.v2';
function loadSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)||'null');
    return validateSettings({...DEFAULT_SETTINGS,...(saved||{})});
  }catch{return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))}
}
function validateSettings(s){
  const validDims=new Set(DIMENSIONS.map(d=>d.key));
  s.hierarchy=(Array.isArray(s.hierarchy)?s.hierarchy:[]).filter((v,i,a)=>validDims.has(v)&&a.indexOf(v)===i).slice(0,5);
  return s;
}
function saveSettings(){
  try{localStorage.setItem(SETTINGS_STORAGE_KEY,JSON.stringify(state.settings));state.storageUnavailable=false}catch{state.storageUnavailable=true}
}
const HISTORY_LIMIT=60;
function historySnapshot(){
  return {db:deepCopy(state.db),settings:deepCopy(state.settings),npcId:state.npcId,treeId:state.treeId,nodeId:state.nodeId,editorMode:state.editorMode,millerPath:[...state.millerPath]};
}
function snapshotKey(snap){return JSON.stringify(snap)}
function resetHistory(label='Loaded starting state'){
  state.history={past:[],future:[],lastLabel:label,lastCoalesceKey:null,lastCoalesceAt:0};
  updateHistoryButtons();
}
function restoreSnapshot(snap){
  state.db=deepCopy(snap.db);state.settings=validateSettings(deepCopy(snap.settings));
  state.npcId=snap.npcId;state.treeId=snap.treeId;state.nodeId=snap.nodeId??null;state.editorMode=snap.editorMode||'tree';state.millerPath=[...(snap.millerPath||[])];
  saveSettings();resetGraphScale();
}
function commitMutation(label,mutator,options={}){
  const before=historySnapshot();
  const now=Date.now();const coalesceKey=options.coalesceKey||null;
  mutator();
  const after=historySnapshot();
  if(snapshotKey(before)===snapshotKey(after))return false;
  const coalescing=coalesceKey&&state.history.lastCoalesceKey===coalesceKey&&now-state.history.lastCoalesceAt<900;
  if(!coalescing){state.history.past.push(before);if(state.history.past.length>HISTORY_LIMIT)state.history.past.shift()}
  state.history.future=[];state.history.lastLabel=label;state.history.lastCoalesceKey=coalesceKey;state.history.lastCoalesceAt=now;
  saveSettings();updateHistoryButtons();
  if(options.resetScale)resetGraphScale();
  if(options.render==='none'){}else if(options.render==='graph'){renderNavigator();renderGraph();renderStateSummary()}else renderAll();
  if(options.log!==false)logEvent(label,options.detail);return true;
}
function undo(){
  if(!state.history.past.length)return;
  const current=historySnapshot();const previous=state.history.past.pop();state.history.future.push(current);
  restoreSnapshot(previous);state.history.lastLabel='Undid last change';state.history.lastCoalesceKey=null;renderAll();updateHistoryButtons();logEvent('Undo');
}
function redo(){
  if(!state.history.future.length)return;
  const current=historySnapshot();const next=state.history.future.pop();state.history.past.push(current);
  restoreSnapshot(next);state.history.lastLabel='Redid last change';state.history.lastCoalesceKey=null;renderAll();updateHistoryButtons();logEvent('Redo');
}
function updateHistoryButtons(){
  if(!$('undoBtn'))return;
  $('undoBtn').disabled=!state.history.past.length;$('redoBtn').disabled=!state.history.future.length;
  $('historyLabel').textContent=state.history.lastLabel||'No edits yet';
  $('undoBtn').title=`Undo (${state.history.past.length} available)`;$('redoBtn').title=`Redo (${state.history.future.length} available)`;
}
function setSetting(key,value){
  commitMutation(`Changed ${key}`,()=>{state.settings[key]=value;state.millerPath=[]},{resetScale:['graphFlow','nodeDensity','routeStyle','portAttachment'].includes(key),detail:value});
}

function normalizeDatabase(raw){
  if(!raw||!Array.isArray(raw.npcs))throw new Error('Expected a database object with an npcs array.');
  const db=deepCopy(raw);
  // Weapon-trust trees are a config-backed authoring overlay. Merge only
  // missing IDs so an exported/hand-authored tree with the same ID remains
  // authoritative and immediately editable instead of being overwritten.
  window.WeaponTrustVisits?.mergeDialogueTreesIntoDatabase?.(db);
  db.schema??='hobunji_npc_database.v2';
  db.npcs.forEach((npc,ni)=>{
    npc.id??=`npc_${ni}`;npc.name??=npc.id;
    if(!Array.isArray(npc.phrasePools))npc.phrasePools=[];
    npc.phrasePools.forEach((pool,pi)=>{
      pool.id??=`pool_${ni}_${pi}`;pool.name??=`Pool ${pi+1}`;
      if(!Array.isArray(pool.entries))pool.entries=[];
      pool.entries.forEach((entry,ei)=>{entry.id??=`entry_${ni}_${pi}_${ei}`;entry.text??='';entry.conditions=normalizeConditions(entry.conditions);entry.excludeConditions=normalizeConditions(entry.excludeConditions)});
    });
    if(!Array.isArray(npc.dialogueTrees))npc.dialogueTrees=[];
    npc.dialogueTrees.forEach((tree,ti)=>{
      tree.id??=`tree_${ni}_${ti}`;tree.label??=tree.id;tree.trigger??='interact';tree.priority??=0;
      tree.conditions=normalizeConditions(tree.conditions);tree.excludeConditions=normalizeConditions(tree.excludeConditions);
      if(!Array.isArray(tree.nodes))tree.nodes=[];
      tree.nodes.forEach((node,di)=>{
        node.id??=`node_${ni}_${ti}_${di}`;node.type??='text';
        if(node.type==='text'){node.text??='';node.next??=null;node.expression??='neutral';node.expressionHold??=2;node.revealSpeed??='normal'}
        if(node.type==='choice'&&!Array.isArray(node.choices))node.choices=[];
        if(node.type==='sequence'){if(!Array.isArray(node.slots))node.slots=[];node.next??=null;node.exhaustedNext??=null}
        if(!Array.isArray(node.tags))node.tags=[];
      });
      tree.entryNode??=tree.nodes[0]?.id??null;
    });
  });
  return db;
}

function conditionSummary(tree){
  const c=normalizeConditions(tree.conditions);const parts=[];
  const add=(label,values)=>{if(values.length)parts.push(`${label}: ${values.map(friendly).join('/')}`)};
  add('Day',c.weekdays);add('Season',c.seasons);add('Weather',c.weather);add('Time',c.timesOfDay);add('Encounter',c.encounter);add('Map',c.maps);add('Station',c.stations);add('Species',c.playerSpecies);
  const r=c.relationship;if(r.min!=null||r.max!=null)parts.push(`Relationship: ${r.min??'–'}–${r.max??'∞'}♥`);
  return parts.join(' · ')||'No conditions — always available';
}
function searchTrees(trees){
  const q=state.search.trim().toLowerCase();if(!q)return trees;
  return trees.filter(t=>`${t.label} ${t.id} ${t.trigger} ${conditionSummary(t)}`.toLowerCase().includes(q));
}
function sortTrees(trees){
  const arr=[...trees];
  if(state.settings.sortMode==='priority')arr.sort((a,b)=>(b.priority||0)-(a.priority||0)||String(a.label).localeCompare(String(b.label)));
  else if(state.settings.sortMode==='specificity')arr.sort((a,b)=>treeSpecificity(b)-treeSpecificity(a)||String(a.label).localeCompare(String(b.label)));
  else arr.sort((a,b)=>String(a.label||a.id).localeCompare(String(b.label||b.id)));
  return arr;
}
