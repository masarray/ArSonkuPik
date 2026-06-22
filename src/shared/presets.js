export const EQ_TYPE_LABELS = {
  lowcut: 'Low cut',
  lowshelf: 'Low shelf',
  bell: 'Bell',
  notch: 'Notch',
  highshelf: 'High shelf',
  highcut: 'High cut'
};

export const WEB_AUDIO_TYPE = {
  lowcut: 'highpass',
  lowshelf: 'lowshelf',
  bell: 'peaking',
  notch: 'notch',
  highshelf: 'highshelf',
  highcut: 'lowpass'
};

export const DEFAULT_EQ_BANDS = [
  { id: 'cut-low', label: 'Low Cut', type: 'lowcut', frequency: 28, gain: 0, q: 0.707, slope: 24, enabled: true },
  { id: 'low-body', label: 'Body', type: 'lowshelf', frequency: 88, gain: 1.2, q: 0.7, slope: 12, enabled: true },
  { id: 'mud', label: 'Mud', type: 'bell', frequency: 270, gain: -0.8, q: 1.05, slope: 12, enabled: true },
  { id: 'presence', label: 'Presence', type: 'bell', frequency: 2200, gain: 0.8, q: 1.0, slope: 12, enabled: true },
  { id: 'clarity', label: 'Clarity', type: 'bell', frequency: 5600, gain: 0.9, q: 1.15, slope: 12, enabled: true },
  { id: 'air', label: 'Air', type: 'highshelf', frequency: 11800, gain: 1.0, q: 0.7, slope: 12, enabled: true }
];

export const DEFAULT_COMPRESSOR = {
  threshold: -25,
  ratio: 1.6,
  knee: 18,
  attack: 0.018,
  release: 0.2,
  makeupGain: 0.6,
  parallelMix: 96,
  enabled: true
};

export const DEFAULT_COLOR = {
  enabled: true,
  drive: 2.8,
  body: 8,
  harmonics: 12,
  warmth: 7,
  air: 6,
  mix: 18,
  mode: 'warm'
};

export const DEFAULT_WIDTH = {
  enabled: true,
  width: 108,
  monoBass: true,
  monoBassFreq: 120,
  sideTone: 1.5
};

export const DEFAULT_OUTPUT = {
  inputGain: 0,
  outputGain: -1.5,
  limiterEnabled: true,
  limiterCeiling: -1,
  limiterDrive: 0.4,
  punchProtect: true,
  bypass: false,
  outputDeviceId: 'default',
  outputDeviceLabel: 'System Default',
  outputRouteStatus: 'default'
};

function p({ id, name, description, eq = DEFAULT_EQ_BANDS, compressor = {}, color = {}, width = {}, output = {} }) {
  return {
    id,
    name,
    description,
    eq,
    compressor: { ...DEFAULT_COMPRESSOR, ...compressor },
    color: { ...DEFAULT_COLOR, ...color },
    width: { ...DEFAULT_WIDTH, ...width },
    output: { ...DEFAULT_OUTPUT, ...output }
  };
}

