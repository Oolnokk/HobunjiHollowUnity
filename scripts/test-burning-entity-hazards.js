// Run: node scripts/test-burning-entity-hazards.js
// Burning actors and briefly burning corpses are physical fire sources for torch strikes and knockback, not walking blockers.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

const removedVfx = []; // Verifies expired and despawned corpses release their fire presentation.
const world = {
  ResourceSystem: { getAffliction: (entity, id) => entity?.afflictions?.[id] || 0 },
  BurningAfflictionVfx: { disposeEntity: entity => removedVfx.push(entity) },
};
vm.runInNewContext(read('docs/js/combat/burning-entity-hazards.js'), {window:world});
const fire = world.BurningEntityHazards; // Production hazard implementation under test.
assert.equal(fire.installed, true);

const actor = (x, y, extra = {}) => ({x,y,health:100,areaId:'farm',afflictions:{},...extra}); // Test actors use live logical pixel positions.
const burning = (x, y, extra = {}) => actor(x,y,{afflictions:{burningHealth:12},...extra}); // Shares actual Burning Health resource semantics.
const group = (worldY=0.3, inCone=true) => ({visible:true,position:{y:worldY},inCone}); // Minimal Three.js group for physical-hitbox testing.
const scene = (player, hostileObjects=[], companionObjects=[], corpseObjects=[], animalObjects=[]) =>
  ({area:'farm',player,hostileObjects,companionObjects,corpseObjects,animalObjects}); // Exact source registries supplied by game.js.
const mover = actor(0,0,{physicalFeetY:0}); // Shoved source excluding itself when the player is burning.
const calmSweep = {x:100,y:0,blockedX:false,blockedY:false,blockedAt:null}; // No static wall blocked the attempted impulse.
const contact = root => root.inCone && root.visible !== false; // Stand-in for existing Combat.meleeHit + cover-gated torch contact.

assert.equal(fire.isBurning(actor(0,0)),false,'unlit actors are not hazards');
assert.equal(fire.isBurning(burning(0,0)),true,'Burning Health is a fire hazard');
assert.equal(fire.isBurning(actor(0,0,{afflictions:{kindlingHealth:5}})),true,'Living Flame Kindling also has active fire');
const enemy = burning(60,0,{name:'enemy',halfHeight:.3,avatarRef:{group:group(.3)}});
const ally = burning(60,0,{name:'ally',halfHeight:.3,avatarRef:{group:group(.3)}});
const corpse = actor(60,0,{health:0,state:'corpse',deathCause:'fire',name:'corpse',halfHeight:.3,avatarRef:{group:group(.036)}});
assert.equal(fire.beginCorpse(corpse),true,'fire death leaves temporary corpse flame even with consumed Burning buildup');
assert.equal(fire.isBurning(corpse),true);

const closest = fire.resolveSweptImpact(mover,100,0,10,100,scene(mover,[enemy]),calmSweep);
assert.equal(closest.knockbackDescriptorOverride.fireHazard,true,'burning hostile yields the shared Fire Hazard profile');
assert.equal(closest.knockbackDescriptorOverride.kind,'fire');
assert.equal(closest.blockedX,true,'fire impact stops the forced movement');
assert(closest.x > 10 && closest.x < 40,'sweep stops at the body collision edge, not its center');
const versusAlly = fire.resolveSweptImpact(mover,100,0,10,100,scene(mover,[],[ally]),calmSweep);
assert.equal(versusAlly.knockbackDescriptorOverride.fireHazard,true,'burning companion is a fire impact target');
const versusCorpse = fire.resolveSweptImpact(mover,100,0,10,100,scene(mover,[],[],[corpse]),calmSweep);
assert.equal(versusCorpse.knockbackDescriptorOverride.fireHazard,true,'lying fire corpse is a knockback hazard');
const burningPlayer = burning(60,0,{physicalFeetY:0});
const shovedEnemy = actor(0,0,{halfHeight:.3,avatarRef:{group:group(.3)}});
assert.equal(fire.resolveSweptImpact(shovedEnemy,100,0,10,100,scene(burningPlayer),calmSweep).knockbackDescriptorOverride.fireHazard,true,
  'enemies knocked into the burning player get the same fire collision');
const unlit = actor(60,0);
assert.equal(fire.resolveSweptImpact(mover,100,0,10,100,scene(mover,[unlit]),calmSweep),calmSweep,
  'normal living bodies do not become knockback walls');
const otherArea = burning(60,0,{areaId:'ruin'});
assert.equal(fire.resolveSweptImpact(mover,100,0,10,100,scene(mover,[otherArea]),calmSweep),calmSweep,
  'an actor in a different area is never collided');
