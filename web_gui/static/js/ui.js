/* ── DOM & UI Rendering Manager ── */

import { COLOURS, NAV_MAP } from './constants.js';

let _logLineCount = 0;
let _currentCfg = {};

export function getCurrentCfg() {
  return _currentCfg;
}

export function setCurrentCfg(cfg) {
  _currentCfg = cfg;
}

// ── Form helpers ──
export function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

export function setVal(id, v) {
  const el = document.getElementById(id);
  if (el && v !== undefined && v !== null) el.value = v;
}

export function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v ?? '—';
}

export function fmtNum(n) {
  return (n == null) ? '—' : Number(n).toLocaleString();
}

export function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
  } catch { return iso; }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Navigation ──
export function switchTab(tabId, plotChart) {
  const info = NAV_MAP[tabId];
  if (!info) return;

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.removeAttribute('aria-current'));

  document.getElementById(tabId)?.classList.add('active');
  const navEl = document.getElementById(info.nav);
  navEl?.classList.add('active');
  navEl?.setAttribute('aria-current', 'page');

  document.getElementById('header-title').textContent = info.title;
  document.getElementById('breadcrumb-sub').textContent = info.sub;

  if (tabId === 'tab-plotter' && plotChart) {
    setTimeout(() => plotChart.resize(), 50);
  }
}

