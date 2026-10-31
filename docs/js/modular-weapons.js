// Foundry composition and deterministic gear definitions. No per-frame composition work.
(function (global) {
  'use strict';
  const SCHEMA = 'hobunji_modular_weapons.v2'; // Validated editor import format.
  const DRAFT_KEY = 'hobunji.modularWeapons.v5'; // New authored companion mounts and explicit pair layering.
  const OLD_DRAFT_KEY = 'hobunji.modularWeapons.v4'; // Preserve existing v2 authoring lines while upgrading shipped mounts.
  const LEGACY_DRAFT_KEY = 'hobunji.modularWeapons.v3'; // Original v1 socket/draft backup.
  const NEUTRAL = Object.freeze({ scaleX: 1, scaleY: 1, flipX: false, flipY: false, x: 0, y: 0, rotation: 0, animation: 'sweep', layerOrder: 'haft-over-head' }); // Default sprite stacking draws heads before the haft.
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
  // Junction pieces: small metal sprites (assets/toolsprites/modular_pieces/weaponjunction_<name>.png) placed between a
  // head and haft to bridge them at any angle. Placed centred on (x, y) in composed-frame source pixels.
  const JUNCTIONS = ['band', 'block', 'sphere']; // Bundled pieces; the editor can discover later uploads.
  const junctionPath = name => 'assets/toolsprites/modular_pieces/weaponjunction_' + name + '.png';
  function cleanJunction(raw) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(raw.junction)) return null;
    return { junction: raw.junction, x: finite(raw.x, 225, -2400, 2850), y: finite(raw.y, 602, -2400, 3604),
      rotation: finite(raw.rotation, 0, -360, 360), scale: finite(raw.scale, 1, 0.1, 8),
      ...(raw.behind === true ? { behind: true } : {}) };
  }
  function drawJunction(ctx, image, piece) { // ctx already maps source pixels; draws the piece centred and rotated.
    ctx.save();
    if (piece.behind) ctx.globalCompositeOperation = 'destination-over'; // Slips under existing pixels.
    ctx.translate(piece.x, piece.y); ctx.rotate(piece.rotation * Math.PI / 180); ctx.scale(piece.scale, piece.scale);
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();
  }
  function cleanBox(raw) {
    const box = { x0: finite(raw?.x0, 0, -2400, 2850), y0: finite(raw?.y0, 0, -2400, 3604), x1: finite(raw?.x1, 0, -2400, 2850), y1: finite(raw?.y1, 0, -2400, 3604) };
    return raw && box.x1 - box.x0 >= 4 && box.y1 - box.y0 >= 4 ? box : null;
  }
  // One validated bridge-brush step. A recipe step ({recipe, box}) places a saved recipe into a box; recipes
  // themselves hold plain steps only (allowRecipe false), so they can never nest.
  function cleanOp(stroke, allowRecipe = true) {
    return typeof stroke?.recipe === 'string' ? (allowRecipe && /^[a-z0-9_-]{1,40}$/i.test(stroke.recipe) && cleanBox(stroke.box)
        ? { recipe: stroke.recipe, box: cleanBox(stroke.box), ...(stroke.uniform === true ? { uniform: true } : {}), ...(stroke.flipX === true ? { flipX: true } : {}) } : null)
      : typeof stroke?.junction === 'string' ? cleanJunction(stroke)
      : stroke?.revertPoint === true ? { revertPoint: true } // Marks what the revert brush eases back to.
      : stroke?.even === true ? { even: true, amount: finite(stroke.amount, 0.6, 0, 1) } // Whole-weapon outline wobble averaging.
      : stroke?.style === true ? { style: true, amount: finite(stroke.amount, 0.6, 0, 1), pool: finite(stroke.pool, 0, 0, 2000) } // Clean up to style.
      : stroke?.clean === true ? { clean: true, smoothing: finite(stroke.smoothing, 2, 0, 12), speck: finite(stroke.speck, 40, 0, 2000) } // Whole-weapon clean-up.
      : stroke?.shading === true ? { shading: true, tolerance: finite(stroke.tolerance, 0.2, 0, 0.5), pool: Math.round(finite(stroke.pool, 5, 1, 32)) }
      : stroke?.tool !== undefined && !['revert', 'plow', 'puff', 'clean'].includes(stroke.tool) ? null // Unknown tools are dropped.
      : ({
      r: finite(stroke?.r, 16, 1, 160),
      ...(stroke?.closed === true ? { closed: true } : {}), // Auto-bridge polygons.
      ...(stroke?.smudge === true ? { smudge: true } : {}), // Metal smudge strokes, replayed in order.
      ...(['revert', 'plow', 'puff', 'clean'].includes(stroke?.tool) ? { tool: stroke.tool, strength: finite(stroke.strength, 0.5, 0, 1),
        seed: Math.round(finite(stroke.seed, 1, 0, 2147483647)) } : {}), // Other smudge-family tools.
      ...(stroke?.tool === 'clean' ? { smoothing: finite(stroke.smoothing, 2, 0, 12), speck: finite(stroke.speck, 40, 0, 2000) } : {}),
      points: (Array.isArray(stroke?.points) ? stroke.points : []).slice(0, 2000)
        .filter(pt => Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite))
        .map(([x, y]) => [finite(x, 0, -2400, 2850), finite(y, 0, -2400, 3604)])
    });
  }
  const validOp = stroke => stroke && (stroke.recipe || stroke.junction || stroke.shading || stroke.revertPoint || stroke.clean || stroke.even || stroke.style || stroke.points?.length);
  // Saved recipes: named lists of plain bridge-brush steps made inside a box, plus (optionally) the haft mount the
  // box was made around (anchor) so it can be placed at the same spot on other pairs automatically.
  function cleanRecipes(raw) {
    const out = {};
    for (const [name, recipe] of Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 64)) {
      const box = cleanBox(recipe?.box);
      if (!/^[a-z0-9_-]{1,40}$/i.test(name) || !box) continue;
      const ops = (Array.isArray(recipe.ops) ? recipe.ops : []).slice(0, 512).map(op => cleanOp(op, false)).filter(validOp);
      if (!ops.length) continue;
      const m = recipe.anchor?.mount, mount = m && [m.x, m.y, m.ax, m.ay, m.len].every(Number.isFinite) && m.len > 0
        ? { x: finite(m.x, 0, -2400, 2850), y: finite(m.y, 0, -2400, 3604), ax: finite(m.ax, 1, -1, 1), ay: finite(m.ay, 0, -1, 1), len: finite(m.len, 1, 1, 4000) } : null;
      out[name] = { ...(typeof recipe.label === 'string' ? { label: recipe.label.slice(0, 60) } : {}), box, ops,
        ...(mount ? { anchor: { rank: Math.round(finite(recipe.anchor.rank, 0, 0, 16)), count: Math.round(finite(recipe.anchor.count, 1, 1, 16)), mount } } : {}) };
    }
    return out;
  }
  // The pair's steps with recipe boxes expanded in place: each is the recipe's steps re-mapped into the box.
  function expandOps(strokes) {
    const fill = global.ModularWeaponBridgeFill;
    return strokes.flatMap(op => {
      if (!op.recipe) return [op];
      const recipe = config.recipes?.[op.recipe];
      return recipe && fill?.mapOps ? fill.mapOps(recipe.ops, recipe.box, op.box, { uniform: op.uniform, flipX: op.flipX }) : [];
    });
  }
  function cleanBridges(raw) {
    // Pair-specific bridge brush strokes, in source-pixel coordinates of the composed frame (see compose()).
    if (!raw || !Array.isArray(raw.strokes)) return null;
    const strokes = raw.strokes.slice(0, 512).map(stroke => cleanOp(stroke)).filter(validOp);
    if (!strokes.length) return null;
    const light = raw.light === null ? null : Array.isArray(raw.light) && raw.light.length === 2
      ? [finite(raw.light[0], 0, -1, 1), finite(raw.light[1], -1, -1, 1)] : [0, -1];
    return { strokes, outline: Math.round(finite(raw.outline, 10, 0, 32)), light,
      shade: finite(raw.shade, 0.3, 0, 1), seed: Math.round(finite(raw.seed, 1, 0, 2147483647)) };
  }
  function rigBridgeOperations(shaft, strokes) {
    const layout = shaftRigTransform(shaft); // Saved manual strokes and recipe steps are authored in the source rig's local coordinates.
    const radiusScale = Math.sqrt(layout.scaleX * layout.scaleY); // Conservative scalar footprint for existing round smudge/brush kernels.
    return expandOps(strokes).map(op => {
      if (op.junction) return { ...op, _rigJunction: true }; // Draw junction PNG through the exact parent affine, preserving nonuniform X/Y scale.
      if (!op.points) return { ...op }; // Clean/style/shading/revert markers act on the current changed region, not on a coordinate.
      return {
        ...op,
        points: op.points.map(([x, y]) => {
          const p = duplicatePoint({ x, y }, layout);
          return [p.x, p.y];
        }),
        r: op.r * radiusScale,
        rX: op.r * layout.scaleX, rY: op.r * layout.scaleY, // Preserve nonuniform radius for fill masks.
        ...(op.smoothing != null ? { smoothing: op.smoothing * radiusScale } : {}),
        ...(op.speck != null ? { speck: op.speck * radiusScale * radiusScale } : {}),
      };
    }); // Transform the expanded recipe's children, never mutate its original saved steps.
  }
  function applyBridges(canvas, frame, bridges, junctionImages = {}, shaft = null) {
    // One-time pass when a pair is composed (the result is cached with the canvas), never per frame.
    const fill = global.ModularWeaponBridgeFill;
    if (!fill || !bridges?.strokes?.length) return;
    const ops = rigBridgeOperations(shaft, bridges.strokes); // Recipe expansion happens FIRST; all resulting strokes/junctions inherit the rig.
    if (!ops.length) return;
    const sx = canvas.width / frame.width, sy = canvas.height / frame.height; // Logical source pixels → bitmap pixels.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const toPixel = (x, y) => ({ x: (x - frame.left) * sx, y: (y - frame.top) * sy });
    // Strokes replay in the order they were made: each run of bridge strokes fills together, each smudge stroke
    // moves metal and rebuilds the outline on its own.
    let pending = [];
    const flush = () => {
      if (!pending.length) return;
      const mask = new Uint8Array(canvas.width * canvas.height);
      for (const stroke of pending) fill.stampStroke(mask, canvas.width, canvas.height, stroke, toPixel, sx);
      pending = [];
      try {
        const result = fill.fillBridge(image.data, mask, canvas.width, canvas.height, {
          outlineThickness: Math.round(bridges.outline * sx), lightDirection: bridges.light,
          shadeWidth: bridges.shade, seed: bridges.seed });
        image.data.set(result.pixels);
      } catch (error) { global.console?.warn?.('Modular weapon bridge skipped:', error.message); }
    };
    let reference = null; // The image before the first smudge-family stroke: what the revert brush eases back to.
    const base = ops.some(op => op.clean || op.even || op.style) ? new Uint8ClampedArray(image.data) : null; // Before any brush work.
    for (const stroke of ops) {
      if (stroke.shading) { flush(); fill.separateShading(image.data, canvas.width, canvas.height, stroke); continue; }
      if (stroke.revertPoint) { flush(); reference = new Uint8ClampedArray(image.data); continue; }
      if (stroke.even || stroke.style) { // Whole-weapon operations on everything brush work has changed.
        flush();
        const worked = fill.changedRegion(image.data, base);
        if (!worked) continue;
        if (stroke.even) fill.evenOutline(image.data, canvas.width, canvas.height, worked, { amount: stroke.amount });
        else fill.styleCleanup(image.data, canvas.width, canvas.height, worked, { amount: stroke.amount, pool: stroke.pool * sx * sx });
        continue;
      }
      if (stroke.clean) {
        flush();
        const worked = fill.changedRegion(image.data, base); // Only where brush work changed the weapon.
        if (worked) fill.cleanOutline(image.data, canvas.width, canvas.height, worked, { smoothing: stroke.smoothing * sx, speck: stroke.speck * sx * sx });
        continue;
      }
      if (stroke.junction) {
        flush();
        const piece = junctionImages[stroke.junction];
        if (!piece) continue; // Missing upload: skip this piece, keep everything else.
        ctx.putImageData(image, 0, 0);
        ctx.save(); ctx.setTransform(sx, 0, 0, sy, -frame.left * sx, -frame.top * sy);
        if (shaft) {
          const parent = attachmentRig(shaft).parent; // Junctions are true graphic children; Canvas parent handles nonuniform scaling.
          ctx.transform(parent.a, parent.b, parent.c, parent.d, parent.e, parent.f);
        }
        drawJunction(ctx, piece, stroke); ctx.restore();
        image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        continue;
      }
      if (!stroke.smudge && !stroke.tool) { pending.push(stroke); continue; }
      flush();
      if (!reference) reference = new Uint8ClampedArray(image.data);
      fill.toolStroke(image.data, canvas.width, canvas.height, stroke, toPixel, sx, { reference });
    }
    flush();
    if (global.ModularWeaponsKeepReference) canvas.modularReference = reference; // Editor only: live revert previews.
    ctx.putImageData(image, 0, 0);
  }
  function cleanTransform(raw, partial = false, fallbackAnimation = 'sweep') {
    const result = {}; // Sparse overrides preserve unchecked inheritance.
    for (const key of transforms) {
      if (partial && !Object.hasOwn(raw || {}, key)) continue;
      result[key] = key.startsWith('flip') ? raw?.[key] === true
        : finite(raw?.[key], key.startsWith('scale') ? 1 : 0, key.startsWith('scale') ? 0.05 : -2400, key.startsWith('scale') ? 8 : 2400);
    }
    if (raw?.layerOrder === 'haft-over-head' || raw?.layerOrder === 'head-over-haft') result.layerOrder = raw.layerOrder; // Pair-specific painter order, validated against the two supported options.
    if (raw?.animation === 'thrust' || raw?.animation === 'sweep') result.animation = raw.animation;
    else if (!partial) result.animation = fallbackAnimation;
    const bridges = cleanBridges(raw?.bridges); // Optional pair-specific bridge brush strokes.
    if (bridges) result.bridges = bridges;
    else if (raw?.bridges === null) result.bridges = null; // Explicit removal, so committed strokes aren't re-inherited.
    return result;
  }
  function line(raw, kind, fallback) {
    const source = raw && typeof raw === 'object' ? raw : fallback; // Only valid authored directed lines may replace shipped geometry.
    const type = kind === 'head'
      ? (source?.type === 'weight' || source?.type === 'blade' ? source.type : fallback.type)
      : (source?.type === 'tang' || source?.type === 'eye' ? source.type : fallback.type); // Shaft mounts accept both kinds.
    const start = point(source?.start || fallback.start), end = point(source?.end || fallback.end); // Fixed sprite reference coordinates.
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return { ...fallback, start: point(fallback.start), end: point(fallback.end) };
    return { type, start, end };
  }
  function duplicateTransform(raw) {
    return {
      scaleX: finite(raw?.scaleX, 1, 0.05, 8), scaleY: finite(raw?.scaleY, 1, 0.05, 8),
      x: finite(raw?.x, 0, -2400, 2400), y: finite(raw?.y, 0, -2400, 2400),
    }; // Attachment-rig-only transform about the 450x1204 shaft reference center; not applied to the shaft sprite.
  }
  function duplicatePoint(point, layout) {
    return { x: (point.x - 225) * layout.scaleX + 225 + layout.x,
      y: (point.y - 602) * layout.scaleY + 602 + layout.y };
  }
  function shaftRigTransform(shaft) {
    return duplicateTransform(shaft?.attachmentRigTransform || shaft?.duplicateTransform);
  } // All shafts, not only duplicates, have an independent attachment parent; old duplicateTransform drafts still work.
  function shaftArtTransform(shaft) {
    const raw = shaft?.shaftArtTransform;
    return { ...duplicateTransform(raw), enabled: raw?.enabled === true }; // Independent, opt-in sprite transform; flame source inherits it.
  }
  function cleanRigRegions(raw) {
    if (!Array.isArray(raw)) return [];
    const used = new Set();
    return raw.slice(0, 12).flatMap((region, index) => {
      const box = region?.box;
      if (!box || ![box.x0,box.y0,box.x1,box.y1].every(Number.isFinite)) return [];
      const x0 = finite(box.x0,0,0,450), y0 = finite(box.y0,0,0,1204);
      const x1 = finite(box.x1,0,0,450), y1 = finite(box.y1,0,0,1204);
      if (x1-x0 < 8 || y1-y0 < 8) return [];
      const id = typeof region.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(region.id)
        ? region.id : 'area'+index;
      if (used.has(id)) return [];
      used.add(id);
      return [{ id, label: String(region.label || 'Region '+(index+1)).slice(0,64),
        box:{x0,y0,x1,y1}, transform:duplicateTransform(region.transform) }];
    }); // Regions are independently transformed selections of the mounting rig's children.
  }
  function regionAt(shaft, point) {
    const regions = shaft?.rigRegions || [];
    for (let i=regions.length-1;i>=0;i--) {
      const region = regions[i], b=region.box;
      if (point.x>=b.x0 && point.x<=b.x1 && point.y>=b.y0 && point.y<=b.y1) return region;
    }
    return null; // Later areas win when selections overlap; this remains stable after transforms move their contents.
  }
  function regionAffine(region) {
    if (!region) return {a:1,b:0,c:0,d:1,e:0,f:0};
    const box=region.box, t=duplicateTransform(region.transform);
    const cx=(box.x0+box.x1)/2,cy=(box.y0+box.y1)/2;
    return {a:t.scaleX,b:0,c:0,d:t.scaleY,e:cx+t.x-cx*t.scaleX,f:cy+t.y-cy*t.scaleY};
  } // Each region is a child of the overall attachment parent, pivoting at the selected box center.
  function affinePoint(matrix, p) {
    return {x:matrix.a*p.x+matrix.c*p.y+matrix.e,y:matrix.b*p.x+matrix.d*p.y+matrix.f};
  }
  function rigPoint(shaft, p, region = regionAt(shaft,p)) {
    return duplicatePoint(affinePoint(regionAffine(region),p),shaftRigTransform(shaft));
  } // Transform each selected child's endpoints under its area, then under the overall parent.
  function shaftMounts(shaft) {
    return (shaft?.mounts || []).map(mount => {
      const region=regionAt(shaft,{x:(mount.start.x+mount.end.x)/2,y:(mount.start.y+mount.end.y)/2});
      return {type:mount.type,start:rigPoint(shaft,mount.start,region),end:rigPoint(shaft,mount.end,region)};
    }); // A selected mounting primitive travels with its area, rather than only the whole rig.
  }
  function matchingMounts(shaft, head) {
    const kind = head?.mount?.type === 'blade' ? 'tang' : head?.mount?.type === 'weight' ? 'eye' : '';
    return shaftMounts(shaft).filter(mount => mount.type === kind); // Works on the transformed clone without weakening original exclusions.
  }
  function renderingMounts(shaft, head) {
    const compatible = matchingMounts(shaft, head); // Only same-kind arrows are valid for newly crafted combinations.
    return compatible.length ? compatible : shaftMounts(shaft).slice(0, 1); // Existing saved legacy weapons keep a visual head if a past combination becomes incompatible.
  }
  function legacyLine(pivot, type, rotation = 0) {
    const start = point(pivot), angle = rotation * Math.PI / 180; // Migrates legacy pivot and socket rotation into directed lines.
    const end = { x: start.x + Math.sin(angle) * 80, y: start.y - Math.cos(angle) * 80 };
    return { type, start, end };
  }
  function addCompanionsToPreviousDraft(raw) {
    const upgraded = JSON.parse(JSON.stringify(raw)); // Migrate once; do not overwrite current v5 user edits.
    if (upgraded.schema !== SCHEMA) return upgraded; // v1 drafts are converted separately.
    for (const shaft of Object.values(upgraded.shafts || {})) {
      if (!Array.isArray(shaft.mounts)) continue;
      const originalEyes = shaft.mounts.filter(mount => mount?.type === 'eye');
      for (const eye of originalEyes) {
        const dx = eye.end.x - eye.start.x, dy = eye.end.y - eye.start.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) continue;
        const center = { x: (eye.start.x + eye.end.x) / 2, y: (eye.start.y + eye.end.y) / 2 };
        const alreadyPaired = shaft.mounts.some(mount => mount.type === 'tang' &&
          Math.hypot((mount.start.x + mount.end.x) / 2 - center.x, (mount.start.y + mount.end.y) / 2 - center.y) < 2);
        if (alreadyPaired) continue; // An author may already have placed a companion by hand.
        const offsetX = -dy / 4, offsetY = dx / 4; // Tang length is half eye length; perpendicular and centered.
        const companion = { type: 'tang',
          start: { x: center.x - offsetX, y: center.y - offsetY },
          end: { x: center.x + offsetX, y: center.y + offsetY } };
        if ([companion.start, companion.end].every(p => p.x >= 0 && p.x <= 450 && p.y >= 0 && p.y <= 1204))
          shaft.mounts.push(companion); // Preserve adjusted eye location and orientation from prior saved drafts.
      }
    }
    if (upgraded.heads?.['pick-shovel-pick']) {
      upgraded.heads['pick-shovel-pick'].mount = JSON.parse(JSON.stringify(global.MODULAR_WEAPON_CONFIG.heads['pick-shovel-pick'].mount)); // Reset only the pick head's old manual rotation, as requested.
    }
    return upgraded;
  }
  function convertLegacy(raw, reference) {
    const converted = JSON.parse(JSON.stringify(reference)); // Never trust a legacy import's sprite paths or catalog records.
    for (const [key, head] of Object.entries(converted.heads)) {
      const previous = raw.heads?.[key];
      if (previous?.attach) head.mount = legacyLine(previous.attach, head.mount.type);
      if (typeof previous?.editorOnly === 'boolean') head.editorOnly = previous.editorOnly;
    }
    for (const [key, shaft] of Object.entries(converted.shafts)) {
      const old = raw.shafts?.[key];
      if (!old) continue;
      if (typeof old.editorOnly === 'boolean') shaft.editorOnly = old.editorOnly;
      if (Array.isArray(old.attachments) && old.attachments.length) {
        const kind = shaft.mounts[0]?.type || 'tang'; // Preserve original socket order, including double-headed tools.
        shaft.mounts = old.attachments.slice(0, shaft.maxAttachments || 8).map(p =>
          legacyLine(p, kind, finite(p?.rotation, 0, -360, 360)));
      }
      for (const head of Object.keys(converted.heads)) {
        const effective = { ...(old.defaults || {}), ...(old.overrides?.[head] || {}) }; // Global legacy defaults become *per-pair* corrections.
        const correction = {};
        for (const field of [...transforms, 'animation', 'layerOrder']) { // Legacy v1 exports are normally missing layerOrder; omitted fields use the new default.
          if (Object.hasOwn(effective, field)) correction[field] = effective[field];
        }
        if (typeof effective.disallow === 'boolean') correction.disallow = effective.disallow;
        if (Object.keys(correction).length) shaft.overrides[head] = correction;
      }
    }
    return addCompanionsToPreviousDraft(converted); // Imported legacy socket-only shafts also receive compatible eye/tang mount pairs.
  }
  function replace(data, persist = false) {
    if (!data?.heads || !data?.shafts || ![SCHEMA, 'hobunji_modular_weapons.v1'].includes(data.schema))
      throw new Error('Invalid modular weapon attachment file.');
    const reference = global.MODULAR_WEAPON_CONFIG; // Committed catalog owns sprites, metadata, and keys.
    const incoming = data.schema === SCHEMA ? data : convertLegacy(data, reference); // Preserve old editor drafts and imported v1 exports.
    const next = JSON.parse(JSON.stringify(reference));
    for (const [key, raw] of Object.entries(incoming.shafts || {})) {
      if (Object.hasOwn(next.shafts, key)) continue;
      if (!/^[a-z][a-zA-Z0-9_-]{1,63}$/.test(key) || Object.keys(next.shafts).length >= 60) continue;
      const donor = next.shafts[raw?.duplicateFrom]; // Only allow new shaft keys based on an already-approved donor, never arbitrary untrusted definitions.
      if (!donor || !/^[a-zA-Z0-9_./'-]+\.(?:png|webp)$/i.test(raw?.sprite || '')) continue;
      next.shafts[key] = { ...JSON.parse(JSON.stringify(donor)), label: String(raw.label || key).slice(0,96),
        sprite: raw.sprite, sourceShape: donor.sourceShape, duplicateFrom: raw.duplicateFrom };
    }
    for (const [key, head] of Object.entries(next.heads)) {
      const raw = incoming.heads[key] || head;
      head.mount = line(raw.mount, 'head', head.mount);
      if (typeof raw.editorOnly === 'boolean') head.editorOnly = raw.editorOnly;
    }
    for (const [key, shaft] of Object.entries(next.shafts)) {
      const raw = incoming.shafts[key] || shaft; // Missing imports use committed lines and pair settings.
      if (typeof raw.editorOnly === 'boolean') shaft.editorOnly = raw.editorOnly;
      shaft.rigRegions = cleanRigRegions(raw.rigRegions || shaft.rigRegions); // Region selections are validated and persist in exported drafts.
      shaft.shaftArtTransform = { ...duplicateTransform(raw.shaftArtTransform || shaft.shaftArtTransform),
        enabled: (raw.shaftArtTransform || shaft.shaftArtTransform)?.enabled === true }; // Explicit opt-in, neutral for old saves.
      if (raw.attachmentRigTransform || raw.duplicateTransform || shaft.attachmentRigTransform || shaft.duplicateTransform) {
        // Apply to both original and cloned shafts. Older browser drafts use duplicateTransform;
        // newer edits store attachmentRigTransform without changing the shaft sprite itself.
        shaft.attachmentRigTransform = duplicateTransform(
          raw.attachmentRigTransform || raw.duplicateTransform || shaft.attachmentRigTransform || shaft.duplicateTransform);
      }
      shaft.mounts = (Array.isArray(raw.mounts) && raw.mounts.length ? raw.mounts : shaft.mounts)
        .slice(0, shaft.maxAttachments || 8).map((mount, index) => line(mount, 'shaft', shaft.mounts[Math.min(index, shaft.mounts.length - 1)]));
      const shipped = shaft.overrides; // Keep committed explicit pair exclusions when older imports omit them.
      shaft.overrides = {};
      for (const [head, pair] of Object.entries(raw.overrides || {})) if (Object.hasOwn(next.heads, head)) {
        shaft.overrides[head] = cleanTransform(pair, true);
        if (typeof pair?.disallow === 'boolean') shaft.overrides[head].disallow = pair.disallow;
      }
      for (const [head, pair] of Object.entries(shipped || {})) {
        if (typeof pair.disallow === 'boolean' && typeof shaft.overrides[head]?.disallow !== 'boolean') {
          if (!shaft.overrides[head]) shaft.overrides[head] = {};
          shaft.overrides[head].disallow = pair.disallow;
        }
        if (pair.layerOrder && !shaft.overrides[head]?.layerOrder) {
          if (!shaft.overrides[head]) shaft.overrides[head] = {};
          shaft.overrides[head].layerOrder = pair.layerOrder; // Missing values from old exports inherit each explicitly authored layer choice.
        }
        if (pair.bridges && !Object.hasOwn(raw.overrides?.[head] || {}, 'bridges') && !shaft.overrides[head]?.bridges) {
          const bridges = cleanBridges(pair.bridges); // Imports predating bridge strokes keep the committed ones.
          if (bridges) (shaft.overrides[head] ||= {}).bridges = bridges;
        }
      }
    }
    next.recipes = cleanRecipes(Object.hasOwn(incoming, 'recipes') ? incoming.recipes : reference.recipes);
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
  function settings(shaft, head) { return { ...NEUTRAL, ...(config.shafts[shaft]?.overrides[head] || {}) }; } // Only selected combination's corrections.
  function isDisallowed(shaft, head) {
    return !config.shafts?.[shaft] || !config.heads?.[head] ||
      config.heads[head].craftDisabled === true || // Retired heads still render on saved gear, but cannot form new forgeable pairs.
      !matchingMounts(config.shafts[shaft], config.heads[head]).length ||
      config.shafts[shaft].overrides[head]?.disallow === true;
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
  function headTransform(mount, values, headMount) {
    const src = headMount, target = mount; // Head/source and shaft/destination directed lines.
    const hx = src.end.x - src.start.x, hy = src.end.y - src.start.y; // Direction and physical authored length of the head's tang/eye.
    const tx = target.end.x - target.start.x, ty = target.end.y - target.start.y; // Matching directed haft mount.
    const srcLength = Math.hypot(hx, hy), targetLength = Math.hypot(tx, ty); // Uniform automatic scale follows line-length ratio.
    if (srcLength < 1 || targetLength < 1) throw new Error('Mount arrows must be at least one pixel long.');
    const baseAngle = Math.atan2(ty, tx) - Math.atan2(hy, hx); // Rotate the head's arrow exactly onto the haft's arrow.
    const ratio = targetLength / srcLength; // Automatic stretch is applied ONLY along the head's drawn mounting axis.
    const ux = hx / srcLength, uy = hy / srcLength; // Unit tangent of the original head arrow.
    const delta = ratio - 1; // Rank-one axis stretch leaves the perpendicular dimension untouched.
    const fitA = 1 + delta * ux * ux, fitB = delta * ux * uy; // First column and off-diagonal of the head-axis fit.
    const fitC = fitB, fitD = 1 + delta * uy * uy; // Second column of the axis-only fit.
    const angle = baseAngle + values.rotation * Math.PI / 180; // Pair rotation is an additional correction.
    const sx = values.scaleX * (values.flipX ? -1 : 1), sy = values.scaleY * (values.flipY ? -1 : 1); // Pair scale/flip follows fitting.
    const cos = Math.cos(angle), sin = Math.sin(angle); // Final rotation aligns directed arrows.
    const a = cos * sx * fitA - sin * sy * fitB, b = sin * sx * fitA + cos * sy * fitB;
    const c = cos * sx * fitC - sin * sy * fitD, d = sin * sx * fitC + cos * sy * fitD;
    const shaftAxis = Math.atan2(ty, tx) + Math.PI / 2; // Pair offsets are in the haft's local axes, preserving legacy socket offsets.
    const ox = Math.cos(shaftAxis) * values.x - Math.sin(shaftAxis) * values.y;
    const oy = Math.sin(shaftAxis) * values.x + Math.cos(shaftAxis) * values.y;
    return { a, b, c, d, e: target.start.x + ox - a * src.start.x - c * src.start.y,
      f: target.start.y + oy - b * src.start.x - d * src.start.y }; // Exact Canvas affine matrix.
  }
  function multiplyAffine(parent, child) {
    // Compose a primitive's local transform underneath the attachment rig, never underneath the shaft sprite.
    return {
      a: parent.a * child.a + parent.c * child.b,
      b: parent.b * child.a + parent.d * child.b,
      c: parent.a * child.c + parent.c * child.d,
      d: parent.b * child.c + parent.d * child.d,
      e: parent.a * child.e + parent.c * child.f + parent.e,
      f: parent.b * child.e + parent.d * child.f + parent.f,
    };
  }
  function attachmentRig(shaft, head, values) {
    const layout = shaftRigTransform(shaft);
    const parent = {
      a: layout.scaleX, b: 0, c: 0, d: layout.scaleY,
      e: 225 + layout.x - 225 * layout.scaleX,
      f: 602 + layout.y - 602 * layout.scaleY,
    }; // Parent attachment primitive transform; shaft image and shaft VFX are intentionally siblings, not children.
    if (!head) return { kind: 'attachmentRig', parent, children: [], shaftOutsideRig: true }; // Operation/junction-only callers need the parent, without a fitted head.
    const required = head?.mount?.type === 'blade' ? 'tang' : head?.mount?.type === 'weight' ? 'eye' : '';
    const compatible = (shaft?.mounts || []).map((mount, index) => ({ mount, index }))
      .filter(entry => entry.mount.type === required);
    const selected = compatible.length ? compatible : (shaft?.mounts || []).slice(0, 1).map((mount, index) => ({ mount, index }));
    const children = selected.map(({ mount, index }) => {
      const region = regionAt(shaft,{x:(mount.start.x+mount.end.x)/2,y:(mount.start.y+mount.end.y)/2});
      const regionMatrix=regionAffine(region); // Mount and fitted primitive are descendants of this local area.
      const localMatrix = headTransform(mount, values, head.mount); // Fit first; inherit region and overall rig parents afterward.
      return {
        kind: 'mount', index, type: mount.type, localMount: mount, regionId:region?.id||null, regionMatrix,
        worldMount: { type: mount.type, start: rigPoint(shaft,mount.start,region), end: rigPoint(shaft,mount.end,region) },
        children: [{
          kind: 'primitive', source: 'head', localMatrix,
          worldMatrix: multiplyAffine(multiplyAffine(parent,regionMatrix), localMatrix),
        }],
      };
    }); // Rig owns every fitted head primitive and tang/eye fitting as descendants, not just transformed coordinates.
    return { kind: 'attachmentRig', parent, children, shaftOutsideRig: true };
  }
  function compositionFrame(shaft, head, bounds, values, bridgeOps = [], junctionImages = {}) {
    let left = 0, top = 0, right = 450, bottom = 1204; // Fixed shaft envelope; only the rig's child primitives can expand the frame.
    for (const mount of attachmentRig(shaft, head, values).children) {
      for (const primitive of mount.children) {
        const matrix = primitive.worldMatrix; // Same parent*child transform that the canvas renderer uses.
        for (const x of [bounds.left, bounds.right]) for (const y of [bounds.top, bounds.bottom]) {
          const px = matrix.a * x + matrix.c * y + matrix.e, py = matrix.b * x + matrix.d * y + matrix.f;
          left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px); bottom = Math.max(bottom, py);
        }
      }
    }
    // A moved junction or bridge can extend further than the attached head. Include these children before allocating the bitmap.
    const parent = attachmentRig(shaft).parent;
    for (const op of bridgeOps) {
      if (op.junction) {
        const piece = junctionImages[op.junction];
        if (!piece) continue;
        const halfW = piece.width / 2 * op.scale, halfH = piece.height / 2 * op.scale;
        const angle = op.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        for (const x of [-halfW, halfW]) for (const y of [-halfH, halfH]) {
          const localX = op.x + cos * x - sin * y, localY = op.y + sin * x + cos * y;
          const px = parent.a * localX + parent.c * localY + parent.e;
          const py = parent.b * localX + parent.d * localY + parent.f;
          left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px); bottom = Math.max(bottom, py);
        }
      } else if (op.points) {
        for (const [x,y] of op.points) {
          const rx = Math.max(0, op.rX || op.r || 0), ry = Math.max(0, op.rY || op.r || 0);
          left = Math.min(left, x-rx); right = Math.max(right, x+rx);
          top = Math.min(top, y-ry); bottom = Math.max(bottom, y+ry);
        }
      }
    }
    left = Math.floor(left) - 4; top = Math.floor(top) - 4;
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
    const pieces = [...new Set(expandOps(settings(shaftKey, headKey).bridges?.strokes || []).filter(op => op.junction).map(op => op.junction))];
    const junctionsReady = Promise.all(pieces.map(name => loadImage(junctionPath(name), base).then(image => [name, image],
      () => { global.console?.warn?.('Modular weapon junction piece missing:', name); return [name, null]; })));
    const task = Promise.all([loadImage(shaft.sprite, base), loadImage(head.sprite, base), junctionsReady]).then(([shaftImage, headImage, junctionList]) => {
      const values = settings(shaftKey, headKey); // Resolved authoring values are shared by bounds calculation and drawing.
      const frame = compositionFrame(shaft, head, visibleBounds(headImage), values,
        rigBridgeOperations(shaft, values.bridges?.strokes || []), Object.fromEntries(junctionList)); // Include movable bridge/junction children in bounds.
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
      const protectedCanvas = shaft.fireAssembly ? document.createElement('canvas') : null; // Preserve nonmetal living-shaft pixels when the forged HEAD receives metal/verdigris.
      if (protectedCanvas) { protectedCanvas.width = canvas.width; protectedCanvas.height = canvas.height; }
      const protectedCtx = protectedCanvas?.getContext('2d') || null; // Bound to this composition, not per-frame.
      if (protectedCtx) {
        protectedCtx.scale(canvas.width / frame.width, canvas.height / frame.height);
        protectedCtx.translate(-frame.left, -frame.top);
      }
      function paintHaft() {
        const fire = shaft.fireAssembly && global.WEAPON_SPRITE_ASSEMBLY_CONFIG?.weapons?.[shaft.fireAssembly]?.base;
        const image = fire?.material === 'marker'
          ? global.HobunjiLayeredWeaponEffects?.recolorMarker?.(shaftImage, fire.sourceHex, fire.targetHex) || shaftImage
          : shaftImage; // The shaft's fixed artwork is recolored, but never scaled or translated with its mounting rig.
        for (const context of [ctx, protectedCtx].filter(Boolean)) {
          context.save();
          if (shaft.crop) {
            context.beginPath(); context.rect(shaft.crop.x, shaft.crop.y, shaft.crop.width, shaft.crop.height); context.clip();
          }
          context.drawImage(image, 0, 0, 450, 1204);
          context.restore(); // Neither the head fit nor the mounting rig changes this source-to-output mapping.
        }
      }
      function paintHeads() {
        const rig = attachmentRig(shaft, head, values); // Explicit parent -> mounting lines -> head primitives hierarchy.
        const needsParent = rig.parent.a !== 1 || rig.parent.d !== 1 || rig.parent.e !== 0 || rig.parent.f !== 0;
        const drawChildren = (context, eraseShaft = false) => {
          context.save(); // Parent is active ONLY around rig children, never around paintHaft().
          if (eraseShaft) context.globalCompositeOperation = 'destination-out';
          if (needsParent) {
            const t = rig.parent;
            context.transform(t.a, t.b, t.c, t.d, t.e, t.f); // One parent scaling rig; all primitives and sockets are its children.
          }
          for (const mounting of rig.children) for (const primitive of mounting.children) {
            const t = primitive.localMatrix, area=mounting.regionMatrix; // Selected area is a parent of the fitted head primitive.
            context.save();
            if (mounting.regionId) context.transform(area.a, area.b, area.c, area.d, area.e, area.f);
            context.transform(t.a, t.b, t.c, t.d, t.e, t.f);
            context.drawImage(headImage, 0, 0, 450, 1204);
            context.restore();
          }
          context.restore();
        };
        drawChildren(ctx);
        if (protectedCtx && values.layerOrder === 'head-over-haft') {
          drawChildren(protectedCtx, true); // The same parent and descendants occlude only covered nonmetal-shaft pixels.
        }
      }
      if (values.layerOrder === 'head-over-haft') { paintHaft(); paintHeads(); } // Specific pair opts into foreground heads.
      else { paintHeads(); paintHaft(); } // Default: all repeated heads behind the single, intact haft.
      applyBridges(canvas, frame, values.bridges, Object.fromEntries(junctionList), shaft); // All strokes and expanded recipes follow the same parent rig as head primitives.
      if (protectedCtx) {
        const rgba = protectedCtx.getImageData(0, 0, canvas.width, canvas.height).data;
        const mask = new Uint8Array(canvas.width * canvas.height); // One byte per protected shaft pixel; head metal remains exposed.
        for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3] > 0 ? 1 : 0;
        canvas.modularNonMetalMask = mask; // ToolMetalRecolor restores original full-shaft colors after tinting only metal head pixels.
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
      if (shaft.editorOnly) continue; // Incomplete upload previews cannot create forgeable weapon items.
      const source = shapes[shaft.sourceShape] || { animStyle: 'sweep', weaponIdleClass: 'heavy' }; // Future/relic source shapes still get a usable baseline.
      for (const [headKey, head] of Object.entries(config.heads)) for (const metalKey of metalKeys) {
        if (head.editorOnly) continue; // Uncalibrated previews lack definitions; craftDisabled heads retain definitions for existing saved weapons.
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
    const shafts = Object.keys(config.shafts).filter(key => !config.shafts[key].editorOnly && sources.has(config.shafts[key].sourceShape)); // Known donor shapes only.
    const heads = Object.keys(config.heads).filter(key => !config.heads[key].editorOnly && !config.heads[key].craftDisabled && sources.has(config.heads[key].sourceShape)
      && shafts.some(shaft => !isDisallowed(shaft, key))); // Avoid exposing heads incompatible with every unlocked shaft.
    return { heads, shafts: shafts.filter(shaft => heads.some(head => !isDisallowed(shaft, head))) };
  }
  try {
    const recent = global.localStorage?.getItem(DRAFT_KEY), prior = global.localStorage?.getItem(OLD_DRAFT_KEY);
    const oldest = global.localStorage?.getItem(LEGACY_DRAFT_KEY); // Only migrate once; current v5 always wins.
    if (recent) replace(JSON.parse(recent));
    else if (prior) replace(addCompanionsToPreviousDraft(JSON.parse(prior)), true);
    else if (oldest) replace(JSON.parse(oldest), true);
  } catch (error) { global.__farmLog?.(`[Foundry] Ignored invalid attachment draft: ${error.message}`, 'warn'); }
  global.ModularWeapons = { getConfig: () => config, replace, settings, isDisallowed, transforms, decode, itemKey, sourceShape, headTransform, compositionFrame, planeLayout, fitPlaneGeometry, compose, loadImage, registerDefinitions, unlockedParts, matchingMounts,
    duplicateTransform, duplicatePoint, shaftRigTransform, shaftArtTransform, cleanRigRegions, regionAt, regionAffine, affinePoint, rigPoint, shaftMounts, attachmentRig, rigBridgeOperations, multiplyAffine, JUNCTIONS, junctionPath, drawJunction, expandOps,
    diagnostics: key => ({ parts: decode(key), gripSource: sourceShape(key), cachedSprites: canvases.size, revision }) };
})(window);
