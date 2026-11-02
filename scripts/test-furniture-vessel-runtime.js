'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const vessel = read('docs/js/furniture-vessel-runtime.js');
const zone = read('docs/js/zone-den-totem-features.js');
const authoredRuntime = read('docs/js/authored-furniture-runtime.js');
const procedural = read('docs/js/procedural-furniture.js');
const lifeTotem = read('docs/js/life-totem-furniture.js');
const deadzone = read('docs/js/deadzone-billboard.js');
const pieceAnimation = read('docs/js/furniture-piece-animation-runtime.js');
const rootTotemConfigSource = read('docs/config/root-totem-config.js');

const proportionBuildInputs = []; // Captures the data passed through the real AuthoredFurniture.buildGroup wrapper.
const proportionWindow = {
  THREE: {}, // The proportion adapter does not construct geometry; the stub keeps the runtime's normal install guard satisfied.
  ProceduralFurniture: {
    buildPartMesh() { return null; },
    buildFurnitureGroup() { return { children: [], userData: {} }; },
  },
  AuthoredFurniture: {
    buildGroup(data) { proportionBuildInputs.push(data); return { userData: {} }; },
    peek() { return null; },
    load() { return Promise.resolve(null); },
  },
};
vm.runInNewContext(vessel, { window: proportionWindow, console });
function proportionedFurniture(key) {
  const source = json(`docs/config/furniture-authored/${key}.json`);
  const sourceSnapshot = JSON.stringify(source);
  proportionWindow.AuthoredFurniture.buildGroup(source);
  const adjusted = proportionBuildInputs.pop();
  assert(adjusted, `${key} must pass through the shared authored group builder`);
  assert.equal(JSON.stringify(source), sourceSnapshot, `${key} cached authored data must not be mutated`);
  return { source, adjusted };
}
function surfaceHalfExtent(data, axis) {
  const sizeField = axis === 'x' ? 'sx' : 'sz';
  const topField = axis === 'x' ? 'topScaleX' : 'topScaleZ';
  const bottomField = axis === 'x' ? 'bottomScaleX' : 'bottomScaleZ';
  return Math.max(0, ...(data.parts || []).map(part => {
    const t = part.transform || {};
    const position = Number(t[axis]) || 0;
    const size = Math.abs(Number(t[sizeField]) || 0);
    const top = Number.isFinite(Number(part[topField])) ? Math.abs(Number(part[topField])) : 1;
    const bottom = Number.isFinite(Number(part[bottomField])) ? Math.abs(Number(part[bottomField])) : 1;
    return Math.abs(position) + size * 0.5 * Math.max(top, bottom);
  }));
}

// The single and double beds retain their already-halved Y proportions,
// while their actual part bounds leave a quarter tile of floor on every edge.
const basicBedSource = json('docs/config/furniture-authored/basicBed.json');
const basicBedBefore = JSON.stringify(basicBedSource);
proportionWindow.AuthoredFurniture.buildGroup(basicBedSource);
const basicBedProportioned = proportionBuildInputs.pop();
assert.equal(JSON.stringify(basicBedSource), basicBedBefore, 'single-bed source data remains immutable');
assert.ok(Math.abs(surfaceHalfExtent(basicBedProportioned, 'x') - 0.25) < 1e-6, 'single bed leaves 0.25 tile clear on each X edge');
assert.ok(Math.abs(surfaceHalfExtent(basicBedProportioned, 'z') - 0.75) < 1e-6, 'single bed leaves 0.25 tile clear at both Z ends');
assert.equal(basicBedProportioned.parts[0].transform.sy, basicBedSource.parts[0].transform.sy, 'single-bed Y scale remains the already-halved authored value');
assert.equal(basicBedProportioned.parts[0].transform.y, basicBedSource.parts[0].transform.y, 'single-bed vertical position is unchanged');
const { source: doubleBedSource, adjusted: doubleBedProportioned } = proportionedFurniture('doubleBed');
assert.ok(Math.abs(surfaceHalfExtent(doubleBedProportioned, 'x') - 0.75) < 1e-6, 'double bed leaves 0.25 tile clear on each X edge');
assert.ok(Math.abs(surfaceHalfExtent(doubleBedProportioned, 'z') - 0.75) < 1e-6, 'double bed leaves 0.25 tile clear on each Z edge');
assert.equal(doubleBedProportioned.parts[0].transform.sy, doubleBedSource.parts[0].transform.sy, 'double-bed Y scale remains unchanged by the footprint inset');
const { source: bedrollSource, adjusted: bedrollProportioned } = proportionedFurniture('bedroll');
assert.deepEqual(bedrollProportioned.parts.map(part => part.transform), bedrollSource.parts.map(part => part.transform),
  'bedroll keeps its original dimensions');

