#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# See: docs/architecture/context.md

"""
stream_to_db.py
───────────────
DAQ USB-4716 → TimescaleDB streaming pipeline

Architecture (2-thread + Queue):
  ┌──────────────────────────────────────────────────┐
  │ DAQ Thread  (minimal work — poll + raw enqueue)  │
  │  getDataF64() → wall-clock stamp → put(raw)      │
  └─────────────────────┬────────────────────────────┘
                        │ (batch_wall_ts, raw_data, returned_count)
                        ▼
                  Queue (in-memory)
                        │
  ┌─────────────────────▼────────────────────────────┐
  │ DB Writer Thread  (parse + batch INSERT)         │
  │  get(raw) → back-compute per-sample ts → INSERT  │
  └──────────────────────────────────────────────────┘

Key design decisions:
  - DAQ thread does NO parsing/looping — returns to poll ASAP
  - DB writer owns all CPU-heavy work (parsing interleaved data)
  - Queue.put_nowait() — DAQ NEVER blocks waiting for DB
  - DB writer is non-daemon → flushes queue before process exits

  Time-sync (ms-scale):
  - batch_wall_ts = time.time_ns() captured immediately after getDataF64()
    returns → anchors the wall-clock time of the LAST sample in the batch.
  - Per-sample timestamp is back-computed:
      sample_ts = batch_wall_ts - (samples_per_channel - 1 - s) * dt_ns
  - This eliminates cumulative drift from the single-t0 scheme; each batch
    is re-anchored independently, keeping timestamps within OS scheduling
    jitter (~1 ms) of real wall-clock time.
"""

import sys
import os
import time
import signal
import threading
import logging
import queue
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), os.path.pardir)))
from Automation.BDaq import *
from Automation.BDaq.WaveformAiCtrl import WaveformAiCtrl
from Automation.BDaq.BDaqApi import AdxEnumToString, BioFailed

import json
from types import SimpleNamespace

with open(os.path.join(os.path.dirname(__file__), "config.json"), "r") as f:
    _cfg = json.load(f)
_cfg["USER_BUFFER_SIZE"] = _cfg["SECTION_LENGTH"] * _cfg["CHANNEL_COUNT"]
_cfg["QUEUE_BATCH_SIZE"] = _cfg["USER_BUFFER_SIZE"]
config = SimpleNamespace(**_cfg)

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(threadName)-12s] %(levelname)s: %(message)s",
)
log = logging.getLogger(__name__)

# ─── Shared state ─────────────────────────────────────────────────────────────
# Each item in queue: (batch_wall_ts_ns: int, raw_data: list[float], returned_count: int)
#   batch_wall_ts_ns = time.time_ns() captured right after getDataF64() returns
#                      → wall-clock time of the LAST sample in this batch (nanoseconds)
#   Per-sample ts is back-computed in DB writer:
#       sample_ts = batch_wall_ts_ns - (samples_per_channel - 1 - s) * dt_ns
data_queue = queue.Queue(maxsize=config.QUEUE_MAXSIZE)
stop_event = threading.Event()

stats_lock = threading.Lock()
stats = {
    "polled":   0,   # total interleaved samples polled from DAQ
    "enqueued": 0,   # total batches enqueued
    "written":  0,   # total rows written to DB
    "dropped":  0,   # batches dropped due to full queue
    "db_errors": 0,  # number of DB insert failures
}


