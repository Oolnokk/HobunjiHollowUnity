'use strict';

// Regression coverage for throwing flask thumbnails and the item selector's CSS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'); // Resolves existing game and UI sources for this test.
const read = name => fs.readFileSync(path.join(root, name), 'utf8'); // Reads the live repo files rather than fixture copies.

async function main() {
  const game = read('docs/game.js'); // Supplies the real icon renderer for the isolated DOM tests.
  const equipment = read('docs/js/equipment-panel.js'); // Supplies the weapon's square crop implementation.
  const sticky = read('docs/js/item-arch-sticky-category-heading.js'); // Verifies category CSS cannot conceal item sprites.
  const original = read('docs/js/item-arch-original-presentation.js'); // Verifies the final selector style permits sprite backgrounds.
  const actionArc = read('docs/js/action-arc-ui.js'); // Verifies selector calls the same item icon renderer.
  assert.match(game, /applyItemSpriteIcon\(box\.querySelector\('\.iib-icon'\), def, key\)/);
  assert.match(actionArc, /deps\.applyItemSpriteIcon\(iconEl, deps\.ITEM_DEFS\[s\.key\], s\.key\)/);
  assert.match(game, /frameFlask = def\.spriteIcon === 'throwing_flask\.png'/);
  for (const css of [sticky, original]) {
    assert.match(css, /\.arc-icon:not\(\.sprited-icon\)/, 'emoji-only background reset is required');
    // No item icon selector may force a background reset on .sprited-icon.
    const blocks = css.match(/[^{}]+\{[^{}]*background:\s*none\s*!important[^{}]*\}/g) || []; // Finds forced background resets only.
    for (const block of blocks) {
      if (!block.includes('.arc-icon')) continue;
      assert.match(block, /\.arc-icon:not\(\.sprited-icon\)/, 'background:none may only target emoji icons');
    }
  }
  assert.match(original, /\.arc-icon\.sprited-icon\s*\{[^}]*width:1\.25em\s*!important/s);

  const index = equipment.indexOf('  function squareToolIcon('); // Isolates the actual weapon thumbnail code.
  const stop = equipment.indexOf('  function renderToolIcon(', index);
  assert(index >= 0 && stop > index, 'weapon icon renderer exists');
  const calls = []; // Collects canvas draw arguments to confirm unchanged weapon framing.
  const alpha = new Uint8ClampedArray(64 * 128 * 4); // Fake narrow, tall sprite bounds.
  for (let y = 10; y <= 109; y++) for (let x = 20; x <= 39; x++) alpha[(y * 64 + x) * 4 + 3] = 255;
  const document = { createElement: () => ({
    getContext: () => ({ drawImage: (...args) => calls.push(args), getImageData: () => ({ data: alpha }) }),
    toDataURL: () => 'data:image/png;base64,FRAMED',
  }) };
  const square = new Function('document', 'toolIconDebug', equipment.slice(index, stop) + 'return squareToolIcon;')(document, {});
  square({ width: 64, height: 128 });
  assert.deepEqual(calls.at(-1).slice(1, 9), [20, 90, 20, 20, 0, 0, 128, 128], 'flask uses the existing bottom-square weapon crop');

  const from = game.indexOf('      const _flaskIconFrames = new Map();'); // Delimits flask memoization and the shared item icon renderer.
  const to = game.indexOf('      // Pixel Probe reads', from);
  assert(from >= 0 && to > from, 'item icon renderer exists');
  const renders = []; // Counts shared thumbnail trims to catch repeated frame work on mobile.
  const recolors = []; // Counts source recolors so multiple icons cannot trigger redundant scans.
  const errors = []; // Records mobile-readable framing failures.
  const window = {
    ItemProcessing: { normalizeAlcoholItemDef() {} },
    AlcoholInventoryUI: { applySwigBadge() {} },
    EquipmentPanel: { squareToolIcon(source) { renders.push(source); return 'data:image/png;base64,FRAMED'; } },
    SpriteRecolor: { getRecoloredCanvas(...args) { recolors.push(args); return Promise.resolve({ toDataURL: () => 'data:image/png;base64,SOURCE' }); } },
    __farmLog: (...parts) => errors.push(parts),
  };
  const readyLogs = new Set(); // Shared across icons as it is in the game.
  const clearItemSpriteIcon = el => {
    el.style.backgroundImage = '';
    el.classList.delete('sprited-icon');
    delete el.dataset.itemSpriteRequest;
    delete el.dataset.itemSpriteState;
    delete el.dataset.itemSpriteError;
  };
  class ImageSource {
    set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
  }
  const apply = new Function('window', 'Image', 'clearItemSpriteIcon', '_itemSpriteReadyLogged',
    game.slice(from, to) + 'return applyItemSpriteIcon;')(window, ImageSource, clearItemSpriteIcon, readyLogs);
  const element = () => ({ dataset: {}, style: {}, classList: new Set() }); // Minimal icon DOM for state updates.
  const settle = () => new Promise(resolve => setImmediate(resolve)); // Waits for source, trim and icon state microtasks.

  const def = { spriteIcon: 'throwing_flask.png', spriteColor: 0x91a04f, spriteMode: 'dual-keyed:ffcc00', label: 'Flask' };
  const one = element(), two = element(); // Two simultaneous Pack/HUD icons for one flask stack.
  apply(one, def, 'flask'); apply(two, def, 'flask');
  await settle();
  assert.equal(recolors.length, 1, 'recolor is shared');
  assert.equal(renders.length, 1, 'frame is shared across multiple icons');
  assert.equal(one.dataset.itemSpriteState, 'ready');
  assert.equal(two.dataset.itemSpriteState, 'ready');
  assert.match(one.style.backgroundImage, /FRAMED/);
  apply(one, def, 'flask'); await settle();
  assert.equal(renders.length, 1, 'refresh does not reframe the icon');

  const direct = element(); // Source-colored flasks take the same square crop without recolor.
  apply(direct, { spriteIcon: 'throwing_flask.png', label: 'Uncolored flask' }, 'direct');
  await settle();
  assert.equal(direct.dataset.itemSpriteState, 'ready');
  assert.equal(renders.length, 2);

  const stale = element(); // Async completion from a previous flask must never replace a newly selected bottle.
  let finishOld;
  window.SpriteRecolor.getRecoloredCanvas = () => new Promise(resolve => { finishOld = resolve; });
  apply(stale, { spriteIcon: 'throwing_flask.png', spriteColor: 1, spriteMode: 'keyed' }, 'old');
  window.SpriteRecolor.getRecoloredCanvas = () => Promise.resolve({ toDataURL: () => 'data:image/png;base64,NEW' });
  apply(stale, { spriteIcon: 'bottle_potion.png', spriteColor: 2, spriteMode: 'keyed' }, 'new');
  finishOld({ toDataURL: () => 'data:image/png;base64,OLD' });
  await settle();
  assert.equal(stale.dataset.itemSpriteRequest, 'bottle_potion.png|2|keyed');
  assert.match(stale.style.backgroundImage, /NEW/);

  const failed = element(); // Error state stays inspectable in the mobile Pixel Probe.
  window.SpriteRecolor.getRecoloredCanvas = () => Promise.reject(new Error('offline-test'));
  apply(failed, { spriteIcon: 'throwing_flask.png', spriteColor: 3, spriteMode: 'keyed' }, 'failed');
  await settle();
  assert.equal(failed.dataset.itemSpriteState, 'fallback');
  assert.equal(failed.dataset.itemSpriteError, 'offline-test');
  assert(errors.some(entry => String(entry[0]).includes('flask framing failed')), 'failure logged for mobile');
  console.log('ok: flask square icon framing, shared cache, stale requests, fallback and item selector CSS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
