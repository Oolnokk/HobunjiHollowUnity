// Owns generated animal texture lifetime. Live material maps stay pinned;
// old frames/removed animals share a bounded idle cache without losing detail.
(() => {
  'use strict';
  const caches = new Set(); // Contains only the two runtime cache owners, never animal objects.
  const disposedOwners = new WeakSet(); // Rejects late asynchronous loads for avatars already removed.
  const UNUSED_BYTES_LIMIT = 24 * 1024 * 1024; // Per-cache estimated CPU canvas + GPU pair budget for unused frames.
  const UNUSED_ENTRY_LIMIT = 64; // Also bounds tiny textures and key strings.
  const WORKING_SET_MS = 30000; // How long an on-screen animal's other frames (blink, run cycle) stay protected after last use.
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function estimateBytes(pair) {
    const image = pair.front?.image || pair.back?.image; // Both generated faces normally share a single canvas.
    const pixels = Math.max(1, Number(image?.width) || 1) * Math.max(1, Number(image?.height) || 1); // Native source dimensions; no downsampling.
    return Math.ceil(pixels * 4 * (1 + 2 * 4 / 3)); // One RGBA canvas plus two mipmapped GPU textures; approximate, not measured browser allocation.
  }

  // Generated frame keys are `${kind}|${frame}|${genotypeSignature}|${blink}`;
  // the signature itself may contain '|'. Every frame (idle/run/blink) of one
  // genotype forms a set that a moving animal cycles through constantly.
  function genotypeFrameSetKey(key) {
    const parts = String(key).split('|');
    return parts.length >= 4 ? [parts[0], ...parts.slice(2, -1)].join('|') : key;
  }

  function create(name, mirrors = null, pairMap = new Map(), options = {}) {
    // While any owner shows one frame of a set, the set's other frames that
    // were shown recently are kept too. Pinning only the bound frame let
    // walking/blinking animals evict the frames they had just left (each
    // composite is ~12MB against a 24MB idle budget), so every frame swap
    // flashed the plain sprite and recomposed colors, patterns and eyes from
    // scratch. Frames an on-screen animal hasn't used for WORKING_SET_MS (run
    // frames of an animal standing still) stay evictable, bounding memory to
    // what animals are actually cycling through.
    const frameSetOf = typeof options.frameSetOf === 'function' ? options.frameSetOf : key => key;
    const setOwners = new Map(); // Set key -> number of owners currently bound to any of its frames.
    const entries = new Map(); // Key -> pair, estimated bytes, and live reference count.
    const unused = new Map(); // Least-recently-used idle entries, insertion ordered.
    const waitingRefs = new Map(); // Temporary cutscene preload pins can precede asynchronous texture creation.
    const owners = new WeakMap(); // Avatar -> current key; never keeps an avatar alive itself.
    let unusedBytes = 0; // Tracks idle allocation estimates without scanning scenes.
    let totalBytes = 0; // Tracks all generated allocation estimates, including live material maps.
    let evictions = 0; // Reported in the existing mobile performance snapshot.

    function inWorkingSet(key, entry) {
      return (setOwners.get(frameSetOf(key)) || 0) > 0 && now() - entry.lastUsedAt < WORKING_SET_MS;
    }

    function adjustSetOwners(key, delta) {
      if (key == null) return;
      const set = frameSetOf(key);
      const after = Math.max(0, (setOwners.get(set) || 0) + delta);
      if (after) setOwners.set(set, after);
      else setOwners.delete(set);
    }

    function touchUnused(key, entry) {
      if (unused.has(key)) unused.delete(key);
      else unusedBytes += entry.bytes;
      unused.set(key, entry);
    }

    function trim(protectedKey = null) {
      for (const [key, entry] of unused) {
        if (unusedBytes <= UNUSED_BYTES_LIMIT && unused.size <= UNUSED_ENTRY_LIMIT) break;
        if (key === protectedKey) continue; // Give a newly completed compose a chance to bind before it can be evicted.
        if (inWorkingSet(key, entry)) continue; // An on-screen animal is still cycling through this frame.
        unused.delete(key);
        unusedBytes -= entry.bytes;
        totalBytes -= entry.bytes;
        entries.delete(key);
        pairMap.delete(key);
        mirrors?.front.delete(key);
        mirrors?.back.delete(key);
        entry.pair.front?.dispose?.();
        if (entry.pair.back !== entry.pair.front) entry.pair.back?.dispose?.();
        evictions++;
      }
    }

    function get(key) {
      const entry = entries.get(key); // Promotes frequently reused idle/blink frames.
      if (!entry) return null;
      if (!entry.refs) touchUnused(key, entry);
      return entry.pair;
    }

    function put(key, pair) {
      const existing = entries.get(key); // Never overwrite a shared live pair after overlapping loads.
      if (existing) {
        if (existing.pair.front !== pair.front) pair.front?.dispose?.();
        if (existing.pair.back !== pair.back) pair.back?.dispose?.();
        return existing.pair;
      }
      pair.key = key;
      const entry = { pair, bytes: estimateBytes(pair), refs: waitingRefs.get(key) || 0, lastUsedAt: now() }; // Starts idle until a material owner binds it.
      waitingRefs.delete(key);
      entries.set(key, entry);
      pairMap.set(key, pair);
      mirrors?.front.set(key, pair.front);
      mirrors?.back.set(key, pair.back);
      totalBytes += entry.bytes;
      if (!entry.refs) touchUnused(key, entry);
      trim(key);
      return pair;
    }

    function retain(owner, key) {
      if (!owner || disposedOwners.has(owner)) return false;
      const previousKey = owners.get(owner); // A frame change releases exactly one previous binding.
      if (previousKey === key) return !!key;
      const next = entries.get(key); // Acquire before releasing, so trimming cannot dispose the new bound pair.
      if (next) {
        next.refs++;
        next.lastUsedAt = now();
        if (unused.delete(key)) unusedBytes -= next.bytes;
        owners.set(owner, key);
      } else if (key != null) {
        waitingRefs.set(key, (waitingRefs.get(key) || 0) + 1);
        owners.set(owner, key);
      } else owners.delete(owner);
      adjustSetOwners(key, 1); // Pin the new set before releasing the old frame, so a same-set swap never exposes it to trimming.
      const previous = entries.get(previousKey); // Shared pairs survive until the final material owner releases them.
      if (previous) previous.lastUsedAt = now();
      if (previous && --previous.refs === 0) touchUnused(previousKey, previous);
      else if (!previous && previousKey != null) releaseWaiting(previousKey);
      adjustSetOwners(previousKey, -1);
      trim();
      return key != null;
    }

    function releaseWaiting(key) {
      const remaining = (waitingRefs.get(key) || 0) - 1; // Cleans both failed and successful preload reservations.
      if (remaining > 0) waitingRefs.set(key, remaining);
      else waitingRefs.delete(key);
    }

    function release(owner) {
      const key = owners.get(owner); // Idempotent cleanup, including repeated disposal wrappers.
      owners.delete(owner);
      const entry = entries.get(key);
      if (entry && --entry.refs === 0) touchUnused(key, entry);
      else if (!entry && key != null) releaseWaiting(key);
      adjustSetOwners(key, -1);
      trim();
    }

    function snapshot() {
      return { name, entries: entries.size, livePairs: entries.size - unused.size, unusedPairs: unused.size, pinnedFrameSets: setOwners.size, estimatedBytes: totalBytes, unusedEstimatedBytes: unusedBytes, unusedBudgetBytes: UNUSED_BYTES_LIMIT, evictions }; // On-demand scalars for mobile memory reports.
    }

    const keyFor = owner => owners.get(owner) ?? null; // The generated frame this owner currently has bound (or is waiting on).
    const api = { get, put, retain, release, trim, snapshot, keyFor }; // Narrow shared owner API used by farm and game.js.
    caches.add(api);
    return api;
  }

  window.CreatureTextureCache = {
    create,
    genotypeFrameSetKey,
    isDisposed: owner => disposedOwners.has(owner),
    releaseOwner(owner) {
      if (!owner) return;
      disposedOwners.add(owner);
      for (const cache of caches) cache.release(owner);
    },
    snapshot: () => Array.from(caches, cache => cache.snapshot()),
  };
})();
