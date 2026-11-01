'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=file=>fs.readFileSync(file,'utf8');
const html=read('docs/tools/live-root-growth/index.html'),author=read('docs/tools/live-root-growth/tool.js'),
  hands=read('docs/js/root-snare-hands.js'),runner=read('docs/js/root-snare-runner.js'),
  toss=read('docs/js/root-snare-toss.js'), // Reusable clone-only throw shared by NPC preview and future player grabs.
  scene=read('docs/js/stone-age-ruin-scenery.js'),staticCover=read('docs/js/live-root-growth.js'),
  bootstrap=read('docs/js/dev-random-ruin-bootstrap.js');
for(const [name,source] of [['Root Growth Author',author],['Wall snare',hands],['Visual-only toss',toss],['Runner',runner],['Shared scenery',scene],['Static cover',staticCover]])
  assert.doesNotThrow(()=>new Function(source),'javascript syntax: '+name);
const required=['snareEnabled','snareCount','snareRadius','snareReach','snareExtend','snareRetract','snareRunnerSpeed','snareReveal','snareBuild','snareReroute','snareNpc','snareNpcStatus','snareRunPast','snareRelease','snareRunAway','snareRunToward','snareDoubleGrip','snareStatus'];
for(const id of required)assert(html.includes('id="'+id+'"'),'mobile preview is missing '+id);
for(const script of ['js/npc-avatar-preview-utils.js','js/png-plane-avatar.js','config/pants-rigs.js','js/pants-rig-core.js','js/pants-garment-renderer.js','js/leg-bones.js','js/procedural-leg-animation.js','js/root-snare-hands.js','js/root-snare-toss.js','js/root-snare-runner.js','tools/live-root-growth/tool.js'])
  assert(html.includes(script+'?v='),'versioned preview script missing: '+script);
assert(html.indexOf('npc-avatar-preview-utils.js')<html.indexOf('root-snare-runner.js'));
assert(html.indexOf('png-plane-avatar.js')<html.indexOf('root-snare-runner.js'));
assert(html.indexOf('pants-rig-core.js')<html.indexOf('pants-garment-renderer.js'));
assert(html.indexOf('leg-bones.js')<html.indexOf('procedural-leg-animation.js'));
assert(html.indexOf('root-snare-hands.js')<html.indexOf('root-snare-toss.js')&&html.indexOf('root-snare-toss.js')<html.indexOf('root-snare-runner.js'),
  'non-destructive clone throw module must load before the root-snare runner');
assert(html.indexOf('root-snare-runner.js')<html.indexOf('tools/live-root-growth/tool.js'));
assert(author.includes('getRootSnareDiagnostics')&&author.includes('moveRoamingNpcTo'),'mobile debug bridge must expose actual trap and NPC state');
assert(author.includes('snare:{enabled:')&&author.includes('fixedNodes:rootHands?.diagnostics().anchors'),'recipes must retain fixed hidden nodes');
assert(author.includes("json.snare.settings"),'import must restore authored trigger/retraction settings');
assert(author.includes('wallRootLayers,rootLayers')&&author.includes("role:'floor'")&&author.includes("role:'wall'"),'author must pass actual wall AND floor root meshes');
assert(hands.includes('sourceKey:p.sourceKey')&&hands.includes('hiddenRootNode:anchor.sourceKey'),'anchors must preserve a fixed original tube-node identity');
assert(hands.includes("entry.state=role+'-grip'")&&hands.includes("assignGrip(entry,neckGrip?'feet':'neck',target)")&&hands.includes('releaseCaptured'),'neck and feet grip roles must be assigned in that order');
assert(hands.includes('digitRoles')&&hands.includes("role:'thumb'")&&hands.includes("role:'finger'"),'branch hand must have two fingers and an opposing thumb');
assert(hands.includes('buildLogMesh')&&hands.includes('lastAim.lerp'),'arms must use natural foliage branches and steer while extending');
assert(hands.includes('previewDoubleGrip')&&hands.includes('double-grip'),'second grip must start two-hand stretch sequence');
assert(runner.includes('tugMultiplier')&&runner.includes('setNeckGrip')&&runner.includes('getGripPoint'),'runner must own directional tug and anatomical neck/feet grip points');
assert(toss.includes('snapshotGeometry')&&toss.includes('boneTransform')&&toss.includes('applyBoneTransform')&&toss.includes('cloneMaterial')&&toss.includes('geometry.deleteAttribute'),
  'temporary copies must bake skinned player/NPC geometry and only own disposable visual resources');
assert(runner.includes('RootSnareToss.create')&&runner.includes('upper.visible=false;lower.visible=false')&&runner.includes('visualToss?.dispose?.()'),
  'finished grab should throw copies, temporarily hide originals, and clean up on reset');
