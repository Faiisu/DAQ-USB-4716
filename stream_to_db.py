#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stream_to_db.py
───────────────
DAQ USB-4716 → TimescaleDB streaming pipeline

Architecture (2-thread + Queue):
  ┌──────────────────────────────────────────────────┐
  │ DAQ Thread  (minimal work — poll + raw enqueue)  │
  │  getDataF64() → put(raw_data, timestamp)         │
  └─────────────────────┬────────────────────────────┘
                        │ raw interleaved float64 list
                        ▼
                  Queue (in-memory)
                        │
  ┌─────────────────────▼────────────────────────────┐
  │ DB Writer Thread  (parse + batch INSERT)         │
  │  get(raw) → parse interleaved → executemany()    │
  └──────────────────────────────────────────────────┘

Key design decisions:
  - DAQ thread does NO parsing/looping — returns to poll ASAP
  - DB writer owns all CPU-heavy work (parsing interleaved data)
  - Queue.put_nowait() — DAQ NEVER blocks waiting for DB
  - DB writer is non-daemon → flushes queue before process exits
  - t0 captured ONCE when DAQ loop begins; all sample timestamps are
    interpolated as t0 + (cumulative_sample_offset + s) * dt_per_sample
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

import config

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(threadName)-12s] %(levelname)s: %(message)s",
)
log = logging.getLogger(__name__)

# ─── Shared state ─────────────────────────────────────────────────────────────
# Each item in queue: (sample_offset: int, raw_data: list[float], returned_count: int)
#   sample_offset  = cumulative per-channel sample count BEFORE this batch
#   sample_ts      = t0 + (sample_offset + s) * dt_per_sample
data_queue = queue.Queue(maxsize=config.QUEUE_MAXSIZE)
stop_event = threading.Event()

# t0 is captured once when the DAQ loop starts; DB writer waits for it
daq_start_time: float = 0.0
daq_start_event = threading.Event()   # signals that daq_start_time is valid

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
        # ── Capture t0 ONCE — anchor for all sample timestamps ──
        global daq_start_time
        daq_start_time = datetime.now(timezone.utc).timestamp()
        daq_start_event.set()          # unblock DB writer
        log.info(f"DAQ t0 = {datetime.fromtimestamp(daq_start_time, tz=timezone.utc).isoformat()}")

        sample_offset = 0              # cumulative per-channel sample count

        while not stop_event.is_set():
            # Block until USER_BUFFER_SIZE interleaved samples are ready (~500ms at 1024Hz, 2ch)
            # timeout=-1 means wait indefinitely for requested count
            result = wf.getDataF64(config.USER_BUFFER_SIZE, -1)
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
            samples_this_batch = returned_count // config.CHANNEL_COUNT

            try:
                data_queue.put_nowait((sample_offset, raw_copy, returned_count))
                sample_offset += samples_this_batch
                with stats_lock:
                    stats["polled"]   += returned_count
                    stats["enqueued"] += 1
            except queue.Full:
                # Offset still advances so future batches stay time-continuous
                sample_offset += samples_this_batch
                with stats_lock:
                    stats["dropped"] += 1
                log.warning(
                    f"Queue full! Dropped 1 batch ({returned_count} samples). "
                    f"DB writer may be too slow."
                )

    finally:
        wf.stop()
        wf.release()
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
    dt_per_sample = 1.0 / config.CLOCK_RATE

    # Wait until DAQ thread has set t0 (or give up if stop was signalled early)
    daq_start_event.wait(timeout=30)
    t0 = daq_start_time
    log.info(f"DB writer using t0 = {datetime.fromtimestamp(t0, tz=timezone.utc).isoformat()}")

    while not stop_event.is_set() or not data_queue.empty():
        try:
            sample_offset, raw_data, returned_count = data_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        # ── Parse interleaved data into DB rows ──
        # raw_data layout: [ch0_s0, ch1_s0, ch0_s1, ch1_s1, ...]
        # Timestamp = t0 + (cumulative_offset + s) * dt_per_sample
        samples_per_channel = returned_count // config.CHANNEL_COUNT
        rows = []
        for s in range(samples_per_channel):
            sample_ts = datetime.fromtimestamp(
                t0 + (sample_offset + s) * dt_per_sample, tz=timezone.utc
            )
            for ch in range(config.CHANNEL_COUNT):
                value = raw_data[s * config.CHANNEL_COUNT + ch]
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
                data_queue.put_nowait((batch_ts, raw_data, returned_count))
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
