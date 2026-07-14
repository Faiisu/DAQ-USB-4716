/* ── Chart.js Management & Plotting Logic ── */

import { COLOURS, COLOUR_DIMS } from './constants.js';
import * as api from './api.js';
import * as ui from './ui.js';

export let plotChart = null;
export let livePollInterval = null;
let _plotMode = 'live';

const CHART_BASE = {
  animation: false,
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  elements: {
    point: { radius: 0, hoverRadius: 4 },
    line:  { borderWidth: 1.5, tension: 0.25 },
  },
  plugins: {
    legend: {
      position: 'top',
      align: 'end',
      labels: {
        color: '#8a9bc4',
        font: { family: 'Inter', size: 11, weight: '500' },
        boxWidth: 12,
        boxHeight: 2,
        padding: 16,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(8,13,26,0.97)',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      titleColor: '#e2eaf8',
      bodyColor: '#8a9bc4',
      padding: 10,
      callbacks: {
        title: tooltipItems => {
          if (!tooltipItems || !tooltipItems.length) return '';
          const date = new Date(tooltipItems[0].parsed.x);
          const hh = String(date.getHours()).padStart(2, '0');
          const mm = String(date.getMinutes()).padStart(2, '0');
          const ss = String(date.getSeconds()).padStart(2, '0');
          const ms = String(date.getMilliseconds()).padStart(3, '0');
          return `${hh}:${mm}:${ss}.${ms}`;
        },
        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)} V`,
      },
    },
    zoom: {
      pan: {
        enabled: true,
        mode: 'x',
        modifierKey: 'ctrl',
      },
      zoom: {
        wheel: { enabled: true },
        drag: {
          enabled: true,
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderColor: 'rgba(255,255,255,0.3)',
          borderWidth: 1,
        },
        mode: 'x',
      },
    },
  },
  scales: {
    x: {
      type: 'time',
      time: { minUnit: 'millisecond', displayFormats: { millisecond: 'HH:mm:ss.SSS', second: 'HH:mm:ss' } },
      ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 8, source: 'auto' },
      grid:  { color: 'rgba(255,255,255,0.03)', lineWidth: 1 },
      border: { color: 'rgba(255,255,255,0.08)' },
    },
    y: {
      min: 0,
      max: 5,
      title: { display: true, text: 'Voltage (V)', color: '#71717a', font: { size: 10 } },
      ticks: { color: '#71717a', font: { size: 10 }, stepSize: 1 },
      grid:  { color: 'rgba(255,255,255,0.03)', lineWidth: 1 },
      border: { color: 'rgba(255,255,255,0.08)' },
    },
  },
};

export function initPlotChart() {
  const ctx = document.getElementById('plot-chart');
  if (!ctx) return;
  plotChart = new Chart(ctx, {
    type: 'line',
    data: { datasets: [] },
    options: {
      ...CHART_BASE,
      plugins: {
        ...CHART_BASE.plugins,
        tooltip: {
          ...CHART_BASE.plugins.tooltip,
          callbacks: { ...CHART_BASE.plugins.tooltip.callbacks }
        },
        zoom: {
          ...CHART_BASE.plugins.zoom,
          pan: { ...CHART_BASE.plugins.zoom.pan },
          zoom: {
            ...CHART_BASE.plugins.zoom.zoom,
            wheel: { ...CHART_BASE.plugins.zoom.zoom.wheel },
            drag: { ...CHART_BASE.plugins.zoom.zoom.drag }
          }
        }
      },
      scales: {
        ...CHART_BASE.scales,
        x: {
          ...CHART_BASE.scales.x,
          time: { ...CHART_BASE.scales.x.time },
          ticks: { ...CHART_BASE.scales.x.ticks },
          grid: { ...CHART_BASE.scales.x.grid },
          border: { ...CHART_BASE.scales.x.border }
        },
        y: {
          ...CHART_BASE.scales.y,
          title: { ...CHART_BASE.scales.y.title },
          ticks: { ...CHART_BASE.scales.y.ticks },
          grid: { ...CHART_BASE.scales.y.grid },
          border: { ...CHART_BASE.scales.y.border }
        }
      }
    }
  });
}

export function clearChart() {
  if (plotChart) {
    plotChart.data.datasets = [];
    plotChart.update();
  }
  const timerRangeEl = document.getElementById('static-time-range');
  if (timerRangeEl) timerRangeEl.textContent = '';
  ui.hideAlert('static-result-msg');
  ui.hideAlert('live-session-msg');
}

export function togglePlotMode(mode) {
  _plotMode = mode;
  
  const liveControls = document.getElementById('plot-controls-live');
  const historyControls = document.getElementById('plot-controls-history');
  const emptyText = document.getElementById('plot-empty-text');
  const emptyIcon = document.querySelector('#plot-empty .empty-icon');
  
  if (livePollInterval) {
    clearInterval(livePollInterval);
    livePollInterval = null;
    const btn = document.getElementById('btn-toggle-poll');
    if (btn) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Live Session`;
      btn.className = "btn btn-primary";
    }
    const dot = document.getElementById('plot-chart-dot');
    if (dot) dot.style.animation = "none";
    ui.hideAlert('live-session-msg');
  }

  clearChart();

  if (mode === 'live') {
    liveControls?.classList.remove('hidden');
    historyControls?.classList.add('hidden');
    if (emptyText) emptyText.textContent = 'Start live session database polling to view graph';
    if (emptyIcon) emptyIcon.textContent = '📡';
    document.getElementById('plot-empty')?.classList.remove('hidden');
  } else {
    liveControls?.classList.add('hidden');
    historyControls?.classList.remove('hidden');
    if (emptyText) emptyText.textContent = 'Run a query to see historical data';
    if (emptyIcon) emptyIcon.textContent = '🔍';
    document.getElementById('plot-empty')?.classList.remove('hidden');
  }
}