assert(hands.includes('releaseCaptured({preserveVictim:true})')&&author.includes('if(tossed)roamingNpc.resetAfterSnare()'),
  'root hands must retract without resetting airborne snapshots; mobile Release restores the original');
assert(runner.includes('startDualCapture')&&runner.includes('stretchTime:FINAL_PULL_S')&&runner.includes('pants')&&runner.includes('spawnSplurt'),'three-second finishing pull must preserve separate pants/feet and generate red particles');
const runnerContext={}; // Runs the real author timing helper without needing a browser, THREE or fixture NPC.
vm.runInNewContext(runner,runnerContext);
const pose=runnerContext.RootSnareRunner.pullPose,near=(a,b)=>Math.abs(a-b)<1e-6;
assert.equal(pose(0,2).pullNumber,1);
assert(near(pose(.195,2).stretch,.5),'first heartbeat yank must reach 25% body extension in 195ms');
assert(pose(.8,2).stretch<pose(.195,2).stretch,'first pull must recoil gradually');
assert(near(pose(1.5,2).stretch,0)&&pose(1.5,2).pullNumber===2,'second heartbeat must start from neutral after 1.5s');
assert(near(pose(1.695,2).stretch,.5),'second yank must repeat the same sharp extension');
assert(near(pose(3,2).stretch,0)&&pose(3,2).pullNumber===3,'three-second finishing pull must start at neutral');
assert(near(pose(4.5,2).stretch,.58),'finishing pull should reach midpoint at 4.5s');
assert(near(pose(6,2).stretch,1.16)&&pose(6,2).phase==='split-held','final pull must reach 58% body extension at six seconds');
assert(near(pose(10,2).stretch,1.16)&&near(pose(6,1).stretch,.58),'hold length and body-size scaling must be stable');
assert(near(pose(-10,2).stretch,0)&&near(pose(0,0).stretch,0),'invalid or zero span must not create a jarring stretch');

assert(!hands.includes('makeFeedingRoots')&&!hands.includes("state='devouring'"),'hands must not reintroduce the abandoned root-devouring sequence');
assert(html.includes('value="15"')&&html.includes('value="0.2"')&&html.includes('value="5"'),'requested large-reach and low-growth settings must load by default');
assert(author.includes("numeric('snareExtend',.05,12,.2)")&&author.includes("numeric('snareRadius',.5,15,15)"),'author settings must normalize to the new defaults');
assert(runner.includes('ProceduralLegAnimation?.attach')&&runner.includes('legs?.update?.'),'the walker must borrow the authentic procedural gait, not fake steps');
assert(runner.includes('loadNpcPortrait')&&runner.includes('NpcAvatarPreview.buildProfileFromNpcExport')&&runner.includes('PNGPlaneAvatar.buildSinglePlaneAvatarModel'),'use actual Animation Author NPC portrait/plane builder and repository NPC records');
assert(runner.includes('portraitView:\'behind\'')&&runner.includes('neckRig:true')&&runner.includes('standingPosteriorY'),'NPC must render the rear view, use skinned neck, and locate pelvis from species-specific leg solver');
assert(runner.includes('PantsGarmentRenderer')&&runner.includes('attachToLegs')&&runner.includes('garmentForCosmetics'),
  'actual NPC trousers/skirt must be selected from repository equipment and skinned to the native procedural leg bones');
assert(runner.includes('bodyPivot.quaternion.setFromUnitVectors(up,baseAxis)')&&runner.includes('dual.tiltDeg'),'whole avatar must tilt using neck and feet grip positions');
assert(author.includes('requireNpc:true')&&author.includes('runner.installAvatar(rendered)')&&author.includes('snareNpcRevision'),'the public editor must await real NPC assets and reject stale results rather than silently show the fixture');
assert(hands.includes("target?.getGripTarget"),'both hands must target the same neck/feet points that drive body tilt');
assert(scene.includes('buildFloorCoverSectors(room.floorPattern)')&&scene.includes('perSurface:true'),'multiroom floor coverage must reuse author-like sixteen independent strand budgets');
assert(scene.includes("surfaceFoliageRole:'growthPlanOnly'")&&scene.includes('guide.userData?.surfaceFoliageGuide'),'floor planning authority must not contribute visible root geometry');
assert(staticCover.includes('mesh.userData.surfaceFoliageGuideOwner=target.uuid'),'the cloned floor guide names must remain recognized');
assert(bootstrap.includes('stone-age-ruin-scenery.js?v='),'gameplay uses the same shared floor recipe');
console.log('Root snare author: preview scripts, mobile controls, fixed node exports, source gait, floor-coverage parity and cloned guide ownership checks passed.');
