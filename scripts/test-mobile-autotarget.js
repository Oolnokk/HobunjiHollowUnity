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
assert.equal(preference(false).isAutoTargetEnabled(), true, 'fresh mobile starts enabled');
assert.equal(preference(false, 'false').isAutoTargetEnabled(), false, 'mobile saved off is respected');
assert.equal(preference(false, null, true).isAutoTargetEnabled(), true, 'blocked storage retains default on');
const desktop = preference(true, 'true'); // Desktop fixture must stay manual regardless of preference changes.
assert.equal(desktop.isAutoTargetEnabled(), false);
desktop.setAutoTargetEnabled(true);
assert.equal(desktop.isAutoTargetEnabled(), false, 'desktop cannot enable assist');

const targetContext = { isDesktop:false,enabled:true,window:{Combat:{input:{isAutoTargetEnabled:()=>targetContext.enabled},attackAlignmentStep:(p,c,dt,o)=>({eligible:Math.abs(Math.atan2(c.y-p.y,c.x-p.x)-o.facing)<=o.halfConeRad,deltaRad:Math.atan2(c.y-p.y,c.x-p.x)-o.facing})},RangedWeapons:{playerLockRangePx:()=>100}},heldMode:'tool',activeTool:'ranged',equipmentSlots:{weapon:'sword',ranged:'bow'},TILE:10,combatConfig:()=>({autoTargetRangeTiles:4}),player:{x:0,y:0},currentArea:'farm',hostileObjects:[],manualAutoTarget:null,meleeAttackTargetLock:null,mobileArchCombatAim:null,currentMeleeAimAngle:()=>0,angleDiff:(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b)),invalidateAutoTargetCache(){} }; // Executes the shared selector against changing actor state.
vm.createContext(targetContext);
function load(start,end) { vm.runInContext(game.slice(game.indexOf(start),game.indexOf(end,game.indexOf(start))),targetContext); }
load('      function mobileAutoTargetEnabled()', '      function autoTargetVisible(');
load('      function meleeWeaponOut()', '      function commitMeleeAttackFacing(');
load('      function meleeAttackTargetCandidate()', '      function acquireMeleeAttackTargetLock(');
load('      function computeAutoTarget()', '      function invalidateAutoTargetCache(');
targetContext.activeCameraAzimuthRad = () => Math.PI / 2;
load('      function targetStickWorldAngle(', '      function swapAutoTarget(');
assert(Math.abs(targetContext.targetStickWorldAngle(1,0) + Math.PI/2)<1e-8,'target stick follows rotated camera right');
load('      function swapAutoTarget(', '      function finishMeleeAttackAlignment(');
targetContext.autoTargetVisible = c => !c.blocked;
targetContext.findAutoTarget = targetContext.computeAutoTarget;
const near = {id:'near',health:10,x:15,y:0,areaId:'farm'}; // Initial nearest ranged enemy.
const east = {id:'east',health:10,x:30,y:3,areaId:'farm'}; // Slightly farther directional choice.
const south = {id:'south',health:10,x:0,y:25,areaId:'farm'}; // Stick's south candidate.
targetContext.hostileObjects=[near,east,south];
assert.equal(targetContext.computeAutoTarget(),near);
east.x=10;
assert.equal(targetContext.computeAutoTarget(),near,'closer entrant does not steal valid lock');
near._denHidden=true;
assert.equal(targetContext.computeAutoTarget(),east,'hidden lock reacquires');
east._grehlrBurrowProtected=true;
assert.equal(targetContext.computeAutoTarget(),south,'burrowed lock reacquires');
south.blocked=true;
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
assert.equal(targetContext.meleeAttackTargetCandidate(),null,'explicit attack-stick aim stays manual');
targetContext.mobileArchCombatAim=null;
targetContext.enabled=false;
assert.equal(targetContext.computeAutoTarget(),null,'toggle off clears target');
targetContext.enabled=true;targetContext.isDesktop=true;
assert.equal(targetContext.computeAutoTarget(),null,'desktop ranged stays manual');
assert.equal(targetContext.swapAutoTarget(0),false,'desktop cannot swap an assisted target');

const handlers = {}; // Captures handlers attached by the real target-stick installation.
const timers = new Map(); // Deterministic hold timer callbacks without sleeping.
let timerId = 0, selectedAngle = null, enabled = true, transitions = 0; // Shared observable gesture results.
const button = {classList:{contains:()=>false},style:{},addEventListener:(name,fn)=>handlers[name]=fn,getBoundingClientRect:()=>({left:10,top:10,width:44,height:44}),setPointerCapture(){},releasePointerCapture(){}}; // Only the existing button's required DOM methods.
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
console.log('mobile autotarget preference, acquisition, switching, and gesture checks passed');
