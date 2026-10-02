'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const read = path => fs.readFileSync(path, 'utf8'); // Reads shipping source and authored fixtures used below.
const game = read('docs/game.js'); // Executes the actual gameplay close/spawn/seat seams.
const context = {window:{},document:{addEventListener(){}},console}; // Scene builders need no browser boot.
vm.runInNewContext(read('docs/js/opening-story-cutscene.js'),context);
const api = context.window.OpeningStoryCutscene; // Tests the public story/debug surface.
const rescue = api.buildRescueScene(new Map(),{}); // Resolves authored local blocking.
const player = rescue.actors.find(a=>a.isPlayer); // Center of both the wolf ring and establishing camera.
const wolves = rescue.actors.filter(a=>a.creatureTypeId==='gar-wolf'); // Three vertices must enclose the actual player.
const cross=(a,b,p)=>(b.lc-a.lc)*(p.lr-a.lr)-(b.lr-a.lr)*(p.lc-a.lc); // Convex containment check independent of authored coordinates.
const edges=wolves.map((a,i)=>cross(a,wolves[(i+1)%wolves.length],player)); // All signs agree only when the player is inside the triangle.
assert(edges.every(n=>n>0)||edges.every(n=>n<0));
assert.equal(rescue.cameraTargetActorId,player.id);
assert.equal(rescue.widePlayerShots,true);
assert(rescue.camera3d.fovDeg>=60);
assert.equal(rescue.camera3d.localTarget.x,player.lc+.5);
assert.equal(rescue.camera3d.localTarget.z,player.lr+.5);
// All five cinematic seat targets resolve through the real game authority, with map grid rotations preserved.
const meeting=api.buildHunundiMeetingScene(new Map(),{}); // Includes the initially standing surveyor's later chair.
const room=JSON.parse(read('docs/config/maps/map_i_temple_basement_hunundi.json')); // Real editor-authored placements.
const chair=JSON.parse(read('docs/config/furniture-authored/chairSimple.json')); // Real chair surface height/pitch.
const seats={window:{AuthoredFurniture:{peek:key=>key==='chairSimple'?chair:null,seatAnchorFor:data=>data.seatAnchors[0]}},DECORATIVE_FURNITURE_DEFS:{chairSimple:{fw:1,fd:1,sit:true}}}; // Rejects the former incorrect inventory-item key.
const seatStart=game.indexOf('      function resolveSeatWorldTransform('); // Actual shared player/NPC anchor transform.
const seatEnd=game.indexOf('      function beginSitInteraction(',seatStart);
const npcStart=game.indexOf('      function npcSeatTransformForTarget(');
const npcEnd=game.indexOf('      async function makeNpcWalker(',npcStart);
vm.runInNewContext(game.slice(seatStart,seatEnd)+game.slice(npcStart,npcEnd)+'\nresolve = npcSeatTransformForTarget;',seats);
for(const actor of meeting.actors){
 const target=actor.seatTarget; // Actors align with the same chair tile and effective map yaw.
 const piece=room.furniture.find(f=>f.col===target.c&&f.row===target.r&&f.itemKey==='chairSimpleFurniture');
 assert(piece);
 assert.equal(target.rotY,(piece.gridRot||0)+(piece.rotY||0));
 const seat=seats.resolve(target); // A null seat was the prior rendering bug.
 assert(seat);
 assert.equal(seat.y,chair.seatAnchors[0].position.y);
}
// Current gear is projected before constructing the cinematic player record.
const profileStart=game.indexOf('              const playerProfile = window.EquipmentPanel.applyGearClothingToPlayerData');
const profileEnd=game.indexOf('              const walker = await makeNpcWalker(fakeRec',profileStart);
const clothing={_playerData:{appearance:{speciesId:'mashtzarr'},equippedCosmetics:['starter']},window:{EquipmentPanel:{applyGearClothingToPlayerData:data=>({...data,equippedCosmetics:['current-poncho'],appliedDyes:{torso:'blue'}})}},actor:{name:'Player'}}; // Models gear differing from creation cosmetics.
vm.runInNewContext(game.slice(profileStart,profileEnd)+'\nresult=fakeRec;',clothing);
assert.deepEqual(Array.from(clothing.result.equippedCosmetics),['current-poncho']);
assert.equal(clothing.result.appliedDyes.torso,'blue');
// Every external exit uses the common close authority; cutscenes must preserve dialogue and its Continue callback.
const closeStart=game.indexOf('      function closeNpcDialogue()');
const closeEnd=game.indexOf('\n      // renderRelationshipHearts',closeStart);
const dialogue={cutscenePreviewActive:true,dialogueOpen:true}; // No other dependencies should be touched while the director owns dialogue.
vm.runInNewContext(game.slice(closeStart,closeEnd)+'\ncloseNpcDialogue();',dialogue);
assert.equal(dialogue.dialogueOpen,true);
// Execute the combat module's held-prone adapter against the actual authored knockdown tail.
class Quaternion {constructor(x=0,y=0,z=0,w=1){Object.assign(this,{x,y,z,w});}copy(q){Object.assign(this,q);return this;}slerp(q,t){for(const axis of ["x","y","z","w"])this[axis]+=(q[axis]-this[axis])*t;return this;}clone(){return new Quaternion(this.x,this.y,this.z,this.w);}identity(){return this.copy(new Quaternion());}setFromAxisAngle(){return this;}invert(){return this;}}
class Vector {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}
class Group {constructor(){this.position=new Vector();this.quaternion=new Quaternion();this.userData={};this.children=[];}add(node){if(node.parent)node.parent.children=node.parent.children.filter(c=>c!==node);this.children.push(node);node.parent=this;}}
const bank=JSON.parse(read('docs/config/animations/spinthrow-blend-v1.json')); // Exact bank combat holds on zero Footing.
const clip=bank.clips.front.clip;
const tail=clip.frames[clip.frames.length-1]; // Expected body/leg pose after the throw finishes.
const ragdoll={THREE:{Quaternion,Vector3:Vector,Group},window:{ImpactBlendLibrary:{getClip:()=>clip}}}; // Keeps the isolated actor API independent of live-player composer state.
vm.runInNewContext(read('docs/js/combat/impact-ragdoll-playback.js'),ragdoll);
const legs=new Group(),avatar=new Group(),root=new Group(); // Both anatomical legs and torso rotate around posterior.
root.add(legs);root.add(avatar);avatar.position.y=.6;
const poses={}; // Recorded leg frames are compared with the authored tail.
const walker={root,avatarGroup:avatar,legs:{group:legs,standingPosteriorY:.4,applyRecordedLegPose:(side,pose)=>{poses[side]=pose;}}};
ragdoll.window.ImpactRagdollPlayback.holdHumanoidProne(walker);
assert.equal(avatar.parent,legs.parent);
assert.equal(avatar.position.y,.6-.4);
assert.equal(walker._cinematicPosePivot.quaternion.x,tail.ragdoll.body.localQuaternion.x);
assert.equal(poses.left.upperLength,tail.ragdoll.ik.left.upperLength);
assert.equal(poses.right.calfLocalQuaternion.z,tail.ragdoll.ik.right.calfLocalQuaternion.z);
const pivot=walker._cinematicPosePivot; // Repeated hold ticks must not allocate/reparent another rig.
ragdoll.window.ImpactRagdollPlayback.holdHumanoidProne(walker);
assert.equal(walker._cinematicPosePivot,pivot);
ragdoll.window.ImpactRagdollPlayback.clearHumanoidProne(walker);
assert.equal(pivot.quaternion.w,1);
assert.equal(pivot.position.y,.4);
console.log('Rescue framing, seating, gear, combat prone and dialogue lock passed');