export const FACTORY_PRESETS = [
  p({
    id: 'default',
    name: 'Default',
    description: 'Subtle full-band polish: gentle bass, open mids, smooth air.',
    eq: DEFAULT_EQ_BANDS,
    compressor: DEFAULT_COMPRESSOR,
    color: DEFAULT_COLOR,
    width: DEFAULT_WIDTH,
    output: DEFAULT_OUTPUT
  }),
  p({
    id: 'pro-music',
    name: 'Pro Music',
    description: 'Punchy bass, thick mids and sparkling detail for music.',
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 28, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 82, gain: 2.1 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 230, gain: -1.1, q: 1.05 },
      { id: 'mid-thick', label: 'Mid Thick', type: 'bell', frequency: 620, gain: 0.7, q: 0.85, slope: 12, enabled: true },
      { ...DEFAULT_EQ_BANDS[3], frequency: 2100, gain: 0.8, q: 1.0 },
      { ...DEFAULT_EQ_BANDS[4], frequency: 5200, gain: 1.1, q: 1.2 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 11800, gain: 1.8 }
    ],
    compressor: { threshold: -23, ratio: 2.0, knee: 14, attack: 0.022, release: 0.16, makeupGain: 0.8, parallelMix: 92 },
    color: { enabled: true, drive: 4.2, body: 18, warmth: 14, harmonics: 24, air: 16, mix: 28, mode: 'warm' },
    width: { enabled: true, width: 118, monoBass: true, monoBassFreq: 130, sideTone: 3 },
    output: { outputGain: -1.8, limiterDrive: 0.8, limiterCeiling: -1 }
  }),
  p({
    id: 'movie-dolby',
    name: 'Movie Dolby',
    description: 'Thick cinematic bass, clear dialog and detailed treble.',
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 26, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 72, gain: 2.5 },
      { id: 'impact', label: 'Impact', type: 'bell', frequency: 155, gain: 0.8, q: 0.8, slope: 12, enabled: true },
      { ...DEFAULT_EQ_BANDS[2], frequency: 320, gain: -1.7, q: 1.05 },
      { ...DEFAULT_EQ_BANDS[3], frequency: 1650, gain: 1.2, q: 1.0 },
      { ...DEFAULT_EQ_BANDS[4], frequency: 3900, gain: 1.4, q: 1.15 },
      { id: 'treble-detail', label: 'Treble Detail', type: 'bell', frequency: 7200, gain: 1.1, q: 1.1, slope: 12, enabled: true },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12500, gain: 1.1 }
    ],
    compressor: { threshold: -24, ratio: 1.8, knee: 18, attack: 0.026, release: 0.2, makeupGain: 0.9, parallelMix: 96 },
    color: { enabled: true, drive: 4.8, body: 24, warmth: 12, harmonics: 22, air: 10, mix: 30, mode: 'modern' },
    width: { enabled: true, width: 132, monoBass: true, monoBassFreq: 150, sideTone: 5 },
    output: { outputGain: -2.2, limiterDrive: 0.7, limiterCeiling: -1.2 }
  }),
  p({
    id: 'podcast',
    name: 'Podcast',
    description: 'Deep, soft and airy voice with strong intelligibility.',
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 78, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 125, gain: 0.8 },
      { id: 'vocal-chest', label: 'Vocal Chest', type: 'bell', frequency: 175, gain: 1.2, q: 0.8, slope: 12, enabled: true },
      { ...DEFAULT_EQ_BANDS[2], frequency: 285, gain: -2.0, q: 1.2 },
      { ...DEFAULT_EQ_BANDS[3], frequency: 1750, gain: 1.5, q: 1.0 },
      { ...DEFAULT_EQ_BANDS[4], frequency: 4300, gain: 2.0, q: 1.15 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 10800, gain: 1.0 }
    ],
    compressor: { threshold: -30, ratio: 2.8, knee: 16, attack: 0.006, release: 0.16, makeupGain: 1.8, parallelMix: 90 },
    color: { enabled: true, drive: 2.4, body: 8, warmth: 12, harmonics: 9, air: 8, mix: 17, mode: 'warm' },
    width: { enabled: false, width: 100, monoBass: true, monoBassFreq: 120, sideTone: 0 },
    output: { outputGain: -1.4, limiterDrive: 0.4, limiterCeiling: -1 }
  }),
  p({
    id: 'night-listening',
    name: 'Night Listening',
    description: 'Soft, warm and non-fatiguing for low-volume listening.',
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 42, slope: 12 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 105, gain: -1.8 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 260, gain: -0.8, q: 1.0 },
      { ...DEFAULT_EQ_BANDS[3], frequency: 1850, gain: 0.6, q: 1.1 },
      { ...DEFAULT_EQ_BANDS[4], frequency: 5200, gain: -0.8, q: 1.0 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 8400, gain: -2.4 }
    ],
    compressor: { threshold: -34, ratio: 3.2, knee: 20, attack: 0.018, release: 0.34, makeupGain: 1.4, parallelMix: 78 },
    color: { enabled: true, drive: 1.4, body: -6, warmth: 7, harmonics: 2, air: -10, mix: 10, mode: 'warm' },
    width: { enabled: false, width: 102, monoBass: true, monoBassFreq: 120, sideTone: -1 },
    output: { outputGain: -5, limiterDrive: 0.1, limiterCeiling: -1.5 }
  })
];

