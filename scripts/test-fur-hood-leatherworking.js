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
  const expectedNelkBack='assets/cosmetics/clothes/hood/furhood_nelk-back_tl_m.png'; // Shipped Tletingan rear sprite must be present and correctly resolved.
  assert.deepEqual(manifest.pendingAssets,[],'All authored fur-hood assets must be present');
  assert.equal(manifest.species.nelk.parts.tletingan_male.back,expectedNelkBack,'Nelk Tletingan back is connected to the shipped PNG');
  assert.equal(manifest.species.nelk.parts.mashtzarr_male.back,'assets/cosmetics/clothes/hood/furhood_nelk-back_mashtz_m.png','Mashtzarr keeps the renamed real art');
  for (const variant of ['tletingan_male', 'mashtzarr_male']) {
    const grehlrParts = manifest.species.grehlr.parts[variant]; // Ensures both authored Grehlr fits keep the face but no longer attach the rear animal overlay.
    assert(grehlrParts.front?.includes('furhood_grehlr-front_'), variant + ' must retain the Grehlr front artwork');
    assert.equal(grehlrParts.back, undefined, variant + ' must omit the Grehlr-specific rear sprite');
    assert(manifest.species['gar-wolf'].parts[variant].back, variant + ' other animals must retain their rear artwork');
  }
  assert(index.entries.some(entry => entry.id === 'fur_hood'), 'new wearable cosmetic is published in portrait registry');
  assert.deepEqual(Object.keys(cosmetic.speciesVariants).sort(), ['mashtzarr_female','mashtzarr_male','tletingan_male']);
  // Mashtzarr females reuse the male fur art (as they did through fallback) but carry their own exposed ear/tusk/trunk.
  const mashF = cosmetic.speciesVariants.mashtzarr_female.parts.head.layers;
  for (const role of ['base','trim'])
    assert.equal(Object.values(mashF).find(part => part.layerRole === role)?.image?.url,
      Object.values(cosmetic.speciesVariants.mashtzarr_male.parts.head.layers).find(part => part.layerRole === role)?.image?.url);
  for (const part of ['ear','tusk','trunk'])
    assert(mashF['front_exposed_' + part]?.image?.url?.includes('/mashtzarr-f/exposed_' + part + '.png'), 'female fur hood shows female ' + part);
  for (const [key, suffix] of Object.entries({ tletingan_male:'tl_m', mashtzarr_male:'mashtz_m' })) {
    const parts = Object.values(cosmetic.speciesVariants[key].parts.head.layers); // Uses real wearer-specific sprites rather than a fine-hood stand-in.
    for (const role of ['base','trim']) {
      const image = parts.find(part => part.layerRole === role)?.image?.url;
      // The uploaded sprite, or a clothing-fitter refit of it (furhood-base_mashtz_mashtzarr_m.png).
      const fitted = suffix.replace(/_(m|f)$/, '_' + key.split('_')[0] + '_$1');
      assert(image?.endsWith('furhood-' + role + '_' + suffix + '.png') || image?.endsWith('furhood-' + role + '_' + fitted + '.png'), key + ' must use its uploaded fur artwork: ' + image);
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
  assert.match(source, /config\/patterns\/fur-hoods\.json\?v=[A-Za-z0-9_-]+/, 'fur-hood runtime must request a versioned animal sprite manifest');

  // UI regressions: keep the large composited sprite inside the dedicated preview card
  // and make both configured controller Menu/Cancel actions close the same dialog.
  const controllerUi = read('docs/js/controller-ui-nav.js'); // Establishes the existing remappable semantic menu actions used by Leatherworking.
  assert(source.includes("overlay.setAttribute?.('data-ctrl-panel', '')"), 'leatherworking must register with the universal controller menu navigator');
  assert(source.includes('data-action="close" data-ctrl-cancel'), 'controller Cancel/Menu must click the Leatherworking close button');
  assert(source.includes('furhood-preview-card') && source.includes('furhood-layout'), 'leatherworking must have its own preview layout');
  assert(source.includes('object-fit:contain') && source.includes('overflow:hidden'), 'hood artwork must stay contained on wide and mobile screens');
  assert(source.includes("previewImage.src = rendered.canvas.toDataURL('image/png')"), 'preview must reuse the canonical rendered clothing layers');
  assert(!source.includes('<canvas data-view="preview"'), 'raw unbounded canvas must not be displayed directly in the modal');
  assert(source.includes("window.addEventListener('keydown', closeKeyHandler, true)") && source.includes("window.removeEventListener('keydown', closeKeyHandler, true)"), 'Escape listener must be scoped to the open dialog');
  assert(controllerUi.includes('if (actionPressed(UI_ACTIONS.cancel, cancelDown)) cancel();'), 'controller Cancel must route to the active menu cancel button');
  assert(controllerUi.includes('if (actionPressed(UI_ACTIONS.open, openDown)) cancel();'), 'controller Menu must route to the active menu cancel button');

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
    const portraitSource=fs.readFileSync(path.join(root,'docs/js/portrait-utils.js'),'utf8');
    const roleSource=portraitSource.slice(portraitSource.indexOf('function furHoodStackRole('),portraitSource.indexOf('function furHoodProfileLayers('));
    const furHoodStackRole=new Function(roleSource+'\nreturn furHoodStackRole;')();
    const mashHoodLayers=[{paletteColorKey:'A',layerRole:'base'},{paletteColorKey:'BODY',layerRole:'exposedSkin'},{paletteColorKey:'B',layerRole:'trim'},{paletteColorKey:'NONE',layerRole:'exposed'},{paletteColorKey:'BODY',layerRole:'exposedSkin'}];
    assert.deepEqual(mashHoodLayers.map((layer,index)=>furHoodStackRole(layer,index,mashHoodLayers)),['base','exposedUnderTrim','trim','exposed','exposed'],'crafted fur hoods keep the authored ear/tusk/trunk placement');
    const anatomySource=portraitSource.slice(portraitSource.indexOf('const _BORROWED_ANATOMY_CACHE'),portraitSource.indexOf('function resolveBeardHoodAuthoring('));
    const withoutBorrowedAnatomy=new Function('_normalizeSpeciesKey','_speciesParentChain',anatomySource+'\nreturn _withoutBorrowedAnatomy;')(
      id=>String(id||'').toLowerCase(),id=>({mammakhbuur:['mashtzarr'],rakakoan:['kenkari']})[id]||[]);
    const mashLayers=[{layerRole:'base'},{layerRole:'exposedSkin'},{layerRole:'trim'},{layerRole:'exposed'}];
    assert.equal(withoutBorrowedAnatomy(mashLayers,'mashtzarr_male',{speciesId:'mashtzarr'}),mashLayers,'own variant keeps its anatomy');
    assert.equal(withoutBorrowedAnatomy(mashLayers,'mashtzarr_male',{speciesId:'mammakhbuur'}),mashLayers,'child species keeps parent anatomy');
    const borrowed=withoutBorrowedAnatomy(mashLayers,'mashtzarr_male',{speciesId:'kenkari'});
    assert.deepEqual(borrowed.map(layer=>layer.layerRole),['base','trim'],'a fallback-group neighbour never inherits another species\' trunk/ear/tusk');
    assert.equal(withoutBorrowedAnatomy(mashLayers,'mashtzarr_male',{speciesId:'rakakoan'}),borrowed,'filtered layers are cached, not reallocated per render');
    const withAnatomy=['exposed','animalFront','trim','exposedUnderTrim','animalBack','base'].map(role=>({role}));
    assert.deepEqual([...window.FurHoodLeatherworking.orderLayersForView(withAnatomy,'front')].map(entry=>entry.role),['animalBack','base','animalFront','exposedUnderTrim','trim','exposed'],'wearer ear sits under the trim, tusk/trunk over every fur piece');
    assert.deepEqual([...window.FurHoodLeatherworking.orderLayersForView(withAnatomy,'behind')].map(entry=>entry.role),['exposed','exposedUnderTrim','trim','animalFront','base','animalBack'],'wearer face anatomy is hidden behind the hood from the rear');
    const portraitSource=read('docs/js/portrait-utils.js');
    assert(portraitSource.includes("entry.role === 'trim' || entry.layer?.layerRole === 'trim'")&&/head:\s+\(\) => \{\s*drawRearHoodTrim\(\);/.test(portraitSource),'every hood trim is drawn behind the head in the rear view');
    assert(read('docs/js/portrait-utils.js').includes("if(furData||isFurHood){"),'a plain (uncrafted) Fur Hood uses the crafted stack order, so its trim sits under the rear shell');
    const hoodConfig=JSON.parse(read('docs/config/cosmetics/fur_hood.json'));
    for(const [key,suffix] of [['tletingan_male','tl_m'],['mashtzarr_male','mashtz_m']]){
      const layers=hoodConfig.speciesVariants[key].parts.head.layers;
      // Uploaded art, or its clothing-fitter refit (e.g. furhood-behind_mashtz_mashtzarr_m.png).
      const fitted=suffix.replace(/_(m|f)$/,'_'+key.split('_')[0]+'_$1');
      const isArt=(url,stem)=>url.endsWith(stem+'_'+suffix+'.png')||url.endsWith(stem+'_'+fitted+'.png');
      assert(isArt(layers.front.behindImage.url,'furhood-behind'),'backplane replaces base with dedicated rear art: '+layers.front.behindImage.url);
      assert(isArt(layers.front_trim.behindImage.url,'furhood-trim'),'rear plane retains furhood-trim sprite: '+layers.front_trim.behindImage.url);
      assert(fs.existsSync(path.join(root,'docs',layers.front.behindImage.url)),'rear hood art must be bundled in the feature branch');
    }
    assert.equal(window.FurHoodLeatherworking.isPendingAsset(expectedNelkBack),false,'newly imported Nelk rear image is no longer pending');
    assert.equal(window.FurHoodLeatherworking.isPendingAsset('assets/cosmetics/clothes/hood/furhood_nelk-front_tl_m.png'),false,'uploaded Nelk front must not be silently skipped');
    assert.equal(window.FurHoodLeatherworking.isPendingAsset('./'+expectedNelkBack),false,'docs-relative URLs resolve the nonpending Nelk art');
    assert.equal(window.FurHoodLeatherworking.isPendingAsset(expectedNelkBack.replace(/^assets\//,'')),false,'loadImg-relative path is no longer an exception');
    assert.equal(window.FurHoodLeatherworking.isPendingAsset('./'+expectedNelkBack.replace(/^assets\//,'')),false,'relative stripped image path is no longer an exception');
    assert.equal(window.FurHoodLeatherworking.isPendingAsset('https://example.test/docs/'+expectedNelkBack),false,'absolute hosted path is no longer an exception');
    assert.equal(window.FurHoodLeatherworking.isPendingAsset('cosmetics/clothes/hood/furhood_nelk-back_mashtz_m.png'),false,'existing Nelk artwork is never treated as pending');
    const tl = window.FurHoodLeatherworking.specialPartsFor(fur,'nuhongan','female');
    const mashtz = window.FurHoodLeatherworking.specialPartsFor(fur,'kenkari','male');
    assert.equal(tl.length,2,'inherited Tletingan head sees wolf front and back');
    assert.equal(mashtz.length,2,'inherited Mashtzarr head sees wolf front and back');
    assert(tl.every(part=>part.url.includes('_tl_m.png')),'Tletingan artwork is selected');
    assert(mashtz.every(part=>part.url.includes('_mashtz_m.png')),'Mashtzarr artwork is selected');
    const grehlr = { kind:'grehlr', genotype:{base:{color:'#997755'}}, baseColor:'#997755' }; // Uses a normal crafted-hood shape to validate production special-part selection.
    for (const [species, gender] of [['nuhongan', 'female'], ['kenkari', 'male']]) {
      const parts = window.FurHoodLeatherworking.specialPartsFor(grehlr, species, gender); // The same resolver supplies both worn portraits and the loom preview.
      assert.equal(parts.length, 1, species + ' Grehlr fur hood must contain only the animal-front sprite');
      assert.equal(parts[0].role, 'animalFront', species + ' must not render a Grehlr animalBack overlay');
      assert(parts[0].url.includes('furhood_grehlr-front_'), species + ' Grehlr face art must remain present');
    }
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
    assert.match(weaving,/if\(furHood && furApi\?\.isPendingAsset\?\.\(url\)\)continue/,'an explicitly pending piece does not break the rest of the hood preview');
    assert.match(weaving,/orderLayersForView\?\.\(\[\.\.\.iconBaseLayers,\.\.\.extraLayers\],view\)/,'loom and authoring preview share the source-defined view order');
    assert.match(portrait,/orderLayersForView\?\.\(stack,renderBehindView\?'behind':'front'\)/,'both world-avatar planes use the shared layer order');
    assert.match(portrait,/hoodLayers\.push\(\.\.\.\(window\.FurHoodLeatherworking/,'species back is in visible hood layers instead of pre-head rear layers');
    assert.match(portrait,/behindUrl: portraitRelPath\('\.\/' \+ layer\.url\)/,'animal front/back art retains identical URLs on both planes');
    assert.match(read('docs/js/equipment-panel.js'),/furHood: item\.furHood \? JSON\.parse/,'Pack to Gear transfer preserves the literal hide');
    const editor = read('docs/tools/pattern-editor/index.html');
    assert.match(editor, /fetch\('\.\.\/\.\.\/config\/patterns\/fur-hoods\.json\?v=[A-Za-z0-9_-]+'\)/, 'pattern editor must load a fresh authored fur-hood manifest');
    for (const id of ['furAnimalSpecies','furGeneId','furWearerVariant','furAssignBtn','furDownloadManifestBtn']) {
      assert(editor.includes('id="'+id+'"'), 'missing dev animal pattern tool field '+id);
    }
    console.log('OK: fur-hood leatherworking, real sprites, genotype, authoring and portrait integration');
  }
  main().catch(error => {console.error(error);process.exitCode=1;});
