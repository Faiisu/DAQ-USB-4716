/* ═══════════════════════════════════════════════════════════════════════════
   DAQ USB-4716  ·  app.js  ·  v2.0
   Socket.IO client + Chart.js + REST API + UI logic
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Channel colour palette ────────────────────────────────────────────────────
const COLOURS = [
  '#ffffff', // Pure White
  '#e4e4e7', // Zinc 200 (Light grey)
  '#a1a1aa', // Zinc 400 (Medium grey)
  '#71717a', // Zinc 500 (Charcoal)
  '#d4d4d8', // Zinc 300 (Silver)
  '#f4f4f5', // Zinc 100 (Off white)
  '#e5e5e5', // Cool silver
  '#cccccc', // Light grey
];

const COLOUR_DIMS = [
  'rgba(255,255,255,0.08)',
  'rgba(228,228,231,0.08)',
  'rgba(161,161,170,0.08)',
  'rgba(113,113,122,0.08)',
  'rgba(212,212,216,0.08)',
  'rgba(244,244,245,0.08)',
  'rgba(229,229,229,0.08)',
  'rgba(204,204,204,0.08)',
];

// ── Navigation tab map ────────────────────────────────────────────────────────
const NAV_MAP = {
  'tab-dashboard': { title: 'DASHBOARD',   sub: 'Overview',       nav: 'nav-dashboard' },
  'tab-plotter':   { title: 'PLOTTER',     sub: 'Data Plotter',   nav: 'nav-plotter'   },
  'tab-daq':       { title: 'DAQ CONFIG',  sub: 'Hardware Setup', nav: 'nav-daq'       },
  'tab-db':        { title: 'DATABASE',    sub: 'Connection',     nav: 'nav-db'        },
  'tab-mockup':    { title: 'WAVEFORMS',   sub: 'Mock Generator', nav: 'nav-mockup'    },
  'tab-log':       { title: 'LOG CONSOLE', sub: 'Pipeline Output',nav: 'nav-log'       },
};

// ── State ─────────────────────────────────────────────────────────────────────
let _currentCfg = {};
let _logLineCount = 0;
let _liveEmpty = true;
let _plotMode = 'live'; // 'live' or 'history'

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

function switchTab(tabId) {
  const info = NAV_MAP[tabId];
  if (!info) return;

  // Deactivate all
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.removeAttribute('aria-current'));

  // Activate target
  document.getElementById(tabId)?.classList.add('active');
  const navEl = document.getElementById(info.nav);
  navEl?.classList.add('active');
  navEl?.setAttribute('aria-current', 'page');

  // Update header
  document.getElementById('header-title').textContent = info.title;
  document.getElementById('breadcrumb-sub').textContent = info.sub;

  // Lazy resize charts when switching to chart tabs
  if (tabId === 'tab-plotter' && plotChart) {
    setTimeout(() => plotChart.resize(), 50);
  }
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    switchTab(el.dataset.tab);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════

const socket = io({
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
});

socket.on('connect', () => {
  appendLog('Connected to DAQ GUI server', 'info');
  updateChip(false);
});

socket.on('disconnect', reason => {
  appendLog(`Disconnected: ${reason}`, 'warn');
  updateChip(false, 'OFFLINE');
});

socket.on('reconnect', () => {
  appendLog('Reconnected to server', 'info');
});

socket.on('log', data => {
  appendLog(data.msg, data.level, data.ts);
});

socket.on('stats', data => {
  updateStats(data);
});

socket.on('live_data', data => {
  pushLiveData(data);
});

// ═══════════════════════════════════════════════════════════════════════════
// LOG CONSOLE
// ═══════════════════════════════════════════════════════════════════════════

function appendLog(msg, level = 'info', ts = null) {
  const out = document.getElementById('log-output');
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

  // Auto-scroll if near bottom
  const nearBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 60;
  if (nearBottom) out.scrollTop = out.scrollHeight;

  _logLineCount++;
  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = `${_logLineCount} line${_logLineCount !== 1 ? 's' : ''}`;
}

function clearLog() {
  document.getElementById('log-output').innerHTML = '';
  _logLineCount = 0;
  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = '0 lines';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS & STATUS
// ═══════════════════════════════════════════════════════════════════════════

function updateStats(s) {
  setStatValue('stat-polled',  fmtNum(s.polled));
  setStatValue('stat-written', fmtNum(s.written));
  setStatValue('stat-dropped', fmtNum(s.dropped));
  setStatValue('stat-dberr',   fmtNum(s.db_errors));

  const running = !!s.running;
  updateChip(running, s.mode?.toUpperCase() || (running ? 'RUNNING' : 'STOPPED'));

  // Status dot
  const dot = document.getElementById('status-dot');
  const lbl = document.getElementById('status-label');
  dot.className = 'status-dot' + (running ? ' running' : '');
  if (lbl) lbl.textContent = running ? `${s.mode || 'running'}` : 'Stopped';

  // Pipeline state badge
  const badge = document.getElementById('info-mode-badge');
  if (badge) {
    badge.textContent = s.mode?.toUpperCase() || (running ? 'RUNNING' : 'STOPPED');
    badge.className = 'badge ' + (running ? (s.mode === 'mockup' ? 'mockup' : 'running') : 'stopped');
  }

  const modeEl = document.getElementById('info-mode');
  if (modeEl) modeEl.textContent = s.mode || '—';

  // Buttons
  const btnReal = document.getElementById('btn-start-real');
  const btnMock = document.getElementById('btn-start-mockup');
  if (btnReal) btnReal.disabled = running;
  if (btnMock) btnMock.disabled = running;
  document.getElementById('btn-stop').disabled  = !running;

  // Update real-time process flow visualization
  updateProcessFlow(s);
}

function updateProcessFlow(s) {
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

  // 1. Source Node
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

  // Path 1 (Source -> Reader)
  const pathSourceReader = document.getElementById('path-source-reader');
  const flowStatPollRate = document.getElementById('flow-stat-poll-rate');
  if (pathSourceReader) {
    pathSourceReader.className = 'flow-path' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowStatPollRate) {
    flowStatPollRate.textContent = running ? `${fmtNum(_currentCfg.clock_rate)} Hz` : '-- Hz';
  }

  // 2. Reader Node
  const nodeReader = document.getElementById('node-reader');
  const flowReaderStatus = document.getElementById('flow-reader-status');
  if (nodeReader) {
    nodeReader.className = 'flow-node' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowReaderStatus) {
    flowReaderStatus.textContent = running ? 'Polling Buffer' : 'Idle';
  }

  // Path 2 (Reader -> Queue)
  const pathReaderQueue = document.getElementById('path-reader-queue');
  const flowStatPolled = document.getElementById('flow-stat-polled');
  if (pathReaderQueue) {
    pathReaderQueue.className = 'flow-path' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowStatPolled) {
    flowStatPolled.textContent = running ? `${fmtNum(s.polled)} spls` : '0 spls';
  }

  // 3. Queue Node
  const nodeQueue = document.getElementById('node-queue');
  const flowQueueStatus = document.getElementById('flow-queue-status');
  if (nodeQueue) {
    nodeQueue.className = 'flow-node' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowQueueStatus) {
    flowQueueStatus.textContent = running ? `${fmtNum(s.enqueued)} batches` : '0 batches';
  }

  // Path 3 (Queue -> Writer)
  const pathQueueWriter = document.getElementById('path-queue-writer');
  const flowStatDropRate = document.getElementById('flow-stat-drop-rate');
  if (pathQueueWriter) {
    pathQueueWriter.className = 'flow-path' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowStatDropRate) {
    flowStatDropRate.textContent = running ? `${fmtNum(s.dropped)} drops` : '0 drops';
  }

  // 4. Writer Node
  const nodeWriter = document.getElementById('node-writer');
  const flowWriterStatus = document.getElementById('flow-writer-status');
  if (nodeWriter) {
    nodeWriter.className = 'flow-node' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowWriterStatus) {
    flowWriterStatus.textContent = running ? 'Bulk Inserting' : 'Idle';
  }

  // Path 4 (Writer -> DB)
  const pathWriterDb = document.getElementById('path-writer-db');
  const flowStatWritten = document.getElementById('flow-stat-written');
  if (pathWriterDb) {
    pathWriterDb.className = 'flow-path' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowStatWritten) {
    flowStatWritten.textContent = running ? `${fmtNum(s.written)} rows` : '0 rows';
  }

  // 5. DB Node
  const nodeDb = document.getElementById('node-db');
  const flowDbStatus = document.getElementById('flow-db-status');
  if (nodeDb) {
    nodeDb.className = 'flow-node' + (running ? (mode === 'mockup' ? ' active-mockup' : ' active-real') : '');
  }
  if (flowDbStatus) {
    flowDbStatus.textContent = running ? (s.db_errors > 0 ? `${s.db_errors} Errors` : 'Connected') : 'Offline';
  }
}

function updateChip(running, label) {
  const chip = document.getElementById('pipeline-chip');
  const chipDot = document.getElementById('chip-dot');
  const chipLabel = document.getElementById('chip-label');
  if (!chip) return;
  chip.className = 'pipeline-chip' + (running ? ' running' : '');
  if (chipDot) chipDot.className = 'chip-dot' + (running ? ' running' : '');
  if (chipLabel) chipLabel.textContent = label ?? (running ? 'RUNNING' : 'STOPPED');
}

function setStatValue(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = v;
  el.classList.add('updating');
  setTimeout(() => el.classList.remove('updating'), 400);
}

function fmtNum(n) {
  return (n == null) ? '—' : Number(n).toLocaleString();
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v ?? '—';
}
function setVal(id, v) {
  const el = document.getElementById(id);
  if (el && v !== undefined && v !== null) el.value = v;
}
function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG LOAD / SAVE
// ═══════════════════════════════════════════════════════════════════════════

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    _currentCfg = cfg;
    populateConfig(cfg);
  } catch (e) {
    appendLog(`Failed to load config: ${e}`, 'error');
  }
}

function populateConfig(cfg) {
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

  // Dashboard info
  setText('info-dsn',      cfg.mockup_db_dsn);
  setText('info-channels', `CH${cfg.start_channel} – CH${cfg.start_channel + cfg.channel_count - 1} (${cfg.channel_count} ch)`);
  setText('info-clock',    `${cfg.clock_rate.toLocaleString()} Hz`);
  setText('info-seclen',   `${cfg.section_length} samples/ch`);

  // Channel pills
  renderChannelPills(cfg);

  updateDerived(cfg);
}

function renderChannelPills(cfg) {
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

function updateDerived(cfg) {
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

async function saveDbConfig() {
  const patch = {
    db_dsn:        getVal('inp-db-dsn'),
    mockup_db_dsn: getVal('inp-mockup-dsn'),
    db_page_size:  parseInt(getVal('inp-page-size')),
  };
  await patchConfig(patch, 'db-save-result');
  setText('info-dsn', patch.mockup_db_dsn);
}

async function saveDaqConfig() {
  const patch = {
    device_description: getVal('inp-device'),
    profile_path:       getVal('inp-profile'),
    start_channel:      parseInt(getVal('inp-start-ch')),
    channel_count:      parseInt(getVal('inp-ch-count')),
    clock_rate:         parseInt(getVal('inp-clock')),
    section_length:     parseInt(getVal('inp-seclen')),
    section_count:      parseInt(getVal('inp-sec-count')),
    queue_maxsize:      parseInt(getVal('inp-queue-max')),
    stats_interval:     parseInt(getVal('inp-stats-int')),
  };
  await patchConfig(patch, 'daq-save-result');
  _currentCfg = { ..._currentCfg, ...patch };
  updateDerived(_currentCfg);
  setText('info-channels', `CH${patch.start_channel} – CH${patch.start_channel + patch.channel_count - 1} (${patch.channel_count} ch)`);
  setText('info-clock',    `${patch.clock_rate.toLocaleString()} Hz`);
  setText('info-seclen',   `${patch.section_length} samples/ch`);
  renderChannelPills(_currentCfg);
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
    noise_std: parseFloat(getVal('inp-noise')),
    waveforms,
  };
  await patchConfig(patch, 'mockup-save-result');
}

async function patchConfig(patch, alertId) {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    _currentCfg = data.config;
    showAlert(alertId, '✓ Saved successfully', 'success');
    setTimeout(() => hideAlert(alertId), 3000);
  } catch (e) {
    showAlert(alertId, `✗ Error: ${e}`, 'error');
  }
}

// ── DB test ───────────────────────────────────────────────────────────────────
async function testDbConn() {
  const dsn = getVal('inp-mockup-dsn');
  showAlert('db-test-result', '⏳ Testing connection…', 'info');
  try {
    const res  = await fetch('/api/db/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dsn }),
    });
    const data = await res.json();
    if (data.ok) {
      showAlert('db-test-result', `✓ Connected  —  ${data.version}`, 'success');
    } else {
      showAlert('db-test-result', `✗ ${data.error}`, 'error');
    }
  } catch (e) {
    showAlert('db-test-result', `✗ Network error: ${e}`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WAVEFORM EDITOR
// ═══════════════════════════════════════════════════════════════════════════

function renderWaveforms(cfg) {
  const container = document.getElementById('waveform-list');
  if (!container) return;

  // Cache current edits before re-render
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

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE CONTROL
// ═══════════════════════════════════════════════════════════════════════════

async function startPipeline(mode = 'mockup') {
  const btnReal = document.getElementById('btn-start-real');
  const btnMock = document.getElementById('btn-start-mockup');
  if (btnReal) btnReal.disabled = true;
  if (btnMock) btnMock.disabled = true;

  try {
    const res  = await fetch('/api/pipeline/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    const data = await res.json();
    if (!data.ok) {
      appendLog(`Start failed: ${data.error}`, 'error');
      if (btnReal) btnReal.disabled = false;
      if (btnMock) btnMock.disabled = false;
    } else {
      appendLog(`Pipeline (${mode}) start requested`, 'info');
      _liveEmpty = true;
    }
  } catch (e) {
    appendLog(`Error: ${e}`, 'error');
    if (btnReal) btnReal.disabled = false;
    if (btnMock) btnMock.disabled = false;
  }
}

async function stopPipeline() {
  document.getElementById('btn-stop').disabled = true;
  try {
    const res  = await fetch('/api/pipeline/stop', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      appendLog(`Stop failed: ${data.error}`, 'error');
      document.getElementById('btn-stop').disabled = false;
    } else {
      appendLog('Pipeline stop requested', 'info');
    }
  } catch (e) {
    appendLog(`Error: ${e}`, 'error');
    document.getElementById('btn-stop').disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA PLOTTER CHART (UNIFIED LIVE & HISTORICAL)
// ═══════════════════════════════════════════════════════════════════════════

let plotChart     = null;
let plotDatasets  = {};   // { ch_str: assigned dataset index }

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
        modifierKey: 'ctrl', // Hold ctrl key to pan/scroll horizontally
      },
      zoom: {
        wheel: {
          enabled: true,
        },
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

function initPlotChart() {
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
          callbacks: {
            ...CHART_BASE.plugins.tooltip.callbacks
          }
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

function onDbTargetChange() {
  const target = document.getElementById('plot-db-target').value;
  const group = document.getElementById('custom-dsn-group');
  if (target === 'custom') {
    group.classList.remove('hidden');
  } else {
    group.classList.add('hidden');
  }
}

let livePollInterval = null;

function togglePlotMode(mode) {
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
    hideAlert('live-session-msg');
  }

  clearChart();

  if (mode === 'live') {
    liveControls.classList.remove('hidden');
    historyControls.classList.add('hidden');
    if (emptyText) emptyText.textContent = 'Start live session database polling to view graph';
    if (emptyIcon) emptyIcon.textContent = '📡';
    document.getElementById('plot-empty')?.classList.remove('hidden');
  } else {
    liveControls.classList.add('hidden');
    historyControls.classList.remove('hidden');
    if (emptyText) emptyText.textContent = 'Run a query to see historical data';
    if (emptyIcon) emptyIcon.textContent = '🔍';
    document.getElementById('plot-empty')?.classList.remove('hidden');
  }
}

function clearChart() {
  plotDatasets = {};
  if (plotChart) {
    plotChart.data.datasets = [];
    plotChart.update();
  }
  document.getElementById('static-time-range').textContent = '';
  const msg = document.getElementById('static-result-msg');
  if (msg) msg.className = 'alert hidden';
  const liveMsg = document.getElementById('live-session-msg');
  if (liveMsg) liveMsg.className = 'alert hidden';
}

async function pollDB() {
  const dbTarget = getVal('plot-db-target');
  const dsn      = dbTarget === 'custom' ? (getVal('plot-dsn-override').trim() || null) : null;
  const chStr    = getVal('live-channels').trim();
  const channels = chStr
    ? chStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
    : [];
  const lastSec  = parseFloat(getVal('live-window')) || 15;

  const body = { last_sec: lastSec, channels, db_target: dbTarget };
  if (dsn) body.dsn = dsn;

  try {
    const res  = await fetch('/api/plot/static', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.ok) {
      showAlert('live-session-msg', `✗ ${data.error}`, 'error');
      return;
    }

    const chKeys = Object.keys(data.data);
    if (!chKeys.length) {
      showAlert('live-session-msg', '⌛ Waiting for new records in TimescaleDB...', 'info');
      document.getElementById('plot-empty')?.classList.remove('hidden');
      return;
    }

    const empty = document.getElementById('plot-empty');
    if (empty) empty.classList.add('hidden');
    hideAlert('live-session-msg');

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
    const rangeStr  = `${fmtTime(data.start)} → ${fmtTime(data.end)}`;
    document.getElementById('static-time-range').textContent = `Live: ${rangeStr} (${totalRows.toLocaleString()} rows)`;

  } catch (e) {
    showAlert('live-session-msg', `✗ Network error: ${e}`, 'error');
  }
}

function toggleLiveSession() {
  const btn = document.getElementById('btn-toggle-poll');
  const dot = document.getElementById('plot-chart-dot');
  if (!btn) return;

  if (livePollInterval) {
    clearInterval(livePollInterval);
    livePollInterval = null;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Live Session`;
    btn.className = "btn btn-primary";
    if (dot) dot.style.animation = "none";
    showAlert('live-session-msg', 'Live Session paused.', 'info');
    appendLog('Live Session polling paused', 'info');
  } else {
    clearChart();
    pollDB();
    livePollInterval = setInterval(pollDB, 1000);
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Stop Live Session`;
    btn.className = "btn btn-danger";
    if (dot) dot.style.animation = "pulse-glow 2s infinite";
    appendLog('Live Session polling started (1s interval)', 'info');
  }
}

function clearLiveChart() {
  clearChart();
  _liveEmpty = true;
  const empty = document.getElementById('plot-empty');
  if (empty) empty.classList.remove('hidden');
}

function resetPlotZoom() {
  if (plotChart) {
    plotChart.resetZoom();
  }
}

async function runStaticPlot() {
  if (_plotMode !== 'history') return;

  const dbTarget = getVal('plot-db-target');
  const dsn      = dbTarget === 'custom' ? (getVal('plot-dsn-override').trim() || null) : null;
  const chStr    = getVal('static-channels').trim();
  const channels = chStr
    ? chStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
    : [];
  const lastSec  = parseFloat(getVal('static-last')) || 60;
  const startRaw = getVal('static-start');
  const endRaw   = getVal('static-end');

  const body = { last_sec: lastSec, channels, db_target: dbTarget };
  if (dsn)      body.dsn   = dsn;
  if (startRaw) body.start = new Date(startRaw).toISOString();
  if (endRaw)   body.end   = new Date(endRaw).toISOString();

  const btn = document.getElementById('btn-query');
  btn.disabled = true;
  btn.textContent = '⏳ Querying…';

  showAlert('static-result-msg', '⏳ Querying database…', 'info');

  try {
    const res  = await fetch('/api/plot/static', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.ok) {
      showAlert('static-result-msg', `✗ ${data.error}`, 'error');
      return;
    }

    const chKeys = Object.keys(data.data);
    if (!chKeys.length) {
      showAlert('static-result-msg', 'No data found for the given time range.', 'info');
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
    const rangeStr  = `${fmtTime(data.start)} → ${fmtTime(data.end)}`;
    document.getElementById('static-time-range').textContent = rangeStr;
    showAlert('static-result-msg', `✓ ${totalRows.toLocaleString()} rows plotted across ${chKeys.length} channel(s)`, 'success');
    appendLog(`Static plot: ${totalRows.toLocaleString()} rows, channels [${chKeys.join(', ')}]`, 'info');

  } catch (e) {
    showAlert('static-result-msg', `✗ Network error: ${e}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Query &amp; Plot`;
  }
}

async function fetchChannels() {
  const dbTarget = getVal('plot-db-target');
  const dsn      = dbTarget === 'custom' ? (getVal('plot-dsn-override').trim() || null) : null;
  showAlert('static-result-msg', '⏳ Fetching channels…', 'info');
  try {
    const res  = await fetch('/api/db/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db_target: dbTarget, dsn }),
    });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('static-channels').value = data.channels.join(',');
      showAlert('static-result-msg', `✓ Available channels: [${data.channels.join(', ')}]`, 'success');
    } else {
      showAlert('static-result-msg', `✗ ${data.error}`, 'error');
    }
  } catch (e) {
    showAlert('static-result-msg', `✗ Error: ${e}`, 'error');
  }
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
  } catch { return iso; }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════

function showAlert(id, msg, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert ${type}`;
}

function hideAlert(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'alert hidden';
}

// ═══════════════════════════════════════════════════════════════════════════
// REACTIVE FORM LISTENERS
// ═══════════════════════════════════════════════════════════════════════════

// Re-render waveform rows when channel count changes (preserve existing values)
document.getElementById('inp-ch-count')?.addEventListener('change', () => {
  const n   = parseInt(getVal('inp-ch-count')) || 4;
  const wf  = [];
  document.querySelectorAll('.waveform-row').forEach(row => {
    wf.push({
      amp:  parseFloat(row.querySelector('.wf-amp')?.value)  || 1.0,
      freq: parseFloat(row.querySelector('.wf-freq')?.value) || 10.0,
      dc:   parseFloat(row.querySelector('.wf-dc')?.value)   || 2.5,
    });
  });
  while (wf.length < n) wf.push({ amp: 1.0, freq: 10.0, dc: 2.5 });
  renderWaveforms({
    ..._currentCfg,
    channel_count: n,
    start_channel: parseInt(getVal('inp-start-ch')) || 0,
    waveforms: wf,
  });
});

// Recompute derived values on DAQ field input
['inp-ch-count', 'inp-clock', 'inp-seclen', 'inp-queue-max'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    updateDerived({
      channel_count:  parseInt(getVal('inp-ch-count'))  || 4,
      clock_rate:     parseInt(getVal('inp-clock'))      || 1000,
      section_length: parseInt(getVal('inp-seclen'))     || 256,
      queue_maxsize:  parseInt(getVal('inp-queue-max'))  || 200,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

(async () => {
  // Load config & populate forms
  await loadConfig();

  // Initialize chart
  initPlotChart();

  // Poll initial pipeline status
  try {
    const res = await fetch('/api/pipeline/status');
    const s   = await res.json();
    updateStats(s);
  } catch (_) {}

  appendLog('DAQ USB-4716 Control Center initialized', 'info');
})();
