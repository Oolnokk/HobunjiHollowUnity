#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/den-nest-system.js'), 'utf8');
const localeRuntime = fs.readFileSync(path.join(root, 'docs/js/den-locale-runtime.js'), 'utf8');
const localeEditor = fs.readFileSync(path.join(root, 'docs/tools/locale-editor/den-encounter-authoring.js'), 'utf8');
const panelUi = fs.readFileSync(path.join(root, 'docs/js/panel-ui.js'), 'utf8');
const puktukRegistration = fs.readFileSync(path.join(root, 'docs/js/puktuk-den-nest-registration.js'), 'utf8');
const denLocale = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/locales/locale_den_mother_nest.json'), 'utf8'));
const localeIndex = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/locales/index.json'), 'utf8'));
const nestFurniture = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/furniture-authored/nest.json'), 'utf8'));
const branchNestFurniture = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/furniture-authored/nestBranch.json'), 'utf8'));

// Parse the new browser-side adapters in Node without executing them. This catches
// accidental syntax damage in the editor/runtime bootstraps before a manual test.
assert.doesNotThrow(() => new Function(localeRuntime), 'den locale runtime should remain valid JavaScript');
assert.doesNotThrow(() => new Function(localeEditor), 'den encounter editor sidecar should remain valid JavaScript');
assert.doesNotThrow(() => new Function(panelUi), 'shared panel loader should remain valid JavaScript');

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

assert.equal(nestFurniture.schema, 'hobunji_furniture_authored_runtime.v1');
assert.equal(nestFurniture.key, 'nest');
assert.equal(nestFurniture.footprint.w, 2);
assert.ok(nestFurniture.parts.some(part => part.kind === 'cup'), 'cavern nest is an ordinary editable authored cup/hoop furniture piece');
assert.equal(branchNestFurniture.schema, 'hobunji_furniture_authored_runtime.v1');
assert.equal(branchNestFurniture.key, 'nestBranch');
assert.ok(branchNestFurniture.parts.length >= 2, 'branch nest is independently editable authored furniture');

assert.equal(denLocale.schema, 'hobunji_locale.v1');
assert.equal(denLocale.category, 'den_encounter');
assert.ok(localeIndex.locales.some(entry => entry.id === denLocale.id && entry.category === 'den_encounter'),
  'the Den-Mother encounter is registered in the normal locale repository index');
assert.equal(denLocale.objects.find(object => object.id === 'den_nest')?.key, 'nest');
assert.equal(denLocale.npcAnchors.find(anchor => anchor.id === 'den_mother')?.facing, 'south',
  'the visible Locale Editor NPC anchor uses the editor facing vocabulary while the precise yaw remains in the transform');
const encounter = denLocale.meta?.denEncounter;
assert.ok(encounter?.nest?.transform && encounter?.motherSpawn?.transform, 'locale stores precise nest and Den-Mother transforms');
assert.ok(encounter.clutchSpawns.length >= 3, 'locale exposes multiple possible egg/baby slots');
for (const target of [encounter.nest, encounter.motherSpawn, ...encounter.clutchSpawns]) {
  for (const field of ['x','y','z','rx','ry','rz','sx','sy','sz']) {
    assert.equal(typeof target.transform[field], 'number', `${target.id || target.anchorId || target.objectId} has numeric ${field}`);
  }
}

assert.match(localeEditor, /Den encounter transforms/,
  'Locale Editor exposes the encounter authoring panel');
assert.match(localeEditor, /TRANSFORM_FIELDS = \['x','y','z','rx','ry','rz','sx','sy','sz'\]/,
  'the editor exposes full position, rotation, and scale rather than X/Z only');
assert.match(localeEditor, /localeDenAddClutch[\s\S]*?localeDenDuplicate[\s\S]*?localeDenRemove/,
  'clutch points can be added, duplicated, and removed in the editor');
assert.match(localeEditor, /pointerdown[\s\S]*?pointermove[\s\S]*?transform\.x = snapValue\(world\.x\)[\s\S]*?transform\.z = snapValue\(world\.z\)/,
  'Den-Mother and clutch points can be dragged manually in the top-down plan');
