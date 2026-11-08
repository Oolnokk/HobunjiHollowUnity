#!/usr/bin/env node
'use strict';
// Run: node scripts/test-skeeri-planebent-palettes.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'); // Game repository root for the real modules and uploaded PNG paths.
const source = fs.readFileSync(path.join(root, 'docs/js/skeeri-ruins.js'), 'utf8'); // Exercise the shipped runtime instead of copying its palette logic.
const authoredRig = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/creatures/skeeri-flying-rig.json'), 'utf8')); // Original author preset remains normal Skeeri.

class Canvas {
  constructor() { this.width = 0; this.height = 0; this.pixels = null; this.ctx = null; }
  getContext() {
    if (this.ctx) return this.ctx;
    const owner = this;
    this.ctx = { filter: 'none', globalAlpha: 1,
      drawImage(image) { owner.pixels = new Uint8ClampedArray(image.pixels || image.pixelsData || owner.width * owner.height * 4); },
      getImageData() { return { data: owner.pixels ? new Uint8ClampedArray(owner.pixels) : new Uint8ClampedArray(owner.width * owner.height * 4) }; },
      putImageData(image) { owner.pixels = new Uint8ClampedArray(image.data); },
    };
    return this.ctx;
  }
}
const spritePixels = new Uint8ClampedArray([ // Purple marker eye beside an ordinary opaque neutral body pixel.
  127, 0, 255, 255, 180, 170, 160, 255,
]);
const loads = []; // Each loaded URL proves the runtime uses the new art and existing wing assembly.
class Image {
  constructor() { this.width = this.naturalWidth = 2; this.height = this.naturalHeight = 1; this.pixels = spritePixels; }
  set src(value) {
    assert.equal(this.crossOrigin, 'anonymous', 'pixel-reading images must request CORS before src');
    loads.push(value);
    this.onload();
  }
}
let captured = null; // Last renderer call allows checking the source-space masks without WebGL.
const w = {
  FlyingAnimalRig: {
    normalize: x => x,
    create(settings, images) {
      captured = { settings, images };
      return {
        setPalette(body, eyes) { this.palette = { body, eyes }; return true; },
      };
    },
  },
  HarlyaoLichCombat: {TYPE_DEFS: { // Match the live tradition definition's hue bands.
    hronal:{hues:['red','orange','yellow']},
    tothal:{hues:['green_blue','blue','blue_indigo']},
    kanthic:{hues:['indigo','indigo_violet','violet'],neutralDyes:['dye:CLOTH:gray']},
  }},
  SCRATCHBONES_CONFIG:{game:{dyes:{catalog:[]}}}, // Injected dye records below prove canonical swatch reuse.
  __farmLog() {},
};
vm.runInNewContext(source, {
  window: w, Image, document: { createElement(tag) { assert.equal(tag, 'canvas'); return new Canvas(); } },
  fetch: async () => ({ ok: true, json: async () => authoredRig }),
  Promise, console,
}, { filename: 'skeeri-ruins.js' });
const api = w.SkeeriRuins;
assert(api, 'shipped Skeeri runtime exports its API');
assert.equal(api.SPRITES.flying, 'assets/creaturesprites/skeeri_planebent_flying.png');
assert.equal(api.SPRITES.perched, 'assets/creaturesprites/skeeri_planebent_perched.png');
assert.equal(api.SPRITES.wings, 'assets/creaturesprites/skeeri_wings.png');
for (const url of Object.values(api.SPRITES))
  assert(fs.existsSync(path.join(root, 'docs', url)), 'missing authored PNG ' + url);
