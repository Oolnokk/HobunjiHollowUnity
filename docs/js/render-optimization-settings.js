// Settings → "Render optimizations (perf testing)" (window.RenderOptimizationSettings).
//
// One menu toggle for every render optimisation and A/B switch the render
// modules expose from the console, so they can be compared on a device
// without typing anything: prop/tile batching, tree instancing, culls, the
// held-object x-ray replay savings, frame-scoped render hooks, and a few
// costly looks (faceted ore rocks, rain sheets, sky clouds). Each toggle
// calls its owner's own setter; nothing here changes how a switch behaves.
//
// Choices persist per device in localStorage (STORAGE_KEY, only values that
// differ from the default) and are re-applied when this module loads (after
// every owner: it is the last script of the 'render' classic group) and
// again on window 'load'. Owners that already persist their own choice
// (WildernessTreeInstancer, FacetedRocks) keep doing so instead.
// The NPC/actor culls stay in performance-debug.js's "Performance &
// diagnostics" box; outlines, painterly, resolution and the Cloud Forest
// radius/mist already have their own Settings rows.
(() => {
  'use strict';
  if (window.RenderOptimizationSettings) return;

  const STORAGE_KEY = 'hobunjiRenderOptimizations';
  const SECTION_ID = 'settingsSectionRenderOptimizations';
  const held = () => window.HeldObjectRenderOrder;
  let heldMemo = null, heldMemoAt = -Infinity;
  const heldSnap = () => { // One snapshot serves every held toggle read in the same refresh.
    const now = performance.now();
    if (!heldMemo || now - heldMemoAt > 100) { heldMemo = held()?.snapshot?.() || {}; heldMemoAt = now; }
    return heldMemo;
  };
  const hooks = () => window.RenderHooks;

  // Hide a named world group for the world render only (frame scope), as the
  // benchmark's mistOff/rainOff/cloudsOff windows do. The object is looked up
  // by name at most once a second per scene, not every frame.
  function drawHider(id, groupName) {
    let off = null, cache = { scene: null, object: null, at: -Infinity };
    const find = () => {
      const scene = window.GridTileAccessors?.getActiveScene?.();
      if (!scene) return null;
      const now = performance.now();
      let attached = false;
      for (let o = cache.object; o; o = o.parent) if (o === scene) { attached = true; break; }
      if (cache.scene !== scene || (!attached && now - cache.at >= 1000)) {
        cache = { scene, object: scene.getObjectByName?.(groupName) || null, at: now };
      }
      return cache.scene === scene ? cache.object : null;
    };
    return {
      read: () => !off,
      write(on) {
        if (on) { off?.(); off = null; return; }
        if (off || typeof hooks()?.register !== 'function') return;
        off = hooks().register({
          id: 'render-optimization-settings-' + id, owner: 'render-optimization-settings.js', order: 1, scope: 'frame',
          before: () => { const target = find(); const was = target?.visible; if (target) target.visible = false; return { target, was }; },
          after: (_ctx, state) => { if (state?.target) state.target.visible = state.was; },
        });
      },
    };
  }
  const rainHider = drawHider('rain', 'world_rain_planes');
  const cloudHider = drawHider('clouds', 'hobunji_cloud_domes');

  // group, id, name, desc, default (on = the shipped optimisation), available(), read(), write(on), ownsPersistence.
  const TOGGLES = [
    { group: 'Character rendering', id: 'frozenPortraits', name: 'Frozen NPC and animal portraits', on: true,
      desc: 'Use rigid portrait geometry for neutral, hunched and weapon-ready poses. Independent head motion uses the live rig.',
      available: () => !!window.PNGPlaneAvatar?.meshBudget?.frozenSnapshot,
      read: () => window.PNGPlaneAvatar.meshBudget.frozenSnapshot().enabled,
      write: on => window.PNGPlaneAvatar.meshBudget.setFrozenEnabled(on) },

    { group: 'Batching (fewer draw calls)', id: 'propBatches', name: 'Merge still wilderness props', on: true,
      desc: 'Tents, camp furniture, berry bushes, herbs, totems, nests and ore-rock stones that stand still are drawn as one merged mesh per 8×8 tiles.',
      available: () => typeof window.ZonePropRenderBatches?.setEnabled === 'function',
      read: () => window.ZonePropRenderBatches.snapshot?.().enabled, write: on => window.ZonePropRenderBatches.setEnabled(on) },
    { group: 'Batching (fewer draw calls)', id: 'denseWallBatches', name: 'Merge the Cloud Forest dense tree wall', on: true,
      desc: 'Shadewood wall chunks that are not fading are drawn as one instanced mesh per tree part instead of one per chunk.',
      available: () => typeof window.DenseForestWallBatches?.setEnabled === 'function',
      read: () => window.DenseForestWallBatches.snapshot?.().enabled, write: on => window.DenseForestWallBatches.setEnabled(on) },
    { group: 'Batching (fewer draw calls)', id: 'denseWallLod', name: 'Lighter far Cloud Forest wall trees', on: true,
      desc: 'Wall trees 12+ tiles from the camera draw their roots, branches and vines with fewer rings and sides (same shapes, trunks and leaves). Needs the dense wall merge above.',
      available: () => typeof window.DenseForestWallBatches?.setLodEnabled === 'function',
      read: () => window.DenseForestWallBatches.snapshot?.().lodEnabled, write: on => window.DenseForestWallBatches.setLodEnabled(on) },
    { group: 'Batching (fewer draw calls)', id: 'farmTileBatches', name: 'Merge farm ground tiles', on: true,
      desc: 'Farm ground tiles, town NPC farm plots and the wall/roof/porch faces of authored houses are drawn as merged 8×8 batches.',
      available: () => typeof window.FarmTileRenderBatches?.setEnabled === 'function',
      read: () => window.FarmTileRenderBatches.snapshot?.().enabled, write: on => window.FarmTileRenderBatches.setEnabled(on) },
    { group: 'Batching (fewer draw calls)', id: 'grassChunks', name: 'Chunk farm and town grass', on: true,
      desc: 'Grass billboards on the farm and in town are drawn as spatial chunks instead of one sprite group per tile.',
      available: () => typeof window.GrassBillboardRenderChunks?.setEnabled === 'function',
      read: () => window.GrassBillboardRenderChunks.enabled, write: on => window.GrassBillboardRenderChunks.setEnabled(on) },
    { group: 'Batching (fewer draw calls)', id: 'treeInstancing', name: 'Instance wilderness trees', on: false, ownsPersistence: true,
      desc: 'Procedural trees and bushes instanced within 8×8-tile cells so camera and X-ray culling can skip distant batches. Experimental; off by default until device testing confirms a gain.',
      available: () => typeof window.WildernessTreeInstancer?.setEnabled === 'function',
      read: () => window.WildernessTreeInstancer.enabled?.(), write: on => window.WildernessTreeInstancer.setEnabled(on, { persist: true }) },

    { group: 'Culling (skip what cannot be seen)', id: 'brickLod', name: 'Lighter far brick walls and paths', on: true,
      desc: 'Brick walls and path chunks whose nearest brick is 14+ tiles away draw each brick as a 12-triangle block of the same size instead of 70 triangles.',
      available: () => typeof window.InstancedBrickLod?.setEnabled === 'function',
      read: () => window.InstancedBrickLod.enabled(), write: on => window.InstancedBrickLod.setEnabled(on) },
    { group: 'Culling (skip what cannot be seen)', id: 'instancedViewCull', name: 'Cull off-camera instanced walls and grass', on: true,
      desc: 'Instanced walls, path bricks and grass outside the camera view are skipped.',
      available: () => typeof window.InstancedMeshViewCull?.setEnabled === 'function',
      read: () => window.InstancedMeshViewCull.enabled, write: on => window.InstancedMeshViewCull.setEnabled(on) },
    { group: 'Culling (skip what cannot be seen)', id: 'wildernessDistanceCull', name: 'Cull far wilderness geometry', on: true,
      desc: 'Static wilderness geometry beyond the draw distance is skipped.',
      available: () => typeof window.WildernessDistanceCull?.setEnabled === 'function',
      read: () => window.WildernessDistanceCull.snapshot?.().enabled, write: on => window.WildernessDistanceCull.setEnabled(on) },
    { group: 'Culling (skip what cannot be seen)', id: 'hideFadedTrees', name: 'Skip fully faded trees', on: true,
      desc: 'Trees the corridor-edge fade has taken to invisible are not drawn (they only drew depth ghosts).',
      available: () => typeof window.ZoneVegetationCull?.setHideFadedOut === 'function',
      read: () => window.ZoneVegetationCull.snapshot?.().hideFadedOut, write: on => window.ZoneVegetationCull.setHideFadedOut(on) },

    { group: 'Held items and x-ray replays', id: 'portraitWaterTint', name: 'Submerged portrait tint', on: true,
      desc: 'Off skips the separate water-color replay for submerged portraits; normal water and held-gear tint remain. Uses the existing X-ray hierarchy rule.', ownsPersistence: true,
      available: () => typeof window.XrayHierarchy?.set === 'function',
      read: () => window.XrayHierarchy.get('portrait.waterTint') !== 'off',
      write: on => window.XrayHierarchy.set('portrait.waterTint', on ? 'wet-tile' : 'off') },
    { group: 'Held items and x-ray replays', id: 'localReplayRing', name: 'X-ray only around the player', on: true,
      desc: 'Only actors on your tile or its eight neighbors receive selective X-ray and water tint replays. Off restores the old range.',
      available: () => typeof held()?.setLocalReplayRingEnabled === 'function',
      read: () => heldSnap().localReplayRingEnabled, write: on => held().setLocalReplayRingEnabled(on) },
    { group: 'Look (costly effects)', id: 'realTimeShadows', name: 'Real-time cast shadows', on: false,
      desc: 'Off skips all shadow-map rendering. Ordinary lighting and authored shadow art remain.',
      available: () => typeof window.ShadowMapRefreshThrottle?.setShadowRenderingEnabled === 'function',
      read: () => window.ShadowMapRefreshThrottle.snapshot().shadowRenderingEnabled,
      write: on => window.ShadowMapRefreshThrottle.setShadowRenderingEnabled(on) },
    { group: 'Held items and x-ray replays', id: 'replayScissor', name: 'Scissor the x-ray replays', on: true,
      desc: 'Held-item and x-ray redraws are clipped to the screen area around the characters instead of the whole screen.',
      available: () => typeof held()?.setReplayScissorEnabled === 'function',
      read: () => heldSnap().replayScissorEnabled, write: on => held().setReplayScissorEnabled(on) },
    { group: 'Held items and x-ray replays', id: 'replayCull', name: 'Cull outside the replay scissor', on: true,
      desc: 'Objects that cannot touch the clipped replay area are not resubmitted.',
      available: () => typeof held()?.setReplayCullEnabled === 'function',
      read: () => heldSnap().replayCullEnabled, write: on => held().setReplayCullEnabled(on) },
    { group: 'Held items and x-ray replays', id: 'skinnedScissor', name: 'Bound skinned bodies', on: true,
      desc: 'Neck-rigged character bodies get a real scissor box instead of forcing a full-screen replay.',
      available: () => typeof held()?.setSkinnedScissorEnabled === 'function',
      read: () => heldSnap().skinnedScissorEnabled, write: on => held().setSkinnedScissorEnabled(on) },
    { group: 'Held items and x-ray replays', id: 'nearReplay', name: 'Keep depth behind held items', on: true,
      desc: 'The x-ray depth rebuild saves and restores depth instead of redrawing everything behind the held parts (WebGL2).',
      available: () => typeof held()?.setNearReplayEnabled === 'function',
      read: () => heldSnap().nearReplayEnabled, write: on => held().setNearReplayEnabled(on) },
    { group: 'Held items and x-ray replays', id: 'floorPunch', name: 'Punch only the floor patch', on: true,
      desc: 'The ground x-ray clears depth only in the floor patch under the character instead of redrawing the world.',
      available: () => typeof held()?.setFloorPunchEnabled === 'function',
      read: () => heldSnap().floorPunch?.enabled, write: on => held().setFloorPunchEnabled(on) },
    { group: 'Held items and x-ray replays', id: 'autoInertReplay', name: 'Skip depth-inert effects in replays', on: true,
      desc: 'Sun, moon and glow sprites and additive fire or smoke are not resubmitted to the colourless replays.',
      available: () => typeof held()?.setAutoInertReplayEnabled === 'function',
      read: () => heldSnap().autoInertReplayEnabled, write: on => held().setAutoInertReplayEnabled(on) },
    { group: 'Held items and x-ray replays', id: 'colorOnlyDepthSkip', name: 'Skip colour-only gear effects in depth passes', on: true,
      desc: 'Weapon glows that write neither depth nor stencil are left out of depth-only replay draws.',
      available: () => typeof held()?.setColorOnlyDepthSkipEnabled === 'function',
      read: () => heldSnap().colorOnlyDepthSkipEnabled, write: on => held().setColorOnlyDepthSkipEnabled(on) },
    { group: 'Held items and x-ray replays', id: 'gearParticlesOnce', name: 'Draw gear particles once', on: true,
      desc: 'Enchantment motes and weapon fire are drawn once, with their gear, instead of in the base pass and every replay group.',
      available: () => typeof held()?.setGearParticlesOnceEnabled === 'function',
      read: () => heldSnap().gearParticlesOnceEnabled, write: on => held().setGearParticlesOnceEnabled(on) },
    { group: 'Held items and x-ray replays', id: 'npcWeaponsBasePass', name: 'NPC and enemy weapons in the base pass', on: true,
      desc: 'Other characters\' weapons and tools are drawn with their bearer instead of in an extra x-ray redraw (about 11 ms faster near a camp on a GTX 1060). They are fogged by mist like their bearer and no longer show through grass. Off: every weapon x-rays, as before.',
      available: () => typeof held()?.setHeldOwnerLinkEnabled === 'function' && typeof held()?.setOtherWeaponXrayLimit === 'function',
      read: () => heldSnap().heldOwnerLinkEnabled === true && heldSnap().otherWeaponXrayLimit === 0,
      write: on => { held().setHeldOwnerLinkEnabled(on); held().setOtherWeaponXrayLimit(on ? 0 : Infinity); } },

    { group: 'Characters', id: 'leanDualWieldSync', name: 'Lean dual-wield weapon sync', on: true,
      desc: 'Weapon copies held for dual wield (and the invisible offhand copy armed NPCs hold at idle) are re-posed once per hand solve and recomputed once, instead of three times per hand. Off: the old full sync.',
      available: () => typeof window.HobunjiDualWieldWeaponVisuals?.setLeanSyncEnabled === 'function',
      read: () => window.HobunjiDualWieldWeaponVisuals.leanSyncEnabled?.(), write: on => window.HobunjiDualWieldWeaponVisuals.setLeanSyncEnabled(on) },

    { group: 'Game loop', id: 'wheelListCrossFrame', name: 'Reuse the item wheel list across frames', on: true,
      desc: 'The item wheel\'s list of usable stacks is rebuilt only when the inventory, held item or item data change (and at least twice a second), instead of every frame. Off: rebuilt every frame.',
      available: () => typeof window.InventoryWheelList?.setCrossFrameEnabled === 'function',
      read: () => window.InventoryWheelList.crossFrameEnabled?.(), write: on => window.InventoryWheelList.setCrossFrameEnabled(on) },

    { group: 'Game loop', id: 'denStateMemo', name: 'Reuse den collision within a game-loop tick', on: true,
      desc: 'Creature pathfinding looks up each animal den\'s collision shape once per game-loop tick (one burst of tile checks) instead of once per tile it checks. Moving or editing a den still applies immediately. Off: looked up for every tile.',
      available: () => typeof window.GridTileAccessors?.setDenStateMemoEnabled === 'function',
      read: () => window.GridTileAccessors.denStateMemoEnabled?.(), write: on => window.GridTileAccessors.setDenStateMemoEnabled(on) },

    { group: 'Frame', id: 'frameScopedHooks', name: 'Frame-scoped render hooks', on: true,
      desc: 'Per-frame visual fix-ups apply once per frame instead of around every render call.',
      available: () => typeof hooks()?.setFrameScopeEnabled === 'function',
      read: () => hooks().getDebug?.()?.frameScopeEnabled, write: on => hooks().setFrameScopeEnabled(on) },

    { group: 'Look (costly effects)', id: 'facetedRocks', name: 'Faceted ore rocks', on: true, ownsPersistence: true,
      desc: 'Low-poly ore rocks with the stretched rock PNG on each face. Off restores the older round mounds in areas built after the change.',
      available: () => typeof window.FacetedRocks?.setEnabled === 'function',
      read: () => window.FacetedRocks.enabled?.(), write: on => window.FacetedRocks.setEnabled(on) },
    { group: 'Look (costly effects)', id: 'rainSheets', name: 'Rain and snow sheets', on: true,
      desc: 'Off hides the falling rain or blizzard planes while drawing (weather itself is unchanged).',
      available: () => typeof hooks()?.register === 'function', read: rainHider.read, write: rainHider.write },
    { group: 'Look (costly effects)', id: 'skyClouds', name: 'Sky cloud layers', on: true,
      desc: 'Off hides the sky dome\'s cloud layers while drawing.',
      available: () => typeof hooks()?.register === 'function', read: cloudHider.read, write: cloudHider.write },
  ];
  // These switches share render preferences but appear in the regular Performance section.
  const actorXrayToggles = ['animals', 'enemies', 'player'].map(group => ({
    id: 'xray-' + group,
    group: 'Performance',
    name: 'X-ray for ' + (group === 'player' ? 'the player' : group === 'enemies' ? 'NPCs and enemies' : group),
    get on() { return held()?.actorXrayDefaults?.[group] ?? (group !== 'enemies'); },
    input: 'settingActorXray-' + group,
    available: () => typeof held()?.setActorXrayEnabled === 'function',
    read: () => held().getActorXrayEnabled(group),
    write: on => held().setActorXrayEnabled(group, on),
  }));
  const settingsToggles = [...TOGGLES, ...actorXrayToggles]; // Shared persistence, live updates and defaults.
  const byId = new Map(settingsToggles.map(t => [t.id, t]));

  function loadStored() {
    try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return value && typeof value === 'object' ? value : {}; }
    catch (_) { return {}; }
  }
  function saveStored(stored) {
    try {
      if (Object.keys(stored).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* Private mode / blocked storage: the choice lasts for this session. */ }
  }

  function get(id) {
    const toggle = byId.get(id);
    if (!toggle || !toggle.available()) return null;
    let value;
    try { value = toggle.read(); } catch (_) { value = undefined; }
    if (typeof value === 'boolean') return value;
    const stored = loadStored();
    return typeof stored[id] === 'boolean' ? stored[id] : toggle.on;
  }

  function set(id, on) {
    const toggle = byId.get(id);
    if (!toggle || !toggle.available()) return null;
    on = on !== false;
    toggle.write(on);
    heldMemo = null; // Read back the value the owner actually kept.
    if (!toggle.ownsPersistence) {
      const stored = loadStored();
      if (on === toggle.on) delete stored[id]; else stored[id] = on; // Defaults are not pinned: a later default change still reaches this device.
      saveStored(stored);
    }
    const input = document.getElementById(inputId(id));
    if (input) input.checked = get(id) === true;
    return get(id);
  }

  function setGeneratedOutlineMode(mode) {
    const owner = window.WorldRenderPipeline;
    if (!owner?.setGeneratedOutlineMode || !['shell','screen','none'].includes(mode)) return null;
    const actual = owner.setGeneratedOutlineMode(mode);
    const stored = loadStored();
    if (actual === (owner.defaultGeneratedOutlineMode || 'screen')) delete stored.generatedOutlineMode; else stored.generatedOutlineMode = actual;
    saveStored(stored);
    refreshInputs();
    return actual;
  }

  function applyStored() {
    const stored = loadStored();
    if (['shell','screen','none'].includes(stored.generatedOutlineMode)) window.WorldRenderPipeline?.setGeneratedOutlineMode?.(stored.generatedOutlineMode);
    for (const [id, on] of Object.entries(stored)) {
      const toggle = byId.get(id);
      if (!toggle || toggle.ownsPersistence || typeof on !== 'boolean' || !toggle.available()) continue;
      try { toggle.write(on); } catch (error) { window.__farmLog?.(`[RenderOptimizationSettings] ${id}: ${error?.message || error}`, 'warn'); }
    }
    refreshInputs();
  }

  function reset() {
    window.WorldRenderPipeline?.setGeneratedOutlineMode?.(window.WorldRenderPipeline.defaultGeneratedOutlineMode || 'screen');
    for (const toggle of settingsToggles) if (toggle.available() && get(toggle.id) !== toggle.on) set(toggle.id, toggle.on);
    saveStored({});
    refreshInputs();
  }

  const inputId = id => byId.get(id)?.input || 'settingRenderOpt_' + id;
  function refreshInputs() {
    const outlineSelect = document.getElementById('settingRenderOpt_generatedOutlineMode');
    const outlineMode = window.WorldRenderPipeline?.getGeneratedOutlineMode?.();
    if (outlineSelect && outlineMode && outlineSelect.value !== outlineMode) outlineSelect.value = outlineMode;
    for (const toggle of settingsToggles) {
      const input = document.getElementById(inputId(toggle.id));
      if (input) input.checked = get(toggle.id) === true;
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function installSection() {
    if (document.getElementById(SECTION_ID)) return true;
    const after = document.getElementById('settingsSection8'); // Performance.
    const pane = after?.parentElement || document.querySelector('.settings-pane');
    if (!pane) return false;
    const section = el('div');
    section.id = SECTION_ID;
    section.setAttribute('data-ctrl-subtab', '');
    section.setAttribute('data-dev-only', '');
    section.setAttribute('aria-label', 'Render optimizations (perf testing) Set to Defaults');
    const title = el('div', 'settings-section-title');
    title.style.cssText = 'margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px';
    const resetButton = el('button', null, 'Set to Defaults');
    resetButton.type = 'button';
    resetButton.id = 'settingRenderOptResetDefaults';
    resetButton.style.cssText = 'font-size:11px;padding:3px 9px;background:rgba(106,167,255,.14);border:1px solid rgba(106,167,255,.35);border-radius:6px;color:#9bc2ff;cursor:pointer;white-space:nowrap';
    resetButton.addEventListener('click', event => { event.preventDefault(); reset(); });
    title.append(el('span', null, 'Render optimizations (perf testing)'), resetButton);
    section.appendChild(title);
    const intro = el('div', 'settings-desc', 'Every render optimisation, switchable for A/B testing on this device. On is how the game ships unless noted; choices are remembered on this device. The Render A/B benchmark (Dev Tools) times the main ones against each other.');
    intro.style.margin = '0 0 6px';
    section.appendChild(intro);
    if (window.WorldRenderPipeline?.setGeneratedOutlineMode) {
      const row = el('label', 'settings-row');
      const label = el('div', 'settings-label');
      label.append(el('div','settings-name','Generated outlines'), el('div','settings-desc','Keep master Outlines on. Screen-space uses visible curved-object depth; None keeps the composite and painterly without generated shell ink.'));
      const select = el('select');
      select.id = 'settingRenderOpt_generatedOutlineMode';
      select.style.cssText = 'max-width:45%;background:rgba(255,255,255,.06);border:1px solid var(--border-bright);color:var(--text);align-self:center';
      for (const [value, name] of [['shell','Shell (original)'],['screen','Screen-space depth (default)'],['none','None']]) {
        const option = el('option',null,name); option.value = value; select.appendChild(option);
      }
      select.value = window.WorldRenderPipeline.getGeneratedOutlineMode();
      select.addEventListener('change', () => setGeneratedOutlineMode(select.value));
      row.append(label,select); section.appendChild(row);
    }
    let group = null;
    for (const toggle of TOGGLES) {
      if (!toggle.available()) continue;
      if (toggle.group !== group) {
        group = toggle.group;
        const heading = el('div', 'settings-desc', group);
        heading.style.cssText = 'margin:10px 0 2px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;opacity:.75';
        section.appendChild(heading);
      }
      const row = el('label', 'settings-row');
      const label = el('div', 'settings-label');
      label.append(el('div', 'settings-name', toggle.name + (toggle.on ? '' : ' (off by default)')), el('div', 'settings-desc', toggle.desc));
      const switchWrap = el('span', 'settings-toggle');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = inputId(toggle.id);
      input.checked = get(toggle.id) === true;
      input.addEventListener('change', () => set(toggle.id, input.checked));
      switchWrap.append(input, el('span', 'toggle-slider'));
      row.append(label, switchWrap);
      section.appendChild(row);
    }
    if (after) after.insertAdjacentElement('afterend', section);
    else pane.appendChild(section);
    return true;
  }

  function installActorXrayInputs() {
    for (const toggle of actorXrayToggles) {
      const input = document.getElementById(toggle.input); // Existing Settings checkbox markup supports controller navigation.
      if (!input || !toggle.available()) continue;
      input.checked = get(toggle.id) === true;
      input.addEventListener('change', () => set(toggle.id, input.checked));
    }
  }

  applyStored();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installActorXrayInputs, { once: true });
  else installActorXrayInputs();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSection, { once: true });
  else installSection();
  window.addEventListener?.('load', applyStored, { once: true }); // Again after game.js and its init() calls.
  // The benchmark and console calls change the same switches: show live values whenever Settings is looked at.
  let refreshedAt = -Infinity;
  const refreshSoon = event => {
    if (!event.target?.closest?.('#' + SECTION_ID) || performance.now() - refreshedAt < 500) return;
    refreshedAt = performance.now();
    heldMemo = null;
    refreshInputs();
  };
  document.addEventListener?.('focusin', refreshSoon);
  document.addEventListener?.('pointerover', refreshSoon, { passive: true });

  window.RenderOptimizationSettings = Object.freeze({
    STORAGE_KEY,
    list: () => settingsToggles.filter(t => t.available()).map(t => ({ id: t.id, group: t.group, name: t.name, default: t.on, value: get(t.id) })),
    get,
    set,
    reset,
    setGeneratedOutlineMode,
    applyStored,
    refresh: refreshInputs,
  });
})();
