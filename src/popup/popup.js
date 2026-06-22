import { FACTORY_PRESETS } from '../shared/presets.js';
import { getEngineState, startEnhance, stopEnhance, applyPreset, updateEngineState, sendMessage } from '../shared/messaging.js';
import { detectAudioOutputDevices, normalizeOutputDeviceId } from '../shared/audio-devices.js';

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
const QUICK_PRESET_IDS = ['pro-music', 'movie-dolby', 'podcast'];
const QUICK_PRESET_LABELS = { 'pro-music': 'Music', 'movie-dolby': 'Movie', podcast: 'Podcast' };
let busy = false;
let outputDevicePopulateToken = 0;

init();

async function init() {
  bindEvents();
  await refreshState();
}

function bindEvents() {
  ui.startStopButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    setHint(state?.active ? 'Stopping audio engine…' : 'Starting capture for this tab…');
    try {
      const response = state?.active ? await stopEnhance() : await startEnhance();
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

function render() {
  ui.statusDot.classList.toggle('active', Boolean(state.active));
  ui.sourceTitle.textContent = state.sourceTitle || 'No active capture';
  ui.startStopButton.textContent = state.active ? 'Stop Enhance' : 'Start Enhance';
  ui.startStopButton.classList.toggle('danger', Boolean(state.active));
  ui.outputGain.value = state.output?.outputGain ?? 0;
  ui.outputGainValue.textContent = `${Number(ui.outputGain.value).toFixed(1)} dB`;
  ui.limiterToggle.checked = Boolean(state.output?.limiterEnabled);
  renderPresets();
  autoPopulateOutputDevices(state.output?.outputDeviceId).catch((error) => setAudioOutputHint(error.message));
  renderOutputRouteHint();
  setHint(state.active ? 'Enhancing this tab locally.' : 'Audio is processed locally. No recording, no upload.');
}

function renderPresets() {
  const quickPresets = QUICK_PRESET_IDS
    .map((id) => presets.find((preset) => preset.id === id))
    .filter(Boolean);
  const desired = quickPresets.map((preset) => preset.id).join('|');
  if (ui.presetSelect.dataset.optionIds !== desired) {
    ui.presetSelect.innerHTML = '';
    for (const preset of quickPresets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = QUICK_PRESET_LABELS[preset.id] || preset.name;
      option.title = preset.description || preset.name;
      ui.presetSelect.appendChild(option);
    }
    ui.presetSelect.dataset.optionIds = desired;
  }
  if (quickPresets.some((preset) => preset.id === state.selectedPresetId)) {
    ui.presetSelect.value = state.selectedPresetId;
  } else if (ui.presetSelect.options.length) {
    ui.presetSelect.selectedIndex = 0;
  }
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

  if (detection.nonDefaultCount === 0) {
    setAudioOutputHint('Auto-detect: System Default only. Check USB/VB-Cable in Windows Sound.');
    return;
  }
  renderOutputRouteHint();
}

function getSelectedOutputDevice() {
  const option = ui.audioOutputSelect.selectedOptions?.[0];
  return {
    deviceId: normalizeOutputDeviceId(option?.value || 'default'),
    label: option?.dataset?.label || option?.textContent || 'System Default'
  };
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
