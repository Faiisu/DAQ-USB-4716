# -*- coding: utf-8 -*-
"""
web_gui/pipeline.py
───────────────────
Deploy Manager for the containerized DAQ pipeline.
Spawns, stops, and inspects the Docker container running the DAQ pipeline process.
"""

import os
import subprocess
import threading

_stats_lock = threading.Lock()
_stats = {
    "polled": 0, "enqueued": 0, "written": 0,
    "dropped": 0, "db_errors": 0,
    "running": False, "mode": "stopped",
}

_pipeline_lock = threading.Lock()

_on_log = None
_on_stats = None

def register_callbacks(log_cb, stats_cb):
    global _on_log, _on_stats
    _on_log = log_cb
    _on_stats = stats_cb

def emit_log(msg: str, level: str = "info"):
    if _on_log:
        _on_log(msg, level)

def get_stats() -> dict:
    with _stats_lock:
        if _stats.get("running"):
            # Inspect the docker container status
            try:
                res = subprocess.run(
                    ["docker", "inspect", "-f", "{{.State.Running}}", "daq-pipeline"],
                    capture_output=True, text=True
                )
                is_running = res.stdout.strip() == "true"
                if not is_running:
                    _stats["running"] = False
                    _stats["mode"] = "stopped"
            except Exception:
                _stats["running"] = False
                _stats["mode"] = "stopped"
        return dict(_stats)

def update_stats_from_container(container_stats: dict):
    with _stats_lock:
        for k, v in container_stats.items():
            if k in _stats:
                _stats[k] = v
    if _on_stats:
        _on_stats(get_stats())

def start_pipeline(cfg: dict, mode: str) -> tuple[bool, str]:
    with _pipeline_lock:
        with _stats_lock:
            if _stats.get("running"):
                return False, "Pipeline already running"

        # 1. Build the Docker image
        try:
            emit_log("Building pipeline Docker image (daq-pipeline:latest)...")
            root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            build_res = subprocess.run(
                ["docker", "build", "-t", "daq-pipeline:latest", "-f", "Dockerfile.pipeline", "."],
                capture_output=True,
                cwd=root_dir,
                text=True
            )
            if build_res.returncode != 0:
                raise Exception(build_res.stderr or build_res.stdout)
            emit_log("Docker image built successfully.")
        except Exception as e:
            err_msg = f"Failed to build Docker image: {e}"
            emit_log(err_msg, "error")
            return False, err_msg

        # 2. Clean up any existing container
        subprocess.run(["docker", "stop", "daq-pipeline"], capture_output=True)
        subprocess.run(["docker", "rm", "daq-pipeline"], capture_output=True)

        # 3. Start container on the daq-net network
        gui_host = os.environ.get("GUI_HOST", "host.docker.internal")
        cmd = [
            "docker", "run", "-d",
            "--name", "daq-pipeline",
            "--network", "daq-net",
            "--add-host=host.docker.internal:host-gateway",
            "-e", f"CONFIG_URL=http://{gui_host}:5050/api/config",
            "-e", f"MODE={mode}",
            "-e", f"STATUS_URL=http://{gui_host}:5050/api/pipeline/stats",
            "-e", f"LOG_URL=http://{gui_host}:5050/api/pipeline/log",
            "daq-pipeline:latest"
        ]

        try:
            emit_log(f"Deploying DAQ container: {' '.join(cmd)}")
            res = subprocess.run(cmd, check=True, capture_output=True, text=True)
            container_id = res.stdout.strip()[:12]
            emit_log(f"Container deployed successfully (ID: {container_id})")
        except Exception as e:
            err_msg = f"Failed to deploy container: {e}"
            emit_log(err_msg, "error")
            return False, err_msg

        with _stats_lock:
            _stats.update({
                "polled": 0, "enqueued": 0, "written": 0,
                "dropped": 0, "db_errors": 0,
                "running": True,
                "mode": mode
            })

        if _on_stats:
            _on_stats(get_stats())

        return True, ""

def stop_pipeline() -> tuple[bool, str]:
    with _pipeline_lock:
        with _stats_lock:
            if not _stats.get("running"):
                return False, "Pipeline not running"

        emit_log("Stopping DAQ container...")
        subprocess.run(["docker", "stop", "daq-pipeline"], capture_output=True)
        subprocess.run(["docker", "rm", "daq-pipeline"], capture_output=True)
        emit_log("DAQ container stopped and removed.")

        with _stats_lock:
            _stats["running"] = False
            _stats["mode"] = "stopped"

        if _on_stats:
            _on_stats(get_stats())

        return True, ""
