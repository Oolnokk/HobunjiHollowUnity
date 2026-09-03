// Config-driven NPC age portrait runtime shared with docs/tools/age-effect/.
(() => {
  'use strict';

  const api = window.NpcAvatarPreview; // Wrapped below so existing walkers/dialogue/wardrobe callers receive the same authored age treatment.
  const config = window.HobunjiNpcAgeEffectConfig; // Single source of preset assignments and tunable values used by gameplay and the authoring tool.
  if (!api?.buildProfileFromNpcExport || !api?.renderProfileToCanvas || !config || api.__ageEffectsRuntimeInstalled) return;

  const POSTURE_BEHIND_BODY_LAYER_ORDER = Object.freeze([
    'sideLeft', 'rightSideHair',
    'baseLeftArm', 'baseTorso', 'baseRightArm',
    'torsoClothing', 'overwear', 'hatUnder', 'hood', 'pauldron', 'hatOver',
    'snowgoggles', 'hairBack',
  ]); // Mirrors the rear body stack from HobunjiAvatarPosturePreview-11.html.
  const POSTURE_BEHIND_BASE_UNDER_HEAD_LAYER_ORDER = Object.freeze([
    'baseLeftArm', 'baseTorso', 'baseRightArm', 'torsoClothing',
  ]); // Rear layers that remain behind the age-lowered head.
  const POSTURE_BEHIND_OVERWEAR_FRONT_LAYER_ORDER = Object.freeze(['overwear']); // Rear layer restored in front after the lowered head is composed.
  const originalBuildProfile = api.buildProfileFromNpcExport.bind(api); // Preserved unaged profile builder used by runtime wrappers and custom tool previews.
  const originalRenderProfile = api.renderProfileToCanvas.bind(api); // Preserved base renderer used for every split render below.
  let agingColorProbeCanvas = null; // Reused 1x1 canvas for legacy hue/saturation/brightness body-color descriptors.

  function clampPercent(value) {
    const numeric = Number(value); // Used by the reference color algorithm for all percent-valued authoring controls.
    return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
  }

  function normalizeHexColor(value, fallback = '#7dc89a') {
    const raw = String(value || '').trim(); // Canonicalized before linear-light color conversion.
    const shortMatch = raw.match(/^#([0-9a-f]{3})$/i); // Expands compact #rgb authoring values when encountered.
    if (shortMatch) {
      const chars = shortMatch[1]; // Used immediately to expand each nibble to one full byte.
      return `#${chars[0]}${chars[0]}${chars[1]}${chars[1]}${chars[2]}${chars[2]}`.toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
    return String(fallback || '#7dc89a').toLowerCase();
  }

  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex); // Parsed into channels for the reference aging math.
    const value = Number.parseInt(normalized.slice(1), 16); // Packed RGB integer split below.
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function rgbToHex(r, g, b) {
    const channel = value => Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, '0'); // Keeps interpolation output in displayable sRGB range.
    return `#${channel(r)}${channel(g)}${channel(b)}`;
  }

  function bodyColorReferenceHex(profile) {
    const speciesId = String(profile?.fighter?.speciesId || '').trim(); // Resolves the same species swatch baseline the original color preview uses.
    const normalized = speciesId.toLowerCase().replace(/_/g, '-'); // Supports both legacy underscored and current hyphenated species IDs.
    const speciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {}; // Supplies species-level swatch bases.
    const dyes = window.SCRATCHBONES_CONFIG?.game?.dyes || {}; // Supplies the global fallback swatch base.
    return speciesConfig[normalized]?.swatchBase || speciesConfig[speciesId]?.swatchBase || dyes.swatchBase || '#7dc89a';
  }

  function bodyColorDescriptorToHex(descriptor, profile) {
    if (descriptor?.hex) return normalizeHexColor(descriptor.hex, bodyColorReferenceHex(profile));
    const reference = bodyColorReferenceHex(profile); // Filter baseline used for legacy delta-style color descriptors.
    if (!descriptor || (descriptor.h == null && descriptor.s == null && descriptor.v == null && descriptor.l == null)) return normalizeHexColor(reference);
    if (!agingColorProbeCanvas) agingColorProbeCanvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
    const ctx = agingColorProbeCanvas.getContext('2d', { willReadFrequently: true }); // Applies the same browser CSS-filter interpretation used by the reference preview.
    const hueOffset = Number(window.SCRATCHBONES_CONFIG?.clothingHueOffset) || 0; // Existing global authored hue correction.
    const satOffset = Number(window.SCRATCHBONES_CONFIG?.clothingSatOffset) || 0; // Existing global authored saturation correction.
    const lightOffset = Number(window.SCRATCHBONES_CONFIG?.clothingLightOffset) || 0; // Existing global authored brightness correction.
    const hue = (Number(descriptor.h) || 0) + hueOffset; // Final CSS hue rotation for the one-pixel probe.
    const saturation = Math.max(0, 1 + (Number(descriptor.s) || 0) + satOffset); // Final CSS saturation multiplier.
    const brightness = Math.max(0, 1 + (Number(descriptor.v ?? descriptor.l) || 0) + lightOffset); // Final CSS brightness multiplier.
    ctx.clearRect(0, 0, 1, 1);
    ctx.filter = `hue-rotate(${hue}deg) saturate(${saturation}) brightness(${brightness})`;
    ctx.fillStyle = reference;
    ctx.fillRect(0, 0, 1, 1);
    ctx.filter = 'none';
    const pixel = ctx.getImageData(0, 0, 1, 1).data; // Concrete sRGB result aged exactly once below.
    return rgbToHex(pixel[0], pixel[1], pixel[2]);
  }

  function srgbChannelToLinear(channel) {
    const value = Math.max(0, Math.min(1, Number(channel) / 255)); // Normalized channel converted to linear light below.
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function linearChannelToSrgb(channel) {
    const value = Math.max(0, Math.min(1, Number(channel) || 0)); // Clamped linear channel converted back to display sRGB.
    const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055; // Standard sRGB transfer function used by the reference.
    return srgb * 255;
  }

  function relativeLuminance(rgb) {
    const r = srgbChannelToLinear(rgb.r); // Linear red contribution to perceived luminance.
    const g = srgbChannelToLinear(rgb.g); // Linear green contribution to perceived luminance.
    const b = srgbChannelToLinear(rgb.b); // Linear blue contribution to perceived luminance.
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function mixRgbLinear(fromRgb, toRgb, fraction) {
    const t = Math.max(0, Math.min(1, Number(fraction) || 0)); // Shared interpolation factor across all linear-light channels.
    const fromLinear = { r: srgbChannelToLinear(fromRgb.r), g: srgbChannelToLinear(fromRgb.g), b: srgbChannelToLinear(fromRgb.b) }; // Linearized source color.
    const toLinear = { r: srgbChannelToLinear(toRgb.r), g: srgbChannelToLinear(toRgb.g), b: srgbChannelToLinear(toRgb.b) }; // Linearized target color.
    return {
      r: linearChannelToSrgb(fromLinear.r + (toLinear.r - fromLinear.r) * t),
      g: linearChannelToSrgb(fromLinear.g + (toLinear.g - fromLinear.g) * t),
      b: linearChannelToSrgb(fromLinear.b + (toLinear.b - fromLinear.b) * t),
    };
  }

  function ageBodyColorHex(hex, settings) {
    const originalRgb = hexToRgb(hex); // Source biological body color transformed by the original two-stage algorithm.
    const age = clampPercent(settings?.amount) / 100; // Master age amount scales both secondary rates.
    const desaturationFraction = age * (clampPercent(settings?.desaturation) / 100); // Equal-luminance gray interpolation fraction.
    const brighteningFraction = age * (clampPercent(settings?.brightening) / 100); // Linear-light white interpolation fraction.
    const luminance = relativeLuminance(originalRgb); // Source perceived luminance retained while chroma is removed.
    const neutralChannel = linearChannelToSrgb(luminance); // Equal-luminance gray target channel.
    const desaturatedRgb = mixRgbLinear(originalRgb, { r: neutralChannel, g: neutralChannel, b: neutralChannel }, desaturationFraction); // Stage one: aging desaturation.
    const agedRgb = mixRgbLinear(desaturatedRgb, { r: 255, g: 255, b: 255 }, brighteningFraction); // Stage two: aging brightening.
    return rgbToHex(agedRgb.r, agedRgb.g, agedRgb.b);
  }

  function applyColorAging(profile, effect) {
    const nextBodyColors = { ...(profile?.bodyColors || {}) }; // Copies tint slots so clothing/equipment descriptors remain byte-for-byte untouched.
    const agedSlots = {}; // Exposed in debug/tool output for before-vs-after verification.
    for (const slot of ['A', 'B', 'C']) {
      const descriptor = profile?.bodyColors?.[slot]; // Original biological tint descriptor for this slot.
      if (!descriptor) continue;
      const originalHex = bodyColorDescriptorToHex(descriptor, profile); // Concrete source swatch before aging.
      const agedHex = ageBodyColorHex(originalHex, effect); // Tuned reference result for this slot.
      nextBodyColors[slot] = { hex: agedHex };
      agedSlots[slot] = { originalHex, agedHex };
    }
    profile.bodyColors = nextBodyColors;
    return agedSlots;
  }

  function frozenBreathingComposer(renderOptions, nowMs) {
    const source = renderOptions?.breathingComposer ?? window.portraitBreathingComposer ?? null; // Sampled once so full/body split renders cannot drift a breathing frame apart.
    if (!source) return null;
    return {
      getExpression(seatId) { return typeof source.getExpression === 'function' ? source.getExpression(seatId, nowMs) : 'neutral'; },
      getOverlayOnlyPoints(_ignoredNowMs, seatId) { return typeof source.getOverlayOnlyPoints === 'function' ? source.getOverlayOnlyPoints(nowMs, seatId) : null; },
      getInterpolatedPoints(speciesId, gender, _ignoredNowMs, phaseOffsetMs, seatId) {
        return typeof source.getInterpolatedPoints === 'function' ? source.getInterpolatedPoints(speciesId, gender, nowMs, phaseOffsetMs, seatId) : null;
      },
      getAnimData(speciesId, gender) { return typeof source.getAnimData === 'function' ? source.getAnimData(speciesId, gender) : null; },
    };
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas'); // Temporary layer surface matched to the authored portrait dimensions.
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function cloneCanvas(source) {
    const canvas = makeCanvas(source.width, source.height); // Stable snapshot used during head extraction/composition.
    canvas.getContext('2d').drawImage(source, 0, 0);
    return canvas;
  }

  function headContributionMask(fullCanvas, bodyOnlyCanvas) {
    const width = fullCanvas.width; // Shared width of the split renders and resulting mask.
    const height = fullCanvas.height; // Shared height of the split renders and resulting mask.
    const mask = makeCanvas(width, height); // White alpha mask containing only pixels contributed by the visible head stack.
    const full = fullCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height); // Full portrait pixels.
    const body = bodyOnlyCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height); // Matching body-only pixels.
    const maskCtx = mask.getContext('2d', { willReadFrequently: true }); // Writes amplified difference alpha.
    const result = maskCtx.createImageData(width, height); // Output pixel buffer for the mask.
    for (let i = 0; i < result.data.length; i += 4) {
      const difference = Math.max(
        Math.abs(full.data[i] - body.data[i]),
        Math.abs(full.data[i + 1] - body.data[i + 1]),
        Math.abs(full.data[i + 2] - body.data[i + 2]),
        Math.abs(full.data[i + 3] - body.data[i + 3]),
      ); // Strongest RGBA difference is the reference head-contribution signal.
      result.data[i] = result.data[i + 1] = result.data[i + 2] = 255;
      result.data[i + 3] = Math.max(0, Math.min(255, difference * 5)); // Reference gain preserves antialiasing while making clear differences opaque.
    }
    maskCtx.putImageData(result, 0, 0);
    return mask;
  }

  function extractVisibleHead(fullCanvas, bodyOnlyCanvas) {
    const head = cloneCanvas(fullCanvas); // Reduced to visible head contribution by destination-in below.
    const ctx = head.getContext('2d'); // Applies the difference mask without altering original RGB pixels.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(headContributionMask(fullCanvas, bodyOnlyCanvas), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    return head;
  }

  function composePostureInto(targetCanvas, bodyCanvas, headCanvas, headDropPx, frontOverlayCanvas = null) {
    targetCanvas.width = bodyCanvas.width;
    targetCanvas.height = bodyCanvas.height;
    const ctx = targetCanvas.getContext('2d'); // Rebuilds the portrait with body fixed and head lowered by the tuned amount.
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.drawImage(bodyCanvas, 0, 0);
    ctx.drawImage(headCanvas, 0, Number(headDropPx) || 0);
    if (frontOverlayCanvas) ctx.drawImage(frontOverlayCanvas, 0, 0);
    return targetCanvas;
  }

  async function renderDirect(canvas, profile, options) {
    await window.renderPortraitProfile(canvas, profile, options); // Direct renderer bypasses this wrapper for one split-render layer.
    return canvas;
  }

  async function applyPostureToCanvas(canvas, profile, renderOptions, effect) {
    const headDropPx = Math.max(0, Number(effect?.headDropPx) || 0); // Tuned portrait-only head displacement from the shared preset/tool.
    if (!headDropPx || renderOptions?.onlyHeadSprite === true || renderOptions?.omitHeadSpriteAndCosmetics === true) return;
    const fullCanvas = cloneCanvas(canvas); // Stable full composite rendered by the normal portrait pipeline.
    const isBehind = renderOptions?.portraitView === 'behind' || renderOptions?.view === 'behind'; // Selects the reference rear layering path.
    const bodyCanvas = makeCanvas(fullCanvas.width, fullCanvas.height); // Body-only render used to isolate head contribution.

    if (!isBehind) {
      await renderDirect(bodyCanvas, profile, { ...renderOptions, omitHeadSpriteAndCosmetics: true });
      const headCanvas = extractVisibleHead(fullCanvas, bodyCanvas); // Front visible-head pixels shifted below.
      const trimlessCanvas = canvas.__hobunjiFineHoodTrimlessCanvas; // Fine Hood alternate front canvas must keep matching head posture.
      const trimlessFull = trimlessCanvas?.width === bodyCanvas.width && trimlessCanvas?.height === bodyCanvas.height ? cloneCanvas(trimlessCanvas) : null; // Snapshot before target resize/composition.
      composePostureInto(canvas, bodyCanvas, headCanvas, headDropPx);
      if (trimlessCanvas && trimlessFull) composePostureInto(trimlessCanvas, bodyCanvas, extractVisibleHead(trimlessFull, bodyCanvas), headDropPx);
      return;
    }

    await renderDirect(bodyCanvas, profile, {
      ...renderOptions,
      portraitView: 'behind',
      omitHeadSpriteAndCosmetics: true,
      behindLayerOrder: POSTURE_BEHIND_BODY_LAYER_ORDER,
    });
    const baseUnderHead = makeCanvas(fullCanvas.width, fullCanvas.height); // Rear base that stays behind the shifted head.
    const overwearFront = makeCanvas(fullCanvas.width, fullCanvas.height); // Rear overwear restored in front of the shifted head.
    await renderDirect(baseUnderHead, profile, {
      ...renderOptions,
      portraitView: 'behind',
      omitHeadSpriteAndCosmetics: true,
      behindLayerOrder: POSTURE_BEHIND_BASE_UNDER_HEAD_LAYER_ORDER,
    });
    await renderDirect(overwearFront, profile, {
      ...renderOptions,
      portraitView: 'behind',
      omitHeadSpriteAndCosmetics: true,
      behindLayerOrder: POSTURE_BEHIND_OVERWEAR_FRONT_LAYER_ORDER,
    });
    composePostureInto(canvas, baseUnderHead, extractVisibleHead(fullCanvas, bodyCanvas), headDropPx, overwearFront);
  }

  function decorateProfile(profile, effect) {
    if (!profile || !effect) return profile;
    const agedSlots = applyColorAging(profile, effect); // Biological body colors age before hands/feet and portrait textures read the profile.
    profile.__hobunjiNpcAgeEffect = Object.freeze({ ...effect, agedSlots, source: config.schema });
    return profile;
  }

  function buildAgePreviewProfile(npc, effect) {
    const profile = originalBuildProfile(npc); // Tool preview always starts from pristine authored NPC colors rather than double-aging the runtime wrapper result.
    return decorateProfile(profile, effect);
  }

  async function renderAgePreviewToCanvas(canvas, profile, renderOptions = {}, explicitEffect = null) {
    const effect = explicitEffect || profile?.__hobunjiNpcAgeEffect || null; // Explicit tool tuning wins; runtime normally reads metadata installed at profile-build time.
    if (!effect) return originalRenderProfile(canvas, profile, renderOptions);
    const renderNowMs = Date.now(); // One animation sample shared across every split layer in this render.
    const composer = frozenBreathingComposer(renderOptions, renderNowMs); // Prevents breathing drift from contaminating head difference masks.
    const stableOptions = composer ? { ...renderOptions, breathingComposer: composer } : renderOptions; // Same animation state used by full and body-only renders.
    const rendered = await originalRenderProfile(canvas, profile, stableOptions);
    if (!rendered) return rendered;
    await applyPostureToCanvas(canvas, profile, stableOptions, effect);
    canvas.__hobunjiNpcAgeEffectDebug = {
      npcId: effect.npcId ?? null,
      npcName: effect.npcName ?? null,
      preset: effect.presetLabel || effect.presetId || null,
      headDropPx: effect.headDropPx,
      torsoPitchDeg: effect.torsoPitchDeg,
      ageEffectPercent: effect.amount,
      desaturationRatePercent: effect.desaturation,
      brighteningRatePercent: effect.brightening,
      bodyColorSlots: profile?.__hobunjiNpcAgeEffect?.agedSlots || null,
      clothingDyesUntouched: true,
    }; // Mobile-accessible author/runtime parity payload.
    return rendered;
  }

  api.buildProfileFromNpcExport = function buildProfileFromNpcExportWithAge(npc) {
    const profile = originalBuildProfile(npc); // Existing authored profile remains the source of truth.
    const effect = config.resolveNpcEffect(npc); // Exact shared assignment decides whether gameplay ages this NPC.
    return effect ? decorateProfile(profile, effect) : profile;
  };

  api.renderProfileToCanvas = function renderProfileToCanvasWithAge(canvas, profile, renderOptions = {}) {
    return renderAgePreviewToCanvas(canvas, profile, renderOptions, profile?.__hobunjiNpcAgeEffect || null);
  };

  api.resolveAgeEffect = config.resolveNpcEffect; // Shared resolver available to debug/editor code.
  api.resolveOldAgeEffect = config.resolveNpcEffect; // Compatibility alias for the first selective-age implementation/tests.
  api.buildAgePreviewProfile = buildAgePreviewProfile; // Tool-only pristine profile builder with arbitrary tuned effect values.
  api.renderAgePreviewToCanvas = renderAgePreviewToCanvas; // Tool-only renderer using the same posture path as gameplay.
  api.ageBodyColorHex = ageBodyColorHex; // Visual tool diagnostic helper for direct swatch previews.
  api.getAgeEffectDebug = canvas => canvas?.__hobunjiNpcAgeEffectDebug || null; // Runtime/tool debug reader without console access.
  api.getOldAgeEffectDebug = api.getAgeEffectDebug; // Compatibility alias.
  api.__ageEffectsRuntimeInstalled = true;

  window.HobunjiNpcAgeEffects = Object.freeze({
    config,
    resolveNpcEffect: config.resolveNpcEffect,
    buildAgePreviewProfile,
    renderAgePreviewToCanvas,
    ageBodyColorHex,
    getCanvasDebug: canvas => canvas?.__hobunjiNpcAgeEffectDebug || null,
  });
  window.HobunjiNpcOldAgeEffects = window.HobunjiNpcAgeEffects; // Compatibility bridge for older diagnostics while references migrate to the combined tool.
})();
