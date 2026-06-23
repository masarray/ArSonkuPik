# ArSonKuPik

**Local tab audio enhancer for Chrome.** ArSonKuPik gives browser audio a studio-style mastering chain with precision EQ, compressor, analog-style color, multiband stereo width, limiter, A/B comparison, smart presets, output routing, and fluid metering.

<p align="center">
  <img src="site/assets/icon-512.png" width="128" height="128" alt="ArSonKuPik icon">
</p>

## Project status

- Version: **0.3.34**
- Extension type: **Manifest V3 Chrome extension**
- Distribution target: **Chrome Web Store ZIP**
- Public repo status: **source, documentation, landing page, wiki, and release automation ready**
- CRX distribution: **intentionally disabled**
- Chrome Web Store auto-submit: **intentionally disabled**

## Highlights

- **Local audio processing** — tab audio is processed in the browser using Web Audio.
- **No cloud DSP** — no remote scripts, no cloud audio upload, no analytics pipeline.
- **Mastering modules** — EQ, compressor, color, width, limiter, A/B snapshots, and smart presets.
- **Phase-aware stereo width** — multiband side imaging keeps low and vocal range conservative while adding high-frequency sparkle.
- **Store-ready package tooling** — clean ZIP generator, repository audit, checksum generation, and release notes.
- **GitHub Pages ready** — landing page, privacy page, support page, docs page, wiki page, and automatic Pages deployment workflow.

## Repository layout

```text
extension/                 Chrome extension runtime source
site/                      Static GitHub Pages site
wiki/                      Markdown wiki source for GitHub Wiki/manual import
docs/                      Architecture, privacy, permission, release, and store docs
scripts/                   Packaging, checksum, release note, and audit scripts
.github/workflows/         CI, release packaging, Pages deploy, and CodeQL workflows
release/                   Generated release output; ZIPs are not committed
```

## Quick start

```bash
npm run validate
npm run package:webstore
```

Then load the unpacked extension from `extension/` in `chrome://extensions` with Developer mode enabled.

## Chrome Web Store package

Generate the clean runtime ZIP:

```bash
npm run package:webstore
```

Upload the generated file from `release/` to the Chrome Web Store Developer Dashboard.

The Web Store ZIP intentionally contains only runtime files:

```text
manifest.json
popup.html
studio.html
offscreen.html
src/
icons/
```

It does not include docs, source release notes, test tools, GitHub workflows, CRX files, or private keys.

## Release automation

A protected tag such as `v0.3.34` triggers `.github/workflows/release.yml`.

The workflow:

1. validates extension, site, repository safety, and workflows;
2. builds the clean Chrome Web Store ZIP;
3. builds a source archive;
4. generates release notes and SHA-256 checksums;
5. attaches assets to a GitHub Release.

The workflow **does not** auto-submit to Chrome Web Store and **does not** build CRX packages.

## GitHub Pages deployment

The landing site lives in `site/`. The workflow at `.github/workflows/pages.yml` deploys it automatically from `main`.

After pushing this repository to GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source.

Recommended URLs:

```text
Homepage:       https://<owner>.github.io/arsonkupik/
Privacy Policy: https://<owner>.github.io/arsonkupik/privacy/
Support:        https://<owner>.github.io/arsonkupik/support/
```

## Privacy position

ArSonKuPik is designed around local processing:

- It does not record audio.
- It does not upload audio.
- It does not sell, share, or transmit user data.
- Output device access is used only for local output routing after user action.

See [`docs/PRIVACY_POLICY.md`](docs/PRIVACY_POLICY.md).

## Safety model

- No Web Store API credentials in the repository.
- No extension private keys in the repository.
- No CRX build workflow.
- No remote executable code.
- No host permissions.
- No content scripts.
- Generated release ZIPs are ignored by Git.

## Manual release checklist

Before submitting to Chrome Web Store:

1. run `npm run release:check`;
2. install the Web Store ZIP as an unpacked local build for smoke testing;
3. run the 30-minute audio stability test in `docs/RELEASE_TEST_PLAN.md`;
4. verify privacy policy/support URLs are public HTTPS pages;
5. upload the clean `*-webstore-upload.zip` manually to the Developer Dashboard.
