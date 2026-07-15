# -*- coding: utf-8 -*-
"""
web_gui/pipeline.py
───────────────────
In-process DAQ pipeline engine.
Runs the data acquisition and database writing threads directly inside
the Flask/SocketIO process — no Docker containers required.
Supports both mockup (synthetic waveform) and real hardware modes.
"""

import logging
import math
import os
import queue
import random
import sys
import threading
import time
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

import web_gui.db as db_module

_log = logging.getLogger(__name__)

# ── Ensure project root is on sys.path so Automation.BDaq can be found ────────
# The old stream_to_db.py did this explicitly; we must do the same here
# because the Automation SDK folder lives at the project root level.
_PROJECT_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), os.path.pardir)
)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

BDAQ_IMPORT_ERROR = None
try:
    from Automation.BDaq import *
    from Automation.BDaq.WaveformAiCtrl import WaveformAiCtrl
    from Automation.BDaq.BDaqApi import AdxEnumToString, BioFailed
    BDAQ_AVAILABLE = True
except Exception as _exc:
    BDAQ_AVAILABLE = False
    BDAQ_IMPORT_ERROR = str(_exc)

# ── Log SDK status at startup (visible in terminal) ──────────────────────────
if BDAQ_AVAILABLE:
    _log.info("Advantech BDaq SDK loaded successfully")
else:
    _log.warning(
        "Advantech BDaq SDK NOT available: %s  |  "
        "project_root=%s  |  sys.path=%s",
        BDAQ_IMPORT_ERROR, _PROJECT_ROOT, sys.path,
    )

# ── Shared State ──────────────────────────────────────────────────────────────

_stats_lock = threading.Lock()
_stats = {
    "polled": 0, "enqueued": 0, "written": 0,
    "dropped": 0, "db_errors": 0,
    "running": False, "mode": "stopped",
}

_pipeline_lock = threading.Lock()
_stop_event = threading.Event()
_db_writer_thread = None  # keep reference so we can join on stop

_on_log = None
_on_stats = None


# ── Callbacks ─────────────────────────────────────────────────────────────────

def register_callbacks(log_cb, stats_cb):
    global _on_log, _on_stats
    _on_log = log_cb
    _on_stats = stats_cb


def emit_log(msg: str, level: str = "info"):
    if _on_log:
        _on_log(msg, level)


def _emit_stats():
    if _on_stats:
        _on_stats(get_stats())


# ── Public Accessors ──────────────────────────────────────────────────────────

def get_stats() -> dict:
    with _stats_lock:
        return dict(_stats)


# ── Start Pipeline ────────────────────────────────────────────────────────────

