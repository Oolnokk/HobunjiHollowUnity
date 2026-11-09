#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let ms=1000,standing=false,rigReady=false,active=false,starts=0,prepared=0,solo=true;
let failure={code:'hands-not-ready',actor:'partner'};
const claims=new Map(),messages=[];
const rec={id:'partner',name:'Partner',homeId:'smithy',relationship:{canDate:true}};
const walker={rec,area:'town',root:{parent:{},position:{x:5,y:0,z:0}},currentScheduleTarget:{pose:'sit'}};
const window={CalendarSystem:{isInitialized:()=>true,monthNumber:()=>5,dayOfMonth:()=>8,aotYearNumber:()=>1155,getHour:()=>17,currentWeekdayName:()=> 'Anan'},
  DialogueContent:{getNpcDlgState:()=>({favor:120})},SocialActionWheel:{isDancing:()=>solo,stopDance:()=>{solo=false;}},
  WorldActionInputClaims:{setClaims:(id,value)=>claims.set(id,value),clearClaims:id=>claims.delete(id)},
  NpcScheduling:{registerTargetOverride(id,provider){if(id==='festivals')this.provider=provider;}},
  NpcFollowing:{target:()=>({area:'town',c:1,r:0,pose:'stand'})},
  AmbientDialogue:{showSocialResponse:(_walker,response)=>messages.push(response.text)},
  FestivalWheelDanceRuntime:{start(){starts++;if(!rigReady)return false;active=true;return true;},activeFor:()=>active,elapsedSeconds:()=>0,stop(){active=false;},diagnostics:()=>({active,lastStartFailure:failure})}};
const context=vm.createContext({window,console,document:{hidden:false},performance:{now:()=>ms}});
for(const name of ['festival-calendar','festival-system'])vm.runInContext(fs.readFileSync(`docs/js/${name}.js`,'utf8'),context);
const api=window.FestivalSystem;
api.init({getTownMap:()=>null,getNpcs:()=>[rec],getWalkers:()=>[walker],getArea:()=> 'town',getPlayerTile:()=>({c:0,r:0}),getPlayerMesh:()=>({}),
  getItemDefs:()=>({}),inventory:{},save(){},refresh(){},toast:text=>messages.push(text),isBlocked:()=>false,
  prepareDance:()=>{prepared++;},canStartDance:()=>standing});
const tick=()=>{ms+=500;api.update();};
assert(api.askFestivalDance(walker).ok,'invitation can be accepted at social reach');
assert.equal(solo,false,'solo dance is stopped before a paired invitation');assert.equal(prepared,1);
assert(api.pendingDance);assert.equal(starts,0,'seated rigs are not captured synchronously');
assert.equal(window.NpcScheduling.provider(rec).pose,'stand','invitation uses existing follow/approach targets');
tick();assert.equal(starts,0,'wait for player to finish standing');standing=true;tick();assert.equal(starts,0,'wait for partner to stand');
walker.currentScheduleTarget=window.NpcScheduling.provider(rec);tick();assert.equal(starts,0,'distant partner approaches before capture');
walker.root.position.x=1.5;tick();assert.equal(starts,1);assert(api.pendingDance,'temporary rig readiness is retried');
assert.equal(api.serialize().festivalFun.partner,undefined,'preparation earns no dance reward');
rigReady=true;tick();assert.equal(active,true);assert.equal(api.pendingDance,null);assert.equal(api.dance.targetNpcId,rec.id);
assert(!claims.has('dance-invitation'),'preparation cancel claims release on success');
api.cancelDance();standing=false;
assert(api.askFestivalDance(walker).ok);const cancel=claims.get('dance-invitation').find(claim=>claim.actionId==='action2');
cancel.onPress();const cancelledStarts=starts;standing=true;tick();assert.equal(api.pendingDance,null);assert.equal(starts,cancelledStarts,'cancel cannot start a late dance');
rigReady=false;failure={code:'camera-busy'};assert(api.askFestivalDance(walker).ok);
for(let n=0;n<45;n++)tick();
assert.equal(api.pendingDance,null,'readiness retries are bounded');
assert(messages.some(message=>message.includes('camera scene')),'timeout reports the actual camera gate');
assert(!messages.some(message=>/more room/.test(message)),'unrelated failures are never described as lack of room');
console.log('Dance invitations: solo/seated handoff, social-range approach, readiness retry, no early rewards, cancellation, timeout and real failure messages passed.');

rigReady=true;failure=null;assert(api.askFestivalDance(walker).ok);tick();assert.equal(active,true);
window.CalendarSystem.getHour=()=>1;tick();assert.equal(active,false,'paired dance ends at closing');assert.equal(api.dance,null);
let mealClears=0;window.NpcSharedMeals={clear:()=>mealClears++};api.restore({});assert.equal(mealClears,1,'restore releases transient meal state');
