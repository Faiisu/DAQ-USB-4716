// app.js
// See: docs/architecture/context.md
// English comments only

let autoRefreshInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    // Start clock display
    updateClock();
    setInterval(updateClock, 1000);

    // Initial setup
    fetchChannels();
    initChart();
    queryDatabase();

    // Event listeners
    document.getElementById('time-range-select').addEventListener('change', handleTimeRangeChange);
    document.getElementById('refresh-btn').addEventListener('click', queryDatabase);
    document.getElementById('auto-refresh').addEventListener('change', handleAutoRefreshToggle);

    // Initial check for auto-refresh
    handleAutoRefreshToggle();
});

// Update header clock (UTC)
function updateClock() {
    const clockEl = document.getElementById('realtime-clock');
    if (!clockEl) return;
    const now = new Date();
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    clockEl.textContent = `${hours}:${minutes}:${seconds} UTC`;
}

// Dynamically fetch channels from DB and populate dropdown
async function fetchChannels() {
    const channelSelect = document.getElementById('channel-select');
    try {
        const res = await fetch('/api/channels');
        const channels = await res.json();
        if (channels.length > 0) {
            channelSelect.innerHTML = '';
            channels.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch;
                opt.textContent = `Channel ${ch} (${ch === 0 ? 'DAQ' : 'Generic'})`;
                channelSelect.appendChild(opt);
            });
        }
    } catch (e) {
        console.error("Failed to fetch channel list:", e);
    }
}

// Toggle custom date picker inputs based on selection
function handleTimeRangeChange() {
    const timeRange = document.getElementById('time-range-select').value;
    const customTimeInputs = document.getElementById('custom-time-inputs');
    
    if (timeRange === 'custom') {
        customTimeInputs.classList.remove('hidden');
        
        // Populate default custom times (start: 5 mins ago, end: now)
        const now = new Date();
        const start = new Date(now.getTime() - 5 * 60 * 1000);
        
        // Convert to Local ISO string (YYYY-MM-DDTHH:MM) required by datetime-local inputs
        document.getElementById('start-datetime').value = toLocalISOString(start);
        document.getElementById('end-datetime').value = toLocalISOString(now);
    } else {
        customTimeInputs.classList.add('hidden');
    }
}

// Helper to format datetime-local strings
function toLocalISOString(date) {
    const tzOffset = date.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date.getTime() - tzOffset)).toISOString().slice(0, 16);
    return localISOTime;
}

// Handle auto-refresh interval loops
function handleAutoRefreshToggle() {
    const isChecked = document.getElementById('auto-refresh').checked;
    
    if (isChecked) {
        if (!autoRefreshInterval) {
            autoRefreshInterval = setInterval(queryDatabase, 1000);
        }
    } else {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }
}

// Initialize empty Plotly chart
function initChart() {
    const plotData = [{
        x: [],
        y: [],
        type: 'scatter',
        mode: 'lines',
        name: 'Telemetry Signal',
        line: {
            color: '#0ea5e9',
            width: 1.5
        },
        // Formatting tooltip with millisecond precision
        hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>Value:</b> %{y:.4f} V<extra></extra>'
    }];

    const layout = {
        paper_bgcolor: '#1c1e22',
        plot_bgcolor: '#0f1013',
        margin: { t: 20, r: 20, b: 40, l: 50 },
        // Enable sliding/dragging by setting default dragmode to 'pan'
        dragmode: 'pan',
        xaxis: {
            type: 'date',
            gridcolor: '#2b2f38',
            zerolinecolor: '#3f4756',
            tickcolor: '#2b2f38',
            tickfont: { color: '#cbd5e1', size: 10 },
            hoverformat: '%H:%M:%S.%L' // format time as HH:MM:SS.mmm in tooltip
        },
        yaxis: {
            gridcolor: '#2b2f38',
            zerolinecolor: '#3f4756',
            tickcolor: '#2b2f38',
            tickfont: { color: '#cbd5e1', size: 10 },
            autorange: true
        }
    };

    const config = {
        responsive: true,
        displaylogo: false,
        // Include buttons for zoom/pan on the graph toolbar
        modeBarButtonsToRemove: ['lasso2d', 'select2d']
    };

    Plotly.newPlot('plotly-chart', plotData, layout, config);
}

// Query TimeScaleDB and update the chart
async function queryDatabase() {
    const channel = parseInt(document.getElementById('channel-select').value, 10);
    const rangeType = document.getElementById('time-range-select').value;
    
    let url = `/api/data?channel=${channel}`;
    
    if (rangeType === 'custom') {
        const startVal = document.getElementById('start-datetime').value;
        const endVal = document.getElementById('end-datetime').value;
        
        if (!startVal || !endVal) {
            console.warn("Custom range values missing.");
            return;
        }
        
        // Convert local times to ISO format
        const startISO = new Date(startVal).toISOString();
        const endISO = new Date(endVal).toISOString();
        url += `&start=${startISO}&end=${endISO}`;
    } else {
        const seconds = parseInt(rangeType, 10);
        url += `&last=${seconds}`;
    }

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Database query failed.");
        const data = await res.json();

        updateChart(data.times, data.values);
    } catch (e) {
        console.error("Telemetry query error:", e);
    }
}

// Push fresh data and refresh the Plotly layout
function updateChart(times, values) {
    const yMinInput = document.getElementById('y-min-input').value;
    const yMaxInput = document.getElementById('y-max-input').value;

    const yAxisUpdate = {};
    
    // Check if user set custom Y scale overrides
    if (yMinInput !== "" && yMaxInput !== "") {
        yAxisUpdate.autorange = false;
        yAxisUpdate.range = [parseFloat(yMinInput), parseFloat(yMaxInput)];
    } else {
        yAxisUpdate.autorange = true;
    }

    // Refresh layout and scatter line data
    Plotly.update('plotly-chart', {
        x: [times],
        y: [values]
    }, {
        yaxis: yAxisUpdate
    });
}
