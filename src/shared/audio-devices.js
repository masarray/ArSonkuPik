export const DEFAULT_AUDIO_OUTPUT_DEVICE = {
  deviceId: 'default',
  label: 'System Default',
  kind: 'audiooutput',
  isDefault: true
};

export function normalizeOutputDeviceId(deviceId) {
  const value = String(deviceId || 'default').trim();
  return value && value !== 'undefined' && value !== 'null' ? value : 'default';
}

export function deviceIdToSinkId(deviceId) {
  const normalized = normalizeOutputDeviceId(deviceId);
  return normalized === 'default' ? '' : normalized;
}

export function getExtensionMediaPattern() {
  const id = globalThis.chrome?.runtime?.id || '';
  return id ? `*://${id}/*` : '';
}

export async function grantExtensionOutputRoutingPermission() {
  const api = globalThis.chrome?.contentSettings?.microphone;
  const id = globalThis.chrome?.runtime?.id || '';
  if (!api?.set || !id) {
    return { ok: false, method: 'none', message: 'contentSettings microphone API is not available.' };
  }

  const patterns = [`*://${id}/*`, `chrome-extension://${id}/*`];
  let lastError = null;
  for (const primaryPattern of patterns) {
    try {
      await api.set({ primaryPattern, setting: 'allow' });
      return { ok: true, method: 'contentSettings.microphone', primaryPattern };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, method: 'contentSettings.microphone', message: lastError?.message || String(lastError || 'Unable to grant extension media permission.') };
}

export async function clearExtensionOutputRoutingPermission() {
  const api = globalThis.chrome?.contentSettings?.microphone;
  const id = globalThis.chrome?.runtime?.id || '';
  if (!api?.set || !id) return { ok: false };
  try {
    await api.set({ primaryPattern: `*://${id}/*`, setting: 'ask' });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || String(error) };
  }
}

export async function listAudioOutputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [DEFAULT_AUDIO_OUTPUT_DEVICE];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => ({
      kind: device.kind,
      deviceId: normalizeOutputDeviceId(device.deviceId),
      groupId: device.groupId || '',
      label: cleanDeviceLabel(device.label, index, device.deviceId),
      isDefault: device.deviceId === 'default' || device.deviceId === ''
    }));

  const deduped = [];
  const seen = new Set();
  for (const device of [DEFAULT_AUDIO_OUTPUT_DEVICE, ...outputs]) {
    const key = device.deviceId || 'default';
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(device);
  }
  return deduped;
}

export async function detectAudioOutputDevices() {
  const grant = await grantExtensionOutputRoutingPermission();
  if (grant.ok) await sleep(80);
  const devices = await listAudioOutputDevices();
  return {
    ok: grant.ok,
    grant,
    devices,
    nonDefaultCount: devices.filter((device) => !device.isDefault && device.deviceId !== 'communications').length
  };
}

export async function requestAudioOutputDevice() {
  // AudioPick-style path: do not open selectAudioOutput() first.
  // We grant microphone access to the extension origin via contentSettings, then enumerate audiooutput.
  // This avoids the confusing browser chooser dismissal when the user only wants to reveal the device list.
  const result = await detectAudioOutputDevices();
  const selected = result.devices.find((device) => !device.isDefault && device.deviceId !== 'communications') || DEFAULT_AUDIO_OUTPUT_DEVICE;
  return { ...selected, detection: result };
}

export async function openBrowserAudioOutputChooser() {
  if (!navigator.mediaDevices?.selectAudioOutput) {
    throw new Error('Browser audio-output chooser is not available in this Chrome build.');
  }
  const selected = await navigator.mediaDevices.selectAudioOutput();
  return {
    kind: selected.kind || 'audiooutput',
    deviceId: normalizeOutputDeviceId(selected.deviceId),
    groupId: selected.groupId || '',
    label: selected.label || 'Selected output device',
    isDefault: selected.deviceId === 'default' || selected.deviceId === ''
  };
}

function cleanDeviceLabel(label, index, deviceId) {
  const text = String(label || '').trim();
  if (text) return text.replace(/\s+\(.*?\)$/g, (match) => match.length > 40 ? '' : match);
  if (deviceId === 'default' || deviceId === '') return 'System Default';
  if (deviceId === 'communications') return 'Communications';
  return index === 0 ? 'System Default' : `Output Device ${index + 1}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
