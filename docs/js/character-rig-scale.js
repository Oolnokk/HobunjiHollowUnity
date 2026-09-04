// Character-rig scale: independent body width/height, plus a head scale
// that stays visually undistorted no matter what the body axes are doing.
//
// Body scale is intentionally a PARENT scale, not another portrait/body scale.
// It uniformly-per-axis scales the already-assembled visual rig around its
// floor-relative origin so portrait, hands, feet, shoulders, posterior,
// perches, offsets and their authored spacing all stay aligned relative to
// each other. Local authored coordinates are never rewritten by this module.
//
// Head scale is different: it's compensated at the neck rig bone (the same
// skinned-plane neck joint built for head-turn/breathing — see neckRig in
// png-plane-avatar.js) so that whatever non-uniform x/y the body ends up
// with, the head/head-cosmetics/expressions painted in that bone's weighted
// region keep the aspect ratio they were authored at. Avatars with no neck
// rig (most world creatures/NPCs) simply have no head to protect and are
// unaffected.
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

  function defaultScaleFor(species, gender) {
    const transformed = transformSpecies(species); // Used so Rakakoan/Ghoul inherit their transform-equivalent Kenkari/Mao-ao authored defaults.
    const normalizedGender = normalizeGender(gender);
    const configured = window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(transformed, normalizedGender); // Preferred canonical default source loaded by attachment-rig bootstrap.
    if (configured && Number.isFinite(Number(configured.x)) && Number(configured.x) > 0) {
      return { x: clampScale(configured.x), y: clampScale(configured.y), head: clampScale(configured.head) };
    }
    const legacy = Number(window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS?.[`${transformed}::${normalizedGender}`]?.x
      ?? window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS?.[`${transformed}::${normalizedGender}`]);
    const uniform = clampScale(Number.isFinite(legacy) && legacy > 0 ? legacy : 1);
    return { x: uniform, y: uniform, head: uniform };
  }

  function profileFor(species, gender) {
    const transformed = transformSpecies(species);
    const normalizedGender = normalizeGender(gender);
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    return characters[`${transformed}::${normalizedGender}`]
      || characters[`${normalizeKey(species)}::${normalizedGender}`]
      || null;
  }

  // Reads x/y/head from the profile's authored fields, falling back to a
  // still-present legacy single `rigScale` number (pre-split saves/exports —
  // treated as uniform on every axis, matching old behavior exactly), then
  // to the authored per-species/gender defaults.
  function scaleFor(species, gender, profile = null) {
    const rec = profile || profileFor(species, gender);
    const anatomy = rec?.anatomy || {};
    const defaults = defaultScaleFor(species, gender);
    const legacy = Number(anatomy.rigScale);
    const hasLegacy = Number.isFinite(legacy) && legacy > 0;
    const x = Number(anatomy.rigScaleX);
    const y = Number(anatomy.rigScaleY);
    const head = Number(anatomy.headScale);
    return {
      x: clampScale(Number.isFinite(x) && x > 0 ? x : (hasLegacy ? legacy : defaults.x)),
      y: clampScale(Number.isFinite(y) && y > 0 ? y : (hasLegacy ? legacy : defaults.y)),
      head: clampScale(Number.isFinite(head) && head > 0 ? head : (hasLegacy ? legacy : defaults.head)),
    };
  }

  function installProfileDefaults() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Live shared rig library consumed by game hands/feet and the Animation Author comparison.
    if (!characters) return false;
    let installed = 0; // Reported in mobile diagnostics so a stale/cached build cannot silently fall back to 1.0.
    for (const [key, profile] of Object.entries(characters)) {
      if (!profile) continue;
      const [keySpecies, keyGender] = key.split('::');
      profile.anatomy ||= {};
      const resolved = scaleFor(profile.species || keySpecies, profile.gender || keyGender, profile);
      profile.anatomy.rigScaleX ??= resolved.x;
      profile.anatomy.rigScaleY ??= resolved.y;
      profile.anatomy.headScale ??= resolved.head;
      if (Number.isFinite(Number(profile.anatomy.rigScaleX))) installed += 1;
    }
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.characterRigScaleDefaults = installed;
    return true;
  }

  function vectorNear(a, b) {
    return !!a && !!b
      && Math.abs(Number(a.x) - Number(b.x)) <= EPSILON
      && Math.abs(Number(a.y) - Number(b.y)) <= EPSILON
      && Math.abs(Number(a.z) - Number(b.z)) <= EPSILON;
  }

  // Accepts either a plain number (legacy callers — uniform on x/y, head
  // resolves normally) or a { x, y, head } object where any field may be
  // omitted to fall back to the resolved default/profile value.
  function normalizeExplicitScale(explicitScale, fallback) {
    if (explicitScale == null) return fallback;
    if (typeof explicitScale === 'number') {
      const uniform = clampScale(explicitScale);
      return { x: uniform, y: uniform, head: fallback.head };
    }
    const x = Number(explicitScale.x), y = Number(explicitScale.y), head = Number(explicitScale.head);
    return {
      x: Number.isFinite(x) && x > 0 ? clampScale(x) : fallback.x,
      y: Number.isFinite(y) && y > 0 ? clampScale(y) : fallback.y,
      head: Number.isFinite(head) && head > 0 ? clampScale(head) : fallback.head,
    };
  }

  // Finds the neck-rig-bearing node (see png-plane-avatar.js's
  // buildSkinnedSinglePlaneAssembly) within or at `root` itself. The
  // avatarRoot carrying userData.neckRig is commonly root itself, a direct
  // child (the real game hooks in one level above it — see
  // installHandParentRuntime below), or nested deeper (editor previews) —
  // checked in that cheap-to-expensive order.
  function findNeckRig(root) {
    if (!root) return null;
    if (root.userData?.neckRig?.available) return root.userData.neckRig;
    for (const child of root.children || []) {
      if (child?.userData?.neckRig?.available) return child.userData.neckRig;
    }
    let found = null;
    root.traverse?.(node => {
      if (!found && node?.userData?.neckRig?.available) found = node.userData.neckRig;
    });
    return found;
  }

  // Sets the neck bone's own local scale so the head-weighted region of the
  // skinned plane ends up at `headScale` in world space regardless of the
  // non-uniform x/y `bodyScale` it inherits from its parent chain — i.e. the
  // head is compensated back to looking proportionally correct, then scaled
  // by its own independent factor.
  function applyHeadCompensation(root, species, gender, headScaleOverride = null, bodyScaleOverride = null) {
    const rig = findNeckRig(root);
    if (!rig?.neckJoint?.scale) return false;
    const resolved = scaleFor(species, gender);
    const body = bodyScaleOverride || resolved;
    const bx = clampScale(body.x), by = clampScale(body.y);
    const headNumber = Number(headScaleOverride);
    const head = clampScale(Number.isFinite(headNumber) && headNumber > 0 ? headNumber : resolved.head);
    rig.neckJoint.scale.set(bx > 0 ? head / bx : head, by > 0 ? head / by : head, 1);
    rig.neckJoint.updateMatrix?.();
    return true;
  }

  function applyToParent(parent, species, gender, explicitScale = null) {
    if (!parent?.isObject3D || !parent.scale) return false;
    const resolved = normalizeExplicitScale(explicitScale, scaleFor(species, gender));
    const next = { x: clampScale(resolved.x), y: clampScale(resolved.y) };
    parent.userData ||= {};
    const previous = parent.userData.hobunjiCharacterRigScaleState || null;
    const current = { x: Number(parent.scale.x), y: Number(parent.scale.y), z: Number(parent.scale.z) };
    let base = current;
    if (previous && vectorNear(current, previous.output)) {
      const divisorX = clampScale(previous.factor?.x ?? previous.factor);
      const divisorY = clampScale(previous.factor?.y ?? previous.factor);
      base = { x: current.x / divisorX, y: current.y / divisorY, z: current.z / divisorX };
    }
    const output = { x: base.x * next.x, y: base.y * next.y, z: base.z * next.x }; // Depth (z) tracks width — these are camera-facing planes with no independently authored depth.
    parent.scale.set(output.x, output.y, output.z);
    parent.userData.hobunjiCharacterRigScaleState = {
      factor: next,
      base,
      output,
      species: transformSpecies(species),
      gender: normalizeGender(gender),
      groundRelative: true,
      coordinateSpace: 'character-floor-parent',
    };
    parent.updateMatrix?.();
    parent.updateMatrixWorld?.(true);
    applyHeadCompensation(parent, species, gender, resolved.head, next);
    return true;
  }

  function clearFromParent(parent) {
    const state = parent?.userData?.hobunjiCharacterRigScaleState;
    if (!parent?.scale || !state) return false;
    parent.scale.set(state.base.x, state.base.y, state.base.z);
    delete parent.userData.hobunjiCharacterRigScaleState;
    parent.updateMatrix?.();
    parent.updateMatrixWorld?.(true);
    const rig = findNeckRig(parent);
    if (rig?.neckJoint?.scale) { rig.neckJoint.scale.set(1, 1, 1); rig.neckJoint.updateMatrix?.(); }
    return true;
  }

  const api = Object.freeze({
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    defaultScaleFor,
    profileFor,
    scaleFor,
    applyToParent,
    applyHeadCompensation,
    clearFromParent,
    installProfileDefaults,
  });
  window.HobunjiCharacterRigScale = api;

  function installHandParentRuntime() {
    const hands = window.ProceduralHandAttachments;
    if (!hands?.attach) return false;
    if (hands.attach.__hobunjiCharacterRigScaleWrapped) return true;
    const base = hands.attach.bind(hands);
    const wrapped = function characterRigScaleHandAttach(THREE, parent, options = {}) {
      // The direct-hand runtime deliberately attaches to the same floor-relative
      // character parent that owns the body assembly. Scaling that one parent
      // therefore scales portrait + hands + already-attached feet exactly once.
      // The avatarRoot (carrying userData.neckRig) is already a descendant of
      // parent by this point, so the head-compensation lookup inside
      // applyToParent finds it.
      applyToParent(parent, options.speciesId || options.profile?.speciesId || options.profile?.species, options.gender || options.profile?.gender);
      return base(THREE, parent, options);
    };
    Object.assign(wrapped, base);
    wrapped.__hobunjiCharacterRigScaleWrapped = true;
    hands.attach = wrapped;
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.characterRigScaleRuntimeHook = 'ProceduralHandAttachments.floor-parent';
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
      const resolved = scaleFor(species, gender, source);
      result.rigScaleX = resolved.x;
      result.rigScaleY = resolved.y;
      result.headScale = resolved.head;
      return result;
    };

    const baseRememberScale = window.rememberRigActorBodyScaleV1531;
    if (typeof baseRememberScale === 'function') {
      window.rememberRigActorBodyScaleV1531 = function rememberBodyScaleWithoutWholeRigFactor(actor) {
        const result = baseRememberScale.apply(this, arguments);
        const state = actor?.visualOffset?.userData?.hobunjiCharacterRigScaleState;
        const saved = actor?.rigBodyVisualOffsetBaseScaleV1535;
        if (state && saved) {
          const fx = clampScale(state.factor?.x ?? state.factor);
          const fy = clampScale(state.factor?.y ?? state.factor);
          saved.x /= fx; saved.y /= fy; saved.z /= fx;
        }
        return result;
      };
    }

    const baseBodyPreview = window.previewRigActorBodyScaleV1531;
    if (typeof baseBodyPreview === 'function') {
      window.previewRigActorBodyScaleV1531 = function bodyPreviewWithWholeRigScale(actor) {
        const result = baseBodyPreview.apply(this, arguments);
        const profile = actor ? window.attachmentRigProfileForActor(actor) : null;
        if (actor?.visualOffset && profile) applyToParent(actor.visualOffset, profile.species, profile.gender, scaleFor(profile.species, profile.gender, profile));
        return result;
      };
    }

    const baseRender = window.renderCharacterAnatomySectionV1530;
    window.renderCharacterAnatomySectionV1530 = function renderCharacterAnatomyWithWholeRigScale(actor) {
      let html = baseRender.apply(this, arguments);
      const profile = actor ? window.attachmentRigProfileForActor(actor) : null;
      const resolved = scaleFor(profile?.species || actor?.source?.species, profile?.gender || actor?.source?.gender, profile);
      const field = `<div class="maaField"><label for="maaRigScaleX">Body width (%)</label><input id="maaRigScaleX" type="number" min="10" max="400" step="2.5" value="${(resolved.x * 100).toFixed(1)}"></div>`
        + `<div class="maaField"><label for="maaRigScaleY">Body height (%)</label><input id="maaRigScaleY" type="number" min="10" max="400" step="2.5" value="${(resolved.y * 100).toFixed(1)}"></div>`
        + `<div class="maaField"><label for="maaHeadScale">Head scale (%)</label><input id="maaHeadScale" type="number" min="10" max="400" step="2.5" value="${(resolved.head * 100).toFixed(1)}"></div>`;
      const marker = '<div class="maaField"><label for="maaArmLengthOffset">';
      html = html.includes(marker) ? html.replace(marker, `${field}${marker}`) : html;
      html = html.replace(
        'Body scale previews immediately and rebuilds the full anatomy when released.',
        'Body scale changes portrait anatomy. Body width/height uniformly scale the assembled character around ground Y=0 without rewriting any internal coordinates, independently of one another. Head scale is compensated at the neck rig so it never inherits the body’s aspect ratio, and can be tuned on its own. Body scale previews immediately and rebuilds the full anatomy when released.',
      );
      return html;
    };

    const baseBind = window.bindCharacterAnatomyControlsV1530;
    window.bindCharacterAnatomyControlsV1530 = function bindCharacterAnatomyWithWholeRigScale(actor) {
      const result = baseBind.apply(this, arguments);
      const inputs = {
        x: document.getElementById('maaRigScaleX'),
        y: document.getElementById('maaRigScaleY'),
        head: document.getElementById('maaHeadScale'),
      };
      if (!inputs.x || !inputs.y || !inputs.head || inputs.x.dataset.hobunjiRigScaleBound === '1') return result;
      inputs.x.dataset.hobunjiRigScaleBound = '1';
      const applyInputs = () => {
        const profile = window.attachmentRigProfileForActor(actor);
        if (!profile) return;
        profile.anatomy ||= {};
        profile.anatomy.rigScaleX = clampScale(Number(inputs.x.value) / 100);
        profile.anatomy.rigScaleY = clampScale(Number(inputs.y.value) / 100);
        profile.anatomy.headScale = clampScale(Number(inputs.head.value) / 100);
        applyToParent(actor.visualOffset, profile.species || actor.source?.species, profile.gender || actor.source?.gender, {
          x: profile.anatomy.rigScaleX, y: profile.anatomy.rigScaleY, head: profile.anatomy.headScale,
        });
        try { window.publishCharacterHandShouldersV1525?.(actor, profile); } catch (_) {}
        window.ProceduralHandFrameDriver?.syncNow?.();
      };
      for (const input of Object.values(inputs)) {
        input.addEventListener('input', applyInputs);
        input.addEventListener('change', applyInputs);
      }
      return result;
    };

    const baseSerialize = window.serializeAttachmentRigLibrary;
    if (typeof baseSerialize === 'function' && !baseSerialize.__hobunjiWholeRigScaleExportWrapped) {
      const wrappedSerialize = function serializeWholeRigScale() {
        const data = baseSerialize.apply(this, arguments);
        data.rigScaleSemantics = {
          profileFields: { x: 'characters.<species>::<gender>.anatomy.rigScaleX', y: 'characters.<species>::<gender>.anatomy.rigScaleY', head: 'characters.<species>::<gender>.anatomy.headScale' },
          legacyProfileField: 'characters.<species>::<gender>.anatomy.rigScale (pre-split uniform value, still honored as a fallback when x/y/head are absent)',
          default: 1,
          pivot: 'character floor origin (Y=0)',
          behavior: 'x/y independently scale the whole assembled body (portrait/hands/feet/attachments) around the floor origin; head is separately scaled and compensated at the neck rig bone so it never inherits the body’s aspect ratio. Local anchor/hand/foot coordinates remain unchanged.',
          runtime: true,
        };
        return data;
      };
      wrappedSerialize.__hobunjiWholeRigScaleExportWrapped = true;
      window.serializeAttachmentRigLibrary = wrappedSerialize;
    }

    const selected = window.selectedAnimationActor?.();
    if (selected?.source?.type === 'npc') {
      const profile = window.attachmentRigProfileForActor(selected);
      if (profile) applyToParent(selected.visualOffset, profile.species, profile.gender, scaleFor(profile.species, profile.gender, profile));
    }

    window.__hobunjiCharacterRigScaleAuthorInstalled = true;
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.wholeRigScale = 'ground-relative runtime/editor parent scale installed (independent x/y, compensated head)';
    if (selected?.source?.type === 'npc') window.renderAttachmentRigInspector?.();
    return true;
  }

  let attempts = 0;
  let timer = null; // Plain `let`, not `const`: a synchronous setInterval mock (as used by scripts/test-character-rig-scale.js) invokes the callback before a `const` binding would finish initializing, throwing on the very first tick if everything is already ready.
  timer = setInterval(() => {
    const defaultsReady = installProfileDefaults();
    const handReady = installHandParentRuntime();
    const authorReady = installAnimationAuthor();
    if ((defaultsReady && handReady && authorReady) || ++attempts >= 600) clearInterval(timer);
  }, 50);
  installProfileDefaults();
  installHandParentRuntime();
  installAnimationAuthor();
})();
