#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repository root for config and sprite checks.
const configPath = path.join(root, 'docs/config/creatures/skeeri-flying-rig.json'); // Authored species preset.
const rig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
assert.equal(rig.version, 1);

for (const key of ['flying', 'perched', 'wings']) {
  assert.equal(rig[key], `creaturesprites/skeeri_${key}.png`);
  assert.ok(fs.existsSync(path.join(root, 'docs/assets', rig[key])), `Missing ${key} sprite`);
}
assert.equal(rig.wingHeight, 0.12);
assert.equal(rig.wingOffset, -0.1);
assert.equal(rig.talonCarry.birdScale, 1.5);
assert.equal(rig.talonCarry.rotationOrder, 'YXZ');
assert.deepEqual(rig.talonCarry.poses.humanoid.position, { x: 0.275, y: -0.175, z: 0 });
assert.deepEqual(rig.talonCarry.poses.animal.position, { x: -0.1, y: 0.05, z: 0 });
assert.deepEqual(rig.talonCarry.poses.burden.position, { x: 0.1, y: -0.3, z: 0 });
for (const line of ['beforePoints', 'afterPoints']) {
  assert.equal(rig.perchSpline[line].length, 7);
  for (const point of rig.perchSpline[line]) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 'Spline points must be finite');
  }
}

const spline = { // Minimal shoulder-spline dependency for validation without a DOM or WebGL.
  POINT_COUNT: 7,
  linearPointsForGuide({ a, b }) {
    return Array.from({ length: 7 }, (_, i) => ({
      x: a.x + (b.x - a.x) * i / 6,
      y: a.y + (b.y - a.y) * i / 6,
    }));
  },
};
const window = { AnimalShoulderSpline: spline }; // Shared module publishes its API here.
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/flying-animal-rig.js'), 'utf8'), { window });
const api = window.FlyingAnimalRig; // Same normalizer used by the Flying Animal Author.
assert.match(api.defaults.flying, /tzatzul_flying\\.png$/, 'Tzatzul must retain its preset');
assert.deepEqual(JSON.parse(JSON.stringify(api.normalize(rig))), rig, 'Skeeri preset must normalize without data loss');
assert.throws(() => api.normalize({ ...rig, wings: '../../bad.png' }), /relative to the assets folder/);

const html = fs.readFileSync(path.join(root, 'docs/tools/flying-animal-author/index.html'), 'utf8');
const author = fs.readFileSync(path.join(root, 'docs/tools/flying-animal-author/app.js'), 'utf8');
assert.match(html, /<select id="rigPreset">/);
assert.match(html, /<option value="skeeri">Skeeri<\\/option>/);
assert.match(author, /config\\/creatures\\/skeeri-flying-rig\\.json/);
assert.match(author, /presetSelect\\.addEventListener\\('change'/);
assert.match(author, /speciesDraftKey/);
console.log('Skeeri rig preset config, sprites, normalization, and editor integration checks passed.');
