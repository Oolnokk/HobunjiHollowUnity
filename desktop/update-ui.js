'use strict';

const byId = id => document.getElementById(id); // Stable DOM references for the sandboxed update screen.
const updateApi = window.desktopUpdates; // Narrow IPC bridge, not the game or Node runtime.

function render(status) {
  const phase = String(status?.phase || 'idle');
  byId('current').textContent = String(status?.currentVersion || 'unknown');
  byId('available').textContent = status?.targetVersion || '—';
  byId('status').textContent = String(status?.message || '');
  byId('error').textContent = status?.error ? String(status.error) : '';
  byId('error').hidden = !status?.error;
  byId('progressPanel').hidden = !['downloading', 'downloaded'].includes(phase);
  const percent = Math.max(0, Math.min(100, Number(status?.percent) || 0));
  byId('progress').value = percent;
  byId('percent').textContent = Math.round(percent) + '%';
  byId('install').hidden = phase !== 'downloaded';
  byId('check').disabled = ['checking', 'retrying', 'downloading', 'downloaded', 'saving', 'installing'].includes(phase);
  byId('check').textContent = phase === 'error' ? 'Retry Update Check' : 'Check Now';
  byId('install').disabled = phase !== 'downloaded';
  byId('later').disabled = ['saving', 'installing'].includes(phase);
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    byId('error').textContent = 'Could not perform that action: ' + String(error?.message || error);
    byId('error').hidden = false;
  }
}

byId('check').addEventListener('click', () => run(() => updateApi.check()));
byId('install').addEventListener('click', () => run(() => updateApi.install()));
byId('later').addEventListener('click', () => run(() => updateApi.later()));
byId('releases').addEventListener('click', () => run(() => updateApi.releases()));
updateApi.onStatus(render);
void run(async () => render(await updateApi.getStatus()));
