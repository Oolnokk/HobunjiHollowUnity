#!/usr/bin/env node
'use strict';
// node scripts/test-face-rig.js — dependency-free pixel deformation and calibration regression checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Raster {
  constructor(width = 64, height = 64) {
    this.width = width; this.height = height;
    this.naturalWidth = width; this.naturalHeight = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    const canvas = this;
    return {
      drawImage(image) {
        // Minimal unscaled draw used to verify that the warped pixels derive from source art.
        canvas.pixels.set(image.pixels || new Uint8ClampedArray(canvas.pixels.length));
      },
      getImageData(x, y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
          const start = ((yy + y) * canvas.width + xx + x) * 4;
          data.set(canvas.pixels.subarray(start, start + 4), (yy * width + xx) * 4);
        }
        return { width, height, data };
      },
      createImageData(width, height) {
        return { width, height, data: new Uint8ClampedArray(width * height * 4) };
      },
      putImageData(image, x, y) {
        for (let yy = 0; yy < image.height; yy++) for (let xx = 0; xx < image.width; xx++) {
          const offset = (yy * image.width + xx) * 4;
          canvas.pixels.set(image.data.subarray(offset, offset + 4), ((yy + y) * canvas.width + xx + x) * 4);
        }
      },
    };
  }
}
const window = { document: { createElement: () => new Raster() } }; // Source layer rendering uses this fake browser canvas only.
vm.runInNewContext(fs.readFileSync('docs/js/face-rig.js', 'utf8'), { window, console }, { filename: 'face-rig.js' });
const api = window.HobunjiFaceRig;
assert(api, 'the engine installs without Three.js or gameplay initialization');

for (const species of ['mao-ao', 'tletingan', 'engh-sho']) assert.equal(api.familyForSpecies(species), 'line');
for (const species of ['kenkari', 'mashtzarr', 'mammakhbuur', 'porakaneki']) assert.equal(api.familyForSpecies(species), 'round');
assert.equal(api.familyForSpecies('omgurku'), null);

const regular = api.make('mao-ao', 'male'); // Baseline live-game constraints.
const experimental = api.make('mao-ao', 'male'); // Same seven-point curve with artistic limits disabled.
assert.equal(regular.eyes[0].nodes.length, 7);
api.moveNode(regular, 0, 3, 1, -1);
api.moveNode(experimental, 0, 3, 1, -1, { calibration: true });
assert.deepEqual([...regular.eyes[0].nodes[3]], [0.07, -0.3], 'runtime node displacements remain clamped');
assert.deepEqual([...experimental.eyes[0].nodes[3]], [1, -1], 'calibrator permits arbitrary finite displacements');
assert.equal(experimental.eyes[0].nodes[2][0], 0.43);
assert.equal(experimental.eyes[0].nodes[1][0], 0.16);
assert.equal(experimental.eyes[0].nodes[0][0], 0.045);
assert.equal(api.normalize(experimental, 'mao-ao', 'male', { calibration: true }).eyes[0].nodes[3][0], 1);
assert.equal(api.normalize(experimental, 'mao-ao', 'male').eyes[0].nodes[3][0], 0.07);
assert.equal(api.normalize(experimental, 'tletingan', 'male'), null, 'art must never migrate into the wrong species');
assert.equal(api.normalize(experimental, 'mao-ao', 'female'), null, 'different gender sprites require their own calibration');

const round = api.make('kenkari', 'male'); // Signed eyelids in calibration vs inward-only gameplay.
round.eyes[0].upper = { inset: -5, curve: 3, depth: 20 };
round.eyes[0].circle.r = 4;
const open = api.normalize(round, 'kenkari', 'male', { calibration: true });
const bounded = api.normalize(round, 'kenkari', 'male');
assert.equal(open.eyes[0].upper.inset, -5);
assert.equal(open.eyes[0].upper.depth, 20);
assert.equal(open.eyes[0].circle.r, 4);
assert.equal(bounded.eyes[0].upper.inset, 0);
assert.equal(bounded.eyes[0].upper.curve, 1);
assert.equal(bounded.eyes[0].upper.depth, 1);
assert.equal(bounded.eyes[0].circle.r, 0.2);
assert.equal(api.roundContour(round.eyes[0].upper, 1, { calibration: true }), -5);
assert.equal(api.roundContour(round.eyes[0].upper, 1), 0);

