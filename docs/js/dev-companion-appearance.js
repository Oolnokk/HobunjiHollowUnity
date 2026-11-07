// Game-side, session-scoped appearance inspector for the existing Dev Companion.
(() => {
  'use strict';
  const bridge = window.DevCompanion; // Existing second-window transport, panel registry, and Dev Mode gate.
  if (!bridge?.registerCheatPanel || window.DevCompanionAppearance) return;
  const RADIUS = 10; // Maximum distance in world tiles for candidates in the selected area.
  const ids = new WeakMap(); // Stable identities distinguish same-species creatures without stale array indices.
  const initial = new WeakMap(); // Original authored values for Reset selected.
  const settings = new WeakMap(); // Runtime material filters and scale multipliers for each entity.
  const refreshJobs = new WeakMap(); // Serializes overlapping async portrait refresh operations.
  let sequence = 0;
  let selectedId = 'player';
  let status = 'Select a nearby entity to edit its in-world visual.';
  const deps = () => window.Combat?.deps || window.BanditCombat?.deps || {};
  const area = () => window.GridTileAccessors?.getCurrentArea?.() || deps().getCurrentArea?.();
  const scene = () => window.GridTileAccessors?.getActiveScene?.() || deps().getActiveScene?.();
  const playerRoot = () => window.PlayerBodyTransformComposer?.getPlayerMesh?.() || deps().playerMesh;
  const playerData = () => deps().getPlayerData?.() || window.__hobunjiPlayerProfile;
  const playerAvatar = () => window.WorldPortraitLife?.getPlayerAvatar?.();
  const validHex = value => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : null;
  const colorOf = value => validHex(typeof value === 'string' ? value : value?.hex);
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function identity(entity) {
    if (!ids.has(entity)) ids.set(entity, 'entity-' + (++sequence));
    return ids.get(entity);
  }
  function pos(root) {
    if (!root?.position) return null;
    try { if (root.getWorldPosition && window.THREE?.Vector3) return root.getWorldPosition(new THREE.Vector3()); }
    catch (_) { /* Scene transition can detach an avatar. */ }
    return root.position;
  }
  function candidates() {
    const center = pos(playerRoot());
    const seen = new Set();
    const found = [];
    if (!center) return found;
    function add(kind, entity, root, label, always = false) {
      if (!entity || !root?.isObject3D || seen.has(root)) return;
      const p = pos(root);
      if (!p) return;
      const distance = Math.hypot(p.x - center.x, p.z - center.z);
      if (!always && distance > RADIUS) return;
      seen.add(root);
      found.push({ kind, entity, root, id: kind === 'player' ? 'player' : identity(entity),
        label: String(label || kind), distance });
    }
    add('player', playerData() || playerRoot(), playerRoot(), 'Player (you)', true);
    const walkers = window.__hobunjiFurnitureDebug?.getNpcWalkers?.() || deps().npcWalkers || window._npcWalkers || [];
    for (const walker of walkers) {
      if (walker?.area === area()) add('npc', walker, walker.root, walker.rec?.name || walker.rec?.id || 'NPC');
    }
    const creatureSources = new Set([...(deps().companionObjects || []), ...(deps().hostileObjects || []), ...(deps().animalObjects || [])]);
    for (const c of creatureSources) {
      if ((c.areaId && c.areaId !== area()) || (c.area && c.area !== area())) continue;
      add('creature', c, c.avatarRef?.group, c.name || c.displayName || c.creatureKey || c.animalKey || c.def?.label || 'Creature');
    }
    const other = [];
    for (const node of scene()?.children || []) {
      if (!node?.name || seen.has(node) || !node.visible || (!node.isMesh && !node.isGroup)) continue;
      if (/^(ground|terrain|water|sky|light|grass|floor|wall|collision|shadow|particle)/i.test(node.name)) continue;
      const p = pos(node);
      if (!p) continue;
      const d = Math.hypot(p.x - center.x, p.z - center.z);
      if (d <= RADIUS) other.push({ node, d });
    }
    other.sort((a, b) => a.d - b.d);
    for (const item of other.slice(0, 24)) add('object', item.node, item.node, item.node.name);
    found.sort((a, b) => a.kind === 'player' ? -1 : b.kind === 'player' ? 1 : a.distance - b.distance);
    return found.slice(0, 65);
  }
  function target() { return candidates().find(entry => entry.id === selectedId) || null; }
  function appearance(entry) {
    if (entry.kind === 'player') return playerData()?.appearance;
    if (entry.kind === 'npc') return entry.entity.rec?.appearance;
    return null;
  }
  function colorSlots(entry) {
    const profile = entry.kind === 'player' ? playerAvatar()?.profile : entry.entity?.profile;
    const colors = { ...(profile?.bodyColors || {}), ...(appearance(entry)?.bodyColors || {}) };
    return Object.entries(colors).filter(([key, color]) =>
      /^[A-Z][A-Z0-9_]*$/.test(key) && (colorOf(color) ||
        (color && typeof color === 'object' && ['h', 's', 'v'].some(field => Number.isFinite(Number(color[field])) && color[field] != null))))
      .slice(0, 16);
  }
  const CLOTHING_TINT_KEYS = Object.freeze({
    hat: ['HAT'], hood: ['HOOD', 'HOOD_B'], mask: ['MASK', 'MASK_B'],
    pauldron: ['PAULDRON'], torso: ['TORSO'], overwear: ['CLOTH', 'CLOTH_B'],
    pants: ['PANTS', 'PANTS_B'],
  }); // Uses the same slot-to-portrait channels as EquipmentPanel and NpcWardrobe.
  const GARMENT_FIELDS = Object.freeze(['colorA', 'colorB', 'colorC', 'weaving']); // Only appearance fields; never changes defense, weight, durability, or price.
  const PATTERN_NUMBERS = Object.freeze({
    meshScale: { label: 'Pattern scale', min: .4, max: 3.2, step: .05, fallback: 1 },
    meshRotationDeg: { label: 'Rotation °', min: -180, max: 180, step: 5, fallback: 0 },
    usageOffsetX: { label: 'Offset X px', min: -4096, max: 4096, step: 1, fallback: 0 },
    usageOffsetY: { label: 'Offset Y px', min: -4096, max: 4096, step: 1, fallback: 0 },
    usageScaleMultiplier: { label: 'Size multiplier', min: .1, max: 20, step: .1, fallback: 1 },
  }); // Authored weaving transform names and safe renderer clamp ranges.

  function garments(entry) {
    if (entry.kind === 'player') {
      const worn = window.EquipmentPanel?.devWornClothing?.() || {};
      return Object.entries(worn).filter(([slot, item]) => CLOTHING_TINT_KEYS[slot] && item && typeof item === 'object')
        .map(([slot, item]) => ({ slot, item }));
    }
    if (entry.kind === 'npc') {
      return (window.NpcWardrobe?.wornClothingItemsForRecord?.(entry.entity.rec, true) || [])
        .filter(item => item && CLOTHING_TINT_KEYS[item.slot])
        .map(item => ({ slot: item.slot, item }));
    }
    return [];
  }
  function clothingHex(color) {
    const dyeId = typeof color === 'string' ? color : color?.dyeId;
    return colorOf(color) || (dyeId ? colorOf(window.DyeSystem?.getById?.(dyeId)?.hex) : null);
  }
  function garmentVisual(item) {
    return Object.fromEntries(GARMENT_FIELDS.map(key => [key, clone(item?.[key])])); // Snapshot only paint/weave values, never gameplay data.
  }
  function patternedEntries(weaving) {
    const result = [];
    const collect = (role, item) => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item.patterns)) item.patterns.slice(0, 2).forEach((pattern, i) => {
        if (pattern && typeof pattern === 'object') result.push({ role, index: i, pattern });
      });
      else if (item.pattern && typeof item.pattern === 'object') result.push({ role, index: 0, pattern: item.pattern });
      else if (item.patternLibraryId) {
        const pattern = window.PatternLibrary?.getById?.(item.patternLibraryId);
        if (pattern && typeof pattern === 'object') result.push({ role, index: 0, pattern });
      }
    };
    if (weaving?.layers && typeof weaving.layers === 'object') {
      Object.entries(weaving.layers).slice(0, 16).forEach(([role, layer]) => collect(role, layer));
    } else collect('__legacy', weaving);
    if (weaving?.forcedOverpassPattern) result.push({ role: '__forced', index: 0, pattern: weaving.forcedOverpassPattern });
    return result.slice(0, 20); // Prevent a malformed imported garment from flooding the mobile panel.
  }
  function mutablePattern(weaving, role, index) {
    if (!weaving || !Number.isInteger(index) || index < 0 || index > 1) return null;
    if (role === '__forced') return index === 0 ? weaving.forcedOverpassPattern : null;
    const source = role === '__legacy' ? weaving : weaving.layers?.[role];
    if (!source || typeof source !== 'object') return null;
    if (Array.isArray(source.patterns)) return source.patterns[index] || null;
    if (index !== 0) return null;
    if (!source.pattern && source.patternLibraryId) {
      const libraryPattern = window.PatternLibrary?.getById?.(source.patternLibraryId);
      if (libraryPattern) source.pattern = clone(libraryPattern); // Local copy, never mutate the shared Pattern Library record.
    }
    return source.pattern || null;
  }
  function authoredTintKeys(entry) {
    const keys = new Set();
    for (const { slot } of garments(entry)) for (const key of CLOTHING_TINT_KEYS[slot]) keys.add(key);
    return keys; // Hides duplicate portrait dye controls that gear/wardrobe overrides would immediately overwrite.
  }
  function garmentActions(entry) {
    const actions = [];
    for (const { slot, item } of garments(entry)) {
      const group = 'Clothing: ' + slot;
      for (const field of ['colorA', 'colorB', 'colorC']) {
        const color = item[field];
        const hasPattern = !!patternedEntries(item.weaving).length;
        if (color == null && !(field === 'colorC' && hasPattern)) continue;
        if (color && typeof color === 'object' && !colorOf(color) && ['h', 's', 'v'].some(key => color[key] != null)) {
          for (const [key, label, min, max, step] of [
            ['h', 'Hue', -360, 360, 5], ['s', 'Saturation', -1, 2, .05], ['v', 'Brightness', -1, 2, .05],
          ]) actions.push({ id: 'cloth-hsv:' + slot + ':' + field + ':' + key,
            label: field + ' ' + label, group, input: { min, max, step }, value: Number(color[key]) || 0 });
        } else actions.push({ id: 'cloth-color:' + slot + ':' + field,
          label: field + ' dye', group, input: { type: 'color' }, value: clothingHex(color) || '#808080' });
      }
      for (const { role, index, pattern } of patternedEntries(item.weaving)) {
        for (const [field, def] of Object.entries(PATTERN_NUMBERS)) {
          actions.push({ id: 'cloth-pattern:' + slot + ':' + encodeURIComponent(role) + ':' + index + ':' + field,
            label: (role === '__legacy' ? 'All' : role === '__forced' ? 'Forced' : role) +
              (index ? ' overpass' : '') + ' · ' + def.label,
            group, input: { min: def.min, max: def.max, step: def.step },
            value: Number.isFinite(Number(pattern[field])) ? Number(pattern[field]) : def.fallback });
        }
      }
      if (item.weaving?.trim) {
        actions.push({ id: 'cloth-trim:' + slot + ':enabled', label: 'Trim enabled', group,
          value: item.weaving.trim.enabled ? 'yes' : 'no',
          options: [{ value: 'yes', label: 'On' }, { value: 'no', label: 'Off' }] });
        actions.push({ id: 'cloth-trim:' + slot + ':dyeSlot', label: 'Trim dye channel', group,
          value: item.weaving.trim.dyeSlot || 'B',
          options: ['A', 'B', 'C'].map(value => ({ value, label: value })) });
      }
    }
    return actions;
  }
  async function changeGarment(entry, action, value) {
    const parts = String(action).split(':'); // Fixed action grammar prevents arbitrary object-path writes from the companion.
    const slot = parts[1];
    const found = garments(entry).find(item => item.slot === slot);
    if (!found) throw new Error('This garment is no longer equipped.');
    const { item } = found;
    const before = garmentVisual(item);
    const next = garmentVisual(item); // Nested pattern transforms are edited on a detached copy.
    if (parts[0] === 'cloth-color' && parts.length === 3) {
      if (!['colorA', 'colorB', 'colorC'].includes(parts[2]) || !validHex(value)) throw new Error('Invalid clothing dye.');
      next[parts[2]] = { hex: validHex(value), tintMode: 'hexShadeFill' };
    } else if (parts[0] === 'cloth-hsv' && parts.length === 4) {
      const [field, component] = [parts[2], parts[3]];
      const limits = { h: [-360, 360], s: [-1, 2], v: [-1, 2] };
      const number = Number(value);
      if (!['colorA', 'colorB', 'colorC'].includes(field) || !Object.hasOwn(limits, component)
        || !Number.isFinite(number) || number < limits[component][0] || number > limits[component][1])
        throw new Error('Invalid clothing hue, saturation or brightness.');
      next[field] = { ...(typeof next[field] === 'object' && next[field] || {}), [component]: number };
      delete next[field].hex;
      delete next[field].tintMode;
    } else if (parts[0] === 'cloth-pattern' && parts.length === 5) {
      const role = decodeURIComponent(parts[2]);
      const index = Number(parts[3]);
      const field = parts[4];
      const spec = PATTERN_NUMBERS[field];
      const number = Number(value);
      if (!spec || !Number.isFinite(number) || number < spec.min || number > spec.max)
        throw new Error('Pattern transform is out of range.');
      const pattern = mutablePattern(next.weaving, role, index);
      if (!pattern) throw new Error('Pattern is no longer available on this garment.');
      pattern[field] = number;
    } else if (parts[0] === 'cloth-trim' && parts.length === 3 && next.weaving?.trim) {
      if (parts[2] === 'enabled' && ['yes', 'no'].includes(String(value))) next.weaving.trim.enabled = value === 'yes';
      else if (parts[2] === 'dyeSlot' && ['A', 'B', 'C'].includes(String(value))) next.weaving.trim.dyeSlot = value;
      else throw new Error('Invalid trim setting.');
    } else throw new Error('Unknown garment appearance control.');
    const snapshot = remember(entry);
    if (!snapshot.garments) snapshot.garments = new Map(); // Slot -> originally equipped item and its appearance; Reset never modifies replacement clothing.
    if (entry.kind === 'player' && !snapshot.garments.has(slot))
      snapshot.garments.set(slot, { item, visual: before });
    const npcId = entry.kind === 'npc' ? entry.entity.rec?.id : null;
    if (entry.kind === 'npc' && !npcId) throw new Error('NPC has no stable wardrobe identity for preview edits.');
    const wardrobe = window.NpcWardrobe;
    const previousOverride = npcId ? wardrobe?.getDevClothingVisual?.(npcId, slot) : null;
    if (npcId) {
      if (!wardrobe?.setDevClothingVisual?.(npcId, slot, { ...next, cosmeticId: item.cosmeticId })) throw new Error('NPC wardrobe preview is unavailable.');
    } else for (const field of GARMENT_FIELDS) {
      if (next[field] === undefined) delete item[field];
      else item[field] = clone(next[field]); // Original equipped gear object remains live in all gameplay systems.
    }
    try {
      await refresh(entry);
    } catch (error) {
      if (npcId) {
        if (previousOverride) wardrobe?.setDevClothingVisual?.(npcId, slot, previousOverride);
        else wardrobe?.clearDevClothingVisual?.(npcId, slot);
      } else for (const field of GARMENT_FIELDS) {
        if (before[field] === undefined) delete item[field];
        else item[field] = clone(before[field]);
      }
      throw error;
    }
    status = entry.label + ': ' + slot + ' clothing ' + parts[0].slice(6) + ' updated.';
    return { ok: true };
  }

  function remember(entry) {
    if (!initial.has(entry.entity)) initial.set(entry.entity, {
      colors: clone(appearance(entry)?.bodyColors),
      hadNpcAppearance: entry.kind === 'npc' ? !!entry.entity.rec?.appearance : null, // Reset can remove a temporary appearance block on legacy NPCs.
      coat: entry.entity.genotype?.base?.color,
      scale: { x: entry.root.scale.x, y: entry.root.scale.y, z: entry.root.scale.z },
      visual: { x: entry.entity.visualScaleX, y: entry.entity.visualScaleY, z: entry.entity.visualScaleZ },
    }); // Stored only until Reset; game owns all actual avatar data.
    return initial.get(entry.entity);
  }
  function edit(entry) {
    if (!settings.has(entry.entity)) settings.set(entry.entity, {
      scale: { x: 100, y: 100, z: 100 }, tint: '#ffffff', opacity: 100,
      materials: new Map(), // Mesh -> original material; clones prevent one actor recoloring shared assets.
    });
    return settings.get(entry.entity);
  }
  function applyFilters(entry) {
    const state = edit(entry);
    entry.root.traverse(mesh => {
      if (!mesh.material) return;
      if (!state.materials.has(mesh)) {
        const before = mesh.material;
        const duplicate = material => material?.clone?.() || material;
        mesh.material = Array.isArray(before) ? before.map(duplicate) : duplicate(before);
        state.materials.set(mesh, before);
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const base = state.materials.get(mesh);
      const originals = Array.isArray(base) ? base : [base]; // Preserve existing creature/body/material tint instead of whitening it.
      mats.forEach((mat, index) => {
        if (!mat) return;
        const source = originals[index] || originals[0];
        if (source?.color && mat.color?.copy) {
          mat.color.copy(source.color);
          if (state.tint !== '#ffffff' && window.THREE?.Color && mat.color.multiply)
            mat.color.multiply(new THREE.Color(state.tint));
        }
        mat.opacity = (Number.isFinite(source?.opacity) ? source.opacity : 1) * state.opacity / 100;
        mat.transparent = !!source?.transparent || mat.opacity < 1;
        mat.needsUpdate = true;
      });
    });
  }
  function restoreMaterials(entry) {
    const state = settings.get(entry.entity);
    for (const [mesh, before] of state?.materials || []) {
      const after = mesh.material;
      mesh.material = before;
      const beforeMats = Array.isArray(before) ? before : [before];
      for (const mat of Array.isArray(after) ? after : [after]) if (!beforeMats.includes(mat)) mat?.dispose?.();
    }
    state?.materials.clear();
  }
  async function rebuild(entry) {
    if (entry.kind === 'player') {
      if (!window.EquipmentPanel?.refreshPlayerAvatar) throw new Error('Player avatar rebuild is unavailable.');
      await window.EquipmentPanel.refreshPlayerAvatar();
    } else if (entry.kind === 'npc') {
      if (!window.NpcWardrobe?.refreshWalkerAppearance) throw new Error('NPC avatar rebuild is unavailable.');
      await window.NpcWardrobe.refreshWalkerAppearance(entry.entity, { strict: true });
    } else if (entry.kind === 'creature' && entry.entity.genotype) {
      const rawKind = entry.entity.creatureKey || entry.entity.animalKey; // Some gameplay creature keys share one renderer species.
      const kind = window.CreatureGeneticsRender?.SPECIES?.[rawKind] ? rawKind
        : (window.CreatureGenetics?.SPECIES_ALIAS?.[rawKind] || rawKind);
      const draw = window.CreatureGeneticsRender?.composeFrame;
      const upload = window.PNGPlaneAvatar?.refreshSinglePlaneAvatarModel;
      if (!kind || !draw || !upload) throw new Error('Creature coat compositor is unavailable.');
      const image = await draw(kind, 'idle', entry.entity.genotype, false);
      if (!image || !upload(entry.root, image)) throw new Error('Creature art did not redraw.');
      entry.entity._frameAppliedKey = null; // Farm livestock can restore its locomotion frame on the following tick.
    }
    const state = settings.get(entry.entity);
    if (state && (state.tint !== '#ffffff' || state.opacity !== 100)) applyFilters(entry);
    scene()?.updateMatrixWorld?.(true);
  }
  function refresh(entry) {
    const earlier = refreshJobs.get(entry.entity) || Promise.resolve();
    const queued = earlier.catch(() => {}).then(() => rebuild(entry));
    refreshJobs.set(entry.entity, queued);
    return queued;
  }
  async function change(entry, action, value) {
    const saved = remember(entry);
    const state = edit(entry);
    if (action.startsWith('color:') || action.startsWith('hsv:')) {
      const fields = action.split(':'); // "color:A" or "hsv:A:h/s/v" is the only accepted editable path.
      const slot = fields[1];
      const available = colorSlots(entry).find(([key]) => key === slot);
      if (!available) throw new Error('Unknown color slot.');
      let newColor;
      if (fields[0] === 'color') {
        if (!validHex(value) || fields.length !== 2) throw new Error('Expected a six-digit hex color.');
        newColor = { hex: validHex(value), tintMode: 'hexShadeFill' };
      } else {
        const component = fields[2];
        const n = Number(value);
        const limits = { h: [-360, 360], s: [-1, 2], v: [-1, 2] }; // Same hue degrees and relative sat/brightness offsets used by buildCSSFilter.
        if (fields.length !== 3 || !Object.hasOwn(limits, component) ||
          !Number.isFinite(n) || n < limits[component][0] || n > limits[component][1])
          throw new Error('Invalid hue, saturation or brightness value.');
        newColor = { ...(available[1] || {}), [component]: n };
        delete newColor.hex; // The renderer prioritizes hex; remove it so H/S/V edits can take effect.
        delete newColor.tintMode;
      }
      const rec = entry.kind === 'npc' ? entry.entity.rec : null; // Legacy NPCs can lack an authored appearance object.
      const existed = !!appearance(entry);
      if (!existed && rec) rec.appearance = {};
      const owner = appearance(entry);
      if (!owner) throw new Error('This character has no editable appearance.');
      const previous = owner.bodyColors;
      owner.bodyColors = { ...(owner.bodyColors || {}), [slot]: newColor };
      try { await refresh(entry); }
      catch (error) {
        if (previous === undefined) delete owner.bodyColors;
        else owner.bodyColors = previous;
        if (!existed && rec) delete rec.appearance;
        throw error;
      }
    } else if (action === 'coat') {
      if (!validHex(value) || entry.kind !== 'creature' || !entry.entity.genotype?.base)
        throw new Error('This creature has no editable base coat.');
      const previous = entry.entity.genotype.base.color; // Failed texture recomposes must not leave a hidden gameplay genotype mutation.
      entry.entity.genotype.base.color = validHex(value);
      try { await refresh(entry); }
      catch (error) { entry.entity.genotype.base.color = previous; throw error; }
    } else if (action.startsWith('scale:')) {
      const axis = action.slice(6);
      const n = Number(value);
      if (!['x', 'y', 'z'].includes(axis) || !Number.isFinite(n) || n < 25 || n > 300)
        throw new Error('Scale must be 25–300%.');
      state.scale[axis] = n;
      if (entry.kind === 'creature' && saved.visual[axis] != null) {
        entry.entity['visualScale' + axis.toUpperCase()] = saved.visual[axis] * n / 100;
        window.CreatureGenetics?.applyCreatureBillboardScale?.(entry.root, {
          x: entry.entity.visualScaleX || 1, y: entry.entity.visualScaleY || 1,
          z: entry.entity.visualScaleZ || entry.entity.visualScaleX || 1,
        }, entry.entity.scaleY);
      } else entry.root.scale[axis] = saved.scale[axis] * n / 100;
      entry.root.updateMatrixWorld?.(true);
    } else if (action === 'tint') {
      if (!validHex(value)) throw new Error('Enter a six-digit hex color.');
      state.tint = validHex(value);
      applyFilters(entry);
    } else if (action === 'opacity') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 10 || n > 100) throw new Error('Opacity must be 10–100%.');
      state.opacity = n;
      applyFilters(entry);
    } else throw new Error('Unsupported visual field.');
    status = entry.label + ': ' + action + ' applied live.';
    return { ok: true };
  }
  async function reset(entry) {
    const saved = initial.get(entry.entity);
    if (!saved) return { ok: true };
    const owner = appearance(entry);
    if (entry.kind === 'npc' && !saved.hadNpcAppearance) {
      delete entry.entity.rec.appearance;
    } else if (owner) {
      if (saved.colors === undefined) delete owner.bodyColors;
      else owner.bodyColors = clone(saved.colors);
    }
    if (entry.kind === 'player' && saved.garments) {
      for (const [, original] of saved.garments) {
        // Restore the original article even if it was unequipped since the edit; never touch its replacement.
        for (const field of GARMENT_FIELDS) {
          if (original.visual[field] === undefined) delete original.item[field];
          else original.item[field] = clone(original.visual[field]);
        }
      }
    }
    if (entry.kind === 'npc') window.NpcWardrobe?.clearDevClothingVisual?.(entry.entity.rec?.id);
    if (entry.kind === 'creature' && entry.entity.genotype?.base) {
      if (saved.coat === undefined) delete entry.entity.genotype.base.color;
      else entry.entity.genotype.base.color = saved.coat;
    }
    for (const axis of ['x', 'y', 'z']) {
      entry.root.scale[axis] = saved.scale[axis];
      if (entry.kind === 'creature') {
        const key = 'visualScale' + axis.toUpperCase();
        if (saved.visual[axis] === undefined) delete entry.entity[key];
        else entry.entity[key] = saved.visual[axis];
      }
    }
    restoreMaterials(entry);
    settings.delete(entry.entity);
    initial.delete(entry.entity);
    await refresh(entry);
    status = entry.label + ': original values restored.';
    return { ok: true };
  }
  function render() {
    const nearby = candidates();
    if (!nearby.some(entry => entry.id === selectedId)) selectedId = nearby[0]?.id || 'player';
    const entry = nearby.find(item => item.id === selectedId);
    if (!entry) return { note: 'Waiting for the player avatar.' };
    const state = settings.get(entry.entity);
    const actions = [
      { id: 'select', label: 'Nearby entity', group: 'Target', value: selectedId,
        options: nearby.map(item => ({ value: item.id,
          label: item.label + ' · ' + item.kind + (item.kind === 'player' ? '' : ' · ' + item.distance.toFixed(1) + ' tiles') })) },
      { id: 'refresh', label: 'Refresh selected visuals', group: 'Target' },
      { id: 'rescan', label: 'Rescan entities', group: 'Target' },
    ];
    if (entry.kind === 'player' || entry.kind === 'npc') {
      const wornKeys = authoredTintKeys(entry); // Worn garments supply their own authoritative tint and pattern controls below.
      for (const [slot, color] of colorSlots(entry).filter(([key]) => !wornKeys.has(key))) {
        if (colorOf(color)) actions.push({
          id: 'color:' + slot, label: slot + ' color', group: 'Portrait colors',
          input: { type: 'color' }, value: colorOf(color) });
        else for (const [component, label, min, max, step] of [
          ['h', 'Hue', -360, 360, 5], ['s', 'Saturation', -1, 2, .05], ['v', 'Brightness', -1, 2, .05],
        ]) actions.push({ id: 'hsv:' + slot + ':' + component,
          label: slot + ' ' + label, group: 'Portrait colors',
          input: { min, max, step }, value: Number(color[component]) || 0 });
      }
    }
    actions.push(...garmentActions(entry)); // Directly editable per-article dye, weaving pattern, and trim values.
    if (entry.kind === 'creature' && colorOf(entry.entity.genotype?.base?.color)) actions.push({
      id: 'coat', label: 'Genetic base coat', group: 'Coat', input: { type: 'color' },
      value: colorOf(entry.entity.genotype.base.color) });
    for (const [axis, label] of [['x', 'Width'], ['y', 'Height'], ['z', 'Depth']]) actions.push({
      id: 'scale:' + axis, label: label + ' %', group: 'Scale', input: { min: 25, max: 300, step: 5 },
      value: state?.scale[axis] || 100 });
    actions.push({ id: 'tint', label: 'Whole-entity tint', group: 'Materials',
      input: { type: 'color' }, value: state?.tint || '#ffffff' });
    actions.push({ id: 'opacity', label: 'Opacity %', group: 'Materials',
      input: { min: 10, max: 100, step: 5 }, value: state?.opacity || 100 });
    actions.push({ id: 'reset', label: 'Reset selected appearance', group: 'Target',
      confirm: 'Restore this entity’s original live appearance values?' });
    return { summary: nearby.length + ' nearby · ' + entry.kind,
      rows: [['Entity', entry.label], ['Distance', entry.distance.toFixed(2) + ' tiles'],
        ['Area', String(area() || '?')], ['Last action', status]],
      note: 'Live session edits, no restart. Turn on Autosave paused in the header before experimenting; regular saves can persist player/NPC/genotype changes. Reset selected restores live originals.',
      actions };
  }
  async function onAction(action, args = {}) {
    try {
      if (action === 'select') {
        if (!candidates().some(entry => entry.id === args.value)) return { ok: false, error: 'Target has moved out of range.' };
        selectedId = args.value;
        return { ok: true };
      }
      if (action === 'rescan') return { ok: true, count: candidates().length };
      const entry = target();
      if (!entry) return { ok: false, error: 'Target despawned or left the current area.' };
      if (action === 'refresh') { await refresh(entry); status = entry.label + ': scene visual refreshed in place.'; return { ok: true }; }
      if (action === 'reset') return await reset(entry);
      if (action.startsWith('cloth-')) return await changeGarment(entry, action, args.value);
      return await change(entry, action, args.value);
    } catch (error) { status = 'Error: ' + String(error?.message || error); return { ok: false, error: status }; }
  }
  bridge.registerCheatPanel({ id: 'appearance-nearby', title: 'Nearby appearance inspector',
    order: 4, render, onAction });
  window.DevCompanionAppearance = Object.freeze({
    scan: () => candidates().map(({ id, kind, label, distance }) => ({ id, kind, label, distance })),
    get selection() { return selectedId; },
    get status() { return status; },
  }); // Optional mobile-safe diagnostic entry point.
})();