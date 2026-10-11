// Furniture-author itemPlacements become ordinary collectible inventory objects.
(() => {
  'use strict';

  const SCRAPS_PER_MATERIAL = 5; // Shared by Pack actions and Crafting recipes.
  const METAL_GROUPS = Object.freeze({
    cheapMetalScraps: ['nativeCopper', 'lowTinBronze', 'tinBronze', 'tin', 'lead', 'pewter'],
    strongMetalScraps: ['highTinBronze', 'arsenicalBronze', 'leadedBronze'],
    rareMetalScraps: ['silver', 'gold', 'electrumGold', 'electrumSilver'],
  }); // Combining rolls within these groups regardless of current Town Value.
  const SCRAP_DEFS = Object.freeze({
    clothScraps: { icon: '🧵', label: 'Cloth Scraps', outputs: ['lightWool', 'puktukWool'] },
    cheapMetalScraps: { icon: '🔩', label: 'Cheap Metal Scraps' },
    strongMetalScraps: { icon: '⚙️', label: 'Strong Metal Scraps' },
    rareMetalScraps: { icon: '✨', label: 'Rare Metal Scraps' },
  }); // Stable inventory keys keep fragments generic until the combine action.
  const LOOT_ITEMS = Object.freeze({
    lootCopperRing: { icon: '💍', label: 'Copper Ring', sellPrice: 12, minTownValue: 0 },
    lootSilverPendant: { icon: '📿', label: 'Silver Pendant', sellPrice: 38, minTownValue: 3 },
    lootGoldBrooch: { icon: '💎', label: 'Gold Brooch', sellPrice: 85, minTownValue: 6 },
    junkBentCup: { icon: '🥣', label: 'Bent Metal Cup', sellPrice: 1, minTownValue: 0, scrapYield: { cheapMetalScraps: 2 } },
    junkBrokenBuckle: { icon: '🔗', label: 'Broken Buckle', sellPrice: 1, minTownValue: 0, scrapYield: { cheapMetalScraps: 1 } },
    junkTornBlanket: { icon: '🧣', label: 'Torn Blanket', sellPrice: 1, minTownValue: 0, scrapYield: { clothScraps: 3 } },
    junkFrayedRope: { icon: '🪢', label: 'Frayed Rope', sellPrice: 1, minTownValue: 0, scrapYield: { clothScraps: 2 } },
    junkBrokenBronzeFitting: { icon: '⚙️', label: 'Broken Heavy Bronze Fitting', sellPrice: 3, minTownValue: 3, scrapYield: { strongMetalScraps: 2 } },
    junkGildedFitting: { icon: '🏅', label: 'Damaged Precious-Metal Fitting', sellPrice: 5, minTownValue: 6, scrapYield: { rareMetalScraps: 2 } },
  }); // Starter valuables and mundane salvage; icons are placeholders until art is authored.
  const entries = new Set(); // Live placement records; removed furniture releases these via disposeGroup().
  const meshEntries = new WeakMap(); // Keeps per-instance state out of JSON-serialized Object3D.userData.
  const iconSources = new Map(); // Reuses placeholder PNGs instead of rasterizing once per furniture instance.
  const textures = new Map(); // Shared immutable sprite textures; individual planes own their material/geometry.
  let deps = null; // Game services are injected once, following the other inventory modules.
  let collected = new Set(); // Saved per world member, alongside the non-gear inventory.
  let claimedTarget = null; // Avoid re-advertising identical world input claims on every UI refresh.
  let target = null; // The currently advertised world interaction, revalidated at pickup time.
  let scratch = null; // Allocated once when THREE is available, never during a frame callback.
  let lastChange = 'Surface item loot, jewelry, junk scrapping, and five-to-one generic scrap combining.'; // Copyable mobile diagnostic.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const amount = value => Math.max(0, Math.floor(finite(value)));

  function init(services) {
    deps = services;
    for (const [key, definition] of Object.entries(SCRAP_DEFS)) {
      deps.ITEM_DEFS[key] = { ...definition, cat: 'material', sellPrice: 0, tags: ['Material', 'Scraps'],
        desc: `Combine ${SCRAPS_PER_MATERIAL} to recover one randomly selected ${key === 'clothScraps' ? 'light or heavy wool' : 'metal bar from this scrap group'}.` };
    }
    for (const [key, definition] of Object.entries(LOOT_ITEMS)) {
      deps.ITEM_DEFS[key] = { ...definition, cat: 'material', tags: definition.scrapYield ? ['Junk', 'Salvage'] : ['Jewelry', 'Valuable'],
        desc: definition.scrapYield ? `Sell it or scrap it into ${yieldLabel(definition.scrapYield)}.` : 'Found jewelry. Sell it for gold.' };
    }
    for (const key of [...Object.keys(SCRAP_DEFS), ...Object.keys(LOOT_ITEMS)]) {
      if (!deps.inventoryItems.some(item => item.key === key)) deps.inventoryItems.push({ key, icon: deps.ITEM_DEFS[key].icon, label: deps.ITEM_DEFS[key].label, max: 99 });
    }
  }

  function yieldLabel(yields) {
    return Object.entries(yields).map(([key, qty]) => `${qty} ${SCRAP_DEFS[key]?.label || key}`).join(' + ');
  }

  function outputKeys(key) {
    const keys = METAL_GROUPS[key]?.map(metal => `bar_${metal}`) || SCRAP_DEFS[key]?.outputs || []; // Uses existing bars/wool rather than introducing duplicate full materials.
    return keys.filter(itemKey => !!deps?.ITEM_DEFS[itemKey]);
  }

  function count(key) { return amount(deps?.inventory[key]); }
  function capacity(key) { return Math.max(0, (window.InventoryStacks?.MAX_TOTAL || 9999) - count(key)); }

  function finish(message) {
    lastChange = message;
    deps?.showToast?.(message, true);
    deps?.buildInventoryGrid?.();
    deps?.refreshItemScroll?.();
    deps?.refreshActionBar?.();
    deps?.saveMemberWorldData?.();
    return { ok: true, message };
  }

  function scrapItem(key) {
    const definition = deps?.ITEM_DEFS[key]; // The authored item owns its salvage yield.
    const yields = definition?.scrapYield;
    if (!yields || count(key) < 1) return { ok: false, message: 'No junk to scrap.' };
    if (!Object.keys(yields).length || Object.entries(yields).some(([output, qty]) => !SCRAP_DEFS[output] || amount(qty) !== qty || qty < 1 || capacity(output) < qty)) {
      return { ok: false, message: 'Not enough room for the recovered scraps.' };
    }
    deps.inventory[key] = count(key) - 1;
    for (const [output, qty] of Object.entries(yields)) deps.inventory[output] = count(output) + qty;
    deps.clampInventoryStack?.(key);
    return finish(`Scrapped ${definition.label}: ${yieldLabel(yields)}.`);
  }

  function combineScraps(key) {
    const outputs = outputKeys(key); // Town Value deliberately does not filter these outputs.
    if (!SCRAP_DEFS[key] || count(key) < SCRAPS_PER_MATERIAL || !outputs.length) return { ok: false, message: 'Five scraps are required.' };
    // Never reroll around a full stack: that would let inventory capacity select the random material.
    if (outputs.some(output => capacity(output) < 1)) return { ok: false, message: 'Make room for every possible material before combining.' };
    const roll = Math.max(0, Math.min(.999999999, finite(deps.random ? deps.random() : Math.random()))); // One roll at the moment the five scraps are consumed.
    const output = outputs[Math.floor(roll * outputs.length)]; // Uniform choice within the selected group.
    deps.inventory[key] = count(key) - SCRAPS_PER_MATERIAL;
    deps.inventory[output] = count(output) + 1;
    deps.clampInventoryStack?.(key);
    return finish(`Combined 5 ${SCRAP_DEFS[key].label}: 1 ${deps.ITEM_DEFS[output].label}.`);
  }

  function availableRecipes() {
    return Object.keys(SCRAP_DEFS).filter(key => count(key) > 0).map(key => ({ key, label: SCRAP_DEFS[key].label, icon: SCRAP_DEFS[key].icon,
      count: count(key), outputs: outputKeys(key).map(output => deps.ITEM_DEFS[output].label), canCraft: count(key) >= 5 && outputKeys(key).length > 0 && outputKeys(key).every(output => capacity(output) > 0) }));
  }

  function ensureScratch() {
    if (!scratch && window.THREE) scratch = { position: new THREE.Vector3(), camera: new THREE.Vector3(), normal: new THREE.Vector3(), base: new THREE.Vector3(), raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(), pose: new THREE.Matrix4(), rotation: new THREE.Quaternion(), euler: new THREE.Euler(), scale: new THREE.Vector3(), hits: [], candidates: [] }; // Shared aim/render scratch storage.
    return scratch;
  }

  function resolveItemKey(record) {
    const raw = String(record?.lootItemKey || record?.itemKey || ''); // Editor asset names remain independent from their gameplay item identity.
    const potion = window.AlchemySystem?.parseBrewedItemKey?.(raw);
    if (potion) window.AlchemySystem.ensureRecipeItemDef(potion.recipeId, potion.potencyTier);
    return deps?.ITEM_DEFS[raw] ? raw : null;
  }

  function imageSource(record) {
    const raw = String(record.imageUrl || '').trim(); // Existing author exports can contain repository-relative or GitHub image URLs.
    if (!raw) return null;
    if (/^(data|blob):/i.test(raw)) return raw;
    const asset = raw.lastIndexOf('docs/assets/'); // Prefer this pinned game's own assets over an editor's moving main-branch URL.
    if (asset >= 0) return raw.slice(asset + 5);
    return raw.replace(/^(\.\.\/)+/, '').replace(/^docs\//, '');
  }

  function iconSource(key) {
    if (iconSources.has(key)) return iconSources.get(key);
    const canvas = document.createElement('canvas'); // Transparent starter icon image, shared by editor and runtime.
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'); // Used only during one-time placeholder rasterization.
    ctx.font = '88px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(LOOT_ITEMS[key]?.icon || SCRAP_DEFS[key]?.icon || '📦', 64, 64);
    const source = canvas.toDataURL('image/png'); // Authored placements can replace this with an actual repository PNG.
    iconSources.set(key, source);
    return source;
  }

  function textureFor(source, onLoad) {
    if (textures.has(source)) { const cached = textures.get(source); cached.then(onLoad).catch(error => { lastChange = error.message; }); return; }
    const promise = new Promise((resolve, reject) => { // Cache the image and canonical sprite texture together, including in-flight loads.
      const image = new Image(); // CORS must precede src because the image enters WebGL through a canvas.
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas'); // Canonical PNG-plane composition input.
          canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height;
          canvas.getContext('2d').drawImage(image, 0, 0);
          const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(THREE, canvas, 'surface-loot'); // Same rendering path as held items and avatars.
          resolve({ texture, aspect: canvas.width / canvas.height });
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error(`Could not load loot image ${source.slice(0, 100)}`));
      image.src = source;
    });
    textures.set(source, promise);
    promise.then(onLoad).catch(error => { textures.delete(source); lastChange = error.message; console.warn('[surface-loot]', error); });
  }

  function buildPlacements(group, data) {
    if (!window.THREE || !window.HobunjiSpritePngSurface?.makeMaterial) return group;
    ensureScratch();
    const records = Array.isArray(data.itemPlacements) ? data.itemPlacements : []; // Malformed imports never become an iterable crash.
    for (const [index, record] of records.entries()) {
      if (!record || record.visible === false) continue;
      const surface = data.recognizedSurfaces?.find(item => item.id === record.surfaceId); // The exact recognized surface from the authoring export.
      const part = group.userData.meshById?.get(surface?.partId); // Placement follows the same animated part as the selected surface.
      if (!surface || !part) continue;
      part.updateMatrix();
      const holder = new THREE.Group(); // Position/orientation lives independently of the image aspect ratio.
      const center = new THREE.Vector3().fromArray(surface.localCentroid || [0, 0, 0]); // Same surface origin used by getSurfaceWorldFrame() in the editor.
      const u = new THREE.Vector3().fromArray(surface.basisU || [1, 0, 0]).normalize(); // Surface-local authored offsets in world-size units.
      const v = new THREE.Vector3().fromArray(surface.basisV || [0, 0, 1]).normalize(); // Surface-local second axis.
      const normal = new THREE.Vector3().fromArray(surface.localNormal || [0, 1, 0]).normalize(); // Used by Tall grounding and placement clearance.
      // Editor offsets are measured after normalizing the transformed basis: compensate for part scale.
      const matrix = part.matrix; // Static part transform at build time; parenting still follows later part motion.
      const worldCenter = center.clone().applyMatrix4(matrix); // Furniture-local mirror of the editor's surface world frame.
      const worldNormal = normal.clone().transformDirection(matrix); // Grounding normal in the furniture frame.
      const point = worldCenter.clone().addScaledVector(u.clone().transformDirection(matrix), finite(record.position?.u))
        .addScaledVector(v.clone().transformDirection(matrix), finite(record.position?.v)).addScaledVector(worldNormal, finite(record.position?.normal, .015)); // Final furniture-local authored position.
      const inverse = matrix.clone().invert(); // Converts the editor's global placement pose to the owning part's local frame.
      const pose = new THREE.Matrix4().compose(point, new THREE.Quaternion().setFromEuler(new THREE.Euler(finite(record.rotation?.x) * Math.PI / 180, finite(record.rotation?.y) * Math.PI / 180, finite(record.rotation?.z) * Math.PI / 180)), new THREE.Vector3().setScalar(Math.max(.001, finite(record.scale, .25)))); // Convert the complete editor pose once, including inverse part scale.
      holder.matrixAutoUpdate = false; // Preserve the exact inverse-part matrix; decomposing a rotated nonuniform scale loses shear.
      holder.matrix.copy(pose.premultiply(inverse));
      holder.matrix.decompose(holder.position, holder.quaternion, holder.scale);
      holder.name = `surface_item_${record.id || index}`;
      holder.userData.surfaceLoot = true;
      part.add(holder);
      const material = window.HobunjiSpritePngSurface.makeMaterial(THREE, null, 'surface-loot', { side: THREE.DoubleSide }); // Canonical unlit cutout, never a hand-rolled sprite material.
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material); // Image aspect is applied once loading finishes.
      mesh.userData.surfaceLoot = true; mesh.userData.devRuinFootprintIgnore = true;
      mesh.visible = false; // Show and allow pickup only after a valid sprite texture is ready.
      holder.add(mesh);
      const entry = { group, holder, mesh, record, placementId: String(record.id || `placement_${index}`), normal: worldNormal, deadzone: finite(data.globalCharacterDeadzoneDeg, 40), part, basePosition: point, surfaceOrigin: point.clone().addScaledVector(worldNormal, -finite(record.position?.normal, .015)), inverse, aspect: 1, id: null, disposed: false, area: null }; // Per-instance state never mutates the shared authored JSON.
      entries.add(entry);
      meshEntries.set(mesh, entry);
      mesh.onBeforeRender = () => updateEntry(entry); // Rendering owns billboard work; no new RAF loop or scheduler callback.
      const source = imageSource(record) || iconSource(record.lootItemKey || record.itemKey); // Authored PNG or visibly identifiable placeholder.
      textureFor(source, loaded => {
        if (entry.disposed) return;
        mesh.geometry.dispose(); mesh.geometry = new THREE.PlaneGeometry(loaded.aspect, 1);
        material.map = loaded.texture; material.needsUpdate = true; entry.aspect = loaded.aspect; mesh.visible = true;
        updateEntry(entry, true);
      });
    }
    return group;
  }

  function sceneOf(object) {
    for (let node = object; node; node = node.parent) if (node.isScene) return node;
    return null;
  }

  function entryId(entry) {
    if (entry.id) return entry.id;
    let owner = entry.group; // Prefer explicit instance IDs so moving a furniture item cannot regenerate its loot.
    for (let node = owner; node && !node.isScene; node = node.parent) if (node.userData?.surfaceLootInstanceId) { owner = node; break; }
    owner.getWorldPosition(scratch.position);
    const position = [scratch.position.x, scratch.position.y, scratch.position.z].map(value => value.toFixed(4)).join(','); // Stable fallback for authored props without an instance ID.
    const ruinSeed = entry.area === 'map_i_dev_random_ruin' ? window.DevRandomRuin?.getRuntimeContext?.()?.seed : ''; // Separate persistent ruin sites sharing the same interior map ID.
    entry.id = JSON.stringify([entry.area, ruinSeed || '', owner.userData.surfaceLootInstanceId || `${entry.group.userData.authoredFurnitureKey || entry.group.name}:${position}`, entry.placementId]);
    return entry.id;
  }

  function updateEntry(entry, force = false) {
    if (!deps || entry.disposed) return;
    const activeScene = deps.getScene?.(); // Offscreen scene instances never bind to the wrong area.
    if (sceneOf(entry.holder) !== activeScene) return;
    entry.area ||= deps.getCurrentArea();
    if (collected.has(entryId(entry))) { entry.holder.visible = false; return; }
    if (entry.record.cameraRelativeDeadzone && entry.record.placementPreset === 'tall') {
      deps.getCamera()?.getWorldPosition(scratch.camera);
      entry.group.worldToLocal(scratch.camera);
      const yaw = Math.atan2(scratch.camera.x - entry.basePosition.x, scratch.camera.z - entry.basePosition.z); // Tall planes face the camera in furniture-local space.
      const desired = yaw + finite(entry.record.rotation?.y) * Math.PI / 180; // Authored Y remains a camera-relative offset.
      const prior = entry.holder.userData.runtimeYaw; // Hysteresis uses the global character deadzone exported by the editor.
      const delta = prior == null ? Infinity : Math.atan2(Math.sin(desired - prior), Math.cos(desired - prior)); // Wrap safely around ±π.
      if (force || Math.abs(delta) > finite(deps.getDeadzone?.(), entry.deadzone) * Math.PI / 180) {
        entry.holder.userData.runtimeYaw = desired;
        scratch.euler.set(finite(entry.record.rotation?.x) * Math.PI / 180, desired, finite(entry.record.rotation?.z) * Math.PI / 180);
        scratch.rotation.setFromEuler(scratch.euler);
        scratch.scale.setScalar(Math.max(.001, finite(entry.record.scale, .25)));
        scratch.base.set(finite(entry.record.opaqueBottomLocalX) * entry.aspect, finite(entry.record.opaqueBottomLocalY, -.5), 0).multiplyScalar(scratch.scale.x).applyQuaternion(scratch.rotation);
        scratch.position.copy(entry.surfaceOrigin).addScaledVector(entry.normal, finite(entry.record.tallClearance, .1) - scratch.base.dot(entry.normal));
        entry.holder.matrix.copy(scratch.pose.compose(scratch.position, scratch.rotation, scratch.scale).premultiply(entry.inverse));
        entry.holder.matrix.decompose(entry.holder.position, entry.holder.quaternion, entry.holder.scale);
        entry.holder.updateWorldMatrix(true, true);
      }
    }
  }

  function getActionButtons() {
    target = null;
    if (!deps || deps.canInteract?.() === false || !ensureScratch()) return [];
    const activeScene = deps.getScene?.(); // Match the game scene before considering a loot plane.
    const camera = deps.getCamera?.(); // Uses the same screen-center aim as the game reticle.
    const player = deps.getPlayer?.(); // Player uses pixel-space horizontal coordinates.
    if (!activeScene || !camera || !player) return [];
    scratch.candidates.length = 0;
    for (const entry of entries) {
      const entryScene = sceneOf(entry.holder); // Detached, previously live furniture must release its retained placement state.
      if (!entryScene && entry.area) { disposeEntry(entry); continue; }
      if (entry.disposed || entry.record.lootable === false || entryScene !== activeScene) continue;
      let visible = true; // Hidden ancestors exclude props removed by puzzles or scene changes.
      for (let node = entry.holder; node; node = node.parent) if (!node.visible) { visible = false; break; }
      if (!visible || !entry.mesh.visible) continue;
      entry.area ||= deps.getCurrentArea();
      if (collected.has(entryId(entry))) { entry.holder.visible = false; continue; }
      entry.itemKey ||= resolveItemKey(entry.record); // Resolve authored inventory/potion metadata once after game services exist.
      if (!entry.itemKey) continue;
      entry.holder.getWorldPosition(scratch.position);
      const playerY = finite(deps.getPlayerMesh?.()?.position?.y); // Reject loot on another floor even when it shares the horizontal tile.
      if (Math.hypot(scratch.position.x - player.x / deps.TILE, scratch.position.z - player.y / deps.TILE, scratch.position.y - (playerY + .5)) > 1.75) continue;
      scratch.candidates.push(entry.mesh);
    }
    scratch.raycaster.setFromCamera(scratch.pointer.set(0, 0), camera);
    scratch.hits.length = 0;
    scratch.raycaster.intersectObjects(scratch.candidates, false, scratch.hits);
    if (!scratch.hits.length) return [];
    const hit = scratch.hits[0]; // Exact plane selection lets several items share one tabletop/tile.
    target = meshEntries.get(hit.object) || null;
    if (!target) return [];
    const key = target.itemKey || resolveItemKey(target.record); // Potion definitions are restored through the canonical alchemy API.
    return [{ icon: deps.ITEM_DEFS[key].icon, label: `Take ${deps.ITEM_DEFS[key].label}${amount(target.record.quantity) > 1 ? ` ×${amount(target.record.quantity)}` : ''}`, action: 'surface_loot_take', inputAction: 'action1', style: 'primary', allowed: true, worldInteraction: true, promptRoot: target.holder }];
  }

  function syncClaims(buttons) {
    const advertised = buttons?.find(button => button.action === 'surface_loot_take'); // Only claim input if this system actually owns the visible prompt.
    const next = advertised ? target : null; // Only a different physical target or owner needs a new claim snapshot.
    if (claimedTarget === next) return;
    claimedTarget = next;
    window.WorldActionInputClaims?.setClaims('surface-loot', advertised ? [{ actionId: 'action1', label: advertised.label, priority: 30, onPress: pickupTarget }] : []);
  }

  function pickupTarget() {
    const previous = target; // Revalidation prevents a stale arch prompt collecting an offscreen/distant item.
    getActionButtons();
    if (!previous || previous !== target) return false;
    const entry = target; // Target remains stable throughout this synchronous transaction.
    const key = resolveItemKey(entry.record); // Reject unregistered asset keys rather than granting unusable inventory stacks.
    const qty = Math.max(1, amount(entry.record.quantity)); // Default stack size is one physical object.
    const id = entryId(entry); // Same ID used by save restore and render visibility.
    if (!key || collected.has(id)) return false;
    // Validate obstruction at interaction time; avoid raycasting every scene mesh on each UI refresh.
    const distance = scratch.hits[0]?.distance || Infinity; // Camera ray distance to the aimed sprite.
    const blockers = scratch.raycaster.intersectObjects(deps.getScene().children, true); // Existing world geometry is the occlusion authority.
    const blocked = blockers.some(hit => {
      if (hit.distance >= distance - .025 || hit.object.userData?.surfaceLoot || hit.object.material?.visible === false || hit.object.userData?.devRuinFootprintIgnore) return false;
      for (let node = hit.object; node; node = node.parent) if (!node.visible || node === deps.getPlayerMesh?.()) return false;
      return true;
    }); // A supporting surface behind the plane does not block it.
    if (blocked) { deps.showToast?.('That item is behind a surface.', false); return false; }
    if (capacity(key) < qty) { deps.showToast?.('Not enough inventory space.', false); return false; }
    deps.inventory[key] = count(key) + qty;
    collected.add(id); entry.holder.visible = false;
    finish(`Picked up ${qty} ${deps.ITEM_DEFS[key].label}.`);
    return true;
  }

  function serialize() { return [...collected]; }
  function restore(saved) {
    collected = new Set(Array.isArray(saved) ? saved.filter(value => typeof value === 'string') : []);
    target = null;
    for (const entry of entries) if (!entry.disposed) entry.holder.visible = entry.record.visible !== false && !(entry.id && collected.has(entry.id));
    claimedTarget = null;
    window.WorldActionInputClaims?.clearClaims('surface-loot');
  }

  function disposeEntry(entry) {
    entry.disposed = true;
    entry.mesh.geometry.dispose(); entry.mesh.material.dispose(); entries.delete(entry);
  }

  function disposeGroup(group) {
    for (const entry of entries) {
      let contained = false; // Dispose only placements beneath the removed furniture/camp.
      for (let node = entry.holder; node; node = node.parent) if (node === group) { contained = true; break; }
      if (!contained) continue;
      disposeEntry(entry);
    }
  }

  function eligibleLootKeys(townValue) {
    return Object.keys(LOOT_ITEMS).filter(key => LOOT_ITEMS[key].minTownValue <= Math.max(0, amount(townValue)));
  }

  function scatter(parent, options = {}) {
    if (!parent || !window.THREE || !deps) return null;
    const value = Math.max(0, amount(window.TownMine?.getTownValue?.())); // Town Value gates encountered loot items, never the combine outputs.
    const rng = window.WildernessMapGenerator?.makeRng?.(String(options.id)) || deps.random || Math.random; // Stable camp/chest identity determines its physical loot.
    const eligible = eligibleLootKeys(value); // Higher-value jewelry and salvage enter the encounter pool as the town grows.
    const jewelry = eligible.filter(key => !LOOT_ITEMS[key].scrapYield); // One valuable plus practical supplies and junk.
    const junk = eligible.filter(key => LOOT_ITEMS[key].scrapYield);
    const pick = list => list[Math.min(list.length - 1, Math.floor(rng() * list.length))]; // Small seeded catalog choice.
    const keys = [pick(jewelry), 'alchemy_healingPotion_p0', 'alchemy_venomFlask_p0', pick(junk), pick(junk)]; // Real alchemy keys retain ordinary drinking/throwing behavior.
    const host = new THREE.Group(); // Invisible placement surface does not add a collision volume or furniture item.
    host.name = `loose_loot_${options.id}`;
    host.userData.surfaceLootInstanceId = String(options.id);
    host.userData.authoredFurnitureKey = 'looseLoot';
    host.position.set(finite(options.x), finite(options.y, .02), finite(options.z));
    const part = new THREE.Group(); // Uses the same recognized-surface schema and renderer as editor-authored furniture.
    host.add(part); host.userData.meshById = new Map([['loot_surface', part]]);
    parent.add(host);
    const data = { recognizedSurfaces: [{ id: 'loot_top', partId: 'loot_surface', localCentroid: [0, 0, 0], localNormal: [0, 1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1] }],
      itemPlacements: keys.map((key, index) => ({ id: `loot_${index}`, lootItemKey: key, itemKey: key, surfaceId: 'loot_top', quantity: 1,
        position: { u: (index % 3 - 1) * .26, v: Math.floor(index / 3) * .30 - .15, normal: .015 }, scale: .21, rotation: { x: -90, y: rng() * 360, z: 0 }, placementPreset: 'flat',
        imageUrl: key.startsWith('alchemy_') ? 'assets/objectsprites/bottle_potion.png' : iconSource(key), visible: true, lootable: true })) }; // Starter scatter leaves room between selectable silhouettes.
    host.userData.surfaceLootPlacements = data.itemPlacements; // Inspectable encounter content; no shared catalog mutations.
    buildPlacements(host, data);
    return host;
  }

  function diagnostics() {
    return { latestChange: lastChange, livePlacements: entries.size, collected: collected.size, target: target?.record.lootItemKey || target?.record.itemKey || null,
      scrapCounts: Object.fromEntries(Object.keys(SCRAP_DEFS).map(key => [key, count(key)])), metalGroups: METAL_GROUPS, townValue: window.TownMine?.getTownValue?.() || 0 };
  }

  window.SurfaceLootSystem = Object.freeze({ init, buildPlacements, getActionButtons, syncClaims, pickupTarget, scrapItem, combineScraps, availableRecipes, serialize, restore, disposeGroup, scatter, diagnostics, iconSource, imageSource, resolveItemKey, outputKeys, SCRAPS_PER_MATERIAL, SCRAP_DEFS, METAL_GROUPS, LOOT_ITEMS, eligibleLootKeys });
})();
