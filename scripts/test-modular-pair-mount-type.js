// Pair-local direct destination mounting; one authored head line in all modes.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={}; // Runtime-only fixture, no browser needed.
for(const path of ['docs/config/modular-weapons.js','docs/js/modular-weapons.js'])vm.runInNewContext(fs.readFileSync(path,'utf8'),{window,console});
const api=window.ModularWeapons,draft=JSON.parse(JSON.stringify(api.getConfig()));
const shaftKey='bshuakauitl',s=draft.shafts[shaftKey]; // Real donor with an authored rigid rig.
s.mounts=[{type:'tang',start:{x:100,y:100},end:{x:100,y:150}},{type:'eye',start:{x:300,y:400},end:{x:350,y:400}}];
for(const [key,normal,opposite] of [['dagger-sword','tang','eye'],['warhammer','eye','tang']]){
  const head=draft.heads[key]; // Exercise both directions with unchanged original source endpoints.
  head.alternativeMounts=[{id:'discard-me',type:'blade',start:{x:1,y:2},end:{x:3,y:4}}];
  for(const mode of ['auto','tang','eye','both']){
    s.overrides[key]={disallow:false,mountTypeMode:mode,headMountId:'discard-me',headMountBySocket:{0:'discard-me'}};
    const cfg=api.replace(draft),shaft=cfg.shafts[shaftKey],part=cfg.heads[key],values=api.settings(shaftKey,key);
    const expected=mode==='both'?['tang','eye']:[mode==='auto'?normal:mode];
    assert.deepEqual(Array.from(api.matchingMounts(shaft,part),m=>m.type),expected);
    assert.equal(api.isDisallowed(shaftKey,key),false);
    assert.equal(part.alternativeMounts,undefined,'Obsolete alternate lines are discarded');
    assert.equal(values.headMountId,undefined,'Obsolete pair selections are discarded');
    assert.equal(values.headMountBySocket,undefined);
    const rig=api.attachmentRig(shaft,part,values);
    assert.deepEqual(Array.from(rig.children,m=>m.type),expected);
    for(const node of rig.children)for(const endpoint of ['start','end']){
      const mapped=api.affinePoint(node.children[0].worldMatrix,part.mount[endpoint]),target=node.worldMount[endpoint];
      assert(Math.hypot(mapped.x-target.x,mapped.y-target.y)<1e-6,'The original head arrow fits the chosen socket');
    }
  }
}
s.mounts=s.mounts.filter(m=>m.type==='tang');
s.overrides.warhammer={disallow:false,mountTypeMode:'auto'};
let cfg=api.replace(draft);
assert.equal(api.isDisallowed(shaftKey,'warhammer'),true);
assert.equal(api.attachmentRig(cfg.shafts[shaftKey],cfg.heads.warhammer,api.settings(shaftKey,'warhammer')).children.length,0);
s.overrides.warhammer.mountTypeMode='tang';
cfg=api.replace(draft);
assert.equal(api.isDisallowed(shaftKey,'warhammer'),false);
assert.equal(api.settings('dagger','warhammer').mountTypeMode,undefined,'No leakage into other pairs');
s.overrides.warhammer.disallow=true;
api.replace(draft);
assert.equal(api.isDisallowed(shaftKey,'warhammer'),true,'Explicit exclusion wins');
// Old relative choices survive migration as literal destinations.
for(const [key,target] of [['dagger-sword','eye'],['warhammer','tang']]){
  s.overrides[key]={mountTypeMode:'opposite',disallow:false};
  api.replace(draft);
  assert.equal(api.settings(shaftKey,key).mountTypeMode,target);
}
s.overrides.warhammer.mountTypeMode='normal';api.replace(draft);
assert.equal(api.settings(shaftKey,'warhammer').mountTypeMode,'auto');
// Reported pair: two shipped arrows overlap; select the actual tang by index.
const pk='pick-shovel',hk='porakaneki-greatclub',pick=draft.shafts[pk];
pick.overrides[hk]={mountTypeMode:'both',disallow:false};
cfg=api.replace(draft);
let rig=api.attachmentRig(cfg.shafts[pk],cfg.heads[hk],api.settings(pk,hk));
assert.equal(rig.children.length,1);
assert.equal(api.matchingMounts(cfg.shafts[pk],cfg.heads[hk]).length,1);
pick.overrides[hk].mountTypeMode='tang';cfg=api.replace(draft);
rig=api.attachmentRig(cfg.shafts[pk],cfg.heads[hk],api.settings(pk,hk));
assert.equal(rig.children[0].index,1);
pick.mounts[1].start={x:295,y:656};pick.mounts[1].end={x:375,y:656};
cfg=api.replace(draft);
const distinct=api.attachmentRig(cfg.shafts[pk],cfg.heads[hk],api.settings(pk,hk));
assert.notDeepEqual(distinct.children[0].children[0].worldMatrix,rig.children[0].children[0].worldMatrix);
assert.equal(api.rigidMountAssignments(cfg.shafts[pk],cfg.heads[hk],{mountTypeMode:'both'}).length,2);
// Simulate a full browser store; live configuration, cache revision and retry must remain usable.
const previous=JSON.stringify(api.getConfig()); // Existing persisted draft must survive a failed write.
let stored=previous,blocked=true;
window.localStorage={setItem(key,value){assert.equal(key,'hobunji.modularWeapons.v5');if(blocked){const err=new Error('Quota exceeded');err.name='QuotaExceededError';throw err;}stored=value;}};
const quotaDraft=JSON.parse(previous);
quotaDraft.shafts[pk].overrides[hk].mountTypeMode='eye';
const beforeRev=api.diagnostics('').revision;
const live=api.replace(quotaDraft,true);
assert.equal(api.draftPersistence().ok,false);
assert.equal(stored,previous,'Failed write must not erase previous stored draft');
assert.equal(api.settings(pk,hk).mountTypeMode,'eye');
assert.equal(live.shafts[pk].overrides[hk].mountTypeMode,'eye','Return current live validated configuration after storage failure');
assert.equal(api.diagnostics('').revision,beforeRev+1);
assert.equal(api.attachmentRig(live.shafts[pk],live.heads[hk],api.settings(pk,hk)).children[0].index,0);
blocked=false;assert.equal(api.persistDraft().ok,true);
assert.equal(JSON.parse(stored).shafts[pk].overrides[hk].mountTypeMode,'eye','Retry persists the current live draft');
console.log('Pair mount type override and storage-failure tests passed.');
