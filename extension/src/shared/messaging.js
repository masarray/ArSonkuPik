export function sendMessage(message) {
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

function assertOk(response, fallbackMessage = 'Extension command failed.') {
  if (!response?.ok) {
    throw new Error(response?.error || fallbackMessage);
  }
  return response;
}

export async function getEngineState() {
  const response = await sendMessage({ target: 'background', type: 'GET_STATE' });
  return assertOk(response, 'Unable to read extension state.').state;
}

export async function startEnhance(sourceTabId = null) {
  const message = { target: 'background', type: 'START_ENHANCE' };
  const tabId = Number(sourceTabId);
  if (Number.isInteger(tabId) && tabId > 0) message.sourceTabId = tabId;
  return assertOk(await sendMessage(message), 'Unable to start audio enhancement.');
}

export async function stopEnhance() {
  return assertOk(await sendMessage({ target: 'background', type: 'STOP_ENHANCE' }), 'Unable to stop audio enhancement.');
}

export async function applyPreset(preset) {
  return assertOk(await sendMessage({ target: 'background', type: 'APPLY_PRESET', presetId: preset?.id, preset }), 'Unable to apply preset.');
}

export async function updateEngineState(patch) {
  return assertOk(await sendMessage({ target: 'background', type: 'UPDATE_STATE', patch }), 'Unable to update audio engine.');
}

export async function saveCustomPreset(preset) {
  return assertOk(await sendMessage({ target: 'background', type: 'SAVE_CUSTOM_PRESET', preset }), 'Unable to save preset.');
}
