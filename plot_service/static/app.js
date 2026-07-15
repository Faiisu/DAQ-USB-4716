// app.js
// See: docs/architecture/context.md
// English comments only

let autoRefreshInterval = null;
let currentService = 'daq';

document.addEventListener('DOMContentLoaded', () => {
    // Start clock display
    updateClock();
    setInterval(updateClock, 1000);

    // Initial setup
    fetchChannels();
    initChart();
    queryDatabase();

    // Event listeners
    document.getElementById('service-select').addEventListener('change', handleServiceChange);
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

// Fetch available DAQ channels on startup
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
                opt.textContent = `Channel ${ch} (DAQ)`;
                channelSelect.appendChild(opt);
            });
        }
    } catch (e) {
        console.error("Failed to fetch channel list:", e);
    }
}

// Handle switching between systems (DAQ, Musashi II, Musashi IV)
function handleServiceChange() {
    currentService = document.getElementById('service-select').value;
    const daqGroup = document.getElementById('daq-controls-group');
    
    if (currentService === 'daq') {
        daqGroup.classList.remove('hidden');
    } else {
        daqGroup.classList.add('hidden');
    }
    
    // Clear and redraw the chart structure immediately for the selected service
    initChart();
    queryDatabase();
}

// Toggle custom date picker inputs based on selection
function handleTimeRangeChange() {
    const timeRange = document.getElementById('time-range-select').value;
    const customTimeInputs = document.getElementById('custom-time-inputs');
    
    if (timeRange === 'custom') {
        customTimeInputs.classList.remove('hidden');
        const now = new Date();
        const start = new Date(now.getTime() - 5 * 60 * 1000);
        document.getElementById('start-datetime').value = toLocalISOString(start);
        document.getElementById('end-datetime').value = toLocalISOString(now);
    } else {
        customTimeInputs.classList.add('hidden');
    }
}

// Helper to format datetime-local inputs
function toLocalISOString(date) {
    const tzOffset = date.getTimezoneOffset() * 60000;
    return (new Date(date.getTime() - tzOffset)).toISOString().slice(0, 16);
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

// Define the static Chart Layout parameters matching the dark-grey theme
const chartLayout = {
    paper_bgcolor: '#1c1e22',
    plot_bgcolor: '#0f1013',
    margin: { t: 30, r: 40, b: 40, l: 50 },
    dragmode: 'pan', // Default to pan/slide mode
    legend: {
        font: { color: '#cbd5e1', size: 9 },
        orientation: 'h',
        y: 1.1
    },
    xaxis: {
        type: 'date',
        gridcolor: '#2b2f38',
        zerolinecolor: '#3f4756',
        tickcolor: '#2b2f38',
        tickfont: { color: '#cbd5e1', size: 10 },
        hoverformat: '%H:%M:%S.%L'
    },
    yaxis: {
        gridcolor: '#2b2f38',
        zerolinecolor: '#3f4756',
        tickcolor: '#2b2f38',
        tickfont: { color: '#cbd5e1', size: 10 },
        autorange: true
    }
};

const chartConfig = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d']
};

// Initialize or reset the Plotly chart structure based on active service
function initChart() {
    let initialTraces = [];
    
    if (currentService === 'daq') {
        initialTraces.push({
            x: [],
            y: [],
            name: 'DAQ Voltage',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#0ea5e9', width: 1.5 },
            hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>Voltage:</b> %{y:.4f} V<extra></extra>'
        });
    } else if (currentService === 'musashi_ii') {
        initialTraces.push({
            x: [],
            y: [],
            name: 'Dispenser Pressure',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#a855f7', width: 1.5 },
            hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>Pressure:</b> %{y:.2f} kPa<extra></extra>'
        }, {
            x: [],
            y: [],
            name: 'Fluid Temp',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#f59e0b', width: 1.5 },
            hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>Temp:</b> %{y:.2f} °C<extra></extra>'
        });
    } else if (currentService === 'musashi_iv') {
        initialTraces.push({
            x: [],
            y: [],
            name: 'Axis X',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#38bdf8', width: 1.2 },
            hovertemplate: '<b>X:</b> %{y:.3f} mm<extra></extra>'
        }, {
            x: [],
            y: [],
            name: 'Axis Y',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#10b981', width: 1.2 },
            hovertemplate: '<b>Y:</b> %{y:.3f} mm<extra></extra>'
        }, {
            x: [],
            y: [],
            name: 'Axis Z',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#ef4444', width: 1.2 },
            hovertemplate: '<b>Z:</b> %{y:.3f} mm<extra></extra>'
        });
    }

    Plotly.newPlot('plotly-chart', initialTraces, chartLayout, chartConfig);
}

