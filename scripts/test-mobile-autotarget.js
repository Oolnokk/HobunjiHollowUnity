'use strict';
const assert = require('node:assert/strict'); // Verifies executed production targeting and gesture behavior.
const fs = require('node:fs'); // Reads the current production owners.
const vm = require('node:vm'); // Runs browser-owned helpers with deterministic input fixtures.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Source of shared acquisition and target-stick handlers.
const input = fs.readFileSync('docs/js/combat/combat-input.js', 'utf8'); // Source of the mobile preference gate.
function preference(fine, saved = null, brokenStorage = false) {
  const context = { window: { matchMedia: () => ({matches:fine}), Combat:{loadout:{},update(){}},addEventListener(){},dispatchEvent(){} }, document:{readyState:'loading',addEventListener(){}}, localStorage:{getItem(){if(brokenStorage)throw Error('blocked');return saved;},setItem(){}},performance:{now:()=>0},CustomEvent:function(){},console }; // Minimal browser surface for the real combat-input module.
  vm.runInNewContext(input, context);
  return context.window.Combat.input;
}
assert.equal(preference(false).isAutoTargetEnabled(), false, 'fresh mobile starts off');
assert.equal(preference(false, 'false').isAutoTargetEnabled(), false, 'mobile saved off is respected');
assert.equal(preference(false, null, true).isAutoTargetEnabled(), false, 'blocked storage starts off');
assert.equal(preference(false, 'true').isAutoTargetEnabled(), false, 'saved on cannot enable targeting automatically');
const desktop = preference(true, 'true'); // Desktop fixture must stay manual regardless of preference changes.
assert.equal(desktop.isAutoTargetEnabled(), false);
desktop.setAutoTargetEnabled(true);
assert.equal(desktop.isAutoTargetEnabled(), false, 'desktop cannot enable assist');

const targetContext = { isDesktop:false,enabled:true,window:{Combat:{input:{isAutoTargetEnabled:()=>targetContext.enabled},attackAlignmentStep:(p,c,dt,o)=>({eligible:Math.abs(Math.atan2(c.y-p.y,c.x-p.x)-o.facing)<=o.halfConeRad,deltaRad:Math.atan2(c.y-p.y,c.x-p.x)-o.facing})},RangedWeapons:{playerLockRangePx:()=>100}},heldMode:'tool',activeTool:'ranged',equipmentSlots:{weapon:'sword',ranged:'bow'},TILE:10,combatConfig:()=>({autoTargetRangeTiles:4}),player:{x:0,y:0},currentArea:'farm',hostileObjects:[],manualAutoTarget:null,meleeAttackTargetLock:null,mobileArchCombatAim:null,currentMeleeAimAngle:()=>0,angleDiff:(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b)),invalidateAutoTargetCache(){} }; // Executes the shared selector against changing actor state.
vm.createContext(targetContext);
function load(start,end) { vm.runInContext(game.slice(game.indexOf(start),game.indexOf(end,game.indexOf(start))),targetContext); }
load('      function mobileAutoTargetEnabled()', '      const mobileAutoTargetView');
load('      function autoTargetCandidateValid(', '      function autoTargetVisible(');
load('      function meleeWeaponOut()', '      function commitMeleeAttackFacing(');
load('      function meleeAttackTargetCandidate(', '      function computeAutoTarget(');
load('      function computeAutoTarget(', '      function invalidateAutoTargetCache(');
targetContext.activeCameraAzimuthRad = () => Math.PI / 2;
load('      function targetStickWorldAngle(', '      function swapAutoTarget(');
assert(Math.abs(targetContext.targetStickWorldAngle(1,0) + Math.PI/2)<1e-8,'target stick follows rotated camera right');
load('      function swapAutoTarget(', '      function requestMeleeAttackAlignment(');
targetContext.autoTargetVisible = c => !c.blocked;
targetContext.findAutoTarget = targetContext.computeAutoTarget;
const near = {id:'near',health:10,x:15,y:0,areaId:'farm'}; // Initial nearest ranged enemy.
const east = {id:'east',health:10,x:30,y:3,areaId:'farm'}; // Slightly farther directional choice.
const south = {id:'south',health:10,x:0,y:25,areaId:'farm'}; // Stick's south candidate.
targetContext.hostileObjects=[near,east,south];
assert.equal(targetContext.computeAutoTarget(),near);
east.x=10;
assert.equal(targetContext.computeAutoTarget(),near,'closer entrant does not steal valid lock');
near.x=200;
assert.equal(targetContext.computeAutoTarget(),near,'retreat beyond acquisition range keeps the lock despite closer entrants');
near.blocked=true;
assert.equal(targetContext.computeAutoTarget(),near,'temporary obstruction keeps identity');
near.blocked=false;near.x=15;
near._denHidden=true;
assert.equal(targetContext.computeAutoTarget(),east,'hidden lock reacquires');
east._grehlrBurrowProtected=true;
assert.equal(targetContext.computeAutoTarget(),south,'burrowed lock reacquires');
south.blocked=true;
assert.equal(targetContext.computeAutoTarget(),south,'blocked selected target remains locked');
targetContext.manualAutoTarget=null;
assert.equal(targetContext.computeAutoTarget(),null,'occluded candidates are rejected');
near._denHidden=false;east._grehlrBurrowProtected=false;south.blocked=false;east.x=30;
assert.equal(targetContext.swapAutoTarget(Math.PI/2),true);
assert.equal(targetContext.manualAutoTarget,south,'stick selects indicated enemy');
for(let i=0;i<5;i++)targetContext.swapAutoTarget(Math.PI/2);
assert.equal(targetContext.manualAutoTarget,south,'held direction cannot oscillate between targets');
targetContext.activeTool='weapon';
assert.equal(targetContext.computeAutoTarget(),south,'melee inherits manual selection');
south.health=0;
assert.equal(targetContext.computeAutoTarget(),near,'melee reacquires after selected enemy dies');
targetContext.mobileArchCombatAim={angle:Math.PI};
assert.equal(targetContext.meleeAttackTargetCandidate(),near,'manual attack aiming preserves target identity without using it as attack authority');
targetContext.mobileArchCombatAim=null;
targetContext.enabled=false;
assert.equal(targetContext.computeAutoTarget(),null,'toggle off clears target');
targetContext.enabled=true;targetContext.isDesktop=true;
assert.equal(targetContext.computeAutoTarget(),null,'desktop ranged stays manual');
assert.equal(targetContext.swapAutoTarget(0),false,'desktop cannot swap an assisted target');

