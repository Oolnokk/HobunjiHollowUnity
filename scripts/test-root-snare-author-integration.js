'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=file=>fs.readFileSync(file,'utf8');
const html=read('docs/tools/live-root-growth/index.html'),author=read('docs/tools/live-root-growth/tool.js'),
  hands=read('docs/js/root-snare-hands.js'),runner=read('docs/js/root-snare-runner.js'),
  scene=read('docs/js/stone-age-ruin-scenery.js'),staticCover=read('docs/js/live-root-growth.js'),
  bootstrap=read('docs/js/dev-random-ruin-bootstrap.js');
for(const [name,source] of [['Root Growth Author',author],['Wall snare',hands],['Runner',runner],['Shared scenery',scene],['Static cover',staticCover]])
  assert.doesNotThrow(()=>new Function(source),'javascript syntax: '+name);
const required=['snareEnabled','snareCount','snareRadius','snareReach','snareExtend','snareRetract','snareRunnerSpeed','snareReveal','snareBuild','snareReroute','snareStatus'];
for(const id of required)assert(html.includes('id="'+id+'"'),'mobile preview is missing '+id);
for(const script of ['js/leg-bones.js','js/procedural-leg-animation.js','js/root-snare-hands.js','js/root-snare-runner.js','tools/live-root-growth/tool.js'])
  assert(html.includes(script+'?v='),'versioned preview script missing: '+script);
assert(html.indexOf('leg-bones.js')<html.indexOf('procedural-leg-animation.js'));
assert(html.indexOf('root-snare-hands.js')<html.indexOf('root-snare-runner.js'));
assert(html.indexOf('root-snare-runner.js')<html.indexOf('tools/live-root-growth/tool.js'));
assert(author.includes('getRootSnareDiagnostics')&&author.includes('moveRoamingNpcTo'),'mobile debug bridge must expose actual trap and NPC state');
assert(author.includes('snare:{enabled:')&&author.includes('fixedNodes:rootHands?.diagnostics().anchors'),'recipes must retain fixed hidden nodes');
assert(author.includes("json.snare.settings"),'import must restore authored trigger/retraction settings');
assert(author.includes('wallRootLayers:rootLayers'),'hands must attach to actual wall-root meshes');
assert(hands.includes("sourceKey:node.key")&&hands.includes('hiddenRootNode:anchor.sourceKey'),'anchors must preserve a fixed original tube-node identity');
assert(hands.includes("entry.state='retracting'")&&hands.includes("entry.state='dormant'"),'hands must return to a concealed root pose');
assert(runner.includes('ProceduralLegAnimation?.attach')&&runner.includes('legs?.update?.'),'the walker must borrow the authentic procedural gait, not fake steps');
assert(scene.includes('buildFloorCoverSectors(room.floorPattern)')&&scene.includes('perSurface:true'),'multiroom floor coverage must reuse author-like sixteen independent strand budgets');
assert(scene.includes("surfaceFoliageRole:'growthPlanOnly'")&&scene.includes('guide.userData?.surfaceFoliageGuide'),'floor planning authority must not contribute visible root geometry');
assert(staticCover.includes('mesh.userData.surfaceFoliageGuideOwner=target.uuid'),'the cloned floor guide names must remain recognized');
assert(bootstrap.includes('stone-age-ruin-scenery.js?v='),'gameplay uses the same shared floor recipe');
console.log('Root snare author: preview scripts, mobile controls, fixed node exports, source gait, floor-coverage parity and cloned guide ownership checks passed.');
