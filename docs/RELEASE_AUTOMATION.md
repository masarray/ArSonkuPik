# Release Automation

ArSonKuPik uses GitHub Actions to automate release packaging without auto-submitting anything to Chrome Web Store.

## Why this workflow is intentionally conservative

The repository is public, so release automation must avoid secrets and private signing keys. The release workflow only uses the built-in `GITHUB_TOKEN` to attach artifacts to a GitHub Release. It does not use Chrome Web Store API credentials, refresh tokens, private keys, or CRX packaging.

## Workflows

### `validate.yml`

Runs on pull requests, pushes to `main`, and manual dispatch.

Checks:

- JavaScript syntax for extension files.
- CSS ownership audit.
- Extension release audit.
- Static site metadata and link validation.
- Public repository safety audit.
- Workflow policy audit.
- Web Store ZIP smoke build.

### `pages.yml`

Deploys the static site from `site/` to GitHub Pages after site validation.

### `release.yml`

Runs on protected tags matching `v*.*.*` and manual dispatch.

Builds:

- `arsonkupik-extension-vX_Y_Z-webstore-upload.zip`
- `arsonkupik-public-source-vX_Y_Z.zip`
- `SHA256SUMS.sha256`
- `RELEASE_NOTES.md`

On tag pushes, it creates a GitHub Release and attaches the generated assets.

### `codeql.yml`

Runs CodeQL analysis for JavaScript on push, pull request, weekly schedule, and manual dispatch.

## Tag release flow

```bash
git tag v0.3.34
git push origin v0.3.34
```

Then open the GitHub Release and download the Web Store ZIP for manual Developer Dashboard upload.

## Security rules

- Do not add Chrome Web Store auto-submit logic.
- Do not add CRX build/signing logic.
- Do not commit `.pem`, `.key`, `.p12`, `.pfx`, `.env`, or Web Store API tokens.
- Keep workflows on least-privilege permissions.
- Prefer manual store submission after a real Chrome audio stability test.
