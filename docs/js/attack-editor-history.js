// Global state-based Undo/Redo for the Attack Animation Editor.
// Event delegation intentionally covers dynamically-created controls (pose sliders,
// practical fields, hand/grip extensions, idle stances) without each subsystem
// maintaining its own incompatible history implementation.
(function (global) {
  'use strict';

  const MAX_HISTORY = 160; // Keeps mobile memory bounded while retaining a long authoring session.
  const undoStack = []; // Completed user edits; each entry stores complete before/after editor state.
  const redoStack = []; // Edits undone by the user and therefore available to replay.
  let gesture = null; // Snapshot captured before the current slider/gizmo/control gesture begins.
  let restoring = false; // Prevents programmatic restore events from recursively creating history entries.
  let ready = false; // Set after core editor + dynamic hand APIs are available.
  let lastLabel = 'ready'; // Mobile-visible description of the most recent history operation.

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function isEditableControl(target) {
    if (!target || !(target instanceof Element)) return false;
    if (!target.matches('input,select,textarea')) return false;
    if (target.disabled || target.readOnly) return false;
    const type = String(target.type || '').toLowerCase();
    return !['file', 'hidden', 'button', 'submit', 'reset'].includes(type);
  }

  function captureEditableControls() {
    const controls = {}; // UI context (selected model/tool, guide toggles, etc.) that may not belong to exported data.
    for (const element of document.querySelectorAll('input[id],select[id],textarea[id]')) {
      if (!isEditableControl(element)) continue;
      controls[element.id] = element.type === 'checkbox' || element.type === 'radio'
        ? { checked: !!element.checked }
        : { value: element.value };
    }
    return controls;
  }

  function restoreEditableControls(controls = {}) {
    for (const [id, state] of Object.entries(controls)) {
      const element = document.getElementById(id);
      if (!element || !isEditableControl(element)) continue;
      if ('checked' in state) element.checked = !!state.checked;
      else if ('value' in state) element.value = String(state.value ?? '');
    }
  }

  function snapshot() {
    const core = global.HobunjiAttackEditorState?.snapshot?.() || null;
    const profiles = global.HobunjiHandModelProfiles?.clone?.() || null;
    const grips = global.HobunjiHandToolGrips?.clone?.() || null;
    const secondaryGrips = global.HobunjiHandToolGrips?.editorSecondaryGripStateSnapshot?.() || null;
    const idleStances = global.AttackIdleStanceEditor?.snapshot?.() || null;
    const shoulder = global.HobunjiAttackEditorHandShoulderControls?.snapshot?.() || null;
    const gripMode = global.HobunjiAttackEditorHandGripMode?.snapshot?.() || null;
    return clone({
      core,
      profiles,
      grips,
      secondaryGrips,
      idleStances,
      shoulder,
      gripMode,
      controls: captureEditableControls(),
    });
  }

  function signature(state) {
    return JSON.stringify(state);
  }

  function describeTarget(target, fallback = 'Edit') {
    if (!target) return fallback;
    const label = target.closest?.('.field')?.querySelector?.('label')?.textContent?.trim()
      || target.getAttribute?.('aria-label')
      || target.textContent?.trim()
      || target.id;
    return String(label || fallback).replace(/\s+/g, ' ').slice(0, 80);
  }

  function updateUi() {
    const undo = document.getElementById('editorUndoBtn');
    const redo = document.getElementById('editorRedoBtn');
    const status = document.getElementById('editorHistoryStatus');
    if (undo) {
      undo.disabled = !undoStack.length || restoring;
      undo.textContent = undoStack.length ? `↶ Undo · ${undoStack[undoStack.length - 1].label}` : '↶ Undo';
      undo.title = undoStack.length ? `Undo: ${undoStack[undoStack.length - 1].label}` : 'Nothing to undo';
    }
    if (redo) {
      redo.disabled = !redoStack.length || restoring;
      redo.textContent = redoStack.length ? `↷ Redo · ${redoStack[redoStack.length - 1].label}` : '↷ Redo';
      redo.title = redoStack.length ? `Redo: ${redoStack[redoStack.length - 1].label}` : 'Nothing to redo';
    }
    if (status) status.textContent = `history: ${undoStack.length} undo · ${redoStack.length} redo · ${lastLabel}`;
  }

  function begin(label = 'Edit') {
    if (restoring || gesture) return gesture;
    gesture = { before: snapshot(), label: String(label || 'Edit') };
    return gesture;
  }

  function commit(activeGesture = gesture) {
    if (restoring || !activeGesture) return false;
    const after = snapshot();
    const beforeSig = signature(activeGesture.before);
    const afterSig = signature(after);
    if (activeGesture === gesture) gesture = null;
    if (beforeSig === afterSig) {
      updateUi();
      return false;
    }
    undoStack.push({ before: activeGesture.before, after, label: activeGesture.label });
    if (undoStack.length > MAX_HISTORY) undoStack.splice(0, undoStack.length - MAX_HISTORY);
    redoStack.length = 0;
    lastLabel = activeGesture.label;
    updateUi();
    return true;
  }

  async function restore(state) {
    if (!state) return false;
    restoring = true;
    updateUi();
    try {
      // Core first: it materializes the correct Action/tool/pose controls for the
      // rest of the subsystem data before those controls synchronize themselves.
      await global.HobunjiAttackEditorState?.restore?.(clone(state.core));

      if (state.profiles && global.HobunjiHandModelProfiles?.replace) {
        global.HobunjiHandModelProfiles.replace(clone(state.profiles));
      }
      if (state.grips && global.HobunjiHandToolGrips?.replace) {
        global.HobunjiHandToolGrips.replace(clone(state.grips));
      }
      global.HobunjiHandToolGrips?.restoreEditorSecondaryGripState?.(clone(state.secondaryGrips));
      global.AttackIdleStanceEditor?.restore?.(clone(state.idleStances));
      global.HobunjiAttackEditorHandShoulderControls?.restore?.(clone(state.shoulder));
      global.HobunjiAttackEditorHandGripMode?.restore?.(clone(state.gripMode));

      restoreEditableControls(state.controls);

      // These selectors are editing CONTEXT rather than exported values; re-run
      // their public synchronization paths after restoring the underlying data.
      const profileSelect = document.getElementById('handProfileSelect');
      if (profileSelect && state.controls?.handProfileSelect?.value != null) {
        profileSelect.value = state.controls.handProfileSelect.value; // Context restore only; the profile snapshot already contains the authoritative species→model mapping.
      }
      const guide = document.getElementById('handShowGripGuide');
      if (guide && state.controls?.handShowGripGuide) {
        guide.checked = !!state.controls.handShowGripGuide.checked;
        guide.dispatchEvent(new Event('change', { bubbles: true }));
      }

      global.HobunjiAttackEditorHandConfigurator?.syncAll?.();
      global.HobunjiAttackEditorHandCalibration?.refresh?.();
      global.HobunjiAttackEditorDirectHandAttachments?.syncFields?.();
      global.HobunjiAttackEditorHandShoulderControls?.syncControls?.();
      global.HobunjiAttackEditorHandStateCoherence?.updateStatus?.();
      global.HobunjiAttackEditorState?.refresh?.();
      global.ProceduralHandFrameDriver?.syncNow?.(); // One authoritative sync is enough; no synthetic selector mutation or delayed second pass.
      return true;
    } finally {
      restoring = false;
      updateUi();
    }
  }

  async function undo() {
    if (restoring || !undoStack.length) return false;
    if (gesture) commit();
    const entry = undoStack.pop();
    const ok = await restore(entry.before);
    if (ok) {
      redoStack.push(entry);
      lastLabel = `undid ${entry.label}`;
    } else {
      undoStack.push(entry);
    }
    updateUi();
    return ok;
  }

  async function redo() {
    if (restoring || !redoStack.length) return false;
    if (gesture) commit();
    const entry = redoStack.pop();
    const ok = await restore(entry.after);
    if (ok) {
      undoStack.push(entry);
      lastLabel = `redid ${entry.label}`;
    } else {
      redoStack.push(entry);
    }
    updateUi();
    return ok;
  }

  function beginExternal(label) {
    if (restoring) return null;
    if (gesture) commit();
    return { before: snapshot(), label: String(label || 'External edit'), external: true };
  }

  function commitExternal(token) {
    if (!token || restoring) return false;
    return commit(token);
  }

  function installListeners() {
    if (ready) return;
    const undoButton = document.getElementById('editorUndoBtn');
    const redoButton = document.getElementById('editorRedoBtn');
    if (!undoButton || !redoButton || !global.HobunjiAttackEditorState) {
      requestAnimationFrame(installListeners);
      return;
    }
    ready = true;

    undoButton.addEventListener('click', event => { event.preventDefault(); undo(); });
    redoButton.addEventListener('click', event => { event.preventDefault(); redo(); });

    // focusin covers keyboard editing of numeric/select fields; dynamic controls
    // added later need no registration because delegation happens at document level.
    document.addEventListener('focusin', event => {
      if (restoring || !isEditableControl(event.target)) return;
      begin(describeTarget(event.target));
    }, true);

    document.addEventListener('pointerdown', event => {
      if (restoring || event.button !== 0) return;
      const target = event.target;
      if (target?.closest?.('#editorHistoryToolbar')) return;
      if (target?.closest?.('button')) {
        begin(describeTarget(target.closest('button'), 'Button edit'));
        return;
      }
      if (isEditableControl(target)) {
        begin(describeTarget(target));
        return;
      }
      if (target?.tagName === 'CANVAS' || target?.closest?.('#viewport')) begin('Viewport / gizmo / grip edit');
    }, true);

    // Range drags and viewport gizmo/grip operations mutate before pointerup.
    document.addEventListener('pointerup', event => {
      if (restoring || !gesture) return;
      if (event.target?.closest?.('button')) return; // Button mutation runs on click, which occurs after pointerup.
      if (event.target?.tagName === 'CANVAS' || event.target?.closest?.('#viewport') || isEditableControl(event.target)) commit();
    }, true);

    document.addEventListener('pointercancel', () => { if (gesture && !restoring) commit(); }, true);

    // Selects, checkboxes and keyboard-edited numeric fields finish on change.
    document.addEventListener('change', event => {
      if (restoring || event.target?.type === 'file' || !isEditableControl(event.target)) return;
      queueMicrotask(() => { if (gesture) commit(); });
    });

    // Reset/zero/flip/capture buttons often mutate state entirely inside click
    // handlers without emitting input/change. Document bubble runs afterward.
    document.addEventListener('click', event => {
      if (restoring || !gesture) return;
      const button = event.target?.closest?.('button');
      if (!button || button.closest('#editorHistoryToolbar')) return;
      queueMicrotask(() => { if (gesture) commit(); });
    });

    document.addEventListener('keydown', event => {
      if (restoring) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    });

    lastLabel = 'ready';
    updateUi();
  }

  global.HobunjiAttackEditorHistory = {
    snapshot,
    restore,
    beginExternal,
    commitExternal,
    undo,
    redo,
    getDebug() {
      return {
        ready,
        restoring,
        activeGesture: gesture?.label || null,
        undoCount: undoStack.length,
        redoCount: redoStack.length,
        lastLabel,
        editableControlCount: document.querySelectorAll('input:not([disabled]):not([readonly]),select:not([disabled]),textarea:not([readonly])').length,
      };
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installListeners, { once: true });
  else installListeners();
})(window);
