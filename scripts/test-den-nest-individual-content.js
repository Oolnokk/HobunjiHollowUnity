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
assert.match(source, /record\.hitPlanes = hitPlanes[\s\S]*?record\.alphaReady = hitPlanes\.length > 0/,
  'baby interaction is enabled only after the actual front/back sprite planes are tagged');
assert.match(source, /raycaster\.intersectObjects\(hitPlanes, false\)[\s\S]*?_alphaAtIntersection\(hit\)[\s\S]*?alpha < NEST_CONTENT_ALPHA_THRESHOLD/,
  'raycast candidates test only tagged sprite planes and accept only opaque pixels');
assert.doesNotMatch(source, /raycaster\.intersectObject\(record\.root, true\)/,
  'nest targeting no longer recursively raycasts bones/helpers in a baby avatar rig');
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
assert.match(source, /NEST_BABY_BASKET_LIFT[\s\S]*?uprightGroundLift \* sleepScaleY\) \+ NEST_BABY_BASKET_LIFT/,
  'sleeping babies retain their flattened floor contact while being lifted above the decorative nest rim');
assert.match(source, /renderer\.composeFrame\(kind, 'idle', nest\.genotype, false\)[\s\S]*?_loadImageCanvas\(idleUrl\)/,
  'sleeping babies preserve inherited genotype appearance and fall back to raw idle art if composition fails');
assert.match(source, /function _queueBabyBuild[\s\S]*?Promise\.resolve\(_buildBabyContent\(state, record\)\)\.catch/,
  'live-birth baby build failures cannot escape as unhandled promise rejections');
assert.match(source, /baby build failed stage=\$\{stage\}/,
  'baby build failures are recorded with an explicit stage for in-game diagnostics');
assert.match(source, /currentPlayerInteractionRay\?\.\(\) \|\| deps\.getPlayerInteractionRay\?\.\(\) \|\| deps\.getPlayerAimRay\?\.\(\)/,
  'nest raycasts accept both the legacy and current interaction-ray dependency names');
assert.match(source, /_activeNestContentStates\.add\(state\); \/\/ A previously disposed session state can be revisited/,
  'revisiting the same nest object re-registers its session state for rendering and cleanup');
assert.match(source, /_activeNestContentHoldId !== contentId[\s\S]*?setNestHoldT\(0\)/,
  'moving the reticle to a different egg/baby resets the take hold');
assert.match(source, /_removeContentRecord\(state, content\)[\s\S]*?nest\.remaining = Math\.max\(0, Number\(nest\.remaining\) - 1\)/,
  'taking one focused clutch member removes that exact visual and decrements the existing clutch count once');
assert.match(source, /window\.FarmAnimals\.queueItemGenotype\(nest\.itemKey, nest\.genotype\)/,
  'existing genotype transfer into the collected inventory item remains intact');
assert.match(source, /function currentAimedNest\(\) \{\s*return _currentAimedNestContent\(\)\?\.nest \|\| null;/,
  'the public currentAimedNest compatibility API still returns the aggregate nest for existing XP wrappers');
assert.match(source, /babyRecords\.push\([\s\S]*?stage: record\.buildStage[\s\S]*?hitPlanes: record\.hitPlanes\?\.length/,
  'mobile-visible diagnostics expose each baby record build stage and target-plane readiness');
assert.match(source, /window\.__denNestContentDebug = \{ snapshot: debugSnapshot \}/,
  'mobile-visible nest content diagnostics remain available without a console');

console.log('Individual nest egg/baby rendering, guarded live-birth build, and opaque-pixel interaction checks passed.');
