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

const RTA_POINT_COUNT = 144;
const RTA_OCTAVE_WIDTH = 1 / 9;

function isLowPowerRuntime() {
  const nav = navigator || {};
  const lowMemoryDevice = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
  const lowCoreDevice = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
  return lowMemoryDevice || lowCoreDevice;
}

function chooseRtaFftSize() {
  return isLowPowerRuntime() ? 4096 : 8192;
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
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.correlationSplitter = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.meterSink = null;
    this.outputRouteDestination = null;
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
    if (initialState) {
      const { presets, ...initialBase } = initialState;
      this.state = this.prepareState({ ...createDefaultState(), ...initialBase, active: false, tabId: null });
    }

    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Web Audio API is not available in this browser.');

    this.context = new AudioContextCtor({ latencyHint: 'interactive' });
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
    this.softClipper.oversample = '4x';

    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = this.state.output.limiterCeiling;
    this.limiter.knee.value = this.state.output.punchProtect ? 3 : 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = this.state.output.punchProtect ? 0.004 : 0.0015;
    this.limiter.release.value = this.state.output.punchProtect ? 0.08 : 0.055;

    this.outputGain = this.context.createGain();
    this.rtaFftSize = chooseRtaFftSize();
    this.inputAnalyser = this.createRtaAnalyser();
    this.outputAnalyser = this.createRtaAnalyser();
    this.leftAnalyser = this.createMeterAnalyser();
    this.rightAnalyser = this.createMeterAnalyser();
    this.correlationSplitter = this.context.createChannelSplitter(2);
    this.meterSink = this.context.createGain();
    this.meterSink.gain.value = 0;
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
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.correlationSplitter = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.meterSink = null;
    this.outputRouteDestination = null;
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

      // Air/exciter path, deliberately high-passed so it adds clarity without
      // dragging noise and harsh low-mid grit into the result.
      airPre: this.context.createBiquadFilter(),
      airDrive: this.context.createGain(),
      airShaper: this.context.createWaveShaper(),
      airDcBlock: this.context.createBiquadFilter(),
      airTone: this.context.createBiquadFilter(),
      airWet: this.context.createGain(),

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
    c.bassShaper.oversample = '4x';

    c.warmPre.type = 'bandpass';
    c.warmPre.frequency.value = 520;
    c.warmPre.Q.value = 0.65;
    c.warmDcBlock.type = 'highpass';
    c.warmDcBlock.frequency.value = 22;
    c.warmDcBlock.Q.value = 0.707;
    c.warmTone.type = 'peaking';
    c.warmTone.frequency.value = 720;
    c.warmTone.Q.value = 0.75;
    c.warmShaper.oversample = '4x';

    c.airPre.type = 'highpass';
    c.airPre.frequency.value = 2800;
    c.airPre.Q.value = 0.707;
    c.airDcBlock.type = 'highpass';
    c.airDcBlock.frequency.value = 120;
    c.airDcBlock.Q.value = 0.707;
    c.airTone.type = 'highshelf';
    c.airTone.frequency.value = 5600;
    c.airTone.Q.value = 0.7;
    c.airShaper.oversample = '4x';

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
    this.widthNodes = {
      input: this.context.createGain(),
      splitter: this.context.createChannelSplitter(2),
      merger: this.context.createChannelMerger(2),
      lMidL: this.context.createGain(),
      rMidL: this.context.createGain(),
      lMidR: this.context.createGain(),
      rMidR: this.context.createGain(),
      lSide: this.context.createGain(),
      rSide: this.context.createGain(),
      sideBus: this.context.createGain(),
      sideHighpass: this.context.createBiquadFilter(),
      sideTone: this.context.createBiquadFilter(),
      sideWidth: this.context.createGain(),
      sideToL: this.context.createGain(),
      sideToR: this.context.createGain()
    };
    this.widthNodes.sideHighpass.type = 'highpass';
    this.widthNodes.sideHighpass.Q.value = 0.707;
    this.widthNodes.sideTone.type = 'highshelf';
    this.widthNodes.sideTone.frequency.value = 3500;
    this.widthNodes.sideTone.Q.value = 0.7;
    this.widthNodes.sideToL.gain.value = 1;
    this.widthNodes.sideToR.gain.value = -1;
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
      ...Object.values(this.widthNodes || {}),
      this.smartMakeupGain,
      this.limiterDrive,
      this.softClipper,
      this.limiter,
      this.outputGain,
      this.outputAnalyser,
      this.correlationSplitter,
      this.leftAnalyser,
      this.rightAnalyser,
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

    if (this.state.output.bypass) {
      let bypassCursor = this.inputAnalyser.connect(this.outputGain);
      this.connectOutputMetersAndDestination(bypassCursor);
      return;
    }

    let cursor = this.inputAnalyser.connect(this.inputGain).connect(this.smartHeadroomGain).connect(this.safetyHighPass);
    if (this.state.eqEnabled !== false) {
      for (const eqNode of this.getFlatEqNodes()) cursor = cursor.connect(eqNode);
    }

    if (this.state.compressor.enabled) cursor = this.connectCompressor(cursor);
    if (this.state.color.enabled && this.state.color.mix > 0) cursor = this.connectColor(cursor);
    if (this.state.width.enabled && Math.abs(this.state.width.width - 100) > 0.1) cursor = this.connectWidth(cursor);

    if (this.smartMakeupGain) cursor = cursor.connect(this.smartMakeupGain);

    if (this.state.output.limiterEnabled) {
      cursor = cursor.connect(this.limiterDrive).connect(this.softClipper).connect(this.limiter);
    }

    cursor = cursor.connect(this.outputGain);
    this.connectOutputMetersAndDestination(cursor);
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
      this.meterSink.connect(routeDestination);
    }
  }

  createOutputRoute() {
    if (!this.context) return;
    this.outputRouteDestination = this.context.createMediaStreamDestination();
    this.outputElement = document.getElementById('processedOutput') || document.createElement('audio');
    this.outputElement.autoplay = true;
    this.outputElement.controls = false;
    this.outputElement.muted = false;
    this.outputElement.playsInline = true;
    this.outputElement.srcObject = this.outputRouteDestination.stream;
    this.outputElement.dataset.role = 'ar-audio-enhancer-output';
    if (!this.outputElement.isConnected) document.body.appendChild(this.outputElement);
  }

  async applyOutputDevice() {
    if (!this.outputElement) return;
    const output = normalizeOutput(this.state.output || {});
    const deviceId = normalizeOutputDeviceId(output.outputDeviceId);
    const sinkId = deviceIdToSinkId(deviceId);
    const label = output.outputDeviceLabel || (deviceId === 'default' ? 'System Default' : 'Selected output device');

    if (typeof this.outputElement.setSinkId !== 'function') {
      this.routeStatus = { ok: false, deviceId, label, status: 'unsupported', error: 'setSinkId is not supported by this browser.' };
      this.state.output = normalizeOutput({ ...this.state.output, outputRouteStatus: 'unsupported' });
      return;
    }

    try {
      await this.outputElement.setSinkId(sinkId);
      this.routeStatus = { ok: true, deviceId, label, sinkId: this.outputElement.sinkId || 'default', status: deviceId === 'default' ? 'default' : 'routed' };
      this.state.output = normalizeOutput({ ...this.state.output, outputDeviceId: deviceId, outputDeviceLabel: label, outputRouteStatus: this.routeStatus.status });
    } catch (error) {
      this.routeStatus = { ok: false, deviceId, label, status: 'failed', error: error.message || String(error) };
      this.state.output = normalizeOutput({ ...this.state.output, outputRouteStatus: 'failed' });
      if (deviceId !== 'default') {
        try {
          await this.outputElement.setSinkId('');
          this.outputElement.srcObject = this.outputRouteDestination?.stream || null;
        } catch {}
      }
    }
  }

  async ensureOutputPlayback() {
    if (!this.outputElement) return;
    try {
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
    c.dry.gain.value = 1 - mix * 0.2;
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
      .connect(c.airPre)
      .connect(c.airDrive)
      .connect(c.airShaper)
      .connect(c.airDcBlock)
      .connect(c.airTone)
      .connect(c.airWet)
      .connect(c.output);

    return c.output;
  }

  connectWidth(cursor) {
    const w = this.widthNodes;
    cursor.connect(w.input).connect(w.splitter);

    w.splitter.connect(w.lMidL, 0); w.lMidL.connect(w.merger, 0, 0);
    w.splitter.connect(w.rMidL, 1); w.rMidL.connect(w.merger, 0, 0);
    w.splitter.connect(w.lMidR, 0); w.lMidR.connect(w.merger, 0, 1);
    w.splitter.connect(w.rMidR, 1); w.rMidR.connect(w.merger, 0, 1);

    w.splitter.connect(w.lSide, 0); w.lSide.connect(w.sideBus);
    w.splitter.connect(w.rSide, 1); w.rSide.connect(w.sideBus);
    const sideStart = this.state.width.monoBass ? w.sideBus.connect(w.sideHighpass) : w.sideBus;
    sideStart.connect(w.sideTone).connect(w.sideWidth);
    w.sideWidth.connect(w.sideToL).connect(w.merger, 0, 0);
    w.sideWidth.connect(w.sideToR).connect(w.merger, 0, 1);
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
    const airAmount = clamp((color.air || 0) / 24, -1, 1);
    const harmonicAmount = clamp01((color.harmonics || 0) / 100);
    const modeDrive = color.mode === 'modern' ? 1.18 : color.mode === 'warm' ? 0.92 : 0.76;
    const driveDb = clamp(color.drive + color.harmonics * 0.085, 0, 24) * modeDrive;

    // Speaker projection: more harmonics around 120–320 Hz, not raw sub boost.
    c.bassPre.frequency.setTargetAtTime(120 + Math.max(0, bodyAmount) * 55, now, ramp);
    c.bassPostHighpass.frequency.setTargetAtTime(62 + Math.max(0, bodyAmount) * 26, now, ramp);
    c.bassPostLowpass.frequency.setTargetAtTime(520 + harmonicAmount * 300, now, ramp);
    c.bassPunch.frequency.setTargetAtTime(155 + Math.max(0, bodyAmount) * 65, now, ramp);
    c.bassPunch.gain.setTargetAtTime(Math.max(0, color.body) * 0.16 + harmonicAmount * 1.6, now, ramp);
    c.bassDrive.gain.setTargetAtTime(dbToGain(driveDb + Math.max(0, color.body) * 0.10), now, ramp);
    c.bassWet.gain.setTargetAtTime(mix * (0.26 + Math.max(0, bodyAmount) * 0.42 + harmonicAmount * 0.28), now, ramp);
    c.bassShaper.curve = makeBassExciterCurve(driveDb + Math.max(0, color.body) * 0.09, color.mode);

    c.warmPre.frequency.setTargetAtTime(360 + Math.max(0, color.warmth) * 18, now, ramp);
    c.warmDrive.gain.setTargetAtTime(dbToGain(Math.max(0, driveDb - 1.2) + Math.max(0, color.warmth) * 0.05), now, ramp);
    c.warmTone.gain.setTargetAtTime(color.warmth * 0.10, now, ramp);
    c.warmWet.gain.setTargetAtTime(mix * (0.18 + Math.max(0, warmthAmount) * 0.30 + harmonicAmount * 0.16), now, ramp);
    c.warmShaper.curve = makeSaturationCurve(driveDb * 0.72 + Math.max(0, color.warmth) * 0.04, color.mode);

    c.airPre.frequency.setTargetAtTime(color.mode === 'modern' ? 2400 : 3200, now, ramp);
    c.airDrive.gain.setTargetAtTime(dbToGain(driveDb * 0.45 + harmonicAmount * 3.5), now, ramp);
    c.airTone.gain.setTargetAtTime(color.air * 0.18 + harmonicAmount * 1.2, now, ramp);
    c.airWet.gain.setTargetAtTime(mix * Math.max(0, 0.12 + Math.max(0, airAmount) * 0.26 + harmonicAmount * 0.16), now, ramp);
    c.airShaper.curve = makeAirExciterCurve(driveDb * 0.52 + harmonicAmount * 4, color.mode);

    // Auto output compensation: keep perceived level stable as drive/mix rise
    // (FabFilter-style — output is adjusted automatically while driving harder).
    const colorComp = 1 / (1 + mix * (driveDb / 24) * 0.55 + harmonicAmount * mix * 0.35);
    c.output.gain.setTargetAtTime(clamp(colorComp, 0.62, 1), now, ramp);

    // Keep older graph fields coherent for restored sessions, even though v0.2.4
    // uses the split Bass/Warm/Air paths above.
    c.drive.gain.setTargetAtTime(dbToGain(driveDb), now, ramp);
    c.body.gain.setTargetAtTime(color.body * 0.12, now, ramp);
    c.warmth.gain.setTargetAtTime(color.warmth * 0.10, now, ramp);
    c.air.gain.setTargetAtTime((color.air + color.harmonics * 0.04) * 0.12, now, ramp);
    c.wet.gain.setTargetAtTime(mix, now, ramp);
    c.shaper.curve = makeSaturationCurve(driveDb, color.mode);
  }

  applyWidthParams(now, ramp) {
    if (!this.widthNodes?.sideWidth) return;
    const width = this.state.width;
    const side = clamp(width.width / 100, 0, 1.5);
    const w = this.widthNodes;
    for (const node of [w.lMidL, w.rMidL, w.lMidR, w.rMidR]) node.gain.setTargetAtTime(0.5, now, ramp);
    w.lSide.gain.setTargetAtTime(0.5, now, ramp);
    w.rSide.gain.setTargetAtTime(-0.5, now, ramp);
    w.sideWidth.gain.setTargetAtTime(side, now, ramp);
    w.sideHighpass.frequency.setTargetAtTime(width.monoBassFreq, now, ramp);
    w.sideTone.gain.setTargetAtTime(width.sideTone, now, ramp);
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
    if (patch.eqEnabled !== undefined || patch.output?.bypass !== undefined || patch.output?.limiterEnabled !== undefined || patch.compressor?.enabled !== undefined || patch.color || patch.width || patch.eq) {
      this.connectGraph();
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
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    return analyser;
  }


  updateSmartGainStaging(inputPeak, outputPeak, limiterGainReduction = 0) {
    if (!this.context || !this.smartHeadroomGain || !this.smartMakeupGain) return;

    const now = this.context.currentTime;
    const ramp = 0.18;
    const inputDb = linearToDb(Math.max(inputPeak || 0, 1e-6));
    const outputDb = linearToDb(Math.max(outputPeak || 0, 1e-6));

    // Smart headroom: most browser audio arrives mastered close to 0 dBFS.
    // Trim only when input is hot, targeting roughly -6 dBFS peak before the
    // mastering rack so EQ/color/width have safe room to breathe.
    let targetHeadroomDb = 0;
    if (inputDb > -8) {
      targetHeadroomDb = clamp(-6 - inputDb, -7.5, 0);
    }

    // Smart restore: return most of the reserved headroom after the creative
    // chain, but automatically back off if limiter GR/output peak says the rack
    // is already too hot. This keeps output strong without crushing transients.
    const reservedDb = -targetHeadroomDb;
    const limiterPenalty = Math.max(0, limiterGainReduction - 1.5) * 0.75;
    const peakPenalty = Math.max(0, outputDb + 1.1) * 0.95;
    const targetMakeupDb = clamp(reservedDb * 0.82 - limiterPenalty - peakPenalty, 0, 6.5);

    // UI values are smoothed separately so they do not jump while the AudioParam
    // target interpolation is settling.
    const visualAlpha = 0.12;
    this.smartHeadroomDb += (targetHeadroomDb - this.smartHeadroomDb) * visualAlpha;
    this.smartMakeupDb += (targetMakeupDb - this.smartMakeupDb) * visualAlpha;

    const safeHeadroomGain = dbToGain(this.smartHeadroomDb);
    const safeMakeupGain = dbToGain(this.smartMakeupDb);
    this.smartHeadroomGain.gain.setTargetAtTime(safeHeadroomGain, now, ramp);
    this.smartMakeupGain.gain.setTargetAtTime(safeMakeupGain, now, ramp);
  }

  computeSfeqRtaSpectrum() {
    if (!this.context || !this.inputAnalyser || !this.outputAnalyser || !this.inputFrequencyData || !this.outputFrequencyData) return this.lastRtaFrame;
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
      updatedAt: Date.now()
    };
    return this.lastRtaFrame;
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
    const outputPeakLeft = this.timeBufferLeft ? getPeak(this.timeBufferLeft) : outputPeak;
    const outputPeakRight = this.timeBufferRight ? getPeak(this.timeBufferRight) : outputPeak;
    const compressorGainReduction = this.state.compressor.enabled ? Math.max(0, Math.abs(this.compressor?.reduction || 0)) : 0;
    const limiterGainReduction = this.state.output.limiterEnabled ? Math.max(0, Math.abs(this.limiter?.reduction || 0)) : 0;
    this.updateSmartGainStaging(inputPeak, outputPeak, limiterGainReduction);
    const gainReduction = Math.max(compressorGainReduction, limiterGainReduction);
    const correlation = this.timeBufferLeft && this.timeBufferRight ? computeCorrelation(this.timeBufferLeft, this.timeBufferRight) : 1;
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
      limiterGainReduction,
      correlation,
      clipping,
      smartHeadroomDb: this.smartHeadroomDb,
      smartMakeupDb: this.smartMakeupDb
    };
    this.lastMeterAt = Date.now();
    return this.state.meters;
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

function makeSaturationCurve(driveDb = 3, mode = 'clean') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(24, Math.max(0, driveDb)));
  // Tube-style asymmetry → musical 2nd-harmonic warmth (DC is removed downstream).
  const asym = mode === 'warm' ? 0.22 : mode === 'modern' ? 0.06 : 0.10;
  const hardness = mode === 'modern' ? 1.25 : mode === 'warm' ? 0.85 : 0.70;
  const norm = Math.tanh(drive * hardness * (1 + asym)) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const d = x * drive;
    const biased = d >= 0 ? d * (1 + asym) : d * (1 - asym);
    curve[i] = Math.tanh(biased * hardness) / norm;
  }
  return curve;
}


function makeBassExciterCurve(driveDb = 3, mode = 'clean') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(24, Math.max(0, driveDb)));
  const warmth = mode === 'warm' ? 0.18 : mode === 'modern' ? 0.08 : 0.12;
  const hardness = mode === 'modern' ? 1.05 : mode === 'warm' ? 0.72 : 0.82;
  const norm = Math.tanh(drive * hardness + warmth);
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const even = warmth * (x * x - 0.3333333);
    const shaped = Math.tanh((x * drive + even) * hardness);
    curve[i] = norm > 0 ? shaped / norm : shaped;
  }
  return curve;
}

function makeAirExciterCurve(driveDb = 3, mode = 'clean') {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const drive = dbToGain(Math.min(18, Math.max(0, driveDb)));
  const soft = mode === 'warm' ? 0.22 : mode === 'modern' ? 0.10 : 0.16;
  const even = mode === 'modern' ? 0.10 : 0.16; // gentle 2nd-harmonic shimmer (DC removed downstream)
  const norm = Math.tanh(drive) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    const odd = Math.tanh(x * drive) / norm;     // soft primary excitation
    const second = (x * x - 0.3333333) * even;   // airy sweetness, not harsh odd grit
    curve[i] = (1 - soft) * odd + soft * x + second;
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
