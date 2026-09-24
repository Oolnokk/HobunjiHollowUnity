'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const read = path => fs.readFileSync(path, 'utf8');
const tool = read('docs/tools/pattern-editor/index.html');
const hub = read('docs/tools/index.html');
const authoring = read('docs/js/pattern-authoring.js');
const weaving = read('docs/js/clothing-weaving-system.js'); // Used by ordering regressions for the live woven/NPC motif compositor.
const metalRecolor = read('docs/js/tool-metal-recolor.js'); // Used to keep Pattern Authoring motif-scale semantics identical on verdigris.
const colorFill = read('docs/js/color-fill.js'); // Canonical source-art shade/value fill math shared by cloth, animals, tools, and authored item sprites.
const spriteRecolor = read('docs/js/sprite-recolor.js'); // Compatibility wrapper for direct/keyed authored sprite recoloring.
const repoLibrary = read('docs/js/repo-pattern-library.js');
const devExporter = read('docs/js/pattern-library-dev-export.js');
const renderer = read('docs/js/creature-genetics-render.js');
const animalAppearance = read('docs/js/character-studio-animal-appearance.js');
const repoPicker = read('docs/js/repo-picker.js');
const gameIndex = read('docs/index.html');
const index = JSON.parse(read('docs/config/patterns/index.json'));

assert.equal(index.schema, 'hobunji_pattern_library.v1');
assert(Array.isArray(index.patterns), 'repo pattern index exposes a patterns array');

