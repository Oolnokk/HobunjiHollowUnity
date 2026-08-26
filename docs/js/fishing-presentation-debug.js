// Presentation-only fixes/diagnostics layered over Fishing + Gullet events.
// Reuses the regular fish's live deformed texture so the Gullet gets the same
// wiggle and glow while keeping its own movement/collision state untouched.
(() => {
  'use strict';

  const GULLET_WIDTH_MULTIPLIER = 1.5; // Used to make the Gullet 1.5x the widest authored fish instead of 2x.
  const FALLBACK_FISH_GLOW = 'drop-shadow(0 0 2px rgba(255,255,255,0.95)) drop-shadow(0 0 6px rgba(255,255,255,0.65)) drop-shadow(0 0 11px rgba(255,255,255,0.4))'; // Used when the regular fish rig is not yet measurable.
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let gulletRoot = null; // Used to detect when a new Gullet encounter has rebuilt its SVG node.
  let gulletImage = null; // Used as the single live copy of the regular fish's deformed silhouette frame.
  let previousPoint = null; // Used to orient the Gullet from actual motion rather than radial circle angle.
  let headingDeg = 0; // Used to preserve facing during a momentarily stationary frame.

  function widestFishScales() {
    const entries = Array.isArray(window.FishCatalog?.entries) ? window.FishCatalog.entries : [];
    let maxX = 1, maxY = 1;
    for (const fish of entries) {
      maxX = Math.max(maxX, Number(fish?.minigameScaleX ?? fish?.minigameScale ?? 1) || 1);
      maxY = Math.max(maxY, Number(fish?.minigameScaleY ?? fish?.minigameScale ?? 1) || 1);
    }
    return { maxX, maxY };
  }

  function readTranslate(transform) {
    const match = String(transform || '').match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/);
    if (!match) return null;
    const x = Number(match[1]), y = Number(match[2]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function ensureRegularGulletVisual(root) {
    if (root === gulletRoot && gulletImage?.isConnected) return;
    gulletRoot = root;
    previousPoint = null;
    headingDeg = 0;
    root.replaceChildren();

    const visual = document.createElementNS(SVG_NS, 'g');
    visual.setAttribute('data-gullet-regular-fish-visual', 'true');
    // The regular deformed texture retains the source PNG's left-facing
    // orientation. Mirror it exactly like fishing-minigame's flipX=-1 path.
    visual.setAttribute('transform', 'scale(-1 1)');
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('data-gullet-deformed-image', 'true');
    visual.appendChild(image);
    root.appendChild(visual);
    gulletImage = image;

    const regularRig = document.getElementById('fishImageRig');
    const regularFilter = regularRig ? getComputedStyle(regularRig).filter : '';
    root.style.filter = regularFilter && regularFilter !== 'none' ? regularFilter : FALLBACK_FISH_GLOW;
  }

  function syncGulletVisual() {
    const root = document.getElementById('gulletFishSilhouette');
    if (!root) {
      gulletRoot = null;
      gulletImage = null;
      previousPoint = null;
      return;
    }
    ensureRegularGulletVisual(root);

    const regularImage = document.getElementById('fishDeformedImage');
    if (!regularImage || !gulletImage) return;
    const href = regularImage.getAttribute('href') || regularImage.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (href) gulletImage.setAttribute('href', href); // Copies the exact 12fps skinned/wiggling frame used by the ordinary fish.

    // fishDeformedImage's box includes the deformation canvas padding. Scaling
    // that whole box by authored X/Y scales preserves the regular fish's real
    // silhouette proportions while making only Gullet width 1.5x the widest fish.
    const rawW = Math.max(1, Number(regularImage.getAttribute('width')) || 100);
    const rawH = Math.max(1, Number(regularImage.getAttribute('height')) || 76);
    const { maxX, maxY } = widestFishScales();
    const width = rawW * maxX * GULLET_WIDTH_MULTIPLIER;
    const height = rawH * maxY;
    gulletImage.setAttribute('x', (-width / 2).toFixed(2));
    gulletImage.setAttribute('y', (-height / 2).toFixed(2));
    gulletImage.setAttribute('width', width.toFixed(2));
    gulletImage.setAttribute('height', height.toFixed(2));

    const point = readTranslate(root.getAttribute('transform'));
    if (!point) return;
    if (previousPoint) {
      const dx = point.x - previousPoint.x, dy = point.y - previousPoint.y;
      if (Math.hypot(dx, dy) > 0.025) headingDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    }
    previousPoint = point;
    // fishing-events owns position; this post-pass only corrects facing so the
    // long body lies along actual travel (including direction flips and dashes).
    root.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${headingDeg.toFixed(2)})`);
  }

  function ensureWaterDebugLine() {
    const panel = document.getElementById('fishingFeatureDebug');
    if (!panel) return null;
    let line = panel.querySelector('[data-amphibious-water-debug]');
    if (!line) {
      line = document.createElement('div');
      line.setAttribute('data-amphibious-water-debug', 'true');
      line.style.cssText = 'margin-top:4px;padding-top:4px;border-top:1px solid rgba(130,220,255,.28);font-weight:700;';
      const status = panel.querySelector('[data-status]');
      if (status?.nextSibling) panel.insertBefore(line, status.nextSibling);
      else if (status) status.after(line);
      else panel.prepend(line);
    }
    return line;
  }

  function updateWaterDebug() {
    const line = ensureWaterDebugLine();
    if (!line) return;
    const debug = window.AmphibiousFishing?.getDebug?.();
    if (!debug) {
      line.textContent = 'WATER CHECK: amphibious system unavailable';
      line.style.color = '#ffb58f';
      return;
    }
    const tile = debug.playerTile;
    const wet = debug.playerInWater === true;
    const tileText = tile ? `${tile.type || 'unknown'} @ ${tile.col},${tile.row}` : 'no tile';
    line.textContent = `WATER CHECK: ${wet ? 'YES' : 'NO'} | ${tileText}`;
    line.style.color = wet ? '#7fe89a' : '#ffb58f';
  }

  function frame() {
    syncGulletVisual();
    updateWaterDebug();
    requestAnimationFrame(frame);
  }

  window.FishingPresentationDebug = {
    water: () => window.AmphibiousFishing?.getDebug?.() || null,
    gulletWidthMultiplier: GULLET_WIDTH_MULTIPLIER,
  };

  requestAnimationFrame(frame);
})();
