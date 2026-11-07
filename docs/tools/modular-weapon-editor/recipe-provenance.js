(function (global) {
  'use strict';
  // Immutable fingerprints of identical single-ended haft recipe placements from 2026-10-29, f6b3583913a7.
  // Match untouched boxes only; users may have since edited one or added independent work.
  const legacyBoxes = {
  "fishing-mace": {
    "recipe-1": {
      "x0": 170.5,
      "y0": 762.5,
      "x1": 227,
      "y1": 873
    },
    "tanged-head---sleeved-shaft": {
      "x0": 60.00000000000006,
      "y0": 592.5000000000002,
      "x1": 367.99999999999994,
      "y1": 1655.4999999999998
    }
  },
  "warhammer": {
    "recipe-1": {
      "x0": 183.5,
      "y0": 908.5,
      "x1": 240,
      "y1": 1019
    },
    "tanged-head---sleeved-shaft": {
      "x0": 73.00000000000006,
      "y0": 738.5000000000002,
      "x1": 380.99999999999994,
      "y1": 1801.4999999999998
    }
  },
  "bgungku": {
    "recipe-1": {
      "x0": 202.5,
      "y0": 514.5,
      "x1": 259,
      "y1": 625
    },
    "tanged-head---sleeved-shaft": {
      "x0": 92.00000000000006,
      "y0": 344.5000000000001,
      "x1": 399.99999999999994,
      "y1": 1407.4999999999995
    }
  },
  "hatchet": {
    "recipe-1": {
      "x0": 183.5,
      "y0": 916.5,
      "x1": 240,
      "y1": 1027
    },
    "tanged-head---sleeved-shaft": {
      "x0": 73.00000000000006,
      "y0": 746.5000000000002,
      "x1": 380.99999999999994,
      "y1": 1809.4999999999998
    }
  },
  "hoe": {
    "recipe-1": {
      "x0": 164.5,
      "y0": 1082.5,
      "x1": 221,
      "y1": 1193
    },
    "tanged-head---sleeved-shaft": {
      "x0": 54.00000000000006,
      "y0": 912.5000000000002,
      "x1": 361.99999999999994,
      "y1": 1975.4999999999998
    }
  },
  "kylie": {
    "recipe-1": {
      "x0": 338.7881062280972,
      "y0": 908.9415575926496,
      "x1": 398.33130614420867,
      "y1": 1025.3933025613278
    },
    "tanged-head---sleeved-shaft": {
      "x0": 222.33636125941896,
      "y0": 729.7850268716061,
      "x1": 546.9258404481329,
      "y1": 1850.0402748508363
    }
  }
}; // Identifies obsolete copied placements in saved browser drafts.
  const originalRecipeHashes = {"recipe-1":"33fbe8f8","tanged-head---sleeved-shaft":"15fe3b94"}; // Exact 2026-10-29 template signatures; an edited shared recipe is intentional work.
  function fingerprint(recipe) {
    if (!recipe || typeof recipe !== 'object') return null;
    const canonical = value => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const json = JSON.stringify(canonical(recipe)); // Ignore irrelevant object key order, never change recipes.
    if (!json) return null;
    let hash = 2166136261; // FNV-1a over canonical authored template content, checked only on user action/render.
    for (let index = 0; index < json.length; index++)
      hash = Math.imul(hash ^ json.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  const sameBox = (a, b) => a && b && ['x0', 'y0', 'x1', 'y1'].every(key =>
    Number.isFinite(a[key]) && Math.abs(a[key] - b[key]) < 0.000001);
  function find(config) {
    const matches = []; // Saved operation indices; expanded recipe brush pixels are not separate authoring.
    const templateUnchanged = Object.fromEntries(Object.entries(originalRecipeHashes).map(([name, hash]) =>
      [name, fingerprint(config?.recipes?.[name]) === hash])); // Custom recipe templates must keep their placements.
    for (const [shaftKey, recipeBoxes] of Object.entries(legacyBoxes)) {
      const shaft = config?.shafts?.[shaftKey];
      if (!shaft || shaft.mounts?.filter(m => m.type === 'tang').length !== 1
        || shaft.mounts?.filter(m => m.type === 'eye').length !== 1) continue;
      for (const [headKey, pair] of Object.entries(shaft.overrides || {}))
        for (const [index, op] of (pair?.bridges?.strokes || []).entries())
          if (op?.recipe && !op.uniform && !op.flipX && templateUnchanged[op.recipe]
            && recipeBoxes[op.recipe] && sameBox(op.box, recipeBoxes[op.recipe]))
            matches.push({ shaftKey, headKey, index, recipe: op.recipe }); // Preserve mirrored/resized/proportion-edited placements.
    }
    return matches;
  }
  function clean(config) {
    const matches = find(config); // Resolve before any deletion; independently edited geometry is preserved.
    const byPair = new Map(); // Remove indices in reverse order, retaining other operations and settings.
    for (const match of matches) {
      const key = match.shaftKey + '|' + match.headKey;
      if (!byPair.has(key)) byPair.set(key, { shaftKey: match.shaftKey, headKey: match.headKey, indices: [] });
      byPair.get(key).indices.push(match.index);
    }
    for (const { shaftKey, headKey, indices } of byPair.values()) {
      const pair = config.shafts[shaftKey].overrides[headKey];
      for (const index of indices.sort((a, b) => b - a)) pair.bridges.strokes.splice(index, 1);
      if (!pair.bridges.strokes.length) pair.bridges = null; // Explicit removal while keeping any per-pair layer decisions.
    }
    return matches;
  }
  function isMultiEndedSleeveHaft(shaft) {
    const tangs = (shaft?.mounts || []).filter(m => m.type === 'tang');
    if (!(shaft?.mounts || []).some(m => m.type === 'eye')) return false;
    // At least two physically distinct head positions; tang+eye at the SAME end is not duplication.
    return tangs.some((a, i) => tangs.slice(i + 1).some(b => {
      const ax = (a.start.x + a.end.x) / 2, ay = (a.start.y + a.end.y) / 2;
      const bx = (b.start.x + b.end.x) / 2, by = (b.start.y + b.end.y) / 2;
      return Math.hypot(ax - bx, ay - by) >= 16;
    }));
  }
  global.ModularWeaponRecipeProvenance = { find, clean, isMultiEndedSleeveHaft };
})(window);
