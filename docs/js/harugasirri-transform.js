(() => {
  'use strict';

  const STORAGE_KEY = 'hobunji.harugasirriTransform.v1';
  const EVENT_NAME = 'harugasirri-transform-changed';

  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const positive = (value, fallback) => Math.max(0.001, finite(value, fallback));

  function extents(asset) {
    const min = asset?.origin?.bounds?.min || [-11, 0, -11];
    const max = asset?.origin?.bounds?.max || [11, 9.921569, 11];
    return {
      width: Math.max(0.001, finite(max[0], 11) - finite(min[0], -11)),
      height: Math.max(0.001, finite(max[1], 9.921569) - finite(min[1], 0)),
      depth: Math.max(0.001, finite(max[2], 11) - finite(min[2], -11)),
    };
  }

  function defaults(asset) {
    const source = extents(asset);
    const scale = positive(asset?.runtime?.worldScale, 12);
    const authored = asset?.runtime?.transform || {};
    return {
      width: positive(authored.width, source.width * scale),
      height: positive(authored.height, source.height * scale),
      depth: positive(authored.depth, source.depth * scale),
      x: finite(authored.x, 0),
      y: finite(authored.y, 0),
      z: finite(authored.z, 0),
      rotationY: finite(authored.rotationY, 0),
      visibilityTest: authored.visibilityTest === true,
    };
  }

  function normalize(raw, asset) {
    const base = defaults(asset);
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      width: positive(raw.width, base.width),
      height: positive(raw.height, base.height),
      depth: positive(raw.depth, base.depth),
      x: finite(raw.x, base.x),
      y: finite(raw.y, base.y),
      z: finite(raw.z, base.z),
      rotationY: finite(raw.rotationY, base.rotationY),
      visibilityTest: raw.visibilityTest === true,
    };
  }

  function load(asset) {
    let parsed = null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) parsed = JSON.parse(stored);
    } catch (_) {}
    return normalize(parsed, asset);
  }

  function dispatch(state) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { state } }));
    } catch (_) {}
  }

  function save(state, asset) {
    const next = normalize(state, asset);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
    dispatch(next);
    return next;
  }

  function reset(asset) {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    const next = defaults(asset);
    dispatch(next);
    return next;
  }

  function apply(group, asset, state) {
    if (!group?.scale || !group?.position || !group?.rotation) return normalize(state, asset);
    const source = extents(asset);
    const next = normalize(state, asset);
    group.scale.set(next.width / source.width, next.height / source.height, next.depth / source.depth);
    group.position.set(next.x, next.y, next.z);
    group.rotation.y = next.rotationY * Math.PI / 180;
    group.updateMatrixWorld?.(true);
    return next;
  }

  function summary(asset, state) {
    const source = extents(asset);
    const next = normalize(state, asset);
    return {
      source,
      final: { width: next.width, height: next.height, depth: next.depth },
      scale: {
        x: next.width / source.width,
        y: next.height / source.height,
        z: next.depth / source.depth,
      },
      position: { x: next.x, y: next.y, z: next.z },
      rotationY: next.rotationY,
      visibilityTest: next.visibilityTest,
    };
  }

  window.HarugasirriTransform = Object.freeze({
    STORAGE_KEY,
    EVENT_NAME,
    extents,
    defaults,
    normalize,
    load,
    save,
    reset,
    apply,
    summary,
  });
})();
