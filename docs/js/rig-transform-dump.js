// Full rig transform dump + diff, shared by the live game (player, town NPCs,
// hostiles) and the Attack Animation Editor so the SAME character + weapon +
// stance can be captured in both and compared node-for-node.
//
// Every node is reported three ways:
//   local  - relative to its own parent (what authored offsets are written in)
//   root   - relative to a floor-anchored, UNSCALED character frame whose +X is
//            the pose's lateral axis, +Z its forward axis and Y up (the same
//            frame tool poses are authored in; see makeFrame). Scene-level
//            siblings such as the weapon holder are reported in this frame too,
//            which is what makes game and editor values directly comparable.
//   world  - composed world transform.
//
// No THREE import: matrices/vectors are built from constructors found on the
// objects themselves, so the same code runs in the editor's ES-module THREE and
// the game's global THREE. Depends on window.HobunjiTransformDump only for the
// shared YXZ Euler convention.
(function (global) {
  'use strict';

  const SCHEMA = 'hobunji.rig-dump.v1';
  const round = (value, digits = 5) => Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
  const vec = v => ({ x: round(v.x), y: round(v.y), z: round(v.z) });
  const quat = q => ({ x: round(q.x, 6), y: round(q.y, 6), z: round(q.z, 6), w: round(q.w, 6) });
  const euler = q => {
    const e = global.HobunjiTransformDump.eulerYXZFromQuat(q);
    return { pitch: round(e.pitch, 3), yaw: round(e.yaw, 3), roll: round(e.roll, 3) };
  };

  function invert(matrix) {
    if (typeof matrix.invert === 'function') return matrix.invert();
    return matrix.getInverse(matrix); // THREE builds older than r123.
  }

  // Floor-anchored, unscaled pose frame. position is the world point on the
  // floor under the character; yawRad is the pose's facing yaw (the vθ the
  // weapon pose code rotates by: local +X = (cos, 0, -sin), +Z = (sin, 0, cos)).
  function makeFrame(sample, position, yawRad) {
    const frame = new sample.constructor();
    frame.name = 'rig_dump_frame';
    frame.position.set(position.x, position.y, position.z);
    frame.rotation.set(0, yawRad || 0, 0);
    frame.updateMatrixWorld(true);
    return frame;
  }

  // Name-based semantic roles shared by every rig that uses the procedural
  // hand / leg attachments; callers may add or override via options.roleOf.
  function roleOfName(name) {
    const n = String(name || '');
    if (/^left_hand_visual$/.test(n)) return 'hand.left';
    if (/^right_hand_visual$/.test(n)) return 'hand.right';
    if (/_procedural_feet$/.test(n)) return 'feet.root';
    if (/^left_foot$/.test(n)) return 'foot.left';
    if (/^right_foot$/.test(n)) return 'foot.right';
    if (/_neck_bone$/.test(n)) return 'neck';
    if (/_head_scale_bone$/.test(n)) return 'head';
    return null;
  }

  function describeGeometry(node) {
    const geometry = node.geometry;
    if (!geometry) return null;
    const out = { type: geometry.type };
    if (geometry.parameters) {
      for (const key of ['width', 'height', 'depth', 'radius']) {
        if (Number.isFinite(geometry.parameters[key])) out[key] = round(geometry.parameters[key]);
      }
    }
    return out;
  }

  function walkTree(treeLabel, treeRoot, ctx, entries) {
    const counts = new Map();
    (function visit(node, parentPath, depth) {
      const base = node.name || `(${node.type || 'Object3D'})`;
      const path = parentPath ? `${parentPath}/${base}` : base;
      const seen = counts.get(path) || 0;
      counts.set(path, seen + 1);
      const uniquePath = seen ? `${path}#${seen + 1}` : path; // Sibling nodes sharing a name stay distinct and stable.
      node.updateWorldMatrix?.(true, false);
      ctx.relative.copy(ctx.frameInverse).multiply(node.matrixWorld).decompose(ctx.rootPosition, ctx.rootQuaternion, ctx.rootScale);
      node.matrixWorld.decompose(ctx.worldPosition, ctx.worldQuaternion, ctx.worldScale);
      const entry = {
        key: `${treeLabel}:${uniquePath}`,
        tree: treeLabel,
        path: uniquePath,
        name: node.name || '',
        type: node.type || 'Object3D',
        depth,
        visible: node.visible !== false,
        role: ctx.roleOf(node) || roleOfName(node.name) || null,
        local: { position: vec(node.position), rotationDeg: euler(node.quaternion), scale: vec(node.scale) },
        root: { position: vec(ctx.rootPosition), rotationDeg: euler(ctx.rootQuaternion), quaternion: quat(ctx.rootQuaternion), scale: vec(ctx.rootScale) },
        world: { position: vec(ctx.worldPosition), rotationDeg: euler(ctx.worldQuaternion), scale: vec(ctx.worldScale) },
      };
      const geometry = describeGeometry(node);
      if (geometry) entry.geometry = geometry;
      entries.push(entry);
      for (const child of node.children || []) visit(child, uniquePath, depth + 1);
    })(treeRoot, '', 0);
  }

  // options:
  //   label, species, gender, context   free-form identification
  //   frame                              Object3D from makeFrame() (required)
  //   trees: [{ label, root }]           subtrees to dump (character body, weapon holder, ...)
  //   anchors: { key: Object3D }         extra named nodes; hands/feet/neck are found by role
  //   roleOf(node)                       optional role override
  function capture(options = {}) {
    const frame = options.frame;
    const trees = (options.trees || []).filter(tree => tree?.root?.isObject3D);
    if (!frame?.isObject3D || !trees.length) return null;
    frame.updateWorldMatrix?.(true, false);
    const sample = frame, M4 = frame.matrixWorld.constructor;
    const ctx = {
      roleOf: options.roleOf || (() => null),
      frameInverse: invert(new M4().copy(frame.matrixWorld)),
      relative: new M4(),
      rootPosition: new sample.position.constructor(), rootQuaternion: new sample.quaternion.constructor(), rootScale: new sample.scale.constructor(),
      worldPosition: new sample.position.constructor(), worldQuaternion: new sample.quaternion.constructor(), worldScale: new sample.scale.constructor(),
    };
    const result = {
      schema: SCHEMA,
      label: options.label || 'rig',
      species: options.species || null,
      gender: options.gender || null,
      context: options.context || {},
      frame: { worldPosition: vec(frame.position), yawDeg: round((frame.rotation.y * 180) / Math.PI, 3) },
      trees: [],
      anchors: {},
    };
    const byNode = new Map();
    for (const tree of trees) {
      const entries = [];
      walkTree(tree.label, tree.root, ctx, entries);
      result.trees.push({ label: tree.label, rootName: tree.root.name || '', entries });
      let index = 0;
      tree.root.traverse?.(node => { byNode.set(node, entries[index++]); });
    }
    const named = options.anchors || {};
    for (const [key, node] of Object.entries(named)) {
      const entry = byNode.get(node);
      if (entry) result.anchors[key] = entry;
    }
    for (const tree of result.trees) {
      for (const entry of tree.entries) {
        if (entry.role && !result.anchors[entry.role] && entry.visible !== undefined) result.anchors[entry.role] = entry;
      }
    }
    return result;
  }

  const t3 = p => `(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`;
  const r3 = r => `P${r.pitch.toFixed(2)}° Y${r.yaw.toFixed(2)}° R${r.roll.toFixed(2)}°`;
  const unit = s => Math.abs(s.x - 1) < 1e-4 && Math.abs(s.y - 1) < 1e-4 && Math.abs(s.z - 1) < 1e-4;

  function formatText(dump, options = {}) {
    if (!dump) return '(no rig to dump)';
    const lines = [
      `=== Rig dump: ${dump.label} species=${dump.species || '-'} gender=${dump.gender || '-'} (${SCHEMA}) ===`,
      `frame: floor=${t3(dump.frame.worldPosition)} yaw=${dump.frame.yawDeg}° (root = floor-anchored, unscaled; +X lateral, +Z forward, Y up)`,
    ];
    if (Object.keys(dump.context || {}).length) lines.push(`context: ${JSON.stringify(dump.context)}`);
    lines.push('', '--- anchors (root-relative) ---');
    for (const [key, entry] of Object.entries(dump.anchors).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${key.padEnd(14)} pos=${t3(entry.root.position)} rot=${r3(entry.root.rotationDeg)} scale=${t3(entry.root.scale)}  [${entry.key}]`);
    }
    if (options.anchorsOnly) return lines.join('\n');
    for (const tree of dump.trees) {
      lines.push('', `--- tree: ${tree.label} (${tree.entries.length} nodes) ---`, 'indent = hierarchy. L = local-to-parent, R = root-relative, W = world.');
      for (const e of tree.entries) {
        const indent = '  '.repeat(e.depth);
        const scale = unit(e.local.scale) ? '' : ` Lscale${t3(e.local.scale)}`;
        const geom = e.geometry ? ` geom=${e.geometry.type}${e.geometry.width ? `(${e.geometry.width}x${e.geometry.height})` : ''}` : '';
        lines.push(`${indent}${e.name || e.path} [${e.type}]${e.visible ? '' : ' [hidden]'}${e.role ? ` <${e.role}>` : ''}${geom}`);
        lines.push(`${indent}  L ${t3(e.local.position)} ${r3(e.local.rotationDeg)}${scale}`);
        lines.push(`${indent}  R ${t3(e.root.position)} ${r3(e.root.rotationDeg)} scale${t3(e.root.scale)}`);
        lines.push(`${indent}  W ${t3(e.world.position)} ${r3(e.world.rotationDeg)} scale${t3(e.world.scale)}`);
      }
    }
    return lines.join('\n');
  }

  function quatAngleDeg(a, b) {
    const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
    return (2 * Math.acos(dot) * 180) / Math.PI;
  }

  // Anchor-by-anchor root-relative comparison of two captures (a - b). Anchors
  // present in only one capture are listed so a missing hand/tool is obvious.
  function diff(a, b, options = {}) {
    const eps = options.epsilon ?? 0.002;
    const rows = [];
    const keys = new Set([...Object.keys(a?.anchors || {}), ...Object.keys(b?.anchors || {})]);
    for (const key of [...keys].sort()) {
      const ea = a.anchors[key], eb = b.anchors[key];
      if (!ea || !eb) { rows.push({ key, missing: ea ? 'second' : 'first' }); continue; }
      const dp = { x: ea.root.position.x - eb.root.position.x, y: ea.root.position.y - eb.root.position.y, z: ea.root.position.z - eb.root.position.z };
      const rotationDeg = quatAngleDeg(ea.root.quaternion, eb.root.quaternion);
      const scaleRatio = { x: ea.root.scale.x / (eb.root.scale.x || 1), y: ea.root.scale.y / (eb.root.scale.y || 1), z: ea.root.scale.z / (eb.root.scale.z || 1) };
      const distance = Math.hypot(dp.x, dp.y, dp.z);
      rows.push({
        key, distance: round(distance), delta: vec(dp), rotationDeg: round(rotationDeg, 3), scaleRatio: vec(scaleRatio),
        a: { position: ea.root.position, rotationDeg: ea.root.rotationDeg, scale: ea.root.scale },
        b: { position: eb.root.position, rotationDeg: eb.root.rotationDeg, scale: eb.root.scale },
        differs: distance > eps || rotationDeg > 0.5 || Math.abs(scaleRatio.x - 1) > 0.005 || Math.abs(scaleRatio.y - 1) > 0.005 || Math.abs(scaleRatio.z - 1) > 0.005,
      });
    }
    return { schema: `${SCHEMA}.diff`, a: a?.label, b: b?.label, rows };
  }

  function formatDiff(result) {
    const lines = [`=== Rig diff: ${result.a}  vs  ${result.b} (root-relative; delta = first - second) ===`];
    for (const row of result.rows) {
      if (row.missing) { lines.push(`${row.key.padEnd(14)} MISSING in ${row.missing}`); continue; }
      lines.push(`${row.key.padEnd(14)} ${row.differs ? 'DIFF' : 'same'} dist=${row.distance.toFixed(4)} d=${t3(row.delta)} rot=${row.rotationDeg.toFixed(2)}° scaleRatio=${t3(row.scaleRatio)}`);
      if (row.differs) {
        lines.push(`${' '.repeat(14)}   first  pos=${t3(row.a.position)} rot=${r3(row.a.rotationDeg)} scale=${t3(row.a.scale)}`);
        lines.push(`${' '.repeat(14)}   second pos=${t3(row.b.position)} rot=${r3(row.b.rotationDeg)} scale=${t3(row.b.scale)}`);
      }
    }
    return lines.join('\n');
  }

  // ── Live-game adapters ────────────────────────────────────────────────
  // game.js hands over just the state these need (see setGameSources); hostiles
  // are read off the entity the combat modules already build.
  let game = null;

  // The weapon sprite is the PlaneGeometry mesh; grip markers and anchor dots are small helper meshes that must not stand in for it.
  const firstMesh = root => {
    let plane = null, any = null;
    root?.traverse?.(node => {
      if (!node.isMesh) return;
      if (!any) any = node;
      if (!plane && node.geometry?.type === 'PlaneGeometry') plane = node;
    });
    return plane || any;
  };

  function captureHostile(entity, options = {}) {
    const avatar = entity?.avatarRef;
    const group = avatar?.group;
    if (!group?.isObject3D) return null;
    const holder = options.holder || entity._banditToolHolder || null;
    const halfHeight = Number(avatar.modelHeight) / 2 || Number(entity.halfHeight) || 0;
    const yaw = (Number(group.rotation.y) || 0) + (Number(entity.def?.aimAngleOffset) || 0); // Inverse of group.rotation.y = vθ - aimAngleOffset in updateCreatureMesh / bandit melee.
    const frame = makeFrame(group, { x: group.position.x, y: group.position.y - halfHeight, z: group.position.z }, yaw);
    const appearance = entity.rosterRecord?.appearance || {};
    const trees = [{ label: 'body', root: group }];
    if (holder) trees.push({ label: 'tool', root: holder });
    const anchors = { 'tool.holder': holder, 'tool.visual': firstMesh(holder), portrait: avatar.frontPlane };
    return capture({
      label: `game hostile ${entity.id || entity.creatureKey || ''}`.trim(),
      species: appearance.speciesId || avatar.speciesId, gender: appearance.gender || avatar.gender,
      context: {
        weaponKey: entity.def?.weaponKey || null, rangedWeaponKey: entity.def?.rangedWeaponKey || null,
        state: entity.state || null, modelWidth: avatar.modelWidth, modelHeight: avatar.modelHeight,
        bodyRigScale: avatar.rigScale || null, groupScale: vec(group.scale),
      },
      frame, trees, anchors,
    });
  }

  function capturePlayer() {
    const mesh = game?.playerMesh?.(), holder = game?.toolHolder?.();
    if (!mesh?.isObject3D) return null;
    const frame = makeFrame(mesh, mesh.position, mesh.rotation.y);
    const identity = game.playerIdentity?.() || {};
    let portrait = null;
    mesh.traverse(node => { if (!portrait && node.name === 'player_avatar') portrait = node; });
    const trees = [{ label: 'body', root: mesh }];
    if (holder) trees.push({ label: 'tool', root: holder });
    return capture({
      label: 'game player', species: identity.speciesId, gender: identity.gender,
      context: { activeTool: game.activeTool?.() ?? null, equippedWeapon: game.equippedWeapon?.() ?? null, heldMode: game.heldMode?.() ?? null, toolVisible: holder ? holder.visible !== false : null, bodyScale: vec(mesh.scale) },
      frame, trees, anchors: { 'tool.holder': holder, 'tool.visual': firstMesh(holder), portrait },
    });
  }

  // The player's body-tilt channels are applied only for the duration of the
  // real render call (PlayerBodyTransformComposer), so capture from inside one.
  function capturePlayerAsRendered() {
    const composer = global.PlayerBodyTransformComposer;
    if (!composer?.captureNextRenderTransforms) return Promise.resolve(capturePlayer());
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(capturePlayer()); } };
      if (!composer.captureNextRenderTransforms(finish)) finish(); else setTimeout(finish, 500);
    });
  }

  function nearestHostiles(limit = 3) {
    const mesh = game?.playerMesh?.();
    if (!mesh) return [];
    return Array.from(game.hostiles?.() || [])
      .filter(c => c?.avatarRef?.group && c.health > 0)
      .map(c => ({ c, d: Math.hypot(c.avatarRef.group.position.x - mesh.position.x, c.avatarRef.group.position.z - mesh.position.z) }))
      .sort((x, y) => x.d - y.d).slice(0, limit).map(x => x.c);
  }

  async function dumpGame(limit = 2) {
    const dumps = [await capturePlayerAsRendered(), ...nearestHostiles(limit).map(c => captureHostile(c))].filter(Boolean);
    return { dumps, text: dumps.map(d => formatText(d)).join('\n\n') };
  }

  global.HobunjiRigDump = {
    schema: SCHEMA,
    makeFrame,
    capture,
    formatText,
    diff,
    formatDiff,
    roleOfName,
    firstMesh,
    captureHostile,
    capturePlayer,
    capturePlayerAsRendered,
    nearestHostiles,
    dumpGame,
    setGameSources(sources) { game = sources || null; },
    debugPlayerLoadout: options => game?.debugPlayerLoadout?.(options),
  };
})(window);
