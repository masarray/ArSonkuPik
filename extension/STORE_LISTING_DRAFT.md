# ArSonKuPik Chrome Web Store Listing Draft

## Short description

Local tab audio enhancer with precision EQ, compressor, color, stereo width, limiter, and output routing.

## Detailed description

ArSonKuPik enhances audio from the browser tab you choose and processes it locally in Chrome using the Web Audio API.

Designed for reviewers, creators, and audio enthusiasts, it provides a premium mastering-style control panel with parametric EQ, compressor, color shaping, stereo width, limiter safety, presets, and output-device routing where Chrome supports it.

Key features:

- Precision parametric EQ with draggable bands
- Compressor, color, width, and limiter modules
- Local presets and custom preset saving
- Output gain and limiter safety control
- Optional output routing to supported audio devices
- Local processing only: no recording, no upload

## Privacy statement

ArSonKuPik processes captured tab audio locally in the browser. It does not record, upload, transmit, sell, or share audio data. Presets and optional output-routing preferences are stored locally using Chrome extension storage.

## Permission explanations

- `activeTab`: lets ArSonKuPik act only on the tab selected by the user.
- `tabCapture`: captures audio from the selected tab for local processing.
- `offscreen`: keeps the Web Audio engine running without a visible processing page.
- `storage`: saves presets, current state, and local output-routing preferences.
