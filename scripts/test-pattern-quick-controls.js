'use strict';
const assert = require('assert'); // Regression assertions for native controller/touch quick pattern controls.
const fs = require('fs');
const vm = require('vm');

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {};
    this.dataset = {}; this.style = {}; this.value = ''; this.disabled = false; this.hidden = false;
  }
  appendChild(child) {
    if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child);
    this.children.push(child); child.parent = this; return child;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  prepend(child) {
    this.appendChild(child);
    this.children.splice(this.children.indexOf(child), 1);
    this.children.unshift(child);
  }
  before(sibling) {
    if (!this.parent) throw new Error('Cannot insert before a detached node');
    const index = this.parent.children.indexOf(this);
    this.parent.appendChild(sibling);
    this.parent.children.splice(this.parent.children.indexOf(sibling), 1);
    this.parent.children.splice(index, 0, sibling);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] || ''; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  dispatchEvent(event) {
    for (const listener of this.listeners[event.type] || []) listener(event);
    return true;
  }
  querySelectorAll(selector) {
    const output = []; // Range selector is all the production arrow-binding helper needs.
    const walk = node => {
      for (const child of node.children) {
        if (selector === 'input[type="range"]' && child.tag === 'input' && child.type === 'range') output.push(child);
        walk(child);
      }
    };
    walk(this);
    return output;
  }
  findByAria(name) {
    if (this.attributes['aria-label'] === name) return this;
    return this.children.map(child => child.findByAria(name)).find(Boolean);
  }
}
class Event { constructor(type) { this.type = type; } }
const document = { createElement: tag => new Element(tag), activeElement: null };
const window = {};
vm.runInNewContext(fs.readFileSync('docs/js/pattern-authoring.js', 'utf8'), { window, document, Event, console });
assert(window.PatternQuickControls, 'the reusable pattern quick-control module loads');
const base = Object.freeze({ motifDataUrl: 'data:motif', meshScale: 1, motifScale: .8,
  meshRotationDeg: 0, usageOffsetX: 0, usageOffsetY: 0 });
let primary = { ...base }; // First instance pattern; never the saved reusable library definition.
let overpass = { ...base }; // Second instance pattern must remain independently editable.
let saved = 0; // Counts callbacks so gamepad button tests prove updates reach crafting state.
const host = new Element('div');
const first = window.PatternQuickControls.mount(host, {
  title: 'Primary pattern placement', getPattern: () => primary,
  onChange: pattern => { primary = pattern; saved++; },
});
const second = window.PatternQuickControls.mount(host, {
  title: 'Overpass pattern placement', getPattern: () => overpass,
  onChange: pattern => { overpass = pattern; saved++; },
});
assert(first.element.open && second.element.open, 'quick placement is exposed without opening Author Pattern');
first.element.findByAria('Increase Pattern scale').dispatchEvent(new Event('click'));
assert.equal(primary.meshScale, 1.05, 'controller arrow increases the authored pattern scale');
assert.equal(overpass.meshScale, 1, 'primary arrow does not change the overpass');
second.element.findByAria('Decrease Motif scale').dispatchEvent(new Event('click'));
assert.equal(overpass.motifScale, .75, 'overpass motif scale is separately adjustable');
assert.equal(primary.motifScale, .8, 'overpass tweak does not change the primary');
first.element.findByAria('Increase Translate pattern X').dispatchEvent(new Event('click'));
first.element.findByAria('Decrease Translate pattern Y').dispatchEvent(new Event('click'));
first.element.findByAria('Increase Rotate pattern').dispatchEvent(new Event('click'));
assert.equal(primary.usageOffsetX, 4);
assert.equal(primary.usageOffsetY, -4);
assert.equal(primary.meshRotationDeg, 5);
assert.equal(base.meshScale, 1, 'library source remains immutable');
assert.equal(base.motifScale, .8, 'library motif zoom remains immutable');
assert(saved >= 5, 'all five native button changes dispatch to the instance state');
overpass = null;
second.refresh();
assert(second.element.hidden, 'missing overpass hides quick controls rather than editing the primary');

const sliderHost = new Element('div');
const slider = new Element('input'); slider.type = 'range'; slider.min = '0'; slider.max = '3';
slider.step = '0.25'; slider.value = '1'; slider.setAttribute('aria-label', 'Rug motif scale');
let moved = 0; slider.addEventListener('input', () => moved++); // The existing rug editor output and save handlers receive this event.
sliderHost.appendChild(slider);
window.PatternQuickControls.addArrowButtons(sliderHost);
sliderHost.findByAria('Increase Rug motif scale').dispatchEvent(new Event('click'));
assert.equal(Number(slider.value), 1.25);
sliderHost.findByAria('Decrease Rug motif scale').dispatchEvent(new Event('click'));
assert.equal(Number(slider.value), 1);
assert.equal(moved, 2, 'controller arrows preserve normal slider input events');
console.log('Pattern quick-control and independent overpass tests passed');
