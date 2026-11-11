// Shared pure species-restricted bandit equipment decisions, also used by
// Statue Author's Captain-style random hero. Gameplay owns the config/pools.
(function (global) {
  'use strict';
  if (global.HobunjiBanditEquipmentPools?.version >= 1) return;
  const weightedPick=(weights,rnd=Math.random)=>{
    const choices=Object.entries(weights||{}).filter(([id,weight])=>!id.startsWith('_')&&Number(weight)>0);
    const total=choices.reduce((sum,[,w])=>sum+Number(w),0);
    if(!total)return null;
    let roll=rnd()*total;
    for(const [id,w] of choices){roll-=Number(w);if(roll<=0)return id;}
    return choices.at(-1)[0];
  };
  function clothingCandidates(speciesDef,gender,slot,poolIds,exclusiveIds){
    const genderData=speciesDef?.[gender]||speciesDef?.male||null;
    const allowed=new Set(genderData?.allowedCosmetics||[]);
    const exclusive=new Set(exclusiveIds||[]);
    const weights=genderData?.cosmeticWeights?.[slot]||null;
    const slotRestriction=genderData?.exclusiveSlotCosmetics?.[slot];
    const result={};
    for(const id of poolIds||[]){
      if(Array.isArray(slotRestriction)&&slotRestriction.length&&!slotRestriction.includes(id))continue;
      if(!allowed.has(id)&&!exclusive.has(id))continue;
      const bare=id.split('::').pop();
      result[id]=Number(weights?.[bare])>0?Number(weights[bare]):1;
    }
    return result;
  }
  function allowedMeleeShapes(speciesId,trustConfig,npcs,validShapes=null){
    const config=trustConfig||{};
    const gifts=(config.gifts||[]).filter(g=>g?.npcId&&g?.shapeKey);
    const cultural=new Set(gifts.map(g=>g.shapeKey));
    const records=Array.isArray(npcs)?npcs:[];
    const speciesByNpc=new Map(records.map(n=>[n?.id,n?.appearance?.speciesId]));
    const allowed=new Set(gifts.filter(g=>speciesByNpc.get(g.npcId)===speciesId).map(g=>g.shapeKey));
    const available=validShapes?new Set(validShapes):null;
    return [...new Set(config.bandits?.weaponShapePool||[])].filter(shape=>
      (!available||available.has(shape))&&(!cultural.has(shape)||allowed.has(shape)));
  }
  function rollCaptainHero({speciesId,speciesDef,gang,trust,npcs,shapeSprites,metalDefs,rnd=Math.random}){
    if(!speciesId||!speciesDef||!gang?.clothingPool||!trust?.bandits)throw Error('Repository bandit and species indexes unavailable');
    const gender=speciesDef.male?'male':speciesDef.female?'female':null;
    if(!gender)throw Error('This species has no authored humanoid appearance');
    const available=allowedMeleeShapes(speciesId,trust,npcs,Object.keys(shapeSprites||{}));
    if(!available.length)throw Error('Selected species has no usable species-legal weapon sprite in the repository index');
    const selectedShape=available[Math.floor(rnd()*available.length)];
    const metalRange=gang.weaponMetalTierRangeByRank?.captain||[4,7];
    const metals=Object.entries(metalDefs||{}).filter(([,m])=>
      Number.isFinite(m?.tier)&&m.tier>=metalRange[0]&&m.tier<=metalRange[1]).map(([k])=>k);
    if(!metals.length)throw Error('No captain-rank metals found in the real armor catalog');
    const metalKey=metals[Math.floor(rnd()*metals.length)];
    const config=gang.clothingPool;
    const outfit=[],cosmeticSlots={},appliedDyes={};
    const slotTints={torso:'TORSO',overwear:'CLOTH',hat:'HAT',hood:'HOOD',mask:'MASK'};
    const usedSlots=new Set();
    const equip=slot=>{
      if(usedSlots.has(slot)||((slot==='hat'||slot==='hood')&&(usedSlots.has('hat')||usedSlots.has('hood'))))return null;
      const choices=clothingCandidates(speciesDef,gender,slot,config.itemsBySlot?.[slot],config.banditExclusiveIds);
      const id=weightedPick(choices,rnd);
      if(!id)return null;
      outfit.push(id);cosmeticSlots[id]=slot;usedSlots.add(slot);
      const variant=config.dyeVariantPool?.[Math.floor(rnd()*config.dyeVariantPool.length)];
      const hue=config.dyeHueFamilyPool?.[Math.floor(rnd()*config.dyeHueFamilyPool.length)];
      if(variant&&hue&&slotTints[slot])appliedDyes[slotTints[slot]]='dye:CLOTH:'+variant+'_'+hue;
      return id;
    };
    // Captain loadout, not a grunt: visibly equipped on as many compatible
    // slots as the selected species has authored cosmetics for.
    equip('overwear');equip('torso');
    if(rnd()<.55) equip('hat');
    if(!usedSlots.has('hat'))equip('hood');
    if(!usedSlots.has('hat')&&!usedSlots.has('hood'))equip('hat');
    const identity='Hero of '+(speciesDef.label||speciesId);
    return {
      npc:{
        id:'statue-hero-'+speciesId+'-'+Math.floor(rnd()*1e9).toString(36),
        name:identity,
        appearance:{speciesId,gender,cosmetics:{},randomSeed:'statue-hero-'+rnd().toString(36).slice(2)},
        equippedCosmetics:outfit,
        cosmeticSlots,appliedDyes,
      },
      shapeKey:selectedShape,metalKey,
      spritePaths:[...(shapeSprites[selectedShape]||[])],
      speciesId,gender,
    };
  }
  global.HobunjiBanditEquipmentPools=Object.freeze({
    version:1,weightedPick,clothingCandidates,allowedMeleeShapes,rollCaptainHero
  });
})(window);