// Every ordinary floor-rooted surface piece is shortened around the floor,
// so its legs stay planted and its top remains at the new half-height.
const { adjusted: smallTable } = proportionedFurniture('tableSmall');
const smallTableTop = smallTable.parts.find(part => /Table Small Box/.test(part.name));
assert.equal(smallTableTop.transform.y, 0.235, 'small table top center follows the floor-rooted half-height');
assert.equal(smallTableTop.transform.sy, 0.05, 'small table top thickness is halved');
const { source: counterSource, adjusted: counter } = proportionedFurniture('counter');
assert.equal(counter.parts[0].transform.y, counterSource.parts[0].transform.y * 0.5, 'counter body is vertically halved from the floor');
assert.equal(counter.parts[0].transform.sy, counterSource.parts[0].transform.sy * 0.5, 'counter body height is halved');
assert.equal(counter.parts[1].transform.y + counter.parts[1].transform.sy * 0.5,
  (counterSource.parts[1].transform.y + counterSource.parts[1].transform.sy * 0.5) * 0.5,
  'countertop upper surface is lowered by exactly half');
for (const key of ['tableLong', 'tableRound', 'servingTable', 'desk', 'nightstand', 'dresser']) {
  const { source, adjusted } = proportionedFurniture(key);
  assert.equal(adjusted.parts[0].transform.y, source.parts[0].transform.y * 0.5, `${key} parts are floor-rooted at half height`);
  assert.equal(adjusted.parts[0].transform.sy, source.parts[0].transform.sy * 0.5, `${key} part height is halved`);
}
const { source: candleTableSource, adjusted: candleTableProportioned } = proportionedFurniture('candleTable');
const candleTableTopSource = candleTableSource.parts.find(part => part.name === 'Candle Table Box');
const candleTableTop = candleTableProportioned.parts.find(part => part.name === 'Candle Table Box');
const candleCylinderSource = candleTableSource.parts.find(part => part.name === 'Candle Table Cylinder');
const candleCylinder = candleTableProportioned.parts.find(part => part.name === 'Candle Table Cylinder');
const candleDiscSource = candleTableSource.parts.find(part => part.name === 'Candle Table Disc');
const candleDisc = candleTableProportioned.parts.find(part => part.name === 'Candle Table Disc');
const candleDrop = (candleTableTopSource.transform.y + candleTableTopSource.transform.sy * 0.5) * 0.5;
assert.equal(candleTableTop.transform.y + candleTableTop.transform.sy * 0.5, 0.23, 'candle-table surface lowers to the exact half-height');
assert.equal(candleCylinder.transform.y, candleCylinderSource.transform.y - candleDrop, 'candle assembly follows the lowered tabletop');
assert.equal(candleCylinder.transform.sy, candleCylinderSource.transform.sy, 'candle retains its original height');
assert.equal(candleDisc.transform.y, candleDiscSource.transform.y - candleDrop, 'candle foot follows the lowered tabletop');
assert.equal(candleDisc.transform.sy, candleDiscSource.transform.sy, 'candle foot retains its original thickness');
assert.deepEqual(candleTableProportioned.particleEmitters[0].position, candleTableSource.particleEmitters[0].position,
  'candle flame local offset remains attached to the moved candle part');

const { source: lanternSource, adjusted: lanternProportioned } = proportionedFurniture('standingLamp');
const lanternTableTopSource = lanternSource.parts.find(part => part.name === 'Lantern Table Top');
const lanternTableTop = lanternProportioned.parts.find(part => part.name === 'Lantern Table Top');
const lanternBaseSource = lanternSource.parts.find(part => part.name === 'Bronze Lantern Base');
const lanternBase = lanternProportioned.parts.find(part => part.name === 'Bronze Lantern Base');
const lanternGlassSource = lanternSource.parts.find(part => part.name === 'Amber Lantern Glass');
const lanternGlass = lanternProportioned.parts.find(part => part.name === 'Amber Lantern Glass');
const lanternDrop = (lanternTableTopSource.transform.y + lanternTableTopSource.transform.sy * 0.5) * 0.5;
assert.equal(lanternTableTop.transform.y + lanternTableTop.transform.sy * 0.5, 0.355, 'lantern-table surface lowers to the exact half-height');
assert.equal(lanternBase.transform.y, lanternBaseSource.transform.y - lanternDrop, 'lantern base follows the lowered tabletop');
assert.equal(lanternBase.transform.sy, lanternBaseSource.transform.sy, 'lantern base retains its original size');
assert.equal(lanternGlass.transform.y, lanternGlassSource.transform.y - lanternDrop, 'lantern body follows the lowered tabletop');
assert.equal(lanternGlass.transform.sy, lanternGlassSource.transform.sy, 'lantern body retains its original height');
for (const key of ['bookshelf', 'chairSimple', 'artifactPedestal']) {
  const { source, adjusted } = proportionedFurniture(key);
  assert.deepEqual(adjusted.parts.map(part => part.transform), source.parts.map(part => part.transform),
    `${key} is not floor-rooted surface furniture and remains unchanged`);
}

