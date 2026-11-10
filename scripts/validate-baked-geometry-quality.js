#!/usr/bin/env node
'use strict';
// Validate every packaged geometry-quality variant without loading Three.js or
// doing geometry work in the player's browser. Also safe on an empty manifest
// before the feature-branch baker has populated it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../docs'); // Root against which all runtime GLB paths are resolved.
const MANIFEST = path.join(ROOT, 'config/geometry-quality-presets.json'); // Shipped precomputed quality profile map.
const SCHEMA = 'hobunji_geometry_quality.v1';
const validPath = /^assets\/models\/[A-Za-z0-9_./-]+\.glb$/i;
function resolveSafe(rel) {
  assert.ok(typeof rel === 'string' && validPath.test(rel) && !rel.includes('..') && !rel.includes('//'),
    'safe relative GLB path expected: ' + rel);
  const full = path.resolve(ROOT, rel);
  assert.ok(full.startsWith(ROOT + path.sep), 'GLB must be inside docs/');
  return full;
}
function inspect(file) {
  const data = fs.readFileSync(file);
  assert.ok(data.length >= 20 && data.toString('ascii',0,4) === 'glTF', 'not a binary GLB: ' + file);
  assert.equal(data.readUInt32LE(4), 2, 'GLB version must be 2');
  assert.equal(data.readUInt32LE(8), data.length, 'GLB length mismatch');
  const jsonLength = data.readUInt32LE(12);
  assert.ok(jsonLength > 0 && jsonLength <= data.length - 20, 'GLB JSON chunk invalid');
  const doc = JSON.parse(data.subarray(20,20+jsonLength).toString('utf8'));
  const triangleCount = (doc.meshes || []).reduce((sum,mesh) =>
    sum + (mesh.primitives || []).reduce((n,p)=>{
      if (p.mode != null && p.mode !== 4) return n;
      const a = doc.accessors[p.indices ?? p.attributes?.POSITION];
      return n + Math.floor((a?.count || 0) / 3);
    },0),0);
  return { triangleCount, meshes: doc.meshes?.length || 0, materials: doc.materials?.length || 0 };
}
const content = JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
assert.equal(content.schema, SCHEMA);
assert.ok(Array.isArray(content.profiles) && content.profiles.length <= 128);
const seen = new Set();
let actualSavings = 0;
for (const profile of content.profiles) {
  assert.ok(!seen.has(profile.source), 'duplicate source profile'); seen.add(profile.source);
  const source = inspect(resolveSafe(profile.source));
  for (const [tier, value] of Object.entries(profile.variants || {})) {
    assert.ok(['low','medium','high'].includes(tier),'unknown geometry quality tier');
    const file = typeof value === 'string' ? value : value.asset;
    const target = inspect(resolveSafe(file));
    assert.ok(target.meshes <= source.meshes && target.meshes > 0,'optimized asset lost the mesh structure');
    assert.ok(target.triangleCount > 0 && target.triangleCount < source.triangleCount,
      'variant must actually contain fewer triangles: ' + file);
    actualSavings += source.triangleCount - target.triangleCount;
    if (tier === 'low' && profile.metadata?.outputTriangles != null) {
      assert.equal(target.triangleCount,profile.metadata.outputTriangles,'GLB/output manifest mismatch: '+file);
    }
  }
}
console.log('Verified ' + content.profiles.length + ' packaged geometry-quality profiles; ' +
  actualSavings.toLocaleString() + ' source triangles avoided per complete set of variants.');
