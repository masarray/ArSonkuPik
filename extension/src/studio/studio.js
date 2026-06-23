import {
  FACTORY_PRESETS,
  MODULE_PRESETS,
  normalizeEqBands,
  normalizeCompressor,
  normalizeColor,
  normalizeWidth,
  normalizeOutput,
  isCutType,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  DEFAULT_OUTPUT,
  PRIMARY_MASTER_PRESET_IDS
} from '../shared/presets.js';
import { detectAudioOutputDevices, normalizeOutputDeviceId, openBrowserAudioOutputChooser, requestAudioOutputDeviceListAccess, watchAudioOutputDeviceChanges } from '../shared/audio-devices.js';
import {
  getEngineState,
  startEnhance,
  stopEnhance,
  applyPreset,
  updateEngineState,
  saveCustomPreset,
  sendMessage
} from '../shared/messaging.js';

const FS = 48000;
const F_MIN = 20;
const F_MAX = 20000;
const Q_MIN = 0.1;
const Q_MAX = 24;
const SLOPES = [12, 24, 36, 48];
const BUTTER = {
  12: [0.70710678],
  24: [0.54119610, 1.30656296],
  36: [0.51763809, 0.70710678, 1.93185165],
  48: [0.50979558, 0.60134489, 0.89997622, 2.56291545]
};
const BAND_COLORS = ['#62E6D8','#6EA8FF','#B69CFF','#7DDB8A','#F5B95B','#FF92C2','#FF6B6B','#5BD0F5'];
const TYPES = [
  {id:'lowcut', label:'Low cut'},
  {id:'lowshelf', label:'Low shelf'},
  {id:'bell', label:'Bell'},
  {id:'notch', label:'Notch'},
  {id:'highshelf', label:'High shelf'},
  {id:'highcut', label:'High cut'}
];

let dbRange = 18;
let state = null;
let presets = [...FACTORY_PRESETS];
let bands = [];
let selectedId = null;
let nextId = 1;
let colorIdx = 0;
let bypassAll = false;
let busy = false;
let undoStack = [];
let redoStack = [];
let lastCommitted = null;
let abSlots = { A: null, B: null };
let activeABSlot = 'A';
let pollingTimer = null;
let rtaFrame = null;
let lastMeterPayload = null;
let displayedCompressorReduction = 0;
let displayedCompressorReductionLeft = 0;
let displayedCompressorReductionRight = 0;
let displayedLimiterReduction = 0;
let displayedCorrelation = 1;
let displayedInputLeft = 0;
let displayedInputRight = 0;
let displayedOutputLeft = 0;
let displayedOutputRight = 0;
let displayedStereoBands = {
  low: { width: 0, correlation: 1 },
  mid: { width: 0, correlation: 1 },
  high: { width: 0, correlation: 1 }
};
let colorVizPhase = 0;
let _colorLoop = null;
let _lastColorFrame = 0;
let spectrumMode = 'post';
let masterPresetDirty = false;
const sourceTabIdFromUrl = getSourceTabIdFromUrl();
const modulePresetSelections = {
  eq: '',
  compressor: '',
  color: '',
  width: '',
  limiter: ''
};

const CHOOSE_OUTPUT_DEVICE_ID = '__choose_output__';
const UNLOCK_OUTPUT_DEVICE_ID = '__unlock_output_devices__';
const MASARI_PRESET_LABEL = 'MasAri';
const CUSTOM_PRESET_LABEL = 'Custom';
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('svg');
const readout = document.getElementById('readout');
const ctxMenu = document.getElementById('ctx');
const displayWrap = svg.parentElement;
const inspector = document.getElementById('inspector');
const ui = {
  sourceChip: document.getElementById('sourceChip'),
  sourceTitle: document.getElementById('sourceTitle'),
  topbarOutputDevice: document.getElementById('topbarOutputDevice'),
  startStopButton: document.getElementById('startStopButton'),
  btnAB: document.getElementById('btnAB'),
  btnUndo: document.getElementById('btnUndo'),
  btnRedo: document.getElementById('btnRedo'),
  btnBypass: document.getElementById('btnBypass'),
  btnReset: document.getElementById('btnReset'),
  btnSave: document.getElementById('btnSave'),
  spectrumModeButtons: Array.from(document.querySelectorAll('[data-spectrum-mode]')),
  masterPresetSelect: document.getElementById('masterPresetSelect'),
  eqPresetSelect: document.getElementById('eqPresetSelect'),
  smartGainChip: document.getElementById('smartGainChip'),
  compressorPresetSelect: document.getElementById('compressorPresetSelect'),
  colorPresetSelect: document.getElementById('colorPresetSelect'),
  widthPresetSelect: document.getElementById('widthPresetSelect'),
  limiterPresetSelect: document.getElementById('limiterPresetSelect'),
  bypassEq: document.getElementById('bypassEq'),
  bypassCompressor: document.getElementById('bypassCompressor'),
  bypassColor: document.getElementById('bypassColor'),
  bypassWidth: document.getElementById('bypassWidth'),
  bypassLimiter: document.getElementById('bypassLimiter'),
  presets: document.getElementById('presets'),
  compressorCanvas: document.getElementById('compressorCanvas'),
  compressorControls: document.getElementById('compressorControls'),
  outputControls: document.getElementById('outputControls'),
  colorControls: document.getElementById('colorControls'),
  widthControls: document.getElementById('widthControls'),
  colorModeBadge: document.getElementById('colorModeBadge'),
  limiterReductionBar: document.getElementById('limiterReductionBar'),
  limiterReductionValue: document.getElementById('limiterReductionValue'),
  correlationValue: document.getElementById('correlationValue'),
  correlationBar: document.getElementById('correlationBar'),
  widthBandLowFill: document.getElementById('widthBandLowFill'),
  widthBandMidFill: document.getElementById('widthBandMidFill'),
  widthBandHighFill: document.getElementById('widthBandHighFill'),
  widthBandLowValue: document.getElementById('widthBandLowValue'),
  widthBandMidValue: document.getElementById('widthBandMidValue'),
  widthBandHighValue: document.getElementById('widthBandHighValue'),
  widthBandLowCorrelation: document.getElementById('widthBandLowCorrelation'),
  widthBandMidCorrelation: document.getElementById('widthBandMidCorrelation'),
  widthBandHighCorrelation: document.getElementById('widthBandHighCorrelation'),
  widthBandLowCorrelationBar: document.getElementById('widthBandLowCorrelationBar'),
  widthBandMidCorrelationBar: document.getElementById('widthBandMidCorrelationBar'),
  widthBandHighCorrelationBar: document.getElementById('widthBandHighCorrelationBar'),
  inputMeter: document.getElementById('inputMeter'),
  outputMeter: document.getElementById('outputMeter'),
  limiterInputMeterLeft: document.getElementById('limiterInputMeterLeft'),
  limiterInputMeterRight: document.getElementById('limiterInputMeterRight'),
  limiterOutputMeterLeft: document.getElementById('limiterOutputMeterLeft'),
  limiterOutputMeterRight: document.getElementById('limiterOutputMeterRight'),
  inputMeterLeft: document.getElementById('inputMeterLeft'),
  inputMeterRight: document.getElementById('inputMeterRight'),
  outputMeterLeft: document.getElementById('outputMeterLeft'),
  outputMeterRight: document.getElementById('outputMeterRight'),
  inputMeterReadout: document.getElementById('inputMeterReadout'),
  outputMeterReadout: document.getElementById('outputMeterReadout'),
  gainReductionBar: document.getElementById('compressorReductionLeft') || document.getElementById('gainReductionBar'),
  compressorReductionLeft: document.getElementById('compressorReductionLeft'),
  compressorReductionRight: document.getElementById('compressorReductionRight'),
  compressorReductionValue: document.getElementById('compressorReductionValue'),
  clipBadge: document.getElementById('clipBadge'),
  saveDialog: document.getElementById('saveDialog'),
  presetNameInput: document.getElementById('presetNameInput'),
  confirmSavePreset: document.getElementById('confirmSavePreset')
};

let layers = {};
let W = 0, H = 0, PL = 46, PR = 14, PT = 16, PB = 24, plotW = 0, plotH = 0;
const logFmin = Math.log10(F_MIN);
const logFspan = Math.log10(F_MAX) - logFmin;
let drag = null;
const DRAG_THRESH = 3;
const METER_POLL_MS = 170;
const VISUAL_FRAME_MS = 34;
const SPECTRUM_FRAME_MS = 24;
const PEAK_ATTACK_ALPHA = 0.34;
const PEAK_RELEASE_ALPHA = 0.10;

async function init() {
  sendMessage({ target: 'background', type: 'REGISTER_STUDIO' }).catch(() => {});
  document.addEventListener('visibilitychange', onStudioVisibilityChange);
  buildSkeleton();
  bindUiEvents();
  await refreshState();
  stopWatchingOutputDevices = watchAudioOutputDeviceChanges(() => {
    outputDeviceLastDetectionAt = 0;
    refreshStudioOutputDevicesIfStale();
  });
  layout();
  startMeterPolling();
  startCompLoop();
  startColorLoop();
  requestAnimationFrame(tickSpectrum);
}

function bindUiEvents() {
  if (ui.startStopButton) {
    ui.startStopButton.addEventListener('click', async (event) => {
      if (busy) return;
      busy = true;
      ui.startStopButton.disabled = true;
      const fullStop = Boolean(event.shiftKey || event.altKey);
      ui.startStopButton.textContent = state?.active ? (fullStop ? 'Stopping…' : 'Bypassing…') : 'Starting…';
      try {
        const response = state?.active
          ? (fullStop ? await stopEnhance() : await toggleEnhanceBypass())
          : await startEnhanceWithAutoBypassOff();
        if (!response?.ok) throw new Error(response?.error || 'Command failed');
        await refreshState();
      } catch (error) {
        console.error(error);
        ui.sourceTitle.textContent = error.message || 'Start failed';
      } finally {
        busy = false;
        ui.startStopButton.disabled = false;
        renderChromeState();
      }
    });
  }

  ui.btnUndo.addEventListener('click', undo);
  ui.btnRedo.addEventListener('click', redo);
  ui.btnReset.addEventListener('click', async () => {
    const defaultPreset = presets.find((preset) => preset.id === 'default') || FACTORY_PRESETS[0];
    masterPresetDirty = false;
    clearModulePresetSelections();
    await applyPreset(defaultPreset);
    await refreshState(true);
  });
  ui.btnBypass.addEventListener('click', async () => {
    const next = !state?.output?.bypass;
    bypassAll = next;
    state.output = { ...state.output, bypass: next };
    syncMasterBypassButton(next);
    document.querySelector('.app')?.classList.toggle('master-bypassed', next);
    updateRackState();
    await updateEngineState({ output: { bypass: next } }).catch(console.error);
    renderAll();
    await refreshState(false);
  });
  ui.btnAB.addEventListener('click', toggleAB);
  ui.btnSave.addEventListener('click', () => {
    ui.presetNameInput.value = '';
    ui.saveDialog.showModal();
    ui.presetNameInput.focus();
  });
  ui.confirmSavePreset.addEventListener('click', async (event) => {
    event.preventDefault();
    const name = ui.presetNameInput.value.trim();
    if (!name) return;
    const response = await saveCustomPreset({
      name,
      description: 'Custom studio tuning',
      eq: serializeBands(),
      compressor: state.compressor,
      output: state.output,
      color: state.color,
      width: state.width
    });
    if (Array.isArray(response?.presets)) presets = response.presets;
    if (response?.state) state = response.state;
    masterPresetDirty = false;
    clearModulePresetSelections();
    ui.saveDialog.close();
    await refreshState(false);
  });

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('dblclick', onDoubleClick);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('pointerdown', (event) => {
    if (!ctxMenu.contains(event.target)) hideCtx();
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.target.isContentEditable || event.target.tagName === 'INPUT') return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    }
  });

  document.querySelectorAll('.rack-node[data-jump]').forEach((button) => {
    button.title = 'Click to bypass or enable this module.';
    button.addEventListener('click', () => toggleModule(button.dataset.jump));
  });

  ui.bypassEq?.addEventListener('click', () => toggleModule('eq'));
  ui.bypassCompressor?.addEventListener('click', () => toggleModule('compressor'));
  ui.bypassColor?.addEventListener('click', () => toggleModule('color'));
  ui.bypassWidth?.addEventListener('click', () => toggleModule('width'));
  ui.bypassLimiter?.addEventListener('click', () => toggleModule('limiter'));
  ui.masterPresetSelect?.addEventListener('change', async () => {
    const preset = presets.find((candidate) => candidate.id === ui.masterPresetSelect.value);
    if (!preset) {
      renderPresetDropdowns();
      return;
    }
    masterPresetDirty = false;
    clearModulePresetSelections();
    await applyPreset(preset);
    await refreshState(true);
  });
  bindModulePresetSelect('eq', ui.eqPresetSelect);
  bindModulePresetSelect('compressor', ui.compressorPresetSelect);
  bindModulePresetSelect('color', ui.colorPresetSelect);
  bindModulePresetSelect('width', ui.widthPresetSelect);
  bindModulePresetSelect('limiter', ui.limiterPresetSelect);
  ui.spectrumModeButtons.forEach((button) => {
    button.addEventListener('click', () => setSpectrumMode(button.dataset.spectrumMode));
  });
  setSpectrumMode(spectrumMode);

  const ro = new ResizeObserver(() => layout());
  ro.observe(displayWrap);
}