def start_pipeline(cfg: dict, mode: str) -> tuple[bool, str]:
    global _db_writer_thread

    with _pipeline_lock:
        with _stats_lock:
            if _stats.get("running"):
                return False, "Pipeline already running"

        is_mock = (mode == "mockup")
        mode_name = "mockup" if is_mock else "real"

        # ── 1. Bootstrap database ────────────────────────────────────────
        try:
            if is_mock:
                target_dsn = db_module.ensure_mockup_db(
                    cfg["mockup_db_dsn"], "mockup"
                )
            else:
                target_dsn = cfg["db_dsn"]
                db_module.ensure_schema(target_dsn)
        except Exception as e:
            err = f"DB bootstrap failed: {e}"
            emit_log(err, "error")
            return False, err

        session_id = db_module.start_session(
            target_dsn, cfg["channel_count"], cfg["clock_rate"]
        )

        # ── 2. Pipeline parameters ───────────────────────────────────────
        n_ch     = cfg["channel_count"]
        sec_len  = cfg["section_length"]
        clock_hz = cfg["clock_rate"]
        dt_s     = 1.0 / clock_hz
        dt_ns    = int(1_000_000_000 / clock_hz)
        data_queue = queue.Queue(maxsize=cfg["queue_maxsize"])

        _stop_event.clear()

        with _stats_lock:
            _stats.update({
                "polled": 0, "enqueued": 0, "written": 0,
                "dropped": 0, "db_errors": 0,
                "running": True, "mode": mode,
            })

        emit_log(
            f"Pipeline started | mode={mode_name} | "
            f"channels={n_ch} | clock={clock_hz} Hz"
        )
        _emit_stats()

        # ── 3. DAQ reader thread ─────────────────────────────────────────
        if is_mock:
            waveforms = (cfg.get("waveforms", []) * n_ch)[:n_ch]
            if not waveforms:
                waveforms = [{"amp": 1.0, "freq": 10.0, "dc": 2.5}] * n_ch
            noise_std = cfg.get("noise_std", 0.02)

            def _daq_gen():
                sample_counter = 0
                while not _stop_event.is_set():
                    time.sleep(sec_len / clock_hz)
                    if _stop_event.is_set():
                        break

                    raw_data = []
                    for s in range(sec_len):
                        t = (sample_counter + s) * dt_s
                        for ch_idx in range(n_ch):
                            w = waveforms[ch_idx]
                            v = (
                                w["amp"]
                                * math.sin(2 * math.pi * w["freq"] * t)
                                + w["dc"]
                            )
                            v += random.gauss(0.0, noise_std)
                            v = max(0.0, min(5.0, v))
                            raw_data.append(v)

                    sample_counter += sec_len
                    batch_wall_ts_ns = time.time_ns()
                    try:
                        data_queue.put_nowait(
                            (batch_wall_ts_ns, raw_data, len(raw_data))
                        )
                        with _stats_lock:
                            _stats["polled"]   += len(raw_data)
                            _stats["enqueued"] += 1
                    except queue.Full:
                        with _stats_lock:
                            _stats["dropped"] += 1
                        emit_log("Queue full — batch dropped", "warn")

            daq_target = _daq_gen
            daq_name   = "MockDAQ"

        else:
            # Real hardware mode
            if BDAQ_AVAILABLE:
                def _daq_real():
                    try:
                        wf = WaveformAiCtrl(cfg["device_description"])
                        wf.loadProfile            = cfg["profile_path"]
                        wf.conversion.channelStart = cfg["start_channel"]
                        wf.conversion.channelCount = cfg["channel_count"]
                        wf.conversion.clockRate    = cfg["clock_rate"]
                        wf.record.sectionCount     = cfg["section_count"]
                        wf.record.sectionLength    = cfg["section_length"]

                        for i in range(cfg["channel_count"]):
                            ch = cfg["start_channel"] + i
                            wf.channels[ch].signalType = AiSignalType.SingleEnded
                            wf.channels[ch].valueRange = ValueRange.V_0To5

                        ret = wf.prepare()
                        if BioFailed(ret):
                            emit_log(
                                "DAQ prepare() failed — check device "
                                "connection and profile.xml",
                                "error",
                            )
                            _stop_event.set()
                            return

                        ret = wf.start()
                        if BioFailed(ret):
                            emit_log("DAQ start() failed", "error")
                            _stop_event.set()
                            return

                        user_buffer_size = sec_len * n_ch
                        while not _stop_event.is_set():
                            result = wf.getDataF64(user_buffer_size, -1)
                            batch_wall_ts_ns = time.time_ns()
                            ret, returned_count, raw_data = (
                                result[0], result[1], result[2]
                            )

                            if BioFailed(ret):
                                emit_log(
                                    "getDataF64() error — stopping DAQ thread",
                                    "error",
                                )
                                _stop_event.set()
                                break

                            if returned_count <= 0:
                                continue

                            raw_copy = list(raw_data[:returned_count])
                            try:
                                data_queue.put_nowait(
                                    (batch_wall_ts_ns, raw_copy, returned_count)
                                )
                                with _stats_lock:
                                    _stats["polled"]   += returned_count
                                    _stats["enqueued"] += 1
                            except queue.Full:
                                with _stats_lock:
                                    _stats["dropped"] += 1
                                emit_log("Queue full — batch dropped", "warn")

                    except Exception as ex:
                        emit_log(f"DAQ hardware error: {ex}", "error")
                        _stop_event.set()
                    finally:
                        try:
                            wf.stop()
                            wf.dispose()
                        except Exception:
                            pass
                        emit_log("DAQ hardware thread stopped.")

                daq_target = _daq_real
                daq_name   = "RealDAQ"

            else:
                detail = BDAQ_IMPORT_ERROR or "unknown reason"
                err = (
                    "Advantech BDaq SDK is not available: "
                    f"{detail}"
                )
                emit_log(err, "error")
                with _stats_lock:
                    _stats["running"] = False
                    _stats["mode"] = "stopped"
                _emit_stats()
                return False, err

        # ── 4. DB writer thread ──────────────────────────────────────────
        def _db_writer():
            conn = None
            while conn is None and not _stop_event.is_set():
                try:
                    conn = db_module.connect(target_dsn)
                    conn.autocommit = False
                    emit_log("DB writer connected")
                except Exception as e:
                    emit_log(
                        f"DB connect failed: {e} — retry in 5s", "error"
                    )
                    time.sleep(5)

            if conn is None:
                return

            cur = conn.cursor()
            INSERT_SQL = (
                "INSERT INTO daq_samples (time, channel, value) VALUES %s"
            )
            start_ch = cfg["start_channel"]
            page_sz  = cfg["db_page_size"]

            while not _stop_event.is_set() or not data_queue.empty():
                try:
                    batch_wall_ts_ns, raw_data, returned_count = (
                        data_queue.get(timeout=1.0)
                    )
                except queue.Empty:
                    continue

                spc = returned_count // n_ch
                rows = []
                scaling_enabled = cfg.get("scaling_enabled", False)
                scaling_configs = cfg.get("scaling", [])
                for s in range(spc):
                    offset_ns    = (spc - 1 - s) * dt_ns
                    sample_ts_ns = batch_wall_ts_ns - offset_ns
                    sample_ts    = datetime.fromtimestamp(
                        sample_ts_ns / 1e9, tz=timezone.utc
                    )
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
                    psycopg2.extras.execute_values(
                        cur, INSERT_SQL, rows, page_size=page_sz
                    )
                    conn.commit()
                    with _stats_lock:
                        _stats["written"] += len(rows)
                except Exception as e:
                    conn.rollback()
                    with _stats_lock:
                        _stats["db_errors"] += 1
                    emit_log(f"DB insert error: {e}", "error")

            cur.close()
            conn.close()
            emit_log("DB writer disconnected")

        # ── 5. Stats emitter thread ──────────────────────────────────────
        def _stats_emitter():
            interval = cfg.get("stats_interval", 5)
            while not _stop_event.is_set():
                time.sleep(interval)
                _emit_stats()

        # ── 6. Cleanup orchestrator thread ───────────────────────────────
        def _orchestrator():
            """Waits for stop_event, then flushes and finalises."""
            _stop_event.wait()
            emit_log("Flushing DB writer queue...")
            db_t.join(timeout=60)
            db_module.end_session(target_dsn, session_id)
            with _stats_lock:
                _stats["running"] = False
                _stats["mode"] = "stopped"
            _emit_stats()
            emit_log("Pipeline stopped gracefully")

        # ── 7. Launch all threads ────────────────────────────────────────
        daq_t  = threading.Thread(
            target=daq_target, name=daq_name, daemon=True
        )
        db_t   = threading.Thread(
            target=_db_writer, name="DBWriter", daemon=False
        )
        stat_t = threading.Thread(
            target=_stats_emitter, name="StatsEmit", daemon=True
        )
        orch_t = threading.Thread(
            target=_orchestrator, name="PipeOrch", daemon=True
        )

        _db_writer_thread = db_t

        daq_t.start()
        db_t.start()
        stat_t.start()
        orch_t.start()

        return True, ""


# ── Stop Pipeline ─────────────────────────────────────────────────────────────

def stop_pipeline() -> tuple[bool, str]:
    with _pipeline_lock:
        with _stats_lock:
            if not _stats.get("running"):
                return False, "Pipeline not running"

        emit_log("Stopping pipeline...")
        _stop_event.set()  # signals all threads to wind down
        # The orchestrator thread handles the rest asynchronously
        return True, ""
