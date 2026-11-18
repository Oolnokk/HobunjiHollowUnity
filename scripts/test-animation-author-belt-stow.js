#!/usr/bin/env node
'use strict';
// Run: node scripts/test-animation-author-belt-stow.js
// The real authored HTML bridge is executed against mock rig callbacks, not merely string-searched.
const assert = require('node:assert/strict');
const fs = require('node:fs'); // Read the exact shipped author and gameplay modules.
const vm = require('node:vm');
const html = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8');
const shared = fs.readFileSync('docs/js/belt-stow-rig.js', 'utf8');
const ui = fs.readFileSync('docs/js/animation-author-belt-stow.js', 'utf8');
const runtime = fs.readFileSync('docs/js/adventuring-torch-belt.js', 'utf8');
const entry = fs.readFileSync('docs/index.html', 'utf8');
const manifest = fs.readFileSync('docs/js/bootstrap/classic-groups/render.js', 'utf8');
assert.match(html, /js\/belt-stow-rig\.js\?v=/, 'author loads the exact shared math/art module');
assert.match(html, /js\/animation-author-belt-stow\.js\?v=/, 'editor loads the independent UI module');
assert.match(entry, /js\/belt-stow-rig\.js\?v=/, 'gameplay loads the shared module ahead of its belt renderer');
assert.match(manifest, /js\/adventuring-torch-belt\.js\?v=/);
assert.match(runtime, /configuredSnapshot/, 'the game consumes the authored beltStow profile');
assert.match(ui, /maaBeltStowSection/, 'separate Rig Coordinates section exists');
assert.match(ui, /maaBeltStowScale/, 'the author exposes belt item size');
assert.match(ui, /maaBeltStowEdit/, 'the author offers the real native move/rotate gizmo');
assert.match(ui, /maaBeltStowPreview/, 'the editor lets mobile users toggle belt artwork');
assert.match(ui, /maaBeltStowFlame/, 'flame preview can be turned off without changing gameplay');
class Vec {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; }
  setScalar(value) { return this.set(value,value,value); }
}
class Group {
  constructor() { this.children=[];this.userData={};this.position=new Vec();this.scale=new Vec(1,1,1);this.rotation=new Vec();this.visible=true; }
  add(child) { this.children.push(child);child.parent=this; }
}
class AxesHelper extends Group { constructor() { super();this.type='AxesHelper';this.scale=new Vec(1,1,1); } }
const THREE = { Group, AxesHelper };
const window = { HobunjiBeltStowRig:null };
const sandbox=vm.createContext({window,performance:{now:()=>0}});
vm.runInContext(shared,sandbox);
vm.runInContext(ui,sandbox);
const belt=window.HobunjiBeltStowRig;
const editor=window.AnimationAuthorBeltStow;
assert.equal(belt.defaultSnapshot(1.2).position.x,.264);
assert.equal(belt.defaultSnapshot(1.2).position.y,.6);
assert.equal(belt.normalizedSnapshot({ position:{x:Infinity}, scale:{x:-2} }).scale.x,1,
  'invalid imported scales cannot corrupt rendering');
assert.equal(belt.configuredSnapshot({characters:{'mao-ao::male':{anchors:{beltStow:{position:{x:.3,y:.5,z:.1}}}}}},'mao-ao','male').position.x,.3);
assert.equal(belt.configuredSnapshot({},'mao-ao','female'),null,'untuned runtime profiles retain the pants spline fallback');
assert.equal(editor.anchorNames(['posterior','shoulderPerch'], {source:{type:'creature'}}).includes('beltStow'),false);
const actor = {
  id:'test-player', source:{type:'npc',species:'mao-ao',gender:'male'},
  model:{userData:{portraitModelHeight:1.2}}, visualOffset:new Group(), rigAnchors:{},
};
const profile={anchors:{}};
assert.equal(editor.ensureProfile(profile,actor),profile);
assert.equal(profile.anchors.beltStow.position.y,.6,'new NPC profiles get species-size-aware default');
const group=editor.ensureActorAnchor(actor,THREE);
assert.equal(group,actor.rigAnchors.beltStow,'one stable native gizmo group is added');
assert.equal(editor.ensureActorAnchor(actor,THREE),group,'inspector refresh cannot create duplicate anchors');
assert.equal(actor.visualOffset.children.length,1);
assert.equal(editor.anchorNames(['posterior','shoulderPerch'],actor).at(-1),'beltStow');
profile.anchors.beltStow.position.x=-.27;
const normalized=editor.preserveNormalized({characters:{'mao-ao::male':{anchors:{}}}},
  {characters:{'mao-ao::male':profile}});
