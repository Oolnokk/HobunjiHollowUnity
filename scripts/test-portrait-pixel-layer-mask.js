const fs = require('fs');
const assert = require('assert');
const zlib = require('zlib');

const hub = fs.readFileSync('docs/tools/index.html', 'utf8');
const tool = fs.readFileSync('docs/tools/portrait-pixel-layer-mask/index.html', 'utf8');
const portrait = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');
const game = fs.readFileSync('docs/index.html', 'utf8');
const studio = fs.readFileSync('docs/tools/character-studio/index.html', 'utf8');
const ruggedMask = fs.readFileSync('docs/assets/cosmetics/clothes/overwear/portrait/ruggedshoulders_tl_m.layer-mask.png');
const ruggedPoncho = JSON.parse(fs.readFileSync('docs/config/cosmetics/clothes/overwear/rugged_poncho.json', 'utf8'));

function decodeRgbaPngAlpha(buffer) {
  assert.strictEqual(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'mask must be a PNG');
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + len;
  }
  assert.strictEqual(bitDepth, 8, 'mask PNG must use 8-bit channels');
  assert.strictEqual(colorType, 6, 'mask PNG must be RGBA');
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp;
  assert.strictEqual(inflated.length, height * (stride + 1), 'mask PNG scanline payload must be complete');
  const out = Buffer.alloc(height * stride);
  const paeth = (a,b,c) => {
    const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c);
    return pa<=pb && pa<=pc ? a : pb<=pc ? b : c;
  };
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[src++];
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const up = y ? out[row - stride + x] : 0;
      const upLeft = y && x >= bpp ? out[row - stride + x - bpp] : 0;
      out[row + x] = filter === 0 ? raw
        : filter === 1 ? (raw + left) & 255
        : filter === 2 ? (raw + up) & 255
        : filter === 3 ? (raw + Math.floor((left + up) / 2)) & 255
        : filter === 4 ? (raw + paeth(left, up, upLeft)) & 255
        : (() => { throw new Error('Unsupported PNG filter ' + filter); })();
    }
  }
  let selected = 0;
  for (let i = 3; i < out.length; i += 4) if (out[i] > 127) selected++;
  return { width, height, selected, total: width * height };
}

const ruggedMaskAlpha = decodeRgbaPngAlpha(ruggedMask);
assert.deepStrictEqual([ruggedMaskAlpha.width, ruggedMaskAlpha.height], [234, 173], 'rugged shoulder mask must match the authored source sprite dimensions');
assert(ruggedMaskAlpha.selected > 0, 'rugged shoulder mask must contain selected pixels');
assert(ruggedMaskAlpha.selected < ruggedMaskAlpha.total, 'rugged shoulder mask must not select the entire sprite rectangle');

assert(hub.includes('data-target="portrait-pixel-layer-mask"'), 'Tool Hub must expose the pixel-layer authoring tab');
assert(hub.includes('portrait-pixel-layer-mask/index.html?v=20260927pixellayer9'), 'Tool Hub must embed the current pixel-layer author');
assert(tool.includes('Paint exact source pixels'), 'author must describe pixel-exact mask editing');
assert(tool.includes('pointerdown') && tool.includes('pointermove'), 'author must support pointer/touch painting');
assert(tool.includes('Download mask PNG') && tool.includes('Copy JSON'), 'author must export both the mask and renderer metadata');
assert(tool.includes('sourceAlphaAt'), 'author must expose source-alpha diagnostics without blocking painting');
assert(tool.includes('sourceCanvas.width / rect.width') && tool.includes('sourceCanvas.height / rect.height'), 'pointer mapping must use the displayed canvas bounds rather than assuming zoom pixels');
assert(tool.includes('Transparent source pixels are harmless'), 'painting must not depend on readable source-canvas alpha');
assert(tool.includes("fetch('../../config/cosmetics/index.json')"), 'author must fetch the repository cosmetics index');
assert(tool.includes('loadSelectedClothingJson'), 'author must fetch selected existing clothing JSONs');
assert(tool.includes('collectPortraitLayerRecords'), 'author must enumerate portrait layers inside selected clothing JSONs');
assert(tool.includes('loadSelectedRepoLayer'), 'author must fetch the selected repository portrait sprite automatically');
assert(tool.includes('fittedZoom') && tool.includes('fitZoomToPane'), 'author must fit the sprite inside the center pane');
assert(tool.includes('id="fitBtn"'), 'author must expose a Fit control after manual zooming');
assert(tool.includes('../../js/avatar-preview-scene.js'), 'author must load the shared single-avatar Three preview scene');
assert(tool.indexOf('../../js/color-fill.js') >= 0 && tool.indexOf('../../js/color-fill.js') < tool.indexOf('../../js/portrait-utils.js'), 'author must load ColorFill before portrait-utils');
assert(tool.includes('AvatarPreviewScene.create'), 'author must mount the shared preview scene used by the PNGPlaneAvatar editor stack');
assert(tool.includes('NpcAvatarPreview.renderProfileToCanvas'), '3D preview must render front/back portrait canvases through the canonical NPC portrait renderer');
assert(tool.includes('scene.setAvatar(front'), '3D preview must hand the canonical portrait canvases to the shared PNGPlaneAvatar scene');
assert(!tool.includes('new THREE.WebGLRenderer'), 'pixel-layer author must not fork its own Three.js renderer setup');
assert(tool.includes("paintMode === 'move'") && tool.includes('shiftMaskBy'), 'author must support dragging and nudging the entire mask');
assert(tool.includes('undoStack') && tool.includes('redoStack') && tool.includes('undoMask') && tool.includes('redoMask'), 'author must support undo/redo history');
assert(tool.includes('pendingEditSnapshot'), 'a paint/move pointer gesture must collapse into one undo step');
assert(tool.includes('forceSelectedClothingIntoProfile'), '3D preview must inject the selected clothing JSON instead of trusting a stale/reconstructed cosmetic option');
assert(tool.includes('previewDescriptorFromRecord'), '3D preview must rebuild the selected variant layers from the exact JSON records selected in the author');
assert(tool.includes("currentLayerRecords.filter(record => record.variantKey === selectedVariant)"), 'selected species/gender preview must use every layer from that exact JSON variant, including back_wrap');
assert(tool.includes("/^back(?:_|$)/i.test"), 'preview metadata must classify back_wrap-style selected clothing layers as rear layers');
assert(!tool.includes('cameraPresets:'), 'pixel-mask preview must inherit the shared AvatarPreviewScene camera convention');
assert(tool.includes('normalizeMaskImageIntoCanvas'), 'imported opaque black/white masks must be normalized back into alpha masks');
assert(tool.includes("!String(entry.path || '').includes('/appearance/')"), 'clothing picker must exclude appearance-only folder entries');
assert(tool.includes("id=\"maskBehavior\""), 'author must expose reroute vs no-trespass behavior');
assert(tool.includes("mode: 'noTrespassSquish'"), 'author export/preview must support no-trespass squish metadata');
assert(tool.includes("target: $('target').value"), 'reroute export must preserve the selected portrait stage');
assert(tool.includes("view: $('view').value"), 'author export must preserve front/behind scope');

