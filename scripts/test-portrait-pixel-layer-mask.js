const fs = require('fs');
const assert = require('assert');

const hub = fs.readFileSync('docs/tools/index.html', 'utf8');
const tool = fs.readFileSync('docs/tools/portrait-pixel-layer-mask/index.html', 'utf8');
const portrait = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');
const game = fs.readFileSync('docs/index.html', 'utf8');
const studio = fs.readFileSync('docs/tools/character-studio/index.html', 'utf8');

assert(hub.includes('data-target="portrait-pixel-layer-mask"'), 'Tool Hub must expose the pixel-layer authoring tab');
assert(hub.includes('portrait-pixel-layer-mask/index.html?v=20260926pixellayer3'), 'Tool Hub must embed the current pixel-layer author');
assert(tool.includes('Paint exact source pixels'), 'author must describe pixel-exact mask editing');
assert(tool.includes('pointerdown') && tool.includes('pointermove'), 'author must support pointer/touch painting');
assert(tool.includes('Download mask PNG') && tool.includes('Copy JSON'), 'author must export both the mask and renderer metadata');
assert(tool.includes('sourceAlphaAt'), 'author must prevent painting transparent source pixels');
assert(tool.includes("fetch('../../config/cosmetics/index.json')"), 'author must fetch the repository cosmetics index');
assert(tool.includes('loadSelectedClothingJson'), 'author must fetch selected existing clothing JSONs');
assert(tool.includes('collectPortraitLayerRecords'), 'author must enumerate portrait layers inside selected clothing JSONs');
assert(tool.includes('loadSelectedRepoLayer'), 'author must fetch the selected repository portrait sprite automatically');
assert(tool.includes('fittedZoom') && tool.includes('fitZoomToPane'), 'author must fit the sprite inside the center pane');
assert(tool.includes("id="fitBtn""), 'author must expose a Fit control after manual zooming');
assert(tool.includes("!String(entry.path || '').includes('/appearance/')"), 'clothing picker must exclude appearance-only folder entries');
assert(tool.includes("target: $('target').value"), 'author export must preserve the selected portrait stage');
assert(tool.includes("view: $('view').value"), 'author export must preserve front/behind scope');

assert(portrait.includes('normalizePixelLayerMasks'), 'portrait config parser must preserve authored pixel masks');
assert(portrait.includes("mask.target === 'belowHood'"), 'portrait renderer must support below-hood routing');
assert(portrait.includes("mask.target === 'aboveHood'"), 'portrait renderer must support above-hood routing');
assert(portrait.includes("pixelMaskMode: 'exclude'"), 'ordinary layer draw must exclude rerouted mask pixels');
assert(portrait.includes("pixelMaskMode: 'include'"), 'rerouted stage draw must include only selected mask pixels');
assert(portrait.includes('resolvePixelMaskedImage'), 'portrait renderer must build masked source canvases after normal sprite preparation');
assert(portrait.includes('pixelBelowHood:() => drawPixelStageLayers'), 'rear portrait order must expose a below-hood pixel stage');
assert(portrait.includes('pixelAboveHood:() => drawPixelStageLayers'), 'rear portrait order must expose an above-hood pixel stage');
assert(portrait.includes('drawPixelStageLayers(pixelBelowHoodLayers);') && portrait.includes('drawPixelStageLayers(pixelAboveHoodLayers);'), 'front portrait path must draw both pixel stages');
assert(game.includes('js/portrait-utils.js?v=20260926pixellayer1'), 'game must cache-bust the pixel-layer-aware renderer');
assert(studio.includes('../../js/portrait-utils.js?v=20260926pixellayer1'), 'Character Studio must cache-bust the pixel-layer-aware renderer');

console.log('Portrait pixel layer mask author/runtime regression passed.');
