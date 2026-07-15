// app.js
// See: docs/architecture/context.md
// English comments only

const socket = io();
let isSystemRunning = false;

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
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    clockEl.textContent = `${hours}:${minutes}:${seconds} UTC`;
}

// Fetch and load configuration into form fields
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error("Failed to load config.");
        const config = await res.json();
        
        // Populate inputs
        Object.keys(config).forEach(key => {
            const input = document.getElementById(key);
            if (input) {
                input.value = config[key];
            }
        });
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
    const formData = new FormData(e.target);
    const configData = {};
    
    formData.forEach((value, key) => {
        // Convert numeric fields back to ints
        if (['START_CHANNEL', 'CHANNEL_COUNT', 'CLOCK_RATE', 'HARDWARE_BUFFER_SIZE', 'SECTION_LENGTH', 'SECTION_COUNT', 'QUEUE_MAXSIZE', 'DB_PAGE_SIZE', 'STATS_INTERVAL_SEC'].includes(key)) {
            configData[key] = parseInt(value, 10);
        } else {
            configData[key] = value;
        }
    });

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
    const timeStr = `[${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}]`;
    
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