# ─── DAQ Reader Thread ────────────────────────────────────────────────────────
def daq_reader_thread():
    """
    Responsibility: poll hardware as fast as possible, enqueue raw data.
    Does NO parsing — just copies the returned list and enqueues immediately.
    """
    wf = WaveformAiCtrl(config.DEVICE_DESCRIPTION)
    wf.loadProfile         = config.PROFILE_PATH
    wf.conversion.channelStart = config.START_CHANNEL
    wf.conversion.channelCount = config.CHANNEL_COUNT
    wf.conversion.clockRate    = config.CLOCK_RATE
    wf.record.sectionCount     = config.SECTION_COUNT
    wf.record.sectionLength    = config.SECTION_LENGTH

    for i in range(config.CHANNEL_COUNT):
        wf.channels[config.START_CHANNEL + i].signalType = AiSignalType.SingleEnded
        wf.channels[config.START_CHANNEL + i].valueRange = ValueRange.V_0To5

    ret = wf.prepare()
    if BioFailed(ret):
        log.error("DAQ prepare() failed — check device connection and profile.xml")
        stop_event.set()
        return

    ret = wf.start()
    if BioFailed(ret):
        log.error("DAQ start() failed")
        stop_event.set()
        return

    log.info(
        f"DAQ started | device={config.DEVICE_DESCRIPTION} | "
        f"channels={config.CHANNEL_COUNT} | clock={config.CLOCK_RATE} Hz | "
        f"sectionLength={config.SECTION_LENGTH} | userBuffer={config.USER_BUFFER_SIZE}"
    )

    try:
        log.info("DAQ loop started — per-batch wall-clock anchoring active (ms-scale sync)")

        while not stop_event.is_set():
            # Block until USER_BUFFER_SIZE interleaved samples are ready
            # timeout=-1 means wait indefinitely for requested count
            result = wf.getDataF64(config.USER_BUFFER_SIZE, -1)

            # ── Capture wall-clock timestamp IMMEDIATELY after getDataF64() returns ──
            # This is the best approximation of when the LAST sample in this batch
            # was produced by the hardware. OS scheduling jitter is typically ~1 ms.
            batch_wall_ts_ns = time.time_ns()

            ret, returned_count, raw_data = result[0], result[1], result[2]

            if BioFailed(ret):
                log.error("getDataF64() error — stopping DAQ thread")
                stop_event.set()
                break

            if returned_count <= 0:
                continue

            # ── Minimal work: copy raw list + enqueue immediately ──
            # DO NOT loop/parse here — let DB writer handle it
            raw_copy = list(raw_data[:returned_count])

            try:
                data_queue.put_nowait((batch_wall_ts_ns, raw_copy, returned_count))
                with stats_lock:
                    stats["polled"]   += returned_count
                    stats["enqueued"] += 1
            except queue.Full:
                with stats_lock:
                    stats["dropped"] += 1
                log.warning(
                    f"Queue full! Dropped 1 batch ({returned_count} samples). "
                    f"DB writer may be too slow."
                )

    finally:
        wf.stop()
        # wf.release()
        wf.dispose()
        log.info("DAQ thread stopped and device released.")


