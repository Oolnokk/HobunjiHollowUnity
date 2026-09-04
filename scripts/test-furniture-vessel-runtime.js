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
const rootTotemConfigSource = read('docs/config/root-totem-config.js');

assert(procedural.includes("part.kind === 'cup' || part.kind === 'liquidSurface'"),
  'pre-existing generic primitive path must remain detectable by this regression');
assert(vessel.includes("if (part.kind === 'cup')"));
assert(vessel.includes('Top rim annulus'));
assert(vessel.includes('no center/top cap exists'));
assert(vessel.includes('innerFloor'));
assert(vessel.includes('basinDepth'));
assert(vessel.includes('hobunjiHollowCup'));
assert(vessel.includes('ensureUvs'));
assert(vessel.includes('THREE.DoubleSide'));

assert(vessel.includes("else if (part.kind === 'liquidSurface')"));
assert(vessel.includes('createEmptyLiquidGeometry'));
assert(vessel.includes('hobunjiLinkedLiquidPlaceholder'));

// The procedural group is explicitly a temporary fallback: if authored JSON
// wins the async race later, only original fallback children are replaced.
assert(vessel.includes('function buildFurnitureGroup(key, baseColor)'));
assert(vessel.includes('authoredRuntime?.load'));
assert(vessel.includes('const fallbackChildren = [...group.children]'));
assert(vessel.includes('for (const child of fallbackChildren)'));
assert(vessel.includes('authoredFurnitureUpgradeSource'));
assert(vessel.includes('async-fallback-upgrade'));
assert(vessel.includes('furniture.buildFurnitureGroup = buildFurnitureGroup'));

assert(zone.includes("ensureCompanionScript('FurnitureVesselRuntime', 'furniture-vessel-runtime.js')"),
  'normal game boot must install the shared furniture correction');
assert(authoredRuntime.includes('window.ProceduralFurniture.buildPartMesh(part, baseColor)'),
  'authored furniture should consume the corrected shared part builder');
assert(authoredRuntime.includes("if (part.kind === 'liquidSurface')"));
assert(authoredRuntime.includes('_liquidSurfaceGeometry(part, partById'));

// Life Totem liquid rendering/lighting is now configured externally. The
// composer consumes those settings rather than repeating magic numbers.
assert.doesNotThrow(() => new vm.Script(rootTotemConfigSource, { filename: 'root-totem-config.js' }));
assert(lifeTotem.includes('const liquidCfg = CFG.basin.material'));
assert(lifeTotem.includes('const lightCfg = CFG.basin.light'));
assert(lifeTotem.includes('CFG.colors.liquid'));
assert(lifeTotem.includes('new THREE.MeshLambertMaterial'));
assert(lifeTotem.includes('new THREE.PointLight('));
assert(lifeTotem.includes('lifeTotemAuthoritativeLiquidMaterial'));
assert(!lifeTotem.includes('emissiveIntensity: 0.65'), 'basin emissive tuning must live in the config file');
assert(!lifeTotem.includes('opacity: 0.78'), 'basin opacity tuning must live in the config file');
assert(rootTotemConfigSource.includes('emissiveIntensity:0.65'));
assert(rootTotemConfigSource.includes('opacity:0.78'));
assert(rootTotemConfigSource.includes('depthWrite:false'));
assert(rootTotemConfigSource.includes("light:{enabled:true,color:'#7fe7c4',intensity:1.25,distance:4.2,decay:1.7"));

const trough = json('docs/config/furniture-authored/trough.json');
const troughCup = trough.parts.find((p) => p.kind === 'cup');
const troughFill = trough.parts.find((p) => p.kind === 'liquidSurface');
assert(troughCup && troughFill);
assert.strictEqual(troughFill.liquidContainerId, troughCup.id);
assert.strictEqual(troughFill.liquidLevel, 0,
  'empty trough authored level must stay zero rather than being interpreted as max fill');

const squeezer = json('docs/config/furniture-authored/squeezer.json');
assert(squeezer.parts.some((p) => p.kind === 'cup' && /Wine Vat/i.test(p.name || '')),
  'wine vat must stay on the shared cup primitive so this fix covers it too');

const agingBarrel = json('docs/config/furniture-authored/agingBarrel.json');
assert(agingBarrel.parts.some((p) => p.kind === 'barrel' && /Wooden Body/i.test(p.name || '')),
  'aging barrel must retain its rich authored wooden-body model');
assert(agingBarrel.parts.some((p) => /Hoop/i.test(p.name || '')),
  'aging barrel must retain its authored hoop details instead of the crude procedural recipe');

console.log('furniture vessel/runtime upgrade regression checks: PASS');
