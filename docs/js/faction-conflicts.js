(() => {
  'use strict';

  // Data-driven wilderness faction conflicts.
  //
  // WHO a faction is, WHO it attacks, WHEN it flees and WHETHER it chases a
  // fleeing enemy all live in config/faction-conflicts.json -- adding a faction
  // or changing a rule is a JSON edit, not a code change. Field reference and
  // recipes: docs/architecture/faction-conflicts.md.
  //
  // This module only DECIDES (classification, target choice, flee triggers) and
  // performs the one generic flee action (the existing 'fleeing-low-health'
  // state in game.js's updateHostiles). The 5 Hz pass is driven by
  // porakaneki-camps-runtime.js, which owns the "player's streamed chunk" scope
  // and hands in two adapters: assign(entity, target, relation) and
  // release(entity). Nothing here runs for actors outside the observed chunk.
  const CONFIG_URL = 'config/faction-conflicts.json';
  const FLEEING_STATE = 'fleeing-low-health'; // game.js's existing flee state: beelines to _fleeToX/Y (else home), then goes idle.
  const DEFAULT_TILE = 55; // game.js TILE, used only until init() supplies the real value.

  let deps = {}; // {now(), tileSize(), zoneDef(), homePointFor(entity), areaBounds()} supplied by init().
  let compiled = { byId: new Map(), order: [], problems: [] };
  let configSource = 'none';
  let lastPass = { at: 0, byFaction: {}, targets: 0, fleeing: 0, fleesBegun: 0 };
  const totals = { passes: 0, fleesBegun: 0, fleesEnded: 0 };
  const recentEvents = [];
  const warned = new Set();
  const conditionTypes = Object.create(null);

  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const nowMs = () => deps.now ? deps.now() : (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const tilePx = () => num(deps.tileSize?.(), DEFAULT_TILE);
  const toArray = value => value == null ? [] : (Array.isArray(value) ? value : [value]);
  function record(message) {
    recentEvents.push(String(message));
    if (recentEvents.length > 30) recentEvents.shift();
    window.__farmLog?.(`[faction-conflicts] ${message}`, 'wildlife');
  }
  function warnOnce(message) {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(`[FactionConflicts] ${message}`);
  }

  // ---- config ------------------------------------------------------------
  function compileConfig(raw) {
    const problems = [];
    const defaults = raw?.defaults || {};
    const attackDefaults = { priority: 50, pursueFleeing: false, maxRangeTiles: null, forgivesCrossfire: false, lethal: null, ...(defaults.attack || {}) };
    const fleeDefaults = { conditions: [], destination: 'home', awayTiles: 14, maxSeconds: 20, cooldownSeconds: 10, radiusTiles: 8, fleeOnHit: true, ...(defaults.flee || {}) };
    const byId = new Map(), order = [];
    for (const entry of toArray(raw?.factions)) {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      if (!id) { problems.push('a faction entry has no string "id"'); continue; }
      if (byId.has(id)) { problems.push(`duplicate faction id "${id}"`); continue; }
      const attacks = toArray(entry.attacks).map(rel => ({ ...attackDefaults, ...rel })).filter(rel => {
        if (typeof rel.faction === 'string' && rel.faction) return true;
        problems.push(`${id}: an attacks entry has no "faction"`);
        return false;
      });
      const tiers = new Map(); // priority -> relations; the highest tier with a living candidate wins, nearest candidate within a tier.
      for (const rel of attacks) {
        rel.priority = num(rel.priority, attackDefaults.priority);
        if (!tiers.has(rel.priority)) tiers.set(rel.priority, []);
        tiers.get(rel.priority).push(rel);
      }
      const attackTiers = [...tiers.entries()].sort((a, b) => b[0] - a[0]).map(([, rels]) => rels);
      const flee = { ...fleeDefaults, ...(entry.flee || {}) };
      flee.conditions = toArray(entry.flee?.conditions ?? fleeDefaults.conditions);
      byId.set(id, { id, label: entry.label || id, match: toArray(entry.match), attacks, attackTiers, flee, threats: new Set() });
      order.push(id);
    }
    for (const fac of byId.values()) {
      for (const rel of fac.attacks) {
        if (!byId.has(rel.faction)) { problems.push(`${fac.id}: attacks unknown faction "${rel.faction}"`); continue; }
        fac.threats.add(rel.faction);
        byId.get(rel.faction).threats.add(fac.id); // Whoever I attack, or who attacks me, is a threat for flee conditions.
      }
      for (const cond of fac.flee.conditions) {
        if (!conditionTypes[cond?.type]) problems.push(`${fac.id}: unknown flee condition type "${cond?.type}"`);
        for (const ref of toArray(cond?.against ?? cond?.factions)) if (!byId.has(ref)) problems.push(`${fac.id}: flee condition references unknown faction "${ref}"`);
      }
    }
    return { byId, order, problems };
  }

  function configure(raw, source = 'inline') {
    compiled = compileConfig(raw);
    configSource = source;
    for (const problem of compiled.problems) warnOnce(`config: ${problem}`);
    record(`config ready (${source}): ${compiled.order.join(', ') || 'no factions'}${compiled.problems.length ? ` with ${compiled.problems.length} problem(s)` : ''}`);
    return compiled.problems.slice();
  }

  async function loadConfig() {
    try {
      const response = await fetch(CONFIG_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      configure(await response.json(), CONFIG_URL);
    } catch (error) { console.warn('[FactionConflicts] config failed; wilderness faction conflicts stay inactive:', error); }
  }

  function init(injected = {}) { deps = { ...deps, ...injected }; }

  // ---- classification ----------------------------------------------------
  function normalizedSpeciesKey(entity) {
    return String(entity?.creatureKey || '')
      .replace(/-herd-mother$/, '')
      .replace(/-den-mother$/, '')
      .replace(/-nestmother$/, '')
      .replace(/-alpha$/, '');
  }
  function matchesOne(entity, m, zdef) {
    if (m.flag) return !!entity[m.flag];
    if (m.field) {
      const value = entity[m.field];
      if ('equals' in m) return value === m.equals;
      if (Array.isArray(m.in)) return m.in.includes(value);
      return !!value;
    }
    if (m.zoneSpecies) {
      const key = normalizedSpeciesKey(entity);
      return toArray(m.zoneSpecies).some(list => toArray(zdef?.[list]).some(species => species === key || species === entity.creatureKey));
    }
    if (m.diet) return toArray(m.diet).includes(String(entity.def?.diet || '').toLowerCase());
    if (m.creatureKey) { const keys = toArray(m.creatureKey); return keys.includes(entity.creatureKey) || keys.includes(normalizedSpeciesKey(entity)); }
    if (m.speciesId) return toArray(m.speciesId).includes(entity.rosterRecord?.appearance?.speciesId);
    return false;
  }
  // Explicit assignment wins (entity.factionId, or the older wildlifeRole tag
  // when it names a configured faction); otherwise the first faction in file
  // order with a matching rule. Companions of the player never take part.
  function factionOf(entity) {
    if (!entity || !(entity.health > 0) || entity.isCompanion) return null;
    const explicit = entity.factionId ?? entity.wildlifeRole;
    if (explicit && compiled.byId.has(explicit)) return explicit;
    const zdef = deps.zoneDef?.() || null;
    for (const id of compiled.order) {
      if (compiled.byId.get(id).match.some(m => matchesOne(entity, m, zdef))) return id;
    }
    return null;
  }
  const factionDef = id => compiled.byId.get(id) || null;
  function relation(attackerId, targetId) {
    return factionDef(attackerId)?.attacks.find(rel => rel.faction === targetId) || null;
  }
  const relationBetween = (attacker, target) => relation(factionOf(attacker), factionOf(target));

  // ---- fleeing -----------------------------------------------------------
  function isFleeing(entity) {
    if (!entity) return false;
    const rec = entity._factionFlee;
    if (rec && nowMs() < rec.until) return true;
    return entity.state === FLEEING_STATE; // Includes the native "passive creature was hit" flee.
  }
  const healthRatio = entity => num(entity.maxHealth) > 0 ? num(entity.health) / num(entity.maxHealth) : 1;

  // Shared helpers handed to flee-condition handlers.
  function enemiesWithin(entity, fac, cond, groups) {
    const ids = toArray(cond.against ?? cond.factions);
    const wanted = ids.length ? ids : [...fac.threats];
    const radiusPx = num(cond.radiusTiles, fac.flee.radiusTiles) * tilePx();
    const found = [];
    for (const id of wanted) for (const other of groups.get(id) || []) {
      if (other !== entity && other.health > 0 && Math.hypot(other.x - entity.x, other.y - entity.y) <= radiusPx) found.push(other);
    }
    return found;
  }
  function alliesWithin(entity, fac, cond, groups) {
    const ids = [fac.id, ...toArray(cond.alliedFactions)];
    const radiusPx = num(cond.radiusTiles, fac.flee.radiusTiles) * tilePx();
    let count = 0;
    for (const id of ids) for (const other of groups.get(id) || []) {
      if (other.health > 0 && Math.hypot(other.x - entity.x, other.y - entity.y) <= radiusPx) count++;
    }
    return Math.max(1, count); // The entity itself always counts.
  }

  // Flee condition registry: add a new trigger by registering one function.
  // handler(entity, cond, ctx) -> boolean, ctx = {fac, groups, enemiesWithin, alliesWithin}.
  conditionTypes.healthBelow = (entity, cond, ctx) =>
    healthRatio(entity) <= num(cond.ratio, 0.25) && ctx.enemiesWithin(entity, cond).length >= num(cond.minCount, 1);
  conditionTypes.enemyNearby = (entity, cond, ctx) =>
    ctx.enemiesWithin(entity, cond).length >= num(cond.minCount, 1);
  conditionTypes.outnumbered = (entity, cond, ctx) => {
    const enemies = ctx.enemiesWithin(entity, cond).length;
    return enemies >= num(cond.minEnemies, 2) && enemies / ctx.alliesWithin(entity, cond) >= num(cond.ratio, 2);
  };
  function registerConditionType(name, handler) { conditionTypes[name] = handler; }

  function evaluateFlee(entity, fac, groups, now) {
    if (!fac.flee.conditions.length || now < num(entity._factionFleeLockUntilMs, 0)) return null;
    let seen = []; // The enemies the handler looked at; "away" flees run from these, not from a fixed faction list.
    const ctx = {
      fac, groups,
      enemiesWithin: (e, cond) => (seen = enemiesWithin(e, fac, cond, groups)),
      alliesWithin: (e, cond) => alliesWithin(e, fac, cond, groups),
    };
    for (const cond of fac.flee.conditions) {
      seen = [];
      const handler = conditionTypes[cond?.type];
      if (!handler) { warnOnce(`unknown flee condition type "${cond?.type}"`); continue; }
      if (handler(entity, cond, ctx)) return { reason: cond.reason || cond.type, threats: seen };
    }
    return null;
  }

  function cancelHumanoidActions(entity) {
    if (!entity.isBandit) return;
    entity._banditAction?.cancel?.();
    entity._banditAction = null;
    window.RangedWeapons?.cancelBanditAction?.(entity);
    entity.telegraphState = null;
    entity._banditComboIndex = 0;
    entity._banditLunging = false;
  }
  function beginFlee(entity, fac, trigger, groups, now) {
    const reason = trigger.reason;
    const flee = fac.flee;
    entity._factionFlee = { until: now + num(flee.maxSeconds, 20) * 1000, reason, startedMs: now, factionId: fac.id };
    entity._fleeToX = undefined; entity._fleeToY = undefined;
    if (flee.destination === 'away') {
      let cx = 0, cy = 0, n = 0;
      const from = trigger.threats.length ? trigger.threats : [...fac.threats].flatMap(id => groups.get(id) || []); // Custom conditions that report no enemies fall back to the configured threat factions.
      for (const other of from) {
        if (other !== entity && other.health > 0) { cx += other.x; cy += other.y; n++; }
      }
      let dx = n ? entity.x - cx / n : 0, dy = n ? entity.y - cy / n : 0;
      let len = Math.hypot(dx, dy);
      if (len < 1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); len = 1; }
      let tx = entity.x + (dx / len) * num(flee.awayTiles, 14) * tilePx();
      let ty = entity.y + (dy / len) * num(flee.awayTiles, 14) * tilePx();
      const bounds = deps.areaBounds?.(); // Keep the escape point on the map so a cornered actor runs to the nearest reachable edge instead of at a wall.
      if (bounds && bounds.cols > 2 && bounds.rows > 2) {
        tx = Math.min(Math.max(tx, tilePx() * 1.5), tilePx() * (bounds.cols - 1.5));
        ty = Math.min(Math.max(ty, tilePx() * 1.5), tilePx() * (bounds.rows - 1.5));
      }
      entity._fleeToX = tx; entity._fleeToY = ty;
    } else {
      const home = deps.homePointFor?.(entity); // Porakaneki flee to their camp, not their last planner stop.
      if (home && Number.isFinite(home.x) && Number.isFinite(home.y)) { entity._fleeToX = home.x; entity._fleeToY = home.y; }
    }
    cancelHumanoidActions(entity);
    entity._chunkCombatTarget = null;
    entity.targetCreature = null;
    entity._animalSleeping = false;
    entity.state = FLEEING_STATE;
    totals.fleesBegun++;
    record(`${entity.id || fac.id} (${fac.id}) flees: ${reason} dest=${flee.destination}`);
  }
  function endFlee(entity, fac, now) {
    const flee = fac?.flee;
    delete entity._factionFlee;
    entity._fleeToX = undefined; entity._fleeToY = undefined;
    entity._factionFleeLockUntilMs = now + num(flee?.cooldownSeconds, 10) * 1000;
    if (entity.state === FLEEING_STATE) entity.state = 'idle';
    totals.fleesEnded++;
    record(`${entity.id || '?'} stops fleeing`);
  }
  // game.js calls this the moment a fled actor reaches its destination.
  function noteFleeSettled(entity) {
    if (!entity?._factionFlee) return;
    endFlee(entity, factionDef(entity._factionFlee.factionId), nowMs());
  }
  function stillFleeing(entity, now) {
    const rec = entity._factionFlee;
    return !!rec && now < rec.until && entity.state === FLEEING_STATE; // A state changed by something else also ends the flee.
  }

  // ---- targeting ---------------------------------------------------------
  function selectTarget(entity, fac, groups) {
    for (const tier of fac.attackTiers) {
      let best = null, bestRel = null, bestD = Infinity;
      for (const rel of tier) {
        const maxPx = num(rel.maxRangeTiles, 0) > 0 ? rel.maxRangeTiles * tilePx() : Infinity;
        for (const candidate of groups.get(rel.faction) || []) {
          if (candidate === entity || !(candidate.health > 0)) continue;
          const d = Math.hypot(candidate.x - entity.x, candidate.y - entity.y);
          if (d >= bestD || d > maxPx) continue;
          if (!rel.pursueFleeing && isFleeing(candidate)) continue; // Fleeing enemies are only chased where the relation says so.
          best = candidate; bestRel = rel; bestD = d;
        }
      }
      if (best) return { target: best, relation: bestRel };
    }
    return null;
  }

  // One 5 Hz pass over the actors in the player's streamed chunk.
  //   active:  living hostileObjects inside that chunk
  //   all:     every hostileObject (to release targets we own on actors that left)
  //   assign(entity, target, relation) / release(entity): adapters owned by the caller
  function runPass({ active, all, assign, release }) {
    const now = nowMs();
    const groups = new Map();
    const activeSet = new Set();
    for (const entity of active) {
      const id = factionOf(entity);
      if (!id) continue;
      activeSet.add(entity);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(entity);
    }
    for (const entity of all) {
      if (activeSet.has(entity)) continue;
      if (entity._factionFlee && !stillFleeing(entity, now)) endFlee(entity, factionDef(entity._factionFlee.factionId), now);
      release(entity);
    }
    const summary = { at: now, byFaction: {}, targets: 0, fleeing: 0, fleesBegun: 0 };
    for (const [id, list] of groups) {
      summary.byFaction[id] = list.length;
      const fac = factionDef(id);
      for (const entity of list) {
        if (entity._factionFlee) {
          if (stillFleeing(entity, now)) { summary.fleeing++; release(entity); continue; }
          endFlee(entity, fac, now);
        }
        if (now < num(entity._factionFleeLockUntilMs, 0)) { release(entity); continue; } // Cooling off after a flee.
        if (entity.state === FLEEING_STATE) { release(entity); continue; } // Native flee in progress (e.g. a hunted herbivore).
        const pick = selectTarget(entity, fac, groups);
        const trigger = evaluateFlee(entity, fac, groups, now);
        if (trigger) { beginFlee(entity, fac, trigger, groups, now); summary.fleesBegun++; summary.fleeing++; release(entity); continue; }
        if (pick) { assign(entity, pick.target, pick.relation); summary.targets++; }
        else release(entity);
      }
    }
    totals.passes++;
    lastPass = summary;
    return summary;
  }

  // ---- queries used by game.js / other modules ---------------------------
  // True while the 5 Hz pass has handed this actor a live faction target: the
  // player-oriented leash and line-of-sight checks must not pull it off the fight.
  function hasActiveTarget(entity) {
    const target = entity?._chunkCombatTarget || entity?._chunkFactionEcologyTarget;
    return !!target && target.health > 0 && (!target.areaId || !entity.areaId || target.areaId === entity.areaId);
  }
  // Should `attacker` keep chasing `target` even though it is fleeing?
  function pursuesFleeing(attacker, target) {
    if (attacker?._chunkFactionEcologyTarget !== target) return false; // Only for targets this system assigned; native wildlife AI keeps its own rule.
    return relationBetween(attacker, target)?.pursueFleeing === true;
  }
  // Implicit "I was hit, so I run" for passive creatures (game.js damageCreature).
  function fleesWhenHit(entity) {
    const fac = factionDef(factionOf(entity));
    return fac ? fac.flee.fleeOnHit !== false : true;
  }
  // true/false overrides whether a wildlife-vs-actor hit can kill; null = keep the legacy rule.
  function lethalOverride(attacker, target) {
    const rel = relationBetween(attacker, target);
    return rel && typeof rel.lethal === 'boolean' ? rel.lethal : null;
  }
  // `entity` is the one whose reputation we protect: does `other`'s presence count as crossfire it is not to blame for?
  function forgivesCrossfire(entity, other) {
    return relationBetween(entity, other)?.forgivesCrossfire === true;
  }

  function debugSnapshot() {
    return {
      configSource,
      problems: compiled.problems.slice(),
      factions: compiled.order.map(id => {
        const fac = compiled.byId.get(id);
        return {
          id, label: fac.label,
          attacks: fac.attacks.map(rel => `${rel.faction}@${rel.priority}${rel.pursueFleeing ? '+pursue' : ''}`),
          fleeWhen: fac.flee.conditions.map(cond => cond.type),
        };
      }),
      lastPass: { ...lastPass, byFaction: { ...lastPass.byFaction } },
      totals: { ...totals },
      recentEvents: [...recentEvents],
    };
  }
  function formatDebug() {
    const d = debugSnapshot();
    return `Faction conflicts: src=${d.configSource} factions=${d.factions.map(f => `${f.id}[${f.attacks.join(',') || '-'}]`).join(' ')} lastPass=${JSON.stringify(d.lastPass.byFaction)} targets=${d.lastPass.targets} fleeing=${d.lastPass.fleeing} totals=${JSON.stringify(d.totals)} problems=${d.problems.length} recent=${d.recentEvents.slice(-5).join(' | ')}`;
  }

  if (typeof fetch === 'function' && typeof document !== 'undefined') loadConfig();

  window.FactionConflicts = Object.freeze({
    version: 1,
    init,
    configure,
    loadConfig,
    registerConditionType,
    factionOf,
    relation: relationBetween,
    isFleeing,
    runPass,
    hasActiveTarget,
    pursuesFleeing,
    fleesWhenHit,
    lethalOverride,
    forgivesCrossfire,
    noteFleeSettled,
    debugSnapshot,
    formatDebug,
    __test: Object.freeze({ compileConfig, selectTarget, evaluateFlee, matchesOne, conditionTypes }),
  });
})();
