// Tzizkhanash offerings: one shared, deterministic appraisal for UI, saved blessing and ritual delivery.
// Source probabilities come from ItemAcquisitionRarity (stacked PR #1573), never from a new guessed spawn table.
(() => {
  'use strict';
  const MAX_POWER = 5; // Every targeted fortune shares the established bounded strength scale.
  const qualityBase = stars => 0.5 + Number(stars) * 0.5; // Five-star common items get level three; genuinely scarce offerings earn higher levels.
  const clamp = (value,low,high) => Math.max(low,Math.min(high,value));
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const words = value => String(value || '').toLowerCase();
  function releaseSpecies(key, definition = {}, game = window.SCRATCHBONES_CONFIG?.game) {
    const mapped = game?.livestock?.itemKinds?.[key]; // One legal hatchable egg/baby->species table, already used by farm adoption.
    if (!mapped) return null;
    const tags = Array.isArray(definition.tags) ? definition.tags.map(words) : [];
    const young = tags.includes('baby') || tags.includes('fertile') ||
      /baby$|^fertile.*egg$/i.test(key); // Adult livestock/crates are not juveniles; being tagged Livestock alone never authorizes release.
    return young ? String(mapped) : null;
  }
  function statFor(key, definition = {}, mode = 'burn') {
    if (mode === 'release') return 'breedingFortune'; // Releasing young protects future animal lineages.
    const tags = [definition.cat,definition.category,...(definition.tags || []),...(definition.cookingCategories || [])].map(words).join(' ');
    const name = words(key+' '+(definition.label || '')); // Only fallback evidence when authored categories are missing.
    if (definition.isCookedFood || /cooked|prepared|meal|dish|processed food/.test(tags) || (/broth|stew|meal|soup/.test(name) && definition.foodEffects)) return 'cookingFortune';
    if (/\bfish\b|seafood|angling/.test(tags) || /\bfish\b/.test(name)) return 'fishingFortune';
    if (/\bseed\b|\bcrop\b|vegetable|fruit|grain|produce|farming/.test(tags) || /seed|vegetable/.test(name)) return 'harvestFortune';
    if (/\bore\b|\bmineral\b|\bmetal\b|\bbar\b|\bstone\b|mining|gem/.test(tags) || /ore|ingot|metal bar|gemstone/.test(name)) return 'miningFortune';
    if (/herb|forag(?:e|ing)|wood|timber|mushroom|reagent|wild berry/.test(tags) || /\bwood\b|\bherb\b|mushroom|reagent/.test(name)) return 'foragingFortune';
    if (/weapon|armor|armour|blade|shaft|head|combat|shield|arrow|bow|spear|mace/.test(tags) || /sword|spear|blade|shield|mace|arrow/.test(name)) return 'battleFortune';
    return 'treasureFortune'; // Figurines, keepsakes, curios and unclassified valuables favor treasure discoveries.
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
    const ancestry = mode === 'release' && options.genotype && typeof options.genotype === 'object' ? options.genotype : null; // Exactly selected lineage, not another egg from the same key.
    const geneValue = ancestry ? Number(window.CreatureGenetics?.sellValueFor?.(ancestry,species)?.amount) : NaN; // Reuse the Farm's genetic value model for rare inherited traits.
    const traitFactor = Number.isFinite(geneValue) && geneValue > 0 ? clamp(1 + Math.log1p(geneValue / Math.max(1,value,50)) * 0.18,1,1.35) : 1;
    const raw = qualityBase(quality) * scarcity.factor * valueFactor * effortFactor * traitFactor;
    const level = Math.round(clamp(raw,1,MAX_POWER)*100)/100; // Unlike old quality-only offerings, fractional rarity persists.
    const stat = statFor(key,def,mode);
    return {key,stars:quality,mode,species,stat,level,qualityUnits:qualityBase(quality),
      scarcityFactor:scarcity.factor,traitFactor:Math.round(traitFactor*1000)/1000,valueFactor:Math.round(valueFactor*1000)/1000,
      effortFactor:Math.round(effortFactor*1000)/1000,source:scarcity.kind,sourceLabel:scarcity.label,
      confidence:scarcity.confidence,sourceBreakdown:scarcity.sources,
      statement:mode==='release'?'This exact young animal is released into its native wilderness alive; never placed in the pyre.'
        :'The keepsake is surrendered to the communal pyre. Its kind guides a year of targeted good fortune.'};
  }
  window.FestivalOfferingRitual = Object.freeze({assess,releaseSpecies,statFor,sourceEvidence,qualityBase,MAX_POWER});
})();
