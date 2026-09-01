#!/usr/bin/env node
// Generates docs/config/items/item-index.json — a flat itemKey -> {label,
// icon, cat} snapshot used only by tools/item-database-editor to list every
// known item for trait editing. game.js has no discrete ITEM_DEFS file to
// fetch (it's a giant inline object literal, extended in place by half a
// dozen other systems at runtime), so this script regex/brace-parses the
// same source files instead of trying to run the game. Re-run this any time
// items are added/renamed in game.js or js/cooking-data.js.
'use strict';
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');

function findBlock(source, startMarker) {
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) return null;
  const braceStart = source.indexOf('{', startIdx);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

// Splits a `{ key: {...}, key2: {...} }` literal into its top-level
// `key: {...}` entry strings without a full JS parser — good enough for
// game.js's ITEM_DEFS, which never nests a `{` inside a top-level key name.
function splitTopLevelEntries(objectLiteralText) {
  const inner = objectLiteralText.slice(1, -1); // strip outer { }
  const entries = [];
  let depth = 0;
  let entryStart = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      entries.push(inner.slice(entryStart, i));
      entryStart = i + 1;
    }
  }
  entries.push(inner.slice(entryStart));
  return entries.map(e => e.trim()).filter(Boolean);
}

function parseEntry(entryText) {
  const keyMatch = entryText.match(/^(\w+)\s*:\s*\{/);
  if (!keyMatch) return null;
  const key = keyMatch[1];
  const label = entryText.match(/label:\s*'((?:[^'\\]|\\.)*)'/)?.[1]
    || entryText.match(/label:\s*"((?:[^"\\]|\\.)*)"/)?.[1] || key;
  const icon = entryText.match(/icon:\s*'((?:[^'\\]|\\.)*)'/)?.[1] || '';
  const cat = entryText.match(/cat:\s*'([^']*)'/)?.[1] || '';
  return { key, label: label.replace(/\\'/g, "'"), icon, cat };
}

function extractItemDefs(gameJsSource) {
  const block = findBlock(gameJsSource, 'const ITEM_DEFS = {');
  if (!block) throw new Error('Could not locate ITEM_DEFS in game.js');
  return splitTopLevelEntries(block).map(parseEntry).filter(Boolean);
}

function extractToolItemDefs(gameJsSource) {
  const block = findBlock(gameJsSource, 'const TOOL_ITEM_DEFS = {');
  if (!block) return [];
  return splitTopLevelEntries(block).map(parseEntry).filter(Boolean)
    .map(item => ({ ...item, cat: item.cat || 'tool' }));
}

function extractCookingIngredients(cookingDataSource) {
  const block = findBlock(cookingDataSource, 'window.HobunjiCookingData = {');
  if (!block) return [];
  let parsed;
  try { parsed = JSON.parse(block); } catch (e) {
    console.warn('[generate-item-index] Could not JSON.parse cooking-data.js items block:', e.message);
    return [];
  }
  return Object.entries(parsed.items || {}).map(([key, def]) => ({
    key,
    label: def.name || key,
    icon: '',
    cat: 'ingredient',
  }));
}

function prettifyId(id) {
  const leaf = id.includes('::') ? id.split('::').pop() : id;
  return leaf.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Clothing lives entirely under config/cosmetics/ (never in ITEM_DEFS — see
// js/equipment-panel.js), so it's indexed separately by cosmeticId, keyed
// with a "cosmetic:" prefix so it can never collide with a bag-item key.
function extractCosmetics(cosmeticsIndexJson) {
  const entries = JSON.parse(cosmeticsIndexJson).entries || [];
  return entries.map(entry => ({
    key: 'cosmetic:' + entry.id,
    label: prettifyId(entry.id),
    icon: '👕',
    cat: 'clothing',
  }));
}

function main() {
  const gameJsSource = fs.readFileSync(path.join(DOCS, 'game.js'), 'utf8');
  const cookingDataSource = fs.readFileSync(path.join(DOCS, 'js', 'cooking-data.js'), 'utf8');
  const cosmeticsIndexJson = fs.readFileSync(path.join(DOCS, 'config', 'cosmetics', 'index.json'), 'utf8');

  const items = {};
  for (const item of extractItemDefs(gameJsSource)) items[item.key] = item;
  for (const item of extractToolItemDefs(gameJsSource)) if (!items[item.key]) items[item.key] = item;
  for (const item of extractCookingIngredients(cookingDataSource)) if (!items[item.key]) items[item.key] = item;
  for (const item of extractCosmetics(cosmeticsIndexJson)) if (!items[item.key]) items[item.key] = item;

  const sortedKeys = Object.keys(items).sort((a, b) => a.localeCompare(b));
  const out = {};
  for (const key of sortedKeys) out[key] = items[key];

  const outPath = path.join(DOCS, 'config', 'items', 'item-index.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`[generate-item-index] Wrote ${sortedKeys.length} items to ${path.relative(process.cwd(), outPath)}`);
}

main();
