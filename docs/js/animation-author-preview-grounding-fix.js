// Animation Author gameplay-grounding parity test.
//
// PNGPlaneAvatar.buildSinglePlaneAvatarModel already aligns the authored
// portrait ground-contact pixel to model-root Y=0. Gameplay has relied on that
// contract since 2026-06-18 (48ee7da), when its redundant avatarHeight/2 lift
// was removed. Animation Author later reintroduced that obsolete half-height
// assumption in portraitModelMetrics/installCharacterRuntimePreviewLift and in
// portraitPixelToFloorPoint. This late guard removes only that stale +H/2.
(() => {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname || '')) return;

  const PATCH_ID = 'animation-author-gameplay-grounding-v1';

  function install() {
    if (typeof portraitModelMetrics !== 'function'
      || typeof portraitPixelToFloorPoint !== 'function'
      || typeof installCharacterRuntimePreviewLift !== 'function') return false;
    if (window.__hobunjiAnimationAuthorGameplayGrounding === PATCH_ID) return true;

    const previousMetrics = portraitModelMetrics;
    portraitModelMetrics = function gameplayGroundedPortraitMetrics(actor) {
      const metrics = previousMetrics.apply(this, arguments);
      const height = Number(metrics?.modelHeight) || 0;
      const staleHalfHeight = height / 2;
      return {
        ...metrics,
        // buildSinglePlaneAvatarModel already has a floor-relative root.
        groundLiftY: 0,
        canvasBottomY: Number(metrics.canvasBottomY || 0) - staleHalfHeight,
        canvasTopY: Number(metrics.canvasTopY || 0) - staleHalfHeight,
        canvasCenterY: Number(metrics.canvasCenterY || 0) - staleHalfHeight,
        gameplayGroundingParity: true,
      };
    };

    portraitPixelToFloorPoint = function gameplayGroundedPortraitPixelToFloorPoint(metrics, pixelX, pixelY) {
      const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
      const modelWidth = Math.max(.001, finite(metrics?.modelWidth, 1));
      const modelHeight = Math.max(.001, finite(metrics?.modelHeight, 1));
      const pixelWidth = Math.max(1, finite(metrics?.pixelWidth, 200));
      const pixelHeight = Math.max(1, finite(metrics?.pixelHeight, 200));
      const placementRatio = finite(metrics?.placementRatio, .5);
      return {
        x: -modelWidth / 2 + ((finite(pixelX) + .5) / pixelWidth) * modelWidth,
        // Plane-local Y is (.5-pixelRatio)*H and the assembly is already at
        // (placement-.5)*H, so the .5 terms cancel. The old author kept one.
        y: modelHeight * (placementRatio - (finite(pixelY) + .5) / pixelHeight),
      };
    };

    // Re-run only the visual presentation/box placement for actors already on
    // screen. No authored rig profile value is changed by this patch.
    try {
      for (const actor of animationAuthor?.actors || []) {
        if (actor?.source?.type !== 'npc') continue;
        installCharacterRuntimePreviewLift(actor);
      }
      updateAnimationSelectionBox?.();
      attachAnimationGizmo?.();
    } catch (error) {
      console.warn('[animation-author-grounding] existing preview refresh failed:', error);
    }

    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.previewGrounding = 'PNGPlaneAvatar floor-root parity; stale +modelHeight/2 removed';
    window.__hobunjiAnimationAuthorGameplayGrounding = PATCH_ID;
    console.info('[animation-author-grounding] removed obsolete preview +modelHeight/2 offset');
    return true;
  }

  function installWhenReady() {
    if (install()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (install() || ++attempts >= 240) clearInterval(timer);
    }, 50);
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
  else installWhenReady();
})();
