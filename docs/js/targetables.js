// Targetables — one registry for "things that can be hit", described by what they
// can do (capabilities) rather than what they are (enemy / burden / prop).
//
// Why: combat code used to loop over its own collections (the lunge stop test only
// looked at hostiles; melee only at burdens; blasts at props through a bespoke hook),
// so every new interaction between two systems was new special-case code. Systems
// now describe their hittable things here and askers query by capability.
//
// Core capabilities (free-form strings are allowed; these are the ones in use):
//   'hostile'   an enemy              'burden'   a carriable physical burden
//   'explosive' detonates when hit/blasted   'hangable' suspended from an anchor
//   'breakable' has a fragile/cracked state   'lungeStop' halts a player lunge when
//               it enters the attack cone (so a close hit spends less lunge)
//
// Two ways in:
//   register({ id, scope, caps, hitbox, owner })  a static entry, unregister() to remove
//   addSource(name, scope => iterable of entries)  for systems that already own their
//       collection (burdens, enemies): no double bookkeeping, entries are created lazily.
// An entry is { id, scope, owner, hasCap(cap), hitbox(): {box, center} | null, toActor() }.
// toActor() returns a stand-in target the canonical melee test (Combat.meleeHit) accepts,
// via the `__targetableHitbox` hook in RangedWeapons.actorHitbox, so there is only one
// copy of the cone/box geometry.
//
// Pure registry logic runs under node; the melee test is injected (default Combat.meleeHit).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Targetables = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const CAPS = Object.freeze({ HOSTILE: 'hostile', BURDEN: 'burden', EXPLOSIVE: 'explosive', HANGABLE: 'hangable', BREAKABLE: 'breakable', LUNGE_STOP: 'lungeStop' });

  const entries = new Map();  // id -> entry
  const sources = new Map();  // name -> fn(scope) => iterable of entries
  let meleeHitFn = null;      // test hook; default resolved lazily from Combat
  const tileSize = () => Number(root.Combat?.deps?.TILE) || 64;

  // A stand-in actor for Combat.meleeHit: position in px (fallback path) plus the hitbox provider.
  function makeActor(entry) {
    return {
      id: entry.id, health: 1, areaId: entry.scope, owner: entry.owner,
      get x() { const p = entry.position?.(); return p ? p.x * tileSize() : 0; },
      get y() { const p = entry.position?.(); return p ? p.z * tileSize() : 0; },
      __targetable: entry,
      __targetableHitbox: () => entry.hitbox?.() || null,
    };
  }

  // def: { id, scope?, caps: [..], hitbox: () => ({box, center}), position?: () => ({x, z}) tiles, owner? }
  function register(def) {
    if (!def || def.id == null) throw new Error('Targetables.register requires an id');
    const id = String(def.id), caps = new Set(def.caps || []);
    const entry = {
      id, scope: def.scope ?? null, owner: def.owner ?? null, position: def.position || null,
      hasCap: cap => caps.has(cap), hitbox: def.hitbox || null, _actor: null,
      toActor() { return this._actor || (this._actor = makeActor(this)); },
      unregister() { return entries.get(id) === this && entries.delete(id); },
    };
    entries.set(id, entry);
    return entry;
  }

  function addSource(name, fn) {
    if (typeof fn !== 'function') return () => {};
    sources.set(String(name), fn);
    return () => sources.delete(String(name));
  }

  // Visits entries in `scope` that have `cap`. Return true from fn to stop; returns the entry stopped on.
  // Allocation-free apart from what a source itself yields: safe for per-frame use.
  function forEach(scope, cap, fn) {
    for (const entry of entries.values()) {
      if (scope != null && entry.scope != null && entry.scope !== scope) continue;
      if (cap != null && !entry.hasCap(cap)) continue;
      if (fn(entry) === true) return entry;
    }
    for (const source of sources.values()) {
      let list; try { list = source(scope); } catch (error) { console.warn('[Targetables] source threw', error); continue; }
      if (!list) continue;
      for (const entry of list) {
        if (cap != null && !entry.hasCap(cap)) continue;
        if (fn(entry) === true) return entry;
      }
    }
    return null;
  }
  function query(scope, cap) { const out = []; forEach(scope, cap, e => { out.push(e); }); return out; }

  // First entry with `cap` whose hitbox the melee cone `hitOpts` ({rangePx, halfConeRad, yaw, pitch}) touches.
  function firstInCone(attacker, hitOpts, cap, scope) {
    const hit = meleeHitFn || root.Combat?.meleeHit;
    if (typeof hit !== 'function') return null;
    return forEach(scope, cap, entry => hit(attacker, entry.toActor(), { ...hitOpts, debug: false }) === true);
  }

  const count = () => { let n = entries.size; for (const s of sources.values()) { try { for (const _ of s(null) || []) n++; } catch (_) {} } return n; };
  const clear = () => { entries.clear(); sources.clear(); };
  const setMeleeHit = fn => { meleeHitFn = typeof fn === 'function' ? fn : null; }; // Tests / alternative geometry.
  const debugSnapshot = () => ({ registered: entries.size, sources: [...sources.keys()], total: count() });

  return Object.freeze({ CAPS, register, addSource, forEach, query, firstInCone, makeActor, count, clear, setMeleeHit, debugSnapshot });
});
