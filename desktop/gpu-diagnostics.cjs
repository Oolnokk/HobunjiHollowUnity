'use strict';

// Explicit, on-demand diagnostics: never mutate Chromium GPU flags or sample a frame.
const WEBGL_STATUS_SCRIPT = `(() => {
  const canvas = document.querySelector('#threeContainer canvas'); // The live game WebGL surface; not the 2D HUD, map, or editor canvases.
  if (!canvas) return { state: 'not-ready', error: 'Main game WebGL canvas has not been created.' };
  try {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); // Reuse an existing Three.js context without allocating a new canvas.
    if (!gl) return { state: 'unavailable', error: 'The main game canvas has no accessible WebGL context.' };
    const extension = gl.getExtension('WEBGL_debug_renderer_info'); // Chromium can hide the precise adapter; never infer it from an absent extension.
    const detail = parameter => {
      try { return String(gl.getParameter(parameter) ?? '(unknown)'); } catch { return '(unavailable)'; }
    }; // Typed WebGL parameters may be unavailable on a reset context.
    return {
      state: 'ready',
      vendor: detail(gl.VENDOR),
      renderer: detail(gl.RENDERER),
      unmaskedVendor: extension ? detail(extension.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: extension ? detail(extension.UNMASKED_RENDERER_WEBGL) : null,
      version: detail(gl.VERSION),
      contextLost: !!gl.isContextLost?.(),
      width: canvas.width,
      height: canvas.height,
      pixelRatio: window.devicePixelRatio || 1,
    };
  } catch (error) {
    return { state: 'error', error: String(error?.message || error) };
  }
})()`;

function gpuName(device) {
  const name = [device?.vendorString, device?.deviceString].filter(Boolean).join(' ').trim(); // Chromium may report names, numeric IDs, or both.
  const hex = number => Number.isInteger(number) ? '0x' + number.toString(16).padStart(4, '0') : '?'; // Used only for adapter IDs when names are unavailable.
  return (name || `vendor ${hex(device?.vendorId)} / device ${hex(device?.deviceId)}`) +
    (device?.active === true ? ' [active]' : device?.active === false ? ' [inactive]' : '');
}

function describeGraphicsStatus({ accelerationEnabled = null, features = null, gpuInfo = null, webgl = null, errors = [] } = {}) {
  const lines = [
    'HOBUNJI HOLLOW — GRAPHICS STATUS',
    '',
    'Hardware acceleration setting: ' + (accelerationEnabled === true ? 'enabled (not proof of GPU rendering)' :
      accelerationEnabled === false ? 'disabled' : 'not reported'),
    'Chromium WebGL: ' + (features?.webgl ?? 'not reported'),
    'Chromium WebGL2: ' + (features?.webgl2 ?? 'not reported'),
    'GPU compositing: ' + (features?.gpu_compositing ?? 'not reported'),
    'GPU rasterization: ' + (features?.gpu_rasterization ?? 'not reported'),
  ]; // Shown in the native View menu status report.
  const adapters = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : []; // Actual detected adapters, not assumed hardware.
  lines.push('Detected adapters: ' + (adapters.length ? adapters.map(gpuName).join(' | ') : 'not reported'));
  if (typeof gpuInfo?.auxAttributes?.softwareRendering === 'boolean') {
    lines.push('Chromium softwareRendering flag: ' + gpuInfo.auxAttributes.softwareRendering);
  }
  lines.push('', 'GAME WEBGL CONTEXT');
  if (webgl?.state === 'ready') {
    lines.push('Renderer: ' + (webgl.unmaskedRenderer || webgl.renderer || '(unknown)'));
    lines.push('Vendor: ' + (webgl.unmaskedVendor || webgl.vendor || '(unknown)'));
    lines.push('WebGL version: ' + (webgl.version || '(unknown)'));
    lines.push('Context lost: ' + (webgl.contextLost ? 'yes' : 'no'));
    lines.push('Drawing buffer: ' + webgl.width + ' × ' + webgl.height + ' pixels (display scale ' + webgl.pixelRatio + ')');
  } else {
    lines.push('Main renderer: ' + (webgl?.error || webgl?.state || 'not available yet'));
  }
  const rendererName = String(webgl?.unmaskedRenderer || webgl?.renderer || ''); // Distinguishes software drivers from a normal physical GPU.
  const softwareRenderer = /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render driver|warp/i.test(rendererName);
  const chromiumSoftware = gpuInfo?.auxAttributes?.softwareRendering === true;
  const webglStatus = String(features?.webgl || '');
  lines.push('', 'ASSESSMENT');
  if (softwareRenderer || chromiumSoftware || /software/i.test(webglStatus)) {
    lines.push('Software rendering is indicated. This can severely reduce game performance.');
  } else if (webgl?.state === 'ready' && /enabled|hardware/i.test(webglStatus)) {
    lines.push('WebGL is active and Chromium reports an accelerated path. Low FPS can still be CPU-bound.');
  } else {
    lines.push('Could not confirm a hardware WebGL path. Check renderer details and Windows GPU settings.');
  }
  if (errors.length) lines.push('', 'Diagnostics limitations:', ...errors.map(error => '- ' + error));
  lines.push('', 'Tip: In Windows Task Manager, enable the GPU engine column for the Hobunji Hollow process.');
  return lines.join('\n');
}

async function showGraphicsStatus({ app, dialog, clipboard, getGameWindow }) {
  const win = getGameWindow(); // Never run graphics diagnostics against the updater's separate Chromium window.
  if (!win || win.isDestroyed?.()) return null;
  const errors = []; // Report partial failures onscreen rather than requiring DevTools.
  let accelerationEnabled = null;
  let features = null;
  let gpuInfo = null;
  let webgl = null;
  try { accelerationEnabled = app.isHardwareAccelerationEnabled(); }
  catch (error) { errors.push('Acceleration state: ' + String(error?.message || error)); }
  try { features = app.getGPUFeatureStatus(); }
  catch (error) { errors.push('GPU features: ' + String(error?.message || error)); }
  try { gpuInfo = await app.getGPUInfo('basic'); }
  catch (error) { errors.push('GPU adapter list: ' + String(error?.message || error)); }
  try { webgl = await win.webContents.executeJavaScript(WEBGL_STATUS_SCRIPT, true); }
  catch (error) { errors.push('Game WebGL context: ' + String(error?.message || error)); }
  if (win.isDestroyed?.()) return null;
  const report = describeGraphicsStatus({ accelerationEnabled, features, gpuInfo, webgl, errors }); // Shared formatter also used by non-Electron regression tests.
  const choice = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Hobunji Hollow — Graphics Status',
    message: 'GPU and WebGL diagnostics',
    detail: report,
    buttons: ['Copy Details', 'Close'],
    defaultId: 1, cancelId: 1,
  });
  if (choice.response === 0 && typeof clipboard?.writeText === 'function') clipboard.writeText(report);
  return report;
}

module.exports = { WEBGL_STATUS_SCRIPT, gpuName, describeGraphicsStatus, showGraphicsStatus };
