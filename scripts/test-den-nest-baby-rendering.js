#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Checks completed hatchling rendering with the game's private species database.
const fs = require('node:fs'); // Reads the real nest renderer and uploaded sprite dimensions.
const vm = require('node:vm'); // Exercises asynchronous baby builds without a graphics driver.
const source = fs.readFileSync('docs/js/den-nest-system.js', 'utf8'); // Runs the production rendering and alpha-target tagging code.

function vector(x = 0, y = 0, z = 0) {
  return { x, y, z, set(x, y, z) { Object.assign(this, { x, y, z }); } };
}
function group(name) {
  return {
    name, children: [], userData: {}, position: vector(), rotation: vector(), scale: vector(1, 1, 1),
    add(child) { this.children.push(child); child.parent = this; },
    remove(child) { this.children = this.children.filter(entry => entry !== child); child.parent = null; },
    traverse(visit) { visit(this); for (const child of this.children) child.traverse ? child.traverse(visit) : visit(child); },
  };
}

async function checkSpecies(kind) {
  const png = fs.readFileSync(`docs/assets/creaturesprites/${kind}_idle.png`); // PNG headers provide the independent expected native aspect ratio.
  const aspect = png.readUInt32BE(20) / png.readUInt32BE(16); // Native height divided by width, independent of the legacy fallback.
  const scene = group('test_scene'); // Captures completed world roots and their alpha-target planes.
  const genotype = { sizeClass: 'large', base: { color: '#abcdef', copies: 2 } }; // Exact family genes must reach the compositor without a reroll.
  const nest = { col: 4, row: 7, w: 2, h: 2, floorY: -0.4, itemKey: `${kind}Baby`, liveBirth: true, remaining: 1, genotype }; // Explicit cave floor intentionally differs from the active surface query.
  const builds = []; // Captures actual model dimensions passed to the shared PNG avatar builder.
  const canvas = { width: 1, height: 1 }; // Composed canvas is sufficient for world-plane tagging in this fixture.
  const context = vm.createContext({
    document: { getElementById() {} }, performance,
    THREE: { CanvasTexture: class { constructor(image) { this.image = image; this.repeat = { set() {} }; this.offset = { set() {} }; } dispose() {} } },
    window: {
      SCRATCHBONES_CONFIG: { game: { livestock: { itemKinds: { [`${kind}Baby`]: kind }, animalWidths: { [kind]: 1.2 } } } },
      CreatureGenetics: { creatureSizeScale: () => ({ x: 1.5, y: 1.5 }), applyCreatureBillboardScale(root, scale) { root.scale.set(scale.x, scale.y, scale.x); } },
      CreatureGeneticsRender: {
        SPECIES: { [kind]: { base: { idle: `assets/creaturesprites/${kind}_idle.png` } } },
        async composeFrame(species, frame, genes) { assert.equal(species, kind); assert.equal(frame, 'idle'); assert.equal(genes, genotype); return canvas; },
      },
      PNGPlaneAvatar: { buildAnimalPlaneAvatarModel(three, url, options) {
        builds.push(options);
        const root = group(options.name); // Renderer receives the same front/back naming contract as the real avatar builder.
        for (const side of ['front', 'back']) root.add({ name: `${options.name}_${side}_plane`, userData: {}, material: {} });
        return { group: root, dispose() {} };
      } },
    },
  }); // Deliberately provides no window.CREATURE_DB, matching the real game's private registry.
  vm.runInContext(source, context);
  context.window.DenNestSystem.init({
    CREATURE_DB: { [kind]: { spriteAspect: aspect } }, _denNests: new Map([['den', nest]]),
    getCurrentArea: () => 'den', getActiveScene: () => scene, activeSurfaceYAtWorld: () => 0, TILE: 32,
  });
  context.window.DenNestSystem.debugSnapshot();
  for (let turn = 0; turn < 4; turn++) await Promise.resolve(); // Completes the real async genotype composition and plane tagging.
  const debug = context.window.DenNestSystem.debugSnapshot(); // Confirms the baby reached a collectible rendered state.
  assert.equal(builds.length, 1);
  assert(Math.abs(builds[0].modelHeight / builds[0].modelWidth - aspect) < 1e-12, `${kind}: nest hatchling uses the native PNG proportions from the injected registry`);
  assert.equal(debug.renderedContents, 1);
  assert.equal(debug.babyRecords[0].stage, 'ready');
  assert.equal(debug.babyRecords[0].alphaReady, true);
  assert.equal(debug.babyRecords[0].hitPlanes, 2);
  assert.equal(debug.babyBuildFailures, 0);
  assert(Math.abs(scene.children[0].position.y - debug.babyRecords[0].groundLift - nest.floorY) < 1e-12, 'hatchling and nest furniture share the captured cave floor');
  assert.equal(scene.children[0].scale.y, 0.75, 'normal inherited scale and sleeping flattening are both applied');
  assert(scene.children[0].children.every(plane => plane.userData.nestContentAlphaCanvas === canvas), 'both targetable sprite planes use the inherited-genotype canvas');
}

async function main() {
  for (const kind of ['nelk', 'nazgraku']) await checkSpecies(kind);
  console.log('Nelk and Nazgraku hatchlings complete genotype rendering and alpha targeting with native PNG aspect ratios.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