const otherFloor = burning(60,0,{halfHeight:.3,avatarRef:{group:group(1.6)}});
assert.equal(fire.resolveSweptImpact(mover,100,0,10,100,scene(mover,[otherFloor]),calmSweep),calmSweep,
  'burning actors on another floor cannot block a shove');
const wallFirst = {x:10,y:0,blockedX:true,blockedY:false,blockedAt:{x:20,y:0}};
assert.equal(fire.resolveSweptImpact(mover,100,0,10,100,scene(mover,[enemy]),wallFirst),wallFirst,
  'a static wall struck first retains priority over fire farther behind');
const overlappingEnemy = burning(5,0,{halfHeight:.3,avatarRef:{group:group(.3)}});
assert.equal(fire.resolveSweptImpact(mover,100,0,10,100,scene(mover,[overlappingEnemy]),calmSweep),calmSweep,
  'pre-existing body overlaps must not trap a knockback in place');

assert.equal(fire.findTorchSource(contact,scene(mover,[enemy])),enemy,'torch strike ignites from a burning enemy');
assert.equal(fire.findTorchSource(contact,scene(mover,[],[ally])),ally,'torch strike ignites from a burning ally');
assert.equal(fire.findTorchSource(contact,scene(mover,[],[],[corpse])),corpse,'torch strike ignites from a flaming corpse');
assert.equal(fire.findTorchSource(contact,scene(mover,[otherArea])),null,'other-area actors cannot ignite torches');
const occluded = burning(30,0,{avatarRef:{group:group(.3,false)}});
assert.equal(fire.findTorchSource(contact,scene(mover,[occluded])),null,'torch must reach the target inside the actual melee cone');
const hidden = burning(30,0,{avatarRef:{group:{...group(.3),visible:false}}});
assert.equal(fire.findTorchSource(contact,scene(mover,[hidden])),null,'hidden entities cannot ignite torches');
assert.equal(fire.findTorchSource(contact,scene(mover,[enemy], [enemy])),enemy,'shared hostile-companion registry does not duplicate source');

fire.tickCorpses(7.99,new Set([corpse]));
assert.equal(fire.isBurning(corpse),true,'corpse still burns before its eight-second expiry');
fire.tickCorpses(.02,new Set([corpse]));
assert.equal(fire.isBurning(corpse),false,'corpse extinguishes when its real fire expires');
assert(removedVfx.includes(corpse),'corpse VFX releases when its fire goes out');
assert.equal(fire.findTorchSource(contact,scene(mover,[],[],[corpse])),null,'extinguished corpse cannot light torches');
assert.equal(fire.resolveSweptImpact(mover,100,0,10,100,scene(mover,[],[],[corpse]),calmSweep),calmSweep,
  'extinguished corpse is not a knockback obstacle');
const deleted = actor(60,0,{state:'corpse',deathCause:'fire'});
fire.beginCorpse(deleted);
fire.tickCorpses(.1,new Set());
assert.equal(fire.isBurning(deleted),false,'despawned corpse loses flame immediately');
assert(removedVfx.includes(deleted),'removed corpse disposes fire presentation');
assert.equal(fire.beginCorpse(actor(60,0,{state:'corpse',deathCause:'blunt'})),false,
  'ordinary unburned corpses never become fire hazards');

const game = read('docs/game.js');
const tools = read('docs/js/adventuring-tools.js');
const death = read('docs/js/creature-death.js');
const visual = read('docs/js/combat/burning-affliction-vfx.js');
const index = read('docs/index.html');
const probe = read('docs/js/pixel-probe.js');
assert.match(game,/BurningEntityHazards\?\.resolveSweptImpact\?\.\(entity, desiredX, desiredY, radiusPx, TILE/,'shared forced-movement sweep calls live fire hazard resolver');
assert.match(game,/BurningEntityHazards\?\.tickCorpses\?\.\(dt, corpseObjects\)/,'corpse flame ticks use existing corpse owner');
assert.match(tools,/BurningEntityHazards\?\.findTorchSource\?\.\(contact/,'torch uses existing physical strike contact callback');
assert.match(death,/BurningEntityHazards\?\.beginCorpse\?\.\(c\)/,'creature death registers a real corpse flame');
assert.match(visual,/BurningEntityHazards\?\.corpseFlameAmount\?\.\(entity\)/,'presentation uses real finite corpse flame lifetime');
assert.match(index,/js\/combat\/burning-entity-hazards\.js\?v=/,'browser loads fire source adapter');
assert(index.indexOf('burning-entity-hazards.js') < index.indexOf('burning-affliction-vfx.js'),'source registers before visual companion');
assert.match(probe,/Burning hazards: /,'mobile Pixel Probe exposes impact/ignition diagnostics');
console.log('Burning actors, allies, corpses: torch ignition, knockback and expiry regression passed');
