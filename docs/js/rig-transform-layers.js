// Shared per-node transform ownership for actor rigs.
// Absolute animators (IK, facing, authored stances) supply the base pose; named
// effects contribute removable local position/Euler or quaternion deltas.
// The player's body composer shares this authority's channel registry, while
// retaining its render-only transaction and special world-space body solver.
(function (global) {
  'use strict';
  if (global.RigTransformLayers) return;

  const records = new WeakMap(); // Per-node records never keep a disposed rig alive.
  const axisDeltaScratch = new WeakMap(); // Reused local axis-angle quaternions avoid per-frame allocations.
  const leased = new Set(); // Only active leased slots are held for interruption recovery.
  const channelStores = new Map(); // Shared named stores used by body-root compositor adapters.
  const renderPoses = new WeakMap(); // Reusable snapshots for draw-only root placement.
  let activeRenderPoses = 0; // Cheap early exit for render-time solvers on ordinary frames.
  const absoluteClaims = new WeakMap(); // Node -> named absolute position/quaternion/scale owner; action sessions hold their own references.
  const overlayClaims = new WeakMap(); // Per-node hand overlay records share the absolute claim registry instead of maintaining private dance baselines.
  const overlayStats = { overlayWrites: 0, overlayBaseRefreshes: 0, overlayBaseReuses: 0, overlayReleases: 0, overlayConflicts: 0, overlayPostWrites: 0, solverPublications: 0, solverConflicts: 0 }; // Inspect render-pass ownership without DevTools.

  let activeAbsoluteClaims = 0; // Mobile ownership count used to spot an interrupted actor pose that never released.
  const absoluteOwnerCounts = new Map(); // Action name -> active property-claim count, reported by mobile rig diagnostics.
  function changeAbsoluteOwnerCount(owner, delta) {
    const count = (absoluteOwnerCounts.get(owner) || 0) + delta; // Recomputed only on action acquire/release, never on animation ticks.
    if (count > 0) absoluteOwnerCounts.set(owner, count);
    else absoluteOwnerCounts.delete(owner);
  }
  const absoluteStats = { captures: 0, restored: 0, skipped: 0, conflicts: 0, invalidated: 0 }; // Debug counters for paired-pose handoffs.

  const stats = {
    writes: 0, clears: 0, externalTakeovers: 0, outOfBandWrites: 0,
    invalidInputs: 0, activeLayers: 0, slotsCreated: 0, leasesExpired: 0,
    quaternionWrites: 0, lastOutOfBand: null,
  }; // In-game diagnostics distinguish stale-pose protection from ordinary releases.
  const EPSILON = 1e-7;
  const MAX_LEASE_MS = 5000;

  function nowMs() {
    return global.performance?.now?.() ?? Date.now();
  }

  function valid(node, property, axis) {
    return !!node && (property === 'position' || property === 'rotation' || property === 'scale')
      && (axis === 'x' || axis === 'y' || axis === 'z')
      && Number.isFinite(node[property]?.[axis]);
  }

  function slotsFor(node, create) {
    let slots = records.get(node);
    if (!slots && create) { slots = new Map(); records.set(node, slots); }
    return slots;
  }

  function slotFor(node, property, axis, create) {
    const slots = slotsFor(node, create);
    if (!slots) return null;
    const key = property + '.' + axis;
    let slot = slots.get(key);
    if (!slot && create) {
      slot = { node, key, property, axis, base: node[property][axis],
        applied: node[property][axis], owners: new Map(), quaternion: false };
      slots.set(key, slot);
      stats.slotsCreated++;
    }
    return slot;
  }

  function quaternionValid(q) {
    return !!q && Number.isFinite(q.x) && Number.isFinite(q.y)
      && Number.isFinite(q.z) && Number.isFinite(q.w);
  }

  function quaternionSlot(node, create) {
    if (!quaternionValid(node?.quaternion) || typeof node.quaternion.clone !== 'function'
      || typeof node.quaternion.copy !== 'function' || typeof node.quaternion.multiply !== 'function') return null;
    const slots = slotsFor(node, create);
    if (!slots) return null;
    let slot = slots.get('quaternion');
    if (!slot && create) {
      slot = { node, key: 'quaternion', property: 'quaternion', axis: null,
        base: node.quaternion.clone(), applied: node.quaternion.clone(),
        owners: new Map(), quaternion: true };
      slots.set('quaternion', slot);
      stats.slotsCreated++;
    }
    return slot;
  }

  // q and -q describe the same physical rotation. Angular distance is not
  // inferred from Euler values, which can wrap or change representation.
  function rotationMatches(a, b) {
    const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
    return Math.abs(1 - dot) <= EPSILON;
  }

  function matches(node, slot) {
    return slot.quaternion
      ? rotationMatches(node.quaternion, slot.applied)
      : Math.abs(node[slot.property][slot.axis] - slot.applied) <= EPSILON;
  }

  function captureValue(node, slot) {
    return slot.quaternion ? node.quaternion.clone() : node[slot.property][slot.axis];
  }

  function restoreValue(node, slot, value) {
    if (slot.quaternion) node.quaternion.copy(value);
    else node[slot.property][slot.axis] = value;
  }

  function noteOutsideWrite(slot) {
    stats.externalTakeovers++;
    stats.outOfBandWrites++;
    stats.lastOutOfBand = {
      node: String(slot.node.name || slot.node.type || 'unnamed rig node'),
      property: slot.key,
      owners: Array.from(slot.owners.keys()),
    }; // Shown through RigTransformLayers.getDebug() on mobile.
  }

  function reconcile(node, slot) {
    if (!slot.owners.size) {
      const current = captureValue(node, slot); // Refresh the clean base only when an absolute solver has no competing layer.
      // Without an active effect, the ordinary absolute solver may advance its
      // pose. That clean solved pose is the base for subsequent contributions.
      slot.base = current;
      slot.applied = slot.quaternion ? current.clone() : current;
      return;
    }
    if (matches(node, slot)) return;
    // An unregistered writer changed a node WHILE a layer owned it. Its output
    // may contain an abandoned additive deformation. Never promote that value
    // into the clean baseline. Revert to the last known clean pose, drop all
    // stale claims and report the conflict for migration to an explicit owner.
    noteOutsideWrite(slot);
    stats.activeLayers -= slot.owners.size;
    slot.owners.clear();
    leased.delete(slot);
    restoreValue(node, slot, slot.base);
    slot.applied = slot.quaternion ? slot.base.clone() : slot.base;
  }

  function write(node, slot) {
    if (slot.quaternion) {
      node.quaternion.copy(slot.base);
      for (const layer of slot.owners.values()) node.quaternion.multiply(layer.value);
      slot.applied.copy(node.quaternion);
      stats.quaternionWrites++;
    } else {
      let result = slot.base;
      for (const layer of slot.owners.values()) result += layer.value;
      node[slot.property][slot.axis] = result;
      slot.applied = result;
    }
    stats.writes++;
  }

  function leaseDeadline(options) {
    const ms = Number(options?.leaseMs);
    return Number.isFinite(ms) && ms > 0 ? nowMs() + Math.min(ms, MAX_LEASE_MS) : null;
  }

  function trackLease(slot) {
    for (const layer of slot.owners.values()) {
      if (layer.expiresAtMs !== null) { leased.add(slot); return; }
    }
    leased.delete(slot);
  }

  function hasAbsolutePoseOwner(node, property) {
    return absoluteClaims.get(node)?.has(property) === true; // Scoped choreography/hand presentation always outranks optional additive effects.
  }

  function commitLayer(node, slot, owner, value, options) {
    const held = hasAbsolutePoseOwner(node, slot.property); // Refresh a suspended layer without touching a currently authored joint.
    if (!held) reconcile(node, slot);
    const hadOwner = slot.owners.has(owner);
    const isIdentity = slot.quaternion
      ? rotationMatches(value, { x: 0, y: 0, z: 0, w: 1 })
      : value === 0;
    if (isIdentity) {
      if (slot.owners.delete(owner)) stats.activeLayers--;
    } else {
      if (hadOwner && slot.quaternion) {
        const existing = slot.owners.get(owner);
        existing.value.copy(value); // A frequently refreshed joint sway does not allocate a quaternion every frame.
        existing.expiresAtMs = leaseDeadline(options);
      } else {
        slot.owners.set(owner, { value: slot.quaternion ? value.clone() : value, expiresAtMs: leaseDeadline(options) });
      }
      if (!hadOwner) stats.activeLayers++;
    }
    trackLease(slot);
    if (!held) write(node, slot); // Recompose suspended effects only when the absolute session releases its property.
    return true;
  }

  function setAxis(node, owner, property, axis, offset, options) {
    if (!valid(node, property, axis) || typeof owner !== 'string' || !owner || !Number.isFinite(offset)) {
      stats.invalidInputs++;
      return false;
    }
    // On a real Three.js rig, Euler and quaternion write to the SAME rotation.
    // Route both through one quaternion store to prevent yawn X rotations and
    // drunken quaternion sway from independently capturing each other as base.
    if (property === 'rotation' && node.quaternion?.isQuaternion
      && typeof node.quaternion.clone === 'function' && typeof node.quaternion.set === 'function') {
      const h = offset / 2; // Local axis-angle half-angle for a quaternion contribution.
      const s = Math.sin(h); // Rotation component about the chosen local axis.
      let delta = axisDeltaScratch.get(node); // Same scratch reused across successive authored axis contributions.
      if (!delta) { delta = node.quaternion.clone(); axisDeltaScratch.set(node, delta); }
      delta.set(axis === 'x' ? s : 0, axis === 'y' ? s : 0, axis === 'z' ? s : 0, Math.cos(h));
      return setQuaternion(node, owner, delta, options);
    }
    let slot = slotFor(node, property, axis, false);
    if (!slot && offset === 0) return true;
    if (!slot) slot = slotFor(node, property, axis, true);
    return commitLayer(node, slot, owner, offset, options);
  }

  function setPosition(node, owner, offset, options) {
    const x = Number(offset?.x ?? 0); // X component of this owner's local translation.
    const y = Number(offset?.y ?? 0); // Y component of this owner's local translation.
    const z = Number(offset?.z ?? 0); // Z component of this owner's local translation.
    if (!offset || typeof owner !== 'string' || !owner || !valid(node, 'position', 'x')
      || !valid(node, 'position', 'y') || !valid(node, 'position', 'z')
      || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      stats.invalidInputs++;
      return false;
    }
    setAxis(node, owner, 'position', 'x', x, options);
    setAxis(node, owner, 'position', 'y', y, options);
    setAxis(node, owner, 'position', 'z', z, options);
    return true;
  }

  function setQuaternion(node, owner, delta, options) {
    if (typeof owner !== 'string' || !owner || !quaternionValid(delta)) {
      stats.invalidInputs++;
      return false;
    }
    const slot = quaternionSlot(node, true);
    if (!slot || typeof delta.clone !== 'function') {
      stats.invalidInputs++;
      return false;
    }
    return commitLayer(node, slot, owner, delta, options);
  }

  // An absolute solver that intentionally takes over a managed axis must use
  // this explicit handoff; no unknown mutation can change a claimed baseline.
  function setAbsoluteBase(node, property, axis, value) {
    const ownedProperty = property === 'rotation' && node?.quaternion?.isQuaternion ? 'quaternion' : property; // Euler writes and quaternion writes target the same Three.js absolute rotation claim.
    if (hasAbsolutePoseOwner(node, ownedProperty)) {
      overlayStats.solverConflicts++;
      return false; // A competing absolute handoff cannot silently replace a live scripted pose.
    }
    if (property === 'rotation' && node?.quaternion?.isQuaternion) {
      // An absolute Euler handoff must update the SAME quaternion slot used by
      // additive neck/body rotations. Otherwise the old claimed quaternion
      // can silently reappear when the next additive animator samples it.
      const slot = quaternionSlot(node, true);
      const baseEuler = node.rotation?.clone?.(); // Temporary absolute-pose solver, not a retained live owner.
      if (!slot || !['x', 'y', 'z'].includes(axis) || !Number.isFinite(value)
        || !baseEuler?.setFromQuaternion || !slot.base?.clone) {
        stats.invalidInputs++;
        return false;
      }
      baseEuler.setFromQuaternion(slot.base, node.rotation.order);
      baseEuler[axis] = value;
      const nextQuaternion = slot.base.clone().setFromEuler(baseEuler); // Reconstruct neutral without stale additive layers.
      return setAbsoluteBase(node, 'quaternion', null, nextQuaternion);
    }
    if (property !== 'quaternion' && !valid(node, property, axis)) {
      stats.invalidInputs++;
      return false;
    }
    const slot = property === 'quaternion' ? quaternionSlot(node, true)
      : slotFor(node, property, axis, true);
    if (!slot || !(slot.quaternion ? quaternionValid(value) : Number.isFinite(value))) {
      stats.invalidInputs++;
      return false;
    }
    stats.activeLayers -= slot.owners.size;
    stats.clears += slot.owners.size;
    slot.owners.clear();
    leased.delete(slot);
    slot.base = slot.quaternion ? value.clone() : value;
    write(node, slot);
    return true;
  }

  function clear(node, owner) {
    if (!node || typeof owner !== 'string' || !owner) return false;
    const slots = slotsFor(node, false);
    if (!slots) return false;
    let changed = false;
    for (const slot of slots.values()) {
      if (!slot.owners.has(owner)) continue;
      const held = hasAbsolutePoseOwner(node, slot.property); // A disappearing effect must not cancel a scripted pose.
      if (!held) reconcile(node, slot);
      if (slot.owners.delete(owner)) {
        stats.activeLayers--;
        stats.clears++;
        trackLease(slot);
        if (!held) write(node, slot);
        changed = true;
      }
    }
    return changed;
  }

  function clearAll(node) {
    const slots = node && slotsFor(node, false);
    if (!slots) return false;
    let changed = false;
    for (const slot of slots.values()) {
      const held = hasAbsolutePoseOwner(node, slot.property); // Teardown leaves active absolute solvers untouched.
      if (!held) reconcile(node, slot);
      if (slot.owners.size) {
        stats.clears += slot.owners.size;
        stats.activeLayers -= slot.owners.size;
        slot.owners.clear();
        leased.delete(slot);
        if (!held) write(node, slot);
        changed = true;
      }
    }
    slots.clear();
    return changed;
  }

  function expireStale(timeMs = nowMs()) {
    let removed = 0;
    for (const slot of leased) {
      let slotRemoved = 0; // Only recomposes this node if one of its own owners expired.
      const held = hasAbsolutePoseOwner(slot.node, slot.property); // Lease expiry never resets a captured kiss/dance/impact pose.
      if (!held) reconcile(slot.node, slot);
      for (const [owner, layer] of slot.owners) {
        if (layer.expiresAtMs == null || layer.expiresAtMs > timeMs) continue;
        slot.owners.delete(owner);
        stats.activeLayers--;
        stats.clears++;
        stats.leasesExpired++;
        removed++;
        slotRemoved++;
      }
      trackLease(slot);
      if (slotRemoved && !held) write(slot.node, slot);
    }
    return removed;
  }


  function propertySlots(node, property) {
    const all = slotsFor(node, false); // Existing per-node slot ledger; action transitions do not allocate new owners.
    if (!all) return [];
    if (property === 'quaternion') return [all.get('quaternion')].filter(Boolean);
    if (property !== 'position' && property !== 'scale') return [];
    return ['x', 'y', 'z'].map(axis => all.get(property + '.' + axis)).filter(Boolean);
  }

  function cleanClaimBaseline(node, property) {
    const clean = node[property].clone(); // An absolute action must capture CLEAN IK, not the preceding drunk/yawn additive result.
    for (const slot of propertySlots(node, property)) {
      if (!slot.owners.size) { reconcile(node, slot); continue; }
      if (!matches(node, slot)) reconcile(node, slot); // Reject an out-of-band prior pose before taking over.
      if (!slot.owners.size) continue;
      if (slot.quaternion) clean.copy(slot.base);
      else clean[slot.axis] = slot.base;
    }
    return clean;
  }

  function settleAbsoluteProperty(node, property, restored) {
    for (const slot of propertySlots(node, property)) {
      if (restored) {
        // The owning session restored a clean baseline. Apply only STILL-ACTIVE
        // effects; expired/cleared effects must never reappear after a kiss.
        slot.base = slot.quaternion ? node.quaternion.clone() : node[property][slot.axis];
        write(node, slot);
      } else {
        // A newer action, rig generation, or physics writer took over: discard
        // the old suspended effects without writing anything over its pose.
        stats.activeLayers -= slot.owners.size;
        stats.clears += slot.owners.size;
        slot.owners.clear();
        leased.delete(slot);
        const current = captureValue(node, slot); // Native takeover now supplies the undisputed clean baseline.
        slot.base = current;
        slot.applied = slot.quaternion ? current.clone() : current;
      }
    }
  }

  // Scoped, ABSOLUTE authored pose ownership for paired actions, captures, and
  // choreography. Unlike additive layers these actors move to complete world
  // poses. A session keeps the pose before the action, stamps only the values
  // written by its own solver, and restores only if the rig and its last pose
  // still match. New owners never get overwritten by late cancellation.
  function createAbsoluteSession(owner) {
    if (typeof owner !== 'string' || !owner) return null;
    const entries = []; // Small, stable set of node/property claims captured once at action start.
    const restoredByNode = new WeakMap(); // Release-only ownership evidence for avoiding secondary IK/hand resets on displaced actors.
    let released = false; // Guards repeated cancellation and partial-start cleanup.
    let valid = true; // Turns false on unclaimed nodes, parent replacement, or external takeover.

    function propertyState(node, property) {
      const value = node?.[property];
      return value && typeof value.clone === 'function'
        && typeof value.copy === 'function'
        && ['position', 'quaternion', 'scale'].includes(property)
        ? value : null;
    }

    function equivalent(a, b, property) {
      if (property === 'quaternion') return rotationMatches(a, b);
      return Math.abs(a.x - b.x) <= EPSILON
        && Math.abs(a.y - b.y) <= EPSILON
        && Math.abs(a.z - b.z) <= EPSILON;
    }

    function capture(node, properties = ['position', 'quaternion']) {
      if (released || !valid || !node || !Array.isArray(properties) || !properties.length) return false;
      const seen = new Set(); // Duplicated property names cannot create duplicate claims.
      for (const property of properties) {
        if (seen.has(property)) continue;
        seen.add(property);
        const current = propertyState(node, property);
        if (!current) return false;
        const claims = absoluteClaims.get(node);
        const existing = claims?.get(property);
        if (existing && existing.session !== session) {
          absoluteStats.conflicts++;
          return false; // Never silently steal a locked pose from another active action.
        }
      }
      let claims = absoluteClaims.get(node);
      if (!claims) { claims = new Map(); absoluteClaims.set(node, claims); }
      for (const property of seen) {
        if (claims.has(property)) continue;
        const current = node[property];
        const entry = {
          session, node, property, parent: node.parent || null,
          base: cleanClaimBaseline(node, property), applied: current.clone(),
        }; // The authored baseline and most recent action output stay separate.
        entries.push(entry);
        claims.set(property, entry);
        activeAbsoluteClaims++;
        changeAbsoluteOwnerCount(owner, 1);
        absoluteStats.captures++;
      }
      return true;
    }

    function entryStillOwned(entry, checkAncestors = true) {
      const claim = absoluteClaims.get(entry.node)?.get(entry.property);
      if (claim !== entry || (entry.node.parent || null) !== entry.parent) return false;
      const current = propertyState(entry.node, entry.property);
      if (!current || !equivalent(current, entry.applied, entry.property)) return false;
      if (!checkAncestors) return true;
      // A newly moved/reparented parent invalidates this action's child pose
      // too, even if the child's local quaternion happened not to change.
      // Avoid restoring an old neck or leg below a body now owned by a new action.
      for (let parent = entry.node.parent; parent; parent = parent.parent) {
        const claims = absoluteClaims.get(parent);
        if (!claims) continue;
        for (const ancestor of claims.values()) {
          if (ancestor.session === session && !entryStillOwned(ancestor, false)) return false;
        }
      }
      return true;
    }

    function owns() {
      if (released || !valid) return false;
      for (const entry of entries) {
        if (!entryStillOwned(entry)) {
          valid = false;
          absoluteStats.invalidated++;
          return false;
        }
      }
      return true;
    }

    function canStamp(allowedChangedNodes = null) {
      if (released || !valid) return false;
      // Rendering can legitimately rewrite only an explicit subset of a paired
      // pose. Refuse to adopt an unrelated NPC/root takeover during that pass.
      // Normal simulation still calls stamp() with no restriction after its own solver.
      for (const entry of entries) {
        const value = propertyState(entry.node, entry.property);
        if (!value || absoluteClaims.get(entry.node)?.get(entry.property) !== entry
          || (entry.node.parent || null) !== entry.parent
          || (allowedChangedNodes && !allowedChangedNodes.has(entry.node)
            && !entryStillOwned(entry, false))) {
          valid = false;
          absoluteStats.invalidated++;
          return false;
        }
      }
      return true;
    }

    function stamp(allowedChangedNodes = null) {
      if (!canStamp(allowedChangedNodes)) return false;
      // Check every claim before updating ANY checkpoint: otherwise a failed
      // late render could partially publish the very transforms it must reject.
      for (const entry of entries) entry.applied.copy(entry.node[entry.property]);
      return true;
    }

    function acceptExpectedOverwrites(accept) {
      if (released || !valid || typeof accept !== 'function') return false;
      const changes = []; // Validated native resets can occur between the paired solver and the next simulation tick.
      for (const entry of entries) {
        const current = propertyState(entry.node, entry.property);
        if (!current || absoluteClaims.get(entry.node)?.get(entry.property) !== entry
          || (entry.node.parent || null) !== entry.parent) return false;
        if (!equivalent(current, entry.applied, entry.property)) {
          if (!accept(entry.node, entry.property, current, entry.base, entry.applied)) return false;
          changes.push(entry);
        }
      }
      for (const entry of changes) entry.applied.copy(entry.node[entry.property]); // Rebase the checkpoint only after every reset has passed validation.
      return true;
    }

    function release(options = {}) {
      if (released) return { restored: 0, skipped: 0 };
      released = true;
      let restored = 0, skipped = 0;
      const displacedNodes = new WeakSet(); // Default release keeps all fields of externally replaced nodes under their new owner.
      const reparentedNodes = new WeakSet(); // A moved rig generation never receives its old child's local pose.
      for (const entry of entries) {
        if (!entryStillOwned(entry, false)) displacedNodes.add(entry.node);
        if ((entry.node.parent || null) !== entry.parent) reparentedNodes.add(entry.node);
      } // Snapshot before modifying claims so release order cannot revive sibling or descendant fields.
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]; // Children release before parents so replaced roots also protect nested neck and leg poses.
        const claims = absoluteClaims.get(entry.node);
        if (claims?.get(entry.property) !== entry) { skipped++; continue; }
        const restoreUnaffected = options.restoreUnaffectedProperties === true; // Opt-in for synchronized dances: restore unchanged twists after ordinary root travel resumes.
        let owned = (restoreUnaffected || !displacedNodes.has(entry.node)) && entryStillOwned(entry, false);
        for (let parent = entry.node.parent; owned && parent; parent = parent.parent) {
          if (reparentedNodes.has(parent) || (!restoreUnaffected && displacedNodes.has(parent))) owned = false;
        } // A reparented rig stays untouched; unchanged local rotations may be restored after a position-only reset.
        claims.delete(entry.property);
        activeAbsoluteClaims--;
        changeAbsoluteOwnerCount(owner, -1);
        if (!claims.size) absoluteClaims.delete(entry.node);
        if (owned) {
          entry.node[entry.property].copy(entry.base);
          settleAbsoluteProperty(entry.node, entry.property, true); // Reapply live named effects after authored pose handback.
          let properties = restoredByNode.get(entry.node);
          if (!properties) { properties = new Set(); restoredByNode.set(entry.node, properties); }
          properties.add(entry.property);
          restored++;
        } else {
          settleAbsoluteProperty(entry.node, entry.property, false); // Old additive effects cannot be replayed onto a newer owner.
          skipped++; // A newly authored pose or rebuilt parent must keep its current transform.
        }
      }
      absoluteStats.restored += restored;
      absoluteStats.skipped += skipped;
      entries.length = 0;
      return { restored, skipped };
    }

    function wasRestored(node, property) {
      return released && restoredByNode.get(node)?.has(property) === true;
    }

    const session = Object.freeze({ capture, owns, canStamp, stamp, acceptExpectedOverwrites, release, wasRestored, owner });
    return session;
  }

  // Render-last presentation overlays (NPC dance hands) are a special kind
  // of named pose owner: the ordinary procedural hand driver may overwrite its
  // baseline between renders, and the next same-frame outline/depth pass must
  // NOT add the overlay a second time. The registry stores the last clean
  // driver output and the last composed output for each owned socket.
  // Authoritative procedural hand/leg IK supplies a fresh absolute baseline,
  // without clearing named effects. Only nodes with a registered additive
  // contribution require recomposition: the no-slot path is a cheap WeakMap
  // lookup, not another per-bone hierarchy rebuild in crowded towns.
  function setSolvedBase(node, property, solved) {
    const isRotation = property === 'quaternion';
    const isVector = property === 'position' || property === 'scale';
    const validValue = isRotation ? quaternionValid(solved)
      : isVector && ['x', 'y', 'z'].every(axis => Number.isFinite(solved?.[axis]));
    if (!node || !validValue) { stats.invalidInputs++; return false; }
    const claim = absoluteClaims.get(node)?.get(property);
    if (claim && !claim.overlay) {
      // The solver may already have written directly before invoking this
      // publishing hook. Reinstate the still-owned action pose instead of
      // letting that incidental write poison its next ownership comparison.
      if (claim.applied && node[property]?.copy) node[property].copy(claim.applied);
      overlayStats.solverConflicts++;
      return false;
    }
    const slots = slotsFor(node, false);
    if (isRotation) {
      const slot = slots?.get('quaternion');
      if (slot) {
        slot.base.copy(solved);
        write(node, slot); // Recompose all named quaternion effects over the newly solved IK orientation.
      }
    } else {
      for (const axis of ['x', 'y', 'z']) {
        const slot = slots?.get(property + '.' + axis);
        if (!slot) continue;
        slot.base = solved[axis];
        write(node, slot);
      }
    }
    overlayStats.solverPublications++;
    return true;
  }

  function restoreSolvedBase(node, property) {
    // Only read the canonical IK base on a node with active named offsets.
    // Hover/blended solvers must not interpolate FROM the previous frame's
    // already-composed yawn/drunk/other additive quaternion.
    const slots = node && slotsFor(node, false);
    if (!slots || absoluteClaims.get(node)?.has(property)) return false;
    if (property === 'quaternion') {
      const slot = slots.get('quaternion');
      if (!slot?.owners.size) return false;
      if (!matches(node, slot)) {
        if (rotationMatches(node.quaternion, slot.base)) return true; // A second pre-solve call sees the already clean baseline, not a takeover.
        reconcile(node, slot); // A competing absolute writer displaced this pose; do not quietly reclaim it as ours.
        return false;
      }
      node.quaternion.copy(slot.base);
      return true;
    }
    if (property !== 'position' && property !== 'scale') return false;
    let changed = false;
    for (const axis of ['x', 'y', 'z']) {
      const slot = slots.get(property + '.' + axis);
      if (!slot?.owners.size) continue;
      if (!matches(node, slot)) {
        if (Math.abs(node[property][axis] - slot.base) <= EPSILON) {
          changed = true; // Repeated preparation remains idempotent while the layer is still registered.
          continue;
        }
        reconcile(node, slot); // Unknown IK writes cannot be laundered into the clean solved baseline.
        continue;
      }
      node[property][axis] = slot.base;
      changed = true;
    }
    return changed;
  }

  function captureCleanOverlayBase(node, property, target) {
    target.copy(node[property]); // Reuse one neutral hand-socket scratch per property, not new vectors for every dancer and frame.
    const slots = slotsFor(node, false); // The ordinary hand driver already published these anatomical solver baselines.
    if (!slots) return target;
    if (property === 'quaternion') {
      const slot = slots.get('quaternion'); // Shared quaternion ledger includes all named elbow/yawn/drunken wrist effects.
      if (slot?.owners.size && matches(node, slot)) target.copy(slot.base);
    } else {
      for (const axis of ['x', 'y', 'z']) {
        const slot = slots.get(property + '.' + axis); // Preserve only active, genuinely composed offsets in the neutral snapshot.
        if (slot?.owners.size && matches(node, slot)) target[axis] = slot.base;
      }
    }
    return target;
  }

  function applyPoseOverlay(node, owner, apply) {
    if (!node?.position?.clone || !node?.quaternion?.clone
      || !node.position.copy || !node.quaternion.copy
      || typeof owner !== 'string' || !owner || typeof apply !== 'function') {
      stats.invalidInputs++;
      return false;
    }
    let overlays = overlayClaims.get(node);
    let entry = overlays?.get(owner);
    if (entry && (node.parent || null) !== entry.parent) {
      releasePoseOverlay(node, owner); // A replacement socket's old parent/pose belongs to the previous avatar generation.
      entry = null;
    }
    const claims = absoluteClaims.get(node);
    for (const property of ['position', 'quaternion']) {
      const claim = claims?.get(property);
      if (claim && claim !== entry?.claims[property]) {
        overlayStats.overlayConflicts++;
        return false; // A paired scripted action has priority over NPC hand dance presentation.
      }
    }
    if (!entry) {
      if (!overlays) { overlays = new Map(); overlayClaims.set(node, overlays); }
      const existing = absoluteClaims.get(node) || new Map();
      if (!absoluteClaims.has(node)) absoluteClaims.set(node, existing);
      entry = {
        node, owner, parent: node.parent || null,
        basePos: node.position.clone(), baseQuat: node.quaternion.clone(),
        cleanPos: node.position.clone(), cleanQuat: node.quaternion.clone(),
        appliedPos: node.position.clone(), appliedQuat: node.quaternion.clone(),
        claims: {},
      }; // One retained baseline and one last output per owned socket, reused for every draw.
      captureCleanOverlayBase(node, 'position', entry.cleanPos);
      captureCleanOverlayBase(node, 'quaternion', entry.cleanQuat); // Do not permanently preserve earlier additive effects in an authored dance baseline.
      const session = { owner }; // Shared owner identity permits other scoped sessions to reject conflicting claims.
      for (const property of ['position', 'quaternion']) {
        const claim = { session, overlay: true };
        existing.set(property, claim);
        entry.claims[property] = claim;
        activeAbsoluteClaims++;
        changeAbsoluteOwnerCount(owner, 1);
      }
      overlays.set(owner, entry);
    }
    const positionRefresh = Math.abs(node.position.x - entry.appliedPos.x) > EPSILON
      || Math.abs(node.position.y - entry.appliedPos.y) > EPSILON
      || Math.abs(node.position.z - entry.appliedPos.z) > EPSILON;
    const rotationRefresh = !rotationMatches(node.quaternion, entry.appliedQuat);
    if (positionRefresh) {
      entry.basePos.copy(node.position);
      captureCleanOverlayBase(node, 'position', entry.cleanPos); // Ordinary grip moves update the CLEAN return pose too.
    }
    if (rotationRefresh) {
      entry.baseQuat.copy(node.quaternion);
      captureCleanOverlayBase(node, 'quaternion', entry.cleanQuat);
    }
    if (positionRefresh || rotationRefresh) overlayStats.overlayBaseRefreshes++;
    else overlayStats.overlayBaseReuses++;
    node.position.copy(entry.basePos);
    node.quaternion.copy(entry.baseQuat);
    try {
      apply(node, entry.basePos, entry.baseQuat); // Existing choreography modifies neutral joints without owning another frame loop.
    } catch (error) {
      node.position.copy(entry.basePos);
      node.quaternion.copy(entry.baseQuat);
      releasePoseOverlay(node, owner);
      throw error;
    }
    entry.appliedPos.copy(node.position);
    entry.appliedQuat.copy(node.quaternion);
    overlayStats.overlayWrites++;
    return true;
  }

  function stampPoseOverlay(node, property = 'quaternion') {
    // A later, legitimate forearm-alignment pass may refine the dance pose.
    // Record its final authored quaternion under the SAME named socket owner,
    // so cancellation restores the true neutral hand instead of leaving the
    // last extra forearm twist behind on a culled or unloaded NPC.
    const claim = node && absoluteClaims.get(node)?.get(property);
    if (!claim?.overlay) return false;
    const entry = overlayClaims.get(node)?.get(claim.session?.owner);
    if (!entry || entry.parent !== (node.parent || null) || entry.claims[property] !== claim) return false;
    if (property === 'quaternion') entry.appliedQuat.copy(node.quaternion);
    else if (property === 'position') entry.appliedPos.copy(node.position);
    else return false;
    overlayStats.overlayPostWrites++;
    return true;
  }

  function releasePoseOverlay(node, owner) {
    const overlays = node && overlayClaims.get(node);
    const entry = overlays?.get(owner);
    if (!entry) return false;
    const claims = absoluteClaims.get(node);
    const attached = (node.parent || null) === entry.parent;
    const claimedPosition = claims?.get('position') === entry.claims.position; // A reparented old socket still needs its suspended offsets discarded.
    const claimedRotation = claims?.get('quaternion') === entry.claims.quaternion;
    const ownsPosition = attached && claimedPosition;
    const ownsRotation = attached && claimedRotation;
    // The visible dance base may already contain other additive layers; restore
    // the CLEAN IK pose before recomposing only effects that are still active.
    const restorePosition = ownsPosition && Math.abs(node.position.x - entry.appliedPos.x) <= EPSILON
      && Math.abs(node.position.y - entry.appliedPos.y) <= EPSILON
      && Math.abs(node.position.z - entry.appliedPos.z) <= EPSILON;
    const restoreRotation = ownsRotation && rotationMatches(node.quaternion, entry.appliedQuat);
    if (restorePosition) node.position.copy(entry.cleanPos);
    if (restoreRotation) node.quaternion.copy(entry.cleanQuat);
    for (const property of ['position', 'quaternion']) {
      if (claims?.get(property) !== entry.claims[property]) continue;
      claims.delete(property);
      activeAbsoluteClaims--;
      changeAbsoluteOwnerCount(owner, -1);
    }
    if (claims && !claims.size) absoluteClaims.delete(node);
    if (claimedPosition && !hasAbsolutePoseOwner(node, 'position'))
      settleAbsoluteProperty(node, 'position', restorePosition); // Hand back without layering the old dance twice.
    if (claimedRotation && !hasAbsolutePoseOwner(node, 'quaternion'))
      settleAbsoluteProperty(node, 'quaternion', restoreRotation);
    overlays.delete(owner);
    if (!overlays.size) overlayClaims.delete(node);
    overlayStats.overlayReleases++;
    return true;
  }

  // A draw-only root placement belongs to the render frame's rollback stack.
  // It never takes a simulation claim or changes a solver/layer baseline.
  function applyRenderPose(node, owner, position, quaternion, undo) {
    if (!owner || !node?.isObject3D || node.matrixAutoUpdate === false
      || hasAbsolutePoseOwner(node, 'position') || hasAbsolutePoseOwner(node, 'quaternion')) return false;
    let pose = renderPoses.get(node); // Reuse the same snapshot and rollback through repeated carry frames.
    if (pose?.owner) return false;
    if (!pose) {
      pose = { owner: null, position: node.position.clone(), rotation: node.rotation.clone(),
        quaternion: node.quaternion.clone(), restore() {
        try {
          node.position.copy(pose.position);
          node.rotation.copy(pose.rotation);
          // Euler recovery near gimbal lock can lose a small part of a quaternion.
          // Keep authored Euler values when exact, otherwise restore the native quaternion.
          if (!node.quaternion.equals(pose.quaternion)) node.quaternion.copy(pose.quaternion);
          node.updateWorldMatrix(true, true);
        } finally {
          pose.owner = null;
          activeRenderPoses--;
        }
      } };
      renderPoses.set(node, pose);
    }
    pose.position.copy(node.position);
    pose.rotation.copy(node.rotation);
    pose.quaternion.copy(node.quaternion);
    undo.push(pose.restore);
    pose.owner = owner;
    activeRenderPoses++;
    node.position.copy(position);
    node.quaternion.copy(quaternion);
    node.updateWorldMatrix(true, true);
    return true;
  }

  function renderPoseOwner(node) {
    if (!activeRenderPoses) return null;
    for (let root = node; root; root = root.parent) {
      const owner = renderPoses.get(root)?.owner; // A joint inherits its root's presentation placement.
      if (owner) return owner;
    }
    return null;
  }

  function absoluteOwner(node, property) {
    return absoluteClaims.get(node)?.get(property)?.session?.owner || null;
  }

  function channelStore(name) {
    const key = String(name || '');
    if (!key) return null;
    if (!channelStores.has(key)) channelStores.set(key, new Map());
    return channelStores.get(key);
  }

  const compositor = Object.freeze({
    applyRenderPose, renderPoseOwner,
    setAxis, setPosition, setQuaternion, setAbsoluteBase,
    clear, clearAll, expireStale, channelStore, createAbsoluteSession, absoluteOwner, setSolvedBase, restoreSolvedBase, applyPoseOverlay, stampPoseOverlay, releasePoseOverlay,
    getDebug() {
      return { ...stats, ...absoluteStats, ...overlayStats, activeAbsoluteClaims, activeRenderPoses,
        absoluteOwners: Array.from(absoluteOwnerCounts, ([owner, claims]) => ({ owner, claims })), // Only enumerated on explicit mobile diagnostics.
        leasedSlots: leased.size };
    },
  });
  // Both names are compatibility APIs over ONE ownership authority.
  global.ActorRigCompositor = compositor;
  global.RigTransformLayers = compositor;
})(window);
