// Shared, isolated Tool Hub 2D authoring renderer.
// The live game uses HobunjiWeaponSpriteAssemblies; this renderer merely visualizes its PNG layout.
(function (global) {
  'use strict';
  if (global.HobunjiMultiSpritePreviewRenderer) return;

  const alphaCache = new WeakMap(); // Reuses the original PNG's opaque rectangle and contact-point scans across both previews.
  const particles = new Map(); // Per-preview, per-layer ember pools; the head and combined panels cannot consume each other's particles.
  const MAX_PARTICLES = 32; // Mobile-friendly cap for every individual layer in each preview.
  const ALPHA_MIN = 4; // Includes antialiasing when fitting the visible illustration.
  const CONTACT_ALPHA = 128; // Physical connection points use the same solid-pixel cutoff as the game.
  let lastLayout = null; // Latest measured artwork positions for in-editor diagnostics.

  function sourceData(image) {
    if (!image) return null;
    let result = alphaCache.get(image);
    if (result) return result;
    const w = image.naturalWidth || image.width || 0, h = image.naturalHeight || image.height || 0;
    if (!(w > 0 && h > 0)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let rgba = null;
    try {
      context.drawImage(image, 0, 0);
      rgba = context.getImageData(0, 0, w, h).data;
    } catch (error) {
      // This is an authoring preview. Do not hide a valid loaded sprite merely
      // because a custom cross-origin image cannot expose alpha pixels.
      rgba = null;
    }
    let left = w, top = h, right = 0, bottom = 0;
    let topSum = 0, topCount = 0, bottomSum = 0, bottomCount = 0;
    let contactTop = -1, contactBottom = -1;
    if (rgba) for (let y = 0; y < h; y++) {
      let rowSum = 0, rowCount = 0;
      for (let x = 0; x < w; x++) {
        const a = rgba[(y * w + x) * 4 + 3];
        if (a >= ALPHA_MIN) {
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
        }
        if (a >= CONTACT_ALPHA) { rowSum += x; rowCount++; }
      }
      if (!rowCount) continue;
      if (contactTop < 0) { contactTop = y; topSum = rowSum; topCount = rowCount; }
      contactBottom = y; bottomSum = rowSum; bottomCount = rowCount;
    }
    if (!(left < right && top < bottom)) { left = 0; top = 0; right = w; bottom = h; }
    result = {
      width: w, height: h,
      opaque: { left, top, right, bottom },
      top: { x: contactTop < 0 ? (w - 1) / 2 : topSum / topCount, y: contactTop < 0 ? 0 : contactTop },
      bottom: { x: contactBottom < 0 ? (w - 1) / 2 : bottomSum / bottomCount, y: contactBottom < 0 ? h - 1 : contactBottom },
    };
    alphaCache.set(image, result);
    return result;
  }

  function anchor(image, spec, edge) {
    const meta = sourceData(image);
    if (!meta) return { x: 0, y: 0 };
    if (Number.isFinite(spec?.x) && Number.isFinite(spec?.y))
      return { x: Math.max(0, Math.min(meta.width - 1, spec.x)), y: Math.max(0, Math.min(meta.height - 1, spec.y)) };
    return meta[spec?.opaque === 'bottom' ? 'bottom' : spec?.opaque === 'top' ? 'top' : edge] || meta.top;
  }

  function rotate(x, y, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  function offset(part) {
    return { x: Number(part?.offsetPx?.x) || 0, y: Number(part?.offsetPx?.y) || 0 };
  }

  function pointOnSprite(image, x, y, part) {
    const size = sourceData(image);
    const o = offset(part);
    return { x: x - size.width / 2 + o.x, y: y - size.height / 2 + o.y };
  }

  function partScale(part) {
    const n = Number(part?.scale ?? 1); // Uses the same validated handle-relative multiplier as the gameplay assembly renderer.
    return Number.isFinite(n) ? Math.max(0.05, Math.min(8, n)) : 1;
  }

  function modelFor(def, lookup, progress, clock = 0) {
    const basePath = def.sprite || (def.flail?.chain ? 'assets/toolsprites/hachutu_torch-flail_handle.png' : '');
    const shaft = lookup(basePath);
    const flail = def.flail;
    const swing = progress > 0.001 && progress < .98;
    const shaftRotation = swing ? Math.sin(progress * Math.PI * 2) * .32 : 0;
    const model = {
      shaft, basePath, shaftRotation, baseLayers: def.layers || [],
      flail, parts: flail?.head?.layers || [], pivot: null,
      chain: null, chainTop: null, chainBottom: null, chainRotation: 0,
      headOrigin: null, headPosition: null, headRotation: 0,
      chainScale: partScale(flail?.chain), headScale: partScale(flail?.head), // Both ratios reference the unmodified shaft pixels, not each other.
    }; // Used by both independently fitted canvases; source pixels remain authoritative.
    if (!shaft || !flail) return model;
    const chain = lookup(flail.chain?.sprite);
    if (!chain) return model;
    model.chain = chain;
    const baseAnchor = anchor(shaft, flail.haftAnchor, 'top');
    const p = pointOnSprite(shaft, baseAnchor.x + .5, baseAnchor.y + .5);
    model.pivot = rotate(p.x, p.y, shaftRotation);
    model.chainTop = anchor(chain, flail.chain?.top, 'top');
    model.chainBottom = anchor(chain, flail.chain?.bottom, 'bottom');
    const cx = model.chainBottom.x - model.chainTop.x;
    const cy = model.chainBottom.y - model.chainTop.y;
    const len = Math.hypot(cx, cy);
    const tilt = swing
      ? Math.sin(progress * Math.PI * 2) * (0.8 + (Number(flail.motion?.lag) || .065))
      : Math.sin(clock * .0013) * .04;
    const angle = Math.PI / 2 + tilt;
    model.chainRotation = angle - Math.atan2(cy, cx);
    model.headPosition = {
      x: model.pivot.x + Math.cos(angle) * len * model.chainScale,
      y: model.pivot.y + Math.sin(angle) * len * model.chainScale, // The hanging span grows relative to the existing handle size.
    }; // Physical chain span uses the actual opaque endpoint distance, not its entire canvas height.
    const head = flail.head;
    const target = model.parts.find(part => part.id === head?.anchorLayer) || model.parts[0];
    const targetImage = lookup(target?.sprite);
    if (!targetImage) return model;
    const headContact = anchor(targetImage, head?.anchor, 'bottom');
    const origin = pointOnSprite(targetImage, headContact.x + .5, headContact.y + .5, target);
    model.headRotation = swing ? tilt : 0;
    const rotatedContact = rotate(origin.x, origin.y, model.headRotation);
    model.headOrigin = {
      x: model.headPosition.x - rotatedContact.x * model.headScale,
      y: model.headPosition.y - rotatedContact.y * model.headScale, // Independent head sizing preserves contact at chain end.
    }; // Every head layer is positioned relative to this same corrected contact anchor.
    return model;
  }

  function emptyBounds() { return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; }
  function addPoint(b, x, y) {
    b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y);
  }
  function addOpaque(b, image, origin, angle = 0, part = null, relativeTo = null, scale = 1) {
    const data = sourceData(image);
    if (!data) return;
    const o = offset(part), a = data.opaque;
    const corners = [
      [a.left, a.top], [a.right, a.top], [a.right, a.bottom], [a.left, a.bottom],
    ];
    for (const [x, y] of corners) {
      const p = rotate(x - data.width / 2 + o.x - (relativeTo?.x || 0),
        y - data.height / 2 + o.y - (relativeTo?.y || 0), angle);
      addPoint(b, origin.x + p.x * scale, origin.y + p.y * scale); // The combined auto-fit must include part-specific scaling or the head can clip again.
    }
  }

  function boundsFor(model, lookup, kind, soloIndex = -1, stackTarget = 'head') {
    const bounds = emptyBounds();
    if (kind === 'head') {
      if (model.flail && stackTarget === 'head') {
        model.parts.forEach((part, i) => {
          if (soloIndex < 0 || i === soloIndex) addOpaque(bounds, lookup(part.sprite), { x: 0, y: 0 }, 0, part);
        });
      } else {
        if (soloIndex < 0) addOpaque(bounds, model.shaft, { x: 0, y: 0 });
        model.baseLayers.forEach((part, i) => {
          if (soloIndex < 0 || i === soloIndex) addOpaque(bounds, lookup(part.sprite), { x: 0, y: 0 }, 0, part);
        });
      }
    } else {
      addOpaque(bounds, model.shaft, { x: 0, y: 0 }, model.shaftRotation);
      model.baseLayers.forEach(part => addOpaque(bounds, lookup(part.sprite), { x: 0, y: 0 }, model.shaftRotation, part));
      if (model.chain && model.pivot) {
        const top = model.chainTop, d = sourceData(model.chain);
        addOpaque(bounds, model.chain, model.pivot, model.chainRotation, null, {
          x: top.x + .5 - d.width / 2, y: top.y + .5 - d.height / 2,
        }, model.chainScale);
        addPoint(bounds, model.pivot.x, model.pivot.y);
      }
      if (model.headOrigin) model.parts.forEach(part => addOpaque(bounds,
        lookup(part.sprite), model.headOrigin, model.headRotation, part, null, model.headScale));
      if (model.headPosition) addPoint(bounds, model.headPosition.x, model.headPosition.y);
    }
    if (!Number.isFinite(bounds.minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1, empty: true };
    return bounds;
  }

  function fit(bounds, width, height) {
    const rangeX = Math.max(1, bounds.maxX - bounds.minX);
    const rangeY = Math.max(1, bounds.maxY - bounds.minY);
    const zoom = Math.min(12, Math.max(.001, Math.min(width * .82 / rangeX, height * .80 / rangeY)));
    return {
      zoom, x: width / 2 - (bounds.minX + bounds.maxX) / 2 * zoom,
      y: height / 2 - (bounds.minY + bounds.maxY) / 2 * zoom,
      // A fit of the complete assembly always includes shaft + chain + head.
      visibleWidth: rangeX * zoom, visibleHeight: rangeY * zoom,
    };
  }

  function drawSprite(ctx, img, x, y, angle = 0, part = null) {
    if (!img) return;
    const o = offset(part);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    ctx.drawImage(img, -img.width / 2 + o.x, -img.height / 2 + o.y, img.width, img.height);
    ctx.restore();
  }

  function emitFire(ctx, view, part, index, source, options) {
    const spec = part.vfx;
    if (!spec || spec.type !== 'fire' || !source) return;
    const picks = options.effects?.sourcePixels?.(source, spec.sourceHex || part.sourceHex || '#7F00FF', 'marker') || [];
    if (!picks.length) return;
    const owner = view + ':' + options.weaponKey + ':' + part.id + ':' + index;
    let pool = particles.get(owner);
    if (!pool) { pool = { items: [], fraction: 0 }; particles.set(owner, pool); }
    const dt = Math.max(0, Math.min(.05, Number(options.dt) || 0));
    const color = spec.colors?.length ? spec.colors : ['#FFAA3E'];
    for (let i = pool.items.length - 1; i >= 0; i--) {
      const ember = pool.items[i]; ember.age += dt;
      if (ember.age >= ember.life) { pool.items.splice(i, 1); continue; }
      const t = ember.age / ember.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, .9 * Math.sin(Math.PI * t));
      ctx.fillStyle = ember.color;
      ctx.beginPath();
      ctx.arc(ember.x + Math.sin(t * 10 + ember.phase) * 2.5,
        ember.y - ember.speed * ember.age, ember.radius * (.6 + t), 0, Math.PI * 2);
      ctx.fill(); ctx.restore();
    }
    if (options.playing === false) return;
    pool.fraction = Math.min(3, pool.fraction + dt * Math.min(40, Math.max(0, Number(spec.rate) || 0)));
    const dim = sourceData(source); if (!dim) return;
    while (pool.fraction >= 1 && pool.items.length < MAX_PARTICLES) {
      pool.fraction--;
      const pixel = picks[Math.floor(Math.random() * picks.length)];
      const off = offset(part);
      pool.items.push({
        x: pixel % dim.width + .5 - dim.width / 2 + off.x,
        y: Math.floor(pixel / dim.width) + .5 - dim.height / 2 + off.y,
        age: 0, life: Math.max(.1, Number(spec.life) || .65),
        speed: dim.height * Math.max(.01, Number(spec.speed) || .12),
        radius: Math.max(1.5, (Number(spec.size) || .035) * dim.width * .55),
        color: color[Math.floor(Math.random() * color.length)],
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function drawLayers(ctx, view, parts, lookup, paint, options, soloIndex = -1) {
    parts.forEach((part, i) => {
      if (soloIndex >= 0 && soloIndex !== i) return;
      drawSprite(ctx, paint(part), 0, 0, 0, part);
      // Flames intentionally render AFTER their fuel sprite and BEFORE each
      // subsequent opaque sprite; they do not get painted over the front.
      emitFire(ctx, view, part, i, lookup(part.sprite), options);
    });
  }

  function drawCanvas(canvas, kind, model, lookup, paint, options = {}) {
    if (!canvas || !model) return null;
    const width = Math.max(1, canvas.clientWidth || 640);
    const height = Math.max(1, canvas.clientHeight || 320);
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * dpr)), pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth; canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d'); if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Logical CSS-pixel coordinate system on high DPI phones.
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0f1b29'; ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1; ctx.strokeStyle = '#27384b';
    for (let x = 0; x < width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    const soloIndex = kind === 'head' && options.solo === true ? options.selected : -1;
    const b = boundsFor(model, lookup, kind, soloIndex, options.stackTarget);
    const transform = fit(b, width, height);
    ctx.save();
    ctx.translate(transform.x, transform.y); ctx.scale(transform.zoom, transform.zoom);
    if (kind === 'head') {
      if (model.flail && options.stackTarget === 'head') {
        drawLayers(ctx, 'head', model.parts, lookup, paint, options, soloIndex);
      } else {
        if (soloIndex < 0) drawSprite(ctx, paint({ sprite: model.basePath, material: 'metal' }), 0, 0);
        drawLayers(ctx, 'head', model.baseLayers, lookup, paint, options, soloIndex);
      }
    } else {
      drawSprite(ctx, paint({ sprite: model.basePath, material: 'metal' }), 0, 0, model.shaftRotation);
      for (const part of model.baseLayers) {
        ctx.save(); ctx.rotate(model.shaftRotation);
        drawSprite(ctx, paint(part), 0, 0, 0, part);
        ctx.restore();
      }
      if (model.chain && model.pivot) {
        const dim = sourceData(model.chain);
        const ct = model.chainTop;
        ctx.save(); ctx.translate(model.pivot.x, model.pivot.y);
        ctx.rotate(model.chainRotation);
        ctx.scale(model.chainScale, model.chainScale); // Same shaft-relative chain magnification as the main game.
        const chainTexture = paint({ ...model.flail.chain, sprite: model.flail.chain.sprite });
        if (chainTexture) ctx.drawImage(chainTexture, -ct.x - .5, -ct.y - .5, dim.width, dim.height);
        ctx.restore();
      }
      if (model.headOrigin) {
        ctx.save();
        ctx.translate(model.headOrigin.x, model.headOrigin.y);
        ctx.rotate(model.headRotation);
        ctx.scale(model.headScale, model.headScale); // Scale all head meshes, layer offsets and inset fire together.
        drawLayers(ctx, 'combined', model.parts, lookup, paint, options);
        ctx.restore();
      }
      for (const [p, color] of [[model.pivot, '#83bcff'], [model.headPosition, '#ffc769']]) {
        if (!p) continue;
        ctx.fillStyle = color; ctx.beginPath();
        ctx.arc(p.x, p.y, 3 / transform.zoom, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    if (b.empty) {
      ctx.fillStyle = '#a9c5dc'; ctx.font = '12px sans-serif';
      ctx.fillText(kind === 'head' ? 'Head layers have no loaded pixels yet.' : 'Weapon sprites are loading…', 12, height / 2);
    }
    lastLayout = lastLayout || {};
    lastLayout[kind] = {
      bounds: b, fit: transform,
      partsReady: model.parts.filter(part => !!lookup(part.sprite)).length,
      partsExpected: model.parts.length,
      chainReady: !!model.chain, haftReady: !!model.shaft,
      joint: model.headPosition,
      chainScale: model.chainScale, headScale: model.headScale, // Mobile diagnostics expose ratios and prevent mistaken interpretation of independently auto-fitted detail view.
    };
    return lastLayout[kind];
  }

  function resetEffects() {
    particles.clear(); // A weapon/layer change invalidates old ember pools in both previews.
  }

  global.HobunjiMultiSpritePreviewRenderer = Object.freeze({
    modelFor, boundsFor, fit, drawCanvas, resetEffects,
    debugSnapshot: () => lastLayout ? JSON.parse(JSON.stringify(lastLayout)) : null,
  });
})(window);
