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

  function firstSyllable(name) {
    const word = givenName(name); // First given word only; never shorten a family name as if it were a syllable.
    if (!word) return '';
    const firstVowel = [...word].findIndex((_, index) => isVowel(word, index)); // First nucleus controls the boundary, not raw character count.
    if (firstVowel < 0) return word;

    let nucleusEnd = firstVowel + 1; // Exclusive end of the first vowel nucleus.
    if (isVowel(word, nucleusEnd) && DIPHTHONGS.has(word.slice(firstVowel, nucleusEnd + 1).toLowerCase())) nucleusEnd++;
    let nextVowel = nucleusEnd; // Beginning of the next distinct syllable nucleus.
    while (nextVowel < word.length && !isVowel(word, nextVowel)) {
      if (/['\u2019]/.test(word[nextVowel])) return word.slice(0, nextVowel) || word;
      nextVowel++;
    }
    if (nextVowel >= word.length) return word; // A monosyllabic name is not abbreviated.
    if (nextVowel === nucleusEnd) return word.slice(0, nucleusEnd); // Vowel hiatus without an intervening consonant.

    const consonants = word.slice(nucleusEnd, nextVowel); // Intervocalic consonants to distribute between the first two syllables.
    let keep = Math.max(0, consonants.length - 1); // A single consonant begins the next syllable; in clusters the earlier ones close the first.
    if (/^ng$/i.test(consonants)) keep = 2; // Keep the nasal digraph together: Slangoro -> Slang, not Slan.
    if (/^(?:ch|sh|th|ph|kh|wh|gh|rh)$/i.test(consonants)) keep = 0; // Onset digraphs belong together to the next syllable.
    if (firstVowel === 0 && /^[hlmnr]$/i.test(consonants)) keep = 1; // Initial-vowel names such as Alexander/Elizabeth begin Al/El, not A/E.
    return word.slice(0, nucleusEnd + keep) || word;
  }

  function forRelationship(name, relation = 'other') {
    const full = givenName(name); // Stable fallback for non-friends and single-syllable names.
    if (relation !== 'friend' && relation !== 'affectionate') return full;
    const short = firstSyllable(full); // Shared friend and affectionate stem.
    if (relation !== 'affectionate' || short === full || /y$/i.test(short)) return short;
    // A short vowel + single final consonant takes the familiar English doubled spelling: Ben -> Benny.
    const doubles = /[aeiou][bdfgkmnptsz]$/i.test(short) && !/[aeiou][aeiou][bdfgkmnptsz]$/i.test(short);
    return short + (doubles ? short.slice(-1) : '') + 'y';
  }

  function isAffectionateSpeaker(npcId) {
    if (!npcId) return false;
    const romance = window.RomanceSystem; // Event-time check; the active spouse and last dated partner are saved by RomanceSystem.
    return romance?.getSpouse?.()?.npcId === npcId || romance?.getLastDatedNpcId?.() === npcId;
  }

  function addressPlayer(name, speakerId, options = {}) {
    const full = String(name || '').trim(); // Preserve the player's chosen full name for neutral acquaintances.
    if (!full) return '';
    if (isAffectionateSpeaker(speakerId)) return forRelationship(full, 'affectionate');
    const custom = String(options.customNickname || '').trim(); // Authored per-NPC nicknames outrank automatic friend shortening.
    if (custom && custom !== full) return custom;
    return Number(options.favor) >= FRIEND_HEARTS ? forRelationship(full, 'friend') : full;
  }

  function npcBond(speakerId, targetId) {
    if (!speakerId || !targetId || speakerId === targetId) return null;
    const bonds = window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.relationships || []; // Canonical partner/friend graph, shared with seating and festival dances.
    for (const type of ['partner', 'friend']) {
      if (bonds.some(b => b?.type === type && Array.isArray(b.members) && b.members.includes(speakerId) && b.members.includes(targetId))) return type;
    }
    return null;
  }

  function preview(name, speakerId, favor = 0) {
    return { givenName: givenName(name), firstSyllable: firstSyllable(name),
      friend: forRelationship(name, 'friend'), affectionate: forRelationship(name, 'affectionate'),
      address: addressPlayer(name, speakerId, { favor }), spouseId: window.RomanceSystem?.getSpouse?.()?.npcId || null,
      lastDatedId: window.RomanceSystem?.getLastDatedNpcId?.() || null, friendHeartsThreshold: FRIEND_HEARTS };
  }

  window.CharacterNicknames = Object.freeze({ givenName, firstSyllable, forRelationship, addressPlayer, isAffectionateSpeaker, npcBond, preview });
})();
