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
      mashtzarr: { female: { slots: [{ slot: 'hairFront', label: 'Front Hair', options: [
        { id: null, label: 'None' }, { id: 'appearance::Mao-ao_F::mao-ao_tuft', label: 'Female Hair' },
      ] }] } },
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
function verifyGrooming(speciesId, gender, expectedLabel, selectedId) {
  const appearance = { speciesId, gender, cosmetics: selectedId ? { hairFront: selectedId } : {},
    bodyColors: { A: { h: 12, s: -0.1, v: -0.2 }, B: { h: 15, s: -0.3, v: -0.4 } } }; // Saved identity and colors must remain stable.
  let applied = null; // Receives the actual Apply result without modifying the character save.
  assert.equal(api.openCreator({ mode: 'grooming', cosmeticsOnly: true, speciesId, gender, appearance,
    resolvedProfile: selectedId ? { hairFront: { id: selectedId } } : {},
    onComplete: result => { applied = result; } }), true);
  assert.doesNotMatch(overlay.innerHTML, /None available\./, `${speciesId}/${gender} must show usable options`);
  assert.match(overlay.innerHTML, new RegExp(expectedLabel));
  assert.match(overlay.innerHTML, /data-ob-slot="hairFront"/);
  assert.equal(api.creatorSessionInfo().cosmeticsOnly, true);
  overlay.start.click();
  assert.equal(applied.appearance.speciesId, speciesId, 'grooming may not replace the saved species');
  assert.equal(applied.appearance.gender, gender, 'grooming may not replace the saved gender');
  assert.equal(applied.appearance.bodyColors.A.h, 12, 'grooming without edits preserves custom fur tint');
  if (selectedId) assert.equal(applied.appearance.cosmetics.hairFront, selectedId, 'the shown cosmetic survives Apply');
}
verifyGrooming('nuhongan', 'female', 'Female Forward Tuft', femaleTuft);
assert.equal(window.HobunjiNuhonganSpecies.debugSnapshot().creatorPrivateSpeciesTableCaptured, true, 'grooming explicitly hydrates the retired Nuhongan bridge');
verifyGrooming('nuhongan', 'male', 'Forward Tuft', null);
verifyGrooming('tletingan', 'female', 'Female Forward Tuft', femaleTuft);
verifyGrooming('mashtzarr', 'female', 'Front Hair', null);
assert.equal(window.hobunjiOnboardingMashtzarrFemale.speciesTableCaptured, true, 'female Mashtzarr has its real grooming slots');
verifyGrooming('MAO_AO', 'M', 'Smooth Striped', null); // Display-only normalization must not silently rewrite legacy save identity.
verifyGrooming('mao-ao', 'male', 'Grand Beard', null);

console.log('returning player grooming cosmetic options, species bridges, preserved identity: ok');
