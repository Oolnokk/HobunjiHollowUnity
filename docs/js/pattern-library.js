// Pattern library — a character-saved collection of pattern-authoring.js
// placement definitions (see PATTERN_DEFAULTS there), so a motif the player
// draws once can be reused later instead of redrawn from scratch. Two kinds
// of entries live side by side:
//
//   - "saved" entries: the player's own drawings, stashed via saveToLibrary
//     whenever they save/reopen a pattern-authoring session (see
//     metal-craft-shop.js's openVerdigrisPatternEditor) — removable, always
//     owned.
//   - "catalog" entries: a small built-in set of premade motifs the player
//     doesn't draw themselves, gated behind unlock(id) — the hook any
//     in-game source (treasure, an NPC gift, a quest reward, a future
//     achievement) calls to grant one, the same shape as
//     DyeSystem.unlock(dyeId)/gearInventory.dyeCollection. Not removable.
//
// Deliberately as agnostic as pattern-authoring.js itself about WHAT the
// patterns decorate — today that's the smithy's authored verdigris-removal
// patterns, but nothing here mentions verdigris/metal, so the exact same
// library works unmodified for a future weaving system.
//
// Extracted following the window.<Namespace> + init(deps) pattern already
// used by js/dye-system.js. gearInventory is threaded through as a getter
// (not a captured reference) for the same reason as that module: character
// load/logout reassigns it wholesale.
(() => {
  'use strict';

  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function gearInventory() { return deps?.getGearInventory?.() || null; }

  function ensureCollection() {
    const gear = gearInventory();
    if (!gear) return;
    if (!Array.isArray(gear.patternLibrary)) gear.patternLibrary = [];
    if (!Array.isArray(gear.unlockedPatternIds)) gear.unlockedPatternIds = [];
  }

  // ── Player-drawn saved patterns ─────────────────────────────────────
  function listSaved() {
    ensureCollection();
    return [...(gearInventory()?.patternLibrary || [])];
  }
  function getSaved(id) {
    return gearInventory()?.patternLibrary?.find(entry => entry.id === id) || null;
  }
  function saveToLibrary(label, patternData) {
    ensureCollection();
    const gear = gearInventory();
    if (!gear || !patternData?.motifDataUrl) return null;
    const entry = {
      id: 'lib_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
      label: String(label || 'Untitled pattern').trim().slice(0, 60) || 'Untitled pattern',
      savedAt: Date.now(),
      pattern: { ...patternData },
    };
    gear.patternLibrary.push(entry);
    deps?.saveGearInventory?.();
    return entry.id;
  }
  function renameSaved(id, label) {
    const entry = getSaved(id);
    if (!entry) return false;
    entry.label = String(label || entry.label).trim().slice(0, 60) || entry.label;
    deps?.saveGearInventory?.();
    return true;
  }
  function removeSaved(id) {
    const gear = gearInventory();
    if (!gear || !Array.isArray(gear.patternLibrary)) return false;
    const before = gear.patternLibrary.length;
    gear.patternLibrary = gear.patternLibrary.filter(entry => entry.id !== id);
    if (gear.patternLibrary.length === before) return false;
    deps?.saveGearInventory?.();
    return true;
  }

  // ── Premade catalog patterns, unlockable from in-game sources ───────
  // Pre-drawn (not player ink) so a given catalog id renders identically
  // for every player who unlocks it — plain bold glyphs are enough since
  // pattern-authoring.js treats any solid black-on-transparent image as a
  // valid motif. Built lazily (first getCatalog() call) since it needs a
  // real <canvas>, not available before the page's body exists.
  const CATALOG_SIZE = 192;
  let catalogCache = null;
  function drawCatalogMotif(draw) {
    const canvas = document.createElement('canvas');
    canvas.width = CATALOG_SIZE;
    canvas.height = CATALOG_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    draw(ctx, CATALOG_SIZE);
    return canvas.toDataURL('image/png');
  }
  function buildCatalog() {
    return [
      {
        id: 'chevron', label: 'Chevron Rune',
        pattern: { motifDataUrl: drawCatalogMotif((ctx, s) => {
          ctx.lineWidth = s * 0.1;
          ctx.beginPath();
          ctx.moveTo(s * 0.2, s * 0.62);
          ctx.lineTo(s * 0.5, s * 0.3);
          ctx.lineTo(s * 0.8, s * 0.62);
          ctx.stroke();
        }) },
      },
      {
        id: 'diamond-ring', label: 'Diamond Ring',
        pattern: { motifDataUrl: drawCatalogMotif((ctx, s) => {
          ctx.lineWidth = s * 0.09;
          ctx.beginPath();
          ctx.moveTo(s * 0.5, s * 0.18);
          ctx.lineTo(s * 0.82, s * 0.5);
          ctx.lineTo(s * 0.5, s * 0.82);
          ctx.lineTo(s * 0.18, s * 0.5);
          ctx.closePath();
          ctx.stroke();
        }) },
      },
      {
        id: 'zigzag-wave', label: 'Zigzag Wave',
        pattern: { motifDataUrl: drawCatalogMotif((ctx, s) => {
          ctx.lineWidth = s * 0.09;
          ctx.beginPath();
          ctx.moveTo(s * 0.15, s * 0.5);
          ctx.lineTo(s * 0.35, s * 0.25);
          ctx.lineTo(s * 0.5, s * 0.5);
          ctx.lineTo(s * 0.65, s * 0.25);
          ctx.lineTo(s * 0.85, s * 0.5);
          ctx.stroke();
        }) },
      },
      {
        id: 'four-point-star', label: 'Four-Point Star',
        pattern: { motifDataUrl: drawCatalogMotif((ctx, s) => {
          const cx = s * 0.5, cy = s * 0.5, rOuter = s * 0.36, rInner = s * 0.13;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const r = i % 2 === 0 ? rOuter : rInner;
            const ang = (Math.PI / 4) * i - Math.PI / 2;
            const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        }) },
      },
    ];
  }
  function getCatalog() {
    if (!catalogCache) catalogCache = buildCatalog();
    return catalogCache;
  }
  function catalogById(id) {
    return getCatalog().find(entry => entry.id === id) || null;
  }
  function owns(patternId) {
    ensureCollection();
    return Array.isArray(gearInventory()?.unlockedPatternIds) && gearInventory().unlockedPatternIds.includes(patternId);
  }
  // The hook: call from any in-game source (treasure loot, an NPC gift, a
  // quest reward, a future achievement) to grant a catalog pattern by id.
  // Idempotent — false if the id isn't real or is already owned.
  function unlock(patternId) {
    ensureCollection();
    if (!catalogById(patternId)) return false;
    const gear = gearInventory();
    if (!gear || gear.unlockedPatternIds.includes(patternId)) return false;
    gear.unlockedPatternIds.push(patternId);
    deps?.saveGearInventory?.();
    return true;
  }
  function unlockedCatalogEntries() {
    ensureCollection();
    const ids = gearInventory()?.unlockedPatternIds || [];
    return getCatalog().filter(entry => ids.includes(entry.id));
  }

  // ── Combined listing for the pattern-authoring "Library" picker ─────
  // Both kinds are equally "patterns you have" from the editor's point of
  // view — the only difference exposed is whether the player can delete it.
  function listAvailable() {
    const saved = listSaved().map(entry => ({ id: entry.id, label: entry.label, source: 'saved', removable: true }));
    const unlocked = unlockedCatalogEntries().map(entry => ({ id: entry.id, label: entry.label, source: 'catalog', removable: false }));
    return [...saved, ...unlocked];
  }
  function getById(id) {
    const saved = getSaved(id);
    if (saved) return saved.pattern;
    const cat = catalogById(id);
    return cat && owns(id) ? cat.pattern : null;
  }

  window.PatternLibrary = {
    init,
    ensureCollection,
    listSaved,
    getSaved,
    saveToLibrary,
    renameSaved,
    removeSaved,
    getCatalog,
    owns,
    unlock,
    unlockedCatalogEntries,
    listAvailable,
    getById,
  };
})();
