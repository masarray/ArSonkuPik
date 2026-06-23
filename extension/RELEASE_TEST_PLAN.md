# ArSonKuPik Release Test Plan

Use this checklist before uploading the ZIP to Chrome Web Store.

## 1. Load package

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click **Load unpacked** and select the package folder.
4. Confirm no red extension error appears.

## 2. Popup capture path

1. Open a normal HTTPS media tab, for example YouTube.
2. Click the ArSonKuPik extension icon.
3. Click **Start Enhance**.
4. Confirm the popup title changes from `No active capture` to the tab title.
5. Confirm processed audio is audible.
6. Click **Stop Enhance** and confirm audio stops routing through the extension.

## 3. Studio capture path

1. Open the popup while the media tab is active.
2. Click **Open Studio Panel**.
3. Click **Start Enhance** in Studio.
4. Confirm Studio targets the original media tab, not `chrome-extension://`.
5. Move EQ bands while audio is playing.
6. Toggle EQ, compressor, color, width, limiter, and global bypass.

## 4. Output routing

1. Keep output on **System Default** and confirm it works.
2. Use **Choose output device…** when Chrome exposes the chooser.
3. Test a USB audio device or VB-Cable if available.
4. Confirm route status displays `Routed`, `Output`, or clear issue text.

## 5. Persistence

1. Change EQ/compressor/output settings.
2. Save a custom preset.
3. Close and reopen popup/Studio.
4. Confirm preset and current state persist.

## 6. Stop/stale-state safety

1. Start enhancement.
2. Close the captured media tab.
3. Reopen popup.
4. Confirm the state returns to `No active capture` instead of showing a stale active session.

## 7. Store package audit

Run:

```bash
node tools/css-ownership-audit.mjs
node tools/extension-release-audit.mjs
node --check src/background/service-worker.js
node --check src/popup/popup.js
node --check src/studio/studio.js
node --check src/offscreen/offscreen.js
python3 -m json.tool manifest.json
```
