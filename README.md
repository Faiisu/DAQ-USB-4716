# DAQ USB-4716 → TimescaleDB Pipeline

A real-time data acquisition pipeline for the **Advantech USB-4716** DAQ device.  
Streams analog input samples into a local **TimescaleDB** (PostgreSQL) database with zero data loss.

---

## Hardware Specification

| Property | Value |
|---|---|
| Device | Advantech USB-4716 |
| Max Sample Rate | 200 kS/s (shared across all channels) |
| Hardware Buffer | 1,024 samples (total, interleaved) |
| Resolution | 16-bit |
| Analog Inputs | 16 ch single-ended / 8 ch differential |
| Interface | USB |

> **Buffer constraint:** Hardware buffer is shared across channels.  
> With 2 channels: max `sectionLength = 1024 ÷ 2 = 512` samples per channel.  
> PC must drain the buffer within **~500 ms** or overflow occurs.

---

## Architecture

```
USB-4716 (hardware clock 1024 Hz)
     │
     │  Streaming AI (WaveformAiCtrl)
     ▼
┌──────────────────────────────────────────────────────┐
│  DAQ Reader Thread  (minimal work)                   │
│  • getDataF64(userBuffer, -1)  — blocks ~500ms       │
│  • capture batch timestamp                           │
│  • copy raw list → queue.put_nowait()                │
└─────────────────────┬────────────────────────────────┘
                      │  (batch_timestamp, raw_data, count)
                      ▼
            ┌─────────────────┐
            │  Python Queue   │  in-memory, thread-safe
            │  max 200 batches│  ≈ 100 s of safety buffer
            └────────┬────────┘
                      │
┌─────────────────────▼────────────────────────────────┐
│  DB Writer Thread  (non-daemon — flushes on exit)    │
│  • parse interleaved float64 array                   │
│  • interpolate per-sample timestamps                 │
│  • psycopg2 execute_values() batch INSERT            │
└──────────────────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  TimescaleDB (Docker)  │
         │  hypertable: daq_samples│
         │  ./pgdata/ on disk     │
         └────────────────────────┘
```

### Why 2 Threads?

| Scenario | Single Thread | 2 Threads + Queue |
|---|---|---|
| DB insert is slow (network/disk) | DAQ polling stalls → hardware buffer overflow → **data loss** | DAQ thread never waits for DB ✅ |
| DB timeout / connection drop | Loop halts → data lost | Queue buffers data → DB retries ✅ |
| DB down for ~100 s | All data lost | Queue holds up to 200 batches ✅ |

---

## Project Structure

```
DAQ-USB-4716/
├── config.py             # All settings: DAQ + DB + pipeline tuning
├── stream_to_db.py       # Main pipeline (2-thread + Queue)
├── db_setup.sql          # TimescaleDB schema (auto-applied on first run)
├── docker-compose.yml    # Local TimescaleDB deployment
├── requirements.txt      # Python dependencies
├── pgdata/               # DB data directory (Docker volume, git-ignored)
│
├── basic_InstantAI.py    # Simple one-shot AI read (debug/testing)
├── stream_n_plot.py      # Streaming + real-time Matplotlib plot
├── stream_only.py        # Streaming to CSV (legacy)
└── CommonUtils.py        # kbhit() keyboard interrupt utility
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Python | 3.8+ |
| Docker Desktop | Latest |
| Advantech DAQNavi / BDaq SDK | Installed (provides `Automation.BDaq`) |

---

## Setup

### 1. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 2. Start TimescaleDB

```bash
docker compose up -d
```

The database schema in `db_setup.sql` is applied automatically on the first container start.

Verify the container is healthy:

```bash
docker compose logs -f
# Look for: "database system is ready to accept connections"
```

### 3. Configure

Edit `config.py` to match your setup:

```python
DEVICE_DESCRIPTION = "USB-4716,BID#0"   # device identifier
CHANNEL_COUNT      = 2                   # number of channels (2 or 4)
CLOCK_RATE         = 1024                # Hz — hardware max
DB_DSN             = "postgresql://daq_user:daq_pass@localhost:5432/daq_db"
```

> **Buffer math is automatic:**  
> `SECTION_LENGTH = HARDWARE_BUFFER_SIZE // CHANNEL_COUNT`  
> 2 channels → `512`, 4 channels → `256`

---

## Running

