// Expands procedural arm reach from the raw arm-sprite scan.
// Baseline reach is +20%. If the raw arm sprite would still extend below the
// midpoint elbow, lengthen the whole arm until that lowest opaque pixel is no
// farther down than the elbow.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  if (!hands?.attach || hands.attach.__hobunjiExpandedArmReachWrapped) return;

  const BASE_MULTIPLIER = 1.20;

  function portraitPointToLocal(point, avatarRoot) {
    if (!point || !avatarRoot?.userData) return null;
    const modelWidth = Number(avatarRoot.userData.portraitModelWidth) || 0.9;
    const modelHeight = Number(avatarRoot.userData.portraitModelHeight) || modelWidth;
    const placementRatio = Number(avatarRoot.userData.portraitVerticalPlacementRatio) || 0.5;
    return {
      x: -modelWidth / 2 + Number(point.xRatio) * modelWidth,
      y: modelHeight * (0.5 + placementRatio - Number(point.yRatio)),
      z: 0,
    };
  }

  function expandedAttachments(options) {
    const source = options?.armAttachments;
    if (!source) return source;
    const scan = source.source || options?.avatarRoot?.userData?.armAttachments?.source || null;
    const out = {
      ...source,
      left: source.left ? { ...source.left, shoulder: { ...source.left.shoulder }, idleHand: { ...source.left.idleHand } } : source.left,
      right: source.right ? { ...source.right, shoulder: { ...source.right.shoulder }, idleHand: { ...source.right.idleHand } } : source.right,
    };

    for (const side of ['left', 'right']) {
      const rec = out[side];
      if (!rec?.shoulder) continue;
      const original = Math.max(0, Number(rec.armLength) || 0);
      const baseline = original * BASE_MULTIPLIER;
      const lastOpaque = portraitPointToLocal(scan?.[side]?.hand, options.avatarRoot);
      const spriteUpperArmDepth = lastOpaque
        ? Math.max(0, Number(rec.shoulder.y) - Number(lastOpaque.y))
        : 0;
      // Elbow is the midpoint of the total reach. Make that midpoint at least
      // as low as the raw arm sprite's last opaque pixel.
      const spriteRequired = spriteUpperArmDepth * 2;
      rec.armLength = Math.max(baseline, spriteRequired, original);
      rec.baseArmLength = original;
      rec.spriteRequiredArmLength = spriteRequired;
      rec.armLengthMultiplier = original > 0 ? rec.armLength / original : BASE_MULTIPLIER;
    }
    return out;
  }

  const originalAttach = hands.attach.bind(hands);
  hands.attach = function expandedArmReachAttach(THREE, parent, options = {}) {
    const next = { ...options };
    next.armAttachments = expandedAttachments(options);
    if (next.avatarRoot?.userData && next.armAttachments) next.avatarRoot.userData.armAttachments = next.armAttachments;
    const rig = originalAttach(THREE, parent, next);
    if (!rig) return rig;

    const originalDebug = rig.getDebug?.bind(rig);
    if (originalDebug) {
      rig.getDebug = function expandedArmReachDebug() {
        const debug = originalDebug() || {};
        return {
          ...debug,
          expandedArmReach: {
            multiplier: BASE_MULTIPLIER,
            left: next.armAttachments?.left ? {
              base: next.armAttachments.left.baseArmLength,
              final: next.armAttachments.left.armLength,
              spriteRequired: next.armAttachments.left.spriteRequiredArmLength,
            } : null,
            right: next.armAttachments?.right ? {
              base: next.armAttachments.right.baseArmLength,
              final: next.armAttachments.right.armLength,
              spriteRequired: next.armAttachments.right.spriteRequiredArmLength,
            } : null,
          },
        };
      };
    }
    return rig;
  };
  hands.attach.__hobunjiExpandedArmReachWrapped = true;

  global.ProceduralHandArmLength = Object.freeze({ baseMultiplier: BASE_MULTIPLIER });
})(window);
