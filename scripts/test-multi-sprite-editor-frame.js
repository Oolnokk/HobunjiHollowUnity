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
const localStorage = {getItem:()=>null,removeItem(){},setItem(_key,value){if(_key === 'hobunji.multiSpriteWeapons.draft.v1') savedDrafts.push(JSON.parse(value));}};
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
  await new Promise(resolve => setImmediate(resolve)); // Flush real async recolor completion across Node and the editor VM before sampling the next frame.
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
  assert.equal(node('chainScaleX').value,5.25,'the approved Grapple-Flail width loads from the committed registry');
  assert.equal(node('chainScaleY').value,3.75,'the approved Grapple-Flail length loads from the committed registry');
  node('chainScaleX').value='3';node('chainScaleX').handlers.get('change')();
  node('chainScaleY').value='2';node('chainScaleY').handlers.get('change')();
  node('angularDamping').value='12';node('angularDamping').handlers.get('change')();
  node('headScale').value='.5';node('headScale').handlers.get('change')();
  pickButtons.find(x=>x.dataset.pick==='head').click();
  assert.equal(pickerOptions.composite,true,'head picker must use shared composite coordinates');
  assert.equal(pickerOptions.images.length,2,'both grapple head PNGs must appear in the composite picker');
  assert.equal(pickerOptions.offsets.length,2,'composite picking forwards one authored offset per sprite layer');
  pickerOptions.onPick({x:12,y:-14});
  node('save').click();
  const draft=savedDrafts.at(-1).weapons.grappleFlail.flail;
  assert.equal(draft.chain.scaleX,3);
  assert.equal(draft.chain.scaleY,2);
  assert.equal(draft.chain.scale,undefined,'newly authored drafts export separate X/Y scales');
  assert.equal(draft.head.scale,.5);
  assert.equal(draft.motion.angularDamping,12,'damping is saved with the actual weapon draft');
  assert.deepEqual(draft.head.anchor,{x:12,y:-14});
  assert.equal(draft.head.anchorSpace,'composite');
  node('importFile').files=[{name:'grapple-flail.json',text:async()=>JSON.stringify(savedDrafts.at(-1))}]; // Round-trip the real exported draft through the actual JSON import handler.
  await node('importFile').handlers.get('change')();
  assert.match(node('log').textContent,/Imported grapple-flail\.json/,'a rope-only flail must re-import without a chain sprite');
  function bootDraft(storage) {
    const elements = new Map(); // Each simulated reload gets independent UI fields and source provenance.
    const ui = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); }; // Resolves isolated controls for restore/save/reset tests.
    const context = vm.createContext({ ...sandbox,
      window: { ...window }, document: { ...document, getElementById: ui }, requestAnimationFrame() {},
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    }); // Execute the real startup code for each browser-storage scenario.
    vm.runInContext(config, context); vm.runInContext(app, context);
    return { ui, fuel() { ui('layerList').children[2].children[0].onclick(); return Number(ui('fireSize').value); } };
  }
  const draftKey = 'hobunji.multiSpriteWeapons.draft.v1'; // Existing user drafts must remain recoverable under their original key.
  const repository = JSON.parse(JSON.stringify(window.WEAPON_SPRITE_ASSEMBLY_CONFIG)); // Current committed recipe is the baseline for this regression.
  const oldDraft = JSON.parse(JSON.stringify(repository)); // Reproduces the user's older saved 0.4 particle settings.
  oldDraft.weapons.hachutuTorchFlail.flail.head.layers[2].vfx.size = .4;
  oldDraft.weapons.hachutuTorchFlail.flail.head.layers[2].vfx.life = .65;
  const oldText = JSON.stringify(oldDraft), storage = new Map([[draftKey, oldText]]); // Legacy drafts have no repository-baseline marker.
  const legacy = bootDraft(storage); // A new commit must show its .02 setting even on a browser with a saved .4 draft.
  assert.equal(legacy.fuel(), .02);
  assert.match(legacy.ui('recipeSource').textContent, /Repository settings.*older saved draft/);
  assert.equal(storage.get(draftKey), oldText, 'startup preserves the older draft rather than deleting user work');
  legacy.ui('restoreDraft').click();
  assert.equal(legacy.fuel(), .4, 'explicit recovery still restores every old authored value');
  assert.match(legacy.ui('recipeSource').textContent, /Saved draft/);
  legacy.ui('fireSize').value = '.07'; legacy.ui('fireSize').handlers.get('change')();
  legacy.ui('save').click();
  const resumed = bootDraft(storage); // Drafts saved against the current repository still auto-resume normally.
  assert.equal(resumed.fuel(), .07);
  assert.equal(resumed.ui('recipeSource').textContent, 'Saved draft');
  storage.set(draftKey + '.repository', JSON.stringify(oldDraft)); // A later repository update invalidates auto-restore, while preserving the saved payload.
  const outdated = bootDraft(storage);
  assert.equal(outdated.fuel(), .02, 'drafts based on a different repository cannot override current values silently');
  assert.equal(JSON.parse(storage.get(draftKey)).weapons.hachutuTorchFlail.flail.head.layers[2].vfx.size, .07);
  outdated.ui('reset').click();
  assert.equal(outdated.fuel(), .02);
  assert.equal(storage.has(draftKey), false); assert.equal(storage.has(draftKey + '.repository'), false);
  assert.equal(outdated.ui('recipeSource').textContent, 'Repository settings');
  node('weapon').value = 'hachutuTorchStaff'; // Exercise the real third-tab input wiring without the flail-only mocked preview.
  node('weapon').handlers.get('change')();
  assert.equal(Number(node('baseFireSize').value), .02, 'torch-staff uses original unscaled flail mote size');
  assert.equal(Number(node('baseFireVisualScale').value), 4, 'editor loads the four-times full-geometry scale');
  assert.equal(Number(node('baseFireFocus').value), .55, 'editor loads partial clustering so the plume retains shape');
  assert.equal(node('baseFireBlend').value, 'normal', 'normal blend keeps staff fire from washing out');
  assert.equal(Number(node('baseFireOpacity').value), .65);
  node('baseFireVisualScale').value = '5'; node('baseFireVisualScale').handlers.get('change')();
  node('baseFireFocus').value = '.4'; node('baseFireFocus').handlers.get('change')();
  node('baseFireBlend').value = 'additive'; node('baseFireBlend').handlers.get('change')();
  node('baseFireOpacity').value = '.5'; node('baseFireOpacity').handlers.get('change')();
  node('save').click();
  const savedStaffVfx = savedDrafts.at(-1).weapons.hachutuTorchStaff.base.vfx; // Confirm every new editor control round-trips through the actual draft.
  assert.equal(savedStaffVfx.visualScale, 5);
  assert.equal(savedStaffVfx.masteryFocus, .4);
  assert.equal(savedStaffVfx.blendMode, 'additive');
  assert.equal(savedStaffVfx.opacity, .5);
  console.log('multi-sprite editor frame: PASS (startup, both canvases, recolor cache, error recovery, editable anchored fire geometry)');
})().catch(error => { console.error(error); process.exitCode=1; });
