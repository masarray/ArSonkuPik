# Contributing

Thank you for helping improve ArSonKuPik.

## Project boundaries

ArSonKuPik has one purpose: local browser tab audio enhancement. Contributions should support that purpose.

Please do not add:

- host permissions;
- content scripts;
- remote executable code;
- analytics SDKs;
- Chrome Web Store auto-submit logic;
- CRX packaging or private-key based distribution.

## Development

```bash
npm run validate
npm run package:webstore
```

Load `extension/` unpacked in Chrome for manual testing.

## Pull requests

Before opening a PR:

1. run `npm run validate`;
2. run `npm run package:webstore` if extension runtime files changed;
3. update docs when behavior changes;
4. include manual audio test notes for engine/UI changes.

## Audio engine changes

For DSP changes, describe:

- affected modules;
- expected tonal behavior;
- CPU/performance impact;
- phase/mono-safety considerations;
- manual listening duration and content tested.

## Public safety

This is a public repository. Never commit secrets, private keys, `.pem` files, Web Store API tokens, personal media, or copyrighted test audio.