export async function pollDB() {
  const dbTarget = ui.getVal('plot-db-target');
  const dsn      = dbTarget === 'custom' ? (ui.getVal('plot-dsn-override').trim() || null) : null;
  const chStr    = ui.getVal('live-channels').trim();
  const channels = chStr
    ? chStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
    : [];
  const lastSec  = parseFloat(ui.getVal('live-window')) || 15;

  const body = { last_sec: lastSec, channels, db_target: dbTarget };
  if (dsn) body.dsn = dsn;

  try {
    const data = await api.fetchPlotData(body);

    if (!data.ok) {
      ui.showAlert('live-session-msg', `✗ ${data.error}`, 'error');
      return;
    }

    const chKeys = Object.keys(data.data);
    if (!chKeys.length) {
      ui.showAlert('live-session-msg', '⌛ Waiting for new records in TimescaleDB...', 'info');
      document.getElementById('plot-empty')?.classList.remove('hidden');
      return;
    }

    const empty = document.getElementById('plot-empty');
    if (empty) empty.classList.add('hidden');
    ui.hideAlert('live-session-msg');

    const datasets = chKeys.map((ch, i) => ({
      label:           `CH${ch}`,
      data:            data.data[ch].times.map((t, j) => ({ x: new Date(t), y: data.data[ch].values[j] })),
      borderColor:     COLOURS[i % COLOURS.length],
      backgroundColor: COLOUR_DIMS[i % COLOUR_DIMS.length],
      fill:            false,
      pointRadius:     0,
      borderWidth:     1.5,
      tension:         0.15,
    }));

    plotChart.data.datasets = datasets;
    plotChart.options.scales.x.min = new Date(data.start);
    plotChart.options.scales.x.max = new Date(data.end);
    plotChart.update('none');

    const totalRows = chKeys.reduce((sum, ch) => sum + (data.data[ch].times.length || 0), 0);
    const rangeStr  = `${ui.fmtTime(data.start)} → ${ui.fmtTime(data.end)}`;
    const timerRangeEl = document.getElementById('static-time-range');
    if (timerRangeEl) {
      timerRangeEl.textContent = `Live: ${rangeStr} (${totalRows.toLocaleString()} rows)`;
    }

  } catch (e) {
    ui.showAlert('live-session-msg', `✗ Network error: ${e}`, 'error');
  }
}

export function toggleLiveSession() {
  const btn = document.getElementById('btn-toggle-poll');
  const dot = document.getElementById('plot-chart-dot');
  if (!btn) return;

  if (livePollInterval) {
    clearInterval(livePollInterval);
    livePollInterval = null;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Live Session`;
    btn.className = "btn btn-primary";
    if (dot) dot.style.animation = "none";
    ui.showAlert('live-session-msg', 'Live Session paused.', 'info');
    ui.appendLog('Live Session polling paused', 'info');
  } else {
    clearChart();
    pollDB();
    livePollInterval = setInterval(pollDB, 1000);
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Stop Live Session`;
    btn.className = "btn btn-danger";
    if (dot) dot.style.animation = "pulse-glow 2s infinite";
    ui.appendLog('Live Session polling started (1s interval)', 'info');
  }
}

