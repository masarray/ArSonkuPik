import {
  FACTORY_PRESETS,
  createDefaultState,
  applyPresetToState,
  dbToGain,
  normalizeEqBands,
  normalizeCompressor,
  normalizeColor,
  normalizeWidth,
  normalizeOutput,
  toWebAudioType,
  isCutType
} from '../shared/presets.js';
import { buildSfeqRtaSpectrumFromFft } from '../shared/sfeq-rta.js';
import { deviceIdToSinkId, normalizeOutputDeviceId } from '../shared/audio-devices.js';

const AUDIO_CONSTRAINTS = (streamId) => ({
  audio: {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId
    }
  },
  video: false
});

const BUTTERWORTH_Q = {
  12: [0.70710678],
  24: [0.5411961, 1.30656296],
  36: [0.51763809, 0.70710678, 1.93185165],
  48: [0.50979558, 0.60134489, 0.89997622, 2.56291545]
};

const RTA_POINT_COUNT = 80;
const RTA_OCTAVE_WIDTH = 1 / 7;
const RTA_MIN_FRAME_MS = 180;

function isLowPowerRuntime() {
  const nav = navigator || {};
  const lowMemoryDevice = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
  const lowCoreDevice = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
  return lowMemoryDevice || lowCoreDevice;
}

function chooseRtaFftSize() {
  return isLowPowerRuntime() ? 2048 : 4096;
}

let engine = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;
  handleOffscreenMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleOffscreenMessage(message) {
  const host = getEngine();
  switch (message.type) {
    case 'START_CAPTURE':
      await host.start(message.streamId, message.tabId, message.sourceTitle, message.initialState);
      return { ok: true, state: host.getPublicState() };
    case 'STOP_CAPTURE':
    case 'CAPTURE_STOPPED':
      await host.stop();
      return { ok: true, state: host.getPublicState() };
    case 'GET_STATE':
      return { ok: true, state: host.getPublicState() };
    case 'GET_ANALYSIS_FRAME':
      return { ok: true, frame: host.getAnalysisFrame() };
    case 'APPLY_PRESET':
      await host.applyPreset(message.preset || FACTORY_PRESETS.find((p) => p.id === message.presetId));
      return { ok: true, state: host.getPublicState() };
    case 'UPDATE_STATE':
      await host.updateState(message.patch || {});
      return { ok: true, state: host.getPublicState() };
    default:
      throw new Error(`Unknown offscreen message: ${message.type}`);
  }
}

function getEngine() {
  if (!engine) engine = new AudioEnhancerEngine();
  return engine;
}

function notifyStateChanged(state) {
  safeSendMessage({ target: 'background-state', type: 'STATE_CHANGED', state });
}

function safeSendMessage(message) {
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {}
}

class AudioEnhancerEngine {
  constructor() {
    this.state = createDefaultState();
    this.context = null;
    this.stream = null;
    this.source = null;
    this.inputGain = null;
    this.smartHeadroomGain = null;
    this.smartMakeupGain = null;
    this.smartHeadroomDb = 0;
    this.smartMakeupDb = 0;
    this.inputChannelSplitter = null;
    this.inputLeftAnalyser = null;
    this.inputRightAnalyser = null;
    this.safetyHighPass = null;
    this.eqNodeGroups = [];
    this.compNodes = {};
    this.colorNodes = {};
    this.widthNodes = {};
    this.compressor = null;
    this.makeupGain = null;
    this.limiter = null;
    this.limiterDrive = null;
    this.softClipper = null;
    this.outputGain = null;
    this.bypassGain = null;
    this.processedGain = null;
    this.outputMixGain = null;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.correlationSplitter = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.meterSink = null;
    this.stereoBands = [];
    this.widthAdaptiveFactor = 0.35;
    this.colorStereoAdaptive = 0.85;
    this.sideMidBase = { presence: 0, tone: 0, driveDb: 0, wet: 0 };
    this.midAnchorBase = { peak: 0, tone: 0, driveDb: 0, wet: 0 };
    this.lowMidBodyBase = { focus: 0, mudTrim: 0, driveDb: 0, wet: 0 };
    this.dopamineToneMap = createDefaultDopamineToneMap();
    this.lastDopamineToneAt = 0;
    this.outputRouteDestination = null;
    this.outputRouteMode = 'media-element';
    this.outputElement = null;
    this.routeStatus = { ok: true, deviceId: 'default', label: 'System Default', status: 'default' };
    this.timeBufferIn = null;
    this.timeBufferInputLeft = null;
    this.timeBufferInputRight = null;
    this.timeBufferOut = null;
    this.timeBufferLeft = null;
    this.timeBufferRight = null;
    this.inputFrequencyData = null;
    this.outputFrequencyData = null;
    this.rtaFftSize = chooseRtaFftSize();
    this.lastRtaFrame = { source: 'sfeq-rta-v79', pointCount: RTA_POINT_COUNT, input: [], output: [], updatedAt: 0 };
    this.lastMeterAt = 0;
  }

  async start(streamId, tabId, sourceTitle, initialState = null) {
    await this.stop(false);
    try {
      if (initialState) {
        const { presets, ...initialBase } = initialState;
        this.state = this.prepareState({ ...createDefaultState(), ...initialBase, active: false, tabId: null });
      }

      this.widthAdaptiveFactor = 0.35;
    this.colorStereoAdaptive = 0.85;

      const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextCtor) throw new Error('Web Audio API is not available in this browser.');

      this.context = new AudioContextCtor({ latencyHint: 'balanced' });
      this.stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS(streamId));
      this.source = this.context.createMediaStreamSource(this.stream);

      this.inputGain = this.context.createGain();
      this.smartHeadroomGain = this.context.createGain();
      this.smartMakeupGain = this.context.createGain();
      this.inputChannelSplitter = this.context.createChannelSplitter(2);
      this.inputLeftAnalyser = this.createMeterAnalyser();
      this.inputRightAnalyser = this.createMeterAnalyser();
      this.safetyHighPass = this.context.createBiquadFilter();
      this.safetyHighPass.type = 'highpass';
      this.safetyHighPass.frequency.value = 18;
      this.safetyHighPass.Q.value = 0.707;

      this.eqNodeGroups = this.state.eq.map((band) => this.createEqNodeGroup(band));
      this.createCompressorNodes();
      this.createColorNodes();
      this.createWidthNodes();

      this.limiterDrive = this.context.createGain();
      this.softClipper = this.context.createWaveShaper();
      this.softClipper.curve = makeSoftClipCurve(0.94);
      this.softClipper.oversample = '2x';

      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = this.state.output.limiterCeiling;
      this.limiter.knee.value = this.state.output.punchProtect ? 3 : 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = this.state.output.punchProtect ? 0.004 : 0.0015;
      this.limiter.release.value = this.state.output.punchProtect ? 0.08 : 0.055;

      this.outputGain = this.context.createGain();
      this.bypassGain = this.context.createGain();
      this.processedGain = this.context.createGain();
      this.outputMixGain = this.context.createGain();
      this.rtaFftSize = chooseRtaFftSize();
      this.inputAnalyser = this.createRtaAnalyser();
      this.outputAnalyser = this.createRtaAnalyser();
      this.leftAnalyser = this.createMeterAnalyser();
      this.rightAnalyser = this.createMeterAnalyser();
      this.correlationSplitter = this.context.createChannelSplitter(2);
      this.meterSink = this.context.createGain();
      this.meterSink.gain.value = 0;
      this.createStereoBandMeters();
      this.createOutputRoute();

      this.timeBufferIn = new Float32Array(this.inputAnalyser.fftSize);
      this.timeBufferInputLeft = new Float32Array(this.inputLeftAnalyser.fftSize);
      this.timeBufferInputRight = new Float32Array(this.inputRightAnalyser.fftSize);
      this.timeBufferOut = new Float32Array(this.outputAnalyser.fftSize);
      this.timeBufferLeft = new Float32Array(this.leftAnalyser.fftSize);
      this.timeBufferRight = new Float32Array(this.rightAnalyser.fftSize);
      this.inputFrequencyData = new Float32Array(this.inputAnalyser.frequencyBinCount);
      this.outputFrequencyData = new Float32Array(this.outputAnalyser.frequencyBinCount);

      this.applyAllParams();
      this.connectGraph();
      await this.applyOutputDevice();
      await this.context.resume();
      await this.ensureOutputPlayback();

