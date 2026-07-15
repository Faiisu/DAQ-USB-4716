#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pipeline_agent.py
──────────────────
Containerized DAQ pipeline agent.
Fetches configuration from the Web GUI config manager, runs the acquisition
and database writing threads, and reports logs/stats back to the Web GUI.
"""

import os
import sys
import time
import math
import random
import queue
import threading
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone
import psycopg2
import psycopg2.extras
import psycopg2.extensions

try:
    from Automation.BDaq import *
    from Automation.BDaq.WaveformAiCtrl import WaveformAiCtrl
    from Automation.BDaq.BDaqApi import AdxEnumToString, BioFailed
    BDAQ_AVAILABLE = True
except (ImportError, Exception):
    BDAQ_AVAILABLE = False

CONFIG_URL = os.environ.get("CONFIG_URL")
MODE = os.environ.get("MODE", "mockup")
STATUS_URL = os.environ.get("STATUS_URL")
LOG_URL = os.environ.get("LOG_URL")

stats_lock = threading.Lock()
stats = {
    "polled": 0, "enqueued": 0, "written": 0,
    "dropped": 0, "db_errors": 0,
    "running": True, "mode": MODE
}
stop_event = threading.Event()

def post_to_gui(url, data):
    if not url:
        return
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=2) as response:
            response.read()
    except Exception as e:
        print(f"Failed to post to {url}: {e}", file=sys.stderr)

def emit_log(msg, level="info"):
    print(f"[{level.upper()}] {msg}")
    post_to_gui(LOG_URL, {"msg": msg, "level": level})

def emit_stats():
    with stats_lock:
        s = dict(stats)
    post_to_gui(STATUS_URL, s)


# ─── Database Helpers ─────────────────────────────────────────────────────────

def build_mockup_dsn(original_dsn: str, dbname: str) -> str:
    parsed = psycopg2.extensions.make_dsn(original_dsn)
    parts  = psycopg2.extensions.parse_dsn(parsed)
    parts["dbname"] = dbname
    return psycopg2.extensions.make_dsn(**parts)

def ensure_schema(dsn: str):
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    try:
        cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
    except Exception:
        pass
    cur.execute("""
        CREATE TABLE IF NOT EXISTS daq_samples (
            time        TIMESTAMPTZ      NOT NULL,
            channel     SMALLINT         NOT NULL,
            value       DOUBLE PRECISION NOT NULL
        );
    """)
    try:
        cur.execute("SELECT create_hypertable('daq_samples', 'time', if_not_exists => TRUE);")
    except Exception:
        pass
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_daq_channel_time
            ON daq_samples (channel, time DESC);
    """)
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
    cur.close(); conn.close()

def ensure_mockup_db(mockup_dsn: str, db_name: str = "mockup") -> str:
    postgres_dsn = build_mockup_dsn(mockup_dsn, "postgres")
    target_dsn   = build_mockup_dsn(mockup_dsn, db_name)

    conn = psycopg2.connect(postgres_dsn)
    conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
    if not cur.fetchone():
        cur.execute(f'CREATE DATABASE "{db_name}"')
    cur.close(); conn.close()

    ensure_schema(target_dsn)
    return target_dsn

def start_session(dsn: str, channel_count: int, clock_rate: int) -> int | None:
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO daq_sessions (started_at, channel_count, clock_rate_hz, notes) VALUES (NOW(), %s, %s, %s) RETURNING id;",
            (channel_count, clock_rate, "Started from Containerized Pipeline Agent")
        )
        session_id = cur.fetchone()[0]
        cur.close()
        conn.close()
        return session_id
    except Exception as e:
        print(f"Failed to start session in DB: {e}", file=sys.stderr)
        return None

def end_session(dsn: str, session_id: int | None):
    if session_id is None:
        return
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(
            "UPDATE daq_sessions SET stopped_at = NOW(), notes = COALESCE(notes, '') || ' | Stopped gracefully' WHERE id = %s;",
            (session_id,)
        )
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Failed to end session in DB: {e}", file=sys.stderr)


# ─── Fetch Config from Manager ────────────────────────────────────────────────

def fetch_config(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"Error fetching config from {url}: {e}", file=sys.stderr)
        sys.exit(1)


# ─── Pipeline Runner ──────────────────────────────────────────────────────────