assert(procedural.includes("part.kind === 'liquidSurface'"),
  'linked liquid-surface fallback remains available after barrel/cup geometry parity');
assert(procedural.includes("part.kind === 'barrel' || part.kind === 'cup'") &&
  procedural.includes('createAuthoredVesselGeometry(part)'),
  'native runtime builds the furniture editor’s rounded barrel and open cups');
assert(procedural.includes("if (part.materialLighting !== 'unlit') return new THREE.MeshLambertMaterial"),
  'ordinary unflagged furniture must retain its established Lambert material path');
assert(procedural.includes('window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit'),
  'explicitly unlit furniture must reuse the canonical authored-PNG material factory');
assert(procedural.includes("part.materialUvMapping !== 'connected-surface-stretch'"),
  'connected-surface furniture remapping must remain explicitly opt-in');
assert(procedural.includes('window.HobunjiSurfaceStretchUV'),
  'opted-in furniture must reuse the canonical connected-surface mapper');
assert(procedural.includes('mapper.mapMesh(mesh, {'),
  'opted-in furniture must run the shared mapper on its final primitive geometry');

// Shared part interception must delegate to the original builder first, then
// alter geometry only for the two vessel-specific kinds. Ordinary furniture
// parts keep the exact original ProceduralFurniture mesh path.
assert(vessel.includes('const mesh = originalBuildPartMesh(part, baseColor)'));
assert(vessel.includes('if (!part || !mesh) return mesh'));
assert(vessel.includes("if (part.kind === 'cup')"));
assert(vessel.includes("else if (part.kind === 'liquidSurface')"));
assert(!vessel.includes('furniture.CATALOG ='), 'shared runtime must never replace the furniture catalog');
assert(!vessel.includes('furniture.CATALOG['), 'shared runtime must never mutate individual catalog recipes');

assert(vessel.includes('Top rim annulus'));
assert(vessel.includes('no center/top cap exists'));
assert(vessel.includes('innerFloor'));
assert(vessel.includes('basinDepth'));
assert(vessel.includes('hobunjiHollowCup'));
assert(vessel.includes('ensureUvs'));
assert(vessel.includes('THREE.DoubleSide'));
assert(vessel.includes('createEmptyLiquidGeometry'));
assert(vessel.includes('hobunjiLinkedLiquidPlaceholder'));

// Procedural Drenkirra/den nests deliberately keep their existing footprint
// and woven colors, but their former capped-cylinder body + solid rim disc are
// upgraded at group-build time to the exact hollow cup geometry and an open
// hoop rim. This is what keeps visible eggs/babies from being buried by mesh.
assert(vessel.includes('function upgradeProceduralNestToOpenCup(group, key)'));
assert(vessel.includes("key !== 'nest' && key !== 'nestBranch'"));
assert(vessel.includes("kind: 'cup'"));
assert(vessel.includes('innerScale: 0.78'));
assert(vessel.includes('basinDepth: 0.12'));
assert(vessel.includes('createHoopGeometry(rimPart)'));
assert(vessel.includes("hobunjiOpenNestSource = 'furniture-cup-preset'"));
assert(vessel.includes('upgradeProceduralNestToOpenCup(group, key)'));

// The procedural group remains the same object while an authored file is
// loading. If richer authored data resolves, only the children captured from
// the original fallback are swapped; later lights/interactions/helpers survive.
assert(vessel.includes('function buildFurnitureGroup(key, baseColor)'));
assert(vessel.includes('const group = originalBuildFurnitureGroup ? originalBuildFurnitureGroup(key, baseColor)'));
assert(vessel.includes('authoredRuntime?.load'));
assert(vessel.includes('const fallbackChildren = [...group.children]'));
assert(vessel.includes('for (const child of fallbackChildren)'));
assert(vessel.includes("authoredFurnitureUpgradeSource: 'async-fallback-upgrade'"));
assert(vessel.includes('furniture.buildFurnitureGroup = buildFurnitureGroup'));
assert(vessel.includes('material.dispose?.()'));
assert(vessel.includes('disposing material.map here would invalidate other furniture'));
assert(vessel.includes('InteriorFireFloorRuntime?.onAuthoredFurnitureReady?.(target, data'),
  'async authored upgrades must notify ambient VFX after meshById is installed');
