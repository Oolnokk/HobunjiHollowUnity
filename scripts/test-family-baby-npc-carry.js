#!/usr/bin/env node
'use strict';
// NPC carriers (a spouse) use the PLAYER's baby carry: one shared Shattercasks mount solve on the
// carrier's own posterior, the same authored grips/elbows through proceduralHeldItemTarget, the
// back stow kept on the carrier's body instead of the rotating portrait, and grips released on hand-off.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const shatter = fs.readFileSync('docs/js/shattercasks.js', 'utf8');
const burdens = fs.readFileSync('docs/js/family-baby-burdens.js', 'utf8');
const runtime = fs.readFileSync('docs/js/hand-shoulder-pose-runtime.js', 'utf8');
const driver = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8');

// One pose solve, shared.
assert.match(shatter, /function solveCarryMount\(group,carryable=\{\},isBack=false,posterior\)\{/, 'shared carry solve exists');
assert.match(shatter, /solveCarryMount\(vase\.group,carryable,isBack,posteriorLocal\);/, 'the player delegates to the shared solve');
assert.match(shatter, /solveCarryMount,carrierPosteriorLocal,mountCarryOnPortrait,/, 'shared solve, posterior and portrait mount are exported');
assert.match(shatter, /function moveBackBurdenToPortrait\(vase,body,portrait\)\{ mountCarryOnPortrait\(vase\.group,body,portrait\); \}/, 'player back stow uses the shared portrait mount');

// Run the real solveCarryMount and check it against an independent inverse-anchor computation.
let THREE;
try { THREE = require('three'); } catch (_) { THREE = null; }
if (THREE) {
  const start = shatter.indexOf('  function solveCarryMount(');
  const end = shatter.indexOf('\n  }\n', start) + 4;
  const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const solve = new Function('THREE', 'finite', 'heldAnchorEuler', 'authoredAnchorQuat', 'posteriorOffset', 'heldAnchorOffset',
    shatter.slice(start, end) + '\nreturn solveCarryMount;')(THREE, finite, new THREE.Euler(), new THREE.Quaternion(), new THREE.Vector3(), new THREE.Vector3());
  const carryable = { billboardAnchor: { position: { x: .01, y: .11, z: 0 }, rotation: { x: 4.95, y: -10.92, z: -64.53 }, size: 1, posteriorOffset: { x: .11, y: .075, z: .13 } },
    backCarry: { position: { x: -.008, y: .2, z: 0 }, rotation: { x: -174.07, y: -.94, z: 171.05 }, size: 2, posteriorOffset: { x: .0581, y: .282, z: -.0603 }, portraitAnchor: { x: 0, y: 0, z: 0 } } };
  const posterior = new THREE.Vector3(0, .3427, 0);
  for (const back of [false, true]) {
    const cfg = back ? carryable.backCarry : carryable.billboardAnchor;
    const g = solve(new THREE.Group(), carryable, back, posterior);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...['x', 'y', 'z'].map(a => cfg.rotation[a] * Math.PI / 180))).invert();
    const expected = posterior.clone().add(new THREE.Vector3(cfg.posteriorOffset.x, cfg.posteriorOffset.y, cfg.posteriorOffset.z))
      .sub(new THREE.Vector3(cfg.position.x, cfg.position.y, cfg.position.z).multiplyScalar(1 / cfg.size).applyQuaternion(q));
    assert(g.position.distanceTo(expected) < 1e-9, (back ? 'back' : 'held') + ': mount point = posterior + offset - inverse(anchor)*anchorPos/size');
    assert(Math.abs(g.quaternion.angleTo(q)) < 1e-9, (back ? 'back' : 'held') + ': baby turns by the inverse anchor rotation');
    assert(Math.abs(g.scale.x - 1 / cfg.size) < 1e-12, (back ? 'back' : 'held') + ': baby scales by 1/size');
  }
}

// NPC carry uses that solve on the carrier's own facing frame and live posterior.
assert.match(burdens, /const body = spouse\._npcCharacterRigRoot \|\| spouse\.root;/, 'NPC body frame = rig root (the playerMesh equivalent)');
assert.match(burdens, /liveY: Number\(spouse\.legs\?\.standingPosteriorY\)/, 'NPC posterior comes from its live leg rig');
assert.match(burdens, /api\.solveCarryMount\(group, entry\.burden\.data\?\.carryable \|\| \{\}, back, npcScratch\.posterior\);/, 'NPC uses the shared solve with no unit conversion');
assert.doesNotMatch(burdens, /divideScalar\(s\)/, 'no rig-scale division: authored offsets are body-local like the player');
assert.match(burdens, /if \(back && group\.parent === body && entry\.npcCarryPose === 'back'\) return true;/,
  'NPC back-stowed infant stays in the torso frame during repeated family updates');
assert.doesNotMatch(burdens, /api\.mountCarryOnPortrait\(group, body, portrait\)/,
  'NPC newborn cannot be reparented into the independently rotating head/portrait');
