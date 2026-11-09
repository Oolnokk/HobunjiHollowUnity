'use strict';
const assert = require('node:assert/strict'); // Verifies framing geometry and missing-icon behavior.
const fs = require('node:fs'); // Loads the production equipment and item resolvers.
const vm = require('node:vm'); // Runs production code without booting the game.
const calls = []; // Captures canvas source/destination rectangles for exact anchoring checks.
let pixels; // Supplies deterministic alpha pixels for each source fixture.
const sandbox = { window: {}, document: { createElement: () => ({
  getContext: () => ({ drawImage: (...args) => calls.push(args), getImageData: () => ({ data: pixels }) }),
  toDataURL: () => 'data:image/png;square',
}) } }; // Minimal DOM sufficient to execute the full EquipmentPanel module.
vm.runInNewContext(fs.readFileSync('docs/js/equipment-panel.js', 'utf8'), sandbox);
function fixture(width, height, left, top, right, bottom) {
  pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) pixels[(y * width + x) * 4 + 3] = 255;
  calls.length = 0;
  sandbox.window.EquipmentPanel.squareToolIcon({ width, height });
  return calls[1].slice(1);
}
assert.deepEqual(fixture(20, 40, 6, 3, 13, 35), [6, 28, 8, 8, 0, 0, 128, 128], 'tall sprite crops from the top and retains its bottom edge');
assert.deepEqual(fixture(30, 20, 3, 8, 22, 17), [3, 8, 20, 10, 0, 64, 128, 64], 'wide sprite pads above the visible pixels without stretching');
assert.deepEqual(fixture(20, 20, 7, 10, 7, 10), [7, 10, 1, 1, 0, 0, 128, 128], 'single opaque pixel remains a valid frame');
pixels.fill(0);
assert.throws(() => sandbox.window.EquipmentPanel.squareToolIcon({ width: 20, height: 20 }), /no opaque pixels/);
const game = fs.readFileSync('docs/game.js', 'utf8'); // Extracts the real resolver to exercise blank/legacy icon cases.
const start = game.indexOf('      function itemIconForKey(key) {'); // Function boundary is stable independently of cache tokens.
const end = game.indexOf('\n      }', start) + '\n      }'.length; // Restricts execution to this self-contained production function.
const definitions = { blank: { icon: '', cat: 'seed' }, old: { icon: '[]', cat: 'tool' }, square: { icon: '□', cat: 'food' }, authored: { icon: '🐟' }, whitespace: { icon: '   ', cat: 'tool' }, malformed: { icon: 42, cat: 'seed' } }; // Covers all supported missing-icon forms.
const resolve = vm.runInNewContext(`(${game.slice(start, end)})`, { ITEM_DEFS: definitions, SUPPLY_CATALOG: [] }); // Reuses canonical fallback behavior.
assert.equal(resolve('blank'), '🌱');
assert.equal(resolve('old'), '🔧');
assert.equal(resolve('square'), '🍲');
assert.equal(resolve('authored'), '🐟');
assert.equal(resolve('unknown'), '📦');
assert.equal(resolve('whitespace'), '🔧');
assert.equal(resolve('malformed'), '🌱');
const catalog = JSON.parse(fs.readFileSync('docs/config/items/item-index.json', 'utf8')); // Ensures the editor catalog never silently loses its placeholders again.
assert(Object.values(catalog).every(item => item.icon?.trim()), 'every indexed item has a placeholder');
const hud = fs.readFileSync('docs/js/generic-hud-icons.js', 'utf8'); // Executes the shipped compatibility mapping and node builder.
const mappingStart = hud.indexOf('  const ITEM_PLACEHOLDERS ='); // Isolates the data-only placeholder table.
const mappingEnd = hud.indexOf('  const TOKEN_PATTERN =', mappingStart); // Leaves observer/bootstrap side effects out of the unit fixture.
const builderStart = hud.indexOf('  function iconElement('); // Loads the production DOM builder and token classification together.
const builderEnd = hud.indexOf('  function shouldSkipTextNode(', builderStart); // Ends before DOM traversal code.
const buildPlaceholder = vm.runInNewContext(hud.slice(mappingStart, mappingEnd) + hud.slice(builderStart, builderEnd) + '\niconElement', {
  document: { createElement: tag => {
    if (tag !== 'canvas') return { dataset: {}, style: {}, setAttribute() {} };
    let text = ''; // Fixture renders the missing-glyph raster for newer tokens except the explicitly supported axe.
    return { getContext: () => ({
      fillText: value => { text = value; }, clearRect() {},
      getImageData: () => ({ data: Uint8ClampedArray.from(text === '🪓' ? [255, 50, 10, 255] : [0, 0, 0, 255]) }),
    }) };
  } },
}); // Placeholder branch needs no image downloads or runtime dependencies.
for (const token of ['🪵', '🪨', '🟫', '🪙', '🫙', '🫏', '🪿', '🪈', '🪬', '🪷', '🪖', '🪟', '🫕']) {
  const node = buildPlaceholder('item', token); // Each unsupported/newer glyph must become an older, non-square emoji.
  assert.equal(node.dataset.genericHudIcon, 'item', 'substitution marker prevents recursive observer work');
  assert(node.textContent && node.textContent !== token, 'placeholder supplies a real substitute glyph');
  assert(node.style.filter, 'tint stays confined to the icon');
}
const supportedAxe = buildPlaceholder('item', '🪓'); // A working native emoji must not be replaced by the less-specific hammer substitute.
assert.equal(supportedAxe.textContent, '🪓');
assert.equal(supportedAxe.dataset.genericHudIcon, 'item-native');
assert.equal(supportedAxe.style.filter, undefined, 'native emoji retain their authored colors');
console.log('Inventory opaque bounds, bottom-anchored square frames and item placeholder checks passed');
