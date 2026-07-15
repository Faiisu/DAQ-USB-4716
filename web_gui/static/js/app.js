/* ═══════════════════════════════════════════════════════════════════════════
   DAQ USB-4716  ·  app.js (ES Module Entrypoint)  ·  v2.0
   Bootstraps the Web GUI application and coordinates modules.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as api from './api.js';
import * as ui from './ui.js';
import * as chart from './chart-manager.js';
import { initSockets } from './sockets.js';

// ── Bootstrapping Application ──
async function loadConfig() {
  try {
    const cfg = await api.fetchConfig();
    ui.populateConfig(cfg);
  } catch (e) {
    ui.appendLog(`Failed to load config: ${e}`, 'error');
  }
}

// ── Dynamic pipeline actions ──
async function startPipeline(mode = 'mockup') {
  const btnReal = document.getElementById('btn-start-real');
  const btnMock = document.getElementById('btn-start-mockup');
  if (btnReal) btnReal.disabled = true;
  if (btnMock) btnMock.disabled = true;

  try {
    const data = await api.startPipeline(mode);
    if (!data.ok) {
      ui.appendLog(`Start failed: ${data.error}`, 'error');
      if (btnReal) btnReal.disabled = false;
      if (btnMock) btnMock.disabled = false;
    } else {
      ui.appendLog(`Pipeline (${mode}) start requested`, 'info');
    }
  } catch (e) {
    ui.appendLog(`Error: ${e}`, 'error');
    if (btnReal) btnReal.disabled = false;
    if (btnMock) btnMock.disabled = false;
  }
}

async function stopPipeline() {
  const btnStop = document.getElementById('btn-stop');
  if (btnStop) btnStop.disabled = true;
  try {
    const data = await api.stopPipeline();
    if (!data.ok) {
      ui.appendLog(`Stop failed: ${data.error}`, 'error');
      if (btnStop) btnStop.disabled = false;
    } else {
      ui.appendLog('Pipeline stop requested', 'info');
    }
  } catch (e) {
    ui.appendLog(`Error: ${e}`, 'error');
    if (btnStop) btnStop.disabled = false;
  }
}

// ── Configuration updates ──
async function patchConfig(patch, alertId) {
  try {
    const data = await api.patchConfig(patch);
    ui.setCurrentCfg(data.config);
    ui.showAlert(alertId, '✓ Saved successfully', 'success');
    setTimeout(() => ui.hideAlert(alertId), 3000);
  } catch (e) {
    ui.showAlert(alertId, `✗ Error: ${e}`, 'error');
  }
}

async function saveDbConfig() {
  const patch = {
    db_dsn:        ui.getVal('inp-db-dsn'),
    mockup_db_dsn: ui.getVal('inp-mockup-dsn'),
    db_page_size:  parseInt(ui.getVal('inp-page-size')),
  };
  await patchConfig(patch, 'db-save-result');
  ui.setText('info-dsn', patch.mockup_db_dsn);
}

async function saveDaqConfig() {
  const scaling = [];
  document.querySelectorAll('.scaling-row').forEach(row => {
    scaling.push({
      low_v:    parseFloat(row.querySelector('.sc-low-v').value)    ?? 0.0,
      high_v:   parseFloat(row.querySelector('.sc-high-v').value)   ?? 5.0,
      low_val:  parseFloat(row.querySelector('.sc-low-val').value)  ?? 0.0,
      high_val: parseFloat(row.querySelector('.sc-high-val').value) ?? 5.0,
    });
  });

  const patch = {
    device_description: ui.getVal('inp-device'),
    profile_path:       ui.getVal('inp-profile'),
    start_channel:      parseInt(ui.getVal('inp-start-ch')),
    channel_count:      parseInt(ui.getVal('inp-ch-count')),
    clock_rate:         parseInt(ui.getVal('inp-clock')),
    section_length:     parseInt(ui.getVal('inp-seclen')),
    section_count:      parseInt(ui.getVal('inp-sec-count')),
    queue_maxsize:      parseInt(ui.getVal('inp-queue-max')),
    stats_interval:     parseInt(ui.getVal('inp-stats-int')),
    scaling_enabled:    document.getElementById('inp-scale-enabled').checked,
    scaling:            scaling,
  };
  await patchConfig(patch, 'daq-save-result');
  const fullCfg = { ...ui.getCurrentCfg(), ...patch };
  ui.setCurrentCfg(fullCfg);
  ui.updateDerived(fullCfg);
  ui.setText('info-channels', `CH${patch.start_channel} – CH${patch.start_channel + patch.channel_count - 1} (${patch.channel_count} ch)`);
  ui.setText('info-clock',    `${patch.clock_rate.toLocaleString()} Hz`);
  ui.setText('info-seclen',   `${patch.section_length} samples/ch`);
  ui.renderChannelPills(fullCfg);
  ui.renderScaling(fullCfg);
}

async function saveMockupConfig() {
  const waveforms = [];
  document.querySelectorAll('.waveform-row').forEach(row => {
    waveforms.push({
      amp:  parseFloat(row.querySelector('.wf-amp').value)  || 1.0,
      freq: parseFloat(row.querySelector('.wf-freq').value) || 10.0,
      dc:   parseFloat(row.querySelector('.wf-dc').value)   || 2.5,
    });
  });
  const patch = {
    noise_std: parseFloat(ui.getVal('inp-noise')),
    waveforms,
  };
  await patchConfig(patch, 'mockup-save-result');
}

async function testDbConn() {
  const dsn = ui.getVal('inp-mockup-dsn');
  ui.showAlert('db-test-result', '⏳ Testing connection…', 'info');
  try {
    const data = await api.testDbConn(dsn);
    if (data.ok) {
      ui.showAlert('db-test-result', `✓ Connected  —  ${data.version}`, 'success');
    } else {
      ui.showAlert('db-test-result', `✗ ${data.error}`, 'error');
    }
  } catch (e) {
    ui.showAlert('db-test-result', `✗ Network error: ${e}`, 'error');
  }
}

function onDbTargetChange() {
  const target = ui.getVal('plot-db-target');
  const group = document.getElementById('custom-dsn-group');
  if (target === 'custom') {
    group?.classList.remove('hidden');
  } else {
    group?.classList.add('hidden');
  }
}

// ── Bind Interactive Actions to window Scope ──
window.startPipeline = startPipeline;
window.stopPipeline = stopPipeline;
window.saveDbConfig = saveDbConfig;
window.saveDaqConfig = saveDaqConfig;
window.saveMockupConfig = saveMockupConfig;
window.testDbConn = testDbConn;
window.onDbTargetChange = onDbTargetChange;
window.clearLog = ui.clearLog;
window.toggleScalingContainer = ui.toggleScalingContainer;

// ── Bind Chart actions to window scope ──
window.togglePlotMode = chart.togglePlotMode;
window.toggleLiveSession = chart.toggleLiveSession;
window.clearLiveChart = chart.clearLiveChart;
window.resetPlotZoom = chart.resetPlotZoom;
window.updateYScale = chart.updateYScale;
window.runStaticPlot = chart.runStaticPlot;
window.fetchChannels = chart.fetchChannels;

// ── DOM Reactive Listeners ──
document.addEventListener('DOMContentLoaded', async () => {
  // Navigation tabs listeners
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      ui.switchTab(el.dataset.tab, chart.plotChart);
    });
  });

  // Re-render waveform rows when channel count changes
  document.getElementById('inp-ch-count')?.addEventListener('change', () => {
    const n   = parseInt(ui.getVal('inp-ch-count')) || 4;
    
    // Waveforms
    const wf  = [];
    document.querySelectorAll('.waveform-row').forEach(row => {
      wf.push({
        amp:  parseFloat(row.querySelector('.wf-amp')?.value)  || 1.0,
        freq: parseFloat(row.querySelector('.wf-freq')?.value) || 10.0,
        dc:   parseFloat(row.querySelector('.wf-dc')?.value)   || 2.5,
      });
    });
    while (wf.length < n) wf.push({ amp: 1.0, freq: 10.0, dc: 2.5 });
    ui.renderWaveforms({
      ...ui.getCurrentCfg(),
      channel_count: n,
      start_channel: parseInt(ui.getVal('inp-start-ch')) || 0,
      waveforms: wf,
    });

    // Scaling
    const sc  = [];
    document.querySelectorAll('.scaling-row').forEach(row => {
      sc.push({
        low_v:    parseFloat(row.querySelector('.sc-low-v')?.value)    ?? 0.0,
        high_v:   parseFloat(row.querySelector('.sc-high-v')?.value)   ?? 5.0,
        low_val:  parseFloat(row.querySelector('.sc-low-val')?.value)  ?? 0.0,
        high_val: parseFloat(row.querySelector('.sc-high-val')?.value) ?? 5.0,
      });
    });
    while (sc.length < n) sc.push({ low_v: 0.0, high_v: 5.0, low_val: 0.0, high_val: 5.0 });
    ui.renderScaling({
      ...ui.getCurrentCfg(),
      channel_count: n,
      start_channel: parseInt(ui.getVal('inp-start-ch')) || 0,
      scaling: sc,
    });
  });

  // Recompute derived values on DAQ fields input
  ['inp-ch-count', 'inp-clock', 'inp-seclen', 'inp-queue-max'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      ui.updateDerived({
        channel_count:  parseInt(ui.getVal('inp-ch-count'))  || 4,
        clock_rate:     parseInt(ui.getVal('inp-clock'))      || 1000,
        section_length: parseInt(ui.getVal('inp-seclen'))     || 256,
        queue_maxsize:  parseInt(ui.getVal('inp-queue-max'))  || 200,
      });
    });
  });

  // Load config & initialize modules
  await loadConfig();
  chart.initPlotChart();
  initSockets();

  // Load initial pipeline stats
  try {
    const res = await fetch('/api/pipeline/status');
    const s = await res.json();
    ui.updateStats(s);
  } catch (_) {}

  ui.appendLog('DAQ USB-4716 Control Center initialized', 'info');
});