// Fetch database metrics (or mock data) and render on graph
async function queryDatabase() {
    const rangeType = document.getElementById('time-range-select').value;
    let url = '';
    
    // Choose endpoint based on service
    if (currentService === 'daq') {
        const channel = parseInt(document.getElementById('channel-select').value, 10);
        url = `/api/data?channel=${channel}`;
    } else {
        url = `/api/data/mock?service=${currentService}`;
    }
    
    // Append range bounds
    if (rangeType === 'custom') {
        const startVal = document.getElementById('start-datetime').value;
        const endVal = document.getElementById('end-datetime').value;
        if (!startVal || !endVal) return;
        
        const startISO = new Date(startVal).toISOString();
        const endISO = new Date(endVal).toISOString();
        url += `&start=${startISO}&end=${endISO}`;
    } else {
        const seconds = parseInt(rangeType, 10);
        url += `&last=${seconds}`;
    }

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Telemetry query failed.");
        const result = await res.json();

        updateChart(result);
    } catch (e) {
        console.error("Telemetry query error:", e);
    }
}

// Re-draw traces with fresh database data
function updateChart(result) {
    const yMinInput = document.getElementById('y-min-input').value;
    const yMaxInput = document.getElementById('y-max-input').value;

    const yAxisUpdate = {};
    if (yMinInput !== "" && yMaxInput !== "") {
        yAxisUpdate.autorange = false;
        yAxisUpdate.range = [parseFloat(yMinInput), parseFloat(yMaxInput)];
    } else {
        yAxisUpdate.autorange = true;
    }

    const times = result.times;
    let traces = [];

    // Dynamically build traces based on current service type
    if (currentService === 'daq') {
        traces.push({
            x: times,
            y: result.values,
            name: 'DAQ Voltage',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#0ea5e9', width: 1.5 },
            hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>Voltage:</b> %{y:.4f} V<extra></extra>'
        });
    } else if (currentService === 'musashi_ii') {
        traces.push({
            x: times,
            y: result.data.pressure,
            name: 'Pressure (kPa)',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#a855f7', width: 1.5 },
            hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>Pressure:</b> %{y} kPa<extra></extra>'
        }, {
            x: times,
            y: result.data.temp,
            name: 'Fluid Temp (°C)',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#f59e0b', width: 1.5 },
            hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>Temp:</b> %{y} °C<extra></extra>'
        });
    } else if (currentService === 'musashi_iv') {
        traces.push({
            x: times,
            y: result.data.x,
            name: 'Axis X',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#38bdf8', width: 1.2 },
            hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>X:</b> %{y} mm<extra></extra>'
        }, {
            x: times,
            y: result.data.y,
            name: 'Axis Y',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#10b981', width: 1.2 },
            hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>Y:</b> %{y} mm<extra></extra>'
        }, {
            x: times,
            y: result.data.z,
            name: 'Axis Z',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#ef4444', width: 1.2 },
            hovertemplate: '<b>Time:</b> %{x|%H:%M:%S.%L}<br><b>Z:</b> %{y} mm<extra></extra>'
        });
    }

    // Apply scaling update to global layout
    chartLayout.yaxis = Object.assign({}, chartLayout.yaxis, yAxisUpdate);

    // Call Plotly.react for highly efficient dynamic trace re-rendering
    Plotly.react('plotly-chart', traces, chartLayout, chartConfig);
}
