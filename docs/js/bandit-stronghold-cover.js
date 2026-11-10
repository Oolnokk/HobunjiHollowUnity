// Physical cover for bandit strongholds. The existing furniture material builder
// renders it, NearbyVolumeCollision handles projectile/LOS height, the existing
// tile-speed collision marker blocks walking, and WorldEvents handles explosions.
// No new ballistic simulation, animation loop, or bespoke texture pipeline.
(() => {
  'use strict';
  if (window.BanditStrongholdCover) return;

  const FIRE_BURN_SECONDS = 2.1; // Heat exposure before ordinary boards crumble; checked on the existing zone/cave ticks.
  const FIRE_TICK_SECONDS = .35; // Limits fire queries to a handful per second, even when called every frame.
  const HEIGHT_BY_KEY = Object.freeze({
    fortifiedLowRail: .95, fortifiedHighCover: 1.88, fortifiedWatchtower: 2.82,
  }); // Shared authored recipe extents bound melee/targetable volume height.
  const recordsByScope = new Map(); // Area id -> Map(coverId, record); cave and exterior scopes are independent.
  let blastUnsubscribe = null; // One WorldEvents listener shared by all loaded stronghold cover.
  let struckUnsubscribe = null; // Lets the existing attack event substrate target a specific breakable object.
  let lastEvent = 'not mounted'; // Mobile-visible diagnostics (no devtools or independent rendering loop).
  let destroyedCount = 0; // Total physical cover removed this session, including blast chains.

  function coverMap(scope) {
    const key = String(scope || '');
    if (!recordsByScope.has(key)) recordsByScope.set(key, new Map());
    return recordsByScope.get(key);
  }

  function freeTile(record) {
    const tile = record.tile; // Saved exact object reference so a scene rebuild cannot clear another map's collision marker.
    if (tile?._banditTentCollisionId === record.collisionId) delete tile._banditTentCollisionId;
    record.tile = null;
  }

  function ensureCollision(record) {
    if (record.externalCollision || record.tile || record.destroyed) return;
    const tile = record.getGrid?.()?.[record.row]?.[record.col];
    if (!tile || (tile._banditTentCollisionId && tile._banditTentCollisionId !== record.collisionId)) return;
    tile._banditTentCollisionId = record.collisionId;
    record.tile = tile;
  }

  function unregister(scope, id) {
    const bucket = recordsByScope.get(String(scope));
    const rec = bucket?.get(String(id));
    if (!rec) return false;
    freeTile(rec);
    rec.target?.unregister?.();
    bucket.delete(String(id));
    if (!bucket.size) recordsByScope.delete(String(scope));
    return true;
  }

  function forgetScope(scope) {
    const bucket = recordsByScope.get(String(scope));
    if (!bucket) return 0;
    const count = bucket.size;
    for (const rec of bucket.values()) { freeTile(rec); rec.target?.unregister?.(); }
    recordsByScope.delete(String(scope));
    return count;
  }

  function breakCover(record, reason = 'impact', persisted = false) {
    if (!record || record.destroyed) return false;
    record.destroyed = true; // Synchronous guard against repeated WorldEvents blasts or fire in one physics frame.
    if (!persisted) window.CaveSiteSystem?.markFortifiedCoverDestroyed?.(record.saveMapId, record.id);
    freeTile(record);
    record.target?.unregister?.();
    const list = recordsByScope.get(record.scope);
    if (list?.get(record.id) === record) list.delete(record.id);
    if (list && !list.size) recordsByScope.delete(record.scope);
    try { record.onDestroyed?.({ persisted, reason }); }
    catch (error) { window.__farmLog?.('[stronghold-cover] removal failed: ' + String(error), 'warn'); }
    record.mesh?.parent?.remove?.(record.mesh);
    window.NearbyVolumeCollision?.invalidate?.(); // Same semantic-height/LOS/shot path; a collapsed board stops blocking it.
    destroyedCount++;
    lastEvent = record.scope + ' ' + record.id + ' ' + reason;
    return true;
  }

  function struck(payload) {
    const scope = String(payload?.scope || '');
    const bucket = recordsByScope.get(scope);
    if (!bucket?.size) return;
    for (const record of [...bucket.values()]) {
      if (payload.targetId === record.targetId || payload.targetId === record.id) {
        breakCover(record, 'struck');
        return;
      }
    }
  }

  function blast(payload) {
    const scope = String(payload?.scope || '');
    const bucket = recordsByScope.get(scope);
    if (!bucket?.size) return;
    const x = Number(payload.x), z = Number(payload.z);
    const radius = Math.max(0, Number(payload.radius) || 0);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !radius) return;
    for (const record of [...bucket.values()]) {
      if (Math.hypot(record.x - x, record.z - z) > radius + record.radius) continue;
      if (Number.isFinite(Number(payload.y)) && Math.abs(Number(payload.y) - record.y) > 3.3) continue;
      breakCover(record, 'blast'); // Shattercask/witch-bomb blast already handles damage; boards just disappear.
    }
  }

  function ensureEvents() {
    if (typeof window.WorldEvents?.on !== 'function') return false;
    if (!blastUnsubscribe) blastUnsubscribe = window.WorldEvents.on('blast', blast);
    if (!struckUnsubscribe) struckUnsubscribe = window.WorldEvents.on('struck', struck);
    return true;
  }

  function register({ scope, saveMapId = scope, id, key, mesh, col, row, y = 0, getGrid = null, externalCollision = false, onDestroyed } = {}) {
    if (!String(scope || '') || !String(id || '') || !mesh || !Number.isFinite(Number(col)) || !Number.isFinite(Number(row))) return false;
    const height = HEIGHT_BY_KEY[key];
    if (!height) return false; // Stone arches, doors and other unrelated furniture are never breakable boards.
    const bucket = coverMap(scope);
    const coverId = String(id);
    const old = bucket.get(coverId);
    if (old?.mesh === mesh && !old.destroyed) { ensureCollision(old); return true; }
    if (old) unregister(scope, coverId);
    const rec = {
      id:coverId, scope:String(scope), saveMapId:String(saveMapId), key, mesh,
      col:Math.floor(Number(col)), row:Math.floor(Number(row)),
      x:Number(col)+.5, z:Number(row)+.5, y:Number(y) || 0,
      radius:key==='fortifiedWatchtower' ? 1.2 : 1,
      height, burnT:0, fireT:0, destroyed:false,
      getGrid, externalCollision:!!externalCollision, collisionId:'stronghold-cover:'+coverId,
      tile:null, target:null, onDestroyed,
      targetId:'stronghold-cover:'+String(scope)+':'+coverId,
    }; // One per live mesh; only current map & short capped set are sampled for fire.
    bucket.set(coverId, rec);
    if (window.CaveSiteSystem?.fortifiedCoverDestroyed?.(rec.saveMapId, coverId)) {
      breakCover(rec, 'restored', true);
      return false;
    }
    ensureCollision(rec);
    if (window.Targetables?.register && window.THREE?.Box3 && window.THREE?.Vector3) {
      const THREE = window.THREE;
      const box = new THREE.Box3(
        new THREE.Vector3(rec.x-rec.radius,rec.y,rec.z-rec.radius),
        new THREE.Vector3(rec.x+rec.radius,rec.y+rec.height,rec.z+rec.radius));
      rec.target = window.Targetables.register({
        id:rec.targetId, scope:rec.scope, owner:rec,
        caps:['breakable'], position:()=>({x:rec.x,z:rec.z}),
        hitbox:()=>({box,center:box.getCenter(new THREE.Vector3())}),
      });
    }
    ensureEvents();
    window.NearbyVolumeCollision?.invalidate?.();
    lastEvent = rec.scope + ' registered ' + coverId;
    return true;
  }

  function tick(scope, dt = 0) {
    const bucket = recordsByScope.get(String(scope));
    if (!bucket?.size) return 0;
    const elapsed = Math.max(0,Math.min(2,Number(dt)||0));
    if (!elapsed) return 0;
    let removed = 0;
    for (const record of [...bucket.values()]) {
      ensureCollision(record); // The interior grid can become available after its async furniture scene.
      record.fireT += elapsed;
      if (record.fireT < FIRE_TICK_SECONDS) continue;
      const step = record.fireT;
      record.fireT = 0;
      const burning = window.PersistentGroundFire?.intersects?.(record.scope,record.x,record.z,record.radius*.65) === true;
      record.burnT = burning ? record.burnT+step : Math.max(0,record.burnT-step*.5);
      if (record.burnT >= FIRE_BURN_SECONDS && breakCover(record,'fire')) removed++;
    }
    return removed;
  }

  function debugSnapshot(scope=null) {
    const entries=scope==null?[...recordsByScope.entries()]:[[String(scope),recordsByScope.get(String(scope))]];
    return {lastEvent,destroyedCount,blastSubscribed:!!blastUnsubscribe,struckSubscribed:!!struckUnsubscribe,
      active:entries.flatMap(([area,bucket])=>[...(bucket?.values()||[])].map(r=>({
        scope:area,id:r.id,key:r.key,burningSeconds:+r.burnT.toFixed(2),movementBlocked:!!r.tile,externalCollision:r.externalCollision,
      })))};
  }
  window.BanditStrongholdCover=Object.freeze({
    register,unregister,forgetScope,breakCover,tick,debugSnapshot,
    __test:Object.freeze({blast,struck,ensureCollision,HEIGHT_BY_KEY}),
  });
})();