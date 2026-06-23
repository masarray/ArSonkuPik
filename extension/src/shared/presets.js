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
  { id: 'cut-low', label: 'Sub Clean', type: 'lowcut', frequency: 26, gain: 0, q: 0.707, slope: 24, enabled: true },
  { id: 'low-body', label: 'Deep Body', type: 'lowshelf', frequency: 78, gain: 1.55, q: 0.68, slope: 12, enabled: true },
  { id: 'mud-clean', label: 'Mud Clean', type: 'bell', frequency: 285, gain: -1.25, q: 1.12, slope: 12, enabled: true },
  { id: 'presence', label: 'Presence', type: 'bell', frequency: 2450, gain: 0.9, q: 0.92, slope: 12, enabled: true },
  { id: 'detail', label: 'Detail', type: 'bell', frequency: 5200, gain: 1.2, q: 1.12, slope: 12, enabled: true },
  { id: 'sparkle', label: 'Sparkle', type: 'highshelf', frequency: 11800, gain: 1.65, q: 0.66, slope: 12, enabled: true }
];

export const DEFAULT_COMPRESSOR = {
  threshold: -24.5,
  ratio: 1.8,
  knee: 20,
  attack: 0.026,
  release: 0.18,
  makeupGain: 0.9,
  parallelMix: 94,
  enabled: true
};

export const DEFAULT_COLOR = {
  enabled: true,
  drive: 4.8,
  body: 17,
  harmonics: 48,
  warmth: 11,
  air: 20,
  mix: 40,
  stereoMid: 38,
  mode: 'modern'
};

export const DEFAULT_WIDTH = {
  enabled: true,
  width: 124,
  lowWidth: 100,
  lowMidWidth: 104,
  midWidth: 112,
  highWidth: 144,
  sourceProtect: 88,
  monoBass: true,
  monoBassFreq: 150,
  sideTone: 2.2
};

export const DEFAULT_OUTPUT = {
  inputGain: 0,
  outputGain: -1.6,
  limiterEnabled: true,
  limiterCeiling: -1,
  limiterDrive: 0.55,
  punchProtect: true,
  bypass: false,
  outputDeviceId: 'default',
  outputDeviceLabel: 'System Default',
  outputRouteStatus: 'default'
};

export const DEFAULT_MASTER_REVISION = 'source-aware-width-v11';