assert.match(tool, /PatternAuthoring\.openEditor/, 'standalone tool reuses the real shared PatternAuthoring modal');
assert.match(tool, /ClothingWeavingSystem\.applyPatternToTintedImage/, 'simple canvas preview uses the actual weaving pattern compositor');
assert.match(tool, /'pattern-editor-motif'/, 'Pattern Editor labels its shared compositor pass separately from clothing and animal surface paint');
assert.match(tool, /canvas\.width = 384; canvas\.height = 240/, 'tool preview keeps the dedicated 384x240 canvas surface');
assert.match(tool, /id="surfaceTexture"/, 'tool preview exposes a background-texture selector');
assert.match(tool, /value="canvas\.png" selected/, 'tool preview defaults to canvas.png');
assert.match(tool, /boards\.png/, 'tool preview can switch to another repository surface texture');
assert.match(tool, /ctx\.drawImage\(source, 0, 0, canvas\.width, canvas\.height\)/, 'selected preview texture is stretched once to fill the complete 384x240 raster');
assert.match(tool, /SpriteRecolor\.recolorImageData\(imageData\.data, tintHex, 'direct'\)/, 'preview shade-fills the stretched raster through the same direct clothing recolor path');
assert.match(spriteRecolor, /function directShadeFillPixels\(data, targetRgb, predicateOrOptions = null\)/, 'SpriteRecolor retains its public direct shade-fill compatibility seam');
assert.match(spriteRecolor, /colorFillApi\(\)\.shadeFillPixels/, 'SpriteRecolor routes direct fills into the canonical ColorFill owner');
assert.match(colorFill, /isAuthoredWhite\(sourceData\[i\], sourceData\[i \+ 1\], sourceData\[i \+ 2\]\)/, 'white sprite pixels are excluded from the common recolor reference');
assert.match(spriteRecolor, /directShadeFillPixels\(data, \[tr, tg, tb\], null\)/, 'SpriteRecolor direct mode routes through the shared shade-fill implementation');
assert.doesNotMatch(spriteRecolor, /CreatureGeneticsRender\?\.recolorPixels/, 'pattern tint must not delegate back into the animal renderer');
assert.match(weaving, /window\.ColorFill\?\.shadeFillPixels/, 'woven motif ink uses the canonical ColorFill shade implementation directly');
assert.match(weaving, /sourceData: shadeSourceData,[\s\S]*?samplePredicate:[\s\S]*?applyPredicate:/, 'woven motifs measure source shading separately from their paint mask');
assert.match(renderer, /window\.ColorFill\?\.shadeFillPixels/, 'animal base and genetic pattern recoloring use the same canonical ColorFill implementation');
assert.doesNotMatch(tool, /ctx\.createPattern\(/, 'preview must not tile the background texture');
assert.match(tool, /'pattern-tool:' \+ \$\('surfaceTexture'\)\.value/, 'preview cache identity includes the selected surface texture');
assert.match(tool, /'motif_' \+ id \+ '\.png'/, 'motif exports use motif_<pattern name>.png');
assert.match(tool, /'pattern_' \+ id \+ '\.json'/, 'settings export has a stable sibling JSON filename');
assert.match(tool, /motifPng: 'assets\/patterns\/motif_' \+ id \+ '\.png'/, 'settings JSON references the exported repo PNG instead of embedding base64');
assert.match(tool, /settings: cleanSettings\(draft\)/, 'settings JSON strips embedded motif storage fields');
assert.match(tool, /RepoPatternLibrary\.preloadEditable/, 'tool library is populated from committed repo patterns');
assert.match(hub, /data-target="pattern-editor"/, 'Dev Tools hub exposes Pattern Editor');
assert.match(hub, /pattern-editor\/index\.html/, 'Dev Tools hub embeds the standalone Pattern Editor');

assert.match(authoring, /options\.library\.readOnly/, 'shared PatternAuthoring supports a repo-backed read-only library surface');
assert.match(repoLibrary, /config\/patterns\/index\.json/, 'repo pattern library loads its committed index');
assert.match(repoLibrary, /motifPng/, 'repo pattern definitions resolve PNG references');
assert.match(repoLibrary, /motifUrl: absoluteDocsUrl\(motifPng\)/, 'runtime patterns resolve committed motif PNGs to docs-root URLs');
assert.match(repoLibrary, /getEditableById/, 'repo PNGs can be converted back to editor motif data for revision');

assert.match(renderer, /DOCS_BASE_URL/, 'canonical creature renderer resolves assets correctly from nested tools');
assert.match(renderer, /docsUrl\('config\/creature-base-masks\.json'\)/, 'canonical base masks use the same docs-root resolution');
assert.match(renderer, /RepoPatternLibrary\?\.getById\?\.\(repoPatternId\)/, 'animal paint resolves repoPatternId lazily at runtime');
assert.match(renderer, /paint\.repoPatternId \|\| paint\.pattern\?\.repoPatternId/, 'repo pattern identity participates in paint resolution/signatures');
assert.match(renderer, /paint\.patternScale/, 'animal surface paint scale participates in the creature render signature');
assert.match(renderer, /usageScaleMultiplier: animalPatternScale/, 'animal renderer applies its normalized pattern scale as a transient usage multiplier');
assert.match(renderer, /Math\.max\(7, Math\.min\(14, Number\(paint\.patternScale\) \|\| 7\)\)/, 'animal pattern usage scale is clamped to the purpose-specific 7×–14× range');
assert.match(weaving, /const ANIMAL_PATTERN_OUTLINE_WIDTH = 6;[\s\S]*debugLabel === 'animal-surface-pattern' \? ANIMAL_PATTERN_OUTLINE_WIDTH : baseWidth;/, 'the explicitly labeled animal surface pass uses a fixed 6px outline while clothing retains its ordinary raster-space outline width');
assert.match(weaving, /const outlineDiskOffsetCache = new Map\(\)/, 'large pattern outlines reuse cached disk neighborhoods');
assert.match(weaving, /for \(const boundaryPixel of boundaryPixels\)/, 'outline dilation expands from motif boundaries instead of searching around every garment pixel');
assert.match(weaving, /patternDef\?\.usageScaleMultiplier/, 'shared pattern compositor supports a purpose-specific normalized scale multiplier after authored pattern scale resolution');
assert.match(weaving, /scaledOutlineWidth\(PATTERN_OUTLINE_WIDTH, pattern, debugLabel\)/, 'the final outline pass receives the compositor label so animal thickness is selected by render purpose rather than inferred from scale');
assert.match(weaving, /isAbsoluteOrBlob = \/\^\(\?:https\?:\|blob:\|data:\|\\\/\\\/\)\/i/, 'absolute/CDN repo motif URLs bypass game-relative loadImg normalization');
assert.match(renderer, /getLastPatternPaintDebug/, 'creature compositor exposes per-region pattern paint diagnostics to Character Studio');
assert.match(renderer, /compositor returned the unpatterned source/, 'creature compositor reports a visibly unapplied pattern instead of failing silently');

assert.match(animalAppearance, /Surface pattern paint/, 'animal appearance editor exposes surface patterns in its existing Animal section');
assert.match(animalAppearance, /animalNpcRepoPattern/, 'each visible genetic region gets a repo pattern selector');
assert.match(animalAppearance, /animalNpcRepoPatternInk/, 'each selected repo pattern gets an independent ink-color control');
assert.match(animalAppearance, /animalNpcRepoPatternScale/, 'each selected animal repo pattern exposes a normalized per-region scale slider');
assert.match(animalAppearance, /type="range" min="7" max="14" step="0\.1"/, 'animal pattern scale editor exposes the 7×–14× purpose-specific range');
assert.match(animalAppearance, /animalNpcRepoPatternScaleNumber/, 'animal pattern scale also has a precise numeric editor for the 7×–14× animal-use range');
assert.match(animalAppearance, /Animal-use scale only: 7× minimum\/default, up to 14×/, 'Character Studio explains the purpose-specific animal scale range and default');
assert.match(animalAppearance, /data-animal-pattern-status/, 'Character Studio shows whether each selected animal repo pattern actually rendered');
assert.match(animalAppearance, /Preview failed:/, 'Character Studio surfaces the compositor failure reason rather than leaving a plain animal ambiguous');
assert.match(animalAppearance, /genotypeDraft\.colorPoolPaint/, 'NPC authoring persists the same genotype paint field used by Color Pools');
assert.match(animalAppearance, /pattern: \{ repoPatternId \}/, 'NPC records store a small committed repo reference instead of motif bytes');
assert.match(animalAppearance, /renderer\.composeFrame\(kind, 'idle', genotype, false\)/, 'Character Studio preview uses the exact runtime creature compositor resolved by waitForCanonicalCreatureRenderer');
assert.match(repoPicker, /repo-pattern-library\.js/, 'Character Studio dynamically loads the repo pattern library');
assert.match(repoPicker, /clothing-weaving-system\.js/, 'Character Studio dynamically loads the shared pattern compositor');
assert.match(repoPicker, /creature-genetics-render\.js/, 'Character Studio dynamically loads the canonical creature renderer');
assert.match(gameIndex, /js\/repo-pattern-library\.js/, 'normal game runtime loads committed repo patterns before animal rendering');
assert.match(gameIndex, /js\/pattern-library-dev-export\.js/, 'normal game runtime loads the dev-only character pattern exporter');
assert.match(devExporter, /PatternLibrary\?\.listSaved\?\.\(\)/, 'Settings exporter lists only the active character\'s saved patterns, not unlocked catalog motifs');
assert.match(devExporter, /const ROW_ID = 'patternLibraryDevExportRow'/, 'Settings exporter owns a compact dedicated row with a stable DOM id');
assert.match(devExporter, /settingDevMode/, 'Settings exporter is gated by the existing authoritative Dev Mode toggle');
assert.match(devExporter, /data-pattern-export="png"/, 'Settings exporter offers direct motif PNG export');
assert.match(devExporter, /data-pattern-export="json"/, 'Settings exporter offers repo-ready pattern JSON export');
assert.match(devExporter, /data-pattern-export="both"/, 'Settings exporter can export the PNG and JSON pair together');
assert.match(devExporter, /motifFile = 'motif_' \+ id \+ '\.png'/, 'character pattern PNG filename matches standalone Pattern Editor');
assert.match(devExporter, /jsonFile = 'pattern_' \+ id \+ '\.json'/, 'character pattern JSON filename matches standalone Pattern Editor');
assert.match(devExporter, /schema: 'hobunji_pattern\.v1'/, 'character pattern JSON uses the canonical repo pattern schema');
assert.match(devExporter, /motifPng: 'assets\/patterns\/' \+ motifFile/, 'character pattern JSON references its sibling repo PNG instead of embedding base64');
assert.match(devExporter, /MotifStore\.loadMotif/, 'Settings exporter can resolve indirectly stored custom motif pixels before PNG export');

const sourceThicknessIndex = weaving.indexOf('const adjustedSrcMask = adjustMaskThickness(srcMask, sourceAllowedMask'); // Signed contour work belongs in motif-source pixels, before scaling/stamping.
const meshScaleIndex = weaving.indexOf('ctx.scale(meshScale, meshScale)', sourceThicknessIndex);
const repeatMaskIndex = weaving.indexOf('const patternMask = new Uint8Array(pixelCount)'); // Repeated motif instances still flatten into one final sampled mask.
const noSecondThicknessIndex = weaving.indexOf('const adjustedMask = patternMask;', repeatMaskIndex); // Final output uses the already-adjusted source silhouette without another coarse raster-space pass.
const sharedOutlineIndex = weaving.indexOf('buildPatternOutlineMask(adjustedMask', noSecondThicknessIndex);
assert(sourceThicknessIndex >= 0 && meshScaleIndex > sourceThicknessIndex, 'woven motif thinning/thickening must happen before whole-pattern mesh scaling');
assert(repeatMaskIndex > meshScaleIndex && noSecondThicknessIndex > repeatMaskIndex && sharedOutlineIndex > noSecondThicknessIndex, 'repeated instances still union before the shared final outline, with no second output-pixel thickness pass');


assert.doesNotMatch(weaving, /\berodeMask\b/, 'weaving module must not retain stale erodeMask references after the signed contour refactor');
assert.match(weaving, /__test: Object\.freeze\([^]*buildMotifClusterSeparatorMask[^]*adjustMaskThickness[^]*buildPatternOutlineMask/, 'weaving test exports expose motif-island topology, signed contour, and centered outline helpers');
assert.match(weaving, /function buildMotifClusterSeparatorMask\(mask, width, height\)/, 'weaving derives a watershed between disconnected opaque islands in one source motif');
assert.match(weaving, /canvas\.__motifClusterSeparatorCanvas = clusterSeparatorSrc \? clusterSeparatorCanvas : null/, 'each rendered motif mesh carries its transformed per-instance no-fuse watershed');
assert.match(weaving, /clusterSeparatorMask && paddedSeparatorData\[mi \+ 3\] > 16/, 'garment-cell sampling applies the same offset to motif ink and its island separator');
assert.match(weaving, /!clusterSeparatorMask\?\.\[p\] && offset\.d2 <= outward2/, 'outward outline growth skips intra-motif island separator pixels while expanding from motif boundaries');
assert.match(weaving, /!allowedMask\[p\] \|\| clusterSeparatorMask\?\.\[p\]/, 'motif thickening cannot bridge two separate ink islands inside one motif instance');
assert.match(weaving, /const adjustedSrcMask = adjustMaskThickness\(srcMask, sourceAllowedMask, srcSize, srcSize, sourceSignedThickness, sourceClusterSeparatorMask\)/, 'weaving measures signed contour thickness in rotated source-motif pixels');
assert.match(weaving, /const sourceSignedThickness = \(patternDef\?\.invert \? -1 : 1\)/, 'inverted weaving reverses source morphology so positive values remain visibly thinner');
assert.doesNotMatch(weaving, /adjustMaskThickness\(patternMask, garmentMask/, 'weaving no longer performs coarse final-garment-pixel contour adjustment');
assert.match(metalRecolor, /const adjustedSrcMask = adjustMaskThickness\(srcMask, sourceAllowedMask, srcSize, srcSize, patternDef\.motifThinPx/, 'metal authored patterns use the same pre-scale motif-pixel measurement');
assert.doesNotMatch(metalRecolor, /adjustMaskThickness\(buildAuthoredClearedMask/, 'metal authored patterns no longer receive a second output-pixel contour pass');
assert.doesNotMatch(metalRecolor, /\berodeMask\b/, 'metal compositor must not retain the stale erodeMask test export after signed thickness refactor');
assert.match(authoring, /getContext\('2d', \{ willReadFrequently: true \}\)/, 'motif sketch canvas opts into frequent readback for its repeated getImageData calls');
assert.match(authoring, /Motif thinning \/ thickening/, 'Pattern Authoring labels the signed contour control as thinning/thickening');
assert.match(authoring, /data-field="motifThinPx" min="-12" max="12"/, 'thinning/thickening slider is symmetric around the default zero midpoint');
assert.match(authoring, /Thin \$\{amount\} motif px/, 'signed contour readout explicitly reports source-motif pixels');
assert.match(authoring, /before Pattern scale, frame scale, or mesh scale/, 'Pattern Authoring explains that contour units are measured before every visual scale');
for (const [source, label] of [[weaving, 'weaving'], [metalRecolor, 'metal/verdigris']]) {
  assert.match(source, /function adjustMaskThickness\(mask, allowedMask, width, height, signedPx/, label + ' supports signed motif contour adjustment');
  assert.match(source, /if \(amount > 0\)/, label + ' retains inward erosion for positive values');
  assert.match(source, /const radius = Math\.abs\(amount\)/, label + ' grows the motif for negative values');
  assert.match(source, /!allowedMask\[p\]/, label + ' thickening cannot escape the valid target surface');
}
assert.match(weaving, /const inwardRadius = Math\.floor\(totalRadius \/ 2\)/, 'woven motif outline moves half of its former outward width inward');
assert.match(weaving, /const outwardRadius = totalRadius - inwardRadius/, 'woven motif outline keeps the other half outside');
assert.doesNotMatch(weaving, /if \(!garmentMask\[p\] \|\| patternMask\[p\]\) continue;/, 'woven outline no longer excludes all motif pixels from the outline pass');
assert.match(metalRecolor, /!!authoredPattern, \/\/ Authored motif outlines are centered/, 'authored metal patterns use centered outlines without changing procedural verdigris');

function assertMainMotifScaleSemantics(source, label) {
  const genericDraw = source.includes('function drawCell(targetCtx, sourceImage)');
  const drawCellIndex = genericDraw ? source.indexOf('function drawCell(targetCtx, sourceImage)') : source.indexOf('function drawCell()');
  const clipIndex = genericDraw ? source.indexOf('targetCtx.clip();', drawCellIndex) : source.indexOf('ctx.clip();', drawCellIndex);
  const motifScaleIndex = genericDraw ? source.indexOf('targetCtx.scale(motifScale, motifScale);', clipIndex) : source.indexOf('ctx.scale(motifScale, motifScale);', clipIndex);
  const sourceDrawIndex = genericDraw ? source.indexOf('targetCtx.drawImage(sourceImage, 0, 0);', motifScaleIndex) : source.indexOf('ctx.drawImage(adjustedSrc, 0, 0);', motifScaleIndex);
  const latticeIndex = source.indexOf('shape.basis(cellW, cellH)', sourceDrawIndex);
  assert(drawCellIndex >= 0 && clipIndex > drawCellIndex, label + ' must establish the fixed frame clip inside drawCell');
  assert(motifScaleIndex > clipIndex, label + ' must apply motifScale while that frame clip is already active');
  assert(sourceDrawIndex > motifScaleIndex, label + ' must draw the scaled source through the active fixed frame clip');
  assert(latticeIndex > sourceDrawIndex, label + ' must derive lattice spacing from unscaled cellW/cellH');
  assert(!source.includes('const framedStamp ='), label + ' must not scale a post-cropped stamp');
  assert(!source.includes('Math.hypot(cellW, cellH) * Math.max(1, motifScale)'), label + ' must not enlarge tiling coverage for nonexistent frame leakage');
}
assertMainMotifScaleSemantics(weaving, 'weaving compositor');
assertMainMotifScaleSemantics(metalRecolor, 'metal/verdigris compositor');
assert(authoring.includes('anything outside the frame is clipped'), 'Pattern Authoring help must describe main\'s hard frame clip accurately');

const inlineScripts = [...tool.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(script => script.trim());
assert(inlineScripts.length, 'Pattern Editor contains its controller script');
for (const script of inlineScripts) new vm.Script(script, { filename: 'pattern-editor-inline.js' });

console.log('Repo-backed Pattern Editor, simple canvas preview, and animal NPC surface-pattern integration checks passed');

assert.match(renderer, /animal:\$\{kind\}:\$\{frame\}:base:\$\{baseColor \|\| 'native'\}/, 'animal base pattern cache keys include the underlying coat tint');
assert.match(renderer, /animal:\$\{kind\}:\$\{frame\}:\$\{patternId\}:\$\{renderColor \|\| 'native'\}/, 'animal genetic-layer pattern cache keys include the underlying layer tint');
