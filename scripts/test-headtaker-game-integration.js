'use strict';
// Executes the real game.js Headtaker-vs-renderer position path without
// starting WebGL. Also verifies the player input/neck ownership invariants.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const game=fs.readFileSync('docs/game.js','utf8');
const head=fs.readFileSync('docs/js/combat/combat-maskbound-headtaker.js','utf8');
const playerComposer=fs.readFileSync('docs/js/player-body-transform-composer.js','utf8');
const locks=fs.readFileSync('docs/js/character-action-locks.js','utf8');
const bandits=fs.readFileSync('docs/js/combat/combat-bandit.js','utf8');
assert(head.includes("participants: [{ id: 'player', channels: ['head'] }]"),'head-only game action lock, no movement/dodge/tool lock');
assert(head.includes('state?.headActionLock?.release?.()'),'head action lock is released at detachment');
assert(game.includes("if (window.CharacterActionLocks?.isLocked?.('player','head')) return;"),'real player aim obeys scoped head lock');
assert(locks.includes('function isLocked(participantId, channel)'),'game shares lock registry with character actions');
assert(playerComposer.includes('maskboundHeadtakerNeckControlled'),'player renderer skips overriding scripted neck yaw');
assert(bandits.includes("if (c?._maskboundHeadtakerNeckControlled) return;"),'victim bandits can walk but not independently aim their neck');
assert(head.includes('detachOnHostDodge: true'),'player can still dodge to escape the grapple');
assert(head.includes("'player-portrait-rebuilt'"),'rebuilding a player avatar clears stale neck/joint ownership instead of writing disposed skin bones');
assert(game.includes("cancel?.(entity, 'area-changed')"),'area transition cleans up the old-area Headtaker even though it cannot chase into the new map');
assert(game.includes("entity?.maskboundTroop === 'headtaker' && window.MaskboundHeadtaker?.isActive?.(entity)"),'area cleanup covers leap before attachment as well as an active grip');
assert(game.includes("cancel?.(c, 'despawn')"),'despawn releases the scoped player neck lock before disposing the attacker');
assert(head.includes('isActive: attacker =>'),'active committed attacks are detectable independently from hostile AI state');
assert(game.includes("c.maskboundTroop === 'headtaker' && window.MaskboundHeadtaker?.isActive?.(c)"),'search/flee transitions cannot freeze a committed Headtaker grapple');
const specialStart=game.indexOf("          } else if (c.maskboundTroop === 'headtaker' && window.MaskboundHeadtaker?.isActive?.(c)) {");
const specialEnd=game.indexOf("          } else if (c.state === 'fleeing-low-health')",specialStart);
assert(specialStart>0&&specialEnd>specialStart,'committed Headtaker branch precedes ordinary searching/fleeing');
const priorityCode=game.slice(specialStart, specialEnd).replace(/^\s*}\s*else if[^\n]+\n/,'').replace(/\n\s*}\s*$/,'');
const priorityTest=new Function('c','window','entityDt','targetPlayer','distToPlayer','let aimAngle=0,moving=false;'+priorityCode+';return {aimAngle,moving};');
const carried={maskboundTroop:'headtaker',_attachment:{host:{id:'live-player'}}};
let calledTarget=null;
const actualPriority=priorityTest(carried,{BanditCombat:{updateCombatAI(_attacker,_dt,target){calledTarget=target;return {aimAngle:1.2,moving:false};}}},.05,{id:'unrelated-search-target'},7);
assert.equal(calledTarget,carried._attachment.host,'committed grapple follows its original player even when ordinary aggro changes');
assert.equal(actualPriority.aimAngle,1.2,'active combat controller continues ticking after AI search state changes');
assert(head.includes('immuneToHost: false'),'player attacks can still damage the Headtaker');
assert(head.includes('staggerImmune: true'),'other incoming damage does not automatically break the grip');
assert(game.includes('player.dodging = true;'),'game dodge input still functions normally');

const posStart=game.indexOf('        const tx = c.x / TILE, tz = c.y / TILE, ty =');
const posEnd=game.indexOf('        // Bob animation when moving',posStart);
assert(posStart>0&&posEnd>posStart,'find actual updateCreatureMesh position branch');
const posCode=game.slice(posStart,posEnd);
const pos=new Function('c','TILE','surfY','scaleY','meleeLeapY','dt','kickPoseHeld','window',
  'const grp=c.avatarRef.group;'+posCode+'return {headtakerAttached,headtakerDescending,headtakerOwnsFacing};');

function actor(attached=false) {
  const a={
    maskboundTroop:'headtaker',_attachment:attached?{id:'maskbound-headtaker',stage:'attached'}:null,
    x:120,y:210,groundLift:.45,halfHeight:.45,groupRot:.2,pngRot:.2,perpState:{},
    avatarRef:{group:{position:{x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}},rotation:{y:0}}},
  };
  return a;
}
const win={MaskboundHeadtaker:{isDescending(c){return !!c._descending;}}};
let c=actor(true);
let result=pos(c,60,0,1,0,.016,false,win);
assert(result.headtakerAttached && result.headtakerOwnsFacing,'attached state owns renderer pose');
assert.equal(c.avatarRef.group.position.x,2,'moving victim immediately updates attached Headtaker X, no positional easing');
assert.equal(c.avatarRef.group.position.z,3.5,'moving victim immediately updates attached Headtaker Z');
assert.equal(c.avatarRef.group.position.y,.45,'grapple hop follows exact host height this frame');
c=actor(false);c._descending=true;c.avatarRef.group.position.y=7;
result=pos(c,60,0,1,10,.016,false,win);
assert(result.headtakerDescending && result.headtakerOwnsFacing,'real skyfall retains combat-owned portrait facing');
assert.equal(c.avatarRef.group.position.y,7,'renderer never overrides live descent world Y');
assert.equal(c.avatarRef.group.position.x,2,'descent horizontal lerp is owned by combat, not double-smoothed');
c=actor(false); c.avatarRef.group.position.x=0;
result=pos(c,60,0,1,0,.016,false,win);
assert(!result.headtakerOwnsFacing,'ordinary hostile unaffected');
assert(c.avatarRef.group.position.x>0&&c.avatarRef.group.position.x<2,'normal game renderer still eases movement');
const yawStart=game.indexOf('        if (headtakerOwnsFacing) { /* Skyfall/grapple already authored groupRot');
const yawEnd=game.indexOf('        // PNG planes get a separate deadzone',yawStart);
assert(yawStart>0&&yawEnd>yawStart,'find actual updateCreatureMesh facing branch');
const yawCode=game.slice(yawStart,yawEnd);
const yaw=new Function('c','headtakerOwnsFacing','kickPoseHeld','rawTargetRotY','dt','angleDiff','grp',yawCode);
c=actor(true); c.groupRot=-Math.PI/4;
yaw(c,true,false,1.7,.016,(a,b)=>a-b,c.avatarRef.group);
assert.equal(c.groupRot,-Math.PI/4,'grapple yaw remains parallel to victim instead of chasing player facing');
assert.equal(c.avatarRef.group.rotation.y,-Math.PI/4,'live hostile group retains contact orientation');
c=actor(false);
yaw(c,false,false,1.7,.016,(a,b)=>a-b,c.avatarRef.group);
assert(c.groupRot>.2,'ordinary bandit aim interpolation is unchanged');
assert(game.includes('c.pngRot = c.groupRot; // Portrait, legs, and hands stay in the grapple frame'),'skinned portrait and legs follow protected orientation');
console.log('PASS real game renderer: exact grip follow, descent, orientation; player movement/dodge/head-lock input contracts');