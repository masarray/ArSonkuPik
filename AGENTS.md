# AGENTS.md — ArSonKuPik Production Engineering Contract

These rules apply to every AI/code agent working in this repository. ArSonKuPik is a Manifest V3 Chrome extension that performs local tab-audio enhancement with Web Audio. Audio continuity, bounded latency/CPU, extension lifecycle correctness, privacy, and regression safety are production requirements.

## 1. Prime directive

Do not begin with a disposable or intentionally naive implementation when the production architecture is knowable. Implement the smallest coherent production-quality change that preserves existing working behavior.

Priority order:
1. audio correctness and continuity;
2. privacy/security and permission minimization;
3. extension lifecycle correctness;
4. regression compatibility;
5. responsiveness, CPU and memory;
6. maintainability.

Do not make a screenshot or meter look correct by changing DSP behavior without explicit acceptance criteria.

## 2. Mandatory engineering loop

For non-trivial work:

RECONNAISSANCE -> REPRODUCE/BASELINE -> ROOT CAUSE -> INVARIANTS -> ARCHITECTURE IMPACT -> IMPLEMENT -> REGRESSION TEST -> FAILURE TEST -> PERFORMANCE CHECK -> PACKAGE/CI -> MANUAL CHROME VALIDATION

Before editing, identify the owning subsystem and all consumers. Do not patch the same symptom repeatedly. After three failed patches in one subsystem, stop and re-audit architecture, state ownership and assumptions.

## 3. Authoritative boundaries

Preserve one-way ownership:

Chrome capture/service-worker lifecycle
-> validated messaging/control state
-> offscreen audio runtime
-> Web Audio DSP graph
-> bounded UI snapshots/meters

Rules:
- the popup/studio UI is not the audio authority;
- the offscreen/audio runtime owns live DSP state;
- service worker lifecycle must not create a second DSP state model;
- shared presets/messages have one canonical schema;
- site/public-release code must not be mixed into extension runtime paths;
- avoid duplicate audio graphs, timers, listeners or state caches.

## 4. Audio hot-path rules

High-frequency audio/control paths must remain bounded and non-blocking.

Do not perform synchronous storage, network access, large JSON work, DOM work, expensive logging, repeated graph reconstruction, or unbounded allocation in timing-sensitive audio paths.

Prefer parameter updates on an existing prepared graph over destroy/recreate cycles. Rebuild graph topology only when topology truly changes, and make transition behavior explicit.

Never create one task/timer/message per audio frame or meter sample.

## 5. Result-oriented failure handling

Expected runtime failures must be represented explicitly rather than using thrown exceptions as routine control flow.

Examples:
- tab capture unavailable/revoked;
- offscreen document unavailable;
- invalid message payload;
- invalid preset/state data;
- output device unavailable;
- browser API rejection;
- graph initialization failure;
- stale/disconnected runtime.

Use one consistent structured status/error taxonomy. Catch browser/API exceptions at meaningful boundaries, convert them to explicit states, and preserve last-known-good audio state where safe.

Do not swallow failures. Do not allow a UI notification failure to interrupt audio processing.

## 6. Bounded diagnostics

Diagnostics must be observational and bounded. High-frequency failures are aggregated/deduplicated/rate-limited before reaching UI or console.

Do not emit unbounded console logs from meter/audio/message loops. Diagnostic queue saturation must drop/coalesce according to policy rather than increasing memory or backpressuring audio.

## 7. Messaging and lifecycle discipline

Every message listener, port, timer, animation loop, MediaStream, AudioContext, AudioNode and output-routing resource must have a clear owner and cleanup path.

Validate all inbound message types and payload fields before use. Reject unknown or malformed messages safely.

Service-worker suspension/restart must not silently reset authoritative user state or create duplicate offscreen/audio runtimes.

Shutdown/reconfigure must stop stale work and prevent callbacks into disposed state.

Never fix lifecycle races with arbitrary delays unless the delay is part of a documented browser contract and is covered by a deterministic guard.

## 8. UI responsiveness and meters

UI rendering must consume bounded snapshots. Do not mirror every audio/meter update into React/DOM-style state or force layout on each sample.

Coalesce meter/visualizer updates to presentation rate. Hidden/inactive UI must not continue expensive rendering work.

A 60 Hz frame budget is total UI budget, not permission for every function to consume 16.7 ms.

## 9. DSP safety and sonic invariants

Defend against NaN/Infinity, invalid ranges, zero/negative frequencies where unsupported, unstable Q/gain values, channel mismatch, clipping and stale node references.

Unless explicitly changed, preserve:
- local-only processing;
- existing EQ/compression/color/width/limiter topology semantics;
- phase-aware stereo-width safety;
- output protection behavior;
- A/B and preset semantics;
- no remote audio upload.

Parameter migration must be explicit and backward compatible where existing stored settings may be present.

## 10. Privacy and security

Do not add remote audio transport, analytics, telemetry, remote scripts, broadened host permissions, or new persistent identifiers without explicit product approval and documentation updates.

Keep Manifest V3 permissions minimal. Treat tab/audio/output-device identifiers and extension storage as sensitive local state.

Never place secrets in source, package artifacts, logs or Pages content.

## 11. Packaging and release integrity

`extension/` runtime packaging must contain only intentional Chrome Web Store files. Do not accidentally package source-only tooling, secrets, docs, generated junk or local artifacts.

Version changes must remain coherent across manifest/package/release notes and validation tooling.

Do not weaken `npm run validate` or packaging audits to make CI pass. Fix the underlying defect or explicitly document pre-existing debt with a no-new-debt gate.

## 12. Performance discipline

For performance-sensitive changes, measure relevant signals such as startup time, graph initialization, CPU under sustained playback, meter/render rate, message rate, memory growth and long-run stability.

Do not introduce worker/timer/cache/pooling complexity without an identified bottleneck. Do not claim optimization without evidence.

## 13. Regression prevention

Every meaningful bug fix should add or extend a deterministic validation where practical. Test the exact failure mode, especially lifecycle restart, stale state, malformed messages, preset migration, device loss and long-run audio stability.

Before changing shared messaging/preset schemas, enumerate all producers and consumers.

## 14. Definition of done

A task is not complete because JavaScript parses.

Validate as applicable:
- `npm run validate`;
- packaging audit / `npm run package:webstore`;
- deterministic regression scripts;
- malformed/failure-path behavior;
- Chrome extension load/reload;
- tab capture start/stop/restart;
- offscreen/service-worker restart behavior;
- sustained playback CPU/memory;
- device-routing behavior when changed;
- privacy/permission impact.

Never claim a check that was not run.

## 15. Completion report

Report: Changed; Root cause; Architecture decision; Invariants preserved; Regression protection; Performance impact; Exact validation executed; Remaining genuine limitations.

## Final rule

Think like the maintainer responsible for uninterrupted browser audio across long sessions and hostile lifecycle conditions, not like a prototype generator trying to make one UI interaction pass. Preserve one audio authority, keep hot paths bounded, contain failures, validate lifecycle transitions, and prevent regressions.