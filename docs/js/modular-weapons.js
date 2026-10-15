// Foundry composition and deterministic gear definitions. No per-frame composition work.
(function (global) {
  'use strict';
  const SCHEMA = 'hobunji_modular_weapons.v1'; // Validated editor import format.
  const DRAFT_KEY = 'hobunji.modularWeapons.v1'; // Shared editor/game attachment draft.
  const transforms = ['scaleX', 'scaleY', 'flipX', 'flipY', 'x', 'y', 'rotation']; // Inheritable head placement fields.
  const images = new Map(); // CORS image promises reused across combinations.
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
  function cleanTransform(raw, partial = false) {
    const result = {}; // Sparse overrides preserve unchecked inheritance.
    for (const key of transforms) {
      if (partial && !Object.hasOwn(raw || {}, key)) continue;
      result[key] = key.startsWith('flip') ? raw?.[key] === true
        : finite(raw?.[key], key.startsWith('scale') ? 1 : 0, key.startsWith('scale') ? 0.05 : -2400, key.startsWith('scale') ? 8 : 2400);
    }
    return result;
  }
  function replace(data, persist = false) {
    if (data?.schema !== SCHEMA || !data.heads || !data.shafts) throw new Error('Invalid modular weapon attachment file.');
    const next = JSON.parse(JSON.stringify(global.MODULAR_WEAPON_CONFIG)); // Catalog paths/ownership cannot be changed by a placement import.
    for (const [key, head] of Object.entries(next.heads)) head.attach = point(data.heads[key]?.attach || head.attach);
    for (const [key, shaft] of Object.entries(next.shafts)) {
      const raw = data.shafts[key] || shaft; // Missing imported entries retain committed defaults.
      shaft.attachments = (Array.isArray(raw.attachments) && raw.attachments.length ? raw.attachments : shaft.attachments).slice(0, 8).map(value => ({ ...point(value), rotation: finite(value.rotation, 0, -360, 360) }));
      shaft.defaults = cleanTransform(raw.defaults);
      shaft.overrides = {};
      for (const [head, values] of Object.entries(raw.overrides || {})) if (next.heads[head]) shaft.overrides[head] = cleanTransform(values, true);
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
  async function compose(shaftKey, headKey, base = '') {
    const cacheKey = `${revision}:${base}:${shaftKey}:${headKey}`; // Metal is recolored later through the existing pipeline.
    if (canvases.has(cacheKey)) return canvases.get(cacheKey);
    const shaft = config.shafts[shaftKey], head = config.heads[headKey]; // Validated manifest entries.
    if (!shaft || !head) throw new Error('Unknown weapon parts.');
    const task = Promise.all([loadImage(shaft.sprite, base), loadImage(head.sprite, base)]).then(([shaftImage, headImage]) => {
      const canvas = document.createElement('canvas'); // Keep the donor frame so authored grips and scale remain exact.
      canvas.width = 450; canvas.height = 1204;
      const ctx = canvas.getContext('2d'); // Shared editor/runtime compositor.
      const values = settings(shaftKey, headKey); // Sparse per-head values inherit the current shaft defaults.
      if (shaft.crop) {
        ctx.save(); ctx.beginPath(); ctx.rect(shaft.crop.x, shaft.crop.y, shaft.crop.width, shaft.crop.height); ctx.clip();
        ctx.drawImage(shaftImage, 0, 0, 450, 1204); ctx.restore();
      } else ctx.drawImage(shaftImage, 0, 0, 450, 1204);
      for (const attach of shaft.attachments) {
        ctx.save();
        ctx.translate(attach.x, attach.y);
        ctx.rotate(attach.rotation * Math.PI / 180);
        ctx.translate(values.x, values.y);
        ctx.rotate(values.rotation * Math.PI / 180);
        ctx.scale(values.scaleX * (values.flipX ? -1 : 1), values.scaleY * (values.flipY ? -1 : 1));
        ctx.drawImage(headImage, -head.attach.x, -head.attach.y, 450, 1204);
        ctx.restore();
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
        defs[key] = { ...source, label: `${metals[metalKey].label} ${head.label} / ${shaft.label}`, icon: '⚒️', sprite: key,
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
      if (record.shape === 'broadsword') sources.add('harlyaoBroadsword');
    }
    return { heads: Object.keys(config.heads).filter(key => sources.has(config.heads[key].sourceShape)),
      shafts: Object.keys(config.shafts).filter(key => sources.has(config.shafts[key].sourceShape)) };
  }
  try { const draft = global.localStorage?.getItem(DRAFT_KEY); if (draft) replace(JSON.parse(draft)); } catch (error) { global.__farmLog?.(`[Foundry] Ignored invalid attachment draft: ${error.message}`, 'warn'); }
  global.ModularWeapons = { getConfig: () => config, replace, settings, transforms, decode, itemKey, sourceShape, compose, loadImage, registerDefinitions, unlockedParts,
    diagnostics: key => ({ parts: decode(key), gripSource: sourceShape(key), cachedSprites: canvases.size, revision }) };
})(window);
