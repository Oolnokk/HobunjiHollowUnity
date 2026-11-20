#!/usr/bin/env node
'use strict';

// Executes js/faceted-rocks.js: ore rocks are built like the farm rocks —
// TerrainGeometry.buildRockTileGeo's mound, the stone unwrapped into surface
// islands by HobunjiSurfaceStretchUV (one inked PNG per island), taken off the
// shell outline and owning its UVs; the grass rim keeps the grass material
// and terrain edge-ID. Also checks game.js wiring and that farm rocks are
// unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Object3D { constructor() { this.children = []; this.userData = {}; this.name = ''; this.layers = { mask: 0b11, disable(bit) { this.mask &= ~(1 << bit); } }; } add(c) { this.children.push(c); c.parent = this; } }
class Group extends Object3D { constructor() { super(); this.isGroup = true; } }
class Mesh extends Object3D { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } }
const geo = label => ({ label, normals: 0, computeVertexNormals() { this.normals++; } });

function load({ withMapper = true, withNatural = false } = {}) {
  const calls = { displace: [], mapped: [], edges: [], naturalized: [] };
  const win = {
    THREE: { Group, Mesh },
    HobunjiRenderLayers: { SHELL_OUTLINE: 1 },
    TerrainGeometry: { buildRockTileGeo: (col, row) => ({ stoneGeo: geo(`stone ${col},${row}`), grassGeo: geo(`grass ${col},${row}`), heightTiles: 0.55 }) },
  };
  if (withMapper) win.HobunjiSurfaceStretchUV = { mapMesh(mesh, options) { calls.mapped.push({ mesh, options }); return { patchCount: 6 }; } };
  // The farm's naturalize call, including what its loaded wrappers do (stretch unwrap + UV owner + no shell).
  if (withNatural) win.NaturalSurfaceMaterials = { naturalizeMesh(mesh, surface, mapping, overrides) {
    calls.naturalized.push({ mesh, surface, mapping, tint: overrides?.tint });
    mesh.material = { name: 'natural_rocks_' + overrides?.tint };
    mesh.geometry.userData = { hobunjiSurfaceStretch: { patchCount: 5 } };
    mesh.userData.naturalSurface = surface;
    mesh.userData.naturalSurfaceUvOwner = 'HobunjiSurfaceStretchUV';
    return mesh;
  } };
  win.window = win;
  const storage = new Map();
  const context = vm.createContext({ window: win, globalThis: win, console, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/faceted-rocks.js'), 'utf8'), context, { filename: 'faceted-rocks.js' });
  return { FR: win.FacetedRocks, calls, storage };
}

const oreMaterial = { name: 'ore' }, grassMaterial = { name: 'grass' };
{
  const { FR, calls, storage } = load();
  const rock = FR.buildOreRock({
    col: 4, row: 7, name: 'faceted_ore_rock_4_7', material: oreMaterial, grassMaterial,
    displace: g => calls.displace.push(g.label),
    markGrassEdge: mesh => calls.edges.push(mesh.name),
  });
  assert.equal(rock.heightTiles, 0.55, 'projectile cover height comes from the mound');
  assert.deepEqual(calls.displace, ['stone 4,7'], 'ground displacement runs once on the shared buffer');
  const [stone, grass] = rock.group.children;
  assert.equal(rock.mesh, stone);
  assert.equal(stone.material, oreMaterial);
  assert.equal(calls.mapped.length, 1, 'the stone is unwrapped by the cliff stretch, like the farm rocks');
  assert.equal(calls.mapped[0].mesh, stone);
  assert.equal(calls.mapped[0].options.label, 'faceted_ore_rock_4_7');
  assert.equal(stone.layers.mask, 0b01, 'off the generated shell outline');
  assert.equal(stone.userData.facetedRock, true, 'game.js keeps it out of the chunk jigsaw bake');
  assert.equal(stone.userData.naturalSurfaceUvOwner, 'FacetedRocks');
  assert.equal(stone.userData.wildernessChunkOwnsGeometry, true);
  assert.equal(stone.geometry.normals, 1);
  assert.equal(grass.material, grassMaterial, 'the grass rim stays grass');
  assert.deepEqual(calls.edges, ['faceted_ore_rock_4_7_grass'], 'and keeps its terrain edge-ID');
  assert.equal(grass.userData.facetedRock, undefined);
  assert.equal(FR.snapshot().stretched, 1);
  assert.equal(FR.snapshot().islands, 6);
  FR.setEnabled(false);
  assert.equal(storage.get(FR.STORAGE_KEY), 'off');
}
{
  const { FR } = load({ withMapper: false });
  const rock = FR.buildOreRock({ col: 1, row: 1, material: oreMaterial });
  assert.equal(rock.group.children.length, 1, 'stone only without a grass material');
  assert.equal(FR.snapshot().unstretched, 1, 'builds without the mapper (isolated pages)');
}

{
  // Ore rocks go through the farm rocks' own naturalize call, tinted with the ore colour.
  const { FR, calls } = load({ withNatural: true });
  const rock = FR.buildOreRock({ col: 2, row: 3, material: oreMaterial, tint: '#b87333', grassMaterial });
  assert.equal(calls.naturalized.length, 1);
  assert.equal(calls.naturalized[0].surface, 'rocks', 'same surface as the farm rocks');
  assert.equal(calls.naturalized[0].tint, '#b87333', 'in the ore colour');
  assert.equal(calls.mapped.length, 0, 'not unwrapped twice: the naturalize hook already did it');
  assert.equal(rock.mesh.material.name, 'natural_rocks_#b87333');
  assert.equal(rock.mesh.userData.naturalSurfaceUvOwner, 'HobunjiSurfaceStretchUV', 'the natural pipeline keeps owning its UVs');
  assert.equal(rock.mesh.layers.mask, 0b01, 'still off the shell layer');
  assert.equal(FR.snapshot().natural, 1);
}

{
  // surfaceStone: the shared farm-rock surfacing (statue debris uses it too).
  const { FR, calls } = load({ withNatural: true });
  const plain = new Mesh(geo('debris'), { name: 'stone' });
  assert.equal(FR.surfaceStone(plain, { label: 'debris' }), plain);
  assert.equal(calls.naturalized.at(-1).surface, 'rocks');
  assert.equal(calls.naturalized.at(-1).tint, undefined, 'no tint: the farm rocks\' own grey');
  assert.equal(plain.layers.mask, 0b01, 'off the shell layer');
  assert.equal(plain.userData.facetedRock, true);
  assert.equal(plain.userData.naturalSurfaceUvOwner, 'HobunjiSurfaceStretchUV');
  FR.surfaceStone(new Mesh(geo('tinted'), {}), { tint: '#7a746b' });
  assert.equal(calls.naturalized.at(-1).tint, '#7a746b');
  assert.equal(calls.mapped.length, 0, 'the naturalize hook unwrapped them; no second unwrap');
}

// game.js: wilderness ore rocks use it with the grass rim, no shell outline, out of the jigsaw bake.
const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');
const wild = game.slice(game.indexOf("if (tile.rockKind === 'diggableRockOre' && window.FacetedRocks?.enabled?.())"));
const wildBranch = wild.slice(0, wild.indexOf('continue;'));
assert.match(wildBranch, /window\.FacetedRocks\.buildOreRock\(/);
assert.match(wildBranch, /facetedMaterialFor\(/);
assert.match(wildBranch, /grassMaterial: resolveTileMat\(mapId, TileType\.GRASS\)/);
assert.match(wildBranch, /tint: window\.OreRockTextures\.rockTintFor\?\.\(/);
assert.doesNotMatch(wildBranch, /_markOutline\(/, 'no generated shell outline');
assert.match(game, /wildernessChunkOwnsGeometry && !mesh\.userData\.facetedRock\) bakeTargets\.push/, 'jigsaw bake leaves the stretched islands alone');
assert.match(game, /faceted_mine_rock_/);
// Farm rocks are the reference look and stay on their own pipeline.
assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../docs/js/vegetation-crop-rendering.js'), 'utf8'), /FacetedRocks/);

console.log('faceted rocks: ore rocks reuse the farm rock mound + cliff-stretch islands, no shell outline, grass rim kept');
