// Pack search box: narrows the inventory grid (on top of the active
// category tab) to items whose name contains the typed text.
// game.js's buildInventoryGrid() runs its stack keys through filterKeys().
(() => {
  'use strict';

  let deps = {};
  let query = '';

  function normalized(value) {
    return String(value || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
  }

  function matches(key, def) {
    if (!query) return true;
    return normalized(def?.label).includes(query) || normalized(key).replace(/_/g, ' ').includes(query);
  }

  function filterKeys(keys) {
    if (!query) return keys;
    const defs = deps.getItemDefs?.() || {};
    return keys.filter(key => matches(key, defs[key]));
  }

  function setQuery(value) {
    const next = normalized(value);
    if (next === query) return;
    query = next;
    const input = document.getElementById('invSearch');
    if (input && normalized(input.value) !== query) input.value = value;
    input?.classList.toggle('has-query', !!query);
    deps.rebuild?.();
  }

  function init(nextDeps) {
    deps = nextDeps || {};
    const input = document.getElementById('invSearch');
    if (!input || input.__invSearchBound) return;
    input.__invSearchBound = true;
    input.addEventListener('input', () => setQuery(input.value));
    input.addEventListener('keydown', event => {
      // Escape clears a non-empty search instead of closing the menu.
      if (event.key === 'Escape' && input.value) {
        event.preventDefault();
        event.stopPropagation();
        input.value = '';
        setQuery('');
      } else if (event.key === 'Enter' || event.key === 'Escape') {
        input.blur();
      }
    });
  }

  window.InventorySearch = {
    init, filterKeys, matches, setQuery,
    get query() { return query; },
  };
})();
