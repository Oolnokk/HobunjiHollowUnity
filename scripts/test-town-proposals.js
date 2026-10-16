'use strict';
const assert = require('node:assert/strict'); // Execute the actual modal and purchase authority together.
const fs = require('node:fs'); // Read shipped modules.
const vm = require('node:vm'); // Browser-free regression harness.
const events = new Map(); // Keyboard and controller events delivered through the public panel contract.
let document; // Supplies activeElement to the lightweight DOM focus implementation.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.style = {};
    this.parentElement = null; this.listeners = {}; this.hidden = false; this.disabled = false;
    this.clientWidth = 360; this.offsetHeight = 1800; this.className = '';
    this.classList = {
      contains: value => this.className.split(' ').includes(value),
      add: value => { if (!this.classList.contains(value)) this.className += ' ' + value; },
      toggle: (value, enabled) => { this.className = this.className.split(' ').filter(item => item !== value).join(' '); if (enabled) this.classList.add(value); },
    };
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatchEvent(event) { for (const callback of this.listeners[event.type] || []) callback(event); return !event.defaultPrevented; }
  matches(selector) { return selector[0] === '.' ? this.className.split(' ').includes(selector.slice(1)) : this.tagName === selector.toUpperCase(); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) this.onclick?.(); }
}
document = { currentScript: { src: 'https://game.test/js/town-proposals.js' }, body: new Element('body'), head: new Element('head'), createElement: tag => new Element(tag), addEventListener(type, fn) { events.set(type, fn); } };
const window = { addEventListener(type, fn) { events.set(type, fn); }, location: { pathname: '/index.html' } }; // Only actual browser boundaries are stubbed.
const context = vm.createContext({ window, document, console, URL, Image: class {}, ResizeObserver: class { observe() {} disconnect() {} } }); // No fake feature implementation.
for (const file of ['docs/config/modular-weapons.js', 'docs/js/modular-weapons.js', 'docs/js/town-mine.js', 'docs/js/town-proposals.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
const inventory = {}, mine = window.TownMine, proposals = window.TownProposals; // Live resources change after opening to test purchase-time validation.
let saves = 0, blocked = false; // Verify modal input ownership and exactly-once persistence.
mine.init({ inventory, woodItemKeys: ['pineLog', 'shadewoodLog'], save() { saves++; } });
proposals.init({ inventory, ITEM_DEFS: {}, showToast() {}, setInteractionBlocked(value) { blocked = value; } });
assert.equal(proposals.makeInteractable().onAction('wrong').ok, false);
assert.equal(proposals.makeInteractable().onAction('obj_town_proposals').ok, true);
const root = document.body.children[0]; // The reader's event contract is what ControllerUI dispatches.
const press = action => root.dispatchEvent({ type: 'hobunji-controller-panel-action', detail: { action }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }); // A/B/LB/RB semantic actions.
const acceptButton = () => root.querySelector('.proposal-accept'); // Re-query after each real render.
assert.equal(blocked, true);
assert.equal(acceptButton().disabled, true);
assert.equal(root.querySelectorAll('.proposal-cost').length, 4);
assert(root.querySelectorAll('.proposal-cost').every(row => row.style.color === '#ab1919'));
press('confirm'); assert.equal(root.querySelector('.proposal-confirm'), null, 'unaffordable A never opens a purchase');
assert.equal(saves, 0);
Object.assign(inventory, { gold: 2000, stone: 200, pineLog: 40, shadewoodLog: 60, bar_tinBronze: 29 });
press('next');
assert.equal(acceptButton().disabled, true);
assert.equal(root.querySelectorAll('.proposal-cost').filter(row => row.style.color === '#156c33').length, 3, 'fractions are independently colored');
inventory.bar_tinBronze = 30;
press('previous');
assert.equal(acceptButton().disabled, false);
acceptButton().click(); assert(root.querySelector('.proposal-confirm'));
assert.equal(saves, 0, 'accepting a letter only asks for confirmation');
press('cancel'); assert.equal(root.querySelector('.proposal-confirm'), null); assert.equal(root.hidden, false);
acceptButton().click(); root.querySelector('.proposal-confirm-actions').children[1].click();
assert.equal(root.querySelector('.proposal-confirm'), null, 'clickable No cancels without closing the letter');
press('confirm'); inventory.gold = 0; press('confirm');
assert.equal(mine.hasImprovement('foundry'), false, 'confirmation rechecks a changed inventory');
assert.equal(inventory.stone, 200); assert.equal(saves, 0);
inventory.gold = 2000;
press('next'); press('confirm');
root.querySelector('.proposal-confirm-actions').children[0].click();
assert.equal(mine.hasImprovement('foundry'), true);
assert.equal(saves, 1);
assert.equal(inventory.gold, 0); assert.equal(inventory.pineLog, 0); assert.equal(inventory.shadewoodLog, 0);
assert.equal(inventory.stone, 0); assert.equal(inventory.bar_tinBronze, 0);
assert.equal(acceptButton().disabled, true);
press('confirm'); assert.equal(saves, 1, 'repeated A cannot buy an accepted proposal twice');
assert.equal(mine.getTownValue(), 3);
const saved = mine.serialize(); // Existing save authority, including compatibility with the smithy's old purchases.
mine.restore(saved); proposals.close(); proposals.open();
assert.equal(acceptButton().disabled, true);
press('cancel'); assert.equal(root.hidden, true); assert.equal(blocked, false);
mine.restore({}); Object.assign(inventory, { gold: 2000, stone: 200, pineLog: 100, bar_tinBronze: 30 });
const frame = { pad: {}, pressed: new Set(), isDown: () => true }; // Opening interaction still holds the player's remapped A/confirm input.
window.ControllerInput = { frame: () => frame };
window.InputBindings = { getCurrentBindings: () => ({ controller: { uiConfirm: 'Button2' } }) };
proposals.open(); press('confirm');
assert.equal(root.querySelector('.proposal-confirm'), null, 'held opening interaction does not also accept a letter');
frame.pressed.add('Button2'); press('confirm');
assert(root.querySelector('.proposal-confirm'), 'a fresh mapped confirm press opens the question');
press('confirm');
assert.equal(mine.hasImprovement('foundry'), true, 'controller A confirms the purchase');
assert.equal(saves, 2);
press('cancel'); assert.equal(blocked, false);
console.log('Town proposal letter affordability, click/controller confirmation, stale resources, pooled wood and saves passed');
