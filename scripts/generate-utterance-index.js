#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'docs/assets/audio/sfx/utterances');
const indexPath = path.join(folder, 'index.json');

function readExisting() {
  try { return JSON.parse(fs.readFileSync(indexPath, 'utf8')); }
  catch (_) { return {}; }
}

function wordsFor(file) {
  return file
    .replace(/^sfx_/i, '')
    .replace(/\.ogg$/i, '')
    .split(/[-_]+/)
    .map(word => word.trim())
    .filter(Boolean);
}

function generatedLabel(file) {
  const words = wordsFor(file);
  if (!words.length) return file;
  return words
    .map((word, index) => index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)
    .join(' · ');
}

const existing = readExisting();
const existingByFile = new Map((existing.clips || []).map(entry => [entry.file, entry]));
const files = fs.readdirSync(folder)
  .filter(name => /\.ogg$/i.test(name))
  .sort((a, b) => a.localeCompare(b));

const clips = files.map(file => {
  const previous = existingByFile.get(file) || {};
  const tags = Array.isArray(previous.tags) && previous.tags.length
    ? previous.tags
    : [...new Set(wordsFor(file).map(word => word.toLowerCase()).filter(word => !/^\d+$/.test(word)))];
  return {
    id: previous.id || file,
    file,
    label: previous.label || generatedLabel(file),
    tags,
  };
});

const output = {
  version: 1,
  basePath: './',
  description: existing.description || 'Descriptive animal/SFX utterance library used by the Ambient Dialogue Editor for experimentation and runtime call assignment.',
  clips,
  legacyAliases: existing.legacyAliases || {},
  legacySpeciesDefaults: existing.legacySpeciesDefaults || {},
};

fs.writeFileSync(indexPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Indexed ${clips.length} utterance .ogg files -> ${path.relative(root, indexPath)}`);
