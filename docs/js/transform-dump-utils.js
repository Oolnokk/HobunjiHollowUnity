// Shared local-transform dump utility for the Attack Animation Editor's preview
// and the in-game Pixel Probe, so both can report the exact same fields in the
// exact same format for every node under a given root (avatar body, tool
// holder, hand sockets, head/neck bone, ...) — letting an editor-authored
// preview be diffed node-for-node against what a character actually renders
// with in the live game.
//
// Deliberately has no THREE.js dependency (reads only plain instance
// properties/methods every Object3D already has: position/quaternion/scale/
// children/getWorldPosition) so the exact same code runs unmodified in the
// editor's ESM/import-map Three instance and the game's classic global THREE.
(function (global) {
  'use strict';

  function toDeg(rad) { return rad * 180 / Math.PI; }
  function clamp(value) { return Math.max(-1, Math.min(1, value)); }

  // Same YXZ (pitch=X, yaw=Y, roll=Z) decomposition used throughout the hand/
  // tool authoring code (hand-model-profiles.js's eulerYXZFromQuat, hand-grip-
  // modes.js's copy) — kept independent of any THREE reference for the reason
  // above.
  function eulerYXZFromQuat(q) {
    const x = Number(q?.x) || 0;
    const y = Number(q?.y) || 0;
    const z = Number(q?.z) || 0;
    const w = Number.isFinite(Number(q?.w)) ? Number(q.w) : 1;
    const length = Math.hypot(x, y, z, w) || 1;
    const nx = x / length, ny = y / length, nz = z / length, nw = w / length;
    const m13 = 2 * (nx * nz + ny * nw);
    const m21 = 2 * (nx * ny + nz * nw);
    const m22 = 1 - 2 * (nx * nx + nz * nz);
    const m23 = 2 * (ny * nz - nx * nw);
    const m31 = 2 * (nx * nz - ny * nw);
    const m33 = 1 - 2 * (nx * nx + ny * ny);
    const m11 = 1 - 2 * (ny * ny + nz * nz);
    const pitch = Math.asin(-clamp(m23));
    let yaw, roll;
    if (Math.abs(m23) < 0.9999999) {
      yaw = Math.atan2(m13, m33);
      roll = Math.atan2(m21, m22);
    } else {
      yaw = Math.atan2(-m31, m11);
      roll = 0;
    }
    return { pitch: toDeg(pitch), yaw: toDeg(yaw), roll: toDeg(roll) };
  }

  // Walks the subtree in document order, recording each node's LOCAL position/
  // rotation/scale (i.e. relative to its own immediate parent, exactly what
  // authored offsets in this codebase are always expressed in) plus its world
  // position for cross-referencing between two different scene roots (the
  // editor's preview rig vs. a live game character).
  function dumpSubtree(root, options = {}) {
    if (!root?.isObject3D) return [];
    const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : Infinity;
    const entries = [];
    let index = 0;
    (function walk(node, depth) {
      const i = index++;
      const p = node.position, q = node.quaternion, s = node.scale;
      let worldPosition = null;
      try {
        if (typeof node.getWorldPosition === 'function') {
          const target = new p.constructor();
          node.getWorldPosition(target);
          worldPosition = { x: target.x, y: target.y, z: target.z };
        }
      } catch (_) { /* best-effort — local fields below still stand */ }
      entries.push({
        depth,
        name: node.name || `(unnamed ${node.type || 'Object3D'} #${i})`,
        type: node.type || (node.isMesh ? 'Mesh' : node.isBone ? 'Bone' : node.isGroup ? 'Group' : 'Object3D'),
        visible: node.visible !== false,
        localPosition: { x: p.x, y: p.y, z: p.z },
        localRotationDeg: eulerYXZFromQuat(q),
        localQuaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
        localScale: { x: s.x, y: s.y, z: s.z },
        worldPosition,
      });
      if (depth >= maxDepth) return;
      for (const child of node.children || []) walk(child, depth + 1);
    })(root, 0);
    return entries;
  }

  // Captures one Object3D without walking its children. This is used by the
  // rig-parity reports, where a small, fixed set of semantic transforms is
  // more useful than a complete scene graph. World rotation/scale are
  // included because an innocent-looking unit local scale can still render
  // differently after inheriting a scaled parent.
  function snapshotObject(label, object, options = {}) {
    if (!object?.isObject3D) return null;
    object.updateWorldMatrix?.(true, false);
    const localRotationDeg = eulerYXZFromQuat(object.quaternion);
    let worldPosition = null, worldRotationDeg = null, worldScale = null;
    try {
      worldPosition = object.getWorldPosition(new object.position.constructor());
      const worldQuaternion = object.getWorldQuaternion(new object.quaternion.constructor());
      worldRotationDeg = eulerYXZFromQuat(worldQuaternion);
      worldScale = object.getWorldScale(new object.scale.constructor());
    } catch (_) { /* local values still make the report useful */ }
    return {
      label,
      source: options.source || object.name || object.type || 'Object3D',
      localPosition: { x: object.position.x, y: object.position.y, z: object.position.z },
      localRotationDeg,
      localScale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
      worldPosition: worldPosition ? { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z } : null,
      worldRotationDeg,
      worldScale: worldScale ? { x: worldScale.x, y: worldScale.y, z: worldScale.z } : null,
    };
  }

  function num(value, digits) { return Number(value).toFixed(digits); }

  function formatReport(entries, options = {}) {
    const title = options.title || 'Transform dump';
    const lines = [
      `=== ${title} (${entries.length} node(s)) ===`,
      'local pos/rot are each node relative to its own parent; rotation is pitch/yaw/roll YXZ Euler degrees, matching the rest of this codebase\'s authoring convention.',
    ];
    for (const e of entries) {
      const indent = '  '.repeat(e.depth);
      const pos = `(${num(e.localPosition.x, 4)}, ${num(e.localPosition.y, 4)}, ${num(e.localPosition.z, 4)})`;
      const rot = `P${num(e.localRotationDeg.pitch, 2)}° Y${num(e.localRotationDeg.yaw, 2)}° R${num(e.localRotationDeg.roll, 2)}°`;
      const notUnitScale = Math.abs(e.localScale.x - 1) > 1e-6 || Math.abs(e.localScale.y - 1) > 1e-6 || Math.abs(e.localScale.z - 1) > 1e-6;
      const scale = notUnitScale ? ` scale(${num(e.localScale.x, 3)}, ${num(e.localScale.y, 3)}, ${num(e.localScale.z, 3)})` : '';
      const world = e.worldPosition ? ` world(${num(e.worldPosition.x, 4)}, ${num(e.worldPosition.y, 4)}, ${num(e.worldPosition.z, 4)})` : '';
      const visFlag = e.visible ? '' : ' [hidden]';
      lines.push(`${indent}${e.name} [${e.type}]${visFlag} local=${pos} ${rot}${scale}${world}`);
    }
    return lines.join('\n');
  }

  function tuple(value, digits = 4) {
    if (!value) return '-';
    return `(${num(value.x, digits)}, ${num(value.y, digits)}, ${num(value.z, digits)})`;
  }

  function angles(value) {
    if (!value) return '-';
    return `(X${num(value.pitch ?? value.x, 2)}°, Y${num(value.yaw ?? value.y, 2)}°, Z${num(value.roll ?? value.z, 2)}°)`;
  }

  // Formats editor and runtime rig snapshots field-for-field. Callers may
  // mix snapshotObject() results with virtual runtime anchors, as long as
  // they provide the same local*/world* fields.
  function formatNamedTransformReport(entries, options = {}) {
    const title = options.title || 'Rig transform parity dump';
    const lines = [
      `=== ${title} ===`,
      `actor=${options.actor || '-'} species=${options.species || '-'} gender=${options.gender || '-'} coordinateSpace=${options.coordinateSpace || 'unspecified'}`,
      'local = transform relative to the reported object\'s gameplay/editor parent; world = composed transform after every parent translation/rotation/scale.',
    ];
    for (const entry of entries.filter(Boolean)) {
      lines.push('');
      lines.push(`[${entry.label}] source=${entry.source || '-'}`);
      lines.push(`  local position=${tuple(entry.localPosition)} rotation=${angles(entry.localRotationDeg)} scale=${tuple(entry.localScale, 4)}`);
      lines.push(`  world position=${tuple(entry.worldPosition)} rotation=${angles(entry.worldRotationDeg)} scale=${tuple(entry.worldScale, 4)}`);
    }
    return lines.join('\n');
  }

  global.HobunjiTransformDump = Object.freeze({
    dumpSubtree,
    formatReport,
    eulerYXZFromQuat,
    snapshotObject,
    formatNamedTransformReport,
  });
})(window);

