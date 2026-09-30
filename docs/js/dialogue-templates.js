// Data-only reusable dialogue/activity templates. No combat or NPC-specific logic.
(() => {
  'use strict';
  function value(context, path) {
    let current = context; // Own-property traversal prevents prototype access in authored paths.
    for (const key of String(path).split('.')) {
      if (['__proto__', 'prototype', 'constructor'].includes(key) || current == null || !Object.hasOwn(current, key)) return undefined;
      current = current[key];
    }
    return current;
  }
  function format(text, context = {}) {
    return String(text).replace(/\{\{context:([\w.]+)\}\}/g, (token, path) => {
      const found = value(context, path); // Unknown values stay visible for authoring diagnostics.
      return ['string', 'number', 'boolean'].includes(typeof found) ? String(found) : token;
    });
  }
  function expand(template, context = {}, depth = 0) {
    if (depth > 20) throw new Error('Dialogue template nesting exceeds 20 levels.');
    if (typeof template === 'string') return format(template, context);
    if (Array.isArray(template)) return template.flatMap(item => {
      const result = expand(item, context, depth + 1); // Repeated blocks flatten naturally into their containing sequence.
      return Array.isArray(result) ? result : [result];
    });
    if (!template || typeof template !== 'object') return template;
    if (Object.hasOwn(template, '$value')) return value(context, template.$value);
    if (Object.hasOwn(template, '$each')) {
      const entries = value(context, template.$each); // Any caller-provided collection can generate dialogue nodes or activity stages.
      if (!Array.isArray(entries) || entries.length > 200) throw new Error('Dialogue template collection must contain at most 200 entries.');
      const alias = template.as || 'item'; // Each iteration receives an isolated local name and index.
      if (!/^[a-zA-Z]\w*$/.test(alias) || ['constructor', 'prototype'].includes(alias)) throw new Error('Invalid template alias.');
      return entries.map((item, index) => expand(template.template, { ...context, [alias]: item, index }, depth + 1)).flat();
    }
    const output = {}; // Return a fresh result; source templates and caller context are never mutated.
    for (const [key, item] of Object.entries(template)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
      output[key] = expand(item, context, depth + 1);
    }
    return output;
  }
  window.DialogueTemplates = { value, format, expand };
})();
