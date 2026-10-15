'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '../docs/js/wood-cut-surfaces.js');
let source = fs.readFileSync(file, 'utf8');
const oldBlock = `  function sourceColorHex(material, fallback = '#6d472d') {
    const source = Array.isArray(material) ? material[0] : material; // First source wood material carries the procedural per-tree bark tint.
    if (!source?.color?.isColor) return fallback;
    return \`#\${source.color.getHexString()}\`;
  }`;
const newBlock = `  function sourceColorHex(material, fallback = '#6d472d') {
    const source = Array.isArray(material) ? material[0] : material; // First source wood material or naturalized bark material carries the source tint metadata.
    const mappedTint = String(source?.map?.userData?.naturalSurfaceBodySpriteTintTarget || ''); // NaturalSurfaceMaterials stores the pre-white-material bark tint on its body-tinted PNG texture.
    if (/^#[0-9a-f]{6}$/i.test(mappedTint)) return mappedTint.toLowerCase();
    if (!source?.color?.isColor) return fallback;
    return \`#\${source.color.getHexString()}\`;
  }`;

if (source.includes(newBlock)) process.exit(0);
if (!source.includes(oldBlock)) throw new Error('sourceColorHex block changed unexpectedly');
source = source.replace(oldBlock, newBlock);
fs.writeFileSync(file, source);
console.log('patched wood-cut-surfaces sourceColorHex');