const handlers = {}; // Captures handlers attached by the real target-stick installation.
const timers = new Map(); // Deterministic hold timer callbacks without sleeping.
let timerId = 0, selectedAngle = null, enabled = true, transitions = 0, buttonHidden = false; // Shared observable gesture results.
const button = {classList:{contains:name=>name==='abt-hidden'&&buttonHidden},style:{},addEventListener:(name,fn)=>handlers[name]=fn,getBoundingClientRect:()=>({left:10,top:10,width:44,height:44}),setPointerCapture(){},releasePointerCapture(){}}; // Only the existing button's required DOM methods.
const gesture = {btnSwapTarget:button,isDesktop:false,window:{Combat:{input:{setAutoTargetEnabled(value){enabled=value;transitions++;}}},addEventListener(){}},document:{hidden:false,body:{appendChild(){}},createElement:()=>({style:{},remove(){}}),addEventListener(){}},mobileAutoTargetEnabled:()=>enabled,targetStickWorldAngle:(x,y)=>Math.atan2(y,x),swapAutoTarget:angle=>{selectedAngle=angle;},syncMobileAutoTargetButton(){},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)}; // Runs production pointerdown/move/up/cancel lifecycle.
const gestureStart = game.indexOf('      if (btnSwapTarget && !isDesktop)'); // Isolates the real handler block rather than recreating its state machine.
vm.runInNewContext(game.slice(gestureStart,game.indexOf('      const desktopTapWindowMs',gestureStart)),gesture);
const event = id => ({pointerId:id,clientX:32,clientY:32,preventDefault(){},stopPropagation(){}}); // Button-centered pointer fixture.
handlers.pointerdown(event(1));handlers.pointerup(event(1));
assert.equal(enabled,false,'tap turns assist off');
handlers.pointerdown(event(2));[...timers.values()].forEach(fn=>fn());handlers.pointerup(event(2));
assert.equal(enabled,true,'stationary hold enables without toggling on release');
handlers.pointerdown(event(3));handlers.pointermove({...event(3),clientX:32,clientY:80});
assert.equal(selectedAngle,Math.PI/2,'hold stick forwards live direction');
handlers.pointerup(event(3));assert.equal(enabled,true,'drag release remains enabled');
const beforeCancel=transitions; // A canceled short tap must never change preference.
handlers.pointerdown(event(4));handlers.pointercancel(event(4));
assert.equal(transitions,beforeCancel,'pointercancel never toggles');
handlers.pointerdown(event(5));handlers.pointerdown(event(6));handlers.pointerup(event(6));
assert.equal(transitions,beforeCancel,'second finger cannot steal ownership');
handlers.lostpointercapture(event(5));
assert.equal(timers.size,0,'capture loss clears hold timer');
handlers.pointerdown(event(7));
buttonHidden=true;
handlers.pointerup(event(7));
assert.equal(transitions,beforeCancel,'combat ending during a tap does not toggle the saved preference');
buttonHidden=false;
handlers.pointerdown(event(8));
buttonHidden=true;
[...timers.values()].forEach(fn=>fn());
assert.equal(transitions,beforeCancel,'combat ending before the hold timer does not enable targeting');
assert.equal(timers.size,0,'hidden hold gesture releases its timer');
buttonHidden=false;

