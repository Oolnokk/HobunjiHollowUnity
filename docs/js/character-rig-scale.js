// Uniform species+gender character-rig scale.
//
// This is intentionally a PARENT scale, not another portrait/body scale. It
// uniformly scales the already-assembled visual rig around its floor-relative
// origin so portrait, hands, feet, shoulders, posterior, perches, offsets and
// their authored spacing all stay aligned. Local authored coordinates are never
// rewritten by this module.
(() => {
  'use strict';

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 4;
  const EPSILON = 1e-9;

  const finite = (value, fallback = 1) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const clampScale = value => Math.max(MIN_SCALE, Math.min(MAX_SCALE, finite(value, 1)));
  const normalizeKey = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const normalizeGender = value => {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  };
  const transformSpecies = value => {
    if (typeof window.hobunjiTransformSpeciesId === 'function') return window.hobunjiTransformSpeciesId(value);
    const species = normalizeKey(value);
    if (species === 'rakakoan') return 'kenkari';
    if (species === 'ghoul') return 'mao-ao';
    return species;
  };

  function profileFor(species, gender) {
    const transformed = transformSpecies(species);
    const normalizedGender = normalizeGender(gender);
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    return characters[`${transformed}::${normalizedGender}`]
      || characters[`${normalizeKey(species)}::${normalizedGender}`]
      || null;
  }

  function scaleFor(species, gender, profile = null) {
    return clampScale((profile || profileFor(species, gender))?.anatomy?.rigScale ?? 1);
  }

  function vectorNear(a, b) {
    return !!a && !!b
      && Math.abs(Number(a.x) - Number(b.x)) <= EPSILON
      && Math.abs(Number(a.y) - Number(b.y)) <= EPSILON
      && Math.abs(Number(a.z) - Number(b.z)) <= EPSILON;
  }

  // Compose with other parent-scale systems without baking our factor into their
  // baseline. If another system (notably Animation Author's live Body scale
  // preview) has recomputed parent.scale since our last application, the current
  // value is treated as the new unscaled assembled-rig scale before rigScale is
  // reapplied exactly once.
  function applyToParent(parent, species, gender, explicitScale = null) {
    if (!parent?.isObject3D || !parent.scale) return false;
    const next = clampScale(explicitScale ?? scaleFor(species, gender));
    parent.userData ||= {};
    const previous = parent.userData.hobunjiCharacterRigScaleState || null;
    const current = { x: Number(parent.scale.x), y: Number(parent.scale.y), z: Number(parent.scale.z) };
    let base = current;
    if (previous && vectorNear(current, previous.output)) {
      const divisor = clampScale(previous.factor);
      base = { x: current.x / divisor, y: current.y / divisor, z: current.z / divisor };
    }
    const output = { x: base.x * next, y: base.y * next, z: base.z * next };
    parent.scale.set(output.x, output.y, output.z);
    parent.userData.hobunjiCharacterRigScaleState = {
      factor: next,
      base,
      output,
      groundRelative: true,
      coordinateSpace: 'character-floor-parent',
    };
    parent.updateMatrix?.();
    parent.updateMatrixWorld?.(true);
    return true;
  }

  function clearFromParent(parent) {
    const state = parent?.userData?.hobunjiCharacterRigScaleState;
    if (!parent?.scale || !state) return false;
    parent.scale.set(state.base.x, state.base.y, state.base.z);
    delete parent.userData.hobunjiCharacterRigScaleState;
    parent.updateMatrix?.();
    parent.updateMatrixWorld?.(true);
    return true;
  }

  const api = Object.freeze({
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    profileFor,
    scaleFor,
    applyToParent,
    clearFromParent,
  });
  window.HobunjiCharacterRigScale = api;

  function installHandParentRuntime() {
    const hands = window.ProceduralHandAttachments;
    if (!hands?.attach) return false;
    if (hands.attach.__hobunjiCharacterRigScaleWrapped) return true;
    const base = hands.attach.bind(hands);
    const wrapped = function characterRigScaleHandAttach(THREE, parent, options = {}) {
      applyToParent(parent, options.speciesId || options.profile?.speciesId || options.profile?.species, options.gender || options.profile?.gender);
      return base(THREE, parent, options);
    };
    Object.assign(wrapped, base);
    wrapped.__hobunjiCharacterRigScaleWrapped = true;
    hands.attach = wrapped;
    return true;
  }

  function installAnimationAuthor() {
    if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return true;
    const required = ['configuredCharacterAnatomyV1530', 'renderCharacterAnatomySectionV1530', 'bindCharacterAnatomyControlsV1530', 'attachmentRigProfileForActor'];
    if (!required.every(name => typeof window[name] === 'function')) return false;
    if (window.__hobunjiCharacterRigScaleAuthorInstalled) return true;

    const baseConfiguredAnatomy = window.configuredCharacterAnatomyV1530;
    window.configuredCharacterAnatomyV1530 = function characterRigScaleConfiguredAnatomy(species, gender, source = {}) {
      const result = baseConfiguredAnatomy.apply(this, arguments);
      const existing = source?.anatomy?.rigScale
        ?? window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${transformSpecies(species)}::${normalizeGender(gender)}`]?.anatomy?.rigScale
        ?? 1;
      result.rigScale = clampScale(existing);
      return result;
    };

    const baseRememberScale = window.rememberRigActorBodyScaleV1531;
    if (typeof baseRememberScale === 'function') {
      window.rememberRigActorBodyScaleV1531 = function rememberBodyScaleWithoutWholeRigFactor(actor) {
        const result = baseRememberScale.apply(this, arguments);
        const state = actor?.visualOffset?.userData?.hobunjiCharacterRigScaleState;
        const saved = actor?.rigBodyVisualOffsetBaseScaleV1535;
        if (state && saved) {
          const factor = clampScale(state.factor);
          saved.multiplyScalar(1 / factor);
        }
        return result;
      };
    }

    const baseBodyPreview = window.previewRigActorBodyScaleV1531;
    if (typeof baseBodyPreview === 'function') {
      window.previewRigActorBodyScaleV1531 = function bodyPreviewWithWholeRigScale(actor) {
        const result = baseBodyPreview.apply(this, arguments);
        const profile = actor ? window.attachmentRigProfileForActor(actor) : null;
        if (actor?.visualOffset && profile) applyToParent(actor.visualOffset, profile.species, profile.gender, profile.anatomy?.rigScale);
        return result;
      };
    }

    const baseRender = window.renderCharacterAnatomySectionV1530;
    window.renderCharacterAnatomySectionV1530 = function renderCharacterAnatomyWithWholeRigScale(actor) {
      let html = baseRender.apply(this, arguments);
      const profile = actor ? window.attachmentRigProfileForActor(actor) : null;
      const rigScale = scaleFor(profile?.species || actor?.source?.species, profile?.gender || actor?.source?.gender, profile);
      const field = `<div class="maaField"><label for="maaWholeRigScale">Whole rig scale (%)</label><input id="maaWholeRigScale" type="number" min="10" max="400" step="2.5" value="${(rigScale * 100).toFixed(1)}"></div>`;
      const marker = '<div class="maaField"><label for="maaArmLengthOffset">';
      html = html.includes(marker) ? html.replace(marker, `${field}${marker}`) : html;
      html = html.replace(
        'Body scale previews immediately and rebuilds the full anatomy when released.',
        'Body scale changes portrait anatomy. Whole rig scale uniformly scales the assembled character around ground Y=0 without rewriting any internal coordinates. Body scale previews immediately and rebuilds the full anatomy when released.',
      );
      return html;
    };

    const baseBind = window.bindCharacterAnatomyControlsV1530;
    window.bindCharacterAnatomyControlsV1530 = function bindCharacterAnatomyWithWholeRigScale(actor) {
      const result = baseBind.apply(this, arguments);
      const input = document.getElementById('maaWholeRigScale');
      if (!input || input.dataset.hobunjiRigScaleBound === '1') return result;
      input.dataset.hobunjiRigScaleBound = '1';
      const applyInput = () => {
        const profile = window.attachmentRigProfileForActor(actor);
        if (!profile) return;
        profile.anatomy ||= {};
        profile.anatomy.rigScale = clampScale(Number(input.value) / 100);
        applyToParent(actor.visualOffset, profile.species || actor.source?.species, profile.gender || actor.source?.gender, profile.anatomy.rigScale);
        try { window.publishCharacterHandShouldersV1525?.(actor, profile); } catch (_) {}
        window.ProceduralHandFrameDriver?.syncNow?.();
        window.renderAttachmentRigInspector?.();
      };
      input.addEventListener('input', applyInput);
      input.addEventListener('change', applyInput);
      return result;
    };

    const baseSerialize = window.serializeAttachmentRigLibrary;
    if (typeof baseSerialize === 'function' && !baseSerialize.__hobunjiWholeRigScaleExportWrapped) {
      const wrappedSerialize = function serializeWholeRigScale() {
        const data = baseSerialize.apply(this, arguments);
        data.rigScaleSemantics = {
          profileField: 'characters.<species>::<gender>.anatomy.rigScale',
          default: 1,
          pivot: 'character floor origin (Y=0)',
          behavior: 'uniform parent scale after portrait/body assembly; local anchor/hand/foot coordinates remain unchanged',
          runtime: true,
        };
        return data;
      };
      wrappedSerialize.__hobunjiWholeRigScaleExportWrapped = true;
      window.serializeAttachmentRigLibrary = wrappedSerialize;
    }

    // Existing selected actors may predate this wrapper. Apply the persisted value
    // once without requiring a rebuild.
    const selected = window.selectedAnimationActor?.();
    if (selected?.source?.type === 'npc') {
      const profile = window.attachmentRigProfileForActor(selected);
      applyToParent(selected.visualOffset, profile?.species, profile?.gender, profile?.anatomy?.rigScale);
    }

    window.__hobunjiCharacterRigScaleAuthorInstalled = true;
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.wholeRigScale = 'ground-relative runtime/editor parent scale installed';
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    const handReady = installHandParentRuntime();
    const authorReady = installAnimationAuthor();
    if ((handReady && authorReady) || ++attempts >= 600) clearInterval(timer);
  }, 50);
  installHandParentRuntime();
  installAnimationAuthor();
})();
