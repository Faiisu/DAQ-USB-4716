# MDDP Telemetry Visualizer: Developer Extension Guide

This guide explains the design patterns and extension points of the plotting service. It provides a step-by-step walkthrough for adding support for new database schemas and device types (such as Musashi II and Musashi IV) in the future.

---

## 1. Current Architecture Overview

The plotting service acts as a standalone analytics client decoupled from the data ingestion pipelines:

```
[Database] ➔ [Flask API (app.py)] ➔ [Browser (Plotly.js)]
```

* **Backend (`app.py`)**: Fetches DSN from the shared `config.json`, establishes connection pools via `psycopg2`, and exposes endpoints `/api/channels` and `/api/data` to query data.
* **Frontend (`app.js` / `index.html`)**: Renders interactive line plots using Plotly.js. Tooltips are formatted using `hovertemplate` to display millisecond precision (`%H:%M:%S.%L`), and drag-panning is enabled natively by setting `dragmode: 'pan'`.

---

## 2. Telemetry Ingestion Contract: DAQ (Current Implementation)

Currently, the service retrieves data from the DAQ ingestion table `daq_samples`:

* **Schema**:
  * `time`: `TIMESTAMPTZ` (TimescaleDB hypertable key)
  * `channel`: `SMALLINT` (corresponds to analog input index)
  * `value`: `DOUBLE PRECISION` (analog voltage level)

* **Query Logic**:
  Queries utilize indices `idx_mockup_channel_time` (channel, time DESC) to retrieve data sorted chronologically:
  ```sql
  SELECT time, value FROM daq_samples 
  WHERE channel = %s AND time >= %s AND time <= %s 
  ORDER BY time ASC;
  ```

---

## 3. How to Add a New Service (e.g., Musashi II or IV)

To support another device database table in the future, follow these four steps:

### Step 1: Design the Database Schema
Ensure the new table (e.g., `musashi_logs`) uses `time` as a primary key partition.
```sql
CREATE TABLE IF NOT EXISTS musashi_logs (
    time        TIMESTAMPTZ      NOT NULL,
    pressure    DOUBLE PRECISION NOT NULL,
    fluid_temp  DOUBLE PRECISION,
    status      VARCHAR(30)
);
SELECT create_hypertable('musashi_logs', 'time', if_not_exists => TRUE);
```

### Step 2: Add API Endpoints in `app.py`
Extend `app.py` to route queries for the new service. You can introduce a `service` query parameter or add a dedicated endpoint `/api/musashi`:

```python
@app.route('/api/data/musashi')
def get_musashi_data():
    last_sec = request.args.get('last', default=60, type=float)
    dsn = get_db_dsn()
    conn = None
    try:
        conn = psycopg2.connect(dsn)
        query = """
            SELECT time, pressure, fluid_temp 
            FROM musashi_logs 
            WHERE time >= NOW() - INTERVAL '%s second'
            ORDER BY time ASC;
        """
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(query, (last_sec,))
            rows = cur.fetchall()
            
            times = [r['time'].isoformat() for r in rows]
            pressure = [r['pressure'] for r in rows]
            temp = [r['fluid_temp'] for r in rows]
            
        return jsonify({
            'times': times,
            'pressure': pressure,
            'temp': temp
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()
```

### Step 3: Add UI Selector in `index.html`
Add a dropdown selector to allow users to switch between the active telemetry view:

```html
<!-- Add in index.html control-panel -->
<div class="control-group">
    <label for="service-select">ACTIVE SERVICE</label>
    <select id="service-select" class="form-input">
        <option value="daq" selected>DAQ USB-4716</option>
        <option value="musashi2">Musashi II Dispenser</option>
    </select>
</div>
```

### Step 4: Map Visual Layouts in `app.js`
Modify `static/app.js` to dynamically draw the plot based on the selected service:

```javascript
// Add in static/app.js
async function queryDatabase() {
    const service = document.getElementById('service-select').value;
    
    if (service === 'musashi2') {
        const res = await fetch(`/api/data/musashi?last=60`);
        const data = await res.json();
        
        // Render dual-trace (Pressure + Temperature) on Plotly
        const traces = [
            {
                x: data.times,
                y: data.pressure,
                name: 'Dispenser Pressure (kPa)',
                line: { color: '#a855f7' } // Purple accent
            },
            {
                x: data.times,
                y: data.temp,
                name: 'Fluid Temperature (°C)',
                line: { color: '#f59e0b' } // Amber accent
            }
        ];
        
        Plotly.react('plotly-chart', traces, layout);
    } else {
        // Fallback to normal DAQ rendering...
    }
}
```