// RawGitHack commit-pinned pages already carry the exact repository SHA in
// their URL. Seed Animation Author's persisted repository settings from that
// SHA before its inline app reads localStorage. If GitHub's commits API later
// returns 403, resolveCommit() then falls back to the same pinned SHA instead
// of silently mixing this HTML with runtime/config files from an older branch.
(function pinAnimationAuthorRepositoryRefToPageSha(global) {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(global.location?.pathname || '')) return;
  const match = (global.location?.pathname || '').match(/^\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/docs\/tools\/animation-author\/(?:index\.html)?$/i);
  if (!match) return;
  const [, owner, repo, sha] = match;
  const storageKey = 'hobunjiNpcPlaneAvatarRepoViewer.source.v1';
  try {
    const prior = JSON.parse(global.localStorage.getItem(storageKey) || 'null') || {};
    global.localStorage.setItem(storageKey, JSON.stringify({
      ...prior,
      owner,
      repo,
      ref: sha,
      docsRoot: prior.docsRoot || 'docs/',
      dbPath: prior.dbPath || 'docs/config/npcs/hobunji-starter-npc-database.json',
    }));
  } catch (_) {}
})(window);

// Animation Author runs the repository's pinned Three.js build, whose
// Object3D predates removeFromParent(). The author cleanup code uses that newer
// convenience method in several wrapper layers. Patch the returned THREE
// namespace once, at its shared loader boundary, instead of duplicating actor
// cleanup or changing any authored rig state.
(function installAnimationAuthorObject3DRemovalCompatibility(global) {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(global.location?.pathname || '')) return;
  const PATCH_ID = 'animation-author-object3d-remove-from-parent-v1';

  function patchThree(THREE) {
    const prototype = THREE?.Object3D?.prototype;
    if (!prototype || typeof prototype.removeFromParent === 'function') return !!prototype;
    Object.defineProperty(prototype, 'removeFromParent', {
      configurable: true,
      writable: true,
      value: function removeFromParentCompatibility() {
        if (this.parent && typeof this.parent.remove === 'function') this.parent.remove(this);
        return this;
      },
    });
    return true;
  }

  function wrapLoader() {
    const api = global.PNGPlaneAvatar;
    const loader = api?.loadThreeModules;
    if (typeof loader !== 'function') return false;
    if (loader.__hobunjiObject3DRemovalCompatibility === PATCH_ID) return true;
    const wrapped = async function loadThreeModulesWithObject3DRemovalCompatibility() {
      const modules = await loader.apply(this, arguments);
      patchThree(modules?.THREE);
      return modules;
    };
    wrapped.__hobunjiObject3DRemovalCompatibility = PATCH_ID;
    api.loadThreeModules = wrapped;
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.animationAuthorObject3DRemoval = 'removeFromParent compatibility installed at PNGPlaneAvatar.loadThreeModules';
    return true;
  }

  if (wrapLoader()) return;
  let attempts = 0;
  const timer = global.setInterval(() => {
    if (wrapLoader() || ++attempts >= 600) global.clearInterval(timer);
  }, 50);
})(window);

