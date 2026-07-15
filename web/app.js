// app.js
// See: docs/architecture/context.md
// English comments only

// System Start Timestamp
const startTimestamp = Date.now();

// Start Clock and Counters
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    
    updateUptime();
    setInterval(updateUptime, 1000);

    // Simulate occasional background system activity logs
    setInterval(simulateSystemLog, 15000);
});

// Update the real-time clock in the header (UTC time preferred for process alignment)
function updateClock() {
    const clockEl = document.getElementById('realtime-clock');
    if (!clockEl) return;
    
    const now = new Date();
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    
    clockEl.textContent = `${hours}:${minutes}:${seconds} UTC`;
}

// Update uptime tracker since page was loaded
function updateUptime() {
    const uptimeEl = document.getElementById('uptime-counter');
    if (!uptimeEl) return;
    
    const diff = Math.floor((Date.now() - startTimestamp) / 1000);
    const hours = String(Math.floor(diff / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
    const seconds = String(diff % 60).padStart(2, '0');
    
    uptimeEl.textContent = `${hours}:${minutes}:${seconds}`;
}

// Display a dynamic toast notification when clicking control modules
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = message;
    
    // Set border accent color based on action type
    if (type === 'blue') {
        toast.style.borderColor = '#0ea5e9';
    } else if (type === 'purple') {
        toast.style.borderColor = '#a855f7';
    } else if (type === 'emerald') {
        toast.style.borderColor = '#10b981';
    }

    toast.classList.add('show');

    // Hide after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Navigation event handler for module cards
function navigateTo(moduleName) {
    let message = '';
    let themeColor = 'info';

    switch (moduleName) {
        case 'daq':
            message = 'Navigating to DAQ USB-4716 Control Console...';
            themeColor = 'blue';
            appendLog('INFO', 'Initiating redirect sequence to DAQ telemetry view.');
            break;
        case 'musashi-ii':
            message = 'Navigating to Musashi II Dispenser Controller...';
            themeColor = 'purple';
            appendLog('INFO', 'Connecting to Musashi II communication interface.');
            break;
        case 'musashi-iv':
            message = 'Navigating to Musashi IV Robotic Dispenser node...';
            themeColor = 'emerald';
            appendLog('INFO', 'Establishing serial bridge over COM4.');
            break;
        default:
            message = 'Loading selected module...';
    }

    showToast(message, themeColor);
}

// Append new log lines to the scrolling terminal console footer
function appendLog(level, message) {
    const consoleBody = document.getElementById('log-console');
    if (!consoleBody) return;

    const now = new Date();
    const timeStr = `[${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}]`;
    
    const logLine = document.createElement('div');
    logLine.className = 'log-line';
    
    let tagClass = 'tag-info';
    if (level === 'SUCCESS') tagClass = 'tag-success';
    if (level === 'WARN') tagClass = 'tag-warning';
    
    logLine.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-tag ${tagClass}">${level}</span> ${message}`;
    
    consoleBody.appendChild(logLine);
    
    // Auto-scroll to the bottom of the console log
    consoleBody.scrollTop = consoleBody.scrollHeight;
}

// Simulate periodic hardware events for background logging realism
const dummyEvents = [
    { level: 'INFO', msg: 'Database metrics sync completed. 0 packets dropped.' },
    { level: 'INFO', msg: 'Heartbeat signal acknowledged from Musashi II controller.' },
    { level: 'SUCCESS', msg: 'TimescaleDB hypertable optimized. Disk write latencies normal (<2ms).' },
    { level: 'WARN', msg: 'High jitter detected on hardware clock. Aligning back-computation buffer.' },
    { level: 'INFO', msg: 'Checking client connection handshakes...' }
];

function simulateSystemLog() {
    const event = dummyEvents[Math.floor(Math.random() * dummyEvents.length)];
    appendLog(event.level, event.msg);
}
