# Changelog

## 0.3.38

- restored the compressor vertical linked L/R gain-reduction meter beside the compressor transfer canvas
- wired existing product screenshots into README, root landing page, and GitHub Pages landing page
- kept startup capture cleanup and popup output-gain state fixes in the public source package

## 0.3.37

- restored background orphan-stream cleanup before requesting a fresh tab capture
- restored popup output gain rendering from saved engine state instead of a hardcoded value

## 0.3.36

- fixed Stereo Width startup crash caused by accessing width band filter nodes through the array-based `nodes` list instead of `nodeMap`
- added fail-safe startup cleanup so partial tab-capture streams are always stopped if engine initialization fails
- prevents follow-up Chrome errors such as "Cannot capture a tab with an active stream" after a failed start

## 0.3.35

- refreshed product icon, favicon, and Chrome Web Store store icon to match the current neon blue-violet UX theme
- updated landing page icon assets to keep brand consistency across the extension and GitHub Pages site

## 0.3.34 — Chrome Store Readiness

- Added Chrome Web Store review notes and privacy documentation.
- Restricted output device unlock flow to explicit user action.
- Removed microphone stream fallback from the Store-ready build.
- Confirmed no remote code, remote scripts, host permissions, `eval`, or dynamic function execution.
- Prepared clean Web Store package generation.

## 0.3.33 — Width Chain Double-Check Fix

- Fixed multiband width internal chain rebuild after audio graph reconnect.
- Preserved default route stability improvements.

## 0.3.32 — Ozone-Style Width and Fluid Stability

- Added multiband stereo width behavior.
- Improved default output route stability.
- Added fluid spectrum interpolation.

## Earlier 0.3.x Milestones

- Added MasAri smart preset, A/B snapshots, analog-style color engine, output routing, and refined Studio UI.
