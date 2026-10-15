'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function patch(relativePath, pattern, replacement, label) {
  const file = path.join(root, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(label)) {
    console.log(`already patched: ${relativePath}`);
    return;
  }
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Patch target not found: ${relativePath}`);
  fs.writeFileSync(file, next);
  console.log(`patched: ${relativePath}`);
}

const marker = 'intentionalFakeLightSource';

patch(
  'docs/js/banubu-cave-clouds.js',
  /(const light = new THREE\.PointLight\(0x8dbbdf, 0\.45, 3\.8, 2\);[^\n]*\n\s*light\.position\.set\(0, 0, -0\.1\);)/,
  `$1\n        light.userData.${marker} = true; // Banubu cloud glow is intentionally visible through the shared 2D fake-light compositor.\n        light.userData.furnitureLightMask = true;\n        window.FurnitureLightRegistry?.register(light);`,
  marker,
);

patch(
  'docs/js/color-pools-system.js',
  /(const light = new THREE\.PointLight\(new THREE\.Color\(pool\.color \|\| '#4f7ea5'\), 0\.45, 3\.5, 2\);\n\s*light\.position\.set\(water\.position\.x, 0\.35, water\.position\.z\);)/,
  `$1\n      light.userData.${marker} = true; // Colored pools keep their authored hue as a fake 2D local-light source instead of shading Three.js materials.\n      light.userData.furnitureLightMask = true;\n      window.FurnitureLightRegistry?.register(light);`,
  marker,
);

patch(
  'docs/js/wall-ornament-placement.js',
  /(const light = new THREE\.PointLight\(0xffa04a, 0\.85, 5, 2\);[^\n]*\n\s*light\.name = 'WallTorchLight';\n\s*light\.position\.set\(0, 1\.31, 0\.42\);)/,
  `$1\n      light.userData.${marker} = true; // Wall torches illuminate through the shared 2D compositor; the PointLight itself never reaches WebGL lighting.\n      light.userData.furnitureLightMask = true;\n      window.FurnitureLightRegistry?.register(light);`,
  marker,
);

patch(
  'docs/js/dev-random-ruin-hit-puzzles.js',
  /(const light = new THREE\.PointLight\(0xff8c33, 2\.4, 4\.2, 2\);)/,
  `$1\n    light.userData.${marker} = true; // Puzzle flames retain a visible fake glow while local Three.js lighting stays globally disabled.\n    light.userData.furnitureLightMask = true;\n    window.FurnitureLightRegistry?.register(light);`,
  marker,
);

console.log('intentional fake-light source patches: PASS');
