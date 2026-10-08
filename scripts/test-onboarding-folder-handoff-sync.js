const assert = require('node:assert/strict'); // Verifies the folder handoff wrapper corrects only the proven throwaway-world case.
const fs = require('node:fs'); // Reads the shipped browser module directly from the repository.
const vm = require('node:vm'); // Runs the browser module against deterministic fake save-folder APIs.

const source = fs.readFileSync('docs/js/onboarding-folder-handoff-sync.js', 'utf8'); // Production module exercised in each isolated test context.

function stableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function runCase({ folderMeta, browserMeta }) {
  const calls = []; // Captures every sync attempt so the test can distinguish guarded and forced writes.
  const folderStatus = { state: 'ready', folderName: 'Hobunji Saves' }; // Minimal connected-folder state returned after successful writes.
  const localSave = {
    async syncNow(options = {}) {
      calls.push({ ...options });
      if (options.force) return { ...folderStatus, lastError: null, dataLossRisk: null, lastAction: 'saved-browser-to-folder' };
      return {
        ...folderStatus,
        lastError: "Skipped saving to the folder: this browser's save would remove 1 world(s) that exist in the folder save. Save Now again to confirm the overwrite.",
        dataLossRisk: 'would remove 1 world(s) that exist in the folder save',
        lastAction: 'save-blocked-data-loss',
      };
    },
    async readPrimarySnapshot() {
      return { snapshot: { meta: stableClone(folderMeta), farmLayouts: {} } };
    },
  }; // Fake LocalSaveFolder reproduces the core's data-loss response before allowing a deliberate force retry.
  const context = vm.createContext({
    window: {
      LocalSaveFolder: localSave,
      hobunjiOnboardingLinearFlow: {
        status: {
          creatorStep: 'complete',
          worldStep: 'name',
          interceptedLegacyWorldId: 'temp-world',
        },
      },
    },
    localStorage: {
      getItem(key) { return key === 'hobunjiSaveMeta' ? JSON.stringify(browserMeta) : null; },
    },
    console,
  }); // Browser-like globals identify the exact active linear handoff and corrected browser metadata.

  vm.runInContext(source, context, { filename: 'onboarding-folder-handoff-sync.js' });
  const result = await localSave.syncNow(); // Calls the production wrapper installed onto the fake LocalSaveFolder object.
  return { calls, result, status: context.window.hobunjiOnboardingFolderHandoffSync.status };
}

(async () => {
  const character = { id: 'char-1', nickname: 'Raku', inventory: { seeds: 3 } }; // Shared character proves the folder and browser agree on preserved character data.
  const existingWorld = { id: 'world-1', label: 'Old Farm', ownerCharacterId: 'char-1' }; // Shared pre-existing world must remain byte-for-byte unchanged.
  const tempWorld = { id: 'temp-world', label: 'Temporary Farm', ownerCharacterId: 'char-1' }; // Legacy creator world that linear onboarding intentionally removes.

  const exact = await runCase({
    folderMeta: { version: 1, characters: [character], worlds: [existingWorld, tempWorld] },
    browserMeta: { version: 1, characters: [character], worlds: [existingWorld] },
  }); // Exact one-world delta is the only case eligible for the special retry.
  assert.equal(exact.calls.length, 2, 'exact temporary-world cleanup should retry the blocked folder write once');
  assert.equal(exact.calls[1].force, true, 'validated temporary-world cleanup must explicitly force only its retry');
  assert.equal(exact.calls[1].recoveryKind, 'onboarding-temp-world-cleanup', 'forced retry must identify its narrow onboarding recovery reason');
  assert.equal(exact.result.lastError, null, 'successful correction should return a clean folder result to linear onboarding');
  assert.equal(exact.status.completedCorrections, 1, 'mobile-readable diagnostics should record the completed correction');

  const mismatched = await runCase({
    folderMeta: { version: 1, characters: [character], worlds: [existingWorld, tempWorld] },
    browserMeta: { version: 1, characters: [{ ...character, inventory: {} }], worlds: [existingWorld] },
  }); // Any additional character difference must keep the ordinary data-loss block intact.
  assert.equal(mismatched.calls.length, 1, 'a folder/browser mismatch beyond the temporary world must never force a retry');
  assert.match(mismatched.result.dataLossRisk, /would remove 1 world/, 'ordinary folder guard result must be preserved when correction is rejected');
  assert.equal(mismatched.status.rejectedCorrections, 1, 'diagnostics should record why the special correction was refused');

  console.log('onboarding folder handoff sync checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
