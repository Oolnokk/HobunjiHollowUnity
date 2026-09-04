// Bridge Animation Author's classic-script global lexical functions onto window for
// the separately loaded Full Character Scale workspace. The author historically
// defines/reassigns several helpers in inline scripts; depending on declaration form,
// they are callable by later classic scripts but are not guaranteed to be window
// properties. The comparison workspace intentionally consumes those existing helpers
// rather than duplicating actor/mode/profile logic.
(() => {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const bindings = {
    setAnimationAuthorMode: typeof setAnimationAuthorMode === 'function' ? setAnimationAuthorMode : null,
    addNpcAnimationActor: typeof addNpcAnimationActor === 'function' ? addNpcAnimationActor : null,
    selectedAnimationActor: typeof selectedAnimationActor === 'function' ? selectedAnimationActor : null,
    attachmentRigProfileForActor: typeof attachmentRigProfileForActor === 'function' ? attachmentRigProfileForActor : null,
    clearAnimationActors: typeof clearAnimationActors === 'function' ? clearAnimationActors : null,
    selectAnimationActor: typeof selectAnimationActor === 'function' ? selectAnimationActor : null,
    serializeAttachmentRigLibrary: typeof serializeAttachmentRigLibrary === 'function' ? serializeAttachmentRigLibrary : null,
    frameAllAnimationActors: typeof frameAllAnimationActors === 'function' ? frameAllAnimationActors : null,
    strictNpcAppearanceV1514: typeof strictNpcAppearanceV1514 === 'function' ? strictNpcAppearanceV1514 : null,
  };

  const missing = [];
  for (const [name, fn] of Object.entries(bindings)) {
    if (typeof fn !== 'function') {
      missing.push(name);
      continue;
    }
    // Capture the function value above before assigning the window property. This
    // avoids recursion even when an original global function declaration is also
    // reflected as a configurable property on window.
    window[name] = function fullCharacterScaleHostBridge() {
      return fn.apply(this, arguments);
    };
    window[name].__hobunjiFullCharacterScaleHostBridge = true;
  }

  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.fullCharacterScaleHostBridge = {
    installed: missing.length === 0,
    bridged: Object.keys(bindings).filter(name => !missing.includes(name)),
    missing,
  };

  // The visible tab may have been injected before this bridge loaded. Re-run its
  // public entry readiness now so a user never ends up with a permanently dead tab.
  const tab = document.getElementById('maaFullScaleTab');
  if (tab) {
    tab.disabled = missing.some(name => ['setAnimationAuthorMode','addNpcAnimationActor','selectedAnimationActor','attachmentRigProfileForActor','clearAnimationActors','selectAnimationActor'].includes(name));
    tab.title = tab.disabled ? `Scale comparison unavailable: missing ${missing.join(', ')}` : '';
  }
})();
