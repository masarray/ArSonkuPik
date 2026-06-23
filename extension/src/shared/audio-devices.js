export const DEFAULT_AUDIO_OUTPUT_DEVICE = {
  deviceId: 'default',
  label: 'System Default',
  kind: 'audiooutput',
  isDefault: true
};

const EXTENSION_MIC_ACCESS_PATTERN = () => `*://${chrome.runtime.id}/*`;

export function normalizeOutputDeviceId(deviceId) {
  const value = String(deviceId || 'default').trim();
  return value && value !== 'undefined' && value !== 'null' ? value : 'default';
}

export function deviceIdToSinkId(deviceId) {
  const normalized = normalizeOutputDeviceId(deviceId);
  return normalized === 'default' ? '' : normalized;
}

export function canUseBrowserAudioOutputChooser() {
  return typeof navigator.mediaDevices?.selectAudioOutput === 'function';
}

export function canUseAudioPickPermissionModel() {
  return Boolean(globalThis.chrome?.contentSettings?.microphone?.set && globalThis.chrome?.runtime?.id);
}

export function canRequestAudioOutputDeviceListAccess() {
  return canUseAudioPickPermissionModel() || canUseBrowserAudioOutputChooser();
}

export async function listAudioOutputDevices(extraDevices = []) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return uniqueAudioOutputs([DEFAULT_AUDIO_OUTPUT_DEVICE, ...extraDevices]);
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => toAudioOutputDevice(device, index));

  return uniqueAudioOutputs([DEFAULT_AUDIO_OUTPUT_DEVICE, ...outputs, ...extraDevices]);
}

export async function detectAudioOutputDevices(options = {}) {
  const requestAccess = Boolean(options?.requestAccess);
  let accessError = '';
  let selectedDevice = null;

  // Store-safe behavior: automatic rendering only enumerates what Chrome already
  // exposes. The extension-origin audio-device permission is applied only after
  // the user explicitly selects "Unlock device list…" or a browser output
  // chooser option. This keeps output routing transparent and user-initiated.
  if (requestAccess && canUseAudioPickPermissionModel()) {
    await setExtensionMicrophoneAccess('allow').catch((error) => {
      accessError = error?.message || String(error || 'Unable to unlock extension audio-device access.');
    });
  }

  let devices = await listAudioOutputDevices().catch(() => [DEFAULT_AUDIO_OUTPUT_DEVICE]);
  let nonDefaultCount = countNonDefaultAudioOutputs(devices);

  if (requestAccess && nonDefaultCount === 0) {
    try {
      const access = await requestAudioOutputDeviceListAccess();
      selectedDevice = access.selectedDevice || null;
      devices = await listAudioOutputDevices(selectedDevice ? [selectedDevice] : []).catch(() => access.devices || devices);
      nonDefaultCount = countNonDefaultAudioOutputs(devices);
      accessError = '';
    } catch (error) {
      accessError = error?.message || String(error || 'Unable to unlock audio output device list.');
    }
  }

  return {
    ok: !accessError,
    method: 'enumerateDevices',
    permissionModel: requestAccess && canUseAudioPickPermissionModel() ? 'contentSettings.microphone' : 'browser-default',
    chooserAvailable: canUseBrowserAudioOutputChooser(),
    accessUnlockAvailable: canRequestAudioOutputDeviceListAccess(),
    accessError,
    selectedDevice,
    devices: uniqueAudioOutputs(devices),
    nonDefaultCount
  };
}

