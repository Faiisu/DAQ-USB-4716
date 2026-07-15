import os
import threading
from datetime import datetime

_cfg_lock = threading.Lock()
_cfg = {
    # DB
    "db_dsn":           "postgresql://admin:admin@localhost:5432/daq_db",
    "mockup_db_dsn":    "postgresql://admin:admin@localhost:5432/daq_db",
    # DAQ hardware
    "device_description": "USB-4716,BID#0",
    "profile_path":     "./profile.xml",
    "start_channel":    0,
    "channel_count":    4,
    "clock_rate":       1000,
    "section_length":   256,
    "section_count":    0,
    "queue_maxsize":    200,
    "db_page_size":     1000,
    "stats_interval":   5,
    # Mockup waveforms
    "waveforms": [
        {"amp": 2.0,  "freq": 5.0,   "dc": 2.5},
        {"amp": 1.0,  "freq": 10.0,  "dc": 2.5},
        {"amp": 0.5,  "freq": 20.0,  "dc": 1.5},
        {"amp": 1.5,  "freq": 2.0,   "dc": 3.0},
    ],
    "noise_std": 0.02,
    "scaling_enabled": False,
    "scaling": [
        {"low_v": 0.0, "high_v": 5.0, "low_val": 0.0, "high_val": 5.0},
        {"low_v": 0.0, "high_v": 5.0, "low_val": 0.0, "high_val": 5.0},
        {"low_v": 0.0, "high_v": 5.0, "low_val": 0.0, "high_val": 5.0},
        {"low_v": 0.0, "high_v": 5.0, "low_val": 0.0, "high_val": 5.0},
    ],
}

# Try to seed from config.py
try:
    import config as _c
    _cfg["db_dsn"]            = _c.DB_DSN
    _cfg["mockup_db_dsn"]     = _c.MOCKUP_DB_DSN
    _cfg["device_description"]= _c.DEVICE_DESCRIPTION
    _cfg["start_channel"]     = _c.START_CHANNEL
    _cfg["channel_count"]     = _c.CHANNEL_COUNT
    _cfg["clock_rate"]        = _c.CLOCK_RATE
    _cfg["section_length"]    = _c.SECTION_LENGTH
    _cfg["section_count"]     = _c.SECTION_COUNT
    _cfg["queue_maxsize"]     = _c.QUEUE_MAXSIZE
    _cfg["db_page_size"]      = _c.DB_PAGE_SIZE
    _cfg["stats_interval"]    = _c.STATS_INTERVAL_SEC
    _cfg["scaling_enabled"]   = getattr(_c, "SCALING_ENABLED", False)
    _cfg["scaling"]           = getattr(_c, "SCALING", [])
except Exception:
    pass

def get_cfg() -> dict:
    with _cfg_lock:
        return dict(_cfg)

def update_cfg(data: dict) -> dict:
    with _cfg_lock:
        for k, v in data.items():
            if k in _cfg:
                _cfg[k] = v
        new_cfg = dict(_cfg)
    save_config_to_file(new_cfg)
    return new_cfg

def save_config_to_file(cfg: dict):
    config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), os.path.pardir, "config.py"))
    content = f"""# config.py (Auto-generated/updated by Web GUI on {datetime.now().isoformat()})

# ─── DAQ Hardware ────────────────────────────────────────────────────────────
DEVICE_DESCRIPTION   = {repr(cfg["device_description"])}
PROFILE_PATH         = {repr(cfg["profile_path"])}
START_CHANNEL        = {int(cfg["start_channel"])}
CHANNEL_COUNT        = {int(cfg["channel_count"])}
CLOCK_RATE           = {int(cfg["clock_rate"])}

HARDWARE_BUFFER_SIZE = 1024
SECTION_LENGTH       = {int(cfg["section_length"])}
SECTION_COUNT        = {int(cfg["section_count"])}

# USER_BUFFER size (derived)
USER_BUFFER_SIZE     = SECTION_LENGTH * CHANNEL_COUNT

# ─── Pipeline ────────────────────────────────────────────────────────────────
QUEUE_BATCH_SIZE     = USER_BUFFER_SIZE
QUEUE_MAXSIZE        = {int(cfg["queue_maxsize"])}

# ─── Database ────────────────────────────────────────────────────────────────
DB_DSN               = {repr(cfg["db_dsn"])}
MOCKUP_DB_DSN        = {repr(cfg["mockup_db_dsn"])}
DB_PAGE_SIZE         = {int(cfg["db_page_size"])}

# ─── Logging ─────────────────────────────────────────────────────────────────
STATS_INTERVAL_SEC   = {int(cfg["stats_interval"])}

# ─── Linear Scaling ──────────────────────────────────────────────────────────
SCALING_ENABLED      = {repr(cfg["scaling_enabled"])}
SCALING              = {repr(cfg["scaling"])}
"""
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception:
        pass
