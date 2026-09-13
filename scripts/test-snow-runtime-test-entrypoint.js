'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('docs/snow-runtime-test.html', 'utf8');
const priority = fs.readFileSync('docs/js/environment-surface-near-priority.js', 'utf8');
const micro = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');
const probe = fs.readFileSync('docs/js/environment-surface-pixel-probe.js', 'utf8');

assert.match(source, /fetch\(`index\.html\?surface-test=\$\{CACHE_KEY\}`/, 'test entrypoint must load the current real index');
assert.match(source, /rain-planes\.js\?v=\$\{CACHE_KEY\}/, 'RainPlanes must receive a fresh cache key');
assert.match(source, /environment-surface-runtime\.js\?v=\$\{CACHE_KEY\}/, 'environment surface runtime must be loaded explicitly with a fresh cache key');
assert.match(source, /environment-surface-near-priority\.js\?v=\$\{CACHE_KEY\}/, 'nearest-player priority adapter must load before game boot');
assert.match(source, /environment-surface-micro-plateau\.js\?v=\$\{CACHE_KEY\}/, 'tile-driven micro-plateau snow renderer must load before game boot');
assert.match(source, /environment-surface-pixel-probe\.js\?v=\$\{CACHE_KEY\}/, 'environment surface Pixel Probe adapter must load before Pixel Probe is assigned');
assert.match(source, /pixel-probe\.js\?v=\$\{CACHE_KEY\}/, 'Pixel Probe must also bypass stale cached diagnostics');
assert.match(source, /EnvironmentSurfaceMicroPlateau/, 'test page must expose replacement snow renderer state without DevTools');
assert.match(source, /MICRO plateau=/, 'bottom-left status must visibly distinguish replacement micro-plateau snow from legacy runtime state');
assert.match(priority, /terrainRenderChunkSource === true/, 'priority adapter must target renderer spatial wrappers');
assert.match(priority, /chunkDistanceSq/, 'priority adapter must rank chunks by player distance');
assert.match(priority, /settled near-player spatial priority bootstrap/, 'priority adapter must cancel stale boot-position work after loaded-player placement settles');
assert.match(micro, /tile-driven-shallow-plateau/, 'replacement renderer must advertise tile-driven shallow plateau geometry');
assert.match(micro, /SNOW_THICKNESS = 0\.12/, 'replacement snow skin must stay intentionally shallow');
assert.match(probe, /Environment surface:/, 'Pixel Probe adapter must append an environment surface diagnostic line');
assert.match(probe, /EnvironmentSurfaceMicroPlateau/, 'Pixel Probe must expose the replacement renderer state');
assert.match(probe, /micro=/, 'Pixel Probe must include compact micro-plateau status in the copied report');

console.log('Snow runtime cache-bypass entrypoint checks passed.');
