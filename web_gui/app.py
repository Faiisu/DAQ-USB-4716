#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
web_gui/app.py
──────────────
Flask + Socket.IO backend for the DAQ USB-4716 Web GUI.
Clean architecture refactored: separates concerns into routing, config, db, and pipeline engine.
"""

import sys
import os
import logging
from datetime import datetime, timezone, timedelta

# ── Add parent directory so we can import config ──────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
import psycopg2.extras
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

import web_gui.config_manager as config_manager
import web_gui.db as db_module
import web_gui.pipeline as pipeline_manager

# ── Flask / Socket.IO setup ──────────────────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SECRET_KEY"] = "daq-gui-secret-2026"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(threadName)-12s] %(levelname)s: %(message)s",
)
log = logging.getLogger(__name__)

# ── Register Pipeline Callbacks ──────────────────────────────────────────────
def on_pipeline_log(msg: str, level: str = "info"):
    socketio.emit("log", {
        "level": level,
        "msg": msg,
        "ts": datetime.now().strftime("%H:%M:%S.%f")[:-3]
    })

def on_pipeline_stats(stats: dict):
    socketio.emit("stats", stats)

pipeline_manager.register_callbacks(on_pipeline_log, on_pipeline_stats)

# ── Flask Routes ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify(config_manager.get_cfg())


@app.route("/api/config", methods=["POST"])
def set_config():
    data = request.get_json(force=True)
    new_cfg = config_manager.update_cfg(data)
    return jsonify({"ok": True, "config": new_cfg})


@app.route("/api/db/test", methods=["POST"])
def test_db():
    data = request.get_json(force=True)
    dsn  = data.get("dsn", config_manager.get_cfg()["mockup_db_dsn"])
    try:
        conn = psycopg2.connect(dsn, connect_timeout=5)
        cur  = conn.cursor()
        cur.execute("SELECT version();")
        ver  = cur.fetchone()[0]
        cur.close(); conn.close()
        return jsonify({"ok": True, "version": ver})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/pipeline/start", methods=["POST"])
def start_pipeline():
    data = request.get_json(force=True) if request.data else {}
    mode = data.get("mode", "mockup")

    if mode not in ["mockup", "real"]:
        return jsonify({"ok": False, "error": f"Invalid mode: {mode}"}), 400

    ok, err = pipeline_manager.start_pipeline(config_manager.get_cfg(), mode)
    if not ok:
        return jsonify({"ok": False, "error": err}), 400

    return jsonify({"ok": True})


@app.route("/api/pipeline/stop", methods=["POST"])
def stop_pipeline():
    ok, err = pipeline_manager.stop_pipeline()
    if not ok:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True})


@app.route("/api/pipeline/status", methods=["GET"])
def pipeline_status():
    return jsonify(pipeline_manager.get_stats())


@app.route("/api/pipeline/log", methods=["POST"])
def receive_pipeline_log():
    data = request.get_json(force=True)
    msg = data.get("msg", "")
    level = data.get("level", "info")
    on_pipeline_log(msg, level)
    return jsonify({"ok": True})


@app.route("/api/pipeline/stats", methods=["POST"])
def receive_pipeline_stats():
    data = request.get_json(force=True)
    pipeline_manager.update_stats_from_container(data)
    return jsonify({"ok": True})




@app.route("/api/plot/static", methods=["POST"])
def static_plot():
    data      = request.get_json(force=True)
    cfg       = config_manager.get_cfg()
    db_target = data.get("db_target", "mockup")

    if db_target == "mockup":
        dsn = db_module.build_mockup_dsn(cfg.get("mockup_db_dsn"), "mockup")
    elif db_target == "real":
        dsn = cfg.get("db_dsn")
    else:
        dsn = data.get("dsn") or db_module.build_mockup_dsn(cfg.get("mockup_db_dsn"), "mockup")
    channels = data.get("channels", [])
    last_sec = float(data.get("last_sec", 60))
    start_s  = data.get("start")
    end_s    = data.get("end")

    now_utc = datetime.now(tz=timezone.utc)
    if start_s and end_s:
        try:
            start_dt = datetime.fromisoformat(start_s).astimezone(timezone.utc)
            end_dt   = datetime.fromisoformat(end_s).astimezone(timezone.utc)
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 400
    else:
        end_dt   = now_utc
        start_dt = now_utc - timedelta(seconds=last_sec)

    try:
        conn = psycopg2.connect(dsn, connect_timeout=5)
        ch_filter = "AND channel = ANY(%s)" if channels else ""
        sql = f"""
            SELECT time, channel, value
            FROM   daq_samples
            WHERE  time >= %s AND time <= %s
              {ch_filter}
            ORDER  BY channel, time;
        """
        params = [start_dt, end_dt] + ([channels] if channels else [])
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute(sql, params)
        rows = cur.fetchall()
        cur.close(); conn.close()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    result: dict[str, dict] = {}
    for row in rows:
        ch = str(row["channel"])
        if ch not in result:
            result[ch] = {"times": [], "values": []}
        result[ch]["times"].append(row["time"].isoformat())
        result[ch]["values"].append(row["value"])

    return jsonify({"ok": True, "data": result,
                    "start": start_dt.isoformat(), "end": end_dt.isoformat()})


@app.route("/api/db/channels", methods=["POST"])
def db_channels():
    data      = request.get_json(force=True)
    cfg       = config_manager.get_cfg()
    db_target = data.get("db_target", "mockup")

    if db_target == "mockup":
        dsn = db_module.build_mockup_dsn(cfg.get("mockup_db_dsn"), "mockup")
    elif db_target == "real":
        dsn = cfg.get("db_dsn")
    else:
        dsn = data.get("dsn") or db_module.build_mockup_dsn(cfg.get("mockup_db_dsn"), "mockup")
    try:
        conn = psycopg2.connect(dsn, connect_timeout=5)
        cur  = conn.cursor()
        cur.execute("SELECT DISTINCT channel FROM daq_samples ORDER BY channel;")
        chs  = [r[0] for r in cur.fetchall()]
        cur.close(); conn.close()
        return jsonify({"ok": True, "channels": chs})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


# ─── Socket.IO events ─────────────────────────────────────────────────────────

@socketio.on("connect")
def on_connect():
    emit("stats", pipeline_manager.get_stats())
    emit("log", {
        "level": "info",
        "msg": "Connected to DAQ GUI server",
        "ts": datetime.now().strftime("%H:%M:%S.%f")[:-3]
    })


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  DAQ USB-4716 Web GUI")
    print("  http://localhost:5050")
    print("=" * 60 + "\n")
    socketio.run(app, host="0.0.0.0", port=5050, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)
