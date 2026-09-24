const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..'); // Used to resolve shipped loader/runtime files from this regression test.
const house = fs.readFileSync(path.join(root, 'docs/js/house-pieces.js'), 'utf8'); // Used to verify natural-surface child scripts share one cache generation.
const index = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Used to verify the parent house-pieces loader is itself cache-busted.
const post = fs.readFileSync(path.join(root, 'docs/js/natural-surface-stretch-post-jigsaw.js'), 'utf8'); // Used to verify mobile-visible diagnostics expose the loaded generation.

const parentMatch = index.match(/js\/house-pieces\.js\?v=([^\"'\s<]+)/); // Used to capture the version that should propagate into the natural-surface child stack.
assert(parentMatch, 'docs/index.html must load house-pieces.js with an explicit cache generation');
const parentVersion = parentMatch[1]; // Used to compare the shipped parent generation against the regression target.
assert.strictEqual(parentVersion, '20260924edgepreserve2', 'house-pieces loader must bust the stale natural-surface UV generation');

assert(
  house.includes("const naturalSurfaceUvVersion = current?.src ? (new URL(current.src).searchParams.get('v') || '20260924edgepreserve2') : '20260924edgepreserve2'"),
  'house-pieces must derive the natural-surface child generation from its own script URL'
);
assert(
  house.includes('window.HobunjiNaturalSurfaceUvLoaderVersion = naturalSurfaceUvVersion'),
  'house-pieces must expose the loaded natural-surface generation for mobile diagnostics'
);

const naturalSurfaceModules = [ // Used to prove the complete tightly-coupled UV ownership stack shares the inherited cache generation.
  'surface-stretch-uv-furniture.js',
  'natural-surface-cliff-ridge-isolation.js',
  'natural-surface-stretch-runtime.js',
  'natural-surface-jigsaw-exclusion.js',
  'wilderness-cliff-surface-parity.js',
  'natural-surface-stretch-post-jigsaw.js',
];
for (const file of naturalSurfaceModules) {
  assert(
    house.includes(`naturalSurfaceScript('${file}')`),
    `${file} must inherit the house-pieces cache generation`
  );
  const legacyPrefix = `${file}?v=2026090`; // Used to reject the stale hard-coded child cache keys that caused mixed mapper generations.
  assert(!house.includes(legacyPrefix), `${file} must not retain an older hard-coded September cache key`);
}

assert(
  post.includes("loaderGeneration=${window.HobunjiNaturalSurfaceUvLoaderVersion || '-'}"),
  'Pixel Probe natural-surface diagnostics must report the loaded cache generation'
);

console.log('Natural-surface UV loader cache regression checks passed.');