export async function requestAudioOutputDeviceListAccess() {
  if (!canRequestAudioOutputDeviceListAccess()) {
    throw new Error('This browser cannot request audio output device access.');
  }

  const errors = [];
  let selectedDevice = null;

  // Primary path: AudioPick-compatible. This exposes the output list to the
  // extension origin without opening a fragile microphone prompt in the popup.
  if (canUseAudioPickPermissionModel()) {
    try {
      await setExtensionMicrophoneAccess('allow');
      const devices = await listAudioOutputDevices();
      if (countNonDefaultAudioOutputs(devices) > 0) return { devices, selectedDevice };
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  // Secondary path: official speaker chooser. Use only from a direct user
  // gesture. The selected device is added even if enumerateDevices is still
  // conservative afterwards.
  if (canUseBrowserAudioOutputChooser()) {
    try {
      selectedDevice = await openBrowserAudioOutputChooser();
      const devices = await listAudioOutputDevices([selectedDevice]).catch(() => [DEFAULT_AUDIO_OUTPUT_DEVICE, selectedDevice]);
      return { devices, selectedDevice };
    } catch (error) {
      errors.push(error?.name === 'AbortError' || error?.name === 'NotAllowedError'
        ? 'Output chooser was cancelled.'
        : (error?.message || String(error)));
    }
  }

  // Do not fall back to getUserMedia({ audio: true }) for Store builds. Output
  // routing should not open a microphone stream; if Chrome cannot expose output
  // devices through contentSettings or selectAudioOutput(), keep System Default.

  if (selectedDevice) return { devices: uniqueAudioOutputs([DEFAULT_AUDIO_OUTPUT_DEVICE, selectedDevice]), selectedDevice };
  throw new Error(errors.filter(Boolean).join(' · ') || 'No non-default output device was exposed by Chrome.');
}

export async function requestAudioOutputDevice() {
  return openBrowserAudioOutputChooser();
}

export async function openBrowserAudioOutputChooser() {
  if (!canUseBrowserAudioOutputChooser()) {
    throw new Error('Browser audio-output chooser is not available in this Chrome build.');
  }
  const selected = await navigator.mediaDevices.selectAudioOutput();
  return toAudioOutputDevice(selected, 0);
}

export async function setExtensionMicrophoneAccess(setting = 'allow') {
  if (!canUseAudioPickPermissionModel()) return false;
  const primaryPattern = EXTENSION_MIC_ACCESS_PATTERN();
  return chrome.contentSettings.microphone.set({
    primaryPattern,
    scope: 'regular',
    setting
  });
}

export function watchAudioOutputDeviceChanges(callback) {
  if (typeof callback !== 'function' || !navigator.mediaDevices?.addEventListener) return () => {};
  const handler = () => callback();
  navigator.mediaDevices.addEventListener('devicechange', handler);
  return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
}

function toAudioOutputDevice(device, index = 0) {
  const deviceId = normalizeOutputDeviceId(device?.deviceId);
  const isDefault = deviceId === 'default' || deviceId === '';
  return {
    kind: 'audiooutput',
    deviceId: isDefault ? 'default' : deviceId,
    groupId: device?.groupId || '',
    label: cleanDeviceLabel(device?.label, index, deviceId),
    isDefault
  };
}

function uniqueAudioOutputs(devices = []) {
  const output = [];
  const seen = new Set();
  for (const device of [DEFAULT_AUDIO_OUTPUT_DEVICE, ...devices]) {
    const normalized = normalizeOutputDeviceId(device?.deviceId);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push({
      kind: 'audiooutput',
      deviceId: normalized,
      groupId: device?.groupId || '',
      label: normalized === 'default' ? 'System Default' : (device?.label || cleanDeviceLabel('', output.length, normalized)),
      isDefault: normalized === 'default'
    });
  }
  return output;
}

function countNonDefaultAudioOutputs(devices = []) {
  return devices.filter((device) => !device.isDefault && device.deviceId !== 'communications').length;
}

function cleanDeviceLabel(label, index, deviceId) {
  const text = String(label || '').trim();
  if (text) return text.replace(/\s+\(.*?\)$/g, (match) => match.length > 40 ? '' : match);
  if (deviceId === 'default' || deviceId === '') return 'System Default';
  if (deviceId === 'communications') return 'Communications';
  return index <= 0 ? 'Selected output device' : `Output Device ${index + 1}`;
}
