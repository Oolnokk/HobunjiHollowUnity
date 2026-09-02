const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Object3D {
  constructor() { this.children = []; this.parent = null; }
  add(...objects) {
    for (const object of objects) {
      if (object) object.parent = this;
      this.children.push(object);
    }
    return this;
  }
  traverse(callback) {
    callback(this);
    for (const child of this.children) child?.traverse?.(callback);
  }
}

class Scene extends Object3D {
  constructor() { super(); this.isScene = true; } // Used to exercise the production Scene.add wrapper.
}

class Group extends Object3D {} // Used to reproduce terrain meshes attached after their parent group is already in the scene.

class FakeImage {
  constructor() {
    this.complete = false; // Used by the runtime loader's eager/fresh-image readiness checks.
    this.naturalWidth = 0; // Used to prove the repair rejects the 4x4 fallback and accepts the decoded PNG.
    this.naturalHeight = 0; // Used alongside naturalWidth for the decoded-source sanity check.
    this.width = 0; // Used by the same dimension fallback as browser HTMLImageElement.
    this.height = 0; // Used by the same dimension fallback as browser HTMLImageElement.
    this.crossOrigin = '';
    this.onload = null;
    this.onerror = null;
  }
  set src(value) {
    this._src = value; // Used to assert the module resolves assets/... against docs/, not the page's current subdirectory.
    queueMicrotask(() => {
      this.complete = true;
      this.naturalWidth = this.width = 64;
      this.naturalHeight = this.height = 64;
      this.onload?.();
    });
  }
  get src() { return this._src; }
}

const logs = []; // Used to verify the self-heal reports through the mobile-visible render log.
const remaps = []; // Used to verify the legacy cliff UV marker is invalidated before the island mapper is re-run.
const windowMock = {
  THREE: { Scene, Object3D },
  NaturalSurfaceMaterialConfig: {
    texture: 'assets/textures/carved_smooth.png',
    surfaces: {
      rocks: { tint: '#808080', tintTreatment: 'body-sprite-tint' },
      cliffs: { tint: '#808080', tintTreatment: 'body-sprite-tint' },
    },
  },
  HobunjiSpritePngSurface: {
    tintSurfaceCanvas(image) {
      return { width: image.naturalWidth, height: image.naturalHeight, repairedTintCanvas: true }; // Used as the canonical body-style tint result.
    },
  },
  HobunjiSurfaceStretchUV: {
    remapNaturalTerrainMesh(mesh) {
      remaps.push({ signatureBeforeRemap: mesh.geometry.userData.hobunjiSurfaceStretchSignature });
      mesh.geometry.userData.hobunjiSurfaceStretchSignature = 'surface-island-v1|runtime-test';
      mesh.geometry.userData.hobunjiSurfaceStretch = { patchCount: 1, fallbackCount: 0 };
      return mesh.geometry.userData.hobunjiSurfaceStretch;
    },
    snapshot() { return { mappedMeshes: remaps.length }; },
  },
  __farmLog(message, level, category) { logs.push({ message, level, category }); },
};
windowMock.window = windowMock;

const documentMock = {
  currentScript: { src: 'https://example.test/docs/js/natural-surface-stretch-runtime.js' }, // Used to exercise module-relative asset resolution.
  baseURI: 'https://example.test/docs/index.html',
};

const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'natural-surface-stretch-runtime.js'); // Used to execute the exact production module.
vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
  window: windowMock,
  document: documentMock,
  Image: FakeImage,
  URL,
  console,
  Promise,
  Map,
  WeakMap,
  Object,
  String,
  Number,
  RegExp,
  Error,
});

function makeReportedMesh(surface = 'cliffs') {
  const texture = {
    name: 'natural_#808080_clamp', // Matches the Pixel Probe texture name from the reported broken rock.
    image: { width: 4, height: 4 }, // Recreates the exact flat placeholder seen in the report.
    userData: {}, // Recreates the reported state=- source=- metadata loss.
    needsUpdate: false,
  };
  const material = {
    map: texture,
    userData: { naturalSurface: surface }, // Used to reconstruct the missing texture metadata from central config.
  };
  const geometry = {
    userData: {
      naturalSurfaceUvMapping: 'cliff-face-stretch', // Recreates the older runtime UV repair that can overwrite the new island unwrap.
      hobunjiSurfaceStretchSignature: 'surface-island-v1|angle=18|material=*',
      hobunjiSurfaceStretch: { patchCount: 4, fallbackCount: 0 },
    },
  };
  const mesh = {
    isMesh: true,
    name: `reported-${surface}`,
    material,
    geometry,
    userData: { naturalSurface: surface },
    children: [],
    traverse(callback) { callback(this); },
  };
  return { texture, material, geometry, mesh };
}

