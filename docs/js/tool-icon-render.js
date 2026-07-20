// Tool/attack icon renderer — turns a tool's real sprite PNG into a small
// button icon, in place of a generic emoji, wherever the equipped tool has
// a known sprite (TOOL_ITEM_DEFS[key].sprite). Two icon kinds:
//   - "plain": the sprite trimmed to its opaque bounds and centered upright
//     (tool-select button, tool arc picker, harpoon "fish" action).
//   - attack styles ("jab" / "sweep" / "chop"): the sprite rotated into a
//     dynamic attack pose with a drawn motion-effect overlay, for the
//     weapon-slot cut/slash buttons and the axe-slot chop/hack buttons.
// Every sprite's "business end" (blade/point) sits at the bottom of its
// source image (see combat swing code's harpoon-sprite comments) — the
// rotation/effect math below all measures from that shared convention.
(() => {
  "use strict";

  const bboxCache   = new Map(); // spritePath -> { img, x, y, w, h }
  const iconCache   = new Map(); // "spritePath|style" -> data URL
  const pending     = new Set(); // spritePath currently loading/trimming
  const failedIcons = new Set(); // "spritePath|style" whose canvas export failed — stop retrying, always fall back

  function trimBBox(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    let data;
    try { data = ctx.getImageData(0, 0, w, h).data; }
    catch { return { x: 0, y: 0, w, h }; }
    const step = 2; // sample every other pixel — plenty for a bounding box
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return { x: 0, y: 0, w, h };
    const px0 = Math.max(0, minX - step), py0 = Math.max(0, minY - step);
    return {
      x: px0, y: py0,
      w: Math.min(w, maxX + step) - px0,
      h: Math.min(h, maxY + step) - py0,
    };
  }

  function ensureLoaded(spritePath, onReady) {
    if (bboxCache.has(spritePath) || pending.has(spritePath)) return;
    pending.add(spritePath);
    const img = new Image();
    // Request CORS mode so a same-path-but-different-effective-origin host
    // (e.g. a static-file CDN mirror that redirects behind the scenes)
    // doesn't taint the canvas we draw this into — same-origin loads (the
    // normal "serve docs/ as static files" deployment) are unaffected either
    // way. If the actual host doesn't send CORS headers, trimBBox/
    // renderDataURL below still catch the resulting SecurityError and fall
    // back to the emoji instead of throwing.
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const bbox = trimBBox(img);
      bboxCache.set(spritePath, { img, ...bbox });
      pending.delete(spritePath);
      onReady && onReady();
    };
    img.onerror = () => { pending.delete(spritePath); };
    img.src = spritePath;
  }

  // Registers an already-rendered canvas (e.g. a metal/verdigris-recolored
  // tool sprite from ToolMetalRecolor) under a synthetic key, so it can flow
  // through the exact same trim/rotate/effect pipeline as a plain sprite
  // path. Re-registering the same key overwrites the bbox entry and drops
  // any icons already cached for it — used when a tool's verdigris coverage
  // changes and its icon needs to be re-rendered (see invalidate()).
  function registerCanvasSource(key, canvas) {
    const bbox = trimBBox(canvas);
    bboxCache.set(key, { img: canvas, ...bbox });
  }

  // Drops a key's cached bbox/icons so the next getIconHTML/registerCanvasSource
  // call re-derives them — used when a metal-recolored tool's verdigris
  // fraction has moved on to a new rendered canvas.
  function invalidate(key) {
    bboxCache.delete(key);
    for (const cacheKey of [...iconCache.keys()]) if (cacheKey.startsWith(key + '|')) iconCache.delete(cacheKey);
    for (const cacheKey of [...failedIcons]) if (cacheKey.startsWith(key + '|')) failedIcons.delete(cacheKey);
  }

  // Angle (degrees) the trimmed sprite is rotated to, measured from its own
  // upright axis (business end/blade at the bottom of the source image).
  const STYLE_ANGLE = { plain: 0, jab: -48, sweep: 32, chop: -18 };

  function drawEffect(ctx, style, SS, tipX, tipY, dirX, dirY) {
    // dirX/dirY: unit vector from hilt toward the business end (the "attack
    // direction"), in the same unrotated icon space as tipX/tipY.
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.fillStyle   = 'rgba(255,255,255,0.88)';
    ctx.lineCap = 'round';

    if (style === 'jab') {
      // Three short parallel ticks extending straight ahead of the tip —
      // reads as a quick forward stab.
      ctx.lineWidth = SS * 0.045;
      const perpX = -dirY, perpY = dirX;
      const spacing = SS * 0.075;
      const len0 = SS * 0.13, gap = SS * 0.09;
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * spacing;
        const sx = tipX + perpX * off + dirX * gap;
        const sy = tipY + perpY * off + dirY * gap;
        const ex = sx + dirX * (len0 - i * SS * 0.02);
        const ey = sy + dirY * (len0 - i * SS * 0.02);
        ctx.globalAlpha = 1 - i * 0.22;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    } else if (style === 'sweep') {
      // A tapering arc swooshing past the blade — reads as a wide swing.
      const cx = SS / 2, cy = SS / 2;
      const r = SS * 0.40;
      const baseAng = Math.atan2(dirY, dirX);
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < 3; i++) {
        const spread = baseAng + (0.55 - i * 0.28);
        const a0 = spread - 0.62, a1 = spread + 0.22;
        ctx.lineWidth = SS * (0.05 - i * 0.012);
        ctx.globalAlpha = 0.85 - i * 0.28;
        ctx.beginPath();
        ctx.arc(cx, cy, r + i * SS * 0.05, a0, a1);
        ctx.stroke();
      }
    } else if (style === 'chop') {
      // A small radiating impact burst right at the tip.
      const n = 5;
      const baseAng = Math.atan2(dirY, dirX);
      ctx.lineWidth = SS * 0.035;
      for (let i = 0; i < n; i++) {
        const a = baseAng + (i - (n - 1) / 2) * 0.42;
        const r0 = SS * 0.05, r1 = SS * 0.16;
        ctx.globalAlpha = 0.9 - Math.abs(i - (n - 1) / 2) * 0.18;
        ctx.beginPath();
        ctx.moveTo(tipX + Math.cos(a) * r0, tipY + Math.sin(a) * r0);
        ctx.lineTo(tipX + Math.cos(a) * r1, tipY + Math.sin(a) * r1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  const RASTER_PX = 96; // fixed raster resolution — CSS scales the <img> to fit each button

  function renderDataURL(entry, style) {
    const SS = RASTER_PX;
    const c = document.createElement('canvas');
    c.width = SS; c.height = SS;
    const ctx = c.getContext('2d');
    const { img, x: bx, y: by, w: bw, h: bh } = entry;

    const angle = (STYLE_ANGLE[style] || 0) * Math.PI / 180;
    const fitFrac = style === 'plain' ? 0.88 : 0.72;
    const fitH = SS * fitFrac;
    const scale = fitH / bh;
    const dw = bw * scale, dh = bh * scale;

    ctx.save();
    ctx.translate(SS / 2, SS / 2);
    ctx.rotate(angle);
    ctx.drawImage(img, bx, by, bw, bh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    if (style !== 'plain') {
      // Business end sits at the bottom-center of the drawn (unrotated)
      // sprite, at local (0, dh/2) before rotation — rotate that point (and
      // the hilt→tip direction) into icon space to anchor the effect.
      const localTipX = 0, localTipY = dh / 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const tipX = SS / 2 + (localTipX * cos - localTipY * sin);
      const tipY = SS / 2 + (localTipX * sin + localTipY * cos);
      // Direction from hilt (local 0,-dh/2) to tip (local 0, dh/2), rotated.
      const dirX = 0 * cos - 1 * sin;
      const dirY = 0 * sin + 1 * cos;
      drawEffect(ctx, style, SS, tipX, tipY, dirX, dirY);
    }

    try {
      return c.toDataURL('image/png');
    } catch {
      // Tainted canvas (cross-origin sprite load with no usable CORS
      // headers) — give up on a real icon for this sprite/style rather than
      // throwing, so the caller's emoji fallback keeps working.
      return null;
    }
  }

  // Returns an <img> HTML string, or null if the sprite hasn't finished
  // loading/trimming yet (caller should keep its emoji fallback for this
  // call and try again next refresh). `cssSize` is any CSS length (e.g.
  // '1.3em') so the icon scales the same way the emoji it replaces did.
  function getIconHTML(spritePath, style, cssSize, altText) {
    if (!spritePath) return null;
    const key = spritePath + '|' + style;
    if (failedIcons.has(key)) return null;
    const size = cssSize || '1.3em';
    let dataURL = iconCache.get(key);
    if (!dataURL) {
      const entry = bboxCache.get(spritePath);
      if (!entry) { ensureLoaded(spritePath); return null; }
      dataURL = renderDataURL(entry, style);
      if (!dataURL) { failedIcons.add(key); return null; }
      iconCache.set(key, dataURL);
    }
    return `<img src="${dataURL}" class="tool-sprite-icon" alt="${altText || ''}" style="width:${size};height:${size};display:inline-block;vertical-align:middle;object-fit:contain;">`;
  }

  // Kicks off loading for a batch of sprite paths so icons are ready by the
  // time the UI first asks for them, instead of showing one frame of the
  // emoji fallback. Safe to call repeatedly with overlapping paths.
  function warm(spritePaths) {
    (spritePaths || []).forEach(p => p && ensureLoaded(p));
  }

  window.ToolIconRender = { getIconHTML, warm, registerCanvasSource, invalidate };
})();