console.log('mobile autotarget preference, acquisition, switching, and gesture checks passed');

function injectedCss(file, nextFunction, extra = {}) {
  const source = fs.readFileSync(file, 'utf8'); // Executes each production style installer, including runtime-only overrides.
  const styles = []; // Captures the styles actually emitted for the gameplay HUD.
  const context = {document:{getElementById(){return null;},createElement(){return {};},head:{appendChild(style){styles.push(style.textContent);}}},...extra}; // Lightweight DOM surface for real injectStyles calls.
  const start = source.indexOf('  function injectStyles()'); // Isolates the real owner's installer without booting unrelated gameplay systems.
  vm.runInNewContext(source.slice(start,source.indexOf(nextFunction,start))+'\ninjectStyles();',context);
  return styles.join('\n');
}
const iconCss = injectedCss('docs/js/action-arch-icons.js','  function report('); // Canonical size owner must supersede all generic arch button sizes.
const layoutDefaults = {btnWeaponSwitch:170,toolBtn:160,itemBtn:150,btnCallMount:140,btnUtilityMenu:130,btnSocialActions:120}; // Live ring defaults, including the previously missed Social Actions control.
function outerCss(angles) {
  return injectedCss('docs/js/social-action-wheel.js','  function buildUi()', {cfg:{wheelRadiusPx:190,mobileOuterAnglesDeg:angles},DEFAULTS:{mobileOuterAnglesDeg:layoutDefaults}});
}
function declaration(css, selector, property) {
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].split(',').some(part=>part.trim()===selector)) continue;
    const entry=match[2].split(';').find(part=>part.trim().startsWith(property+':')); // Parses emitted CSS rather than pinning authored source spelling.
    if(entry)return entry.slice(entry.indexOf(':')+1).trim();
  }
  throw Error('Missing live HUD declaration '+selector+' '+property);
}
function evaluateLength(value, col, outerSize) {
  const expression=value.replace(/!important/g,'').replace(/var\(--outer-control-size\)/g,String(outerSize)).replace(/var\(--col\)/g,String(col)).replace(/px/g,'').replace(/calc\(/g,'('); // Evaluates the generated arithmetic for real phone layout columns.
  return Function('clamp','return '+expression)((min,value,max)=>Math.max(min,Math.min(max,value)));
}
const normalSizeCss=declaration(iconCss,'#toolSelect','--outer-control-size'); // Uses the live 33–46px baseline rather than the obsolete base stylesheet.
const targetWidthCss=declaration(iconCss,'#toolSelect #btnSwapTarget','width'); // Higher-specificity important override must beat #toolSelect button.
const targetHeightCss=declaration(iconCss,'#toolSelect #btnSwapTarget','height'); // Both hit-area dimensions must carry the same scale.
assert(targetWidthCss.includes('!important')&&targetHeightCss.includes('!important'),'target size overrides the runtime important generic rule');
for(const col of [10,12.1875,21.0625,48,80]) {
  const normalSize=evaluateLength(normalSizeCss,col,0); // Real responsive diameter at this layout column size.
  assert(Math.abs(evaluateLength(targetWidthCss,col,normalSize)/normalSize-1.2)<1e-9,'live target width is 20% larger');
  assert(Math.abs(evaluateLength(targetHeightCss,col,normalSize)/normalSize-1.2)<1e-9,'live target height is 20% larger');
}
for(const angles of [layoutDefaults,{btnUtilityMenu:145,btnSocialActions:130}]) {
  const css=outerCss(angles); // Partial authored overrides must retain defaults and derive the target endpoint.
  const resolved={...layoutDefaults,...angles}; // Provides the fixture's effective neighbor positions.
  const right=declaration(css,'#btnSwapTarget','right'); // Captures the actual important placement override that beats style.css.
  const angle=Number(right.match(/cos\(([-\d.]+)deg\)/)?.[1]); // Reads emitted geometry, not the production implementation text.
  assert(right.includes('!important'),'target position joins the runtime ring layout authority');
  assert.equal(resolved.btnSocialActions-angle,Math.abs(resolved.btnUtilityMenu-resolved.btnSocialActions)*1.2,'target follows Social Actions with 20% extra spacing');
}
const labelsCss=injectedCss('docs/js/arch-button-labels.js','  function currentBindings()'); // Runtime label overlay must grow together with the button.
assert(declaration(labelsCss,'#btnSwapTarget .arch-meaning-label','font-size'),'visible target text has its own larger size');
console.log('executed runtime target size, label, and social-ring layout regression checks passed');

const visibilityClasses = new Set(); // Tracks the production control's active and hidden state without a browser renderer.
let visibilityWrites = 0, eligibleTarget = false, visibilityEnabled = true; // Verifies combat transitions and deduplicated DOM updates.
const visibilityAttrs = {}; // Cached accessibility state written by the production sync function.
const visibilityContext = {btnSwapTarget:{classList:{contains:name=>visibilityClasses.has(name),toggle(name,value){visibilityWrites++;if(value)visibilityClasses.add(name);else visibilityClasses.delete(name);}},getAttribute:name=>visibilityAttrs[name],setAttribute(name,value){visibilityWrites++;visibilityAttrs[name]=value;}},isDesktop:false,mobileAutoTargetEnabled:()=>visibilityEnabled,findAvailableAutoTarget:()=>eligibleTarget?{id:"prey"}:null}; // Isolated live button presentation owner.
const visibilityStart = game.indexOf('      function syncMobileAutoTargetButton()'); // Runs the actual owner rather than mirroring its logic.
vm.runInNewContext(game.slice(visibilityStart,game.indexOf("      window.addEventListener('hobunji-auto-target-change'",visibilityStart)),visibilityContext);
visibilityContext.syncMobileAutoTargetButton();
assert(visibilityClasses.has('abt-hidden'),'mobile target control is hidden without an eligible target');
eligibleTarget=true;
visibilityContext.syncMobileAutoTargetButton();
assert(!visibilityClasses.has('abt-hidden'),'nearby prey exposes the mobile target control before combat');
visibilityEnabled=false;
visibilityContext.syncMobileAutoTargetButton();
assert(!visibilityClasses.has('abt-hidden'),'disabled assist still exposes its toggle while prey is available');
const settledWrites=visibilityWrites; // Repeated movement ticks must not queue redundant DOM mutations.
visibilityContext.syncMobileAutoTargetButton();
assert.equal(visibilityWrites,settledWrites,'unchanged visibility does not rewrite the DOM');
eligibleTarget=false;
visibilityContext.syncMobileAutoTargetButton();
assert(visibilityClasses.has('abt-hidden'),'losing every eligible target hides the control');
eligibleTarget=true;visibilityContext.isDesktop=true;
visibilityContext.syncMobileAutoTargetButton();
assert(visibilityClasses.has('abt-hidden'),'desktop never exposes the mobile button');
assert.equal(declaration(labelsCss,'#btnSwapTarget .arch-meaning-label','color'),'#b8b8b8','disabled target label is gray');
assert.equal(declaration(labelsCss,'#btnSwapTarget.active .arch-meaning-label','color'),'#ff6873','enabled target label is red');
console.log('executed eligible-target visibility, on/off colors, and interrupted gesture checks passed');

targetContext.isDesktop=false;targetContext.enabled=false;targetContext.activeTool='ranged';
targetContext.manualAutoTarget=null;targetContext.hostileObjects=[near];near.state='idle';near.health=10;near.blocked=false;
targetContext.gameFrameSerial=100;targetContext.availableAutoTargetCacheFrame=-1;targetContext.availableAutoTargetCacheValue=null;
load('      function findAvailableAutoTarget()', '      function currentPlayerAimAngle()');
assert.equal(targetContext.findAvailableAutoTarget(),near,'disabled ranged assist previews idle prey without requiring aggression');
assert.equal(targetContext.manualAutoTarget,null,'availability preview does not select a target while disabled');
assert.equal(targetContext.enabled,false,'availability preview does not enable aiming');
targetContext.activeTool='weapon';targetContext.gameFrameSerial++;
assert.equal(targetContext.findAvailableAutoTarget(),near,'disabled melee assist previews prey using the same attack cone');
near.blocked=true;targetContext.gameFrameSerial++;
assert.equal(targetContext.findAvailableAutoTarget(),null,'blocked prey does not expose the toggle');
near.blocked=false;near.x=50;targetContext.gameFrameSerial++;
assert.equal(targetContext.findAvailableAutoTarget(),null,'out-of-range prey does not expose the melee toggle');
near.x=15;targetContext.equipmentSlots.weapon=null;targetContext.gameFrameSerial++;
assert.equal(targetContext.findAvailableAutoTarget(),null,'an unequipped weapon has no potential autotarget');
console.log('executed disabled-mode prey acquisition preview checks passed');

const lifecycleListeners = {};
const lifecycle = {isDesktop:false,inCombat:false,weaponOut:false,enabled:false,transitions:0,window:{dispatchEvent(event){lifecycleListeners[event.type]?.();},Combat:{input:{setAutoTargetEnabled(value){lifecycle.enabled=value;lifecycle.transitions++;}}}},CustomEvent:function(type){this.type=type;},isPlayerInCombat:()=>lifecycle.inCombat,shoulderSurfCombatStanceActive:()=>lifecycle.weaponOut};
const lifecycleStart = game.indexOf('      let mobileAutoTargetWasInCombat');
vm.createContext(lifecycle);
vm.runInContext(game.slice(lifecycleStart,game.indexOf('      function syncMobileAutoTargetButton()',lifecycleStart)),lifecycle);
function combatTick() { vm.runInContext('syncMobileAutoTargetCombatState()',lifecycle); }
combatTick();lifecycle.inCombat=true;lifecycle.weaponOut=true;combatTick();
assert.equal(lifecycle.enabled,false,'combat entry never enables assist');
lifecycle.enabled=true;combatTick();assert.equal(lifecycle.enabled,true,'explicit activation survives active combat');
lifecycle.inCombat=false;combatTick();assert.equal(lifecycle.enabled,false,'encounter ending switches off');
lifecycle.inCombat=true;combatTick();assert.equal(lifecycle.enabled,false,'next encounter stays off');
lifecycle.enabled=true;lifecycle.weaponOut=false;combatTick();assert.equal(lifecycle.enabled,false,'stowing weapon switches off even while enemies chase');
lifecycle.inCombat=false;combatTick();lifecycle.enabled=true;combatTick();assert.equal(lifecycle.enabled,true,'explicit prey targeting works outside combat');
const gestureListeners={};
gesture.window.addEventListener=(name,fn)=>{gestureListeners[name]=fn;};
vm.runInNewContext(game.slice(gestureStart,game.indexOf('      const desktopTapWindowMs',gestureStart)),gesture);
handlers.pointerdown(event(20));gestureListeners['hobunji-auto-target-combat-end']();
const beforeExitRelease=transitions;handlers.pointerup(event(20));
assert.equal(transitions,beforeExitRelease,'combat exit cancels a pending toggle');
assert.equal(timers.size,0,'combat exit clears hold timer');
console.log('manual activation and combat-exit lifecycle checks passed');