assert(vessel.includes('InteriorFireFloorRuntime?.onAuthoredFurnitureReady?.(ready, cached'),
  'already-cached authored furniture must use the same ambient VFX readiness hook');

assert.match(zone, /ensureCompanionScript\('FurnitureVesselRuntime', 'furniture-vessel-runtime\.js(?:\?v=[A-Za-z0-9_-]+)?'\)/,
  'normal game boot must install the shared vessel correction');
assert(authoredRuntime.includes('window.ProceduralFurniture.buildPartMesh(part, baseColor)'),
  'authored furniture should consume the corrected shared part builder');
assert(authoredRuntime.includes("if (part.kind === 'liquidSurface')"));
assert(authoredRuntime.includes('_liquidSurfaceGeometry(part, partById'));

// Life Totem liquid color is intentionally unlit; emitted light is a separate
// configured PointLight created through the shared helper.
assert.doesNotThrow(() => new vm.Script(rootTotemConfigSource, { filename: 'root-totem-config.js' }));
assert(lifeTotem.includes('const liquidCfg=CFG.basin.material'));
assert(lifeTotem.includes('lightCfg=CFG.basin.light'));
assert(lifeTotem.includes('CFG.colors.liquid'));
assert(lifeTotem.includes('new THREE.MeshBasicMaterial'));
assert(!lifeTotem.includes('new THREE.MeshLambertMaterial'));
assert(lifeTotem.includes('DeadzoneBillboard?.addConfiguredPointLight'));
assert(lifeTotem.includes('lifeTotemAuthoritativeLiquidMaterial'));
assert(!lifeTotem.includes('opacity:0.78'), 'basin opacity tuning must live in the config file');
assert(rootTotemConfigSource.includes("material:{model:'unlit',opacity:0.78,depthWrite:false,transparent:true}"));
assert(rootTotemConfigSource.includes("enabled:true,color:'#7fe7c4',intensity:1.25,distance:2.4,decay:1.7"));

// Existing authored furniture data remains authoritative and untouched. These
// fixtures exercise the shared vessel path and the authored-upgrade path.
const trough = json('docs/config/furniture-authored/trough.json');
const troughCup = trough.parts.find((p) => p.kind === 'cup');
const troughFill = trough.parts.find((p) => p.kind === 'liquidSurface');
assert(troughCup && troughFill);
assert.strictEqual(troughFill.liquidContainerId, troughCup.id);
assert.strictEqual(troughFill.liquidLevel, 0,
  'empty trough authored level must stay zero rather than being interpreted as max fill');

const squeezer = json('docs/config/furniture-authored/squeezer.json');
assert(squeezer.parts.some((p) => p.kind === 'cup' && /Wine Vat/i.test(p.name || '')),
  'wine vat must stay on the shared cup primitive so the hollow-vessel fix covers it');

const agingBarrel = json('docs/config/furniture-authored/agingBarrel.json');
assert(agingBarrel.parts.some((p) => p.kind === 'barrel' && /Wooden Body/i.test(p.name || '')),
  'aging barrel must retain its rich authored wooden-body model');
assert(agingBarrel.parts.some((p) => /Hoop/i.test(p.name || '')),
  'aging barrel must retain its authored hoop details instead of the crude procedural recipe');

console.log('furniture vessel/runtime upgrade regression checks: PASS');

assert(!/caveTextureFor[\s\S]{0,900}tex\.needsUpdate\s*=\s*true/.test(zone),
  'den/locale cave TextureLoader result must not be marked dirty before its image exists');
assert(deadzone.includes('entry={base:null,pending:new Set()}'),
  'deadzone rope textures track clones that were created before the source image loaded');
assert(deadzone.includes('else entry.pending.add(texture)'),
  'deadzone rope clones remain clean until the source image is available');
assert(pieceAnimation.includes('entry = { base: null, pending: new Set() }'),
  'animated furniture rope textures track pre-load clones');
assert(pieceAnimation.includes('if (rope.material.map.image) rope.material.map.needsUpdate=true'),
  'animated rope repeat updates cannot mark an image-less texture dirty');
assert(!pieceAnimation.includes('texture.needsUpdate=true;\n    const material'),
  'animated furniture no longer marks a just-cloned image-less texture dirty');