assert.equal(normalized.characters['mao-ao::male'].anchors.beltStow.position.x,-.27,
  'importing a rig must preserve the stow position despite old normalizer passes');
editor.resetProfile(profile,actor);
assert.equal(profile.anchors.beltStow.position.x,.264,'native reset returns to this species default');

// Run the exact late bridge that preserves all earlier V15.xx rig hooks and installs
// one additional authoring anchor, including the existing JSON autosave path.
const start=html.indexOf('// Belt-stowed equipment: integrate the external authoring module');
const end=html.indexOf('syncAllMaaPanelBodies();',start);
assert(start>=0 && end>start);
let renderInvocations=0, inspectorMounts=0, saveCalls=0, changeEvents=[];
const rigState={mode:'rig',rig:{selectedAnchor:'posterior'},editTarget:'rigAnchor',actors:[actor]};
const selection={ actor };
const win={ AnimationAuthorBeltStow: {
  ...editor, mountInspector(opts){inspectorMounts++;selection.last=opts;},
},HobunjiBeltStowRig:belt, MultiAvatarAnimationAuthor:{} };
const fakeContext=vm.createContext({
  window:win,animationAuthor:rigState,state:{three:{THREE},settings:{docsRoot:'docs/'},rawBase:'https://example.invalid/'},
  normalizedRigProfileLibrary:value=>({ characters:{'mao-ao::male':{anchors:{}}}, creatures:{} }),
  rigAnchorNamesForActor:a=>a.source.type==='npc'?['posterior','shoulderPerch']:['saddle'],
  attachmentRigProfileForActor:()=>profile,
  createAnimationActorShell:()=>actor,
  resetAttachmentRigAnchorToRepositoryDefault:()=>false,
  renderAttachmentRigInspector(){renderInvocations++;},
  selectedAnimationActor:()=>selection.actor,
  characterRigProfileKey:()=> 'mao-ao::male',
  normalizePath:x=>x,
  rawUrl:path=>'https://example.invalid/'+path,
  attachAnimationGizmo(){},
  transformSnapshot:g=>({position:g.position,rotationDeg:g.rotation,scale:g.scale}),
  scheduleAnimationProjectSave(){saveCalls++;},
  setAnimationRecentChange:msg=>changeEvents.push(msg),
  applyAttachmentRigProfileToActor(){},
  log(){},
});
vm.runInContext(html.slice(start,end),fakeContext);
const names=Array.from(fakeContext.rigAnchorNamesForActor(actor));
assert.deepEqual(names,['posterior','shoulderPerch','beltStow']);
const imported={characters:{'mao-ao::male':{anchors:{beltStow:{position:{x:-.21,y:.5,z:.1}}}}}};
const output=fakeContext.normalizedRigProfileLibrary(imported);
assert.equal(output.characters['mao-ao::male'].anchors.beltStow.position.x,-.21);
fakeContext.renderAttachmentRigInspector();
assert.equal(renderInvocations,1);
assert.equal(inspectorMounts,1,'the dedicated section mounts beneath native rig coordinates');
selection.last.selectAnchor();
assert.equal(rigState.rig.selectedAnchor,'beltStow','the editor button selects the real move/rotate anchor');
assert.equal(renderInvocations,2,'switching belt anchor refreshes native numeric fields');
selection.last.reset();
assert.equal(saveCalls,1,'reset saves into the same attachment-rig project');
assert.equal(typeof win.MultiAvatarAnimationAuthor.beltStowDebug,'object','existing mobile debug API exposes the stow state');
console.log('animation belt rig: shared schema/defaults, import, native gizmo, panel, reset, debug and game wiring PASS');
