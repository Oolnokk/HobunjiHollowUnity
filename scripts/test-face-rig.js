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
console.log('Face rig: 7-point falloff, bounded/unbounded eyelids, caches, species/genders, art immutability and UI/runtime integration passed.');