assert.match(burdens, /const body = spouse\._npcCharacterRigRoot \|\| spouse\.root; \/\/ Fallback also follows the carrier/,
  'legacy fallback is mounted to the same body frame, not the head');

// Execute the actual NPC carry solver, rather than checking only its source text.
{
  const begin=burdens.indexOf('  function solveNpcCarry(entry, spouse, back) {');
  const end=burdens.indexOf('  function spouseCarry(',begin);
  assert(begin>=0 && end>begin,'NPC carry solver remains a small extractable function');
  class V { constructor(x=0,y=0,z=0){this.set(x,y,z);}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(p){return this.set(p.x,p.y,p.z);} }
  class Body {constructor(){this.parent=null;this.children=[];}
    add(child){this.children.push(child);child.parent=this;}}
  let solves=0; // Counts actual newborn pose solves, excluding redundant family updates.
  const body=new Body(),portrait=new Body(),group={parent:null,position:new V(),quaternion:{},scale:{}};
  body.add(portrait); // The portrait is a separate rotating child in the real NPC rig.
  const mock={THREE:{Vector3:V},Shattercasks:{
    carrierPosteriorLocal(out){return out.set(.08,.33,-.05);},
    solveCarryMount(child,_pose,back,posterior){
      solves++; child.position.copy(posterior);child.position.z+=back?-.06:.12;
    },
  }};
  const solve=new Function('window','npcScratch',burdens.slice(begin,end)+'\nreturn solveNpcCarry;')(mock,{posterior:null});
  const spouse={_npcCharacterRigRoot:body,root:body,avatarGroup:{userData:{neckRig:{skinnedPlane:portrait}}},
    legs:{standingPosteriorY:.33}};
  const entry={burden:{group,data:{carryable:{backCarry:{posteriorOffset:{z:-.06}}}}},npcCarryPose:null};
  assert.equal(solve(entry,spouse,true),true);
  assert.equal(group.parent,body,'spouse newborn back-stow inherits the torso, not the portrait');
  assert(group.position.z<0,'spouse newborn starts behind its torso');
  assert.equal(solve(entry,spouse,true),true);
  assert.equal(solves,1,'portrait/head updates do not re-solve or move an already attached baby');
  assert.equal(solve(entry,spouse,false),true);
  assert.equal(solves,2,'switching to arms recomputes the existing authored hand pose');
  assert.equal(solve(entry,spouse,true),true);
  assert.equal(solves,3,'restowing recomputes the authored back pose');
}

// Same grips + elbows through the hand driver hook; back stow frees the hands.
assert.match(driver, /record\?\.avatarRoot\?\.userData\?\.proceduralHeldItemTarget/, 'hand driver honours the NPC held-item target');
assert.match(burdens, /gripRoot\.userData\.proceduralHeldItemTarget = \{ holder: entry\.burden\.group, mode: 'authored-world',\s*handTargets: carryable\.handTargets \|\| \{\}, elbows: carryable\.elbows \|\| null, familyBabyId: child\.id \}/,
  'NPC grips use the same authored handTargets/elbows as the player');
assert.match(burdens, /\} else clearNpcGrip\(entry\); \/\/ Back stow frees the hands/, 'back stow releases NPC grips');
for (const where of [/onPickup: \(\) => \{\n\s*clearNpcGrip\(entry\);/, /child\.carryBy = null; child\.carryPose = null;\n\s*clearNpcGrip\(entry\);/, /entry\.disposing = true;\n\s*clearNpcGrip\(entry\);/])
  assert.match(burdens, where, 'grip released on hand-off / settle / discard');

// Elbow runtime: the NPC target's elbows drive that NPC's arms; others are untouched.
const window = { };
vm.runInNewContext(runtime, { window, globalThis: window, console, Math, Number, Object, Array, String });
const api = window.HobunjiHandShoulderPoseRuntime;
assert(api?.currentElbow, 'pose runtime loads');
{
  const npcRoot = { userData: { proceduralHeldItemTarget: { familyBabyId: 'c1', elbows: { left: { x: .1, y: -.2, z: .05 }, right: null } } }, parent: null };
  assert.deepEqual(JSON.parse(JSON.stringify(api.currentElbow('left', npcRoot))), { x: .1, y: -.2, z: .05 }, 'NPC carrier left elbow comes from the baby profile');
  assert.equal(api.currentElbow('right', npcRoot), null, 'unset elbow keeps legacy shoulder aiming');
  const otherNpc = { userData: { proceduralHeldItemTarget: { holder: {}, elbows: { left: { x: 9, y: 9, z: 9 } } } }, parent: null };
  assert.notDeepEqual(api.currentElbow('left', otherNpc), { x: 9, y: 9, z: 9 }, 'non-baby held items do not borrow baby elbows');
}
console.log('PASS NPC baby carry: shared player pose solve, posterior, portrait back stow, grips/elbows and hand-off release');
