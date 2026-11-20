#!/usr/bin/env node
'use strict';

// Executes js/statue-ruin-debris.js's footprint grouping, fit-to-footprint
// placement and its failure path (generator unavailable -> every statue tile
// gets the caller's fallback stone, never an invisible blocker), and checks
// that game.js routes statue tiles to it instead of the outlined rock mound.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeMesh { constructor(geometry, material) { this.isMesh = true; this.geometry = geometry; this.material = material; this.userData = {}; this.layers = { mask: 0b11, disable(bit) { this.mask &= ~(1 << bit); } }; } }
class FakeBasicMaterial { constructor(params) { Object.assign(this, params); this.userData = {}; } }

function load({ debugText = 'Debris-ifier bootstrap: FAILED — test', extra = {} } = {}) {
  const appended = [];
  const document = {
    body: { appendChild(el) { appended.push(el); } },
    createElement: () => ({
      style: {}, setAttribute() {}, remove() {},
      contentWindow: {}, contentDocument: { getElementById: id => (id === 'debug' ? { textContent: debugText } : null) },
    }),
  };
  const storage = new Map();
  const win = { HobunjiRenderLayers: { SHELL_OUTLINE: 1 }, THREE: { Mesh: FakeMesh, MeshBasicMaterial: FakeBasicMaterial }, ...extra };
  win.window = win;
  const context = vm.createContext({ window: win, globalThis: win, document, console, Promise, setTimeout, performance: { now: () => Date.now() }, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/statue-ruin-debris.js'), 'utf8'), context, { filename: 'statue-ruin-debris.js' });
  return { SRD: win.StatueRuinDebris, appended, storage };
}

(async () => {
  const { SRD, appended, storage } = load();
  // Footprints: adjacent statue tiles in one chunk are one statue (1x1 or 1x2).
  const tile = (c, r) => ({ c, r, x: c + 0.5, z: r + 0.5, y: 5 });
  const footprints = Array.from(SRD.footprintsOf([tile(10, 4), tile(10, 5), tile(20, 7), tile(31, 2), tile(32, 2)]), f => ({ c: f.c, r: f.r, w: f.w, h: f.h, x: f.x, z: f.z }));
  assert.deepEqual(footprints.map(f => `${f.c},${f.r} ${f.w}x${f.h}`).sort(), ['10,4 1x2', '20,7 1x1', '31,2 2x1']);
  assert.deepEqual(footprints.find(f => f.c === 10), { c: 10, r: 4, w: 1, h: 2, x: 10.5, z: 5 }, 'centred on the footprint');

  // Placement: never larger than the footprint plus spill, never enlarged; quarter turns only.
  const variant = { sizeX: 3, sizeZ: 1.5 };
  for (const fp of [{ w: 1, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 1 }]) {
    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      const { rotationY, scale } = SRD.placement(variant, fp, key);
      const turns = rotationY / (Math.PI / 2);
      assert.ok(Number.isInteger(Math.round(turns)) && Math.abs(turns - Math.round(turns)) < 1e-9, 'quarter turns');
      const swap = Math.round(turns) % 2 === 1;
      const sx = (swap ? variant.sizeZ : variant.sizeX) * scale, sz = (swap ? variant.sizeX : variant.sizeZ) * scale;
      assert.ok(sx <= fp.w * 1.35 + 1e-9 && sz <= fp.h * 1.35 + 1e-9, 'fits the footprint with limited spill');
      assert.ok(scale <= 1, 'never scaled up');
    }
  }
  assert.equal(SRD.placement({ sizeX: 0.5, sizeZ: 0.5 }, { w: 1, h: 1 }, 'x').scale, 1, 'small heaps keep their size');

  // Generator unavailable: every tile gets the fallback, nothing is left as an invisible blocker.
  const group = { parent: {}, children: [], add(o) { this.children.push(o); } };
  const fallbacks = [];
  const filled = await SRD.fill({ group, mapId: 'map_test', tiles: [tile(1, 1), tile(1, 2), tile(5, 5)], fallback: (g, t) => fallbacks.push(`${t.c},${t.r}`) });
  assert.equal(filled, 0);
  assert.deepEqual(fallbacks.sort(), ['1,1', '1,2', '5,5']);
  assert.equal(appended.length, 1, 'one hidden generator frame');
  const snap = SRD.snapshot();
  assert.equal(snap.fallbacks, 3);
  assert.match(snap.lastError, /FAILED/);

  // Disabled: nothing happens (old mounds come back via game.js).
  SRD.setEnabled(false);
  assert.equal(storage.get(SRD.STORAGE_KEY), 'off');
  assert.equal(await SRD.fill({ group, mapId: 'map_test', tiles: [tile(9, 9)], fallback: () => fallbacks.push('x') }), 0);
  assert.equal(fallbacks.length, 3);

  // "Super ruined" damage settings are the tool's strongest.
  assert.equal(SRD.SUPER_RUINED.crumble, 100);
  assert.equal(SRD.SUPER_RUINED.jagged, 40);
  assert.equal(SRD.SUPER_RUINED.upperMode, 'fall');

  // Visual-authoring contract §2: debris is hard-edged, so each variant is surfaced like the
  // farm rocks once (inked PNG per detected face, no generated outline) and placements share it.
  {
    const surfaced = [];
    const rocks = { surfaceStone(mesh, options) {
      surfaced.push({ label: options.label, tint: options.tint });
      mesh.geometry = { label: 'unwrapped', userData: { hobunjiSurfaceStretch: { patchCount: 40 } } };
      mesh.material = { name: 'natural_rocks' };
      mesh.layers.disable(1);
      Object.assign(mesh.userData, { naturalSurface: 'rocks', naturalSurfaceUvOwner: 'HobunjiSurfaceStretchUV', facetedRock: true, facetedSurfaceTextureOutline: true, noOutline: true });
      return mesh;
    } };
    const { SRD: surfacedSRD } = load({ extra: { FacetedRocks: rocks } });
    const variant = surfacedSRD.surfaceVariant({ label: 'merged' }, 'statue_ruin_debris_seed');
    assert.deepEqual(surfaced, [{ label: 'statue_ruin_debris_seed', tint: '#7a746b' }]);
    assert.equal(variant.geometry.label, 'unwrapped', 'placements share the unwrapped geometry');
    assert.equal(variant.material.name, 'natural_rocks', 'and the natural rock material');
    assert.equal(variant.userData.naturalSurface, 'rocks');
    assert.equal(variant.userData.naturalSurfaceUvOwner, 'HobunjiSurfaceStretchUV', 'the natural pipeline owns its UVs');
    assert.equal(variant.userData.facetedSurfaceTextureOutline, true);
    assert.equal(surfacedSRD.snapshot().surfaced, 1);
    // Without the rock stack (isolated pages) it still builds, as plain stone.
    const plainVariant = SRD.surfaceVariant({ label: 'merged' }, 'x');
    assert.equal(plainVariant.geometry.label, 'merged');
    assert.equal(plainVariant.material.color, 0x7a746b);
    assert.equal(SRD.snapshot().unsurfaced, 1);
  }

  // game.js: statue tiles go to the debris filler instead of the rock bucket.
  const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');
  const branch = game.slice(game.indexOf("if (tile.rockKind === 'statue' && window.StatueRuinDebris?.enabled?.())"));
  assert.match(branch.slice(0, branch.indexOf('continue;')), /statueDebrisTiles\.push\(/);
  assert.match(game, /window\.StatueRuinDebris\.fill\(\{\s*group: zScene, mapId, tiles: statueDebrisTiles,/);
  assert.match(fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8'), /js\/statue-ruin-debris\.js\?v=/);

  console.log('statue ruin debris: footprints, fit placement, fallback when the generator is unavailable, game.js wiring');
})().catch(error => { console.error(error); process.exit(1); });
