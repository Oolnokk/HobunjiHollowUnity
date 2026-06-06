// Hobunii Hollow — Player character creation onboarding
// Adapted from ScratchbonesGame NPC portrait editor (appearance + collections tabs).
// Fires CustomEvent 'hobunjiPlayerReady' with playerData when the player confirms.
(function () {
  'use strict';

  const STORAGE_KEY = 'hobunjiPlayerProfile';

  // ── Species / cosmetic slot definitions ──────────────────────────────────
  // Adapted from ScratchbonesGame BASE_SPECIES_DATA.
  const SPECIES_DATA = {
    'mao-ao': {
      label: 'Mao-ao', genders: ['male', 'female'],
      male: {
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_smooth_striped',    label: 'Smooth Striped' },
            { id: 'appearance::Mao-ao_M::mao-ao_tuft',              label: 'Tuft' },
            { id: 'appearance::Mao-ao_M::mao-ao_forwardtuft_short', label: 'Forward Tuft (Short)' },
            { id: 'appearance::Mao-ao_M::mao-ao_forwardtuft_long',  label: 'Forward Tuft (Long)' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_splayedknot_medium', label: 'Splayed Knot' },
            { id: 'appearance::Mao-ao_M::mao-ao_long_ponytail',      label: 'Long Ponytail' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_shoulder_length_drape', label: 'Shoulder Drape' },
            { id: 'appearance::Mao-ao_M::mao-ao_braid-R',               label: 'Braid (Right)' },
            { id: 'appearance::Mao-ao_M::mao-ao_braidcluster-R',        label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_braid-L', label: 'Braid (Left)' },
          ]},
          { slot: 'eyes', label: 'Eyes', options: [
            { id: null,  label: 'Default' },
            { id: 'appearance::Mao-ao_M::mao-ao_circled_eyes',   label: 'Circled Eyes' },
            { id: 'appearance::Mao-ao_M::mao-ao_circled_eye_L',  label: 'Circled Eye (L)' },
          ]},
          { slot: 'facialHair', label: 'Facial Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_wildbeard', label: 'Wild Beard' },
          ]},
        ],
        colorOptions: [
          { label: 'Earth',   h: -70,  s: -0.80, v: -0.55 },
          { label: 'Olive',   h: -40,  s: -0.70, v: -0.45 },
          { label: 'Sage',    h:   0,  s: -0.70, v: -0.30 },
          { label: 'Seafoam', h:  30,  s: -0.60, v: -0.15 },
          { label: 'Ash',     h:  10,  s: -0.90, v:  0.25 },
          { label: 'Onyx',    h:   0,  s: -0.90, v: -0.85 },
          { label: 'Brown',   h: -113, s: -0.45, v: -0.45 },
          { label: 'Rust',    h: -143, s: -0.40, v: -0.40 },
          { label: 'Amber',   h: -113, s: -0.35, v: -0.25 },
          { label: 'Ochre',   h:  -83, s: -0.45, v: -0.20 },
          { label: 'Lichen',  h:  -23, s: -0.55, v: -0.25 },
          { label: 'Slate',   h:   77, s: -0.75, v: -0.20 },
        ],
      },
      female: {
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_smooth_striped',    label: 'Smooth Striped' },
            { id: 'appearance::Mao-ao_F::mao-ao_tuft',              label: 'Tuft' },
            { id: 'appearance::Mao-ao_F::mao-ao_forwardtuft_short', label: 'Forward Tuft (Short)' },
            { id: 'appearance::Mao-ao_F::mao-ao_forwardtuft_long',  label: 'Forward Tuft (Long)' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_splayedknot_medium', label: 'Splayed Knot' },
            { id: 'appearance::Mao-ao_F::mao-ao_long_ponytail',      label: 'Long Ponytail' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_shoulder_length_drape', label: 'Shoulder Drape' },
            { id: 'appearance::Mao-ao_F::mao-ao_braid-R',               label: 'Braid (Right)' },
            { id: 'appearance::Mao-ao_F::mao-ao_braidcluster-R',        label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_braid-L', label: 'Braid (Left)' },
          ]},
          { slot: 'eyes', label: 'Eyes', options: [
            { id: null,  label: 'Default' },
            { id: 'appearance::Mao-ao_F::mao-ao_circled_eyes',   label: 'Circled Eyes' },
            { id: 'appearance::Mao-ao_F::mao-ao_circled_eyes_f', label: 'Circled Eyes (F)' },
            { id: 'appearance::Mao-ao_F::mao-ao_circled_eye_L',  label: 'Circled Eye (L)' },
          ]},
        ],
        colorOptions: [
          { label: 'Earth',   h: -70,  s: -0.80, v: -0.55 },
          { label: 'Olive',   h: -40,  s: -0.70, v: -0.45 },
          { label: 'Sage',    h:   0,  s: -0.70, v: -0.30 },
          { label: 'Seafoam', h:  30,  s: -0.60, v: -0.15 },
          { label: 'Ash',     h:  10,  s: -0.90, v:  0.25 },
          { label: 'Onyx',    h:   0,  s: -0.90, v: -0.85 },
          { label: 'Brown',   h: -113, s: -0.45, v: -0.45 },
          { label: 'Rust',    h: -143, s: -0.40, v: -0.40 },
          { label: 'Amber',   h: -113, s: -0.35, v: -0.25 },
          { label: 'Ochre',   h:  -83, s: -0.45, v: -0.20 },
          { label: 'Lichen',  h:  -23, s: -0.55, v: -0.25 },
          { label: 'Slate',   h:   77, s: -0.75, v: -0.20 },
        ],
      },
    },
    'tletingan': {
      label: 'Tletingan', genders: ['male'],
      male: {
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_forwardtuft_short', label: 'Forward Tuft (Short)' },
            { id: 'appearance::Tletingan_M::tl_forwardtuft_long',  label: 'Forward Tuft (Long)' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_longponytail', label: 'Long Ponytail' },
            { id: 'appearance::Tletingan_M::tl_splayedknot',  label: 'Splayed Knot' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_braid-R',        label: 'Braid (Right)' },
            { id: 'appearance::Tletingan_M::tl_braidcluster-R', label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_braid-L', label: 'Braid (Left)' },
          ]},
          { slot: 'facialHair', label: 'Facial Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_wildbeard', label: 'Wild Beard' },
          ]},
        ],
        colorOptions: [
          { label: 'Umber',  h:  -85, s: -0.30, v: -0.40 },
          { label: 'Khaki',  h:  -60, s: -0.20, v: -0.35 },
          { label: 'Olive',  h:  -40, s: -0.10, v: -0.30 },
          { label: 'Forest', h:  -20, s:  0.00, v: -0.20 },
          { label: 'Fern',   h:    0, s:  0.10, v: -0.15 },
          { label: 'Ash',    h:  -80, s: -0.40, v: -0.45 },
          { label: 'Brown',  h: -113, s: -0.30, v: -0.42 },
          { label: 'Rust',   h: -143, s: -0.20, v: -0.35 },
          { label: 'Amber',  h: -113, s: -0.20, v: -0.28 },
          { label: 'Ochre',  h:  -83, s: -0.35, v: -0.20 },
          { label: 'Lichen', h:  -23, s: -0.45, v: -0.25 },
          { label: 'Slate',  h:   77, s: -0.60, v: -0.22 },
        ],
      },
    },
    'kenkari': {
      label: 'Kenkari', genders: ['male', 'female'],
      male: {
        forcedCosmetics: { eyes: 'kenk_eyedisks' },
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_forwardtuft_long', label: 'Forward Tuft (Long)' },
            { id: 'appearance::Kenkari_M::kenk_fowardtuft',       label: 'Forward Tuft' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_splayedknot_high_m', label: 'Splayed Knot (High)' },
            { id: 'appearance::Kenkari_M::kenk_splayedknot_low_m',  label: 'Splayed Knot (Low)' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_braid-R_m',        label: 'Braid (Right)' },
            { id: 'appearance::Kenkari_M::kenk_braidcluster-R_m', label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_braid-L_m', label: 'Braid (Left)' },
          ]},
          { slot: 'facialHair', label: 'Facial Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_wildbeard', label: 'Wild Beard' },
          ]},
        ],
        colorOptions: [
          { label: 'Jade',       h:  -20, s:  0.80, v:  0.00 },
          { label: 'Lime',       h:  -80, s:  0.90, v:  0.00 },
          { label: 'Teal',       h:   40, s:  1.00, v:  0.10 },
          { label: 'Amethyst',   h:  120, s:  0.90, v:  0.00 },
          { label: 'Fuchsia',    h:  160, s:  0.80, v: -0.10 },
          { label: 'Ember',      h: -120, s:  0.80, v: -0.10 },
          { label: 'Chartreuse', h:  -40, s:  0.70, v:  0.10 },
          { label: 'Azure',      h:   60, s:  0.90, v:  0.10 },
          { label: 'Red',        h: -143, s:  1.00, v:  0.00 },
          { label: 'Orange',     h: -113, s:  1.00, v:  0.10 },
          { label: 'Yellow',     h:  -83, s:  1.20, v:  0.25 },
          { label: 'Green',      h:  -23, s:  1.00, v:  0.05 },
        ],
      },
      female: {
        forcedCosmetics: { eyes: 'none' },
        slots: [
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_F::kenk_longponytail_f',     label: 'Long Ponytail' },
            { id: 'appearance::Kenkari_F::kenk_splayedknot_high_f', label: 'Splayed Knot (High)' },
            { id: 'appearance::Kenkari_F::kenk_splayedknot_low_f',  label: 'Splayed Knot (Low)' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_F::kenk_braid-R_f',        label: 'Braid (Right)' },
            { id: 'appearance::Kenkari_F::kenk_braidcluster-R_f', label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_F::kenk_braid-L_f', label: 'Braid (Left)' },
          ]},
        ],
        colorOptions: [
          { label: 'Ember',      h: -115, s:  0.20, v:  0.05 },
          { label: 'Copper',     h: -105, s:  0.25, v:  0.10 },
          { label: 'Gold',       h:  -92, s:  0.40, v:  0.15 },
          { label: 'Honey',      h:  -80, s:  0.45, v:  0.20 },
          { label: 'Yellow',     h:  -75, s:  0.50, v:  0.20 },
          { label: 'Saffron',    h:  -65, s:  0.52, v:  0.15 },
          { label: 'Chartreuse', h:  -53, s:  0.58, v:  0.05 },
          { label: 'Lime',       h:  -42, s:  0.62, v:  0.00 },
          { label: 'Spring',     h:  -32, s:  0.68, v:  0.05 },
          { label: 'Umber',      h: -100, s: -0.30, v: -0.40 },
          { label: 'Ochre',      h:  -80, s: -0.20, v: -0.25 },
          { label: 'Straw',      h:  -65, s: -0.10, v: -0.15 },
        ],
      },
    },
  };

  // Clothing slots for collections tab (mirrors scratchbones shop catalog categories)
  const CLOTHING_SLOTS = [
    { key: 'hat',      label: '🎩 Hat',      category: 'hat' },
    { key: 'hood',     label: '🧣 Hood',     category: 'hood' },
    { key: 'torso',    label: '👘 Torso',    category: 'torso' },
    { key: 'overwear', label: '🧥 Overwear', category: 'overwear' },
  ];

  // ── Module state ──────────────────────────────────────────────────────
  let _state      = null;
  let _cosmetics  = null;
  let _cosLoading = false;
  let _activeTab  = 'appearance';
  let _colorAIdx  = 0;
  let _colorBIdx  = 0;
  let _el         = null;
  let _renderTimer = null;

  // ── Utilities ─────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function deriveCFromA(a) {
    return {
      h: a.h,
      s: Math.max(-1, Math.min(1, a.s + 0.05)),
      v: Math.max(-1, Math.min(1, a.v + 0.18)),
    };
  }

  function closestColorIdx(opts, target) {
    if (!opts?.length || !target) return 0;
    let best = 0, bestD = Infinity;
    opts.forEach((o, i) => {
      const d = Math.abs(o.h - target.h) * 0.5 + Math.abs(o.v - target.v) * 100;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function swatchStyle(h, s, v) {
    const sat = Math.max(0, 1 + (Number(s) || 0));
    const bri = Math.max(0, 1 + (Number(v) || 0));
    return `background:#7dc89a;filter:hue-rotate(${h}deg) saturate(${sat}) brightness(${bri})`;
  }

  // ── Persistence ───────────────────────────────────────────────────────
  function saveProfile(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // ── Default state ─────────────────────────────────────────────────────
  function makeDefaultState(speciesId, gender) {
    speciesId = speciesId || 'mao-ao';
    gender    = gender    || 'male';
    const spec = SPECIES_DATA[speciesId] || SPECIES_DATA['mao-ao'];
    if (!spec.genders.includes(gender)) gender = spec.genders[0];
    const gData = spec[gender];
    const opts  = gData?.colorOptions || [];
    const base  = opts[0] || { h: 0, s: -0.70, v: -0.30 };
    return {
      nickname: '',
      appearance: {
        speciesId,
        gender,
        cosmetics: {},
        bodyColors: {
          A: { h: base.h, s: base.s, v: base.v },
          B: { h: base.h, s: base.s, v: base.v },
          C: deriveCFromA(base),
        },
      },
      equippedCosmetics: [],
      appliedDyes:       {},
    };
  }

  function currentGenderData() {
    return _state ? SPECIES_DATA[_state.appearance.speciesId]?.[_state.appearance.gender] : null;
  }

  // ── Portrait rendering ────────────────────────────────────────────────
  async function ensureCosmetics() {
    if (_cosmetics) return _cosmetics;
    if (_cosLoading) return null;
    _cosLoading = true;
    try {
      if (window.setPortraitAssetBase) window.setPortraitAssetBase('./assets/');
      if (window.loadPortraitCosmetics) _cosmetics = await window.loadPortraitCosmetics('./config/');
    } catch (e) {
      console.warn('[onboarding] cosmetics load failed:', e);
    }
    _cosLoading = false;
    return _cosmetics;
  }

  // Build a portrait profile from current _state using the same approach as
  // the ScratchbonesGame NPC portrait editor's buildPreviewProfile().
  function buildPreviewProfile() {
    const cosm = _cosmetics;
    if (!cosm || !window.getPortraitFighters || !window.randomPortraitProfileSeeded) return null;
    const ap = _state.appearance;
    const { speciesId, gender, cosmetics: saved, bodyColors } = ap;
    const {
      optionCache, hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions,
      eyesOptions, upperFaceOptions, facialHairOptions, hatOptions, hoodOptions,
      torsoPortraitOptions, armPortraitOptions, bodyColorRangesByGender,
      allowedCosmeticsByFighter, cosmeticWeightsByFighter,
      forcedCosmeticsByFighter, conditionalCosmeticsByFighter,
    } = cosm;

    const fighters = window.getPortraitFighters();
    if (!fighters?.length) return null;

    const norm = s => s.replace(/-/g, '_');
    const fighterGender = f => f.gender ?? (f.id === 'M' ? 'male' : f.id === 'F' ? 'female' : null);
    const fighter = fighters.find(f =>
      (f.speciesId === speciesId || f.speciesId === norm(speciesId)) && fighterGender(f) === gender
    ) || fighters[0];
    if (!fighter) return null;

    let rngS = 0x9e3779b9;
    const rng = () => {
      rngS = (Math.imul(rngS ^ (rngS >>> 16), 0x45d9f3b) >>> 0);
      rngS = (Math.imul(rngS ^ (rngS >>> 16), 0x45d9f3b) >>> 0);
      return (rngS >>> 0) / 0x100000000;
    };

    const profile = window.randomPortraitProfileSeeded(
      rng, [fighter],
      hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions,
      eyesOptions, upperFaceOptions, facialHairOptions, bodyColorRangesByGender,
      allowedCosmeticsByFighter, hatOptions, hoodOptions, cosmeticWeightsByFighter,
      torsoPortraitOptions, armPortraitOptions, forcedCosmeticsByFighter, conditionalCosmeticsByFighter
    );
    if (!profile) return null;

    // Apply saved cosmetic selections
    const forced      = forcedCosmeticsByFighter?.[fighter.id] ?? {};
    const forcedSlots = new Set(Object.keys(forced));
    const lookup      = id => id ? (optionCache?.get(id) ?? null) : null;
    for (const [slot, key] of Object.entries({
      hairFront: 'hairFront', hairBack: 'hairBack', hairSide: 'hairSide', hairSideL: 'hairSideL',
      eyes: 'eyes', upperFace: 'upperFace', facialHair: 'facialHair',
    })) {
      if (saved[slot] !== undefined && !forcedSlots.has(slot)) profile[key] = lookup(saved[slot]);
    }
    if (bodyColors) profile.bodyColors = { ...(profile.bodyColors || {}), ...bodyColors };

    // Apply equipped clothing (collections tab)
    const catalog    = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
    const equipped   = _state.equippedCosmetics;
    const none       = { id: 'none', tintSlot: null, layers: [] };
    const resolveVar = (cat, eqId) => {
      if (!eqId) return null;
      const base = catalog.find(i => i.id === eqId);
      if (!base) return eqId;
      const cands = catalog.filter(i =>
        i.category === cat && i.label === base.label &&
        (i.material || null) === (base.material || null) &&
        i.species === speciesId && (!i.gender || i.gender === gender)
      );
      return [eqId, ...cands.map(i => i.id)].find(id => optionCache?.has(id)) ?? eqId;
    };
    const applyEquip = (cat, key, fallback) => {
      const eqId = catalog.find(i => i.category === cat && equipped.includes(i.id))?.id ?? null;
      const rid  = resolveVar(cat, eqId);
      profile[key] = (rid && optionCache?.has(rid)) ? optionCache.get(rid) : (fallback ?? none);
    };
    applyEquip('hat',      'hat',           hatOptions?.[0]);
    applyEquip('hood',     'hood',          hoodOptions?.[0]);
    applyEquip('torso',    'torsoCosmetic', torsoPortraitOptions?.[0]);
    applyEquip('overwear', 'armCosmetic',   armPortraitOptions?.[0]);

    // Collar-locked facial hair constraint (from ScratchbonesGame collections logic)
    const portraitCfg       = window.SCRATCHBONES_CONFIG?.game?.portrait?.cosmetics || {};
    const collaredTag        = portraitCfg.collaredTag;
    const collarLockedIds    = portraitCfg.collarLockedFacialHairIds || portraitCfg.shirtbeardIds || [];
    const hasCollared        = collaredTag
      ? [profile.torsoCosmetic, profile.armCosmetic].some(c => c?.tags?.includes(collaredTag))
      : false;
    if (!hasCollared && collarLockedIds.includes(profile.facialHair?.id)) {
      profile.facialHair = optionCache?.get('none') || none;
    }

    return profile;
  }

  function schedulePreviewRender() {
    if (_renderTimer) return;
    _renderTimer = setTimeout(() => { _renderTimer = null; _doPreviewRender(); }, 80);
  }

  async function _doPreviewRender() {
    const canvas = _el?.querySelector('#ob-portrait-canvas');
    if (!canvas) return;
    if (!_cosmetics) {
      const loaded = await ensureCosmetics();
      if (!loaded) return;
    }
    const profile = buildPreviewProfile();
    if (!profile) return;
    const renderFn = window.renderPortraitProfile || window.renderProfile;
    if (renderFn) {
      try { await renderFn(canvas, profile); } catch(e) { console.warn('[onboarding] render error', e); }
    }
  }

  // ── HTML renderers ────────────────────────────────────────────────────
  function renderAppearanceBody() {
    const ap        = _state.appearance;
    const specData  = SPECIES_DATA[ap.speciesId];
    const gData     = specData?.[ap.gender];
    const colorOpts = gData?.colorOptions || [];

    const speciesBtns = Object.entries(SPECIES_DATA).map(([sid, sd]) =>
      `<button class="ob-sel-btn${ap.speciesId === sid ? ' ob-active' : ''}" data-ob-species="${esc(sid)}">${esc(sd.label)}</button>`
    ).join('');

    const availGenders = specData?.genders || ['male'];
    const genderBtns = ['male', 'female'].map(g => {
      const avail = availGenders.includes(g);
      return `<button class="ob-sel-btn${ap.gender === g ? ' ob-active' : ''}${!avail ? ' ob-disabled' : ''}"
                       data-ob-gender="${g}"${!avail ? ' disabled' : ''}>${g === 'male' ? 'Male' : 'Female'}</button>`;
    }).join('');

    let slotsHtml = '';
    for (const slotDef of (gData?.slots || [])) {
      const cur  = ap.cosmetics[slotDef.slot] || '';
      const opts = slotDef.options.map(o =>
        `<option value="${esc(o.id || '')}"${cur === (o.id || '') ? ' selected' : ''}>${esc(o.label)}</option>`
      ).join('');
      slotsHtml += `<div class="ob-row">
        <label class="ob-row-label">${esc(slotDef.label)}</label>
        <select class="ob-select" data-ob-slot="${slotDef.slot}">${opts}</select>
      </div>`;
    }

    const swatchRow = (opts, selIdx, attr) => opts.map((o, i) =>
      `<button class="ob-swatch${i === selIdx ? ' ob-active' : ''}" ${attr}="${i}"
               style="${swatchStyle(o.h, o.s, o.v)}" title="${esc(o.label)}"></button>`
    ).join('');

    return `
      <div class="ob-col ob-col-left">
        <canvas id="ob-portrait-canvas" class="ob-portrait" width="200" height="200"></canvas>
        <div class="ob-preview-hint">Live preview</div>
      </div>
      <div class="ob-col ob-col-right">
        <div class="ob-section-label">Farmer name</div>
        <input class="ob-input" id="ob-nickname" type="text" maxlength="32"
               value="${esc(_state.nickname || '')}" placeholder="Your name…"
               autocomplete="off" spellcheck="false" />

        <div class="ob-section-label" style="margin-top:12px;">Species</div>
        <div class="ob-group">${speciesBtns}</div>

        <div class="ob-section-label" style="margin-top:10px;">Gender</div>
        <div class="ob-group">${genderBtns}</div>

        <div class="ob-section-label" style="margin-top:10px;">Cosmetics</div>
        <div class="ob-cosmetics">${slotsHtml || '<div class="ob-muted">None available.</div>'}</div>

        <div class="ob-section-label" style="margin-top:10px;">Primary Color</div>
        <div class="ob-swatches">${swatchRow(colorOpts, _colorAIdx, 'data-ob-a')}</div>
        <div class="ob-section-label" style="margin-top:8px;">Secondary Color</div>
        <div class="ob-swatches">${swatchRow(colorOpts, _colorBIdx, 'data-ob-b')}</div>
      </div>`;
  }

  function renderCollectionsBody() {
    const catalog   = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
    const equipped  = _state.equippedCosmetics;
    const ap        = _state.appearance;

    let slotsHtml = '';
    for (const slot of CLOTHING_SLOTS) {
      const byCategory  = catalog.filter(i => i.category === slot.category);
      const equippedId  = catalog.find(i => i.category === slot.category && equipped.includes(i.id))?.id ?? null;
      // Deduplicate by label+material, prefer species/gender match
      const deduped = new Map();
      for (const item of byCategory) {
        const key  = `${item.label}::${item.material || ''}`;
        const prev = deduped.get(key);
        if (!prev) { deduped.set(key, item); continue; }
        const score = x => (x.species === ap.speciesId ? 2 : 0) + (x.gender === ap.gender ? 1 : 0);
        if (score(item) > score(prev) || item.id === equippedId) deduped.set(key, item);
      }
      const items = [...deduped.values()];
      const opts  = [
        `<option value="">None</option>`,
        ...items.map(i => `<option value="${esc(i.id)}"${i.id === equippedId ? ' selected' : ''}>${esc(i.label)}</option>`),
      ].join('');
      slotsHtml += `<div class="ob-row">
        <label class="ob-row-label">${esc(slot.label)}</label>
        <select class="ob-select ob-equip-sel" data-ob-equip-cat="${slot.category}"${!items.length ? ' disabled' : ''}>${opts}</select>
      </div>`;
    }

    return `
      <div class="ob-col ob-col-left">
        <canvas id="ob-portrait-canvas" class="ob-portrait" width="200" height="200"></canvas>
        <div class="ob-preview-hint">Live preview</div>
      </div>
      <div class="ob-col ob-col-right">
        <div class="ob-section-label">Clothing &amp; Equipment</div>
        <div class="ob-cosmetics">
          ${slotsHtml || '<div class="ob-muted">No items in shop catalog.</div>'}
        </div>
      </div>`;
  }

  function renderOverlay() {
    const body = _activeTab === 'appearance' ? renderAppearanceBody() : renderCollectionsBody();
    return `<div class="ob-card">
      <div class="ob-title">🌿 Create Your Farmer</div>
      <div class="ob-tabs">
        <button class="ob-tab${_activeTab === 'appearance'   ? ' ob-active' : ''}" data-ob-tab="appearance">✨ Appearance</button>
        <button class="ob-tab${_activeTab === 'collections'  ? ' ob-active' : ''}" data-ob-tab="collections">🧺 Collections</button>
      </div>
      <div class="ob-two-col">${body}</div>
      <div class="ob-footer">
        <span class="ob-footer-hint">Saved automatically — you can change this later.</span>
        <button class="ob-start-btn" id="ob-start-btn">🌱 Start Farming</button>
      </div>
    </div>`;
  }

  function rerender() {
    if (!_el) return;
    _el.innerHTML = renderOverlay();
    attachListeners();
    schedulePreviewRender();
  }

  // ── Event binding ─────────────────────────────────────────────────────
  function attachListeners() {
    if (!_el) return;

    _el.querySelectorAll('[data-ob-tab]').forEach(btn => btn.addEventListener('click', () => {
      _activeTab = btn.dataset.obTab;
      rerender();
    }));

    _el.querySelectorAll('[data-ob-species]').forEach(btn => btn.addEventListener('click', () => {
      const sid   = btn.dataset.obSpecies;
      const spec  = SPECIES_DATA[sid];
      if (!spec) return;
      const newG  = spec.genders.includes(_state.appearance.gender) ? _state.appearance.gender : spec.genders[0];
      const gData = spec[newG];
      const opts  = gData?.colorOptions || [];
      const base  = opts[0] || { h: 0, s: -0.70, v: -0.30 };
      _state.appearance.speciesId = sid;
      _state.appearance.gender    = newG;
      _state.appearance.cosmetics = {};
      _state.appearance.bodyColors = {
        A: { h: base.h, s: base.s, v: base.v },
        B: { h: base.h, s: base.s, v: base.v },
        C: deriveCFromA(base),
      };
      _colorAIdx = 0; _colorBIdx = 0;
      rerender();
    }));

    _el.querySelectorAll('[data-ob-gender]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const g = btn.dataset.obGender;
      const gData = SPECIES_DATA[_state.appearance.speciesId]?.[g];
      const opts  = gData?.colorOptions || [];
      const base  = opts[0] || { h: 0, s: -0.70, v: -0.30 };
      _state.appearance.gender    = g;
      _state.appearance.cosmetics = {};
      _state.appearance.bodyColors = {
        A: { h: base.h, s: base.s, v: base.v },
        B: { h: base.h, s: base.s, v: base.v },
        C: deriveCFromA(base),
      };
      _colorAIdx = 0; _colorBIdx = 0;
      rerender();
    }));

    _el.querySelectorAll('[data-ob-slot]').forEach(sel => sel.addEventListener('change', () => {
      const slot = sel.dataset.obSlot;
      const val  = sel.value || undefined;
      if (val) { _state.appearance.cosmetics[slot] = val; }
      else     { delete _state.appearance.cosmetics[slot]; }
      schedulePreviewRender();
    }));

    _el.querySelectorAll('[data-ob-a]').forEach(btn => btn.addEventListener('click', () => {
      const i    = parseInt(btn.dataset.obA);
      const opts = currentGenderData()?.colorOptions || [];
      if (!opts[i]) return;
      _colorAIdx = i;
      const c = opts[i];
      _state.appearance.bodyColors.A = { h: c.h, s: c.s, v: c.v };
      _state.appearance.bodyColors.C = deriveCFromA(c);
      _el.querySelectorAll('[data-ob-a]').forEach((b, bi) => b.classList.toggle('ob-active', bi === i));
      schedulePreviewRender();
    }));

    _el.querySelectorAll('[data-ob-b]').forEach(btn => btn.addEventListener('click', () => {
      const i    = parseInt(btn.dataset.obB);
      const opts = currentGenderData()?.colorOptions || [];
      if (!opts[i]) return;
      _colorBIdx = i;
      const c = opts[i];
      _state.appearance.bodyColors.B = { h: c.h, s: c.s, v: c.v };
      _el.querySelectorAll('[data-ob-b]').forEach((b, bi) => b.classList.toggle('ob-active', bi === i));
      schedulePreviewRender();
    }));

    _el.querySelectorAll('.ob-equip-sel').forEach(sel => sel.addEventListener('change', () => {
      const cat     = sel.dataset.obEquipCat;
      const val     = sel.value;
      const catalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
      _state.equippedCosmetics = _state.equippedCosmetics.filter(id => {
        const item = catalog.find(i => i.id === id);
        return item?.category !== cat;
      });
      if (val) _state.equippedCosmetics.push(val);
      schedulePreviewRender();
    }));

    const nicknameEl = _el.querySelector('#ob-nickname');
    if (nicknameEl) nicknameEl.addEventListener('input', () => { _state.nickname = nicknameEl.value; });

    const startBtn = _el.querySelector('#ob-start-btn');
    if (startBtn) startBtn.addEventListener('click', _complete);
  }

  // ── Completion ────────────────────────────────────────────────────────
  function _complete() {
    const playerData = {
      nickname:          (_state.nickname || '').trim() || 'Farmer',
      appearance:        { ..._state.appearance, cosmetics: { ..._state.appearance.cosmetics }, bodyColors: { ..._state.appearance.bodyColors } },
      equippedCosmetics: [..._state.equippedCosmetics],
      appliedDyes:       { ..._state.appliedDyes },
    };
    saveProfile(playerData);
    window.__hobunjiPlayerProfile = playerData;

    if (_el) {
      _el.classList.add('ob-fade-out');
      setTimeout(() => { _el?.remove(); _el = null; }, 420);
    }

    document.dispatchEvent(new CustomEvent('hobunjiPlayerReady', { detail: playerData }));
  }

  // ── Public API ────────────────────────────────────────────────────────
  function init(options) {
    // If there is already a saved profile, skip straight to game
    if (!options?.resetProfile) {
      const saved = loadProfile();
      if (saved) {
        window.__hobunjiPlayerProfile = saved;
        document.dispatchEvent(new CustomEvent('hobunjiPlayerReady', { detail: saved }));
        return;
      }
    }

    _state     = makeDefaultState('mao-ao', 'male');
    _activeTab = 'appearance';
    _colorAIdx = 0;
    _colorBIdx = 0;

    _el = document.createElement('div');
    _el.id = 'ob-overlay';
    document.body.appendChild(_el);
    rerender();

    ensureCosmetics().then(() => schedulePreviewRender());
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    window.__hobunjiPlayerProfile = null;
  }

  window.HobunjiOnboarding = { init, reset, loadProfile };
})();
