(() => {
  'use strict';

  let previousRecipe = null; // Polling avoids depending on listener order because older exact-recipe handlers stopImmediatePropagation on change.

  function resetExperimentalOverridesForRecipe(value) {
    if (value !== 'karstTowers') {
      const karst = document.getElementById('labKarstEnabled');
      if (karst) karst.checked = false;
    }
    const river = document.getElementById('labRiverCarveEnabled');
    if (river) river.checked = false; // Recipes remain clean baselines; river override can be re-enabled deliberately afterward.
  }

  function watch() {
    const select = document.getElementById('recipeSelect');
    if (!select) { setTimeout(watch, 80); return; }
    previousRecipe = select.value;
    setInterval(() => {
      if (select.value === previousRecipe) return;
      previousRecipe = select.value;
      resetExperimentalOverridesForRecipe(select.value);
    }, 100);
  }

  watch();
})();