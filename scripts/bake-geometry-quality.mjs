#!/usr/bin/env node
// Offline prebaking for the optional 60%-reduced gameplay geometry mode.
// Run ONLY on an author/build machine: npm install --no-save --package-lock=false
//   @gltf-transform/core@4.3.0 @gltf-transform/functions@4.3.0 meshoptimizer@0.22.0
//   node scripts/bake-geometry-quality.mjs [--dry-run]
// No browser-time GLB conversion. Never overwrites the original GLB.
// All uncertain rig, alpha, morph, collision, and high-volume assets remain original.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, dirname, basename, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(root, 'docs', 'assets', 'models');
const manifestPath = join(root, 'docs', 'config', 'geometry-quality-presets.json');
const SCHEMA = 'hobunji_geometry_quality.v1';
const TARGET_RATIO = 0.4; // Maximum reduction target: retain 40% vertices; simplifier may retain more to honor errors.
const ERROR = 0.02; // 2% maximum meshoptimizer relative geometric error, matching Geometry Workshop.
const MIN_TRIANGLES = 96; // Negligible savings from tiny authored GLBs.
const MAX_TRIANGLES = 80000; // Avoid multi-megabyte house/world assemblies during automated safe batch.
const MAX_SOURCE_BYTES = 2 * 1024 * 1024; // Huge authored world GLBs require a separate dedicated workflow.
const REBUILD_SUFFIX = '_optimized60'; // Stable variant name, consumed by profile mapping; original is never modified.
const dryRun = process.argv.includes('--dry-run'); // Diagnostics only; do not emit any assets or manifest if true.
const io = new NodeIO();
const failures = []; // Per-asset skip reasons printed in CI/build logs for mobile review.
const generated = []; // Verified output profiles whose GLB actually contains fewer triangles.

