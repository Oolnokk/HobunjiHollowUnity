#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));

const locale = json('docs/config/locales/locale_animal_den_entrance.json');
const localeIndex = json('docs/config/locales/index.json');
const furnitureIndex = json('docs/config/furniture-authored/index.json');
const editor = read('docs/tools/locale-editor/index.html');
const preview = read('docs/tools/locale-editor/locale-preview3d.js');
const renderer = read('docs/js/zone-den-totem-features.js');
const collision = read('docs/js/grid-tile-accessors.js');
const generator = read('docs/js/wilderness-map-generator.js');
const placement = read('docs/js/locale-terrain-placement.js');

const inlineScripts = [...editor.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(code => code.trim());
for (const [index, code] of inlineScripts.entries()) {
  assert.doesNotThrow(() => new Function(code), 'Locale Editor inline script ' + index + ' must parse');
}

assert.equal(locale.schema, 'hobunji_locale.v1');
assert.equal(locale.category, 'den_entrance');
const cave = locale.objects.find(object => object.key === 'cave_small');
assert(cave, 'animal den entrance locale must expose cave_small as an editable object');
assert.equal(cave.kind, 'cave_entrance');
assert.equal(cave.visual?.renderer, 'cave_small');
assert.equal(cave.collision?.mode, 'auto', 'default template must preserve the legacy doorway-gap collider until explicitly changed');
assert(localeIndex.locales.some(entry => entry.id === locale.id && entry.category === 'den_entrance'),
  'animal den entrance template must be discoverable in the normal Locale Editor library');

assert(furnitureIndex.furniture.length >= 50, 'full authored furniture manifest should expose the repository catalog, not a tiny palette');
for (const key of ['bench','campfire','lifeTotem','stonePedestal','woodenDoor']) {
  assert(furnitureIndex.furniture.some(entry => entry.key === key), 'missing authored furniture manifest key ' + key);
}

assert.match(editor, /AUTHORED_FURNITURE_INDEX_URL/);
assert.match(editor, /loadFullFurniturePalette/);
assert.match(editor, /kind:'cave_entrance', key:'cave_small'/);
assert.doesNotMatch(editor, /kind:'structure', key:'structure', label:'Structure \(house\/tent\/shrine\)'/,
  'new locale authoring must not offer the old ambiguous generic Structure palette item');
assert.match(editor, /id="insCollisionMode"/);
assert.match(editor, /Custom rectangle/);
assert.match(editor, /id="insVisualSX"/);
assert.match(editor, /id="insVisualOX"/);
assert.match(editor, /Red dashed outlines are explicit colliders/);

assert.match(preview, /addAuthoredFurnitureObject/);
assert.match(preview, /localeCollider_/);
assert.match(renderer, /ANIMAL_DEN_ENTRANCE_LOCALE_ID = 'locale_animal_den_entrance'/);
assert.match(renderer, /loadAnimalDenEntranceLocaleObject/);
assert.match(renderer, /denEntranceCollisionFor/);
assert.match(renderer, /visual\.offsetX/);
assert.match(renderer, /visual\.offsetY/);
assert.match(renderer, /visual\.offsetZ/);

assert.match(collision, /function isLocaleObjectCollisionTile/);
assert.match(collision, /ZoneDenTotemFeatures\?\.denEntranceCollisionFor/);
assert.match(generator, /o\.kind === 'cave_entrance'/);
assert.match(generator, /localeColliderOwnerId/);
assert.match(generator, /collision: o\.collision/);
assert.match(placement, /function scaledObjectCollision/);
assert.match(placement, /collision: scaledObjectCollision/);

console.log('Editable den entrance locale, full furniture palette, cave transform, and collider authoring checks passed.');
