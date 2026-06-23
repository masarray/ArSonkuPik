import { FACTORY_PRESETS, PRIMARY_MASTER_PRESET_IDS } from '../shared/presets.js';
import { getEngineState, startEnhance, stopEnhance, applyPreset, updateEngineState, sendMessage } from '../shared/messaging.js';
import { detectAudioOutputDevices, normalizeOutputDeviceId, openBrowserAudioOutputChooser, requestAudioOutputDeviceListAccess } from '../shared/audio-devices.js';

const ui = {
  statusDot: document.getElementById('statusDot'),
  sourceTitle: document.getElementById('sourceTitle'),
  startStopButton: document.getElementById('startStopButton'),
  hintText: document.getElementById('hintText'),
  presetSelect: document.getElementById('presetSelect'),
  outputGain: document.getElementById('outputGain'),
  outputGainValue: document.getElementById('outputGainValue'),
  limiterToggle: document.getElementById('limiterToggle'),
  audioOutputSelect: document.getElementById('audioOutputSelect'),
  audioOutputHint: document.getElementById('audioOutputHint'),
  openStudioButton: document.getElementById('openStudioButton')
};

let state = null;
let presets = [...FACTORY_PRESETS];
let busy = false;
let outputDevicePopulateToken = 0;
const CHOOSE_OUTPUT_DEVICE_ID = '__choose_output__';
const UNLOCK_OUTPUT_DEVICE_ID = '__unlock_output_devices__';
const MASARI_PRESET_LABEL = 'MasAri';

init();

async function init() {
  bindEvents();
  await refreshState();
}

function bindEvents() {
  ui.startStopButton.addEventListener('click', async (event) => {
    if (busy) return;
    busy = true;
    const fullStop = Boolean(event.shiftKey || event.altKey);
    setHint(state?.active
      ? (fullStop ? 'Releasing tab capture…' : 'Switching enhance power without reopening YouTube audio…')
      : 'Starting capture for this tab…');
    try {
      const response = state?.active
        ? (fullStop ? await stopEnhance() : await toggleEnhanceBypass())
        : await startEnhanceWithAutoBypassOff();
      if (!response?.ok) throw new Error(response?.error || 'Command failed');
      await refreshState();
    } catch (error) {
      setHint(error.message);
    } finally {
      busy = false;
    }
  });

  ui.outputGain.addEventListener('input', async () => {
    const outputGain = Number(ui.outputGain.value);
    ui.outputGainValue.textContent = `${outputGain.toFixed(1)} dB`;
    state = { ...state, output: { ...state.output, outputGain } };
    await updateEngineState({ output: { outputGain } }).catch((error) => setHint(error.message));
  });

  ui.limiterToggle.addEventListener('change', async () => {
    const limiterEnabled = ui.limiterToggle.checked;
    state = { ...state, output: { ...state.output, limiterEnabled } };
    await updateEngineState({ output: { limiterEnabled } }).catch((error) => setHint(error.message));
  });

  ui.audioOutputSelect.addEventListener('change', async () => {
    const selected = getSelectedOutputDevice();
    if (selected.deviceId === CHOOSE_OUTPUT_DEVICE_ID) {
      await chooseBrowserOutputDevice().catch((error) => {
        restoreSelectedOutputDevice();
        setAudioOutputHint(error.message || 'Output device selection was cancelled.');
      });
      return;
    }
    if (selected.deviceId === UNLOCK_OUTPUT_DEVICE_ID) {
      await unlockOutputDevices().catch((error) => {
        restoreSelectedOutputDevice();
        setAudioOutputHint(error.message || 'Unable to unlock output device list.');
      });
      return;
    }
    await applyOutputDeviceSelection(selected).catch((error) => {
      setAudioOutputHint(error.message || 'Unable to route output.');
    });
  });

  ui.presetSelect.addEventListener('change', async () => {
    const preset = presets.find((candidate) => candidate.id === ui.presetSelect.value);
    if (!preset) return;
    await applyPreset(preset).catch((error) => setHint(error.message));
    await refreshState();
  });

  ui.openStudioButton.addEventListener('click', () => {
    sendMessage({ target: 'background', type: 'OPEN_STUDIO' }).catch((error) => setHint(error.message));
  });
}

async function refreshState() {
  const next = await getEngineState().catch((error) => {
    setHint(error.message);
    return null;
  });
  if (!next) return;
  state = next;
  presets = next.presets || FACTORY_PRESETS;
  render();
}


async function startEnhanceWithAutoBypassOff() {
  if (state?.output?.bypass === true) {
    setHint('Reactivating mastering chain…');
    state = { ...state, output: { ...state.output, bypass: false } };
    await updateEngineState({ output: { bypass: false } });
  }
  return startEnhance();
}

