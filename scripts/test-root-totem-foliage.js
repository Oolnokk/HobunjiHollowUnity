'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repoRoot = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(repoRoot, p), 'utf8');
const json = p => JSON.parse(read(p));
function parses(p) { const s = read(p); assert.doesNotThrow(() => new vm.Script(s, { filename:p })); return s; }
function runWindow(p, window = {}) { window.window = window; const c = vm.createContext({ window, console, URL }); new vm.Script(parses(p), { filename:p }).runInContext(c); return window; }

const configWindow = runWindow('docs/config/root-totem-config.js');
const cfg = configWindow.HOBUNJI_ROOT_TOTEM_CONFIG;
assert(cfg);
assert.strictEqual(cfg.schema, 'hobunji_root_totem_config.v2');
assert.strictEqual(cfg.canonicalRecipe.seedU32, 7319);
assert.strictEqual(cfg.colors.liquid, '#7fe7c4');
assert.strictEqual(cfg.shadewoodSurface.vineCountScale, 0.5);
assert.strictEqual(cfg.shadewoodSurface.vineRadiusScale, 2);
assert.strictEqual(cfg.shadewoodSurface.reuseNaturalSurfaceMaterials, true);
assert.strictEqual(cfg.shadewoodSurface.shellOutline, true);
assert.strictEqual(cfg.bottle.rope.shellOutline, false,
  'Root Totem ropes must stay out of the shell-outline pass');
assert.strictEqual(cfg.basin.material.model, 'unlit');
assert.strictEqual(cfg.bottle.light.weatherOverlayMask, true);
assert.strictEqual(cfg.basin.light.weatherOverlayMask, true);

const wrap = parses('docs/js/structural-wrap.js');
// Source X/Y/Z maps to normal/tangent/binormal. The destination basis must be
// right-handed or wrapped meshes get mirrored, reversing triangle winding and
// exposing the black BackSide outline shell as their apparent exterior.
assert(wrap.includes('normal × tangent = binormal'));
assert(wrap.includes('firstNormal.clone().cross(firstTangent)'));
assert(wrap.includes('normal.clone().cross(tangents[i])'));
assert(wrap.includes('crossVectors(normal, tangent)'));
assert(wrap.includes('crossVectors(tangent, binormal)'));
assert(!wrap.includes('crossVectors(tangent, normal)'), 'StructuralWrap must not rebuild the old left-handed X/Y/Z deformation basis');

const deadzone = parses('docs/js/deadzone-billboard.js');
assert(deadzone.includes('ropeShellOutline'));
assert(deadzone.includes('mesh.layers.enable(1)'));
assert(deadzone.includes('MeshLambertMaterial({map:texture,color:colorHex,side:THREE.FrontSide})'));
assert(!deadzone.includes('MeshLambertMaterial({map:texture,color:colorHex,side:THREE.DoubleSide})'));
assert(deadzone.includes('VegetationCropRendering?.getGrassBillboardMat?.()'));
assert(!deadzone.includes('performance.now()'));
assert(!deadzone.includes('springAxis'));

const style = parses('docs/js/root-totem-surface-style.js');
assert(style.includes('NaturalSurfaceMaterials'));
assert(style.includes("api.naturalizeMesh(mesh,surface,'cylindrical-stretch')"));
assert(style.includes('componentsForGeometry'));
assert(style.includes('inferredRingSize'));
assert(style.includes('vineCountScale'));
assert(style.includes('vineRadiusScale'));
assert(style.includes('mesh.layers?.enable?.(1)'));
assert(!style.includes('wibbly_surface.png'), 'Cloud Forest trunk texture path must remain owned by NaturalSurfaceMaterialConfig');
assert(!style.includes('carved_smooth.png'), 'Cloud Forest vine texture path must remain owned by NaturalSurfaceMaterialConfig');

const naturalCfg = read('docs/config/natural-surface-materials.js');
assert(naturalCfg.includes("texture: 'assets/textures/wibbly_surface.png'"));
assert(naturalCfg.includes("texture: 'assets/textures/carved_smooth.png'"));

const root = parses('docs/js/root-totem-plants.js');
assert(root.includes('RootTotemSurfaceStyle?.prepareTreeGeometry'));
assert(root.includes('RootTotemSurfaceStyle?.finalizeTreeSurface'));
assert(root.includes('ropeShellOutline:bottle.rope.shellOutline===true'));
assert(!root.includes('seedU32:7319'));

const life = parses('docs/js/life-totem-furniture.js');
assert(life.includes('new THREE.MeshBasicMaterial'));
assert(!life.includes('new THREE.MeshLambertMaterial'));
assert(life.includes("material.name='lifeTotemFontLiquidMaterial'"));
assert(life.includes('material.toneMapped=false'));
assert(life.includes('addConfiguredPointLight'));

const zone = parses('docs/js/zone-den-totem-features.js');
const naturalCfgAt = zone.indexOf("ensureCompanionScript('NaturalSurfaceMaterialConfig'");
const naturalRuntimeAt = zone.indexOf("ensureCompanionScript('NaturalSurfaceMaterials'");
const styleAt = zone.indexOf("ensureCompanionScript('RootTotemSurfaceStyle'");
const rootAt = zone.indexOf("ensureCompanionScript('RootTotemPlants'");
assert(naturalCfgAt >= 0 && naturalRuntimeAt > naturalCfgAt && styleAt > naturalRuntimeAt && rootAt > styleAt);
assert(zone.includes('window.NaturalSurfaceMaterials'));
assert(zone.includes('window.RootTotemSurfaceStyle'));

const authored = json('docs/config/furniture-authored/lifeTotem.json');
const liquid = authored.parts.find(p => p.id === 'life_totem_font_liquid');
assert(liquid && liquid.kind === 'liquidSurface');
assert.strictEqual(liquid.liquidContainerId, 'life_totem_font_basin');

const game = read('docs/game.js');
assert(game.includes('const root = window.TownMine?.farmRootTotem?.(COLS, ROWS);'));
assert(game.includes("buildRootTotemMeshes(scene, grid, [{ x: root.x, y: root.y }], 'farm-mine-respawn')"));

console.log('root-totem surface/liquid/outline regression checks: PASS');
