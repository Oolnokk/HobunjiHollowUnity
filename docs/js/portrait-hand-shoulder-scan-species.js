// Adds a species/gender entry point to the portrait shoulder fallback scanner.
// The direct hand frame driver does not need to retain a full portrait profile just
// so shoulder detection can find the correct raw arm layers.
(function (global) {
  'use strict';
  const base = global.PortraitHandShoulderScan;
  if (!base?.scanProfile || base.scanSpecies) return;

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }
  function normalizeGender(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  }
  function fighterGender(fighter) {
    return normalizeGender(fighter?.gender ?? (fighter?.id === 'F' ? 'female' : 'male'));
  }

  function fighterFor(speciesId, gender) {
    const species = normalizeSpecies(speciesId);
    const desiredGender = normalizeGender(gender);
    const fighters = global.getPortraitFighters?.() || [];
    return fighters.find(fighter =>
      normalizeSpecies(fighter?.speciesId) === species && fighterGender(fighter) === desiredGender
    ) || null;
  }

  async function scanSpecies(speciesId, gender, width, height) {
    const fighter = fighterFor(speciesId, gender);
    if (!fighter) return null;
    return base.scanProfile({ fighter }, width, height);
  }

  global.PortraitHandShoulderScan = Object.freeze({ ...base, scanSpecies });
})(window);