async function toggleEnhanceBypass() {
  const bypass = !Boolean(state?.output?.bypass);
  state = { ...state, output: { ...state.output, bypass } };
  setHint(bypass
    ? 'Enhance off. Capture kept warm so YouTube does not renegotiate playback.'
    : 'Enhance on. Reusing the same capture stream.');
  return updateEngineState({ output: { bypass } });
}

function getPresetDisplayName(preset) {
  if (!preset) return MASARI_PRESET_LABEL;
  if (preset.id === 'default') return MASARI_PRESET_LABEL;
  return preset.name || MASARI_PRESET_LABEL;
}

function render() {
  const isActive = Boolean(state.active);
  const isBypassed = Boolean(state.output?.bypass);
  ui.statusDot.classList.toggle('active', isActive && !isBypassed);
  ui.statusDot.classList.toggle('warm', isActive && isBypassed);
  ui.sourceTitle.textContent = state.sourceTitle || 'No active capture';
  ui.startStopButton.hidden = false;
  ui.startStopButton.textContent = !isActive ? 'Start Enhance' : (isBypassed ? 'Enhance On' : 'Enhance Off');
  ui.startStopButton.title = isActive
    ? 'Click toggles mastering bypass without reopening capture. Shift-click releases tab capture fully.'
    : 'Start local tab capture and audio enhancement.';
  ui.startStopButton.classList.toggle('danger', isActive && !isBypassed);
  const outputGain = Number(state.output?.outputGain ?? -1.6);
  ui.outputGain.value = outputGain;
  ui.outputGainValue.textContent = `${outputGain.toFixed(1)} dB`;
  ui.limiterToggle.checked = Boolean(state.output?.limiterEnabled);
  renderPresets();
  autoPopulateOutputDevices(state.output?.outputDeviceId).catch((error) => setAudioOutputHint(error.message));
  renderOutputRouteHint();
  setHint(isActive
    ? (isBypassed ? 'Enhance is off but capture is kept warm to avoid YouTube buffering.' : 'Enhancing this tab locally.')
    : 'Audio is processed locally. No recording, no upload.');
}

function renderPresets() {
  // Mirror the studio master preset list exactly (primary masters + custom), with
  // factory fallback so the native select never opens as an empty list.
  const source = Array.isArray(presets) && presets.length ? presets : FACTORY_PRESETS;
  const primary = source.filter((preset) => PRIMARY_MASTER_PRESET_IDS.includes(preset.id));
  const custom = source.filter((preset) => !FACTORY_PRESETS.some((factory) => factory.id === preset.id));
  const fallbackPrimary = FACTORY_PRESETS.filter((preset) => PRIMARY_MASTER_PRESET_IDS.includes(preset.id));
  const ordered = [...(primary.length ? primary : fallbackPrimary), ...custom].filter((preset, index, list) => (
    preset?.id && list.findIndex((candidate) => candidate.id === preset.id) === index
  ));
  const selectedId = state.selectedPresetId || 'default';
  const isKnown = ordered.some((preset) => preset.id === selectedId);
  const desired = ordered.map((preset) => preset.id).join('|') + `|${isKnown ? '' : 'custom'}`;
  if (ui.presetSelect.dataset.optionIds !== desired) {
    ui.presetSelect.innerHTML = '';
    if (!isKnown) {
      const customOpt = document.createElement('option');
      customOpt.value = '';
      customOpt.textContent = MASARI_PRESET_LABEL;
      ui.presetSelect.appendChild(customOpt);
    }
    for (const preset of ordered) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = getPresetDisplayName(preset);
      option.title = preset.description || preset.name;
      ui.presetSelect.appendChild(option);
    }
    ui.presetSelect.dataset.optionIds = desired;
  }
  ui.presetSelect.value = isKnown ? selectedId : '';
}

function setHint(message) {
  ui.hintText.textContent = message;
}

