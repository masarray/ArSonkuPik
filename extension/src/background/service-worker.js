import { createDefaultState, FACTORY_PRESETS, DEFAULT_MASTER_REVISION, applyPresetToState, normalizeEqBands, normalizeCompressor, normalizeColor, normalizeWidth, normalizeOutput } from '../shared/presets.js';

const OFFSCREEN_URL = 'offscreen.html';
const STORE_KEYS = {
  state: 'arAudioState',
  customPresets: 'arAudioCustomPresets',
  domainOutputRoutes: 'arAudioDomainOutputRoutes'
};

let lastState = createDefaultState();
let creatingOffscreenDocument = null;
let studioTabId = null;

function createSilentMeters() {
  return {
    inputPeak: 0,
    outputPeak: 0,
    gainReduction: 0,
    compressorGainReduction: 0,
    compressorGainReductionLeft: 0,
    compressorGainReductionRight: 0,
    limiterGainReduction: 0,
    inputPeakLeft: 0,
    inputPeakRight: 0,
    outputPeakLeft: 0,
    outputPeakRight: 0,
    correlation: 1,
    clipping: false
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureStorageDefaults();
});

chrome.runtime.onStartup?.addListener(async () => {
  await ensureStorageDefaults();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'background') {
    return false;
  }

  handleBackgroundMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target === 'background-state' && message.type === 'STATE_CHANGED') {
    lastState = prepareStateForStorage({ ...lastState, ...message.state });
    chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  }
  return false;
});

chrome.tabCapture?.onStatusChanged?.addListener((info) => {
  if (info.status === 'stopped' || info.status === 'error') {
    safeSendMessage({ target: 'offscreen', type: 'CAPTURE_STOPPED', tabId: info.tabId });
    markCaptureInactiveIfMatches(info.tabId).catch(() => {});
  }
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  if (Number(tabId) === Number(studioTabId)) studioTabId = null;
  markCaptureInactiveIfMatches(tabId).catch(() => {});
});


function shouldRefreshFactoryDefaultMaster(state) {
  return (state?.selectedPresetId || 'default') === 'default' && state?.defaultMasterRevision !== DEFAULT_MASTER_REVISION;
}

async function ensureStorageDefaults() {
  const current = await chrome.storage.local.get([STORE_KEYS.state, STORE_KEYS.customPresets, STORE_KEYS.domainOutputRoutes]);
  if (!current[STORE_KEYS.state]) {
    lastState = createDefaultState();
    await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  } else {
    const storedState = current[STORE_KEYS.state];
    lastState = prepareStateForStorage({ ...createDefaultState(), ...storedState });
    if (shouldRefreshFactoryDefaultMaster(storedState)) {
      const defaultPreset = FACTORY_PRESETS.find((preset) => preset.id === 'default') || FACTORY_PRESETS[0];
      lastState = prepareStateForStorage(applyPresetToState(lastState, defaultPreset));
    }
    await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  }
  if (!current[STORE_KEYS.customPresets]) {
    await chrome.storage.local.set({ [STORE_KEYS.customPresets]: [] });
  }
  if (!current[STORE_KEYS.domainOutputRoutes]) {
    await chrome.storage.local.set({ [STORE_KEYS.domainOutputRoutes]: {} });
  }
}

async function handleBackgroundMessage(message, sender = null) {
  await ensureStorageDefaults();
  switch (message.type) {
    case 'GET_STATE':
      return { ok: true, state: await getStateWithPresets() };
    case 'START_ENHANCE':
      return startEnhance(message.sourceTabId);
    case 'STOP_ENHANCE':
      return stopEnhance();
    case 'OPEN_STUDIO':
      return openStudioSingleton();
    case 'REGISTER_STUDIO':
      if (sender?.tab?.id) studioTabId = sender.tab.id;
      return { ok: true };
    case 'APPLY_PRESET':
      return applyPresetCommand(message.preset || await findPresetById(message.presetId));
    case 'UPDATE_STATE':
      return updateStateCommand(message.patch || {});
    case 'SAVE_CUSTOM_PRESET':
      return saveCustomPreset(message.preset);
    default:
      throw new Error(`Unknown background message: ${message.type}`);
  }
}

