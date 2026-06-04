(function initScratchbonesNameGenerator(global) {
  const root = global || window;

  function pickFromRng(rng, arr) {
    if (!arr || arr.length === 0) throw new Error('pickFromRng() called with empty array');
    return arr[Math.floor(rng() * arr.length)];
  }

  function titleCase(text) {
    if (!text) return text;
    return text[0].toUpperCase() + text.slice(1).toLowerCase();
  }

  function applyCasing(text, casing) {
    if (!casing) return text;
    if (casing === 'lower') return text.toLowerCase();
    if (casing === 'upper') return text.toUpperCase();
    return titleCase(text);
  }

  function clampInt(value, min, max) {
    return Math.max(min, Math.min(max, Math.floor(value)));
  }

  function tokenListSortedLongestFirst(tokens) {
    return (tokens || []).slice().sort((a, b) => b.length - a.length);
  }

  function startsWithAnyToken(text, tokens) {
    for (const token of tokens) if (text.startsWith(token)) return token;
    return null;
  }

  function endsWithAnyToken(text, tokens) {
    for (const token of tokens) if (text.endsWith(token)) return token;
    return null;
  }

  function joinSyllablesWithHiatus(syllables, pools) {
    if (syllables.length <= 1) return syllables.join('');
    const vowelTokens = tokenListSortedLongestFirst(pools.vowels);
    let out = syllables[0];
    for (let i = 1; i < syllables.length; i++) {
      let next = syllables[i];
      if (out.endsWith('n') && next.startsWith('n') && !next.startsWith('ng')) {
        next = next.slice(1);
      }
      const prevEndsVowel = !!endsWithAnyToken(out, vowelTokens);
      const nextStartsVowel = !!startsWithAnyToken(next, vowelTokens);
      out += (prevEndsVowel && nextStartsVowel) ? "'" + next : next;
    }
    return out;
  }

  function isVariablePattern(pattern) {
    return pattern.includes('V');
  }

  function isOnsetlessVPattern(pattern) {
    return isVariablePattern(pattern) && pattern.startsWith('V');
  }

  function parseForcedVowel(pattern) {
    const match = pattern.match(/^(.*)\{([^}]+)\}$/);
    if (!match) return { basePattern: pattern, forcedVowels: null };
    return {
      basePattern: match[1],
      forcedVowels: match[2].split('|').map((s) => s.trim()).filter(Boolean),
    };
  }

  function syllableEndsWithN(syllable) {
    return /n$/i.test(syllable || '') && !/ng$/i.test(syllable || '');
  }

  function syllableHasDiphthong(syllable, pools) {
    if (!syllable) return false;
    const diphthongs = [...(pools.diphthongs || []), 'ei'];
    return diphthongs.some((d) => syllable.includes(d));
  }

  function patternHasDiphthong(pattern) {
    return pattern.includes('{ai}') || pattern.includes('{ao}') || pattern.includes('ei');
  }

  function isConsonantRCluster(onset) {
    return onset.length > 1 && onset.endsWith('r');
  }

  function syllableStartsWithConsonantRCluster(syllable, pools) {
    if (!syllable) return false;
    return (pools.clusters || []).some((c) => isConsonantRCluster(c) && syllable.startsWith(c));
  }

  function constrainLastPatterns(patterns, previousSyllable, ctx = {}) {
    return patterns.filter((pattern) => {
      if (pattern.includes('{ai}') && !syllableEndsWithN(previousSyllable)) return false;
      if (/^j/.test(pattern) && !(ctx.allowInitialJ || syllableEndsWithN(previousSyllable))) return false;
      if (ctx.usedDiphthong && patternHasDiphthong(pattern)) return false;
      return true;
    });
  }

  function getVowelPoolForPattern(pools, hasConsonantEnding, forcedVowels, ctx = {}) {
    let pool = pools.vowels.slice();
    const diphthongs = pools.diphthongs || [];
    if (ctx.position === 'middle') pool = pool.filter((v) => !diphthongs.includes(v));
    if (ctx.usedDiphthong) pool = pool.filter((v) => !diphthongs.includes(v));
    if (ctx.nameType === 'last' && ctx.position === 'first') pool = pool.filter((v) => v !== 'ai');
    if (forcedVowels && forcedVowels.length) pool = pool.filter((v) => forcedVowels.includes(v));
    if (!hasConsonantEnding || diphthongs.length === 0) return pool;
    const monophthongs = pool.filter((v) => !diphthongs.includes(v));
    return monophthongs.length ? monophthongs : pool;
  }

  function buildSyllableFromPattern(rng, pools, pattern, opts = {}) {
    if (!isVariablePattern(pattern)) return pattern;
    const { basePattern, forcedVowels } = parseForcedVowel(pattern);
    let onsetPool = pools.consonants.concat(pools.clusters);
    if (opts.usedConsonantRCluster) {
      const filtered = onsetPool.filter((o) => !isConsonantRCluster(o));
      if (filtered.length) onsetPool = filtered;
    }
    const startsWithCV = basePattern.startsWith('CV');
    const startsWithV = basePattern.startsWith('V');
    if (!startsWithCV && !startsWithV) throw new Error(`Unsupported pattern "${pattern}".`);
    const coda = basePattern.slice(startsWithCV ? 2 : 1);
    const vowelPool = getVowelPoolForPattern(pools, coda.length > 0, forcedVowels, opts);
    const nucleus = pickFromRng(rng, vowelPool);
    if (startsWithCV) {
      const forcedOnset = opts.forceOnsetInitialLetter ? String(opts.forceOnsetInitialLetter).toLowerCase() : '';
      const onset = forcedOnset && pools.consonants.includes(forcedOnset) ? forcedOnset : pickFromRng(rng, onsetPool);
      return onset + nucleus + coda;
    }
    return nucleus + coda;
  }

  function pickPattern(rng, patterns, { allowOnsetlessV }) {
    const filtered = allowOnsetlessV ? patterns : patterns.filter((p) => !isOnsetlessVPattern(parseForcedVowel(p).basePattern));
    if (!filtered.length) throw new Error('No valid patterns after filtering.');
    return pickFromRng(rng, filtered);
  }

  function buildPositionedFirstName(rng, positioned, gender, options = {}) {
    const pools = positioned.pools;
    const rules = positioned.firstName;
    const syllables = [];
    let usedDiphthong = false;
    let usedConsonantRCluster = false;
    const firstSet = gender === 'male' ? rules.first.male : rules.first.female;
    const middleSet = gender === 'male' ? rules.middle.male : rules.middle.female;
    const lastSetBase = gender === 'male' ? rules.last.male : rules.last.female;
    const syllableCount = clampInt(rules.syllables.min, rules.syllables.min, rules.syllables.max);

    const firstPattern = pickPattern(rng, firstSet.patterns, { allowOnsetlessV: gender === 'female' });
    const firstSyllable = buildSyllableFromPattern(rng, pools, firstPattern, {
      forceOnsetInitialLetter: gender === 'male' ? options.forceFirstNameInitialLetter : undefined,
      position: 'first',
      nameType: 'first',
      usedDiphthong,
      usedConsonantRCluster,
    });
    syllables.push(firstSyllable);
    usedDiphthong = usedDiphthong || syllableHasDiphthong(firstSyllable, pools);
    usedConsonantRCluster = usedConsonantRCluster || syllableStartsWithConsonantRCluster(firstSyllable, pools);

    const middleCount = Math.max(0, syllableCount - 2);
    for (let i = 0; i < middleCount; i++) {
      const middlePattern = pickPattern(rng, middleSet.patterns, { allowOnsetlessV: false });
      const middleSyllable = buildSyllableFromPattern(rng, pools, middlePattern, {
        position: 'middle',
        nameType: 'first',
        usedDiphthong,
        usedConsonantRCluster,
      });
      syllables.push(middleSyllable);
      usedDiphthong = usedDiphthong || syllableHasDiphthong(middleSyllable, pools);
      usedConsonantRCluster = usedConsonantRCluster || syllableStartsWithConsonantRCluster(middleSyllable, pools);
    }

    const lastPatternOptions = constrainLastPatterns(lastSetBase.patterns, syllables[syllables.length - 1] || '', {
      usedDiphthong,
      allowInitialJ: false,
    });
    const lastPattern = pickPattern(rng, lastPatternOptions, { allowOnsetlessV: false });
    const lastSyllable = buildSyllableFromPattern(rng, pools, lastPattern, {
      position: 'last',
      nameType: 'first',
      usedDiphthong,
      usedConsonantRCluster,
    });
    syllables.push(lastSyllable);

    return joinSyllablesWithHiatus(syllables, pools);
  }

  function buildMaoAoSurname(rng, positioned) {
    const pools = positioned.pools;
    const firstNameRules = positioned.firstName;
    const syllables = [];
    let usedDiphthong = false;
    let usedConsonantRCluster = false;

    const firstPattern = pickPattern(rng, firstNameRules.first.male.patterns, { allowOnsetlessV: false });
    const firstSyllable = buildSyllableFromPattern(rng, pools, firstPattern, {
      position: 'first',
      nameType: 'last',
      usedDiphthong,
      usedConsonantRCluster,
    });
    syllables.push(firstSyllable);
    usedDiphthong = usedDiphthong || syllableHasDiphthong(firstSyllable, pools);
    usedConsonantRCluster = usedConsonantRCluster || syllableStartsWithConsonantRCluster(firstSyllable, pools);

    const lastPatternOptions = constrainLastPatterns(firstNameRules.last.male.patterns, syllables[0] || '', {
      usedDiphthong,
      allowInitialJ: false,
    });
    const lastPattern = pickPattern(rng, lastPatternOptions, { allowOnsetlessV: false });
    const lastSyllable = buildSyllableFromPattern(rng, pools, lastPattern, {
      position: 'last',
      nameType: 'last',
      usedDiphthong,
      usedConsonantRCluster,
    });
    syllables.push(lastSyllable);

    return joinSyllablesWithHiatus(syllables, pools);
  }

  function hashStringToSeed(text) {
    let h = 2166136261 >>> 0;
    const input = String(text || '');
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function rand() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function formatPatronymicSurname(prefix, fatherFirstName, casing) {
    const formattedFather = applyCasing(fatherFirstName, casing);
    return `${String(prefix || '').toLowerCase()} ${formattedFather}`;
  }

  function weightedPick(rng, entries) {
    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng() * totalWeight;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }
    return entries[entries.length - 1];
  }

  function weightedPickValue(rng, values, weightMap) {
    const entries = values
      .map((value) => ({ value, weight: Number((weightMap || {})[value] ?? 1) }))
      .filter((entry) => entry.weight > 0);
    if (!entries.length) throw new Error('weightedPickValue() received no positive-weight values.');
    return weightedPick(rng, entries).value;
  }

  function getKenkariVowelPool(phonology, opts = {}) {
    const isFinal = !!opts.isFinal;
    const allowMarked = !!opts.allowMarked;
    let pool = phonology.vowels.slice();
    if (!allowMarked) pool = pool.filter((v) => v !== 'ai' && v !== 'ey');
    if (isFinal) {
      return pool
        .filter((v) => v !== 'e')
        .concat((phonology.finalOnlyVowels || []).filter((v) => v !== 'e' && (allowMarked || v !== 'ao')));
    }
    return pool.filter((v) => !(phonology.finalOnlyVowels || []).includes(v));
  }

  function chooseKenkariTemplate(rng, phonology) {
    return weightedPick(rng, phonology.templateWeights).pattern.slice();
  }

  function buildKenkariPhonemeByType(rng, phonology, type, opts = {}) {
    const vowelPool = getKenkariVowelPool(phonology, opts);
    const vowelWeightMap = opts.isFinal ? (phonology.finalVowelWeights || phonology.vowelWeights) : phonology.vowelWeights;
    const vowel = weightedPickValue(rng, vowelPool, vowelWeightMap);
    const position = Number.isFinite(opts.position) ? opts.position : 0;

    if (type === 'V') {
      if (position > 0) throw new Error('Kenkari lone vowels may only appear at the beginning of a name.');
      return vowel;
    }
    if (type === 'CV') {
      const consonantWeightMap = opts.afterGlottal && opts.isFinal
        ? (phonology.postGlottalFinalConsonantWeights || phonology.finalConsonantWeights || phonology.consonantWeights)
        : (opts.isFinal ? (phonology.finalConsonantWeights || phonology.consonantWeights) : phonology.consonantWeights);
      return weightedPickValue(rng, phonology.consonants, consonantWeightMap) + vowel;
    }
    if (type === "'V") return "'" + vowel;

    throw new Error(`Unsupported Kenkari phoneme type: ${type}`);
  }

  function countApostrophes(value) {
    return (String(value || '').match(/'/g) || []).length;
  }

  function countMarkedVowels(value) {
    return (String(value || '').match(/ai|ey|ao/g) || []).length;
  }

  function hasIVowelBeforeAVowel(phonemes) {
    let seenI = false;
    for (const phoneme of phonemes || []) {
      const lower = String(phoneme || '').toLowerCase();
      if (seenI && /a/.test(lower)) return true;
      if (/i/.test(lower)) seenI = true;
    }
    return false;
  }

  function getKenkariGenderConflict(name, gender, phonemes = []) {
    const lower = String(name || '').toLowerCase();
    const firstPhoneme = String(phonemes[0] || '').toLowerCase();
    const firstConsonant = /^[bgkhmnprt]/.test(firstPhoneme) ? firstPhoneme[0] : '';
    if (gender === 'female' && lower.includes('p')) return true;
    if (gender === 'female' && (firstConsonant === 'r' || firstConsonant === 't')) return true;
    if (gender === 'male' && /(?:mi|mey)$/i.test(lower)) return true;
    return false;
  }

  function buildKenkariGivenName(rng, culture, gender) {
    const phonology = culture.kenkariRules.phonology;
    for (let attempt = 1; attempt <= 40; attempt++) {
      const template = chooseKenkariTemplate(rng, phonology);
      const phonemes = [];

      for (let i = 0; i < template.length; i++) {
        const type = template[i];
        const isFinal = i === template.length - 1;
        const usedMarkedEarlier = phonemes.some((p) => /ai|ey|ao/.test(p));
        const previousType = i > 0 ? template[i - 1] : null;
        const allowMarked = isFinal ? (rng() < 0.28) : (!usedMarkedEarlier && rng() < 0.18);
        phonemes.push(buildKenkariPhonemeByType(rng, phonology, type, {
          isFinal,
          allowMarked,
          position: i,
          afterGlottal: previousType === "'V",
        }));
      }

      let name = phonemes.join('');
      name = name.replace(/e(?=')/g, 'ey');
      const validName = (
        phonemes.length >= phonology.minPhonemes
        && phonemes.length <= phonology.maxPhonemes
        && !/e$/i.test(name)
        && countApostrophes(name) <= 1
        && countMarkedVowels(name) <= 1
        && template.every((part, index) => index === 0 || part !== 'V')
        && !/(pey|ora)$/i.test(name)
        && !hasIVowelBeforeAVowel(phonemes)
        && !getKenkariGenderConflict(name, gender, phonemes)
      );
      if (validName) return name;
    }
    throw new Error('Could not generate a Kenkari name within the current template rules.');
  }

  function startsWithSl(name) {
    return String(name || '').toLowerCase().startsWith('sl');
  }

  function endsWithToken(name, token) {
    return String(name || '').toLowerCase().endsWith(String(token || '').toLowerCase());
  }

  function chance(rng, probability) {
    return rng() < probability;
  }

  function buildSlagothimGivenName(rng, culture, gender) {
    const rules = culture.slagothimRules || {};
    for (let attempt = 1; attempt <= 40; attempt++) {
      const useSl = chance(rng, Number(rules.startWithSlChance ?? 0.58));
      const willUseSuffix = useSl ? chance(rng, Number(rules.slNameUsesSuffixChance ?? 0.2)) : true;
      const c1 = useSl ? 'sl' : pickFromRng(rng, rules.firstConsonants || []);
      const v1 = pickFromRng(rng, rules.vowels || []);
      const useMnCluster = chance(rng, Number(rules.mnClusterChance ?? 0.08));
      const c2 = useMnCluster ? rules.rareSecondConsonantCluster : pickFromRng(rng, rules.secondConsonants || []);
      const c2AllowsVowel = c2 === 'ng' || c2 === 'r' || c2 === rules.rareSecondConsonantCluster;
      const c2ForcesVowel = c2 === rules.rareSecondConsonantCluster;
      let v2 = '';
      let ending = '';

      if (willUseSuffix) {
        if (c2ForcesVowel || (c2AllowsVowel && chance(rng, Number(rules.optionalBridgeVowelChance ?? 0.55)))) {
          v2 = pickFromRng(rng, rules.vowels || []);
        }
        ending = gender === 'male' ? rules.maleSuffix : rules.femaleSuffix;
      } else {
        if (!useSl || !c2AllowsVowel) continue;
        v2 = pickFromRng(rng, gender === 'male' ? (rules.maleSlOnlyEndings || []) : (rules.femaleSlOnlyEndings || []));
      }

      const given = (c1 + v1 + c2 + v2 + ending).toLowerCase();
      if (gender === 'male') {
        if (!(startsWithSl(given) || endsWithToken(given, rules.maleSuffix))) continue;
        if (startsWithSl(given) && !endsWithToken(given, rules.maleSuffix) && !/[ou]$/i.test(given)) continue;
      } else {
        if (!(startsWithSl(given) || endsWithToken(given, rules.femaleSuffix))) continue;
        if (startsWithSl(given) && !endsWithToken(given, rules.femaleSuffix) && !/[ai]$/i.test(given)) continue;
      }
      return applyCasing(given, culture.casing);
    }
    throw new Error('Could not generate a Slagothim name within the current phonology rules.');
  }

  function buildEnghShoGivenName(rng, culture, gender) {
    const rules = culture.enghShoRules || {};
    const name = pickFromRng(rng, rules.firstNameWordList);
    const genderRules = rules.firstNameGenderRules || {};
    const replacementKey = gender === 'female' ? 'femaleReplacements' : 'maleReplacements';
    const replacements = genderRules[replacementKey] || {};
    return replacements[name] || name;
  }

  function buildEnghShoSurname(rng, culture) {
    const rules = culture.enghShoRules.surname;
    const syllableCount = rules.syllables.min + Math.floor(rng() * (rules.syllables.max - rules.syllables.min + 1));
    let result = '';
    for (let i = 0; i < syllableCount - 1; i++) {
      const useVowelOnset = i === 0 && rng() < (rules.vowelOnsetChance || 0);
      const onset = useVowelOnset ? '' : weightedPickValue(rng, rules.onsetConsonants, rules.onsetWeights);
      const vowel = weightedPickValue(rng, rules.vowels, rules.vowelWeights);
      const midCoda = rng() < rules.midCodaChance ? pickFromRng(rng, rules.midCodas) : '';
      result += onset + vowel + midCoda;
    }
    const finalOnset = weightedPickValue(rng, rules.onsetConsonants, rules.onsetWeights);
    const finalVowel = weightedPickValue(rng, rules.vowels, rules.vowelWeights);
    const finalPlosive = weightedPickValue(rng, rules.finalPlosives, rules.finalPlosiveWeights);
    result += finalOnset + finalVowel + finalPlosive;
    return result;
  }

  function buildSlagothimSurname(rng, culture) {
    const rules = culture.slagothimRules || {};
    const location = pickFromRng(rng, rules.locations || []);
    return `tley ${titleCase(location)}`;
  }

  function generateCultureNameFromSeed(seedString, gender = 'male', culture, options = {}) {
    const resolvedCulture = culture || {};
    const numericSeed = hashStringToSeed(seedString);
    const rng = mulberry32(numericSeed);
    if (resolvedCulture.enghShoRules) {
      const firstName = buildEnghShoGivenName(rng, resolvedCulture, gender);
      const surname = buildEnghShoSurname(rng, resolvedCulture);
      return [applyCasing(firstName, resolvedCulture.casing), applyCasing(surname, resolvedCulture.casing)].filter(Boolean).join(' ');
    }
    if (resolvedCulture.slagothimRules) {
      const firstName = buildSlagothimGivenName(rng, resolvedCulture, gender);
      const surname = buildSlagothimSurname(rng, resolvedCulture);
      return [firstName, surname].filter(Boolean).join(' ');
    }
    if (resolvedCulture.kenkariRules) {
      const firstName = buildKenkariGivenName(rng, resolvedCulture, gender);
      const providedFather = String(options.fatherFirstName || '').trim();
      const fatherFirstName = providedFather || buildKenkariGivenName(rng, resolvedCulture, 'male');
      const prefix = gender === 'female'
        ? resolvedCulture.kenkariRules.surnameRules?.femalePrefix
        : resolvedCulture.kenkariRules.surnameRules?.malePrefix;
      const surname = formatPatronymicSurname(prefix, fatherFirstName, resolvedCulture.casing);
      return [applyCasing(firstName, resolvedCulture.casing), surname].filter(Boolean).join(' ');
    }

    if (!resolvedCulture.positionedSyllables) {
      throw new Error(`Culture "${resolvedCulture.id || 'unknown'}" has no supported name generation rules.`);
    }

    const surname = buildMaoAoSurname(rng, resolvedCulture.positionedSyllables);
    const forceInitial = resolvedCulture.birthRules?.maleFirstInitialMatchesSurnameFirstLetter && gender === 'male' && surname
      ? String(surname[0]).toLowerCase()
      : undefined;
    const firstName = buildPositionedFirstName(rng, resolvedCulture.positionedSyllables, gender, {
      forceFirstNameInitialLetter: forceInitial,
    });
    return [applyCasing(firstName, resolvedCulture.casing), applyCasing(surname, resolvedCulture.casing)].filter(Boolean).join(' ');
  }

  function resolveConfig() {
    const gameConfig = root.SCRATCHBONES_CONFIG?.game || {};
    const generationConfig = gameConfig.nameGeneration || {};
    const cultures = generationConfig.cultures || {};
    const defaultCultureId = generationConfig.defaultCultureId || 'mao_ao';
    const defaultCulture = cultures[defaultCultureId] || cultures.mao_ao;
    return {
      cultures,
      defaultCultureId,
      defaultCulture,
    };
  }

  function generateIdentityFromSeed(seedString, gender = 'male', cultureId, options = {}) {
    const { cultures, defaultCulture, defaultCultureId } = resolveConfig();
    if (!defaultCulture) throw new Error('Missing scratchbones name generation culture configuration.');
    const selectedCultureId = cultureId || defaultCultureId;
    const selectedCulture = cultures[selectedCultureId] || defaultCulture;
    return generateCultureNameFromSeed(seedString, gender, selectedCulture, options);
  }

  root.SCRATCHBONES_NAME_GENERATOR = {
    hashStringToSeed,
    generateIdentityFromSeed,
  };
})(window);
