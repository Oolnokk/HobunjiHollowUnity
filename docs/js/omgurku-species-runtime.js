// NPC-only Omgurku: one humanoid NPC identity/AI/combat rig, with a Voorg-ass
// quadruped lower half. There is NO mount, rider AI, or spawned wildlife.
// Both halves share the NPC's existing world transform and facing.
(() => {
  'use strict';

  const ID = 'omgurku'; // Distinct NPC species key used by portraits, wardrobe, saves and gameplay.
  const BODY = 'engh-sho'; // Existing shoulder/hand/weapon/wardrobe rig donor for the humanoid half.
  const LOWER_RIG = 'voorg-ass'; // Existing animal plane/shoulder rig donor; never creates a Voorg-ass actor.
  const FRAMES = Object.freeze(['idle', 'run1', 'run2']); // Authored lower PNGs, decoded by the shared animal-plane texture cache.
  const SPRITES = Object.freeze(Object.fromEntries(FRAMES.map(frame => [frame, `assets/creaturesprites/omgurku-lower_${frame}.png`])));
  const DEFAULT_PLACEMENT = Object.freeze({
    lowerWidth: 2.1, lowerHeight: 0.916356, visibleFloorCorrection: 0.151758205,
    saddleU: 0.3087855747767857, saddleV: 0.3691508252181978,
    joinDepth: 0.03, riderScale: 1,
  }); // Seed join point from Assembly Lab V10; adjustable only through the explicit debug panel.
  const DOCS_ROOT = (() => { // Absolute docs-root URL captured while this script still has currentScript.\n    try { return new URL('../', document.currentScript?.src || new URL('js/', location.href)).href; }\n    catch (_) { return new URL('./', location.href).href; }\n  })();\n  const placement = { ...DEFAULT_PLACEMENT }; // Applied to all live composites by applyPlacement().
  const live = new Set(); // Tracks currently attached Omgurku roots for one low-frequency shared gait update.
  const tmpPosition = { x: 0, y: 0, z: 0 }; // Diagnostic fallback for incomplete Three.js stubs.
  const status = { // Surfaced by the in-page mobile debugger and debugSnapshot().
    registered: false, rigProfiles: 0, handInherited: false, wardrobeInherited: false,
    paletteInherited: false, lowerRig: LOWER_RIG, lastError: null, builds: 0, disposals: 0,
  };
  const normalize = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const isOmgurku = options => normalize(options?.speciesId || options?.profile?.fighter?.speciesId ||
    options?.profile?.appearance?.speciesId || options?.npcRecord?.appearance?.speciesId) === ID;

  function installSpeciesData() {
    const config = window.SCRATCHBONES_CONFIG?.game; // Read the canonical mutable appearance config only after parser bootstrap.
    const species = config?.appearanceEditor?.species;
    if (species) {
      species[ID] = { label: 'Omgurku', parentSpecies: BODY, genders: ['male'], npcOnly: true, playerSelectable: false };
      status.registered = true;
    }
    const source = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${BODY}::male`];
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters;
    if (source && characters) {
      const next = clone(source); // Independent authored anchors; never rewrite Engh-sho.
      next.species = ID;
      next.gender = 'male';
      if (next.shoulderPerchRule) next.shoulderPerchRule.appearanceSpeciesId = ID;
      if (next.posteriorRule) next.posteriorRule.appearanceSpeciesId = ID;
      if (next.anatomy) {
        delete next.anatomy.rigScale;
        delete next.anatomy.rigScaleX;
        delete next.anatomy.rigScaleY;
        delete next.anatomy.headScale;
        delete next.anatomy.headOffsetY;
      }
      characters[`${ID}::male`] = next;
      status.rigProfiles = 1;
      window.applyHobunjiAttachmentRigProfileCorrections?.();
    }
    const hand = window.HobunjiHandModelProfiles;
    if (hand?.mutate) {
      hand.mutate(data => {
        data.speciesModels ||= {};
        if (data.speciesModels[BODY]) data.speciesModels[ID] = data.speciesModels[BODY];
      });
      status.handInherited = !!hand.data?.speciesModels?.[ID];
    }
    // Headless quadrupeds get no humanoid foot rig, but keep Engh-sho hand GLBs.
    const profiles = config?.portrait?.armOnlyOpacityMask?.profiles;
    if (profiles?.[`${BODY}:male`]) profiles[`${ID}:male`] = clone(profiles[`${BODY}:male`]);
    const pose = window.HobunjiSpeciesPoseScale;
    if (pose?.resolveAxes && pose?.register) {
      try { pose.register(ID, 'male', pose.resolveAxes(BODY, 'male')); } catch (_) {}
    }
  }

  function installWardrobe() {
    const original = window.resolveOptionLayers; // Existing option resolver remains authoritative for every other fighter.
    if (typeof original !== 'function' || original.__omgurkuWardrobeWrapped) return;
    const wrapped = function resolveOmgurkuWardrobe(option, fighter) {
      if (normalize(fighter?.speciesId) !== ID) return original.apply(this, arguments);
      // Omgurku-specific allowedCosmetics/exclusiveSlotCosmetics gate headwear;
      // actual clothing sprite paths still come from the matching Engh-sho body.
      return original.call(this, option, { ...fighter, speciesId: BODY });
    };
    wrapped.__omgurkuWardrobeWrapped = true;
    wrapped.__omgurkuWardrobeOriginal = original;
    window.resolveOptionLayers = wrapped;
    status.wardrobeInherited = true;
  }

  function installPalette() {
    const previous = window.loadPortraitCosmetics; // Shared asynchronous species load and per-fighter body color range registry.
    if (typeof previous !== 'function' || previous.__omgurkuPaletteWrapped) return;
    const wrapped = async function loadOmgurkuColors() {
      const cosmetics = await previous.apply(this, arguments);
      const map = cosmetics?.bodyColorRangesByGender;
      const fighters = window.getPortraitFighters?.() || [];
      const donor = fighters.find(f => normalize(f.speciesId) === BODY && f.gender === 'male');
      const ours = fighters.find(f => normalize(f.speciesId) === ID && f.gender === 'male');
      if (map && donor && ours && map[donor.id]) map[ours.id] = map[donor.id];
      return cosmetics;
    };
    wrapped.__omgurkuPaletteWrapped = true;
    wrapped.__omgurkuPaletteOriginal = previous;
    window.loadPortraitCosmetics = wrapped;
    status.paletteInherited = true;
  }

  function applyPlacement(record) {
    const c = record?.root?.userData?.omgurkuComposite; // Keeps the named NPC's root fixed while both visual halves reposition together.
    if (!c) return;
    const w = placement.lowerWidth, h = placement.lowerHeight;
    const centerY = h / 2 - placement.visibleFloorCorrection;
    const joinY = centerY + (0.5 - placement.saddleV) * h;
    const joinZ = (0.5 - placement.saddleU) * w;
    c.upper.position.set(0, joinY, joinZ + placement.joinDepth);
    c.upper.scale.setScalar(placement.riderScale);
    for (const ref of c.lowerRefs) ref.group.position.set(0, centerY, 0);
    // Shared attachment math reads handAttachY off the returned avatar root;
    // translate it with the upper torso rather than leaving weapon grips at ground height.
    const handY = Number(c.upper.userData?.handAttachY);
    if (Number.isFinite(handY)) record.root.userData.handAttachY = handY * placement.riderScale + joinY;
    record.root.userData.omgurkuJoin = { x: 0, y: joinY, z: joinZ, lowerCenterY: centerY };
  }

  function setFrame(record, frame) {
    const c = record.root.userData.omgurkuComposite;
    if (c.frame === frame) return;
    for (let i = 0; i < FRAMES.length; i++) c.lowerRefs[i].group.visible = FRAMES[i] === frame;
    c.frame = frame;
  }

  function gaitTick() {
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const record of live) {
      const root = record.root;
      if (!root.parent || !root.visible) continue;
      const c = root.userData.omgurkuComposite;
      if (!c) { live.delete(record); continue; }
      // Position comes exclusively from the existing NPC walker path/schedule/AI.
      // Do not independently translate the animal, and do not run another AI tick.
      const position = root.getWorldPosition(c.positionScratch);
      const moved = c.lastPosition
        && Math.hypot(position.x - c.lastPosition.x, position.z - c.lastPosition.z) > 0.005;
      if (!c.lastPosition) c.lastPosition = position.clone();
      else c.lastPosition.copy(position);
      setFrame(record, moved ? FRAMES[1 + (Math.floor(now * 0.006) % 2)] : FRAMES[0]);
    }
  }

  function installHybridRenderer() {
    const api = window.PNGPlaneAvatar;
    const original = api?.buildSinglePlaneAvatarModel;
    if (!original || typeof api?.buildAnimalPlaneAvatarModel !== 'function' || original.__omgurkuHybridWrapped) return;
    const wrapped = function buildOmgurkuNpc(THREE, sourceCanvas, options = {}) {
      if (!isOmgurku(options)) return original.apply(this, arguments);
      const upper = original.apply(this, arguments); // Retains the real NPC portrait + skinned head, not a fake rider actor.
      if (!upper) return upper;
      const lowerRefs = [];
      try {
        for (const frame of FRAMES) {
          lowerRefs.push(api.buildAnimalPlaneAvatarModel(THREE, new URL(SPRITES[frame], DOCS_ROOT).href, {
            modelWidth: placement.lowerWidth,
            modelHeight: placement.lowerHeight,
            name: `omgurku_${frame}`,
            creatureId: LOWER_RIG, // Canonical Voorg-ass shoulder/body UV rig, with Omgurku's own already-headless pixels.
            alphaTest: options.alphaTest,
          }));
        }
        const root = new THREE.Group(); // Sole NPC avatar group: collisions, dialogue, held items and movement remain under this parent.
        root.name = options.name || 'Omgurku_NPC_Hybrid';
        root.userData = { ...upper.userData, speciesId: ID, gender: 'male', omgurkuNpc: true };
        root.add(upper);
        for (const ref of lowerRefs) root.add(ref.group);
        const c = {
          upper, lowerRefs, frame: null,
          positionScratch: new THREE.Vector3(), lastPosition: null,
        };
        root.userData.omgurkuComposite = c;
        const record = { root }; // The shared 100 ms gait scheduler uses this record and disposes it with the NPC's normal avatar.
        live.add(record);
        applyPlacement(record);
        setFrame(record, 'idle');
        status.builds += 1;
        return root;
      } catch (error) {
        for (const ref of lowerRefs) ref?.dispose?.();
        status.lastError = String(error?.message || error);
        window.__farmLog?.(`[omgurku] hybrid build failed: ${status.lastError}`, 'warn');
        return upper; // Keep a visible humanoid NPC instead of breaking the walker spawn.
      }
    };
    wrapped.__omgurkuHybridWrapped = true;
    wrapped.__omgurkuHybridOriginal = original;
    api.buildSinglePlaneAvatarModel = wrapped;

    const dispose = api.disposeAvatarModel; // Canonical NPC wardrobe/area teardown must also release three shared lower textures.
    if (typeof dispose === 'function' && !dispose.__omgurkuHybridWrapped) {
      const disposeWrapped = function disposeOmgurkuNpc(root) {
        const c = root?.userData?.omgurkuComposite;
        if (!c) return dispose.call(this, root);
        for (const record of live) if (record.root === root) { live.delete(record); break; }
        for (const ref of c.lowerRefs) ref?.dispose?.();
        // Do not call the generic recursive disposal on the combined root:
        // animal texture maps are refcounted by buildAnimalPlaneAvatarModel.
        dispose.call(this, c.upper);
        root.parent?.remove?.(root);
        status.disposals += 1;
      };
      disposeWrapped.__omgurkuHybridWrapped = true;
      disposeWrapped.__omgurkuHybridOriginal = dispose;
      api.disposeAvatarModel = disposeWrapped;
    }
  }

  function setPlacement(values = {}) {
    for (const key of Object.keys(DEFAULT_PLACEMENT)) {
      const n = Number(values[key]);
      if (!Object.prototype.hasOwnProperty.call(values, key) || !Number.isFinite(n)) continue;
      if (key === 'saddleU' || key === 'saddleV') placement[key] = Math.max(0, Math.min(1, n));
      else if (key === 'riderScale') placement[key] = Math.max(0.5, Math.min(1.5, n));
      else if (key === 'joinDepth') placement[key] = Math.max(-0.35, Math.min(0.35, n));
    }
    for (const record of live) applyPlacement(record);
    return { ...placement };
  }

  function debugSnapshot() {
    return {
      ...status, liveCount: live.size, placement: { ...placement }, sprites: { ...SPRITES },
      liveFrames: [...live].map(({ root }) => ({
        name: root.name, frame: root.userData.omgurkuComposite?.frame,
        join: root.userData.omgurkuJoin, parented: !!root.parent,
      })),
    };
  }

  function installMobileDebug() {
    if (typeof document === 'undefined' || !/(?:\?|&)omgurkuDebug=1(?:&|$)/.test(location.search)) return;
    const mount = () => {
      if (!document.body || document.getElementById('omgurku-debug')) return;
      const panel = document.createElement('details'); // Opt-in mobile controls; never visible to ordinary players.
      panel.id = 'omgurku-debug';
      panel.style.cssText = 'position:fixed;z-index:100000;left:8px;top:70px;max-height:65vh;overflow:auto;width:min(340px,92vw);color:#fff;background:#152333ee;border:1px solid #7aa7ca;padding:10px;border-radius:10px;font:12px system-ui';
      panel.innerHTML = '<summary style="cursor:pointer">Omgurku rig debug</summary><pre style="white-space:pre-wrap;font:11px monospace"></pre>';
      const pre = panel.querySelector('pre'); // Live build/asset/rig errors remain visible without DevTools.
      for (const [key,min,max,step] of [['saddleU',0,1,.005],['saddleV',0,1,.005],['joinDepth',-.35,.35,.01],['riderScale',.5,1.5,.01]]) {
        const label = document.createElement('label');
        label.style.cssText = 'display:block;margin:7px 0';
        label.textContent = key;
        const input = document.createElement('input');
        input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = placement[key];
        input.style.width = '100%';
        input.addEventListener('input', () => { setPlacement({ [key]: Number(input.value) }); pre.textContent = JSON.stringify(debugSnapshot(), null, 2); });
        label.appendChild(input); panel.appendChild(label);
      }
      const refresh = document.createElement('button');
      refresh.textContent = 'Refresh diagnostics';
      refresh.addEventListener('click', () => { pre.textContent = JSON.stringify(debugSnapshot(), null, 2); });
      panel.appendChild(refresh); document.body.appendChild(panel);
      pre.textContent = JSON.stringify(debugSnapshot(), null, 2);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }

  function install() {
    installSpeciesData();
    installWardrobe();
    installPalette();
    installHybridRenderer();
    return debugSnapshot();
  }

  window.HobunjiOmgurkuSpecies = Object.freeze({
    id: ID, bodySpecies: BODY, lowerRigSpecies: LOWER_RIG, sprites: SPRITES,
    install, setPlacement, debugSnapshot,
  });
  install();
  installMobileDebug();
  setInterval(gaitTick, 100); // One shared, bounded-frequency visual gait tick; no parallel NPC simulation.
})();