      this.state = { ...this.state, active: true, tabId, sourceTitle: sourceTitle || 'Current tab', updatedAt: Date.now() };
      notifyStateChanged(this.getPublicState());
    } catch (error) {
      // If startup fails after getUserMedia() succeeds, Chrome keeps the tab capture
      // stream alive unless we explicitly stop it. That makes the next click fail with
      // "Cannot capture a tab with an active stream." Always release partial startup
      // resources before rethrowing the real root error.
      await this.stop(false).catch(() => {});
      this.state = { ...this.state, active: false, tabId: null, sourceTitle: 'No active capture', updatedAt: Date.now() };
      notifyStateChanged(this.getPublicState());
      throw error;
    }
  }

  async stop(notify = true) {
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    for (const node of this.getAllNodes()) {
      try { node.disconnect(); } catch {}
    }
    if (this.outputElement) {
      try { this.outputElement.pause(); } catch {}
      this.outputElement.srcObject = null;
      try { this.outputElement.remove(); } catch {}
    }
    if (this.context && this.context.state !== 'closed') await this.context.close().catch(() => {});

    this.context = null;
    this.stream = null;
    this.source = null;
    this.inputGain = null;
    this.smartHeadroomGain = null;
    this.smartMakeupGain = null;
    this.smartHeadroomDb = 0;
    this.smartMakeupDb = 0;
    this.inputChannelSplitter = null;
    this.inputLeftAnalyser = null;
    this.inputRightAnalyser = null;
    this.safetyHighPass = null;
    this.eqNodeGroups = [];
    this.compNodes = {};
    this.colorNodes = {};
    this.widthNodes = {};
    this.compressor = null;
    this.makeupGain = null;
    this.limiter = null;
    this.limiterDrive = null;
    this.softClipper = null;
    this.outputGain = null;
    this.bypassGain = null;
    this.processedGain = null;
    this.outputMixGain = null;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.correlationSplitter = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.meterSink = null;
    this.stereoBands = [];
    this.widthAdaptiveFactor = 0.35;
    this.colorStereoAdaptive = 0.85;
    this.sideMidBase = { presence: 0, tone: 0, driveDb: 0, wet: 0 };
    this.midAnchorBase = { peak: 0, tone: 0, driveDb: 0, wet: 0 };
    this.lowMidBodyBase = { focus: 0, mudTrim: 0, driveDb: 0, wet: 0 };
    this.dopamineToneMap = createDefaultDopamineToneMap();
    this.lastDopamineToneAt = 0;
    this.outputRouteDestination = null;
    this.outputRouteMode = 'media-element';
    this.outputElement = null;
    this.routeStatus = { ok: true, deviceId: 'default', label: 'System Default', status: 'default' };
    this.timeBufferIn = null;
    this.timeBufferInputLeft = null;
    this.timeBufferInputRight = null;
    this.timeBufferOut = null;
    this.timeBufferLeft = null;
    this.timeBufferRight = null;
    this.inputFrequencyData = null;
    this.outputFrequencyData = null;
    this.lastRtaFrame = { source: 'sfeq-rta-v79', pointCount: RTA_POINT_COUNT, input: [], output: [], updatedAt: 0 };

    this.state = {
      ...this.state,
      active: false,
      tabId: null,
      sourceTitle: 'No active capture',
      meters: {
        inputPeak: 0,
        outputPeak: 0,
        gainReduction: 0,
        compressorGainReduction: 0,
        compressorGainReductionLeft: 0,
        compressorGainReductionRight: 0,
        limiterGainReduction: 0,
        inputPeakLeft: 0,
        inputPeakRight: 0,
        outputPeakLeft: 0,
        outputPeakRight: 0,
        correlation: 1,
        clipping: false,
        smartHeadroomDb: 0,
        smartMakeupDb: 0
      },
      updatedAt: Date.now()
    };
    if (notify) notifyStateChanged(this.getPublicState());
  }

  prepareState(state) {
    return {
      ...createDefaultState(),
      ...state,
      eq: normalizeEqBands(state.eq),
      compressor: normalizeCompressor(state.compressor),
      color: normalizeColor(state.color),
      width: normalizeWidth(state.width),
      output: normalizeOutput(state.output)
    };
  }

  createCompressorNodes() {
    this.compNodes = {
      input: this.context.createGain(),
      dry: this.context.createGain(),
      wet: this.context.createGain(),
      output: this.context.createGain()
    };
    this.compressor = this.context.createDynamicsCompressor();
    this.makeupGain = this.context.createGain();
  }

  createColorNodes() {
    this.colorNodes = {
      input: this.context.createGain(),
      dry: this.context.createGain(),
      output: this.context.createGain(),

      // Psychoacoustic bass enhancer path.
      // Low fundamentals are lightly saturated, then filtered back into the
      // 80–650 Hz range so small speakers get audible upper-bass harmonics
      // instead of unsafe sub boost.
      bassPre: this.context.createBiquadFilter(),
      bassDrive: this.context.createGain(),
      bassShaper: this.context.createWaveShaper(),
      bassPostHighpass: this.context.createBiquadFilter(),
      bassPostLowpass: this.context.createBiquadFilter(),
      bassPunch: this.context.createBiquadFilter(),
      bassWet: this.context.createGain(),

      // Warmth/density path for body and midrange thickness.
      warmPre: this.context.createBiquadFilter(),
      warmDrive: this.context.createGain(),
      warmShaper: this.context.createWaveShaper(),
      warmDcBlock: this.context.createBiquadFilter(),
      warmTone: this.context.createBiquadFilter(),
      warmWet: this.context.createGain(),

      // Presence lift path: a focused, parallel 2.6–5 kHz enhancer that makes
      // vocals, guitars and percussion step forward without full-band fuzz.
      presencePre: this.context.createBiquadFilter(),
      presenceDrive: this.context.createGain(),
      presenceShaper: this.context.createWaveShaper(),
      presenceTone: this.context.createBiquadFilter(),
      presenceWet: this.context.createGain(),

      // Air/exciter path, deliberately high-passed so it adds clarity without
      // dragging noise and harsh low-mid grit into the result.
      airPre: this.context.createBiquadFilter(),
      airDrive: this.context.createGain(),
      airShaper: this.context.createWaveShaper(),
      airDcBlock: this.context.createBiquadFilter(),
      airTone: this.context.createBiquadFilter(),
      airWet: this.context.createGain(),

      // Color v4 side-air path. This is not a plain stereo widener: it extracts
      // the Side channel, excites only upper-mid/treble content, then folds it
      // back as +Side/-Side so mono bass and centered vocals stay stable.
      sideSplitter: this.context.createChannelSplitter(2),
      sideBus: this.context.createGain(),
      sideFromL: this.context.createGain(),
      sideFromR: this.context.createGain(),
      sideHighpass: this.context.createBiquadFilter(),
      sidePresence: this.context.createBiquadFilter(),
      sideDrive: this.context.createGain(),
      sideShaper: this.context.createWaveShaper(),
      sideTone: this.context.createBiquadFilter(),
      sideWet: this.context.createGain(),
      sideToL: this.context.createGain(),
      sideToR: this.context.createGain(),
      sideMerger: this.context.createChannelMerger(2),

      // Color v10 real-side MID harmonic exciter. Unlike the Width module (which
      // synthesises side from the mono sum), this lifts the GENUINE L-R stereo
      // detail in the ~0.7-4.5 kHz "tickle" band with harmonics + a presence EQ,
      // then folds it back antisymmetrically (+Side/-Side) so it cancels perfectly
      // in the mono sum -> more alive mid stereo with zero phase issue.
      sideMidHighpass: this.context.createBiquadFilter(),
      sideMidLowpass: this.context.createBiquadFilter(),
      sideMidPresence: this.context.createBiquadFilter(),
      sideMidDrive: this.context.createGain(),
      sideMidShaper: this.context.createWaveShaper(),
      sideMidTone: this.context.createBiquadFilter(),
      sideMidWet: this.context.createGain(),

      // Color v12 MID-center sweet anchor. The side exciter gives the ears
      // movement; this parallel Mid path gives it a stable center core. It is
      // generated from (L+R)/2 and returned equally to L/R, so it never creates
      // inter-channel phase rotation or hollow stereo imaging.
      midAnchorFromL: this.context.createGain(),
      midAnchorFromR: this.context.createGain(),
      midAnchorBus: this.context.createGain(),
      midAnchorHighpass: this.context.createBiquadFilter(),
      midAnchorLowpass: this.context.createBiquadFilter(),
      midAnchorFocus: this.context.createBiquadFilter(),
      midAnchorDrive: this.context.createGain(),
      midAnchorShaper: this.context.createWaveShaper(),
      midAnchorTone: this.context.createBiquadFilter(),
      midAnchorWet: this.context.createGain(),
      midAnchorToL: this.context.createGain(),
      midAnchorToR: this.context.createGain(),

      // Color v13 coherent low-mid body anchor. This supports the vocal chest /
      // instrument body area around 200-300 Hz, but keeps the layer centered
      // (+Mid/+Mid) and guarded against 330-520 Hz mud/boxiness. It makes the
      // center feel thicker without stereo phase tricks.
      lowBodyFromL: this.context.createGain(),
      lowBodyFromR: this.context.createGain(),
      lowBodyBus: this.context.createGain(),
      lowBodyHighpass: this.context.createBiquadFilter(),
      lowBodyLowpass: this.context.createBiquadFilter(),
      lowBodyFocus: this.context.createBiquadFilter(),
      lowBodyMudGuard: this.context.createBiquadFilter(),
      lowBodyDrive: this.context.createGain(),
      lowBodyShaper: this.context.createWaveShaper(),
      lowBodyWet: this.context.createGain(),
      lowBodyToL: this.context.createGain(),
      lowBodyToR: this.context.createGain(),

      // Compatibility nodes for older state snapshots and docs.
      drive: this.context.createGain(),
      body: this.context.createBiquadFilter(),
      warmth: this.context.createBiquadFilter(),
      shaper: this.context.createWaveShaper(),
      air: this.context.createBiquadFilter(),
      wet: this.context.createGain()
    };

    const c = this.colorNodes;
    c.bassPre.type = 'lowpass';
    c.bassPre.frequency.value = 145;
    c.bassPre.Q.value = 0.72;
    c.bassPostHighpass.type = 'highpass';
    c.bassPostHighpass.frequency.value = 72;
    c.bassPostHighpass.Q.value = 0.707;
    c.bassPostLowpass.type = 'lowpass';
    c.bassPostLowpass.frequency.value = 680;
    c.bassPostLowpass.Q.value = 0.707;
    c.bassPunch.type = 'peaking';
    c.bassPunch.frequency.value = 185;
    c.bassPunch.Q.value = 0.85;
    c.bassShaper.oversample = '2x';

    c.warmPre.type = 'bandpass';
    c.warmPre.frequency.value = 520;
    c.warmPre.Q.value = 0.65;
    c.warmDcBlock.type = 'highpass';
    c.warmDcBlock.frequency.value = 22;
    c.warmDcBlock.Q.value = 0.707;
    c.warmTone.type = 'peaking';
    c.warmTone.frequency.value = 720;
    c.warmTone.Q.value = 0.75;
    c.warmShaper.oversample = '2x';

    c.presencePre.type = 'bandpass';
    c.presencePre.frequency.value = 3200;
    c.presencePre.Q.value = 0.82;
    c.presenceTone.type = 'peaking';
    c.presenceTone.frequency.value = 4300;
    c.presenceTone.Q.value = 0.72;
    c.presenceShaper.oversample = '2x';

    c.airPre.type = 'highpass';
    c.airPre.frequency.value = 5200;
    c.airPre.Q.value = 0.707;
    c.airDcBlock.type = 'highpass';
    c.airDcBlock.frequency.value = 900;
    c.airDcBlock.Q.value = 0.707;
    c.airTone.type = 'highshelf';
    c.airTone.frequency.value = 9200;
    c.airTone.Q.value = 0.7;
    c.airShaper.oversample = '2x';

    c.sideFromL.gain.value = 0.5;
    c.sideFromR.gain.value = -0.5;
    c.sideHighpass.type = 'highpass';
    c.sideHighpass.frequency.value = 4300;
    c.sideHighpass.Q.value = 0.74;
    c.sidePresence.type = 'peaking';
    c.sidePresence.frequency.value = 6100;
    c.sidePresence.Q.value = 0.85;
    c.sideTone.type = 'highshelf';
    c.sideTone.frequency.value = 9200;
    c.sideTone.Q.value = 0.65;
    c.sideToL.gain.value = 1;
    c.sideToR.gain.value = -1;
    c.sideShaper.oversample = 'none';

    // Real-side mid exciter: keep low mono (HPF 220 Hz), focus the mid/mid-high
    // "tickle" band, 2x oversampling so mid harmonics never alias into harshness.
    c.sideMidHighpass.type = 'highpass';
    c.sideMidHighpass.frequency.value = 220;
    c.sideMidHighpass.Q.value = 0.707;
    c.sideMidLowpass.type = 'lowpass';
    c.sideMidLowpass.frequency.value = 4800;
    c.sideMidLowpass.Q.value = 0.707;
    c.sideMidPresence.type = 'peaking';
    c.sideMidPresence.frequency.value = 2600;
    c.sideMidPresence.Q.value = 0.72;
    c.sideMidTone.type = 'peaking';
    c.sideMidTone.frequency.value = 3800;
    c.sideMidTone.Q.value = 0.72;
    c.sideMidShaper.oversample = '2x';
    c.sideMidWet.gain.value = 0;

    c.midAnchorFromL.gain.value = 0.5;
    c.midAnchorFromR.gain.value = 0.5;
    c.midAnchorHighpass.type = 'highpass';
    c.midAnchorHighpass.frequency.value = 620;
    c.midAnchorHighpass.Q.value = 0.707;
    c.midAnchorLowpass.type = 'lowpass';
    c.midAnchorLowpass.frequency.value = 4600;
    c.midAnchorLowpass.Q.value = 0.707;
    c.midAnchorFocus.type = 'peaking';
    c.midAnchorFocus.frequency.value = 1850;
    c.midAnchorFocus.Q.value = 0.56;
    c.midAnchorTone.type = 'peaking';
    c.midAnchorTone.frequency.value = 3150;
    c.midAnchorTone.Q.value = 0.58;
    c.midAnchorShaper.oversample = '2x';
    c.midAnchorWet.gain.value = 0;
    c.midAnchorToL.gain.value = 1;
    c.midAnchorToR.gain.value = 1;

    c.lowBodyFromL.gain.value = 0.5;
    c.lowBodyFromR.gain.value = 0.5;
    c.lowBodyHighpass.type = 'highpass';
    c.lowBodyHighpass.frequency.value = 138;
    c.lowBodyHighpass.Q.value = 0.707;
    c.lowBodyLowpass.type = 'lowpass';
    c.lowBodyLowpass.frequency.value = 365;
    c.lowBodyLowpass.Q.value = 0.707;
    c.lowBodyFocus.type = 'peaking';
    c.lowBodyFocus.frequency.value = 255;
    c.lowBodyFocus.Q.value = 0.46;
    c.lowBodyMudGuard.type = 'peaking';
    c.lowBodyMudGuard.frequency.value = 385;
    c.lowBodyMudGuard.Q.value = 0.62;
    c.lowBodyShaper.oversample = '2x';
    c.lowBodyWet.gain.value = 0;
    c.lowBodyToL.gain.value = 1;
    c.lowBodyToR.gain.value = 1;

    c.body.type = 'lowshelf';
    c.body.frequency.value = 115;
    c.body.Q.value = 0.7;
    c.warmth.type = 'peaking';
    c.warmth.frequency.value = 420;
    c.warmth.Q.value = 0.85;
    c.air.type = 'highshelf';
    c.air.frequency.value = 5200;
    c.air.Q.value = 0.7;
    c.shaper.oversample = '2x';
  }

  createWidthNodes() {
    const makeGain = (value = 1) => {
      const node = this.context.createGain();
      node.gain.value = value;
      return node;
    };
    const makeFilter = (type, frequency, q = 0.707) => {
      const node = this.context.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = q;
      return node;
    };
    const makeBand = (name, lowType, lowFreq, highType, highFreq) => {
      const input = makeGain();
      const gain = makeGain();
      const guard = this.context.createDynamicsCompressor();
      guard.threshold.value = -16;
      guard.knee.value = 12;
      guard.ratio.value = 1.6;
      guard.attack.value = 0.012;
      guard.release.value = 0.12;
      const nodes = { input, gain, guard };
      let entry = input;
      let tail = input;
      if (lowType) {
        nodes.low = makeFilter(lowType, lowFreq, 0.707);
        tail.connect(nodes.low);
        tail = nodes.low;
      }
      if (highType) {
        nodes.high = makeFilter(highType, highFreq, 0.707);
        tail.connect(nodes.high);
        tail = nodes.high;
      }
      tail.connect(guard).connect(gain);
      return { name, entry, gain, guard, nodeMap: nodes, nodes: Object.values(nodes) };
    };

    this.widthNodes = {
      input: makeGain(),
      splitter: this.context.createChannelSplitter(2),
      merger: this.context.createChannelMerger(2),
      lDry: makeGain(1),
      rDry: makeGain(1),
      lMid: makeGain(0.5),
      rMid: makeGain(0.5),
      midBus: makeGain(),
      generatedPreHighpass: makeFilter('highpass', 180, 0.707),
      generatedPhaseA: makeFilter('allpass', 860, 0.58),
      generatedPhaseB: makeFilter('allpass', 5200, 0.70),
      lowBand: makeBand('low', null, 0, 'lowpass', 150),
      lowMidBand: makeBand('lowMid', 'highpass', 150, 'lowpass', 650),
      midBand: makeBand('mid', 'highpass', 650, 'lowpass', 4200),
      highBand: makeBand('high', 'highpass', 4200, null, 0),
      sideAirTone: makeFilter('highshelf', 9200, 0.62),
      sideToL: makeGain(0.35),
      sideToR: makeGain(-0.35)
    };
  }


  createEqNodeGroup(band) {
    if (!this.context) return [];
    const normalized = normalizeEqBands([band])[0];
    const nodeCount = isCutType(normalized.type) ? Math.max(1, Math.round((normalized.slope || 12) / 12)) : 1;
    const qValues = isCutType(normalized.type) ? (BUTTERWORTH_Q[normalized.slope] || BUTTERWORTH_Q[12]) : [normalized.q];
    return Array.from({ length: nodeCount }, (_, index) => {
      const node = this.context.createBiquadFilter();
      this.applyBandToNode(node, normalized, qValues[index] || normalized.q);
      return node;
    });
  }

  applyBandToNode(node, band, qOverride = null) {
    const enabled = band.enabled !== false;
    node.type = enabled ? toWebAudioType(band.type) : 'allpass';
    node.frequency.value = Number(band.frequency);
    node.gain.value = isCutType(band.type) ? 0 : Number(band.gain || 0);
    node.Q.value = qOverride ?? Number(band.q || 1);
  }

  getFlatEqNodes() {
    return this.eqNodeGroups.flat().filter(Boolean);
  }

  getFlatWidthNodes() {
    const w = this.widthNodes || {};
    const bands = [w.lowBand, w.lowMidBand, w.midBand, w.highBand].flatMap((band) => band?.nodes || []);
    return [
      w.input, w.splitter, w.merger,
      w.lDry, w.rDry, w.lMid, w.rMid, w.midBus,
      w.generatedPreHighpass, w.generatedPhaseA, w.generatedPhaseB,
      ...bands, w.sideAirTone, w.sideToL, w.sideToR
    ].filter(Boolean);
  }

  getAllNodes() {
    return [
      this.source,
      this.inputAnalyser,
      this.inputChannelSplitter,
      this.inputLeftAnalyser,
      this.inputRightAnalyser,
      this.inputGain,
      this.smartHeadroomGain,
      this.safetyHighPass,
      ...this.getFlatEqNodes(),
      ...Object.values(this.compNodes || {}),
      this.compressor,
      this.makeupGain,
      ...Object.values(this.colorNodes || {}),
      ...this.getFlatWidthNodes(),
      this.smartMakeupGain,
      this.limiterDrive,
      this.softClipper,
      this.limiter,
      this.outputGain,
      this.bypassGain,
      this.processedGain,
      this.outputMixGain,
      this.outputAnalyser,
      this.correlationSplitter,
      this.leftAnalyser,
      this.rightAnalyser,
      ...this.getStereoBandNodes(),
      this.meterSink,
      this.outputRouteDestination
    ].filter(Boolean);
  }

  connectGraph() {
    if (!this.context || !this.source) return;
    for (const node of this.getAllNodes()) {
      try { node.disconnect(); } catch {}
    }

    this.source.connect(this.inputAnalyser);
    if (this.inputChannelSplitter && this.inputLeftAnalyser && this.inputRightAnalyser && this.meterSink) {
      this.source.connect(this.inputChannelSplitter);
      this.inputChannelSplitter.connect(this.inputLeftAnalyser, 0);
      this.inputChannelSplitter.connect(this.inputRightAnalyser, 1);
      this.inputLeftAnalyser.connect(this.meterSink);
      this.inputRightAnalyser.connect(this.meterSink);
    }

    const isBypassed = Boolean(this.state.output.bypass);
    if (this.bypassGain && this.processedGain && this.outputMixGain) {
      // Keep raw and enhanced paths connected in parallel. The ON/OFF button only
      // crossfades these two gains, so Chrome tab capture stays warm and the audio
      // waveform does not jump to a newly connected graph. That avoids the small
      // "cret/tekk" click caused by instant bypass rewiring.
      this.bypassGain.gain.value = isBypassed ? 1 : 0;
      this.processedGain.gain.value = isBypassed ? 0 : 1;
      this.outputMixGain.gain.value = 1;
      this.inputAnalyser.connect(this.bypassGain).connect(this.outputMixGain);
    }

    let cursor = this.inputAnalyser.connect(this.inputGain).connect(this.smartHeadroomGain).connect(this.safetyHighPass);
    if (this.state.eqEnabled !== false) {
      for (const eqNode of this.getFlatEqNodes()) cursor = cursor.connect(eqNode);
    }

    if (this.state.compressor.enabled) cursor = this.connectCompressor(cursor);
    if (this.state.color.enabled && this.state.color.mix > 0) cursor = this.connectColor(cursor);
    if (this.state.width.enabled) cursor = this.connectWidth(cursor);

    if (this.smartMakeupGain) cursor = cursor.connect(this.smartMakeupGain);

    if (this.state.output.limiterEnabled) {
      cursor = cursor.connect(this.limiterDrive).connect(this.softClipper).connect(this.limiter);
    }

    cursor = cursor.connect(this.outputGain);
    if (this.processedGain && this.outputMixGain) {
      cursor.connect(this.processedGain).connect(this.outputMixGain);
      this.connectOutputMetersAndDestination(this.outputMixGain);
    } else {
      this.connectOutputMetersAndDestination(cursor);
    }
  }

  connectOutputMetersAndDestination(cursor) {
    const routeDestination = this.outputRouteDestination || this.context.destination;
    cursor.connect(this.outputAnalyser).connect(routeDestination);
    if (this.correlationSplitter && this.leftAnalyser && this.rightAnalyser && this.meterSink) {
      cursor.connect(this.correlationSplitter);
      this.correlationSplitter.connect(this.leftAnalyser, 0);
      this.correlationSplitter.connect(this.rightAnalyser, 1);
      this.leftAnalyser.connect(this.meterSink);
      this.rightAnalyser.connect(this.meterSink);
      if (this.stereoBands?.length) {
        for (const band of this.stereoBands) {
          const leftSource = band.leftTap;
          const rightSource = band.rightTap;
          const leftTail = band.leftTail || band.leftTap;
          const rightTail = band.rightTail || band.rightTap;
          this.correlationSplitter.connect(leftSource, 0);
          this.correlationSplitter.connect(rightSource, 1);
          // getAllNodes().disconnect() is called on every graph rebuild. That
          // also removes the internal mid-band HPF → LPF connection, so the
          // mid analyser was receiving silence and the UI showed 0% forever.
          // Rebuild every band chain here, not only the splitter → first node.
          if (leftTail !== leftSource) leftSource.connect(leftTail);
          if (rightTail !== rightSource) rightSource.connect(rightTail);
          leftTail.connect(band.leftAnalyser);
          rightTail.connect(band.rightAnalyser);
          band.leftAnalyser.connect(this.meterSink);
          band.rightAnalyser.connect(this.meterSink);
        }
      }
      this.meterSink.connect(routeDestination);
    }
  }

  createStereoBandMeters() {
    if (!this.context) return;
    const makeFilter = (type, frequency, q = 0.707) => {
      const filter = this.context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      return filter;
    };
    const makeBand = (id, leftTap, rightTap, leftTail = null, rightTail = null, extraNodes = []) => {
      const leftAnalyser = this.createMeterAnalyser();
      const rightAnalyser = this.createMeterAnalyser();
      return {
        id,
        leftTap,
        rightTap,
        leftTail: leftTail || leftTap,
        rightTail: rightTail || rightTap,
        leftAnalyser,
        rightAnalyser,
        leftBuffer: new Float32Array(leftAnalyser.fftSize),
        rightBuffer: new Float32Array(rightAnalyser.fftSize),
        nodes: Array.from(new Set([leftTap, rightTap, leftTail, rightTail, leftAnalyser, rightAnalyser, ...extraNodes].filter(Boolean)))
      };
    };

    const lowL = makeFilter('lowpass', 180);
    const lowR = makeFilter('lowpass', 180);
    const midLH = makeFilter('highpass', 180);
    const midLL = makeFilter('lowpass', 3200);
    const midRH = makeFilter('highpass', 180);
    const midRL = makeFilter('lowpass', 3200);
    const highL = makeFilter('highpass', 3200);
    const highR = makeFilter('highpass', 3200);

    this.stereoBands = [
      makeBand('low', lowL, lowR),
      makeBand('mid', midLH, midRH, midLL, midRL, [midLL, midRL]),
      makeBand('high', highL, highR)
    ];
  }

  getStereoBandNodes() {
    return (this.stereoBands || []).flatMap((band) => band.nodes || []);
  }

  createOutputRoute() {
    if (!this.context) return;
    const deviceId = normalizeOutputDeviceId(this.state.output?.outputDeviceId);
    if (deviceId === 'default') {
      this.outputRouteMode = 'context-destination';
      this.outputRouteDestination = null;
      if (this.outputElement) {
        try { this.outputElement.pause(); } catch {}
        this.outputElement.srcObject = null;
        try { this.outputElement.remove(); } catch {}
      }
      this.outputElement = null;
      return;
    }

    // Only non-default routed devices need a MediaStreamDestination + hidden
    // <audio> element. Keeping System Default on context.destination avoids the
    // extra browser re-clock path that can cause crackle/pitch drift over time.
    this.outputRouteMode = 'media-element';
    this.outputRouteDestination = this.context.createMediaStreamDestination();
    this.outputElement = document.getElementById('processedOutput') || document.createElement('audio');
    this.outputElement.id = 'processedOutput';
    this.outputElement.autoplay = true;
    this.outputElement.controls = false;
    this.outputElement.muted = false;
    this.outputElement.volume = 1;
    this.outputElement.playsInline = true;
    this.outputElement.preload = 'auto';
    this.outputElement.disableRemotePlayback = true;
    this.outputElement.srcObject = this.outputRouteDestination.stream;
    this.outputElement.dataset.role = 'ar-audio-enhancer-output';
    this.outputElement.setAttribute('aria-hidden', 'true');
    if (!this.outputElement.isConnected) document.body.appendChild(this.outputElement);
  }


  async applyOutputDevice() {
    const output = normalizeOutput(this.state.output || {});
    const deviceId = normalizeOutputDeviceId(output.outputDeviceId);
    const sinkId = deviceIdToSinkId(deviceId);
    const label = output.outputDeviceLabel || (deviceId === 'default' ? 'System Default' : 'Selected output device');

    if (!this.context) {
      this.routeStatus = { ok: true, deviceId, label, status: deviceId === 'default' ? 'default' : 'selected' };
      this.state.output = normalizeOutput({ ...this.state.output, outputDeviceId: deviceId, outputDeviceLabel: label, outputRouteStatus: this.routeStatus.status });
      return;
    }

    const previousMode = this.outputRouteMode;
    const previousDestination = this.outputRouteDestination;

    if (deviceId === 'default') {
      this.state.output = normalizeOutput({ ...this.state.output, outputDeviceId: 'default', outputDeviceLabel: 'System Default', outputRouteStatus: 'default' });
      this.routeStatus = { ok: true, deviceId: 'default', label: 'System Default', sinkId: 'default', status: 'default', method: 'AudioContext.destination' };
      this.createOutputRoute();
      if (previousMode !== this.outputRouteMode || previousDestination !== this.outputRouteDestination) this.connectGraph();
      return;
    }

    if (!this.outputElement || !this.outputRouteDestination || this.outputRouteMode !== 'media-element') {
      this.createOutputRoute();
      this.connectGraph();
    }
    if (!this.outputElement) return;
    if (this.outputRouteDestination?.stream && this.outputElement.srcObject !== this.outputRouteDestination.stream) {
      this.outputElement.srcObject = this.outputRouteDestination.stream;
    }

    if (typeof this.outputElement.setSinkId !== 'function') {
      this.routeStatus = { ok: false, deviceId, label, status: 'unsupported', error: 'HTMLMediaElement.setSinkId is not supported by this browser.', method: 'HTMLMediaElement.setSinkId' };
      this.state.output = normalizeOutput({ ...this.state.output, outputDeviceId: deviceId, outputDeviceLabel: label, outputRouteStatus: 'unsupported' });
      return;
    }

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (this.context.state === 'suspended') await this.context.resume().catch(() => {});
        await this.outputElement.setSinkId(sinkId);
        this.routeStatus = { ok: true, deviceId, label, sinkId: this.outputElement.sinkId || 'default', status: 'routed', method: 'HTMLMediaElement.setSinkId' };
        this.state.output = normalizeOutput({ ...this.state.output, outputDeviceId: deviceId, outputDeviceLabel: label, outputRouteStatus: this.routeStatus.status });
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }

    this.routeStatus = { ok: false, deviceId, label, status: 'failed', error: lastError?.message || String(lastError || 'Unable to apply output route.'), method: 'HTMLMediaElement.setSinkId' };
    this.state.output = normalizeOutput({ ...this.state.output, outputDeviceId: deviceId, outputDeviceLabel: label, outputRouteStatus: 'failed' });
  }


  async ensureOutputPlayback() {
    if (this.outputRouteMode !== 'media-element' || !this.outputElement) return;
    try {
      if (this.outputRouteDestination?.stream && this.outputElement.srcObject !== this.outputRouteDestination.stream) {
        this.outputElement.srcObject = this.outputRouteDestination.stream;
      }
      await this.outputElement.play();
    } catch (error) {
      this.routeStatus = { ...this.routeStatus, ok: false, status: 'playback-blocked', error: error.message || String(error) };
      this.state.output = normalizeOutput({ ...this.state.output, outputRouteStatus: 'playback-blocked' });
    }
  }


  connectCompressor(cursor) {
    const mix = clamp01((this.state.compressor.parallelMix ?? 100) / 100);
    const dryGain = Math.cos(mix * Math.PI / 2);
    const wetGain = Math.sin(mix * Math.PI / 2);
    this.compNodes.dry.gain.value = dryGain;
    this.compNodes.wet.gain.value = wetGain;

    cursor.connect(this.compNodes.input);
    this.compNodes.input.connect(this.compNodes.dry).connect(this.compNodes.output);
    this.compNodes.input.connect(this.compressor).connect(this.makeupGain).connect(this.compNodes.wet).connect(this.compNodes.output);
    return this.compNodes.output;
  }

  connectColor(cursor) {
    const c = this.colorNodes;
    const mix = clamp01((this.state.color.mix || 0) / 100);
    // Keep the dry path dominant. Color is a parallel psychoacoustic enhancer,
    // not a full-band distortion insert; this prevents hot browser audio from
    // collapsing while still adding the audible lift.
    c.dry.gain.value = 1 - mix * 0.14;
    cursor.connect(c.input);
    c.input.connect(c.dry).connect(c.output);

    c.input
      .connect(c.bassPre)
      .connect(c.bassDrive)
      .connect(c.bassShaper)
      .connect(c.bassPostHighpass)
      .connect(c.bassPostLowpass)
      .connect(c.bassPunch)
      .connect(c.bassWet)
      .connect(c.output);

    c.input
      .connect(c.warmPre)
      .connect(c.warmDrive)
      .connect(c.warmShaper)
      .connect(c.warmDcBlock)
      .connect(c.warmTone)
      .connect(c.warmWet)
      .connect(c.output);

    c.input
      .connect(c.presencePre)
      .connect(c.presenceDrive)
      .connect(c.presenceShaper)
      .connect(c.presenceTone)
      .connect(c.presenceWet)
      .connect(c.output);

    c.input
      .connect(c.airPre)
      .connect(c.airDrive)
      .connect(c.airShaper)
      .connect(c.airDcBlock)
      .connect(c.airTone)
      .connect(c.airWet)
      .connect(c.output);

    c.input.connect(c.sideSplitter);
    c.sideSplitter.connect(c.sideFromL, 0);
    c.sideSplitter.connect(c.sideFromR, 1);
    c.sideFromL.connect(c.sideBus);
    c.sideFromR.connect(c.sideBus);
    c.sideSplitter.connect(c.midAnchorFromL, 0);
    c.sideSplitter.connect(c.midAnchorFromR, 1);
    c.midAnchorFromL.connect(c.midAnchorBus);
    c.midAnchorFromR.connect(c.midAnchorBus);
    c.sideSplitter.connect(c.lowBodyFromL, 0);
    c.sideSplitter.connect(c.lowBodyFromR, 1);
    c.lowBodyFromL.connect(c.lowBodyBus);
    c.lowBodyFromR.connect(c.lowBodyBus);
    c.sideBus
      .connect(c.sideHighpass)
      .connect(c.sidePresence)
      .connect(c.sideDrive)
      .connect(c.sideShaper)
      .connect(c.sideTone)
      .connect(c.sideWet);
    c.sideWet.connect(c.sideToL).connect(c.sideMerger, 0, 0);
    c.sideWet.connect(c.sideToR).connect(c.sideMerger, 0, 1);

    // Real-side MID harmonic exciter, branched from the same true (L-R) bus and
    // summed into the same antisymmetric fold (sideToL +1 / sideToR -1) -> stays
    // mono-cancelling.
    c.sideBus
      .connect(c.sideMidHighpass)
      .connect(c.sideMidLowpass)
      .connect(c.sideMidPresence)
      .connect(c.sideMidDrive)
      .connect(c.sideMidShaper)
      .connect(c.sideMidTone)
      .connect(c.sideMidWet);
    c.sideMidWet.connect(c.sideToL);
    c.sideMidWet.connect(c.sideToR);

    // Mid-center sweet anchor: +Mid/+Mid, not +Side/-Side. This makes the
    // midrange stand out in the center while the side exciter adds movement
    // around it, so Max Enhancer feels wide but not hollow/phasey.
    c.midAnchorBus
      .connect(c.midAnchorHighpass)
      .connect(c.midAnchorLowpass)
      .connect(c.midAnchorFocus)
      .connect(c.midAnchorDrive)
      .connect(c.midAnchorShaper)
      .connect(c.midAnchorTone)
      .connect(c.midAnchorWet);
    c.midAnchorWet.connect(c.midAnchorToL).connect(c.sideMerger, 0, 0);
    c.midAnchorWet.connect(c.midAnchorToR).connect(c.sideMerger, 0, 1);

    // Coherent low-mid body anchor: adds chest/body support around 200-300 Hz
    // only as equal Mid energy, with a mud guard just above it.
    c.lowBodyBus
      .connect(c.lowBodyHighpass)
      .connect(c.lowBodyLowpass)
      .connect(c.lowBodyFocus)
      .connect(c.lowBodyMudGuard)
      .connect(c.lowBodyWet);
    c.lowBodyWet.connect(c.lowBodyToL).connect(c.sideMerger, 0, 0);
    c.lowBodyWet.connect(c.lowBodyToR).connect(c.sideMerger, 0, 1);

    c.sideMerger.connect(c.output);

    return c.output;
  }

  connectWidth(cursor) {
    const w = this.widthNodes;
    cursor.connect(w.input).connect(w.splitter);

    // Source-aware width v11: preserve the incoming L/R music as the dry path.
    // The module only adds a small, mono-cancelling side layer generated from a
    // filtered mid copy. Existing stereo drums, pianos and ambience are never
    // narrowed or rebuilt into mono by this block.
    w.splitter.connect(w.lDry, 0); w.lDry.connect(w.merger, 0, 0);
    w.splitter.connect(w.rDry, 1); w.rDry.connect(w.merger, 0, 1);

    w.splitter.connect(w.lMid, 0); w.lMid.connect(w.midBus);
    w.splitter.connect(w.rMid, 1); w.rMid.connect(w.midBus);
    const sideRoot = w.midBus.connect(w.generatedPreHighpass).connect(w.generatedPhaseA).connect(w.generatedPhaseB);

    const reconnectWidthBand = (band) => {
      // getAllNodes().disconnect() resets every AudioNode on each graph rebuild.
      // Rebuild the internal crossover chain here so multiband generated Side
      // never goes silent after start/bypass/preset/output-route changes.
      const nodes = band.nodeMap || {};
      let tail = band.entry;
      if (nodes.low) {
        tail.connect(nodes.low);
        tail = nodes.low;
      }
      if (nodes.high) {
        tail.connect(nodes.high);
        tail = nodes.high;
      }
      tail.connect(band.guard).connect(band.gain);
    };

    const bands = [w.lowBand, w.lowMidBand, w.midBand, w.highBand];
    for (const band of bands) {
      reconnectWidthBand(band);
      sideRoot.connect(band.entry);
      const out = band === w.highBand ? band.gain.connect(w.sideAirTone) : band.gain;
      out.connect(w.sideToL);
      out.connect(w.sideToR);
    }
    w.sideToL.connect(w.merger, 0, 0);
    w.sideToR.connect(w.merger, 0, 1);
    return w.merger;
  }


  applyAllParams() {
    if (!this.context) return;
    const now = this.context.currentTime;
    const ramp = 0.018;

    this.state = this.prepareState(this.state);

    if (this.inputGain) this.inputGain.gain.setTargetAtTime(dbToGain(this.state.output.inputGain), now, ramp);
    if (this.smartHeadroomGain && !Number.isFinite(this.smartHeadroomGain.gain.value)) this.smartHeadroomGain.gain.value = 1;
    if (this.smartMakeupGain && !Number.isFinite(this.smartMakeupGain.gain.value)) this.smartMakeupGain.gain.value = 1;

    const normalizedBands = normalizeEqBands(this.state.eq);
    normalizedBands.forEach((band, bandIndex) => {
      const group = this.eqNodeGroups[bandIndex] || [];
      const qValues = isCutType(band.type) ? (BUTTERWORTH_Q[band.slope] || BUTTERWORTH_Q[12]) : [band.q];
      group.forEach((node, nodeIndex) => {
        node.type = band.enabled !== false ? toWebAudioType(band.type) : 'allpass';
        node.frequency.setTargetAtTime(Number(band.frequency), now, ramp);
        node.gain.setTargetAtTime(isCutType(band.type) ? 0 : Number(band.gain || 0), now, ramp);
        node.Q.setTargetAtTime(qValues[nodeIndex] || Number(band.q || 1), now, ramp);
      });
    });

    if (this.compressor) {
      const c = this.state.compressor;
      this.compressor.threshold.setTargetAtTime(c.threshold, now, ramp);
      this.compressor.ratio.setTargetAtTime(c.ratio, now, ramp);
      this.compressor.knee.setTargetAtTime(c.knee, now, ramp);
      this.compressor.attack.setTargetAtTime(c.attack, now, ramp);
      this.compressor.release.setTargetAtTime(c.release, now, ramp);
    }
    if (this.makeupGain) this.makeupGain.gain.setTargetAtTime(dbToGain(this.state.compressor.makeupGain), now, ramp);

    this.applyColorParams(now, ramp);
    this.applyWidthParams(now, ramp);

    if (this.limiterDrive) this.limiterDrive.gain.setTargetAtTime(dbToGain(this.state.output.limiterDrive), now, ramp);
    if (this.limiter) {
      this.limiter.threshold.setTargetAtTime(this.state.output.limiterCeiling, now, ramp);
      this.limiter.knee.setTargetAtTime(this.state.output.punchProtect ? 3 : 0, now, ramp);
      this.limiter.attack.setTargetAtTime(this.state.output.punchProtect ? 0.004 : 0.0015, now, ramp);
      this.limiter.release.setTargetAtTime(this.state.output.punchProtect ? 0.08 : 0.055, now, ramp);
    }
    if (this.outputGain) this.outputGain.gain.setTargetAtTime(dbToGain(this.state.output.outputGain), now, ramp);
  }

  applyColorParams(now, ramp) {
    if (!this.colorNodes?.bassDrive) return;
    const color = this.state.color;
    const c = this.colorNodes;
    const mix = clamp01((color.mix || 0) / 100);
    const bodyAmount = clamp((color.body || 0) / 24, -1, 1);
    const warmthAmount = clamp((color.warmth || 0) / 24, -1, 1);
    const airValue = color.air || 0;
    const airAmount = clamp(airValue / 48, -0.5, 1);
    const positiveAir = Math.max(0, airValue);
    const harmonicAmount = clamp01((color.harmonics || 0) / 100);
    const voiceSafe = color.mode === 'clean' && color.drive <= 2.2 && color.mix <= 16;
    const modeDrive = color.mode === 'modern' ? 0.92 : color.mode === 'warm' ? 0.84 : 0.58;
    const driveDb = clamp(color.drive * 0.92 + color.harmonics * 0.034, 0, voiceSafe ? 5.2 : 12.2) * modeDrive;

    // Color v9: four-band analog-style parallel color.
    // 1) Low Punch keeps transient/body weight instead of lowpass-smearing the bass.
    // 2) Warm Body adds mostly even-harmonic density around chest/low-mid.
    // 3) Presence Body thickens vocal/instruments before the harsh sibilant zone.
    // 4) Silky Air adds bright polish with soft high-only nonlinearity.
    // The dry path stays strong so Color feels like premium analog lift, not a fuzz insert.
    c.dry.gain.setTargetAtTime(1 - mix * (voiceSafe ? 0.055 : 0.105), now, ramp);

    // Band 1 — Low punch/body. Higher corner + lower drive keeps kick/bass attack intact.
    c.bassPre.frequency.setTargetAtTime(155 + Math.max(0, bodyAmount) * 45, now, ramp);
    c.bassPre.Q.setTargetAtTime(0.62, now, ramp);
    c.bassPostHighpass.frequency.setTargetAtTime(58 + Math.max(0, bodyAmount) * 18, now, ramp);
    c.bassPostLowpass.frequency.setTargetAtTime(760 + harmonicAmount * 220, now, ramp);
    c.bassPunch.frequency.setTargetAtTime(108 + Math.max(0, bodyAmount) * 48, now, ramp);
    c.bassPunch.Q.setTargetAtTime(0.72, now, ramp);
    c.bassPunch.gain.setTargetAtTime((voiceSafe ? 0.25 : 1.35) + Math.max(0, color.body) * 0.145 + harmonicAmount * 0.42, now, ramp);
    c.bassDrive.gain.setTargetAtTime(dbToGain(driveDb * (voiceSafe ? 0.22 : 0.36) + Math.max(0, color.body) * 0.026), now, ramp);
    c.bassWet.gain.setTargetAtTime(mix * (voiceSafe ? 0.060 : 0.18 + Math.max(0, bodyAmount) * 0.34 + harmonicAmount * 0.08), now, ramp);
    c.bassShaper.curve = makeBassExciterCurve(driveDb * (voiceSafe ? 0.30 : 0.44) + Math.max(0, color.body) * 0.030, color.mode);

    // Band 2 — Warm low-mid / vocal chest. This is the "analog thickness" band.
    c.warmPre.frequency.setTargetAtTime(430 + Math.max(0, color.warmth) * 10, now, ramp);
    c.warmPre.Q.setTargetAtTime(0.58 + Math.max(0, warmthAmount) * 0.10, now, ramp);
    c.warmDrive.gain.setTargetAtTime(dbToGain(driveDb * (voiceSafe ? 0.22 : 0.34) + Math.max(0, color.warmth) * 0.025), now, ramp);
    c.warmTone.frequency.setTargetAtTime(540 + Math.max(0, color.warmth) * 12, now, ramp);
    c.warmTone.Q.setTargetAtTime(0.72, now, ramp);
    c.warmTone.gain.setTargetAtTime(color.warmth * 0.084 + harmonicAmount * (voiceSafe ? 0.08 : 0.34), now, ramp);
    c.warmWet.gain.setTargetAtTime(mix * (voiceSafe ? 0.08 : 0.18 + Math.max(0, warmthAmount) * 0.34 + harmonicAmount * 0.12), now, ramp);
    c.warmShaper.curve = makeAnalogWarmCurve(driveDb * (voiceSafe ? 0.20 : 0.32) + Math.max(0, color.warmth) * 0.024, color.mode);

    // Band 3 — Presence body. Lower and broader than old Color so vocals/instruments
    // become thick and pleasant, while 5–8 kHz stays protected from harsh grit.
    const presenceBase = color.mode === 'modern' ? 2300 : color.mode === 'warm' ? 1850 : 2550;
    c.presencePre.frequency.setTargetAtTime(presenceBase + harmonicAmount * 260, now, ramp);
    c.presencePre.Q.setTargetAtTime(0.58 + harmonicAmount * 0.12, now, ramp);
    c.presenceDrive.gain.setTargetAtTime(dbToGain(driveDb * (voiceSafe ? 0.11 : 0.20) + harmonicAmount * (voiceSafe ? 0.14 : 0.36)), now, ramp);
    c.presenceTone.frequency.setTargetAtTime(3150 + positiveAir * 14, now, ramp);
    c.presenceTone.Q.setTargetAtTime(0.68, now, ramp);
    c.presenceTone.gain.setTargetAtTime((voiceSafe ? 0.04 : 0.32) + positiveAir * 0.010 + harmonicAmount * (voiceSafe ? 0.08 : 0.22), now, ramp);
    c.presenceWet.gain.setTargetAtTime(mix * (voiceSafe ? 0.035 : 0.090 + harmonicAmount * 0.12 + Math.max(0, warmthAmount) * 0.035), now, ramp);
    c.presenceShaper.curve = makePresenceExciterCurve(driveDb * (voiceSafe ? 0.09 : 0.17) + harmonicAmount * 0.28, color.mode);

    // Band 4 — Silky high/air. Bright enough to feel premium, but mostly dry and
    // high-only so cymbals/sibilance do not distort or make the tone brittle.
    const airBase = color.mode === 'modern' ? 6500 : color.mode === 'warm' ? 7000 : 7800;
    c.airPre.frequency.setTargetAtTime(Math.max(6100, airBase - Math.max(0, airAmount) * 160), now, ramp);
    c.airPre.Q.setTargetAtTime(0.40 + harmonicAmount * 0.035, now, ramp);
    c.airDcBlock.frequency.setTargetAtTime(5600, now, ramp);
    c.airDrive.gain.setTargetAtTime(dbToGain(driveDb * (voiceSafe ? 0.08 : 0.15) + harmonicAmount * 0.48 + Math.max(0, airAmount) * 0.28), now, ramp);
    c.airTone.frequency.setTargetAtTime(9000 + harmonicAmount * 1250, now, ramp);
    c.airTone.gain.setTargetAtTime((voiceSafe ? 0.08 : 0.58) + positiveAir * 0.030 + harmonicAmount * (voiceSafe ? 0.12 : 0.35), now, ramp);
    c.airWet.gain.setTargetAtTime(mix * Math.max(0, voiceSafe ? 0.040 + Math.max(0, airAmount) * 0.08 : 0.105 + Math.max(0, airAmount) * 0.30 + harmonicAmount * 0.13), now, ramp);
    c.airShaper.curve = makeAirExciterCurve(driveDb * (voiceSafe ? 0.10 : 0.18) + harmonicAmount * 0.62 + Math.max(0, airAmount) * 0.34, color.mode);

    // Side sparkle remains very subtle. Stereo width is owned by the Width module;
    // Color may add sheen, but must not be the source of phase problems.
    const sideAir = clamp01((positiveAir / 48) * 0.28 + harmonicAmount * 0.10);
    const sideMode = color.mode === 'modern' ? 0.42 : color.mode === 'warm' ? 0.24 : 0.12;
    const sideWet = mix * sideMode * (voiceSafe ? 0.004 + sideAir * 0.012 : 0.010 + sideAir * 0.080);
    c.sideHighpass.frequency.setTargetAtTime(Math.max(7600, 8200 - Math.max(0, airAmount) * 130 + harmonicAmount * 220), now, ramp);
    c.sidePresence.frequency.setTargetAtTime(9200 + harmonicAmount * 600, now, ramp);
    c.sidePresence.gain.setTargetAtTime((voiceSafe ? 0.04 : 0.18) + positiveAir * 0.014 + harmonicAmount * (voiceSafe ? 0.06 : 0.18), now, ramp);
    c.sideDrive.gain.setTargetAtTime(dbToGain(driveDb * (voiceSafe ? 0.035 : 0.075) + harmonicAmount * 0.38), now, ramp);
    c.sideTone.frequency.setTargetAtTime(11600 + harmonicAmount * 900, now, ramp);
    c.sideTone.gain.setTargetAtTime((voiceSafe ? 0.04 : 0.22) + positiveAir * 0.018 + harmonicAmount * (voiceSafe ? 0.06 : 0.20), now, ramp);
    c.sideWet.gain.setTargetAtTime(clamp(sideWet, 0, voiceSafe ? 0.015 : 0.095), now, ramp);
    c.sideShaper.curve = makeSideAirExciterCurve(driveDb * (voiceSafe ? 0.035 : 0.095) + harmonicAmount * 0.42 + Math.max(0, airAmount) * 0.24, color.mode);

    // Real-side MID harmonic exciter (~0.7-4.5 kHz). Lifts the genuine stereo
    // "tickle" without narrowing the original image (real Side, cancels in mono).
    // The amounts below are the BASE target; the live, context-aware factor in
    // updateAdaptiveColorStereo() scales them by how much real stereo detail the
    // source actually has, so mono material is left alone and rich stereo gets
    // pushed harder. Frequencies + curve are set here, gains via applySideMidGains.
    const stereoMidAmt = clamp01((Number(color.stereoMid) || 0) / 100);
    const midSideDriveDb = (voiceSafe ? 0.82 : 2.65) * stereoMidAmt + harmonicAmount * 1.16 * stereoMidAmt;
    c.sideMidHighpass.frequency.setTargetAtTime(220, now, ramp);
    c.sideMidLowpass.frequency.setTargetAtTime(4300 + harmonicAmount * 360, now, ramp);
    c.sideMidPresence.frequency.setTargetAtTime(2300 + harmonicAmount * 180, now, ramp);
    c.sideMidTone.frequency.setTargetAtTime(3450, now, ramp);
    c.sideMidShaper.curve = makePresenceExciterCurve(1.35 + midSideDriveDb, color.mode);
    this.sideMidBase = {
      presence: stereoMidAmt * (voiceSafe ? 0.92 : 2.55),
      tone: stereoMidAmt * (voiceSafe ? 0.42 : 1.20),
      driveDb: midSideDriveDb,
      wet: clamp(stereoMidAmt * (voiceSafe ? 0.048 : 0.36) * (0.56 + 0.44 * mix), 0, 0.44)
    };

    // Mid-center sweet anchor uses the same Stereo Mid intent but returns a
    // coherent +Mid/+Mid layer. It is deliberately lower, broader and smoother
    // than the side exciter, so vocals/snare/guitar/piano stand forward without
    // the floating phasey image that happens when side is excited alone.
    const centerDriveDb = (voiceSafe ? 0.66 : 1.92) * stereoMidAmt + harmonicAmount * (voiceSafe ? 0.28 : 0.72) * stereoMidAmt + Math.max(0, warmthAmount) * 0.24;
    c.midAnchorHighpass.frequency.setTargetAtTime(720 + Math.max(0, warmthAmount) * 60, now, ramp);
    c.midAnchorLowpass.frequency.setTargetAtTime(3900 + harmonicAmount * 260, now, ramp);
    c.midAnchorFocus.frequency.setTargetAtTime(color.mode === 'warm' ? 1650 : color.mode === 'modern' ? 2050 : 1850, now, ramp);
    c.midAnchorFocus.Q.setTargetAtTime(0.50 + harmonicAmount * 0.06, now, ramp);
    c.midAnchorTone.frequency.setTargetAtTime(3000 + positiveAir * 9 + harmonicAmount * 180, now, ramp);
    c.midAnchorTone.Q.setTargetAtTime(0.56, now, ramp);
    c.midAnchorShaper.curve = makeMidAnchorCurve(0.85 + centerDriveDb, color.mode);
    this.midAnchorBase = {
      peak: stereoMidAmt * (voiceSafe ? 0.44 : 1.55) + Math.max(0, color.warmth) * 0.010 + harmonicAmount * (voiceSafe ? 0.07 : 0.20),
      tone: stereoMidAmt * (voiceSafe ? 0.08 : 0.34) + positiveAir * 0.0020,
      driveDb: centerDriveDb,
      wet: clamp(stereoMidAmt * (voiceSafe ? 0.024 : 0.135) * (0.58 + 0.42 * mix), 0, voiceSafe ? 0.040 : 0.165)
    };

    // Low-mid body anchor: fills the 200-300 Hz support under the standout mid.
    // This is intentionally centered and smart-limited so it thickens vocal/body
    // without dragging the whole mix into the 330-520 Hz mud zone.
    const lowBodyIntent = clamp01(stereoMidAmt * 0.26 + Math.max(0, color.body) * 0.007 + Math.max(0, color.warmth) * 0.006 + harmonicAmount * 0.032);
    const lowBodyDriveDb = (voiceSafe ? 0.18 : 0.48) * lowBodyIntent + Math.max(0, color.body) * 0.006 + Math.max(0, color.warmth) * 0.005;
    c.lowBodyHighpass.frequency.setTargetAtTime(150 + Math.max(0, bodyAmount) * 10, now, ramp);
    c.lowBodyLowpass.frequency.setTargetAtTime(360 + harmonicAmount * 22, now, ramp);
    c.lowBodyFocus.frequency.setTargetAtTime(245, now, ramp);
    c.lowBodyFocus.Q.setTargetAtTime(0.42, now, ramp);
    c.lowBodyMudGuard.frequency.setTargetAtTime(385, now, ramp);
    c.lowBodyMudGuard.Q.setTargetAtTime(0.62, now, ramp);
    c.lowBodyShaper.curve = makeLinearCurve();
    this.lowMidBodyBase = {
      focus: lowBodyIntent * (voiceSafe ? 0.12 : 0.46) + Math.max(0, color.body) * (voiceSafe ? 0.002 : 0.0045),
      mudTrim: lowBodyIntent * (voiceSafe ? 0.045 : 0.16),
      driveDb: lowBodyDriveDb,
      wet: clamp(lowBodyIntent * (voiceSafe ? 0.010 : 0.052) * (0.58 + 0.42 * mix), 0, voiceSafe ? 0.020 : 0.072)
    };
    this.applySideMidGains(now, ramp);

    // Loose analog-style compensation: keep Color audible, but stop high drive from
    // just becoming louder/crunchier. More body/warmth is allowed to remain felt.
    const colorComp = 1 / (1 + mix * (driveDb / 12.2) * 0.18 + harmonicAmount * mix * 0.09 + sideWet * 0.08 + this.sideMidBase.wet * 0.045 + this.midAnchorBase.wet * 0.055 + (this.lowMidBodyBase?.wet || 0) * 0.050 + Math.max(0, airAmount) * mix * 0.030);
    c.output.gain.setTargetAtTime(clamp(colorComp, voiceSafe ? 0.94 : 0.84, 1.03), now, ramp);

    // Compatibility fields for older state snapshots and visualizer state.
    c.drive.gain.setTargetAtTime(dbToGain(driveDb), now, ramp);
    c.body.gain.setTargetAtTime(color.body * 0.075, now, ramp);
    c.warmth.gain.setTargetAtTime(color.warmth * 0.078, now, ramp);
    c.air.gain.setTargetAtTime((airValue + color.harmonics * 0.030) * 0.066, now, ramp);
    c.wet.gain.setTargetAtTime(mix, now, ramp);
    c.shaper.curve = makeSaturationCurve(driveDb, color.mode);
  }

  applyWidthParams(now, ramp) {
    if (!this.widthNodes?.lowBand) return;
    const width = normalizeWidth(this.state.width || {});
    this.state.width = width;
    const w = this.widthNodes;
    const tone = Number(width.sideTone || 0);
    const tonePositive = Math.max(0, tone);
    const masterExpand = clamp((width.width - 100) / 100, 0, 1);

    w.lDry.gain.setTargetAtTime(1, now, ramp);
    w.rDry.gain.setTargetAtTime(1, now, ramp);
    w.lMid.gain.setTargetAtTime(0.5, now, ramp);
    w.rMid.gain.setTargetAtTime(0.5, now, ramp);

    // The mono-bass control now protects only the generated side layer. The
    // incoming stereo low end is left untouched, so stereo instruments are not
    // folded toward mono by the Width module.
    const generatedLowCut = width.monoBass ? Math.max(165, width.monoBassFreq) : 115;
    w.generatedPreHighpass.frequency.setTargetAtTime(generatedLowCut, now, ramp);
    w.generatedPhaseA.frequency.setTargetAtTime(760 + tonePositive * 8, now, ramp);
    w.generatedPhaseB.frequency.setTargetAtTime(5000 + tonePositive * 42, now, ramp);

    const additiveGain = (percent, weight, linked, maxValue) => {
      const bandExpand = clamp((percent - 100) / 100, 0, 1);
      return clamp((bandExpand * weight) + (masterExpand * linked), 0, maxValue);
    };
    const lowGain = width.monoBass ? 0 : additiveGain(width.lowWidth, 0.018, 0.006, 0.018);
    const lowMidGain = additiveGain(width.lowMidWidth, 0.044, 0.014, 0.046);
    const midGain = additiveGain(width.midWidth, 0.092, 0.030, 0.096);
    const highGain = additiveGain(width.highWidth, 0.170, 0.066, 0.185);

    w.lowBand.gain.gain.setTargetAtTime(lowGain, now, ramp);
    w.lowMidBand.gain.gain.setTargetAtTime(lowMidGain, now, ramp);
    w.midBand.gain.gain.setTargetAtTime(midGain, now, ramp);
    w.highBand.gain.gain.setTargetAtTime(highGain, now, ramp);

    w.lowBand.guard.threshold.setTargetAtTime(-8, now, ramp);
    w.lowMidBand.guard.threshold.setTargetAtTime(-14, now, ramp);
    w.midBand.guard.threshold.setTargetAtTime(-18 - midGain * 46, now, ramp);
    w.highBand.guard.threshold.setTargetAtTime(-20 - highGain * 50, now, ramp);
    w.midBand.guard.ratio.setTargetAtTime(1.35 + midGain * 4.5, now, ramp);
    w.highBand.guard.ratio.setTargetAtTime(1.55 + highGain * 5.4, now, ramp);

    w.lowBand.nodeMap.high.frequency.setTargetAtTime(155, now, ramp);
    w.lowMidBand.nodeMap.low.frequency.setTargetAtTime(165, now, ramp);
    w.lowMidBand.nodeMap.high.frequency.setTargetAtTime(720, now, ramp);
    w.midBand.nodeMap.low.frequency.setTargetAtTime(720, now, ramp);
    w.midBand.nodeMap.high.frequency.setTargetAtTime(4300 + tonePositive * 30, now, ramp);
    w.highBand.nodeMap.low.frequency.setTargetAtTime(4400 + tonePositive * 45, now, ramp);

    w.sideAirTone.frequency.setTargetAtTime(9800 + tonePositive * 120, now, ramp);
    w.sideAirTone.gain.setTargetAtTime(clamp(tone * 0.14, -1.8, 2.8), now, ramp);
  }


  rampGainParam(param, target, fadeSeconds = 0.09) {
    if (!this.context || !param) return;
    const now = this.context.currentTime;
    const targetValue = Math.max(0, Number(target));
    try {
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(now);
      } else {
        const current = Number.isFinite(param.value) ? param.value : targetValue;
        param.cancelScheduledValues(now);
        param.setValueAtTime(current, now);
      }
      param.linearRampToValueAtTime(targetValue, now + Math.max(0.012, fadeSeconds));
    } catch {
      param.value = targetValue;
    }
  }

  crossfadeEnhancePower(isBypassed) {
    if (!this.context || !this.bypassGain || !this.processedGain) return false;
    const fade = isBypassed ? 0.075 : 0.115;
    // OFF → ON gets a slightly longer enhanced fade-in so compressor/limiter
    // state and filter phase settle invisibly instead of creating a tick.
    this.rampGainParam(this.bypassGain.gain, isBypassed ? 1 : 0, isBypassed ? fade : 0.085);
    this.rampGainParam(this.processedGain.gain, isBypassed ? 0 : 1, fade);
    return true;
  }

  async applyPreset(preset) {
    if (!preset) throw new Error('Preset not found.');
    this.state = this.prepareState(applyPresetToState(this.state, preset));
    if (this.context) {
      this.eqNodeGroups = this.state.eq.map((band) => this.createEqNodeGroup(band));
      this.applyAllParams();
      this.connectGraph();
      await this.applyOutputDevice();
      await this.ensureOutputPlayback();
    }
    notifyStateChanged(this.getPublicState());
  }

  async updateState(patch) {
    this.state = this.prepareState(deepMerge(this.state, patch));
    if (patch.eq && this.context) this.eqNodeGroups = this.state.eq.map((band) => this.createEqNodeGroup(band));
    this.applyAllParams();
    const bypassPatch = patch.output?.bypass !== undefined;
    const graphTogglePatch = (patch.output?.limiterEnabled !== undefined)
      || (patch.compressor?.enabled !== undefined)
      || (patch.color?.enabled !== undefined)
      || (patch.width?.enabled !== undefined)
      || (patch.eqEnabled !== undefined)
      || Boolean(patch.eq);
    if (graphTogglePatch) {
      this.connectGraph();
    }
    if (bypassPatch && !graphTogglePatch) {
      this.crossfadeEnhancePower(Boolean(this.state.output.bypass));
    } else if (bypassPatch) {
      this.crossfadeEnhancePower(Boolean(this.state.output.bypass));
    }
    if (patch.output?.outputDeviceId !== undefined || patch.output?.outputDeviceLabel !== undefined) {
      await this.applyOutputDevice();
      await this.ensureOutputPlayback();
    }
    this.state.updatedAt = Date.now();
    notifyStateChanged(this.getPublicState());
  }

  getAnalysisFrame() {
    const meters = this.computeMeters();
    const spectrum = this.computeSfeqRtaSpectrum();
    return { meters, spectrum, state: this.getPublicState() };
  }

  createRtaAnalyser() {
    if (!this.context) throw new Error('Audio context is not ready.');
    const analyser = this.context.createAnalyser();
    analyser.fftSize = this.rtaFftSize;
    analyser.minDecibels = -120;
    analyser.maxDecibels = 0;
    analyser.smoothingTimeConstant = 0;
    return analyser;
  }

  createMeterAnalyser() {
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.18;
    return analyser;
  }


  updateSmartGainStaging(inputPeak, outputPeak, limiterGainReduction = 0) {
    if (!this.context || !this.smartHeadroomGain || !this.smartMakeupGain) return;

    const now = this.context.currentTime;
    const ramp = 0.18;
    const inputDb = linearToDb(Math.max(inputPeak || 0, 1e-6));
    const outputDb = linearToDb(Math.max(outputPeak || 0, 1e-6));

    // Smart headroom: most browser audio arrives mastered close to 0 dBFS.
    // Trim hot input to roughly -9 dBFS peak before the mastering rack so EQ
    // boosts + color saturation never clip / "shatter" on full-volume tabs.
    let targetHeadroomDb = 0;
    if (inputDb > -10) {
      targetHeadroomDb = clamp(-9 - inputDb, -12, 0);
    }

    // Smart restore: return most of the reserved headroom after the creative
    // chain, but automatically back off if limiter GR/output peak says the rack
    // is already too hot. This keeps output strong without crushing transients.
    const reservedDb = -targetHeadroomDb;
    const limiterPenalty = Math.max(0, limiterGainReduction - 1.5) * 0.75;
    const peakPenalty = Math.max(0, outputDb + 1.1) * 0.95;
    const targetMakeupDb = clamp(reservedDb * 0.68 - limiterPenalty * 1.15 - peakPenalty * 1.20, 0, 6);

    // UI values are smoothed separately so they do not jump while the AudioParam
    // target interpolation is settling.
    const visualAlpha = 0.08;
    this.smartHeadroomDb += (targetHeadroomDb - this.smartHeadroomDb) * visualAlpha;
    this.smartMakeupDb += (targetMakeupDb - this.smartMakeupDb) * visualAlpha;

    const safeHeadroomGain = dbToGain(this.smartHeadroomDb);
    const safeMakeupGain = dbToGain(this.smartMakeupDb);
    this.smartHeadroomGain.gain.setTargetAtTime(safeHeadroomGain, now, ramp);
    this.smartMakeupGain.gain.setTargetAtTime(safeMakeupGain, now, ramp);
  }

  computeSfeqRtaSpectrum() {
    if (!this.context || !this.inputAnalyser || !this.outputAnalyser || !this.inputFrequencyData || !this.outputFrequencyData) return this.lastRtaFrame;
    const nowMs = Date.now();
    if (this.lastRtaFrame?.updatedAt && nowMs - this.lastRtaFrame.updatedAt < RTA_MIN_FRAME_MS) return this.lastRtaFrame;
    this.inputAnalyser.getFloatFrequencyData(this.inputFrequencyData);
    this.outputAnalyser.getFloatFrequencyData(this.outputFrequencyData);
    const common = { pointCount: RTA_POINT_COUNT, octaveWidth: RTA_OCTAVE_WIDTH };
    this.lastRtaFrame = {
      source: 'sfeq-rta-v79',
      pointCount: RTA_POINT_COUNT,
      octaveWidth: RTA_OCTAVE_WIDTH,
      fftSize: this.inputAnalyser.fftSize,
      sampleRate: this.context.sampleRate,
      input: buildSfeqRtaSpectrumFromFft(this.inputFrequencyData, this.context.sampleRate, this.inputAnalyser.fftSize, common),
      output: buildSfeqRtaSpectrumFromFft(this.outputFrequencyData, this.context.sampleRate, this.outputAnalyser.fftSize, common),
      updatedAt: nowMs
    };
    return this.lastRtaFrame;
  }

  updateAdaptiveWidth(inputStereo) {
    if (!this.context || !this.widthNodes?.sideToL || !this.widthNodes?.sideToR) return;
    const width = normalizeWidth(this.state.width || {});
    const now = this.context.currentTime;
    const ramp = 0.32;

    let target = 0;
    if (width.enabled && width.width > 100) {
      const correlation = clamp(Number(inputStereo?.correlation ?? 1), -1, 1);
      const sourceWidth = clamp(Number(inputStereo?.width ?? 0), 0, 220);
      const energy = Number(inputStereo?.energy ?? 0);
      const protect = clamp((width.sourceProtect ?? 88) / 100, 0, 1);
      const macro = clamp((width.width - 100) / 100, 0, 1);

      if (Number.isFinite(energy) && energy >= 0.0025) {
        const monoLike = clamp((correlation - 0.68) / 0.28, 0, 1) * clamp((78 - sourceWidth) / 78, 0, 1);
        const safeStereo = clamp((correlation - 0.34) / 0.44, 0, 1) * clamp((112 - sourceWidth) / 112, 0, 1);
        const tooWide = Math.max(clamp((0.26 - correlation) / 0.34, 0, 1), clamp((sourceWidth - 104) / 72, 0, 1));
        target = clamp((0.08 + monoLike * 0.92 + safeStereo * 0.14) * (0.45 + macro * 0.55), 0, 1);
        target *= (1 - tooWide * protect);
        if (correlation < 0.10 || sourceWidth > 162) target = 0;
      }
    }

    this.widthAdaptiveFactor += (target - this.widthAdaptiveFactor) * 0.18;
    if (Math.abs(this.widthAdaptiveFactor) < 0.001) this.widthAdaptiveFactor = 0;
    this.widthNodes.sideToL.gain.setTargetAtTime(this.widthAdaptiveFactor, now, ramp);
    this.widthNodes.sideToR.gain.setTargetAtTime(-this.widthAdaptiveFactor, now, ramp);
  }

  applySideMidGains(now, ramp) {
    const c = this.colorNodes;
    if (!c?.sideMidWet) return;
    const f = clamp(this.colorStereoAdaptive, 0, 1.7);
    const b = this.sideMidBase || { presence: 0, tone: 0, driveDb: 0, wet: 0 };
    const toneMap = this.dopamineToneMap || createDefaultDopamineToneMap();
    const sideExcite = clamp(toneMap.sideExcite ?? 1, 0.72, 1.28);
    const anchorExcite = clamp(toneMap.anchorExcite ?? 1, 0.86, 1.34);
    const lowMidGlue = clamp(toneMap.lowMidGlue ?? 1, 0.88, 1.22);
    const lowBodyBoost = clamp(toneMap.lowBodyBoost ?? 1, 0.88, 1.28);
    const mudGuard = clamp(toneMap.mudGuard ?? 0, 0, 1);
    const harshGuard = clamp(toneMap.harshGuard ?? 0, 0, 1);
    const resonanceGuard = clamp(toneMap.resonanceGuard ?? 0, 0, 1);
    const safeSide = sideExcite * (1 - harshGuard * 0.28) * (1 - resonanceGuard * 0.38);

    c.sideMidPresence.frequency.setTargetAtTime(clamp(toneMap.sideFocusHz ?? 2380, 1850, 3150), now, ramp * 1.7);
    c.sideMidTone.frequency.setTargetAtTime(clamp(toneMap.tickleToneHz ?? 3600, 2850, 4550), now, ramp * 1.7);
    c.sideMidPresence.gain.setTargetAtTime(b.presence * f * safeSide, now, ramp);
    c.sideMidTone.gain.setTargetAtTime(b.tone * f * safeSide * (1 - harshGuard * 0.18), now, ramp);
    c.sideMidDrive.gain.setTargetAtTime(dbToGain(b.driveDb * (0.58 + 0.42 * f) * (0.96 + safeSide * 0.04)), now, ramp);
    c.sideMidWet.gain.setTargetAtTime(clamp(b.wet * f * safeSide, 0, 0.42), now, ramp);

    // Keep a coherent center anchor under the side movement. It follows the same
    // smart factor but is never anti-phase; it is equal energy in L/R. The smart
    // tone map gently finds vocal/presence sweet spots and adds a little low-mid
    // glue only when the source feels thin.
    if (c.midAnchorWet) {
      const a = this.midAnchorBase || { peak: 0, tone: 0, driveDb: 0, wet: 0 };
      const anchorFactor = clamp(0.48 + f * 0.42, 0, 1.05) * anchorExcite * (1 - resonanceGuard * 0.30);
      c.midAnchorHighpass.frequency.setTargetAtTime(clamp(toneMap.anchorLowHz ?? 620, 520, 820), now, ramp * 1.8);
      c.midAnchorFocus.frequency.setTargetAtTime(clamp(toneMap.anchorFocusHz ?? 2050, 1450, 2650), now, ramp * 1.8);
      c.midAnchorTone.frequency.setTargetAtTime(clamp(toneMap.anchorToneHz ?? 3180, 2450, 3900), now, ramp * 1.8);
      c.midAnchorFocus.gain.setTargetAtTime(a.peak * anchorFactor * lowMidGlue, now, ramp);
      c.midAnchorTone.gain.setTargetAtTime(a.tone * anchorFactor * (1 - harshGuard * 0.12), now, ramp);
      c.midAnchorDrive.gain.setTargetAtTime(dbToGain(a.driveDb * (0.70 + anchorFactor * 0.28)), now, ramp);
      c.midAnchorWet.gain.setTargetAtTime(clamp(a.wet * anchorFactor * lowMidGlue, 0, 0.17), now, ramp);
    }

    if (c.lowBodyWet) {
      const lb = this.lowMidBodyBase || { focus: 0, mudTrim: 0, driveDb: 0, wet: 0 };
      const bodyFactor = clamp(0.48 + f * 0.34, 0, 0.96) * lowBodyBoost * (1 - resonanceGuard * 0.45);
      c.lowBodyHighpass.frequency.setTargetAtTime(clamp((toneMap.lowBodyHz ?? 255) - 118, 118, 178), now, ramp * 1.8);
      c.lowBodyLowpass.frequency.setTargetAtTime(clamp((toneMap.mudGuardHz ?? 385) + 35, 345, 440), now, ramp * 1.8);
      c.lowBodyFocus.frequency.setTargetAtTime(clamp(toneMap.lowBodyHz ?? 255, 210, 315), now, ramp * 1.8);
      c.lowBodyMudGuard.frequency.setTargetAtTime(clamp(toneMap.mudGuardHz ?? 385, 330, 520), now, ramp * 1.8);
      c.lowBodyFocus.gain.setTargetAtTime(lb.focus * bodyFactor * (1 - mudGuard * 0.30), now, ramp);
      c.lowBodyMudGuard.gain.setTargetAtTime(-Math.abs(lb.mudTrim + mudGuard * 0.55 + resonanceGuard * 0.55) * clamp(bodyFactor, 0.55, 1.0), now, ramp);
      c.lowBodyDrive.gain.setTargetAtTime(dbToGain(lb.driveDb * (0.68 + bodyFactor * 0.24) * (1 - mudGuard * 0.06)), now, ramp);
      c.lowBodyWet.gain.setTargetAtTime(clamp(lb.wet * bodyFactor * (1 - mudGuard * 0.22), 0, 0.074), now, ramp);
    }
  }

  computeDopamineToneMap() {
    if (!this.context || !this.inputAnalyser || !this.inputFrequencyData) return this.dopamineToneMap || createDefaultDopamineToneMap();
    const nowMs = Date.now();
    if (this.lastDopamineToneAt && nowMs - this.lastDopamineToneAt < 220) return this.dopamineToneMap || createDefaultDopamineToneMap();
    this.inputAnalyser.getFloatFrequencyData(this.inputFrequencyData);
    const next = analyseDopamineToneMap(this.inputFrequencyData, this.context.sampleRate, this.inputAnalyser.fftSize);
    const prev = this.dopamineToneMap || createDefaultDopamineToneMap();
    const alpha = 0.16;
    const smooth = { ...prev };
    for (const key of Object.keys(next)) {
      const v = Number(next[key]);
      const p = Number(prev[key]);
      smooth[key] = Number.isFinite(v) && Number.isFinite(p) ? p + (v - p) * alpha : v;
    }
    this.dopamineToneMap = smooth;
    this.lastDopamineToneAt = nowMs;
    return smooth;
  }

  updateAdaptiveColorStereo(inputStereo) {
    if (!this.context || !this.colorNodes?.sideMidWet) return;
    const now = this.context.currentTime;
    const ramp = 0.16;
    // Smart, source-aware mid-side tickle. Driven by the INPUT stereo character
    // (open-loop -> cannot feedback-oscillate). Material that genuinely has mid
    // stereo detail gets pushed harder; near-mono material is left gentle so we
    // never fabricate phasey width; extreme/anti-phase content eases back. The
    // exciter only ever touches the real Side, so mono stays bit-clean.
    const toneMap = this.computeDopamineToneMap();
    let target = 0.55;
    const enabled = this.state.color?.enabled && (this.state.color?.mix || 0) > 0 && (this.state.color?.stereoMid || 0) > 0;
    if (enabled) {
      const corr = clamp(Number(inputStereo?.correlation ?? 1), -1, 1);
      const sourceWidth = clamp(Number(inputStereo?.width ?? 0), 0, 220);
      const energy = Number(inputStereo?.energy ?? 0);
      if (Number.isFinite(energy) && energy >= 0.0015) {
        const stereoRich = clamp((0.94 - corr) / 0.6, 0, 1);
        const widthRich = clamp(sourceWidth / 90, 0, 1);
        target = 0.54 + Math.max(stereoRich, widthRich * 0.8) * 0.82;
        target *= clamp(toneMap.sideExcite ?? 1, 0.82, 1.22);
        const extreme = clamp((0.12 - corr) / 0.42, 0, 1);
        target *= (1 - extreme * 0.58);
      }
    } else {
      target = 0;
    }
    this.colorStereoAdaptive += (target - this.colorStereoAdaptive) * 0.12;
    if (this.colorStereoAdaptive < 0.0005) this.colorStereoAdaptive = 0;
    this.applySideMidGains(now, ramp);
  }

  computeMeters() {
    if (!this.inputAnalyser || !this.outputAnalyser || !this.timeBufferIn || !this.timeBufferOut) return this.state.meters;
    this.inputAnalyser.getFloatTimeDomainData(this.timeBufferIn);
    if (this.inputLeftAnalyser && this.inputRightAnalyser && this.timeBufferInputLeft && this.timeBufferInputRight) {
      this.inputLeftAnalyser.getFloatTimeDomainData(this.timeBufferInputLeft);
      this.inputRightAnalyser.getFloatTimeDomainData(this.timeBufferInputRight);
    }
    this.outputAnalyser.getFloatTimeDomainData(this.timeBufferOut);
    if (this.leftAnalyser && this.rightAnalyser && this.timeBufferLeft && this.timeBufferRight) {
      this.leftAnalyser.getFloatTimeDomainData(this.timeBufferLeft);
      this.rightAnalyser.getFloatTimeDomainData(this.timeBufferRight);
    }

    const inputPeak = getPeak(this.timeBufferIn);
    const outputPeak = getPeak(this.timeBufferOut);
    const inputPeakLeft = this.timeBufferInputLeft ? getPeak(this.timeBufferInputLeft) : inputPeak;
    const inputPeakRight = this.timeBufferInputRight ? getPeak(this.timeBufferInputRight) : inputPeak;
    const inputStereo = this.timeBufferInputLeft && this.timeBufferInputRight
      ? analyseStereoBand(this.timeBufferInputLeft, this.timeBufferInputRight)
      : { width: 0, correlation: 1, energy: 0, sideRatio: 0 };
    this.updateAdaptiveWidth(inputStereo);
    this.updateAdaptiveColorStereo(inputStereo);
    const outputPeakLeft = this.timeBufferLeft ? getPeak(this.timeBufferLeft) : outputPeak;
    const outputPeakRight = this.timeBufferRight ? getPeak(this.timeBufferRight) : outputPeak;
    const compressorGainReduction = this.state.compressor.enabled ? Math.max(0, Math.abs(this.compressor?.reduction || 0)) : 0;
    const compressorGainReductionLeft = compressorGainReduction;
    const compressorGainReductionRight = compressorGainReduction;
    const limiterGainReduction = this.state.output.limiterEnabled ? Math.max(0, Math.abs(this.limiter?.reduction || 0)) : 0;
    this.updateSmartGainStaging(inputPeak, outputPeak, limiterGainReduction);
    const gainReduction = Math.max(compressorGainReduction, limiterGainReduction);
    const correlation = this.timeBufferLeft && this.timeBufferRight ? computeCorrelation(this.timeBufferLeft, this.timeBufferRight) : 1;
    const stereoBands = this.computeStereoBandMetrics();
    const clipping = outputPeak >= 0.98 || limiterGainReduction > 8;
    this.state.meters = {
      inputPeak,
      outputPeak,
      inputPeakLeft,
      inputPeakRight,
      outputPeakLeft,
      outputPeakRight,
      gainReduction,
      compressorGainReduction,
      compressorGainReductionLeft,
      compressorGainReductionRight,
      limiterGainReduction,
      correlation,
      inputCorrelation: inputStereo.correlation,
      inputStereoWidth: inputStereo.width,
      widthAdaptiveFactor: this.widthAdaptiveFactor,
      stereoBands,
      clipping,
      smartHeadroomDb: this.smartHeadroomDb,
      smartMakeupDb: this.smartMakeupDb,
      dopamineToneMap: this.dopamineToneMap
    };
    this.lastMeterAt = Date.now();
    return this.state.meters;
  }

  computeStereoBandMetrics() {
    const fallbacks = {
      low: { width: 0, correlation: 1 },
      mid: { width: 0, correlation: 1 },
      high: { width: 0, correlation: 1 }
    };
    if (!this.stereoBands?.length) return fallbacks;
    const result = { ...fallbacks };
    for (const band of this.stereoBands) {
      if (!band.leftAnalyser || !band.rightAnalyser || !band.leftBuffer || !band.rightBuffer) continue;
      band.leftAnalyser.getFloatTimeDomainData(band.leftBuffer);
      band.rightAnalyser.getFloatTimeDomainData(band.rightBuffer);
      result[band.id] = analyseStereoBand(band.leftBuffer, band.rightBuffer);
    }
    return result;
  }

  getPublicState() {
    return { ...this.state, eq: normalizeEqBands(this.state.eq), meters: this.computeMeters() };
  }
}