export const PRIMARY_MASTER_PRESET_IDS = [
  'default',
  'max-enhancer',
  'audiophile-pop',
  'pro-music',
  'open-air-field',
  'movie-dolby',
  'podcast',
  'night-listening'
];

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
    name: 'MasAri',
    description: 'Balanced signature mastering: punchy, clear, sparkling, and not tiring.',
    eq: DEFAULT_EQ_BANDS,
    compressor: DEFAULT_COMPRESSOR,
    color: DEFAULT_COLOR,
    width: DEFAULT_WIDTH,
    output: DEFAULT_OUTPUT
  }),
  p({
    id: 'max-enhancer',
    name: 'Max Enhancer',
    description: 'Maximum musical enhancement: solid powerful low, crisp clear vocals, sparkling air, and lively stereo — exciting and dopamine-rich but never fatiguing, fully mono-safe.',
    eq: [
      // Tight sub clean to protect headroom for the louder, denser master.
      { ...DEFAULT_EQ_BANDS[0], frequency: 28, slope: 24 },
      // Solid, powerful low body (punch + warmth) without boom.
      { ...DEFAULT_EQ_BANDS[1], frequency: 92, gain: 2.2, q: 0.7 },
      // Scoop low-mid mud so vocals and mix read clearly.
      { ...DEFAULT_EQ_BANDS[2], frequency: 300, gain: -2.0, q: 1.1 },
      // ~3 kHz presence/excitement — vocal clarity and "buzz" that pulls focus.
      { ...DEFAULT_EQ_BANDS[3], frequency: 3000, gain: 1.6, q: 0.9 },
      // ~7 kHz definition for crisp ("renyah") detail, above the harsh 4-5 kHz core.
      { ...DEFAULT_EQ_BANDS[4], frequency: 7000, gain: 1.35, q: 1.05 },
      // High shelf air/sparkle for an open, shiny, expensive top end.
      { ...DEFAULT_EQ_BANDS[5], frequency: 12200, gain: 2.4, q: 0.6 }
    ],
    // Gentle glue with strong parallel blend: dense and powerful, transients intact.
    // Slightly slower attack + a touch more parallel lets mid-range transients
    // "tickle" through instead of being flattened.
    compressor: { threshold: -25, ratio: 2.0, knee: 22, attack: 0.028, release: 0.16, makeupGain: 1.2, parallelMix: 90 },
    // Modern harmonic excitation: richness + air = the "sweet/dopamine" factor, kept parallel so it stays clean.
    // stereoMid drives the real-side mid exciter so the genuine L-R "bersahutan" mid detail stays alive and energetic.
    color: { enabled: true, drive: 5.6, body: 20, warmth: 14, harmonics: 56, air: 28, mix: 44, stereoMid: 76, mode: 'modern' },
    // Lively multiband image. monoBass keeps the low end solid & mono (no LF phase smear);
    // the synthetic side is added antisymmetrically so it cancels in the mono sum -> zero phase issue.
    width: { enabled: true, width: 134, lowWidth: 100, lowMidWidth: 108, midWidth: 120, highWidth: 160, sourceProtect: 90, monoBass: true, monoBassFreq: 150, sideTone: 3.0 },
    // Loud and punchy with punch-protect on the limiter so it never pumps or fatigues.
    output: { outputGain: -1.4, limiterDrive: 0.8, limiterCeiling: -1, punchProtect: true }
  }),
  p({
    id: 'audiophile-pop',
    name: 'Audiophile',
    description: 'Popular audiophile balance: clean vocal center, refined sparkle, controlled bass, non-fatiguing.',
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 30, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 86, gain: 1.15, q: 0.7 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 275, gain: -1.45, q: 1.05 },
      { id: 'vocal-focus-audiophile', label: 'Vocal Focus', type: 'bell', frequency: 1850, gain: 0.65, q: 0.8, slope: 12, enabled: true },
      { ...DEFAULT_EQ_BANDS[4], frequency: 5000, gain: 1.1, q: 1.1 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12400, gain: 1.9, q: 0.62 }
    ],
    compressor: { threshold: -24, ratio: 1.65, knee: 22, attack: 0.032, release: 0.22, makeupGain: 0.55, parallelMix: 90 },
    color: { enabled: true, drive: 3.7, body: 11, warmth: 8, harmonics: 36, air: 17, mix: 32, mode: 'modern' },
    width: { enabled: true, width: 124, lowWidth: 100, lowMidWidth: 104, midWidth: 112, highWidth: 144, monoBass: true, monoBassFreq: 150, sideTone: 2.2 },
    output: { outputGain: -2.0, limiterDrive: 0.35, limiterCeiling: -1 }
  }),
  p({
    id: 'pro-music',
    name: 'Punchy Music',
    description: 'Punchy bass, thick groove, stronger transient glue, and sparkling musical detail.',
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 28, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 82, gain: 2.35 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 235, gain: -1.35, q: 1.05 },
      { id: 'mid-thick', label: 'Mid Thick', type: 'bell', frequency: 620, gain: 0.75, q: 0.85, slope: 12, enabled: true },
      { ...DEFAULT_EQ_BANDS[3], frequency: 2200, gain: 0.95, q: 1.0 },
      { ...DEFAULT_EQ_BANDS[4], frequency: 5200, gain: 1.35, q: 1.2 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 11800, gain: 2.0 }
    ],
    compressor: { threshold: -23.5, ratio: 2.05, knee: 16, attack: 0.024, release: 0.17, makeupGain: 0.75, parallelMix: 91 },
    color: { enabled: true, drive: 5.3, body: 20, warmth: 11, harmonics: 52, air: 21, mix: 43, mode: 'modern' },
    width: { enabled: true, width: 136, lowWidth: 100, lowMidWidth: 106, midWidth: 118, highWidth: 156, monoBass: true, monoBassFreq: 150, sideTone: 2.6 },
    output: { outputGain: -2.4, limiterDrive: 0.72, limiterCeiling: -1 }
  }),
  p({
    id: 'open-air-field',
    name: 'Open Air',
    description: 'Sound lapangan/open-air preset: bigger bass contour, forward vocal guard, strong side-air sparkle, limiter-safe.',
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 32, slope: 24 },
      { id: 'field-low-contour', label: 'Field Low Contour', type: 'lowshelf', frequency: 92, gain: 3.0, q: 0.72, slope: 12, enabled: true },
      { id: 'field-lowmid-clean', label: 'Low-Mid Clean', type: 'bell', frequency: 265, gain: -2.2, q: 1.05, slope: 12, enabled: true },
      { id: 'field-vocal-guard', label: 'Vocal Guard', type: 'bell', frequency: 2100, gain: 1.25, q: 0.82, slope: 12, enabled: true },
      { id: 'field-bite', label: 'Field Bite', type: 'bell', frequency: 4300, gain: 0.55, q: 1.05, slope: 12, enabled: true },
      { id: 'field-air', label: 'Open Air', type: 'highshelf', frequency: 11800, gain: 0.85, q: 0.64, slope: 12, enabled: true }
    ],
    compressor: { threshold: -25, ratio: 2.25, knee: 18, attack: 0.026, release: 0.20, makeupGain: 0.55, parallelMix: 88 },
    color: { enabled: true, drive: 5.4, body: 22, warmth: 12, harmonics: 50, air: 18, mix: 44, mode: 'modern' },
    width: { enabled: true, width: 130, lowWidth: 100, lowMidWidth: 102, midWidth: 112, highWidth: 148, monoBass: true, monoBassFreq: 190, sideTone: 2.2 },
    output: { outputGain: -3.2, limiterDrive: 0.72, limiterCeiling: -1.2 }
  }),
  p({
    id: 'movie-dolby',
    name: 'Movie Sub',
    description: 'Thick sub, clean low-mid, guarded dialogue clarity, smooth cinematic width.',
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 24, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 58, gain: 3.0, q: 0.72 },
      { id: 'sub-body', label: 'Sub Body', type: 'bell', frequency: 115, gain: 1.1, q: 0.9, slope: 12, enabled: true },
      { id: 'box-clean', label: 'De-box', type: 'bell', frequency: 360, gain: -2.2, q: 1.1, slope: 12, enabled: true },
      { id: 'de-honk', label: 'De-honk', type: 'bell', frequency: 650, gain: -1.15, q: 1.0, slope: 12, enabled: true },
      { id: 'dialogue', label: 'Dialogue', type: 'bell', frequency: 2900, gain: 1.55, q: 0.9, slope: 12, enabled: true },
      { ...DEFAULT_EQ_BANDS[4], frequency: 5600, gain: 0.75, q: 1.1 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12000, gain: 1.55 }
    ],
    compressor: { threshold: -24, ratio: 1.7, knee: 18, attack: 0.034, release: 0.28, makeupGain: 0.35, parallelMix: 90 },
    color: { enabled: true, drive: 4.0, body: 13, warmth: 11, harmonics: 38, air: 17, mix: 36, mode: 'warm' },
    width: { enabled: true, width: 132, lowWidth: 100, lowMidWidth: 104, midWidth: 116, highWidth: 146, monoBass: true, monoBassFreq: 165, sideTone: 2.0 },
    output: { outputGain: -2.2, limiterDrive: 0.28, limiterCeiling: -1.1 }
  }),
  p({
    id: 'podcast',
    name: 'Podcast',
    description: 'Voice-safe polish: controlled lows, smooth compression, soft air, no crackle.',
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 86, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 118, gain: 0.1 },
      { id: 'vocal-chest', label: 'Vocal Chest', type: 'bell', frequency: 165, gain: 0.45, q: 0.78, slope: 12, enabled: true },
      { ...DEFAULT_EQ_BANDS[2], frequency: 310, gain: -2.6, q: 1.12 },
      { ...DEFAULT_EQ_BANDS[3], frequency: 1950, gain: 1.1, q: 0.9 },
      { ...DEFAULT_EQ_BANDS[4], frequency: 4000, gain: 0.8, q: 1.0 },
      { id: 'sibilance-soften', label: 'Sibilance Smooth', type: 'bell', frequency: 6900, gain: -1.8, q: 1.8, slope: 12, enabled: true },
      { ...DEFAULT_EQ_BANDS[5], frequency: 11200, gain: 0.4 }
    ],
    compressor: { threshold: -26.5, ratio: 2.0, knee: 24, attack: 0.018, release: 0.26, makeupGain: 0.45, parallelMix: 80 },
    color: { enabled: true, drive: 1.4, body: 5, warmth: 7, harmonics: 10, air: 4, mix: 11, mode: 'clean' },
    width: { enabled: false, width: 100, lowWidth: 100, lowMidWidth: 100, midWidth: 100, highWidth: 105, monoBass: true, monoBassFreq: 145, sideTone: 0 },
    output: { outputGain: -2.8, limiterDrive: 0.08, limiterCeiling: -1.3 }
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
    color: { enabled: true, drive: 1.3, body: -3, warmth: 7, harmonics: 7, air: -8, mix: 10, mode: 'warm' },
    width: { enabled: false, width: 98, lowWidth: 100, lowMidWidth: 96, midWidth: 94, highWidth: 100, monoBass: true, monoBassFreq: 120, sideTone: -1 },
    output: { outputGain: -5, limiterDrive: 0.08, limiterCeiling: -1.5 }
  })
];