const art = new Raster(); // Source artwork is synthesized instead of loading private assets.
for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) {
  const p = (y * art.width + x) * 4;
  art.pixels.set([x * 4, y * 4, 78, 255], p);
}
const neutral = api.make('mao-ao', 'male');
assert.strictEqual(api.applyImage(art, neutral, 'head', 'mao-ao', 'male'), art, 'neutral must be a zero-cost identity');
experimental.eyes[0].box = { x: 0.1, y: 0.1, w: 0.4, h: 0.4 };
const warped = api.applyImage(art, experimental, 'head', 'mao-ao', 'male', { calibration: true });
assert.notStrictEqual(warped, art);
assert.equal(warped.naturalWidth, art.naturalWidth, 'Canvas dimensions match Image dimensions for portrait drawing');
assert.strictEqual(api.applyImage(art, experimental, 'head', 'mao-ao', 'male', { calibration: true }), warped, 'identical poses hit the bounded cache');
assert.notStrictEqual(api.applyImage(art, experimental, 'head', 'mao-ao', 'male'), warped, 'normal and calibrator caches never collide');
assert.equal(art.pixels[0], 0, 'original pixel array stays unchanged');
assert(api.debugSnapshot().builds >= 2 && api.debugSnapshot().hits >= 1);

const goggles = api.make('engh-sho', 'male'); // Engh-sho deform only the eye slots in their goggles.
api.moveNode(goggles, 0, 3, 0.12, 0.13, { calibration: true });
assert.strictEqual(api.applyImage(art, goggles, 'head', 'engh-sho', 'male', { calibration: true }), art);
assert.notStrictEqual(api.applyImage(art, goggles, 'goggles', 'engh-sho', 'male', { calibration: true }), art);

const read = path => fs.readFileSync(path, 'utf8');
const game = read('docs/index.html'); // Runtime must install the shared engine before the portrait renderer.
assert(game.indexOf('js/face-rig.js') >= 0 && game.indexOf('js/face-rig.js') < game.indexOf('js/portrait-utils.js'));
const portrait = read('docs/js/portrait-utils.js'); // Head, UR/blink and eye cosmetic routing must all use one warp API.
assert(portrait.includes("warpFaceImage(originalEyeArt, 'ur')"));
assert(portrait.includes("warpFaceImage(originalHead, 'head')"));
assert(portrait.includes("name.includes('snowgoggles') ? 'goggles' : 'eyes'"));
assert(read('docs/js/npc-avatar-preview-utils.js').includes('profile.faceRig'));
assert(read('docs/onboarding-core.js').includes('profile.faceRig'));
assert(read('docs/js/save-startup-gate.js').includes('profile.faceRig'));
const author = read('docs/tools/face-rig/index.html'); // The calibration mode is an option to the same tool, never duplicated math.
assert(author.includes("get('calibration')==='1'"));
assert(author.includes('api.applyImage(img,rig,role,rig.speciesId,rig.gender,calOptions)'));
assert(author.includes("numeric.type='number'"));
assert(author.includes('captureObservations()'));
assert(author.includes('schema:\'hobunji_face_rig_calibration.v1\''));
assert(read('docs/tools/face-rig-calibrator/index.html').includes('face-rig/index.html?calibration=1'));
assert(read('docs/tools/index.html').includes('data-target="face-rig-calibrator"'));

