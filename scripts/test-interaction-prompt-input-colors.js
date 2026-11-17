#!/usr/bin/env node
'use strict';

const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8'); // Used to inspect the shipped source without needing a browser runtime.
const game = read('docs/game.js'); // Used to verify semantic input selection and structured prompt wiring.
const popup = read('docs/js/world-popup-text.js'); // Used to verify the segmented world-space row renderer.
const slotColors = read('docs/js/action-arch-slot-colors.js'); // Used to verify the shared action/dodge palette.
const style = read('docs/style.css'); // Used to verify the touch dodge button shares its prompt color.

assert(slotColors.includes("dodge: '#A78BFA'"), 'dodge has a distinct electric-violet input color');
assert(slotColors.includes('inputColors: INPUT_COLORS'), 'semantic prompt colors are exposed by the action arch');
assert(style.includes('var(--dodge-input-color, #A78BFA)'), 'the touch dodge arch uses the shared dodge color');
assert(game.includes("button.action === 'climb_branch' ? 'jump'"), 'climb prompts identify the actual jump input');
assert(game.includes('promptInputs,'), 'world prompt synchronization receives structured input hints');
assert(popup.includes('makeInteractionPlane'), 'interaction rows use segmented canvas rendering');
assert(popup.includes('INTERACTION_VERB_COLOR'), 'interaction verbs have a dedicated uncoded emphasis color');
assert(popup.includes('const mainFontPx = 98'), 'interaction inputs, verbs, and object words share the larger font');
assert(popup.includes('const connectorFontPx = 78'), 'connector words retain the former prompt size');
assert(popup.includes('const gapPx = 34'), 'interaction inputs have an extra separating space');
assert(popup.includes('const wordGapPx = 22'), 'zone entrance words have a visible separating space');
assert(!popup.includes('detailFontPx') && !popup.includes('verbFontPx') && !popup.includes('inputFontPx'), 'interaction rows use exactly two font sizes');
assert(popup.includes('INTERACTION_LIST_SCALE = 0.25'), 'interaction rows preserve the former physical baseline');
assert(popup.includes('INTERACTION_OBJECT_COLOR'), 'interaction object words use a separate color');
assert(popup.includes('verbAfterToIndex'), 'labels such as Hold to Take Egg emphasize the actual action verb');
assert(popup.includes('inputActionId: promptInput?.actionId'), 'interaction debug data preserves the semantic input ID');
assert(popup.includes('INTERACTION_CLEAR_GRACE_MS = 120'), 'transient empty action refreshes receive a short anti-flicker grace window');
assert(popup.includes('scheduleInteractionPromptClear()'), 'world prompt synchronization can defer only transient empty clears');
assert(popup.includes("if (options.enabled === false) clearInteractionPrompts();"), 'explicitly disabled world prompts still clear immediately');
assert(popup.includes('cancelInteractionPromptClear();'), 'a valid prompt refresh cancels any pending transient clear');


const between = (source,start,end) => { // Extracts production input paths for executable regression coverage.
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'Missing live prompt seam: '+start);
  return source.slice(a,b);
};
const live={controller:{interact:'Button0',toolSelect:'Button5',action1:'RightTrigger',action2:'LeftTrigger',action3:'Button2'},desktop:{interact:'KeyE'}}; // Simulated player remaps.
let device='controller',faced=true,torch=true; // Changed by tests to cover touch, keyboard and owned controller presses.
const win={InputBindings:{
  getCurrentBindings:()=>live,
  buttonLabel:code=>({Button0:'A',Button5:'RB',Button2:'X',Button9:'Start',RightTrigger:'RT',LeftTrigger:'LT',KeyE:'E'})[code]||'',
  resolveActionForButton:(dev,code)=>dev==='controller'?(code==='Button0'?'jump':Object.entries(live.controller).find(([,v])=>v===code)?.[0]||null):null,
},ActionArchSlotColors:{inputColors:{interact:'#aaa',jump:'#bbb',toolSelect:'#ccc',action1:'#ddd'}}}; // Same controller A Jump priority as the game.
const promptSource=read('docs/js/action-prompt-ui.js'); // Actual binding-label implementation.
new Function('window','document',promptSource)(win,{getElementById:()=>null});
win.ActionPromptUI.init({getLastInputDevice:()=>device,inputBindings:live});
assert.equal(win.ActionPromptUI.actionPromptGlyph('interact'),'','Jump-owned A is not shown for Interact');
assert.equal(win.ActionPromptUI.actionPromptGlyph('toolSelect'),'RB','Tool Select uses its rebound controller button');
device='desktop';assert.equal(win.ActionPromptUI.actionPromptGlyph('interact'),'E','desktop keeps E');
const mapInputs=new Function('btns','heldMode','sitInteraction','promptButtons','window',
  between(game,'        const nonClimbBtns = btns.filter(','        // Every action supplied by an aimed world object')
  +between(game,'        const promptDevice = window.ActionPromptUI.getLastInputDevice();',
    '        window.WorldPopupText?.syncInteractionPrompts?.(')+'return promptInputs;'); // Real game.js slot assignment and hint resolution.