export const MODULE_PRESETS = {
  eq: [
    {
      id: 'default-polish',
      name: 'MasAri Sparkle Balance',
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
      id: 'open-air-field-eq',
      name: 'Open Air Field',
      eqEnabled: true,
      eq: [
        { ...DEFAULT_EQ_BANDS[0], frequency: 32, slope: 24 },
        { id: 'field-low-contour-eq', label: 'Field Low Contour', type: 'lowshelf', frequency: 92, gain: 3.0, q: 0.72, slope: 12, enabled: true },
        { id: 'field-lowmid-clean-eq', label: 'Low-Mid Clean', type: 'bell', frequency: 265, gain: -2.2, q: 1.05, slope: 12, enabled: true },
        { id: 'field-vocal-guard-eq', label: 'Vocal Guard', type: 'bell', frequency: 2100, gain: 1.25, q: 0.82, slope: 12, enabled: true },
        { id: 'field-bite-eq', label: 'Field Bite', type: 'bell', frequency: 4700, gain: 1.55, q: 1.05, slope: 12, enabled: true },
        { id: 'field-air-eq', label: 'Open Air', type: 'highshelf', frequency: 11800, gain: 0.85, q: 0.64, slope: 12, enabled: true }
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
    { id: 'dialog-leveler', name: 'Dialog Leveler', compressor: { threshold: -26.5, ratio: 2.15, knee: 22, attack: 0.012, release: 0.22, makeupGain: 0.7, parallelMix: 86, enabled: true } },
    { id: 'vocal-smooth', name: 'Vocal Smooth', compressor: { threshold: -27, ratio: 2.25, knee: 22, attack: 0.014, release: 0.24, makeupGain: 0.8, parallelMix: 84, enabled: true } },
    { id: 'night-level', name: 'Night Level', compressor: { threshold: -34, ratio: 3.2, knee: 20, attack: 0.018, release: 0.34, makeupGain: 1.4, parallelMix: 78, enabled: true } }
  ],
  color: [
    { id: 'signature-glow', name: 'MasAri Glow', color: DEFAULT_COLOR },
    { id: 'clean-glow', name: 'Clean Glow', color: { enabled: true, drive: 2.2, body: 7, warmth: 5, harmonics: 22, air: 12, mix: 26, mode: 'clean' } },
    { id: 'modern-exciter', name: 'Analog Lift', color: { enabled: true, drive: 4.8, body: 15, warmth: 9, harmonics: 46, air: 19, mix: 39, mode: 'modern' } },
    { id: 'side-sparkle', name: 'Silky Sparkle', color: { enabled: true, drive: 3.6, body: 8, warmth: 5, harmonics: 36, air: 22, mix: 32, mode: 'modern' } },
    { id: 'field-sonic', name: 'Open Air Thick', color: { enabled: true, drive: 5.4, body: 22, warmth: 12, harmonics: 50, air: 18, mix: 44, mode: 'modern' } },
    { id: 'voice-polish', name: 'Voice Thick', color: { enabled: true, drive: 1.4, body: 5, warmth: 7, harmonics: 10, air: 4, mix: 11, mode: 'clean' } },
    { id: 'thick-sweet', name: 'Thick Warm', color: { enabled: true, drive: 4.0, body: 14, warmth: 13, harmonics: 34, air: 13, mix: 36, mode: 'warm' } },
    { id: 'night-warm', name: 'Night Warm', color: { enabled: true, drive: 1.3, body: -3, warmth: 7, harmonics: 7, air: -8, mix: 10, mode: 'warm' } }
  ],
  width: [
    { id: 'natural-stereo', name: 'Natural Stereo', width: DEFAULT_WIDTH },
    { id: 'wide-music', name: 'Wide Music', width: { enabled: true, width: 136, lowWidth: 100, lowMidWidth: 106, midWidth: 118, highWidth: 154, monoBass: true, monoBassFreq: 150, sideTone: 2.6 } },
    { id: 'ultra-wide-air', name: 'Ultra Wide Air', width: { enabled: true, width: 158, lowWidth: 100, lowMidWidth: 110, midWidth: 130, highWidth: 186, monoBass: true, monoBassFreq: 175, sideTone: 3.4 } },
    { id: 'open-air-wide', name: 'Open Air Wide', width: { enabled: true, width: 130, lowWidth: 100, lowMidWidth: 102, midWidth: 112, highWidth: 148, monoBass: true, monoBassFreq: 190, sideTone: 2.2 } },
    { id: 'cinema-wide', name: 'Cinema Safe', width: { enabled: true, width: 132, lowWidth: 100, lowMidWidth: 104, midWidth: 116, highWidth: 146, monoBass: true, monoBassFreq: 165, sideTone: 2.0 } },
    { id: 'vocal-center', name: 'Vocal Center', width: { enabled: false, width: 100, lowWidth: 100, lowMidWidth: 100, midWidth: 100, highWidth: 105, monoBass: true, monoBassFreq: 145, sideTone: 0 } },
    { id: 'night-narrow', name: 'Night Narrow', width: { enabled: false, width: 98, lowWidth: 100, lowMidWidth: 96, midWidth: 94, highWidth: 100, monoBass: true, monoBassFreq: 140, sideTone: -1 } }
  ],
  limiter: [
    { id: 'safe-master', name: 'Safe Master', output: { inputGain: 0, outputGain: -1.5, limiterEnabled: true, limiterCeiling: -1, limiterDrive: 0.4, punchProtect: true } },
    { id: 'loud-punch', name: 'Loud Punch', output: { inputGain: 0, outputGain: -1.8, limiterEnabled: true, limiterCeiling: -1, limiterDrive: 0.8, punchProtect: true } },
    { id: 'open-air-guard', name: 'Open Air Guard', output: { inputGain: 0, outputGain: -3.2, limiterEnabled: true, limiterCeiling: -1.2, limiterDrive: 0.72, punchProtect: true } },
    { id: 'cinema-headroom', name: 'Cinema Clean', output: { inputGain: 0, outputGain: -2.2, limiterEnabled: true, limiterCeiling: -1.1, limiterDrive: 0.28, punchProtect: true } },
    { id: 'voice-steady', name: 'Voice Steady', output: { inputGain: 0.4, outputGain: -2.2, limiterEnabled: true, limiterCeiling: -1.2, limiterDrive: 0.12, punchProtect: true } },
    { id: 'night-low', name: 'Night Low', output: { inputGain: -1, outputGain: -5, limiterEnabled: true, limiterCeiling: -1.5, limiterDrive: 0.08, punchProtect: true } }
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
    air: clampNumber(color.air ?? DEFAULT_COLOR.air, -24, 48),
    mix: clampNumber(color.mix ?? DEFAULT_COLOR.mix, 0, 100),
    stereoMid: clampNumber(color.stereoMid ?? DEFAULT_COLOR.stereoMid, 0, 100),
    mode: ['clean', 'warm', 'modern'].includes(color.mode) ? color.mode : DEFAULT_COLOR.mode
  };
}

export function normalizeWidth(width = {}) {
  const master = clampNumber(width.width ?? DEFAULT_WIDTH.width, 0, 200);
  const expand = Math.max(0, master - 100);
  const narrow = Math.max(0, 100 - master);
  const derivedLow = width.monoBass === false ? 100 + expand * 0.08 - narrow * 0.55 : 100;
  const derivedLowMid = 100 + expand * 0.16 - narrow * 0.60;
  const derivedMid = 100 + expand * 0.44 - narrow * 0.85;
  const derivedHigh = 100 + expand * 1.45 - narrow * 0.90;
  return {
    ...DEFAULT_WIDTH,
    ...width,
    enabled: width.enabled === true,
    width: master,
    lowWidth: clampNumber(width.lowWidth ?? derivedLow, 0, 200),
    lowMidWidth: clampNumber(width.lowMidWidth ?? derivedLowMid, 0, 200),
    midWidth: clampNumber(width.midWidth ?? derivedMid, 0, 200),
    highWidth: clampNumber(width.highWidth ?? derivedHigh, 0, 200),
    sourceProtect: clampNumber(width.sourceProtect ?? DEFAULT_WIDTH.sourceProtect, 0, 100),
    monoBass: width.monoBass !== false,
    monoBassFreq: clampNumber(width.monoBassFreq ?? DEFAULT_WIDTH.monoBassFreq, 60, 250),
    sideTone: clampNumber(width.sideTone ?? DEFAULT_WIDTH.sideTone, -12, 18)
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
  const startupPreset = FACTORY_PRESETS.find((preset) => preset.id === 'default') || FACTORY_PRESETS[0];
  return {
    active: false,
    tabId: null,
    sourceTitle: 'No active capture',
    selectedPresetId: startupPreset.id,
    defaultMasterRevision: DEFAULT_MASTER_REVISION,
    eqEnabled: startupPreset.eqEnabled !== false,
    eq: normalizeEqBands(startupPreset.eq),
    compressor: normalizeCompressor(startupPreset.compressor),
    color: normalizeColor(startupPreset.color),
    width: normalizeWidth(startupPreset.width),
    output: normalizeOutput(startupPreset.output),
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
    defaultMasterRevision: preset.id === 'default' ? DEFAULT_MASTER_REVISION : state.defaultMasterRevision,
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