// Start the real editor controller under a tiny DOM shim: earlier tests missed a
// line-eye startup crash because they tested the deformation API but never initialized the UI.
function verifyEditorBoot(calibration) {
  const generated = []; // Collects dynamically authored eyelid sliders for input dispatch.
  const controls = new Map(); // Provides stable stand-ins for the editor's static controls.
  class EditorElement {
    constructor(tag = 'div') {
      this.tag = tag; this.style = {}; this.dataset = {}; this.children = [];
      this.value = ''; this.textContent = ''; this.hidden = false; this.width = 800; this.height = 500;
      this.listeners = {}; // Stores callbacks for simulated input and pointer changes.
    }
    appendChild(child) {
      const previous = this.children[this.children.length - 1];
      if (previous) previous.nextElementSibling = child;
      child.parentElement = this; this.children.push(child); return child;
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    setAttribute(name, value) { this[name] = String(value); }
    removeAttribute(name) { delete this[name]; }
    querySelector(selector) {
      return selector === 'input[type=number]'
        ? this.children.find(child => child.tag === 'input' && child.type === 'number') : null;
    }
  }
  const document = {
    getElementById(id) {
      if (!controls.has(id)) controls.set(id, new EditorElement());
      return controls.get(id);
    },
    createElement(tag) { const node = new EditorElement(tag); generated.push(node); return node; },
    querySelectorAll(selector) {
      return selector === '[data-lid]' ? generated.filter(node => node.dataset.lid) : [];
    },
  };
  const browser = { HobunjiFaceRig: api, addEventListener() {} }; // Uses the actual production eye model.
  const context = {
    window: browser, document, parent: {},
    location: { search: calibration ? '?calibration=1' : '', origin: 'https://example.test' },
    URLSearchParams, Image: class {}, requestAnimationFrame() {},
    fetch: async () => ({ ok: false, status: 404 }), // Asset errors are expected without real PNGs in this test.
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {},
  };
  const controller = author.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert(controller, 'the editor has an executable inline controller');
  vm.runInNewContext(controller, context, { filename: 'face-rig-editor.js' });

  const get = id => document.getElementById(id);
  assert.equal(get('roundControls').hidden, true, 'Mao’ao must initialize without round-eye eyelids');
  const sliders = document.querySelectorAll('[data-lid]');
  assert.equal(sliders.length, 6, 'upper/lower inset, curve and depth sliders exist');

  get('species').value = 'kenkari'; get('species').onchange();
  assert.equal(get('roundControls').hidden, false);
  const inset = sliders.find(node => node.dataset.lid === 'upper.inset');
  assert.equal(inset.value, '0', 'round-eye controls synchronize after changing species');
  inset.value = '0.35'; inset.listeners.input[0]();
  assert.equal(inset.nextElementSibling.textContent, '0.35', 'round-eye slider edits still apply');

  if (calibration) {
    const numeric = inset.parentElement.querySelector('input[type=number]');
    numeric.value = '-4'; numeric.listeners.change[0]();
    assert.equal(inset.value, '-4', 'unclamped calibration values remain editable');
  }

  // Changing back must not attempt eye.upper.inset on a seven-node spline eye.
  get('species').value = 'mao-ao'; get('species').onchange();
  assert.equal(get('roundControls').hidden, true);
  inset.value = '0.6'; inset.listeners.input[0](); // A stale event must be harmless while sliders are hidden.
  get('right').onclick(); get('left').onclick();

  for (const species of ['tletingan', 'engh-sho', 'mashtzarr', 'mammakhbuur', 'porakaneki']) {
    get('species').value = species; get('species').onchange();
    assert.equal(get('roundControls').hidden, api.familyForSpecies(species) !== 'round');
    get('gender').value = 'female'; get('gender').onchange();
    get('right').onclick(); get('left').onclick();
  }
}
verifyEditorBoot(false);
verifyEditorBoot(true);

console.log('Face rig: 7-point falloff, bounded/unbounded eyelids, caches, species/genders, art immutability and UI/runtime integration and editor boot/switch tests passed.');