export function clearLiveChart() {
  clearChart();
  const empty = document.getElementById('plot-empty');
  if (empty) empty.classList.remove('hidden');
}

export function resetPlotZoom() {
  if (plotChart) {
    plotChart.resetZoom();
  }
}

export async function runStaticPlot() {
  if (_plotMode !== 'history') return;

  const dbTarget = ui.getVal('plot-db-target');
  const dsn      = dbTarget === 'custom' ? (ui.getVal('plot-dsn-override').trim() || null) : null;
  const chStr    = ui.getVal('static-channels').trim();
  const channels = chStr
    ? chStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
    : [];
  const lastSec  = parseFloat(ui.getVal('static-last')) || 60;
  const startRaw = ui.getVal('static-start');
  const endRaw   = ui.getVal('static-end');

  const body = { last_sec: lastSec, channels, db_target: dbTarget };
  if (dsn)      body.dsn   = dsn;
  if (startRaw) body.start = new Date(startRaw).toISOString();
  if (endRaw)   body.end   = new Date(endRaw).toISOString();

  const btn = document.getElementById('btn-query');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Querying…';
  }

  ui.showAlert('static-result-msg', '⏳ Querying database…', 'info');

  try {
    const data = await api.fetchPlotData(body);

    if (!data.ok) {
      ui.showAlert('static-result-msg', `✗ ${data.error}`, 'error');
      return;
    }

    const chKeys = Object.keys(data.data);
    if (!chKeys.length) {
      ui.showAlert('static-result-msg', 'No data found for the given time range.', 'info');
      const empty = document.getElementById('plot-empty');
      if (empty) empty.classList.remove('hidden');
      return;
    }

    const empty = document.getElementById('plot-empty');
    if (empty) empty.classList.add('hidden');

    const datasets = chKeys.map((ch, i) => ({
      label:           `CH${ch}`,
      data:            data.data[ch].times.map((t, j) => ({ x: new Date(t), y: data.data[ch].values[j] })),
      borderColor:     COLOURS[i % COLOURS.length],
      backgroundColor: COLOUR_DIMS[i % COLOUR_DIMS.length],
      fill:            false,
      pointRadius:     0,
      borderWidth:     1.5,
      tension:         0.15,
    }));

    plotChart.data.datasets = datasets;
    plotChart.update();

    const totalRows = chKeys.reduce((sum, ch) => sum + (data.data[ch].times.length || 0), 0);
    const rangeStr  = `${ui.fmtTime(data.start)} → ${ui.fmtTime(data.end)}`;
    const timerRangeEl = document.getElementById('static-time-range');
    if (timerRangeEl) timerRangeEl.textContent = rangeStr;
    ui.showAlert('static-result-msg', `✓ ${totalRows.toLocaleString()} rows plotted across ${chKeys.length} channel(s)`, 'success');
    ui.appendLog(`Static plot: ${totalRows.toLocaleString()} rows, channels [${chKeys.join(', ')}]`, 'info');

  } catch (e) {
    ui.showAlert('static-result-msg', `✗ Network error: ${e}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Query &amp; Plot`;
    }
  }
}

export async function fetchChannels() {
  const dbTarget = ui.getVal('plot-db-target');
  const dsn      = dbTarget === 'custom' ? (ui.getVal('plot-dsn-override').trim() || null) : null;
  ui.showAlert('static-result-msg', '⏳ Fetching channels…', 'info');
  try {
    const data = await api.fetchChannels(dbTarget, dsn);
    if (data.ok) {
      const el = document.getElementById('static-channels');
      if (el) el.value = data.channels.join(',');
      ui.showAlert('static-result-msg', `✓ Available channels: [${data.channels.join(', ')}]`, 'success');
    } else {
      ui.showAlert('static-result-msg', `✗ ${data.error}`, 'error');
    }
  } catch (e) {
    ui.showAlert('static-result-msg', `✗ Error: ${e}`, 'error');
  }
}
