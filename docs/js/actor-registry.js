(() => {
  'use strict';

  // ActorRegistry — the one answer to "who are the players, which one is mine,
  // and what is this entity's stable id?" for a co-op session of up to
  // MAX_PLAYERS (see MULTIPLAYER.md, "Multiplayer-compatible single-player").
  //
  // Today a session has exactly one entry (the local avatar), so everything
  // here is behaviour-neutral. It exists so gameplay code asks the registry
  // instead of reaching for the `player` singleton:
  //
  //   instead of `player`            -> ActorRegistry.getLocalPlayer() / a target
  //   instead of `[player]`          -> ActorRegistry.getPlayers()
  //   instead of distance to player  -> ActorRegistry.nearestPlayer(x, y, { areaId })
  //   instead of `c.master || player`-> ActorRegistry.ownerOf(c)
  //
  // Identity is kept off the entities themselves (WeakMap), so ids never leak
  // into save data, JSON snapshots or structured clones.

  const MAX_PLAYERS = 4;

  const ids = new WeakMap();            // entity -> stable id string
  const byId = new Map();               // id -> WeakRef(entity) | entity (no WeakRef)
  const counters = Object.create(null); // kind -> next serial
  const players = [];                   // live array, shared by reference with game.js/combat deps
  const playerMeta = new WeakMap();     // player entity -> { playerId, local, getArea }
  const listeners = new Set();
  let localPlayer = null;
  let localAreaResolver = null;         // () => areaId of the local avatar (game.js `currentArea`)

  const ref = typeof WeakRef === 'function' ? e => new WeakRef(e) : e => e;
  const deref = r => (r && typeof r.deref === 'function' ? r.deref() : r);

  function remember(id, entity) { byId.set(id, ref(entity)); }

  // Stable id for any entity. `kind` only matters on first assignment
  // ('player', 'hostile', 'npc', 'companion', 'projectile', ...).
  function assignId(entity, kind = 'entity', explicitId = null) {
    if (!entity || (typeof entity !== 'object' && typeof entity !== 'function')) return null;
    const existing = ids.get(entity);
    if (existing) return existing;
    let id = explicitId ? String(explicitId) : null;
    if (!id) {
      counters[kind] = (counters[kind] || 0) + 1;
      id = `${kind}:${counters[kind]}`;
    }
    ids.set(entity, id);
    remember(id, entity);
    return id;
  }
  const idOf = entity => (entity ? ids.get(entity) || null : null);
  function getById(id) {
    const e = deref(byId.get(id));
    if (!e) byId.delete(id);
    return e || null;
  }

  function notify(type, entity) {
    for (const fn of listeners) { try { fn(type, entity, players); } catch (e) { console.warn('[ActorRegistry] listener failed', e); } }
  }
  function onPlayersChanged(fn) { if (typeof fn === 'function') { listeners.add(fn); return () => listeners.delete(fn); } return () => {}; }

  // Adds a player avatar (local or, later, a remote/dummy one). `local: true`
  // marks the avatar this client controls and renders the camera/HUD for.
  function registerPlayer(entity, opts = {}) {
    if (!entity) return null;
    if (playerMeta.has(entity)) return idOf(entity);
    if (players.length >= MAX_PLAYERS) { console.warn('[ActorRegistry] player cap reached', MAX_PLAYERS); return null; }
    const id = assignId(entity, 'player', opts.playerId || null);
    playerMeta.set(entity, { playerId: id, local: opts.local === true, getArea: typeof opts.getArea === 'function' ? opts.getArea : null });
    if (!players.includes(entity)) players.push(entity);
    if (opts.local === true || !localPlayer) localPlayer = opts.local === true ? entity : (localPlayer || null);
    notify('add', entity);
    return id;
  }

  function unregisterPlayer(entity) {
    const i = players.indexOf(entity);
    if (i < 0) return false;
    players.splice(i, 1); // splice, never reassign: callers hold this array by reference
    playerMeta.delete(entity);
    if (localPlayer === entity) localPlayer = null;
    notify('remove', entity);
    return true;
  }

  const getPlayers = () => players;
  const getLocalPlayer = () => localPlayer;
  const isPlayer = entity => !!entity && playerMeta.has(entity);
  const isLocalPlayer = entity => !!entity && entity === localPlayer;
  const playerCount = () => players.length;

  function setLocalAreaResolver(fn) { localAreaResolver = typeof fn === 'function' ? fn : null; }

  // The area an entity is in. A remote player carries its own areaId; the
  // local avatar's `areaId` is not always rewritten on a map swap, so it is
  // resolved through the game's authoritative current area instead.
  function areaOf(entity) {
    if (!entity) return null;
    const meta = playerMeta.get(entity);
    if (meta) {
      if (meta.getArea) return meta.getArea(entity) ?? null;
      if (entity === localPlayer && localAreaResolver) return localAreaResolver() ?? entity.areaId ?? null;
    }
    return entity.areaId ?? null;
  }

  const isAlive = p => Number(p?.health) > 0 && !p._downed && !p._inCutscene; // A player watching a shared cutscene is not a target.

  // Players that are in `areaId` (all of them when areaId is nullish).
  function playersInArea(areaId, opts = {}) {
    const out = [];
    for (const p of players) {
      if (opts.aliveOnly && !isAlive(p)) continue;
      if (areaId != null) { const a = areaOf(p); if (a != null && a !== areaId) continue; }
      out.push(p);
    }
    return out;
  }

  // Nearest player to (x, y). With `areaId`, players known to be elsewhere are
  // skipped; `strict: false` (default) falls back to the nearest player in
  // any area when nobody is in that area, which keeps single-player identical
  // to the old unfiltered behaviour. Flip callers to `strict: true` once a
  // second player can actually be in a different zone.
  function nearestPlayer(x, y, opts = {}) {
    const { areaId = null, strict = false, aliveOnly = false, filter = null } = opts;
    let best = null, bestD = Infinity, fallback = null, fallbackD = Infinity;
    for (const p of players) {
      if (aliveOnly && !isAlive(p)) continue;
      if (filter && !filter(p)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      const a = areaId != null ? areaOf(p) : null;
      if (areaId != null && a != null && a !== areaId) { if (d < fallbackD) { fallback = p; fallbackD = d; } continue; }
      if (d < bestD) { best = p; bestD = d; }
    }
    return best || (strict ? null : fallback);
  }

  // True when any player is in `areaId` (a player whose area is unknown counts: stay conservative).
  // Off-area optimisations (coarse NPC ticks etc.) must use this, not "the local player's area".
  function isAnyPlayerInArea(areaId) {
    for (const p of players) { const a = areaOf(p); if (a == null || a === areaId) return true; }
    return false;
  }

  // Every area that has at least one player in it (the local one included). The host must keep
  // these alive (scene cache, camps, NPC parking); only an area nobody is in may be evicted.
  function occupiedAreas() {
    const out = new Set();
    for (const p of players) { const a = areaOf(p); if (a != null) out.add(a); }
    return out;
  }

  // Distance in px from (x, y) to the nearest player (same-area players first).
  // Simulation LOD (sleep/wake, ecology radius) must use this, never the local
  // player alone: a camp next to a guest has to stay awake on the host.
  function distanceToNearestPlayer(x, y, opts) {
    const p = nearestPlayer(x, y, opts);
    return p ? Math.hypot(p.x - x, p.y - y) : Infinity;
  }

  // Which player an entity belongs to / answers to: a companion's `master`, a
  // projectile's `owner`, or the entity itself when it is a player.
  function ownerOf(entity) {
    if (!entity) return null;
    if (playerMeta.has(entity)) return entity;
    const o = entity.master || entity.owner || null;
    return o && playerMeta.has(o) ? o : (o || null);
  }
  // The owning *player* only (null for NPC-owned things).
  const ownerPlayerOf = entity => { const o = ownerOf(entity); return o && playerMeta.has(o) ? o : null; };

  function getDebug() {
    return {
      max: MAX_PLAYERS,
      players: players.map(p => ({ id: idOf(p), local: p === localPlayer, area: areaOf(p), x: Math.round(p.x), y: Math.round(p.y), health: p.health })),
    };
  }

  window.ActorRegistry = {
    MAX_PLAYERS,
    assignId, idOf, getById,
    registerPlayer, unregisterPlayer, onPlayersChanged,
    getPlayers, getLocalPlayer, isPlayer, isLocalPlayer, playerCount,
    setLocalAreaResolver, areaOf, playersInArea, isAnyPlayerInArea, occupiedAreas, nearestPlayer, distanceToNearestPlayer,
    ownerOf, ownerPlayerOf, getDebug,
  };
})();
