// Pair-local opposite-type mounting; one authored head line in all modes.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={}; // Runtime-only fixture, no browser needed.
for(const path of ['docs/config/modular-weapons.js','docs/js/modular-weapons.js'])vm.runInNewContext(fs.readFileSync(path,'utf8'),{window,console});
const api=window.ModularWeapons,draft=JSON.parse(JSON.stringify(api.getConfig()));
const shaftKey='bshuakauitl',s=draft.shafts[shaftKey]; // Real donor with an authored rigid rig.
s.mounts=[{type:'tang',start:{x:100,y:100},end:{x:100,y:150}},{type:'eye',start:{x:300,y:400},end:{x:350,y:400}}];
for(const [key,normal,opposite] of [['dagger-sword','tang','eye'],['warhammer','eye','tang']]){
  const head=draft.heads[key]; // Exercise both directions with unchanged original source endpoints.
  head.alternativeMounts=[{id:'discard-me',type:'blade',start:{x:1,y:2},end:{x:3,y:4}}];
  for(const mode of ['normal','opposite','both']){
    s.overrides[key]={disallow:false,mountTypeMode:mode,headMountId:'discard-me',headMountBySocket:{0:'discard-me'}};
    const cfg=api.replace(draft),shaft=cfg.shafts[shaftKey],part=cfg.heads[key],values=api.settings(shaftKey,key);
    const expected=mode==='both'?['tang','eye']:[mode==='normal'?normal:opposite];
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
s.overrides.warhammer={disallow:false,mountTypeMode:'normal'};
let cfg=api.replace(draft);
assert.equal(api.isDisallowed(shaftKey,'warhammer'),true);
assert.equal(api.attachmentRig(cfg.shafts[shaftKey],cfg.heads.warhammer,api.settings(shaftKey,'warhammer')).children.length,0);
s.overrides.warhammer.mountTypeMode='opposite';
cfg=api.replace(draft);
assert.equal(api.isDisallowed(shaftKey,'warhammer'),false);
assert.equal(api.settings('dagger','warhammer').mountTypeMode,undefined,'No leakage into other pairs');
s.overrides.warhammer.disallow=true;
api.replace(draft);
assert.equal(api.isDisallowed(shaftKey,'warhammer'),true,'Explicit exclusion wins');
console.log('Pair mount type override tests passed.');
