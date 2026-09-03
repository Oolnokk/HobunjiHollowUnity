// Selective old-age portrait treatment for the exact NPCs authored in the old-age preview presets.
(() => {
  'use strict';

  const api = window.NpcAvatarPreview; // Wrapped below so every existing NPC portrait/PNG-plane caller inherits the same aging behavior.
  if (!api?.buildProfileFromNpcExport || !api?.renderProfileToCanvas || api.__oldAgeEffectsInstalled) return;

  const COLOR_PRESETS = Object.freeze({ // Mirrors HobunjiAvatarBodyAgingColorPreview-2.html for the two gameplay age bands used here.
    old: Object.freeze({ label: 'Old', amount: 70, desaturation: 65, brightening: 30 }),
    ancient: Object.freeze({ label: 'Ancient', amount: 100, desaturation: 88, brightening: 48 }),
  });
  const AGE_BANDS = Object.freeze({ // Maps the named NPC previewer bands to color and posture reference presets.
    old: Object.freeze({ id: 'old', label: 'Old', posturePixels: 4, colorPreset: 'old' }),
    veryOld: Object.freeze({ id: 'very-old', label: 'Very Old', posturePixels: 9, colorPreset: 'ancient' }),
  });
  const ASSIGNMENTS = Object.freeze([ // Hard allowlist: only these five authored NPCs receive old-age effects.
    Object.freeze({ ids: Object.freeze(['teacup_unumanuk']), names: Object.freeze(['Eldress Teacup', 'Teacup Unumanuk']), band: 'old' }),
    Object.freeze({ ids: Object.freeze(['father_hunundi_hodu']), names: Object.freeze(['Father Hunundi', 'Father Hunundi Hodu']), band: 'old' }),
    Object.freeze({ ids: Object.freeze(['vul_sigrid']), names: Object.freeze(['Vul Sigrid']), band: 'old' }),
    Object.freeze({ ids: Object.freeze(['kinami_kunji']), names: Object.freeze(['Kinami Kunji']), band: 'veryOld' }),
    Object.freeze({ ids: Object.freeze(['kaboku_kunji']), names: Object.freeze(['Kaboku Kunji']), band: 'veryOld' }),
  ]);
  const POSTURE_BEHIND_BODY_LAYER_ORDER = Object.freeze([ // Reference rear-view body stack used to isolate the visible head contribution.
    'sideLeft', 'rightSideHair',
    'baseLeftArm', 'baseTorso', 'baseRightArm',
    'torsoClothing', 'overwear', 'hatUnder', 'hood', 'pauldron', 'hatOver',
    'snowgoggles',
    'hairBack',
  ]);
  const POSTURE_BEHIND_BASE_UNDER_HEAD_LAYER_ORDER = Object.freeze([ // Reference rear-view layers that must stay behind the lowered head.
    'baseLeftArm', 'baseTorso', 'baseRightArm',
    'torsoClothing',
  ]);
  const POSTURE_BEHIND_OVERWEAR_FRONT_LAYER_ORDER = Object.freeze(['overwear']); // Reference rear-view overlay that remains in front of the lowered head.
  const originalBuildProfile = api.buildProfileFromNpcExport.bind(api); // Preserved source profile builder called by the wrapper below.
  const originalRenderProfile = api.renderProfileToCanvas.bind(api); // Preserved shared renderer called before the posture split/composite.
  let agingColorProbeCanvas = null; // Reused 1x1 canvas for resolving legacy HSV-style body-color descriptors to concrete RGB.

  function normalizeNpcKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function resolveNpcEffect(npc) {
    const idKey = normalizeNpcKey(npc?.id); // Compared against exact authored IDs so unrelated similarly named NPCs never inherit aging.
    const nameKey = normalizeNpcKey(npc?.name); // Fallback for references/imports that omit an NPC id but retain the authored display name.
    for (const assignment of ASSIGNMENTS) {
      const matchesId = assignment.ids.some(id => normalizeNpcKey(id) === idKey); // Exact ID match for this allowlist entry.
      const matchesName = assignment.names.some(name => normalizeNpcKey(name) === nameKey); // Exact display-name match for this allowlist entry.
      if (!matchesId && !matchesName) continue;
      const band = AGE_BANDS[assignment.band]; // Resolved age-band settings returned to both profile and posture wrappers.
      const color = COLOR_PRESETS[band.colorPreset]; // Body-color settings copied from the color-aging reference.
      return Object.freeze({
        npcId: npc?.id || null,
        npcName: npc?.name || null,
        bandId: band.id,
        bandLabel: band.label,
        posturePixels: band.posturePixels,
        colorPreset: band.colorPreset,
        colorLabel: color.label,
        amount: color.amount,
        desaturation: color.desaturation,
        brightening: color.brightening,
      });
    }
    return null;
  }

  function clampPercent(value) {
    const numeric = Number(value); // Normalized below before using a reference preset percentage in color math.
    return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
  }

  function normalizeHexColor(value, fallback = '#7dc89a') {
    const raw = String(value || '').trim(); // Parsed into a canonical #rrggbb body color for the aging transform.
    const shortMatch = raw.match(/^#([0-9a-f]{3})$/i); // Expands #rgb inputs used by some authored color configs.
    if (shortMatch) {
      const chars = shortMatch[1]; // Expanded below into one byte per RGB channel.
      return `#${chars[0]}${chars[0]}${chars[1]}${chars[1]}${chars[2]}${chars[2]}`.toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
    return String(fallback || '#7dc89a').toLowerCase();
  }

  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex); // Converted below to numeric channels for linear-light color math.
    const value = Number.parseInt(normalized.slice(1), 16); // Packed RGB integer used to split channels.
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function rgbToHex(r, g, b) {
    const channel = value => Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, '0'); // Keeps output channels valid after linear-light interpolation.
    return `#${channel(r)}${channel(g)}${channel(b)}`;
  }

  function bodyColorReferenceHex(profile) {
    const speciesId = String(profile?.fighter?.speciesId || '').trim(); // Resolves the same species swatch baseline used by the reference previewer.
    const normalized = speciesId.toLowerCase().replace(/_/g, '-'); // Supports both hyphenated and underscored species config keys.
    const speciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {}; // Supplies species-specific swatch baselines.
    const dyes = window.SCRATCHBONES_CONFIG?.game?.dyes || {}; // Supplies the global swatch baseline fallback.
    return speciesConfig[normalized]?.swatchBase || speciesConfig[speciesId]?.swatchBase || dyes.swatchBase || '#7dc89a';
  }

  function bodyColorDescriptorToHex(descriptor, profile) {
    if (descriptor?.hex) return normalizeHexColor(descriptor.hex, bodyColorReferenceHex(profile));
    const reference = bodyColorReferenceHex(profile); // Base color filtered by legacy h/s/v or h/s/l descriptor deltas below.
    if (!descriptor || (descriptor.h == null && descriptor.s == null && descriptor.v == null && descriptor.l == null)) return normalizeHexColor(reference);
    if (!agingColorProbeCanvas) agingColorProbeCanvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
    const ctx = agingColorProbeCanvas.getContext('2d', { willReadFrequently: true }); // Applies the same CSS-filter descriptor interpretation as the preview reference.
    const hueOffset = Number(window.SCRATCHBONES_CONFIG?.clothingHueOffset) || 0; // Shared authored hue correction used by existing portrait colors.
    const satOffset = Number(window.SCRATCHBONES_CONFIG?.clothingSatOffset) || 0; // Shared authored saturation correction used by existing portrait colors.
    const lightOffset = Number(window.SCRATCHBONES_CONFIG?.clothingLightOffset) || 0; // Shared authored brightness correction used by existing portrait colors.
    const hue = (Number(descriptor.h) || 0) + hueOffset; // Final CSS hue rotation used for the 1x1 probe.
    const saturation = Math.max(0, 1 + (Number(descriptor.s) || 0) + satOffset); // Final CSS saturation multiplier used for the 1x1 probe.
    const brightness = Math.max(0, 1 + (Number(descriptor.v ?? descriptor.l) || 0) + lightOffset); // Final CSS brightness multiplier used for the 1x1 probe.
    ctx.clearRect(0, 0, 1, 1);
    ctx.filter = `hue-rotate(${hue}deg) saturate(${saturation}) brightness(${brightness})`;
    ctx.fillStyle = reference;
    ctx.fillRect(0, 0, 1, 1);
    ctx.filter = 'none';
    const pixel = ctx.getImageData(0, 0, 1, 1).data; // Read back as concrete sRGB so the reference aging math can be applied exactly once.
    return rgbToHex(pixel[0], pixel[1], pixel[2]);
  }

  function srgbChannelToLinear(channel) {
    const value = Math.max(0, Math.min(1, Number(channel) / 255)); // Normalized sRGB channel converted to linear light below.
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function linearChannelToSrgb(channel) {
    const value = Math.max(0, Math.min(1, Number(channel) || 0)); // Clamped linear-light channel converted back to display sRGB below.
    const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055; // Standard sRGB transfer function used by the preview reference.
    return srgb * 255;
  }

  function relativeLuminance(rgb) {
    const r = srgbChannelToLinear(rgb.r); // Linear red channel used in perceptual luminance weighting.
    const g = srgbChannelToLinear(rgb.g); // Linear green channel used in perceptual luminance weighting.
    const b = srgbChannelToLinear(rgb.b); // Linear blue channel used in perceptual luminance weighting.
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function mixRgbLinear(fromRgb, toRgb, fraction) {
    const t = Math.max(0, Math.min(1, Number(fraction) || 0)); // Interpolation fraction used for every linear-light channel.
    const fromLinear = { // Linearized source channels used for interpolation.
      r: srgbChannelToLinear(fromRgb.r),
      g: srgbChannelToLinear(fromRgb.g),
      b: srgbChannelToLinear(fromRgb.b),
    };
    const toLinear = { // Linearized target channels used for interpolation.
      r: srgbChannelToLinear(toRgb.r),
      g: srgbChannelToLinear(toRgb.g),
      b: srgbChannelToLinear(toRgb.b),
    };
    return {
      r: linearChannelToSrgb(fromLinear.r + (toLinear.r - fromLinear.r) * t),
      g: linearChannelToSrgb(fromLinear.g + (toLinear.g - fromLinear.g) * t),
      b: linearChannelToSrgb(fromLinear.b + (toLinear.b - fromLinear.b) * t),
    };
  }

  function ageBodyColorHex(hex, settings) {
    const originalRgb = hexToRgb(hex); // Source body color transformed by the exact two-stage reference algorithm below.
    const age = clampPercent(settings.amount) / 100; // Master effect amount scales both desaturation and white mix.
    const desaturationFraction = age * (clampPercent(settings.desaturation) / 100); // Equal-luminance gray interpolation amount.
    const brighteningFraction = age * (clampPercent(settings.brightening) / 100); // Linear-light white interpolation amount.
    const luminance = relativeLuminance(originalRgb); // Perceived source luminance preserved while chroma is removed.
    const neutralChannel = linearChannelToSrgb(luminance); // Neutral gray channel matching the source luminance.
    const neutralRgb = { r: neutralChannel, g: neutralChannel, b: neutralChannel }; // Equal-luminance gray target for desaturation.
    const desaturatedRgb = mixRgbLinear(originalRgb, neutralRgb, desaturationFraction); // First stage: remove chroma without unintended lightening.
    const agedRgb = mixRgbLinear(desaturatedRgb, { r: 255, g: 255, b: 255 }, brighteningFraction); // Second stage: visibly brighten toward white.
    return rgbToHex(agedRgb.r, agedRgb.g, agedRgb.b);
  }

  function applyColorAging(profile, effect) {
    const nextBodyColors = { ...(profile?.bodyColors || {}) }; // Replaces only fur/feather body slots while leaving clothing/equipment tint slots untouched.
    const agedSlots = {}; // Captures before/after swatches for mobile-accessible runtime debug metadata.
    for (const slot of ['A', 'B', 'C']) {
      const descriptor = profile?.bodyColors?.[slot]; // Original authored body-color descriptor for this biological color slot.
      if (!descriptor) continue;
      const originalHex = bodyColorDescriptorToHex(descriptor, profile); // Concrete source swatch shown in debug metadata.
      const agedHex = ageBodyColorHex(originalHex, effect); // Reference old-age color result stored back as an exact hex shade-fill target.
      nextBodyColors[slot] = { hex: agedHex };
      agedSlots[slot] = { originalHex, agedHex };
    }
    profile.bodyColors = nextBodyColors;
    return agedSlots;
  }

  function frozenBreathingComposer(renderOptions, nowMs) {
    const source = renderOptions?.breathingComposer ?? window.portraitBreathingComposer ?? null; // Shared composer sampled once so split renders cannot drift a frame apart.
    if (!source) return null;
    return {
      getExpression(seatId) {
        return typeof source.getExpression === 'function' ? source.getExpression(seatId, nowMs) : 'neutral';
      },
      getOverlayOnlyPoints(_ignoredNowMs, seatId) {
        return typeof source.getOverlayOnlyPoints === 'function' ? source.getOverlayOnlyPoints(nowMs, seatId) : null;
      },
      getInterpolatedPoints(speciesId, gender, _ignoredNowMs, phaseOffsetMs, seatId) {
        return typeof source.getInterpolatedPoints === 'function'
          ? source.getInterpolatedPoints(speciesId, gender, nowMs, phaseOffsetMs, seatId)
          : null;
      },
      getAnimData(speciesId, gender) {
        return typeof source.getAnimData === 'function' ? source.getAnimData(speciesId, gender) : null;
      },
    };
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas'); // Temporary split-render/composite surface sized to the live portrait.
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function cloneCanvas(source) {
    const canvas = makeCanvas(source.width, source.height); // Snapshot of the full authored composite used for head extraction.
    canvas.getContext('2d').drawImage(source, 0, 0);
    return canvas;
  }

  function headContributionMask(fullCanvas, bodyOnlyCanvas) {
    const width = fullCanvas.width; // Pixel width shared by the full/body comparison and resulting mask.
    const height = fullCanvas.height; // Pixel height shared by the full/body comparison and resulting mask.
    const mask = makeCanvas(width, height); // White alpha mask isolating pixels contributed by the visible head stack.
    const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true }); // Reads the complete rendered portrait for pixel differences.
    const bodyCtx = bodyOnlyCanvas.getContext('2d', { willReadFrequently: true }); // Reads the matching render with head sprite/cosmetics omitted.
    const maskCtx = mask.getContext('2d', { willReadFrequently: true }); // Writes the amplified difference mask.
    const full = fullCtx.getImageData(0, 0, width, height); // Complete RGBA pixel buffer used below.
    const body = bodyCtx.getImageData(0, 0, width, height); // Body-only RGBA pixel buffer used below.
    const result = maskCtx.createImageData(width, height); // Output mask buffer filled with white + amplified difference alpha.
    for (let i = 0; i < result.data.length; i += 4) {
      const dr = Math.abs(full.data[i] - body.data[i]); // Red-channel difference contributing to head visibility.
      const dg = Math.abs(full.data[i + 1] - body.data[i + 1]); // Green-channel difference contributing to head visibility.
      const db = Math.abs(full.data[i + 2] - body.data[i + 2]); // Blue-channel difference contributing to head visibility.
      const da = Math.abs(full.data[i + 3] - body.data[i + 3]); // Alpha-channel difference contributing to head visibility.
      const difference = Math.max(dr, dg, db, da); // Strongest channel difference used by the reference mask.
      const alpha = Math.max(0, Math.min(255, difference * 5)); // Reference gain preserving antialiased edges while making clear differences opaque.
      result.data[i] = 255;
      result.data[i + 1] = 255;
      result.data[i + 2] = 255;
      result.data[i + 3] = alpha;
    }
    maskCtx.putImageData(result, 0, 0);
    return mask;
  }

  function extractVisibleHead(fullCanvas, bodyOnlyCanvas) {
    const head = cloneCanvas(fullCanvas); // Full portrait copy reduced to only the visible head contribution by destination-in below.
    const ctx = head.getContext('2d'); // Applies the full-vs-body difference mask without changing source RGB pixels.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(headContributionMask(fullCanvas, bodyOnlyCanvas), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    return head;
  }

  function composePostureInto(targetCanvas, bodyCanvas, headCanvas, posturePixels, frontOverlayCanvas = null) {
    targetCanvas.width = bodyCanvas.width;
    targetCanvas.height = bodyCanvas.height;
    const ctx = targetCanvas.getContext('2d'); // Rebuilds the portrait with body fixed and the extracted head lowered by the authored pixel amount.
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.drawImage(bodyCanvas, 0, 0);
    ctx.drawImage(headCanvas, 0, posturePixels);
    if (frontOverlayCanvas) ctx.drawImage(frontOverlayCanvas, 0, 0);
    return targetCanvas;
  }

  async function renderDirect(canvas, profile, options) {
    await window.renderPortraitProfile(canvas, profile, options); // Bypasses this wrapper intentionally for one split-render layer.
    return canvas;
  }

  async function applyPostureToCanvas(canvas, profile, renderOptions, effect) {
    const posturePixels = Math.max(0, Number(effect?.posturePixels) || 0); // Authored head-drop amount from the posture reference preset.
    if (!posturePixels || renderOptions?.onlyHeadSprite === true || renderOptions?.omitHeadSpriteAndCosmetics === true) return;

    const fullCanvas = cloneCanvas(canvas); // Stable full composite rendered by the original shared portrait pipeline.
    const isBehind = renderOptions?.portraitView === 'behind' || renderOptions?.view === 'behind'; // Selects the reference's specialized rear layering path.
    const bodyCanvas = makeCanvas(fullCanvas.width, fullCanvas.height); // Matching body-only render used to isolate the visible head stack.

    if (!isBehind) {
      const bodyOptions = { ...renderOptions, omitHeadSpriteAndCosmetics: true }; // Front-view body render keeps every non-head layer stationary.
      await renderDirect(bodyCanvas, profile, bodyOptions);
      const headCanvas = extractVisibleHead(fullCanvas, bodyCanvas); // Front visible-head pixels shifted downward below.
      const trimlessCanvas = canvas.__hobunjiFineHoodTrimlessCanvas; // Alternate Fine Hood front texture kept posture-matched when that dynamic shader is active.
      const trimlessFull = trimlessCanvas?.width === bodyCanvas.width && trimlessCanvas?.height === bodyCanvas.height
        ? cloneCanvas(trimlessCanvas)
        : null; // Snapshot before resizing the main target can disturb any linked alternate texture state.
      composePostureInto(canvas, bodyCanvas, headCanvas, posturePixels);

      if (trimlessCanvas && trimlessFull) {
        const trimlessHead = extractVisibleHead(trimlessFull, bodyCanvas); // Trimless visible head lowered by the same authored amount.
        composePostureInto(trimlessCanvas, bodyCanvas, trimlessHead, posturePixels);
      }
      return;
    }

    const bodyOptions = { // Rear body stack used only for visible-head extraction, matching the posture reference.
      ...renderOptions,
      portraitView: 'behind',
      omitHeadSpriteAndCosmetics: true,
      behindLayerOrder: POSTURE_BEHIND_BODY_LAYER_ORDER,
    };
    const baseUnderHead = makeCanvas(fullCanvas.width, fullCanvas.height); // Rear layers that must remain behind the lowered head.
    const overwearFront = makeCanvas(fullCanvas.width, fullCanvas.height); // Rear overwear layer restored in front after the lowered head is drawn.
    await renderDirect(bodyCanvas, profile, bodyOptions);
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
    const headCanvas = extractVisibleHead(fullCanvas, bodyCanvas); // Rear visible-head pixels shifted between the under-head and overwear stacks.
    composePostureInto(canvas, baseUnderHead, headCanvas, posturePixels, overwearFront);
  }

  api.buildProfileFromNpcExport = function buildProfileFromNpcExportWithOldAge(npc) {
    const profile = originalBuildProfile(npc); // Normal authored NPC profile remains the source of truth for cosmetics/body colors.
    const effect = resolveNpcEffect(npc); // Exact allowlist lookup determines whether this NPC is aged at all.
    if (!profile || !effect) return profile;
    const agedSlots = applyColorAging(profile, effect); // Applies the reference color transform only to body slots A/B/C.
    profile.__hobunjiNpcOldAgeEffect = Object.freeze({
      ...effect,
      agedSlots,
      source: 'HobunjiAvatarBodyAgingColorPreview-2 + HobunjiAvatarPosturePreview-11',
    });
    return profile;
  };

  api.renderProfileToCanvas = async function renderProfileToCanvasWithOldAge(canvas, profile, renderOptions = {}) {
    const effect = profile?.__hobunjiNpcOldAgeEffect || null; // Profile metadata installed only for the five exact allowlisted NPCs.
    if (!effect) return originalRenderProfile(canvas, profile, renderOptions);
    const renderNowMs = Date.now(); // Single animation sample time shared by full/body split renders to prevent breathing drift artifacts.
    const composer = frozenBreathingComposer(renderOptions, renderNowMs); // Optional frozen breathing adapter used for all layers in this render.
    const stableOptions = composer ? { ...renderOptions, breathingComposer: composer } : renderOptions; // Full and split renders receive identical animation state.
    const rendered = await originalRenderProfile(canvas, profile, stableOptions); // Builds the normal complete portrait first, preserving every existing hook.
    if (!rendered) return rendered;
    await applyPostureToCanvas(canvas, profile, stableOptions, effect);
    canvas.__hobunjiNpcOldAgeEffectDebug = {
      npcId: effect.npcId,
      npcName: effect.npcName,
      band: effect.bandLabel,
      posturePixels: effect.posturePixels,
      colorPreset: effect.colorLabel,
      ageEffectPercent: effect.amount,
      desaturationRatePercent: effect.desaturation,
      brighteningRatePercent: effect.brightening,
      bodyColorSlots: effect.agedSlots,
      clothingDyesUntouched: true,
    }; // Mobile-friendly debug payload inspectable by existing in-game/debug tooling without requiring console output.
    return rendered;
  };

  api.resolveOldAgeEffect = resolveNpcEffect; // Lets editors/debug tools ask whether an NPC is in the exact old-age allowlist.
  api.getOldAgeEffectDebug = canvas => canvas?.__hobunjiNpcOldAgeEffectDebug || null; // Lets runtime debug UI read the most recent render's age treatment.
  api.__oldAgeEffectsInstalled = true;

  window.HobunjiNpcOldAgeEffects = Object.freeze({
    assignments: ASSIGNMENTS,
    ageBands: AGE_BANDS,
    colorPresets: COLOR_PRESETS,
    resolveNpcEffect,
    getCanvasDebug: canvas => canvas?.__hobunjiNpcOldAgeEffectDebug || null,
  });
})();
