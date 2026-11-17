#!/usr/bin/env node
'use strict';
// Real Three.js r128 WebGL pixels, not just source signatures: pants and portrait
// lie on the same rest plane. The portrait wins the coplanar tie-break on BOTH
// camera sides; transparent portrait coverage must not hide pants elsewhere.
const assert = require('node:assert/strict');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('SKIP pants portrait depth WebGL: playwright unavailable');
  process.exit(0);
}
const root = path.resolve(__dirname, '..'); // Read actual shipped scripts/garment records.
const pageErrors = []; // Captured so CI failures also have mobile-readable diagnostics.
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 450, height: 450 } });
    page.on('pageerror', error => pageErrors.push(error.stack || String(error)));
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
    await page.setContent('<!doctype html><html><body></body></html>');
    for (const script of [
      'node_modules/three/build/three.min.js',
      'docs/config/pants-rigs.js',
      'docs/js/pants-rig-core.js',
      'docs/js/pants-garment-renderer.js',
    ]) await page.addScriptTag({ path: path.join(root, script) });

    const result = await page.evaluate(async () => {
      const T = window.THREE, R = window.PantsGarmentRenderer, rigs = window.HOBUNJI_PANTS_RIGS;
      if (!T || !R || !rigs) throw Error('Production pants and Three.js r128 scripts did not load');
      window.ClothingWeavingSystem = {
        async renderClothingLayers() {
          const canvas = document.createElement('canvas'); // Deterministic, fully opaque cuff art for pixel checks.
          canvas.width = canvas.height = 4;
          const context = canvas.getContext('2d');
          context.fillStyle = '#00ffff';
          context.fillRect(0, 0, 4, 4);
          return { canvas };
        },
      };
      const scene = new T.Scene();
      scene.background = new T.Color(0x080808);
      const model = new T.Group();
      scene.add(model);
      const portrait = new T.Mesh(new T.PlaneGeometry(1, 2), new T.MeshBasicMaterial({
        color: 0xf02020, transparent: true, alphaTest: 0.01, depthTest: true,
        depthWrite: true, side: T.DoubleSide,
      }));
      portrait.name = 'frontPlane';
      portrait.userData.hobunjiPlaneFace = 'front';
      portrait.position.y = 1;
      portrait.renderOrder = 2;
      model.add(portrait);
      const legs = new T.Group();
      model.add(legs);
      for (const [side, x] of [['left', -0.15], ['right', 0.15]]) {
        const thigh = new T.Group(), calf = new T.Group();
        thigh.name = side + '_thigh';
        thigh.position.set(x, 0.85, 0.02);
        calf.name = side + '_calf';
        calf.position.set(0, -0.42, 0);
        calf.userData.hobunjiCalfLength = 0.42;
        thigh.add(calf);
        legs.add(thigh);
      }
      model.updateMatrixWorld(true);
      const pants = R.attach(T, {
        avatarGroup: model, legHandle: { group: legs }, speciesId: 'kenkari', gender: 'female',
        garmentRecord: rigs.garments.pants_basic,
        characterRecord: rigs.characters.__default, meshBudget: 'npc',
      });
      if (!pants) throw Error('Pants garment did not attach');
      await pants.readyPromise;
      if (!pants.mesh || !pants.material || !pants.ready) throw Error('Pants material did not render');
      pants.update();
      const mat = pants.material;
      const box = new T.Box3().setFromBufferAttribute(pants.geometry.getAttribute('position'));
      const cx = (box.min.x + box.max.x) * 0.5;
      const cy = (box.min.y + box.max.y) * 0.5;
      const radius = Math.max(0.2, (box.max.x - box.min.x) * 0.6, (box.max.y - box.min.y) * 0.6);
      const camera = new T.OrthographicCamera(cx - radius, cx + radius, cy + radius,
        cy - radius, 0.1, 10);
      camera.position.set(cx, cy, 3);
      camera.lookAt(cx, cy, 0);
      const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(128, 128);
      renderer.setClearColor(0x080808);
      document.body.appendChild(renderer.domElement);
      const gl = renderer.getContext();
      if (!gl) throw Error('Chromium did not provide a WebGL context');
      const read = () => {
        renderer.render(scene, camera);
        const pixels = new Uint8Array(128 * 128 * 4);
        gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let cyan = 0, red = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
          if (g > 100 && b > 100 && r < 95) cyan++;
          if (r > 130 && r > g * 1.8 && r > b * 1.8) red++;
        }
        return { cyan, red };
      };
      portrait.visible = false;
      const unoccluded = read(); // Guards against a false success from invisible pants.
      portrait.visible = true;
      portrait.scale.set(10, 10, 1); // Entire garment is now covered by real opaque portrait pixels.
      portrait.updateMatrixWorld(true);
      const front = read();
      camera.position.set(cx, cy, -3);
      camera.lookAt(cx, cy, 0);
      camera.updateProjectionMatrix();
      const back = read();
      // A DIFFERENT actor's solid portrait is just 0.004 units in front of this actor's
      // pants. The previous +0.012 pants placement defeated that nearer silhouette.
      portrait.visible = false;
      const otherActor = new T.Group(); // Independent scene actor, not a child of the pants wearer.
      scene.add(otherActor);
      const otherPortrait = portrait.clone();
      otherPortrait.position.z = 0.004;
      otherActor.add(otherPortrait);
      camera.position.set(cx, cy, 3);
      camera.lookAt(cx, cy, 0);
      const other = read();
      scene.remove(otherActor);
      const result = {
        revision: T.REVISION, unoccluded, front, back, other, restZ: pants.basePositions[2],
        material: { depthTest: mat.depthTest, depthWrite: mat.depthWrite,
          offset: mat.polygonOffset, factor: mat.polygonOffsetFactor, units: mat.polygonOffsetUnits },
        bodyBounds: [box.min.toArray(), box.max.toArray()],
      }; // Copyable failure data without browser DevTools.
      pants.dispose();
      renderer.dispose();
      return result;
    });
    assert.equal(result.revision, '128', 'tested the shipping Three.js revision');
    assert(result.unoccluded.cyan > 50, 'the neutral pant mesh actually renders visible cyan pixels: ' + JSON.stringify(result));
    assert(result.front.red > 50 && result.front.cyan === 0,
      'front portrait blocks every coplanar pants pixel: ' + JSON.stringify(result));
    assert(result.back.red > 50 && result.back.cyan === 0,
      'rear-facing portrait blocks every coplanar pants pixel: ' + JSON.stringify(result));
    assert(result.other.red > 50 && result.other.cyan === 0,
      'an independent actor portrait 0.004 nearer to the camera blocks another actor\'s pants: ' + JSON.stringify(result));
    assert(Math.abs(result.restZ) < 1e-6, 'neutral garment has no +0.012 portrait penetration');
    assert(result.material.depthTest && result.material.depthWrite && result.material.offset
      && result.material.factor > 0 && result.material.units > 0,
    'pants use real depth and a rearward camera-independent coplanar offset');
    assert.equal(pageErrors.length, 0, 'browser render/shader errors: ' + pageErrors.join('\n'));
    console.log('Pants portrait depth WebGL front/back/other-actor: PASS ' + JSON.stringify(result));
  } finally {
    if (browser) await browser.close();
  }
})().catch(error => { console.error('Pants portrait depth WebGL FAIL:', error.stack || error); process.exitCode = 1; });