const ids=(buttons,mode='tool')=>mapInputs(buttons,mode,false,buttons,win).map(x=>x.actionId); // Captures semantic input IDs in physical order.
const climb={action:'climb_branch'},first={action:'obj_first'},item={action:'consume_held_item'}; // Prompts that occupy different physical slots.
const rubble={action:'shattercask_collect',inputAction:'interact'}; // Interact is Jump on pad inside the ruin.
const torchSwing={action:'torch_swing'},torchThrow={action:'torch_throw'},door={action:'dev_ruin_world_0',inputAction:'interact'}; // Torch reserves first two arch slots.
device='controller';
assert.deepEqual(ids([climb,first]),['jump','action1'],'popup-only Jump does not shift Action 1');
assert.deepEqual(ids([first,item]),['action1','itemAction1'],'item and tool slots stay separate');
assert.deepEqual(ids([rubble]),['action1'],'rubble now shows RT rather than Jump A');
assert.deepEqual(ids([torchSwing,torchThrow,door]),['action1','action2','action3'],'torch door shows controller X');
live.controller.action3=null;
assert.deepEqual(ids([torchSwing,torchThrow,door]),['action1','action2',''],'unbound Action 3 is not advertised');
live.controller.action3='Button2';live.controller.interact='Button9';
assert.deepEqual(ids([rubble]),['interact'],'working remapped Interact stays available');
device='touch';live.controller.interact='Button0';
assert.deepEqual(ids([rubble]),['action1'],'touch uses physical Action 1, not nonexistent Interact button');
assert.deepEqual(ids([torchSwing,torchThrow,door]),['action1','action2','action3'],'touch torch door uses third arch slot');
device='desktop';
assert.deepEqual(ids([rubble]),['interact'],'keyboard keeps Interact E');
assert.equal(ids(Array.from({length:6},(_,i)=>({action:'obj_'+i})))[5],'','overflow cannot invent Action 6');

const shatter=read('docs/js/shattercasks.js'); // Real pickup prompt owner.
const vase={id:'v',exploded:false,carried:false,promptButtons:[{label:'Pick up Shattercask',inputAction:'interact'}]}; // A nearby physical shattercask.
const burMap=new Map([['ruin',{vases:new Map([['v',vase]])}]]); // Active area used for pickup validation.
const pickup=new Function('window','held','promptClaim','records','area','facedShattercask','playerPosition',
  between(shatter,'  function promptButtons() {','  function baseHeight(')+'return promptButtons;')(
  {...win,WorldActionInputClaims:{claimFor:()=>({ownerId:'shattercask'})}},
  null,'vase:v',burMap,()=> 'ruin',()=>faced?vase:null,()=>({})); // Real faced-target and claim logic.
device='controller';
assert.equal(pickup()[0].inputAction,'toolSelect','Shattercask pickup uses Tool Select while A jumps');
live.controller.toolSelect='Button0';
assert.equal(pickup(),null,'remapped Tool Select on Jump cannot be offered');
live.controller.toolSelect='Button5';live.controller.interact='Button9';
assert.equal(pickup()[0].inputAction,'interact','working remapped Interact remains usable');
live.controller.interact=null;
assert.equal(pickup()[0].inputAction,'toolSelect','unbound Interact falls back to selector');
device='touch';faced=false;
assert.equal(pickup(),null,'touch selector only offers faced target');
faced=true;assert.equal(pickup()[0].inputAction,'toolSelect','touch offers its real tool button');
device='desktop';assert.equal(pickup()[0].inputAction,'interact','keyboard pickup remains E');

const ruin=read('docs/js/dev-random-ruin-interactions.js'); // Separate V50 popup bridge.
let result=null; // Captures real bridge output without rendering a scene.
const deps={window:{...win,AdventuringTools:{isHoldingTorch:()=>torch},WorldPopupText:{syncInteractionPrompts:o=>{result=o;}}},
  actionButtonsFromRows:rows=>rows.map(r=>({action:r.action,inputAction:r.inputAction||'action1',worldInteraction:true})),
  PROXIMITY_DOOR_KINDS:new Set(['transitdoor']),promptAnchor:{parent:true},lastAnchor:null,
  ruinRoot:()=>null,currentDevice:()=>device,bindingLabel:id=>id,inputColor:()=> '#aaa',inRuin:()=>true,activeScene:()=>null}; // Minimal scene-independent test inputs.
const syncRuin=new Function(...Object.keys(deps),
  between(ruin,'  function syncWorldPopup(rows) {','  function refreshRows(')+'return syncWorldPopup;')(...Object.values(deps));
const row={kind:'transitdoor',action:'dev_ruin_world_0'},other={kind:'mechanism',action:'dev_ruin_world_1'}; // Door and unrelated action controls.
const nativeIds=rows=>{syncRuin(rows);return result.promptInputs.map(p=>p.actionId);}; // Real bridge hints.
device='controller';assert.deepEqual(nativeIds([row]),['action3'],'native controller torch door shows X');
assert.deepEqual(nativeIds([other,row]),['action1','action3'],'unrelated ruin action is not remapped');
device='touch';assert.deepEqual(nativeIds([row]),['action3'],'native touch torch door shows third action');
device='keyboard';assert.deepEqual(nativeIds([row]),['interact'],'keyboard door keeps E');
torch=false;assert.deepEqual(nativeIds([row]),['action1'],'normal door keeps Action 1');

const html=read('docs/index.html'),bootstrap=read('docs/js/dev-random-ruin-bootstrap.js'); // Both script loaders must invalidate stale cached builds.
for(const file of ['game.js','js/action-prompt-ui.js','js/world-popup-text.js','js/shattercasks.js'])
  assert(html.includes(file+'?v=20261117worldPromptInputs1'),file+' needs new cache token');
assert(bootstrap.includes('js/dev-random-ruin-interactions.js?v=20261117worldPromptInputs1'),'ruin adapter needs new cache token');

console.log('interaction prompt colors and real input routes: PASS');
