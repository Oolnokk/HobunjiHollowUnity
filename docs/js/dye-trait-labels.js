(() => {
  'use strict';

  if (Number(window.DyeTraitLabels?.version) >= 1) return;

  const VERSION = 1; // Loader/debug version for shared dye-trait menu labeling.
  let observer = null; // MutationObserver used because loom/redye dye controls are created dynamically.

  function traitLabel(traitId) {
    return window.ItemTraits?.getTraitLabel?.(traitId) || String(traitId || '').replace(/^hue/, '');
  }

  function classificationFor(dyeOrColor) {
    const hsv = window.ItemTraits?.resolveHsv?.(dyeOrColor); // Same real-color HSV resolver used by NPC gifting traits.
    const traits = hsv ? (window.ItemTraits?.colorTraitsForHsv?.(hsv) || []) : [];
    return traits.map(traitLabel).join(' · ');
  }

  function dyeForOption(option) {
    return window.DyeSystem?.getById?.(String(option?.value || '')) || null;
  }

  function decorateOption(option) {
    const dye = dyeForOption(option); // Only actual dye options receive classification copy; None/placeholders stay unchanged.
    if (!dye) return;
    const classification = classificationFor(dye);
    if (!classification) return;
    option.textContent = `${dye.label} — ${classification}`;
    option.dataset.dyeTraits = classification;
  }

  function showSwatchClassification(button, dye, classification) {
    const section = button?.closest?.('.dye-hue-group'); // Redye hue group that receives a mobile-visible readout for the selected/tapped swatch.
    if (!section) return;
    let readout = section.querySelector('[data-dye-trait-readout]'); // One compact line avoids squeezing labels into tiny swatches.
    if (!readout) {
      readout = document.createElement('div');
      readout.className = 'dye-trait-readout';
      readout.dataset.dyeTraitReadout = '1';
      readout.style.cssText = 'font-size:8px;line-height:1.2;color:var(--muted);margin-top:3px;white-space:normal;';
      section.appendChild(readout);
    }
    readout.textContent = `${dye.label}: ${classification}`;
  }

  function decorateSwatch(button) {
    if (!button?.classList?.contains('dye-swatch')) return;
    const title = String(button.title || '').trim(); // Existing visible dye name used when the swatch has no dye-id dataset.
    const dye = window.DyeSystem?.getCatalog?.().find(entry => entry?.label === title || title.startsWith(`${entry?.label} —`));
    if (!dye) return;
    const classification = classificationFor(dye);
    if (!classification) return;
    button.title = `${dye.label} — ${classification}`;
    button.setAttribute('aria-label', button.title);
    if (!button.dataset.dyeTraitBound) {
      button.dataset.dyeTraitBound = '1';
      button.addEventListener('click', () => showSwatchClassification(button, dye, classification));
    }
    if (button.classList.contains('selected')) showSwatchClassification(button, dye, classification);
  }

  function decorate(root = document) {
    if (!window.DyeSystem || !window.ItemTraits) return;
    const scope = root?.querySelectorAll ? root : document; // Whole document or a newly-added dynamic menu subtree.
    if (root?.matches?.('option')) decorateOption(root);
    if (root?.matches?.('.dye-swatch')) decorateSwatch(root);
    scope.querySelectorAll?.('option').forEach(decorateOption);
    scope.querySelectorAll?.('.dye-swatch').forEach(decorateSwatch);
  }

  function install() {
    if (observer || !document?.documentElement || typeof MutationObserver !== 'function') return;
    decorate(document);
    observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes || []) if (node?.nodeType === 1) decorate(node);
    }); // Any newly opened loom/redye/creation dye menu gets labels automatically.
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.DyeTraitLabels = Object.freeze({ version: VERSION, classificationFor, decorate, install });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
