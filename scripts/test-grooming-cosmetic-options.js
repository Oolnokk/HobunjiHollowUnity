'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// A returning save skips the initial character creator, so species bridges
// have already retired their Object.entries interceptions when grooming opens.
const noop = () => {};
let overlay = null; // Captures the real creator's current rendered DOM for each grooming visit.
const listeners = new Map(); // Delivers the same player-ready event that retires startup-only species hooks.
const button = () => ({ listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, click() { this.listeners.click?.(); } });
const document = {
  documentElement: { classList: { add: noop, remove: noop } },
  body: { appendChild(node) { overlay = node; } },
  getElementById(id) { return id === 'ob-overlay' ? overlay : null; },
  createElement() {
    const root = { classList: { add: noop }, start: button(), cancel: button(),
      querySelectorAll: () => [], querySelector(sel) {
        if (sel === '#ob-start-btn') return this.start;
        if (sel === '#ob-cancel-btn') return this.cancel;
        return null;
      },
      remove() { overlay = null; },
    };
    return root;
  },
  addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
  dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
};
const femaleTuft = 'appearance::Tletingan_F::tl_forwardtuft_short'; // Real authored slot value expected in both female Tletingan and Nuhongan grooming.
const grandBeard = {
  mao: 'appearance::Mao-ao_M::mao-ao_grandbeard',
  tletingan: 'appearance::Tletingan_M::tl_grandbeard',
  kenkari: 'appearance::Kenkari_M::kenk_grandbeard',
  mashtzarr: 'appearance::Mashtzarr_M::mashtz_grandbeard',
}; // Four authored beard assets reused by both parent species and playable male subspecies.
const window = {
  FarmWorldSettings: { normalize: () => ({}) },
  randomPortraitProfileSeeded: () => null, getPortraitFighters: () => [], // Existing female-Mashtzarr guard needs no retry timer.
  SCRATCHBONES_CONFIG: { game: { appearanceEditor: {
    bodyPalettes: { tletingan: { female: [{ h: 5, s: -0.4, v: -0.2 }] }, mashtzarr: { female: [{ h: 10, s: -0.4, v: -0.3 }] } },
    species: {
      tletingan: { genders: ['male', 'female'], female: { slots: [
        { slot: 'hairFront', label: 'Front Hair', options: [
          { id: null, label: 'None' }, { id: femaleTuft, label: 'Female Forward Tuft' },
        ] },
      ] } },
      mashtzarr: {
        male: { slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [{ id: null, label: 'None' }, { id: 'appearance::Mao-ao_M::mao-ao_tuft', label: 'Tuft' }] },
          { slot: 'facialHair', label: 'Facial Hair', options: [{ id: null, label: 'None' }, { id: grandBeard.mashtzarr, label: 'Grand Beard' }] },
        ] },
        female: { slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null, label: 'None' }, { id: 'appearance::Mao-ao_F::mao-ao_tuft', label: 'Female Hair' },
          ] },
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null, label: 'None' }, { id: 'appearance::Mao-ao_F::mao-ao_long_ponytail', label: 'Long Ponytail' },
          ] },
        ] },
      },
      rakakoan: {
        label: "Rakako'an", parentSpecies: 'kenkari', genders: ['male', 'female'],
        male: { slots: [
          { slot: 'upperFace', label: 'Rakako\'an Eyepatch', options: [{ id: 'appearance::Rakakoan_M::rakakoan_woven_eyepatch', label: 'Woven Eyepatch' }] },
          { slot: 'facialHair', label: 'Facial Hair', options: [{ id: null, label: 'None' }, { id: grandBeard.kenkari, label: 'Grand Beard' }] },
        ] },
        female: { slots: [{ slot: 'upperFace', label: 'Rakako\'an Eyepatch', options: [{ id: 'appearance::Rakakoan_F::rakakoan_woven_eyepatch', label: 'Woven Eyepatch' }] }] },
      },
    },
  } } },
};
const context = vm.createContext({ window, document, console, setTimeout: (fn, delay) => { if (delay >= 400) fn(); return 1; }, CustomEvent: class {
  constructor(type, options) { this.type = type; this.detail = options?.detail; }
} });
for (const path of ['docs/onboarding-core.js', 'docs/js/nuhongan-species-runtime.js', 'docs/js/onboarding-character-creation-mashtzarr-female.js']) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
}
document.dispatchEvent({ type: 'hobunjiPlayerReady' }); // No first-creator render: exactly the returning-player startup path.
assert.equal(window.HobunjiNuhonganSpecies.debugSnapshot().creatorPrivateSpeciesTableCaptured, false);
assert.equal(window.hobunjiOnboardingMashtzarrFemale.speciesTableCaptured, false);