function getPeak(buffer) {
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const abs = Math.abs(buffer[i]);
    if (abs > peak) peak = abs;
  }
  return Math.min(1, peak);
}

function computeCorrelation(left, right) {
  let lr = 0;
  let ll = 0;
  let rr = 0;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const l = left[i];
    const r = right[i];
    lr += l * r;
    ll += l * l;
    rr += r * r;
  }
  const denom = Math.sqrt(ll * rr);
  return denom > 1e-12 ? clamp(lr / denom, -1, 1) : 1;
}

function analyseStereoBand(left, right) {
  let midPower = 0;
  let sidePower = 0;
  let totalPower = 0;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const l = left[i];
    const r = right[i];
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    midPower += mid * mid;
    sidePower += side * side;
    totalPower += l * l + r * r;
  }
  const energy = Math.sqrt(totalPower / Math.max(1, n * 2));
  if (!Number.isFinite(energy) || energy < 0.0025) return { width: 0, correlation: 1, energy, sideRatio: 0 };
  const correlation = computeCorrelation(left, right);
  const ratio = Math.sqrt(sidePower / Math.max(midPower, 1e-9));
  const width = clamp(ratio * 140, 0, 220);
  return { width, correlation, energy, sideRatio: ratio };
}

function createDefaultDopamineToneMap() {
  return {
    lowMidGlue: 1,
    lowBodyBoost: 1,
    mudGuard: 0,
    lowBodyHz: 255,
    mudGuardHz: 385,
    anchorExcite: 1,
    sideExcite: 1,
    harshGuard: 0,
    resonanceGuard: 0,
    anchorLowHz: 620,
    anchorFocusHz: 2050,
    anchorToneHz: 3180,
    sideFocusHz: 2380,
    tickleToneHz: 3600
  };
}