async function refreshState(resetHistory = false) {
  const next = await getEngineState().catch((error) => {
    console.error(error);
    return null;
  });
  if (!next) return;
  state = {
    ...next,
    eqEnabled: next.eqEnabled !== false,
    color: { ...DEFAULT_COLOR, ...(next.color || {}) },
    width: { ...DEFAULT_WIDTH, ...(next.width || {}) },
    output: { ...DEFAULT_OUTPUT, ...(next.output || {}) }
  };
  presets = next.presets || FACTORY_PRESETS;
  bypassAll = Boolean(state.output?.bypass);
  loadBandsFromState(state.eq, resetHistory);
  renderAll();
  renderChromeState();
  renderPresetDropdowns();
  renderCompressorControls();
  renderColorControls();
  renderWidthControls();
  renderOutputControls();
  renderTopbarOutputDevice();
  drawCompressorCurve();
  updateRackState();
  updateMeters(state.meters || {});
}

function loadBandsFromState(eqBands, resetHistory = false) {
  bands = normalizeEqBands(eqBands).map((band, index) => ({
    ...band,
    color: BAND_COLORS[index % BAND_COLORS.length]
  }));
  nextId = bands.reduce((max, band) => {
    const numeric = Number(String(band.id || '').replace(/\D/g, ''));
    return Number.isFinite(numeric) ? Math.max(max, numeric + 1) : max;
  }, bands.length + 1);
  colorIdx = bands.length;
  if (!bands.some((band) => band.id === selectedId)) selectedId = bands[0]?.id || null;
  if (resetHistory || lastCommitted === null) {
    lastCommitted = snapshot();
    undoStack = [];
    redoStack = [];
    updateHistoryButtons();
  }
}


async function startEnhanceWithAutoBypassOff() {
  if (state?.output?.bypass === true) {
    ui.sourceTitle.textContent = 'Reactivating mastering chain…';
    bypassAll = false;
    state.output = { ...state.output, bypass: false };
    syncMasterBypassButton(false);
    document.querySelector('.app')?.classList.remove('master-bypassed');
    updateRackState();
    await updateEngineState({ output: { bypass: false } });
  }
  return startEnhance(sourceTabIdFromUrl);
}

async function toggleEnhanceBypass() {
  const bypass = !Boolean(state?.output?.bypass);
  bypassAll = bypass;
  state.output = { ...state.output, bypass };
  syncMasterBypassButton(bypass);
  document.querySelector('.app')?.classList.toggle('master-bypassed', bypass);
  updateRackState();
  return updateEngineState({ output: { bypass } });
}

function onStudioVisibilityChange() {
  if (!document.hidden) {
    lastSpectrumRenderMs = 0;
    lastSpectrumTickMs = 0;
    refreshState(false).catch(console.error);
  }
}

function getPresetDisplayName(preset) {
  if (!preset) return MASARI_PRESET_LABEL;
  if (preset.id === 'default') return MASARI_PRESET_LABEL;
  return preset.name || MASARI_PRESET_LABEL;
}

function renderABButton() {
  if (!ui.btnAB) return;
  const slot = activeABSlot === 'B' ? 'B' : 'A';
  ui.btnAB.dataset.slot = slot;
  ui.btnAB.classList.remove('active');
  ui.btnAB.title = `A/B compare — active slot ${slot}. Click to snapshot this slot and switch.`;
  ui.btnAB.setAttribute('aria-label', `A/B compare active slot ${slot}. Toggle between temporary A and B snapshots.`);
  ui.btnAB.setAttribute('aria-pressed', slot === 'B' ? 'true' : 'false');
}

function renderChromeState() {
  if (!state) return;
  const isActive = Boolean(state.active);
  ui.sourceChip.classList.toggle('active', isActive);
  ui.sourceTitle.textContent = state.sourceTitle || 'No active capture';
  if (ui.startStopButton) {
    ui.startStopButton.hidden = isActive;
    ui.startStopButton.textContent = 'Start Enhance';
    ui.startStopButton.classList.toggle('danger', false);
  }
  const muted = Boolean(state.output?.bypass);
  syncMasterBypassButton(muted);
  document.querySelector('.app')?.classList.toggle('master-bypassed', muted);
  updateRackState();
  updateTopbarOutputDeviceHint();
  renderABButton();
}

function syncMasterBypassButton(isBypassed = false) {
  ui.btnBypass?.classList.toggle('active', Boolean(isBypassed));
  const label = ui.btnBypass?.querySelector('span');
  if (label) label.textContent = isBypassed ? 'BYPASS' : 'ACTIVE';
  ui.btnBypass?.setAttribute('aria-pressed', String(!isBypassed));
  ui.btnBypass?.setAttribute('title', isBypassed ? 'Master bypass is enabled — click to reactivate all FX' : 'Master FX active — click to bypass all FX');
}

function renderAll() {
  renderCurve();
  renderNodes();
  renderInspector();
  renderPresetDropdowns();
}

function buildSkeleton() {
  svg.innerHTML = '';
  // Defs — premium spectrum gradients (dark transparent → faint accent fade)
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML = `
    <linearGradient id="specGradPost" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(95,227,214,0.22)"/>
      <stop offset="55%" stop-color="rgba(95,227,214,0.07)"/>
      <stop offset="100%" stop-color="rgba(95,227,214,0.0)"/>
    </linearGradient>
    <linearGradient id="specGradPre" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(110,168,255,0.20)"/>
      <stop offset="55%" stop-color="rgba(110,168,255,0.06)"/>
      <stop offset="100%" stop-color="rgba(110,168,255,0.0)"/>
    </linearGradient>`;
  svg.appendChild(defs);
  const g = (name) => {
    const el = document.createElementNS(SVG_NS, 'g');
    el.dataset.l = name;
    svg.appendChild(el);
    return el;
  };
  layers.grid = g('grid');
  layers.specIn = document.createElementNS(SVG_NS, 'path');
  layers.specIn.setAttribute('class', 'spec-fill-in');
  svg.appendChild(layers.specIn);
  layers.specInStroke = document.createElementNS(SVG_NS, 'path');
  layers.specInStroke.setAttribute('class', 'spec-stroke spec-stroke-in');
  svg.appendChild(layers.specInStroke);
  layers.specOut = document.createElementNS(SVG_NS, 'path');
  layers.specOut.setAttribute('class', 'spec-stroke spec-stroke-out');
  svg.appendChild(layers.specOut);
  layers.bandCurves = g('bandcurves');
  layers.curve = document.createElementNS(SVG_NS, 'path');
  layers.curve.setAttribute('class', 'curve');
  svg.appendChild(layers.curve);
  layers.nodes = g('nodes');
}

function layout() {
  const rect = svg.getBoundingClientRect();
  W = rect.width || 1000;
  H = rect.height || 390;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  plotW = W - PL - PR;
  plotH = H - PT - PB;
  drawGrid();
  renderAll();
}

function drawGrid() {
  const G = layers.grid;
  G.innerHTML = '';
  const freqTicks = [
    [20,'20'],[30,''],[40,''],[50,'50'],[60,''],[70,''],[80,''],[90,''],
    [100,'100'],[200,'200'],[300,''],[400,''],[500,'500'],[600,''],[700,''],[800,''],[900,''],
    [1000,'1k'],[2000,'2k'],[3000,''],[4000,''],[5000,'5k'],[6000,''],[7000,''],[8000,''],[9000,''],
    [10000,'10k'],[20000,'20k']
  ];
  for (const [freq, label] of freqTicks) {
    const x = freqToX(freq);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'grid-line');
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('y1', PT);
    line.setAttribute('y2', PT + plotH);
    line.setAttribute('opacity', label ? '.9' : '.4');
    G.appendChild(line);
    if (label) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('class', 'axis-text');
      text.setAttribute('x', x);
      text.setAttribute('y', PT + plotH + 15);
      text.setAttribute('text-anchor', 'middle');
      text.textContent = label;
      G.appendChild(text);
    }
  }
  const step = dbRange >= 18 ? 6 : dbRange >= 12 ? 6 : 3;
  for (let d = -dbRange; d <= dbRange; d += step) {
    const y = gainToY(d);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', d === 0 ? 'grid-zero' : 'grid-line');
    line.setAttribute('x1', PL);
    line.setAttribute('x2', PL + plotW);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    G.appendChild(line);
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'axis-text');
    text.setAttribute('x', PL - 8);
    text.setAttribute('y', y + 3);
    text.setAttribute('text-anchor', 'end');
    text.textContent = `${d > 0 ? '+' : ''}${d}`;
    G.appendChild(text);
  }
}

function coeffs(type, f0, Q, gainDb) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * f0 / FS;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const al = sw / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'peaking':
      b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
    }
    case 'highpass':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'lowpass':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'notch':
      b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    default:
      b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0; break;
  }
  return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
}

function magLin(c, f) {
  const w = 2 * Math.PI * f / FS;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2*w), s2 = Math.sin(2*w);
  const nRe = c.b0 + c.b1*c1 + c.b2*c2;
  const nIm = -(c.b1*s1 + c.b2*s2);
  const dRe = 1 + c.a1*c1 + c.a2*c2;
  const dIm = -(c.a1*s1 + c.a2*s2);
  return Math.sqrt((nRe*nRe + nIm*nIm) / (dRe*dRe + dIm*dIm));
}

function bandDb(b, f) {
  if (b.bypass || b.enabled === false) return 0;
  if (isCutType(b.type)) {
    const ptype = b.type === 'lowcut' ? 'highpass' : 'lowpass';
    let m = 1;
    for (const q of (BUTTER[b.slope] || BUTTER[12])) m *= magLin(coeffs(ptype, b.frequency, q, 0), f);
    return 20 * Math.log10(Math.max(1e-9, m));
  }
  const map = { bell:'peaking', lowshelf:'lowshelf', highshelf:'highshelf', notch:'notch' }[b.type] || 'peaking';
  return 20 * Math.log10(Math.max(1e-9, magLin(coeffs(map, b.frequency, b.q, b.gain), f)));
}

function totalDb(f) {
  let sum = 0;
  for (const b of bands) sum += bandDb(b, f);
  return sum;
}

function isEqActive() {
  return !bypassAll && state?.eqEnabled !== false;
}

function curvePath(fn) {
  let d = '';
  const samples = 240;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const f = Math.pow(10, logFmin + t * logFspan);
    const x = PL + t * plotW;
    const y = clamp(gainToY(fn(f)), PT - 50, PT + plotH + 50);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d;
}

function renderCurve() {
  const eqActive = isEqActive();
  layers.curve.setAttribute('d', curvePath((f) => eqActive ? totalDb(f) : 0));
  layers.curve.classList.toggle('bypassed', !eqActive);
  layers.bandCurves.innerHTML = '';
  if (!eqActive) return;
  for (const b of bands) {
    if (b.bypass || b.enabled === false) continue;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'band-curve');
    path.setAttribute('stroke', b.color);
    path.setAttribute('d', curvePath((f) => bandDb(b, f)));
    layers.bandCurves.appendChild(path);
  }
}

function renderNodes() {
  layers.nodes.innerHTML = '';
  for (const b of bands) {
    const x = freqToX(b.frequency);
    const y = nodeY(b);
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', `node${b.id === selectedId ? ' selected' : ''}${b.bypass || b.enabled === false ? ' bypassed' : ''}`);
    group.setAttribute('transform', `translate(${x.toFixed(2)},${y.toFixed(2)})`);
    group.dataset.id = b.id;
    const hit = document.createElementNS(SVG_NS, 'circle');
    hit.setAttribute('class', 'node-hit');
    hit.setAttribute('r', 16);
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('class', 'node-ring');
    ring.setAttribute('r', b.id === selectedId ? 7.5 : 6.5);
    ring.setAttribute('stroke', b.color);
    const core = document.createElementNS(SVG_NS, 'circle');
    core.setAttribute('class', 'node-core');
    core.setAttribute('r', b.id === selectedId ? 3 : 2.4);
    core.setAttribute('fill', b.color);
    group.append(hit, ring, core);
    layers.nodes.appendChild(group);
  }
}

