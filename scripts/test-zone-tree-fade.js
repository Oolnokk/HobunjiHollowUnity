#!/usr/bin/env node
'use strict';
// Wilderness tree occlusion fade (js/zone-tree-fade.js, extracted from game.js): the opacity ease and the sightline test.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const win = {};
win.window = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync('docs/js/zone-tree-fade.js', 'utf8'), win, { filename: 'zone-tree-fade.js' });
const Fade = win.ZoneTreeFade;

// Sightline: only points strictly between camera (0,0) and player (10,0), within the radius, count as blocking.
assert.strictEqual(Fade.isBetweenCameraAndPlayer2D(5, 0.4, 0, 0, 10, 0, 0.5), true, 'on the line, mid-way');
assert.strictEqual(Fade.isBetweenCameraAndPlayer2D(5, 0.6, 0, 0, 10, 0, 0.5), false, 'off to the side');
assert.strictEqual(Fade.isBetweenCameraAndPlayer2D(10.3, 0, 0, 0, 10, 0, 0.5), false, 'just behind the player is not between (no endpoint clamp)');
assert.strictEqual(Fade.isBetweenCameraAndPlayer2D(-0.2, 0, 0, 0, 10, 0, 0.5), false, 'behind the camera');
assert.strictEqual(Fade.isBetweenCameraAndPlayer2D(0, 0, 1, 1, 1, 1, 5), false, 'degenerate sightline');

// These doubles count writes so a settled partial fade cannot quietly re-enter the animation loop.
let writes = 0;
let clones = 0;
let disposed = 0;
const original = {
  opacity: 1, transparent: false, depthWrite: true,
  clone() {
    clones++;
    let opacity = this.opacity;
    return {
      transparent: this.transparent, depthWrite: this.depthWrite,
      get opacity() { return opacity; },
      set opacity(value) { writes++; opacity = value; },
      dispose() { disposed++; },
    };
  },
};
const branch = { material: original };
const tree = { children: [branch] };
Fade.init({ lerpPerSec: 6 });
Fade.setTarget(tree, 0.5, false);
const faded = branch.material;
assert.notStrictEqual(faded, original);
assert.strictEqual(faded.opacity, 0.5, 'new trees appear at the correct opacity');
assert.strictEqual(faded.depthWrite, true);
assert.strictEqual(faded.transparent, true);
assert.strictEqual(Fade.snapshot().animating, 0);

Fade.setTarget(tree, 0.25, true);
assert.strictEqual(faded.depthWrite, false, 'a blocking tree lets the portrait show through');
Fade.updateAnimation(0.02);
assert(Math.abs(faded.opacity - 0.38) < 1e-9);
Fade.updateAnimation(1);
assert.strictEqual(faded.opacity, 0.25);
assert.strictEqual(Fade.snapshot().animating, 0);
const settledWrites = writes;
for (let i = 0; i < 60; i++) {
  Fade.setTarget(tree, 0.25, true);
  Fade.updateAnimation(0.016);
}
assert.strictEqual(writes, settledWrites, 'settled fades incur zero opacity writes');

Fade.setTarget(tree, 0.25, false);
assert.strictEqual(faded.depthWrite, true, 'blocking state can change even when opacity stays fixed');
Fade.setTarget(tree, 1, false);
Fade.updateAnimation(1);
assert.strictEqual(branch.material, original, 'fully visible trees use their original opaque material');
assert.strictEqual(Fade.snapshot().animating, 0);

Fade.setTarget(tree, 0.25, true);
assert.strictEqual(branch.material, faded);
assert.strictEqual(clones, 1, 'repeated fades reuse the same clone');
Fade.setTarget(tree, 0.5, false);
Fade.reset(tree);
assert.strictEqual(Fade.snapshot().animating, 0, 'culling stops an in-flight fade');
assert.strictEqual(branch.material, original);
Fade.forget(tree);
Fade.forget(tree);
assert.strictEqual(disposed, 1, 'unloading releases only the owned clone, once');
console.log('ok zone tree fade');
