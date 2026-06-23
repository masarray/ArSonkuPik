# GitHub Pages Deployment

The public website lives in `site/` and is deployed by `.github/workflows/pages.yml`.

## Enable Pages

After pushing the repository:

1. Open repository **Settings**.
2. Go to **Pages**.
3. Set source to **GitHub Actions**.
4. Push to `main` or run the Pages workflow manually.

## Expected URLs

```text
https://<owner>.github.io/arsonkupik/
https://<owner>.github.io/arsonkupik/privacy/
https://<owner>.github.io/arsonkupik/support/
https://<owner>.github.io/arsonkupik/docs/
https://<owner>.github.io/arsonkupik/wiki/
```

## Validation

Run:

```bash
npm run validate:site
```

The validator checks local links and required metadata for every HTML page.
