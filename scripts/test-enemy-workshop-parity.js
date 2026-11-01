const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../docs');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
class Vector3 {
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  sub(other) { this.x -= other.x; this.y -= other.y; this.z -= other.z; return this; }
  dot(other) { return this.x * other.x + this.y * other.y + this.z * other.z; }
  setFromMatrixColumn() {
    this.x = 1;
    this.y = this.z = 0;
    return this;
  }
}
const window = { THREE: { Vector2: class {}, Vector3 } };
vm.runInNewContext(read('js/weather-fx.js'), { window });
const weather = window.WeatherFX;
assert.deepEqual(
  { ...weather.lightingStateFor(12) },
  { r: 255, g: 245, b: 210, a: 0.04 },
);
assert.equal(weather.lightingStateFor(22).a, 0.72);
assert.ok(
  weather.lightingStateFor(12, { isRaining: true, rainStrength: 3 }).a >
    0.04,
);
const ops = [];
const ctx = {
  fillRect(...args) {
    ops.push([
      'fill',
      this.globalCompositeOperation,
      this.fillStyle,
      ...args,
    ]);
  },
  createRadialGradient(...args) {
    const stops = [];
    ops.push(['gradient', args, stops]);
    return {
      addColorStop(...stop) {
        stops.push(stop);
      },
    };
  },
  beginPath() {},
  arc() {},
  fill() {
    ops.push(['light', this.globalCompositeOperation]);
  },
};
weather.drawSkyTint(ctx, 980, 600, weather.lightingStateFor(12));
assert.equal(ops[0][1], 'screen');
weather.drawSkyTint(ctx, 980, 600, weather.lightingStateFor(22));
assert.equal(ops[1][1], 'multiply');
weather.drawFurnitureLightMasks({
  lctx: ctx,
  camera: {
    matrixWorld: {}, near: 0.1, far: 1000,
    getWorldPosition(target) { return target.set(0, 0, 0); },
    getWorldDirection(target) { return target.set(0, 0, 1); },
  },
  getThreeRect: () => ({ width: 980, height: 600 }),
  worldToOverlay: (x, y, z) => ({ x: x * 100, y: z * 100, visible: true }),
  getFurnitureLightSources: () => [
    {
      x: 1,
      y: 2,
      z: 3,
      distance: 0.65,
      intensity: 3.5,
      color: { r: 127, g: 0, b: 255 },
    },
  ],
});
assert.equal(ops.filter((o) => o[0] === 'gradient')[0][1][5], 65);
assert.ok(ops.some((o) => o[0] === 'light' && o[1] === 'destination-out'));
assert.ok(ops.some((o) => o[0] === 'light' && o[1] === 'source-over'));

// A mixed avatar root must retain GLB shell eligibility after the PNG depth pass registers it.
vm.runInNewContext(read('js/png-plane-outline-occluder.js'), { window });
function mesh(data = {}, role = null) {
  return {
    isMesh: true,
    userData: data,
    material: { userData: role ? { hobunjiHandRole: role } : {} },
    layers: {
      mask: 3,
      enable(n) {
        this.mask |= 1 << n;
      },
      disable(n) {
        this.mask &= ~(1 << n);
      },
    },
  };
}
const portrait = mesh(),
  hand = mesh({ hobunjiProceduralHand: true }),
  foot = mesh({ hobunjiProceduralFoot: true }),
  lateHand = mesh({}, 'body');
window.PngPlaneOutlineOccluder.markPngPlane({
  userData: {},
  traverse(fn) {
    [portrait, hand, foot, lateHand].forEach(fn);
  },
});
assert.equal(portrait.layers.mask & 2, 0);
assert.ok(portrait.layers.mask & 16);
for (const limb of [hand, foot, lateHand]) {
  assert.ok(limb.layers.mask & 2);
  assert.equal(limb.userData.isPngPlane, undefined);
  assert.equal(limb.userData.noOutline, undefined);
}
assert.equal(window.PngPlaneOutlineOccluder.snapshot().registered, 1);

// Exercise preview action preparation without a GPU: shared timing, handedness,
// class cast-step selection, and history reconstruction through original factories.
window.HeldActionAnimations = {
  throwFlask: {
    durationS: 1.04,
    windupFrac: 0.49,
    style: 'chop',
    poses: { windup: { x: 1 } },
  },
  counterShield: { poses: {} },
};
window.BanditCombat = {
  naturalSwing: () => ({ anim: 'thrust', pose: {} }),
};
window.Combat = {
  comboData: { swingCombo: [{ windupS: 0.6, strikeS: 0.2, dirSign: -1 }] },
  comboStepPose: () => ({ windup: { x: 2 } }),
};
window.HarlyaoLichCombat = {
  lichCastStep: (_c, id) => ({
    windupS: id === 'summon' ? 0.8 : 0.2,
    strikeS: 0.1,
    dirSign: -1,
  }),
};
const previewSource = read('tools/enemy-loadout-editor/preview.js')
  .replace(/^import .*;\n/gm, '')
  .replace(
    'export class EnemyPreview',
    'globalThis.EnemyPreview = class EnemyPreview',
  );
