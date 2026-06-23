# Contributing

Thank you for improving ArSonKuPik.

## Development rules

1. Keep the extension single-purpose: local tab audio enhancement.
2. Do not add remote executable code.
3. Do not add host permissions unless there is a reviewed, user-visible need.
4. Keep CSS ownership clean; do not append release override blocks.
5. Run validation before opening a pull request:

```bash
npm run validate
npm run package:webstore
```

## CSS ownership

Studio CSS is split by responsibility:

- `extension/src/studio/studio.shell.css`
- `extension/src/studio/studio.eq.css`
- `extension/src/studio/studio.modules.css`
- `extension/src/studio/studio.responsive.css`

Edit the owner file directly. Avoid stacking fixes at the bottom of CSS files.
