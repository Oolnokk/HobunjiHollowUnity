'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');
const sha = '3d5f158c90f54ff142eca4ed1d72cbe36a93784e';
const cdn = `https://cdn.jsdelivr.net/gh/Oolnokk/HobunjiHollowUnity@${sha}/`;
const raw = `https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/${sha}/`;
async function probe(blockedHost, base) {
  const requests = [], images = [];
  let blockAllSpecies = false;
  class ImageMock {
    constructor() { this.width = this.naturalWidth = 4; this.height = this.naturalHeight = 4; }
    set src(url) {
      images.push(url);
      assert.equal(this.crossOrigin, 'anonymous');
      if (new URL(url).hostname === blockedHost) this.onerror(); else this.onload();
    }
  }
  const window = { location: { href: 'https://editor.test/index.html' }, SCRATCHBONES_CONFIG: { game: {} } };
  const context = vm.createContext({window,URL,Image:ImageMock,document:{baseURI:window.location.href},console:{warn(){}},fetch:async(url)=>{
    requests.push(url);
    const u = new URL(url);
    if (u.hostname === blockedHost || (blockAllSpecies && u.pathname.endsWith('/engh-sho.json'))) return {ok:false,status:403};
    assert(u.href.startsWith(cdn)||u.href.startsWith(raw), 'never switch repository, revision or main');
    const relative = u.href.startsWith(cdn) ? u.href.slice(cdn.length) : u.href.slice(raw.length);
    if(relative==='docs/config/cosmetics/index.json')return {ok:true,json:async()=>({entries:[{id:'hachutu_binding_mask_ii',path:'./clothes/masks/hachutu_binding_mask_ii.json'}]})};
    if (!fs.existsSync(relative))return {ok:false,status:404};
    return {ok:true,json:async()=>JSON.parse(fs.readFileSync(relative,'utf8'))};
  }});
  vm.runInContext(source,context);
  const cosmetics = await window.loadPortraitCosmetics(base+'docs/config/');
  assert.equal(window.portraitSpeciesLoadSnapshot().phase,'ready');
  assert(window.portraitSpeciesLoadSnapshot().fighters.includes('engh-sho:male'));
  const mask = cosmetics.optionCache.get('hachutu_binding_mask_ii');
  assert(mask.variantLayers['mao-ao_male'].some(layer=>layer.pixelDyeOnly && layer.paletteColorKey==='C'), 'mask and its third dye survive mirror failover');
  assert(requests.some(url=>url.endsWith('/species/engh-sho.json') && new URL(url).hostname!==blockedHost));
  context.setPortraitAssetBase(base+'docs/assets/');
  await vm.runInContext("loadImg('cosmetics/clothes/masks/bindingmask_2_m.png')",context);
  assert.equal(images.length,2,'image fetch also retries the same path on the other host');
  assert.equal(images[0].slice(images[0].indexOf('/docs/')),images[1].slice(images[1].indexOf('/docs/')));
  assert(!requests.some(url=>url.includes('/main/')||url.includes('@main/')));
  blockAllSpecies=true;
  await assert.rejects(window.loadPortraitCosmetics(base+'docs/config/'),/HTTP 403/,'failure of both mirrors rejects incomplete species data');
  assert.equal(window.portraitSpeciesLoadSnapshot().phase,'failed');
}
(async()=>{
  await probe('cdn.jsdelivr.net',cdn);
  await probe('raw.githubusercontent.com',raw);
  console.log('Portrait repository failover: JSON index, species, cosmetics, C dye and CORS images recover on the same revision; dual failure rejects');
})().catch(error=>{console.error(error);process.exitCode=1});