const api = window.HobunjiOnboarding;
function verifyGrooming(speciesId, gender, expectedLabel, selectedId, slot = 'hairFront', forbiddenSlot = null) {
  const appearance = { speciesId, gender, cosmetics: selectedId ? { [slot]: selectedId } : {},
    bodyColors: { A: { h: 12, s: -0.1, v: -0.2 }, B: { h: 15, s: -0.3, v: -0.4 } } }; // Saved identity and colors must remain stable.
  let applied = null; // Receives the actual Apply result without modifying the character save.
  assert.equal(api.openCreator({ mode: 'grooming', cosmeticsOnly: true, speciesId, gender, appearance,
    resolvedProfile: selectedId ? { [slot]: { id: selectedId } } : {},
    onComplete: result => { applied = result; } }), true);
  assert.doesNotMatch(overlay.innerHTML, /None available\./, `${speciesId}/${gender} must show usable options`);
  assert.match(overlay.innerHTML, new RegExp(expectedLabel));
  assert.match(overlay.innerHTML, new RegExp('data-ob-slot="' + slot + '"'));
  if (selectedId) assert(overlay.innerHTML.includes('value="' + selectedId + '" selected'), 'the actual authored cosmetic ID must be selected in the visible menu');
  if (gender === 'female') assert.doesNotMatch(overlay.innerHTML, /Grand Beard/, 'female characters have no authored Grand Beard option');
  if (speciesId === 'rakakoan') assert.match(overlay.innerHTML, /class="ob-sel-btn ob-active" data-ob-species="rakakoan"/, 'Rakako\'an preview needs a selected real species button');
  if (forbiddenSlot) assert.doesNotMatch(overlay.innerHTML, new RegExp('data-ob-slot="' + forbiddenSlot + '"'), 'forbidden cosmetic must remain absent');
  assert.equal(api.creatorSessionInfo().cosmeticsOnly, true);
  overlay.start.click();
  assert.equal(applied.appearance.speciesId, speciesId, 'grooming may not replace the saved species');
  assert.equal(applied.appearance.gender, gender, 'grooming may not replace the saved gender');
  assert.equal(applied.appearance.bodyColors.A.h, 12, 'grooming without edits preserves custom fur tint');
  if (selectedId) assert.equal(applied.appearance.cosmetics[slot], selectedId, 'the shown cosmetic survives Apply');
}
verifyGrooming('nuhongan', 'female', 'Female Forward Tuft', femaleTuft);
assert.equal(window.HobunjiNuhonganSpecies.debugSnapshot().creatorPrivateSpeciesTableCaptured, true, 'grooming explicitly hydrates the retired Nuhongan bridge');
verifyGrooming('nuhongan', 'male', 'Forward Tuft', null);
verifyGrooming('tletingan', 'female', 'Female Forward Tuft', femaleTuft);
verifyGrooming('mashtzarr', 'female', 'Front Hair', null);
assert.equal(window.hobunjiOnboardingMashtzarrFemale.speciesTableCaptured, true, 'female Mashtzarr has its real grooming slots');
verifyGrooming('MAO_AO', 'M', 'Smooth Striped', null); // Display-only normalization must not silently rewrite legacy save identity.
verifyGrooming('mao-ao', 'male', 'Grand Beard', null);


verifyGrooming('mao-ao', 'male', 'Grand Beard', grandBeard.mao, 'facialHair');
verifyGrooming('engh-sho', 'male', 'Grand Beard', grandBeard.mao, 'facialHair');
verifyGrooming('tletingan', 'male', 'Grand Beard', grandBeard.tletingan, 'facialHair');
verifyGrooming('nuhongan', 'male', 'Grand Beard', grandBeard.tletingan, 'facialHair');
verifyGrooming('kenkari', 'male', 'Grand Beard', grandBeard.kenkari, 'facialHair');
verifyGrooming('rakakoan', 'male', 'Grand Beard', grandBeard.kenkari, 'facialHair');
verifyGrooming('mashtzarr', 'male', 'Grand Beard', grandBeard.mashtzarr, 'facialHair');
verifyGrooming('mammakhbuur', 'male', 'Grand Beard', grandBeard.mashtzarr, 'facialHair', 'hairFront');
verifyGrooming('mammakhbuur', 'female', 'Long Ponytail', null, 'hairBack', 'hairFront');
verifyGrooming('rakakoan', 'female', 'Woven Eyepatch', 'appearance::Rakakoan_F::rakakoan_woven_eyepatch', 'upperFace');
// The runtime portrait filter merges the parent allow-list with each subspecies' own list.
const authorRegistry = JSON.parse(fs.readFileSync('docs/config/cosmetics/index.json', 'utf8'));
const cosmeticEntries = Array.isArray(authorRegistry) ? authorRegistry : Object.values(authorRegistry).find(Array.isArray);
for (const id of Object.values(grandBeard)) {
  assert(cosmeticEntries.some(item => item.id === id), id + ' must point to a registered asset');
}
const beardCoverage = {
  'mao-ao': grandBeard.mao, 'engh-sho': grandBeard.mao,
  tletingan: grandBeard.tletingan, nuhongan: grandBeard.tletingan,
  kenkari: grandBeard.kenkari, rakakoan: grandBeard.kenkari,
  mashtzarr: grandBeard.mashtzarr, mammakhbuur: grandBeard.mashtzarr,
};
const speciesConfigs = new Map(); // Caches authored JSON so each parent is read once.
function speciesDefinition(speciesId) {
  if (!speciesConfigs.has(speciesId)) speciesConfigs.set(speciesId, JSON.parse(fs.readFileSync('docs/config/species/' + speciesId + '.json', 'utf8')));
  return speciesConfigs.get(speciesId);
}
for (const [speciesId, beardId] of Object.entries(beardCoverage)) {
  const seen = new Set(); // Detects bad parent cycles while mirroring portrait-utils' merged allowed-cosmetic policy.
  let current = speciesId;
  let available = false;
  while (current && !seen.has(current)) {
    seen.add(current);
    const definition = speciesDefinition(current);
    available ||= (definition.male?.allowedCosmetics || []).includes(beardId);
    current = definition.parentSpecies;
  }
  assert(available, speciesId + ' must be allowed to render ' + beardId);
}
for (const speciesId of ['mao-ao', 'engh-sho', 'tletingan', 'nuhongan', 'kenkari', 'rakakoan', 'mashtzarr', 'mammakhbuur']) {
  const local = speciesDefinition(speciesId);
  assert(!(local.female?.allowedCosmetics || []).some(id => /grandbeard/i.test(id)), speciesId + ' has no authored female Grand Beard');
}

console.log('returning player grooming and inherited Grand Beard coverage: ok');