function analyseDopamineToneMap(freqData, sampleRate, fftSize) {
  if (!freqData || !sampleRate || !fftSize) return createDefaultDopamineToneMap();
  const nyquist = sampleRate / 2;
  const binHz = sampleRate / fftSize;
  const clampBin = (hz) => clamp(Math.round(hz / binHz), 0, freqData.length - 1);
  const bandPower = (lo, hi) => {
    const a = clampBin(lo);
    const b = Math.max(a, clampBin(Math.min(hi, nyquist - 10)));
    let sum = 0;
    let n = 0;
    for (let i = a; i <= b; i += 1) {
      const db = Number(freqData[i]);
      if (!Number.isFinite(db)) continue;
      sum += Math.pow(10, db / 10);
      n += 1;
    }
    return n ? sum / n : 1e-12;
  };
  const weightedFreq = (lo, hi, fallback) => {
    const a = clampBin(lo);
    const b = Math.max(a, clampBin(Math.min(hi, nyquist - 10)));
    let sum = 0;
    let weight = 0;
    for (let i = a; i <= b; i += 1) {
      const db = Number(freqData[i]);
      if (!Number.isFinite(db)) continue;
      const p = Math.pow(10, db / 10);
      const freq = i * binHz;
      sum += freq * p;
      weight += p;
    }
    return weight > 1e-12 ? sum / weight : fallback;
  };
  const spectralCrest = (lo, hi) => {
    const a = clampBin(lo);
    const b = Math.max(a, clampBin(Math.min(hi, nyquist - 10)));
    let sum = 0;
    let max = 0;
    let n = 0;
    for (let i = a; i <= b; i += 1) {
      const db = Number(freqData[i]);
      if (!Number.isFinite(db)) continue;
      const p = Math.pow(10, db / 10);
      sum += p;
      if (p > max) max = p;
      n += 1;
    }
    const avg = n ? sum / n : 1e-12;
    return clamp(linearToDb(max / Math.max(avg, 1e-12)) / 18, 0, 1);
  };

  const broad = Math.max(bandPower(180, 7600), 1e-12);
  const punch = bandPower(160, 320) / broad;
  const vocalBody = bandPower(200, 310) / broad;
  const mudBox = bandPower(330, 520) / broad;
  const lowMid = bandPower(360, 780) / broad;
  const center = bandPower(900, 1750) / broad;
  const vocal = bandPower(1550, 2850) / broad;
  const tickle = bandPower(2850, 4550) / broad;
  const harsh = bandPower(5200, 7800) / broad;

  const lowMidNeed = clamp((0.44 - lowMid) / 0.36, 0, 1);
  const bodyNeed = clamp((0.34 - vocalBody) / 0.30, 0, 1);
  const mudGuard = clamp((mudBox - vocalBody * 0.78 - 0.10) / 0.34, 0, 1);
  const vocalNeed = clamp((0.52 - vocal) / 0.42, 0, 1);
  const centerNeed = clamp((0.40 - center) / 0.34, 0, 1);
  const tickleReady = clamp((vocal * 0.55 + tickle * 0.65 - 0.20) / 0.62, 0, 1);
  const harshGuard = clamp((harsh - 0.34) / 0.46, 0, 1);
  const bodyHeavy = clamp((punch + lowMid + mudBox * 0.7 - 1.08) / 0.86, 0, 1);
  const resonanceGuard = Math.max(
    spectralCrest(200, 520),
    spectralCrest(1450, 2850),
    spectralCrest(2850, 4700),
    spectralCrest(5200, 7800)
  );

  // Do not chase the hottest partial. The previous smart map moved boost filters
  // directly onto dominant peaks; with Max Enhancer that could turn a vocal/nasal
  // or guitar partial into an obvious resonance. These are broad musical sweet
  // zones, with the resonance guard reducing boost when the source is already
  // narrow/peaky.
  return {
    lowMidGlue: clamp(1.00 + lowMidNeed * 0.060 + bodyNeed * 0.055 - bodyHeavy * 0.070 - mudGuard * 0.050 - resonanceGuard * 0.055, 0.90, 1.12),
    lowBodyBoost: clamp(1.00 + bodyNeed * 0.115 + vocalNeed * 0.030 - mudGuard * 0.150 - bodyHeavy * 0.070 - resonanceGuard * 0.115, 0.88, 1.13),
    mudGuard: clamp(Math.max(mudGuard, resonanceGuard * 0.72), 0, 1),
    lowBodyHz: clamp(238 + bodyNeed * 22 - mudGuard * 12, 225, 275),
    mudGuardHz: clamp(weightedFreq(330, 520, 385), 350, 465),
    anchorExcite: clamp(1.00 + vocalNeed * 0.090 + centerNeed * 0.055 - harshGuard * 0.130 - resonanceGuard * 0.135, 0.84, 1.12),
    sideExcite: clamp(1.00 + tickleReady * 0.095 + vocalNeed * 0.030 - harshGuard * 0.255 - resonanceGuard * 0.210, 0.70, 1.11),
    harshGuard: clamp(Math.max(harshGuard, resonanceGuard * 0.42), 0, 1),
    resonanceGuard,
    anchorLowHz: clamp(680 + bodyHeavy * 45 - lowMidNeed * 35, 620, 760),
    anchorFocusHz: clamp(1840 + vocalNeed * 170 - harshGuard * 80, 1700, 2220),
    anchorToneHz: clamp(2950 + tickleReady * 140 - harshGuard * 190, 2700, 3300),
    sideFocusHz: clamp(2300 + tickleReady * 120 - resonanceGuard * 110, 2100, 2600),
    tickleToneHz: clamp(3450 + tickleReady * 210 - harshGuard * 260 - resonanceGuard * 180, 3150, 3800)
  };
}


