// Procedural dens fit into existing plateau cliffs (Banubu's Cave style) using
// the den_entrance locale templates' terrain anchors (js/den-cliff-placement.js).
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const Placement = require(path.join(root, 'docs/js/den-cliff-placement.js'));
const Generator = require(path.join(root, 'docs/js/wilderness-map-generator.js'));
const fullTemplate = require(path.join(root, 'docs/config/locales/locale_animal_den_entrance.json'));
const smallTemplate = require(path.join(root, 'docs/config/locales/locale_animal_den_entrance_small.json'));
const index = require(path.join(root, 'docs/config/locales/index.json'));

assert(index.locales.some(entry => entry.id === smallTemplate.id && entry.category === 'den_entrance'), 'small den template is registered for the Locale Editor');
const full = Placement.compileTemplate(fullTemplate);
const small = Placement.compileTemplate(smallTemplate);
assert(full && small, 'both den-entrance templates carry cliff rules');
assert(small.w < full.w, 'small template has a narrower footprint (same cave_small model, scaled down)');
assert.equal(Placement.caveObject(smallTemplate).key, 'cave_small', 'small template reuses the cave_small GLB');

// Synthetic source grid: a plateau (tier 1) along the top with a wide south
// face at cols 2-10 and a 2-tile-wide spur reaching one row further south at
// cols 14-15. Low-side tiles touching the face are cliff skirts, as the
// generator marks them.
const W = 22, H = 18;
const tiles = new Map();
const plateau = (x, y) => (y <= 4 && x >= 2 && x <= 10) || (y <= 5 && (x === 14 || x === 15)) || (y === 4 && x >= 18);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles.set(`${x},${y}`, { x, y, elevation: plateau(x, y) ? 1 : 0 });
for (const tile of tiles.values()) {
  if (tile.elevation) continue;
  if ([[0, -1], [1, 0], [-1, 0], [0, 1]].some(([dx, dy]) => tiles.get(`${tile.x + dx},${tile.y + dy}`)?.elevation)) tile.cliffSkirt = true;
}
const tileAt = (x, y) => tiles.get(`${x},${y}`) || null;

const onFace = Placement.evaluate(full, tileAt, 4, 4);
assert(onFace, 'full-size den fits with its back row inside the wide cliff');
assert.equal(onFace.floorTier, 0, 'den floor is the mouth (low) tier');
assert.deepEqual(onFace.mouth, { x: 5, y: 6 }, 'entry comes from the template connector, inside the footprint');
assert(onFace.mouth.y < 4 + full.h, 'entry tile sits inside the cave footprint (in the opening)');
assert.deepEqual(Placement.entryPath(full).map(cell => [cell.dx, cell.dy]), [[1, 2]], 'entry column runs from the entry tile to the footprint front');
assert.equal(Placement.evaluate(full, tileAt, 4, 8), null, 'full-size den rejects open ground with no cliff behind it');
assert.equal(Placement.evaluate(full, tileAt, 13, 5), null, 'full-size den rejects a cliff face narrower than 3 tiles');
assert(Placement.evaluate(small, tileAt, 14, 5), 'small den fits the narrow cliff spur');
assert.equal(Placement.evaluate(full, tileAt, 18, 4), null, 'a one-row plateau ridge is too thin: the cave must sink a tile deeper into the cliff');

tileAt(5, 8).occupiedBy = 'boulder';
assert.equal(Placement.evaluate(full, tileAt, 4, 4), null, 'den needs free space in front of its mouth');
delete tileAt(5, 8).occupiedBy;

const sites = Placement.findSites([small, full], tileAt, W, H);
assert(sites.some(site => site.templateId === fullTemplate.id), 'wide face hosts full-size sites');
assert(sites.some(site => site.templateId === smallTemplate.id && site.x >= 13), 'narrow spur hosts a small site');
const mouths = sites.map(site => `${site.mouth.x},${site.mouth.y}`);
assert.equal(new Set(mouths).size, mouths.length, 'one template per mouth (largest wins)');

// Real generator: every den in a generated zone sits against a cliff when the
// templates are supplied, and the templates themselves are never stamped.
const workspace = Generator.generateZoneWorkspace('map_western_slope', 'den-cliff-regression', [fullTemplate, smallTemplate]);
const dens = workspace.animalDens;
assert(dens.length > 0, 'zone has dens');
assert(dens.every(den => den.cliffBacked && [fullTemplate.id, smallTemplate.id].includes(den.entranceTemplateId)), 'every den is cliff-backed with a known template');
assert(!(workspace.localeInstances || []).some(instance => instance.localeId === fullTemplate.id || instance.localeId === smallTemplate.id), 'den templates are not stamped as locales');
const rootMap = workspace.maps.find(map => !map.isSubmap) || workspace.maps[0];
for (const den of dens) {
  const { x, y } = den.mouthAnchor;
  assert(x >= den.x && x < den.x + den.w && y >= den.y && y < den.y + den.h, `${den.id}: entry tile is inside the footprint`);
  for (let row = y; row < den.y + den.h; row++) assert.notEqual(rootMap.tiles[`${x},${row}`]?.type, 'rock', `${den.id}: entry column (${x},${row}) is walkable ground`);
  assert(den.approachAnchor && den.approachAnchor.y === den.y + den.h, `${den.id}: approach tile is just in front of the footprint`);
  assert.notEqual(rootMap.tiles[`${den.approachAnchor.x},${den.approachAnchor.y}`]?.type, 'rock', `${den.id}: approach tile is open`);
}
const legacy = Generator.generateZoneWorkspace('map_western_slope', 'den-cliff-regression', []);
assert(legacy.animalDens.length > 0 && legacy.animalDens.every(den => !den.cliffBacked), 'without templates dens keep legacy free-standing placement');

console.log(`PASS den-cliff-placement: ${dens.length} cliff dens (${dens.filter(den => den.entranceTemplateId === smallTemplate.id).length} small), ${sites.length} synthetic sites`);