export const MODULE_PRESETS = {
  eq: [
    {
      id: 'default-polish',
      name: 'Default Polish',
      eqEnabled: true,
      eq: DEFAULT_EQ_BANDS
    },
    {
      id: 'punchy-music',
      name: 'Punchy Music',
      eqEnabled: true,
      eq: [
        { ...DEFAULT_EQ_BANDS[0], frequency: 28, slope: 24 },
        { ...DEFAULT_EQ_BANDS[1], frequency: 82, gain: 2.1 },
        { ...DEFAULT_EQ_BANDS[2], frequency: 230, gain: -1.1, q: 1.05 },
        { id: 'mid-thick-eq', label: 'Mid Thick', type: 'bell', frequency: 620, gain: 0.7, q: 0.85, slope: 12, enabled: true },
        { ...DEFAULT_EQ_BANDS[3], frequency: 2100, gain: 0.8, q: 1.0 },
        { ...DEFAULT_EQ_BANDS[4], frequency: 5200, gain: 1.1, q: 1.2 },
        { ...DEFAULT_EQ_BANDS[5], frequency: 11800, gain: 1.8 }
      ]
    },
    {
      id: 'dialog-clarity',
      name: 'Dialog Clarity',
      eqEnabled: true,
      eq: [
        { ...DEFAULT_EQ_BANDS[0], frequency: 70, slope: 24 },
        { ...DEFAULT_EQ_BANDS[1], frequency: 130, gain: 0.6 },
        { id: 'dialog-chest-eq', label: 'Chest', type: 'bell', frequency: 190, gain: 0.8, q: 0.85, slope: 12, enabled: true },
        { ...DEFAULT_EQ_BANDS[2], frequency: 310, gain: -1.8, q: 1.15 },
        { ...DEFAULT_EQ_BANDS[3], frequency: 1650, gain: 1.4, q: 1.0 },
        { ...DEFAULT_EQ_BANDS[4], frequency: 4200, gain: 1.8, q: 1.1 },
        { ...DEFAULT_EQ_BANDS[5], frequency: 10400, gain: 0.8 }
      ]
    },
    {
      id: 'airy-detail',
      name: 'Airy Detail',
      eqEnabled: true,
      eq: [
        { ...DEFAULT_EQ_BANDS[0], frequency: 34, slope: 24 },
        { ...DEFAULT_EQ_BANDS[1], frequency: 96, gain: 0.6 },
        { ...DEFAULT_EQ_BANDS[2], frequency: 260, gain: -0.9, q: 1 },
        { ...DEFAULT_EQ_BANDS[3], frequency: 2400, gain: 0.9, q: 1.05 },
        { ...DEFAULT_EQ_BANDS[4], frequency: 6200, gain: 1.5, q: 1.1 },
        { ...DEFAULT_EQ_BANDS[5], frequency: 12800, gain: 2.0 }
      ]
    },
    {
      id: 'night-soft-eq',
      name: 'Night Soft',
      eqEnabled: true,
      eq: [
        { ...DEFAULT_EQ_BANDS[0], frequency: 42, slope: 12 },
        { ...DEFAULT_EQ_BANDS[1], frequency: 105, gain: -1.8 },
        { ...DEFAULT_EQ_BANDS[2], frequency: 260, gain: -0.8, q: 1.0 },
        { ...DEFAULT_EQ_BANDS[3], frequency: 1850, gain: 0.6, q: 1.1 },
        { ...DEFAULT_EQ_BANDS[4], frequency: 5200, gain: -0.8, q: 1.0 },
        { ...DEFAULT_EQ_BANDS[5], frequency: 8400, gain: -2.4 }
      ]
    }
  ],
  compressor: [
    { id: 'master-glue', name: 'Master Glue', compressor: DEFAULT_COMPRESSOR },
    { id: 'punch-glue', name: 'Punch Glue', compressor: { threshold: -23, ratio: 2.0, knee: 14, attack: 0.022, release: 0.16, makeupGain: 0.8, parallelMix: 92, enabled: true } },
    { id: 'dialog-leveler', name: 'Dialog Leveler', compressor: { threshold: -27, ratio: 2.4, knee: 18, attack: 0.008, release: 0.18, makeupGain: 1.2, parallelMix: 94, enabled: true } },
    { id: 'vocal-smooth', name: 'Vocal Smooth', compressor: { threshold: -30, ratio: 2.8, knee: 16, attack: 0.006, release: 0.16, makeupGain: 1.8, parallelMix: 90, enabled: true } },
    { id: 'night-level', name: 'Night Level', compressor: { threshold: -34, ratio: 3.2, knee: 20, attack: 0.018, release: 0.34, makeupGain: 1.4, parallelMix: 78, enabled: true } }
  ],
  color: [
    { id: 'warm-tape', name: 'Warm Tape', color: DEFAULT_COLOR },
    { id: 'clean-glow', name: 'Clean Glow', color: { enabled: true, drive: 1.6, body: 4, warmth: 3, harmonics: 8, air: 4, mix: 12, mode: 'clean' } },
    { id: 'modern-exciter', name: 'Modern Exciter', color: { enabled: true, drive: 4.2, body: 8, warmth: 5, harmonics: 28, air: 16, mix: 26, mode: 'modern' } },
    { id: 'thick-sweet', name: 'Thick Sweet', color: { enabled: true, drive: 4.8, body: 24, warmth: 12, harmonics: 22, air: 10, mix: 30, mode: 'modern' } },
    { id: 'night-warm', name: 'Night Warm', color: { enabled: true, drive: 1.4, body: -6, warmth: 7, harmonics: 2, air: -10, mix: 10, mode: 'warm' } }
  ],
  width: [
    { id: 'natural-stereo', name: 'Natural Stereo', width: DEFAULT_WIDTH },
    { id: 'wide-music', name: 'Wide Music', width: { enabled: true, width: 118, monoBass: true, monoBassFreq: 130, sideTone: 3 } },
    { id: 'cinema-wide', name: 'Cinema Wide', width: { enabled: true, width: 132, monoBass: true, monoBassFreq: 150, sideTone: 5 } },
    { id: 'vocal-center', name: 'Vocal Center', width: { enabled: false, width: 100, monoBass: true, monoBassFreq: 120, sideTone: 0 } },
    { id: 'night-narrow', name: 'Night Narrow', width: { enabled: false, width: 102, monoBass: true, monoBassFreq: 120, sideTone: -1 } }
  ],
  limiter: [
    { id: 'safe-master', name: 'Safe Master', output: { inputGain: 0, outputGain: -1.5, limiterEnabled: true, limiterCeiling: -1, limiterDrive: 0.4, punchProtect: true } },
    { id: 'loud-punch', name: 'Loud Punch', output: { inputGain: 0, outputGain: -1.8, limiterEnabled: true, limiterCeiling: -1, limiterDrive: 0.8, punchProtect: true } },
    { id: 'cinema-headroom', name: 'Cinema Headroom', output: { inputGain: 0, outputGain: -2.2, limiterEnabled: true, limiterCeiling: -1.2, limiterDrive: 0.7, punchProtect: true } },
    { id: 'voice-steady', name: 'Voice Steady', output: { inputGain: 0.6, outputGain: -1.4, limiterEnabled: true, limiterCeiling: -1, limiterDrive: 0.4, punchProtect: true } },
    { id: 'night-low', name: 'Night Low', output: { inputGain: -1, outputGain: -5, limiterEnabled: true, limiterCeiling: -1.5, limiterDrive: 0.1, punchProtect: true } }
  ]
};