function makeLinearCurve() {
  const samples = 256;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    curve[i] = (i / (samples - 1)) * 2 - 1;
  }
  return curve;
}

function makeSaturationCurve(driveDb = 3, mode = 'clean') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(12, Math.max(0, driveDb)));
  const asym = mode === 'warm' ? 0.13 : mode === 'modern' ? 0.060 : 0.075;
  const hardness = mode === 'modern' ? 0.62 : mode === 'warm' ? 0.54 : 0.48;
  const norm = Math.tanh(drive * hardness * (1 + asym)) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const d = x * drive;
    const biased = d >= 0 ? d * (1 + asym) : d * (1 - asym);
    const shaped = Math.tanh(biased * hardness) / norm;
    curve[i] = clamp(shaped * 0.82 + x * 0.18, -0.98, 0.98);
  }
  return curve;
}

function makeBassExciterCurve(driveDb = 3, mode = 'clean') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(9, Math.max(0, driveDb)));
  const warmth = mode === 'warm' ? 0.115 : mode === 'modern' ? 0.058 : 0.070;
  const hardness = mode === 'modern' ? 0.50 : mode === 'warm' ? 0.43 : 0.45;
  const norm = Math.tanh(drive * hardness + warmth) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const even = warmth * (x * x - 0.3333333);
    const shaped = Math.tanh((x * drive + even) * hardness) / norm;
    // Preserve transient and fundamental; wet EQ supplies weight, curve supplies harmonic audibility.
    curve[i] = clamp(shaped * 0.46 + x * 0.54, -0.98, 0.98);
  }
  return curve;
}

