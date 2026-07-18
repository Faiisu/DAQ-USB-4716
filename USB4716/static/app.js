// app.js
// See: docs/architecture/context.md
// English comments only

const socket = io();
let isSystemRunning = false;
let scaleConfigs = {};
let currentScaleChannel = '0';

document.addEventListener('DOMContentLoaded', () => {
    // Start clock thread
    updateClock();
    setInterval(updateClock, 1000);

    // Initial API loads
    loadConfig();
    checkProcessStatus();

    // Setup form submit handlers
    const form = document.getElementById('config-form');
    form.addEventListener('submit', handleConfigSave);

    // Setup scaling toggle and target channel listeners
    document.getElementById('SCALE_ENABLED').addEventListener('change', toggleScalingFields);
    document.getElementById('SCALE_CHANNEL_TARGET').addEventListener('change', handleScaleChannelTargetChange);

    // Setup action buttons
    document.getElementById('start-btn').addEventListener('click', handleStartProcess);
    document.getElementById('stop-btn').addEventListener('click', handleStopProcess);
    document.getElementById('clear-console-btn').addEventListener('click', clearConsole);

    // Bind Socket.IO event listeners
    bindSocketEvents();
});

// Update Header UTC Clock Display
function updateClock() {
    const clockEl = document.getElementById('realtime-clock');
    if (!clockEl) return;
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = `${hours}:${minutes}:${seconds}`;
}

// Fetch and load configuration into form fields
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error("Failed to load config.");
        const config = await res.json();
        
        // Populate standard inputs
        Object.keys(config).forEach(key => {
            const input = document.getElementById(key);
            if (input && key !== 'SCALE_CONFIGS') {
                if (input.type === 'checkbox') {
                    input.checked = config[key];
                } else {
                    input.value = config[key];
                }
            }
        });
        
        // Store per-channel scale configurations
        scaleConfigs = config.SCALE_CONFIGS || {};
        currentScaleChannel = document.getElementById('SCALE_CHANNEL_TARGET').value || '0';
        loadScaleChannelToInputs(currentScaleChannel);
        
        appendLog('INFO', 'System configuration loaded from config.json.');
    } catch (e) {
        appendLog('ERROR', `Failed to load config: ${e.message}`);
    }
}

// Check if a process is already running on page load
async function checkProcessStatus() {
    try {
        const res = await fetch('/api/status');
        if (!res.ok) throw new Error("Failed to get status.");
        const status = await res.json();
        updateUIState(status.is_running, status.run_mode);
    } catch (e) {
        appendLog('ERROR', `Failed to query process status: ${e.message}`);
    }
}

// Update Start/Stop buttons and indicator dots
function updateUIState(running, mode = 'mockup') {
    isSystemRunning = running;
    
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const modeSelect = document.getElementById('mode-select');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const statusIndicator = document.getElementById('system-status-indicator');

    if (running) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        modeSelect.disabled = true;
        
        statusIndicator.classList.add('active');
        statusDot.className = 'pulse-dot green';
        statusText.textContent = `RUNNING (${mode.toUpperCase()})`;
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        modeSelect.disabled = false;
        
        statusIndicator.classList.remove('active');
        statusDot.className = 'pulse-dot offline';
        statusText.textContent = 'OFFLINE';
        
        // Reset telemetry values to 0
        document.getElementById('telemetry-queue').textContent = '0 / 200';
    }
}

// Intercept form submissions and update JSON configuration on the server
async function handleConfigSave(e) {
    e.preventDefault();
    
    // Save current active scaling inputs first
    saveInputsToScaleChannel(currentScaleChannel);
    
    const configData = {};
    const elements = e.target.elements;
    
    // Parse form fields manually to support checkboxes, integers, and custom keys
    for (let el of elements) {
        if (!el.name) continue; // Excludes channel-specific scaling inputs without name attrs
        
        if (el.type === 'checkbox') {
            configData[el.name] = el.checked;
        } else if (el.name === 'ANCHOR_RECALIBRATE_INTERVAL_HR') {
            configData[el.name] = parseFloat(el.value);
        } else if (['START_CHANNEL', 'CHANNEL_COUNT', 'CLOCK_RATE', 'SECTION_LENGTH', 'SECTION_COUNT', 'QUEUE_MAXSIZE', 'DB_PAGE_SIZE', 'STATS_INTERVAL_SEC'].includes(el.name)) {
            configData[el.name] = parseInt(el.value, 10);
        } else {
            configData[el.name] = el.value;
        }
    }

    // Inject scaling configs dictionary
    configData['SCALE_CONFIGS'] = scaleConfigs;

    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(configData)
        });
        
        if (!res.ok) throw new Error("Failed to save.");
        showToast("Configuration saved successfully.");
        appendLog('SUCCESS', 'Configuration changes committed to config.json.');
    } catch (e) {
        showToast("Error saving configuration.", true);
        appendLog('ERROR', `Failed to write config: ${e.message}`);
    }
}

// Handle Run command
function handleStartProcess() {
    const mode = document.getElementById('mode-select').value;
    socket.emit('start_daq', { mode: mode });
}

