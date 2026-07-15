#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# See: docs/architecture/context.md

"""
mockup_stream_to_db.py
──────────────────────
Mock-up version of stream_to_db.py — synthetic DAQ data, writes to a real
TimescaleDB database named "mockup" (auto-created if it does not exist).

Architecture (2-thread + Queue) — identical to real pipeline:
  ┌──────────────────────────────────────────────────┐
  │ Mock DAQ Thread  (generates synthetic data)      │
  │  sine/noise waveform → wall-clock stamp → put()  │
  └─────────────────────┬────────────────────────────┘
                        │ (batch_wall_ts, raw_data, returned_count)
                        ▼
                  Queue (in-memory)
                        │
  ┌─────────────────────▼────────────────────────────┐
  │ DB Writer Thread  (parse + real psycopg2 INSERT) │
  │  get(raw) → back-compute per-sample ts → INSERT  │
  │  → database: "mockup"  table: daq_samples        │
  └──────────────────────────────────────────────────┘

Mock DAQ behaviour:
  - Generates sine waves per channel (configurable amplitude & frequency)
  - Adds Gaussian noise to simulate real sensor noise
  - Respects CLOCK_RATE, CHANNEL_COUNT, SECTION_LENGTH exactly like real code
  - Sleeps to simulate hardware acquisition time (SECTION_LENGTH / CLOCK_RATE)

DB behaviour:
  - On startup: connects to the Postgres server and creates the "mockup"
    database if it does not exist, then creates the daq_samples table
    (+ TimescaleDB hypertable) if they do not exist.
  - Writes real rows via psycopg2 execute_values — identical INSERT path
    to stream_to_db.py, just targeting a different database.
  - Optionally also dumps rows to a CSV file (MOCKUP_CSV_PATH).
"""

import sys
import os
import time
import math
import random
import signal
import threading
import logging
import queue
import csv
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import psycopg2.extensions

import config as config  # same config.py as real pipeline

# ─── Mock-up Tuning ──────────────────────────────────────────────────────────
# Waveform parameters for each channel (index = channel offset from START_CHANNEL)
# Each entry: (amplitude_V, frequency_Hz, dc_offset_V)
MOCKUP_CHANNEL_WAVEFORMS = [
    (2.0,  5.0,   2.5),   # ch0: 2 V amplitude,   5 Hz sine, centred at 2.5 V
    (1.0,  10.0,  2.5),   # ch1: 1 V amplitude,  10 Hz sine, centred at 2.5 V
    (0.5,  20.0,  1.5),   # ch2: 0.5 V amplitude, 20 Hz sine, centred at 1.5 V
    (1.5,  2.0,   3.0),   # ch3: 1.5 V amplitude,  2 Hz sine, centred at 3.0 V
    (0.8,  50.0,  2.0),   # ch4
    (1.2,  1.0,   2.5),   # ch5
    (0.3,  100.0, 1.0),   # ch6
    (2.0,  0.5,   2.5),   # ch7 (slow drift)
]
MOCKUP_NOISE_STD_V  = 0.02    # Gaussian noise standard deviation (volts)
MOCKUP_CSV_PATH     = None    # Set to a filepath string to also dump rows to CSV,
                              # e.g. "mockup_output.csv". None = no CSV output.
MOCKUP_PRINT_ROWS   = False   # Set True to print every parsed row (very verbose)
MOCKUP_SUMMARY_ROWS = 5       # How many sample rows to show per stats interval

# ─── Mockup DB settings ──────────────────────────────────────────────────────
# The mockup always writes to the "mockup" database on the same server as
# config.MOCKUP_DB_DSN.  We parse the DSN to swap out the database name.
MOCKUP_DB_NAME = "mockup"

def _build_mockup_dsn(original_dsn: str, dbname: str) -> str:
    """Replace the database name in a postgresql:// DSN."""
    # psycopg2 can parse DSNs for us
    parsed = psycopg2.extensions.make_dsn(original_dsn)
    parts  = psycopg2.extensions.parse_dsn(parsed)
    parts["dbname"] = dbname
    return psycopg2.extensions.make_dsn(**parts)

