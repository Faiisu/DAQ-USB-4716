---
name: daq-pipeline
description: >-
  Expert skill for the DAQ USB-4716 TimescaleDB data acquisition pipeline.
  Covers the full system: Python acquisition threads, TimescaleDB schema,
  Flask+SocketIO web backend, and the Chart.js frontend. Use when modifying
  any part of this project: stream_to_db.py, web_gui/app.py, config.py,
  HTML/CSS/JS frontend, or the DB schema.
---

# DAQ USB-4716 Pipeline — Project Skill

## System Overview

A real-time data acquisition system that:
1. Reads analog voltage samples from an **Advantech USB-4716** DAQ device via the BDaq SDK
2. Writes samples to **TimescaleDB** (PostgreSQL hypertable) at up to 1024 Hz per channel
3. Exposes a **Flask + Socket.IO web GUI** on port 5050 for live monitoring and control

## File Map

```
DAQ-USB-4716/
├── config.py                  # All constants: DAQ hw, DB DSN, pipeline tuning
├── stream_to_db.py            # Real pipeline: DAQ reader thread + DB writer thread
├── mockup_stream_to_db.py     # Mockup pipeline: synthetic waveform generator
├── CommonUtils.py             # kbhit() keyboard interrupt utility
├── db_setup.sql               # TimescaleDB schema (applied on first Docker start)
├── docker-compose.yml         # Local TimescaleDB via Docker
├── requirements.txt           # psycopg2-binary, flask, flask-socketio, eventlet
├── web_gui/
│ ├── app.py # Flask + SocketIO app entrypoint and routes
│ ├── config_manager.py # In-memory configuration manager & sync to config.py
│ ├── db.py # Database helpers, schema setup, and sessions
│ ├── pipeline.py # Real-time acquisition threads controller
│ ├── templates/index.html # Single-page app shell
│ └── static/
│ ├── style.css # Dark glassmorphism CSS
│ └── app.js # Socket.IO client + Chart.js logic
```

## Architecture

### 2-Thread Pipeline
- **DAQ Reader Thread**: polls hardware buffer every `SECTION_LENGTH / CLOCK_RATE` seconds, pushes raw interleaved float64 arrays into a `queue.Queue`
- **DB Writer Thread**: drains queue, reconstructs timestamps from `t0 + offset × dt`, batch-inserts with `psycopg2.extras.execute_values()`
- **Queue** acts as a ~100s safety buffer (200 batches × 0.5s)

### Web GUI Backend (Flask + Socket.IO)
- **Routes**: `GET /api/config`, `POST /api/config`, `POST /api/db/test`, `POST /api/pipeline/start`, `POST /api/pipeline/stop`, `GET /api/pipeline/status`, `GET /api/plot/live_snapshot`, `POST /api/plot/static`, `POST /api/db/channels`
- **SocketIO events emitted by server**: `log`, `stats`, `live_data`
- **Live ring buffer**: `_live_buf` dict keyed by channel int, max 500 points per channel
- **Chart pusher thread**: pushes last 50 points per channel at ~4 Hz via `socketio.emit("live_data", ...)`

### Database Schema
```sql
CREATE TABLE daq_samples (
    time    TIMESTAMPTZ      NOT NULL,
    channel SMALLINT         NOT NULL,
    value   DOUBLE PRECISION NOT NULL  -- volts (0–5 V range)
);
-- TimescaleDB hypertable on 'time' column
-- Index: (channel, time DESC)

CREATE TABLE daq_sessions (
    id            SERIAL PRIMARY KEY,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at    TIMESTAMPTZ,
    channel_count SMALLINT    NOT NULL,
    clock_rate_hz INTEGER     NOT NULL,
    notes         TEXT
);
```

## Key Conventions

1. **Timestamp strategy**: Single `t0 = datetime.now(utc)` captured once at pipeline start. All timestamps are derived as `t0 + (offset + s) × dt`. Never call `datetime.now()` per batch.
2. **Interleaved layout**: Raw data array is `[ch0_s0, ch1_s0, ch2_s0, ch0_s1, ch1_s1, ...]`. Index: `raw[s * n_ch + ch]`
3. **Section length constraint**: `SECTION_LENGTH ≤ HARDWARE_BUFFER_SIZE // CHANNEL_COUNT` (1024 // ch_count)
4. **Voltage range**: 0.0 to 5.0 V. Clamp outputs to this range in mockup.
5. **DB DSN**: `config.DB_DSN` is the real device DSN; `config.MOCKUP_DB_DSN` is for the mockup pipeline (separate database `mockup` inside the same Postgres instance).
6. **Port**: Web GUI always runs on `0.0.0.0:5050`.
7. **Frontend colour palette**: `['#7c6cf5', '#56cffa', '#4ade80', '#fb923c', '#f472b6', '#34d399', '#fbbf24', '#a78bfa']` — one per channel.

## Design Principles

- **Non-blocking**: DAQ thread never waits for DB. Queue decouples the two.
- **Graceful shutdown**: `Ctrl+C` → `stop_event.set()` → DB writer drains remaining queue → exits.
- **Resilience**: DB writer retries connection on failure; queue absorbs ~100s of DB downtime.
- **Thread safety**: All shared state uses `threading.Lock`. Stats dict, live buf, and config dict each have their own lock.

## Common Tasks

### Change sampling config
The Web GUI reads config on startup and exposes `/api/config` GET/POST for live editing.
When settings are saved in the GUI, they are automatically persisted back to `config.py` on disk so that running `python stream_to_db.py` from terminal uses the same parameters.

### Run locally (mockup, no hardware)
```bash
cd DAQ-USB-4716
docker compose up -d          # start TimescaleDB
python web_gui/app.py         # start Flask GUI on :5050
# Open http://localhost:5050
# Click "Start Mockup" on the Dashboard
```

### Run with Real Hardware
If running on the target machine with Advantech DAQNavi drivers and SDK installed:
1. Start TimescaleDB: `docker compose up -d`
2. Start Web GUI: `python web_gui/app.py`
3. Click "Start Real DAQ" on the Dashboard.
This runs the real hardware pipeline in a separate thread inside the GUI process, writes real samples to `DB_DSN`, records session information in the `daq_sessions` table, and streams live oscilloscope plots to the browser.
