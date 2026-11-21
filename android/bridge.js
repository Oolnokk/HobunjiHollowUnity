// Android SAF bridge: emulates only the File System Access methods used by
// LocalSaveFolder. All files stay in the user's chosen Android document tree.
(() => {
  'use strict';
  const host = window.HobunjiAndroidHost; // Origin-bound message object installed by the Android WebView.
  if (!host || window.HobunjiAndroidFiles) return;

  const pending = new Map(); // Maps each SAF request id to its pending asynchronous JS result.
  let nextId = 0; // Request ids are local to the current WebView document.
  let lastError = ''; // Mobile diagnostics can read the last native bridge error.
  const CHUNK_SIZE = 48 * 1024; // Message payloads stay below common Android Binder limits.

  function errorFromNative(error) {
    const e = new Error(error?.message || String(error || 'Android storage operation failed'));
    e.name = error?.name || 'UnknownError';
    return e;
  }

  function request(op, args = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      try { host.postMessage(JSON.stringify({ id, op, args })); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  host.addEventListener('message', event => {
    try {
      const response = JSON.parse(event.data);
      const task = pending.get(response.id);
      if (!task) return;
      pending.delete(response.id);
      if (response.ok) task.resolve(response.result);
      else {
        lastError = response.error?.message || 'Android storage operation failed';
        task.reject(errorFromNative(response.error));
      }
    } catch (error) { lastError = String(error); }
  });

  function validateName(name) {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' ||
        name.length > 200 || /[/\\\x00-\x1f]/.test(name)) {
      throw new TypeError('Invalid Android save filename.');
    }
    return name;
  }
  function permissionState(accepted) {
    return accepted?.granted ? 'granted' : 'prompt'; // Let the game's normal reconnect gate offer folder re-selection.
  }

  function bytesFromBase64(raw) {
    const decoded = atob(raw);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    return bytes;
  }
  function base64FromBytes(bytes) {
    // Calls are split into <=48 KiB pieces; apply() never sees a huge save.
    return btoa(String.fromCharCode.apply(null, bytes));
  }
  async function withReader(tree, path, consume) {
    const opened = await request('openRead', { tree, path });
    try {
      return await consume(async () => {
        const next = await request('readChunk', { tree, id: opened.id });
        return { bytes: bytesFromBase64(next.base64 || ''), eof: !!next.eof };
      });
    } finally {
      await request('closeRead', { tree, id: opened.id }).catch(() => {});
    }
  }
  async function readAllBytes(tree, path) {
    return withReader(tree, path, async read => {
      const chunks = [];
      let total = 0;
      for (;;) {
        const { bytes, eof } = await read();
        if (bytes.length) { chunks.push(bytes); total += bytes.length; }
        if (eof) break;
      }
      const merged = new Uint8Array(total);
      let position = 0;
      for (const bytes of chunks) { merged.set(bytes, position); position += bytes.length; }
      return merged;
    });
  }
  async function readText(tree, path) {
    return withReader(tree, path, async read => {
      const decoder = new TextDecoder();
      const fragments = [];
      for (;;) {
        const { bytes, eof } = await read();
        if (bytes.length) fragments.push(decoder.decode(bytes, { stream: !eof }));
        if (eof) break;
      }
      fragments.push(decoder.decode());
      return fragments.join('');
    });
  }

  class AndroidFileHandle {
    constructor(tree, path) {
      this.kind = 'file';
      this.name = path[path.length - 1];
      this.tree = tree; // Scope for all I/O: the picker-approved DocumentTree URI.
      this.path = path; // File path is *relative* to that specific tree.
    }
    async getFile() {
      const stat = await request('stat', { tree: this.tree, path: this.path });
      const tree = this.tree, path = this.path, name = this.name;
      return {
        name, size: stat.size, lastModified: stat.modified,
        type: name.toLowerCase().endsWith('.png') ? 'image/png' : 'application/json',
        async text() { return readText(tree, path); },
        async arrayBuffer() { return (await readAllBytes(tree, path)).buffer; },
      };
    }
    async createWritable() {
      const opened = await request('openWrite', { tree: this.tree, path: this.path });
      let done = false; // A failed chunk aborts its staging file instead of committing a partial save.
      let failed = false; // Once a write fails, close() must never commit.
      const tree = this.tree; // Closures below run with the writer object as this, not the file handle.
      return {
        async write(input) {
          if (done || failed) throw new Error('This save file writer is closed.');
          let payload;
          if (typeof input === 'string') payload = new TextEncoder().encode(input);
          else if (input instanceof Uint8Array) payload = input;
          else if (ArrayBuffer.isView(input)) payload = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
          else if (input instanceof ArrayBuffer) payload = new Uint8Array(input);
          else if (input instanceof Blob) payload = new Uint8Array(await input.arrayBuffer());
          else throw new TypeError('Unsupported save data format.');
          try {
            for (let start = 0; start < payload.length; start += CHUNK_SIZE) {
              const part = payload.subarray(start, Math.min(start + CHUNK_SIZE, payload.length));
              await request('writeChunk', { tree, id: opened.id, base64: base64FromBytes(part) });
            }
          } catch (error) {
            failed = true;
            await request('abortWrite', { tree, id: opened.id }).catch(() => {});
            throw error;
          }
        },
        async close() {
          if (done || failed) throw new Error('Cannot commit a failed or closed save.');
          done = true;
          return request('commitWrite', { tree, id: opened.id });
        },
        async abort() {
          if (done) return;
          done = true;
          await request('abortWrite', { tree, id: opened.id });
        },
      };
    }
  }

  class AndroidDirectoryHandle {
    constructor(tree, path = [], name = 'Hobunji Saves') {
      this.kind = 'directory';
      this.name = name;
      this.tree = tree; // URI is provided by Android's system picker, never by untrusted URL text.
      this.path = path; // Relative segments let the native side enforce sandboxed traversal.
      this.__hobunjiNativeHandle = { tree, name }; // Stored as a structured-cloneable token by LocalSaveFolder.
    }
    async queryPermission() { return permissionState(await request('permission', { tree: this.tree })); }
    async requestPermission() {
      if (!this.tree.startsWith('drive:')) return this.queryPermission();
      return permissionState(await request('driveAuthorize', { tree: this.tree })); // Native Google authorization, never a WebView login.
    }
    async getDirectoryHandle(name, options = {}) {
      const path = [...this.path, validateName(name)];
      await request('directory', { tree: this.tree, path, create: options.create === true });
      return new AndroidDirectoryHandle(this.tree, path, name);
    }
    async getFileHandle(name, options = {}) {
      const path = [...this.path, validateName(name)];
      await request('file', { tree: this.tree, path, create: options.create === true });
      return new AndroidFileHandle(this.tree, path);
    }
    async removeEntry(name) {
      await request('remove', { tree: this.tree, path: [...this.path, validateName(name)] });
    }
    async *entries() {
      const response = await request('list', { tree: this.tree, path: this.path });
      const items = response.items; // Native responses carry a JSON array inside the result envelope.
      for (const item of items) {
        const name = validateName(item.name);
        const childPath = [...this.path, name];
        yield [name, item.kind === 'directory'
          ? new AndroidDirectoryHandle(this.tree, childPath, name)
          : new AndroidFileHandle(this.tree, childPath)];
      }
    }
    async *values() { for await (const [, entry] of this.entries()) yield entry; }
  }

  const api = Object.freeze({
    serializeHandle(value) {
      return value?.__hobunjiNativeHandle ? { __hobunjiNativeHandle: value.__hobunjiNativeHandle } : value;
    },
    restoreHandle(value) {
      const token = value?.__hobunjiNativeHandle;
      if (typeof token?.tree !== 'string' || typeof token?.name !== 'string') return value;
      return new AndroidDirectoryHandle(token.tree, [], token.name);
    },
    getDebug() { return { available: true, pendingRequests: pending.size, lastError }; },
    async diagnoseNelkArt() {
      const renderer = window.CreatureGeneticsRender; // Same canonical compositor wild Nelk use in gameplay.
      if (!renderer?.composeFrame || !renderer?.SPECIES?.nelk) {
        return { ok: false, error: 'CreatureGeneticsRender is unavailable or Nelk is not registered.',
          appOrigin: window.location?.origin || '' };
      }
      const before = renderer.memorySnapshot?.() || {}; // Prior failure counters distinguish an existing world failure from this manual probe.
      const genes = {
        base: { color: '#775533' },
        brushtail: { copies: 1, enabled: true, color: '#BB8855' },
        cape: { copies: 1, enabled: true, color: '#669944' },
        spectacles: { copies: 1, enabled: true, color: '#88AA66' },
      }; // Activates all three genuine Nelk pattern masks, including the cape/tail combination.
      try {
        const canvas = await renderer.composeFrame('nelk', 'idle', genes, 'B');
        if (!canvas?.width || !canvas?.height) throw new Error('Compositor returned no Nelk canvas.');
        const after = renderer.memorySnapshot?.() || {}; // Reveals any error that occurred during this exact test.
        return { ok: true, pixels: String(canvas.width) + 'x' + String(canvas.height),
          previousFailures: Number(before.composeFailures || 0), totalFailures: Number(after.composeFailures || 0),
          lastFailure: after.lastComposeFailure?.message || '', bridgeError: lastError };
      } catch (error) {
        const after = renderer.memorySnapshot?.() || {};
        return { ok: false, error: String(error?.message || error),
          previousFailures: Number(before.composeFailures || 0), totalFailures: Number(after.composeFailures || 0),
          lastFailure: after.lastComposeFailure?.message || '', bridgeError: lastError };
      }
    },
    async syncOnPause() {
      const save = window.LocalSaveFolder; // Canonical folder autosave owner; no duplicate save format.
      if (window.HobunjiAutosavePause?.isPaused?.()) return { skipped: true, reason: 'paused' };
      const status = save?.getStatus?.();
      if (status?.state === 'ready' && status.autoSyncArmed) {
        return save.syncNow({ automatic: true, reason: 'android-background' });
      }
      if (window.__hobunjiGameStarted) {
        const result = await window.HobunjiRuntimeSave?.flushNow?.({ reason: 'android-background' });
        return result?.ok === true
          ? { ok: true, mode: 'browser' }
          : { ok: false, mode: 'browser', error: result?.error || 'Browser save was not available.' };
      }
      return { skipped: true };
    },
    async saveBeforeExit() {
      const save = window.LocalSaveFolder; // Same folder API as Windows/browser.
      if (window.HobunjiAutosavePause?.isPaused?.()) {
        return { ok: false, mode: 'paused', error: 'Saving is deliberately paused; unpause before exiting or explicitly exit without saving.' };
      }
      const status = save?.getStatus?.();
      if (status?.state === 'ready' && status.autoSyncArmed) {
        const result = await save.syncNow({ reason: 'android-quit' });
        if (!result || result.state !== 'ready' || result.dataLossRisk ||
            /error|blocked|risk/i.test(result.lastAction || '')) {
          return { ok: false, error: result?.lastError || result?.dataLossRisk || 'Folder save was not completed.' };
        }
        return { ok: true, mode: 'folder' };
      }
      if (window.__hobunjiGameStarted) {
        const result = await window.HobunjiRuntimeSave?.flushNow?.({ reason: 'android-quit' }); // Await the actual browser write before permitting an update or quit.
        if (result?.ok !== true) return { ok: false, error: result?.error || 'Could not save the live game.' };
        if (status?.folderName) return { ok: false, error: 'Save folder disconnected or not armed. Only browser storage was saved.' };
      }
      return { ok: true, mode: 'browser' };
    },
  });
  window.HobunjiAndroidFiles = api;
  window.showDirectoryPicker = async () => {
    const result = await request('choose'); // Native picker now offers Phone Folder or Google Drive.
    if (!result?.tree) throw errorFromNative({ name: 'AbortError', message: 'No folder chosen.' });
    return new AndroidDirectoryHandle(result.tree, [], result.name || 'Hobunji Saves');
  };
})();
