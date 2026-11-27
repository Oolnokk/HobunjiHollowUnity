// Alternative head lines are strictly opt-in per pair.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={}; // Runtime config and API with no browser dependency.
for(const path of ['docs/config/modular-weapons.js','docs/js/modular-weapons.js']) vm.runInNewContext(fs.readFileSync(path,'utf8'),{window,console});
const api=window.ModularWeapons, draft=JSON.parse(JSON.stringify(api.getConfig()));
const key=Object.keys(draft.heads).find(k=>draft.heads[k].mount.type==='blade'&&!draft.heads[k].flailAssembly);
const shaftKey=Object.keys(draft.shafts).find(k=>!draft.shafts[k].flailAssembly&&draft.shafts[k].mounts.some(m=>m.type==='eye')&&!draft.shafts[k].mounts.some(m=>m.type==='tang'));
assert(key&&shaftKey);
const head=draft.heads[key],shaft=draft.shafts[shaftKey];
head.alternativeMounts=[{id:'sleeve-1',type:'weight',start:{x:100,y:200},end:{x:150,y:200}},
{id:'tang-1',type:'blade',start:{x:200,y:250},end:{x:200,y:300}}];
shaft.overrides[key]={disallow:false};
let cfg=api.replace(draft);
assert.equal(api.matchingMounts(cfg.shafts[shaftKey],cfg.heads[key]).length,0,'Alternatives never auto-match');
assert.equal(api.isDisallowed(shaftKey,key),true);
draft.shafts[shaftKey].overrides[key].headMountId='sleeve-1';
cfg=api.replace(draft);
assert.equal(api.effectiveHeadMount(cfg.shafts[shaftKey],cfg.heads[key]).id,'sleeve-1');
assert.equal(api.isDisallowed(shaftKey,key),false);
const rig=api.attachmentRig(cfg.shafts[shaftKey],cfg.heads[key],api.settings(shaftKey,key));
assert(rig.children.length&&rig.children.every(child=>child.type==='eye'));
const first=rig.children[0], point=api.affinePoint(first.children[0].worldMatrix,{x:100,y:200});
assert(Math.abs(point.x-first.worldMount.start.x)<1e-6&&Math.abs(point.y-first.worldMount.start.y)<1e-6,'Selected alternative geometry maps to the real shaft mount');
const otherKey=Object.keys(cfg.shafts).find(k=>k!==shaftKey&&!cfg.shafts[k].overrides[key]?.headMountId);
assert.equal(api.effectiveHeadMount(cfg.shafts[otherKey],cfg.heads[key]).type,'blade');
draft.heads[key].alternativeMounts.shift();
cfg=api.replace(draft);
assert.equal(cfg.shafts[shaftKey].overrides[key].headMountId,'primary');
assert.equal(api.isDisallowed(shaftKey,key),true);
console.log('Pair-specific alternative mount tests passed.');