export function clonePreset(preset) {
  return JSON.parse(JSON.stringify(preset));
}

export function normalizeEqBand(band, index = 0) {
  const fallback = DEFAULT_EQ_BANDS[index % DEFAULT_EQ_BANDS.length] || DEFAULT_EQ_BANDS[0];
  const rawType = band?.type || fallback.type;
  const type = rawType === 'peaking' ? 'bell' : rawType === 'highpass' ? 'lowcut' : rawType === 'lowpass' ? 'highcut' : rawType;
  return {
    id: band?.id || `band-${Date.now()}-${index}`,
    label: band?.label || EQ_TYPE_LABELS[type] || fallback.label || `Band ${index + 1}`,
    type: EQ_TYPE_LABELS[type] ? type : fallback.type,
    frequency: clampNumber(band?.frequency ?? band?.freq ?? fallback.frequency, 20, 20000),
    gain: clampNumber(band?.gain ?? fallback.gain ?? 0, -24, 24),
    q: clampNumber(band?.q ?? band?.Q ?? fallback.q ?? 1, 0.1, 24),
    slope: [12, 24, 36, 48].includes(Number(band?.slope)) ? Number(band.slope) : (fallback.slope || 12),
    enabled: band?.enabled !== false
  };
}

export function normalizeEqBands(bands) {
  const source = Array.isArray(bands) && bands.length ? bands : DEFAULT_EQ_BANDS;
  return source.map((band, index) => normalizeEqBand(band, index));
}

