# ArSonKuPik

**Local tab audio enhancer for Chrome.** ArSonKuPik gives browser audio a studio-style mastering chain: precision EQ, compressor, analog-style color, multiband stereo width, limiter, A/B compare, presets, output routing, and fluid metering.

<p align="center">
  <img src="site/assets/icon-512.png" width="128" height="128" alt="ArSonKuPik icon">
</p>

## Highlights

- **Local audio processing** — tab audio is processed in the browser using Web Audio.
- **No remote DSP** — no remote scripts, no cloud audio upload, no analytics pipeline.
- **Mastering modules** — EQ, compressor, color, width, limiter, A/B snapshots, and smart presets.
- **Phase-aware stereo width** — multiband side imaging keeps low and vocal range conservative while adding high-frequency sparkle.
- **Chrome Web Store ready** — Manifest V3 package structure, permission notes, privacy policy draft, review notes, and release checklist included.
- **GitHub Pages ready** — landing page, privacy page, support page, docs page, wiki page, and automatic Pages deployment workflow included.

## Repository layout

```text
extension/                 Chrome extension runtime source
site/                      Static GitHub Pages site
wiki/                      Markdown wiki source
scripts/                   Packaging and validation scripts
docs/                      Project documentation
.github/workflows/         CI, release packaging, and GitHub Pages deployment
release/                   Generated Chrome Web Store ZIP output
```

## Quick start for development

```bash
npm run validate
npm run package:webstore
```

Then load the unpacked extension from:

```text
extension/
```

in `chrome://extensions` with Developer mode enabled.

## Chrome Web Store upload

Generate the clean runtime ZIP:

```bash
npm run package:webstore
```

Upload the generated file from:

```text
release/arsonkupik-extension-v0_3_34-webstore-upload.zip
```

The generated ZIP intentionally contains only the runtime files Chrome needs:

```text
manifest.json
popup.html
studio.html
offscreen.html
src/
icons/
```

## GitHub Pages deployment

The landing site lives in `site/`. The workflow at `.github/workflows/pages.yml` deploys it automatically when changes are pushed to `main`.

After pushing this repository to GitHub, open repository **Settings → Pages** and choose **GitHub Actions** as the source.

## Privacy position

ArSonKuPik is designed around local processing:

- It does not record audio.
- It does not upload audio.
- It does not sell, share, or transmit user data.
- Output device access is used only for local output routing after user action.

See [`docs/PRIVACY_POLICY.md`](docs/PRIVACY_POLICY.md).

## Current status

Version: **0.3.34**

This repository is prepared as a professional public-source release and Chrome Web Store candidate. Run the manual test plan before public submission, especially the long-run audio stability test.