def run_pipeline(cfg, is_mock):
    mode_name = "mockup" if is_mock else "real"
    target_dsn = ""
    
    try:
        if is_mock:
            target_dsn = ensure_mockup_db(cfg["mockup_db_dsn"], "mockup")
        else:
            target_dsn = cfg["db_dsn"]
            ensure_schema(target_dsn)
    except Exception as e:
        emit_log(f"DB bootstrap failed: {e}", "error")
        stats["running"] = False
        stats["mode"] = "stopped"
        emit_stats()
        return

    session_id = start_session(target_dsn, cfg["channel_count"], cfg["clock_rate"])

    n_ch     = cfg["channel_count"]
    sec_len  = cfg["section_length"]
    clock_hz = cfg["clock_rate"]
    dt_s     = 1.0 / clock_hz
    dt_ns    = int(1_000_000_000 / clock_hz)
    
    data_queue = queue.Queue(maxsize=cfg["queue_maxsize"])

    emit_log(f"Pipeline agent started | mode={mode_name} | channels={n_ch} | clock={clock_hz} Hz")

    if is_mock:
        waveforms = (cfg["waveforms"] * n_ch)[:n_ch]
        noise_std = cfg["noise_std"]

        def _daq_gen():
            sample_counter = 0
            while not stop_event.is_set():
                time.sleep(sec_len / clock_hz)
                if stop_event.is_set():
                    break

                raw_data = []
                for s in range(sec_len):
                    t = (sample_counter + s) * dt_s
                    for ch_idx in range(n_ch):
                        w = waveforms[ch_idx]
                        v = w["amp"] * math.sin(2 * math.pi * w["freq"] * t) + w["dc"]
                        v += random.gauss(0.0, noise_std)
                        v = max(0.0, min(5.0, v))
                        raw_data.append(v)

                sample_counter += sec_len
                batch_wall_ts_ns = time.time_ns()
                try:
                    data_queue.put_nowait((batch_wall_ts_ns, raw_data, len(raw_data)))
                    with stats_lock:
                        stats["polled"]   += len(raw_data)
                        stats["enqueued"] += 1
                except queue.Full:
                    with stats_lock:
                        stats["dropped"] += 1
                    emit_log("Queue full — batch dropped", "warn")
        daq_target = _daq_gen
        daq_name = "MockDAQ"
    else:
        if not BDAQ_AVAILABLE:
            emit_log("Advantech BDaq SDK is not available inside this container.", "error")
            stats["running"] = False
            stats["mode"] = "stopped"
            emit_stats()
            return
            
        def _daq_real():
            try:
                wf = WaveformAiCtrl(cfg["device_description"])
                wf.loadProfile         = cfg["profile_path"]
                wf.conversion.channelStart = cfg["start_channel"]
                wf.conversion.channelCount = cfg["channel_count"]
                wf.conversion.clockRate    = cfg["clock_rate"]
                wf.record.sectionCount     = cfg["section_count"]
                wf.record.sectionLength    = cfg["section_length"]

                for i in range(cfg["channel_count"]):
                    wf.channels[cfg["start_channel"] + i].signalType = AiSignalType.SingleEnded
                    wf.channels[cfg["start_channel"] + i].valueRange = ValueRange.V_0To5

                ret = wf.prepare()
                if BioFailed(ret):
                    emit_log("DAQ prepare() failed — check device connection and profile.xml", "error")
                    stop_event.set()
                    return

                ret = wf.start()
                if BioFailed(ret):
                    emit_log("DAQ start() failed", "error")
                    stop_event.set()
                    return

                user_buffer_size = sec_len * n_ch
                while not stop_event.is_set():
                    result = wf.getDataF64(user_buffer_size, -1)
                    batch_wall_ts_ns = time.time_ns()
                    ret, returned_count, raw_data = result[0], result[1], result[2]

                    if BioFailed(ret):
                        emit_log("getDataF64() error — stopping DAQ thread", "error")
                        stop_event.set()
                        break

                    if returned_count <= 0:
                        continue

                    raw_copy = list(raw_data[:returned_count])
                    try:
                        data_queue.put_nowait((batch_wall_ts_ns, raw_copy, returned_count))
                        with stats_lock:
                            stats["polled"]   += returned_count
                            stats["enqueued"] += 1
                    except queue.Full:
                        with stats_lock:
                            stats["dropped"] += 1
                        emit_log("Queue full — batch dropped", "warn")

            except Exception as ex:
                emit_log(f"DAQ hardware error: {ex}", "error")
                stop_event.set()
            finally:
                try:
                    wf.stop()
                    wf.dispose()
                except Exception:
                    pass
                emit_log("DAQ hardware thread stopped.")

        daq_target = _daq_real
        daq_name = "RealDAQ"

    # DB writer thread
    def _db_writer():
        conn = None
        while conn is None and not stop_event.is_set():
            try:
                conn = psycopg2.connect(target_dsn)
                conn.autocommit = False
                emit_log("DB writer connected")
            except Exception as e:
                emit_log(f"DB connect failed: {e} — retry in 5s", "error")
                time.sleep(5)

        if conn is None:
            return

        cur = conn.cursor()
        INSERT_SQL = "INSERT INTO daq_samples (time, channel, value) VALUES %s"
        start_ch = cfg["start_channel"]
        page_sz  = cfg["db_page_size"]

        while not stop_event.is_set() or not data_queue.empty():
            try:
                batch_wall_ts_ns, raw_data, returned_count = data_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            spc = returned_count // n_ch
            rows = []
            scaling_enabled = cfg.get("scaling_enabled", False)
            scaling_configs = cfg.get("scaling", [])
            for s in range(spc):
                offset_ns    = (spc - 1 - s) * dt_ns
                sample_ts_ns = batch_wall_ts_ns - offset_ns
                sample_ts    = datetime.fromtimestamp(sample_ts_ns / 1e9, tz=timezone.utc)
                for ch in range(n_ch):
                    value = raw_data[s * n_ch + ch]
                    if scaling_enabled and ch < len(scaling_configs):
                        sc = scaling_configs[ch]
                        low_v = sc.get("low_v", 0.0)
                        high_v = sc.get("high_v", 5.0)
                        low_val = sc.get("low_val", 0.0)
                        high_val = sc.get("high_val", 5.0)
                        denom = high_v - low_v
                        if denom != 0:
                            value = ((value - low_v) / denom) * (high_val - low_val) + low_val
                    rows.append((sample_ts, start_ch + ch, value))

            try:
                psycopg2.extras.execute_values(cur, INSERT_SQL, rows, page_size=page_sz)
                conn.commit()
                with stats_lock:
                    stats["written"] += len(rows)
            except Exception as e:
                conn.rollback()
                with stats_lock:
                    stats["db_errors"] += 1
                emit_log(f"DB insert error: {e}", "error")

        cur.close(); conn.close()
        emit_log("DB writer disconnected")

    # Stats emitter thread
    def _stats_emitter():
        interval = cfg.get("stats_interval", 5)
        while not stop_event.is_set():
            time.sleep(interval)
            emit_stats()

    daq_t   = threading.Thread(target=daq_target,     name=daq_name,    daemon=True)
    db_t    = threading.Thread(target=_db_writer,     name="DBWriter",  daemon=False)
    stat_t  = threading.Thread(target=_stats_emitter, name="StatsEmit", daemon=True)

    daq_t.start(); db_t.start(); stat_t.start()

    # Graceful shutdown handler inside agent
    import signal
    def handle_sigterm(signum, frame):
        emit_log("SIGTERM received, stopping pipeline...")
        stop_event.set()

    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    # Wait until stop is requested
    while not stop_event.is_set():
        time.sleep(0.5)

    emit_log("Flushing DB writer queue...")
    db_t.join(timeout=60)
    
    end_session(target_dsn, session_id)
    
    with stats_lock:
        stats["running"] = False
        stats["mode"] = "stopped"
    emit_stats()
    emit_log("Pipeline agent stopped gracefully")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not CONFIG_URL:
        print("Error: CONFIG_URL environment variable is required", file=sys.stderr)
        sys.exit(1)

    print(f"Fetching config from manager: {CONFIG_URL}")
    cfg = fetch_config(CONFIG_URL)

    # Replace 'localhost' with 'daq_tsdb' if connecting from container network
    if "db_dsn" in cfg and "localhost" in cfg["db_dsn"]:
        cfg["db_dsn"] = cfg["db_dsn"].replace("localhost", "daq_tsdb")
    if "mockup_db_dsn" in cfg and "localhost" in cfg["mockup_db_dsn"]:
        cfg["mockup_db_dsn"] = cfg["mockup_db_dsn"].replace("localhost", "daq_tsdb")

    is_mock = (MODE == "mockup")
    run_pipeline(cfg, is_mock)

if __name__ == "__main__":
    main()
