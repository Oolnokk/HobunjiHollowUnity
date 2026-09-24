const fs = require('fs'); // Reads the shipped game stylesheet and page shell for regression checks.
const path = require('path'); // Resolves repository-relative paths regardless of the caller's working directory.
const root = path.join(__dirname, '..'); // Anchors every checked file at the repository root.
const style = fs.readFileSync(path.join(root, 'docs', 'style.css'), 'utf8'); // Holds the base gameplay stylesheet under test.
const index = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8'); // Holds the game shell so cache-bust wiring can be verified.
const assert = (condition, message) => { if (!condition) throw new Error(message); }; // Fails fast with a useful message in local/CI runs.

assert(
  /html\s*\{[^}]*color-scheme:\s*dark\s*;[^}]*\}/s.test(style),
  'Gameplay should opt native controls into a dark color scheme so browser UI does not fall back to black text.'
);

assert(
  /:where\(button,\s*input,\s*select,\s*textarea,\s*option,\s*optgroup\)\s*\{[^}]*color:\s*inherit\s*;[^}]*\}/s.test(style),
  'Buttons and form controls must inherit the game text color instead of browser-default black.'
);

assert(
  /:where\(input,\s*textarea\)::placeholder\s*\{[^}]*color:\s*var\(--muted\)\s*;[^}]*\}/s.test(style),
  'Input placeholders should use the readable muted game text color.'
);

assert(
  index.includes('style.css?v=20260923noblacktext1'),
  'index.html must cache-bust style.css so the text contrast fix reaches existing installs.'
);

console.log('No-black-game-text regression checks passed.');
