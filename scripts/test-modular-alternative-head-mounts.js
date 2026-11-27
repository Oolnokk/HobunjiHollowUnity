// Alternative head lines are strictly opt-in per pair.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={}; // Runtime config and API with no browser dependency.
for(const path of ['docs/config/modular-weapons.js','docs/js/modular-weapons.js']) vm.runInNewContext(fs.readFileSync(path,'utf8'),{window,console});
const api=window.ModularWeapons, draft=JSON.parse(JSON.stringify(api.getConfig()));
const key=Object.keys(draft.heads).find(k=>draft.heads[k].mount.type==='blade'&&!draft.heads[k].flailAssembly);
const shaftKey=Object.keys(draft.shafts).find(k=>!draft.shafts[k].flailAssembly&&draft.shafts[k].mounts.some(m=>m.type==='eye'));
assert(key&&shaftKey);
const head=draft.heads[key],shaft=draft.shafts[shaftKey];
shaft.mounts=shaft.mounts.filter(m=>m.type==='eye'); // Deliberately construct an eye-only haft from a real catalog donor.
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
assert.equal(cfg.shafts[shaftKey].overrides[key].headMountId,'none');
assert.equal(api.isDisallowed(shaftKey,key),true);
// A mixed haft may combine its primary tang and an explicitly assigned secondary sleeve.
draft.heads[key].alternativeMounts.push({id:'sleeve-1',type:'weight',start:{x:100,y:200},end:{x:150,y:200}});
draft.shafts[shaftKey].mounts=[{type:'tang',start:{x:100,y:100},end:{x:100,y:150}},{type:'eye',start:{x:300,y:400},end:{x:350,y:400}}];
draft.shafts[shaftKey].overrides[key]={disallow:false,headMountId:'primary'};
cfg=api.replace(draft);
assert.equal(api.rigidMountAssignments(cfg.shafts[shaftKey],cfg.heads[key]).length,1);
draft.shafts[shaftKey].overrides[key].headMountBySocket={1:'sleeve-1'};
cfg=api.replace(draft);
let mixed=api.rigidMountAssignments(cfg.shafts[shaftKey],cfg.heads[key]);
assert.deepEqual(Array.from(mixed,m=>m.mount.type),['tang','eye']);
assert.equal(mixed[0].headMount.id,undefined);
assert.equal(mixed[1].headMount.id,'sleeve-1');
assert.equal(api.isDisallowed(shaftKey,key),false);
const mixedRig=api.attachmentRig(cfg.shafts[shaftKey],cfg.heads[key],api.settings(shaftKey,key));
assert.deepEqual(Array.from(mixedRig.children,m=>m.children[0].headMountId),['primary','sleeve-1']);
draft.shafts[shaftKey].overrides[key].disallow=true;
cfg=api.replace(draft);
assert.equal(api.isDisallowed(shaftKey,key),true,'Explicit exclusion always wins');
draft.shafts[shaftKey].overrides[key]={disallow:false,headMountId:'primary',headMountBySocket:{0:'none',1:'tang-1'}};
cfg=api.replace(draft);
assert.equal(api.isDisallowed(shaftKey,key),true,'No applicable selected line means automatically excluded even with disallow:false');
// Reproduce a sleeve-primary head on a tang haft with a distinct secondary line.
const sleeveKey=Object.keys(draft.heads).find(k=>draft.heads[k].mount.type==='weight'&&!draft.heads[k].flailAssembly&&!draft.heads[k].craftDisabled);
const sleeve=draft.heads[sleeveKey];
sleeve.alternativeMounts=[{id:'tang-1',type:'blade',start:{x:70,y:110},end:{x:130,y:110}}];
draft.shafts[shaftKey].mounts=[{type:'tang',start:{x:200,y:300},end:{x:200,y:390}}];
draft.shafts[shaftKey].overrides[sleeveKey]={disallow:false};
cfg=api.replace(draft);
assert.equal(api.isDisallowed(shaftKey,sleeveKey),true);
assert.equal(api.attachmentRig(cfg.shafts[shaftKey],cfg.heads[sleeveKey],api.settings(shaftKey,sleeveKey)).children.length,0,'Never fit primary sleeve to tang when alternatives exist');
draft.shafts[shaftKey].overrides[sleeveKey].headMountBySocket={0:'tang-1'};
cfg=api.replace(draft);
const fit=api.attachmentRig(cfg.shafts[shaftKey],cfg.heads[sleeveKey],api.settings(shaftKey,sleeveKey)).children[0];
assert.equal(fit.children[0].headMountId,'tang-1');
const matrix=fit.children[0].worldMatrix, source=fit.children[0].headMount;
for(const end of ['start','end']){
  const mapped=api.affinePoint(matrix,source[end]), target=fit.worldMount[end];
  assert(Math.hypot(mapped.x-target.x,mapped.y-target.y)<1e-6,'Secondary tang '+end+' must map to shaft tang');
}
const incorrect=api.affinePoint(matrix,sleeve.mount.start);
assert(Math.hypot(incorrect.x-fit.worldMount.start.x,incorrect.y-fit.worldMount.start.y)>1,'Primary sleeve must not determine the fit');
const runtime=fs.readFileSync('docs/js/modular-weapons.js','utf8');
assert(runtime.indexOf('const values = settings(shaftKey, headKey); // Snapshot')<runtime.indexOf('const task = Promise.all([loadImage(shaft.sprite'),'Compose snapshots pair before loading images');
const editor=fs.readFileSync('docs/tools/modular-weapon-editor/editor.js','utf8');
assert(editor.includes('(pair.headMountBySocket ||= {})[mountIndex]=line.id ||'));
console.log('Pair-specific alternative mount tests passed.');
