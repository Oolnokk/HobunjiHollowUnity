// Precise collision refinement + Pixel Probe diagnostics for Random Test Ruin.
// DynamicSurfaces keeps cheap world AABBs as its broad phase; this module rejects
// AABB false positives against the actual V50 mesh footprints before movement is
// blocked. That prevents invisible rectangular collision around thin/rotated walls
// and around authored furniture Groups whose child geometry occupies only part of
// their aggregate world box.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const SCOPE = 'dev-random-ruin-interior';
  const SECTION = '=== Random Test Ruin collision diagnostics ===';
  const DS = window.DynamicSurfaces;
  const GridTileAccessors = window.GridTileAccessors;
  if (!DS?.addBlockerFilter || !GridTileAccessors || !window.THREE) return;

  const stats = {
    tested: 0,
    accepted: 0,
    rejected: 0,
    wallTested: 0,
    wallRejected: 0,
    solidTested: 0,
    solidRejected: 0,
    pushTested: 0,
    pushRejected: 0,
    lastRejected: null,
  };

  function inRuin() {
    return GridTileAccessors.getCurrentArea?.() === MAP_ID;
  }

  function activeScene() {
    return GridTileAccessors.getActiveScene?.() || null;
  }

  function numericObjectId(recordId, prefix) {
    const text = String(recordId || '');
    if (!text.startsWith(prefix)) return null;
    const value = Number(text.slice(prefix.length));
    return Number.isInteger(value) ? value : null;
  }

  function resolveRecordObject(record) {
    const id = String(record?.id || '');
    const scene = activeScene();
    if (!scene?.getObjectById) return null;
    const prefixes = ['devruin-wall-', 'devruin-solid-', 'devruin-push-'];
    for (const prefix of prefixes) {
      const objectId = numericObjectId(id, prefix);
      if (objectId != null) return scene.getObjectById(objectId) || null;
    }
    return null;
  }

  function matrixFromForeign(object) {
    object?.updateWorldMatrix?.(true, false);
    object?.updateMatrixWorld?.(true);
    const elements = object?.matrixWorld?.elements;
    if (!elements || elements.length < 16) return null;
    return new THREE.Matrix4().fromArray(Array.from(elements, Number));
  }

  function geometryBox(mesh) {
    const geometry = mesh?.geometry;
    if (!geometry) return null;
    try { geometry.computeBoundingBox?.(); } catch (_) {}
    const box = geometry.boundingBox;
    if (!box?.min || !box?.max) return null;
    return {
      minX:Number(box.min.x) || 0,
      maxX:Number(box.max.x) || 0,
      minY:Number(box.min.y) || 0,
      maxY:Number(box.max.y) || 0,
      minZ:Number(box.min.z) || 0,
      maxZ:Number(box.max.z) || 0,
    };
  }

  function horizontalScale(matrix) {
    const e = matrix.elements;
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    return Math.max(1e-5, Math.min(sx || 1, sz || 1));
  }

  // Test a world-space actor disc against one mesh's oriented local footprint.
  // The source can belong to V50's iframe THREE realm; only raw matrix/box numbers
  // cross the boundary and the actual math is done with the game's THREE objects.
  function meshFootprintContains(mesh, x, z, radius) {
    if (!mesh?.isMesh || mesh.userData?.devRuinWallRenderProxy) return false;
    const box = geometryBox(mesh);
    const matrix = matrixFromForeign(mesh);
    if (!box || !matrix) return false;

    const localCenter = new THREE.Vector3(
      (box.minX + box.maxX) * .5,
      (box.minY + box.maxY) * .5,
      (box.minZ + box.maxZ) * .5,
    );
    const worldCenter = localCenter.clone().applyMatrix4(matrix);
    const inverse = matrix.clone().invert();
    const localPoint = new THREE.Vector3(Number(x) || 0, worldCenter.y, Number(z) || 0).applyMatrix4(inverse);
    const localRadius = Math.max(0, Number(radius) || 0) / horizontalScale(matrix);

    return localPoint.x >= box.minX - localRadius && localPoint.x <= box.maxX + localRadius
      && localPoint.z >= box.minZ - localRadius && localPoint.z <= box.maxZ + localRadius;
  }

  function objectFootprintContains(object, x, z, radius, selfOnly = false) {
    if (!object) return true; // Fail safe: keep existing collision if source lookup fails.
    if (selfOnly) return meshFootprintContains(object, x, z, radius);
    let hit = false;
    const visit = mesh => {
      if (!hit && meshFootprintContains(mesh, x, z, radius)) hit = true;
    };
    if (object.traverse) object.traverse(visit);
    else visit(object);
    return hit;
  }

  function classify(record) {
    const id = String(record?.id || '');
    if (id.startsWith('devruin-wall-')) return 'wall';
    if (id.startsWith('devruin-solid-')) return 'solid';
    if (id.startsWith('devruin-push-')) return 'push';
    return '';
  }

  function refineBlocker(record, x, z, context = {}) {
    if (!inRuin() || record?.scope !== SCOPE) return true;
    const kind = classify(record);
    if (!kind) return true;
    const object = resolveRecordObject(record);
    if (!object) return true;

    stats.tested++;
    if (kind === 'wall') stats.wallTested++;
    else if (kind === 'solid') stats.solidTested++;
    else if (kind === 'push') stats.pushTested++;

    const radius = Number(context.radius) || 0;
    const precise = objectFootprintContains(object, x, z, radius, kind === 'wall');
    if (precise) {
      stats.accepted++;
      return true;
    }

    stats.rejected++;
    if (kind === 'wall') stats.wallRejected++;
    else if (kind === 'solid') stats.solidRejected++;
    else if (kind === 'push') stats.pushRejected++;
    stats.lastRejected = {
      id:String(record.id || ''),
      kind,
      objectId:object.id,
      objectName:object.name || '(unnamed)',
      x:+Number(x).toFixed(3),
      z:+Number(z).toFixed(3),
      radius:+radius.toFixed(3),
      bounds:context.bounds || null,
      at:performance.now(),
    };
    return false;
  }

  DS.addBlockerFilter(refineBlocker);

  function playerWorldPosition() {
    const scene = activeScene();
    if (!scene) return null;
    const names = ['player_root', 'player'];
    for (const name of names) {
      const object = scene.getObjectByName?.(name);
      if (!object) continue;
      const matrix = matrixFromForeign(object);
      if (!matrix) continue;
      return new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
    }
    let found = null;
    scene.traverse?.(object => {
      if (found || !(object.userData?.isPlayer || object.userData?.playerCharacter)) return;
      const matrix = matrixFromForeign(object);
      if (matrix) found = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
    });
    return found;
  }

  function distanceToBounds2D(point, bounds) {
    const dx = Math.max(Number(bounds.minX) - point.x, 0, point.x - Number(bounds.maxX));
    const dz = Math.max(Number(bounds.minZ) - point.z, 0, point.z - Number(bounds.maxZ));
    return Math.hypot(dx, dz);
  }

  function nearbySnapshot() {
    if (!inRuin()) return { active:false };
    const point = playerWorldPosition();
    const dynamic = DS.debugSnapshot?.() || {};
    if (!point) return { active:true, player:null, nearest:[], ring:[] };

    const nearest = (dynamic.blockers || [])
      .filter(record => record.scope === SCOPE)
      .map(record => ({ id:record.id, distance:distanceToBounds2D(point, record.bounds), bounds:record.bounds }))
      .filter(record => record.distance <= 2.5)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8)
      .map(record => ({ ...record, distance:+record.distance.toFixed(3) }));

    const ring = [];
    const directions = [
      ['E',1,0], ['NE',Math.SQRT1_2,Math.SQRT1_2], ['N',0,1], ['NW',-Math.SQRT1_2,Math.SQRT1_2],
      ['W',-1,0], ['SW',-Math.SQRT1_2,-Math.SQRT1_2], ['S',0,-1], ['SE',Math.SQRT1_2,-Math.SQRT1_2],
    ];
    for (const distance of [.3, .55, .85]) {
      for (const [label, dx, dz] of directions) {
        const x = point.x + dx * distance;
        const z = point.z + dz * distance;
        const hit = DS.blockerAt(x, z, { radius:.28, actorHeight:1.25 });
        if (hit) ring.push({ direction:label, distance, id:hit.id });
      }
    }

    return {
      active:true,
      player:{ x:+point.x.toFixed(3), z:+point.z.toFixed(3) },
      atPlayer:DS.blockerAt(point.x, point.z, { radius:.28, actorHeight:1.25 })?.id || null,
      nearest,
      ring,
      precision:{ ...stats },
    };
  }

  function appendPixelProbeDiagnostics() {
    const report = document.getElementById('debugProbeResult');
    const text = report?.textContent || '';
    if (!report || !text.startsWith('Pixel Probe report') || text.includes(SECTION) || !inRuin()) return;
    const snap = nearbySnapshot();
    const lines = ['', SECTION];
    lines.push(`Player XZ: ${snap.player ? `${snap.player.x},${snap.player.z}` : 'unavailable'} blockerAtPlayer=${snap.atPlayer || 'none'}`);
    lines.push(`Precision filter: tested=${stats.tested} accepted=${stats.accepted} rejectedAabbFalsePositives=${stats.rejected} walls=${stats.wallRejected}/${stats.wallTested} solids=${stats.solidRejected}/${stats.solidTested} push=${stats.pushRejected}/${stats.pushTested}`);
    if (stats.lastRejected) lines.push(`Last rejected broad-phase blocker: ${stats.lastRejected.id} object=${stats.lastRejected.objectName} @${stats.lastRejected.x},${stats.lastRejected.z} r=${stats.lastRejected.radius}`);
    lines.push(`Nearby ruin blocker AABBs: ${snap.nearest.length ? snap.nearest.map(row => `${row.id}@${row.distance}u`).join(' | ') : 'none within 2.5u'}`);
    lines.push(`Blocked movement samples: ${snap.ring.length ? snap.ring.map(row => `${row.direction}${row.distance}:${row.id}`).join(' | ') : 'none within 0.85u'}`);
    report.textContent = text + lines.join('\n');
  }

  let observer = null;
  function installProbeObserver() {
    const report = document.getElementById('debugProbeResult');
    if (!report || observer) return false;
    observer = new MutationObserver(() => appendPixelProbeDiagnostics());
    observer.observe(report, { childList:true, subtree:true, characterData:true });
    appendPixelProbeDiagnostics();
    return true;
  }

  if (!installProbeObserver()) {
    const timer = setInterval(() => {
      if (installProbeObserver()) clearInterval(timer);
    }, 250);
    setTimeout(() => clearInterval(timer), 15000);
  }

  window.DevRandomRuinCollisionPrecision = Object.freeze({
    refineBlocker,
    snapshot:nearbySnapshot,
    stats:() => ({ ...stats }),
    appendPixelProbeDiagnostics,
  });
})();
