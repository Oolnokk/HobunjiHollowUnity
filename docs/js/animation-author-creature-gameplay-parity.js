// Shared, browser-only size/ground math for Multi-Avatar Animation Author.
// Reads the same attachment-rig master as CreatureGenetics; never creates a second animal scale table.
(() => {
  'use strict';

  const CLASSES = Object.freeze(['small', 'medium', 'large']); // Valid genetic size rows used for preview and import.

  const clone = value => JSON.parse(JSON.stringify(value)); // Copies frozen gameplay profiles into editable editor state.
  const canonicalCreatures = () => window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures
    || window.HOBUNJI_ATTACHMENT_RIG_MASTER?.profiles?.creatures || {}; // Live gameplay profiles win over the frozen default master.
  const validClass = sizeClass => CLASSES.includes(sizeClass) ? sizeClass : 'medium'; // Prevents a missing class from indexing unrelated profile entries.

  function placement(profile, sizeClass, modelHeight) {
    const key = validClass(sizeClass); // Uses the same Small/Medium/Large row for both rendered proportions and ground contact.
    const scale = profile?.sizeScales?.[key] || {}; // Species-specific X (sprite width) and Y (sprite height) genetics multipliers.
    const x = Number(scale.x), y = Number(scale.y);
    const width = Number.isFinite(x) && x > 0 ? x : 1; // Runtime creatureSizeScale's invalid-value fallback.
    const height = Number.isFinite(y) && y > 0 ? y : 1; // Height multiplier also governs automatic floor lift.
    const stored = Number(profile?.groundOffsets?.[key]); // An authored positive lift REPLACES the automatic half-height.
    const authored = Number.isFinite(stored) && stored > 0 ? stored : null; // Zero/negative are gameplay's Auto sentinel.
    const nativeHeight = Number(modelHeight); // Unscaled model height from the same native sprite recipe as gameplay.
    const halfHeight = Math.max(0, Number.isFinite(nativeHeight) ? nativeHeight : 0) * height / 2;
    return {
      sizeClass: key, widthScale: width, heightScale: height, authoredGroundLift: authored,
      groundLift: authored ?? halfHeight, automaticGroundLift: halfHeight,
      groundMode: authored === null ? 'Auto' : 'Authored',
      // Both game and editor rotate the animal PNG ±90° about Y: visible width is group Z, not X.
      groupScale: { x: 1, y: height, z: width },
    };
  }

  function installRepositoryDefaults(library) {
    if (!library || typeof library !== 'object') return 0;
    library.creatures ||= {};
    let count = 0; // Tracks which built-in preview profiles were reloaded from gameplay, for mobile diagnostics.
    for (const [kind, profile] of Object.entries(canonicalCreatures())) {
      library.creatures[kind] = clone(profile);
      count++;
    }
    return count;
  }

  function normalizeImported(library, source = {}) {
    if (!library || typeof library !== 'object') return library;
    library.creatures ||= {};
    const canonical = canonicalCreatures(); // Already-loaded game master; never sourced from an embedded editor snapshot.
    const imported = source?.creatures || {};
    for (const [kind, gameplayProfile] of Object.entries(canonical)) {
      const original = imported[kind]; // Distinguishes an actual authored zero from an absent pre-v10 ground-offset field.
      const profile = library.creatures[kind] || (library.creatures[kind] = clone(gameplayProfile));
      if (!original) continue;
      if (!original.sizeScales) profile.sizeScales = clone(gameplayProfile.sizeScales);
      if (!original.groundOffsets) profile.groundOffsets = clone(gameplayProfile.groundOffsets);
    }
    const guard = window.HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD;
    if (typeof guard?.reconcileProfiles === 'function') {
      const repaired = guard.reconcileProfiles({ creatures: library.creatures })?.creatures;
      if (repaired) library.creatures = repaired; // Repairs only exact recognized obsolete fingerprints; preserves authored edits.
    }
    return library;
  }

  window.AnimationAuthorCreatureGameplayParity = Object.freeze({
    validClass, placement, canonicalCreatures, installRepositoryDefaults, normalizeImported,
  });
})();
