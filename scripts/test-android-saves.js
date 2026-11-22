'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'android/bridge.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'docs/js/local-save-folder-core.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs/js/local-save-folder.js'), 'utf8');
assert.ok(core.includes('HobunjiAndroidFiles?.serializeHandle?.(value)'));
assert.ok(core.includes('HobunjiAndroidFiles?.restoreHandle?.(req.result)'));
assert.match(loader, /local-save-folder-core\.js\?v=[A-Za-z0-9_-]+/);

const disk = new Map(); // Canonical files belonging to the selected Android save tree.
const dirs = new Set(['']); // Directory names relative to the selected tree.
const readers = new Map(); // Streams opened by the production bridge.
const writers = new Map(); // Staged writes, committed only after a successful close.
const calls = []; // Captured native operations, including chunk counts.
let serial = 0; // Native operation ids.
let permitted = true; // Revoke this to test Android permission loss.
let failCommit = false; // Simulates a failed SAF rename.

function notFound(msg) { const e = new Error(msg); e.name = 'NotFoundError'; throw e; }
function locate(a) {
  if (!permitted || a.tree !== 'content://example/tree/hobunji') throw new Error('permission denied');
  const parts = a.path || [];
  if (parts.some(p => !p || p === '..' || p.includes('/') || p.includes('\\'))) throw new Error('unsafe path');
  return parts.join('/');
}
function native(op, a) {
  calls.push(op);
  if (op === 'choose') return { tree: 'content://example/tree/hobunji', name: 'Hobunji Saves' };
  if (op === 'permission') return { granted: permitted };
  if (['directory', 'file', 'stat', 'list', 'remove', 'openRead', 'openWrite'].includes(op)) {
    var key = locate(a);
  }
  if (op === 'directory') {
    if (!dirs.has(key)) { if (!a.create) notFound('Folder missing'); dirs.add(key); }
    return { ok: true };
  }
  if (op === 'file') {
    if (!disk.has(key)) {
      if (!a.create) notFound('File missing');
      disk.set(key, new Uint8Array());
    }
    return { ok: true };
  }
  if (op === 'stat') {
    if (!disk.has(key)) notFound('File missing');
    return { size: disk.get(key).length, modified: 12345 };
  }
  if (op === 'list') {
    if (!dirs.has(key)) notFound('Folder missing');
    const prefix = key ? key + '/' : '';
    return { items: [
      ...[...dirs].filter(p => p !== key && p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map(p => ({ name:p.slice(prefix.length), kind:'directory' })),
      ...[...disk.keys()].filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map(p => ({ name:p.slice(prefix.length), kind:'file' })),
    ] };
  }
  if (op === 'remove') { if (!disk.delete(key)) notFound('File missing'); return { deleted: true }; }
  if (op === 'openRead') { const id = 'r' + ++serial; readers.set(id, { data:disk.get(key), offset:0 }); return { id }; }
  if (op === 'readChunk') {
    const r = readers.get(a.id);
    const bytes = r.data.subarray(r.offset, r.offset + 48 * 1024);
    r.offset += bytes.length;
    return { base64:Buffer.from(bytes).toString('base64'), eof:bytes.length === 0 };
  }
  if (op === 'closeRead') { readers.delete(a.id); return { closed:true }; }
  if (op === 'openWrite') { const id = 'w' + ++serial; writers.set(id, { key, chunks:[] }); return { id }; }
  if (op === 'writeChunk') { writers.get(a.id).chunks.push(Buffer.from(a.base64, 'base64')); return { written:true }; }
  if (op === 'abortWrite') { writers.delete(a.id); return { aborted:true }; }
  if (op === 'commitWrite') {
    const w = writers.get(a.id);
    writers.delete(a.id);
    if (failCommit) { failCommit = false; throw new Error('Cannot rename staged save'); }
    disk.set(w.key, new Uint8Array(Buffer.concat(w.chunks)));
    return { saved:true };
  }
  throw new Error('Unknown native call ' + op);
}
const receivers = [];
const host = {
  postMessage(json) {
    const message = JSON.parse(json);
    Promise.resolve().then(() => native(message.op, message.args || {})).then(
      result => receivers.forEach(cb => cb({ data:JSON.stringify({ id:message.id, ok:true, result }) })),
      error => receivers.forEach(cb => cb({ data:JSON.stringify({
        id:message.id, ok:false, error:{ name:error.name, message:error.message },
      }) })),
    );
  },
  addEventListener(name, cb) { assert.equal(name, 'message'); receivers.push(cb); },
};
const window = { HobunjiAndroidHost: host };
vm.runInNewContext(bridge, {
  window, Promise, Map, Uint8Array, ArrayBuffer, Blob, TextDecoder, TextEncoder,
  atob, btoa, Error, TypeError,
});

async function run() {
  const rootFolder = await window.showDirectoryPicker({ mode:'readwrite' });
  assert.equal(await rootFolder.queryPermission(), 'granted');
  const token = structuredClone(window.HobunjiAndroidFiles.serializeHandle(rootFolder));
  const restored = window.HobunjiAndroidFiles.restoreHandle(token);
  assert.equal(await restored.queryPermission(), 'granted');

  const chars = await restored.getDirectoryHandle('characters', { create:true });
  const slot = await chars.getFileHandle('character.json', { create:true });
  const huge = '🌱 Hobunji save data '.repeat(30000);
  const writer = await slot.createWritable();
  await writer.write(huge);
  await writer.close();
  assert.equal((await slot.getFile()).size, new TextEncoder().encode(huge).length);
  assert.equal(await (await slot.getFile()).text(), huge);
  assert.ok(calls.filter(op => op === 'writeChunk').length > 4);

  const patterns = await restored.getDirectoryHandle('patterns', { create:true });
  const png = await patterns.getFileHandle('crest.png', { create:true });
  const binary = new Uint8Array([137,80,78,71,0,255,127]);
  const pw = await png.createWritable();
  await pw.write(binary);
  await pw.close();
  assert.deepEqual([...new Uint8Array(await (await png.getFile()).arrayBuffer())], [...binary]);

  const names = [];
  for await (const [name, value] of restored.entries()) names.push(name + ':' + value.kind);
  assert.deepEqual(names.sort(), ['characters:directory','patterns:directory']);
  failCommit = true;
  const blocked = await slot.createWritable();
  await blocked.write('replacement');
  await assert.rejects(() => blocked.close(), /Cannot rename/);
  assert.equal(await (await slot.getFile()).text(), huge, 'Failed SAF publish leaves old save intact');

  await patterns.removeEntry('crest.png');
  await assert.rejects(() => patterns.getFileHandle('crest.png'), /File missing/);
  permitted = false;
  assert.equal(await restored.queryPermission(), 'prompt');
  permitted = true;

  let autosaves = 0;
  window.LocalSaveFolder = { getStatus:()=>({state:'ready',autoSyncArmed:true,folderName:'Hobunji Saves'}),
    syncNow:async()=>{ autosaves++; return {state:'ready',lastAction:'saved-browser-to-folder'}; } };
  assert.equal((await window.HobunjiAndroidFiles.saveBeforeExit()).mode, 'folder');
  await window.HobunjiAndroidFiles.syncOnPause();
  assert.equal(autosaves, 2);
  // Drive and SAF must fail closed if a live world isn't serializable.
  window.__hobunjiGameStarted = true;
  window.HobunjiRuntimeSave = { isReady:() => false, captureSnapshot:() => null,
    flushNow:() => ({ok:true,captured:false}) };
  const stale = await window.HobunjiAndroidFiles.saveBeforeExit();
  assert.equal(stale.ok, false);
  assert.match(stale.error, /capture is not ready/);
  assert.equal(autosaves, 2, 'No stale browser data is sent to the folder backend');
  window.__hobunjiGameStarted = false;
  window.LocalSaveFolder.getStatus = () => ({state:'needs-permission',autoSyncArmed:false,folderName:'Hobunji Saves'});
  window.__hobunjiGameStarted = true;
  window.HobunjiRuntimeSave = {flushNow:()=>({ok:true,captured:true})};
  assert.equal((await window.HobunjiAndroidFiles.saveBeforeExit()).ok, false);
  let browserFlushes = 0; // Confirms backgrounding also saves unsynchronized browser-only gameplay.
  window.HobunjiRuntimeSave.flushNow = async () => { browserFlushes++; return { ok:true, captured:true }; };
  const background = await window.HobunjiAndroidFiles.syncOnPause();
  assert.equal(background.mode, 'browser');
  assert.equal(background.ok, true);
  assert.equal(browserFlushes, 1, 'Android backgrounding flushes the browser fallback when the folder is disconnected');
  const closeWithoutFolder = await window.HobunjiAndroidFiles.saveBeforeExit();
  assert.equal(closeWithoutFolder.ok, false, 'A disconnected configured folder is not silently treated as saved');
  assert.equal(browserFlushes, 2, 'Browser fallback completes before the disconnected-folder warning');

  window.HobunjiAutosavePause = { isPaused: () => true }; // Preserves the Dev Companion's deliberate save freeze.
  const pausedExit = await window.HobunjiAndroidFiles.saveBeforeExit();
  assert.equal(pausedExit.ok, false, 'A paused save may not silently close the Android game');
  assert.equal(pausedExit.mode, 'paused');
  assert.match(pausedExit.error, /paused/);
  const pausedBackground = await window.HobunjiAndroidFiles.syncOnPause();
  assert.equal(pausedBackground.skipped, true);
  assert.equal(browserFlushes, 2, 'Paused saving never writes on background transition');
  delete window.HobunjiAutosavePause;

  let diagnosticCalls = 0; // Ensures the native diagnostic button invokes the real animal renderer on demand.
  window.CreatureGeneticsRender = {
    SPECIES: { nelk: {} },
    memorySnapshot: () => ({ composeFailures: 0, lastComposeFailure: null }),
    async composeFrame(kind, frame, genes, eye) {
      diagnosticCalls++;
      assert.equal(kind, 'nelk');
      assert.equal(frame, 'idle');
      assert.equal(eye, 'B');
      assert.equal(genes.cape.enabled, true);
      return { width: 1375, height: 600 };
    },
  };
  const artOk = await window.HobunjiAndroidFiles.diagnoseNelkArt();
  assert.equal(artOk.ok, true);
  assert.equal(artOk.pixels, '1375x600');
  assert.equal(diagnosticCalls, 1);
  window.CreatureGeneticsRender.composeFrame = async () => {
    throw new Error('Incomplete nelk/idle genotype artwork (eyes)');
  };
  const artError = await window.HobunjiAndroidFiles.diagnoseNelkArt();
  assert.equal(artError.ok, false);
  assert.match(artError.error, /eyes/);
  assert.equal(artError.totalFailures, 0, 'A manual diagnostic never invents renderer failure counters');

  console.log('Android save bridge: large text, PNG, token restore, list, revoke, safe write failure and quit autosave OK');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
