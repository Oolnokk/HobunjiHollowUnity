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
assert(!first.element.open && !second.element.open, 'manual placement is collapsed by default');
assert.equal(first.randomButton.parent, host, 'randomize is a standalone assignment action, not a child of advanced controls');
assert.equal(second.randomButton.parent, host);
assert(!first.randomButton.hidden && !first.randomButton.disabled);
assert.match(first.randomButton.textContent, /Primary/);
assert.match(second.randomButton.textContent, /Overpass/);
first.randomButton.dispatchEvent(new Event('click'));
assert(primary.frameScale >= .4 && primary.frameScale <= 1, 'standalone button rerolls without opening placement');
assert.equal(overpass.frameScale, undefined, 'primary reroll never edits the overpass');
assert(!first.element.open, 'reroll does not open the advanced settings');
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
assert(second.randomButton.hidden && second.randomButton.disabled, 'standalone button also hides when its assignment is cleared');

const reroll = window.PatternQuickControls.createFrameReroller(); // Deterministic bandit framing and independent instance state.
const authored = Object.freeze({ motifDataUrl: 'data:motif', frameScale: 2, frameShape: 'square', meshScale: 1.3 });
const rolled = reroll(authored, () => 0);
assert.equal(rolled.frameScale, .8);
assert.equal(rolled.frameRotationDeg, 0);
const next = reroll(rolled, () => .5);
assert.equal(next.frameScale, 1.4, 'rerolls use the original frame, not compounded shrinkage');
assert.equal(next.frameRotationDeg, 180);
assert.equal(next.meshScale, 1.3);
assert.equal(authored.frameScale, 2);
const reopened = window.PatternQuickControls.createFrameReroller()(JSON.parse(JSON.stringify(rolled)), () => .5);
assert.equal(reopened.frameScale, 1.4, 'serialized rerolls keep the original framing baseline across menu reopen');
const authorSource = fs.readFileSync('docs/js/pattern-authoring.js','utf8');
const authorStart = authorSource.indexOf('function currentPatternData()');
const authorEnd = authorSource.indexOf('let previewTimer',authorStart);
const serializeAuthor = vm.runInNewContext(authorSource.slice(authorStart,authorEnd) + '\ncurrentPatternData', {
  cfg: {...rolled, motifScale:1, meshScale:1, overpassClearanceMultiplier:3}, hasMotifInk:()=>true,
  sketchCanvas:{toDataURL:()=>rolled.motifDataUrl}, options:{}, FRAME_SHAPES:{square:{}}, clamp:(v,lo,hi)=>Math.min(hi,Math.max(lo,v)),
  PATTERN_SCALE_MIN:.4,PATTERN_SCALE_MAX:3.2,OVERPASS_CLEARANCE_MIN:1,OVERPASS_CLEARANCE_MAX:6
});
const authorSaved = serializeAuthor();
assert.equal(authorSaved.frameRandomBaseScale, 2, 'the actual full author serializer retains the baseline');
assert.equal(window.PatternQuickControls.randomizeFrame(authorSaved,()=>.5).frameScale,1.4,'author save and subsequent simple reroll do not compound shrinkage');
const oldPattern = Object.freeze({ motifDataUrl: 'data:legacy', repeatMode: 'grid', patternScale: 2, translateX: 7, translateY: -9 });
const migratedRoll = window.PatternQuickControls.createFrameReroller()(oldPattern, () => .5);
assert.equal(migratedRoll.frameX, 7, 'legacy frame offsets survive reroll');
assert.equal(migratedRoll.frameY, -9);
assert.equal(migratedRoll.frameScale, 1.4);
assert.equal(window.PatternQuickControls.randomizeFrame({frameShape:'square',frameScale:.05},()=>0).frameScale,.05,'minimum frame scale matches renderer clamp');
const different = reroll({ ...authored, motifDataUrl: 'data:other', frameScale: 3 }, () => 0);
assert.equal(different.frameScale, 1.2, 'new motif resets the framing baseline');
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
// Reuse the actual game save and icon-cache functions, including reference-only storage semantics.
const game = fs.readFileSync('docs/game.js', 'utf8');
const extract = (name, next) => game.slice(game.indexOf('function ' + name + '('), game.indexOf('function ' + next + '('));
const toolGear = { tools: { axe: true }, toolPlating: { axe: { mode:'pattern', pattern:null, patternLibraryId:'saved-motif' } } };
let gearSaves = 0, textureRefreshes = 0, worldSaves = 0;
const toolPlating = key => toolGear.toolPlating[key];
const bridge = vm.runInNewContext(extract('setToolVerdigrisPattern', 'toolReinforcementMetal') + extract('metalToolCacheKey', 'ensureMetalToolIconSource') + '\n({ setToolVerdigrisPattern, metalToolCacheKey })', {
  gearInventory: toolGear, saveGearInventory: () => gearSaves++, toolPlating,
});
window.setInterval = () => 1; // Disable hourly polling in the headless shop test.
vm.runInNewContext(fs.readFileSync('docs/js/metal-craft-shop.js', 'utf8'), { window, console });
window.MetalCraftShop.init({
  getGearInventory: () => toolGear, toolPlating, setToolVerdigrisPattern: bridge.setToolVerdigrisPattern,
  refreshMetalToolWorldTexture: () => textureRefreshes++, saveMemberWorldData: () => worldSaves++,
});
const originalKey = bridge.metalToolCacheKey('axe', {});
const adjustTool = window.MetalCraftShop.__test.updateToolPatternPlacement;
assert(adjustTool('axe', rolled));
assert.equal(toolGear.toolPlating.axe.patternLibraryId, null, 'a modified library motif cannot remain a reference-only plating');
assert.equal(toolGear.toolPlating.axe.pattern.sourcePatternLibraryId, 'saved-motif', 'the instance retains library provenance');
assert.equal(toolGear.toolPlating.axe.pattern.frameScale, rolled.frameScale, 'the real save setter retains randomized placement');
const firstKey = bridge.metalToolCacheKey('axe', {});
assert.notEqual(firstKey, originalKey, 'the first frame change invalidates the tool icon cache');
assert(adjustTool('axe', next));
assert.notEqual(bridge.metalToolCacheKey('axe', {}), firstKey, 'further rolls have distinct cached textures');
assert.equal(toolGear.toolPlating.axe.pattern.sourcePatternLibraryId, 'saved-motif');
assert.equal(gearSaves, 2); assert.equal(textureRefreshes, 2); assert.equal(worldSaves, 2);
assert(!adjustTool('missing', rolled), 'an unowned item cannot receive an instance pattern');
console.log('Pattern quick-control, independent overpass, and actual tool-save/cache tests passed');
