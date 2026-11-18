'use strict';
// While the world-pausing main menu is open the world render runs at a modest cadence; everything else renders per frame.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js', 'utf8');

const a = game.indexOf('const MENU_OPEN_WORLD_RENDER_INTERVAL_MS');
const b = game.indexOf('\n', game.indexOf('window.HobunjiMenuWorldThrottle'));
const c = game.indexOf('const worldCovered = ');
const d = game.indexOf('\n        }', game.indexOf('renderWorldPasses(now);', c)) + '\n        }'.length;
assert(a > 0 && b > a && c > 0 && d > c, 'throttle code present');
const state = game.slice(a, b);
const frame = game.slice(c, d); // through the closing brace of the render gate

const sb = {
  window: { LoadingScreenRuntime: { coversWorld: () => sb.covered } }, covered: false,
  mainMenuOpen: false, menuOpen: false, paused: false, COVERED_WORLD_RENDER_INTERVAL_MS: 250, _lastCoveredWorldRenderAt: -Infinity,
  renders: 0, Infinity,
};
vm.createContext(sb);
vm.runInContext(state + '\nthis.__snap = window.HobunjiMenuWorldThrottle;', sb);
vm.runInContext('function renderWorldPasses(){ renders++; }\nfunction frame(now){\n' + frame + '\n}', sb);
const run = (t) => sb.frame(t);
const count = (from, to, step) => { const before = sb.renders; for (let t = from; t < to; t += step) run(t); return sb.renders - before; };

assert.equal(count(0, 1000, 16), 63, 'menu closed: every frame renders');
sb.mainMenuOpen = sb.menuOpen = sb.paused = true;
const open = count(1000, 2000, 16);
assert(open >= 7 && open <= 11, 'menu open: ~10 renders per second (got ' + open + ')');
assert(sb.__snap.snapshot().skipped > 40, 'skipped frames are counted');
sb.paused = false; sb.menuOpen = true; // Modal gates that reuse menuOpen without the main menu keep full rate.
sb.mainMenuOpen = false; sb.paused = true;
assert.equal(count(2000, 2160, 16), 10, 'modal reusing menuOpen/paused is not throttled');
sb.mainMenuOpen = true; sb.__snap.setEnabled(false);
assert.equal(count(2160, 2320, 16), 10, 'A/B switch restores per-frame rendering');
sb.__snap.setEnabled(true); sb.mainMenuOpen = sb.menuOpen = sb.paused = false;
assert.equal(count(2320, 2480, 16), 10, 'closing the menu renders on the very next frame');
console.log('PASS menu world render throttle: closed full rate, open ~10 Hz, modal gates unaffected, A/B switch, immediate resume');