### Start the Pipeline

```bash
python stream_to_db.py
```

Sample output:

```
2026-07-08 22:39:00 [DAQ-Reader  ] INFO: DAQ started | channels=2 | clock=1024 Hz | sectionLength=512
2026-07-08 22:39:00 [DB-Writer   ] INFO: DB writer connected to TimescaleDB
2026-07-08 22:39:10 [Monitor     ] INFO: [STATS] polled=10,240 | written=10,240 | dropped_batches=0 (0.0%) | queue=0/200
```

### Stop

Press `Ctrl+C` — the pipeline **flushes all remaining queue items to DB before exiting**.

```
Signal 2 received — initiating graceful shutdown...
Waiting for DB writer to flush remaining queue...
Pipeline stopped.
  Total polled : 102,400 samples
  Total written: 102,400 rows
  Dropped      : 0 batches
  DB errors    : 0
```

---

## Database

### Schema

```sql
-- Hypertable (time-series optimized, partitioned by time)
CREATE TABLE daq_samples (
    time        TIMESTAMPTZ      NOT NULL,
    channel     SMALLINT         NOT NULL,
    value       DOUBLE PRECISION NOT NULL
);

-- Session tracking
CREATE TABLE daq_sessions (
    id            SERIAL PRIMARY KEY,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at    TIMESTAMPTZ,
    channel_count SMALLINT    NOT NULL,
    clock_rate_hz INTEGER     NOT NULL,
    notes         TEXT
);
```

### Useful Queries

```sql
-- Count samples per channel
SELECT channel, COUNT(*) AS samples, MIN(time) AS first, MAX(time) AS last
FROM daq_samples
GROUP BY channel ORDER BY channel;

-- Latest 10 rows
SELECT * FROM daq_samples ORDER BY time DESC LIMIT 10;

-- Average voltage per second (time_bucket — TimescaleDB feature)
SELECT time_bucket('1 second', time) AS bucket,
       channel,
       AVG(value)  AS avg_v,
       MIN(value)  AS min_v,
       MAX(value)  AS max_v
FROM daq_samples
GROUP BY bucket, channel
ORDER BY bucket DESC
LIMIT 20;

-- Check for gaps greater than 2ms between samples on channel 0
SELECT time,
       LAG(time) OVER (ORDER BY time) AS prev_time,
       EXTRACT(EPOCH FROM (time - LAG(time) OVER (ORDER BY time))) * 1000 AS gap_ms
FROM daq_samples
WHERE channel = 0
ORDER BY time DESC;
```

### Docker Commands

```bash
# Start DB
docker compose up -d

# Stop DB (data persisted in ./pgdata)
docker compose stop

# Remove container (data still in ./pgdata)
docker compose down

# Backup
docker exec daq_tsdb pg_dump -U daq_user daq_db > backup_$(date +%Y%m%d).sql

# Open psql shell
docker exec -it daq_tsdb psql -U daq_user -d daq_db
```

---

## Data Volume Estimate

| Channels | Clock Rate | Rows/sec | MB/hour | GB/day |
|---|---|---|---|---|
| 1 | 1024 Hz | 1,024 | ~35 MB | ~0.85 GB |
| 2 | 1024 Hz | 2,048 | ~70 MB | ~1.7 GB |
| 4 | 1024 Hz | 4,096 | ~140 MB | ~3.4 GB |

> TimescaleDB compression can reduce storage by **50–90%** depending on signal characteristics.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `DAQ prepare() failed` | Device not connected or wrong BID | Check USB connection, verify `DEVICE_DESCRIPTION` |
| `DB connection failed` | Docker not running | `docker compose up -d` |
| `Queue full! Dropped batch` | DB insert too slow | Increase `QUEUE_MAXSIZE` or reduce `DB_PAGE_SIZE` |
| `dropped_batches > 0` | DB down too long | Check DB health |
| Samples per channel less than expected | `SECTION_LENGTH` too large | Ensure `SECTION_LENGTH <= HARDWARE_BUFFER_SIZE / CHANNEL_COUNT` |

---

## Other Scripts

| Script | Use Case |
|---|---|
| `basic_InstantAI.py` | Quick spot-check of a single channel value |
| `stream_n_plot.py` | Real-time oscilloscope-style Matplotlib plot |
| `stream_only.py` | Lightweight CSV logger (no DB required) |
