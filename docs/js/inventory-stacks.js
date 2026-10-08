(() => {
  'use strict';

  // Single authority for bag stack sizing. The bag stores one count per
  // item key; STACK_SIZE is only how many units one inventory box shows —
  // anything past it spills into another box of the same item instead of
  // being refused or discarded. MAX_TOTAL is a sanity ceiling per item
  // (101 full stacks) so a runaway grant can't grow a count without bound.
  // Loaded before every module that grants items (see index.html).
  const STACK_SIZE = 99;
  const MAX_TOTAL = 9999;

  function clampTotal(value) {
    return Math.max(0, Math.min(MAX_TOTAL, Number(value) || 0));
  }

  // Splits a total into per-box counts: 250 -> [99, 99, 52].
  function stackCounts(total) {
    const count = Math.max(0, Math.floor(Number(total) || 0));
    const out = [];
    for (let left = count; left > 0; left -= STACK_SIZE) out.push(Math.min(STACK_SIZE, left));
    return out;
  }

  window.InventoryStacks = Object.freeze({ STACK_SIZE, MAX_TOTAL, clampTotal, stackCounts });
})();