function makeAnalogWarmCurve(driveDb = 3, mode = 'warm') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(10, Math.max(0, driveDb)));
  const even = mode === 'warm' ? 0.105 : mode === 'modern' ? 0.068 : 0.078;
  const third = mode === 'modern' ? 0.035 : 0.022;
  const hardness = mode === 'warm' ? 0.44 : mode === 'modern' ? 0.50 : 0.40;
  const norm = Math.tanh(drive * hardness + even) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const analog = x * drive + even * (x * x - 0.3333333) + third * x * x * x;
    const shaped = Math.tanh(analog * hardness) / norm;
    curve[i] = clamp(shaped * 0.64 + x * 0.36, -0.97, 0.97);
  }
  return curve;
}

function makePresenceExciterCurve(driveDb = 3, mode = 'clean') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(9, Math.max(0, driveDb)));
  const hardness = mode === 'modern' ? 0.40 : mode === 'warm' ? 0.34 : 0.36;
  const even = mode === 'warm' ? 0.046 : 0.030;
  const norm = Math.tanh(drive * hardness) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const shaped = Math.tanh((x * drive + even * (x * x - 0.3333333)) * hardness) / norm;
    curve[i] = clamp(shaped * 0.44 + x * 0.56, -0.965, 0.965);
  }
  return curve;
}