assert(portrait.includes('normalizePixelLayerMasks'), 'portrait config parser must preserve authored pixel masks');
assert(portrait.includes("mask.target === 'belowHood'"), 'portrait renderer must support below-hood routing');
assert(portrait.includes("mask.target === 'aboveHood'"), 'portrait renderer must support above-hood routing');
assert(portrait.includes("pixelExcludeMasks: rerouteMasks"), 'ordinary layer draw must keep reroute exclusions separate from no-trespass deformation');
assert(portrait.includes("pixelMaskMode: 'include'"), 'rerouted stage draw must include only selected mask pixels');
assert(portrait.includes("mask.mode === 'noTrespassSquish'"), 'mask normalization must preserve no-trespass mode');
assert(portrait.includes('buildNoTrespassSquishCanvas'), 'portrait renderer must build a shape-aware no-trespass deformation');
assert(portrait.includes('nearestLegal') && portrait.includes('deepestIllegal') && portrait.includes('nearestBoundary'), 'no-trespass deformation must use connected opaque-neighbor flow instead of a bounding-box squeeze');
assert(portrait.includes('resolvePixelMaskedImage'), 'portrait renderer must build masked/deformed source canvases after normal sprite preparation');
assert(portrait.includes('function portraitImageAspect(img)'), 'portrait renderer must compute aspect ratio for both Image and Canvas sources');
assert(portrait.includes("img?.naturalWidth || img?.width") && portrait.includes("img?.naturalHeight || img?.height"), 'masked temporary canvases must fall back to canvas width/height instead of NaN natural dimensions');
assert(!portrait.includes('(img.naturalWidth / img.naturalHeight) * PORTRAIT_L'), 'canonical portrait draw paths must not assume Image-only natural dimensions');
assert(portrait.includes('pixelBelowHood:() => drawPixelStageLayers'), 'rear portrait order must expose a below-hood pixel stage');
assert(portrait.includes('pixelAboveHood:() => drawPixelStageLayers'), 'rear portrait order must expose an above-hood pixel stage');
assert(portrait.includes('drawPixelStageLayers(pixelBelowHoodLayers);') && portrait.includes('drawPixelStageLayers(pixelAboveHoodLayers);'), 'front portrait path must draw both pixel stages');
assert(game.includes('js/portrait-utils.js?v=20260927pixellayer3'), 'game must cache-bust the no-trespass pixel-layer renderer');
assert(studio.includes('../../js/portrait-utils.js?v=20260927pixellayer3'), 'Character Studio must cache-bust the no-trespass pixel-layer renderer');

const ruggedSquish = ruggedPoncho?.speciesVariants?.tletingan_male?.parts?.torso?.layers?.back_wrap?.pixelLayerMasks?.[0];
assert.strictEqual(ruggedSquish?.mode, 'noTrespassSquish', 'Tletingan male rugged shoulder wrap must use no-trespass squish');
assert.strictEqual(ruggedSquish?.view, 'behind', 'rugged shoulder no-trespass mask must remain behind-only');
assert(!('target' in ruggedSquish), 'no-trespass squish must not reroute pixels to an above/below-hood stage');

console.log('Portrait pixel layer mask author/runtime regression passed.');
