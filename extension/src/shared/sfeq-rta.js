// Lightweight SonKuPik/SFEQ-inspired RTA transform for AR Audio Enhancer.
// Ported as a small no-build module: power-domain FFT integration,
// log-frequency points, reference-grid normalization, and trueBalance-style
// display transfer profile. Keep this side-effect free; the UI performs
// temporal easing so the audio thread/offscreen host stays light.

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DEFAULT_POINT_COUNT = 144;
const DEFAULT_OCTAVE_WIDTH = 1 / 9;
const MIN_POWER = 1e-12;

// Same calibration intent as SonKuPik/SFEQ trueBalanceModel.ts v79.
// Single display-domain transfer profile, fitted from a pink-noise reference.
const TRUEBALANCE_PINK_NOISE_TRANSFER_PROFILE = [
  { freq: 20, gainDb: 24.2 },
  { freq: 31.5, gainDb: 24.8 },
  { freq: 50, gainDb: 23.7 },
  { freq: 63, gainDb: 22.6 },
  { freq: 80, gainDb: 21.7 },
  { freq: 100, gainDb: 21.1 },
  { freq: 150, gainDb: 19.0 },
  { freq: 200, gainDb: 18.0 },
  { freq: 315, gainDb: 16.5 },
  { freq: 462, gainDb: 15.0 },
  { freq: 630, gainDb: 15.9 },
  { freq: 1000, gainDb: 17.1 },
  { freq: 2000, gainDb: 20.5 },
  { freq: 3150, gainDb: 22.4 },
  { freq: 4000, gainDb: 23.6 },
  { freq: 5000, gainDb: 24.5 },
  { freq: 6300, gainDb: 25.3 },
  { freq: 8000, gainDb: 26.0 },
  { freq: 10000, gainDb: 26.8 },
  { freq: 13300, gainDb: 28.0 },
  { freq: 16000, gainDb: 31.3 },
  { freq: 20000, gainDb: 34.4 }
];

// SFEQ uses a fixed reference FFT grid so mobile/smaller FFTs do not read
// several dB lower just because fewer bins fall inside a log-frequency band.
const TONAL_REFERENCE_FFT_SIZE = 16384;
const TONAL_INTEGRATED_REFERENCE_DIVISOR = 8;
const referenceWeightCache = new Map();
const logPointCache = new Map();
const windowCache = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteDb(value) {
  if (!Number.isFinite(value)) return -120;
  return clamp(value, -120, 12);
}

export function dbToPower(db) {
  return Math.max(MIN_POWER, Math.pow(10, finiteDb(db) / 10));
}

export function powerToDb(power) {
  return 10 * Math.log10(Math.max(MIN_POWER, power));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interpolateLogFrequency(freq, anchors) {
  if (!Number.isFinite(freq) || freq <= 0) return anchors[0]?.gainDb ?? 0;
  if (freq <= anchors[0].freq) return anchors[0].gainDb;
  const last = anchors[anchors.length - 1];
  if (freq >= last.freq) return last.gainDb;
  const logFreq = Math.log(freq);
  for (let i = 1; i < anchors.length; i += 1) {
    const prev = anchors[i - 1];
    const next = anchors[i];
    if (freq <= next.freq) {
      const span = Math.log(next.freq) - Math.log(prev.freq);
      const t = span > 0 ? clamp((logFreq - Math.log(prev.freq)) / span, 0, 1) : 0;
      return lerp(prev.gainDb, next.gainDb, t);
    }
  }
  return last.gainDb;
}

export function trueBalanceDisplayCompensationDb(freq) {
  return interpolateLogFrequency(freq, TRUEBALANCE_PINK_NOISE_TRANSFER_PROFILE);
}

export function logFrequencyPoints(count = DEFAULT_POINT_COUNT) {
  const safeCount = Math.max(16, Math.min(320, Math.round(count)));
  const cacheKey = String(safeCount);
  const cached = logPointCache.get(cacheKey);
  if (cached) return cached;
  const points = Array.from({ length: safeCount }, (_, index) => (
    MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, index / (safeCount - 1))
  ));
  logPointCache.set(cacheKey, points);
  return points;
}

function raisedCosineBandWeight(distanceOct, edgeOct) {
  const normalized = Math.min(1, Math.abs(distanceOct) / Math.max(edgeOct, 0.001));
  return Math.max(0.08, 0.5 + 0.5 * Math.cos(Math.PI * normalized));
}

function referenceWeightKey(centerFreq, octaveWidth, sampleRate) {
  return `${Math.round(centerFreq * 10) / 10}|${Math.round(octaveWidth * 10000)}|${Math.round(sampleRate)}`;
}

