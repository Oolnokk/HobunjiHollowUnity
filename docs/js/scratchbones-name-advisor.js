// Exported as window.SCRATCHBONES_NAME_ADVISOR.
// All functions are stateless; callers pass ctx = { gender, married, births }.
(function (global) {
  'use strict';

  // ── Config derivation ─────────────────────────────────────────────────────

  const FALLBACK_SPECIES = {
    kenkari: {
      label: 'Kenkari', slots: ['first', 'father'],
      vowels: ['a', 'e', 'i', 'o', 'u', 'ai', 'ey', 'ao'],
      onsets: ['', 'b', 'g', 'h', 'k', 'm', 'n', 'p', 'r', 't'],
    },
    mao: {
      label: 'Mao-ao', slots: ['first', 'surname'],
      vowels: ['a', 'e', 'i', 'o', 'u', 'ai', 'ao'],
      onsets: ['', 'w', 'r', 't', 'y', 'p', 's', 'f', 'g', 'h', 'j', 'k', 'b', 'n', 'm', 'd', 'sh', 'hy', 'br', 'dr', 'fr', 'gr', 'pr', 'sr', 'shr', 'tr'],
      codas: ['', 'n', 'ng', 'r'],
    },
    slagothim: {
      label: 'Slagothim', slots: ['given', 'surname'],
      vowels: new Set(['a', 'e', 'i', 'o', 'u']),
      locations: ['Ikinga', 'Bahangi', 'Hatonga', 'Rahingi', "B'bonga", 'Niringi', 'Ununga', 'Gorungi'],
      firstConsonants: ['b', 'g', 'n', 'p', 't', 'd', 'k', 'm', 'sl', 'shr', 'tr', 'gr', 'br', 'gl'],
      secondConsonants: ['b', 'g', 'p', 't', 'd', 'k', 'r', 'n', 'ng'],
      maleSuffix: 'mir', femaleSuffix: 'mira', startWithSlChance: 0.58,
    },
    engh: {
      label: 'Engh-sho', slots: ['first', 'surname'],
      firstNames: ["acorn","ael","aestel","amber","amethyst","awl","bar","barb","bead","bean","bell","beryl","billet","bit","blade","bladelet","blank","block","bodkin","bone","borer","boss","brad","brooch","buckle","bud","burin","burr","button","cake","carnelian","catch","catchplate","chalcedony","chape","chisel","chip","clasp","coil","coin","comb","cone","core","counter","cramp","crucible","crystal","cube","cup","cupel","cylinder","die","disc","dowel","drop","dyse","earring","emerald","eyelet","farthing","ferrule","file","firestone","flan","flint","fork","garnet","gem","gim","gimstan","gouge","grain","graver","hasp","hinge","hobnail","hone","hook","hring","husk","hwirfel","ingot","jasper","jewel","kernel","key","knife","knob","knucklebone","lamp","leaf","link","lock","lodestone","loop","matrix","mirror","mount","naegl","nail","needle","nut","obol","onyx","opal","peg","pendant","pening","penny","pin","pinhead","pip","pit","plaque","plug","pod","point","preon","probe","punch","quartz","reed","rind","ring","rivet","rod","root","roundel","ruby","sapphire","sceat","sceatt","scraper","seed","shell","sherd","shuttle","sliver","socket","spatula","spindle","spinel","spool","spoon","sprig","stalk","stan","stem","sticca","stone","stud","styca","stylus","tablet","tack","tag","tally","terminal","tessera","thimble","thorn","tip","toggle","token","tooth","tube","twig","wedge","weight","whetstone","whorl","wire"],
      maleReplacements: { amber:'gold-resin', amethyst:'purple-stone', barb:'sharp-point', beryl:'green-gem', crystal:'clear-stone', emerald:'green-jewel', jewel:'fine-gem', opal:'milk-gem', ruby:'red-gem', sapphire:'blue-gem' },
      femaleReplacements: { brad:'small-nail', bud:'new-leaf', jasper:'spotted-stone', stan:'grey-stone' },
      surname: {
        onsets: ['', 'n', 'm', 'k', 't', 'p', 'l', 'w', 'y', 'h'],
        vowels: ['a', 'u', 'i'],
        midCodas: ['', 'k', 'n', 'p'],
        finalPlosives: ['k', 'p', 't', 'b', 'd', 'g', 'kk', 'pp', 'tt', 'nk', 'mp', 'nt', 'lk', 'rk'],
      },
    },
  };

  function extractMaoCodas(positioned) {
    const allPatterns = Object.values(positioned.firstName)
      .flatMap(pos => ['male', 'female'].flatMap(g => (pos[g]?.patterns || [])));
    const codas = new Set(['']);
    for (const p of allPatterns) {
      const base = p.replace(/\{[^}]+\}/, '');
      if (base.startsWith('CV') && base.length > 2) codas.add(base.slice(2));
      else if (base.startsWith('V') && base.length > 1) codas.add(base.slice(1));
    }
    return [...codas].sort((a, b) => a.length - b.length);
  }

  function deriveSPECIES(cfg) {
    const c = cfg.game.nameGeneration.cultures;
    const k  = c.kenkari.kenkariRules.phonology;
    const m  = c.mao_ao.positionedSyllables;
    const sl = c.slagothim.slagothimRules;
    const en = c.engh_sho.enghShoRules;
    return {
      kenkari: { label: c.kenkari.displayName, slots: ['first', 'father'],
        vowels: [...k.vowels, ...(k.finalOnlyVowels || [])], onsets: ['', ...k.consonants] },
      mao: { label: c.mao_ao.displayName, slots: ['first', 'surname'],
        vowels: m.pools.vowels, onsets: ['', ...m.pools.consonants, ...m.pools.clusters],
        codas: extractMaoCodas(m) },
      slagothim: { label: c.slagothim.displayName, slots: ['given', 'surname'],
        vowels: new Set(sl.vowels), locations: sl.locations,
        firstConsonants: sl.firstConsonants, secondConsonants: sl.secondConsonants,
        maleSuffix: sl.maleSuffix, femaleSuffix: sl.femaleSuffix, startWithSlChance: sl.startWithSlChance },
      engh: { label: c.engh_sho.displayName, slots: ['first', 'surname'],
        firstNames: en.firstNameWordList,
        maleReplacements: en.firstNameGenderRules.maleReplacements,
        femaleReplacements: en.firstNameGenderRules.femaleReplacements,
        surname: { onsets: ['', ...en.surname.onsetConsonants], vowels: en.surname.vowels,
          midCodas: ['', ...en.surname.midCodas], finalPlosives: en.surname.finalPlosives } },
    };
  }

  let _cachedSpecies = null;
  let _configSource = 'fallback';

  function getSpecies() {
    if (_cachedSpecies) return _cachedSpecies;
    try {
      if (!global.SCRATCHBONES_CONFIG?.game?.nameGeneration?.cultures) throw new Error();
      _cachedSpecies = deriveSPECIES(global.SCRATCHBONES_CONFIG);
      _configSource = 'live';
    } catch (_) {
      _cachedSpecies = FALLBACK_SPECIES;
      _configSource = 'fallback';
    }
    return _cachedSpecies;
  }

  function getConfigSource() { return _configSource; }

  // ── Derived sets (computed lazily from getSpecies()) ─────────────────────

  function kenkariValidChars() {
    const S = getSpecies().kenkari;
    return new Set([...S.onsets.filter(Boolean).flatMap(c => [...c]), ...S.vowels.flatMap(v => [...v]), "'"]);
  }
  function kenkariVowelChars() {
    return new Set(getSpecies().kenkari.vowels.flatMap(v => [...v]));
  }
  function maoValidChars() {
    const S = getSpecies().mao;
    return new Set([...S.onsets.filter(Boolean).flatMap(c => [...c]), ...S.vowels.flatMap(v => [...v])]);
  }
  function maoVowelChars() {
    return new Set(getSpecies().mao.vowels.flatMap(v => [...v]));
  }
  function enghSurnameAllowed() {
    const s = getSpecies().engh.surname;
    return new Set([...s.vowels, ...s.onsets.filter(Boolean), 'b', 'd', 'g', 'r']);
  }

  // ── String helpers ────────────────────────────────────────────────────────

  function esc(s) {
    return String(s || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function tc(s) { s = String(s || ''); return s ? s[0].toUpperCase() + s.slice(1) : ''; }
  function tcAll(s) { return String(s || '').split(' ').map(tc).join(' '); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ── Slot label ────────────────────────────────────────────────────────────

  function slotLabel(sp, slot) {
    if (sp === 'slagothim' && slot === 'surname') return 'Place of Birth';
    return { first: 'First Name', father: "Father's Name", surname: 'Surname', given: 'Given Name' }[slot] || slot;
  }

  // ── Context helpers ───────────────────────────────────────────────────────

  function enghFirstNamesForGender(gender) {
    const s = getSpecies().engh;
    const reps = gender === 'female' ? s.femaleReplacements : s.maleReplacements;
    const seen = new Set(); const out = [];
    for (const raw of s.firstNames) {
      const name = (reps[raw] || raw).toLowerCase();
      if (!seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out;
  }

  function maoFirstOnset(births) {
    const first = (births && births.first) || '';
    return first.match(/^(sh|hy|[wrtypsfghkbnmj])/)?.[1] || '';
  }

  // ── Name display ──────────────────────────────────────────────────────────

  function birthNameParts(sp, births, ctx) {
    const gender = (ctx && ctx.gender) || 'male';
    const married = !!(ctx && ctx.married);
    const b = births || {};
    if (sp === 'kenkari') {
      const pref = gender === 'female' ? 'u' : 'ao';
      return { first: tc(b.first || ''), conn: pref, second: tc(b.father || '') };
    }
    if (sp === 'mao') return { first: tc(b.first || ''), conn: '', second: tc(b.surname || '') };
    if (sp === 'engh') return { first: tcAll(b.first || ''), conn: '', second: tc(b.surname || '') };
    const place = (b.surname || '').replace(/^tley\s*/i, '') || 'Ikinga';
    return { first: tc(b.given || ''), conn: 'tley', second: place };
  }

  function formatFullName(sp, births, ctx) {
    const { first, conn, second } = birthNameParts(sp, births, ctx);
    return [first, conn, second].filter(Boolean).join(' ');
  }

  // ── Validation / segsHtml ─────────────────────────────────────────────────

  function segsHtml(text, validSet, inserts, speciesLabel) {
    const lower = text.toLowerCase();
    let html = '';
    for (const ins of inserts.filter(x => x.at === 'start'))
      html += `<span class="v-ins" title="${esc(ins.msg)}">◇</span>`;
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i];
      const ok = validSet.has(ch) || ch === ' ';
      html += ok
        ? `<span class="v-ok">${esc(ch)}</span>`
        : `<span class="v-bad" title="Not in ${esc(speciesLabel || '')} sounds">${esc(ch)}</span>`;
      for (const ins of inserts.filter(x => x.at === i))
        html += `<span class="v-ins" title="${esc(ins.msg)}">◇</span>`;
    }
    for (const ins of inserts.filter(x => x.at === 'end'))
      html += `<span class="v-ins" title="${esc(ins.msg)}">◇</span>`;
    return html;
  }

  function validateKenkari(text) {
    const lower = text.toLowerCase();
    const vc = kenkariVowelChars();
    const cc = new Set(getSpecies().kenkari.onsets.filter(Boolean).flatMap(c => [...c]));
    const inserts = [], msgs = [];

    // Consecutive vowels need apostrophe
    for (let i = 0; i < lower.length - 1; i++) {
      if (lower[i] === "'") continue;
      if (vc.has(lower[i]) && vc.has(lower[i + 1])) {
        inserts.push({ at: i, msg: 'Apostrophe needed between consecutive vowels' });
        if (!msgs.includes("Add ' between consecutive vowels")) msgs.push("Add ' between consecutive vowels");
      }
    }
    // Consonant clusters — two consonants in a row with no vowel between
    for (let i = 0; i < lower.length - 1; i++) {
      if (lower[i] === "'" || lower[i] === ' ') continue;
      if (cc.has(lower[i]) && cc.has(lower[i + 1])) {
        inserts.push({ at: i, msg: 'Consonant cluster — Kenkari syllables are (C)V only' });
        if (!msgs.some(m => m.includes('cluster'))) msgs.push('No consonant clusters — each consonant must be followed by a vowel');
      }
    }
    // Trailing consonant
    const stripped = lower.replace(/[\s']+$/, '');
    if (stripped && cc.has(stripped[stripped.length - 1])) {
      inserts.push({ at: 'end', msg: 'Kenkari names must end on a vowel' });
      msgs.push('Name must end on a vowel');
    }

    const valid = kenkariValidChars();
    const invalid = new Set([...lower].filter(ch => ch !== ' ' && !valid.has(ch)));
    for (const ch of invalid) msgs.push(`'${ch}' is not a Kenkari sound`);
    return { html: segsHtml(text, valid, inserts, 'Kenkari'), msgs };
  }

  function validateMao(text, slot, ctx) {
    const gender = (ctx && ctx.gender) || 'male';
    const married = !!(ctx && ctx.married);
    const births = (ctx && ctx.births) || {};
    const lower = text.toLowerCase();
    const vc = maoVowelChars();
    const inserts = [], msgs = [];
    if (slot === 'first' && gender === 'female' && !married && lower.length > 0) {
      if (!vc.has(lower[0])) {
        inserts.push({ at: 'start', msg: 'Female Mao-ao first names begin with a vowel' });
        msgs.push('Female first names start with a vowel');
      }
    }
    if (slot === 'surname' && gender === 'male' && lower.length > 0) {
      const expected = maoFirstOnset(births);
      if (expected && !lower.startsWith(expected)) {
        inserts.push({ at: 'start', msg: `Male surname should start with '${expected}' (from first name)` });
        msgs.push(`Surname should start with '${expected}' to match first name initial`);
      }
    }
    const valid = maoValidChars();
    const invalid = new Set([...lower].filter(ch => ch !== ' ' && !valid.has(ch)));
    for (const ch of invalid) msgs.push(`'${ch}' is not a Mao-ao sound`);
    return { html: segsHtml(text, valid, inserts, 'Mao-ao'), msgs };
  }

  function validateSlagothim(text, ctx) {
    const gender = (ctx && ctx.gender) || 'male';
    const lower = text.toLowerCase();
    const allAlpha = new Set('abcdefghijklmnopqrstuvwxyz');
    const msgs = [];
    if (/[bcdfghjklmnpqrstvwxyz]{4,}/.test(lower)) msgs.push('Consonant run too long (max 3 in a row)');
    const suffix = gender === 'female' ? getSpecies().slagothim.femaleSuffix : getSpecies().slagothim.maleSuffix;
    if (lower && !lower.startsWith('sl') && !lower.endsWith(suffix))
      msgs.push(`Name usually starts with 'sl' or ends with '${suffix}'`);
    return { html: segsHtml(text, allAlpha, [], 'Slagothim'), msgs };
  }

  function validateEnghSurname(text) {
    const lower = text.toLowerCase();
    const inserts = [], msgs = [];
    const fp = getSpecies().engh.surname.finalPlosives;
    if (lower && !fp.some(p => lower.endsWith(p))) {
      inserts.push({ at: 'end', msg: 'Clan name must end with a plosive (k, p, t, b, d, g, kk, pp, nk…)' });
      msgs.push('Add a plosive ending: k, p, t, b, d, g, kk, pp, tt, nk, mp, nt, lk, rk');
    }
    const allowed = enghSurnameAllowed();
    const invalid = new Set([...lower].filter(ch => ch !== ' ' && !allowed.has(ch)));
    for (const ch of invalid) msgs.push(`'${ch}' is not in Engh-sho clan name sounds`);
    return { html: segsHtml(text, allowed, inserts, 'Engh-sho'), msgs };
  }

  function validateEnghFirst(text, ctx) {
    const gender = (ctx && ctx.gender) || 'male';
    const raw = String(text || '').toLowerCase().replace(/[^a-z ']/g, '').trim();
    if (!raw) return { html: '', msgs: [] };
    const parts = raw.split(/\s+/);
    const lastWord = parts[parts.length - 1];
    const triggers = new Set(global.SCRATCHBONES_TINY_TRIGGERS || ['tiny', 'miniature']);
    const prefix = parts.slice(0, -1);
    const hasTiny = prefix.some(w => triggers.has(w));
    const handheld = new Set(enghWordPool(gender));
    const sizeable = new Set(global.SCRATCHBONES_SIZEABLE_NOUNS || []);
    const living = new Set(global.SCRATCHBONES_LIVING_NOUNS || []);
    const msgs = [];
    if (lastWord && lastWord.length >= 2) {
      const inBig = sizeable.has(lastWord) || living.has(lastWord);
      if (!handheld.has(lastWord)) {
        if (inBig && !hasTiny) msgs.push(`"${lastWord}" needs "Tiny" or "Miniature" before it`);
        else if (!inBig) msgs.push(`"${lastWord}" is not a known Engh-sho object name`);
      }
    }
    const allAlpha = new Set('abcdefghijklmnopqrstuvwxyz \'');
    return { html: segsHtml(text, allAlpha, [], 'Engh-sho'), msgs };
  }

  function validateSlot(sp, slot, text, ctx) {
    if (!text) return { html: '', msgs: [] };
    if (sp === 'kenkari')                       return validateKenkari(text);
    if (sp === 'mao')                           return validateMao(text, slot, ctx);
    if (sp === 'slagothim' && slot === 'given') return validateSlagothim(text, ctx);
    if (sp === 'engh' && slot === 'surname')    return validateEnghSurname(text);
    if (sp === 'engh' && slot === 'first')      return validateEnghFirst(text, ctx);
    return { html: '', msgs: [] };
  }

  // ── Sound mapping ─────────────────────────────────────────────────────────

  function normalizeIdea(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z']/g, '');
  }
  function expandedIdeaText(t) {
    return normalizeIdea(t)
      .replace(/qu/g,'kw').replace(/x/g,'ks').replace(/ck/g,'k').replace(/ph/g,'f')
      .replace(/tch/g,'ch').replace(/wh/g,'w').replace(/kn/g,'n').replace(/wr/g,'r')
      .replace(/igh/g,'i').replace(/oo/g,'u').replace(/ee/g,'i').replace(/ea/g,'i')
      .replace(/ou/g,'o').replace(/ow/g,'o').replace(/ay/g,'a')
      .replace(/([aeiou])h(?=[bcdfgjklmnpqrstvwxyz]|$)/g,'$1')
      .replace(/([bcdfghjklmnpqrstvwxyz])\1/g,'$1')
      .replace(/([bcdfghjklmnpqrstvwxyz])e$/g,'$1');
  }
  function tokenizeIdeaSounds(text) {
    const raw = expandedIdeaText(text).replace(/'/g, '');
    const tokens = [];
    for (let i = 0; i < raw.length;) {
      const two = raw.slice(i, i + 2);
      if (['sh','ch','th','ng','gh'].includes(two)) { tokens.push(two); i += 2; continue; }
      tokens.push(raw[i]); i++;
    }
    return tokens.filter(Boolean);
  }
  function ideaVowels(text) {
    return tokenizeIdeaSounds(text)
      .filter(t => /^[aeiouy]+$/.test(t))
      .map((c, i) => nearestVowel(c, ['a','i','u','o','e'][i % 5]))
      .filter(Boolean);
  }
  function nearestVowel(ch, fb) {
    ch = String(ch || '').toLowerCase();
    if ('aeiou'.includes(ch)) return ch;
    if (ch === 'y') return 'i';
    return fb || 'a';
  }
  function epentheticVowel(idx, v, allowed) {
    return allowed[(idx + v) % allowed.length];
  }
  function expandTokens(tokens, validOnsets) {
    return tokens.flatMap(t => t.length > 1 && !validOnsets.has(t) ? [...t] : [t]);
  }
  function makeBlock(text) { return { text: String(text).toLowerCase() }; }

  function uniqueOptions(opts) {
    const seen = new Set();
    return opts.filter(o => {
      const k = (o.label || '').toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, 8);
  }

  function mapByTable(token, allowed, table, fb) {
    token = String(token || '').toLowerCase();
    const s = new Set(allowed);
    if (s.has(token)) return token;
    for (const c of (table[token] || [])) { if (s.has(c)) return c; }
    for (const c of (fb[token] || []))    { if (s.has(c)) return c; }
    return allowed[0] || '';
  }

  // ── Kenkari ───────────────────────────────────────────────────────────────

  function mapKenkariConsonant(token, v) {
    const allowed = getSpecies().kenkari.onsets.filter(Boolean);
    // table 0 = closest phonological match (primary suggestion)
    const tables = [
      { ch:['k'],sh:['h'],th:['t'],ng:['n'],gh:['h'],c:['k'],q:['k'],x:['k'],b:['p'],d:['t'],g:['k'],l:['r'],s:['k'],z:['t'],j:['h'],f:['p'],v:['p'],w:['h'],y:['h'] },
      { ch:['k'],sh:['h'],th:['t'],ng:['n'],gh:['g'],c:['k'],q:['k'],x:['h'],b:['p'],d:['t'],g:['k'],l:['n'],s:['k'],z:['h'],j:['k'],f:['h'],v:['p'],w:['m'],y:['n'] },
      { ch:['k'],sh:['h'],th:['t'],ng:['n'],gh:['g'],c:['g','k'],q:['k'],x:['k'],b:['p'],d:['r','t'],g:['g','k'],l:['r'],s:['k'],z:['k'],j:['g','k'],f:['p'],v:['p'],w:['k'],y:['h'] },
    ];
    return mapByTable(token, allowed, tables[v % tables.length], { default: ['h','k','n','m'] }) || ['h','k','n','m'][v % 4];
  }

  function blocksFromSoundInventory(text, mapConsonant, allowedVowels, variant, opts) {
    opts = opts || {};
    const tokens = expandTokens(tokenizeIdeaSounds(text), opts.validOnsets || new Set());
    const vowels = ideaVowels(text);
    const blocks = [];
    let pending = [];
    let vi = 0;
    function flush() {
      while (pending.length) {
        const c = mapConsonant(pending.shift(), variant + blocks.length);
        const v = epentheticVowel(vi++, variant, allowedVowels);
        blocks.push(makeBlock(c + v));
      }
    }
    for (const token of tokens) {
      if (/^[aeiouy]$/.test(token)) {
        const v = nearestVowel(token, allowedVowels[vi % allowedVowels.length] || 'a');
        if (pending.length) {
          while (pending.length > 1) { const c = mapConsonant(pending.shift(), variant + blocks.length); const ev = epentheticVowel(vi++, variant, allowedVowels); blocks.push(makeBlock(c + ev)); }
          const c = mapConsonant(pending.shift(), variant + blocks.length); blocks.push(makeBlock(c + v));
        } else if (opts.allowInitialVowel && blocks.length === 0) {
          blocks.push(makeBlock(v));
        } else if (opts.glottalVowel && blocks.length > 0) {
          blocks.push(makeBlock("'" + v));
        } else {
          blocks.push(makeBlock((opts.defaultOnset || '') + v));
        }
        vi++;
      } else pending.push(token);
    }
    flush();
    if (!blocks.length) { const v = vowels[0] || allowedVowels[variant % allowedVowels.length] || 'a'; blocks.push(makeBlock((opts.defaultOnset || '') + v)); }
    return blocks;
  }

  function kenkariBlocksFromIdea(text, v) {
    v = v || 0;
    const allowed = getSpecies().kenkari.onsets.filter(Boolean);
    const allowedVowels = ['a', 'i', 'u', 'o', 'e'];
    // keep source digraphs (ch, th, gh, ng, ph) intact so mapKenkariConsonant can map them as units
    const expandSet = new Set([...allowed, 'ch', 'th', 'gh', 'ng', 'ph']);
    const tokens = expandTokens(tokenizeIdeaSounds(text), expandSet);
    const ideaVows = ideaVowels(text);
    const blocks = [];
    let pending = [];
    // before any vowel: use input's first vowel; after a vowel: use last seen
    let lastVowel = ideaVows.length > 0 ? nearestVowel(ideaVows[0], allowedVowels[0]) : 'i';
    const defaults = ['h','k','n','m'];

    function mapC(token) { return mapKenkariConsonant(token, v + blocks.length + pending.length); }
    function nearV(raw) { return nearestVowel(raw, allowedVowels[0]); }

    for (const token of tokens) {
      if (/^[aeiouy]$/.test(token)) {
        const mappedV = nearV(token);
        if (pending.length) {
          // mid-word cluster: insert last-seen vowel between stacked consonants
          while (pending.length > 1) blocks.push(makeBlock(mapC(pending.shift()) + lastVowel));
          blocks.push(makeBlock(mapC(pending.shift()) + mappedV));
        } else if (blocks.length === 0 && v % 3 === 1) {
          blocks.push(makeBlock(mappedV));
        } else if (blocks.length > 0) {
          blocks.push(makeBlock("'" + mappedV));
        } else {
          blocks.push(makeBlock(defaults[v % 4] + mappedV));
        }
        lastVowel = mappedV; // update AFTER resolving cluster so epenthesis uses prior vowel
      } else {
        pending.push(token);
      }
    }
    // trailing consonants: mid-cluster ones get lastVowel, final one gets 'u'
    while (pending.length > 1) blocks.push(makeBlock(mapC(pending.shift()) + lastVowel));
    if (pending.length === 1) blocks.push(makeBlock(mapC(pending.shift()) + 'u'));

    if (!blocks.length) {
      blocks.push(makeBlock(defaults[v % 4] + (ideaVows[0] ? nearV(ideaVows[0]) : 'a')));
    }
    // apostrophe before any vowel-initial block after the first
    return blocks.map((b, i) => (i > 0 && /^[aeiou]/.test(b.text)) ? makeBlock("'" + b.text) : b);
  }

  function makeKenkariIdeaOptions(text) {
    const opts = [];
    // Diphthong repair: only when input is already all valid Kenkari chars
    // (user editing a Kenkari name directly, not typing an English idea)
    const validChars = kenkariValidChars();
    const isKenkariText = text.length > 0 && [...text.toLowerCase()].every(c => c === ' ' || validChars.has(c));
    if (isKenkariText) {
      const t = text.toLowerCase();
      // Raw consecutive vowels: offer apostrophe + both drops
      if (/[aeiou][aeiou]/i.test(t)) {
        const withApostrophe = t.replace(/([aeiou])([aeiou])/g, "$1'$2");
        const dropSecond     = t.replace(/([aeiou])([aeiou])/g, '$1');
        const dropFirst      = t.replace(/([aeiou])([aeiou])/g, '$2');
        if (withApostrophe !== t) opts.push({ label: tc(withApostrophe), type: 'text', value: withApostrophe });
        if (dropSecond !== t)     opts.push({ label: tc(dropSecond),     type: 'text', value: dropSecond });
        if (dropFirst !== t)      opts.push({ label: tc(dropFirst),      type: 'text', value: dropFirst });
      }
      // Already-apostrophed pair (V'V): offer both drops as alternatives
      if (/[aeiou]'[aeiou]/i.test(t)) {
        const dropSecond = t.replace(/([aeiou])'([aeiou])/g, '$1');
        const dropFirst  = t.replace(/([aeiou])'([aeiou])/g, '$2');
        if (dropSecond !== t) opts.push({ label: tc(dropSecond), type: 'text', value: dropSecond });
        if (dropFirst !== t)  opts.push({ label: tc(dropFirst),  type: 'text', value: dropFirst });
      }
    }
    for (let i = 0; i < 8; i++) {
      const blocks = kenkariBlocksFromIdea(text, i);
      opts.push({ label: tc(blocks.map(b => b.text).join('').replace(/e(?=')/g, 'ey')), type: 'blocks', blocks });
    }
    return uniqueOptions(opts);
  }

  // ── Mao-ao ────────────────────────────────────────────────────────────────

  function mapMaoOnset(token, v) {
    const allowed = getSpecies().mao.onsets.filter(Boolean);
    const tables = [
      { ch:['sh','k'],sh:['sh'],th:['t'],ng:['n'],gh:['h','g'],c:['k'],q:['k'],x:['sh','k'],d:['t'],l:['r','y'],v:['f','w'],z:['s'] },
      { ch:['k'],sh:['sh'],th:['s','t'],ng:['n'],gh:['g'],c:['k'],q:['k'],x:['s','k'],d:['t'],l:['y','r'],v:['w','f'],z:['s'] },
    ];
    return mapByTable(token, allowed, tables[v % tables.length], { default: ['n','m','k','t','p','sh'] }) || ['n','m','k','t','p','sh'][v % 6];
  }

  function maoBlocksFromIdea(text, slot, v, ctx) {
    const gender = (ctx && ctx.gender) || 'male';
    const married = !!(ctx && ctx.married);
    const births = (ctx && ctx.births) || {};
    const allowed = getSpecies().mao.onsets.filter(Boolean);
    const expandSet = new Set([...allowed, 'ch', 'th', 'gh', 'ng', 'ph']);
    const tokens = expandTokens(tokenizeIdeaSounds(text), expandSet);
    const ideaVows = ideaVowels(text);
    const blocks = [];
    let pending = [];
    let vi = 0;
    // first/last-vowel epenthesis: before any vowel seen use first input vowel
    let lastVowel = ideaVows.length > 0 ? nearestVowel(ideaVows[0], 'a') : 'a';
    function addBlock(onset, vowel, coda) {
      if (slot === 'first' && gender === 'female' && !married && blocks.length === 0) onset = '';
      if (slot === 'surname' && gender === 'male' && blocks.length === 0) onset = maoFirstOnset(births) || onset;
      blocks.push(makeBlock(onset + vowel + (coda || '')));
    }
    for (const token of tokens) {
      if (/^[aeiouy]$/.test(token)) {
        const vow = nearestVowel(token, ['a','e','i','o','u','ai','ao'][vi % 7]);
        if (pending.length) {
          if (v % 2 === 0 && blocks.length > 0) {
            const mc = new Set(getSpecies().mao.codas.filter(Boolean));
            while (pending.length > 1 && mc.has(pending[0])) blocks[blocks.length - 1].text += pending.shift();
          }
          while (pending.length > 1) { addBlock(mapMaoOnset(pending.shift(), v + blocks.length), lastVowel); vi++; }
          addBlock(mapMaoOnset(pending.shift(), v + blocks.length), vow);
        } else if (blocks.length === 0) {
          addBlock(['n','m','k','t','p','w'][0], vow);
        }
        // isolated medial vowel (pending empty, not first): update lastVowel only, no spurious block
        lastVowel = vow;
        vi++;
      } else pending.push(token);
    }
    const validCodas = new Set(getSpecies().mao.codas.filter(Boolean));
    while (pending.length) {
      const c = pending.shift();
      const isLast = pending.length === 0;
      if (isLast && v % 4 !== 0 && validCodas.has(c) && blocks.length > 0) {
        // last consonant is a valid coda: append to last syllable
        blocks[blocks.length - 1].text += c;
      } else if (isLast) {
        // last consonant, invalid as coda: new syllable with 'u'
        addBlock(mapMaoOnset(c, v + blocks.length), 'u'); vi++;
      } else {
        // internal cluster consonant: use last seen vowel, not 'u'
        addBlock(mapMaoOnset(c, v + blocks.length), lastVowel); vi++;
      }
    }
    if (!blocks.length) addBlock(slot === 'first' && gender === 'female' && !married ? '' : 'n', ideaVows[0] || 'a');
    return blocks;
  }

  function makeMaoIdeaOptions(text, slot, ctx) {
    const opts = [];
    for (let i = 0; i < 8; i++) {
      const blocks = maoBlocksFromIdea(text, slot, i, ctx);
      opts.push({ label: tc(blocks.map(b => b.text).join('')), type: 'blocks', blocks });
    }
    return uniqueOptions(opts);
  }

  // ── Engh-sho ──────────────────────────────────────────────────────────────

  function scoreEnghName(name, q) {
    name = String(name || '').toLowerCase(); q = String(q || '').toLowerCase();
    if (!q) return 0; if (name === q) return 100;
    if (name.includes(q)) return 80 - q.length + Math.max(0, 20 - name.length);
    let qi = 0; for (const ch of name) { if (ch === q[qi]) qi++; if (qi >= q.length) break; }
    return qi * 8 - Math.abs(name.length - q.length);
  }

  function enghWordPool(gender) {
    const lore = new Set(enghFirstNamesForGender(gender));
    const dict = global.SCRATCHBONES_ENGLISH_WORDS || [];
    return [...lore, ...dict.filter(w => !lore.has(w))];
  }

  function makeEnghIdeaOptions(text, slot, ctx) {
    const gender = (ctx && ctx.gender) || 'male';
    if (slot === 'first') {
      const raw = String(text || '').toLowerCase().replace(/[^a-z ']/g, '').trim();
      if (!raw) return [];
      const parts = raw.split(/\s+/);
      const fragment = parts[parts.length - 1];
      const prefix = parts.slice(0, -1);
      const prefixStr = prefix.join(' ');
      const triggers = new Set(global.SCRATCHBONES_TINY_TRIGGERS || ['tiny', 'miniature']);
      const hasTiny = prefix.some(w => triggers.has(w));
      const handheld = enghWordPool(gender);
      const handheldSet = new Set(handheld);
      const sizeable = global.SCRATCHBONES_SIZEABLE_NOUNS || [];
      const living = global.SCRATCHBONES_LIVING_NOUNS || [];
      const bigPool = [...sizeable, ...living].filter(w => !handheldSet.has(w));
      const activePool = hasTiny ? [...handheld, ...bigPool] : handheld;
      const opts = [];
      if (fragment) {
        activePool.map(n => ({ n, s: scoreEnghName(n, fragment) }))
          .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8)
          .forEach(x => { const full = prefixStr ? `${prefixStr} ${x.n}` : x.n; opts.push({ label: tcAll(full), type: 'enghFirst', value: full }); });
        if (!hasTiny && fragment.length >= 2) {
          bigPool.map(n => ({ n, s: scoreEnghName(n, fragment) }))
            .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3)
            .forEach(x => {
              const base = prefixStr ? `${prefixStr} ` : '';
              opts.push({ label: tcAll(`${base}tiny ${x.n}`),      type: 'enghFirst', value: `${base}tiny ${x.n}` });
              opts.push({ label: tcAll(`${base}miniature ${x.n}`), type: 'enghFirst', value: `${base}miniature ${x.n}` });
            });
        }
      } else {
        activePool.slice(0, 10).forEach(n => { const full = prefixStr ? `${prefixStr} ${n}` : n; opts.push({ label: tcAll(full), type: 'enghFirst', value: full }); });
      }
      return uniqueOptions(opts).slice(0, 10);
    }
    const opts = [];
    for (let i = 0; i < 8; i++) { const s = enghSurnameFromIdea(text, i); opts.push({ label: tc(s), type: 'enghSurname', value: s }); }
    return uniqueOptions(opts);
  }

  function enghSurnameFromIdea(text, variant) {
    variant = variant || 0;
    const fp = getSpecies().engh.surname.finalPlosives;
    const vowels = getSpecies().engh.surname.vowels;
    const smap = { c:'k', q:'k', x:'k', f:'p', v:'w', j:'y', s:'t', z:'t' };
    const allowed = enghSurnameAllowed();
    const raw = expandedIdeaText(text).replace(/'/g, '');
    const result = raw.split('').map(ch => {
      if (vowels.includes(ch)) return vowels[(vowels.indexOf(ch) + variant) % vowels.length];
      if (allowed.has(ch)) return ch;
      if (smap[ch]) return smap[ch];
      if (ch === 'e') return vowels[variant % vowels.length];
      if (ch === 'o') return vowels[(variant + 1) % vowels.length];
      return '';
    }).filter(Boolean).join('');
    if (!result) return '';
    if (fp.some(p => result.endsWith(p))) return result;
    return result + fp[(variant + result.length) % fp.length];
  }

  // ── Slagothim ─────────────────────────────────────────────────────────────

  function makeSlagothimIdeaOptions(text, slot, ctx) {
    const gender = (ctx && ctx.gender) || 'male';
    if (slot === 'surname') {
      const q = normalizeIdea(text).replace(/'/g, '');
      const locs = getSpecies().slagothim.locations
        .map(loc => ({ loc, score: scoreEnghName(loc.toLowerCase().replace(/[^a-z]/g, ''), q) }))
        .filter(x => x.score > 0).sort((a, b) => b.score - a.score);
      const list = (locs.length ? locs : getSpecies().slagothim.locations.map(loc => ({ loc }))).slice(0, 8);
      return list.map(x => ({ label: `${x.loc}-Doro`, type: 'slagPlace', place: x.loc }));
    }
    const suffix = gender === 'female' ? getSpecies().slagothim.femaleSuffix : getSpecies().slagothim.maleSuffix;
    const clean = expandedIdeaText(text).replace(/'/g, '');
    const repaired = clean.replace(/[bcdfghjklmnpqrstvwxyz]{4,}/g, m => m.slice(0, 2) + 'a' + m.slice(2));
    const base = repaired.replace(/^(sl)+/, '').replace(new RegExp(`${suffix}a?$`), '');
    const starts = base.replace(/^[bcdfghjklmnpqrstvwxyz]+/, '');
    const variants = [base, 'sl' + starts, base + suffix, 'sl' + starts + suffix];
    return uniqueOptions(variants.map(v => ({ label: tc(v), type: 'slagGiven', value: v.toLowerCase() })));
  }

  // ── Main entry ────────────────────────────────────────────────────────────

  function makeIdeaOptions(sp, slot, text, ctx) {
    if (!String(text || '').trim()) return [];
    if (sp === 'kenkari')   return makeKenkariIdeaOptions(text);
    if (sp === 'mao')       return makeMaoIdeaOptions(text, slot, ctx);
    if (sp === 'engh')      return makeEnghIdeaOptions(text, slot, ctx);
    if (sp === 'slagothim') return makeSlagothimIdeaOptions(text, slot, ctx);
    return [];
  }

  // ── Randomizers ───────────────────────────────────────────────────────────

  function randomKenkariName() {
    const s = getSpecies().kenkari;
    const n = 2 + Math.floor(Math.random() * 3);
    const out = [];
    for (let i = 0; i < n; i++) {
      const onset = i === 0 && Math.random() < 0.28 ? '' : pick(s.onsets.filter(o => o));
      const vowel = pick(i === n - 1 ? s.vowels.filter(v => v !== 'e') : s.vowels.filter(v => !['ai','ao'].includes(v)));
      out.push(makeBlock((onset === '' && i > 0 ? "'" : onset) + vowel));
    }
    return out.map(b => b.text).join('');
  }

  function randomMaoName(slot, ctx) {
    const gender = (ctx && ctx.gender) || 'male';
    const married = !!(ctx && ctx.married);
    const births = (ctx && ctx.births) || {};
    const s = getSpecies().mao;
    const count = slot === 'surname' ? 2 : 3;
    let out = '';
    for (let i = 0; i < count; i++) {
      let onset = pick(s.onsets.filter(o => o));
      if (slot === 'first' && i === 0 && gender === 'female' && !married) onset = '';
      if (slot === 'surname' && i === 0 && gender === 'male') onset = maoFirstOnset(births) || onset;
      const vowel = pick(s.vowels);
      const coda = pick(['', '', 'n', 'ng', 'r']);
      out += onset + vowel + coda;
    }
    return out;
  }

  function randomEnghSurname() {
    const s = getSpecies().engh.surname;
    const count = Math.random() < 0.65 ? 2 : 3;
    let out = '';
    for (let i = 0; i < count; i++) {
      const onset = Math.random() < 0.1 ? '' : pick(s.onsets.filter(Boolean));
      const vowel = pick(s.vowels);
      const coda = i === count - 1 ? pick(s.finalPlosives) : (Math.random() < 0.5 ? pick(s.midCodas.filter(Boolean)) : '');
      out += onset + vowel + coda;
    }
    return out;
  }

  function randomSlagGiven(ctx) {
    const gender = (ctx && ctx.gender) || 'male';
    const s = getSpecies().slagothim;
    const vowels = [...s.vowels];
    const suffix = gender === 'female' ? s.femaleSuffix : s.maleSuffix;
    const useSl = Math.random() < (s.startWithSlChance || 0.5);
    let name = (useSl ? 'sl' : pick(s.firstConsonants)) + pick(vowels) + pick(s.secondConsonants);
    if (Math.random() < 0.35) name += pick(vowels);
    name += Math.random() < 0.7 ? suffix : (gender === 'female' ? pick(['a', 'i']) : pick(['o', 'u']));
    return name;
  }

  function randomizeName(sp, ctx) {
    const births = {};
    const gender = (ctx && ctx.gender) || 'male';
    const married = !!(ctx && ctx.married);
    const ctxWithBirths = { gender, married, births };
    if (sp === 'kenkari') {
      births.first = randomKenkariName();
      births.father = randomKenkariName();
    } else if (sp === 'mao') {
      births.first = randomMaoName('first', ctxWithBirths);
      ctxWithBirths.births = births;
      births.surname = randomMaoName('surname', ctxWithBirths);
    } else if (sp === 'engh') {
      births.first = pick(enghFirstNamesForGender(gender));
      births.surname = randomEnghSurname();
    } else if (sp === 'slagothim') {
      births.given = randomSlagGiven(ctxWithBirths);
      births.surname = 'tley ' + pick(getSpecies().slagothim.locations);
    }
    return births;
  }

  // ── Apply option helper ───────────────────────────────────────────────────

  function applyOption(sp, slot, opt, currentBirths) {
    const births = Object.assign({}, currentBirths || {});
    if (opt.type === 'blocks')
      births[slot] = opt.blocks.map(b => b.text).join('');
    else if (opt.type === 'text')
      births[slot] = opt.value;
    else if (opt.type === 'enghFirst' || opt.type === 'enghSurname')
      births[slot] = opt.value;
    else if (opt.type === 'slagPlace')
      births.surname = 'tley ' + opt.place;
    else if (opt.type === 'slagGiven')
      births[slot] = opt.value;
    return births;
  }

  // ── Lobby species key mapping ─────────────────────────────────────────────

  const LOBBY_SP_MAP = {
    'mao-ao': 'mao', 'kenkari': 'kenkari', 'engh-sho': 'engh',
    'slagothim': 'slagothim', 'tletingan': 'slagothim',
  };
  function lobbySpeciesToAdvisorKey(speciesId, speciesData) {
    const parentId = speciesData?.[speciesId]?.parentSpecies || speciesId;
    return LOBBY_SP_MAP[parentId] || LOBBY_SP_MAP[speciesId] || 'mao';
  }

  // ── Export ────────────────────────────────────────────────────────────────

  global.SCRATCHBONES_NAME_ADVISOR = {
    getSpecies, getConfigSource,
    slotLabel, birthNameParts, formatFullName,
    makeIdeaOptions, validateSlot, segsHtml,
    randomizeName, applyOption,
    lobbySpeciesToAdvisorKey,
    tcAll, tc, esc,
  };

})(typeof window !== 'undefined' ? window : this);
