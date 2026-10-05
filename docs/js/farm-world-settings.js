(() => {
  'use strict';
  const config = window.FARM_SPECIALIZATIONS_CONFIG; // Shared creation/runtime configuration.
  let deps = null; // Runtime world/ownership seam; onboarding can use the pure helpers before init.
  function randomName(random = Math.random) {
    const pick = words => words[Math.min(words.length - 1, Math.max(0, Math.floor(random() * words.length)))]; // Selects only authored lore-safe words.
    return pick(config.nameWords.first) + ' ' + pick(config.nameWords.last);
  }
  function normalize(settings = {}) {
    const valid = (role, value) => config.palettes[role].some(entry => entry[1] === value) ? value : config.palettes[role][0][1]; // Rejects painted/arbitrary colors.
    return { stone: valid('stone', settings.stone), wood: valid('wood', settings.wood),
      specialization: Object.hasOwn(config.specializations, settings.specialization) ? settings.specialization : 'grower' };
  }
  function initializeWorld(world, settings) {
    world.farmSettings = normalize(settings);
    world.label = String(world.label || randomName()).trim().slice(0, 40) || randomName();
    const specialization = config.specializations[world.farmSettings.specialization]; // Supplies are added only while constructing a fresh world.
    world.storage = { ...world.storage };
    for (const [key, count] of Object.entries(specialization.storage)) world.storage[key] = (Number(world.storage[key]) || 0) + count;
    world.farmStarterBuildings = [...specialization.buildings];
    return world;
  }
  function read() {
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null'); // Current record is always re-read before an owner mutation.
      const world = meta?.worlds?.find(entry => entry.id === deps?.getPlayerData()?.worldId); // Current world only.
      return { meta, world };
    } catch { return { meta: null, world: null }; }
  }
  function current() { return normalize(read().world?.farmSettings); }
  function init(injectedDeps) { deps = injectedDeps; }
  function saveColors(settings) {
    if (!deps?.isFarmOwner()) return { ok: false, message: 'Only the world owner can change building colors.' };
    const { meta, world } = read(); // Fresh authoritative world; never writes an onboarding snapshot.
    if (!world) return { ok: false, message: 'No world selected.' };
    const colors = normalize(settings); // Preserve specialization when editing free cosmetic settings.
    world.farmSettings = { ...current(), stone: colors.stone, wood: colors.wood };
    try { localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta)); }
    catch { return { ok: false, message: 'Could not save building colors.' }; }
    window.FarmBuildings?.refreshColors?.();
    window.HousePieces?.rebuildStructureMeshes?.();
    window.FarmProduction?.refreshColors?.();
    window.BarnIncubator?.rebuildExteriorAll?.();
    deps.debugLog?.('Farm building colors updated for free.');
    return { ok: true, message: 'Farm building colors updated.' };
  }
  function tintStructure(group, colors = current()) {
    if (!group) return;
    group.traverse(mesh => {
      if (!mesh.isMesh || !mesh.material) return;
      let role = mesh.userData.farmMaterialRole; // Semantic roles are assigned by the shared structure builder.
      for (let parent = mesh.parent; parent && parent !== group; parent = parent.parent) if (parent.userData.isWallBricks) role = 'stone';
      if (!colors[role]) return;
      const tint = material => { const result = material.clone(); window.SurfaceTint?.applyGrassLuminance?.(result, colors[role]); if (!window.SurfaceTint) result.color?.set(colors[role]); return result; }; // Clone per farm structure; town/global source materials remain untouched.
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
    });
  }
  function colorSelect(role, selected, id) {
    return `<label>${role === 'stone' ? 'Natural stone' : 'Natural wood'} <select id="${id}">${config.palettes[role].map(([label, color]) => `<option value="${color}"${color === selected ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
  }
  function renderOwnerControls(container) {
    if (!container || !deps) return;
    const settings = current(); // Owner panel uses exactly the creation palettes.
    const section = document.createElement('div'); // Recreated only when the existing Farm menu renders.
    section.className = 'farm-row'; section.style.flexWrap = 'wrap';
    section.innerHTML = colorSelect('stone', settings.stone, 'farmStoneColor') + colorSelect('wood', settings.wood, 'farmWoodColor');
    section.querySelectorAll('select').forEach(select => { select.disabled = !deps.isFarmOwner(); });
    if (deps.isFarmOwner()) {
      const button = document.createElement('button'); // Free owner action, with authorization checked again by saveColors.
      button.className = 'settings-small-btn'; button.textContent = 'Apply colors · Free';
      button.onclick = () => { const result = saveColors({ stone: section.querySelector('#farmStoneColor').value, wood: section.querySelector('#farmWoodColor').value }); deps.showToast(result.message, result.ok); };
      section.append(button);
    }
    container.append(section);
  }
  window.FarmWorldSettings = { init, randomName, normalize, initializeWorld, current, read, saveColors, colorSelect, renderOwnerControls, tintStructure };
})();
