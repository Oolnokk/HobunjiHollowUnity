// Tzizkhanash offerings: one shared, deterministic appraisal for UI, saved blessing and ritual delivery.
// Source probabilities come from ItemAcquisitionRarity (stacked PR #1573), never from a new guessed spawn table.
(() => {
  'use strict';
  const MAX_POWER = 5; // The established three ancestor buffs still cap at level five.
  const qualityBase = stars => 0.5 + Number(stars) * 0.5; // Five-star common items get level three; genuinely scarce offerings earn higher levels.
  const clamp = (value,low,high) => Math.max(low,Math.min(high,value));
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const words = value => String(value || '').toLowerCase();
  function releaseSpecies(key, definition = {}, game = window.SCRATCHBONES_CONFIG?.game) {
    const mapped = game?.livestock?.itemKinds?.[key]; // One legal hatchable egg/baby->species table, already used by farm adoption.
    if (!mapped) return null;
    const tags = Array.isArray(definition.tags) ? definition.tags.map(words) : [];
    const young = tags.includes('baby') || tags.includes('fertile') || tags.includes('livestock') ||
      /baby$|^fertile.*egg$/i.test(key); // Ordinary edible eggs must never be misclassified as rescued young.
    return young ? String(mapped) : null;
  }
  function statFor(key, definition = {}, mode = 'burn') {
    if (mode === 'release') return 'goodwill'; // Saving a young creature is an act of compassion.
    const evidence = [definition.primaryEffect,definition.stat,definition.statId,
      ...Object.keys(definition.foodEffects || {}),...(definition.tags || []),definition.cat,definition.category,
      definition.label || key].map(words).join(' ');
    const scores = {
      speed: /movement|move|speed|agility|evasion|dodg|quick|travel|escape|sprint|footing|throw|weapon|blade|bow|spear/.test(evidence) ? 2 : 0,
      vigor: /health|stamina|heal|recovery|regen|vigor|farm|food|crop|cook|veget|berry|fish|fruit|strength|breath|growth|endurance/.test(evidence) ? 2 : 0,
      goodwill: /favor|friend|social|affection|gift|keepsake|memori|figurine|charisma|companion|bond|family|love/.test(evidence) ? 2 : 0,
    }; // Explicit item properties and concrete category traits, not a hash or random stat.
    for (const [key,value] of Object.entries(definition.foodEffects || {})) {
      const k = words(key),amount = number(value);
      if (amount === null || amount <= 0) continue;
      if (/favor|friend|social|bond/.test(k)) scores.goodwill += amount;
      else if (/speed|mov|evad|dodge/.test(k)) scores.speed += amount;
      else scores.vigor += amount;
    }
    const ranked = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
    return ranked[0][1] > 0 ? ranked[0][0] : 'goodwill'; // An unfamiliar keepsake is symbolically a bond with the departed.
  }
  function sourceEvidence(key,def,rarity,definitions = {}) {
    if (!rarity) return {factor:1,kind:'unmeasured',label:'No acquisition model loaded',confidence:'unknown',sources:[]};
    const item = rarity.item?.(key,{itemDefs:definitions,townValue:1}) || {};
    const sources = rarity.acquisitionSources?.(key,{townValue:1}) || item.acquisitionRoutes || [];
    const food = rarity.foodRarity?.(key,definitions);
    const entries = []; // Comparable factor candidates, retaining their different unit labels.
    function propose(factor,label,kind,confidence) {
      const x = number(factor);
      if (x !== null && x > 0) entries.push({factor:clamp(x,1,4),label,kind,confidence});
    }
    if (item.kind === 'cultivar' && item.factor)
      propose(item.factor,'Regional seed acquisition and recorded parentage',item.origin,item.origin==='crossbred-or-inherited'?'modeled':'observed');
    if (item.kind === 'imported-spice' && item.factor)
      propose(item.factor,'Slagothim caravan supply on the baseline day','trade','conditional');
    if (item.kind === 'fish' && item.rarity?.factor)
      propose(item.rarity.factor,'Fish seasonal and catch-weight difficulty','fishing','conditional');
    if (food?.factor > 1)
      propose(food.factor,'Inherited ingredient supply rarity','ingredients',food.known?'observed':'modeled');
    const available = sources.filter(row=>row && row.probability > 0 && row.probability <= 1);
    const pools = ['loot','artifact','foraging','foraging-reagent','trade'];
    const best = available.filter(row=>pools.includes(row.kind)).reduce((acc,row)=>!acc || row.probability > acc.probability ? row : acc,null);
    if (best && !entries.length) {
      const reference = best.kind === 'trade' ? .15 : best.kind === 'artifact' ? .25 : .5;
      propose(rarity.rarityFactor?.(best.probability,{reference,exponent:.3,cap:4}),
        best.label || best.sourceId || 'Recorded source draw',best.kind,'conditional');
    }
    // All routes are conditional on distinct opportunities: do not multiply separate chest, fish, caravan and shop odds together.
    const selected = entries.reduce((winner,row)=>!winner || row.factor > winner.factor ? row : winner,null);
    return selected ? {...selected,sources:sources.slice(0,12)} :
      {factor:1,kind:'unmeasured',label:'No quantified acquisition route; a neutral factor applies',
        confidence:'unknown',sources:sources.slice(0,12)};
  }
  function assess(key,stars,definitions={},options={}) {
    const quality = Number(stars);
    const def = definitions?.[key];
    if (!key || !def || !Number.isInteger(quality) || quality < 1 || quality > 5)
      return null; // UI and world action cannot award blessings for invalid inventory/quality selections.
    const species = releaseSpecies(key,def,options.game);
    const mode = species ? 'release' : 'burn';
    const scarcity = sourceEvidence(key,def,options.rarity || window.ItemAcquisitionRarity,definitions);
    const value = Math.max(0,number(def.sellPrice) || 0);
    const valueFactor = Math.min(1.55,1 + Math.log1p(value/25)*.09); // Economic cost of foregoing a valuable, nonrenewable keepsake.
    const processTier = clamp(number(def.cookingProcessingTier ?? def.processingTier) || 0,0,6);
    const effortFactor = 1 + Math.min(0.5,processTier * .12); // Only recorded recipe steps contribute a modest labor premium.
    const raw = qualityBase(quality) * scarcity.factor * valueFactor * effortFactor;
    const level = Math.round(clamp(raw,1,MAX_POWER)*100)/100; // Unlike old quality-only offerings, fractional rarity persists.
    const stat = statFor(key,def,mode);
    return {key,stars:quality,mode,species,stat,level,qualityUnits:qualityBase(quality),
      scarcityFactor:scarcity.factor,valueFactor:Math.round(valueFactor*1000)/1000,
      effortFactor:Math.round(effortFactor*1000)/1000,source:scarcity.kind,sourceLabel:scarcity.label,
      confidence:scarcity.confidence,sourceBreakdown:scarcity.sources,
      statement:mode==='release'?'A young creature is taken to compatible wilderness alive; never placed in the pyre.'
        :'The keepsake is surrendered to the communal pyre. Its meaning shapes a year-long ancestor blessing.'};
  }
  window.FestivalOfferingRitual = Object.freeze({assess,releaseSpecies,statFor,sourceEvidence,qualityBase,MAX_POWER});
})();