async function getStateWithPresets() {
  const stored = await chrome.storage.local.get([STORE_KEYS.state, STORE_KEYS.customPresets, STORE_KEYS.domainOutputRoutes]);
  const customPresets = stored[STORE_KEYS.customPresets] || [];
  const domainRoutes = stored[STORE_KEYS.domainOutputRoutes] || {};
  lastState = prepareStateForStorage({ ...createDefaultState(), ...(stored[STORE_KEYS.state] || lastState) });
  const availablePresets = [...FACTORY_PRESETS, ...customPresets];
  if (!availablePresets.some((preset) => preset.id === lastState.selectedPresetId)) {
    lastState = prepareStateForStorage(applyPresetToState(lastState, FACTORY_PRESETS.find((preset) => preset.id === 'default') || FACTORY_PRESETS[0]));
    await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  }
  const context = await getAudioDomainContext(lastState);
  const route = context.domain ? domainRoutes[context.domain] : null;
  if (route?.outputDeviceId) {
    const sameDevice = lastState.output?.outputDeviceId === route.outputDeviceId;
    lastState = prepareStateForStorage({
      ...lastState,
      output: {
        ...lastState.output,
        outputDeviceId: route.outputDeviceId,
        outputDeviceLabel: route.outputDeviceLabel || lastState.output?.outputDeviceLabel || 'Selected output device',
        outputRouteStatus: sameDevice ? lastState.output?.outputRouteStatus : 'selected'
      }
    });
    await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  }

  return {
    ...lastState,
    presets: [...FACTORY_PRESETS, ...customPresets],
    currentDomain: context.domain || ''
  };
}

async function openStudioSingleton() {
  const sourceTabId = await getActiveCaptureCandidateTabId();
  const path = sourceTabId ? `studio.html?sourceTabId=${sourceTabId}` : 'studio.html';
  const desiredUrl = chrome.runtime.getURL(path);
  const existing = await findExistingStudioTab();
  if (existing?.id) {
    studioTabId = existing.id;
    const currentUrl = existing.pendingUrl || existing.url || '';
    const update = { active: true };
    if (shouldUpdateStudioSourceUrl(currentUrl, sourceTabId)) update.url = desiredUrl;
    await chrome.tabs.update(existing.id, update);
    if (existing.windowId && chrome.windows?.update) {
      await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    }
    return { ok: true, reused: true, tabId: existing.id };
  }

  const created = await chrome.tabs.create({ url: desiredUrl, active: true });
  studioTabId = created?.id || null;
  return { ok: true, reused: false, tabId: studioTabId };
}

async function findExistingStudioTab() {
  const studioUrl = chrome.runtime.getURL('studio.html');
  if (studioTabId) {
    try {
      const tab = await chrome.tabs.get(studioTabId);
      const tabUrl = tab?.pendingUrl || tab?.url || '';
      if (tabUrl.startsWith(studioUrl)) return tab;
    } catch {
      studioTabId = null;
    }
  }

  try {
    const tabs = await chrome.tabs.query({ url: `${studioUrl}*` });
    const tab = tabs.find((candidate) => (candidate.pendingUrl || candidate.url || '').startsWith(studioUrl));
    if (tab?.id) {
      studioTabId = tab.id;
      return tab;
    }
  } catch {
    // URL-scoped tab queries can be unavailable in restricted enterprise setups.
  }
  return null;
}

function shouldUpdateStudioSourceUrl(currentUrl, sourceTabId) {
  if (!sourceTabId) return false;
  try {
    const parsed = new URL(currentUrl);
    return Number(parsed.searchParams.get('sourceTabId')) !== Number(sourceTabId);
  } catch {
    return true;
  }
}

async function getActiveCaptureCandidateTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return isCapturableTab(tab) ? tab.id : null;
  } catch {
    return null;
  }
}

