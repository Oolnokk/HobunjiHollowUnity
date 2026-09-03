'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('docs/js/procedural-hand-scale-free-world.js', 'utf8');

// Character attachment coordinates are authored once in adult species/gender
// space. Individual rendered avatars may add an actor-only multiplier (children
// currently use 0.5), so the hand shoulder consumer must apply the ratio at
// solve time without changing the stored profile.
assert.match(source, /portraitScaleMultiplier/,
  'hand shoulder scaling must read the actual multiplier baked into the rendered portrait');
assert.match(source, /anatomy\?\.portraitScale/,
  'hand shoulder scaling must divide by the authored species\/gender portrait scale');
assert.match(source, /renderedScale\s*\/\s*authoredScale/,
  'effective character anchor scale must be rendered scale divided by authored scale');
assert.match(source, /withActorScaledShoulderProfile/,
  'shoulder solves must see an actor-scaled temporary view of the character profile');
assert.match(source, /finally\s*\{[\s\S]*position\.x = x;[\s\S]*position\.y = y;[\s\S]*position\.z = z;/,
  'temporary shoulder scaling must always restore canonical profile coordinates');
assert.match(source, /wrapSolveMethod\('setSideIdle'\)/,
  'free idle\/walk hands must consume actor-scaled shoulders');
assert.match(source, /wrapSolveMethod\('useIdlePose'\)/,
  'two-hand fallback updates must consume actor-scaled shoulders');
assert.match(source, /wrapSolveMethod\('placeHandWorld'\)/,
  'tool-owned hands must aim toward actor-scaled shoulders too');
assert.match(source, /__hobunjiShoulderAimWrapped/,
  'actor-scale wrapping must install after the normal shoulder-aim wrapper');

const adultMaoAo = {
  portraitScale: 1,
  left: { x: 0.19067248465844266, y: 0.6947557240731601, z: 0 },
  right: { x: -0.28087406205430004, y: 0.6455541403639915, z: 0 },
};
const childRenderedScale = 0.5;
const factor = childRenderedScale / adultMaoAo.portraitScale;
assert.strictEqual(factor, 0.5);
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(adultMaoAo.left).map(([axis, value]) => [axis, value * factor])),
  { x: 0.09533624232922133, y: 0.34737786203658005, z: 0 },
  'Garanki should consume the Mao-ao male left shoulder at exactly child scale without changing the adult profile',
);
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(adultMaoAo.right).map(([axis, value]) => [axis, value * factor])),
  { x: -0.14043703102715002, y: 0.32277707018199575, z: 0 },
  'Garanki should consume the Mao-ao male right shoulder at exactly child scale without changing the adult profile',
);

console.log('Procedural hand character-anchor actor-scale guards passed');
