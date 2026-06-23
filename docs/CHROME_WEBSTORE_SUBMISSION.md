# Chrome Web Store Submission

ArSonKuPik is packaged for Chrome Web Store as a clean runtime ZIP.

## Build the upload ZIP

```bash
npm run release:check
```

Use this artifact for the Developer Dashboard:

```text
release/arsonkupik-extension-v0_3_34-webstore-upload.zip
```

Do not upload the source archive.

## Manual submission only

This project intentionally does not auto-submit to Chrome Web Store. Keep submission manual so the maintainer can review:

- release ZIP contents;
- privacy policy URL;
- store listing text;
- permission justifications;
- screenshots and promotional assets;
- manual audio stability test results.

## Required public URLs

After GitHub Pages deployment:

```text
Homepage:       https://<owner>.github.io/arsonkupik/
Privacy Policy: https://<owner>.github.io/arsonkupik/privacy/
Support:        https://<owner>.github.io/arsonkupik/support/
```

## Permission posture

The extension uses permissions only for the stated local audio enhancement purpose. It does not include host permissions, content scripts, remote executable code, analytics SDKs, or cloud audio upload logic.

## Privacy posture

The listing and privacy policy should consistently state:

- audio is processed locally;
- audio is not recorded;
- audio is not uploaded;
- user data is not sold, shared, or transmitted;
- output device access is used only for local output routing after explicit user action.

## Upload checklist

1. Run `npm run release:check`.
2. Check `release/SHA256SUMS.sha256`.
3. Extract the Web Store ZIP and test with Load unpacked.
4. Run the 30-minute stability test from `docs/RELEASE_TEST_PLAN.md`.
5. Verify GitHub Pages privacy/support URLs are live.
6. Upload the Web Store ZIP manually in Chrome Web Store Developer Dashboard.
7. Fill privacy practices and permission justifications accurately.
8. Submit for review.
