(() => {
  'use strict';

  const MAX_LEVEL = 20;
  const SERVICE_TICK_MS = 10000;
  const SERVICE_XP = 2;
  const ALERT_RANGE_TILES = 5.5;
  const AMBIENT_SCAN_MS = 700;
  const AMBIENT_MIN_GAP_MS = 5500;
  const DIRECT_PET_GREETING_RANK = 3;
  const FRIEND_FAVOR_MIN = 2;
  const DEBUG_ID = 'stableAnimalProgressionDebug';

  const ROLE_LABELS = {
    companion: 'Animal Companion',
    mount: 'Mount',
    shoulderPet: 'Shoulder Pet',
  };

  const TREES = {
    companion: [
      { id: 'rapportBond', name: 'Trusted Company', maxRank: 5, desc: '+6% positive NPC rapport per rank while this companion is out with you.' },
      { id: 'keenSenses', name: 'Keen Senses', maxRank: 5, desc: '+10% camp/den discovery range per rank. Companion-only.' },
      { id: 'fieldLessons', name: 'Field Lessons', maxRank: 5, desc: '+10% service XP per rank while this companion is active.' },
    ],
    mount: [
      { id: 'rapportBond', name: 'Gentle Rider', maxRank: 5, desc: '+5% positive NPC rapport per rank while this mount is present.' },
      { id: 'roadLessons', name: 'Road Lessons', maxRank: 5, desc: '+10% service XP per rank while this mount is active.' },
    ],
    shoulderPet: [
      { id: 'rapportBond', name: 'Social Perch', maxRank: 5, desc: '+4% positive NPC rapport per rank while this pet is perched.' },
      { id: 'heavyWindupAlert', name: 'Heavy Warning', maxRank: 1, desc: 'Warns when a nearby enemy is winding up a heavy attack. Red aura.' },
      { id: 'quickOpportunityAlert', name: 'Opening Call', maxRank: 1, desc: 'Warns when a nearby melee enemy fulfills your equipped Quick Attack bonus. Green aura.' },
      { id: 'rangedFocusAlert', name: 'Marksman Warning', maxRank: 1, desc: 'Warns when a nearby enemy is focusing you with a ranged weapon. Blue aura.' },
      { id: 'perchLessons', name: 'Perch Lessons', maxRank: 5, desc: '+10% service XP per rank while this pet is perched.' },
    ],
  };

  const ALERTS = {
    heavyWindup: { perk: 'heavyWindupAlert', color: '#ff493d', clipIndex: 0, reason: 'shoulder-heavy-windup', label: 'heavy windup', auraScale: 1.75 },
    quickOpportunity: { perk: 'quickOpportunityAlert', color: '#62ff72', clipIndex: 1, reason: 'shoulder-quick-opening', label: 'quick opening', auraScale: 1.55 },
    rangedFocus: { perk: 'rangedFocusAlert', color: '#46a6ff', clipIndex: 2, reason: 'shoulder-ranged-focus', label: 'ranged focus', auraScale: 1.95 },
  };

  let farmDeps = null;
  let panelDeps = null;
  let ambientDeps = null;
  let dialogueDeps = null;
  let banditDeps = null;
  let installed = false;
  let alertFrameStarted = false;
  let lastServiceXpAt = 0;
  let lastAmbientScanAt = 0;
  let lastAmbientSpokeAt = 0;
  let ambientDay = null;
  const ambientSeen = new Set();
  const alertAuras = new Map();
  const alertTextures = new Map();
  let debugExpanded = false;

  function clampInt(value, min, max) {
    return Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));
  }

  function currentDeps() {
    return farmDeps || panelDeps || null;
  }

  function stableEntries() {
    return currentDeps()?.getStable?.() || [];
  }

  function saveStable() {
    currentDeps()?.saveStable?.();
  }

  function roleForEntry(entry) {
    return window.CreatureGenetics?.stableEntryRole?.(entry)
      || entry?.stableRole
      || entry?.role
      || 'companion';
  }

  function normalizeEntry(entry) {
    if (!entry) return entry;
    entry.level = clampInt(entry.level, 0, MAX_LEVEL);
    entry.stableXp = Math.max(0, Math.floor(Number(entry.stableXp) || 0));
    if (!entry.animalPerks || typeof entry.animalPerks !== 'object' || Array.isArray(entry.animalPerks)) entry.animalPerks = {};
    const role = roleForEntry(entry);
    const allowed = new Map((TREES[role] || []).map(def => [def.id, def]));
    for (const [perkId, rawRank] of Object.entries(entry.animalPerks)) {
      const def = allowed.get(perkId);
      if (!def) { delete entry.animalPerks[perkId]; continue; }
      entry.animalPerks[perkId] = clampInt(rawRank, 0, def.maxRank);
    }
    return entry;
  }

  function normalizeStable() {
    let changed = false;
    for (const entry of stableEntries()) {
      const before = JSON.stringify({ level: entry.level, stableXp: entry.stableXp, animalPerks: entry.animalPerks });
      normalizeEntry(entry);
      const after = JSON.stringify({ level: entry.level, stableXp: entry.stableXp, animalPerks: entry.animalPerks });
      if (before !== after) changed = true;
    }
    if (changed) saveStable();
    return changed;
  }

  function perkRank(entry, perkId) {
    normalizeEntry(entry);
    return clampInt(entry?.animalPerks?.[perkId], 0, 99);
  }

  function spentPoints(entry) {
    normalizeEntry(entry);
    return Object.values(entry?.animalPerks || {}).reduce((sum, rank) => sum + clampInt(rank, 0, 99), 0);
  }

  function availablePoints(entry) {
    normalizeEntry(entry);
    return Math.max(0, entry.level - spentPoints(entry));
  }

  function xpToNext(level) {
    const safe = clampInt(level, 0, MAX_LEVEL);
    return safe >= MAX_LEVEL ? 0 : 40 + safe * 20;
  }

  function xpGainMultiplier(entry) {
    const role = roleForEntry(entry);
    const perk = role === 'companion' ? 'fieldLessons' : role === 'mount' ? 'roadLessons' : 'perchLessons';
    return 1 + perkRank(entry, perk) * 0.10;
  }

  function findStableEntry(id) {
    return stableEntries().find(entry => entry?.id === id) || null;
  }

  function activeIdForRole(role) {
    const deps = currentDeps();
    if (role === 'mount') return deps?.getActiveMountId?.() || null;
    if (role === 'shoulderPet') return deps?.getActiveShoulderPetId?.() || null;
    return deps?.getActiveCompanionId?.() || null;
  }

  function activeEntryForRole(role) {
    const id = activeIdForRole(role);
    const entry = id ? findStableEntry(id) : null;
    return entry && roleForEntry(entry) === role ? entry : null;
  }

  function liveRoleActor(role) {
    if (role === 'mount' && window.Mounts?.rideEntity?.health > 0) return window.Mounts.rideEntity;
    const deps = window.Combat?.deps;
    const player = deps?.player;
    if (!player) return null;
    const area = deps.getCurrentArea?.();
    for (const actor of deps.companionObjects || []) {
      if (!actor || actor.health <= 0 || actor.stableRole !== role) continue;
      if ((actor.master || player) !== player) continue;
      if (area && actor.areaId && actor.areaId !== area) continue;
      if (actor.avatarRef?.group?.visible === false) continue;
      return actor;
    }
    return null;
  }

  function roleIsPresent(role) {
    if (!activeEntryForRole(role)) return false;
    return !!liveRoleActor(role);
  }

  function rapportMultiplierDetails() {
    const details = [];
    let bonus = 0;
    for (const role of ['companion', 'mount', 'shoulderPet']) {
      const entry = activeEntryForRole(role);
      if (!entry || !roleIsPresent(role)) continue;
      const rank = perkRank(entry, 'rapportBond');
      if (!rank) continue;
      const perRank = role === 'companion' ? 0.06 : role === 'mount' ? 0.05 : 0.04;
      const add = rank * perRank;
      bonus += add;
      details.push({ role, id: entry.id, name: entry.name || entry.kind, rank, add });
    }
    return { multiplier: 1 + bonus, bonus, details };
  }

  function awardXp(entryOrId, rawAmount, source = 'service') {
    const entry = typeof entryOrId === 'string' ? findStableEntry(entryOrId) : entryOrId;
    if (!entry) return { ok: false, levels: 0, amount: 0 };
    normalizeEntry(entry);
    if (entry.level >= MAX_LEVEL) return { ok: true, levels: 0, amount: 0 };
    const amount = Math.max(0, Math.round((Number(rawAmount) || 0) * xpGainMultiplier(entry)));
    if (!amount) return { ok: false, levels: 0, amount: 0 };
    entry.stableXp += amount;
    let levels = 0;
    while (entry.level < MAX_LEVEL) {
      const needed = xpToNext(entry.level);
      if (entry.stableXp < needed) break;
      entry.stableXp -= needed;
      entry.level++;
      levels++;
    }
    if (entry.level >= MAX_LEVEL) entry.stableXp = 0;
    saveStable();
    if (levels) {
      currentDeps()?.showToast?.(`🐾 ${entry.name || entry.kind || 'Animal'} reached level ${entry.level}! +${levels} training point${levels === 1 ? '' : 's'}.`, true);
      window.__farmLog?.(`[stable-level] ${entry.id} +${levels} level(s) from ${source}; now ${entry.level}.`, 'farm');
    }
    return { ok: true, levels, amount };
  }

  function spendPoint(entryId, perkId) {
    const entry = findStableEntry(entryId);
    if (!entry) return { ok: false, message: 'Animal not found.' };
    normalizeEntry(entry);
    if (entry.lifeStage === 'baby') return { ok: false, message: 'Baby animals cannot train yet.' };
    const role = roleForEntry(entry);
    const def = (TREES[role] || []).find(item => item.id === perkId);
    if (!def) return { ok: false, message: 'That perk does not belong to this animal role.' };
    const rank = perkRank(entry, perkId);
    if (rank >= def.maxRank) return { ok: false, message: `${def.name} is already maxed.` };
    if (availablePoints(entry) <= 0) return { ok: false, message: 'No training points available.' };
    entry.animalPerks[perkId] = rank + 1;
    saveStable();
    renderProgressionPanel();
    return { ok: true, message: `${entry.name || entry.kind}: ${def.name} ${rank + 1}/${def.maxRank}.` };
  }

  function companionPerceptionMultiplier(actor) {
    if (!actor || actor.stableRole === 'shoulderPet' || actor.stableRole === 'mount') return 1;
    const entry = activeEntryForRole('companion');
    if (!entry || !roleIsPresent('companion')) return 1;
    return 1 + perkRank(entry, 'keenSenses') * 0.10;
  }

  function serviceXpTick(now) {
    if (now - lastServiceXpAt < SERVICE_TICK_MS) return;
    lastServiceXpAt = now;
    for (const role of ['companion', 'mount', 'shoulderPet']) {
      const entry = activeEntryForRole(role);
      if (!entry || !roleIsPresent(role)) continue;
      awardXp(entry, SERVICE_XP, `${role}-active`);
    }
  }

  function targetRoot(target) {
    return target?.avatarRef?.group || target?.root || target?.group || target?.mesh || null;
  }

  function targetScene(root) {
    let node = root;
    while (node && !node.isScene) node = node.parent;
    return node?.isScene ? node : null;
  }

  function heavyWindupActive(enemy) {
    if (!enemy || enemy.telegraphState !== 'windup') return false;
    const visuals = window.Combat?.heavyTelegraphVisuals?.activeVisuals?.();
    if (visuals) {
      for (const visual of visuals) if (visual?.actor === enemy && visual.offensive) return true;
    }
    const charged = window.Combat?.chargedBreakerData;
    const expectedPower = Number(charged?.POWER) || 1.7;
    return !!enemy.isBandit
      && enemy._banditSwingAnim === 'sweep'
      && Math.abs((Number(enemy._banditSwingPower) || 0) - expectedPower) < 0.001;
  }

  function quickOpportunityActive(enemy) {
    if (!enemy?.def?.weaponKey || enemy._rangedMode) return false;
    const combat = window.Combat;
    const attackId = combat?.loadout?.getSlot?.('tap2');
    const def = attackId ? combat?.quickAttackData?.TECHNIQUES?.[attackId] : null;
    if (!def?.condKey) return false;
    const evaluator = combat.getQuickAttackConditions || combat.quickAttackData?.getConditions;
    const conditions = evaluator?.(combat.deps, enemy);
    return !!conditions?.[def.condKey];
  }

  function rangedFocusActive(enemy) {
    return !!(enemy?._rangedMode && enemy?.def?.rangedWeaponKey);
  }

  function alertKindsForTarget(enemy, shoulderEntry = activeEntryForRole('shoulderPet')) {
    if (!enemy || !shoulderEntry) return [];
    const out = [];
    if (perkRank(shoulderEntry, ALERTS.heavyWindup.perk) && heavyWindupActive(enemy)) out.push('heavyWindup');
    if (perkRank(shoulderEntry, ALERTS.quickOpportunity.perk) && quickOpportunityActive(enemy)) out.push('quickOpportunity');
    if (perkRank(shoulderEntry, ALERTS.rangedFocus.perk) && rangedFocusActive(enemy)) out.push('rangedFocus');
    return out;
  }

  function auraTexture(kind) {
    if (alertTextures.has(kind)) return alertTextures.get(kind);
    if (typeof THREE === 'undefined') return null;
    const cfg = ALERTS[kind];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d');
    const center = 96;
    ctx.clearRect(0, 0, 192, 192);
    ctx.strokeStyle = cfg.color;
    ctx.shadowColor = cfg.color;
    ctx.shadowBlur = 22;
    ctx.lineWidth = 10;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(center, center, 66, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(center + Math.cos(a) * 74, center + Math.sin(a) * 74);
      ctx.lineTo(center + Math.cos(a) * 90, center + Math.sin(a) * 90);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    alertTextures.set(kind, texture);
    return texture;
  }

  function makeAura(enemy, kind) {
    if (typeof THREE === 'undefined') return null;
    const texture = auraTexture(kind);
    if (!texture) return null;
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = `shoulder_pet_alert_${kind}`;
    sprite.renderOrder = 1500;
    sprite.frustumCulled = false;
    sprite.visible = true;
    return { enemy, kind, sprite, material, createdAt: performance.now() };
  }

  function auraMapFor(enemy) {
    let map = alertAuras.get(enemy);
    if (!map) { map = new Map(); alertAuras.set(enemy, map); }
    return map;
  }

  function disposeAura(bundle) {
    bundle?.sprite?.parent?.remove?.(bundle.sprite);
    bundle?.material?.dispose?.();
  }

  function clearAllAuras() {
    for (const map of alertAuras.values()) for (const bundle of map.values()) disposeAura(bundle);
    alertAuras.clear();
  }

  function alertVocalization(pet, kind) {
    const cfg = ALERTS[kind];
    const vocals = window.AnimalVocalizations;
    if (!pet || !vocals?.warning) return;
    const profile = vocals.profileForDebug?.(pet);
    const clips = profile?.warning?.allowedClips || profile?.warning?.clips || [];
    const selectedClip = clips.length ? clips[cfg.clipIndex % clips.length] : null;
    const opts = selectedClip ? { allowedClips: [selectedClip] } : {};
    vocals.warning(pet, cfg.reason, opts);
  }

  function syncAlertAura(enemy, kind, active, now) {
    const map = auraMapFor(enemy);
    let bundle = map.get(kind) || null;
    if (!active) {
      if (bundle) { disposeAura(bundle); map.delete(kind); }
      if (!map.size) alertAuras.delete(enemy);
      return false;
    }
    const root = targetRoot(enemy);
    const scene = root && targetScene(root);
    const anchor = root && window.WorldPopupText?.avatarCentroidWorld?.(root);
    if (!root || !scene || !anchor) return false;
    if (!bundle) {
      bundle = makeAura(enemy, kind);
      if (!bundle) return false;
      map.set(kind, bundle);
      scene.add(bundle.sprite);
      alertVocalization(liveRoleActor('shoulderPet'), kind);
      awardXp(activeEntryForRole('shoulderPet'), 3, `alert:${kind}`);
    } else if (bundle.sprite.parent !== scene) {
      bundle.sprite.parent?.remove?.(bundle.sprite);
      scene.add(bundle.sprite);
    }
    const cfg = ALERTS[kind];
    const pulse = 1 + Math.sin(now * 0.012 + cfg.clipIndex * 1.7) * 0.10;
    bundle.sprite.position.copy(anchor);
    bundle.sprite.position.y += 0.04 * cfg.clipIndex;
    bundle.sprite.scale.set(cfg.auraScale * pulse, cfg.auraScale * pulse, 1);
    bundle.material.opacity = 0.82 + 0.16 * (0.5 + 0.5 * Math.sin(now * 0.018));
    return true;
  }

  function updateShoulderAlerts(now) {
    const combat = window.Combat;
    const deps = combat?.deps;
    const petEntry = activeEntryForRole('shoulderPet');
    const pet = liveRoleActor('shoulderPet');
    if (!deps?.player || !petEntry || !pet) { clearAllAuras(); return; }
    const tile = Math.max(1, Number(deps.TILE) || 64);
    const maxRange = tile * ALERT_RANGE_TILES;
    const area = deps.getCurrentArea?.();
    const liveEnemies = new Set();
    for (const enemy of deps.hostileObjects || []) {
      if (!enemy || enemy.health <= 0 || enemy._denHidden) continue;
      if (area && enemy.areaId && enemy.areaId !== area) continue;
      if (Math.hypot(enemy.x - deps.player.x, enemy.y - deps.player.y) > maxRange) continue;
      liveEnemies.add(enemy);
      const kinds = new Set(alertKindsForTarget(enemy, petEntry));
      for (const kind of Object.keys(ALERTS)) syncAlertAura(enemy, kind, kinds.has(kind), now);
    }
    for (const enemy of [...alertAuras.keys()]) {
      if (liveEnemies.has(enemy)) continue;
      const map = alertAuras.get(enemy);
      for (const bundle of map?.values?.() || []) disposeAura(bundle);
      alertAuras.delete(enemy);
    }
  }

  function alertFrame(now) {
    serviceXpTick(now);
    updateShoulderAlerts(now);
    requestAnimationFrame(alertFrame);
  }

  function ensureAlertFrame() {
    if (alertFrameStarted || typeof requestAnimationFrame !== 'function') return;
    alertFrameStarted = true;
    requestAnimationFrame(alertFrame);
  }

  function recognitionMemoryKey(entry) {
    return `stableAnimalRecognized:${entry?.id || 'unknown'}`;
  }

  function npcRecognizesAnimal(npcId, entry) {
    const memory = window.DialogueContent?.getNpcDlgState?.(npcId)?.memory || [];
    const key = recognitionMemoryKey(entry);
    return memory.some(item => (typeof item === 'string' ? item : item?.event) === key);
  }

  function animalSpeciesLabel(entry) {
    return window.CREATURE_DB?.[entry?.kind]?.label || entry?.kind || 'animal';
  }

  function presentAnimals() {
    const out = [];
    for (const role of ['companion', 'mount', 'shoulderPet']) {
      const entry = activeEntryForRole(role);
      const actor = liveRoleActor(role);
      if (entry && actor) out.push({ role, entry, actor, bondRank: perkRank(entry, 'rapportBond') });
    }
    return out;
  }

  function ambientLineFor(walker, animal) {
    const npcId = walker?.rec?.id || '';
    const name = animal.entry.name || animalSpeciesLabel(animal.entry);
    const species = animalSpeciesLabel(animal.entry);
    const rank = animal.bondRank;
    const recognized = npcRecognizesAnimal(npcId, animal.entry);
    if (recognized && rank >= DIRECT_PET_GREETING_RANK) {
      return [`${name}! Good to see you.`, `Hello, ${name}!`, `There you are, ${name}.`][Math.abs(hashCode(`${npcId}:${name}`)) % 3];
    }
    if (rank >= DIRECT_PET_GREETING_RANK) {
      return animal.role === 'mount'
        ? `Oh, look at you. You're a magnificent one, aren't you?`
        : animal.role === 'companion'
          ? `Hello there, beautiful. You keep good watch over your person.`
          : `Well hello, little one. Aren't you charming?`;
    }
    if (rank > 0) {
      return animal.role === 'mount'
        ? `You've trained that ${species} well. It carries itself gently around people.`
        : animal.role === 'companion'
          ? `${name} listens to you well. That's a good ${species}.`
          : `${name} looks very comfortable up there.`;
    }
    if (animal.role === 'mount') {
      return [`Easy with that ${species}, please.`, `Keep a good hold on that ${species} around town.`, `That's a lot of animal. Give me a little room, would you?`][Math.abs(hashCode(`${npcId}:${name}:mount`)) % 3];
    }
    if (animal.role === 'companion') {
      return [`Keep ${name} close, please.`, `That ${species} isn't going to lunge, is it?`, `I know it's with you, but warn me before ${name} comes any closer.`][Math.abs(hashCode(`${npcId}:${name}:companion`)) % 3];
    }
    return [`Oh! You've got company on your shoulder.`, `I nearly missed that little ${species}.`, `Does ${name} always ride up there?`][Math.abs(hashCode(`${npcId}:${name}:shoulder`)) % 3];
  }

  function hashCode(text) {
    let hash = 0;
    for (const ch of String(text)) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    return hash;
  }

  function updateAnimalAmbient(now) {
    if (!ambientDeps || now - lastAmbientScanAt < AMBIENT_SCAN_MS || now - lastAmbientSpokeAt < AMBIENT_MIN_GAP_MS) return;
    lastAmbientScanAt = now;
    if (ambientDeps.isDialogueOpen?.() || ambientDeps.isPaused?.()) return;
    const day = Number(ambientDeps.getDay?.()) || 1;
    if (ambientDay !== day) { ambientDay = day; ambientSeen.clear(); }
    const animals = presentAnimals();
    if (!animals.length) return;
    const area = ambientDeps.getCurrentArea?.();
    const player = ambientDeps.getPlayerPosition?.();
    if (!player) return;
    const walkers = (ambientDeps.getNpcWalkers?.() || []).filter(walker => walker?.area === area && walker?.root);
    for (const walker of walkers) {
      const npcId = walker.rec?.id;
      if (!npcId) continue;
      const distance = Math.hypot(walker.root.position.x - player.x, walker.root.position.z - player.z);
      if (distance > 3.3) continue;
      const animal = animals[Math.abs(hashCode(`${npcId}:${day}`)) % animals.length];
      const key = `${day}:${npcId}:${animal.entry.id}`;
      if (ambientSeen.has(key)) continue;
      ambientSeen.add(key);
      lastAmbientSpokeAt = now;
      const line = ambientLineFor(walker, animal);
      window.AmbientDialogue?.show?.(walker.root, line, {
        speakerId: npcId,
        profile: walker.profile,
        mode: 'chathead',
        durationMs: 4300,
        tone: animal.bondRank >= DIRECT_PET_GREETING_RANK ? 'cheer' : undefined,
        directedAtPlayer: true,
        faceWalker: walker,
        faceTarget: animal.actor?.avatarRef?.group ? { root: animal.actor.avatarRef.group } : player,
      });
      break;
    }
  }

  function recognitionCandidate(rec) {
    if (!rec?.id) return null;
    const state = window.DialogueContent?.getNpcDlgState?.(rec.id);
    if ((Number(state?.favor) || 0) < FRIEND_FAVOR_MIN) return null;
    for (const animal of presentAnimals()) {
      if (animal.bondRank < DIRECT_PET_GREETING_RANK) continue;
      if (npcRecognizesAnimal(rec.id, animal.entry)) continue;
      return animal;
    }
    return null;
  }

  function recognitionLine(rec, animal) {
    const name = animal.entry.name || animalSpeciesLabel(animal.entry);
    if (animal.role === 'mount') return `${name} has really grown on me. I was nervous around them at first, but now I look forward to seeing the two of you come by.`;
    if (animal.role === 'companion') return `${name} has really grown on me. I can see how closely they watch you—and how carefully you've taught them to behave around people.`;
    return `${name} has really grown on me. I think I'd notice if you came by without that little face perched beside yours.`;
  }

  function patchDialogueContent(api) {
    if (!api || api.__stableAnimalProgressionWrapped) return api;
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api);
      api.init = function stableAnimalDialogueInit(injectedDeps) {
        dialogueDeps = injectedDeps;
        return originalInit(injectedDeps);
      };
    }
    if (typeof api.beginNpcConversation === 'function') {
      const originalBegin = api.beginNpcConversation.bind(api);
      api.beginNpcConversation = function stableAnimalRecognitionConversation(rec, ...rest) {
        const animal = recognitionCandidate(rec);
        if (!animal) return originalBegin(rec, ...rest);
        const previousTrees = rec.dialogueTrees;
        const tree = {
          id: `stable_animal_recognition_${animal.entry.id}`,
          name: 'Animal Recognition',
          trigger: 'interact',
          priority: 999999,
          conditions: {},
          entryNode: 'recognition',
          nodes: [{ id: 'recognition', type: 'text', text: recognitionLine(rec, animal), next: null }],
        };
        rec.dialogueTrees = [tree];
        let result;
        try { result = originalBegin(rec, ...rest); }
        finally { rec.dialogueTrees = previousTrees; }
        api.recordNpcMemory?.(rec.id, recognitionMemoryKey(animal.entry));
        currentDeps()?.saveMemberWorldData?.();
        return result;
      };
    }
    api.__stableAnimalProgressionWrapped = true;
    return api;
  }

  function patchAmbientDialogue(api) {
    if (!api || api.__stableAnimalProgressionWrapped) return api;
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api);
      api.init = function stableAnimalAmbientInit(injectedDeps) {
        ambientDeps = injectedDeps;
        return originalInit(injectedDeps);
      };
    }
    if (typeof api.update === 'function') {
      const originalUpdate = api.update.bind(api);
      api.update = function stableAnimalAmbientUpdate(now = performance.now()) {
        const result = originalUpdate(now);
        updateAnimalAmbient(now);
        return result;
      };
    }
    api.__stableAnimalProgressionWrapped = true;
    return api;
  }

  function withDiscoveryCompanionsOnly(callback) {
    const set = banditDeps?.companionObjects;
    const player = banditDeps?.player;
    if (!set?.delete || !set?.add || !player) return callback();
    const removed = [];
    const defSwaps = [];
    for (const actor of [...set]) {
      if (!actor || (actor.master || player) !== player) continue;
      if (actor.stableRole === 'shoulderPet' || actor.stableRole === 'mount') {
        set.delete(actor);
        removed.push(actor);
        continue;
      }
      const mult = companionPerceptionMultiplier(actor);
      if (mult <= 1 || !actor.def) continue;
      const oldDef = actor.def;
      const base = Number(oldDef.perceptionTiles);
      actor.def = { ...oldDef, perceptionTiles: (Number.isFinite(base) ? base : 6) * mult };
      defSwaps.push([actor, oldDef]);
    }
    try { return callback(); }
    finally {
      for (const [actor, oldDef] of defSwaps) actor.def = oldDef;
      for (const actor of removed) set.add(actor);
    }
  }

  function patchBanditCamps(api) {
    if (!api || api.__stableAnimalProgressionWrapped) return api;
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api);
      api.init = function stableAnimalBanditInit(injectedDeps) {
        banditDeps = injectedDeps;
        return originalInit(injectedDeps);
      };
    }
    for (const methodName of ['updateCompanionPerception', 'updateRandomEncounters']) {
      if (typeof api[methodName] !== 'function') continue;
      const original = api[methodName].bind(api);
      api[methodName] = function stableAnimalDiscoveryRoleFilter(...args) {
        return withDiscoveryCompanionsOnly(() => original(...args));
      };
    }
    api.__stableAnimalProgressionWrapped = true;
    return api;
  }

  function patchNpcRapport(api) {
    if (!api || api.__stableAnimalProgressionWrapped || typeof api.adjust !== 'function') return api;
    const originalAdjust = api.adjust.bind(api);
    const wrapper = Object.create(Object.getPrototypeOf(api) || Object.prototype);
    const descriptors = Object.getOwnPropertyDescriptors(api);
    delete descriptors.adjust;
    Object.defineProperties(wrapper, descriptors);
    Object.defineProperty(wrapper, 'adjust', {
      configurable: true,
      enumerable: true,
      writable: false,
      value(npcId, amount, source) {
        const numeric = Number(amount);
        const details = numeric > 0 ? rapportMultiplierDetails() : { multiplier: 1 };
        const adjusted = Number.isFinite(numeric) && numeric > 0 ? numeric * details.multiplier : amount;
        return originalAdjust(npcId, adjusted, source);
      },
    });
    Object.defineProperty(wrapper, '__stableAnimalProgressionWrapped', { value: true, enumerable: false });
    try { return Object.freeze(wrapper); } catch (_) { return wrapper; }
  }

  function hookFutureGlobal(name, patcher) {
    const current = window[name];
    if (current) {
      const replacement = patcher(current) || current;
      if (replacement !== current) window[name] = replacement;
      return;
    }
    const desc = Object.getOwnPropertyDescriptor(window, name);
    const previousSet = desc?.set;
    const previousGet = desc?.get;
    if (previousSet) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: desc.enumerable !== false,
        get: previousGet,
        set(value) {
          previousSet.call(window, value);
          const resolved = previousGet ? previousGet.call(window) : window[name];
          const replacement = patcher(resolved) || resolved;
          if (replacement && replacement !== resolved) {
            Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: replacement });
          }
        },
      });
      return;
    }
    let pending = null;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return pending; },
      set(value) {
        pending = patcher(value) || value;
        Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: pending });
      },
    });
  }

  function patchFarmAnimals(api) {
    if (!api || api.__stableAnimalProgressionWrapped) return;
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api);
      api.init = function stableAnimalProgressionFarmInit(injectedDeps) {
        farmDeps = injectedDeps;
        const result = originalInit(injectedDeps);
        normalizeStable();
        return result;
      };
    }
    if (typeof api.addToStable === 'function') {
      const originalAdd = api.addToStable.bind(api);
      api.addToStable = function stableAnimalProgressionAdd(...args) {
        const result = originalAdd(...args);
        normalizeStable();
        return result;
      };
    }
    api.__stableAnimalProgressionWrapped = true;
  }

  function patchFarmPanel(api) {
    if (!api || api.__stableAnimalProgressionWrapped) return;
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api);
      api.init = function stableAnimalProgressionPanelInit(injectedDeps) {
        panelDeps = injectedDeps;
        const result = originalInit(injectedDeps);
        normalizeStable();
        return result;
      };
    }
    if (typeof api.renderStablePanel === 'function') {
      const originalRender = api.renderStablePanel.bind(api);
      api.renderStablePanel = function stableAnimalProgressionRender(...args) {
        const result = originalRender(...args);
        renderProgressionPanel();
        return result;
      };
    }
    api.__stableAnimalProgressionWrapped = true;
  }

  function makeText(tag, text, css = '') {
    const el = document.createElement(tag);
    el.textContent = text;
    if (css) el.style.cssText = css;
    return el;
  }

  function renderProgressionPanel() {
    const list = document.getElementById('stableList');
    if (!list) return;
    list.querySelector('#stableAnimalProgression')?.remove();
    normalizeStable();
    const stable = stableEntries();
    if (!stable.length) return;

    const section = document.createElement('div');
    section.id = 'stableAnimalProgression';
    section.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.14);display:flex;flex-direction:column;gap:10px;';
    section.appendChild(makeText('div', 'Animal Training', 'font-weight:800;font-size:14px;'));
    section.appendChild(makeText('div', 'Active stabled animals gain XP while traveling with you. Each level grants one point for that animal’s role tree.', 'font-size:11px;opacity:.78;line-height:1.35;'));

    for (const entry of stable) {
      normalizeEntry(entry);
      const role = roleForEntry(entry);
      const points = availablePoints(entry);
      const card = document.createElement('div');
      card.className = 'farm-row';
      card.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;gap:7px;padding:9px;';
      const next = xpToNext(entry.level);
      card.appendChild(makeText('div', `${entry.name || entry.kind || 'Animal'} · ${ROLE_LABELS[role] || role} · Lv ${entry.level}${entry.level >= MAX_LEVEL ? ' MAX' : ` · ${entry.stableXp}/${next} XP`} · ${points} point${points === 1 ? '' : 's'}`, 'font-weight:700;'));
      const tree = document.createElement('div');
      tree.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px;';
      for (const def of TREES[role] || []) {
        const rank = perkRank(entry, def.id);
        const button = document.createElement('button');
        button.className = 'settings-small-btn';
        button.disabled = entry.lifeStage === 'baby' || points <= 0 || rank >= def.maxRank;
        button.style.cssText = 'white-space:normal;text-align:left;min-height:54px;line-height:1.25;';
        button.textContent = `${def.name} ${rank}/${def.maxRank}\n${def.desc}`;
        button.addEventListener('click', () => {
          const result = spendPoint(entry.id, def.id);
          currentDeps()?.showToast?.(result.message, result.ok);
          window.FarmPanel?.renderStablePanel?.();
        });
        tree.appendChild(button);
      }
      card.appendChild(tree);
      section.appendChild(card);
    }

    const debugButton = document.createElement('button');
    debugButton.className = 'settings-small-btn';
    debugButton.textContent = debugExpanded ? 'Hide Animal Training Debug' : 'Debug Animal Training';
    debugButton.addEventListener('click', () => { debugExpanded = !debugExpanded; renderProgressionPanel(); });
    section.appendChild(debugButton);
    if (debugExpanded) {
      const pre = document.createElement('pre');
      pre.id = DEBUG_ID;
      pre.style.cssText = 'margin:0;max-height:270px;overflow:auto;white-space:pre-wrap;font-size:10px;background:rgba(0,0,0,.35);padding:8px;border-radius:6px;';
      pre.textContent = JSON.stringify(debugSnapshot(), null, 2);
      section.appendChild(pre);
    }
    list.appendChild(section);
  }

  function debugSnapshot() {
    return {
      maxLevel: MAX_LEVEL,
      serviceTickMs: SERVICE_TICK_MS,
      alertRangeTiles: ALERT_RANGE_TILES,
      rapport: rapportMultiplierDetails(),
      active: Object.fromEntries(['companion', 'mount', 'shoulderPet'].map(role => [role, {
        stableId: activeIdForRole(role),
        present: roleIsPresent(role),
        liveActor: liveRoleActor(role)?.id || liveRoleActor(role)?.name || null,
      }])),
      animals: stableEntries().map(entry => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        role: roleForEntry(entry),
        level: normalizeEntry(entry).level,
        xp: entry.stableXp,
        nextXp: xpToNext(entry.level),
        spent: spentPoints(entry),
        available: availablePoints(entry),
        perks: { ...entry.animalPerks },
      })),
      shoulderAlerts: [...alertAuras.entries()].map(([enemy, map]) => ({
        enemy: enemy?.id || enemy?.name || enemy?.def?.label || 'hostile',
        alerts: [...map.keys()],
      })),
      banditBridgeReady: !!banditDeps,
      ambientBridgeReady: !!ambientDeps,
      dialogueBridgeReady: !!dialogueDeps,
    };
  }

  function install() {
    if (installed) {
      patchFarmAnimals(window.FarmAnimals);
      patchFarmPanel(window.FarmPanel);
      ensureAlertFrame();
      return api;
    }
    installed = true;
    patchFarmAnimals(window.FarmAnimals);
    patchFarmPanel(window.FarmPanel);
    hookFutureGlobal('BanditCamps', patchBanditCamps);
    hookFutureGlobal('AmbientDialogue', patchAmbientDialogue);
    hookFutureGlobal('DialogueContent', patchDialogueContent);
    hookFutureGlobal('NpcRapport', patchNpcRapport);
    ensureAlertFrame();
    return api;
  }

  const api = {
    install,
    trees: TREES,
    roleForEntry,
    normalizeEntry,
    xpToNext,
    awardXp,
    spendPoint,
    perkRank,
    spentPoints,
    availablePoints,
    activeEntryForRole,
    rapportMultiplierDetails,
    companionPerceptionMultiplier,
    alertKindsForTarget,
    debugSnapshot,
    renderProgressionPanel,
  };

  window.StableAnimalProgression = api;
  window.__stableAnimalProgressionDebug = debugSnapshot;
})();
