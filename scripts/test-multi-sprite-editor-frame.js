'use strict';
// Run with: node scripts/test-multi-sprite-editor-frame.js
// Executes the ACTUAL Tool Hub editor app's animation callback, which the
// isolated preview-renderer tests alone cannot cover.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/app.js', 'utf8'); // Production editor entrypoint.
const config = fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8'); // Production weapon registry.
const html = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/index.html', 'utf8'); // Checks the live module version and both canvases.
new Function(app);
assert.match(app, /function paintedImage\(part\)/, 'editor must pass its own paint callback to the preview renderer');
assert.match(html, /id="headPreview"/);
assert.match(html, /id="preview"/);

class Element {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.children = [];
    this.handlers = new Map();
    this.dataset = {};
    this.files = null;
    this.style = {};
  }
  addEventListener(event, callback) { this.handlers.set(event, callback); }
  replaceChildren(...children) { this.children = children; }
  appendChild(child) { this.children.push(child); return child; }
  querySelector() { return new Element('option'); }
  setAttribute(name, value) { this[name] = value; }
  click() { this.handlers.get('click')?.(); this.onclick?.(); }
}
const nodes = new Map(); // Every named input exists as a minimal DOM stand-in.
const node = id => {
  if (!nodes.has(id)) nodes.set(id, new Element(id));
  return nodes.get(id);
};
for (const [id, value] of [['metalHex','#CD7F32'], ['verdigrisHex','#57B38B'], ['oxidation','0.5']]) node(id).value = value;
const selectors = [new Element('tab-flails'), new Element('tab-layers')]; // Actual tab switching is exercised by selectWeapon().
selectors[0].dataset.tab = 'flails'; selectors[1].dataset.tab = 'layers';
const pickButtons = ['haft','chainTop','chainBottom','head'].map(name => {
  const button=new Element(name+'Picker');button.dataset.pick=name;return button;
}); // Real buttons are enumerated by the app when wiring exact PNG coordinate picking.
const document = {
  getElementById: node,
  querySelectorAll: sel => sel === '[data-tab]' ? selectors : sel === '[data-pick]' ? pickButtons : [],
  createElement: name => new Element(name),
};
const frames = []; // Scheduled animation callbacks are executed on demand, without browser timers.
const images = [];
const markerCalls = [];
const recolorCalls = [];
const previewCalls = [];
const paintSamples = []; // Observes both source-PNG fallback during async recolor and the completed metal canvas.
let shouldThrow = false; // Used to test log deduplication for repeated rendering failures.
class Image {
  constructor() {
    this.width = 12;
    this.height = 24;
    this.naturalWidth = 12;
    this.naturalHeight = 24;
  }
  set src(value) {
    this.path = value;
    images.push(value);
    this.onload?.();
  }
}
let pickerOptions=null; // Captures the editor's real pick-button callback without importing PNG pixels from the browser.
const window = {
  devicePixelRatio: 1,
  HobunjiSpritePointPicker: { create(){ return {open(options){pickerOptions=options;}}; } },
  addEventListener() {},
  HobunjiLayeredWeaponEffects: {
    recolorMarker(source, hex, target) {
      markerCalls.push({path:source.path, hex, target});
      return {width:source.width,height:source.height,tinted:true};
    },
  },
  ToolMetalRecolor: {
    getRecoloredCanvas(path, options) {
      recolorCalls.push({path, options});
      return Promise.resolve({width:12,height:24,painted:true});
    },
  },
  HobunjiMultiSpritePreviewRenderer: {
    modelFor(def, lookup) {
      return {
        basePath:def.sprite || 'assets/toolsprites/hachutu_torch-flail_handle.png',
        parts:def.flail.head.layers,
        loaded:!!lookup(def.flail.chain.sprite),
      };
    },
    drawCanvas(canvas, kind, model, lookup, paint) {
      if (shouldThrow) throw new Error('synthetic drawing failure');
      previewCalls.push({canvas:canvas.id,kind,loaded:model.loaded});
      const basePaint = paint({sprite:model.basePath,material:'metal'});
      assert.ok(basePaint, 'base PNG must be paintable');
      paintSamples.push({kind,baseRecolored:basePaint.painted === true});
      for (const part of model.parts) {
        assert.ok(lookup(part.sprite), 'PNG must be loaded by the app before rendering');
        const result = paint(part);
        assert.ok(result, 'each head layer must have a drawable image');
        if (part.id === 'fuel') assert.equal(result.tinted, true, 'off-white rag marker must produce the composited tinted canvas');
      }
    },
    resetEffects() {},
    debugSnapshot() {return {head:{partsReady:4},combined:{chainReady:true}};},
  },
};
const savedDrafts=[]; // Captures the actual JSON persisted by the Tool Hub after editing a Grapple-Flail.
const localStorage = {getItem:()=>null,removeItem(){},setItem(_key,value){savedDrafts.push(JSON.parse(value));}};
const sandbox = {
  window, document, Image, localStorage,
  URL, location:{href:'https://example.test/tools/multi-sprite-weapon-editor/index.html'},
  performance:{now:()=>100}, console,
  requestAnimationFrame:callback=>frames.push(callback),
  fetch:async()=>({ok:false}), Date,
  prompt:()=>null, confirm:()=>true,
};
vm.createContext(sandbox);
vm.runInContext(config,sandbox);
vm.runInContext(app,sandbox);
assert.equal(frames.length,1,'startup must schedule one frame driver');
assert.equal(images.length,6,'startup loads all six Hachutu sprites');

