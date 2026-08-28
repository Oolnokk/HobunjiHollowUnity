(() => {
  'use strict';

  // Livestock genetics & breeding — ported from the "Creature Pattern, Base
  // Recolor & Breeding Lab" prototype: each livestock genotype holds one
  // named fur color per permanent anatomical region (Uumkao'ii: fur +
  // plates, both always visible — unlike other species' optional pattern
  // layers). Breeding blends parent colors per region with a small mutation
  // chance; sell value rewards fur/plate color contrast. The same genotype
  // feeds Farm-tab valuation, breeding, and the masked texture compositor
  // (see js/creature-genetics-render.js, this module's rendering sibling),
  // keeping the displayed coat and stored genes in sync.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/mount-system.js and
  // js/fishing-minigame.js — unlike most of those, this module is almost
  // entirely pure data/color math (no THREE.js, no DOM), so its only real
  // dependency is CREATURE_DB (for each species' label/defaultSizeClass)
  // and the shared clamp() helper.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // `weight` skews which colors actually turn up on an animal — real
  // wildlife/livestock coats are overwhelmingly gray/brown/tan, with
  // orange an occasional accent and true red rare, so a flat uniform
  // pick over this list (the previous behavior) way overrepresented
  // the 4 genuinely red entries relative to how often real coats look
  // that way. Weight is a relative share within _pickWeightedFurEntry's
  // cumulative draw, not a percentage — gray/brown/tan sit at 4, orange
  // at 2, red at 1, which nets out to roughly gray/brown/tan ~87%,
  // orange ~9%, red ~4% of picks given how many entries land in each
  // bucket (see _pickWeightedFurEntry below).
  const LIVESTOCK_FUR_PALETTES = window.SCRATCHBONES_CONFIG?.game?.creatureGenetics?.palettes || {};
  const LIVESTOCK_FUR_PALETTE = LIVESTOCK_FUR_PALETTES.default || [];
  function _livestockPalette(kind) {
    return LIVESTOCK_FUR_PALETTES[kind] || LIVESTOCK_FUR_PALETTE;
  }
  // Cumulative-weight draw over LIVESTOCK_FUR_PALETTE (or a filtered
  // subset, e.g. mutateFurColor excluding the current color) — every
  // random fur-color pick in the game goes through this instead of a
  // flat array-index pick, so the gray/brown/tan-common, orange-
  // occasional, red-rare distribution described above actually holds.
  function _pickWeightedFurEntry(entries = LIVESTOCK_FUR_PALETTE) {
    const total = entries.reduce((sum, e) => sum + (e.weight || 1), 0);
    let roll = Math.random() * total;
    for (const entry of entries) {
      roll -= (entry.weight || 1);
      if (roll < 0) return entry;
    }
    return entries[entries.length - 1];
  }

  function _furHexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function _furRgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; }
    return [h, max === 0 ? 0 : d / max, max];
  }
  function _furHsvToRgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  function _furNormalizeHex(s) { const m = String(s).trim().match(/^#?([0-9a-f]{6})$/i); return m ? '#' + m[1].toLowerCase() : null; }
  function _furPaletteEntry(color, kind) {
    const palette = _livestockPalette(kind);
    const normalized = _furNormalizeHex(color) || palette[0].hex;
    const exact = Object.values(LIVESTOCK_FUR_PALETTES).flat().find(x => x.hex.toLowerCase() === normalized);
    if (exact) return exact;
    const [h, s] = _furRgbToHsv(..._furHexToRgb(normalized));
    let best = palette[0], score = Infinity;
    for (const entry of palette) {
      const [eh, es] = _furRgbToHsv(..._furHexToRgb(entry.hex));
      let dh = Math.abs(h - eh); dh = Math.min(dh, 1 - dh);
      const d = dh * dh * 2.5 + (s - es) * (s - es);
      if (d < score) { score = d; best = entry; }
    }
    return best;
  }
  function _furPaletteColor(color, kind) { return _furPaletteEntry(color, kind).hex; }
  function _furPaletteName(color) { return _furPaletteEntry(color).name; }
  function randomFurColor(kind) { return _pickWeightedFurEntry(_livestockPalette(kind)).hex; }

  function blendFurHex(colorA, colorB, kind) {
    const ha = _furRgbToHsv(..._furHexToRgb(_furPaletteColor(colorA, kind))), hb = _furRgbToHsv(..._furHexToRgb(_furPaletteColor(colorB, kind)));
    let dh = hb[0] - ha[0]; if (dh > 0.5) dh -= 1; if (dh < -0.5) dh += 1;
    const h = (ha[0] + dh * 0.5 + 1) % 1, s = (ha[1] + hb[1]) / 2, v = 0.72;
    const [r, g, b] = _furHsvToRgb(h, s, v);
    return _furPaletteColor('#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join(''), kind);
  }
  function mutateFurColor(hex, kind) {
    const palette = _livestockPalette(kind);
    const current = _furPaletteEntry(hex, kind), choices = palette.filter(x => x.id !== current.id);
    return _pickWeightedFurEntry(choices).hex;
  }

  // Perceptual color contrast (CIE Lab deltaE76), used to reward
  // striking fur/plate combinations in sell value — same math as the
  // HTML prototype's "color strikingness" meter.
  function _furSrgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function _furRgbToLab(r, g, b) {
    r = _furSrgbToLinear(r); g = _furSrgbToLinear(g); b = _furSrgbToLinear(b);
    const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047,
          y = r * 0.2126729 + g * 0.7151522 + b * 0.072175,
          z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
    const e = 216 / 24389, k = 24389 / 27, f = t => t > e ? Math.cbrt(t) : (k * t + 16) / 116;
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function _furDeltaE76(colorA, colorB) {
    const a = _furRgbToLab(..._furHexToRgb(_furPaletteColor(colorA))), b = _furRgbToLab(..._furHexToRgb(_furPaletteColor(colorB)));
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  const LIVESTOCK_SELL_RULES = { baseValue: 100, uumPatternBonus: 175, contrastScaleDeltaE: 65 };
  function _furColorContrastScore(colorA, colorB) {
    const delta = _furDeltaE76(colorA, colorB);
    return { deltaE: delta, score: deps.clamp(Math.round(delta / LIVESTOCK_SELL_RULES.contrastScaleDeltaE * 100), 0, 100) };
  }
  function sellTierFor(amount) {
    if (amount >= 600) return 'Exceptional';
    if (amount >= 450) return 'Rare';
    if (amount >= 300) return 'Striking';
    if (amount >= 180) return 'Distinctive';
    return 'Common';
  }

  // Reads CREATURE_DB's own label instead of duplicating a second,
  // separate name list here that has to be updated by hand every time a
  // new livestock species ships — falls back to a capitalized kind (or
  // 'Livestock') only for a kind CREATURE_DB doesn't even know about.
  function defaultLivestockName(kind) {
    return deps.CREATURE_DB[kind]?.label || (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Livestock');
  }

  // Optional pattern layers per species — the HTML lab's Dabinggi-hound
  // and Gar-wolf "layers" (mitts/spectacles/stripes, colorpoint/foxtail/
  // mitts respectively). Order matters: it's the draw/composite order
  // (see composeGenotypeFrame in creature-genetics-render.js).
  const LIVESTOCK_PATTERN_DEFS = {
    'gar-wolf': ['colorpoint', 'foxtail', 'mitts'],
    'dabinggi-hound': ['mitts', 'spectacles', 'stripes'],
    grehlr: ['mitts', 'spectacles'],
    drenkirra: ['bodystripes', 'spectacles'],
  };
  // CREATURE_DB variants that reuse a pattern-species' sprite/pattern
  // assets under a different creatureKey (different stats/label, same
  // art) — used to resolve which CreatureGeneticsRender.SPECIES entry
  // a given creature's genotype should render against. Without this,
  // gar-wolf-alpha and gar-wolf-den-mother genotypes never render:
  // CreatureGeneticsRender.SPECIES only has a "gar-wolf" key.
  const GENOTYPE_SPECIES_ALIAS = {
    'gar-wolf-alpha': 'gar-wolf',
    'gar-wolf-den-mother': 'gar-wolf',
    'uumkaoii-wild': 'uumkaoii',
    'uumkaoii-wild-den-mother': 'uumkaoii',
    'grehlr-den-mother': 'grehlr',
    'drenkirra-den-mother': 'drenkirra',
  };
  // Picks two fur colors that read as visually distinct — same rejection-
  // sample loop as the HTML lab's pickTwoFurColors().
  function pickTwoLivestockFurColors(kind) {
    const palette = _livestockPalette(kind);
    let a = _pickWeightedFurEntry(palette), b = a;
    for (let i = 0; i < 40; i++) {
      b = _pickWeightedFurEntry(palette);
      const [ah, as] = _furRgbToHsv(..._furHexToRgb(a.hex)), [bh, bs] = _furRgbToHsv(..._furHexToRgb(b.hex));
      let dh = Math.abs(ah - bh); dh = Math.min(dh, 1 - dh);
      if (a.id !== b.id && (dh > 0.045 || Math.abs(as - bs) > 0.18)) break;
    }
    if (a.id === b.id) b = palette[(palette.indexOf(a) + Math.max(1, Math.floor(palette.length / 2))) % palette.length];
    return [a, b];
  }

  // Species whose genotype is two ALWAYS-present colored regions (e.g.
  // Uumkao'ii's fur+plates) rather than a base color plus N optional
  // pattern layers (LIVESTOCK_PATTERN_DEFS' gar-wolf/dabinggi-hound
  // shape). makeDefaultGenotype/sellValueFor/crossOffspring all branch
  // on this shape — checked by membership here, not a hardcoded
  // `kind === 'uumkaoii'` at each site, so a second dual-region species
  // is a one-line addition instead of a hunt through 3 functions.
  const DUAL_REGION_GENOTYPE_KINDS = new Set(['uumkaoii']);

  // A creature's Size (small/medium/large, carried on genotype.sizeClass)
  // gates which one of the personal stable's three equip slots it's
  // eligible for — see renderStablePanel/syncCompanionFromWhistle. Each
  // stable-able species has a default Size (CREATURE_DB[kind].defaultSizeClass);
  // breeding can rarely mutate an individual's Size a step away from
  // whichever parent it inherited from (see crossOffspring), which is how
  // any species can eventually turn up as any role given enough luck.
  const CREATURE_SIZE_CLASSES = ['small', 'medium', 'large'];
  const CREATURE_SIZE_ROLE = { small: 'shoulderPet', medium: 'companion', large: 'mount' };
  const CREATURE_SIZE_LABEL = { small: 'Small', medium: 'Medium', large: 'Large' }; // Used by Farm/Stable trait cards.
  const CREATURE_ROLE_LABEL = { shoulderPet: 'Shoulder pet', companion: 'Companion', mount: 'Mount' }; // Used beside Size in trait cards.
  function normalizeCreatureSizeClass(value) {
    return CREATURE_SIZE_CLASSES.includes(value) ? value : 'medium';
  }
  function creatureSizeClass(kind, genotype) {
    const fallbackSize = deps.CREATURE_DB[kind]?.defaultSizeClass || 'medium'; // Used for legacy/no-genotype creatures.
    return normalizeCreatureSizeClass(genotype?.sizeClass || fallbackSize);
  }
  function creatureSizeScale(kind, genotypeOrSizeClass) {
    const sizeClass = typeof genotypeOrSizeClass === 'string'
      ? normalizeCreatureSizeClass(genotypeOrSizeClass)
      : creatureSizeClass(kind, genotypeOrSizeClass); // Selects the authored class used by renderer/anchors.
    const profileKind = GENOTYPE_SPECIES_ALIAS[kind] || kind; // Reuses base-species rig data for variant creature keys.
    const authored = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[profileKind]?.sizeScales?.[sizeClass]; // Canonical Animation Author export.
    const x = Number(authored?.x); // Applied to the creature plane's local width.
    const y = Number(authored?.y); // Applied to the creature plane's local height and ground lift.
    return {
      sizeClass,
      x: Number.isFinite(x) && x > 0 ? x : 1,
      y: Number.isFinite(y) && y > 0 ? y : 1,
    };
  }
  function applyCreatureBillboardScale(group, sizeScale, heightMultiplier = 1) {
    if (!group?.scale?.set) return false;
    const visibleWidthScale = Number(sizeScale?.x); // Used on group Z because each animal plane is rotated ±90° inside the group.
    const visibleHeightScale = Number(sizeScale?.y); // Used on group Y and optionally multiplied by an attack squash.
    const resolvedHeightMultiplier = Number(heightMultiplier); // Used to preserve temporary pounce/burrow squash independently from genotype size.
    group.scale.set(
      1,
      (Number.isFinite(visibleHeightScale) && visibleHeightScale > 0 ? visibleHeightScale : 1) * (Number.isFinite(resolvedHeightMultiplier) ? Math.max(0, resolvedHeightMultiplier) : 1),
      Number.isFinite(visibleWidthScale) && visibleWidthScale > 0 ? visibleWidthScale : 1,
    );
    return true;
  }
  // Subtle idle breathing — a small extra Y-scale multiplier layered on
  // top of genotype size/attack squash (see applyCreatureBillboardScale's
  // heightMultiplier param), one continuous sine per creature instance so
  // every animal reads as alive even standing perfectly still. Phase is
  // randomized once per avatarRef (not per kind/species) so a pack of the
  // same creature doesn't all breathe in lockstep.
  const BREATH_PERIOD_MS = 2600; // One full inhale-exhale cycle.
  const BREATH_AMPLITUDE = 0.018; // ~1.8% peak height change — readable without looking like a squash/stretch animation.
  function creatureBreathScaleY(avatarRef, nowMs) {
    if (!avatarRef) return 1;
    if (!Number.isFinite(avatarRef._breathPhase)) avatarRef._breathPhase = Math.random() * Math.PI * 2;
    const t = Number.isFinite(nowMs) ? nowMs : performance.now();
    return 1 + Math.sin((t / BREATH_PERIOD_MS) * Math.PI * 2 + avatarRef._breathPhase) * BREATH_AMPLITUDE;
  }

  function creatureSizeTrait(kind, genotype) {
    const sizeScale = creatureSizeScale(kind, genotype); // Supplies UI labels and the same percentages used in-world.
    const defaultSizeClass = normalizeCreatureSizeClass(deps.CREATURE_DB[kind]?.defaultSizeClass || 'medium'); // Flags inherited non-default sizes.
    const role = CREATURE_SIZE_ROLE[sizeScale.sizeClass]; // Maps the class to its stable equipment slot.
    return {
      ...sizeScale,
      label: CREATURE_SIZE_LABEL[sizeScale.sizeClass],
      role,
      roleLabel: CREATURE_ROLE_LABEL[role],
      isNonDefault: sizeScale.sizeClass !== defaultSizeClass,
      defaultSizeClass,
    };
  }
  function _traitLabel(id) {
    const overrides = { bodystripes: 'Body stripes', colorpoint: 'Colorpoint', foxtail: 'Fox tail' }; // Keeps compact genetic IDs readable in the UI.
    return overrides[id] || String(id || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/^./, char => char.toUpperCase());
  }
  function genotypeTraits(kind, genotype) {
    const colors = []; // Rendered as named color chips in Farm and Stable.
    const patterns = []; // Rendered as visible-pattern or carrier chips in Farm and Stable.
    if (genotype?.fur || genotype?.plates) {
      for (const id of ['fur', 'plates']) {
        const layer = genotype?.[id]; // Supplies one always-visible dual-region color.
        if (layer?.color) colors.push({ id, label: _traitLabel(id), color: layer.color, colorName: _furPaletteName(layer.color) });
      }
    } else if (genotype?.base) {
      colors.push({ id: 'base', label: 'Base coat', color: genotype.base.color, colorName: _furPaletteName(genotype.base.color) });
      for (const id of LIVESTOCK_PATTERN_DEFS[kind] || []) {
        const layer = genotype?.[id] || {}; // Supplies expressed/carried allele details for one authored mask.
        const copies = deps.clamp(Number(layer.copies) || 0, 0, 2); // Displayed as the inherited allele count.
        const inheritance = layer.inheritance || 'dominant'; // Displayed so breeding implications are visible.
        const enabled = !!layer.enabled && copies > 0; // Separates visible traits from hidden carriers.
        const carrier = !enabled && (layer.carrier || (inheritance === 'recessive' && copies === 1)); // Surfaces hidden recessive traits.
        if (!enabled && !carrier) continue;
        patterns.push({
          id,
          label: _traitLabel(id),
          color: layer.color || genotype.base.color,
          colorName: _furPaletteName(layer.color || genotype.base.color),
          copies,
          inheritance,
          enabled,
          carrier,
        });
      }
    }
    return { size: creatureSizeTrait(kind, genotype), colors, patterns };
  }
  function stableEntryRole(entry) {
    return CREATURE_SIZE_ROLE[creatureSizeClass(entry?.kind, entry?.genotype)];
  }
  // Steps a Size one notch up or down with no wraparound. Endpoint classes
  // always step inward so a successful rare mutation can never silently
  // resolve back to the parent's existing class.
  function mutateSizeClassStep(sizeClass) {
    const idx = CREATURE_SIZE_CLASSES.indexOf(normalizeCreatureSizeClass(sizeClass));
    const dir = idx === 0 ? 1 : idx === CREATURE_SIZE_CLASSES.length - 1 ? -1 : (Math.random() < 0.5 ? -1 : 1); // Endpoint mutations always change class.
    return CREATURE_SIZE_CLASSES[idx + dir];
  }
  // Offspring Size: inherited from a randomly-chosen parent (falling back
  // to the species default for a parent with no sizeClass on record, e.g.
  // a pre-Size save), with the same flat LIVESTOCK_MUTATION_CHANCE roll
  // crossOffspring's coat genes use to instead step it by one.
  function inheritedSizeClass(genotypeA, genotypeB, kind, mutationChance = LIVESTOCK_MUTATION_CHANCE) {
    const fallback = deps.CREATURE_DB[kind]?.defaultSizeClass || 'medium';
    const parentSize = Math.random() < 0.5
      ? normalizeCreatureSizeClass(genotypeA?.sizeClass || fallback)
      : normalizeCreatureSizeClass(genotypeB?.sizeClass || fallback);
    return Math.random() < mutationChance ? mutateSizeClassStep(parentSize) : parentSize;
  }

  // Fresh (non-bred) livestock gets two independently random fur colors —
  // mirrors the HTML tool's randomizeSpecimen(). Uumkao'ii's fur+plates
  // are both permanent (copies:2, dominant). Gar-wolf/Dabinggi-hound get
  // one base fur color plus a shared pattern color applied to 0-3
  // randomly-chosen optional pattern layers (copies:1, dominant) — the
  // exact same odds used for wild-den pack genotypes (see
  // spawnPackAtDen/pickDenGenotype), so a farm-bought crate and a wild
  // pack member are statistically the same roll. Palette selection is
  // species-aware: Drenkirra use the tropical palette configured in
  // scratchbones-config.js through creation, breeding, and rendering.
  function makeDefaultGenotype(kind) {
    // Fresh/wild specimens always roll their species' default Size — the
    // rare mutation only ever applies on breeding (see crossOffspring).
    const sizeClass = deps.CREATURE_DB[kind]?.defaultSizeClass || 'medium';
    if (DUAL_REGION_GENOTYPE_KINDS.has(kind)) {
      return {
        fur:    { color: randomFurColor(kind), copies: 2, inheritance: 'dominant' },
        plates: { color: randomFurColor(kind), copies: 2, inheritance: 'dominant' },
        sizeClass,
      };
    }
    const patterns = LIVESTOCK_PATTERN_DEFS[kind];
    if (patterns) {
      const [first, second] = pickTwoLivestockFurColors(kind);
      // Each pattern layer gets an independently configured chance of showing
      // up (rather than rolling "how many, then which") — with 3 patterns
      // that's ~70% odds of at least one being visible per specimen,
      // instead of leaving a pack looking plain too often.
      const genotype = { base: { color: first.hex, copies: 2, inheritance: 'dominant' } };
      const geneticsCfg = window.SCRATCHBONES_CONFIG?.game?.creatureGenetics || {};
      for (const id of patterns) {
        const configuredChance = geneticsCfg.patternChances?.[kind]?.[id];
        const chance = Number.isFinite(Number(configuredChance))
          ? Number(configuredChance)
          : Number.isFinite(Number(geneticsCfg.defaultPatternChance))
            ? Number(geneticsCfg.defaultPatternChance)
            : (1 / 3);
        const enabled = Math.random() < chance;
        genotype[id] = { color: second.hex, copies: enabled ? 1 : 0, inheritance: 'dominant', enabled };
      }
      genotype.sizeClass = sizeClass;
      const enabledIds = patterns.filter(id => genotype[id].enabled);
      window.__farmLog?.(`[genotype] makeDefaultGenotype(${kind}): base=${first.name}(${first.hex}) pattern=${second.name}(${second.hex}) enabled=[${enabledIds.join(',') || 'none'}]`, 'wildlife');
      return genotype;
    }
    // null, not {} — an empty object is still truthy, and every caller
    // (makeCreatureEntity's opts.genotype check, updateCreatureAnimFrame's
    // genotypeKind resolution) treats "has a genotype" as "try to render
    // it", which for a species with no gene system at all (uumkaoii-wild,
    // the den-mother variants, ...) meant composeFrame got called every
    // tick forever, always failing (no SPECIES config), never caching,
    // never giving up — exactly the infinite-retry log spam a real
    // report caught. null reads as "no genotype" everywhere downstream.
    return null;
  }

  // Sell value from color contrast + pattern complexity — generalizes
  // the HTML's sellValueFor to any species: Uumkao'ii's two permanent
  // regions collapse to a flat bonus (as before); pattern-layer species
  // get a per-enabled-pattern bonus (HTML's patternBonuses table) plus
  // base-vs-pattern-color contrast.
  const LIVESTOCK_PATTERN_BONUSES = [0, 70, 175, 315];
  function sellValueFor(genotype, kind = 'uumkaoii') {
    if (DUAL_REGION_GENOTYPE_KINDS.has(kind) || (!LIVESTOCK_PATTERN_DEFS[kind] && genotype?.fur)) {
      const fur = genotype?.fur, plates = genotype?.plates;
      if (!fur?.color || !plates?.color) {
        return { amount: LIVESTOCK_SELL_RULES.baseValue, tier: 'Common', contrastScore: 0, comparison: 'Plain specimen' };
      }
      const contrast = _furColorContrastScore(fur.color, plates.color);
      const contrastBonus = Math.round(contrast.score * 1.8); // (.9 + .45 × 2 fixed patterns), per the HTML formula
      const amount = LIVESTOCK_SELL_RULES.baseValue + LIVESTOCK_SELL_RULES.uumPatternBonus + contrastBonus;
      return {
        amount, contrastScore: contrast.score, contrastBonus,
        tier: sellTierFor(amount),
        comparison: `${_furPaletteName(fur.color)} fur vs. ${_furPaletteName(plates.color)} plates`,
      };
    }
    const patterns = LIVESTOCK_PATTERN_DEFS[kind];
    if (!patterns) return { amount: LIVESTOCK_SELL_RULES.baseValue, tier: 'Common', contrastScore: 0, comparison: 'Plain specimen' };
    const baseColor = genotype?.base?.color;
    const enabledIds = patterns.filter(id => genotype?.[id]?.enabled && genotype[id]?.copies > 0);
    if (!baseColor || !enabledIds.length) {
      return { amount: LIVESTOCK_SELL_RULES.baseValue, tier: 'Common', contrastScore: 0, comparison: baseColor ? `Plain ${_furPaletteName(baseColor)} coat` : 'Plain specimen' };
    }
    const patternColor = genotype[enabledIds[0]].color;
    const contrast = _furColorContrastScore(baseColor, patternColor);
    const contrastBonus = Math.round(contrast.score * (0.9 + 0.45 * enabledIds.length));
    const patternBonus = LIVESTOCK_PATTERN_BONUSES[Math.min(enabledIds.length, LIVESTOCK_PATTERN_BONUSES.length - 1)];
    const amount = LIVESTOCK_SELL_RULES.baseValue + patternBonus + contrastBonus;
    return {
      amount, contrastScore: contrast.score, contrastBonus,
      tier: sellTierFor(amount),
      comparison: `${_furPaletteName(baseColor)} coat with ${enabledIds.length} pattern${enabledIds.length === 1 ? '' : 's'} in ${_furPaletteName(patternColor)}`,
    };
  }

  // Breeding — the HTML's two offspring paths generalized: Uumkao'ii's
  // permanent dual-region blend (unchanged), and a Mendelian pattern-
  // layer path for gar-wolf/dabinggi-hound (each parent contributes 0-1
  // allele per pattern based on its own copies/2 odds; dominant/
  // recessive/codominant expression + a flat de-novo mutation chance —
  // same math as the lab's generateOffspring()).
  const LIVESTOCK_MUTATION_CHANCE = 0.05;
  function _livestockAlleleContribution(layer) {
    const copies = deps.clamp(Number(layer?.copies) || 0, 0, 2);
    return Math.random() < copies / 2 ? { color: layer.color } : null;
  }
  // mutationChance overrides the flat LIVESTOCK_MUTATION_CHANCE de-novo-
  // trait roll used throughout this function (rarer colors, new pattern
  // layers, a size-class step) — callers with a notion of parent quality
  // (see farm-animals.js's tickBreeding, which scales this with the
  // parents' average heart level) can raise the odds of a rarer offspring
  // without duplicating this function's own trait math.
  function crossOffspring(genotypeA, genotypeB, kind = 'uumkaoii', mutationChance = LIVESTOCK_MUTATION_CHANCE) {
    if (DUAL_REGION_GENOTYPE_KINDS.has(kind)) {
      const child = {};
      for (const layerId of ['fur', 'plates']) {
        const la = genotypeA?.[layerId] || { color: randomFurColor(kind) };
        const lb = genotypeB?.[layerId] || { color: randomFurColor(kind) };
        let color = blendFurHex(la.color, lb.color, kind);
        if (Math.random() < mutationChance) color = mutateFurColor(color, kind);
        child[layerId] = { color, copies: 2, inheritance: 'dominant' };
      }
      child.sizeClass = inheritedSizeClass(genotypeA, genotypeB, kind, mutationChance);
      return child;
    }
    const patterns = LIVESTOCK_PATTERN_DEFS[kind];
    if (!patterns) return makeDefaultGenotype(kind);
    const child = {};
    const baseA = genotypeA?.base || { color: randomFurColor(kind) }, baseB = genotypeB?.base || { color: randomFurColor(kind) };
    let baseColor = blendFurHex(baseA.color, baseB.color, kind);
    if (Math.random() < mutationChance) baseColor = mutateFurColor(baseColor, kind);
    child.base = { color: baseColor, copies: 2, inheritance: 'dominant' };
    for (const id of patterns) {
      const la = genotypeA?.[id] || { copies: 0, color: randomFurColor(kind), inheritance: 'dominant' };
      const lb = genotypeB?.[id] || { copies: 0, color: randomFurColor(kind), inheritance: 'dominant' };
      const alleleA = _livestockAlleleContribution(la), alleleB = _livestockAlleleContribution(lb);
      let copies = (alleleA ? 1 : 0) + (alleleB ? 1 : 0), mutated = false;
      if (copies === 0 && Math.random() < mutationChance) { copies = 1; mutated = true; }
      const inheritance = (la.copies ? la.inheritance : lb.copies ? lb.inheritance : la.inheritance) || 'dominant';
      const enabled = inheritance === 'recessive' ? copies === 2 : copies >= 1;
      let color = alleleA && alleleB ? blendFurHex(alleleA.color, alleleB.color, kind) : (alleleA?.color || alleleB?.color || randomFurColor(kind));
      if (mutated) color = mutateFurColor(color, kind);
      child[id] = { color, copies, inheritance, enabled, carrier: inheritance === 'recessive' && copies === 1 };
    }
    child.sizeClass = inheritedSizeClass(genotypeA, genotypeB, kind, mutationChance);
    const childEnabledIds = patterns.filter(id => child[id].enabled);
    window.__farmLog?.(`[genotype] crossOffspring(${kind}): base=${_furPaletteName(child.base.color)} enabled=[${childEnabledIds.join(',') || 'none'}]`, 'wildlife');
    return child;
  }

  window.CreatureGenetics = {
    init,
    defaultLivestockName,
    makeDefaultGenotype,
    sellValueFor,
    crossOffspring,
    stableEntryRole,
    creatureSizeClass,
    creatureSizeScale,
    applyCreatureBillboardScale,
    creatureBreathScaleY,
    creatureSizeTrait,
    genotypeTraits,
    paletteName: _furPaletteName,
    PATTERN_DEFS: LIVESTOCK_PATTERN_DEFS,
    SPECIES_ALIAS: GENOTYPE_SPECIES_ALIAS,
    MUTATION_CHANCE: LIVESTOCK_MUTATION_CHANCE,
  };
})();