function estimateReferenceWeightSum(centerFreq, octaveWidth, sampleRate) {
  const key = referenceWeightKey(centerFreq, octaveWidth, sampleRate);
  const cached = referenceWeightCache.get(key);
  if (cached !== undefined) return cached;

  const halfWidthRatio = Math.pow(2, octaveWidth / 2);
  const low = Math.max(1, centerFreq / halfWidthRatio);
  const high = centerFreq * halfWidthRatio;
  const referenceBinHz = sampleRate / TONAL_REFERENCE_FFT_SIZE;
  const startBin = Math.max(1, Math.floor(low / referenceBinHz));
  const endBin = Math.max(startBin, Math.ceil(high / referenceBinHz));
  const edge = octaveWidth / 2;
  let weightSum = 0;

  for (let bin = startBin; bin <= endBin; bin += 1) {
    const binFreq = bin * referenceBinHz;
    const distanceOct = Math.abs(Math.log2(Math.max(1, binFreq) / centerFreq));
    weightSum += raisedCosineBandWeight(distanceOct, edge);
  }

  const safeWeightSum = Math.max(0.001, weightSum);
  referenceWeightCache.set(key, safeWeightSum);
  return safeWeightSum;
}

function buildAnalysisWindows(sampleRate, fftSize, pointCount, octaveWidth, maxBin) {
  const cacheKey = `${Math.round(sampleRate)}|${fftSize}|${pointCount}|${Math.round(octaveWidth * 10000)}|${maxBin}`;
  const cached = windowCache.get(cacheKey);
  if (cached) return cached;

  const binHz = sampleRate / fftSize;
  const edge = octaveWidth / 2;
  const windows = logFrequencyPoints(pointCount).map((centerFreq) => {
    const halfWidthRatio = Math.pow(2, octaveWidth / 2);
    const low = Math.max(1, centerFreq / halfWidthRatio);
    const high = centerFreq * halfWidthRatio;
    const startBin = Math.max(1, Math.floor(low / binHz));
    const endBin = Math.min(maxBin, Math.ceil(high / binHz));
    const bins = [];
    let weightSum = 0;

    for (let bin = startBin; bin <= endBin; bin += 1) {
      const binFreq = bin * binHz;
      const distanceOct = Math.abs(Math.log2(Math.max(1, binFreq) / centerFreq));
      const weight = raisedCosineBandWeight(distanceOct, edge);
      bins.push({ bin, weight });
      weightSum += weight;
    }

    return {
      freq: centerFreq,
      bins,
      weightSum,
      referenceWeightSum: estimateReferenceWeightSum(centerFreq, octaveWidth, sampleRate),
      compensationDb: trueBalanceDisplayCompensationDb(centerFreq)
    };
  });

  windowCache.set(cacheKey, windows);
  return windows;
}

export function buildSfeqRtaSpectrumFromFft(
  frequencyData,
  sampleRate,
  fftSize,
  options = {}
) {
  const pointCount = options.pointCount ?? DEFAULT_POINT_COUNT;
  const octaveWidth = options.octaveWidth ?? DEFAULT_OCTAVE_WIDTH;
  if (!frequencyData || !frequencyData.length || !sampleRate || !fftSize) return [];

  const windows = buildAnalysisWindows(
    sampleRate,
    fftSize,
    pointCount,
    octaveWidth,
    Math.max(1, frequencyData.length - 1)
  );

  return windows.map((window) => {
    let weightedPower = 0;
    let weightSum = 0;
    for (let i = 0; i < window.bins.length; i += 1) {
      const { bin, weight } = window.bins[i];
      weightedPower += dbToPower(frequencyData[bin]) * weight;
      weightSum += weight;
    }

    if (!weightSum) return { freq: window.freq, db: -120 + window.compensationDb };
    const averagePowerDensity = weightedPower / weightSum;
    const integratedDb = powerToDb((averagePowerDensity * window.referenceWeightSum) / TONAL_INTEGRATED_REFERENCE_DIVISOR);
    return { freq: window.freq, db: integratedDb + window.compensationDb };
  });
}

export function estimateRtaVisualAnchor(points, lowFreq = 120, highFreq = 5000) {
  if (!points?.length) return -48;
  let sum = 0;
  let count = 0;
  for (const point of points) {
    if (point.freq >= lowFreq && point.freq <= highFreq && Number.isFinite(point.db)) {
      sum += point.db;
      count += 1;
    }
  }
  return count ? sum / count : -48;
}