// Handle Stop command
function handleStopProcess() {
    socket.emit('stop_daq');
}

// Clear terminal logs
function clearConsole() {
    const consoleBody = document.getElementById('console-output');
    if (consoleBody) {
        consoleBody.innerHTML = '<div class="log-line text-muted">[CONSOLE] Logs cleared.</div>';
    }
}

// Append log message directly inside console body
function appendLog(level, message) {
    const consoleBody = document.getElementById('console-output');
    if (!consoleBody) return;

    const now = new Date();
    const timeStr = `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
    
    const logLine = document.createElement('div');
    logLine.className = 'log-line';
    
    let tagClass = 'text-muted';
    if (level === 'SUCCESS') tagClass = 'text-success';
    if (level === 'ERROR' || level === 'WARN') tagClass = 'text-error';
    
    logLine.innerHTML = `<span class="log-time">${timeStr}</span> <span class="${tagClass}">${message}</span>`;
    consoleBody.appendChild(logLine);
    
    // Auto-scroll
    consoleBody.scrollTop = consoleBody.scrollHeight;
}

// Display simple alert toaster
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    
    if (isError) {
        toast.style.borderColor = '#ef4444';
    } else {
        toast.style.borderColor = '#0ea5e9';
    }
    
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Setup WebSocket triggers
function bindSocketEvents() {
    socket.on('connect', () => {
        appendLog('SUCCESS', 'WebSocket bridge connected.');
    });

    socket.on('disconnect', () => {
        appendLog('ERROR', 'WebSocket bridge disconnected.');
        updateUIState(false);
    });

    // Update status elements
    socket.on('status_change', (data) => {
        updateUIState(data.is_running, data.mode);
    });

    // Handle new log streams
    socket.on('log_update', (data) => {
        const line = data.log;
        let level = 'INFO';
        if (line.includes('error') || line.includes('Error') || line.includes('failed') || line.includes('Full!')) {
            level = 'ERROR';
        } else if (line.includes('started') || line.includes('connected') || line.includes('ready') || line.includes('ready')) {
            level = 'SUCCESS';
        }
        appendLog(level, line);
    });

    // Process statistics and telemetry
    socket.on('stats_update', (data) => {
        document.getElementById('telemetry-polled').textContent = data.polled;
        document.getElementById('telemetry-written').textContent = data.written;
        document.getElementById('telemetry-queue').textContent = data.queue_util;
        
        const lossVal = document.getElementById('telemetry-loss');
        lossVal.textContent = `${data.loss_pct}% (${data.dropped})`;
        
        // Highlight loss if rate is above 0
        if (parseInt(data.dropped, 10) > 0) {
            lossVal.className = 'telemetry-value monospace text-error';
        } else {
            lossVal.className = 'telemetry-value monospace text-amber';
        }
    });
}

// Enable/Disable scaling sub-inputs based on toggle checkbox
function toggleScalingFields() {
    const isEnabled = document.getElementById('SCALE_ENABLED').checked;
    const fields = ['SCALE_LOW_VOLTAGE', 'SCALE_HIGH_VOLTAGE', 'SCALE_LOW_VALUE', 'SCALE_HIGH_VALUE'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !isEnabled;
            el.required = isEnabled; // Require input values if enabled
        }
    });
}

// Load calibration data from config object to input fields
function loadScaleChannelToInputs(ch) {
    const cfg = scaleConfigs[ch] || { enabled: false, low_voltage: 0.0, high_voltage: 10.0, low_value: 0.0, high_value: 100.0 };
    document.getElementById('SCALE_ENABLED').checked = cfg.enabled;
    document.getElementById('SCALE_LOW_VOLTAGE').value = cfg.low_voltage;
    document.getElementById('SCALE_HIGH_VOLTAGE').value = cfg.high_voltage;
    document.getElementById('SCALE_LOW_VALUE').value = cfg.low_value;
    document.getElementById('SCALE_HIGH_VALUE').value = cfg.high_value;
    toggleScalingFields();
}

// Save inputs back to active channel configuration in memory
function saveInputsToScaleChannel(ch) {
    scaleConfigs[ch] = {
        enabled: document.getElementById('SCALE_ENABLED').checked,
        low_voltage: parseFloat(document.getElementById('SCALE_LOW_VOLTAGE').value) || 0.0,
        high_voltage: parseFloat(document.getElementById('SCALE_HIGH_VOLTAGE').value) || 10.0,
        low_value: parseFloat(document.getElementById('SCALE_LOW_VALUE').value) || 0.0,
        high_value: parseFloat(document.getElementById('SCALE_HIGH_VALUE').value) || 100.0
    };
}

// Handle changes to target calibration channel selection
function handleScaleChannelTargetChange(e) {
    // 1. Save inputs of current channel
    saveInputsToScaleChannel(currentScaleChannel);
    // 2. Change channel index pointer
    currentScaleChannel = e.target.value;
    // 3. Load config of new channel into inputs
    loadScaleChannelToInputs(currentScaleChannel);
}
