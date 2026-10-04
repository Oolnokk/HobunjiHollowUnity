'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/mammakhbuur-species-runtime.js', 'utf8'); // Executes the shipping Mammakhbuur runtime instead of duplicating its comparison logic.

class FakeHeaders { // Preserves the minimal response-header API used by the Animation Author fetch adapter.
  constructor(source = {}) { this.values = { ...(source?.values || source || {}) }; }
  set(key, value) { this.values[String(key).toLowerCase()] = String(value); }
}
class FakeResponse { // Supplies clone/json semantics without depending on Node's built-in fetch implementation.
  constructor(body, options = {}) {
    this.body = String(body ?? '');
    this.status = options.status ?? 200;
    this.statusText = options.statusText ?? 'OK';
    this.headers = options.headers instanceof FakeHeaders ? options.headers : new FakeHeaders(options.headers);
    this.ok = this.status >= 200 && this.status < 300;
  }
  clone() { return new FakeResponse(this.body, { status: this.status, statusText: this.statusText, headers: this.headers }); }
  async json() { return JSON.parse(this.body); }
}

const donorProfile = gender => ({ // Provides the same per-gender Mashtzarr profile shape Mammakhbuur clones at runtime.
  species: 'mashtzarr',
  gender,
  anatomy: { portraitVerticalPlacementRatio: 1 },
  shoulderPerchRule: { appearanceSpeciesId: 'mashtzarr' },
  posteriorRule: { appearanceSpeciesId: 'mashtzarr' },
});
const npc = (id, species, gender) => ({ // Builds compact representative records sufficient for Full Character Scale selection.
  id,
  name: id,
  species: species === 'mammakhbuur' ? 'Mammakhbuur' : 'Mashtzarr',
  gender,
  ageBand: 'adult',
  appearance: { speciesId: species, gender, cosmetics: {}, bodyColors: {} },
  avatarEditor: { rawExport: { appearance: { speciesId: species, gender, cosmetics: {}, bodyColors: {} } } },
});
const authoredDatabase = { // Contains the real-world situation being guarded: male Mammakhbuur exists, female does not.
  npcs: [
    npc('mashtzarr_male_reference', 'mashtzarr', 'male'),
    npc('mashtzarr_female_reference', 'mashtzarr', 'female'),
    npc('khannibarri_agent', 'mammakhbuur', 'male'),
  ],
};
const document = { body: { dataset: { animationAuthorMode: 'multi' } } }; // Lets the runtime switch behavior exactly when Full Character Scale becomes active.
const location = { pathname: '/tools/animation-author/index.html', href: 'https://example.test/tools/animation-author/index.html' }; // Activates only the Animation Author-specific adapter.
const windowObject = { // Supplies the shared registries Mammakhbuur extends in the real Animation Author bootstrap.
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: {
        species: { mashtzarr: { label: 'Mashtzarr', genders: ['male', 'female'] } },
        bodyPalettes: { mashtzarr: { A: {} } },
      },
      assets: { pngPlaneAvatar: { proceduralFeet: {} } },
    },
  },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: {
    characters: {
      'mashtzarr::male': donorProfile('male'),
      'mashtzarr::female': donorProfile('female'),
    },
  },
  HobunjiHandModelProfiles: { data: { speciesModels: { mashtzarr: 'mashtzarr' } }, mutate(fn) { fn(this.data); } },
  applyHobunjiAttachmentRigProfileCorrections() {},
  hobunjiTransformSpeciesId(value) { return value === 'mammakhbuur' ? 'mashtzarr' : value; },
  async fetch() { return new FakeResponse(JSON.stringify(authoredDatabase), { headers: { 'content-type': 'application/json' } }); },
};
const context = vm.createContext({ // Makes browser globals explicit so the test catches accidental reliance on unrelated page state.
  window: windowObject,
  document,
  location,
  URL,
  Response: FakeResponse,
  Headers: FakeHeaders,
  console,
});
vm.runInContext(source, context, { filename: 'docs/js/mammakhbuur-species-runtime.js' });

(async () => {
  assert(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['mammakhbuur::male'], 'male Mammakhbuur rig profile must be registered');
  assert(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['mammakhbuur::female'], 'female Mammakhbuur rig profile must be registered');
  assert.equal(windowObject.hobunjiTransformSpeciesId('mammakhbuur'), 'mashtzarr', 'ordinary Animation Author modes must retain the shared Mashtzarr transform alias');

  document.body.dataset.animationAuthorMode = 'scale-compare';
  assert.equal(windowObject.hobunjiTransformSpeciesId('mammakhbuur'), 'mammakhbuur', 'Full Character Scale must preserve Mammakhbuur as a distinct lineup identity');
  assert.equal(windowObject.hobunjiTransformSpeciesId('mashtzarr'), 'mashtzarr', 'Mashtzarr must remain independently addressable beside Mammakhbuur');

  const response = await windowObject.fetch('https://example.test/config/npcs/hobunji-starter-npc-database.json'); // Exercises the exact comparison database path intercepted by the adapter.
  const data = await response.json();
  const mammakh = data.npcs.filter(record => record.appearance?.speciesId === 'mammakhbuur'); // Proves both genders reach the lineup without adding a shipping NPC.
  assert.equal(mammakh.length, 2);
  assert(mammakh.some(record => record.id === 'khannibarri_agent' && record.gender === 'male'), 'real male Harkhanash must remain the male representative');
  const female = mammakh.find(record => record.gender === 'female'); // Verifies the preview-only donor is retargeted all the way through Character Studio appearance data.
  assert(female);
  assert.equal(female.id, 'full_scale_mammakhbuur_female_preview');
  assert.equal(female.avatarEditor.rawExport.appearance.speciesId, 'mammakhbuur');

  document.body.dataset.animationAuthorMode = 'multi';
  const untouched = await (await windowObject.fetch('https://example.test/config/npcs/hobunji-starter-npc-database.json')).json(); // Confirms the synthetic representative cannot leak outside Full Character Scale.
  assert.equal(untouched.npcs.length, authoredDatabase.npcs.length);
  assert.equal(windowObject.HobunjiMammakhbuurSpecies.debugSnapshot().fullCharacterScaleDistinctIdentity, true);
  console.log('Mammakhbuur Full Character Scale distinct-identity and representative fallback checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