async function autoPopulateOutputDevices(selectedDeviceId = 'default') {
  const token = ++outputDevicePopulateToken;
  const selectedId = normalizeOutputDeviceId(selectedDeviceId);
  setAudioOutputHint('Checking output devices…');

  const detection = await detectAudioOutputDevices();
  if (token !== outputDevicePopulateToken) return;

  const devices = detection.devices || [];
  ui.audioOutputSelect.innerHTML = '';
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.isDefault ? 'System Default' : device.label;
    option.dataset.label = device.label;
    option.selected = device.deviceId === selectedId;
    ui.audioOutputSelect.appendChild(option);
  }
  if (![...ui.audioOutputSelect.options].some((option) => option.value === selectedId)) {
    const option = document.createElement('option');
    option.value = selectedId;
    option.textContent = state.output?.outputDeviceLabel || 'Previously selected device';
    option.dataset.label = option.textContent;
    option.selected = true;
    ui.audioOutputSelect.appendChild(option);
  }

  appendUnlockOutputOption(detection.nonDefaultCount === 0 && detection.accessUnlockAvailable);
  appendChooseOutputOption(detection.chooserAvailable);

  if (detection.nonDefaultCount === 0) {
    setAudioOutputHint(detection.accessUnlockAvailable
      ? 'System Default only. Unlock device list… grants local output-device access; no mic audio is recorded.'
      : detection.chooserAvailable
        ? 'System Default only. Choose output device… to unlock USB/VB-Cable routing.'
        : 'System Default only. Check USB/VB-Cable in Windows Sound.');
    return;
  }
  renderOutputRouteHint();
}

function getSelectedOutputDevice() {
  const option = ui.audioOutputSelect.selectedOptions?.[0];
  if (option?.value === CHOOSE_OUTPUT_DEVICE_ID) {
    return { deviceId: CHOOSE_OUTPUT_DEVICE_ID, label: 'Choose output device…' };
  }
  if (option?.value === UNLOCK_OUTPUT_DEVICE_ID) {
    return { deviceId: UNLOCK_OUTPUT_DEVICE_ID, label: 'Unlock device list…' };
  }
  return {
    deviceId: normalizeOutputDeviceId(option?.value || 'default'),
    label: option?.dataset?.label || option?.textContent || 'System Default'
  };
}

function appendUnlockOutputOption(accessUnlockAvailable) {
  if (!accessUnlockAvailable) return;
  const option = document.createElement('option');
  option.value = UNLOCK_OUTPUT_DEVICE_ID;
  option.textContent = 'Unlock device list…';
  option.dataset.label = option.textContent;
  ui.audioOutputSelect.appendChild(option);
}

function appendChooseOutputOption(chooserAvailable) {
  if (!chooserAvailable) return;
  const option = document.createElement('option');
  option.value = CHOOSE_OUTPUT_DEVICE_ID;
  option.textContent = 'Choose output device…';
  option.dataset.label = option.textContent;
  ui.audioOutputSelect.appendChild(option);
}

async function unlockOutputDevices() {
  setAudioOutputHint('Unlocking local output-device list… no microphone audio is recorded.');
  const access = await requestAudioOutputDeviceListAccess();
  if (access?.selectedDevice) await applyOutputDeviceSelection(access.selectedDevice);
  await autoPopulateOutputDevices(access?.selectedDevice?.deviceId || state?.output?.outputDeviceId || 'default');
}

async function chooseBrowserOutputDevice() {
  setAudioOutputHint('Opening Chrome output chooser…');
  const selected = await openBrowserAudioOutputChooser();
  await applyOutputDeviceSelection(selected);
  await autoPopulateOutputDevices(selected.deviceId);
}

function restoreSelectedOutputDevice() {
  const selectedId = normalizeOutputDeviceId(state?.output?.outputDeviceId || 'default');
  const option = [...ui.audioOutputSelect.options].find((candidate) => candidate.value === selectedId);
  if (option) option.selected = true;
}

async function applyOutputDeviceSelection(device) {
  const outputDeviceId = normalizeOutputDeviceId(device?.deviceId);
  const outputDeviceLabel = outputDeviceId === 'default' ? 'System Default' : (device?.label || 'Selected output device');
  state = { ...state, output: { ...state.output, outputDeviceId, outputDeviceLabel } };
  renderOutputRouteHint();
  const response = await updateEngineState({ output: { outputDeviceId, outputDeviceLabel } });
  if (!response?.ok) throw new Error(response?.error || 'Unable to route output device.');
  if (response.state) state = response.state;
  renderOutputRouteHint(true);
}

function renderOutputRouteHint(justSaved = false) {
  const label = state?.output?.outputDeviceLabel || 'System Default';
  const status = state?.output?.outputRouteStatus || (state?.output?.outputDeviceId === 'default' ? 'default' : 'selected');
  const routed = status === 'routed';
  const failed = status === 'failed' || status === 'unsupported' || status === 'playback-blocked';
  const prefix = failed ? 'Route issue' : routed ? 'Routed' : 'Output';
  const domain = state?.currentDomain ? ` · saved for ${state.currentDomain}` : '';
  const suffix = justSaved ? domain || ' · saved' : domain;
  setAudioOutputHint(`${prefix}: ${label}${suffix}`);
}

function setAudioOutputHint(message) {
  ui.audioOutputHint.textContent = message;
}
