'use strict';
function renderNodeEditor(){
  const panel=$('nodeEditor'),body=$('nodeEditorBody'),tree=currentTree(),node=tree?.nodes?.find(n=>n.id===state.nodeId);
  const auto=state.settings.routeStyle==='orthogonal'&&state.settings.autoArrangeOrthographic;
  $('autoArrangeStatus').textContent=auto?'Auto-arrange on':'Auto-arrange off';$('autoArrangeStatus').classList.toggle('autoArrangeBadge',auto);
  if(!tree){panel.classList.add('hidden');body.innerHTML='';return}
  if(!state.nodeEditorOpen){panel.classList.add('hidden');return}
  panel.classList.remove('hidden');
  if(state.editorMode==='tree'||!node){renderTreeEditor(panel,body,tree);return}
  renderSelectedNodeEditor(panel,body,tree,node);
}
function renderTreeEditor(panel,body,tree){
  state.nodeId=null;state.editorMode='tree';$('nodeEditorTitle').textContent=`Tree settings · ${tree.label||tree.id}`;
  const questMeta=tree.banubuQuest&&typeof tree.banubuQuest==='object'?tree.banubuQuest:null; // Used to expose Banubu's runtime routing/difficulty metadata beside ordinary tree settings.
  const questPhase=questMeta?.phase||''; // Used to conditionally show request authoring fields on offer trees.
  const reward=questMeta?.reward&&typeof questMeta.reward==='object'?questMeta.reward:{}; // Used to edit the optional key-item reward attached to an offer tree.
  const banubuSection=questMeta?`
    <div class="editField full editorSection">
      <label>Banubu quest routing</label>
      <div class="editorNote">Banubu does not use ordinary daily/situational chatter. Runtime chooses one of these authored trees by phase + stage. Offer trees own recipe type, requested buff count, minimum stack strength, and an optional key-item reward.</div>
      <div class="fieldGrid">
        <div><label for="editBanubuPhase">Phase</label><select id="editBanubuPhase">${['intro','offer','active','ready','blocked'].map(value=>`<option value="${value}"${questPhase===value?' selected':''}>${value}</option>`).join('')}</select></div>
        <div><label for="editBanubuStage">Stage</label><input id="editBanubuStage" type="number" min="0" max="5" step="1" value="${Number(questMeta.stage)||0}"></div>
        ${questPhase==='offer'?`
          <div><label for="editBanubuQuestType">Requested recipe</label><select id="editBanubuQuestType"><option value="threeFishPie"${questMeta.questType!=='nineLeafTea'?' selected':''}>Three-Fish Pie</option><option value="nineLeafTea"${questMeta.questType==='nineLeafTea'?' selected':''}>Nine Leaf Tea</option></select></div>
          <div><label for="editBanubuBuffCount">Requested distinct buffs</label><input id="editBanubuBuffCount" type="number" min="1" max="3" step="1" value="${Math.max(1,Math.min(3,Number(questMeta.buffCount)||1))}"></div>
          <div><label for="editBanubuMinStacks">Minimum stacks per requested buff</label><input id="editBanubuMinStacks" type="number" min="1" max="9" step="1" value="${Math.max(1,Math.min(9,Number(questMeta.minStacks)||1))}"><div class="editorNote">Cooking strength: 1 Mild · 2 Hearty · 3 Concentrated · 4 Potent · 5+ Exceptional.</div></div>
          <div><label for="editBanubuRewardScope">Optional reward save scope</label><select id="editBanubuRewardScope"><option value="character"${reward.scope!=='world'?' selected':''}>character</option><option value="world"${reward.scope==='world'?' selected':''}>world</option></select></div>
          <div><label for="editBanubuRewardId">Optional reward key-item ID</label><input id="editBanubuRewardId" value="${esc(reward.id||'')}" placeholder="blank = no key-item reward"></div>
          <div><label for="editBanubuRewardLabel">Reward display name</label><input id="editBanubuRewardLabel" value="${esc(reward.label||'')}" placeholder="War-Paint Kit"></div>
          <div><label for="editBanubuFeatureId">Future feature ID</label><input id="editBanubuFeatureId" value="${esc(reward.featureId||'')}" placeholder="war_paint"></div>
        `:''}
      </div>
    </div>`:''; // Used to keep non-Banubu dialogue trees visually unchanged.
  body.innerHTML=`
    <div class="editField"><label for="editTreeLabel">Label</label><input id="editTreeLabel" value="${esc(tree.label||'')}"></div>
    <div class="editField"><label for="editTreeTrigger">Trigger</label><select id="editTreeTrigger">${['interact','gift','quest','relationship','date','custom'].map(v=>`<option value="${v}"${tree.trigger===v?' selected':''}>${v}</option>`).join('')}</select></div>
    <div class="editField"><label for="editTreePriority">Priority</label><input id="editTreePriority" type="number" min="0" max="99" value="${tree.priority??0}"></div>
    <div class="editField"><label for="editTreeEntry">Entry node</label><select id="editTreeEntry">${nodeTargetOptions(tree,tree.entryNode)}</select></div>
    ${banubuSection}
    <div class="editField full editorSection"><label>Required conditions</label><div class="editorNote">Every required condition must match.</div><div id="treeRequiredConditions"></div></div>
    <div class="editField full editorSection"><label>No-fly conditions</label><div class="editorNote">Any matching exclusion prevents this tree from running.</div><div id="treeExcludedConditions"></div></div>
    <div class="editField full editorActions"><button class="danger" id="editorDeleteTree">Delete Tree</button></div>`;
  $('editTreeLabel').addEventListener('input',e=>commitMutation('Edited tree label',()=>{tree.label=e.target.value},{render:'none',coalesceKey:`tree-label:${tree.id}`,log:false}));
  $('editTreeLabel').addEventListener('blur',()=>renderAll());
  $('editTreeTrigger').addEventListener('change',e=>commitMutation('Changed tree trigger',()=>{tree.trigger=e.target.value},{render:'all'}));
  $('editTreePriority').addEventListener('input',e=>commitMutation('Changed tree priority',()=>{tree.priority=Math.max(0,parseInt(e.target.value)||0)},{render:'none',coalesceKey:`tree-priority:${tree.id}`,log:false}));
  $('editTreePriority').addEventListener('blur',()=>renderAll());
  $('editTreeEntry').addEventListener('change',e=>commitMutation('Changed tree entry node',()=>{tree.entryNode=e.target.value||null},{render:'graph',resetScale:true}));
  if(questMeta){
    $('editBanubuPhase')?.addEventListener('change',e=>commitMutation('Changed Banubu quest phase',()=>{
      tree.banubuQuest.phase=e.target.value; // Used by BanubuQuestline.selectTree to route this tree.
      if(e.target.value==='intro')tree.banubuQuest.stage=0;
      else if(e.target.value==='blocked'&&Number(tree.banubuQuest.stage)<3)tree.banubuQuest.stage=3;
      else if(!(Number(tree.banubuQuest.stage)>=1&&Number(tree.banubuQuest.stage)<=5))tree.banubuQuest.stage=1;
    },{render:'all'}));
    $('editBanubuStage')?.addEventListener('change',e=>commitMutation('Changed Banubu quest stage',()=>{tree.banubuQuest.stage=Math.max(0,Math.min(5,parseInt(e.target.value)||0))},{render:'all'}));
    $('editBanubuQuestType')?.addEventListener('change',e=>commitMutation('Changed Banubu requested recipe',()=>{tree.banubuQuest.questType=e.target.value==='nineLeafTea'?'nineLeafTea':'threeFishPie'},{render:'all'}));
    $('editBanubuBuffCount')?.addEventListener('change',e=>commitMutation('Changed Banubu requested buff count',()=>{tree.banubuQuest.buffCount=Math.max(1,Math.min(3,parseInt(e.target.value)||1))},{render:'all'}));
    $('editBanubuMinStacks')?.addEventListener('change',e=>commitMutation('Changed Banubu minimum buff strength',()=>{tree.banubuQuest.minStacks=Math.max(1,Math.min(9,parseInt(e.target.value)||1))},{render:'all'}));
    const ensureReward=()=>tree.banubuQuest.reward||(tree.banubuQuest.reward={}); // Used only when an optional reward field is actually edited.
    $('editBanubuRewardScope')?.addEventListener('change',e=>commitMutation('Changed Banubu reward save scope',()=>{ensureReward().scope=e.target.value==='world'?'world':'character'},{render:'all'}));
    $('editBanubuRewardId')?.addEventListener('input',e=>commitMutation('Edited Banubu reward ID',()=>{const value=e.target.value.trim();if(value)ensureReward().id=value;else if(tree.banubuQuest.reward)delete tree.banubuQuest.reward.id},{render:'none',coalesceKey:`banubu-reward-id:${tree.id}`,log:false}));
    $('editBanubuRewardId')?.addEventListener('blur',()=>renderAll());
    $('editBanubuRewardLabel')?.addEventListener('input',e=>commitMutation('Edited Banubu reward label',()=>{ensureReward().label=e.target.value},{render:'none',coalesceKey:`banubu-reward-label:${tree.id}`,log:false}));
    $('editBanubuRewardLabel')?.addEventListener('blur',()=>renderAll());
    $('editBanubuFeatureId')?.addEventListener('input',e=>commitMutation('Edited Banubu feature ID',()=>{ensureReward().featureId=e.target.value.trim()},{render:'none',coalesceKey:`banubu-feature-id:${tree.id}`,log:false}));
    $('editBanubuFeatureId')?.addEventListener('blur',()=>renderAll());
  }
  renderConditionPicker($('treeRequiredConditions'),tree.conditions,()=>{renderNavigator();renderStateSummary();refreshGraphSubtitle()},'require',`tree-required:${tree.id}`);
  renderConditionPicker($('treeExcludedConditions'),tree.excludeConditions,()=>{renderStateSummary();refreshGraphSubtitle()},'exclude',`tree-excluded:${tree.id}`);
  $('editorDeleteTree').addEventListener('click',()=>deleteTree(tree.id));
  syncNodeEditorResize();
}
function renderSelectedNodeEditor(panel,body,tree,node){
  const displayType=nodeDisplayType(node); // Used to expose Access Shop as its own editable node type while retaining runtime-compatible choice data.
  $('nodeEditorTitle').textContent=`Edit ${displayType} · ${node.id}`;
  const common=`<div class="editField"><label for="editNodeType">Node type</label><select id="editNodeType">${['text','choice','accessShop','end','sequence'].map(v=>`<option value="${v}"${displayType===v?' selected':''}>${v==='accessShop'?'access shop':v}</option>`).join('')}</select></div><div class="editField editorActions"><button class="${tree.entryNode===node.id?'warn':'secondary'}" id="editorSetEntry">${tree.entryNode===node.id?'★ Entry node':'Set as entry'}</button><button class="danger" id="editorDeleteNode">Delete Node</button></div>`;
  let specific='';
  if(displayType==='accessShop'){
    specific=`<div class="editField full editorSection"><label for="editAccessShopPool">Shop to access</label><select id="editAccessShopPool">${shopRegistry.map(shop=>`<option value="${esc(shop.id)}"${accessShopPool(node)===shop.id?' selected':''}>${esc(shop.label)}</option>`).join('')}</select><div class="editorNote">Point a Choice at this node to make that choice open the selected shop immediately. The node remains runtime-compatible with the existing openShop action.</div></div>`;
  }else if(node.type==='text'){
    specific=`<div class="editField full"><label for="editNodeText">Dialogue text</label><textarea id="editNodeText"></textarea><div class="tokenBtnRow">${buildTokenButtonsHtml()}</div></div><div class="editField"><label for="editNodeNext">Next node</label><select id="editNodeNext">${nodeTargetOptions(tree,node.next,node.id)}</select></div><div class="editField"><label for="editExpression">Expression</label><select id="editExpression">${EXPRESSION_OPTIONS.map(v=>`<option${(node.expression||'neutral')===v?' selected':''}>${v}</option>`).join('')}</select></div><div class="editField"><label for="editExpressionHold">Expression hold after end</label><input id="editExpressionHold" type="number" min="0" max="30" step=".5" value="${node.expressionHold??2}"></div><div class="editField"><label for="editRevealSpeed">Reveal speed</label><select id="editRevealSpeed">${REVEAL_SPEED_OPTIONS.map(v=>`<option${(node.revealSpeed||'normal')===v?' selected':''}>${v}</option>`).join('')}</select></div>`;
  }else if(node.type==='choice'){
    specific=`<div class="editField full editorSection"><label>Choices</label><div id="choiceEditList"></div><button class="good" id="addChoiceEdit">+ Choice</button></div>`;
  }else if(node.type==='sequence'){
    specific=`<div class="editField"><label for="editSeqNext">Next while slots remain</label><select id="editSeqNext">${nodeTargetOptions(tree,node.next,node.id)}</select></div><div class="editField"><label for="editSeqExhaust">After exhausted</label><select id="editSeqExhaust">${nodeTargetOptions(tree,node.exhaustedNext,node.id)}</select></div><div class="editField full editorSection"><label>Sequence slots</label><div id="slotEditList"></div><button class="good" id="addSlotEdit">+ Slot</button></div>`;
  }else specific='<div class="editField full"><div class="editorNote">This node ends the conversation and has no outgoing connection.</div></div>';
  specific+=`<div class="editField full editorSection"><label>Tags</label><div id="nodeTagEditor"></div><button class="secondary" id="addBreakSequenceTag">+ break_sequence tag</button></div>`;
  body.innerHTML=common+specific;
  $('editNodeType').addEventListener('change',e=>changeNodeType(node,e.target.value));
  $('editorSetEntry').addEventListener('click',()=>setEntryNode(node.id));$('editorDeleteNode').addEventListener('click',()=>deleteNode(node.id));
  if(displayType==='accessShop')wireAccessShopNodeEditor(tree,node);
  else if(node.type==='text')wireTextNodeEditor(tree,node,body);
  else if(node.type==='choice')wireChoiceNodeEditor(tree,node);
  else if(node.type==='sequence')wireSequenceNodeEditor(tree,node);
  renderTagEditor(tree,node);
  syncNodeEditorResize();
}
function changeNodeType(node,type){const tree=currentTree();commitMutation(`Changed node type to ${type}`,()=>{const tags=node.tags||[];Object.keys(node).forEach(k=>{if(!['id','type','tags','pos'].includes(k))delete node[k]});node.tags=tags;if(type==='accessShop')syncAccessShopNode(node,shopRegistry[0]?.id||'generalStoreWares');else{node.type=type;if(type==='text')Object.assign(node,{text:'',next:null,expression:'neutral',expressionHold:2,revealSpeed:'normal'});if(type==='choice')node.choices=[{label:'',next:null}];if(type==='sequence')Object.assign(node,{slots:[],next:null,exhaustedNext:null})}syncInboundAccessShopActions(tree,node)},{render:'graph',resetScale:true})}
function wireAccessShopNodeEditor(tree,node){const select=$('editAccessShopPool');if(!select)return;select.addEventListener('change',e=>commitMutation('Changed Access Shop pool',()=>{syncAccessShopNode(node,e.target.value);syncInboundAccessShopActions(tree,node)},{render:'graph'}))}
function wireTextNodeEditor(tree,node,scope){const input=$('editNodeText');input.value=node.text||'';input.addEventListener('input',e=>{commitMutation('Edited dialogue text',()=>{node.text=e.target.value},{render:'none',coalesceKey:`text:${tree.id}:${node.id}`,log:false});updateVisibleNodeText(node.id,e.target.value,'.dNodeText')});input.addEventListener('blur',()=>renderGraph());wireTokenButtons(input,scope);$('editNodeNext').addEventListener('change',e=>commitMutation('Changed text-node connection',()=>{node.next=e.target.value||null},{render:'graph',resetScale:true}));$('editExpression').addEventListener('change',e=>commitMutation('Changed expression',()=>{node.expression=e.target.value},{render:'graph'}));$('editExpressionHold').addEventListener('input',e=>commitMutation('Changed expression hold',()=>{node.expressionHold=Math.max(0,parseFloat(e.target.value)||0)},{render:'none',coalesceKey:`hold:${node.id}`,log:false}));$('editRevealSpeed').addEventListener('change',e=>commitMutation('Changed reveal speed',()=>{node.revealSpeed=e.target.value},{render:'graph'}))}
function renderChoiceActions(choice,choiceIndex){
  return (choice.actions||[]).map((action,actionIndex)=>{
    if(action.type==='openShop'&&action.sourceNodeId)return'';
    const def=CHOICE_ACTION_TYPES.find(d=>d.type===action.type)||{label:action.type,field:null}; // Used to pick the editor control shape for this authored action.
    let value=''; // Used as the editable value-control markup inserted beside the action label.
    if(def.kind==='shopSelect'){
      value=`<select class="choiceActionValue" data-choice="${choiceIndex}" data-action="${actionIndex}" data-field="pool"><option value="">— default shop —</option>${shopRegistry.map(s=>`<option value="${esc(s.id)}"${action.pool===s.id?' selected':''}>${esc(s.label)}</option>`).join('')}</select>`;
    }else if(def.kind==='banubuQuest'){
      const operation=String(action.operation||'accept'); // Used to select which Banubu quest state transition this choice performs.
      const stage=Math.max(0,Math.min(5,Number(action.stage)||0)); // Used to bind accept/turn-in actions to their sequential quest stage.
      value=`<span style="display:flex;gap:6px;flex-wrap:wrap"><select class="choiceActionValue" data-choice="${choiceIndex}" data-action="${actionIndex}" data-field="operation"><option value="unlockRecipe"${operation==='unlockRecipe'?' selected':''}>unlock recipe / start chain</option><option value="accept"${operation==='accept'?' selected':''}>accept stage</option><option value="turnIn"${operation==='turnIn'?' selected':''}>turn in stage</option></select><input class="choiceActionValue" data-choice="${choiceIndex}" data-action="${actionIndex}" data-field="stage" type="number" min="0" max="5" step="1" value="${stage}" title="Quest stage; use 0 for recipe unlock"></span>`;
    }else if(def.field){
      value=`<input class="choiceActionValue" data-choice="${choiceIndex}" data-action="${actionIndex}" data-field="${def.field}" value="${esc(action[def.field]||'')}" placeholder="${esc(def.fieldLabel||'Value')}">`;
    }
    return `<div class="actionRow"><span class="pill">${esc(def.label)}</span>${value||'<span class="editorNote">No value</span>'}<button class="danger removeChoiceAction" data-choice="${choiceIndex}" data-action="${actionIndex}">×</button></div>`;
  }).join('');
}
function wireChoiceNodeEditor(tree,node){const list=$('choiceEditList');list.innerHTML=(node.choices||[]).map((choice,i)=>`<div class="choiceEditRow" data-choice-edit="${i}"><div><input class="choiceLabelEdit" value="${esc(choice.label||'')}" aria-label="Choice ${i+1} text"><div class="actionStack">${renderChoiceActions(choice,i)}</div><div class="actionRow"><select class="newChoiceActionType" data-choice="${i}">${CHOICE_ACTION_TYPES.map(d=>`<option value="${d.type}">${esc(d.label)}</option>`).join('')}</select><span></span><button class="secondary addChoiceAction" data-choice="${i}">+ Action</button></div></div><select class="choiceTargetEdit">${nodeTargetOptions(tree,choice.next,node.id)}</select><button class="danger choiceRemoveEdit">×</button></div>`).join('');list.querySelectorAll('[data-choice-edit]').forEach(row=>{const i=+row.dataset.choiceEdit;row.querySelector('.choiceLabelEdit').addEventListener('input',e=>commitMutation('Edited choice text',()=>{node.choices[i].label=e.target.value},{render:'none',coalesceKey:`choice:${tree.id}:${node.id}:${i}`,log:false}));row.querySelector('.choiceLabelEdit').addEventListener('blur',()=>renderGraph());row.querySelector('.choiceTargetEdit').addEventListener('change',e=>commitMutation('Changed choice connection',()=>{node.choices[i].next=e.target.value||null;syncChoiceAccessShopAction(tree,node.choices[i])},{render:'graph',resetScale:true}));row.querySelector('.choiceRemoveEdit').addEventListener('click',()=>commitMutation('Removed choice',()=>{node.choices.splice(i,1)},{render:'graph',resetScale:true}))});list.querySelectorAll('.addChoiceAction').forEach(btn=>btn.addEventListener('click',()=>{const i=+btn.dataset.choice,type=list.querySelector(`.newChoiceActionType[data-choice="${i}"]`).value,def=CHOICE_ACTION_TYPES.find(d=>d.type===type),action={type};if(def?.field)action[def.field]='';if(def?.kind==='banubuQuest'){action.operation='accept';action.stage=1}commitMutation('Added choice action',()=>{node.choices[i].actions??=[];node.choices[i].actions.push(action)},{render:'graph'})}));list.querySelectorAll('.choiceActionValue').forEach(el=>el.addEventListener(el.tagName==='SELECT'?'change':'input',()=>{const i=+el.dataset.choice,a=+el.dataset.action,field=el.dataset.field;commitMutation('Edited choice action',()=>{node.choices[i].actions[a][field]=el.value},{render:'none',coalesceKey:`action:${node.id}:${i}:${a}:${field}`,log:false})}));list.querySelectorAll('.removeChoiceAction').forEach(btn=>btn.addEventListener('click',()=>{const i=+btn.dataset.choice,a=+btn.dataset.action;commitMutation('Removed choice action',()=>{node.choices[i].actions.splice(a,1);if(!node.choices[i].actions.length)delete node.choices[i].actions},{render:'graph'})}));$('addChoiceEdit').addEventListener('click',()=>commitMutation('Added choice',()=>{node.choices??=[];node.choices.push({label:'New choice',next:null})},{render:'graph',resetScale:true}))}
function wireSequenceNodeEditor(tree,node){$('editSeqNext').addEventListener('change',e=>commitMutation('Changed sequence next connection',()=>{node.next=e.target.value||null},{render:'graph',resetScale:true}));$('editSeqExhaust').addEventListener('change',e=>commitMutation('Changed sequence exhausted connection',()=>{node.exhaustedNext=e.target.value||null},{render:'graph',resetScale:true}));const list=$('slotEditList');list.innerHTML=(node.slots||[]).map((slot,i)=>`<div class="slotEditRow" data-slot-edit="${i}"><select class="slotTargetEdit">${nodeTargetOptions(tree,slot.nodeId,node.id)}</select><input class="slotDepthEdit" type="number" min="0" value="${slot.depth??0}"><button class="danger slotRemoveEdit">×</button></div>`).join('');list.querySelectorAll('[data-slot-edit]').forEach(row=>{const i=+row.dataset.slotEdit;row.querySelector('.slotTargetEdit').addEventListener('change',e=>commitMutation('Changed sequence slot connection',()=>{node.slots[i].nodeId=e.target.value||null},{render:'graph',resetScale:true}));row.querySelector('.slotDepthEdit').addEventListener('change',e=>commitMutation('Changed sequence slot depth',()=>{node.slots[i].depth=Math.max(0,parseInt(e.target.value)||0)},{render:'graph'}));row.querySelector('.slotRemoveEdit').addEventListener('click',()=>commitMutation('Removed sequence slot',()=>{node.slots.splice(i,1)},{render:'graph',resetScale:true}))});$('addSlotEdit').addEventListener('click',()=>commitMutation('Added sequence slot',()=>{node.slots??=[];node.slots.push({nodeId:null,depth:0})},{render:'graph',resetScale:true}))}
function renderTagEditor(tree,node){node.tags??=[];const box=$('nodeTagEditor');box.innerHTML=node.tags.length?node.tags.map((tag,i)=>`<div class="tagRowEditor" data-tag-index="${i}"><span class="pill">${esc(tag.type)}</span>${tag.type==='break_sequence'?`<select class="tagSequenceTarget"><option value="">— sequence —</option>${(tree.nodes||[]).filter(n=>n.type==='sequence'&&n.id!==node.id).map(n=>`<option value="${esc(n.id)}"${tag.sequenceNodeId===n.id?' selected':''}>${esc(n.id)}</option>`).join('')}</select>`:'<span></span>'}<button class="danger removeNodeTag">×</button></div>`).join(''):'<div class="editorNote">No tags on this node.</div>';box.querySelectorAll('[data-tag-index]').forEach(row=>{const i=+row.dataset.tagIndex;row.querySelector('.tagSequenceTarget')?.addEventListener('change',e=>commitMutation('Changed break-sequence target',()=>{node.tags[i].sequenceNodeId=e.target.value},{render:'graph'}));row.querySelector('.removeNodeTag').addEventListener('click',()=>commitMutation('Removed node tag',()=>{node.tags.splice(i,1)},{render:'graph'}))});$('addBreakSequenceTag').addEventListener('click',()=>commitMutation('Added break_sequence tag',()=>{node.tags.push({type:'break_sequence',sequenceNodeId:''})},{render:'graph'}))}