function renderInspector() {
  const b = getBand(selectedId);
  if (!b) {
    inspector.innerHTML = '<div class="insp-empty">No band selected — double-click the display to add one</div>';
    return;
  }
  const seg = TYPES.map((t) => `<button class="${b.type === t.id ? 'on' : ''}" data-type="${t.id}">${t.label}</button>`).join('');
  let fields = `<div class="field"><label>Freq</label><div class="val" contenteditable data-k="frequency">${fmtFreqEditable(b.frequency)}</div></div>`;
  if (isCutType(b.type)) {
    fields += `<div class="field"><label>Slope</label><div class="seg" data-slope>${SLOPES.map((s) => `<button class="${b.slope === s ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div></div>`;
  } else {
    fields += `<div class="field"><label>Gain dB</label><div class="val" contenteditable data-k="gain">${b.gain.toFixed(1)}</div></div>`;
    fields += `<div class="field"><label>Q</label><div class="val" contenteditable data-k="q">${b.q.toFixed(2)}</div></div>`;
  }
  inspector.innerHTML = `
    <span class="insp-swatch"></span>
    <div class="seg" data-typeseg>${seg}</div>
    ${fields}
    <div class="insp-actions">
      <button class="btn" data-act="bypass">${b.bypass || b.enabled === false ? 'Bypassed' : 'Enabled'}</button>
      <button class="btn" data-act="delete">Delete</button>
    </div>`;
  inspector.querySelector('.insp-swatch').style.background = b.color;
  inspector.querySelectorAll('[data-typeseg] button').forEach((el) => {
    el.addEventListener('click', () => {
      setType(b, el.dataset.type);
      renderAll();
      commitAndSend();
    });
  });
  inspector.querySelectorAll('[data-slope] button').forEach((el) => {
    el.addEventListener('click', () => {
      b.slope = Number(el.dataset.s);
      renderAll();
      commitAndSend();
    });
  });
  inspector.querySelectorAll('.val[contenteditable]').forEach((el) => {
    el.addEventListener('focus', () => selectEditable(el));
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        el.blur();
      }
    });
    el.addEventListener('blur', () => {
      applyField(b, el.dataset.k, el.textContent);
      renderAll();
      commitAndSend();
    });
  });
  inspector.querySelector('[data-act="bypass"]').addEventListener('click', () => {
    b.bypass = !(b.bypass || b.enabled === false);
    b.enabled = !b.bypass;
    renderAll();
    commitAndSend();
  });
  inspector.querySelector('[data-act="delete"]').addEventListener('click', () => {
    deleteBand(b.id);
    renderAll();
    commitAndSend();
  });
}

function renderPresetDropdowns() {
  renderMasterPresetSelect();
  renderModulePresetSelect('eq', ui.eqPresetSelect);
  renderModulePresetSelect('compressor', ui.compressorPresetSelect);
  renderModulePresetSelect('color', ui.colorPresetSelect);
  renderModulePresetSelect('width', ui.widthPresetSelect);
  renderModulePresetSelect('limiter', ui.limiterPresetSelect);
}


function getVisibleMasterPresets() {
  const source = Array.isArray(presets) && presets.length ? presets : FACTORY_PRESETS;
  const primary = source.filter((preset) => PRIMARY_MASTER_PRESET_IDS.includes(preset.id));
  const custom = source.filter((preset) => !FACTORY_PRESETS.some((factory) => factory.id === preset.id));
  const fallbackPrimary = FACTORY_PRESETS.filter((preset) => PRIMARY_MASTER_PRESET_IDS.includes(preset.id));
  const merged = [...(primary.length ? primary : fallbackPrimary), ...custom];
  const seen = new Set();
  return merged.filter((preset) => {
    if (!preset?.id || seen.has(preset.id)) return false;
    seen.add(preset.id);
    return true;
  });
}

function renderMasterPresetSelect() {
  if (!ui.masterPresetSelect || !state) return;
  const visiblePresets = getVisibleMasterPresets();
  const selectedIsVisible = visiblePresets.some((preset) => preset.id === state.selectedPresetId);
  const desired = visiblePresets.map((preset) => preset.id).join('|') + `|${selectedIsVisible ? '' : state.selectedPresetId || 'custom'}|dirty:${masterPresetDirty ? 1 : 0}`;
  if (ui.masterPresetSelect.dataset.optionIds !== desired) {
    ui.masterPresetSelect.innerHTML = '';
    if (!selectedIsVisible || masterPresetDirty) {
      const custom = document.createElement('option');
      custom.value = '';
      custom.textContent = CUSTOM_PRESET_LABEL;
      ui.masterPresetSelect.appendChild(custom);
    }
    for (const preset of visiblePresets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = getPresetDisplayName(preset);
      option.title = preset.description || getPresetDisplayName(preset);
      ui.masterPresetSelect.appendChild(option);
    }
    ui.masterPresetSelect.dataset.optionIds = desired;
  }
  const selected = !masterPresetDirty && selectedIsVisible ? state.selectedPresetId : '';
  ui.masterPresetSelect.value = selected;
  if (selected && ui.masterPresetSelect.value !== selected) {
    ui.masterPresetSelect.dataset.optionIds = '';
    renderMasterPresetSelect();
  }
}

function renderModulePresetSelect(key, select) {
  if (!select) return;
  const list = MODULE_PRESETS[key] || [];
  const desired = list.map((preset) => preset.id).join('|');
  if (select.dataset.optionIds !== desired) {
    select.innerHTML = '';
    const manual = document.createElement('option');
    manual.value = '';
    manual.textContent = MASARI_PRESET_LABEL;
    select.appendChild(manual);
    for (const preset of list) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      select.appendChild(option);
    }
    select.dataset.optionIds = desired;
  }
  const selected = list.some((preset) => preset.id === modulePresetSelections[key])
    ? modulePresetSelections[key]
    : '';
  select.value = selected;
}

function bindModulePresetSelect(key, select) {
  if (!select) return;
  select.addEventListener('change', async () => {
    const preset = (MODULE_PRESETS[key] || []).find((candidate) => candidate.id === select.value);
    if (!preset) {
      modulePresetSelections[key] = '';
      renderModulePresetSelect(key, select);
      return;
    }
    await applyModulePreset(key, preset);
  });
}

async function applyModulePreset(key, preset) {
  if (!state || !preset) return;
  masterPresetDirty = true;
  modulePresetSelections[key] = preset.id;
  if (key === 'eq') {
    state.eqEnabled = preset.eqEnabled !== false;
    loadBandsFromState(preset.eq, true);
    renderAll();
    updateRackState();
    await updateEngineState({ eqEnabled: state.eqEnabled !== false, eq: serializeBands() }).catch(console.error);
  } else if (key === 'compressor') {
    state.compressor = normalizeCompressor(preset.compressor);
    renderCompressorControls();
    drawCompressorCurve();
    updateRackState();
    await updateEngineState({ compressor: state.compressor }).catch(console.error);
  } else if (key === 'color') {
    state.color = normalizeColor(preset.color);
    renderColorControls();
    drawColorViz();
    updateRackState();
    await updateEngineState({ color: state.color }).catch(console.error);
  } else if (key === 'width') {
    state.width = normalizeWidth(preset.width);
    renderWidthControls();
    updateRackState();
    await updateEngineState({ width: state.width }).catch(console.error);
  } else if (key === 'limiter') {
    state.output = normalizeOutput({
      ...state.output,
      ...(preset.output || {}),
      outputDeviceId: state.output?.outputDeviceId || DEFAULT_OUTPUT.outputDeviceId,
      outputDeviceLabel: state.output?.outputDeviceLabel || DEFAULT_OUTPUT.outputDeviceLabel,
      outputRouteStatus: state.output?.outputRouteStatus || DEFAULT_OUTPUT.outputRouteStatus
    });
    renderOutputControls();
    updateRackState();
    await updateEngineState({ output: state.output }).catch(console.error);
  }
  renderPresetDropdowns();
}

function markMasterPresetCustom() {
  masterPresetDirty = true;
  renderMasterPresetSelect();
}

function getSourceTabIdFromUrl() {
  try {
    const tabId = Number(new URL(location.href).searchParams.get('sourceTabId'));
    return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
  } catch {
    return null;
  }
}

function markModulePresetCustom(key) {
  if (!modulePresetSelections[key]) {
    markMasterPresetCustom();
    return;
  }
  modulePresetSelections[key] = '';
  renderModulePresetSelect(key, ui[`${key}PresetSelect`]);
  markMasterPresetCustom();
}

function clearModulePresetSelections() {
  Object.keys(modulePresetSelections).forEach((key) => {
    modulePresetSelections[key] = '';
  });
}

function renderCompressorControls() {
  if (!state) return;
  ui.compressorControls.innerHTML = '';
  const controls = [
    ['threshold', 'Threshold', -60, 0, 0.5, 'dB'],
    ['ratio', 'Ratio', 1, 12, 0.1, ':1'],
    ['knee', 'Knee', 0, 40, 0.5, 'dB'],
    ['attack', 'Attack', 0.001, 0.1, 0.001, 's'],
    ['release', 'Release', 0.03, 1, 0.01, 's'],
    ['makeupGain', 'Makeup', -12, 18, 0.1, 'dB'],
    ['parallelMix', 'Parallel', 0, 100, 1, '%']
  ];
  for (const [field, label, min, max, step, unit] of controls) {
    ui.compressorControls.appendChild(createSliderControl({
      label,
      value: state.compressor[field],
      min,
      max,
      step,
      unit,
      onInput: async (value) => {
        markModulePresetCustom('compressor');
        state.compressor[field] = value;
        await updateEngineState({ compressor: { [field]: value } });
        drawCompressorCurve();
      }
    }));
  }
}


function renderColorControls() {
  if (!state || !ui.colorControls) return;
  state.color = { ...DEFAULT_COLOR, ...(state.color || {}) };
  ui.colorControls.innerHTML = '';
  const controls = [
    ['drive', 'Drive', 0, 24, 0.1, 'dB'],
    ['body', 'Bass Body', -24, 24, 0.5, '%'],
    ['warmth', 'Warmth', -24, 24, 0.5, '%'],
    ['harmonics', 'Exciter', 0, 100, 1, '%'],
    ['air', 'Air', -24, 48, 0.5, '%'],
    ['mix', 'Mix', 0, 100, 1, '%']
  ];
  for (const [field, label, min, max, step, unit] of controls) {
    ui.colorControls.appendChild(createSliderControl({
      label,
      value: state.color[field],
      min,
      max,
      step,
      unit,
      onInput: async (value) => {
        markModulePresetCustom('color');
        state.color[field] = value;
        await updateEngineState({ color: { [field]: value } });
        drawColorViz();
      }
    }));
  }
  const mode = document.createElement('div');
  mode.className = 'seg mode-seg';
  mode.setAttribute('aria-label', 'Color harmonic mode');
  const colorModes = [
    ['clean', 'Clean', '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>'],
    ['warm', 'Warm', '<path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/>'],
    ['modern', 'Modern', '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>']
  ];
  mode.innerHTML = colorModes.map(([value, label, icon]) => `<button type="button" class="${state.color.mode === value ? 'on' : ''}" data-mode="${value}" aria-label="${label} color mode" title="${label}" aria-pressed="${state.color.mode === value ? 'true' : 'false'}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`).join('');
  mode.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      markModulePresetCustom('color');
      state.color.mode = button.dataset.mode;
      await updateEngineState({ color: { mode: state.color.mode } });
      renderColorControls();
    });
  });
  ui.colorControls.appendChild(mode);
  if (ui.colorModeBadge) ui.colorModeBadge.textContent = state.color.enabled ? state.color.mode : 'Bypass';
  drawColorViz();
  updateRackState();
}

