'use strict';
// JSON geometry quality profiles are runtime asset maps, never runtime mesh reconstruction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const memory = new Map();
global.localStorage = {
  getItem(key) { return memory.get(key) ?? null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
};
global.fetch = async url => {
  assert.equal(url, 'config/geometry-quality-presets.json');
  return { ok: true, async json() { return { schema: 'hobunji_geometry_quality.v1', profiles: [] }; } };
};
const quality = require('../docs/js/geometry-quality.js');
const source = 'assets/models/hands/hand_feline.glb';
const medium = 'assets/models/hands/hand_feline_lod-55.glb';
const low = 'assets/models/hands/hand_feline_lod-80.glb';
(async () => {
  await quality.ready;
  assert.equal(quality.getTier(), 'high');
  assert.equal(quality.resolvePath(source), source);
  assert.deepEqual(quality.TIERS, ['high', 'medium', 'low']);
  assert.equal(quality.modelPath('assets/models/hands/../escape.glb'), null, 'path traversal rejected');
  assert.equal(quality.modelPath('https://evil.example/a.glb'), null, 'arbitrary URLs rejected');

  assert.equal(quality.importProfiles({ schema: quality.SCHEMA, profiles: [
    { source, variants: { medium }, metadata: { sourceTriangles: 3120 } },
  ] }), 1);
  quality.setTier('medium');
  assert.equal(quality.resolvePath(source), medium);
  assert.equal(memory.get('hobunjiGeometryDetailTier.v1'), 'medium');
  assert.equal(quality.importProfiles({ schema: quality.SCHEMA, profiles: [
    { source, variants: { low }, metadata: { outputTriangles: 1200 } },
  ] }), 1);
  assert.equal(quality.resolvePath(source), medium, 'adding Low must not erase Medium');
  quality.setTier('low');
  assert.equal(quality.resolvePath(source), low);
  const stored = JSON.parse(memory.get('hobunjiGeometryQualityProfiles.v1'));
  assert.equal(stored.profiles.length, 1);
  assert.equal(stored.profiles[0].variants.medium, medium);
  assert.equal(stored.profiles[0].variants.low, low);

  const requests = [];
  const result = await quality.loadWithFallback(source, async model => {
    requests.push(model);
    if (model === low) throw new Error('404 optional LOD GLB');
    return { model };
  });
  assert.equal(result.model, source, 'a missing variant falls back to the canonical GLB');
  assert.deepEqual(requests, [low, source]);
  assert.equal(quality.snapshot().fallbackCount, 1);
  const before = memory.get('hobunjiGeometryQualityProfiles.v1');
  assert.throws(() => quality.importProfiles({schema:quality.SCHEMA,profiles:[{source,variants:{medium:'../../traversal.glb'}}]}));
  assert.equal(memory.get('hobunjiGeometryQualityProfiles.v1'), before, 'invalid import is atomic');
  assert.throws(() => quality.importProfiles({schema:quality.SCHEMA,profiles:[{source,variants:{}},{source,variants:{low}}]}));
  assert.equal(memory.get('hobunjiGeometryQualityProfiles.v1'), before, 'duplicate batch rejected');
  quality.clearImported();
  assert.equal(quality.resolvePath(source), source);
  assert.equal(quality.snapshot().imported, 0);

  const docs = path.resolve(__dirname,'../docs');
  const page = fs.readFileSync(path.join(docs, 'index.html'),'utf8');
  const workshopHtml = fs.readFileSync(path.join(docs,'tools/geometry-workshop/index.html'),'utf8');
  const workshopJs = fs.readFileSync(path.join(docs,'tools/geometry-workshop/workshop.js'),'utf8');
  for (const name of ['settingGeometryDetail','settingGeometryQualityImport','settingGeometryQualityClear','geometryQualityStatus']) assert.match(page, new RegExp(name));
  assert.match(page, /js\/geometry-quality\.js\?v=/);
  for (const name of ['quality-tier','game-source-path','export-json','json-download']) assert.match(workshopHtml, new RegExp('id="'+name+'"'));
  assert.match(workshopJs, /quality\.validate\(report\)/);
  assert.match(workshopJs, /function optimizedFilename\(/);
  for (const file of ['geometry-quality.js','procedural-hand-attachments.js','procedural-leg-animation.js','tree-asset-library.js']) {
    execFileSync(process.execPath, ['--check',path.join(docs,'js',file)], { stdio:'pipe' });
  }
  for (const file of ['procedural-hand-attachments.js','procedural-leg-animation.js']) {
    const code = fs.readFileSync(path.join(docs,'js',file),'utf8');
    assert.match(code,/quality\.loadWithFallback\(path, load\)/, file + ' must load from quality profiles');
  }
  assert.match(fs.readFileSync(path.join(docs,'js/tree-asset-library.js'),'utf8'), /quality\?\.resolvePath\?\.\(sourcePath\)/);
  console.log('Geometry quality: profile import/merge, validation, tier persistence, fallback, authored loaders and JSON export checks OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
