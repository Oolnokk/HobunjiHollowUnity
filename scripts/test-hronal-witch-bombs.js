'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const read=path=>fs.readFileSync(path,'utf8');
const json=path=>JSON.parse(read(path));
const bomb=json('docs/config/furniture-authored/hronalWitchBomb.json');
const tube=json('docs/config/furniture-authored/witchBombCeilingTube.json');
const index=json('docs/config/furniture-authored/index.json');

assert.equal(bomb.key,'hronalWitchBomb');
assert.equal(bomb.parts.length,1,'the Witch-bomb remains the authored single stone sphere');
const sphere=bomb.parts[0];
assert.equal(sphere.kind,'sphere');
assert.deepEqual([sphere.transform.sx,sphere.transform.sy,sphere.transform.sz],[.45,.45,.45]);
assert.equal(sphere.patternSurfaces.length,1);
const glyph=sphere.patternSurfaces[0];
assert.equal(glyph.mode,'engraving');
assert.equal(glyph.selector,'all','all sphere triangles must receive the Harlyao engraving');
assert.equal(glyph.patternId,'harlyao_glyph_entropy');
assert.equal(glyph.glowColor,'#ff7417');
assert(glyph.glowIntensity>0,'the rune has a non-zero orange emissive pass');
assert(glyph.glowPulseSpeed>0,'the glyph can pulse');
assert(bomb.carryable.enabled);
assert(bomb.carryable.handTargets.left&&bomb.carryable.handTargets.right,'player and enemy hands use the authored two-hand grip');
assert.equal(bomb.carryable.enemyHoldAnchor.scale,.82);

assert.equal(tube.puzzle.role,'mechanism');
assert.equal(tube.puzzle.behavior,'witchBombDispenser');
assert.equal(tube.puzzle.bombFuseSeconds,10);
assert(tube.bombTubeExit,'the bomb spawns at an authored point below the ceiling tube');
for(const key of ['hronalWitchBomb','witchBombCeilingTube'])
  assert(index.furniture.some(item=>item.key===key),key+' is in the canonical furniture index');

const window={};
vm.runInNewContext(read('docs/js/furniture-puzzle-properties.js'),{window});
const api=window.FurniturePuzzleProperties;
assert(api.MECHANISMS.includes('witchBombDispenser'));
const normalized=api.normalizePuzzle(tube.puzzle);
assert.equal(normalized.behavior,'witchBombDispenser');
assert.equal(normalized.bombFuseSeconds,10);
assert.equal(api.normalizePuzzle({...tube.puzzle,bombFuseSeconds:999}).bombFuseSeconds,120);
assert.equal(api.normalizePuzzle({...tube.puzzle,bombFuseSeconds:-3}).bombFuseSeconds,1);

const runtime=read('docs/js/furniture-puzzle-runtime.js');
assert(runtime.includes("puzzle.behavior === 'witchBombDispenser'"));
assert(runtime.includes('window.HronalWitchBombs?.dispenseFromMechanism?.(object)'));
assert(runtime.includes('witchBombDispenseRequested'),'each activation requests one dispense, not one per animation frame');

const bombs=read('docs/js/hronal-witch-bombs.js');
assert(bombs.includes('function registerDispenser('));
assert(bombs.includes('function unregisterDispenser('));
assert(bombs.includes('if (active&&!active.exploded) return false'),'each ceiling tube must reject a second live payload');
assert(bombs.includes('dispenser.dispensing=true'),'concurrent activator signals cannot start overlapping async spawns');
assert(bombs.includes('fuseSeconds:clamp(options.fuseSeconds??DEFAULT_FUSE_SECONDS,1,120)'));
assert(bombs.includes('bomb.spawnedAtMs=now()'),'the fuse begins at physical spawn time');
assert(bombs.includes('pulseSpeed:1.25+10*Math.pow(urgency,2.1)'),'glyph pulse frequency accelerates close to detonation');
assert(bombs.includes('BLAST_KNOCKBACK_PX_S'));
assert(bombs.includes('BURNING_HEALTH'));
assert(bombs.includes('triggerBurdenBlastAt'),'nearby burdens participate in chain reactions');
assert(bombs.includes('registerBreakable'),'breakable props have an explicit, opt-in destruction registration');
assert(bombs.includes('spawnCarriedByEnemy'));
assert(bombs.includes('function clearEnemyGrip('),'enemy hand ownership has an explicit cleanup helper');
assert(bombs.includes('bomb.onPickup=record=>{try{previousPickup?.(record);}finally{clearEnemyGrip(record);}}'),'player pickup clears the previous carrier hand target');
assert(bombs.includes('bomb.onLost=(record,cause)=>{try{previousLost?.(record,cause);}finally{clearEnemyGrip(record);}}'),'burden loss clears the previous carrier hand target');
assert(bombs.includes("clearEnemyGrip(bomb); // An explosion must release the carrier's procedural two-hand target"),'detonation clears enemy hand state before removing the mesh');
assert(bombs.includes("tileHazard(tileAt(mapId,position.x,position.z))"),'water, lava and void also destroy a dropped bomb');
assert(bombs.includes("color:'#ff7417'"));

const carry=read('docs/js/shattercasks.js');
assert(carry.includes('onPickup:typeof options.onPickup'));
assert(carry.includes('onDrop:typeof options.onDrop'));
assert(carry.includes('onLost:typeof options.onLost'));
assert(carry.includes('fallGroundY:typeof options.fallGroundY'));
assert(carry.includes('function triggerBurdenBlastAt'));
assert(carry.includes('function activeBurdenRecords')===false,'the existing Burden registry API is exposed without introducing a duplicate implementation');
assert(carry.includes('activeBurdenRecords:(mapId=area())=>'));
const blast=carry.slice(carry.indexOf('  function applyBlast('),carry.indexOf('  function triggerBurdenBlastAt('));
assert(blast.includes('options.burningHealth'));
assert(blast.includes('options.knockbackPxS'));
assert(blast.includes('Math.max(8,24*(1-dist/radius))'),'ordinary Shattercask Footing loss keeps its old minimum');

const bandit=read('docs/js/combat/combat-bandit.js');
assert(bandit.includes("c.carriesHronalWitchBomb === true"));
assert(bandit.includes('spawnCarriedByEnemy?.(c'));
const hands=read('docs/js/procedural-hand-frame-driver.js');
assert(hands.includes('proceduralHeldItemTarget'));
const html=read('docs/index.html');
assert(html.includes('js/hronal-witch-bombs.js?v='));
assert(html.includes('js/key-statues.js?v='));
assert(html.includes('furniture-pattern-surfaces.js?v=20261102witchBombGlyphGlow1'));

console.log('Hronal Witch-bomb: authored whole-sphere glyph/glow, fuse, ceiling dispenser lock, carrier grip, hazard loss, fire blast and breakable hooks passed.');
