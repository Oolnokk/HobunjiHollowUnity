const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Group {
  constructor(){ this.children=[]; this.parent=null; this.visible=true; this.name=''; }
  add(child){ this.children.push(child); child.parent=this; }
}
function scene(){ return { children:[], add(o){this.children.push(o);o.parent=this;}, remove(o){this.children=this.children.filter(x=>x!==o);o.parent=null;} }; }

const npcRecords = [
  { id:'giver_a', appearance:{ speciesId:'species-a' } },
  { id:'giver_b', appearance:{ speciesId:'species-b' } },
];
const windowObject = {
  WEAPON_TRUST_VISIT_CONFIG: {
    gifts:[
      {id:'gift_a',npcId:'giver_a',shapeKey:'shapeA'},
      {id:'gift_b',npcId:'giver_b',shapeKey:'shapeB'},
    ],
    bandits:{weaponShapePool:['common','shapeA','shapeB']},
  },
  THREE:{Group},
  Combat:{poses:{SWEEP_POSE:{id:'sweep'}}},
  RangedWeapons:{
    config:{crossbow:{},scatterbow:{},shapeA_bronze:{},shapeB_bronze:{}},
    loaded:[],
    setLoaded(k,v,e){ this.loaded.push([k,v,e.id]); },
  },
  HobunjiRangedWeaponArchetypes:{patchGeneratedDefinitions(){return true;}},
  __farmLog(){},
};
let upstreamDialogue=0, upstreamBandit=0;
for (const [name, counter] of [['DialogueContent','dialogue'],['BanditCombat','bandit']]) {
  let stored;
  Object.defineProperty(windowObject,name,{
    configurable:true, enumerable:true,
    get(){return stored;},
    set(value){
      stored=value;
      if(counter==='dialogue') upstreamDialogue++; else upstreamBandit++;
      Object.defineProperty(windowObject,name,{value:stored,writable:true,configurable:true,enumerable:true});
    }
  });
}
const context = vm.createContext({window:windowObject, console, Object, Array, Set, Math});
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../docs/js/weapon-trust-bandit-loadouts.js'),'utf8'), context);

windowObject.DialogueContent = { init(deps){ this.deps=deps; return 'dialogue-init'; } };
assert.strictEqual(upstreamDialogue,1,'must preserve upstream DialogueContent setter');
assert.strictEqual(windowObject.DialogueContent.init({getNpcRecords:()=>npcRecords}),'dialogue-init');

let rolls=[];
const held = {
  common:{slots:['weapon'],animStyle:'sweep',dmgType:'blunt'},
  shapeA:{slots:['weapon'],animStyle:'thrust',dmgType:'sharp'},
  shapeB:{slots:['weapon'],animStyle:'sweep',dmgType:'blunt'},
};
const toolDefs = {
  common_bronze:{shapeKey:'common',animStyle:'sweep'},
  shapeA_bronze:{shapeKey:'shapeA',animStyle:'thrust'},
  shapeB_bronze:{shapeKey:'shapeB',animStyle:'sweep'},
};
const banditDeps = {
  HELD_SHAPE_DEFS:held, TOOL_ITEM_DEFS:toolDefs,
  VERDIGRIS_METAL_KEYS:['bronze'], METAL_DEFS:{bronze:{tier:1}},
  craftedToolItemKey:(shape,metal)=>`${shape}_${metal}`,
  makeToolPlaneMesh:(key)=>({key,parent:null}),
  rnd:()=>rolls.length?rolls.shift():0,
};
function originalEntity(species, ranged='crossbow', weapon='shapeB_bronze') {
  const s=scene();
  const oldM=new Group(); s.add(oldM);
  const oldR=new Group(); s.add(oldR); oldR.visible=false;
  return {
    id:`bandit-${species}`,isBandit:true,scene:s,
    rosterRecord:{appearance:{speciesId:species}},
    def:{weaponKey:weapon,rangedWeaponKey:ranged,attackTag:'blunt',banditAbilityLoadout:{tap1:'swingCombo',tap2:'qa',hold1:null,hold2:null}},
    _banditToolHolder:oldM,_banditRangedToolHolder:oldR,_rangedMode:false,
  };
}
windowObject.BanditCombat = {
  init(deps){this.deps=deps;return 'bandit-init';},
  async makeEntity(cfg,rank,tier,x,y,opts){ const entity=originalEntity(opts.species, opts.ranged, opts.weapon); Object.assign(entity.def, opts.defOverride || {}); return entity;}
};
assert.strictEqual(upstreamBandit,1,'must preserve upstream BanditCombat setter');
assert.strictEqual(windowObject.BanditCombat.init(banditDeps),'bandit-init');

const gangCfg={rangedWeaponWeightsByRank:{grunt:{crossbow:4,scatterbow:1}}};
(async()=>{
  rolls=[0.9,0.99];
  const a=await windowObject.BanditCombat.makeEntity(gangCfg,'grunt',0,0,0,{species:'species-a',ranged:'crossbow',weapon:'shapeB_bronze'});
  assert.deepStrictEqual(Array.from(windowObject.WeaponTrustBanditLoadouts.allowedMeleeShapes('species-a')),['common','shapeA']);
  assert.strictEqual(a.def.weaponKey,'shapeA_bronze');
  assert.strictEqual(a.def.rangedWeaponKey,'shapeA_bronze');
  assert.strictEqual(a.def.banditAbilityLoadout.tap1,'pokeCombo');
  assert.strictEqual(a._banditToolHolder.children[0].key,'shapeA_bronze');
  assert.strictEqual(a._banditRangedToolHolder.children[0].key,'shapeA_bronze');
  assert.ok(!Object.hasOwn(a._weaponTrustCulturalLoadout.ranged.weights,'shapeB_bronze'));

  rolls=[0.99];
  const unknown=await windowObject.BanditCombat.makeEntity(gangCfg,'grunt',0,0,0,{species:'unknown',ranged:null,weapon:'shapeA_bronze'});
  assert.strictEqual(unknown.def.weaponKey,'common_bronze','unknown species must fail closed to common weapons');
  assert.strictEqual(unknown.def.rangedWeaponKey,null,'must preserve base ranged chance when it failed');

  rolls=[0,0];
  const overridden=await windowObject.BanditCombat.makeEntity(gangCfg,'grunt',0,0,0,{
    species:'species-a',ranged:'crossbow',weapon:'shapeB_bronze',
    defOverride:{weaponKey:'shapeB_bronze',rangedWeaponKey:'scatterbow'}
  });
  assert.strictEqual(overridden.def.weaponKey,'shapeB_bronze','explicit weapon override must be respected');
  assert.strictEqual(overridden.def.rangedWeaponKey,'scatterbow','explicit ranged override must be respected');

  const snap=windowObject.WeaponTrustBanditLoadouts.debugSnapshot();
  assert.strictEqual(snap.culturalSpeciesByShape.shapeA,'species-a');
  assert.strictEqual(snap.culturalSpeciesByShape.shapeB,'species-b');
  console.log('weapon-trust-bandit-loadouts tests passed');
})().catch(err=>{console.error(err);process.exitCode=1;});