export function normalizeCompressor(compressor = {}) {
  return {
    ...DEFAULT_COMPRESSOR,
    ...compressor,
    threshold: clampNumber(compressor.threshold ?? DEFAULT_COMPRESSOR.threshold, -60, 0),
    ratio: clampNumber(compressor.ratio ?? DEFAULT_COMPRESSOR.ratio, 1, 20),
    knee: clampNumber(compressor.knee ?? DEFAULT_COMPRESSOR.knee, 0, 40),
    attack: clampNumber(compressor.attack ?? DEFAULT_COMPRESSOR.attack, 0.001, 0.2),
    release: clampNumber(compressor.release ?? DEFAULT_COMPRESSOR.release, 0.02, 1.5),
    makeupGain: clampNumber(compressor.makeupGain ?? DEFAULT_COMPRESSOR.makeupGain, -18, 18),
    parallelMix: clampNumber(compressor.parallelMix ?? DEFAULT_COMPRESSOR.parallelMix, 0, 100),
    enabled: compressor.enabled !== false
  };
}

export function normalizeColor(color = {}) {
  return {
    ...DEFAULT_COLOR,
    ...color,
    enabled: color.enabled === true,
    drive: clampNumber(color.drive ?? DEFAULT_COLOR.drive, 0, 24),
    body: clampNumber(color.body ?? DEFAULT_COLOR.body, -24, 24),
    harmonics: clampNumber(color.harmonics ?? DEFAULT_COLOR.harmonics, 0, 100),
    warmth: clampNumber(color.warmth ?? DEFAULT_COLOR.warmth, -24, 24),
    air: clampNumber(color.air ?? DEFAULT_COLOR.air, -24, 24),
    mix: clampNumber(color.mix ?? DEFAULT_COLOR.mix, 0, 100),
    mode: ['clean', 'warm', 'modern'].includes(color.mode) ? color.mode : DEFAULT_COLOR.mode
  };
}