const context = { window, ThreeModule: { Vector3 }, console };
vm.runInNewContext(previewSource, context);
const preview = new context.EnemyPreview({}, () => {});
preview.actor = { def: { weaponShapeStats: { speed: 2 } } };
preview.play('swingCombo:0');
assert.equal(preview.actor._banditAction.windupS, 0.3);
assert.equal(preview.actor._banditSwingDirSign, -1);
preview.play('throwFlask');
assert.equal(
  preview.actor._banditSwingPose,
  window.HeldActionAnimations.throwFlask.poses,
);
assert.equal(preview.actor._banditAction.windupS, 1.04 * 0.49);
assert.equal(preview.actor._banditAction.strikeS, 1.04 * (1 - 0.49));
preview.play('summon');
assert.equal(preview.actor._banditAction.windupS, 0.8);
assert.equal(preview.actor._banditSwingDirSign, -1);

(async () => {
  const rules = {
    schema: 'test',
    rules: { enemy: { weapons: { hatchet: 1 } } },
  };
  let restoredRules = null,
    restoredRecord = null;
  window.EnemyLoadoutRules = {
    snapshot: () => rules,
    set: (value) => {
      restoredRules = value;
    },
  };
  window.TownMine = {
    restore: (value) => {
      assert.equal(value.townValue, 5);
    },
  };
  window.EnemyLoadoutSourceData = {
    spawn: async (kind, tier, data, options) => {
      restoredRecord = { kind, tier, options };
      return { def: options.defOverride };
    },
  };
  preview.replace = () => {};
  preview.fit = () => {};
  await preview.restore({
    kind: 'maskbound:bulwark',
    tier: 2,
    seed: 'same',
    roster: { maskboundTroop: 'bulwark' },
    definition: { weaponKey: 'warhammer_nativeCopper' },
    context: { townValue: 5 },
  });
  assert.equal(restoredRecord.kind, 'maskbound:bulwark');
  assert.equal(restoredRecord.options.preserveRoster, true);
  assert.equal(restoredRecord.options.roster.maskboundTroop, 'bulwark');
  assert.equal(restoredRules, rules);

  const dataWindow = {};
  const dataContext = {
    window: dataWindow,
    URL,
    document: { baseURI: 'https://game.test/docs/' },
    fetch: async (url) => {
      let p = String(url).replace('https://game.test/docs/', '');
      return {
        ok: true,
        json: async () => JSON.parse(read(p)),
        text: async () => read(p),
      };
    },
  };
  vm.runInNewContext(
    read('tools/enemy-loadout-editor/source-data.js'),
    dataContext,
  );
  const data = await dataWindow.EnemyLoadoutSourceData.load();
  const THREE = {
    BackSide: 1,
    LessDepth: 2,
    UniformsLib: { fog: {} },
    UniformsUtils: { merge: (items) => Object.assign({}, ...items) },
    ShaderMaterial: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
  };
  const shell = data.makeShellMaterial(THREE);
  assert.equal(shell.side, 1);
  assert.equal(shell.depthWrite, false);
  assert.equal(shell.depthFunc, 2);
  assert.equal(
    shell.uniforms.uThickness.value,
    data.outline.shell.thicknessNdc,
  );
  assert.ok(shell.vertexShader.includes('normalMatrix * normal'));
  assert.ok(
    data.rangedItems.crossbow.loadedSprite.endsWith('_loaded.png'),
  );
  assert.equal(data.heldObjectRenderOrder, 1.5);
  assert.equal(typeof data.weaponMeshFactory, 'function');
  class Group {
    constructor() {
      this.children = [];
      this.userData = {};
      this.rotation = {};
    }
    add(child) {
      this.children.push(child);
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.rotation = {};
    }
  }
  const weaponThree = {
    ...THREE,
    DoubleSide: 2,
    Group,
    Mesh,
    PlaneGeometry: class {
      constructor(width, height) {
        this.parameters = { width, height };
      }
    },
    MeshBasicMaterial: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
  };
  const texture = {};
  const definitions = {
    crossbow: { ...data.rangedItems.crossbow, _imgW: 200, _imgH: 400 },
  };
  const makeMesh = data.weaponMeshFactory(
    weaponThree,
    definitions,
    () => texture,
    { crossbow: texture },
    data.heldObjectRenderOrder,
    () => {},
  );
  const weapon = makeMesh('crossbow');
  assert.equal(weapon.userData.itemKey, 'crossbow');
  assert.equal(weapon.userData.toolPlane.renderOrder, 1.5);
  assert.equal(weapon.userData.toolPlane.material.alphaTest, 0.08);
  assert.equal(weapon.userData.toolPlane.material.side, 2);
  assert.equal(weapon.userData.toolPlane.geometry.parameters.height, 1);
  assert.equal(weapon.userData.toolPlane.rotation.x, -Math.PI / 2);

  console.log(
    'Enemy workshop rendering, action and reconstruction parity passed',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
