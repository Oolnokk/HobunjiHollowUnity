// Speaker-relative dialogue species labels. This changes only how dialogue
// names a species; canonical species IDs remain unchanged for saves, conditions,
// rendering, and gameplay systems.
(() => {
  'use strict';

  const SLAGOTHIM_SUBSPECIES = new Set(['tletingan', 'nuhongan', 'longoran']); // Used to let Slagothim-family speakers name a Tletingan specifically.
  const KENKARI_INSIDE_GROUP = new Set(['kenkari', 'rakakoan']); // Used to let Kenkari/Rakako'an speakers distinguish Rakako'ans from the broader Kenkari name.

  function normalizeSpeciesId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function labelFor(targetSpeciesId, speakerSpeciesId) {
    const target = normalizeSpeciesId(targetSpeciesId); // Used to apply the naming rule even if a caller supplies a display label instead of a canonical ID.
    const speaker = normalizeSpeciesId(speakerSpeciesId); // Used to decide whether the speaker belongs to the target's in-group.

    if (target === 'tletingan') {
      return SLAGOTHIM_SUBSPECIES.has(speaker) ? 'Tletingan' : 'Slagothim';
    }
    if (target === 'rakakoan') {
      return KENKARI_INSIDE_GROUP.has(speaker) ? "Rakako'an" : 'Kenkari';
    }
    return String(targetSpeciesId || '');
  }

  window.DialogueSpeciesNames = Object.freeze({
    normalizeSpeciesId,
    labelFor,
  });
})();
