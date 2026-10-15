// Foundry composition and deterministic gear definitions. No per-frame composition work.
(function (global) {
  'use strict';
  const SCHEMA = 'hobunji_modular_weapons.v1'; // Validated editor import format.
  const DRAFT_KEY = 'hobunji.modularWeapons.v2'; // New calibration/rules baseline; the old draft remains stored separately.
  const transforms = ['scaleX', 'scaleY', 'flipX', 'flipY', 'x', 'y', 'rotation']; // Inheritable head placement fields.
  const images = new Map(); // CORS image promises reused across combinations.
  const alphaBounds = new WeakMap(); // Each source bitmap is scanned once when finding visible composition bounds.
  const canvases = new Map(); // Bounded composed sprites, created only when requested.
  let config = global.MODULAR_WEAPON_CONFIG; // Current authored attachment data.
  let revision = 0; // Discards stale preview renders after edits.

  function finite(value, fallback, min, max) {
    const number = Number(value); // Rejects malformed editor transforms.
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }
  function point(raw) {
    return { x: finite(raw?.x, 225, 0, 450), y: finite(raw?.y, 602, 0, 1204) };
  }
  function cleanTransform(raw, partial = false, fallbackAnimation = 'sweep') {
    const result = {}; // Sparse overrides preserve unchecked inheritance.
    for (const key of transforms) {
      if (partial && !Object.hasOwn(raw || {}, key)) continue;
      result[key] = key.startsWith('flip') ? raw?.[key] === true
        : finite(raw?.[key], key.startsWith('scale') ? 1 : 0, key.startsWith('scale') ? 0.05 : -2400, key.startsWith('scale') ? 8 : 2400);
    }
    if (raw?.animation === 'thrust' || raw?.animation === 'sweep') result.animation = raw.animation;
    else if (!partial) result.animation = fallbackAnimation;
    return result;
  }
  function replace(data, persist = false) {
    if (data?.schema !== SCHEMA || !data.heads || !data.shafts) throw new Error('Invalid modular weapon attachment file.');
    const next = JSON.parse(JSON.stringify(global.MODULAR_WEAPON_CONFIG)); // Catalog paths/ownership cannot be changed by a placement import.
    for (const [key, head] of Object.entries(next.heads)) head.attach = point(data.heads[key]?.attach || head.attach);
    for (const [key, shaft] of Object.entries(next.shafts)) {
      const raw = data.shafts[key] || shaft; // Missing imported entries retain committed defaults.
      shaft.attachments = (Array.isArray(raw.attachments) && raw.attachments.length ? raw.attachments : shaft.attachments).slice(0, shaft.maxAttachments || 8).map(value => ({ ...point(value), rotation: finite(value.rotation, 0, -360, 360) }));
      shaft.defaults = cleanTransform(raw.defaults, false, shaft.defaults.animation || 'sweep');
      const committedOverrides = shaft.overrides; // Missing legacy flags inherit the committed pair restrictions.
      shaft.overrides = {};
      for (const [head, values] of Object.entries(raw.overrides || {})) if (Object.hasOwn(next.heads, head)) {
        shaft.overrides[head] = cleanTransform(values, true);
        if (typeof values.disallow === 'boolean') shaft.overrides[head].disallow = values.disallow;
      }
      for (const [head, values] of Object.entries(committedOverrides || {})) {
        if (values.animation && !raw.defaults?.animation && !shaft.overrides[head]?.animation) {
          if (!shaft.overrides[head]) shaft.overrides[head] = {};
          shaft.overrides[head].animation = values.animation;
        }
        if (typeof values.disallow !== 'boolean' || typeof shaft.overrides[head]?.disallow === 'boolean') continue;
        if (!shaft.overrides[head]) shaft.overrides[head] = {};
        shaft.overrides[head].disallow = values.disallow;
      }
    }
    config = next;
    revision++;
    canvases.clear();
    if (persist) global.localStorage?.setItem(DRAFT_KEY, JSON.stringify(config));
    return config;
  }
  function decode(key) {
    const match = /^modular:([^:]+):([^:]+):([^:]+)$/.exec(String(key || '')); // Stable keys survive ordinary gear save/restore.
    return match && config.shafts[match[1]] && config.heads[match[2]] ? { shaft: match[1], head: match[2], metal: match[3] } : null;
  }
  function itemKey(shaft, head, metal) { return `modular:${shaft}:${head}:${metal}`; }
  function sourceShape(key) {
    const parts = decode(key); // Grip, scale, hand mode, and pose always use the donor shaft.
    return parts ? config.shafts[parts.shaft].sourceShape : null;
  }
  function settings(shaft, head) { return { ...config.shafts[shaft].defaults, ...config.shafts[shaft].overrides[head] }; }
  function isDisallowed(shaft, head) {
    return !Object.hasOwn(config.shafts, shaft) || !Object.hasOwn(config.heads, head) || config.shafts[shaft].overrides[head]?.disallow === true;
  }
  function loadImage(path, base = '') {
    const url = base + path; // Editors supply the docs-relative prefix.
    if (!images.has(url)) images.set(url, new Promise((resolve, reject) => {
      const image = new Image(); // Reused original bitmap; CORS must precede src.
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => { images.delete(url); reject(new Error(`Could not load ${path}`)); };
      image.src = url;
    }));
    return images.get(url);
  }
  function headTransform(attach, values, pivot) {
    const angle = (attach.rotation + values.rotation) * Math.PI / 180; // Combined head rotation, applied after socket-local translation.
    const socketAngle = attach.rotation * Math.PI / 180; // Socket orientation also rotates the translation.
    const sx = values.scaleX * (values.flipX ? -1 : 1), sy = values.scaleY * (values.flipY ? -1 : 1); // Signed scales preserve mirrored attachment geometry.
    const a = Math.cos(angle) * sx, b = Math.sin(angle) * sx, c = -Math.sin(angle) * sy, d = Math.cos(angle) * sy; // Canvas affine matrix, including pivot displacement.
    return { a, b, c, d,
      e: attach.x + Math.cos(socketAngle) * values.x - Math.sin(socketAngle) * values.y - a * pivot.x - c * pivot.y,
      f: attach.y + Math.sin(socketAngle) * values.x + Math.cos(socketAngle) * values.y - b * pivot.x - d * pivot.y };
  }
  function compositionFrame(shaft, head, bounds, values) {
    let left = 0, top = 0, right = 450, bottom = 1204; // Keep the complete donor frame as the fixed grip reference.
    for (const attach of shaft.attachments) {
      const matrix = headTransform(attach, values, head.attach); // Bounds and drawing use exactly the same affine transform.
      for (const x of [bounds.left, bounds.right]) for (const y of [bounds.top, bounds.bottom]) {
        const px = matrix.a * x + matrix.c * y + matrix.e, py = matrix.b * x + matrix.d * y + matrix.f; // Transformed source-bound corner.
        left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px); bottom = Math.max(bottom, py);
      }
    }
    left = Math.floor(left) - 4; top = Math.floor(top) - 4; // Transparent padding protects filtered edge pixels and recolor outlines.
    return { left, top, width: Math.ceil(right) + 4 - left, height: Math.ceil(bottom) + 4 - top };
  }
  function visibleBounds(image) {
    if (alphaBounds.has(image)) return alphaBounds.get(image);
    const sample = document.createElement('canvas'); // Read original source alpha in its authored coordinate frame.
    sample.width = 450; sample.height = 1204;
    const context = sample.getContext('2d', { willReadFrequently: true }); // One-time scan, never part of a render frame.
    context.drawImage(image, 0, 0, 450, 1204);
    const pixels = context.getImageData(0, 0, 450, 1204).data; // Include even faint authored pixels to avoid silently trimming material.
    let left = 450, top = 1204, right = 0, bottom = 0; // Nonzero-alpha source envelope.
    for (let y = 0; y < 1204; y++) for (let x = 0; x < 450; x++) if (pixels[(y * 450 + x) * 4 + 3]) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
    const bounds = right ? { left, top, right, bottom } : { left: 0, top: 0, right: 0, bottom: 0 }; // Empty assets still retain the donor frame.
    alphaBounds.set(image, bounds);
    return bounds;
  }
  function planeLayout(canvas, referenceWidth = 0.5) {
    const frame = canvas?.modularFrame || { left: 0, top: 0, width: 450, height: 1204 }; // Layout uses logical authoring pixels, independent of bitmap downsampling.
    const unit = referenceWidth / 450; // Same world units per authored pixel as every original weapon.
    return { width: frame.width * unit, height: frame.height * unit,
      x: (frame.left + frame.width / 2 - 225) * unit,
      y: -(frame.top + frame.height / 2 - 602) * unit };
  }
  function fitPlaneGeometry(geometry, canvas, referenceWidth = 0.5) {
    const layout = planeLayout(canvas, referenceWidth); // Updates a shared quad, preserving its identity for dual-wield/NPC copies.
    if (geometry.userData?.modularLayout && Object.keys(layout).every(key => geometry.userData.modularLayout[key] === layout[key])) return false;
    const position = geometry.attributes.position; // A one-segment PlaneGeometry has these four corners and unchanged UVs.
    position.setXYZ(0, layout.x - layout.width / 2, layout.y + layout.height / 2, 0);
    position.setXYZ(1, layout.x + layout.width / 2, layout.y + layout.height / 2, 0);
    position.setXYZ(2, layout.x - layout.width / 2, layout.y - layout.height / 2, 0);
    position.setXYZ(3, layout.x + layout.width / 2, layout.y - layout.height / 2, 0);
    position.needsUpdate = true;
    geometry.parameters.width = layout.width; geometry.parameters.height = layout.height;
    if (!geometry.userData) geometry.userData = {};
    geometry.userData.modularLayout = layout;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return true;
  }
  async function compose(shaftKey, headKey, base = '') {
    const cacheKey = `${revision}:${base}:${shaftKey}:${headKey}`; // Metal is recolored later through the existing pipeline.
    if (canvases.has(cacheKey)) return canvases.get(cacheKey);
    const shaft = config.shafts[shaftKey], head = config.heads[headKey]; // Validated manifest entries.
    if (!shaft || !head) throw new Error('Unknown weapon parts.');
    const task = Promise.all([loadImage(shaft.sprite, base), loadImage(head.sprite, base)]).then(([shaftImage, headImage]) => {
      const values = settings(shaftKey, headKey); // Resolved authoring values are shared by bounds calculation and drawing.
      const frame = compositionFrame(shaft, head, visibleBounds(headImage), values); // Expand to contain every rotated, scaled and translated head.
      let pixelScale = Math.min(1, 2048 / Math.max(frame.width, frame.height), Math.sqrt(2097152 / (frame.width * frame.height))); // Bound mobile texture memory without cropping logical geometry.
      if (pixelScale < 1) {
        const padding = Math.ceil(4 / pixelScale); // Retain several bitmap pixels of outline clearance even after extreme downsampling.
        frame.left -= padding; frame.top -= padding; frame.width += padding * 2; frame.height += padding * 2;
        pixelScale = Math.min(1, 2048 / Math.max(frame.width, frame.height), Math.sqrt(2097152 / (frame.width * frame.height)));
      }
      const canvas = document.createElement('canvas'); // Bitmap resolution may shrink for extreme authoring; the donor frame and world scale never change.
      canvas.width = Math.max(1, Math.ceil(frame.width * pixelScale)); canvas.height = Math.max(1, Math.ceil(frame.height * pixelScale));
      canvas.modularFrame = frame;
      const ctx = canvas.getContext('2d'); // All drawing remains in original source-pixel coordinates.
      ctx.scale(canvas.width / frame.width, canvas.height / frame.height);
      ctx.translate(-frame.left, -frame.top);
      if (shaft.crop) {
        ctx.save(); ctx.beginPath(); ctx.rect(shaft.crop.x, shaft.crop.y, shaft.crop.width, shaft.crop.height); ctx.clip();
        ctx.drawImage(shaftImage, 0, 0, 450, 1204); ctx.restore();
      } else ctx.drawImage(shaftImage, 0, 0, 450, 1204);
      for (const attach of shaft.attachments) {
        const matrix = headTransform(attach, values, head.attach); // Reuse the exact transform whose corners expanded the canvas.
        ctx.save(); ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
        ctx.drawImage(headImage, 0, 0, 450, 1204); ctx.restore();
      }
      return canvas;
    });
    canvases.set(cacheKey, task);
    task.catch(() => canvases.delete(cacheKey));
    if (canvases.size > 64) canvases.delete(canvases.keys().next().value);
    return task;
  }
  function registerDefinitions(defs, shapes, metals, metalKeys) {
    for (const [shaftKey, shaft] of Object.entries(config.shafts)) {
      const source = shapes[shaft.sourceShape] || { animStyle: 'sweep', weaponIdleClass: 'heavy' }; // Future/relic source shapes still get a usable baseline.
      for (const [headKey, head] of Object.entries(config.heads)) for (const metalKey of metalKeys) {
        const key = itemKey(shaftKey, headKey, metalKey); // Pre-register metadata only; no image loads for unowned combinations.
        const animation = settings(shaftKey, headKey).animation; // Authored pair override or shaft default drives attacks and combo selection.
        defs[key] = { ...source, animStyle: animation, comboStyle: animation, label: `${metals[metalKey].label} ${head.label} / ${shaft.label}`, icon: '⚒️', sprite: key,
          slots: ['weapon'], dmgType: head.dmgType, spinning: false, shapeKey: shaft.sourceShape, metalKey, itemKey: key,
          modular: { shaft: shaftKey, head: headKey }, weaponIdleClass: source.weaponIdleClass || 'light' };
      }
    }
  }
  function unlockedParts(unlockedShapes, gear, defs) {
    const sources = new Set(unlockedShapes || []); // Existing smith unlock authority also covers discovery and trust gifts.
    for (const [key, owned] of Object.entries(gear?.tools || {})) {
      if (!owned || defs[key]?.modular) continue;
      if (defs[key]?.shapeKey) sources.add(defs[key].shapeKey);
      if (config.heads[key] || config.shafts[key]) sources.add(key);
    }
    for (const record of Object.values(gear?.harlyaoRelics || {})) {
      if (record.shape === 'longsword') sources.add('harlyaoLongsword');
      if (record.shape === 'warhammer') sources.add('warhammer');
      if (record.shape === 'broadsword') sources.add('harlyaoBroadsword');
    }
    return { heads: Object.keys(config.heads).filter(key => sources.has(config.heads[key].sourceShape)),
      shafts: Object.keys(config.shafts).filter(key => sources.has(config.shafts[key].sourceShape)) };
  }
  try { const draft = global.localStorage?.getItem(DRAFT_KEY); if (draft) replace(JSON.parse(draft)); } catch (error) { global.__farmLog?.(`[Foundry] Ignored invalid attachment draft: ${error.message}`, 'warn'); }
  global.ModularWeapons = { getConfig: () => config, replace, settings, isDisallowed, transforms, decode, itemKey, sourceShape, headTransform, compositionFrame, planeLayout, fitPlaneGeometry, compose, loadImage, registerDefinitions, unlockedParts,
    diagnostics: key => ({ parts: decode(key), gripSource: sourceShape(key), cachedSprites: canvases.size, revision }) };
})(window);
