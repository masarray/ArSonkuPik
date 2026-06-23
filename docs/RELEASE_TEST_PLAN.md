# Release Test Plan

Run this plan before submitting a release ZIP to Chrome Web Store.

## Automated checks

```bash
npm run release:check
```

Expected output:

- extension JavaScript syntax check passed;
- CSS ownership audit passed;
- extension release audit passed;
- site validation passed;
- repository safety audit passed;
- workflow validation passed;
- Web Store ZIP created;
- source ZIP created;
- release notes and checksums generated.

## Package checks

- `manifest.json` is at the root of the Web Store ZIP.
- Runtime ZIP contains only `manifest.json`, `popup.html`, `studio.html`, `offscreen.html`, `src/`, and `icons/`.
- ZIP does not contain docs, workflows, private keys, CRX files, source archive, or release tooling.

## Manual Chrome smoke test

1. Extract the Web Store ZIP.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load the extracted folder as unpacked.
5. Open a media tab.
6. Start enhancement from popup.
7. Open Studio.
8. Toggle bypass and confirm audio changes immediately.
9. Try MasAri, Audiophile, Punchy Music, Open Air, Podcast, Movie Sub, and Night presets.
10. Stop enhancement and reload the media tab.

## Long-run audio stability test

Run at least 30 minutes on real Chrome with normal media playback.

Watch for:

- crackling;
- pitch drift;
- sample-rate instability;
- high CPU usage;
- runaway memory;
- delayed bypass changes;
- output routing issues;
- visual jank.

Recommended route for baseline stability: System Default output.

## Visual test

Verify:

- spectrum movement is fluid;
- L/R meters are smooth;
- width/correlation rows are readable;
- popup Start Enhance remains available;
- Studio does not show a Start Enhance button;
- no wrapped numeric values.
