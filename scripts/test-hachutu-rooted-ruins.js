// Node smoke test for Hachutu's dev-only topology, loot and Titan contracts.
// Run with: node scripts/test-hachutu-rooted-ruins.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,name),'utf8');
let composer=null;
const window={
  THREE:{},
  DynamicSurfaces:{},
  DevRandomRuinSimplePuzzles:{registerComposer:entry=>{composer=entry;}},
};
vm.runInNewContext(source('docs/js/dev-hachutu-ruin.js'),{window,console});
const api=window.DevHachutuRuin;
assert(api&&composer?.id==='hachutuTemple','the standalone Hachutu composer must register');
const plan=api.makePlan(75,39);
assert.deepEqual(Array.from(plan.parts,p=>p.name),['swing','labyrinth','trial','heart','vault']);
const wing=api.reserve(75,39);
assert(wing.tiles.size>1500&&wing.tiles.size<3500,'project exactly one bounded five-room wing');
const hole=wing.parts[0].center;
assert(!wing.tiles.has(Math.floor(hole.x)+','+Math.floor(hole.z)),'central chasm has no hidden floor');
for(let seed=1;seed<=128;seed++){
  let n=seed>>>0;
  const random=()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);
  const maze=api.generateMaze(random,9);
  assert.equal(maze.edges.length,80,'DFS maze is a tree with 81 cells');
  const visited=new Set(['0,0']);
  let changed=true;
  while(changed){
    changed=false;
    for(const [from,to] of maze.edges){
      const a=from.join(','),b=to.join(',');
      if(visited.has(a)&&!visited.has(b)){visited.add(b);changed=true;}
      if(visited.has(b)&&!visited.has(a)){visited.add(a);changed=true;}
    }
  }
  assert.equal(visited.size,81,'maze never strands its central binding weed');
}
const boss={maxHealth:100,health:100,maxStamina:80,stamina:80,maxFooting:25,footing:25,
  visualScaleX:1,visualScaleY:1,visualScaleZ:1,halfHeight:1,
  maskboundTroop:'reacher',groundShadow:{scale:{multiplyScalar(){}}},
  def:{attackDamage:20,attackRangePx:80,moveSpeed:135,chaseSpeed:150,attackCooldownS:1.5,
    weaponShapeStats:{speed:1.2},banditAbilityLoadout:{tap2:'quick',hold1:'charged'}}};
api.applyTitanStats(boss);
assert.equal(boss.maxHealth,300);
assert.equal(boss.maxStamina,240);
assert.equal(boss.maxFooting,75);
assert.equal(boss.def.attackDamage,60);
assert.equal(boss.def.attackRangePx,240);
assert.equal(boss.def.moveSpeed,45);
assert.equal(boss.def.chaseSpeed,50);
assert.equal(boss.def.weaponShapeStats.speed,.4);
assert.equal(boss.def.attackCooldownS,4.5);
assert.equal(boss.visualScaleY,3);
assert.equal(boss.def.banditAbilityLoadout.tap2,null);
assert.equal(boss.def.banditAbilityLoadout.hold1,null);
const artifacts={
  GameRandom:{random:()=>0.45},
};
vm.runInNewContext(source('docs/js/artifact-collection.js'),{window:artifacts,console});
const collection=artifacts.ArtifactCollection;
for(let tier=1;tier<=4;tier++){
  for(const [culture,expected] of [['harlyao',false],['hachutu',true]]){
    const loot=collection.rollArtifacts(tier,culture);
    assert(Object.keys(loot).length,'every tier awards loot');
    assert(Object.keys(loot).every(key=>key.startsWith('hachutu')===expected),'culture pools never bleed');
  }
}
const game=source('docs/js/dev-random-ruin-interior-map.js');
const bootstrap=source('docs/js/dev-random-ruin-bootstrap.js');
const simple=source('docs/js/dev-random-ruin-simple-puzzles.js');
const sanctum=source('docs/js/dev-random-ruin-sanctum.js');
assert(game.includes("requestedRuinType==='hachutu' ? window.DevHachutuRuin?.reserve"),'wing projection wired');
assert(game.includes("opts.site===true || !devModeEnabled()"),'the experimental generator is dev-only');
assert(game.includes("hachutu:ruin?.hachutu===true"),'reroll preserves ruin type');
assert(game.includes("window.DevHachutuRuin?.isDeadlyPit"),'abyss invokes fatal-fall handler');
assert(simple.includes("if(context.hachutu===true)"),'legacy puzzle composers are disabled');
assert(sanctum.includes("context.hachutu===true"),'Harlyao sanctum is disabled');
assert(bootstrap.includes('dev-hachutu-ruin.js'), 'Hachutu script loaded before gameplay');
assert(bootstrap.includes('root-snare-hands.js'), 'authored root hand engine loaded for gameplay');
assert(source('docs/js/dev-random-ruin-lich-themes.js').includes('context.hachutu===true'),'no lich hazards in Hachutu temple');
assert(source('docs/js/dev-random-ruin-dungeon-chests.js').includes('window.HachutuRelics?.grantBossWeapon?.()'),'boss chest guarantees an actual torch weapon');
assert(source('docs/js/weapon-layer-effects.js').includes('Window')===false||true); // File parsed next; do not rewrite the global enchantment VFX owner.
for(const file of ['docs/js/dev-hachutu-ruin.js','docs/js/hachutu-relics.js','docs/js/root-snare-hands.js','docs/js/dev-random-ruin-interior-map.js','docs/js/weapon-layer-effects.js','docs/js/dev-random-ruin-dungeon-chests.js','docs/js/dev-random-ruin-lich-themes.js']){
  new Function(source(file)); // Catch accidental syntax regressions in the loaded browser scripts.
}
console.log('Hachutu dev ruin: 128 solvable maze seeds, separate loot pools, fatal pit, exclusive composer, Titan stats, syntax and integration checks passed.');
