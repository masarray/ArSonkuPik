# Security Policy

## Reporting a vulnerability

Please report security issues through a private channel before opening a public issue.

Suggested report contents:

- Affected version
- Browser and operating system
- Clear reproduction steps
- Expected versus observed behavior
- Any relevant console logs

## Security design

ArSonKuPik is designed as a local browser extension:

- No host permissions
- No content scripts
- No remote executable code
- No analytics endpoint
- No audio upload
- No `eval()` or `new Function()`

All JavaScript required by the extension is bundled inside the extension package for Chrome Web Store review.
