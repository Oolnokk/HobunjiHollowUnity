// Dates who join in. A date who likes an activity (config/romance-config.js `likes`) doesn't just trail the
// player while they work:
//   fish   You cast → they stand at a nearby spot and fish beside you, (visually) landing a catch now and then.
//   chop   You start felling a tree → they chop the same tree from another side, speeding up your hold.
//   mine   Same, for rocks and ore.
//   pick   A wild plant, mushroom or berry bush comes into sight → they run ahead and pick it for you, exactly as
//          if you had (inventory, Foraging XP, the herb_picked activity event).
// Joining earns Romance as a liked activity (RomanceSystem.scoreCompanionLike) and a temporary skill buff for the
// rest of the date: yield / speed / quality for Foraging and Mining, rare-fish luck for fishing (SkillSystem reads
// buffStacks()/luckStacks() next to its food stacks).
//
// Movement and animation are not new systems: this module hands RomanceSystem.dateTarget a schedule target, and
// the walker plays the player's own chop / mine / fishing-spear timeline through `toolActivity`
// (js/tool-activity-stages.js, drawn by js/npc-held-equipment-v4.js).
(() => {
  'use strict';
  if (window.DateCompanion) return;

  const RAD_TO_DEG = 180 / Math.PI;
  const TOOL_FOR_ACTIVITY = { chop: 'axe', mine: 'pick' };
  const SKILL_FOR_ACTIVITY = { chop: 'foraging', mine: 'mining', pick: 'foraging', fish: 'fishing' };

  let deps = null;
  let timer = 0;
  let task = null; // { kind: 'help'|'fish'|'pick', target, ... } — at most one at a time.
  let buff = null; // { key, skills: { foraging: true, ... } } for the current date only.
  const reserved = new Set(); // Plants already claimed this session ("area:col,row").
  let pickReadyAt = 0;
  const debug = { lastJoin: null, lastPick: null, lastCatch: null };

  const cfg = () => window.SCRATCHBONES_CONFIG?.game?.romance?.companionActivities || {};
  const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const romance = () => window.RomanceSystem || null;
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function init(injected) {
    deps = injected || {};
    window.HobunjiActivityEvents?.on?.(onActivity);
    if (!timer) timer = setInterval(() => { try { tick(); } catch (error) { console.warn('[DateCompanion] tick failed', error); } }, Math.max(100, num(cfg().tickMs, 250)));
    return api;
  }

  // ── Date + walker lookups ─────────────────────────────────────────────
  function activeDate() {
    const date = romance()?.activeDate?.();
    return date && date.mode === 'follow' ? date : null;
  }
  function dateKey(date) { return `${date.npcId}:${date.startHour}`; }
  function walkerFor(date) { return romance()?.helpers?.findWalker?.(date.npcId) || null; }
  function currentArea() { return deps?.normalizeNpcArea?.(deps?.getCurrentArea?.()) || deps?.getCurrentArea?.() || null; }
  function playerPos() { return deps?.getPlayerTilePosition?.() || null; }

  // Does this date like something that qualifies them to join `activity`?
  function likedIds(date, activity) {
    const wanted = cfg().joinLikes?.[activity] || [];
    const likes = romance()?.likesFor?.(date.npcId) || [];
    return wanted.filter(id => likes.includes(id));
  }
  function joins(date, activity) { return likedIds(date, activity).length > 0; }

  function walkable(area, c, r) {
    return window.NpcPathfinding?.isNpcTileWalkable?.(area, c, r) !== false;
  }
  // The rotY (degrees) NpcWalker stations use: the same angle moveToward turns an NPC to when walking toward (dx, dz).
  function facingDeg(dx, dz) { return (-Math.atan2(dz, dx) + Math.PI / 2) * RAD_TO_DEG; }

  // ── Buffs ─────────────────────────────────────────────────────────────
  function grantBuff(date, activity) {
    const skill = SKILL_FOR_ACTIVITY[activity];
    if (!skill) return;
    const key = dateKey(date);
    if (!buff || buff.key !== key) buff = { key, skills: {} };
    if (!buff.skills[skill]) {
      buff.skills[skill] = true;
      deps?.showToast?.(`✨ ${skill === 'fishing' ? 'Fishing luck' : skill === 'mining' ? 'Mining yield & luck' : 'Foraging yield & luck'} — ${romance()?.helpers?.npcName?.(date.npcId) || 'your date'} is joining in.`, true);
    }
  }
  function buffStacks(skillKey) {
    const date = romance()?.activeDate?.();
    if (!date || !buff || buff.key !== dateKey(date) || !buff.skills[skillKey]) return 0;
    return Math.max(0, num(cfg().buffStacks?.[skillKey], 0));
  }
  function luckStacks() { return buffStacks('fishing'); }

  // ── Schedule-target hook (called by RomanceSystem.dateTarget) ─────────
  function targetFor(rec, date) {
    if (!task || !rec || rec.id !== date.npcId || date.mode !== 'follow') return null;
    return task.target ? { ...task.target } : null;
  }
  function ownsPace(npcId) { return !!task && romance()?.activeDate?.()?.npcId === npcId; }

  function setPace(walker, value) { if (walker) walker.catchup = value; }

  // ── Joined woodcutting / mining ───────────────────────────────────────
  function onChargeStart({ tool, col, row } = {}) {
    const activity = tool === 'axe' ? 'chop' : tool === 'pick' ? 'mine' : null;
    const date = activity && activeDate();
    if (!date || !joins(date, activity)) return;
    const walker = walkerFor(date), area = currentArea();
    if (!walker || walker.area !== area) return;
    const player = playerPos();
    const spot = helperSpot(area, col, row, walker, player);
    if (!spot) return;
    const toolDef = window.ToolActivityStages.ACTIVITIES[activity];
    task = {
      kind: 'help', activity, col, row, spot, inPosition: false, startedAt: nowMs(), likeIds: likedIds(date, activity),
      target: {
        area, c: spot.c, r: spot.r, pose: 'stand', activity: activity === 'chop' ? 'chopping with you' : 'mining with you',
        toolKey: toolDef.toolKey, toolActivity: activity, toolFlip: toolDef.flip === true,
        rotY: facingDeg(col - spot.c, row - spot.r), id: `date-${activity}-${col},${row}`,
      },
    };
    setPace(walker, 1.8);
    grantBuff(date, activity);
    debug.lastJoin = { activity, col, row, spot, at: Date.now() };
  }

  // The free tile beside (col,row) that is farthest around the trunk/rock from where the player is working.
  function helperSpot(area, col, row, walker, player) {
    const radius = Math.max(1, Math.floor(num(cfg().helpSearchRadius, 2)));
    const playerAngle = player ? Math.atan2(player.z - (row + 0.5), player.x - (col + 0.5)) : 0;
    let best = null;
    for (let ring = 1; ring <= radius && !best; ring += 1) {
      for (let dr = -ring; dr <= ring; dr += 1) for (let dc = -ring; dc <= ring; dc += 1) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const c = col + dc, r = row + dr;
        if (!walkable(area, c, r)) continue;
        if (player && Math.hypot(player.x - (c + 0.5), player.z - (r + 0.5)) < 0.9) continue; // Not on top of the player.
        let apart = Math.abs(Math.atan2(r + 0.5 - (row + 0.5), c + 0.5 - (col + 0.5)) - playerAngle);
        if (apart > Math.PI) apart = 2 * Math.PI - apart;
        const travel = Math.hypot(walker.root.position.x - (c + 0.5), walker.root.position.z - (r + 0.5));
        const score = apart * 10 - travel * 0.05; // A different angle wins; a shorter walk breaks ties.
        if (!best || score > best.score) best = { c, r, score };
      }
    }
    return best ? { c: best.c, r: best.r } : null;
  }

  function helpMatches(tool, col, row) {
    return task?.kind === 'help' && TOOL_FOR_ACTIVITY[task.activity] === tool && task.col === col && task.row === row;
  }
  function helpSpeedMultiplier(tool, col, row) {
    return helpMatches(tool, col, row) && task.inPosition ? Math.max(1, num(cfg().helpSpeedMultiplier, 1.6)) : 1;
  }
  function onChargeEnd({ tool, col, row, completed } = {}) {
    if (!helpMatches(tool, col, row)) return;
    const finished = task;
    task = null;
    if (!completed) return;
    // The date counts as having helped even if your axe and level felled it before they got there.
    const likeId = finished.likeIds[0];
    const lines = { chop: 'Timber!', mine: 'Good strike!' };
    const labels = { chop: 'helping fell a tree', mine: 'helping break rock' };
    romance()?.scoreCompanionLike?.(likeId, { line: lines[finished.activity], label: labels[finished.activity] });
  }

  // ── Joined fishing ────────────────────────────────────────────────────
  function fishingAnchor() {
    const state = window.Fishing?.state;
    return state?.active && Number.isFinite(state.anchorWorld?.x) ? state.anchorWorld : null;
  }

  function fishSpot(area, anchor, player, walker) {
    if (!player) return null;
    const min = num(cfg().fishSpotMinTiles, 1.4), max = num(cfg().fishSpotMaxTiles, 4);
    const reach = Math.ceil(max);
    let best = null;
    for (let dr = -reach; dr <= reach; dr += 1) for (let dc = -reach; dc <= reach; dc += 1) {
      const c = Math.floor(player.x) + dc, r = Math.floor(player.z) + dr;
      const toPlayer = Math.hypot(player.x - (c + 0.5), player.z - (r + 0.5));
      if (toPlayer < min || toPlayer > max) continue;
      const toWater = Math.hypot(anchor.x - (c + 0.5), anchor.z - (r + 0.5));
      if (toWater < 1.2 || !walkable(area, c, r)) continue;
      const travel = Math.hypot(walker.root.position.x - (c + 0.5), walker.root.position.z - (r + 0.5));
      const score = toWater + toPlayer * 0.3 + travel * 0.05; // Close to the water, near you, short walk.
      if (!best || score < best.score) best = { c, r, score };
    }
    return best ? { c: best.c, r: best.r } : null;
  }

  function startFishing(date, walker, area, anchor) {
    const spot = fishSpot(area, anchor, playerPos(), walker);
    if (!spot) return;
    const toolDef = window.ToolActivityStages.ACTIVITIES.fish;
    task = {
      kind: 'fish', spot, nextCatchAt: nowMs() + catchDelayMs(), startedAt: nowMs(),
      target: {
        area, c: spot.c, r: spot.r, pose: 'stand', activity: 'fishing with you',
        toolKey: toolDef.toolKey, toolActivity: 'fish', rotY: facingDeg(anchor.x - (spot.c + 0.5), anchor.z - (spot.r + 0.5)),
        id: `date-fish-${spot.c},${spot.r}`,
      },
    };
    setPace(walker, 1.6);
    grantBuff(date, 'fish');
    debug.lastJoin = { activity: 'fish', spot, at: Date.now() };
  }
  function catchDelayMs() {
    const lo = num(cfg().fishCatchSecondsMin, 20), hi = Math.max(lo, num(cfg().fishCatchSecondsMax, 45));
    return (lo + Math.random() * (hi - lo)) * 1000;
  }

  // ── Running ahead to pick wild plants ─────────────────────────────────
  function pickKey(area, plant) { return `${area}:${plant.col},${plant.row}`; }

  function nearestPlant(area, walker, player) {
    const list = deps?.listPickables?.(area) || [];
    const sight = num(cfg().pickSightTiles, 9);
    let best = null;
    for (const plant of list) {
      if (reserved.has(pickKey(area, plant))) continue;
      const toPlayer = Math.hypot(player.x - (plant.col + 0.5), player.z - (plant.row + 0.5));
      if (toPlayer > sight) continue;
      const toWalker = Math.hypot(walker.root.position.x - (plant.col + 0.5), walker.root.position.z - (plant.row + 0.5));
      if (!best || toWalker < best.dist) best = { plant, dist: toWalker };
    }
    return best?.plant || null;
  }

  function startPick(date, walker, area, plant) {
    reserved.add(pickKey(area, plant));
    task = {
      kind: 'pick', plant, key: pickKey(area, plant), startedAt: nowMs(),
      target: { area, c: plant.col, r: plant.row, pose: 'stand', activity: 'picking a plant for you', id: `date-pick-${plant.col},${plant.row}` },
    };
    setPace(walker, num(cfg().pickRunSpeedMultiplier, 2.4));
    debug.lastJoin = { activity: 'pick', col: plant.col, row: plant.row, at: Date.now() };
  }

  function finishPick(date, walker) {
    const finished = task;
    task = null;
    pickReadyAt = nowMs() + num(cfg().pickCooldownSeconds, 2.5) * 1000;
    let result = null;
    try { result = finished.plant.pick(); } catch (error) { console.warn('[DateCompanion] pick failed', error); }
    if (result?.ok === false) return;
    grantBuff(date, 'pick');
    romance()?.helpers?.say?.(walker, 'Got it for you!');
    debug.lastPick = { col: finished.plant.col, row: finished.plant.row, at: Date.now() };
  }

  // ── Tick ──────────────────────────────────────────────────────────────
  function tick() {
    const date = activeDate();
    const walker = date && walkerFor(date);
    const area = currentArea();
    if (!date || !walker || walker.area !== area) {
      if (task?.kind === 'pick') reserved.delete(task.key);
      task = null;
      return;
    }
    if (task && task.target.area !== area) { task = null; return; }

    const anchor = fishingAnchor();
    if (task?.kind === 'fish' && !anchor) task = null; // You stopped fishing; they reel in and follow again.

    if (task) {
      const pos = walker.root.position;
      const dist = Math.hypot(pos.x - (task.target.c + 0.5), pos.z - (task.target.r + 0.5));
      if (task.kind === 'help') {
        task.inPosition = dist <= num(cfg().helpReachTiles, 0.8);
        if (nowMs() - task.startedAt > 60000) task = null; // Charge state lost (e.g. mid-swing area change): never stay stuck.
      } else if (task.kind === 'fish') {
        task.inPosition = dist <= num(cfg().helpReachTiles, 0.8);
        if (task.inPosition) setPace(walker, 1);
        if (task.inPosition && nowMs() >= task.nextCatchAt) {
          task.nextCatchAt = nowMs() + catchDelayMs();
          romance()?.scoreCompanionLike?.('fish_caught', { line: 'Got one!' });
          debug.lastCatch = { at: Date.now() };
        }
      } else if (task.kind === 'pick') {
        if (dist <= num(cfg().pickReachTiles, 0.9)) finishPick(date, walker);
        else if (nowMs() - task.startedAt > 20000) { reserved.delete(task.key); task = null; } // Unreachable: give up on it.
      }
      return;
    }

    if (anchor && joins(date, 'fish')) { startFishing(date, walker, area, anchor); return; }
    if (joins(date, 'pick') && nowMs() >= pickReadyAt) {
      const player = playerPos();
      const plant = player && nearestPlant(area, walker, player);
      if (plant) startPick(date, walker, area, plant);
    }
  }

  function onActivity(event) {
    const date = romance()?.activeDate?.();
    if (!date || event?.type !== 'herb_picked' || !joins(date, 'pick')) return;
    grantBuff(date, 'pick'); // You picked one: they share the luck, same as when they pick for you.
  }

  function reset() { task = null; buff = null; reserved.clear(); }

  const api = {
    init,
    targetFor,
    ownsPace,
    onChargeStart,
    onChargeEnd,
    helpSpeedMultiplier,
    buffStacks,
    luckStacks,
    reset,
    snapshot: () => ({ task: task ? { kind: task.kind, activity: task.activity || task.kind, inPosition: !!task.inPosition, target: { ...task.target } } : null, buff: buff ? { ...buff, skills: { ...buff.skills } } : null, debug: { ...debug } }),
    _test: { tick, helperSpot, fishSpot, facingDeg, getTask: () => task },
  };
  window.DateCompanion = api;
})();
