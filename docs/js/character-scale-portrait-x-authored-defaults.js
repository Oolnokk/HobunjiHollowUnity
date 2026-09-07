// Canonical authored portrait-only X offsets for Full Character Scale.
(() => {
  'use strict';

  const VALUES = Object.freeze({
    'mao-ao::male': -0.08,
    'mao-ao::female': -0.04,
    'engh-sho::male': -0.07,
    'engh-sho::female': -0.04,
  }); // Fractions of portrait model width; e.g. -0.08 = 8% left.

  function install() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters;
    if (!characters) return false;
    let applied = 0; // Mobile diagnostic count of repository profiles that received these defaults.
    for (const [key, value] of Object.entries(VALUES)) {
      const profile = characters[key];
      if (!profile) continue;
      profile.anatomy ||= {};
      const existing = profile.anatomy.portraitOffsetX;
      if (existing == null || !Number.isFinite(Number(existing))) profile.anatomy.portraitOffsetX = value;
      if (Number(profile.anatomy.portraitOffsetX) === value) applied += 1;
    }
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.fullCharacterPortraitXAuthoredDefaults = {
      installed: true,
      applied,
      units: 'portrait-width-fraction',
      values: { ...VALUES },
    };
    return true;
  }

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      if (install() || ++attempts >= 200) clearInterval(timer);
    }, 50);
  }
})();
