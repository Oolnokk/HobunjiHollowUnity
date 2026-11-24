// Full Character Scale guarded input path.
//
// The legacy comparison editor reapplies X/Y/Head/Head-Y together whenever any
// one control changes. Head is now displayed in raw-PNG percentage space, so
// letting that legacy handler read the visible Head value can reinterpret it as
// runtime headScale and slam it into the 400% clamp. This module owns all four
// scale controls, persists them through the host's round-trip map, and only
// changes the field the user actually touched.
(() => {
  'use strict';

  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const MODE = 'scale-compare'; // Scopes interception to Full Character Scale mode only.
  const PANEL_ID = 'maaFullScalePanel'; // Existing comparison control panel.
  const RIG_SAVE_KEY = 'hobunjiAttachmentRigProfiles.v2'; // Same autosave key used by the editor.
  const MIN_RUNTIME_HEAD = 0.1; // Matches HobunjiCharacterRigScale's clamp.
  const MAX_RUNTIME_HEAD = 4; // Matches HobunjiCharacterRigScale's clamp.
  const FIELD_SPECS = Object.freeze({
    maaFullScaleRangeX: Object.freeze({ field: 'x', pair: 'maaFullScaleNumX', min: 10, max: 400, number: false }),
    maaFullScaleNumX: Object.freeze({ field: 'x', pair: 'maaFullScaleRangeX', min: 10, max: 400, number: true }),
    maaFullScaleRangeHeight: Object.freeze({ field: 'height', pair: 'maaFullScaleNumHeight', min: 10, max: 400, number: false }),
    maaFullScaleNumHeight: Object.freeze({ field: 'height', pair: 'maaFullScaleRangeHeight', min: 10, max: 400, number: true }),
    maaFullScaleRangeBeltline: Object.freeze({ field: 'beltline', pair: 'maaFullScaleNumBeltline', min: 0.1, max: 99.9, number: false }),
    maaFullScaleNumBeltline: Object.freeze({ field: 'beltline', pair: 'maaFullScaleRangeBeltline', min: 0.1, max: 99.9, number: true }),
    maaFullScaleRangeHand: Object.freeze({ field: 'handScale', pair: 'maaFullScaleNumHand', min: 10, max: 400, number: false }),
    maaFullScaleNumHand: Object.freeze({ field: 'handScale', pair: 'maaFullScaleRangeHand', min: 10, max: 400, number: true }),
    maaFullScaleRangeFoot: Object.freeze({ field: 'footScale', pair: 'maaFullScaleNumFoot', min: 10, max: 400, number: false }),
    maaFullScaleNumFoot: Object.freeze({ field: 'footScale', pair: 'maaFullScaleRangeFoot', min: 10, max: 400, number: true }),
    maaFullScaleRangeHead: Object.freeze({ field: 'head', pair: 'maaFullScaleNumHead', rawHead: true, number: false }),
    maaFullScaleNumHead: Object.freeze({ field: 'head', pair: 'maaFullScaleRangeHead', rawHead: true, number: true }),
    maaFullScaleRangeOffsetY: Object.freeze({ field: 'offsetY', pair: 'maaFullScaleNumOffsetY', min: -50, max: 50, number: false }),
    maaFullScaleNumOffsetY: Object.freeze({ field: 'offsetY', pair: 'maaFullScaleRangeOffsetY', min: -50, max: 50, number: true }),
  });

  let installedPanel = null; // Prevents duplicate capture listeners if the workspace is rebuilt.
  let persistTimer = 0; // Debounces the legacy rig JSON autosave while dragging.

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
  const finitePositive = (value, fallback = 1) => {
    const number = Number(value); // Used for portrait-scale conversion and safe fallback.
    return Number.isFinite(number) && number > 1e-9 ? number : fallback;
  };

  function comparisonApi() {
    return window.HobunjiFullCharacterScaleComparison || null;
  }

  function host() {
    return window.HobunjiAnimationAuthorScaleHost || window.HobunjiAnimationAuthorHost || null;
  }

  function selectedIdentity() {
    const key = String(comparisonApi()?.selectedKey || ''); // Resolves the canonical species/gender currently being edited.
    const [species, gender] = key.split('::');
    return species && gender ? { key, species, gender } : null;
  }

  function profileFor(identity) {
    return identity ? window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[identity.key] || null : null;
  }

  function currentScale(identity) {
    const profile = profileFor(identity); // Shared profile is the durable source for hand/foot scale, independent from x/y/head.
    const scale = window.HobunjiCharacterRigScale?.scaleFor?.(identity?.species, identity?.gender, profile)
      || { x: 1, y: 1, head: 1, offsetY: 0 };
    const hands = window.HobunjiHandModelProfiles;
    const positive = (value, fallback = 1) => Number(value) > 0 ? Number(value) : (Number(fallback) > 0 ? Number(fallback) : 1);
    return { ...scale,
      legLength: positive(scale.legLength, scale.y),
      handScale: positive(profile?.anatomy?.handScale, hands?.speciesScaleFor?.(identity?.species, identity?.gender)),
      footScale: positive(profile?.anatomy?.footScale, hands?.footScaleFor?.(identity?.species, identity?.gender)),
    };
  }

  function portraitScaleFor(identity) {
    // The actual displayed avatar is authoritative: a donor or later species config override may
    // differ from the profile's portraitScale field, but model.userData records what was rendered.
    const compare = comparisonApi();
    const rendered = Number(compare?.selectedKey === identity?.key ? compare?.selectedPortraitScaleMultiplier : null);
    if (Number.isFinite(rendered) && rendered > 0) return rendered;
    try {
      const effective = Number(window.PNGPlaneAvatar?.avatarScaleMultiplierFor?.({
        appearance: { speciesId: identity?.species, gender: identity?.gender },
      }));
      if (Number.isFinite(effective) && effective > 0) return effective;
    } catch (_) { /* Profile data is a last resort before the avatar renderer is ready. */ }
    const authored = Number(profileFor(identity)?.anatomy?.portraitScale);
    return Number.isFinite(authored) && authored > 0 ? authored : 1;
  }

  function boundsFor(identity, spec) {
    if (!spec?.rawHead) return { min: spec.min, max: spec.max };
    const portrait = portraitScaleFor(identity); // Converts runtime [0.1,4] into raw-PNG display percentage bounds.
    return { min: MIN_RUNTIME_HEAD * portrait * 100, max: MAX_RUNTIME_HEAD * portrait * 100 };
  }

  function nextScale(current, field, percent, portraitScale = 1, beltlineBase = .5) {
    const next = {
      x: Number(current?.x) || 1,
      y: Number(current?.y) || 1,
      head: Number(current?.head) || 1,
      offsetY: Number(current?.offsetY) || 0,
    }; // Every untouched legacy field, especially Head, is copied verbatim.
    if (Number(current?.legLength) > 0) next.legLength = Number(current.legLength); // Preserve separate hip reach on any X/Head edit.
    if (Number(current?.handScale) > 0) next.handScale = Number(current.handScale);
    if (Number(current?.footScale) > 0) next.footScale = Number(current.footScale);
    if (field === 'height' || field === 'beltline') {
      const rig = window.HobunjiCharacterRigScale; // Same reversible geometry used for selected display, exports and runtime scaling.
      const currentDimensions = rig?.heightBeltlineFor?.(current, beltlineBase) || { height: current.y, beltline: .5 };
      const total = field === 'height' ? Number(percent) / 100 : currentDimensions.height;
      const fraction = field === 'beltline' ? Number(percent) / 100 : currentDimensions.beltline;
      return rig?.scaleForHeightBeltline?.(next, total, fraction, beltlineBase) || next; // Save old y/legLength schema; never store redundant UI fields that the runtime does not know.
    }
    if (field === 'x' || field === 'y' || field === 'legLength' || field === 'handScale' || field === 'footScale') next[field] = Number(percent) / 100;
    else if (field === 'offsetY') next.offsetY = Number(percent) / 100;
    else if (field === 'head') next.head = window.HobunjiCharacterRigScale?.runtimeHeadScaleForRaw?.(Number(percent) / 100, portraitScale)
      ?? clamp((Number(percent) / 100) / finitePositive(portraitScale, 1), MIN_RUNTIME_HEAD, MAX_RUNTIME_HEAD); // Head=100% cancels the actual portrait-plane multiplier, regardless of body height/width.
    return next;
  }

  function nextScalePreservingHead(current, field, percent) {
    return nextScale(current, field, percent, 1); // Public regression helper for width/height/head-Y edits.
  }

  function previewGroupFor(identity) {
    return window.HobunjiGameplayBackdrop?.getScene?.()?.getObjectByName?.(`FullScalePreview_${identity?.key}`) || null;
  }

  function ageFractionFor(group) {
    let npcId = null; // Filled from preview userData so age hunch survives any scale edit.
    group?.traverse?.(node => { if (!npcId && node?.userData?.npcId) npcId = node.userData.npcId; });
    return npcId ? (Number(host()?.npcAgeFor?.(npcId)) || 0) : 0;
  }

  function persistProfilesSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = 0;
      try {
        const data = host()?.serializeRig?.() || {
          schema: 'hobunji.attachment-rig-profiles.v10',
          exportedAt: new Date().toISOString(),
          profiles: JSON.parse(JSON.stringify(window.HOBUNJI_ATTACHMENT_RIG_PROFILES || {})),
        };
        localStorage.setItem(RIG_SAVE_KEY, JSON.stringify(data));
      } catch (error) {
        console.warn('[full-character-scale] scale autosave failed', error);
      }
    }, 180);
  }

  function applyScaleField(field, percent) {
    const identity = selectedIdentity();
    const profile = profileFor(identity);
    if (!identity || !profile) return null;
    const before = currentScale(identity);
    const portrait = portraitScaleFor(identity);
    const next = nextScale(before, field, percent, portrait, comparisonApi()?.selectedBeltlineGeometry ?? .5);

    // The host owns the durable scale override map used by Rig export/reload.
    // Calling it directly avoids the old document-bubble listener, which cannot
    // observe these deliberately capture-stopped events.
    const persisted = host()?.setRigScale?.(identity.species, identity.gender, next) || next;
    if (!host()?.setRigScale) {
      profile.anatomy ||= {};
      profile.anatomy.rigScaleX = next.x;
      profile.anatomy.rigScaleY = next.y;
      profile.anatomy.headScale = next.head;
      profile.anatomy.headOffsetY = next.offsetY;
    }

    const group = previewGroupFor(identity);
    if (comparisonApi()?.refreshFromScaleChange) {
      comparisonApi().refreshFromScaleChange(persisted, field); // One authoritative preview applies leg IK, reanchors the torso, and resizes hand/foot GLBs.
    } else if (group && comparisonApi()?.refreshSelectedPreview) {
      comparisonApi().refreshSelectedPreview(); // Preserve the selected global age stage when direct scale callback is unavailable.
    } else if (group) {
      window.HobunjiCharacterRigScale?.applyToParent?.(group, identity.species, identity.gender, persisted, ageFractionFor(group));
    }
    persistProfilesSoon();
    return persisted;
  }

  function displayedPercentFor(identity, field, scale) {
    if (field === 'head') return (window.HobunjiCharacterRigScale?.rawPngHeadScaleFor?.(scale.head, portraitScaleFor(identity))
      ?? (scale.head * portraitScaleFor(identity))) * 100; // Always show raw-PNG-relative head size; never expose internal runtime head factor.
    if (field === 'offsetY') return scale.offsetY * 100;
    if (field === 'height' || field === 'beltline') {
      const dimensions = window.HobunjiCharacterRigScale?.heightBeltlineFor?.(scale, comparisonApi()?.selectedBeltlineGeometry ?? .5);
      return (field === 'height' ? dimensions?.height : dimensions?.beltline) * 100 || 50;
    }
    return scale[field] * 100;
  }

  function syncHeightBeltlineInputs(identity, scale) {
    for (const [axis, field] of [['Height', 'height'], ['Beltline', 'beltline']]) {
      const percent = displayedPercentFor(identity, field, scale); // Reflect the actual height and hip percentage after runtime-scale bounds.
      if (!Number.isFinite(percent)) continue;
      const range = document.getElementById(`maaFullScaleRange${axis}`);
      const number = document.getElementById(`maaFullScaleNum${axis}`);
      if (range) range.value = String(Math.round(percent * 10) / 10); // Match the visible Beltline slider's 0.1% precision.
      if (number) number.value = String(Math.round(percent * 10) / 10);
    }
  }

  function consumeScaleInput(event) {
    if (document.body.dataset.animationAuthorMode !== MODE) return;
    const spec = FIELD_SPECS[event.target?.id];
    if (!spec) return;
    event.stopPropagation();
    event.stopImmediatePropagation(); // Blocks both the legacy all-fields target handler and later presentation adapters.

    const identity = selectedIdentity();
    if (!identity) return;
    const bounds = boundsFor(identity, spec);
    const raw = Number(event.target.value);
    if (!Number.isFinite(raw)) return; // Empty/partial mobile number edits remain editable.
    if (spec.number && (raw < bounds.min || raw > bounds.max)) return; // Do not snap the first digit of a multi-digit value.
    const percent = clamp(raw, bounds.min, bounds.max);
    const pair = document.getElementById(spec.pair); // Mirrors valid range/number partners.
    if (pair) pair.value = String(percent);
    const applied = applyScaleField(spec.field, percent);
    if (applied && (spec.field === 'height' || spec.field === 'beltline' || spec.field === 'footScale')) syncHeightBeltlineInputs(identity, applied); // A physically unreachable beltline clamps to real derived values, never a misleading number.
  }

  function commitScaleNumber(event) {
    if (document.body.dataset.animationAuthorMode !== MODE) return;
    const spec = FIELD_SPECS[event.target?.id];
    if (!spec?.number) return;
    event.stopPropagation();
    event.stopImmediatePropagation();
    const identity = selectedIdentity();
    if (!identity) return;
    const bounds = boundsFor(identity, spec);
    const scale = currentScale(identity);
    const fallbackPercent = displayedPercentFor(identity, spec.field, scale);
    const typed = Number(event.target.value);
    const percent = Number.isFinite(typed) ? clamp(typed, bounds.min, bounds.max) : fallbackPercent;
    event.target.value = String(Math.round(percent * 10) / 10);
    const pair = document.getElementById(spec.pair);
    if (pair) pair.value = String(percent);
    const applied = applyScaleField(spec.field, percent);
    if (applied && (spec.field === 'height' || spec.field === 'beltline' || spec.field === 'footScale')) syncHeightBeltlineInputs(identity, applied);
  }

  function install() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || installedPanel === panel) return !!panel;
    installedPanel = panel;
    panel.addEventListener('input', consumeScaleInput, true);
    panel.addEventListener('change', commitScaleNumber, true);
    panel.addEventListener('focusout', event => {
      if (FIELD_SPECS[event.target?.id]?.number) commitScaleNumber(event);
    }, true);
    return true;
  }

  window.HobunjiFullScaleBodyInputGuard = Object.freeze({
    nextScalePreservingHead,
    nextScale,
    applyScaleField,
    boundsFor,
  });

  install();
  let attempts = 0; // Panel is lazy; loaded before presentation so this capture listener wins ownership.
  const timer = setInterval(() => {
    if (install() || ++attempts >= 600) clearInterval(timer);
  }, 50);
})();
