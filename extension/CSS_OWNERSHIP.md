# ArSonKuPik CSS Ownership

The CSS is intentionally split by ownership. Do not append release-cleanup blocks at the end of files.

## Owner files

| File | Owner |
|---|---|
| `src/popup/popup.css` | Popup-only shell, preset picker, quick output/limiter controls |
| `src/studio/studio.shell.css` | Studio tokens, global shell, topbar, output-device selector, buttons, signal chain rack |
| `src/studio/studio.eq.css` | EQ display, spectrum, EQ header, band nodes, side meters, readout/context menu |
| `src/studio/studio.modules.css` | Inspector, module cards, compressor/color/width/limiter controls, knobs |
| `src/studio/studio.responsive.css` | Responsive overrides only |

## Rules

1. Do not recreate `src/studio/studio.css`.
2. Do not add `v0.x cleanup`, `hotfix`, or `override` blocks.
3. Edit the owner file directly.
4. `!important` must stay at zero.
5. Responsive selector duplication is allowed only inside `studio.responsive.css`.
6. Popup selector duplication is currently tolerated only for shared base/button group rules. Do not increase it.
7. New UI elements must define ownership before CSS is added.

## Required audit before packaging

```bash
node tools/css-ownership-audit.mjs
node tools/extension-release-audit.mjs
```

## Migration history

- v0.3.3: Removed historic Studio override blocks and dropped `!important` from 284 to 0.
- v0.3.4: Removed `contentSettings`, fixed Studio start target, and activated output-device selector.
- v0.3.5: Split monolithic Studio CSS into owner files.
- v0.3.6: Added release audit guard, removed dead Studio output-device references, and added runtime stale-capture safety.
- v0.3.12: Restored AudioPick-style output device enumeration via `contentSettings.microphone` and kept CSS ownership unchanged.
