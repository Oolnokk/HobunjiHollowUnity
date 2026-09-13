'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('docs/snow-runtime-test.html', 'utf8');
const micro = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');
const probe = fs.readFileSync('docs/js/environment-surface-pixel-probe.js', 'utf8');

assert.match(source, /fetch\(`index\.html\?surface-test=\$\{CACHE_KEY\}`/, 'test entrypoint must load the current real index');
assert.match(source, /__disabledForMicroPlateauTest: true/, 'test entrypoint must preinstall a legacy-runtime blocker before rain-planes loads');
assert.match(source, /mode: 'disabled'/, 'legacy environment surface debug state must explicitly report disabled mode');
assert.doesNotMatch(source, /environment-surface-runtime\.js\?v=\$\{CACHE_KEY\}/, 'test entrypoint must not explicitly load the old triangle-copy runtime');
assert.doesNotMatch(source, /environment-surface-near-priority\.js\?v=\$\{CACHE_KEY\}/, 'obsolete legacy-runtime priority adapter must not run in the micro-only test');
assert.match(source, /rain-planes\.js\?v=\$\{CACHE_KEY\}/, 'RainPlanes must still receive a fresh cache key');
assert.match(source, /environment-surface-micro-plateau\.js\?v=\$\{CACHE_KEY\}/, 'tile-driven micro-plateau renderer must load before game boot');
assert.match(source, /environment-surface-pixel-probe\.js\?v=\$\{CACHE_KEY\}/, 'micro snow Pixel Probe adapter must load before Pixel Probe is assigned');
assert.match(source, /pixel-probe\.js\?v=\$\{CACHE_KEY\}/, 'Pixel Probe must bypass stale cached diagnostics');
assert.match(source, /LEGACY snow=/, 'bottom-left status must make legacy-runtime state explicit');
assert.match(source, /tiles=/, 'bottom-left status must expose built tile count');
assert.match(source, /lastBuild=/, 'bottom-left status must expose the synchronous build time');
assert.match(micro, /tile-driven-shallow-plateau-v3/, 'replacement renderer must advertise direct-grid-height plateau geometry');
assert.match(micro, /CHUNK_TILES = 16/, 'replacement output must be chunked');
assert.match(probe, /Environment surface:/, 'Pixel Probe adapter must append an environment surface diagnostic line');
assert.match(probe, /builtTiles/, 'Pixel Probe must expose built tile count');
assert.match(probe, /buildCount/, 'Pixel Probe must expose how many times the zone has been (re)built');

console.log('Snow runtime micro-only entrypoint checks passed.');
