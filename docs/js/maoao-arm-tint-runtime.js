// Correct the live Mao-ao species data's right-arm tint-slot mismatch without
// changing its intentional front/back portrait layering.
(() => {
  'use strict';

  const VERSION = 1; // Exposed through the debug API so mobile reports can identify the installed correction.
  const MAO_AO_KEY = 'mao-ao'; // Used by normalizeFighter to match both mao-ao and mao_ao species ids.
  const RIGHT_ARM_ID = 'armR'; // Used by normalizeFighter to limit the correction to the affected painted arm layer.
  let correctionCount = 0; // Incremented whenever a live Mao-ao right arm is corrected from body slot C to body slot A.
  let lastCorrection = null; // Reported through snapshot() so mobile diagnostics can prove which fighter/layer was corrected most recently.

  function normalizeSpeciesKey(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function isMaoAoFighter(fighter) {
    const species = normalizeSpeciesKey(fighter?.speciesId || fighter?.species); // Used first because loaded species JSON carries the canonical species id.
    if (species === MAO_AO_KEY) return true;
    const headUrl = String(fighter?.headUrl || fighter?.headSprite || '').toLowerCase(); // Fallback for older fighter records that predate speciesId.
    return headUrl.includes('/mao-ao-');
  }

  function isMaoAoRightArm(layer) {
    if (!layer || typeof layer !== 'object') return false;
    const id = String(layer.id || ''); // Used to prefer the authored semantic layer id when available.
    const url = String(layer.url || '').toLowerCase(); // Used as a legacy fallback for records whose layer id is missing.
    return id === RIGHT_ARM_ID || /portraitsprites\/arm-r_mao-ao_[mf]\.png$/i.test(url);
  }

  function normalizeFighter(fighter) {
    if (!fighter || typeof fighter !== 'object' || !isMaoAoFighter(fighter) || !Array.isArray(fighter.bodyLayers)) return fighter;
    let changed = false; // Controls whether this function can return the original fighter object when no correction was needed.
    const bodyLayers = fighter.bodyLayers.map(layer => {
      if (!isMaoAoRightArm(layer) || String(layer.tintSlot || '').toUpperCase() !== 'C') return layer;
      changed = true;
      correctionCount += 1;
      lastCorrection = {
        fighterId: fighter.id || null,
        speciesId: fighter.speciesId || fighter.species || MAO_AO_KEY,
        gender: fighter.gender || null,
        layerId: layer.id || RIGHT_ARM_ID,
        url: layer.url || null,
        fromTintSlot: layer.tintSlot,
        toTintSlot: 'A',
        preservedPosition: layer.pos || null,
      };
      return { ...layer, tintSlot: 'A' };
    });
    return changed ? { ...fighter, bodyLayers } : fighter;
  }

  function install() {
    const current = window.normalizedFighterPortrait; // Shared portrait normalizer called whenever species JSON is committed into the live fighter list.
    if (typeof current !== 'function') return false;
    if (current.__hobunjiMaoAoArmTintWrapped) return true;

    const wrapped = function maoAoArmTintNormalizedFighter(fighter) {
      return normalizeFighter(current.apply(this, arguments));
    };
    Object.assign(wrapped, current);
    wrapped.__hobunjiMaoAoArmTintWrapped = true;
    window.normalizedFighterPortrait = wrapped;
    return true;
  }

  function snapshot() {
    return {
      version: VERSION,
      installed: !!window.normalizedFighterPortrait?.__hobunjiMaoAoArmTintWrapped,
      correctionCount,
      lastCorrection: lastCorrection ? { ...lastCorrection } : null,
    };
  }

  window.HobunjiMaoAoArmTintFix = Object.freeze({
    version: VERSION,
    install,
    normalizeFighter,
    snapshot,
  });
  window.__maoAoArmTintDebug = window.HobunjiMaoAoArmTintFix;

  let attempts = 0; // Bounds the late-load retry in tools that load portrait-utils after this module.
  let timer = null; // Holds the retry interval so it can be cleared as soon as the portrait normalizer exists.
  timer = setInterval(() => {
    if (install() || ++attempts >= 200) clearInterval(timer);
  }, 50);
  install();
})();