// Older Animation Author normalizers can synthesize hand shoulders from the
// V15.23 shoulder-perch defaults and then publish those generated values back
// into the mutable runtime mirror. Repair only those exact historical
// fingerprints from the immutable attachment-rig master. Arbitrary authored
// shoulder edits remain untouched.
(function installAnimationAuthorCanonicalShoulderRepair(global) {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(global.location?.pathname || '')) return;

  const PATCH_ID = 'animation-author-canonical-shoulder-repair-v1';
  const SCHEMA = 'hobunji.attachment-rig-profiles.v10';
  const LEGACY_V1523_PERCHES = Object.freeze({
    'engh-sho::male': [-0.2823783104116402, 0.5175336815283819, 0],
    'mao-ao::male': [-0.29650716367602115, 0.6947557240731601, 0],
    'mao-ao::female': [-0.22083596137467643, 0.6289206407533765, 0],
    'rakakoan::male': [-0.1653843922303157, 0.4130876873583539, 0],
    'kenkari::male': [-0.18055321970300925, 0.37969897363327487, 0],
    'kenkari::female': [-0.13819980616286182, 0.29929878500014695, 0],
    'tletingan::female': [-0.18362271672504038, 0.30917820531717677, 0],
    'mashtzarr::male': [-0.3080816783597182, 0.8820611278141346, 0],
    'mashtzarr::female': [-0.21765356423931137, 0.29498687183448, 0],
  });
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const sameNumber = (a, b, epsilon = 1e-9) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= epsilon;
  const samePosition = (position, tuple) => !!position && tuple.every((value, index) => sameNumber(position[['x','y','z'][index]], value));
  const scaledTuple = (tuple, scale) => tuple.map(value => value * scale);

  function staleCharacterFields(live) {
    const stale = [];
    for (const [key, legacyPerch] of Object.entries(LEGACY_V1523_PERCHES)) {
      const profile = live?.characters?.[key];
      if (!profile) continue;
      const lateral = Math.abs(legacyPerch[0]);
      const legacyLeft = [lateral, legacyPerch[1], 0];
      const legacyRight = [-lateral, legacyPerch[1], 0];
      const left = profile.anchors?.leftHandShoulder?.position;
      const right = profile.anchors?.rightHandShoulder?.position;
      const perch = profile.anchors?.shoulderPerch?.position;
      if (samePosition(left, legacyLeft)) stale.push(`${key}.leftHandShoulder`);
      if (samePosition(right, legacyRight)) stale.push(`${key}.rightHandShoulder`);
      if (samePosition(perch, legacyPerch) || samePosition(perch, scaledTuple(legacyPerch, 0.9))) stale.push(`${key}.shoulderPerch`);
    }
    return stale;
  }

  function repairCharacterFingerprints(live) {
    const output = clone(live || {});
    output.characters ||= {};
    const masterCharacters = global.HOBUNJI_ATTACHMENT_RIG_MASTER?.profiles?.characters || {};
    for (const [key, legacyPerch] of Object.entries(LEGACY_V1523_PERCHES)) {
      const profile = output.characters[key];
      const canonical = masterCharacters[key];
      if (!profile || !canonical) continue;
      profile.anchors ||= {};
      const lateral = Math.abs(legacyPerch[0]);
      const legacyLeft = [lateral, legacyPerch[1], 0];
      const legacyRight = [-lateral, legacyPerch[1], 0];
      const leftStale = samePosition(profile.anchors.leftHandShoulder?.position, legacyLeft);
      const rightStale = samePosition(profile.anchors.rightHandShoulder?.position, legacyRight);
      const perchStale = samePosition(profile.anchors.shoulderPerch?.position, legacyPerch)
        || samePosition(profile.anchors.shoulderPerch?.position, scaledTuple(legacyPerch, 0.9));
      if (leftStale && canonical.anchors?.leftHandShoulder) profile.anchors.leftHandShoulder = clone(canonical.anchors.leftHandShoulder);
      if (rightStale && canonical.anchors?.rightHandShoulder) profile.anchors.rightHandShoulder = clone(canonical.anchors.rightHandShoulder);
      if (perchStale && canonical.anchors?.shoulderPerch) profile.anchors.shoulderPerch = clone(canonical.anchors.shoulderPerch);
      if ((leftStale || rightStale) && canonical.handShoulderRule) profile.handShoulderRule = clone(canonical.handShoulderRule);
      if (perchStale && canonical.shoulderPerchRule) profile.shoulderPerchRule = clone(canonical.shoulderPerchRule);
    }
    return output;
  }

  function attachImportFile(input, file) {
    try {
      if (typeof global.DataTransfer === 'function') {
        const transfer = new global.DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        return true;
      }
    } catch (_) {}
    try {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      return true;
    } catch (_) { return false; }
  }

  const status = global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
  status.animationAuthorCanonicalShoulderSync ||= { state: 'waiting', repairs: 0, lastReason: null, stale: [] };
  let queued = false;

  function repairNow(reason = 'manual') {
    queued = false;
    const api = global.MultiAvatarAnimationAuthor;
    const input = global.document?.getElementById('maaImportInput');
    const master = global.HOBUNJI_ATTACHMENT_RIG_MASTER?.profiles;
    if (!api?.getAttachmentRigProfiles || !input || !master || typeof global.File !== 'function') return false;
    const live = api.getAttachmentRigProfiles();
    const stale = staleCharacterFields(live);
    status.animationAuthorCanonicalShoulderSync.stale = [...stale];
    status.animationAuthorCanonicalShoulderSync.lastReason = reason;
    if (!stale.length) {
      status.animationAuthorCanonicalShoulderSync.state = 'clean';
      return false;
    }
    let repaired = repairCharacterFingerprints(live);
    const guard = global.HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD;
    if (guard?.reconcileProfiles) repaired = guard.reconcileProfiles(repaired);
    const payload = guard?.reconcileRigExport
      ? guard.reconcileRigExport({ schema: SCHEMA, profiles: repaired })
      : { schema: SCHEMA, profiles: repaired };
    const file = new global.File([JSON.stringify(payload)], 'hobunji_attachment_rig_character_master_sync.json', { type: 'application/json' });
    if (!attachImportFile(input, file)) {
      status.animationAuthorCanonicalShoulderSync.state = 'file-bridge-unavailable';
      return false;
    }
    status.animationAuthorCanonicalShoulderSync.state = 'repair-dispatched';
    status.animationAuthorCanonicalShoulderSync.repairs += 1;
    status.animationAuthorCanonicalShoulderSync.lastReason = `${reason}: ${stale.join(', ')}`;
    input.dispatchEvent(new Event('change', { bubbles: false }));
    return true;
  }

  function queueRepair(reason) {
    if (queued) return;
    queued = true;
    global.setTimeout(() => repairNow(reason), 0);
  }

  function installWhenReady() {
    if (global.MultiAvatarAnimationAuthor?.getAttachmentRigProfiles && global.document?.getElementById('maaImportInput')) {
      queueRepair('bootstrap');
      return true;
    }
    return false;
  }

  global.document?.addEventListener('click', event => {
    const target = event.target?.closest?.('#maaRigTab, #maaNewBtn');
    if (!target) return;
    if (target.id === 'maaRigTab' || (target.id === 'maaNewBtn' && global.document.body?.dataset?.animationAuthorMode === 'rig')) {
      queueRepair(target.id === 'maaRigTab' ? 'rig-tab-open' : 'rig-new-reset');
    }
  }, true);

  global.HobunjiAnimationAuthorCanonicalShoulderSync = Object.freeze({
    repairNow: () => repairNow('manual-debug'),
    staleFields: () => staleCharacterFields(global.MultiAvatarAnimationAuthor?.getAttachmentRigProfiles?.() || {}),
    getStatus: () => ({ ...status.animationAuthorCanonicalShoulderSync, stale: [...(status.animationAuthorCanonicalShoulderSync.stale || [])] }),
  });

  if (!installWhenReady()) {
    let attempts = 0;
    const timer = global.setInterval(() => {
      if (installWhenReady() || ++attempts >= 600) global.clearInterval(timer);
    }, 50);
  }
  global.__hobunjiAnimationAuthorCanonicalShoulderRepair = PATCH_ID;
})(window);