'use strict';
// node scripts/test-flail-species-scale.js
// Executes the production world-space flexible-part projector with non-uniform species rigs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runtime = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8'); // The source of both player and NPC flexible assemblies.
assert.match(runtime, /const attachmentScale = Math\.max\(0\.00001, Math\.abs\(q\.scale\.y\)\)/,
  'flail size must follow the rendered LONG axis of the haft');
assert.match(runtime, /state\.physicsLength = Math\.max\(0\.01, chainSpan\.length\(\) \* attachmentScale\)/,
  'the pendulum lever must use the same resolved scale as the visible rope');
assert.match(runtime, /placeFlexiblePartWorld\(state\.chain/);
assert.match(runtime, /placeFlexiblePartWorld\(state\.headRoot/);
assert.match(runtime, /renderedHaftLong: s\.renderedHaftLongScale/,
  'mobile diagnostics expose the actual scale source');
const begin = runtime.indexOf('  function placeFlexiblePartWorld(');
const end = runtime.indexOf('\n  function updateOne(', begin);
assert(begin >= 0 && end > begin, 'find the real projector, not a test replacement');
const sandbox = {};
vm.runInNewContext(runtime.slice(begin, end) + '\nthis.project = placeFlexiblePartWorld;', sandbox);
const project = sandbox.project; // The same matrix composition used for chain and head roots in the game.

// Affine X/Y/Z matrix fixture (column-major, as in Three.js); the game itself uses THREE.Matrix4.
class Matrix {
  constructor(elements = null) {
    this.elements = elements ? [...elements] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  clone() { return new Matrix(this.elements); }
  copy(other) { this.elements = [...other.elements]; return this; }
  compose(position, rotation, scale) {
    const {x,y,z,w} = rotation;
    const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,xw=x*w,yw=y*w,zw=z*w; // Full 3D quaternion rotation, like Three.js Matrix4.compose.
    this.elements = [
      (1-2*(yy+zz))*scale.x, (2*(xy+zw))*scale.x, (2*(xz-yw))*scale.x, 0,
      (2*(xy-zw))*scale.y, (1-2*(xx+zz))*scale.y, (2*(yz+xw))*scale.y, 0,
      (2*(xz+yw))*scale.z, (2*(yz-xw))*scale.z, (1-2*(xx+yy))*scale.z, 0,
      position.x,position.y,position.z,1,
    ];
    return this;
  }
  multiply(other) {
    const a = this.elements, b = other.elements, out = new Array(16).fill(0);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    this.elements = out;
    return this;
  }
  invert() {
    const e=this.elements,a=e[0],b=e[4],c=e[8],d=e[1],f=e[9],g=e[2],h=e[6],i=e[10],m=e[5];
    const det=a*(m*i-f*h)-b*(d*i-f*g)+c*(d*h-m*g);
    assert(Math.abs(det)>1e-10, 'fixture requires an invertible parent');
    const A=(m*i-f*h)/det,B=(c*h-b*i)/det,C=(b*f-c*m)/det;
    const D=(f*g-d*i)/det,E=(a*i-c*g)/det,F=(c*d-a*f)/det;
    const G=(d*h-m*g)/det,H=(b*g-a*h)/det,I=(a*m-b*d)/det;
    const tx=e[12],ty=e[13],tz=e[14]; // Body root translation also must be canceled by the part's inverse-root matrix.
    this.elements=[A,D,G,0,B,E,H,0,C,F,I,0,
      -A*tx-B*ty-C*tz,-D*tx-E*ty-F*tz,-G*tx-H*ty-I*tz,1];
    return this;
  }
}
const quaternion = (axis, radians) => { const m=Math.hypot(...axis);return {x:axis[0]/m*Math.sin(radians/2),y:axis[1]/m*Math.sin(radians/2),z:axis[2]/m*Math.sin(radians/2),w:Math.cos(radians/2)}; }; // Unit quaternions cover 3D pitch, yaw, and roll.
const position = (x, y, z) => ({ x, y, z });
const scale = (x, y = x, z = x) => ({ x, y, z }); // Flexible parts retain authored X/Y ratios while sharing the haft's longitudinal size.
function assertMatrixNear(actual, expected, label) {
  for (let i = 0; i < 16; i++)
    assert(Math.abs(actual.elements[i] - expected.elements[i]) < 1e-9,
      label + ' matrix component ' + i + ': ' + actual.elements[i] + ' vs ' + expected.elements[i]);
}
for (const speciesScale of [scale(1), scale(0.6, 1.9, 0.6), scale(1.8, 0.7, 1.8)]) {
  const parent = new Matrix().compose(position(1.3, -0.25, 0.8), quaternion([1,2,3],0.4), speciesScale);
  const inverse = parent.clone().invert(); // Exact root correction; a decomposed quaternion/scale cannot undo shear.
  const location = position(2.2, 3.4, -0.7), swing = quaternion([2,-1,3],-0.8);
  for (const [name, size] of [
    ['rope sprite', scale(1.5 * 3.75)],
    ['raster chain', scale(1.5 * 0.8, 1.5 * 2.25, 1.5)],
    ['head', scale(1.5 * 1.25)],
  ]) {
    const part = { matrix: new Matrix(), matrixAutoUpdate: true, matrixWorldNeedsUpdate: false };
    project(part, inverse, location, swing, size, new Matrix());
    const expected = new Matrix().compose(location, swing, size);
    assertMatrixNear(parent.clone().multiply(part.matrix), expected,
      name + ' under species ' + speciesScale.x + '/' + speciesScale.y);
    assert.equal(part.matrixAutoUpdate, false, 'parent updates must preserve the corrected child matrix');
    assert.equal(part.matrixWorldNeedsUpdate, true, 'next render must refresh the world matrix');
  }
}
console.log('flail species weapon scaling: PASS (longitudinal size, endpoint/physics parity, 3D-rotated anisotropic parents, head and rope world matrices)');
