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

export async function getEngineState() {
  const response = await sendMessage({ target: 'background', type: 'GET_STATE' });
  return response?.state;
}

export async function startEnhance() {
  return sendMessage({ target: 'background', type: 'START_ENHANCE' });
}

export async function stopEnhance() {
  return sendMessage({ target: 'background', type: 'STOP_ENHANCE' });
}

export async function applyPreset(preset) {
  return sendMessage({ target: 'background', type: 'APPLY_PRESET', presetId: preset?.id, preset });
}

export async function updateEngineState(patch) {
  return sendMessage({ target: 'background', type: 'UPDATE_STATE', patch });
}

export async function saveCustomPreset(preset) {
  return sendMessage({ target: 'background', type: 'SAVE_CUSTOM_PRESET', preset });
}
