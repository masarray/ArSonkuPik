# Changelog

## 0.3.40 - Warm bypass and single Studio tab

- Moved the Color mode badge beside the module preset label so the panel header stays compact and color-matched.
- Changed popup power toggling while active to use warm master bypass instead of full tab-capture stop/start, reducing YouTube playback renegotiation and buffering.
- Added Shift/Alt-click full stop for users who need to release tab capture completely.
- Reused an existing Studio tab instead of opening duplicates, and paused Studio meter/RTA polling while the Studio tab is hidden.

## 0.3.39
- Reworked Stereo Width into a source-aware, parallel side-enhancement engine.
- Preserves the incoming left/right stereo image instead of rebuilding or narrowing existing stereo music.
- Adds adaptive Source Guard so already-wide or low-correlation material receives little/no extra width while mono-like sources can still feel wider.
- Applies mono-bass protection only to the generated side layer, not to the original source.

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
