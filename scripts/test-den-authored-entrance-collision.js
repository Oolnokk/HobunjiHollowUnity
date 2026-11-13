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

  // Cached geometry must survive repeated A* tile checks without rescanning the locale.
  const authored = templates[0]; // Real den locale supplies the collision fixture.
  const cave = authored.objects.find(object => object.key === 'cave_small'); // Reference transform for authored colliders.
  const moving = { x:20, y:20, w:cave.w*2, h:cave.h*2, cliffBacked:true,
    entranceTemplateId:authored.id, mouthAnchor:{x:23,y:23} }; // Mutable den used to exercise cache invalidation.
  const initial = context.ZoneDenTotemFeatures.denEntranceCollisionState(moving); // First computed state.
  const before = context.ZoneDenTotemFeatures.denCollisionDebugSnapshot(); // Mobile-visible diagnostics before repeated lookups.
  for (let i=0; i<600; i++) assert.strictEqual(context.ZoneDenTotemFeatures.denEntranceCollisionState(moving), initial);
  const after = context.ZoneDenTotemFeatures.denCollisionDebugSnapshot(); // Verifies the expensive computation did not repeat.
  assert.equal(after.hits - before.hits, 600);
  assert.equal(after.builds, before.builds);

  moving.x += 7;
  const relocated = context.ZoneDenTotemFeatures.denEntranceCollisionState(moving); // Relocation recalculates world rectangles.
  assert.notStrictEqual(relocated, initial);
  assert.equal(relocated.rects[0].x, moving.x);
  moving.w *= 1.5;
  const resized = context.ZoneDenTotemFeatures.denEntranceCollisionState(moving); // Resizing recalculates collider scaling.
  assert.notStrictEqual(resized, relocated);
  assert.equal(resized.rects[0].w, moving.w);
  moving.mouthAnchor.x++;
  assert.notStrictEqual(context.ZoneDenTotemFeatures.denEntranceCollisionState(moving), resized);
  moving.entranceTemplateId = templates[1].id;
  assert.notStrictEqual(context.ZoneDenTotemFeatures.denEntranceCollisionState(moving), resized);

  // The authored furniture outside the footprint cannot be discarded by the new broad-phase.
  moving.entranceTemplateId = authored.id;
  const local = structuredClone(authored); // Independent edited locale; never modifies repository fixture data.
  const furniture = { id:'external_test', kind:'furniture', key:'test_prop', col:cave.col+cave.w+2,
    row:cave.row+1, w:1, h:1, collision:{mode:'footprint'} }; // Collider deliberately beyond den.x + den.w.
  local.objects.push(furniture);
  let mode = 'local'; // Simulates the game's live local-vs-repo source switch.
  let override = {locales:[local]}; // Runtime override reader guarantees stable identity until a save.
  context.LocalDBOverrides = { getSourceMode:() => mode, getRuntimeOverride:() => override };
  const external = context.ZoneDenTotemFeatures.denEntranceCollisionState(moving); // Rebuild after source switch.
  const cx = moving.x + (furniture.col-cave.col) * moving.w/cave.w; // World-space authored furniture column.
  const cy = moving.y + (furniture.row-cave.row) * moving.h/cave.h; // World-space authored furniture row.
  context.GridTileAccessors.init({ _zoneLayouts:new Map([[area,{dens:[moving]}]]) });
  assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(cx,cy,area),true,'outside-footprint furniture remains solid');
  assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(cx-1,cy,area),false,'outside collider bounds do not overblock');
  assert.strictEqual(context.ZoneDenTotemFeatures.denEntranceCollisionState(moving),external);

  const edited = structuredClone(local); // Simulates saved Locale Editor change.
  edited.objects.find(object=>object.id==='external_test').col += 2;
  override = {locales:[edited]};
  const changed = context.ZoneDenTotemFeatures.denEntranceCollisionState(moving);
  assert.notStrictEqual(changed,external,'saved locale revision invalidates cached collider');
  assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(cx,cy,area),false,'old furniture position clears');
  assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(cx+2*moving.w/cave.w,cy,area),true,'new furniture position blocks');
  mode = 'repo';
  assert.notStrictEqual(context.ZoneDenTotemFeatures.denEntranceCollisionState(moving),changed,'source switch invalidates cache');
  assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(cx+2*moving.w/cave.w,cy,area),false,'repo locale omits edited furniture');
  assert.ok(context.ZoneDenTotemFeatures.denCollisionDebugSnapshot().invalidations >= 6);

  const generic = { x:10, y:10, w:6, h:6, mouthAnchor:{ x:13, y:16 } }; // A legacy free-standing den borrows the shared cave model without choosing an authored entrance template.
  const fallbackState = context.ZoneDenTotemFeatures.denEntranceCollisionState(generic); // A visual template must not silently replace unassigned den collision.
  assert.equal(fallbackState.useLegacyCave, true, 'free-standing den must keep its old doorway collider');
  assert.equal(fallbackState.rects.length, 0, 'the authored rear-half cave collider must not attach to free-standing dens');
  context.GridTileAccessors.init({ _zoneLayouts: new Map([[area, { dens:[generic] }]]) }); // Actual movement check for an untemplated cave.
  assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(10, 13, area), true, 'legacy cave side rock remains solid');
  assert.equal(context.GridTileAccessors.isAnimalDenCollisionTile(12, 15, area), false, 'legacy cave front doorway remains open');

  const legacy = structuredClone(templates[0]); // Regression: unmodified auto collider templates keep the historic gap.
  legacy.objects.find(object => object.key === 'cave_small').collision = { mode: 'auto' };
  assert.equal(Placement.authoredWalkableTiles({ x: 0, y: 0, w: 6, h: 6 }, legacy), null);

  const preview = fs.readFileSync('docs/tools/locale-editor/locale-preview3d.js', 'utf8'); // Checks that a manually authored custom rectangle is drawn where runtime collision actually lies.
  const rectStart = preview.indexOf('  function colliderMarkerRect(');
  const rectEnd = preview.indexOf('  function addColliderMarker(', rectStart);
  assert(rectStart >= 0 && rectEnd > rectStart, '3D Locale Editor must expose the shared collider marker rectangle calculation');
  const previewRect = new Function(preview.slice(rectStart, rectEnd) + '; return colliderMarkerRect;')(); // Isolated pure rectangle math: no DOM, WebGL, or browser devtools required.
  const source = templates[0].objects.find(object => object.key === 'cave_small'); // Original (unscaled) edited cave document.
  const previewObject = { x: 20, y: 30, w: source.w * 2, h: source.h * 2, collision: { ...source.collision } }; // Ghost-den preview uses source-size custom collision fields.
  assert.deepEqual(previewRect(previewObject, source), { x:20, z:30, w:6, h:3 }, '3D preview must scale rear-half collider exactly as runtime does');
  const inset = { ...previewObject, collision: { mode:'custom', colOffset:1, rowOffset:.5, w:1, h:1.5 } }; // Offset custom collider verifies editor-relative positioning.
  assert.deepEqual(previewRect(inset, source), { x:22, z:31, w:2, h:3 }, '3D preview must scale manually edited offsets');
  const alreadyScaled = { ...previewObject, collision: { mode:'custom', x:20, y:30, w:6, h:3 } }; // Stamped/terrain-aware locale instances carry final-grid collider coordinates.
  assert.deepEqual(previewRect(alreadyScaled, source), { x:20, z:30, w:6, h:3 }, '3D preview must not double-scale an already placed locale');
  assert.match(preview, /addColliderMarker\(group, object, merged, source\)/, '3D preview must retain source tile dimensions at rendering time');

  const generator = fs.readFileSync('docs/js/wilderness-map-generator.js', 'utf8'); // Guards initial wilderness tile painting against reverting to hardcoded entrance swathes.
  const wildlife = fs.readFileSync('docs/js/wildlife-spawn.js', 'utf8'); // Guards relocated dens against repainting the open columns as rock.
  assert.match(generator, /authoredWalkableTiles\?\.\(object, template\)/);
  assert.match(generator, /object\.entranceTemplateId\s*\?/, 'generator must not apply authored cave colliders to untemplated dens');
  assert.match(wildlife, /authoredWalkableTiles\?\.\(den, locale\)/);
  assert.match(wildlife, /den\?\.entranceTemplateId\s*\?/, 'relocation must retain the legacy cave opening for untemplated dens');
  console.log('Locale-authored cave side clearance: both den sizes, runtime collision, rock overlays, collapse and legacy fallback validated');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