function makeAirExciterCurve(driveDb = 3, mode = 'clean') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(8, Math.max(0, driveDb)));
  const hardness = mode === 'modern' ? 0.30 : mode === 'warm' ? 0.26 : 0.25;
  const even = mode === 'modern' ? 0.016 : 0.022;
  const odd = mode === 'modern' ? 0.066 : 0.050;
  const norm = Math.tanh(drive * hardness) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const soft = Math.tanh(x * drive * hardness) / norm;
    const shimmer = even * (x * x - 0.3333333) + odd * x * x * x;
    curve[i] = clamp(soft * 0.22 + x * 0.72 + shimmer, -0.94, 0.94);
  }
  return curve;
}

function makeMidAnchorCurve(driveDb = 2.5, mode = 'modern') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(6.2, Math.max(0, driveDb)));
  const even = mode === 'warm' ? 0.074 : mode === 'modern' ? 0.052 : 0.040;
  const third = mode === 'modern' ? 0.018 : 0.012;
  const hardness = mode === 'modern' ? 0.32 : mode === 'warm' ? 0.28 : 0.25;
  const norm = Math.tanh(drive * hardness + even) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const shaped = Math.tanh((x * drive + even * (x * x - 0.3333333) + third * x * x * x) * hardness) / norm;
    // Mostly clean pass-through with a little even-harmonic sweetness. This is
    // the center support layer, not distortion.
    curve[i] = clamp(shaped * 0.32 + x * 0.68, -0.96, 0.96);
  }
  return curve;
}