async function resolveCaptureTab(sourceTabId = null) {
  const requestedTabId = Number(sourceTabId);
  if (Number.isInteger(requestedTabId) && requestedTabId > 0) {
    try {
      const requested = await chrome.tabs.get(requestedTabId);
      if (isCapturableTab(requested)) return requested;
    } catch {
      // Fall back to the active tab below.
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isCapturableTab(tab) {
  if (!tab?.id || !tab?.url) return false;
  try {
    const parsed = new URL(tab.url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function cleanupCaptureBeforeStart() {
  await safeSendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' });
  lastState = prepareStateForStorage({
    ...lastState,
    active: false,
    tabId: null,
    sourceTitle: 'No active capture',
    meters: createSilentMeters(),
    updatedAt: Date.now()
  });
  await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  await sleep(60);
}

async function requestCaptureStreamIdWithRetry(tabId) {
  try {
    return await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (error) {
    const message = error?.message || String(error);
    if (!/active stream/i.test(message)) throw error;
    await cleanupCaptureBeforeStart();
    return chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  }
}

async function cleanupFailedStart() {
  await safeSendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' });
  lastState = prepareStateForStorage({
    ...lastState,
    active: false,
    tabId: null,
    sourceTitle: 'No active capture',
    meters: createSilentMeters(),
    updatedAt: Date.now()
  });
  await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
}

async function startEnhance(sourceTabId = null) {
  const tab = await resolveCaptureTab(sourceTabId);
  if (!tab?.id) {
    throw new Error('No active tab found. Open a tab with audio first.');
  }

  if (!isCapturableTab(tab)) {
    throw new Error('Open a normal web audio tab first, then start from the extension popup or Studio.');
  }

  await ensureOffscreenDocument();
  await cleanupCaptureBeforeStart();

  const streamId = await requestCaptureStreamIdWithRetry(tab.id);
  const title = tab.title || 'Current tab';
  await applyStoredDomainOutputRouteForTab(tab);
  const stateBeforeStart = await getStateWithPresets();

  let response = null;
  try {
    response = await sendMessageWithResponse({
      target: 'offscreen',
      type: 'START_CAPTURE',
      streamId,
      tabId: tab.id,
      sourceTitle: title,
      initialState: stateBeforeStart
    });
  } catch (error) {
    await cleanupFailedStart();
    throw error;
  }

  if (!response?.ok) {
    await cleanupFailedStart();
    throw new Error(response?.error || 'Unable to start audio engine. Reload the extension and try again.');
  }

  lastState = prepareStateForStorage({
    ...lastState,
    active: true,
    tabId: tab.id,
    sourceTitle: title,
    updatedAt: Date.now()
  });
  await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  return { ok: true, state: await getStateWithPresets() };
}

async function stopEnhance() {
  await safeSendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' });
  lastState = prepareStateForStorage({
    ...lastState,
    active: false,
    tabId: null,
    sourceTitle: 'No active capture',
    meters: createSilentMeters(),
    updatedAt: Date.now()
  });
  await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  return { ok: true, state: await getStateWithPresets() };
}

async function markCaptureInactiveIfMatches(tabId) {
  const stored = await chrome.storage.local.get(STORE_KEYS.state);
  const current = prepareStateForStorage({ ...createDefaultState(), ...(stored[STORE_KEYS.state] || lastState) });
  if (!current.active || Number(current.tabId) !== Number(tabId)) return;
  lastState = prepareStateForStorage({
    ...current,
    active: false,
    tabId: null,
    sourceTitle: 'No active capture',
    meters: createSilentMeters(),
    updatedAt: Date.now()
  });
  await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
}

async function applyPresetCommand(preset) {
  if (!preset) {
    throw new Error('Preset not found.');
  }
  const stored = await chrome.storage.local.get(STORE_KEYS.state);
  lastState = prepareStateForStorage(applyPresetToState({ ...createDefaultState(), ...(stored[STORE_KEYS.state] || lastState) }, preset));
  await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  await sendToOffscreenIfActive({ target: 'offscreen', type: 'APPLY_PRESET', preset }).catch(() => {});
  return { ok: true, state: await getStateWithPresets() };
}

async function updateStateCommand(patch) {
  const stored = await chrome.storage.local.get(STORE_KEYS.state);
  lastState = prepareStateForStorage(deepMerge({ ...createDefaultState(), ...(stored[STORE_KEYS.state] || lastState) }, patch));
  lastState.updatedAt = Date.now();
  await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  await saveDomainOutputRouteIfNeeded(patch, lastState);

  const offscreenResponse = await sendToOffscreenIfActive({ target: 'offscreen', type: 'UPDATE_STATE', patch }).catch(() => null);
  if (offscreenResponse?.ok && offscreenResponse.state) {
    lastState = prepareStateForStorage({ ...lastState, ...offscreenResponse.state, output: { ...lastState.output, ...offscreenResponse.state.output } });
    lastState.updatedAt = Date.now();
    await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  }

  return { ok: true, state: await getStateWithPresets() };
}


async function applyStoredDomainOutputRouteForTab(tab) {
  const domain = getDomainFromUrl(tab?.url || '');
  if (!domain) return null;
  const stored = await chrome.storage.local.get([STORE_KEYS.domainOutputRoutes, STORE_KEYS.state]);
  const route = stored[STORE_KEYS.domainOutputRoutes]?.[domain];
  if (!route?.outputDeviceId) return null;
  lastState = prepareStateForStorage({
    ...createDefaultState(),
    ...(stored[STORE_KEYS.state] || lastState),
    output: {
      ...(stored[STORE_KEYS.state]?.output || lastState.output),
      outputDeviceId: route.outputDeviceId,
      outputDeviceLabel: route.outputDeviceLabel || 'Selected output device',
      outputRouteStatus: 'selected'
    }
  });
  await chrome.storage.local.set({ [STORE_KEYS.state]: lastState });
  return route;
}

async function saveDomainOutputRouteIfNeeded(patch, state) {
  if (patch?.output?.outputDeviceId === undefined && patch?.output?.outputDeviceLabel === undefined) return;
  const context = await getAudioDomainContext(state);
  if (!context.domain) return;
  const output = state.output || {};
  const route = {
    outputDeviceId: output.outputDeviceId || 'default',
    outputDeviceLabel: output.outputDeviceLabel || 'System Default',
    updatedAt: Date.now()
  };
  const stored = await chrome.storage.local.get(STORE_KEYS.domainOutputRoutes);
  const routes = stored[STORE_KEYS.domainOutputRoutes] || {};
  routes[context.domain] = route;
  await chrome.storage.local.set({ [STORE_KEYS.domainOutputRoutes]: routes });
}

async function getAudioDomainContext(state) {
  const activeState = state || lastState;
  if (activeState?.active && activeState.tabId) {
    try {
      const tab = await chrome.tabs.get(activeState.tabId);
      const domain = getDomainFromUrl(tab?.url || '');
      if (domain) return { tab, domain };
    } catch {
      // Fall back to active tab below.
    }
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const domain = getDomainFromUrl(tab?.url || '');
    if (domain) return { tab, domain };
  } catch {
    return { tab: null, domain: '' };
  }
  return { tab: null, domain: '' };
}

function getDomainFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

async function findPresetById(id) {
  const stored = await chrome.storage.local.get(STORE_KEYS.customPresets);
  const presets = [...FACTORY_PRESETS, ...(stored[STORE_KEYS.customPresets] || [])];
  return presets.find((preset) => preset.id === id);
}

async function sendToOffscreenIfActive(message) {
  if (!(await hasOffscreenDocument())) return null;
  return sendMessageWithResponse(message);
}

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  if (!chrome.runtime.getContexts) return false;
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });
  return Boolean(existingContexts?.length);
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  if (await hasOffscreenDocument()) {
    return;
  }

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Consume captured tab audio and process it locally with the Web Audio API.'
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}

function sendMessageWithResponse(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function safeSendMessage(message) {
  try {
    await sendMessageWithResponse(message);
  } catch {
    return null;
  }
  return null;
}

function prepareStateForStorage(state) {
  return {
    ...createDefaultState(),
    ...state,
    eq: normalizeEqBands(state.eq),
    compressor: normalizeCompressor(state.compressor),
    color: normalizeColor(state.color),
    width: normalizeWidth(state.width),
    output: normalizeOutput(state.output)
  };
}

function deepMerge(target, patch) {
  if (!patch || typeof patch !== 'object') return target;
  if (Array.isArray(patch)) return patch;
  const output = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      output[key] = value.map((item) => (typeof item === 'object' ? { ...item } : item));
    } else if (value && typeof value === 'object') {
      output[key] = deepMerge(target?.[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

async function saveCustomPreset(preset) {
  if (!preset?.name || !Array.isArray(preset.eq)) {
    throw new Error('Invalid custom preset.');
  }

  const stored = await chrome.storage.local.get(STORE_KEYS.customPresets);
  const current = stored[STORE_KEYS.customPresets] || [];
  const cleanedName = String(preset.name).trim().slice(0, 48);
  const customPreset = {
    ...preset,
    eq: normalizeEqBands(preset.eq),
    compressor: normalizeCompressor(preset.compressor),
    color: normalizeColor(preset.color),
    width: normalizeWidth(preset.width),
    output: normalizeOutput(preset.output),
    id: `custom-${Date.now()}`,
    name: cleanedName,
    description: preset.description || 'Custom tuning',
    custom: true
  };

  const next = [customPreset, ...current].slice(0, 24);
  const storedState = await chrome.storage.local.get(STORE_KEYS.state);
  lastState = prepareStateForStorage({
    ...createDefaultState(),
    ...(storedState[STORE_KEYS.state] || lastState),
    selectedPresetId: customPreset.id,
    eq: customPreset.eq,
    compressor: customPreset.compressor,
    color: customPreset.color,
    width: customPreset.width,
    output: customPreset.output,
    updatedAt: Date.now()
  });
  await chrome.storage.local.set({
    [STORE_KEYS.customPresets]: next,
    [STORE_KEYS.state]: lastState
  });
  await sendToOffscreenIfActive({ target: 'offscreen', type: 'UPDATE_STATE', patch: { selectedPresetId: customPreset.id } }).catch(() => {});
  return { ok: true, presets: [...FACTORY_PRESETS, ...next], state: await getStateWithPresets() };
}
