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

// Ease: opacity moves toward the target at lerpPerSec, writes every fade material, and leaves the set once fully opaque.
const active = new Set();
Fade.init({ treeFadeActive: active, lerpPerSec: 6 });
const mats = [{ opacity: 1 }, { opacity: 1 }];
const tree = { userData: { _fadeTarget: 0.25, _fadeOpacity: 1, _fadeMaterials: mats } };
active.add(tree);
Fade.updateAnimation(0.05);
assert(Math.abs(tree.userData._fadeOpacity - 0.7) < 1e-9 && mats.every(m => m.opacity === tree.userData._fadeOpacity));
Fade.updateAnimation(1);
assert.strictEqual(tree.userData._fadeOpacity, 0.25, 'snaps onto the target instead of overshooting');
assert(active.has(tree), 'a faded-out tree stays active');
tree.userData._fadeTarget = 1;
Fade.updateAnimation(1);
assert.strictEqual(tree.userData._fadeOpacity, 1);
assert(!active.has(tree), 'fully restored trees leave the active set');
console.log('ok zone tree fade');
