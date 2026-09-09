'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repository root used for production-file assertions below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const config = JSON.parse(read('docs/config/harlyao-night-march.json')); // Shared authored music/Terror tuning under test.
const terrorSource = read('docs/js/harlyao-terror.js'); // Cached-stage Terror status plus movement composition.
const musicSource = read('docs/js/harlyao-night-march-music.js'); // Exclusive soundtrack with throttled chunk-distance checks.
const atmosphereSource = read('docs/js/harlyao-night-march-atmosphere.js'); // Stack darkness and lantern-radius rendering adapter.
const loaderSource = read('docs/js/house-pieces.js'); // Parser-time order must install movement hooks before game.js init.
const probeSource = read('docs/js/harlyao-night-march-pixel-probe.js'); // Mobile diagnostics expose cadence and Terror effects.

assert.equal(config.music.distanceCheckMs, 500, 'player-to-army chunk distance should refresh on a slow 500ms cadence rather than every frame');
assert.equal(config.music.stages.length, 6, 'six soundtrack bands define six inverse Terror stack levels');
assert.equal(config.terror.movementSlowPerStack, 0.03, 'each Terror stack trims movement by three percent');
assert.equal(config.terror.lanternRadiusMinMultiplier, 0.5, 'maximum Terror shrinks carried/watch lantern radius to exactly half its configured value');
assert.equal(config.terror.darknessAlphaPerStack, 0.045, 'each Terror stack adds a small increment of unlit darkness');
assert.equal(config.terror.maxDarknessAlpha, 0.27, 'six default stacks cap the incremental Terror darkness at 27 percent');

assert.match(musicSource, /now - lastDistanceCheckAt < distanceCheckMs\(\)/, 'music reuses cached proximity inside the authored check interval');
assert.match(musicSource, /chunkChanged = nextKey !== proximityKey/, 'crossing a player/army chunk boundary invalidates proximity immediately');
assert.match(musicSource, /distanceChecks\+\+/, 'debug state counts actual distance checks rather than frames');
assert.match(musicSource, /Math\.hypot\(player\.cx - army\.cx, player\.cz - army\.cz\)/, 'cached proximity still uses the existing Euclidean chunk distance');
assert.match(musicSource, /currentGain = Math\.max\(0, interpolatedGain\(\)\)/, 'audio volume interpolation remains smooth every frame while only distance math is throttled');

assert.match(terrorSource, /window\.HarlyaoNightMarchMusic\?\.debugSnapshot/, 'Terror consumes the soundtrack cached stage instead of performing its own distance calculation');
assert.doesNotMatch(terrorSource, /Math\.hypot/, 'Terror must not duplicate player-to-army distance work');
assert.match(terrorSource, /EffectBuffBar\.registerProvider\(SOURCE_ID, effectEntry\)/, 'Terror is rendered through the shared buff/debuff bar');
assert.match(terrorSource, /original\(\) \* movementMultiplierFor\(\)/, 'on-foot Combat movement multiplier composes with Terror instead of replacing ability speed effects');
assert.match(terrorSource, /baseAlchemySpeed\(\) \* movementMultiplierFor\(\)/, 'mounted movement receives the same Terror multiplier through its injected speed hook');
assert.match(terrorSource, /count - Math\.floor\(index\)/, 'stack count rises inversely with soundtrack distance stage');

assert.match(atmosphereSource, /getDarknessAlpha/, 'atmosphere reads cached Terror darkness rather than distance');
assert.match(atmosphereSource, /getLanternRadiusMultiplier/, 'atmosphere reads cached Terror lantern radius multiplier');
assert.match(atmosphereSource, /base\.radiusTiles \*= radiusMul/, 'carried/watch lantern outer radius is actually scaled by Terror');
assert.match(atmosphereSource, /base\.clarityRadiusTiles \*= radiusMul/, 'lantern clarity core shrinks proportionally with its outer radius');
assert.match(atmosphereSource, /rgba\(0,0,0,\$\{terrorAlpha\}\)/, 'Terror adds its own black layer before local lights are restored');
assert(atmosphereSource.indexOf('terrorAlpha') < atmosphereSource.indexOf('drawLanternMasks();'), 'Terror darkness is applied first so lantern holes affect only the final unlit darkness');
assert(atmosphereSource.indexOf('drawLanternMasks();') < atmosphereSource.indexOf('drawFurnitureLightMasks();'), 'carried/watch and furniture lights are both restored after Terror darkness');

assert.match(loaderSource, /\['HarlyaoTerror', 'harlyao-terror\.js\?v=[^']+'\]/, 'Terror module is part of the parser-time gameplay bundle');
assert(loaderSource.indexOf("['HarlyaoNightMarchMusic'") < loaderSource.indexOf("['HarlyaoTerror'"), 'music cached stage exists before Terror samples it');
assert(loaderSource.indexOf("['HarlyaoTerror'") < loaderSource.indexOf("['HarlyaoNightMarchPixelProbe'"), 'Terror diagnostics exist before Pixel Probe formats them');
assert.match(probeSource, /terror=.*move.*dark.*lantern/, 'mobile Pixel Probe line includes Terror stacks, movement, darkness, and lantern scaling');
assert.match(probeSource, /checks.*ms/, 'mobile Pixel Probe line exposes throttled distance-check count/cadence');

const context = {
  console,
  performance: { now: () => 1000 },
  fetch: async () => ({ ok: true, json: async () => config }),
  window: {
    EffectBuffBar: { registerProvider: () => true, refresh: () => {} },
    Combat: { getMovementSpeedMul: () => 1 },
    Mounts: { init: () => {} },
    HarlyaoNightMarchMusic: { debugSnapshot: () => ({ active: false, stageIndex: -1 }) },
    __farmLog: () => {},
  },
}; // No setInterval: VM checks pure stack/effect math without creating asynchronous test timers.
vm.runInNewContext(terrorSource, context, { filename: 'harlyao-terror.js' });
const api = context.window.HarlyaoTerror?.__test;
assert(api, 'Terror exposes pure tuning helpers for regressions');
assert.equal(api.stacksForStage(0, 6), 6, 'same-chunk/full-volume stage gives six Terror stacks');
assert.equal(api.stacksForStage(1, 6), 5);
assert.equal(api.stacksForStage(5, 6), 1, 'farthest/faintest soundtrack stage still gives one Terror stack');
assert(Math.abs(api.movementMultiplierFor(6) - 0.82) < 1e-9, 'six stacks slow movement by 18 percent at default tuning');
assert(Math.abs(api.darknessAlphaFor(6) - 0.27) < 1e-9, 'six stacks add the configured 27 percent unlit darkness');
assert(Math.abs(api.lanternRadiusMultiplierFor(6) - 0.5) < 1e-9, 'six stacks cut lantern radius to exactly 50 percent');

new vm.Script(musicSource, { filename: 'harlyao-night-march-music.js' });
new vm.Script(atmosphereSource, { filename: 'harlyao-night-march-atmosphere.js' });
console.log('Harlyao Terror regression passed.');