// ── Alerts ──
export function showAlert(id, msg, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert ${type}`;
}

export function hideAlert(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'alert hidden';
}

// ── Log Console ──
export function appendLog(msg, level = 'info', ts = null) {
  const out = document.getElementById('log-output');
  if (!out) return;
  const tsStr = ts || new Date().toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });

  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `
    <span class="log-ts">${tsStr}</span>
    <span class="log-lvl ${level}">${level.toUpperCase().slice(0, 4)}</span>
    <span class="log-msg ${level === 'error' ? 'error' : level === 'warn' ? 'warn' : ''}">${escapeHtml(msg)}</span>
  `;
  out.appendChild(line);

  const nearBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 60;
  if (nearBottom) out.scrollTop = out.scrollHeight;

  _logLineCount++;
  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = `${_logLineCount} line${_logLineCount !== 1 ? 's' : ''}`;
}

export function clearLog() {
  const out = document.getElementById('log-output');
  if (out) out.innerHTML = '';
  _logLineCount = 0;
  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = '0 lines';
}

// ── Config updates ──
export function populateConfig(cfg) {
  _currentCfg = cfg;

  // DB
  setVal('inp-db-dsn',     cfg.db_dsn);
  setVal('inp-mockup-dsn', cfg.mockup_db_dsn);
  setVal('inp-page-size',  cfg.db_page_size);

  // DAQ
  setVal('inp-device',    cfg.device_description);
  setVal('inp-profile',   cfg.profile_path);
  setVal('inp-start-ch',  cfg.start_channel);
  setVal('inp-ch-count',  cfg.channel_count);
  setVal('inp-clock',     cfg.clock_rate);
  setVal('inp-seclen',    cfg.section_length);
  setVal('inp-sec-count', cfg.section_count);
  setVal('inp-queue-max', cfg.queue_maxsize);
  setVal('inp-stats-int', cfg.stats_interval);

  // Mockup
  setVal('inp-noise', cfg.noise_std);
  renderWaveforms(cfg);

  // Scaling
  const scaleEnabledEl = document.getElementById('inp-scale-enabled');
  if (scaleEnabledEl) {
    scaleEnabledEl.checked = !!cfg.scaling_enabled;
  }
  renderScaling(cfg);
  toggleScalingContainer();

  // Dashboard info
  setText('info-dsn',      cfg.mockup_db_dsn);
  setText('info-channels', `CH${cfg.start_channel} – CH${cfg.start_channel + cfg.channel_count - 1} (${cfg.channel_count} ch)`);
  setText('info-clock',    `${cfg.clock_rate.toLocaleString()} Hz`);
  setText('info-seclen',   `${cfg.section_length} samples/ch`);

  renderChannelPills(cfg);
  updateDerived(cfg);
}

export function renderChannelPills(cfg) {
  const container = document.getElementById('channel-pills');
  if (!container) return;
  const n = cfg.channel_count || 0;
  if (n === 0) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">No channels configured</span>';
    return;
  }
  container.innerHTML = Array.from({ length: n }, (_, i) => {
    const ch = cfg.start_channel + i;
    const color = COLOURS[i % COLOURS.length];
    return `<div class="ch-pill active">
      <div class="ch-color-dot" style="background:${color};box-shadow:0 0 8px ${color}"></div>
      <span style="font-family:var(--font-mono)">CH${ch}</span>
    </div>`;
  }).join('');
}

export function updateDerived(cfg) {
  const n    = cfg.channel_count  || 1;
  const sec  = cfg.section_length || 256;
  const hz   = cfg.clock_rate     || 1000;
  const qmax = cfg.queue_maxsize  || 200;

  const bufSize    = sec * n;
  const period_ms  = (sec / hz * 1000).toFixed(1);
  const queueTime  = (qmax * sec / hz).toFixed(0);
  const dt_us      = (1e6 / hz).toFixed(2);
  const rowsPerSec = hz * n;
  const bytesPerHr = rowsPerSec * 3600 * 26; // ~26 bytes/row (tstz+int2+float8)
  const mbPerHr    = (bytesPerHr / 1e6).toFixed(0);

  setText('derived-buf-size',   `${bufSize.toLocaleString()} samples`);
  setText('derived-period',     `${period_ms} ms / batch`);
  setText('derived-queue-time', `~${queueTime} s`);
  setText('derived-dt',         `${dt_us} µs`);
  setText('derived-rate',       `${rowsPerSec.toLocaleString()} rows/s`);
  setText('derived-storage',    `~${mbPerHr} MB/hr`);
}

export function renderWaveforms(cfg) {
  const container = document.getElementById('waveform-list');
  if (!container) return;

  const existing = [];
  container.querySelectorAll('.waveform-row').forEach(row => {
    existing.push({
      amp:  parseFloat(row.querySelector('.wf-amp')?.value)  ?? null,
      freq: parseFloat(row.querySelector('.wf-freq')?.value) ?? null,
      dc:   parseFloat(row.querySelector('.wf-dc')?.value)   ?? null,
    });
  });

  const n  = cfg.channel_count || 1;
  const wf = cfg.waveforms || [];

  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const saved = wf[i]      || { amp: 1.0, freq: 10.0, dc: 2.5 };
    const edit  = existing[i] || {};
    const w = {
      amp:  edit.amp  ?? saved.amp,
      freq: edit.freq ?? saved.freq,
      dc:   edit.dc   ?? saved.dc,
    };
    const color = COLOURS[i % COLOURS.length];
    const ch    = (cfg.start_channel || 0) + i;

    const row = document.createElement('div');
    row.className = 'waveform-row';
    row.innerHTML = `
      <div class="waveform-ch">
        <div class="waveform-ch-label" style="color:${color}; text-shadow:0 0 10px ${color}80;">CH ${ch}</div>
        <div class="waveform-ch-sub">A·sin(2πft)+DC</div>
      </div>
      <div class="form-group">
        <label>Amplitude (V)</label>
        <input class="form-control wf-amp" type="number" step="0.1" min="0" max="5" value="${w.amp}" style="border-color:${color}30"/>
      </div>
      <div class="form-group">
        <label>Frequency (Hz)</label>
        <input class="form-control wf-freq" type="number" step="0.5" min="0.01" max="500" value="${w.freq}" style="border-color:${color}30"/>
      </div>
      <div class="form-group">
        <label>DC Offset (V)</label>
        <input class="form-control wf-dc" type="number" step="0.1" min="0" max="5" value="${w.dc}" style="border-color:${color}30"/>
      </div>
    `;
    container.appendChild(row);
  }
}

export function renderScaling(cfg) {
  const container = document.getElementById('scaling-list');
  if (!container) return;

  const existing = [];
  container.querySelectorAll('.scaling-row').forEach(row => {
    existing.push({
      low_v:    parseFloat(row.querySelector('.sc-low-v')?.value)    ?? null,
      high_v:   parseFloat(row.querySelector('.sc-high-v')?.value)   ?? null,
      low_val:  parseFloat(row.querySelector('.sc-low-val')?.value)  ?? null,
      high_val: parseFloat(row.querySelector('.sc-high-val')?.value) ?? null,
    });
  });

  const n  = cfg.channel_count || 1;
  const sc = cfg.scaling || [];

  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const saved = sc[i]      || { low_v: 0.0, high_v: 5.0, low_val: 0.0, high_val: 5.0 };
    const edit  = existing[i] || {};
    const w = {
      low_v:    edit.low_v    ?? saved.low_v,
      high_v:   edit.high_v   ?? saved.high_v,
      low_val:  edit.low_val  ?? saved.low_val,
      high_val: edit.high_val ?? saved.high_val,
    };
    const color = COLOURS[i % COLOURS.length];
    const ch    = (cfg.start_channel || 0) + i;

    const row = document.createElement('div');
    row.className = 'scaling-row';
    row.innerHTML = `
      <div class="waveform-ch">
        <div class="waveform-ch-label" style="color:${color}; text-shadow:0 0 10px ${color}80;">CH ${ch}</div>
        <div class="waveform-ch-sub">y = mx + c</div>
      </div>
      <div class="form-group">
        <label>Low V</label>
        <input class="form-control sc-low-v" type="number" step="0.01" value="${w.low_v}" style="border-color:${color}30"/>
      </div>
      <div class="form-group">
        <label>High V</label>
        <input class="form-control sc-high-v" type="number" step="0.01" value="${w.high_v}" style="border-color:${color}30"/>
      </div>
      <div class="form-group">
        <label>Low Value</label>
        <input class="form-control sc-low-val" type="number" step="0.01" value="${w.low_val}" style="border-color:${color}30"/>
      </div>
      <div class="form-group">
        <label>High Value</label>
        <input class="form-control sc-high-val" type="number" step="0.01" value="${w.high_val}" style="border-color:${color}30"/>
      </div>
    `;
    container.appendChild(row);
  }
}

export function toggleScalingContainer() {
  const enabled = document.getElementById('inp-scale-enabled')?.checked;
  const container = document.getElementById('scaling-list');
  if (container) {
    if (enabled) {
      container.classList.remove('disabled');
      container.style.opacity = '1.0';
      container.style.pointerEvents = 'auto';
    } else {
      container.classList.add('disabled');
      container.style.opacity = '0.4';
      container.style.pointerEvents = 'none';
    }
  }
}

export function updateChip(running, label) {
  const chip = document.getElementById('pipeline-chip');
  const chipDot = document.getElementById('chip-dot');
  const chipLabel = document.getElementById('chip-label');
  if (!chip) return;
  chip.className = 'pipeline-chip' + (running ? ' running' : '');
  if (chipDot) chipDot.className = 'chip-dot' + (running ? ' running' : '');
  if (chipLabel) chipLabel.textContent = label ?? (running ? 'RUNNING' : 'STOPPED');
}

export function updateStats(s) {
  setStatValue('stat-polled',  fmtNum(s.polled));
  setStatValue('stat-written', fmtNum(s.written));
  setStatValue('stat-dropped', fmtNum(s.dropped));
  setStatValue('stat-dberr',   fmtNum(s.db_errors));

  const running = !!s.running;
  updateChip(running, s.mode?.toUpperCase() || (running ? 'RUNNING' : 'STOPPED'));

  const dot = document.getElementById('status-dot');
  const lbl = document.getElementById('status-label');
  if (dot) dot.className = 'status-dot' + (running ? ' running' : '');
  if (lbl) lbl.textContent = running ? `${s.mode || 'running'}` : 'Stopped';

  const badge = document.getElementById('info-mode-badge');
  if (badge) {
    badge.textContent = s.mode?.toUpperCase() || (running ? 'RUNNING' : 'STOPPED');
    badge.className = 'badge ' + (running ? (s.mode === 'mockup' ? 'mockup' : 'running') : 'stopped');
  }

  const modeEl = document.getElementById('info-mode');
  if (modeEl) modeEl.textContent = s.mode || '—';

  const btnReal = document.getElementById('btn-start-real');
  const btnMock = document.getElementById('btn-start-mockup');
  if (btnReal) btnReal.disabled = running;
  if (btnMock) btnMock.disabled = running;
  const btnStop = document.getElementById('btn-stop');
  if (btnStop) btnStop.disabled  = !running;

  updateProcessFlow(s);
}

function setStatValue(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = v;
  el.classList.add('updating');
  setTimeout(() => el.classList.remove('updating'), 400);
}

export function updateProcessFlow(s) {
  const running = !!s.running;
  const mode = s.mode || '';
  
  const flowDot = document.getElementById('flow-dot');
  const flowModeBadge = document.getElementById('flow-mode-badge');
  
  if (flowDot) {
    if (running) {
      flowDot.style.background = mode === 'real' ? 'var(--cyan)' : 'var(--green)';
    } else {
      flowDot.style.background = 'var(--text-muted)';
    }
  }
  
  if (flowModeBadge) {
    flowModeBadge.textContent = running ? mode.toUpperCase() : 'OFFLINE';
    flowModeBadge.className = 'badge ' + (running ? (mode === 'mockup' ? 'mockup' : 'running') : 'stopped');
  }

  const nodeSource = document.getElementById('node-source');
  const flowSourceType = document.getElementById('flow-source-type');
  if (nodeSource) {
    nodeSource.className = 'flow-node' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowSourceType) {
    if (running) {
      flowSourceType.textContent = mode === 'real' ? (_currentCfg.device_description || 'USB-4716') : 'Mock Waveforms';
    } else {
      flowSourceType.textContent = 'Offline';
    }
  }

  const pathSourceReader = document.getElementById('path-source-reader');
  const flowStatPollRate = document.getElementById('flow-stat-poll-rate');
  if (pathSourceReader) {
    pathSourceReader.className = 'flow-path' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowStatPollRate) {
    flowStatPollRate.textContent = running ? `${fmtNum(_currentCfg.clock_rate)} Hz` : '-- Hz';
  }

  const nodeReader = document.getElementById('node-reader');
  const flowReaderStatus = document.getElementById('flow-reader-status');
  if (nodeReader) {
    nodeReader.className = 'flow-node' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowReaderStatus) {
    flowReaderStatus.textContent = running ? 'Polling Buffer' : 'Idle';
  }

  const pathReaderQueue = document.getElementById('path-reader-queue');
  const flowStatPolled = document.getElementById('flow-stat-polled');
  if (pathReaderQueue) {
    pathReaderQueue.className = 'flow-path' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowStatPolled) {
    flowStatPolled.textContent = running ? `${fmtNum(s.polled)} spls` : '0 spls';
  }

  const nodeQueue = document.getElementById('node-queue');
  const flowQueueStatus = document.getElementById('flow-queue-status');
  if (nodeQueue) {
    nodeQueue.className = 'flow-node' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowQueueStatus) {
    flowQueueStatus.textContent = running ? `${fmtNum(s.enqueued)} batches` : '0 batches';
  }

  const pathQueueWriter = document.getElementById('path-queue-writer');
  const flowStatDropRate = document.getElementById('flow-stat-drop-rate');
  if (pathQueueWriter) {
    pathQueueWriter.className = 'flow-path' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowStatDropRate) {
    flowStatDropRate.textContent = running ? `${fmtNum(s.dropped)} drops` : '0 drops';
  }

  const nodeWriter = document.getElementById('node-writer');
  const flowWriterStatus = document.getElementById('flow-writer-status');
  if (nodeWriter) {
    nodeWriter.className = 'flow-node' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowWriterStatus) {
    flowWriterStatus.textContent = running ? 'Bulk Inserting' : 'Idle';
  }

  const pathWriterDb = document.getElementById('path-writer-db');
  const flowStatWritten = document.getElementById('flow-stat-written');
  if (pathWriterDb) {
    pathWriterDb.className = 'flow-path' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowStatWritten) {
    flowStatWritten.textContent = running ? `${fmtNum(s.written)} rows` : '0 rows';
  }

  const nodeDb = document.getElementById('node-db');
  const flowDbStatus = document.getElementById('flow-db-status');
  if (nodeDb) {
    nodeDb.className = 'flow-node' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowDbStatus) {
    flowDbStatus.textContent = running ? (s.db_errors > 0 ? `${s.db_errors} Errors` : 'Connected') : 'Offline';
  }
}