assert.match(localeEditor, /api\.getWorkspace = \(\) => mergeWorkspace\(rawGetWorkspace\(\)\)/,
  'den encounter metadata is merged through the normal Locale Editor workspace bridge');
assert.match(localeEditor, /saveLocalesOverrideBtn[\s\S]*?map\(exportLocale\)[\s\S]*?setOverride\('locales'/,
  'the local-override button explicitly exports den-aware locale documents instead of bypassing the sidecar');
assert.match(localeEditor, /function stopNativeExport\(event\)[\s\S]*?stopImmediatePropagation\(\)/,
  'den-aware export hooks can suppress the stale inline export handler');
assert.match(localeEditor, /copyJsonBtn[\s\S]*?copyButton\.addEventListener\('click'[\s\S]*?stopNativeExport\(event\)/,
  'Copy JSON is intercepted by the den-aware export hook');
assert.match(localeEditor, /downloadJsonBtn[\s\S]*?downloadButton\.addEventListener\('click'[\s\S]*?stopNativeExport\(event\)/,
  'Download JSON is intercepted by the den-aware export hook');
assert.match(localeEditor, /if \(store\.byLocale\[locale\.id\]\) return store\.byLocale\[locale\.id\];/,
  'switching away and back cannot overwrite live den edits with the inline editor stale meta copy');
assert.match(panelUi, /den-encounter-authoring\.js\?v=20260914a/,
  'the den authoring sidecar loads automatically whenever the Locale Editor opens');

assert.match(localeRuntime, /getOverride\?\.\('locales'\)/,
  'runtime can playtest the Locale Editor local override instead of requiring a committed JSON edit');
assert.match(localeRuntime, /AuthoredFurniture\.load\('nest'\)[\s\S]*?AuthoredFurniture\.load\('nestBranch'\)/,
  'runtime preloads both repo-authored nest furniture pieces');
assert.match(localeRuntime, /removeLegacyCavernMarker\(scene, nest\)[\s\S]*?AuthoredFurniture\.buildGroup\(data, 0xc9a227\)/,
  'the old 2x2 cavern box marker is replaced by the actual authored nest furniture');
assert.match(localeRuntime, /AUTHORED_NEST_KEYS[\s\S]*?authoredDecorativeFurniture[\s\S]*?nestBranch/,
  'wildlife branch nests route through the same authored furniture runtime');
assert.match(localeRuntime, /watchWildlifeSpawnAssignment[\s\S]*?Object\.getOwnPropertyDescriptor\(window, 'WildlifeSpawn'\)[\s\S]*?patchWildlifeSpawn/,
  'runtime survives its actual pre-WildlifeSpawn script order by chaining a later-global assignment trap');
assert.match(localeRuntime, /findCurrentDenMother[\s\S]*?creature\?\.isDenMother[\s\S]*?applyMotherTransform/,
  'the live cavern Den-Mother is resolved and driven from the locale spawn transform');
assert.match(localeRuntime, /mother\.x = \(center\.x \+ t\.x\) \* denDeps\.TILE[\s\S]*?mother\.homeX = mother\.x[\s\S]*?mother\.groupRot = ry/,
  'Den-Mother authored world offsets are converted to creature simulation pixels and become its home/facing');
assert.match(localeRuntime, /root\.position\.set\(base\.x \+ t\.x, base\.y \+ initial\.lift \+ t\.y, base\.z \+ t\.z\)/,
  'egg/baby roots consume locale transforms directly in Three world-space without multiplying offsets by TILE');
assert.match(localeRuntime, /syncBranchNests[\s\S]*?decorateNest\(nest, \{ branch: true \}\)[\s\S]*?applyAuthoredClutch/,
  'branch eggs/babies receive the same authored clutch layout while keeping nestBranch furniture');
assert.match(localeRuntime, /const result = originalUpdate\(dt\);[\s\S]*?syncCurrentDen\(\);[\s\S]*?return result/,
  'authored transforms run after DenNestSystem layout so the old layout cannot overwrite them in the same frame');
assert.match(puktukRegistration, /den-locale-runtime\.js\?v=20260914b/,
  'game bootstrap points at the locale-driven runtime');

console.log('Individual nest rendering plus authored furniture/locale/Den-Mother/clutch transform checks passed.');