# ─── DB Writer Thread ─────────────────────────────────────────────────────────
def db_writer_thread():
    """
    Responsibility: dequeue raw batches, parse interleaved data, batch INSERT to TimescaleDB.
    Non-daemon thread — will flush remaining queue items before process exits.
    """
    conn = None
    while conn is None:
        try:
            conn = psycopg2.connect(config.DB_DSN)
            conn.autocommit = False
            log.info("DB writer connected to TimescaleDB")
        except Exception as e:
            log.error(f"DB connection failed: {e} — retrying in 5s")
            time.sleep(5)
            if stop_event.is_set():
                return

    cur = conn.cursor()

    INSERT_SQL = "INSERT INTO daq_samples (time, channel, value) VALUES %s"
    # dt in nanoseconds — used for back-computing per-sample timestamps
    dt_ns = int(1_000_000_000 / config.CLOCK_RATE)   # e.g. 1_000_000 ns at 1000 Hz
    log.info(
        f"DB writer ready | clock={config.CLOCK_RATE} Hz | dt={dt_ns} ns/sample "
        f"| time-sync: per-batch wall-clock anchor (ms-scale)"
    )

    while not stop_event.is_set() or not data_queue.empty():
        try:
            batch_wall_ts_ns, raw_data, returned_count = data_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        # ── Parse interleaved data into DB rows ──
        # raw_data layout: [ch0_s0, ch1_s0, ch0_s1, ch1_s1, ...]
        #
        # Time-sync: batch_wall_ts_ns anchors the LAST sample of this batch.
        # Back-compute each earlier sample:
        #   sample_ts_ns = batch_wall_ts_ns - (samples_per_channel - 1 - s) * dt_ns
        #
        # This keeps every timestamp within OS scheduling jitter (~1 ms)
        # of real wall-clock time, with no cumulative drift.
        samples_per_channel = returned_count // config.CHANNEL_COUNT
        rows = []
        for s in range(samples_per_channel):
            offset_ns = (samples_per_channel - 1 - s) * dt_ns
            sample_ts_ns = batch_wall_ts_ns - offset_ns
            # Convert ns → datetime (Python datetime has µs resolution, sufficient)
            sample_ts = datetime.fromtimestamp(sample_ts_ns / 1_000_000_000, tz=timezone.utc)
            for ch in range(config.CHANNEL_COUNT):
                value = raw_data[s * config.CHANNEL_COUNT + ch]
                
                # Apply per-channel linear calibration scaling if enabled in config.json
                ch_num = config.START_CHANNEL + ch
                ch_str = str(ch_num)
                scale_configs = getattr(config, 'SCALE_CONFIGS', {})
                scale_cfg = scale_configs.get(ch_str) if isinstance(scale_configs, dict) else None
                
                if scale_cfg and scale_cfg.get('enabled', False):
                    low_volt = scale_cfg.get('low_voltage', 0.0)
                    high_volt = scale_cfg.get('high_voltage', 10.0)
                    low_val = scale_cfg.get('low_value', 0.0)
                    high_val = scale_cfg.get('high_value', 100.0)
                    
                    denom = high_volt - low_volt
                    if abs(denom) > 1e-9:
                        value = low_val + ((value - low_volt) * (high_val - low_val)) / denom
                
                # Round value to 3 decimal places (.000 float format)
                value = round(value, 3)
                rows.append((sample_ts, config.START_CHANNEL + ch, value))

        # ── Batch INSERT ──
        try:
            psycopg2.extras.execute_values(
                cur, INSERT_SQL, rows, page_size=config.DB_PAGE_SIZE
            )
            conn.commit()
            with stats_lock:
                stats["written"] += len(rows)
        except Exception as e:
            conn.rollback()
            with stats_lock:
                stats["db_errors"] += 1
            log.error(f"DB insert error: {e} — re-queuing batch to avoid data loss")
            # Re-enqueue so data is not lost (best-effort)
            try:
                data_queue.put_nowait((batch_wall_ts_ns, raw_data, returned_count))
            except queue.Full:
                with stats_lock:
                    stats["dropped"] += 1
                log.error("Queue full on re-queue — batch permanently lost!")

    cur.close()
    conn.close()
    log.info("DB writer flushed and disconnected.")


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


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    def handle_signal(sig, frame):
        log.info(f"Signal {sig} received — initiating graceful shutdown...")
        stop_event.set()

    signal.signal(signal.SIGINT,  handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    log.info("=" * 60)
    log.info("DAQ → TimescaleDB Pipeline Starting")
    log.info(f"  Channels    : {config.CHANNEL_COUNT} (ch{config.START_CHANNEL}–ch{config.START_CHANNEL + config.CHANNEL_COUNT - 1})")
    log.info(f"  Clock rate  : {config.CLOCK_RATE} Hz")
    log.info(f"  sectionLength: {config.SECTION_LENGTH} samples/ch")
    log.info(f"  Batch size  : {config.USER_BUFFER_SIZE} interleaved samples (~{config.SECTION_LENGTH / config.CLOCK_RATE * 1000:.0f}ms)")
    log.info(f"  DB DSN      : {config.DB_DSN}")
    log.info("=" * 60)

    daq_thread = threading.Thread(
        target=daq_reader_thread, name="DAQ-Reader", daemon=True
    )
    db_thread = threading.Thread(
        target=db_writer_thread, name="DB-Writer", daemon=False  # non-daemon: flushes on exit
    )
    mon_thread = threading.Thread(
        target=monitor_thread, name="Monitor", daemon=True
    )

    daq_thread.start()
    db_thread.start()
    mon_thread.start()

    # Wait until stop_event is set (Ctrl+C or DAQ error)
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
    log.info(f"  Total written: {s['written']:,} rows")
    log.info(f"  Dropped      : {s['dropped']} batches")
    log.info(f"  DB errors    : {s['db_errors']}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
