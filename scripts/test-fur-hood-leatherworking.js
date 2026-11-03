  'use strict';
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const root = path.resolve(__dirname, '..'); // Used to exercise the actual committed config and production runtime source.
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const manifest = JSON.parse(read('docs/config/patterns/fur-hoods.json'));
  const cosmetic = JSON.parse(read('docs/config/cosmetics/fur_hood.json'));
  const index = JSON.parse(read('docs/config/cosmetics/index.json'));
  assert(index.entries.some(entry => entry.id === 'fur_hood'), 'new wearable cosmetic is published in portrait registry');
  assert.deepEqual(Object.keys(cosmetic.speciesVariants).sort(), ['mashtzarr_male','tletingan_male']);
  for (const [key, suffix] of Object.entries({ tletingan_male:'tl_m', mashtzarr_male:'mashtz_m' })) {
    const parts = Object.values(cosmetic.speciesVariants[key].parts.head.layers); // Uses real wearer-specific sprites rather than a fine-hood stand-in.
    for (const role of ['base','trim']) {
      const image = parts.find(part => part.layerRole === role)?.image?.url;
      assert(image?.includes('furhood-' + role + '_' + suffix + '.png'), key + ' must use its uploaded fur artwork');
      assert(fs.existsSync(path.join(root, 'docs', image.replace(/^\.\//, ''))), 'missing garment PNG: ' + image);
    }
  }
  for (const [kind, data] of Object.entries(manifest.species)) {
    for (const [variant, parts] of Object.entries(data.parts || {})) {
      assert(['tletingan_male','mashtzarr_male'].includes(variant), 'unsupported wearer art key ' + variant);
      for (const [position, url] of Object.entries(parts)) {
        assert(['front','back'].includes(position), 'unexpected animal piece position');
        assert(fs.existsSync(path.join(root, 'docs', url)), 'missing animal '+kind+' '+position+' '+url);
      }
    }
  }
  const sample = {
    itemKey:'garWolfHide', kind:'gar-wolf', sourceKind:'gar-wolf-alpha', stars:4,
    genotype:{base:{color:'#997755'},spots:{enabled:true,copies:2,color:'#eeddcc'},stripes:{enabled:false,copies:1,color:'#010101'}},
    appearance:{baseColor:'#997755',patterns:[{id:'spots',enabled:true,color:'#eeddcc'}]},
  }; // Both natural color sources must survive a complete hide -> crafted hood snapshot.
  const painted = JSON.parse(JSON.stringify(manifest));
  painted.species['gar-wolf'].patterns.spots = {
    motifPng:'assets/patterns/fur-hoods/sample_spots.png', settings:{tiling:true,scale:1.2},
  }; // A fixture-only authored mark; no real species motiffs are fabricated by the test.
  const window = {
    AnimalHides:{},
    CreatureGenetics:{SPECIES_ALIAS:{'gar-wolf-alpha':'gar-wolf'}},
    portraitVariantKeysForFighter(fighter) {
      return fighter.speciesId === 'nuhongan'
        ? ['nuhongan_female','tletingan_female','tletingan_male']
        : fighter.speciesId === 'kenkari'
        ? ['kenkari_male','mashtzarr_male'] : [fighter.speciesId+'_'+fighter.gender];
    },
  };
  const document = { currentScript:{src:'https://example.test/docs/js/fur-hood-leatherworking.js'} };
  const source = read('docs/js/fur-hood-leatherworking.js');
  vm.runInNewContext(source, {window,document,URL,fetch: async()=>({ok:true,json:async()=>painted})});
  async function main() {
    await window.FurHoodLeatherworking.ensureManifest();
    const fur = window.FurHoodLeatherworking.fromHide(sample);
    assert.equal(fur.kind,'gar-wolf');
    assert.equal(fur.baseColor,'#997755');
    assert.equal(fur.genotype.spots.color,'#eeddcc');
    assert.equal(fur.genotype.stripes.enabled,false);
    assert.equal(window.FurHoodLeatherworking.fromHide({kind:'gar-wolf'}),null,'legacy hides cannot invent genotype');
    assert.equal(window.FurHoodLeatherworking.markingsFor(fur,'trim').length,0,'natural markings never recolor the decorative rim');
    assert.equal(window.FurHoodLeatherworking.markingsFor(fur,'animalFront').length,1,'natural gene marks color the animal face');
    assert.equal(window.FurHoodLeatherworking.markingsFor(fur,'animalBack').length,1,'natural gene marks color the species back hood piece');
    assert.equal(window.FurHoodLeatherworking.markingsFor(fur,'unknown').length,0,'non-fur layers remain untouched');
    const marks = window.FurHoodLeatherworking.markingsFor(fur,'base');
    assert.equal(marks.length,1,'only expressed authored genes are painted');
    assert.equal(marks[0].colorHex,'#eeddcc','genetic color is used instead of Dye C');
    assert.equal(marks[0].pattern.scale,1.2,'dev-authored motif placement is preserved');
    const shuffled=['animalFront','trim','animalBack','base'].map(role=>({role})); // The shared renderer must ignore incoming layer enumeration order.
    assert.deepEqual([...window.FurHoodLeatherworking.orderLayersForView(shuffled,'front')].map(entry=>entry.role),['animalBack','base','animalFront','trim'],'front plane puts animal-back behind hood and animal-front above it');
    assert.deepEqual([...window.FurHoodLeatherworking.orderLayersForView(shuffled,'behind')].map(entry=>entry.role),['trim','animalFront','base','animalBack'],'rear plane puts species-back in front of furhood-behind');
    const hoodConfig=JSON.parse(read('docs/config/cosmetics/fur_hood.json'));
    for(const [key,suffix] of [['tletingan_male','tl_m'],['mashtzarr_male','mashtz_m']]){
      const layers=hoodConfig.speciesVariants[key].parts.head.layers;
      assert(layers.front.behindImage.url.endsWith('furhood-behind_'+suffix+'.png'),'backplane replaces base with dedicated rear art');
      assert(layers.front_trim.behindImage.url.endsWith('furhood-trim_'+suffix+'.png'),'rear plane retains furhood-trim sprite');
      assert(fs.existsSync(path.join(root,'docs',layers.front.behindImage.url)),'rear hood art must be bundled in the feature branch');
    }
    const tl = window.FurHoodLeatherworking.specialPartsFor(fur,'nuhongan','female');
    const mashtz = window.FurHoodLeatherworking.specialPartsFor(fur,'kenkari','male');
    assert.equal(tl.length,2,'inherited Tletingan head sees wolf front and back');
    assert.equal(mashtz.length,2,'inherited Mashtzarr head sees wolf front and back');
    assert(tl.every(part=>part.url.includes('_tl_m.png')),'Tletingan artwork is selected');
    assert(mashtz.every(part=>part.url.includes('_mashtz_m.png')),'Mashtzarr artwork is selected');
    const weaving = read('docs/js/clothing-weaving-system.js');
    const portrait = read('docs/js/portrait-utils.js');
    assert.match(weaving,/furHood: clone\(item\.furHood\)/,'portraits receive genotype apart from weaving');
    assert.match(weaving,/furHood: reweaveItem\?\.furHood/,'player reweave preview retains original natural markings');
    assert.match(weaving,/applyPatternToTintedImage\(decorated, mark\.pattern, mark\.colorHex/,'genotype patterns render under regular weaving');
    assert.match(weaving,/buildPortraitPatternMap\(descriptors, options\?\.portraitView === 'behind' \? 'behind' : 'front', profile\?\.fighter\)/,'portrait animal part lookup must use the actual wearer species and gender');
    assert.match(weaving,/specialPartsFor\?\.\(descriptor\.furHood, wearer\?\.speciesId, wearer\?\.gender\)/,'dynamic animal sprite URLs must be mapped to the portrait tint and pattern pipeline');
    assert.match(weaving,/naturalHoodWeavingRole\(descriptor\.role, descriptor\.furHood\)/,'regular base weaving also follows animal sprites in worn portraits');
    assert.match(weaving,/naturalHoodWeavingRole\(role, furHood\)/,'regular base weaving also follows animal sprites in preview icons');
    assert.match(weaving,/behindGender && role !== 'animalBack' && role !== 'animalFront'/,'both species sprites survive backplane generic hood replacements');
    assert.match(weaving,/orderLayersForView\?\.\(\[\.\.\.iconBaseLayers,\.\.\.extraLayers\],view\)/,'loom and authoring preview share the source-defined view order');
    assert.match(portrait,/orderLayersForView\?\.\(stack,renderBehindView\?'behind':'front'\)/,'both world-avatar planes use the shared layer order');
    assert.match(portrait,/hoodLayers\.push\(\.\.\.\(window\.FurHoodLeatherworking/,'species back is in visible hood layers instead of pre-head rear layers');
    assert.match(portrait,/behindUrl: portraitRelPath\('\.\/' \+ layer\.url\)/,'animal front/back art retains identical URLs on both planes');
    assert.match(read('docs/js/equipment-panel.js'),/furHood: item\.furHood \? JSON\.parse/,'Pack to Gear transfer preserves the literal hide');
    const editor = read('docs/tools/pattern-editor/index.html');
    for (const id of ['furAnimalSpecies','furGeneId','furWearerVariant','furAssignBtn','furDownloadManifestBtn']) {
      assert(editor.includes('id="'+id+'"'), 'missing dev animal pattern tool field '+id);
    }
    console.log('OK: fur-hood leatherworking, real sprites, genotype, authoring and portrait integration');
  }
  main().catch(error => {console.error(error);process.exitCode=1;});
