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

assert(zone.includes("ensureCompanionScript('FurnitureVesselRuntime', 'furniture-vessel-runtime.js')"),
  'normal game boot must install the shared vessel correction');
assert(authoredRuntime.includes('window.ProceduralFurniture.buildPartMesh(part, baseColor)'),
  'authored furniture should consume the corrected shared part builder');
assert(authoredRuntime.includes("if (part.kind === 'liquidSurface')"));
assert(authoredRuntime.includes('_liquidSurfaceGeometry(part, partById'));

// Life Totem liquid color is intentionally unlit; emitted light is a separate
// configured PointLight created through the shared helper.
assert.doesNotThrow(() => new vm.Script(rootTotemConfigSource, { filename: 'root-totem-config.js' }));
assert(lifeTotem.includes('const liquidCfg=CFG.basin.material'));
assert(lifeTotem.includes('const lightCfg=CFG.basin.light'));
assert(lifeTotem.includes('CFG.colors.liquid'));
assert(lifeTotem.includes('new THREE.MeshBasicMaterial'));
assert(!lifeTotem.includes('new THREE.MeshLambertMaterial'));
assert(lifeTotem.includes('DeadzoneBillboard?.addConfiguredPointLight'));
assert(lifeTotem.includes('lifeTotemAuthoritativeLiquidMaterial'));
assert(!lifeTotem.includes('opacity:0.78'), 'basin opacity tuning must live in the config file');
assert(rootTotemConfigSource.includes("material:{model:'unlit',opacity:0.78,depthWrite:false,transparent:true}"));
assert(rootTotemConfigSource.includes("enabled:true,color:'#7fe7c4',intensity:1.25,distance:4.2,decay:1.7"));

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
