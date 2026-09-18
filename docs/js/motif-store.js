// Motif Store — off-save storage for player-drawn pattern motifs.
//
// A per-item "Custom" pattern (one drawn in pattern-authoring.js and applied
// straight to a garment layer or a tool's verdigris plating, never saved to
// the shared PatternLibrary) used to embed its full motif PNG as a base64
// data URL directly inside gearInventory, which then got re-serialized on
// every single gearInventory save regardless of whether that motif was
// touched. This store moves that PNG out to its own file, written once when
// the pattern is authored and read back only by whatever render/recolor call
// actually needs its pixels — the save itself keeps only a small
// customMotifId reference (see pattern-authoring.js's offloadMotif).
//
// Backing store is the Origin Private File System (navigator.storage.
// getDirectory()) — no permission dialog, broad modern-browser support,
// durable across sessions, and (unlike localStorage) not string/JSON
// bound, so a PNG can be written as real bytes. If OPFS isn't available,
// saveMotif simply returns null and callers fall back to embedding the
// motif directly, same as before this store existed — a motif is never
// lost over a missing/failed optimization.
//
// PatternLibrary entries are NOT covered here on purpose: PatternLibrary
// already solves its own duplication problem (many items reference one
// library entry by id instead of copying it), so a library entry only
// ever pays for one embedded copy of its own motif, and PatternLibrary.
// getById is called synchronously from many places throughout the
// codebase — moving its storage here too would mean making all of those
// async as well, a much larger change than the one-off "Custom" pattern
// case this was actually written for.
(() => {
  'use strict';
  if (window.MotifStore) return;

  const DIR_NAME = 'patterns';
  const memoryCache = new Map(); // customMotifId -> data URL, populated on first save/load this session so repeat renders never re-hit OPFS.
  let dirPromise = null;

  function opfsSupported() {
    return !!(navigator.storage && typeof navigator.storage.getDirectory === 'function');
  }

  function motifDir() {
    if (!opfsSupported()) return Promise.resolve(null);
    if (!dirPromise) {
      dirPromise = navigator.storage.getDirectory()
        .then(root => root.getDirectoryHandle(DIR_NAME, { create: true }))
        .catch(() => null);
    }
    return dirPromise;
  }

  function dataUrlToBytes(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const binary = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToDataUrl(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:image/png;base64,${btoa(binary)}`;
  }

  function generateId() {
    return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // Writes a freshly authored motif's pixel data and returns its id, or
  // null if the store is unavailable/the write failed (caller keeps the
  // plain embedded motifDataUrl in that case).
  async function saveMotif(dataUrl) {
    if (!dataUrl) return null;
    const dir = await motifDir();
    if (!dir) return null;
    const id = generateId();
    const bytes = dataUrlToBytes(dataUrl);
    try {
      const fileHandle = await dir.getFileHandle(`${id}.png`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(bytes);
      await writable.close();
    } catch (_) {
      return null;
    }
    memoryCache.set(id, dataUrl);
    // Best-effort bonus backup into the player's connected local save
    // folder, if any (see local-save-folder-core.js) — never required for
    // the motif to keep working, so any failure here is silently ignored.
    try { window.LocalSaveFolder?.mirrorPatternFile?.(id, bytes); } catch (_) { /* fire-and-forget */ }
    return id;
  }

  // Reads a motif's data URL by id, or null if it's missing/unreadable —
  // callers treat that the same as "no motif drawn" rather than throwing,
  // since a storage hiccup here should never break the item it's on.
  async function loadMotif(id) {
    if (!id) return null;
    if (memoryCache.has(id)) return memoryCache.get(id);
    const dir = await motifDir();
    if (!dir) return null;
    try {
      const fileHandle = await dir.getFileHandle(`${id}.png`);
      const file = await fileHandle.getFile();
      const dataUrl = bytesToDataUrl(new Uint8Array(await file.arrayBuffer()));
      memoryCache.set(id, dataUrl);
      return dataUrl;
    } catch (_) {
      return null;
    }
  }

  // Removes a motif that's no longer referenced by anything. Not currently
  // called from anywhere yet (no caller tracks "the last reference to this
  // id was just dropped") — exposed so that bookkeeping can be added later
  // without another storage-layer change.
  async function deleteMotif(id) {
    if (!id) return;
    memoryCache.delete(id);
    const dir = await motifDir();
    if (!dir) return;
    try { await dir.removeEntry(`${id}.png`); } catch (_) { /* already gone */ }
  }

  window.MotifStore = { saveMotif, loadMotif, deleteMotif, supported: opfsSupported };
})();
