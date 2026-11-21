'use strict';
// Exercises the actual WebView file-handle adapter against a fake native Drive
// transport. Android Gradle CI separately compiles the real Google REST layer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'android/bridge.js'), 'utf8');
const tree = 'drive:savefolder12345'; // User-approved Google Picker root; never an arbitrary Drive file.
const disk = new Map(); // Remote canonical file bytes, keyed relative to the picked root.
const dirs = new Set(['']); // Remote directories created by the game.
const sessions = new Map(); // Native-only reader/writer state for 48 KiB chunks.
const calls = []; // Native operation audit; asserts per-session root isolation.
let permitted = true; // Simulated revoked Google OAuth access.
let nextId = 0; // Native session IDs, opaque to the WebView.
let failCommit = false; // Network upload failure that must preserve the prior version.
function fail(message) { throw new Error(message); }
function location(args) {
  if (!permitted || args.tree !== tree) fail('Google Drive root or authorization revoked');
  const path = args.path || [];
  if (path.some(p => !p || p === '..' || p.includes('/') || p.includes('\\'))) fail('invalid path');
  return path.join('/');
}
function native(op, args) {
  calls.push({ op, tree: args.tree });
  if (op === 'choose') return { tree, name:'Google Drive saves' };
  if (op === 'permission') return { granted: permitted && args.tree === tree };
  if (op === 'driveAuthorize') {
    if (args.tree !== tree) fail('invalid reconnect root');
    permitted = true;
    return { granted:true };
  }
  if (['directory','file','list','stat','openRead','openWrite','remove'].includes(op)) {
    var key = location(args);
  } else if (['readChunk','closeRead','writeChunk','commitWrite','abortWrite'].includes(op)) {
    assert.equal(args.tree, tree, 'Session operations must preserve their selected root');
  }
  if (op === 'directory') {
    if (!dirs.has(key)) { if (!args.create) fail('not found'); dirs.add(key); }
    return {};
  }
  if (op === 'file') {
    if (!disk.has(key)) { if (!args.create) fail('not found'); disk.set(key, new Uint8Array()); }
    return {};
  }
  if (op === 'list') {
    const prefix = key ? key + '/' : '';
    return { items:[
      ...[...dirs].filter(p => p !== key && p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(p => ({name:p.slice(prefix.length),kind:'directory'})),
      ...[...disk.keys()].filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(p => ({name:p.slice(prefix.length),kind:'file'})),
    ] };
  }
  if (op === 'stat') {
    if (!disk.has(key)) fail('not found');
    return { size:disk.get(key).byteLength,modified:87654 };
  }
  if (op === 'openRead') {
    if (!disk.has(key)) fail('not found');
    const id = 'read' + ++nextId;
    sessions.set(id, {mode:'read',bytes:disk.get(key),pos:0});
    return {id};
  }
  if (op === 'readChunk') {
    const session = sessions.get(args.id);
    assert.equal(session.mode, 'read');
    const chunk = session.bytes.subarray(session.pos,session.pos+48*1024);
    session.pos += chunk.length;
    return {base64:Buffer.from(chunk).toString('base64'),eof:chunk.length===0};
  }
  if (op === 'closeRead') { sessions.delete(args.id); return {}; }
  if (op === 'openWrite') {
    const id = 'write' + ++nextId;
    sessions.set(id, {mode:'write',key,chunks:[]});
    return {id};
  }
  if (op === 'writeChunk') {
    const session = sessions.get(args.id);
    assert.equal(session.mode, 'write');
    session.chunks.push(Buffer.from(args.base64,'base64'));
    return {};
  }
  if (op === 'abortWrite') { sessions.delete(args.id); return {}; }
  if (op === 'commitWrite') {
    const session = sessions.get(args.id);
    sessions.delete(args.id);
    if (failCommit) { failCommit = false; fail('Drive was modified while saving'); }
    disk.set(session.key, new Uint8Array(Buffer.concat(session.chunks)));
    return {saved:true};
  }
  if (op === 'remove') { disk.delete(key); return {}; }
  fail('Unknown native Drive operation: ' + op);
}
const receivers = [];
const host = {
  postMessage(data) {
    const packet = JSON.parse(data);
    Promise.resolve().then(() => native(packet.op, packet.args || {})).then(
      result => receivers.forEach(listener => listener({data:JSON.stringify({id:packet.id,ok:true,result})})),
      error => receivers.forEach(listener => listener({data:JSON.stringify({
        id:packet.id,ok:false,error:{name:error.name,message:error.message},
      })})),
    );
  },
  addEventListener(name, listener) { assert.equal(name,'message'); receivers.push(listener); },
};
const window = {HobunjiAndroidHost:host};
vm.runInNewContext(code, {window,Promise,Map,Uint8Array,ArrayBuffer,Blob,TextDecoder,TextEncoder,
  atob,btoa,Error,TypeError});
async function run() {
  const folder = await window.showDirectoryPicker({mode:'readwrite'});
  assert.equal(folder.tree,tree);
  assert.equal(await folder.queryPermission(),'granted');
  const token = structuredClone(window.HobunjiAndroidFiles.serializeHandle(folder));
  const restored = window.HobunjiAndroidFiles.restoreHandle(token);
  assert.equal(restored.tree,tree);

  const characters = await restored.getDirectoryHandle('characters',{create:true});
  const save = await characters.getFileHandle('myao.json',{create:true});
  const large = 'This is a real cloud save 🌱'.repeat(6000);
  let writer = await save.createWritable();
  await writer.write(large);
  await writer.close();
  assert.equal(await (await save.getFile()).text(),large);
  assert.ok(calls.filter(c => c.op === 'writeChunk').length > 3,
    'Large cloud saves must use bounded native transport chunks');

  failCommit = true;
  writer = await save.createWritable();
  await writer.write('BAD REPLACEMENT');
  await assert.rejects(() => writer.close(),/Drive was modified/);
  assert.equal(await (await save.getFile()).text(),large,
    'Remote write failure must retain the existing canonical save');

  const found = [];
  for await (const [name,entry] of restored.entries()) found.push([name,entry.kind]);
  assert.deepEqual(found,[['characters','directory']]);

  permitted = false;
  assert.equal(await restored.queryPermission(),'prompt');
  assert.equal(await restored.requestPermission(),'granted');
  assert.equal(await restored.queryPermission(),'granted');
  assert.ok(calls.some(c => c.op === 'driveAuthorize'), 'Reconnection uses native Google Identity, not a WebView OAuth form');

  const backend = fs.readFileSync(path.join(root,
    'android/app/src/main/java/com/oolnokk/hobunjihollow/AndroidDriveBackend.java'),'utf8');
  const activity = fs.readFileSync(path.join(root,
    'android/app/src/main/java/com/oolnokk/hobunjihollow/MainActivity.java'),'utf8');
  assert.match(backend,/verifyUnchanged\(write\)/);
  assert.match(backend,/X-HTTP-Method-Override/, 'Android PATCH operations must use a Google-supported method override');
  assert.match(backend,/setRequestMethod\("POST"\)/, 'Never rely on unsupported HttpURLConnection PATCH');
  assert.match(backend,/getString\("tree"\)|optString\("tree"\)/);
  assert.match(backend,/\.hobunji-previous-/);
  assert.match(activity,/PICKER_OAUTH_TRIGGER/);
  assert.match(activity,/setOptOutIncludingGrantedScopes\(true\)/);
  assert.match(activity,/getGrantedScopes\(\)/, 'Partial Google OAuth grants must not permit remote save writes');
  assert.match(activity,/https:\/\/www\.googleapis\.com\/auth\/drive/);
  assert.ok(!activity.includes('new WebView(this).loadUrl("https://accounts.google.com'),
    'Never embed Google OAuth inside a game WebView');
  console.log('Android direct Drive handle, serialization, streaming, retries, and OAuth routing: PASS');
}
run().catch(error => {console.error(error);process.exitCode=1;});