assert.equal(authoredRig.flying, 'creaturesprites/skeeri_flying.png', 'normal Skeeri author preset remains untouched');
for (const theme of ['hronal', 'tothal', 'kanthic']) {
  const a = api.paletteFor(theme, 'ruin:5:bird:2');
  const b = api.paletteFor(theme, 'ruin:5:bird:2');
  assert.deepEqual(a, b, 'deterministic palette across reloads');
  assert(api.BODY_GROUPS[theme].includes(a.body), 'a natural color from the actual ruin tradition');
  assert.match(a.eyes, /^#[0-9a-f]{6}$/i);
  assert.equal(a.theme, theme);
}
assert.notEqual(api.paletteFor('hronal', 1).body, api.paletteFor('kanthic', 1).body);
assert.equal(api.paletteFor('bogus', 1).theme, 'hronal', 'unknown ruin themes have a safe fallback');
const families = w.HarlyaoLichCombat.TYPE_DEFS; // The real named-lich tradition is the source of the permitted hue suffixes.
const catalog = w.SCRATCHBONES_CONFIG.game.dyes.catalog; // Visible swatch catalogue, not copied arbitrary RGB colors.
for(const [theme,def] of Object.entries(families)){
  for(const [i,hue] of def.hues.entries()){
    for(const variant of ['dusty','muted','dark_muted','pure','bright']){
      catalog.push({id:'dye:CLOTH:'+variant+'_'+hue,hex:'#'+(i+1).toString(16).padStart(2,'0')+(variant==='pure'?'ff':'77')+(variant==='bright'?'ff':'33')});
    }
  }
}
catalog.push({id:'dye:CLOTH:gray',hex:'#808080'});
for(const [theme,def] of Object.entries(families)){
  for(let index=0;index<60;index++){
    const palette=api.paletteFor(theme,'specimen:'+index);
    const body=catalog.find(dye=>dye.id===palette.bodyDyeId),eye=catalog.find(dye=>dye.id===palette.eyeDyeId);
    assert(body && eye,theme+' must read the source dye catalog rather than custom RGB approximations');
    assert.equal(palette.body,body.hex);
    assert.equal(palette.eyes,eye.hex);
    assert(def.hues.some(hue=>body.id.endsWith('_'+hue)) || def.neutralDyes?.includes(body.id),
      'natural body dye belongs to the selected lich tradition');
    assert(def.hues.some(hue=>eye.id.endsWith('_'+hue)),
      'uncanny eye dye belongs to the SAME lich tradition, not the named lich inverse-color glyph');
    assert.match(body.id,/:(dusty|muted|dark_muted)_|:gray$/);
    assert.match(eye.id,/:(pure|bright)_/);
  }
}

(async () => {
  const palette = api.paletteFor('kanthic', 'specimen-A');
  const rig = await api.createRig({ skeeriPalette: palette });
  assert.deepEqual(rig.palette, { body: palette.body, eyes: palette.eyes }, 'both body and eye materials receive their own colors');
  assert.equal(captured.settings.flying, 'creaturesprites/skeeri_planebent_flying.png');
  assert.equal(captured.settings.perched, 'creaturesprites/skeeri_planebent_perched.png');
  assert.equal(captured.settings.wings, authoredRig.wings, 'normal Skeeri wings and hinge settings remain intact');
  assert.deepEqual(loads, [
    api.SPRITES.flying, api.SPRITES.perched, api.SPRITES.wings,
  ]);
  assert(captured.images.glowFlying && captured.images.glowPerched, 'each pose has an independent glowing eye overlay');
  assert.equal(captured.images.flying.pixels[3], 0, 'marker pixels are removed from the naturally tinted body');
  assert.equal(captured.images.perched.pixels[3], 0);
  assert.equal(captured.images.flying.pixels[7], 255, 'ordinary body pixels remain opaque');
  assert.equal(captured.images.glowFlying.pixels[3], 255, 'marked eyes appear in the independent glow mask');
  assert.equal(captured.images.glowPerched.pixels[3], 255);
  assert.equal(api.separateEyeMarker({ width: 2, height: 1, pixels: spritePixels }).marked, 1);
  rig.palette = null;
  rig.restoreTint();
  assert.deepEqual(rig.palette, { body: palette.body, eyes: palette.eyes }, 'hit-flash restoration keeps the lich eye hue independent of fur');
  assert.equal(api.debugSnapshot().eyeMarkerPixels, 2);
  console.log('Planebent Skeeri authored art, shared wings, theme palettes, marked eye overlays and tint restore PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
