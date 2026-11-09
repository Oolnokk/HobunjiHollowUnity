// Relationship-aware shortened names. Reuses the game's authored social bonds and RomanceSystem save state.
(() => {
  'use strict';
  if (window.CharacterNicknames) return;

  const DIPHTHONGS = new Set(['ai', 'ao', 'au', 'ei', 'eu', 'oi', 'ou', 'ea', 'ee', 'oo', 'ay', 'ey', 'ow', 'oy', 'ia', 'ie', 'io', 'iu', 'ui', 'ua', 'ue']); // Vowel pairs treated as one spoken nucleus in generated names.
  const VOWEL = /[aeiouàáâäãåèéêëìíîïòóôöõùúûü]/i; // Recognizes the written vowels used by names, including accented player names.
  const FRIEND_HEARTS = 2; // First friendship tier; used only for forms of address, never for changing Favor.

  function givenName(name) {
    return String(name || '').trim().split(/[\s\u2010-\u2015-]+/)[0] || '';
  }

  function isVowel(name, index) {
    const letter = name[index] || '';
    if (VOWEL.test(letter)) return true;
    // An initial y, or y immediately before a normal vowel, is a consonant.
    return /y/i.test(letter) && index > 0 && !VOWEL.test(name[index + 1] || '');
  }

  function firstSyllable(name, gender = 'female') {
    const word = givenName(name); // Given name to shorten; the unchanged full name remains available elsewhere.
    if (!word) return '';
    const firstVowel = [...word].findIndex((_, index) => isVowel(word, index)); // First spoken vowel nucleus shared by all gender rules.
    if (firstVowel < 0) return word;

    let nucleusEnd = firstVowel + 1; // Exclusive end of the first vowel nucleus.
    if (isVowel(word, nucleusEnd) && DIPHTHONGS.has(word.slice(firstVowel, nucleusEnd + 1).toLowerCase())) nucleusEnd++;
    let nextVowel = nucleusEnd; // First vowel in a subsequent syllable, if one exists.
    while (nextVowel < word.length && !isVowel(word, nextVowel)) {
      if (/['\u2019]/.test(word[nextVowel])) return word.slice(0, nextVowel) || word;
      nextVowel++;
    }
    if (nextVowel >= word.length) return word; // One-syllable names stay whole as friend nicknames.
    if (nextVowel === nucleusEnd || gender !== 'male') return word.slice(0, nucleusEnd); // Feminine friend nickname drops the next consonant.

    const consonants = word.slice(nucleusEnd, nextVowel); // Consonants between the first two vowel nuclei.
    const firstConsonant = /^(?:ng|ch|sh|th|ph|kh|wh|gh|rh)/i.exec(consonants)?.[0] || consonants[0]; // Keep digraphs intact, otherwise one consonant.
    return word.slice(0, nucleusEnd + firstConsonant.length); // Masculine friend nickname retains the next consonant.
  }

  function forRelationship(name, relation = 'other', gender = 'female') {
    const full = givenName(name); // Neutral acquaintances retain their unchanged given name.
    if (relation !== 'friend' && relation !== 'affectionate') return full;
    const short = firstSyllable(full, relation === 'affectionate' ? 'male' : gender); // Spouse/date always retains the next consonant, even for females.
    return relation === 'affectionate' && short ? short + 'y' : short; // Adds y even when the original has only one syllable.
  }

  function isAffectionateSpeaker(npcId) {
    if (!npcId) return false;
    const romance = window.RomanceSystem; // Event-time check; the active spouse and last dated partner are saved by RomanceSystem.
    return romance?.getSpouse?.()?.npcId === npcId || romance?.getLastDatedNpcId?.() === npcId;
  }

  function addressPlayer(name, speakerId, options = {}) {
    const full = String(name || '').trim(); // Preserve the player's chosen full name for neutral acquaintances.
    if (!full) return '';
    const gender = options.gender || window.__hobunjiPlayerProfile?.appearance?.gender || 'female'; // Target player's gender, never the speaker's.
    if (isAffectionateSpeaker(speakerId)) return forRelationship(full, 'affectionate', gender);
    const custom = String(options.customNickname || '').trim(); // Authored per-NPC nicknames outrank automatic friend shortening.
    if (custom && custom !== full) return custom;
    return Number(options.favor) >= FRIEND_HEARTS ? forRelationship(full, 'friend', gender) : full;
  }

  function npcBond(speakerId, targetId) {
    if (!speakerId || !targetId || speakerId === targetId) return null;
    const bonds = window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.relationships || []; // Canonical partner/friend graph, shared with seating and festival dances.
    for (const type of ['partner', 'friend']) {
      if (bonds.some(b => b?.type === type && Array.isArray(b.members) && b.members.includes(speakerId) && b.members.includes(targetId))) return type;
    }
    return null;
  }

  function preview(name, speakerId, favor = 0, gender = 'female') {
    return { givenName: givenName(name), gender, firstSyllable: firstSyllable(name, gender),
      friend: forRelationship(name, 'friend', gender), affectionate: forRelationship(name, 'affectionate', gender),
      address: addressPlayer(name, speakerId, { favor, gender }), spouseId: window.RomanceSystem?.getSpouse?.()?.npcId || null,
      lastDatedId: window.RomanceSystem?.getLastDatedNpcId?.() || null, friendHeartsThreshold: FRIEND_HEARTS };
  }

  window.CharacterNicknames = Object.freeze({ givenName, firstSyllable, forRelationship, addressPlayer, isAffectionateSpeaker, npcBond, preview });
})();