# DSN pointing at the postgres maintenance DB (for CREATE DATABASE)
_POSTGRES_DSN = _build_mockup_dsn(config.MOCKUP_DB_DSN, "postgres")
# DSN pointing at our "mockup" DB (for all actual data inserts)
MOCKUP_MOCKUP_DB_DSN = _build_mockup_dsn(config.MOCKUP_DB_DSN, MOCKUP_DB_NAME)

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(threadName)-12s] %(levelname)s: %(message)s",
)
log = logging.getLogger(__name__)

# ─── Shared state ─────────────────────────────────────────────────────────────
# Identical queue contract to real stream_to_db.py:
#   item = (batch_wall_ts_ns: int, raw_data: list[float], returned_count: int)
data_queue = queue.Queue(maxsize=config.QUEUE_MAXSIZE)
stop_event  = threading.Event()

stats_lock = threading.Lock()
stats = {
    "polled":    0,   # total interleaved samples generated
    "enqueued":  0,   # total batches enqueued
    "written":   0,   # total rows written to DB
    "dropped":   0,   # batches dropped due to full queue
    "db_errors": 0,   # number of DB insert failures
}

# Shared buffer for monitor thread to peek at recent rows
_recent_rows_lock = threading.Lock()
_recent_rows: list = []


# ─── DB bootstrap (run once before threads start) ────────────────────────────
def ensure_mockup_db():
    """
    1. Connect to the 'postgres' maintenance DB.
    2. CREATE DATABASE mockup  (if not exists — Postgres has no IF NOT EXISTS
       for CREATE DATABASE, so we check pg_database instead).
    3. Connect to 'mockup' and CREATE TABLE / hypertable if not exists.
    """
    # ── Step 1 & 2: create database ──────────────────────────────────────────
    log.info(f"[DBSetup] Checking if database '{MOCKUP_DB_NAME}' exists...")
    try:
        conn = psycopg2.connect(_POSTGRES_DSN)
        conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()

        cur.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (MOCKUP_DB_NAME,)
        )
        exists = cur.fetchone()

        if not exists:
            cur.execute(f'CREATE DATABASE "{MOCKUP_DB_NAME}"')
            log.info(f"[DBSetup] Database '{MOCKUP_DB_NAME}' created.")
        else:
            log.info(f"[DBSetup] Database '{MOCKUP_DB_NAME}' already exists.")

        cur.close()
        conn.close()
    except Exception as e:
        log.error(f"[DBSetup] Failed to create database: {e}")
        raise

    # ── Step 3: create table + hypertable in mockup DB ───────────────────────
    log.info(f"[DBSetup] Ensuring schema in '{MOCKUP_DB_NAME}'...")
    try:
        conn = psycopg2.connect(MOCKUP_MOCKUP_DB_DSN)
        conn.autocommit = True
        cur = conn.cursor()

        # Enable TimescaleDB extension (may already exist)
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
            log.info("[DBSetup] TimescaleDB extension enabled.")
        except Exception as e:
            log.warning(f"[DBSetup] TimescaleDB extension not available ({e}). "
                        "Falling back to plain PostgreSQL table (no hypertable).")
            conn.autocommit = True   # reset after any implicit rollback

        # Main samples table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS daq_samples (
                time        TIMESTAMPTZ      NOT NULL,
                channel     SMALLINT         NOT NULL,
                value       DOUBLE PRECISION NOT NULL
            );
        """)

        # Convert to hypertable (safe to call repeatedly thanks to if_not_exists)
        try:
            cur.execute(
                "SELECT create_hypertable('daq_samples', 'time', if_not_exists => TRUE);"
            )
            log.info("[DBSetup] Hypertable ready.")
        except Exception as e:
            log.warning(f"[DBSetup] create_hypertable() skipped ({e}). "
                        "Using plain table — data will still be written correctly.")

        # Index for fast channel + time queries
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_mockup_channel_time
                ON daq_samples (channel, time DESC);
        """)

        # Session metadata table (mirrors db_setup.sql)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS daq_sessions (
                id            SERIAL PRIMARY KEY,
                started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                stopped_at    TIMESTAMPTZ,
                channel_count SMALLINT    NOT NULL,
                clock_rate_hz INTEGER     NOT NULL,
                notes         TEXT
            );
        """)

        cur.close()
        conn.close()
        log.info(f"[DBSetup] Schema ready in '{MOCKUP_DB_NAME}'.")
    except Exception as e:
        log.error(f"[DBSetup] Schema setup failed: {e}")
        raise


# ─── Mock DAQ Generator Thread ───────────────────────────────────────────────
def mock_daq_reader_thread():
    """
    Simulates WaveformAiCtrl.getDataF64() without real hardware.

    Generates interleaved samples:
        raw_data = [ch0_s0, ch1_s0, ch0_s1, ch1_s1, ...]

    Timing: sleeps for the real acquisition window
        (SECTION_LENGTH / CLOCK_RATE) seconds per batch,
    so downstream throughput matches a real device.
    """
    n_ch    = config.CHANNEL_COUNT
    sec_len = config.SECTION_LENGTH      # samples per channel per batch
    buf_sz  = config.USER_BUFFER_SIZE   # = sec_len × n_ch
    dt_s    = 1.0 / config.CLOCK_RATE  # seconds per sample

    # Guard: clamp waveform table to available entries (cycle if fewer entries than channels)
    waveforms = (MOCKUP_CHANNEL_WAVEFORMS * n_ch)[:n_ch]

    # Monotonic sample counter — advances the sine phase continuously across batches
    sample_counter = 0

    log.info(
        f"[MockDAQ] Started | device=MOCK | channels={n_ch} "
        f"| clock={config.CLOCK_RATE} Hz | sectionLength={sec_len} "
        f"| userBuffer={buf_sz}"
    )
    log.info("[MockDAQ] Waveforms per channel:")
    for i in range(n_ch):
        amp, freq, dc = waveforms[i]
        log.info(
            f"  ch{config.START_CHANNEL + i}: "
            f"{amp:.2f} V × sin(2π×{freq:.1f}Hz×t) + {dc:.2f} V  (noise σ={MOCKUP_NOISE_STD_V} V)"
        )

    try:
        while not stop_event.is_set():
            # ── Simulate hardware acquisition time ──
            time.sleep(sec_len / config.CLOCK_RATE)

            if stop_event.is_set():
                break

            # ── Generate interleaved samples ──
            raw_data = []
            for s in range(sec_len):
                t = (sample_counter + s) * dt_s
                for ch_idx in range(n_ch):
                    amp, freq, dc = waveforms[ch_idx]
                    value = amp * math.sin(2 * math.pi * freq * t) + dc
                    value += random.gauss(0.0, MOCKUP_NOISE_STD_V)
                    value = max(0.0, min(5.0, value))   # clamp to V_0To5 range
                    raw_data.append(value)

            sample_counter += sec_len
            returned_count  = len(raw_data)

            # ── Capture wall-clock timestamp immediately after "acquisition" ──
            batch_wall_ts_ns = time.time_ns()

            # ── Enqueue (identical logic to real code) ──
            try:
                data_queue.put_nowait((batch_wall_ts_ns, raw_data, returned_count))
                with stats_lock:
                    stats["polled"]   += returned_count
                    stats["enqueued"] += 1
            except queue.Full:
                with stats_lock:
                    stats["dropped"] += 1
                log.warning(
                    f"[MockDAQ] Queue full! Dropped 1 batch ({returned_count} samples). "
                    "DB writer may be too slow."
                )

    finally:
        log.info("[MockDAQ] Mock DAQ thread stopped.")


# ─── DB Writer Thread ─────────────────────────────────────────────────────────
def db_writer_thread():
    """
    Dequeues raw batches, parses interleaved data, and batch-INSERTs into
    the 'mockup' TimescaleDB database.

    Identical logic to stream_to_db.py's db_writer_thread — only the DSN
    and database name differ.

    Non-daemon thread — flushes remaining queue items before process exits.
    """
    conn = None
    while conn is None:
        try:
            conn = psycopg2.connect(MOCKUP_MOCKUP_DB_DSN)
            conn.autocommit = False
            log.info(f"[MockDB] Connected to database '{MOCKUP_DB_NAME}'")
        except Exception as e:
            log.error(f"[MockDB] DB connection failed: {e} — retrying in 5s")
            time.sleep(5)
            if stop_event.is_set():
                return

    cur = conn.cursor()

    INSERT_SQL = "INSERT INTO daq_samples (time, channel, value) VALUES %s"
    dt_ns = int(1_000_000_000 / config.CLOCK_RATE)   # e.g. 1_000_000 ns at 1000 Hz
    log.info(
        f"[MockDB] Writer ready | clock={config.CLOCK_RATE} Hz | dt={dt_ns} ns/sample "
        f"| time-sync: per-batch wall-clock anchor (ms-scale)"
    )

    # Optional CSV output
    csv_file   = None
    csv_writer = None
    if MOCKUP_CSV_PATH:
        try:
            csv_file   = open(MOCKUP_CSV_PATH, "w", newline="")
            csv_writer = csv.writer(csv_file)
            csv_writer.writerow(["time_utc", "channel", "value_V"])
            log.info(f"[MockDB] CSV output enabled → {MOCKUP_CSV_PATH}")
        except Exception as e:
            log.error(f"[MockDB] Failed to open CSV '{MOCKUP_CSV_PATH}': {e}")
            csv_writer = None

    try:
        while not stop_event.is_set() or not data_queue.empty():
            try:
                batch_wall_ts_ns, raw_data, returned_count = data_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            # ── Parse interleaved data → DB rows ──
            # raw_data layout: [ch0_s0, ch1_s0, ..., chN_s0, ch0_s1, ...]
            # batch_wall_ts_ns anchors the LAST sample; back-compute earlier ones.
            samples_per_channel = returned_count // config.CHANNEL_COUNT
            rows = []
            for s in range(samples_per_channel):
                offset_ns    = (samples_per_channel - 1 - s) * dt_ns
                sample_ts_ns = batch_wall_ts_ns - offset_ns
                sample_ts    = datetime.fromtimestamp(
                    sample_ts_ns / 1_000_000_000, tz=timezone.utc
                )
                for ch in range(config.CHANNEL_COUNT):
                    value = raw_data[s * config.CHANNEL_COUNT + ch]
                    rows.append((sample_ts, config.START_CHANNEL + ch, value))

            # ── Batch INSERT (identical to real pipeline) ──
            try:
                psycopg2.extras.execute_values(
                    cur, INSERT_SQL, rows, page_size=config.DB_PAGE_SIZE
                )
                conn.commit()

                with stats_lock:
                    stats["written"] += len(rows)

                # Optional CSV mirror
                if csv_writer is not None:
                    for ts, ch, val in rows:
                        csv_writer.writerow([ts.isoformat(), ch, f"{val:.6f}"])
                    csv_file.flush()

                if MOCKUP_PRINT_ROWS:
                    for ts, ch, val in rows:
                        log.debug(f"  ROW  time={ts.isoformat()}  ch={ch}  val={val:.6f}")

                # Keep a snapshot for monitor display
                with _recent_rows_lock:
                    _recent_rows.clear()
                    _recent_rows.extend(rows[-MOCKUP_SUMMARY_ROWS:])

            except Exception as e:
                conn.rollback()
                with stats_lock:
                    stats["db_errors"] += 1
                log.error(f"[MockDB] DB insert error: {e} — re-queuing batch")
                try:
                    data_queue.put_nowait((batch_wall_ts_ns, raw_data, returned_count))
                except queue.Full:
                    with stats_lock:
                        stats["dropped"] += 1
                    log.error("[MockDB] Queue full on re-queue — batch permanently lost!")

    finally:
        cur.close()
        conn.close()
        if csv_file is not None:
            csv_file.close()
            log.info(f"[MockDB] CSV file closed: {MOCKUP_CSV_PATH}")
        log.info("[MockDB] DB writer flushed and disconnected.")


# ─── Monitor Thread ───────────────────────────────────────────────────────────
def monitor_thread():
    """Logs pipeline statistics every STATS_INTERVAL_SEC seconds."""
    while not stop_event.is_set():
        time.sleep(config.STATS_INTERVAL_SEC)

        with stats_lock:
            s = dict(stats)
        loss_pct = (s["dropped"] / s["enqueued"] * 100) if s["enqueued"] > 0 else 0.0

        log.info(
            f"[STATS] polled={s['polled']:,} | written={s['written']:,} | "
            f"dropped_batches={s['dropped']} ({loss_pct:.1f}%) | "
            f"db_errors={s['db_errors']} | queue={data_queue.qsize()}/{config.QUEUE_MAXSIZE}"
        )

        # Show a few recent sample values to confirm waveform shape
        with _recent_rows_lock:
            snap = list(_recent_rows)
        if snap:
            log.info(f"[STATS] Last {len(snap)} rows in '{MOCKUP_DB_NAME}'.daq_samples:")
            for ts, ch, val in snap:
                log.info(f"  {ts.strftime('%H:%M:%S.%f')[:-3]}  ch{ch}  {val:+.4f} V")


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    def handle_signal(sig, frame):
        log.info(f"Signal {sig} received — initiating graceful shutdown...")
        stop_event.set()

    signal.signal(signal.SIGINT,  handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    log.info("=" * 60)
    log.info("MOCK DAQ → TimescaleDB ('mockup') Pipeline Starting")
    log.info("  [No hardware required — synthetic sine wave data]")
    log.info(f"  Channels    : {config.CHANNEL_COUNT} (ch{config.START_CHANNEL}–ch{config.START_CHANNEL + config.CHANNEL_COUNT - 1})")
    log.info(f"  Clock rate  : {config.CLOCK_RATE} Hz")
    log.info(f"  sectionLength: {config.SECTION_LENGTH} samples/ch")
    log.info(f"  Batch size  : {config.USER_BUFFER_SIZE} interleaved samples (~{config.SECTION_LENGTH / config.CLOCK_RATE * 1000:.0f} ms)")
    log.info(f"  Noise std   : {MOCKUP_NOISE_STD_V:.4f} V")
    log.info(f"  DB DSN      : {MOCKUP_MOCKUP_DB_DSN}")
    log.info(f"  CSV output  : {MOCKUP_CSV_PATH or 'disabled'}")
    log.info("=" * 60)

    # ── Bootstrap DB (create database + schema if needed) ──
    try:
        ensure_mockup_db()
    except Exception:
        log.error("DB bootstrap failed — cannot continue. Check MOCKUP_DB_DSN in config.py.")
        sys.exit(1)

    daq_thread = threading.Thread(
        target=mock_daq_reader_thread, name="MockDAQ", daemon=True
    )
    db_thread = threading.Thread(
        target=db_writer_thread, name="MockDB", daemon=False  # non-daemon: flushes on exit
    )
    mon_thread = threading.Thread(
        target=monitor_thread, name="Monitor", daemon=True
    )

    daq_thread.start()
    db_thread.start()
    mon_thread.start()

    # Wait until stop_event is set (Ctrl+C)
    stop_event.wait()

    log.info("Waiting for DB writer to flush remaining queue...")
    db_thread.join(timeout=60)

    if db_thread.is_alive():
        log.warning("DB writer did not finish within 60s timeout.")

    with stats_lock:
        s = dict(stats)
    log.info("=" * 60)
    log.info("Pipeline stopped.")
    log.info(f"  Total polled : {s['polled']:,} samples")
    log.info(f"  Total written: {s['written']:,} rows  → '{MOCKUP_DB_NAME}'.daq_samples")
    log.info(f"  Dropped      : {s['dropped']} batches")
    log.info(f"  DB errors    : {s['db_errors']}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