export function normalizeWidth(width = {}) {
  return {
    ...DEFAULT_WIDTH,
    ...width,
    enabled: width.enabled === true,
    width: clampNumber(width.width ?? DEFAULT_WIDTH.width, 0, 150),
    monoBass: width.monoBass !== false,
    monoBassFreq: clampNumber(width.monoBassFreq ?? DEFAULT_WIDTH.monoBassFreq, 60, 250),
    sideTone: clampNumber(width.sideTone ?? DEFAULT_WIDTH.sideTone, -12, 12)
  };
}

export function normalizeOutput(output = {}) {
  return {
    ...DEFAULT_OUTPUT,
    ...output,
    inputGain: clampNumber(output.inputGain ?? DEFAULT_OUTPUT.inputGain, -24, 18),
    outputGain: clampNumber(output.outputGain ?? DEFAULT_OUTPUT.outputGain, -24, 18),
    limiterCeiling: clampNumber(output.limiterCeiling ?? DEFAULT_OUTPUT.limiterCeiling, -12, 0),
    limiterDrive: clampNumber(output.limiterDrive ?? DEFAULT_OUTPUT.limiterDrive, 0, 12),
    limiterEnabled: output.limiterEnabled !== false,
    punchProtect: output.punchProtect !== false,
    bypass: output.bypass === true,
    outputDeviceId: sanitizeOutputDeviceId(output.outputDeviceId ?? DEFAULT_OUTPUT.outputDeviceId),
    outputDeviceLabel: String(output.outputDeviceLabel || DEFAULT_OUTPUT.outputDeviceLabel),
    outputRouteStatus: String(output.outputRouteStatus || DEFAULT_OUTPUT.outputRouteStatus)
  };
}

export function createDefaultState() {
  return {
    active: false,
    tabId: null,
    sourceTitle: 'No active capture',
    selectedPresetId: 'default',
    eqEnabled: true,
    eq: normalizeEqBands(DEFAULT_EQ_BANDS),
    compressor: normalizeCompressor(DEFAULT_COMPRESSOR),
    color: normalizeColor(DEFAULT_COLOR),
    width: normalizeWidth(DEFAULT_WIDTH),
    output: normalizeOutput(DEFAULT_OUTPUT),
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
      clipping: false
    },
    updatedAt: Date.now()
  };
}

export function applyPresetToState(state, preset) {
  const nextPreset = clonePreset(preset);
  return {
    ...state,
    selectedPresetId: preset.id,
    eqEnabled: nextPreset.eqEnabled !== false,
    eq: normalizeEqBands(nextPreset.eq),
    compressor: normalizeCompressor(nextPreset.compressor),
    color: normalizeColor(nextPreset.color),
    width: normalizeWidth(nextPreset.width),
    output: normalizeOutput({
      ...nextPreset.output,
      outputDeviceId: state.output?.outputDeviceId || DEFAULT_OUTPUT.outputDeviceId,
      outputDeviceLabel: state.output?.outputDeviceLabel || DEFAULT_OUTPUT.outputDeviceLabel,
      outputRouteStatus: state.output?.outputRouteStatus || DEFAULT_OUTPUT.outputRouteStatus
    }),
    updatedAt: Date.now()
  };
}

export function toWebAudioType(type) {
  return WEB_AUDIO_TYPE[type] || 'peaking';
}

export function isCutType(type) {
  return type === 'lowcut' || type === 'highcut';
}

export function dbToGain(db) {
  return Math.pow(10, Number(db || 0) / 20);
}

export function gainToDb(gain) {
  return gain <= 0 ? -120 : 20 * Math.log10(gain);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}


function sanitizeOutputDeviceId(deviceId) {
  const text = String(deviceId || 'default').trim();
  return text && text !== 'undefined' && text !== 'null' ? text : 'default';
}
