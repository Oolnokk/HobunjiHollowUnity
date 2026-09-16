(() => {
  'use strict';
  if (window.FarmGlancePalette) return;

  // Presentation-only pass for the Farm tab's top-down glance. FarmPanel keeps
  // ownership of the base map; this module overlays high-salience markers so
  // service boxes and live livestock no longer collapse into the same yellow.
  const MARKER_COLORS = Object.freeze({
    sell_crate: '#ff8a3d', // Used for the Shipping Box overlay and legend swatch.
    supply_box: '#6ea8ff', // Used for the Supply / Order Box overlay and legend swatch.
    livestock: '#ff8fd8', // Used for live livestock circles so animals are unmistakable on the map.
    livestockOutline: '#2b1022', // Used around livestock circles to keep them readable over bright tiles.
    markerOutline: '#1f2430', // Used around service-box overlays so adjacent colored tiles stay distinct.
  });

  let panelDeps = null; // Captured from FarmPanel.init and read by every overlay pass.
  let installed = false; // Prevents the FarmPanel methods from being wrapped more than once.
  let overlayPasses = 0; // Exposed in the mobile-friendly debug snapshot to confirm redraws are happening.

  function tileMetrics(canvas) {
    const cols = Math.max(1, Number(panelDeps?.COLS) || 1); // Used to convert farm columns into canvas X coordinates.
    const rows = Math.max(1, Number(panelDeps?.ROWS) || 1); // Used to convert farm rows into canvas Y coordinates.
    return {
      pxX: canvas.width / cols,
      pxY: canvas.height / rows,
    };
  }

  function drawServiceMarker(ctx, col, row, pxX, pxY, color, kind) {
    const x = col * pxX; // Full-tile X position replaces the core yellow service-box fill completely.
    const y = row * pxY; // Full-tile Y position replaces the core yellow service-box fill completely.
    const w = Math.max(2, pxX); // Full service-box tile width remains visible even when the map is downscaled.
    const h = Math.max(2, pxY); // Full service-box tile height remains visible even when the map is downscaled.
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = MARKER_COLORS.markerOutline;
    ctx.lineWidth = Math.max(1, Math.min(pxX, pxY) * 0.08);
    ctx.strokeRect(x, y, w, h);

    if (kind === 'supply_box') {
      const dotRadius = Math.max(1, Math.min(pxX, pxY) * 0.09); // Small center dot distinguishes ordering from shipping even without color.
      ctx.fillStyle = '#f5f8ff';
      ctx.beginPath();
      ctx.arc(col * pxX + pxX / 2, row * pxY + pxY / 2, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLivestockMarker(ctx, animal, pxX, pxY) {
    const col = Number(animal?.col); // Live farm-animal column used by FarmPanel's existing marker contract.
    const row = Number(animal?.row); // Live farm-animal row used by FarmPanel's existing marker contract.
    if (!Number.isFinite(col) || !Number.isFinite(row)) return false;
    const radius = Math.max(2, Math.min(pxX, pxY) * 0.34); // Slightly larger than the old dot for nighttime readability.
    ctx.fillStyle = MARKER_COLORS.livestock;
    ctx.strokeStyle = MARKER_COLORS.livestockOutline;
    ctx.lineWidth = Math.max(1, Math.min(pxX, pxY) * 0.10);
    ctx.beginPath();
    ctx.arc(col * pxX + pxX / 2, row * pxY + pxY / 2, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return true;
  }

  function recolorLegend() {
    const legend = document.getElementById('farmGridLegend'); // Existing FarmPanel legend updated in place instead of being replaced wholesale.
    if (!legend) return;
    const spans = [...legend.querySelectorAll('span')]; // Used to find the core legend entries by their stable visible labels.
    const crateEntry = spans.find(span => span.textContent?.trim() === 'Crate/box'); // Core combined crate entry is split into two explicit services below.
    const shippingEntry = spans.find(span => span.dataset?.farmGlanceKind === 'shipping') || crateEntry; // Reuses an already-patched entry on later renders.
    if (shippingEntry) {
      shippingEntry.dataset.farmGlanceKind = 'shipping';
      shippingEntry.innerHTML = `<i style="background:${MARKER_COLORS.sell_crate}"></i>Shipping box`;
      if (!legend.querySelector('[data-farm-glance-kind="supply"]')) {
        const supplyEntry = document.createElement('span'); // Added beside Shipping so the two yellow boxes no longer share one legend item.
        supplyEntry.dataset.farmGlanceKind = 'supply';
        supplyEntry.innerHTML = `<i style="background:${MARKER_COLORS.supply_box}"></i>Supply / order box`;
        shippingEntry.after(supplyEntry);
      }
    }

    const livestockEntry = [...legend.querySelectorAll('span')].find(span => span.textContent?.trim() === 'Livestock'); // Existing livestock legend entry recolored to match the new live marker.
    const livestockSwatch = livestockEntry?.querySelector('i'); // Only the swatch changes; the core label remains authoritative.
    if (livestockSwatch) livestockSwatch.style.background = MARKER_COLORS.livestock;
  }

  function applyPalette() {
    const canvas = document.getElementById('farmGlanceCanvas'); // FarmPanel's already-rendered base canvas receives only the distinguishing overlays.
    if (!canvas || !panelDeps) return false;
    const ctx = canvas.getContext('2d'); // Same 2D context FarmPanel uses for its base map.
    if (!ctx) return false;
    const { pxX, pxY } = tileMetrics(canvas); // Shared tile dimensions for boxes and livestock.

    panelDeps.worldObjects?.forEach?.((obj, key) => {
      if (!obj || (obj.type !== 'sell_crate' && obj.type !== 'supply_box')) return;
      const [col, row] = String(key).split(',').map(Number); // World-object key supplies the exact occupied farm tile.
      if (!Number.isFinite(col) || !Number.isFinite(row)) return;
      drawServiceMarker(ctx, col, row, pxX, pxY, MARKER_COLORS[obj.type], obj.type);
    });

    for (const animal of panelDeps.animalObjects || []) drawLivestockMarker(ctx, animal, pxX, pxY);
    recolorLegend();
    overlayPasses++;
    return true;
  }

  function install() {
    const panel = window.FarmPanel; // Public FarmPanel seam wrapped without reaching into its private render helpers.
    if (installed || !panel) return installed;
    installed = true;

    if (typeof panel.init === 'function') {
      const originalInit = panel.init; // Preserved so every existing FarmPanel dependency wrapper stays in the chain.
      panel.init = function farmGlancePaletteInit(injectedDeps, ...rest) {
        panelDeps = injectedDeps || null;
        return originalInit.call(this, injectedDeps, ...rest);
      };
    }

    if (typeof panel.render === 'function') {
      const originalRender = panel.render; // Preserved so the complete core Farm map renders before overlays are painted.
      panel.render = function farmGlancePaletteRender(...args) {
        const result = originalRender.apply(this, args);
        applyPalette();
        return result;
      };
    }

    return true;
  }

  function debugSnapshot() {
    const worldObjects = panelDeps?.worldObjects; // Used only for lightweight marker counts in the in-page diagnostic.
    const serviceCounts = { shipping: 0, supply: 0 }; // Reported so mobile testing can distinguish box markers from animals.
    worldObjects?.forEach?.(obj => {
      if (obj?.type === 'sell_crate') serviceCounts.shipping++;
      else if (obj?.type === 'supply_box') serviceCounts.supply++;
    });
    return {
      mostRecentChange: 'Farm glance now uses orange Shipping, blue Supply / Order, and pink outlined live-livestock markers instead of overlapping yellow markers.',
      installed,
      overlayPasses,
      liveLivestockMarkers: panelDeps?.animalObjects?.size ?? null,
      serviceCounts,
      colors: { ...MARKER_COLORS },
    };
  }

  window.FarmGlancePalette = { install, apply: applyPalette, debugSnapshot, colors: MARKER_COLORS };
  window.__farmGlancePaletteDebug = { snapshot: debugSnapshot, apply: applyPalette };
  install();
})();
