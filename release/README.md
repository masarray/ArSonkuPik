# Release output

This directory is generated locally and in GitHub Actions.

Do not commit release ZIPs, checksums, or generated release notes. They are produced by:

```bash
npm run release:check
```

Release artifacts are attached to GitHub Releases by `.github/workflows/release.yml` when a protected tag such as `v0.3.34` is pushed.
