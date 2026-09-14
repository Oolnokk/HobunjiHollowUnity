#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/den-nest-system.js'), 'utf8');

assert.match(source, /const _nestContentStates = new WeakMap\(\)/,
  'individual clutch visuals are session-only and do not replace the persisted remaining count');
assert.match(source, /const NEST_CONTENT_ALPHA_THRESHOLD = 16/,
  'nest interaction has an explicit opaque-pixel alpha threshold');
assert.match(source, /raycaster\.intersectObject\(record\.root, true\)[\s\S]*?_alphaAtIntersection\(hit\)[\s\S]*?alpha < NEST_CONTENT_ALPHA_THRESHOLD/,
  'raycast candidates are accepted only when the actual sprite pixel under the ray is opaque');
assert.doesNotMatch(source, /focusCandidates\(\[\{ type: 'nest'/,
  'the old broad whole-nest focus box is no longer used by DenNestSystem');
assert.match(source, /const spritePath = _itemSpritePath\(def\)[\s\S]*?source: 'png'[\s\S]*?_makeEmojiCanvas/,
  'egg visuals prefer the authored PNG item sprite and retain an emoji fallback');
assert.match(source, /new THREE\.PlaneGeometry\(width, NEST_EGG_HEIGHT\)/,
  'eggs are upright world planes rather than nest-wide interaction markers');
assert.match(source, /window\.LivestockNursery\?\.constants\?\.BABY_SCALE/,
  'nest babies reuse the Nursery baby scale when available');
assert.match(source, /buildAnimalPlaneAvatarModel\(THREE, idleUrl,[\s\S]*?applyCreatureBillboardScale/,
  'nest babies reuse the normal Nursery-style animal PNG-plane/genetics pipeline');
assert.match(source, /avatarRef\.group\.scale\.y \*= sleepScaleY/,
  'nest babies reuse the barn sleeping flattening instead of receiving roaming behavior');
assert.match(source, /renderer\.composeFrame\(kind, 'idle', nest\.genotype, false\)/,
  'sleeping babies preserve their inherited genotype appearance');
assert.match(source, /_activeNestContentHoldId !== contentId[\s\S]*?setNestHoldT\(0\)/,
  'moving the reticle to a different egg/baby resets the take hold');
assert.match(source, /_removeContentRecord\(state, content\)[\s\S]*?nest\.remaining = Math\.max\(0, Number\(nest\.remaining\) - 1\)/,
  'taking one focused clutch member removes that exact visual and decrements the existing clutch count once');
assert.match(source, /window\.FarmAnimals\.queueItemGenotype\(nest\.itemKey, nest\.genotype\)/,
  'existing genotype transfer into the collected inventory item remains intact');
assert.match(source, /function currentAimedNest\(\) \{\s*return _currentAimedNestContent\(\)\?\.nest \|\| null;/,
  'the public currentAimedNest compatibility API still returns the aggregate nest for existing XP wrappers');
assert.match(source, /window\.__denNestContentDebug = \{ snapshot: debugSnapshot \}/,
  'mobile-visible nest content diagnostics remain available without a console');

console.log('Individual nest egg/baby rendering and opaque-pixel interaction checks passed.');