// Saturn-style harmonic visualizer: saturation transfer curve + harmonic comb,
// tilted by Warmth (low end) and Air (high end), even/odd weighting by mode.
function drawColorViz() {
  const canvas = document.getElementById('colorCanvas');
  if (!canvas || !state) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const col = state.color || DEFAULT_COLOR;
  const on = col.enabled;
  const drive = (col.drive || 0) / 24;
  const harm = (col.harmonics || 0) / 100;
  const livePeak = Math.max(displayedInputLeft, displayedInputRight, displayedOutputLeft, displayedOutputRight);
  const liveAmount = state.active ? peakToMeterScale(livePeak) : 0.22 + Math.sin(colorVizPhase * 0.7) * 0.04;
  const intensity = on ? clamp(drive * 0.65 + harm * 0.5 + liveAmount * 0.25 + 0.08, 0.05, 1) : 0.05;
  const motion = on ? clamp(liveAmount, 0.08, 1) : 0;
  const amber = on ? '#F6B35C' : '#3A4254';
  const amber2 = on ? '#FF8E5B' : '#3A4254';

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#070A11';
  roundRect(ctx, 0, 0, width, height, 13); ctx.fill();

  const pad = 12;
  // Left third: saturation transfer curve (S-shape grows with drive)
  const cw = width * 0.34, ch = height - pad * 2;
  const cx0 = pad, cy0 = pad;
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx0, cy0 + ch / 2); ctx.lineTo(cx0 + cw, cy0 + ch / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx0 + cw / 2, cy0); ctx.lineTo(cx0 + cw / 2, cy0 + ch); ctx.stroke();
  const k = 1 + intensity * 7; // curvature
  ctx.beginPath();
  for (let i = 0; i <= 60; i += 1) {
    const x = (i / 60) * 2 - 1;
    const y = Math.tanh(x * k) / Math.tanh(k || 1);
    const px = cx0 + (i / 60) * cw;
    const py = cy0 + ch / 2 - y * (ch / 2) * 0.9;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.strokeStyle = amber; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
  if (on) { ctx.shadowColor = 'rgba(246,179,92,.5)'; ctx.shadowBlur = 7; }
  ctx.stroke(); ctx.shadowBlur = 0;

  // Right two-thirds: harmonic comb
  const hx0 = width * 0.40, hw = width - hx0 - pad;
  const base = cy0 + ch;
  const N = 11;
  const evenBias = col.mode === 'warm' ? 0.7 : col.mode === 'modern' ? 0.35 : 0.5;
  const warmth = clamp((col.warmth || 0) / 24, -1, 1);
  const air = clamp((col.air || 0) / 24, -1, 1);
  const body = clamp((col.body || 0) / 24, -1, 1);
  for (let n = 1; n <= N; n += 1) {
    const isEven = n % 2 === 0;
    let amp = intensity * Math.pow(0.74, n - 1);
    amp *= isEven ? (0.5 + evenBias) : (1.4 - evenBias);
    // spectral tilt: low harmonics get Body/Warmth, high get Air
    const t = (n - 1) / (N - 1);
    amp *= 1 + Math.max(0, body) * 0.5 * (1 - t) + Math.max(0, warmth) * 0.4 * (1 - t) + Math.max(0, air) * 0.6 * t;
    amp *= 1 + motion * 0.16 * Math.sin(colorVizPhase * 2.4 + n * 0.72);
    amp = clamp(amp, 0, 1);
    const bx = hx0 + (n - 0.5) / N * hw;
    const bw = (hw / N) * 0.5;
    const bh = amp * ch * 0.94;
    const grad = ctx.createLinearGradient(0, base - bh, 0, base);
    grad.addColorStop(0, on ? (isEven ? amber : amber2) : '#3A4254');
    grad.addColorStop(1, on ? 'rgba(246,179,92,.12)' : 'rgba(58,66,84,.2)');
    ctx.fillStyle = grad;
    roundRect(ctx, bx - bw / 2, base - bh, bw, bh, Math.min(bw / 2, 3));
    ctx.fill();
    if (on && n === 1) {
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      roundRect(ctx, bx - bw / 2, base - bh, bw, 2, 1); ctx.fill();
    }
  }

  if (on) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i += 1) {
      const t = (colorVizPhase * (0.16 + i * 0.025) + i * 0.23) % 1;
      const x = hx0 - 18 + t * (hw + 24);
      const y = cy0 + ch * (0.22 + i * 0.17) + Math.sin(colorVizPhase * 1.6 + i) * 4;
      const alpha = (1 - Math.abs(t - 0.5) * 1.7) * motion;
      ctx.fillStyle = `rgba(246,179,92,${clamp(alpha, 0, 0.42).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.2 + motion * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.font = '8px "Sometype Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(124,133,155,.5)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('SATURATION', cx0, cy0 - 2 + ch + 1 > height ? cy0 : height - 11);
  ctx.fillText('HARMONICS', hx0, height - 11);
}

function startColorLoop() {
  if (_colorLoop) return;
  const tick = (ts) => {
    if (document.hidden) {
      _colorLoop = requestAnimationFrame(tick);
      return;
    }
    if (!(_lastColorFrame) || ts - _lastColorFrame >= VISUAL_FRAME_MS) {
      colorVizPhase = ts / 1000;
      if (state?.color?.enabled) drawColorViz();
      _lastColorFrame = ts;
    }
    _colorLoop = requestAnimationFrame(tick);
  };
  _colorLoop = requestAnimationFrame(tick);
}

function renderWidthControls() {
  if (!state || !ui.widthControls) return;
  state.width = normalizeWidth(state.width || DEFAULT_WIDTH);
  ui.widthControls.innerHTML = '';
  const controls = [
    ['width', 'Master', 0, 200, 1, '%'],
    ['lowWidth', 'Low', 0, 200, 1, '%'],
    ['lowMidWidth', 'Low-Mid', 0, 200, 1, '%'],
    ['midWidth', 'Mid', 0, 200, 1, '%'],
    ['highWidth', 'High', 0, 200, 1, '%'],
    ['sourceProtect', 'Source Guard', 0, 100, 1, '%'],
    ['monoBassFreq', 'Created Bass Guard', 60, 250, 1, 'Hz'],
    ['sideTone', 'Side Air', -12, 18, 0.5, 'dB']
  ];
  for (const [field, label, min, max, step, unit] of controls) {
    ui.widthControls.appendChild(createSliderControl({
      label,
      value: state.width[field],
      min,
      max,
      step,
      unit,
      onInput: async (value) => {
        markModulePresetCustom('width');
        state.width[field] = value;
        await updateEngineState({ width: { [field]: value } });
        updateRackState();
      }
    }));
  }
  updateRackState();
}

function moduleEnabled(key) {
  if (!state) return false;
  if (key === 'eq') return state.eqEnabled !== false;
  if (key === 'compressor') return Boolean(state.compressor?.enabled);
  if (key === 'color') return Boolean(state.color?.enabled);
  if (key === 'width') return Boolean(state.width?.enabled);
  if (key === 'limiter') return Boolean(state.output?.limiterEnabled);
  return false;
}

async function toggleModule(key) {
  if (!state) return;
  await setModuleEnabled(key, !moduleEnabled(key));
}

async function setModuleEnabled(key, enabled) {
  if (!state) return;
  markModulePresetCustom(key === 'limiter' ? 'limiter' : key);
  const on = Boolean(enabled);
  let patch = null;
  if (key === 'eq') {
    state.eqEnabled = on;
    patch = { eqEnabled: on };
    renderAll();
  } else if (key === 'compressor') {
    state.compressor = { ...state.compressor, enabled: on };
    patch = { compressor: { enabled: on } };
    renderCompressorControls();
    drawCompressorCurve();
  } else if (key === 'color') {
    state.color = { ...state.color, enabled: on };
    patch = { color: { enabled: on } };
    renderColorControls();
    drawColorViz();
  } else if (key === 'width') {
    state.width = { ...state.width, enabled: on };
    patch = { width: { enabled: on } };
    renderWidthControls();
  } else if (key === 'limiter') {
    state.output = { ...state.output, limiterEnabled: on };
    patch = { output: { limiterEnabled: on } };
    renderOutputControls();
  }
  updateRackState();
  if (patch) await updateEngineState(patch).catch(console.error);
}

function updateRackState() {
  if (!state) return;
  const moduleStates = {
    eq: moduleEnabled('eq'),
    compressor: moduleEnabled('compressor'),
    color: moduleEnabled('color'),
    width: moduleEnabled('width'),
    limiter: moduleEnabled('limiter')
  };
  document.querySelectorAll('.rack-node[data-jump]').forEach((node) => {
    const key = node.dataset.jump;
    const on = Boolean(moduleStates[key]);
    const visualOn = on && !Boolean(state.output?.bypass);
    node.classList.toggle('on', visualOn);
    node.classList.toggle('bypassed', !visualOn);
    node.dataset.masterBypassed = state.output?.bypass ? 'true' : 'false';
    node.setAttribute('aria-pressed', String(visualOn));
  });
  if (ui.colorModeBadge) ui.colorModeBadge.textContent = moduleStates.color ? (state.color?.mode || 'Clean') : 'Bypass';
  updateModuleBypassButtons(moduleStates);
}

function updateModuleBypassButtons(moduleStates = null) {
  if (!state) return;
  const states = moduleStates || {
    compressor: moduleEnabled('compressor'),
    color: moduleEnabled('color'),
    width: moduleEnabled('width'),
    limiter: moduleEnabled('limiter')
  };
  const configs = [
    ['eq', ui.bypassEq, document.querySelector('.display-wrap')],
    ['compressor', ui.bypassCompressor, document.querySelector('.compressor-card')],
    ['color', ui.bypassColor, document.querySelector('.color-card')],
    ['width', ui.bypassWidth, document.querySelector('.width-card')],
    ['limiter', ui.bypassLimiter, document.querySelector('.output-card')]
  ];
  for (const [key, button, card] of configs) {
    const on = Boolean(states[key]);
    if (button) {
      button.setAttribute('aria-pressed', String(on));
      button.dataset.state = on ? 'on' : 'off';
      button.classList.toggle('is-on', on);
      button.classList.toggle('is-off', !on);
      button.title = on ? 'Click to bypass this module' : 'Click to enable this module';
    }
    if (card) card.classList.toggle('is-bypassed', !on);
  }
}

function setSpectrumMode(mode = 'post') {
  spectrumMode = mode === 'pre' ? 'pre' : 'post';
  displayWrap.dataset.spectrumView = spectrumMode;
  ui.spectrumModeButtons.forEach((button) => {
    const on = button.dataset.spectrumMode === spectrumMode;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  });
  if (layers.specIn) renderRoundedSpectrumPaths();
}

let _topbarDeviceControlEl = null;
let outputDevicePopulateToken = 0;
let outputDeviceLastDetectionAt = 0;
let stopWatchingOutputDevices = null;
function renderOutputControls() {
  if (!state) return;
  ui.outputControls.innerHTML = '';
  const controls = [
    ['inputGain', 'Input', -18, 12, 0.1, 'dB'],
    ['outputGain', 'Output', -18, 12, 0.1, 'dB'],
    ['limiterCeiling', 'Ceiling', -12, 0, 0.1, 'dB'],
    ['limiterDrive', 'Drive', 0, 12, 0.1, 'dB']
  ];
  for (const [field, label, min, max, step, unit] of controls) {
    ui.outputControls.appendChild(createSliderControl({
      label,
      value: state.output[field],
      min,
      max,
      step,
      unit,
      onInput: async (value) => {
        markModulePresetCustom('limiter');
        state.output[field] = value;
        await updateEngineState({ output: { [field]: value } });
      }
    }));
  }
  renderTopbarOutputDevice();
}

function renderTopbarOutputDevice() {
  if (!ui.topbarOutputDevice || !state) return;
  if (!_topbarDeviceControlEl) {
    _topbarDeviceControlEl = createOutputDeviceControl();
    ui.topbarOutputDevice.replaceChildren(_topbarDeviceControlEl);
    return;
  }
  if (!_topbarDeviceControlEl.isConnected) ui.topbarOutputDevice.replaceChildren(_topbarDeviceControlEl);
  restoreStudioOutputSelection(_topbarDeviceControlEl.querySelector('select'));
  updateTopbarOutputDeviceStatus();
}

function updateTopbarOutputDeviceHint() {
  updateTopbarOutputDeviceStatus();
}

function createOutputDeviceControl() {
  const wrapper = document.createElement('div');
  wrapper.className = 'topbar-device-control';
  wrapper.innerHTML = `
    <label>
      <span>Output</span>
      <select class="ak-select" aria-label="Output audio device">
        <option value="default">System Default</option>
      </select>
    </label>`;
  const select = wrapper.querySelector('select');
  select.addEventListener('change', async () => {
    const option = select.selectedOptions?.[0];
    if (option?.value === CHOOSE_OUTPUT_DEVICE_ID) {
      await chooseStudioBrowserOutputDevice(select).catch((error) => {
        restoreStudioOutputSelection(select);
        updateTopbarOutputDeviceStatus(error.message || 'Output device selection was cancelled.', true);
      });
      return;
    }
    if (option?.value === UNLOCK_OUTPUT_DEVICE_ID) {
      await unlockStudioOutputDevices(select).catch((error) => {
        restoreStudioOutputSelection(select);
        updateTopbarOutputDeviceStatus(error.message || 'Unable to unlock output device list.', true);
      });
      return;
    }
    await applyStudioOutputDevice({
      deviceId: option?.value || 'default',
      label: option?.dataset?.label || option?.textContent || 'System Default'
    }).catch((error) => updateTopbarOutputDeviceStatus(error.message || 'Unable to route output.', true));
  });
  populateStudioOutputDevices(select).catch((error) => updateTopbarOutputDeviceStatus(error.message || 'Unable to refresh output devices.', true));
  return wrapper;
}

async function populateStudioOutputDevices(select, preferredDeviceId = null, requestAccess = false) {
  if (!select) return;
  const token = ++outputDevicePopulateToken;
  const selectedId = normalizeOutputDeviceId(preferredDeviceId || state?.output?.outputDeviceId || 'default');
  select.dataset.detecting = 'true';
  const detection = await detectAudioOutputDevices({ requestAccess });
  if (token !== outputDevicePopulateToken) return;
  const devices = detection.devices || [];
  const optionModels = devices.map((device) => ({
    value: device.deviceId,
    text: device.isDefault ? 'System Default' : device.label,
    label: device.label
  }));
  if (!optionModels.some((option) => option.value === selectedId)) {
    optionModels.push({
      value: selectedId,
      text: state.output?.outputDeviceLabel || 'Previously selected device',
      label: state.output?.outputDeviceLabel || 'Previously selected device'
    });
  }
  if (detection.nonDefaultCount === 0 && detection.accessUnlockAvailable) {
    optionModels.push({ value: UNLOCK_OUTPUT_DEVICE_ID, text: 'Unlock device list…', label: 'Unlock device list…' });
  }
  if (detection.chooserAvailable) {
    optionModels.push({ value: CHOOSE_OUTPUT_DEVICE_ID, text: 'Choose output device…', label: 'Choose output device…' });
  }

  const signature = optionModels.map((option) => `${option.value}:${option.text}`).join('|');
  if (select.dataset.deviceSignature !== signature) {
    const fragment = document.createDocumentFragment();
    for (const model of optionModels) {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.text;
      option.dataset.label = model.label;
      option.selected = model.value === selectedId;
      fragment.appendChild(option);
    }
    select.replaceChildren(fragment);
    select.dataset.deviceSignature = signature;
  }
  restoreStudioOutputSelection(select);
  select.dataset.detecting = 'false';
  outputDeviceLastDetectionAt = Date.now();
  updateTopbarOutputDeviceStatus();
}

async function refreshStudioOutputDevicesIfStale() {
  if (!_topbarDeviceControlEl) return;
  const select = _topbarDeviceControlEl.querySelector('select');
  if (!select || Date.now() - outputDeviceLastDetectionAt < 15000) return;
  await populateStudioOutputDevices(select).catch((error) => updateTopbarOutputDeviceStatus(error.message || 'Unable to refresh output devices.', true));
}

function appendStudioChooseOutputOption(select, chooserAvailable) {
  if (!chooserAvailable || !select) return;
  const option = document.createElement('option');
  option.value = CHOOSE_OUTPUT_DEVICE_ID;
  option.textContent = 'Choose output device…';
  option.dataset.label = option.textContent;
  select.appendChild(option);
}

async function unlockStudioOutputDevices(select) {
  updateTopbarOutputDeviceStatus('Unlocking local output-device list… no microphone audio is recorded.');
  const access = await requestAudioOutputDeviceListAccess();
  if (access?.selectedDevice) await applyStudioOutputDevice(access.selectedDevice);
  await populateStudioOutputDevices(select, access?.selectedDevice?.deviceId || state?.output?.outputDeviceId || 'default', true);
}

async function chooseStudioBrowserOutputDevice(select) {
  updateTopbarOutputDeviceStatus('Opening Chrome output chooser…');
  const selected = await openBrowserAudioOutputChooser();
  await applyStudioOutputDevice(selected);
  await populateStudioOutputDevices(select, selected.deviceId);
}

function restoreStudioOutputSelection(select) {
  const selectedId = normalizeOutputDeviceId(state?.output?.outputDeviceId || 'default');
  const option = [...(select?.options || [])].find((candidate) => candidate.value === selectedId);
  if (option) option.selected = true;
}

async function applyStudioOutputDevice(device) {
  const outputDeviceId = normalizeOutputDeviceId(device?.deviceId);
  const outputDeviceLabel = outputDeviceId === 'default' ? 'System Default' : (device?.label || 'Selected output device');
  state.output = { ...state.output, outputDeviceId, outputDeviceLabel, outputRouteStatus: outputDeviceId === 'default' ? 'default' : 'selected' };
  updateTopbarOutputDeviceStatus('Routing output…');
  const response = await updateEngineState({ output: { outputDeviceId, outputDeviceLabel } });
  if (!response?.ok) throw new Error(response?.error || 'Unable to route output device.');
  if (response.state?.output) state.output = { ...state.output, ...response.state.output };
  updateTopbarOutputDeviceStatus();
  refreshStudioOutputDevicesIfStale();
}

function updateOutputDeviceHint() {
  updateTopbarOutputDeviceStatus();
}

function updateTopbarOutputDeviceStatus(message = '', forceIssue = false) {
  const wrapper = _topbarDeviceControlEl;
  if (!wrapper) return;
  const select = wrapper.querySelector('select');
  const label = state?.output?.outputDeviceLabel || 'System Default';
  const status = state?.output?.outputRouteStatus || (state?.output?.outputDeviceId === 'default' ? 'default' : 'selected');
  const issue = forceIssue || status === 'failed' || status === 'unsupported' || status === 'playback-blocked';
  const routed = status === 'routed';
  const selected = state?.output?.outputDeviceId && state.output.outputDeviceId !== 'default';
  const title = message || `${issue ? 'Issue' : routed ? 'Routed' : selected ? 'Selected' : 'Output'}: ${label}`;
  wrapper.title = title;
  wrapper.setAttribute('aria-label', title);
  select?.setAttribute('title', title);
  wrapper.classList.toggle('route-ok', routed || (!issue && selected));
  wrapper.classList.toggle('route-issue', issue);
}

let _knobUid = 0;
const KNOB_A0 = 225;      // arc start (deg, 0=top, cw+)
const KNOB_SWEEP = 270;   // total sweep
function knobPolar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function knobArc(cx, cy, r, a0, a1) {
  const [x0, y0] = knobPolar(cx, cy, r, a0);
  const [x1, y1] = knobPolar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 >= a0 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/* Rotary knob with the same contract as the old slider control.
   Vertical drag to adjust · Shift = fine · double-click = reset · wheel = step · arrows when focused. */
function createSliderControl({ label, value, min, max, step, unit, onInput }) {
  const uid = ++_knobUid;
  const bipolar = min < 0 && max > 0;
  const resetValue = clamp(value, min, max);
  let val = resetValue;

  const cx = 28, cy = 28, r = 22;
  const norm = (v) => (v - min) / (max - min);
  const ang = (v) => KNOB_A0 + clamp(norm(v), 0, 1) * KNOB_SWEEP;
  const centerAng = KNOB_A0 + (bipolar ? clamp(norm(0), 0, 1) : 0) * KNOB_SWEEP;

  // Tick marks at min, center (if bipolar), max
  const tickPath = (deg, inner, outer) => {
    const [x0, y0] = knobPolar(cx, cy, inner, deg);
    const [x1, y1] = knobPolar(cx, cy, outer, deg);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  const wrap = document.createElement('div');
  wrap.className = 'knob-control' + (bipolar ? ' bipolar' : '');
  wrap.innerHTML = `
    <div class="knob-label">${label}</div>
    <div class="knob-dial" tabindex="0" role="slider" aria-label="${label}"
         aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${val}">
      <svg viewBox="0 0 56 56">
        <defs>
          <radialGradient id="kc${uid}" cx="34%" cy="28%" r="78%">
            <stop offset="0%" stop-color="#2A3245"/>
            <stop offset="55%" stop-color="#0F131C"/>
            <stop offset="100%" stop-color="#05070C"/>
          </radialGradient>
          <radialGradient id="kh${uid}" cx="38%" cy="22%" r="60%">
            <stop offset="0%" stop-color="rgba(255,255,255,.45)"/>
            <stop offset="55%" stop-color="rgba(255,255,255,.05)"/>
            <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
          </radialGradient>
          <radialGradient id="kr${uid}" cx="50%" cy="50%" r="50%">
            <stop offset="80%" stop-color="rgba(0,0,0,0)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,.55)"/>
          </radialGradient>
        </defs>
        <!-- outer rim shadow -->
        <circle cx="28" cy="28" r="24" fill="url(#kr${uid})"/>
        <!-- ticks -->
        <path class="knob-tick" d="${tickPath(KNOB_A0, 23, 25.5)} ${tickPath(KNOB_A0 + KNOB_SWEEP, 23, 25.5)}${bipolar ? ' ' + tickPath(centerAng, 23, 25.5) : ''}"/>
        <!-- arc track -->
        <path class="knob-track" d="${knobArc(cx, cy, r, KNOB_A0, KNOB_A0 + KNOB_SWEEP)}"/>
        <!-- arc fill -->
        <path class="knob-fill" d=""/>
        <!-- cap -->
        <circle class="knob-cap" cx="28" cy="28" r="15.5" fill="url(#kc${uid})"/>
        <!-- glossy highlight -->
        <circle class="knob-cap-hi" cx="28" cy="28" r="15.5" fill="url(#kh${uid})"/>
        <!-- pointer -->
        <line class="knob-pointer" x1="28" y1="28" x2="28" y2="10"/>
      </svg>
    </div>
    <div class="knob-val">${formatValue(val, unit)}</div>`;

  const dial = wrap.querySelector('.knob-dial');
  const fill = wrap.querySelector('.knob-fill');
  const pointer = wrap.querySelector('.knob-pointer');
  const readout = wrap.querySelector('.knob-val');

  const decimals = step < 1 ? (step < 0.01 ? 3 : (String(step).split('.')[1] || '').length || 2) : 0;
  const snap = (v) => {
    const snapped = Math.round((v - min) / step) * step + min;
    return clamp(Number(snapped.toFixed(decimals + 2)), min, max);
  };

  function paint() {
    const a = ang(val);
    fill.setAttribute('d', a === centerAng ? '' : knobArc(cx, cy, r, centerAng, a));
    const [px, py] = knobPolar(cx, cy, 17, a);
    const [bx, by] = knobPolar(cx, cy, 5, a);
    pointer.setAttribute('x1', bx.toFixed(2)); pointer.setAttribute('y1', by.toFixed(2));
    pointer.setAttribute('x2', px.toFixed(2)); pointer.setAttribute('y2', py.toFixed(2));
    readout.textContent = formatValue(val, unit);
    dial.setAttribute('aria-valuenow', val);
  }
  async function commit(next) {
    const clamped = snap(next);
    if (clamped === val) { paint(); return; }
    val = clamped;
    paint();
    await onInput(val).catch(console.error);
  }
  paint();

  // Drag (vertical). Range mapped over ~190px; Shift = quarter sensitivity.
  let dragging = null;
  dial.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dial.setPointerCapture(e.pointerId);
    dial.classList.add('dragging');
    dragging = { y: e.clientY, start: val };
  });
  dial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = dragging.y - e.clientY;
    const fine = e.shiftKey ? 0.25 : 1;
    const delta = (dy / 190) * (max - min) * fine;
    commit(dragging.start + delta);
  });
  const stopDrag = (e) => {
    if (!dragging) return;
    dragging = null;
    dial.classList.remove('dragging');
    try { dial.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  dial.addEventListener('pointerup', stopDrag);
  dial.addEventListener('pointercancel', stopDrag);

  dial.addEventListener('dblclick', () => commit(resetValue));
  dial.addEventListener('wheel', (e) => {
    e.preventDefault();
    const fine = e.shiftKey ? 1 : 4;
    commit(val + (e.deltaY < 0 ? 1 : -1) * step * fine);
  }, { passive: false });
  dial.addEventListener('keydown', (e) => {
    const big = (max - min) / 20;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); commit(val + (e.shiftKey ? big : step)); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); commit(val - (e.shiftKey ? big : step)); }
  });

  return wrap;
}

const COMP_DB_MIN = -60;
const compState = { live: COMP_DB_MIN, target: COMP_DB_MIN };

// Soft-knee transfer: input dB → output dB (no makeup, like a Pro-C knee display).
function compTransfer(c, inputDb) {
  if (!c.enabled || c.ratio <= 1) return inputDb;
  const over = inputDb - c.threshold;
  const knee = Math.max(0.0001, c.knee);
  if (2 * over < -knee) return inputDb;
  if (2 * over > knee) return c.threshold + over / c.ratio;
  const x = over + knee / 2;
  return inputDb + ((1 / c.ratio - 1) * x * x) / (2 * knee);
}

function drawCompressorCurve() {
  if (!state) return;
  const canvas = ui.compressorCanvas;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const c = state.compressor;
  const accent = c.enabled ? '#7FE6A6' : '#5A6377';
  const span = -COMP_DB_MIN;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#070A11';
  roundRect(context, 0, 0, width, height, 13);
  context.fill();

  const pad = 26;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const X = (db) => pad + ((db - COMP_DB_MIN) / span) * w;
  const Y = (db) => pad + h - ((db - COMP_DB_MIN) / span) * h;

  // dB grid + labels (shared scale on both axes)
  context.font = '9px "Sometype Mono", ui-monospace, monospace';
  context.textBaseline = 'middle';
  for (let db = COMP_DB_MIN; db <= 0; db += 12) {
    const gx = X(db), gy = Y(db);
    context.strokeStyle = db === 0 ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.05)';
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(gx, pad); context.lineTo(gx, pad + h); context.stroke();
    context.beginPath(); context.moveTo(pad, gy); context.lineTo(pad + w, gy); context.stroke();
    context.fillStyle = 'rgba(124,133,155,.55)';
    context.textAlign = 'left';
    if (db > COMP_DB_MIN) context.fillText(`${db}`, gx + 3, pad + 7);
  }

  // Unity reference (1:1)
  context.strokeStyle = 'rgba(255,255,255,.10)';
  context.setLineDash([4, 5]); context.lineWidth = 1;
  context.beginPath(); context.moveTo(X(COMP_DB_MIN), Y(COMP_DB_MIN)); context.lineTo(X(0), Y(0)); context.stroke();
  context.setLineDash([]);

  // Threshold guides
  if (c.enabled) {
    context.strokeStyle = 'rgba(127,230,166,.30)';
    context.setLineDash([5, 5]); context.lineWidth = 1;
    context.beginPath(); context.moveTo(X(c.threshold), pad); context.lineTo(X(c.threshold), pad + h); context.stroke();
    context.beginPath(); context.moveTo(pad, Y(c.threshold)); context.lineTo(pad + w, Y(c.threshold)); context.stroke();
    context.setLineDash([]);
  }

  // Transfer curve
  const pts = [];
  for (let i = 0; i <= 160; i += 1) {
    const inDb = COMP_DB_MIN + (i / 160) * span;
    pts.push([X(inDb), Y(compTransfer(c, inDb)), inDb]);
  }
  // soft glow under curve
  if (c.enabled) {
    const grad = context.createLinearGradient(0, pad, 0, pad + h);
    grad.addColorStop(0, 'rgba(127,230,166,.16)');
    grad.addColorStop(1, 'rgba(127,230,166,0)');
    context.beginPath();
    context.moveTo(pts[0][0], pad + h);
    pts.forEach(([x, y]) => context.lineTo(x, y));
    context.lineTo(pts[pts.length - 1][0], pad + h);
    context.closePath();
    context.fillStyle = grad; context.fill();
  }
  context.beginPath();
  pts.forEach(([x, y], i) => (i ? context.lineTo(x, y) : context.moveTo(x, y)));
  context.strokeStyle = accent; context.lineWidth = 2.4;
  context.lineJoin = 'round';
  if (c.enabled) { context.shadowColor = 'rgba(127,230,166,.5)'; context.shadowBlur = 8; }
  context.stroke();
  context.shadowBlur = 0;

  // Live input → output dot (lit segment, like the white→green Pro-C curve)
  if (state.active && c.enabled && compState.live > COMP_DB_MIN + 0.5) {
    const inDb = clamp(compState.live, COMP_DB_MIN, 0);
    context.beginPath();
    for (let i = 0; i <= 120; i += 1) {
      const d = COMP_DB_MIN + (i / 120) * (inDb - COMP_DB_MIN);
      const x = X(d), y = Y(compTransfer(c, d));
      i ? context.lineTo(x, y) : context.moveTo(x, y);
    }
    context.strokeStyle = '#B6FFD6'; context.lineWidth = 2.6;
    context.shadowColor = 'rgba(127,230,166,.7)'; context.shadowBlur = 10;
    context.stroke(); context.shadowBlur = 0;

    const dx = X(inDb), dy = Y(compTransfer(c, inDb));
    context.beginPath(); context.arc(dx, dy, 4.5, 0, Math.PI * 2);
    context.fillStyle = '#DBFFEC';
    context.shadowColor = '#7FE6A6'; context.shadowBlur = 12; context.fill(); context.shadowBlur = 0;
  }
}

let _compLoop = null;
let _lastCompFrame = 0;
function startCompLoop() {
  if (_compLoop) return;
  const tick = (ts) => {
    if (document.hidden) {
      _compLoop = requestAnimationFrame(tick);
      return;
    }
    if (!(_lastCompFrame) || ts - _lastCompFrame >= VISUAL_FRAME_MS) {
      const diff = compState.target - compState.live;
      if (Math.abs(diff) > 0.05) {
        compState.live += diff * 0.16;
        if (state?.compressor?.enabled) drawCompressorCurve();
      }
      _lastCompFrame = ts;
    }
    _compLoop = requestAnimationFrame(tick);
  };
  _compLoop = requestAnimationFrame(tick);
}

function onPointerDown(event) {
  if (event.button === 2) return;
  hideCtx();
  const p = pointerPos(event);
  const b = hitNode(p);
  if (!b) {
    if (selectedId !== null) {
      selectedId = null;
      renderAll();
      hideReadout();
    }
    return;
  }
  if (event.altKey) {
    b.bypass = !(b.bypass || b.enabled === false);
    b.enabled = !b.bypass;
    selectedId = b.id;
    renderAll();
    commitAndSend();
    return;
  }
  selectedId = b.id;
  drag = {
    id: b.id,
    mode: event.ctrlKey || event.metaKey ? 'q' : 'move',
    vx: freqToX(b.frequency),
    vy: nodeY(b),
    lx: p.x,
    ly: p.y,
    moved: false,
    axisLock: null
  };
  svg.setPointerCapture(event.pointerId);
  renderNodes();
  showReadout(b);
  event.preventDefault();
}

function onPointerMove(event) {
  const p = pointerPos(event);
  if (!drag) {
    const b = hitNode(p);
    svg.style.cursor = b ? 'grab' : 'crosshair';
    if (b) showReadout(b); else if (selectedId === null) hideReadout();
    return;
  }
  const b = getBand(drag.id);
  if (!b) return;
  const fine = event.shiftKey ? 0.2 : 1;
  const dxp = (p.x - drag.lx) * fine;
  const dyp = (p.y - drag.ly) * fine;
  drag.lx = p.x;
  drag.ly = p.y;
  if (Math.abs(p.x - drag.vx) > DRAG_THRESH || Math.abs(p.y - drag.vy) > DRAG_THRESH) drag.moved = true;
  if (drag.mode === 'q') {
    if (isCutType(b.type)) {
      drag._acc = (drag._acc || 0) + (-dyp);
      if (Math.abs(drag._acc) > 26) {
        stepSlope(b, drag._acc > 0 ? 1 : -1);
        drag._acc = 0;
      }
    } else {
      b.q = clamp(b.q * Math.pow(1.012, -dyp), Q_MIN, Q_MAX);
    }
  } else {
    if (event.altKey && !drag.axisLock) drag.axisLock = Math.abs(p.x - drag.vx) >= Math.abs(p.y - drag.vy) ? 'x' : 'y';
    if (!(event.altKey && drag.axisLock === 'y')) {
      drag.vx = clamp(drag.vx + dxp, PL, PL + plotW);
      b.frequency = clamp(xToFreq(drag.vx), F_MIN, F_MAX);
    }
    if (!isCutType(b.type) && !(event.altKey && drag.axisLock === 'x')) {
      drag.vy += dyp;
      b.gain = clamp(yToGain(drag.vy), -dbRange, dbRange);
    }
  }
  renderCurve();
  renderNodes();
  renderInspector();
  showReadout(b);
  scheduleEngineUpdate();
  event.preventDefault();
}

function endDrag(event) {
  if (!drag) return;
  try { svg.releasePointerCapture(event.pointerId); } catch {}
  if (drag.moved) commitAndSend();
  drag = null;
}

function onDoubleClick(event) {
  const p = pointerPos(event);
  const b = hitNode(p);
  if (b) {
    deleteBand(b.id);
    hideReadout();
  } else {
    addBand(xToFreq(p.x), yToGain(p.y));
  }
  renderAll();
  commitAndSend();
}

function onWheel(event) {
  const p = pointerPos(event);
  const b = drag ? getBand(drag.id) : hitNode(p);
  if (!b) return;
  event.preventDefault();
  if (isCutType(b.type)) {
    stepSlope(b, event.deltaY < 0 ? 1 : -1);
  } else {
    const fine = event.shiftKey ? 0.5 : 1;
    const factor = event.deltaY < 0 ? (1 + 0.08 * fine) : (1 - 0.08 * fine);
    b.q = clamp(b.q * factor, Q_MIN, Q_MAX);
  }
  renderCurve();
  renderNodes();
  renderInspector();
  showReadout(b);
  clearTimeout(svg._wheelCommit);
  svg._wheelCommit = setTimeout(commitAndSend, 220);
}

function onContextMenu(event) {
  event.preventDefault();
  const p = pointerPos(event);
  const b = hitNode(p);
  if (!b) {
    hideCtx();
    return;
  }
  selectedId = b.id;
  renderNodes();
  renderInspector();
  openCtx(b, p.x, p.y);
}

function openCtx(b, x, y) {
  let html = '';
  html += `<button data-act="bypass">${b.bypass || b.enabled === false ? 'Enable band' : 'Bypass band'}<span class="kbd">Alt-click</span></button>`;
  html += '<div class="ctx-sep"></div>';
  for (const t of TYPES) html += `<button data-type="${t.id}">${t.label}${b.type === t.id ? ' <span class="kbd">●</span>' : ''}</button>`;
  html += '<div class="ctx-sep"></div>';
  html += '<button class="danger" data-act="delete">Delete band<span class="kbd">dbl-click</span></button>';
  ctxMenu.innerHTML = html;
  ctxMenu.style.display = 'flex';
  const cw = ctxMenu.offsetWidth;
  const ch = ctxMenu.offsetHeight;
  ctxMenu.style.left = `${Math.min(x, W - cw - 6)}px`;
  ctxMenu.style.top = `${Math.min(y, svg.clientHeight - ch - 6)}px`;
  ctxMenu.onclick = (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.type) setType(b, button.dataset.type);
    else if (button.dataset.act === 'bypass') {
      b.bypass = !(b.bypass || b.enabled === false);
      b.enabled = !b.bypass;
    } else if (button.dataset.act === 'delete') deleteBand(b.id);
    renderAll();
    commitAndSend();
    hideCtx();
  };
}

function hideCtx() { ctxMenu.style.display = 'none'; }

function addBand(freq, gain) {
  const type = autoType(freq);
  const b = {
    id: `band-${Date.now()}-${nextId++}`,
    label: TYPES.find((t) => t.id === type)?.label || 'Band',
    type,
    frequency: clamp(freq, F_MIN, F_MAX),
    gain: isCutType(type) ? 0 : clamp(gain, -dbRange, dbRange),
    q: 1.0,
    slope: isCutType(type) ? 24 : 12,
    enabled: true,
    bypass: false,
    color: BAND_COLORS[colorIdx++ % BAND_COLORS.length]
  };
  bands.push(b);
  selectedId = b.id;
  return b;
}

function deleteBand(id) {
  bands = bands.filter((b) => b.id !== id);
  if (selectedId === id) selectedId = bands[0]?.id || null;
}

function setType(b, newType) {
  b.type = newType;
  b.label = TYPES.find((t) => t.id === newType)?.label || b.label;
  if (isCutType(newType)) {
    b.gain = 0;
    b.slope = b.slope || 24;
  }
}

function applyField(b, key, raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (key === 'frequency') {
    const parsed = value.endsWith('k') ? parseFloat(value) * 1000 : parseFloat(value);
    if (Number.isFinite(parsed)) b.frequency = clamp(parsed, F_MIN, F_MAX);
  } else if (key === 'gain') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) b.gain = clamp(parsed, -dbRange, dbRange);
  } else if (key === 'q') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) b.q = clamp(parsed, Q_MIN, Q_MAX);
  }
}

function toggleAB() {
  const currentSlot = activeABSlot === 'B' ? 'B' : 'A';
  const nextSlot = currentSlot === 'A' ? 'B' : 'A';
  const current = snapshotAudioOnly();
  abSlots[currentSlot] = current;
  if (abSlots[nextSlot] === null) {
    abSlots[nextSlot] = current;
  }
  activeABSlot = nextSlot;
  restoreAudioOnly(abSlots[nextSlot]);
  renderABButton();
  renderAll();
}

function snapshot() {
  return JSON.stringify({ bands: serializeBands(), selectedId, bypassAll });
}

function snapshotAudioOnly() {
  const { outputDeviceId, outputDeviceLabel, outputRouteStatus, ...sonicOutput } = state.output || {};
  return JSON.stringify({
    eqEnabled: state.eqEnabled !== false,
    eq: serializeBands(),
    compressor: state.compressor,
    output: sonicOutput,
    color: state.color,
    width: state.width
  });
}

function restoreAudioOnly(serialized) {
  const data = JSON.parse(serialized);
  clearModulePresetSelections();
  markMasterPresetCustom();
  state.compressor = data.compressor || state.compressor;
  state.output = {
    ...state.output,
    ...(data.output || {}),
    outputDeviceId: state.output?.outputDeviceId || 'default',
    outputDeviceLabel: state.output?.outputDeviceLabel || 'System Default',
    outputRouteStatus: state.output?.outputRouteStatus || 'default'
  };
  state.color = data.color || state.color;
  state.width = data.width || state.width;
  state.eqEnabled = data.eqEnabled !== false;
  bypassAll = Boolean(state.output?.bypass);
  loadBandsFromState(data.eq || bands, false);
  updateEngineState({
    eqEnabled: state.eqEnabled !== false,
    eq: serializeBands(),
    compressor: state.compressor,
    output: state.output,
    color: state.color,
    width: state.width
  }).catch(console.error);
  renderCompressorControls();
  renderColorControls();
  renderWidthControls();
  renderOutputControls();
  renderTopbarOutputDevice();
  syncMasterBypassButton(bypassAll);
  document.querySelector('.app')?.classList.toggle('master-bypassed', bypassAll);
  updateRackState();
  drawCompressorCurve();
}

function commit() {
  const s = snapshot();
  if (s === lastCommitted) return;
  if (lastCommitted !== null) undoStack.push(lastCommitted);
  if (undoStack.length > 80) undoStack.shift();
  lastCommitted = s;
  redoStack = [];
  updateHistoryButtons();
}

function commitAndSend() {
  markModulePresetCustom('eq');
  commit();
  scheduleEngineUpdate(0);
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(lastCommitted);
  lastCommitted = undoStack.pop();
  restoreSnapshot(lastCommitted);
  renderAll();
  updateHistoryButtons();
  hideReadout();
  scheduleEngineUpdate(0);
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastCommitted);
  lastCommitted = redoStack.pop();
  restoreSnapshot(lastCommitted);
  renderAll();
  updateHistoryButtons();
  hideReadout();
  scheduleEngineUpdate(0);
}

function restoreSnapshot(serialized) {
  const parsed = JSON.parse(serialized);
  loadBandsFromState(parsed.bands, false);
  selectedId = parsed.selectedId;
  bypassAll = parsed.bypassAll;
  state.output = { ...state.output, bypass: bypassAll };
}

function updateHistoryButtons() {
  ui.btnUndo.disabled = !undoStack.length;
  ui.btnRedo.disabled = !redoStack.length;
}

let updateTimer = null;
function scheduleEngineUpdate(delay = 70) {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    if (!state) return;
    const eq = serializeBands();
    state.eq = eq;
    updateEngineState({ eq, output: { bypass: bypassAll } }).catch(console.error);
  }, delay);
}

function serializeBands() {
  return bands.map(({ color, bypass, ...band }) => ({ ...band, enabled: band.enabled !== false && !bypass }));
}

function pointerPos(event) {
  const rect = svg.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function hitNode(p) {
  let best = null;
  let bestD = 14 * 14;
  for (let i = bands.length - 1; i >= 0; i -= 1) {
    const b = bands[i];
    const dx = p.x - freqToX(b.frequency);
    const dy = p.y - nodeY(b);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

function showReadout(b) {
  const x = freqToX(b.frequency);
  const y = nodeY(b);
  let rows = `<div class="r-row"><span class="r-k">FREQ</span><span class="r-v">${fmtFreq(b.frequency)}</span></div>`;
  if (isCutType(b.type)) rows += `<div class="r-row"><span class="r-k">SLOPE</span><span class="r-v">${b.slope} dB/oct</span></div>`;
  else {
    rows += `<div class="r-row"><span class="r-k">GAIN</span><span class="r-v">${fmtGain(b.gain)}</span></div>`;
    rows += `<div class="r-row"><span class="r-k">Q</span><span class="r-v">${b.q.toFixed(2)}</span></div>`;
  }
  readout.innerHTML = rows;
  readout.style.left = `${x}px`;
  readout.style.top = `${y}px`;
  readout.style.display = 'flex';
}
function hideReadout() { readout.style.display = 'none'; }
function getBand(id) { return bands.find((b) => b.id === id); }
function nodeY(b) { return isCutType(b.type) ? gainToY(bandDb(b, b.frequency)) : gainToY(b.gain); }
function autoType(freq) {
  if (freq < 45) return 'lowcut';
  if (freq > 14000) return 'highcut';
  if (freq < 90) return 'lowshelf';
  if (freq > 9000) return 'highshelf';
  return 'bell';
}
function stepSlope(b, direction) {
  let index = SLOPES.indexOf(b.slope);
  if (index < 0) index = 1;
  b.slope = SLOPES[clamp(index + direction, 0, SLOPES.length - 1)];
}

function startMeterPolling() {
  clearInterval(pollingTimer);
  pollingTimer = setInterval(async () => {
    if (document.hidden) return;
    const response = await sendMessage({ target: 'offscreen', type: 'GET_ANALYSIS_FRAME' }).catch(() => null);
    if (!response?.ok) return;
    lastMeterPayload = response.frame || null;
    rtaFrame = normalizeRtaFrame(response.frame?.spectrum);
    if (response.frame?.state) {
      state = { ...state, ...response.frame.state, eqEnabled: response.frame.state.eqEnabled !== false };
      bypassAll = Boolean(state.output?.bypass);
      renderChromeState();
    }
    updateMeters(response.frame?.meters || {});
  }, METER_POLL_MS);
}

function updateMeters(meters) {
  const inputPeak = meters.inputPeak || 0;
  const outputPeak = meters.outputPeak || 0;
  if (ui.inputMeter) ui.inputMeter.value = inputPeak;
  if (ui.outputMeter) ui.outputMeter.value = outputPeak;

  const inputLeft = Number.isFinite(meters.inputPeakLeft) ? meters.inputPeakLeft : inputPeak;
  const inputRight = Number.isFinite(meters.inputPeakRight) ? meters.inputPeakRight : inputPeak;
  const outputLeft = Number.isFinite(meters.outputPeakLeft) ? meters.outputPeakLeft : outputPeak;
  const outputRight = Number.isFinite(meters.outputPeakRight) ? meters.outputPeakRight : outputPeak;
  displayedInputLeft = smoothPeak(displayedInputLeft, inputLeft);
  displayedInputRight = smoothPeak(displayedInputRight, inputRight);
  displayedOutputLeft = smoothPeak(displayedOutputLeft, outputLeft);
  displayedOutputRight = smoothPeak(displayedOutputRight, outputRight);
  setVerticalMeter(ui.inputMeterLeft, displayedInputLeft);
  setVerticalMeter(ui.inputMeterRight, displayedInputRight);
  setVerticalMeter(ui.outputMeterLeft, displayedOutputLeft);
  setVerticalMeter(ui.outputMeterRight, displayedOutputRight);
  setMeterValue(ui.limiterInputMeterLeft, displayedInputLeft);
  setMeterValue(ui.limiterInputMeterRight, displayedInputRight);
  setMeterValue(ui.limiterOutputMeterLeft, displayedOutputLeft);
  setMeterValue(ui.limiterOutputMeterRight, displayedOutputRight);
  if (ui.inputMeterReadout) ui.inputMeterReadout.textContent = formatPeakDb(Math.max(displayedInputLeft, displayedInputRight));
  if (ui.outputMeterReadout) ui.outputMeterReadout.textContent = formatPeakDb(Math.max(displayedOutputLeft, displayedOutputRight));

  const peak = Math.max(1e-4, Number(inputPeak) || 0);
  compState.target = clamp(20 * Math.log10(peak), COMP_DB_MIN, 0);

  const rawCompressorReduction = Number.isFinite(meters.compressorGainReduction)
    ? meters.compressorGainReduction
    : (Number.isFinite(meters.gainReduction) ? meters.gainReduction : 0);
  const compressorReduction = clamp(rawCompressorReduction, 0, 36);
  const compressorReductionLeft = clamp(Number.isFinite(meters.compressorGainReductionLeft) ? meters.compressorGainReductionLeft : compressorReduction, 0, 36);
  const compressorReductionRight = clamp(Number.isFinite(meters.compressorGainReductionRight) ? meters.compressorGainReductionRight : compressorReduction, 0, 36);
  displayedCompressorReduction += (compressorReduction - displayedCompressorReduction) * 0.30;
  displayedCompressorReductionLeft += (compressorReductionLeft - displayedCompressorReductionLeft) * 0.30;
  displayedCompressorReductionRight += (compressorReductionRight - displayedCompressorReductionRight) * 0.30;

  setGainReductionMeter(ui.compressorReductionLeft || ui.gainReductionBar, displayedCompressorReductionLeft);
  setGainReductionMeter(ui.compressorReductionRight, displayedCompressorReductionRight);
  if (ui.compressorReductionValue) {
    ui.compressorReductionValue.textContent = `${Math.max(displayedCompressorReductionLeft, displayedCompressorReductionRight, displayedCompressorReduction).toFixed(1)}`;
    ui.compressorReductionValue.classList.toggle('active', displayedCompressorReduction >= 0.2);
  }

  const limiterReduction = clamp(Number.isFinite(meters.limiterGainReduction) ? meters.limiterGainReduction : 0, 0, 24);
  displayedLimiterReduction += (limiterReduction - displayedLimiterReduction) * 0.30;
  if (ui.limiterReductionBar) ui.limiterReductionBar.style.transform = `scaleX(${Math.min(1, displayedLimiterReduction / 12)})`;
  if (ui.limiterReductionValue) {
    ui.limiterReductionValue.textContent = `${displayedLimiterReduction.toFixed(1)} dB`;
    ui.limiterReductionValue.classList.toggle('active', displayedLimiterReduction >= 0.2);
  }

  const targetCorrelation = Number.isFinite(meters.correlation) ? clamp(meters.correlation, -1, 1) : 1;
  displayedCorrelation += (targetCorrelation - displayedCorrelation) * 0.22;
  if (ui.correlationValue) {
    ui.correlationValue.textContent = `${displayedCorrelation >= 0 ? '+' : ''}${displayedCorrelation.toFixed(2)}`;
    ui.correlationValue.classList.toggle('danger', displayedCorrelation < 0.05);
  }
  if (ui.correlationBar) {
    const left = ((displayedCorrelation + 1) / 2) * 100;
    ui.correlationBar.style.left = `${left}%`;
  }
  if (ui.smartGainChip) {
    const headroomDb = Number.isFinite(meters.smartHeadroomDb) ? meters.smartHeadroomDb : 0;
    const makeupDb = Number.isFinite(meters.smartMakeupDb) ? meters.smartMakeupDb : 0;
    const netDb = headroomDb + makeupDb;
    const strong = ui.smartGainChip.querySelector('strong');
    if (strong) strong.textContent = `${netDb >= 0 ? '+' : ''}${netDb.toFixed(1)} dB`;
    ui.smartGainChip.title = `Auto headroom ${headroomDb.toFixed(1)} dB · restore +${makeupDb.toFixed(1)} dB`;
  }

  updateStereoBandMeters(meters.stereoBands);

  const limiterWarning = displayedLimiterReduction > 6;
  ui.clipBadge.textContent = meters.clipping || limiterWarning ? 'Clip risk' : 'Clean';
  ui.clipBadge.classList.toggle('danger', Boolean(meters.clipping || limiterWarning));
}


function updateStereoBandMeters(stereoBands = null) {
  const fallbacks = {
    low: { width: 0, correlation: 1 },
    mid: { width: 0, correlation: 1 },
    high: { width: 0, correlation: 1 }
  };
  const next = stereoBands && typeof stereoBands === 'object' ? stereoBands : fallbacks;
  const map = {
    low: [ui.widthBandLowFill, ui.widthBandLowValue, ui.widthBandLowCorrelation, ui.widthBandLowCorrelationBar],
    mid: [ui.widthBandMidFill, ui.widthBandMidValue, ui.widthBandMidCorrelation, ui.widthBandMidCorrelationBar],
    high: [ui.widthBandHighFill, ui.widthBandHighValue, ui.widthBandHighCorrelation, ui.widthBandHighCorrelationBar]
  };
  for (const band of ['low', 'mid', 'high']) {
    const incoming = next[band] || fallbacks[band];
    const prev = displayedStereoBands[band] || fallbacks[band];
    const width = clamp(Number(incoming.width) || 0, 0, 200);
    const corr = clamp(Number.isFinite(incoming.correlation) ? incoming.correlation : 1, -1, 1);
    displayedStereoBands[band] = {
      width: prev.width + (width - prev.width) * 0.18,
      correlation: prev.correlation + (corr - prev.correlation) * 0.16
    };
    const [fillEl, valueEl, corrEl, corrBarEl] = map[band];
    if (fillEl) {
      const half = Math.min(50, displayedStereoBands[band].width / 4);
      fillEl.style.width = `${half}%`;
      fillEl.style.transform = `translateX(${-half}%)`;
      fillEl.style.opacity = `${0.36 + Math.min(0.64, displayedStereoBands[band].width / 200)}`;
    }
    if (valueEl) valueEl.textContent = `${Math.round(displayedStereoBands[band].width)}%`;
    if (corrEl) {
      corrEl.textContent = `${displayedStereoBands[band].correlation >= 0 ? '+' : ''}${displayedStereoBands[band].correlation.toFixed(2)}`;
      corrEl.classList.toggle('danger', displayedStereoBands[band].correlation < 0.05);
    }
    if (corrBarEl) {
      corrBarEl.style.left = `${((displayedStereoBands[band].correlation + 1) / 2) * 100}%`;
    }
  }
}

function smoothPeak(previous, next) {
  const target = clamp(Number(next) || 0, 0, 1);
  const alpha = target > previous ? PEAK_ATTACK_ALPHA : PEAK_RELEASE_ALPHA;
  return previous + (target - previous) * alpha;
}

function setMeterValue(element, peak) {
  if (!element) return;
  element.value = clamp(Number(peak) || 0, 0, 1);
}

function setVerticalMeter(element, peak) {
  if (!element) return;
  element.style.transform = `scaleY(${peakToMeterScale(peak)})`;
  element.classList.toggle('hot', peakToDb(peak) > -6);
  element.classList.toggle('clip', peak >= 0.98);
}

function setGainReductionMeter(element, reductionDb) {
  if (!element) return;
  element.style.transform = `scaleY(${Math.min(1, clamp(reductionDb, 0, 24) / 18)})`;
}

function peakToMeterScale(peak) {
  const db = peakToDb(peak);
  return clamp((db + 60) / 60, 0.025, 1);
}

function peakToDb(peak) {
  return 20 * Math.log10(Math.max(1e-5, Number(peak) || 0));
}

function formatPeakDb(peak) {
  const db = peakToDb(peak);
  return db <= -59.5 ? '-inf' : `${db.toFixed(0)} dB`;
}

const SPEC_N = 120;
const RTA_VISUAL_FLOOR_DB = -90;
const RTA_VISUAL_CEIL_DB = 6;
const RTA_TARGET_ATTACK_MS = 170;
const RTA_TARGET_RELEASE_MS = 520;
const RTA_VALUE_ATTACK_MS = 78;
const RTA_VALUE_RELEASE_MS = 620;
const RTA_IDLE_ATTACK_MS = 170;
const RTA_IDLE_RELEASE_MS = 860;
const RTA_SHAPE_SMOOTH_PASSES = 3;
const RTA_SHAPE_RAW_BLEND = 0.18;
const RTA_CURVE_TENSION = 0.82;
const specFreqs = new Float32Array(SPEC_N);
const specInVal = new Float32Array(SPEC_N);
const specOutVal = new Float32Array(SPEC_N);
const specInGoal = new Float32Array(SPEC_N);
const specOutGoal = new Float32Array(SPEC_N);
const specInTarget = new Float32Array(SPEC_N);
const specOutTarget = new Float32Array(SPEC_N);
const specInRawTarget = new Float32Array(SPEC_N);
const specOutRawTarget = new Float32Array(SPEC_N);
const specSmoothA = new Float32Array(SPEC_N);
const specSmoothB = new Float32Array(SPEC_N);
let lastSpectrumTickMs = 0;
let lastSpectrumRenderMs = 0;
let lastRtaTargetKey = '';
for (let i = 0; i < SPEC_N; i += 1) {
  const t = i / (SPEC_N - 1);
  specFreqs[i] = Math.pow(10, logFmin + t * logFspan);
  specInVal[i] = -72;
  specOutVal[i] = -72;
  specInGoal[i] = -72;
  specOutGoal[i] = -72;
  specInTarget[i] = -72;
  specOutTarget[i] = -72;
}

function tickSpectrum(ts) {
  if (document.hidden) {
    requestAnimationFrame(tickSpectrum);
    return;
  }
  if (lastSpectrumRenderMs && ts - lastSpectrumRenderMs < SPECTRUM_FRAME_MS) {
    requestAnimationFrame(tickSpectrum);
    return;
  }
  lastSpectrumRenderMs = ts;
  if (!layers.specIn) {
    requestAnimationFrame(tickSpectrum);
    return;
  }

  const previousTs = lastSpectrumTickMs || ts;
  const deltaMs = clamp(ts - previousTs, 12, 80);
  lastSpectrumTickMs = ts;

  const hasLive = Boolean(state?.active && rtaFrame?.input?.length);
  if (hasLive) {
    const outputPoints = rtaFrame.output?.length ? rtaFrame.output : null;
    const targetKey = `${rtaFrame.updatedAt || 0}|${rtaFrame.input?.length || 0}|${rtaFrame.output?.length || 0}|${isEqActive() ? 1 : 0}`;
    if (targetKey !== lastRtaTargetKey) {
      resampleSpectrumDb(rtaFrame.input, specInRawTarget);
      if (outputPoints) {
        resampleSpectrumDb(outputPoints, specOutRawTarget);
      } else {
        for (let i = 0; i < SPEC_N; i += 1) {
          const f = specFreqs[i];
          specOutRawTarget[i] = specInRawTarget[i] + (isEqActive() ? totalDb(f) : 0);
        }
      }
      shapeSpectrumTarget(specInRawTarget, specInGoal);
      shapeSpectrumTarget(specOutRawTarget, specOutGoal);
      lastRtaTargetKey = targetKey;
    }
  } else {
    lastRtaTargetKey = '';
    for (let i = 0; i < SPEC_N; i += 1) {
      const f = specFreqs[i];
      const simulated = baseLevel(f) + 2.2 * Math.sin(ts / 520 + i * 0.5) + 1.2 * Math.sin(ts / 230 + i * 1.7);
      specInRawTarget[i] = simulated;
      specOutRawTarget[i] = simulated + (isEqActive() ? totalDb(f) : 0);
    }
    shapeSpectrumTarget(specInRawTarget, specInGoal);
    shapeSpectrumTarget(specOutRawTarget, specOutGoal);
  }

  for (let i = 0; i < SPEC_N; i += 1) {
    specInTarget[i] = smoothDbVisual(
      specInTarget[i],
      specInGoal[i],
      deltaMs,
      hasLive ? RTA_TARGET_ATTACK_MS : RTA_IDLE_ATTACK_MS,
      hasLive ? RTA_TARGET_RELEASE_MS : RTA_IDLE_RELEASE_MS
    );
    specOutTarget[i] = smoothDbVisual(
      specOutTarget[i],
      specOutGoal[i],
      deltaMs,
      hasLive ? RTA_TARGET_ATTACK_MS : RTA_IDLE_ATTACK_MS,
      hasLive ? RTA_TARGET_RELEASE_MS : RTA_IDLE_RELEASE_MS
    );
    specInVal[i] = smoothDbVisual(
      specInVal[i],
      specInTarget[i],
      deltaMs,
      hasLive ? RTA_VALUE_ATTACK_MS : RTA_IDLE_ATTACK_MS,
      hasLive ? RTA_VALUE_RELEASE_MS : RTA_IDLE_RELEASE_MS
    );
    specOutVal[i] = smoothDbVisual(
      specOutVal[i],
      specOutTarget[i],
      deltaMs,
      hasLive ? RTA_VALUE_ATTACK_MS : RTA_IDLE_ATTACK_MS,
      hasLive ? RTA_VALUE_RELEASE_MS : RTA_IDLE_RELEASE_MS
    );
  }

  renderRoundedSpectrumPaths();
  requestAnimationFrame(tickSpectrum);
}

function resampleSpectrumDb(points, target) {
  if (!points?.length) {
    target.fill(RTA_VISUAL_FLOOR_DB);
    return;
  }
  let cursor = 1;
  const lastIndex = points.length - 1;
  for (let i = 0; i < SPEC_N; i += 1) {
    const freq = specFreqs[i];
    if (freq <= points[0].freq) {
      target[i] = finiteSpectrumDb(points[0].db);
      continue;
    }
    if (freq >= points[lastIndex].freq) {
      target[i] = finiteSpectrumDb(points[lastIndex].db);
      continue;
    }
    while (cursor < lastIndex && points[cursor].freq < freq) cursor += 1;
    const prev = points[cursor - 1];
    const next = points[cursor];
    const span = Math.log(next.freq) - Math.log(prev.freq);
    const ratio = span > 0 ? clamp((Math.log(freq) - Math.log(prev.freq)) / span, 0, 1) : 0;
    target[i] = finiteSpectrumDb(prev.db + (next.db - prev.db) * ratio);
  }
}

function shapeSpectrumTarget(source, target) {
  specSmoothA.set(source);
  for (let pass = 0; pass < RTA_SHAPE_SMOOTH_PASSES; pass += 1) {
    for (let i = 0; i < SPEC_N; i += 1) {
      const a = specSmoothA[Math.max(0, i - 2)];
      const b = specSmoothA[Math.max(0, i - 1)];
      const c = specSmoothA[i];
      const d = specSmoothA[Math.min(SPEC_N - 1, i + 1)];
      const e = specSmoothA[Math.min(SPEC_N - 1, i + 2)];
      specSmoothB[i] = a * 0.07 + b * 0.20 + c * 0.46 + d * 0.20 + e * 0.07;
    }
    specSmoothA.set(specSmoothB);
  }
  for (let i = 0; i < SPEC_N; i += 1) {
    const rounded = specSmoothA[i];
    target[i] = source[i] * RTA_SHAPE_RAW_BLEND + rounded * (1 - RTA_SHAPE_RAW_BLEND);
  }
}

function renderRoundedSpectrumPaths() {
  const toY = (v) => PT + plotH - clamp((v - RTA_VISUAL_FLOOR_DB) / (RTA_VISUAL_CEIL_DB - RTA_VISUAL_FLOOR_DB), 0, 1) * plotH;
  const lineIn = smoothSpectrumLinePath(specInVal, toY);
  const lineOut = smoothSpectrumLinePath(specOutVal, toY);
  const selectedLine = spectrumMode === 'pre' ? lineIn : lineOut;
  layers.specIn.setAttribute('d', `${selectedLine} L ${PL + plotW} ${PT + plotH} L ${PL} ${PT + plotH} Z`);
  layers.specInStroke.setAttribute('d', lineIn);
  layers.specOut.setAttribute('d', lineOut);
  layers.specInStroke.classList.toggle('active', spectrumMode === 'pre');
  layers.specInStroke.classList.toggle('ghost', spectrumMode !== 'pre');
  layers.specOut.classList.toggle('active', spectrumMode === 'post');
  layers.specOut.classList.toggle('ghost', spectrumMode !== 'post');
}

function smoothSpectrumLinePath(values, toY) {
  let d = `M${freqToX(specFreqs[0]).toFixed(1)} ${toY(values[0]).toFixed(1)}`;
  for (let i = 0; i < SPEC_N - 1; i += 1) {
    const x0 = freqToX(specFreqs[i]);
    const y0 = toY(values[i]);
    const x1 = freqToX(specFreqs[i + 1]);
    const y1 = toY(values[i + 1]);
    const xm1 = i > 0 ? freqToX(specFreqs[i - 1]) : x0;
    const ym1 = i > 0 ? toY(values[i - 1]) : y0;
    const x2 = i < SPEC_N - 2 ? freqToX(specFreqs[i + 2]) : x1;
    const y2 = i < SPEC_N - 2 ? toY(values[i + 2]) : y1;
    const cp1x = x0 + (x1 - xm1) * (RTA_CURVE_TENSION / 6);
    const cp1y = y0 + (y1 - ym1) * (RTA_CURVE_TENSION / 6);
    const cp2x = x1 - (x2 - x0) * (RTA_CURVE_TENSION / 6);
    const cp2y = y1 - (y2 - y0) * (RTA_CURVE_TENSION / 6);
    d += ` C${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

function smoothDbVisual(previous, target, deltaMs, attackMs, releaseMs) {
  if (!Number.isFinite(previous)) return Number.isFinite(target) ? target : -90;
  if (!Number.isFinite(target)) return previous;
  const tau = target > previous ? attackMs : releaseMs;
  const alpha = 1 - Math.exp(-Math.max(1, deltaMs) / Math.max(1, tau));
  return previous + (target - previous) * alpha;
}

function normalizeRtaFrame(spectrum) {
  if (!spectrum) return null;
  if (Array.isArray(spectrum)) {
    // Backward compatibility for v0.1.1 byte buckets. New offscreen returns
    // calibrated SFEQ log-frequency points, so this path should rarely run.
    const points = spectrum.map((value, index) => ({
      freq: Math.pow(10, logFmin + (index / Math.max(1, spectrum.length - 1)) * logFspan),
      db: RTA_VISUAL_FLOOR_DB + (Number(value || 0) / 255) * (RTA_VISUAL_CEIL_DB - RTA_VISUAL_FLOOR_DB)
    }));
    return { source: 'legacy-byte-buckets', input: points, output: points };
  }
  return {
    source: spectrum.source || 'sfeq-rta-v79',
    input: Array.isArray(spectrum.input) ? spectrum.input : [],
    output: Array.isArray(spectrum.output) ? spectrum.output : [],
    fftSize: spectrum.fftSize,
    sampleRate: spectrum.sampleRate,
    updatedAt: spectrum.updatedAt || Date.now()
  };
}

function interpolateSpectrumDb(points, freq) {
  if (!points?.length) return -90;
  const safeFreq = Math.max(1, freq);
  if (safeFreq <= points[0].freq) return finiteSpectrumDb(points[0].db);
  const last = points[points.length - 1];
  if (safeFreq >= last.freq) return finiteSpectrumDb(last.db);
  const logFreq = Math.log(safeFreq);
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    if (safeFreq <= next.freq) {
      const span = Math.log(next.freq) - Math.log(prev.freq);
      const ratio = span > 0 ? clamp((logFreq - Math.log(prev.freq)) / span, 0, 1) : 0;
      return finiteSpectrumDb(prev.db + (next.db - prev.db) * ratio);
    }
  }
  return finiteSpectrumDb(last.db);
}

function finiteSpectrumDb(value) {
  return Number.isFinite(value) ? clamp(value, -120, 24) : -90;
}

function baseLevel(f) {
  let level = -6 - 9 * Math.log10(f / 40);
  level += 5 * Math.exp(-Math.pow(Math.log2(f / 180), 2) / 2.2);
  level += 4 * Math.exp(-Math.pow(Math.log2(f / 2200), 2) / 2.0);
  level += 4.2 * Math.log10(f / 200);
  return level;
}

function freqToX(freq) { return PL + (Math.log10(freq) - logFmin) / logFspan * plotW; }
function xToFreq(x) { return Math.pow(10, logFmin + (x - PL) / plotW * logFspan); }
function gainToY(gain) { return PT + (dbRange - gain) / (2 * dbRange) * plotH; }
function yToGain(y) { return dbRange - (y - PT) / plotH * (2 * dbRange); }
function fmtFreq(freq) { return freq >= 1000 ? `${(freq / 1000).toFixed(freq >= 10000 ? 1 : 2)} kHz` : `${Math.round(freq)} Hz`; }
function fmtFreqEditable(freq) { return freq >= 1000 ? `${(freq / 1000).toFixed(2)}k` : String(Math.round(freq)); }
function fmtGain(gain) { return `${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`; }
function formatValue(value, unit) {
  const number = Number(value);
  if (unit === 's') return `${number.toFixed(3)} s`;
  if (unit === '%') return `${number.toFixed(0)}%`;
  if (unit === 'Hz') return `${number.toFixed(0)} Hz`;
  if (unit === ':1') return `${number.toFixed(1)}:1`;
  return `${number.toFixed(1)} ${unit}`;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function selectEditable(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}
function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

init();
