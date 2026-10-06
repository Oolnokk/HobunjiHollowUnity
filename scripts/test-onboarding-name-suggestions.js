const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Executes the actual loaded advisor and creator controls without a renderer.
class Element {
  constructor() { this.children = []; this.listeners = {}; this.dataset = {}; this.className = ''; this.maxLength = 32; this.value = ''; this.classList = { add() {}, remove() {} }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { (this.listeners[event.type] || []).forEach(fn => fn(event)); }
  appendChild(el) { this.children.push(el); return el; }
  before(el) { this.row = el; }
  after(el) { overlay.elements.push(el); }
  closest() { return this.row || null; }
  setAttribute() {}
  replaceChildren() { this.children = []; }
  querySelector(selector) {
    if (selector.includes('random-name="1"')) return this.children.find(el => el.dataset.obRandomName === '1') || null;
    return null;
  }
}
const input = new Element(); // Name field whose input events stand in for onboarding-core persistence.
const overlay = {
  elements: [],
  querySelector(selector) {
    if (selector === '#ob-nickname') return input;
    if (selector === '[data-ob-tab="appearance"]') return {};
    if (selector === '[data-ob-species].ob-active') return { dataset: { obSpecies: 'kenkari' } };
    if (selector === '[data-ob-gender].ob-active') return { dataset: { obGender: 'male' } };
    if (selector === '.ob-name-suggestions') return this.elements.find(el => el.className === 'ob-name-suggestions') || null;
    if (selector.includes('random-name-status')) return this.elements.find(el => el.dataset.obRandomNameStatus === '1') || null;
    return null;
  },
};
const pending = []; // Deferred enhancement queue, flushed once after modules initialize.
const context = {
  window: { BanditNameForge: { generateCulturalIdentity: () => ({ givenName: 'Ringo' }) } },
  document: { body: {}, head: new Element(), createElement: () => new Element(), getElementById: id => id === 'ob-overlay' ? overlay : null },
  MutationObserver: class { observe() {} disconnect() {} },
  Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  queueMicrotask: fn => pending.push(fn),
};
vm.createContext(context);
for (const path of ['docs/js/name-advisor.js', 'docs/js/onboarding-random-name.js']) vm.runInContext(fs.readFileSync(path, 'utf8'), context);
const suggest = context.window.hobunjiOnboardingRandomName.suggestNames;
const sourceName = 'Benjamin';
for (const species of ['kenkari', 'mao-ao', 'engh-sho', 'tletingan', 'nuhongan']) { // Nuhongan are Tletingan-derived Slagothim and share their naming culture.
  const names = suggest(sourceName, species, 'male');
  assert.ok(names.length > 0 && names.length <= 4, species);
  assert.equal(new Set(names.map(name => name.toLowerCase())).size, names.length);
  assert.ok(names.every(name => name.length <= 32 && name.toLowerCase() !== sourceName.toLowerCase()));
  const sameLengthIndex = names.findIndex(name => name.length === sourceName.length);
  const lengthChangeIndex = names.findIndex(name => name.length !== sourceName.length);
  assert.ok(sameLengthIndex < 0 || lengthChangeIndex < 0 || sameLengthIndex < lengthChangeIndex, `${species}: same-length spelling candidates should come first`);
}
const slagothim = suggest(sourceName, 'tletingan', 'male');
assert.equal(slagothim[0], 'Benjamir', 'best same-length Slagothim repair should be first');
assert.equal(slagothim[1], 'Slenjamin', 'initial Slagothim cluster should remain available after replacement-like choices');
for (const value of ['', '   ', '123', '🐈']) assert.equal(suggest(value, 'kenkari', 'male').length, 0);
assert.equal(suggest(sourceName, 'mashtzarr', 'male').length, 0);
assert.ok(suggest(sourceName, 'mao-ao', 'female').every(name => /^[aeiou]/i.test(name)));
assert.ok(suggest(sourceName, 'kenkari', 'male', 3).every(name => name.length <= 3));
input.addEventListener('input', () => { overlay.persistedName = input.value; });
pending.splice(0).forEach(fn => fn());
const suggestions = overlay.querySelector('.ob-name-suggestions');
input.value = sourceName;
input.dispatchEvent(new context.Event('input'));
assert.ok(suggestions.children.length > 0);
const choice = suggestions.children[0].textContent;
suggestions.children[0].dispatchEvent(new context.Event('click'));
assert.equal(input.value, choice);
assert.equal(overlay.persistedName, choice);
input.value = '';
input.dispatchEvent(new context.Event('input'));
assert.equal(suggestions.children.length, 0);
assert.equal(suggestions.hidden, true);
console.log('onboarding name suggestions: replacement-first ranking, phonology, bounds, button application and core state passed');