async function run() {
  const direct = makeReportedMesh('cliffs'); // Used to retain coverage of the direct Scene.add path.
  const scene = new Scene();
  scene.add(direct.mesh);
  await new Promise(resolve => setImmediate(resolve));

  if (direct.texture.image.width !== 64 || direct.texture.image.height !== 64) {
    throw new Error(`Expected repaired 64x64 authored texture, got ${direct.texture.image.width}x${direct.texture.image.height}`);
  }
  if (direct.texture.userData.hobunjiAuthoredSurfacePath !== 'assets/textures/carved_smooth.png') {
    throw new Error(`Texture source metadata was not reconstructed: ${JSON.stringify(direct.texture.userData)}`);
  }
  if (direct.texture.userData.hobunjiAuthoredSurfaceState !== 'authored-png-tinted-repair') {
    throw new Error(`Texture did not reach repaired state: ${direct.texture.userData.hobunjiAuthoredSurfaceState}`);
  }
  if (!String(direct.texture.userData.hobunjiAuthoredSurfaceImageSize).includes('64x64')) {
    throw new Error(`Texture source image size was not recorded: ${direct.texture.userData.hobunjiAuthoredSurfaceImageSize}`);
  }
  if (!direct.texture.needsUpdate) throw new Error('Repaired texture was not marked needsUpdate');
  if (remaps.length !== 1) throw new Error(`Expected one final island-UV reassertion, got ${remaps.length}`);
  if (remaps[0].signatureBeforeRemap !== undefined) {
    throw new Error('Legacy cliff UV overwrite did not invalidate the stale island signature before remapping');
  }
  if (direct.geometry.userData.hobunjiSurfaceStretchSignature !== 'surface-island-v1|runtime-test') {
    throw new Error('Island mapper did not regain authoritative geometry metadata');
  }

  // Reproduce the path the second Pixel Probe exposed: the parent group enters
  // the scene first, then a terrain rock is attached to that already-live group.
  const group = new Group();
  scene.add(group);
  const nested = makeReportedMesh('rocks');
  group.add(nested.mesh);
  await new Promise(resolve => setImmediate(resolve));
  if (nested.texture.image.width !== 64 || nested.texture.image.height !== 64) {
    throw new Error(`Nested Object3D.add rock was not repaired: ${nested.texture.image.width}x${nested.texture.image.height}`);
  }
  if (nested.texture.userData.hobunjiAuthoredSurfaceState !== 'authored-png-tinted-repair') {
    throw new Error(`Nested rock did not reach repaired state: ${nested.texture.userData.hobunjiAuthoredSurfaceState}`);
  }

  if (!logs.some(entry => entry.category === 'render' && /texture repaired/.test(entry.message))) {
    throw new Error('Expected mobile-visible texture repair diagnostic');
  }

  const snapshot = windowMock.NaturalSurfaceStretchRuntime?.snapshot?.(); // Used to assert the module exposes mobile-friendly counters after repair.
  if (!snapshot || snapshot.textureRepairsCompleted !== 2 || snapshot.legacyCliffUvOverridesFound < 2 || snapshot.nestedAddsInspected < 1) {
    throw new Error(`Unexpected runtime repair snapshot: ${JSON.stringify(snapshot)}`);
  }

  console.log(JSON.stringify({
    direct: {
      source: direct.texture.userData.hobunjiAuthoredSurfacePath,
      state: direct.texture.userData.hobunjiAuthoredSurfaceState,
      imageSize: direct.texture.userData.hobunjiAuthoredSurfaceImageSize,
    },
    nested: {
      source: nested.texture.userData.hobunjiAuthoredSurfacePath,
      state: nested.texture.userData.hobunjiAuthoredSurfaceState,
      imageSize: nested.texture.userData.hobunjiAuthoredSurfaceImageSize,
    },
    remaps,
    snapshot,
  }, null, 2));
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});