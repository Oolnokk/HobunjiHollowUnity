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
assert.match(source, /processed=/, 'bottom-left status must expose scan progress instead of looking frozen at zero accepted triangles');
assert.match(source, /chunks=/, 'bottom-left status must expose incremental chunk-build progress');
assert.match(micro, /tile-driven-shallow-plateau-v2/, 'replacement renderer must advertise bounded tile-driven plateau geometry');
assert.match(micro, /CHUNK_TILES = 16/, 'replacement output must be chunked');
assert.match(probe, /Environment surface:/, 'Pixel Probe adapter must append an environment surface diagnostic line');
assert.match(probe, /processedTriangles/, 'Pixel Probe must expose actual micro scan progress');
assert.match(probe, /builtChunks/, 'Pixel Probe must expose incremental micro geometry publishing');

console.log('Snow runtime micro-only entrypoint checks passed.');
