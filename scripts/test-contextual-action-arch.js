#!/usr/bin/env node
'use strict';
// The existing game action arch renders claimed contextual actions; no side-button should be spawned.
const assert = require('node:assert/strict'); // Verifies real production router and HUD layout integration.
const fs = require('node:fs'); // Reads shipped scripts rather than reimplementing the input arbitration.
const scripts = {
  router: fs.readFileSync('docs/js/world-action-input-claims.js','utf8'),
  arch: fs.readFileSync('docs/js/action-prompt-ui.js','utf8'),
  hunt: fs.readFileSync('docs/js/festival-blossom-hunt.js','utf8')
};
assert.doesNotMatch(scripts.hunt,/createPickPrompt|createElement\(['"]button['"]\)/,
  'Five Blossoms must not make a standalone floating pickup button');
assert.match(scripts.hunt,/showInArch:true/, 'Five Blossoms opts into the native action arch');
const listeners = new Map(); // Captures only event types registered by the production shared input adapter.
const window = { addEventListener() {} };
const document = {
  getElementById(id) {return id==='dialogueChoiceSelectionStyle'?{}:null;},
  addEventListener(name,cb) {listeners.set(name,cb);}
};
new Function('window','document',scripts.router)(window,document);
new Function('window','document',scripts.arch)(window,document);
window.ActionPromptUI.init({});
const router = window.GameplayInputRouter;
const first = {action:'cut',label:'Cut'}, second = {action:'torch_throw',label:'Throw torch'};
let picks=0; // Counts actual claim executions through the same device-neutral dispatcher.
router.setClaims('five-blossoms-tree',[{
  actionId:'action3',priority:65,label:'Pick Cyan Blossom',hudIcon:'🌸',showInArch:true,onPress(){picks++;}
}]);
for (const heldMode of ['tool','item']) {
  const slots = window.ActionPromptUI.createActionArchLayout([first,second],heldMode,false).slots;
  assert.equal(slots[0],first, 'existing primary arch action is preserved');
  assert.equal(slots[1],second, 'existing secondary arch action is preserved');
  assert.equal(slots[2].action,'context_arch_action3', 'pickup occupies regular third action button');
  assert.equal(slots[2].label,'Pick Cyan Blossom');
  assert.equal(slots[2].icon,'🌸');
}
const button = {dataset:{action:'context_arch_action3'}};
const event = id => ({
  pointerId:id,target:{closest(selector){return selector==='button.abt'?button:null;}},
  preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}
}); // Same real touch/desktop pointer event structure used by Action 3.
const down = event(41),up=event(41);
listeners.get('pointerdown')(down);
assert.equal(picks,1,'tap presses the registered world-interaction claim exactly once');
assert.equal(router.snapshot().routedPresses.length,1,'physical ownership is retained through release');
assert.equal(down.stopped,true,'game.js cannot also execute a synthetic action id');
router.clearClaims('five-blossoms-tree'); // Picking the last flower withdraws the prompt immediately.
listeners.get('pointerup')(up);
assert.equal(router.snapshot().routedPresses.length,0,'release is paired even if the prompt disappears mid-tap');
assert.equal(up.stopped,true,'no duplicate game.js action on pointer release');
assert.equal(picks,1,'release does not pick twice');
assert.equal(window.ActionPromptUI.createActionArchLayout([first,second],'tool',false).slots[2],undefined,
  'removed claim restores ordinary third-arch availability');
router.setClaims('internal-menu',[{actionId:'action1',label:'Hidden internal claim',priority:20}]);
assert.equal(window.ActionPromptUI.createActionArchLayout([first],'tool',false).slots[0],first,
  'claims must opt into HUD visibility: ordinary input arbitration does not manufacture UI');
router.clearClaims('internal-menu');
router.setClaims('future-interaction',[{actionId:'action1',label:'Inspect',hudIcon:'🔎',showInArch:true,priority:70,onPress(){picks++;}}]);
const contextual = window.ActionPromptUI.createActionArchLayout([first,second],'tool',false).slots;
assert.equal(contextual[0].label,'Inspect','future contextual actions use the same opt-in native arch path');
router.clearClaims('future-interaction');
console.log('ok - Five Blossoms and future opt-in contextual actions populate the regular arch with paired touch input');