(async () => {
  await Promise.resolve();await Promise.resolve(); // Image onload -> cached imageValues in the real app.
  frames.shift()(150); // This exact call previously threw ReferenceError: paintedImage is not defined.
  assert.deepEqual(previewCalls.map(c=>c.canvas),['headPreview','preview']);
  assert.equal(paintSamples[0].baseRecolored,false,'the PNG loads visibly while async metal coloring is pending');
  assert.equal(markerCalls.length,2,'the fuel marker is tinted in both previews');
  assert.ok(markerCalls.every(c=>c.hex==='#7F00FF' && c.target==='#E7DDC9'));
  assert.equal(recolorCalls.length,4,'the haft and three metal head layers each start only one recolor even with two previews');
  assert.equal(recolorCalls[0].options.oxidationAmount,0.5);
  await Promise.resolve();await Promise.resolve();
  frames.shift()(175);
  assert.equal(paintSamples.at(-1).baseRecolored,true,'the completed recolor canvas replaces the temporary source PNG');
  assert.equal(recolorCalls.length,4,'repaint uses cached promises, not additional recolor requests');
  assert.equal(node('log').textContent.includes('Preview:'),false,'successful frames must not log an undefined paint callback');
  shouldThrow=true;
  frames.shift()(200);
  const original = node('log').textContent;
  assert.match(original,/Preview: synthetic drawing failure/);
  frames.shift()(225);
  assert.equal(node('log').textContent,original,'the same recurring RAF error must be logged once, not 60 times per second');
  shouldThrow=false;
  frames.shift()(250);
  assert.equal(previewCalls.at(-1).canvas,'preview','the preview can recover without rebuilding the editor');
  node('weapon').value='grappleFlail';
  node('weapon').handlers.get('change')();
  await Promise.resolve();await Promise.resolve();
  assert.equal(node('connectorType').value,'rope','Grapple-Flail selects generated rope without requiring a PNG');
  assert.equal(node('headAnchorLayer').value,'composite','Grapple-Flail can attach between the two visible PNG layers');
  assert.equal(pickButtons.find(x=>x.dataset.pick==='chainTop').disabled,true,'rope has geometric ends, so raster chain-end picking is disabled');
  node('chainScale').value='2';node('chainScale').handlers.get('change')();
  node('headScale').value='.5';node('headScale').handlers.get('change')();
  pickButtons.find(x=>x.dataset.pick==='head').click();
  assert.equal(pickerOptions.composite,true,'head picker must use shared composite coordinates');
  assert.equal(pickerOptions.images.length,2,'both grapple head PNGs must appear in the composite picker');
  assert.equal(pickerOptions.offsets.length,2,'composite picking forwards one authored offset per sprite layer');
  pickerOptions.onPick({x:12,y:-14});
  node('save').click();
  const draft=savedDrafts.at(-1).weapons.grappleFlail.flail;
  assert.equal(draft.chain.scale,2);
  assert.equal(draft.head.scale,.5);
  assert.deepEqual(draft.head.anchor,{x:12,y:-14});
  assert.equal(draft.head.anchorSpace,'composite');
  node('importFile').files=[{name:'grapple-flail.json',text:async()=>JSON.stringify(savedDrafts.at(-1))}]; // Round-trip the real exported draft through the actual JSON import handler.
  await node('importFile').handlers.get('change')();
  assert.match(node('log').textContent,/Imported grapple-flail\.json/,'a rope-only flail must re-import without a chain sprite');
  console.log('multi-sprite editor frame: PASS (real startup, six PNGs, both canvases, metal palette, rag tint, recolor cache, deduplicated errors)');
})().catch(error => { console.error(error); process.exitCode=1; });
