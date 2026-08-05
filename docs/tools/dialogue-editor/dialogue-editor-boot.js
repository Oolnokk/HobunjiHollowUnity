'use strict';
function exportLayout(){
  const payload={schema:'hobunji_dialogue_layout_lab.v1',createdAt:new Date().toISOString(),settings:state.settings,selectedNpcId:state.npcId,selectedTreeId:state.treeId,notes:'Layout-only file. It does not modify the dialogue database.'};
  downloadJson(payload,'hobunji-dialogue-layout.json');logEvent('Exported layout settings');
}
function exportDatabase(){downloadJson(deepCopy(state.db),'hobunji-starter-npc-database.json');logEvent('Exported edited NPC database')}
function downloadJson(obj,name){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function loadFile(file){
  try{
    const raw=JSON.parse(await file.text());
    if(raw.schema==='hobunji_dialogue_layout_lab.v1'&&raw.settings){commitMutation('Loaded layout settings file',()=>{state.settings=validateSettings({...DEFAULT_SETTINGS,...raw.settings});state.millerPath=[]},{resetScale:true,detail:file.name});return}
    applyLoadedDatabase(raw,file.name);
  }catch(e){captureError(`Could not load ${file.name}`,e);alert('Could not load that file: '+e.message)}
}
function useDemo(){applyLoadedDatabase(DEMO_DB,'Built-in sample');logEvent('Restored demo database')}
function resetLayout(){commitMutation('Reset layout settings',()=>{state.settings=deepCopy(DEFAULT_SETTINGS);state.millerPath=[]},{resetScale:true})}

function diagnosticsText(){
  return `Hobunji Dialogue Editor diagnostic report\nGenerated: ${new Date().toISOString()}\nViewport: ${innerWidth}x${innerHeight}\nUser agent: ${navigator.userAgent}\n\nSTATE\n${safeStringify({npcId:state.npcId,treeId:state.treeId,settings:state.settings,npcCount:state.db?.npcs?.length||0,history:{undo:state.history.past.length,redo:state.history.future.length,last:state.history.lastLabel}})}\n\nERRORS\n${state.errors.length?state.errors.join('\n\n'):'None'}\n\nRECENT EVENTS\n${state.events.join('\n\n')||'None'}`;
}
function renderDiagnostics(){
  const log=$('diagLog');if(!log)return;log.textContent=diagnosticsText();$('diagHealth').textContent=state.errors.length?`${state.errors.length} error(s)`:'Healthy';$('diagHealth').style.color=state.errors.length?'var(--bad)':'var(--good)';
}
async function copyDiagnostics(){
  const text=diagnosticsText();
  try{await navigator.clipboard.writeText(text);logEvent('Copied diagnostic report')}
  catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();logEvent('Copied diagnostic report using fallback')}
}

function wire(){
  $('controlsToggle').onclick=()=>$('controlPanel').classList.toggle('open');$('closeControls').onclick=()=>$('controlPanel').classList.remove('open');
  $('importBtn').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>{const file=e.target.files[0];if(file)loadFile(file);e.target.value=''};
  $('undoBtn').onclick=undo;$('redoBtn').onclick=redo;$('exportDbBtn').onclick=exportDatabase;$('exportBtn').onclick=exportLayout;
  $('saveDbOverrideBtn').onclick=saveDbOverride;$('clearDbOverrideBtn').onclick=clearDbOverride;$('poolModalBtn').onclick=openPoolModal;$('poolModalClose').onclick=closePoolModal;$('addPoolBtn').onclick=addPool;
  $('randomPromptBtn').onclick=openRandomPrompt;$('randomPromptClose').onclick=closeRandomPrompt;$('rerollBtn').onclick=rerollPrompts;
  $('diagBtn').onclick=()=>{$('diagDrawer').classList.toggle('hidden');renderDiagnostics()};$('closeDiag').onclick=()=>$('diagDrawer').classList.add('hidden');$('copyDiag').onclick=copyDiagnostics;$('clearDiag').onclick=()=>{state.errors=[];state.events=[];$('errorCount').textContent='0';$('errorBadge').classList.remove('show');renderDiagnostics()};
  $('closeNodeEditor').onclick=()=>{state.nodeId=null;state.editorMode='tree';renderGraph();syncAuthoringButtons()};
  $('npcSelect').onchange=e=>{state.npcId=e.target.value;state.treeId=currentNpc()?.dialogueTrees?.[0]?.id||null;state.nodeId=null;state.editorMode='tree';poolSel={poolId:null,expandedEntryId:null};state.millerPath=[];resetGraphScale();renderAll();logEvent('Selected NPC',state.npcId)};
  $('treeSearch').oninput=e=>{state.search=e.target.value;renderNavigator()};
  $('addTreeBtn').onclick=()=>addTree();$('treeEditorBtn').onclick=openTreeEditor;$('deleteTreeBtn').onclick=()=>deleteTree();$('addTextBtn').onclick=()=>addNode('text');$('addChoiceBtn').onclick=()=>addNode('choice');$('addEndBtn').onclick=()=>addNode('end');$('addSequenceBtn').onclick=()=>addNode('sequence');$('deleteNodeBtn').onclick=()=>deleteNode();$('setEntryBtn').onclick=()=>setEntryNode();
  ['workspaceOrientation','navPlacement','graphFlow','portAttachment','routeStyle','nodeDensity','navStyle','emptyHandling','multiHandling','sortMode'].forEach(k=>$(k).onchange=e=>setSetting(k,e.target.value));
  ['showConditionSummary','autoArrangeOrthographic','colorCodeNodes'].forEach(k=>$(k).onchange=e=>setSetting(k,e.target.checked));
  $('clearHierarchy').onclick=()=>commitMutation('Switched to flat tree list',()=>{state.settings.hierarchy=[];state.millerPath=[]});
  $('reverseHierarchy').onclick=()=>commitMutation('Reversed hierarchy order',()=>{state.settings.hierarchy=[...state.settings.hierarchy].reverse();state.millerPath=[]},{detail:[...state.settings.hierarchy].reverse()});
  $('pinCurrent').onclick=pinCurrent;$('useDemo').onclick=useDemo;$('resetLayout').onclick=resetLayout;$('exportDbInPanel').onclick=exportDatabase;$('exportLayoutInPanel').onclick=exportLayout;$('fitBtn').onclick=fitGraph;
  $('toggleAlternatives').onclick=()=>commitMutation(state.settings.showAlternatives?'Hid alternatives':'Showed alternatives',()=>{state.settings.showAlternatives=!state.settings.showAlternatives},{render:'all'});
  addEventListener('pointermove',updateTreePointerDrag,{passive:false});addEventListener('pointerup',finishTreePointerDrag,{passive:false});addEventListener('pointercancel',finishTreePointerDrag,{passive:false});
  addEventListener('keydown',e=>{const tag=e.target.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}else if((e.key==='Delete'||e.key==='Backspace')&&state.nodeId){e.preventDefault();deleteNode()}});
  addEventListener('resize',()=>{if(innerWidth>720)$('controlPanel').classList.remove('open')});
}

try{wire();resetHistory('No edits yet');renderAll();Promise.all([loadMapRegistry(),loadShopRegistry()]).finally(()=>bootDatabase());logEvent('Dialogue editor initialized',{presets:PRESETS.length})}catch(e){captureError('Initialization failed',e)}
