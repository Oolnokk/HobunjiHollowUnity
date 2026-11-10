#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync('docs/'+p,'utf8');
const equipmentSource=read('js/combat/bandit-equipment-pools.js');
const registry=JSON.parse(read('config/statue-author-asset-index.json'));
const bandits=JSON.parse(read('config/bandits/bandit-gang-config.json'));
const speciesIndex=JSON.parse(read('config/species/index.json'));
const trustWindow={};
vm.runInNewContext(read('config/weapon-trust-visits.js'),{window:trustWindow});
const config=trustWindow.WEAPON_TRUST_VISIT_CONFIG;
assert.ok(config?.bandits?.weaponShapePool?.length,'Cultural weapon config must exist');
const win={};
vm.runInNewContext(equipmentSource,{window:win});
const pool=win.HobunjiBanditEquipmentPools;
assert.equal(pool?.version,1,'Shared live bandit/hero pool module must be installed');
const donorNpcs=config.gifts.map(gift=>({id:gift.npcId,appearance:{speciesId:gift.npcId==='jubmir'?'tletingan':gift.npcId==='kzubug'?'mao-ao':'kenkari'}}));
const speciesData=speciesIndex.entries.map(entry=>JSON.parse(read('config/species/'+entry.path.slice(2))));
const supported=speciesData.filter(def=>def.male||def.female);
const metals={nativeCopper:{tier:1},highTinBronze:{tier:4},arsenicalBronze:{tier:5},leadedBronze:{tier:6},tin:{tier:null}};
const validNames=new Set(registry.toolSprites.map(x=>x.path));
const cultural=config.gifts.map(g=>g.shapeKey);
for(const definition of supported){
  const speciesId=definition.speciesId;
  const allowed=pool.allowedMeleeShapes(speciesId,config,donorNpcs,Object.keys(registry.shapeSprites));
  assert.ok(allowed.length,speciesId+' must have at least one legal indexed melee sprite');
  for(const shape of allowed){
    assert.ok(registry.shapeSprites[shape]?.every(file=>validNames.has(file)),
      speciesId+' may only roll repository-indexed sprites');
    for(const gift of config.gifts.filter(g=>g.shapeKey===shape)){
      const donor=donorNpcs.find(n=>n.id===gift.npcId);
      assert.equal(donor?.appearance?.speciesId,speciesId,
        'A species must not inherit a different culture’s trust weapon');
    }
  }
  let roll=0;
  for(let i=0;i<12;i++){
    const hero=pool.rollCaptainHero({
      speciesId,speciesDef:definition,gang:bandits,trust:config,npcs:donorNpcs,
      shapeSprites:registry.shapeSprites,metalDefs:metals,rnd:()=>(((roll++*37)%97)+.5)/98
    });
    assert.equal(hero.npc.appearance.speciesId,speciesId);
    assert.equal(hero.npc.appearance.gender,definition.male?'male':'female');
    assert.ok(allowed.includes(hero.shapeKey),speciesId+' rolled forbidden cultural weapon '+hero.shapeKey);
    assert.ok(hero.spritePaths.every(p=>validNames.has(p)));
    assert.ok(['highTinBronze','arsenicalBronze','leadedBronze'].includes(hero.metalKey),
      'Captain must use actual rank metal tier bounds');
    const genders=definition[hero.gender]||definition.male;
    for(const cosmetic of hero.npc.equippedCosmetics){
      assert.ok(genders.allowedCosmetics?.includes(cosmetic)
        ||bandits.clothingPool.banditExclusiveIds?.includes(cosmetic),
        'Hero must obey bandit species/gender allowedCosmetics: '+speciesId+' '+cosmetic);
    }
  }
}
// Canonical bandit runtime must delegate to this module; a standalone hero is
// not allowed to silently maintain a second wardrobe/weapon whitelist.
assert.match(read('js/combat/combat-bandit.js'),/HobunjiBanditEquipmentPools\.clothingCandidates/);
assert.match(read('js/weapon-trust-bandit-loadouts.js'),/shared\.allowedMeleeShapes/);
const template=read('tools/statue-author/index.html');
for(const id of ['heroSpecies','generateHero','repoAnimation','materialPreset','weaponSpriteSelect','addWeaponSprite','clearWeaponSprites'])
  assert.match(template,new RegExp('id="'+id+'"'),'Missing interactive repository selector '+id);
assert.match(template,/fetchRepoJson\('config\/species\/index\.json'\)/);
assert.match(template,/rankWardrobe\.style\(rolled\.npc/);
assert.match(template,/heroLoadout\.offhandPath/);
assert.match(template,/window\.MetalArmorSystem\?\.decorateAvatarDataWithMetalArmor/);
assert.match(template,/entry\.offhand\?'statue_left_hand'/,'Offhand must not attach to the main weapon');
console.log('PASS Statue Author indexed dropdowns, per-species hero clothing, captain metals, cultural weapon pools and armor rendering integration.');
