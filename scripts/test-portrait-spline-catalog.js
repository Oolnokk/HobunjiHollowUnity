#!/usr/bin/env node
'use strict';
// Node regression: the spline author must discover real repository cosmetics
// from the same central index the Character Studio uses, without asking for JSON uploads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Anchors indexed JSON and PNG lookup to the checkout, never to a browser URL.
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const base = 'https://example.invalid/docs/tools/portrait-spline-author/'; // Same layout as the GitHack preview and static docs/ host.
const indexUrl = new URL('../../config/cosmetics/index.json', base).href;
const ctx = vm.createContext({
  window: {}, document: {
    baseURI: base,
    createElement(kind) {
      assert.equal(kind, 'canvas');
      const calls = [];
      return { width: 0, height: 0, calls, getContext(kind) {
        assert.equal(kind, '2d');
        return { drawImage: (...args) => calls.push(args) };
      } };
    },
  },
  URL,
});
vm.runInContext(read('docs/js/portrait-spline-catalog.js'), ctx, { filename: 'portrait-spline-catalog.js' });
const Catalog = ctx.window.PortraitSplineCatalog;
assert(Catalog, 'catalog helper is loaded in an ordinary standalone editor');
const index = JSON.parse(read('docs/config/cosmetics/index.json'));
const cacheHits = new Map(); // Ensures same shared JSON referenced by male/female indexed entries loads only once per catalog instance.
const fetchJson = async url => {
  cacheHits.set(url, (cacheHits.get(url) || 0) + 1);
  assert(url.startsWith('https://example.invalid/docs/config/cosmetics/'), 'index cannot resolve arbitrary external URLs');
  const source = 'docs/config/cosmetics/' + url.slice('https://example.invalid/docs/config/cosmetics/'.length);
  return JSON.parse(read(source));
};
async function check() {
  const catalog = Catalog.createCatalog(index, fetchJson, indexUrl);
  const species = catalog.species();
  assert(species.some(x => x.value === 'mao-ao'), 'Mao-ao is available in species selector');
  assert(species.some(x => x.value === 'tletingan'), 'Tletingan is available');
  assert(species.some(x => x.value === 'kenkari'), 'Kenkari is available');
  assert(catalog.genders('mao-ao').includes('male') && catalog.genders('mao-ao').includes('female'));
  const male = await catalog.styles('mao-ao', 'male');
  assert.equal(male.failures, 0, 'indexed Mao-ao source files are readable');
  const named = phrase => male.options.find(x => x.entry.id.toLowerCase().includes(phrase));
  assert.equal(named('wildbeard')?.slot, 'facialHair');
  assert.equal(named('braid-l')?.slot, 'hairSideL');
  assert.equal(named('braid-r')?.slot, 'hairSide');
  assert.equal(named('shoulder_length_drape')?.slot, 'hairSide');
  assert(!named('long_ponytail'), 'unsupported rear-only ponytails are omitted rather than mis-rigged');
  const left = named('braid-l');
  assert.equal(Catalog.imageLayers(left.config, 'mao-ao', 'male')[0].name, 'back',
    'back-head slot art is still a valid front-plane side braid');
  assert(Catalog.imageLayers(left.config, 'mao-ao', 'male')[0].url.endsWith('braid-L.png'));
  assert(Catalog.assetUrl('./assets/cosmetics/appearance/mao-ao/headhair/braid-L.png')
    .endsWith('/docs/assets/cosmetics/appearance/mao-ao/headhair/braid-L.png'),
    'sprite assets resolve from docs/ root rather than the selected cosmetic JSON directory');
  const female = await catalog.styles('mao-ao', 'female');
  assert.equal(female.failures, 0);
  assert.equal(cacheHits.get(left.entry.url), 1, 'shared cosmetic JSON is cached between gender changes');
  assert(female.options.some(x => x.entry.id.toLowerCase().includes('braid-l')));
  const hoods = await catalog.hoods();
  assert(hoods.options.some(x => x.entry.path === './facewrap.json'), 'facewrap is discoverable as an indexed hood');
  assert(hoods.options.some(x => x.entry.path === './simple_hood.json'), 'ordinary hoods are discoverable');
  const facewrap = hoods.options.find(x => x.entry.path === './facewrap.json').config;
  assert(facewrap.tags.includes('hides-facial-hair'), 'facewrap beard-hiding metadata survives');
  const maleFacewrap = Catalog.imageLayers(facewrap, 'mao-ao', 'male');
  assert(maleFacewrap.length && maleFacewrap[0].url.includes('/facewrap_m.png'), 'hood variant follows selected gender');
  assert.deepEqual(Object.keys(Catalog.rigScope(facewrap, 'mao-ao', 'male')).sort(), ['key', 'variant']);
  const example = named('wildbeard');
  const imageUrl = new URL(Catalog.imageLayers(example.config, 'mao-ao', 'male')[0].url.replace(/^\.\//, ''), 'https://example.invalid/docs/');
  const localAsset = 'docs/' + imageUrl.pathname.slice('/docs/'.length);
  assert(fs.existsSync(path.join(root, localAsset)), 'indexed beard PNG is actually present');
  const composed = await Catalog.composeArtwork(example.config, 'mao-ao', 'male', 'front', async url => {
    assert(url.startsWith('https://example.invalid/docs/assets/'));
    return { naturalWidth: 64, naturalHeight: 64 };
  });
  assert(composed && composed.width === 200 && composed.height === 200, 'automatic preview uses the logical portrait canvas');
  assert(composed.calls.length > 0, 'hair layers are positioned into the portrait without a manual PNG upload');
  const html = read('docs/tools/portrait-spline-author/index.html');
  for (const id of ['speciesSelect', 'genderSelect', 'slotSelect', 'cosmeticSelect', 'hoodSelect', 'catalogStatus', 'reloadIndex'])
    assert(html.includes('id="' + id + '"'), 'standalone editor exposes '+id);
  assert(html.includes('portrait-spline-catalog.js?v='), 'catalog loader is cache-versioned in editor');
  assert(html.includes('initCatalog();'), 'editor auto-loads on opening');
  assert(html.includes('rigDrafts.set(activeDraftKey'), 'switching cosmetics preserves unsaved rig work');
  assert(html.includes('result.speciesVariants[key]'), 'existing sprite variants export isolated rigs');
  console.log('Indexed portrait spline catalog: species, gender, slots, real sprites, hood variants, caching and author wiring verified.');
}
check().catch(err => { console.error(err); process.exitCode = 1; });