async function listFiles(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(name));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.glb') result.push(name);
  }
  return result.sort();
}
function primitiveTriangles(primitive) {
  if (primitive.getMode() !== 4) return 0;
  const indices = primitive.getIndices();
  return Math.floor((indices?.getCount() || primitive.getAttribute('POSITION')?.getCount() || 0) / 3);
}
function inspect(document) {
  const r = document.getRoot();
  const meshes = r.listMeshes();
  const primitives = meshes.flatMap(m => m.listPrimitives());
  const materialNames = primitives.map(p => p.getMaterial()?.getName() || '');
  const triangles = primitives.reduce((sum, p) => sum + primitiveTriangles(p), 0);
  const vertices = primitives.reduce((sum, p) => sum + (p.getAttribute('POSITION')?.getCount() || 0), 0);
  return { meshes: meshes.length, primitives: primitives.length, triangles, vertices, materialNames };
}
function unsafeReason(document, info) {
  const r = document.getRoot();
  if (r.listSkins().length || r.listAnimations().length) return 'animated/skinned GLB';
  if (!info.triangles || info.triangles < MIN_TRIANGLES) return 'too few triangles';
  if (info.triangles > MAX_TRIANGLES) return 'too many triangles for batch budget';
  if (r.listNodes().some(n => /collision|climbbranch|physics|trigger|grapple|hinge|joint/i.test(n.getName()))) return 'contains physical/animated scene nodes';
  for (const mesh of r.listMeshes()) for (const p of mesh.listPrimitives()) {
    if (p.getMode() !== 4 || (p.listTargets?.().length || 0)) return 'non-triangle or morph-target primitive';
    const m = p.getMaterial();
    if (m && m.getAlphaMode() !== 'OPAQUE') return 'transparent/alpha-tested material';
    // glTF allows missing NORMALs; r128's GLTFLoader derives them for
    // visualization. Keep this absence intact in the output instead of
    // rejecting most simple authored furniture. The error/structure checks
    // still protect these models during simplification.
    if (!p.getAttribute('POSITION')) return 'no position attribute';
    if ((p.getIndices()?.getCount() || 0) < 6) return 'unindexed or tiny material primitive';
  }
  return '';
}
function nameFor(path) {
  return join(dirname(path), basename(path, '.glb') + REBUILD_SUFFIX + '.glb');
}
function sourceKey(path) {
  return 'assets/models/' + relative(sourceRoot, path).split(sep).join('/');
}
function fail(path, reason) {
  failures.push({ source: sourceKey(path), reason }); // Build summary lists exactly why original models were retained.
}
await MeshoptSimplifier.ready;
let files = await listFiles(sourceRoot);
files = files.filter(f => !/(?:_lod[^/]*|_optimized60)\.glb$/i.test(f));
for (const source of files) {
  try {
    const bytes = await readFile(source);
    if (bytes.length > MAX_SOURCE_BYTES) { fail(source, 'source exceeds 2 MB conservative bake budget'); continue; }
    // Unknown glTF extensions must not be silently stripped by NodeIO.
    // Such assets need dedicated baking/validation, not the automatic batch.
    const jsonChunkBytes = bytes.readUInt32LE(12);
    const rawGLTF = JSON.parse(bytes.subarray(20, 20 + jsonChunkBytes).toString('utf8'));
    if (rawGLTF.extensionsUsed?.length || rawGLTF.extensionsRequired?.length) {
      fail(source, 'GLB contains extensions that need a specialized baker'); continue;
    }
    const document = await io.readBinary(new Uint8Array(bytes));
    const before = inspect(document);
    const originalNodeCount = document.getRoot().listNodes().length; // Protect authored transform hierarchy.
    const reason = unsafeReason(document, before);
    if (reason) { fail(source, reason); continue; }
    // No weld pass: keep all original material/UV splits and authored seams.
    // Meshoptimizer is allowed to stop EARLY if 2% error or locked seams prevent 60%.
    await document.transform(simplify({
      simplifier: MeshoptSimplifier,
      ratio: TARGET_RATIO, error: ERROR, lockBorder: true,
    }));
    const after = inspect(document);
    const sameMaterials = JSON.stringify(before.materialNames) === JSON.stringify(after.materialNames);
    if (!sameMaterials || originalNodeCount !== document.getRoot().listNodes().length ||
      before.meshes !== after.meshes || before.primitives !== after.primitives) {
      fail(source, 'material/scene structure was changed; discarded candidate'); continue;
    }
    if (!after.triangles || after.triangles >= before.triangles ||
      after.triangles > before.triangles * 0.95) {
      fail(source, 'insufficient safe triangle reduction (<5%)'); continue;
    }
    const output = nameFor(source);
    if (!dryRun) {
      const binary = await io.writeBinary(document);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, binary);
    }
    generated.push({
      source: sourceKey(source),
      variants: { low: sourceKey(output) },
      metadata: {
        method: 'offline_meshoptimizer_simplify',
        sourceTriangles: before.triangles,
        outputTriangles: after.triangles,
        sourceVertices: before.vertices,
        outputVertices: after.vertices,
        actualReductionPercent: Math.round(10000 * (1 - after.triangles / before.triangles)) / 100,
        maximumErrorPercent: ERROR * 100,
        preserveTransparentCards: true,
        runtimeSimplification: false,
      },
    });
  } catch (error) {
    fail(source, String(error?.message || error));
  }
}
let existing = { schema: SCHEMA, profiles: [] };
try { existing = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }
if (existing.schema !== SCHEMA || !Array.isArray(existing.profiles)) throw Error('Invalid shipped geometry quality manifest');
const profiles = new Map(existing.profiles.map(profile => [profile.source, profile]));
for (const profile of generated) {
  const previous = profiles.get(profile.source) || {};
  profiles.set(profile.source, {
    ...previous, ...profile,
    variants: { ...(previous.variants || {}), ...profile.variants },
    metadata: { ...(previous.metadata || {}), ...profile.metadata },
  });
}
if (!dryRun) {
  await writeFile(manifestPath, JSON.stringify({ schema: SCHEMA, profiles: [...profiles.values()].sort((a,b)=>a.source.localeCompare(b.source)) }, null, 2) + '\n');
}
console.log(JSON.stringify({
  dryRun, scanned: files.length, optimizedAssets: generated.length,
  beforeTriangles: generated.reduce((n,p)=>n+p.metadata.sourceTriangles,0),
  afterTriangles: generated.reduce((n,p)=>n+p.metadata.outputTriangles,0),
  skipped: failures.length, failures,
}, null, 2));
if (!generated.length) process.exitCode = 2; // A no-op bake is a build warning, not a false success.
