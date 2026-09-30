// Shared, HTML-free dialogue color markup for the runtime and authoring preview.
(() => {
  'use strict';
  function parse(value) {
    const source = String(value ?? ''); // Authored text after ordinary dialogue token resolution.
    const runs = []; // Plain text/color pairs consumed by rendering and speech timing.
    const colors = []; // A stack lets nested colored selections restore the surrounding color.
    const tokens = /\[color=(#[0-9a-f]{6})\]|\[\/color\]/gi; // Only six-digit hex colors are accepted, never HTML or arbitrary CSS.
    let offset = 0; // Start of the next unconsumed text segment.
    let match; // Current validated color marker.
    while ((match = tokens.exec(source))) {
      if (match.index > offset) runs.push({ text: source.slice(offset, match.index), color: colors.at(-1) || null });
      if (match[1]) colors.push(match[1].toLowerCase());
      else if (colors.length) colors.pop();
      else runs.push({ text: match[0], color: null });
      offset = tokens.lastIndex;
    }
    if (offset < source.length) runs.push({ text: source.slice(offset), color: colors.at(-1) || null });
    return runs;
  }
  function plain(runs) { return runs.map(run => run.text).join(''); }
  function render(element, runs, visibleCharacters = Infinity) {
    element.replaceChildren();
    let remaining = visibleCharacters; // UTF-16 offsets match the speech units' string lengths.
    for (const run of runs) {
      if (remaining <= 0) break;
      const span = element.ownerDocument.createElement('span'); // textContent guarantees authored text cannot execute HTML.
      span.textContent = run.text.slice(0, remaining);
      if (run.color) span.style.color = run.color;
      element.appendChild(span);
      remaining -= run.text.length;
    }
  }
  function html(value) {
    return parse(value).map(run => {
      const escaped = run.text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); // Safe graph-card markup from the same parser as gameplay.
      return run.color ? `<span style="color:${run.color}">${escaped}</span>` : escaped;
    }).join('');
  }
  window.DialogueRichText = { parse, plain, render, html };
})();
