# Architecture

ArSonKuPik is a Manifest V3 Chrome extension for local browser-tab audio enhancement.

## Runtime surfaces

- `popup.html` — compact control surface for starting enhancement, selecting presets, and choosing output routing.
- `studio.html` — full mastering console with EQ, compressor, color, width, limiter, A/B, meters, and presets.
- `offscreen.html` — offscreen document used for Web Audio processing after tab capture.
- `src/background/service-worker.js` — coordinates tab capture, offscreen lifecycle, device routing, and state messages.

## Audio chain

```text
Captured tab audio
→ Input meter / analyzer
→ EQ
→ Compressor
→ Analog 4-band color
→ Multiband stereo width
→ Limiter
→ Output meter / analyzer
→ Audio output route
```

The default route uses `AudioContext.destination`. A hidden media element route is used only when a user explicitly selects a specific output device.

## Stability principles

- Avoid graph rebuilds for simple knob changes.
- Keep default output route on a single clock domain.
- Use `latencyHint: balanced` for long-running browser playback stability.
- Keep analyzers and visual meters lightweight.
- Use visual interpolation instead of forcing high-frequency audio analysis.

## Privacy principles

- Process audio locally.
- Do not record audio.
- Do not upload audio.
- Do not use remote executable code.
- Do not inject into websites.
