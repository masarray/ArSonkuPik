# Chrome Store Review Notes — ArSonKuPik

## Package status

This package is prepared as a Chrome Web Store release candidate, pending manual runtime testing in Chrome.

## Permission justification

| Permission | Why it is needed |
|---|---|
| `activeTab` | Lets the extension act on the current user-invoked tab when the user starts enhancement. |
| `tabCapture` | Captures the selected tab audio stream so it can be processed locally by the Web Audio engine. |
| `offscreen` | Hosts the Web Audio processing document without keeping a visible page open. |
| `storage` | Saves local presets, state, and output routing preferences. |
| `contentSettings` | Grants microphone access only to the extension origin so Chrome exposes local `audiooutput` devices through `enumerateDevices()`; this is required for output routing and follows the AudioPick model. |

No `tabs`, `scripting`, `webRequest`, or host permissions are required in this package.

## Privacy disclosure draft

ArSonKuPik processes captured tab audio locally in the browser. The extension does not record, upload, transmit, sell, or share audio data. Presets and optional output-routing preferences are stored locally with Chrome extension storage.

## Store-review hardening added in v0.3.6

- Runtime messaging now throws clear errors when a background command returns `ok:false`.
- Capture state is reset when Chrome reports tab capture stopped/error.
- Capture state is reset if the captured tab is closed.
- Dead Studio output-device references were removed; the active output selector is now the Limiter/Output card control.
- `tools/extension-release-audit.mjs` validates manifest hygiene, permission surface, HTML asset references, remote-code risk, owner CSS files, and forbidden package folders.

## Manual release test checklist

See `RELEASE_TEST_PLAN.md`.