function makeSideAirExciterCurve(driveDb = 3, mode = 'modern') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(7, Math.max(0, driveDb)));
  const hardness = mode === 'modern' ? 0.24 : mode === 'warm' ? 0.22 : 0.20;
  const odd = mode === 'modern' ? 0.040 : 0.032;
  const even = mode === 'warm' ? 0.012 : 0.008;
  const norm = Math.tanh(drive * hardness) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const soft = Math.tanh((x * drive + even * (x * x - 0.3333333)) * hardness) / norm;
    const shimmer = odd * x * x * x;
    curve[i] = clamp(soft * 0.20 + x * 0.76 + shimmer, -0.92, 0.92);
  }
  return curve;
}

function makeSoftClipCurve(amount = 0.94) {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const knee = Math.min(0.98, Math.max(0.72, amount));
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const ax = Math.abs(x);
    if (ax <= knee) {
      curve[i] = x;
    } else {
      const sign = x < 0 ? -1 : 1;
      const over = (ax - knee) / (1 - knee);
      const shaped = knee + (1 - knee) * Math.tanh(over * 1.55) / Math.tanh(1.55);
      curve[i] = sign * Math.min(0.995, shaped);
    }
  }
  return curve;
}

function deepMerge(target, patch) {
  if (!patch || typeof patch !== 'object') return target;
  if (Array.isArray(patch)) return patch;
  const output = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      output[key] = value.map((item, index) => (typeof item === 'object' ? { ...item, id: item.id || `band-${index}` } : item));
    } else if (value && typeof value === 'object') {
      output[key] = deepMerge(target?.[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function linearToDb(value) { return 20 * Math.log10(Math.max(value, 1e-12)); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clamp01(value) { return clamp(Number.isFinite(value) ? value : 0, 0, 1); }
