#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Placement = require('../docs/js/den-cliff-placement.js');

const templatePaths = [
  'docs/config/locales/locale_animal_den_entrance.json',
  'docs/config/locales/locale_animal_den_entrance_small.json',
]; // Both editable den entrance sizes must retain their own authored masks.
const templates = templatePaths.map(path => JSON.parse(fs.readFileSync(path, 'utf8'))); // Real locale files, never inferred geometry.
const context = { console, DenCliffPlacement: Placement }; // Browser-style dependencies for the actual runtime collision modules.
context.window = context;
context.fetch = async url => {
  const name = String(url).split('/').pop(); // Resolves zone-feature locale requests to the actual checked-in files.
  const locale = templates.find(item => name === item.id + '.json'); // Only the two expected template requests may resolve.
  assert.ok(locale, 'unexpected locale request: ' + url);
  return { ok: true, json: async () => locale };
};
vm.createContext(context);
for (const file of ['docs/js/zone-den-totem-features.js', 'docs/js/grid-tile-accessors.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
context.ZoneDenTotemFeatures.init({});

async function run() {
  const area = 'authored-den-entrance-test'; // Shared test area for actual runtime den collision queries.
  for (const template of templates) {
    await context.ZoneDenTotemFeatures.loadAnimalDenEntranceLocale(template.id);
    const cave = template.objects.find(object => object.key === 'cave_small'); // Authored visual object carrying the custom collider.
    const den = { x: 10, y: 10, w: cave.w * 2, h: cave.h * 2,
      cliffBacked: true, entranceTemplateId: template.id,
      mouthAnchor: { x: 10 + Math.floor(cave.w), y: 13 } }; // Standard final-grid 2x den footprint.
    const state = context.ZoneDenTotemFeatures.denEntranceCollisionState(den); // Actual den runtime translates source rectangles into world tiles.
    assert.equal(state.useLegacyCave, false, template.id + ' must use authored collision instead of automatic doorway rules');
    assert.equal(state.rects.length, 1, template.id + ' must retain a single rear collider rectangle');
    assert.equal(state.rects[0].w, den.w);
    assert.equal(state.rects[0].h, 3, 'rear three final-grid rows stay solid');

    const open = Placement.authoredWalkableTiles(den, template); // Shared overlay filter must agree with the runtime collider.
    assert.ok(open && open.size, 'edited template must identify open rock-overlay cells');
    context.GridTileAccessors.init({ _zoneLayouts: new Map([[area, { dens: [den] }]]) });
    for (let row = den.y; row < den.y + den.h; row++) {
      for (let col = den.x; col < den.x + den.w; col++) {
        const expectedBlocked = row < den.y + 3; // Authored rectangle, NOT the previous fixed three-column entrance swathe.
        const key = `${col},${row}`;
        assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(col, row, area), expectedBlocked, template.id + ' movement at ' + key);
        assert.equal(open.has(key), !expectedBlocked, template.id + ' rock overlay at ' + key);
      }
    }
    for (const col of [den.x, den.x + 1, den.x + den.w - 2, den.x + den.w - 1]) {
      assert.ok(open.has(`${col},${den.y + 3}`), 'the outer two columns on both sides must open at the cave mouth');
    }
    den.collapsed = true;
    assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(den.x, den.y + 3, area), true, 'collapsed cave remains sealed');
  }

  const legacy = structuredClone(templates[0]); // Regression: unmodified auto collider templates keep the historic gap.
  legacy.objects.find(object => object.key === 'cave_small').collision = { mode: 'auto' };
  assert.equal(Placement.authoredWalkableTiles({ x: 0, y: 0, w: 6, h: 6 }, legacy), null);

  const generator = fs.readFileSync('docs/js/wilderness-map-generator.js', 'utf8'); // Guards initial wilderness tile painting against reverting to hardcoded entrance swathes.
  const wildlife = fs.readFileSync('docs/js/wildlife-spawn.js', 'utf8'); // Guards relocated dens against repainting the open columns as rock.
  assert.match(generator, /authoredWalkableTiles\?\.\(object, template\)/);
  assert.match(wildlife, /authoredWalkableTiles\?\.\(den, locale\)/);
  console.log('Locale-authored cave side clearance: both den sizes, runtime collision, rock overlays, collapse and legacy fallback validated');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
