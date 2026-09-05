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
    maaFullScaleRangeY: Object.freeze({ field: 'y', pair: 'maaFullScaleNumY', min: 10, max: 400, number: false }),
    maaFullScaleNumY: Object.freeze({ field: 'y', pair: 'maaFullScaleRangeY', min: 10, max: 400, number: true }),
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
    return window.HobunjiCharacterRigScale?.scaleFor?.(identity?.species, identity?.gender, profileFor(identity))
      || { x: 1, y: 1, head: 1, offsetY: 0 };
  }

  function portraitScaleFor(identity) {
    const authored = Number(profileFor(identity)?.anatomy?.portraitScale); // Same species/gender portrait-plane multiplier used by the preview/runtime.
    if (Number.isFinite(authored) && authored > 0) return authored;
    try {
      return finitePositive(window.PNGPlaneAvatar?.avatarScaleMultiplierFor?.({
        appearance: { speciesId: identity?.species, gender: identity?.gender },
      }), 1);
    } catch (_) {
      return 1;
    }
  }

  function boundsFor(identity, spec) {
    if (!spec?.rawHead) return { min: spec.min, max: spec.max };
    const portrait = portraitScaleFor(identity); // Converts runtime [0.1,4] into raw-PNG display percentage bounds.
    return { min: MIN_RUNTIME_HEAD * portrait * 100, max: MAX_RUNTIME_HEAD * portrait * 100 };
  }

  function nextScale(current, field, percent, portraitScale = 1) {
    const next = {
      x: Number(current?.x) || 1,
      y: Number(current?.y) || 1,
      head: Number(current?.head) || 1,
      offsetY: Number(current?.offsetY) || 0,
    }; // Every untouched field, especially Head during body edits, is copied verbatim.
    if (field === 'x' || field === 'y') next[field] = Number(percent) / 100;
    else if (field === 'offsetY') next.offsetY = Number(percent) / 100;
    else if (field === 'head') next.head = clamp((Number(percent) / 100) / finitePositive(portraitScale, 1), MIN_RUNTIME_HEAD, MAX_RUNTIME_HEAD);
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
    const next = nextScale(before, field, percent, portrait);

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
    if (group) window.HobunjiCharacterRigScale?.applyToParent?.(group, identity.species, identity.gender, persisted, ageFractionFor(group));
    persistProfilesSoon();
    return persisted;
  }

  function displayedPercentFor(identity, field, scale) {
    if (field === 'head') return scale.head * portraitScaleFor(identity) * 100;
    if (field === 'offsetY') return scale.offsetY * 100;
    return scale[field] * 100;
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
    applyScaleField(spec.field, percent);
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
    applyScaleField(spec.field, percent);
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
